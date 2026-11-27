import { Injectable } from "@nestjs/common";
import type { LlmChatMessage, LlmChatRequest, LlmChatResult, LlmStreamChunk, LlmToolDefinition } from "@openreel/plugin-sdk";

const DEFAULT_TIMEOUT_MS = 120_000;

export interface OpencodeAccountConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Free sibling model on the same account, used when the preferred model
   * hits its quota (e.g. `hy4` → `hy4-flash-free` on OpenCode Go). */
  freeModel?: string;
}

export interface OpencodeClientConfig extends OpencodeAccountConfig {
  /** Secondary account (e.g. the personal free OpenCode account) that takes
   * over when the primary (OpenCode Go) quota is exhausted. */
  fallback?: Partial<OpencodeAccountConfig>;
}

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

/** Monthly/quota 429s send Retry-After values up to days (e.g. "resets in
 * 16d"). Waiting that long would wedge the request — and a wait beyond the
 * cap cannot make the immediate retry succeed anyway (quota horizon), so
 * skip it entirely and fail fast for caller-side fallback. */
const MAX_RETRY_AFTER_MS = 5_000;

async function waitForRetry(response: Response): Promise<void> {
  const raw = retryAfterMs(response.headers.get("Retry-After"));
  const delay = raw <= MAX_RETRY_AFTER_MS ? raw : 0;
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

/** Errors that mean "this account cannot serve right now" — quota exhausted
 * (429), billing required (402), or the key was rejected (401). These trigger
 * a switch to the next account instead of surfacing the failure. */
const FAILOVER_STATUSES = new Set([401, 402, 429]);

/** After failing over, probe the primary again after this long so a rate
 * limit (minutes) or a reset monthly quota reactivates it automatically. */
const DEFAULT_FAILOVER_RECOVERY_MS = 600_000;

function failoverRecoveryMs(): number {
  const configured = Number(process.env.OPENCODE_FAILOVER_RECOVERY_MS ?? DEFAULT_FAILOVER_RECOVERY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_FAILOVER_RECOVERY_MS;
}

/** True when at least one OpenCode account (primary or fallback) is configured. */
export function hasOpencodeCredentials(): boolean {
  return Boolean(process.env.OPENCODE_API_KEY || process.env.OPENCODE_FALLBACK_API_KEY);
}

/**
 * OpenCode Zen gateway client ("opencode2 大模型"):
 * OpenAI-compatible POST {baseUrl}/chat/completions, streaming via SSE.
 * The API key is injected server-side and never reaches the browser.
 *
 * Supports a secondary fallback account (OPENCODE_FALLBACK_*): when the
 * primary OpenCode Go account hits its quota (429), requests automatically
 * switch to the fallback (personal free account) — sticky until the
 * recovery window elapses, then the primary is probed again.
 */
@Injectable()
export class OpencodeClient {
  readonly config: OpencodeAccountConfig;
  /** Secondary free account (personal/opencode) used on quota failures. */
  readonly fallback?: OpencodeAccountConfig;
  private readonly accounts: OpencodeAccountConfig[];
  private active = 0;
  private switchedAt = 0;
  /** Per-account demotion to a free sibling model after a quota failure. */
  private readonly demoted = new Map<number, { model: string; until: number }>();

  constructor(config: OpencodeClientConfig) {
    this.config = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      freeModel: config.freeModel,
    };
    this.fallback = config.fallback?.apiKey
      ? {
          baseUrl: config.fallback.baseUrl || config.baseUrl,
          apiKey: config.fallback.apiKey,
          model: config.fallback.model || config.model,
          freeModel: config.fallback.freeModel,
        }
      : undefined;
    this.accounts = [this.config];
    if (config.fallback?.apiKey) {
      this.accounts.push({
        baseUrl: config.fallback.baseUrl || config.baseUrl,
        apiKey: config.fallback.apiKey,
        model: config.fallback.model || config.model,
        freeModel: config.fallback.freeModel,
      });
    }
  }

  async complete(req: LlmChatRequest): Promise<LlmChatResult> {
    for (;;) {
      const index = this.currentIndex();
      const account = this.accounts[index];
      try {
        return await this.completeOnce(account, req, index);
      } catch (error) {
        // A paid model that exhausted its quota (e.g. hy4 on OpenCode Go) must
        // first retry the account's free sibling (hy4-flash-free) before we
        // abandon the account entirely.
        if (this.degradeToFreeModel(index, account, error)) continue;
        if (!this.advanceAccount(error)) throw error;
      }
    }
  }

  private async completeOnce(
    account: OpencodeAccountConfig,
    req: LlmChatRequest,
    accountIndex: number,
  ): Promise<LlmChatResult> {
    const body = this.requestBody(account, req, false, this.modelFor(accountIndex, account, req.model));
    for (let attempt = 0; ; attempt++) {
      const response = await this.post(account, "/chat/completions", body);
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
    for (;;) {
      const index = this.currentIndex();
      const account = this.accounts[index];
      const body = this.requestBody(account, req, true, this.modelFor(index, account, req.model));
      const response = await this.post(account, "/chat/completions", body);
      if (!response.ok) {
        const error = await responseError(response);
        if (this.degradeToFreeModel(index, account, error)) continue;
        if (this.advanceAccount(error)) continue;
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
      return;
    }
  }

  /** The account index to use for this request, probing the primary again once
   * the failover recovery window has elapsed (quota may have reset by then). */
  private currentIndex(): number {
    if (this.active > 0) {
      const recovery = failoverRecoveryMs();
      if (recovery > 0 && Date.now() - this.switchedAt >= recovery) {
        this.active = 0;
      }
    }
    return this.active;
  }

  /** Effective model for an account: a demoted free sibling wins for its
   * demotion window; otherwise the caller's model (primary) or account model. */
  private modelFor(index: number, account: OpencodeAccountConfig, requested?: string): string {
    const demotion = this.demoted.get(index);
    if (demotion) {
      if (demotion.until > Date.now()) return demotion.model;
      this.demoted.delete(index);
    }
    return index === 0 ? requested || account.model : account.model;
  }

  /** On a quota/billing failure for a paid model, retry the same account with
   * its free sibling (hy4 → hy4-flash-free) before switching accounts. */
  private degradeToFreeModel(index: number, account: OpencodeAccountConfig, error: unknown): boolean {
    const status = error instanceof LlmError ? error.status : 0;
    if (status !== 402 && status !== 429) return false;
    const freeModel = account.freeModel;
    if (!freeModel) return false;
    const current = this.modelFor(index, account);
    if (!current || current === freeModel) return false;
    const windowMs = failoverRecoveryMs() || DEFAULT_FAILOVER_RECOVERY_MS;
    this.demoted.set(index, { model: freeModel, until: Date.now() + windowMs });
    console.warn(
      `[opencode] model ${current} hit ${status} on account #${index}; retrying with free model ${freeModel} for ${Math.round(windowMs / 1000)}s`,
    );
    return true;
  }

  /** Switch to the next account on quota/auth failures; false when the error
   * is not failover-worthy or no fallback account remains. */
  private advanceAccount(error: unknown): boolean {
    const status = error instanceof LlmError ? error.status : 0;
    if (!FAILOVER_STATUSES.has(status)) return false;
    const next = this.active + 1;
    if (next >= this.accounts.length) return false;
    console.warn(
      `[opencode] account #${this.active} failed with ${status}; switching to fallback account #${next} (${this.accounts[next].baseUrl})`,
    );
    this.active = next;
    this.switchedAt = Date.now();
    return true;
  }

  private requestBody(
    account: OpencodeAccountConfig,
    req: LlmChatRequest,
    stream: boolean,
    model: string,
  ) {
    // Each account serves its own model namespace: the primary's model ids are
    // meaningless to the fallback provider, so the caller-selected model is
    // resolved per account before the request is built.
    // The protocol uses camelCase; OpenAI-compatible gateways (NVIDIA NIM in
    // particular) reject unknown fields instead of ignoring them. Reasoning
    // effort is only sent to the OpenCode gateway that advertises it.
    const { maxTokens, messages, reasoningEffort, ...rest } = req;
    const opencode = /opencode\.ai/i.test(account.baseUrl);
    return {
      ...rest,
      stream,
      model,
      messages: messages.map(toWireMessage),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(reasoningEffort && opencode ? { reasoning_effort: reasoningEffort } : {}),
    };
  }

  private async post(account: OpencodeAccountConfig, pathname: string, body: unknown): Promise<Response> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), timeoutMs());
    try {
      return await fetch(`${account.baseUrl}${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.apiKey}`,
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

/** Map the shared protocol's camelCase message shape onto the OpenAI wire
 * format. Gateways that validate strictly (NVIDIA NIM) reject unknown fields,
 * so assistant tool calls must be `tool_calls` and tool replies must carry
 * `tool_call_id`; image parts nest their URL as `image_url: { url }`. */
export function toWireMessage(message: LlmChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = {
    role: message.role,
    content: toWireContent(message.content),
  };
  if (message.toolCalls?.length) out.tool_calls = message.toolCalls;
  if (message.toolCallId) out.tool_call_id = message.toolCallId;
  if (message.name) out.name = message.name;
  return out;
}

function toWireContent(content: LlmChatMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "image_url" ? { type: "image_url", image_url: { url: part.imageUrl } } : part,
  );
}
