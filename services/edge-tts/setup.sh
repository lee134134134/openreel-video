#!/usr/bin/env bash
# Install the edge-tts CLI (pure Python, ~15MB with aiohttp) into a local venv.
# Synthesis itself happens on Microsoft's free online neural TTS; no API key.
set -euo pipefail

cd "$(dirname "$0")"

PYTHON_BIN=""
for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
        version_full=$("$candidate" --version 2>&1 | awk '{print $2}')
        major=$(echo "$version_full" | cut -d. -f1)
        minor=$(echo "$version_full" | cut -d. -f2)
        if [[ $((major * 100 + minor)) -ge 309 ]]; then
            PYTHON_BIN="$candidate"
            break
        fi
    fi
done

if [[ -z "$PYTHON_BIN" ]]; then
    echo "错误：未找到 Python 3（需要 ≥3.9）。" >&2
    exit 1
fi

if [[ ! -d "venv" ]]; then
    "$PYTHON_BIN" -m venv venv
fi

if [[ ! -f "venv/bin/edge-tts" && ! -f "venv/bin/edge_tts.py" ]]; then
    if ! venv/bin/pip install edge-tts; then
        venv/bin/pip install edge-tts -i https://pypi.tuna.tsinghua.edu.cn/simple
    fi
fi

venv/bin/python -m edge_tts --list-voices >/dev/null 2>&1 || true
echo "Edge TTS 安装完成。"
