// Adapted from @paper-design/shaders (https://github.com/paper-design/shaders), Apache-2.0.
import {
  ShaderFitOptions,
  defaultObjectSizing,
  defaultPatternSizing,
  colorPanelsFragmentShader,
  ditheringFragmentShader,
  dotGridFragmentShader,
  dotOrbitFragmentShader,
  flutedGlassFragmentShader,
  gemSmokeFragmentShader,
  godRaysFragmentShader,
  grainGradientFragmentShader,
  halftoneCmykFragmentShader,
  halftoneDotsFragmentShader,
  heatmapFragmentShader,
  imageDitheringFragmentShader,
  liquidMetalFragmentShader,
  meshGradientFragmentShader,
  metaballsFragmentShader,
  neuroNoiseFragmentShader,
  paperTextureFragmentShader,
  perlinNoiseFragmentShader,
  pulsingBorderFragmentShader,
  simplexNoiseFragmentShader,
  smokeRingFragmentShader,
  spiralFragmentShader,
  staticMeshGradientFragmentShader,
  staticRadialGradientFragmentShader,
  swirlFragmentShader,
  voronoiFragmentShader,
  warpFragmentShader,
  waterFragmentShader,
  wavesFragmentShader,
} from "@paper-design/shaders";
import type { MotionShaderColorArrayParams, MotionShaderDef, MotionShaderParamDef } from "./types";

export const PAPER_VERTEX_SHADER = `#version 300 es
precision mediump float;

layout(location = 0) in vec4 a_position;

uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_imageAspectRatio;
uniform float u_originX;
uniform float u_originY;
uniform float u_worldWidth;
uniform float u_worldHeight;
uniform float u_fit;
uniform float u_scale;
uniform float u_rotation;
uniform float u_offsetX;
uniform float u_offsetY;

out vec2 v_objectUV;
out vec2 v_objectBoxSize;
out vec2 v_responsiveUV;
out vec2 v_responsiveBoxGivenSize;
out vec2 v_patternUV;
out vec2 v_patternBoxSize;
out vec2 v_imageUV;

vec3 getBoxSize(float boxRatio, vec2 givenBoxSize) {
  vec2 box = vec2(0.);
  box.x = boxRatio * min(givenBoxSize.x / boxRatio, givenBoxSize.y);
  float noFitBoxWidth = box.x;
  if (u_fit == 1.) {
    box.x = boxRatio * min(u_resolution.x / boxRatio, u_resolution.y);
  } else if (u_fit == 2.) {
    box.x = boxRatio * max(u_resolution.x / boxRatio, u_resolution.y);
  }
  box.y = box.x / boxRatio;
  return vec3(box, noFitBoxWidth);
}

void main() {
  gl_Position = a_position;

  vec2 uv = gl_Position.xy * .5;
  vec2 boxOrigin = vec2(.5 - u_originX, u_originY - .5);
  vec2 givenBoxSize = vec2(u_worldWidth, u_worldHeight);
  givenBoxSize = max(givenBoxSize, vec2(1.)) * u_pixelRatio;
  float r = u_rotation * 3.14159265358979323846 / 180.;
  mat2 graphicRotation = mat2(cos(r), sin(r), -sin(r), cos(r));
  vec2 graphicOffset = vec2(-u_offsetX, u_offsetY);

  float fixedRatio = 1.;
  vec2 fixedRatioBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );

  v_objectBoxSize = getBoxSize(fixedRatio, fixedRatioBoxGivenSize).xy;
  vec2 objectWorldScale = u_resolution.xy / v_objectBoxSize;

  v_objectUV = uv;
  v_objectUV *= objectWorldScale;
  v_objectUV += boxOrigin * (objectWorldScale - 1.);
  v_objectUV += graphicOffset;
  v_objectUV /= u_scale;
  v_objectUV = graphicRotation * v_objectUV;

  v_responsiveBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  float responsiveRatio = v_responsiveBoxGivenSize.x / v_responsiveBoxGivenSize.y;
  vec2 responsiveBoxSize = getBoxSize(responsiveRatio, v_responsiveBoxGivenSize).xy;
  vec2 responsiveBoxScale = u_resolution.xy / responsiveBoxSize;

  #ifdef ADD_HELPERS
  v_responsiveHelperBox = uv;
  v_responsiveHelperBox *= responsiveBoxScale;
  v_responsiveHelperBox += boxOrigin * (responsiveBoxScale - 1.);
  #endif

  v_responsiveUV = uv;
  v_responsiveUV *= responsiveBoxScale;
  v_responsiveUV += boxOrigin * (responsiveBoxScale - 1.);
  v_responsiveUV += graphicOffset;
  v_responsiveUV /= u_scale;
  v_responsiveUV.x *= responsiveRatio;
  v_responsiveUV = graphicRotation * v_responsiveUV;
  v_responsiveUV.x /= responsiveRatio;

  float patternBoxRatio = givenBoxSize.x / givenBoxSize.y;
  vec2 patternBoxGivenSize = vec2(
  (u_worldWidth == 0.) ? u_resolution.x : givenBoxSize.x,
  (u_worldHeight == 0.) ? u_resolution.y : givenBoxSize.y
  );
  patternBoxRatio = patternBoxGivenSize.x / patternBoxGivenSize.y;

  vec3 boxSizeData = getBoxSize(patternBoxRatio, patternBoxGivenSize);
  v_patternBoxSize = boxSizeData.xy;
  float patternBoxNoFitBoxWidth = boxSizeData.z;
  vec2 patternBoxScale = u_resolution.xy / v_patternBoxSize;

  v_patternUV = uv;
  v_patternUV += graphicOffset / patternBoxScale;
  v_patternUV += boxOrigin;
  v_patternUV -= boxOrigin / patternBoxScale;
  v_patternUV *= u_resolution.xy;
  v_patternUV /= u_pixelRatio;
  if (u_fit > 0.) {
    v_patternUV *= (patternBoxNoFitBoxWidth / v_patternBoxSize.x);
  }
  v_patternUV /= u_scale;
  v_patternUV = graphicRotation * v_patternUV;
  v_patternUV += boxOrigin / patternBoxScale;
  v_patternUV -= boxOrigin;
  v_patternUV *= .01;

  vec2 imageBoxSize;
  if (u_fit == 1.) {
    imageBoxSize.x = min(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else if (u_fit == 2.) {
    imageBoxSize.x = max(u_resolution.x / u_imageAspectRatio, u_resolution.y) * u_imageAspectRatio;
  } else {
    imageBoxSize.x = min(10.0, 10.0 / u_imageAspectRatio * u_imageAspectRatio);
  }
  imageBoxSize.y = imageBoxSize.x / u_imageAspectRatio;
  vec2 imageBoxScale = u_resolution.xy / imageBoxSize;

  v_imageUV = uv;
  v_imageUV *= imageBoxScale;
  v_imageUV += boxOrigin * (imageBoxScale - 1.);
  v_imageUV += graphicOffset;
  v_imageUV /= u_scale;
  v_imageUV.x *= u_imageAspectRatio;
  v_imageUV = graphicRotation * v_imageUV;
  v_imageUV.x /= u_imageAspectRatio;

  v_imageUV += .5;
  v_imageUV.y = 1. - v_imageUV.y;
}
`;

interface Sizing {
  readonly fit: keyof typeof ShaderFitOptions;
  readonly scale: number;
  readonly rotation: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly originX: number;
  readonly originY: number;
  readonly worldWidth: number;
  readonly worldHeight: number;
}

function sizingUniforms(sizing: Sizing, imageAspectRatio: number): Readonly<Record<string, number>> {
  return {
    u_pixelRatio: 1,
    u_imageAspectRatio: imageAspectRatio,
    u_originX: sizing.originX,
    u_originY: sizing.originY,
    u_worldWidth: sizing.worldWidth,
    u_worldHeight: sizing.worldHeight,
    u_fit: ShaderFitOptions[sizing.fit],
    u_scale: sizing.scale,
    u_rotation: sizing.rotation,
    u_offsetX: sizing.offsetX,
    u_offsetY: sizing.offsetY,
  };
}

const PATTERN_STATIC = sizingUniforms(defaultPatternSizing, 1);
const OBJECT_STATIC = sizingUniforms(defaultObjectSizing, 1);
const IMAGE_STATIC: Readonly<Record<string, number>> = {
  ...sizingUniforms(defaultObjectSizing, 1),
  u_isImage: 1,
};

function num(
  name: string,
  label: string,
  def: number,
  min: number,
  max: number,
  step: number,
): MotionShaderParamDef {
  return { name, label, type: "number", default: def, min, max, step };
}

function color(name: string, label: string, hex: string): MotionShaderParamDef {
  return { name, label, type: "color", default: hex, min: 0, max: 1, step: 1 };
}

function colors(palette: readonly string[]): readonly MotionShaderParamDef[] {
  return palette.map((hex, index) =>
    color(`color${index + 1}`, `Color ${index + 1}`, hex),
  );
}

function colorArray(uniform: string, countUniform: string, max: number): MotionShaderColorArrayParams {
  return { uniform, countUniform, max };
}

interface PaperEntry {
  readonly id: string;
  readonly name: string;
  readonly category: "fill" | "effect";
  readonly glsl: string;
  readonly staticUniforms: Readonly<Record<string, number>>;
  readonly params: readonly MotionShaderParamDef[];
  readonly colorArrayParams?: MotionShaderColorArrayParams;
  readonly needsNoiseTexture?: string;
  readonly inputUniform?: string;
}

const NOISE = "u_noiseTexture";
const IMAGE = "u_image";
const COLORS = colorArray("u_colors", "u_colorsCount", 10);

const ENTRIES: readonly PaperEntry[] = [
  {
    id: "paper-mesh-gradient",
    name: "网格渐变",
    category: "fill",
    glsl: meshGradientFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#e0eaff", "#241d9a", "#f75092", "#9f50d3"]),
      num("distortion", "扭曲度", 0.8, 0, 1, 0.01),
      num("swirl", "漩涡", 0.6, 0, 1, 0.01),
      num("grainOverlay", "颗粒", 0, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-static-mesh-gradient",
    name: "静态网格渐变",
    category: "fill",
    glsl: staticMeshGradientFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#ffad0a", "#6200ff", "#e2a3ff", "#ff99fd"]),
      num("positions", "位置", 3, 0, 8, 0.1),
      num("waveX", "波形 X", 0.5, 0, 1, 0.01),
      num("waveY", "波形 Y", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-static-radial-gradient",
    name: "静态径向渐变",
    category: "fill",
    glsl: staticRadialGradientFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#00bbff", "#00ffe1", "#ffffff"]),
      color("colorBack", "背景", "#000000"),
      num("radius", "半径", 0.5, 0, 2, 0.01),
      num("falloff", "衰减", 0, -1, 1, 0.01),
      num("mixing", "混合", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-smoke-ring",
    name: "烟圈",
    category: "fill",
    glsl: smokeRingFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#ffffff", "#ffca0a", "#fc6203"]),
      color("colorBack", "背景", "#000000"),
      num("radius", "半径", 0.5, 0, 1, 0.01),
      num("thickness", "粗细", 0.5, 0, 1, 0.01),
      num("noiseScale", "噪声缩放", 1.6, 0, 4, 0.01),
    ],
  },
  {
    id: "paper-neuro-noise",
    name: "神经噪声",
    category: "fill",
    glsl: neuroNoiseFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "前景", "#ffffff"),
      color("colorMid", "中间调", "#47a6ff"),
      color("colorBack", "背景", "#000000"),
      num("brightness", "亮度", 1.3, 0, 3, 0.01),
      num("contrast", "对比度", 1, 0, 3, 0.01),
    ],
  },
  {
    id: "paper-metaballs",
    name: "变形球",
    category: "fill",
    glsl: metaballsFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 8),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#6e33cc", "#ff5500", "#ffc105"]),
      color("colorBack", "背景", "#000000"),
      num("count", "数量", 6, 1, 8, 1),
      num("size", "大小", 1, 0, 1, 0.01),
      num("sizeRange", "大小范围", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-god-rays",
    name: "体积光",
    category: "fill",
    glsl: godRaysFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 5),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#a600ff", "#6200ff", "#33fff5"]),
      color("colorBack", "背景", "#000000"),
      num("intensity", "强度", 1, 0, 2, 0.01),
      num("density", "密度", 0.4, 0, 1, 0.01),
      num("spotty", "斑点", 0.3, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-spiral",
    name: "螺旋",
    category: "fill",
    glsl: spiralFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "前景", "#79d1ff"),
      color("colorBack", "背景", "#001429"),
      num("density", "密度", 0.5, 0, 1, 0.01),
      num("distortion", "扭曲度", 0.2, 0, 1, 0.01),
      num("strokeWidth", "描边宽度", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-swirl",
    name: "漩涡",
    category: "fill",
    glsl: swirlFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#ffd1d1", "#ff8a8a", "#660000"]),
      color("colorBack", "背景", "#330000"),
      num("bandCount", "条带", 4, 1, 12, 1),
      num("twist", "扭转", 0.3, 0, 1, 0.01),
      num("proportion", "比例", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-warp",
    name: "扭曲",
    category: "fill",
    glsl: warpFragmentShader,
    staticUniforms: PATTERN_STATIC,
    colorArrayParams: COLORS,
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#121212", "#9470ff", "#8838ff"]),
      num("proportion", "比例", 0.5, 0, 1, 0.01),
      num("distortion", "扭曲度", 0.25, 0, 1, 0.01),
      num("swirl", "漩涡", 0.8, 0, 1, 0.01),
      num("softness", "柔化", 1, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-voronoi",
    name: "Voronoi 噪声",
    category: "fill",
    glsl: voronoiFragmentShader,
    staticUniforms: PATTERN_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 5),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#ff8247", "#ffe53d", "#83c9fb"]),
      color("colorGap", "间隙", "#2e0000"),
      num("scale", "缩放", 1, 0.1, 4, 0.01),
      num("distortion", "扭曲度", 0.3, 0, 1, 0.01),
      num("gap", "间隙宽度", 0.05, 0, 0.5, 0.01),
    ],
  },
  {
    id: "paper-simplex-noise",
    name: "Simplex 噪声",
    category: "fill",
    glsl: simplexNoiseFragmentShader,
    staticUniforms: PATTERN_STATIC,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#4449cf", "#ffd1e0", "#f94446"]),
      num("scale", "缩放", 1, 0.1, 4, 0.01),
      num("softness", "柔化", 0.5, 0, 1, 0.01),
      num("stepsPerColor", "步数", 1, 1, 8, 1),
    ],
  },
  {
    id: "paper-perlin-noise",
    name: "Perlin 噪声",
    category: "fill",
    glsl: perlinNoiseFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "前景", "#fccff7"),
      color("colorBack", "背景", "#632ad5"),
      num("proportion", "比例", 0.5, 0, 1, 0.01),
      num("softness", "柔化", 0.5, 0, 1, 0.01),
      num("octaveCount", "倍频", 2, 1, 8, 1),
    ],
  },
  {
    id: "paper-grain-gradient",
    name: "颗粒渐变",
    category: "fill",
    glsl: grainGradientFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 7),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#7300ff", "#eba8ff", "#00bfff"]),
      color("colorBack", "背景", "#000000"),
      num("softness", "柔化", 0.5, 0, 1, 0.01),
      num("intensity", "颗粒", 0.5, 0, 1, 0.01),
      num("noise", "噪声", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-pulsing-border",
    name: "脉冲边框",
    category: "fill",
    glsl: pulsingBorderFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 5),
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#0dc1fd", "#d915ef", "#ff3f2e"]),
      color("colorBack", "背景", "#000000"),
      num("thickness", "粗细", 0.1, 0, 1, 0.01),
      num("intensity", "强度", 0.5, 0, 1, 0.01),
      num("pulse", "脉冲", 0, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-dot-orbit",
    name: "圆点轨道",
    category: "fill",
    glsl: dotOrbitFragmentShader,
    staticUniforms: PATTERN_STATIC,
    colorArrayParams: COLORS,
    needsNoiseTexture: NOISE,
    params: [
      ...colors(["#ffc96b", "#ff6200", "#ff2f00"]),
      color("colorBack", "背景", "#000000"),
      num("size", "大小", 0.5, 0, 1, 0.01),
      num("sizeRange", "大小范围", 0.5, 0, 1, 0.01),
      num("spreading", "扩散", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-dot-grid",
    name: "点阵网格",
    category: "fill",
    glsl: dotGridFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFill", "填充", "#ffffff"),
      color("colorBack", "背景", "#000000"),
      num("dotSize", "点大小", 2, 0.5, 20, 0.1),
      num("gapX", "间隙 X", 32, 4, 128, 1),
      num("gapY", "间隙 Y", 32, 4, 128, 1),
    ],
  },
  {
    id: "paper-waves",
    name: "波浪",
    category: "fill",
    glsl: wavesFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "前景", "#ffbb00"),
      color("colorBack", "背景", "#000000"),
      num("amplitude", "幅度", 0.5, 0, 1, 0.01),
      num("frequency", "频率", 0.5, 0, 1, 0.01),
      num("spacing", "间距", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-color-panels",
    name: "色板",
    category: "fill",
    glsl: colorPanelsFragmentShader,
    staticUniforms: OBJECT_STATIC,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 7),
    params: [
      ...colors(["#ff9d00", "#fd4f30", "#809bff"]),
      color("colorBack", "背景", "#000000"),
      num("density", "密度", 0.5, 0, 1, 0.01),
      num("angle1", "Angle 1", 0, -1, 1, 0.01),
      num("blur", "模糊", 0.2, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-dithering",
    name: "抖动",
    category: "fill",
    glsl: ditheringFragmentShader,
    staticUniforms: PATTERN_STATIC,
    params: [
      color("colorFront", "前景", "#00b2ff"),
      color("colorBack", "背景", "#000000"),
      num("pxSize", "像素大小", 2, 1, 16, 0.5),
      num("shape", "形状", 1, 0, 3, 1),
      num("type", "类型", 1, 0, 4, 1),
    ],
  },
  {
    id: "paper-water",
    name: "水波",
    category: "effect",
    glsl: waterFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      color("colorHighlight", "高光", "#ffffff"),
      num("size", "大小", 0.5, 0, 1, 0.01),
      num("waves", "波浪", 0.5, 0, 1, 0.01),
      num("highlights", "高光", 0.5, 0, 1, 0.01),
      num("caustic", "焦散", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-paper-texture",
    name: "纸张纹理",
    category: "effect",
    glsl: paperTextureFragmentShader,
    staticUniforms: {
      ...IMAGE_STATIC,
      u_contrast: 0.3,
      u_fiberSize: 0.2,
      u_crumpleSize: 0.35,
      u_foldCount: 5,
      u_drops: 0.2,
      u_seed: 5.8,
    },
    inputUniform: IMAGE,
    needsNoiseTexture: NOISE,
    params: [
      color("colorFront", "纹理颜色", "#9fadbc"),
      color("colorBack", "纸色", "#ffffff"),
      num("roughness", "粗糙度", 0.4, 0, 1, 0.01),
      num("crumples", "褶皱", 0.3, 0, 1, 0.01),
      num("folds", "折叠", 0.65, 0, 1, 0.01),
      num("fiber", "纤维", 0.3, 0, 1, 0.01),
      num("fade", "淡化", 0, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-fluted-glass",
    name: "竖纹玻璃",
    category: "effect",
    glsl: flutedGlassFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      num("size", "大小", 0.5, 0, 1, 0.01),
      num("distortion", "扭曲度", 0.5, 0, 1, 0.01),
      num("shift", "偏移", 0.5, 0, 1, 0.01),
      num("blur", "模糊", 0.2, 0, 1, 0.01),
      num("highlights", "高光", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-image-dithering",
    name: "图像抖动",
    category: "effect",
    glsl: imageDitheringFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      color("colorFront", "前景", "#94ffaf"),
      color("colorBack", "背景", "#000c38"),
      num("pxSize", "像素大小", 2, 1, 16, 0.5),
      num("type", "类型", 1, 0, 4, 1),
      num("colorSteps", "色阶数", 2, 1, 8, 1),
    ],
  },
  {
    id: "paper-halftone-dots",
    name: "半调网点",
    category: "effect",
    glsl: halftoneDotsFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      color("colorFront", "前景", "#2b2b2b"),
      color("colorBack", "背景", "#f2f1e8"),
      num("size", "大小", 0.5, 0, 1, 0.01),
      num("radius", "半径", 0.5, 0, 1, 0.01),
      num("contrast", "对比度", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-halftone-cmyk",
    name: "半调 CMYK",
    category: "effect",
    glsl: halftoneCmykFragmentShader,
    staticUniforms: {
      ...IMAGE_STATIC,
      u_type: 1,
      u_grainSize: 0.5,
      u_grainMixer: 0,
      u_grainOverlay: 0,
      u_gridNoise: 0.2,
      u_floodC: 0.15,
      u_floodM: 0,
      u_floodY: 0,
      u_floodK: 0,
      u_gainC: 0.3,
      u_gainM: 0,
      u_gainY: 0.2,
      u_gainK: 0,
    },
    inputUniform: IMAGE,
    needsNoiseTexture: NOISE,
    params: [
      color("colorBack", "纸张", "#fbfaf5"),
      color("colorC", "青", "#00b4ff"),
      color("colorM", "洋红", "#fc519f"),
      color("colorY", "黄", "#ffd800"),
      color("colorK", "键控", "#231f20"),
      num("size", "大小", 0.2, 0, 1, 0.01),
      num("contrast", "对比度", 1, 0, 1, 0.01),
      num("softness", "柔化", 1, 0, 1, 0.01),
      num("minDot", "最小点径", 0.1, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-heatmap",
    name: "热力图",
    category: "effect",
    glsl: heatmapFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    colorArrayParams: COLORS,
    params: [
      ...colors(["#11206a", "#6bd7ff", "#ff4c00"]),
      num("contour", "等高线", 0.5, 0, 1, 0.01),
      num("innerGlow", "内辉光", 0.5, 0, 1, 0.01),
      num("outerGlow", "外辉光", 0.5, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-liquid-metal",
    name: "液态金属",
    category: "effect",
    glsl: liquidMetalFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    params: [
      color("colorTint", "色调", "#ffffff"),
      num("repetition", "重复", 3, 1, 8, 1),
      num("softness", "柔化", 0.5, 0, 1, 0.01),
      num("shiftRed", "红色偏移", 0.3, 0, 1, 0.01),
      num("distortion", "扭曲度", 0.2, 0, 1, 0.01),
    ],
  },
  {
    id: "paper-gem-smoke",
    name: "宝石烟雾",
    category: "effect",
    glsl: gemSmokeFragmentShader,
    staticUniforms: IMAGE_STATIC,
    inputUniform: IMAGE,
    colorArrayParams: colorArray("u_colors", "u_colorsCount", 6),
    params: [
      ...colors(["#333333", "#e7e6df", "#fafaf5"]),
      num("size", "大小", 0.5, 0, 1, 0.01),
      num("innerGlow", "内辉光", 0.5, 0, 1, 0.01),
      num("outerGlow", "外辉光", 0.5, 0, 1, 0.01),
    ],
  },
];

export const PAPER_SMOKE_EXCLUSIONS: readonly string[] = [];

const EXCLUDED = new Set(PAPER_SMOKE_EXCLUSIONS);

export const PAPER_SHADER_DEFS: readonly MotionShaderDef[] = ENTRIES.filter(
  (entry) => !EXCLUDED.has(entry.id),
).map((entry) => ({
  id: entry.id,
  name: entry.name,
  category: entry.category,
  glsl: entry.glsl,
  params: entry.params,
  origin: "builtin",
  collection: "Paper",
  vertexShader: PAPER_VERTEX_SHADER,
  staticUniforms: entry.staticUniforms,
  ...(entry.colorArrayParams ? { colorArrayParams: entry.colorArrayParams } : {}),
  ...(entry.needsNoiseTexture ? { needsNoiseTexture: entry.needsNoiseTexture } : {}),
  ...(entry.inputUniform ? { inputUniform: entry.inputUniform } : {}),
}));
