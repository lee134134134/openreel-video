import { describe, expect, it } from "vitest";
import { FFmpegFallback } from "./ffmpeg-fallback";

describe("FFmpegFallback.concatSegmentFiles", () => {
  it("loads inputs one at a time and frees MEMFS inputs before reading the merged output", async () => {
    const events: string[] = [];
    const fakeFfmpeg = {
      load: () => Promise.resolve(),
      writeFile: (name: string, _data: Uint8Array) => {
        events.push(`write:${name}`);
        return Promise.resolve();
      },
      readFile: (name: string) => {
        events.push(`read:${name}`);
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
      deleteFile: (name: string) => {
        events.push(`delete:${name}`);
        return Promise.resolve();
      },
      exec: () => Promise.resolve(0),
      on: () => {},
      off: () => {},
      terminate: () => {},
    };

    const fallback = new FFmpegFallback();
    (fallback as unknown as { loaded: boolean }).loaded = true;
    (fallback as unknown as { ffmpeg: typeof fakeFfmpeg }).ffmpeg = fakeFfmpeg;

    const inputs = [
      { name: "seg-0001.mp4", load: () => Promise.resolve(new Uint8Array([10])) },
      { name: "seg-0002.mp4", load: () => Promise.resolve(new Uint8Array([20])) },
    ];

    const result = await fallback.concatSegmentFiles(inputs, "output.mp4");
    expect(result).toEqual(new Uint8Array([1, 2, 3]));

    expect(events).toContain("write:seg-0001.mp4");
    expect(events).toContain("write:seg-0002.mp4");

    const readOutputIndex = events.indexOf("read:output.mp4");
    expect(readOutputIndex).toBeGreaterThan(-1);

    // MEMFS inputs (and the concat script) must be removed before the output
    // is read back, otherwise the wasm heap holds inputs + output at once.
    expect(readOutputIndex).toBeGreaterThan(events.indexOf("delete:seg-0001.mp4"));
    expect(readOutputIndex).toBeGreaterThan(events.indexOf("delete:seg-0002.mp4"));
    expect(readOutputIndex).toBeGreaterThan(events.indexOf("delete:concat-list.txt"));

    // Output read must happen before output cleanup.
    expect(events.indexOf("delete:output.mp4")).toBeGreaterThan(readOutputIndex);
  });

  it("returns null when ffmpeg is unavailable", async () => {
    const fallback = new FFmpegFallback();
    (fallback as unknown as { loaded: boolean }).loaded = true;
    (fallback as unknown as { ffmpeg: null }).ffmpeg = null;

    const result = await fallback.concatSegmentFiles([
      { name: "seg.mp4", load: () => Promise.resolve(new Uint8Array([1])) },
    ]);
    expect(result).toBeNull();
  });
});
