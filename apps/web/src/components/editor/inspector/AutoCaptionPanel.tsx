import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SUBTITLE_STYLE_PRESETS,
  splitCaptionIntoSingleLineCues,
  type Clip,
  type MediaItem,
  type TranscriptionSegment,
} from "@openreel/core";
import {
  ToolcraftButton as Button,
  ToolcraftCard as Card,
  ToolcraftSelectControl as Selector,
  ToolcraftText as Text,
} from "@openreel/ui";
import {
  AlertCircle,
  Check,
  Download,
  Languages,
  Loader2,
  Sparkles,
  Subtitles,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { loadAudioBuffer } from "../../../utils/load-audio-buffer";
import { audioBufferToWhisperSamples } from "../../../utils/whisper-audio";
import {
  DEFAULT_WHISPER_MODEL,
  WHISPER_MODELS,
  isWhisperModelKey,
  type WhisperModelKey,
} from "../../../workers/whisper-models";

const CAPTION_STYLE_PRESETS = ["default", "modern", "bold", "cinematic", "minimal"] as const;
const WHISPER_LANGUAGES = [
  { code: "en", name: "英语" },
  { code: "fr", name: "法语" },
  { code: "de", name: "德语" },
  { code: "es", name: "西班牙语" },
  { code: "it", name: "意大利语" },
  { code: "pt", name: "葡萄牙语" },
  { code: "hi", name: "印地语" },
  { code: "ja", name: "日语" },
  { code: "ko", name: "韩语" },
  { code: "zh", name: "中文" },
  { code: "ru", name: "俄语" },
  { code: "tr", name: "土耳其语" },
  { code: "pl", name: "波兰语" },
  { code: "vi", name: "越南语" },
] as const;

interface AutoCaptionPanelProps {
  clipId?: string;
  maxWordsPerLine?: number;
  /** Show the one-click "transcribe whole timeline" workflow. */
  allowTimeline?: boolean;
}

interface WorkerChunk {
  text: string;
  timestamp: [number | null, number | null];
}

type WorkerState = "idle" | "loading" | "ready";

export const AutoCaptionPanel: React.FC<AutoCaptionPanelProps> = ({
  clipId,
  maxWordsPerLine = 5,
  allowTimeline = true,
}) => {
  const getClip = useProjectStore((state) => state.getClip);
  const getMediaItem = useProjectStore((state) => state.getMediaItem);
  const getAllTextClips = useProjectStore((state) => state.getAllTextClips);
  const addSubtitle = useProjectStore((state) => state.addSubtitle);
  const workerRef = useRef<Worker | null>(null);
  const [workerState, setWorkerState] = useState<WorkerState>("idle");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("en");
  const [selectedStyle, setSelectedStyle] = useState<string>("default");
  const [selectedModel, setSelectedModel] = useState<WhisperModelKey>(
    DEFAULT_WHISPER_MODEL,
  );
  const [readyModels, setReadyModels] = useState<Set<WhisperModelKey>>(
    () => new Set(),
  );
  const [modelBackends, setModelBackends] = useState<
    Partial<Record<WhisperModelKey, "webgpu" | "wasm">>
  >({});
  const [segments, setSegments] = useState<TranscriptionSegment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [timelineBusy, setTimelineBusy] = useState(false);
  const [timelineProgress, setTimelineProgress] = useState(0);
  const [timelineSummary, setTimelineSummary] = useState("");

  const selectedItems = useUIStore((state) => state.selectedItems);
  const resolvedClipId =
    clipId ?? selectedItems.find((item) => item.type === "clip")?.id ?? "";
  const clip = getClip(resolvedClipId);
  const mediaItem = clip ? getMediaItem(clip.mediaId) : undefined;
  const canTranscribe = Boolean(
    clip && mediaItem && (mediaItem.type === "video" || mediaItem.type === "audio"),
  );

  useEffect(() => {
    const worker = new Worker(
      new URL("../../../workers/whisper-worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const runWorker = useCallback(
    (
      type: "load" | "transcribe",
      audio?: Float32Array,
    ): Promise<{ text?: string; chunks?: WorkerChunk[] }> => {
      const worker = workerRef.current;
      if (!worker) return Promise.reject(new Error("字幕工作器尚未就绪。"));
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const handleMessage = (event: MessageEvent<Record<string, unknown>>) => {
          if (event.data.requestId !== requestId) return;
          const messageType = event.data.type;
          if (messageType === "model-progress") {
            setWorkerState("loading");
            const rawProgress = Number(event.data.progress ?? 0);
            setProgress(rawProgress > 1 ? rawProgress / 100 : rawProgress);
            const file = String(event.data.file ?? "字幕模型").split("/").pop();
            setProgressMessage(`正在下载 ${file || "字幕模型"}…`);
          } else if (messageType === "transcription-progress") {
            setWorkerState("ready");
            setProgress(Number(event.data.progress ?? 0));
            setProgressMessage("Transcribing selected clip locally…");
          } else if (messageType === "ready") {
            worker.removeEventListener("message", handleMessage);
            setWorkerState("ready");
            setReadyModels((current) => new Set(current).add(selectedModel));
            const backend = event.data.backend;
            if (backend === "webgpu" || backend === "wasm") {
              setModelBackends((current) => ({
                ...current,
                [selectedModel]: backend,
              }));
            }
            setProgress(1);
            setProgressMessage("离线字幕模型已就绪");
            resolve({});
          } else if (messageType === "result") {
            worker.removeEventListener("message", handleMessage);
            setWorkerState("ready");
            setReadyModels((current) => new Set(current).add(selectedModel));
            const backend = event.data.backend;
            if (backend === "webgpu" || backend === "wasm") {
              setModelBackends((current) => ({
                ...current,
                [selectedModel]: backend,
              }));
            }
            setProgress(1);
            resolve({
              text: String(event.data.text ?? ""),
              chunks: (event.data.chunks ?? []) as WorkerChunk[],
            });
          } else if (messageType === "error") {
            worker.removeEventListener("message", handleMessage);
            reject(new Error(String(event.data.message ?? "本地转写失败。")));
          }
        };
        worker.addEventListener("message", handleMessage);
        if (audio) {
          worker.postMessage(
            {
              requestId,
              type,
              audio,
              language: selectedLanguage,
              model: selectedModel,
            },
            [audio.buffer],
          );
        } else {
          worker.postMessage({
            requestId,
            type,
            language: selectedLanguage,
            model: selectedModel,
          });
        }
      });
    },
    [selectedLanguage, selectedModel],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!isWhisperModelKey(value)) return;
      setSelectedModel(value);
      setSegments([]);
      setError(null);
      setProgress(readyModels.has(value) ? 1 : 0);
      setProgressMessage(readyModels.has(value) ? "离线字幕模型已就绪" : "");
      setWorkerState(readyModels.has(value) ? "ready" : "idle");
    },
    [readyModels],
  );

  const handlePrepareModel = useCallback(async () => {
    setError(null);
    setWorkerState("loading");
    setProgress(0);
    setProgressMessage("正在准备本地字幕模型…");
    try {
      await runWorker("load");
    } catch (reason) {
      setWorkerState("idle");
      setError(reason instanceof Error ? reason.message : "模型下载失败。");
    }
  }, [runWorker]);

  /** Decode + Whisper-transcribe one media clip and map chunks to timeline time. */
  const transcribeClip = useCallback(
    async (
      targetClip: Clip,
      targetMedia: MediaItem,
      report?: (progress: number, message: string) => void,
    ): Promise<TranscriptionSegment[]> => {
      const sourceBlob =
        targetMedia.blob ??
        (targetMedia.fileHandle ? await targetMedia.fileHandle.getFile() : null);
      if (!sourceBlob) throw new Error("创建字幕前请重新连接源媒体。");

      const audioContext = new AudioContext();
      try {
        const audioBuffer = await loadAudioBuffer(audioContext, sourceBlob, {
          audioTrackIndex: targetClip.audioTrackIndex,
          onProgress: (next) => report?.(next.progress * 0.18, next.message),
        });
        if (!audioBuffer) throw new Error("无法解码所选片段的音频。");

        const sourceStart = Math.max(0, targetClip.inPoint ?? 0);
        const sourceEnd = Math.min(
          audioBuffer.duration,
          targetClip.outPoint > sourceStart
            ? targetClip.outPoint
            : sourceStart + targetClip.duration * Math.max(targetClip.speed ?? 1, 0.01),
        );
        if (sourceEnd <= sourceStart) return [];
        const samples = audioBufferToWhisperSamples(audioBuffer, sourceStart, sourceEnd);
        report?.(
          0.2,
          workerState === "ready"
            ? `正在用 ${WHISPER_MODELS[selectedModel].shortLabel} 转写…`
            : `正在下载 ${WHISPER_MODELS[selectedModel].shortLabel}，然后转写…`,
        );
        const result = await runWorker("transcribe", samples);
        const sourceDuration = Math.max(0.1, sourceEnd - sourceStart);
        const playbackSpeed = Math.max(targetClip.speed ?? 1, 0.01);
        const clipEndTime = targetClip.startTime + targetClip.duration;
        const nextSegments: TranscriptionSegment[] = (result.chunks ?? [])
          .map((chunk) => {
            const start = Math.max(0, chunk.timestamp?.[0] ?? 0);
            const end = Math.min(
              sourceDuration,
              chunk.timestamp?.[1] ?? Math.min(sourceDuration, start + 3),
            );
            return {
              text: chunk.text.trim(),
              startTime: Math.min(clipEndTime, targetClip.startTime + start / playbackSpeed),
              endTime: Math.min(
                clipEndTime,
                targetClip.startTime + Math.max(start + 0.1, end) / playbackSpeed,
              ),
              confidence: 1,
            };
          })
          .filter(
            (segment) =>
              segment.text.length > 0 && segment.endTime > segment.startTime,
          );
        if (nextSegments.length === 0 && result.text?.trim()) {
          nextSegments.push({
            text: result.text.trim(),
            startTime: targetClip.startTime,
            endTime: clipEndTime,
            confidence: 1,
          });
        }
        return nextSegments;
      } finally {
        await audioContext.close().catch(() => undefined);
      }
    },
    [runWorker, selectedModel, workerState],
  );

  /** Put generated cues on the dedicated captions track. Returns cue count. */
  const addSegmentsToTimeline = useCallback(
    async (nextSegments: TranscriptionSegment[], sourceClip: Clip): Promise<number> => {
      const style = SUBTITLE_STYLE_PRESETS[selectedStyle] ?? SUBTITLE_STYLE_PRESETS.default;
      let addedCount = 0;
      for (const segment of nextSegments) {
        const cues = splitCaptionIntoSingleLineCues(
          segment.text,
          segment.startTime,
          segment.endTime,
          maxWordsPerLine,
        );
        for (const cue of cues) {
          await addSubtitle(
            {
              id: `whisper-${crypto.randomUUID()}`,
              text: cue.text,
              startTime: cue.startTime,
              endTime: cue.endTime,
              style,
            },
            {
              captionSource: "whisper",
              captionSourceClipId: sourceClip.id,
              captionMaxWordsPerLine: maxWordsPerLine,
              captionWhisperModel: selectedModel,
            },
          );
          addedCount += 1;
        }
      }
      return addedCount;
    },
    [addSubtitle, maxWordsPerLine, selectedModel, selectedStyle],
  );

  const handleTranscribe = useCallback(async () => {
    if (!clip || !mediaItem) return;
    setError(null);
    setSegments([]);
    setIsTranscribing(true);
    setProgress(0);
    setProgressMessage("正在提取所选片段的音频…");
    try {
      const nextSegments = await transcribeClip(clip, mediaItem, (value, message) => {
        setProgress(value);
        setProgressMessage(message);
      });
      if (nextSegments.length === 0) throw new Error("所选片段中未检测到语音。");
      setSegments(nextSegments);
      setProgressMessage("字幕已就绪，可以添加");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "本地转写失败。");
    } finally {
      setIsTranscribing(false);
    }
  }, [clip, mediaItem, transcribeClip]);

  const handleAddToTimeline = useCallback(async () => {
    if (!clip || segments.length === 0) return;
    const addedCount = await addSegmentsToTimeline(segments, clip);
    setSegments([]);
    setProgressMessage(`已将 ${addedCount} 条单行字幕添加到字幕轨。`);
  }, [addSegmentsToTimeline, clip, segments]);

  const handleTranscribeTimeline = useCallback(async () => {
    if (timelineBusy) return;
    setError(null);
    setTimelineSummary("");
    setTimelineBusy(true);
    setTimelineProgress(0);
    try {
      const currentProject = useProjectStore.getState().project;
      const alreadyCaptioned = new Set(
        getAllTextClips()
          .map((textClip) => textClip.metadata?.captionSourceClipId)
          .filter((id): id is string => typeof id === "string"),
      );
      const targets = currentProject.timeline.tracks
        .flatMap((track) => track.clips)
        .filter((candidate) => {
          if (alreadyCaptioned.has(candidate.id)) return false;
          const media = currentProject.mediaLibrary.items.find(
            (item) => item.id === candidate.mediaId,
          );
          return media?.type === "video" || media?.type === "audio";
        });
      if (targets.length === 0) {
        setTimelineSummary(
          "时间线上没有需要转写的视频或音频片段（已有 AI 字幕的片段会自动跳过）。",
        );
        return;
      }
      let cueCount = 0;
      let failed = 0;
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const media = currentProject.mediaLibrary.items.find(
          (item) => item.id === target.mediaId,
        );
        if (!media) continue;
        try {
          const nextSegments = await transcribeClip(target, media, (value, message) => {
            setTimelineProgress((index + value) / targets.length);
            setProgressMessage(`片段 ${index + 1}/${targets.length}：${message}`);
          });
          cueCount += await addSegmentsToTimeline(nextSegments, target);
        } catch {
          failed += 1;
        }
      }
      setTimelineProgress(1);
      setTimelineSummary(
        `已处理 ${targets.length} 个片段，新增 ${cueCount} 条字幕${failed ? `，${failed} 个片段未识别出语音` : ""}。字幕均在独立的「字幕」轨道上。`,
      );
    } finally {
      setTimelineBusy(false);
    }
  }, [addSegmentsToTimeline, getAllTextClips, timelineBusy, transcribeClip]);

  const modelStatus = useMemo(() => {
    const model = WHISPER_MODELS[selectedModel];
    if (workerState === "ready") {
      const backend = modelBackends[selectedModel];
      return `模型已下载并缓存${backend ? ` · ${backend === "webgpu" ? "GPU" : "CPU"}` : ""}`;
    }
    if (workerState === "loading") return progressMessage || "Downloading model…";
    return `${model.downloadSize} · ${model.description}`;
  }, [modelBackends, progressMessage, selectedModel, workerState]);

  return (
    <div className="w-full min-w-0 space-y-3">
      <Card variant="muted" padding={3} className="space-y-2 border border-primary/30 bg-primary/5">
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[11px]">
            模型质量
          </Text>
          <Selector
            label="本地字幕模型"
            isLabelHidden
            size="sm"
            width={176}
            value={selectedModel}
            onChange={handleModelChange}
            isDisabled={workerState === "loading" || isTranscribing}
            options={(
              Object.entries(WHISPER_MODELS) as Array<
                [WhisperModelKey, (typeof WHISPER_MODELS)[WhisperModelKey]]
              >
            ).map(([value, model]) => ({
              label: model.label,
              value,
            }))}
          />
        </div>
        <div className="flex items-start gap-2">
          {workerState === "ready" ? (
            <Check size={15} className="mt-0.5 text-primary" aria-hidden />
          ) : (
            <Download size={15} className="mt-0.5 text-primary" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <Text type="supporting" weight="bold" className="block text-[11px] text-fg">
              {WHISPER_MODELS[selectedModel].shortLabel}
            </Text>
            <Text type="supporting" color="secondary" className="block text-[11px]">
              {modelStatus}
            </Text>
          </div>
        </div>
        {workerState === "loading" && (
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${Math.max(3, Math.min(100, progress * 100))}%` }}
            />
          </div>
        )}
        {workerState === "idle" && (
          <Button
            label={`下载 ${WHISPER_MODELS[selectedModel].shortLabel}`}
            icon={<Download size={13} aria-hidden />}
            variant="secondary"
            size="sm"
            onClick={handlePrepareModel}
            className="w-full justify-center"
          />
        )}
        <Text type="supporting" color="secondary" className="block text-[11px] leading-relaxed">
          首次下载后存储在此浏览器中。媒体不会离开您的设备。
        </Text>
      </Card>

      <Card variant="muted" padding={3} className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Languages size={14} className="text-fg-2" aria-hidden />
            <Text type="supporting" color="secondary" className="text-[11px]">语言</Text>
          </div>
          <Selector
            label="字幕语言"
            isLabelHidden
            size="sm"
            width={132}
            value={selectedLanguage}
            onChange={setSelectedLanguage}
            isDisabled={isTranscribing}
            options={WHISPER_LANGUAGES.map((language) => ({
              label: language.name,
              value: language.code,
            }))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Text type="supporting" color="secondary" className="text-[11px]">字幕样式</Text>
          <Selector
            label="字幕样式"
            isLabelHidden
            size="sm"
            width={132}
            value={selectedStyle}
            onChange={setSelectedStyle}
            isDisabled={isTranscribing}
            options={CAPTION_STYLE_PRESETS.map((preset) => ({
              label: preset[0].toUpperCase() + preset.slice(1),
              value: preset,
            }))}
          />
        </div>
      </Card>

      {error && (
        <Card variant="muted" padding={2} className="flex items-start gap-2 border border-red-500/30 bg-red-500/10">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" aria-hidden />
          <Text type="supporting" className="text-[11px] text-red-400">{error}</Text>
        </Card>
      )}

      {isTranscribing && (
        <Card variant="muted" padding={3} className="flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-primary" aria-hidden />
          <Text type="supporting" color="secondary" className="text-[11px]">
            {progressMessage}
          </Text>
        </Card>
      )}

      {segments.length > 0 && (
        <div className="space-y-2">
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {segments.map((segment, index) => (
              <Card key={`${segment.startTime}-${index}`} variant="muted" padding={2} className="text-[11px]">
                <span className="font-mono text-fg-muted">{segment.startTime.toFixed(1)}s</span>
                <span className="ml-2 text-fg">{segment.text}</span>
              </Card>
            ))}
          </div>
          <Button
            label={`将 ${segments.length} 条添加为可编辑文本`}
            variant="primary"
            size="sm"
            onClick={handleAddToTimeline}
            className="w-full justify-center"
          />
        </div>
      )}

      <Button
        label={isTranscribing ? "正在本地转写…" : "转写所选片段"}
        icon={
          isTranscribing ? (
            <Loader2 size={14} className="animate-spin" aria-hidden />
          ) : (
            <Sparkles size={14} aria-hidden />
          )
        }
        variant="primary"
        size="md"
        onClick={handleTranscribe}
        isDisabled={!canTranscribe || isTranscribing || timelineBusy}
        className="w-full justify-center"
      />

      {allowTimeline && (
        <Card variant="muted" padding={3} className="space-y-2 border border-border">
          <div className="flex items-start gap-2">
            <Subtitles size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <Text type="supporting" weight="bold" className="block text-[12px] text-fg">
                整条时间线一键生成
              </Text>
              <Text type="supporting" color="secondary" className="block text-[11px]">
                逐个转写视频/音频片段，自动生成字幕并放入独立的字幕轨。已有 AI 字幕的片段会跳过。
              </Text>
            </div>
          </div>
          {timelineBusy && (
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-3">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.max(3, Math.min(100, timelineProgress * 100))}%` }}
              />
            </div>
          )}
          {timelineSummary && (
            <Text type="supporting" color="secondary" className="block text-[11px] leading-relaxed">
              {timelineSummary}
            </Text>
          )}
          <Button
            label={timelineBusy ? "正在转写时间线…" : "转写整条时间线"}
            icon={
              timelineBusy ? (
                <Loader2 size={14} className="animate-spin" aria-hidden />
              ) : (
                <Subtitles size={14} aria-hidden />
              )
            }
            variant="secondary"
            size="md"
            onClick={() => { void handleTranscribeTimeline(); }}
            isDisabled={timelineBusy || isTranscribing}
            className="w-full justify-center"
          />
        </Card>
      )}

      {!canTranscribe && (
        <Text type="supporting" color="secondary" className="block text-center text-[11px]">
          请先选择一个已连接的视频或音频片段。
        </Text>
      )}
    </div>
  );
};

export default AutoCaptionPanel;
