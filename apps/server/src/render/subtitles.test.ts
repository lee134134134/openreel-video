import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSubtitleAss, detectSubtitleSupport, escapeFilterPath, resetSubtitleSupportCache } from "./subtitles";

const execFileMock = vi.hoisted(() =>
  vi.fn((cmd: string, args: string[], opts: unknown, cb: (err: Error | null, value?: unknown) => void) => {
    cb(null, { stdout: "", stderr: "" });
  }),
);

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

afterEach(() => {
  execFileMock.mockClear();
  resetSubtitleSupportCache();
});

function stdoutOf(text: string): void {
  execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => cb(null, { stdout: text, stderr: "" }));
}

describe("detectSubtitleSupport", () => {
  it("prefers drawtext when the build ships libfreetype", async () => {
    stdoutOf(" ... drawtext  V->V  Draw text on top of video frames.\n T.. subtitles ...");
    await expect(detectSubtitleSupport("/ffmpeg-a")).resolves.toBe("drawtext");
  });

  it("falls back to libass subtitles when drawtext is absent", async () => {
    stdoutOf(" T.. subtitles  V->V  Render text subtitles onto input video.");
    await expect(detectSubtitleSupport("/ffmpeg-b")).resolves.toBe("ass");
  });

  it("reports none when neither filter exists or the probe fails", async () => {
    stdoutOf(" T.. scale  V->V  Scale the input video size.");
    await expect(detectSubtitleSupport("/ffmpeg-c")).resolves.toBe("none");

    execFileMock.mockImplementationOnce((_cmd, _args, _opts, cb) => cb(new Error("no ffmpeg")));
    await expect(detectSubtitleSupport("/ffmpeg-d")).resolves.toBe("none");
  });

  it("caches the probe per binary", async () => {
    stdoutOf(" drawtext ");
    await detectSubtitleSupport("/ffmpeg-cached");
    await detectSubtitleSupport("/ffmpeg-cached");
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });
});

describe("buildSubtitleAss", () => {
  it("writes a PlayRes-matched ASS header with a readable default style", () => {
    const ass = buildSubtitleAss([{ startSec: 0, endSec: 1.5, text: "第一句" }], 1920, 1080, "PingFang SC");
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("Style: Default,PingFang SC,49,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,第一句");
  });

  it("escapes newlines and braces so user text cannot break the script", () => {
    const ass = buildSubtitleAss(
      [{ startSec: 2, endSec: 3.25, text: "line1\nline2 {override}" }],
      1280,
      720,
      "Noto Sans CJK SC",
    );
    expect(ass).toContain("line1\\Nline2 override");
    expect(ass).not.toContain("{override}");
    expect(ass).toContain("0:00:02.00,0:00:03.25");
  });

  it("clamps negative times and scales the font with the shorter side", () => {
    const ass = buildSubtitleAss([{ startSec: -1, endSec: 0.5, text: "x" }], 720, 1280, "sans");
    // min(720,1280) * 0.045 = 32
    expect(ass).toContain("Style: Default,sans,32,");
    expect(ass).toContain("0:00:00.00,0:00:00.50");
  });
});

describe("escapeFilterPath", () => {
  it("escapes filtergraph metacharacters", () => {
    expect(escapeFilterPath("/tmp/a:b,c[d]'e\\f.srt")).toBe("/tmp/a\\:b\\,c\\[d\\]\\'e\\\\f.srt");
  });
});
