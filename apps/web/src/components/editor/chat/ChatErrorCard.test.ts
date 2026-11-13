import { describe, expect, it } from "vitest";
import { formatChatError } from "./ChatErrorCard";

describe("formatChatError", () => {
  it("extracts a useful provider message from a raw JSON error", () => {
    expect(
      formatChatError(
        'openai-compatible 401: {"error":{"message":"The API key is invalid"}}',
      ),
    ).toMatchObject({
      title: "鉴权失败",
      message: "The API key is invalid",
      action: "ai-editor",
    });
  });

  it("turns network and CORS failures into endpoint guidance", () => {
    expect(
      formatChatError(
        "Could not reach the compatible endpoint. Check browser CORS settings.",
      ),
    ).toMatchObject({
      title: "无法连接接口",
      action: "ai-editor",
    });
  });

  it("offers a new chat when the context window is exhausted", () => {
    expect(formatChatError("maximum context length exceeded")).toMatchObject({
      title: "对话过长",
      action: "new-chat",
    });
  });

  it("keeps an unknown error readable", () => {
    expect(formatChatError("provider unavailable")).toEqual({
      title: "AI request failed",
      message: "provider unavailable",
      action: null,
      details: undefined,
    });
  });
});
