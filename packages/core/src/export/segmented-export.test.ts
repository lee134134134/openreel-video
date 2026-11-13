import { describe, expect, it } from "vitest";
import {
  buildConcatScript,
  createMemoryWritableFileStream,
  exportSegmented,
  mergeSegments,
  splitRange,
  blobExtension,
  SegmentMergeError,
  type MergeFn,
  type RunSegmentFn,
} from "./segmented-export";
import {
  checkpointKey,
  createMemoryCheckpointer,
  hashExportSettings,
} from "./export-checkpoint";
import type { Project, MediaItem } from "../types/project";
import type { VideoExportSettings } from "./types";

const settings: VideoExportSettings = {
  format: "mp4",
  codec: "h264",
  width: 64,
  height: 64,
  frameRate: 30,
  bitrate: 2_000_000,
  bitrateMode: "cbr",
  quality: 0.7,
  keyframeInterval: 2,
  audioSettings: {
    format: "aac",
    bitrate: 128_000,
    sampleRate: 48_000,
    channels: 2,
    bitDepth: 16,
  },
};

function makeProject(durationSec: number): Project {
  const media: MediaItem = {
    id: "m1",
    name: "a.mp4",
    type: "video",
    blob: new Blob(["x"]),
  } as unknown as MediaItem;
  return {
    id: "proj1",
    name: "T",
    mediaLibrary: { items: [media] },
    timeline: {
      tracks: [],
      duration: durationSec,
      markers: [],
      subtitles: [],
    },
  } as unknown as Project;
}

/** Fake per-segment encode: writes recognizable bytes into the sink. */
function fakeRunSegment(tag = "SEG"): RunSegmentFn {
  return async (_project, segmentSettings, writable) => {
    const { startTime } = segmentSettings.range!;
    await writable.seek(0);
    const bytes = new TextEncoder().encode(`${tag}@${startTime.toFixed(2)};`);
    await writable.write(bytes);
  };
}

describe("splitRange", () => {
  it("aligns segment boundaries to frames", () => {
    // 10.05s @ 30fps → 302 frames (matches engine's Math.ceil); 3 segments.
    const ranges = splitRange(10.05, 3, 30);
    expect(ranges).toHaveLength(3);
    expect(ranges[0].startTime).toBeCloseTo(0, 6);
    expect(ranges[2].endTime * 30).toBeCloseTo(302, 6);
    for (const range of ranges) {
      expect(range.startTime * 30).toBeCloseTo(Math.round(range.startTime * 30), 6);
      expect(range.endTime * 30).toBeCloseTo(Math.round(range.endTime * 30), 6);
    }
    // Uneven splits differ by at most one frame.
    const lengths = ranges.map((r) => r.endTime - r.startTime);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1 / 30);
  });

  it("supports an offset start", () => {
    const ranges = splitRange(4, 2, 30, 2);
    expect(ranges[0].startTime).toBeCloseTo(2, 6);
    expect(ranges[1].endTime).toBeCloseTo(6, 6);
  });

  it("clamps segment count to available frames", () => {
    const ranges = splitRange(0.05, 10, 30); // 1.5 frames → 1 frame min
    expect(ranges.length).toBeLessThanOrEqual(2);
  });
});

describe("buildConcatScript", () => {
  it("emits ffmpeg concat-demuxer lines", () => {
    expect(buildConcatScript(["a.mp4", "b.mp4"])).toBe("file 'a.mp4'\nfile 'b.mp4'\n");
  });

  it("strips quote characters from names", () => {
    expect(buildConcatScript(["seg'x.mp4"])).toBe("file 'segx.mp4'\n");
  });
});

describe("createMemoryWritableFileStream", () => {
  it("writes by absolute position, zero-filling gaps and overwriting overlaps", async () => {
    const writable = createMemoryWritableFileStream();
    await writable.seek(0);
    await writable.write(new TextEncoder().encode("AB"));
    await writable.seek(6);
    await writable.write(new TextEncoder().encode("XY"));
    await writable.seek(2);
    await writable.write(new TextEncoder().encode("CD"));
    const blob = await writable.flushToBlob("video/mp4");
    expect(await blob.text()).toBe("ABCD\0\0XY");
  });

  it("accepts FileSystemWriteChunkType objects", async () => {
    const writable = createMemoryWritableFileStream();
    await writable.write({ type: "write", position: 4, data: new TextEncoder().encode("OK") });
    const blob = await writable.flushToBlob("video/mp4");
    expect(await blob.text()).toBe("\0\0\0\0OK");
  });
});

describe("hashExportSettings", () => {
  it("is stable across key order and undefined fields", () => {
    const a = { ...settings, segmented: { segmentCount: 4, maxParallel: 2 } };
    const b = {
      audioSettings: settings.audioSettings,
      keyframeInterval: 2,
      quality: 0.7,
      bitrateMode: "cbr" as const,
      bitrate: 2_000_000,
      frameRate: 30,
      height: 64,
      width: 64,
      codec: "h264" as const,
      format: "mp4" as const,
      segmented: { maxParallel: 2, segmentCount: 4 },
    };
    expect(hashExportSettings(a)).toBe(hashExportSettings(b));
  });

  it("changes when settings change", () => {
    expect(hashExportSettings(settings)).not.toBe(hashExportSettings({ ...settings, width: 128 }));
  });

  it("keeps different export ranges in separate checkpoints", () => {
    const a = { ...settings, range: { startTime: 0, endTime: 60 } };
    const b = { ...settings, range: { startTime: 10, endTime: 40 } };
    expect(checkpointKey(a, "p1")).not.toBe(checkpointKey(b, "p1"));
  });
});

describe("checkpointKey", () => {
  it("includes project id and is deterministic", () => {
    expect(checkpointKey(settings, "p1")).toBe(checkpointKey(settings, "p1"));
    expect(checkpointKey(settings, "p1")).not.toBe(checkpointKey(settings, "p2"));
  });
});

describe("memory checkpointer", () => {
  it("save / load / clear round-trips blobs", async () => {
    const checkpointer = createMemoryCheckpointer();
    const key = "k1";
    await checkpointer.save({
      key,
      completedSegmentIndexes: [0, 1],
      segmentDurations: [2, 2],
      segmentBlobs: [new Blob(["s0"]), new Blob(["s1"]), null],
      updatedAt: 42,
    });
    const loaded = await checkpointer.load(key);
    expect(loaded?.completedSegmentIndexes).toEqual([0, 1]);
    expect(await loaded?.segmentBlobs[0]?.text()).toBe("s0");
    await checkpointer.clear(key);
    expect(await checkpointer.load(key)).toBeNull();
  });
});

/** Test merge: concatenates payload bytes in blob order. */
function fakeMerge(): MergeFn {
  return async (blobs) => {
    const parts: Uint8Array[] = [];
    for (const blob of blobs) parts.push(new Uint8Array(await blob.arrayBuffer()));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return new Blob([out], { type: "video/mp4" });
  };
}

describe("mergeSegments (pass-through)", () => {
  it("returns a single blob without invoking ffmpeg", async () => {
    const blob = new Blob([new TextEncoder().encode("only")]);
    const merged = await mergeSegments([blob], "video/mp4");
    expect(merged instanceof SegmentMergeError).toBe(false);
    expect(await (merged as Blob).text()).toBe("only");
  });

  it("reports an error for an empty segment list", async () => {
    const merged = await mergeSegments([], "video/mp4");
    expect(merged instanceof SegmentMergeError).toBe(true);
  });
});

describe("exportSegmented", () => {
  it("runs each segment with frame-aligned ranges and merges blobs in order", async () => {
    const project = makeProject(4);
    const progress: { completedSegments: number; totalSegments: number; currentSegment: number }[] = [];
    const result = await exportSegmented(project, settings, {
      segmentCount: 3,
      onProgress: (p) => progress.push({ completedSegments: p.completedSegments, totalSegments: p.totalSegments, currentSegment: p.currentSegment }),
      runSegmentImpl: fakeRunSegment(),
      mergeImpl: fakeMerge(),
    });
    expect(result.segments).toHaveLength(3);
    expect(result.segments.map((s) => (s.blob ? "blob" : "null"))).toEqual(["blob", "blob", "blob"]);
    expect(progress.at(-1)?.completedSegments).toBe(3);
    expect(result.merged).toBe(true);
    expect(result.blob).not.toBeNull();
  });

  it("merges segment payloads in segment order", async () => {
    const project = makeProject(2);
    const result = await exportSegmented(project, settings, {
      segmentCount: 2,
      runSegmentImpl: fakeRunSegment(),
      mergeImpl: fakeMerge(),
    });
    expect(await result.blob?.text()).toBe("SEG@0.00;SEG@1.00;");
  });

  it("resumes: skips segments already recorded in the checkpoint", async () => {
    const checkpointer = createMemoryCheckpointer();
    const key = checkpointKey(settings, "proj1");
    await checkpointer.save({
      key,
      completedSegmentIndexes: [0],
      segmentDurations: [2],
      segmentBlobs: [new Blob([new TextEncoder().encode("RESTORED;")]), null],
      updatedAt: 1,
    });

    const runCalls: number[] = [];
    const project = makeProject(4);
    const runSegment: RunSegmentFn = async (_p, s, writable) => {
      runCalls.push(s.range!.startTime);
      await fakeRunSegment()(_p, s, writable);
    };
    const result = await exportSegmented(project, settings, {
      segmentCount: 2,
      resume: true,
      checkpointer,
      runSegmentImpl: runSegment,
      mergeImpl: fakeMerge(),
    });
    expect(runCalls).toEqual([2]); // only segment 1 was encoded
    expect(await result.blob?.text()).toBe("RESTORED;SEG@2.00;");
    // Checkpoint cleared after a successful merge.
    expect(await checkpointer.load(key)).toBeNull();
  });

  it("returns segments unmerged with an error when merge fails", async () => {
    const project = makeProject(2);
    const result = await exportSegmented(project, settings, {
      segmentCount: 2,
      runSegmentImpl: async (_p, _s, writable) => {
        await writable.seek(0);
        await writable.write(new TextEncoder().encode("X"));
      },
      mergeImpl: async () => new SegmentMergeError("WASM ffmpeg unavailable"),
    });
    expect(result.merged).toBe(false);
    expect(result.blob).toBeNull();
    expect(result.error).toContain("WASM ffmpeg");
    // Segments are still complete for a future retry or manual merge.
    expect(result.segments).toHaveLength(2);
    expect(result.segments.every((s) => s.blob !== null)).toBe(true);
  });

  it("passes a single segment through without merging", async () => {
    const project = makeProject(1);
    const result = await exportSegmented(project, settings, {
      segmentCount: 1,
      runSegmentImpl: fakeRunSegment(),
    });
    expect(result.merged).toBe(true);
    expect(await result.blob?.text()).toBe("SEG@0.00;");
  });
});

describe("blobExtension", () => {
  it("maps formats", () => {
    expect(blobExtension(settings)).toBe("mp4");
    expect(blobExtension({ ...settings, format: "webm" })).toBe("webm");
  });
});
