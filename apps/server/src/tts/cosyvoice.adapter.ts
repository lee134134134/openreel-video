import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions, TtsVoice } from "@openreel/plugin-sdk";
import { probeAudioDuration, run } from "../render/ffmpeg.utils";

/** Natural-language emotion instructions for the CosyVoice instruct2 mode.
 * Keys match the plan-style tokens the proposal LLM already emits. */
export const COSYVOICE_EMOTION_INSTRUCTIONS: Readonly<Record<string, string>> = {
  cheerful: "用开心愉悦的语气说这句话",
  friendly: "用友好亲切的语气说这句话",
  gentle: "用温柔轻柔的语气说这句话",
  calm: "用平静沉稳的语气说这句话",
  serious: "用严肃认真的语气说这句话",
  sad: "用低落伤感的语气说这句话",
  angry: "用愤怒不满的语气说这句话",
  fearful: "用紧张害怕的语气说这句话",
  lyrical: "用抒情柔美的语气说这句话",
  affectionate: "用深情温暖的语气说这句话",
  empathetic: "用体贴共情的语气说这句话",
  "documentary-narration": "用纪录片旁白的沉稳语气说这句话",
  newscast: "用新闻播报的专业语气说这句话",
  whispering: "用轻声耳语的语气说这句话",
};

export function cosyvoiceUrl(): string {
  return process.env.COSYVOICE_URL || "http://127.0.0.1:8766";
}

/** Availability: an explicit COSYVOICE_URL (remote/Colab) or a local setup
 * marker created by services/cosyvoice/setup.sh. */
export function cosyvoiceAvailable(): boolean {
  if (process.env.COSYVOICE_URL) return true;
  const candidates = [
    path.resolve(process.cwd(), "services/cosyvoice"),
    path.resolve(process.cwd(), "../services/cosyvoice"),
    path.resolve(process.cwd(), "../../services/cosyvoice"),
    path.resolve(process.cwd(), "../../../services/cosyvoice"),
  ];
  return candidates.some((dir) => fs.existsSync(path.join(dir, ".ready")));
}

/** Map the plan emotion token to a natural-language instruction; a free-form
 * Chinese instruction (e.g. "用激动的语气说这句话") also passes through. */
export function cosyvoiceInstruction(options: TtsSynthesisOptions): string | undefined {
  const emotion = String(options.emotion ?? process.env.COSYVOICE_STYLE ?? "").trim();
  if (!emotion) return undefined;
  const lower = emotion.toLowerCase();
  const base = COSYVOICE_EMOTION_INSTRUCTIONS[lower];
  if (base) {
    const degree = Number(options.styleDegree ?? 1);
    if (Number.isFinite(degree) && degree >= 1.3) return `${base}，情绪要强烈一些`;
    if (Number.isFinite(degree) && degree > 0 && degree <= 0.8) return `${base}，情绪含蓄一些`;
    return base;
  }
  // Free-form instruction: bounded CJK/Latin text is used verbatim.
  return /^[\p{Script=Han}a-zA-Z0-9\s，。！？、·-]{2,40}$/u.test(emotion) ? emotion : undefined;
}

/** Open-source local neural TTS (CosyVoice3/CosyVoice2, Apache-2.0) with
 * natural-language emotion instructions, served by services/cosyvoice. */
export class CosyvoiceTtsAdapter implements TtsAdapter {
  readonly id = "cosyvoice-tts";
  readonly label = "CosyVoice 本地神经语音（开源 · 情绪指令）";

  async voices(_ctx: PluginContext): Promise<TtsVoice[]> {
    return [{ id: "default", label: `默认音色（${process.env.COSYVOICE_PROMPT_WAV ? "自定义参考音" : "内置 zero-shot 参考音"}）` }];
  }

  async synthesize(
    text: string,
    options: TtsSynthesisOptions,
    out: { dir: string; basename: string },
    _ctx: PluginContext,
  ): Promise<TtsClipResult> {
    fs.mkdirSync(out.dir, { recursive: true });
    const rawPath = path.join(out.dir, `${out.basename}.raw.wav`);
    const wavPath = path.join(out.dir, `${out.basename}.wav`);
    const payload = {
      text,
      instruction: cosyvoiceInstruction(options),
      speed: options.speed,
      promptWav: process.env.COSYVOICE_PROMPT_WAV,
    };
    let res: Response;
    try {
      res = await fetch(`${cosyvoiceUrl()}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300_000),
      });
    } catch (err) {
      const detail = String((err as Error)?.message ?? err);
      throw new Error(`CosyVoice 服务不可达（${cosyvoiceUrl()}），请先启动服务：cd services/cosyvoice && ./venv/bin/python serve.py : ${detail.slice(-200)}`);
    }
    if (!res.ok) throw new Error(`CosyVoice 合成失败 (${res.status}): ${(await res.text()).slice(0, 400)}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(rawPath, buffer);

    // Normalize to 48 kHz mono wav so the compose pipeline sees consistent audio.
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    const convert = await run(["-y", "-i", rawPath, "-ac", "1", "-ar", "48000", wavPath], {
      command: ffmpegPath,
      timeoutSec: 60,
    });
    fs.rmSync(rawPath, { force: true });
    if (convert.code !== 0 || !fs.existsSync(wavPath)) {
      throw new Error(`CosyVoice 语音转码失败: ${convert.stderr.slice(-300)}`);
    }
    const durationSec = await probeAudioDuration(wavPath).catch(() => 1.5);
    return { audioPath: wavPath, durationSec, voiceId: options.voiceId || "cosyvoice", text };
  }
}
