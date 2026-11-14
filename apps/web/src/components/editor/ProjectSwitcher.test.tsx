import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProjectSwitcher } from "./ProjectSwitcher";

vi.mock("../../stores/project-store", () => ({ useProjectStore: () => ({ project: { id: "project", name: "Project A" }, createNewProject: vi.fn(), recoverFromAutoSave: vi.fn(), renameProject: vi.fn() }) }));
vi.mock("../../services/auto-save", () => ({ autoSaveManager: { initialize: vi.fn(async () => {}), checkForRecovery: vi.fn(async () => []) } }));
vi.mock("./ProjectPackageDialog", () => ({ ProjectPackageDialog: () => { throw new Error("Failed to fetch dynamically imported module"); } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("project menu loading", () => {
  it("contains a failed backup dialog without unmounting the editor", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<><div>Editor still available</div><ProjectSwitcher /></>);
    fireEvent.click(screen.getByRole("button", { name: "Project A" }));
    fireEvent.click(await screen.findByRole("button", { name: "项目备份" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("项目备份无法打开");
    expect(screen.getByText("Editor still available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
