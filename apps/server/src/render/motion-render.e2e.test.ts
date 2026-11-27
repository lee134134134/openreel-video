import { spawnSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildAssembleArgs } from "./args";
import { run } from "./ffmpeg.utils";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffmpegReady = spawnSync(ffmpeg, ["-version"], { stdio: "ignore" }).status === 0;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-motion-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("rendered camera motion", () => {
  it.skipIf(!ffmpegReady)("makes a still image visibly move instead of staying frozen", async () => {
    const image = path.join(dir, "still.png");
    // A detailed still (not a solid color) so a real camera move is measurable.
    const made = await run([
      "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360", "-frames:v", "1", "-update", "1", image,
    ], { command: ffmpeg, timeoutSec: 30 });
    expect(made.code, made.stderr.slice(-300)).toBe(0);

    const output = path.join(dir, "out.mp4");
    const args = buildAssembleArgs({
      output, width: 640, height: 360, fps: 30,
      segments: [{ path: image, durationSec: 3, motion: "dynamic" }],
      subtitleMode: "none",
    });
    const rendered = await run(["-nostats", ...args], { command: ffmpeg, timeoutSec: 60 });
    expect(rendered.code, rendered.stderr.slice(-600)).toBe(0);

    const probe = await run([
      "-hide_banner", "-nostats", "-i", output,
      "-vf", "freezedetect=n=0.003:d=0.4", "-an", "-f", "null", "-",
    ], { command: ffmpeg, timeoutSec: 60 });
    // A moving camera must not produce a long frozen interval.
    const starts = probe.stderr.match(/freeze_start:/g) ?? [];
    expect(starts.length, probe.stderr.slice(-600)).toBe(0);
  }, 60_000);

  it.skipIf(!ffmpegReady)("cross-dissolves multiple keyframes into one continuous shot", async () => {
    const frames: string[] = [];
    for (let beat = 0; beat < 3; beat += 1) {
      const frame = path.join(dir, `beat-${beat}.png`);
      const made = await run([
        "-y", "-f", "lavfi", "-i", `testsrc2=s=640x360`, "-vf", `hue=h=${beat * 50}`,
        "-frames:v", "1", "-update", "1", frame,
      ], { command: ffmpeg, timeoutSec: 30 });
      expect(made.code, made.stderr.slice(-300)).toBe(0);
      frames.push(frame);
    }

    const output = path.join(dir, "continuous.mp4");
    const args = buildAssembleArgs({
      output, width: 640, height: 360, fps: 30,
      segments: [{ path: frames[0], frames, durationSec: 3, motion: "zoom-in" }],
      subtitleMode: "none",
    });
    const rendered = await run(["-nostats", ...args], { command: ffmpeg, timeoutSec: 60 });
    expect(rendered.code, rendered.stderr.slice(-900)).toBe(0);

    const probe = await run([
      "-hide_banner", "-nostats", "-i", output,
      "-vf", "freezedetect=n=0.003:d=0.4", "-an", "-f", "null", "-",
    ], { command: ffmpeg, timeoutSec: 60 });
    const starts = probe.stderr.match(/freeze_start:/g) ?? [];
    expect(starts.length, probe.stderr.slice(-600)).toBe(0);

    const duration = await run([
      "-hide_banner", "-nostats", "-i", output, "-f", "null", "-",
    ], { command: ffmpeg, timeoutSec: 30 });
    // The scene keeps its exact duration (3s × 30fps = 90 frames).
    expect(duration.stderr).toMatch(/frame=\s*90\b/);
  }, 90_000);
});
