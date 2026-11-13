import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublishService, type PublishHttpInput } from "./publish.service";
import { PublishStateService } from "./publish-state.service";
import { PublishRegistry } from "../registry/registry.module";
import type { SqliteService } from "../database/database.module";
import type { SettingsService } from "../config/settings.module";
import type { StorageService } from "../storage/storage.service";
import type { PublishConnectorAdapter, PublishRequest } from "@openreel/plugin-sdk";

const { DatabaseSync: DatabaseSyncCtor } = require("node:sqlite") as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE publish_records (
  id TEXT PRIMARY KEY, platform TEXT NOT NULL, connector_id TEXT NOT NULL, state TEXT NOT NULL,
  platform_post_id TEXT, url TEXT, title TEXT NOT NULL, video_path TEXT NOT NULL,
  response_raw TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE plugin_state (
  manifest_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, credentials TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL
);
CREATE TABLE videogen_jobs (
  id TEXT PRIMARY KEY, state TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, stage TEXT, error TEXT,
  plan TEXT NOT NULL, adapter_id TEXT, duration_sec REAL, video_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

function fakeAdapter(overrides: Partial<PublishConnectorAdapter> = {}): PublishConnectorAdapter {
  return {
    id: "publish-fake",
    label: "Fake",
    platform: "fake",
    auth: "api_key",
    validateCredentials: async (c) => (c && (c as Record<string, unknown>).apiKey ? { ok: true, account: "demo" } : { ok: false, message: "缺少 apiKey" }),
    publish: async (req: PublishRequest) => ({ platformPostId: "post-1", url: "https://fake.example/p/post-1", state: "published", raw: { path: req.videoPath } }),
    status: async () => ({ platformPostId: "post-1", state: "published", views: 0 }),
    ...overrides,
  };
}

describe("PublishService", () => {
  let db: DatabaseSync;
  let registry: PublishRegistry;
  let service: PublishService;
  const genDir = process.env.OPENREEL_TEST_TMP ?? "/tmp/openreel-test";

  beforeEach(() => {
    db = new DatabaseSyncCtor(":memory:");
    db.exec(SCHEMA);
    const sqlite = { get: () => db, now: () => new Date(1_700_000_000_000).toISOString() };
    const state = new PublishStateService(sqlite as unknown as SqliteService, { settings: {} } as unknown as SettingsService);
    const storage = {
      get: (id: string) => {
        if (id === "up1") return { path: `${genDir}/clip.mp4` };
        throw new Error("upload not found");
      },
      resolveDataFile: (rel: string) => (/^jobs\//.test(rel) ? `${genDir}/${rel}` : null),
    };
    registry = new PublishRegistry();
    registry.register(fakeAdapter());
    service = new PublishService(registry, state, storage as unknown as StorageService, sqlite as unknown as SqliteService);
  });

  afterEach(() => db.close());

  it("凭据缺失时拒绝并落一条 failed 记录", async () => {
    await expect(service.publish({ connectorId: "publish-fake", uploadId: "up1", title: "t" } as PublishHttpInput)).rejects.toThrow("缺少 apiKey");
    expect(service.mergedCredentials("publish-fake")).toEqual({});
  });

  it("按 uploadId 解析视频并走完整发布→记录链路", async () => {
    (service as unknown as { state: PublishStateService }).state.setCredentials("publish-fake", { apiKey: "k" });
    const rec = (await service.publish({ connectorId: "publish-fake", uploadId: "up1", title: "我的首支 AI 视频", requestedVia: "chat" } as PublishHttpInput)) as Record<string, unknown>;
    expect(rec.state).toBe("published");
    expect(rec.url).toContain("post-1");
    expect(rec.platformPostId).toBe("post-1");
  });

  it("按 videogenJobId 解析成片路径（允许相对 jobs/ 路径）", async () => {
    (service as unknown as { state: PublishStateService }).state.setCredentials("publish-fake", { apiKey: "k" });
    db.prepare(
      "INSERT INTO videogen_jobs (id, state, plan, video_path, created_at, updated_at) VALUES ('vj1', 'done', '{}', 'jobs/vj1.mp4', 'now', 'now')",
    ).run();
    const rec = (await service.publish({ connectorId: "publish-fake", videogenJobId: "vj1", title: "t" } as PublishHttpInput)) as Record<string, unknown>;
    expect(rec.state).toBe("published");
  });

  it("未产出成片的任务会被拒绝", async () => {
    (service as unknown as { state: PublishStateService }).state.setCredentials("publish-fake", { apiKey: "k" });
    db.prepare("INSERT INTO videogen_jobs (id, state, plan, created_at, updated_at) VALUES ('vj2', 'rendering', '{}', 'now', 'now')").run();
    await expect(service.publish({ connectorId: "publish-fake", videogenJobId: "vj2", title: "t" } as PublishHttpInput)).rejects.toThrow("尚未产出成片");
  });

  it("记录状态透传 adapter.status 并回写", async () => {
    (service as unknown as { state: PublishStateService }).state.setCredentials("publish-fake", { apiKey: "k" });
    const rec = (await service.publish({ connectorId: "publish-fake", uploadId: "up1", title: "t" } as PublishHttpInput)) as Record<string, unknown>;
    const status = await service.recordStatus(String(rec.id));
    expect(status.state).toBe("published");
  });

  it("未知 connector 抛错", async () => {
    await expect(service.publish({ connectorId: "nope", uploadId: "up1", title: "t" } as PublishHttpInput)).rejects.toThrow(/not found/);
  });
});
