#!/usr/bin/env bash
# Visual Actor — one-command run. Starts the local FastAPI server.
# Open http://127.0.0.1:8765/ for the web demo, /rainmeter for the widget page.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ -d .venv ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

# Load .env if present (export every non-comment KEY=VALUE line).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

HOST="${VISUAL_ACTOR_HOST:-127.0.0.1}"
PORT="${VISUAL_ACTOR_PORT:-8765}"
echo "Starting Visual Actor at http://${HOST}:${PORT}/ (Ctrl+C to stop)"
exec python -m app.main --host "$HOST" --port "$PORT"
