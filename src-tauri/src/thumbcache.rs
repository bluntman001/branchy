//! Disk-backed thumbnail cache.
//!
//! Layout: `<cache_dir>/branchy/thumbs/<2-hex-shard>/<16-hex-key>.<jpg|png>`
//! Key derives from `(canonical_path, mtime_ms)` — a file modification
//! invalidates its entry automatically, so we never serve a stale thumb.
//!
//! Storage is raw JPEG bytes (q=85) for opaque images, raw PNG for images
//! with transparency. The format is encoded in the file extension; readers
//! try both extensions.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

fn cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("branchy")
        .join("thumbs")
}

// Bump when the encoder changes in a way that should invalidate every
// previously-cached thumbnail. Old entries simply stop matching and the
// next visit regenerates with the new pipeline.
const CACHE_VERSION: u32 = 3;

fn cache_key(path: &str, mtime_ms: u64) -> String {
    let mut h = DefaultHasher::new();
    CACHE_VERSION.hash(&mut h);
    path.hash(&mut h);
    mtime_ms.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn cache_dir_for(key: &str) -> PathBuf {
    let dir = cache_dir().join(&key[..2]);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn mtime_ms(path: &str) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read(path: &str, mtime_ms: u64) -> Option<String> {
    let key = cache_key(path, mtime_ms);
    let dir = cache_dir_for(&key);
    // Try JPEG first (more common — opaque images), then PNG.
    for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
        let p = dir.join(format!("{}.{}", key, ext));
        if let Ok(bytes) = std::fs::read(&p) {
            if bytes.is_empty() { continue; }
            let mut out = String::with_capacity(bytes.len() * 4 / 3 + 24);
            out.push_str("data:");
            out.push_str(mime);
            out.push_str(";base64,");
            BASE64.encode_string(&bytes, &mut out);
            return Some(out);
        }
    }
    None
}

/// Return the on-disk cache path (as a plain filesystem string) if this
/// thumb is already cached. Lets the renderer load the file directly via
/// Tauri's asset protocol — native PNG decoding by the webview, no base64
/// or blob URL round-trip, deterministic alpha rendering.
pub fn cached_file_path(path: &str, mtime_ms: u64) -> Option<String> {
    let key = cache_key(path, mtime_ms);
    let dir = cache_dir_for(&key);
    for ext in ["png", "jpg"] {
        let p = dir.join(format!("{}.{}", key, ext));
        if p.exists() && std::fs::metadata(&p).map(|m| m.len() > 0).unwrap_or(false) {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

pub fn write(path: &str, mtime_ms: u64, bytes: &[u8], mime: &str) {
    if bytes.is_empty() { return; }
    let ext = match mime {
        "image/png"  => "png",
        "image/jpeg" => "jpg",
        _ => return,
    };
    let key = cache_key(path, mtime_ms);
    let cp = cache_dir_for(&key).join(format!("{}.{}", key, ext));
    let _ = std::fs::write(&cp, bytes);
}

/// Pull raw image bytes + mime back out of a `data:image/<jpeg|png>;base64,…`
/// URL we just generated, so we can persist them with the right extension.
pub fn extract_image_bytes(data_url: &str) -> Option<(Vec<u8>, &'static str)> {
    if let Some(stripped) = data_url.strip_prefix("data:image/jpeg;base64,") {
        return BASE64.decode(stripped).ok().map(|b| (b, "image/jpeg"));
    }
    if let Some(stripped) = data_url.strip_prefix("data:image/png;base64,") {
        return BASE64.decode(stripped).ok().map(|b| (b, "image/png"));
    }
    None
}
