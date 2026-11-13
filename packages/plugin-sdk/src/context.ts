/**
 * Plugin runtime context handed to adapters by the server.
 */

export interface PluginLogger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/**
 * Per-plugin namespaced storage: credentials filled in the Plugin Center,
 * opaque JSON blobs, enablement flags.
 */
export interface PluginKeyValueStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** Merged view mirroring the settings contribution of the manifest. */
  getCredentials(): Promise<Record<string, unknown>>;
  setCredentials(values: Record<string, unknown>): Promise<void>;
}

export interface PluginWorkspace {
  /** Scratch dir allocated for this plugin, e.g. to write temp media. */
  scratchDir(): Promise<string>;
}

export interface PluginHttp {
  /** Thin fetch passthrough for plugins (adds default user agent, timeout). */
  fetch(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>;
}

export interface PluginContext {
  manifest: import("./manifest").PluginManifest;
  enabled: boolean;
  logger: PluginLogger;
  /**
   * Resolved credential/config values for the plugin (from Plugin Center
   * forms or .env fallbacks, e.g. OPENREEL_PLUGIN_<ID>_FOO).
   */
  credentials: Record<string, unknown>;
  config: { dataDir: string; serverUrl: string; port: number; secret: string };
  store: PluginKeyValueStore;
  workspace: PluginWorkspace;
  http: PluginHttp;
}

/**
 * Static factory signature every plugin entry file must default-export.
 * Adapters returned get wired into the matching registries.
 */
export interface OpenReelPlugin {
  manifest: () => import("./manifest").PluginManifest;
  adapters: (
    ctx: PluginContext,
  ) => Promise<{
    llm?: import("./adapters").LlmProviderAdapter;
    tts?: import("./adapters").TtsAdapter;
    videogen?: import("./adapters").VideogenAdapter;
    publish?: import("./adapters").PublishConnectorAdapter;
  }>;
}
