import { useEffect, useState, type JSX } from "react";
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
  const [bytes, setBytes] = useState<number | null>(null);
  const openModal = useUIStore((state) => state.openModal);
  const hasOpenProject = useProjectStore((state) => state.hasOpenProject);
  const setQuote = useServerChatStore((state) => state.setQuote);
  if (!job.videoUrl) return null;
  const url = resolveServerUrl(job.videoUrl);
  const title = job.plan?.options?.title || `OpenReel ${job.id.slice(0, 8)}`;

  return (
    <section className="overflow-hidden rounded-lg border border-status-success/25 bg-bg-2" aria-label={`成片：${title}`}>
      <video src={url} controls preload="metadata" className="aspect-video w-full bg-stage-bg object-contain" />
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
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Button label="插入时间线" size="sm" variant="primary" isLoading={inserting} isDisabled={!hasOpenProject} onClick={() => void insert()} />
          <Button label="让 AI 改" size="sm" variant="ghost" onClick={() => setQuote({ jobId: job.id, title })} className="border border-violet-500/40 bg-violet-500/15 text-violet-600 hover:bg-violet-500/25 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200" />
          <Button label="发布" size="sm" variant="ghost" onClick={publishVideo} className="border border-emerald-600/40 bg-emerald-600/10 text-emerald-600 hover:bg-emerald-600/25 dark:text-emerald-400" />
          <Button label="下载" size="sm" variant="secondary" href={url} download={`${safeName(title)}.mp4`} />
        </div>
      </div>
      <MetadataLoader url={url} onBytes={setBytes} />
    </section>
  );

  async function insert() {
    if (!job.videoUrl) return;
    setInserting(true);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`成片下载失败 (${response.status})`);
      const blob = await response.blob();
      const file = new File([blob], `${safeName(title)}.mp4`, { type: blob.type || "video/mp4" });
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

  function publishVideo() {
    if (!job.videoUrl) return;
    openModal("publishCenter", { videoPath: job.videoUrl, videoUrl: url, title, videogenJobId: job.id });
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
