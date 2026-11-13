import { describe, expect, it } from "vitest";
import { DEFAULT_TITLE_STYLE, TEXT_STYLE_PRESETS } from "./AssetsPanel";

describe("editor text presets", () => {
  it("starts the primary title at a shader-friendly display scale", () => {
    expect(DEFAULT_TITLE_STYLE.fontSize).toBeGreaterThanOrEqual(96);
    expect(DEFAULT_TITLE_STYLE.fontWeight).toBe(800);
  });

  it("offers distinct title, editorial, outline, and utility treatments", () => {
    expect(TEXT_STYLE_PRESETS.map((preset) => preset.name)).toEqual([
      "大标题",
      "副标题",
      "字幕条",
      "字幕",
      "主视觉",
      "引言",
      "描边字",
      "徽章",
    ]);
    expect(new Set(TEXT_STYLE_PRESETS.map((preset) => preset.style.fontSize)).size)
      .toBeGreaterThanOrEqual(6);
  });
});
