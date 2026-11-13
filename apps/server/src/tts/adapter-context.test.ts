import { describe, expect, it } from "vitest";
import { selectPreferredTts, TTS_ADAPTER_PRIORITY } from "./adapter-context";
import { MockTtsAdapter } from "./mock-tts.adapter";
import { ElevenLabsTtsAdapter } from "./elevenlabs-tts.adapter";
import { OpenAiTtsAdapter } from "./openai-tts.adapter";
import { AzureTtsAdapter } from "./azure-tts.adapter";

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

  it("declares the priority order", () => {
    expect(TTS_ADAPTER_PRIORITY.map((entry) => entry.id)).toEqual([
      "elevenlabs",
      "openai-tts",
      "azure-tts",
    ]);
  });
});
