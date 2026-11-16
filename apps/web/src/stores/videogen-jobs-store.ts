import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { VideogenJobDTO, VideogenPlan } from "@openreel/plugin-sdk";
import {
  createVideogenJob,
  getVideogenJob,
  listVideogenJobs,
  runVideogenJob,
  subscribeVideogenEvents,
  type VideogenJobEvent,
} from "../services/server-ai/agents";
import { useProjectStore } from "./project-store";

interface VideogenJobsState {
  jobs: Record<string, VideogenJobDTO>;
  planIds: Record<string, string>;
  projectPlanIds: Record<string, Record<string, string>>;
  errors: Record<string, string>;
  starting: boolean;
  resetJobs: () => void;
  loadJobs: (projectId?: string) => Promise<void>;
  startJob: (plan: VideogenPlan, planArtifactId?: string) => Promise<VideogenJobDTO>;
  retryJob: (jobId: string) => Promise<void>;
  dismissJob: (jobId: string) => void;
  subscribe: (jobId: string) => void;
  upsertJob: (job: VideogenJobDTO) => void;
}

const subscriptions = new Map<string, () => void>();
const MAX_PROJECT_PLAN_IDS = 50;

export const useVideogenJobsStore = create<VideogenJobsState>()(
  persist(
    (set, get) => ({
      jobs: {},
      planIds: {},
      projectPlanIds: {},
      errors: {},
      starting: false,

      resetJobs: () => {
        subscriptions.forEach((unsubscribe) => unsubscribe());
        subscriptions.clear();
        const projectId = useProjectStore.getState().project?.id ?? null;
        set((state) => ({
          jobs: {},
          planIds: projectId ? state.projectPlanIds[projectId] ?? {} : {},
          errors: {},
          starting: false,
        }));
      },
      loadJobs: async (projectId) => {
        try {
          const jobs = await listVideogenJobs(projectId);
          set({ jobs: Object.fromEntries(jobs.map((job) => [job.id, job])) });
          jobs.filter(isActive).forEach((job) => get().subscribe(job.id));
        } catch (error) {
          set((state) => ({ errors: { ...state.errors, list: errorMessage(error) } }));
        }
      },
      startJob: async (plan, planArtifactId) => {
        set({ starting: true });
        try {
          const projectId = useProjectStore.getState().project?.id;
          const job = await createVideogenJob(plan, undefined, projectId);
          set((state) => {
            const nextPlanIds = planArtifactId
              ? { ...state.planIds, [job.id]: planArtifactId }
              : state.planIds;
            return {
              starting: false,
              jobs: { ...state.jobs, [job.id]: job },
              planIds: nextPlanIds,
              projectPlanIds: projectId
                ? setProjectPlanIds(state.projectPlanIds, projectId, nextPlanIds)
                : state.projectPlanIds,
            };
          });
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
          return {
            jobs,
            errors,
            planIds,
            projectPlanIds: removeJobFromProjectPlanIds(state.projectPlanIds, jobId),
          };
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
    }),
    {
      name: "openreel-videogen-planids",
      // Only persist the per-project plan→job bindings; jobs themselves are
      // reloaded from the server on project switch.
      partialize: (state) => ({
        projectPlanIds: trimProjectPlanIds(state.projectPlanIds, MAX_PROJECT_PLAN_IDS),
      }),
    },
  ),
);

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

function trimProjectPlanIds(
  map: Record<string, Record<string, string>>,
  max: number,
): Record<string, Record<string, string>> {
  const keys = Object.keys(map);
  if (keys.length <= max) return map;
  const trimmed: Record<string, Record<string, string>> = {};
  for (let i = keys.length - max; i < keys.length; i++) {
    trimmed[keys[i]] = map[keys[i]];
  }
  return trimmed;
}

function setProjectPlanIds(
  map: Record<string, Record<string, string>>,
  projectId: string,
  planIds: Record<string, string>,
): Record<string, Record<string, string>> {
  const next = { ...map };
  delete next[projectId];
  next[projectId] = planIds;
  return trimProjectPlanIds(next, MAX_PROJECT_PLAN_IDS);
}

function removeJobFromProjectPlanIds(
  map: Record<string, Record<string, string>>,
  jobId: string,
): Record<string, Record<string, string>> {
  const next = { ...map };
  for (const projectId of Object.keys(next)) {
    if (jobId in next[projectId]) {
      const projectPlanIds = { ...next[projectId] };
      delete projectPlanIds[jobId];
      next[projectId] = projectPlanIds;
      break;
    }
  }
  return next;
}
