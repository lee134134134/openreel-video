import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginContext, TtsAdapter, TtsClipResult, TtsSynthesisOptions, TtsVoice } from "@openreel/plugin-sdk";

const SAMPLE_RATE = 22050;

/** Offline deterministic PCM synth, suitable for development and tests. */
export class MockTtsAdapter implements TtsAdapter {
  readonly id = "mock";
  readonly label = "Mock PCM TTS（离线）";

  async voices(_ctx: PluginContext): Promise<TtsVoice[]> {
    return [{ id: "mock", label: "离线测试语音" }];
  }

  async synthesize(
    text: string,
    options: TtsSynthesisOptions,
    out: { dir: string; basename: string },
    _ctx: PluginContext,
  ): Promise<TtsClipResult> {
    const speed = Number.isFinite(options.speed) && Number(options.speed) > 0 ? Number(options.speed) : 1;
    const seconds = Math.max(1.5, Math.min(30, (text.length * 0.09) / speed));
    const frames = Math.max(1, Math.round(seconds * SAMPLE_RATE));
    const dataSize = frames * 2;
    const wav = Buffer.alloc(44 + dataSize);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); // PCM
    wav.writeUInt16LE(1, 22); // mono
    wav.writeUInt32LE(SAMPLE_RATE, 24);
    wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(dataSize, 40);
    // A quiet tone makes the artifact useful to ffmpeg while remaining unobtrusive.
    for (let i = 0; i < frames; i += 1) {
      const envelope = Math.min(1, i / 220, (frames - i - 1) / 220);
      wav.writeInt16LE(Math.round(Math.sin((i / SAMPLE_RATE) * Math.PI * 2 * 220) * 500 * envelope), 44 + i * 2);
    }
    fs.mkdirSync(out.dir, { recursive: true });
    const audioPath = path.join(out.dir, `${out.basename}.wav`);
    fs.writeFileSync(audioPath, wav);
    return {
      audioPath,
      durationSec: frames / SAMPLE_RATE,
      voiceId: options.voiceId,
      text,
    };
  }
}
