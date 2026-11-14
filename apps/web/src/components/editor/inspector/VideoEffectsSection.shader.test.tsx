import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project } from "@openreel/core";
import { getMotionShaderDef, getMotionShaderEffectDefs } from "@openreel/core";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { VideoEffectsSection } from "./VideoEffectsSection";

const clipId = "clip-shader";

const createProjectWithShaderEffect = (): Project => {
  const project = createEmptyProject("Shader Effect");
  return {
    ...project,
    timeline: {
      ...project.timeline,
      duration: 5,
      tracks: [
        {
          id: "track-video",
          type: "video",
          name: "V1",
          clips: [
            {
              id: clipId,
              mediaId: "media-1",
              trackId: "track-video",
              startTime: 0,
              duration: 5,
              inPoint: 0,
              outPoint: 5,
              effects: [
                {
                  id: "effect-shader-1",
                  type: "shader",
                  enabled: true,
                  params: { shaderId: "paper-halftone-dots", size: 0.6 },
                },
              ],
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
  } as unknown as Project;
};

const createProjectWithOrderedEffects = (): Project => {
  const project = createProjectWithShaderEffect();
  return {
    ...project,
    timeline: {
      ...project.timeline,
      tracks: project.timeline.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                effects: [
                  ...clip.effects,
                  {
                    id: "effect-brightness-1",
                    type: "brightness",
                    enabled: true,
                    params: { value: 20 },
                  },
                ],
              }
            : clip,
        ),
      })),
    },
  } as Project;
};

describe("VideoEffectsSection shader effect", () => {
  beforeEach(() => {
    useProjectStore.setState({ project: createProjectWithShaderEffect() });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the shader effect card with its name and a numeric param slider", () => {
    render(<VideoEffectsSection clipId={clipId} />);
    const def = getMotionShaderDef("paper-halftone-dots");
    expect(def).toBeDefined();
    expect(screen.getAllByText(def!.name).length).toBeGreaterThan(0);
    const numericParam = def!.params.find((p) => p.type === "number");
    expect(numericParam).toBeDefined();
    expect(screen.getByText(numericParam!.label)).toBeInTheDocument();
  });

  it("shows an Add Effect trigger for adding more effects", () => {
    render(<VideoEffectsSection clipId={clipId} />);
    expect(screen.getByText("添加效果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制效果栈" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "清除效果栈" })).toBeEnabled();
  });

  it("clears the authored stack from one inspector action", async () => {
    render(<VideoEffectsSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: "清除效果栈" }));

    await waitFor(() => {
      expect(useProjectStore.getState().getVideoEffects(clipId)).toEqual([]);
    });
  });

  it("copies and pastes the authored stack with fresh effect ids", async () => {
    render(<VideoEffectsSection clipId={clipId} />);
    const sourceId = useProjectStore.getState().getVideoEffects(clipId)[0]!.id;

    fireEvent.click(screen.getByRole("button", { name: "复制效果栈" }));
    fireEvent.click(screen.getByRole("button", { name: "粘贴效果栈" }));

    await waitFor(() => {
      const effects = useProjectStore.getState().getVideoEffects(clipId);
      expect(effects).toHaveLength(2);
      expect(effects[1]).toMatchObject({
        type: "shader",
        params: { shaderId: "paper-halftone-dots", size: 0.6 },
      });
      expect(effects[1]?.id).not.toBe(sourceId);
    });
  });

  it("duplicates an authored effect from its card", async () => {
    render(<VideoEffectsSection clipId={clipId} />);

    fireEvent.click(screen.getByRole("button", { name: "复制效果" }));

    await waitFor(() => {
      const effects = useProjectStore.getState().getVideoEffects(clipId);
      expect(effects).toHaveLength(2);
      expect(effects[1]).toMatchObject({
        type: "shader",
        enabled: true,
        params: { shaderId: "paper-halftone-dots", size: 0.6 },
      });
      expect(effects[1]?.id).not.toBe(effects[0]?.id);
    });
  });

  it("opens a searchable visual picker for standard and shader effects", () => {
    render(<VideoEffectsSection clipId={clipId} />);

    fireEvent.click(screen.getByText("添加效果"));
    expect(
      screen.getByRole("button", { name: "预览并添加亮度" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "预览并添加影调平衡" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "预览并添加抠像" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "预览并添加灰度" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "预览并添加棕褐" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "预览并添加反转" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search visual effects" }), {
      target: { value: "径向" },
    });
    expect(
      screen.getByRole("button", { name: "预览并添加径向模糊" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "预览并添加亮度" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: `着色器 · ${getMotionShaderEffectDefs().length}`,
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Preview and apply 半调网点",
      }),
    ).toBeInTheDocument();
  });

  it("reorders the authored effect stack from accessible controls", () => {
    useProjectStore.setState({ project: createProjectWithOrderedEffects() });
    render(<VideoEffectsSection clipId={clipId} />);
    const shaderName = getMotionShaderDef("paper-halftone-dots")!.name;

    fireEvent.click(screen.getByRole("button", { name: `将 ${shaderName} 下移` }));

    expect(
      useProjectStore
        .getState()
        .getVideoEffects(clipId)
        .map((effect) => effect.id),
    ).toEqual(["effect-brightness-1", "effect-shader-1"]);
    expect(
      screen.getByRole("button", { name: `Reorder ${shaderName}` }),
    ).toHaveAttribute("draggable", "true");
  });
});
