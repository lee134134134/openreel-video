import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PluginContext } from "@openreel/plugin-sdk";
import { MockTtsAdapter } from "./mock-tts.adapter";

let dir: string | undefined;
afterEach(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); dir = undefined; });

describe("mock TTS", () => {
  it("writes a PCM WAV whose header duration exactly matches the result", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-test-"));
    const result = await new MockTtsAdapter().synthesize("一二三四五六七八九十一二三四五六七八九十", {
      voiceId: "voice-pass-through",
    }, { dir, basename: "sample" }, {} as PluginContext);
    const wav = fs.readFileSync(result.audioPath);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(22050);
    expect(wav.readUInt16LE(34)).toBe(16);
    const headerDuration = wav.readUInt32LE(40) / 2 / 22050;
    expect(result.durationSec).toBe(headerDuration);
    expect(result.durationSec).toBeCloseTo(1.8, 5);
    expect(result.voiceId).toBe("voice-pass-through");
  });
});
