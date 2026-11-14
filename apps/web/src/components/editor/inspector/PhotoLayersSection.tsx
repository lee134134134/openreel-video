import React, { useCallback, useState, useMemo } from "react";
import {
  Layers,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
  Plus,
  GripVertical,
  ChevronDown,
} from "@/icons/lucide-compat";
import type { PhotoBlendMode, PhotoLayer } from "@openreel/core";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftPopover as Popover } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";

const BLEND_MODES: { value: PhotoBlendMode; label: string }[] = [
  { value: "normal", label: "正常" },
  { value: "multiply", label: "正片叠底" },
  { value: "screen", label: "滤色" },
  { value: "overlay", label: "叠加" },
  { value: "softLight", label: "柔光" },
  { value: "hardLight", label: "强光" },
  { value: "colorDodge", label: "颜色减淡" },
  { value: "colorBurn", label: "颜色加深" },
  { value: "difference", label: "差值" },
  { value: "exclusion", label: "排除" },
  { value: "hue", label: "色相" },
  { value: "saturation", label: "饱和度" },
  { value: "color", label: "颜色" },
  { value: "luminosity", label: "明度" },
];

const BlendModeSelector: React.FC<{
  value: PhotoBlendMode;
  onChange: (mode: PhotoBlendMode) => void;
}> = ({ value, onChange }) => {
  const selectedMode =
    BLEND_MODES.find((m) => m.value === value) || BLEND_MODES[0];

  return (
    <div className="flex items-center justify-between">
      <Text type="supporting" color="secondary" className="text-[10px]">
        混合模式
      </Text>
      <Popover
        placement="below"
        alignment="end"
        width={180}
        label="混合模式"
        content={
          <div className="max-h-48 overflow-y-auto p-1.5">
          {BLEND_MODES.map((mode) => (
            <ClickableCard
              key={mode.value}
              label={`将混合模式设为${mode.label}`}
              onClick={() => onChange(mode.value)}
              padding={2}
              variant={mode.value === value ? "green" : "transparent"}
            >
              <Text type="supporting" color="primary" className="text-[10px]">
                {mode.label}
              </Text>
            </ClickableCard>
          ))}
          </div>
        }
      >
        <Button
          label={selectedMode.label}
          variant="secondary"
          size="sm"
          endContent={<ChevronDown size={12} className="text-fg-3" aria-hidden />}
        />
      </Popover>
    </div>
  );
};

/**
 * Layer Item Component
 */
const LayerItem: React.FC<{
  layer: PhotoLayer;
  isSelected: boolean;
  onSelect: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  draggable: boolean;
}> = ({
  layer,
  isSelected,
  onSelect,
  onToggleVisibility,
  onToggleLock,
  onDragStart,
  onDragOver,
  onDrop,
  draggable,
}) => {
  return (
    <Card
      variant={isSelected ? "green" : "muted"}
      padding={2}
      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? "bg-primary/20 border border-primary"
          : "bg-bg-2 border border-transparent hover:border-border"
      }`}
      onClick={onSelect}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Drag Handle */}
      <div className="cursor-grab active:cursor-grabbing text-fg-3 hover:text-fg-2">
        <GripVertical size={14} aria-hidden />
      </div>

      {/* Layer Thumbnail */}
      <div className="w-8 h-8 bg-bg-1 rounded border border-border flex items-center justify-center overflow-hidden">
        {layer.content ? (
          <div className="w-full h-full bg-checkerboard" />
        ) : (
          <Layers size={14} className="text-fg-3" aria-hidden />
        )}
      </div>

      {/* Layer Name */}
      <div className="flex-1 min-w-0">
        <Text
          type="supporting"
          className={`text-[10px] font-medium truncate block ${
            layer.visible ? "text-fg" : "text-fg-3"
          }`}
        >
          {layer.name}
        </Text>
        <Text type="supporting" color="secondary" className="text-[9px] capitalize">
          {layer.type}
        </Text>
      </div>

      {/* Layer Actions */}
      <div className="flex items-center gap-1">
        <IconButton
          label={layer.visible ? "隐藏图层" : "显示图层"}
          icon={
            layer.visible ? (
              <Eye size={14} aria-hidden />
            ) : (
              <EyeOff size={14} aria-hidden />
            )
          }
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility();
          }}
          className={`p-1 rounded transition-colors ${
            layer.visible
              ? "text-fg-2 hover:text-fg"
              : "text-fg-3 hover:text-fg-2"
          }`}
        />
        <IconButton
          label={layer.locked ? "解锁图层" : "锁定图层"}
          icon={
            layer.locked ? (
              <Lock size={14} aria-hidden />
            ) : (
              <Unlock size={14} aria-hidden />
            )
          }
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock();
          }}
          className={`p-1 rounded transition-colors ${
            layer.locked
              ? "text-warning hover:text-warning/80"
              : "text-fg-3 hover:text-fg-2"
          }`}
        />
      </div>
    </Card>
  );
};

/**
 * PhotoLayersSection Props
 */
interface PhotoLayersSectionProps {
  layers: PhotoLayer[];
  selectedLayerIndex: number;
  onSelectLayer: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
  onSetOpacity: (layerId: string, opacity: number) => void;
  onSetBlendMode: (layerId: string, blendMode: PhotoBlendMode) => void;
  onReorderLayers: (fromIndex: number, toIndex: number) => void;
  onAddLayer: () => void;
  onDeleteLayer: (layerId: string) => void;
  onDuplicateLayer: (layerId: string) => void;
}

/**
 * PhotoLayersSection Component
 *
 * - 18.1: Display layer list with image content
 * - 18.2: Add new layers above current layer
 * - 18.3: Reorder layers via drag and drop
 * - 18.4: Adjust layer opacity
 * - 18.5: Toggle layer visibility
 */
export const PhotoLayersSection: React.FC<PhotoLayersSectionProps> = ({
  layers,
  selectedLayerIndex,
  onSelectLayer,
  onToggleVisibility,
  onToggleLock,
  onSetOpacity,
  onSetBlendMode,
  onReorderLayers,
  onAddLayer,
  onDeleteLayer,
  onDuplicateLayer,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Get selected layer
  const selectedLayer = useMemo(() => {
    if (selectedLayerIndex >= 0 && selectedLayerIndex < layers.length) {
      return layers[selectedLayerIndex];
    }
    return null;
  }, [layers, selectedLayerIndex]);

  // Handle drag start
  const handleDragStart = useCallback(
    (index: number) => (e: React.DragEvent) => {
      setDraggedIndex(index);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", index.toString());
    },
    [],
  );

  // Handle drag over
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  // Handle drop
  const handleDrop = useCallback(
    (toIndex: number) => (e: React.DragEvent) => {
      e.preventDefault();
      if (draggedIndex !== null && draggedIndex !== toIndex) {
        onReorderLayers(draggedIndex, toIndex);
      }
      setDraggedIndex(null);
    },
    [draggedIndex, onReorderLayers],
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
  }, []);

  if (layers.length === 0) {
    return (
      <div className="p-4 text-center">
        <Layers size={24} className="mx-auto mb-2 text-fg-3" aria-hidden />
        <Text type="supporting" color="secondary" className="text-[10px]">
          无图层
        </Text>
        <Button
          label="添加图层"
          variant="primary"
          size="sm"
          onClick={onAddLayer}
          className="mt-2"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Layer List Header */}
      <div className="flex items-center justify-between">
        <Text type="supporting" color="secondary" weight="bold" className="text-[10px]">
          Layers ({layers.length})
        </Text>
        <IconButton
          label="添加新图层"
          icon={<Plus size={14} aria-hidden />}
          variant="ghost"
          size="sm"
          onClick={onAddLayer}
          className="text-fg-3 hover:text-fg"
        />
      </div>

      {/* Layer List - Reversed to show top layers first */}
      <div className="space-y-1" onDragEnd={handleDragEnd}>
        {[...layers].reverse().map((layer, reversedIndex) => {
          const actualIndex = layers.length - 1 - reversedIndex;
          return (
            <LayerItem
              key={layer.id}
              layer={layer}
              isSelected={actualIndex === selectedLayerIndex}
              onSelect={() => onSelectLayer(layer.id)}
              onToggleVisibility={() => onToggleVisibility(layer.id)}
              onToggleLock={() => onToggleLock(layer.id)}
              onDragStart={handleDragStart(actualIndex)}
              onDragOver={handleDragOver}
              onDrop={handleDrop(actualIndex)}
              draggable={!layer.locked}
            />
          );
        })}
      </div>

      {/* Selected Layer Properties */}
      {selectedLayer && (
        <div className="space-y-3 pt-3 border-t border-border">
          <Text type="supporting" color="secondary" weight="bold" className="text-[10px]">
            图层属性
          </Text>

          {/* Opacity Slider */}
          <PropertySlider
            label="不透明度"
            value={selectedLayer.opacity * 100}
            onChange={(value: number) => onSetOpacity(selectedLayer.id, value / 100)}
            min={0}
            max={100}
            formatValue={(value) => `${Math.round(value)}%`}
          />

          {/* Blend Mode Selector */}
          <BlendModeSelector
            value={selectedLayer.blendMode}
            onChange={(mode) => onSetBlendMode(selectedLayer.id, mode)}
          />

          {/* Layer Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              label="创建副本"
              icon={<Copy size={12} aria-hidden />}
              variant="secondary"
              size="sm"
              onClick={() => onDuplicateLayer(selectedLayer.id)}
              className="flex-1"
            />
            <Button
              label="删除"
              icon={<Trash2 size={12} aria-hidden />}
              variant="secondary"
              size="sm"
              onClick={() => onDeleteLayer(selectedLayer.id)}
              isDisabled={layers.length <= 1}
              className="flex-1 text-error"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoLayersSection;
