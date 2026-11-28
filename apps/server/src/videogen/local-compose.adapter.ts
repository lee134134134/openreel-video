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
import { toSpokenNarration } from "../tts/spoken-text";
import type { LocalVideogenAdapter } from "../registry/registry.module";
import { OpencodeClient } from "../llm/opencode.client";

const execFileAsync = promisify(execFile);

interface SceneOptions {
  outDir: string;
  width: number;
  height: number;
  fps: number;
  voiceId?: string;
  /** Deck-wide template note from the planner; kept for plan compatibility. */
  continuity?: string;
  previousVisualPrompt?: string;
}

const ACCENT = "#0071E3";
const INK = "#1D1D1F";
const MUTED = "#86868B";
const BACKGROUND = "#F5F5F7";
const FONT = "-apple-system, 'SF Pro Display', 'PingFang SC', 'Helvetica Neue', Arial, sans-serif";

function sceneBeats(scene: VideogenScenePlan): string[] {
  const beats = (scene.beats ?? [])
    .map((beat) => String(beat ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (beats.length > 1) return beats;
  return [String(scene.subtitle ?? scene.narration ?? "").trim() || "要点"];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

@Injectable()
export class LocalComposeAdapter implements LocalVideogenAdapter {
  readonly id = "local-compose";
  readonly label = "Apple 风格静态幻灯片（代码生成）+ TTS 配音";
  private readonly logger = new Logger(LocalComposeAdapter.name);

  constructor(
    private readonly tts: TtsRegistry,
    private readonly settings: SettingsService,
    private readonly llm: OpencodeClient,
  ) {
    // The LLM authors the plan copy; slide artwork itself is drawn in code.
    void this.llm;
  }

  async generateScene(scene: VideogenScenePlan, options: SceneOptions): Promise<VideogenClip> {
    fs.mkdirSync(options.outDir, { recursive: true });
    const index = Math.max(0, Math.round(scene.index));
    const beats = sceneBeats(scene);
    let frames: string[];
    try {
      frames = await this.renderSlideFrames(scene, beats, options, index);
    } catch (err) {
      this.logger.warn(`代码生成幻灯片失败，改用占位卡: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
      frames = [];
      const card = path.join(options.outDir, `scene-${index}-beat-0.png`);
      await this.generateCard(options.width, options.height, card, scene.subtitle ?? scene.narration);
      frames.push(card);
    }

    const audio = await synthesizeDefault(this.tts, toSpokenNarration(scene.narration) || scene.narration, {
      voiceId: options.voiceId || "mock",
      emotion: scene.emotion,
    }, { dir: options.outDir, basename: `scene-${index}-audio` });

    return {
      sceneIndex: scene.index,
      mediaPath: frames[0],
      kind: "image",
      audioPath: audio.audioPath,
      durationSec: Math.max(audio.durationSec + 0.3, scene.durationSec),
      subtitle: scene.subtitle ?? scene.narration,
      frames,
      kind_meta: { keyframes: frames.length },
    };
  }

  /** Draw every slide state as an SVG in code, then rasterize with headless
   * Chrome. No image model and no video model are involved in the pictures. */
  private async renderSlideFrames(
    scene: VideogenScenePlan,
    beats: string[],
    options: SceneOptions,
    index: number,
  ): Promise<string[]> {
    const frames: string[] = [];
    for (let beat = 0; beat < beats.length; beat += 1) {
      const svg = this.buildSlideSvg(scene, beats, beat, options.width, options.height, index);
      const output = path.join(options.outDir, `scene-${index}-beat-${beat}.png`);
      await this.renderSvgToPng(svg, options.width, options.height, output);
      if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error("幻灯片渲染结果为空");
      frames.push(output);
    }
    if (!frames.length) throw new Error("没有生成任何幻灯片");
    return frames;
  }

  private buildSlideSvg(
    scene: VideogenScenePlan,
    beats: string[],
    beatIndex: number,
    width: number,
    height: number,
    sceneIndex: number,
  ): string {
    const portrait = height > width;
    const pad = Math.round(width * (portrait ? 0.09 : 0.075));
    const accentColor = ACCENT;
    const title = String(scene.slide?.title ?? "").trim().slice(0, 16)
      || String(scene.subtitle ?? scene.narration ?? "").trim().slice(0, 16)
      || "演示文稿";
    const rawBullets = scene.slide?.bullets?.length
      ? scene.slide.bullets
      : beats.map((beat) => String(beat).replace(/^[0-9]+[.、)]\s*/, "").trim());
    const bullets = rawBullets
      .map((bullet) => String(bullet ?? "").trim().slice(0, 20))
      .filter(Boolean)
      .slice(0, 3);
    const reveal = Math.max(1, Math.min(bullets.length || 1, beatIndex + 1));
    const diagram = scene.slide?.diagram ?? (["cards", "steps", "metrics", "outline"] as const)[sceneIndex % 4];
    const titleSize = Math.round((portrait ? 42 : 52) - Math.max(0, title.length - 8) * 1.5);
    const titleY = portrait ? Math.round(height * 0.2) : Math.round(height * 0.28);
    const bulletTop = titleY + Math.round(titleSize * 1.35);
    const diagramX = portrait ? pad : Math.round(width * 0.62);
    const diagramY = portrait ? Math.round(height * 0.58) : Math.round(height * 0.28);
    const diagramW = portrait ? width - pad * 2 : Math.round(width * 0.3);
    const diagramH = portrait ? Math.round(height * 0.24) : Math.round(height * 0.42);

    const bulletSvg = bullets.slice(0, reveal).map((bullet, i) => {
      const y = bulletTop + i * Math.round(height * (portrait ? 0.075 : 0.1));
      return [
        `<circle cx="${pad + 7}" cy="${y - 8}" r="5" fill="${accentColor}"/>`,
        `<text x="${pad + 28}" y="${y}" font-family="${FONT}" font-size="${portrait ? 24 : 28}" fill="${INK}">${escapeXml(bullet)}</text>`,
      ].join("");
    }).join("");

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect width="${width}" height="${height}" fill="${BACKGROUND}"/>`,
      `<text x="${pad}" y="${Math.round(height * 0.1)}" font-family="${FONT}" font-size="${portrait ? 16 : 18}" fill="${MUTED}">分享说明 · 第 ${sceneIndex + 1} 页</text>`,
      `<rect x="${pad}" y="${Math.round(height * 0.13)}" width="72" height="6" rx="3" fill="${accentColor}"/>`,
      `<text x="${pad}" y="${titleY}" font-family="${FONT}" font-size="${Math.max(30, titleSize)}" font-weight="600" fill="${INK}">${escapeXml(title)}</text>`,
      bulletSvg,
      this.diagramSvg(diagram, diagramX, diagramY, diagramW, diagramH, reveal, accentColor, MUTED, bullets),
      `<text x="${width - pad}" y="${height - Math.round(height * 0.07)}" text-anchor="end" font-family="${FONT}" font-size="${portrait ? 16 : 18}" fill="${MUTED}">${String(beatIndex + 1).padStart(2, "0")} / ${String(beats.length).padStart(2, "0")}</text>`,
      "</svg>",
    ].join("");
  }

  /** Minimal geometric diagrams, drawn with SVG primitives only. */
  private diagramSvg(
    kind: "cards" | "steps" | "metrics" | "outline",
    x: number,
    y: number,
    w: number,
    h: number,
    reveal: number,
    accent: string,
    muted: string,
    bullets: string[],
  ): string {
    if (kind === "steps") {
      const step = w / 3;
      const cy = y + h * 0.4;
      const parts = [
        `<line x1="${x + step / 2}" y1="${cy}" x2="${x + w - step / 2}" y2="${cy}" stroke="${muted}" stroke-width="2" stroke-dasharray="6 8"/>`,
      ];
      for (let i = 0; i < 3; i += 1) {
        const cx = x + step * (i + 0.5);
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${Math.min(step * 0.3, 34)}" fill="${i < reveal ? accent : BACKGROUND}" stroke="${accent}" stroke-width="3"/>`);
        parts.push(`<text x="${cx}" y="${cy + 8}" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="600" fill="${i < reveal ? "#FFFFFF" : accent}">${i + 1}</text>`);
        if (i < reveal && bullets[i]) {
          parts.push(`<text x="${cx}" y="${cy + 62}" text-anchor="middle" font-family="${FONT}" font-size="16" fill="${muted}">${escapeXml(bullets[i].slice(0, 8))}</text>`);
        }
      }
      return parts.join("");
    }
    if (kind === "metrics") {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) * 0.4;
      return [
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${muted}" stroke-width="10" opacity="0.35"/>`,
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${Math.round(2 * Math.PI * r * 0.75)} ${Math.round(2 * Math.PI * r)}" transform="rotate(-90 ${cx} ${cy})"/>`,
        `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="${FONT}" font-size="${Math.round(r * 0.7)}" font-weight="600" fill="${INK}">75%</text>`,
      ].join("");
    }
    if (kind === "outline") {
      const bw = w * 0.8;
      const bh = h * 0.55;
      const bx = x + (w - bw) / 2;
      const by = y + (h - bh) / 2;
      return [
        `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="18" fill="none" stroke="${accent}" stroke-width="4"/>`,
        `<rect x="${bx + bw * 0.55}" y="${by - 8}" width="${bw * 0.22}" height="12" rx="4" fill="${accent}"/>`,
        `<circle cx="${bx + bw * 0.5}" cy="${by + bh * 0.5}" r="${bh * 0.28}" fill="none" stroke="${accent}" stroke-width="4"/>`,
        `<circle cx="${bx + bw * 0.5}" cy="${by + bh * 0.5}" r="${bh * 0.12}" fill="${accent}" opacity="0.8"/>`,
      ].join("");
    }
    const cardH = Math.min(56, h / 3.6);
    const gap = (h - cardH * 3) / 2;
    const parts: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const cy = y + i * (cardH + gap);
      parts.push(`<rect x="${x}" y="${cy}" width="${w}" height="${cardH}" rx="12" fill="#FFFFFF" stroke="${muted}" stroke-opacity="0.35" stroke-width="1"/>`);
      parts.push(`<rect x="${x + 18}" y="${cy + cardH / 2 - 4}" width="${Math.min(7, cardH / 6)}" height="8" rx="4" fill="${i < reveal ? accent : muted}"/>`);
      if (bullets[i]) {
        parts.push(`<text x="${x + 42}" y="${cy + cardH / 2 + 6}" font-family="${FONT}" font-size="18" fill="${INK}">${escapeXml(bullets[i].slice(0, 9))}</text>`);
      }
    }
    return parts.join("");
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
      if (!fs.existsSync(output)) throw new Error(`Chrome 渲染失败: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
    } finally {
      fs.rmSync(svgPath, { force: true });
    }
  }

  private async generateCard(width: number, height: number, output: string, caption?: string): Promise<void> {
    const result = await run([
      "-y", "-f", "lavfi", "-i", `color=c=0xF5F5F7:s=${width}x${height}`,
      "-frames:v", "1", "-update", "1", output,
    ], { command: this.settings.settings.ffmpegPath, timeoutSec: 30 });
    if (result.code !== 0 || !fs.existsSync(output)) throw new Error(`场景卡片生成失败: ${result.stderr.slice(-600)}`);
    if (!caption) return;
    const support = await detectSubtitleSupport(this.settings.settings.ffmpegPath);
    if (support === "none") return;
    const font = process.env.FFMPEG_DRAWTEXT_FONT || (process.platform === "darwin" ? "PingFang SC" : "sans");
    const badge = "占位画面 · 幻灯片生成失败";
    const text = (caption.trim().slice(0, 40) || "").replace(/[{}]/g, "");
    const assFile = `${output}-placeholder.ass`;
    const size = Math.max(18, Math.round(Math.min(width, height) * 0.042));
    let overlayArgs: string[] | null = null;
    if (support === "drawtext") {
      overlayArgs = [
        "-y", "-i", output,
        "-vf",
        `drawtext=font='${font}':text='${escapeDrawtext(badge)}':fontcolor=0x1D1D1F@0.55:fontsize=${Math.round(size * 0.7)}:box=1:boxcolor=0xFFFFFF@0.55:boxborderw=12:x=(w-text_w)/2:y=h*0.38,` +
        `drawtext=font='${font}':text='${escapeDrawtext(text)}':fontcolor=0x1D1D1F:fontsize=${size}:borderw=2:bordercolor=0xFFFFFF@0.8:box=1:boxcolor=0xFFFFFF@0.7:boxborderw=10:x=(w-text_w)/2:y=h*0.5`,
        "-frames:v", "1", "-update", "1", `${output}-overlay.png`,
      ];
    } else {
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
          `Style: Badge,${font},${Math.round(size * 0.7)},&H001D1D1F,&H00FFFFFF,&HB4FFFFFF,1,1,0,5,20,20,${badgeMarginV},1`,
          `Style: Caption,${font},${size},&H001D1D1F,&H00FFFFFF,&HB4FFFFFF,0,2,0,5,20,20,${captionMarginV},1`,
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
}
