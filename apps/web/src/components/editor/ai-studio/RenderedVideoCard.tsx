import { useEffect, useState, type JSX } from "react";
import { AlertCircle, RotateCcw } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import type { VideogenJobDTO } from "@openreel/plugin-sdk";
import { resolveServerUrl } from "../../../services/server-ai/api";
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
      const projectStore = useProjectStore.getState();
      const imported = await projectStore.importMedia(file);
      if (!imported.success || !imported.actionId) throw new Error(imported.error?.message || "无法注册成片媒体");
      const placed = await useProjectStore.getState().addClipToNewTrack(
        imported.actionId,
        useTimelineStore.getState().playheadPosition,
      );
      if (!placed.success) throw new Error(placed.error?.message || "无法插入视频片段");
      toast.success("已插入时间线", title);
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
