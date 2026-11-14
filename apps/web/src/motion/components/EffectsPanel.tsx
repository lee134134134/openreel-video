import { useState, type JSX } from "react";
import {
  Aperture,
  ArrowDown,
  ArrowUp,
  Diamond,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Layers,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
} from "@/icons/lucide-compat";
import {
  MOTION_EFFECT_PRESETS,
  addMotionLayerEffect,
  createMotionEffect,
  createMotionShaderEffect,
  duplicateMotionLayerEffect,
  findMotionLayerKeyframeAtTime,
  getMotionEffectKeyframeProperty,
  getMotionEffectParameterDescriptor,
  getMotionEffectParameterDescriptors,
  getMotionEffectParameterValueAtTime,
  getMotionShaderDef,
  getMotionShaderEffectDefs,
  isMotionExpressionControlEffect,
  nextMotionControlName,
  removeMotionLayerEffect,
  clearMotionEffectStack,
  removeMotionLayerKeyframe,
  reorderMotionLayerEffect,
  setMotionEffectParameterValue,
  toggleMotionLayerEffect,
  transferMotionEffectStack,
  updateMotionLayerEffect,
  upsertMotionLayerKeyframe,
  type MotionComposition,
  type MotionEffect,
  type MotionEffectParameterName,
  type MotionEffectType,
  type MotionLayer,
  type MotionShaderParamDef,
} from "@openreel/core";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import { GenerateShaderBox } from "./GenerateShaderBox";
import { ShaderPreviewBrowser } from "../../components/shaders/ShaderPreviewBrowser";
import { MotionEffectPreview } from "./MotionEffectPreview";
import {
  Button,
  ColorInput,
  EmptyState,
  Field,
  IconButton,
  NumberInput,
  PanelHeader,
  Section,
  Slider,
  SwitchInput,
} from "./primitives";

interface EffectsPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

let effectStackClipboard: Pick<MotionLayer, "effects" | "keyframes" | "expressions"> | null = null;

type MotionEffectCategory = "all" | "color" | "blur" | "stylize" | "distort";

const EFFECT_CATEGORIES: readonly { id: MotionEffectCategory; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "color", label: "颜色" },
  { id: "blur", label: "模糊" },
  { id: "stylize", label: "风格化" },
  { id: "distort", label: "扭曲" },
];

const EFFECT_CATEGORY_BY_TYPE: Partial<Record<MotionEffectType, Exclude<MotionEffectCategory, "all">>> = {
  "color-adjust": "color", invert: "color", grayscale: "color", sepia: "color",
  levels: "color", threshold: "color", vignette: "color",
  blur: "blur", "directional-blur": "blur", "radial-blur": "blur",
  "backdrop-blur": "blur", sharpen: "blur",
  "drop-shadow": "stylize", glow: "stylize", posterize: "stylize", noise: "stylize",
  mosaic: "stylize", "chromatic-aberration": "stylize",
  displace: "distort",
};

const EXPRESSION_CONTROL_TYPES: readonly MotionEffectType[] = [
  "slider-control",
  "checkbox-control",
  "angle-control",
];

function isExpressionControlPreset(type: MotionEffectType): boolean {
  return EXPRESSION_CONTROL_TYPES.includes(type);
}

interface MotionEffectBrowserPreset {
  readonly id: string;
  readonly type: MotionEffectType;
  readonly name: string;
  readonly description: string;
  readonly create: (id?: string) => MotionEffect;
}

function createEffectVariant(
  type: MotionEffectType,
  name: string,
  overrides: Record<string, unknown>,
  id?: string,
): MotionEffect {
  return { ...createMotionEffect(type, id), ...overrides, name } as MotionEffect;
}

export const MOTION_EFFECT_VARIANTS: readonly MotionEffectBrowserPreset[] = [
  {
    id: "dream-blur",
    type: "blur",
    name: "梦幻模糊",
    description: "柔和扩散，适合梦幻标题与肖像处理。",
    create: (id) => createEffectVariant("blur", "梦幻模糊", { radius: 32 }, id),
  },
  {
    id: "neon-glow",
    type: "glow",
    name: "霓虹辉光",
    description: "热烈的品红色光晕，适合标志、文字与 UI 点缀。",
    create: (id) =>
      createEffectVariant(
        "glow",
        "霓虹辉光",
        { color: "#ec4899", intensity: 0.9, radius: 64 },
        id,
      ),
  },
  {
    id: "long-shadow",
    type: "drop-shadow",
    name: "长阴影",
    description: "图形化的偏移阴影，适合大胆的动态设计版式。",
    create: (id) =>
      createEffectVariant(
        "drop-shadow",
        "长阴影",
        { color: "#111827", opacity: 0.6, blur: 4, offsetX: 28, offsetY: 28 },
        id,
      ),
  },
  {
    id: "film-grain",
    type: "noise",
    name: "胶片颗粒",
    description: "细腻的有机颗粒，营造电影质感与统一性。",
    create: (id) =>
      createEffectVariant("noise", "胶片颗粒", { amount: 0.08, seed: 37 }, id),
  },
  {
    id: "crt-split",
    type: "chromatic-aberration",
    name: "CRT 分离",
    description: "强烈的水平 RGB 分离，营造复古屏幕效果。",
    create: (id) =>
      createEffectVariant(
        "chromatic-aberration",
        "CRT 分离",
        { amount: 14, angle: 0 },
        id,
      ),
  },
  {
    id: "punchy-contrast",
    type: "color-adjust",
    name: "强烈对比",
    description: "利落的对比度与饱和度，适合高冲击力图形。",
    create: (id) =>
      createEffectVariant(
        "color-adjust",
        "强烈对比",
        { brightness: 1, contrast: 1.35, saturation: 1.2, hue: 0 },
        id,
      ),
  },
  {
    id: "cinematic-fade",
    type: "levels",
    name: "电影褪色",
    description: "提亮黑场、柔化白场，获得电影感的色调衰减。",
    create: (id) =>
      createEffectVariant(
        "levels",
        "电影褪色",
        {
          inputBlack: 0,
          inputWhite: 1,
          gamma: 1.08,
          outputBlack: 0.08,
          outputWhite: 0.94,
        },
        id,
      ),
  },
  {
    id: "comic-poster",
    type: "posterize",
    name: "漫画海报",
    description: "减少色阶分层，适合图形插画与标题卡。",
    create: (id) =>
      createEffectVariant("posterize", "漫画海报", { levels: 5 }, id),
  },
  {
    id: "speed-streak",
    type: "directional-blur",
    name: "速度拖影",
    description: "快速水平拖影，适合充满活力的入场与出场。",
    create: (id) =>
      createEffectVariant(
        "directional-blur",
        "速度拖影",
        { angle: 0, distance: 34 },
        id,
      ),
  },
  {
    id: "zoom-burst",
    type: "radial-blur",
    name: "缩放爆发",
    description: "居中的放射冲刺，适合冲击帧与转场。",
    create: (id) =>
      createEffectVariant(
        "radial-blur",
        "缩放爆发",
        { centerX: 0.5, centerY: 0.5, amount: 32 },
        id,
      ),
  },
  {
    id: "analog-warp",
    type: "displace",
    name: "模拟扭曲",
    description: "有机的湍流变形，适合磁带与液态效果。",
    create: (id) =>
      createEffectVariant(
        "displace",
        "模拟扭曲",
        { amount: 18, scale: 42, seed: 73 },
        id,
      ),
  },
  {
    id: "ink-cutout",
    type: "threshold",
    name: "墨迹剪影",
    description: "硬朗的黑白分离，适合印刷风格图形。",
    create: (id) =>
      createEffectVariant("threshold", "墨迹剪影", { level: 0.56 }, id),
  },
  {
    id: "pixel-art",
    type: "mosaic",
    name: "像素艺术",
    description: "粗大的像素块，适合复古游戏与马赛克揭示。",
    create: (id) =>
      createEffectVariant("mosaic", "像素艺术", { blockSize: 18 }, id),
  },
  {
    id: "soft-focus",
    type: "vignette",
    name: "柔和聚焦",
    description: "柔和的边缘衰减，将注意力引向主体。",
    create: (id) =>
      createEffectVariant(
        "vignette",
        "柔和聚焦",
        { amount: 0.52, softness: 0.78 },
        id,
      ),
  },
];

const EFFECT_BROWSER_PRESETS: readonly MotionEffectBrowserPreset[] = [
  ...MOTION_EFFECT_PRESETS.filter(
    (preset) => !isExpressionControlPreset(preset.type),
  ).map((preset) => ({ ...preset, id: `default-${preset.type}` })),
  ...MOTION_EFFECT_VARIANTS,
];

const EFFECT_ICON: Record<MotionEffectType, typeof Sparkles> = {
  blur: Layers,
  "drop-shadow": Sparkles,
  glow: Wand2,
  "color-adjust": Sparkles,
  invert: Wand2,
  grayscale: Layers,
  sepia: Sparkles,
  levels: SlidersHorizontal,
  sharpen: Wand2,
  posterize: Layers,
  "directional-blur": Layers,
  noise: Sparkles,
  "radial-blur": Layers,
  displace: Wand2,
  threshold: SlidersHorizontal,
  mosaic: Layers,
  "chromatic-aberration": Aperture,
  vignette: Aperture,
  "backdrop-blur": Aperture,
  shader: Wand2,
  "slider-control": SlidersHorizontal,
  "checkbox-control": SlidersHorizontal,
  "angle-control": SlidersHorizontal,
};

export function EffectsPanel({ composition, embedded = false }: EffectsPanelProps): JSX.Element | null {
  const [effectSearch, setEffectSearch] = useState("");
  const [effectCategory, setEffectCategory] = useState<MotionEffectCategory>("all");
  const [hasEffectStackClipboard, setHasEffectStackClipboard] = useState(
    () => effectStackClipboard !== null,
  );
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const playhead = useMotionStore((state) => state.playhead);
  const autoKeyframe = useMotionStore((state) => state.autoKeyframe);
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const effectTargetLayerIds = selectedLayerId
    ? Array.from(new Set([selectedLayerId, ...selectedLayerIds])).filter((id) =>
        composition.layers.some((layer) => layer.id === id),
      )
    : [];
  const upsertMotionComposition = useProjectStore(
    (state) => state.upsertMotionComposition,
  );

  const replaceLayer = (nextLayer: MotionLayer) => {
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        layer.id === nextLayer.id ? nextLayer : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const addEffectToSelection = (createEffect: () => MotionEffect) => {
    if (effectTargetLayerIds.length === 0) return;
    const targetIds = new Set(effectTargetLayerIds);
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        targetIds.has(layer.id)
          ? addMotionLayerEffect(layer, createEffect())
          : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const addEffectPreset = (preset: MotionEffectBrowserPreset) => {
    addEffectToSelection(() => preset.create());
  };

  const addControl = (type: MotionEffectType, baseName: string) => {
    if (!selectedLayerId) return;
    const currentComposition =
      useProjectStore
        .getState()
        .project.motionCompositions?.find(
          (candidate) => candidate.id === composition.id,
        ) ?? composition;
    const currentLayer = currentComposition.layers.find(
      (layer) => layer.id === selectedLayerId,
    );
    if (!currentLayer) return;
    const effect = createMotionEffect(type);
    const appended = addMotionLayerEffect(currentLayer, effect);
    const named = updateMotionLayerEffect(appended, effect.id, (current) => ({
      ...current,
      name: nextMotionControlName(
        (appended.effects ?? []).filter((item) => item.id !== effect.id),
        baseName,
      ),
    }));
    void upsertMotionComposition({
      ...currentComposition,
      layers: currentComposition.layers.map((layer) =>
        layer.id === named.id ? named : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const addShaderEffect = (shaderId: string) => {
    addEffectToSelection(() => createMotionShaderEffect(shaderId));
  };

  const updateEffect = (
    effectId: string,
    updater: (effect: MotionEffect) => MotionEffect,
  ) => {
    if (!selectedLayer) return;
    replaceLayer(updateMotionLayerEffect(selectedLayer, effectId, updater));
  };

  const copyEffectStack = () => {
    if (!selectedLayer || (selectedLayer.effects ?? []).length === 0) return;
    const effectIds = new Set((selectedLayer.effects ?? []).map((effect) => effect.id));
    const belongsToStack = (property: string) => {
      const match = /^effect\.([^.]+)\./.exec(property);
      return match ? effectIds.has(match[1]) : false;
    };
    effectStackClipboard = {
      effects: (selectedLayer.effects ?? []).map((effect) =>
        effect.type === "shader"
          ? { ...effect, params: { ...effect.params } }
          : { ...effect },
      ),
      keyframes: selectedLayer.keyframes
        .filter((keyframe) => belongsToStack(keyframe.property))
        .map((keyframe) => ({ ...keyframe })),
      expressions: (selectedLayer.expressions ?? [])
        .filter((expression) => belongsToStack(expression.property))
        .map((expression) => ({ ...expression })),
    };
    setHasEffectStackClipboard(true);
  };

  const pasteEffectStack = (mode: "append" | "replace") => {
    if (!effectStackClipboard || effectTargetLayerIds.length === 0) return;
    const targetIds = new Set(effectTargetLayerIds);
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        targetIds.has(layer.id)
          ? transferMotionEffectStack(effectStackClipboard!, layer, mode).layer
          : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const clearEffectStacks = () => {
    if (effectTargetLayerIds.length === 0) return;
    const targetIds = new Set(effectTargetLayerIds);
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        targetIds.has(layer.id) ? clearMotionEffectStack(layer) : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  if (!selectedLayer) {
    if (embedded) return null;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader title="效果" icon={Sparkles} />
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Sparkles}
            title="选择一个图层"
            description="图层效果可以叠加、调整顺序，并渲染到编辑器预览与导出中。"
          />
        </div>
      </div>
    );
  }

  const effects = selectedLayer.effects ?? [];
  const normalizedEffectSearch = effectSearch.trim().toLowerCase();
  const visibleEffectPresets = EFFECT_BROWSER_PRESETS.filter((preset) => {
    if (
      effectCategory !== "all" &&
      EFFECT_CATEGORY_BY_TYPE[preset.type] !== effectCategory
    ) return false;
    return (
      normalizedEffectSearch.length === 0 ||
      preset.name.toLowerCase().includes(normalizedEffectSearch) ||
      preset.description.toLowerCase().includes(normalizedEffectSearch) ||
      preset.type.includes(normalizedEffectSearch)
    );
  });
  const localPlayhead = Math.min(
    selectedLayer.duration,
    Math.max(0, playhead - selectedLayer.startTime),
  );

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : <PanelHeader title="效果" icon={Sparkles} />}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title="添加效果" icon={Plus}>
          <div className="mb-2.5 space-y-2">
            {effectTargetLayerIds.length > 1 ? (
              <div className="rounded-md border border-accent/25 bg-accent-soft px-2.5 py-2">
                <ToolcraftText type="supporting" color="secondary">
                  新效果将添加到选中的 {effectTargetLayerIds.length}{" "}
                  个图层。
                </ToolcraftText>
              </div>
            ) : null}
            <label className="relative block">
              <span className="sr-only">搜索标准效果</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" size={13} />
              <input
                type="search"
                value={effectSearch}
                onChange={(event) => setEffectSearch(event.target.value)}
                placeholder="搜索效果"
                className="h-8 w-full rounded-md border border-border bg-bg-2 pl-8 pr-2.5 text-[11px] text-fg outline-none placeholder:text-fg-muted focus:border-accent"
              />
            </label>
            <div className="flex flex-wrap gap-1" role="group" aria-label="特效分类">
              {EFFECT_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={effectCategory === category.id}
                  onClick={() => setEffectCategory(category.id)}
                  className={`h-6 rounded-md border px-2 text-[10px] font-medium transition-colors ${
                    effectCategory === category.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-bg-2 text-fg-3 hover:border-accent hover:text-accent"
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>
          {visibleEffectPresets.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-bg-2 px-3 py-4 text-center text-[11px] text-fg-muted">
              没有匹配“{effectSearch.trim()}”的标准效果。
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-2">
            {visibleEffectPresets.map((preset) => {
              const Icon = EFFECT_ICON[preset.type];
              const previewEffect = preset.create(`preview-${preset.id}`);
              return (
                <ToolcraftClickableCard
                  key={preset.id}
                  label={`添加${preset.name}`}
                  onClick={() => addEffectPreset(preset)}
                  variant="muted"
                  padding={2}
                  className="min-h-[146px]"
                >
                  <MotionEffectPreview effect={previewEffect} />
                  <ToolcraftText
                    as="span"
                    type="label"
                    color="primary"
                    weight="semibold"
                    className="mb-1.5 flex items-center gap-1.5"
                  >
                    <Icon size={13} />
                    {preset.name}
                  </ToolcraftText>
                  <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                    {preset.description}
                  </ToolcraftText>
                </ToolcraftClickableCard>
              );
            })}
          </div>
          )}
        </Section>

        <Section title="着色器" icon={Wand2}>
          <ShaderPreviewBrowser
            defs={getMotionShaderEffectDefs()}
            onSelect={addShaderEffect}
            sample="effect"
            label="特效预览"
          />
          <div className="mt-2">
            <GenerateShaderBox
              category="effect"
              onGenerated={(def) => addShaderEffect(def.id)}
            />
          </div>
        </Section>

        <Section title="表达式控制" icon={SlidersHorizontal}>
          <div className="grid grid-cols-3 gap-2">
            {MOTION_EFFECT_PRESETS.filter((preset) =>
              isExpressionControlPreset(preset.type),
            ).map((preset) => {
              const Icon = EFFECT_ICON[preset.type];
              return (
                <ToolcraftClickableCard
                  key={preset.type}
                  label={`添加${preset.name}`}
                  onClick={() => addControl(preset.type, preset.name)}
                  variant="muted"
                  padding={2}
                  className="min-h-[68px]"
                >
                  <ToolcraftText
                    as="span"
                    type="label"
                    color="primary"
                    weight="semibold"
                    className="mb-1.5 flex items-center gap-1.5"
                  >
                    <Icon size={13} />
                    {preset.name}
                  </ToolcraftText>
                  <ToolcraftText type="supporting" color="secondary" maxLines={2}>
                    {preset.description}
                  </ToolcraftText>
                </ToolcraftClickableCard>
              );
            })}
          </div>
        </Section>

        <Section title={`效果堆栈（${effects.length}）`} icon={Sparkles}>
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            <Button
              label="复制堆栈"
              icon={Copy}
              variant="outline"
              size="sm"
              disabled={effects.length === 0}
              onClick={copyEffectStack}
            />
            <Button
              label="粘贴追加"
              icon={ClipboardPaste}
              variant="outline"
              size="sm"
              disabled={!hasEffectStackClipboard}
              onClick={() => pasteEffectStack("append")}
            />
            <Button
              label="粘贴替换"
              variant="outline"
              size="sm"
              disabled={!hasEffectStackClipboard}
              onClick={() => pasteEffectStack("replace")}
            />
            <Button
              label="清空堆栈"
              variant="outline"
              size="sm"
              disabled={
                !composition.layers.some(
                  (layer) =>
                    effectTargetLayerIds.includes(layer.id) &&
                    (layer.effects ?? []).length > 0,
                )
              }
              onClick={clearEffectStacks}
            />
          </div>
          {effects.length === 0 ? (
            <ToolcraftText type="supporting" color="secondary" className="rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
              添加模糊、辉光、阴影或颜色调整效果，为该图层构建可复用的动态外观。
            </ToolcraftText>
          ) : (
            <div className="space-y-2">
              {effects.map((effect, index) => (
                <EffectCard
                  key={effect.id}
                  effect={effect}
                  isFirst={index === 0}
                  isLast={index === effects.length - 1}
                  onToggle={(enabled) =>
                    replaceLayer(
                      toggleMotionLayerEffect(selectedLayer, effect.id, enabled),
                    )
                  }
                  onMove={(direction) =>
                    replaceLayer(
                      reorderMotionLayerEffect(selectedLayer, effect.id, direction),
                    )
                  }
                  onRemove={() =>
                    replaceLayer(removeMotionLayerEffect(selectedLayer, effect.id))
                  }
                  onDuplicate={() =>
                    replaceLayer(
                      duplicateMotionLayerEffect(selectedLayer, effect.id).layer,
                    )
                  }
                  onUpdate={(updater) => updateEffect(effect.id, updater)}
                  layer={selectedLayer}
                  localTime={localPlayhead}
                  autoKeyframe={autoKeyframe}
                  replaceLayer={replaceLayer}
                  setSelectedProperty={setSelectedProperty}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function EffectCard({
  effect,
  isFirst,
  isLast,
  layer,
  localTime,
  autoKeyframe,
  onToggle,
  onMove,
  onRemove,
  onDuplicate,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  isFirst: boolean;
  isLast: boolean;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  onToggle: (enabled: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const Icon = EFFECT_ICON[effect.type];
  return (
    <div className={`rounded-lg border border-border bg-bg-2 ${effect.enabled ? "" : "opacity-55"}`}>
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-1 text-fg-3">
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-fg-2">
            {effect.name}
          </span>
          <span className="block text-[10.5px] capitalize text-fg-muted">
            {effect.type.replace("-", " ")}
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={ArrowUp}
            label="上移效果"
            size="sm"
            disabled={isFirst}
            onClick={() => onMove(-1)}
          />
          <IconButton
            icon={ArrowDown}
            label="下移效果"
            size="sm"
            disabled={isLast}
            onClick={() => onMove(1)}
          />
          <IconButton
            icon={effect.enabled ? Eye : EyeOff}
            label={effect.enabled ? "禁用效果" : "启用效果"}
            size="sm"
            active={effect.enabled}
            onClick={() => onToggle(!effect.enabled)}
          />
          <IconButton
            icon={Copy}
            label="复制效果"
            size="sm"
            onClick={onDuplicate}
          />
          <IconButton
            icon={Trash2}
            label="移除效果"
            size="sm"
            variant="danger"
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="space-y-3 p-3">
        <EffectControls
          effect={effect}
          layer={layer}
          localTime={localTime}
          autoKeyframe={autoKeyframe}
          onUpdate={onUpdate}
          replaceLayer={replaceLayer}
          setSelectedProperty={setSelectedProperty}
        />
      </div>
    </div>
  );
}

function EffectControls({
  effect,
  layer,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const renderParam = (param: MotionEffectParameterName): JSX.Element => (
    <EffectParameterControl
      key={param}
      effect={effect}
      layer={layer}
      param={param}
      localTime={localTime}
      autoKeyframe={autoKeyframe}
      onUpdate={onUpdate}
      replaceLayer={replaceLayer}
      setSelectedProperty={setSelectedProperty}
    />
  );

  if (effect.type === "blur") {
    return renderParam("radius");
  }

  if (effect.type === "drop-shadow") {
    return (
      <>
        <Field label="颜色">
          <ColorInput
            value={effect.color}
            onChange={(color) =>
              onUpdate((current) =>
                current.type === "drop-shadow" ? { ...current, color } : current,
              )
            }
          />
        </Field>
        {renderParam("opacity")}
        <div className="grid grid-cols-3 gap-2">
          {renderParam("blur")}
          {renderParam("offsetX")}
          {renderParam("offsetY")}
        </div>
      </>
    );
  }

  if (effect.type === "glow") {
    return (
      <>
        <Field label="颜色">
          <ColorInput
            value={effect.color}
            onChange={(color) =>
              onUpdate((current) =>
                current.type === "glow" ? { ...current, color } : current,
              )
            }
          />
        </Field>
        {renderParam("intensity")}
        {renderParam("radius")}
      </>
    );
  }

  if (
    effect.type === "invert" ||
    effect.type === "grayscale" ||
    effect.type === "sepia"
  ) {
    return renderParam("amount");
  }

  if (effect.type === "color-adjust") {
    return (
      <>
        {renderParam("brightness")}
        {renderParam("contrast")}
        {renderParam("saturation")}
        {renderParam("hue")}
      </>
    );
  }

  if (effect.type === "shader") {
    const def = getMotionShaderDef(effect.shaderId);
    if (!def) {
      return (
        <ToolcraftText type="supporting" color="secondary">
          未知着色器。
        </ToolcraftText>
      );
    }
    return (
      <>
        {def.params.map((paramDef) => (
          <ShaderParameterControl
            key={paramDef.name}
            effect={effect}
            layer={layer}
            paramDef={paramDef}
            localTime={localTime}
            autoKeyframe={autoKeyframe}
            onUpdate={onUpdate}
            replaceLayer={replaceLayer}
            setSelectedProperty={setSelectedProperty}
          />
        ))}
      </>
    );
  }

  if (isMotionExpressionControlEffect(effect)) {
    return (
      <ExpressionControlBody
        effect={effect}
        layer={layer}
        localTime={localTime}
        autoKeyframe={autoKeyframe}
        onUpdate={onUpdate}
        replaceLayer={replaceLayer}
        setSelectedProperty={setSelectedProperty}
        renderParam={renderParam}
      />
    );
  }

  return (
    <>
      {getMotionEffectParameterDescriptors(effect).map((descriptor) =>
        renderParam(descriptor.param),
      )}
    </>
  );
}

function ExpressionControlBody({
  effect,
  layer,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
  renderParam,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
  renderParam: (param: MotionEffectParameterName) => JSX.Element;
}): JSX.Element {
  const usageHint = `effect("${effect.name}")("value")`;
  return (
    <>
      <div className="rounded-md border border-border bg-bg-1 px-2.5 py-2">
        <ToolcraftText as="span" type="label" color="primary" weight="semibold" className="block">
          {effect.name}
        </ToolcraftText>
        <ToolcraftText type="supporting" color="secondary" className="mt-0.5 block text-[11px]">
          用法：{" "}
          <span className="font-mono text-fg-2">{usageHint}</span>
        </ToolcraftText>
      </div>
      {effect.type === "checkbox-control" ? (
        <CheckboxControlValue
          effect={effect}
          layer={layer}
          localTime={localTime}
          autoKeyframe={autoKeyframe}
          onUpdate={onUpdate}
          replaceLayer={replaceLayer}
          setSelectedProperty={setSelectedProperty}
        />
      ) : (
        renderParam("value")
      )}
    </>
  );
}

function CheckboxControlValue({
  effect,
  layer,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const descriptor = getMotionEffectParameterDescriptor(effect, "value");
  const property = getMotionEffectKeyframeProperty(effect.id, "value");
  const value = getMotionEffectParameterValueAtTime(
    effect,
    layer.keyframes,
    "value",
    localTime,
    layer.expressions,
    layer.duration,
  );
  const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
    layer,
    property,
    localTime,
  );
  const label = descriptor?.label ?? "复选框";

  const writeValue = (nextValue: number) => {
    setSelectedProperty(property);
    if (autoKeyframe) {
      replaceLayer(
        upsertMotionLayerKeyframe(layer, property, localTime, {
          value: nextValue,
          easing: keyframeAtPlayhead?.easing ?? "ease",
        }),
      );
      return;
    }
    onUpdate((current) =>
      current.id === effect.id
        ? setMotionEffectParameterValue(current, "value", nextValue)
        : current,
    );
  };

  return (
    <SwitchInput
      label={label}
      checked={value >= 0.5}
      onChange={(checked) => writeValue(checked ? 1 : 0)}
    />
  );
}

function EffectParameterControl({
  effect,
  layer,
  param,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  param: MotionEffectParameterName;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const descriptor = getMotionEffectParameterDescriptor(effect, param);
  const property = getMotionEffectKeyframeProperty(effect.id, param);
  const value = getMotionEffectParameterValueAtTime(
    effect,
    layer.keyframes,
    param,
    localTime,
    layer.expressions,
    layer.duration,
  );
  const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
    layer,
    property,
    localTime,
  );
  const label = descriptor?.label ?? param;
  const min = descriptor?.min;
  const max = descriptor?.max;
  const step = descriptor?.step ?? 0.01;
  const usesSlider =
    !descriptor?.unit &&
    typeof min === "number" &&
    typeof max === "number" &&
    min >= 0 &&
    max <= 4;

  const writeValue = (nextValue: number) => {
    setSelectedProperty(property);
    if (autoKeyframe) {
      replaceLayer(
        upsertMotionLayerKeyframe(layer, property, localTime, {
          value: nextValue,
          easing: keyframeAtPlayhead?.easing ?? "ease",
        }),
      );
      return;
    }
    onUpdate((current) =>
      current.id === effect.id
        ? setMotionEffectParameterValue(current, param, nextValue)
        : current,
    );
  };

  const toggleKeyframe = () => {
    setSelectedProperty(property);
    if (keyframeAtPlayhead) {
      replaceLayer(removeMotionLayerKeyframe(layer, keyframeAtPlayhead.id));
      return;
    }
    replaceLayer(
      upsertMotionLayerKeyframe(layer, property, localTime, {
        value,
        easing: "ease",
      }),
    );
  };

  return (
    <Field label={label} hint={descriptor?.unit}>
      <div className="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
        {usesSlider ? (
          <Slider
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
        ) : (
          <NumberInput
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
        )}
        <IconButton
          icon={Diamond}
          label={
            keyframeAtPlayhead
              ? `删除 ${label} 关键帧`
              : `添加 ${label} 关键帧`
          }
          size="sm"
          variant={keyframeAtPlayhead ? "solid" : "ghost"}
          onClick={toggleKeyframe}
        />
      </div>
    </Field>
  );
}

function ShaderParameterControl({
  effect,
  layer,
  paramDef,
  localTime,
  autoKeyframe,
  onUpdate,
  replaceLayer,
  setSelectedProperty,
}: {
  effect: MotionEffect;
  layer: MotionLayer;
  paramDef: MotionShaderParamDef;
  localTime: number;
  autoKeyframe: boolean;
  onUpdate: (updater: (effect: MotionEffect) => MotionEffect) => void;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
}): JSX.Element {
  const param = paramDef.name;
  const property = getMotionEffectKeyframeProperty(effect.id, param);
  const value = getMotionEffectParameterValueAtTime(
    effect,
    layer.keyframes,
    param,
    localTime,
    layer.expressions,
    layer.duration,
  );
  const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
    layer,
    property,
    localTime,
  );
  const { label, min, max, step } = paramDef;
  const usesSlider = min >= 0 && max <= 4;

  const writeValue = (nextValue: number) => {
    setSelectedProperty(property);
    if (autoKeyframe) {
      replaceLayer(
        upsertMotionLayerKeyframe(layer, property, localTime, {
          value: nextValue,
          easing: keyframeAtPlayhead?.easing ?? "ease",
        }),
      );
      return;
    }
    onUpdate((current) =>
      current.id === effect.id
        ? setMotionEffectParameterValue(current, param, nextValue)
        : current,
    );
  };

  const toggleKeyframe = () => {
    setSelectedProperty(property);
    if (keyframeAtPlayhead) {
      replaceLayer(removeMotionLayerKeyframe(layer, keyframeAtPlayhead.id));
      return;
    }
    replaceLayer(
      upsertMotionLayerKeyframe(layer, property, localTime, {
        value,
        easing: "ease",
      }),
    );
  };

  return (
    <Field label={label}>
      <div className="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
        {usesSlider ? (
          <Slider
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
        ) : (
          <NumberInput
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={writeValue}
          />
        )}
        <IconButton
          icon={Diamond}
          label={
            keyframeAtPlayhead
              ? `删除 ${label} 关键帧`
              : `添加 ${label} 关键帧`
          }
          size="sm"
          variant={keyframeAtPlayhead ? "solid" : "ghost"}
          onClick={toggleKeyframe}
        />
      </div>
    </Field>
  );
}
