import { Injectable, Logger } from "@nestjs/common";
import type { GenerateVideogenPlanArgs, VideogenAspectRatio, VideogenPlan, VideogenScenePlan } from "@openreel/plugin-sdk";
import { AZURE_TTS_PLAN_STYLES } from "../tts/azure-tts.adapter";
import { OpencodeClient, hasOpencodeCredentials } from "../llm/opencode.client";
import { resolveSkillPrompt } from "../llm/skills";

export interface ProposePlanInput {
  brief: string;
  sceneCount?: number;
  aspectRatio?: VideogenAspectRatio;
  styleHint?: string;
  language?: string;
  /** Creative skills to load for this plan. Defaults to the director skill. */
  skills?: string[];
}

const RATIOS: VideogenAspectRatio[] = ["16:9", "9:16", "1:1", "4:5"];
const MOTIONS = ["zoom-in", "zoom-out", "pan-left", "pan-right", "pan-up", "pan-down", "dynamic", "static"] as const;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Hard requirements for picture movement. The previous pipeline produced a
 * still PNG per scene and never applied the `motion` field, so every video
 * read like a slide deck. These rules force every shot to describe continuous
 * on-screen motion and give the renderer/video model something to animate.
 */
const DYNAMIC_VISUAL_REQUIREMENTS = `【动态画面硬要求 · 必须遵守】
这是一段真实运动的视频，不是幻灯片。每一幕都必须在时间维度上持续变化：
- visualPrompt 必须写成一个"会动的镜头"：谁在动、往哪里动、镜头如何跟拍/推拉/摇移、环境（风、水、人群、车流、光影、烟雾）如何变化；禁止只写静态构图、海报式描述、一张图配字幕。
- 每个场景必须给出 motionDescription（一句话，明确主体动作 + 镜头运动 + 环境动态），例如"人物向镜头走来，镜头缓慢后拉，窗外车流与光斑持续掠过"。
- motion 只能从 zoom-in / zoom-out / pan-left / pan-right / pan-up / pan-down / dynamic 中选择；禁止把整条片子都设成 static。需要强烈真实运动时把 requiresVideo 设为 true，交给视频生成模型产出真实动态片段。
- 相邻场景的运动方式要交替（推、拉、摇、移、跟），避免连续多个相同景别与同一运动。
- 画面必须有清晰的时间过程：动作起幅 → 发展 → 落幅，至少覆盖本场景 durationSec 的大部分，而不是一帧定格。`;

/**
 * Continuity requirements: the previous pipeline authored each scene in
 * isolation, so every shot was a different poster. A film-wide visual bible
 * plus per-scene progressive beats makes the compositor animate ONE continuous
 * world instead of cutting between unrelated slides.
 */
const CONTINUITY_REQUIREMENTS = `【连贯性硬要求 · 整片是一个连续的世界】
观众看到的必须是一段连贯的影片，而不是一组独立海报或 PPT 翻页：
- 先写 continuityBible（全片视觉圣经，一段话，不超过 120 字）：时代与地点、色调与色温、主光方向、镜头语言与焦段、材质与质感、固定人物/主体的外观（发型、服装、主色）、反复出现的关键道具与环境元素。所有场景必须复用同一套设定。
- 每个场景必须给出 beats：2 到 4 个字符串，按时间顺序描述同一镜头内的连续视觉节拍。beats[0] 是起幅，beats[最后一个] 是落幅；相邻节拍只做渐进变化（主体位移、光线移动、环境变化），禁止换场景、换人物、换画风、换色调。
- 每个 beat 都要写成可画出的具体画面（谁/什么在画面什么位置、在做什么、光从哪来、背景有什么），而不是抽象形容词。
- 场景之间用动作方向、视线、运动方向或同一环境元素衔接（match cut），让上一场的落幅自然带出下一场的起幅。
- 全片禁止：每场一张静态海报、图标/图表/文字卡片、纯色块 PPT 构图、场景之间毫无关联的素材拼贴。`;

/** Spoken-style requirements prepended to every plan prompt. The delivery is
 * deliberately steady and composed (documentary / brand-film narration):
 * short sentences for breathing room, information first, restrained emotion. */
const NARRATION_STYLE_GUIDE = `旁白 narration 是成片的解说声，语气必须沉稳、从容、有分量，像纪录片或品牌宣传片旁白，不要浮夸、不要咋呼：
- 短句为主，每句一般不超过 20 个字，用标点制造自然停顿和呼吸感；
- 以陈述信息为主，情绪克制；开头用一句有信息量的陈述引入，不喊口号；
- 禁止网感口头禅和网络流行语（如「你知道吗」「更妙的是」「绝绝子」），不要刻意煽情；
- 禁止书面语堆砌、排比长句、生硬总结句、镜头术语、Markdown、引号和括号注释；
- 每句以中文标点（。！？，）结尾；subtitle 是同步字幕，与 narration 保持同一口吻、可稍精简；
- ttsVoiceId 只能省略或从以下列表选择（根据产品调性挑最贴合的一个）：
  zh-CN-XiaoxiaoNeural（女·温暖）、zh-CN-XiaoyiNeural（女·活泼）、zh-CN-YunxiNeural（男·阳光）、
  zh-CN-YunjianNeural（男·激情）、zh-CN-YunxiaNeural（男·可爱）、zh-CN-YunyangNeural（男·专业播报）、
  zh-CN-liaoning-XiaobeiNeural（女·东北幽默）、zh-CN-shaanxi-XiaoniNeural（女·陕西方言）。
- 每个 scene 按旁白情绪指定 emotion（Azure 情绪风格），只能从以下选择：
  cheerful 欢快、friendly 友好、gentle 温柔、calm 平静、serious 严肃、
  sad 难过、angry 愤怒、fearful 紧张、lyrical 抒情、affectionate 深情、empathetic 共情、
  documentary-narration 纪录片旁白、newscast 新闻播报、whispering 耳语。
- 默认使用 documentary-narration（沉稳旁白）或 calm（平静）；知识、纪实、产品、品牌类内容优先
  documentary-narration / serious；只有主题确实轻快时才用 cheerful / friendly；
  不要用 whispering、angry、fearful 等极端情绪。
`;

export function extractPlanJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? content.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("LLM 响应中没有 JSON 计划");
  return JSON.parse(candidate) as unknown;
}

function jsonString(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
  }
}

/**
 * Some gateways return almost-valid JSON with a stray character that breaks
 * JSON.parse. Recover the individual scene objects so the model's actual
 * narration and documentary-style visual descriptions are still used instead
 * of silently falling back to the generic placeholder plan.
 */
function salvagePlan(content: string, request: ProposePlanInput): unknown {
  const blocks = content.match(/\{[^{}]*"narration"[^{}]*\}/g);
  if (!blocks?.length) return null;
  const field = (block: string, name: string): string => {
    const match = block.match(new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
    return match ? jsonString(match[1]) : "";
  };
  const number = (block: string, name: string): number => {
    const match = block.match(new RegExp(`"${name}"\\s*:\\s*([0-9.]+)`));
    return match ? Number(match[1]) : 0;
  };
  const scenes = blocks.map((block, index) => {
    const narration = field(block, "narration");
    const visualPrompt = field(block, "visualPrompt");
    const motion = field(block, "motion");
    const emotion = field(block, "emotion");
    const motionDescription = field(block, "motionDescription");
    const beatsMatch = block.match(/"beats"\s*:\s*\[([\s\S]*?)\]/);
    const beats = beatsMatch
      ? [...beatsMatch[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
          .map((match) => jsonString(match[1]).trim())
          .filter(Boolean)
      : [];
    return {
      index,
      narration,
      subtitle: field(block, "subtitle") || narration,
      durationSec: number(block, "durationSec") || 6,
      visualPrompt,
      motion: (MOTIONS as readonly string[]).includes(motion) ? motion as VideogenScenePlan["motion"] : "dynamic",
      motionDescription: motionDescription || undefined,
      beats: beats.length > 1 ? beats : undefined,
      requiresVideo: /"requiresVideo"\s*:\s*true/.test(block),
      emotion: emotion || undefined,
    };
  });
  if (!scenes.some((scene) => scene.narration || scene.visualPrompt)) return null;
  const titleMatch = content.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const continuityMatch = content.match(/"continuityBible"\s*:\s*"((?:\\.|[^"\\])*)"/);
  return {
    options: {
      title: titleMatch ? jsonString(titleMatch[1]) : request.brief,
      aspectRatio: request.aspectRatio,
      language: request.language,
    },
    continuityBible: continuityMatch ? jsonString(continuityMatch[1]) : undefined,
    scenes,
    estimatedDurationSec: scenes.reduce((sum, scene) => sum + scene.durationSec, 0),
  };
}

function parsePlanResponse(content: string, request: ProposePlanInput): unknown {
  try {
    return extractPlanJson(content);
  } catch (error) {
    const salvaged = salvagePlan(content, request);
    if (!salvaged) throw error;
    return salvaged;
  }
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
    const emotionRaw = String(item.emotion ?? "").trim().toLowerCase();
    const rawBeats = Array.isArray(item.beats) ? item.beats : [];
    const beats = rawBeats
      .map((beat) => String(beat ?? "").trim())
      .filter(Boolean)
      .slice(0, 4);
    scenes.push({
      index: position,
      narration,
      subtitle: item.subtitle ? String(item.subtitle) : narration,
      durationSec,
      visualPrompt: String(item.visualPrompt ?? "").trim() || `${request.styleHint ?? "professional cinematic"}, ${narration}`,
      motion: (MOTIONS as readonly string[]).includes(String(item.motion))
        ? item.motion as VideogenScenePlan["motion"]
        : String(item.motion) === "static" ? "static" : "dynamic",
      motionDescription: item.motionDescription ? String(item.motionDescription).trim() : undefined,
      beats: beats.length > 1 ? beats : undefined,
      requiresVideo: item.requiresVideo === true || item.requiresVideo === "true",
      emotion: (AZURE_TTS_PLAN_STYLES as readonly string[]).includes(emotionRaw)
        ? emotionRaw
        : undefined,
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
    continuityBible: String(raw.continuityBible ?? "").trim().slice(0, 600) || undefined,
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
      visualPrompt: `${request.styleHint ?? "真实 cinematic 场景"}: ${brief}。镜头缓慢向前推进，主体持续运动，环境与光线随时间变化。`,
      motion: "dynamic",
      motionDescription: `主体持续动作，镜头缓慢推进并轻微摇移，环境光影随时间变化；以 ${brief} 为画面核心。`,
      beats: [
        `${brief} 的远景起幅：环境全貌与主光方向清晰，主体位于画面中景。`,
        `镜头推进，主体开始动作，前景与背景产生相对位移，光线略微变化。`,
        `主体动作落到近景落幅，环境细节与材质清晰可见，画面保持同一色调与光向。`,
      ],
      requiresVideo: true,
    }],
    continuityBible: `统一电影感纪实风格：自然光主光来自画面侧上方，低饱和暖灰色调，35mm 镜头浅景深，真实材质与空气感；主体外观、服装主色与关键道具在全片保持一致。`,
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
    if (!hasOpencodeCredentials()) return fallbackPlan(request);
    try {
      const result = await this.client.complete({
        // Empty model lets the client use the auto-discovered free model of
        // whichever account is currently active.
        model: "",
        maxTokens: 6000,
        // Structured JSON: skip hidden reasoning so the whole budget goes to
        // the plan instead of a truncated reasoning trace.
        reasoningEffort: "none",
        messages: [
          {
            role: "system",
            content: NARRATION_STYLE_GUIDE + "\n\n" + DYNAMIC_VISUAL_REQUIREMENTS + "\n\n" + CONTINUITY_REQUIREMENTS + "\n\n" + resolveSkillPrompt(request.skills) + "\n\n你是短视频分镜导演。只输出严格 JSON，不要 Markdown。结构为 {options:{title,aspectRatio,fps,resolution,language,ttsVoiceId},continuityBible:\"全片视觉圣经\",scenes:[{index,narration,subtitle,durationSec,visualPrompt,motion,motionDescription,beats:[\"起幅\",\"中段\",\"落幅\"],requiresVideo,emotion}],estimatedDurationSec}。motion 只能是 zoom-in/zoom-out/pan-left/pan-right/pan-up/pan-down/dynamic；requiresVideo 为布尔值，强烈真实运动设为 true。beats 必须按时间顺序描述同一镜头内的连续变化，2 到 4 条。fps 只能是24/30/60，resolution只能720/1080/2160，aspectRatio只能16:9/9:16/1:1/4:5。每个场景2到60秒，视觉提示词要写出连续运动；默认横屏 16:9，只有用户明确要求竖屏时才用 9:16。",
          },
          { role: "user", content: JSON.stringify({ ...request, sceneCount: clamp(Math.round(request.sceneCount ?? 4), 1, 12) }) },
        ],
      });
      return validatePlan(parsePlanResponse(result.content, request), request);
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
    if (!hasOpencodeCredentials()) return base;
    try {
      const result = await this.client.complete({
        // Empty model lets the client use the auto-discovered free model of
        // whichever account is currently active.
        model: "",
        maxTokens: 6000,
        // Structured JSON: skip hidden reasoning so the whole budget goes to
        // the plan instead of a truncated reasoning trace.
        reasoningEffort: "none",
        messages: [
          {
            role: "system",
            content: NARRATION_STYLE_GUIDE + "\n\n" + DYNAMIC_VISUAL_REQUIREMENTS + "\n\n" + CONTINUITY_REQUIREMENTS + "\n\n" + resolveSkillPrompt() + "\n\n你是短视频分镜导演。用户会给一个现有分镜计划和修改要求，输出修订后的完整计划。只输出严格 JSON，不要 Markdown。结构为 {options:{title,aspectRatio,fps,resolution,language,ttsVoiceId},continuityBible:\"全片视觉圣经\",scenes:[{index,narration,subtitle,durationSec,visualPrompt,motion,motionDescription,beats:[\"起幅\",\"中段\",\"落幅\"],requiresVideo,emotion}],estimatedDurationSec}。motion 只能是 zoom-in/zoom-out/pan-left/pan-right/pan-up/pan-down/dynamic；requiresVideo 为布尔值。beats 必须按时间顺序描述同一镜头内的连续变化，2 到 4 条。fps 只能是24/30/60，resolution只能720/1080/2160，aspectRatio只能16:9/9:16/1:1/4:5。每个场景2到60秒；未涉及修改的部分保持原样；默认横屏 16:9，只有用户明确要求竖屏时才用 9:16。",
          },
          { role: "user", content: JSON.stringify({ originalPlan: base, feedback: request.brief }) },
        ],
      });
      return validatePlan(parsePlanResponse(result.content, request), request);
    } catch (err) {
      this.logger.warn(`LLM plan revision failed, keeping base plan: ${String((err as Error)?.message ?? err)}`);
      return base;
    }
  }
}
