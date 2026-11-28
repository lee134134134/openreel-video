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
  /** Camera move applied to still-image segments (Ken Burns / dynamic drift). */
  motion?: string;
  /**
   * Ordered keyframe stills for one continuous shot. When 2+ frames are given
   * the compositor cross-dissolves them under a single camera move, so the
   * scene changes inside itself instead of holding one frozen slide.
   */
  frames?: string[];
  /** Loop short generated clips so the scene still fills its narration length. */
  loop?: boolean;
}

/** Camera moves the composition can animate on still images. */
export type SegmentMotion =
  | "zoom-in" | "zoom-out"
  | "pan-left" | "pan-right" | "pan-up" | "pan-down"
  | "dynamic" | "static";

/**
 * Camera move for still images. The default output is a slide deck: `static`
 * (and any missing/unknown motion) returns an empty string, so no zoompan is
 * applied at all. Legacy explicit motions are still accepted for old plans but
 * are deliberately gentle — no sway, no Ken Burns — to keep the calm,
 * Apple-style presentation look and avoid the shaky-cam effect.
 */
export function motionZoomPan(
  motion: string | undefined,
  frames: number,
  width: number,
  height: number,
  fps: number,
  offsetFrames = 0,
): string {
  const kind = (motion ?? "static").toLowerCase();
  if (kind === "static" || kind === "slide" || kind === "none") return "";
  const n = Math.max(2, Math.round(frames));
  const pos = offsetFrames > 0 ? `(${offsetFrames}+on)` : "on";
  let z: string;
  let x = "(iw-iw/zoom)/2";
  let y = "(ih-ih/zoom)/2";
  switch (kind) {
    case "zoom-in":
      z = `1+0.06*${pos}/${n}`;
      break;
    case "zoom-out":
      z = `1.06-0.06*${pos}/${n}`;
      break;
    case "pan-left":
      z = `1.04+0.04*${pos}/${n}`;
      x = `(iw-iw/zoom)*(1-${pos}/${n})`;
      break;
    case "pan-right":
      z = `1.04+0.04*${pos}/${n}`;
      x = `(iw-iw/zoom)*${pos}/${n}`;
      break;
    case "pan-up":
      z = `1.04+0.04*${pos}/${n}`;
      y = `(ih-ih/zoom)*(1-${pos}/${n})`;
      break;
    case "pan-down":
      z = `1.04+0.04*${pos}/${n}`;
      y = `(ih-ih/zoom)*${pos}/${n}`;
      break;
    default:
      z = `1+0.06*${pos}/${n}`;
  }
  return `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${width}x${height}:fps=${fps}`;
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

  let nextInputIndex = 0;
  input.segments.forEach((segment, index) => {
    const filePath = segment.path ?? segment.fileRef;
    if (!filePath) throw new Error(`片段 ${index + 1} 缺少路径`);
    const start = Math.max(0, segment.startSec ?? 0);
    const duration = durations[index];
    const image = isImage(filePath);
    const sceneDuration = duration ?? 0;
    const keyframes = image && sceneDuration > 0
      ? (segment.frames ?? []).map((frame) => String(frame ?? "").trim()).filter(Boolean).slice(0, 4)
      : [];

    // A multi-keyframe shot: cross-dissolve the frames of ONE scene. By default
    // these are static slides; a legacy motion is applied only when explicitly
    // requested. Total duration stays exactly the scene duration so narration
    // and subtitle timing are unaffected.
    if (keyframes.length > 1) {
      const count = keyframes.length;
      const transition = Math.min(0.5, Math.max(0.2, sceneDuration / (count * 3)));
      const slice = (sceneDuration + (count - 1) * transition) / count;
      const totalFrames = Math.max(2, Math.round(sceneDuration * fps));
      const move = motionZoomPan(segment.motion, totalFrames, width, height, fps);
      const movePrefix = move ? `${move},` : "";
      let previous: string | undefined;
      for (let beat = 0; beat < count; beat += 1) {
        const inputIndex = nextInputIndex++;
        args.push("-loop", "1", "-framerate", String(fps), "-t", slice.toFixed(3), "-i", keyframes[beat]);
        const label = `k${index}_${beat}`;
        filters.push(
          `[${inputIndex}:v]trim=duration=${slice.toFixed(3)},` +
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0xF5F5F7,` +
          `setsar=1,${movePrefix}` +
          `fps=${fps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[${label}]`,
        );
        if (previous) {
          const blended = `kx${index}_${beat}`;
          const offset = (beat * (slice - transition)).toFixed(3);
          filters.push(
            `[${previous}][${label}]xfade=transition=fade:duration=${transition.toFixed(3)}:offset=${offset}[${blended}]`,
          );
          previous = blended;
        } else {
          previous = label;
        }
      }
      filters.push(
        `[${previous}]trim=duration=${sceneDuration.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
      );
      return;
    }

    if (start > 0) args.push("-ss", String(start));
    if (image) args.push("-loop", "1", "-framerate", String(fps));
    else if (segment.loop && duration) args.push("-stream_loop", "-1");
    if (duration) args.push("-t", String(duration));
    args.push("-i", filePath);
    const inputIndex = nextInputIndex++;
    const trim = duration ? `trim=duration=${duration},` : "";
    const frames = duration ? Math.max(2, Math.round(duration * fps)) : fps * 5;
    const move = image ? motionZoomPan(segment.motion, frames, width, height, fps) : "";
    const movePrefix = move ? `${move},` : "";
    // A soft fade keeps the scene change calm without any camera movement.
    const fadeIn = "fade=t=in:st=0:d=0.3";
    const fadeOut = duration ? `,fade=t=out:st=${Math.max(0, duration - 0.3).toFixed(3)}:d=0.3` : "";
    filters.push(
      `[${inputIndex}:v]${trim}scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0xF5F5F7,` +
      `setsar=1,${movePrefix}fps=${fps},format=yuv420p,setpts=PTS-STARTPTS,${fadeIn}${fadeOut}[v${index}]`,
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
  let audioInputIndex = nextInputIndex;
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
