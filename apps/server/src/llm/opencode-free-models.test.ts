import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isFreeModel,
  OPENCODE_GO_URL,
  OPENCODE_PERSONAL_URL,
  pickFreeModel,
  resolveOpencodeAccounts,
} from "./opencode-free-models";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opencode free model discovery", () => {
  it("detects and prefers free model ids", () => {
    expect(isFreeModel("deepseek-v4.1-flash-free")).toBe(true);
    expect(isFreeModel("gemini-4-neon")).toBe(false);
    expect(pickFreeModel(["gemini-4-neon", "hy4-flash-free", "beam-free"])).toBe("hy4-flash-free");
    expect(pickFreeModel(["beam-free", "hy4-flash-free"], "beam-free")).toBe("beam-free");
  });

  it("connects Go as primary and personal as fallback with free models", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      const models = url.includes("/go/")
        ? [{ id: "deepseek-v4.1-flash" }, { id: "hy4-flash-free" }]
        : [{ id: "deepseek-v4.1-flash-free" }, { id: "gpt-6.2-sol" }];
      return new Response(JSON.stringify({ data: models }), { status: 200 });
    }));

    const resolved = await resolveOpencodeAccounts({
      baseUrl: OPENCODE_PERSONAL_URL,
      apiKey: "test-key",
      model: "old-model",
    });

    expect(resolved.baseUrl).toBe(OPENCODE_GO_URL);
    expect(resolved.model).toBe("hy4-flash-free");
    expect(resolved.fallback?.baseUrl).toBe(OPENCODE_PERSONAL_URL);
    expect(resolved.fallback?.model).toBe("deepseek-v4.1-flash-free");
  });
});
