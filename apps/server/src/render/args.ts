import * as path from "node:path";
import type { AssemblyAudioTrack, AssemblySubtitleSpan } from "@openreel/plugin-sdk";
import { escapeFilterPath } from "./subtitles";

export type SubtitleRenderMode = "drawtext" | "ass" | "none";

export interface TranscodeArgsInput {
  input: string;
  output: string;
  crf?: number;
  preset?: string;
  scaleWidth?: number;
  scaleHeight?: number;
  fps?: number;
}

export interface AssembleSegment {
  path?: string;
  fileRef?: string;
  startSec?: number;
  endSec?: number;
  durationSec?: number;
  audioPath?: string;
  subtitle?: string;
}

export interface AssembleArgsInput {
  output: string;
  segments: AssembleSegment[];
  audioTracks?: AssemblyAudioTrack[];
  subtitles?: AssemblySubtitleSpan[];
  width: number;
  height: number;
  fps: number;
  font?: string;
  /** How to burn subtitles; "ass" reads from subtitleFile, "none" skips them. */
  subtitleMode?: SubtitleRenderMode;
  /** Path to a generated .ass file, required when subtitleMode === "ass". */
  subtitleFile?: string;
}

export function buildTranscodeArgs(input: TranscodeArgsInput): string[] {
  const args = ["-y", "-i", input.input, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264"];
  args.push("-crf", String(input.crf ?? 23), "-preset", input.preset ?? "veryfast");
  if (input.scaleWidth || input.scaleHeight) {
    const width = input.scaleWidth ? String(Math.round(input.scaleWidth)) : "-2";
    const height = input.scaleHeight ? String(Math.round(input.scaleHeight)) : "-2";
    args.push("-vf", `scale=${width}:${height}`);
  }
  if (input.fps) args.push("-r", String(input.fps));
  args.push("-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", input.output);
  return args;
}

/** Escape text for a single-quoted drawtext value inside a filtergraph. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, "\\n");
}

function drawtext(text: string, start: number, end: number, width: number, height: number, font: string): string {
  const size = Math.max(18, Math.round(Math.min(width, height) * 0.045));
  return [
    `font='${escapeDrawtext(font)}'`,
    `text='${escapeDrawtext(text)}'`,
    `fontsize=${size}`,
    "fontcolor=white",
    "borderw=2",
    "bordercolor=black@0.75",
    "box=1",
    "boxcolor=black@0.35",
    "boxborderw=10",
    "x=(w-text_w)/2",
    `y=h-text_h-${Math.max(24, Math.round(height * 0.06))}`,
    `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`,
  ].join(":");
}

function segmentDuration(segment: AssembleSegment): number | undefined {
  if (Number.isFinite(segment.durationSec) && Number(segment.durationSec) > 0) return Number(segment.durationSec);
  if (segment.endSec !== undefined) return Math.max(0.05, segment.endSec - (segment.startSec ?? 0));
  return undefined;
}

function isImage(filePath: string): boolean {
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(path.extname(filePath).toLowerCase());
}

/** Collect subtitle spans in global timeline order: explicit spans plus per-segment captions. */
export function collectSubtitleSpans(input: Pick<AssembleArgsInput, "segments" | "subtitles">): {
  spans: AssemblySubtitleSpan[];
  durations: Array<number | undefined>;
} {
  const durations = input.segments.map(segmentDuration);
  const spans: AssemblySubtitleSpan[] = [...(input.subtitles ?? [])];
  let clipStart = 0;
  input.segments.forEach((segment, index) => {
    const duration = durations[index] ?? 0;
    if (segment.subtitle && duration > 0) {
      spans.push({ text: segment.subtitle, startSec: clipStart, endSec: clipStart + duration });
    }
    clipStart += duration;
  });
  return { spans, durations };
}

/** Build a complete concat/canvas/subtitle/audio mix filtergraph without shell interpolation. */
export function buildAssembleArgs(input: AssembleArgsInput): string[] {
  if (!input.segments.length) throw new Error("至少需要一个合成片段");
  const width = Math.max(2, Math.round(input.width / 2) * 2);
  const height = Math.max(2, Math.round(input.height / 2) * 2);
  const fps = Math.max(1, input.fps);
  const args: string[] = ["-y"];
  const filters: string[] = [];
  const durations = input.segments.map(segmentDuration);
  const total = durations.every((duration) => duration !== undefined)
    ? durations.reduce<number>((sum, duration) => sum + Number(duration), 0)
    : undefined;

  input.segments.forEach((segment, index) => {
    const filePath = segment.path ?? segment.fileRef;
    if (!filePath) throw new Error(`片段 ${index + 1} 缺少路径`);
    const start = Math.max(0, segment.startSec ?? 0);
    const duration = durations[index];
    if (start > 0) args.push("-ss", String(start));
    if (isImage(filePath)) args.push("-loop", "1", "-framerate", String(fps));
    if (duration) args.push("-t", String(duration));
    args.push("-i", filePath);
    const trim = duration ? `trim=duration=${duration},` : "";
    filters.push(
      `[${index}:v]${trim}scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x26263a,` +
      `fps=${fps},setsar=1,setpts=PTS-STARTPTS[v${index}]`,
    );
  });
  const concatInputs = input.segments.map((_, index) => `[v${index}]`).join("");
  filters.push(`${concatInputs}concat=n=${input.segments.length}:v=1:a=0[vconcat]`);

  const font = input.font || process.env.FFMPEG_DRAWTEXT_FONT || (process.platform === "darwin" ? "PingFang SC" : "sans");
  const subtitleMode: SubtitleRenderMode = input.subtitleMode ?? "drawtext";
  let videoLabel = "vconcat";
  if (subtitleMode === "ass" && input.subtitleFile) {
    const next = "vsub";
    filters.push(`[${videoLabel}]subtitles=filename='${escapeFilterPath(input.subtitleFile)}'[${next}]`);
    videoLabel = next;
  } else if (subtitleMode !== "none") {
    const spans = collectSubtitleSpans(input).spans;
    spans.forEach((span, index) => {
      const next = `vsub${index}`;
      filters.push(`[${videoLabel}]drawtext=${drawtext(span.text, span.startSec, span.endSec, width, height, font)}[${next}]`);
      videoLabel = next;
    });
  }

  const audioLabels: string[] = [];
  let audioInputIndex = input.segments.length;
  const addAudio = (filePath: string, volume: number, delaySec: number, loop: boolean): void => {
    const index = audioInputIndex++;
    if (loop) args.push("-stream_loop", "-1");
    args.push("-i", filePath);
    const label = `a${audioLabels.length}`;
    const delay = Math.max(0, Math.round(delaySec * 1000));
    const tail = total ? `,apad,atrim=duration=${total}` : "";
    filters.push(`[${index}:a]aresample=48000,volume=${Math.max(0, volume)},adelay=${delay}:all=1${tail}[${label}]`);
    audioLabels.push(label);
  };
  let audioClipStart = 0;
  input.segments.forEach((segment, index) => {
    if (segment.audioPath) addAudio(segment.audioPath, 1, audioClipStart, false);
    audioClipStart += durations[index] ?? 0;
  });
  (input.audioTracks ?? []).forEach((track) => {
    addAudio(track.fileRef, track.volume ?? 1, track.delaySec ?? 0, track.loop ?? false);
  });
  if (audioLabels.length) {
    filters.push(`${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0[aout]`);
  }
  if (filters.length) args.push("-filter_complex", filters.join(";"));
  args.push("-map", `[${videoLabel}]`);
  if (audioLabels.length) args.push("-map", "[aout]", "-c:a", input.output.endsWith(".webm") ? "libopus" : "aac");
  if (total) args.push("-t", String(total));
  if (input.output.endsWith(".webm")) {
    args.push("-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0");
  } else {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart");
  }
  args.push("-r", String(fps), "-pix_fmt", "yuv420p", input.output);
  return args;
}
