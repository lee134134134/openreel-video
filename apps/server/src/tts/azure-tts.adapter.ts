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

/** Emotion styles commonly available on zh-CN neural voices (Xiaoxiao et al.).
 * A voice that lacks a given style rejects it with a 400 — callers may filter
 * against the plan-safe subset below. */
export const AZURE_TTS_STYLES = [
  "affectionate", "angry", "assistant", "calm", "chat", "cheerful", "customerservice",
  "depressed", "disgruntled", "documentary-narration", "embarrassed", "empathetic",
  "envious", "fearful", "friendly", "gentle", "lyrical", "narration-professional",
  "newscast", "newscast-casual", "petulant", "poetic-reading", "sad", "serious",
  "sorry", "sports-commentary", "sports-commentary-excited", "whispering",
] as const;

/** Curated subset offered to the plan LLM and validated in plan JSON (broad
 * zh-CN voice support, natural for short-video narration). */
export const AZURE_TTS_PLAN_STYLES = [
  "cheerful", "friendly", "gentle", "calm", "serious", "sad", "angry",
  "fearful", "lyrical", "affectionate", "empathetic", "documentary-narration",
  "newscast", "whispering",
] as const;

/** Keep plain lower-case style tokens; drop anything else outright. */
function sanitizeStyle(raw: string | undefined): string | undefined {
  const style = String(raw ?? "").trim().toLowerCase();
  return /^[a-z][a-z-]{1,31}$/.test(style) ? style : undefined;
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

export function buildSsml(text: string, voiceName: string, speed?: number, style?: string, styleDegree?: number): string {
  const lang = localeOfVoice(voiceName);
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const expressAs = style
    ? `<mstts:express-as style='${style}'${styleDegree !== undefined ? ` styledegree='${styleDegree}'` : ""}>`
    : "";
  const expressClose = style ? "</mstts:express-as>" : "";
  return (
    `<speak version='1.0' xml:lang='${lang}' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts'>` +
    `<voice name='${voiceName}'>${expressAs}<prosody rate='${rateFromSpeed(speed)}'>${escaped}</prosody>${expressClose}</voice></speak>`
  );
}

export class AzureTtsAdapter implements TtsAdapter {
  readonly id = "azure-tts";
  readonly label = "Azure 神经语音（情绪表达 · 免费额度）";

  constructor(private readonly config: { region: string; apiKey: string }) {}

  private apiKey(): string {
    if (!this.config.apiKey) throw new Error("缺少 Azure Speech Key，请设置 AZURE_SPEECH_KEY 与 AZURE_SPEECH_REGION，或使用 mock 配音适配器。");
    return this.config.apiKey;
  }

  private baseUrl(): string {
    const region = this.config.region || "eastus";
    return `https://${region}.tts.speech.microsoft.com`;
  }

  /** Emotion style for a synthesis call: the per-request value wins, then the
   * AZURE_TTS_STYLE env default; styledegree clamps to Azure's 0.01..2 range. */
  private styleFor(options: TtsSynthesisOptions): { style?: string; styleDegree?: number } {
    const style = sanitizeStyle(options.emotion) ?? sanitizeStyle(process.env.AZURE_TTS_STYLE);
    if (!style) return {};
    const raw = options.styleDegree ?? Number(process.env.AZURE_TTS_STYLE_DEGREE);
    const styleDegree = Number.isFinite(raw) && raw > 0
      ? Math.round(Math.min(2, Math.max(0.01, Number(raw))) * 100) / 100
      : undefined;
    return { style, styleDegree };
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
    const { style, styleDegree } = this.styleFor(options);
    const res = await fetch(`${this.baseUrl()}/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": this.apiKey(),
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
        "User-Agent": "OpenReel",
      },
      body: buildSsml(text, voiceId, options.speed, style, styleDegree),
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
