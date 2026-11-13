import { Injectable, Logger } from "@nestjs/common";
import type { GenerateVideogenPlanArgs, VideogenAspectRatio, VideogenPlan, VideogenScenePlan } from "@openreel/plugin-sdk";
import { OpencodeClient } from "../llm/opencode.client";

export interface ProposePlanInput {
  brief: string;
  sceneCount?: number;
  aspectRatio?: VideogenAspectRatio;
  styleHint?: string;
  language?: string;
}

const RATIOS: VideogenAspectRatio[] = ["16:9", "9:16", "1:1", "4:5"];
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function extractPlanJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? content.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("LLM 响应中没有 JSON 计划");
  return JSON.parse(candidate) as unknown;
}

export function validatePlan(value: unknown, request: ProposePlanInput): VideogenPlan {
  if (!value || typeof value !== "object") throw new Error("视频计划必须是对象");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.scenes) || !raw.scenes.length) throw new Error("视频计划缺少 scenes");
  const rawOptions = (raw.options ?? {}) as Record<string, unknown>;
  const ratio = RATIOS.includes(rawOptions.aspectRatio as VideogenAspectRatio)
    ? rawOptions.aspectRatio as VideogenAspectRatio
    : request.aspectRatio ?? "16:9";
  const wanted = clamp(Math.round(request.sceneCount ?? raw.scenes.length), 1, 12);
  const scenes: VideogenScenePlan[] = [];
  let total = 0;
  for (const [position, entry] of raw.scenes.slice(0, wanted).entries()) {
    if (total >= 300) break;
    const item = (entry ?? {}) as Record<string, unknown>;
    const narration = String(item.narration ?? "").trim() || request.brief;
    let durationSec = clamp(Number(item.durationSec) || 6, 2, 60);
    durationSec = Math.min(durationSec, 300 - total);
    if (durationSec < 2) break;
    scenes.push({
      index: position,
      narration,
      subtitle: item.subtitle ? String(item.subtitle) : narration,
      durationSec,
      visualPrompt: String(item.visualPrompt ?? "").trim() || `${request.styleHint ?? "professional cinematic"}, ${narration}`,
      motion: ["zoom-in", "zoom-out", "pan-left", "pan-right", "static"].includes(String(item.motion))
        ? item.motion as VideogenScenePlan["motion"]
        : "static",
    });
    total += durationSec;
  }
  if (!scenes.length) throw new Error("视频计划没有有效场景");
  const fps = [24, 30, 60].includes(Number(rawOptions.fps)) ? Number(rawOptions.fps) as 24 | 30 | 60 : 30;
  const resolution = [720, 1080, 2160].includes(Number(rawOptions.resolution))
    ? Number(rawOptions.resolution) as 720 | 1080 | 2160
    : 720;
  return {
    options: {
      title: String(rawOptions.title ?? request.brief).slice(0, 120) || "未命名视频",
      aspectRatio: ratio,
      fps,
      resolution,
      language: String(rawOptions.language ?? request.language ?? "zh-CN"),
      ttsVoiceId: rawOptions.ttsVoiceId ? String(rawOptions.ttsVoiceId) : undefined,
      accentColorHex: rawOptions.accentColorHex ? String(rawOptions.accentColorHex) : "#8b8bd8",
    },
    scenes,
    estimatedDurationSec: Number(total.toFixed(3)),
  };
}

export function fallbackPlan(request: ProposePlanInput): VideogenPlan {
  const brief = request.brief.trim() || "未命名短视频";
  const durationSec = clamp(brief.length * 0.09, 2, 60);
  return {
    options: {
      title: brief.slice(0, 120),
      aspectRatio: request.aspectRatio ?? "16:9",
      fps: 30,
      resolution: 720,
      language: request.language ?? "zh-CN",
      ttsVoiceId: "mock",
      accentColorHex: "#8b8bd8",
    },
    scenes: [{
      index: 0,
      narration: brief,
      subtitle: brief,
      durationSec,
      visualPrompt: `${request.styleHint ?? "简洁专业的淡紫色视觉卡片"}: ${brief}`,
      motion: "static",
    }],
    estimatedDurationSec: durationSec,
  };
}

@Injectable()
export class ProposalService {
  private readonly logger = new Logger(ProposalService.name);

  constructor(private readonly client: OpencodeClient) {}

  async proposePlan(input: ProposePlanInput | GenerateVideogenPlanArgs): Promise<VideogenPlan> {
    const request: ProposePlanInput = { ...input, brief: String(input.brief ?? "").trim() };
    if (!request.brief) throw new Error("brief 不能为空");
    if (!process.env.OPENCODE_API_KEY) return fallbackPlan(request);
    try {
      const result = await this.client.complete({
        model: process.env.OPENCODE_MODEL || "glm-5.3-flash",
        messages: [
          {
            role: "system",
            content: "你是短视频分镜导演。只输出严格 JSON，不要 Markdown。结构为 {options:{title,aspectRatio,fps,resolution,language,ttsVoiceId},scenes:[{index,narration,subtitle,durationSec,visualPrompt,motion}],estimatedDurationSec}。fps 只能是24/30/60，resolution只能720/1080/2160，aspectRatio只能16:9/9:16/1:1/4:5。每个场景2到60秒，视觉提示词要具体。",
          },
          { role: "user", content: JSON.stringify({ ...request, sceneCount: clamp(Math.round(request.sceneCount ?? 4), 1, 12) }) },
        ],
      });
      return validatePlan(extractPlanJson(result.content), request);
    } catch (err) {
      this.logger.warn(`LLM plan failed, using deterministic fallback: ${String((err as Error)?.message ?? err)}`);
      return fallbackPlan(request);
    }
  }
}
