import { spawn } from "node:child_process";

export interface FfmpegRunOptions {
  timeoutSec?: number;
  command?: string;
  signal?: AbortSignal;
  onStderr?: (chunk: string) => void;
}

export interface FfmpegRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run ffmpeg (or a compatible binary) without invoking a shell. */
export function run(args: string[], opts: FfmpegRunOptions = {}): Promise<FfmpegRunResult> {
  const command = opts.command || process.env.FFMPEG_PATH || "ffmpeg";
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      resolve({ code: 1, stdout: "", stderr: "aborted" });
      return;
    }
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr: stderr.slice(-8192) });
    };
    const abort = (): void => {
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      stderr += `\nprocess timed out after ${opts.timeoutSec ?? 300}s`;
      child.kill("SIGKILL");
    }, (opts.timeoutSec ?? 300) * 1000);
    opts.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-16384);
      opts.onStderr?.(text);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      if (!settled) {
        settled = true;
        reject(new Error(`无法启动 ${command}: ${err.message}`));
      }
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

async function probeDuration(cmd: string, filePath: string): Promise<number> {
  const result = await run([
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { command: cmd, timeoutSec: 20 });
  if (result.code !== 0) throw new Error(`ffprobe 失败: ${result.stderr.slice(-500)}`);
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration < 0) throw new Error(`ffprobe 返回无效时长: ${result.stdout}`);
  return duration;
}

export function probeAudioDurationUse(cmd: string, filePath: string): Promise<number> {
  return probeDuration(cmd, filePath);
}

export function probeVideoDurationUse(cmd: string, filePath: string): Promise<number> {
  return probeDuration(cmd, filePath);
}

export function probeAudioDuration(filePath: string): Promise<number> {
  return probeAudioDurationUse(process.env.FFPROBE_PATH || "ffprobe", filePath);
}

export function probeVideoDuration(filePath: string): Promise<number> {
  return probeVideoDurationUse(process.env.FFPROBE_PATH || "ffprobe", filePath);
}

export async function hasBinary(cmd: string): Promise<boolean> {
  try {
    const result = await run(["-version"], { command: cmd, timeoutSec: 8 });
    return result.code === 0;
  } catch {
    return false;
  }
}
