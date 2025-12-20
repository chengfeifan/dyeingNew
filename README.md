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
- 默认环境：`VITE_API_BASE=http://localhost:8000`；持久化历史数据到宿主机 `./spectra_history`（映射为 `/app/spectra_history`）。如需修改，可在 compose 环境段调整。

启动后可访问：

- API: http://localhost:8000/health
- 前端: http://localhost:4173/

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
