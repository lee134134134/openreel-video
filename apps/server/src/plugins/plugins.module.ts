import { BadRequestException, Body, Controller, Get, Injectable, Module, OnModuleInit, Param, Post, Put } from "@nestjs/common";
import { PluginLoaderService } from "./plugin-loader.service";

@Controller("plugins")
export class PluginsController {
  constructor(private readonly loader: PluginLoaderService) {}

  @Get()
  list(): unknown {
    return this.loader.listInstalled();
  }

  /** Reload all plugins from disk (after installing/editing plugin files). */
  @Post("reload")
  async reload(): Promise<unknown> {
    return this.loader.loadAll();
  }

  @Post(":id/enable")
  async enable(@Param("id") id: string): Promise<unknown> {
    await this.loader.enable(id);
    return { ok: true, id, enabled: true };
  }

  @Post(":id/disable")
  async disable(@Param("id") id: string): Promise<unknown> {
    await this.loader.disable(id);
    return { ok: true, id, enabled: false };
  }

  /** Settings form (Plugin Center credentials + manifest settings). */
  @Put(":id/credentials")
  credentials(@Param("id") id: string, @Body() body: Record<string, unknown>): unknown {
    const installed = this.loader.listInstalled().find((p) => p.id === id);
    if (!installed) throw new BadRequestException(`未安装的插件: ${id}`);
    this.loader.setPluginCredentials(id, body ?? {});
    if (installed.enabled) {
      // re-create context so adapters observe new credentials immediately
      void this.loader.enable(id).catch(() => undefined);
    }
    return { ok: true };
  }
}

@Injectable()
export class PluginBootstrap implements OnModuleInit {
  constructor(private readonly loader: PluginLoaderService) {}
  async onModuleInit(): Promise<void> {
    await this.loader.loadAll().catch((err) => {
      console.error("plugin load failed", err);
    });
  }
}

@Module({
  controllers: [PluginsController],
  providers: [PluginLoaderService, PluginBootstrap],
  exports: [PluginLoaderService],
})
export class PluginsModule {}
