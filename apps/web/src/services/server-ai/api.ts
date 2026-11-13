const SERVER_URL_KEY = "openreel-server-url";
const DEFAULT_SERVER_URL = "http://localhost:4000";

export interface ServerHealth {
  ok: boolean;
  ffmpeg?: boolean;
  llm?: boolean;
  modelCount?: number;
  message?: string;
}

export interface ServerModel {
  id: string;
  name?: string;
}

export class ServerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ServerApiError";
  }
}

export function getServerUrl(): string {
  if (typeof window === "undefined") return DEFAULT_SERVER_URL;
  const saved = window.localStorage.getItem(SERVER_URL_KEY);
  return normalizeServerUrl(saved || DEFAULT_SERVER_URL);
}

export function setServerUrl(value: string): string {
  const normalized = normalizeServerUrl(value);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SERVER_URL_KEY, normalized);
  }
  return normalized;
}

export function resolveServerUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const apiPath = path.startsWith("/api/") ? path : `/api/${path.replace(/^\/+/, "")}`;
  return `${getServerUrl()}${apiPath}`;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(resolveServerUrl(path), { ...init, headers });
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new ServerApiError(detail || `服务器请求失败 (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function testServerConnection(): Promise<ServerHealth> {
  try {
    const health = await apiRequest<ServerHealth>("/health");
    let modelCount: number | undefined;
    try {
      modelCount = (await getServerModels()).length;
    } catch {
      // Health remains useful when the model gateway is not configured.
    }
    return { ...health, ok: health.ok !== false, modelCount };
  } catch (error) {
    return {
      ok: false,
      ffmpeg: false,
      llm: false,
      modelCount: 0,
      message: error instanceof Error ? error.message : "无法连接服务器",
    };
  }
}

export async function getServerModels(): Promise<ServerModel[]> {
  type ModelPayload = ServerModel | string;
  const payload = await apiRequest<ModelPayload[] | { models: ModelPayload[] }>("/llm/models");
  const models = Array.isArray(payload) ? payload : payload.models;
  return (models ?? []).flatMap((model) => {
    if (typeof model === "string") return [{ id: model, name: model }];
    if (model && typeof model.id === "string") return [model];
    return [];
  });
}

function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_SERVER_URL;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[]; error?: string };
    if (Array.isArray(body.message)) return body.message.join("；");
    return body.message || body.error || "";
  } catch {
    return "";
  }
}
