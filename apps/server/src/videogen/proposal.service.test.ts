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
});
