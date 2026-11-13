import { Injectable, Global, Module } from "@nestjs/common";
import * as path from "node:path";

/** Central typed settings loaded from process.env with sensible defaults. */
export interface ServerSettings {
  port: number;
  corsOrigins: string[];
  dataDir: string;
  pluginDir: string;
  secret: string;
  ffmpegPath: string;
  ffprobePath?: string;
  opencode: { baseUrl: string; apiKey: string; model: string };
  image: { baseUrl?: string; apiKey?: string; model?: string };
}

function defaultDataDir(): string {
  return `${process.env.HOME ?? process.env.USERPROFILE ?? "."}/.openreel/server`;
}

@Injectable()
export class SettingsService {
  readonly settings: ServerSettings;

  constructor() {
    const pluginDirEnv = process.env.OPENREEL_PLUGIN_DIR;
    const settings: ServerSettings = {
      port: Number(process.env.PORT ?? 4000),
      corsOrigins: (process.env.OPENREEL_CORS ?? "http://localhost:5173").split(",").map((s) => s.trim()),
      dataDir: process.env.OPENREEL_DATA_DIR || defaultDataDir(),
      pluginDir: pluginDirEnv || "",
      secret: process.env.OPENREEL_SECRET || "dev-secret",
      ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
      ffprobePath: process.env.FFPROBE_PATH || undefined,
      opencode: {
        baseUrl: process.env.OPENCODE_BASE_URL || "https://opencode.ai/inference/go/openai/v1",
        apiKey: process.env.OPENCODE_API_KEY || "",
        model: process.env.OPENCODE_MODEL || "glm-5.3-flash",
      },
      image: {
        baseUrl: process.env.IMAGE_BASE_URL || undefined,
        apiKey: process.env.IMAGE_API_KEY || undefined,
        model: process.env.IMAGE_MODEL || undefined,
      },
    };
    if (!settings.pluginDir) {
      // default: <repo>/plugins (src/config -> src -> apps/server -> apps -> repo root)
      settings.pluginDir = path.resolve(__dirname, "../../../../plugins");
    }
    this.settings = settings;
  }

  pluginEnvKey(manifestId: string, settingKey: string): string {
    const id = manifestId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const key = settingKey.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    return `OPENREEL_PLUGIN_${id}_${key}`;
  }
}

@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
