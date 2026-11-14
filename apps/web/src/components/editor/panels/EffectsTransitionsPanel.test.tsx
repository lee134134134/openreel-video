import "../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Clip } from "@openreel/core";
import { disposeTransitionBridge } from "../../../bridges/transition-bridge";
import { createEmptyProject } from "../../../stores/project/project-helpers";
import { useProjectStore } from "../../../stores/project-store";
import { useUIStore } from "../../../stores/ui-store";
import { EffectsPanel, TransitionsPanel } from "./EffectsTransitionsPanel";

describe("editor effect and transition catalogs", () => {
  beforeEach(() => {
    useUIStore.getState().clearSelection();
  });

  afterEach(() => {
    cleanup();
    disposeTransitionBridge();
    useUIStore.getState().clearSelection();
    useProjectStore.setState({
      hasOpenProject: false,
      project: createEmptyProject("重置"),
    });
  });

  it("offers directional transition variants with animated preview cards", () => {
    render(<TransitionsPanel />);

    expect(
      screen.getByRole("button", {
        name: /^向左擦除。拖拽到片段边缘/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /^向下滑入。拖拽到片段边缘/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("甩镜")).toBeInTheDocument();
    expect(screen.getByText("柔和左擦除")).toBeInTheDocument();
    expect(screen.getByText("向下推移")).toBeInTheDocument();
    expect(screen.getByText("冲击缩放")).toBeInTheDocument();
    expect(screen.getByText("像素化")).toBeInTheDocument();
    expect(screen.getByText("故障剪切")).toBeInTheDocument();
    expect(screen.getByText("百叶窗")).toBeInTheDocument();
    expect(screen.getByText("菱形擦除")).toBeInTheDocument();
    expect(screen.getByText("顺时针旋转")).toBeInTheDocument();
    expect(screen.getByText("垂直翻转")).toBeInTheDocument();
    expect(screen.getByText("水平分割")).toBeInTheDocument();
    expect(screen.getByText("闪白剪切")).toBeInTheDocument();
    expect(screen.getByText("胶片灼烧")).toBeInTheDocument();
    expect(screen.getByText("红色胶片灼烧")).toBeInTheDocument();
    expect(screen.getByText("冷色漏光")).toBeInTheDocument();
    expect(screen.getByText("马赛克擦除")).toBeInTheDocument();
    expect(screen.getByText("涟漪")).toBeInTheDocument();
    expect(screen.getByText("向左翻页")).toBeInTheDocument();
    expect(screen.getByText("向右翻页")).toBeInTheDocument();
    expect(screen.getByText("颜色分离")).toBeInTheDocument();
    for (const category of ["溶解", "擦除", "运动", "风格化"]) {
      expect(screen.getAllByText(category).length).toBeGreaterThan(0);
    }
  });

  it("filters the expanded transition library by production category", () => {
    render(<TransitionsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "风格化 13" }));

    expect(screen.getByRole("button", { name: "风格化 13" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("胶片灼烧")).toBeInTheDocument();
    expect(screen.getByText("冲击缩放")).toBeInTheDocument();
    expect(screen.queryByText("向左擦除")).not.toBeInTheDocument();
    expect(screen.queryByText("向下推移")).not.toBeInTheDocument();
  });

  it("includes tonal balance and chroma key in the effect browser", () => {
    render(<EffectsPanel />);

    expect(screen.getByText("影调平衡")).toBeInTheDocument();
    expect(screen.getByText("抠像")).toBeInTheDocument();
    expect(screen.getByText("电影感冲击")).toBeInTheDocument();
    expect(screen.getByText("黄金时刻")).toBeInTheDocument();
    expect(screen.getByText("柔焦")).toBeInTheDocument();
    expect(screen.getByText("梦幻光晕")).toBeInTheDocument();
    expect(screen.getByText("复古颗粒")).toBeInTheDocument();
    expect(screen.getByText("RGB 分离")).toBeInTheDocument();
    expect(screen.getByText("VHS")).toBeInTheDocument();
    expect(screen.getByText("色彩分层")).toBeInTheDocument();
    expect(screen.getByText("双色调")).toBeInTheDocument();
    expect(screen.getByText("棱镜分离")).toBeInTheDocument();
    expect(screen.getByText("鱼眼")).toBeInTheDocument();
    expect(screen.getByText("波浪扭曲")).toBeInTheDocument();
    expect(screen.getByText("扫描线")).toBeInTheDocument();
    expect(screen.getByText("边缘发光")).toBeInTheDocument();
    const preview = screen
      .getByRole("button", {
        name: /^黄金时刻。拖拽到片段上应用/i,
      })
      .querySelector('[data-effect-preview="golden-hour"]');
    expect(preview).toHaveAttribute("data-preview-progress", "0.72");
  });

  it("filters visual effects by category without losing previews", () => {
    render(<EffectsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "风格化 10" }));

    expect(screen.getByRole("button", { name: "风格化 10" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("梦幻光晕")).toBeInTheDocument();
    expect(screen.getByText("RGB 分离")).toBeInTheDocument();
    expect(screen.queryByText("亮度")).not.toBeInTheDocument();
    expect(screen.queryByText("黄金时刻")).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-effect-preview]")).toHaveLength(10);
  });

  it("applies curated effect parameters to the selected overlay", async () => {
    useProjectStore.getState().createNewProject("Curated effect application");
    await useProjectStore.getState().addTrack("text");
    const textTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find((track) => track.type === "text");
    if (!textTrack) throw new Error("text track not created");
    const textClip = useProjectStore
      .getState()
      .createTextClip(textTrack.id, 0, "Golden title", 5);
    if (!textClip) throw new Error("text clip not created");
    useUIStore
      .getState()
      .select({ type: "clip", id: textClip.id, trackId: textTrack.id });
    render(<EffectsPanel />);

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^黄金时刻。拖拽到片段上应用/i,
      }),
    );
    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^VHS。拖拽到片段上应用/i,
      }),
    );

    await waitFor(() => {
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects,
      ).toEqual([
        expect.objectContaining({
          type: "temperature",
          params: { value: 35 },
        }),
        expect.objectContaining({
          type: "shader",
          params: {
            shaderId: "vhs",
            intensity: 0.75,
            scanlines: 0.4,
            jitter: 0.45,
          },
        }),
      ]);
    });
  });

  it("double-clicks an effect onto a selected text overlay", async () => {
    useProjectStore.getState().createNewProject("Text effect application");
    await useProjectStore.getState().addTrack("text");
    const textTrack = useProjectStore
      .getState()
      .project.timeline.tracks.find((track) => track.type === "text");
    if (!textTrack) throw new Error("text track not created");
    const textClip = useProjectStore
      .getState()
      .createTextClip(textTrack.id, 0, "Effect title", 5);
    if (!textClip) throw new Error("text clip not created");
    useUIStore
      .getState()
      .select({ type: "clip", id: textClip.id, trackId: textTrack.id });
    render(<EffectsPanel />);

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: /^亮度。拖拽到片段上应用/i,
      }),
    );

    await waitFor(() => {
      expect(
        useProjectStore
          .getState()
          .project.textClips?.find((clip) => clip.id === textClip.id)
          ?.effects,
      ).toEqual([
        expect.objectContaining({ type: "brightness", enabled: true }),
      ]);
    });
  });

  it("double-clicks a preview variant onto the selected cut with its params", async () => {
    const first = clip("transition-a", 0);
    const second = clip("transition-b", 3);
    const project = createEmptyProject("Transition application");
    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        ...project,
        timeline: {
          ...project.timeline,
          duration: 6,
          tracks: [
            {
              id: "transition-track",
              type: "video",
              name: "视频",
              clips: [first, second],
              transitions: [],
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
            },
          ],
        },
      },
    });
    useUIStore.getState().selectMultiple([
      { type: "clip", id: first.id, trackId: first.trackId },
      { type: "clip", id: second.id, trackId: second.trackId },
    ]);
    render(<TransitionsPanel />);

    fireEvent.doubleClick(
      screen.getByRole("button", { name: /向右翻页。拖拽到/i }),
    );

    await waitFor(() => {
      const transition =
        useProjectStore.getState().project.timeline.tracks[0]?.transitions[0];
      expect(transition).toMatchObject({
        clipAId: first.id,
        clipBId: second.id,
        type: "pageTurn",
        params: { direction: "right", shadow: 0.55 },
      });
    });
  });
});

function clip(id: string, startTime: number): Clip {
  return {
    id,
    mediaId: `media-${id}`,
    trackId: "transition-track",
    startTime,
    duration: 3,
    inPoint: 0,
    outPoint: 3,
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
  };
}
