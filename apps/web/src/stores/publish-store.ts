import { create } from "zustand";
import type { PublishConnectorDTO, PublishRecord } from "@openreel/plugin-sdk";
import {
  getConnectors,
  getRecordStatus,
  listRecords,
  publish,
  saveCredentials,
  startOAuth,
  type PublishParams,
} from "../services/server-ai/agents";

export interface PublishDraft {
  step: 1 | 2 | 3 | 4;
  source: "server" | "upload" | "timeline";
  connectorId: string;
  videoPath?: string;
  videoUrl?: string;
  uploadId?: string;
  videogenJobId?: string;
  sourceLabel: string;
  title: string;
  description: string;
  tags: string;
  privacy: NonNullable<PublishParams["privacy"]>;
  scheduledAt: string;
}

interface PublishState {
  connectors: PublishConnectorDTO[];
  records: PublishRecord[];
  draft: PublishDraft;
  loading: boolean;
  publishing: boolean;
  error: string | null;
  load: () => Promise<void>;
  updateDraft: (patch: Partial<PublishDraft>) => void;
  resetDraft: () => void;
  selectGeneratedVideo: (input: { videoPath: string; videoUrl?: string; title: string; videogenJobId?: string }) => void;
  connect: (connectorId: string, values?: Record<string, unknown>) => Promise<void>;
  publishDraft: () => Promise<PublishRecord>;
  refreshRecord: (recordId: string) => Promise<void>;
}

export const emptyPublishDraft = (): PublishDraft => ({
  step: 1,
  source: "server",
  connectorId: "",
  sourceLabel: "",
  title: "",
  description: "",
  tags: "",
  privacy: "public",
  scheduledAt: "",
});

export const usePublishStore = create<PublishState>()((set, get) => ({
  connectors: [],
  records: [],
  draft: emptyPublishDraft(),
  loading: false,
  publishing: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [connectors, records] = await Promise.all([getConnectors(), listRecords()]);
      set((state) => ({
        connectors,
        records,
        loading: false,
        draft: {
          ...state.draft,
          connectorId: state.draft.connectorId || connectors.find((item) => item.ok)?.id || connectors[0]?.id || "",
        },
      }));
    } catch (error) {
      set({ loading: false, error: message(error) });
    }
  },
  updateDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
  resetDraft: () => set((state) => ({
    draft: { ...emptyPublishDraft(), connectorId: state.connectors.find((item) => item.ok)?.id || state.connectors[0]?.id || "" },
  })),
  selectGeneratedVideo: ({ videoPath, videoUrl, title, videogenJobId }) => set((state) => ({
    draft: {
      ...emptyPublishDraft(),
      connectorId: state.connectors.find((item) => item.ok)?.id || state.draft.connectorId,
      source: "server",
      videoPath,
      videoUrl,
      videogenJobId,
      sourceLabel: title,
      title,
    },
  })),
  connect: async (connectorId, values) => {
    try {
      if (values) await saveCredentials(connectorId, values);
      else await startOAuth(connectorId);
      await get().load();
    } catch (error) {
      set({ error: message(error) });
      throw error;
    }
  },
  publishDraft: async () => {
    const draft = get().draft;
    const connector = get().connectors.find((item) => item.id === draft.connectorId);
    if (!connector?.ok) throw new Error("请先连接发布账号");
    if (!draft.title.trim() || (!draft.uploadId && !draft.videoPath && !draft.videogenJobId)) {
      throw new Error("请补齐视频源和必填元数据");
    }
    set({ publishing: true, error: null });
    try {
      const record = await publish({
        connectorId: draft.connectorId,
        title: draft.title.trim(),
        description: draft.description.trim(),
        tags: draft.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
        privacy: draft.privacy,
        videoPath: draft.videoPath,
        uploadId: draft.uploadId,
        videogenJobId: draft.videogenJobId,
        startTimeISO: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : undefined,
      });
      set((state) => ({ publishing: false, records: [record, ...state.records] }));
      return record;
    } catch (error) {
      set({ publishing: false, error: message(error) });
      throw error;
    }
  },
  refreshRecord: async (recordId) => {
    try {
      const status = await getRecordStatus(recordId);
      set((state) => ({
        records: state.records.map((record) => record.id === recordId ? {
          ...record,
          state: status.state,
          platformPostId: status.platformPostId || record.platformPostId,
          error: status.message,
        } : record),
      }));
    } catch (error) {
      set({ error: message(error) });
    }
  },
}));

function message(error: unknown): string {
  return error instanceof Error ? error.message : "发布服务请求失败";
}
