import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions, TtsVoice } from "@openreel/plugin-sdk";
import { probeAudioDuration, run } from "../render/ffmpeg.utils";

const execFileAsync = promisify(execFile);

const DEFAULT_VOICE = "Tingting";

/** Parse `say -v ?` output rows: "Name (locale)     locale   # comment". */
async function listVoices(): Promise<TtsVoice[]> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/say", ["-v", "?"], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 });
    const voices: TtsVoice[] = [];
    const seen = new Set<string>();
    for (const line of stdout.split("\n")) {
      const match = /^(.+?)\s{2,}([^\s#]+)\s+#/.exec(line.trim());
      if (!match) continue;
      const [, name, locale] = match;
      if (seen.has(name)) continue;
      seen.add(name);
      voices.push({ id: name, label: `${name}（${locale}）` });
    }
    return voices.length ? voices : [{ id: DEFAULT_VOICE, label: "婷婷（zh_CN 系统语音）" }];
  } catch {
    return [{ id: DEFAULT_VOICE, label: "婷婷（zh_CN 系统语音）" }];
  }
}

/** macOS built-in `say` synthesis: real speech, fully offline, no API key.
 * Available on darwin hosts; registered only when /usr/bin/say exists. */
export class MacosSayTtsAdapter implements TtsAdapter {
  readonly id = "macos-say";
  readonly label = "macOS 系统语音（离线真实人声）";

  private readonly defaultVoice: string;

  constructor(defaultVoice?: string) {
    this.defaultVoice = defaultVoice || process.env.MACOS_SAY_VOICE || DEFAULT_VOICE;
  }

  async voices(_ctx: PluginContext): Promise<TtsVoice[]> {
    return listVoices();
  }

  async synthesize(
    text: string,
    options: TtsSynthesisOptions,
    out: { dir: string; basename: string },
    _ctx: PluginContext,
  ): Promise<TtsClipResult> {
    fs.mkdirSync(out.dir, { recursive: true });
    const voiceId = options.voiceId || this.defaultVoice;
    const aiffPath = path.join(out.dir, `${out.basename}.aiff`);
    const wavPath = path.join(out.dir, `${out.basename}.wav`);
    try {
      await execFileAsync("/usr/bin/say", ["-v", voiceId, "-o", aiffPath, text], { timeout: 120_000 });
    } catch (err) {
      throw new Error(`macOS 语音合成失败（voice ${voiceId}）: ${String((err as Error)?.message ?? err)}`);
    }
    if (!fs.existsSync(aiffPath) || fs.statSync(aiffPath).size === 0) {
      throw new Error(`macOS 语音合成无输出（voice ${voiceId}）`);
    }
    // Normalize to 48 kHz mono wav so the compose pipeline sees consistent audio.
    const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
    const convert = await run(["-y", "-i", aiffPath, "-ac", "1", "-ar", "48000", wavPath], {
      command: ffmpegPath,
      timeoutSec: 60,
    });
    fs.rmSync(aiffPath, { force: true });
    if (convert.code !== 0 || !fs.existsSync(wavPath)) {
      throw new Error(`macOS 语音转码失败: ${convert.stderr.slice(-300)}`);
    }
    const durationSec = await probeAudioDuration(wavPath).catch(() => 1.5);
    return { audioPath: wavPath, durationSec, voiceId, text };
  }
}
