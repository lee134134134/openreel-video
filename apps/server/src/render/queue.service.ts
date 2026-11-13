import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { SettingsService } from "../config/settings.module";
import { StorageService } from "../storage/storage.service";
import { RenderService, type RenderJobRow, type RenderQueuePort } from "./render.service";
import { executeRenderJob } from "./executors";

@Injectable()
export class RenderQueueService implements OnModuleInit, OnModuleDestroy, RenderQueuePort {
  private readonly logger = new Logger(RenderQueueService.name);
  private readonly pending: string[] = [];
  private readonly pendingSet = new Set<string>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly concurrency = Math.max(1, Number(process.env.OPENREEL_RENDER_CONCURRENCY ?? 1) || 1);
  private active = 0;

  constructor(
    private readonly render: RenderService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.render.setQueue(this);
    for (const row of this.render.listRecoverable()) {
      this.render.update(row.id, { state: "queued", stage: "服务重启后重新排队", error: "" });
      this.enqueue(row.id);
    }
  }

  onModuleDestroy(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  enqueue(id: string): void {
    if (this.pendingSet.has(id) || this.controllers.has(id)) return;
    this.pending.push(id);
    this.pendingSet.add(id);
    this.pump();
  }

  cancel(id: string): boolean {
    const row = this.render.get(id);
    if (!row) return false;
    if (row.state === "done" || row.state === "failed" || row.state === "cancelled") return true;
    if (this.pendingSet.delete(id)) {
      const index = this.pending.indexOf(id);
      if (index >= 0) this.pending.splice(index, 1);
    }
    this.controllers.get(id)?.abort();
    this.render.update(id, { state: "cancelled", stage: "已取消", error: "用户取消渲染" });
    return true;
  }

  private pump(): void {
    while (this.active < this.concurrency && this.pending.length) {
      const id = this.pending.shift()!;
      this.pendingSet.delete(id);
      const row = this.render.get(id);
      if (!row || row.state === "done" || row.state === "failed" || row.state === "cancelled") continue;
      this.active += 1;
      void this.runOne(row).finally(() => {
        this.active -= 1;
        this.controllers.delete(id);
        this.pump();
      });
    }
  }

  private async runOne(row: RenderJobRow): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(row.id, controller);
    const compose = row.kind !== "transcode";
    this.render.update(row.id, { state: "running", progress: Math.max(0.01, row.progress), stage: compose ? "FFmpeg 合成" : "FFmpeg 转码", error: "" });
    try {
      const result = await executeRenderJob(row, this.render.payload(row.id), {
        jobsDir: this.storage.jobsDir(),
        ffmpegPath: this.settings.settings.ffmpegPath,
        ffprobePath: this.settings.settings.ffprobePath || "ffprobe",
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!controller.signal.aborted) {
            this.render.update(row.id, { progress: Math.max(0.01, Math.min(0.99, fraction)), stage: compose ? "FFmpeg 合成" : "FFmpeg 转码" });
          }
        },
      });
      if (controller.signal.aborted || this.render.get(row.id)?.state === "cancelled") return;
      this.render.update(row.id, { state: "done", progress: 1, stage: "完成", outputUrl: result.outputUrl, error: "" });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      if (controller.signal.aborted || this.render.get(row.id)?.state === "cancelled") {
        this.render.update(row.id, { state: "cancelled", stage: "已取消", error: "用户取消渲染" });
      } else {
        this.logger.error(`render ${row.id} failed: ${message}`);
        this.render.update(row.id, { state: "failed", stage: "失败", error: message, logTail: message.slice(-8192) });
      }
    }
  }
}
