import type { JSX } from "react";
import { AlertCircle, LoaderCircle, RefreshCw, X } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import type { VideogenJobDTO } from "@openreel/plugin-sdk";
import { useVideogenJobsStore } from "../../../stores/videogen-jobs-store";

const STAGES: Record<string, string> = {
  preparing: "准备素材",
  prepare: "准备素材",
  assets: "准备素材",
  subtitles: "字幕",
  subtitle: "字幕",
  audio: "音频",
  tts: "音频",
  encoding: "编码视频",
  encode: "编码视频",
  composing: "编码视频",
  packaging: "封装",
  muxing: "封装",
  queued: "排队中",
  draft: "准备素材",
  running: "准备素材",
};

export function RenderJobChip({ job }: { job: VideogenJobDTO }): JSX.Element {
  const retryJob = useVideogenJobsStore((state) => state.retryJob);
  const dismissJob = useVideogenJobsStore((state) => state.dismissJob);
  const streamError = useVideogenJobsStore((state) => state.errors[job.id]);
  const failed = job.state === "failed" || job.state === "cancelled";
  const percent = Math.max(0, Math.min(100, Math.round(job.progress <= 1 ? job.progress * 100 : job.progress)));
  const stage = STAGES[job.stage ?? job.state] ?? job.stage ?? "准备素材";
  const elapsed = Math.max(0, Date.now() - new Date(job.createdAt).getTime()) / 1000;
  const remaining = percent >= 5 && percent < 100 ? Math.round(elapsed * (100 - percent) / percent) : null;

  return (
    <div className={`rounded-lg border p-3 ${failed ? "border-status-error/35 bg-status-error/10" : "border-border bg-bg-2"}`} role="status">
      <div className="flex items-center gap-2">
        {failed ? <AlertCircle size={15} className="shrink-0 text-status-error" aria-hidden /> : <LoaderCircle size={15} className="shrink-0 animate-spin text-accent" aria-hidden />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-medium text-fg">{job.plan.options.title}</div>
          <div className={`mt-0.5 text-[10px] ${failed ? "text-status-error" : "text-fg-muted"}`}>
            {failed ? `渲染失败 · ${stage}` : `${stage} · ${percent}%${remaining !== null ? ` · 预计 ${formatEta(remaining)}` : ""}`}
          </div>
        </div>
        {!failed && <span className="text-[11px] tabular-nums text-fg-2">{percent}%</span>}
      </div>
      {!failed && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-3" aria-label={`渲染进度 ${percent}%`}>
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}
      {failed && <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-status-error">{job.error || streamError || "服务器未返回错误详情"}</p>}
      {!failed && streamError && <p className="mt-2 text-[10px] text-status-warning">{streamError}，正在等待重连。</p>}
      {failed && (
        <div className="mt-2 flex justify-end gap-2">
          <Button label="放弃" size="sm" variant="ghost" onClick={() => dismissJob(job.id)} icon={<X size={12} aria-hidden />} />
          <Button label="重试" size="sm" variant="secondary" onClick={() => void retryJob(job.id)} icon={<RefreshCw size={12} aria-hidden />} />
        </div>
      )}
    </div>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.max(1, Math.round(seconds / 60))} 分钟`;
}
