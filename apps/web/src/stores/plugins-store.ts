import { create } from "zustand";
import {
  listPlugins,
  savePluginCredentials,
  setPluginEnabled,
  type ServerPlugin,
} from "../services/server-ai/agents";

interface PluginsState {
  plugins: ServerPlugin[];
  loading: boolean;
  savingId: string | null;
  error: string | null;
  loadPlugins: () => Promise<void>;
  reloadPlugins: () => Promise<void>;
  togglePlugin: (pluginId: string, enabled: boolean) => Promise<void>;
  saveSettings: (pluginId: string, values: Record<string, unknown>) => Promise<void>;
}

export const usePluginsStore = create<PluginsState>()((set, get) => ({
  plugins: [],
  loading: false,
  savingId: null,
  error: null,

  loadPlugins: async () => {
    set({ loading: true, error: null });
    try {
      const plugins = await listPlugins();
      set({ plugins, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : "无法加载插件" });
    }
  },
  reloadPlugins: async () => {
    // The server currently exposes discovery through GET /api/plugins; reloading
    // re-reads installed manifests without inventing an unsupported endpoint.
    await get().loadPlugins();
  },
  togglePlugin: async (pluginId, enabled) => {
    set({ savingId: pluginId, error: null });
    try {
      await setPluginEnabled(pluginId, enabled);
      set((state) => ({
        savingId: null,
        plugins: state.plugins.map((plugin) => plugin.manifest.id === pluginId ? { ...plugin, enabled } : plugin),
      }));
    } catch (error) {
      set({ savingId: null, error: error instanceof Error ? error.message : "插件状态更新失败" });
    }
  },
  saveSettings: async (pluginId, values) => {
    set({ savingId: pluginId, error: null });
    try {
      await savePluginCredentials(pluginId, values);
      set((state) => ({
        savingId: null,
        plugins: state.plugins.map((plugin) => plugin.manifest.id === pluginId ? { ...plugin, credentials: values } : plugin),
      }));
    } catch (error) {
      set({ savingId: null, error: error instanceof Error ? error.message : "插件设置保存失败" });
      throw error;
    }
  },
}));
