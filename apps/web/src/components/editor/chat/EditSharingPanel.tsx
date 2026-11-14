import { useRef, useState } from "react";
import { createPortableEdit, parsePortableEdit, materializePortableEdit, parseEditPreset, type EditPreset } from "@openreel/core/editing/portable-project";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { useChatStore } from "../../../stores/chat-store";
import { EditingSession } from "../../../services/agent/editing-session";
import { executeEditingTool } from "../../../services/agent/editing-tools";
import { runExclusive } from "../../../services/agent/host-singleton";

const control = "rounded-md border border-border bg-bg-2 px-2 py-1.5 text-[11px] text-fg-2 hover:bg-hover focus-visible:outline focus-visible:outline-accent disabled:opacity-40";
function downloadJSON(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function EditSharingPanel({ disabled }: { disabled: boolean }) {
  const project = useProjectStore((s) => s.project);
  const selected = useUIStore((s) => s.selectedItems[0]?.id);
  const [json, setJSON] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [target, setTarget] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const clips = project.timeline.tracks.flatMap((t) => t.clips);
  const targetId = target || selected || clips[0]?.id || "";
  const busy = disabled || working;
  const perform = async (fn: () => Promise<void> | void) => {
    setWorking(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "无法分享编辑"); } finally { setWorking(false); }
  };
  const importEdit = () => perform(async () => {
    const doc = parsePortableEdit(json);
    await runExclusive(async () => {
      const session = new EditingSession(); const txn = session.beginTransaction();
      const restored = materializePortableEdit(doc, session.getProject());
      session.replaceDraft(restored.project);
      await session.commitTransaction(txn, "导入便携编辑");
      useChatStore.getState().reset();
      setMessage(restored.missing.length ? `Edit imported. Relink ${restored.missing.length} missing media file(s) below.` : "Edit imported as one undo step. All media references are linked.");
    });
  });
  const exportEdit = () => perform(() => {
    const text = JSON.stringify(createPortableEdit(useProjectStore.getState().getFullProject()), null, 2);
    setJSON(text); downloadJSON(text, "openreel-edit.json"); setMessage("Edit JSON exported. Share the original media files separately.");
  });
  const exportPreset = () => perform(() => {
    const clip = clips.find((c) => c.id === targetId); if (!clip) throw new Error("请先选择一个媒体片段");
    const transition = project.timeline.tracks.flatMap((t) => t.transitions).find((t) => t.clipAId === clip.id);
    const preset = { format: "openreel-preset", version: 1, name: "Shared look & transition", effects: clip.effects, ...(transition ? { transition: { type: transition.type, duration: transition.duration, params: transition.params } } : {}) };
    const text = JSON.stringify(preset, null, 2); parseEditPreset(text); setJSON(text); downloadJSON(text, "openreel-preset.json"); setMessage("Reusable preset exported. Applying it generates fresh effect and transition IDs.");
  });
  const applyPreset = () => perform(async () => {
    const preset: EditPreset = parseEditPreset(json);
    await runExclusive(async () => {
      const session = new EditingSession(); const txn = session.beginTransaction();
      const track = session.getProject().timeline.tracks.find((t) => t.clips.some((c) => c.id === targetId));
      const ordered = [...(track?.clips ?? [])].sort((a, b) => a.startTime - b.startTime);
      const nextClipId = ordered[ordered.findIndex((c) => c.id === targetId) + 1]?.id;
      const result = await executeEditingTool("apply_edit_preset", { clipId: targetId, preset, ...(nextClipId ? { nextClipId } : {}) }, session);
      if (!result.ok) throw new Error(result.error?.message ?? result.summary);
      await session.commitTransaction(txn, "应用共享预设");
      setMessage(result.summary);
    });
  });
  return (
    <details className="border-b border-border px-3 py-2 text-xs">
      <summary className="cursor-pointer text-fg-2">编辑 JSON 与可复用预设</summary>
      <div className="mt-3 space-y-2">
        <p className="text-[11px] leading-relaxed text-fg-muted">便携编辑 v2 共享时间线和本地媒体引用。导入会以一步撤销操作替换当前编辑。文件仅包含数据；脚本、URL 和代理指令都会被拒绝。</p>
        <div className="flex gap-2">
          <button className={control} disabled={busy} onClick={exportEdit}>导出编辑 JSON</button>
          <button className={control} disabled={busy} onClick={() => fileInput.current?.click()}>读取 JSON 文件</button>
          <input ref={fileInput} aria-label="Read edit or preset file" type="file" accept=".json,application/json" className="hidden" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void perform(async () => { if (file.size > 5_000_000) throw new Error("JSON 超过 5 MB"); setJSON(await file.text()); }); e.target.value = ""; }} />
        </div>
        <label className="block text-fg-2">编辑或预设 JSON<textarea aria-label="Edit or preset JSON" className="mt-1 h-28 w-full resize-y rounded-md border border-border bg-bg-2 p-2 font-mono text-[10px] select-text focus:outline-none focus:ring-1 focus:ring-accent" disabled={busy} value={json} onChange={(e) => setJSON(e.target.value)} spellCheck={false} placeholder="在此粘贴经过校验的编辑或预设 JSON" /></label>
        <button className={control} disabled={busy || !json.trim()} onClick={() => void importEdit()}>导入编辑 JSON</button>
        <label className="block text-fg-2">预设目标<select aria-label="Preset target clip" className={`mt-1 w-full ${control}`} value={targetId} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
          <option value="">选择片段</option>{clips.map((clip) => <option key={clip.id} value={clip.id}>{project.mediaLibrary.items.find((m) => m.id === clip.mediaId)?.name ?? "片段"} · {clip.startTime.toFixed(1)}s · {clip.id.slice(0, 8)}</option>)}
        </select></label>
        <div className="flex gap-2"><button className={control} disabled={busy || !targetId} onClick={exportPreset}>导出预设</button><button className={control} disabled={busy || !targetId || !json.trim()} onClick={() => void applyPreset()}>应用预设 JSON</button></div>
        <div className="flex gap-2"><button className={control} disabled={busy || !useProjectStore.getState().canUndo()} onClick={() => void perform(async () => { await useProjectStore.getState().undo(); setMessage("编辑已撤销"); })}>撤销编辑</button><button className={control} disabled={busy || !useProjectStore.getState().canRedo()} onClick={() => void perform(async () => { await useProjectStore.getState().redo(); setMessage("编辑已恢复"); })}>重做编辑</button></div>
        {project.mediaLibrary.items.filter((m) => m.isPlaceholder).map((media) => <label key={media.id} className="block rounded border border-border p-2 text-[11px]">Relink {media.name}<input aria-label={`Relink ${media.name}`} className="mt-1 w-full" type="file" accept={`${media.type}/*`} disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void perform(async () => { if (!file.type.startsWith(media.type + "/")) throw new Error("Choose the same media type"); await runExclusive(async () => { const session = new EditingSession(); const txn = session.beginTransaction(); await session.relinkMedia(media.id, file); await session.commitTransaction(txn, "Relink shared media"); }); setMessage(`${media.name} relinked. Element IDs were preserved.`); }); }} /></label>)}
        {working && <p role="status" className="text-fg-muted">正在校验并应用…</p>}
        {message && <p role="status" className="text-[11px] text-status-success">{message}</p>}
        {error && <p role="alert" className="break-words text-[11px] text-status-error">{error}</p>}
      </div>
    </details>
  );
}
