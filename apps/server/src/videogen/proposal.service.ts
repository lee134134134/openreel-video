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

/** Spoken-style requirements prepended to every plan prompt so narration
 * sounds like a real presenter instead of a written script (free-tier TTS
 * sounds far more human on conversational copy). */
const NARRATION_STYLE_GUIDE = `旁白 narration 必须是口语化口播稿，像真人博主对镜头说话：
- 短句为主，每句一般不超过 20 个字，用标点制造自然停顿和呼吸感；
- 有情绪起伏和口语连接词（如「其实」「你知道吗」「更妙的是」），开头第一句要有钩子；
- 禁止书面语、排比长句、生硬总结句、镜头术语、Markdown、引号和括号注释；
- 每句以中文标点（。！？，）结尾；subtitle 是同步字幕，与 narration 保持同一口吻、可稍精简；
- ttsVoiceId 只能省略或从以下列表选择（根据产品调性挑最贴合的一个）：
  zh-CN-XiaoxiaoNeural（女·温暖）、zh-CN-XiaoyiNeural（女·活泼）、zh-CN-YunxiNeural（男·阳光）、
  zh-CN-YunjianNeural（男·激情）、zh-CN-YunxiaNeural（男·可爱）、zh-CN-YunyangNeural（男·专业播报）、
  zh-CN-liaoning-XiaobeiNeural（女·东北幽默）、zh-CN-shaanxi-XiaoniNeural（女·陕西方言）。
`;

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
            content: NARRATION_STYLE_GUIDE + "你是短视频分镜导演。只输出严格 JSON，不要 Markdown。结构为 {options:{title,aspectRatio,fps,resolution,language,ttsVoiceId},scenes:[{index,narration,subtitle,durationSec,visualPrompt,motion}],estimatedDurationSec}。fps 只能是24/30/60，resolution只能720/1080/2160，aspectRatio只能16:9/9:16/1:1/4:5。每个场景2到60秒，视觉提示词要具体。",
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

  /** Revise an existing plan according to user feedback, keeping whatever
   * the user did not ask to change (title/voice/ratio unless touched). */
  async revisePlan(base: VideogenPlan, feedback: string): Promise<VideogenPlan> {
    const request: ProposePlanInput = {
      brief: `修订计划。修改要求：${feedback.trim() || "无具体要求，请优化节奏与画面描述"}`,
      aspectRatio: base.options?.aspectRatio,
      language: base.options?.language,
    };
    if (!process.env.OPENCODE_API_KEY) return base;
    try {
      const result = await this.client.complete({
        model: process.env.OPENCODE_MODEL || "glm-5.3-flash",
        messages: [
          {
            role: "system",
            content: NARRATION_STYLE_GUIDE + "你是短视频分镜导演。用户会给一个现有分镜计划和修改要求，输出修订后的完整计划。只输出严格 JSON，不要 Markdown。结构为 {options:{title,aspectRatio,fps,resolution,language,ttsVoiceId},scenes:[{index,narration,subtitle,durationSec,visualPrompt,motion}],estimatedDurationSec}。fps 只能是24/30/60，resolution只能720/1080/2160，aspectRatio只能16:9/9:16/1:1/4:5。每个场景2到60秒；未涉及修改的部分保持原样。",
          },
          { role: "user", content: JSON.stringify({ originalPlan: base, feedback: request.brief }) },
        ],
      });
      return validatePlan(extractPlanJson(result.content), request);
    } catch (err) {
      this.logger.warn(`LLM plan revision failed, keeping base plan: ${String((err as Error)?.message ?? err)}`);
      return base;
    }
  }
}
