import { describe, expect, it } from "vitest";
import type { VideoExportSettings } from "@openreel/core";
import {
  buildSegmentPaths,
  buildSegmentedExportPlan,
  chooseSegmentCount,
  expectedSegmentDurations,
  splitTimelineForSegments,
} from "./segmented-export-plan";

describe("chooseSegmentCount", () => {
  it("keeps short exports on the single-pass path", () => {
    expect(chooseSegmentCount(5, 12)).toBe(1);
    expect(chooseSegmentCount(9.9, 12)).toBe(1);
  });

  it("clamps long exports to 2..min(6, cores/2)", () => {
    expect(chooseSegmentCount(60, 4)).toBe(2);
    expect(chooseSegmentCount(120, 8)).toBe(4);
    expect(chooseSegmentCount(1200, 32)).toBe(6);
  });

  it("falls back to a single pass on single-core machines", () => {
    expect(chooseSegmentCount(300, 1)).toBe(1);
  });
});

describe("splitTimelineForSegments", () => {
  it("aligns boundaries to frames and covers the whole duration", () => {
    // 10.05s @ 30fps → 302 frames (engine's Math.ceil), 3 segments.
    const ranges = splitTimelineForSegments(10.05, 3, 30);
    expect(ranges).toHaveLength(3);
    expect(ranges[0].startTime).toBeCloseTo(0, 6);
    for (const range of ranges) {
      expect(range.startTime * 30).toBeCloseTo(Math.round(range.startTime * 30), 6);
      expect(range.endTime * 30).toBeCloseTo(Math.round(range.endTime * 30), 6);
    }
    expect(ranges[ranges.length - 1].endTime * 30).toBeCloseTo(302, 6);
    const lengths = ranges.map((r) => r.endTime - r.startTime);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1 / 30);
  });

  it("supports an offset start (In/Out range)", () => {
    const ranges = splitTimelineForSegments(4, 2, 30, 2);
    expect(ranges[0].startTime).toBeCloseTo(2, 6);
    expect(ranges[1].endTime).toBeCloseTo(6, 6);
  });

  it("never produces more segments than frames", () => {
    const ranges = splitTimelineForSegments(0.05, 10, 30);
    expect(ranges.length).toBeLessThanOrEqual(2);
  });
});

describe("buildSegmentPaths", () => {
  it("sits next to the output file with a numeric suffix", () => {
    expect(buildSegmentPaths("/movies/My Movie.mp4", 2)).toEqual([
      "/movies/My Movie.seg-0000.mp4",
      "/movies/My Movie.seg-0001.mp4",
    ]);
  });

  it("keeps the extension of the chosen container", () => {
    expect(buildSegmentPaths("/x/out.mov", 1)).toEqual(["/x/out.seg-0000.mov"]);
  });
});

describe("expectedSegmentDurations", () => {
  it("matches each range's span", () => {
    const ranges = splitTimelineForSegments(2, 2, 30);
    expect(expectedSegmentDurations(ranges)).toEqual([1, 1]);
  });
});

describe("buildSegmentedExportPlan", () => {
  const settings = {
    format: "mp4",
    codec: "h264",
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 8_000_000,
  } as VideoExportSettings;

  it("returns null for short exports", () => {
    expect(buildSegmentedExportPlan(settings, 9, "/x/out.mp4", 12)).toBeNull();
  });

  it("plans frame-aligned segments from the timeline duration", () => {
    const plan = buildSegmentedExportPlan(settings, 60, "/x/out.mp4", 8);
    expect(plan).not.toBeNull();
    expect(plan!.segmentPaths).toHaveLength(4);
    expect(plan!.ranges[0].startTime).toBeCloseTo(0, 6);
    expect(plan!.ranges[3].endTime).toBeCloseTo(60, 6);
    expect(plan!.expectedDurations).toEqual(plan!.ranges.map((r) => r.endTime - r.startTime));
  });

  it("respects an In/Out range", () => {
    const ranged = { ...settings, range: { startTime: 10, endTime: 40 } } as VideoExportSettings;
    const plan = buildSegmentedExportPlan(ranged, 100, "/x/out.mp4", 8);
    expect(plan).not.toBeNull();
    expect(plan!.ranges[0].startTime).toBeCloseTo(10, 6);
    expect(plan!.ranges[plan!.ranges.length - 1].endTime).toBeCloseTo(40, 6);
  });
});
