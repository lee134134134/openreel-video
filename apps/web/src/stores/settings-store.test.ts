import { afterEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./settings-store";

describe("settings store migrations", () => {
  afterEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      autoSave: true,
      defaultLlmProvider: null,
      llmBaseUrl: "",
      llmModel: "",
    });
  });

  it("removes legacy preset selections without discarding other preferences", async () => {
    localStorage.setItem(
      "openreel-settings",
      JSON.stringify({
        version: 5,
        state: {
          autoSave: false,
          defaultLlmProvider: "openai",
          llmModel: "previously-preselected-model",
        },
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      autoSave: false,
      defaultLlmProvider: null,
      llmBaseUrl: "",
      llmModel: "",
    });
  });

  it("migrates an explicitly configured compatible endpoint", async () => {
    localStorage.setItem(
      "openreel-settings",
      JSON.stringify({
        version: 6,
        state: {
          defaultLlmProvider: "openai-compatible",
          llmModel: "ignored-preset-model",
          openaiCompatibleBaseUrl: "http://localhost:11434/v1",
          openaiCompatibleModel: "qwen-tool-model",
        },
      }),
    );

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState()).toMatchObject({
      defaultLlmProvider: "openai-compatible",
      llmBaseUrl: "http://localhost:11434/v1",
      llmModel: "qwen-tool-model",
    });
  });


  it("opens the first tab when no tab or a legacy server tab is requested", () => {
    useSettingsStore.getState().openSettings("api-keys");
    expect(useSettingsStore.getState().settingsTab).toBe("api-keys");

    useSettingsStore.getState().openSettings("server");
    expect(useSettingsStore.getState().settingsTab).toBe("general");

    useSettingsStore.getState().openSettings();
    expect(useSettingsStore.getState().settingsTab).toBe("general");
    expect(useSettingsStore.getState().settingsOpen).toBe(true);
  });
});
