import { Controller, Get, Post, Param, Req, Res, UploadedFile, UseInterceptors, Body, NotFoundException, StreamableFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { StorageService } from "./storage.service";

@Controller()
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  /** Multipart upload (video/image/audio). Returns { id, path(kind), url } . */
  @Post("uploads")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 8 * 1024 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("kind") kind: string | undefined,
    @Body("filename") filename: string | undefined,
  ): Promise<unknown> {
    if (!file) throw new NotFoundException("multipart field `file` is required");
    const dir = this.storage.uploadDir();
    this.storage.ensureDir(dir);
    const safeName = (filename || file.originalname || "media.bin").replace(/[^\w.\- ]+/g, "_");
    const abs = path.join(dir, `${Date.now()}-${safeName}`);
    fs.writeFileSync(abs, file.buffer);
    const row = this.storage.register(path.relative(this.storage.uploadDir(), abs), safeName, kind || "media", file.size);
    return { ...row, url: `/api/files/uploads/${path.basename(abs)}` };
  }

  /** Serve generated/uploaded files: /api/files/<relpath-under-dataDir> */
  @Get("files/*")
  async serve(
    @Param() params: Record<string, string>,
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile | unknown> {
    // Wildcard param shapes differ per express router: NestJS v11 auto-converts
    // "files/*" into "files/{*path}", renaming the param from "0" to "path".
    // Recover the suffix straight from the request URL so media URLs keep
    // serving regardless of framework param naming.
    const fromUrl = String(request.originalUrl ?? request.url ?? "");
    const urlSuffix = fromUrl.includes("/api/files/")
      ? fromUrl.split("/api/files/")[1] ?? ""
      : "";
    const paramRaw = (params as Record<string, unknown>)["path"] ?? (params as Record<string, unknown>)["0"];
    const paramSuffix =
      typeof paramRaw === "string"
        ? paramRaw
        : Array.isArray(paramRaw)
          ? paramRaw.join("/")
          : "";
    const suffix = decodeURIComponent((urlSuffix || paramSuffix).split("?")[0]);
    const abs = this.storage.resolveDataFile(suffix);
    if (!abs) { res.status(404); return { error: "not_found" }; }
    const stat = fs.statSync(abs);
    if (!stat.isFile()) { res.status(404); return { error: "not_found" }; }
    const ext = path.extname(abs).slice(1).toLowerCase();
    const mime: Record<string, string> = {
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      wav: "audio/wav",
      mp3: "audio/mpeg",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      json: "application/json",
      txt: "text/plain",
      srt: "text/plain",
      vtt: "text/vtt",
    };
    res.set({
      "Content-Type": mime[ext] || "application/octet-stream",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=3600",
      "Accept-Ranges": "bytes",
    });
    const stream = fs.createReadStream(abs);
    return new StreamableFile(stream);
  }
}
