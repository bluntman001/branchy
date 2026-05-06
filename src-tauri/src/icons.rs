#![cfg(windows)]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use std::collections::HashMap;

use crate::thumbcache;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{PngEncoder, CompressionType, FilterType as PngFilterType};
use image::ImageEncoder;

/// JPEG quality used for opaque thumbnails. 85 is the standard "high quality"
/// sweet spot — visually indistinguishable from lossless at 384px while being
/// 5-10× smaller than PNG.
const JPEG_QUALITY: u8 = 85;

/// True if any pixel in the RGBA buffer has alpha < 255 (i.e. the image
/// has real transparency that we'd lose by flattening to RGB/JPEG).
fn has_transparency(rgba: &[u8]) -> bool {
    rgba.chunks_exact(4).any(|px| px[3] != 255)
}

fn rgb_from_rgba(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        rgb.push(px[0]);
        rgb.push(px[1]);
        rgb.push(px[2]);
    }
    rgb
}

/// Encoded thumbnail blob with mime type so the caller can build a data
/// URL and choose the right disk-cache extension.
struct EncodedThumb {
    bytes: Vec<u8>,
    mime: &'static str,
}

/// Encode RGBA pixels with the smallest viable codec:
///   * `transparency_capable` source (.png/.gif/.webp/etc.) → PNG always.
///     Alpha-detection on COM-decoded bitmaps is unreliable (Windows
///     pre-composites transparency away), so we trust the source format.
///   * Otherwise: JPEG when fully opaque (5-10× smaller), PNG when alpha
///     is detected.
fn encode_thumbnail(
    rgba: &[u8],
    width: u32,
    height: u32,
    transparency_capable: bool,
) -> Option<EncodedThumb> {
    if transparency_capable || has_transparency(rgba) {
        let mut buf: Vec<u8> = Vec::with_capacity((width * height) as usize);
        let encoder = PngEncoder::new_with_quality(
            &mut buf,
            CompressionType::Default,
            PngFilterType::Adaptive,
        );
        encoder
            .write_image(rgba, width, height, image::ExtendedColorType::Rgba8)
            .ok()?;
        Some(EncodedThumb { bytes: buf, mime: "image/png" })
    } else {
        let rgb = rgb_from_rgba(rgba);
        let mut buf: Vec<u8> = Vec::with_capacity((width * height) as usize / 4);
        let encoder = JpegEncoder::new_with_quality(&mut buf, JPEG_QUALITY);
        encoder
            .write_image(&rgb, width, height, image::ExtendedColorType::Rgb8)
            .ok()?;
        Some(EncodedThumb { bytes: buf, mime: "image/jpeg" })
    }
}

/// Source-file extensions whose format can express transparency. When the
/// thumbnail comes from one of these we keep PNG output even if our alpha
/// scan says "all opaque" — otherwise Windows' pre-composited bitmaps
/// produce a baked background.
const TRANSPARENCY_EXTS: &[&str] = &[".png", ".gif", ".webp", ".ico", ".svg", ".tiff", ".tif"];

fn extension_is_transparency_capable(path: &str) -> bool {
    let lower = path.to_lowercase();
    TRANSPARENCY_EXTS.iter().any(|ext| lower.ends_with(ext))
}

fn thumb_to_data_url(thumb: &EncodedThumb) -> String {
    let mut out = String::with_capacity(thumb.bytes.len() * 4 / 3 + 24);
    out.push_str("data:");
    out.push_str(thumb.mime);
    out.push_str(";base64,");
    BASE64.encode_string(&thumb.bytes, &mut out);
    out
}

use windows::core::PCWSTR;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
    BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
};
use windows::Win32::System::Com::{
    CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
};
use windows::Win32::UI::Shell::{
    IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_BIGGERSIZEOK,
    SIIGBF_ICONONLY, SIIGBF_INCACHEONLY, SIIGBF_THUMBNAILONLY,
};

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn ensure_com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    }
}

const ICON_PX: i32 = 256;
const THUMB_PX: i32 = 384;
const MIN_CACHED_PX: i32 = 256;

pub fn get_shell_icon_impl_single(path: &str) -> String {
    get_shell_image_impl(path, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK, ICON_PX, None)
        .unwrap_or_default()
}

pub fn get_shell_icons_batch_impl(paths: &[String]) -> HashMap<String, String> {
    ensure_com();
    let mut out = HashMap::with_capacity(paths.len());
    for p in paths {
        let url = get_shell_image_impl(p, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK, ICON_PX, None)
            .unwrap_or_default();
        out.insert(p.clone(), url);
    }
    out
}

pub fn get_shell_thumbnails_batch_impl(paths: &[String]) -> HashMap<String, String> {
    ensure_com();
    let mut out = HashMap::with_capacity(paths.len());
    for p in paths {
        // For images, demand a real thumbnail (no app-icon substitutes) AND
        // require the cached entry to be ≥ MIN_CACHED_PX — Windows often stores
        // PNGs at 96px, which would render blurry. Below-threshold returns
        // None → frontend treats as miss → re-queued through the high-quality
        // Lanczos regen path in Pass 2.
        let (flags, min) = if wants_real_thumbnail(p) {
            (
                SIIGBF_INCACHEONLY | SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK,
                Some(MIN_CACHED_PX),
            )
        } else {
            (SIIGBF_INCACHEONLY | SIIGBF_BIGGERSIZEOK, None)
        };
        let url = get_shell_image_impl(p, flags, THUMB_PX, min).unwrap_or_default();
        out.insert(p.clone(), url);
    }
    out
}

/// Image extensions we can decode directly in Rust (no COM needed).
const IMAGE_EXTS: &[&str] = &[".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];

/// Video extensions — `image` crate can't decode these, so we go straight to
/// the Windows shell (which produces real frame thumbnails when a codec /
/// shell extension is installed, e.g. the bundled "Movies & TV" handler or
/// VLC's thumbnailer). Without `THUMBNAILONLY` the shell would return the
/// file's app icon; with it we get a real frame or nothing.
const VIDEO_EXTS: &[&str] = &[
    ".mp4", ".mov", ".mkv", ".avi", ".webm", ".wmv", ".m4v",
    ".flv", ".mpg", ".mpeg", ".3gp", ".ts", ".mts", ".m2ts",
    ".vob", ".ogv",
];

fn is_image_ext(path: &str) -> bool {
    let lower = path.to_lowercase();
    IMAGE_EXTS.iter().any(|ext| lower.ends_with(ext))
}

fn is_video_ext(path: &str) -> bool {
    let lower = path.to_lowercase();
    VIDEO_EXTS.iter().any(|ext| lower.ends_with(ext))
}

fn wants_real_thumbnail(path: &str) -> bool {
    is_image_ext(path) || is_video_ext(path)
}

/// Files above this size go straight to the shell instead of the `image` crate
/// — 30MB+ PNGs (e.g. AI-upscaled output) often fail or OOM the decoder.
const IMAGE_DECODE_MAX_BYTES: u64 = 25 * 1024 * 1024;

/// Sniff the first bytes to decide whether the `image` crate can decode this
/// file. Extensions lie — AVIF/HEIC files often masquerade as `.jpg`, and the
/// `image` crate without `avif-native` (which needs dav1d) can't read them.
/// Returning `false` here makes the caller drop straight to the COM fallback,
/// which can use a Windows AVIF extension if the user has one installed.
fn is_decodable_image(path: &str) -> bool {
    use std::io::Read;
    let mut f = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return false };
    let mut buf = [0u8; 16];
    let n = match f.read(&mut buf) { Ok(n) => n, Err(_) => return false };
    if n < 8 { return false; }

    // JPEG: FF D8 FF
    if buf[0] == 0xFF && buf[1] == 0xD8 && buf[2] == 0xFF { return true; }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if &buf[0..8] == b"\x89PNG\r\n\x1a\n" { return true; }
    // GIF87a / GIF89a
    if &buf[0..6] == b"GIF87a" || &buf[0..6] == b"GIF89a" { return true; }
    // BMP: 42 4D
    if buf[0] == 0x42 && buf[1] == 0x4D { return true; }
    // WEBP: RIFF....WEBP
    if n >= 12 && &buf[0..4] == b"RIFF" && &buf[8..12] == b"WEBP" { return true; }

    // ISOBMFF (AVIF/HEIC/HEIF/MP4): bytes 4..8 == "ftyp", brand at 8..12.
    // image-rs without avif-native can't decode these → bail to COM.
    false
}

/// Decode an image file directly with the `image` crate → fast, truly parallel.
fn decode_image_thumbnail(path: &str, size: u32) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > IMAGE_DECODE_MAX_BYTES {
        return None;
    }
    if !is_decodable_image(path) {
        return None;
    }
    let img = image::open(path).ok()?;
    let thumb = img.resize(size, size, image::imageops::FilterType::Lanczos3);
    let rgba = thumb.to_rgba8();
    let encoded = encode_thumbnail(
        rgba.as_raw(),
        thumb.width(),
        thumb.height(),
        extension_is_transparency_capable(path),
    )?;
    Some(thumb_to_data_url(&encoded))
}

/// Variant of `generate_shell_thumbnails_batch_impl` that returns the
/// on-disk cache file path (as a filesystem string) instead of a base64
/// data URL. The renderer loads the file via Tauri's asset protocol, so
/// the webview decodes the PNG natively — no base64 → blob round-trip,
/// no Chromium compositor quirks bleeding opaque-black through alpha.
pub fn generate_shell_thumbnails_paths_impl(paths: &[String]) -> HashMap<String, String> {
    if paths.is_empty() { return HashMap::new(); }
    ensure_com();
    let mut out = HashMap::with_capacity(paths.len());
    for p in paths {
        let path = p.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mtime = thumbcache::mtime_ms(&path);
            if let Some(file_path) = thumbcache::cached_file_path(&path, mtime) {
                return file_path;
            }
            // Cache miss: generate, write to disk, return the new path.
            let url = if is_image_ext(&path) {
                decode_image_thumbnail(&path, THUMB_PX as u32)
                    .or_else(|| get_shell_image_impl(
                        &path,
                        SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK,
                        THUMB_PX,
                        None,
                    ))
                    .unwrap_or_default()
            } else if is_video_ext(&path) {
                get_shell_image_impl(
                    &path,
                    SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK,
                    THUMB_PX,
                    None,
                )
                .unwrap_or_default()
            } else {
                get_shell_image_impl(&path, SIIGBF_BIGGERSIZEOK, THUMB_PX, None)
                    .unwrap_or_default()
            };
            if url.is_empty() { return String::new(); }
            if let Some((bytes, mime)) = thumbcache::extract_image_bytes(&url) {
                thumbcache::write(&path, mtime, &bytes, mime);
                return thumbcache::cached_file_path(&path, mtime).unwrap_or_default();
            }
            String::new()
        }));
        out.insert(p.clone(), result.unwrap_or_default());
    }
    out
}

/// Generate thumbnails one file at a time, in the exact order received.
///
/// Per file:
///   1. Image files (by magic bytes) → try `image` crate decode (fast, in-proc).
///   2. Image files where step 1 failed → COM with `SIIGBF_THUMBNAILONLY` so
///      Windows must produce a real thumbnail and is not allowed to substitute
///      the file's app icon (which happens with `SIIGBF_BIGGERSIZEOK` alone).
///   3. Non-image files → COM with default flags (icons OK, that's expected).
///
/// Each per-file decode is wrapped in `catch_unwind` so a panic on one file
/// (corrupt image, decoder bug) cannot drop later files in the batch.
pub fn generate_shell_thumbnails_batch_impl(paths: &[String]) -> HashMap<String, String> {
    if paths.is_empty() {
        return HashMap::new();
    }
    ensure_com();

    let mut out = HashMap::with_capacity(paths.len());
    for p in paths {
        let path = p.clone();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mtime = thumbcache::mtime_ms(&path);

            // Disk cache hit → instant return, no decoding work.
            if let Some(cached) = thumbcache::read(&path, mtime) {
                return cached;
            }

            let url = if is_image_ext(&path) {
                // Try in-process decode first (fastest), fall back to a
                // real Windows thumbnail.
                decode_image_thumbnail(&path, THUMB_PX as u32)
                    .or_else(|| get_shell_image_impl(
                        &path,
                        SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK,
                        THUMB_PX,
                        None,
                    ))
                    .unwrap_or_default()
            } else if is_video_ext(&path) {
                // Videos: Rust can't decode, but Windows shell extensions
                // (Movies & TV, VLC thumbnailer, etc.) can. THUMBNAILONLY
                // refuses the generic film-strip icon if no real frame is
                // available — caller then shows the FileIcon naturally.
                get_shell_image_impl(
                    &path,
                    SIIGBF_THUMBNAILONLY | SIIGBF_BIGGERSIZEOK,
                    THUMB_PX,
                    None,
                )
                .unwrap_or_default()
            } else {
                get_shell_image_impl(&path, SIIGBF_BIGGERSIZEOK, THUMB_PX, None)
                    .unwrap_or_default()
            };

            // Persist successful thumbnails so the next visit / app restart
            // is instant. Failures are deliberately not cached so a future
            // attempt can retry (e.g. user installs AV1 Video Extension).
            if !url.is_empty() {
                if let Some((bytes, mime)) = thumbcache::extract_image_bytes(&url) {
                    thumbcache::write(&path, mtime, &bytes, mime);
                }
            }
            url
        }));
        out.insert(p.clone(), result.unwrap_or_default());
    }
    out
}

fn get_shell_image_impl(
    path: &str,
    flags: SIIGBF,
    size_px: i32,
    min_px: Option<i32>,
) -> Option<String> {
    ensure_com();

    let wide = to_wide(path);
    unsafe {
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;

        let size = SIZE { cx: size_px, cy: size_px };
        let hbm: HBITMAP = factory.GetImage(size, flags).ok()?;

        struct HBitmapGuard(HBITMAP);
        impl Drop for HBitmapGuard {
            fn drop(&mut self) {
                unsafe {
                    let _ = DeleteObject(HGDIOBJ(self.0 .0));
                }
            }
        }
        let _guard = HBitmapGuard(hbm);

        let mut bmp = BITMAP::default();
        let ret = GetObjectW(
            HGDIOBJ(hbm.0),
            std::mem::size_of::<BITMAP>() as i32,
            Some(&mut bmp as *mut _ as *mut _),
        );
        if ret == 0 {
            return None;
        }

        let width = bmp.bmWidth as u32;
        let height = bmp.bmHeight.unsigned_abs();
        if width == 0 || height == 0 {
            return None;
        }

        // Reject below-threshold cached entries so the caller can re-queue
        // through a higher-quality regen path.
        if let Some(min) = min_px {
            if (width as i32) < min || (height as i32) < min {
                return None;
            }
        }

        let hdc = CreateCompatibleDC(None);

        let mut bmi: BITMAPINFO = std::mem::zeroed();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = width as i32;
        bmi.bmiHeader.biHeight = height as i32;
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;

        let row_bytes = width as usize * 4;
        let h = height as usize;
        let mut pixels = vec![0u8; row_bytes * h];
        let lines = GetDIBits(
            hdc,
            hbm,
            0,
            height,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(hdc);
        if lines == 0 {
            return None;
        }

        let w = width as usize;
        let mut rgba = vec![0u8; w * h * 4];
        for y in 0..h {
            let src_off = (h - 1 - y) * row_bytes;
            let dst_off = y * w * 4;
            for x in 0..w {
                let si = src_off + x * 4;
                let di = dst_off + x * 4;
                let b = pixels[si];
                let g = pixels[si + 1];
                let r = pixels[si + 2];
                let a = pixels[si + 3];

                let (ro, go, bo) = if a == 0 {
                    (0, 0, 0)
                } else {
                    let unp =
                        |c: u8| ((c as u32 * 255 + (a as u32 / 2)) / a as u32).min(255) as u8;
                    (unp(r), unp(g), unp(b))
                };

                rgba[di] = ro;
                rgba[di + 1] = go;
                rgba[di + 2] = bo;
                rgba[di + 3] = a;
            }
        }

        let encoded = encode_thumbnail(
            &rgba,
            width,
            height,
            extension_is_transparency_capable(path),
        )?;
        Some(thumb_to_data_url(&encoded))
    }
}
