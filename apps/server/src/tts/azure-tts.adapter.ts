import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions, TtsVoice } from "@openreel/plugin-sdk";
import { probeAudioDuration } from "../render/ffmpeg.utils";

const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const MP3_BYTES_PER_SEC = 48_000 / 8; // 48 kbit/s CBR, mono

interface AzureVoiceRow {
  ShortName?: string;
  DisplayName?: string;
  Gender?: string;
  Locale?: string;
}

function defaultVoice(): string {
  // Prefer a Chinese neural voice when the caller did not pick one.
  return "zh-CN-XiaoxiaoNeural";
}

/** Derive the SSML xml:lang from the voice short name's locale prefix. */
export function localeOfVoice(voiceName: string): string {
  const parts = voiceName.split("-");
  return parts.length >= 2 ? `${parts[0]}-${parts[1]}` : "en-US";
}

/** Azure prosody rate from the OpenReel speed multiplier. */
export function rateFromSpeed(speed: number | undefined): string {
  if (!Number.isFinite(speed) || Number(speed) <= 0) return "+0%";
  const percent = Math.round((Number(speed) - 1) * 100);
  const clamped = Math.max(-50, Math.min(200, percent));
  return `${clamped >= 0 ? "+" : ""}${clamped}%`;
}

export function buildSsml(text: string, voiceName: string, speed?: number): string {
  const lang = localeOfVoice(voiceName);
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    `<speak version='1.0' xml:lang='${lang}' xmlns='http://www.w3.org/2001/10/synthesis'>` +
    `<voice name='${voiceName}'><prosody rate='${rateFromSpeed(speed)}'>${escaped}</prosody></voice></speak>`
  );
}

export class AzureTtsAdapter implements TtsAdapter {
  readonly id = "azure-tts";
  readonly label = "Azure Speech TTS";

  constructor(private readonly config: { region: string; apiKey: string }) {}

  private apiKey(): string {
    if (!this.config.apiKey) throw new Error("缺少 Azure Speech Key，请设置 AZURE_SPEECH_KEY 与 AZURE_SPEECH_REGION，或使用 mock 配音适配器。");
    return this.config.apiKey;
  }

  private baseUrl(): string {
    const region = this.config.region || "eastus";
    return `https://${region}.tts.speech.microsoft.com`;
  }

  async voices(_ctx: PluginContext): Promise<TtsVoice[]> {
    const res = await fetch(`${this.baseUrl()}/cognitiveservices/voices/list`, {
      headers: { "Ocp-Apim-Subscription-Key": this.apiKey() },
    });
    if (!res.ok) throw new Error(`Azure 音色获取失败 (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const json = await res.json() as AzureVoiceRow[];
    return (Array.isArray(json) ? json : []).map((voice) => ({
      id: String(voice.ShortName ?? ""),
      label: String(voice.DisplayName ?? voice.ShortName ?? "Azure voice"),
      Gender: voice.Gender,
      previewUrl: undefined,
      meta: voice as Record<string, unknown>,
    })).filter((voice) => voice.id);
  }

  async synthesize(
    text: string,
    options: TtsSynthesisOptions,
    out: { dir: string; basename: string },
    _ctx: PluginContext,
  ): Promise<TtsClipResult> {
    const voiceId = options.voiceId || defaultVoice();
    const res = await fetch(`${this.baseUrl()}/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.apiKey(),
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": "OpenReel",
      },
      body: buildSsml(text, voiceId, options.speed),
    });
    if (!res.ok) throw new Error(`Azure 配音失败 (${res.status}): ${(await res.text()).slice(0, 400)}`);
    fs.mkdirSync(out.dir, { recursive: true });
    const audioPath = path.join(out.dir, `${out.basename}.mp3`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(audioPath, buffer);
    let durationSec: number;
    try {
      durationSec = await probeAudioDuration(audioPath);
    } catch {
      // audio-24khz-48kbitrate-mono-mp3 is CBR at 48 kbit/s.
      durationSec = Math.max(0.05, buffer.byteLength * 8 / MP3_BYTES_PER_SEC);
    }
    return { audioPath, durationSec, voiceId, text };
  }
}
