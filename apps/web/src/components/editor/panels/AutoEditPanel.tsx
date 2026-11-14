import React, { useState, useCallback, useMemo } from "react";
import { Music, Zap, Loader2 } from "@/icons/lucide-compat";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftEmptyState as EmptyState } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useProjectStore } from "../../../stores/project-store";
import {
  getBeatDetectionEngine,
  getAutoEditService,
  type AutoEditOptions,
  type AutoEditResult,
  type CutMode,
  type BeatAnalysisResult,
  type Clip,
  getMediaItemCapabilities,
} from "@openreel/core";

const CUT_MODE_LABEL: Record<CutMode, string> = {
  beats: "节拍",
  downbeats: "强拍",
  segments: "分段",
};

interface AutoEditPanelProps {
  onClose: () => void;
}

export const AutoEditPanel: React.FC<AutoEditPanelProps> = ({ onClose }) => {
  const project = useProjectStore((s) => s.project);
  const [cutMode, setCutMode] = useState<CutMode>("beats");
  const [sensitivity, setSensitivity] = useState(0.5);
  const [minClipDuration, setMinClipDuration] = useState(0.5);
  const [analyzing, setAnalyzing] = useState(false);
  const [preview, setPreview] = useState<AutoEditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioClips = useMemo(() => {
    const clips: Clip[] = [];
    for (const track of project.timeline.tracks) {
      clips.push(
        ...track.clips.filter((clip) =>
          getMediaItemCapabilities(
            project.mediaLibrary.items.find(
              (mediaItem) => mediaItem.id === clip.mediaId,
            ),
          ).audio,
        ),
      );
    }
    return clips;
  }, [project]);

  const videoClips = useMemo(() => {
    const clips: Clip[] = [];
    for (const track of project.timeline.tracks) {
      clips.push(
        ...track.clips.filter(
          (clip) =>
            project.mediaLibrary.items.find(
              (mediaItem) => mediaItem.id === clip.mediaId,
            )?.type === "video",
        ),
      );
    }
    return clips;
  }, [project]);

  const [selectedAudioClipId, setSelectedAudioClipId] = useState<string>(
    audioClips[0]?.id ?? "",
  );

  const audioClipOptions = useMemo(
    () =>
      audioClips.map((clip) => ({
        value: clip.id,
        label: `${clip.mediaId} (${clip.duration.toFixed(1)}s)`,
      })),
    [audioClips],
  );

  const handleAnalyze = useCallback(async () => {
    const audioClip = audioClips.find((c) => c.id === selectedAudioClipId);
    if (!audioClip || videoClips.length === 0) return;

    setAnalyzing(true);
    setError(null);
    setPreview(null);

    try {
      const beatEngine = getBeatDetectionEngine();

      let beatAnalysis: BeatAnalysisResult;
      const existing = project.timeline.beatAnalysis;
      if (existing && existing.sourceClipId === selectedAudioClipId) {
        beatAnalysis = {
          bpm: existing.bpm,
          confidence: existing.confidence,
          beats: project.timeline.beatMarkers?.map((m, i) => ({
            time: m.time,
            strength: m.strength,
            index: i,
          })) ?? [],
          duration: project.timeline.duration,
          downbeats: project.timeline.beatMarkers
            ?.filter((m) => m.isDownbeat)
            .map((m) => m.time) ?? [],
        };
      } else {
        const mediaItem = useProjectStore
          .getState()
          .project.mediaLibrary.items.find(
            (m) => m.id === audioClip.mediaId,
          );
        if (!mediaItem?.blob) {
          setError("音频文件未加载");
          setAnalyzing(false);
          return;
        }
        beatAnalysis = await beatEngine.analyzeFromBlob(mediaItem.blob);
      }

      const options: AutoEditOptions = {
        cutMode,
        minClipDuration,
        maxClipDuration: 10,
        sensitivity,
      };

      const autoEditService = getAutoEditService();
      const result = autoEditService.generateCuts(
        beatAnalysis,
        videoClips,
        options,
      );
      setPreview(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "音频分析失败",
      );
    } finally {
      setAnalyzing(false);
    }
  }, [
    audioClips,
    selectedAudioClipId,
    videoClips,
    cutMode,
    sensitivity,
    minClipDuration,
    project.timeline,
  ]);

  const handleApply = useCallback(() => {
    if (!preview || preview.cuts.length === 0) return;

    const tracks = [...project.timeline.tracks];
    const sourceClipIds = new Set(videoClips.map((clip) => clip.id));
    const videoTrackIndex = tracks.findIndex((track) =>
      track.clips.some((clip) => sourceClipIds.has(clip.id)),
    );
    if (videoTrackIndex === -1) return;

    const newClips: Clip[] = preview.cuts.map((cut, index) => {
      const sourceClip = videoClips.find((c) => c.id === cut.sourceClipId);
      if (!sourceClip) return null;

      return {
        ...sourceClip,
        id: `auto-edit-${Date.now()}-${index}`,
        startTime: cut.startTime,
        duration: cut.duration,
        inPoint: cut.inPoint,
        outPoint: cut.outPoint,
      };
    }).filter((c): c is Clip => c !== null);

    const updatedTrack = {
      ...tracks[videoTrackIndex],
      clips: newClips,
    };
    tracks[videoTrackIndex] = updatedTrack;

    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          tracks,
          duration: preview.totalDuration,
        },
        modifiedAt: Date.now(),
      },
    }));

    onClose();
  }, [preview, project.timeline.tracks, videoClips, onClose]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-primary" aria-hidden />
          <Text type="label" weight="bold" className="text-[11px]">
            节拍同步自动剪辑
          </Text>
        </div>
      </div>

      {audioClips.length === 0 ? (
        <EmptyState
          title="添加一条音频轨道即可使用自动剪辑"
          icon={<Music size={24} className="text-text-muted opacity-50" aria-hidden />}
          isCompact
        />
      ) : (
        <>
          <Selector
            label="音频来源"
            value={selectedAudioClipId}
            onChange={setSelectedAudioClipId}
            options={audioClipOptions}
            size="sm"
            className="w-full"
          />

          <div className="space-y-2">
            <Text type="supporting" color="secondary" weight="bold" display="block" className="text-[10px]">
              剪辑模式
            </Text>
            <ToolcraftSegmentedControl<CutMode>
              ariaLabel="Cut mode"
              value={cutMode}
              onChange={setCutMode}
              options={(["beats", "downbeats", "segments"] as CutMode[]).map(
                (mode) => ({
                  value: mode,
                  label: CUT_MODE_LABEL[mode],
                }),
              )}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Text type="supporting" color="secondary" weight="bold" className="text-[10px]">
                灵敏度
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px]">
                {Math.round(sensitivity * 100)}%
              </Text>
            </div>
            <ToolcraftSliderControl
              label="灵敏度"
              isLabelHidden
              min={0}
              max={1}
              step={0.05}
              value={sensitivity}
              onChange={setSensitivity}
              valueDisplay="none"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Text type="supporting" color="secondary" weight="bold" className="text-[10px]">
                最短片段时长
              </Text>
              <Text type="supporting" color="secondary" className="text-[9px]">
                {minClipDuration.toFixed(1)}s
              </Text>
            </div>
            <ToolcraftSliderControl
              label="最短片段时长"
              isLabelHidden
              min={0.1}
              max={3}
              step={0.1}
              value={minClipDuration}
              onChange={setMinClipDuration}
              valueDisplay="none"
            />
          </div>

          <Button
            label={analyzing ? "正在分析节拍…" : "生成自动剪辑"}
            onClick={handleAnalyze}
            isDisabled={analyzing || videoClips.length === 0}
            variant="primary"
            icon={
              analyzing ? (
                <Loader2 size={12} className="animate-spin" aria-hidden />
              ) : (
                <Zap size={12} aria-hidden />
              )
            }
            className="w-full"
          />

          {error && (
            <Card variant="red" padding={2}>
              <Text type="supporting" className="text-[9px]">
                {error}
              </Text>
            </Card>
          )}

          {preview && (
            <Card variant="muted" padding={3} className="space-y-2 border border-border">
              <Text type="label" weight="bold" display="block" className="text-[10px]">
                预览
              </Text>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    剪切数：{" "}
                  </Text>
                  <Text type="supporting" className="text-[9px]">
                    {preview.cuts.length}
                  </Text>
                </div>
                <div>
                  <Text type="supporting" color="secondary" className="text-[9px]">
                    时长：{" "}
                  </Text>
                  <Text type="supporting" className="text-[9px]">
                    {preview.totalDuration.toFixed(1)}s
                  </Text>
                </div>
              </div>
              <Button
                label="应用自动剪辑"
                onClick={handleApply}
                variant="primary"
                size="sm"
                className="w-full"
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
};
