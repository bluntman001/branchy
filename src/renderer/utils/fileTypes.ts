export type FileCategory =
  | 'folder'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'code'
  | 'archive'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'font'
  | 'generic';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tga', '.raw']);
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.3gp', '.ogv']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff']);
const ARCHIVE_EXTS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.cab', '.iso', '.dmg']);
const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.php', '.rb', '.swift', '.kt', '.sh', '.bat', '.ps1', '.sql', '.html', '.css',
  '.scss', '.sass', '.less', '.vue', '.svelte', '.lua', '.r', '.m', '.ex', '.exs',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.env', '.gitignore', '.dockerfile',
]);
const DOC_EXTS = new Set(['.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.log', '.tex']);
const SHEET_EXTS = new Set(['.xls', '.xlsx', '.ods', '.csv']);
const SLIDE_EXTS = new Set(['.ppt', '.pptx', '.odp', '.key']);
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2', '.eot']);

export function getFileCategory(extension: string, isDirectory: boolean): FileCategory {
  if (isDirectory) return 'folder';
  const ext = extension.toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (CODE_EXTS.has(ext)) return 'code';
  if (DOC_EXTS.has(ext)) return 'document';
  if (SHEET_EXTS.has(ext)) return 'spreadsheet';
  if (SLIDE_EXTS.has(ext)) return 'presentation';
  if (FONT_EXTS.has(ext)) return 'font';
  return 'generic';
}

export function getCategoryColor(category: FileCategory): string {
  switch (category) {
    case 'folder': return '#f59e0b';
    case 'image': return '#10b981';
    case 'video': return '#8b5cf6';
    case 'audio': return '#ec4899';
    case 'pdf': return '#ef4444';
    case 'code': return '#3b82f6';
    case 'archive': return '#f97316';
    case 'document': return '#6b7280';
    case 'spreadsheet': return '#22c55e';
    case 'presentation': return '#f97316';
    case 'font': return '#a855f7';
    default: return '#6b7280';
  }
}
