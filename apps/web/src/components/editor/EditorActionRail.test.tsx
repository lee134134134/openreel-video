import "../../test/install-local-storage-mock";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useThemeStore } from "../../stores/theme-store";
import { EditorActionRail } from "./EditorActionRail";

describe("EditorActionRail", () => {
  beforeEach(() => {
    useThemeStore.getState().setMode("light");
  });

  afterEach(() => cleanup());

  it("exposes theme switching as a visible rail action", () => {
    render(<EditorActionRail />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "主题：浅色，切换到深色",
      }),
    );

    expect(useThemeStore.getState().mode).toBe("dark");
    expect(
      screen.getByRole("button", {
        name: "主题：深色，切换到跟随系统",
      }),
    ).toBeInTheDocument();
  });
});
