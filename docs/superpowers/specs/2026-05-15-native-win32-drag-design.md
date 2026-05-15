# Native Win32 drag-and-drop for Branchy

## Problem

Dragging a file out of Branchy to another application (Chrome upload zone,
VS Code, Explorer, etc.) is unreliable. The current implementation
(`tauri-plugin-drag`, locally forked at `src-tauri/vendor/drag/`) calls
Win32 `DoDragDrop` from an async Tauri command, which adds 50–200 ms of
IPC + scheduling delay between the user's `mousedown` and the actual
`DoDragDrop` invocation. Logs show `DoDragDrop` returning `E_FAIL` for
most subsequent drags — the OS no longer recognises the live drag
gesture by the time we ask it to start one. The architecture is racy by
design; no amount of patching the forked plugin solves it.

## Goal

A reliable native drag-and-drop implementation that:

- Lets the user drag a file (or selection) out of Branchy onto any
  external app that accepts file drops (Chrome, VS Code, Explorer, etc.)
- Lets the user drag a file onto a folder inside Branchy to move it
- Works on every drag attempt, every session, with no flaky E_FAIL
- Has no observable IPC race between mousedown and `DoDragDrop`

## Constraints / non-goals

- Windows only. macOS/Linux drag is out of scope.
- We accept a managed regression risk: subclassing WebView2's child HWND
  could interact with text selection, scrolling, or other Chromium
  features. The user has explicitly accepted this risk.
- v1 does not restore the drag-time visual feedback that the old HTML5
  drag had — folder-row highlight under the cursor and spring-loaded
  folder open after hover. These can be added in a follow-up by
  emitting Tauri events from `IDropTarget::DragOver`.

## Architecture overview

Two native pieces, both written by us in Rust, both living in a new
`src-tauri/src/win32_drag/` module:

1. **Drag source** — a `SetWindowSubclass`-installed window proc on the
   WebView2 child HWND. It sees `WM_LBUTTONDOWN` / `WM_MOUSEMOVE` /
   `WM_LBUTTONUP` synchronously, in the same call-stack as the OS mouse
   message. When JS has pre-registered a "pending drag" and the cursor
   has moved past the system drag threshold, the subclass fires
   `DoDragDrop` right there — no IPC, no race.
2. **Drop target** — an `IDropTarget` implementation registered on the
   Tauri main HWND via `RegisterDragDrop`. When the user releases a
   Branchy drag *back into Branchy* (typically onto a folder), this
   catches it, reads the file paths from the data object, and emits a
   Tauri event to JS with the cursor coordinates. JS hit-tests the
   coords against folder rects and runs the move.

The two pieces share a `DataObject` / `DropSource` pair we control
entirely (no shell-bound delegates).

### IPC flow

1. User clicks a file row in Branchy.
2. React's `onMouseDown` handler fires (synchronous in the JS event
   loop).
3. JS calls `invoke('prepare_drag', { paths })`. This is fire-and-forget
   — JS doesn't await it.
4. Rust receives the IPC, stores `PendingDrag { paths, set_at: now }` in
   a global `Mutex<Option<PendingDrag>>`.
5. The user begins moving the mouse with the button still held.
6. The subclassed window proc receives `WM_MOUSEMOVE`. It checks:
   - Is there a `PendingDrag` set and not stale (set within last 500 ms)?
   - Has the cursor moved more than `GetSystemMetrics(SM_CXDRAG)` /
     `(SM_CYDRAG)` pixels from the recorded `WM_LBUTTONDOWN` position?
7. If both yes, the subclass synchronously calls `DoDragDrop` with our
   `DataObject` and `DropSource`. The state is cleared first so a
   reentrant `WM_MOUSEMOVE` during DoDragDrop's modal loop can't
   re-trigger it.
8. `DoDragDrop` runs its modal loop. The user moves the cursor over the
   destination app, releases, and the drop happens.
9. If the destination is *outside Branchy*: the destination app
   processes the `CF_HDROP` / `text/uri-list` data normally and copies
   or moves the file. We're not involved further.
10. If the destination is *inside Branchy*: our `IDropTarget::Drop` fires
    in the same process. It reads `CF_HDROP` from the data object,
    captures the cursor's screen coordinates via `GetCursorPos`, and
    emits a Tauri event `internal-drop` with `{ paths, x, y }`.
11. JS listens for `internal-drop`, converts the screen coords to
    client coords, hit-tests against the folder rows it currently
    renders, and calls `moveFiles(paths, resolved_folder)`.
12. `DoDragDrop` returns. The subclass continues normally.

If the user releases the mouse before the drag motion crosses the
threshold, `WM_LBUTTONUP` fires in the subclass, the pending state is
cleared, no drag happens. If the user clicks but never moves, the
pending state expires on its 500 ms timeout.

## Module layout

```
src-tauri/src/
├── lib.rs                        # registers the new commands, calls
│                                 # win32_drag::install at startup
├── win32_drag/
│   ├── mod.rs                    # public API: install(), prepare_drag()
│   ├── data_object.rs            # IDataObject (CF_HDROP + text/uri-list)
│   ├── drop_source.rs            # IDropSource (button-monitoring)
│   ├── drop_target.rs            # IDropTarget for internal drops
│   ├── subclass.rs               # SetWindowSubclass + window proc
│   └── pending.rs                # global PendingDrag state + helpers
```

Approximate size: ~300 lines of focused native code, replacing ~600
lines of forked third-party code and patches.

### Drag source (`subclass.rs` + `pending.rs`)

`install_subclass(main_hwnd)` is called once at startup:

- `EnumChildWindows` on `main_hwnd` to find the WebView2 child window
  (class name starts with `Chrome_WidgetWin_`).
- `SetWindowSubclass(child, drag_window_proc, SUBCLASS_ID, 0)`.

`drag_window_proc` intercepts:

- `WM_LBUTTONDOWN`: stash the cursor position in a thread-local
  `Cell<Option<POINT>>` keyed off this subclass; forward via
  `DefSubclassProc`.
- `WM_MOUSEMOVE`: if pending drag is set AND `down_pos` is set AND the
  cursor delta exceeds drag threshold, call `start_drag()` (which calls
  `DoDragDrop` synchronously); always forward via `DefSubclassProc`.
- `WM_LBUTTONUP`: clear `down_pos` and pending state; forward.
- Everything else: `DefSubclassProc` untouched.

Pending state in `pending.rs`:

```rust
struct PendingDrag {
    paths: Vec<String>,
    set_at: Instant,
}
static PENDING: Mutex<Option<PendingDrag>> = Mutex::new(None);

pub fn set(paths: Vec<String>) { /* writes new PendingDrag */ }
pub fn take_if_fresh() -> Option<PendingDrag> {
    /* atomic take + age check (< 500 ms) */
}
pub fn clear() { /* sets to None */ }
```

`take_if_fresh` is called inside the `WM_MOUSEMOVE` handler. It atomically
removes the state if present and not stale, returning the paths to pass
into `DoDragDrop`. After `DoDragDrop` returns, the state is not
re-added — a fresh `prepare_drag` IPC is required for any new drag.

### Data object (`data_object.rs`)

A pure-Rust `IDataObject` implementation with no shell-bound delegate.
Exposes exactly two formats:

- `CF_HDROP` — the standard Windows file-list format. Built via the
  `DROPFILES` struct + null-terminated UTF-16 paths + double-null
  terminator. The buffer is zeroed before populated (uninitialised
  `pt` / `fNC` in the upstream code could confuse strict drop targets).
- `text/uri-list` — Chromium's preferred MIME-style format. Dynamic
  clipboard format ID via `RegisterClipboardFormatW("text/uri-list")`.
  Payload is UTF-8, CRLF-separated `file:///<drive>:/path` (or
  `file://server/share/...` for UNC).

`EnumFormatEtc` returns both formats via `SHCreateStdEnumFmtEtc` so
drop targets that enumerate before querying see what we offer.
`GetData`, `QueryGetData`, `GetDataHere`, `SetData`, etc. return
`DV_E_FORMATETC` / `E_NOTIMPL` for anything outside those two formats —
no fallback delegation. This isolation eliminates the
COM-state-corruption-after-first-drag bug we saw in the fork.

### Drop source (`drop_source.rs`)

Minimal `IDropSource`:

- `QueryContinueDrag(escape_pressed, key_state)`:
  - `DRAGDROP_S_CANCEL` if Escape is down
  - `DRAGDROP_S_DROP` if the left button is released
  - `S_OK` otherwise (keep dragging)
- `GiveFeedback(_effect)`: `DRAGDROP_S_USEDEFAULTCURSORS`

`DoDragDrop` is called with allowed effects `DROPEFFECT_COPY |
DROPEFFECT_MOVE`. The destination chooses which to apply.

### Drop target (`drop_target.rs`)

Implements `IDropTarget`. Registered on the Tauri main HWND with
`RegisterDragDrop(main_hwnd, idroptarget)` at startup, unregistered at
shutdown.

- `DragEnter(data, key_state, pt, effect)`: `*effect = DROPEFFECT_MOVE`
- `DragOver(key_state, pt, effect)`: same
- `DragLeave`: nothing
- `Drop(data, key_state, pt, effect)`:
  - Read `CF_HDROP` from `data` (use `DragQueryFileW` to enumerate paths)
  - `pt` is in screen coordinates — convert to client via `ScreenToClient`
  - Build a `serde::Serialize`-able payload `{ paths, x, y }`
  - `app_handle.emit("internal-drop", payload)`

JS hit-tests on the receiving side and runs the move asynchronously.
The drop target itself does no JS-side work.

### JS side

**File rows** (`FileBrowser.tsx`):
- Remove `draggable` attribute and the `handleDragStart` chain
- Add a single `onMouseDown` on each row:
  ```ts
  onMouseDown={(e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const paths = selected.has(entry.path) ? [...selected] : [entry.path];
    fileAPI.prepareDrag(paths).catch(() => {});
  }}
  ```
- Remove the existing internal drag-onto-folder HTML5 handlers
  (`handleFolderDragOver`, `handleFolderDragLeave`, `handleFolderDrop`)
  — they're replaced by the `internal-drop` event listener

**`internal-drop` listener** (new — `src/renderer/hooks/useInternalDrop.ts`):
- `listen<{ paths: string[]; x: number; y: number }>('internal-drop', …)`
- Hit-test cursor coords against currently-rendered folder rows via
  `document.elementFromPoint(x, y)` plus a `data-folder-path` attribute
  we'll add to each folder row element
- Resolve to a folder path
- Call the existing `onMoveAsync(paths, folder)` so progress tracking +
  undo stack continue to work

**Folder rows**:
- Add `data-folder-path={entry.path}` for the elementFromPoint hit-test
- Drop the existing `onDragOver` / `onDrop` props (no longer needed)

**API surface** (`src/api.ts`):
- Add `prepareDrag(paths: string[]): Promise<void>` → invokes
  `prepare_drag` Tauri command
- Remove `startDrag`, `startNativeDrag`, `getDragIconPath`
- Remove `@crabnebula/tauri-plugin-drag` import

### Cleanup

To remove:
- `@crabnebula/tauri-plugin-drag` (npm `package.json`)
- `tauri-plugin-drag = "2"` (Cargo `[dependencies]`)
- `[patch.crates-io] drag = { path = "vendor/drag" }` (Cargo)
- `windows-core = "0.58"` (Cargo) — only used by the forked drag crate
- `src-tauri/vendor/drag/` directory entirely
- `drag:default` permission from `capabilities/default.json`
- `tauri_plugin_drag::init()` from `lib.rs`

### Error handling

- If `EnumChildWindows` can't find a WebView2 child HWND (extremely
  unlikely): log an error, continue without subclassing. External drag
  silently doesn't work. Internal HTML5 drag is already removed so
  internal drop also won't work — but the app still runs.
- If `SetWindowSubclass` fails: same as above, log + continue.
- If `RegisterDragDrop` fails: log, continue. Internal drop won't work
  but the app runs.
- If `DoDragDrop` returns an error other than `DRAGDROP_S_DROP` /
  `DRAGDROP_S_CANCEL`: log with the hresult. The state is already
  cleared so subsequent drags can retry.
- `CF_HDROP` read failures inside `Drop`: log, emit no event, the user
  sees no internal move happen.

### Logging

Keep the `[drag] …` log lines we added during debugging (init_ole
result, file existence, button state, DoDragDrop hresult + duration).
They're invaluable for future diagnosis. Stays inside the
`tauri-plugin-log` file output at `%LOCALAPPDATA%\com.branchy.filemanager\logs\Branchy.log`.

## Risks

| Risk | Mitigation |
| --- | --- |
| WebView2 unsubclasses our proc when it updates | Re-subclass on a WebView2-controller event if available; otherwise accept that an extremely-rare WebView2 internal reinit could disable drag until next launch |
| Subclass interferes with text selection inside the rename input | Our proc only acts on specific messages and forwards everything via `DefSubclassProc` — Chromium continues to handle text natively |
| Subclass interferes with scrolling | Same — we don't consume mouse-wheel or any non-button message |
| DoDragDrop fails despite being synchronous | Should not happen with this architecture (root cause was async IPC). If it does, the hresult log tells us what; mitigation TBD until we see one |
| Internal-drop hit-test misses (cursor between folders) | Falls through to no-op; no harm. We can add a "release on file list area = drop into current folder" rule later |
| User scrolls during drag, folder positions change | `elementFromPoint` queries the *current* DOM at drop time, so it picks up the scroll position correctly |

## Step-by-step build order

1. Module scaffold — empty `win32_drag/mod.rs` + sub-files, wired into
   `lib.rs` and Cargo features
2. `pending.rs` + `prepare_drag` command — JS can call but nothing acts
   on it yet
3. `data_object.rs` + `drop_source.rs` — standalone, no DoDragDrop yet
4. `subclass.rs` — install on startup, log every relevant message,
   call DoDragDrop on threshold. External drag (to Chrome / VS Code)
   should work after this step
5. `drop_target.rs` + `internal-drop` Tauri event — register on main
   HWND, log drops
6. JS `useInternalDrop` hook + `data-folder-path` markers + move call —
   internal drag-onto-folder works again
7. Remove `tauri-plugin-drag` + `vendor/drag/` + dead JS code +
   capabilities entry
8. Verify with the diagnostic log: every drag attempt logs a single
   `DoDragDrop hresult=0x00040100` (DROP) or `0x00040101` (CANCEL),
   never `0x80004005` (E_FAIL)
