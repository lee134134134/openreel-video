import type { JSX } from "react";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { useUIStore, type ChatMode } from "../../../stores/ui-store";

const OPTIONS: ReadonlyArray<{ value: ChatMode; label: string }> = [
  { value: "edit", label: "AI 编辑" },
  { value: "studio", label: "AI 工作室" },
];

export function ChatModeSwitch(): JSX.Element {
  const mode = useUIStore((state) => state.chatMode);
  const setMode = useUIStore((state) => state.setChatMode);
  return (
    <ToolcraftSegmentedControl
      ariaLabel="AI 面板模式"
      options={OPTIONS}
      value={mode}
      onChange={setMode}
      className="min-h-7 shrink-0 [&_button]:h-6 [&_button]:px-2 [&_button]:text-[10px]"
    />
  );
}
