import { Controller, Get } from "@nestjs/common";
import { SqliteService } from "../database/database.module";
import { SettingsService } from "../config/settings.module";
import { execFileSync } from "node:child_process";

@Controller("health")
export class HealthController {
  constructor(private readonly sqlite: SqliteService, private readonly settings: SettingsService) {}

  @Get()
  health(): Record<string, unknown> {
    let ffmpeg = false;
    try {
      execFileSync(this.settings.settings.ffmpegPath, ["-version"], { timeout: 5000, stdio: "pipe" });
      ffmpeg = true;
    } catch {
      ffmpeg = false;
    }
    let db = false;
    try {
      this.sqlite.get().prepare("SELECT 1").get();
      db = true;
    } catch {
      db = false;
    }
    return {
      ok: true,
      app: "openreel-server",
      ffmpeg,
      db,
      dataDir: this.settings.settings.dataDir,
      pluginDir: this.settings.settings.pluginDir,
      llm: {
        baseUrl: this.settings.settings.opencode.baseUrl,
        model: this.settings.settings.opencode.model,
        keyConfigured: Boolean(this.settings.settings.opencode.apiKey),
      },
    };
  }
}
