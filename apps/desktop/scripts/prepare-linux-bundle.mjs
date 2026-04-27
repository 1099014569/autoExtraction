import { constants } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, "..");
const repoRoot = resolve(desktopDir, "../..");
const defaultOutputDir = join(desktopDir, "src-tauri", "resources", "linux-api");

const pathExists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const packageDir = (nodeModulesDir, packageName) =>
  packageName.startsWith("@")
    ? join(nodeModulesDir, ...packageName.split("/"))
    : join(nodeModulesDir, packageName);

const copyPackage = async (nodeModulesDir, outputNodeModulesDir, packageName) => {
  const source = packageDir(nodeModulesDir, packageName);
  const target = packageDir(outputNodeModulesDir, packageName);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    dereference: true,
    filter: (sourcePath) => {
      const normalized = sourcePath.replaceAll("\\", "/");
      return !normalized.includes("/.git/") && !normalized.endsWith("/.git");
    }
  });
};

export const collectRuntimePackageNames = async ({
  packageJsonPath,
  nodeModulesDir,
  workspacePackageNames = new Set()
}) => {
  const appPackage = await readJson(packageJsonPath);
  const queue = Object.keys(appPackage.dependencies ?? {});
  const collected = new Set();

  while (queue.length > 0) {
    const packageName = queue.shift();
    if (!packageName || workspacePackageNames.has(packageName) || collected.has(packageName)) {
      continue;
    }

    const dependencyPackageJson = join(packageDir(nodeModulesDir, packageName), "package.json");
    if (!(await pathExists(dependencyPackageJson))) {
      throw new Error(`缺少运行时依赖：${packageName}`);
    }

    collected.add(packageName);
    const dependencyPackage = await readJson(dependencyPackageJson);
    for (const transitiveName of Object.keys(dependencyPackage.dependencies ?? {})) {
      if (!workspacePackageNames.has(transitiveName) && !collected.has(transitiveName)) {
        queue.push(transitiveName);
      }
    }
    for (const optionalName of Object.keys(dependencyPackage.optionalDependencies ?? {})) {
      const optionalPackageJson = join(packageDir(nodeModulesDir, optionalName), "package.json");
      if (
        !workspacePackageNames.has(optionalName) &&
        !collected.has(optionalName) &&
        (await pathExists(optionalPackageJson))
      ) {
        queue.push(optionalName);
      }
    }
  }

  return collected;
};

const listWorkspacePackageNames = async (rootDir) => {
  const rootPackage = await readJson(join(rootDir, "package.json"));
  const names = new Set();

  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith("/*")) {
      continue;
    }
    const workspaceBase = join(rootDir, pattern.slice(0, -2));
    if (!(await pathExists(workspaceBase))) {
      continue;
    }
    for (const item of await readdir(workspaceBase, { withFileTypes: true })) {
      if (!item.isDirectory()) {
        continue;
      }
      const packageJsonPath = join(workspaceBase, item.name, "package.json");
      if (await pathExists(packageJsonPath)) {
        const packageJson = await readJson(packageJsonPath);
        if (packageJson.name) {
          names.add(packageJson.name);
        }
      }
    }
  }

  return names;
};

const resolvePlaywrightBrowsersPath = () => {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return resolve(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }
  // XDG_CACHE_HOME 优先，否则回退到 ~/.cache
  const cacheBase = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(cacheBase, "ms-playwright");
};

const copyNodeRuntime = async (outputDir) => {
  const nodeTargetDir = join(outputDir, "node");
  await mkdir(nodeTargetDir, { recursive: true });
  // Linux 不使用 .exe 后缀
  await cp(process.execPath, join(nodeTargetDir, "node"));
};

export const prepareLinuxBundle = async ({
  rootDir = repoRoot,
  outputDir = defaultOutputDir
} = {}) => {
  if (process.platform !== "linux") {
    throw new Error("Linux 桌面包资源只能在 Linux 环境准备");
  }

  const apiDistDir = join(rootDir, "apps", "api", "dist");
  if (!(await pathExists(join(apiDistDir, "index.js")))) {
    throw new Error("缺少 apps/api/dist/index.js，请先执行 API 构建");
  }

  const playwrightBrowsersPath = resolvePlaywrightBrowsersPath();
  if (!playwrightBrowsersPath || !(await pathExists(playwrightBrowsersPath))) {
    throw new Error(
      `缺少 Playwright 浏览器缓存（${playwrightBrowsersPath}），请先执行 npx playwright install chromium`
    );
  }

  const nodeModulesDir = join(rootDir, "node_modules");
  const workspacePackageNames = await listWorkspacePackageNames(rootDir);
  const runtimePackages = await collectRuntimePackageNames({
    packageJsonPath: join(rootDir, "apps", "api", "package.json"),
    nodeModulesDir,
    workspacePackageNames
  });

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await copyNodeRuntime(outputDir);
  await mkdir(join(outputDir, "api"), { recursive: true });
  await cp(apiDistDir, join(outputDir, "api", "dist"), { recursive: true });
  await cp(join(rootDir, "apps", "api", "package.json"), join(outputDir, "api", "package.json"));

  const outputNodeModulesDir = join(outputDir, "node_modules");
  await mkdir(outputNodeModulesDir, { recursive: true });
  for (const packageName of [...runtimePackages].sort()) {
    await copyPackage(nodeModulesDir, outputNodeModulesDir, packageName);
  }

  await cp(playwrightBrowsersPath, join(outputDir, "ms-playwright"), { recursive: true });
  await writeFile(
    join(outputDir, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        platform: "linux",
        nodeVersion: process.version,
        runtimePackages: [...runtimePackages].sort()
      },
      null,
      2
    )
  );
  await writeFile(join(outputDir, ".keep"), "");

  console.log(`[desktop] Linux API 运行资源已准备：${outputDir}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepareLinuxBundle().catch((error) => {
    console.error(`[desktop] Linux API 运行资源准备失败：${error.message}`);
    process.exitCode = 1;
  });
}
