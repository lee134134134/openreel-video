import type { SceneSpan } from "./scene-detection";

export interface StoryboardShot {
  readonly start: number;
  readonly end: number;
  readonly score: number;
  readonly title?: string;
  readonly reason?: string;
  readonly kind: "scene" | "highlight";
}

export interface SilenceRange {
  readonly start: number;
  readonly end: number;
}

export interface Storyboard {
  readonly shots: StoryboardShot[];
  readonly silenceRanges: SilenceRange[];
  readonly summary: string;
}

export interface StoryboardInput {
  readonly durationSec: number;
  readonly scenes: SceneSpan[];
  /** Per-segment audio metrics from `analyzeAudioForHighlights` (optional). */
  readonly audioSegments?: readonly {
    readonly start: number;
    readonly end: number;
    readonly rmsDb: number;
    readonly peakDb: number;
    readonly isSilence: boolean;
  }[];
  /** Optional transcript words used to title shots. */
  readonly transcriptWords?: readonly { start: number; end: number; text: string }[];
}

export const MIN_SHOT_SEC = 0.3;

/**
 * Collapse audio segments into contiguous silence ranges (clamped to duration).
 */
export function silenceRangesFromAudio(
  segments: readonly { start: number; end: number; isSilence: boolean }[],
): SilenceRange[] {
  const ranges: { start: number; end: number }[] = [];
  let open: { start: number; end: number } | null = null;
  for (const segment of segments) {
    if (!segment.isSilence) {
      if (open) {
        ranges.push(open);
        open = null;
      }
      continue;
    }
    if (open && Math.abs(open.end - segment.start) < 1e-6) {
      open = { start: open.start, end: segment.end };
    } else if (open) {
      ranges.push(open);
      open = { start: segment.start, end: segment.end };
    } else {
      open = { start: segment.start, end: segment.end };
    }
  }
  if (open) ranges.push(open);
  return ranges;
}

function titleFromTranscript(
  start: number,
  end: number,
  words: readonly { start: number; end: number; text: string }[],
): string | undefined {
  const inRange = words
    .filter((word) => word.start >= start - 0.2 && word.start < end)
    .map((word) => word.text)
    .join("");
  if (!inRange) return undefined;
  return inRange.length > 12 ? `${inRange.slice(0, 12)}…` : inRange;
}

/**
 * Merge scene spans with audio energy signals into a storyboard:
 * shots inherit scene boundaries; shots overlapping loud (non-silent) audio
 * are promoted to `highlight` shots with a score bonus and an optional title
 * taken from the transcript.
 */
export function buildStoryboard(input: StoryboardInput): Storyboard {
  const { durationSec, scenes, audioSegments, transcriptWords } = input;
  const silenceRanges = audioSegments ? silenceRangesFromAudio(audioSegments) : [];

  let spans: SceneSpan[];
  if (scenes.length > 0) {
    spans = [...scenes].sort((a, b) => a.start - b.start);
    if (spans[0].start > 1e-6) spans = [{ start: 0, end: spans[0].start, score: 0 }, ...spans];
    const last = spans[spans.length - 1];
    if (durationSec > last.end + 1e-6) spans = [...spans, { start: last.end, end: durationSec, score: 0 }];
  } else {
    spans = [{ start: 0, end: durationSec, score: 0 }];
  }

  const medianRms = audioSegments && audioSegments.length
    ? [...audioSegments].sort((a, b) => a.rmsDb - b.rmsDb)[Math.floor(audioSegments.length / 2)].rmsDb
    : -Infinity;

  const shots: StoryboardShot[] = spans
    .filter((span) => span.end - span.start >= MIN_SHOT_SEC)
    .map((span) => {
      let score = Math.min(1, Math.max(0, span.score));
      let kind: "scene" | "highlight" = "scene";
      let reason = "场景切换";
      if (audioSegments && audioSegments.length) {
        const loud = audioSegments.find(
          (segment) =>
            !segment.isSilence &&
            segment.start < span.end &&
            segment.end > span.start &&
            segment.rmsDb >= medianRms + 3,
        );
        if (loud) {
          kind = "highlight";
          score = Math.min(1, score + 0.4);
          reason = "音频能量高";
        }
      }
      return {
        start: span.start,
        end: span.end,
        score: Number(score.toFixed(3)),
        kind,
        reason,
        ...(transcriptWords ? { title: titleFromTranscript(span.start, span.end, transcriptWords) } : {}),
      };
    });

  const highlightCount = shots.filter((shot) => shot.kind === "highlight").length;
  const summary =
    shots.length === 0
      ? "素材过短，未生成镜头"
      : `${shots.length} 个镜头（${highlightCount} 个高光）`;
  return { shots, silenceRanges, summary };
}
