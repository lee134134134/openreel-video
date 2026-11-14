export interface MoGraphTourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  tips?: string[];
  position: "center" | "top" | "bottom" | "left" | "right";
  action?: "highlight" | "demo";
}

export const MOGRAPH_TOUR_STEPS: MoGraphTourStep[] = [
  {
    id: "intro",
    target: null,
    title: "Motion 动效与动画",
    description:
      "快速了解当前的动画工具：检查器中的关键帧、时间线中的时序控制，以及左侧操作栏的动效场景。",
    position: "center",
  },
  {
    id: "keyframes-inspector",
    target: "[data-tour='inspector']",
    title: "关键帧动画",
    description:
      "选中一个片段，在检查器中打开它的动画控制。添加关键帧即可为位置、缩放、旋转、不透明度等制作动画。",
    tips: [
      "点击菱形图标可在当前时间添加关键帧",
      "每个属性都可以有自己独立的动画曲线",
      "内置 30 多种缓动预设，让运动更平滑",
    ],
    position: "left",
  },
  {
    id: "keyframes-timeline",
    target: "[data-tour='timeline']",
    title: "时间线关键帧视图",
    description:
      "下方的时间线用于展示动画时序。展开轨道并拖动关键帧菱形即可调整时间。",
    tips: [
      "菱形标记显示关键帧位置",
      "水平拖动可调整时间",
      "点击关键帧之间的曲线可编辑缓动",
    ],
    position: "top",
  },
  {
    id: "keyframe-editor",
    target: "[data-tour='toolbar']",
    title: "曲线编辑器",
    description:
      "使用最左侧的操作栏打开动画工具，包括用于精确控制曲线的关键帧编辑器。",
    tips: [
      "拖动关键帧点可调整时间和数值",
      "按住 Shift 点击可选中多个关键帧",
      "可为选中的关键帧应用缓动预设",
    ],
    position: "bottom",
  },
  {
    id: "motion-path",
    target: "[data-tour='preview']",
    title: "运动路径",
    description:
      "沿自定义路径创建平滑移动。启用运动路径模式后，可直接在预览画布上绘制贝塞尔曲线。",
    tips: [
      "点击画布可添加路径点",
      "拖动控制手柄可弯曲路径",
      "元素动画时会沿路径运动",
      "非常适合飞入的 Logo 和动态文字",
    ],
    position: "left",
  },
  {
    id: "particle-effects",
    target: "[data-tour='inspector']",
    title: "粒子特效",
    description:
      "添加电影感的粒子特效，如彩带、星光、灰尘和爆炸。可在检查器的「粒子特效」分区中找到。",
    tips: [
      "可选择预设特效或自定义",
      "调整粒子数量、速度和颜色",
      "设置特效出现的时间",
      "配合关键帧可做出戏剧性的揭示效果",
    ],
    position: "left",
  },
  {
    id: "emphasis-animations",
    target: "[data-tour='inspector']",
    title: "强调动画",
    description:
      "用引人注目的动画让元素突出显示。脉冲、弹跳、抖动、摇摆等，非常适合强调重要内容。",
    tips: [
      "内置 24 种强调预设",
      "可设置时长和循环次数",
      "可与入场/出场动画组合使用",
    ],
    position: "left",
  },
  {
    id: "text-animations",
    target: "[data-tour='inspector']",
    title: "文字动画预设",
    description:
      "使用专业预设为文字制作动画。字符可以淡入、滑动、弹跳，或以打字机效果出现。",
    tips: [
      "提供 25 种文字动画样式",
      "支持逐字符或逐词动画",
      "可自定义时序和缓动",
    ],
    position: "left",
  },
  {
    id: "complete",
    target: null,
    title: "开始做动画吧！",
    description:
      "你已经可以开始制作专业的动态图形了。选中一个片段，开始尝试关键帧和效果吧。",
    tips: [
      "按 K 可在播放头处添加关键帧",
      "按 ? 可查看所有快捷键",
      "组合使用效果可创造独特动画",
    ],
    position: "center",
  },
];

export const MOGRAPH_TOUR_KEY = "openreel-mograph-tour-complete";
