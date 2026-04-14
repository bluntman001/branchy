import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import trash from 'trash';

const execAsync = promisify(exec);

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
  created: number;
  extension: string;
}

export type DriveType = 'local' | 'removable' | 'network' | 'cdrom' | 'unknown';

export interface DriveInfo {
  letter: string;
  label: string;
  path: string;
  type: DriveType;
  size?: number;
  free?: number;
}

// List directory contents with metadata
export async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const results: FileEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      results.push({
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: stat.size,
        modified: stat.mtimeMs,
        created: stat.birthtimeMs,
        extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
      });
    } catch {
      // Skip inaccessible files
    }
  }

  // Directories first, then files, both sorted alphabetically
  return results.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

// Rename a file or folder
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  await fs.promises.rename(oldPath, newPath);
}

// Copy a single item (file or directory recursively)
async function copyItem(src: string, dest: string): Promise<void> {
  const stat = await fs.promises.stat(src);
  if (stat.isDirectory()) {
    await fs.promises.mkdir(dest, { recursive: true });
    const children = await fs.promises.readdir(src);
    await Promise.all(children.map((child) => copyItem(path.join(src, child), path.join(dest, child))));
  } else {
    await fs.promises.copyFile(src, dest);
  }
}

// Move files to a destination directory
export async function moveFiles(sourcePaths: string[], destDir: string): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true });
  await Promise.all(
    sourcePaths.map(async (src) => {
      const dest = path.join(destDir, path.basename(src));
      try {
        await fs.promises.rename(src, dest);
      } catch {
        // Cross-device move: copy then delete
        await copyItem(src, dest);
        await fs.promises.rm(src, { recursive: true, force: true });
      }
    })
  );
}

// Copy files to a destination directory
export async function copyFiles(sourcePaths: string[], destDir: string): Promise<void> {
  await fs.promises.mkdir(destDir, { recursive: true });
  await Promise.all(
    sourcePaths.map((src) => copyItem(src, path.join(destDir, path.basename(src))))
  );
}

// Delete files by moving to trash
export async function deleteFiles(paths: string[]): Promise<void> {
  await trash(paths);
}

// Create a new folder
export async function createFolder(folderPath: string): Promise<void> {
  await fs.promises.mkdir(folderPath, { recursive: true });
}

// Recursive filename search
export async function searchFiles(rootPath: string, query: string): Promise<FileEntry[]> {
  const results: FileEntry[] = [];
  const lowerQuery = query.toLowerCase();

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 6) return; // limit recursion depth
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skip hidden
      const fullPath = path.join(dir, entry.name);
      if (entry.name.toLowerCase().includes(lowerQuery)) {
        try {
          const stat = await fs.promises.stat(fullPath);
          results.push({
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stat.size,
            modified: stat.mtimeMs,
            created: stat.birthtimeMs,
            extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
          });
        } catch {
          // skip
        }
      }
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
      }
    }
  }

  await walk(rootPath, 0);
  return results;
}

// Get file preview (first 500 chars for text files, base64 for images)
export async function getFilePreview(filePath: string): Promise<{ type: 'text' | 'image' | 'none'; content: string }> {
  const ext = path.extname(filePath).toLowerCase();
  const textExts = ['.txt', '.md', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.json', '.yaml', '.yml', '.xml', '.csv', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.sh', '.bat', '.ps1', '.log', '.ini', '.toml', '.env'];
  const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'];

  if (textExts.includes(ext)) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      return { type: 'text', content: content.slice(0, 500) };
    } catch {
      return { type: 'none', content: '' };
    }
  }

  if (imageExts.includes(ext)) {
    try {
      const buffer = await fs.promises.readFile(filePath);
      const b64 = buffer.toString('base64');
      const mime = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`;
      return { type: 'image', content: `data:${mime};base64,${b64}` };
    } catch {
      return { type: 'none', content: '' };
    }
  }

  return { type: 'none', content: '' };
}

// Open file with default system app
export async function openFile(filePath: string): Promise<void> {
  const { shell } = await import('electron');
  const err = await shell.openPath(filePath);
  if (err) throw new Error(err);
}

// Map wmic DriveType number to our enum
// 0=Unknown, 1=NoRootDir, 2=Removable, 3=LocalDisk, 4=Network, 5=CD, 6=RAM
function wmicDriveType(n: string): DriveType {
  switch (n.trim()) {
    case '2': return 'removable';
    case '3': return 'local';
    case '4': return 'network';
    case '5': return 'cdrom';
    default:  return 'unknown';
  }
}

// Get available drives on Windows with type, label, and free space
export async function getDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') {
    return [{ letter: '/', label: 'Root', path: '/', type: 'local' }];
  }
  try {
    // caption, drivetype, freespace, size, volumename
    const { stdout } = await execAsync(
      'wmic logicaldisk get caption,drivetype,freespace,size,volumename /format:csv'
    );
    const lines = stdout.trim().split('\n').filter((l) => l.trim() && !l.startsWith('Node'));
    const drives: DriveInfo[] = [];
    for (const line of lines) {
      const parts = line.trim().split(',');
      // CSV columns: Node, Caption, DriveType, FreeSpace, Size, VolumeName
      if (parts.length < 4) continue;
      const letter   = parts[1]?.trim();
      const dtype    = parts[2]?.trim();
      const free     = parseInt(parts[3]?.trim() || '0', 10);
      const size     = parseInt(parts[4]?.trim() || '0', 10);
      const volName  = parts[5]?.trim() || '';
      if (!letter || !/^[A-Z]:$/.test(letter)) continue;
      const label = volName || letter;
      drives.push({
        letter,
        label,
        path: letter + '\\',
        type: wmicDriveType(dtype),
        size: isNaN(size) ? undefined : size,
        free: isNaN(free) ? undefined : free,
      });
    }
    if (drives.length === 0) {
      for (const l of ['C', 'D', 'E', 'F']) {
        const drivePath = `${l}:\\`;
        if (fs.existsSync(drivePath)) {
          drives.push({ letter: `${l}:`, label: `${l}:`, path: drivePath, type: 'local' });
        }
      }
    }
    return drives;
  } catch {
    return [{ letter: 'C:', label: 'Local Disk', path: 'C:\\', type: 'local' }];
  }
}

// Quick check: does this directory contain at least one subdirectory?
export async function hasSubdirectories(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    return entries.some((e) => e.isDirectory());
  } catch {
    return false;
  }
}

// Get file/folder stats
export async function getStats(filePath: string): Promise<FileEntry | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    const name = path.basename(filePath);
    return {
      name,
      path: filePath,
      isDirectory: stat.isDirectory(),
      size: stat.size,
      modified: stat.mtimeMs,
      created: stat.birthtimeMs,
      extension: stat.isDirectory() ? '' : path.extname(name).toLowerCase(),
    };
  } catch {
    return null;
  }
}

// Get Windows shell icon for a file as a base64 PNG data URL
// filePath can be a real file or a dummy "*.ext" path for extension lookup
export async function getShellIcon(filePath: string): Promise<string> {
  const { app, nativeImage } = await import('electron');
  try {
    const img = await app.getFileIcon(filePath, { size: 'normal' });
    if (img.isEmpty()) return '';
    return 'data:image/png;base64,' + img.toPNG().toString('base64');
  } catch {
    return '';
  }
}

export interface OpenWithApp {
  name: string;
  exePath: string;
  icon?: string;
}

// Detect installed "open with" candidates for a given extension
export async function getOpenWithApps(ext: string): Promise<OpenWithApp[]> {
  const apps: OpenWithApp[] = [];
  const lower = ext.toLowerCase();

  // WinRAR — archives
  if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.cab', '.iso'].includes(lower)) {
    for (const p of [
      'C:\\Program Files\\WinRAR\\WinRAR.exe',
      'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe',
    ]) {
      if (fs.existsSync(p)) { apps.push({ name: 'WinRAR', exePath: p }); break; }
    }
    // 7-Zip
    for (const p of [
      'C:\\Program Files\\7-Zip\\7zFM.exe',
      'C:\\Program Files (x86)\\7-Zip\\7zFM.exe',
    ]) {
      if (fs.existsSync(p)) { apps.push({ name: '7-Zip', exePath: p }); break; }
    }
  }

  // VS Code — code/text
  const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.md', '.txt', '.py', '.rs', '.go', '.yaml', '.yml', '.toml', '.sh', '.bat', '.env', '.xml'];
  if (codeExts.includes(lower)) {
    const localAppData = process.env.LOCALAPPDATA || '';
    for (const p of [
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      path.join(localAppData, 'Programs\\Microsoft VS Code\\Code.exe'),
    ]) {
      if (fs.existsSync(p)) { apps.push({ name: 'VS Code', exePath: p }); break; }
    }
  }

  // Notepad++ — text files
  if (['.txt', '.log', '.md', '.ini', '.cfg', '.conf'].includes(lower) || codeExts.includes(lower)) {
    for (const p of [
      'C:\\Program Files\\Notepad++\\notepad++.exe',
      'C:\\Program Files (x86)\\Notepad++\\notepad++.exe',
    ]) {
      if (fs.existsSync(p)) { apps.push({ name: 'Notepad++', exePath: p }); break; }
    }
  }

  // Notepad — always available for text
  if (['.txt', '.log', '.md', '.ini', '.cfg', '.bat', '.csv'].includes(lower)) {
    apps.push({ name: 'Notepad', exePath: 'notepad.exe' });
  }

  // VLC — media
  if (['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.flac', '.wav', '.aac', '.ogg'].includes(lower)) {
    for (const p of [
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
    ]) {
      if (fs.existsSync(p)) { apps.push({ name: 'VLC', exePath: p }); break; }
    }
  }

  return apps;
}

// Open a file with a specific executable
export async function openFileWith(filePath: string, exePath: string): Promise<void> {
  const { shell } = await import('electron');
  if (exePath === 'notepad.exe') {
    // Use execFile for built-ins
    const execFileAsync = promisify(execFile);
    await execFileAsync('notepad.exe', [filePath]);
    return;
  }
  // For discovered apps, use shell.openPath won't work; use execFile
  const execFileAsync = promisify(execFile);
  await execFileAsync(exePath, [filePath]);
}

// Show Windows built-in "Open With" dialog for a file
export async function showOpenWithDialog(filePath: string): Promise<void> {
  const execAsync2 = promisify(exec);
  // rundll32 shell32 OpenAs_RunDLL opens the native dialog
  await execAsync2(`rundll32.exe shell32.dll,OpenAs_RunDLL "${filePath}"`);
}

// Create an empty file
export async function createFile(filePath: string): Promise<void> {
  await fs.promises.writeFile(filePath, '', { flag: 'wx' });
}
