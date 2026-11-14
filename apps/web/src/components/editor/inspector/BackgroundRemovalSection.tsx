import React, { useState, useCallback, useEffect } from "react";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { PropertySlider } from "./shell/PropertySlider";
import {
  User,
  ImageIcon,
  Palette,
  Droplets,
  Loader2,
  Info,
} from "@/icons/lucide-compat";
import {
  getBackgroundRemovalEngine,
  initializeBackgroundRemovalEngine,
  type BackgroundRemovalSettings,
  type BackgroundMode,
  DEFAULT_BACKGROUND_SETTINGS,
} from "@openreel/core";
import { toast } from "../../../stores/notification-store";
import { useProcessingStore } from "../../../services/processing-manager";
import { ColorSelector } from "../../../motion/components/primitives";

interface BackgroundRemovalSectionProps {
  clipId: string;
  onSettingsChange?: (settings: BackgroundRemovalSettings) => void;
}

const BACKGROUND_MODES: {
  value: BackgroundMode;
  label: string;
  icon: React.ElementType;
}[] = [
  { value: "blur", label: "模糊", icon: Droplets },
  { value: "color", label: "颜色", icon: Palette },
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "transparent", label: "Transparent", icon: User },
];

const PRESET_COLORS = [
  "#00ff00",
  "#0000ff",
  "#ffffff",
  "#000000",
  "#ff0000",
  "#ffff00",
  "#00ffff",
  "#ff00ff",
];

export const BackgroundRemovalSection: React.FC<
  BackgroundRemovalSectionProps
> = ({ clipId, onSettingsChange }) => {
  const [settings, setSettings] = useState<BackgroundRemovalSettings>(
    DEFAULT_BACKGROUND_SETTINGS,
  );
  const [isInitializing, setIsInitializing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { addTask, updateTaskProgress, completeTask, failTask } =
    useProcessingStore();

  useEffect(() => {
    const engine = getBackgroundRemovalEngine();
    if (engine) {
      setSettings(engine.getSettings(clipId));
      setIsInitialized(engine.isInitialized());
    }
  }, [clipId]);

  const handleInitialize = useCallback(async () => {
    setIsInitializing(true);
    try {
      const engine = initializeBackgroundRemovalEngine();
      await engine.initialize();
      setIsInitialized(true);
    } catch (error) {
      console.error("Failed to initialize background removal:", error);
    } finally {
      setIsInitializing(false);
    }
  }, []);

  const updateSettings = useCallback(
    (updates: Partial<BackgroundRemovalSettings>) => {
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);

      const engine = getBackgroundRemovalEngine();
      if (engine) {
        engine.setSettings(clipId, newSettings);
      }

      onSettingsChange?.(newSettings);
      window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
    },
    [settings, clipId, onSettingsChange],
  );

  const processBackgroundRemoval = useCallback(async () => {
    const taskId = addTask(clipId, "background-removal");
    setIsProcessing(true);

    try {
      updateTaskProgress(taskId, 10, "正在初始化 AI 模型…");

      if (!isInitialized) {
        await handleInitialize();
      }

      updateTaskProgress(taskId, 30, "正在准备背景检测…");
      await new Promise((resolve) => setTimeout(resolve, 500));

      updateTaskProgress(taskId, 60, "正在配置效果管线…");
      await new Promise((resolve) => setTimeout(resolve, 400));

      updateTaskProgress(taskId, 90, "正在完成设置…");
      await new Promise((resolve) => setTimeout(resolve, 300));

      updateSettings({ enabled: true });
      completeTask(taskId);
      toast.success(
        "背景移除已就绪",
        "效果将在播放时应用",
      );
    } catch (error) {
      failTask(
        taskId,
        error instanceof Error ? error.message : "未知错误",
      );
      toast.error("处理失败", "无法启用背景移除");
    } finally {
      setIsProcessing(false);
    }
  }, [
    clipId,
    isInitialized,
    handleInitialize,
    updateSettings,
    addTask,
    updateTaskProgress,
    completeTask,
    failTask,
  ]);

  const handleToggleEnabled = useCallback(() => {
    if (settings.enabled) {
      updateSettings({ enabled: false });
      toast.info("背景移除已关闭");
    } else {
      processBackgroundRemoval();
    }
  }, [settings.enabled, updateSettings, processBackgroundRemoval]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          label={settings.enabled ? "On" : "Off"}
          icon={
            isInitializing || isProcessing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : undefined
          }
          variant={settings.enabled ? "primary" : "secondary"}
          size="sm"
          onClick={handleToggleEnabled}
          isDisabled={isInitializing || isProcessing}
        />
      </div>

      {settings.enabled && (
        <Card variant="muted" padding={3} className="space-y-3">
          <div>
            <Text type="supporting" color="secondary" className="mb-2 block text-[10px]">
              背景模式
            </Text>
            <div className="grid grid-cols-4 gap-1">
              {BACKGROUND_MODES.map((mode) => {
                const ModeIcon = mode.icon;
                return (
                  <ClickableCard
                    key={mode.value}
                    label={`${mode.label} background mode`}
                    onClick={() => updateSettings({ mode: mode.value })}
                    className={`flex flex-col items-center gap-1 rounded p-2 transition-colors ${
                      settings.mode === mode.value
                        ? "bg-primary/20 border border-primary"
                        : "bg-bg-1 hover:bg-background-primary border border-transparent"
                    }`}
                  >
                    <ModeIcon size={14} />
                    <Text type="supporting" color="primary" className="text-[9px]">
                      {mode.label}
                    </Text>
                  </ClickableCard>
                );
              })}
            </div>
          </div>

          {settings.mode === "blur" && (
            <PropertySlider
              label="模糊量"
              min={0}
              max={50}
              step={1}
              value={settings.blurAmount}
              onChange={(value: number) => updateSettings({ blurAmount: value })}
              formatValue={(value) => `${Math.round(value)}px`}
            />
          )}

          {settings.mode === "color" && (
            <div>
              <Text type="supporting" color="secondary" className="mb-2 block text-[10px]">
                背景颜色
              </Text>
              <div className="grid grid-cols-8 gap-1 mb-2">
                {PRESET_COLORS.map((color) => (
                  <ClickableCard
                    key={color}
                    label={`使用${color}背景颜色`}
                    onClick={() => updateSettings({ backgroundColor: color })}
                    className={`w-6 h-6 rounded border-2 transition-all ${
                      settings.backgroundColor === color
                        ? "border-primary scale-110"
                        : "border-transparent hover:scale-105"
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <ColorSelector
                value={settings.backgroundColor}
                onChange={(value) => updateSettings({ backgroundColor: value })}
                label="选择替换背景颜色"
              />
            </div>
          )}

          {settings.mode === "image" && (
            <div>
              <Text type="supporting" color="secondary" className="mb-2 block text-[10px]">
                背景图像
              </Text>
              <Button
                label="选择图像"
                icon={<ImageIcon size={14} />}
                variant="secondary"
                size="sm"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*";
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      const url = URL.createObjectURL(file);
                      updateSettings({ backgroundImageUrl: url });
                      const engine = getBackgroundRemovalEngine();
                      if (engine) {
                        await engine.setBackgroundImage(url);
                      }
                    }
                  };
                  input.click();
                }}
                className="w-full justify-center"
              />
              {settings.backgroundImageUrl && (
                <Text type="supporting" color="secondary" className="mt-2 truncate text-[9px]">
                  图像已加载
                </Text>
              )}
            </div>
          )}

          <PropertySlider
            label="边缘平滑"
            min={0}
            max={10}
            step={1}
            value={settings.edgeBlur}
            onChange={(value: number) => updateSettings({ edgeBlur: value })}
            formatValue={(value) => `${Math.round(value)}`}
          />

          <PropertySlider
            label="检测阈值"
            min={0}
            max={100}
            step={1}
            value={settings.threshold * 100}
            onChange={(value: number) => updateSettings({ threshold: value / 100 })}
            formatValue={(value) => `${Math.round(value)}%`}
          />

          <div className="flex items-start gap-2 p-2 bg-primary/10 rounded border border-primary/20">
            <Info size={14} className="text-primary flex-shrink-0 mt-0.5" />
            <Text type="supporting" color="secondary" className="text-[9px]">
              Background removal is processed in real-time. For best results,
              export your video after previewing.
            </Text>
          </div>
        </Card>
      )}
    </div>
  );
};

export default BackgroundRemovalSection;
