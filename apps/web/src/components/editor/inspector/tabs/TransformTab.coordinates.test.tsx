import "../../../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transform } from "@openreel/core";
import { TransformTab } from "./TransformTab";

const overlayTransform: Transform = {
  position: { x: 0.5, y: 0.5 },
  scale: { x: 1, y: 1 },
  rotation: 0,
  anchor: { x: 0.5, y: 0.5 },
  opacity: 1,
};

afterEach(cleanup);

describe("TransformTab canvas coordinates", () => {
  it("displays normalized overlay positions as canvas pixels", () => {
    const onChange = vi.fn();
    render(
      <TransformTab
        clipId="text-1"
        clipType="text"
        selectedClip={{ id: "text-1", mediaId: "text-text-1" }}
        showTransformControls
        showVideoControls={false}
        transform={overlayTransform}
        canvasWidth={1920}
        canvasHeight={1080}
        handleTransformChange={onChange}
      />,
    );

    expect(screen.getByRole("textbox", { name: "位置 X" })).toHaveValue(
      "960",
    );
    expect(screen.getByRole("textbox", { name: "位置 Y" })).toHaveValue(
      "540",
    );
    expect(screen.getByRole("textbox", { name: "锚点 X" })).toHaveValue(
      "50%",
    );
    expect(screen.getByText("画布像素")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "位置 X" }), {
      target: { value: "1200" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 0.625, y: 0.5 },
    });

    fireEvent.click(screen.getByRole("button", { name: "向右微调 1 像素" }));
    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 0.5 + 1 / 1920, y: 0.5 },
    });
  });

  it("keeps media positions as pixel offsets from canvas center", () => {
    const onChange = vi.fn();
    render(
      <TransformTab
        clipId="video-1"
        clipType="video"
        selectedClip={{ id: "video-1", mediaId: "media-1" }}
        showTransformControls
        showVideoControls={false}
        transform={{
          ...overlayTransform,
          position: { x: 120, y: -40 },
        }}
        canvasWidth={1920}
        canvasHeight={1080}
        handleTransformChange={onChange}
      />,
    );

    expect(screen.getByRole("textbox", { name: "位置 X" })).toHaveValue(
      "120",
    );
    expect(screen.getByRole("textbox", { name: "位置 Y" })).toHaveValue(
      "-40",
    );
    expect(screen.getByText("偏移像素")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开对齐板块" }));
    fireEvent.click(screen.getByRole("button", { name: "在画布上居中" }));
    expect(onChange).toHaveBeenLastCalledWith({
      position: { x: 0, y: 0 },
    });
  });
});
