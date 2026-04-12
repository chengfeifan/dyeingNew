#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

APP_DIR="$(pwd)"
DOMAIN="${DOMAIN:-_}"          # 可选：export DOMAIN=your.domain.com
NGINX_PORT="${NGINX_PORT:-80}" # 可选：export NGINX_PORT=80

echo "===> [0/6] Check dependencies"
command -v python3 >/dev/null
command -v node >/dev/null
command -v npm >/dev/null

echo "===> [1/6] Setup Python venv + install backend deps"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -U pip
pip install -r backend/requirements.txt

echo "===> [2/6] Start backend (FastAPI) on 127.0.0.1:8000"
# 关键：绑定 127.0.0.1，避免直接暴露；由 Nginx 反代出去
pkill -f "uvicorn .* --app-dir backend" >/dev/null 2>&1 || true
nohup uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 > backend_uvicorn.log 2>&1 &

echo "===> [3/6] Build frontend (Vite) with VITE_API_BASE=/api"
cd frontend
if [ -f package-lock.json ]; then npm ci; else npm install; fi
VITE_API_BASE=/api npm run build
cd "$APP_DIR"

echo "===> [3.5/6] Ensure Nginx can read frontend dist"
# Nginx needs execute permission on all parent directories to traverse.
# Add read/execute for others to frontend/dist and its parent directories.
chmod o+rx "$APP_DIR" "$APP_DIR/frontend" || true
chmod -R o+rX "$APP_DIR/frontend/dist"

echo "===> [4/6] Install Nginx if missing"
if ! command -v nginx >/dev/null; then
  # Ubuntu/Debian
  sudo apt-get update
  sudo apt-get install -y nginx
  # CentOS/RHEL 用下面两行替换：
  # sudo yum install -y nginx
  # sudo systemctl enable nginx
fi

echo "===> [5/6] Configure Nginx reverse proxy (static + /api -> 8000)"
FRONTEND_DIST="$APP_DIR/frontend/dist"
if [ ! -d "$FRONTEND_DIST" ]; then
  echo "ERROR: frontend/dist not found. build failed?"
  exit 1
fi

NGINX_SITE_NAME="dyeing_ai_agent"
NGINX_CONF_PATH="/etc/nginx/sites-available/${NGINX_SITE_NAME}.conf"
NGINX_LINK_PATH="/etc/nginx/sites-enabled/${NGINX_SITE_NAME}.conf"

# Ubuntu/Debian 默认有 sites-available；若没有则走 conf.d
if [ ! -d /etc/nginx/sites-available ]; then
  NGINX_CONF_PATH="/etc/nginx/conf.d/${NGINX_SITE_NAME}.conf"
  NGINX_LINK_PATH="$NGINX_CONF_PATH"
fi

sudo tee "$NGINX_CONF_PATH" >/dev/null <<EOF
server {
    listen ${NGINX_PORT};
    server_name ${DOMAIN};

    # 前端静态资源（Vite build）
    root ${FRONTEND_DIST};
    index index.html;

    # SPA 路由：任意路径回落到 index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # 反向代理后端：/api/* -> http://127.0.0.1:8000/*
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_http_version 1.1;

        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # 如果后端有 WebSocket（可选）
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # 可选：大文件上传（比如 spc）
    client_max_body_size 50m;
}
EOF

# Ubuntu/Debian：启用站点
if [ -d /etc/nginx/sites-enabled ]; then
  sudo ln -sf "$NGINX_CONF_PATH" "$NGINX_LINK_PATH"
  # 禁用默认站点（可选）
  [ -f /etc/nginx/sites-enabled/default ] && sudo rm -f /etc/nginx/sites-enabled/default || true
fi

echo "===> [6/6] Reload Nginx"
sudo nginx -t
sudo systemctl restart nginx

echo "✅ Deploy done."
echo "Frontend: http://<server-ip> (or http://${DOMAIN})"
echo "Backend : http://<server-ip>/api/docs"
echo "Logs    : backend_uvicorn.log"
