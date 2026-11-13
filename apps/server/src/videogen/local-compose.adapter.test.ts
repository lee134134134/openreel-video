import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import type { VideogenPlan } from "@openreel/plugin-sdk";
import { LocalComposeAdapter } from "./local-compose.adapter";
import { MockTtsAdapter } from "../tts/mock-tts.adapter";
import { TtsRegistry, VideogenRegistry } from "../registry/registry.module";
import { SettingsService } from "../config/settings.module";
import { probeAudioDuration } from "../render/ffmpeg.utils";

const ffmpegReady = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
const temporary: string[] = [];
afterEach(() => { while (temporary.length) fs.rmSync(temporary.pop()!, { recursive: true, force: true }); });
if (process.env.OPENREEL_TEST_FULL !== "1") console.info("Skipping full videogen e2e; set OPENREEL_TEST_FULL=1 to enable it.");

describe("local compose adapter", () => {
  it.skipIf(!ffmpegReady)("creates real PNG and WAV artifacts offline", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-scene-test-"));
    temporary.push(dir);
    const tts = new TtsRegistry();
    tts.register(new MockTtsAdapter());
    const adapter = new LocalComposeAdapter(tts, new SettingsService());
    const clip = await adapter.generateScene({ index: 0, narration: "你好世界", durationSec: 2, visualPrompt: "lavender" }, {
      outDir: dir, width: 320, height: 180, fps: 30, voiceId: "test-voice",
    });
    expect(fs.readFileSync(clip.mediaPath).subarray(1, 4).toString()).toBe("PNG");
    expect(clip.audioPath && fs.existsSync(clip.audioPath)).toBe(true);
    expect(clip.durationSec).toBeGreaterThanOrEqual(2);
    expect(clip.subtitle).toBe("你好世界");
    expect(await probeAudioDuration(clip.audioPath!)).toBeGreaterThan(0);
  });

  it.skipIf(!ffmpegReady || process.env.OPENREEL_TEST_FULL !== "1")("runs two scenes through the database and render queue", async () => {
    // Vite 5 does not externalize node:sqlite. Loading this opt-in integration
    // through ts-node keeps the normal unit-test transform fully offline.
    const req = createRequire(path.join(process.cwd(), "package.json"));
    req("ts-node/register/transpile-only");
    const { SqliteService } = req("./src/database/database.module.ts") as typeof import("../database/database.module");
    const { StorageService } = req("./src/storage/storage.service.ts") as typeof import("../storage/storage.service");
    const { RenderService } = req("./src/render/render.service.ts") as typeof import("../render/render.service");
    const { RenderQueueService } = req("./src/render/queue.service.ts") as typeof import("../render/queue.service");
    const { VideogenService } = req("./src/videogen/videogen.service.ts") as typeof import("../videogen/videogen.service");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openreel-full-test-"));
    temporary.push(dir);
    const oldDir = process.env.OPENREEL_DATA_DIR;
    process.env.OPENREEL_DATA_DIR = dir;
    const settings = new SettingsService();
    const sqlite = new SqliteService(settings);
    try {
      const storage = new StorageService(sqlite, settings);
      const render = new RenderService(sqlite, settings, storage);
      const queue = new RenderQueueService(render, settings, storage);
      queue.onModuleInit();
      const tts = new TtsRegistry();
      tts.register(new MockTtsAdapter());
      const registry = new VideogenRegistry();
      registry.register(new LocalComposeAdapter(tts, settings));
      const service = new VideogenService(sqlite, registry, storage, settings, render);
      const plan: VideogenPlan = {
        options: { title: "e2e", aspectRatio: "1:1", fps: 24, resolution: 720, ttsVoiceId: "mock" },
        scenes: [0, 1].map((index) => ({ index, narration: `场景${index}`, durationSec: 2, visualPrompt: "card" })),
        estimatedDurationSec: 4,
      };
      const job = service.create(plan);
      const result = await service.execute(job.id);
      expect(result?.state).toBe("done");
      expect(result?.videoUrl).toMatch(/^\/api\/files\/jobs\/.+\.mp4$/);
      queue.onModuleDestroy();
    } finally {
      sqlite.onModuleDestroy();
      if (oldDir === undefined) delete process.env.OPENREEL_DATA_DIR; else process.env.OPENREEL_DATA_DIR = oldDir;
    }
  }, 120000);
});
