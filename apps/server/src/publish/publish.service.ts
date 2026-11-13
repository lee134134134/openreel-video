import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { StorageService } from "../storage/storage.service";
import { SqliteService } from "../database/database.module";
import { PublishRegistry } from "../registry/registry.module";
import { PublishStateService } from "./publish-state.service";
import type { PublishRequest, PublishResult, PublishStatus } from "@openreel/plugin-sdk";
import * as path from "node:path";

export interface PublishHttpInput {
  connectorId: string;
  projectId?: string;
  uploadId?: string;
  videogenJobId?: string;
  title: string;
  description?: string;
  tags?: string[];
  privacy?: "public" | "private" | "unlisted" | "draft";
  coverPath?: string;
  requestedVia?: "chat" | "panel";
}

/** Platform-agnostic dispatch: resolves media, credentials, adapter, records. */
@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  constructor(
    private readonly registry: PublishRegistry,
    private readonly state: PublishStateService,
    private readonly storage: StorageService,
    private readonly sqlite: SqliteService,
  ) {}

  mergedCredentials(connectorId: string): Record<string, unknown> {
    return { ...this.state.envCredentials(connectorId), ...this.state.getCredentials(connectorId) };
  }

  /** Resolve absolute media path from uploadId or videogenJobId. */
  resolveVideoPath(input: Pick<PublishHttpInput, "uploadId" | "videogenJobId">): string {
    if (input.uploadId) {
      const upload = this.storage.get(input.uploadId);
      return upload.path;
    }
    if (input.videogenJobId) {
      const db = this.sqlite.get();
      const row = db.prepare("SELECT video_path FROM videogen_jobs WHERE id = ?").get(input.videogenJobId) as
        | Record<string, unknown>
        | undefined;
      const stored = row?.video_path === undefined || row?.video_path === null ? null : String(row.video_path);
      if (!stored) throw new BadRequestException("该生成任务尚未产出成片，请等待渲染完成");
      return this.absolutize(stored);
    }
    throw new BadRequestException("缺少视频来源：请提供 uploadId 或 videogenJobId");
  }

  private absolutize(stored: string): string {
    if (path.isAbsolute(stored)) return stored;
    // rel paths look like "jobs/<id>.mp4" or "uploads/<file>"
    const resolved = this.storage.resolveDataFile(stored) ?? this.storage.resolveDataFile(`jobs/${stored}`);
    if (resolved) return resolved;
    throw new BadRequestException(`成片文件不存在: ${stored}`);
  }

  async publish(input: PublishHttpInput): Promise<unknown> {
    this.state.ensureNotLocked();
    const adapter = this.registry.get(input.connectorId);
    const creds = this.mergedCredentials(adapter.id);

    let videoPath: string;
    try {
      videoPath = this.resolveVideoPath(input);
    } catch (err) {
      const message = err instanceof BadRequestException ? err.message : String(err);
      this.state.recordPublish({
        connectorId: adapter.id,
        platform: adapter.platform,
        title: input.title,
        videoPath: "",
        error: message,
      });
      throw new BadRequestException(message);
    }

    // gate on credentials before record persistence
    const validation = await safeValidate(adapter, creds);
    if (!validation.ok) {
      this.state.recordPublish({
        connectorId: adapter.id,
        platform: adapter.platform,
        title: input.title,
        videoPath,
        error: validation.message || "凭据校验未通过",
      });
      throw new BadRequestException(validation.message || "凭据缺失或无效");
    }

    const request: PublishRequest = {
      startTimeISO: new Date().toISOString(),
      title: input.title,
      description: input.description ?? "",
      tags: input.tags,
      privacy: input.privacy ?? "public",
      videoPath,
      coverPath: input.coverPath,
      requestedVia: input.requestedVia ?? "panel",
    };
    try {
      const result = await adapter.publish(request, creds as never);
      const record = this.state.recordPublish({
        connectorId: adapter.id,
        platform: adapter.platform,
        title: input.title,
        videoPath,
        result: { platformPostId: result.platformPostId, url: result.url, state: result.state },
        raw: result.raw,
      });
      return record;
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      this.state.recordPublish({
        connectorId: adapter.id,
        platform: adapter.platform,
        title: input.title,
        videoPath,
        error: message,
      });
      throw err;
    }
  }

  authorizeUrl(connectorId: string): { url: string } {
    const adapter = this.registry.get(connectorId);
    if (!adapter.oauth) {
      throw new BadRequestException(`连接器 ${connectorId} 不使用 OAuth 授权流程`);
    }
    const callback = `http://localhost:${this.settingsPort()}/api/publish/oauth/${adapter.id}/callback`;
    return { url: adapter.oauth.authorizeUrl(this.mergedCredentials(adapter.id) as never, callback) };
  }

  async oauthCallback(connectorId: string, code: string): Promise<{ ok: boolean; message: string }> {
    const adapter = this.registry.get(connectorId);
    if (!adapter.oauth) throw new BadRequestException(`连接器 ${connectorId} 不使用 OAuth`);
    const callback = `http://localhost:${this.settingsPort()}/api/publish/oauth/${adapter.id}/callback`;
    try {
      await adapter.oauth.exchangeCode(this.mergedCredentials(adapter.id) as never, code, callback);
      return { ok: true, message: "授权完成" };
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      this.logger.warn(`oauth exchange failed for ${connectorId}: ${message}`);
      return { ok: false, message };
    }
  }

  recordStatus(recordId: string): Promise<PublishStatus> {
    const record = this.state.getRecord(recordId);
    if (!record) throw new BadRequestException(`记录不存在: ${recordId}`);
    const adapter = this.registry.get(record.connectorId);
    const result = {
      platformPostId: record.platformPostId ?? "",
      url: record.url,
      state: record.state,
      raw: undefined,
    } as PublishResult;
    return adapter.status(result).then((status) => {
      this.state.updateRecord(record.id, { state: status.state });
      return status;
    });
  }

  private settingsPort(): number {
    return Number(process.env.PORT ?? 4000);
  }
}

async function safeValidate(
  adapter: { validateCredentials(creds: never): Promise<{ ok: boolean; message?: string }> },
  creds: unknown,
): Promise<{ ok: boolean; message?: string }> {
  try {
    return await adapter.validateCredentials(creds as never);
  } catch (err) {
    return { ok: false, message: String((err as Error)?.message ?? err) };
  }
}
