import type { JSX } from "react";
import { AlertTriangle, RefreshCw, Settings } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { useServerChatStore } from "../../../stores/server-chat-store";
import { useSettingsStore } from "../../../stores/settings-store";

export function ServerUnreachableBanner(): JSX.Element | null {
  const health = useServerChatStore((state) => state.health);
  const checking = useServerChatStore((state) => state.checkingHealth);
  const checkHealth = useServerChatStore((state) => state.checkHealth);
  const retryLast = useServerChatStore((state) => state.retryLast);
  const openSettings = useSettingsStore((state) => state.openSettings);
  if (health?.ok !== false) return null;

  const retry = async () => {
    const next = await checkHealth();
    if (next.ok) await retryLast();
  };

  return (
    <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-status-error/20 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
      <AlertTriangle size={14} className="shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">无法连接服务器</div>
        <div className="truncate text-fg-muted" title={health.message}>{health.message || "请检查服务器地址后重试"}</div>
      </div>
      <Button label="重试" size="sm" variant="secondary" isLoading={checking} onClick={() => void retry()} icon={<RefreshCw size={12} aria-hidden />} />
      <Button label="设置" size="sm" variant="ghost" onClick={() => openSettings("server")} icon={<Settings size={12} aria-hidden />} />
    </div>
  );
}
