import { Module } from "@nestjs/common";
import { SettingsModule } from "./config/settings.module";
import { DatabaseModule } from "./database/database.module";
import { RegistryModule } from "./registry/registry.module";
import { ProjectsModule } from "./projects/projects.module";
import { StorageModule } from "./storage/storage.module";
import { LlmModule } from "./llm/llm.module";
import { VideogenModule } from "./videogen/videogen.module";
import { TtsModule } from "./tts/tts.module";
import { RenderModule } from "./render/render.module";
import { PublishModule } from "./publish/publish.module";
import { PluginsModule } from "./plugins/plugins.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    // infrastructure
    SettingsModule,
    DatabaseModule,
    RegistryModule,
    // domains
    ProjectsModule,
    StorageModule,
    LlmModule,
    VideogenModule,
    TtsModule,
    RenderModule,
    PublishModule,
    PluginsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
