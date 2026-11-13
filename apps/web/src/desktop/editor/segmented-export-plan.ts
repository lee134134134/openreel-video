import type { VideoExportSettings } from "@openreel/core";

/**
 * Renderer-side planning for segmented desktop exports. Segments are
 * frame-aligned the same way the export engine counts total frames
 * (`Math.ceil(duration * fps - 1e-7)`), so each segment's expected file
 * duration matches its range exactly and can be validated on resume.
 */

export interface SegmentPlanRange {
  startTime: number;
  endTime: number;
}

/** Frame-boundary-aligned split of [startTime, startTime + durationSec]. */
export function splitTimelineForSegments(
  durationSec: number,
  segmentCount: number,
  frameRate: number,
  startTime = 0,
): SegmentPlanRange[] {
  const frames = Math.max(1, Math.ceil(durationSec * frameRate - 1e-7));
  const count = Math.max(1, Math.min(segmentCount, frames));
  const ranges: SegmentPlanRange[] = [];
  for (let i = 0; i < count; i++) {
    const startFrame = Math.round((i * frames) / count);
    const endFrame = Math.round(((i + 1) * frames) / count);
    ranges.push({
      startTime: startTime + startFrame / frameRate,
      endTime: startTime + endFrame / frameRate,
    });
  }
  return ranges;
}

/** `${base}.seg-0000.mp4` alongside the chosen output file. */
export function buildSegmentPaths(outputPath: string, count: number): string[] {
  const dot = outputPath.lastIndexOf(".");
  const base = dot > 0 ? outputPath.slice(0, dot) : outputPath;
  const ext = dot > 0 ? outputPath.slice(dot) : "";
  return Array.from({ length: count }, (_, i) => `${base}.seg-${String(i).padStart(4, "0")}${ext}`);
}

export function expectedSegmentDurations(ranges: readonly SegmentPlanRange[]): number[] {
  return ranges.map((range) => range.endTime - range.startTime);
}

/**
 * Pick the segment count for an export. Short exports (or single-core
 * machines) stay on the regular single-pass path; longer ones split into a
 * bounded number of segments so an interrupted export keeps finished work.
 */
export function chooseSegmentCount(durationSec: number, cores: number): number {
  if (!(durationSec >= 10) || cores <= 1) return 1;
  return Math.max(2, Math.min(6, Math.floor(cores / 2)));
}

export interface SegmentedExportPlan {
  outputPath: string;
  segmentPaths: string[];
  ranges: SegmentPlanRange[];
  expectedDurations: number[];
}

export function buildSegmentedExportPlan(
  settings: VideoExportSettings,
  timelineDurationSec: number,
  outputPath: string,
  cores: number,
): SegmentedExportPlan | null {
  const durationSec = settings.range
    ? settings.range.endTime - settings.range.startTime
    : timelineDurationSec;
  if (!(durationSec > 0)) return null;
  const rangeStart = settings.range?.startTime ?? 0;
  const count = chooseSegmentCount(durationSec, cores);
  if (count <= 1) return null;
  const ranges = splitTimelineForSegments(durationSec, count, settings.frameRate, rangeStart);
  const segmentPaths = buildSegmentPaths(outputPath, ranges.length);
  return {
    outputPath,
    segmentPaths,
    ranges,
    expectedDurations: expectedSegmentDurations(ranges),
  };
}
