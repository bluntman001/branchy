import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as os from 'os';
import ElectronStore from 'electron-store';

import {
  listDirectory,
  renameFile,
  moveFiles,
  copyFiles,
  deleteFiles,
  createFolder,
  createFile,
  searchFiles,
  getFilePreview,
  getDrives,
  getStats,
  hasSubdirectories,
  getShellIcon,
  getOpenWithApps,
  openFileWith,
  showOpenWithDialog,
} from './main/fileOps';

// Forge webpack magic constants
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Handle squirrel startup events on Windows
if (require('electron-squirrel-startup')) {
  app.quit();
}

// App settings store
const store = new ElectronStore<{
  apiKey: string;
  startDir: string;
  confirmDelete: boolean;
  showHidden: boolean;
}>({
  defaults: {
    apiKey: '',
    startDir: os.homedir(),
    confirmDelete: true,
    showHidden: false,
  },
});

// Most-used folder access tracking store
// Stores { [path]: accessCount }
const accessStore = new ElectronStore<Record<string, number>>({
  name: 'folder-access',
  defaults: {},
});

function trackFolderAccess(dirPath: string) {
  const current = (accessStore.get(dirPath) as number | undefined) ?? 0;
  accessStore.set(dirPath, current + 1);
}

function getMostUsedFolders(limit = 8): Array<{ path: string; count: number }> {
  const data = accessStore.store as Record<string, number>;
  return Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([p, count]) => ({ path: p, count }));
}

// Register all IPC handlers
function registerIpcHandlers() {
  ipcMain.handle('file:listDirectory', async (_, dirPath: string) => {
    trackFolderAccess(dirPath);
    const entries = await listDirectory(dirPath);
    const showHidden = store.get('showHidden');
    if (!showHidden) {
      return entries.filter((e) => !e.name.startsWith('.'));
    }
    return entries;
  });

  ipcMain.handle('file:renameFile', async (_, oldPath: string, newPath: string) => {
    await renameFile(oldPath, newPath);
  });

  ipcMain.handle('file:moveFiles', async (_, sourcePaths: string[], destDir: string) => {
    await moveFiles(sourcePaths, destDir);
  });

  ipcMain.handle('file:copyFiles', async (_, sourcePaths: string[], destDir: string) => {
    await copyFiles(sourcePaths, destDir);
  });

  ipcMain.handle('file:deleteFiles', async (_, paths: string[]) => {
    await deleteFiles(paths);
  });

  ipcMain.handle('file:createFolder', async (_, folderPath: string) => {
    await createFolder(folderPath);
  });

  ipcMain.handle('file:searchFiles', async (_, rootPath: string, query: string) => {
    return searchFiles(rootPath, query);
  });

  ipcMain.handle('file:getFilePreview', async (_, filePath: string) => {
    return getFilePreview(filePath);
  });

  ipcMain.handle('file:openFile', async (_, filePath: string) => {
    const err = await shell.openPath(filePath);
    if (err) throw new Error(err);
  });

  ipcMain.handle('file:getDrives', async () => {
    return getDrives();
  });

  ipcMain.handle('file:getStats', async (_, filePath: string) => {
    return getStats(filePath);
  });

  ipcMain.handle('file:hasSubdirectories', async (_, dirPath: string) => {
    return hasSubdirectories(dirPath);
  });

  ipcMain.handle('file:createFile', async (_, filePath: string) => {
    await createFile(filePath);
  });

  // Shell icons — returns base64 PNG data URL
  ipcMain.handle('file:getShellIcon', async (_, filePath: string) => {
    return getShellIcon(filePath);
  });

  // Open With
  ipcMain.handle('file:getOpenWithApps', async (_, ext: string) => {
    return getOpenWithApps(ext);
  });

  ipcMain.handle('file:openFileWith', async (_, filePath: string, exePath: string) => {
    await openFileWith(filePath, exePath);
  });

  ipcMain.handle('file:showOpenWithDialog', async (_, filePath: string) => {
    await showOpenWithDialog(filePath);
  });

  // Most-used folder tracking
  ipcMain.handle('nav:getMostUsed', (_, limit?: number) => {
    return getMostUsedFolders(limit ?? 8);
  });

  ipcMain.handle('nav:trackAccess', (_, dirPath: string) => {
    trackFolderAccess(dirPath);
  });

  // Settings handlers
  ipcMain.handle('settings:get', (_, key: string) => {
    return store.get(key as never);
  });

  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    store.set(key as never, value as never);
  });

  ipcMain.handle('settings:getAll', () => {
    return store.store;
  });

  ipcMain.handle('settings:getHomeDir', () => {
    return os.homedir();
  });

  ipcMain.handle('settings:getSpecialPaths', () => {
    const { app } = require('electron') as typeof import('electron');
    const safe = (name: Parameters<typeof app.getPath>[0], fallback: string) => {
      try { return app.getPath(name); } catch { return fallback; }
    };
    const home = os.homedir();
    return {
      home,
      desktop:   safe('desktop',   home + '\\Desktop'),
      downloads: safe('downloads', home + '\\Downloads'),
      documents: safe('documents', home + '\\Documents'),
      music:     safe('music',     home + '\\Music'),
      pictures:  safe('pictures',  home + '\\Pictures'),
    };
  });
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    height: 900,
    width: 1400,
    minHeight: 600,
    minWidth: 900,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f0f0f',
    icon: require('path').join(__dirname, '..', 'branchy.ico'),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  ipcMain.handle('window:minimize', () => mainWindow.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow.close());

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.on('ready', () => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
