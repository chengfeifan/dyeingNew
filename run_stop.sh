#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "===> Stop FastAPI (uvicorn)"

# 精确匹配：只杀 backend 的 uvicorn
PIDS=$(ps -ef | grep "uvicorn main:app --app-dir backend" | grep -v grep | awk '{print $2}')

if [ -z "${PIDS}" ]; then
  echo "No uvicorn process found."
else
  echo "Killing uvicorn PIDs: ${PIDS}"
  kill ${PIDS}
fi

sleep 1

# 再确认一遍
REMAIN=$(ps -ef | grep "uvicorn main:app --app-dir backend" | grep -v grep || true)
if [ -n "${REMAIN}" ]; then
  echo "⚠️ Still running, force kill"
  pkill -f "uvicorn main:app --app-dir backend"
fi

echo "✅ Backend stopped."
