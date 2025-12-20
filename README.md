# 智能光谱分析系统

基于 **FastAPI** 后端与 **React + Vite** 前端的光谱处理与多组分浓度解析工具。后端负责 SPC 光谱解析、平滑、历史存储与 NNLS 浓度分析；前端提供上传、可视化、历史管理、浓度拟合与用户管理界面。

默认管理员账号：`admin` / `spectral123`。

## 快速开始（本地开发）

前置要求：Python 3.10+、Node.js 18+、npm。

```bash
# 1) 启动后端与前端（热更新），端口：API 8000，Web 5173
./run_local.sh
```

脚本会自动创建虚拟环境、安装 `backend/requirements.txt`，并以 `VITE_API_BASE=http://localhost:8000` 启动前端。前端默认直连本地后端；如需修改接口地址，可在运行命令前设置 `VITE_API_BASE`。

历史数据默认写入仓库根目录下的 `spectra_history/`。如需调整目录，可在启动前设置环境变量 `HISTORY_DIR`。

## 一键部署（Docker）

```bash
# 构建并启动（生产前端，Vite Preview），端口：API 8000，Web 4173
./run_docker.sh
```

`docker-compose.yml` 要点：

- 后端服务：`python:3.11-slim`，安装 `backend/requirements.txt`，命令 `uvicorn main:app --host 0.0.0.0 --port 8000`。
- 前端服务：`node:20-alpine`，执行 `npm ci && npm run build && npm run preview -- --host 0.0.0.0 --port 4173`。
- Nginx 反向代理：`nginx:1.27-alpine`，默认代理域名 `https://spectrum.arkshow.com`，转发 `/api` 与 `/health` 至后端，其他流量至前端。
- 默认环境：前端通过相对路径 `/api` 访问接口；持久化历史数据到宿主机 `./spectra_history`（映射为 `/app/spectra_history`）。如需修改，可在 compose 环境段调整。

启动后可访问：

- 直连 API: http://localhost:8000/health
- 直连前端: http://localhost:4173/
- 经 Nginx 代理的入口：  
  - HTTP: http://localhost/ （自动 301 到 HTTPS）  
  - HTTPS: https://localhost/ （如使用自签证书需信任后访问）  
  - 健康检查: https://localhost/health

## 接口概览

- `GET /health`：存活探针。
- `POST /process`：上传 `sample`、`water`、`dark` 三个 SPC 文件，支持平滑、输出 T/A/I_corr。
- `POST /save` / `GET /history` / `GET /history/{name}` / `PATCH /history/{name}` / `DELETE /history/{name}`：历史数据读写与重命名、元信息更新。
- `GET /export/batch`：打包全部历史为 ZIP（CSV）。
- `POST /analysis/concentration`：NNLS 多组分浓度拟合。
- `POST /auth/login` / `GET|POST|DELETE /auth/users`：登录及用户管理。

## 常见问题

- **缺少依赖**：请确认已执行 `pip install -r backend/requirements.txt` 与 `npm ci`。
- **跨域/接口地址错误**：前端接口地址由 `VITE_API_BASE` 控制，需可从浏览器直连后端（通常设置为 `http://localhost:8000`）。
- **历史数据路径**：通过 `HISTORY_DIR` 或挂载 `spectra_history` 目录保持持久化。默认管理员密码固定为 `spectral123`，可在后端用户管理中新增或删除普通用户。

## 将域名指向 Nginx（示例：spectrum.arkshow.com）

1. 确保域名 `spectrum.arkshow.com` 指向部署服务器的公网 IP（A 记录）。  
2. 将 TLS 证书文件放置到仓库根目录 `nginx/certs/` 下，文件名：  
   - `fullchain.pem`  
   - `privkey.pem`  
   若使用自签证书，可先通过 `openssl` 生成自签对后再放入。
3. 根据需要修改 `nginx/default.conf` 中的 `server_name`（默认 `spectrum.arkshow.com`）以及监听端口/转发策略。
4. 执行 `./run_docker.sh`，Nginx 将自动代理：  
   - `https://spectrum.arkshow.com/api` -> 后端 8000  
   - `https://spectrum.arkshow.com/`   -> 前端 4173  
5. 若需要开放 HTTP（临时测试），可自行调整 `default.conf` 中的重定向规则。
