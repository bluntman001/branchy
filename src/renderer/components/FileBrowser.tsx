import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  PiArrowUp, PiArrowLeft, PiArrowRight,
  PiArrowClockwise, PiFolderPlus, PiMagnifyingGlass,
} from 'react-icons/pi';
import { List, Grid, useListRef, useGridRef } from 'react-window';
import toast from 'react-hot-toast';
import { FileIcon } from './FileIcon';
import { FileContextMenu, SpaceContextMenu } from './ContextMenu';
import { ViewPicker, resolveView } from './ViewPicker';
import { formatSize, formatDate } from '../utils/formatSize';
import {
  iconKey, getCached, isCached, fetchIconsBatch,
  getCachedThumb, requestThumb, onThumbProgress,
} from '../utils/shellIcons';
import { dirname, joinPath } from '../utils/path';
import { fileAPI } from '../../api';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { listen } from '@tauri-apps/api/event';
import { FileEntry } from '../../types';

type SortField  = 'name' | 'size' | 'modified' | 'type';
type SortDir    = 'asc' | 'desc';

const DETAIL_ROW_H = 28;
const DEFAULT_VIEW_POS = 0.42;
const TYPEAHEAD_RESET_MS = 800;

interface FileBrowserProps {
  entries: FileEntry[];
  loading: boolean;
  currentPath: string;
  selected: Set<string>;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (p: string) => void;
  onSelect: (path: string, mode: 'single' | 'toggle' | 'range') => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onRefresh: () => void;
  onDrop: (sourcePaths: string[], destDir: string) => void;
  onCopyAsync: (sourcePaths: string[], destDir: string) => Promise<string>;
  onMoveAsync: (sourcePaths: string[], destDir: string) => Promise<string>;
}

interface RenameState { path: string; value: string; }

export function FileBrowser({
  entries, loading, currentPath, selected,
  canGoBack, canGoForward,
  onNavigate, onSelect, onSelectAll, onClearSelection,
  onGoBack, onGoForward, onGoUp, onRefresh, onDrop, onCopyAsync, onMoveAsync,
}: FileBrowserProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const typeaheadBuf  = useRef('');
  const typeaheadLast = useRef(0);
  const listRef = useListRef(null);
  const gridRef = useGridRef(null);
  const [sortField, setSortField]         = useState<SortField>('name');
  const [sortDir, setSortDir]             = useState<SortDir>('asc');
  const [colWidths, setColWidths] = useState({ type: 80, size: 90, modified: 130 });
  // sign: -1 = drag-right shrinks column (Name/Type boundary), +1 = drag-right grows column (Type or Size right edge)
  const colDragRef = useRef<{ col: 'type' | 'size' | 'modified'; startX: number; startW: number; sign: 1 | -1; currentW: number; col2?: 'type' | 'size' | 'modified'; startW2?: number; currentW2?: number } | null>(null);
  const [renaming, setRenaming]           = useState<RenameState | null>(null);
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const [searching, setSearching]         = useState(false);
  const [viewPos, setViewPos]             = useState<number>(DEFAULT_VIEW_POS);
  const viewPosLoaded                     = useRef(false);
  const { mode: viewMode, px: thumbPx }   = resolveView(viewPos);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Load persisted view position on mount.
  useEffect(() => {
    (async () => {
      const saved = await fileAPI.settings.get('viewPos');
      if (typeof saved === 'number' && saved >= 0 && saved <= 1) {
        setViewPos(saved);
      }
      viewPosLoaded.current = true;
    })();
  }, []);

  // Persist view position changes (skip the initial run before load completes).
  useEffect(() => {
    if (!viewPosLoaded.current) return;
    fileAPI.settings.set('viewPos', viewPos).catch(() => {});
  }, [viewPos]);

  useEffect(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const thumbCellW = thumbPx + 16;
  // +56 reserves room for the 2-line filename below each thumb plus a
  // breathing gap so the next row's filename doesn't collide.
  const thumbCellH = thumbPx + 56;
  const thumbCols  = Math.max(1, Math.floor(containerWidth / thumbCellW));

  // Keep the container focused whenever something is selected so F2/Delete/etc. work
  useEffect(() => {
    if (selected.size > 0 && containerRef.current && !containerRef.current.contains(document.activeElement)) {
      containerRef.current.focus({ preventScroll: true });
    }
  }, [selected]);

  // ── Column resize (CSS-var approach — no React re-renders during drag) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Initialise CSS vars from state
    el.style.setProperty('--col-type', `${colWidths.type}px`);
    el.style.setProperty('--col-size', `${colWidths.size}px`);
    el.style.setProperty('--col-mod',  `${colWidths.modified}px`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colWidths]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!colDragRef.current) return;
      const { col, startX, startW, sign, col2, startW2 } = colDragRef.current;
      const delta = e.clientX - startX;
      const newW = Math.max(50, startW + sign * delta);
      colDragRef.current.currentW = newW;
      const el = containerRef.current;
      if (el) {
        const varName = col === 'modified' ? '--col-mod' : `--col-${col}`;
        el.style.setProperty(varName, `${newW}px`);
        if (col2 != null && startW2 != null) {
          const newW2 = Math.max(50, startW2 - sign * delta);
          colDragRef.current.currentW2 = newW2;
          const varName2 = col2 === 'modified' ? '--col-mod' : `--col-${col2}`;
          el.style.setProperty(varName2, `${newW2}px`);
        }
      }
    }
    function onMouseUp() {
      if (colDragRef.current) {
        const { col, currentW, col2, currentW2 } = colDragRef.current;
        setColWidths((w) => {
          const next = { ...w, [col]: currentW };
          if (col2 != null && currentW2 != null) (next as any)[col2] = currentW2;
          return next;
        });
      }
      colDragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Icons live in shellIcons.ts module cache, not React state — survive remount.
  // setIconTick bumps a version counter to trigger re-renders when cache fills.
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [, setIconTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const toFetch = entries
      .filter((e) => !e.isDirectory)
      .map((e) => ({ path: e.path, key: iconKey(e.path, e.extension, false) }));
    if (toFetch.length === 0) return;
    if (toFetch.every((e) => isCached(e.key))) return;

    fetchIconsBatch(toFetch, () => {
      if (alive) setIconTick((n) => n + 1);
    });

    return () => { alive = false; };
  }, [entries]);

  // Filesystem watcher: refresh the listing when files in the current
  // folder change externally (e.g. BitTorrent removes a file, another
  // process writes one). Debounced so a torrent producing dozens of
  // events in a second only triggers one refresh.
  useEffect(() => {
    if (!currentPath) return;
    let alive = true;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    fileAPI.watchDirectory(currentPath).catch(() => { /* watcher unavailable — manual F5 still works */ });
    const unlistenP = listen('fs-changed', () => {
      if (!alive) return;
      if (debounce != null) clearTimeout(debounce);
      debounce = setTimeout(() => { if (alive) onRefresh(); }, 250);
    });
    return () => {
      alive = false;
      if (debounce != null) clearTimeout(debounce);
      fileAPI.unwatchDirectory().catch(() => {});
      unlistenP.then((u) => u()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const [folderSizes, setFolderSizes] = useState<Map<string, number>>(new Map());

  const sorted = useMemo(
    () => sortEntries(searchResults ?? entries, sortField, sortDir, folderSizes),
    [searchResults, entries, sortField, sortDir, folderSizes]
  );

  // Per-card lazy loading (in ThumbCard) drives all thumbnail fetches now.
  // FileBrowser just needs to re-render when new thumbs arrive so that
  // virtualised cards can pick them up from the cache.
  useEffect(() => {
    let rafId: number | null = null;
    const unsub = onThumbProgress(() => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        setIconTick((n) => n + 1);
      });
    });
    return () => {
      unsub();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const folders = entries.filter((e) => e.isDirectory);
    if (folders.length === 0) return;
    setFolderSizes(new Map());

    // Coalesce per-folder size updates into one rAF tick to avoid
    // N Map clones when folders resolve in quick succession.
    const pending = new Map<string, number>();
    let rafId: number | null = null;
    const flush = () => {
      rafId = null;
      if (!alive || pending.size === 0) return;
      setFolderSizes((prev) => {
        const next = new Map(prev);
        for (const [p, s] of pending) next.set(p, s);
        return next;
      });
      pending.clear();
    };

    (async () => {
      for (const f of folders) {
        if (!alive) break;
        try {
          const size = await fileAPI.getFolderSize(f.path);
          if (!alive) break;
          pending.set(f.path, size);
          if (rafId == null) rafId = requestAnimationFrame(flush);
        } catch {}
      }
    })();

    return () => {
      alive = false;
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [entries]);

  const [clipboard, setClipboard] = useState<{ paths: string[]; mode: 'cut' | 'copy' } | null>(null);

  // ── Folder drop handlers ─────────────────────────────────────────────────
  // Spring-loaded folders: hover a folder for SPRING_MS while dragging and
  // we navigate into it, letting you drop deep without dropping/picking-up.
  // Matches Windows Explorer / macOS Finder behaviour.
  const SPRING_MS = 800;
  const springTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const springPath  = useRef<string | null>(null);

  const cancelSpring = useCallback(() => {
    if (springTimer.current != null) {
      clearTimeout(springTimer.current);
      springTimer.current = null;
    }
    springPath.current = null;
  }, []);

  const handleFolderDragOver = useCallback((e: React.DragEvent, entry: FileEntry) => {
    if (!entry.isDirectory) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(entry.path);

    // Only (re)start the spring timer when the hovered folder changes —
    // otherwise the constant dragOver flood would reset it to forever.
    if (springPath.current !== entry.path) {
      cancelSpring();
      springPath.current = entry.path;
      springTimer.current = setTimeout(() => {
        // Skip if user has dropped or moved off in the meantime.
        if (springPath.current !== entry.path) return;
        onNavigate(entry.path);
        setDragOverPath(null);
        springPath.current = null;
        springTimer.current = null;
      }, SPRING_MS);
    }
  }, [onNavigate, cancelSpring]);

  const handleFolderDragLeave = useCallback(() => {
    setDragOverPath(null);
    cancelSpring();
  }, [cancelSpring]);

  const handleFolderDrop = useCallback((e: React.DragEvent, entry: FileEntry) => {
    if (!entry.isDirectory) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverPath(null);
    cancelSpring();
    const data = e.dataTransfer.getData('application/filepilot');
    if (data) {
      try { onDrop(JSON.parse(data), entry.path); } catch { /* ignore */ }
    }
  }, [onDrop, cancelSpring]);

  const getSelectedEntries = useCallback((): FileEntry[] => {
    return (searchResults ?? entries).filter((e) => selected.has(e.path));
  }, [searchResults, entries, selected]);

  const handleSort = (field: SortField) => {
    if (field === sortField) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const handleDoubleClick = async (entry: FileEntry) => {
    if (entry.isDirectory) {
      onNavigate(entry.path);
      setSearchResults(null);
      setSearchQuery('');
    } else {
      try { await fileAPI.openFile(entry.path); }
      catch (err) { toast.error(`Cannot open: ${(err as Error).message}`); }
    }
  };

  // Slow-double-click on an already-selected solo item starts rename
  // (matches Windows Explorer behaviour). Window: 500ms < Δt < 1500ms.
  const lastClickRef = useRef<{ path: string; time: number } | null>(null);

  const handleRowClick = (e: React.MouseEvent, entry: FileEntry) => {
    if (e.ctrlKey || e.metaKey) {
      onSelect(entry.path, 'toggle');
      lastClickRef.current = null;
    } else if (e.shiftKey) {
      onSelect(entry.path, 'range');
      lastClickRef.current = null;
    } else {
      const now = Date.now();
      const prev = lastClickRef.current;
      const isOnlySelected = selected.size === 1 && selected.has(entry.path);
      if (
        prev &&
        prev.path === entry.path &&
        isOnlySelected &&
        now - prev.time > 500 &&
        now - prev.time < 1500
      ) {
        setRenaming({ path: entry.path, value: entry.name });
        lastClickRef.current = null;
        return;
      }
      onSelect(entry.path, 'single');
      lastClickRef.current = { path: entry.path, time: now };
    }
  };

  const handleRowRightClick = (entry: FileEntry) => {
    if (!selected.has(entry.path)) onSelect(entry.path, 'single');
  };

  const handleRename = () => {
    const entry = getSelectedEntries()[0];
    if (entry) setRenaming({ path: entry.path, value: entry.name });
  };

  const commitRename = async () => {
    if (!renaming) return;
    const entry = (searchResults ?? entries).find((e) => e.path === renaming.path);
    if (!entry) { setRenaming(null); return; }
    const newPath = joinPath(dirname(entry.path), renaming.value);
    if (newPath !== renaming.path) {
      try {
        await fileAPI.renameFile(renaming.path, newPath);
        onRefresh();
        toast.success('Renamed');
      } catch (err) { toast.error(`Rename failed: ${(err as Error).message}`); }
    }
    setRenaming(null);
  };

  const handleDelete = useCallback(async () => {
    const sel = getSelectedEntries();
    if (sel.length === 0) return;
    const paths = sel.map((e) => e.path);
    const confirmDelete = await fileAPI.settings.get('confirmDelete') as boolean;
    if (confirmDelete) {
      const ok = window.confirm(`Delete ${sel.length} item(s)? They will be moved to the Recycle Bin.`);
      if (!ok) return;
    }
    try {
      await fileAPI.deleteFiles(paths);
      onClearSelection();
      onRefresh();
      toast.success(`Deleted ${sel.length} item(s)`);
    } catch (err) {
      // Recycle Bin doesn't work on network/SMB/ZFS drives — Windows
      // returns an error from IFileOperation. Offer permanent delete
      // since that's all the OS can do on those volumes.
      const msg = (err as Error).message || '';
      const ok = window.confirm(
        `Couldn't move to Recycle Bin (${msg.slice(0, 200)}).\n\n` +
        `This usually means the file is on a network drive (Z:, SMB, etc.) ` +
        `which Windows Recycle Bin doesn't support.\n\n` +
        `Permanently delete ${sel.length} item(s)? This cannot be undone.`
      );
      if (!ok) return;
      try {
        await fileAPI.permanentDeleteFiles(paths);
        onClearSelection();
        onRefresh();
        toast.success(`Permanently deleted ${sel.length} item(s)`);
      } catch (err2) {
        toast.error(`Delete failed: ${(err2 as Error).message}`);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, searchResults, entries]);

  const handleCut  = () => setClipboard({ paths: getSelectedEntries().map((e) => e.path), mode: 'cut' });
  const handleCopy = () => setClipboard({ paths: getSelectedEntries().map((e) => e.path), mode: 'copy' });
  const handlePaste = async () => {
    if (!clipboard) return;
    try {
      if (clipboard.mode === 'copy') {
        await onCopyAsync(clipboard.paths, currentPath);
      } else {
        // Async move: same-volume = instant rename, cross-volume = copy
        // with byte progress. UI never blocks either way.
        await onMoveAsync(clipboard.paths, currentPath);
        setClipboard(null);
      }
    } catch (err) { toast.error(`Paste failed: ${(err as Error).message}`); }
  };
  const handleCopyPath = () => {
    const paths = getSelectedEntries().map((e) => e.path).join('\n');
    navigator.clipboard.writeText(paths).then(() => toast.success('Path copied'));
  };

  const handleCreateFolder = async () => {
    const name = window.prompt('New folder name:');
    if (!name) return;
    const folderPath = joinPath(currentPath, name);
    try { await fileAPI.createFolder(folderPath); onRefresh(); }
    catch (err) { toast.error(`Create folder failed: ${(err as Error).message}`); }
  };

  const handleNewFile = async () => {
    const name = window.prompt('New file name:', 'untitled.txt');
    if (!name) return;
    const filePath = joinPath(currentPath, name);
    try {
      await fileAPI.createFile(filePath);
      onRefresh();
      toast.success(`Created ${name}`);
    } catch (err) { toast.error(`Create file failed: ${(err as Error).message}`); }
  };

  const handleOpenWith = async (entry: FileEntry, exePath: string) => {
    try {
      await fileAPI.openFileWith(entry.path, exePath);
    } catch (err) { toast.error(`Open failed: ${(err as Error).message}`); }
  };

  const handleExtract = async (entry: FileEntry) => {
    try {
      const tool = await fileAPI.extractArchive(entry.path, currentPath);
      toast.success(`Extracting with ${tool}…`);
    } catch (err) { toast.error(`Extract failed: ${(err as Error).message}`); }
  };

  const handleProperties = () => {
    const entry = getSelectedEntries()[0];
    if (!entry) return;
    const info = [
      `Name: ${entry.name}`,
      `Path: ${entry.path}`,
      `Size: ${entry.isDirectory ? '—' : formatSize(entry.size)}`,
      `Modified: ${new Date(entry.modified).toLocaleString()}`,
      `Created: ${new Date(entry.created).toLocaleString()}`,
    ].join('\n');
    alert(info);
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) { setSearchResults(null); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await fileAPI.searchFiles(currentPath, query);
        setSearchResults(results);
      } catch (err) { toast.error(`Search failed: ${(err as Error).message}`); }
      finally { setSearching(false); }
    }, 300);
  };

  const handleDragStart = (e: React.DragEvent, entry: FileEntry) => {
    // Drag-select inside the rename input bubbles up to the draggable row,
    // which would call Tauri's native `startDrag`. Initiating an OS-level
    // drag while a text input is active crashes WebView2's modal drag
    // loop — bail when the source is any text-editable element or when
    // this row is currently being renamed.
    const target = e.target as HTMLElement;
    if (
      target.closest('input, textarea, [contenteditable="true"]') ||
      renaming?.path === entry.path
    ) {
      e.preventDefault();
      return;
    }
    const paths = selected.has(entry.path) ? [...selected] : [entry.path];
    // Internal drag: keeps drop-onto-folder working inside the app via
    // HTML5 dataTransfer (parsed by handleFolderDrop).
    e.dataTransfer.setData('application/filepilot', JSON.stringify(paths));
    e.dataTransfer.effectAllowed = 'move';
    // External drag: hand the OS the actual file paths so they can be
    // dropped onto Chrome / Explorer / other apps as real files.
    startDrag({ item: paths, icon: '' }).catch(() => { /* noop */ });
  };

  // Window-level shortcuts so F2/Delete/etc. work even when focus is on the
  // search input or any non-container element. Skip when typing into a real
  // text input — except Escape, which always cancels selection/search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inEditable =
        !!t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          (t as HTMLElement).isContentEditable);

      if (e.key === 'Escape') {
        onClearSelection();
        setSearchQuery('');
        setSearchResults(null);
        if (renaming) setRenaming(null);
        return;
      }

      if (inEditable) return;

      if (e.key === 'F2')     { handleRename(); return; }
      if (e.key === 'Delete') { handleDelete(); return; }
      if (e.key === 'F5')     { onRefresh(); return; }
      if (e.ctrlKey && e.key === 'a') { e.preventDefault(); onSelectAll(); return; }
      if (e.ctrlKey && e.key === 'c') { handleCopy(); return; }
      if (e.ctrlKey && e.key === 'x') { handleCut(); return; }
      if (e.ctrlKey && e.key === 'v') { handlePaste(); return; }

      // Type-ahead: printable single-char keys append to a buffer that
      // resets after TYPEAHEAD_RESET_MS of inactivity. We jump to the
      // first entry whose name starts with the buffer (case-insensitive)
      // — Windows Explorer convention.
      if (
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        e.key.length === 1 && /\S/.test(e.key)
      ) {
        const now = Date.now();
        if (now - typeaheadLast.current > TYPEAHEAD_RESET_MS) {
          typeaheadBuf.current = '';
        }
        typeaheadBuf.current += e.key.toLowerCase();
        typeaheadLast.current = now;
        const buf = typeaheadBuf.current;
        // Prefer "starts with"; if nothing matches, fall back to "contains"
        // so single-char nudges still navigate predictably.
        const startsIdx = sorted.findIndex((x) => x.name.toLowerCase().startsWith(buf));
        const matchIdx  = startsIdx >= 0 ? startsIdx
          : sorted.findIndex((x) => x.name.toLowerCase().includes(buf));
        if (matchIdx >= 0) {
          const match = sorted[matchIdx];
          onSelect(match.path, 'single');
          // Scroll the matched row/cell into view. `align: 'smart'` is a
          // no-op when already visible and uses the shortest scroll
          // distance otherwise — feels less jarring than 'center'.
          if (viewMode === 'details') {
            listRef.current?.scrollToRow({ index: matchIdx, align: 'smart' });
          } else {
            const cols = Math.max(1, thumbCols);
            gridRef.current?.scrollToCell({
              rowIndex: Math.floor(matchIdx / cols),
              columnIndex: matchIdx % cols,
              rowAlign: 'smart',
              columnAlign: 'smart',
            });
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, searchResults, entries, renaming, clipboard, sorted]);

  const sortIndicator = (f: SortField) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  // Common context menu action props (excluding entry-specific ones)
  const baseCtxActions = {
    canPaste: clipboard !== null,
    onCut: handleCut,
    onCopy: handleCopy,
    onPaste: handlePaste,
    onCopyPath: handleCopyPath,
    onProperties: handleProperties,
    onNewFolder: handleCreateFolder,
  };

  const detailsRowProps: VirtualDetailsProps = {
    sorted,
    selected,
    dragOverPath,
    renaming,
    canPaste: clipboard !== null,
    selectedCount: selected.size,
    folderSizes,
    onRowClick: handleRowClick,
    onDoubleClick: handleDoubleClick,
    onRightClick: handleRowRightClick,
    onDragStart: handleDragStart,
    onFolderDragOver: handleFolderDragOver,
    onFolderDragLeave: handleFolderDragLeave,
    onFolderDrop: handleFolderDrop,
    onRenameChange: (v: string) => setRenaming((r) => r ? { ...r, value: v } : null),
    onRenameCommit: commitRename,
    onRenameCancel: () => setRenaming(null),
    onRename: handleRename,
    onDelete: handleDelete,
    onCut: handleCut,
    onCopy: handleCopy,
    onPaste: handlePaste,
    onCopyPath: handleCopyPath,
    onProperties: handleProperties,
    onNewFolder: handleCreateFolder,
    onOpenWith: handleOpenWith,
    onExtract: handleExtract,
  };

  const thumbCellProps: VirtualThumbProps = {
    sorted,
    thumbCols,
    selected,
    dragOverPath,
    renaming,
    canPaste: clipboard !== null,
    selectedCount: selected.size,
    thumbPx,
    onRowClick: handleRowClick,
    onDoubleClick: handleDoubleClick,
    onRightClick: handleRowRightClick,
    onDragStart: handleDragStart,
    onFolderDragOver: handleFolderDragOver,
    onFolderDragLeave: handleFolderDragLeave,
    onFolderDrop: handleFolderDrop,
    onRenameChange: (v: string) => setRenaming((r) => r ? { ...r, value: v } : null),
    onRenameCommit: commitRename,
    onRenameCancel: () => setRenaming(null),
    onRename: handleRename,
    onDelete: handleDelete,
    onCut: handleCut,
    onCopy: handleCopy,
    onPaste: handlePaste,
    onCopyPath: handleCopyPath,
    onProperties: handleProperties,
    onNewFolder: handleCreateFolder,
    onOpenWith: handleOpenWith,
    onExtract: handleExtract,
  };

  return (
    <div
      ref={containerRef}
      className="h-full flex flex-col outline-none"
      tabIndex={0}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          background: 'rgba(255,255,255,0.015)',
          height: 54,
          minHeight: 54,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        {/* Nav cluster */}
        <div
          className="flex items-center"
          style={{
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 999,
            padding: 2,
            gap: 1,
          }}
        >
          <NavBtn onClick={onGoBack}    disabled={!canGoBack}    title="Back"    icon={<PiArrowLeft size={16} />} />
          <NavBtn onClick={onGoForward} disabled={!canGoForward} title="Forward" icon={<PiArrowRight size={16} />} />
          <NavBtn onClick={onGoUp}      title="Up"               icon={<PiArrowUp size={16} />} />
          <NavBtn onClick={onRefresh}   title="Refresh"          icon={<PiArrowClockwise size={16} />} />
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative flex items-center">
          <PiMagnifyingGlass size={13} className="absolute" style={{ color: 'var(--text-faint)', left: 11 }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search this folder…"
            className="fp-input"
            style={{
              width: 220,
              paddingLeft: 30,
              paddingRight: searching ? 28 : 12,
              height: 32,
              borderRadius: 999,
              fontSize: 12.5,
            }}
          />
          {searching && (
            <span
              className="absolute rounded-full animate-spin"
              style={{
                right: 10,
                width: 12, height: 12,
                border: '1.5px solid var(--accent)',
                borderTopColor: 'transparent',
              }}
            />
          )}
        </div>

        {/* Unified view picker */}
        <div className="ml-1.5">
          <ViewPicker pos={viewPos} onChange={setViewPos} />
        </div>

        <button
          onClick={handleCreateFolder}
          className="fp-btn-ghost flex items-center gap-1.5 transition-colors"
          style={{
            color: 'var(--text-dim)',
            fontSize: 12,
            padding: '7px 12px',
            marginLeft: 4,
            fontWeight: 500,
            letterSpacing: '-0.005em',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
          }}
        >
          <PiFolderPlus size={14} />
          <span>New Folder</span>
        </button>
      </div>

      {/* Column headers — only in details mode */}
      {viewMode === 'details' && (
        <div
          className="grid flex-shrink-0"
          style={{
            gridTemplateColumns: '1fr var(--col-type) var(--col-size) var(--col-mod)',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'transparent',
            fontSize: 9.5,
            color: 'var(--text-faint)',
            paddingRight: 6,
            fontWeight: 600,
            letterSpacing: '0.14em',
          }}
        >
          <div
            className="relative flex items-center px-3 py-2 cursor-pointer select-none uppercase min-w-0 transition-colors hover:text-[var(--text-dim)]"
            onClick={() => handleSort('name')}
          >
            name{sortIndicator('name')}
          </div>
          <div
            className="relative flex items-center px-2 py-2 cursor-pointer select-none uppercase transition-colors hover:text-[var(--text-dim)]"
            onClick={() => handleSort('type')}
          >
            <div className="absolute" style={{ top: 6, bottom: 6, left: -4, width: 1, background: 'var(--border-subtle)' }} />
            type{sortIndicator('type')}
            <div
              className="absolute top-0 bottom-0 cursor-col-resize"
              style={{ zIndex: 2, width: 9, left: -5 }}
              onMouseDown={(e) => {
                e.stopPropagation();
                colDragRef.current = { col: 'type', startX: e.clientX, startW: colWidths.type, sign: -1, currentW: colWidths.type };
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />
          </div>
          <div
            className="relative flex items-center px-2 py-2 cursor-pointer select-none uppercase transition-colors hover:text-[var(--text-dim)]"
            onClick={() => handleSort('size')}
          >
            <div className="absolute" style={{ top: 6, bottom: 6, left: -4, width: 1, background: 'var(--border-subtle)' }} />
            size{sortIndicator('size')}
            <div
              className="absolute top-0 bottom-0 cursor-col-resize"
              style={{ zIndex: 2, width: 9, left: -5 }}
              onMouseDown={(e) => {
                e.stopPropagation();
                colDragRef.current = { col: 'type', startX: e.clientX, startW: colWidths.type, sign: 1, currentW: colWidths.type, col2: 'size', startW2: colWidths.size, currentW2: colWidths.size };
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />
          </div>
          <div
            className="relative flex items-center px-2 py-2 cursor-pointer select-none uppercase transition-colors hover:text-[var(--text-dim)]"
            onClick={() => handleSort('modified')}
          >
            <div className="absolute" style={{ top: 6, bottom: 6, left: -4, width: 1, background: 'var(--border-subtle)' }} />
            modified{sortIndicator('modified')}
            <div
              className="absolute top-0 bottom-0 cursor-col-resize"
              style={{ zIndex: 2, width: 9, left: -5 }}
              onMouseDown={(e) => {
                e.stopPropagation();
                colDragRef.current = { col: 'size', startX: e.clientX, startW: colWidths.size, sign: 1, currentW: colWidths.size, col2: 'modified', startW2: colWidths.modified, currentW2: colWidths.modified };
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
              }}
            />
          </div>
        </div>
      )}

      {/* File list wrapped in SpaceContextMenu */}
      <SpaceContextMenu
        {...baseCtxActions}
        onNewFile={handleNewFile}
        onRefresh={onRefresh}
        onSortName={() => handleSort('name')}
        onSortSize={() => handleSort('size')}
        onSortDate={() => handleSort('modified')}
        onSortType={() => handleSort('type')}
      >
        <div
          ref={listContainerRef}
          className="flex-1 overflow-hidden"
          onClick={() => onClearSelection()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const data = e.dataTransfer.getData('application/filepilot');
            if (data) {
              try { onDrop(JSON.parse(data), currentPath); } catch { /* ignore */ }
            }
          }}
        >
          {/* Loading bar — visible during re-loads without hiding the list */}
          {loading && (
            <div style={{ height: 2, background: 'transparent', position: 'relative', overflow: 'hidden' }}>
              <div className="fp-loading-bar" />
            </div>
          )}

          {loading && sorted.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span
                className="w-5 h-5 rounded-full animate-spin"
                style={{ border: '2px solid var(--accent)', borderTopColor: 'transparent' }}
              />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2" style={{ color: 'var(--text-faint)' }}>
              <div
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px dashed var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18, color: 'var(--text-ghost)',
                }}
              >
                {searchQuery ? '?' : '∅'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {searchQuery ? 'No results' : 'This folder is empty'}
              </div>
            </div>
          ) : viewMode === 'details' ? (
            // ── Virtualized details view (react-window v2) ──
            <List
              listRef={listRef}
              rowCount={sorted.length}
              rowHeight={DETAIL_ROW_H}
              overscanCount={10}
              rowComponent={VirtualDetailsRow}
              rowProps={detailsRowProps}
              style={{ height: '100%' }}
            />
          ) : (
            // ── Virtualized thumbnail grid (react-window v2) ──
            <Grid
              gridRef={gridRef}
              columnCount={thumbCols}
              columnWidth={thumbCellW}
              rowCount={Math.ceil(sorted.length / Math.max(1, thumbCols))}
              rowHeight={thumbCellH}
              overscanCount={4}
              cellComponent={VirtualThumbCell}
              cellProps={thumbCellProps}
              style={{ height: '100%' }}
            />
          )}
        </div>
      </SpaceContextMenu>
    </div>
  );
}

// ── Details view row ────────────────────────────────────
interface RowProps {
  entry: FileEntry;
  shellIconUrl: string;
  isSelected: boolean;
  isDragOver: boolean;
  isRenaming: boolean;
  renamingValue: string;
  canPaste: boolean;
  selectedCount: number;
  folderSize: number | null;
  onRowClick: (e: React.MouseEvent, entry: FileEntry) => void;
  onDoubleClick: (entry: FileEntry) => void;
  onRightClick: (entry: FileEntry) => void;
  onDragStart: (e: React.DragEvent, entry: FileEntry) => void;
  onFolderDragOver: (e: React.DragEvent) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (e: React.DragEvent) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onOpen: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onProperties: () => void;
  onNewFolder: () => void;
  onOpenWith: (exePath: string) => void;
  onExtract?: () => void;
}

function DetailsRow({
  entry, shellIconUrl, isSelected, isDragOver, isRenaming, renamingValue, canPaste, selectedCount, folderSize,
  onRowClick, onDoubleClick, onRightClick, onDragStart,
  onFolderDragOver, onFolderDragLeave, onFolderDrop,
  onRenameChange, onRenameCommit, onRenameCancel,
  onOpen, onCut, onCopy, onPaste, onRename, onDelete, onCopyPath, onProperties, onNewFolder, onOpenWith, onExtract,
}: RowProps) {
  // Grid columns come from CSS vars set on the FileBrowser container
  const gridTemplate = '1fr var(--col-type) var(--col-size) var(--col-mod)';

  return (
    <FileContextMenu
      selectedCount={selectedCount}
      isDirectory={entry.isDirectory}
      filePath={entry.path}
      extension={entry.extension}
      canPaste={canPaste}
      onOpen={onOpen}
      onCut={onCut}
      onCopy={onCopy}
      onPaste={onPaste}
      onRename={onRename}
      onDelete={onDelete}
      onCopyPath={onCopyPath}
      onProperties={onProperties}
      onNewFolder={onNewFolder}
      onOpenWith={onOpenWith}
      onExtract={onExtract}
    >
      <div
        className="grid items-center relative"
        style={{
          gridTemplateColumns: gridTemplate,
          borderBottom: '1px solid rgba(255,255,255,0.018)',
          background: isDragOver
            ? 'var(--accent-strong)'
            : isSelected ? 'var(--accent-soft)' : 'transparent',
          cursor: 'default',
          fontSize: 12.5,
          userSelect: 'none',
          outline: isDragOver ? '1px solid var(--accent)' : 'none',
          outlineOffset: '-1px',
          opacity: (entry.isHidden || entry.isSystem) ? 0.45 : 1,
          letterSpacing: '-0.005em',
        }}
        onClick={(e) => { e.stopPropagation(); onRowClick(e, entry); }}
        onDoubleClick={() => onDoubleClick(entry)}
        onContextMenu={() => onRightClick(entry)}
        draggable
        onDragStart={(e) => onDragStart(e, entry)}
        onDragOver={onFolderDragOver}
        onDragLeave={onFolderDragLeave}
        onDrop={onFolderDrop}
        onMouseEnter={(e) => { if (!isSelected && !isDragOver) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'; }}
        onMouseLeave={(e) => { if (!isSelected && !isDragOver) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {isSelected && (
          <span style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 2, background: 'var(--accent)', borderRadius: '0 2px 2px 0' }} />
        )}
        {/* Name */}
        <div className="px-3 py-1 flex items-center gap-2 min-w-0">
          <FileIcon
            extension={entry.extension}
            isDirectory={entry.isDirectory}
            size={16}
            shellIconUrl={shellIconUrl}
          />
          {isRenaming ? (
            <input
              autoFocus
              value={renamingValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onBlur={onRenameCommit}
              onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel(); e.stopPropagation(); }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="flex-1 outline-none"
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--accent)',
                color: 'var(--text)',
                fontFamily: 'Geist, sans-serif',
                fontSize: 12.5,
                padding: '2px 6px',
                borderRadius: 6,
                boxShadow: '0 0 0 3px var(--accent-soft)',
              }}
            />
          ) : (
            <span
              className="truncate"
              style={{
                color: isSelected ? 'var(--accent-text)' : entry.isDirectory ? 'var(--text)' : 'var(--text-dim)',
                fontWeight: isSelected ? 500 : entry.isDirectory ? 500 : 400,
              }}
            >
              {entry.name}
            </span>
          )}
        </div>

        {/* Type */}
        <div className="px-2 py-1 truncate" style={{ color: 'var(--text-faint)', fontSize: 10.5, letterSpacing: '0.03em', textTransform: 'uppercase', fontWeight: 500 }}>
          {entry.isDirectory ? 'Folder' : entry.extension ? entry.extension.slice(1).toUpperCase() : 'File'}
        </div>

        {/* Size */}
        <div className="px-2 py-1 truncate" style={{ color: 'var(--text-faint)', fontFamily: 'Geist Mono, monospace', fontSize: 11, letterSpacing: '0.01em' }}>
          {entry.isDirectory
            ? (folderSize != null
              ? formatSize(folderSize)
              : <span className="inline-block w-3 h-3 rounded-full animate-spin align-middle" style={{ border: '1.5px solid var(--text-faint)', borderTopColor: 'transparent' }} />)
            : formatSize(entry.size)}
        </div>

        {/* Date */}
        <div className="px-2 py-1" style={{ color: 'var(--text-faint)', fontSize: 11, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.01em' }}>
          {formatDate(entry.modified)}
        </div>
      </div>
    </FileContextMenu>
  );
}

// ── Thumbnail card ──────────────────────────────────────
interface ThumbCardProps {
  entry: FileEntry;
  shellIconUrl: string;
  size: number;
  isSelected: boolean;
  isDragOver: boolean;
  isRenaming: boolean;
  renamingValue: string;
  canPaste: boolean;
  selectedCount: number;
  onRowClick: (e: React.MouseEvent, entry: FileEntry) => void;
  onDoubleClick: (entry: FileEntry) => void;
  onRightClick: (entry: FileEntry) => void;
  onDragStart: (e: React.DragEvent, entry: FileEntry) => void;
  onFolderDragOver: (e: React.DragEvent) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (e: React.DragEvent) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onOpen: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onProperties: () => void;
  onNewFolder: () => void;
  onOpenWith: (exePath: string) => void;
  onExtract?: () => void;
}

// SVG intentionally excluded — show shell icon (e.g. Adobe Illustrator) rather than rendering SVG markup
// Files we ask the Rust side to thumbnail (image-decode in Rust for images,
// shell-thumbnail via Windows for videos when codecs are installed).
// SVG intentionally excluded — show shell icon (e.g. Adobe Illustrator).
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const VIDEO_EXTS = new Set([
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.wmv', '.m4v',
  '.flv', '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts',
  '.vob', '.ogv',
]);
const THUMB_EXTS = new Set<string>([...IMAGE_EXTS, ...VIDEO_EXTS]);

function ThumbCard({
  entry, shellIconUrl, size, isSelected, isDragOver, isRenaming, renamingValue, canPaste, selectedCount,
  onRowClick, onDoubleClick, onRightClick, onDragStart,
  onFolderDragOver, onFolderDragLeave, onFolderDrop,
  onRenameChange, onRenameCommit, onRenameCancel,
  onOpen, onCut, onCopy, onPaste, onRename, onDelete, onCopyPath, onProperties, onNewFolder, onOpenWith, onExtract,
}: ThumbCardProps) {
  // Icons fill ~78% of card, matching Explorer-style thumbnail views.
  // Source is 256px from IShellItemImageFactory so downscaling stays crisp.
  const displayIconSize = Math.round(size * 0.78);
  const isImage = THUMB_EXTS.has(entry.extension);

  // Lazy-fetch this card's thumbnail when it scrolls into view. Re-mounts
  // (after eviction) re-trigger; the Rust disk cache makes that instant.
  const thumbUrl = isImage ? getCachedThumb(entry.path) : '';
  React.useEffect(() => {
    if (isImage && !thumbUrl) requestThumb(entry.path);
  }, [entry.path, isImage, thumbUrl]);

  return (
    <FileContextMenu
      selectedCount={selectedCount}
      isDirectory={entry.isDirectory}
      filePath={entry.path}
      extension={entry.extension}
      canPaste={canPaste}
      onOpen={onOpen}
      onCut={onCut}
      onCopy={onCopy}
      onPaste={onPaste}
      onRename={onRename}
      onDelete={onDelete}
      onCopyPath={onCopyPath}
      onProperties={onProperties}
      onNewFolder={onNewFolder}
      onOpenWith={onOpenWith}
      onExtract={onExtract}
    >
      <div
        className="flex flex-col items-center cursor-default select-none"
        style={{
          background: isDragOver
            ? 'var(--accent-strong)'
            : isSelected ? 'var(--accent-soft)' : 'transparent',
          border: `1px solid ${isDragOver ? 'var(--accent)' : isSelected ? 'var(--accent-strong)' : 'transparent'}`,
          // No box-shadow / transition — they trigger Chromium compositor
          // layer promotion that defaults to opaque-black backdrops, which
          // bleeds through transparent PNG areas as a fake background.
          borderRadius: 10,
          padding: 6,
          userSelect: 'none',
          opacity: (entry.isHidden || entry.isSystem) ? 0.45 : 1,
        }}
        onClick={(e) => { e.stopPropagation(); onRowClick(e, entry); }}
        onDoubleClick={() => onDoubleClick(entry)}
        onContextMenu={() => onRightClick(entry)}
        draggable
        onDragStart={(e) => onDragStart(e, entry)}
        onDragOver={onFolderDragOver}
        onDragLeave={onFolderDragLeave}
        onDrop={onFolderDrop}
        onMouseEnter={(e) => { if (!isSelected && !isDragOver) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.035)'; }}
        onMouseLeave={(e) => { if (!isSelected && !isDragOver) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Icon / thumbnail area */}
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: size,
            height: size,
            marginBottom: 6,
            background: 'transparent',
            // No `overflow: hidden` + `border-radius` on this wrapper — the
            // combo promotes a Chromium compositor layer that defaults to
            // opaque black, surfacing as a fake background on transparent
            // PNGs. Rounding lives on the <img> instead.
          }}
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              draggable={false}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                borderRadius: 6,
              }}
            />
          ) : (
            <FileIcon
              extension={entry.extension}
              isDirectory={entry.isDirectory}
              size={displayIconSize}
              shellIconUrl={shellIconUrl}
            />
          )}
        </div>

        {/* Name */}
        {isRenaming ? (
          <input
            autoFocus
            value={renamingValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameCancel(); e.stopPropagation(); }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="outline-none text-center"
            style={{
              width: size,
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--accent)',
              color: 'var(--text)',
              fontFamily: 'Geist, sans-serif',
              fontSize: 11.5,
              padding: '2px 6px',
              borderRadius: 6,
              boxShadow: '0 0 0 3px var(--accent-soft)',
            }}
          />
        ) : (
          <span
            className="text-center leading-tight"
            style={{
              fontSize: 11.5,
              color: isSelected ? 'var(--accent-text)' : 'var(--text-dim)',
              fontFamily: 'Geist, sans-serif',
              fontWeight: isSelected ? 500 : 400,
              letterSpacing: '-0.005em',
              width: size,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
            } as React.CSSProperties}
          >
            {entry.name}
          </span>
        )}
      </div>
    </FileContextMenu>
  );
}

// ── Virtual row/cell wrappers for react-window v2 ─────────

interface VirtualDetailsProps {
  sorted: FileEntry[];
  selected: Set<string>;
  dragOverPath: string | null;
  renaming: RenameState | null;
  canPaste: boolean;
  selectedCount: number;
  folderSizes: Map<string, number>;
  onRowClick: (e: React.MouseEvent, entry: FileEntry) => void;
  onDoubleClick: (entry: FileEntry) => void;
  onRightClick: (entry: FileEntry) => void;
  onDragStart: (e: React.DragEvent, entry: FileEntry) => void;
  onFolderDragOver: (e: React.DragEvent, entry: FileEntry) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (e: React.DragEvent, entry: FileEntry) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onCopyPath: () => void;
  onProperties: () => void;
  onNewFolder: () => void;
  onOpenWith: (entry: FileEntry, exePath: string) => void;
  onExtract: (entry: FileEntry) => void;
}

function VirtualDetailsRow({ index, style, ariaAttributes, ...p }: {
  index: number;
  style: React.CSSProperties;
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
} & VirtualDetailsProps): React.ReactElement | null {
  const entry = p.sorted[index];
  if (!entry) return null;
  const key = iconKey(entry.path, entry.extension, false);
  return (
    <div style={style} {...ariaAttributes}>
      <DetailsRow
        entry={entry}
        shellIconUrl={entry.isDirectory ? '' : getCached(key)}
        isSelected={p.selected.has(entry.path)}
        isDragOver={p.dragOverPath === entry.path}
        isRenaming={p.renaming?.path === entry.path}
        renamingValue={p.renaming?.path === entry.path ? p.renaming.value : ''}
        canPaste={p.canPaste}
        selectedCount={p.selectedCount}
        folderSize={entry.isDirectory ? (p.folderSizes.get(entry.path) ?? null) : entry.size}
        onRowClick={p.onRowClick}
        onDoubleClick={p.onDoubleClick}
        onRightClick={p.onRightClick}
        onDragStart={p.onDragStart}
        onFolderDragOver={(e) => p.onFolderDragOver(e, entry)}
        onFolderDragLeave={p.onFolderDragLeave}
        onFolderDrop={(e) => p.onFolderDrop(e, entry)}
        onRenameChange={p.onRenameChange}
        onRenameCommit={p.onRenameCommit}
        onRenameCancel={p.onRenameCancel}
        onOpen={() => p.onDoubleClick(entry)}
        onCut={p.onCut}
        onCopy={p.onCopy}
        onPaste={p.onPaste}
        onRename={p.onRename}
        onDelete={p.onDelete}
        onCopyPath={p.onCopyPath}
        onProperties={p.onProperties}
        onNewFolder={p.onNewFolder}
        onOpenWith={(exePath) => p.onOpenWith(entry, exePath)}
        onExtract={() => p.onExtract(entry)}
      />
    </div>
  );
}

interface VirtualThumbProps {
  sorted: FileEntry[];
  thumbCols: number;
  selected: Set<string>;
  dragOverPath: string | null;
  renaming: RenameState | null;
  canPaste: boolean;
  selectedCount: number;
  thumbPx: number;
  onRowClick: (e: React.MouseEvent, entry: FileEntry) => void;
  onDoubleClick: (entry: FileEntry) => void;
  onRightClick: (entry: FileEntry) => void;
  onDragStart: (e: React.DragEvent, entry: FileEntry) => void;
  onFolderDragOver: (e: React.DragEvent, entry: FileEntry) => void;
  onFolderDragLeave: () => void;
  onFolderDrop: (e: React.DragEvent, entry: FileEntry) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onCopyPath: () => void;
  onProperties: () => void;
  onNewFolder: () => void;
  onOpenWith: (entry: FileEntry, exePath: string) => void;
  onExtract: (entry: FileEntry) => void;
}

function VirtualThumbCell({ columnIndex, rowIndex, style, ariaAttributes, ...p }: {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  ariaAttributes: { 'aria-colindex': number; role: 'gridcell' };
} & VirtualThumbProps): React.ReactElement | null {
  const idx = rowIndex * p.thumbCols + columnIndex;
  const entry = p.sorted[idx];
  if (!entry) return null;
  const key = iconKey(entry.path, entry.extension, false);
  return (
    <div style={style} {...ariaAttributes}>
      <ThumbCard
        entry={entry}
        shellIconUrl={entry.isDirectory ? '' : getCached(key)}
        size={p.thumbPx}
        isSelected={p.selected.has(entry.path)}
        isDragOver={p.dragOverPath === entry.path}
        isRenaming={p.renaming?.path === entry.path}
        renamingValue={p.renaming?.path === entry.path ? p.renaming.value : ''}
        canPaste={p.canPaste}
        selectedCount={p.selectedCount}
        onRowClick={p.onRowClick}
        onDoubleClick={p.onDoubleClick}
        onRightClick={p.onRightClick}
        onDragStart={p.onDragStart}
        onFolderDragOver={(e) => p.onFolderDragOver(e, entry)}
        onFolderDragLeave={p.onFolderDragLeave}
        onFolderDrop={(e) => p.onFolderDrop(e, entry)}
        onRenameChange={p.onRenameChange}
        onRenameCommit={p.onRenameCommit}
        onRenameCancel={p.onRenameCancel}
        onOpen={() => p.onDoubleClick(entry)}
        onCut={p.onCut}
        onCopy={p.onCopy}
        onPaste={p.onPaste}
        onRename={p.onRename}
        onDelete={p.onDelete}
        onCopyPath={p.onCopyPath}
        onProperties={p.onProperties}
        onNewFolder={p.onNewFolder}
        onOpenWith={(exePath) => p.onOpenWith(entry, exePath)}
        onExtract={() => p.onExtract(entry)}
      />
    </div>
  );
}

function NavBtn({ onClick, disabled, title, icon }: { onClick: () => void; disabled?: boolean; title: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="disabled:opacity-25 transition-all"
      style={{
        width: 26,
        height: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        color: 'var(--text-dim)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        if ((e.currentTarget as HTMLButtonElement).disabled) return;
        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
        (e.currentTarget as HTMLElement).style.color = 'var(--text)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)';
      }}
      title={title}
    >
      {icon}
    </button>
  );
}

function sortEntries(
  entries: FileEntry[],
  field: SortField,
  dir: SortDir,
  folderSizes: Map<string, number>,
): FileEntry[] {
  // For directories the backend's `entry.size` is the directory record size
  // (effectively 0), not the recursive content size. Real folder sizes are
  // resolved async into `folderSizes` — fall back to that when sorting by
  // size so folders sort meaningfully alongside files.
  const sizeOf = (e: FileEntry): number =>
    e.isDirectory ? (folderSizes.get(e.path) ?? -1) : e.size;

  return [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    let cmp = 0;
    switch (field) {
      case 'name':     cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); break;
      case 'size':     cmp = sizeOf(a) - sizeOf(b); break;
      case 'modified': cmp = a.modified - b.modified; break;
      case 'type':     cmp = a.extension.localeCompare(b.extension); break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}
