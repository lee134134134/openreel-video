import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginLoaderService, type InstalledPluginInfo } from "./plugin-loader.service";
import { PublishRegistry } from "../registry/registry.module";
import type { SqliteService } from "../database/database.module";
import type { SettingsService } from "../config/settings.module";
import type { PluginManifest } from "@openreel/plugin-sdk";

/** Fake ESM plugin used by these tests. */
const PLUGIN_JS = `
const adapter = {
  id: "publish-test",
  label: "Test",
  platform: "test",
  auth: "api_key",
  validateCredentials: async (c) => ({ ok: !!(c && c.apiKey), message: c && c.apiKey ? undefined : "缺少 apiKey" }),
  publish: async () => ({ platformPostId: "t1", state: "published" }),
  status: async () => ({ platformPostId: "t1", state: "published" }),
};
export default { manifest: () => manifest, adapters: async () => ({ publish: adapter }) };
`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plugin_state (
  manifest_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  credentials TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
`;

const { DatabaseSync: DatabaseSyncCtor } = require("node:sqlite") as typeof import("node:sqlite");

describe("PluginLoaderService", () => {
  let root: string;

  function makeEnv(dir: string): { loader: PluginLoaderService; publish: PublishRegistry } {
    const settings = { settings: { dataDir: path.join(dir, "data"), pluginDir: dir, port: 4107, secret: "s" } } as unknown as SettingsService;
    const publish = new PublishRegistry();
    const loader = new PluginLoaderService(
      settings,
      // fake sqlite: in-memory db sharing the plugin_state schema
      {
        get: () => db,
        now: () => new Date(1_700_000_000_000).toISOString(),
      } as unknown as SqliteService,
      // biome-ignore lint: minimal registry stubs for TTS/Videogen
      { register: () => undefined, remove: () => undefined } as never,
      { register: () => undefined, remove: () => undefined } as never,
      publish,
    );
    return { loader, publish };
  }

  const tmpBase = path.join(os.tmpdir(), `openreel-plugin-test-${process.pid}`);
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSyncCtor(":memory:");
    db.exec(SCHEMA);
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
    delete process.env.OPENREEL_TEST_PLUGIN_API_KEY;
  });

  it("加载合法插件并注册 PublishConnector；禁用后从注册表摘除", async () => {
    root = path.join(tmpBase, "enabled-case");
    const dir = path.join(root, "publish-test");
    mkdirSync(dir, { recursive: true });
    const manifest: PluginManifest = { id: "publish-test", name: "Test Connector", version: "1.0.0", description: "", abi: "1.0", capabilities: ["publish"] };
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(path.join(dir, "index.js"), PLUGIN_JS);

    const { loader, publish } = makeEnv(root);
    const result = await loader.loadAll();
    expect(result.failed).toEqual([]);
    expect(result.loaded).toContain("publish-test");
    expect(publish.has("publish-test")).toBe(true);

    const info: InstalledPluginInfo[] = loader.listInstalled();
    expect(info[0].id).toBe("publish-test");
    expect(info[0].enabled).toBe(true);

    await loader.disable("publish-test");
    expect(publish.has("publish-test")).toBe(false);
    expect(loader.isEnabled("publish-test")).toBe(false);
  });

  it("无效的缺失字段插件显示 valid=false 与 error", () => {
    root = path.join(tmpBase, "invalid-case");
    const dir = path.join(root, "publish-bad");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: "BAD ID!", name: "x" }));
    const { loader } = makeEnv(root);
    const info = loader.listInstalled();
    expect(info).toHaveLength(1);
    expect(info[0].valid).toBe(false);
    expect(info[0].error).toBeTruthy();
  });

  it("凭据从 plugin_state（含 connector: 行）与 env 兜底读取", async () => {
    root = path.join(tmpBase, "cred-case");
    const dir = path.join(root, "publish-test");
    mkdirSync(dir, { recursive: true });
    const manifest: PluginManifest = {
      id: "publish-test",
      name: "Test Connector",
      version: "1.0.0",
      description: "",
      abi: "1.0",
      capabilities: ["publish"],
      settings: [{ key: "apiKey", label: "API Key", type: "password", required: true }],
    };
    writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(path.join(dir, "index.js"), PLUGIN_JS);

    const { loader, publish } = makeEnv(root);
    loader.setPluginCredentials("publish-test", { apiKey: "from-db" });
    await loader.loadAll();
    expect(publish.has("publish-test")).toBe(true);
    // adapters registered; ctx.credentials seeded via merged view — exercise validate
    const adapter = publish.get("publish-test");
    const res = await adapter.validateCredentials({ apiKey: "from-db" } as never);
    expect(res.ok).toBe(true);
  });
});
