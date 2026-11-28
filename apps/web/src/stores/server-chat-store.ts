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

export interface ProjectConversation {
  sessionId: string | null;
  messages: ServerChatMessage[];
  plans: PlanArtifact[];
  lastAccessedAt?: number;
}

const MAX_STORED_MESSAGES = 200;
const MAX_STORED_PLANS = 50;
const MAX_STORED_CONVERSATIONS = 12;

interface ServerChatState {
  serverUrl: string;
  model: string;
  /** Creative skills sent with every agent turn; the director skill is on by default. */
  skills: string[];
  toggleSkill: (id: string) => void;
  health: ServerHealth | null;
  checkingHealth: boolean;
  sessionId: string | null;
  messages: ServerChatMessage[];
  plans: PlanArtifact[];
  sending: boolean;
  thinking: string | null;
  error: ServerChatError | null;
  quote: VideoQuote | null;
  projectId: string | null;
  conversations: Record<string, ProjectConversation>;
  setQuote: (quote: VideoQuote | null) => void;
  syncProject: (projectId: string) => void;
  setServerUrl: (url: string) => void;
  setModel: (model: string) => void;
  checkHealth: () => Promise<ServerHealth>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  retryLast: () => Promise<void>;
  clearError: () => void;
  clearChat: () => void;
  /** Reset the conversation and bump a revision so the composer clears its draft. */
  startNewChat: () => void;
  chatRevision: number;
  updatePlan: (artifactId: string, plan: VideogenPlan) => void;
}

let activeRequest: AbortController | null = null;

export const useServerChatStore = create<ServerChatState>()(
  persist(
    (set, get) => ({
      serverUrl: getServerUrl(),
      model: "",
      skills: ["director"],
      health: null,
      checkingHealth: false,
      sessionId: null,
      chatRevision: 0,
      messages: [],
      plans: [],
      sending: false,
      thinking: null,
      error: null,
      quote: null,
      projectId: null,
      conversations: {},

      setQuote: (quote) => set({ quote }),
      syncProject: (projectId) => {
        if (get().projectId === projectId) return;
        activeRequest?.abort();
        activeRequest = null;
        set((state) => {
          const currentId = state.projectId;
          const conversations: Record<string, ProjectConversation> = { ...state.conversations };

          if (currentId !== null) {
            conversations[currentId] = {
              sessionId: state.sessionId,
              messages: state.messages.slice(-MAX_STORED_MESSAGES),
              plans: state.plans.slice(-MAX_STORED_PLANS),
              lastAccessedAt: Date.now(),
            };
          }

          const target = conversations[projectId] ?? {
            sessionId: null,
            messages: [],
            plans: [],
          };

          conversations[projectId] = {
            ...target,
            lastAccessedAt: Date.now(),
          };

          return {
            projectId,
            sessionId: target.sessionId,
            messages: target.messages,
            plans: target.plans,
            sending: false,
            thinking: null,
            error: null,
            quote: null,
            conversations: trimConversations(conversations, MAX_STORED_CONVERSATIONS),
          };
        });
      },

      setServerUrl: (url) => {
        const serverUrl = saveServerUrl(url);
        set({ serverUrl, health: null, error: null });
      },
      setModel: (model) => set({ model }),
      toggleSkill: (id) => set((state) => ({
        skills: state.skills.includes(id)
          ? state.skills.filter((skill) => skill !== id)
          : [...state.skills, id],
      })),
      checkHealth: async () => {
        set({ checkingHealth: true });
        const health = await testServerConnection();
        set({ checkingHealth: false, health });
        return health;
      },
      send: async (text) => {
        const quote = get().quote;
        const message = quote
          ? `请修改演示成片《${quote.title}》（任务 id: ${quote.jobId}）。\n我的修改要求：${text.trim()}`
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
            skills: get().skills,
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
        set((state) => {
          const conversations = { ...state.conversations };
          if (state.projectId !== null) {
            delete conversations[state.projectId];
          }
          return {
            messages: [],
            plans: [],
            sessionId: null,
            sending: false,
            thinking: null,
            error: null,
            quote: null,
            conversations,
          };
        });
      },
      startNewChat: () => {
        activeRequest?.abort();
        set((state) => {
          const conversations = { ...state.conversations };
          if (state.projectId !== null) delete conversations[state.projectId];
          return {
            messages: [],
            plans: [],
            sessionId: null,
            sending: false,
            thinking: null,
            error: null,
            quote: null,
            conversations,
            chatRevision: state.chatRevision + 1,
          };
        });
      },
      updatePlan: (artifactId, plan) => set((state) => ({
        plans: state.plans.map((artifact) => artifact.id === artifactId ? { ...artifact, plan } : artifact),
      })),
    }),
    {
      name: "openreel-server-chat",
      // Persist the active conversation plus a capped map of per-project
      // conversations so switching back to a previous project restores its chat.
      partialize: (state) => {
        const conversations: Record<string, ProjectConversation> = {};
        for (const [projectId, conversation] of Object.entries(state.conversations)) {
          conversations[projectId] = {
            sessionId: conversation.sessionId,
            messages: conversation.messages.slice(-MAX_STORED_MESSAGES),
            plans: conversation.plans.slice(-MAX_STORED_PLANS),
            lastAccessedAt: conversation.lastAccessedAt,
          };
        }
        return {
          serverUrl: state.serverUrl,
          model: state.model,
          skills: state.skills,
          projectId: state.projectId,
          sessionId: state.sessionId,
          messages: state.messages.slice(-MAX_STORED_MESSAGES),
          plans: state.plans.slice(-MAX_STORED_PLANS),
          conversations: trimConversations(conversations, MAX_STORED_CONVERSATIONS),
        };
      },
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

function trimConversations(
  conversations: Record<string, ProjectConversation>,
  max: number,
): Record<string, ProjectConversation> {
  const entries = Object.entries(conversations);
  if (entries.length <= max) {
    return Object.fromEntries(entries);
  }
  const sorted = entries.sort((a, b) => (b[1].lastAccessedAt ?? 0) - (a[1].lastAccessedAt ?? 0));
  return Object.fromEntries(sorted.slice(0, max));
}
