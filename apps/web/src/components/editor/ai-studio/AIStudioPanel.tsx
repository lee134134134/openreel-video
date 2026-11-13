import { useEffect, type JSX } from "react";
import { Plus, Settings, X } from "@/icons/lucide-compat";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ChatModeSwitch } from "../chat/ChatModeSwitch";
import { useServerChatStore } from "../../../stores/server-chat-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { useVideogenJobsStore } from "../../../stores/videogen-jobs-store";
import { ServerUnreachableBanner } from "./ServerUnreachableBanner";
import { ServerChatThread } from "./ServerChatThread";
import { ServerChatComposer } from "./ServerChatComposer";

export function AIStudioPanel({ onClose }: { onClose?: () => void }): JSX.Element {
  const health = useServerChatStore((state) => state.health);
  const checking = useServerChatStore((state) => state.checkingHealth);
  const checkHealth = useServerChatStore((state) => state.checkHealth);
  const clearChat = useServerChatStore((state) => state.clearChat);
  const sending = useServerChatStore((state) => state.sending);
  const loadJobs = useVideogenJobsStore((state) => state.loadJobs);
  const openSettings = useSettingsStore((state) => state.openSettings);

  useEffect(() => {
    void checkHealth().then((result) => { if (result.ok) void loadJobs(); });
  }, [checkHealth, loadJobs]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-1">
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-2.5 py-2">
        <ChatModeSwitch />
        <span className={`ml-1 h-2 w-2 shrink-0 rounded-full ${checking ? "bg-status-warning" : health?.ok ? "bg-status-success" : health?.ok === false ? "bg-status-error" : "bg-fg-muted"}`} title={health?.ok ? "已连接" : "无法连接服务器"} />
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="新创作" icon={<Plus size={14} aria-hidden />} size="sm" variant="ghost" isDisabled={sending} onClick={clearChat} />
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
