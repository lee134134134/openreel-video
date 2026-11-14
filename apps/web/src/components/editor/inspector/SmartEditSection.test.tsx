import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SmartEditSection } from "./SmartEditSection";
import { detectScenes } from "@openreel/core";
import { useProjectStore } from "../../../stores/project-store";

vi.mock("@openreel/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openreel/core")>();
  return { ...actual, detectScenes: vi.fn() };
});

const detectScenesMock = vi.mocked(detectScenes);

vi.mock("../../../stores/notification-store", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("../../../stores/timeline-store", () => ({
  useTimelineStore: { getState: () => ({ pause: vi.fn() }) },
}));

const mediaItem = {
  id: "m1",
  name: "clip.mp4",
  type: "video",
  blob: new Blob(["x"]),
  fileHandle: null,
  thumbnailUrl: null,
  waveformData: null,
  metadata: { duration: 10, width: 64, height: 64, frameRate: 30, sampleRate: 48000, channels: 2, fileSize: 1, codec: "avc" },
};

function projectState() {
  return {
    id: "p1",
    name: "T",
    mediaLibrary: { items: [mediaItem] },
    timeline: {
      tracks: [
        {
          id: "t1",
          type: "video",
          clips: [
            { id: "c1", mediaId: "m1", trackId: "t1", startTime: 0, duration: 10, inPoint: 0, outPoint: 10 },
          ],
        },
      ],
    },
  };
}

function setProject() {
  useProjectStore.setState({ project: projectState() } as never);
}

describe("SmartEditSection", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    setProject();
  });

  it("shows the unavailable hint when no media blob exists", () => {
    useProjectStore.setState({
      project: {
        ...projectState(),
        mediaLibrary: { items: [{ ...mediaItem, blob: null }] },
      },
    } as never);
    render(<SmartEditSection clipId="c1" />);
    expect(screen.getByText(/选择一个具有可用源文件的视频片段/)).toBeTruthy();
  });

  it("renders detection controls", () => {
    render(<SmartEditSection clipId="c1" />);
    expect(screen.getByRole("button", { name: /检测场景/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /粗剪/ })).toBeTruthy();
    expect(screen.getByLabelText(/灵敏度/)).toBeTruthy();
  });

  it("disables rough cut until scenes are detected", () => {
    render(<SmartEditSection clipId="c1" />);
    const roughCut = screen.getByRole("button", { name: /粗剪/ }) as HTMLButtonElement;
    expect(roughCut.disabled).toBe(true);
  });

  it("detects scenes and applies the storyboard through executeAction", async () => {
    const executeAction = vi.fn().mockResolvedValue({ success: true });
    useProjectStore.setState({
      project: projectState(),
      executeAction,
      beginHistoryGroup: vi.fn(),
      endHistoryGroup: vi.fn(),
    } as never);

    detectScenesMock.mockResolvedValue({
      scenes: [
        { start: 0, end: 4, score: 0.8 },
        { start: 4, end: 7, score: 0.9 },
      ],
      frameCount: 40,
      distances: [],
    });

    render(<SmartEditSection clipId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: /检测场景/ }));

    await waitFor(() => {
      expect(screen.getByText(/2 个镜头已检测/)).toBeTruthy();
    });

    const roughCut = screen.getByRole("button", { name: /粗剪/ }) as HTMLButtonElement;
    expect(roughCut.disabled).toBe(false);
    fireEvent.click(roughCut);

    await waitFor(() => {
      expect(executeAction).toHaveBeenCalled();
    });
    const action = executeAction.mock.calls[0][0];
    expect(action.type).toBe("smart/applyStoryboard");
    expect(action.params.clipId).toBe("c1");
    expect(action.params.shots).toHaveLength(3); // 2 scenes + tail shot [7..10]
  });
});
