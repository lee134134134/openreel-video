import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { executeRenderJob } from "./executors";
import { probeVideoDuration, run } from "./ffmpeg.utils";
import type { RenderJobRow } from "./render.service";

const ffmpegReady = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const temporary: string[] = [];
afterEach(() => {
  while (temporary.length) fs.rmSync(temporary.pop()!, { recursive: true, force: true });
});

describe("transcode executor", () => {
  it.skipIf(!ffmpegReady)("renders a real one-second MP4", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-render-test-"));
    temporary.push(dir);
    const input = path.join(dir, "input.mp4");
    const generated = await run(["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=1", "-pix_fmt", "yuv420p", input]);
    expect(generated.code).toBe(0);
    const row: RenderJobRow = {
      id: crypto.randomUUID(), kind: "transcode", state: "queued", progress: 0,
      outputFormat: "mp4", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const result = await executeRenderJob(row, { input, transcodeOptions: { crfLevel: 28 } }, {
      jobsDir: dir, ffmpegPath: "ffmpeg", ffprobePath: "ffprobe",
    });
    expect(fs.existsSync(result.outputPath)).toBe(true);
    expect(result.outputUrl).toBe(`/api/files/jobs/${row.id}.mp4`);
    expect(await probeVideoDuration(result.outputPath)).toBeCloseTo(1, 1);
  }, 20000);
});
