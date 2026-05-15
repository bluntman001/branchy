import { useRef, useCallback } from 'react';
import toast from 'react-hot-toast';
import { fileAPI } from '../../api';
import { basename, dirname, joinPath } from '../utils/path';

export type UndoOp =
  | { kind: 'rename'; oldPath: string; newPath: string }
  | { kind: 'move'; sourcePaths: string[]; destDir: string }
  | { kind: 'copy'; destDir: string; names: string[] }
  | { kind: 'createFolder'; path: string }
  | { kind: 'createFile'; path: string };

const MAX_STACK = 20;

/**
 * Tracks recent reversible file operations and pops/reverses the latest
 * one on Ctrl+Z. Mutating actions in FileBrowser push their inverse
 * description here when they succeed; undo replays that.
 *
 * Deletes are intentionally not tracked — restoring from the Recycle Bin
 * needs IFileOperation::Undelete which is non-trivial and platform-
 * specific, and our network-drive path uses permanent delete anyway.
 */
export function useUndoStack(onRefresh: () => void) {
  const stack = useRef<UndoOp[]>([]);

  const push = useCallback((op: UndoOp) => {
    stack.current.push(op);
    if (stack.current.length > MAX_STACK) stack.current.shift();
  }, []);

  const undo = useCallback(async () => {
    const op = stack.current.pop();
    if (!op) {
      toast('Nothing to undo', { icon: '↩️' });
      return;
    }
    try {
      switch (op.kind) {
        case 'rename':
          await fileAPI.renameFile(op.newPath, op.oldPath);
          toast.success(`Undone: rename ${basename(op.newPath)} → ${basename(op.oldPath)}`);
          break;
        case 'move': {
          // Group dest paths by their original source dir, then move each
          // group back. Handles cases where the original selection spanned
          // multiple folders.
          const groups = new Map<string, string[]>();
          for (const src of op.sourcePaths) {
            const originalDir = dirname(src);
            const name = basename(src);
            const destPath = joinPath(op.destDir, name);
            const list = groups.get(originalDir) ?? [];
            list.push(destPath);
            groups.set(originalDir, list);
          }
          for (const [origDir, paths] of groups) {
            await fileAPI.moveFiles(paths, origDir);
          }
          toast.success(`Undone: moved ${op.sourcePaths.length} item(s) back`);
          break;
        }
        case 'copy':
          await fileAPI.permanentDeleteFiles(op.names.map((n) => joinPath(op.destDir, n)));
          toast.success(`Undone: removed ${op.names.length} copy(ies)`);
          break;
        case 'createFolder':
        case 'createFile':
          await fileAPI.permanentDeleteFiles([op.path]);
          toast.success(`Undone: created ${basename(op.path)}`);
          break;
      }
      onRefresh();
    } catch (err) {
      // If the undo fails we put the op back so the user can retry.
      stack.current.push(op);
      toast.error(`Undo failed: ${(err as Error).message}`);
    }
  }, [onRefresh]);

  const clear = useCallback(() => { stack.current = []; }, []);

  return { push, undo, clear };
}
