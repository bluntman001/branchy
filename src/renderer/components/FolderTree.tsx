import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as Collapsible from '@radix-ui/react-collapsible';
import { PiCaretRight, PiCaretDown } from 'react-icons/pi';
import { FileIcon, DriveIcon, PlaceIcon, SpecialPlace } from './FileIcon';
import { DriveInfo, MostUsedEntry } from '../../types';
import { formatSize } from '../utils/formatSize';
import { basename } from '../utils/path';
import { fileAPI } from '../../api';

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isOpen: boolean;
  isLoading: boolean;
  hasChildren: boolean | null;
}

async function loadChildren(dirPath: string): Promise<TreeNode[]> {
  try {
    const entries = await fileAPI.listDirectory(dirPath);
    const dirs = entries.filter((e) => e.isDirectory);
    const nodes = await Promise.all(
      dirs.map(async (e): Promise<TreeNode> => {
        let hasChildren: boolean | null = null;
        try {
          hasChildren = await fileAPI.hasSubdirectories(e.path);
        } catch { /* ignore */ }
        return { name: e.name, path: e.path, children: [], isOpen: false, isLoading: false, hasChildren };
      })
    );
    return nodes;
  } catch {
    return [];
  }
}

// ── special places ────────────────────────────────────
interface SpecialPaths {
  home: string;
  desktop: string;
  downloads: string;
  documents: string;
  music: string;
  pictures: string;
}

interface PlaceEntry {
  label: string;
  place: SpecialPlace;
  key: keyof SpecialPaths;
}

const PLACE_ENTRIES: PlaceEntry[] = [
  { label: 'Home',      place: 'home',      key: 'home' },
  { label: 'Desktop',   place: 'desktop',   key: 'desktop' },
  { label: 'Downloads', place: 'downloads', key: 'downloads' },
  { label: 'Documents', place: 'documents', key: 'documents' },
  { label: 'Music',     place: 'music',     key: 'music' },
  { label: 'Pictures',  place: 'pictures',  key: 'pictures' },
];

// ── FolderTree root ───────────────────────────────────
interface FolderTreeProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onDrop: (sourcePaths: string[], destDir: string) => void;
}

export function FolderTree({ currentPath, onNavigate, onDrop }: FolderTreeProps) {
  const [specialPaths, setSpecialPaths] = useState<SpecialPaths | null>(null);
  const [drives, setDrives]            = useState<DriveInfo[]>([]);
  const [mostUsed, setMostUsed]     = useState<MostUsedEntry[]>([]);
  const [driveNodes, setDriveNodes] = useState<Record<string, TreeNode[]>>({});
  const [driveOpen, setDriveOpen]   = useState<Record<string, boolean>>({});
  const [driveLoading, setDriveLoading] = useState<Record<string, boolean>>({});

  const [mostUsedOpen, setMostUsedOpen] = useState(true);
  const [localOpen, setLocalOpen]       = useState(true);
  const [storageOpen, setStorageOpen]   = useState(true);

  const [dragOver, setDragOver] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const id = requestAnimationFrame(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
    });
    return () => { cancelAnimationFrame(id); window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, [ctxMenu]);

  const handleRemoveMostUsed = async (dirPath: string) => {
    await fileAPI.nav.removeMostUsed(dirPath);
    setMostUsed((prev) => prev.filter((m) => m.path !== dirPath));
    setCtxMenu(null);
  };

  useEffect(() => {
    async function init() {
      const [paths, driveList, mu] = await Promise.all([
        fileAPI.settings.getSpecialPaths(),
        fileAPI.getDrives(),
        fileAPI.nav.getMostUsed(8),
      ]);
      setSpecialPaths(paths);
      setDrives(driveList);
      setMostUsed(mu);
    }
    init();

    // Poll for drive plug/unplug. Windows offers WM_DEVICECHANGE for push
    // notifications but Tauri doesn't expose a hook for it without a custom
    // plugin — a 2s poll on a sub-millisecond WinAPI call is cheap and
    // catches USB inserts/ejects within a heartbeat. We only setState when
    // the letter set actually changed so identity-stable list passes are no-ops.
    let lastSig = '';
    const id = window.setInterval(async () => {
      try {
        const next = await fileAPI.getDrives();
        const sig = next.map((d) => `${d.letter}:${d.size ?? ''}:${d.free ?? ''}`).join('|');
        if (sig !== lastSig) {
          lastSig = sig;
          setDrives(next);
        }
      } catch { /* ignore — next tick will retry */ }
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!currentPath) return;
    fileAPI.nav.getMostUsed(8).then(setMostUsed);
  }, [currentPath]);

  const toggleDrive = useCallback(async (drivePath: string) => {
    if (driveOpen[drivePath]) {
      setDriveOpen((p) => ({ ...p, [drivePath]: false }));
      return;
    }
    if (!driveNodes[drivePath]) {
      setDriveLoading((p) => ({ ...p, [drivePath]: true }));
      const children = await loadChildren(drivePath);
      setDriveNodes((p) => ({ ...p, [drivePath]: children }));
      setDriveLoading((p) => ({ ...p, [drivePath]: false }));
    }
    setDriveOpen((p) => ({ ...p, [drivePath]: true }));
  }, [driveOpen, driveNodes]);

  const updateDriveNodes = useCallback((drivePath: string, updater: (nodes: TreeNode[]) => TreeNode[]) => {
    setDriveNodes((prev) => ({ ...prev, [drivePath]: updater(prev[drivePath] ?? []) }));
  }, []);

  function handleDrop(e: React.DragEvent, destDir: string) {
    e.preventDefault();
    setDragOver(null);
    const data = e.dataTransfer.getData('application/filepilot');
    if (data) {
      try { onDrop(JSON.parse(data), destDir); } catch { /* ignore */ }
    }
  }

  const rowProps = (path: string) => ({
    isActive: currentPath === path,
    isDragOver: dragOver === path,
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(path); },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => handleDrop(e, path),
    onClick: () => onNavigate(path),
  });

  return (
    <div className="h-full flex flex-col overflow-y-auto select-none pb-4" style={{ background: 'transparent' }}>

      {/* ── Most Used ─────────────────────── */}
      {mostUsed.length > 0 && (
        <Section label="Most Used" open={mostUsedOpen} onToggle={() => setMostUsedOpen((v) => !v)}>
          {mostUsed.map((mu) => (
            <PlainRow
              key={mu.path}
              label={basename(mu.path) || mu.path}
              icon={<PlaceIcon place="recent" size={14} />}
              indent={1}
              {...rowProps(mu.path)}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY, path: mu.path }); }}
            />
          ))}
        </Section>
      )}

      {/* ── Local ─────────────────────────── */}
      <Section label="Local" open={localOpen} onToggle={() => setLocalOpen((v) => !v)}>
        {PLACE_ENTRIES.map((p) => {
          const placePath = specialPaths ? specialPaths[p.key] : '';
          return (
            <PlainRow
              key={p.label}
              label={p.label}
              icon={<PlaceIcon place={p.place} size={14} />}
              indent={1}
              {...(placePath ? rowProps(placePath) : { isActive: false, isDragOver: false })}
              onClick={placePath ? () => onNavigate(placePath) : undefined}
            />
          );
        })}
      </Section>

      {/* ── Storage ───────────────────────── */}
      <Section label="Storage" open={storageOpen} onToggle={() => setStorageOpen((v) => !v)}>
        {drives.map((drive) => (
          <TreeDriveRow
            key={drive.path}
            drive={drive}
            nodes={driveNodes[drive.path] ?? []}
            isOpen={driveOpen[drive.path] ?? false}
            isLoading={driveLoading[drive.path] ?? false}
            currentPath={currentPath}
            dragOver={dragOver}
            onToggle={() => toggleDrive(drive.path)}
            onNavigate={onNavigate}
            onDrop={handleDrop}
            onDragOver={setDragOver}
            onUpdate={(updater) => updateDriveNodes(drive.path, updater)}
          />
        ))}
      </Section>

      {ctxMenu && createPortal(
        <div
          className="fp-glass"
          style={{
            position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999,
            background: 'rgba(24, 20, 30, 0.92)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: 6, minWidth: 200,
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <button
            className="fp-ctx-item w-full"
            onClick={() => handleRemoveMostUsed(ctxMenu.path)}
          >
            Remove from Most Used
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

// ── Section wrapper (Radix Collapsible) ───────────────
function Section({ label, open, onToggle, children }: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible.Root open={open} onOpenChange={onToggle} className="mt-3">
      <Collapsible.Trigger asChild>
        <button
          className="flex items-center gap-1.5 w-full px-3 py-1 text-left transition-colors"
          style={{
            fontSize: 9.5,
            color: 'var(--text-faint)',
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            fontWeight: 600,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-faint)'; }}
        >
          {open ? <PiCaretDown size={9} /> : <PiCaretRight size={9} />}
          {label}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="fp-section-content overflow-hidden">
        <div style={{ marginTop: 4 }}>{children}</div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

// ── Simple non-expandable row ─────────────────────────
interface PlainRowProps {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  isDragOver?: boolean;
  indent?: number;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}

function PlainRow({ label, icon, isActive, isDragOver, indent = 0, onClick, onContextMenu, onDragOver, onDragLeave, onDrop }: PlainRowProps) {
  return (
    <button
      className="flex items-center gap-2.5 w-full text-left transition-colors relative"
      style={{
        paddingLeft: 12 + indent * 12,
        paddingRight: 8,
        paddingTop: 5,
        paddingBottom: 5,
        marginLeft: 6,
        marginRight: 6,
        borderRadius: 8,
        width: 'calc(100% - 12px)',
        background: isDragOver ? 'var(--accent-strong)' : isActive ? 'var(--accent-soft)' : 'transparent',
        color: isActive ? 'var(--accent-text)' : 'var(--text-dim)',
        fontSize: 12.5,
        fontWeight: isActive ? 500 : 400,
        letterSpacing: '-0.005em',
        boxShadow: isDragOver ? 'inset 0 0 0 1px var(--accent)' : 'none',
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={(e) => { if (!isActive && !isDragOver) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; } }}
      onMouseLeave={(e) => { if (!isActive && !isDragOver) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; } }}
    >
      {isActive && (
        <span style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 2, background: 'var(--accent)', borderRadius: '0 2px 2px 0' }} />
      )}
      <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.85 }}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// ── Drive-level expandable row ────────────────────────
interface TreeDriveRowProps {
  drive: DriveInfo;
  nodes: TreeNode[];
  isOpen: boolean;
  isLoading: boolean;
  currentPath: string;
  dragOver: string | null;
  onToggle: () => void;
  onNavigate: (p: string) => void;
  onDrop: (e: React.DragEvent, dest: string) => void;
  onDragOver: (p: string | null) => void;
  onUpdate: (updater: (nodes: TreeNode[]) => TreeNode[]) => void;
}

function TreeDriveRow({ drive, nodes, isOpen, isLoading, currentPath, dragOver, onToggle, onNavigate, onDrop, onDragOver, onUpdate }: TreeDriveRowProps) {
  const isActive  = currentPath === drive.path;
  const isDragOver = dragOver === drive.path;

  const usedPct = (drive.size && drive.free !== undefined && drive.size > 0)
    ? Math.round(((drive.size - drive.free) / drive.size) * 100)
    : null;

  return (
    <div className="mb-0.5 relative">
      {/* Drive header row */}
      <div
        className="flex items-center gap-1.5 cursor-pointer transition-colors relative"
        style={{
          marginLeft: 6,
          marginRight: 6,
          borderRadius: 8,
          width: 'calc(100% - 12px)',
          background: isDragOver ? 'var(--accent-strong)' : isActive ? 'var(--accent-soft)' : 'transparent',
          color: isActive ? 'var(--accent-text)' : 'var(--text-dim)',
          fontSize: 12.5,
          fontWeight: isActive ? 500 : 400,
          padding: '5px 8px 5px 4px',
          boxShadow: isDragOver ? 'inset 0 0 0 1px var(--accent)' : 'none',
        }}
        onMouseEnter={(e) => { if (!isActive && !isDragOver) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; } }}
        onMouseLeave={(e) => { if (!isActive && !isDragOver) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; } }}
        onDragOver={(e) => { e.preventDefault(); onDragOver(drive.path); }}
        onDragLeave={() => onDragOver(null)}
        onDrop={(e) => onDrop(e, drive.path)}
        onClick={() => onNavigate(drive.path)}
      >
        {isActive && (
          <span style={{ position: 'absolute', left: -6, top: 6, bottom: 6, width: 2, background: 'var(--accent)', borderRadius: '0 2px 2px 0' }} />
        )}
        <button
          className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded transition-colors"
          style={{ color: 'var(--text-faint)' }}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {isLoading
            ? <span className="w-2.5 h-2.5 rounded-full animate-spin block" style={{ border: '1.5px solid var(--text-faint)', borderTopColor: 'transparent' }} />
            : isOpen
            ? <PiCaretDown size={10} />
            : <PiCaretRight size={10} />
          }
        </button>
        <DriveIcon driveType={drive.type} size={15} />
        <span className="truncate flex-1" style={{ letterSpacing: '-0.005em' }}>
          {drive.label || drive.letter}
        </span>
        <span style={{ fontSize: 9.5, color: 'var(--text-ghost)', fontFamily: 'Geist Mono, monospace', flexShrink: 0, letterSpacing: '0.02em' }}>
          {drive.letter}
        </span>
      </div>

      {/* Storage bar — shown when size info is available */}
      {usedPct !== null && drive.size && drive.free !== undefined && (
        <div style={{ marginLeft: 26, marginRight: 12, marginTop: 2, marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--text-ghost)', marginBottom: 4, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.01em' }}>
            <span>{formatSize(drive.free)} free</span>
            <span>{formatSize(drive.size)}</span>
          </div>
          <div style={{ height: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${usedPct}%`,
                background: usedPct > 90
                  ? 'linear-gradient(90deg, #f06e7e, #ff8a96)'
                  : usedPct > 70
                  ? 'linear-gradient(90deg, #f5a25d, #ffb77a)'
                  : 'linear-gradient(90deg, var(--accent), var(--accent-hover))',
                borderRadius: 2,
                transition: 'width 400ms ease',
                boxShadow: usedPct > 90
                  ? '0 0 8px rgba(240,110,126,0.4)'
                  : usedPct > 70
                  ? '0 0 8px rgba(245,162,93,0.35)'
                  : '0 0 8px var(--accent-glow)',
              }}
            />
          </div>
        </div>
      )}

      {/* Expanded folder tree */}
      {isOpen && nodes.map((node) => (
        <TreeNodeRow
          key={node.path}
          node={node}
          depth={1}
          currentPath={currentPath}
          dragOver={dragOver}
          onNavigate={onNavigate}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onUpdate={(updated) => onUpdate((prev) =>
            prev.map((n) => n.path === updated.path ? updated : n)
          )}
        />
      ))}
    </div>
  );
}

// ── Recursive folder tree row ─────────────────────────
interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  currentPath: string;
  dragOver: string | null;
  onNavigate: (p: string) => void;
  onDrop: (e: React.DragEvent, dest: string) => void;
  onDragOver: (p: string | null) => void;
  onUpdate: (updated: TreeNode) => void;
}

function TreeNodeRow({ node, depth, currentPath, dragOver, onNavigate, onDrop, onDragOver, onUpdate }: TreeNodeRowProps) {
  const isActive   = currentPath === node.path;
  const isDragOver = dragOver === node.path;
  const showToggle = node.hasChildren !== false;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!showToggle) return;
    if (node.isOpen) {
      onUpdate({ ...node, isOpen: false });
      return;
    }
    if (node.children.length === 0) {
      onUpdate({ ...node, isLoading: true });
      const children = await loadChildren(node.path);
      onUpdate({ ...node, children, isOpen: true, isLoading: false, hasChildren: children.length > 0 });
    } else {
      onUpdate({ ...node, isOpen: true });
    }
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 cursor-pointer transition-colors relative"
        style={{
          marginLeft: 6 + depth * 14,
          marginRight: 6,
          borderRadius: 8,
          background: isDragOver ? 'var(--accent-strong)' : isActive ? 'var(--accent-soft)' : 'transparent',
          color: isActive ? 'var(--accent-text)' : 'var(--text-dim)',
          fontSize: 12.5,
          fontWeight: isActive ? 500 : 400,
          padding: '4px 6px 4px 4px',
          letterSpacing: '-0.005em',
          boxShadow: isDragOver ? 'inset 0 0 0 1px var(--accent)' : 'none',
        }}
        onMouseEnter={(e) => { if (!isActive && !isDragOver) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; } }}
        onMouseLeave={(e) => { if (!isActive && !isDragOver) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; } }}
        onDragOver={(e) => { e.preventDefault(); onDragOver(node.path); }}
        onDragLeave={() => onDragOver(null)}
        onDrop={(e) => onDrop(e, node.path)}
        onClick={() => onNavigate(node.path)}
      >
        {isActive && (
          <span style={{ position: 'absolute', left: -6, top: 5, bottom: 5, width: 2, background: 'var(--accent)', borderRadius: '0 2px 2px 0' }} />
        )}
        <button
          className="flex-shrink-0 flex items-center justify-center w-4 h-4"
          style={{ color: 'var(--text-faint)', visibility: showToggle ? 'visible' : 'hidden' }}
          onClick={handleToggle}
        >
          {node.isLoading
            ? <span className="w-2.5 h-2.5 rounded-full animate-spin block" style={{ border: '1.5px solid var(--text-faint)', borderTopColor: 'transparent' }} />
            : node.isOpen
            ? <PiCaretDown size={10} />
            : <PiCaretRight size={10} />
          }
        </button>
        <FileIcon extension="" isDirectory isOpen={node.isOpen} size={14} />
        <span className="truncate flex-1">
          {node.name}
        </span>
      </div>

      {node.isOpen && node.children.map((child) => (
        <TreeNodeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          currentPath={currentPath}
          dragOver={dragOver}
          onNavigate={onNavigate}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onUpdate={(updated) => onUpdate({
            ...node,
            children: node.children.map((c) => c.path === updated.path ? updated : c),
          })}
        />
      ))}
    </div>
  );
}
