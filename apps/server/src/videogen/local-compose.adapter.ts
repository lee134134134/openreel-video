import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { VideogenClip, VideogenScenePlan } from "@openreel/plugin-sdk";
import { SettingsService } from "../config/settings.module";
import { TtsRegistry } from "../registry/registry.module";
import { run } from "../render/ffmpeg.utils";
import { detectSubtitleSupport, escapeFilterPath } from "../render/subtitles";
import { escapeDrawtext } from "../render/args";
import { synthesizeDefault } from "../tts/adapter-context";
import type { LocalVideogenAdapter } from "../registry/registry.module";
import { OpencodeClient } from "../llm/opencode.client";

const execFileAsync = promisify(execFile);

function placeholderFallback(err: unknown): string | undefined {
  const message = String((err as Error)?.message ?? err);
  return message.length > 120 ? `${message.slice(0, 120)}…` : message;
}

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

  constructor(
    private readonly tts: TtsRegistry,
    private readonly settings: SettingsService,
    private readonly llm: OpencodeClient,
  ) {}

  async generateScene(scene: VideogenScenePlan, options: SceneOptions): Promise<VideogenClip> {
    fs.mkdirSync(options.outDir, { recursive: true });
    const index = Math.max(0, Math.round(scene.index));
    const mediaPath = path.join(options.outDir, `scene-${index}.png`);
    let placeholderCard = false;
    if (process.env.IMAGE_BASE_URL && process.env.IMAGE_API_KEY) {
      try {
        await this.generateImage(scene.visualPrompt, options.width, options.height, mediaPath);
      } catch (err) {
        this.logger.warn(`image generation failed for scene ${index}; trying LLM illustration: ${String((err as Error)?.message ?? err)}`);
        placeholderCard = !(await this.tryIllustration(scene, options, mediaPath, placeholderFallback(err)));
      }
    } else {
      placeholderCard = !(await this.tryIllustration(scene, options, mediaPath, undefined));
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
      placeholder: placeholderCard,
    };
  }

  /** LLM illustration pipeline: the opencode2 text model authors a flat SVG
   * scene from the visual prompt, then headless Chrome rasterizes it to the
   * exact frame size. Falls back to the placeholder card on any failure. */
  private async tryIllustration(
    scene: VideogenScenePlan,
    options: SceneOptions,
    mediaPath: string,
    reasonForPlaceholder?: string,
  ): Promise<boolean> {
    if (!process.env.OPENCODE_API_KEY) {
      await this.generateCard(options.width, options.height, mediaPath, scene.subtitle ?? scene.narration);
      return false;
    }
    try {
      const svg = await this.generateSceneSvg(scene, options);
      await this.renderSvgToPng(svg, options.width, options.height, mediaPath);
      if (!fs.existsSync(mediaPath) || fs.statSync(mediaPath).size === 0) throw new Error("渲染结果为空");
      return true;
    } catch (err) {
      this.logger.warn(`LLM illustration failed for scene ${scene.index}; using placeholder card: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
      await this.generateCard(options.width, options.height, mediaPath, reasonForPlaceholder ? `占位画面 · ${reasonForPlaceholder}` : (scene.subtitle ?? scene.narration));
      return false;
    }
  }

  private async generateSceneSvg(scene: VideogenScenePlan, options: SceneOptions): Promise<string> {
    const width = options.width;
    const height = options.height;
    const prompt = [
      `为一段竖版视频第 ${Math.max(0, Math.round(scene.index))} 幕画扁平风格插画面板。`,
      `画面主题：${scene.visualPrompt || scene.narration}`,
      `旁白语境：${scene.narration}`,
      `画布：width="${width}" height="${height}"，viewBox="0 0 ${width} ${height}"。`,
      "要求：纯 SVG 矢量色块构图（渐变、几何形状、剪影均可），风格统一、层次分明；",
      "不要 <image>、不要外链资源、不要 <script>、不要滤镜动画；总代码量控制在 2500 字符以内。",
      "只输出 SVG 代码本身，从 <svg 开始到 </svg> 结束。",
    ].join("\n");
    const result = await this.llm.complete({
      model: process.env.OPENCODE_IMAGE_MODEL || process.env.OPENCODE_MODEL || "",
      messages: [
        { role: "system", content: "You are a meticulous SVG flat illustrator. Output ONLY raw SVG code: start with <svg and end with </svg>. Never wrap it in markdown." },
        { role: "user", content: prompt },
      ],
      maxTokens: 8000,
      temperature: 0.6,
    });
    const content = result.content ?? "";
    const fenced = /```(?:svg|xml)?\s*([\s\S]*?)```/.exec(content);
    const body = (fenced ? fenced[1] : content).trim();
    const match = /<svg[\s\S]*<\/svg>/.exec(body);
    if (!match) throw new Error("LLM 未返回 SVG 代码");
    return this.normalizeSvg(match[0], width, height);
  }

  /** Force the root element to the exact frame size so Chrome screenshots it 1:1. */
  private normalizeSvg(svg: string, width: number, height: number): string {
    let out = svg.trim();
    const openTagMatch = /<svg[^>]*>/i.exec(out);
    if (!openTagMatch) throw new Error("SVG 根元素无效");
    let openTag = openTagMatch[0];
    if (!/viewBox\s*=/i.test(openTag)) openTag = openTag.replace(/<svg/i, `<svg viewBox="0 0 ${width} ${height}"`);
    const sizeAttrs = `width="${width}" height="${height}"`;
    if (/width\s*=/i.test(openTag)) openTag = openTag.replace(/width\s*=\s*"[^"]*"/i, `width="${width}"`);
    else openTag = openTag.replace(/<svg/i, `<svg width="${width}"`);
    if (/height\s*=/i.test(openTag)) openTag = openTag.replace(/height\s*=\s*"[^"]*"/i, `height="${height}"`);
    else openTag = openTag.replace(/<svg/i, `<svg height="${height}"`);
    openTag = openTag.replace(/\s+(xmlns:xlink|width|height)\s*=\s*"([^"]*)"/gi, (attr) => attr);
    if (!/xmlns\s*=/.test(openTag)) openTag = openTag.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    out = out.replace(openTagMatch[0], `${openTag.replace(/\s\s+/g, " ")}\n<!-- ${sizeAttrs} -->`);
    return out;
  }

  private async renderSvgToPng(svg: string, width: number, height: number, output: string): Promise<void> {
    const chrome = process.env.CHROME_PATH
      || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "chromium");
    const svgPath = `${output}.svg`;
    fs.writeFileSync(svgPath, svg);
    try {
      await execFileAsync(chrome, [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-first-run",
        "--disable-extensions",
        `--screenshot=${output}`,
        `--window-size=${width},${height}`,
        "--default-background-color=FFFFFFFF",
        `file://${svgPath}`,
      ], { timeout: 60_000 });
    } catch (err) {
      // Chrome exits non-zero on some platforms even when the screenshot landed.
      if (!fs.existsSync(output)) throw new Error(`Chrome 渲染失败: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    } finally {
      fs.rmSync(svgPath, { force: true });
    }
  }

  private async generateCard(width: number, height: number, output: string, caption?: string): Promise<void> {
    const result = await run([
      "-y", "-f", "lavfi", "-i", `color=c=0x26263a:s=${width}x${height}`,
      "-frames:v", "1", "-update", "1", output,
    ], { command: this.settings.settings.ffmpegPath, timeoutSec: 30 });
    if (result.code !== 0 || !fs.existsSync(output)) throw new Error(`场景卡片生成失败: ${result.stderr.slice(-600)}`);
    if (!caption) return;
    // Overlay the scene caption so the placeholder card self-explains instead
    // of looking like a broken (all-dark) render. The local FFmpeg build may
    // ship libass without drawtext, so try drawtext first, then ass, and keep
    // the plain card when neither filter exists.
    const support = await detectSubtitleSupport(this.settings.settings.ffmpegPath);
    if (support === "none") return;
    const font = process.env.FFMPEG_DRAWTEXT_FONT || (process.platform === "darwin" ? "PingFang SC" : "sans");
    const badge = "占位画面 · 未配置图像生成";
    const text = (caption.trim().slice(0, 40) || "").replace(/[{}]/g, "");
    const assFile = `${output}-placeholder.ass`;
    const size = Math.max(18, Math.round(Math.min(width, height) * 0.042));
    let overlayArgs: string[] | null = null;
    if (support === "drawtext") {
      overlayArgs = [
        "-y", "-i", output,
        "-vf",
        `drawtext=font='${font}':text='${escapeDrawtext(badge)}':fontcolor=white@0.55:fontsize=${Math.round(size * 0.7)}:box=1:boxcolor=black@0.25:boxborderw=12:x=(w-text_w)/2:y=h*0.38,` +
        `drawtext=font='${font}':text='${escapeDrawtext(text)}':fontcolor=white:fontsize=${size}:borderw=2:bordercolor=black@0.75:box=1:boxcolor=black@0.35:boxborderw=10:x=(w-text_w)/2:y=h*0.5`,
        "-frames:v", "1", "-update", "1", `${output}-overlay.png`,
      ];
    } else {
      // Alignment=5 keeps both lines centered; the badge sits above the caption.
      const badgeMarginV = Math.round(height * 0.58);
      const captionMarginV = Math.round(height * 0.42);
      const esc = (value: string): string => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;");
      fs.writeFileSync(
        assFile,
        [
          "[Script Info]",
          "ScriptType: v4.00+",
          `PlayResX: ${width}`,
          `PlayResY: ${height}`,
          "",
          "[V4+ Styles]",
          "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
          `Style: Badge,${font},${Math.round(size * 0.7)},&H00FFFFFF,&H00000000,&HB4000000,1,1,0,5,20,20,${badgeMarginV},1`,
          `Style: Caption,${font},${size},&H00FFFFFF,&H00000000,&HB4000000,0,2,0,5,20,20,${captionMarginV},1`,
          "",
          "[Events]",
          "Format: Layer, Start, End, Style, Text",
          `Dialogue: 0,0:00:00.00,0:00:00.20,Badge,${esc(badge)}`,
          `Dialogue: 0,0:00:00.00,0:00:00.20,Caption,${esc(text)}`,
          "",
        ].join("\n"),
      );
      overlayArgs = [
        "-y", "-i", output,
        "-vf", `subtitles=filename='${escapeFilterPath(assFile)}'`,
        "-frames:v", "1", "-update", "1", `${output}-overlay.png`,
      ];
    }
    const drawn = await run(overlayArgs, { command: this.settings.settings.ffmpegPath, timeoutSec: 30 });
    if (drawn.code !== 0) this.logger.warn(`placeholder caption skipped: ${drawn.stderr.slice(-200)}`);
    else fs.renameSync(`${output}-overlay.png`, output);
    fs.rmSync(assFile, { force: true });
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
