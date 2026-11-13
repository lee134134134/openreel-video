import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublishStateService } from "./publish-state.service";
import type { SqliteService } from "../database/database.module";
import type { SettingsService } from "../config/settings.module";

const { DatabaseSync: DatabaseSyncCtor } = require("node:sqlite") as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE publish_records (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  state TEXT NOT NULL,
  platform_post_id TEXT,
  url TEXT,
  title TEXT NOT NULL,
  video_path TEXT NOT NULL,
  response_raw TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE plugin_state (
  manifest_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  credentials TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
`;

describe("PublishStateService", () => {
  let db: DatabaseSync;
  let state: PublishStateService;

  beforeEach(() => {
    db = new DatabaseSyncCtor(":memory:");
    db.exec(SCHEMA);
    const sqlite = { get: () => db, now: () => new Date(1_700_000_000_000).toISOString() };
    const settings = { settings: { secret: "test" } };
    state = new PublishStateService(sqlite as unknown as SqliteService, settings as unknown as SettingsService);
  });

  afterEach(() => db.close());

  it("记录失败与成功发布，并按 id 取回", () => {
    const failed = state.recordPublish({ connectorId: "publish-x", platform: "x", title: "t", videoPath: "/tmp/v.mp4", error: "缺少凭据字段: apiKey" });
    expect(failed.state).toBe("failed");
    const ok = state.recordPublish({
      connectorId: "publish-x",
      platform: "x",
      title: "t2",
      videoPath: "/tmp/v.mp4",
      result: { platformPostId: "123", url: "https://x.com/u/status/123", state: "published" },
    });
    expect(ok.platformPostId).toBe("123");
    expect(state.getRecord(failed.id)?.error).toContain("缺少凭据");
    expect(state.listRecords()).toHaveLength(2);
  });

  it("合并 plugin 行与 connector 行凭据（connector 后写覆盖）", () => {
    state.setCredentials("publish-x", { accessToken: "form-value" });
    db.prepare("INSERT INTO plugin_state (manifest_id, enabled, credentials, updated_at) VALUES (?, 1, ?, 'now')").run(
      "publish-x",
      JSON.stringify({ accessToken: "plugin-token", refreshToken: "r" }),
    );
    expect(state.getCredentials("publish-x")).toEqual({ accessToken: "form-value", refreshToken: "r" });
  });

  it("envCredentials 读取 OPENREEL_PLUGIN_ 前缀环境变量", () => {
    process.env.OPENREEL_PLUGIN_PUBLISH_DEMO_API_KEY = "env-key";
    try {
      expect(state.envCredentials("publish-demo")).toEqual({ api_key: "env-key" });
      // 无关平台不受影响
      expect(state.envCredentials("publish-other")).toEqual({});
    } finally {
      delete process.env.OPENREEL_PLUGIN_PUBLISH_DEMO_API_KEY;
    }
  });

  it("updateRecord 支持补写状态与错误", () => {
    const rec = state.recordPublish({ connectorId: "publish-x", platform: "x", title: "t", videoPath: "/v.mp4" });
    state.updateRecord(rec.id, { state: "published", platformPostId: "9" });
    expect(state.getRecord(rec.id)).toMatchObject({ state: "published", platformPostId: "9" });
  });
});
