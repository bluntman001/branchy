# Native Win32 Drag-and-Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tauri-plugin-drag with our own in-process Win32 drag-and-drop so dragging files out of Branchy (to Chrome/VS Code/Explorer) works reliably every time, and internal drag-onto-folder keeps working via a Win32 `IDropTarget`.

**Architecture:** Subclass the WebView2 child HWND so `DoDragDrop` is invoked synchronously inside the OS mouse-message handler (no IPC race). A custom `IDataObject` exposes CF_HDROP + text/uri-list with no shell delegate. `IDropTarget` on the Tauri main HWND catches in-app drops and emits a Tauri event so JS can hit-test cursor coords against folder rows.

**Tech Stack:** Rust + windows-rs 0.58 (`implement`, `Win32_System_Ole`, `Win32_System_Com_StructuredStorage`, `Win32_System_DataExchange`, `Win32_UI_Shell`), Tauri 2, React + TypeScript.

**Manual-verification note:** Win32 message-pump / COM code can't be meaningfully unit-tested. For these tasks, verification is "build succeeds + drag works in the real app + log file shows expected hresults". Tasks that DO have testable pure logic (pending state with stale-timeout, DROPFILES byte layout, JS hit-testing) include unit tests.

---

## Files

**New Rust:**
- `src-tauri/src/win32_drag/mod.rs` — public API (`install`, `prepare_drag` command)
- `src-tauri/src/win32_drag/pending.rs` — `PendingDrag` state + helpers
- `src-tauri/src/win32_drag/data_object.rs` — `IDataObject` (CF_HDROP + text/uri-list)
- `src-tauri/src/win32_drag/drop_source.rs` — `IDropSource`
- `src-tauri/src/win32_drag/subclass.rs` — `SetWindowSubclass` + window proc
- `src-tauri/src/win32_drag/drop_target.rs` — `IDropTarget`

**New TypeScript:**
- `src/renderer/hooks/useInternalDrop.ts` — listens for `internal-drop` Tauri event, hit-tests folder rows, calls `moveFiles`

**Modified Rust:**
- `src-tauri/Cargo.toml` — add `Win32_System_DataExchange` feature; remove `tauri-plugin-drag` dep + `[patch.crates-io]` block
- `src-tauri/src/lib.rs` — wire `win32_drag::install`, register `prepare_drag` command, drop `tauri_plugin_drag::init()`
- `src-tauri/capabilities/default.json` — remove `drag:default`

**Modified TypeScript:**
- `src/api.ts` — add `prepareDrag`, remove `startDrag`/`startNativeDrag`/`getDragIconPath`/`extractArchive`-touch-only
- `src/types.d.ts` — match `api.ts`
- `src/renderer/components/FileBrowser.tsx` — drop HTML5 file-row drag, add `onMouseDown` → `prepareDrag`, remove HTML5 folder-drop handlers, add `data-folder-path` on folder rows
- `src/renderer/components/FolderTree.tsx` — add `data-folder-path` on folder rows
- `src/renderer/App.tsx` — mount `useInternalDrop`

**Deleted:**
- `src-tauri/vendor/drag/` (entire directory)
- `@crabnebula/tauri-plugin-drag` from `package.json`

---

## Task 1: Cargo feature setup

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the DataExchange feature for `RegisterClipboardFormatW`**

Open `src-tauri/Cargo.toml`. In the `windows` dependency's features list, add `"Win32_System_DataExchange"`:

```toml
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_UI_Shell",
    "Win32_UI_Shell_Common",
    "Win32_Graphics_Gdi",
    "Win32_Graphics_Imaging",
    "Win32_System_Com",
    "Win32_System_Com_StructuredStorage",
    "Win32_System_Memory",
    "Win32_System_Ole",
    "Win32_System_SystemServices",
    "Win32_System_DataExchange",
    "Win32_Storage_FileSystem",
    "Win32_UI_WindowsAndMessaging",
    "implement",
] }
windows-core = "0.58"
```

- [ ] **Step 2: Verify Cargo accepts the feature**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` (no errors). Warnings about unused features are fine.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml
git commit -m "Cargo: enable Win32_System_DataExchange for RegisterClipboardFormatW"
```

---

## Task 2: Empty module scaffold

**Files:**
- Create: `src-tauri/src/win32_drag/mod.rs`
- Create: `src-tauri/src/win32_drag/pending.rs`
- Create: `src-tauri/src/win32_drag/data_object.rs`
- Create: `src-tauri/src/win32_drag/drop_source.rs`
- Create: `src-tauri/src/win32_drag/subclass.rs`
- Create: `src-tauri/src/win32_drag/drop_target.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create the module dir + empty submodule files**

```bash
mkdir -p src-tauri/src/win32_drag
```

Then create all six files with `// placeholder` content so the module compiles:

`src-tauri/src/win32_drag/mod.rs`:
```rust
//! Native Win32 drag-and-drop for Branchy. Replaces tauri-plugin-drag.
#![cfg(windows)]

mod pending;
mod data_object;
mod drop_source;
mod subclass;
mod drop_target;
```

`src-tauri/src/win32_drag/pending.rs`:
```rust
//! Pending drag state — set by `prepare_drag` IPC, consumed by the
//! window subclass when the user crosses the OS drag threshold.
```

`src-tauri/src/win32_drag/data_object.rs`:
```rust
//! IDataObject implementing CF_HDROP + text/uri-list (no shell delegate).
```

`src-tauri/src/win32_drag/drop_source.rs`:
```rust
//! Minimal IDropSource: monitors L-button + Esc for drag-cancel/drop.
```

`src-tauri/src/win32_drag/subclass.rs`:
```rust
//! SetWindowSubclass on the WebView2 child HWND. Calls DoDragDrop
//! synchronously from inside WM_MOUSEMOVE when the user has pending
//! drag paths and has moved past the OS drag threshold.
```

`src-tauri/src/win32_drag/drop_target.rs`:
```rust
//! IDropTarget on the Tauri main HWND for in-app drops. Emits the
//! `internal-drop` Tauri event with cursor coords + dropped paths.
```

- [ ] **Step 2: Register the module in `lib.rs`**

Find the top of `src-tauri/src/lib.rs` where other modules are declared. Add:

```rust
#[cfg(windows)]
mod win32_drag;
```

near the existing `#[cfg(windows)] mod thumbcache;` line.

- [ ] **Step 3: Build to verify scaffold compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished`. May warn about unused module — fine, we'll use it shortly.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/win32_drag/ src-tauri/src/lib.rs
git commit -m "Scaffold src-tauri/src/win32_drag module"
```

---

## Task 3: Pending-state implementation (with unit test)

**Files:**
- Modify: `src-tauri/src/win32_drag/pending.rs`

- [ ] **Step 1: Write the failing test first**

Append to `src-tauri/src/win32_drag/pending.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;

    #[test]
    fn set_and_take_within_window_returns_paths() {
        clear();
        set(vec!["C:\\a.txt".into(), "C:\\b.txt".into()]);
        let taken = take_if_fresh();
        assert_eq!(
            taken.map(|p| p.paths),
            Some(vec!["C:\\a.txt".into(), "C:\\b.txt".into()])
        );
    }

    #[test]
    fn take_after_stale_returns_none() {
        clear();
        set(vec!["C:\\stale.txt".into()]);
        sleep(STALE_AFTER + Duration::from_millis(50));
        assert!(take_if_fresh().is_none());
    }

    #[test]
    fn take_drains_state() {
        clear();
        set(vec!["C:\\once.txt".into()]);
        assert!(take_if_fresh().is_some());
        assert!(take_if_fresh().is_none(), "state should be drained after take");
    }

    #[test]
    fn clear_removes_pending() {
        set(vec!["C:\\x.txt".into()]);
        clear();
        assert!(take_if_fresh().is_none());
    }
}
```

- [ ] **Step 2: Run test, verify it fails to compile (no impl yet)**

```bash
cd src-tauri && cargo test --lib win32_drag::pending 2>&1 | tail -10
```

Expected: build error — `set`, `take_if_fresh`, `clear`, `STALE_AFTER` not defined.

- [ ] **Step 3: Implement the minimum to make tests pass**

Prepend to `src-tauri/src/win32_drag/pending.rs`:

```rust
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const STALE_AFTER: Duration = Duration::from_millis(500);

pub struct PendingDrag {
    pub paths: Vec<String>,
    set_at: Instant,
}

static PENDING: Mutex<Option<PendingDrag>> = Mutex::new(None);

pub fn set(paths: Vec<String>) {
    if let Ok(mut g) = PENDING.lock() {
        *g = Some(PendingDrag { paths, set_at: Instant::now() });
    }
}

/// Atomically remove the pending state if present and not stale.
pub fn take_if_fresh() -> Option<PendingDrag> {
    let mut g = PENDING.lock().ok()?;
    let p = g.take()?;
    if p.set_at.elapsed() <= STALE_AFTER {
        Some(p)
    } else {
        None
    }
}

pub fn clear() {
    if let Ok(mut g) = PENDING.lock() {
        *g = None;
    }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd src-tauri && cargo test --lib win32_drag::pending 2>&1 | tail -10
```

Expected: `test result: ok. 4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/win32_drag/pending.rs
git commit -m "win32_drag: pending state with 500ms stale timeout"
```

---

## Task 4: `prepare_drag` Tauri command

**Files:**
- Modify: `src-tauri/src/win32_drag/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command in `win32_drag/mod.rs`**

Append:

```rust
/// Set the pending drag paths from JS. Called from the file row's
/// `onMouseDown` so by the time the user crosses the OS drag threshold
/// the subclass already knows what to drag.
#[tauri::command]
pub fn prepare_drag(paths: Vec<String>) {
    pending::set(paths);
}
```

- [ ] **Step 2: Register the command in `lib.rs` `invoke_handler!`**

Find the `tauri::generate_handler!` macro in `src-tauri/src/lib.rs` and add `win32_drag::prepare_drag` to the list (Windows-only — gate it):

```rust
.invoke_handler({
    #[cfg(windows)] {
        tauri::generate_handler![
            // ... existing commands ...
            win32_drag::prepare_drag,
        ]
    }
    #[cfg(not(windows))] {
        tauri::generate_handler![ /* existing commands without prepare_drag */ ]
    }
})
```

(If `lib.rs` currently uses a single non-`cfg`'d `invoke_handler!` call, the simplest fix is to add `win32_drag::prepare_drag` to that list and `#[cfg(windows)]`-gate just that one identifier — Tauri's macro supports per-item gating in 2.x.)

Concretely, add this line wherever other handlers are listed:

```rust
            #[cfg(windows)]
            win32_drag::prepare_drag,
```

- [ ] **Step 3: Build to verify it compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/win32_drag/mod.rs src-tauri/src/lib.rs
git commit -m "win32_drag: prepare_drag Tauri command"
```

---

## Task 5: JS side — `prepareDrag` API + `onMouseDown` on file rows

**Files:**
- Modify: `src/api.ts`
- Modify: `src/types.d.ts`
- Modify: `src/renderer/components/FileBrowser.tsx`

- [ ] **Step 1: Add `prepareDrag` to the API**

Open `src/api.ts`. Add a method on the `fileAPI` object (anywhere near the other drag-related stuff):

```ts
  /** Set the pending drag paths in the native subclass. Fire-and-forget;
   *  if the user only clicks (no drag motion), the pending state expires
   *  on its own. */
  async prepareDrag(paths: string[]): Promise<void> {
    return invoke('prepare_drag', { paths });
  },
```

- [ ] **Step 2: Update the type declaration**

Open `src/types.d.ts`. Find the `FileAPI` interface and add:

```ts
  prepareDrag(paths: string[]): Promise<void>;
```

- [ ] **Step 3: Add `onMouseDown` to each file row in `FileBrowser.tsx`**

Find the file-row `<div>` (search for `draggable` — there are two, one in `DetailsRow` and one in `ThumbCard`). Add this prop handler to both (and add `entry`, `selected`, `fileAPI` to the scope if not already there):

```tsx
onMouseDown={(e) => {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest('input, textarea')) return;
  const paths = isSelected ? selectedPaths : [entry.path];
  fileAPI.prepareDrag(paths).catch(() => { /* noop */ });
}}
```

Where `selectedPaths` is the array of currently selected paths (the same value passed to the existing `handleDragStart`). If it's not already in scope as a prop or via the selection hook, add it the same way `handleDragStart` accesses selection now.

Keep the existing `draggable` attribute and `handleDragStart` for now — we'll remove them in a later task once external drag is verified working.

- [ ] **Step 4: Build the dev app + verify nothing visibly broken**

```bash
npm run dev
```

Open the app. Click a file. Open the log file: `%LOCALAPPDATA%\com.branchy.filemanager\logs\Branchy.log`. There won't be `[drag]` lines yet (subclass not installed), but the app should not crash. Close the app.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/types.d.ts src/renderer/components/FileBrowser.tsx
git commit -m "JS: prepareDrag IPC + onMouseDown on file rows"
```

---

## Task 6: `DataObject` struct + CF_HDROP HGLOBAL builder

**Files:**
- Modify: `src-tauri/src/win32_drag/data_object.rs`

- [ ] **Step 1: Write the failing test for the DROPFILES buffer**

Append to `data_object.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_dropfiles_buffer_layout() {
        let paths = vec![
            std::path::PathBuf::from("C:\\a.txt"),
            std::path::PathBuf::from("C:\\b.txt"),
        ];
        let bytes = build_dropfiles_buffer(&paths);
        // First 20 bytes are the DROPFILES header — pFiles=20, fWide=1.
        let p_files = u32::from_le_bytes(bytes[0..4].try_into().unwrap());
        let f_wide = u32::from_le_bytes(bytes[16..20].try_into().unwrap());
        assert_eq!(p_files, 20, "pFiles should be sizeof(DROPFILES)");
        assert_eq!(f_wide, 1, "fWide should be TRUE for UTF-16 paths");
        // Total size: 20 header + (8 wide chars * 2 bytes + 1 null * 2) * 2 paths + 1 final null * 2
        // Wait, each path is "C:\\a.txt" = 7 chars + null = 8 wide chars = 16 bytes.
        // 16 * 2 + 2 (final null) = 34 bytes of path data. + 20 header = 54 bytes total.
        assert_eq!(bytes.len(), 54);
        // Verify there's a final double-null at the end.
        assert_eq!(&bytes[52..54], &[0u8, 0u8]);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd src-tauri && cargo test --lib win32_drag::data_object 2>&1 | tail -10
```

Expected: build error — `build_dropfiles_buffer` not defined.

- [ ] **Step 3: Implement `build_dropfiles_buffer` (pure function, no Win32 yet)**

Prepend to `data_object.rs`:

```rust
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

/// Build a CF_HDROP HGLOBAL payload (DROPFILES header + null-terminated
/// UTF-16 paths + final extra null). Pure function so it's unit-testable.
pub fn build_dropfiles_buffer(paths: &[std::path::PathBuf]) -> Vec<u8> {
    // DROPFILES is 20 bytes on x64: pFiles(u32) + pt(POINT{i32,i32}) + fNC(BOOL) + fWide(BOOL).
    const HEADER_SIZE: usize = 20;
    let mut wide_paths_bytes = 0usize;
    for p in paths {
        let nchars = p.as_os_str().encode_wide().count() + 1; // + null terminator
        wide_paths_bytes += nchars * 2;
    }
    wide_paths_bytes += 2; // final double-null terminator (one extra u16=0)

    let mut buf = vec![0u8; HEADER_SIZE + wide_paths_bytes];
    // pFiles = offset to the path block = sizeof(DROPFILES)
    buf[0..4].copy_from_slice(&(HEADER_SIZE as u32).to_le_bytes());
    // pt is bytes 4..16 — already zero from vec![0; ...]
    // fNC is bytes 16..20 — wait no, fNC then fWide. Let me get the order right.
    // DROPFILES: DWORD pFiles; POINT pt; BOOL fNC; BOOL fWide;
    // POINT is { LONG x; LONG y; } = 8 bytes. So:
    // 0..4   pFiles
    // 4..12  pt (8 bytes)
    // 12..16 fNC
    // 16..20 fWide
    buf[16..20].copy_from_slice(&1u32.to_le_bytes()); // fWide = TRUE

    let mut cursor = HEADER_SIZE;
    for p in paths {
        for u in p.as_os_str().encode_wide().chain(std::iter::once(0u16)) {
            buf[cursor..cursor + 2].copy_from_slice(&u.to_le_bytes());
            cursor += 2;
        }
    }
    // final double-null already zeroed
    buf
}

#[allow(dead_code)]
fn _check_path_unused(_p: &Path) {}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd src-tauri && cargo test --lib win32_drag::data_object 2>&1 | tail -10
```

Expected: `test result: ok. 1 passed`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/win32_drag/data_object.rs
git commit -m "win32_drag: CF_HDROP buffer builder + unit test"
```

---

## Task 7: text/uri-list builder (with unit test)

**Files:**
- Modify: `src-tauri/src/win32_drag/data_object.rs`

- [ ] **Step 1: Write the failing test**

Append a test to the existing `tests` mod:

```rust
    #[test]
    fn build_uri_list_drive_letter() {
        let paths = vec![std::path::PathBuf::from("C:\\a b\\c.txt")];
        let s = build_uri_list_string(&paths);
        // Forward slashes, CRLF terminator. Spaces stay literal — drop
        // targets URL-decode if they want.
        assert_eq!(s, "file:///C:/a b/c.txt\r\n");
    }

    #[test]
    fn build_uri_list_unc_path() {
        let paths = vec![std::path::PathBuf::from("\\\\server\\share\\file")];
        let s = build_uri_list_string(&paths);
        assert_eq!(s, "file://server/share/file\r\n");
    }

    #[test]
    fn build_uri_list_multiple_paths() {
        let paths = vec![
            std::path::PathBuf::from("C:\\a"),
            std::path::PathBuf::from("D:\\b"),
        ];
        let s = build_uri_list_string(&paths);
        assert_eq!(s, "file:///C:/a\r\nfile:///D:/b\r\n");
    }
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd src-tauri && cargo test --lib win32_drag::data_object 2>&1 | tail -10
```

Expected: `build_uri_list_string` not defined.

- [ ] **Step 3: Implement**

Append to `data_object.rs` (above the `tests` mod):

```rust
/// Build the `text/uri-list` payload: UTF-8, CRLF-separated `file://` URLs.
pub fn build_uri_list_string(paths: &[std::path::PathBuf]) -> String {
    let mut s = String::new();
    for p in paths {
        let display = p.to_string_lossy().replace('\\', "/");
        if let Some(rest) = display.strip_prefix("//") {
            // UNC: \\server\share\file → file://server/share/file
            s.push_str("file://");
            s.push_str(rest);
        } else {
            // Drive-letter: C:\path → file:///C:/path
            s.push_str("file:///");
            s.push_str(&display);
        }
        s.push_str("\r\n");
    }
    s
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
cd src-tauri && cargo test --lib win32_drag::data_object 2>&1 | tail -10
```

Expected: `test result: ok. 4 passed`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/win32_drag/data_object.rs
git commit -m "win32_drag: text/uri-list builder + unit tests"
```

---

## Task 8: Full `IDataObject` impl wrapping the builders

**Files:**
- Modify: `src-tauri/src/win32_drag/data_object.rs`

This task is large but mostly boilerplate trait methods. The two interesting bits — building the two formats — are already done and tested.

- [ ] **Step 1: Add the imports + `DataObject` struct + clipboard-format cache**

At the very top of `data_object.rs` (replacing the existing `use` lines):

```rust
#![cfg(windows)]

use std::iter::once;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use windows::core::{implement, HRESULT, HSTRING, PCWSTR};
use windows::Win32::Foundation::{
    BOOL, DV_E_FORMATETC, E_NOTIMPL, HGLOBAL, OLE_E_ADVISENOTSUPPORTED, S_OK,
};
use windows::Win32::System::Com::{
    IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA, FORMATETC,
    STGMEDIUM, STGMEDIUM_0, DVASPECT_CONTENT, TYMED_HGLOBAL,
};
use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_FIXED};
use windows::Win32::System::Ole::CF_HDROP;
use windows::Win32::UI::Shell::DROPFILES;
```

(Replace any conflicting old `use` lines.)

- [ ] **Step 2: Add the `DataObject` struct**

Below the existing builder functions:

```rust
#[implement(IDataObject)]
pub struct DataObject {
    files: Vec<PathBuf>,
}

impl DataObject {
    pub fn new(files: Vec<PathBuf>) -> Self {
        Self { files }
    }
}

fn uri_list_clipboard_format() -> u16 {
    static FMT: OnceLock<u16> = OnceLock::new();
    *FMT.get_or_init(|| unsafe {
        let wide: Vec<u16> = "text/uri-list".encode_utf16().chain(once(0)).collect();
        RegisterClipboardFormatW(PCWSTR::from_raw(wide.as_ptr())) as u16
    })
}

fn is_hdrop(fmt: *const FORMATETC) -> bool {
    unsafe {
        if let Some(f) = fmt.as_ref() {
            f.tymed as i32 == TYMED_HGLOBAL.0
                && f.cfFormat == CF_HDROP.0
                && f.dwAspect == DVASPECT_CONTENT.0
        } else { false }
    }
}

fn is_uri_list(fmt: *const FORMATETC) -> bool {
    unsafe {
        if let Some(f) = fmt.as_ref() {
            f.tymed as i32 == TYMED_HGLOBAL.0
                && f.cfFormat == uri_list_clipboard_format()
                && f.dwAspect == DVASPECT_CONTENT.0
        } else { false }
    }
}

fn alloc_hglobal(bytes: &[u8]) -> windows::core::Result<HGLOBAL> {
    unsafe {
        let h = GlobalAlloc(GMEM_FIXED, bytes.len())?;
        let p = GlobalLock(h) as *mut u8;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        let _ = GlobalUnlock(h);
        Ok(h)
    }
}
```

- [ ] **Step 3: Implement `IDataObject_Impl`**

Append:

```rust
#[allow(non_snake_case)]
impl IDataObject_Impl for DataObject {
    fn GetData(&self, fmt: *const FORMATETC) -> windows::core::Result<STGMEDIUM> {
        if is_hdrop(fmt) {
            let bytes = build_dropfiles_buffer(&self.files);
            let hg = alloc_hglobal(&bytes)?;
            Ok(STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: hg },
                pUnkForRelease: std::mem::ManuallyDrop::new(None),
            })
        } else if is_uri_list(fmt) {
            let s = build_uri_list_string(&self.files);
            let bytes = s.as_bytes();
            // Null-terminate to be safe — some receivers expect it.
            let mut owned = Vec::with_capacity(bytes.len() + 1);
            owned.extend_from_slice(bytes);
            owned.push(0);
            let hg = alloc_hglobal(&owned)?;
            Ok(STGMEDIUM {
                tymed: TYMED_HGLOBAL.0 as u32,
                u: STGMEDIUM_0 { hGlobal: hg },
                pUnkForRelease: std::mem::ManuallyDrop::new(None),
            })
        } else {
            Err(windows::core::Error::new(DV_E_FORMATETC, ""))
        }
    }

    fn GetDataHere(&self, _fmt: *const FORMATETC, _med: *mut STGMEDIUM) -> windows::core::Result<()> {
        Err(windows::core::Error::new(DV_E_FORMATETC, ""))
    }

    fn QueryGetData(&self, fmt: *const FORMATETC) -> HRESULT {
        if is_hdrop(fmt) || is_uri_list(fmt) { S_OK } else { DV_E_FORMATETC }
    }

    fn GetCanonicalFormatEtc(&self, _in_: *const FORMATETC, out: *mut FORMATETC) -> HRESULT {
        unsafe { if !out.is_null() { (*out).ptd = std::ptr::null_mut(); } }
        E_NOTIMPL
    }

    fn SetData(&self, _fmt: *const FORMATETC, _med: *const STGMEDIUM, _release: BOOL)
        -> windows::core::Result<()>
    {
        Err(windows::core::Error::new(E_NOTIMPL, ""))
    }

    fn EnumFormatEtc(&self, _dir: u32) -> windows::core::Result<IEnumFORMATETC> {
        let formats = [
            FORMATETC {
                cfFormat: CF_HDROP.0,
                ptd: std::ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            },
            FORMATETC {
                cfFormat: uri_list_clipboard_format(),
                ptd: std::ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            },
        ];
        unsafe { windows::Win32::UI::Shell::SHCreateStdEnumFmtEtc(&formats) }
    }

    fn DAdvise(&self, _f: *const FORMATETC, _a: u32, _s: Option<&IAdviseSink>)
        -> windows::core::Result<u32>
    {
        Err(windows::core::Error::new(OLE_E_ADVISENOTSUPPORTED, ""))
    }
    fn DUnadvise(&self, _c: u32) -> windows::core::Result<()> {
        Err(windows::core::Error::new(OLE_E_ADVISENOTSUPPORTED, ""))
    }
    fn EnumDAdvise(&self) -> windows::core::Result<IEnumSTATDATA> {
        Err(windows::core::Error::new(OLE_E_ADVISENOTSUPPORTED, ""))
    }
}
```

- [ ] **Step 4: Build to verify it compiles**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
```

Expected: `Finished`. Warnings about unused `Path` import or similar are fine.

- [ ] **Step 5: Re-run the unit tests to make sure they still pass**

```bash
cd src-tauri && cargo test --lib win32_drag::data_object 2>&1 | tail -10
```

Expected: `test result: ok. 4 passed`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/win32_drag/data_object.rs
git commit -m "win32_drag: full IDataObject impl (CF_HDROP + text/uri-list)"
```

---

## Task 9: `IDropSource` impl

**Files:**
- Modify: `src-tauri/src/win32_drag/drop_source.rs`

- [ ] **Step 1: Implement**

Replace the placeholder content of `drop_source.rs` with:

```rust
#![cfg(windows)]

use windows::core::{implement, HRESULT};
use windows::Win32::Foundation::{BOOL, S_OK};
use windows::Win32::System::Ole::{
    IDropSource, IDropSource_Impl, DROPEFFECT,
};
use windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};

// Standard OLE drag-drop result codes that aren't always exposed publicly.
pub const DRAGDROP_S_DROP:   HRESULT = HRESULT(0x00040100u32 as i32);
pub const DRAGDROP_S_CANCEL: HRESULT = HRESULT(0x00040101u32 as i32);
const DRAGDROP_S_USEDEFAULTCURSORS: HRESULT = HRESULT(0x00040102u32 as i32);

#[implement(IDropSource)]
pub struct DropSource;

#[allow(non_snake_case)]
impl IDropSource_Impl for DropSource {
    fn QueryContinueDrag(&self, escape_pressed: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape_pressed.as_bool() {
            DRAGDROP_S_CANCEL
        } else if (keys & MK_LBUTTON) == MODIFIERKEYS_FLAGS(0) {
            DRAGDROP_S_DROP
        } else {
            S_OK
        }
    }

    fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}
```

- [ ] **Step 2: Build**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/win32_drag/drop_source.rs
git commit -m "win32_drag: minimal IDropSource (L-button + Esc monitoring)"
```

---

## Task 10: Locate the WebView2 child HWND

**Files:**
- Modify: `src-tauri/src/win32_drag/subclass.rs`

- [ ] **Step 1: Add the search helper**

Replace the placeholder content of `subclass.rs` with:

```rust
#![cfg(windows)]

use std::iter::once;
use std::os::windows::ffi::OsStrExt;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW};

/// Walk the children of `parent` and return the first whose window-class
/// name starts with "Chrome_WidgetWin_". That's the host HWND for the
/// WebView2 instance Tauri creates.
pub fn find_webview2_child(parent: HWND) -> Option<HWND> {
    struct State { found: Option<HWND> }
    let mut state = State { found: None };

    unsafe extern "system" fn enum_proc(child: HWND, lparam: LPARAM) -> BOOL {
        let state = unsafe { &mut *(lparam.0 as *mut State) };
        let mut name = [0u16; 256];
        let len = unsafe { GetClassNameW(child, &mut name) } as usize;
        if len > 0 {
            let class_name = String::from_utf16_lossy(&name[..len]);
            if class_name.starts_with("Chrome_WidgetWin_") {
                state.found = Some(child);
                return BOOL(0); // stop enumeration
            }
        }
        TRUE
    }

    unsafe {
        let _ = EnumChildWindows(
            Some(parent),
            Some(enum_proc),
            LPARAM(&mut state as *mut _ as isize),
        );
    }
    state.found
}

// Silence unused-imports until we actually use these in the next task.
#[allow(dead_code)]
fn _unused(_a: PCWSTR, _b: impl Iterator<Item = u16>) {
    let _: Vec<u16> = "x".encode_utf16().chain(once(0)).collect();
}
```

- [ ] **Step 2: Build**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/win32_drag/subclass.rs
git commit -m "win32_drag: find_webview2_child via EnumChildWindows"
```

---

## Task 11: Window-subclass proc with `DoDragDrop` call

**Files:**
- Modify: `src-tauri/src/win32_drag/subclass.rs`
- Modify: `src-tauri/src/win32_drag/mod.rs`

- [ ] **Step 1: Add the subclass proc and `install` function**

Append to `subclass.rs` (replace the `#[allow(dead_code)] fn _unused` line — those imports will be used now):

```rust
use std::cell::Cell;
use std::path::PathBuf;
use std::sync::atomic::{AtomicIsize, Ordering};

use windows::Win32::Foundation::{LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::{
    DoDragDrop, IDropSource, OleInitialize, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE,
};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXDRAG, SM_CYDRAG,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
};

use super::data_object::DataObject;
use super::drop_source::DropSource;
use super::pending;

const SUBCLASS_ID: usize = 0xBA10C71D; // arbitrary; just must be stable per HWND

// Cursor position recorded at WM_LBUTTONDOWN. Stored as packed i32 pair
// in an AtomicIsize so we don't need a Mutex on the hot path.
// Top 32 bits = y, bottom 32 bits = x. -1/-1 sentinel for "no button down".
static DOWN_POS: AtomicIsize = AtomicIsize::new(-1);

fn pack_pos(x: i32, y: i32) -> isize {
    ((y as isize) << 32) | ((x as isize) & 0xFFFF_FFFF)
}
fn unpack_pos(v: isize) -> (i32, i32) {
    let x = (v & 0xFFFF_FFFF) as i32;
    let y = (v >> 32) as i32;
    (x, y)
}
const POS_NONE: isize = -1;

unsafe extern "system" fn drag_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid_subclass: usize,
    _ref_data: usize,
) -> LRESULT {
    match msg {
        WM_LBUTTONDOWN => {
            let x = (lparam.0 & 0xFFFF) as i16 as i32;
            let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
            DOWN_POS.store(pack_pos(x, y), Ordering::Release);
        }
        WM_LBUTTONUP => {
            DOWN_POS.store(POS_NONE, Ordering::Release);
            pending::clear();
        }
        WM_MOUSEMOVE => {
            let down = DOWN_POS.load(Ordering::Acquire);
            if down != POS_NONE {
                let (dx, dy) = unpack_pos(down);
                let x = (lparam.0 & 0xFFFF) as i16 as i32;
                let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
                let dx_pix = unsafe { GetSystemMetrics(SM_CXDRAG) };
                let dy_pix = unsafe { GetSystemMetrics(SM_CYDRAG) };
                if (x - dx).abs() > dx_pix || (y - dy).abs() > dy_pix {
                    // Crossed the drag threshold. If JS has armed a drag,
                    // take it and fire DoDragDrop synchronously.
                    if let Some(p) = pending::take_if_fresh() {
                        // Reset the down-pos so this only fires once per mousedown.
                        DOWN_POS.store(POS_NONE, Ordering::Release);
                        let paths: Vec<PathBuf> = p.paths.iter().map(PathBuf::from).collect();
                        run_do_drag_drop(paths);
                    }
                }
            }
        }
        _ => {}
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

fn run_do_drag_drop(paths: Vec<PathBuf>) {
    unsafe {
        // Idempotent — returns S_FALSE if already initialized.
        let _ = OleInitialize(Some(std::ptr::null_mut()));
    }
    let data_object: IDataObject = DataObject::new(paths).into();
    let drop_source: IDropSource = DropSource.into();
    let allowed = DROPEFFECT(DROPEFFECT_COPY.0 | DROPEFFECT_MOVE.0);
    let mut effect = DROPEFFECT::default();
    let hr = unsafe { DoDragDrop(&data_object, &drop_source, allowed, &mut effect) };
    log::info!(
        "[drag] DoDragDrop hresult=0x{:08x} out_effect=0x{:x}",
        hr.0, effect.0,
    );
}

pub fn install(parent: HWND) -> bool {
    let Some(child) = find_webview2_child(parent) else {
        log::error!("[drag] could not find WebView2 child HWND under parent {:?}", parent);
        return false;
    };
    let ok = unsafe { SetWindowSubclass(child, Some(drag_proc), SUBCLASS_ID, 0).as_bool() };
    if ok {
        log::info!("[drag] subclassed WebView2 child HWND {:?}", child);
    } else {
        log::error!("[drag] SetWindowSubclass failed on {:?}", child);
    }
    ok
}
```

- [ ] **Step 2: Export `install` from `win32_drag/mod.rs`**

Append to `src-tauri/src/win32_drag/mod.rs`:

```rust
pub use subclass::install as install_subclass;
```

- [ ] **Step 3: Build**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
```

Expected: `Finished`. If there's a `ScreenToClient`/`POINT` unused warning, ignore it — drop target will use those.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/win32_drag/subclass.rs src-tauri/src/win32_drag/mod.rs
git commit -m "win32_drag: WebView2 subclass + synchronous DoDragDrop"
```

---

## Task 12: Install the subclass at app startup

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add a `.setup` callback to the Tauri builder**

Open `src-tauri/src/lib.rs`. Find the `tauri::Builder::default()` chain. Add a `.setup` callback before `.invoke_handler`:

```rust
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    if let Ok(parent) = win.hwnd() {
                        win32_drag::install_subclass(parent);
                    }
                }
            }
            Ok(())
        })
```

(`tauri::Manager` and `app.get_webview_window` are stable APIs in Tauri 2.)

- [ ] **Step 2: Build dev**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Manual verification — log shows subclass installed**

Run the built exe. Look at `%LOCALAPPDATA%\com.branchy.filemanager\logs\Branchy.log`. Expect a line:

```
[drag] subclassed WebView2 child HWND HWND(...)
```

Close the app.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "lib: install win32_drag subclass on app startup"
```

---

## Task 13: Manually verify external drag works

**Files:** (no code changes)

- [ ] **Step 1: Run the built exe**

```bash
src-tauri/target/release/branchy.exe
```

- [ ] **Step 2: Drag a file from Branchy onto VS Code or Notepad**

Click a file row, hold the mouse button, drag onto the target app, release.

- [ ] **Step 3: Check the log**

```bash
tail -20 "$LOCALAPPDATA/com.branchy.filemanager/logs/Branchy.log"
```

Expect:

```
[drag] DoDragDrop hresult=0x00040100 out_effect=...
```

`0x00040100` is `DRAGDROP_S_DROP` — success.

- [ ] **Step 4: Repeat with 5+ different drags**

All should log `0x00040100` (success) or `0x00040101` (user cancelled by Esc / release on non-target). **None should log `0x80004005` (E_FAIL).**

If E_FAIL shows up, stop and investigate — the architecture should prevent this. Possible cause: subclass not actually intercepting messages, or JS not calling `prepareDrag` before the drag motion. Check earlier-task logs for clues.

- [ ] **Step 5: Commit (no code change, but marks the milestone)**

Nothing to commit. Move on.

---

## Task 14: `IDropTarget` skeleton (DragEnter / DragOver / DragLeave)

**Files:**
- Modify: `src-tauri/src/win32_drag/drop_target.rs`

- [ ] **Step 1: Implement the trait skeleton (no Drop body yet)**

Replace placeholder content of `drop_target.rs`:

```rust
#![cfg(windows)]

use windows::core::implement;
use windows::Win32::Foundation::{POINTL};
use windows::Win32::System::Com::IDataObject;
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, DROPEFFECT, DROPEFFECT_MOVE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;

use tauri::{AppHandle, Runtime};

pub struct AppHandleHolder<R: Runtime> {
    pub handle: AppHandle<R>,
}

#[implement(IDropTarget)]
pub struct AppDropTarget {
    handle: AppHandle<tauri::Wry>,
}

impl AppDropTarget {
    pub fn new(handle: AppHandle<tauri::Wry>) -> Self {
        Self { handle }
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for AppDropTarget {
    fn DragEnter(
        &self,
        _data: Option<&IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        unsafe { if !effect.is_null() { *effect = DROPEFFECT_MOVE; } }
        Ok(())
    }

    fn DragOver(
        &self,
        _keys: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        unsafe { if !effect.is_null() { *effect = DROPEFFECT_MOVE; } }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        Ok(())
    }

    fn Drop(
        &self,
        _data: Option<&IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        unsafe { if !effect.is_null() { *effect = DROPEFFECT_MOVE; } }
        // Body comes next task.
        Ok(())
    }
}
```

- [ ] **Step 2: Build**

```bash
cd src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished`. `AppHandleHolder` may warn as unused — we'll wire it next.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/win32_drag/drop_target.rs
git commit -m "win32_drag: IDropTarget skeleton (no Drop body yet)"
```

---

## Task 15: `IDropTarget::Drop` body — read CF_HDROP + emit `internal-drop` event

**Files:**
- Modify: `src-tauri/src/win32_drag/drop_target.rs`

- [ ] **Step 1: Replace the `Drop` method body**

In `drop_target.rs`, change `Drop` to:

```rust
    fn Drop(
        &self,
        data: Option<&IDataObject>,
        _keys: MODIFIERKEYS_FLAGS,
        pt: &POINTL,
        effect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        unsafe { if !effect.is_null() { *effect = DROPEFFECT_MOVE; } }
        let Some(data) = data else { return Ok(()); };
        let paths = extract_hdrop_paths(data)?;
        let payload = InternalDropPayload {
            paths,
            x: pt.x,
            y: pt.y,
        };
        use tauri::Emitter;
        if let Err(e) = self.handle.emit("internal-drop", payload) {
            log::error!("[drag] emit internal-drop failed: {}", e);
        }
        Ok(())
    }
```

- [ ] **Step 2: Add the helper + payload type at the top of `drop_target.rs`**

Append (above the `AppDropTarget` struct, below the `use` lines):

```rust
use windows::Win32::Foundation::HGLOBAL;
use windows::Win32::System::Com::{FORMATETC, DVASPECT_CONTENT, TYMED_HGLOBAL, STGMEDIUM};
use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
use windows::Win32::System::Ole::CF_HDROP;
use windows::Win32::UI::Shell::{DragQueryFileW};

#[derive(serde::Serialize, Clone)]
struct InternalDropPayload {
    paths: Vec<String>,
    x: i32,
    y: i32,
}

fn extract_hdrop_paths(data: &IDataObject) -> windows::core::Result<Vec<String>> {
    let fmt = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let medium: STGMEDIUM = unsafe { data.GetData(&fmt)? };
    // STGMEDIUM_0 union: hGlobal field for TYMED_HGLOBAL.
    let h: HGLOBAL = unsafe { medium.u.hGlobal };
    let mut out = Vec::new();
    unsafe {
        let _ = GlobalLock(h); // we don't need the pointer; DragQueryFileW does the locking internally on Win11 but lock-by-hand is the safe call
        let count = DragQueryFileW(
            std::mem::transmute::<HGLOBAL, windows::Win32::UI::Shell::HDROP>(h),
            0xFFFFFFFF,
            None,
        );
        let mut buf = [0u16; 1024];
        for i in 0..count {
            let n = DragQueryFileW(
                std::mem::transmute::<HGLOBAL, windows::Win32::UI::Shell::HDROP>(h),
                i,
                Some(&mut buf),
            );
            if n > 0 {
                let s = String::from_utf16_lossy(&buf[..n as usize]);
                out.push(s);
            }
        }
        let _ = GlobalUnlock(h);
    }
    Ok(out)
}
```

- [ ] **Step 3: Build**

```bash
cd src-tauri && cargo check 2>&1 | tail -10
```

Expected: `Finished`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/win32_drag/drop_target.rs
git commit -m "win32_drag: IDropTarget::Drop reads CF_HDROP and emits internal-drop"
```

---

## Task 16: `RegisterDragDrop` on the Tauri main HWND at startup

**Files:**
- Modify: `src-tauri/src/win32_drag/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Export a `register_drop_target` function from `mod.rs`**

Append to `src-tauri/src/win32_drag/mod.rs`:

```rust
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Ole::{IDropTarget, RegisterDragDrop};

pub fn register_drop_target(hwnd: HWND, app: tauri::AppHandle<tauri::Wry>) {
    unsafe {
        let target: IDropTarget = drop_target::AppDropTarget::new(app).into();
        if let Err(e) = RegisterDragDrop(hwnd, &target) {
            log::error!("[drag] RegisterDragDrop failed: {:?}", e);
        } else {
            log::info!("[drag] RegisterDragDrop succeeded on {:?}", hwnd);
        }
        // We deliberately leak the IDropTarget — its lifetime is the
        // process. RevokeDragDrop is called by the OS at HWND destruction.
        std::mem::forget(target);
    }
}
```

- [ ] **Step 2: Call it from `lib.rs` setup**

In `src-tauri/src/lib.rs`, in the `.setup` closure where you already call `win32_drag::install_subclass`, add the register call:

```rust
        .setup(|app| {
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    if let Ok(parent) = win.hwnd() {
                        win32_drag::install_subclass(parent);
                        win32_drag::register_drop_target(parent, app.handle().clone());
                    }
                }
            }
            Ok(())
        })
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: success.

- [ ] **Step 4: Manual verification — log shows registration**

Run the exe. Log should contain:

```
[drag] RegisterDragDrop succeeded on HWND(...)
```

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/win32_drag/mod.rs src-tauri/src/lib.rs
git commit -m "win32_drag: RegisterDragDrop on the Tauri main HWND"
```

---

## Task 17: `data-folder-path` markers on folder rows (FileBrowser + FolderTree)

**Files:**
- Modify: `src/renderer/components/FileBrowser.tsx`
- Modify: `src/renderer/components/FolderTree.tsx`

- [ ] **Step 1: Add the data attribute to file-list folder rows**

In `FileBrowser.tsx`, find the row `<div>` rendered for folder entries (search for `entry.isDirectory && entry.path`). On the outer `<div>` for any row that represents a folder, add:

```tsx
data-folder-path={entry.isDirectory ? entry.path : undefined}
```

(There are typically two: `DetailsRow` and `ThumbCard`. Add to both.)

- [ ] **Step 2: Add the data attribute to folder-tree rows**

In `FolderTree.tsx`, find where a tree node is rendered. On the row `<div>` for each folder node, add:

```tsx
data-folder-path={node.path}
```

- [ ] **Step 3: Build dev to make sure JSX compiles**

```bash
npm run vite:build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/FileBrowser.tsx src/renderer/components/FolderTree.tsx
git commit -m "JS: data-folder-path markers for internal-drop hit-testing"
```

---

## Task 18: `useInternalDrop` hook

**Files:**
- Create: `src/renderer/hooks/useInternalDrop.ts`

- [ ] **Step 1: Implement the hook**

Create `src/renderer/hooks/useInternalDrop.ts`:

```ts
import { useEffect } from 'react';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import toast from 'react-hot-toast';

interface InternalDropPayload {
  paths: string[];
  /** Screen coords from Win32 IDropTarget::Drop. */
  x: number;
  y: number;
}

/**
 * Subscribes to the native IDropTarget "internal-drop" event. When the
 * user drops Branchy-sourced files back inside the Branchy window, this
 * hit-tests the cursor against folder rows (which carry a
 * `data-folder-path` attribute) and runs the requested move via
 * `onMoveAsync` — same code path Ctrl+X / Ctrl+V uses, so progress UI +
 * undo stack continue to work.
 */
export function useInternalDrop(
  onMoveAsync: (paths: string[], destDir: string) => Promise<unknown>,
) {
  useEffect(() => {
    let alive = true;
    let unlisten: UnlistenFn | undefined;
    listen<InternalDropPayload>('internal-drop', (event) => {
      if (!alive) return;
      const { paths, x, y } = event.payload;
      // Win32 hands us screen coords; the browser elementFromPoint takes
      // CLIENT coords relative to the window. Convert via the
      // window-screen offset.
      const clientX = x - window.screenX - (window.outerWidth - window.innerWidth);
      const clientY = y - window.screenY - (window.outerHeight - window.innerHeight);
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const folderEl = el?.closest('[data-folder-path]') as HTMLElement | null;
      const destDir = folderEl?.getAttribute('data-folder-path');
      if (!destDir) return; // drop on non-folder = no-op
      if (paths.some((p) => p === destDir)) return; // can't move folder into itself
      onMoveAsync(paths, destDir).catch((err) => {
        toast.error(`Move failed: ${(err as Error).message}`);
      });
    }).then((u) => { unlisten = u; });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [onMoveAsync]);
}
```

- [ ] **Step 2: Build dev to make sure types check**

```bash
npm run vite:build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/hooks/useInternalDrop.ts
git commit -m "JS: useInternalDrop hook (hit-test + moveFiles)"
```

---

## Task 19: Wire `useInternalDrop` into `App.tsx`

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Import + use the hook**

In `App.tsx`, near the other hook imports:

```ts
import { useInternalDrop } from './hooks/useInternalDrop';
```

Inside the `App` component body, after `startMove` is destructured from `useCopyOps` (we already have this in our copy-progress setup):

```ts
  useInternalDrop(startMove);
```

- [ ] **Step 2: Build the dev app + manually verify internal drop**

```bash
npm run build 2>&1 | tail -5
```

Run the built exe. Drag a file from the file list onto a folder row in the SAME Branchy window. The file should move into that folder. The transfer-progress card should appear briefly.

Check the log:

```
[drag] DoDragDrop hresult=0x00040100 out_effect=...
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "App: mount useInternalDrop for in-app folder drops"
```

---

## Task 20: Remove HTML5 file-row drag handlers

**Files:**
- Modify: `src/renderer/components/FileBrowser.tsx`

- [ ] **Step 1: Remove `draggable` and `onDragStart` from file rows**

In `FileBrowser.tsx`, delete:
- The `draggable` attribute on row `<div>`s
- The `onDragStart={handleDragStart}` prop
- The `handleDragStart` function definition (search for `const handleDragStart`)
- The `import { startDrag } from '@crabnebula/tauri-plugin-drag'` if present

Also delete the folder-row `onDragOver` / `onDragLeave` / `onDrop` props and their handlers (`handleFolderDragOver`, `handleFolderDragLeave`, `handleFolderDrop`) — they're replaced by `useInternalDrop`.

Keep the `onMouseDown` we added in Task 5 — that's our new entry point.

- [ ] **Step 2: Remove `dragIconPath` plumbing**

Delete the `dragIconPath` ref + the `fileAPI.getDragIconPath()` useEffect + the `localDriveLetters` ref + the `getDrives`-on-mount block. None of these are needed any more.

- [ ] **Step 3: Build dev**

```bash
npm run vite:build 2>&1 | tail -5
```

Expected: no TypeScript errors. Any unused-import warnings, clean them up.

- [ ] **Step 4: Manual verification**

```bash
npm run build 2>&1 | tail -5
```

Run the exe. External drag (to VS Code) should still work. Internal drag (onto a folder in Branchy) should still work. Nothing should crash.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/FileBrowser.tsx
git commit -m "JS: remove HTML5 drag handlers (replaced by Win32 native)"
```

---

## Task 21: Remove `tauri-plugin-drag` and `vendor/drag/`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/api.ts`
- Modify: `src/types.d.ts`
- Modify: `package.json`
- Delete: `src-tauri/vendor/drag/`

- [ ] **Step 1: Remove the Cargo dep + `[patch.crates-io]`**

Open `src-tauri/Cargo.toml`. Remove:
- The `tauri-plugin-drag = "2"` line in `[dependencies]`
- The entire `[patch.crates-io] drag = { path = "vendor/drag" }` block

- [ ] **Step 2: Remove `tauri_plugin_drag::init()` from `lib.rs`**

Search `src-tauri/src/lib.rs` for `tauri_plugin_drag`. Delete that plugin registration line from the `.plugin(...)` chain.

- [ ] **Step 3: Remove `drag:default` from capabilities**

Open `src-tauri/capabilities/default.json`. Remove the `"drag:default"` entry from the `permissions` array.

- [ ] **Step 4: Remove dead JS API surface**

In `src/api.ts`, delete `startDrag`, `startNativeDrag`, `getDragIconPath` methods (anything related to the old plugin). Delete the matching declarations in `src/types.d.ts`. Delete any leftover `import { startDrag }` lines anywhere in `src/`.

- [ ] **Step 5: Remove the npm dep**

```bash
npm uninstall @crabnebula/tauri-plugin-drag
```

- [ ] **Step 6: Delete the vendored crate**

```bash
rm -rf src-tauri/vendor/drag
```

If the `vendor/` dir is now empty, remove that too:

```bash
rmdir src-tauri/vendor 2>/dev/null
```

- [ ] **Step 7: Build and verify**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds, no references to the deleted plugin remain.

- [ ] **Step 8: Manual smoke test**

Run the exe. Drag a file to VS Code (external). Drag a file onto a folder in Branchy (internal). Both should work.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Remove tauri-plugin-drag + vendor/drag fork entirely"
```

---

## Task 22: Final release build + smoke test

**Files:** (no code changes — verification only)

- [ ] **Step 1: Clean release build**

```bash
npm run build 2>&1 | tail -10
```

Confirm `src-tauri/target/release/branchy.exe` exists, ~9 MB.

- [ ] **Step 2: Replace any pinned-taskbar copy**

Copy the new exe to wherever the taskbar shortcut points (typically the same release path).

- [ ] **Step 3: Run the new build and exercise drag scenarios**

For each scenario, drag from Branchy and verify the result:

1. To Chrome (file upload zone on any web app)
2. To VS Code (editor pane)
3. To Windows Explorer (any folder)
4. Onto a folder INSIDE Branchy (file should move)
5. Onto the same folder you dragged from (should be a no-op)
6. Multi-select 3 files, drag together to VS Code

For each, check the log:

```bash
tail -50 "$LOCALAPPDATA/com.branchy.filemanager/logs/Branchy.log"
```

Every `[drag] DoDragDrop hresult=` line should be `0x00040100` (drop) or `0x00040101` (cancel). **No `0x80004005` (E_FAIL).**

- [ ] **Step 4: Run the same drag 10 times in a row**

The previous bug was "works once, then E_FAIL forever". With the new architecture this should be impossible (no shell-bound `inner_shell_obj`, fresh DataObject every drag, `OleInitialize` on every call). Verify by repetition.

- [ ] **Step 5: Push the final commit**

```bash
git push origin master
```

---

## Self-review notes

**Spec coverage:** every numbered section of the design doc has a task above:
- "Drag source" (subclass + pending) → Tasks 3, 10, 11, 12
- "Data object" → Tasks 6, 7, 8
- "Drop source" → Task 9
- "Drop target" → Tasks 14, 15, 16
- "JS side" → Tasks 5, 17, 18, 19, 20
- "Cleanup" → Task 21
- "Step-by-step build order" → matches our task order

**Type consistency check:** `pending::set/take_if_fresh/clear` signatures match between Task 3 (where they're implemented) and Task 11 (where they're called from the subclass). `DataObject::new` signature matches between Task 8 (defined) and Task 11 (called). `AppDropTarget::new` signature matches between Task 14 (defined) and Task 16 (called). `prepareDrag` API method matches between Task 5 (JS side) and Task 4 (Rust command name `prepare_drag`).

**Known caveats baked into tasks:**
- `useInternalDrop` does screen-to-client coordinate math that assumes the WebView2 fills the client area of the window. If branchy ever adds chrome OUTSIDE the WebView (it doesn't currently), the coord math needs adjustment.
- The screen-to-client conversion via `window.screenX/Y + outerWidth/Height` is approximate (Chromium WebView2 doesn't expose `convertScreenToClient`). For pixel-perfect hit-testing, a v2 enhancement would have Rust emit client coords directly via `ScreenToClient` on the WebView2 child HWND before emitting the event. Skipping for v1.
