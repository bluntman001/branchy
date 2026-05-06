export function pathSep(p: string): '\\' | '/' {
  return p.includes('\\') ? '\\' : '/';
}

export function basename(p: string): string {
  const norm = p.replace(/[/\\]+$/, '');
  const i = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'));
  return i >= 0 ? norm.slice(i + 1) : norm;
}

export function dirname(p: string): string {
  const sep = pathSep(p);
  const i = p.lastIndexOf(sep);
  return i <= 0 ? p : p.slice(0, i);
}

export function joinPath(base: string, segment: string): string {
  const sep = pathSep(base);
  return base.replace(/[/\\]+$/, '') + sep + segment;
}

export function parentPath(p: string): string {
  if (/^[A-Za-z]:[\\/]?$/.test(p)) return p;
  const norm = p.replace(/\\/g, '/');
  const i = norm.lastIndexOf('/');
  if (i <= 0) return p;
  const parent = norm.slice(0, i) || '/';
  if (/^[A-Za-z]:$/.test(parent)) return parent + '\\';
  return parent;
}
