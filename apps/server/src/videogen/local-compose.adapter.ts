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
import { OpencodeClient, hasOpencodeCredentials } from "../llm/opencode.client";
import { generateVideoClip, readVideoGenConfig } from "./video-generation.client";
import { probeVideoDurationUse } from "../render/ffmpeg.utils";

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
  /** Film-wide continuity bible shared by every scene and keyframe. */
  continuity?: string;
  /** Previous scene's visual prompt, used to match-cut into this shot. */
  previousVisualPrompt?: string;
}

/** A shot needs at least two keyframes to move inside itself; one beat means
 * the planner did not author continuity and we fall back to a single still. */
function sceneBeats(scene: VideogenScenePlan): string[] {
  const beats = (scene.beats ?? [])
    .map((beat) => String(beat ?? "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (beats.length > 1) return beats;
  return [String(scene.visualPrompt ?? scene.narration ?? "").trim() || "画面"];
}

@Injectable()
export class LocalComposeAdapter implements LocalVideogenAdapter {
  readonly id = "local-compose";
  readonly label = "动态画面（视频生成 + 镜头运动）+ TTS 合成";
  private readonly logger = new Logger(LocalComposeAdapter.name);

  constructor(
    private readonly tts: TtsRegistry,
    private readonly settings: SettingsService,
    private readonly llm: OpencodeClient,
  ) {}

  async generateScene(scene: VideogenScenePlan, options: SceneOptions): Promise<VideogenClip> {
    fs.mkdirSync(options.outDir, { recursive: true });
    const index = Math.max(0, Math.round(scene.index));
    const beats = sceneBeats(scene);
    const frames: string[] = [];
    let placeholderCard = false;

    const framePath = (beat: number): string => path.join(options.outDir, `scene-${index}-beat-${beat}.png`);

    if (process.env.IMAGE_BASE_URL && process.env.IMAGE_API_KEY) {
      try {
        for (let beat = 0; beat < beats.length; beat += 1) {
          const output = framePath(beat);
          await this.generateImage(
            this.keyframePrompt(scene, beats[beat], options, beat, beats.length),
            options.width,
            options.height,
            output,
          );
          frames.push(output);
        }
      } catch (err) {
        this.logger.warn(`image generation failed for scene ${index}; trying LLM illustration: ${String((err as Error)?.message ?? err)}`);
        frames.length = 0;
        placeholderCard = !(await this.tryIllustration(scene, options, beats, frames, placeholderFallback(err)));
      }
    } else {
      placeholderCard = !(await this.tryIllustration(scene, options, beats, frames, undefined));
    }
    if (!frames.length) {
      const card = framePath(0);
      await this.generateCard(options.width, options.height, card, scene.subtitle ?? scene.narration);
      frames.push(card);
      placeholderCard = true;
    }
    const mediaPath = frames[0];

    // Prefer a real generated video clip when a video endpoint is configured.
    // The first keyframe becomes the first frame (I2V); on any failure we keep
    // the keyframe sequence and the renderer animates it with one camera move.
    let videoPath: string | undefined;
    let videoDuration: number | undefined;
    const videoConfig = readVideoGenConfig();
    if (videoConfig && !placeholderCard) {
      const clipPath = path.join(options.outDir, `scene-${index}.mp4`);
      try {
        await generateVideoClip(videoConfig, {
          scene,
          prompt: this.videoPrompt(scene, options),
          firstFramePath: mediaPath,
          width: options.width,
          height: options.height,
          fps: options.fps,
          durationSec: scene.durationSec,
        }, clipPath);
        videoDuration = await probeVideoDurationUse(
          this.settings.settings.ffprobePath || "ffprobe", clipPath,
        ).catch(() => undefined);
        videoPath = clipPath;
      } catch (err) {
        this.logger.warn(`video generation failed for scene ${index}; using animated keyframes: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
      }
    }

    const audio = await synthesizeDefault(this.tts, toSpokenNarration(scene.narration) || scene.narration, {
      voiceId: options.voiceId || "mock",
      emotion: scene.emotion,
    }, { dir: options.outDir, basename: `scene-${index}-audio` });
    return {
      sceneIndex: scene.index,
      mediaPath: videoPath ?? mediaPath,
      kind: videoPath ? "video" : "image",
      audioPath: audio.audioPath,
      durationSec: Math.max(audio.durationSec + 0.3, scene.durationSec),
      subtitle: scene.subtitle ?? scene.narration,
      placeholder: placeholderCard,
      frames: videoPath ? undefined : frames,
      kind_meta: videoPath ? {
        loop: true,
        generatedVideo: true,
        nativeDurationSec: videoDuration,
      } : {
        keyframes: frames.length,
      },
    };
  }

  /** One shared art direction + progressive beats: the prompt asks for frames
   * of the SAME shot, so the compositor can dissolve between them as motion. */
  private keyframePrompt(
    scene: VideogenScenePlan,
    beat: string,
    options: SceneOptions,
    beatIndex: number,
    beatCount: number,
  ): string {
    return [
      options.continuity ? `全片视觉圣经：${options.continuity}` : "",
      `电影感写实画面，第 ${Math.max(0, Math.round(scene.index))} 幕关键帧 ${beatIndex + 1}/${beatCount}。`,
      `镜头意图：${scene.visualPrompt}`,
      `本帧画面：${beat}`,
      options.previousVisualPrompt ? `与上一幕的衔接参考（不要重复构图）：${options.previousVisualPrompt}` : "",
      "同一镜头的时间切片：保持同一人物/主体外观、色调、主光方向与构图；相邻帧只做渐进变化。真实材质、景深与运动感；不要文字、水印、图标、图表、PPT 版式。",
    ].filter(Boolean).join("；");
  }

  /** Director-grade motion prompt: what moves, how the camera moves, and how
   * the world changes over the whole shot — never a static poster. */
  private videoPrompt(scene: VideogenScenePlan, options?: SceneOptions): string {
    return [
      options?.continuity ? `全片视觉圣经：${options.continuity}` : "",
      scene.visualPrompt,
      scene.motionDescription ? `镜头运动：${scene.motionDescription}` : "",
      `镜头运动方式：${scene.motion ?? "dynamic"}`,
      scene.beats?.length ? `时间节拍：${scene.beats.join(" → ")}` : "",
      "真实连续运动的视频画面：主体与环境在整段时长内持续变化，镜头流畅自然，有运动模糊与光影变化；禁止静止帧、幻灯片感、定格照片、水印与额外字幕。",
    ].filter(Boolean).join("；");
  }

  /** LLM illustration pipeline: the opencode2 text model authors one SVG per
   * beat (same shot, progressive change), then headless Chrome rasterizes each
   * to the exact frame size. Falls back to the placeholder card on any failure. */
  private async tryIllustration(
    scene: VideogenScenePlan,
    options: SceneOptions,
    beats: string[],
    frames: string[],
    reasonForPlaceholder?: string,
  ): Promise<boolean> {
    if (!hasOpencodeCredentials()) {
      const card = path.join(options.outDir, `scene-${Math.max(0, Math.round(scene.index))}-beat-0.png`);
      await this.generateCard(options.width, options.height, card, scene.subtitle ?? scene.narration);
      frames.push(card);
      return false;
    }
    try {
      const svgs = await this.generateSceneSvgs(scene, options, beats);
      for (let beat = 0; beat < svgs.length; beat += 1) {
        const output = path.join(options.outDir, `scene-${Math.max(0, Math.round(scene.index))}-beat-${beat}.png`);
        await this.renderSvgToPng(svgs[beat], options.width, options.height, output);
        if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error("渲染结果为空");
        frames.push(output);
      }
      if (!frames.length) throw new Error("没有生成任何关键帧");
      return true;
    } catch (err) {
      this.logger.warn(`LLM illustration failed for scene ${scene.index}; using placeholder card: ${String((err as Error)?.message ?? err).slice(0, 300)}`);
      for (const frame of frames) fs.rmSync(frame, { force: true });
      frames.length = 0;
      const card = path.join(options.outDir, `scene-${Math.max(0, Math.round(scene.index))}-beat-0.png`);
      await this.generateCard(
        options.width,
        options.height,
        card,
        reasonForPlaceholder ? `占位画面 · ${reasonForPlaceholder}` : (scene.subtitle ?? scene.narration),
      );
      frames.push(card);
      return false;
    }
  }

  private async generateSceneSvgs(
    scene: VideogenScenePlan,
    options: SceneOptions,
    beats: string[],
  ): Promise<string[]> {
    const width = options.width;
    const height = options.height;
    const prompt = [
      `为一段视频第 ${Math.max(0, Math.round(scene.index))} 幕画 ${beats.length} 张连续关键帧（同一镜头的时间切片）。`,
      options.continuity ? `全片视觉圣经（所有关键帧必须严格遵守）：${options.continuity}` : "",
      `本幕镜头意图：${scene.visualPrompt || scene.narration}`,
      scene.motionDescription ? `镜头运动：${scene.motionDescription}` : "",
      options.previousVisualPrompt ? `上一幕落幅（用于衔接，不要重复构图）：${options.previousVisualPrompt}` : "",
      "按时间顺序的关键帧：",
      ...beats.map((beat, beatIndex) => `${beatIndex + 1}. ${beat}`),
      `画布：width="${width}" height="${height}"，viewBox="0 0 ${width} ${height}"。`,
      "风格：电影感写实概念气氛图，不是图标、不是信息图、不是 PPT 色块。要求：",
      "- 明确的前景/中景/背景三层空间与空气透视，主体清晰，主光方向一致；",
      "- 使用渐变、柔和阴影、材质纹理、颗粒感与景深虚化，避免纯色大色块和扁平几何拼贴；",
      "- 所有关键帧共用同一色调、同一主光方向、同一人物/主体外观；相邻关键帧只做渐进变化（主体位移、光线移动、环境变化），构图不能跳变；",
      "- 不要 <image>、不要外链资源、不要 <script>、不要滤镜动画；单张 SVG 控制在 3500 字符以内；",
      `只输出 ${beats.length} 个 SVG 文档，按顺序，每个从 <svg 开始到 </svg> 结束，不要 Markdown、不要解释。`,
    ].filter(Boolean).join("\n");
    const imageModel = process.env.OPENCODE_IMAGE_MODEL;
    const result = await this.llm.complete({
      // Only an explicit image model overrides the auto-discovered free model.
      model: imageModel || "",
      messages: [
        { role: "system", content: "You are a meticulous cinematic concept artist. Output ONLY raw SVG documents: each starts with <svg and ends with </svg>. Never wrap them in markdown." },
        { role: "user", content: prompt },
      ],
      maxTokens: 16000,
      temperature: 0.55,
      // Low effort keeps enough budget for the SVG bodies themselves.
      reasoningEffort: "low",
    });
    const content = result.content ?? "";
    if (!content.trim() && result.finishReason === "length") {
      throw new Error("LLM 输出被推理占用而截断");
    }
    const matches = [...content.matchAll(/<svg[\s\S]*?<\/svg>/gi)].map((match) => match[0]);
    if (!matches.length) throw new Error("LLM 未返回 SVG 代码");
    return matches.slice(0, beats.length).map((svg) => this.normalizeSvg(svg, width, height));
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
