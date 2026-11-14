import { makeClientFromSend, withRetry, LLMHttpError, parseRetryAfterMs, type LLMClient } from "@openreel/agent";
import type { AIProvider } from "../../stores/ai-connection-store";

export interface DirectConnection { provider: AIProvider; baseUrl: string; model: string; apiKey: string; signal?: AbortSignal }
export function validateAIEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) throw new Error("请使用 HTTPS 基础 URL，或 localhost 上的 HTTP，且不得包含凭据、查询参数或片段。");
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|messages)\/?$/, "");
  return url.href.replace(/\/+$/, "");
}
export function makeDirectBYOKClient(options: DirectConnection): LLMClient {
  const baseUrl = validateAIEndpoint(options.baseUrl);
  if (!options.model.trim()) throw new Error("请输入支持工具调用的模型 ID。");
  if (options.apiKey && /[\r\n]/.test(options.apiKey)) throw new Error("API 密钥无效。");
  const provider = options.provider === "anthropic" ? "anthropic" : "openai";
  const send = withRetry(async (body: unknown) => {
    options.signal?.throwIfAborted();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${provider === "anthropic" ? "/messages" : "/chat/completions"}`, { method: "POST", redirect: "error", credentials: "omit", headers: { "Content-Type": "application/json", ...(provider === "anthropic" ? { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } : options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}) }, body: JSON.stringify(body), signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new Error("无法连接模型端点。请检查其 URL 和浏览器 CORS 支持。不会使用代理或绕过安全限制。");
    }
    // Never include upstream response bodies: providers can echo credentials.
    if (!res.ok) throw new LLMHttpError(`模型端点返回 HTTP ${res.status}。请检查密钥、模型 ID 和服务商设置。`, res.status, parseRetryAfterMs(res.headers.get("retry-after")));
    let raw: unknown;
    try { raw = await res.json(); } catch { throw new Error("端点返回了无效的 JSON。请检查 API 适配器和端点。"); }
    if (!raw || typeof raw !== "object" || (provider === "openai" && !("choices" in raw)) || (provider === "anthropic" && !("content" in raw))) throw new Error("端点返回了不受支持的响应。请选择正确的 API 适配器和支持工具调用的模型。");
    return raw;
  }, { signal: options.signal, retries: 2 });
  return makeClientFromSend({ provider, model: options.model.trim(), maxTokens: 4096, send });
}
