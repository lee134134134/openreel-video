import { Injectable, Logger } from "@nestjs/common";
import type {
  AgentEvent,
  LlmChatMessage,
  LlmChatResult,
  LlmStreamChunk,
  LlmToolCallRequest,
} from "@openreel/plugin-sdk";
import { OpencodeClient } from "./opencode.client";
import { ToolRegistry } from "./tool-registry.service";

export const AGENT_SYSTEM_PROMPT = `You are the OpenReel Creative Agent (AI 视频/剪辑助手) for an in-browser video editor.

Capabilities:
1) Chat about editing and video production.
2) Plan real-person (真人) videos: call propose_videogen_plan to turn a brief into a storyboard the server renders with FFmpeg. Then create_videogen_job to queue rendering.
3) Publish finished renders to third-party platforms (YouTube/TikTok/X/Bilibili/Douyin/Xiaohongshu) — ALWAYS confirm with the user first, then call publish_video.
4) Inspect jobs: get_videogen_job, get_render_job, list_render_jobs, list_projects.

Rules:
- Use tools to act; narrate briefly afterwards. Never invent job ids or URLs — read them from tool results.
- Answer in the user's language (default Simplified Chinese when ambiguous).
- If a tool result contains an error, explain it and suggest the setup step (e.g. missing credentials).`;

function summariseResult(payload: unknown): string {
  if (payload === null || payload === undefined) return "ok";
  if (typeof payload === "string") return payload.slice(0, 200);
  try {
    const json = JSON.stringify(payload);
    return json.length > 300 ? `${json.slice(0, 300)}…` : json;
  } catch {
    return "ok";
  }
}

const MAX_TOOL_RESULT_JSON = 8 * 1024;

function toolResultJson(payload: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(payload ?? { ok: true }) ?? "null";
  } catch {
    json = JSON.stringify({ error: "Tool result could not be serialized" });
  }
  return json.length > MAX_TOOL_RESULT_JSON
    ? `${json.slice(0, MAX_TOOL_RESULT_JSON)}\n...[truncated]`
    : json;
}

function modelOf(client: OpencodeClient): string {
  return (client as unknown as { config: { model: string } }).config.model;
}

/**
 * Agentic chat loop over an OpenAI-compatible streaming gateway.
 * Assistant content is forwarded as `message` events while streaming; tool
 * calls are executed serially between turns (max `maxTurns`).
 */
@Injectable()
export class AgentLoopService {
  private readonly logger = new Logger(AgentLoopService.name);

  constructor(
    private readonly llm: OpencodeClient,
    private readonly tools: ToolRegistry,
  ) {}

  async *run(
    history: LlmChatMessage[],
    opts: { sessionId: string; model?: string; maxTurns?: number },
  ): AsyncGenerator<AgentEvent, void, undefined> {
    const maxTurns = opts.maxTurns ?? 8;
    const model = opts.model || modelOf(this.llm);
    const messages: LlmChatMessage[] = [{ role: "system", content: AGENT_SYSTEM_PROMPT }, ...history.slice(-20)];
    const toolDefs = this.tools.definitions();

    for (let turn = 0; turn < maxTurns; turn++) {
      let content = "";
      let messageEmitted = false;
      const finalCalls: LlmToolCallRequest[] = [];

      for await (const chunk of this.demandStream(messages, model, toolDefs)) {
        if (chunk.type === "content") {
          content += chunk.delta;
          if (chunk.delta) {
            messageEmitted = true;
            yield { type: "message", role: "assistant", content: chunk.delta };
          }
        } else if (chunk.type === "tool_call_delta" && chunk.final) {
          const name = (chunk.name ?? "").trim();
          if (name) {
            finalCalls.push({
              id: chunk.id ?? crypto.randomUUID(),
              type: "function",
              function: { name, arguments: chunk.argumentsDelta },
            });
          }
        } else if (chunk.type === "error") {
          yield { type: "error", message: chunk.message };
          return;
        }
      }

      if (content.length === 0 && finalCalls.length === 0) {
        // Provider delivered nothing over stream; use one non-stream fallback.
        const completion: LlmChatResult = await this.llm.complete({ model, messages, tools: toolDefs });
        content = completion.content;
        for (const tc of completion.toolCalls ?? []) {
          if (tc.function.name) finalCalls.push(tc);
        }
        if (content && !messageEmitted) {
          messageEmitted = true;
          yield { type: "message", role: "assistant", content };
        }
      }

      messages.push({
        role: "assistant",
        content,
        ...(finalCalls.length ? { toolCalls: finalCalls } : {}),
      });
      if (finalCalls.length === 0) return;

      for (const call of finalCalls) {
        yield { type: "tool_call", callId: call.id, name: call.function.name, arguments: call.function.arguments };
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        } catch {
          /* handled below as tool error */
        }
        let payload: unknown;
        let ok = true;
        try {
          const tool = this.tools.list().find((t) => t.name === call.function.name);
          if (!tool) throw new Error(`unknown tool: ${call.function.name}`);
          payload = await tool.execute(args, { sessionId: opts.sessionId });
        } catch (err) {
          ok = false;
          payload = { error: String((err as Error)?.message ?? err) };
          this.logger.warn(`tool ${call.function.name} failed: ${String((err as Error)?.message ?? err)}`);
        }
        yield {
          type: "tool_result",
          callId: call.id,
          name: call.function.name,
          ok,
          summary: summariseResult(payload),
          result: payload,
        };
        messages.push({
          role: "tool",
          toolCallId: call.id,
          name: call.function.name,
          content: toolResultJson(payload),
        });
      }
    }
    yield { type: "error", message: "agent loop reached max turns" };
  }

  private async *demandStream(
    messages: LlmChatMessage[],
    model: string,
    tools: ReturnType<ToolRegistry["definitions"]>,
  ): AsyncGenerator<LlmStreamChunk, void, undefined> {
    yield* this.llm.stream({ model, messages, tools });
  }
}
