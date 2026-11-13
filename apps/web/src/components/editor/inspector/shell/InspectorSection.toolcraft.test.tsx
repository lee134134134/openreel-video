import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InspectorSection } from "./InspectorSection";

describe("InspectorSection", () => {
  it("uses the shared Toolcraft panel section behavior", () => {
    render(
      <InspectorSection title="变换" defaultOpen sectionId="transform">
        <div>Position controls</div>
      </InspectorSection>,
    );

    const header = screen.getByRole("button", {
      name: "折叠变换板块",
    });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Position controls")).toBeInTheDocument();

    fireEvent.click(header);

    expect(
      screen.getByRole("button", { name: "展开变换板块" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
