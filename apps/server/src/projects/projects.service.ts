import { Injectable } from "@nestjs/common";
import { SqliteService } from "../database/database.module";

export interface ProjectRow {
  id: string;
  title: string;
  data: string;
  createdAt: string;
  updatedAt: string;
}

/** Projects CRUD (OpenReel project JSON lives in `data`). */
@Injectable()
export class ProjectsService {
  constructor(private readonly sqlite: SqliteService) {}

  list(): ProjectRow[] {
    const rows = this.sqlite
      .get()
      .prepare("SELECT id, title, data, created_at, updated_at FROM projects ORDER BY updated_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map(this.mapRow);
  }

  get(id: string): ProjectRow | null {
    const row = this.sqlite.get().prepare("SELECT id, title, data, created_at, updated_at FROM projects WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.mapRow(row) : null;
  }

  create(project: { id?: string; title: string; data?: unknown }): ProjectRow {
    const db = this.sqlite.get();
    const id = project.id ?? crypto.randomUUID();
    const now = this.sqlite.now();
    db.prepare("INSERT INTO projects (id, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      id,
      project.title,
      JSON.stringify(project.data ?? {}),
      now,
      now,
    );
    return this.get(id)!;
  }

  update(id: string, patch: { title?: string; data?: unknown }): ProjectRow | null {
    const existing = this.get(id);
    if (!existing) return null;
    const db = this.sqlite.get();
    db.prepare("UPDATE projects SET title = ?, data = ?, updated_at = ? WHERE id = ?").run(
      patch.title ?? existing.title,
      patch.data !== undefined ? JSON.stringify(patch.data) : existing.data,
      this.sqlite.now(),
      id,
    );
    return this.get(id);
  }

  delete(id: string): boolean {
    const db = this.sqlite.get();
    const info = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return Number(info.changes) > 0;
  }

  private mapRow(row: Record<string, unknown>): ProjectRow {
    return {
      id: String(row.id),
      title: String(row.title),
      data: String(row.data ?? "{}"),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
