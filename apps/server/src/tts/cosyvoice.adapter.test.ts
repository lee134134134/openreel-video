import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PluginContext } from "@openreel/plugin-sdk";
import {
  CosyvoiceTtsAdapter,
  cosyvoiceInstruction,
  cosyvoiceDefaultSpeed,
  cosyvoiceLoudnormFilter,
  COSYVOICE_EMOTION_INSTRUCTIONS,
  DEFAULT_COSYVOICE_INSTRUCTION,
} from "./cosyvoice.adapter";
import { probeAudioDuration, run } from "../render/ffmpeg.utils";

vi.mock("../render/ffmpeg.utils", () => ({
  run: vi.fn(async (args: string[]) => {
    const out = args[args.length - 1];
    if (out) fs.writeFileSync(out, Buffer.alloc(0));
    return { code: 0, stdout: "", stderr: "" };
  }),
  probeAudioDuration: vi.fn(async () => 2.5),
}));

let dir: string | undefined;
const originalUrl = process.env.COSYVOICE_URL;
afterEach(() => {
  vi.unstubAllGlobals();
  process.env.COSYVOICE_URL = originalUrl;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("cosyvoice instruction mapping", () => {
  it("maps plan emotion tokens to natural-language instructions", () => {
    for (const [token, instruction] of Object.entries(COSYVOICE_EMOTION_INSTRUCTIONS)) {
      expect(cosyvoiceInstruction({ voiceId: "x", emotion: token })).toBe(instruction);
    }
  });

  it("applies styledegree as intensity hints", () => {
    expect(cosyvoiceInstruction({ voiceId: "x", emotion: "cheerful", styleDegree: 1.5 })).toContain("强烈");
    expect(cosyvoiceInstruction({ voiceId: "x", emotion: "sad", styleDegree: 0.6 })).toContain("含蓄");
    expect(cosyvoiceInstruction({ voiceId: "x", emotion: "calm" })).not.toContain("强烈");
  });

  it("passes free-form Chinese instructions and drops garbage", () => {
    expect(cosyvoiceInstruction({ voiceId: "x", emotion: "用激动的语气说这句话" })).toBe("用激动的语气说这句话");
    expect(cosyvoiceInstruction({ voiceId: "x", emotion: "cheerful'; DROP" })).toBeUndefined();
    expect(cosyvoiceInstruction({ voiceId: "x" })).toBeUndefined();
  });
});

describe("CosyvoiceTtsAdapter", () => {
  it("posts text/instruction/speed to the service and normalizes to wav", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from([1, 2, 3]), { status: 200 })));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-cosy-"));
    const result = await new CosyvoiceTtsAdapter().synthesize(
      "你好世界",
      { voiceId: "mock", emotion: "cheerful", speed: 1.1 },
      { dir, basename: "c1" },
      {} as PluginContext,
    );
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/tts");
    expect(JSON.parse(init.body)).toEqual({ text: "你好世界", instruction: COSYVOICE_EMOTION_INSTRUCTIONS.cheerful, speed: 1.1, promptWav: undefined });
    const convertArgs = (run as ReturnType<typeof vi.fn>).mock.calls[0][0] as string[];
    expect(convertArgs).toContain("-ar");
    expect(convertArgs).toContain("48000");
    expect(convertArgs).toContain("-af");
    expect(convertArgs[convertArgs.indexOf("-af") + 1]).toContain("loudnorm=I=-16");
    expect(result.audioPath).toBe(path.join(dir, "c1.wav"));
    expect(result.durationSec).toBe(2.5);
  });

  it("falls back to the steady instruction and default speed without options", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from([1, 2, 3]), { status: 200 })));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-cosy-"));
    const originalSpeed = process.env.COSYVOICE_SPEED;
    delete process.env.COSYVOICE_SPEED;
    try {
      await new CosyvoiceTtsAdapter().synthesize("你好世界", { voiceId: "mock" }, { dir, basename: "c2" }, {} as PluginContext);
      const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.instruction).toBe(DEFAULT_COSYVOICE_INSTRUCTION);
      expect(body.speed).toBe(0.95);
      expect(cosyvoiceDefaultSpeed()).toBe(0.95);
    } finally {
      if (originalSpeed === undefined) delete process.env.COSYVOICE_SPEED;
      else process.env.COSYVOICE_SPEED = originalSpeed;
    }
  });

  it("allows overriding or disabling loudness normalization", () => {
    const original = process.env.COSYVOICE_LOUDNORM;
    try {
      process.env.COSYVOICE_LOUDNORM = "volume=2.0";
      expect(cosyvoiceLoudnormFilter()).toBe("volume=2.0");
      process.env.COSYVOICE_LOUDNORM = "";
      expect(cosyvoiceLoudnormFilter()).toBe("");
    } finally {
      if (original === undefined) delete process.env.COSYVOICE_LOUDNORM;
      else process.env.COSYVOICE_LOUDNORM = original;
    }
  });

  it("locks the steady preset when COSYVOICE_LOCK_STEADY=1", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(Buffer.from([1, 2, 3]), { status: 200 })));
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-tts-cosy-"));
    process.env.COSYVOICE_LOCK_STEADY = "1";
    const originalStyle = process.env.COSYVOICE_STYLE;
    delete process.env.COSYVOICE_STYLE;
    try {
      await new CosyvoiceTtsAdapter().synthesize(
        "你好世界",
        { voiceId: "mock", emotion: "cheerful", speed: 1.3 },
        { dir, basename: "c3" },
        {} as PluginContext,
      );
      const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.instruction).toBe(DEFAULT_COSYVOICE_INSTRUCTION);
      expect(body.speed).toBe(cosyvoiceDefaultSpeed());
    } finally {
      delete process.env.COSYVOICE_LOCK_STEADY;
      if (originalStyle === undefined) delete process.env.COSYVOICE_STYLE;
      else process.env.COSYVOICE_STYLE = originalStyle;
    }
  });

  it("wraps connection failures in a start-the-service hint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(
      new CosyvoiceTtsAdapter().synthesize("t", { voiceId: "x" }, { dir: ".", basename: "z" }, {} as PluginContext),
    ).rejects.toThrow(/CosyVoice 服务不可达/);
  });
});
