import { describe, expect, it } from "vitest";
import { buildAssembleArgs, buildTranscodeArgs, escapeDrawtext, motionZoomPan } from "./args";
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

  it("keeps static slides completely still and applies only gentle fades", () => {
    const args = buildAssembleArgs({
      output: "joined.mp4", width: 640, height: 360, fps: 24,
      segments: [
        { path: "a.png", durationSec: 2, motion: "static" },
        { path: "b.mp4", durationSec: 2, motion: "static" },
      ],
      subtitleMode: "none",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).not.toContain("zoompan=");
    expect(graph).toContain("pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0xF5F5F7");
    expect(graph).toContain("fade=t=in:st=0:d=0.3");
    expect(graph).toContain("fade=t=out:st=1.700:d=0.3");
  });

  it("allows an explicit legacy camera move but keeps it subtle", () => {
    const args = buildAssembleArgs({
      output: "joined.mp4", width: 640, height: 360, fps: 24,
      segments: [
        { path: "a.png", durationSec: 2, motion: "zoom-in" },
        { path: "b.mp4", durationSec: 2, motion: "zoom-in" },
      ],
      subtitleMode: "none",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("zoompan=z='1+0.06*on/48'");
    expect(graph).toContain("d=1:s=640x360:fps=24");
    // Real video clips must not be zoompanned — only still images.
    expect(graph.match(/zoompan=/g)).toHaveLength(1);
  });

  it("builds one clean slide sequence from multiple keyframes without camera moves", () => {
    const args = buildAssembleArgs({
      output: "joined.mp4", width: 640, height: 360, fps: 30,
      segments: [
        { path: "a.png", durationSec: 6, motion: "static", frames: ["a1.png", "a2.png", "a3.png"], audioPath: "a.wav" },
        { path: "b.mp4", durationSec: 2, audioPath: "b.wav" },
      ],
      subtitleMode: "none",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    // Three static slides are cross-dissolved into one six-second scene.
    expect(graph).not.toContain("zoompan=");
    expect(graph).toContain("xfade=transition=fade:duration=0.500:offset=1.833");
    expect(graph).toContain("xfade=transition=fade:duration=0.500:offset=3.667");
    expect(graph).toContain("trim=duration=6.000");
    // No film grade: clean slides with white/gray background instead of grain/vignette.
    expect(graph).toContain("[kx0_2]trim=duration=6.000,setpts=PTS-STARTPTS[v0]");
    expect(graph).not.toContain("noise=alls=");
    expect(graph).not.toContain("vignette=");
    expect(graph).toContain("color=0xF5F5F7");
    // Audio inputs must start after every video input (3 keyframes + 1 clip).
    expect(graph).toContain("[4:a]");
    expect(graph).toContain("[5:a]");
  });

  it("returns no filter for static slides and subtle moves for legacy motions", () => {
    expect(motionZoomPan("static", 60, 640, 360, 30)).toBe("");
    expect(motionZoomPan(undefined, 60, 640, 360, 30)).toBe("");
    const dynamic = motionZoomPan("dynamic", 60, 640, 360, 30);
    expect(dynamic).toContain("1+0.06*on/60");
    expect(dynamic).not.toContain("sin(");
    expect(motionZoomPan("pan-left", 60, 640, 360, 30)).toContain("(1-on/60)");
    expect(motionZoomPan("pan-left", 60, 640, 360, 30)).toContain("z='1.04+0.04*on/60'");
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
