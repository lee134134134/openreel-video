import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { VideogenPlan } from "@openreel/plugin-sdk";
import { VideogenService } from "./videogen.service";
import type { SqliteService } from "../database/database.module";

// Vite 5 does not yet recognize node:sqlite as an external builtin in tests.
const { DatabaseSync: DatabaseSyncCtor } = require("node:sqlite") as typeof import("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS videogen_jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  stage TEXT,
  error TEXT,
  plan TEXT NOT NULL,
  adapter_id TEXT,
  project_id TEXT,
  duration_sec REAL,
  video_path TEXT,
  warnings TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const plan: VideogenPlan = {
  options: { title: "Test", aspectRatio: "9:16", fps: 30, resolution: 720 },
  scenes: [],
  estimatedDurationSec: 0,
};

function makeService(db: DatabaseSync): VideogenService {
  const sqlite = {
    get: () => db,
    now: () => new Date().toISOString(),
  } as unknown as SqliteService;
  return new VideogenService(sqlite, null as never, null as never, null as never, null as never, null as never);
}

describe("VideogenService project scoping", () => {
  let db: DatabaseSync;
  let service: VideogenService;

  beforeEach(() => {
    db = new DatabaseSyncCtor(":memory:");
    db.exec(SCHEMA);
    service = makeService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("list returns only jobs for the requested project id", () => {
    service.create(plan, undefined, "p1");
    service.create(plan, undefined, "p2");
    service.create(plan);

    const p1Jobs = service.list("p1");
    const allJobs = service.list();

    expect(p1Jobs).toHaveLength(1);
    expect(p1Jobs[0].projectId).toBe("p1");
    expect(allJobs).toHaveLength(3);
  });

  it("create stores project_id and exposes it on the DTO", () => {
    const job = service.create(plan, undefined, "p1");

    expect(job.projectId).toBe("p1");
    expect(service.list("p1").map((item) => item.id)).toContain(job.id);
  });
});
