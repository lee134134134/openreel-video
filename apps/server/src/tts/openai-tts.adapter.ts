import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions, TtsVoice } from "@openreel/plugin-sdk";
import { probeAudioDuration } from "../render/ffmpeg.utils";

const SAMPLE_RATE = 24_000; // gpt-4o-mini-tts wav output
const BYTES_PER_SEC = SAMPLE_RATE * 2; // 16-bit mono

/** Base URL override lets OpenAI-compatible gateways (proxy relays,
 * aggregators) serve /audio/speech without code changes. */
const ttsBaseUrl = (): string =>
  (process.env.OPENAI_TTS_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const ttsModel = (): string => process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";

/** OpenAI voices are a fixed set; no list endpoint is exposed. */
export const OPENAI_TTS_VOICES: readonly { id: string; label: string }[] = [
  { id: "alloy", label: "Alloy" },
  { id: "ash", label: "Ash" },
  { id: "ballad", label: "Ballad" },
  { id: "coral", label: "Coral" },
  { id: "echo", label: "Echo" },
  { id: "fable", label: "Fable" },
  { id: "onyx", label: "Onyx" },
  { id: "nova", label: "Nova" },
  { id: "sage", label: "Sage" },
  { id: "shimmer", label: "Shimmer" },
];

export class OpenAiTtsAdapter implements TtsAdapter {
  readonly id = "openai-tts";
  readonly label = "OpenAI TTS";

  constructor(private readonly config: { apiKey: string }) {}

  private apiKey(): string {
    if (!this.config.apiKey) throw new Error("缺少 OpenAI API Key，请设置 OPENAI_API_KEY，或使用 mock 配音适配器。");
    return this.config.apiKey;
  }

  async voices(_ctx: PluginContext): Promise<TtsVoice[]> {
    return OPENAI_TTS_VOICES.map((voice) => ({ id: voice.id, label: voice.label }));
  }

  async synthesize(
    text: string,
    options: TtsSynthesisOptions,
    out: { dir: string; basename: string },
    _ctx: PluginContext,
  ): Promise<TtsClipResult> {
    const voiceId = options.voiceId || "alloy";
    // WAV output keeps the duration fallback exact (16-bit mono @ 24 kHz).
    const body: Record<string, unknown> = {
      model: ttsModel(),
      voice: voiceId,
      input: text,
      response_format: "wav",
    };
    if (Number.isFinite(options.speed) && Number(options.speed) > 0) {
      body.speed = Math.max(0.25, Math.min(4, Number(options.speed)));
    }
    const res = await fetch(`${ttsBaseUrl()}/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey()}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`OpenAI 配音失败 (${res.status}): ${(await res.text()).slice(0, 400)}`);
    fs.mkdirSync(out.dir, { recursive: true });
    const audioPath = path.join(out.dir, `${out.basename}.wav`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(audioPath, buffer);
    let durationSec: number;
    try {
      durationSec = await probeAudioDuration(audioPath);
    } catch {
      durationSec = Math.max(0.05, (buffer.byteLength - 44) / BYTES_PER_SEC);
    }
    return { audioPath, durationSec, voiceId, text };
  }
}
