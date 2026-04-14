import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { FiSettings, FiMinus, FiSquare, FiX } from 'react-icons/fi';
import branchyIcon from '../assets/branchy.png';

import { FolderTree } from './components/FolderTree';
import { FileBrowser } from './components/FileBrowser';
import { ChatPanel } from './components/ChatPanel';
import { Breadcrumbs } from './components/Breadcrumbs';
import { SettingsModal } from './components/SettingsModal';
import { useDirectory } from './hooks/useDirectory';
import { useSelection } from './hooks/useSelection';
import { formatSize, totalSize } from './utils/formatSize';
import { AppSettings } from '../types';

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  startDir: '',
  confirmDelete: true,
  showHidden: false,
};

// Panel width constraints
const LEFT_MIN  = 160;
const LEFT_MAX  = 380;
const RIGHT_MIN = 220;
const RIGHT_MAX = 500;

export function App() {
  const [settings, setSettings]     = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initializing, setInitializing] = useState(true);

  // Resizable panels
  const [leftWidth, setLeftWidth]   = useState(220);
  const [rightWidth, setRightWidth] = useState(320);
  const leftDrag  = useRef<{ startX: number; startW: number } | null>(null);
  const rightDrag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (leftDrag.current) {
        const dx = e.clientX - leftDrag.current.startX;
        setLeftWidth(Math.max(LEFT_MIN, Math.min(LEFT_MAX, leftDrag.current.startW + dx)));
      }
      if (rightDrag.current) {
        // dragging left ↔ right panel divider: moving left increases right panel
        const dx = rightDrag.current.startX - e.clientX;
        setRightWidth(Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, rightDrag.current.startW + dx)));
      }
    }
    function onMouseUp() {
      leftDrag.current  = null;
      rightDrag.current = null;
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, []);

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const all     = await window.fileAPI.settings.getAll();
        const homeDir = await window.fileAPI.settings.getHomeDir();
        const startDir = all.startDir || homeDir;
        setSettings({ ...DEFAULT_SETTINGS, ...all, startDir });
        setInitialDir(startDir);
      } catch (err) {
        console.error('Failed to load settings', err);
      } finally {
        setInitializing(false);
      }
    }
    loadSettings();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [initialDir, setInitialDir] = useState('');

  const dir = useDirectory(initialDir || 'C:\\');
  const { selected, select, selectAll, clearSelection, isSelected } = useSelection();

  // If no API key, open settings after init
  useEffect(() => {
    if (!initializing && !settings.apiKey) {
      setSettingsOpen(true);
    }
  }, [initializing, settings.apiKey]);

  const handleSaveSettings = useCallback(async (updates: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await Promise.all([
      window.fileAPI.settings.set('apiKey',         newSettings.apiKey),
      window.fileAPI.settings.set('startDir',       newSettings.startDir),
      window.fileAPI.settings.set('confirmDelete',  newSettings.confirmDelete),
      window.fileAPI.settings.set('showHidden',     newSettings.showHidden),
    ]);
    toast.success('Settings saved');
  }, [settings]);

  const handleDrop = useCallback(async (sourcePaths: string[], destDir: string) => {
    try {
      await window.fileAPI.moveFiles(sourcePaths, destDir);
      clearSelection();
      dir.refresh();
      toast.success(`Moved ${sourcePaths.length} item(s)`);
    } catch (err) {
      toast.error(`Move failed: ${(err as Error).message}`);
    }
  }, [clearSelection, dir]);

  const selectedEntries = dir.entries.filter((e) => isSelected(e.path));
  const selectionSize   = totalSize(selectedEntries);

  if (initializing) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: '#0f0f0f' }}>
        <span className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0f0f0f' }}>
      {/* Title bar / Header */}
      <div
        className="flex items-center gap-2 px-4 border-b flex-shrink-0"
        style={{
          borderColor: '#2a2a2a',
          background: '#161616',
          height: 42,
          WebkitAppRegion: 'drag' as never,
        } as React.CSSProperties}
      >
        {/* App icon + name */}
        <div
          className="flex items-center gap-2 mr-2 flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' as never } as React.CSSProperties}
        >
          <img src={branchyIcon} width={20} height={20} draggable={false} style={{ objectFit: 'contain', borderRadius: 4 }} />
          <span className="text-xs font-semibold tracking-wide" style={{ color: '#e5e5e5' }}>
            Branchy
          </span>
        </div>

        {/* Breadcrumbs */}
        <div
          className="flex-1 overflow-hidden"
          style={{ WebkitAppRegion: 'no-drag' as never } as React.CSSProperties}
        >
          <Breadcrumbs currentPath={dir.currentPath} onNavigate={dir.navigate} />
        </div>

        {/* Window controls */}
        <div
          className="flex items-center gap-1 ml-2"
          style={{ WebkitAppRegion: 'no-drag' as never } as React.CSSProperties}
        >
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            style={{ color: '#666' }}
            title="Settings"
          >
            <FiSettings size={14} />
          </button>
          <button
            onClick={() => window.fileAPI.window.minimize()}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            style={{ color: '#666' }}
          >
            <FiMinus size={14} />
          </button>
          <button
            onClick={() => window.fileAPI.window.maximize()}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            style={{ color: '#666' }}
          >
            <FiSquare size={12} />
          </button>
          <button
            onClick={() => window.fileAPI.window.close()}
            className="p-1.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-colors"
            style={{ color: '#666' }}
          >
            <FiX size={14} />
          </button>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden" style={{ padding: '6px 6px 0 6px', gap: 0 }}>
        {/* Left panel — Folder tree */}
        <div
          className="flex-shrink-0 overflow-hidden rounded-lg"
          style={{ width: leftWidth, minWidth: LEFT_MIN, border: '1px solid #2a2a2a', background: '#161616' }}
        >
          <FolderTree
            currentPath={dir.currentPath}
            onNavigate={(p) => { dir.navigate(p); clearSelection(); }}
            onDrop={handleDrop}
          />
        </div>

        {/* Divider — left / center */}
        <div
          className="fp-divider"
          style={{ background: 'transparent' }}
          onMouseDown={(e) => {
            leftDrag.current = { startX: e.clientX, startW: leftWidth };
            document.body.style.cursor     = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />

        {/* Center panel — File browser */}
        <div className="flex-1 overflow-hidden min-w-0 rounded-lg mx-1.5" style={{ border: '1px solid #2a2a2a' }}>
          <FileBrowser
            entries={dir.entries}
            loading={dir.loading}
            currentPath={dir.currentPath}
            selected={selected}
            canGoBack={dir.canGoBack}
            canGoForward={dir.canGoForward}
            onNavigate={(p) => { dir.navigate(p); clearSelection(); }}
            onSelect={(path, mode) => select(path, mode, dir.entries)}
            onSelectAll={() => selectAll(dir.entries)}
            onClearSelection={clearSelection}
            onGoBack={dir.goBack}
            onGoForward={dir.goForward}
            onGoUp={dir.goUp}
            onRefresh={dir.refresh}
            onDrop={handleDrop}
          />
        </div>

        {/* Divider — center / right */}
        <div
          className="fp-divider"
          style={{ background: 'transparent' }}
          onMouseDown={(e) => {
            rightDrag.current = { startX: e.clientX, startW: rightWidth };
            document.body.style.cursor     = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />

        {/* Right panel — AI chat */}
        <div
          className="flex-shrink-0 overflow-hidden rounded-lg"
          style={{ width: rightWidth, minWidth: RIGHT_MIN, border: '1px solid #2a2a2a', background: '#161616' }}
        >
          <ChatPanel
            currentPath={dir.currentPath}
            settings={settings}
            onRefresh={dir.refresh}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </div>
      </div>

      {/* Status bar */}
      <div
        className="flex items-center gap-4 px-4 flex-shrink-0"
        style={{
          background: 'transparent',
          height: 28,
          fontSize: 11,
          color: '#555',
          paddingBottom: 4,
        }}
      >
        <span>{dir.entries.length} items</span>
        {selected.size > 0 && (
          <>
            <span style={{ color: '#3b82f6' }}>
              {selected.size} selected
            </span>
            {selectionSize > 0 && (
              <span>{formatSize(selectionSize)}</span>
            )}
          </>
        )}
        <div className="flex-1" />
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            color: '#3a3a3a',
          }}
        >
          {dir.currentPath}
        </span>
      </div>

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}

      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: '#252525',
            color: '#e5e5e5',
            border: '1px solid #2a2a2a',
            fontSize: 12,
            fontFamily: 'Inter, sans-serif',
          },
          duration: 3000,
        }}
      />
    </div>
  );
}
