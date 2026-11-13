import { describe, expect, it, vi } from "vitest";
import type { Project, VideoExportSettings } from "@openreel/core";
import {
  createMemoryCheckpointer,
  checkpointKey,
  type MergeFn,
} from "@openreel/core";
import { runWebSegmentedExport } from "./web-segmented-export";

// jsdom's Blob only implements slice/size/type; bridge arrayBuffer/text/stream
// through FileReader so the service's blob plumbing works under test.
interface TestBlobPolyfill {
  arrayBuffer?(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
  stream?(): ReadableStream<Uint8Array>;
}
const blobProto = Blob.prototype as unknown as TestBlobPolyfill;
if (typeof blobProto.arrayBuffer !== "function") {
  const readAs = (blob: Blob, method: "readAsArrayBuffer" | "readAsText"): Promise<ArrayBuffer | string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer | string);
      reader.onerror = () => reject(reader.error);
      reader[method](blob);
    });
  blobProto.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return readAs(this, "readAsArrayBuffer") as Promise<ArrayBuffer>;
  };
  blobProto.text = function text(this: Blob): Promise<string> {
    return readAs(this, "readAsText") as Promise<string>;
  };
  blobProto.stream = function stream(this: Blob): ReadableStream<Uint8Array> {
    const blob = this;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        const buffer = (await readAs(blob, "readAsArrayBuffer")) as ArrayBuffer;
        controller.enqueue(new Uint8Array(buffer));
        controller.close();
      },
    });
  };
}

const settings = {
  format: "mp4",
  codec: "h264",
  width: 64,
  height: 64,
  frameRate: 30,
  bitrate: 2_000_000,
  bitrateMode: "cbr",
  quality: 0.7,
  keyframeInterval: 2,
  audioSettings: { format: "aac", bitrate: 128_000, sampleRate: 48_000, channels: 2, bitDepth: 16 },
} as unknown as VideoExportSettings;

function makeProject(durationSec: number): Project {
  return {
    id: "proj-web",
    name: "web",
    mediaLibrary: { items: [] },
    timeline: { tracks: [], duration: durationSec, markers: [], subtitles: [] },
  } as unknown as Project;
}

/** Fake per-segment encode: writes the segment's start time into the sink. */
function fakeRunSegment(): NonNullable<Parameters<typeof runWebSegmentedExport>[3]["runSegmentImpl"]> {
  return async (_project, segmentSettings, writable) => {
    await writable.seek(0);
    await writable.write(new TextEncoder().encode(`SEG@${segmentSettings.range!.startTime.toFixed(2)};`));
  };
}

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

/** Recording writable that captures writes and closes/aborts state. */
function recordingWritable() {
  const state = { closed: false, aborted: false, text: "" };
  const writable = {
    async seek() {},
    async write(data: unknown) {
      state.text += new TextDecoder().decode(data as Uint8Array);
    },
    async close() { state.closed = true; },
    async abort() { state.aborted = true; },
    async truncate() {},
  } as unknown as FileSystemWritableFileStream;
  return { writable, state };
}

describe("runWebSegmentedExport", () => {
  it("encodes segments, merges in order, and streams the blob to the writable", async () => {
    const project = makeProject(4);
    const { writable, state } = recordingWritable();
    const progress: string[] = [];
    const checkpointer = createMemoryCheckpointer();

    await runWebSegmentedExport(
      project,
      { ...settings, segmented: { segmentCount: 2 } } as unknown as VideoExportSettings,
      writable,
      {
        assertNotCancelled: () => {},
        reportProgress: (p, phase) => progress.push(`${Math.round(p * 100)}%:${phase}`),
        checkpointer,
        runSegmentImpl: fakeRunSegment(),
        mergeImpl: fakeMerge(),
      },
    );

    expect(state.closed).toBe(true);
    expect(state.text).toContain("SEG@");
    expect(progress.some((entry) => entry.endsWith("%:saving"))).toBe(true);
    // Checkpoint cleared after success.
    expect(await checkpointer.load(checkpointKey(settings, "proj-web"))).toBeNull();
  });

  it("reports per-segment overlay progress", async () => {
    const project = makeProject(2);
    const { writable } = recordingWritable();
    const progress: { p: number; phase: string }[] = [];

    await runWebSegmentedExport(
      project,
      { ...settings, segmented: { segmentCount: 2 } } as unknown as VideoExportSettings,
      writable,
      {
        assertNotCancelled: () => {},
        reportProgress: (p, phase) => progress.push({ p, phase }),
        checkpointer: createMemoryCheckpointer(),
        runSegmentImpl: async (_p, segmentSettings, segWritable) => {
          // Simulate in-segment progress via the service's overlay math by
          // emitting two writes; the service reports from the generator in the
          // default runner, so with an injected runner the overlay comes from
          // onProgress only.
          await segWritable.seek(0);
          await segWritable.write(new TextEncoder().encode(`S@${segmentSettings.range!.startTime};`));
        },
        mergeImpl: fakeMerge(),
      },
    );

    // onProgress emits before each segment: completed 0 then 1 of 2.
    expect(progress.some((entry) => entry.phase.includes("分段 1/2"))).toBe(true);
    expect(progress.some((entry) => entry.phase.includes("分段 2/2"))).toBe(true);
  });

  it("resumes: skips segments already in the checkpoint", async () => {
    const project = makeProject(2);
    const { writable, state } = recordingWritable();
    const checkpointer = createMemoryCheckpointer();
    const key = checkpointKey({ ...settings, segmented: { segmentCount: 2 } }, "proj-web");
    await checkpointer.save({
      key,
      completedSegmentIndexes: [0],
      segmentDurations: [1],
      segmentBlobs: [new Blob([new TextEncoder().encode("RESTORED;")]), null],
      updatedAt: 1,
    });

    const encoded: number[] = [];
    await runWebSegmentedExport(
      project,
      { ...settings, segmented: { segmentCount: 2 } } as unknown as VideoExportSettings,
      writable,
      {
        assertNotCancelled: () => {},
        reportProgress: () => {},
        checkpointer,
        runSegmentImpl: async (_p, segmentSettings, segWritable) => {
          encoded.push(segmentSettings.range!.startTime);
          await segWritable.seek(0);
          await segWritable.write(new TextEncoder().encode("NEW;"));
        },
        mergeImpl: fakeMerge(),
      },
    );

    expect(encoded).toEqual([1]); // only the second segment encoded
    expect(state.text).toBe("RESTORED;NEW;");
  });

  it("throws with the merge error and aborts the writable when merging fails", async () => {
    const project = makeProject(2);
    const { writable, state } = recordingWritable();
    const { SegmentMergeError } = await import("@openreel/core");

    await expect(
      runWebSegmentedExport(
        project,
        { ...settings, segmented: { segmentCount: 2 } } as unknown as VideoExportSettings,
        writable,
        {
          assertNotCancelled: () => {},
          reportProgress: () => {},
          checkpointer: createMemoryCheckpointer(),
          runSegmentImpl: async (_p, _s, segWritable) => {
            await segWritable.seek(0);
            await segWritable.write(new TextEncoder().encode("X"));
          },
          mergeImpl: async () => new SegmentMergeError("WASM ffmpeg unavailable"),
        },
      ),
    ).rejects.toThrow(/WASM ffmpeg unavailable/);
    expect(state.aborted).toBe(true);
    expect(state.closed).toBe(false);
  });

  it("propagates cancellation from the segment runner and aborts", async () => {
    const project = makeProject(2);
    const { writable, state } = recordingWritable();
    const cancelled = vi.fn(() => {
      throw new DOMException("Export cancelled", "AbortError");
    });

    await expect(
      runWebSegmentedExport(
        project,
        { ...settings, segmented: { segmentCount: 2 } } as unknown as VideoExportSettings,
        writable,
        {
          assertNotCancelled: cancelled,
          reportProgress: () => {},
          checkpointer: createMemoryCheckpointer(),
          runSegmentImpl: fakeRunSegment(),
          mergeImpl: fakeMerge(),
        },
      ),
    ).rejects.toThrow(/cancelled/);
    expect(state.aborted).toBe(true);
  });
});
