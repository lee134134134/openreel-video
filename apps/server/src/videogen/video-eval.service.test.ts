import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { VideogenPlan } from "@openreel/plugin-sdk";
import type { SettingsService } from "../config/settings.module";
import type { OpencodeClient } from "../llm/opencode.client";
import { run } from "../render/ffmpeg.utils";
import { VideoEvalService } from "./video-eval.service";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "videogen-eval-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const plan: VideogenPlan = {
  options: { title: "测试", aspectRatio: "16:9", fps: 30, resolution: 720 },
  scenes: [],
  estimatedDurationSec: 2,
};

function service(): VideoEvalService {
  const settings = { settings: { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" } } as unknown as SettingsService;
  const llm = { complete: async () => ({ content: "" }) } as unknown as OpencodeClient;
  return new VideoEvalService(settings, llm);
}

async function makeVideo(name: string, source: string): Promise<string> {
  const output = path.join(dir, name);
  const result = await run([
    "-y", "-f", "lavfi", "-i", source, "-t", "2", "-r", "30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", output,
  ], { command: "ffmpeg", timeoutSec: 30 });
  expect(result.code, result.stderr.slice(-400)).toBe(0);
  return output;
}

describe("video quality self-check", () => {
  it("flags a frozen slideshow-like video and scores a moving video higher", async () => {
    process.env.VIDEO_EVAL_VISION = "0";
    const still = await makeVideo("still.mp4", "color=c=blue:s=640x360");
    // testsrc2 keeps changing every frame, so freezedetect should report ~0.
    const moving = await makeVideo("moving.mp4", "testsrc2=s=640x360");

    const stillReport = await service().evaluate(still, plan, dir);
    const movingReport = await service().evaluate(moving, plan, dir);

    expect(stillReport.metrics.width).toBe(640);
    expect(stillReport.metrics.height).toBe(360);
    expect(stillReport.metrics.fps).toBeGreaterThanOrEqual(29);
    expect(stillReport.metrics.freezeRatio).toBeGreaterThan(0.5);
    expect(stillReport.passed).toBe(false);
    expect(stillReport.issues.join(" ")).toMatch(/静止|幻灯片/);
    expect(stillReport.suggestions.join(" ")).toMatch(/运动|视频生成/);

    expect(movingReport.metrics.freezeRatio).toBeLessThan(stillReport.metrics.freezeRatio);
    expect(movingReport.score).toBeGreaterThan(stillReport.score);
  }, 30_000);
});
