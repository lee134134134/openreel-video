import { Injectable, Logger } from "@nestjs/common";
import { SqliteService } from "../database/database.module";
import { SettingsService } from "../config/settings.module";
import { StorageService } from "../storage/storage.service";

export interface RenderJobRow {
  id: string;
  kind: string;
  state: string;
  progress: number;
  stage?: string | null;
  error?: string | null;
  outputFormat: string;
  outputUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RenderQueuePort {
  enqueue(id: string): void;
}

@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);
  private queue?: RenderQueuePort;

  constructor(
    private readonly sqlite: SqliteService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  setQueue(queue: RenderQueuePort): void {
    this.queue = queue;
  }

  create(kind: string, payload: Record<string, unknown>): RenderJobRow {
    const id = crypto.randomUUID();
    const now = this.sqlite.now();
    const outputFormat = payload.outputFormat === "webm" ? "webm" : "mp4";
    this.sqlite.get().prepare(
      "INSERT INTO render_jobs (id, kind, state, progress, stage, error, output_format, output_url, input_files, transcode_options, videogen_job_id, log_tail, created_at, updated_at) VALUES (?, ?, 'queued', 0, '等待渲染', NULL, ?, NULL, ?, ?, ?, NULL, ?, ?)",
    ).run(
      id,
      kind,
      outputFormat,
      JSON.stringify(payload.inputFiles ?? []),
      // The scaffold column is retained as the JSON payload store; no migration needed.
      JSON.stringify(payload),
      payload.videogenJobId == null ? null : String(payload.videogenJobId),
      now,
      now,
    );
    const row = this.get(id)!;
    this.queue?.enqueue(id);
    return row;
  }

  get(id: string): RenderJobRow | undefined {
    const row = this.sqlite.get().prepare("SELECT * FROM render_jobs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      kind: String(row.kind),
      state: String(row.state),
      progress: Number(row.progress),
      stage: row.stage ? String(row.stage) : undefined,
      error: row.error ? String(row.error) : undefined,
      outputFormat: String(row.output_format),
      outputUrl: row.output_url ? String(row.output_url) : undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  payload(id: string): Record<string, unknown> {
    const row = this.sqlite.get().prepare("SELECT transcode_options FROM render_jobs WHERE id = ?").get(id) as
      | { transcode_options?: string | null }
      | undefined;
    if (!row) throw new Error(`render job not found: ${id}`);
    try {
      return JSON.parse(String(row.transcode_options ?? "{}")) as Record<string, unknown>;
    } catch {
      throw new Error(`render job ${id} has invalid payload`);
    }
  }

  list(): RenderJobRow[] {
    const rows = this.sqlite.get().prepare("SELECT id FROM render_jobs ORDER BY created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.get(String(row.id))!).filter(Boolean);
  }

  listRecoverable(): RenderJobRow[] {
    const rows = this.sqlite.get().prepare("SELECT id FROM render_jobs WHERE state IN ('queued', 'running') ORDER BY created_at ASC").all() as Array<{ id: string }>;
    return rows.map((row) => this.get(row.id)!).filter(Boolean);
  }

  update(id: string, patch: Partial<{ state: string; progress: number; stage: string; error: string; outputUrl: string; logTail: string }>): void {
    const sets: string[] = [];
    const values: Array<string | number> = [];
    if (patch.state !== undefined) { sets.push("state = ?"); values.push(patch.state); }
    if (patch.progress !== undefined) { sets.push("progress = ?"); values.push(patch.progress); }
    if (patch.stage !== undefined) { sets.push("stage = ?"); values.push(patch.stage); }
    if (patch.error !== undefined) { sets.push("error = ?"); values.push(patch.error); }
    if (patch.outputUrl !== undefined) { sets.push("output_url = ?"); values.push(patch.outputUrl); }
    if (patch.logTail !== undefined) { sets.push("log_tail = ?"); values.push(patch.logTail); }
    if (!sets.length) return;
    sets.push("updated_at = ?");
    values.push(this.sqlite.now(), id);
    this.sqlite.get().prepare(`UPDATE render_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  async probeVersion(): Promise<string | null> {
    const { execFile } = await import("node:child_process");
    return new Promise((resolve) => {
      execFile(this.settings.settings.ffmpegPath, ["-version"], { timeout: 6000 }, (err, stdout) => {
        if (err) resolve(null);
        else resolve(String(stdout).split("\n")[0] ?? null);
      });
    });
  }

  outputPath(id: string, format: string): string {
    return `${this.storage.jobsDir()}/${id}.${format === "webm" ? "webm" : "mp4"}`;
  }
}
