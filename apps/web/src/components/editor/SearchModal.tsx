import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  Search,
  X,
  Video,
  Music2,
  Type,
  Palette,
  Wand2,
  Layers,
  Zap,
  Square,
  Move,
  Focus,
  Clock,
  Eye,
  Sliders,
} from "@/icons/lucide-compat";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftEmptyState as EmptyState } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftKbd as Kbd } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useUIStore } from "../../stores/ui-store";
import { useProjectStore } from "../../stores/project-store";

interface SearchItem {
  id: string;
  name: string;
  category: string;
  keywords: string[];
  icon: React.ElementType;
  description: string;
  sectionId: string;
  clipTypes: Array<"video" | "audio" | "text" | "shape" | "image">;
}

const SEARCHABLE_EFFECTS: SearchItem[] = [
  {
    id: "transform",
    name: "变换",
    category: "Position & Size",
    keywords: ["position", "scale", "rotate", "move", "resize", "transform"],
    icon: Move,
    description: "调整片段的位置、缩放和旋转",
    sectionId: "transform",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "crop",
    name: "裁剪",
    category: "Position & Size",
    keywords: ["crop", "cut", "trim", "frame", "aspect"],
    icon: Focus,
    description: "裁剪并构图片段",
    sectionId: "crop",
    clipTypes: ["video", "image"],
  },
  {
    id: "speed",
    name: "速度控制",
    category: "Time",
    keywords: ["speed", "slow", "fast", "time", "duration", "playback"],
    icon: Clock,
    description: "控制播放速度与时间重映射",
    sectionId: "speed",
    clipTypes: ["video", "audio"],
  },
  {
    id: "video-effects",
    name: "视觉效果",
    category: "Video",
    keywords: [
      "brightness",
      "contrast",
      "saturation",
      "blur",
      "sharpen",
      "vignette",
      "effects",
    ],
    icon: Sliders,
    description: "颜色、模糊、创意、着色器与风格化效果",
    sectionId: "video-effects",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "color-grading",
    name: "色彩调整",
    category: "Video",
    keywords: [
      "color",
      "grade",
      "wheels",
      "curves",
      "lut",
      "hsl",
      "exposure",
      "temperature",
    ],
    icon: Palette,
    description: "色彩轮、曲线、LUT 与 HSL 调整",
    sectionId: "color-grading",
    clipTypes: ["video", "image"],
  },
  {
    id: "green-screen",
    name: "绿幕抠像",
    category: "Video",
    keywords: ["green", "screen", "chroma", "key", "background", "remove"],
    icon: Eye,
    description: "用于绿幕/蓝幕抠像的色键",
    sectionId: "green-screen",
    clipTypes: ["video", "image"],
  },
  {
    id: "background-removal",
    name: "背景移除",
    category: "Video",
    keywords: ["background", "remove", "ai", "mask", "cutout", "person"],
    icon: Wand2,
    description: "AI 驱动的背景移除",
    sectionId: "background-removal",
    clipTypes: ["video", "image"],
  },
  {
    id: "masking",
    name: "遮罩",
    category: "Video",
    keywords: ["mask", "shape", "feather", "reveal", "hide", "vignette"],
    icon: Layers,
    description: "形状遮罩，显示或隐藏区域",
    sectionId: "masking",
    clipTypes: ["video", "image"],
  },
  {
    id: "motion-tracking",
    name: "运动跟踪",
    category: "Video",
    keywords: ["motion", "track", "follow", "pin", "stabilize"],
    icon: Move,
    description: "跟踪运动并附着元素",
    sectionId: "motion-tracking",
    clipTypes: ["video"],
  },
  {
    id: "pip",
    name: "画中画",
    category: "Video",
    keywords: ["pip", "picture", "overlay", "corner", "position"],
    icon: Square,
    description: "以画中画形式叠加片段",
    sectionId: "pip",
    clipTypes: ["video", "image"],
  },
  {
    id: "blending",
    name: "混合模式",
    category: "Video",
    keywords: ["blend", "mode", "multiply", "screen", "overlay", "opacity"],
    icon: Layers,
    description: "混合模式与不透明度控制",
    sectionId: "blending",
    clipTypes: ["video", "image"],
  },
  {
    id: "transform-3d",
    name: "3D 变换",
    category: "Video",
    keywords: ["3d", "perspective", "rotate", "flip", "tilt"],
    icon: Move,
    description: "3D 旋转与透视效果",
    sectionId: "transform-3d",
    clipTypes: ["video", "image"],
  },
  {
    id: "keyframes",
    name: "关键帧",
    category: "Animation",
    keywords: ["keyframe", "animate", "animation", "ease", "interpolate"],
    icon: Zap,
    description: "让属性随时间变化",
    sectionId: "keyframes",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "transitions",
    name: "转场",
    category: "Animation",
    keywords: ["transition", "fade", "dissolve", "wipe", "slide"],
    icon: Zap,
    description: "片段之间的转场",
    sectionId: "transitions",
    clipTypes: ["video", "image"],
  },
  {
    id: "motion-presets",
    name: "运动预设",
    category: "Animation",
    keywords: ["motion", "preset", "zoom", "pan", "shake", "bounce"],
    icon: Zap,
    description: "预置的动态动画",
    sectionId: "motion-presets",
    clipTypes: ["video", "image"],
  },
  {
    id: "audio-effects",
    name: "音频效果",
    category: "Audio",
    keywords: [
      "audio",
      "eq",
      "equalizer",
      "compressor",
      "reverb",
      "delay",
      "sound",
    ],
    icon: Music2,
    description: "EQ、压缩器、混响等",
    sectionId: "audio-effects",
    clipTypes: ["audio", "video"],
  },
  {
    id: "audio-ducking",
    name: "音频闪避",
    category: "Audio",
    keywords: ["duck", "ducking", "voice", "music", "fade", "auto"],
    icon: Music2,
    description: "人声出现时自动压低音乐",
    sectionId: "audio-ducking",
    clipTypes: ["audio", "video"],
  },
  {
    id: "text-properties",
    name: "文字属性",
    category: "Text",
    keywords: ["text", "font", "size", "color", "style", "typography"],
    icon: Type,
    description: "字体、字号、颜色与文字样式",
    sectionId: "text-properties",
    clipTypes: ["text"],
  },
  {
    id: "text-material",
    name: "文字材质与着色器",
    category: "Text",
    keywords: ["text", "material", "shader", "paper", "glsl", "gradient", "dissolve"],
    icon: Wand2,
    description: "浏览文字的实时着色器与 Paper 材质预览",
    sectionId: "text-properties",
    clipTypes: ["text"],
  },
  {
    id: "text-animation",
    name: "文字动画",
    category: "Text",
    keywords: ["text", "animate", "typewriter", "fade", "slide", "bounce"],
    icon: Type,
    description: "使用预设为文字添加动画",
    sectionId: "text-animation",
    clipTypes: ["text"],
  },
  {
    id: "shape-properties",
    name: "形状属性",
    category: "Shapes",
    keywords: ["shape", "fill", "stroke", "corner", "radius", "shadow"],
    icon: Square,
    description: "形状填充、描边与效果",
    sectionId: "shape-properties",
    clipTypes: ["shape"],
  },
  {
    id: "shape-shader-fill",
    name: "形状着色器填充",
    category: "Shapes",
    keywords: ["shape", "fill", "shader", "paper", "material", "gradient"],
    icon: Wand2,
    description: "为所选形状应用实时着色器材质",
    sectionId: "shape-properties",
    clipTypes: ["shape"],
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  "Position & Size": "位置与尺寸",
  Time: "时间",
  Video: "视频",
  Audio: "音频",
  Text: "文字",
  Animation: "动画",
  Shapes: "形状",
};

const CLIP_TYPE_LABELS: Record<string, string> = {
  video: "视频",
  audio: "音频",
  text: "文字",
  shape: "形状",
  image: "图片",
};

const CATEGORIES = [
  { id: "all", name: "全部" },
  { id: "video", name: "视频", icon: Video },
  { id: "audio", name: "音频", icon: Music2 },
  { id: "text", name: "文字", icon: Type },
  { id: "animation", name: "动画", icon: Zap },
];

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { selectedItems, setPanelVisible } = useUIStore();
  const project = useProjectStore((state) => state.project);

  const selectedClipType = useMemo(() => {
    const clipItem = selectedItems.find(
      (item) =>
        item.type === "clip" ||
        item.type === "text-clip" ||
        item.type === "shape-clip",
    );
    if (!clipItem) return null;
    if (clipItem.type === "text-clip") return "text";
    if (clipItem.type === "shape-clip") return "shape";
    const track = project.timeline.tracks.find((candidate) =>
      candidate.clips.some((clip) => clip.id === clipItem.id),
    );
    if (track?.type === "audio") return "audio";
    const clip = track?.clips.find((candidate) => candidate.id === clipItem.id);
    const media = clip
      ? project.mediaLibrary.items.find((item) => item.id === clip.mediaId)
      : undefined;
    if (track?.type === "image" || media?.type === "image") return "image";
    return "video";
  }, [project.mediaLibrary.items, project.timeline.tracks, selectedItems]);

  const filteredEffects = useMemo(() => {
    let effects = SEARCHABLE_EFFECTS;

    if (selectedClipType) {
      effects = effects.filter((e) =>
        e.clipTypes.includes(
          selectedClipType as "video" | "audio" | "text" | "shape" | "image",
        ),
      );
    }

    if (selectedCategory !== "all") {
      effects = effects.filter((e) =>
        e.category.toLowerCase().includes(selectedCategory.toLowerCase()),
      );
    }

    if (query.trim()) {
      const searchTerms = query.toLowerCase().split(" ");
      effects = effects.filter((e) => {
        const searchText = [
          e.name,
          e.description,
          ...e.keywords,
          e.category,
          CATEGORY_LABELS[e.category] ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return searchTerms.every((term) => searchText.includes(term));
      });
    }

    return effects;
  }, [query, selectedCategory, selectedClipType]);

  const handleSelect = useCallback(
    (effect: SearchItem) => {
      setPanelVisible("inspector", true);

      setTimeout(() => {
        const sectionElement = document.querySelector(
          `[data-section-id="${effect.sectionId}"]`,
        );
        if (sectionElement) {
          sectionElement.scrollIntoView({ behavior: "smooth", block: "start" });

          const header = sectionElement.querySelector<HTMLElement>(
            '[data-slot="toolcraft-panel-section-header"]',
          );
          if (header?.getAttribute("aria-expanded") === "false") {
            header.click();
          }

          sectionElement.classList.add(
            "ring-2",
            "ring-primary",
            "ring-offset-2",
          );
          setTimeout(() => {
            sectionElement.classList.remove(
              "ring-2",
              "ring-primary",
              "ring-offset-2",
            );
          }, 2000);
        }
      }, 100);

      onClose();
    },
    [onClose, setPanelVisible],
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedCategory]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, filteredEffects.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && filteredEffects[selectedIndex]) {
        e.preventDefault();
        handleSelect(filteredEffects[selectedIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, filteredEffects, selectedIndex, handleSelect]);

  useEffect(() => {
    if (listRef.current && filteredEffects[selectedIndex]) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [selectedIndex, filteredEffects]);

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      width={672}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title="搜索效果"
            subtitle={
              selectedClipType
                ? `查找所选${CLIP_TYPE_LABELS[selectedClipType] ?? selectedClipType}片段可用的工具。`
                : "在检查器中查找效果和工具。"
            }
            onOpenChange={(open) => !open && onClose()}
            startContent={<Search size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ToolcraftTextInputControl
                    ref={inputRef}
                    label="搜索效果"
                    isLabelHidden
                    type="text"
                    value={query}
                    onChange={setQuery}
                    placeholder={
                      selectedClipType
                        ? `搜索${CLIP_TYPE_LABELS[selectedClipType] ?? selectedClipType}片段的效果…`
                        : "搜索所有效果和工具…"
                    }
                    startIcon={<Search size={16} aria-hidden />}
                    width="100%"
                    hasAutoFocus
                  />
                </div>
                {query && (
                  <IconButton
                    label="清除搜索"
                    onClick={() => setQuery("")}
                    variant="ghost"
                    size="sm"
                    icon={<X size={14} aria-hidden />}
                  />
                )}
                <Kbd keys="escape" />
              </div>

              <ToolcraftSegmentedControl
                ariaLabel="效果分类"
                value={selectedCategory}
                onChange={setSelectedCategory}
                options={CATEGORIES.map((cat) => {
                  const CategoryIcon = cat.icon;
                  return {
                    value: cat.id,
                    label: cat.name,
                    icon: CategoryIcon ? (
                      <CategoryIcon size={14} aria-hidden />
                    ) : undefined,
                  };
                })}
              />

              <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
                {filteredEffects.length === 0 ? (
                  <EmptyState
                    title="未找到效果"
                    description="试试其他搜索词或分类。"
                    icon={<Search size={32} className="text-text-muted opacity-50" aria-hidden />}
                    isCompact
                  />
                ) : (
                  <div className="space-y-2 py-1">
                    {filteredEffects.map((effect, index) => {
                      const Icon = effect.icon;
                      const selected = index === selectedIndex;
                      return (
                        <ClickableCard
                          key={effect.id}
                          label={`打开 ${effect.name}`}
                          onClick={() => handleSelect(effect)}
                          padding={3}
                          variant={selected ? "green" : "default"}
                          className={`border ${
                            selected ? "border-primary" : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-4 text-left">
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                selected
                                  ? "bg-primary text-white"
                                  : "bg-background-tertiary text-text-secondary"
                              }`}
                            >
                              <Icon size={16} aria-hidden />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Text
                                  type="label"
                                  weight="bold"
                                  color={selected ? "active" : "primary"}
                                  maxLines={1}
                                >
                                  {effect.name}
                                </Text>
                                <Card variant="muted" padding={1} className="shrink-0">
                                  <Text
                                    type="supporting"
                                    color="secondary"
                                    className="text-[10px]"
                                  >
                                    {CATEGORY_LABELS[effect.category] ?? effect.category}
                                  </Text>
                                </Card>
                              </div>
                              <Text
                                type="supporting"
                                color="secondary"
                                display="block"
                                maxLines={1}
                                className="mt-0.5"
                              >
                                {effect.description}
                              </Text>
                            </div>
                            <Kbd keys="enter" />
                          </div>
                        </ClickableCard>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex items-center justify-between gap-3">
              <Text type="supporting" color="secondary" className="text-[10px]">
                共 {filteredEffects.length} 个效果可用
              </Text>
              <div className="flex items-center gap-2">
                <Kbd keys="up" />
                <Kbd keys="down" />
                <Text type="supporting" color="secondary" className="text-[10px]">
                  浏览
                </Text>
                <Kbd keys="enter" />
                <Text type="supporting" color="secondary" className="text-[10px]">
                  选择
                </Text>
              </div>
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};

export default SearchModal;
