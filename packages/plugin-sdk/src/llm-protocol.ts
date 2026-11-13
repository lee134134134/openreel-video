/**
 * Shared LLM chat protocol types.
 *
 * Used by:
 *  - apps/server  (NestJS): OpenCode Zen gateway client + agent loop + SSE endpoints
 *  - apps/web     (React): AI Studio chat client over EventSource/fetch-SSE
 *
 * Legacy BYOK chat in apps/web keeps its own transport; this protocol is for
 * the server-driven creation agent.
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmTextContent {
  type: "text";
  text: string;
}

export interface LlmImageUrlContent {
  type: "image_url";
  imageUrl: string;
}

export type LlmContentPart = LlmTextContent | LlmImageUrlContent;

/** OpenAI-compatible message shape (tool calls included). */
export interface LlmChatMessage {
  role: LlmRole;
  /** Text or multimodal parts. Plain string is shorthand for a text part. */
  content: string | LlmContentPart[];
  /** Present on assistant messages requesting tools (OpenAI-style). */
  toolCalls?: LlmToolCallRequest[];
  /** For role === "tool": the id of the tool call being answered. */
  toolCallId?: string;
  /** For role === "tool": the original tool name that was called. */
  name?: string;
}

export interface LlmToolCallRequest {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmChatRequest {
  model: string;
  messages: LlmChatMessage[];
  tools?: LlmToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

/** Non-streamed completion result. */
export interface LlmChatResult {
  content: string;
  toolCalls: LlmToolCallRequest[];
  usage?: { inputTokens?: number; outputTokens?: number };
  finishReason?: "stop" | "tool_calls" | "length" | string;
  raw?: unknown;
}

/** Server-sent-events chunk stream over SSE en/encoded as one JSON per event. */
export type LlmStreamChunk =
  | { type: "content"; delta: string }
  | { type: "tool_call_delta"; index: number; id?: string; name?: string; argumentsDelta: string; final?: boolean }
  | { type: "finish"; finishReason: LlmChatResult["finishReason"]; usage?: LlmChatResult["usage"] }
  | { type: "error"; message: string };

export type LlmProviderId = "opencode" | "openai" | "anthropic" | "custom";

/** Server-side provider configuration (from .env + per-request overrides). */
export interface LlmProviderConfig {
  id: LlmProviderId;
  /** OpenAI-compatible chat/completions base URL. */
  baseUrl: string;
  /** API key injected server-side; never travels to the browser. */
  apiKey?: string;
  defaultModel: string;
}

/** Streaming events the server agent loop emits (SSE payload bodies). */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "status"; status: "thinking" | "tool_running" | "idle" | "done"; tool?: string }
  | { type: "message"; role: "assistant"; content: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "tool_result"; callId: string; name: string; ok: boolean; summary: string; result?: unknown }
  | { type: "usage"; sessionId: string; turns: number; inputTokens?: number; outputTokens?: number }
  | { type: "error"; message: string };
