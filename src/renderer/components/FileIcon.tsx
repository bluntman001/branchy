import React from 'react';
import {
  PiFolder,
  PiFolderOpen,
  PiFolderUser,
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
    case 'folder':     return <PiFolder size={size} />;
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
    const color = '#fbbf24';
    return (
      <span className={className} style={{ ...style, color }}>
        {isShared
          ? <PiFolderUser size={size} />
          : isOpen
          ? <PiFolderOpen size={size} />
          : <PiFolder size={size} />}
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
