# 本地完整栈：编辑器 + AI 服务端 + 配音

本仓库在 OpenReel 编辑器之上加了一整套本地 AI 生产能力（AI Studio 对话、分镜成片、配音、
发布）。这份文档讲清楚**怎样把这一整套在本机跑起来**、每个能力依赖什么配置、以及出问题时
先看哪里。接口契约见 [server-api.md](./server-api.md)，配音服务的细节见
`services/cosyvoice/README.md` 与 `services/edge-tts/README.md`。

## 组成与端口

| 进程 | 位置 | 默认地址 | 作用 |
|---|---|---|---|
| Web 编辑器 | `apps/web`（Vite） | http://localhost:5173（`start.sh` 用 5174） | 时间线编辑器 + 右侧 AI Studio 面板 |
| API 服务端 | `apps/server`（NestJS） | http://localhost:4000/api | LLM 对话/工具、分镜与成片、TTS 调度、FFmpeg 渲染队列、发布连接器、插件运行时、SQLite |
| CosyVoice 本地配音 | `services/cosyvoice`（Python/FastAPI） | http://127.0.0.1:8766 | 开源情绪配音，可 zero-shot 克隆音色（可选） |
| Edge TTS 客户端 | `services/edge-tts` | 无端口 | 调用微软在线神经语音的纯 Python 客户端（可选，联网） |
| FFmpeg / ffprobe | 系统或 `FFMPEG_PATH` | — | 合成、转码、字幕、探时长（**必需**） |

数据默认落在 `~/.openreel/server`：`openreel-server.db`（SQLite）、`uploads/`（上传与单独合成的音频）、
`jobs/`（成片与渲染产物）。成片通过 `/api/files/jobs/<id>.mp4` 提供给编辑器。

## 依赖

- Node.js ≥ 22.13（服务端用内置 `node:sqlite`，22.13 起不再需要 `--experimental-sqlite`；
  仓库声明 `packageManager: pnpm@11.7.0`，版本不匹配时 pnpm 会报
  `ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE`，用 `corepack enable && corepack prepare pnpm@11.7.0 --activate` 对齐）
- FFmpeg（含 `ffprobe`）。想要字幕烧录效果，构建需带 libfreetype（drawtext）或 libass；
  两者都没有时渲染仍会成功，只是跳过字幕。
- 可选：Python 3.10+（Edge TTS / CosyVoice）；CosyVoice 首次安装会下载模型，需数 GB 磁盘。

## 快速开始

```bash
# 1) 安装依赖并准备 WASM
pnpm install
pnpm build:wasm

# 2) 服务端配置（至少填一个 LLM Key；不填则分镜走离线兜底方案）
cp apps/server/.env.example apps/server/.env
$EDITOR apps/server/.env

# 3) 一键启动：CosyVoice（若已安装）→ API 服务端 → Web
bash start.sh
```

打开 http://localhost:5174，右上角进入 **AI Studio**。面板顶部的圆点变绿表示已连上
`http://localhost:4000`；点齿轮可改服务器地址（保存在浏览器 localStorage）。

## 手动启动（推荐用于排查）

三个进程分别启动，日志互不干扰：

```bash
# 终端 1：API 服务端（dotenv 读取 apps/server/.env，必须在该目录下运行）
pnpm --filter @openreel/server dev

# 终端 2：Web 编辑器
pnpm dev            # 或 pnpm --filter @openreel/web dev --port 5173

# 终端 3（可选）：CosyVoice
cd services/cosyvoice && ./venv/bin/python serve.py
```

注意：`apps/server/.env` 只在工作目录为 `apps/server` 时被 `dotenv` 读取。用
`node apps/server/dist/main.js` 从仓库根启动时，环境变量需要由 shell 提供。

## 服务端最小配置

`apps/server/.env` 里真正决定"能不能用"的只有几组：

```ini
# 跨域：必须包含编辑器实际地址（默认只放行 5173）
OPENREEL_CORS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174

# LLM（分镜脚本、AI 改片、场景插画）
OPENCODE_BASE_URL=https://opencode.ai/inference/go/openai/v1
OPENCODE_API_KEY=...
OPENCODE_MODEL=deepseek-v4.1-flash

# FFmpeg
FFMPEG_PATH=ffmpeg
```

其余配置按需打开，完整清单以 `.env.example` 为准：

| 能力 | 变量 | 不配置时的行为 |
|---|---|---|
| 限额自动切换 | `OPENCODE_FALLBACK_API_KEY` 等 | 主账户 401/402/429 时直接报错 |
| 图片生成 | `IMAGE_BASE_URL` / `IMAGE_API_KEY` / `IMAGE_MODEL` | 用 LLM 生成 SVG 插画；仍失败则用带字幕的占位卡 |
| Azure 配音 | `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` | 回退到 CosyVoice / Edge / macOS 语音 |
| 发布 | 插件中心填凭据，或 `OPENREEL_PLUGIN_<ID>_<KEY>` | 连接器显示"未配置" |

## 配音（TTS）如何选择

优先级从高到低，**第一个满足条件的适配器**成为默认：

| 顺序 | 适配器 | 启用条件 | 说明 |
|---|---|---|---|
| 1 | `elevenlabs` | `ELEVENLABS_API_KEY` | 云端，音色多，按量计费 |
| 2 | `openai-tts` | `OPENAI_API_KEY`（可配合 `OPENAI_TTS_BASE_URL`） | 云端，OpenAI 兼容 `/audio/speech` |
| 3 | `azure-tts` | `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` | 官方神经音色 + 情绪风格，F0 免费层每月 50 万字符 |
| 4 | `cosyvoice-tts` | 启动时 `COSYVOICE_URL`（默认 8766）可访问 | 本地开源、免费、支持情绪指令与音色克隆 |
| 5 | `edge-tts` | `services/edge-tts` 的 venv 存在（缺失时会自动安装） | 免费、联网、无需 Key |
| 6 | `macos-say` | macOS 且存在 `/usr/bin/say` | 完全离线兜底，音质一般 |
| 7 | `mock` | 始终注册 | 合成提示音，用于纯离线冒烟 |

要点：

- **CosyVoice 是否注册在服务端启动时决定**。先启动 CosyVoice，再启动/重启 API 服务端，
  否则它会一直用 Edge TTS。`curl http://127.0.0.1:8766/health` 可确认服务在线。
- CosyVoice 默认走"沉稳旁白"路线（`COSYVOICE_SPEED=0.95`，未给情绪时使用沉稳指令），
  `COSYVOICE_LOCK_STEADY=1` 可忽略分镜情绪、固定同一把声音。合成后默认做
  `loudnorm=I=-16` 响度归一化（`COSYVOICE_LOUDNORM=` 置空可关闭）。
- 分镜里的 `emotion` 会映射为 Azure express-as 风格或 CosyVoice 中文指令；
  显式传 `adapterId` 可绕过优先级（见 `POST /api/tts/synthesize`）。
- `GET /api/tts/adapters` 列出的是**已注册**的适配器，不代表凭据已配置。

## LLM 与限额自动切换

服务端只认 OpenAI 兼容接口。默认指向 OpenCode 网关（`/inference/go/openai/v1`）。

- `OPENCODE_MODEL` 必须是当前账户可用的模型；`GET /api/llm/models` 可列出。
  默认配置为 OpenCode Go 的 `hy4`；若该模型额度用尽（429/402），服务端会先在同一
  账户内自动降级到 `hy4-flash-free` 并保持 10 分钟，仍失败才切到备用账户。
- 主账户返回 401/402/429 时，会自动切到 `OPENCODE_FALLBACK_*` 账户（个人免费账户），
  并把默认模型替换为 `OPENCODE_FALLBACK_MODEL`；`OPENCODE_FAILOVER_RECOVERY_MS`（默认 10 分钟）
  之后回探主账户。
- 网关返回的 `Retry-After` 若超过 5 秒（例如"16 天后恢复"），服务端不会傻等，而是立即失败，
  让上层走备用账户或离线兜底。这是为了避免请求被挂死。
- 单次请求超时由 `OPENCODE_TIMEOUT_MS` 控制（默认 120000）。

## 画面与成片

分镜成片流水线：`draft → queued → running（逐场景画面+配音）→ composing（FFmpeg）→ done|failed`。

**连贯性设计**：分镜计划包含 `continuityBible`（全片视觉圣经：色调、主光、镜头语言、
人物外观、关键道具）和每场的 `beats`（2–4 个同一镜头内的连续视觉节拍）。同一场的
关键帧共用这套设定，只做渐进变化，因此合成后是一场戏内部的运动，而不是每场一张
互不相关的海报。

每个场景的画面来源按顺序尝试：

1. 配置 `VIDEO_BASE_URL` + `VIDEO_API_KEY` 时，先生成关键帧首帧，再调用图生视频（I2V）/
   文生视频（T2V）接口产出**真实动态视频片段**（配套环境变量见 `apps/server/.env.example`
   的 "Real dynamic video generation" 段）；
2. `IMAGE_BASE_URL` + `IMAGE_API_KEY` 配置的 OpenAI 兼容 `/images/generations`（按 beats
   逐张生成同一镜头的关键帧）；
3. LLM 生成的 SVG 关键帧（使用 `OPENCODE_IMAGE_MODEL`，默认跟随 `OPENCODE_MODEL`），
   一次调用按 beats 顺序产出多张同一镜头画面；
4. 带字幕的占位卡（此时任务 `warnings` 会说明原因）。

**动态画面保障**：`buildAssembleArgs` 对多关键帧场景做两件事——用 `xfade` 在同一场内部
交叉溶解相邻关键帧，并让 `zoompan` 的镜头运动跨越整场（关键帧只改变画面内容，不重置
运镜）。场景总时长保持不变，旁白/字幕时间轴不受影响。单关键帧场景仍使用推/拉/摇/移 +
柔和淡入淡出作为兜底。导演技能（`llm/skills.ts`）与分镜提示词
（`videogen/proposal.service.ts`）强制要求全片视觉圣经与连续节拍。

配音旁白会先经 `spoken-text` 归一化（去掉 Markdown、符号、镜头术语），再交给 TTS。

## 生成后质量自检（eval）

成片完成后自动运行 `VideoEvalService`，结果写入任务的 `eval` 字段并展示在成片卡片上：
- ffprobe 校验分辨率、帧率、时长、帧数、码率；
- ffmpeg `freezedetect` / `blackdetect` 统计静止与黑屏占比，专门拦截"PPT 式静态视频"；
- 可选多模态 LLM 视觉复评（默认在配置了 LLM Key 时开启，设 `VIDEO_EVAL_VISION=0` 关闭，
  `VIDEO_EVAL_VISION_MODEL` 可指定视觉模型）按抽帧给出画面质量/可观看性/动态感评分。

自检不达标时任务仍标记 `done`，但 `stage` 和 `warnings` 会给出评分与改进建议；可在卡片上点
"重新自检"，或让 AI 调用 `evaluate_videogen_job` / `revise_videogen_plan` 重新生成。

## 渲染队列

- 并发由 `OPENREEL_RENDER_CONCURRENCY` 控制（默认 1）。调大前先确认 CPU/内存与磁盘。
- 字幕：自动探测 FFmpeg 支持 `drawtext` → 用 drawtext；否则用生成的 `.ass` 走 libass；
  都不支持则跳过字幕（渲染不失败）。
- 字体：`FFMPEG_DRAWTEXT_FONT`（默认 macOS `PingFang SC`，其他 `sans`）。中文出现方块时
  先换这个变量。
- 进度可用 SSE：`GET /api/render/jobs/:id/events`。

## 发布与凭据安全

- 连接器是插件，位于 `plugins/publish-*`；在 **插件中心** 启用并填凭据，或用
  `OPENREEL_PLUGIN_<ID>_<KEY>` 环境变量兜底（优先级低于 UI 保存值）。
- 凭据写入 SQLite 时用 `OPENREEL_SECRET` 做 AES-256-GCM 加密。**修改 `OPENREEL_SECRET`
  会让已保存的凭据无法解密**，需要在插件中心重新填写；服务端日志会提示"凭据无法解密"。
- 旧版本留下的明文凭据仍可读取，下次保存时自动升级为密文。
- `OPENREEL_DISABLE_PUBLISH=1` 可整体关闭发布接口（演示或对外暴露时建议开启）。
- B 站使用站内 UPOS 接口、小红书使用 Cookie，均可能随平台调整而失效；失败原因会写入发布记录。

## 自检清单

```bash
curl -s http://localhost:4000/api/health | jq
# ok=true, ffmpeg=true, db=true, llm.keyConfigured=true

curl -s http://localhost:4000/api/tts/adapters | jq
# 至少应有 mock；配好 Key / 服务后会出现对应适配器

curl -s http://127.0.0.1:8766/health        # CosyVoice 是否在线（可选）

curl -s http://localhost:4000/api/llm/models | jq '.[0:5]'
# 网关连通性与可用模型
```

## 故障排查

| 现象 | 先检查 | 处理 |
|---|---|---|
| AI Studio 显示"无法连接服务器" | `curl /api/health`、`PORT`、`OPENREEL_CORS` | 改服务器地址（面板齿轮）或把编辑器地址加入 CORS |
| 成片卡片黑屏/"成片无法加载" | `curl -I /api/files/jobs/<id>.mp4` | 确认文件仍在 `~/.openreel/server/jobs`；服务重启后再点"重新加载" |
| 浏览器控制台报 COEP/CORP 拦截 | `/api/files/*` 响应头 | 服务端已设置 `Cross-Origin-Resource-Policy: cross-origin`，不要用反向代理把它覆盖掉 |
| 配音是"滴滴"提示音 | `GET /api/tts/adapters` | 说明只有 `mock`：装 Edge TTS（`bash services/edge-tts/setup.sh`）或配 Azure/CosyVoice，然后重启服务端 |
| CosyVoice 已启动但没被使用 | 服务端启动日志、`/api/tts/adapters` | 适配器在启动时注册：先起 CosyVoice，再重启服务端 |
| 日志出现 `429`/`402`/`401` | `OPENCODE_FALLBACK_*` | 配置备用账户，或等额度恢复；超长 `Retry-After` 会被快速失败 |
| 字幕没烧进成片 | `ffmpeg -filters \| grep -E 'drawtext\|subtitles'` | 换带 libfreetype/libass 的 FFmpeg，或设置 `FFMPEG_PATH` |
| 中文字幕显示方块 | `FFMPEG_DRAWTEXT_FONT` | 设成系统已装中文字体（如 `PingFang SC`、`Noto Sans CJK SC`） |
| 发布报"凭据无法解密" | `OPENREEL_SECRET` 是否改过 | 在插件中心重新填写该平台凭据 |
| `pnpm` 报 `ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE` | pnpm 版本 | 用 corepack 切到 `pnpm@11.7.0`，或删除自定义 pnpm 包装器 |
| 端口被占用 | `PORT`、Vite `--port` | 换端口时同步改 `OPENREEL_CORS` 与面板里的服务器地址 |
