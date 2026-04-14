import React, { useState, useEffect, useCallback } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { PiCaretRight, PiCaretDown } from 'react-icons/pi';
import { FileIcon, DriveIcon, PlaceIcon, SpecialPlace } from './FileIcon';
import { DriveInfo, MostUsedEntry } from '../../types';
import { formatSize } from '../utils/formatSize';

// ── types ─────────────────────────────────────────────
interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  isOpen: boolean;
  isLoading: boolean;
  hasChildren: boolean | null;
}

// ── helpers ───────────────────────────────────────────
function pathBasename(p: string): string {
  const norm = p.replace(/[/\\]+$/, '');
  const last = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return last >= 0 ? norm.slice(last + 1) : norm;
}

async function loadChildren(dirPath: string): Promise<TreeNode[]> {
  try {
    const entries = await window.fileAPI.listDirectory(dirPath);
    const dirs = entries.filter((e) => e.isDirectory);
    const nodes = await Promise.all(
      dirs.map(async (e): Promise<TreeNode> => {
        let hasChildren: boolean | null = null;
        try {
          hasChildren = await window.fileAPI.hasSubdirectories(e.path);
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
interface Place {
  label: string;
  place: SpecialPlace;
  getPath: (home: string) => string;
}

const PLACES: Place[] = [
  { label: 'Home',      place: 'home',      getPath: (h) => h },
  { label: 'Desktop',   place: 'desktop',   getPath: (h) => h + '\\Desktop' },
  { label: 'Downloads', place: 'downloads', getPath: (h) => h + '\\Downloads' },
  { label: 'Documents', place: 'documents', getPath: (h) => h + '\\Documents' },
  { label: 'Music',     place: 'music',     getPath: (h) => h + '\\Music' },
  { label: 'Pictures',  place: 'pictures',  getPath: (h) => h + '\\Pictures' },
];

// ── FolderTree root ───────────────────────────────────
interface FolderTreeProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onDrop: (sourcePaths: string[], destDir: string) => void;
}

export function FolderTree({ currentPath, onNavigate, onDrop }: FolderTreeProps) {
  const [homeDir, setHomeDir]       = useState('');
  const [drives, setDrives]         = useState<DriveInfo[]>([]);
  const [mostUsed, setMostUsed]     = useState<MostUsedEntry[]>([]);
  const [driveNodes, setDriveNodes] = useState<Record<string, TreeNode[]>>({});
  const [driveOpen, setDriveOpen]   = useState<Record<string, boolean>>({});
  const [driveLoading, setDriveLoading] = useState<Record<string, boolean>>({});

  const [mostUsedOpen, setMostUsedOpen] = useState(true);
  const [localOpen, setLocalOpen]       = useState(true);
  const [storageOpen, setStorageOpen]   = useState(true);

  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const [home, driveList, mu] = await Promise.all([
        window.fileAPI.settings.getHomeDir(),
        window.fileAPI.getDrives(),
        window.fileAPI.nav.getMostUsed(8),
      ]);
      setHomeDir(home);
      setDrives(driveList);
      setMostUsed(mu);
    }
    init();
  }, []);

  useEffect(() => {
    if (!currentPath) return;
    window.fileAPI.nav.getMostUsed(8).then(setMostUsed);
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
    <div className="h-full flex flex-col overflow-y-auto select-none pb-4" style={{ background: '#161616' }}>

      {/* ── Most Used ─────────────────────── */}
      {mostUsed.length > 0 && (
        <Section label="Most Used" open={mostUsedOpen} onToggle={() => setMostUsedOpen((v) => !v)}>
          {mostUsed.map((mu) => (
            <PlainRow
              key={mu.path}
              label={pathBasename(mu.path) || mu.path}
              icon={<PlaceIcon place="recent" size={14} />}
              indent={1}
              {...rowProps(mu.path)}
            />
          ))}
        </Section>
      )}

      {/* ── Local ─────────────────────────── */}
      <Section label="Local" open={localOpen} onToggle={() => setLocalOpen((v) => !v)}>
        {PLACES.map((p) => {
          const placePath = homeDir ? p.getPath(homeDir) : '';
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
    <Collapsible.Root open={open} onOpenChange={onToggle} className="mt-2">
      <Collapsible.Trigger asChild>
        <button
          className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left"
          style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em' }}
        >
          {open ? <PiCaretDown size={10} /> : <PiCaretRight size={10} />}
          {label}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="fp-section-content overflow-hidden">
        {children}
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
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}

function PlainRow({ label, icon, isActive, isDragOver, indent = 0, onClick, onDragOver, onDragLeave, onDrop }: PlainRowProps) {
  return (
    <button
      className="flex items-center gap-2 w-full text-left transition-colors rounded-md"
      style={{
        paddingLeft: 12 + indent * 12,
        paddingRight: 8,
        paddingTop: 5,
        paddingBottom: 5,
        marginLeft: 4,
        marginRight: 4,
        width: 'calc(100% - 8px)',
        background: isDragOver ? 'rgba(59,130,246,0.18)' : isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
        color: isActive ? '#93c5fd' : '#b0b0b0',
        fontSize: 12.5,
      }}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#222'; }}
      onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {icon}
      <span className="truncate" style={{ fontFamily: 'Inter, sans-serif' }}>{label}</span>
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
    <div className="mb-0.5">
      {/* Drive header row */}
      <div
        className="flex items-center gap-1.5 rounded-md cursor-pointer transition-colors"
        style={{
          marginLeft: 4,
          marginRight: 4,
          width: 'calc(100% - 8px)',
          background: isDragOver ? 'rgba(59,130,246,0.18)' : isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
          color: isActive ? '#93c5fd' : '#b0b0b0',
          fontSize: 12.5,
          padding: '4px 8px 4px 4px',
        }}
        onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#222'; }}
        onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        onDragOver={(e) => { e.preventDefault(); onDragOver(drive.path); }}
        onDragLeave={() => onDragOver(null)}
        onDrop={(e) => onDrop(e, drive.path)}
        onClick={() => onNavigate(drive.path)}
      >
        <button
          className="flex-shrink-0 flex items-center justify-center w-4 h-4 rounded"
          style={{ color: '#555' }}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          {isLoading
            ? <span className="w-2.5 h-2.5 border border-gray-500 border-t-transparent rounded-full animate-spin block" />
            : isOpen
            ? <PiCaretDown size={11} />
            : <PiCaretRight size={11} />
          }
        </button>
        <DriveIcon driveType={drive.type} size={15} />
        <span className="truncate flex-1" style={{ fontFamily: 'Inter, sans-serif' }}>
          {drive.label || drive.letter}
        </span>
        <span style={{ fontSize: 10, color: '#444', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
          {drive.letter}
        </span>
      </div>

      {/* Storage bar — shown when size info is available */}
      {usedPct !== null && drive.size && drive.free !== undefined && (
        <div style={{ marginLeft: 20, marginRight: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#444', marginBottom: 3 }}>
            <span>{formatSize(drive.free)} free</span>
            <span>{formatSize(drive.size)} total</span>
          </div>
          <div style={{ height: 3, background: '#2a2a2a', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${usedPct}%`,
                background: usedPct > 90 ? '#ef4444' : usedPct > 70 ? '#f59e0b' : '#3b82f6',
                borderRadius: 2,
                transition: 'width 400ms ease',
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
        className="flex items-center gap-1.5 rounded-md cursor-pointer transition-colors"
        style={{
          marginLeft: 4 + depth * 14,
          marginRight: 4,
          background: isDragOver ? 'rgba(59,130,246,0.18)' : isActive ? 'rgba(59,130,246,0.12)' : 'transparent',
          color: isActive ? '#93c5fd' : '#b0b0b0',
          fontSize: 12.5,
          padding: '4px 6px 4px 4px',
        }}
        onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#222'; }}
        onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        onDragOver={(e) => { e.preventDefault(); onDragOver(node.path); }}
        onDragLeave={() => onDragOver(null)}
        onDrop={(e) => onDrop(e, node.path)}
        onClick={() => onNavigate(node.path)}
      >
        <button
          className="flex-shrink-0 flex items-center justify-center w-4 h-4"
          style={{ color: '#555', visibility: showToggle ? 'visible' : 'hidden' }}
          onClick={handleToggle}
        >
          {node.isLoading
            ? <span className="w-2.5 h-2.5 border border-gray-500 border-t-transparent rounded-full animate-spin block" />
            : node.isOpen
            ? <PiCaretDown size={11} />
            : <PiCaretRight size={11} />
          }
        </button>
        <FileIcon extension="" isDirectory isOpen={node.isOpen} size={14} />
        <span className="truncate flex-1" style={{ fontFamily: 'Inter, sans-serif' }}>
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
