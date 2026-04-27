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
```

### 本地打包

桌面程序使用 Tauri 2.x 打包。release 包会携带本机 Node 运行时、API 构建产物、API 运行时依赖和 Playwright Chromium 缓存，启动桌面程序后会自动拉起本地 API。

```bash
npx playwright install chromium
```

| 平台 | 执行系统 | 命令 | 产物 |
|------|----------|------|------|
| Windows | Windows | `npm run package:desktop:win` | `apps/desktop/src-tauri/target/release/bundle/nsis/*.exe` |
| Linux | Linux | `npm run package:desktop:linux` | `apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage`、`apps/desktop/src-tauri/target/release/bundle/deb/*.deb` |
| macOS | macOS | `npm run package:desktop:mac` | `apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg`、`apps/desktop/src-tauri/target/release/bundle/macos/*.app` |

> 平台包需要在对应系统上执行。准备脚本会复制当前系统的 `node` 可执行文件和当前系统的 Playwright 浏览器缓存，因此不建议跨系统交叉打包。

### 发布流水线

GitHub Actions 配置位于 `.github/workflows/release.yml`。推送符合 `v*.*.*` 的 tag 时会触发发布流水线：

```bash
git tag v0.1.0
git push origin v0.1.0
```

流水线会分别在 `windows-latest`、`ubuntu-22.04`、`macos-latest` 上执行对应平台打包命令，上传构建产物，并在全部平台构建完成后创建 GitHub Release。
