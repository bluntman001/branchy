mod icons;
mod fileops;
mod fswatch;
#[cfg(windows)]
mod thumbcache;

use fileops::*;
use icons::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

// ── Types shared with frontend ──────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: f64,
    pub modified: f64,
    pub created: f64,
    pub extension: String,
    #[serde(default)]
    pub is_hidden: bool,
    #[serde(default)]
    pub is_system: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub letter: String,
    pub label: String,
    pub path: String,
    #[serde(rename = "type")]
    pub drive_type: String,
    pub size: Option<f64>,
    pub free: Option<f64>,
}

#[derive(Serialize, Clone)]
pub struct FilePreview {
    #[serde(rename = "type")]
    pub preview_type: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub api_key: String,
    pub start_dir: String,
    pub confirm_delete: bool,
    pub show_hidden: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MostUsedEntry {
    pub path: String,
    pub count: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithApp {
    pub name: String,
    pub exe_path: String,
}

// ── Tauri commands ──────────────────────────────────────────────────────────

#[tauri::command]
async fn list_directory(dir_path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let entries = fileops::list_directory_native(&dir_path).map_err(|e| e.to_string())?;
        if show_hidden {
            Ok(entries)
        } else {
            Ok(entries.into_iter().filter(|e| !e.name.starts_with('.')).collect())
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_files(source_paths: Vec<String>, dest_dir: String) -> Result<(), String> {
    fileops::move_files_impl(&source_paths, &dest_dir).map_err(|e| e.to_string())
}

#[tauri::command]
fn copy_files(source_paths: Vec<String>, dest_dir: String) -> Result<(), String> {
    fileops::copy_files_impl(&source_paths, &dest_dir).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CopyProgress {
    op_id: String,
    current_file: String,
    bytes_done: f64,
    bytes_total: f64,
    done: bool,
    error: Option<String>,
    /// "copy" or "move" — UI shows the right label.
    kind: String,
}

/// Run an async copy or move with progress events. Returns immediately;
/// progress flows through the `copy-progress` Tauri event (kind = "copy"
/// or "move"). UI stays responsive — even for a same-volume rename, the
/// previous synchronous IPC could stall the renderer; this path keeps
/// the renderer free.
fn run_transfer(
    app: tauri::AppHandle,
    op_id: String,
    source_paths: Vec<String>,
    dest_dir: String,
    is_move: bool,
) {
    use tauri::Emitter;
    tokio::task::spawn_blocking(move || {
        let bytes_total = fileops::total_size_of_paths(&source_paths) as f64;
        let app_clone = app.clone();
        let op_id_clone = op_id.clone();
        let kind: String = if is_move { "move".into() } else { "copy".into() };
        let kind_clone = kind.clone();
        let mut last_emit = std::time::Instant::now() - std::time::Duration::from_secs(1);
        let mut last_file = String::new();
        let report = move |name: &str, bytes_done: u64,
                            last_emit: &mut std::time::Instant,
                            last_file: &mut String| {
            let now = std::time::Instant::now();
            let file_changed = name != last_file.as_str();
            if file_changed || now.duration_since(*last_emit).as_millis() >= 50 {
                *last_emit = now;
                *last_file = name.to_string();
                let _ = app_clone.emit("copy-progress", CopyProgress {
                    op_id: op_id_clone.clone(),
                    current_file: name.to_string(),
                    bytes_done: bytes_done as f64,
                    bytes_total,
                    done: false,
                    error: None,
                    kind: kind_clone.clone(),
                });
            }
        };
        let result = if is_move {
            fileops::move_files_with_progress(&source_paths, &dest_dir, |n, b| {
                report(n, b, &mut last_emit, &mut last_file);
            })
        } else {
            fileops::copy_files_with_progress(&source_paths, &dest_dir, |n, b| {
                report(n, b, &mut last_emit, &mut last_file);
            })
        };
        let _ = app.emit("copy-progress", CopyProgress {
            op_id,
            current_file: String::new(),
            bytes_done: bytes_total,
            bytes_total,
            done: true,
            error: result.err().map(|e| e.to_string()),
            kind,
        });
    });
}

#[tauri::command]
async fn copy_files_async(
    app: tauri::AppHandle,
    op_id: String,
    source_paths: Vec<String>,
    dest_dir: String,
) -> Result<(), String> {
    run_transfer(app, op_id, source_paths, dest_dir, false);
    Ok(())
}

#[tauri::command]
async fn move_files_async(
    app: tauri::AppHandle,
    op_id: String,
    source_paths: Vec<String>,
    dest_dir: String,
) -> Result<(), String> {
    run_transfer(app, op_id, source_paths, dest_dir, true);
    Ok(())
}

#[tauri::command]
fn delete_files(paths: Vec<String>) -> Result<(), String> {
    for p in &paths {
        trash::delete(p).map_err(|e| format!("Failed to trash {}: {}", p, e))?;
    }
    Ok(())
}

/// Permanent delete (no recycle bin). Used as a fallback when `delete_files`
/// fails — typical on network drives (Z:, SMB, ZFS shares) which Windows
/// Recycle Bin doesn't support.
#[tauri::command]
fn watch_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    fswatch::watch(app, path)
}

#[tauri::command]
fn unwatch_directory() {
    fswatch::unwatch();
}

#[tauri::command]
fn permanent_delete_files(paths: Vec<String>) -> Result<(), String> {
    for p in &paths {
        let path = std::path::Path::new(p);
        let result = if path.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
        result.map_err(|e| format!("Failed to delete {}: {}", p, e))?;
    }
    Ok(())
}

#[tauri::command]
fn create_folder(folder_path: String) -> Result<(), String> {
    std::fs::create_dir_all(&folder_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_file(file_path: String) -> Result<(), String> {
    if std::path::Path::new(&file_path).exists() {
        return Err("File already exists".into());
    }
    std::fs::write(&file_path, "").map_err(|e| e.to_string())
}

#[tauri::command]
fn search_files(root_path: String, query: String) -> Result<Vec<FileEntry>, String> {
    fileops::search_files_impl(&root_path, &query).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_file_preview(file_path: String) -> Result<FilePreview, String> {
    fileops::get_file_preview_impl(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_file(file_path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::iter::once;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        // Direct ShellExecuteW — accepts a wide-encoded path verbatim,
        // so filenames containing `(`, `)`, `[`, `]`, `&`, spaces etc.
        // work correctly. The previous `open::that` shell-out couldn't
        // handle some of these without manual quoting.
        let wide_path: Vec<u16> = OsStr::new(&file_path).encode_wide().chain(once(0)).collect();
        let verb: Vec<u16> = OsStr::new("open").encode_wide().chain(once(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(verb.as_ptr()),
                PCWSTR(wide_path.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };
        // ShellExecuteW returns a HINSTANCE; values > 32 indicate success,
        // anything ≤ 32 is a Win32 error code.
        let code = result.0 as usize;
        if code > 32 {
            Ok(())
        } else {
            Err(format!("ShellExecuteW failed (code {}). The file may have no associated app, or the path is unreachable.", code))
        }
    }
    #[cfg(not(windows))]
    {
        open::that(&file_path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn get_drives() -> Result<Vec<DriveInfo>, String> {
    tokio::task::spawn_blocking(move || {
        fileops::get_drives_impl().map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_stats(file_path: String) -> Result<Option<FileEntry>, String> {
    fileops::get_stats_impl(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_subdirectories(dir_path: String) -> Result<bool, String> {
    fileops::has_subdirectories_impl(&dir_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_shell_icon(file_path: String) -> String {
    tokio::task::spawn_blocking(move || {
        icons::get_shell_icon_impl_single(&file_path)
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn get_shell_icons_batch(file_paths: Vec<String>) -> HashMap<String, String> {
    tokio::task::spawn_blocking(move || {
        icons::get_shell_icons_batch_impl(&file_paths)
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn get_shell_thumbnails_batch(file_paths: Vec<String>) -> HashMap<String, String> {
    tokio::task::spawn_blocking(move || {
        icons::get_shell_thumbnails_batch_impl(&file_paths)
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn generate_shell_thumbnails_batch(file_paths: Vec<String>) -> HashMap<String, String> {
    tokio::task::spawn_blocking(move || {
        icons::generate_shell_thumbnails_batch_impl(&file_paths)
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn generate_shell_thumbnails_paths(file_paths: Vec<String>) -> HashMap<String, String> {
    tokio::task::spawn_blocking(move || {
        icons::generate_shell_thumbnails_paths_impl(&file_paths)
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn get_folder_size(dir_path: String) -> Result<f64, String> {
    tokio::task::spawn_blocking(move || {
        fileops::get_folder_size_impl(&dir_path)
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_open_with_apps(ext: String) -> Vec<OpenWithApp> {
    fileops::get_open_with_apps_impl(&ext)
}

/// Extract an archive (.rar/.zip/.7z/etc.) into the given destination
/// directory using WinRAR if installed, falling back to 7-Zip's CLI.
/// Spawned detached — UI stays responsive while extraction runs.
#[tauri::command]
fn extract_archive(archive_path: String, dest_dir: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        // Try WinRAR first (handles every common format), then 7-Zip CLI.
        let winrar_paths = [
            r"C:\Program Files\WinRAR\WinRAR.exe",
            r"C:\Program Files (x86)\WinRAR\WinRAR.exe",
        ];
        for p in winrar_paths {
            if std::path::Path::new(p).exists() {
                std::process::Command::new(p)
                    // x = extract with full paths, -o+ = overwrite, -ibck = minimised
                    .args(["x", "-o+", "-ibck", &archive_path, &format!("{}\\", dest_dir.trim_end_matches(['\\', '/']))])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                return Ok("WinRAR".into());
            }
        }
        let sevenzip_paths = [
            r"C:\Program Files\7-Zip\7z.exe",
            r"C:\Program Files (x86)\7-Zip\7z.exe",
        ];
        for p in sevenzip_paths {
            if std::path::Path::new(p).exists() {
                std::process::Command::new(p)
                    .args(["x", &archive_path, &format!("-o{}", dest_dir), "-y"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| e.to_string())?;
                return Ok("7-Zip".into());
            }
        }
        Err("No archive tool found. Install WinRAR or 7-Zip to extract archives.".into())
    }
    #[cfg(not(windows))]
    {
        Err("Extraction is only implemented on Windows".into())
    }
}

#[tauri::command]
fn open_file_with(file_path: String, exe_path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new(&exe_path)
            .arg(&file_path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(&exe_path)
            .arg(&file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_open_with_dialog(file_path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &file_path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("rundll32.exe")
            .args(["shell32.dll,OpenAs_RunDLL", &file_path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ensure a known-local 1x1 PNG exists in app data and return its path.
/// Used as the `icon` argument for tauri-plugin-drag — passing the dragged
/// file's own path crashes when the file lives on an SMB/network share
/// because Windows' icon loader stalls/fails over the wire and takes the
/// native drag code with it. A guaranteed-local path avoids all that.
#[tauri::command]
fn get_drag_icon_path() -> Result<String, String> {
    // Minimal valid 1x1 transparent RGBA PNG, ~70 bytes.
    const ICON_BYTES: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4,
        0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
        0xAE, 0x42, 0x60, 0x82,
    ];
    let dir = dirs::data_local_dir()
        .ok_or_else(|| "no local app data dir".to_string())?
        .join("branchy");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("drag-icon.png");
    if !path.exists() {
        std::fs::write(&path, ICON_BYTES).map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_home_dir() -> String {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

/// Returns the first CLI arg if it points to an existing directory.
/// Used when Branchy is launched as the default file explorer — Windows
/// passes the target folder path as argv[1].
#[tauri::command]
fn get_initial_path() -> Option<String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    for a in args {
        let trimmed = a.trim_matches('"').to_string();
        if std::path::Path::new(&trimmed).is_dir() {
            return Some(trimmed);
        }
    }
    None
}

#[tauri::command]
fn get_special_paths() -> HashMap<String, String> {
    let mut m = HashMap::new();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("C:\\Users"));
    m.insert("home".into(), home.to_string_lossy().to_string());
    m.insert("desktop".into(), dirs::desktop_dir().unwrap_or_else(|| home.join("Desktop")).to_string_lossy().to_string());
    m.insert("downloads".into(), dirs::download_dir().unwrap_or_else(|| home.join("Downloads")).to_string_lossy().to_string());
    m.insert("documents".into(), dirs::document_dir().unwrap_or_else(|| home.join("Documents")).to_string_lossy().to_string());
    m.insert("music".into(), dirs::audio_dir().unwrap_or_else(|| home.join("Music")).to_string_lossy().to_string());
    m.insert("pictures".into(), dirs::picture_dir().unwrap_or_else(|| home.join("Pictures")).to_string_lossy().to_string());
    m
}

// ── App entry ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![
            list_directory,
            rename_file,
            move_files,
            copy_files,
            copy_files_async,
            move_files_async,
            delete_files,
            permanent_delete_files,
            watch_directory,
            unwatch_directory,
            create_folder,
            create_file,
            search_files,
            get_file_preview,
            open_file,
            get_drives,
            get_stats,
            has_subdirectories,
            get_shell_icon,
            get_shell_icons_batch,
            get_shell_thumbnails_batch,
            generate_shell_thumbnails_batch,
            generate_shell_thumbnails_paths,
            get_folder_size,
            get_open_with_apps,
            extract_archive,
            open_file_with,
            show_open_with_dialog,
            get_home_dir,
            get_drag_icon_path,
            get_initial_path,
            get_special_paths,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
