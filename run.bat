@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo [1/3] Setup Python venv and start API at :8000

if not exist ".venv" (
  python -m venv .venv
)

call ".venv\Scripts\activate.bat"

python -m pip install --upgrade pip
pip install -r backend\requirements.txt

start "API" cmd /c "python -m uvicorn main:app --app-dir backend --reload --port 8000 --host 0.0.0.0"

echo [2/3] Install Node deps and start UI at :5173

cd /d "%~dp0\frontend"

if exist package-lock.json (
  npm ci
) else (
  npm install
)

set VITE_API_BASE=http://localhost:8000
npm run dev -- --host 0.0.0.0 --port 5173
