import { useState, type JSX } from "react";
import { ExternalLink, RefreshCw } from "@/icons/lucide-compat";
import { ToolcraftBadge, ToolcraftButton as Button, ToolcraftIconButton as IconButton } from "@openreel/ui";
import type { PublishRecord } from "@openreel/plugin-sdk";
import { usePublishStore } from "../../../stores/publish-store";

const STATE_LABELS: Record<string, string> = {
  published: "已发布",
  processing: "处理中",
  queued_remote: "平台排队中",
  queued: "排队中",
  draft: "草稿",
  failed: "发布失败",
  deleted: "已删除",
};

export function PublishRecordsList(): JSX.Element {
  const records = usePublishStore((state) => state.records);
  const refreshRecord = usePublishStore((state) => state.refreshRecord);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  if (records.length === 0) {
    return <div className="grid min-h-40 place-items-center rounded-lg border border-dashed border-border text-center text-[12px] text-fg-muted"><div><div className="font-medium text-fg-2">还没有发布记录</div><p className="mt-1 text-[11px]">完成一次发布后，可在这里跟踪平台状态。</p></div></div>;
  }

  const refresh = async (id: string) => {
    setRefreshing(id);
    await refreshRecord(id);
    setRefreshing(null);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {records.map((record) => <RecordRow key={record.id} record={record} refreshing={refreshing === record.id} onRefresh={() => void refresh(record.id)} />)}
    </div>
  );
}

function RecordRow({ record, refreshing, onRefresh }: { record: PublishRecord; refreshing: boolean; onRefresh: () => void }): JSX.Element {
  const failed = record.state === "failed";
  const success = record.state === "published";
  return (
    <div className="flex items-center gap-3 border-b border-border bg-bg-1 px-3 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[12px] font-medium text-fg">{record.title}</span>
          <ToolcraftBadge label={STATE_LABELS[record.state] ?? record.state} variant={failed ? "danger" : success ? "success" : "neutral"} />
        </div>
        <div className="mt-1 text-[10px] text-fg-muted">{record.platform} · {formatDate(record.createdAt)}{record.platformPostId ? ` · ${record.platformPostId}` : ""}</div>
        {record.error && <div className="mt-1 text-[10px] text-status-error">{record.error}</div>}
      </div>
      <IconButton label="刷新平台状态" icon={<RefreshCw size={13} className={refreshing ? "animate-spin" : ""} aria-hidden />} size="sm" variant="ghost" isDisabled={refreshing} onClick={onRefresh} />
      {record.url && <Button label="查看" size="sm" variant="ghost" href={record.url} target="_blank" rel="noreferrer" icon={<ExternalLink size={12} aria-hidden />} />}
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
