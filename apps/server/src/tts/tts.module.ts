import { BadRequestException, Body, Controller, Get, Module, OnModuleInit, Post } from "@nestjs/common";
import * as fs from "node:fs";
import * as path from "node:path";
import { TtsRegistry } from "../registry/registry.module";
import { StorageModule } from "../storage/storage.module";
import { StorageService } from "../storage/storage.service";
import { MockTtsAdapter } from "./mock-tts.adapter";
import { ElevenLabsTtsAdapter } from "./elevenlabs-tts.adapter";
import { OpenAiTtsAdapter } from "./openai-tts.adapter";
import { AzureTtsAdapter } from "./azure-tts.adapter";
import { MacosSayTtsAdapter } from "./macos-say.adapter";
import { EdgeTtsAdapter, edgeTtsAvailable } from "./edge-tts.adapter";
import { builtinTtsContext, resolveTts } from "./adapter-context";

interface SynthesizeBody {
  text: string;
  voiceId?: string;
  adapterId?: string;
  speed?: number;
  /** Emotional style (Azure express-as), e.g. cheerful / sad / gentle. */
  emotion?: string;
  /** Emotion intensity 0.01..2. */
  styleDegree?: number;
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
        emotion: body.emotion,
        styleDegree: body.styleDegree,
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
    // 免费在线神经语音（晓晓/云希等）；首次合成前自动安装纯 Python 客户端
    if (edgeTtsAvailable()) {
      this.registry.register(new EdgeTtsAdapter());
    }
    // macOS hosts get real offline speech for free; cloud adapters (configured
    // via env) still take priority through selectPreferredTts.
    if (process.platform === "darwin" && fs.existsSync("/usr/bin/say")) {
      this.registry.register(new MacosSayTtsAdapter());
    }
    this.registry.register(new ElevenLabsTtsAdapter({ apiKey: process.env.ELEVENLABS_API_KEY ?? "" }));
    this.registry.register(new OpenAiTtsAdapter({ apiKey: process.env.OPENAI_API_KEY ?? "" }));
    this.registry.register(new AzureTtsAdapter({
      region: process.env.AZURE_SPEECH_REGION ?? "",
      apiKey: process.env.AZURE_SPEECH_KEY ?? "",
    }));
  }
}
