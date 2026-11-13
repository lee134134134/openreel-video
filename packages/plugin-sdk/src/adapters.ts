/**
 * Adapter interface contracts for the four initial extension points.
 * All adapters receive the shared PluginContext.
 */

import type { PluginContext } from "./context";
import type { LlmChatRequest, LlmChatResult, LlmProviderConfig, LlmStreamChunk } from "./llm-protocol";
import type { VideogenScenePlan, VideogenClip, VideogenInputValues } from "./videogen";
import type { PublishRequest, PublishResult, PublishCredentials, PublishStatus } from "./publish";

/* ---------------------------------- LLM ---------------------------------- */

export interface LlmProviderAdapter {
  id: string;
  label: string;
  models(ctx: PluginContext): Promise<Array<{ id: string; label: string }>>;
  complete(req: LlmChatRequest, ctx: PluginContext): Promise<LlmChatResult>;
  stream?(req: LlmChatRequest, ctx: PluginContext): AsyncIterable<LlmStreamChunk>;
  describeConfig(ctx: PluginContext): LlmProviderConfig;
}

/* ---------------------------------- TTS ---------------------------------- */

export interface TtsSynthesisOptions {
  voiceId: string;
  /** Optional character-speed multiplier, 0.8 = slower, 1.2 = faster. */
  speed?: number;
  format?: "wav" | "mp3";
  sampleRate?: number;
  /** Pitch offset in semitones for the local synth fallback. */
  pitch?: number;
}

export interface TtsClipResult {
  /** Absolute path to the synthesized audio file. */
  audioPath: string;
  durationSec: number;
  voiceId: string;
  text: string;
}

export interface TtsVoice {
  id: string;
  label: string;
  Gender?: string;
  previewUrl?: string;
  meta?: Record<string, unknown>;
}

export interface TtsAdapter {
  id: string;
  label: string;
  voices(ctx: PluginContext): Promise<TtsVoice[]>;
  /**
   * Synthesize one text chunk to an audio file under the given output dir.
   * Implementations MUST report duration accurately (probe the file).
   */
  synthesize(
    text: string,
    options: TtsSynthesisOptions,
    out: { dir: string; basename: string },
    ctx: PluginContext,
  ): Promise<TtsClipResult>;
}

/* ------------------------------- Video gen ------------------------------- */

/**
 * A video-generation provider turns ONE scene plan (or the whole plan) into
 * media clips that the local compositor stitches together with FFmpeg.
 *
 * The built-in "local-compose" engine is the default: it renders scene cards
 * (LLM-provided image prompts via an image provider, Ken Burns motion, native
 * drawtext subtitles, TTS narration) into a finished person-facing video.
 */
export interface VideogenAdapter {
  id: string;
  label: string;
  /** Declared inputs rendered as a form in the web UI. */
  inputs?: Array<import("./videogen").VideogenInputField>;
  /**
   * Produce sequence clips for the given scene. Stream-style signature lets
   * the server update per-scene progress; call onProgress when finished.
   */
  generateScene(
    scene: VideogenScenePlan,
    options: { outDir: string; values: VideogenInputValues; width: number; height: number; fps: number },
    ctx: PluginContext,
    hooks: { onProgress?(fraction: number, note?: string): Promise<void> | void },
  ): Promise<VideogenClip>;
}

/* --------------------------------- Publish -------------------------------- */

export type PublishAuthKind = "none" | "api_key" | "oauth2" | "cookie" | "manual_token";

export interface PublishOAuthInfo {
  kind: Extract<PublishAuthKind, "oauth2">;
  /** Builds the redirect URL the user must visit to authorize. */
  authorizeUrl(credentials: PublishCredentials, callbackUrl: string): string;
  /** Exchanges an OAuth code for tokens (implementations persist via ctx.store). */
  exchangeCode(credentials: PublishCredentials, code: string, callbackUrl: string): Promise<void>;
}

export interface PublishConnectorAdapter {
  id: string;
  label: string;
  platform: string; // e.g. "youtube", "bilibili"
  auth: PublishAuthKind;
  oauth?: PublishOAuthInfo;
  /** Validate credentials; returns a human-readable account label if valid. */
  validateCredentials(credentials: PublishCredentials): Promise<{ ok: boolean; account?: string; message?: string }>;
  /** Upload the rendered video and publish (or create a draft per platform rules). */
  publish(request: PublishRequest, credentials: PublishCredentials): Promise<PublishResult>;
  status(result: PublishResult): Promise<PublishStatus>;
}

/* --------------------------------- Publish -------------------------------- */

/* (All modules are re-exported from the package index, not from here.) */

