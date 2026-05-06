//! Single-folder filesystem watcher. Emits a `fs-changed` Tauri event
//! when files in the currently-watched directory change so the UI can
//! refresh its listing without a manual F5.
//!
//! Only one watcher is active at a time — when the user navigates we
//! drop the old `RecommendedWatcher` (releasing the OS handle) and
//! create a new one for the new path.

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static WATCHER: Mutex<Option<RecommendedWatcher>> = Mutex::new(None);

pub fn watch(app: AppHandle, path: String) -> Result<(), String> {
    let mut guard = WATCHER.lock().map_err(|e| e.to_string())?;
    // Drop existing watcher first so we never hold two for the same
    // directory if the user re-watches without unwatching.
    *guard = None;

    let app_clone = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            // Only flag real content changes — `Access` events fire on
            // every read and would spam the renderer.
            if matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_) | EventKind::Any
            ) {
                let _ = app_clone.emit("fs-changed", ());
            }
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(std::path::Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    *guard = Some(watcher);
    Ok(())
}

pub fn unwatch() {
    if let Ok(mut guard) = WATCHER.lock() {
        *guard = None;
    }
}
