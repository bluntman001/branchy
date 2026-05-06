import React from 'react';
import { FiChevronRight, FiHardDrive } from 'react-icons/fi';
import { joinPath } from '../utils/path';

interface BreadcrumbsProps {
  currentPath: string;
  onNavigate: (p: string) => void;
}

export function Breadcrumbs({ currentPath, onNavigate }: BreadcrumbsProps) {
  const parts = buildParts(currentPath);

  return (
    <div
      data-tauri-drag-region
      className="flex items-center overflow-hidden"
      style={{
        fontFamily: 'Geist, sans-serif',
        fontSize: 12.5,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 999,
        padding: '3px 6px',
        gap: 1,
        letterSpacing: '-0.005em',
        height: 30,
        width: 'fit-content',
        maxWidth: '100%',
        userSelect: 'none',
        WebkitUserDrag: 'none',
      } as React.CSSProperties}
    >
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1;
        const isFirst = i === 0;
        return (
          <React.Fragment key={part.path}>
            <button
              onClick={() => onNavigate(part.path)}
              className="flex items-center gap-1.5 transition-colors"
              style={{
                padding: isFirst ? '4px 9px 4px 8px' : '4px 9px',
                borderRadius: 999,
                color: isLast ? 'var(--text)' : 'var(--text-dim)',
                fontWeight: isLast ? 500 : 400,
                background: isLast ? 'rgba(255,255,255,0.05)' : 'transparent',
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => { if (!isLast) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { if (!isLast) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)'; } }}
            >
              {isFirst && <FiHardDrive size={11} style={{ opacity: 0.7 }} />}
              <span>{part.label}</span>
            </button>
            {!isLast && (
              <FiChevronRight
                size={11}
                style={{ color: 'var(--text-ghost)', flexShrink: 0, margin: '0 -2px' }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function buildParts(currentPath: string): { label: string; path: string }[] {
  const normalized = currentPath.replace(/\\/g, '/');
  const parts: { label: string; path: string }[] = [];

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

  parts.push({ label: '/', path: '/' });
  const segments = normalized.replace(/^\//, '').split('/').filter(Boolean);
  let accumulated = '/';
  for (const seg of segments) {
    accumulated = joinPath(accumulated, seg);
    parts.push({ label: seg, path: accumulated });
  }
  return parts;
}
