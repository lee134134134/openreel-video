import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { autoLearnNoiseProfile, type Project } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import {
  createNoiseReductionEffect,
  DEFAULT_NOISE_REDUCTION,
} from "../../../bridges/audio-bridge-effects";
import * as audioBridgeEffects from "../../../bridges/audio-bridge-effects";
import { NoiseReductionSection } from "./NoiseReductionSection";

vi.mock("@openreel/core", async () => {
  const actual = await vi.importActual<typeof import("@openreel/core")>("@openreel/core");
  return {
    ...actual,
    autoLearnNoiseProfile: vi.fn(),
  };
});

const clipId = "clip-noise";
const trackId = "track-audio";

const createValidAnalyzedProfile = () => {
  const frequencyBins = new Float32Array(1024);
  const magnitudes = new Float32Array(1024);
  const standardDeviations = new Float32Array(1024);

  for (let index = 0; index < 1024; index += 1) {
    frequencyBins[index] = index * (48000 / 2048);
    magnitudes[index] = 0.78 + ((index % 7) * 0.005);
    standardDeviations[index] = 0.03;
  }

  return {
    frequencyBins,
    magnitudes,
    standardDeviations,
    sampleRate: 48000,
    fftSize: 2048,
  };
};

const createProjectWithNoiseReduction = (): Project => {
  const project = createEmptyProject("Noise Reduction Persistence");
  const noiseReductionEffect = createNoiseReductionEffect({
    ...DEFAULT_NOISE_REDUCTION,
    threshold: -36,
    reduction: 0.64,
    attack: 9,
    release: 130,
    focus: "speech",
    profile: {
      frequencyBins: [80, 250, 1000, 4000],
      magnitudes: [0.35, 0.28, 0.12, 0.08],
      sampleRate: 48000,
    },
  });

  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 6,
      tracks: [
        {
          id: trackId,
          type: "video",
          name: "Primary",
          clips: [
            {
              id: clipId,
              mediaId: "media-1",
              trackId,
              startTime: 0,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              effects: [],
              audioEffects: [noiseReductionEffect],
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
              volume: 1,
              keyframes: [],
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
};

const createProjectForAnalysis = (): Project => {
  const project = createEmptyProject("Noise Recommendation");

  return {
    ...project,
    mediaLibrary: {
      items: [
        {
          id: "media-1",
          name: "noisy-video.mp4",
          type: "video",
          fileHandle: null,
          blob: {
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
          } as unknown as Blob,
          metadata: {
            duration: 6,
            width: 1920,
            height: 1080,
            frameRate: 30,
            codec: "h264",
            sampleRate: 48000,
            channels: 2,
            fileSize: 5,
          },
          thumbnailUrl: null,
          waveformData: null,
        },
      ],
    },
    timeline: {
      ...project.timeline,
      duration: 6,
      tracks: [
        {
          id: trackId,
          type: "video",
          name: "Primary",
          clips: [
            {
              id: clipId,
              mediaId: "media-1",
              trackId,
              startTime: 0,
              duration: 6,
              inPoint: 0,
              outPoint: 6,
              effects: [],
              audioEffects: [],
              transform: {
                position: { x: 0, y: 0 },
                scale: { x: 1, y: 1 },
                rotation: 0,
                anchor: { x: 0.5, y: 0.5 },
                opacity: 1,
              },
              volume: 1,
              keyframes: [],
            },
          ],
          transitions: [],
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
    },
  };
};

describe("NoiseReductionSection persistence", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "AudioContext", {
      writable: true,
      value: window.AudioContext,
    });
    vi.mocked(autoLearnNoiseProfile).mockReset();
    vi.spyOn(audioBridgeEffects, "initializeAudioBridgeEffects").mockResolvedValue(
      audioBridgeEffects.getAudioBridgeEffects(),
    );
    useProjectStore.setState({
      project: createProjectWithNoiseReduction(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useProjectStore.setState({ project: createEmptyProject("重置") });
  });

  it("rehydrates persisted noise removal after the clip is selected again", async () => {
    const firstRender = render(<NoiseReductionSection clipId={clipId} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "试听原始" })).not.toBeDisabled();
      expect(screen.getByRole("button", { name: "试听清理后" })).not.toBeDisabled();
      expect(screen.getByText(/当前模式：/)).toHaveTextContent("人声聚焦");
    });

    firstRender.unmount();

    render(<NoiseReductionSection clipId={clipId} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "试听原始" })).not.toBeDisabled();
      expect(screen.getByText(/当前模式：/)).toHaveTextContent("人声聚焦");
    });
  });

  it("shows an explicit apply action before saving analyzed recommendations", async () => {
    vi.mocked(autoLearnNoiseProfile).mockResolvedValue(createValidAnalyzedProfile());
    vi.spyOn(
      audioBridgeEffects.getAudioBridgeEffects(),
      "learnNoiseProfile",
    ).mockResolvedValue({
      id: `profile-${clipId}`,
      frequencyBins: createValidAnalyzedProfile().frequencyBins,
      magnitudes: createValidAnalyzedProfile().magnitudes,
      standardDeviations: createValidAnalyzedProfile().standardDeviations,
      fftSize: 2048,
      sampleRate: 48000,
      createdAt: Date.now(),
    });
    useProjectStore.setState({ project: createProjectForAnalysis() });

    render(<NoiseReductionSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: /分析并推荐/i }));

    await waitFor(() => {
      expect(autoLearnNoiseProfile).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText("建议已就绪")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "应用推荐清理" })).toBeInTheDocument();
    });

    expect(useProjectStore.getState().getAudioEffects(clipId)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "应用推荐清理" }));

    await waitFor(() => {
      const effect = useProjectStore.getState().getAudioEffects(clipId)[0];
      expect(effect?.type).toBe("noiseReduction");
      expect(typeof (effect?.params as { focus?: unknown }).focus).toBe("string");
      expect((effect?.params as { profile?: unknown }).profile).toBeTruthy();
      expect(screen.getByText(/已应用到该片段/)).toBeInTheDocument();
    });
  });

  it("auto-learns a profile when a preset is clicked directly", async () => {
    vi.mocked(autoLearnNoiseProfile).mockResolvedValue(createValidAnalyzedProfile());
    useProjectStore.setState({ project: createProjectForAnalysis() });

    render(<NoiseReductionSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: /白噪声/i }));

    await waitFor(() => {
      expect(autoLearnNoiseProfile).toHaveBeenCalled();
    });

    await waitFor(() => {
      const effect = useProjectStore.getState().getAudioEffects(clipId)[0];
      expect(effect?.type).toBe("noiseReduction");
      expect(effect?.params).toMatchObject({ focus: "whiteNoise" });
      expect((effect?.params as { profile?: unknown }).profile).toBeTruthy();
      expect(screen.getByText(/白噪声 已学习并应用到该片段/)).toBeInTheDocument();
    });
  });

  it("still recommends a preset when no pure noise-only profile can be learned", async () => {
    vi.mocked(autoLearnNoiseProfile).mockResolvedValue(null);
    useProjectStore.setState({ project: createProjectForAnalysis() });

    render(<NoiseReductionSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: /分析并推荐/i }));

    await waitFor(() => {
      expect(screen.getByText("建议已就绪")).toBeInTheDocument();
      expect(
        screen.getByText(/无法提取自定义配置/),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "应用推荐清理" }));

    await waitFor(() => {
      const effect = useProjectStore.getState().getAudioEffects(clipId)[0];
      expect(effect?.type).toBe("noiseReduction");
      expect((effect?.params as { profile?: unknown }).profile).toBeUndefined();
    });
  });
});