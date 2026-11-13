import { Injectable } from "@nestjs/common";
import type { LlmChatRequest, LlmChatResult, LlmStreamChunk, LlmToolDefinition } from "@openreel/plugin-sdk";

const DEFAULT_TIMEOUT_MS = 120_000;

export class LlmError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timeoutMs(): number {
  const configured = Number(process.env.OPENCODE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_TIMEOUT_MS;
}

function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

async function responseError(response: Response): Promise<LlmError> {
  const text = await response.text().catch(() => "");
  return new LlmError(response.status, `LLM gateway ${response.status}: ${text.slice(0, 400)}`);
}

async function waitForRetry(response: Response): Promise<void> {
  const delay = retryAfterMs(response.headers.get("Retry-After"));
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

/**
 * OpenCode Zen gateway client ("opencode2 大模型"):
 * OpenAI-compatible POST {baseUrl}/chat/completions, streaming via SSE.
 * The API key is injected server-side and never reaches the browser.
 */
@Injectable()
export class OpencodeClient {
  constructor(private readonly config: { baseUrl: string; apiKey: string; model: string }) {}

  async complete(req: LlmChatRequest): Promise<LlmChatResult> {
    const body = { ...req, stream: false, model: req.model || this.config.model };
    for (let attempt = 0; ; attempt++) {
      const response = await this.post("/chat/completions", body);
      if (!response.ok) {
        const error = await responseError(response);
        const retryable = response.status === 429 || response.status >= 500;
        if (attempt === 0 && retryable) {
          await waitForRetry(response);
          continue;
        }
        throw error;
      }

      const json = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string; tool_calls?: LlmChatResult["toolCalls"] };
          finish_reason?: string;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      return {
        content: choice?.message?.content ?? "",
        toolCalls: choice?.message?.tool_calls ?? [],
        finishReason: choice?.finish_reason ?? "stop",
        usage: json.usage
          ? { inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens }
          : undefined,
        raw: json,
      };
    }
  }

  /** Parse OpenAI-style SSE and yield normalized chunks. */
  async *stream(req: LlmChatRequest): AsyncGenerator<LlmStreamChunk, void, undefined> {
    const body = { ...req, stream: true, model: req.model || this.config.model };
    const response = await this.post("/chat/completions", body);
    if (!response.ok) {
      const error = await responseError(response);
      yield { type: "error", message: error.message };
      return;
    }
    if (!response.body) {
      yield { type: "error", message: "LLM gateway returned an empty stream" };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const partials = new Map<number, { id: string; name: string; args: string }>();
    let finish: LlmChatResult["finishReason"];

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator: number;
      while ((separator = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, separator).trim();
        buffer = buffer.slice(separator + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          // Ignore malformed or unterminated provider events.
          continue;
        }
        if (!isRecord(parsed) || !Array.isArray(parsed.choices)) continue;
        const choice: unknown = parsed.choices[0];
        if (!isRecord(choice)) continue;
        const delta = isRecord(choice.delta) ? choice.delta : {};
        if (typeof delta.content === "string" && delta.content) {
          yield { type: "content", delta: delta.content };
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const rawCall of delta.tool_calls) {
            if (!isRecord(rawCall)) continue;
            const parsedIndex = Number(rawCall.index ?? 0);
            const index = Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : 0;
            const fn = isRecord(rawCall.function) ? rawCall.function : {};
            const part = partials.get(index) ?? { id: "", name: "", args: "" };
            if (typeof rawCall.id === "string" && rawCall.id) part.id = rawCall.id;
            if (typeof fn.name === "string" && fn.name && part.name !== fn.name) {
              // Names can be fragmented; an exact repeat is an upstream resend.
              part.name += fn.name;
            }
            const argumentsDelta = typeof fn.arguments === "string" ? fn.arguments : "";
            part.args += argumentsDelta;
            partials.set(index, part);
            yield {
              type: "tool_call_delta",
              index,
              id: part.id || undefined,
              name: part.name || undefined,
              argumentsDelta,
            };
          }
        }
        if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
      }
    }

    // Finalize each tool call once, replacing argument deltas with full JSON.
    for (const [index, part] of partials) {
      yield {
        type: "tool_call_delta",
        index,
        id: part.id || undefined,
        name: part.name || undefined,
        argumentsDelta: part.args,
        final: true,
      };
    }
    yield { type: "finish", finishReason: finish ?? "stop" };
  }

  private async post(pathname: string, body: unknown): Promise<Response> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs());
    try {
      return await fetch(`${this.config.baseUrl}${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          // OpenCode Go gateway: identify the client and route by conversation.
          "User-Agent": process.env.OPENCODE_USER_AGENT || "OpenReel-Server/0.1",
          "x-opencode-session": process.env.OPENCODE_SESSION_ID || SESSION_ID,
          ...(process.env.OPENCODE_ORG_ID ? { "x-opencode-org-id": process.env.OPENCODE_ORG_ID } : {}),
        },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Stable per-process conversation ID so the gateway can cache/route prompts. */
const SESSION_ID = `sess-openreel-${crypto.randomUUID()}`;

export function toolsToOpenAi(tools: LlmToolDefinition[]): unknown[] {
  return tools.map((tool) => ({ type: "function", function: tool.function }));
}
