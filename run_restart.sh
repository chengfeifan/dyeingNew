#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "===> Restart backend"

# 1. Stop
./run_stop.sh

echo "===> Activate venv"
# shellcheck disable=SC1091
source .venv/bin/activate

echo "===> Start uvicorn on 127.0.0.1:8000"
nohup uvicorn main:app \
  --app-dir backend \
  --host 127.0.0.1 \
  --port 8000 \
  > backend_uvicorn.log 2>&1 &

sleep 2

echo "===> Health check"
if curl -s http://127.0.0.1:8000/docs >/dev/null; then
  echo "✅ Backend restarted successfully"
else
  echo "❌ Backend restart failed, check backend_uvicorn.log"
  exit 1
fi
