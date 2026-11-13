import { Controller, Get } from "@nestjs/common";
import { SettingsService } from "../config/settings.module";

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
@Controller("api/llm")
export class ModelsController {
  private cache?: { expiresAt: number; models: ModelOption[] };

  constructor(private readonly settings: SettingsService) {}

  @Get("models")
  async models(): Promise<ModelOption[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.models;

    const config = this.settings.settings.opencode;
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      if (!response.ok) return [];
      const models = modelOptions((await response.json()) as unknown);
      this.cache = { models, expiresAt: Date.now() + MODEL_CACHE_MS };
      return models;
    } catch {
      return [];
    }
  }
}
