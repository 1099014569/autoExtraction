#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(target_os = "windows", not(debug_assertions)))]
use std::{
    env,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
};

#[cfg(all(target_os = "windows", not(debug_assertions)))]
use std::os::windows::process::CommandExt;

#[cfg(all(target_os = "windows", not(debug_assertions)))]
use tauri::{Manager, RunEvent};

#[cfg(all(target_os = "windows", not(debug_assertions)))]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn main() {
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    let api_process = Arc::new(Mutex::new(None::<Child>));

    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    let api_process_for_setup = Arc::clone(&api_process);

    let builder = tauri::Builder::default();

    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    let builder = builder.setup(move |app| {
        let child = spawn_packaged_api(app)?;
        *api_process_for_setup
            .lock()
            .expect("本地 API 进程状态锁已损坏") = Some(child);
        Ok(())
    });

    #[cfg(all(target_os = "windows", not(debug_assertions)))]
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

    #[cfg(not(all(target_os = "windows", not(debug_assertions))))]
    {
        builder
            .run(tauri::generate_context!())
            .expect("运行桌面应用失败");
    }
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn spawn_packaged_api(app: &tauri::App) -> Result<Child, Box<dyn std::error::Error>> {
    write_startup_message("spawn_packaged_api:start");
    let resource_dir = match app.path().resource_dir() {
        Ok(path) => {
            write_startup_message(&format!("resource_dir={}", path.display()));
            path
        }
        Err(error) => {
            write_startup_message(&format!("resource_dir_error={error}"));
            return Err(Box::new(error));
        }
    };
    let win_api_dir = resource_dir.join("resources").join("win-api");
    let node_path = strip_windows_extended_prefix(win_api_dir.join("node").join("node.exe"));
    let api_dir = win_api_dir.join("api");
    let api_entry = strip_windows_extended_prefix(api_dir.join("dist").join("index.js"));
    let api_dir = strip_windows_extended_prefix(api_dir);
    let browsers_dir = strip_windows_extended_prefix(win_api_dir.join("ms-playwright"));
    let app_data_dir = match app.path().app_data_dir() {
        Ok(path) => {
            write_startup_message(&format!("app_data_dir={}", path.display()));
            path
        }
        Err(error) => {
            write_startup_message(&format!("app_data_dir_error={error}"));
            return Err(Box::new(error));
        }
    };
    let storage_dir = app_data_dir.join("storage");
    let database_path = storage_dir.join("autoextraction.db");
    let stdout_log = app_data_dir.join("api.stdout.log");
    let stderr_log = app_data_dir.join("api.stderr.log");

    fs::create_dir_all(&app_data_dir)?;
    fs::create_dir_all(&storage_dir)?;
    write_startup_log(&[
        ("node_path", node_path.as_path()),
        ("api_entry", api_entry.as_path()),
        ("api_dir", api_dir.as_path()),
        ("browsers_dir", browsers_dir.as_path()),
        ("app_data_dir", app_data_dir.as_path()),
        ("storage_dir", storage_dir.as_path()),
    ]);

    let child = Command::new(node_path)
        .arg(api_entry)
        .current_dir(api_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", "8787")
        .env("STORAGE_DIR", &storage_dir)
        .env("DATABASE_PATH", &database_path)
        .env("PLAYWRIGHT_BROWSERS_PATH", browsers_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(File::create(stdout_log)?))
        .stderr(Stdio::from(File::create(stderr_log)?))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()?;

    Ok(child)
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn write_startup_log(paths: &[(&str, &Path)]) {
    let log_path = env::temp_dir().join("autoextraction-desktop-startup.log");
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

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn write_startup_message(message: &str) {
    let log_path = env::temp_dir().join("autoextraction-desktop-startup.log");
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(log_path) {
        let _ = writeln!(file, "{message}");
    }
}
