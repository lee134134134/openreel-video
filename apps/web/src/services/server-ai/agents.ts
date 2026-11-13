import type {
  GenerateVideogenPlanArgs,
  PluginManifest,
  PublishConnectorDTO,
  PublishRecord,
  PublishStatus,
  VideogenAspectRatio,
  VideogenJobDTO,
  VideogenPlan,
} from "@openreel/plugin-sdk";
import { apiRequest, getServerUrl } from "./api";

export interface ServerPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  credentials?: Record<string, unknown>;
}

export interface UploadDTO {
  id: string;
  filename: string;
  url: string;
}

export interface PublishParams {
  connectorId: string;
  title: string;
  description: string;
  tags?: string[];
  privacy?: "public" | "private" | "unlisted" | "draft";
  videoPath?: string;
  uploadId?: string;
  videogenJobId?: string;
  startTimeISO?: string;
}

export type VideogenJobEvent = Partial<VideogenJobDTO> & {
  jobId?: string;
  job?: VideogenJobDTO;
};

export function postVideogenPlan(input: {
  brief: string;
  sceneCount?: number;
  aspectRatio?: VideogenAspectRatio;
  styleHint?: string;
  language?: string;
}): Promise<VideogenPlan> {
  const body: GenerateVideogenPlanArgs = { sceneCount: 4, ...input };
  return apiRequest<VideogenPlan>("/videogen/plans", jsonPost(body));
}

export function createVideogenJob(
  plan: VideogenPlan,
  adapterId?: string,
): Promise<VideogenJobDTO> {
  return apiRequest<VideogenJobDTO>("/videogen/jobs", jsonPost({ plan, adapterId }));
}

export function runVideogenJob(jobId: string): Promise<VideogenJobDTO> {
  return apiRequest<VideogenJobDTO>(`/videogen/jobs/${id(jobId)}/run`, jsonPost({}));
}

export function getVideogenJob(jobId: string): Promise<VideogenJobDTO> {
  return apiRequest<VideogenJobDTO>(`/videogen/jobs/${id(jobId)}`);
}

export function listVideogenJobs(): Promise<VideogenJobDTO[]> {
  return apiRequest<VideogenJobDTO[]>("/videogen/jobs");
}

export function subscribeVideogenEvents(
  jobId: string,
  onEvent: (event: VideogenJobEvent) => void,
  onError?: (error: Error) => void,
): () => void {
  let source: EventSource | null = null;
  let stopped = false;
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (stopped) return;
    source = new EventSource(`${getServerUrl()}/api/videogen/jobs/${id(jobId)}/events`);
    source.onopen = () => { attempts = 0; };
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as VideogenJobEvent;
        onEvent(event);
        const state = event.job?.state ?? event.state;
        if (state === "done" || state === "failed" || state === "cancelled") {
          stopped = true;
          source?.close();
        }
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error("无法解析渲染事件"));
      }
    };
    source.onerror = () => {
      source?.close();
      if (stopped) return;
      if (attempts >= 3) {
        onError?.(new Error("渲染进度连接已断开"));
        return;
      }
      const delay = 500 * 2 ** attempts;
      attempts += 1;
      retryTimer = setTimeout(connect, delay);
    };
  };
  connect();
  return () => {
    stopped = true;
    source?.close();
    if (retryTimer) clearTimeout(retryTimer);
  };
}

export function getConnectors(): Promise<PublishConnectorDTO[]> {
  return apiRequest<PublishConnectorDTO[]>("/publish/connectors");
}

export function saveCredentials(
  connectorId: string,
  values: Record<string, unknown>,
): Promise<void> {
  return apiRequest<void>(`/publish/credentials/${id(connectorId)}`, {
    method: "PUT",
    body: JSON.stringify(values),
    headers: { "Content-Type": "application/json" },
  });
}

export async function startOAuth(connectorId: string): Promise<string> {
  const result = await apiRequest<{ url?: string; authorizeUrl?: string }>(
    `/publish/oauth/${id(connectorId)}/authorize`,
    jsonPost({}),
  );
  const url = result.url ?? result.authorizeUrl;
  if (!url) throw new Error("服务器未返回授权地址");
  window.open(url, "_blank", "noopener,noreferrer");
  return url;
}

export function publish(params: PublishParams): Promise<PublishRecord> {
  return apiRequest<PublishRecord>("/publish", jsonPost(params));
}

export function listRecords(): Promise<PublishRecord[]> {
  return apiRequest<PublishRecord[]>("/publish/records");
}

export function getRecordStatus(recordId: string): Promise<PublishStatus> {
  return apiRequest<PublishStatus>(`/publish/records/${id(recordId)}/status`);
}

export function listPlugins(): Promise<ServerPlugin[]> {
  return apiRequest<ServerPlugin[]>("/plugins");
}

export function setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
  return apiRequest<void>(`/plugins/${id(pluginId)}/${enabled ? "enable" : "disable"}`, jsonPost({}));
}

export function savePluginCredentials(
  pluginId: string,
  values: Record<string, unknown>,
): Promise<void> {
  return apiRequest<void>(`/plugins/${id(pluginId)}/credentials`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
}

export function listUploads(): Promise<UploadDTO[]> {
  return apiRequest<UploadDTO[]>("/uploads");
}

export function uploadSourceFile(file: File): Promise<UploadDTO> {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<UploadDTO>("/uploads", { method: "POST", body });
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function id(value: string): string {
  return encodeURIComponent(value);
}
