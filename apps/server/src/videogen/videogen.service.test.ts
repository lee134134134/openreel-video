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
  return new VideogenService(sqlite, null as never, null as never, null as never, null as never, null as never, null as never);
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

  it("defaults plans without an aspect ratio to landscape 16:9", () => {
    const withoutRatio = {
      ...plan,
      options: { ...plan.options, aspectRatio: undefined },
    } as unknown as VideogenPlan;
    const job = service.create(withoutRatio);
    expect(job.plan.options.aspectRatio).toBe("16:9");
  });

  it("keeps the continuity bible and per-scene keyframe beats", () => {
    const job = service.create({
      ...plan,
      continuityBible: "统一冷蓝晨光，35mm，深色大衣与通勤包",
      scenes: [{
        index: 0,
        narration: "清晨路口",
        durationSec: 3,
        visualPrompt: "行人穿过斑马线",
        beats: ["远景起幅", "镜头推近", "近景落幅"],
      }],
    });
    expect(job.plan.continuityBible).toContain("冷蓝晨光");
    expect(job.plan.scenes[0].beats).toEqual(["远景起幅", "镜头推近", "近景落幅"]);
  });

  it("create stores project_id and exposes it on the DTO", () => {
    const job = service.create(plan, undefined, "p1");

    expect(job.projectId).toBe("p1");
    expect(service.list("p1").map((item) => item.id)).toContain(job.id);
  });
});
