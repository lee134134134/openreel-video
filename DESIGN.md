# Apple Design System &amp; Style Guide

## 01 — Philosophy &amp; Core Principles

- **Refined Minimalism &amp; Surgical Precision**: 追求极致的克制、留白与对齐。

- **Content is King**: UI 界面应当隐入背景，让产品、影像和内容本身说话。

- **No Decorative Gradients / Heavy Shadows**: 绝不滥用渐变和沉重的卡片阴影；深度通常通过色彩层次、微妙的背景色交替或单一精准的投影来表达。

## 02 — Color Palette (色彩系统)

采用高对比度的黑白灰基调，搭配经典的苹果蓝（Action Blue）作为交互焦点。

### Neutrals (中性色)

- `--canvas`: `#FFFFFF` (主页面背景 / 亮色卡片)

- `--surface`: `#F5F5F7` (次级容器背景 / Apple 经典浅灰衬底)

- `--ink`: `#1D1D1F` (正文 / 标题主色，近黑)

- `--ink-muted`: `#7A7A7A` (辅助文字、次要描述、页脚微型字)

- `--hairline`: `#E0E0E0` / `#D2D2D7` (精致的 1px 分割线与边框)

### Brand &amp; Interactive (品牌与交互色)

- `--primary`: `#0071E3` (主要交互、Action Blue、链接与主要按钮)

- `--primary-hover`: `#0077ED` (悬停状态)

- `--primary-active`: `#0066CC` (点击状态)

## 03 — Typography (字体规范)

使用系统原生字体栈，严格控制字重（Weight）与紧凑的负字间距（Negative Letter-Spacing）。

- **Font Family**: `-apple-system, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif`

- **Display (大标题 / 营销主标题)**: 

  - 字重: `600` (Semi-bold)

  - 特性: 大号标题通常带有负字间距（如 `-0.02em` 至 `-0.03em`），营造现代高级感。

- **Body (正文)**:

  - 字号: `17px` (Apple 经典正文大小，注重舒适的阅读节奏)

  - 字重: `400` (Regular) / 行高: `1.47` / 字间距: `-0.022em`

## 04 — Spacing &amp; Layout (间距与网格)

- **Base Grid**: 基于 `4px` / `8px` 倍数系统。

- **Container**: 桌面端最大宽度通常限制在 `980px` 至 `1080px`（针对纯正 Apple 官网排版体验），或采用流式全屏边缘留白。

- **Whitespace**: 善用大面积留白（Section 间距保持在 `40px` - `80px` 以上），避免视觉拥挤。

## 05 — Component Library (核心组件规范)

### Buttons (按钮)

- **Primary Pill Button (胶囊主按钮)**: 

  - 背景色: `--primary` (`#0071E3`)

  - 文字颜色: `#FFFFFF`

  - 圆角: `9999px` (全圆角胶囊)

  - 内边距: 垂直舒适，水平适中；通常配合 `scale(0.95)` 点击微缩反馈。

- **Secondary Ghost / Outline Button (次要按钮)**:

  - 背景: 透明或极淡的 `--surface`

  - 边框: 1px `--primary` 或 `--hairline`

  - 圆角: `9999px` 或 `8px`

### Cards &amp; Containers (卡片与容器)

- **Apple Store Style Card**:

  - 背景: `--surface` (`#F5F5F7`) 或纯白

  - 圆角: `18px` 至 `24px` 的大圆角

  - 边框: 无边框或极细的 1px `--hairline`

  - 阴影: 极其干净克制，或完全依靠色块层级（Surface Shift）来区隔空间。

## 06 — Do's &amp; Don'ts (严格遵守)

- **DO (应该)**:

  - 保持极高的留白率，文字和卡片对齐严格。

  - 使用标准的苹果蓝 `#0071E3` 处理所有互动链接和主 CTA。

  - 在大标题上使用较细的字重配合紧凑的字间距。

- **DON'T (绝对避免)**:

  - 避免使用五颜六色的渐变背景或大面积艳俗色彩。

  - 绝不使用重的、模糊的黑阴影作为默认层级表达。

  - 避免在苹果风格的界面中混用 Serif（衬线体）或非标准无衬线字体。