/**
 * Radix-powered context menus for FileBrowser.
 * Two variants:
 *  - FileContextMenu  — right-click on a file/folder row
 *  - SpaceContextMenu — right-click on empty space in the file pane
 */
import React, { useState, useEffect } from 'react';
import * as CM from '@radix-ui/react-context-menu';
import {
  PiFolderOpen,
  PiCopy,
  PiScissors,
  PiClipboard,
  PiPencilSimple,
  PiTrash,
  PiInfo,
  PiFolderPlus,
  PiFilePlus,
  PiArrowsDownUp,
  PiArrowClockwise,
  PiArrowSquareOut,
  PiCaretRight,
} from 'react-icons/pi';
import { OpenWithApp } from '../../types';

// ── shared item components ────────────────────────────
function Item({
  icon,
  label,
  shortcut,
  danger = false,
  disabled = false,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <CM.Item
      className={`fp-ctx-item ${danger ? 'danger' : ''}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icon}
      {label}
      {shortcut && <span className="shortcut">{shortcut}</span>}
    </CM.Item>
  );
}

function Sep() {
  return <CM.Separator className="fp-ctx-separator" />;
}

function Label({ text }: { text: string }) {
  return <CM.Label className="fp-ctx-label">{text}</CM.Label>;
}

// ── File / folder context menu ────────────────────────
export interface FileContextMenuProps {
  children: React.ReactNode;          // the trigger element
  selectedCount: number;
  isDirectory: boolean;
  filePath: string;
  extension: string;
  canPaste: boolean;
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

export function FileContextMenu({
  children,
  selectedCount,
  isDirectory,
  filePath,
  extension,
  canPaste,
  onOpen,
  onCut,
  onCopy,
  onPaste,
  onRename,
  onDelete,
  onCopyPath,
  onProperties,
  onNewFolder,
  onOpenWith,
}: FileContextMenuProps) {
  const multi = selectedCount > 1;
  const [openWithApps, setOpenWithApps] = useState<OpenWithApp[]>([]);

  // Load Open With candidates whenever we have a non-directory file with an extension
  useEffect(() => {
    if (!isDirectory && extension) {
      window.fileAPI.getOpenWithApps(extension)
        .then(setOpenWithApps)
        .catch(() => setOpenWithApps([]));
    } else {
      setOpenWithApps([]);
    }
  }, [isDirectory, extension]);

  const showOpenWith = !multi && !isDirectory;

  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className="fp-ctx-content" onContextMenu={(e) => e.preventDefault()}>
          {/* Open */}
          {!multi && (
            <Item
              icon={<PiFolderOpen size={14} />}
              label={isDirectory ? 'Open' : 'Open'}
              onSelect={onOpen}
            />
          )}

          {/* Open With submenu */}
          {showOpenWith && (
            <CM.Sub>
              <CM.SubTrigger className="fp-ctx-item fp-ctx-sub-trigger">
                <PiArrowSquareOut size={14} />
                Open With
                <PiCaretRight size={10} style={{ marginLeft: 'auto' }} />
              </CM.SubTrigger>
              <CM.Portal>
                <CM.SubContent className="fp-ctx-sub-content">
                  {openWithApps.map((app) => (
                    <Item
                      key={app.exePath}
                      icon={<PiArrowSquareOut size={13} />}
                      label={app.name}
                      onSelect={() => onOpenWith(app.exePath)}
                    />
                  ))}
                  {openWithApps.length > 0 && <Sep />}
                  <Item
                    icon={<PiFolderOpen size={13} />}
                    label="Choose another app…"
                    onSelect={() => window.fileAPI.showOpenWithDialog(filePath)}
                  />
                </CM.SubContent>
              </CM.Portal>
            </CM.Sub>
          )}
          <Sep />

          {/* Clipboard */}
          <Item icon={<PiScissors size={14} />}    label="Cut"           shortcut="Ctrl+X"  onSelect={onCut} />
          <Item icon={<PiCopy size={14} />}         label="Copy"          shortcut="Ctrl+C"  onSelect={onCopy} />
          <Item icon={<PiClipboard size={14} />}    label="Paste"         shortcut="Ctrl+V"  onSelect={onPaste} disabled={!canPaste} />
          <Sep />

          {/* Copy path */}
          <Item icon={<PiCopy size={14} />} label="Copy as Path" onSelect={onCopyPath} />
          <Sep />

          {/* Edit */}
          {!multi && (
            <Item icon={<PiPencilSimple size={14} />} label="Rename" shortcut="F2" onSelect={onRename} />
          )}
          <Item
            icon={<PiTrash size={14} />}
            label={multi ? `Delete (${selectedCount})` : 'Delete'}
            shortcut="Delete"
            danger
            onSelect={onDelete}
          />
          <Sep />

          {/* New folder (convenience) */}
          <Item icon={<PiFolderPlus size={14} />} label="New Folder" onSelect={onNewFolder} />
          <Sep />

          {/* Properties */}
          {!multi && (
            <Item icon={<PiInfo size={14} />} label="Properties" onSelect={onProperties} />
          )}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}

// ── Empty-space context menu ──────────────────────────
export interface SpaceContextMenuProps {
  children: React.ReactNode;
  canPaste: boolean;
  onNewFolder: () => void;
  onNewFile: () => void;
  onPaste: () => void;
  onRefresh: () => void;
  onSortName: () => void;
  onSortSize: () => void;
  onSortDate: () => void;
  onSortType: () => void;
  onProperties: () => void;
}

export function SpaceContextMenu({
  children,
  canPaste,
  onNewFolder,
  onNewFile,
  onPaste,
  onRefresh,
  onSortName,
  onSortSize,
  onSortDate,
  onSortType,
  onProperties,
}: SpaceContextMenuProps) {
  return (
    <CM.Root>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className="fp-ctx-content" onContextMenu={(e) => e.preventDefault()}>
          {/* New */}
          <Label text="New" />
          <Item icon={<PiFolderPlus size={14} />} label="Folder"    onSelect={onNewFolder} />
          <Item icon={<PiFilePlus size={14} />}   label="Text File" onSelect={onNewFile} />
          <Sep />

          {/* Sort By submenu */}
          <CM.Sub>
            <CM.SubTrigger className="fp-ctx-item fp-ctx-sub-trigger">
              <PiArrowsDownUp size={14} />
              Sort By
              <PiCaretRight size={10} style={{ marginLeft: 'auto' }} />
            </CM.SubTrigger>
            <CM.Portal>
              <CM.SubContent className="fp-ctx-sub-content">
                <Item icon={<></>} label="Name"          onSelect={onSortName} />
                <Item icon={<></>} label="Size"          onSelect={onSortSize} />
                <Item icon={<></>} label="Date Modified" onSelect={onSortDate} />
                <Item icon={<></>} label="Type"          onSelect={onSortType} />
              </CM.SubContent>
            </CM.Portal>
          </CM.Sub>
          <Sep />

          <Item icon={<PiArrowClockwise size={14} />} label="Refresh" shortcut="F5" onSelect={onRefresh} />
          <Sep />

          <Item icon={<PiClipboard size={14} />} label="Paste" shortcut="Ctrl+V" disabled={!canPaste} onSelect={onPaste} />
          <Sep />

          <Item icon={<PiInfo size={14} />} label="Properties" onSelect={onProperties} />
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
