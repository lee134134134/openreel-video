import * as fs from "node:fs";
import type { VideogenScenePlan } from "@openreel/plugin-sdk";

/**
 * Minimal, provider-agnostic I2V/T2V client. It deliberately tolerates several
 * common gateway shapes (Kling / 即梦 / Wan style task APIs and OpenAI-style
 * synchronous responses) because there is no single standard for video
 * generation endpoints. Configure through VIDEO_BASE_URL / VIDEO_API_KEY and
 * optionally VIDEO_CREATE_PATH / VIDEO_TASK_PATH / VIDEO_MODEL / VIDEO_MODE /
 * VIDEO_PAYLOAD_STYLE. When unavailable, callers fall back to still images
 * with camera motion.
 */

export type VideoPayloadStyle = "generic" | "kling" | "openai";

export interface VideoGenConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  createPath: string;
  taskPath: string;
  mode: "auto" | "i2v" | "t2v";
  payloadStyle: VideoPayloadStyle;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export function readVideoGenConfig(env: Record<string, string | undefined> = process.env): VideoGenConfig | undefined {
  const baseUrl = String(env.VIDEO_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = String(env.VIDEO_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return undefined;
  const style = String(env.VIDEO_PAYLOAD_STYLE ?? "generic").toLowerCase();
  return {
    baseUrl,
    apiKey,
    model: String(env.VIDEO_MODEL ?? "").trim() || "kling-v1-6",
    createPath: String(env.VIDEO_CREATE_PATH ?? "/v1/videos/generations"),
    taskPath: String(env.VIDEO_TASK_PATH ?? "/v1/videos/generations/{id}"),
    mode: env.VIDEO_MODE === "i2v" || env.VIDEO_MODE === "t2v" ? env.VIDEO_MODE : "auto",
    payloadStyle: style === "kling" || style === "openai" ? style : "generic",
    pollIntervalMs: clamp(Number(env.VIDEO_POLL_INTERVAL_MS) || 2000, 500, 30_000),
    pollTimeoutMs: clamp(Number(env.VIDEO_POLL_TIMEOUT_MS) || 180_000, 10_000, 900_000),
  };
}

export interface GenerateVideoInput {
  scene: VideogenScenePlan;
  prompt: string;
  /** Absolute path of the generated first frame, when I2V is available. */
  firstFramePath?: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function extractTaskId(json: Record<string, unknown>): string | undefined {
  const data = obj(json.data);
  const output = obj(json.output);
  return pickString(json.id, json.task_id, json.taskId, json.request_id,
    data.id, data.task_id, data.taskId, output.id, output.task_id, output.taskId);
}

function isFailure(status: string): boolean {
  return /fail|error|reject|cancel|失败|错误/i.test(status);
}

function isSuccess(status: string): boolean {
  return /succ|success|complet|done|finish|成功|完成/i.test(status);
}

function extractStatus(json: Record<string, unknown>): string {
  const data = obj(json.data);
  const output = obj(json.output);
  const task = obj(json.task);
  return pickString(json.status, json.state, json.task_status,
    data.status, data.state, data.task_status, output.status, output.task_status, task.status) ?? "";
}

function extractVideoUrl(json: Record<string, unknown>): string | undefined {
  const data = obj(json.data);
  const output = obj(json.output);
  const videos = Array.isArray(json.videos) ? json.videos : Array.isArray(data.videos) ? data.videos : Array.isArray(output.videos) ? output.videos : [];
  const firstVideo = obj(videos[0]);
  const result = obj(json.result);
  return pickString(json.video_url, json.videoUrl, json.url,
    data.video_url, data.videoUrl, data.url,
    output.video_url, output.videoUrl, output.url,
    firstVideo.url, firstVideo.video_url,
    result.video_url, result.url);
}

function absoluteUrl(baseUrl: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl}/${url.replace(/^\/+/, "")}`;
}

function buildBody(config: VideoGenConfig, input: GenerateVideoInput, dataUrl: string | undefined): Record<string, unknown> {
  const ratio = input.width / input.height;
  const aspectRatio = ratio >= 1.7 ? "16:9" : ratio <= 0.7 ? "9:16" : Math.abs(ratio - 1) < 0.1 ? "1:1" : "4:5";
  const seconds = Math.max(2, Math.min(10, Math.round(input.durationSec)));
  const common = {
    prompt: input.prompt,
    duration: seconds,
    fps: input.fps,
    aspect_ratio: aspectRatio,
  };
  if (config.payloadStyle === "openai") {
    return {
      model: config.model,
      prompt: input.prompt,
      seconds,
      size: `${input.width}x${input.height}`,
      ...(dataUrl ? { input: { image: dataUrl } } : {}),
    };
  }
  if (config.payloadStyle === "kling") {
    return {
      model: config.model,
      ...common,
      mode: dataUrl ? "i2v" : "t2v",
      ...(dataUrl ? { image: dataUrl } : {}),
    };
  }
  return {
    model: config.model,
    ...common,
    durationSec: seconds,
    aspectRatio,
    resolution: input.height,
    image: dataUrl,
    image_url: dataUrl,
    image_base64: dataUrl?.split(",")[1],
    negative_prompt: "static image, slideshow, frozen frame, low quality, watermark, text overlay",
  };
}

async function parseJsonResponse(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return obj(JSON.parse(text));
  } catch {
    throw new Error(`视频接口返回非 JSON（${res.status}）: ${text.slice(0, 300)}`);
  }
}

async function download(config: VideoGenConfig, url: string, output: string): Promise<void> {
  const res = await fetch(absoluteUrl(config.baseUrl, url), {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(config.pollTimeoutMs),
  });
  if (!res.ok) throw new Error(`视频下载失败: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("视频下载结果为空");
  fs.writeFileSync(output, bytes);
}

/** Generate one real video clip. Throws on any failure so the caller can fall
 * back to a still image + camera motion. */
export async function generateVideoClip(config: VideoGenConfig, input: GenerateVideoInput, output: string): Promise<void> {
  const useImage = Boolean(input.firstFramePath) && config.mode !== "t2v";
  let dataUrl: string | undefined;
  if (useImage && input.firstFramePath) {
    const bytes = fs.readFileSync(input.firstFramePath);
    dataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
  }

  const createRes = await fetch(`${config.baseUrl}/${config.createPath.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(buildBody(config, input, dataUrl)),
    signal: AbortSignal.timeout(config.pollTimeoutMs),
  });
  if (!createRes.ok) throw new Error(`视频生成接口 ${createRes.status}: ${(await createRes.text()).slice(0, 300)}`);

  const contentType = createRes.headers.get("content-type") ?? "";
  if (/video\//i.test(contentType)) {
    const bytes = Buffer.from(await createRes.arrayBuffer());
    if (!bytes.length) throw new Error("视频接口返回空文件");
    fs.writeFileSync(output, bytes);
    return;
  }

  const created = await parseJsonResponse(createRes);
  const directUrl = extractVideoUrl(created);
  if (directUrl) {
    await download(config, directUrl, output);
    return;
  }

  const taskId = extractTaskId(created);
  if (!taskId) throw new Error("视频接口未返回任务 id 或视频地址");
  const deadline = Date.now() + config.pollTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error("视频生成超时");
    await new Promise<void>((resolve) => setTimeout(resolve, config.pollIntervalMs));
    const pollRes = await fetch(`${config.baseUrl}/${config.taskPath.replace(/^\/+/, "").replace("{id}", encodeURIComponent(taskId))}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(config.pollIntervalMs + 10_000),
    });
    if (!pollRes.ok) throw new Error(`视频任务查询失败: ${pollRes.status}`);
    const statusJson = await parseJsonResponse(pollRes);
    const status = extractStatus(statusJson);
    if (isFailure(status)) throw new Error(`视频生成失败: ${status}`);
    const url = extractVideoUrl(statusJson);
    if (url || isSuccess(status)) {
      if (!url) throw new Error("视频任务已完成但没有视频地址");
      await download(config, url, output);
      return;
    }
  }
}
