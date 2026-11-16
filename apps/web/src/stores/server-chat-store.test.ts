import { describe, it, expect, beforeEach, vi } from "vitest";
import type { VideogenPlan } from "@openreel/plugin-sdk";

vi.mock("../services/server-ai/api", () => ({
  getServerUrl: () => "http://localhost:4000",
  setServerUrl: (url: string) => url,
  testServerConnection: vi.fn(async () => ({ ok: true })),
  ServerApiError: class ServerApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = "ServerApiError";
    }
  },
}));

vi.mock("../services/server-ai/sse", () => ({
  streamAgentEvents: vi.fn(async function* () {
    yield { type: "done" };
  }),
}));

import { useServerChatStore } from "./server-chat-store";

const store = () => useServerChatStore.getState();

const samplePlan: VideogenPlan = {
  options: { title: "t", aspectRatio: "9:16", fps: 30, resolution: 720 },
  scenes: [],
  estimatedDurationSec: 0,
};

describe("server-chat-store", () => {
  beforeEach(() => {
    localStorage.clear();
    useServerChatStore.setState({
      projectId: null,
      sessionId: null,
      messages: [],
      plans: [],
      conversations: {},
      sending: false,
      thinking: null,
      error: null,
      quote: null,
    });
    store().syncProject("");
    vi.clearAllMocks();
  });

  it("keeps seeded state when the project has not changed", () => {
    useServerChatStore.setState({
      projectId: "p1",
      messages: [{ id: "m1", role: "user", content: "hello", createdAt: 1 }],
      plans: [{ id: "plan-1", plan: samplePlan, createdAt: 1 }],
      sessionId: "s1",
      quote: { jobId: "j1", title: "quote" },
    });

    store().syncProject("p1");

    expect(store().projectId).toBe("p1");
    expect(store().messages).toHaveLength(1);
    expect(store().plans).toHaveLength(1);
    expect(store().sessionId).toBe("s1");
    expect(store().quote).toEqual({ jobId: "j1", title: "quote" });
  });

  it("clears chat state when switching to a new project and stashes the previous one", () => {
    useServerChatStore.setState({
      projectId: "p1",
      messages: [{ id: "m1", role: "user", content: "hello", createdAt: 1 }],
      plans: [{ id: "plan-1", plan: samplePlan, createdAt: 1 }],
      sessionId: "s1",
      sending: true,
      thinking: "thinking",
      error: { message: "error" },
      quote: { jobId: "j1", title: "quote" },
    });

    store().syncProject("p2");

    expect(store().projectId).toBe("p2");
    expect(store().messages).toHaveLength(0);
    expect(store().plans).toHaveLength(0);
    expect(store().sessionId).toBeNull();
    expect(store().sending).toBe(false);
    expect(store().thinking).toBeNull();
    expect(store().error).toBeNull();
    expect(store().quote).toBeNull();

    expect(store().conversations.p1).toEqual(expect.objectContaining({
      sessionId: "s1",
      messages: [{ id: "m1", role: "user", content: "hello", createdAt: 1 }],
      plans: [{ id: "plan-1", plan: samplePlan, createdAt: 1 }],
    }));
  });

  it("preserves messages, plans and sessionId when switching A -> B -> A", () => {
    useServerChatStore.setState({
      projectId: "pA",
      messages: [{ id: "mA", role: "user", content: "hello A", createdAt: 1 }],
      plans: [{ id: "plan-A", plan: samplePlan, createdAt: 1 }],
      sessionId: "sA",
    });

    store().syncProject("pB");
    expect(store().projectId).toBe("pB");
    expect(store().messages).toHaveLength(0);

    store().syncProject("pA");
    expect(store().projectId).toBe("pA");
    expect(store().messages).toEqual([{ id: "mA", role: "user", content: "hello A", createdAt: 1 }]);
    expect(store().plans).toEqual([{ id: "plan-A", plan: samplePlan, createdAt: 1 }]);
    expect(store().sessionId).toBe("sA");
  });

  it("clearChat wipes the active conversation and deletes the current project's stash", () => {
    useServerChatStore.setState({
      projectId: "pA",
      messages: [{ id: "mA", role: "user", content: "hello A", createdAt: 1 }],
      plans: [{ id: "plan-A", plan: samplePlan, createdAt: 1 }],
      sessionId: "sA",
    });
    store().syncProject("pB");

    store().syncProject("pA");
    expect(store().conversations.pA).toBeDefined();

    store().clearChat();

    expect(store().messages).toHaveLength(0);
    expect(store().plans).toHaveLength(0);
    expect(store().sessionId).toBeNull();
    expect(store().conversations.pA).toBeUndefined();
  });

  it("caps stored conversations, messages and plans", async () => {
    useServerChatStore.setState({
      projectId: "p-old",
      messages: Array.from({ length: 205 }, (_, i) => ({
        id: `m-${i}`,
        role: "user" as const,
        content: `msg-${i}`,
        createdAt: i,
      })),
      plans: Array.from({ length: 55 }, (_, i) => ({
        id: `plan-${i}`,
        plan: samplePlan,
        createdAt: i,
      })),
    });

    store().syncProject("p-capped");

    expect(store().conversations["p-old"].messages).toHaveLength(200);
    expect(store().conversations["p-old"].messages[0].content).toBe("msg-5");
    expect(store().conversations["p-old"].plans).toHaveLength(50);
    expect(store().conversations["p-old"].plans[0].id).toBe("plan-5");

    useServerChatStore.setState({ messages: [], plans: [], conversations: {} });

    // Create 13 projects sequentially so the oldest ones can be evicted.
    for (let i = 0; i < 13; i++) {
      store().syncProject(`p${i}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const conversationKeys = Object.keys(store().conversations);
    expect(conversationKeys.length).toBeLessThanOrEqual(12);
    expect(store().conversations.p0).toBeUndefined();
    expect(store().conversations.p12).toBeDefined();
  });
});
