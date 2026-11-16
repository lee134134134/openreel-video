import { describe, expect, it } from "vitest";
import { selectPreferredTts, TTS_ADAPTER_PRIORITY } from "./adapter-context";
import type { TtsAdapter } from "@openreel/plugin-sdk";
import { MockTtsAdapter } from "./mock-tts.adapter";
import { ElevenLabsTtsAdapter } from "./elevenlabs-tts.adapter";
import { OpenAiTtsAdapter } from "./openai-tts.adapter";
import { AzureTtsAdapter } from "./azure-tts.adapter";
import { MacosSayTtsAdapter } from "./macos-say.adapter";
import { EdgeTtsAdapter } from "./edge-tts.adapter";

function registry() {
  return [
    new MockTtsAdapter(),
    new ElevenLabsTtsAdapter({ apiKey: "k" }),
    new OpenAiTtsAdapter({ apiKey: "k" }),
    new AzureTtsAdapter({ region: "eastus", apiKey: "k" }),
  ];
}

describe("selectPreferredTts", () => {
  it("prefers elevenlabs when its key is set", () => {
    const adapter = selectPreferredTts(registry(), { ELEVENLABS_API_KEY: "x" });
    expect(adapter.id).toBe("elevenlabs");
  });

  it("falls back to openai-tts, then azure-tts, then mock", () => {
    expect(selectPreferredTts(registry(), { OPENAI_API_KEY: "x" }).id).toBe("openai-tts");
    expect(
      selectPreferredTts(registry(), { AZURE_SPEECH_KEY: "x", AZURE_SPEECH_REGION: "eastus" }).id,
    ).toBe("azure-tts");
    expect(selectPreferredTts(registry(), {}).id).toBe("mock");
  });

  it("azure needs both region and key", () => {
    expect(selectPreferredTts(registry(), { AZURE_SPEECH_KEY: "x" }).id).toBe("mock");
  });

  it("returns the first adapter when no mock exists", () => {
    const withoutMock = registry().filter((adapter) => adapter.id !== "mock");
    expect(selectPreferredTts(withoutMock, {}).id).toBe("elevenlabs");
  });

  it("falls back to macos-say before mock when registered", () => {
    const adapters: TtsAdapter[] = registry().map((adapter) => adapter);
    adapters.splice(1, 0, new MacosSayTtsAdapter());
    expect(selectPreferredTts(adapters, {}).id).toBe("macos-say");
    expect(selectPreferredTts(adapters, { ELEVENLABS_API_KEY: "x" }).id).toBe("elevenlabs");
  });

  it("declares the priority order", () => {
    expect(TTS_ADAPTER_PRIORITY.map((entry) => entry.id)).toEqual([
      "elevenlabs",
      "openai-tts",
      "azure-tts",
      "edge-tts",
      "macos-say",
    ]);
  });

  it("prefers edge-tts over macos-say when no cloud key is set", () => {
    const adapters: TtsAdapter[] = [...registry(), new EdgeTtsAdapter()];
    expect(selectPreferredTts(adapters, {}).id).toBe("edge-tts");
  });

  it("keeps cloud priority when configured keys exist", () => {
    const adapters: TtsAdapter[] = [...registry(), new EdgeTtsAdapter()];
    const env = {
      ELEVENLABS_API_KEY: "x",
      OPENAI_API_KEY: "x",
      AZURE_SPEECH_KEY: "x",
      AZURE_SPEECH_REGION: "eastus",
    };
    expect(selectPreferredTts(adapters, env).id).toBe("elevenlabs");
  });
});
