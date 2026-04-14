import { useState, useCallback } from 'react';
import { FileEntry } from '../../types';

export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const select = useCallback((filePath: string, mode: 'single' | 'toggle' | 'range', all?: FileEntry[]) => {
    setSelected((prev) => {
      if (mode === 'single') {
        return new Set([filePath]);
      }
      if (mode === 'toggle') {
        const next = new Set(prev);
        if (next.has(filePath)) {
          next.delete(filePath);
        } else {
          next.add(filePath);
        }
        return next;
      }
      if (mode === 'range' && all) {
        const lastSelected = [...prev].pop();
        if (!lastSelected) return new Set([filePath]);
        const paths = all.map((e) => e.path);
        const fromIdx = paths.indexOf(lastSelected);
        const toIdx = paths.indexOf(filePath);
        if (fromIdx === -1 || toIdx === -1) return new Set([filePath]);
        const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        return new Set(paths.slice(start, end + 1));
      }
      return prev;
    });
  }, []);

  const selectAll = useCallback((entries: FileEntry[]) => {
    setSelected(new Set(entries.map((e) => e.path)));
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isSelected = useCallback((filePath: string) => selected.has(filePath), [selected]);

  return { selected, select, selectAll, clearSelection, isSelected };
}
