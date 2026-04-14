import React from 'react';
import { FiChevronRight, FiHardDrive } from 'react-icons/fi';

interface BreadcrumbsProps {
  currentPath: string;
  onNavigate: (p: string) => void;
}

export function Breadcrumbs({ currentPath, onNavigate }: BreadcrumbsProps) {
  const parts = buildParts(currentPath);

  return (
    <div
      className="flex items-center gap-0.5 overflow-hidden"
      style={{ fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12 }}
    >
      {parts.map((part, i) => (
        <React.Fragment key={part.path}>
          {i === 0 ? (
            <button
              onClick={() => onNavigate(part.path)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors text-gray-300"
            >
              <FiHardDrive size={12} />
              <span>{part.label}</span>
            </button>
          ) : (
            <button
              onClick={() => onNavigate(part.path)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
              style={{ color: i === parts.length - 1 ? '#e5e5e5' : '#888888' }}
            >
              {part.label}
            </button>
          )}
          {i < parts.length - 1 && (
            <FiChevronRight size={12} style={{ color: '#555555', flexShrink: 0 }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function joinPath(base: string, segment: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const trimmed = base.replace(/[/\\]+$/, '');
  return trimmed + sep + segment;
}

function buildParts(currentPath: string): { label: string; path: string }[] {
  const normalized = currentPath.replace(/\\/g, '/');
  const parts: { label: string; path: string }[] = [];

  // Windows: C:/ style
  const winDriveMatch = normalized.match(/^([A-Za-z]:)(\/.*)?$/);
  if (winDriveMatch) {
    const drive = winDriveMatch[1].toUpperCase();
    const drivePath = drive + '\\';
    parts.push({ label: drive, path: drivePath });

    const rest = winDriveMatch[2] ? winDriveMatch[2].replace(/^\//, '') : '';
    if (rest) {
      const segments = rest.split('/').filter(Boolean);
      let accumulated = drivePath;
      for (const seg of segments) {
        accumulated = joinPath(accumulated, seg);
        parts.push({ label: seg, path: accumulated });
      }
    }
    return parts;
  }

  // Unix
  parts.push({ label: '/', path: '/' });
  const segments = normalized.replace(/^\//, '').split('/').filter(Boolean);
  let accumulated = '/';
  for (const seg of segments) {
    accumulated = joinPath(accumulated, seg);
    parts.push({ label: seg, path: accumulated });
  }
  return parts;
}
