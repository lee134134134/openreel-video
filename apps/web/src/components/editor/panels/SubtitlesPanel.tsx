import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftText as Text,
  ToolcraftSelectControl as Selector,
} from "@openreel/ui";
import {
  Download,
  Subtitles,
  Upload,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from "@/icons/lucide-compat";
import { AutoCaptionPanel } from "../inspector/AutoCaptionPanel";
import { CaptionEditorPanel } from "../inspector/CaptionEditorPanel";
import { useProjectStore } from "../../../stores/project-store";
import { toast } from "../../../stores/notification-store";

const STYLE_PRESETS = ["default", "modern", "bold", "cinematic", "minimal"] as const;
const POSITION_OPTIONS = [
  { value: "top", label: "顶部", y: 0.14, icon: AlignVerticalJustifyStart },
  { value: "center", label: "居中", y: 0.5, icon: AlignVerticalJustifyCenter },
  { value: "bottom", label: "底部", y: 0.86, icon: AlignVerticalJustifyEnd },
] as const;

type PositionValue = (typeof POSITION_OPTIONS)[number]["value"];

/**
 * A single home for the whole subtitle workflow: Whisper generation on a
 * dedicated captions track, cue-by-cue adjustment, styling and SRT exchange.
 */
export const SubtitlesPanel: React.FC = () => {
  const project = useProjectStore((state) => state.project);
  const getAllTextClips = useProjectStore((state) => state.getAllTextClips);
  const updateTextStyle = useProjectStore((state) => state.updateTextStyle);
  const updateTextTransform = useProjectStore((state) => state.updateTextTransform);
  const applySubtitleStylePreset = useProjectStore((state) => state.applySubtitleStylePreset);
  const importSRT = useProjectStore((state) => state.importSRT);
  const exportSRT = useProjectStore((state) => state.exportSRT);
  const [maxWordsPerLine, setMaxWordsPerLine] = useState(5);
  const [position, setPosition] = useState<PositionValue>("bottom");
  const [preset, setPreset] = useState<string>("default");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const captionTracks = useMemo(
    () =>
      project.timeline.tracks.filter(
        (track) => track.role === "captions" || track.name === "字幕",
      ),
    [project.timeline.tracks],
  );
  const captionIds = useMemo(() => {
    const ids = new Set(captionTracks.map((track) => track.id));
    return getAllTextClips()
      .filter(
        (clip) => ids.has(clip.trackId) || typeof clip.metadata?.captionSource === "string",
      )
      .map((clip) => clip.id);
    // project.modifiedAt keeps this in sync with text-clip mutations.
  }, [captionTracks, getAllTextClips, project.modifiedAt]);
  const captionCount = captionIds.length;

  const applyPosition = useCallback(
    (next: PositionValue) => {
      setPosition(next);
      const y = POSITION_OPTIONS.find((option) => option.value === next)?.y ?? 0.86;
      for (const id of captionIds) {
        const current = useProjectStore.getState().getTextClip(id)?.transform?.position ?? {
          x: 0.5,
          y,
        };
        updateTextTransform(id, { position: { x: current.x ?? 0.5, y } });
      }
    },
    [captionIds, updateTextTransform],
  );

  const applyPreset = useCallback(
    async (name: string) => {
      setPreset(name);
      const ok = await applySubtitleStylePreset(name);
      if (!ok) toast.error("字幕样式应用失败", "请重试或选择其他预设。");
    },
    [applySubtitleStylePreset],
  );

  const setBackground = useCallback(
    (visible: boolean) => {
      for (const id of captionIds) {
        updateTextStyle(id, {
          backgroundColor: visible ? "rgba(0, 0, 0, 0.75)" : "transparent",
        });
      }
    },
    [captionIds, updateTextStyle],
  );

  const handleImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const result = await importSRT(await file.text(), {
          maxWordsPerLine,
        });
        if (result.success) {
          toast.success(
            "字幕已导入",
            `${captionCount ? "已添加到字幕轨。" : "已创建独立字幕轨。"}`,
          );
        } else {
          toast.error("字幕导入失败", result.errors[0] ?? "未找到有效字幕。");
        }
      } catch {
        toast.error("字幕导入失败", "无法读取所选字幕文件。");
      } finally {
        event.target.value = "";
      }
    },
    [captionCount, importSRT, maxWordsPerLine],
  );

  const handleExport = useCallback(async () => {
    try {
      const srt = await exportSRT();
      if (!srt.trim()) {
        toast.warning("没有可导出的字幕", "请先生成或导入字幕。");
        return;
      }
      const url = URL.createObjectURL(
        new Blob([srt], { type: "text/plain;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${project.name || "subtitles"}.srt`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("SRT 已导出", "字幕文件已开始下载。");
    } catch {
      toast.error("字幕导出失败", "请重试。");
    }
  }, [exportSRT, project.name]);

  return (
    <div className="space-y-4">
      <Card variant="muted" padding={3} className="border border-border bg-bg-1">
        <div className="flex items-start gap-2.5">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft">
            <Subtitles size={18} className="text-accent" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <Text type="large" weight="bold" className="block text-[14px] text-fg">
              字幕工作台
            </Text>
            <Text type="supporting" color="secondary" className="mt-0.5 block text-[12px] leading-relaxed">
              Whisper 本地转写生成字幕，自动放到独立的「字幕」轨道。你可以逐条修改文字、时间与样式，
              也可以导入或导出 SRT。
            </Text>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-fg-3">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
            字幕轨 {captionTracks.length}
          </span>
          <span className="rounded-full bg-bg-2 px-2 py-0.5">
            字幕条目 {captionCount}
          </span>
        </div>
      </Card>

      <section aria-label="AI 字幕生成" className="space-y-2">
        <Text type="supporting" weight="bold" className="block text-[12px] text-fg">
          1 · AI 字幕生成
        </Text>
        <AutoCaptionPanel maxWordsPerLine={maxWordsPerLine} />
      </section>

      <section aria-label="字幕样式与位置" className="space-y-2">
        <Text type="supporting" weight="bold" className="block text-[12px] text-fg">
          2 · 字幕样式与位置
        </Text>
        <Card variant="muted" padding={3} className="space-y-3 border border-border bg-bg-1">
          <div className="flex items-center justify-between gap-2">
            <Text type="supporting" color="secondary" className="text-[12px]">
              样式预设
            </Text>
            <Selector
              label="字幕样式预设"
              isLabelHidden
              size="sm"
              width={148}
              value={preset}
              onChange={(value) => { void applyPreset(value); }}
              options={STYLE_PRESETS.map((name) => ({
                label: name === "default" ? "经典白字" : name === "modern" ? "现代简约" : name === "bold" ? "醒目粗体" : name === "cinematic" ? "电影无底" : "极简",
                value: name,
              }))}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Text type="supporting" color="secondary" className="text-[12px]">
              画面位置
            </Text>
            <div className="flex gap-1">
              {POSITION_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  label={option.label}
                  icon={<option.icon size={13} aria-hidden />}
                  size="sm"
                  variant={position === option.value ? "primary" : "secondary"}
                  onClick={() => applyPosition(option.value)}
                  isDisabled={captionCount === 0}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Text type="supporting" color="secondary" className="text-[12px]">
              半透明底色
            </Text>
            <div className="flex gap-1">
              <Button label="开启" size="sm" variant="secondary" onClick={() => setBackground(true)} isDisabled={captionCount === 0} />
              <Button label="关闭" size="sm" variant="secondary" onClick={() => setBackground(false)} isDisabled={captionCount === 0} />
            </div>
          </div>
          <Text type="supporting" color="secondary" className="block text-[11px]">
            样式更改会应用到全部 {captionCount} 条字幕；单条字幕的文字和样式仍可在时间线或属性面板中独立调整。
          </Text>
        </Card>
      </section>

      <section aria-label="字幕逐条调整" className="space-y-2">
        <Text type="supporting" weight="bold" className="block text-[12px] text-fg">
          3 · 逐条调整
        </Text>
        <CaptionEditorPanel
          maxWordsPerLine={maxWordsPerLine}
          onMaxWordsPerLineChange={setMaxWordsPerLine}
        />
      </section>

      <section aria-label="字幕文件导入导出" className="space-y-2">
        <Text type="supporting" weight="bold" className="block text-[12px] text-fg">
          4 · 字幕文件
        </Text>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt,.vtt,text/srt,text/vtt,text/plain"
            className="hidden"
            onChange={(event) => { void handleImport(event); }}
          />
          <Button
            label="导入 SRT / VTT"
            icon={<Upload size={13} aria-hidden />}
            variant="secondary"
            size="md"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 justify-center"
          />
          <Button
            label="导出 SRT"
            icon={<Download size={13} aria-hidden />}
            variant="secondary"
            size="md"
            onClick={() => { void handleExport(); }}
            isDisabled={captionCount === 0}
            className="flex-1 justify-center"
          />
        </div>
      </section>
    </div>
  );
};

export default SubtitlesPanel;
