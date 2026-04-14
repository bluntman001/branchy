import { useState, useEffect } from 'react';

// Global module-level cache and in-flight deduplication
const iconCache = new Map<string, string>();
const inFlight  = new Map<string, Promise<string>>();

function fetchIcon(lookupPath: string, key: string): Promise<string> {
  if (inFlight.has(key)) return inFlight.get(key)!;
  const p = window.fileAPI
    .getShellIcon(lookupPath)
    .then((url) => { iconCache.set(key, url); return url; })
    .catch(() => { iconCache.set(key, ''); return ''; })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * Returns a shell icon data-URL for a file / directory.
 *  - Files  → cached by extension (e.g. ".pdf")
 *  - Dirs   → cached by path (special folders have unique icons)
 * Returns '' while loading or when unavailable (use SVG fallback).
 */
export function useShellIcon(
  filePath: string,
  extension: string,
  isDirectory: boolean,
): string {
  // Cache key
  const key = isDirectory ? `dir:${filePath}` : (extension || 'file:noext');
  // Path passed to getFileIcon — extensions use a dummy path so Windows gives the
  // registered icon rather than a "file not found" generic one.
  const lookupPath = isDirectory ? filePath : `C:\\dummy${extension}`;

  const [url, setUrl] = useState<string>(() => iconCache.get(key) ?? '');

  useEffect(() => {
    if (iconCache.has(key)) {
      setUrl(iconCache.get(key)!);
      return;
    }
    let alive = true;
    fetchIcon(lookupPath, key).then((result) => {
      if (alive) setUrl(result);
    });
    return () => { alive = false; };
  }, [key, lookupPath]);

  return url;
}
