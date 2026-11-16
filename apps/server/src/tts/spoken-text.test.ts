import { describe, expect, it } from "vitest";
import { toSpokenNarration } from "./spoken-text";

describe("toSpokenNarration", () => {
  it("returns empty for empty input", () => {
    expect(toSpokenNarration("")).toBe("");
    expect(toSpokenNarration("   \n  ")).toBe("");
  });

  it("strips markdown remnants", () => {
    expect(toSpokenNarration("# 标题\n**重点内容**，快看")).toBe("标题，重点内容，快看。");
    expect(toSpokenNarration("`配置`很简单")).toBe("配置很简单。");
  });

  it("strips URLs", () => {
    expect(toSpokenNarration("详情见 https://example.com/a?b=1 再见")).toBe("详情见 再见。");
  });

  it("strips annotation parentheticals but keeps real speech", () => {
    expect(toSpokenNarration("这款相机（型号 A2）很轻")).toBe("这款相机很轻。");
    // Parenthetical containing sentence punctuation reads as dialogue: keep.
    expect(toSpokenNarration("他说（这太棒了！）然后走了")).toBe("他说（这太棒了！）然后走了。");
  });

  it("strips wrapping quotes", () => {
    expect(toSpokenNarration("「开头的一句话」")).toBe("开头的一句话。");
  });

  it("adds terminal punctuation", () => {
    expect(toSpokenNarration("今天天气不错")).toBe("今天天气不错。");
    expect(toSpokenNarration("真的吗？")).toBe("真的吗？");
  });

  it("joins multi-line narration without double punctuation", () => {
    expect(toSpokenNarration("第一句。\n第二句")).toBe("第一句。第二句。");
    expect(toSpokenNarration("第一句\n第二句")).toBe("第一句，第二句。");
  });

  it("splits overly long unpunctuated sentences at a connective", () => {
    const long = "这款相机非常轻便适合旅行使用而且画质表现也相当出色防抖性能也值得一提续航更是一整天无忧值得推荐给每一个热爱记录生活的人";
    const result = toSpokenNarration(long);
    expect(result).toContain("使用，而且");
    expect(result.split("，").length - 1).toBe(1);
    expect(result.endsWith("。")).toBe(true);
  });

  it("splits long sentences away from latin word boundaries", () => {
    const long = "OpenReel支持4K分辨率实时导出同时也支持多轨道时间线编辑实时预览和AI智能字幕生成功能非常强大值得深入体验建议大家都来试试";
    const result = toSpokenNarration(long);
    const [before] = result.split("，");
    expect(before.endsWith("4K")).toBe(false);
    expect(result).toContain("，");
  });

  it("is idempotent", () => {
    const sample = "# 产品介绍\n**这款相机**（型号 A2）非常轻便，适合旅行使用 https://example.com";
    const once = toSpokenNarration(sample);
    expect(toSpokenNarration(once)).toBe(once);
  });
});
