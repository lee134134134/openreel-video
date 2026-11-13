import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import type { AssemblyRequest } from "@openreel/plugin-sdk";
import { RenderService } from "./render.service";
import { RenderQueueService } from "./queue.service";
import { StorageModule } from "../storage/storage.module";
import { StorageService } from "../storage/storage.service";

interface TranscodeBody {
  uploadId: string;
  crfLevel?: number;
  preset?: string;
  scaleWidth?: number;
  scaleHeight?: number;
  fps?: number;
}

@Controller("render")
export class RenderController {
  constructor(
    private readonly render: RenderService,
    private readonly queue: RenderQueueService,
    private readonly storage: StorageService,
  ) {}

  @Get("jobs")
  list(): unknown {
    return this.render.list();
  }

  @Get("jobs/:id/events")
  events(@Param("id") id: string, @Res() res: Response): void {
    if (!this.render.get(id)) throw new NotFoundException(`render job ${id} not found`);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    let previous = "";
    const send = (): void => {
      const row = this.render.get(id);
      if (!row || res.writableEnded) return;
      const serialized = JSON.stringify(row);
      if (serialized !== previous) {
        previous = serialized;
        res.write(`data: ${serialized}\n\n`);
      }
      if (["done", "failed", "cancelled"].includes(row.state)) {
        clearInterval(poller);
        clearInterval(heartbeat);
        res.end();
      }
    };
    const poller = setInterval(send, 200);
    const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": heartbeat\n\n"); }, 15000);
    res.on("close", () => { clearInterval(poller); clearInterval(heartbeat); });
    send();
  }

  @Get("jobs/:id")
  get(@Param("id") id: string): unknown {
    return this.render.get(id) ?? (() => { throw new NotFoundException(`render job ${id} not found`); })();
  }

  @Post("transcode")
  transcode(@Body() body: TranscodeBody): unknown {
    if (!body?.uploadId) throw new BadRequestException("uploadId 不能为空");
    const upload = this.storage.get(body.uploadId);
    const transcodeOptions = {
      crfLevel: body.crfLevel,
      preset: body.preset,
      scaleWidth: body.scaleWidth,
      fps: body.fps,
    };
    return this.render.create("transcode", {
      input: upload.path,
      inputFiles: [{ path: upload.path, role: "video" }],
      transcodeOptions,
      outputFormat: "mp4",
    });
  }

  @Post("assemble")
  assemble(@Body() body: AssemblyRequest): unknown {
    if (!body?.segments?.length) throw new BadRequestException("segments 不能为空");
    if (!(body.width > 0) || !(body.height > 0) || !(body.fps > 0)) throw new BadRequestException("width/height/fps 必须为正数");
    const segments = body.segments.map((segment) => ({
      ...segment,
      path: this.resolveRef(segment.fileRef),
    }));
    const audioTracks = (body.audioTracks ?? []).map((track) => ({ ...track, fileRef: this.resolveRef(track.fileRef) }));
    return this.render.create("assembly", {
      ...body,
      segments,
      audioTracks,
      outputFormat: body.outputFormat ?? "mp4",
      inputFiles: [
        ...segments.map((segment) => ({ path: segment.path, role: "video" })),
        ...audioTracks.map((track) => ({ path: track.fileRef, role: "audio" })),
      ],
    });
  }

  @Post("jobs/:id/cancel")
  cancel(@Param("id") id: string): unknown {
    if (!this.queue.cancel(id)) throw new NotFoundException(`render job ${id} not found`);
    return { ok: true, id, job: this.render.get(id) };
  }

  private resolveRef(ref: string): string {
    try {
      return this.storage.get(ref).path;
    } catch {
      const resolved = this.storage.resolveDataFile(ref);
      if (!resolved) throw new BadRequestException(`无法解析媒体文件: ${ref}`);
      return resolved;
    }
  }
}

@Module({
  imports: [StorageModule],
  controllers: [RenderController],
  providers: [RenderService, RenderQueueService],
  exports: [RenderService],
})
export class RenderModule {}
