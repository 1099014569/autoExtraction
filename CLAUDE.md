# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

### 根目录（所有工作区）

```bash
npm install                        # 安装所有依赖
npm run dev                        # 并行启动 API + Web 开发服务器
npm run build                      # 按序构建 shared → api → web
npm run test --workspaces          # 运行所有包的测试
npm run docker:up                  # Docker Compose 启动所有服务
```

### 单个工作区

```bash
npm run dev -w apps/api            # 启动 API 开发（tsx watch，端口 8787）
npm run dev -w apps/web            # 启动 Web 开发（Vite，端口 5173）
npm run dev -w apps/desktop        # 启动桌面端（并行启动 API + Web + Tauri）
npm run test -w apps/api           # 运行 API Vitest 测试（一次性）
npm run test:watch -w apps/api     # 运行 API Vitest 监听模式
npm run build -w packages/shared   # 编译共享类型包（修改类型后必须先执行）
```

### 桌面打包

```bash
npm run package:desktop            # 跨平台桌面打包
npm run package:desktop:win        # Windows NSIS 安装包
```

## 架构

TypeScript Monorepo，4 个工作区：

```
apps/api         → Express.js 后端（TypeScript，NodeNext ESM）
apps/web         → React 18 + Vite 前端
apps/desktop     → Tauri 2.x 桌面壳（复用 Web 资源与 API，不含独立前端逻辑）
packages/shared  → 纯类型定义包（无运行时代码，被 api 和 web 共同依赖）
```

### API 分层（`apps/api/src/`）

- `app.ts` — Express 路由注册
- `config.ts` — 环境变量加载
- `services/` — 业务逻辑（extract/rewrite/export/rateLimiter/robots）
- `store/` — 数据持久化（jobRepository）

核心路由：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/extract` | 单 URL 提取 |
| POST | `/api/v1/extract/batch` | 批量提取（最多 20） |
| POST | `/api/v1/rewrite` | AI 洗稿（conservative / aggressive） |
| POST | `/api/v1/export` | 导出文档（docx / pptx / pdf） |
| GET | `/api/v1/download/:fileId` | 下载导出文件 |
| GET | `/api/v1/jobs` | 历史作业列表 |

### 共享类型（`packages/shared/src/index.ts`）

定义全栈通用类型：`Job`、`ExtractedContent`、`ExportedFile`、`ProviderConfig`，以及各 API 端点的请求/响应类型。**修改此文件后，必须先执行 `npm run build -w packages/shared` 才能在 api/web 中生效。**

### 关键约束

- TypeScript strict mode 全局开启，包含 `exactOptionalPropertyTypes` 和 `noUncheckedIndexedAccess`
- API 模块系统为 NodeNext ESM；Web 模块系统为 Bundler（Vite 管理）
- API 使用 Playwright 抓取网页，受 `robots.txt` 检查和主机级速率限制（`MIN_FETCH_INTERVAL_MS`）约束
- 测试框架仅 API 使用 Vitest（测试文件位于 `apps/api/tests/`）；项目无 ESLint/Prettier 配置

### 关键环境变量（`apps/api/.env`）

```
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
STORAGE_DIR=./storage
PORT=8787
```
