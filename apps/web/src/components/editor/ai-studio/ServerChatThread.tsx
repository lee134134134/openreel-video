import { useEffect, useMemo, useRef, type JSX } from "react";
import { AlertCircle, Bot, RefreshCw, Settings, Sparkles, X } from "@/icons/lucide-compat";
import { ToolcraftButton as Button, ToolcraftIconButton as IconButton } from "@openreel/ui";
import { useServerChatStore, type PlanArtifact, type ServerChatMessage } from "../../../stores/server-chat-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { useVideogenJobsStore } from "../../../stores/videogen-jobs-store";
import { StoryboardPlanCard } from "./StoryboardPlanCard";
import { RenderJobChip } from "./RenderJobChip";
import { RenderedVideoCard } from "./RenderedVideoCard";
import type { VideogenJobDTO } from "@openreel/plugin-sdk";

const SUGGESTIONS = [
  "为一款轻便相机生成 4 个分镜的产品短视频",
  "做一个 9:16 的咖啡店开业宣传视频",
  "生成一段节奏明快的 AI 工具教程分镜",
];

type ThreadItem =
  | { kind: "message"; at: number; order: number; message: ServerChatMessage }
  | { kind: "plan"; at: number; order: number; artifact: PlanArtifact }
  | { kind: "job"; at: number; order: number; job: VideogenJobDTO };

/** Single chronological stream: chat bubbles, storyboard plans, render
 * jobs and finished videos interleave in the order they happened, so a
 * generated video sits right where that turn of the conversation was. */
function useThreadItems(): ThreadItem[] {
  const messages = useServerChatStore((state) => state.messages);
  const plans = useServerChatStore((state) => state.plans);
  const jobs = useVideogenJobsStore((state) => state.jobs);
  return useMemo(() => {
    const items: ThreadItem[] = [];
    messages.forEach((message, index) => {
      items.push({ kind: "message", at: message.createdAt, order: index, message });
    });
    plans.forEach((artifact, index) => {
      items.push({ kind: "plan", at: artifact.createdAt, order: index, artifact });
    });
    Object.values(jobs).forEach((job, index) => {
      items.push({ kind: "job", at: Date.parse(job.createdAt) || 0, order: index, job });
    });
    return items.sort((a, b) => a.at - b.at || a.order - b.order);
  }, [messages, plans, jobs]);
}

export function ServerChatThread(): JSX.Element {
  const items = useThreadItems();
  const thinking = useServerChatStore((state) => state.thinking);
  const error = useServerChatStore((state) => state.error);
  const clearError = useServerChatStore((state) => state.clearError);
  const retryLast = useServerChatStore((state) => state.retryLast);
  const sending = useServerChatStore((state) => state.sending);
  const send = useServerChatStore((state) => state.send);
  const openSettings = useSettingsStore((state) => state.openSettings);
  const scrollRef = useRef<HTMLDivElement>(null);
  const empty = items.length === 0;

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [items, thinking, error]);

  return (
    <div ref={scrollRef} role="log" aria-live="polite" aria-label="AI 工作室消息与创作结果" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {empty && (
        <div className="flex min-h-full flex-col items-center justify-center px-3 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent"><Sparkles size={20} aria-hidden /></div>
          <h2 className="mt-3 text-[13px] font-semibold text-fg">从一句话开始创作</h2>
          <p className="mt-1 max-w-64 text-[11px] leading-relaxed text-fg-muted">服务器会生成分镜方案，经你确认后再渲染成片。</p>
          <div className="mt-4 w-full space-y-1.5">
            {SUGGESTIONS.map((suggestion) => <Button key={suggestion} label={suggestion} variant="ghost" size="sm" onClick={() => void send(suggestion)} className="h-auto w-full whitespace-normal border border-border px-2.5 py-2 text-left text-[11px] leading-relaxed" />)}
          </div>
        </div>
      )}
      {items.map((item) => {
        if (item.kind === "message") {
          const message = item.message;
          if (!message.content) return null;
          return (
            <div key={message.id} className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              {message.role === "assistant" && <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><Bot size={13} aria-hidden /></span>}
              <div className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-2.5 py-2 text-[11px] leading-relaxed ${message.role === "user" ? "bg-accent text-accent-fg" : "border border-border bg-bg-2 text-fg-2"}`}>{message.content}</div>
            </div>
          );
        }
        if (item.kind === "plan") {
          return <StoryboardPlanCard key={item.artifact.id} artifact={item.artifact} />;
        }
        const job = item.job;
        return job.state === "done" && job.videoUrl
          ? <RenderedVideoCard key={job.id} job={job} />
          : <RenderJobChip key={job.id} job={job} />;
      })}
      {thinking && <div className="flex items-center gap-2 text-[11px] text-fg-muted"><span className="h-3 w-3 animate-spin rounded-full border border-accent border-r-transparent" />{thinking}</div>}
      {error && (
        <div role="alert" className="rounded-lg border border-status-error/30 bg-status-error/10 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-status-error" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-status-error">{error.status === 401 ? "服务器未配置模型密钥(401)" : "AI 工作室暂时不可用"}</div>
              <p className="mt-1 break-words text-[10px] leading-relaxed text-fg-muted">{error.message}</p>
            </div>
            <IconButton label="关闭错误" icon={<X size={12} aria-hidden />} size="sm" variant="ghost" onClick={clearError} />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button label="重试" size="sm" variant="secondary" isDisabled={sending} onClick={() => void retryLast()} icon={<RefreshCw size={12} aria-hidden />} />
            {error.status === 401 && <Button label="打开服务器设置" size="sm" variant="primary" onClick={() => openSettings("server")} icon={<Settings size={12} aria-hidden />} />}
          </div>
        </div>
      )}
    </div>
  );
}
