import { useState, useCallback, useEffect } from 'react';
import { FileEntry } from '../../types';
import toast from 'react-hot-toast';

export function useDirectory(initialPath: string) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<string[]>([initialPath]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const load = useCallback(async (dirPath: string) => {
    setLoading(true);
    try {
      const result = await window.fileAPI.listDirectory(dirPath);
      setEntries(result);
    } catch (err) {
      toast.error(`Cannot open folder: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const navigate = useCallback(
    (dirPath: string) => {
      setCurrentPath(dirPath);
      setHistory((h) => {
        const newHistory = [...h.slice(0, historyIndex + 1), dirPath];
        setHistoryIndex(newHistory.length - 1);
        return newHistory;
      });
      load(dirPath);
    },
    [historyIndex, load]
  );

  const refresh = useCallback(() => {
    load(currentPath);
  }, [currentPath, load]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const prevPath = history[newIndex];
      setHistoryIndex(newIndex);
      setCurrentPath(prevPath);
      load(prevPath);
    }
  }, [history, historyIndex, load]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const nextPath = history[newIndex];
      setHistoryIndex(newIndex);
      setCurrentPath(nextPath);
      load(nextPath);
    }
  }, [history, historyIndex, load]);

  const goUp = useCallback(() => {
    const parent = getParentPath(currentPath);
    if (parent !== currentPath) {
      navigate(parent);
    }
  }, [currentPath, navigate]);

  useEffect(() => {
    load(initialPath);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    currentPath,
    entries,
    loading,
    navigate,
    refresh,
    goBack,
    goForward,
    goUp,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex < history.length - 1,
  };
}

function getParentPath(p: string): string {
  const normalized = p.replace(/\\/g, '/');
  // Windows root: C:/
  if (/^[A-Za-z]:[\\/]?$/.test(p)) return p;
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return p;
  const parent = normalized.slice(0, lastSlash) || '/';
  // Keep trailing slash for drive roots on Windows
  if (/^[A-Za-z]:$/.test(parent)) return parent + '\\';
  return parent;
}
