import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideogenJobDTO } from "@openreel/plugin-sdk";
import { RenderedVideoCard } from "./RenderedVideoCard";
import { useProjectStore } from "../../../stores/project-store";

const job: VideogenJobDTO = {
  id: "job-1",
  state: "done",
  progress: 1,
  createdAt: "2026-11-20T00:00:00.000Z",
  durationSec: 3,
  videoUrl: "/api/files/jobs/abc.mp4",
  plan: {
    options: { title: "验证画面", aspectRatio: "16:9", fps: 30, resolution: 720, language: "zh-CN", ttsVoiceId: "v", accentColorHex: "#000000" },
    scenes: [],
    estimatedDurationSec: 3,
  },
} as unknown as VideogenJobDTO;

const resolvedUrl = "http://localhost:4000/api/files/jobs/abc.mp4";

function mockFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === resolvedUrl) {
      return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }), {
        status: 200,
        headers: { "content-length": "3" },
      });
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockCanvas() {
  const toDataURL = vi.fn(() => "data:image/jpeg;base64,poster");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage: vi.fn() }) as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(toDataURL);
  return toDataURL;
}

describe("RenderedVideoCard", () => {
  beforeEach(() => {
    mockFetch();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the finished video against the server url", () => {
    const { container } = render(<RenderedVideoCard job={job} />);
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe(resolvedUrl);
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(screen.getByText("验证画面")).toBeTruthy();
  });

  it("uses a captured frame as the poster so the stage is never blank", async () => {
    mockCanvas();
    const { container } = render(<RenderedVideoCard job={job} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "videoWidth", { value: 1280 });
    Object.defineProperty(video, "videoHeight", { value: 720 });

    fireEvent.loadedData(video);

    await waitFor(() => expect(video.getAttribute("poster")).toBe("data:image/jpeg;base64,poster"));
  });

  it("replaces a dead video element with an actionable error state", async () => {
    const { container } = render(<RenderedVideoCard job={job} />);
    const video = container.querySelector("video") as HTMLVideoElement;

    fireEvent.error(video);

    expect(await screen.findByText("成片无法加载")).toBeTruthy();
    expect(screen.getByText("重新加载")).toBeTruthy();
    expect(screen.getAllByText("下载成片").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("重新加载"));
    await waitFor(() => expect(screen.queryByText("成片无法加载")).toBeNull());
  });

  it("downloads the video as a titled file instead of the server uuid", async () => {
    let clicked: HTMLAnchorElement | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked = this;
    });
    const createObjectURL = vi.fn(() => "blob:finished");
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });

    render(<RenderedVideoCard job={job} />);
    fireEvent.click(screen.getByText("下载"));

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const anchor = clicked as HTMLAnchorElement | null;
    expect(anchor?.download).toBe("验证画面.mp4");
    expect(anchor?.href).toBe("blob:finished");
  });

  it("inserts a finished video as separate caption, music and video layers", async () => {
    const layeredJob = {
      ...job,
      plan: {
        ...job.plan,
        scenes: [
          { index: 0, narration: "开场旁白", subtitle: "开场字幕", durationSec: 3, visualPrompt: "远景", motion: "static" },
        ],
      },
    } as unknown as VideogenJobDTO;

    useProjectStore.setState({
      hasOpenProject: true,
      project: {
        id: "project-1",
        timeline: {
          tracks: [{
            id: "video-track",
            clips: [{ id: "clip-1", mediaId: "media-1", startTime: 0, metadata: {} }],
          }],
        },
      },
    } as never);

    const importMedia = vi.spyOn(useProjectStore.getState(), "importMedia")
      .mockResolvedValue({ success: true, actionId: "media-1" } as never);
    const addClip = vi.spyOn(useProjectStore.getState(), "addClipToNewTrack")
      .mockResolvedValue({ success: true } as never);
    const addSubtitle = vi.spyOn(useProjectStore.getState(), "addSubtitle")
      .mockResolvedValue(undefined);
    const separateAudio = vi.spyOn(useProjectStore.getState(), "separateAudio")
      .mockImplementation(async () => {
        useProjectStore.setState((state) => ({
          project: {
            ...state.project,
            timeline: {
              ...state.project.timeline,
              tracks: [
                {
                  id: "music-track",
                  clips: [{ id: "audio-clip", mediaId: "audio-1", startTime: 0, metadata: { separatedFromClipId: "clip-1" } }],
                },
                ...state.project.timeline.tracks,
              ],
            },
          },
        }) as never);
        return { success: true } as never;
      });
    const renameTrack = vi.spyOn(useProjectStore.getState(), "renameTrack")
      .mockResolvedValue({ success: true } as never);
    const reorderTrack = vi.spyOn(useProjectStore.getState(), "reorderTrack")
      .mockResolvedValue({ success: true } as never);

    render(<RenderedVideoCard job={layeredJob} />);
    fireEvent.click(screen.getByText("插入时间线"));

    await waitFor(() => expect(importMedia).toHaveBeenCalledTimes(1));
    expect(addClip).toHaveBeenCalledWith("media-1", 0);
    expect(addSubtitle).toHaveBeenCalledWith(
      expect.objectContaining({ text: "开场字幕" }),
      expect.objectContaining({ captionSource: "videogen" }),
    );
    expect(separateAudio).toHaveBeenCalledWith("clip-1");
    expect(renameTrack).toHaveBeenCalledWith(expect.any(String), "背景音乐");
    expect(reorderTrack).toHaveBeenCalled();
  });
});
