#!/bin/bash
# OpenReel Video - Local Development Start Script

set -e

echo "=== OpenReel Video - Dev Setup ==="

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

# Build WASM modules if not built
if [ ! -f "packages/core/src/wasm/fft/build/fft.wasm" ] || \
   [ ! -f "packages/core/src/wasm/wav/build/wav.wasm" ] || \
   [ ! -f "packages/core/src/wasm/beat-detection/build/beat.wasm" ]; then
  echo "Building WASM modules..."
  pnpm build:wasm
fi

# Start the local CosyVoice TTS service if it is not already up.
# A launchd agent (video.openreel.cosyvoice) normally keeps it running at
# login; this fallback covers machines where that agent is not installed.
if ! curl -sf -m 2 http://127.0.0.1:8766/health >/dev/null 2>&1; then
  if [ -x "services/cosyvoice/venv/bin/python" ]; then
    echo "Starting CosyVoice TTS service on 127.0.0.1:8766..."
    ( cd services/cosyvoice && nohup ./venv/bin/python serve.py >/tmp/cosyvoice.log 2>&1 & )
  else
    echo "CosyVoice venv missing; run services/cosyvoice/setup.sh first."
  fi
fi

# Start the API server (AI Studio, videogen, TTS, render, publish) unless it is
# already answering. It is started after CosyVoice on purpose: TTS adapters are
# registered at boot, so a CosyVoice service that comes up later is not seen
# until the server restarts.
SERVER_PORT="$(sed -n 's/^PORT=//p' apps/server/.env 2>/dev/null | head -1)"
SERVER_PORT="${SERVER_PORT:-4000}"
if ! curl -sf -m 2 "http://127.0.0.1:${SERVER_PORT}/api/health" >/dev/null 2>&1; then
  if [ -f "apps/server/.env" ]; then
    echo "Starting API server on http://localhost:${SERVER_PORT}/api ..."
    ( cd apps/server && nohup pnpm dev >/tmp/openreel-server.log 2>&1 & )
    for _ in $(seq 1 20); do
      curl -sf -m 1 "http://127.0.0.1:${SERVER_PORT}/api/health" >/dev/null 2>&1 && break
      sleep 1
    done
    if ! curl -sf -m 1 "http://127.0.0.1:${SERVER_PORT}/api/health" >/dev/null 2>&1; then
      echo "API server did not answer yet; see /tmp/openreel-server.log"
    fi
  else
    echo "apps/server/.env missing: cp apps/server/.env.example apps/server/.env (skipping API server)."
  fi
fi

echo "Starting dev server at http://localhost:5174"
pnpm dev --port 5174
