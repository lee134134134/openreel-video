import type { AgentEvent, LlmChatMessage } from "@openreel/plugin-sdk";
import { resolveServerUrl, ServerApiError } from "./api";

export interface AgentStreamRequest {
  sessionId?: string;
  message: string;
  history?: LlmChatMessage[];
  model?: string;
}

/** POST-based SSE: EventSource cannot be used for the agent endpoint. */
export async function* streamAgentEvents(
  request: AgentStreamRequest,
  signal?: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const response = await fetch(resolveServerUrl("/agent/stream"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    throw new ServerApiError(await streamError(response), response.status);
  }
  if (!response.body) throw new Error("服务器未返回事件流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseEventFrame(frame);
        if (event) yield event;
      }
      if (done) break;
    }
    const tail = parseEventFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseEventFrame(frame: string): AgentEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return null;
  return JSON.parse(data) as AgentEvent;
}

async function streamError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || `服务器请求失败 (${response.status})`;
  } catch {
    return `服务器请求失败 (${response.status})`;
  }
}
