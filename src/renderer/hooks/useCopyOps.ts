import { useEffect, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { fileAPI } from '../../api';

export interface CopyOp {
  opId: string;
  destDir: string;
  currentFile: string;
  bytesDone: number;
  bytesTotal: number;
  startedAt: number;       // ms — for ETA + speed calculation
  done: boolean;
  error?: string;
}

interface CopyProgressPayload {
  opId: string;
  currentFile: string;
  bytesDone: number;
  bytesTotal: number;
  done: boolean;
  error?: string | null;
}

/**
 * Tracks every active background copy. Subscribes to the `copy-progress`
 * Tauri event and exposes a per-op snapshot the UI can render. Completed
 * ops linger for `LINGER_MS` so the user sees a "done" tick before they
 * clear automatically.
 */
const LINGER_MS = 1500;

export function useCopyOps(onComplete?: (op: CopyOp) => void) {
  const [ops, setOps] = useState<Record<string, CopyOp>>({});

  useEffect(() => {
    let alive = true;
    const unlistenPromise = listen<CopyProgressPayload>('copy-progress', (event) => {
      if (!alive) return;
      const p = event.payload;
      setOps((prev) => {
        const existing = prev[p.opId];
        const next: CopyOp = {
          opId: p.opId,
          destDir: existing?.destDir ?? '',
          currentFile: p.currentFile,
          bytesDone: p.bytesDone,
          bytesTotal: p.bytesTotal,
          startedAt: existing?.startedAt ?? Date.now(),
          done: p.done,
          error: p.error ?? undefined,
        };
        return { ...prev, [p.opId]: next };
      });
      if (p.done) {
        // Read latest snapshot (after the setOps above) so destDir + startedAt
        // come from the existing op state, not a fresh placeholder.
        setOps((current) => {
          const finalOp = current[p.opId];
          if (finalOp) onComplete?.(finalOp);
          return current;
        });
        // Linger so the user sees the completion before it disappears.
        setTimeout(() => {
          if (!alive) return;
          setOps((prev) => {
            const { [p.opId]: _gone, ...rest } = prev;
            return rest;
          });
        }, LINGER_MS);
      }
    });
    return () => {
      alive = false;
      unlistenPromise.then((u) => u()).catch(() => {});
    };
  }, [onComplete]);

  const startCopy = useCallback(async (sourcePaths: string[], destDir: string): Promise<string> => {
    const opId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    setOps((prev) => ({
      ...prev,
      [opId]: {
        opId,
        destDir,
        currentFile: '',
        bytesDone: 0,
        bytesTotal: 0,
        startedAt: Date.now(),
        done: false,
      },
    }));
    await fileAPI.copyFilesAsync(opId, sourcePaths, destDir);
    return opId;
  }, []);

  return { ops: Object.values(ops), startCopy };
}
