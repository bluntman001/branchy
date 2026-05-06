import React from 'react';
import {
  PiHardDrives,
  PiUsb,
  PiNetworkSlash,
  PiDisc,
  PiDevices,
  PiDesktop,
  PiDownloadSimple,
  PiFiles,
  PiMusicNote,
  PiImages,
  PiFileImage,
  PiFilmSlate,
  PiMusicNoteSimple,
  PiFilePdf,
  PiFileCode,
  PiFileZip,
  PiFileDoc,
  PiMicrosoftExcelLogo,
  PiMicrosoftPowerpointLogo,
  PiFile,
  PiClockCounterClockwise,
  PiHouse,
} from 'react-icons/pi';
import { DriveType } from '../../types';
import { getFileCategory, getCategoryColor, FileCategory } from '../utils/fileTypes';

// ── Drive icons ────────────────────────────────────────
interface DriveIconProps {
  driveType: DriveType;
  size?: number;
  className?: string;
}

export function DriveIcon({ driveType, size = 16, className = '' }: DriveIconProps) {
  const style: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', flexShrink: 0 };
  switch (driveType) {
    case 'local':
      return <span className={className} style={{ ...style, color: '#60a5fa' }}><PiHardDrives size={size} /></span>;
    case 'removable':
      return <span className={className} style={{ ...style, color: '#34d399' }}><PiUsb size={size} /></span>;
    case 'network':
      return <span className={className} style={{ ...style, color: '#a78bfa' }}><PiNetworkSlash size={size} /></span>;
    case 'cdrom':
      return <span className={className} style={{ ...style, color: '#fb923c' }}><PiDisc size={size} /></span>;
    default:
      return <span className={className} style={{ ...style, color: '#6b7280' }}><PiDevices size={size} /></span>;
  }
}

// ── Special "place" icons (Desktop, Downloads, etc.) ──
export type SpecialPlace = 'desktop' | 'downloads' | 'documents' | 'music' | 'pictures' | 'home' | 'recent';

interface PlaceIconProps {
  place: SpecialPlace;
  size?: number;
}

export function PlaceIcon({ place, size = 15 }: PlaceIconProps) {
  const style: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', flexShrink: 0 };
  switch (place) {
    case 'home':
      return <span style={{ ...style, color: '#fbbf24' }}><PiHouse size={size} /></span>;
    case 'desktop':
      return <span style={{ ...style, color: '#60a5fa' }}><PiDesktop size={size} /></span>;
    case 'downloads':
      return <span style={{ ...style, color: '#34d399' }}><PiDownloadSimple size={size} /></span>;
    case 'documents':
      return <span style={{ ...style, color: '#a78bfa' }}><PiFiles size={size} /></span>;
    case 'music':
      return <span style={{ ...style, color: '#f472b6' }}><PiMusicNote size={size} /></span>;
    case 'pictures':
      return <span style={{ ...style, color: '#fb923c' }}><PiImages size={size} /></span>;
    case 'recent':
      return <span style={{ ...style, color: '#94a3b8' }}><PiClockCounterClockwise size={size} /></span>;
  }
}

// ── Generic file/folder icons ─────────────────────────
interface FileIconProps {
  extension: string;
  isDirectory: boolean;
  isOpen?: boolean;
  isShared?: boolean;
  size?: number;
  className?: string;
  /** If provided, renders a shell icon image instead of the SVG fallback */
  shellIconUrl?: string;
}

function CategoryIcon({ category, size }: { category: FileCategory; size: number }) {
  switch (category) {
    case 'folder':     return <ModernFolderIcon size={size} />;
    case 'image':      return <PiFileImage size={size} />;
    case 'video':      return <PiFilmSlate size={size} />;
    case 'audio':      return <PiMusicNoteSimple size={size} />;
    case 'pdf':        return <PiFilePdf size={size} />;
    case 'code':       return <PiFileCode size={size} />;
    case 'archive':    return <PiFileZip size={size} />;
    case 'document':   return <PiFileDoc size={size} />;
    case 'spreadsheet':return <PiMicrosoftExcelLogo size={size} />;
    case 'presentation':return <PiMicrosoftPowerpointLogo size={size} />;
    default:           return <PiFile size={size} />;
  }
}

function ModernFolderIcon({ size = 16, open = false }: { size?: number; open?: boolean }) {
  const id = React.useId();
  if (open) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={`fo1-${id}`} x1="2" y1="6" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FCD34D" />
            <stop offset="1" stopColor="#F59E0B" />
          </linearGradient>
          <linearGradient id={`fo2-${id}`} x1="1" y1="10" x2="20" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FBBF24" />
            <stop offset="1" stopColor="#D97706" />
          </linearGradient>
        </defs>
        <path d="M2 6C2 4.895 2.895 4 4 4H9.172a2 2 0 0 1 1.414.586L12 6H20a2 2 0 0 1 2 2V9H2V6Z" fill={`url(#fo1-${id})`} />
        <path d="M1 10.5a1 1 0 0 1 .98-.995L2 9.5h20l.02.005a1 1 0 0 1 .866.724l.008.04-2 10a1 1 0 0 1-.874.726L20 21H4a1 1 0 0 1-.97-.757l-.01-.043-2-9.5A1 1 0 0 1 1 10.5Z" fill={`url(#fo2-${id})`} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`fc1-${id}`} x1="2" y1="4" x2="22" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FCD34D" />
          <stop offset="1" stopColor="#F59E0B" />
        </linearGradient>
        <linearGradient id={`fc2-${id}`} x1="2" y1="8" x2="22" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FBBF24" />
          <stop offset="1" stopColor="#D97706" />
        </linearGradient>
      </defs>
      <path d="M2 6C2 4.895 2.895 4 4 4H9.172a2 2 0 0 1 1.414.586L12 6H20a2 2 0 0 1 2 2V9H2V6Z" fill={`url(#fc1-${id})`} />
      <rect x="2" y="8" width="20" height="12" rx="1.5" fill={`url(#fc2-${id})`} />
    </svg>
  );
}

export function FileIcon({
  extension,
  isDirectory,
  isOpen = false,
  isShared = false,
  size = 16,
  className = '',
  shellIconUrl = '',
}: FileIconProps) {
  const style: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', flexShrink: 0 };

  // Use Windows shell icon when available
  if (shellIconUrl) {
    return (
      <img
        src={shellIconUrl}
        width={size}
        height={size}
        className={className}
        draggable={false}
        style={{ display: 'inline-block', objectFit: 'contain', flexShrink: 0, verticalAlign: 'middle' }}
      />
    );
  }

  if (isDirectory) {
    return (
      <span className={className} style={{ ...style, flexShrink: 0 }}>
        <ModernFolderIcon size={size} open={isOpen} />
      </span>
    );
  }

  const category = getFileCategory(extension, false);
  const color = getCategoryColor(category);
  return (
    <span className={className} style={{ ...style, color }}>
      <CategoryIcon category={category} size={size} />
    </span>
  );
}
