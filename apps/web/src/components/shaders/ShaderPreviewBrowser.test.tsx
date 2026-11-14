import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMotionShaderFillDefs } from "@openreel/core";
import { ShaderPreviewBrowser } from "./ShaderPreviewBrowser";

describe("ShaderPreviewBrowser", () => {
  afterEach(cleanup);

  it("shows visual choices, filters them, and applies the previewed shader", () => {
    const defs = getMotionShaderFillDefs().filter((def) =>
      ["liquid-metal", "paper-mesh-gradient", "paper-dot-grid"].includes(
        def.id,
      ),
    );
    const onSelect = vi.fn();

    render(
      <ShaderPreviewBrowser
        defs={defs}
        selectedId="liquid-metal"
        onSelect={onSelect}
        sample="text"
        label="文字材质预览"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Preview and select 液态金属" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Preview and select 网格渐变" }),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search 文字材质预览" }),
      { target: { value: "点阵" } },
    );

    expect(
      screen.queryByRole("button", { name: "Preview and select 网格渐变" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview and select 点阵网格" }),
    );
    expect(onSelect).toHaveBeenCalledWith("paper-dot-grid");
  });

  it("labels effect search as effects instead of materials", () => {
    render(
      <ShaderPreviewBrowser
        defs={getMotionShaderFillDefs().slice(0, 1)}
        onSelect={vi.fn()}
        sample="effect"
        label="Effect previews"
      />,
    );

    expect(
      screen.getByRole("searchbox", { name: "Search effect previews" }),
    ).toHaveAttribute("placeholder", "搜索效果");
    expect(
      screen.getByRole("button", { name: /Preview and apply/ }),
    ).not.toHaveAttribute("aria-pressed");
  });

  it("disambiguates previews when shader names repeat across collections", () => {
    const builtIn = getMotionShaderFillDefs().find(
      (def) => def.name === "液态金属",
    );
    expect(builtIn).toBeDefined();
    const defs = [
      builtIn!,
      {
        ...builtIn!,
        id: "paper-liquid-metal-test",
        collection: "Paper",
        category: "effect" as const,
      },
    ];
    render(
      <ShaderPreviewBrowser
        defs={defs}
        onSelect={vi.fn()}
        sample="text"
        label="文字材质预览"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Preview and select 液态金属, 内置 fill",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Preview and select 液态金属, Paper effect",
      }),
    ).toBeInTheDocument();
  });

  it("filters previews by shader collection while retaining visual selection", () => {
    const defs = getMotionShaderFillDefs().filter((def) =>
      ["liquid-metal", "paper-mesh-gradient", "paper-dot-grid"].includes(def.id),
    );
    render(
      <ShaderPreviewBrowser
        defs={defs}
        onSelect={vi.fn()}
        sample="text"
        label="文字材质预览"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Paper · 2/i }));
    expect(screen.getByRole("button", { name: /Paper · 2/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Preview and select 液态金属" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview and select 网格渐变" }),
    ).toBeInTheDocument();
  });
});
