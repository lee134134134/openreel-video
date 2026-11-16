import { describe, it, expect, beforeEach, vi } from "vitest";
import type { VideogenPlan } from "@openreel/plugin-sdk";

const h = vi.hoisted(() => ({
  listVideogenJobs: vi.fn(),
  createVideogenJob: vi.fn(),
  subscribeVideogenEvents: vi.fn(() => () => {}),
  getVideogenJob: vi.fn(),
  runVideogenJob: vi.fn(),
  projectId: "project-web",
}));

vi.mock("../services/server-ai/agents", () => ({
  listVideogenJobs: h.listVideogenJobs,
  createVideogenJob: h.createVideogenJob,
  subscribeVideogenEvents: h.subscribeVideogenEvents,
  getVideogenJob: h.getVideogenJob,
  runVideogenJob: h.runVideogenJob,
}));

vi.mock("./project-store", () => ({
  useProjectStore: {
    getState: () => ({ project: { id: h.projectId } }),
  },
}));

import { useVideogenJobsStore } from "./videogen-jobs-store";

const store = () => useVideogenJobsStore.getState();

const plan: VideogenPlan = {
  options: { title: "Test", aspectRatio: "9:16", fps: 30, resolution: 720 },
  scenes: [],
  estimatedDurationSec: 0,
};

const sampleJob = (id: string) => ({
  id,
  state: "done" as const,
  progress: 1,
  plan,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("videogen-jobs-store", () => {
  beforeEach(() => {
    localStorage.clear();
    store().resetJobs();
    useVideogenJobsStore.setState({ projectPlanIds: {} });
    h.projectId = "project-web";
    vi.clearAllMocks();
  });

  it("resetJobs empties jobs/errors/subscriptions but preserves the current project's planIds", () => {
    h.subscribeVideogenEvents.mockReturnValueOnce(() => {});
    useVideogenJobsStore.setState({
      jobs: { j1: sampleJob("j1") },
      planIds: { j1: "plan-1" },
      projectPlanIds: { "project-web": { j1: "plan-1" } },
      errors: { j1: "error" },
    });
    store().subscribe("j1");

    store().resetJobs();

    expect(store().jobs).toEqual({});
    expect(store().planIds).toEqual({ j1: "plan-1" });
    expect(store().errors).toEqual({});
    expect(store().starting).toBe(false);
  });

  it("resetJobs restores persisted planIds for the current project", () => {
    useVideogenJobsStore.setState({
      planIds: { old: "old-plan" },
      projectPlanIds: { "project-web": { j1: "plan-1" } },
    });

    store().resetJobs();

    expect(store().planIds).toEqual({ j1: "plan-1" });
  });

  it("loadJobs passes project id to listVideogenJobs", async () => {
    h.listVideogenJobs.mockResolvedValueOnce([]);

    await store().loadJobs("p1");

    expect(h.listVideogenJobs).toHaveBeenCalledWith("p1");
  });

  it("startJob binds new jobs to the current web project and persists planIds", async () => {
    h.createVideogenJob.mockResolvedValueOnce({
      id: "j2",
      state: "draft",
      progress: 0,
      plan,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    h.subscribeVideogenEvents.mockReturnValueOnce(() => {});

    await store().startJob(plan, "artifact-1");

    expect(h.createVideogenJob).toHaveBeenCalledWith(plan, undefined, "project-web");
    expect(store().planIds.j2).toBe("artifact-1");
    expect(store().projectPlanIds["project-web"].j2).toBe("artifact-1");
  });

  it("caps projectPlanIds at 50 projects", async () => {
    h.createVideogenJob.mockResolvedValue({
      id: "j2",
      state: "draft",
      progress: 0,
      plan,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    for (let i = 0; i < 51; i++) {
      h.projectId = `project-${i}`;
      await store().startJob(plan, `artifact-${i}`);
    }

    expect(Object.keys(store().projectPlanIds)).toHaveLength(50);
    expect(store().projectPlanIds["project-0"]).toBeUndefined();
    expect(store().projectPlanIds["project-50"]).toBeDefined();
  });
});
