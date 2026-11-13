import { Body, Controller, Get, Module, OnModuleInit, Param, Post, Put, Query } from "@nestjs/common";
import { PublishStateService } from "./publish-state.service";
import { PublishService, type PublishHttpInput } from "./publish.service";
import { PublishRegistry } from "../registry/registry.module";
import { StorageModule } from "../storage/storage.module";
import { LlmModule } from "../llm/llm.module";
import { ToolRegistry } from "../llm/tool-registry.service";

@Controller("publish")
export class PublishController {
  constructor(
    private readonly registry: PublishRegistry,
    private readonly state: PublishStateService,
    private readonly publish: PublishService,
  ) {}

  /** Connector list with live credential status. */
  @Get("connectors")
  async connectors(): Promise<unknown> {
    return Promise.all(
      this.registry.list().map(async (a) => {
        const creds = this.publish.mergedCredentials(a.id);
        let ok = false;
        let account: string | undefined;
        let message: string | undefined;
        try {
          const v = await a.validateCredentials(creds as never);
          ok = v.ok;
          account = v.account;
          message = v.message;
        } catch (err) {
          ok = false;
          message = String((err as Error)?.message ?? err);
        }
        return { id: a.id, label: a.label, platform: a.platform, auth: a.auth, ok, account, message };
      }),
    );
  }

  @Get("records")
  records(): unknown {
    return this.state.listRecords();
  }

  @Get("records/:id/status")
  async status(@Param("id") id: string): Promise<unknown> {
    return this.publish.recordStatus(id);
  }

  @Put("credentials/:connectorId")
  credentials(@Param("connectorId") connectorId: string, @Body() body: Record<string, unknown>): unknown {
    this.state.ensureNotLocked();
    if (!this.registry.has(connectorId)) return { error: "unknown_connector" };
    this.state.setCredentials(connectorId, body ?? {});
    return { ok: true };
  }

  @Post()
  async create(@Body() body: PublishHttpInput): Promise<unknown> {
    return this.publish.publish(body ?? ({} as PublishHttpInput));
  }

  @Post("oauth/:connectorId/authorize")
  authorize(@Param("connectorId") connectorId: string): unknown {
    return this.publish.authorizeUrl(connectorId);
  }

  @Get("oauth/:connectorId/callback")
  async callback(
    @Param("connectorId") connectorId: string,
    @Query("code") code: string | undefined,
    @Query("error") oauthError: string | undefined,
    @Query("error_description") errorDescription: string | undefined,
  ): Promise<string> {
    const okBadge = `<html><body style="font-family:sans-serif;display:grid;place-items:center;height:100vh">
      <div style="text-align:center"><h2>✅ ${oauthError ? "授权失败" : "授权完成"}</h2>
      <p>${oauthError ? String(errorDescription ?? oauthError) : "请返回 OpenReel 继续操作"}</p>
      <p><a href="javascript:window.close()">关闭此窗口</a></p></div></body></html>`;
    if (oauthError || !code) {
      return okBadge;
    }
    const result = await this.publish.oauthCallback(connectorId, code);
    return okBadge.replace("授权完成", result.ok ? "授权完成" : "授权失败");
  }
}

@Module({
  imports: [StorageModule, LlmModule],
  controllers: [PublishController],
  providers: [PublishStateService, PublishService],
  exports: [PublishStateService, PublishService],
})
export class PublishModule implements OnModuleInit {
  constructor(
    private readonly publish: PublishService,
    private readonly state: PublishStateService,
    private readonly registry: PublishRegistry,
    private readonly tools: ToolRegistry,
  ) {}

  /** LLM agent tools: chat can publish generated videos directly. */
  onModuleInit(): void {
    this.tools.register({
      name: "list_publish_connectors",
      description: "列出可用的第三方发布平台连接器（凭据校验状态）",
      parameters: { type: "object", properties: {} },
      execute: async () =>
        Promise.all(
          this.registry.list().map(async (a) => {
            try {
              const v = await a.validateCredentials(this.publish.mergedCredentials(a.id) as never);
              return { id: a.id, label: a.label, platform: a.platform, auth: a.auth, ok: v.ok, account: v.account, message: v.message };
            } catch (err) {
              return { id: a.id, label: a.label, platform: a.platform, auth: a.auth, ok: false, message: String((err as Error)?.message ?? err) };
            }
          }),
        ),
    });
    this.tools.register({
      name: "publish_video",
      description: "将已生成的视频（videogenJobId）发布到指定平台连接器（connectorId, 如 publish-youtube）",
      parameters: {
        type: "object",
        properties: {
          connectorId: { type: "string" },
          videogenJobId: { type: "string", description: "AI 生成的视频任务 id" },
          title: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          privacy: { type: "string", enum: ["public", "private", "unlisted", "draft"] },
        },
        required: ["connectorId", "videogenJobId", "title"],
      },
      execute: async (args, ctx) => {
        ctx.emitStatus?.("正在向平台发布视频…");
        const rank = args.privacy === "public" || args.privacy === "private" || args.privacy === "unlisted" || args.privacy === "draft" ? args.privacy : undefined;
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined;
        return this.publish.publish({
          connectorId: String(args.connectorId ?? ""),
          videogenJobId: args.videogenJobId ? String(args.videogenJobId) : undefined,
          uploadId: args.uploadId ? String(args.uploadId) : undefined,
          title: String(args.title ?? ""),
          description: args.description !== undefined ? String(args.description) : undefined,
          tags,
          privacy: rank,
          requestedVia: "chat",
        });
      },
    });
    this.tools.register({
      name: "get_publish_status",
      description: "查询已提交的发布记录状态（按记录 id）",
      parameters: { type: "object", properties: { recordId: { type: "string" } }, required: ["recordId"] },
      execute: async (args) => {
        const record = this.state.getRecord(String(args.recordId ?? ""));
        if (!record) throw new Error("发布记录不存在");
        try {
          return await this.publish.recordStatus(record.id);
        } catch {
          return record;
        }
      },
    });
    this.tools.register({
      name: "list_publish_records",
      description: "列出最近的平台发布记录",
      parameters: { type: "object", properties: {} },
      execute: async () => this.state.listRecords(),
    });
  }
}
