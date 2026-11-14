import React, { useRef, useState } from "react";
import { Captions, Download, Scissors, Volume2, Proportions, Loader2 } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { getMediaItemCapabilities } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";
import { toast } from "../../stores/notification-store";
import { splitTimelineItem, trimTimelineItemToPlayhead } from "../../utils/timeline-item-actions";
import { canQuickEditAtPlayhead } from "./quick-edit";

interface QuickEditBarProps {
  clipId: string;
  onCleanAudio: () => Promise<void>;
  isCleaningAudio: boolean;
}

export const QuickEditBar: React.FC<QuickEditBarProps> = ({
  clipId, onCleanAudio, isCleaningAudio,
}) => {
  const project = useProjectStore((state) => state.project);
  const track = project.timeline.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipId));
  const clip = track?.clips.find((candidate) => candidate.id === clipId);
  const media = project.mediaLibrary.items.find((candidate) => candidate.id === clip?.mediaId);
  const capabilities = getMediaItemCapabilities(media);
  const canEditHere = useTimelineStore((state) => Boolean(clip &&
    canQuickEditAtPlayhead(clip, state.playheadPosition, project.settings.frameRate)));
  const playbackLocked = useTimelineStore((state) => Boolean(state.playbackLockedReason));
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const applyingEffect = useUIStore((state) => state.effectApplicationClipId !== null);
  const [busy, setBusy] = useState(false);
  const editingRef = useRef(false);

  if (!clip || !track) return null;

  const disabled = track.locked || busy || exporting || playbackLocked || applyingEffect;
  const unavailableSource = media?.isPlaceholder || (!media?.blob && !media?.fileHandle);
  const openSection = (sectionId: string) => {
    useInspectorNavigationStore.getState().requestSection(sectionId, clipId);
  };
  const runEdit = async (operation: "split" | "trimStart" | "trimEnd") => {
    const store = useProjectStore.getState();
    const selectedIds = useUIStore.getState().getSelectedClipIds();
    const currentTrack = store.project.timeline.tracks.find((candidate) => candidate.clips.some((item) => item.id === clipId));
    const currentClip = currentTrack?.clips.find((item) => item.id === clipId);
    const timeline = useTimelineStore.getState();
    if (editingRef.current || !currentClip || currentTrack?.locked ||
      selectedIds.length !== 1 || selectedIds[0] !== clipId ||
      useUIStore.getState().exportState.isExporting ||
      useUIStore.getState().effectApplicationClipId !== null || timeline.playbackLockedReason ||
      !canQuickEditAtPlayhead(currentClip, timeline.playheadPosition, store.project.settings.frameRate)) return;
    const projectId = store.project.id;
    const time = timeline.playheadPosition;
    const label = operation === "split" ? "拆分片段" : operation === "trimStart" ? "裁剪片段开头" : "裁剪片段结尾";
    editingRef.current = true;
    setBusy(true);
    timeline.pause();
    store.beginHistoryGroup(label);
    try {
      const success = operation === "split"
        ? await splitTimelineItem(store, clipId, time)
        : await trimTimelineItemToPlayhead(store, clipId, time, operation === "trimStart");
      if (!success) throw new Error("无法应用此编辑，请尝试将播放头移动到片段内部。");
    } catch (error) {
      toast.error(`${label}失败`, error instanceof Error ? error.message : "请重试。");
    } finally {
      if (useProjectStore.getState().project.id === projectId) store.endHistoryGroup();
      editingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section aria-label="Quick edit" className="mb-5 rounded-lg border border-accent/25 bg-accent/5 p-3">
      <h3 className="text-sm font-semibold text-fg">快速编辑</h3>
      <p className="mt-1 mb-3 text-xs leading-relaxed text-fg-3">
        {track.locked ? "解锁此轨道后即可编辑该片段。" : canEditHere
          ? "在播放头处裁剪，然后完成你的视频。"
          : "将播放头移到该片段内部即可拆分或裁剪。"}
      </p>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 145px), 1fr))" }}>
        <Button label="在此拆分" icon={<Scissors size={14} aria-hidden />} variant="secondary"
          onClick={() => void runEdit("split")} isDisabled={disabled || !canEditHere}
          className="min-h-11 w-full justify-center text-xs" />
        <Button label="裁剪开头" title="删除播放头之前的部分" variant="secondary"
          onClick={() => void runEdit("trimStart")} isDisabled={disabled || !canEditHere}
          className="min-h-11 w-full justify-center text-xs" />
        <Button label="裁剪结尾" title="删除播放头之后的部分" variant="secondary"
          onClick={() => void runEdit("trimEnd")} isDisabled={disabled || !canEditHere}
          className="min-h-11 w-full justify-center text-xs" />
        {capabilities.audio && <Button label="添加字幕" icon={<Captions size={14} aria-hidden />} variant="secondary"
          onClick={() => openSection("auto-captions")} isDisabled={disabled || unavailableSource}
          className="min-h-11 w-full justify-center text-xs" />}
        {capabilities.audio && <Button label={isCleaningAudio ? "正在清理…" : "清理音频"}
          icon={isCleaningAudio ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Volume2 size={14} aria-hidden />}
          variant="secondary" onClick={() => { if (!disabled) void onCleanAudio(); }}
          isDisabled={disabled || isCleaningAudio || unavailableSource}
          className="min-h-11 w-full justify-center text-xs" />}
        {media?.type === "video" && <Button label="重新取景" icon={<Proportions size={14} aria-hidden />} variant="secondary"
          onClick={() => openSection("auto-reframe")} isDisabled={disabled || unavailableSource}
          className="min-h-11 w-full justify-center text-xs" />}
        <Button label="导出视频" icon={<Download size={14} aria-hidden />} variant="primary"
          onClick={() => useUIStore.getState().openModal("export")} isDisabled={exporting || playbackLocked}
          className="min-h-11 w-full justify-center text-xs" />
      </div>
      {busy && <p role="status" className="mt-2 text-xs text-fg-3">正在应用编辑…</p>}
    </section>
  );
};
