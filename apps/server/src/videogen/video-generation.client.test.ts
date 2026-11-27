import { afterEach, describe, expect, it } from "vitest";
import { readVideoGenConfig } from "./video-generation.client";

const keys = ["VIDEO_BASE_URL", "VIDEO_API_KEY", "VIDEO_MODEL", "VIDEO_MODE", "VIDEO_PAYLOAD_STYLE"] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe("video generation config", () => {
  it("stays disabled unless both URL and key are present", () => {
    delete process.env.VIDEO_BASE_URL;
    delete process.env.VIDEO_API_KEY;
    expect(readVideoGenConfig()).toBeUndefined();
    process.env.VIDEO_BASE_URL = "https://video.example.com/";
    expect(readVideoGenConfig()).toBeUndefined();
    process.env.VIDEO_API_KEY = "k";
    expect(readVideoGenConfig()?.baseUrl).toBe("https://video.example.com");
  });

  it("normalizes mode, style and polling defaults", () => {
    process.env.VIDEO_BASE_URL = "https://video.example.com";
    process.env.VIDEO_API_KEY = "k";
    process.env.VIDEO_MODE = "i2v";
    process.env.VIDEO_PAYLOAD_STYLE = "kling";
    const config = readVideoGenConfig()!;
    expect(config.mode).toBe("i2v");
    expect(config.payloadStyle).toBe("kling");
    expect(config.createPath).toBe("/v1/videos/generations");
    expect(config.pollIntervalMs).toBe(2000);
    expect(config.pollTimeoutMs).toBe(180_000);
  });
});
