import { describe, expect, it } from "vitest";
import { bestAlignment, downsample, estimateAudioOffset, subsample } from "./av-sync-analyzer";

class FakeAudioBuffer {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  private readonly channels: Float32Array[];

  constructor(channels: Float32Array[], sampleRate: number) {
    this.channels = channels;
    this.sampleRate = sampleRate;
    this.length = channels[0].length;
    this.numberOfChannels = channels.length;
  }

  getChannelData(index: number): Float32Array {
    return this.channels[Math.max(0, Math.min(index, this.channels.length - 1))];
  }
}

function bufferFrom(samples: Float32Array, sampleRate: number): FakeAudioBuffer {
  return new FakeAudioBuffer([samples], sampleRate);
}

function tone(freq: number, seconds: number, rate: number): Float32Array {
  // Deterministic 50ms noise-fingerprint envelope makes the signal uniquely
  // alignable inside the ±2s search window (no quasi-periodic ambiguity).
  const out = new Float32Array(Math.round(seconds * rate));
  let seed = 0x2f6e2b1;
  const windowSamples = Math.round(0.05 * rate);
  for (let i = 0; i < out.length; i++) {
    if (i % windowSamples === 0) {
      // xorshift for reproducibility
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    }
    const envelope = 0.25 + 0.75 * ((seed >>> 0) % 1000) / 1000;
    out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * envelope;
  }
  return out;
}

describe("downsample", () => {
  it("halves the length when rate halves", () => {
    const input = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1]);
    const out = downsample(input, 8000, 4000);
    expect(out.length).toBe(4);
    expect(out[0]).toBeCloseTo(0, 5);
  });
});

describe("subsample", () => {
  it("keeps every Nth sample without averaging", () => {
    const input = new Float32Array([1, 9, 2, 9, 3, 9, 4, 9]);
    const out = subsample(input, 8000, 4000);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
  });
});

describe("crossCorrelateCoarse", () => {
  it("finds the lag of a shifted pulse", () => {
    const haystack = new Float32Array(200);
    haystack[120] = 1;
    haystack[121] = 1;
    haystack[122] = 1;
    const needle = new Float32Array(30);
    needle[0] = 1;
    needle[1] = 1;
    needle[2] = 1;
    const { lag } = bestAlignment(needle, haystack, 100, 180);
    expect(lag).toBe(120);
  });
});

describe("estimateAudioOffset", () => {
  it("detects a 0.25s lag between synthetic signals", () => {
    const rate = 48000;
    const reference = tone(220, 10, rate);
    const lagSamples = Math.round(0.25 * rate);
    const target = new Float32Array(reference.length + lagSamples);
    target.set(reference, lagSamples);

    const result = estimateAudioOffset(
      bufferFrom(reference, rate) as unknown as AudioBuffer,
      bufferFrom(target, rate) as unknown as AudioBuffer,
      2,
    );
    expect(Math.abs(result.offsetSec - 0.25)).toBeLessThanOrEqual(0.002);
    expect(result.confidence).toBeGreaterThan(1.3);
  });

  it("returns zero offset for identical buffers", () => {
    const rate = 48000;
    const reference = tone(300, 6, rate);
    const result = estimateAudioOffset(
      bufferFrom(reference, rate) as unknown as AudioBuffer,
      bufferFrom(reference.slice(), rate) as unknown as AudioBuffer,
      2,
    );
    expect(Math.abs(result.offsetSec)).toBeLessThanOrEqual(0.002);
  });
});
