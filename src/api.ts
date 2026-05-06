import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Store } from '@tauri-apps/plugin-store';
import type { FileEntry, FilePreview, DriveInfo, AppSettings, MostUsedEntry, OpenWithApp } from './types';

let settingsStore: Store | null = null;
let accessStore: Store | null = null;

async function getSettingsStore(): Promise<Store> {
  if (!settingsStore) {
    settingsStore = await Store.load('settings.json');
  }
  return settingsStore;
}

async function getAccessStore(): Promise<Store> {
  if (!accessStore) {
    accessStore = await Store.load('folder-access.json');
  }
  return accessStore;
}

export const fileAPI = {
  async listDirectory(dirPath: string): Promise<FileEntry[]> {
    const store = await getSettingsStore();
    const showHidden = ((await store.get<boolean>('showHidden')) ?? false);
    return invoke<FileEntry[]>('list_directory', { dirPath, showHidden });
  },

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    return invoke('rename_file', { oldPath, newPath });
  },

  async moveFiles(sourcePaths: string[], destDir: string): Promise<void> {
    return invoke('move_files', { sourcePaths, destDir });
  },

  async copyFiles(sourcePaths: string[], destDir: string): Promise<void> {
    return invoke('copy_files', { sourcePaths, destDir });
  },

  /// Kicks off a background copy with progress events. Returns immediately;
  /// listen to the `copy-progress` event (filtered by opId) to track bytes,
  /// current file, and completion.
  async copyFilesAsync(opId: string, sourcePaths: string[], destDir: string): Promise<void> {
    return invoke('copy_files_async', { opId, sourcePaths, destDir });
  },

  async deleteFiles(paths: string[]): Promise<void> {
    return invoke('delete_files', { paths });
  },

  /// Permanently delete (skips recycle bin). Used as a fallback for
  /// network/SMB/ZFS drives that don't support Recycle Bin.
  async permanentDeleteFiles(paths: string[]): Promise<void> {
    return invoke('permanent_delete_files', { paths });
  },

  async watchDirectory(path: string): Promise<void> {
    return invoke('watch_directory', { path });
  },

  async unwatchDirectory(): Promise<void> {
    return invoke('unwatch_directory');
  },

  /// Extract an archive into destDir using WinRAR (preferred) or 7-Zip.
  /// Returns the name of the tool that ran, throws if neither is installed.
  async extractArchive(archivePath: string, destDir: string): Promise<string> {
    return invoke<string>('extract_archive', { archivePath, destDir });
  },

  async createFolder(folderPath: string): Promise<void> {
    return invoke('create_folder', { folderPath });
  },

  async createFile(filePath: string): Promise<void> {
    return invoke('create_file', { filePath });
  },

  async searchFiles(rootPath: string, query: string): Promise<FileEntry[]> {
    return invoke<FileEntry[]>('search_files', { rootPath, query });
  },

  async getFilePreview(filePath: string): Promise<FilePreview> {
    return invoke<FilePreview>('get_file_preview', { filePath });
  },

  async openFile(filePath: string): Promise<void> {
    return invoke('open_file', { filePath });
  },

  async getDrives(): Promise<DriveInfo[]> {
    return invoke<DriveInfo[]>('get_drives');
  },

  async getStats(filePath: string): Promise<FileEntry | null> {
    return invoke<FileEntry | null>('get_stats', { filePath });
  },

  async hasSubdirectories(dirPath: string): Promise<boolean> {
    return invoke<boolean>('has_subdirectories', { dirPath });
  },

  async getShellIcon(filePath: string): Promise<string> {
    return invoke<string>('get_shell_icon', { filePath });
  },

  async getShellIconsBatch(filePaths: string[]): Promise<Record<string, string>> {
    return invoke<Record<string, string>>('get_shell_icons_batch', { filePaths });
  },

  async getShellThumbnailsBatch(filePaths: string[]): Promise<Record<string, string>> {
    return invoke<Record<string, string>>('get_shell_thumbnails_batch', { filePaths });
  },

  async generateShellThumbnailsBatch(filePaths: string[]): Promise<Record<string, string>> {
    return invoke<Record<string, string>>('generate_shell_thumbnails_batch', { filePaths });
  },

  /// Returns the on-disk cache file path for each thumbnail. Renderer pairs
  /// this with `convertFileSrc` to load the image natively via Tauri's
  /// asset protocol — bypasses base64/blob conversion that has alpha
  /// rendering quirks in WebView2.
  async generateShellThumbnailsPaths(filePaths: string[]): Promise<Record<string, string>> {
    return invoke<Record<string, string>>('generate_shell_thumbnails_paths', { filePaths });
  },

  async getFolderSize(dirPath: string): Promise<number> {
    return invoke<number>('get_folder_size', { dirPath });
  },

  async getOpenWithApps(ext: string): Promise<OpenWithApp[]> {
    return invoke<OpenWithApp[]>('get_open_with_apps', { ext });
  },

  async openFileWith(filePath: string, exePath: string): Promise<void> {
    return invoke('open_file_with', { filePath, exePath });
  },

  async showOpenWithDialog(filePath: string): Promise<void> {
    return invoke('show_open_with_dialog', { filePath });
  },

  nav: {
    async getMostUsed(limit?: number): Promise<MostUsedEntry[]> {
      const store = await getAccessStore();
      const entries = await store.entries<number>();
      const sorted = entries
        .map(([path, count]) => ({ path, count: count ?? 0 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit ?? 8);
      return sorted;
    },

    async trackAccess(dirPath: string): Promise<void> {
      const store = await getAccessStore();
      const current = (await store.get<number>(dirPath)) ?? 0;
      await store.set(dirPath, current + 1);
      await store.save();
    },

    async removeMostUsed(dirPath: string): Promise<void> {
      const store = await getAccessStore();
      await store.delete(dirPath);
      await store.save();
    },
  },

  settings: {
    async get(key: string): Promise<unknown> {
      const store = await getSettingsStore();
      return store.get(key);
    },

    async set(key: string, value: unknown): Promise<void> {
      const store = await getSettingsStore();
      await store.set(key, value);
      await store.save();
    },

    async getAll(): Promise<AppSettings> {
      const store = await getSettingsStore();
      const homeDir = await invoke<string>('get_home_dir');
      return {
        apiKey: (await store.get<string>('apiKey')) ?? '',
        startDir: (await store.get<string>('startDir')) ?? homeDir,
        confirmDelete: (await store.get<boolean>('confirmDelete')) ?? true,
        showHidden: (await store.get<boolean>('showHidden')) ?? false,
      };
    },

    async getHomeDir(): Promise<string> {
      return invoke<string>('get_home_dir');
    },

    async getInitialPath(): Promise<string | null> {
      return invoke<string | null>('get_initial_path');
    },

    async getSpecialPaths(): Promise<Record<string, string>> {
      return invoke<Record<string, string>>('get_special_paths');
    },
  },

  window: {
    async minimize(): Promise<void> {
      await getCurrentWindow().minimize();
    },
    async maximize(): Promise<void> {
      const win = getCurrentWindow();
      if (await win.isMaximized()) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
    },
    async close(): Promise<void> {
      await getCurrentWindow().close();
    },
    async startDragging(): Promise<void> {
      await getCurrentWindow().startDragging();
    },
    async toggleMaximize(): Promise<void> {
      const win = getCurrentWindow();
      if (await win.isMaximized()) await win.unmaximize();
      else await win.maximize();
    },
  },
};

// Make it available as window.fileAPI for compatibility
(window as any).fileAPI = fileAPI;
