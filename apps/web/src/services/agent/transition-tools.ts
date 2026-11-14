import type { Project, Clip } from "@openreel/core";
import type { EditingHost, ToolResult } from "@openreel/agent";

const ADJACENCY_TOLERANCE = 0.01;
const describeClip = (clip: Clip) => ({ id: clip.id, trackId: clip.trackId, startTime: clip.startTime, endTime: clip.startTime + clip.duration, duration: clip.duration });

export function getTransitionOptions(project: Project, clipId?: string) {
  return project.timeline.tracks.filter((track) => !track.locked).flatMap((track) => {
    const clips = [...track.clips].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
    return clips.slice(0, -1).flatMap((a, index) => {
      const b = clips[index + 1]!;
      if (clipId && a.id !== clipId && b.id !== clipId || Math.abs(a.startTime + a.duration - b.startTime) > ADJACENCY_TOLERANCE) return [];
      return [{ trackId: track.id, trackName: track.name, clipAId: a.id, clipBId: b.id, cutTime: a.startTime + a.duration, maxDuration: Math.min(a.duration, b.duration, 30) }];
    });
  });
}

/** Failed preflight checks leave the isolated draft unchanged. */
export async function addEditingTransition(args: Record<string, unknown>, host: EditingHost): Promise<ToolResult> {
  const project = host.getProject();
  const clips = project.timeline.tracks.flatMap((track) => track.clips);
  const first = clips.find((clip) => clip.id === args.clipAId);
  const second = clips.find((clip) => clip.id === args.clipBId);
  const reject = (code: string, message: string): ToolResult => ({
    ok: false, summary: "转场需要修正",
    error: { code, message, recoverable: true },
    data: { clipA: first ? describeClip(first) : null, clipB: second ? describeClip(second) : null, availablePairs: getTransitionOptions(project, first?.id ?? second?.id).slice(0, 20) },
  });
  if (!first || !second) return reject("TRANSITION_CLIP_NOT_FOUND", "未找到时间线片段 ID。请使用 list_clips 或 get_transition_options 获取片段 ID；媒体 ID 和操作 ID 不是片段 ID。");
  if (first.id === second.id) return reject("TRANSITION_SAME_CLIP", "请为转场选择两个不同的相邻片段。");
  if (first.trackId !== second.trackId) return reject("TRANSITION_DIFFERENT_TRACKS", "这些片段位于不同轨道。请使用 get_transition_options 提供的相邻片段对。除非用户要求调整布局，否则不要在轨道间移动片段。");
  const [a, b] = first.startTime <= second.startTime ? [first, second] : [second, first];
  const gap = b.startTime - (a.startTime + a.duration);
  if (Math.abs(gap) > ADJACENCY_TOLERANCE) {
    const seconds = Number(Math.abs(gap).toFixed(6));
    return reject("TRANSITION_NOT_ADJACENT", `片段之间${gap > 0 ? `有 ${seconds} 秒间隙` : `重叠 ${seconds} 秒`}。后一个片段从 ${b.startTime} 秒开始；相邻要求为 ${a.startTime + a.duration} 秒。请从 get_transition_options 选择相邻片段对，或仅在用户要求衔接这些片段时修正时间。`);
  }
  const requestedDuration = Number(args.duration);
  const duration = Math.min(requestedDuration, a.duration, b.duration);
  const transition = { id: `transition-${crypto.randomUUID()}`, type: args.transitionType, clipAId: a.id, clipBId: b.id, duration, params: args.params ?? {} };
  const result = await host.applyAction({ type: "transition/set", id: crypto.randomUUID(), timestamp: Date.now(), params: { transition } });
  return result.success ? {
    ok: true,
    summary: duration < requestedDuration ? `已应用转场；为适配两个片段，时长已从 ${requestedDuration} 秒缩短为 ${duration} 秒` : "已应用转场",
    data: { transitionId: transition.id, trackId: a.trackId, clipAId: a.id, clipBId: b.id, duration, requestedDuration, reordered: a.id !== first.id },
  } : { ok: false, summary: "转场失败", error: { code: "INVALID_EDIT", message: result.error?.message ?? "转场失败" } };
}
