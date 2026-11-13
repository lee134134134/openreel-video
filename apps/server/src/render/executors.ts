import * as fs from "node:fs";
import * as path from "node:path";
import type { AssemblyAudioTrack, AssemblySubtitleSpan } from "@openreel/plugin-sdk";
import type { RenderJobRow } from "./render.service";
import { buildAssembleArgs, buildTranscodeArgs, collectSubtitleSpans, type AssembleSegment } from "./args";
import { buildSubtitleAss, detectSubtitleSupport } from "./subtitles";
import { probeVideoDurationUse, run } from "./ffmpeg.utils";

export interface RenderExecutionOptions {
  jobsDir: string;
  ffmpegPath: string;
  ffprobePath: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

export interface RenderExecutionResult {
  outputPath: string;
  outputUrl: string;
}

export function generateOutputPath(jobsDir: string, id: string, format: string): string {
  return path.join(jobsDir, `${id}.${format === "webm" ? "webm" : "mp4"}`);
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseClock(value: string): number | undefined {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function progressReader(total: number | undefined, report: (fraction: number) => void): (chunk: string) => void {
  let buffer = "";
  let last = 0;
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      let seconds: number | undefined;
      if (line.startsWith("out_time=")) seconds = parseClock(line.slice(9));
      if (line.startsWith("out_time_us=") || line.startsWith("out_time_ms=")) {
        const micros = Number(line.slice(line.indexOf("=") + 1));
        if (Number.isFinite(micros)) seconds = micros / 1_000_000;
      }
      if (seconds !== undefined && total && total > 0) {
        last = Math.max(last, Math.min(0.98, seconds / total));
        report(last);
      }
    }
  };
}

async function normalizeSegments(raw: unknown, ffprobePath: string): Promise<AssembleSegment[]> {
  if (!Array.isArray(raw) || !raw.length) throw new Error("渲染任务缺少 segments/clips");
  const segments: AssembleSegment[] = [];
  for (const value of raw) {
    const item = (value ?? {}) as Record<string, unknown>;
    const filePath = String(item.path ?? item.fileRef ?? "");
    if (!filePath) throw new Error("合成片段缺少媒体路径");
    const segment: AssembleSegment = {
      path: filePath,
      startSec: numberValue(item.startSec),
      endSec: numberValue(item.endSec),
      durationSec: numberValue(item.durationSec),
      audioPath: item.audioPath ? String(item.audioPath) : undefined,
      subtitle: item.subtitle ? String(item.subtitle) : undefined,
    };
    if (!segment.durationSec && segment.endSec === undefined) {
      if (/\.(png|jpe?g|webp|gif)$/i.test(filePath)) segment.durationSec = 5;
      else {
        const probed = await probeVideoDurationUse(ffprobePath, filePath);
        segment.durationSec = Math.max(0.05, probed - (segment.startSec ?? 0));
      }
    }
    segments.push(segment);
  }
  return segments;
}

export async function executeRenderJob(
  job: RenderJobRow,
  payload: Record<string, unknown>,
  options: RenderExecutionOptions,
): Promise<RenderExecutionResult> {
  fs.mkdirSync(options.jobsDir, { recursive: true });
  const output = generateOutputPath(options.jobsDir, job.id, job.outputFormat);
  let args: string[];
  let totalDuration: number | undefined;
  if (job.kind === "transcode") {
    const inputFiles = Array.isArray(payload.inputFiles) ? payload.inputFiles as Array<Record<string, unknown>> : [];
    const input = String(payload.input ?? inputFiles[0]?.path ?? "");
    if (!input) throw new Error("转码任务缺少输入文件");
    try { totalDuration = await probeVideoDurationUse(options.ffprobePath, input); } catch { totalDuration = undefined; }
    const transcode = (payload.transcodeOptions ?? payload) as Record<string, unknown>;
    args = buildTranscodeArgs({
      input,
      output,
      crf: numberValue(transcode.crfLevel ?? transcode.crf),
      preset: transcode.preset ? String(transcode.preset) : undefined,
      scaleWidth: numberValue(transcode.scaleWidth),
      scaleHeight: numberValue(transcode.scaleHeight),
      fps: numberValue(transcode.fps),
    });
  } else if (job.kind === "assembly" || job.kind === "videogen-compose") {
    const segments = await normalizeSegments(job.kind === "videogen-compose" ? payload.clips : payload.segments, options.ffprobePath);
    totalDuration = segments.reduce((sum, segment) => sum + (segment.durationSec ?? (segment.endSec ?? 0) - (segment.startSec ?? 0)), 0);
    const assembleInput = {
      output,
      segments,
      audioTracks: (payload.audioTracks ?? []) as AssemblyAudioTrack[],
      subtitles: (payload.subtitles ?? []) as AssemblySubtitleSpan[],
      width: numberValue(payload.width) ?? 1280,
      height: numberValue(payload.height) ?? 720,
      fps: numberValue(payload.fps) ?? 30,
    };
    // Choose the subtitle filter the local FFmpeg actually supports: drawtext
    // needs libfreetype, many builds only ship libass. "none" simply skips
    // burning captions instead of failing the whole render.
    const support = await detectSubtitleSupport(options.ffmpegPath);
    if (support === "drawtext") {
      args = buildAssembleArgs({ ...assembleInput, subtitleMode: "drawtext" });
    } else if (support === "ass" && collectSubtitleSpans(assembleInput).spans.length) {
      const assFile = path.join(options.jobsDir, `${job.id}-subs.ass`);
      fs.writeFileSync(
        assFile,
        buildSubtitleAss(
          collectSubtitleSpans(assembleInput).spans,
          assembleInput.width,
          assembleInput.height,
          process.env.FFMPEG_DRAWTEXT_FONT || (process.platform === "darwin" ? "PingFang SC" : "sans"),
        ),
      );
      args = buildAssembleArgs({ ...assembleInput, subtitleMode: "ass", subtitleFile: assFile });
    } else {
      args = buildAssembleArgs({ ...assembleInput, subtitleMode: "none" });
    }
  } else {
    throw new Error(`未知渲染任务类型: ${job.kind}`);
  }
  const report = options.onProgress ?? (() => undefined);
  const result = await run(["-progress", "pipe:2", "-nostats", ...args], {
    command: options.ffmpegPath,
    signal: options.signal,
    timeoutSec: Math.max(120, Math.min(3600, (totalDuration ?? 60) * 20)),
    onStderr: progressReader(totalDuration, report),
  });
  if (result.code !== 0 || !fs.existsSync(output)) {
    throw new Error(`FFmpeg 渲染失败 (code ${result.code}): ${result.stderr.slice(-1800)}`);
  }
  report(0.99);
  return { outputPath: output, outputUrl: `/api/files/jobs/${path.basename(output)}` };
}
