import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { OpencodeAccountConfig, OpencodeClientConfig } from "./opencode.client";

/**
 * Auto-connect the two opencode2 accounts used by the OpenCode CLI:
 *  - OpenCode Go  (https://opencode.ai/inference/go/openai/v1)
 *  - personal/opencode (https://opencode.ai/inference/openai/v1)
 *
 * Both accounts expose free models whose ids end in `-free`. We probe their
 * `/models` endpoints at startup and pick a free model for each account, so
 * the server never has to be reconfigured when the gateway rotates models.
 */
export const OPENCODE_GO_URL = "https://opencode.ai/inference/go/openai/v1";
export const OPENCODE_PERSONAL_URL = "https://opencode.ai/inference/openai/v1";

/** Preferred free models, most capable first. Unknown free ids still work. */
const FREE_MODEL_PREFERENCE = [
  "hy4-flash-free",
  "deepseek-v4.1-flash-free",
  "mimo-v2.6-flash-free",
  "longcat-2.5-free",
  "beam-free",
  "iceman-free",
  "nemotron-3.5-lightning-free",
  "glm-5.3-flash-free",
  "qwen3.8-flash-free",
  "kimi-k3-free",
];

interface ProbedAccount extends OpencodeAccountConfig {
  freeModels: string[];
  /** Every model id the account advertises (paid + free). */
  models: string[];
}

export function isFreeModel(id: string): boolean {
  return /(^|-)free($|-)/.test(id);
}

export function pickFreeModel(ids: readonly string[], preferred?: string): string | undefined {
  const free = ids.filter(isFreeModel);
  if (!free.length) return undefined;
  if (preferred && free.includes(preferred)) return preferred;
  for (const candidate of FREE_MODEL_PREFERENCE) {
    if (free.includes(candidate)) return candidate;
  }
  return free[0];
}

/** Honour an explicitly configured model when the account advertises it —
 * including paid models such as `hy4`. Otherwise fall back to a free model. */
export function pickModel(ids: readonly string[], preferred?: string): string | undefined {
  if (preferred && ids.includes(preferred)) return preferred;
  return pickFreeModel(ids, preferred);
}

function storedOpencodeKey(): string | undefined {
  try {
    const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
    const auth = JSON.parse(fs.readFileSync(authPath, "utf8")) as {
      opencode?: { key?: string };
    };
    return auth.opencode?.key || undefined;
  } catch {
    return undefined;
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function probeAccount(
  baseUrl: string,
  keys: readonly string[],
  preferredModel?: string,
): Promise<ProbedAccount | null> {
  const url = baseUrl.replace(/\/$/, "");
  for (const apiKey of keys) {
    try {
      const response = await fetch(`${url}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>;
      const ids = (Array.isArray(payload) ? payload : payload.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
      const model = pickModel(ids, preferredModel);
      if (model) {
        return { baseUrl: url, apiKey, model, freeModels: ids.filter(isFreeModel), models: ids };
      }
    } catch {
      // Try the next key / account; startup must never fail because of a probe.
    }
  }
  return null;
}

/** Resolve both accounts: honour an explicitly configured model (e.g. `hy4`)
 * on its account, and remember each account's free sibling for quota fallback. */
export async function resolveOpencodeAccounts(config: OpencodeClientConfig): Promise<OpencodeClientConfig> {
  const storedKey = storedOpencodeKey();
  const goUrl = config.baseUrl.includes("/inference/go/") ? config.baseUrl : OPENCODE_GO_URL;
  const personalUrl = OPENCODE_PERSONAL_URL;

  // The OpenCode Go key usually lives in the env; the personal key may come
  // from the CLI auth store or the fallback env slot. Try in that order,
  // falling back to whichever key actually authenticates each endpoint.
  const goKeys = unique([config.apiKey, storedKey, config.fallback?.apiKey]);
  const personalKeys = unique([storedKey, config.apiKey, config.fallback?.apiKey]);

  const [go, personal] = await Promise.all([
    probeAccount(goUrl, goKeys, config.model),
    probeAccount(personalUrl, personalKeys),
  ]);

  const primary: OpencodeAccountConfig = go
    ? {
        baseUrl: go.baseUrl,
        apiKey: go.apiKey,
        model: go.model,
        freeModel: pickFreeModel(go.freeModels) ?? (isFreeModel(go.model) ? go.model : undefined),
      }
    : { baseUrl: goUrl, apiKey: config.apiKey || storedKey || "", model: config.model };

  const secondarySource = personal && personal.baseUrl !== primary.baseUrl
    ? personal
    : go && go.baseUrl !== primary.baseUrl
      ? go
      : null;
  const fallback: OpencodeAccountConfig | undefined = secondarySource
    ? {
        baseUrl: secondarySource.baseUrl,
        apiKey: secondarySource.apiKey,
        model: pickFreeModel(secondarySource.freeModels) ?? secondarySource.model,
        freeModel: pickFreeModel(secondarySource.freeModels),
      }
    : config.fallback && config.fallback.apiKey
      ? {
          baseUrl: config.fallback.baseUrl || personalUrl,
          apiKey: config.fallback.apiKey,
          model: config.fallback.model || config.model,
          freeModel: config.fallback.freeModel,
        }
      : undefined;

  console.log(
    `[opencode] accounts: go=${primary.model}` +
      (primary.freeModel ? ` (free: ${primary.freeModel})` : "") +
      ` · ${primary.baseUrl.includes("/go/") ? "go" : "personal"}` +
      (fallback ? ` · fallback=${fallback.model}` : " · fallback=none"),
  );

  return {
    baseUrl: primary.baseUrl,
    apiKey: primary.apiKey,
    model: primary.model,
    freeModel: primary.freeModel,
    fallback,
  };
}
