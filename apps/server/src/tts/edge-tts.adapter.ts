import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions, TtsVoice } from "@openreel/plugin-sdk";
import { probeAudioDuration, run } from "../render/ffmpeg.utils";

const execFileAsync = promisify(execFile);

export const EDGE_TTS_VOICES: readonly { id: string; label: string }[] = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓（女 · 温暖自然）" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊（女 · 年轻活泼）" },
  { id: "zh-CN-YunxiNeural", label: "云希（男 · 阳光自然）" },
  { id: "zh-CN-YunjianNeural", label: "云健（男 · 激情浑厚）" },
  { id: "zh-CN-YunxiaNeural", label: "云夏（男 · 可爱少年音）" },
  { id: "zh-CN-YunyangNeural", label: "云扬（男 · 专业播报）" },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北（女 · 东北话幽默）" },
  { id: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮（女 · 陕西方言）" },
  { id: "en-US-AriaNeural", label: "Aria（女 · 英语）" },
  { id: "en-US-JennyNeural", label: "Jenny（女 · 英语）" },
];

const DEFAULT_VOICE = process.env.EDGE_TTS_VOICE || "zh-CN-XiaoxiaoNeural";

function hasEdgePython(dir: string): boolean {
  return fs.existsSync(path.join(dir, "venv", "bin", "python"));
}

/** Locate the tiny edge-tts venv (created by services/edge-tts/setup.sh). */
export function resolveEdgeServiceDir(): string | null {
  const override = process.env.EDGE_TTS_PYTHON;
  if (override && fs.existsSync(override)) return path.dirname(path.dirname(override));
  const candidates = [
    path.resolve(process.cwd(), "services/edge-tts"),
    path.resolve(process.cwd(), "../services/edge-tts"),
    path.resolve(process.cwd(), "../../services/edge-tts"),
    path.resolve(process.cwd(), "../../../services/edge-tts"),
  ];
  for (const candidate of candidates) {
    if (hasEdgePython(candidate)) return candidate;
  }
  return null;
}

/** Repo checkout ships setup.sh, so first use can self-install the client. */
export function edgeTtsAvailable(): boolean {
  if (resolveEdgeServiceDir() !== null) return true;
  const override = process.env.EDGE_TTS_SERVICE_DIR;
  if (override && fs.existsSync(path.join(override, "setup.sh"))) return true;
  const candidates = [
    path.resolve(process.cwd(), "services/edge-tts"),
    path.resolve(process.cwd(), "../services/edge-tts"),
    path.resolve(process.cwd(), "../../services/edge-tts"),
    path.resolve(process.cwd(), "../../../services/edge-tts"),
  ];
  return candidates.some((candidate) => fs.existsSync(path.join(candidate, "setup.sh")));
}

function edgePython(): string {
  const override = process.env.EDGE_TTS_PYTHON;
  if (override && fs.existsSync(override)) return override;
  const dir = resolveEdgeServiceDir();
  if (dir) return path.join(dir, "venv", "bin", "python");
  return "python3";
}

function setupMessage(): string {
  return "Edge TTS 未安装：请先运行 bash services/edge-tts/setup.sh（纯 Python 客户端，几秒完成），然后重启服务。";
}

/** Microsoft Edge online neural TTS (same voices as Azure neural, free,
 * no API key). Runs the `edge-tts` Python client locally; synthesis itself
 * happens on Microsoft's service, so it needs internet access. */
export class EdgeTtsAdapter implements TtsAdapter {
  readonly id = "edge-tts";
  readonly label = "微软 Edge 神经语音（免费在线 · 自然人声）";

  async voices(_ctx: PluginContext): Promise<TtsVoice[]> {
    return EDGE_TTS_VOICES.map((voice) => ({ id: voice.id, label: voice.label }));
  }

  async synthesize(
    text: string,
    options: TtsSynthesisOptions,
    out: { dir: string; basename: string },
    _ctx: PluginContext,
  ): Promise<TtsClipResult> {
    await this.ensureClient();
    const voiceId = options.voiceId && options.voiceId !== "mock" ? options.voiceId : DEFAULT_VOICE;
    fs.mkdirSync(out.dir, { recursive: true });
    const mp3Path = path.join(out.dir, `${out.basename}.mp3`);
    const wavPath = path.join(out.dir, `${out.basename}.wav`);

    const args = ["-m", "edge_tts", "--voice", voiceId, "--text", text, "--write-media", mp3Path];
    if (Number.isFinite(options.speed) && Number(options.speed) !== 1) {
      const pct = Math.max(-50, Math.min(100, Math.round((Number(options.speed) - 1) * 100)));
      if (pct !== 0) args.push(`--rate=${pct > 0 ? "+" : ""}${pct}%`);
    }
    try {
      await execFileAsync(edgePython(), args, { timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    } catch (err) {
      const detail = String((err as Error & { stderr?: string; message?: string }).stderr ?? (err as Error).message ?? err);
      if (/Failed to establish|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|403/i.test(detail)) {
        throw new Error(`Edge 在线语音不可用（需联网）: ${detail.slice(-300)}`);
      }
      throw new Error(`Edge TTS 合成失败（voice ${voiceId}）: ${detail.slice(-300)}`);
    }
    if (!fs.existsSync(mp3Path) || fs.statSync(mp3Path).size === 0) {
      throw new Error(`Edge TTS 无输出（voice ${voiceId}）`);
    }

    // Normalize to 48 kHz mono wav so the compose pipeline sees consistent audio.
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    const convert = await run(["-y", "-i", mp3Path, "-ac", "1", "-ar", "48000", wavPath], {
      command: ffmpegPath,
      timeoutSec: 60,
    });
    fs.rmSync(mp3Path, { force: true });
    if (convert.code !== 0 || !fs.existsSync(wavPath)) {
      throw new Error(`Edge 语音转码失败: ${convert.stderr.slice(-300)}`);
    }
    const durationSec = await probeAudioDuration(wavPath).catch(() => 1.5);
    return { audioPath: wavPath, durationSec, voiceId, text };
  }

  /** Install the client venv on first use (a few seconds, no model download). */
  private async ensureClient(): Promise<void> {
    if (process.env.EDGE_TTS_PYTHON || resolveEdgeServiceDir()) return;
    if (process.env.EDGE_TTS_AUTO_SETUP === "0") throw new Error(setupMessage());
    const serviceDir = this.serviceRoot();
    if (!serviceDir) throw new Error(setupMessage());
    try {
      await execFileAsync("bash", ["setup.sh"], { cwd: serviceDir, timeout: 300_000 });
    } catch (err) {
      throw new Error(`Edge TTS 安装失败：${String((err as Error)?.message ?? err)}（可手动运行 bash services/edge-tts/setup.sh）`);
    }
    if (!resolveEdgeServiceDir()) throw new Error(setupMessage());
  }

  private serviceRoot(): string | null {
    const override = process.env.EDGE_TTS_SERVICE_DIR;
    if (override && fs.existsSync(override)) return override;
    const candidates = [
      path.resolve(process.cwd(), "services/edge-tts"),
      path.resolve(process.cwd(), "../services/edge-tts"),
      path.resolve(process.cwd(), "../../services/edge-tts"),
      path.resolve(process.cwd(), "../../../services/edge-tts"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, "setup.sh"))) return candidate;
    }
    return null;
  }
}
