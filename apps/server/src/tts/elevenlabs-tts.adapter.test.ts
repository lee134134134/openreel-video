import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PluginContext } from "@openreel/plugin-sdk";
import { ElevenLabsTtsAdapter } from "./elevenlabs-tts.adapter";
import { probeAudioDuration } from "../render/ffmpeg.utils";

vi.mock("../render/ffmpeg.utils", () => ({
  probeAudioDuration: vi.fn(async () => 3.5),
}));

let dir: string | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(probeAudioDuration).mockReset();
  vi.mocked(probeAudioDuration).mockResolvedValue(3.5);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function tempDir(): string {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-eleven-"));
  return dir;
}

describe("ElevenLabsTtsAdapter", () => {
  it("requires an API key before calling the service", async () => {
    const adapter = new ElevenLabsTtsAdapter({ apiKey: "" });
    await expect(
      adapter.synthesize("你好", { voiceId: "v1" }, { dir: tempDir(), basename: "a" }, {} as PluginContext),
    ).rejects.toThrow(/ELEVENLABS_API_KEY/);
  });

  it("posts text and model to the chosen voice and writes an mp3", async () => {
    const fetchMock = vi.fn(async () => new Response(Buffer.from("mp3-bytes"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = tempDir();
    const adapter = new ElevenLabsTtsAdapter({ apiKey: "key-1" });
    const result = await adapter.synthesize(
      "欢迎收看",
      { voiceId: "voice-9" },
      { dir: out, basename: "clip" },
      {} as PluginContext,
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toContain("/v1/text-to-speech/voice-9");
    expect(String(url)).toContain("output_format=mp3_44100_128");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("key-1");
    expect(JSON.parse(String(init.body))).toMatchObject({ text: "欢迎收看", model_id: "eleven_flash_v2_5" });
    expect(result.audioPath).toBe(path.join(out, "clip.mp3"));
    expect(fs.readFileSync(result.audioPath, "utf8")).toBe("mp3-bytes");
    expect(result.durationSec).toBe(3.5);
    expect(result.voiceId).toBe("voice-9");
  });

  it("estimates duration from the CBR bitrate when ffprobe fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.alloc(16_000), { status: 200 })));
    vi.mocked(probeAudioDuration).mockRejectedValueOnce(new Error("ffprobe missing"));
    const out = tempDir();
    const adapter = new ElevenLabsTtsAdapter({ apiKey: "key-1" });
    const result = await adapter.synthesize("x", { voiceId: "v" }, { dir: out, basename: "c" }, {} as PluginContext);
    // 16000 bytes at 128 kbps = 1 second.
    expect(result.durationSec).toBeCloseTo(1, 5);
  });

  it("surfaces service errors with status and body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota exceeded", { status: 401 })));
    const adapter = new ElevenLabsTtsAdapter({ apiKey: "bad" });
    await expect(
      adapter.synthesize("x", { voiceId: "v" }, { dir: tempDir(), basename: "c" }, {} as PluginContext),
    ).rejects.toThrow(/ElevenLabs 配音失败 \(401\): quota exceeded/);
  });

  it("lists voices from /v2/voices and drops entries without ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            voices: [
              { voice_id: "v1", name: "Rachel", preview_url: "https://x/p.mp3" },
              { name: "broken" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const adapter = new ElevenLabsTtsAdapter({ apiKey: "key" });
    await expect(adapter.voices({} as PluginContext)).resolves.toEqual([
      { id: "v1", label: "Rachel", previewUrl: "https://x/p.mp3", meta: { voice_id: "v1", name: "Rachel", preview_url: "https://x/p.mp3" } },
    ]);
  });
});
