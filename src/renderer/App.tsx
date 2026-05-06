import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Toaster } from 'react-hot-toast';
import toast from 'react-hot-toast';
import { FiSettings, FiMinus, FiSquare, FiX, FiMessageSquare } from 'react-icons/fi';
import branchyIcon from '../assets/branchy.png';

import { FolderTree } from './components/FolderTree';
import { FileBrowser } from './components/FileBrowser';
import { ChatPanel } from './components/ChatPanel';
import { Breadcrumbs } from './components/Breadcrumbs';
import { SettingsModal } from './components/SettingsModal';
import { useDirectory } from './hooks/useDirectory';
import { useSelection } from './hooks/useSelection';
import { useCopyOps } from './hooks/useCopyOps';
import { CopyProgress } from './components/CopyProgress';
import { formatSize, totalSize } from './utils/formatSize';
import { AppSettings } from '../types';
import { fileAPI } from '../api';

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  startDir: '',
  confirmDelete: true,
  showHidden: false,
};

const LEFT_MIN  = 200;
const LEFT_MAX  = 420;
const RIGHT_MIN = 260;
const RIGHT_MAX = 540;

interface Bootstrap {
  initialDir: string;
  chatOpenInitial: boolean;
  settings: AppSettings;
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const all      = await fileAPI.settings.getAll();
        const homeDir  = await fileAPI.settings.getHomeDir();
        const cliPath  = await fileAPI.settings.getInitialPath();
        const lastDir  = (await fileAPI.settings.get('lastDir')) as string | undefined;
        const chatOpen = (await fileAPI.settings.get('chatPanelOpen')) as boolean | undefined;

        const startDir = cliPath || all.startDir || homeDir;
        let resolvedDir = startDir;
        // CLI path always wins. Otherwise prefer last-visited folder if it still exists.
        if (!cliPath && lastDir && lastDir !== startDir) {
          try {
            const stat = await fileAPI.getStats(lastDir);
            if (stat?.isDirectory) resolvedDir = lastDir;
          } catch { /* fall through to startDir */ }
        }

        setBoot({
          initialDir: resolvedDir,
          chatOpenInitial: chatOpen ?? true,
          settings: { ...DEFAULT_SETTINGS, ...all, startDir: all.startDir || homeDir },
        });
      } catch (err) {
        console.error('Failed to load settings', err);
        const homeDir = await fileAPI.settings.getHomeDir().catch(() => 'C:\\');
        setBoot({
          initialDir: homeDir,
          chatOpenInitial: true,
          settings: { ...DEFAULT_SETTINGS, startDir: homeDir },
        });
      }
    })();
  }, []);

  if (!boot) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ background: 'var(--app-bg)' }}>
        <span className="w-6 h-6 rounded-full animate-spin" style={{ border: '2px solid var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  return <AppShell {...boot} />;
}

function AppShell({ initialDir, chatOpenInitial, settings: initialSettings }: Bootstrap) {
  const [settings, setSettings]         = useState<AppSettings>(initialSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen]         = useState(chatOpenInitial);

  const [leftWidth, setLeftWidth]   = useState(240);
  const [rightWidth, setRightWidth] = useState(340);
  const leftDrag  = useRef<{ startX: number; startW: number } | null>(null);
  const rightDrag = useRef<{ startX: number; startW: number } | null>(null);

  const dir = useDirectory(initialDir);
  const { selected, select, selectAll, clearSelection, isSelected } = useSelection();

  // Async copy progress — startCopy returns immediately, the UI shows
  // a progress card until done. If the copy lands in the user's current
  // folder, refresh on completion so the new files show up.
  const { ops: copyOps, startCopy, startMove } = useCopyOps((finished) => {
    if (!finished.error && finished.destDir === dir.currentPath) dir.refresh();
  });

  // Initial load — useDirectory no longer auto-loads.
  useEffect(() => {
    dir.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist last-visited folder.
  useEffect(() => {
    fileAPI.settings.set('lastDir', dir.currentPath).catch(() => {});
  }, [dir.currentPath]);

  // Persist chat panel state.
  useEffect(() => {
    fileAPI.settings.set('chatPanelOpen', chatOpen).catch(() => {});
  }, [chatOpen]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (leftDrag.current) {
        const dx = e.clientX - leftDrag.current.startX;
        setLeftWidth(Math.max(LEFT_MIN, Math.min(LEFT_MAX, leftDrag.current.startW + dx)));
      }
      if (rightDrag.current) {
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

  useEffect(() => {
    (async () => {
      const shown = await fileAPI.settings.get('settingsIntroShown');
      if (!shown) {
        setSettingsOpen(true);
        await fileAPI.settings.set('settingsIntroShown', true);
      }
    })();
  }, []);

  const handleSaveSettings = useCallback(async (updates: Partial<AppSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    await Promise.all([
      fileAPI.settings.set('apiKey',         newSettings.apiKey),
      fileAPI.settings.set('startDir',       newSettings.startDir),
      fileAPI.settings.set('confirmDelete',  newSettings.confirmDelete),
      fileAPI.settings.set('showHidden',     newSettings.showHidden),
    ]);
    toast.success('Settings saved');
  }, [settings]);

  const handleDrop = useCallback(async (sourcePaths: string[], destDir: string) => {
    try {
      await fileAPI.moveFiles(sourcePaths, destDir);
      clearSelection();
      dir.refresh();
      toast.success(`Moved ${sourcePaths.length} item(s)`);
    } catch (err) {
      toast.error(`Move failed: ${(err as Error).message}`);
    }
  }, [clearSelection, dir]);

  const selectedEntries = dir.entries.filter((e) => isSelected(e.path));
  const selectionSize   = totalSize(selectedEntries);

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{
        background: 'var(--app-bg)',
        border: '1px solid var(--border-subtle)',
        boxSizing: 'border-box',
      }}
    >
      <div
        data-tauri-drag-region
        className="fp-glass flex items-center gap-3 flex-shrink-0"
        onDoubleClick={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest('button, a, input, select, textarea')) return;
          fileAPI.window.toggleMaximize().catch(() => { /* noop */ });
        }}
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          height: 48,
          paddingLeft: 18,
          paddingRight: 12,
          position: 'relative',
          zIndex: 20,
          userSelect: 'none',
          WebkitUserDrag: 'none',
        } as React.CSSProperties}
      >
        <div data-tauri-drag-region className="flex items-center gap-2.5 flex-shrink-0">
          <img
            src={branchyIcon}
            width={22}
            height={22}
            draggable={false}
            style={{ objectFit: 'contain', flexShrink: 0 }}
          />
          <span
            data-tauri-drag-region
            style={{
              color: 'var(--text)',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '-0.015em',
            }}
          >
            Branchy
          </span>
        </div>

        <div data-tauri-drag-region style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />

        <Breadcrumbs currentPath={dir.currentPath} onNavigate={dir.navigate} />

        {/* Spacer absorbs all remaining width — pure drag region. */}
        <div
          data-tauri-drag-region
          className="flex-1 self-stretch min-w-0"
          style={{ userSelect: 'none', WebkitUserDrag: 'none' } as React.CSSProperties}
        />

        <div data-tauri-drag-region className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setChatOpen((v) => !v)}
            className={`fp-winctrl ${chatOpen ? 'fp-winctrl-active' : ''}`}
            title="Toggle AI Chat"
          >
            <FiMessageSquare size={15} />
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="fp-winctrl"
            title="Settings"
          >
            <FiSettings size={15} />
          </button>
          <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 4px' }} />
          <button
            onClick={() => fileAPI.window.minimize()}
            className="fp-winctrl"
            title="Minimize"
          >
            <FiMinus size={14} />
          </button>
          <button
            onClick={() => fileAPI.window.maximize()}
            className="fp-winctrl"
            title="Maximize"
          >
            <FiSquare size={12} />
          </button>
          <button
            onClick={() => fileAPI.window.close()}
            className="fp-winctrl fp-winctrl-close"
            title="Close"
          >
            <FiX size={15} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden" style={{ padding: '8px 8px 0' }}>
        <div
          className="fp-panel flex-shrink-0 overflow-hidden"
          style={{ width: leftWidth, minWidth: LEFT_MIN }}
        >
          <FolderTree
            currentPath={dir.currentPath}
            onNavigate={(p) => { dir.navigate(p); clearSelection(); }}
            onDrop={handleDrop}
          />
        </div>

        <div
          className="fp-divider"
          style={{ marginLeft: 6, marginRight: 6 }}
          onMouseDown={(e) => {
            leftDrag.current = { startX: e.clientX, startW: leftWidth };
            document.body.style.cursor     = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />

        <div className="fp-panel flex-1 overflow-hidden min-w-0">
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
            onCopyAsync={startCopy}
            onMoveAsync={startMove}
          />
        </div>

        {chatOpen && (
          <div
            className="fp-divider"
            style={{ marginLeft: 6, marginRight: 6 }}
            onMouseDown={(e) => {
              rightDrag.current = { startX: e.clientX, startW: rightWidth };
              document.body.style.cursor     = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
        )}

        {chatOpen && (
          <div
            className="fp-panel flex-shrink-0 overflow-hidden"
            style={{ width: rightWidth, minWidth: RIGHT_MIN }}
          >
            <ChatPanel
              currentPath={dir.currentPath}
              settings={settings}
              onRefresh={dir.refresh}
              onOpenSettings={() => setSettingsOpen(true)}
              onClose={() => setChatOpen(false)}
            />
          </div>
        )}
      </div>

      <div
        className="fp-glass flex items-center gap-3 flex-shrink-0"
        style={{
          borderTop: '1px solid var(--border-subtle)',
          height: 30,
          fontSize: 11,
          color: 'var(--text-faint)',
          padding: '0 14px',
          marginTop: 8,
        }}
      >
        <span style={{ fontFamily: 'Geist Mono, monospace', letterSpacing: '0.01em' }}>
          {dir.entries.length} <span style={{ color: 'var(--text-ghost)' }}>items</span>
        </span>
        {selected.size > 0 && (
          <>
            <div style={{ width: 1, height: 12, background: 'var(--border)' }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--accent-text)' }}>
              <span className="fp-dot" />
              <span style={{ fontFamily: 'Geist Mono, monospace' }}>
                {selected.size} selected
              </span>
            </span>
            {selectionSize > 0 && (
              <span style={{ fontFamily: 'Geist Mono, monospace', color: 'var(--text-dim)' }}>{formatSize(selectionSize)}</span>
            )}
          </>
        )}
        <div className="flex-1" />
        <span
          style={{
            fontFamily: 'Geist Mono, monospace',
            fontSize: 10.5,
            color: 'var(--text-ghost)',
            letterSpacing: '0.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: '40%',
          }}
        >
          {dir.currentPath}
        </span>
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      )}

      <CopyProgress ops={copyOps} />

      <Toaster
        position="bottom-center"
        toastOptions={{
          style: {
            background: 'rgba(24, 20, 30, 0.92)',
            backdropFilter: 'blur(16px) saturate(160%)',
            WebkitBackdropFilter: 'blur(16px) saturate(160%)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            fontSize: 12.5,
            fontFamily: 'Geist, sans-serif',
            boxShadow: '0 20px 60px -20px rgba(0,0,0,0.7)',
            padding: '10px 14px',
            letterSpacing: '-0.005em',
          },
          duration: 3000,
          success: {
            iconTheme: { primary: '#7c6df2', secondary: '#fff' },
          },
          error: {
            iconTheme: { primary: '#f06e7e', secondary: '#fff' },
          },
        }}
      />
    </div>
  );
}
