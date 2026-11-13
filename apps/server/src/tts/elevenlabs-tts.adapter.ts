import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions, TtsVoice } from "@openreel/plugin-sdk";
import { probeAudioDuration } from "../render/ffmpeg.utils";

export class ElevenLabsTtsAdapter implements TtsAdapter {
  readonly id = "elevenlabs";
  readonly label = "ElevenLabs";

  constructor(private readonly config: { apiKey: string }) {}

  private apiKey(): string {
    if (!this.config.apiKey) throw new Error("缺少 ElevenLabs API Key，请设置 ELEVENLABS_API_KEY，或使用 mock 配音适配器。");
    return this.config.apiKey;
  }

  async voices(_ctx: PluginContext): Promise<TtsVoice[]> {
    const res = await fetch("https://api.elevenlabs.io/v2/voices", {
      headers: { "xi-api-key": this.apiKey() },
    });
    if (!res.ok) throw new Error(`ElevenLabs 音色获取失败 (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const json = await res.json() as { voices?: Array<Record<string, unknown>> };
    return (json.voices ?? []).map((voice) => ({
      id: String(voice.voice_id ?? voice.id ?? ""),
      label: String(voice.name ?? voice.voice_id ?? "ElevenLabs voice"),
      previewUrl: voice.preview_url ? String(voice.preview_url) : undefined,
      meta: voice,
    })).filter((voice) => voice.id);
  }

  async synthesize(
    text: string,
    options: TtsSynthesisOptions,
    out: { dir: string; basename: string },
    _ctx: PluginContext,
  ): Promise<TtsClipResult> {
    const voiceId = options.voiceId || "21m00Tcm4TlvDq8ikWAM";
    const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
    url.searchParams.set("output_format", "mp3_44100_128");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": this.apiKey() },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    });
    if (!res.ok) throw new Error(`ElevenLabs 配音失败 (${res.status}): ${(await res.text()).slice(0, 400)}`);
    fs.mkdirSync(out.dir, { recursive: true });
    const audioPath = path.join(out.dir, `${out.basename}.mp3`);
    fs.writeFileSync(audioPath, Buffer.from(await res.arrayBuffer()));
    let durationSec: number;
    try {
      durationSec = await probeAudioDuration(audioPath);
    } catch {
      // mp3_44100_128 is CBR; this is only a fallback for missing/broken ffprobe.
      durationSec = (fs.statSync(audioPath).size * 8) / 128000;
    }
    return { audioPath, durationSec, voiceId, text };
  }
}
