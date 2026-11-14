import { create } from "zustand";
import {
  runTurn,
} from "@openreel/agent";
import type {
  AgentEvent,
  ConfirmDecision,
  ToolCall,
  ToolResult,
  LoopMessage,
} from "@openreel/agent";
import { runExclusive } from "../services/agent/host-singleton";
import { makeDirectBYOKClient, validateAIEndpoint } from "../services/agent/direct-llm-transport";
import { EditingSession } from "../services/agent/editing-session";
import { editingToolDefs, editingToolReadOnly, executeEditingTool, EDITING_SYSTEM } from "../services/agent/editing-tools";
import { useAIConnectionStore } from "./ai-connection-store";
import {
  conversationTitle,
  useChatHistoryStore,
} from "./chat-history-store";
import { useSettingsStore } from "./settings-store";
import { useProjectStore } from "./project-store";

export type ChatStatus = "idle" | "running" | "awaiting_confirm" | "error";

export type ToolCallStatus = "running" | "done" | "error" | "rejected" | "retrying" | "corrected";

export interface ToolCallView {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly result?: ToolResult;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly toolCalls: ToolCallView[];
  readonly notice?: string;
}

interface PendingConfirm {
  readonly call: ToolCall;
  readonly resolve: (decision: ConfirmDecision) => void;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface ChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  conversation: LoopMessage[];
  pendingConfirm: PendingConfirm | null;
  error: string | null;
  abortController: AbortController | null;
  lastTurnCommitted: boolean;
  lastTurnUndoSize: number | null;
  lastTurnActionId: string | null;
  usage: TokenUsage;
  projectId: string | null;
  currentConversationId: string | null;
  conversationStartedAt: number | null;

  send: (text: string) => Promise<void>;
  resolveConfirm: (decision: ConfirmDecision) => void;
  stop: () => void;
  undoLastTurn: () => Promise<void>;
  clearError: () => void;
  setProjectContext: (projectId: string | null) => void;
  newChat: () => void;
  openConversation: (conversationId: string) => void;
  deleteConversation: (conversationId: string) => void;
  reset: () => void;
}

const genId = (): string =>
  (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto
    ?.randomUUID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Monotonic turn id: a completion whose seq is stale (reset/superseded) must not
// write back into the store.
let activeSeq = 0;

function undoStackSize(): number | null {
  try {
    return useProjectStore.getState().actionExecutor.getHistory().getUndoStackSize();
  } catch {
    return null;
  }
}

function conversationFromMessages(messages: ChatMessage[]): LoopMessage[] {
  return messages.flatMap((message): LoopMessage[] => {
    if (!message.text.trim()) return [];
    return message.role === "user"
      ? [{ role: "user", content: message.text }]
      : [{ role: "assistant", content: message.text, toolUses: [] }];
  });
}

function saveConversationSnapshot(state: ChatState): void {
  if (
    !state.currentConversationId ||
    !state.projectId ||
    !state.messages.some((message) => message.role === "user")
  ) {
    return;
  }
  const now = Date.now();
  useChatHistoryStore.getState().saveConversation({
    id: state.currentConversationId,
    projectId: state.projectId,
    title: conversationTitle(state.messages),
    createdAt: state.conversationStartedAt ?? now,
    updatedAt: now,
    messages: state.messages,
    usage: state.usage,
    error: state.error ?? undefined,
  });
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  status: "idle",
  conversation: [],
  pendingConfirm: null,
  error: null,
  abortController: null,
  lastTurnCommitted: false,
  lastTurnUndoSize: null, lastTurnActionId: null,
  usage: { inputTokens: 0, outputTokens: 0 },
  projectId: null,
  currentConversationId: null,
  conversationStartedAt: null,

  send: async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = get();
    if (current.status === "running" || current.status === "awaiting_confirm") {
      return;
    }
    if (!useProjectStore.getState().hasOpenProject) {
      set({ error: "请先打开或创建项目再进行对话。" });
      return;
    }

    const projectState = useProjectStore.getState();
    const currentProjectId = projectState.project?.id ?? null;
    if (current.projectId && currentProjectId && current.projectId !== currentProjectId) {
      get().setProjectContext(currentProjectId);
    }

    const { provider, model, baseUrl: inputBaseUrl, apiKey } = useAIConnectionStore.getState();
    if (!["openai", "anthropic", "compatible"].includes(provider)) { set({ error: "请在设置 → AI 编辑器中选择 API 格式。" }); return; }
    if (!model.trim()) { set({ error: "请在设置 → AI 编辑器中输入模型 ID。" }); return; }
    let baseUrl: string;
    try { baseUrl = validateAIEndpoint(inputBaseUrl); } catch { set({ error: "请输入有效的 HTTPS 端点，或 localhost 上的 HTTP。" }); return; }
    if (provider !== "compatible" && !apiKey) {
      set({
        error: "发送编辑请求前，请在设置 → AI 编辑器中添加会话 API 密钥。",
      });
      return;
    }

    const active = get();
    const conversationId = active.currentConversationId ?? genId();
    const conversationStartedAt = active.conversationStartedAt ?? Date.now();
    const userMessage: ChatMessage = {
      id: genId(),
      role: "user",
      text: trimmed,
      toolCalls: [],
    };
    const assistantMessage: ChatMessage = {
      id: genId(),
      role: "assistant",
      text: "",
      toolCalls: [],
    };
    const assistantId = assistantMessage.id;
    const controller = new AbortController();
    const seq = ++activeSeq;

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      conversation: [...state.conversation, { role: "user", content: trimmed }],
      status: "running",
      error: null,
      abortController: controller,
      pendingConfirm: null,
      projectId: currentProjectId,
      currentConversationId: conversationId,
      conversationStartedAt,
    }));

    const updateAssistant = (fn: (m: ChatMessage) => ChatMessage): void => {
      if (activeSeq !== seq) return;
      set((state) => ({
        messages: state.messages.map((m) => (m.id === assistantId ? fn(m) : m)),
      }));
    };

    const onEvent = (event: AgentEvent): void => {
      switch (event.type) {
        case "text_delta":
        case "turn_complete":
          updateAssistant((m) => ({ ...m, text: event.text || m.text }));
          break;
        case "tool_call":
          updateAssistant((m) => ({
            ...m,
            toolCalls: [
              ...m.toolCalls,
              {
                id: event.call.id,
                name: event.call.name,
                args: event.call.args,
                status: "running",
              },
            ],
          }));
          break;
        case "tool_result":
          updateAssistant((m) => ({
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === event.call.id
                ? {
                    ...tc,
                    result: event.result,
                    status: event.result.ok
                      ? "done"
                      : event.result.error?.code === "REJECTED"
                        ? "rejected"
                        : event.result.error?.recoverable && event.result.error.retryOf
                          ? "retrying"
                          : "error",
                  }
                : tc,
            ),
          }));
          break;
        case "tool_recovered":
          updateAssistant((m) => ({ ...m, toolCalls: m.toolCalls.map((tc) => event.callIds.includes(tc.id) ? { ...tc, status: "corrected" } : tc) }));
          break;
        case "error":
          if (activeSeq === seq) set({ error: event.error.message });
          break;
        case "awaiting_confirmation":
          break;
      }
    };

    const host = new EditingSession(controller.signal);
    let llm;
    try { llm = makeDirectBYOKClient({
      provider,
      model,
      baseUrl,
      apiKey,
      signal: controller.signal,
    }); } catch (error) {
      set({ status: "error", error: error instanceof Error ? error.message : "连接设置无效", abortController: null });
      return;
    }
    const tools = editingToolDefs(provider === "anthropic" ? "anthropic" : "openai");
    const autoConfirm = useSettingsStore.getState().agentAutoConfirm;
    const dryRun = useSettingsStore.getState().agentDryRun;

    let result;
    try { result = await runExclusive(() =>
      runTurn({
        host,
        llm,
        tools,
        system: EDITING_SYSTEM,
        messages: get().conversation,
        execute: executeEditingTool,
        readOnly: editingToolReadOnly,
        atomic: true,
        signal: controller.signal,
        dryRun,
        confirmGate: autoConfirm
          ? () => "approve_for_turn"
          : (call) =>
              new Promise<ConfirmDecision>((resolve) => {
                if (controller.signal.aborted) { resolve("reject"); return; }
                set({ status: "awaiting_confirm", pendingConfirm: { call, resolve } });
              }),
        onEvent,
        turnLabel: "AI 编辑",
      }),
    );
    } catch (error) {
      if (activeSeq !== seq) return;
      set({ status: controller.signal.aborted ? "idle" : "error", error: controller.signal.aborted ? null : error instanceof Error ? error.message : "AI 回合失败。", abortController: null, pendingConfirm: null, conversation: [] });
      saveConversationSnapshot(get()); return;
    }

    // A reset() (or a newer turn) during the run supersedes this completion.
    if (activeSeq !== seq) return;
    const wasAborted = controller.signal.aborted;
    const stopNotice =
      result.stoppedReason === "max_steps"
        ? "本回合达到步数上限，我已停止。如需继续，请让我继续。"
        : result.stoppedReason === "max_tool_calls"
          ? "本回合达到工具调用次数上限，我已停止。如需继续，请让我继续。"
          : result.stoppedReason === "budget"
            ? "模型达到响应或 token 上限而停止。请让我继续，或提高模型的输出上限。"
            : undefined;
    set((state) => ({
      messages: state.messages.map((message) => {
        if (message.id !== assistantId) return message;
        const finalText = wasAborted ? "已取消。待处理的编辑已丢弃。" : !result.committed ? "回合失败。未应用任何编辑。" : result.text || message.text;
        const emptyNotice =
          !finalText && result.stoppedReason === "end_turn"
            ? message.toolCalls.length > 0
              ? "编辑已完成，但模型未提供文字总结。"
              : "模型返回了空响应。请重试或选择其他模型。"
            : undefined;
        return {
          ...message,
          text: finalText,
          notice: stopNotice ?? emptyNotice,
          toolCalls: message.toolCalls.map((tc) => !result.committed && tc.status === "retrying" ? { ...tc, status: "error" } : tc),
        };
      }),
      conversation: result.committed ? result.messages : [],
      status: wasAborted
        ? "idle"
        : result.stoppedReason === "error"
          ? "error"
          : "idle",
      lastTurnCommitted: result.committed && host.committed,
      lastTurnUndoSize: result.committed && host.committed ? undoStackSize() : null,
      lastTurnActionId: result.committed && host.committed ? useProjectStore.getState().actionExecutor.getHistory().peekUndo?.()?.action.id ?? null : null,
      abortController: null,
      pendingConfirm: null,
      usage: {
        inputTokens: state.usage.inputTokens + result.usage.inputTokens,
        outputTokens: state.usage.outputTokens + result.usage.outputTokens,
      },
      error: wasAborted
        ? null
        : result.stoppedReason === "error"
          ? (state.error ?? "AI 回合失败。")
          : state.error,
    }));
    saveConversationSnapshot(get());
  },

  resolveConfirm: (decision: ConfirmDecision) => {
    const pending = get().pendingConfirm;
    if (!pending) return;
    set({ pendingConfirm: null, status: "running" });
    pending.resolve(decision);
  },

  stop: () => {
    const { abortController, pendingConfirm } = get();
    pendingConfirm?.resolve("reject");
    abortController?.abort();
    set({ pendingConfirm: null });
  },

  undoLastTurn: async () => {
    if (!get().lastTurnCommitted) return;
    // If the project's undo stack moved since the turn committed, a later edit
    // is on top — undoing it would hit the wrong action, so just drop the
    // affordance rather than clobber the user's edit.
    const checkpoint = get().lastTurnUndoSize;
    const actionId = get().lastTurnActionId;
    if (checkpoint !== null && undoStackSize() !== checkpoint || actionId !== null && useProjectStore.getState().actionExecutor.getHistory().peekUndo?.()?.action.id !== actionId) {
      set({ lastTurnCommitted: false, lastTurnUndoSize: null });
      return;
    }
    await useProjectStore.getState().undo();
    set({ lastTurnCommitted: false, lastTurnUndoSize: null });
  },

  clearError: () => set({ error: null }),

  setProjectContext: (projectId: string | null) => {
    const state = get();
    if (state.projectId === projectId) return;
    if (state.projectId !== null && (state.messages.length > 0 || state.conversation.length > 0)) {
      saveConversationSnapshot(state);
    }
    state.pendingConfirm?.resolve("reject");
    state.abortController?.abort();
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      projectId,
      currentConversationId: null,
      conversationStartedAt: null,
    });
  },

  newChat: () => {
    const state = get();
    if (state.status === "running" || state.status === "awaiting_confirm") return;
    saveConversationSnapshot(state);
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      currentConversationId: null,
      conversationStartedAt: null,
    });
  },

  openConversation: (conversationId: string) => {
    const state = get();
    if (state.status === "running" || state.status === "awaiting_confirm") return;
    const saved = useChatHistoryStore
      .getState()
      .conversations.find((item) => item.id === conversationId);
    if (!saved || (state.projectId && saved.projectId !== state.projectId)) return;
    if (state.currentConversationId !== conversationId) {
      saveConversationSnapshot(state);
    }
    activeSeq++;
    set({
      messages: saved.messages,
      conversation: conversationFromMessages(saved.messages),
      status: "idle",
      pendingConfirm: null,
      error: saved.error ?? null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: saved.usage,
      projectId: saved.projectId,
      currentConversationId: saved.id,
      conversationStartedAt: saved.createdAt,
    });
  },

  deleteConversation: (conversationId: string) => {
    useChatHistoryStore.getState().deleteConversation(conversationId);
    if (get().currentConversationId !== conversationId) return;
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      currentConversationId: null,
      conversationStartedAt: null,
    });
  },

  reset: () => {
    get().pendingConfirm?.resolve("reject");
    get().abortController?.abort();
    // Supersede any in-flight turn so its completion can't write back.
    activeSeq++;
    set({
      messages: [],
      conversation: [],
      status: "idle",
      pendingConfirm: null,
      error: null,
      abortController: null,
      lastTurnCommitted: false,
      lastTurnUndoSize: null, lastTurnActionId: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      projectId: null,
      currentConversationId: null,
      conversationStartedAt: null,
    });
  },
}));
