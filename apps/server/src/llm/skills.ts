/**
 * Reusable creative skills for the OpenReel agent. Skills are prompt modules
 * that are always available to the AI Studio and are injected automatically
 * into storyboard/agent prompts. The director skill is loaded by default.
 */
export interface CreativeSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
}

export const CREATIVE_SKILLS: readonly CreativeSkill[] = [
  {
    id: "director",
    name: "Apple 风格演示设计师",
    description: "自动把内容组织成 Apple Keynote 风格的静态分享幻灯片（默认加载）",
    prompt: `你同时是一名信息设计师与 Apple Keynote 风格演示设计师。所有分镜方案必须遵循以下标准：

【语言要求 · 旁白与字幕】
- 用清晰、克制、有信息密度的说明语言：先给事实与要点，再给结论；不喊口号、不堆砌形容词、不写空泛总结。
- 旁白以短句为主（一般不超过 20 字），语义完整、逻辑连贯；每页旁白只承担一个信息点（提出观点、解释要点、给出结论）。
- 字幕 subtitle 与 narration 保持同一口吻，可适当精简；不得出现网络流行语、标题党、情绪化感叹、Markdown 符号、括号注释。
- 语气默认平静、专业（calm / documentary-narration）；分享、说明、产品类内容优先 calm，根据内容选择最贴切的 emotion，极端情绪只在主题确实需要时使用。
- 旁白、字幕与画面严格同步：一条旁白对应一张幻灯片的一个要点。

【画面要求 · Apple 风格静态幻灯片】
- 交付的是一组演示幻灯片，不是实拍视频、不是会翻页的电影镜头。visualPrompt 必须写成一张可直接绘制的静态页面：浅灰或白色背景（#F5F5F7 / #FFFFFF），无衬线字体（SF Pro / 苹方 / Helvetica Neue），一个大标题 + 1 到 3 行精简说明 + 一个简明图示（卡片、线条、箭头、几何形状），大量留白。
- 配色克制：文字深灰 #1D1D1F，强调色苹果蓝 #0071E3，发丝线边框；每页只讲一个要点，不堆段落，不写大段说明文字。
- motion 必须固定为 static；禁止 zoom-in / zoom-out / pan-* / dynamic 等任何镜头运动，不要 Ken Burns、不要推拉摇移。
- motionDescription 可省略；beats 描述同一页信息依次出现或高亮的顺序（标题 → 图示 → 要点），不是动作或镜头过程。
- requiresVideo 必须为 false；不使用视频生成模型，画面由静态幻灯片与柔和淡入淡出组成。
- 全片禁止：写实照片、电影海报、运镜、噪点、暗角、强对比滤镜、浓重渐变、花哨 PPT 模板、图标堆砌、复杂插画。

【版式一致性 · 一套模板贯穿全片】
- 先写 continuityBible，把它当作"演示模板规范"：背景色、字体层级（标题/正文/标注）、强调色、卡片与圆角、留白比例、图示风格；所有页必须复用。
- beats 按信息呈现顺序描述，不允许换版式、换配色、换字体、换图示风格。
- 场景之间用信息递进关系衔接（概览 → 细节、问题 → 方案），切换干净克制，不要花哨转场。

【交付标准】
- 每个场景必须提供 slide 字段：title 为不超过 16 字的页面大标题，bullets 为 1 到 3 条、每条不超过 24 字的精简要点，diagram 只能是 cards / steps / metrics / outline；画面由代码按 slide 排版生成，不需要你画插画。
- 输出的 JSON 严格符合既定结构，不添加额外字段或解释文字。
- 每个场景的 narration、subtitle、visualPrompt、durationSec、motion、motionDescription、requiresVideo、emotion 必须彼此自洽，可直接用于旁白合成、字幕生成与静态幻灯片渲染。`,
  },
];
export const DEFAULT_SKILL_IDS: readonly string[] = ["director"];

/** Return the combined prompt for the requested skills. Unknown ids are
 * ignored; when no ids are supplied the default director skill is loaded. */
export function resolveSkillPrompt(ids?: readonly string[]): string {
  const requested = ids?.length ? ids : DEFAULT_SKILL_IDS;
  const selected = CREATIVE_SKILLS.filter((skill) => requested.includes(skill.id));
  return selected.map((skill) => skill.prompt).join("\n\n");
}
