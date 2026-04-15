import { useState, useEffect } from 'react';

// Global cache and in-flight deduplication (survive re-renders / remounts)
const iconCache = new Map<string, string>();
const inFlight  = new Map<string, Promise<string>>();

function fetchIcon(lookupPath: string, cacheKey: string): Promise<string> {
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey)!;
  const p = window.fileAPI
    .getShellIcon(lookupPath)
    .then((url) => { iconCache.set(cacheKey, url); return url; })
    .catch(() => { iconCache.set(cacheKey, ''); return ''; })
    .finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, p);
  return p;
}

/**
 * Returns the Windows shell icon data-URL for a file or directory.
 *
 * - Files    → cached by extension (all .jpg files share the same icon —
 *              the icon of the app registered as the default handler)
 * - Dirs     → cached by path (special folders have unique icons)
 *
 * We pass the REAL file/dir path to getFileIcon so Windows returns the
 * correct associated-app icon rather than a generic "unknown" icon.
 */
export function useShellIcon(
  filePath: string,
  extension: string,
  isDirectory: boolean,
): string {
  const cacheKey = isDirectory ? `dir:${filePath}` : (extension || 'noext');

  const [url, setUrl] = useState<string>(() => iconCache.get(cacheKey) ?? '');

  useEffect(() => {
    if (iconCache.has(cacheKey)) {
      setUrl(iconCache.get(cacheKey)!);
      return;
    }
    let alive = true;
    // Use the actual file/dir path so Windows resolves the real associated icon
    fetchIcon(filePath, cacheKey).then((result) => {
      if (alive) setUrl(result);
    });
    return () => { alive = false; };
  }, [cacheKey, filePath]);

  return url;
}
