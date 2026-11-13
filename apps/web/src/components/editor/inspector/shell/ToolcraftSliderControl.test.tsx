import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolcraftSliderControl } from "@openreel/ui";

describe("ToolcraftSliderControl", () => {
  it("commits edited percent labels back to normalized slider values", () => {
    const onChange = vi.fn();

    render(
      <ToolcraftSliderControl
        label="不透明度"
        value={0.5}
        onChange={onChange}
        min={0}
        max={1}
        step={0.01}
        formatValue={(value) => `${Math.round(value * 100)}%`}
      />,
    );

    expect(screen.getByRole("slider", { name: "不透明度" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑不透明度数值" }));
    const input = screen.getByRole("textbox", { name: "不透明度 数值" });
    fireEvent.change(input, { target: { value: "25%" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(0.25);
  });
});
