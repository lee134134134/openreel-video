import { Injectable, Logger } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import type { VideogenClip, VideogenScenePlan } from "@openreel/plugin-sdk";
import { SettingsService } from "../config/settings.module";
import { TtsRegistry } from "../registry/registry.module";
import { run } from "../render/ffmpeg.utils";
import { synthesizeDefault } from "../tts/adapter-context";
import type { LocalVideogenAdapter } from "../registry/registry.module";

interface SceneOptions {
  outDir: string;
  width: number;
  height: number;
  fps: number;
  voiceId?: string;
}

@Injectable()
export class LocalComposeAdapter implements LocalVideogenAdapter {
  readonly id = "local-compose";
  readonly label = "本地图片 + TTS 合成";
  private readonly logger = new Logger(LocalComposeAdapter.name);

  constructor(private readonly tts: TtsRegistry, private readonly settings: SettingsService) {}

  async generateScene(scene: VideogenScenePlan, options: SceneOptions): Promise<VideogenClip> {
    fs.mkdirSync(options.outDir, { recursive: true });
    const index = Math.max(0, Math.round(scene.index));
    const mediaPath = path.join(options.outDir, `scene-${index}.png`);
    if (process.env.IMAGE_BASE_URL && process.env.IMAGE_API_KEY) {
      try {
        await this.generateImage(scene.visualPrompt, options.width, options.height, mediaPath);
      } catch (err) {
        this.logger.warn(`image generation failed for scene ${index}; using local card: ${String((err as Error)?.message ?? err)}`);
        await this.generateCard(options.width, options.height, mediaPath);
      }
    } else {
      await this.generateCard(options.width, options.height, mediaPath);
    }
    const audio = await synthesizeDefault(this.tts, scene.narration, {
      voiceId: options.voiceId || "mock",
    }, { dir: options.outDir, basename: `scene-${index}-audio` });
    return {
      sceneIndex: scene.index,
      mediaPath,
      kind: "image",
      audioPath: audio.audioPath,
      durationSec: Math.max(audio.durationSec + 0.3, scene.durationSec),
      subtitle: scene.subtitle ?? scene.narration,
    };
  }

  private async generateCard(width: number, height: number, output: string): Promise<void> {
    const result = await run([
      "-y", "-f", "lavfi", "-i", `color=c=0x26263a:s=${width}x${height}`,
      "-frames:v", "1", "-update", "1", output,
    ], { command: this.settings.settings.ffmpegPath, timeoutSec: 30 });
    if (result.code !== 0 || !fs.existsSync(output)) throw new Error(`场景卡片生成失败: ${result.stderr.slice(-600)}`);
  }

  private async generateImage(prompt: string, width: number, height: number, output: string): Promise<void> {
    const base = process.env.IMAGE_BASE_URL!.replace(/\/$/, "");
    const ratio = width / height;
    const size = ratio === 1 ? "1024x1024" : ratio >= 1.5 ? "1792x1024" : ratio <= 0.67 ? "1024x1792" : "1024x1280";
    const res = await fetch(`${base}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.IMAGE_API_KEY}` },
      body: JSON.stringify({ model: process.env.IMAGE_MODEL || "gpt-image-1", prompt, size, response_format: "b64_json" }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`图片生成接口 ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const image = json.data?.[0];
    let bytes: Buffer;
    if (image?.b64_json) bytes = Buffer.from(image.b64_json, "base64");
    else if (image?.url) {
      const download = await fetch(image.url, { signal: AbortSignal.timeout(60000) });
      if (!download.ok) throw new Error(`图片下载失败: ${download.status}`);
      bytes = Buffer.from(await download.arrayBuffer());
    } else throw new Error("图片生成接口未返回 b64_json 或 url");
    fs.writeFileSync(output, bytes);
  }
}
