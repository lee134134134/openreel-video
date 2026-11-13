import { Injectable, NotFoundException } from "@nestjs/common";
import { SqliteService } from "../database/database.module";
import { SettingsService } from "../config/settings.module";
import * as fs from "node:fs";
import * as path from "node:path";

export interface UploadRow {
  id: string;
  filename: string;
  path: string;
  byteSize: number;
  kind: string;
  createdAt: string;
}

/** Uploaded / generated media registry. Physical files live under DATA_DIR. */
@Injectable()
export class StorageService {
  constructor(private readonly sqlite: SqliteService, private readonly settings: SettingsService) {}

  uploadDir(): string {
    return path.join(this.settings.settings.dataDir, "uploads");
  }

  jobsDir(): string {
    return path.join(this.settings.settings.dataDir, "jobs");
  }

  ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
  }

  register(relPath: string, filename: string, kind: string, size: number): UploadRow {
    const abs = path.isAbsolute(relPath) ? relPath : path.join(this.settings.settings.dataDir, relPath);
    const row: UploadRow = {
      id: crypto.randomUUID(),
      filename,
      path: abs,
      byteSize: size,
      kind,
      createdAt: this.sqlite.now(),
    };
    this.sqlite
      .get()
      .prepare("INSERT INTO uploads (id, filename, path, byte_size, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.filename, row.path, row.byteSize, row.kind, row.createdAt);
    return row;
  }

  get(id: string): UploadRow {
    const row = this.sqlite.get().prepare("SELECT * FROM uploads WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new NotFoundException(`upload ${id} not found`);
    return {
      id: String(row.id),
      filename: String(row.filename),
      path: String(row.path),
      byteSize: Number(row.byte_size),
      kind: String(row.kind),
      createdAt: String(row.created_at),
    };
  }

  list(kind?: string): UploadRow[] {
    const sql = kind
      ? "SELECT * FROM uploads WHERE kind = ? ORDER BY created_at DESC"
      : "SELECT * FROM uploads ORDER BY created_at DESC";
    const rows = (kind ? this.sqlite.get().prepare(sql).all(kind) : this.sqlite.get().prepare(sql).all()) as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      id: String(r.id),
      filename: String(r.filename),
      path: String(r.path),
      byteSize: Number(r.byte_size),
      kind: String(r.kind),
      createdAt: String(r.created_at),
    }));
  }

  /** Read orchestrator-approved file path (must live under dataDir). */
  resolveDataFile(relPath: string): string | null {
    const abs = path.resolve(path.join(this.settings.settings.dataDir, relPath));
    const root = path.resolve(this.settings.settings.dataDir + path.sep);
    if (!abs.startsWith(root)) return null;
    if (!fs.existsSync(abs)) return null;
    return abs;
  }
}
