import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LlmChatMessage, VideogenPlan } from "@openreel/plugin-sdk";
import {
  getServerUrl,
  setServerUrl as saveServerUrl,
  testServerConnection,
  ServerApiError,
  type ServerHealth,
} from "../services/server-ai/api";
import { streamAgentEvents } from "../services/server-ai/sse";

export interface ServerChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface PlanArtifact {
  id: string;
  plan: VideogenPlan;
  createdAt: number;
}

export interface ServerChatError {
  message: string;
  status?: number;
}

/** A finished video the user wants the AI to revise next. */
export interface VideoQuote {
  jobId: string;
  title: string;
}

interface ServerChatState {
  serverUrl: string;
  model: string;
  health: ServerHealth | null;
  checkingHealth: boolean;
  sessionId: string | null;
  messages: ServerChatMessage[];
  plans: PlanArtifact[];
  sending: boolean;
  thinking: string | null;
  error: ServerChatError | null;
  quote: VideoQuote | null;
  setQuote: (quote: VideoQuote | null) => void;
  setServerUrl: (url: string) => void;
  setModel: (model: string) => void;
  checkHealth: () => Promise<ServerHealth>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  retryLast: () => Promise<void>;
  clearError: () => void;
  clearChat: () => void;
  updatePlan: (artifactId: string, plan: VideogenPlan) => void;
}

let activeRequest: AbortController | null = null;

export const useServerChatStore = create<ServerChatState>()(
  persist(
    (set, get) => ({
      serverUrl: getServerUrl(),
      model: "",
      health: null,
      checkingHealth: false,
      sessionId: null,
      messages: [],
      plans: [],
      sending: false,
      thinking: null,
      error: null,
      quote: null,

      setQuote: (quote) => set({ quote }),

      setServerUrl: (url) => {
        const serverUrl = saveServerUrl(url);
        set({ serverUrl, health: null, error: null });
      },
      setModel: (model) => set({ model }),
      checkHealth: async () => {
        set({ checkingHealth: true });
        const health = await testServerConnection();
        set({ checkingHealth: false, health });
        return health;
      },
      send: async (text) => {
        const quote = get().quote;
        const message = quote
          ? `请修改成片《${quote.title}》（任务 id: ${quote.jobId}）。\n我的修改要求：${text.trim()}`
          : text.trim();
        if (!message || get().sending) return;
        activeRequest?.abort();
        const controller = new AbortController();
        activeRequest = controller;
        const history = historyFromMessages(get().messages);
        const assistantId = makeId("assistant");
        set((state) => ({
          messages: [
            ...state.messages,
            { id: makeId("user"), role: "user", content: message, createdAt: Date.now() },
            { id: assistantId, role: "assistant", content: "", createdAt: Date.now() },
          ],
          sending: true,
          thinking: "正在思考",
          error: null,
          quote: null,
        }));
        try {
          const stream = streamAgentEvents({
            sessionId: get().sessionId ?? undefined,
            message,
            history,
            model: get().model || undefined,
          }, controller.signal);
          for await (const event of stream) {
            if (event.type === "session") set({ sessionId: event.sessionId });
            if (event.type === "status") {
              set({ thinking: event.status === "done" || event.status === "idle" ? null : event.tool ? `正在执行 ${event.tool}` : "正在思考" });
            }
            if (event.type === "message") appendAssistant(assistantId, event.content, set);
            if (event.type === "tool_result" && (event.name === "propose_videogen_plan" || event.name === "revise_videogen_plan")) {
              const plan = findPlan(event.result);
              if (plan) {
                set((state) => ({ plans: [...state.plans, { id: makeId("plan"), plan, createdAt: Date.now() }] }));
              }
            }
            if (event.type === "error") throw new Error(event.message);
          }
          set((state) => ({
            sending: false,
            thinking: null,
            messages: state.messages.map((item) => item.id === assistantId && !item.content
              ? { ...item, content: "已完成。你可以在下方继续调整创作需求。" }
              : item),
          }));
        } catch (error) {
          if (controller.signal.aborted) return;
          const status = error instanceof ServerApiError ? error.status : undefined;
          set((state) => ({
            sending: false,
            thinking: null,
            error: {
              status,
              message: status === 401 ? "服务器未配置模型密钥(401)" : error instanceof Error ? error.message : "发送失败",
            },
            messages: state.messages.filter((item) => item.id !== assistantId || item.content.length > 0),
          }));
        } finally {
          if (activeRequest === controller) activeRequest = null;
        }
      },
      stop: () => {
        activeRequest?.abort();
        activeRequest = null;
        set({ sending: false, thinking: null });
      },
      retryLast: async () => {
        const last = [...get().messages].reverse().find((item) => item.role === "user");
        if (last) await get().send(last.content);
      },
      clearError: () => set({ error: null }),
      clearChat: () => {
        activeRequest?.abort();
        set({ messages: [], plans: [], sessionId: null, sending: false, thinking: null, error: null, quote: null });
      },
      updatePlan: (artifactId, plan) => set((state) => ({
        plans: state.plans.map((artifact) => artifact.id === artifactId ? { ...artifact, plan } : artifact),
      })),
    }),
    {
      name: "openreel-server-chat",
      // Persist the conversation so reopening the studio restores the full
      // history in chronological order (jobs live server-side already).
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        model: state.model,
        sessionId: state.sessionId,
        messages: state.messages.slice(-200),
        plans: state.plans.slice(-50),
      }),
    },
  ),
);

function historyFromMessages(messages: ServerChatMessage[]): LlmChatMessage[] {
  return messages.filter((item) => item.content.trim()).slice(-20).map((item) => ({
    role: item.role,
    content: item.content,
  }));
}

function appendAssistant(
  id: string,
  content: string,
  set: (updater: (state: ServerChatState) => Partial<ServerChatState>) => void,
): void {
  set((state) => ({
    messages: state.messages.map((item) => item.id === id ? { ...item, content: item.content + content } : item),
  }));
}

function findPlan(value: unknown): VideogenPlan | null {
  if (!value || typeof value !== "object") return null;
  if (isPlan(value)) return value;
  if ("plan" in value) return findPlan(value.plan);
  if ("result" in value) return findPlan(value.result);
  return null;
}

function isPlan(value: object): value is VideogenPlan {
  return "scenes" in value && Array.isArray(value.scenes) && "options" in value && typeof value.options === "object";
}

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
