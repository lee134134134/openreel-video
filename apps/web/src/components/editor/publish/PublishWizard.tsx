import { useEffect, useState, type JSX } from "react";
import { Check, ChevronLeft, ChevronRight, Upload, Video } from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftSelectControl,
  ToolcraftTextAreaControl,
  ToolcraftTextInputControl,
} from "@openreel/ui";
import { listUploads, uploadSourceFile, type UploadDTO } from "../../../services/server-ai/agents";
import { usePublishStore } from "../../../stores/publish-store";
import { useVideogenJobsStore } from "../../../stores/videogen-jobs-store";
import { useUIStore } from "../../../stores/ui-store";
import { toast } from "../../../stores/notification-store";

const STEPS = ["视频源", "元数据", "隐私计划", "确认"] as const;
const PRIVACY_OPTIONS = [
  { value: "public", label: "公开" },
  { value: "unlisted", label: "不公开列出" },
  { value: "private", label: "私密" },
  { value: "draft", label: "草稿" },
] as const;

export function PublishWizard({ onPublished }: { onPublished: () => void }): JSX.Element {
  const draft = usePublishStore((state) => state.draft);
  const connectors = usePublishStore((state) => state.connectors);
  const updateDraft = usePublishStore((state) => state.updateDraft);
  const publishDraft = usePublishStore((state) => state.publishDraft);
  const resetDraft = usePublishStore((state) => state.resetDraft);
  const publishing = usePublishStore((state) => state.publishing);
  const error = usePublishStore((state) => state.error);
  const connector = connectors.find((item) => item.id === draft.connectorId);
  const sourceReady = Boolean(draft.uploadId || draft.videoPath || draft.videogenJobId);
  const canPublish = Boolean(connector?.ok && sourceReady && draft.title.trim());

  const submit = async () => {
    try {
      const record = await publishDraft();
      toast.success("发布请求已提交", record.title);
      resetDraft();
      onPublished();
    } catch (submitError) {
      toast.error("发布失败", submitError instanceof Error ? submitError.message : undefined);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-bg-2/40" aria-label="发布向导">
      <div className="grid grid-cols-4 border-b border-border">
        {STEPS.map((label, index) => <div key={label} className={`flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] ${draft.step === index + 1 ? "bg-accent-soft font-semibold text-accent" : "text-fg-muted"}`}><span className="grid h-4 w-4 place-items-center rounded-full border border-current text-[9px]">{index + 1}</span>{label}</div>)}
      </div>
      <div className="min-h-64 p-4">
        {draft.step === 1 && <SourceStep />}
        {draft.step === 2 && (
          <div className="space-y-3">
            <ToolcraftTextInputControl label="标题" isRequired value={draft.title} onChange={(title) => updateDraft({ title })} placeholder="输入发布标题" />
            <ToolcraftTextAreaControl label="描述" rows={5} value={draft.description} onChange={(description) => updateDraft({ description })} placeholder="介绍视频内容，支持平台描述字段" />
            <ToolcraftTextInputControl label="标签" value={draft.tags} onChange={(tags) => updateDraft({ tags })} placeholder="用逗号分隔，例如：AI, 教程" />
          </div>
        )}
        {draft.step === 3 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <ToolcraftSelectControl label="发布平台" value={draft.connectorId} onChange={(connectorId) => updateDraft({ connectorId })} options={connectors.map((item) => ({ value: item.id, label: `${item.label}${item.ok ? "" : "（未连接）"}` }))} />
            <ToolcraftSelectControl label="隐私设置" value={draft.privacy} onChange={(privacy) => updateDraft({ privacy })} options={PRIVACY_OPTIONS} />
            <ToolcraftTextInputControl label="计划发布时间（留空为立即发布）" type="datetime-local" value={draft.scheduledAt} onChange={(scheduledAt) => updateDraft({ scheduledAt })} className="sm:col-span-2" />
          </div>
        )}
        {draft.step === 4 && (
          <div className="space-y-2 rounded-lg border border-border bg-bg-1 p-4 text-[12px]">
            <Summary label="视频源" value={draft.sourceLabel || "未选择"} />
            <Summary label="发布平台" value={connector?.label || "未选择"} />
            <Summary label="标题" value={draft.title || "未填写"} />
            <Summary label="隐私" value={PRIVACY_OPTIONS.find((item) => item.value === draft.privacy)?.label ?? draft.privacy} />
            <Summary label="发布时间" value={draft.scheduledAt ? new Date(draft.scheduledAt).toLocaleString("zh-CN") : "立即发布"} />
            {!connector?.ok && <p className="pt-2 text-status-error">发布账号未连接，请先在连接器页完成连接。</p>}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-[11px] text-status-error">{error}</p>}
      </div>
      <div className="flex items-center justify-between border-t border-border px-4 py-3">
        <Button label="上一步" size="sm" variant="ghost" isDisabled={draft.step === 1 || publishing} onClick={() => updateDraft({ step: Math.max(1, draft.step - 1) as typeof draft.step })} icon={<ChevronLeft size={12} aria-hidden />} />
        {draft.step < 4 ? <Button label="下一步" size="sm" variant="primary" isDisabled={(draft.step === 1 && !sourceReady) || (draft.step === 2 && !draft.title.trim())} onClick={() => updateDraft({ step: Math.min(4, draft.step + 1) as typeof draft.step })} endContent={<ChevronRight size={12} aria-hidden />} /> : <Button label="确认发布" size="sm" variant="primary" isDisabled={!canPublish} isLoading={publishing} onClick={() => void submit()} icon={<Check size={12} aria-hidden />} />}
      </div>
    </section>
  );
}

function SourceStep(): JSX.Element {
  const draft = usePublishStore((state) => state.draft);
  const updateDraft = usePublishStore((state) => state.updateDraft);
  const jobs = useVideogenJobsStore((state) => state.jobs);
  const loadJobs = useVideogenJobsStore((state) => state.loadJobs);
  const openModal = useUIStore((state) => state.openModal);
  const [uploads, setUploads] = useState<UploadDTO[]>([]);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { void loadJobs(); void listUploads().then(setUploads).catch(() => undefined); }, [loadJobs]);

  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadSourceFile(file);
      setUploads((items) => [result, ...items]);
      updateDraft({ source: "upload", uploadId: result.id, videoPath: undefined, videogenJobId: undefined, sourceLabel: result.filename, title: draft.title || result.filename.replace(/\.[^.]+$/, "") });
    } catch (error) { toast.error("上传失败", error instanceof Error ? error.message : undefined); }
    finally { setUploading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-bg-1 p-3">
        <div><div className="text-[12px] font-medium text-fg">当前时间线</div><p className="mt-0.5 text-[10px] text-fg-muted">请先导出 MP4，再返回此处上传发布。</p></div>
        <Button label="先导出再发布" size="sm" variant="secondary" onClick={() => { toast.info("请先导出视频", "导出完成后，在发布中心上传该文件。 "); openModal("export"); }} icon={<Video size={12} aria-hidden />} />
      </div>
      <div>
        <div className="mb-2 text-[11px] font-medium text-fg-2">选择已生成的成片</div>
        <div className="grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2">
          {Object.values(jobs).filter((job) => job.state === "done" && job.videoUrl).map((job) => <button type="button" key={job.id} onClick={() => updateDraft({ source: "server", videoPath: job.videoUrl, videoUrl: job.videoUrl, videogenJobId: job.id, uploadId: undefined, sourceLabel: job.plan.options.title, title: draft.title || job.plan.options.title })} className={`rounded-md border p-2.5 text-left text-[11px] ${draft.videogenJobId === job.id ? "border-accent bg-accent-soft text-accent" : "border-border bg-bg-1 text-fg-2 hover:bg-hover"}`}>{job.plan.options.title}<span className="mt-1 block text-[10px] text-fg-muted">{Math.round(job.durationSec ?? job.plan.estimatedDurationSec)} 秒</span></button>)}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-medium text-fg-2">上传视频</span><label className="cursor-pointer text-[11px] text-accent"><input type="file" accept="video/*" className="sr-only" disabled={uploading} onChange={(event) => void upload(event.target.files?.[0])} />{uploading ? "上传中…" : "选择本地文件"}</label></div>
        <div className="flex flex-wrap gap-2">{uploads.map((item) => <Button key={item.id} label={item.filename} size="sm" variant={draft.uploadId === item.id ? "primary" : "secondary"} onClick={() => updateDraft({ source: "upload", uploadId: item.id, videoPath: undefined, videogenJobId: undefined, sourceLabel: item.filename, title: draft.title || item.filename })} icon={<Upload size={12} aria-hidden />} />)}</div>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }): JSX.Element {
  return <div className="grid grid-cols-24 gap-3"><span className="col-span-5 text-fg-muted">{label}</span><span className="col-span-19 break-words text-fg-2">{value}</span></div>;
}
