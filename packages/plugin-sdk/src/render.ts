/**
 * Server-side render queue contracts. The queue composes final MP4 outputs
 * from (a) videogen plans, (b) uploaded OpenReel exports, (c) raw media
 * assemblies, all via FFmpeg. It does NOT replace the in-browser editor
 * export engines (WebCodecs / desktop native FFmpeg), it complements them.
 */

import type { VideogenPlan } from "./videogen.js";

export type RenderJobKind = "videogen-compose" | "transcode" | "assembly";

export type RenderJobState = "queued" | "running" | "done" | "failed" | "cancelled";

export type RenderOutputFormat = "mp4" | "webm";

export interface RenderJobRequest {
  id: string;
  kind: RenderJobKind;
  state: RenderJobState;
  progress: number;
  /** ffmpeg log-tail used for UI troubleshooting. */
  stage?: string;
  error?: string;
  outputUrl?: string; // /api/files/<id>.mp4
  outputFormat: RenderOutputFormat;
  /** Assembly / transcode inputs (file ids or absolute in-DATA_DIR paths). */
  inputFiles?: Array<{ path: string; role: "video" | "audio" | "image" }>;
  transcodeOptions?: {
    crfLevel?: number;
    preset?: string;
    scaleWidth?: number;
    scaleHeight?: number;
    fps?: number;
  };
  videogenPlanId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Payload server accepts when the web editor pushes a finished export. */
export interface UploadExportPayload {
  filename: string;
  projectTitle?: string;
  /** multipart upload handles this automatically; included for API clients. */
  byteSize?: number;
}

/* ---------------- Assembly instructions (pure & JSON-serializable) --------------- */

export interface AssemblySegment {
  fileRef: string; // upload id or path within DATA_DIR
  startSec?: number;
  endSec?: number;
  /** Optional fade into the next segment (seconds). */
  fadeIn?: number;
  fadeOut?: number;
}

export interface AssemblyAudioTrack {
  fileRef: string;
  volume?: number; // 0..1
  delaySec?: number;
  loop?: boolean;
}

export interface AssemblySubtitleSpan {
  text: string;
  startSec: number;
  endSec: number;
}

export interface AssemblyRequest {
  segments: AssemblySegment[];
  audioTracks?: AssemblyAudioTrack[];
  subtitles?: AssemblySubtitleSpan[];
  width: number;
  height: number;
  fps: number;
  outputFormat: RenderOutputFormat;
}

export interface ComposeVideogenRequest {
  plan: VideogenPlan;
  adapterId?: string;
}

export function buildRenderJobRequest(args: {
  id: string;
  kind: RenderJobKind;
  videogenPlanId?: string;
  inputFiles?: RenderJobRequest["inputFiles"];
  transcodeOptions?: RenderJobRequest["transcodeOptions"];
}): RenderJobRequest {
  return {
    id: args.id,
    kind: args.kind,
    state: "queued",
    progress: 0,
    outputFormat: "mp4",
    ...(args.videogenPlanId ? { videogenPlanId: args.videogenPlanId } : {}),
    ...(args.inputFiles ? { inputFiles: args.inputFiles } : {}),
    ...(args.transcodeOptions ? { transcodeOptions: args.transcodeOptions } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
