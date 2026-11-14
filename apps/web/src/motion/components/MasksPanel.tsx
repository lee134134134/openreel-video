import { useState, type JSX } from "react";
import {
  ArrowDown,
  ArrowUp,
  Circle,
  ClipboardPaste,
  Copy,
  Pentagon,
  Diamond,
  Eye,
  EyeOff,
  Layers,
  Plus,
  Scissors,
  Spline,
  Square,
  Trash2,
} from "@/icons/lucide-compat";
import {
  MOTION_MASK_PRESETS,
  MOTION_TRACK_MATTE_PRESETS,
  addMotionLayerMask,
  clearMotionLayerTrackMatte,
  createMotionMask,
  findMotionLayerKeyframeAtTime,
  getAvailableMotionTrackMatteSources,
  getMotionLayerPropertyKeyframes,
  getMotionLayerPropertyValueAtTime,
  getMotionMaskKeyframeProperty,
  getMotionMaskPathKeyframeProperty,
  removeMotionLayerMask,
  removeMotionLayerKeyframe,
  removeMotionMaskPathKeyframe,
  reorderMotionLayerMask,
  setMotionLayerPropertyValue,
  setMotionLayerTrackMatte,
  toggleMotionLayerMask,
  toggleMotionLayerTrackMatte,
  transferMotionMaskStack,
  updateMotionLayerMask,
  upsertMotionLayerKeyframe,
  upsertMotionMaskPathKeyframe,
  updateMotionLayerTrackMatte,
  type MotionComposition,
  type MotionLayer,
  type MotionMask,
  type MotionMaskMode,
  type MotionMaskPresetShape,
  type MotionMaskPropertyName,
  type MotionMaskShape,
  type MotionTrackMatteType,
} from "@openreel/core";
import { ToolcraftClickableCard, ToolcraftText } from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useMotionStore } from "../stores/motion-store";
import {
  EmptyState,
  Button,
  Field,
  IconButton,
  NumberInput,
  PanelHeader,
  Section,
  SelectInput,
  SwitchInput,
} from "./primitives";

interface MasksPanelProps {
  composition: MotionComposition;
  embedded?: boolean;
}

let maskStackClipboard: Pick<
  MotionLayer,
  "masks" | "keyframes" | "expressions"
> | null = null;

const MASK_ICON: Record<MotionMaskShape, typeof Square> = {
  rectangle: Square,
  ellipse: Circle,
  polygon: Pentagon,
  path: Spline,
};

export function MasksPanel({ composition, embedded = false }: MasksPanelProps): JSX.Element | null {
  const selectedLayerId = useMotionStore((state) => state.selectedLayerId);
  const selectedLayerIds = useMotionStore((state) => state.selectedLayerIds);
  const selectedLayer =
    composition.layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const maskTargetLayerIds = selectedLayerId
    ? Array.from(new Set([selectedLayerId, ...selectedLayerIds])).filter((id) =>
        composition.layers.some((layer) => layer.id === id),
      )
    : [];
  const playhead = useMotionStore((state) => state.playhead);
  const autoKeyframe = useMotionStore((state) => state.autoKeyframe);
  const selectedProperty = useMotionStore((state) => state.selectedProperty);
  const setSelectedProperty = useMotionStore((state) => state.setSelectedProperty);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const setActiveTool = useMotionStore((state) => state.setActiveTool);
  const setMaskDrawMode = useMotionStore((state) => state.setMaskDrawMode);
  const [hasMaskStackClipboard, setHasMaskStackClipboard] =
    useState(maskStackClipboard !== null);
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

  const addMask = (shape: MotionMaskPresetShape) => {
    if (maskTargetLayerIds.length === 0) return;
    const targetIds = new Set(maskTargetLayerIds);
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        targetIds.has(layer.id)
          ? addMotionLayerMask(layer, createMotionMask(shape))
          : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const armMaskDraw = () => {
    if (!selectedLayer) return;
    setMaskDrawMode(true);
    setActiveTool("pen");
  };

  const copyMaskStack = () => {
    if (!selectedLayer || (selectedLayer.masks ?? []).length === 0) return;
    maskStackClipboard = {
      masks: structuredClone(selectedLayer.masks ?? []),
      keyframes: structuredClone(selectedLayer.keyframes),
      expressions: structuredClone(selectedLayer.expressions ?? []),
    };
    setHasMaskStackClipboard(true);
  };

  const pasteMaskStack = (mode: "append" | "replace") => {
    if (!maskStackClipboard || maskTargetLayerIds.length === 0) return;
    const targetIds = new Set(maskTargetLayerIds);
    void upsertMotionComposition({
      ...composition,
      layers: composition.layers.map((layer) =>
        targetIds.has(layer.id)
          ? transferMotionMaskStack(maskStackClipboard!, layer, mode).layer
          : layer,
      ),
      modifiedAt: Date.now(),
    });
  };

  const updateMask = (
    maskId: string,
    updater: (mask: MotionMask) => MotionMask,
  ) => {
    if (!selectedLayer) return;
    replaceLayer(updateMotionLayerMask(selectedLayer, maskId, updater));
  };

  if (!selectedLayer) {
    if (embedded) return null;
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PanelHeader title="蒙版" icon={Scissors} />
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Scissors}
            title="选择一个图层"
            description="蒙版用于显示或移除图层的部分区域，并通过共享动效引擎渲染。"
          />
        </div>
      </div>
    );
  }

  const masks = selectedLayer.masks ?? [];
  const selectedLayerLocalTime = Math.min(
    selectedLayer.duration,
    Math.max(0, playhead - selectedLayer.startTime),
  );

  return (
    <div className={embedded ? "" : "flex h-full min-h-0 flex-col"}>
      {embedded ? null : <PanelHeader title="蒙版" icon={Scissors} />}
      <div className={embedded ? "" : "min-h-0 flex-1 overflow-auto"}>
        <Section title="添加蒙版" icon={Plus}>
          {maskTargetLayerIds.length > 1 ? (
            <div className="mb-2 rounded-md border border-accent/25 bg-accent-soft px-2.5 py-2">
              <ToolcraftText type="supporting" color="secondary">
                新的预设蒙版将添加到所有 {maskTargetLayerIds.length}{" "}
                个所选图层。
              </ToolcraftText>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {MOTION_MASK_PRESETS.map((preset) => {
              const Icon = MASK_ICON[preset.shape];
              return (
                <ToolcraftClickableCard
                  key={preset.shape}
                  label={`添加${preset.name}`}
                  onClick={() => addMask(preset.shape)}
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
          <button
            type="button"
            onClick={armMaskDraw}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-bg-2 px-3 py-2 text-[12px] font-semibold text-fg-2 transition-colors hover:border-accent hover:text-accent"
          >
            <Spline size={13} aria-hidden />
            Draw mask (pen)
          </button>
        </Section>

        <TrackMatteSection
          composition={composition}
          selectedLayer={selectedLayer}
          replaceLayer={replaceLayer}
        />

        <Section title={`Stack (${masks.length})`} icon={Scissors}>
          <div className="mb-2 grid grid-cols-3 gap-1.5">
            <Button
              label="复制蒙版堆栈"
              icon={Copy}
              variant="outline"
              size="sm"
              disabled={masks.length === 0}
              onClick={copyMaskStack}
            />
            <Button
              label="粘贴蒙版"
              icon={ClipboardPaste}
              variant="outline"
              size="sm"
              disabled={!hasMaskStackClipboard}
              onClick={() => pasteMaskStack("append")}
            />
            <Button
              label="替换蒙版"
              variant="outline"
              size="sm"
              disabled={!hasMaskStackClipboard}
              onClick={() => pasteMaskStack("replace")}
            />
          </div>
          {masks.length === 0 ? (
            <ToolcraftText type="supporting" color="secondary" className="block rounded-md border border-dashed border-border bg-bg-2 px-3 py-3 text-[12px] leading-relaxed text-fg-muted">
              添加蒙版可裁切、显示或移除图层的部分区域，
              同时保持原始素材可编辑。
            </ToolcraftText>
          ) : (
            <div className="space-y-2">
              {masks.map((mask, index) => (
                <MaskCard
                  key={mask.id}
                  composition={composition}
                  mask={mask}
                  layer={selectedLayer}
                  localTime={selectedLayerLocalTime}
                  autoKeyframe={autoKeyframe}
                  selectedProperty={selectedProperty}
                  isFirst={index === 0}
                  isLast={index === masks.length - 1}
                  replaceLayer={replaceLayer}
                  setSelectedProperty={setSelectedProperty}
                  setRightTab={setRightTab}
                  onToggle={(enabled) =>
                    replaceLayer(toggleMotionLayerMask(selectedLayer, mask.id, enabled))
                  }
                  onMove={(direction) =>
                    replaceLayer(
                      reorderMotionLayerMask(selectedLayer, mask.id, direction),
                    )
                  }
                  onRemove={() =>
                    replaceLayer(removeMotionLayerMask(selectedLayer, mask.id))
                  }
                  onUpdate={(updater) => updateMask(mask.id, updater)}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function TrackMatteSection({
  composition,
  selectedLayer,
  replaceLayer,
}: {
  composition: MotionComposition;
  selectedLayer: MotionLayer;
  replaceLayer: (nextLayer: MotionLayer) => void;
}): JSX.Element {
  const matte = selectedLayer.trackMatte;
  const sources = getAvailableMotionTrackMatteSources(
    composition,
    selectedLayer.id,
  );
  const setSource = (sourceLayerId: string) => {
    if (!sourceLayerId) {
      replaceLayer(clearMotionLayerTrackMatte(selectedLayer));
      return;
    }
    replaceLayer(
      setMotionLayerTrackMatte(selectedLayer, {
        enabled: true,
        sourceLayerId,
        type: matte?.type ?? "alpha",
      }),
    );
  };

  return (
    <Section title="轨道蒙版" icon={Layers}>
      <Field label="源">
        <SelectInput
          value={matte?.sourceLayerId ?? ""}
          options={[
            { value: "", label: "None" },
            ...sources.map((source) => ({ value: source.id, label: source.name })),
          ]}
          onChange={setSource}
        />
      </Field>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <Field label="模式">
          <SelectInput
            value={matte?.type ?? "alpha"}
            disabled={!matte}
            options={MOTION_TRACK_MATTE_PRESETS.map((preset) => ({
              value: preset.type,
              label: preset.name,
            }))}
            onChange={(type) =>
              replaceLayer(
                updateMotionLayerTrackMatte(selectedLayer, (current) => ({
                  ...current,
                  type: type as MotionTrackMatteType,
                })),
              )
            }
          />
        </Field>
        <IconButton
          icon={Trash2}
          label="清除轨道蒙版"
          variant="danger"
          disabled={!matte}
          onClick={() => replaceLayer(clearMotionLayerTrackMatte(selectedLayer))}
        />
      </div>

      <SwitchInput
        label="启用"
        description="此图层通过源进行合成"
        checked={matte?.enabled ?? false}
        disabled={!matte}
        onChange={(enabled) =>
          replaceLayer(toggleMotionLayerTrackMatte(selectedLayer, enabled))
        }
      />
    </Section>
  );
}

function MaskCard({
  composition,
  mask,
  layer,
  localTime,
  autoKeyframe,
  selectedProperty,
  isFirst,
  isLast,
  replaceLayer,
  setSelectedProperty,
  setRightTab,
  onToggle,
  onMove,
  onRemove,
  onUpdate,
}: {
  composition: MotionComposition;
  mask: MotionMask;
  layer: MotionLayer;
  localTime: number;
  autoKeyframe: boolean;
  selectedProperty: string | null;
  isFirst: boolean;
  isLast: boolean;
  replaceLayer: (nextLayer: MotionLayer) => void;
  setSelectedProperty: (property: string | null) => void;
  setRightTab: (tab: "graph") => void;
  onToggle: (enabled: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onUpdate: (updater: (mask: MotionMask) => MotionMask) => void;
}): JSX.Element {
  const Icon = MASK_ICON[mask.shape];
  const getProperty = (property: MotionMaskPropertyName) =>
    getMotionMaskKeyframeProperty(mask.id, property);
  const getPropertyValue = (property: MotionMaskPropertyName) =>
    getMotionLayerPropertyValueAtTime(
      layer,
      getProperty(property),
      localTime,
      composition,
    );
  const writeMaskProperty = (
    property: MotionMaskPropertyName,
    value: number,
  ) => {
    const propertyId = getProperty(property);
    const hasAnimatedProperty =
      getMotionLayerPropertyKeyframes(layer, propertyId).length > 0;
    setSelectedProperty(propertyId);
    if (autoKeyframe || hasAnimatedProperty) {
      replaceLayer(
        upsertMotionLayerKeyframe(layer, propertyId, localTime, {
          value,
          easing: "ease",
        }),
      );
      return;
    }
    replaceLayer(setMotionLayerPropertyValue(layer, propertyId, value));
  };
  const toggleMaskPropertyKeyframe = (property: MotionMaskPropertyName) => {
    const propertyId = getProperty(property);
    const keyframeAtPlayhead = findMotionLayerKeyframeAtTime(
      layer,
      propertyId,
      localTime,
    );
    setSelectedProperty(propertyId);
    setRightTab("graph");
    if (keyframeAtPlayhead) {
      replaceLayer(removeMotionLayerKeyframe(layer, keyframeAtPlayhead.id));
      return;
    }
    replaceLayer(
      upsertMotionLayerKeyframe(layer, propertyId, localTime, {
        value: getMotionLayerPropertyValueAtTime(
          layer,
          propertyId,
          localTime,
          composition,
        ),
        easing: "ease",
      }),
    );
  };
  const isPropertySelected = (property: MotionMaskPropertyName) =>
    selectedProperty === getProperty(property);
  const hasPropertyKeyframeAtPlayhead = (property: MotionMaskPropertyName) =>
    Boolean(findMotionLayerKeyframeAtTime(layer, getProperty(property), localTime));

  const isPathMask = mask.shape === "path";
  const pathKeyframeAtPlayhead = (mask.pathKeyframes ?? []).find(
    (keyframe) => Math.abs(keyframe.time - localTime) <= 0.001,
  );
  const pathKeyframeProperty = getMotionMaskPathKeyframeProperty(mask.id);
  const isPathPropertySelected = selectedProperty === pathKeyframeProperty;
  const toggleMaskPathKeyframe = () => {
    setSelectedProperty(pathKeyframeProperty);
    setRightTab("graph");
    if (pathKeyframeAtPlayhead) {
      replaceLayer(
        removeMotionMaskPathKeyframe(layer, mask.id, pathKeyframeAtPlayhead.id),
      );
      return;
    }
    replaceLayer(upsertMotionMaskPathKeyframe(layer, mask.id, localTime));
  };

  return (
    <div className={`rounded-lg border border-border bg-bg-2 ${mask.enabled ? "" : "opacity-55"}`}>
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-bg-1 text-fg-3">
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold text-fg-2">
            {mask.name}
          </span>
          <span className="block text-[10.5px] capitalize text-fg-muted">
            {mask.mode} {mask.inverted ? "inverted" : "mask"}
          </span>
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            icon={ArrowUp}
            label="蒙版上移"
            size="sm"
            disabled={isFirst}
            onClick={() => onMove(-1)}
          />
          <IconButton
            icon={ArrowDown}
            label="蒙版下移"
            size="sm"
            disabled={isLast}
            onClick={() => onMove(1)}
          />
          <IconButton
            icon={mask.enabled ? Eye : EyeOff}
            label={mask.enabled ? "禁用蒙版" : "启用蒙版"}
            size="sm"
            active={mask.enabled}
            onClick={() => onToggle(!mask.enabled)}
          />
          <IconButton
            icon={Trash2}
            label="移除蒙版"
            size="sm"
            variant="danger"
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="形状">
            <SelectInput
              value={mask.shape}
              disabled={isPathMask}
              options={
                isPathMask
                  ? [{ value: "path", label: "Path (bezier)" }]
                  : [
                      { value: "rectangle", label: "Rectangle" },
                      { value: "ellipse", label: "Ellipse" },
                      { value: "polygon", label: "Polygon" },
                    ]
              }
              onChange={(shape) =>
                onUpdate((current) => ({
                  ...current,
                  shape: shape as MotionMaskShape,
                  name:
                    shape === "ellipse"
                      ? "椭圆蒙版"
                      : shape === "polygon"
                        ? "多边形蒙版"
                        : "矩形蒙版",
                }))
              }
            />
          </Field>
          <Field label="模式">
            <SelectInput
              value={mask.mode}
              options={[
                { value: "add", label: "Add" },
                { value: "subtract", label: "Subtract" },
              ]}
              onChange={(mode) =>
                onUpdate((current) => ({
                  ...current,
                  mode: mode as MotionMaskMode,
                }))
              }
            />
          </Field>
        </div>

        <SwitchInput
          label="反相"
          description="使用蒙版外部区域"
          checked={mask.inverted}
          onChange={(inverted) =>
            onUpdate((current) => ({
              ...current,
              inverted,
            }))
          }
        />

        {isPathMask ? (
          <Field label="路径">
            <div className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-1.5">
              <span className="truncate rounded-[7px] border border-border bg-bg-1 px-[10px] py-2 text-[12px] text-fg-muted">
                {mask.pathPoints?.length ?? 0} 个顶点
                {(mask.pathKeyframes?.length ?? 0) > 0
                  ? ` · ${mask.pathKeyframes?.length} 个关键点`
                  : ""}
              </span>
              <IconButton
                icon={Diamond}
                label={
                  pathKeyframeAtPlayhead
                    ? "移除蒙版路径关键帧"
                    : "添加蒙版路径关键帧"
                }
                size="sm"
                variant={pathKeyframeAtPlayhead ? "solid" : "ghost"}
                active={isPathPropertySelected}
                onClick={toggleMaskPathKeyframe}
              />
            </div>
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="X" hint="%">
                <MaskNumberInput
                  property="x"
                  value={toPercent(getPropertyValue("x"))}
                  min={-400}
                  max={400}
                  onChange={(x) => writeMaskProperty("x", x / 100)}
                  selected={isPropertySelected("x")}
                  keyed={hasPropertyKeyframeAtPlayhead("x")}
                  onToggleKeyframe={() => toggleMaskPropertyKeyframe("x")}
                />
              </Field>
              <Field label="Y" hint="%">
                <MaskNumberInput
                  property="y"
                  value={toPercent(getPropertyValue("y"))}
                  min={-400}
                  max={400}
                  onChange={(y) => writeMaskProperty("y", y / 100)}
                  selected={isPropertySelected("y")}
                  keyed={hasPropertyKeyframeAtPlayhead("y")}
                  onToggleKeyframe={() => toggleMaskPropertyKeyframe("y")}
                />
              </Field>
              <Field label="宽度" hint="%">
                <MaskNumberInput
                  property="width"
                  value={toPercent(getPropertyValue("width"))}
                  min={0}
                  max={800}
                  onChange={(width) => writeMaskProperty("width", width / 100)}
                  selected={isPropertySelected("width")}
                  keyed={hasPropertyKeyframeAtPlayhead("width")}
                  onToggleKeyframe={() => toggleMaskPropertyKeyframe("width")}
                />
              </Field>
              <Field label="高度" hint="%">
                <MaskNumberInput
                  property="height"
                  value={toPercent(getPropertyValue("height"))}
                  min={0}
                  max={800}
                  onChange={(height) => writeMaskProperty("height", height / 100)}
                  selected={isPropertySelected("height")}
                  keyed={hasPropertyKeyframeAtPlayhead("height")}
                  onToggleKeyframe={() => toggleMaskPropertyKeyframe("height")}
                />
              </Field>
            </div>

            <Field label="旋转" hint="deg">
              <MaskNumberInput
                property="rotation"
                value={getPropertyValue("rotation")}
                min={0}
                max={360}
                onChange={(rotation) => writeMaskProperty("rotation", rotation)}
                selected={isPropertySelected("rotation")}
                keyed={hasPropertyKeyframeAtPlayhead("rotation")}
                onToggleKeyframe={() => toggleMaskPropertyKeyframe("rotation")}
              />
            </Field>
          </>
        )}
        <Field label="扩展" hint="px">
          <MaskNumberInput
            property="expansion"
            value={getPropertyValue("expansion")}
            min={-1000}
            max={1000}
            step={1}
            onChange={(expansion) => writeMaskProperty("expansion", expansion)}
            selected={isPropertySelected("expansion")}
            keyed={hasPropertyKeyframeAtPlayhead("expansion")}
            onToggleKeyframe={() => toggleMaskPropertyKeyframe("expansion")}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="羽化" hint="px">
            <MaskNumberInput
              property="feather"
              value={getPropertyValue("feather")}
              min={0}
              max={1000}
              step={1}
              onChange={(feather) => writeMaskProperty("feather", feather)}
              selected={isPropertySelected("feather")}
              keyed={hasPropertyKeyframeAtPlayhead("feather")}
              onToggleKeyframe={() => toggleMaskPropertyKeyframe("feather")}
            />
          </Field>
          <Field label="不透明度" hint="%">
            <MaskNumberInput
              property="opacity"
              value={Math.round(getPropertyValue("opacity") * 100)}
              min={0}
              max={100}
              step={1}
              onChange={(opacity) => writeMaskProperty("opacity", opacity / 100)}
              selected={isPropertySelected("opacity")}
              keyed={hasPropertyKeyframeAtPlayhead("opacity")}
              onToggleKeyframe={() => toggleMaskPropertyKeyframe("opacity")}
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function MaskNumberInput({
  value,
  min,
  max,
  step,
  selected,
  keyed,
  onChange,
  onToggleKeyframe,
}: {
  property: MotionMaskPropertyName;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  selected: boolean;
  keyed: boolean;
  onChange: (value: number) => void;
  onToggleKeyframe: () => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
      <NumberInput value={value} min={min} max={max} step={step} onChange={onChange} />
      <IconButton
        icon={Diamond}
        label={keyed ? "移除蒙版关键帧" : "添加蒙版关键帧"}
        size="sm"
        variant={keyed ? "solid" : "ghost"}
        active={selected}
        onClick={onToggleKeyframe}
      />
    </div>
  );
}

function toPercent(value: number): number {
  return Math.round(value * 100);
}
