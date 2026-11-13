import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmChatRequest, LlmStreamChunk } from "@openreel/plugin-sdk";
import { LlmError, OpencodeClient } from "./opencode.client";

const request: LlmChatRequest = {
  model: "test-model",
  messages: [{ role: "user", content: "hello" }],
};

function client(): OpencodeClient {
  return new OpencodeClient({ baseUrl: "https://gateway.test/v1", apiKey: "secret", model: "test-model" });
}

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function completion(content: string): unknown {
  return {
    choices: [{ message: { content, tool_calls: [] }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  };
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function byteStream(wire: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(wire);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Deliberately split SSE lines and JSON across network reads.
      for (let offset = 0; offset < bytes.length; offset += 37) {
        controller.enqueue(bytes.slice(offset, offset + 37));
      }
      controller.close();
    },
  });
}

async function collect(stream: AsyncGenerator<LlmStreamChunk, void, undefined>): Promise<LlmStreamChunk[]> {
  const chunks: LlmStreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpencodeClient stream", () => {
  it("parses ordered content and fragmented tool calls while skipping malformed SSE", async () => {
    const firstTool = {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "lookup", arguments: '{"job":' } },
            ],
          },
        },
      ],
    };
    const secondTool = {
      choices: [
        {
          delta: {
            tool_calls: [{ index: 0, id: "call_1", function: { arguments: '"j1"}' } }],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const wire =
      "not an SSE line\n" +
      "data: {bad json}\n\n" +
      sse({ choices: [{ delta: { content: "Hello " } }] }) +
      sse(firstTool) +
      sse({ choices: [{ delta: { content: "world" } }] }) +
      sse(secondTool) +
      "data: [DONE]\n\n" +
      'data: {"choices":[';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(byteStream(wire), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await collect(client().stream(request));

    expect(chunks).toEqual([
      { type: "content", delta: "Hello " },
      {
        type: "tool_call_delta",
        index: 0,
        id: "call_1",
        name: "lookup",
        argumentsDelta: '{"job":',
      },
      { type: "content", delta: "world" },
      {
        type: "tool_call_delta",
        index: 0,
        id: "call_1",
        name: "lookup",
        argumentsDelta: '"j1"}',
      },
      {
        type: "tool_call_delta",
        index: 0,
        id: "call_1",
        name: "lookup",
        argumentsDelta: '{"job":"j1"}',
        final: true,
      },
      { type: "finish", finishReason: "tool_calls" },
    ]);
    expect(chunks.filter((chunk) => chunk.type === "tool_call_delta" && chunk.final)).toHaveLength(1);
  });

  it("yields one error chunk and returns for a non-OK stream response", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("unavailable", { status: 503 })));

    const chunks = await collect(client().stream(request));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: "error", message: "LLM gateway 503: unavailable" });
  });
});

describe("OpencodeClient complete", () => {
  it("maps choices, tool calls, and token usage", async () => {
    const payload = {
      choices: [
        {
          message: {
            content: "queued",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "create", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);

    const result = await client().complete(request);

    expect(result).toMatchObject({
      content: "queued",
      finishReason: "tool_calls",
      toolCalls: payload.choices[0].message.tool_calls,
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 500 response once and returns the successful completion", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(completion("recovered")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(client().complete(request)).resolves.toMatchObject({ content: "recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After: 0 by immediately retrying a 429", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse(completion("after limit")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(client().complete(request)).resolves.toMatchObject({ content: "after limit" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a typed LlmError after the single retry is exhausted", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("first", { status: 503 }))
      .mockResolvedValueOnce(new Response("second", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const promise = client().complete(request);
    await expect(promise).rejects.toBeInstanceOf(LlmError);
    await expect(promise).rejects.toMatchObject({ status: 503, message: "LLM gateway 503: second" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
