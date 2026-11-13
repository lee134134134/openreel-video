import { describe, expect, it } from "vitest";
import type { Action } from "../../types/actions";
import type { Project, MediaItem } from "../../types/project";
import type { Clip } from "../../types/timeline";
import "../../actions/handlers/smart";
import { ActionExecutor } from "../../actions/action-executor";

function makeMedia(id: string): MediaItem {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    blob: new Blob(["x"]),
    fileHandle: null,
    thumbnailUrl: null,
    waveformData: null,
    sourceFile: { name: `${id}.mp4`, size: 1, lastModified: 1 },
    metadata: { duration: 10, width: 64, height: 64, frameRate: 30, sampleRate: 48000, channels: 2, fileSize: 1, codec: "avc" },
  } as unknown as MediaItem;
}

function videoClip(id: string, startTime: number, duration: number): Clip {
  return {
    id,
    mediaId: "m1",
    trackId: "t1",
    startTime,
    duration,
    inPoint: startTime,
    outPoint: startTime + duration,
    effects: [],
    audioEffects: [],
    keyframes: [],
    volume: 1,
    transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }, opacity: 1, rotation: 0 },
  } as Clip;
}

function audioClip(id: string, startTime: number, duration: number): Clip {
  return { ...videoClip(id, startTime, duration), trackId: "t2" } as Clip;
}

function projectWith(clips: Clip[], audio: Clip[] = []): Project {
  return {
    id: "p1",
    name: "Test",
    createdAt: 1,
    modifiedAt: 1,
    settings: { width: 64, height: 64, frameRate: 30, sampleRate: 48000, channels: 2 },
    mediaLibrary: { items: [makeMedia("m1")] },
    timeline: {
      tracks: [
        { id: "t1", type: "video", name: "V", locked: false, hidden: false, muted: false, solo: false, transitions: [], clips },
        { id: "t2", type: "audio", name: "A", locked: false, hidden: false, muted: false, solo: false, transitions: [], clips: audio },
      ],
      subtitles: [],
      markers: [],
      duration: 10,
    },
  } as unknown as Project;
}

const executor = new ActionExecutor();

describe("smart/applyStoryboard", () => {
  it("keeps shot ranges laid back-to-back and drops the rest", async () => {
    const project = projectWith([
      videoClip("c1", 0, 4),
      videoClip("c2", 4, 6),
    ]);
    const action: Action = {
      type: "smart/applyStoryboard",
      id: "a1",
      timestamp: 1,
      params: { shots: [{ start: 1, end: 3, score: 1, kind: "scene" }, { start: 7, end: 9, score: 1, kind: "scene" }] },
    };
    const result = await executor.execute(action, project);
    expect(result.success).toBe(true);
    const clips = project.timeline.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ id: "c1", startTime: 0, duration: 2, inPoint: 1, outPoint: 3 });
    expect(clips[1]).toMatchObject({ id: "c2", startTime: 2, duration: 2, inPoint: 7, outPoint: 9 });
  });

  it("splits a clip spanning multiple shots into pieces", async () => {
    const project = projectWith([videoClip("c1", 0, 10)]);
    const action: Action = {
      type: "smart/applyStoryboard",
      id: "a2",
      timestamp: 1,
      params: { shots: [{ start: 0, end: 2, score: 1, kind: "scene" }, { start: 5, end: 7, score: 1, kind: "scene" }] },
    };
    await executor.execute(action, project);
    const clips = project.timeline.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ startTime: 0, duration: 2 });
    expect(clips[1]).toMatchObject({ startTime: 2, duration: 2, inPoint: 5, outPoint: 7 });
    expect(project.timeline.tracks[0].clips.map((clip) => clip.id)).toEqual(["c1", "c1-shot-1"]);
  });

  it("undo restores the original timeline via snapshot", async () => {
    const project = projectWith([videoClip("c1", 0, 10), videoClip("c2", 10, 4)]);
    const action: Action = {
      type: "smart/applyStoryboard",
      id: "a3",
      timestamp: 1,
      params: { shots: [{ start: 2, end: 4, score: 1, kind: "scene" }] },
    };
    await executor.execute(action, project);
    expect(project.timeline.tracks[0].clips).toHaveLength(1);
    const undoResult = await executor.undo(project);
    expect(undoResult.success).toBe(true);
    expect(project.timeline.tracks[0].clips).toHaveLength(2);
    expect(project.timeline.tracks[0].clips[0]).toMatchObject({ id: "c1", startTime: 0, duration: 10 });
  });

  it("with clipId only rough-cuts that clip, leaving others untouched", async () => {
    const project = projectWith([videoClip("c1", 0, 4), videoClip("c2", 4, 6)]);
    const action: Action = {
      type: "smart/applyStoryboard",
      id: "a5",
      timestamp: 1,
      params: { clipId: "c2", shots: [{ start: 4, end: 5, score: 1, kind: "scene" }, { start: 8, end: 9.5, score: 1, kind: "scene" }] },
    };
    const result = await executor.execute(action, project);
    expect(result.success).toBe(true);
    const clips = project.timeline.tracks[0].clips;
    expect(clips).toHaveLength(3);
    expect(clips[0]).toMatchObject({ id: "c1", startTime: 0, duration: 4 });
    expect(clips[1]).toMatchObject({ startTime: 4, duration: 1, inPoint: 4, outPoint: 5 });
    expect(clips[2]).toMatchObject({ startTime: 5, duration: 1.5, inPoint: 8, outPoint: 9.5 });
  });

  it("rejects unsorted or invalid shots", async () => {
    const project = projectWith([videoClip("c1", 0, 10)]);
    const result = await executor.execute({
      type: "smart/applyStoryboard",
      id: "a4",
      timestamp: 1,
      params: { shots: [{ start: 5, end: 3, score: 1, kind: "scene" }] },
    } as Action, project);
    expect(result.success).toBe(false);
  });
});

describe("clip/syncAudio", () => {
  it("shifts an audio clip start and undoes", async () => {
    const project = projectWith([videoClip("c1", 0, 4)], [audioClip("a1", 0, 6)]);
    await executor.execute({
      type: "clip/syncAudio",
      id: "s1",
      timestamp: 1,
      params: { clipId: "a1", offsetSec: 0.25 },
    } as Action, project);
    expect(project.timeline.tracks[1].clips[0].startTime).toBeCloseTo(0.25, 6);
    const undoResult = await executor.undo(project);
    expect(undoResult.success).toBe(true);
    expect(project.timeline.tracks[1].clips[0].startTime).toBeCloseTo(0, 6);
  });

  it("clamps to zero", async () => {
    const project = projectWith([videoClip("c1", 0, 4)], [audioClip("a1", 0.5, 6)]);
    const result = await executor.execute({
      type: "clip/syncAudio",
      id: "s2",
      timestamp: 1,
      params: { clipId: "a1", offsetSec: -5 },
    } as Action, project);
    expect(result.success).toBe(true);
    expect(project.timeline.tracks[1].clips[0].startTime).toBe(0);
  });
});
