import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Segmented desktop export helpers. The renderer encodes each segment as its
 * own regular export job (segment files double as resume checkpoints); this
 * module validates which segments are already complete and concatenates the
 * finished segments into the final output with the concat demuxer.
 */

/** Parse `Duration: HH:MM:SS.mmmmmm` out of ffmpeg's input banner. */
export function parseFfmpegDuration(stderr: string): number | null {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(stderr);
  if (!match) return null;
  const [, h, m, s, frac] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${frac}`);
}

/**
 * Probe a media file's duration. Runs without an output target, so ffmpeg
 * exits non-zero after printing the banner to stderr — parse regardless.
 */
export function probeSegmentDuration(ffmpegPath: string, filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    let stderr = "";
    const proc = spawn(ffmpegPath, ["-hide_banner", "-i", filePath]);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", () => resolve(null));
    proc.on("close", () => resolve(parseFfmpegDuration(stderr)));
  });
}

export interface SegmentResumeEntry {
  path: string;
  expectedDurationSec: number;
}

export interface SegmentResumeResult {
  /** Indexes of segments that exist and match the expected duration. */
  completed: number[];
  /** Probe failures and duration mismatches, for diagnostics. */
  invalid: { index: number; reason: string }[];
}

/**
 * Determine which segment files are already encoded (resumable). A segment
 * counts as complete when its probed duration matches the expected
 * frame-aligned duration within half a frame.
 */
export async function checkResumeSegments(
  ffmpegPath: string,
  entries: readonly SegmentResumeEntry[],
  frameRate: number,
): Promise<SegmentResumeResult> {
  const completed: number[] = [];
  const invalid: { index: number; reason: string }[] = [];
  const tolerance = 1.5 / Math.max(1, frameRate);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    try {
      await fs.access(entry.path);
    } catch {
      invalid.push({ index, reason: "missing" });
      continue;
    }
    const duration = await probeSegmentDuration(ffmpegPath, entry.path);
    if (duration === null) {
      invalid.push({ index, reason: "unprobeable" });
      continue;
    }
    if (Math.abs(duration - entry.expectedDurationSec) > tolerance) {
      invalid.push({ index, reason: `duration ${duration.toFixed(3)}s != expected ${entry.expectedDurationSec.toFixed(3)}s` });
      continue;
    }
    completed.push(index);
  }
  return { completed, invalid };
}

/** Concat-demuxer manifest lines. Absolute paths require `-safe 0`. */
export function buildSegmentListScript(paths: readonly string[]): string {
  // ffmpeg concat syntax: a single quote inside the quoted name is written as
  // '\'', i.e. close the string, add the escaped quote, reopen it.
  const quoted = (file: string) => `file '${file.replace(/'/g, `'\\''`)}'`;
  return paths.map(quoted).join("\n") + "\n";
}

export function buildConcatArgs(listPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listPath,
    "-c", "copy",
    outputPath,
  ];
}

/**
 * Concatenate segment files with `-f concat -safe 0 -c copy` (no re-encode).
 * Resolves with ffmpeg's exit code; 0 means the output file is complete.
 */
export async function concatSegmentFiles(
  ffmpegPath: string,
  paths: readonly string[],
  outputPath: string,
): Promise<{ ok: boolean; code: number | null; stderrTail: string }> {
  if (paths.length === 0) {
    return { ok: false, code: null, stderrTail: "no segment paths provided" };
  }
  const listPath = path.join(tmpdir(), `openreel-concat-${randomUUID()}.txt`);
  await fs.writeFile(listPath, buildSegmentListScript(paths), "utf8");
  try {
    return await new Promise((resolve) => {
      let stderr = "";
      const proc = spawn(ffmpegPath, buildConcatArgs(listPath, outputPath));
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 32_000) stderr = stderr.slice(-16_000);
      });
      proc.on("error", (error) => {
        resolve({ ok: false, code: null, stderrTail: String(error) });
      });
      proc.on("close", (code) => {
        resolve({ ok: code === 0, code, stderrTail: stderr.slice(-2_000) });
      });
    });
  } finally {
    await fs.rm(listPath, { force: true }).catch(() => {});
  }
}
