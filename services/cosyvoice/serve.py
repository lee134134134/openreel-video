#!/usr/bin/env python3
"""OpenReel local TTS service: open-source CosyVoice with emotion instructions.

Load:   ./venv/bin/python serve.py            # 127.0.0.1:8766
Health: GET  /health
Synth:  POST /tts {"text": "...", "instruction": "用开心的语气说这句话",
                    "speed": 1.0, "promptWav": "/path/to/ref.wav"}
     ->  audio/wav (24 kHz mono)

Also runs on a free cloud GPU (Colab/Kaggle): install the same deps there,
run this file with --host 0.0.0.0, tunnel it, and point the server's
COSYVOICE_URL at the tunnel. See README.md.
"""
import argparse
import io
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel

SERVICE_DIR = Path(__file__).resolve().parent
REPO_DIR = SERVICE_DIR / "CosyVoice"
# Third-party deps of the CosyVoice checkout must be importable.
for extra in (str(REPO_DIR), str(REPO_DIR / "third_party" / "Matcha-TTS")):
    if Path(extra).exists() and extra not in sys.path:
        sys.path.insert(0, extra)

DEFAULT_MODEL_DIRS = [
    os.environ.get("COSYVOICE_MODEL_DIR") or "",
    str(SERVICE_DIR / "pretrained_models" / "Fun-CosyVoice3-0.5B-2512"),
    str(SERVICE_DIR / "pretrained_models" / "CosyVoice2-0.5B"),
]
DEFAULT_PROMPT_WAV = os.environ.get(
    "COSYVOICE_PROMPT_WAV", str(REPO_DIR / "asset" / "zero_shot_prompt.wav")
)

app = FastAPI()
_state = {"cosyvoice": None, "sample_rate": 24000, "load_wav": None}


class TtsBody(BaseModel):
    text: str
    instruction: str | None = None
    speed: float = 1.0
    promptWav: str | None = None


def _model_dir() -> str | None:
    for candidate in DEFAULT_MODEL_DIRS:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def _load_model():
    import torch  # noqa: F401 (imported to pick a device below)

    from cosyvoice.cli.cosyvoice import CosyVoice2, CosyVoice3

    model_dir = _model_dir()
    if not model_dir:
        raise RuntimeError(
            "未找到模型目录。请先运行 services/cosyvoice/setup.sh，"
            "或用 COSYVOICE_MODEL_DIR 指定模型路径。"
        )
    # fp16 is CUDA-only; keep False for CPU/MPS hosts.
    device_hint = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[cosyvoice] loading {model_dir} (device={device_hint}, first load takes minutes)")
    if Path(model_dir, "cosyvoice3.yaml").exists():
        # CosyVoice3 takes no load_jit kwarg; instruct prompts need the
        # "You are a helpful assistant." prefix per official example.py.
        _state["prompt_version"] = 3
        cosyvoice = CosyVoice3(model_dir, load_trt=False, fp16=False)
    else:
        _state["prompt_version"] = 2
        cosyvoice = CosyVoice2(model_dir, load_jit=False, load_trt=False, fp16=False)
    _state["cosyvoice"] = cosyvoice
    _state["sample_rate"] = cosyvoice.sample_rate
    print(f"[cosyvoice] ready on {device_hint}, sample_rate={cosyvoice.sample_rate}")


@app.on_event("startup")
def startup() -> None:
    _load_model()


@app.get("/health")
def health():
    return {"ok": _state["cosyvoice"] is not None, "sample_rate": _state["sample_rate"]}


@app.post("/tts")
def tts(body: TtsBody):
    cosyvoice = _state["cosyvoice"]
    if cosyvoice is None:
        return Response("model not loaded", status_code=503)
    prompt_path = body.promptWav or DEFAULT_PROMPT_WAV
    if not prompt_path or not Path(prompt_path).exists():
        return Response(f"prompt wav not found: {prompt_path}", status_code=400)

    speed = max(0.5, min(2.0, float(body.speed or 1.0)))
    v3 = _state.get("prompt_version") == 3
    if body.instruction:
        # instruct2 mode: natural-language instruction ends with <|endofprompt|>;
        # CosyVoice3 additionally wants the assistant prefix before it. The
        # frontend loads the prompt wav itself (16k/24k), so pass the path.
        instruct_text = (
            f"You are a helpful assistant. {body.instruction}<|endofprompt|>"
            if v3 else f"{body.instruction}<|endofprompt|>"
        )
        chunks = cosyvoice.inference_instruct2(
            body.text, instruct_text, prompt_path, stream=False, speed=speed,
        )
    else:
        default_prompt = (
            "You are a helpful assistant.<|endofprompt|>希望你以后能够做的比我还好呦。"
            if v3 else "希望你以后能够做的比我还好呦。<|endofprompt|>"
        )
        chunks = cosyvoice.inference_zero_shot(
            body.text, default_prompt, prompt_path, stream=False, speed=speed,
        )

    import torchaudio

    buffer = io.BytesIO()
    for chunk in chunks:
        torchaudio.save(buffer, chunk["tts_speech"], _state["sample_rate"], format="wav")
        break  # single non-streaming output
    payload = buffer.getvalue()
    if not payload:
        return Response("empty synthesis output", status_code=500)
    return Response(payload, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.environ.get("COSYVOICE_PORT") or 8766))
    parser.add_argument("--host", default=os.environ.get("COSYVOICE_HOST") or "127.0.0.1")
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port)
