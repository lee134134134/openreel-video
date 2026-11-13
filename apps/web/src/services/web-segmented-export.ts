import {
  exportSegmented,
  getExportEngine,
  createIdbCheckpointer,
  createMemoryCheckpointer,
  type ExportCheckpointer,
  type MergeFn,
  type Project,
  type RunSegmentFn,
  type VideoExportSettings,
} from "@openreel/core";
import { writeBlobToWritable } from "./export-runner";

/**
 * Browser-side segmented export: reuses the core segmented exporter with an
 * IndexedDB checkpoint so an interrupted (or crashed) export skips already
 * encoded segments on retry. Segments are merged with WASM ffmpeg
 * (`-f concat -c copy`); the merged blob is then delivered through the
 * regular export writable (OPFS streaming or buffered download).
 */

export interface WebSegmentedExportOptions {
  assertNotCancelled: () => void;
  reportProgress: (progress01: number, phase: string) => void;
  /** Test injection; defaults to IndexedDB when available, memory otherwise. */
  checkpointer?: ExportCheckpointer;
  /** Test injection; defaults to driving the regular export engine. */
  runSegmentImpl?: RunSegmentFn;
  /** Test injection; defaults to WASM ffmpeg concat merge. */
  mergeImpl?: MergeFn;
}

function defaultCheckpointer(): ExportCheckpointer {
  // jsdom (and some private-mode browsers) lack IndexedDB; fall back to an
  // in-memory checkpoint so exports still work (without cross-run resume).
  return typeof indexedDB !== "undefined" ? createIdbCheckpointer() : createMemoryCheckpointer();
}

export async function runWebSegmentedExport(
  project: Project,
  settings: VideoExportSettings,
  writable: FileSystemWritableFileStream,
  options: WebSegmentedExportOptions,
): Promise<void> {
  const { assertNotCancelled, reportProgress, checkpointer = defaultCheckpointer(), runSegmentImpl, mergeImpl } = options;

  let completedSegments = 0;
  let totalSegments = 1;

  const segmentRunner: RunSegmentFn = runSegmentImpl ?? (async (segmentProject, segmentSettings, segmentWritable) => {
    // Lazy init: the heavy engine (and its workers) is only touched when the
    // default runner is used.
    const engine = getExportEngine();
    await engine.initialize();
    assertNotCancelled();
    let generator: ReturnType<typeof engine.exportVideo> | undefined;
    try {
      generator = engine.exportVideo(segmentProject, segmentSettings, segmentWritable);
      for (;;) {
        const { value, done } = await generator.next();
        assertNotCancelled();
        if (done) {
          if (!value.success) {
            if (value.error?.code === "CANCELLED") throw new DOMException("Export cancelled", "AbortError");
            throw new Error(value.error?.message || "分段导出失败");
          }
          return;
        }
        // onProgress already ran for this segment: completedSegments is the
        // count before it, so overlay the in-segment progress on top.
        reportProgress(
          Math.min(0.99, (completedSegments + value.progress) / totalSegments),
          value.phase,
        );
      }
    } finally {
      try { await generator?.return({ success: false }); } catch { /* Preserve the original failure. */ }
    }
  });

  let result;
  try {
    result = await exportSegmented(project, settings, {
      resume: true,
      segmentCount: settings.segmented?.segmentCount,
      checkpointer,
      runSegmentImpl: segmentRunner,
      mergeImpl,
      onProgress: (progress) => {
        completedSegments = progress.completedSegments;
        totalSegments = Math.max(1, progress.totalSegments);
        reportProgress(
          Math.min(0.99, progress.completedSegments / progress.totalSegments),
          `分段 ${Math.min(progress.completedSegments + 1, progress.totalSegments)}/${progress.totalSegments}`,
        );
      },
    });
    if (!result.merged || !result.blob) {
      throw new Error(result.error || "Segmented export could not merge its segments");
    }
    assertNotCancelled();
    reportProgress(0.99, "saving");
    await writeBlobToWritable(result.blob, writable);
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}
