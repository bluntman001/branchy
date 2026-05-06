use crate::{DriveInfo, FileEntry, FilePreview, OpenWithApp};
use base64::Engine;
use std::io;
use std::path::Path;

// ── NtQueryDirectoryFile-based fast listing ─────────────────────────────────

#[cfg(windows)]
mod nt {
    use std::ffi::c_void;

    pub type HANDLE = *mut c_void;
    pub type NTSTATUS = i32;
    pub const STATUS_NO_MORE_FILES: NTSTATUS = 0xC000_0026u32 as i32;

    pub const FILE_LIST_DIRECTORY: u32 = 0x0001;
    pub const SYNCHRONIZE: u32 = 0x0010_0000;
    pub const FILE_SHARE_READ: u32 = 0x0000_0001;
    pub const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    pub const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    pub const FILE_DIRECTORY_FILE: u32 = 0x0000_0001;
    pub const FILE_SYNCHRONOUS_IO_NONALERT: u32 = 0x0000_0020;
    pub const FILE_OPEN_FOR_BACKUP_INTENT: u32 = 0x0000_4000;
    pub const OBJ_CASE_INSENSITIVE: u32 = 0x40;
    pub const FILE_ID_BOTH_DIR_INFO_CLASS: u32 = 37;

    #[repr(C)]
    pub struct UNICODE_STRING {
        pub length: u16,
        pub maximum_length: u16,
        pub buffer: *mut u16,
    }

    #[repr(C)]
    pub struct OBJECT_ATTRIBUTES {
        pub length: u32,
        pub root_directory: HANDLE,
        pub object_name: *mut UNICODE_STRING,
        pub attributes: u32,
        pub security_descriptor: *mut c_void,
        pub security_qos: *mut c_void,
    }

    #[repr(C)]
    pub struct IO_STATUS_BLOCK {
        pub status: NTSTATUS,
        pub information: usize,
    }

    #[repr(C)]
    pub struct FileBothDirInfo {
        pub next_entry_offset: u32,
        pub file_index: u32,
        pub creation_time: i64,
        pub last_access_time: i64,
        pub last_write_time: i64,
        pub change_time: i64,
        pub end_of_file: i64,
        pub allocation_size: i64,
        pub file_attributes: u32,
        pub file_name_length: u32,
        pub ea_size: u32,
        pub short_name_length: u8,
        pub _padding: u8,
        pub short_name: [u16; 12],
        pub file_id: i64,
        pub file_name: [u16; 1],
    }

    extern "system" {
        pub fn NtOpenFile(
            file_handle: *mut HANDLE,
            desired_access: u32,
            object_attributes: *mut OBJECT_ATTRIBUTES,
            io_status_block: *mut IO_STATUS_BLOCK,
            share_access: u32,
            open_options: u32,
        ) -> NTSTATUS;

        pub fn NtQueryDirectoryFile(
            file_handle: HANDLE,
            event: HANDLE,
            apc_routine: *mut c_void,
            apc_context: *mut c_void,
            io_status_block: *mut IO_STATUS_BLOCK,
            file_information: *mut c_void,
            length: u32,
            file_information_class: u32,
            return_single_entry: u8,
            file_name: *mut c_void,
            restart_scan: u8,
        ) -> NTSTATUS;

        pub fn NtClose(handle: HANDLE) -> NTSTATUS;
    }
}

fn filetime_to_ms(ft: i64) -> f64 {
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;
    ((ft - EPOCH_DIFF) / 10_000) as f64
}

#[cfg(windows)]
fn list_directory_nt(dir_path: &str) -> Option<Vec<FileEntry>> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;

    let nt_path_str = format!("\\??\\{}", dir_path.trim_start_matches("\\\\?\\"));
    let nt_wide: Vec<u16> = OsStr::new(&nt_path_str)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut ustr = nt::UNICODE_STRING {
        length: ((nt_wide.len() - 1) * 2) as u16,
        maximum_length: (nt_wide.len() * 2) as u16,
        buffer: nt_wide.as_ptr() as *mut u16,
    };

    let mut obj_attr = nt::OBJECT_ATTRIBUTES {
        length: std::mem::size_of::<nt::OBJECT_ATTRIBUTES>() as u32,
        root_directory: null_mut(),
        object_name: &mut ustr,
        attributes: nt::OBJ_CASE_INSENSITIVE,
        security_descriptor: null_mut(),
        security_qos: null_mut(),
    };

    let mut io = nt::IO_STATUS_BLOCK {
        status: 0,
        information: 0,
    };
    let mut handle: nt::HANDLE = null_mut();

    unsafe {
        let status = nt::NtOpenFile(
            &mut handle,
            nt::FILE_LIST_DIRECTORY | nt::SYNCHRONIZE,
            &mut obj_attr,
            &mut io,
            nt::FILE_SHARE_READ | nt::FILE_SHARE_WRITE | nt::FILE_SHARE_DELETE,
            nt::FILE_DIRECTORY_FILE
                | nt::FILE_SYNCHRONOUS_IO_NONALERT
                | nt::FILE_OPEN_FOR_BACKUP_INTENT,
        );
        if status < 0 {
            return None;
        }

        struct HandleGuard(nt::HANDLE);
        impl Drop for HandleGuard {
            fn drop(&mut self) {
                unsafe {
                    nt::NtClose(self.0);
                }
            }
        }
        let _guard = HandleGuard(handle);

        let mut buf = vec![0u8; 65536];
        let mut entries = Vec::new();
        let base = dir_path.trim_end_matches(['\\', '/']);

        loop {
            let status = nt::NtQueryDirectoryFile(
                handle,
                null_mut(),
                null_mut(),
                null_mut(),
                &mut io,
                buf.as_mut_ptr() as *mut _,
                buf.len() as u32,
                nt::FILE_ID_BOTH_DIR_INFO_CLASS,
                0,
                null_mut(),
                0,
            );

            if status == nt::STATUS_NO_MORE_FILES {
                break;
            }
            if status < 0 {
                break;
            }

            let mut offset: usize = 0;
            loop {
                let entry = &*(buf.as_ptr().add(offset) as *const nt::FileBothDirInfo);
                let name_len = entry.file_name_length as usize / 2;
                let name_slice = std::slice::from_raw_parts(entry.file_name.as_ptr(), name_len);
                let name = String::from_utf16_lossy(name_slice);

                if name != "." && name != ".." {
                    let attrs = entry.file_attributes;
                    let is_dir = (attrs & 0x10) != 0;
                    let ext = if is_dir {
                        String::new()
                    } else if let Some(dot) = name.rfind('.') {
                        name[dot..].to_lowercase()
                    } else {
                        String::new()
                    };

                    entries.push(FileEntry {
                        path: format!("{}\\{}", base, name),
                        name,
                        is_directory: is_dir,
                        size: entry.end_of_file as f64,
                        modified: filetime_to_ms(entry.last_write_time),
                        created: filetime_to_ms(entry.creation_time),
                        extension: ext,
                        is_hidden: (attrs & 0x2) != 0,
                        is_system: (attrs & 0x4) != 0,
                    });
                }

                if entry.next_entry_offset == 0 {
                    break;
                }
                offset += entry.next_entry_offset as usize;
            }
        }

        entries.sort_by(|a, b| {
            match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            }
        });

        Some(entries)
    }
}

pub fn list_directory_native(dir_path: &str) -> Result<Vec<FileEntry>, io::Error> {
    #[cfg(windows)]
    {
        if let Some(entries) = list_directory_nt(dir_path) {
            return Ok(entries);
        }
    }
    // Fallback
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(dir_path)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = meta.is_dir();
        let is_hidden = name.starts_with('.');
        let ext = if is_dir {
            String::new()
        } else {
            Path::new(&name)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                .unwrap_or_default()
        };
        entries.push(FileEntry {
            path: entry.path().to_string_lossy().to_string(),
            name,
            is_directory: is_dir,
            size: meta.len() as f64,
            modified: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0),
            created: meta
                .created()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0),
            extension: ext,
            is_hidden,
            is_system: false,
        });
    }
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    Ok(entries)
}

pub fn get_folder_size_impl(dir_path: &str) -> f64 {
    let mut total: f64 = 0.0;
    let mut stack = vec![dir_path.to_string()];
    while let Some(dir) = stack.pop() {
        #[cfg(windows)]
        {
            if let Some(entries) = list_directory_nt(&dir) {
                for e in entries {
                    if e.is_directory {
                        stack.push(e.path);
                    } else {
                        total += e.size;
                    }
                }
                continue;
            }
        }
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for entry in rd.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_dir() {
                        stack.push(entry.path().to_string_lossy().to_string());
                    } else {
                        total += meta.len() as f64;
                    }
                }
            }
        }
    }
    total
}

pub fn move_files_impl(source_paths: &[String], dest_dir: &str) -> Result<(), io::Error> {
    let dest = Path::new(dest_dir);
    if !dest.is_dir() {
        std::fs::create_dir_all(dest)?;
    }
    for src in source_paths {
        let src_path = Path::new(src);
        let file_name = src_path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no filename"))?;
        let dst = dest.join(file_name);
        match std::fs::rename(src, &dst) {
            Ok(_) => {}
            Err(_) => {
                copy_item(src_path, &dst)?;
                if src_path.is_dir() {
                    std::fs::remove_dir_all(src)?;
                } else {
                    std::fs::remove_file(src)?;
                }
            }
        }
    }
    Ok(())
}

pub fn copy_files_impl(source_paths: &[String], dest_dir: &str) -> Result<(), io::Error> {
    let dest = Path::new(dest_dir);
    if !dest.is_dir() {
        std::fs::create_dir_all(dest)?;
    }
    for src in source_paths {
        let src_path = Path::new(src);
        let file_name = src_path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no filename"))?;
        copy_item(src_path, &dest.join(file_name))?;
    }
    Ok(())
}

/// Move with progress. Tries `rename` first (instant for same-volume on
/// Windows / NTFS / SMB) — only falls back to copy+delete (with byte
/// progress) when crossing volumes or filesystems. The progress callback
/// gets `bytes_done = total` immediately for rename'd files so the UI
/// reflects them as instantly complete.
pub fn move_files_with_progress<F>(
    source_paths: &[String],
    dest_dir: &str,
    mut on_progress: F,
) -> Result<(), io::Error>
where
    F: FnMut(&str, u64),
{
    let dest = Path::new(dest_dir);
    if !dest.is_dir() {
        std::fs::create_dir_all(dest)?;
    }
    let mut bytes_done: u64 = 0;
    for src in source_paths {
        let src_path = Path::new(src);
        let file_name = src_path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no filename"))?;
        let dst = dest.join(file_name);
        let name = file_name.to_string_lossy().to_string();
        match std::fs::rename(src_path, &dst) {
            Ok(_) => {
                // Same-volume rename — count whole size as done in one tick.
                let size = std::fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
                bytes_done += size;
                on_progress(&name, bytes_done);
            }
            Err(_) => {
                // Cross-volume — copy with byte progress, then delete source.
                copy_item_with_progress(src_path, &dst, &mut bytes_done, &mut on_progress)?;
                if src_path.is_dir() {
                    std::fs::remove_dir_all(src_path)?;
                } else {
                    std::fs::remove_file(src_path)?;
                }
            }
        }
    }
    Ok(())
}

/// Recursively measure total byte size for a set of paths. Used to report
/// "x of y bytes" progress to the UI without blocking on a per-byte
/// stream count.
pub fn total_size_of_paths(paths: &[String]) -> u64 {
    fn walk(p: &Path) -> u64 {
        if let Ok(meta) = std::fs::metadata(p) {
            if meta.is_file() {
                return meta.len();
            }
            if meta.is_dir() {
                let mut total = 0u64;
                if let Ok(rd) = std::fs::read_dir(p) {
                    for entry in rd.flatten() {
                        total += walk(&entry.path());
                    }
                }
                return total;
            }
        }
        0
    }
    paths.iter().map(|p| walk(Path::new(p))).sum()
}

/// Copy with progress callback. The callback fires on every chunk written
/// (~1 MB) AND on every file completion, getting the current file name
/// and total bytes copied so far across the whole operation.
pub fn copy_files_with_progress<F>(
    source_paths: &[String],
    dest_dir: &str,
    mut on_progress: F,
) -> Result<(), io::Error>
where
    F: FnMut(&str, u64),
{
    let dest = Path::new(dest_dir);
    if !dest.is_dir() {
        std::fs::create_dir_all(dest)?;
    }
    let mut bytes_done: u64 = 0;
    for src in source_paths {
        let src_path = Path::new(src);
        let file_name = src_path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no filename"))?;
        copy_item_with_progress(src_path, &dest.join(file_name), &mut bytes_done, &mut on_progress)?;
    }
    Ok(())
}

fn copy_item_with_progress<F>(
    src: &Path,
    dst: &Path,
    bytes_done: &mut u64,
    on_progress: &mut F,
) -> Result<(), io::Error>
where
    F: FnMut(&str, u64),
{
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_item_with_progress(
                &entry.path(),
                &dst.join(entry.file_name()),
                bytes_done,
                on_progress,
            )?;
        }
    } else {
        copy_file_streaming(src, dst, bytes_done, on_progress)?;
    }
    Ok(())
}

const COPY_CHUNK: usize = 1024 * 1024; // 1 MB

fn copy_file_streaming<F>(
    src: &Path,
    dst: &Path,
    bytes_done: &mut u64,
    on_progress: &mut F,
) -> Result<(), io::Error>
where
    F: FnMut(&str, u64),
{
    use std::io::{Read, Write};
    let mut reader = std::fs::File::open(src)?;
    let mut writer = std::fs::File::create(dst)?;
    let mut buf = vec![0u8; COPY_CHUNK];
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 { break; }
        writer.write_all(&buf[..n])?;
        *bytes_done += n as u64;
        on_progress(&name, *bytes_done);
    }
    writer.flush()?;
    Ok(())
}

fn copy_item(src: &Path, dst: &Path) -> Result<(), io::Error> {
    if src.is_dir() {
        std::fs::create_dir_all(dst)?;
        for entry in std::fs::read_dir(src)? {
            let entry = entry?;
            copy_item(&entry.path(), &dst.join(entry.file_name()))?;
        }
    } else {
        std::fs::copy(src, dst)?;
    }
    Ok(())
}

pub fn search_files_impl(root_path: &str, query: &str) -> Result<Vec<FileEntry>, io::Error> {
    let mut results = Vec::new();
    let lower_query = query.to_lowercase();
    fn walk(dir: &Path, query: &str, results: &mut Vec<FileEntry>, depth: u32) -> io::Result<()> {
        if depth > 6 {
            return Ok(());
        }
        let rd = match std::fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => return Ok(()),
        };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let full_path = entry.path();
            if name.to_lowercase().contains(query) {
                if let Ok(meta) = entry.metadata() {
                    let is_dir = meta.is_dir();
                    let ext = if is_dir {
                        String::new()
                    } else {
                        Path::new(&name)
                            .extension()
                            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                            .unwrap_or_default()
                    };
                    results.push(FileEntry {
                        name,
                        path: full_path.to_string_lossy().to_string(),
                        is_directory: is_dir,
                        size: meta.len() as f64,
                        modified: meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as f64)
                            .unwrap_or(0.0),
                        created: meta
                            .created()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as f64)
                            .unwrap_or(0.0),
                        extension: ext,
                        is_hidden: false,
                        is_system: false,
                    });
                }
            }
            if entry.metadata().map(|m| m.is_dir()).unwrap_or(false) {
                walk(&full_path, query, results, depth + 1)?;
            }
        }
        Ok(())
    }
    walk(Path::new(root_path), &lower_query, &mut results, 0)?;
    Ok(results)
}

pub fn get_file_preview_impl(file_path: &str) -> Result<FilePreview, io::Error> {
    let ext = Path::new(file_path)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();

    let text_exts = [
        ".txt", ".md", ".js", ".ts", ".tsx", ".jsx", ".css", ".html", ".json", ".yaml", ".yml",
        ".xml", ".csv", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".sh", ".bat", ".ps1",
        ".log", ".ini", ".toml", ".env",
    ];
    let image_exts = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico"];

    if text_exts.contains(&ext.as_str()) {
        match std::fs::read_to_string(file_path) {
            Ok(content) => {
                let preview: String = content.chars().take(500).collect();
                return Ok(FilePreview {
                    preview_type: "text".into(),
                    content: preview,
                });
            }
            Err(_) => {
                return Ok(FilePreview {
                    preview_type: "none".into(),
                    content: String::new(),
                })
            }
        }
    }

    if ext == ".svg" {
        if let Ok(content) = std::fs::read_to_string(file_path) {
            let truncated: String = content.chars().take(32768).collect();
            let b64 = base64::engine::general_purpose::STANDARD.encode(truncated.as_bytes());
            return Ok(FilePreview {
                preview_type: "image".into(),
                content: format!("data:image/svg+xml;base64,{}", b64),
            });
        }
    }

    if image_exts.contains(&ext.as_str()) {
        if let Ok(data) = std::fs::read(file_path) {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            let mime = match ext.as_str() {
                ".png" => "image/png",
                ".gif" => "image/gif",
                ".bmp" => "image/bmp",
                ".webp" => "image/webp",
                ".ico" => "image/x-icon",
                _ => "image/jpeg",
            };
            return Ok(FilePreview {
                preview_type: "image".into(),
                content: format!("data:{};base64,{}", mime, b64),
            });
        }
    }

    Ok(FilePreview {
        preview_type: "none".into(),
        content: String::new(),
    })
}

pub fn get_drives_impl() -> Result<Vec<DriveInfo>, io::Error> {
    #[cfg(windows)]
    {
        return Ok(enumerate_drives_winapi());
    }
    #[cfg(not(windows))]
    {
        Ok(vec![DriveInfo {
            letter: "/".into(),
            label: "Root".into(),
            path: "/".into(),
            drive_type: "local".into(),
            size: None,
            free: None,
        }])
    }
}

/// Enumerate fixed/removable/network/CD drives via WinAPI. Replaces the old
/// `wmic` shell-out — wmic is deprecated and removed in modern Windows builds,
/// and the spawn-then-parse-CSV pipeline was 100ms+. Direct WinAPI calls are
/// sub-millisecond and don't flash a console window.
#[cfg(windows)]
fn enumerate_drives_winapi() -> Vec<DriveInfo> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };
    // GetDriveTypeW return values — stable WinAPI constants (winbase.h).
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED:     u32 = 3;
    const DRIVE_REMOTE:    u32 = 4;
    const DRIVE_CDROM:     u32 = 5;

    let mut drives = Vec::new();
    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return drives;
    }

    for i in 0..26u32 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter_char = (b'A' + i as u8) as char;
        let root_wide: Vec<u16> = format!("{}:\\", letter_char)
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let root_pcwstr = PCWSTR(root_wide.as_ptr());

        let dtype = unsafe { GetDriveTypeW(root_pcwstr) };
        let drive_type = match dtype {
            DRIVE_REMOVABLE => "removable",
            DRIVE_FIXED     => "local",
            DRIVE_REMOTE    => "network",
            DRIVE_CDROM     => "cdrom",
            _               => "unknown",
        };

        // Free + total bytes — may fail for empty CD/removable drives.
        let mut free_bytes: u64 = 0;
        let mut total_bytes: u64 = 0;
        let size_ok = unsafe {
            GetDiskFreeSpaceExW(
                root_pcwstr,
                Some(&mut free_bytes as *mut u64),
                Some(&mut total_bytes as *mut u64),
                None,
            )
            .is_ok()
        };

        // Volume label — may fail for the same reasons.
        let mut name_buf = [0u16; 256];
        let label_ok = unsafe {
            GetVolumeInformationW(
                root_pcwstr,
                Some(&mut name_buf),
                None,
                None,
                None,
                None,
            )
            .is_ok()
        };
        let vol_name = if label_ok {
            let end = name_buf.iter().position(|&c| c == 0).unwrap_or(name_buf.len());
            String::from_utf16_lossy(&name_buf[..end])
        } else {
            String::new()
        };

        let letter_str = format!("{}:", letter_char);
        let label = if vol_name.is_empty() { letter_str.clone() } else { vol_name };
        drives.push(DriveInfo {
            letter: letter_str.clone(),
            label,
            path: format!("{}\\", letter_str),
            drive_type: drive_type.to_string(),
            size: if size_ok { Some(total_bytes as f64) } else { None },
            free: if size_ok { Some(free_bytes as f64) } else { None },
        });
    }

    drives
}

pub fn has_subdirectories_impl(dir_path: &str) -> Result<bool, io::Error> {
    #[cfg(windows)]
    {
        if let Some(found) = has_subdirectories_winapi(dir_path) {
            return Ok(found);
        }
        // Fall through to read_dir on FindFirstFileW failure (e.g. permission
        // denied, race with deletion) so we still return a sensible answer.
    }
    let rd = std::fs::read_dir(dir_path)?;
    for entry in rd.flatten() {
        if entry.metadata().map(|m| m.is_dir()).unwrap_or(false) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// FindFirstFileW + FindNextFileW with early-out on first directory hit.
///
/// Why not `read_dir`: each `entry.metadata()` call issues a separate
/// `GetFileAttributesW` syscall. WIN32_FIND_DATAW already carries the
/// attribute flags, so this version reads them inline and stops as soon
/// as it sees a directory — typically 1-2 syscalls vs N for read_dir.
#[cfg(windows)]
fn has_subdirectories_winapi(dir_path: &str) -> Option<bool> {
    use std::ffi::OsStr;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        FindClose, FindFirstFileW, FindNextFileW, WIN32_FIND_DATAW,
    };
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_DIRECTORY;

    let pattern = format!("{}\\*", dir_path.trim_end_matches(['\\', '/']));
    let wide: Vec<u16> = OsStr::new(&pattern).encode_wide().chain(once(0)).collect();

    unsafe {
        let mut data: WIN32_FIND_DATAW = std::mem::zeroed();
        let handle = FindFirstFileW(PCWSTR(wide.as_ptr()), &mut data).ok()?;

        loop {
            let name_end = data.cFileName.iter().position(|&c| c == 0).unwrap_or(data.cFileName.len());
            let name = String::from_utf16_lossy(&data.cFileName[..name_end]);
            let is_dot = name == "." || name == "..";
            let is_dir = (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY.0) != 0;

            if !is_dot && is_dir {
                let _ = FindClose(handle);
                return Some(true);
            }
            if FindNextFileW(handle, &mut data).is_err() {
                let _ = FindClose(handle);
                return Some(false);
            }
        }
    }
}

pub fn get_stats_impl(file_path: &str) -> Result<Option<FileEntry>, io::Error> {
    let meta = match std::fs::metadata(file_path) {
        Ok(m) => m,
        Err(_) => return Ok(None),
    };
    let name = Path::new(file_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let is_dir = meta.is_dir();
    let ext = if is_dir {
        String::new()
    } else {
        Path::new(&name)
            .extension()
            .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
            .unwrap_or_default()
    };
    Ok(Some(FileEntry {
        name,
        path: file_path.to_string(),
        is_directory: is_dir,
        size: meta.len() as f64,
        modified: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0),
        created: meta
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0),
        extension: ext,
        is_hidden: false,
        is_system: false,
    }))
}

pub fn get_open_with_apps_impl(ext: &str) -> Vec<OpenWithApp> {
    let mut apps = Vec::new();
    let lower = ext.to_lowercase();

    let archive_exts = [".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".cab", ".iso"];
    if archive_exts.contains(&lower.as_str()) {
        for p in [
            r"C:\Program Files\WinRAR\WinRAR.exe",
            r"C:\Program Files (x86)\WinRAR\WinRAR.exe",
        ] {
            if Path::new(p).exists() {
                apps.push(OpenWithApp { name: "WinRAR".into(), exe_path: p.into() });
                break;
            }
        }
        for p in [
            r"C:\Program Files\7-Zip\7zFM.exe",
            r"C:\Program Files (x86)\7-Zip\7zFM.exe",
        ] {
            if Path::new(p).exists() {
                apps.push(OpenWithApp { name: "7-Zip".into(), exe_path: p.into() });
                break;
            }
        }
    }

    let code_exts = [
        ".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".md", ".txt", ".py", ".rs",
        ".go", ".yaml", ".yml", ".toml", ".sh", ".bat", ".env", ".xml",
    ];
    if code_exts.contains(&lower.as_str()) {
        let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
        for p in [
            r"C:\Program Files\Microsoft VS Code\Code.exe".to_string(),
            format!(r"{}\Programs\Microsoft VS Code\Code.exe", local_app_data),
        ] {
            if Path::new(&p).exists() {
                apps.push(OpenWithApp { name: "VS Code".into(), exe_path: p });
                break;
            }
        }
    }

    let text_exts = [".txt", ".log", ".md", ".ini", ".cfg", ".conf"];
    if text_exts.contains(&lower.as_str()) || code_exts.contains(&lower.as_str()) {
        for p in [
            r"C:\Program Files\Notepad++\notepad++.exe",
            r"C:\Program Files (x86)\Notepad++\notepad++.exe",
        ] {
            if Path::new(p).exists() {
                apps.push(OpenWithApp { name: "Notepad++".into(), exe_path: p.into() });
                break;
            }
        }
    }

    let notepad_exts = [".txt", ".log", ".md", ".ini", ".cfg", ".bat", ".csv"];
    if notepad_exts.contains(&lower.as_str()) {
        apps.push(OpenWithApp { name: "Notepad".into(), exe_path: "notepad.exe".into() });
    }

    let media_exts = [".mp4", ".mkv", ".avi", ".mov", ".mp3", ".flac", ".wav", ".aac", ".ogg"];
    if media_exts.contains(&lower.as_str()) {
        for p in [
            r"C:\Program Files\VideoLAN\VLC\vlc.exe",
            r"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe",
        ] {
            if Path::new(p).exists() {
                apps.push(OpenWithApp { name: "VLC".into(), exe_path: p.into() });
                break;
            }
        }
    }

    apps
}
