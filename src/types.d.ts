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

export interface FilePreview {
  type: 'text' | 'image' | 'none';
  content: string;
}

export interface AppSettings {
  apiKey: string;
  startDir: string;
  confirmDelete: boolean;
  showHidden: boolean;
}

export interface MostUsedEntry {
  path: string;
  count: number;
}

export interface OpenWithApp {
  name: string;
  exePath: string;
}

export interface FileAPI {
  listDirectory(dirPath: string): Promise<FileEntry[]>;
  renameFile(oldPath: string, newPath: string): Promise<void>;
  moveFiles(sourcePaths: string[], destDir: string): Promise<void>;
  copyFiles(sourcePaths: string[], destDir: string): Promise<void>;
  deleteFiles(paths: string[]): Promise<void>;
  createFolder(folderPath: string): Promise<void>;
  createFile(filePath: string): Promise<void>;
  searchFiles(rootPath: string, query: string): Promise<FileEntry[]>;
  getFilePreview(filePath: string): Promise<FilePreview>;
  openFile(filePath: string): Promise<void>;
  getDrives(): Promise<DriveInfo[]>;
  getStats(filePath: string): Promise<FileEntry | null>;
  hasSubdirectories(dirPath: string): Promise<boolean>;
  getShellIcon(filePath: string): Promise<string>;
  getOpenWithApps(ext: string): Promise<OpenWithApp[]>;
  openFileWith(filePath: string, exePath: string): Promise<void>;
  showOpenWithDialog(filePath: string): Promise<void>;
  nav: {
    getMostUsed(limit?: number): Promise<MostUsedEntry[]>;
    trackAccess(dirPath: string): Promise<void>;
  };
  settings: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    getAll(): Promise<AppSettings>;
    getHomeDir(): Promise<string>;
  };
  window: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
  };
}

declare global {
  interface Window {
    fileAPI: FileAPI;
  }
}
