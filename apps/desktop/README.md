# Desktop App (Tauri)

桌面端复用 `apps/web` 前端页面，并通过本地 API (`apps/api`) 提供抓取、洗稿和导出能力。

## 开发启动

```bash
npm run dev -w apps/desktop
```

该命令会并行启动 API、Web、Tauri。

## Windows 打包

```bash
npm run package:desktop:win
```

该命令会按顺序完成：

- 构建 `packages/shared`、`apps/api`、`apps/web`
- 准备 Windows 桌面运行资源：`node.exe`、API `dist`、API 运行时依赖、Playwright Chromium 缓存
- 构建 Tauri release 程序
- 生成 NSIS 安装包

安装包输出位置：

```bash
apps/desktop/src-tauri/target/release/bundle/nsis/AutoExtraction_0.1.0_x64-setup.exe
```

> 如果提示缺少 Playwright 浏览器缓存，先执行 `npx playwright install chromium`，再重新打包。

## 运行时说明

Windows release 程序启动时会自动拉起本地 API：

- API 地址：`http://127.0.0.1:8787`
- 数据目录：`%APPDATA%/com.autoextraction.desktop/storage`
- API 日志：`%APPDATA%/com.autoextraction.desktop/api.stdout.log` 与 `api.stderr.log`
