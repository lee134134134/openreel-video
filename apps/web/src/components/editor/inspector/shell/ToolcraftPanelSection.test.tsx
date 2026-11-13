import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolcraftPanelSection } from "@openreel/ui";

describe("ToolcraftPanelSection", () => {
  it("exposes a collapsible Toolcraft-style section header", () => {
    const { rerender } = render(
      <ToolcraftPanelSection
        title="变换"
        collapsed={false}
        onCollapsedChange={() => undefined}
      >
        <div>Position controls</div>
      </ToolcraftPanelSection>,
    );

    expect(
      screen.getByRole("button", { name: "折叠变换板块" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Position controls")).toBeInTheDocument();

    rerender(
      <ToolcraftPanelSection
        title="变换"
        collapsed
        onCollapsedChange={() => undefined}
      >
        <div>Position controls</div>
      </ToolcraftPanelSection>,
    );

    expect(
      screen.getByRole("button", { name: "展开变换板块" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("requests collapse changes when toggled", () => {
    const onCollapsedChange = vi.fn();

    render(
      <ToolcraftPanelSection
        title="变换"
        collapsed={false}
        onCollapsedChange={onCollapsedChange}
      >
        <div>Position controls</div>
      </ToolcraftPanelSection>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "折叠变换板块" }),
    );

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("can manage collapsed state when used uncontrolled", () => {
    render(
      <ToolcraftPanelSection title="相机">
        <div>Camera controls</div>
      </ToolcraftPanelSection>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "折叠相机板块" }),
    );

    expect(
      screen.getByRole("button", { name: "展开相机板块" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
