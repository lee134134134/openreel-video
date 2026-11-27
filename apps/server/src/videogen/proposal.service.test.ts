import { afterEach, describe, expect, it } from "vitest";
import type { OpencodeClient } from "../llm/opencode.client";
import { extractPlanJson, fallbackPlan, ProposalService, validatePlan } from "./proposal.service";

const originalKey = process.env.OPENCODE_API_KEY;
afterEach(() => { process.env.OPENCODE_API_KEY = originalKey; });

function validPlan(count: number): Record<string, unknown> {
  return {
    options: { title: "测试", aspectRatio: "9:16", fps: 30, resolution: 720 },
    scenes: Array.from({ length: count }, (_, index) => ({
      index, narration: `场景${index}`, durationSec: 90, visualPrompt: "card",
    })),
  };
}

describe("videogen proposal", () => {
  it("extracts fenced JSON and clamps count/durations", () => {
    const parsed = extractPlanJson(`前置\n\`\`\`json\n${JSON.stringify(validPlan(15))}\n\`\`\``);
    const plan = validatePlan(parsed, { brief: "测试", sceneCount: 15 });
    expect(plan.scenes.length).toBeLessThanOrEqual(12);
    expect(plan.estimatedDurationSec).toBeLessThanOrEqual(300);
    expect(plan.scenes.every((scene) => scene.durationSec >= 2 && scene.durationSec <= 60)).toBe(true);
    expect(plan.options.aspectRatio).toBe("9:16");
  });

  it("salvages scene details from malformed LLM JSON instead of a generic card", async () => {
    process.env.OPENCODE_API_KEY = "test";
    const broken = `{"options":{"title":"窗边的猫"},"scenes":[{"index":0,"narration":"猫在晒太阳","subtitle":"猫在晒太阳","durationSec":5,"visualPrompt":"中景镜头，暖黄侧光","motion":"static","emotion":"calm"}, oops {"index":1,"narration":"它闭上眼睛","durationSec":4,"visualPrompt":"特写，柔和轮廓光","motion":"static","emotion":"calm"}]}`;
    const client = { complete: async () => ({ content: broken }) } as unknown as OpencodeClient;
    const plan = await new ProposalService(client).proposePlan({ brief: "猫", sceneCount: 2 });
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes[0].narration).toBe("猫在晒太阳");
    expect(plan.scenes[0].visualPrompt).toBe("中景镜头，暖黄侧光");
    expect(plan.scenes[1].visualPrompt).toBe("特写，柔和轮廓光");
  });

  it("falls back deterministically when the LLM fails", async () => {
    process.env.OPENCODE_API_KEY = "test";
    const client = { complete: async () => { throw new Error("offline"); } } as unknown as OpencodeClient;
    const plan = await new ProposalService(client).proposePlan({ brief: "离线短视频", sceneCount: 4 });
    expect(plan).toEqual(fallbackPlan({ brief: "离线短视频", sceneCount: 4 }));
    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0].narration).toBe("离线短视频");
  });

  it("does not require network when no gateway key is configured", async () => {
    delete process.env.OPENCODE_API_KEY;
    const client = { complete: async () => { throw new Error("must not be called"); } } as unknown as OpencodeClient;
    const plan = await new ProposalService(client).proposePlan({ brief: "无密钥", sceneCount: 2 });
    expect(plan.options.ttsVoiceId).toBe("mock");
    expect(plan.scenes).toHaveLength(1);
  });

  it("requires continuous motion and captures director motion notes", () => {
    const plan = validatePlan({
      options: {},
      scenes: [
        { index: 0, narration: "a", durationSec: 6, visualPrompt: "v", motionDescription: "主体走动，镜头侧跟", requiresVideo: true },
        { index: 1, narration: "b", durationSec: 6, visualPrompt: "v", motion: "pan-left" },
      ],
    }, { brief: "测试" });
    expect(plan.scenes[0].motion).toBe("dynamic");
    expect(plan.scenes[0].motionDescription).toBe("主体走动，镜头侧跟");
    expect(plan.scenes[0].requiresVideo).toBe(true);
    expect(plan.scenes[1].motion).toBe("pan-left");
    expect(fallbackPlan({ brief: "离线" }).scenes[0].motion).toBe("dynamic");
  });

  it("keeps whitelisted emotion styles and drops unknown ones", () => {
    const plan = {
      options: {},
      scenes: [
        { index: 0, narration: "a", durationSec: 6, visualPrompt: "v", emotion: " Cheerful " },
        { index: 1, narration: "b", durationSec: 6, visualPrompt: "v", emotion: "not-a-style" },
        { index: 2, narration: "c", durationSec: 6, visualPrompt: "v", emotion: "newscast" },
      ],
    };
    const result = validatePlan(plan, { brief: "测试" });
    expect(result.scenes[0].emotion).toBe("cheerful");
    expect(result.scenes[1].emotion).toBeUndefined();
    expect(result.scenes[2].emotion).toBe("newscast");
  });
});
