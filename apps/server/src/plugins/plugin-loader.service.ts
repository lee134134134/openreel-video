import { Injectable, Logger } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { validateManifest } from "@openreel/plugin-sdk";
import type { OpenReelPlugin, PluginContext, PluginManifest } from "@openreel/plugin-sdk";
import { VideogenRegistry, PublishRegistry, TtsRegistry, type LocalVideogenAdapter } from "../registry/registry.module";
import type { VideogenClip, VideogenScenePlan, VideogenInputValues } from "@openreel/plugin-sdk";
import { SettingsService } from "../config/settings.module";
import { SqliteService } from "../database/database.module";

export interface InstalledPluginInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  capabilities: string[];
  settings?: Array<{ key: string; label: string; type: string; required?: boolean; options?: Array<{ label: string; value: string }> }>;
  enabled: boolean;
  valid: boolean;
  error?: string;
  dir: string;
}

interface Registration {
  manifestId: string;
  kind: "publish" | "tts" | "videogen";
  adapterId: string;
}

/** Materializes plugin adapters into the server registries. */
@Injectable()
export class PluginLoaderService {
  private readonly logger = new Logger(PluginLoaderService.name);
  private readonly loaded = new Map<string, OpenReelPlugin>();
  private readonly registrations = new Map<string, Registration[]>();

  constructor(
    public readonly settings: SettingsService,
    private readonly sqlite: SqliteService,
    private readonly videogen: VideogenRegistry,
    private readonly tts: TtsRegistry,
    private readonly publish: PublishRegistry,
  ) {}

  get dir(): string {
    return this.settings.settings.pluginDir;
  }

  listInstalled(): InstalledPluginInfo[] {
    const out: InstalledPluginInfo[] = [];
    const root = this.dir;
    if (!existsSync(root)) return out;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
      const dir = path.join(root, entry.name);
      const manifestPath = path.join(dir, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
        const manifest = validateManifest(raw);
        out.push({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          capabilities: manifest.capabilities,
          settings: manifest.settings?.map((s) => ({ key: s.key, label: s.label, type: s.type, required: s.required, options: s.options })),
          enabled: this.isEnabled(manifest.id),
          valid: true,
          error: this.errors.get(manifest.id),
          dir,
        });
      } catch (err) {
        out.push({
          id: entry.name,
          name: entry.name,
          version: "-",
          capabilities: [],
          enabled: false,
          valid: false,
          error: String((err as Error)?.message ?? err),
          dir,
        });
      }
    }
    return out;
  }

  private errors = new Map<string, string>();

  isEnabled(manifestId: string): boolean {
    const row = this.sqlite.get().prepare("SELECT enabled FROM plugin_state WHERE manifest_id = ?").get(manifestId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return true;
    return Number(row.enabled) !== 0;
  }

  setEnabled(manifestId: string, enabled: boolean): void {
    this.sqlite
      .get()
      .prepare(
        "INSERT INTO plugin_state (manifest_id, enabled, credentials, updated_at) VALUES (?, ?, '{}', ?) ON CONFLICT(manifest_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at",
      )
      .run(manifestId, Number(enabled), this.sqlite.now());
  }

  setPluginCredentials(manifestId: string, values: Record<string, unknown>): void {
    this.sqlite
      .get()
      .prepare(
        "INSERT INTO plugin_state (manifest_id, enabled, credentials, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(manifest_id) DO UPDATE SET credentials = excluded.credentials, updated_at = excluded.updated_at",
      )
      .run(manifestId, JSON.stringify(values ?? {}), this.sqlite.now());
  }

  async loadAll(): Promise<{ loaded: string[]; failed: Array<{ id: string; error: string }> }> {
    const loaded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];
    for (const info of this.listInstalled()) {
      if (!info.valid) continue;
      try {
        await this.loadOne(info.dir, info.enabled);
        loaded.push(info.id);
      } catch (err) {
        const id = info.id;
        const error = String((err as Error)?.message ?? err);
        this.errors.set(id, error);
        failed.push({ id, error });
        this.logger.warn(`plugin ${id} failed to load: ${error}`);
      }
    }
    return { loaded, failed };
  }

  async loadOne(pluginDir: string, enabledDefault = true): Promise<void> {
    const manifest = validateManifest(JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8")));
    const entry = this.pickEntry(pluginDir);
    if (!entry) throw new Error(`缺少入口文件 index.cjs / index.js（目录 ${pluginDir}）`);
    let plugin: OpenReelPlugin | null;
    if (path.extname(entry) === ".cjs") {
      const { createRequire } = await import("node:module");
      const req = createRequire(path.join(__dirname, "noop.js"));
      const mod = req(entry) as Record<string, unknown> & { default?: unknown };
      plugin = ((mod?.default ?? mod) ?? null) as OpenReelPlugin | null;
    } else {
      const mod = (await import(pathToFileURL(entry).href)) as { default?: unknown };
      plugin = ((mod?.default ?? mod) ?? null) as OpenReelPlugin | null;
    }
    if (!plugin || typeof plugin.adapters !== "function") {
      throw new Error("插件入口必须导出 OpenReelPlugin（含 adapters(ctx)）");
    }
    const enabled = this.isEnabled(manifest.id) && enabledDefault;
    const ctx = this.buildContext(manifest, enabled, pluginDir);

    const adapters = await plugin.adapters(ctx);
    if (enabled) {
      if (adapters.publish) {
        this.publish.register(adapters.publish);
        this.track(manifest.id, { manifestId: manifest.id, kind: "publish", adapterId: adapters.publish.id });
      }
      if (adapters.tts) {
        this.tts.register(adapters.tts);
        this.track(manifest.id, { manifestId: manifest.id, kind: "tts", adapterId: adapters.tts.id });
      }
      if (adapters.videogen) {
        this.videogen.register(this.wrapVideogen(adapters.videogen, ctx));
        this.track(manifest.id, { manifestId: manifest.id, kind: "videogen", adapterId: "wrapped" });
      }
    }
    this.errors.delete(manifest.id);
    this.loaded.set(manifest.id, plugin);
    this.logger.log(`插件加载完成: ${manifest.id} (${manifest.capabilities.join(",")}) enabled=${enabled}`);
  }

  track(manifestId: string, reg: Registration): void {
    const list = this.registrations.get(manifestId) ?? [];
    list.push(reg);
    this.registrations.set(manifestId, list);
  }

  /** Remove adapters of a plugin from registries (disable/unload). */
  unload(manifestId: string): void {
    for (const reg of this.registrations.get(manifestId) ?? []) {
      if (reg.kind === "publish") this.publish.remove(reg.adapterId);
      if (reg.kind === "tts") this.tts.remove(reg.adapterId);
      if (reg.kind === "videogen") this.videogen.remove(reg.adapterId);
    }
    this.registrations.delete(manifestId);
    this.loaded.delete(manifestId);
  }

  async disable(manifestId: string): Promise<void> {
    this.setEnabled(manifestId, false);
    this.unload(manifestId);
  }

  async enable(manifestId: string): Promise<void> {
    this.setEnabled(manifestId, true);
    const info = this.listInstalled().find((i) => i.id === manifestId);
    if (!info || !info.valid) throw new Error(`插件无效或未安装: ${manifestId}`);
    this.unload(manifestId);
    await this.loadOne(info.dir, true);
  }

  private wrapVideogen(adapter: import("@openreel/plugin-sdk").VideogenAdapter, ctx: PluginContext): LocalVideogenAdapter {
    return {
      id: adapter.id,
      label: adapter.label,
      async generateScene(scene: VideogenScenePlan, options: { outDir: string; width: number; height: number; fps: number; voiceId?: string }): Promise<VideogenClip> {
        const values: VideogenInputValues = { ...(ctx.credentials as VideogenInputValues) };
        return adapter.generateScene(scene, { outDir: options.outDir, values, width: options.width, height: options.height, fps: options.fps }, ctx, { onProgress: () => {} });
      },
    };
  }

  buildContext(manifest: PluginManifest, enabled: boolean, _dir: string): PluginContext {
    const db = this.sqlite.get();
    const slug = manifest.id;
    const logger = {
      debug(msg: string, meta?: unknown) { console.debug(`[plugin ${slug}]`, msg, meta ?? ""); },
      info(msg: string, meta?: unknown) { console.info(`[plugin ${slug}]`, msg, meta ?? ""); },
      warn(msg: string, meta?: unknown) { console.warn(`[plugin ${slug}]`, msg, meta ?? ""); },
      error(msg: string, meta?: unknown) { console.error(`[plugin ${slug}]`, msg, meta ?? ""); },
    };
    const readCredentials = (): Record<string, unknown> => {
      const readRow = (key: string): Record<string, unknown> => {
        const row = db.prepare("SELECT credentials FROM plugin_state WHERE manifest_id = ?").get(key) as
          | Record<string, unknown>
          | undefined;
        if (!row) return {};
        try {
          return JSON.parse(String(row.credentials ?? "{}")) as Record<string, unknown>;
        } catch {
          return {};
        }
      };
      // match PublishStateService merging: tokens persisted via ctx.store live
      // under the plain id; Plugin Center form rows live under connector:<id>.
      return { ...readRow(slug), ...readRow(`connector:${slug}`) };
    };
    const writeCredentials = (values: Record<string, unknown>): void => {
      db.prepare(
        "INSERT INTO plugin_state (manifest_id, enabled, credentials, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(manifest_id) DO UPDATE SET credentials = excluded.credentials, updated_at = excluded.updated_at",
      ).run(slug, JSON.stringify(values), this.sqlite.now());
    };
    // Seed settings defaults: env OPENREEL_PLUGIN_<ID>_<FIELD> > store defaults.
    const seed: Record<string, unknown> = {
      ...readCredentials(),
    };
    for (const field of manifest.settings ?? []) {
      const envKey = `OPENREEL_PLUGIN_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_${field.key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
      const envValue = process.env[envKey];
      if (envValue !== undefined) {
        seed[field.key] = envValue;
      } else if (seed[field.key] === undefined && field.default !== undefined) {
        seed[field.key] = field.default;
      }
    }
    if (Object.keys(readCredentials()).length !== Object.keys(seed).length) {
      writeCredentials(seed);
    }
    const dataDir = this.settings.settings.dataDir;

    return {
      manifest,
      enabled,
      logger,
      credentials: seed,
      config: {
        dataDir: this.settings.settings.dataDir,
        serverUrl: `http://localhost:${this.settings.settings.port}`,
        port: this.settings.settings.port,
        secret: this.settings.settings.secret,
      },
      store: {
        async get<T = unknown>(key: string): Promise<T | null> {
          const cs = readCredentials();
          return (cs[key] as T) ?? null;
        },
        async set<T = unknown>(key: string, value: T): Promise<void> {
          const cs = readCredentials();
          cs[key] = value;
          writeCredentials(cs);
        },
        async delete(key: string): Promise<void> {
          const cs = readCredentials();
          delete cs[key];
          writeCredentials(cs);
        },
        async getCredentials(): Promise<Record<string, unknown>> {
          return readCredentials();
        },
        async setCredentials(values: Record<string, unknown>): Promise<void> {
          writeCredentials(values);
        },
      },
      workspace: {
        async scratchDir(): Promise<string> {
          const dir = path.join(dataDir, "plugins", slug);
          mkdirSync(dir, { recursive: true });
          return dir;
        },
      },
      http: {
        async fetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 30000);
          try {
            const { timeoutMs: _ignored, ...rest } = init ?? {};
            void _ignored;
            return await fetch(url, {
              ...rest,
              signal: controller.signal,
              headers: { "User-Agent": "OpenReel-Server", ...(rest.headers ?? {}) },
            });
          } finally {
            clearTimeout(timer);
          }
        },
      },
    };
  }

  private pickEntry(dir: string): string | null {
    // .cjs first: the ts-node CJS host is the primary runtime; native ESM hosts fall back import() below
    for (const name of ["index.cjs", "index.mjs", "index.js", "dist/index.cjs", "dist/index.mjs", "dist/index.js"]) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }
}
