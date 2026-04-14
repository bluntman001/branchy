import React, { useState, useCallback, useRef } from 'react';
import {
  PiArrowUp, PiArrowLeft, PiArrowRight,
  PiArrowClockwise, PiFolderPlus, PiMagnifyingGlass,
  PiListBullets, PiSquaresFour,
} from 'react-icons/pi';
import toast from 'react-hot-toast';
import { FileIcon } from './FileIcon';
import { FileContextMenu, SpaceContextMenu } from './ContextMenu';
import { formatSize, formatDate } from '../utils/formatSize';
import { useShellIcon } from '../hooks/useShellIcon';
import { FileEntry } from '../../types';

type SortField  = 'name' | 'size' | 'modified' | 'type';
type SortDir    = 'asc' | 'desc';
type ViewMode   = 'details' | 'thumbnails';
type ThumbSize  = 'small' | 'medium' | 'large';

const THUMB_PX: Record<ThumbSize, number> = { small: 80, medium: 120, large: 160 };

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
}

interface RenameState { path: string; value: string; }

export function FileBrowser({
  entries, loading, currentPath, selected,
  canGoBack, canGoForward,
  onNavigate, onSelect, onSelectAll, onClearSelection,
  onGoBack, onGoForward, onGoUp, onRefresh, onDrop,
}: FileBrowserProps) {
  const [sortField, setSortField]         = useState<SortField>('name');
  const [sortDir, setSortDir]             = useState<SortDir>('asc');
  const [renaming, setRenaming]           = useState<RenameState | null>(null);
  const [searchQuery, setSearchQuery]     = useState('');
  const [searchResults, setSearchResults] = useState<FileEntry[] | null>(null);
  const [searching, setSearching]         = useState(false);
  const [viewMode, setViewMode]           = useState<ViewMode>('details');
  const [thumbSize, setThumbSize]         = useState<ThumbSize>('medium');
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clipboard (cut/copy tracking — paths + mode)
  const [clipboard, setClipboard] = useState<{ paths: string[]; mode: 'cut' | 'copy' } | null>(null);

  const sorted = sortEntries(searchResults ?? entries, sortField, sortDir);

  function getSelectedEntries(): FileEntry[] {
    return (searchResults ?? entries).filter((e) => selected.has(e.path));
  }

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
      try { await window.fileAPI.openFile(entry.path); }
      catch (err) { toast.error(`Cannot open: ${(err as Error).message}`); }
    }
  };

  const handleRowClick = (e: React.MouseEvent, entry: FileEntry) => {
    if (e.ctrlKey || e.metaKey) onSelect(entry.path, 'toggle');
    else if (e.shiftKey)        onSelect(entry.path, 'range');
    else                        onSelect(entry.path, 'single');
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
    const sep  = entry.path.includes('\\') ? '\\' : '/';
    const dir  = entry.path.slice(0, entry.path.lastIndexOf(sep));
    const newPath = dir + sep + renaming.value;
    if (newPath !== renaming.path) {
      try {
        await window.fileAPI.renameFile(renaming.path, newPath);
        onRefresh();
        toast.success('Renamed');
      } catch (err) { toast.error(`Rename failed: ${(err as Error).message}`); }
    }
    setRenaming(null);
  };

  const handleDelete = useCallback(async () => {
    const sel = getSelectedEntries();
    if (sel.length === 0) return;
    const confirmDelete = await window.fileAPI.settings.get('confirmDelete') as boolean;
    if (confirmDelete) {
      const ok = window.confirm(`Delete ${sel.length} item(s)? They will be moved to the Recycle Bin.`);
      if (!ok) return;
    }
    try {
      await window.fileAPI.deleteFiles(sel.map((e) => e.path));
      onClearSelection();
      onRefresh();
      toast.success(`Deleted ${sel.length} item(s)`);
    } catch (err) { toast.error(`Delete failed: ${(err as Error).message}`); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, searchResults, entries]);

  const handleCut  = () => setClipboard({ paths: getSelectedEntries().map((e) => e.path), mode: 'cut' });
  const handleCopy = () => setClipboard({ paths: getSelectedEntries().map((e) => e.path), mode: 'copy' });
  const handlePaste = async () => {
    if (!clipboard) return;
    try {
      if (clipboard.mode === 'copy') {
        await window.fileAPI.copyFiles(clipboard.paths, currentPath);
        toast.success('Copied');
      } else {
        await window.fileAPI.moveFiles(clipboard.paths, currentPath);
        setClipboard(null);
        toast.success('Moved');
      }
      onRefresh();
    } catch (err) { toast.error(`Paste failed: ${(err as Error).message}`); }
  };
  const handleCopyPath = () => {
    const paths = getSelectedEntries().map((e) => e.path).join('\n');
    navigator.clipboard.writeText(paths).then(() => toast.success('Path copied'));
  };

  const handleCreateFolder = async () => {
    const name = window.prompt('New folder name:');
    if (!name) return;
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const folderPath = currentPath.replace(/[/\\]+$/, '') + sep + name;
    try { await window.fileAPI.createFolder(folderPath); onRefresh(); }
    catch (err) { toast.error(`Create folder failed: ${(err as Error).message}`); }
  };

  const handleNewFile = async () => {
    const name = window.prompt('New file name:', 'untitled.txt');
    if (!name) return;
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const filePath = currentPath.replace(/[/\\]+$/, '') + sep + name;
    try {
      await window.fileAPI.createFile(filePath);
      onRefresh();
      toast.success(`Created ${name}`);
    } catch (err) { toast.error(`Create file failed: ${(err as Error).message}`); }
  };

  const handleOpenWith = async (entry: FileEntry, exePath: string) => {
    try {
      await window.fileAPI.openFileWith(entry.path, exePath);
    } catch (err) { toast.error(`Open failed: ${(err as Error).message}`); }
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
        const results = await window.fileAPI.searchFiles(currentPath, query);
        setSearchResults(results);
      } catch (err) { toast.error(`Search failed: ${(err as Error).message}`); }
      finally { setSearching(false); }
    }, 300);
  };

  const handleDragStart = (e: React.DragEvent, entry: FileEntry) => {
    const paths = selected.has(entry.path) ? [...selected] : [entry.path];
    e.dataTransfer.setData('application/filepilot', JSON.stringify(paths));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'F2')             handleRename();
    if (e.key === 'Delete')         handleDelete();
    if (e.key === 'F5')             onRefresh();
    if (e.ctrlKey && e.key === 'a') { e.preventDefault(); onSelectAll(); }
    if (e.ctrlKey && e.key === 'c') handleCopy();
    if (e.ctrlKey && e.key === 'x') handleCut();
    if (e.ctrlKey && e.key === 'v') handlePaste();
    if (e.key === 'Escape') { onClearSelection(); setSearchQuery(''); setSearchResults(null); }
  };

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

  return (
    <div
      className="h-full flex flex-col outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-1 px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: '#2a2a2a', background: '#1a1a1a' }}
      >
        <NavBtn onClick={onGoBack}    disabled={!canGoBack}    title="Back"    icon={<PiArrowLeft size={14} />} />
        <NavBtn onClick={onGoForward} disabled={!canGoForward} title="Forward" icon={<PiArrowRight size={14} />} />
        <NavBtn onClick={onGoUp}      title="Up"               icon={<PiArrowUp size={14} />} />
        <NavBtn onClick={onRefresh}   title="Refresh"          icon={<PiArrowClockwise size={14} />} />
        <div className="flex-1" />

        {/* Search */}
        <div className="relative flex items-center">
          <PiMagnifyingGlass size={12} className="absolute left-2" style={{ color: '#555' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search…"
            className="pl-6 pr-2 py-1 rounded text-xs outline-none"
            style={{ background: '#111', border: '1px solid #2a2a2a', color: '#e5e5e5', width: 160, fontFamily: 'Inter, sans-serif' }}
          />
          {searching && <span className="absolute right-2 w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 ml-2 rounded p-0.5" style={{ background: '#111', border: '1px solid #2a2a2a' }}>
          <ViewBtn active={viewMode === 'details'}    title="Details"    icon={<PiListBullets size={13} />}   onClick={() => setViewMode('details')} />
          <ViewBtn active={viewMode === 'thumbnails'} title="Thumbnails" icon={<PiSquaresFour size={13} />}  onClick={() => setViewMode('thumbnails')} />
        </div>

        {/* Thumb size selector — only in thumbnail mode */}
        {viewMode === 'thumbnails' && (
          <div className="flex items-center gap-0.5 ml-1 rounded p-0.5" style={{ background: '#111', border: '1px solid #2a2a2a' }}>
            {(['small', 'medium', 'large'] as ThumbSize[]).map((s) => (
              <button
                key={s}
                onClick={() => setThumbSize(s)}
                className="px-2 py-0.5 rounded text-xs transition-colors"
                style={{
                  color: thumbSize === s ? '#e5e5e5' : '#666',
                  background: thumbSize === s ? '#2a2a2a' : 'transparent',
                  fontSize: 10,
                }}
              >
                {s[0].toUpperCase()}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={handleCreateFolder}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-white/10 transition-colors ml-1"
          style={{ color: '#666' }}
        >
          <PiFolderPlus size={13} />
          <span>New Folder</span>
        </button>
      </div>

      {/* Column headers — only in details mode */}
      {viewMode === 'details' && (
        <div
          className="grid border-b flex-shrink-0"
          style={{ gridTemplateColumns: '1fr 80px 90px 130px', borderColor: '#2a2a2a', background: '#161616', fontSize: 10, color: '#555' }}
        >
          {(['name', 'type', 'size', 'modified'] as SortField[]).map((f) => (
            <div
              key={f}
              className="px-3 py-1.5 cursor-pointer hover:text-gray-400 select-none uppercase tracking-wide"
              onClick={() => handleSort(f)}
            >
              {f}{sortIndicator(f)}
            </div>
          ))}
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
          className="flex-1 overflow-y-auto"
          onClick={() => onClearSelection()}
        >
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <span className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm" style={{ color: '#444' }}>
              {searchQuery ? 'No results' : 'Empty folder'}
            </div>
          ) : viewMode === 'details' ? (
            // ── Details view ──────────────────────────────
            sorted.map((entry) => (
              <DetailsRow
                key={entry.path}
                entry={entry}
                isSelected={selected.has(entry.path)}
                isRenaming={renaming?.path === entry.path}
                renamingValue={renaming?.value ?? ''}
                canPaste={clipboard !== null}
                onRowClick={handleRowClick}
                onDoubleClick={handleDoubleClick}
                onRightClick={handleRowRightClick}
                onDragStart={handleDragStart}
                onRenameChange={(v) => setRenaming({ path: entry.path, value: v })}
                onRenameCommit={commitRename}
                onRenameCancel={() => setRenaming(null)}
                onOpen={() => {
                  if (entry.isDirectory) onNavigate(entry.path);
                  else window.fileAPI.openFile(entry.path);
                }}
                onCut={handleCut}
                onCopy={handleCopy}
                onPaste={handlePaste}
                onRename={handleRename}
                onDelete={handleDelete}
                onCopyPath={handleCopyPath}
                onProperties={handleProperties}
                onNewFolder={handleCreateFolder}
                onOpenWith={(exePath) => handleOpenWith(entry, exePath)}
                selectedCount={Math.max(selected.size, 1)}
              />
            ))
          ) : (
            // ── Thumbnail view ────────────────────────────
            <div
              className="p-3"
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${THUMB_PX[thumbSize] + 24}px, 1fr))`,
                gap: 8,
                alignContent: 'start',
              }}
            >
              {sorted.map((entry) => (
                <ThumbCard
                  key={entry.path}
                  entry={entry}
                  size={THUMB_PX[thumbSize]}
                  isSelected={selected.has(entry.path)}
                  canPaste={clipboard !== null}
                  onRowClick={handleRowClick}
                  onDoubleClick={handleDoubleClick}
                  onRightClick={handleRowRightClick}
                  onDragStart={handleDragStart}
                  onOpen={() => {
                    if (entry.isDirectory) onNavigate(entry.path);
                    else window.fileAPI.openFile(entry.path);
                  }}
                  onCut={handleCut}
                  onCopy={handleCopy}
                  onPaste={handlePaste}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onCopyPath={handleCopyPath}
                  onProperties={handleProperties}
                  onNewFolder={handleCreateFolder}
                  onOpenWith={(exePath) => handleOpenWith(entry, exePath)}
                  selectedCount={Math.max(selected.size, 1)}
                />
              ))}
            </div>
          )}
        </div>
      </SpaceContextMenu>
    </div>
  );
}

// ── Details view row ────────────────────────────────────
interface RowProps {
  entry: FileEntry;
  isSelected: boolean;
  isRenaming: boolean;
  renamingValue: string;
  canPaste: boolean;
  selectedCount: number;
  onRowClick: (e: React.MouseEvent, entry: FileEntry) => void;
  onDoubleClick: (entry: FileEntry) => void;
  onRightClick: (entry: FileEntry) => void;
  onDragStart: (e: React.DragEvent, entry: FileEntry) => void;
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
}

function DetailsRow({
  entry, isSelected, isRenaming, renamingValue, canPaste, selectedCount,
  onRowClick, onDoubleClick, onRightClick, onDragStart,
  onRenameChange, onRenameCommit, onRenameCancel,
  onOpen, onCut, onCopy, onPaste, onRename, onDelete, onCopyPath, onProperties, onNewFolder, onOpenWith,
}: RowProps) {
  const shellIconUrl = useShellIcon(entry.path, entry.extension, entry.isDirectory);

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
    >
      <div
        className="grid items-center border-b"
        style={{
          gridTemplateColumns: '1fr 80px 90px 130px',
          borderColor: '#1c1c1c',
          background: isSelected ? 'rgba(59,130,246,0.13)' : 'transparent',
          cursor: 'default',
          fontSize: 12.5,
          userSelect: 'none',
        }}
        onClick={(e) => { e.stopPropagation(); onRowClick(e, entry); }}
        onDoubleClick={() => onDoubleClick(entry)}
        onContextMenu={() => onRightClick(entry)}
        draggable
        onDragStart={(e) => onDragStart(e, entry)}
        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#1e1e1e'; }}
        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Name */}
        <div className="px-3 py-2 flex items-center gap-2 min-w-0">
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
              className="flex-1 px-1 rounded outline-none"
              style={{ background: '#0f0f0f', border: '1px solid #3b82f6', color: '#e5e5e5', fontFamily: 'Inter, sans-serif', fontSize: 12.5 }}
            />
          ) : (
            <span
              className="truncate"
              style={{
                fontFamily: 'Inter, sans-serif',
                color: isSelected ? '#93c5fd' : entry.isDirectory ? '#e2e2e2' : '#c0c0c0',
              }}
            >
              {entry.name}
            </span>
          )}
        </div>

        {/* Type */}
        <div className="px-2 py-2 truncate" style={{ color: '#555', fontSize: 11 }}>
          {entry.isDirectory ? 'Folder' : entry.extension ? entry.extension.slice(1).toUpperCase() : 'File'}
        </div>

        {/* Size */}
        <div className="px-2 py-2 text-right" style={{ color: '#555', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          {entry.isDirectory ? '—' : formatSize(entry.size)}
        </div>

        {/* Date */}
        <div className="px-2 py-2" style={{ color: '#555', fontSize: 11 }}>
          {formatDate(entry.modified)}
        </div>
      </div>
    </FileContextMenu>
  );
}

// ── Thumbnail card ──────────────────────────────────────
interface ThumbCardProps {
  entry: FileEntry;
  size: number;
  isSelected: boolean;
  canPaste: boolean;
  selectedCount: number;
  onRowClick: (e: React.MouseEvent, entry: FileEntry) => void;
  onDoubleClick: (entry: FileEntry) => void;
  onRightClick: (entry: FileEntry) => void;
  onDragStart: (e: React.DragEvent, entry: FileEntry) => void;
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
}

function ThumbCard({
  entry, size, isSelected, canPaste, selectedCount,
  onRowClick, onDoubleClick, onRightClick, onDragStart,
  onOpen, onCut, onCopy, onPaste, onRename, onDelete, onCopyPath, onProperties, onNewFolder, onOpenWith,
}: ThumbCardProps) {
  const shellIconUrl = useShellIcon(entry.path, entry.extension, entry.isDirectory);
  const iconSize = Math.round(size * 0.55);

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
    >
      <div
        className="flex flex-col items-center rounded-lg p-2 cursor-default transition-colors select-none"
        style={{
          background: isSelected ? 'rgba(59,130,246,0.18)' : 'transparent',
          border: `1px solid ${isSelected ? 'rgba(59,130,246,0.4)' : 'transparent'}`,
          userSelect: 'none',
        }}
        onClick={(e) => { e.stopPropagation(); onRowClick(e, entry); }}
        onDoubleClick={() => onDoubleClick(entry)}
        onContextMenu={() => onRightClick(entry)}
        draggable
        onDragStart={(e) => onDragStart(e, entry)}
        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#1e1e1e'; }}
        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Icon area */}
        <div
          className="flex items-center justify-center rounded mb-1.5 flex-shrink-0"
          style={{ width: size, height: size }}
        >
          <FileIcon
            extension={entry.extension}
            isDirectory={entry.isDirectory}
            size={iconSize}
            shellIconUrl={shellIconUrl}
          />
        </div>

        {/* Name */}
        <span
          className="text-center leading-tight"
          style={{
            fontSize: 11,
            color: isSelected ? '#93c5fd' : '#c0c0c0',
            fontFamily: 'Inter, sans-serif',
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
      </div>
    </FileContextMenu>
  );
}

function NavBtn({ onClick, disabled, title, icon }: { onClick: () => void; disabled?: boolean; title: string; icon: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
      style={{ color: '#888' }}
      title={title}
    >
      {icon}
    </button>
  );
}

function ViewBtn({ active, title, icon, onClick }: { active: boolean; title: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 rounded transition-colors"
      style={{ color: active ? '#e5e5e5' : '#555', background: active ? '#2a2a2a' : 'transparent' }}
    >
      {icon}
    </button>
  );
}

function sortEntries(entries: FileEntry[], field: SortField, dir: SortDir): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    let cmp = 0;
    switch (field) {
      case 'name':     cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }); break;
      case 'size':     cmp = a.size - b.size; break;
      case 'modified': cmp = a.modified - b.modified; break;
      case 'type':     cmp = a.extension.localeCompare(b.extension); break;
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}
