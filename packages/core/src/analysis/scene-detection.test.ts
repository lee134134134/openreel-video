import { describe, expect, it } from "vitest";
import {
  chiSquareDistance,
  findSceneBoundaries,
  histogramFromImageData,
  rgbToBin,
  sceneThresholdPreset,
} from "./scene-detection";

function solidFrame(r: number, g: number, b: number, pixelCount: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("rgbToBin", () => {
  it("maps pure colors to distinct bins", () => {
    const red = rgbToBin(255, 0, 0);
    const green = rgbToBin(0, 255, 0);
    const blue = rgbToBin(0, 0, 255);
    const black = rgbToBin(0, 0, 0);
    expect([red, green, blue, black].every((bin) => bin >= 0 && bin < 256)).toBe(true);
    expect(new Set([red, green, blue, black]).size).toBe(4);
  });
});

describe("histogramFromImageData", () => {
  it("is normalized and concentrated for a solid frame", () => {
    const pixels = 100;
    const histogram = histogramFromImageData(solidFrame(10, 10, 10, pixels));
    let sum = 0;
    for (const value of histogram) sum += value;
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe("chiSquareDistance", () => {
  it("is zero for identical histograms", () => {
    const a = histogramFromImageData(solidFrame(255, 0, 0, 64));
    expect(chiSquareDistance(a, a)).toBe(0);
  });

  it("is large for disjoint solid colors", () => {
    const a = histogramFromImageData(solidFrame(255, 0, 0, 64));
    const b = histogramFromImageData(solidFrame(0, 0, 255, 64));
    expect(chiSquareDistance(a, b)).toBeGreaterThan(0.9);
  });
});

describe("findSceneBoundaries", () => {
  const options = { durationSec: 4, sampleFps: 4, threshold: 0.35, minSceneSec: 0.5 };

  it("returns one span when distances never exceed the threshold", () => {
    const scenes = findSceneBoundaries([0, 0.1, 0.2, 0.1, 0, 0.05, 0.1, 0.05, 0], options);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ start: 0, end: 4 });
  });

  it("splits on a spike and keeps the spike as the span score", () => {
    // 4 fps, 4s → 16 steps + 1. Cut at 2s (frame 8).
    const distances = new Array(17).fill(0.05);
    distances[8] = 1.2;
    const scenes = findSceneBoundaries(distances, options);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ start: 0, end: 2, score: 0.05 });
    expect(scenes[1]).toMatchObject({ start: 2, end: 4, score: 1.2 });
  });

  it("merges cuts closer than minSceneSec keeping the strongest", () => {
    const distances = new Array(17).fill(0.05);
    distances[8] = 0.6; // 2.0s
    distances[9] = 1.4; // 2.25s (< 0.5s later)
    const scenes = findSceneBoundaries(distances, options);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].end).toBeCloseTo(2.25, 3);
    expect(scenes[1].start).toBeCloseTo(2.25, 3);
  });

  it("drops sub-minimum trailing spans", () => {
    const distances = new Array(17).fill(0.05);
    distances[15] = 1.0; // cut at 3.75s → last span 0.25s < minSceneSec
    const scenes = findSceneBoundaries(distances, options);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].end).toBeCloseTo(4, 5);
  });
});

describe("sceneThresholdPreset", () => {
  it("maps presets", () => {
    expect(sceneThresholdPreset("low")).toBe(0.25);
    expect(sceneThresholdPreset("medium")).toBe(0.35);
    expect(sceneThresholdPreset("high")).toBe(0.5);
  });
});
