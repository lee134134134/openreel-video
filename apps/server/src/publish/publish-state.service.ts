import { Injectable, UnauthorizedException } from "@nestjs/common";
import { SqliteService } from "../database/database.module";
import { SettingsService } from "../config/settings.module";
import type { PublishRecord } from "@openreel/plugin-sdk";

/**
 * Publish persistence + credential storage.
 * Credentials are stored per connector in plugin_state row
 * `connector:<id>` (enabled=0 disabled). Encryption-at-rest can be layered by
 * the publish lane using settings.secret.
 */
@Injectable()
export class PublishStateService {
  constructor(
    private readonly sqlite: SqliteService,
    private readonly settings: SettingsService,
  ) {}

  recordPublish(input: { connectorId: string; platform: string; title: string; videoPath: string; result?: { platformPostId?: string; url?: string; state?: string }, raw?: unknown, error?: string }): PublishRecord {
    const db = this.sqlite.get();
    const now = this.sqlite.now();
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO publish_records (id, platform, connector_id, state, platform_post_id, url, title, video_path, response_raw, error, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      input.platform,
      input.connectorId,
      input.result?.state ?? (input.error ? "failed" : "unknown"),
      input.result?.platformPostId ?? null,
      input.result?.url ?? null,
      input.title,
      input.videoPath,
      input.raw ? JSON.stringify(input.raw).slice(0, 8000) : null,
      input.error ?? null,
      now,
      now,
    );
    return this.getRecord(id)!;
  }

  listRecords(): PublishRecord[] {
    const rows = this.sqlite.get().prepare("SELECT * FROM publish_records ORDER BY created_at DESC LIMIT 200").all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapRecord(r));
  }

  getRecord(id: string): PublishRecord | undefined {
    const row = this.sqlite.get().prepare("SELECT * FROM publish_records WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRecord(row) : undefined;
  }

  updateRecord(id: string, patch: { state?: string; platformPostId?: string; url?: string; error?: string }): void {
    const db = this.sqlite.get();
    const sets: string[] = [];
    const values: Array<string> = [];
    if (patch.state !== undefined) { sets.push("state = ?"); values.push(patch.state); }
    if (patch.platformPostId !== undefined) { sets.push("platform_post_id = ?"); values.push(patch.platformPostId); }
    if (patch.url !== undefined) { sets.push("url = ?"); values.push(patch.url); }
    if (patch.error !== undefined) { sets.push("error = ?"); values.push(patch.error); }
    if (!sets.length) return;
    sets.push("updated_at = ?"); values.push(this.sqlite.now(), id);
    db.prepare(`UPDATE publish_records SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  /* connector credentials stored in plugin_state: manifest_id = connector:<id> */

  getCredentials(connectorId: string): Record<string, unknown> | null {
    const db = this.sqlite.get();
    const readRow = (key: string): Record<string, unknown> | null => {
      const row = db.prepare("SELECT credentials FROM plugin_state WHERE manifest_id = ?").get(key) as
        | Record<string, unknown>
        | undefined;
      if (!row) return null;
      try {
        return JSON.parse(String(row.credentials ?? "{}")) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    // Tokens persisted by the plugin itself (ctx.store) live under the plain
    // manifest id; Plugin Center form saves live under `connector:<id>`.
    const pluginRow = readRow(connectorId);
    const connectorRow = readRow(`connector:${connectorId}`);
    if (!pluginRow && !connectorRow) return null;
    return { ...(pluginRow ?? {}), ...(connectorRow ?? {}) };
  }

  setCredentials(connectorId: string, credentials: Record<string, unknown>): void {
    const db = this.sqlite.get();
    db.prepare(
      "INSERT INTO plugin_state (manifest_id, enabled, credentials, updated_at) VALUES (?, 1, ?, ?) ON CONFLICT(manifest_id) DO UPDATE SET credentials = excluded.credentials, updated_at = excluded.updated_at",
    ).run(`connector:${connectorId}`, JSON.stringify(credentials), this.sqlite.now());
  }

  /** Env fallback: OPENREEL_PLUGIN_<ID>_<KEY> → { "<key lowercase>": value }. */
  envCredentials(connectorId: string): Record<string, unknown> {
    const prefix = `OPENREEL_PLUGIN_${connectorId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_`;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined || !key.startsWith(prefix)) continue;
      const field = key.slice(prefix.length);
      if (!field) continue;
      env[field.toLowerCase()] = value;
    }
    void this.settings;
    return env;
  }

  ensureNotLocked(): void {
    if (process.env.OPENREEL_DISABLE_PUBLISH === "1") {
      throw new UnauthorizedException("publishing disabled by server config");
    }
  }

  private mapRecord(r: Record<string, unknown>): PublishRecord {
    return {
      id: String(r.id),
      platform: String(r.platform),
      connectorId: String(r.connector_id),
      state: String(r.state),
      platformPostId: r.platform_post_id ? String(r.platform_post_id) : undefined,
      url: r.url ? String(r.url) : undefined,
      title: String(r.title),
      videoPath: String(r.video_path),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      error: r.error ? String(r.error) : undefined,
    };
  }
}
