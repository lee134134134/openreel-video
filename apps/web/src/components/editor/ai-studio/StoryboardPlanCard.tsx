import { useState, type JSX } from "react";
import { Check, Clapperboard, Pencil, Play } from "@/icons/lucide-compat";
import {
  ToolcraftButton as Button,
  ToolcraftNumberInputControl,
  ToolcraftTextAreaControl,
} from "@openreel/ui";
import type { VideogenPlan, VideogenScenePlan } from "@openreel/plugin-sdk";
import { useServerChatStore, type PlanArtifact } from "../../../stores/server-chat-store";
import { useVideogenJobsStore } from "../../../stores/videogen-jobs-store";
import { toast } from "../../../stores/notification-store";

export function StoryboardPlanCard({ artifact }: { artifact: PlanArtifact }): JSX.Element {
  const [draft, setDraft] = useState<VideogenPlan>(artifact.plan);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const updatePlan = useServerChatStore((state) => state.updatePlan);
  const startJob = useVideogenJobsStore((state) => state.startJob);
  const starting = useVideogenJobsStore((state) => state.starting);
  const submitted = useVideogenJobsStore((state) => Object.values(state.planIds).includes(artifact.id));

  const updateScene = (index: number, patch: Partial<VideogenScenePlan>) => {
    setDraft((current) => ({
      ...current,
      scenes: current.scenes.map((scene) => scene.index === index ? { ...scene, ...patch } : scene),
    }));
  };
  const finishEditing = () => {
    const estimatedDurationSec = draft.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
    const next = { ...draft, estimatedDurationSec };
    setDraft(next);
    updatePlan(artifact.id, next);
    setEditing(false);
  };
  const render = async () => {
    try {
      await startJob(draft, artifact.id);
      setConfirming(false);
      toast.success("渲染任务已创建", draft.options.title);
    } catch (error) {
      toast.error("无法创建渲染任务", error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-accent/25 bg-bg-2/70" aria-label={`分镜方案：${draft.options.title}`}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Clapperboard size={14} className="text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-fg">{draft.options.title}</div>
          <div className="text-[10px] text-fg-muted">{draft.scenes.length} 个场景 · {Math.round(draft.estimatedDurationSec)} 秒 · {draft.options.aspectRatio}</div>
        </div>
        <Button
          label={editing ? "完成调整" : "调整分镜"}
          size="sm"
          variant="ghost"
          onClick={() => editing ? finishEditing() : setEditing(true)}
          icon={<Pencil size={12} aria-hidden />}
        />
      </div>
      <div className="max-h-80 space-y-2 overflow-y-auto p-2.5">
        {draft.scenes.map((scene, position) => (
          <div key={`${scene.index}-${position}`} className="rounded-md border border-border bg-bg-1 p-2">
            <div className="mb-1.5 flex items-center gap-2 text-[10px] font-medium text-fg-muted">
              <span>场景 {position + 1}</span><span>·</span><span>{scene.durationSec}s</span>
            </div>
            {editing ? (
              <div className="space-y-2">
                <ToolcraftTextAreaControl ariaLabel={`场景 ${position + 1} 旁白`} label="旁白" rows={2} value={scene.narration} onChange={(narration) => updateScene(scene.index, { narration })} inputClassName="text-[11px]" />
                <ToolcraftTextAreaControl ariaLabel={`场景 ${position + 1} 画面提示`} label="画面提示" rows={2} value={scene.visualPrompt} onChange={(visualPrompt) => updateScene(scene.index, { visualPrompt })} inputClassName="text-[11px]" />
                <ToolcraftNumberInputControl ariaLabel={`场景 ${position + 1} 时长`} label="时长（秒）" min={1} max={120} value={scene.durationSec} onChange={(durationSec) => updateScene(scene.index, { durationSec: Math.max(1, durationSec || 1) })} size="sm" />
              </div>
            ) : (
              <>
                <p className="text-[11px] leading-relaxed text-fg-2">{scene.narration}</p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-fg-muted">{scene.visualPrompt}</p>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="border-t border-border p-2.5">
        {confirming && !submitted ? (
          <div className="rounded-md border border-status-warning/30 bg-status-warning/10 p-2.5">
            <div className="text-[11px] font-medium text-fg">确认渲染摘要</div>
            <p className="mt-1 text-[10px] leading-relaxed text-fg-muted">将按 {draft.scenes.length} 个分镜生成约 {Math.round(draft.estimatedDurationSec)} 秒、{draft.options.resolution}p 视频。此操作会调用服务器渲染资源。</p>
            <div className="mt-2 flex justify-end gap-2">
              <Button label="返回调整" size="sm" variant="ghost" onClick={() => { setConfirming(false); setEditing(true); }} />
              <Button label="开始渲染" size="sm" variant="primary" isLoading={starting} onClick={() => void render()} icon={<Play size={12} aria-hidden />} />
            </div>
          </div>
        ) : (
          <Button label={submitted ? "已提交渲染" : "确认渲染"} size="sm" variant="primary" className="w-full" isDisabled={editing || submitted} onClick={() => setConfirming(true)} icon={<Check size={12} aria-hidden />} />
        )}
      </div>
    </section>
  );
}
