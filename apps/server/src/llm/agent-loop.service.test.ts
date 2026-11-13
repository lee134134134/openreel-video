import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, LlmChatRequest, LlmChatResult, LlmStreamChunk } from "@openreel/plugin-sdk";
import { AgentLoopService } from "./agent-loop.service";
import { OpencodeClient } from "./opencode.client";
import { ToolRegistry } from "./tool-registry.service";
import type { ToolCallCtx } from "./tool-registry.service";

async function* chunkStream(...chunks: LlmStreamChunk[]): AsyncGenerator<LlmStreamChunk, void, undefined> {
  for (const chunk of chunks) yield chunk;
}

function fakeClient(
  stream: ReturnType<typeof vi.fn<OpencodeClient["stream"]>>,
  complete: ReturnType<typeof vi.fn<OpencodeClient["complete"]>>,
): OpencodeClient {
  return { config: { model: "test-model" }, stream, complete } as unknown as OpencodeClient;
}

async function collect(loop: AgentLoopService, history: Parameters<AgentLoopService["run"]>[0] = []) {
  const events: AgentEvent[] = [];
  for await (const event of loop.run(history, { sessionId: "session-1" })) events.push(event);
  return events;
}

function unusedCompletion(result: LlmChatResult = { content: "", toolCalls: [] }) {
  return vi.fn<OpencodeClient["complete"]>().mockResolvedValue(result);
}

describe("AgentLoopService", () => {
  it("executes a tool turn then emits each plain-text content event once", async () => {
    const stream = vi
      .fn<OpencodeClient["stream"]>()
      .mockImplementationOnce(() =>
        chunkStream({
          type: "tool_call_delta",
          index: 0,
          id: "call-1",
          name: "create_job",
          argumentsDelta: '{"brief":"demo"}',
          final: true,
        }),
      )
      .mockImplementationOnce(() =>
        chunkStream(
          { type: "content", delta: "Created " },
          { type: "content", delta: "j1" },
          { type: "finish", finishReason: "stop" },
        ),
      );
    const complete = unusedCompletion();
    const tools = new ToolRegistry();
    const execute = vi.fn(async (_args: Record<string, unknown>, _ctx: ToolCallCtx) => ({ jobId: "j1" }));
    tools.register({
      name: "create_job",
      description: "Create a job",
      parameters: { type: "object" },
      execute,
    });

    const events = await collect(new AgentLoopService(fakeClient(stream, complete), tools), [
      { role: "user", content: "make a video" },
    ]);

    expect(events.map((event) => event.type)).toEqual(["tool_call", "tool_result", "message", "message"]);
    expect(events.filter((event) => event.type === "message")).toEqual([
      { type: "message", role: "assistant", content: "Created " },
      { type: "message", role: "assistant", content: "j1" },
    ]);
    expect(events[1]).toMatchObject({ type: "tool_result", ok: true, result: { jobId: "j1" } });
    expect(execute).toHaveBeenCalledWith({ brief: "demo" }, { sessionId: "session-1" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("uses the non-stream fallback once without duplicating its message", async () => {
    const stream = vi
      .fn<OpencodeClient["stream"]>()
      .mockImplementation(() => chunkStream({ type: "finish", finishReason: "stop" }));
    const complete = unusedCompletion({ content: "fallback answer", toolCalls: [], finishReason: "stop" });

    const events = await collect(new AgentLoopService(fakeClient(stream, complete), new ToolRegistry()));

    expect(events).toEqual([{ type: "message", role: "assistant", content: "fallback answer" }]);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("bounds input history to the last 20 persisted messages", async () => {
    const history = Array.from({ length: 25 }, (_, index) => ({ role: "user" as const, content: `message-${index}` }));
    let received: LlmChatRequest | undefined;
    const stream = vi.fn<OpencodeClient["stream"]>().mockImplementation((req) => {
      // Snapshot the array before the loop appends its assistant response.
      received = { ...req, messages: [...req.messages] };
      return chunkStream({ type: "content", delta: "ok" });
    });

    await collect(new AgentLoopService(fakeClient(stream, unusedCompletion()), new ToolRegistry()), history);

    expect(received?.messages).toHaveLength(21);
    expect(received?.messages.slice(1)).toEqual(history.slice(-20));
  });

  it("truncates oversized tool-result JSON before the next model turn", async () => {
    const requests: LlmChatRequest[] = [];
    const stream = vi
      .fn<OpencodeClient["stream"]>()
      .mockImplementationOnce((req) => {
        requests.push(req);
        return chunkStream({
          type: "tool_call_delta",
          index: 0,
          id: "call-large",
          name: "large_result",
          argumentsDelta: "{}",
          final: true,
        });
      })
      .mockImplementationOnce((req) => {
        requests.push(req);
        return chunkStream({ type: "content", delta: "done" });
      });
    const tools = new ToolRegistry();
    tools.register({
      name: "large_result",
      description: "Return a large result",
      parameters: {},
      execute: async () => ({ data: "x".repeat(9_000) }),
    });

    await collect(new AgentLoopService(fakeClient(stream, unusedCompletion()), tools));

    const toolMessage = requests[1].messages.find((message) => message.role === "tool");
    expect(typeof toolMessage?.content).toBe("string");
    const content = toolMessage?.content as string;
    expect(content).toHaveLength(8 * 1024 + "\n...[truncated]".length);
    expect(content.endsWith("\n...[truncated]")).toBe(true);
  });
});
