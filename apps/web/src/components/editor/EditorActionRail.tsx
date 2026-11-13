import React from "react";
import {
  ToolcraftDropdownMenu as DropdownMenu,
  ToolcraftIconButton as IconButton,
  ToolcraftTooltip as Tooltip,
} from "@openreel/ui";
import { Icon } from "@/icons/Icon";
import {
  House,
  Sun,
  Moon,
  SunMoon,
  Settings,
  Circle,
  Play,
  Sparkles,
  HelpCircle,
  FileCode,
  Command,
} from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useThemeStore } from "../../stores/theme-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useRouter } from "../../hooks/use-router";
import {
  startTour,
  ONBOARDING_KEY,
  startMoGraphTour,
  MOGRAPH_TOUR_KEY,
} from "./tour";

const RailButton: React.FC<{
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
}> = ({ label, icon, onClick, active = false }) => (
  <Tooltip content={label} placement="end">
    <IconButton
      label={label}
      icon={<Icon name={icon} size={16} ariaHidden />}
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
    />
  </Tooltip>
);

export const EditorActionRail: React.FC = () => {
  const { undo, redo } = useProjectStore();
  const {
    openModal,
    toggleKeyframeEditor,
    keyframeEditorOpen,
    panels,
    togglePanel,
    activeModal,
  } = useUIStore();
  const { mode: themeMode, toggleTheme } = useThemeStore();
  const { openSettings } = useSettingsStore();
  const { navigate } = useRouter();

  const themeLabel =
    themeMode === "auto" ? "跟随系统" : themeMode === "light" ? "浅色" : "深色";
  const nextThemeLabel =
    themeMode === "light" ? "深色" : themeMode === "dark" ? "跟随系统" : "浅色";
  const themeIcon =
    themeMode === "light" ? (
      <Sun size={16} aria-hidden />
    ) : themeMode === "dark" ? (
      <Moon size={16} aria-hidden />
    ) : (
      <SunMoon size={16} aria-hidden />
    );
  const themeActionLabel = `主题：${themeLabel}，切换到${nextThemeLabel}`;

  return (
    <nav
      data-tour="toolbar"
      aria-label="编辑器工具"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-bg-1 py-3"
    >
      <Tooltip content="返回首页" placement="end">
        <IconButton
          label="返回首页"
          icon={<House size={16} aria-hidden />}
          size="sm"
          variant="ghost"
          onClick={() => navigate("welcome")}
        />
      </Tooltip>

      <div className="my-1.5 h-px w-6 bg-border" />

      <RailButton
        label="搜索工具、特效，或向 AI 提问"
        icon="magnifyingglass"
        onClick={() => openModal("search")}
      />
      <RailButton
        label="撤销"
        icon="arrow.uturn.backward"
        onClick={() => void undo()}
      />
      <RailButton
        label="重做"
        icon="arrow.uturn.forward"
        onClick={() => void redo()}
      />

      <div className="my-1.5 h-px w-6 bg-border" />

      <RailButton
        label="操作历史"
        icon="clock"
        onClick={() => openModal("history")}
        active={activeModal === "history"}
      />
      <RailButton
        label="关键帧编辑器"
        icon="diamond"
        onClick={toggleKeyframeEditor}
        active={keyframeEditorOpen}
      />
      <RailButton
        label="音频混音台"
        icon="music.note"
        onClick={() => togglePanel("audioMixer")}
        active={Boolean(panels.audioMixer?.visible)}
      />
      <RailButton
        label="AI 编辑对话"
        icon="bubble.left.and.text.bubble.right"
        onClick={() => togglePanel("agentChat")}
        active={Boolean(panels.agentChat?.visible)}
      />
      <RailButton
        label="项目 JSON / 评论"
        icon="curlybraces"
        onClick={() => openModal("scriptView")}
      />

      <div className="flex-1" />

      <Tooltip content={themeActionLabel} placement="end">
        <IconButton
          label={themeActionLabel}
          icon={themeIcon}
          size="sm"
          variant="secondary"
          onClick={toggleTheme}
        />
      </Tooltip>

      <DropdownMenu
        placement="end"
        button={{
          label: "更多编辑器操作",
          icon: <Icon name="star" size={16} ariaHidden />,
          size: "sm",
          variant: "ghost",
          isIconOnly: true,
        }}
        hasChevron={false}
        menuWidth={224}
        items={[
          {
            label: "设置与 API 密钥",
            icon: <Settings size={14} aria-hidden />,
            onClick: () => openSettings(),
          },
          {
            label: "屏幕录制",
            icon: (
              <Circle
                size={14}
                className="fill-current text-status-error"
                aria-hidden
              />
            ),
            onClick: () => openModal("recorder"),
          },
          { type: "divider" },
          {
            label: "编辑器新手引导",
            icon: <Play size={14} aria-hidden />,
            onClick: () => {
              localStorage.removeItem(ONBOARDING_KEY);
              startTour();
            },
          },
          {
            label: "动画与特效引导",
            icon: <Sparkles size={14} className="text-accent" aria-hidden />,
            onClick: () => {
              localStorage.removeItem(MOGRAPH_TOUR_KEY);
              startMoGraphTour();
            },
          },
          { type: "divider" },
          {
            label: "帮助与快捷键（按 ?）",
            icon: <HelpCircle size={14} aria-hidden />,
            isDisabled: true,
          },
          {
            label: "项目 JSON",
            icon: <FileCode size={14} aria-hidden />,
            isDisabled: true,
          },
          {
            label: "按 Cmd+K 搜索",
            icon: <Command size={14} aria-hidden />,
            isDisabled: true,
          },
        ]}
      />
    </nav>
  );
};
