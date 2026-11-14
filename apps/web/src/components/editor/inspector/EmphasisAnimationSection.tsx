import React, { useCallback, useMemo } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { RotateCcw, Target, Zap, Clock } from "@/icons/lucide-compat";
import { MockSlider, MockToggle } from "./shell/InspectorControls";
import { useProjectStore } from "../../../stores/project-store";
import { useEngineStore } from "../../../stores/engine-store";
import type { EmphasisAnimation, EmphasisAnimationType } from "@openreel/core";

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return mins > 0 ? `${mins}:${secs.padStart(4, "0")}` : `${secs}s`;
};

interface EmphasisAnimationSectionProps {
  clipId: string;
}

const EMPHASIS_ANIMATIONS: {
  category: string;
  animations: {
    type: EmphasisAnimationType;
    label: string;
    description: string;
  }[];
}[] = [
  {
    category: "注意力",
    animations: [
      {
        type: "pulse",
        label: "脉冲",
        description: "轻柔的缩放呼吸效果",
      },
      {
        type: "heartbeat",
        label: "心跳",
        description: "如心跳般的双拍脉冲",
      },
      { type: "flash", label: "闪光", description: "不透明度脉冲效果" },
      { type: "glow", label: "辉光", description: "缩放与不透明度脉冲" },
      {
        type: "breathe",
        label: "呼吸",
        description: "缓慢舒缓的缩放效果",
      },
    ],
  },
  {
    category: "运动",
    animations: [
      {
        type: "shake",
        label: "摇晃",
        description: "快速左右摇晃",
      },
      { type: "bounce", label: "弹跳", description: "上下弹跳" },
      { type: "float", label: "漂浮", description: "轻柔漂浮运动" },
      {
        type: "vibrate",
        label: "震动",
        description: "随机小幅抖动",
      },
      { type: "wave", label: "波浪", description: "波浪式运动" },
    ],
  },
  {
    category: "旋转",
    animations: [
      { type: "spin", label: "自旋", description: "持续旋转" },
      { type: "swing", label: "摆动", description: "如钟摆般旋转" },
      {
        type: "wobble",
        label: "摇摆",
        description: "旋转中摇摆",
      },
      { type: "tilt", label: "倾斜", description: "缓慢倾斜运动" },
      { type: "tada", label: "Tada", description: "吸引注意的扭动" },
    ],
  },
  {
    category: "扭曲",
    animations: [
      {
        type: "jello",
        label: "果冻",
        description: "果冻般的挤压效果",
      },
      {
        type: "rubber-band",
        label: "橡皮筋",
        description: "橡皮筋拉伸效果",
      },
      {
        type: "flicker",
        label: "频闪",
        description: "随机可见性频闪",
      },
    ],
  },
  {
    category: "缩放与平移",
    animations: [
      {
        type: "zoom-pulse",
        label: "缩放脉冲",
        description: "放大再缩小",
      },
      {
        type: "focus-zoom",
        label: "聚焦缩放",
        description: "放大到指定点再还原",
      },
      {
        type: "ken-burns",
        label: "肯·伯恩斯",
        description: "缓慢平移并缩放",
      },
      {
        type: "pan-left",
        label: "向左平移",
        description: "缓慢向左平移",
      },
      {
        type: "pan-right",
        label: "向右平移",
        description: "缓慢向右平移",
      },
      { type: "pan-up", label: "向上平移", description: "缓慢向上平移" },
      { type: "pan-down", label: "向下平移", description: "缓慢向下平移" },
    ],
  },
];

const DEFAULT_EMPHASIS: EmphasisAnimation = {
  type: "none",
  speed: 1,
  intensity: 1,
  loop: true,
};

const Slider: React.FC<{
  min: number;
  max: number;
  step?: number;
  value: number[];
  onValueChange: (value: number[]) => void;
}> = ({ min, max, step = 1, value, onValueChange }) => (
  <MockSlider
    min={min}
    max={max}
    step={step}
    value={value[0]}
    onChange={(nextValue: number) => onValueChange([nextValue])}
  />
);

const ValueText: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text
    type="supporting"
    color="primary"
    className="font-mono text-[10px] bg-bg-2 px-1.5 py-0.5 rounded border border-border"
  >
    {children as any}
  </Text>
);

export const EmphasisAnimationSection: React.FC<
  EmphasisAnimationSectionProps
> = ({ clipId }) => {
  const { project, updateClipEmphasisAnimation } = useProjectStore();
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  const clipDuration = useMemo((): number => {
    const clip = project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);
    if (clip) return clip.duration;

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) return textClip.duration;

    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) return shapeClip.duration;

    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) return svgClip.duration;

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) return stickerClip.duration;

    return 5;
  }, [
    clipId,
    project.timeline.tracks,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  const currentAnimation = useMemo((): EmphasisAnimation => {
    const clip = project.timeline.tracks
      .flatMap((t) => t.clips)
      .find((c) => c.id === clipId);

    if (clip?.emphasisAnimation) {
      return clip.emphasisAnimation;
    }

    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip?.emphasisAnimation) {
      return textClip.emphasisAnimation;
    }

    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip?.emphasisAnimation) {
      return shapeClip.emphasisAnimation;
    }

    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip?.emphasisAnimation) {
      return svgClip.emphasisAnimation;
    }

    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip?.emphasisAnimation) {
      return stickerClip.emphasisAnimation;
    }

    return DEFAULT_EMPHASIS;
  }, [
    clipId,
    project.timeline.tracks,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  const handleAnimationChange = useCallback(
    (updates: Partial<EmphasisAnimation>) => {
      const newAnimation = { ...currentAnimation, ...updates };
      updateClipEmphasisAnimation(clipId, newAnimation);
    },
    [clipId, currentAnimation, updateClipEmphasisAnimation],
  );

  const handleTypeChange = useCallback(
    (type: EmphasisAnimationType) => {
      if (type === "focus-zoom") {
        handleAnimationChange({
          type,
          focusPoint: { x: 0.5, y: 0.5 },
          zoomScale: 1.5,
          holdDuration: 0.3,
          loop: false,
        });
      } else if (type === "ken-burns") {
        handleAnimationChange({ type, loop: false });
      } else {
        handleAnimationChange({ type });
      }
    },
    [handleAnimationChange],
  );

  const handleReset = useCallback(() => {
    handleAnimationChange(DEFAULT_EMPHASIS);
  }, [handleAnimationChange]);

  const selectedAnimation = EMPHASIS_ANIMATIONS.flatMap(
    (cat) => cat.animations,
  ).find((a) => a.type === currentAnimation.type);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button
          label="无"
          variant={currentAnimation.type === "none" ? "primary" : "secondary"}
          size="sm"
          onClick={() => handleTypeChange("none")}
          className={`py-2 rounded-lg text-[10px] font-medium transition-all ${
            currentAnimation.type === "none"
              ? "bg-primary text-white"
              : "bg-bg-2 border border-border text-fg-2 hover:text-fg"
          }`}
        />
        <Button
          label="重置"
          icon={<RotateCcw size={10} />}
          variant="secondary"
          size="sm"
          onClick={handleReset}
          className="py-2 rounded-lg text-[10px] font-medium bg-bg-2 border border-border text-fg-2 hover:text-fg transition-all flex items-center justify-center gap-1"
        />
      </div>

      {EMPHASIS_ANIMATIONS.map((category) => (
        <div key={category.category}>
          <Text type="supporting" color="secondary" className="mb-2 block text-[10px] font-medium">
            {category.category}
          </Text>
          <div className="grid grid-cols-2 gap-1.5">
            {category.animations.map((anim) => (
              <ClickableCard
                key={anim.type}
                label={anim.label}
                onClick={() => handleTypeChange(anim.type)}
                className={`py-2 px-2 rounded-lg text-[10px] transition-all text-left ${
                  currentAnimation.type === anim.type
                    ? "bg-primary text-white"
                    : "bg-bg-2 border border-border text-fg-2 hover:text-fg hover:border-primary/50"
                  }`}
              >
                {anim.label}
              </ClickableCard>
            ))}
          </div>
        </div>
      ))}

      {currentAnimation.type !== "none" && (
        <>
          <div className="pt-3 border-t border-border space-y-3">
            {selectedAnimation && (
              <Text type="supporting" color="secondary" className="text-[10px] italic">
                {selectedAnimation.description}
              </Text>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  速度
                </Text>
                <ValueText>
                  {currentAnimation.speed.toFixed(1)}x
                </ValueText>
              </div>
              <Slider
                min={0.1}
                max={3}
                step={0.1}
                value={[currentAnimation.speed]}
                onValueChange={(value) =>
                  handleAnimationChange({ speed: value[0] })
                }
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  强度
                </Text>
                <ValueText>
                  {Math.round(currentAnimation.intensity * 100)}%
                </ValueText>
              </div>
              <Slider
                min={0.1}
                max={2}
                step={0.1}
                value={[currentAnimation.intensity]}
                onValueChange={(value) =>
                  handleAnimationChange({
                    intensity: value[0],
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <Text type="supporting" color="secondary" className="text-[10px]">
                循环动画
              </Text>
              <MockToggle
                ariaLabel="Loop Animation"
                checked={currentAnimation.loop}
                onChange={() =>
                  handleAnimationChange({ loop: !currentAnimation.loop })
                }
              />
            </div>
          </div>

          <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Clock size={12} />
              <Text type="supporting" className="text-[10px] font-medium text-primary">
                时间
              </Text>
              <Text type="supporting" color="secondary" className="ml-auto text-[9px]">
                Clip: {formatTime(clipDuration)}
              </Text>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  开始时间
                </Text>
                <ValueText>
                  {formatTime(currentAnimation.startTime ?? 0)}
                </ValueText>
              </div>
              <Slider
                min={0}
                max={clipDuration}
                step={0.1}
                value={[currentAnimation.startTime ?? 0]}
                onValueChange={(value) =>
                  handleAnimationChange({
                    startTime: value[0],
                  })
                }
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  时长
                </Text>
                <ValueText>
                  {currentAnimation.animationDuration
                    ? formatTime(currentAnimation.animationDuration)
                    : "整个片段"}
                </ValueText>
              </div>
              <Slider
                min={0}
                max={clipDuration - (currentAnimation.startTime ?? 0)}
                step={0.1}
                value={[
                  currentAnimation.animationDuration ??
                  clipDuration - (currentAnimation.startTime ?? 0)
                ]}
                onValueChange={(value) => {
                  const val = value[0];
                  handleAnimationChange({
                    animationDuration: val > 0 ? val : undefined,
                  });
                }}
              />
              <div className="flex justify-between text-[9px] text-fg-3">
                <Text as="span" type="supporting" color="secondary">
                  0s
                </Text>
                <Button
                  label="重置为整个片段"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    handleAnimationChange({
                      startTime: 0,
                      animationDuration: undefined,
                    })
                  }
                  className="text-primary hover:underline"
                />
                <Text as="span" type="supporting" color="secondary">
                  {formatTime(clipDuration - (currentAnimation.startTime ?? 0))}
                </Text>
              </div>
            </div>
          </div>

          {currentAnimation.type === "focus-zoom" && (
            <div className="pt-3 border-t border-border space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Target size={12} />
              <Text type="supporting" className="text-[10px] font-medium text-primary">
                聚焦缩放设置
              </Text>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    缩放比例
                  </Text>
                  <ValueText>
                    {(currentAnimation.zoomScale || 1.5).toFixed(1)}x
                  </ValueText>
                </div>
                <Slider
                  min={1.1}
                  max={3}
                  step={0.1}
                  value={[currentAnimation.zoomScale || 1.5]}
                  onValueChange={(value) =>
                    handleAnimationChange({
                      zoomScale: value[0],
                    })
                  }
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    保持时长
                  </Text>
                  <ValueText>
                    {((currentAnimation.holdDuration || 0.3) * 100).toFixed(0)}%
                  </ValueText>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.05}
                  value={[currentAnimation.holdDuration || 0.3]}
                  onValueChange={(value) =>
                    handleAnimationChange({
                      holdDuration: value[0],
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Text type="supporting" color="secondary" className="text-[10px]">
                  聚焦点
                </Text>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Text type="supporting" color="secondary" className="text-[9px]">
                      X 位置
                    </Text>
                    <Slider
                      min={0}
                      max={1}
                      step={0.05}
                      value={[currentAnimation.focusPoint?.x || 0.5]}
                      onValueChange={(value) =>
                        handleAnimationChange({
                          focusPoint: {
                            x: value[0],
                            y: currentAnimation.focusPoint?.y || 0.5,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Text type="supporting" color="secondary" className="text-[9px]">
                      Y 位置
                    </Text>
                    <Slider
                      min={0}
                      max={1}
                      step={0.05}
                      value={[currentAnimation.focusPoint?.y || 0.5]}
                      onValueChange={(value) =>
                        handleAnimationChange({
                          focusPoint: {
                            x: currentAnimation.focusPoint?.x || 0.5,
                            y: value[0],
                          },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1 mt-2">
                  {[
                    { x: 0, y: 0, label: "左上" },
                    { x: 0.5, y: 0, label: "中上" },
                    { x: 1, y: 0, label: "右上" },
                    { x: 0, y: 0.5, label: "左中" },
                    { x: 0.5, y: 0.5, label: "居中" },
                    { x: 1, y: 0.5, label: "右中" },
                    { x: 0, y: 1, label: "左下" },
                    { x: 0.5, y: 1, label: "中下" },
                    { x: 1, y: 1, label: "右下" },
                  ].map((preset) => (
                    <ClickableCard
                      key={preset.label}
                      label={`聚焦 ${preset.label}`}
                      onClick={() =>
                        handleAnimationChange({
                          focusPoint: { x: preset.x, y: preset.y },
                        })
                      }
                      className={`py-1.5 rounded text-[9px] transition-all ${
                        currentAnimation.focusPoint?.x === preset.x &&
                        currentAnimation.focusPoint?.y === preset.y
                          ? "bg-primary text-white"
                        : "bg-bg-2 border border-border text-fg-3 hover:text-fg"
                      }`}
                    >
                      {preset.label}
                    </ClickableCard>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="pt-3 border-t border-border">
        <div className="flex items-center gap-2 text-fg-3">
          <Zap size={10} />
          <Text type="supporting" color="secondary" className="text-[9px]">
            强调动画在片段可见期间播放（入场/退场期间不播放）
          </Text>
        </div>
      </div>
    </div>
  );
};

export default EmphasisAnimationSection;
