# Desktop App (Tauri)

桌面端复用 `apps/web` 前端页面，并通过本地 API (`apps/api`) 提供抓取、洗稿和导出能力。

## 开发启动

```bash
npm run dev -w apps/desktop
```

该命令会并行启动 API、Web、Tauri。

## 打包前置条件

```bash
npm install
npx playwright install chromium
```

打包依赖当前系统的 Node 运行时和 Playwright Chromium 缓存。各平台准备脚本会把这些运行资源复制到 Tauri resources 目录：

| 平台 | 资源目录 | 准备脚本 | Tauri 配置 |
|------|----------|----------|------------|
| Windows | `src-tauri/resources/win-api/` | `npm run prepare:win` | `src-tauri/conf/windows.json` |
| Linux | `src-tauri/resources/linux-api/` | `npm run prepare:linux` | `src-tauri/conf/linux.json` |
| macOS | `src-tauri/resources/mac-api/` | `npm run prepare:mac` | `src-tauri/conf/macos.json` |

生成的运行资源包含大体积二进制和 `node_modules`，只保留 `.keep` 文件进入版本库。

## 本地打包命令

### Windows

```bash
npm run package:desktop:win
```

产物：

```bash
apps/desktop/src-tauri/target/release/bundle/nsis/AutoExtraction_0.1.0_x64-setup.exe
```

Windows 打包前会清理当前仓库中遗留的打包 API Node 进程，避免 `resources/win-api/node/node.exe` 被占用导致 `os error 32`。

### Linux

```bash
npm run package:desktop:linux
```

产物：

```bash
apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage
apps/desktop/src-tauri/target/release/bundle/deb/*.deb
```

Linux 需要 Tauri WebKit 相关系统依赖。CI 中使用的依赖安装命令如下：

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf
```

### macOS

```bash
npm run package:desktop:mac
```

产物：

```bash
apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg
apps/desktop/src-tauri/target/release/bundle/macos/*.app
```

macOS 包必须在 macOS 上构建；如需正式分发，还需要后续补充签名和 notarization 流程。

## 发布流水线

`.github/workflows/release.yml` 会在推送 `v*.*.*` tag 时触发：

```bash
git tag v0.1.0
git push origin v0.1.0
```

流水线分为四个 job：

- `build-windows`：在 `windows-latest` 上执行 `npm run package:desktop:win`，上传 `windows-installer`。
- `build-linux`：在 `ubuntu-22.04` 上安装 Tauri 系统依赖后执行 `npm run package:desktop:linux`，上传 `linux-appimage` 和 `linux-deb`。
- `build-macos`：在 `macos-latest` 上执行 `npm run package:desktop:mac`，上传 `macos-dmg`。
- `release`：下载所有平台产物并创建 GitHub Release。

## 运行时说明

release 程序启动时会自动拉起本地 API：

- API 地址：`http://127.0.0.1:8787`
- 数据目录：由 Tauri `app_data_dir()` 决定，Windows 通常为 `%APPDATA%/com.autoextraction.desktop/storage`
- API 日志：应用数据目录下的 `api.stdout.log` 与 `api.stderr.log`
