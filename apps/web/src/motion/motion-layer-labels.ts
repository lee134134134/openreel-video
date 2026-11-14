export interface MotionLayerLabelColor {
  readonly name: string;
  readonly color: string;
}

/** AE-inspired, contrast-safe organizational colors for Motion layer labels. */
export const MOTION_LAYER_LABEL_COLORS: readonly MotionLayerLabelColor[] = [
  { name: "红色", color: "#ef6a6a" },
  { name: "橙色", color: "#ed9b4c" },
  { name: "黄色", color: "#d9bd4a" },
  { name: "绿色", color: "#5fba7d" },
  { name: "青色", color: "#36b8ad" },
  { name: "蓝色", color: "#5d91d8" },
  { name: "靛蓝", color: "#7776d8" },
  { name: "紫色", color: "#a773d1" },
  { name: "粉色", color: "#dc77a5" },
  { name: "棕色", color: "#a77a62" },
  { name: "石板灰", color: "#7d8b9e" },
  { name: "白色", color: "#cbd2dc" },
] as const;
