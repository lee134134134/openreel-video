import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Volume2,
  VolumeX,
  Mic,
  Music,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
  AlertCircle,
} from "@/icons/lucide-compat";
import {
  AudioDucker,
  resolveAudibleAudioTarget,
  trackHasAudioItems,
  type Clip,
  type Project,
  type Track,
} from "@openreel/core";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import { MockToggle } from "./shell/InspectorControls";
import { useProjectStore } from "../../../stores/project-store";
import type { AudioDuckingSettings } from "../../../stores/project";

interface AudioDuckingSectionProps {
  clipId: string;
}

const DEFAULT_SETTINGS: AudioDuckingSettings = {
  enabled: false,
  sourceTrackId: null,
  threshold: -30,
  reduction: 0.7,
  attack: 0.1,
  release: 0.3,
  holdTime: 0.2,
};

const PRESET_CONFIGS: {
  id: string;
  name: string;
  settings: Partial<AudioDuckingSettings>;
}[] = [
  {
    id: "subtle",
    name: "柔和",
    settings: { threshold: -35, reduction: 0.4, attack: 0.15, release: 0.5 },
  },
  {
    id: "moderate",
    name: "适中",
    settings: { threshold: -30, reduction: 0.6, attack: 0.1, release: 0.3 },
  },
  {
    id: "aggressive",
    name: "强力",
    settings: { threshold: -25, reduction: 0.8, attack: 0.05, release: 0.2 },
  },
  {
    id: "podcast",
    name: "播客",
    settings: {
      threshold: -28,
      reduction: 0.75,
      attack: 0.08,
      release: 0.4,
      holdTime: 0.3,
    },
  },
];

const isAudioDuckingSettings = (
  value: unknown,
): value is AudioDuckingSettings => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AudioDuckingSettings>;

  return (
    typeof candidate.enabled === "boolean" &&
    (typeof candidate.sourceTrackId === "string" ||
      candidate.sourceTrackId === null) &&
    typeof candidate.threshold === "number" &&
    typeof candidate.reduction === "number" &&
    typeof candidate.attack === "number" &&
    typeof candidate.release === "number" &&
    typeof candidate.holdTime === "number"
  );
};

const findClipById = (project: Project, clipId: string): Clip | null => {
  for (const track of project.timeline.tracks) {
    const clip = track.clips.find((candidate) => candidate.id === clipId);
    if (clip) {
      return clip;
    }
  }

  return null;
};

const getTrackLabel = (track: Track): string => {
  return track.name || `Track ${track.id.slice(-4)}`;
};

interface DuckingSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  description: string;
  formatValue: (value: number) => string;
  onChange: (value: number) => void;
}

const DuckingSlider: React.FC<DuckingSliderProps> = ({
  label,
  value,
  min,
  max,
  step,
  description,
  formatValue,
  onChange,
}) => (
  <div className="space-y-1">
    <PropertySlider
      label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      formatValue={formatValue}
    />
    <Text type="supporting" color="secondary" className="text-[8px]">
      {description}
    </Text>
  </div>
);

const buildTriggerTrackBuffer = async (
  project: Project,
  backgroundClip: Clip,
  sourceTrack: Track,
): Promise<AudioBuffer> => {
  const overlappingClips = sourceTrack.clips.filter((sourceClip) => {
    const sourceEnd = sourceClip.startTime + sourceClip.duration;
    const backgroundEnd = backgroundClip.startTime + backgroundClip.duration;
    return (
      sourceClip.id !== backgroundClip.id &&
      sourceClip.startTime < backgroundEnd &&
      sourceEnd > backgroundClip.startTime
    );
  });

  if (overlappingClips.length === 0) {
    throw new Error("未找到与该片段重叠的触发片段。");
  }

  const decodeContext = new AudioContext();

  try {
    const offlineContext = new OfflineAudioContext(
      Math.max(1, project.settings.channels),
      Math.max(1, Math.ceil(backgroundClip.duration * project.settings.sampleRate)),
      project.settings.sampleRate,
    );

    let scheduledSources = 0;

    for (const sourceClip of overlappingClips) {
      if (sourceClip.reversed) {
        continue;
      }

      const mediaItem = project.mediaLibrary.items.find(
        (item) => item.id === sourceClip.mediaId,
      );

      if (!mediaItem?.blob) {
        continue;
      }

      const overlapStart = Math.max(backgroundClip.startTime, sourceClip.startTime);
      const overlapEnd = Math.min(
        backgroundClip.startTime + backgroundClip.duration,
        sourceClip.startTime + sourceClip.duration,
      );

      if (overlapEnd <= overlapStart) {
        continue;
      }

      try {
        const arrayBuffer = await mediaItem.blob.arrayBuffer();
        const decodedBuffer = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
        const source = offlineContext.createBufferSource();
        const gainNode = offlineContext.createGain();
        const playbackRate = Math.max(0.1, sourceClip.speed ?? 1);
        const timelineOffset = overlapStart - backgroundClip.startTime;
        const mediaOffset =
          sourceClip.inPoint +
          Math.max(0, overlapStart - sourceClip.startTime) * playbackRate;
        const renderDuration = overlapEnd - overlapStart;

        source.buffer = decodedBuffer;
        source.playbackRate.value = playbackRate;
        gainNode.gain.value = sourceClip.volume;

        source.connect(gainNode);
        gainNode.connect(offlineContext.destination);
        source.start(timelineOffset, mediaOffset, renderDuration * playbackRate);
        scheduledSources += 1;
      } catch {
        continue;
      }
    }

    if (scheduledSources === 0) {
      throw new Error("所选源轨道上没有可解码的触发音频。");
    }

    return offlineContext.startRendering();
  } finally {
    await decodeContext.close();
  }
};

export const AudioDuckingSection: React.FC<AudioDuckingSectionProps> = ({
  clipId,
}) => {
  const project = useProjectStore((state) => state.project);
  const setClipAudioDucking = useProjectStore(
    (state) => state.setClipAudioDucking,
  );
  const clearClipAudioDucking = useProjectStore(
    (state) => state.clearClipAudioDucking,
  );
  const [settings, setSettings] = useState<AudioDuckingSettings>(DEFAULT_SETTINGS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedClip = useMemo(() => findClipById(project, clipId), [project, clipId]);
  const audioTargetClip = useMemo(
    () =>
      selectedClip
        ? resolveAudibleAudioTarget(selectedClip, project.timeline)
        : null,
    [project.timeline, selectedClip],
  );

  const availableSourceTracks = useMemo(() => {
    const excludedClipIds = new Set(
      [clipId, audioTargetClip?.id].filter(Boolean) as string[],
    );

    return project.timeline.tracks.filter(
      (track): track is Track =>
        trackHasAudioItems(project, track.id) &&
        !track.clips.every((clip) => excludedClipIds.has(clip.id)),
    );
  }, [audioTargetClip?.id, clipId, project]);

  const currentTrack = useMemo(() => {
    for (const track of project.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id === (audioTargetClip?.id ?? clipId)) {
          return track;
        }
      }
    }
    return null;
  }, [audioTargetClip?.id, project.timeline.tracks, clipId]);

  const persistedSettings = useMemo(() => {
    const candidate = audioTargetClip?.metadata?.audioDucking;
    return isAudioDuckingSettings(candidate) ? candidate : null;
  }, [audioTargetClip]);

  const hasAppliedDucking = Boolean(
    persistedSettings?.enabled &&
      (audioTargetClip?.automation?.volume?.length ?? 0) > 0,
  );
  const showControls = settings.enabled || hasAppliedDucking;

  useEffect(() => {
    if (persistedSettings) {
      setSettings({ ...DEFAULT_SETTINGS, ...persistedSettings });
    } else {
      setSettings(DEFAULT_SETTINGS);
    }

    setErrorMessage(null);
  }, [clipId, persistedSettings]);

  const updateSetting = useCallback(
    <K extends keyof AudioDuckingSettings>(
      key: K,
      value: AudioDuckingSettings[K],
    ) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setErrorMessage(null);
    },
    [],
  );

  const applyPreset = useCallback((presetId: string) => {
    const preset = PRESET_CONFIGS.find((p) => p.id === presetId);
    if (preset) {
      setSettings((prev) => ({ ...prev, ...preset.settings }));
      setErrorMessage(null);
    }
  }, []);

  const handleApplyDucking = useCallback(async () => {
    if (!audioTargetClip || !settings.sourceTrackId) {
      return;
    }

    const sourceTrack = project.timeline.tracks.find(
      (track) => track.id === settings.sourceTrackId,
    );

    if (!sourceTrack) {
      setErrorMessage("请选择有效的触发源轨道。");
      return;
    }

    setIsApplying(true);
    setErrorMessage(null);

    try {
      const triggerBuffer = await buildTriggerTrackBuffer(
        project,
        audioTargetClip,
        sourceTrack,
      );
      const ducker = new AudioDucker();
      const keyframes = ducker.generateDuckingKeyframes(
        triggerBuffer,
        settings,
        audioTargetClip.volume > 0 ? audioTargetClip.volume : 1,
      );

      if (keyframes.length === 0) {
        throw new Error(
          "没有语音超过触发阈值。请降低阈值或选择更响的源轨道。",
        );
      }

      const persisted = { ...settings, enabled: true };
      const applied = setClipAudioDucking(audioTargetClip.id, persisted, keyframes);

      if (!applied) {
        throw new Error("无法在该片段上保存闪避设置。");
      }

      window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "无法应用闪避。",
      );
    } finally {
      setIsApplying(false);
    }
  }, [audioTargetClip, project, setClipAudioDucking, settings]);

  const handleRemoveDucking = useCallback(() => {
    const cleared = clearClipAudioDucking(audioTargetClip?.id ?? clipId);

    if (!cleared) {
      setErrorMessage("无法从该片段移除闪避。");
      return;
    }

    setSettings(DEFAULT_SETTINGS);
    setErrorMessage(null);
    window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
  }, [audioTargetClip?.id, clearClipAudioDucking, clipId]);

  return (
    <div className="space-y-3">
      <Card
        variant="green"
        padding={2}
        className="flex items-center gap-2 border border-primary/30"
      >
        <VolumeX size={16} className="text-primary" aria-hidden />
        <div className="flex flex-1 flex-col gap-0.5">
          <Text type="body" color="primary" weight="bold" className="block text-[11px]">
            音频闪避
          </Text>
          <Text type="supporting" color="secondary" className="block text-[9px]">
            有语音时自动降低音乐音量
          </Text>
        </div>
      </Card>

      <Card
        variant="muted"
        padding={2}
        className="flex items-center justify-between gap-3"
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              showControls ? "bg-green-400" : "bg-gray-500"
            }`}
          />
          <Text type="supporting" color="primary" weight="bold">
            {showControls ? "闪避已启用" : "闪避已禁用"}
          </Text>
        </div>
        <MockToggle
          ariaLabel="Enable audio ducking"
          checked={settings.enabled}
          onChange={(checked) => updateSetting("enabled", checked)}
        />
      </Card>

      {showControls && (
        <>
          <div className="space-y-2">
            <Text
              type="supporting"
              color="secondary"
              weight="bold"
              className="flex items-center gap-2"
            >
              <Mic size={12} aria-hidden />
              触发源（人声轨道）
            </Text>
            {availableSourceTracks.length > 0 ? (
              <div className="space-y-1">
                {availableSourceTracks
                  .filter((track) => track.id !== currentTrack?.id)
                  .map((track) => (
                  <ClickableCard
                    key={track.id}
                    label={`将 ${getTrackLabel(track)} 设为闪避触发源`}
                    onClick={() => updateSetting("sourceTrackId", track.id)}
                    padding={2}
                    variant={
                      settings.sourceTrackId === track.id ? "green" : "muted"
                    }
                    className="w-full border border-transparent"
                  >
                    <div className="flex items-center gap-2">
                      <Volume2 size={12} className="text-fg-3" aria-hidden />
                      <Text
                        type="supporting"
                        color="primary"
                        className="flex-1 text-[10px]"
                      >
                        {getTrackLabel(track)}
                      </Text>
                      {settings.sourceTrackId === track.id && (
                        <Check size={12} className="text-primary" aria-hidden />
                      )}
                    </div>
                  </ClickableCard>
                ))}
              </div>
            ) : (
              <Card variant="muted" padding={3} className="text-center">
                <Mic
                  size={16}
                  className="mx-auto mb-1 text-fg-3 opacity-50"
                  aria-hidden
                />
                <Text type="supporting" color="secondary" className="text-[10px]">
                  添加另一条带语音的音频或视频轨道作为触发源
                </Text>
              </Card>
            )}
          </div>

          {settings.sourceTrackId && (
            <>
              <div className="space-y-2">
                <Text
                  type="supporting"
                  color="secondary"
                  weight="bold"
                  className="flex items-center gap-2"
                >
                  <Music size={12} aria-hidden />
                  闪避预设
                </Text>
                <div className="grid grid-cols-2 gap-1">
                  {PRESET_CONFIGS.map((preset) => (
                    <Button
                      key={preset.id}
                      label={preset.name}
                      variant="secondary"
                      size="sm"
                      onClick={() => applyPreset(preset.id)}
                      className="w-full text-[9px]"
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <DuckingSlider
                  label="检测阈值"
                  min={-50}
                  max={-10}
                  step={1}
                  value={settings.threshold}
                  onChange={(value) => updateSetting("threshold", value)}
                  formatValue={(value) => `${Math.round(value)} dB`}
                  description="触发闪避的人声电平"
                />

                <DuckingSlider
                  label="音量降低量"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.reduction * 100}
                  onChange={(value) => updateSetting("reduction", value / 100)}
                  formatValue={(value) => `${Math.round(value)}%`}
                  description="背景音乐降低的幅度"
                />
              </div>

              <Button
                label="时间控制"
                variant="ghost"
                size="sm"
                icon={
                  showAdvanced ? (
                    <ChevronDown size={12} aria-hidden />
                  ) : (
                    <ChevronRight size={12} aria-hidden />
                  )
                }
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full justify-start"
              />

              {showAdvanced && (
                <Card variant="muted" padding={2} className="space-y-3">
                  <DuckingSlider
                    label="启动时间"
                    min={0.01}
                    max={0.5}
                    step={0.01}
                    value={settings.attack}
                    onChange={(value) => updateSetting("attack", value)}
                    formatValue={(value) => `${value.toFixed(2)}s`}
                    description="人声开始时音量下降的速度"
                  />

                  <DuckingSlider
                    label="释放时间"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={settings.release}
                    onChange={(value) => updateSetting("release", value)}
                    formatValue={(value) => `${value.toFixed(2)}s`}
                    description="人声结束后音量恢复的速度"
                  />

                  <DuckingSlider
                    label="保持时间"
                    min={0}
                    max={0.5}
                    step={0.05}
                    value={settings.holdTime}
                    onChange={(value) => updateSetting("holdTime", value)}
                    formatValue={(value) => `${value.toFixed(2)}s`}
                    description="词与词之间保持闪避的最短时间"
                  />
                </Card>
              )}

              {!hasAppliedDucking ? (
                <Button
                  label={isApplying ? "分析中…" : "应用闪避"}
                  icon={
                    isApplying ? (
                      <RefreshCw size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <VolumeX size={14} aria-hidden />
                    )
                  }
                  variant="primary"
                  size="md"
                  onClick={handleApplyDucking}
                  isDisabled={isApplying}
                  isLoading={isApplying}
                  className="w-full"
                />
              ) : (
                <div className="space-y-2">
                  <Card
                    variant="green"
                    padding={2}
                    className="flex items-center gap-2 border border-green-500/20"
                  >
                    <Check size={12} className="text-green-400" aria-hidden />
                    <Text type="supporting" className="text-[10px] text-green-400">
                      闪避已应用
                    </Text>
                  </Card>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      label={isApplying ? "更新中…" : "更新"}
                      icon={
                        <RefreshCw
                          size={10}
                          className={isApplying ? "animate-spin" : undefined}
                          aria-hidden
                        />
                      }
                      variant="secondary"
                      size="sm"
                      onClick={handleApplyDucking}
                      isDisabled={isApplying}
                      isLoading={isApplying}
                    />
                    <Button
                      label="移除"
                      variant="secondary"
                      size="sm"
                      onClick={handleRemoveDucking}
                      isDisabled={isApplying}
                      className="text-red-400"
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {errorMessage && (
        <Card
          variant="red"
          padding={2}
          className="flex items-center gap-2 border border-red-500/20"
        >
          <AlertCircle size={12} className="text-red-400" aria-hidden />
          <Text type="supporting" className="text-[9px] text-red-400">
            {errorMessage}
          </Text>
        </Card>
      )}

      <div className="pt-2 border-t border-border">
        <Text type="supporting" color="secondary" className="block text-[9px] text-center">
          检测到人声时自动降低音乐音量
        </Text>
      </div>
    </div>
  );
};

export default AudioDuckingSection;
