import { create } from "zustand";
import type { VideogenJobDTO, VideogenPlan } from "@openreel/plugin-sdk";
import {
  createVideogenJob,
  getVideogenJob,
  listVideogenJobs,
  runVideogenJob,
  subscribeVideogenEvents,
  type VideogenJobEvent,
} from "../services/server-ai/agents";

interface VideogenJobsState {
  jobs: Record<string, VideogenJobDTO>;
  planIds: Record<string, string>;
  errors: Record<string, string>;
  starting: boolean;
  loadJobs: () => Promise<void>;
  startJob: (plan: VideogenPlan, planArtifactId?: string) => Promise<VideogenJobDTO>;
  retryJob: (jobId: string) => Promise<void>;
  dismissJob: (jobId: string) => void;
  subscribe: (jobId: string) => void;
  upsertJob: (job: VideogenJobDTO) => void;
}

const subscriptions = new Map<string, () => void>();

export const useVideogenJobsStore = create<VideogenJobsState>()((set, get) => ({
  jobs: {},
  planIds: {},
  errors: {},
  starting: false,

  loadJobs: async () => {
    try {
      const jobs = await listVideogenJobs();
      set({ jobs: Object.fromEntries(jobs.map((job) => [job.id, job])) });
      jobs.filter(isActive).forEach((job) => get().subscribe(job.id));
    } catch (error) {
      set((state) => ({ errors: { ...state.errors, list: errorMessage(error) } }));
    }
  },
  startJob: async (plan, planArtifactId) => {
    set({ starting: true });
    try {
      const job = await createVideogenJob(plan);
      set((state) => ({
        starting: false,
        jobs: { ...state.jobs, [job.id]: job },
        planIds: planArtifactId ? { ...state.planIds, [job.id]: planArtifactId } : state.planIds,
      }));
      get().subscribe(job.id);
      return job;
    } catch (error) {
      set({ starting: false });
      throw error;
    }
  },
  retryJob: async (jobId) => {
    try {
      const job = await runVideogenJob(jobId);
      get().upsertJob(job);
      get().subscribe(jobId);
    } catch (error) {
      set((state) => ({ errors: { ...state.errors, [jobId]: errorMessage(error) } }));
    }
  },
  dismissJob: (jobId) => {
    subscriptions.get(jobId)?.();
    subscriptions.delete(jobId);
    set((state) => {
      const jobs = { ...state.jobs };
      const errors = { ...state.errors };
      const planIds = { ...state.planIds };
      delete jobs[jobId];
      delete errors[jobId];
      delete planIds[jobId];
      return { jobs, errors, planIds };
    });
  },
  subscribe: (jobId) => {
    if (subscriptions.has(jobId)) return;
    const unsubscribe = subscribeVideogenEvents(jobId, (event) => {
      void applyEvent(jobId, event, set, get);
    }, (error) => {
      subscriptions.delete(jobId);
      set((state) => ({ errors: { ...state.errors, [jobId]: error.message } }));
    });
    subscriptions.set(jobId, unsubscribe);
  },
  upsertJob: (job) => set((state) => ({ jobs: { ...state.jobs, [job.id]: job } })),
}));

async function applyEvent(
  jobId: string,
  event: VideogenJobEvent,
  set: (updater: (state: VideogenJobsState) => Partial<VideogenJobsState>) => void,
  get: () => VideogenJobsState,
): Promise<void> {
  if (event.job) {
    get().upsertJob(event.job);
    return;
  }
  let current = get().jobs[jobId];
  if (!current) {
    try { current = await getVideogenJob(jobId); } catch { return; }
  }
  const patch = { ...event };
  delete patch.job;
  delete patch.jobId;
  set((state) => ({
    jobs: { ...state.jobs, [jobId]: { ...current, ...patch, id: jobId, updatedAt: new Date().toISOString() } },
    errors: event.state === "done" ? omit(state.errors, jobId) : state.errors,
  }));
}

function isActive(job: VideogenJobDTO): boolean {
  return job.state === "queued" || job.state === "running" || job.state === "draft";
}

function omit(values: Record<string, string>, key: string): Record<string, string> {
  const next = { ...values };
  delete next[key];
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "视频渲染请求失败";
}
