import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatSessionsService } from "./chat-sessions.service";
import type { SqliteService } from "../database/database.module";

// Vite 5 does not yet recognize node:sqlite as an external builtin in tests.
const { DatabaseSync: DatabaseSyncCtor } = require("node:sqlite") as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
`;

describe("ChatSessionsService", () => {
  let db: DatabaseSync;
  let sqlite: SqliteService;
  let service: ChatSessionsService;
  let tick: number;

  beforeEach(() => {
    db = new DatabaseSyncCtor(":memory:");
    db.exec(SCHEMA);
    tick = 0;
    const fake = {
      get: () => db,
      now: () => new Date(1_700_000_000_000 + tick++).toISOString(),
    };
    sqlite = fake as unknown as SqliteService;
    service = new ChatSessionsService(sqlite);
  });

  afterEach(() => {
    db.close();
  });

  it("appends and lists only user/assistant messages without metadata", () => {
    const { id } = service.createSession("Editing");
    service.append(id, "user", "first");
    service.append(id, "assistant", "answer");
    service.append(id, "assistant", "tool result", { type: "tool_result" });
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "tool-message",
      id,
      "tool",
      "raw tool JSON",
      null,
      sqlite.now(),
    );
    service.append(id, "user", "second");

    expect(service.messages(id).map((message) => ({ role: message.role, content: message.content }))).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "answer" },
      { role: "user", content: "second" },
    ]);
    expect(service.listSessions()).toEqual([
      { id, title: "Editing", updatedAt: expect.any(String) },
    ]);
  });

  it("caps message history at the latest 50 in ascending order", () => {
    const { id } = service.createSession();
    for (let index = 0; index < 55; index++) {
      service.append(id, index % 2 === 0 ? "user" : "assistant", `message-${index}`);
    }

    const messages = service.messages(id);

    expect(messages).toHaveLength(50);
    expect(messages[0].content).toBe("message-5");
    expect(messages[49].content).toBe("message-54");
    expect(messages.map((message) => message.createdAt)).toEqual(
      [...messages.map((message) => message.createdAt)].sort(),
    );
  });

  it("persists sessions across service instances using the same storage", () => {
    const { id } = service.createSession("Persistent");
    service.append(id, "user", "saved message");

    const reloaded = new ChatSessionsService(sqlite);

    expect(reloaded.listSessions()[0]).toMatchObject({ id, title: "Persistent" });
    expect(reloaded.messages(id)).toHaveLength(1);
    expect(reloaded.messages(id)[0]).toMatchObject({ role: "user", content: "saved message" });
  });
});
