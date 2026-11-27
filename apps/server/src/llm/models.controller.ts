import { Controller, Get } from "@nestjs/common";
import { OpencodeClient, type OpencodeAccountConfig } from "./opencode.client";
import { isFreeModel } from "./opencode-free-models";

interface ModelOption {
  id: string;
  label: string;
}

const MODEL_CACHE_MS = 60_000;

function withoutProviderPrefix(value: string): string {
  const slash = value.indexOf("/");
  return slash >= 0 && slash < value.length - 1 ? value.slice(slash + 1) : value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function modelOptions(payload: unknown): ModelOption[] {
  const root = asRecord(payload);
  const entries = Array.isArray(payload) ? payload : root?.data;
  if (!Array.isArray(entries)) return [];

  const models: ModelOption[] = [];
  for (const entry of entries) {
    const model = asRecord(entry);
    if (!model || typeof model.id !== "string" || !model.id.trim()) continue;
    const id = withoutProviderPrefix(model.id.trim());
    const rawLabel = [model.label, model.name].find((value) => typeof value === "string" && value.trim());
    const label = withoutProviderPrefix(typeof rawLabel === "string" ? rawLabel.trim() : id);
    models.push({ id, label });
  }
  return models;
}

/** Available gateway models, cached briefly to protect the provider endpoint. */
@Controller("llm")
export class ModelsController {
  private cache?: { expiresAt: number; models: ModelOption[] };

  constructor(private readonly client: OpencodeClient) {}

  @Get("models")
  async models(): Promise<ModelOption[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.models;

    const accounts = [this.client.config, this.client.fallback].filter(
      (config): config is OpencodeAccountConfig => Boolean(config),
    );
    const lists = await Promise.all(accounts.map((account) => this.fetchModels(account)));
    const merged = new Map<string, ModelOption>();
    for (const models of lists) {
      for (const model of models) merged.set(model.id, model);
    }
    const all = [...merged.values()].sort((left, right) => {
      const freeDifference = Number(isFreeModel(right.id)) - Number(isFreeModel(left.id));
      return freeDifference || left.label.localeCompare(right.label);
    });
    this.cache = { models: all, expiresAt: Date.now() + MODEL_CACHE_MS };
    return all;
  }

  private async fetchModels(account: OpencodeAccountConfig): Promise<ModelOption[]> {
    try {
      const response = await fetch(`${account.baseUrl.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${account.apiKey}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return [];
      return modelOptions((await response.json()) as unknown);
    } catch {
      return [];
    }
  }
}
