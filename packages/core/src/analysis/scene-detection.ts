export interface SceneSpan {
  readonly start: number;
  readonly end: number;
  /** Peak inter-frame χ² distance inside the span (0..~2). */
  readonly score: number;
}

export interface SceneDetectionOptions {
  /** Sample rate for boundary analysis. 4 fps is enough for cut detection. */
  sampleFps?: number;
  /** χ² distance threshold; see `sceneThresholdPreset`. */
  threshold?: number;
  /** Minimum scene length in seconds. */
  minSceneSec?: number;
  /** Downscaled sample width; height follows the video aspect. */
  sampleWidth?: number;
  signal?: AbortSignal;
}

export interface SceneDetectionResult {
  readonly scenes: SceneSpan[];
  readonly frameCount: number;
  readonly distances: number[];
}

export interface SceneDetectionInput extends SceneDetectionOptions {
  videoUrl: string;
  durationSec: number;
}

/** H×S×V histogram bin layout: 16 hue × 4 sat × 4 val = 256 bins. */
export const HISTOGRAM_BINS = 256;

const SAMPLE_HEIGHT = 27;
const SEEK_TIMEOUT_MS = 2000;

/** Convert RGB (0..255) to a histogram bin index. */
export function rgbToBin(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const hBin = Math.min(15, Math.floor((h / 360) * 16));
  const sBin = Math.min(3, Math.floor(s * 4));
  const vBin = Math.min(3, Math.floor(v * 4));
  return (hBin * 4 + sBin) * 4 + vBin;
}

/** Normalized H/S/V histogram of a downscaled frame. */
export function histogramFromImageData(data: Uint8ClampedArray): Float32Array {
  const bins = new Float32Array(HISTOGRAM_BINS);
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    bins[rgbToBin(data[i], data[i + 1], data[i + 2])] += 1;
  }
  if (pixels > 0) {
    for (let i = 0; i < bins.length; i++) bins[i] /= pixels;
  }
  return bins;
}

/** Symmetric χ² distance between two normalized histograms (0..~2). */
export function chiSquareDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const denom = a[i] + b[i];
    if (denom > 0) {
      const diff = a[i] - b[i];
      sum += (diff * diff) / denom;
    }
  }
  return sum * 0.5;
}

/** Build a scene list from boundary-triggering distances. */
export function findSceneBoundaries(
  distances: readonly number[],
  options: { durationSec: number; sampleFps: number; threshold: number; minSceneSec: number },
): SceneSpan[] {
  const { durationSec, sampleFps, threshold, minSceneSec } = options;
  const minFrames = Math.max(1, Math.round(minSceneSec * sampleFps));
  // Candidate boundaries: frame index i means a cut before frame i.
  const candidates: { frame: number; strength: number }[] = [];
  for (let i = 1; i < distances.length; i++) {
    if (distances[i] > threshold) candidates.push({ frame: i, strength: distances[i] });
  }
  // Merge candidates closer than minSceneSec, keeping the strongest.
  const boundaries: number[] = [];
  for (const candidate of candidates) {
    const last = boundaries[boundaries.length - 1];
    if (last !== undefined && candidate.frame - last < minFrames) {
      if (candidate.strength > (distances[last] ?? 0)) boundaries[boundaries.length - 1] = candidate.frame;
    } else {
      boundaries.push(candidate.frame);
    }
  }

  const cuts = [0, ...boundaries.map((frame) => frame / sampleFps), durationSec];
  const spans: SceneSpan[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i];
    const end = cuts[i + 1];
    if (end - start < MIN_SPAN_SEC) continue;
    const from = Math.max(0, Math.ceil(start * sampleFps));
    const to = Math.min(distances.length, Math.ceil(end * sampleFps));
    let score = 0;
    for (let d = from; d < to; d++) score = Math.max(score, distances[d] ?? 0);
    spans.push({ start, end, score: Number(score.toFixed(4)) });
  }
  // Merge spans shorter than minSceneSec into a neighbor so no tiny tail remains.
  const scenes: SceneSpan[] = [];
  for (const span of spans) {
    if (span.end - span.start < minSceneSec && scenes.length > 0) {
      const previous = scenes[scenes.length - 1];
      scenes[scenes.length - 1] = {
        start: previous.start,
        end: span.end,
        score: Number(Math.max(previous.score, span.score).toFixed(4)),
      };
      continue;
    }
    scenes.push({ ...span });
  }
  return scenes;
}

const MIN_SPAN_SEC = 0.2;

export type SceneThresholdPreset = "low" | "medium" | "high";

export function sceneThresholdPreset(preset: SceneThresholdPreset): number {
  switch (preset) {
    case "low":
      return 0.25;
    case "high":
      return 0.5;
    default:
      return 0.35;
  }
}

function waitSeeked(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      window.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Scene detection aborted"));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      // Tolerate a stalled seek: keep sampling rather than fail the whole pass.
      resolve();
    }, SEEK_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort);
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

async function captureHistogram(video: HTMLVideoElement, canvas: HTMLCanvasElement, width: number, height: number): Promise<Float32Array> {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(video, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return histogramFromImageData(data);
}

/**
 * Detect scene cuts in a video by sampling frames and comparing HSV
 * histograms. Runs entirely in the browser (works in Electron renderers too).
 * Aborts cleanly via `options.signal`.
 */
export async function detectScenes(input: SceneDetectionInput): Promise<SceneDetectionResult> {
  const {
    videoUrl,
    durationSec,
    sampleFps = 4,
    threshold = sceneThresholdPreset("medium"),
    minSceneSec = 0.5,
    sampleWidth = 48,
    signal,
  } = input;
  if (!(durationSec > 0)) return { scenes: [], frameCount: 0, distances: [] };

  const video = document.createElement("video");
  video.src = videoUrl;
  video.muted = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";

  const canvas = document.createElement("canvas");


  try {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("Video failed to load for scene detection"));
      };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
      };
      if (video.readyState >= 2) {
        resolve();
        return;
      }
      video.addEventListener("loadeddata", onReady);
      video.addEventListener("error", onError);
      video.load();
    });
    if (signal?.aborted) throw new Error("Scene detection aborted");

    const step = 1 / sampleFps;
    const frameCount = Math.max(1, Math.floor(durationSec * sampleFps));
    const distances: number[] = [0]; // distance for frame 0 is 0
    let previous = await captureHistogram(video, canvas, sampleWidth, SAMPLE_HEIGHT);

    for (let frame = 1; frame <= frameCount; frame++) {
      if (signal?.aborted) throw new Error("Scene detection aborted");
      const time = Math.min(durationSec - 1e-3, frame * step);
      await waitSeeked(video, time, signal);
      const current = await captureHistogram(video, canvas, sampleWidth, SAMPLE_HEIGHT);
      distances.push(chiSquareDistance(previous, current));
      previous = current;
    }

    const scenes = findSceneBoundaries(distances, { durationSec, sampleFps, threshold, minSceneSec });
    return { scenes, frameCount: frameCount + 1, distances };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
