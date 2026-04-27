# AutoExtraction V1

本项目是一个 `TypeScript monorepo`，提供网页内容提取、AI 洗稿、文档导出（Word/PPT/PDF）以及 Web + 桌面双端。

## 目录结构

- `apps/api`：后端 API，负责抓取、洗稿、导出、历史记录。
- `apps/web`：Web 前端页面。
- `apps/desktop`：Tauri 桌面壳，复用 Web 前端。
- `packages/shared`：共享类型定义。

## 本地开发

```bash
npm install
npm run dev
```

默认端口：

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

## Docker 启动

```bash
npm run docker:up
```

## 核心接口

- `POST /api/v1/extract`
- `POST /api/v1/rewrite`
- `POST /api/v1/export`
- `GET /api/v1/download/:fileId`
- `GET /api/v1/jobs?limit=100`

## 桌面端

```bash
npm run dev -w apps/desktop
npm run build -w apps/desktop
```

### Windows 安装包

```bash
npm run package:desktop:win
```

该命令会生成自包含的 Windows NSIS 安装包，桌面程序启动后会自动拉起本地 API。产物路径：

```bash
apps/desktop/src-tauri/target/release/bundle/nsis/AutoExtraction_0.1.0_x64-setup.exe
```

> 打包依赖本机 Node 运行时和 Playwright Chromium 缓存；如果缺少浏览器缓存，先执行 `npx playwright install chromium`。
