import { Global, Injectable, Module } from "@nestjs/common";
import type { TtsAdapter, PublishConnectorAdapter } from "@openreel/plugin-sdk";
import type { VideogenAvatar, VideogenClip, VideogenScenePlan } from "@openreel/plugin-sdk";

/** Reduced server-side contract; built-in scene generation needs no plugin context. */
export interface LocalVideogenAdapter {
  id: string;
  label: string;
  generateScene(
    scene: VideogenScenePlan,
    options: { outDir: string; width: number; height: number; fps: number; voiceId?: string },
  ): Promise<VideogenClip>;
}

/** Singletons shared by videogen / tts / publish / plugins modules. */

@Injectable()
export class VideogenRegistry {
  private readonly adapters = new Map<string, LocalVideogenAdapter>();
  /** Built-in person presets surfaced in the AI Studio creator UI. */
  avatars: VideogenAvatar[] = [
    { id: "pro-host-f", label: "职业主播（女，线性叙述）", source: "builtin", voiceId: "openreel-narrator-f" },
    { id: "pro-host-m", label: "职业主播（男，沉稳叙述）", source: "builtin", voiceId: "openreel-narrator-m" },
    { id: "blogger-casual", label: "生活博主（轻松亲切）", source: "builtin", voiceId: "openreel-casual-f" },
  ];

  register(adapter: LocalVideogenAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** Plugin lifecycle: detach one adapter. */
  remove(id: string): void {
    this.adapters.delete(id);
  }

  list(): LocalVideogenAdapter[] {
    return [...this.adapters.values()];
  }

  resolve(adapterId: string | undefined): LocalVideogenAdapter {
    const explicit = adapterId ? this.adapters.get(adapterId) : undefined;
    if (explicit) return explicit;
    const local = this.adapters.get("local-compose");
    if (local) return local;
    const first = this.list()[0];
    if (!first) throw new Error("no videogen adapter registered");
    return first;
  }
}

@Injectable()
export class TtsRegistry {
  private readonly adapters = new Map<string, TtsAdapter>();

  register(adapter: TtsAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** Plugin lifecycle: detach one adapter. */
  remove(id: string): void {
    this.adapters.delete(id);
  }

  list(): TtsAdapter[] {
    return [...this.adapters.values()];
  }

  default(): TtsAdapter {
    const preferred = this.list().find((a) => a.id === "elevenlabs") ?? this.list()[0];
    if (!preferred) throw new Error("no tts adapter registered");
    return preferred;
  }
}

@Injectable()
export class PublishRegistry {
  private readonly adapters = new Map<string, PublishConnectorAdapter>();

  register(adapter: PublishConnectorAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /** Plugin lifecycle: detach one connector. */
  remove(id: string): void {
    this.adapters.delete(id);
  }

  list(): PublishConnectorAdapter[] {
    return [...this.adapters.values()];
  }

  get(id: string): PublishConnectorAdapter {
    const a = this.adapters.get(id);
    if (!a) throw new Error(`publish connector not found: ${id}`);
    return a;
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }
}

@Global()
@Module({
  providers: [VideogenRegistry, TtsRegistry, PublishRegistry],
  exports: [VideogenRegistry, TtsRegistry, PublishRegistry],
})
export class RegistryModule {}
