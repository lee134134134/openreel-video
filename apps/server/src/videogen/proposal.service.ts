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
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Slide-style picture requirements. The output is an Apple Keynote-style
 * share/explainer video: clean static slides, restrained typography, lots of
 * whitespace, no camera moves. Keeping `motion: "static"` is what prevents the
 * render pipeline from applying zoompan or Ken Burns effects.
 */
const SLIDE_VISUAL_REQUIREMENTS = `【画面硬要求 · Apple 风格演示幻灯片】
这是一段分享说明视频，视觉上是一组 Apple Keynote 风格的演示幻灯片，不是实拍视频，不要任何运镜：
- visualPrompt 写成一张可绘制的幻灯片：浅灰或白色背景（#F5F5F7 / #FFFFFF），无衬线字体（SF Pro / 苹方 / Helvetica Neue），一个大标题 + 1 到 3 行精简说明 + 一个简明图示（卡片、线条、箭头、几何形状），大量留白；文字用深灰 #1D1D1F，强调色用苹果蓝 #0071E3，发丝线边框。
- 每页只讲一个要点，文字少而精；用简短标签、数字和关键词表达，不堆段落，不写大段说明文字。
- motion 必须固定为 "static"；禁止 zoom-in / zoom-out / pan-* / dynamic，不要推拉摇移，不要 Ken Burns，不要镜头运动。
- motionDescription 可省略；如填写只能是"无镜头运动，幻灯片静态呈现"这类说明。
- beats 写 2 到 4 条，描述同一页上的信息依次出现或高亮的顺序（先标题、再图示、再要点），不是镜头运动；相邻页保持同一套版式与配色。
- requiresVideo 必须为 false；这是演示文稿，不调用视频生成模型。`;

/**
 * A single restrained slide template reused across the whole deck, mirroring
 * Apple's keynote visual system: one accent colour, one type hierarchy, lots
 * of breathing room.
 */
const SLIDE_SYSTEM_REQUIREMENTS = `【版式一致性 · 一套 Apple 风模板贯穿全片】
- 先写 continuityBible，把它当作"演示模板规范"（一段话，不超过 120 字）：背景色、字体层级（标题/正文/标注）、强调色、卡片与圆角、留白比例、图示风格。所有页必须严格复用同一套规范。
- 每个场景的 beats 按信息呈现顺序描述要点如何逐步出现，不允许换版式、换配色、换字体、换图示风格。
- 场景之间用信息递进关系衔接（从概览到细节、从问题到方案），干净切换，不要花哨转场。
- 全片禁止：写实照片、电影海报、运镜、噪点、暗角、电影滤镜、浓重渐变、花哨 PPT 模板、图标堆砌、复杂插画。`;

/** Spoken-style requirements prepended to every plan prompt. The delivery is
 * clear and composed, like a product share/demo narration: short sentences,
 * information first, restrained emotion. */
const NARRATION_STYLE_GUIDE = `旁白 narration 是成片的解说声，语气必须清晰、从容、克制，像产品分享或说明演示的旁白，不要浮夸、不要咋呼：
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
- 默认使用 calm（平静）或 documentary-narration（沉稳旁白）；产品、分享、说明类内容优先
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
      motion: "static",
      motionDescription: motionDescription || undefined,
      beats: beats.length > 1 ? beats : undefined,
      requiresVideo: false,
      emotion: emotion || undefined,
      slide: {
        title: (field(block, "subtitle") || narration).trim().slice(0, 16) || "演示文稿",
        bullets: beats.slice(0, 3).map((beat) => beat.trim().slice(0, 24)).filter(Boolean),
        diagram: undefined,
      },
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

/** Normalize the structured slide content used by the code renderer. Falls
 * back to the subtitle/narration and beats when the model omits `slide`. */
function parseSlide(
  value: unknown,
  fallback: { subtitle?: string; narration: string; beats?: string[] },
): NonNullable<VideogenScenePlan["slide"]> {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const diagrams = ["cards", "steps", "metrics", "outline"] as const;
  const title = String(raw.title ?? "").trim().slice(0, 16)
    || String(fallback.subtitle ?? fallback.narration ?? "").trim().slice(0, 16)
    || "演示文稿";
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets.map((item) => String(item ?? "").trim().slice(0, 24)).filter(Boolean).slice(0, 3)
    : [];
  const derived = (fallback.beats ?? [])
    .map((beat) => String(beat ?? "").trim().slice(0, 24))
    .filter(Boolean)
    .slice(0, 3);
  const diagramRaw = String(raw.diagram ?? "");
  return {
    title,
    bullets: bullets.length ? bullets : derived,
    diagram: diagrams.includes(diagramRaw as (typeof diagrams)[number])
      ? diagramRaw as (typeof diagrams)[number]
      : undefined,
  };
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
      motion: "static",
      motionDescription: item.motionDescription ? String(item.motionDescription).trim() : undefined,
      beats: beats.length > 1 ? beats : undefined,
      requiresVideo: false,
      emotion: (AZURE_TTS_PLAN_STYLES as readonly string[]).includes(emotionRaw)
        ? emotionRaw
        : undefined,
      slide: parseSlide(item.slide, { subtitle: item.subtitle ? String(item.subtitle) : narration, narration, beats }),
    });
    total += durationSec;
  }
  if (!scenes.length) throw new Error("视频计划没有有效场景");
  const fps = [24, 30, 60].includes(Number(rawOptions.fps)) ? Number(rawOptions.fps) as 24 | 30 | 60 : 30;
  const resolution = [720, 1080, 2160].includes(Number(rawOptions.resolution))
    ? Number(rawOptions.resolution) as 720 | 1080 | 2160
    : 1080;
  return {
    options: {
      title: String(rawOptions.title ?? request.brief).slice(0, 120) || "未命名视频",
      aspectRatio: ratio,
      fps,
      resolution,
      language: String(rawOptions.language ?? request.language ?? "zh-CN"),
      ttsVoiceId: rawOptions.ttsVoiceId ? String(rawOptions.ttsVoiceId) : undefined,
      accentColorHex: rawOptions.accentColorHex ? String(rawOptions.accentColorHex) : "#0071E3",
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
      resolution: 1080,
      language: request.language ?? "zh-CN",
      ttsVoiceId: "mock",
      accentColorHex: "#0071E3",
    },
    scenes: [{
      index: 0,
      narration: brief,
      subtitle: brief,
      durationSec,
      visualPrompt: `Apple 风格演示幻灯片：浅灰背景 #F5F5F7，无衬线大标题「${brief}」，下方 1 到 3 行精简要点，苹果蓝 #0071E3 强调，一个简洁几何图示，大量留白，无镜头运动。`,
      motion: "static",
      motionDescription: "无镜头运动，幻灯片静态呈现。",
      beats: [
        `${brief}：先出现居中大标题，背景为浅灰留白。`,
        `标题下方出现 1 到 3 行精简要点与一个简洁几何图示。`,
        `要点依次高亮，强调色保持苹果蓝，版式不变。`,
      ],
      requiresVideo: false,
      slide: {
        title: brief.slice(0, 16),
        bullets: [`一页一个核心观点`, `用数字与关键词说明`, `保持简洁与留白`],
        diagram: "outline",
      },
    }],
    continuityBible: `统一的 Apple 风演示模板：浅灰 #F5F5F7 背景，白色卡片与发丝线边框，深灰 #1D1D1F 文字，强调色 #0071E3；SF Pro / 苹方字体层级固定，标题大而醒目、正文简短，留白充足，不使用照片、渐变、噪点与运镜。`,
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
            content: NARRATION_STYLE_GUIDE + "\n\n" + SLIDE_VISUAL_REQUIREMENTS + "\n\n" + SLIDE_SYSTEM_REQUIREMENTS + "\n\n" + resolveSkillPrompt(request.skills) + "\n\n你是 Apple 风格演示文稿设计师。只输出严格 JSON，不要 Markdown。结构为 {options:{title,aspectRatio,fps,resolution,language,ttsVoiceId},continuityBible:\"演示模板规范\",scenes:[{index,narration,subtitle,durationSec,visualPrompt,motion,motionDescription,beats:[\"标题出现\",\"图示出现\",\"要点高亮\"],requiresVideo,emotion,slide:{title,bullets:[\"要点1\",\"要点2\"],diagram}}],estimatedDurationSec}。motion 必须固定为 static；requiresVideo 必须为 false。beats 按信息出现顺序描述同一页的内容呈现，2 到 4 条。slide 必须提供：title 不超过 16 字的页面大标题，bullets 为 1 到 3 条、每条不超过 24 字的精简要点，diagram 只能是 cards / steps / metrics / outline；画面由代码按 slide 字段排版生成，不要用视觉提示词描述插画。fps 只能是24/30/60，resolution只能720/1080/2160，aspectRatio只能16:9/9:16/1:1/4:5。每个场景2到60秒，视觉提示词写成静态演示幻灯片；默认横屏 16:9，只有用户明确要求竖屏时才用 9:16。",
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
            content: NARRATION_STYLE_GUIDE + "\n\n" + SLIDE_VISUAL_REQUIREMENTS + "\n\n" + SLIDE_SYSTEM_REQUIREMENTS + "\n\n" + resolveSkillPrompt() + "\n\n你是 Apple 风格演示文稿设计师。用户会给一个现有演示计划和修改要求，输出修订后的完整计划。只输出严格 JSON，不要 Markdown。结构为 {options:{title,aspectRatio,fps,resolution,language,ttsVoiceId},continuityBible:\"演示模板规范\",scenes:[{index,narration,subtitle,durationSec,visualPrompt,motion,motionDescription,beats:[\"标题出现\",\"图示出现\",\"要点高亮\"],requiresVideo,emotion,slide:{title,bullets:[\"要点1\",\"要点2\"],diagram}}],estimatedDurationSec}。motion 必须固定为 static；requiresVideo 必须为 false。beats 按信息出现顺序描述同一页的内容呈现，2 到 4 条。slide 必须提供：title 不超过 16 字的页面大标题，bullets 为 1 到 3 条、每条不超过 24 字的精简要点，diagram 只能是 cards / steps / metrics / outline；画面由代码按 slide 字段排版生成，不要用视觉提示词描述插画。fps 只能是24/30/60，resolution只能720/1080/2160，aspectRatio只能16:9/9:16/1:1/4:5。每个场景2到60秒；未涉及修改的部分保持原样；默认横屏 16:9，只有用户明确要求竖屏时才用 9:16。",
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
