import type { Action, ValidationResult } from "../../types/actions";
import type { Project } from "../../types/project";
import type { Clip } from "../../types/timeline";
import { registerActionHandler, createInverseAction, type ActionHandler } from "../registry";
import { findClip } from "./clip-helpers";
import { editSnapshot } from "./edit-snapshot";
import type { StoryboardShot } from "../../analysis/smart-storyboard";

const EPS = 1e-4;

interface KeptRange {
  readonly start: number;
  readonly end: number;
  readonly clip: Clip;
  readonly cutIn: number;
  readonly cutOut: number;
}

function computeKeptRanges(track: { clips: readonly Clip[] }, shots: readonly StoryboardShot[]): KeptRange[] {
  const ranges: KeptRange[] = [];
  for (const clip of track.clips) {
    const clipStart = clip.startTime;
    const clipEnd = clip.startTime + clip.duration;
    for (const shot of shots) {
      const overlapStart = Math.max(clipStart, shot.start);
      const overlapEnd = Math.min(clipEnd, shot.end);
      if (overlapEnd - overlapStart > EPS) {
        ranges.push({
          start: overlapStart,
          end: overlapEnd,
          clip,
          cutIn: overlapStart - clipStart,
          cutOut: overlapEnd - clipStart,
        });
      }
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * Rough-cut the first video track to keep only the storyboard shot ranges,
 * laid back-to-back (ripple within the track). A clip spanning several shots
 * is split into one clip per kept range; footage outside the shots is dropped.
 * Other tracks are left untouched. Undo uses a full edit snapshot.
 */
const applyStoryboard: ActionHandler = {
  type: "smart/applyStoryboard",
  validate(action: Action, _project: Project): ValidationResult {
    const params = action.params as { shots?: unknown };
    const errors = [];
    if (!Array.isArray(params.shots) || params.shots.length === 0) {
      return { valid: false, errors: [{ code: "INVALID_PARAMS", message: "shots must be a non-empty array" }] };
    }
    let previousEnd = -1;
    for (const raw of params.shots) {
      const candidate = raw as Partial<StoryboardShot>;
      if (
        typeof candidate.start !== "number" ||
        typeof candidate.end !== "number" ||
        !Number.isFinite(candidate.start) ||
        !Number.isFinite(candidate.end) ||
        candidate.end <= candidate.start
      ) {
        errors.push({ code: "INVALID_PARAMS", message: "Each shot needs finite start < end" });
        continue;
      }
      if (candidate.start < previousEnd - 1e-6) {
        errors.push({ code: "INVALID_PARAMS", message: "shots must be sorted and non-overlapping" });
      }
      previousEnd = candidate.end;
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const { shots, clipId } = (action.params as { shots: StoryboardShot[]; clipId?: string });
    const track = project.timeline.tracks.find((candidate) => candidate.type === "video");
    if (!track) return;

    let keptRanges: KeptRange[];
    if (clipId) {
      const clip = track.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return;
      keptRanges = computeKeptRanges({ clips: [clip] }, shots);
    } else {
      keptRanges = computeKeptRanges(track, shots);
    }
    const anchor = clipId ? track.clips.find((candidate) => candidate.id === clipId)!.startTime : 0;
    const keptClips: Clip[] = [];
    let cursor = anchor;
    let splitIndex = 0;
    for (const range of keptRanges) {
      const firstPiece = keptClips.every((kept) => kept.id !== range.clip.id);
      const idSuffix = firstPiece ? "" : `-shot-${++splitIndex}`;
      keptClips.push({
        ...range.clip,
        id: `${range.clip.id}${idSuffix}`,
        startTime: cursor,
        duration: range.end - range.start,
        inPoint: range.clip.inPoint + range.cutIn,
        outPoint: range.clip.inPoint + range.cutOut,
      } as Clip);
      cursor += range.end - range.start;
    }

    if (clipId) {
      // Replace just the target clip's pieces; leave every other clip in place.
      const others = track.clips.filter((candidate) => candidate.id !== clipId);
      const othersBefore = others.filter((candidate) => candidate.startTime < anchor);
      const othersAfter = others.filter((candidate) => candidate.startTime >= anchor);
      (track as unknown as { clips: Clip[] }).clips = [...othersBefore, ...keptClips, ...othersAfter];
    } else {
      (track as unknown as { clips: Clip[] }).clips = keptClips;
    }
  },
  invert(action: Action, projectBefore: Project): Action | null {
    return createInverseAction(action, "project/applyEditSnapshot", {
      snapshot: editSnapshot(projectBefore),
    });
  },
};

/**
 * Shift an audio clip's timeline start by `offsetSec` (clamped to >= 0).
 * Used by the A/V offset repair flow (`estimateAudioOffset`).
 */
const syncAudio: ActionHandler = {
  type: "clip/syncAudio",
  validate(action: Action, project: Project): ValidationResult {
    const params = action.params as { clipId?: unknown; offsetSec?: unknown };
    const errors = [];
    if (typeof params.clipId !== "string" || !findClip(project, params.clipId)) {
      errors.push({ code: "CLIP_NOT_FOUND", message: "Clip not found" });
    }
    if (typeof params.offsetSec !== "number" || !Number.isFinite(params.offsetSec)) {
      errors.push({ code: "INVALID_PARAMS", message: "offsetSec must be a finite number" });
    }
    return { valid: errors.length === 0, errors };
  },
  apply(action: Action, project: Project): void {
    const { clipId, offsetSec } = action.params as { clipId: string; offsetSec: number };
    const clip = findClip(project, clipId);
    if (!clip) return;
    const next = Math.max(0, clip.startTime + offsetSec);
    (clip as unknown as { startTime: number }).startTime = next;
  },
  invert(action: Action, projectBefore: Project): Action | null {
    const clip = findClip(projectBefore, (action.params as { clipId: string }).clipId);
    if (!clip) return null;
    const offset = (action.params as { offsetSec: number }).offsetSec;
    const after = Math.max(0, clip.startTime + offset);
    return {
      type: "clip/syncAudio",
      id: `inverse-${action.id}`,
      timestamp: Date.now(),
      params: { clipId: clip.id, offsetSec: Number((clip.startTime - after).toFixed(6)) },
    };
  },
};

registerActionHandler(applyStoryboard);
registerActionHandler(syncAudio);
