// Module-level icon caches survive React re-renders and component remounts.
// Capped LRU to bound memory on very large sessions.

import { fileAPI } from '../../api';
import { convertFileSrc } from '@tauri-apps/api/core';

// One-shot per-session token used to cache-bust asset URLs. Without this
// WebView2 sometimes serves a stale (incorrectly-composited) image from
// its HTTP cache after an app restart even though the file on disk is
// fine. Random per launch → fresh fetch on first card mount of a session.
const SESSION_TOKEN = Math.random().toString(36).slice(2, 10);

const ICON_CAP  = 800;    // ~one entry per file extension; rarely hit
// Per-file thumb blob URLs are tiny strings; the actual decoded image lives
// in the browser's blob store (also bounded by browser memory). 4000 keeps
// large folders fully in memory → scroll-back is a free re-paint.
const THUMB_CAP = 4000;

class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private cap: number, private onEvict?: (v: V) => void) {}
  get(k: K): V | undefined {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k)!;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  has(k: K): boolean { return this.map.has(k); }
  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as K;
      const evicted = this.map.get(oldest);
      this.map.delete(oldest);
      if (evicted !== undefined) this.onEvict?.(evicted);
    }
  }
  delete(k: K): void { this.map.delete(k); }
}

const cache    = new LRU<string, string>(ICON_CAP);
const inFlight = new Map<string, Promise<string>>();

// Thumb cache now stores Tauri asset URLs (`http://asset.localhost/...`)
// that the webview loads natively from disk via the asset protocol — no
// base64/blob round-trip means no Chromium compositor alpha quirks.
// These are plain string URLs, no resources to revoke.
const thumbCache = new LRU<string, string>(THUMB_CAP);
const thumbInFlight = new Map<string, Promise<void>>();

export function getCachedThumb(filePath: string): string {
  return thumbCache.get(filePath) ?? '';
}

export function isThumbCached(filePath: string): boolean {
  return thumbCache.has(filePath);
}

/** Convert a `data:image/png;base64,…` URL to a blob URL. */
function dataUrlToBlobUrl(dataUrl: string): string | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch {
    return null;
  }
}

// ── Per-card lazy thumbnail loader ──────────────────────────────────────
//
// Visible thumbnail cards call requestThumb() on mount. The request is
// deduped via thumbInFlight, queued, and flushed in chunks of 4 to Rust.
// When the cache evicts an off-screen thumb, scrolling back re-mounts the
// card, which re-requests — and the disk cache (Rust side) makes that
// re-fetch instant. No need to keep every loaded thumbnail in JS memory.

const thumbProgressListeners = new Set<() => void>();

export function onThumbProgress(cb: () => void): () => void {
  thumbProgressListeners.add(cb);
  return () => { thumbProgressListeners.delete(cb); };
}

function notifyThumbProgress() {
  for (const cb of thumbProgressListeners) cb();
}

const thumbQueue: string[] = [];
let flushScheduled = false;

export function requestThumb(filePath: string): void {
  if (thumbCache.has(filePath) || thumbInFlight.has(filePath)) return;
  thumbInFlight.set(filePath, new Promise<void>(() => {}));
  thumbQueue.push(filePath);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushThumbQueue);
  }
}

async function flushThumbQueue(): Promise<void> {
  flushScheduled = false;
  if (thumbQueue.length === 0) return;
  const batch = thumbQueue.splice(0, thumbQueue.length);

  // Run all chunks concurrently — disk-cache hits are tiny, so parallelism
  // turns N sequential IPC waits into one. Tauri runs each invoke on its
  // own blocking thread, so they truly overlap.
  const CHUNK = 16;
  const tasks: Promise<void>[] = [];
  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    tasks.push(
      fileAPI
        .generateShellThumbnailsPaths(chunk)
        .then((generated) => {
          for (const p of chunk) {
            const filePath = generated[p];
            if (filePath) {
              // Cache-bust the asset URL with a per-session token so
              // WebView2's HTTP cache can't serve a previous (potentially
              // miscomposited) decode. The token is fixed for the session
              // so re-mounting the same card still hits the browser cache.
              const url = `${convertFileSrc(filePath)}?v=${SESSION_TOKEN}`;
              thumbCache.set(p, url);
            }
            thumbInFlight.delete(p);
          }
          notifyThumbProgress();
        })
        .catch(() => {
          for (const p of chunk) thumbInFlight.delete(p);
        }),
    );
  }
  await Promise.all(tasks);
}

export function iconKey(filePath: string, extension: string, isDirectory: boolean): string {
  return isDirectory ? `dir:${filePath}` : (extension || 'noext');
}

export function getCached(key: string): string {
  return cache.get(key) ?? '';
}

export function isCached(key: string): boolean {
  return cache.has(key);
}

/** Single-file fetch (fallback, kept for compatibility). */
export async function fetchIcon(filePath: string, key: string): Promise<string> {
  if (cache.has(key)) return cache.get(key)!;
  if (inFlight.has(key)) return inFlight.get(key)!;

  const p = fileAPI
    .getShellIcon(filePath)
    .then((url) => {
      const result = (url && url.startsWith('data:image/')) ? url : '';
      cache.set(key, result);
      return result;
    })
    .catch(() => { cache.set(key, ''); return ''; })
    .finally(() => inFlight.delete(key));

  inFlight.set(key, p);
  return p;
}

/**
 * Batch-fetch 256x256 icons keyed by extension.
 * Falls back to the single-icon API for anything the batch leaves unresolved.
 */
export async function fetchIconsBatch(
  entries: Array<{ path: string; key: string }>,
  onProgress: () => void,
): Promise<void> {
  // Deduplicate by key; skip already-cached keys.
  const toFetch = new Map<string, string>();
  for (const e of entries) {
    if (!isCached(e.key) && !inFlight.has(e.key) && !toFetch.has(e.key)) {
      toFetch.set(e.key, e.path);
    }
  }
  if (toFetch.size === 0) return;

  const resolvers = new Map<string, (v: string) => void>();
  for (const [key] of toFetch) {
    const p = new Promise<string>((resolve) => resolvers.set(key, resolve));
    inFlight.set(key, p);
    p.catch(() => {/* noop */});
  }

  const pathToKey = new Map<string, string>();
  for (const [key, filePath] of toFetch) pathToKey.set(filePath, key);

  try {
    const batchResult = await fileAPI.getShellIconsBatch([...pathToKey.keys()]);
    for (const [filePath, url] of Object.entries(batchResult)) {
      const key = pathToKey.get(filePath);
      if (!key) continue;
      const valid = url && url.startsWith('data:image/') ? url : '';
      cache.set(key, valid);
      resolvers.get(key)?.(valid);
      inFlight.delete(key);
      onProgress();
    }
  } catch { /* fall through to per-file fallback */ }

  const remaining = [...toFetch.entries()].filter(([key]) => !cache.has(key));
  await Promise.all(
    remaining.map(async ([key, filePath]) => {
      try {
        const url = await fileAPI.getShellIcon(filePath);
        const valid = (url && url.startsWith('data:image/')) ? url : '';
        cache.set(key, valid);
        resolvers.get(key)?.(valid);
      } catch {
        cache.set(key, '');
        resolvers.get(key)?.('');
      }
      inFlight.delete(key);
      onProgress();
    })
  );
}
