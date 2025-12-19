# 智能光谱分析系统

前端（React + Vite）与后端（FastAPI）组成的光谱数据预处理、浓度解析与预测平台，支持用户登录、历史记录管理与一键化部署。

## 快速开始（本地）

```bash
bash run_local.sh
```

- 后端：`http://localhost:8000`（默认账号：`admin` / `admin123`）。
- 前端：`http://localhost:5173`，环境变量 `VITE_API_BASE` 已在脚本中指向后端。

## Docker 一键启动

```bash
bash run_docker.sh
```

服务将通过 `docker-compose` 同时启动：

- `api`：FastAPI，暴露端口 `8000`，持久化数据存储在挂载的 `spectra_history` 目录。
- `web`：Vite 开发服务器，暴露端口 `5173`，通过服务名 `api` 访问后端。

## API 亮点（部分）

- `POST /auth/login`：登录并创建会话；`/auth/session`、`/auth/logout`、`/auth/activity` 维护登录态。
- `POST /process`：上传样品/水/暗谱 `.spc` 文件并预处理（去暗、透过率、吸光度、可选平滑）。
- `POST /save`、`GET /history`、`PATCH /history/{name}`、`GET /history/{name}/csv`、`GET /export/batch`：历史记录管理与批量导出。
- `POST /concentration/analyze`：多组分线性回归求解浓度贡献，返回拟合曲线与误差指标。
- `POST /prediction`：基于上染参数生成预测色值与曲线示意。

> 所有核心接口同时提供 `/api/*` 前缀路径，兼容前端代理配置。

