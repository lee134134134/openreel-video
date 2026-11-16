#!/usr/bin/env bash
# One-shot setup for the open-source CosyVoice TTS service:
# venv + repo checkout + model download + .ready marker.
# Intel Mac runs on CPU (slow but works); NVIDIA GPU hosts are much faster.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3.10}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python3
echo ">> python: $($PYTHON --version 2>&1)"

# 1) CosyVoice checkout (recursive: Matcha-TTS submodule is required)
if [ ! -d CosyVoice ]; then
  echo ">> cloning FunAudioLLM/CosyVoice"
  git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git
fi
(cd CosyVoice && git submodule update --init --recursive)

# 2) venv + python deps
if [ ! -x venv/bin/python ]; then
  "$PYTHON" -m venv venv
fi
./venv/bin/pip install -U pip wheel setuptools
# PyTorch CPU wheels by default; CUDA hosts: TORCH_INDEX=https://download.pytorch.org/whl/cu124
# Intel Macs: latest torch for x86_64 macOS is 2.2.x — requirements.txt pins
# torch==2.3.1 which has no x86_64 macOS wheel, so torch/torchaudio are
# excluded below and the pre-installed version is used instead.
./venv/bin/pip install torch torchaudio ${TORCH_INDEX:+--index-url "$TORCH_INDEX"}
./venv/bin/pip install fastapi "uvicorn[standard]" modelscope huggingface_hub
# openai-whisper setup.py imports pkg_resources, removed from setuptools>=81;
# build it without isolation against a pinned setuptools.
./venv/bin/pip install "setuptools<81" wheel
# numba/llvmlite latest have no cp311 x86_64 macOS wheels — pin the newest pair
# that ships them, otherwise pip falls back to source builds (needs cmake).
./venv/bin/pip install "numpy==1.26.4" "llvmlite==0.43.0" "numba==0.60.0"
./venv/bin/pip install --no-build-isolation openai-whisper==20231117
# CosyVoice requirements (aliyun mirror is fast inside China), minus torch pins
grep -vE "^(torch|torchaudio)==" CosyVoice/requirements.txt > /tmp/cv-requirements-mac.txt
./venv/bin/pip install -r /tmp/cv-requirements-mac.txt \
  -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host=mirrors.aliyun.com || {
  echo "!! requirements install failed; retrying from PyPI"
  ./venv/bin/pip install -r /tmp/cv-requirements-mac.txt
}

# 3) model download (ModelScope first — fastest in China; HF fallback)
./venv/bin/python - <<'PY'
from pathlib import Path

def try_download(module, repo, dest):
    dest = str(Path(dest))
    if Path(dest).exists() and any(Path(dest).iterdir()):
        print(f"skip {repo}: already present")
        return True
    try:
        mod = __import__(module)
        mod.snapshot_download(repo, local_dir=dest)
        print(f"downloaded {repo} -> {dest}")
        return True
    except Exception as exc:
        print(f"download {repo} failed: {exc}")
        return False

ok = try_download("modelscope", "FunAudioLLM/Fun-CosyVoice3-0.5B-2512", "pretrained_models/Fun-CosyVoice3-0.5B-2512")
if not ok:
    ok = try_download("huggingface_hub", "FunAudioLLM/Fun-CosyVoice3-0.5B-2512", "pretrained_models/Fun-CosyVoice3-0.5B-2512")
if not ok:
    ok = try_download("modelscope", "iic/CosyVoice2-0.5B", "pretrained_models/CosyVoice2-0.5B")
if not ok:
    ok = try_download("huggingface_hub", "FunAudioLLM/CosyVoice2-0.5B", "pretrained_models/CosyVoice2-0.5B")
raise SystemExit(0 if ok else 1)
PY

# 4) availability marker the server looks for
touch .ready
echo ""
echo "✅ 安装完成。启动服务（保持终端开着）："
echo "   cd services/cosyvoice && ./venv/bin/python serve.py"
echo "   验证: curl http://127.0.0.1:8766/health"
echo "   然后重启 OpenReel server，配音适配器会自动切换到 CosyVoice。"
