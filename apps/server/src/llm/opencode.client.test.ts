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

  it("caps a quota-horizon Retry-After so a monthly 429 fails fast instead of wedging", async () => {
    // Gateway reports the reset is ~16 days away; waiting would hang forever.
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("month exhausted", { status: 429, headers: { "Retry-After": "1461600" } }))
      .mockResolvedValueOnce(new Response("still exhausted", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const startedAt = Date.now();
    await expect(client().complete(request)).rejects.toMatchObject({ status: 429 });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("OpencodeClient request body", () => {
  it("sends the protocol's maxTokens as OpenAI's max_tokens", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(completion("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await client().complete({ ...request, maxTokens: 1234 });

    const init = (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.max_tokens).toBe(1234);
    expect(body).not.toHaveProperty("maxTokens");
  });

  it("maps tool replies and assistant tool calls onto the OpenAI wire format", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(completion("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await client().complete({
      ...request,
      messages: [
        { role: "user", content: "把字幕加上" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", type: "function", function: { name: "add_caption", arguments: "{}" } }],
        },
        { role: "tool", toolCallId: "call_1", name: "add_caption", content: "{\"ok\":true}" },
      ],
    });

    const init = (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
    const body = JSON.parse(String(init.body));
    const [, assistant, tool] = body.messages;
    expect(assistant.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "add_caption", arguments: "{}" } },
    ]);
    expect(assistant).not.toHaveProperty("toolCalls");
    expect(tool).toMatchObject({ role: "tool", tool_call_id: "call_1", name: "add_caption" });
    expect(tool).not.toHaveProperty("toolCallId");
  });

  it("nests image parts as OpenAI's image_url object", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(completion("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await client().complete({
      ...request,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "这是什么" },
            { type: "image_url", imageUrl: "https://example.test/a.png" },
          ],
        },
      ],
    });

    const init = (fetchMock.mock.calls[0]?.[1] ?? {}) as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "这是什么" },
      { type: "image_url", image_url: { url: "https://example.test/a.png" } },
    ]);
  });
});

describe("OpencodeClient account failover", () => {
  afterEach(() => {
    delete process.env.OPENCODE_FAILOVER_RECOVERY_MS;
  });

  function failoverClient(): OpencodeClient {
    return new OpencodeClient({
      baseUrl: "https://gateway.test/v1",
      apiKey: "go-key",
      model: "go-model",
      fallback: { baseUrl: "https://free.test/v1", apiKey: "person-key", model: "free-model" },
    });
  }

  function lastCall(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>): { url: string; auth: string; model: unknown } {
    const calls = fetchMock.mock.calls;
    const call = calls[calls.length - 1];
    if (!call) throw new Error("fetch was never called");
    const init = (call[1] ?? {}) as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    return {
      url: String(call[0]),
      auth: headers.Authorization ?? "",
      model: JSON.parse(String(init.body)).model,
    };
  }

  it("switches to the fallback account when the primary quota is exhausted", async () => {
    // No model on the request: the account's own model applies.
    const plainRequest: LlmChatRequest = { ...request, model: "" } as unknown as LlmChatRequest;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValue(jsonResponse(completion("from free account")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(failoverClient().complete(plainRequest)).resolves.toMatchObject({ content: "from free account" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(lastCall(fetchMock)).toEqual({ url: "https://free.test/v1/chat/completions", auth: "Bearer person-key", model: "free-model" });
  });

  it("remaps the primary's default model onto the fallback account", async () => {
    const withGoModel: LlmChatRequest = { ...request, model: "go-model" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValue(jsonResponse(completion("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(failoverClient().complete(withGoModel)).resolves.toMatchObject({ content: "ok" });
    expect(lastCall(fetchMock).model).toBe("free-model");
  });

  it("uses the fallback account's model even when the caller picked another primary model", async () => {
    const otherPrimaryModel: LlmChatRequest = { ...request, model: "some-other-primary-model" };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValue(jsonResponse(completion("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await expect(failoverClient().complete(otherPrimaryModel)).resolves.toMatchObject({ content: "ok" });
    expect(lastCall(fetchMock).model).toBe("free-model");
  });

  it("sticks to the fallback account for subsequent requests within the recovery window", async () => {
    process.env.OPENCODE_FAILOVER_RECOVERY_MS = "0";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(completion("first")))
      .mockImplementation(() => Promise.resolve(jsonResponse(completion("second"))));
    vi.stubGlobal("fetch", fetchMock);
    const opencode = failoverClient();

    await opencode.complete(request);
    await expect(opencode.complete(request)).resolves.toMatchObject({ content: "second" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(lastCall(fetchMock).auth).toBe("Bearer person-key");
  });

  it("fails over on stream too, before any chunk is emitted", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("quota exhausted", { status: 429 }))
      .mockResolvedValue(new Response(byteStream(sse({ choices: [{ delta: { content: "free" } }] })), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await collect(failoverClient().stream(request));
    expect(chunks).toEqual([{ type: "content", delta: "free" }, { type: "finish", finishReason: "stop" }]);
    expect(lastCall(fetchMock).url).toBe("https://free.test/v1/chat/completions");
  });

  it("throws the quota error when every account is exhausted", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() =>
      Promise.resolve(new Response("quota exhausted", { status: 429 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(failoverClient().complete(request)).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(4); // 2 attempts x 2 accounts
  });

  it("does not fail over on non-quota errors such as 500", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("boom again", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(failoverClient().complete(request)).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
