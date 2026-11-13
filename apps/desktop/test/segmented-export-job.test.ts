import { describe, it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promises as fs, existsSync } from "node:fs";
import {
  buildConcatArgs,
  buildSegmentListScript,
  checkResumeSegments,
  concatSegmentFiles,
  parseFfmpegDuration,
  probeSegmentDuration,
} from "../src/main/sidecar/segmented-export-job";
import {
  resolveFfmpegPath,
  ffmpegRelativePath,
} from "../src/main/sidecar/ffmpeg-path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

// In vitest, __dirname inside ffmpeg-path.ts resolves to the test directory,
// so pin the binary path relative to the repo layout (same as
// export-integration.test.ts); resources/bin is gitignored.
vi.mock("../src/main/sidecar/ffmpeg-path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/sidecar/ffmpeg-path")>();
  const bin = path.resolve(
    __dirname,
    "../resources/bin",
    actual.ffmpegRelativePath(process.platform, process.arch),
  );
  return { ...actual, resolveFfmpegPath: () => bin };
});

describe("parseFfmpegDuration", () => {
  it("parses the Duration banner line", () => {
    const stderr = [
      "Input #0, mov,mp4,m4a, from 'seg.mp4':",
      "  Duration: 00:01:02.500000, start: 0.000000, bitrate: 1200 kb/s",
      "  Stream #0:0: Video: h264, yuv420p, 1920x1080, 30 fps",
    ].join("\n");
    expect(parseFfmpegDuration(stderr)).toBeCloseTo(62.5, 4);
  });

  it("returns null when no duration is present", () => {
    expect(parseFfmpegDuration("no banner here")).toBeNull();
  });

  it("handles sub-second durations", () => {
    expect(parseFfmpegDuration("  Duration: 00:00:00.033333,")).toBeCloseTo(0.033333, 6);
  });
});

describe("buildSegmentListScript", () => {
  it("emits concat-demuxer lines for absolute paths", () => {
    expect(
      buildSegmentListScript(["/tmp/a.seg-0000.mp4", "/tmp/a.seg-0001.mp4"]),
    ).toBe("file '/tmp/a.seg-0000.mp4'\nfile '/tmp/a.seg-0001.mp4'\n");
  });

  it("escapes quote characters per concat-demuxer syntax", () => {
    expect(buildSegmentListScript(["/tm'p/x.mp4"])).toBe("file '/tm'\\''p/x.mp4'\n");
  });
});

describe("buildConcatArgs", () => {
  it("builds a stream-copy concat command", () => {
    expect(buildConcatArgs("/tmp/list.txt", "/tmp/out.mp4")).toEqual([
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", "/tmp/list.txt",
      "-c", "copy",
      "/tmp/out.mp4",
    ]);
  });
});

describe("checkResumeSegments / concatSegmentFiles (real ffmpeg)", () => {
  const ffmpegBin = resolveFfmpegPath();
  const HAS_FFMPEG = existsSync(ffmpegBin);
  const stamp = Date.now();
  const dir = path.join(tmpdir(), `openreel-seg-test-${stamp}`);

  describe.skipIf(!HAS_FFMPEG)("with the fetched binary", () => {
    it("marks only duration-matching segments complete and merges the rest", async () => {
      await fs.mkdir(dir, { recursive: true });
      // Segment A: exactly 1s @ 25fps testsrc. Segment B: corrupt file.
      const goodPath = path.join(dir, "seg-0000.mp4");
      const badPath = path.join(dir, "seg-0001.mp4");
      await runFfmpeg(ffmpegBin, [
        "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=128x96:rate=25",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        goodPath,
      ]);
      await fs.writeFile(badPath, Buffer.from("not a video"));

      const result = await checkResumeSegments(
        ffmpegBin,
        [
          { path: goodPath, expectedDurationSec: 1 },
          { path: badPath, expectedDurationSec: 1 },
          { path: path.join(dir, "missing.mp4"), expectedDurationSec: 1 },
        ],
        25,
      );
      expect(result.completed).toEqual([0]);
      expect(result.invalid.map((entry) => entry.index)).toEqual([1, 2]);

      // Concat a good file with itself produces a 2s output.
      const mergedPath = path.join(dir, "merged.mp4");
      const merge = await concatSegmentFiles(ffmpegBin, [goodPath, goodPath], mergedPath);
      expect(merge.ok).toBe(true);
      expect(merge.code).toBe(0);
      const duration = await probeSegmentDuration(ffmpegBin, mergedPath);
      expect(duration).toBeCloseTo(2, 1);

      // Empty input list fails cleanly.
      const empty = await concatSegmentFiles(ffmpegBin, [], mergedPath);
      expect(empty.ok).toBe(false);
    }, 30_000);

    async function runFfmpeg(bin: string, args: string[]): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(bin, args);
        let stderr = "";
        proc.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        proc.on("error", reject);
        proc.on("close", (code) =>
          code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-400)}`)),
        );
      });
    }
  });

  it("reports probe failures when the binary is missing", async () => {
    const existing = path.join(tmpdir(), `openreel-seg-probe-${stamp}.txt`);
    await fs.writeFile(existing, "x");
    const result = await checkResumeSegments(
      "/nonexistent/ffmpeg",
      [{ path: existing, expectedDurationSec: 1 }],
      30,
    );
    expect(result.completed).toEqual([]);
    expect(result.invalid[0]?.reason).toBe("unprobeable");
  });
});
