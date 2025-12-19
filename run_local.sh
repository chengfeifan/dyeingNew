#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
echo "[1/3] Setup Python venv and start API at :8000"
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
( uvicorn app.main:app --app-dir backend --reload --port 8000 & )

echo "[2/3] Install Node deps and start UI at :5173"
cd frontend
if [ -f package-lock.json ]; then npm ci; else npm install; fi
VITE_API_BASE=http://localhost:8000 npm run dev
