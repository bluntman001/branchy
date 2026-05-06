import { useEffect, useState, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { fileAPI } from '../../api';

export type TransferKind = 'copy' | 'move';

export interface CopyOp {
  opId: string;
  kind: TransferKind;
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
  kind: TransferKind;
  currentFile: string;
  bytesDone: number;
  bytesTotal: number;
  done: boolean;
  error?: string | null;
}

/**
 * Tracks every active background transfer (copy or move). Subscribes to
 * the `copy-progress` Tauri event and exposes a per-op snapshot the UI
 * can render. Completed ops linger for `LINGER_MS` so the user sees a
 * "done" tick before they clear automatically.
 */
const LINGER_MS = 1500;

export function useCopyOps(onComplete?: (op: CopyOp) => void) {
  const [ops, setOps] = useState<Record<string, CopyOp>>({});
  // Hold the latest `onComplete` in a ref so the listener effect mounts
  // only once. Including `onComplete` in the dep array tore down the
  // effect on every render, leaving any pending dismiss-timeout bound to
  // a stale `alive=false` closure and so the card stayed forever.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    let alive = true;
    const unlistenPromise = listen<CopyProgressPayload>('copy-progress', (event) => {
      if (!alive) return;
      const p = event.payload;
      setOps((prev) => {
        const existing = prev[p.opId];
        const next: CopyOp = {
          opId: p.opId,
          kind: p.kind ?? existing?.kind ?? 'copy',
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
        setOps((current) => {
          const finalOp = current[p.opId];
          if (finalOp) onCompleteRef.current?.(finalOp);
          return current;
        });
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
  }, []);

  const start = useCallback(
    async (kind: TransferKind, sourcePaths: string[], destDir: string): Promise<string> => {
      const opId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
      setOps((prev) => ({
        ...prev,
        [opId]: {
          opId,
          kind,
          destDir,
          currentFile: '',
          bytesDone: 0,
          bytesTotal: 0,
          startedAt: Date.now(),
          done: false,
        },
      }));
      if (kind === 'move') await fileAPI.moveFilesAsync(opId, sourcePaths, destDir);
      else                 await fileAPI.copyFilesAsync(opId, sourcePaths, destDir);
      return opId;
    },
    [],
  );

  const startCopy = useCallback(
    (sourcePaths: string[], destDir: string) => start('copy', sourcePaths, destDir),
    [start],
  );
  const startMove = useCallback(
    (sourcePaths: string[], destDir: string) => start('move', sourcePaths, destDir),
    [start],
  );

  const dismiss = useCallback((opId: string) => {
    setOps((prev) => {
      const { [opId]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);

  return { ops: Object.values(ops), startCopy, startMove, dismiss };
}
