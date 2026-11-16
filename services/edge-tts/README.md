# Edge TTS 服务（微软免费神经网络语音）

给 OpenReel 服务端提供接近自然人的中文/英文配音，无需 GPU、无需 API Key。
语音由微软 Edge 浏览器的在线 TTS 服务合成（与 Azure 神经音色同源：晓晓、云希等），
本目录仅安装一个纯 Python 客户端（`edge-tts`）用于调用。

## 适合谁

- 没有 NVIDIA GPU 的机器（如 Intel Mac / 老 Windows）：想要自然语音、不想花钱、
  可以接受联网合成。
- 完全离线的兜底：macOS 自带 `macos-say`（系统语音），音质不如 Edge 但零依赖。

## 快速开始

```bash
bash services/edge-tts/setup.sh   # 几秒钟完成
```

之后重启 Node 服务即可；`edge-tts` 会自动出现在 `/api/tts/adapters`，
并在没有任何云端 TTS Key 时成为默认配音。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `EDGE_TTS_PYTHON` | 直接指定用于调用 `edge-tts` 的 Python 解释器（绝对路径） | 自动探测 `services/edge-tts/venv/bin/python` |
| `EDGE_TTS_AUTO_SETUP` | 设为 `0` 时，venv 缺失不再自动运行 setup.sh | `1` |
| `EDGE_TTS_VOICE` | 默认音色 id | `zh-CN-XiaoxiaoNeural` |

## 音色

内置常用自然音色（也可传任意 edge-tts 音色 id）：

| id | 说明 |
| --- | --- |
| `zh-CN-XiaoxiaoNeural` | 晓晓 · 女 · 温暖自然（默认） |
| `zh-CN-XiaoyiNeural` | 晓伊 · 女 · 年轻 |
| `zh-CN-YunxiNeural` | 云希 · 男 · 年轻自然 |
| `zh-CN-YunyangNeural` | 云扬 · 男 · 新闻播报 |
| `zh-CN-YunjianNeural` | 云健 · 男 · 浑厚 |
| `en-US-AriaNeural` | Aria · 女 · 英语 |
| `en-US-JennyNeural` | Jenny · 女 · 英语 |

完整列表：`services/edge-tts/venv/bin/python -m edge_tts --list-voices`

## 注意

- 合成需要联网（微软服务端）；断网时报错并回退其他适配器/提示。
- 该接口为非官方公共接口，微软可能调整；出现 403/网络错误时重试或改用
  Azure（官方同款音色，每月免费额度 50 万字符）：配置 `AZURE_SPEECH_KEY`
  与 `AZURE_SPEECH_REGION` 即可自动优先使用。
