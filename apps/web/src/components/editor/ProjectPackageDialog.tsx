import { useEffect, useRef, useState } from "react";
import { Download, Upload, FolderOpen } from "@/icons/lucide-compat";
import { ToolcraftButton as Button, ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import type { Project } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { toast } from "../../stores/notification-store";
import { autoSaveManager } from "../../services/auto-save";
import { loadMediaBlob, saveMediaBlob, deleteMediaBlob } from "../../services/media-storage";
import { createProjectPackage, readProjectPackage, copyPackagedProject, projectMediaSummary } from "../../services/project-package";
import { exportFilename } from "../../services/export-runner";
import { restoreMediaItem } from "../../utils/media-recovery";
import { projectManager } from "../../services/project-manager";

export function formatPackageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function downloadPackage(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(name, "oreelpack");
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to start consuming a large file before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ProjectPackageDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((state) => state.project);
  const exporting = useUIStore((state) => state.exportState.isExporting);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Project | null>(null);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number } | null>(null);
  const summary = projectMediaSummary(project);
  const close = () => { if (committing.current) return; controller.current?.abort(); onClose(); };
  useEffect(() => {
    let active = true;
    navigator.storage?.estimate?.().then((estimate) => { if (active) setStorage(estimate); }).catch(() => {});
    return () => { active = false; controller.current?.abort(); };
  }, []);
  const progress = ({ completed, total, name }: { completed: number; total: number; name: string }) => setStatus(`${completed}/${total} media files · ${name}`);

  const save = async (chooseLocation: boolean) => {
    if (controller.current || exporting) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setError(null); setStatus("正在准备项目备份…");
    const snapshot = useProjectStore.getState().getFullProject();
    let writable: FileSystemWritableFileStream | undefined;
    try {
      if (chooseLocation) {
        // Request the picker before any async work to preserve user activation.
        const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
        if (!picker) throw new Error("此浏览器请使用“下载备份”。");
        const handle = await picker.call(window, { suggestedName: exportFilename(snapshot.name, "oreelpack"), types: [{ description: "OpenReel 项目（含媒体）", accept: { "application/octet-stream": [".oreelpack"] } }] });
        abort.signal.throwIfAborted();
        writable = await handle.createWritable();
      }
      const blob = await createProjectPackage(snapshot, { signal: abort.signal, onProgress: progress, resolveMedia: (item) => loadMediaBlob(item.id) });
      abort.signal.throwIfAborted();
      if (writable) {
        const reader = blob.stream().getReader();
        try {
          for (;;) {
            abort.signal.throwIfAborted();
            const chunk = await reader.read();
            if (chunk.done) break;
            await writable.write(chunk.value);
          }
          abort.signal.throwIfAborted();
          await writable.close();
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } else downloadPackage(blob, snapshot.name);
      toast.success("项目备份已就绪", "包含你的剪辑与原始媒体。在其他浏览器打开即可继续编辑。");
      setStatus("备份已生成，请妥善保管该文件。");
    } catch (cause) {
      await writable?.abort().catch(() => {});
      if (cause instanceof Error && cause.name === "AbortError") setStatus("备份已取消。");
      else setError(cause instanceof Error ? cause.message : "无法创建项目备份。");
    } finally { controller.current = null; setBusy(false); }
  };

  const inspectFile = async (file: File) => {
    if (controller.current || exporting) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setIncoming(null); setError(null); setStatus("正在检查项目与媒体…");
    try { setIncoming(await readProjectPackage(file, { signal: abort.signal, onProgress: progress })); setStatus(""); }
    catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "无法打开该备份。"); }
    finally { controller.current = null; setBusy(false); }
  };

  const open = async () => {
    if (!incoming || controller.current || exporting) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(null); setStatus("正在保存当前工作…");
    const startingId = useProjectStore.getState().project.id;
    const copy = copyPackagedProject(incoming);
    const written: string[] = [];
    let committed = false;
    try {
      await autoSaveManager.forceSave(useProjectStore.getState().getFullProject());
      const estimate = await navigator.storage?.estimate?.();
      const bytes = projectMediaSummary(copy).bytes;
      if (estimate?.quota && bytes > estimate.quota - (estimate.usage ?? 0)) throw new Error("浏览器存储空间不足以容纳此项目。请清理空间或使用其他浏览器配置文件后重试。");
      for (const item of copy.mediaLibrary.items) {
        abort.signal.throwIfAborted();
        setStatus(`Restoring ${item.name}…`);
        await saveMediaBlob(copy.id, item.id, item.blob!, item.metadata);
        written.push(item.id);
      }
      abort.signal.throwIfAborted();
      if (useProjectStore.getState().project.id !== startingId) throw new Error("当前打开的项目已变化。请重新打开该备份以继续。");
      committing.current = true;
      setStatus("正在完成项目恢复…");
      await autoSaveManager.forceSave(copy);
      useTimelineStore.getState().stop();
      useTimelineStore.getState().seekToStart();
      useTimelineStore.getState().clearLoopRange();
      useUIStore.getState().clearSelection();
      projectManager.releaseCurrentFileHandle();
      useProjectStore.getState().loadProject(copy);
      useTimelineStore.getState().zoomToFit(copy.timeline.duration || 5);
      committed = true;
      toast.success("项目已打开", `已恢复 ${copy.mediaLibrary.items.length} 个原始媒体文件。之前的项目已保存在“最近项目”中。`);
      // Thumbnails are optional; restoring footage never waits for every video
      // decode. Refresh them sequentially in the background after opening.
      void (async () => {
        for (const item of copy.mediaLibrary.items) {
          if (useProjectStore.getState().project.id !== copy.id) break;
          const restored = await restoreMediaItem(item, item.blob!);
          if (useProjectStore.getState().project.id !== copy.id) {
            if (restored.thumbnailUrl?.startsWith("blob:")) URL.revokeObjectURL(restored.thumbnailUrl);
            break;
          }
          useProjectStore.setState((state) => ({ project: { ...state.project, mediaLibrary: { ...state.project.mediaLibrary, items: state.project.mediaLibrary.items.map((current) => current.id === item.id ? { ...current, thumbnailUrl: restored.thumbnailUrl } : current) } } }));
        }
      })().catch(() => {});
      onClose();
    } catch (cause) {
      if (!committed) {
        await Promise.allSettled(written.map((id) => deleteMediaBlob(id)));
        await autoSaveManager.clearProjectSaves(copy.id).catch(() => {});
      }
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "无法恢复项目。");
    } finally { committing.current = false; controller.current = null; setBusy(false); }
  };

  return <Dialog isOpen onOpenChange={(value) => { if (!value) close(); }} width={560} purpose="form">
    <DialogHeader title="项目备份" subtitle="把你的剪辑与原始媒体随身带走。" onOpenChange={(value) => { if (!value) close(); }} />
    <div className="space-y-5 p-5">
      <section className="space-y-3 rounded-lg border border-border bg-bg-1 p-4" aria-label="备份当前项目">
        <h3 className="text-sm font-semibold text-fg">{project.name}</h3>
        <p className="text-xs text-fg-2">{summary.count} media file{summary.count === 1 ? "" : "s"} · approximately {formatPackageBytes(summary.bytes)}</p>
        <p className="text-xs leading-relaxed text-fg-3">备份包含原始视频、图片、音频、字幕和时间线编辑。预览代理可以重新生成。上传的自定义字体需要在目标浏览器中安装。</p>
        <div className="flex flex-wrap gap-2">
          <Button label="下载备份" icon={<Download size={15} aria-hidden />} onClick={() => void save(false)} isDisabled={busy || exporting} variant="primary" />
          {"showSaveFilePicker" in window && <Button label="选择文件位置" icon={<FolderOpen size={15} aria-hidden />} onClick={() => void save(true)} isDisabled={busy || exporting} variant="secondary" />}
        </div>
        <p className="text-xs text-fg-3">对于大型项目，选择文件位置后会直接写入磁盘。</p>
      </section>
      <section className="space-y-3" aria-label="打开项目备份">
        <input ref={input} type="file" accept=".oreelpack" className="hidden" aria-label="项目备份文件" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void inspectFile(file); }} />
        <Button label="选择要打开的备份" icon={<Upload size={15} aria-hidden />} variant="secondary" onClick={() => input.current?.click()} isDisabled={busy || exporting} />
        {incoming && <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-4">
          <h3 className="text-sm font-semibold text-fg">{incoming.name}</h3>
          <p className="text-xs text-fg-2">{incoming.settings.width}×{incoming.settings.height} · {incoming.settings.frameRate} fps · {projectMediaSummary(incoming).count} media files · {formatPackageBytes(projectMediaSummary(incoming).bytes)}</p>
          <p className="text-xs text-fg-3">会作为独立副本打开。当前项目会先自动保存。</p>
          <Button label="打开该项目" variant="primary" onClick={() => void open()} isDisabled={busy || exporting} />
        </div>}
      </section>
      {storage?.quota && <p className="text-xs text-fg-3">Browser storage: {formatPackageBytes(storage.usage ?? 0)} of {formatPackageBytes(storage.quota)} used. Keep a backup outside your browser.</p>}
      {status && <p role="status" className="text-xs text-fg-2">{status}</p>}
      {error && <p role="alert" className="text-xs text-status-error">{error}</p>}
      <div className="flex justify-end"><Button label={busy ? "取消操作" : "关闭"} isDisabled={committing.current} variant="secondary" onClick={close} /></div>
    </div>
  </Dialog>;
}
