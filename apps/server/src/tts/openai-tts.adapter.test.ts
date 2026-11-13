import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PluginContext } from "@openreel/plugin-sdk";
import { OpenAiTtsAdapter, OPENAI_TTS_VOICES } from "./openai-tts.adapter";

vi.mock("../render/ffmpeg.utils", () => ({
  probeAudioDuration: vi.fn(async () => 1.23),
}));

let dir: string | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const fakeWav = (seconds: number): Buffer => {
  const dataSize = Math.round(seconds * 24_000) * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  return wav;
};

describe("openai-tts adapter", () => {
  it("voices returns the static catalog", async () => {
    const voices = await new OpenAiTtsAdapter({ apiKey: "k" }).voices({} as PluginContext);
    expect(voices.length).toBe(OPENAI_TTS_VOICES.length);
    expect(voices.map((voice) => voice.id)).toContain("alloy");
  });

  it("posts model/voice/input to the speech endpoint with a bearer token", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: { method?: string; headers?: Record<string, string>; body?: string }) =>
      new Response(fakeWav(1), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-openai-"));

    const adapter = new OpenAiTtsAdapter({ apiKey: "sk-test" });
    const result = await adapter.synthesize("你好世界", { voiceId: "nova" }, { dir, basename: "a1" }, {} as PluginContext);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init?.method).toBe("POST");
    expect(init?.headers?.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init?.body ?? "{}");
    expect(body.model).toBe("gpt-4o-mini-tts");
    expect(body.voice).toBe("nova");
    expect(body.input).toBe("你好世界");
    expect(body.response_format).toBe("wav");
    expect(result.voiceId).toBe("nova");
    expect(result.durationSec).toBe(1.23);
    expect(fs.readFileSync(result.audioPath)).toEqual(fakeWav(1));
  });

  it("passes speed through and clamps outside 0.25..4", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: { body?: string }) => new Response(fakeWav(1), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-openai-"));
    const adapter = new OpenAiTtsAdapter({ apiKey: "k" });
    await adapter.synthesize("t", { voiceId: "alloy", speed: 9 }, { dir, basename: "b1" }, {} as PluginContext);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body ?? "{}").speed).toBe(4);
  });

  it("surfaces a readable error on 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const adapter = new OpenAiTtsAdapter({ apiKey: "bad" });
    await expect(
      adapter.synthesize("t", { voiceId: "alloy" }, { dir: ".", basename: "x" }, {} as PluginContext),
    ).rejects.toThrow(/OpenAI 配音失败 \(401\)/);
  });

  it("throws a clear message when the key is missing", async () => {
    const adapter = new OpenAiTtsAdapter({ apiKey: "" });
    await expect(
      adapter.synthesize("t", { voiceId: "alloy" }, { dir: ".", basename: "x" }, {} as PluginContext),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });
});
