/**
 * Publishing contracts: LLM-driven upload to third-party platforms via
 * PublishConnector adapters (YouTube, TikTok, X, Bilibili, Douyin, Xiaohongshu).
 */

export interface PublishCredentials {
  /** Filled from Plugin Center settings form or .env (server-side only). */
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  cookies?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface PublishRequest {
  startTimeISO: string;
  title: string;
  description: string;
  /** Comma-separated platform tags; adapters map to platform conventions. */
  tags?: string[];
  privacy?: "public" | "private" | "unlisted" | "draft";
  category?: string;
  /** Absolute path of the rendered output under DATA_DIR (server-side). */
  videoPath: string;
  /** Optional cover/thumbnail path. */
  coverPath?: string;
  /** LLM note attached for audit logging. */
  requestedVia?: "chat" | "panel";
}

export interface PublishResult {
  platformPostId: string;
  url?: string;
  state: "published" | "queued_remote" | "draft" | "failed";
  deeplink?: string;
  /** Raw response excerpt for debugging non-standard platforms. */
  raw?: unknown;
}

export interface PublishStatus {
  platformPostId: string;
  state: "published" | "processing" | "failed" | "deleted" | string;
  views?: number;
  likes?: number;
  comments?: number;
  message?: string;
}

export interface PublishConnectorDTO {
  id: string;
  label: string;
  platform: string;
  auth: string;
  /** true when required credentials validate today. */
  ok: boolean;
  setupUrl?: string;
  docs?: string;
}

export interface PublishRecord {
  id: string;
  platform: string;
  connectorId: string;
  state: string;
  platformPostId?: string;
  url?: string;
  title: string;
  videoPath: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
