#!/bin/bash
# Foreground supervisor: Ctrl+C stops both owned processes; never kills other apps.
set -euo pipefail
NOVA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$NOVA_ROOT"
[[ -x .venv/bin/python && -f frontend/node_modules/vite/bin/vite.js ]] || {
  echo "Run bash scripts/setup-macos.sh first."
  exit 1
}
.venv/bin/python -c 'import fastapi, uvicorn, speech_recognition' || {
  echo "Missing backend dependencies. Run bash scripts/setup-macos.sh."
  exit 1
}
for NOVA_PORT in 8000 5173; do
  if /usr/sbin/lsof -nP -iTCP:"$NOVA_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Port $NOVA_PORT is occupied. Stop its owning service before starting NOVA. No process was killed."
    exit 1
  fi
done
NOVA_BACKEND_PID=""
NOVA_FRONTEND_PID=""
cleanup() {
  trap - EXIT INT TERM
  [[ -z "$NOVA_BACKEND_PID" ]] || kill "$NOVA_BACKEND_PID" 2>/dev/null || true
  [[ -z "$NOVA_FRONTEND_PID" ]] || kill "$NOVA_FRONTEND_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
NOVA_BACKEND_PID=$!
(cd frontend && exec node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort) &
NOVA_FRONTEND_PID=$!
NOVA_READY=0
for ((NOVA_ATTEMPT=0; NOVA_ATTEMPT<40; NOVA_ATTEMPT++)); do
  if ! kill -0 "$NOVA_BACKEND_PID" 2>/dev/null || ! kill -0 "$NOVA_FRONTEND_PID" 2>/dev/null; then
    echo "A service exited. Check the error above; both services will be stopped."
    exit 1
  fi
  if curl --noproxy '*' --max-time 1 --fail --silent http://127.0.0.1:8000/api/health >/dev/null &&
     curl --noproxy '*' --max-time 1 --fail --silent http://127.0.0.1:5173/api/health >/dev/null; then
    NOVA_READY=1
    break
  fi
  sleep 0.5
done
[[ "$NOVA_READY" == 1 ]] || { echo "Health/proxy checks failed. Review the service errors above."; exit 1; }
echo "Both services responded. Open http://127.0.0.1:5173 — Ctrl+C stops NOVA."
while kill -0 "$NOVA_BACKEND_PID" 2>/dev/null && kill -0 "$NOVA_FRONTEND_PID" 2>/dev/null; do sleep 2; done
echo "A service stopped unexpectedly; stopping its companion."
exit 1
