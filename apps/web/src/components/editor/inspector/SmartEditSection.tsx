import React, { useCallback, useMemo, useState } from "react";
import { Scissors, Loader2, Film, Wand2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import {
  detectScenes,
  buildStoryboard,
  sceneThresholdPreset,
  type SceneDetectionInput,
  type SceneSpan,
  type SceneThresholdPreset,
} from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { toast } from "../../../stores/notification-store";

interface SmartEditSectionProps {
  clipId: string;
}

interface SceneRowProps {
  span: SceneSpan;
  index: number;
}

const SceneRow: React.FC<SceneRowProps> = ({ span, index }) => {
  const duration = span.end - span.start;
  return (
    <div className="flex items-center justify-between rounded border border-border bg-bg-2 px-2 py-1 text-xs">
      <span className="text-fg-2">#{index + 1}</span>
      <span className="text-fg-3 tabular-nums">
        {span.start.toFixed(1)}s → {span.end.toFixed(1)}s
      </span>
      <span className="tabular-nums text-fg-3">{duration.toFixed(1)}s</span>
    </div>
  );
};

/**
 * AI-tab section: scene/shot boundary detection on the selected clip's media
 * plus one-click storyboard rough cut (`smart/applyStoryboard`).
 */
export const SmartEditSection: React.FC<SmartEditSectionProps> = ({ clipId }) => {
  const project = useProjectStore((state) => state.project);
  const [preset, setPreset] = useState<SceneThresholdPreset>("medium");
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [scenes, setScenes] = useState<SceneSpan[] | null>(null);

  const clip = useMemo(() => {
    const track = project.timeline.tracks.find((candidate) =>
      candidate.clips.some((item) => item.id === clipId),
    );
    return track?.clips.find((item) => item.id === clipId) ?? null;
  }, [project, clipId]);
  const media = useMemo(
    () => project.mediaLibrary.items.find((item) => item.id === clip?.mediaId) ?? null,
    [project, clip],
  );

  const mediaDuration = media?.metadata?.duration ?? 0;
  const unavailable =
    !clip || !media || media.type !== "video" || (!media.blob && !media.fileHandle) || !(mediaDuration > 0);

  const runDetection = useCallback(async () => {
    if (!media?.blob || !(mediaDuration > 0)) return;
    setAnalyzing(true);
    let url: string | undefined;
    try {
      url = URL.createObjectURL(media.blob);
      const options: SceneDetectionInput = {
        videoUrl: url,
        durationSec: mediaDuration,
        threshold: sceneThresholdPreset(preset),
      };
      const result = await detectScenes(options);
      // Keep only scenes that intersect this clip's timeline range.
      const clipStart = clip?.startTime ?? 0;
      const clipEnd = clipStart + (clip?.duration ?? mediaDuration);
      const mapped = result.scenes
        .map((span) => {
          const start = clipStart + Math.max(0, span.start - (clip?.inPoint ?? 0));
          const end = clipStart + Math.min(clipEnd - clipStart, span.end - (clip?.inPoint ?? 0));
          return { start, end: Math.min(end, clipEnd), score: span.score };
        })
        .filter((span) => span.end - span.start > 0.2);
      setScenes(mapped);
      if (mapped.length === 0) {
        toast.info("未找到场景切点", "请尝试降低灵敏度。");
      }
    } catch (error) {
      toast.error(
        "场景检测失败",
        error instanceof Error ? error.message : "请重试。",
      );
    } finally {
      if (url) URL.revokeObjectURL(url);
      setAnalyzing(false);
    }
  }, [media, mediaDuration, preset, clip]);

  const applyStoryboard = useCallback(async () => {
    if (!clip || !scenes?.length) return;
    const storyboard = buildStoryboard({
      durationSec: clip.startTime + clip.duration,
      scenes,
    });
    const store = useProjectStore.getState();
    const timeline = useTimelineStore.getState();
    timeline.pause();
    store.beginHistoryGroup("应用故事板粗剪");
    setApplying(true);
    try {
      const result = await store.executeAction({
        type: "smart/applyStoryboard",
        id: `smart-${Date.now()}`,
        timestamp: Date.now(),
        params: { clipId: clip.id, shots: storyboard.shots },
      } as Parameters<typeof store.executeAction>[0]);
      if (result.success) {
        setScenes(null);
        toast.success("分镜已应用", storyboard.summary);
      } else {
        toast.error("无法应用分镜", result.error?.message ?? "未知错误");
      }
    } catch (error) {
      toast.error("无法应用分镜", error instanceof Error ? error.message : "未知错误");
    } finally {
      if (useProjectStore.getState().project.id === project.id) store.endHistoryGroup();
      setApplying(false);
    }
  }, [clip, scenes, project.id]);

  return (
    <div className="space-y-3">
      <Text type="supporting" color="secondary" className="block text-xs leading-relaxed">
        检测此片段中的镜头边界，然后保留精彩片段作为粗剪。
      </Text>
      <div className="flex items-center gap-2">
        <label className="text-xs text-fg-3" htmlFor="smart-edit-sensitivity">灵敏度</label>
        <select
          id="smart-edit-sensitivity"
          value={preset}
          onChange={(event) => setPreset(event.target.value as SceneThresholdPreset)}
          className="rounded border border-border bg-bg-2 px-2 py-1 text-xs text-fg"
        >
          <option value="low">低（更少剪辑）</option>
          <option value="medium">中</option>
          <option value="high">高（更多剪辑）</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          label={analyzing ? "检测中…" : "检测场景"}
          icon={analyzing ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Scissors size={13} aria-hidden />}
          variant="secondary"
          size="sm"
          onClick={() => void runDetection()}
          isDisabled={unavailable || analyzing || applying}
          className="w-full justify-center"
        />
        <Button
          label={applying ? "应用中…" : "粗剪"}
          icon={applying ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Wand2 size={13} aria-hidden />}
          variant="secondary"
          size="sm"
          onClick={() => void applyStoryboard()}
          isDisabled={!scenes?.length || analyzing || applying}
          className="w-full justify-center"
        />
      </div>
      {scenes && scenes.length > 0 && (
        <div className="space-y-1" role="list" aria-label="Detected scenes">
          <div className="flex items-center gap-1 text-xs font-semibold text-fg-2">
            <Film size={12} aria-hidden />
            {scenes.length} 个镜头已检测
          </div>
          {scenes.map((span, index) => (
            <SceneRow key={`${span.start}-${span.end}`} span={span} index={index} />
          ))}
        </div>
      )}
      {unavailable && (
        <Text type="supporting" color="secondary" className="block text-xs">
          选择一个具有可用源文件的视频片段以检测场景。
        </Text>
      )}
    </div>
  );
};
