import { useEffect, useState, type JSX } from "react";
import { AlertCircle, RotateCcw } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { SUBTITLE_STYLE_PRESETS } from "@openreel/core";
import type { VideoEvalReport, VideogenJobDTO } from "@openreel/plugin-sdk";
import { apiRequest, resolveServerUrl } from "../../../services/server-ai/api";
import { useProjectStore } from "../../../stores/project-store";
import { useTimelineStore } from "../../../stores/timeline-store";
import { useUIStore } from "../../../stores/ui-store";
import { useServerChatStore } from "../../../stores/server-chat-store";
import { toast } from "../../../stores/notification-store";

export function RenderedVideoCard({ job }: { job: VideogenJobDTO }): JSX.Element | null {
  const [inserting, setInserting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [bytes, setBytes] = useState<number | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [evalReport, setEvalReport] = useState<VideoEvalReport | undefined>(job.eval);
  const [evaluating, setEvaluating] = useState(false);
  useEffect(() => setEvalReport(job.eval), [job.eval]);
  const openModal = useUIStore((state) => state.openModal);
  const hasOpenProject = useProjectStore((state) => state.hasOpenProject);
  const setQuote = useServerChatStore((state) => state.setQuote);
  if (!job.videoUrl) return null;
  const url = resolveServerUrl(job.videoUrl);
  const title = job.plan?.options?.title || `OpenReel ${job.id.slice(0, 8)}`;
  const filename = `${safeName(title)}.mp4`;

  return (
    <section className="overflow-hidden rounded-lg border border-status-success/25 bg-bg-2" aria-label={`成片：${title}`}>
      <div className="relative">
        <video
          key={reloadKey}
          src={url}
          poster={poster ?? undefined}
          crossOrigin="anonymous"
          controls
          playsInline
          preload="metadata"
          className="aspect-video w-full bg-stage-bg object-contain"
          onLoadedData={(event) => setPoster(capturePoster(event.currentTarget) ?? poster)}
          onError={() => setFailed(true)}
        />
        {failed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-stage-bg px-4 text-center">
            <AlertCircle size={18} className="text-status-error" aria-hidden />
            <div className="text-[11px] font-medium text-fg">成片无法加载</div>
            <p className="max-w-56 text-[10px] leading-relaxed text-fg-muted">
              本地服务可能已停止，或该成片文件已被清理。重启服务后可重新加载，也可以先下载文件。
            </p>
            <div className="mt-1 flex gap-1.5">
              <Button
                label="重新加载"
                size="sm"
                variant="secondary"
                icon={<RotateCcw size={12} aria-hidden />}
                onClick={() => {
                  setFailed(false);
                  setReloadKey((value) => value + 1);
                }}
              />
              <Button label="下载成片" size="sm" variant="primary" isLoading={downloading} onClick={() => void download()} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="p-3">
        <div className="truncate text-[12px] font-semibold text-fg">{title}</div>
        <div className="mt-1 text-[10px] text-fg-muted">
          {formatDuration(job.durationSec ?? job.plan?.estimatedDurationSec ?? 0)} · {job.plan?.options?.resolution ?? 720}p {job.plan?.options?.aspectRatio ?? "16:9"} · {bytes === null ? "大小未知" : formatBytes(bytes)}
        </div>
        {job.warnings?.length ? (
          <ul className="mt-2 space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5" aria-label="生成降级提示">
            {job.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-1 text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
                <span aria-hidden>⚠</span>
                <span className="min-w-0">{warning}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {evalReport ? (
          <div className={`mt-2 rounded-md border px-2 py-1.5 ${evalReport.passed ? "border-status-success/30 bg-status-success/10" : "border-amber-500/30 bg-amber-500/10"}`} aria-label="视频质量自检结果">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-fg">
                质量自检 {evalReport.score} 分 · {gradeLabel(evalReport.grade)} · {evalReport.passed ? "通过" : "待优化"}
              </div>
              <button
                type="button"
                disabled={evaluating}
                onClick={() => void reevaluate()}
                className="shrink-0 text-[10px] text-violet-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-violet-300"
              >
                {evaluating ? "自检中…" : "重新自检"}
              </button>
            </div>
            <div className="mt-1 text-[10px] text-fg-muted">
              冻结 {Math.round(evalReport.metrics.freezeRatio * 100)}% · 黑屏 {Math.round(evalReport.metrics.blackRatio * 100)}% · {evalReport.metrics.fps.toFixed(0)} fps · {evalReport.metrics.width}x{evalReport.metrics.height}
            </div>
            {evalReport.vision?.notes ? (
              <div className="mt-1 text-[10px] leading-relaxed text-fg-muted">视觉复评：{evalReport.vision.notes}</div>
            ) : null}
            {evalReport.suggestions.length ? (
              <ul className="mt-1 space-y-0.5">
                {evalReport.suggestions.map((suggestion) => (
                  <li key={suggestion} className="text-[10px] leading-relaxed text-fg-muted">· {suggestion}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-4 gap-1">
          <Button label="插入时间线" size="sm" variant="primary" className="whitespace-nowrap px-1.5 text-[10px]" isLoading={inserting} isDisabled={!hasOpenProject} onClick={() => void insert()} />
          <Button label="让 AI 改" size="sm" variant="ghost" onClick={() => setQuote({ jobId: job.id, title })} className="whitespace-nowrap border border-violet-500/40 bg-violet-500/15 px-1.5 text-[10px] text-violet-600 hover:bg-violet-500/25 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200" />
          <Button label="发布" size="sm" variant="ghost" onClick={publishVideo} className="whitespace-nowrap border border-emerald-600/40 bg-emerald-600/10 px-1.5 text-[10px] text-emerald-600 hover:bg-emerald-600/25 dark:text-emerald-400" />
          <Button label="下载" size="sm" variant="secondary" className="whitespace-nowrap px-1.5 text-[10px]" isLoading={downloading} onClick={() => void download()} />
        </div>
      </div>
      <MetadataLoader url={url} onBytes={setBytes} />
    </section>
  );

  async function insert() {
    if (!job.videoUrl) return;
    setInserting(true);
    try {
      const blob = await fetchVideoBlob();
      const file = new File([blob], filename, { type: blob.type || "video/mp4" });
      // Capture the action set once: Zustand replaces the state object after
      // each mutation, but these closures keep working against the live store.
      const projectStore = useProjectStore.getState();
      const imported = await projectStore.importMedia(file);
      if (!imported.success || !imported.actionId) throw new Error(imported.error?.message || "无法注册成片媒体");

      const startTime = useTimelineStore.getState().playheadPosition;
      const placed = await projectStore.addClipToNewTrack(imported.actionId, startTime);
      if (!placed.success) throw new Error(placed.error?.message || "无法插入视频片段");

      const inserted = useProjectStore
        .getState()
        .project.timeline.tracks.flatMap((track) => track.clips)
        .find((clip) => clip.mediaId === imported.actionId && clip.startTime === startTime);
      const clipId = inserted?.id;

      // 1) 字幕层：按分镜时长把字幕拆成独立、可编辑的字幕片段。
      const scenes = job.plan?.scenes ?? [];
      let cursor = startTime;
      for (const scene of scenes) {
        const text = (scene.subtitle || scene.narration || "").trim();
        const duration = Math.max(0.5, Number(scene.durationSec) || 3);
        if (text) {
          await projectStore.addSubtitle(
            {
              id: `videogen-${crypto.randomUUID()}`,
              text,
              startTime: cursor + 0.05,
              endTime: cursor + duration - 0.05,
              style: SUBTITLE_STYLE_PRESETS.default,
            },
            {
              captionSource: "videogen",
              captionSourceClipId: clipId,
            },
          );
        }
        cursor += duration;
      }

      // 2) 音频层：把成片里的声音分离到独立的「背景音乐」轨，视频片段静音。
      let audioTrackId: string | undefined;
      if (clipId) {
        const separated = await projectStore.separateAudio(clipId);
        if (separated.success) {
          const audioTrack = useProjectStore
            .getState()
            .project.timeline.tracks.find((track) =>
              track.clips.some((clip) => clip.metadata?.separatedFromClipId === clipId),
            );
          if (audioTrack) {
            audioTrackId = audioTrack.id;
            await projectStore.renameTrack(audioTrack.id, "背景音乐");
          }
        }
      }

      // 3) 图层顺序：字幕在最上，音频居中，视频在最下。
      const fresh = useProjectStore.getState().project;
      const captionTrack = fresh.timeline.tracks.find(
        (track) =>
          track.role === "captions" &&
          track.clips.some((clip) => clip.metadata?.captionSourceClipId === clipId),
      );
      if (captionTrack) await projectStore.reorderTrack(captionTrack.id, 0);
      if (audioTrackId) await projectStore.reorderTrack(audioTrackId, 1);

      toast.success(
        "已插入时间线 · 三层结构",
        `字幕 ${scenes.length} 条 / 背景音乐 ${audioTrackId ? "1" : "0"} 层 / 视频 1 层`,
      );
    } catch (error) {
      toast.error("插入时间线失败", error instanceof Error ? error.message : undefined);
    } finally {
      setInserting(false);
    }
  }

  /** Fetch the finished video and hand it to the browser as a same-origin
   * blob. A cross-origin `<a download>` is ignored by browsers, which would
   * save the file under the raw server UUID instead of the plan title. */
  async function download() {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await fetchVideoBlob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (error) {
      toast.error("下载失败", error instanceof Error ? error.message : undefined);
      window.open(url, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  }

  async function reevaluate() {
    if (evaluating) return;
    setEvaluating(true);
    try {
      const updated = await apiRequest<VideogenJobDTO>(`/videogen/jobs/${encodeURIComponent(job.id)}/eval`, { method: "POST" });
      setEvalReport(updated.eval);
      toast.success("质量自检完成", updated.eval ? `${updated.eval.score} 分 · ${updated.eval.passed ? "通过" : "待优化"}` : undefined);
    } catch (error) {
      toast.error("质量自检失败", error instanceof Error ? error.message : undefined);
    } finally {
      setEvaluating(false);
    }
  }

  async function fetchVideoBlob(): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`成片下载失败 (${response.status})`);
    return await response.blob();
  }

  function publishVideo() {
    if (!job.videoUrl) return;
    openModal("publishCenter", { videoPath: job.videoUrl, videoUrl: url, title, videogenJobId: job.id });
  }
}

/** Grab a frame from the loaded video so the card never sits on a blank
 * stage while the media element buffers (or after it fails). */
function capturePoster(video: HTMLVideoElement): string | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  try {
    const scale = Math.min(640 / width, 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    // Tainted canvas or a decoder hiccup — the native frame is still shown.
    return null;
  }
}

function MetadataLoader({ url, onBytes }: { url: string; onBytes: (bytes: number | null) => void }): null {
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { method: "HEAD", signal: controller.signal }).then((response) => {
      const value = Number(response.headers.get("content-length"));
      if (response.ok && Number.isFinite(value) && value > 0) onBytes(value);
    }).catch(() => undefined);
    return () => controller.abort();
  }, [url, onBytes]);
  return null;
}

function gradeLabel(grade: VideoEvalReport["grade"]): string {
  return grade === "excellent" ? "优秀" : grade === "good" ? "良好" : grade === "fair" ? "一般" : "较差";
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80) || "openreel-video";
}
