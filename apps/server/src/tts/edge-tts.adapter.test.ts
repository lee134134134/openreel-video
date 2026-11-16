import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PluginContext } from "@openreel/plugin-sdk";
import { EdgeTtsAdapter, EDGE_TTS_VOICES } from "./edge-tts.adapter";
import {
  hasBinary,
  probeAudioDuration,
  probeAudioDurationUse,
  probeVideoDuration,
  probeVideoDurationUse,
  run,
} from "../render/ffmpeg.utils";

vi.mock("../render/ffmpeg.utils", () => ({
  run: vi.fn(async (args: string[]) => {
    const out = args[args.length - 1];
    if (out) fs.writeFileSync(out, Buffer.alloc(0));
    return { code: 0, stdout: "", stderr: "" };
  }),
  probeAudioDuration: vi.fn(async () => 1.23),
  probeAudioDurationUse: vi.fn(async () => 1.23),
  probeVideoDurationUse: vi.fn(async () => 1.23),
  probeVideoDuration: vi.fn(async () => 1.23),
  hasBinary: vi.fn(async () => true),
}));

const execFileMock = vi.hoisted(() =>
  vi.fn((cmd: string, args: string[], opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    const mediaIndex = args.indexOf("--write-media");
    if (mediaIndex >= 0 && args[mediaIndex + 1]) {
      fs.writeFileSync(args[mediaIndex + 1], Buffer.from("fakemp3"));
    }
    cb(null, "", "");
  }),
);

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

let dir: string | undefined;

beforeEach(() => {
  // Point the adapter at an existing binary so ensureClient() short-circuits
  // and never tries to run the real setup.sh from tests.
  process.env.EDGE_TTS_PYTHON = process.execPath;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EDGE_TTS_PYTHON;
  execFileMock.mockClear();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("EdgeTtsAdapter", () => {
  it("lists curated natural voices", async () => {
    const voices = await new EdgeTtsAdapter().voices({} as PluginContext);
    expect(voices.map((voice) => voice.id)).toEqual(EDGE_TTS_VOICES.map((voice) => voice.id));
    expect(voices[0].label).toContain("晓晓");
  });

  it("synthesizes to a normalized wav and reports probed duration", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-edge-"));
    const result = await new EdgeTtsAdapter().synthesize("你好", { voiceId: "mock" }, { dir, basename: "e1" }, {} as PluginContext);
    expect(result.voiceId).toBe("zh-CN-XiaoxiaoNeural");
    expect(result.durationSec).toBe(1.23);
    expect(result.audioPath).toBe(path.join(dir, "e1.wav"));
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe(process.execPath);
    expect(args).toContain("-m");
    expect(args).toContain("edge_tts");
    expect(args).toContain("zh-CN-XiaoxiaoNeural");
    expect(args).toContain("--text");
  });

  it("maps speed to the edge rate option", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-edge-"));
    await new EdgeTtsAdapter().synthesize("t", { voiceId: "zh-CN-YunxiNeural", speed: 1.2 }, { dir, basename: "e2" }, {} as PluginContext);
    const [, args1] = execFileMock.mock.calls[0];
    expect(args1.join(" ")).toContain("--rate=+20%");

    await new EdgeTtsAdapter().synthesize("t", { voiceId: "zh-CN-YunxiNeural", speed: 0.5 }, { dir, basename: "e3" }, {} as PluginContext);
    const [, args2] = execFileMock.mock.calls[1];
    expect(args2.join(" ")).toContain("--rate=-50%");
  });

  it("wraps CLI failures in a Chinese error", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-edge-"));
    execFileMock.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(new Error("boom"), "", "");
    });
    await expect(
      new EdgeTtsAdapter().synthesize("t", { voiceId: "mock" }, { dir, basename: "e4" }, {} as PluginContext),
    ).rejects.toThrow(/Edge TTS 合成失败/);
  });
});
