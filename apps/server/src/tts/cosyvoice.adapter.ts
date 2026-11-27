import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions, TtsVoice } from "@openreel/plugin-sdk";
import { probeAudioDuration, run } from "../render/ffmpeg.utils";

/** Natural-language emotion instructions for the CosyVoice instruct2 mode.
 * Keys match the plan-style tokens the proposal LLM already emits.
 *
 * Phrasing follows CosyVoice3's own `instruct_list` (Please/请用…说一句话),
 * which is the form the model was supervised on. The previous "用…说这句话"
 * wording is semantically fine but off-distribution and reads less naturally.
 * `serve.py` adds the "You are a helpful assistant." prefix and end-of-prompt
 * token, so keep these strings short and free of the assistant prefix. */
export const COSYVOICE_EMOTION_INSTRUCTIONS: Readonly<Record<string, string>> = {
  cheerful: "请非常开心地说一句话",
  friendly: "请用友好、亲切的语气说一句话",
  gentle: "请用温柔、轻柔的语气说一句话",
  calm: "请用尽可能慢地语速说一句话",
  serious: "请用严肃、稳重的语气说一句话",
  sad: "请非常伤心地说一句话",
  angry: "请非常生气地说一句话",
  fearful: "请用紧张、不安的语气说一句话",
  lyrical: "请用抒情、柔美的语气说一句话",
  affectionate: "请用深情、温暖的语气说一句话",
  empathetic: "请用体贴、共情的语气说一句话",
  "documentary-narration": "请用沉稳大气、从容克制的语气说一句话，语速稍慢",
  newscast: "请用新闻播报的语气说一句话",
  whispering: "Please say a sentence in a very soft voice.",
};

/** Steady default delivery when the plan gives no emotion: composed, unhurried,
 * articulate — so generated narration never falls back to a flat/light read. */
export const DEFAULT_COSYVOICE_INSTRUCTION = "请用沉稳、从容的语气说一句话，语速稍慢";

/** COSYVOICE_LOCK_STEADY=1 pins every synthesis to the steady preset
 * (composed instruction + calmer default speed), ignoring per-scene emotion
 * and explicit speed so the dub voice stays identical across videos. */
export function cosyvoiceSteadyLocked(): boolean {
  return /^(1|true|yes)$/i.test(String(process.env.COSYVOICE_LOCK_STEADY ?? "").trim());
}

/** Default speech rate; < 1 sounds calmer and more composed. */
export function cosyvoiceDefaultSpeed(): number {
  const raw = Number(process.env.COSYVOICE_SPEED ?? 0.95);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.95;
}

/** Loudness normalization applied after synthesis. CosyVoice output lands
 * around -23 LUFS, which plays back noticeably quiet; -16 LUFS / -1.5 dBTP is
 * the broadcast/web-video speech target. Set COSYVOICE_LOUDNORM to an ffmpeg
 * loudnorm spec, or to an empty string to disable. */
export function cosyvoiceLoudnormFilter(): string {
  const custom = process.env.COSYVOICE_LOUDNORM;
  if (custom !== undefined) return custom.trim();
  return "loudnorm=I=-16:TP=-1.5:LRA=11";
}

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
    // Only append a Chinese intensity hint to Chinese instructions (the
    // whispering preset is English and would read oddly with a Chinese tail).
    const cjk = /[\p{Script=Han}]/u.test(base);
    if (cjk && Number.isFinite(degree) && degree >= 1.3) return `${base}，情绪再强烈一些`;
    if (cjk && Number.isFinite(degree) && degree > 0 && degree <= 0.8) return `${base}，情绪更含蓄一些`;
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
    const locked = cosyvoiceSteadyLocked();
    const payload = {
      text,
      instruction: locked
        ? process.env.COSYVOICE_STYLE?.trim() || DEFAULT_COSYVOICE_INSTRUCTION
        : cosyvoiceInstruction(options) ?? DEFAULT_COSYVOICE_INSTRUCTION,
      speed: locked ? cosyvoiceDefaultSpeed() : options.speed ?? cosyvoiceDefaultSpeed(),
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

    // Normalize to 48 kHz mono wav and lift the level to the speech target so
    // the compose pipeline (which mixes at volume=1) hears a consistent track.
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    const loudnorm = cosyvoiceLoudnormFilter();
    const convertArgs = ["-y", "-i", rawPath];
    if (loudnorm) convertArgs.push("-af", loudnorm);
    convertArgs.push("-ac", "1", "-ar", "48000", wavPath);
    const convert = await run(convertArgs, {
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
