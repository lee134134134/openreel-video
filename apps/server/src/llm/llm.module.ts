import { Body, Controller, Get, Module, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import type { AgentEvent, LlmChatMessage } from "@openreel/plugin-sdk";
import { OpencodeClient } from "./opencode.client";
import { AgentLoopService } from "./agent-loop.service";
import { ToolRegistry } from "./tool-registry.service";
import { ChatSessionsService } from "./chat-sessions.service";
import { ModelsController } from "./models.controller";
import { SettingsService } from "../config/settings.module";

/**
 * Stream one turn of the agentic loop over SSE.
 * Body: { sessionId?: string, message?: string, model?: string, history?: LlmChatMessage[] }
 */
@Controller("agent")
export class AgentController {
  constructor(
    private readonly loop: AgentLoopService,
    private readonly sessions: ChatSessionsService,
  ) {}

  @Post("session")
  createSession(@Body() body: { title?: string }): { id: string } {
    return this.sessions.createSession(body.title?.trim() || "New chat");
  }

  @Post("stream")
  async stream(
    @Body() body: { sessionId?: string; message?: string; model?: string; history?: LlmChatMessage[] },
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (evt: AgentEvent): void => {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    };
    let closed = false;
    res.on("close", () => {
      closed = true;
    });

    try {
      let sessionId = body.sessionId;
      if (!sessionId) {
        sessionId = this.sessions.createSession(body.message?.slice(0, 40) || "New chat").id;
      }
      send({ type: "session", sessionId });
      if (body.message) {
        this.sessions.append(sessionId, "user", body.message);
      }
      const persisted: LlmChatMessage[] = this.sessions
        .messages(sessionId)
        .map((m) => ({ role: m.role, content: m.content } as LlmChatMessage));
      const history = body.history?.length ? body.history : persisted;

      let assistantBuffer = "";
      for await (const evt of this.loop.run(history, { sessionId, model: body.model })) {
        if (closed) break;
        if (evt.type === "message") {
          assistantBuffer += evt.content;
        }
        send(evt);
      }
      if (assistantBuffer.trim()) {
        this.sessions.append(sessionId, "assistant", assistantBuffer.trim());
      }
    } catch (err) {
      send({ type: "error", message: String((err as Error)?.message ?? err) });
    } finally {
      res.end();
    }
  }

  @Get("sessions")
  listSessions(): unknown {
    return this.sessions.listSessions();
  }
}

@Controller("agent")
export class AgentSessionsController {
  constructor(private readonly sessions: ChatSessionsService) {}

  @Get("session/:id/messages")
  messages(@Param("id") id: string): unknown {
    return this.sessions.messages(id);
  }
}

const OPENCODE_PROVIDER = {
  provide: OpencodeClient,
  useFactory: (settings: SettingsService) => new OpencodeClient(settings.settings.opencode),
  inject: [SettingsService],
};

@Module({
  controllers: [AgentController, AgentSessionsController, ModelsController],
  providers: [OPENCODE_PROVIDER, AgentLoopService, ToolRegistry, ChatSessionsService],
  exports: [ToolRegistry, AgentLoopService, OpencodeClient, ChatSessionsService],
})
export class LlmModule {}
