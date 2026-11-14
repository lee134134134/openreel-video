import React, { useState, useEffect, useCallback } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftCheckboxInput as CheckboxInput } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import {
  Target,
  X,
  Check,
  AlertTriangle,
  Move,
  RotateCcw,
  Maximize2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from "@/icons/lucide-compat";
import {
  getMotionTrackingBridge,
  type MotionTrackingState,
} from "../../../bridges/motion-tracking-bridge";
import type { Rectangle } from "@openreel/core";

interface MotionTrackingSectionProps {
  clipId: string;
}

type TrackingAlgorithm = "correlation" | "optical-flow" | "feature";

const ALGORITHMS: {
  id: TrackingAlgorithm;
  name: string;
  description: string;
}[] = [
  {
    id: "correlation",
    name: "Correlation",
    description: "最适合高对比度对象",
  },
  {
    id: "optical-flow",
    name: "光流",
    description: "适合平滑运动",
  },
  {
    id: "feature",
    name: "特征匹配",
    description: "适用于复杂纹理",
  },
];

const RegionInput: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
}> = ({ label, value, onChange }) => (
  <ToolcraftNumberInputControl
    label={label}
    size="sm"
    width="100%"
    value={value}
    onChange={onChange}
    step={1}
  />
);

export const MotionTrackingSection: React.FC<MotionTrackingSectionProps> = ({
  clipId,
}) => {
  const [state, setState] = useState<MotionTrackingState>({
    isTracking: false,
    progress: 0,
    currentJob: null,
    trackingData: null,
    lostFrames: [],
    error: null,
  });

  const [region, setRegion] = useState<Rectangle>({
    x: 100,
    y: 100,
    width: 200,
    height: 200,
  });

  const [algorithm, setAlgorithm] = useState<TrackingAlgorithm>("correlation");
  const [confidenceThreshold, setConfidenceThreshold] = useState(70);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [applyScale, setApplyScale] = useState(true);
  const [applyRotation, setApplyRotation] = useState(true);
  const [smoothing, setSmoothing] = useState(0);
  const [isApplied, setIsApplied] = useState(false);

  const bridge = getMotionTrackingBridge();

  useEffect(() => {
    const unsubscribe = bridge.subscribe(setState);
    const existingData = bridge.getTrackingDataForClip(clipId);
    if (existingData.length > 0) {
      setState((prev) => ({
        ...prev,
        trackingData: existingData[existingData.length - 1],
      }));
    }
    return unsubscribe;
  }, [bridge, clipId]);

  const handleStartTracking = useCallback(async () => {
    try {
      await bridge.startTracking(clipId, region, {
        frameRate: 30,
        startFrame: 0,
        endFrame: 150,
        algorithm,
        confidenceThreshold: confidenceThreshold / 100,
      });
    } catch (error) {
      console.error("Failed to start tracking:", error);
    }
  }, [bridge, clipId, region, algorithm, confidenceThreshold]);

  const handleCancelTracking = useCallback(() => {
    if (state.currentJob) {
      bridge.cancelTracking(state.currentJob.id);
    }
  }, [bridge, state.currentJob]);

  const handleApplyTracking = useCallback(() => {
    const success = bridge.applyTrackingToClip(clipId, {
      x: offsetX,
      y: offsetY,
    });
    if (success) {
      bridge.setApplyScale(clipId, applyScale);
      bridge.setApplyRotation(clipId, applyRotation);
      setIsApplied(true);
    }
  }, [bridge, clipId, offsetX, offsetY, applyScale, applyRotation]);

  const handleRemoveTracking = useCallback(() => {
    bridge.removeAttachment(clipId);
    setIsApplied(false);
  }, [bridge, clipId]);

  const handleOffsetChange = useCallback(
    (axis: "x" | "y", value: number) => {
      if (axis === "x") {
        setOffsetX(value);
      } else {
        setOffsetY(value);
      }
      if (isApplied) {
        bridge.setTrackingOffset(clipId, {
          x: axis === "x" ? value : offsetX,
          y: axis === "y" ? value : offsetY,
        });
      }
    },
    [bridge, clipId, isApplied, offsetX, offsetY],
  );

  const hasTrackingData =
    state.trackingData !== null || bridge.hasTrackingData(clipId);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-2 bg-primary/10 rounded-lg border border-primary/30">
        <Target size={16} className="text-primary" />
        <div className="flex flex-1 flex-col gap-0.5">
          <Text type="supporting" color="primary" weight="medium">
            运动跟踪
          </Text>
          <Text type="supporting" color="secondary" className="text-[9px]">
            跟踪对象以附加元素
          </Text>
        </div>
      </div>

      {!state.isTracking && !hasTrackingData && (
        <>
          <div className="space-y-2">
            <Text type="supporting" color="secondary" weight="medium">
              跟踪区域
            </Text>
            <div className="grid grid-cols-2 gap-2">
              <RegionInput
                label="X 位置"
                value={region.x}
                onChange={(x) => setRegion({ ...region, x })}
              />
              <RegionInput
                label="Y 位置"
                value={region.y}
                onChange={(y) => setRegion({ ...region, y })}
              />
              <RegionInput
                label="宽度"
                value={region.width}
                onChange={(width) => setRegion({ ...region, width })}
              />
              <RegionInput
                label="高度"
                value={region.height}
                onChange={(height) => setRegion({ ...region, height })}
              />
            </div>
            <Text type="supporting" color="secondary" className="text-center text-[9px]">
              在预览中绘制区域或输入坐标
            </Text>
          </div>

          <Button
            label="高级选项"
            size="sm"
            variant="ghost"
            icon={showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center gap-2 py-1.5 text-[10px] text-fg-2 hover:text-fg transition-colors"
          />

          {showAdvanced && (
            <Card variant="muted" padding={3} className="space-y-3">
              <div className="space-y-1.5">
                <Text type="supporting" color="secondary" weight="medium">
                  算法
                </Text>
                <div className="space-y-1">
                  {ALGORITHMS.map((algo) => (
                    <Button
                      key={algo.id}
                      label={`${algo.name}: ${algo.description}`}
                      size="sm"
                      variant={algorithm === algo.id ? "primary" : "secondary"}
                      onClick={() => setAlgorithm(algo.id)}
                      className="w-full justify-start"
                    />
                  ))}
                </div>
              </div>

              <PropertySlider
                label="置信度阈值"
                min={30}
                max={95}
                step={5}
                value={confidenceThreshold}
                onChange={setConfidenceThreshold}
                formatValue={(value) => `${value}%`}
                description="数值越高越精确，但越容易丢失跟踪"
              />

              <PropertySlider
                label="路径平滑"
                min={0}
                max={10}
                step={1}
                value={smoothing}
                onChange={setSmoothing}
                formatValue={(value) => String(value)}
                description="减少跟踪路径中的抖动"
              />
            </Card>
          )}

          <Button
            label="开始跟踪"
            size="md"
            variant="primary"
            icon={<Target size={14} />}
            onClick={handleStartTracking}
            className="w-full py-2.5 bg-primary hover:bg-primary-hover rounded-lg text-[11px] font-medium text-white flex items-center justify-center gap-2 transition-colors"
          />
        </>
      )}

      {state.isTracking && (
        <div className="space-y-3 p-3 bg-bg-2 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              <Text type="supporting" color="primary" weight="medium">
                正在跟踪
              </Text>
            </div>
            <IconButton
              label="取消跟踪"
              icon={<X size={14} />}
              size="sm"
              variant="ghost"
              onClick={handleCancelTracking}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <Text type="supporting" color="secondary">正在分析帧…</Text>
              <Text type="supporting" color="primary" className="font-mono">
                {Math.round(state.progress)}%
              </Text>
            </div>
            <div className="w-full h-2 bg-bg-1 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${state.progress}%` }}
              />
            </div>
          </div>

          {state.lostFrames.length > 0 && (
            <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-[10px] text-amber-400">
              <AlertTriangle size={12} />
              Lost tracking on {state.lostFrames.length} frame(s)
            </div>
          )}
        </div>
      )}

      {state.error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400">
          <div className="flex items-center gap-2 font-medium mb-1">
            <AlertTriangle size={12} />
            跟踪失败
          </div>
          <Text type="supporting" className="text-[9px] text-red-300/80">
            {state.error}
          </Text>
        </div>
      )}

      {hasTrackingData && !state.isTracking && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
            <Check size={14} className="text-green-400" />
            <div className="flex flex-1 flex-col gap-0.5">
              <Text type="supporting" weight="medium" className="text-[10px] text-green-400">
                跟踪完成
              </Text>
              {state.trackingData && (
                <Text type="supporting" className="text-[9px] text-green-300/70">
                  {state.trackingData.keyframes.length} keyframes captured
                  {state.trackingData.lostFrames.length > 0 &&
                    ` • ${state.trackingData.lostFrames.length} frames lost`}
                </Text>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Text
              type="supporting"
              color="secondary"
              weight="medium"
              className="flex items-center gap-2"
            >
              <Move size={12} />
              位置偏移
            </Text>
            <div className="grid grid-cols-2 gap-2">
              <RegionInput
                label="X 偏移"
                value={offsetX}
                onChange={(value) => handleOffsetChange("x", value)}
              />
              <RegionInput
                label="Y 偏移"
                value={offsetY}
                onChange={(value) => handleOffsetChange("y", value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Text type="supporting" color="secondary" weight="medium">
              变换选项
            </Text>
            <div className="grid grid-cols-2 gap-2">
              <CheckboxInput
                label="缩放"
                value={applyScale}
                labelIcon={<Maximize2 size={10} aria-hidden />}
                onChange={(value) => {
                  setApplyScale(value);
                  if (isApplied) {
                    bridge.setApplyScale(clipId, value);
                  }
                }}
              />
              <CheckboxInput
                label="旋转"
                value={applyRotation}
                labelIcon={<RotateCcw size={10} aria-hidden />}
                onChange={(value) => {
                  setApplyRotation(value);
                  if (isApplied) {
                    bridge.setApplyRotation(clipId, value);
                  }
                }}
              />
            </div>
          </div>

          {!isApplied ? (
            <Button
              label="将跟踪应用到片段"
              size="md"
              variant="secondary"
              onClick={handleApplyTracking}
              className="w-full py-2.5 bg-primary/20 border border-primary/30 rounded-lg text-[11px] font-medium text-primary hover:bg-primary/30 transition-colors"
            />
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 p-2 bg-primary/10 border border-primary/20 rounded-lg">
                <Check size={12} className="text-primary" />
                <Text type="supporting" color="primary" className="text-[10px]">
                  已应用跟踪
                </Text>
              </div>
              <Button
                label="移除跟踪"
                size="sm"
                variant="destructive"
                onClick={handleRemoveTracking}
                className="w-full py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400 hover:bg-red-500/20 transition-colors"
              />
            </div>
          )}

          <Button
            label="使用不同设置重新跟踪"
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={10} />}
            onClick={handleStartTracking}
            className="w-full flex items-center justify-center gap-2 py-1.5 text-[9px] text-fg-3 hover:text-fg-2 transition-colors"
          />
        </div>
      )}

      <div className="pt-2 border-t border-border">
        <Text type="supporting" color="secondary" className="text-center text-[9px]">
          跟踪对象以固定图形、文本或效果
        </Text>
      </div>
    </div>
  );
};

export default MotionTrackingSection;
