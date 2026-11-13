import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PluginContext } from "@openreel/plugin-sdk";
import { AzureTtsAdapter, buildSsml, localeOfVoice, rateFromSpeed } from "./azure-tts.adapter";

vi.mock("../render/ffmpeg.utils", () => ({
  probeAudioDuration: vi.fn(async () => 0.75),
}));

let dir: string | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("azure-tts helpers", () => {
  it("derives locale from the voice short name", () => {
    expect(localeOfVoice("zh-CN-XiaoxiaoNeural")).toBe("zh-CN");
    expect(localeOfVoice("en-US-JennyNeural")).toBe("en-US");
    expect(localeOfVoice("unknown")).toBe("en-US");
  });

  it("maps speed to prosody rate", () => {
    expect(rateFromSpeed(undefined)).toBe("+0%");
    expect(rateFromSpeed(1)).toBe("+0%");
    expect(rateFromSpeed(1.2)).toBe("+20%");
    expect(rateFromSpeed(0.5)).toBe("-50%");
    expect(rateFromSpeed(5)).toBe("+200%");
  });

  it("builds SSML with voice name, lang and escaped text", () => {
    const ssml = buildSsml("你好 <世界>", "zh-CN-XiaoxiaoNeural", 1.2);
    expect(ssml).toContain("<voice name='zh-CN-XiaoxiaoNeural'>");
    expect(ssml).toContain("xml:lang='zh-CN'");
    expect(ssml).toContain("rate='+20%'");
    expect(ssml).toContain("你好 &lt;世界&gt;");
  });
});

type FetchInit = { headers?: Record<string, string>; body?: string };

describe("azure-tts adapter", () => {
  it("posts SSML to the regional endpoint with the subscription key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: FetchInit) =>
      new Response(Buffer.from([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-azure-"));

    const adapter = new AzureTtsAdapter({ region: "eastasia", apiKey: "az-key" });
    const result = await adapter.synthesize("今天天气好", { voiceId: "zh-CN-XiaoyiNeural" }, { dir, basename: "a1" }, {} as PluginContext);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1");
    expect(init?.headers?.["Ocp-Apim-Subscription-Key"]).toBe("az-key");
    expect(init?.headers?.["X-Microsoft-OutputFormat"]).toBe("audio-24khz-48kbitrate-mono-mp3");
    expect(init?.body).toContain("<voice name='zh-CN-XiaoyiNeural'>");
    expect(init?.body).toContain("今天天气好");
    expect(result.durationSec).toBe(0.75);
    expect(fs.existsSync(result.audioPath)).toBe(true);
  });

  it("voices lists from the voices/list endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      new Response(JSON.stringify([
        { ShortName: "zh-CN-XiaoxiaoNeural", DisplayName: "晓晓", Gender: "Female", Locale: "zh-CN" },
      ]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new AzureTtsAdapter({ region: "eastus", apiKey: "k" });
    const voices = await adapter.voices({} as PluginContext);
    expect(fetchMock.mock.calls[0][0]).toContain("/cognitiveservices/voices/list");
    expect(voices[0].id).toBe("zh-CN-XiaoxiaoNeural");
  });

  it("surfaces a readable error on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota exceeded", { status: 429 })));
    const adapter = new AzureTtsAdapter({ region: "eastus", apiKey: "k" });
    await expect(
      adapter.synthesize("t", { voiceId: "zh-CN-XiaoxiaoNeural" }, { dir: ".", basename: "x" }, {} as PluginContext),
    ).rejects.toThrow(/Azure 配音失败 \(429\)/);
  });

  it("throws a clear message when the key is missing", async () => {
    const adapter = new AzureTtsAdapter({ region: "", apiKey: "" });
    await expect(
      adapter.synthesize("t", { voiceId: "x" }, { dir: ".", basename: "x" }, {} as PluginContext),
    ).rejects.toThrow(/AZURE_SPEECH_KEY/);
  });
});
