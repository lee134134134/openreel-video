import { useCallback, useEffect, type JSX } from "react";
import { Plus, Settings, Sparkles, X } from "@/icons/lucide-compat";
import {
  ToolcraftIconButton as IconButton,
  ToolcraftPopover,
  ToolcraftSwitchControl,
} from "@openreel/ui";
import { ChatModeSwitch } from "../chat/ChatModeSwitch";
import { useProjectStore } from "../../../stores/project-store";
import { useServerChatStore } from "../../../stores/server-chat-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { useVideogenJobsStore } from "../../../stores/videogen-jobs-store";
import { ServerUnreachableBanner } from "./ServerUnreachableBanner";
import { ServerChatThread } from "./ServerChatThread";
import { ServerChatComposer } from "./ServerChatComposer";
import { createAgentSession } from "../../../services/server-ai/agents";
import { toast } from "../../../stores/notification-store";

export function AIStudioPanel({ onClose }: { onClose?: () => void }): JSX.Element {
  const health = useServerChatStore((state) => state.health);
  const checking = useServerChatStore((state) => state.checkingHealth);
  const checkHealth = useServerChatStore((state) => state.checkHealth);
  const startNewChat = useServerChatStore((state) => state.startNewChat);
  const skills = useServerChatStore((state) => state.skills);
  const toggleSkill = useServerChatStore((state) => state.toggleSkill);
  const sending = useServerChatStore((state) => state.sending);
  const loadJobs = useVideogenJobsStore((state) => state.loadJobs);
  const resetJobs = useVideogenJobsStore((state) => state.resetJobs);
  const openSettings = useSettingsStore((state) => state.openSettings);
  const projectId = useProjectStore((state) => state.project.id);
  const syncProject = useServerChatStore((state) => state.syncProject);

  useEffect(() => {
    syncProject(projectId);
    resetJobs();
    void checkHealth().then((result) => { if (result.ok) void loadJobs(projectId); });
  }, [projectId, syncProject, resetJobs, checkHealth, loadJobs]);

  const handleNewCreation = useCallback(async () => {
    startNewChat();
    resetJobs();
    toast.success("已开始新创作", "对话、分镜与成片列表已清空，可以直接输入新需求。");
    try {
      const session = await createAgentSession("新创作");
      useServerChatStore.setState({ sessionId: session.id });
    } catch {
      // A fresh session is optional — the next turn creates one automatically.
    }
  }, [resetJobs, startNewChat]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-1">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-2">
        <ChatModeSwitch />
        <span className={`ml-1 h-2 w-2 shrink-0 rounded-full ${checking ? "bg-status-warning" : health?.ok ? "bg-status-success" : health?.ok === false ? "bg-status-error" : "bg-fg-muted"}`} title={health?.ok ? "已连接" : "无法连接服务器"} />
        <div className="ml-auto flex items-center gap-0.5">
          <ToolcraftPopover
            label="创作技能"
            placement="below"
            alignment="end"
            width={286}
            content={
              <div className="p-3">
                <div className="mb-2 text-[12px] font-semibold text-fg">创作技能</div>
                <p className="mb-2 text-[11px] leading-relaxed text-fg-muted">
                  技能会在分镜生成时自动加载，让旁白语言和画面达到专业纪录片标准。
                </p>
                <ToolcraftSwitchControl
                  label="资深导演（默认加载）"
                  description="自动完善分镜语言与纪录片级画面要求"
                  checked={skills.includes("director")}
                  onCheckedChange={() => toggleSkill("director")}
                />
              </div>
            }
          >
            <IconButton
              label="创作技能"
              icon={<Sparkles size={14} aria-hidden />}
              size="sm"
              variant={skills.length ? "primary" : "ghost"}
            />
          </ToolcraftPopover>
          <IconButton label="新创作" icon={<Plus size={14} aria-hidden />} size="sm" variant="ghost" isDisabled={sending} onClick={() => { void handleNewCreation(); }} />
          <IconButton label="服务器设置" icon={<Settings size={14} aria-hidden />} size="sm" variant="ghost" onClick={() => openSettings("server")} />
          {onClose && <IconButton label="关闭" icon={<X size={14} aria-hidden />} size="sm" variant="ghost" onClick={onClose} />}
        </div>
      </header>
      <ServerUnreachableBanner />
      <ServerChatThread />
      <ServerChatComposer />
    </div>
  );
}

export default AIStudioPanel;
