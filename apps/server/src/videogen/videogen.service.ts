import { Injectable } from "@nestjs/common";
import * as path from "node:path";
import type { VideogenPlan, VideogenJobDTO, VideogenPlanOptions, VideogenClip } from "@openreel/plugin-sdk";
import { SqliteService } from "../database/database.module";
import { VideogenRegistry } from "../registry/registry.module";
import { StorageService } from "../storage/storage.service";
import { SettingsService } from "../config/settings.module";
import { RenderService } from "../render/render.service";
import { probeVideoDurationUse } from "../render/ffmpeg.utils";

export function dimsFor(ratio: VideogenPlanOptions["aspectRatio"], res: number): { width: number; height: number } {
  const base = res;
  switch (ratio) {
    case "16:9": return { width: Math.round((base * 16) / 9 / 2) * 2, height: base };
    case "9:16": return { width: base, height: Math.round((base * 16) / 9 / 2) * 2 };
    case "1:1": return { width: base, height: base };
    case "4:5": return { width: base, height: Math.round((base * 5) / 4 / 2) * 2 };
  }
}

@Injectable()
export class VideogenService {
  private readonly active = new Set<string>();

  constructor(
    private readonly sqlite: SqliteService,
    private readonly registry: VideogenRegistry,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly render: RenderService,
  ) {}

  create(plan: VideogenPlan, adapterId?: string): VideogenJobDTO {
    const id = crypto.randomUUID();
    const now = this.sqlite.now();
    this.sqlite.get().prepare(
      "INSERT INTO videogen_jobs (id, state, progress, stage, error, plan, adapter_id, duration_sec, video_path, created_at, updated_at) VALUES (?, 'draft', 0, NULL, NULL, ?, ?, NULL, NULL, ?, ?)",
    ).run(id, JSON.stringify(plan), adapterId ?? "local-compose", now, now);
    return this.get(id)!;
  }

  start(id: string): void {
    if (this.active.has(id)) return;
    this.update(id, { state: "queued", stage: "等待执行", progress: 0, error: "" });
    void this.execute(id).catch((err) => {
      this.update(id, { state: "failed", stage: "失败", error: String((err as Error)?.message ?? err) });
    });
  }

  update(
    id: string,
    patch: Partial<{ state: string; progress: number; stage: string; error: string; durationSec: number; videoPath: string; adapterId: string }>,
  ): void {
    const sets: string[] = [];
    const values: Array<string | number> = [];
    if (patch.state !== undefined) { sets.push("state = ?"); values.push(patch.state); }
    if (patch.progress !== undefined) { sets.push("progress = ?"); values.push(patch.progress); }
    if (patch.stage !== undefined) { sets.push("stage = ?"); values.push(patch.stage); }
    if (patch.error !== undefined) { sets.push("error = ?"); values.push(patch.error); }
    if (patch.durationSec !== undefined) { sets.push("duration_sec = ?"); values.push(patch.durationSec); }
    if (patch.videoPath !== undefined) { sets.push("video_path = ?"); values.push(patch.videoPath); }
    if (patch.adapterId !== undefined) { sets.push("adapter_id = ?"); values.push(patch.adapterId); }
    if (!sets.length) return;
    sets.push("updated_at = ?");
    values.push(this.sqlite.now(), id);
    this.sqlite.get().prepare(`UPDATE videogen_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  get(id: string): VideogenJobDTO | undefined {
    const row = this.sqlite.get().prepare("SELECT * FROM videogen_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const videoPath = row.video_path ? String(row.video_path).replace(/^\/+/, "") : undefined;
    return {
      id: String(row.id),
      state: String(row.state) as VideogenJobDTO["state"],
      progress: Number(row.progress),
      stage: row.stage ? String(row.stage) : undefined,
      error: row.error ? String(row.error) : undefined,
      plan: JSON.parse(String(row.plan)) as VideogenPlan,
      adapterId: row.adapter_id ? String(row.adapter_id) : undefined,
      durationSec: row.duration_sec === null ? undefined : Number(row.duration_sec),
      videoUrl: videoPath ? `/api/files/${videoPath}` : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  list(): VideogenJobDTO[] {
    const rows = this.sqlite.get().prepare("SELECT id FROM videogen_jobs ORDER BY created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.get(String(row.id))!).filter(Boolean);
  }

  async execute(jobId: string): Promise<VideogenJobDTO | undefined> {
    const initial = this.get(jobId);
    if (!initial) throw new Error(`videogen job not found: ${jobId}`);
    if (this.active.has(jobId) || initial.state === "done") return initial;
    this.active.add(jobId);
    try {
      const adapter = this.registry.resolve(initial.adapterId);
      const dims = dimsFor(initial.plan.options.aspectRatio, initial.plan.options.resolution);
      const outDir = path.join(this.storage.uploadDir(), `videogen-${jobId.slice(0, 8)}`);
      this.storage.ensureDir(outDir);
      this.update(jobId, { state: "running", progress: 0.01, stage: "准备场景", error: "" });
      const clips: VideogenClip[] = [];
      const count = initial.plan.scenes.length;
      for (let index = 0; index < count; index += 1) {
        const scene = initial.plan.scenes[index];
        this.update(jobId, { stage: `场景 ${index + 1}/${count} · 媒体与配音`, progress: (index / count) * 0.5 });
        const clip = await adapter.generateScene(scene, {
          outDir,
          width: dims.width,
          height: dims.height,
          fps: initial.plan.options.fps,
          voiceId: initial.plan.options.ttsVoiceId ?? initial.plan.options.avatar?.voiceId ?? "mock",
        });
        clips.push(clip);
        this.update(jobId, { progress: ((index + 1) / count) * 0.5 });
      }
      this.update(jobId, { stage: "FFmpeg 合成", progress: 0.5 });
      const render = this.render.create("videogen-compose", {
        videogenJobId: jobId,
        clips: clips.map((clip) => ({
          path: clip.mediaPath,
          audioPath: clip.audioPath,
          subtitle: clip.subtitle,
          durationSec: clip.durationSec,
        })),
        width: dims.width,
        height: dims.height,
        fps: initial.plan.options.fps,
        renderPlan: dims,
        outputFormat: "mp4",
      });
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        const row = this.render.get(render.id);
        if (!row) throw new Error(`合成任务丢失: ${render.id}`);
        if (row.state === "failed" || row.state === "cancelled") throw new Error(row.error || "FFmpeg 合成失败");
        this.update(jobId, { stage: "FFmpeg 合成", progress: Math.min(0.98, 0.5 + row.progress * 0.48) });
        if (row.state === "done") {
          if (!row.outputUrl) throw new Error("合成完成但缺少输出地址");
          const filename = path.basename(row.outputUrl);
          const outputPath = path.join(this.storage.jobsDir(), filename);
          const durationSec = await probeVideoDurationUse(this.settings.settings.ffprobePath || "ffprobe", outputPath);
          this.update(jobId, {
            state: "done",
            progress: 1,
            stage: "完成",
            durationSec,
            videoPath: `jobs/${filename}`,
            error: "",
          });
          break;
        }
      }
      return this.get(jobId);
    } catch (err) {
      this.update(jobId, { state: "failed", stage: "失败", error: String((err as Error)?.message ?? err) });
      return this.get(jobId);
    } finally {
      this.active.delete(jobId);
    }
  }
}
