import { useState, useCallback, useEffect } from 'react';
import { FileEntry } from '../../types';
import { parentPath } from '../utils/path';
import { fileAPI } from '../../api';
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
      const result = await fileAPI.listDirectory(dirPath);
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
    const parent = parentPath(currentPath);
    if (parent !== currentPath) {
      navigate(parent);
    }
  }, [currentPath, navigate]);

  useEffect(() => {
    fileAPI.nav.trackAccess(currentPath).catch(() => {});
  }, [currentPath]);

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
