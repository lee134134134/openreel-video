import { useState, type JSX } from "react";
import { ExternalLink, Link2, RefreshCw } from "@/icons/lucide-compat";
import { ToolcraftBadge, ToolcraftButton as Button } from "@openreel/ui";
import type { PublishConnectorDTO } from "@openreel/plugin-sdk";
import { usePublishStore } from "../../../stores/publish-store";
import { useUIStore } from "../../../stores/ui-store";

export type ConnectorView = PublishConnectorDTO & { expired?: boolean; expiresAt?: string };

export function ConnectorCard({ connector }: { connector: ConnectorView }): JSX.Element {
  const [connecting, setConnecting] = useState(false);
  const connect = usePublishStore((state) => state.connect);
  const openModal = useUIStore((state) => state.openModal);
  const expired = connector.expired || (connector.expiresAt ? new Date(connector.expiresAt).getTime() < Date.now() : false);
  const status = expired ? "已过期" : connector.ok ? "已连接" : "未连接";
  const variant = expired ? "danger" : connector.ok ? "success" : "neutral";
  const oauth = connector.auth.toLowerCase().includes("oauth");

  const handleConnect = async () => {
    if (!oauth) {
      openModal("pluginCenter", { pluginId: connector.id });
      return;
    }
    setConnecting(true);
    try { await connect(connector.id); } finally { setConnecting(false); }
  };

  return (
    <article className="rounded-lg border border-border bg-bg-1 p-3">
      <div className="flex items-start gap-2.5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-bg-3 text-[13px] font-bold uppercase text-fg-2">{connector.platform.slice(0, 1)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[12px] font-semibold text-fg">{connector.label}</h3>
            <ToolcraftBadge label={status} variant={variant} />
          </div>
          <p className="mt-1 truncate text-[10px] text-fg-muted">{connector.platform} · {connector.auth}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button
          label={connector.ok || expired ? "重新连接" : "连接账号"}
          size="sm"
          variant={connector.ok && !expired ? "secondary" : "primary"}
          isLoading={connecting}
          onClick={() => void handleConnect()}
          icon={connector.ok ? <RefreshCw size={12} aria-hidden /> : <Link2 size={12} aria-hidden />}
        />
        {connector.docs && <Button label="文档" size="sm" variant="ghost" href={connector.docs} target="_blank" rel="noreferrer" icon={<ExternalLink size={12} aria-hidden />} />}
      </div>
    </article>
  );
}
