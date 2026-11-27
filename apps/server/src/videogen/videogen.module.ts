import { Body, Controller, Get, Module, NotFoundException, OnModuleInit, Param, Post, Query, Res } from "@nestjs/common";
import * as path from "node:path";
import type { Response } from "express";
import type { VideogenPlan } from "@openreel/plugin-sdk";
import { VideogenService } from "./videogen.service";
import { ProposalService, type ProposePlanInput } from "./proposal.service";
import { LocalComposeAdapter } from "./local-compose.adapter";
import { VideoEvalService } from "./video-eval.service";
import { VideogenRegistry } from "../registry/registry.module";
import { LlmModule } from "../llm/llm.module";
import { ToolRegistry } from "../llm/tool-registry.service";
import { RenderModule } from "../render/render.module";
import { StorageModule } from "../storage/storage.module";
import { StorageService } from "../storage/storage.service";

@Controller("videogen")
export class VideogenController {
  constructor(
    private readonly videogen: VideogenService,
    private readonly proposals: ProposalService,
    private readonly registry: VideogenRegistry,
    private readonly evaluator: VideoEvalService,
    private readonly storage: StorageService,
  ) {}

  @Post("plans")
  plan(@Body() body: ProposePlanInput): Promise<VideogenPlan> {
    return this.proposals.proposePlan(body);
  }

  @Post("jobs")
  create(@Body() body: { plan: VideogenPlan; adapterId?: string; projectId?: string }): unknown {
    const job = this.videogen.create(body.plan, body.adapterId, body.projectId);
    this.videogen.start(job.id);
    return this.videogen.get(job.id);
  }

  @Get("jobs")
  list(@Query("projectId") projectId?: string): unknown {
    return this.videogen.list(projectId);
  }

  @Get("jobs/:id/events")
  events(@Param("id") id: string, @Res() res: Response): void {
    if (!this.videogen.get(id)) throw new NotFoundException(`videogen job ${id} not found`);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    let previous = "";
    const send = (): void => {
      const job = this.videogen.get(id);
      if (!job || res.writableEnded) return;
      const serialized = JSON.stringify(job);
      if (serialized !== previous) {
        previous = serialized;
        res.write(`data: ${serialized}\n\n`);
      }
      if (["done", "failed", "cancelled"].includes(job.state)) {
        clearInterval(poller);
        clearInterval(heartbeat);
        res.end();
      }
    };
    const poller = setInterval(send, 300);
    const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(": heartbeat\n\n"); }, 15000);
    res.on("close", () => { clearInterval(poller); clearInterval(heartbeat); });
    send();
  }

  @Get("jobs/:id")
  get(@Param("id") id: string): unknown {
    const job = this.videogen.get(id);
    if (!job) throw new NotFoundException(`videogen job ${id} not found`);
    return job;
  }

  @Post("jobs/:id/run")
  run(@Param("id") id: string): unknown {
    if (!this.videogen.get(id)) throw new NotFoundException(`videogen job ${id} not found`);
    this.videogen.start(id);
    return { ok: true, job: this.videogen.get(id) };
  }

  @Post("jobs/run/:id")
  runLegacy(@Param("id") id: string): unknown {
    return this.run(id);
  }

  @Get("avatars")
  avatars(): unknown {
    return this.registry.avatars;
  }

  @Get("adapters")
  adapters(): unknown {
    return this.registry.list().map((adapter) => ({ id: adapter.id, label: adapter.label }));
  }

  /** Re-run the quality self-check on an existing finished job. */
  @Post("jobs/:id/eval")
  async reevaluate(@Param("id") id: string): Promise<unknown> {
    const job = this.videogen.get(id);
    if (!job) throw new NotFoundException(`videogen job ${id} not found`);
    if (!job.videoUrl) throw new NotFoundException(`videogen job ${id} has no finished video`);
    const outputPath = path.join(this.storage.jobsDir(), path.basename(job.videoUrl!));
    const evalDir = path.join(this.storage.uploadDir(), `videogen-eval-${id.slice(0, 8)}`);
    const report = await this.evaluator.evaluate(outputPath, job.plan, evalDir);
    this.videogen.update(id, { eval: report, stage: `质量 ${report.score} 分${report.passed ? " · 通过" : " · 待优化"}` });
    return this.videogen.get(id);
  }
}

@Module({
  imports: [LlmModule, RenderModule, StorageModule],
  controllers: [VideogenController],
  providers: [VideogenService, ProposalService, LocalComposeAdapter, VideoEvalService],
  exports: [VideogenService, ProposalService],
})
export class VideogenModule implements OnModuleInit {
  constructor(
    private readonly registry: VideogenRegistry,
    private readonly localCompose: LocalComposeAdapter,
    private readonly tools: ToolRegistry,
    private readonly proposals: ProposalService,
    private readonly videogen: VideogenService,
    private readonly storage: StorageService,
    private readonly evaluator: VideoEvalService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.localCompose);
    this.tools.register({
      name: "propose_videogen_plan",
      description: "根据brief生成分镜视频计划",
      parameters: { type: "object", properties: { brief: { type: "string" }, sceneCount: { type: "number" }, aspectRatio: { type: "string" }, styleHint: { type: "string" }, language: { type: "string" }, skills: { type: "array", items: { type: "string" }, description: "要加载的创作技能，默认自动加载资深导演技能" } }, required: ["brief", "sceneCount"] },
      execute: async (args) => this.proposals.proposePlan({
        brief: String(args.brief ?? ""), sceneCount: Number(args.sceneCount ?? 4),
        aspectRatio: args.aspectRatio as ProposePlanInput["aspectRatio"], styleHint: args.styleHint ? String(args.styleHint) : undefined,
        language: args.language ? String(args.language) : undefined,
        skills: Array.isArray(args.skills) ? args.skills.map(String) : undefined,
      }),
    });
    this.tools.register({
      name: "create_videogen_job",
      description: "创建并排队执行视频生成任务",
      parameters: { type: "object", properties: { plan: { type: "object" }, adapterId: { type: "string" } }, required: ["plan"] },
      execute: async (args) => {
        const job = this.videogen.create(args.plan as VideogenPlan, args.adapterId ? String(args.adapterId) : undefined);
        this.videogen.start(job.id);
        return this.videogen.get(job.id);
      },
    });
    this.tools.register({
      name: "get_videogen_job",
      description: "查询视频生成任务状态",
      parameters: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
      execute: async (args) => {
        const job = this.videogen.get(String(args.jobId ?? ""));
        if (!job) throw new Error("视频任务不存在");
        return job;
      },
    });
    this.tools.register({
      name: "evaluate_videogen_job",
      description: "对已生成的视频启动质量自检（eval）：检查帧率/分辨率/静止感/可观看性并给出评分与改进建议",
      parameters: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
      execute: async (args) => {
        const job = this.videogen.get(String(args.jobId ?? ""));
        if (!job) throw new Error("视频任务不存在");
        if (!job.videoUrl) throw new Error("视频尚未生成完成，无法自检");
        const outputPath = path.join(this.storage.jobsDir(), path.basename(job.videoUrl));
        const evalDir = path.join(this.storage.uploadDir(), `videogen-eval-${job.id.slice(0, 8)}`);
        const report = await this.evaluator.evaluate(outputPath, job.plan, evalDir);
        this.videogen.update(job.id, { eval: report, stage: `质量 ${report.score} 分${report.passed ? " · 通过" : " · 待优化"}` });
        return { jobId: job.id, eval: report };
      },
    });
    this.tools.register({
      name: "revise_videogen_plan",
      description: "用户想修改某个已生成的视频成片时调用：按 job id 取原分镜计划，结合用户的修改要求生成修订后的新计划（返回的计划会以卡片展示，用户确认后创建新任务渲染）",
      parameters: { type: "object", properties: { jobId: { type: "string" }, feedback: { type: "string" } }, required: ["jobId", "feedback"] },
      execute: async (args) => {
        const job = this.videogen.get(String(args.jobId ?? ""));
        if (!job) throw new Error("视频任务不存在");
        const feedback = String(args.feedback ?? "");
        const revised = await this.proposals.revisePlan(job.plan, feedback);
        return { basedOn: job.id, originalTitle: job.plan?.options?.title, plan: revised };
      },
    });
  }
}
