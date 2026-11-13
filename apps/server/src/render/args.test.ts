import { describe, expect, it } from "vitest";
import { buildAssembleArgs, buildTranscodeArgs, escapeDrawtext } from "./args";
import { buildSubtitleAss } from "./subtitles";

describe("render argument builders", () => {
  it("builds a parity-safe transcode command", () => {
    const args = buildTranscodeArgs({ input: "in.mov", output: "out.mp4", scaleWidth: 1280, fps: 30 });
    expect(args.slice(0, 3)).toEqual(["-y", "-i", "in.mov"]);
    expect(args).toContain("scale=1280:-2");
    expect(args).toContain("libx264");
    expect(args[args.length - 1]).toBe("out.mp4");
    expect(args.slice(args.indexOf("-r") + 1, args.indexOf("-r") + 2)).toEqual(["30"]);
  });

  it("builds concat, canvas, audio and escaped subtitle filters", () => {
    const args = buildAssembleArgs({
      output: "joined.mp4", width: 640, height: 360, fps: 24,
      segments: [
        { path: "a.png", durationSec: 2, audioPath: "a.wav", subtitle: "It's: 50%, [ok]" },
        { path: "b.mp4", startSec: 1, endSec: 4 },
      ],
      subtitles: [{ text: "hello", startSec: 0, endSec: 1 }],
      audioTracks: [{ fileRef: "music.mp3", volume: 0.2, delaySec: 1 }],
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("concat=n=2:v=1:a=0");
    expect(graph).toContain("pad=640:360");
    expect(graph.match(/drawtext=/g)).toHaveLength(2);
    expect(graph).toContain("amix=inputs=2");
    expect(graph).toContain("It\\'s\\: 50\\%\\, \\[ok\\]");
    expect(args).toContain("yuv420p");
    expect(args).toContain("+faststart");
    expect(escapeDrawtext("a\\b:c'd")).toBe("a\\\\b\\:c\\'d");
  });

  it("uses the subtitles filter with an ASS file when drawtext is unavailable", () => {
    const args = buildAssembleArgs({
      output: "joined.mp4", width: 1280, height: 720, fps: 30,
      segments: [{ path: "a.png", durationSec: 2, subtitle: "你好" }],
      subtitleMode: "ass",
      subtitleFile: "/tmp/render/subs.ass",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("subtitles=filename='/tmp/render/subs.ass'");
    expect(graph).not.toContain("drawtext");
  });

  it("skips subtitle burning entirely when no text filter is available", () => {
    const args = buildAssembleArgs({
      output: "joined.mp4", width: 1280, height: 720, fps: 30,
      segments: [{ path: "a.png", durationSec: 2, subtitle: "你好" }],
      subtitleMode: "none",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("drawtext");
    expect(graph).not.toContain("subtitles=");
  });

  it("builds an ASS subtitle file with video-sized PlayRes and dialogue lines", () => {
    const ass = buildSubtitleAss(
      [
        { text: "第一段", startSec: 0, endSec: 2.5 },
        { text: "第二段", startSec: 2.5, endSec: 5 },
      ],
      1280, 720, "PingFang SC",
    );
    expect(ass).toContain("PlayResX: 1280");
    expect(ass).toContain("PlayResY: 720");
    expect(ass).toContain("Style: Default,PingFang SC,32,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.50,Default,,0,0,0,,第一段");
    expect(ass).toContain("Dialogue: 0,0:00:02.50,0:00:05.00,Default,,0,0,0,,第二段");
  });
});
