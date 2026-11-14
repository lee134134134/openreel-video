import type { JSX } from "react";
import { useState } from "react";
import {
  Baseline,
  Box,
  Circle,
  Crosshair,
  Hand,
  Layers,
  MousePointer2,
  Move,
  PenTool,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePlus,
  Type,
  ZoomIn,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import {
  createMotionLayerOfType,
  type CreatableMotionLayerType,
} from "../motion-layer-factory";
import { useMotionStore, type MotionToolId } from "../stores/motion-store";
import { Button, IconButton } from "./primitives";

interface ToolDef {
  id: MotionToolId;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const TOOL_GROUPS: ReadonlyArray<ReadonlyArray<ToolDef>> = [
  [
    { id: "select", icon: MousePointer2, label: "选择", shortcut: "V" },
    { id: "hand", icon: Hand, label: "抓手", shortcut: "H" },
    { id: "zoom", icon: ZoomIn, label: "缩放", shortcut: "Z" },
  ],
  [
    { id: "move", icon: Move, label: "移动" },
    { id: "rotate", icon: RotateCw, label: "旋转" },
    { id: "anchor", icon: Crosshair, label: "锚点" },
  ],
  [
    { id: "rectangle", icon: Square, label: "矩形", shortcut: "Q" },
    { id: "ellipse", icon: Circle, label: "椭圆" },
    { id: "pen", icon: PenTool, label: "钢笔", shortcut: "G" },
    { id: "text", icon: Type, label: "文字", shortcut: "⌘T" },
    { id: "character", icon: Baseline, label: "字符" },
  ],
];

const ADD_MENU: ReadonlyArray<{
  type: CreatableMotionLayerType;
  icon: LucideIcon;
  label: string;
}> = [
  { type: "text", icon: Type, label: "文本图层" },
  { type: "shape", icon: Square, label: "形状图层" },
  { type: "scene3d", icon: Box, label: "3D 场景" },
  { type: "particle", icon: Sparkles, label: "粒子图层" },
  { type: "adjustment", icon: SlidersHorizontal, label: "调整图层" },
  { type: "group", icon: Layers, label: "组图层" },
  { type: "null", icon: Crosshair, label: "空对象控制器" },
];

export function MotionToolRail(): JSX.Element {
  const activeTool = useMotionStore((state) => state.activeTool);
  const setActiveTool = useMotionStore((state) => state.setActiveTool);
  const activeCompositionId = useMotionStore((state) => state.activeCompositionId);
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const composition = useProjectStore((state) =>
    (state.project.motionCompositions ?? []).find(
      (item) => item.id === activeCompositionId,
    ),
  );
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const [addOpen, setAddOpen] = useState(false);

  const addLayer = (type: CreatableMotionLayerType) => {
    if (!composition) return;
    const layer = createMotionLayerOfType(composition, type);
    void upsertMotionComposition({
      ...composition,
      layers: [...composition.layers, layer],
      modifiedAt: Date.now(),
    });
    selectLayer(layer.id);
    if (type === "text") setRightTab("properties");
    setAddOpen(false);
  };

  return (
    <nav
      aria-label="动态工具"
      className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-bg-1 py-3.5"
    >
      {TOOL_GROUPS.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col items-center gap-1">
          {group.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={activeTool === tool.id}
              onClick={() => {
                setActiveTool(tool.id);
                if (tool.id === "character") setRightTab("properties");
              }}
            />
          ))}
          {groupIndex < TOOL_GROUPS.length - 1 ? (
            <span className="my-1 h-px w-6 bg-border" />
          ) : null}
        </div>
      ))}
      <div className="relative mt-auto flex flex-col items-center gap-1">
        <span className="mb-1 h-px w-6 bg-border" />
        <IconButton
          label="添加图层"
          icon={SquarePlus}
          iconSize={17}
          size="md"
          active={addOpen}
          variant="ghost"
          aria-expanded={addOpen}
          isDisabled={!composition}
          onClick={() => setAddOpen((value) => !value)}
        />
        {addOpen ? (
          <>
            <div
              aria-hidden="true"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setAddOpen(false)}
            />
            <div className="absolute bottom-0 left-[calc(100%+6px)] z-50 w-48 overflow-hidden rounded-lg border border-border bg-bg-elev p-1.5 shadow-lg">
              {ADD_MENU.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.type}
                    label={item.label}
                    variant="ghost"
                    size="sm"
                    icon={Icon}
                    onClick={() => addLayer(item.type)}
                    className="w-full justify-start"
                  />
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </nav>
  );
}

function ToolButton({
  tool,
  active,
  onClick,
}: {
  tool: ToolDef;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  const Icon = tool.icon;
  const tip = tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label;
  return (
    <IconButton
      label={tip}
      icon={Icon}
      iconSize={17}
      size="md"
      active={active}
      variant="ghost"
      aria-pressed={active}
      onClick={onClick}
    />
  );
}
