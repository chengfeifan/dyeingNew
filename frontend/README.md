# 前端开发说明

React + Vite 前端位于本目录。常用脚本：

```bash
# 安装依赖
npm ci

# 本地开发，默认对接 http://localhost:8000
VITE_API_BASE=http://localhost:8000 npm run dev -- --host 0.0.0.0 --port 5173

# 生产构建与本地预览
npm run build
npm run preview -- --host 0.0.0.0 --port 4173
```

`VITE_API_BASE` 控制前端调用的后端地址（需能被浏览器访问）。更多部署与后端接口说明见仓库根目录的 `README.md`。
