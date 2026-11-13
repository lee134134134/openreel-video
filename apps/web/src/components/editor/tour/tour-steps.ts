export interface TourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  tips?: string[];
  position: "center" | "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    title: "欢迎使用 OpenReel",
    description:
      "当前编辑器布局速览：工具在左侧，播放居中，时间线在下方，属性在右侧。",
    position: "center",
  },
  {
    id: "assets",
    target: "[data-tour='assets']",
    title: "媒体与创作工具",
    description:
      "左侧面板随工具栏切换：从这里导入媒体、添加文字、图形、特效与转场。",
    tips: [
      "「媒体」存放导入的视频、音频与图片",
      "用左侧工具栏切换到文字、图形、特效或转场",
      "把素材从该面板拖到时间线上",
      "导入与录制控件位于该面板顶部",
    ],
    position: "right",
  },
  {
    id: "timeline",
    target: "[data-tour='timeline']",
    title: "Timeline",
    description:
      "在轨道上排布片段、修剪边缘、分割选区，并使用时间线栏右侧的缩放控件。",
    tips: [
      "按 S 分割选中的片段",
      "拖拽片段边缘进行修剪",
      "需要更多视频或音轨时使用「添加轨道」",
    ],
    position: "top",
  },
  {
    id: "preview",
    target: "[data-tour='preview']",
    title: "Player",
    description:
      "中央播放器显示当前帧和播放控件。导出前可在此裁切、适配并检查效果。",
    tips: [
      "播放控件在画布下方",
      "绿点表示实时预览已开启",
      "全屏与适配工具位于播放器控件中",
    ],
    position: "left",
  },
  {
    id: "inspector",
    target: "[data-tour='inspector']",
    title: "Inspector",
    description:
      "选中片段即可编辑其属性。变换、调色、特效、速度与动画控件都会出现在这里。",
    tips: [
      "用顶部标签页切换属性分组",
      "调色与特效针对单个片段生效",
      "支持关键帧的控件在选中片段时会显示动画选项",
    ],
    position: "left",
  },
  {
    id: "complete",
    target: null,
    title: "你已经就绪",
    description:
      "现在你知道主要工具的位置了。使用最左侧的操作栏可重新打开引导、设置与项目工具。",
    position: "center",
  },
];

export const ONBOARDING_KEY = "openreel-onboarding-complete";
