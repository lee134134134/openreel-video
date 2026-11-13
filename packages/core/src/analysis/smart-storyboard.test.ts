import { describe, expect, it } from "vitest";
import { buildStoryboard, silenceRangesFromAudio } from "./smart-storyboard";

const metrics = (start: number, end: number, rmsDb: number, isSilence = false) => ({
  start,
  end,
  rmsDb,
  peakDb: rmsDb + 2,
  speechRate: 2,
  isSilence,
});

describe("silenceRangesFromAudio", () => {
  it("merges contiguous silent segments and clamps nothing", () => {
    const ranges = silenceRangesFromAudio([
      metrics(0, 5, -60, true),
      metrics(5, 10, -60, true),
      metrics(10, 15, -20, false),
      metrics(15, 20, -60, true),
    ]);
    expect(ranges).toEqual([
      { start: 0, end: 10 },
      { start: 15, end: 20 },
    ]);
  });

  it("returns nothing when all segments are loud", () => {
    expect(silenceRangesFromAudio([metrics(0, 5, -20), metrics(5, 10, -18)])).toEqual([]);
  });
});

describe("buildStoryboard", () => {
  it("falls back to a single shot without scenes", () => {
    const storyboard = buildStoryboard({ durationSec: 8, scenes: [] });
    expect(storyboard.shots).toEqual([
      expect.objectContaining({ start: 0, end: 8, kind: "scene" }),
    ]);
  });

  it("extends shots to cover the full duration", () => {
    const storyboard = buildStoryboard({
      durationSec: 10,
      scenes: [
        { start: 0, end: 4, score: 0.8 },
        { start: 4, end: 7, score: 0.9 },
      ],
    });
    expect(storyboard.shots).toHaveLength(3);
    expect(storyboard.shots[2]).toMatchObject({ start: 7, end: 10 });
    expect(storyboard.summary).toContain("3 个镜头");
  });

  it("promotes shots overlapping loud audio to highlights with titles", () => {
    const storyboard = buildStoryboard({
      durationSec: 10,
      scenes: [
        { start: 0, end: 5, score: 0.5 },
        { start: 5, end: 10, score: 0.5 },
      ],
      audioSegments: [metrics(1, 4, -8), metrics(4, 6, -12), metrics(6, 9, -30, false)],
      transcriptWords: [
        { start: 1.5, end: 2.5, text: "今天我们来讲" },
        { start: 6.5, end: 7.5, text: "低能量部分" },
      ],
    });
    const first = storyboard.shots[0];
    const second = storyboard.shots[1];
    expect(first.kind).toBe("highlight");
    expect(first.title).toContain("今天我们来讲");
    expect(second.kind).toBe("scene");
    expect(second.title).toContain("低能量部分");
    expect(first.score).toBeGreaterThan(second.score);
  });

  it("reports silence ranges from audio segments", () => {
    const storyboard = buildStoryboard({
      durationSec: 10,
      scenes: [{ start: 0, end: 10, score: 0 }],
      audioSegments: [metrics(0, 2, -60, true), metrics(2, 10, -15)],
    });
    expect(storyboard.silenceRanges).toEqual([{ start: 0, end: 2 }]);
  });

  it("filters out shots below MIN_SHOT_SEC", () => {
    const storyboard = buildStoryboard({
      durationSec: 10,
      scenes: [
        { start: 0, end: 0.2, score: 0.9 },
        { start: 0.2, end: 10, score: 0.9 },
      ],
    });
    expect(storyboard.shots).toHaveLength(1);
    expect(storyboard.shots[0].start).toBeCloseTo(0.2, 5);
  });
});
