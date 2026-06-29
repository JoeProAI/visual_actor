#!/usr/bin/env bash
# Visual Actor — one-command install.
# Creates a virtualenv, installs core dependencies, verifies FFmpeg, detects GPU,
# verifies WebView2 on Windows, prepares local voice models where legally allowed,
# and prints any remaining manual steps.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
warn() { printf "\033[33m! %s\033[0m\n" "$1"; }
ok()   { printf "\033[32m✓ %s\033[0m\n" "$1"; }

PY="${PYTHON:-python3}"
bold "==> Checking Python (need 3.11+)"
if ! "$PY" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3,11) else 1)'; then
  warn "Python 3.11+ required. Found: $($PY --version 2>&1). Set PYTHON=/path/to/python3.11"
  exit 1
fi
ok "$($PY --version)"

bold "==> Creating virtual environment (.venv)"
"$PY" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip wheel >/dev/null
ok "venv ready"

bold "==> Installing core dependencies"
pip install -r requirements.txt
ok "core dependencies installed"

bold "==> Optional ML/voice extras"
if [ "${INSTALL_ML:-0}" = "1" ]; then
  pip install '.[ml]' || warn "ML extras failed (torch/mediapipe/onnx). Core CPU paths still work."
else
  warn "Skipping heavy ML extras (torch/mediapipe/onnx/opencv). Set INSTALL_ML=1 to enable."
fi
if [ "${INSTALL_VOICES:-0}" = "1" ]; then
  pip install '.[voices]' || warn "Voice extras (elevenlabs/piper) failed; formant fallback still works."
fi

bold "==> Verifying FFmpeg"
if command -v ffmpeg >/dev/null 2>&1; then ok "ffmpeg: $(ffmpeg -version | head -n1)"; else
  warn "FFmpeg not found. Install it (apt install ffmpeg / brew install ffmpeg / choco install ffmpeg)."
fi

bold "==> Detecting GPU"
if command -v nvidia-smi >/dev/null 2>&1; then
  ok "NVIDIA GPU: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -n1)"
else
  warn "No NVIDIA GPU detected — running CPU-only direct render path (fully supported)."
fi

bold "==> WebView2 (Windows only)"
case "$(uname -s 2>/dev/null || echo Windows)" in
  *NT*|*MINGW*|*MSYS*|Windows)
    if command -v pwsh >/dev/null 2>&1; then pwsh -File scripts/install_webview2.ps1 || warn "WebView2 check failed.";
    else warn "Run scripts/install_webview2.ps1 in PowerShell to install the WebView2 Runtime."; fi ;;
  *) warn "Not Windows — WebView2 only needed for the Rainmeter widget on Windows." ;;
esac

bold "==> Preparing local Piper voice (optional download)"
mkdir -p app/assets/models/piper
PIPER_ONNX="app/assets/models/piper/en_US-amy-low.onnx"
if [ ! -f "$PIPER_ONNX" ] && [ "${DOWNLOAD_MODELS:-1}" = "1" ]; then
  BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$PIPER_ONNX" "$BASE/en_US-amy-low.onnx" 2>/dev/null && \
    curl -fsSL -o "$PIPER_ONNX.json" "$BASE/en_US-amy-low.onnx.json" 2>/dev/null && \
      ok "Downloaded Piper voice" || warn "Piper voice download skipped/failed — formant fallback will be used."
  fi
else
  ok "Piper voice present or downloads disabled (DOWNLOAD_MODELS=0)."
fi

bold "==> Configuring environment"
[ -f .env ] || { cp .env.example .env; ok "Created .env from .env.example"; }

bold "==> Smoke test"
python -c "from app.main import build; build(); print('engine OK')"

cat <<EOF

$(bold "Install complete.")
Next:
  1) Put your ElevenLabs key in .env (ELEVENLABS_API_KEY=...) for the primary voice.
     Without it, the system falls back to local Piper / formant synthesis automatically.
  2) Run the demo:        ./run.sh          (then open http://127.0.0.1:8765/)
  3) Run the benchmark:   ./benchmark.sh
  4) Build Rainmeter pack: pwsh ./build_rainmeter_skin.ps1   (on Windows)
EOF
