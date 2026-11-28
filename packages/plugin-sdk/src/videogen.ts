/**
 * Real-person video generation contracts: the plan (LLM output) and the clip
 * artifacts the compositor consumes. Shared by server pipeline and web UI.
 */

export interface VideogenInputField {
  key: string;
  label: string;
  type: "text" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  default?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  placeholder?: string;
}

export type VideogenInputValues = Record<string, string | number | boolean | undefined>;

/** Preset canvas formats (CapCut-like). */
export type VideogenAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";

export interface VideogenAvatar {
  /** Human-readable persona, e.g. "女主播-甜美". */
  id: string;
  label: string;
  /** Reference image URL/dir used by the local composer to build scene cards. */
  referenceImage?: string;
  /** Voice id handed to the TTS adapter. */
  voiceId?: string;
  source: "builtin" | "upload" | "adapter";
}

export interface VideogenScenePlan {
  index: number;
  /** Narration / spoken lines for this scene. */
  narration: string;
  /** On-screen subtitle text; defaults to narration when omitted. */
  subtitle?: string;
  /** Duration seconds requested (before audio probing refines it). */
  durationSec: number;
  /**
   * Visual prompt for this scene. For the local composer this is a prompt for
   * the image generator; remote adapters (wan/jimeng/higgsfield…) consume it
   * as the generation prompt directly.
   */
  visualPrompt: string;
  /** Optional id of a media asset to use verbatim (uploaded/reference image). */
  mediaAssetRef?: string;
  /** Camera motion for still-image segments. `dynamic` is the default: a
   * frame-driven push with a gentle drift, so no scene stays frozen. */
  motion?: "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "dynamic" | "static";
  /** Director's shot note: what moves on screen, how the camera moves, and how
   * the environment/light changes across the scene. Feeds the video model. */
  motionDescription?: string;
  /**
   * Ordered visual beats inside this shot (2–4 entries). Each beat becomes a
   * keyframe; the compositor cross-dissolves them under one continuous camera
   * move, so the scene changes inside itself instead of being a frozen slide.
   * Beats must describe progressive change of the SAME shot, never new scenes.
   */
  beats?: string[];
  /** True when this shot needs real generated footage rather than a still.
   * The slide-deck pipeline always sets this to false. */
  requiresVideo?: boolean;
  /**
   * Structured content for the code-rendered Apple-style slide. The renderer
   * draws the SVG itself from these fields — no image model is involved.
   * When missing, the renderer derives a title/bullets from subtitle and beats.
   */
  slide?: {
    title: string;
    bullets: string[];
    diagram?: "cards" | "steps" | "metrics" | "outline";
  };
  /** Optional narration emotion style (Azure express-as, e.g. "cheerful");
   * ignored by TTS adapters without style support. */
  emotion?: string;
}

export interface VideogenPlanOptions {
  title: string;
  aspectRatio: VideogenAspectRatio;
  fps: 24 | 30 | 60;
  resolution: 720 | 1080 | 2160;
  /** Output language for subtitles/voice style hints. */
  language?: string;
  avatar?: VideogenAvatar;
  ttsVoiceId?: string;
  accentColorHex?: string;
  /** BGM track asset ref, optional. */
  bgmRef?: string;
  bgmVolume?: number; // 0..1
}

export interface VideogenPlan {
  options: VideogenPlanOptions;
  scenes: VideogenScenePlan[];
  /** Estimated from requested durations, refined by probe later. */
  estimatedDurationSec: number;
  /**
   * Film-wide continuity bible authored by the planner: era/place, palette and
   * colour temperature, lighting direction, lens language, material feel and
   * the fixed look of recurring subjects/props. Every scene and keyframe reuses
   * it so shots read as one continuous world instead of unrelated posters.
   */
  continuityBible?: string;
}

/** Artifact produced by a videogen adapter for one scene. */
export interface VideogenClip {
  sceneIndex: number;
  /** Absolute path of the scene's primary video/image media. */
  mediaPath: string;
  kind: "video" | "image";
  durationSec: number;
  /** Optional per-scene narration audio path (local composer overlays BGM). */
  audioPath?: string;
  subtitle?: string;
  /** True when the scene media is a locally generated placeholder card. */
  placeholder?: boolean;
  /**
   * Ordered keyframe stills for this scene (start → end). When present the
   * compositor builds one continuous shot by cross-dissolving the frames under
   * a single camera move, instead of holding a single still.
   */
  frames?: string[];
  kind_meta?: Record<string, unknown>;
}

/* --------------------------- Plan generation (LLM) --------------------------- */

/** Tool the server exposes to the LLM: propose a storyboard. */
export interface GenerateVideogenPlanArgs {
  brief: string;
  sceneCount: number;
  aspectRatio?: VideogenAspectRatio;
  styleHint?: string;
  language?: string;
}

/* ------------------------------- Job protocol ------------------------------- */

/** Result of the automatic video quality self-check that runs after render. */
export interface VideoEvalReport {
  score: number;
  passed: boolean;
  grade: "excellent" | "good" | "fair" | "poor";
  metrics: {
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    frameCount: number;
    bitrateKbps: number;
    freezeRatio: number;
    blackRatio: number;
    motionScore: number;
  };
  issues: string[];
  suggestions: string[];
  /** Optional multimodal LLM review (enabled with VIDEO_EVAL_VISION). */
  vision?: {
    visualQuality: number;
    watchability: number;
    dynamism: number;
    sync: number;
    overall: number;
    notes: string;
  };
  createdAt: string;
}

export type VideogenJobState = "draft" | "queued" | "running" | "done" | "failed" | "cancelled";

export interface VideogenJobDTO {
  id: string;
  state: VideogenJobState;
  progress: number; // 0..1
  stage?: string;
  error?: string;
  /** Final rendered file, absolute URL (/api/files/...) when done. */
  videoUrl?: string;
  durationSec?: number;
  plan: VideogenPlan;
  adapterId?: string;
  /** 创建该任务的 Web 项目 id（agent 工具创建的任务可为空） */
  projectId?: string;
  /** Non-fatal notices, e.g. placeholder cards or offline test narration. */
  warnings?: string[];
  /** Automatic post-generation quality self-check (video eval). */
  eval?: VideoEvalReport;
  createdAt: string;
  updatedAt: string;
}
