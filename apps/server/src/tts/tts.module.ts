import { BadRequestException, Body, Controller, Get, Module, OnModuleInit, Post } from "@nestjs/common";
import * as path from "node:path";
import { TtsRegistry } from "../registry/registry.module";
import { StorageModule } from "../storage/storage.module";
import { StorageService } from "../storage/storage.service";
import { MockTtsAdapter } from "./mock-tts.adapter";
import { ElevenLabsTtsAdapter } from "./elevenlabs-tts.adapter";
import { OpenAiTtsAdapter } from "./openai-tts.adapter";
import { AzureTtsAdapter } from "./azure-tts.adapter";
import { builtinTtsContext, resolveTts } from "./adapter-context";

interface SynthesizeBody {
  text: string;
  voiceId?: string;
  adapterId?: string;
  speed?: number;
}

@Controller("tts")
export class TtsController {
  constructor(private readonly registry: TtsRegistry, private readonly storage: StorageService) {}

  @Get("adapters")
  adapters(): unknown {
    return this.registry.list().map((adapter) => ({ id: adapter.id, label: adapter.label }));
  }

  @Post("synthesize")
  async synthesize(@Body() body: SynthesizeBody): Promise<unknown> {
    if (!body?.text?.trim()) throw new BadRequestException("text 不能为空");
    try {
      const adapter = resolveTts(this.registry, body.adapterId);
      const dir = this.storage.uploadDir();
      this.storage.ensureDir(dir);
      const result = await adapter.synthesize(body.text, {
        voiceId: body.voiceId || "mock",
        speed: body.speed,
      }, { dir, basename: crypto.randomUUID() }, builtinTtsContext);
      const name = path.basename(result.audioPath);
      return {
        audioPath: `uploads/${name}`,
        url: `/api/files/uploads/${encodeURIComponent(name)}`,
        durationSec: result.durationSec,
        voiceId: result.voiceId,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(String((err as Error)?.message ?? err));
    }
  }
}

@Module({
  imports: [StorageModule],
  controllers: [TtsController],
})
export class TtsModule implements OnModuleInit {
  constructor(private readonly registry: TtsRegistry) {}

  onModuleInit(): void {
    this.registry.register(new MockTtsAdapter());
    this.registry.register(new ElevenLabsTtsAdapter({ apiKey: process.env.ELEVENLABS_API_KEY ?? "" }));
    this.registry.register(new OpenAiTtsAdapter({ apiKey: process.env.OPENAI_API_KEY ?? "" }));
    this.registry.register(new AzureTtsAdapter({
      region: process.env.AZURE_SPEECH_REGION ?? "",
      apiKey: process.env.AZURE_SPEECH_KEY ?? "",
    }));
  }
}
