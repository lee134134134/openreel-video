/**
 * Segmented timeline export: splits the export range into frame-aligned
 * segments, encodes each segment independently through the regular export
 * engine, and merges the segment files with WASM ffmpeg (`-f concat -c copy`).
 *
 * Checkpoints (see ./export-checkpoint) persist per-segment blobs so an
 * interrupted export can resume without re-encoding completed segments.
 *
 * Segments run sequentially: the export engine shares the GPU compositor and
 * media decoders (single instances), so true parallelism is left as future
 * work (`maxParallel` is accepted for API stability).
 */

import type { Project } from "../types/project";
import type { ExportProgress, VideoExportSettings } from "./types";
import {
  checkpointKey,
  createMemoryCheckpointer,
  type ExportCheckpointer,
} from "./export-checkpoint";

export interface SegmentRange {
  readonly startTime: number;
  readonly endTime: number;
}

export interface SegmentedExportProgress {
  readonly completedSegments: number;
  readonly totalSegments: number;
  readonly currentSegment: number;
  readonly currentSegmentFrame: number;
}

export interface SegmentRecord {
  readonly index: number;
  readonly range: SegmentRange;
  readonly blob: Blob | null;
  readonly durationSec: number;
}

export interface SegmentExportResult {
  readonly blob: Blob | null;
  readonly segments: SegmentRecord[];
  readonly merged: boolean;
  readonly error?: string;
}

export interface SegmentedExportOptions {
  segmentCount?: number;
  /** Reserved for future parallel execution; segments run sequentially today. */
  maxParallel?: number;
  resume?: boolean;
  onProgress?: (progress: SegmentedExportProgress) => void;
  signal?: AbortSignal;
  checkpointer?: ExportCheckpointer;
  /** Test hook: replaces the per-segment export call. */
  runSegmentImpl?: RunSegmentFn;
  /** Test hook: replaces the WASM ffmpeg merge step. */
  mergeImpl?: MergeFn;
}

export type RunSegmentFn = (
  project: Project,
  settings: VideoExportSettings,
  writable: FileSystemWritableFileStream,
) => Promise<void>;

export type MergeFn = (
  blobs: readonly Blob[],
  mime: string,
) => Promise<Blob | SegmentMergeError>;

export class SegmentMergeError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SegmentMergeError";
  }
}

/** Frame-boundary-aligned split of [startTime, startTime+durationSec]. */
export function splitRange(
  durationSec: number,
  segmentCount: number,
  frameRate: number,
  startTime = 0,
): SegmentRange[] {
  // Match the engine's frame total: Math.ceil(duration * fps - 1e-7).
  const frames = Math.max(1, Math.ceil(durationSec * frameRate - 1e-7));
  const count = Math.max(1, Math.min(segmentCount, frames));
  const segments: SegmentRange[] = [];
  for (let i = 0; i < count; i++) {
    const startFrame = Math.round((i * frames) / count);
    const endFrame = Math.round(((i + 1) * frames) / count);
    segments.push({
      startTime: startTime + startFrame / frameRate,
      endTime: startTime + endFrame / frameRate,
    });
  }
  return segments;
}

/** FFmpeg concat-demuxer manifest. Paths must not contain quote characters. */
export function buildConcatScript(files: readonly string[]): string {
  return files.map((file) => `file '${file.replace(/'/g, "")}'`).join("\n") + "\n";
}

/**
 * Random-access in-memory sink that satisfies the FileSystemWritableFileStream
 * surface used by the export engine (seek + write + abort). Chunks are stored
 * by absolute position and concatenated in position order on flush.
 */
export function createMemoryWritableFileStream(): FileSystemWritableFileStream & {
  flushToBlob: (type: string) => Promise<Blob>;
  byteLength: number;
} {
  type Chunk = { position: number; data: Uint8Array };
  const chunks: Chunk[] = [];
  let position = 0;
  let aborted = false;
  let byteLength = 0;

  const stream = {
    async write(data: FileSystemWriteChunkType | BufferSource | Blob): Promise<void> {
      if (aborted) throw new DOMException("Stream aborted", "AbortError");
      let bytes: Uint8Array;
      let offset = position;
      if (data && typeof data === "object" && "type" in data && !(data instanceof Blob) && !(data instanceof Uint8Array)) {
        // FileSystemWriteChunkType with explicit position: { type: "write", position?, data }
        const writeChunk = data as { position?: number; data: BufferSource | Blob };
        if (typeof writeChunk.position === "number") offset = writeChunk.position;
        bytes = await toBytes(writeChunk.data);
      } else {
        bytes = await toBytes(data);
      }
      chunks.push({ position: offset, data: bytes });
      byteLength = Math.max(byteLength, offset + bytes.byteLength);
    },
    async seek(target: number): Promise<void> {
      position = target;
    },
    async truncate(size: number): Promise<void> {
      byteLength = size;
    },
    async close(): Promise<void> {},
    async abort(): Promise<void> {
      aborted = true;
      chunks.length = 0;
    },
    getWriter(): never {
      throw new Error("getWriter is not supported by the in-memory export sink");
    },
    async flushToBlob(type: string): Promise<Blob> {
      // Position-keyed buffer: gaps are zero-filled, later writes overwrite
      // earlier ones at the same offsets (muxers may rewrite the moov box).
      const out = new Uint8Array(byteLength);
      for (const chunk of chunks) out.set(chunk.data, chunk.position);
      return new Blob([out], { type });
    },
  };
  return stream as unknown as FileSystemWritableFileStream & {
    flushToBlob: (type: string) => Promise<Blob>;
    byteLength: number;
  };
}

async function toBytes(data: BufferSource | Blob | FileSystemWriteChunkType): Promise<Uint8Array> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data && typeof data === "object" && "data" in data) {
    const inner = (data as { data: BufferSource | Blob }).data;
    return toBytes(inner as BufferSource | Blob);
  }
  throw new Error("Unsupported chunk type for memory export sink");
}

export function blobExtension(settings: VideoExportSettings): string {
  return settings.format === "webm" ? "webm" : settings.format;
}

function defaultSegmentCount(durationSec: number): number {
  // ~60s per segment, bounded to [1, 8].
  return Math.max(1, Math.min(8, Math.ceil(durationSec / 60)));
}

/**
 * Orchestrate a segmented export. Each segment reuses the regular export
 * engine with its own `range`; completed segments from the checkpoint are
 * skipped when `resume` is on.
 */
export async function exportSegmented(
  project: Project,
  settings: VideoExportSettings,
  options: SegmentedExportOptions = {},
): Promise<SegmentExportResult> {
  const {
    segmentCount,
    resume = false,
    onProgress,
    signal,
    checkpointer = createMemoryCheckpointer(),
    runSegmentImpl,
    mergeImpl,
  } = options;
  const merge: MergeFn = mergeImpl ?? mergeSegments;

  let runSegment: RunSegmentFn;
  if (runSegmentImpl) {
    runSegment = runSegmentImpl;
  } else {
    // Dynamic import: keeps the heavy export engine (and its worker modules)
    // out of environments that only orchestrate segments.
    const { getExportEngine } = await import("./export-engine");
    const engine = getExportEngine();
    runSegment = async (p, s, writable) => {
      // Consume the progress generator; the encoded bytes land in the sink.
      for await (const progress of engine.exportVideo(p, s, writable)) {
        void progress;
      }
    };
  }

  const totalDuration = settings.range
    ? settings.range.endTime - settings.range.startTime
    : project.timeline.duration;
  const startTime = settings.range?.startTime ?? 0;
  if (!(totalDuration > 0)) {
    return { blob: null, segments: [], merged: false, error: "Nothing to export" };
  }

  const count = segmentCount ?? defaultSegmentCount(totalDuration);
  const ranges = splitRange(totalDuration, count, settings.frameRate, startTime);
  const mime = settings.format === "webm" ? "video/webm" : settings.format === "mov" ? "video/quicktime" : "video/mp4";
  // The checkpoint key must include the export range: segments from a
  // different In/Out span must never be restored for this export.
  const key = checkpointKey(settings, project.id);
  const segments: SegmentRecord[] = [];

  let saved: { completedSegmentIndexes: number[]; segmentBlobs: (Blob | null)[]; segmentDurations: number[] } | null = null;
  if (resume) {
    try {
      saved = (await checkpointer.load(key)) ?? null;
    } catch {
      saved = null;
    }
  }

  const segmentBlobs: (Blob | null)[] = new Array(ranges.length).fill(null);
  const segmentDurations: number[] = new Array(ranges.length).fill(0);
  if (saved && saved.segmentBlobs.length === ranges.length) {
    for (const index of saved.completedSegmentIndexes) {
      segmentBlobs[index] = saved.segmentBlobs[index] ?? null;
      segmentDurations[index] = saved.segmentDurations[index] ?? 0;
    }
  }

  let completed = segmentBlobs.filter(Boolean).length;
  for (let index = 0; index < ranges.length; index++) {
    if (signal?.aborted) throw new DOMException("Segmented export aborted", "AbortError");
    onProgress?.({
      completedSegments: completed,
      totalSegments: ranges.length,
      currentSegment: index,
      currentSegmentFrame: 0,
    });
    if (segmentBlobs[index]) continue;

    const range = ranges[index];
    const segmentSettings: VideoExportSettings = {
      ...settings,
      range: { startTime: range.startTime, endTime: range.endTime },
    };
    const writable = createMemoryWritableFileStream();
    await runSegment(project, segmentSettings, writable);
    if (signal?.aborted) throw new DOMException("Segmented export aborted", "AbortError");

    segmentBlobs[index] = await writable.flushToBlob(mime);
    segmentDurations[index] = range.endTime - range.startTime;
    completed++;
    onProgress?.({
      completedSegments: completed,
      totalSegments: ranges.length,
      currentSegment: index,
      currentSegmentFrame: 0,
    });

    try {
      await checkpointer.save({
        key,
        completedSegmentIndexes: segmentBlobs
          .map((blob, i) => (blob ? i : -1))
          .filter((i) => i >= 0),
        segmentDurations,
        segmentBlobs,
        updatedAt: Date.now(),
      });
    } catch {
      // Checkpoint failure must not fail the export itself.
    }
    segments.push({ index, range, blob: segmentBlobs[index], durationSec: segmentDurations[index] });
  }

  // Report checkpoint-restored segments too.
  for (let index = 0; index < segmentBlobs.length; index++) {
    if (!segments.some((s) => s.index === index)) {
      segments.push({ index, range: ranges[index], blob: segmentBlobs[index], durationSec: segmentDurations[index] });
    }
  }
  segments.sort((a, b) => a.index - b.index);

  const mergedResult = await merge(segmentBlobs.filter((blob): blob is Blob => blob !== null), mime);
  if (mergedResult instanceof SegmentMergeError) {
    return { blob: null, segments, merged: false, error: mergedResult.message };
  }
  try {
    await checkpointer.clear(key);
  } catch {
    // Best-effort cleanup.
  }
  return { blob: mergedResult, segments, merged: true };
}

/**
 * Concatenate segment blobs via WASM ffmpeg (`-f concat -c copy`).
 * Throws `SegmentMergeError` when WASM ffmpeg is unavailable or fails.
 */
export async function mergeSegments(
  blobs: readonly Blob[],
  mime: string,
): Promise<Blob | SegmentMergeError> {
  if (blobs.length === 0) return new SegmentMergeError("No segment blobs to merge");
  if (blobs.length === 1) return blobs[0];

  try {
    const { getFFmpegFallback } = await import("../media/ffmpeg-fallback");
    const ffmpeg = getFFmpegFallback();
    const inputs = [] as { name: string; data: Uint8Array }[];
    for (let i = 0; i < blobs.length; i++) {
      inputs.push({ name: `seg-${String(i).padStart(4, "0")}.mp4`, data: new Uint8Array(await blobs[i].arrayBuffer()) });
    }
    const data = await ffmpeg.concatSegmentFiles(inputs, "output.mp4");
    if (!data) {
      throw new SegmentMergeError("FFmpeg concat failed (unavailable or non-zero exit)");
    }
    return new Blob([data.buffer as ArrayBuffer], { type: mime });
  } catch (error) {
    if (error instanceof SegmentMergeError) return error;
    return new SegmentMergeError(
      "Segment merge requires WASM ffmpeg (offline or load failed); segments are kept individually",
      error,
    );
  }
}

/** Build per-segment settings for external callers (desktop lane parity). */
export function segmentSettingsFor(
  settings: VideoExportSettings,
  index: number,
  ranges: readonly SegmentRange[],
): VideoExportSettings {
  const range = ranges[index];
  return { ...settings, range: { startTime: range.startTime, endTime: range.endTime } };
}

export type { ExportProgress };
