import type { JSX } from "react";
import {
  Box,
  Diamond,
  GitBranch,
  ImagePlus,
  Library,
  LineChart,
  PackageCheck,
  Radar,
  Scissors,
  Shapes,
  Sparkles,
  Type,
  Wand2,
  Waves,
  Zap,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import type { MotionComposition } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import {
  createMotionLayerOfType,
  type CreatableMotionLayerType,
} from "../motion-layer-factory";
import {
  useMotionStore,
  type MotionLeftTab,
  type MotionRightTab,
} from "../stores/motion-store";
import { PanelHeader } from "./primitives";

interface MotionStartPanelProps {
  composition: MotionComposition;
}

interface StartAction {
  readonly label: string;
  readonly detail: string;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

export function MotionStartPanel({
  composition,
}: MotionStartPanelProps): JSX.Element {
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setLeftTab = useMotionStore((state) => state.setLeftTab);
  const setRightTab = useMotionStore((state) => state.setRightTab);

  const openLeft = (tab: MotionLeftTab) => {
    setLeftTab(tab);
  };

  const openRight = (tab: MotionRightTab) => {
    setRightTab(tab);
  };

  const addLayer = (
    type: CreatableMotionLayerType,
    rightTab: MotionRightTab = "properties",
  ) => {
    const layer = createMotionLayerOfType(composition, type);
    void upsertMotionComposition({
      ...composition,
      layers: [...composition.layers, layer],
      modifiedAt: Date.now(),
    });
    selectLayer(layer.id);
    setLeftTab("layers");
    setRightTab(rightTab);
  };

  const workflowSections: Array<{
    readonly title: string;
    readonly actions: StartAction[];
  }> = [
    {
      title: "打开",
      actions: [
        {
          label: "模板",
          detail: "Logo 揭示、动感文字、产品展示",
          icon: Sparkles,
          run: () => openLeft("templates"),
        },
        {
          label: "素材",
          detail: "视频、图片、SVG、Lottie",
          icon: Library,
          run: () => openLeft("assets"),
        },
      ],
    },
    {
      title: "搭建",
      actions: [
        {
          label: "文本",
          detail: "文字、字形着色器、文字动画器",
          icon: Type,
          run: () => addLayer("text", "properties"),
        },
        {
          label: "形状",
          detail: "矢量、渐变、修剪路径",
          icon: Shapes,
          run: () => addLayer("shape", "properties"),
        },
        {
          label: "3D 场景",
          detail: "对象、相机、灯光、材质",
          icon: Box,
          run: () => addLayer("scene3d", "properties"),
        },
        {
          label: "粒子",
          detail: "发射器、循环、闪烁系统",
          icon: Zap,
          run: () => addLayer("particle", "properties"),
        },
      ],
    },
    {
      title: "动画",
      actions: [
        {
          label: "预设",
          detail: "入场、强调、出场、循环",
          icon: Diamond,
          run: () => openRight("presets"),
        },
        {
          label: "图表",
          detail: "曲线、缓动、表达式",
          icon: LineChart,
          run: () => openRight("graph"),
        },
        {
          label: "效果",
          detail: "堆叠特效与着色器通道",
          icon: Wand2,
          run: () => openRight("effects"),
        },
        {
          label: "蒙版",
          detail: "轨道蒙版与透明度控制",
          icon: Scissors,
          run: () => openRight("masks"),
        },
      ],
    },
    {
      title: "完成",
      actions: [
        {
          label: "同步",
          detail: "音频、节拍、文字时序",
          icon: Waves,
          run: () => openRight("sync"),
        },
        {
          label: "跟踪",
          detail: "将运动绑定到主体或对象",
          icon: Radar,
          run: () => openRight("tracker"),
        },
        {
          label: "变量",
          detail: "模板控制与覆盖",
          icon: GitBranch,
          run: () => openRight("variables"),
        },
        {
          label: "队列",
          detail: "MP4, alpha, ProRes deliverables",
          icon: PackageCheck,
          run: () => openRight("queue"),
        },
      ],
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="开始" icon={ImagePlus} />
      <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
        {workflowSections.map((section) => (
          <section key={section.title} className="space-y-2">
            <div className="flex items-center justify-between">
              <ToolcraftText
                as="h2"
                type="label"
                color="primary"
                weight="semibold"
                className="text-[12px]"
              >
                {section.title}
              </ToolcraftText>
              <span className="h-px flex-1 bg-border ml-2" aria-hidden />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {section.actions.map((action) => {
                const Icon = action.icon;
                return (
                  <ToolcraftClickableCard
                    key={action.label}
                    label={action.label}
                    onClick={action.run}
                    variant="muted"
                    padding={2}
                    className="min-h-[78px]"
                  >
                    <ToolcraftText
                      as="span"
                      type="label"
                      color="primary"
                      weight="semibold"
                      className="mb-1.5 flex items-center gap-1.5"
                    >
                      <Icon size={13} aria-hidden />
                      {action.label}
                    </ToolcraftText>
                    <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                      {action.detail}
                    </ToolcraftText>
                  </ToolcraftClickableCard>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
