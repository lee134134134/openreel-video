import { Injectable, Logger } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import type { VideoEvalReport, VideogenPlan } from "@openreel/plugin-sdk";
import { SettingsService } from "../config/settings.module";
import { OpencodeClient, hasOpencodeCredentials } from "../llm/opencode.client";
import { run } from "../render/ffmpeg.utils";

/**
 * Automatic self-check that runs right after a videogen job finishes. It uses
 * ffprobe + ffmpeg's `freezedetect`/`blackdetect` to catch the exact failure
 * mode this feature was built to eliminate — a video that is really a static
 * slideshow — and optionally asks a multimodal LLM to score the sampled frames.
 */
@Injectable()
export class VideoEvalService {
  private readonly logger = new Logger(VideoEvalService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly llm: OpencodeClient,
  ) {}

  async evaluate(videoPath: string, plan: VideogenPlan, outDir: string): Promise<VideoEvalReport> {
    const ffprobe = this.settings.settings.ffprobePath || "ffprobe";
    const ffmpeg = this.settings.settings.ffmpegPath || "ffmpeg";
    const createdAt = new Date().toISOString();
    const issues: string[] = [];
    const suggestions: string[] = [];

    const probe = await this.probe(ffprobe, videoPath).catch((err) => {
      issues.push(`无法读取视频元数据: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
      return null;
    });

    const width = probe?.width ?? 0;
    const height = probe?.height ?? 0;
    const fps = probe?.fps ?? 0;
    const durationSec = probe?.duration ?? 0;
    const frameCount = probe?.frameCount ?? 0;
    const bitrateKbps = probe?.bitrateKbps ?? 0;

    const motion = await this.detectFreezeAndBlack(ffmpeg, videoPath, durationSec).catch(() => ({
      freezeDuration: 0, blackDuration: 0, decodeOk: false,
    }));
    const freezeRatio = durationSec > 0 ? Math.min(1, motion.freezeDuration / durationSec) : 1;
    const blackRatio = durationSec > 0 ? Math.min(1, motion.blackDuration / durationSec) : 1;

    // ---- Scoring (100 total) ----
    const resolutionScore = height >= 1080 ? 20 : height >= 720 ? 16 : height >= 480 ? 10 : height > 0 ? 4 : 0;
    const fpsScore = fps >= 24 ? 15 : fps >= 20 ? 11 : fps >= 15 ? 7 : fps > 0 ? 3 : 0;
    const integrityScore = durationSec > 0 && frameCount > 0 && motion.decodeOk ? 15 : durationSec > 0 ? 8 : 0;
    // Slides are meant to be still: stability is a positive signal, not a defect.
    const motionScore = Math.round(40 * Math.min(1, freezeRatio / 0.2));
    const clarityScore = blackRatio < 0.02 ? 10 : blackRatio < 0.1 ? 6 : 0;
    const score = Math.round(resolutionScore + fpsScore + integrityScore + motionScore + clarityScore);

    if (height > 0 && height < 720) {
      issues.push(`分辨率偏低（${width}x${height}）`);
      suggestions.push("将分辨率提升到 1080p 以获得更清晰的画面");
    }
    if (fps > 0 && fps < 24) {
      issues.push(`帧率偏低（${fps.toFixed(1)} fps）`);
      suggestions.push("把帧率设为 30 fps，运动画面会更流畅");
    }
    if (freezeRatio < 0.15) {
      issues.push(`画面变化过于频繁（静止占比 ${(freezeRatio * 100).toFixed(0)}%），偏离静态幻灯片风格`);
      suggestions.push("检查是否误启用了运镜或视频生成；演示文稿应保持页面静止，只用柔和淡入淡出");
    }
    if (blackRatio >= 0.1) {
      issues.push(`黑屏/空白画面占比 ${(blackRatio * 100).toFixed(0)}%`);
      suggestions.push("检查页面是否渲染为空白（占位卡），确认代码生成与 Chrome 可用");
    }
    if (!motion.decodeOk) {
      issues.push("存在部分无法解码的画面帧");
    }
    if (bitrateKbps > 0 && bitrateKbps < 600 && durationSec > 2) {
      issues.push(`码率偏低（${bitrateKbps.toFixed(0)} kbps），可能出现块状模糊`);
    }
    if (!issues.length) suggestions.push("幻灯片稳定性、清晰度与音画结构均达标，可直接交付");

    const grade: VideoEvalReport["grade"] = score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 55 ? "fair" : "poor";
    const report: VideoEvalReport = {
      score,
      passed: score >= 70 && blackRatio < 0.15,
      grade,
      metrics: { width, height, fps, durationSec, frameCount, bitrateKbps, freezeRatio, blackRatio, motionScore },
      issues,
      suggestions,
      createdAt,
    };

    const vision = await this.visionReview(videoPath, plan, durationSec, outDir, ffmpeg).catch((err) => {
      this.logger.warn(`vision eval skipped: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
      return undefined;
    });
    if (vision) {
      report.vision = vision;
      // Low vision scores raise real problems that ffprobe cannot see.
      if (vision.dynamism < 60) {
        report.issues.push(`视觉复评：动态感不足（${vision.dynamism}/100）`);
        report.suggestions.push("按视觉复评意见加强主体的连续动作与镜头运动");
      }
      if (vision.watchability < 60) {
        report.issues.push(`视觉复评：可观看性不足（${vision.watchability}/100）`);
      }
      const visionAvg = Math.round((vision.visualQuality + vision.watchability + vision.dynamism + vision.sync) / 4);
      report.score = Math.round(report.score * 0.7 + visionAvg * 0.3);
      report.grade = report.score >= 85 ? "excellent" : report.score >= 70 ? "good" : report.score >= 55 ? "fair" : "poor";
      report.passed = report.passed && visionAvg >= 60;
    }
    return report;
  }

  private async probe(ffprobe: string, videoPath: string): Promise<{
    width: number; height: number; fps: number; duration: number; frameCount: number; bitrateKbps: number;
  }> {
    const result = await run([
      "-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath,
    ], { command: ffprobe, timeoutSec: 30 });
    if (result.code !== 0) throw new Error(result.stderr.slice(-400));
    const json = JSON.parse(result.stdout || "{}") as {
      streams?: Array<Record<string, unknown>>;
      format?: Record<string, unknown>;
    };
    const stream = (json.streams ?? []).find((item) => item.codec_type === "video") ?? json.streams?.[0];
    if (!stream) throw new Error("ffprobe 未找到视频流");
    const fraction = (value: unknown): number => {
      const text = String(value ?? "");
      const [a, b] = text.split("/").map(Number);
      return b ? a / b : a || 0;
    };
    const toNumber = (value: unknown): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const duration = toNumber(json.format?.duration) || toNumber(stream.duration);
    const bitrate = toNumber(json.format?.bit_rate) || toNumber(stream.bit_rate);
    return {
      width: toNumber(stream.width),
      height: toNumber(stream.height),
      fps: fraction(stream.avg_frame_rate) || fraction(stream.r_frame_rate),
      duration,
      frameCount: toNumber(stream.nb_frames),
      bitrateKbps: bitrate / 1000,
    };
  }

  private async detectFreezeAndBlack(ffmpeg: string, videoPath: string, durationSec: number): Promise<{
    freezeDuration: number; blackDuration: number; decodeOk: boolean;
  }> {
    const result = await run([
      "-hide_banner", "-nostats", "-i", videoPath,
      "-vf", "freezedetect=n=0.003:d=0.4,blackdetect=d=0.3:pix_th=0.10",
      "-an", "-f", "null", "-",
    ], { command: ffmpeg, timeoutSec: 180 });

    // ffmpeg logs freeze_start / freeze_duration / freeze_end per event, but
    // when a freeze lasts until EOF it only logs freeze_start. Close that open
    // interval against the probed duration so a fully frozen video is caught.
    const measure = (prefix: "freeze" | "black"): number => {
      const events = Array.from(
        result.stderr.matchAll(new RegExp(`(${prefix}_start|${prefix}_end|${prefix}_duration):\\s*([0-9.]+)`, "g")),
      ).map((match) => ({ name: match[1], value: Number(match[2]) }));
      let total = 0;
      let openStart: number | undefined;
      for (const event of events) {
        if (event.name.endsWith("_start")) openStart = event.value;
        else if (event.name.endsWith("_duration")) total += event.value;
        else if (event.name.endsWith("_end")) openStart = undefined;
      }
      if (openStart !== undefined) total += Math.max(0, durationSec - openStart);
      return total;
    };

    return {
      freezeDuration: measure("freeze"),
      blackDuration: measure("black"),
      decodeOk: !/error while decoding|invalid data|corrupt/i.test(result.stderr),
    };
  }

  private async visionReview(
    videoPath: string,
    plan: VideogenPlan,
    durationSec: number,
    outDir: string,
    ffmpeg: string,
  ): Promise<VideoEvalReport["vision"] | undefined> {
    if (process.env.VIDEO_EVAL_VISION === "0" || !hasOpencodeCredentials()) return undefined;
    fs.mkdirSync(outDir, { recursive: true });
    const times = [0.2, 0.5, 0.8].map((fraction) => Math.max(0, Math.min(durationSec - 0.1, durationSec * fraction)));
    const parts: Array<{ type: "text"; text: string } | { type: "image_url"; imageUrl: string }> = [{
      type: "text",
      text: [
        "你是一名资深视频审片。下面是从一条自动生成的视频中抽取的 3 帧（按时间顺序）。",
        `视频标题：${plan.options?.title ?? ""}；时长 ${durationSec.toFixed(1)} 秒。`,
        "请评估：visualQuality（画面清晰度/构图/真实感）、watchability（可观看性）、dynamism（动态感/是否像静态幻灯片）、sync（画面与旁白主题的契合度），以及 notes（一句话改进建议）。",
        "只输出严格 JSON：{visualQuality,watchability,dynamism,sync,overall,notes}，分值 0-100 整数。不要 Markdown。",
      ].join("\n"),
    }];
    for (const [index, time] of times.entries()) {
      const framePath = path.join(outDir, `eval-frame-${index}.png`);
      await run([
        "-y", "-ss", time.toFixed(3), "-i", videoPath, "-frames:v", "1", "-update", "1", framePath,
      ], { command: ffmpeg, timeoutSec: 30 });
      if (!fs.existsSync(framePath)) continue;
      const base64 = fs.readFileSync(framePath).toString("base64");
      parts.push({ type: "image_url", imageUrl: `data:image/png;base64,${base64}` });
      fs.rmSync(framePath, { force: true });
    }
    if (parts.length < 2) return undefined;
    const result = await this.llm.complete({
      model: process.env.VIDEO_EVAL_VISION_MODEL || "",
      messages: [{ role: "user", content: parts }],
      maxTokens: 500,
      temperature: 0,
    });
    const match = /\{[\s\S]*\}/.exec(result.content ?? "");
    if (!match) throw new Error("视觉复评未返回 JSON");
    const json = JSON.parse(match[0]) as Record<string, unknown>;
    const num = (value: unknown): number => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const visualQuality = num(json.visualQuality);
    const watchability = num(json.watchability);
    const dynamism = num(json.dynamism);
    const sync = num(json.sync);
    return {
      visualQuality, watchability, dynamism, sync,
      overall: num(json.overall) || Math.round((visualQuality + watchability + dynamism + sync) / 4),
      notes: String(json.notes ?? "").slice(0, 300),
    };
  }
}
