import { Injectable } from "@nestjs/common";
import { SqliteService } from "../database/database.module";
import type { LlmChatMessage } from "@openreel/plugin-sdk";

/** Persisted chat threads for the server-driven creation agent. */
@Injectable()
export class ChatSessionsService {
  constructor(private readonly sqlite: SqliteService) {}

  createSession(title = "New chat", projectId?: string): { id: string } {
    const id = crypto.randomUUID();
    const now = this.sqlite.now();
    this.sqlite
      .get()
      .prepare("INSERT INTO chat_sessions (id, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, title, projectId ?? null, now, now);
    return { id };
  }

  listSessions(): Array<{ id: string; title: string; updatedAt: string }> {
    const rows = this.sqlite
      .get()
      .prepare("SELECT id, title, updated_at FROM chat_sessions ORDER BY updated_at DESC LIMIT 100")
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({ id: String(r.id), title: String(r.title), updatedAt: String(r.updated_at) }));
  }

  messages(sessionId: string): Array<LlmChatMessage & { id: string; createdAt: string }> {
    const rows = this.sqlite
      .get()
      .prepare(
        `SELECT id, role, content, created_at FROM (
          SELECT id, role, content, created_at, rowid AS message_rowid
          FROM chat_messages
          WHERE session_id = ? AND meta IS NULL AND role IN ('user', 'assistant')
          ORDER BY created_at DESC, rowid DESC LIMIT 50
        ) ORDER BY created_at ASC, message_rowid ASC`,
      )
      .all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      role: String(r.role) as "user" | "assistant",
      content: String(r.content),
      createdAt: String(r.created_at),
    }));
  }

  append(sessionId: string, role: "user" | "assistant", content: string, meta?: unknown): void {
    const db = this.sqlite.get();
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      crypto.randomUUID(),
      sessionId,
      role,
      content,
      meta ? JSON.stringify(meta) : null,
      this.sqlite.now(),
    );
    db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(this.sqlite.now(), sessionId);
  }
}
