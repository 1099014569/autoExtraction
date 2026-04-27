#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(debug_assertions))]
use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};

#[cfg(all(target_os = "windows", not(debug_assertions)))]
use std::os::windows::process::CommandExt;

#[cfg(not(debug_assertions))]
use tauri::{Manager, RunEvent};

#[cfg(all(target_os = "windows", not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn main() {
    #[cfg(not(debug_assertions))]
    let api_process = Arc::new(Mutex::new(None::<Child>));

    #[cfg(not(debug_assertions))]
    let api_process_for_setup = Arc::clone(&api_process);

    let builder = tauri::Builder::default();

    #[cfg(not(debug_assertions))]
    let builder = builder.setup(move |app| {
        let child = spawn_packaged_api(app)?;
        *api_process_for_setup
            .lock()
            .expect("本地 API 进程状态锁已损坏") = Some(child);
        Ok(())
    });

    #[cfg(not(debug_assertions))]
    {
        builder
            .build(tauri::generate_context!())
            .expect("创建桌面应用失败")
            .run(move |_app_handle, event| {
                if let RunEvent::Exit = event {
                    if let Ok(mut guard) = api_process.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            });
    }

    #[cfg(debug_assertions)]
    {
        builder
            .run(tauri::generate_context!())
            .expect("运行桌面应用失败");
    }
}

#[cfg(not(debug_assertions))]
fn spawn_packaged_api(app: &tauri::App) -> Result<Child, Box<dyn std::error::Error>> {
    let resource_dir = app.path().resource_dir()?;

    // 各平台使用独立的资源子目录和 Node 可执行文件名
    #[cfg(target_os = "windows")]
    let (native_api_subdir, node_bin) = ("win-api", "node.exe");
    #[cfg(target_os = "linux")]
    let (native_api_subdir, node_bin) = ("linux-api", "node");
    #[cfg(target_os = "macos")]
    let (native_api_subdir, node_bin) = ("mac-api", "node");

    let native_api_dir = resolve_native_api_dir(&resource_dir, native_api_subdir);
    let node_path = native_api_dir.join("node").join(node_bin);
    let api_dir = native_api_dir.join("api");
    let api_entry = api_dir.join("dist").join("index.js");
    let browsers_dir = native_api_dir.join("ms-playwright");

    // Windows 专用：去除 \\?\ 扩展路径前缀，Node.js 不支持该格式
    #[cfg(target_os = "windows")]
    let node_path = strip_windows_extended_prefix(node_path);
    #[cfg(target_os = "windows")]
    let api_dir = strip_windows_extended_prefix(api_dir);
    #[cfg(target_os = "windows")]
    let api_entry = strip_windows_extended_prefix(api_entry);
    #[cfg(target_os = "windows")]
    let browsers_dir = strip_windows_extended_prefix(browsers_dir);

    let app_data_dir = app.path().app_data_dir()?;
    let storage_dir = app_data_dir.join("storage");
    let database_path = storage_dir.join("autoextraction.db");
    let stdout_log = app_data_dir.join("api.stdout.log");
    let stderr_log = app_data_dir.join("api.stderr.log");

    fs::create_dir_all(&app_data_dir)?;
    fs::create_dir_all(&storage_dir)?;

    write_startup_log(&[
        ("node_path", &node_path),
        ("api_entry", &api_entry),
        ("api_dir", &api_dir),
        ("browsers_dir", &browsers_dir),
        ("app_data_dir", &app_data_dir),
        ("storage_dir", &storage_dir),
    ]);

    let mut cmd = Command::new(&node_path);
    cmd.arg(&api_entry)
        .current_dir(&api_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", "8787")
        .env("STORAGE_DIR", &storage_dir)
        .env("DATABASE_PATH", &database_path)
        .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(File::create(&stdout_log)?))
        .stderr(Stdio::from(File::create(&stderr_log)?));

    // Windows 专用：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    Ok(cmd.spawn()?)
}

#[cfg(not(debug_assertions))]
fn resolve_native_api_dir(resource_dir: &Path, native_api_subdir: &str) -> PathBuf {
    let nested = resource_dir.join("resources").join(native_api_subdir);
    if nested.exists() {
        nested
    } else {
        resource_dir.join(native_api_subdir)
    }
}

#[cfg(not(debug_assertions))]
fn write_startup_log(paths: &[(&str, &PathBuf)]) {
    #[cfg(target_os = "windows")]
    let log_path = std::env::temp_dir().join("autoextraction-desktop-startup.log");
    #[cfg(not(target_os = "windows"))]
    let log_path = std::path::PathBuf::from("/tmp/autoextraction-desktop-startup.log");

    if let Ok(mut file) = File::create(log_path) {
        for (name, path) in paths {
            let _ = writeln!(file, "{}={}", name, path.display());
            let _ = writeln!(file, "{}_exists={}", name, path.exists());
        }
    }
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn strip_windows_extended_prefix(path: PathBuf) -> PathBuf {
    let path_text = path.to_string_lossy();
    if let Some(stripped) = path_text.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path
    }
}
