/**
 * Audio offset estimation between two recordings of the same content
 * (e.g. a video clip's embedded audio vs. an external recorder's track).
 *
 * Stage 1 correlates a 5ms energy-envelope fingerprint (unique, broadband)
 * over ±maxOffsetSec; stage 2 refines with the 4 kHz waveform around the
 * coarse peak. Pure helpers are exported for testability.
 */

const WAVE_RATE = 4000;
const ENV_RATE = 200; // 5ms energy envelope
const WAVE_WINDOW_SEC = 2;
const ENV_WINDOW_SEC = 4;
const FINE_GUARD_SEC = 0.03;

export interface AudioOffsetResult {
  /** Positive means `target` lags behind `reference` by this many seconds. */
  readonly offsetSec: number;
  /** Peak / second-peak ratio, 1..∞; below ~1.3 is unreliable. */
  readonly confidence: number;
}

export function downsample(channel: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (targetRate >= sourceRate) return channel;
  const ratio = sourceRate / targetRate;
  const outLength = Math.floor(channel.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(channel.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += channel[j];
    out[i] = to > from ? sum / (to - from) : 0;
  }
  return out;
}

/**
 * Decimate by taking every Nth sample (no block averaging, so narrowband
 * carriers survive). Aliasing above targetRate/2 is accepted as a trade-off;
 * alignment mostly rides on the dominant low-frequency band.
 */
export function subsample(channel: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (targetRate >= sourceRate) return channel;
  const step = Math.max(1, Math.round(sourceRate / targetRate));
  const outLength = Math.floor((channel.length - 1) / step) + 1;
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) out[i] = channel[i * step];
  return out;
}

export interface AlignmentResult {
  /** Best needle start index inside the haystack. */
  readonly lag: number;
  readonly score: number;
  readonly secondScore: number;
}

/**
 * 5ms energy-envelope fingerprint at ENV_RATE: mean |sample| per block,
 * peak-normalized. Broadband and unique enough to disambiguate alignment.
 */
export function envelopeFingerprint(channel: Float32Array, sourceRate: number): Float32Array {
  const blockSize = Math.max(1, Math.round(sourceRate / ENV_RATE));
  const outLength = Math.floor(channel.length / blockSize);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    let sum = 0;
    for (let j = i * blockSize; j < (i + 1) * blockSize; j++) sum += Math.abs(channel[j]);
    out[i] = sum / blockSize;
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, out[i]);
  if (peak > 1e-9) {
    for (let i = 0; i < out.length; i++) out[i] /= peak;
  }
  return out;
}

function middleWindow(samples: Float32Array, rate: number, windowSec: number): { needle: Float32Array; start: number } {
  const windowSamples = Math.min(samples.length, Math.round(windowSec * rate));
  if (windowSamples < rate / 2) return { needle: new Float32Array(0), start: 0 };
  const start = Math.max(0, Math.floor((samples.length - windowSamples) / 2));
  return { needle: samples.slice(start, start + windowSamples), start };
}

/**
 * Estimate how much `target` must be shifted (later start) to align with
 * `reference`. Positive offsetSec = target lags reference.
 */
export function estimateAudioOffset(
  reference: AudioBuffer,
  target: AudioBuffer,
  maxOffsetSec = 2,
): AudioOffsetResult {
  if (maxOffsetSec <= 0) return { offsetSec: 0, confidence: 0 };

  const refEnv = envelopeFingerprint(channelOf(reference, 0), reference.sampleRate);
  const tgtEnv = envelopeFingerprint(channelOf(target, 0), target.sampleRate);
  const envWindow = middleWindow(refEnv, ENV_RATE, ENV_WINDOW_SEC);
  if (!envWindow.needle.length) return { offsetSec: 0, confidence: 0 };

  const maxLag = Math.ceil(maxOffsetSec * ENV_RATE);
  const envFrom = Math.max(0, envWindow.start - maxLag);
  const envTo = Math.min(tgtEnv.length - envWindow.needle.length, envWindow.start + maxLag);
  if (envTo < envFrom) return { offsetSec: 0, confidence: 0 };
  const coarse = bestAlignment(envWindow.needle, tgtEnv, envFrom, envTo);
  const coarseOffsetSamples = coarse.lag - envWindow.start;
  const confidence = coarse.score > 0 && coarse.secondScore > 0
    ? Number((coarse.score / coarse.secondScore).toFixed(3))
    : 0;

  // Waveform refinement at WAVE_RATE around the envelope coarse peak.
  const refWave = subsample(normalized(channelOf(reference, 0)), reference.sampleRate, WAVE_RATE);
  const tgtWave = subsample(normalized(channelOf(target, 0)), target.sampleRate, WAVE_RATE);
  const waveWindow = middleWindow(refWave, WAVE_RATE, WAVE_WINDOW_SEC);
  if (!waveWindow.needle.length) {
    return { offsetSec: Number((coarseOffsetSamples / ENV_RATE).toFixed(4)), confidence };
  }

  const scale = WAVE_RATE / ENV_RATE;
  const center = waveWindow.start + Math.round(coarseOffsetSamples * scale);
  const guard = Math.round(FINE_GUARD_SEC * WAVE_RATE);
  const fineFrom = Math.max(0, center - guard);
  const fineTo = Math.min(tgtWave.length - waveWindow.needle.length, center + guard);
  if (fineTo < fineFrom) {
    return { offsetSec: Number((coarseOffsetSamples / ENV_RATE).toFixed(4)), confidence };
  }
  const fine = bestAlignment(waveWindow.needle, tgtWave, fineFrom, fineTo);
  const offsetSec = (fine.lag - waveWindow.start) / WAVE_RATE;
  return { offsetSec: Number(offsetSec.toFixed(4)), confidence };
}

/** Direct sliding dot-product scan of `needle` across `haystack` start indices [from, to].
 * Scores are normalized by overlap length and DC-free, so short shifts are not
 * favored just because more samples overlap. */
export function bestAlignment(
  needle: Float32Array,
  haystack: Float32Array,
  from: number,
  to: number,
): AlignmentResult {
  // DC removal keeps periodic-tone windows from locking onto a constant bias.
  let needleMean = 0;
  for (let i = 0; i < needle.length; i++) needleMean += needle[i];
  needleMean /= needle.length || 1;
  const centered = new Float32Array(needle.length);
  for (let i = 0; i < needle.length; i++) centered[i] = needle[i] - needleMean;

  let lag = from;
  let bestScore = -Infinity;
  let bestDistantScore = -Infinity; // best score at a lag far from the peak
  for (let start = from; start <= to; start++) {
    let score = 0;
    let overlap = 0;
    for (let i = 0; i < centered.length; i++) {
      const index = start + i;
      if (index < 0 || index >= haystack.length) continue;
      score += centered[i] * haystack[index];
      overlap++;
    }
    score = overlap > 0 ? score / overlap : -Infinity;
    if (score > bestScore) {
      bestScore = score;
      lag = start;
    }
  }
  // Second-best must be at least needle.length/4 away from the peak, otherwise
  // a one-sample-shifted neighbour (99.99% aligned) always ties the peak.
  const guard = Math.max(1, Math.floor(centered.length / 4));
  for (let start = from; start <= to; start++) {
    if (Math.abs(start - lag) <= guard) continue;
    let score = 0;
    let overlap = 0;
    for (let i = 0; i < centered.length; i++) {
      const index = start + i;
      if (index < 0 || index >= haystack.length) continue;
      score += centered[i] * haystack[index];
      overlap++;
    }
    score = overlap > 0 ? score / overlap : -Infinity;
    if (score > bestDistantScore) bestDistantScore = score;
  }
  return { lag, score: bestScore, secondScore: bestDistantScore };
}

function channelOf(buffer: AudioBuffer, channel: number): Float32Array {
  return buffer.getChannelData(Math.min(channel, Math.max(0, buffer.numberOfChannels - 1)));
}

function normalized(buffer: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]));
  if (peak <= 1e-9) return buffer;
  const out = new Float32Array(buffer.length);
  const gain = 1 / peak;
  for (let i = 0; i < buffer.length; i++) out[i] = buffer[i] * gain;
  return out;
}

