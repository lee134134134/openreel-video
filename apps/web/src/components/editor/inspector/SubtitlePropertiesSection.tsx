import React, { useCallback, useMemo, useState } from "react";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftNumberInputControl,
  ToolcraftText as Text,
} from "@openreel/ui";
import {
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  Subtitles,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";

const POSITIONS = [
  { value: "top", label: "顶部", y: 0.14, icon: AlignVerticalJustifyStart },
  { value: "center", label: "居中", y: 0.5, icon: AlignVerticalJustifyCenter },
  { value: "bottom", label: "底部", y: 0.86, icon: AlignVerticalJustifyEnd },
] as const;

type Position = (typeof POSITIONS)[number]["value"];

interface SubtitlePropertiesSectionProps {
  clipId: string;
}

/** Dedicated, Apple-styled subtitle controls shown for caption text clips. */
export const SubtitlePropertiesSection: React.FC<SubtitlePropertiesSectionProps> = ({
  clipId,
}) => {
  const project = useProjectStore((state) => state.project);
  const getAllTextClips = useProjectStore((state) => state.getAllTextClips);
  const getTextClip = useProjectStore((state) => state.getTextClip);
  const updateTextStyle = useProjectStore((state) => state.updateTextStyle);
  const updateTextTransform = useProjectStore((state) => state.updateTextTransform);
  const updateOverlayClipTiming = useProjectStore((state) => state.updateOverlayClipTiming);
  const [position, setPosition] = useState<Position>("bottom");

  const captionIds = useMemo(() => {
    const roleTracks = new Set(
      project.timeline.tracks
        .filter((track) => track.role === "captions" || track.name === "字幕")
        .map((track) => track.id),
    );
    return getAllTextClips()
      .filter(
        (clip) =>
          roleTracks.has(clip.trackId) ||
          typeof clip.metadata?.captionSource === "string",
      )
      .map((clip) => clip.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.modifiedAt, getAllTextClips, project.timeline.tracks]);

  const isCaption = captionIds.includes(clipId);
  const caption = getTextClip(clipId);
  const captionStart = caption?.startTime ?? 0;
  const captionEnd = caption ? caption.startTime + caption.duration : 0;

  const handleTimingChange = useCallback(
    (nextStart: number, nextEnd: number) => {
      const start = Math.max(0, nextStart);
      const end = Math.max(start + 0.1, nextEnd);
      updateOverlayClipTiming(clipId, { startTime: start, duration: end - start });
    },
    [clipId, updateOverlayClipTiming],
  );

  const applyToAll = useCallback(
    (apply: (id: string) => void, message: string) => {
      const store = useProjectStore.getState();
      store.beginHistoryGroup(message);
      try {
        for (const id of captionIds) {
          if (!store.getTextClip(id)) continue;
          apply(id);
        }
      } finally {
        store.endHistoryGroup();
      }
      toast.success(message, `已更新 ${captionIds.length} 条字幕。`);
    },
    [captionIds],
  );

  const handlePosition = useCallback(
    (next: Position) => {
      setPosition(next);
      const y = POSITIONS.find((option) => option.value === next)?.y ?? 0.86;
      applyToAll((id) => {
        const current = getTextClip(id)?.transform?.position;
        updateTextTransform(id, {
          position: { x: current?.x ?? 0.5, y },
        });
      }, "调整字幕位置");
    },
    [applyToAll, getTextClip, updateTextTransform],
  );

  const handleFontSize = useCallback(
    (size: number) => {
      applyToAll((id) => updateTextStyle(id, { fontSize: size }), "调整字幕字号");
    },
    [applyToAll, updateTextStyle],
  );

  const handleBackground = useCallback(
    (visible: boolean) => {
      applyToAll(
        (id) =>
          updateTextStyle(id, {
            backgroundColor: visible ? "rgba(0, 0, 0, 0.75)" : "transparent",
          }),
        visible ? "开启字幕底色" : "关闭字幕底色",
      );
    },
    [applyToAll, updateTextStyle],
  );

  if (!isCaption) return null;

  return (
    <Card variant="muted" padding={3} className="space-y-3 border border-accent/25 bg-accent-soft/40">
      <div className="flex items-start gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-bg-1">
          <Subtitles size={16} className="text-accent" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Text type="supporting" weight="bold" className="block text-[12px] text-fg">
            字幕属性
          </Text>
          <Text type="supporting" color="secondary" className="block text-[11px] leading-relaxed">
            这是一条 AI 字幕，位于独立的「字幕」轨道。以下设置会应用到全部 {captionIds.length} 条字幕。
          </Text>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <ToolcraftNumberInputControl
          label="开始(秒)"
          size="sm"
          width="100%"
          value={Number(captionStart.toFixed(2))}
          step={0.1}
          min={0}
          onChange={(value) => handleTimingChange(value, captionEnd)}
        />
        <ToolcraftNumberInputControl
          label="结束(秒)"
          size="sm"
          width="100%"
          value={Number(captionEnd.toFixed(2))}
          step={0.1}
          min={0}
          onChange={(value) => handleTimingChange(captionStart, value)}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Text type="supporting" color="secondary" className="text-[12px]">
          位置
        </Text>
        <div className="flex gap-1">
          {POSITIONS.map((option) => (
            <Button
              key={option.value}
              label={option.label}
              icon={<option.icon size={13} aria-hidden />}
              size="sm"
              variant={position === option.value ? "primary" : "secondary"}
              onClick={() => handlePosition(option.value)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Text type="supporting" color="secondary" className="text-[12px]">
          字号
        </Text>
        <div className="flex gap-1">
          {[24, 32, 42].map((size) => (
            <Button
              key={size}
              label={`${size}px`}
              size="sm"
              variant="secondary"
              onClick={() => handleFontSize(size)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Text type="supporting" color="secondary" className="text-[12px]">
          底色
        </Text>
        <div className="flex gap-1">
          <Button label="开启" size="sm" variant="secondary" onClick={() => handleBackground(true)} />
          <Button label="关闭" size="sm" variant="secondary" onClick={() => handleBackground(false)} />
        </div>
      </div>
    </Card>
  );
};
