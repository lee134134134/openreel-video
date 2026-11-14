import { ToolcraftButton as Button, ToolcraftSwitchControl } from "@openreel/ui";
import { useChatStore } from "../../../stores/chat-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { AIConnectionPanel } from "./AIConnectionPanel";

export function AISettingsPanel() {
  const status = useChatStore((state) => state.status);
  const busy = status === "running" || status === "awaiting_confirm";
  const autoConfirm = useSettingsStore((state) => state.agentAutoConfirm);
  const setAutoConfirm = useSettingsStore((state) => state.setAgentAutoConfirm);
  const dryRun = useSettingsStore((state) => state.agentDryRun);
  const setDryRun = useSettingsStore((state) => state.setAgentDryRun);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  return (
    <div className="space-y-5 pb-1">
      <div>
        <h3 className="text-sm font-medium text-fg">模型连接</h3>
        <p className="mt-1 text-xs text-fg-muted">选择协助编辑时间线的模型。</p>
      </div>
      {busy && <p role="status" className="text-xs text-fg-muted">当前编辑完成后才能修改这些设置。</p>}
      <AIConnectionPanel disabled={busy} />
      <div className="space-y-3 border-t border-border pt-4">
        <ToolcraftSwitchControl
          label="仅预览编辑"
          description="规划更改但不应用到时间线。"
          checked={dryRun}
          onCheckedChange={setDryRun}
          disabled={busy}
        />
        <ToolcraftSwitchControl
          label="自动批准编辑"
          description="执行删除片段等操作时无需确认。"
          checked={autoConfirm}
          onCheckedChange={setAutoConfirm}
          disabled={busy}
        />
      </div>
      <div className="flex justify-end border-t border-border pt-4">
        <Button label="完成" variant="primary" size="sm" onClick={closeSettings} />
      </div>
    </div>
  );
}
