import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectRuntimePackageNames,
  createDesktopResourceManifest
} from "../scripts/prepare-win-bundle.mjs";

const repoRoot = new URL("../../..", import.meta.url);

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
};

await test("Tauri 配置会把 Windows API 运行资源打入安装包", async () => {
  const manifest = await createDesktopResourceManifest(repoRoot);

  assert.equal(manifest.bundle.active, true);
  assert.ok(manifest.bundle.targets.includes("nsis"));
  assert.ok(manifest.bundle.resources.includes("resources/win-api/"));
});

await test("Windows API 资源目录保留占位文件，避免准备资源前 Tauri 编译失败", async () => {
  await access(new URL("../src-tauri/resources/win-api/.keep", import.meta.url));
});

await test("Tauri release 启动代码基于 resource_dir 拼接 win-api 路径", async () => {
  const mainRs = await readFile(new URL("../src-tauri/src/main.rs", import.meta.url), "utf8");

  assert.ok(mainRs.includes("app.path().resource_dir()"));
  assert.ok(mainRs.includes('join("resources").join("win-api")'));
  assert.ok(mainRs.includes('join("node").join("node.exe")'));
  assert.ok(mainRs.includes('let api_dir = win_api_dir.join("api");'));
  assert.ok(mainRs.includes('api_dir.join("dist").join("index.js")'));
  assert.ok(mainRs.includes('join("ms-playwright")'));
  assert.ok(mainRs.includes("strip_windows_extended_prefix"));
});

await test("Windows 构建脚本会先准备本地 API 运行资源", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.equal(packageJson.scripts["prepare:win"], "node scripts/prepare-win-bundle.mjs");
  assert.match(packageJson.scripts["build:win"], /npm run prepare:win/);
  assert.match(packageJson.scripts["build:win"], /tauri build --bundles nsis/);
});

await test("资源准备脚本会递归收集 API 的运行时依赖并跳过工作区包", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "autoextraction-desktop-test-"));
  try {
    const appPackagePath = join(tempDir, "package.json");
    const nodeModulesDir = join(tempDir, "node_modules");
    await mkdir(join(nodeModulesDir, "express"), { recursive: true });
    await mkdir(join(nodeModulesDir, "router"), { recursive: true });
    await mkdir(join(nodeModulesDir, "playwright"), { recursive: true });
    await mkdir(join(nodeModulesDir, "playwright-core"), { recursive: true });

    await writeFile(
      appPackagePath,
      JSON.stringify({
        dependencies: {
          "@autoextraction/shared": "0.1.0",
          express: "^4.0.0",
          playwright: "^1.0.0"
        }
      })
    );
    await writeFile(
      join(nodeModulesDir, "express", "package.json"),
      JSON.stringify({ dependencies: { router: "^1.0.0" } })
    );
    await writeFile(join(nodeModulesDir, "router", "package.json"), "{}");
    await writeFile(
      join(nodeModulesDir, "playwright", "package.json"),
      JSON.stringify({ dependencies: { "playwright-core": "^1.0.0" } })
    );
    await writeFile(join(nodeModulesDir, "playwright-core", "package.json"), "{}");

    const packages = await collectRuntimePackageNames({
      packageJsonPath: appPackagePath,
      nodeModulesDir,
      workspacePackageNames: new Set(["@autoextraction/shared"])
    });

    assert.deepEqual([...packages].sort(), [
      "express",
      "playwright",
      "playwright-core",
      "router"
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
