import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions } from "@openreel/plugin-sdk";
import type { TtsRegistry } from "../registry/registry.module";

export const builtinTtsContext = {} as PluginContext;

/** Cloud adapters in preference order; macos-say is the free real-voice
 * fallback on darwin hosts, mock is the offline tone generator. */
export const TTS_ADAPTER_PRIORITY: readonly { id: string; envKeys: string[] }[] = [
  { id: "elevenlabs", envKeys: ["ELEVENLABS_API_KEY"] },
  { id: "openai-tts", envKeys: ["OPENAI_API_KEY"] },
  { id: "azure-tts", envKeys: ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"] },
  { id: "macos-say", envKeys: [] },
];

/**
 * Pick the highest-priority adapter whose required configuration is present.
 * Pure function (env passed in) so the priority can be unit-tested.
 */
export function selectPreferredTts(
  adapters: readonly TtsAdapter[],
  env: Record<string, string | undefined>,
): TtsAdapter {
  const mock = adapters.find((adapter) => adapter.id === "mock");
  for (const preference of TTS_ADAPTER_PRIORITY) {
    const configured = preference.envKeys.every((key) => Boolean(env[key]));
    if (!configured) continue;
    const adapter = adapters.find((item) => item.id === preference.id);
    if (adapter) return adapter;
  }
  return mock ?? adapters[0];
}

export function resolveTts(registry: TtsRegistry, adapterId?: string): TtsAdapter {
  if (adapterId) {
    const adapter = registry.list().find((item) => item.id === adapterId);
    if (!adapter) throw new Error(`未找到配音适配器: ${adapterId}`);
    return adapter;
  }
  return selectPreferredTts(registry.list(), process.env as Record<string, string | undefined>);
}

export function synthesizeDefault(
  registry: TtsRegistry,
  text: string,
  options: TtsSynthesisOptions,
  out: { dir: string; basename: string },
): Promise<TtsClipResult> {
  return resolveTts(registry).synthesize(text, options, out, builtinTtsContext);
}
