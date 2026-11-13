import { useEffect, useState, type JSX } from "react";
import { Share2 } from "@/icons/lucide-compat";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  ToolcraftButton as Button,
  ToolcraftDialog as Dialog,
  ToolcraftDialogHeader as DialogHeader,
  ToolcraftLayout as Layout,
  ToolcraftLayoutContent as LayoutContent,
  ToolcraftLayoutFooter as LayoutFooter,
} from "@openreel/ui";
import { useUIStore } from "../../../stores/ui-store";
import { usePublishStore } from "../../../stores/publish-store";
import { ConnectorCard, type ConnectorView } from "./ConnectorCard";
import { PublishWizard } from "./PublishWizard";
import { PublishRecordsList } from "./PublishRecordsList";

export function PublishCenterDialog(): JSX.Element {
  const activeModal = useUIStore((state) => state.activeModal);
  const modalData = useUIStore((state) => state.modalData);
  const closeModal = useUIStore((state) => state.closeModal);
  const connectors = usePublishStore((state) => state.connectors);
  const records = usePublishStore((state) => state.records);
  const loading = usePublishStore((state) => state.loading);
  const error = usePublishStore((state) => state.error);
  const load = usePublishStore((state) => state.load);
  const selectGeneratedVideo = usePublishStore((state) => state.selectGeneratedVideo);
  const [tab, setTab] = useState<"connectors" | "records">("connectors");
  const isOpen = activeModal === "publishCenter";

  useEffect(() => {
    if (!isOpen) return;
    setTab("connectors");
    void load();
    const videoPath = typeof modalData?.videoPath === "string" ? modalData.videoPath : null;
    if (videoPath) {
      selectGeneratedVideo({
        videoPath,
        videoUrl: typeof modalData?.videoUrl === "string" ? modalData.videoUrl : undefined,
        title: typeof modalData?.title === "string" ? modalData.title : "OpenReel 成片",
        videogenJobId: typeof modalData?.videogenJobId === "string" ? modalData.videogenJobId : undefined,
      });
    }
  }, [isOpen, modalData, load, selectGeneratedVideo]);

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && closeModal()} width={1000} purpose="form">
      <Layout
        header={<DialogHeader title="发布中心" subtitle="连接平台账号，将成片发布到你的内容渠道。" startContent={<Share2 size={18} className="text-accent" aria-hidden />} onOpenChange={(open) => !open && closeModal()} />}
        content={
          <LayoutContent className="max-h-[74vh] bg-bg p-4">
            <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
              <TabsList aria-label="发布中心视图" className="grid h-9 w-full grid-cols-2 rounded-[7px] border border-border bg-bg-1 p-0.5" layoutId="publish-center-tabs">
                <TabsTrigger value="connectors" className="h-8 text-[12px]">连接器 ({connectors.length})</TabsTrigger>
                <TabsTrigger value="records" className="h-8 text-[12px]">发布记录 ({records.length})</TabsTrigger>
              </TabsList>
            </Tabs>
            {loading && <div className="py-8 text-center text-[12px] text-fg-muted">正在加载发布服务…</div>}
            {!loading && tab === "connectors" && (
              <div className="mt-4 space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{connectors.map((connector) => <ConnectorCard key={connector.id} connector={connector as ConnectorView} />)}</div>
                {!connectors.length && <div className="rounded-lg border border-dashed border-border p-6 text-center text-[12px] text-fg-muted">服务器暂无可用发布连接器</div>}
                <PublishWizard onPublished={() => setTab("records")} />
              </div>
            )}
            {!loading && tab === "records" && <div className="mt-4"><PublishRecordsList /></div>}
            {error && <p role="alert" className="mt-3 text-[11px] text-status-error">{error}</p>}
          </LayoutContent>
        }
        footer={<LayoutFooter hasDivider><Button label="关闭" variant="secondary" onClick={closeModal} /></LayoutFooter>}
      />
    </Dialog>
  );
}

export default PublishCenterDialog;
