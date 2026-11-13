import { describe, expect, it } from "vitest";
import { buildAssembleArgs, buildTranscodeArgs, escapeDrawtext } from "./args";

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
});
