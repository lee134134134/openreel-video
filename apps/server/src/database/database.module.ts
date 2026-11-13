import { Injectable, OnModuleDestroy, Global, Module } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { SettingsService } from "../config/settings.module";

/**
 * Thin synchronous wrapper around the built-in node:sqlite (no native deps).
 * Schema migrations are idempotent CREATE TABLE IF NOT EXISTS statements.
 */

const STATEMENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS render_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  stage TEXT,
  error TEXT,
  output_format TEXT NOT NULL DEFAULT 'mp4',
  output_url TEXT,
  input_files TEXT,
  transcode_options TEXT,
  videogen_job_id TEXT,
  log_tail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS videogen_jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  stage TEXT,
  error TEXT,
  plan TEXT NOT NULL,
  adapter_id TEXT,
  duration_sec REAL,
  video_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publish_records (
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
CREATE TABLE IF NOT EXISTS plugin_state (
  manifest_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  credentials TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
`;

@Injectable()
export class SqliteService implements OnModuleDestroy {
  private db?: DatabaseSync;

  constructor(private readonly settings: SettingsService) {}

  /** Namespaced key-value store used by plugin state and small flags. */
  kvGet(table: "plugin_state" | "chat_sessions" | "projects", id: string): Record<string, unknown> | null {
    const db = this.get();
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ?? null;
  }

  get(): DatabaseSync {
    if (!this.db) {
      const fs = require("node:fs") as typeof import("node:fs");
      fs.mkdirSync(this.settings.settings.dataDir, { recursive: true });
      this.db = new DatabaseSync(`${this.settings.settings.dataDir}/openreel-server.db`);
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec(STATEMENT_SCHEMA);
    }
    return this.db;
  }

  now(): string {
    return new Date().toISOString();
  }

  onModuleDestroy(): void {
    this.db?.close();
  }
}

@Global()
@Module({
  providers: [SqliteService],
  exports: [SqliteService],
})
export class DatabaseModule {}
