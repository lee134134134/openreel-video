import { Injectable } from "@nestjs/common";
import type { LlmToolDefinition } from "@openreel/plugin-sdk";

export interface ServerAgentTool {
  name: string;
  description: string;
  /** JSON schema for the tool's arguments. */
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolCallCtx): Promise<unknown>;
}

export interface ToolCallCtx {
  sessionId: string;
  projectId?: string;
  /** Abruch streaming to the client mid-loop (progress notes). */
  emitStatus?: (status: string, tool?: string) => void;
}

/**
 * Registry the agent loop consults. Domains (videogen / publish / projects)
 * self-register tools via onModuleInit.
 */
@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, ServerAgentTool>();

  register(tool: ServerAgentTool): void {
    if (this.tools.has(tool.name)) return;
    this.tools.set(tool.name, tool);
  }

  list(): ServerAgentTool[] {
    return [...this.tools.values()];
  }

  definitions(): LlmToolDefinition[] {
    return this.list().map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters ?? {} },
    }));
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`unknown tool: ${name}`);
    return tool.execute(args, { sessionId: "" });
  }
}
