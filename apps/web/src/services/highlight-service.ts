import {
  analyzeAudioForHighlights,
  type TranscriptWord,
} from "@openreel/core";

export interface HighlightResult {
  start: number;
  end: number;
  score: number;
  title: string;
  reason: string;
}

export interface HighlightPreferences {
  targetClipCount: number;
  minClipDuration: number;
  maxClipDuration: number;
  contentType: string;
}

const DEFAULT_PREFERENCES: HighlightPreferences = {
  targetClipCount: 5,
  minClipDuration: 5,
  maxClipDuration: 60,
  contentType: "video",
};

type ProgressCallback = (phase: string, progress: number, message: string) => void;

export async function extractHighlights(
  audioBuffer: AudioBuffer,
  transcript: TranscriptWord[],
  preferences: Partial<HighlightPreferences> = {},
  onProgress?: ProgressCallback,
): Promise<HighlightResult[]> {
  const prefs = { ...DEFAULT_PREFERENCES, ...preferences };

  onProgress?.("analyze", 10, "正在分析音频能量…");
  const analysis = analyzeAudioForHighlights(audioBuffer, transcript);

  onProgress?.("rank", 35, "正在本地排序高能片段…");
  const usable = analysis.segments.filter((segment) => !segment.isSilence);
  if (usable.length === 0) return [];

  const windowDuration = Math.min(
    prefs.maxClipDuration,
    Math.max(prefs.minClipDuration, 15),
  );
  const maxRms = Math.max(...usable.map((segment) => segment.rmsDb));
  const minRms = Math.min(...usable.map((segment) => segment.rmsDb));
  const rmsRange = Math.max(maxRms - minRms, 1);

  const candidates = usable.map((anchor) => {
    const start = Math.min(
      Math.max(0, anchor.start - windowDuration / 3),
      Math.max(0, analysis.duration - windowDuration),
    );
    const end = Math.min(analysis.duration, start + windowDuration);
    const windowSegments = usable.filter(
      (segment) => segment.end > start && segment.start < end,
    );
    const energy =
      windowSegments.reduce(
        (total, segment) => total + (segment.rmsDb - minRms) / rmsRange,
        0,
      ) / Math.max(windowSegments.length, 1);
    const speech =
      windowSegments.reduce((total, segment) => total + segment.speechRate, 0) /
      Math.max(windowSegments.length, 1);
    const score = Math.min(10, Math.max(1, 1 + energy * 7 + Math.min(speech, 2) * 1));
    return { start, end, score };
  });

  const selected: HighlightResult[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const overlaps = selected.some(
      (item) => candidate.start < item.end && candidate.end > item.start,
    );
    if (overlaps) continue;
    selected.push({
      ...candidate,
      title: `精彩片段 ${selected.length + 1}`,
      reason: transcript.length > 0
        ? "本地音频能量强，且有语音活动"
        : "本地音频能量强",
    });
    if (selected.length >= prefs.targetClipCount) break;
  }

  onProgress?.("done", 100, "本地精彩片段已就绪");
  return selected.sort((a, b) => a.start - b.start);
}
