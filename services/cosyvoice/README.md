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

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `COSYVOICE_URL` | `http://127.0.0.1:8766` | 服务地址（远程模式必填） |
| `COSYVOICE_MODEL_DIR` | 自动探测 | 模型目录 |
| `COSYVOICE_PROMPT_WAV` | 内置参考音 | zero-shot 参考音频路径 |
| `COSYVOICE_STYLE` | 无 | 全局默认情绪指令/风格 |
| `COSYVOICE_SPEED` | `0.95` | 默认语速，小于 1 更沉稳 |
| `COSYVOICE_LOCK_STEADY` | 关 | 设为 `1` 时固定沉稳预设，忽略情绪/语速参数 |
| `COSYVOICE_LOUDNORM` | `loudnorm=I=-16:TP=-1.5:LRA=11` | 合成后响度归一化；置空关闭 |
| `COSYVOICE_PORT` / `COSYVOICE_HOST` | `8766` / `127.0.0.1` | 服务监听 |

## 常见问题

- **setup.sh 里 requirements 装失败（pynini/WeTextProcessing）**：脚本会自动回退 PyPI 源重试；
  macOS 上若仍有编译问题，建议用 `conda create -n cosyvoice python=3.10`（官方推荐环境），
  再 `PYTHON=... bash setup.sh` 复用现有 Python。
- **首次启动慢**：模型加载需要几分钟（打印 `ready` 前请耐心等待）。
- **`/tts` 返回 503**：模型尚未加载完成；返回 400 `prompt wav not found`：检查 `COSYVOICE_PROMPT_WAV`。
- **额度/隐私**：一切在本地或你自己的免费 GPU 会话内，无第三方账号、无配额、无费用。
