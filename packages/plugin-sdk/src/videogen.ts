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
  /** Camera motion for local composer Ken Burns effect. */
  motion?: "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "static";
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
  /** Non-fatal notices, e.g. placeholder cards or offline test narration. */
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
}
