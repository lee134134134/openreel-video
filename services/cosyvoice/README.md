# CosyVoice 本地情绪语音服务（开源 · 免费）

Apache-2.0 开源的 CosyVoice（阿里 FunAudioLLM），**用自然语言指令控制情绪**：
「用开心的语气说这句话」「用低落伤感的语气」……配音随分镜情绪起伏，完全免费、无需账号。

## 与其他免费方案的对比

| 方案 | 情绪控制 | 费用 | 依赖 |
|---|---|---|---|
| edge-tts | ❌ 无（免费端点不支持 express-as） | 免费 | 需联网 |
| Azure F0 | ✅ 预设风格 | 免费 50 万字/月 | 需注册账号 |
| **CosyVoice（本方案）** | ✅ 自然语言自由指令 | **完全免费** | 本地算力 |

## 三种运行方式（按你的机器选择）

### 方式 A：本机运行（Intel Mac 可用，但偏慢）

你的 MacBook Pro 16,2（i5-1038NG7, 32GB）没有独立显卡，走 CPU 推理：
- 10 秒旁白大约需要 30~90 秒合成（RTF ≈ 3~9）
- 8 个场景的视频配音约 5~10 分钟，适合离线生成
- 内存占用约 4~6GB，32GB 无压力

```bash
cd services/cosyvoice
bash setup.sh          # 一次性：克隆仓库 + 装依赖 + 下载模型（约 3~4GB）
./venv/bin/python serve.py
# 验证: curl http://127.0.0.1:8766/health
```

然后**重启 OpenReel server**（`apps/server`），适配器自动切换到 CosyVoice（优先级高于 edge-tts）。

### 方式 B：免费云 GPU（快 10~50 倍，推荐）

用 Google Colab / Kaggle 的免费 GPU 跑同一个服务，本机只当客户端：

1. Colab 新建笔记本（免费 T4）：
   ```python
   !git clone https://github.com/FunAudioLLM/CosyVoice.git
   %cd CosyVoice && git submodule update --init --recursive
   !pip install -r requirements.txt fastapi uvicorn modelscope
   # 把本目录的 serve.py 上传到 /content/CosyVoice/serve.py（或直接粘贴）
   !python serve.py --host 0.0.0.0 --port 8766 &
   !pip install cloudflared
   !cloudflared tunnel --url http://127.0.0.1:8766 &
   # 输出里会给出形如 https://xxx.trycloudflare.com 的公网地址
   ```
2. 本机 `apps/server/.env` 设置：
   ```bash
   COSYVOICE_URL=https://xxx.trycloudflare.com
   ```
   重启 server 即可。适配器不变，情绪指令一样生效。

注意：Colab 免费会话最长约 12 小时，断开后需重新启动并更新 URL。

### 方式 C：局域网内其他有 NVIDIA 显卡的机器

在该机器上按方式 A 安装，然后同样设置 `COSYVOICE_URL=http://那台机器IP:8766`。
有 GPU 时 RTF ≪ 1，几乎实时。

## 情绪如何生效

- LLM 分镜时会给每个场景标注 `emotion`（cheerful/sad/gentle 等 14 种），本服务把它们映射成
  自然语言指令（如 cheerful → 「用开心愉悦的语气说这句话」）。
- `styleDegree`（0.01~2）映射为强度提示：≥1.3 追加「情绪要强烈一些」，≤0.8 追加「情绪含蓄一些」。
- 想自定义措辞：适配器也接受自由指令（40 字以内中文），或用 `AZURE_TTS_STYLE` 同款的
  `COSYVOICE_STYLE` 环境变量设置全局默认情绪。
- 默认走「沉稳」路线：未指定情绪时使用「沉稳、从容、有分量」的指令，语速默认 0.95；
  要更慢更稳可调 `COSYVOICE_SPEED=0.9`。
- 想彻底固定这一效果（忽略分镜情绪和显式语速）：设置 `COSYVOICE_LOCK_STEADY=1`。
- 想换音色：设置 `COSYVOICE_PROMPT_WAV=/path/to/ref.wav`（16k+ 参考音频，约 5~15 秒），
  即可 zero-shot 克隆任意音色并保留情绪指令能力。

## 让声音更自然（本次优化）

1. **指令改为官方训练格式**：情绪指令统一用 `请用…说一句话` / `请非常开心地说一句话`
   （对齐 CosyVoice3 自带的 instruct_list），而非 `用…说这句话`。后者语义相同但属于
   分布外表述，容易带出僵硬腔调。改动在 `apps/server/src/tts/cosyvoice.adapter.ts`。
2. **自然换气**：CosyVoice3 把 `[breath]` 注册为音频事件 token，官方示例就在从句边界
   插入它。`serve.py` 现在会在较长从句后自动插入最多 2 处 `[breath]`，不会在句号后
   插入，也不会连续插入。默认 `COSYVOICE_BREATH=auto`（仅 CosyVoice3 生效），
   `0` 关闭、`1` 强制开启。**改这个变量需要重启 TTS 服务**。
3. **不再截断长旁白**：`text_normalize()` 会把超过约 60 token 的文本切成多段，旧代码
   只保存第一段；现在会拼接全部片段，并在片段间留 60ms 停顿。
4. **想让分镜情绪真正起伏**：当前 `.env` 里 `COSYVOICE_LOCK_STEADY=1` 会把所有场景
   固定成同一句沉稳指令。改成 `0` 后，新的情绪指令会按分镜逐句生效，语气会有变化。

换音色仍是提升自然度最有效的手段：参考音建议用**干净、无背景音、5~15 秒、语速自然**
的人声切片；不合适的参考音会把它的腔调带给整段配音。

### A/B 试听

用同一段文案分别生成旧/新指令的样音，直接听差异（CPU 约 1~2 分钟一段）：

```bash
TEXT='这款相机非常轻便，适合旅行携带，随手放进背包也不占地方，而且画质表现出色，弱光下也能拍出清晰的照片。'
for TAG in old new; do
  if [ "$TAG" = old ]; then INS='用沉稳、从容、有分量的语气说这句话，语速略慢，吐字清晰'; else INS='请用沉稳、从容的语气说一句话，语速稍慢'; fi
  curl -s -X POST http://127.0.0.1:8766/tts -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"text":sys.argv[1],"instruction":sys.argv[2],"speed":0.95}))' "$TEXT" "$INS")" \
    -o "/tmp/tts-$TAG.wav"
done
# 旧样音无 [breath]；想关掉新指令里的停顿，设 COSYVOICE_BREATH=0 并重启服务。
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `COSYVOICE_URL` | `http://127.0.0.1:8766` | 服务地址（远程模式必填） |
| `COSYVOICE_MODEL_DIR` | 自动探测 | 模型目录 |
| `COSYVOICE_PROMPT_WAV` | 内置参考音 | zero-shot 参考音频路径 |
| `COSYVOICE_STYLE` | 无 | 全局默认情绪指令/风格 |
| `COSYVOICE_SPEED` | `0.95` | 默认语速，小于 1 更沉稳 |
| `COSYVOICE_LOCK_STEADY` | 关 | 设为 `1` 时固定沉稳预设，忽略情绪/语速参数 |
| `COSYVOICE_BREATH` | `auto` | `[breath]` 自然停顿：`auto`=仅 CosyVoice3、`0`=关、`1`=强制开（改后重启服务） |
| `COSYVOICE_LOUDNORM` | `loudnorm=I=-16:TP=-1.5:LRA=11` | 合成后响度归一化；置空关闭 |
| `COSYVOICE_PORT` / `COSYVOICE_HOST` | `8766` / `127.0.0.1` | 服务监听 |

## 常见问题

- **setup.sh 里 requirements 装失败（pynini/WeTextProcessing）**：脚本会自动回退 PyPI 源重试；
  macOS 上若仍有编译问题，建议用 `conda create -n cosyvoice python=3.10`（官方推荐环境），
  再 `PYTHON=... bash setup.sh` 复用现有 Python。
- **首次启动慢**：模型加载需要几分钟（打印 `ready` 前请耐心等待）。
- **`/tts` 返回 503**：模型尚未加载完成；返回 400 `prompt wav not found`：检查 `COSYVOICE_PROMPT_WAV`。
- **额度/隐私**：一切在本地或你自己的免费 GPU 会话内，无第三方账号、无配额、无费用。
