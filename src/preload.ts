import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('fileAPI', {
  listDirectory:     (p: string)                     => ipcRenderer.invoke('file:listDirectory', p),
  renameFile:        (o: string, n: string)           => ipcRenderer.invoke('file:renameFile', o, n),
  moveFiles:         (s: string[], d: string)         => ipcRenderer.invoke('file:moveFiles', s, d),
  copyFiles:         (s: string[], d: string)         => ipcRenderer.invoke('file:copyFiles', s, d),
  deleteFiles:       (p: string[])                    => ipcRenderer.invoke('file:deleteFiles', p),
  createFolder:      (p: string)                      => ipcRenderer.invoke('file:createFolder', p),
  createFile:        (p: string)                      => ipcRenderer.invoke('file:createFile', p),
  searchFiles:       (r: string, q: string)           => ipcRenderer.invoke('file:searchFiles', r, q),
  getFilePreview:    (p: string)                      => ipcRenderer.invoke('file:getFilePreview', p),
  openFile:          (p: string)                      => ipcRenderer.invoke('file:openFile', p),
  getDrives:         ()                               => ipcRenderer.invoke('file:getDrives'),
  getStats:          (p: string)                      => ipcRenderer.invoke('file:getStats', p),
  hasSubdirectories: (p: string)                      => ipcRenderer.invoke('file:hasSubdirectories', p),
  getShellIcon:      (p: string)                      => ipcRenderer.invoke('file:getShellIcon', p),
  getOpenWithApps:   (ext: string)                    => ipcRenderer.invoke('file:getOpenWithApps', ext),
  openFileWith:      (p: string, exe: string)         => ipcRenderer.invoke('file:openFileWith', p, exe),
  showOpenWithDialog:(p: string)                      => ipcRenderer.invoke('file:showOpenWithDialog', p),

  nav: {
    getMostUsed: (limit?: number) => ipcRenderer.invoke('nav:getMostUsed', limit),
    trackAccess: (p: string)      => ipcRenderer.invoke('nav:trackAccess', p),
  },

  settings: {
    get:             (key: string)               => ipcRenderer.invoke('settings:get', key),
    set:             (key: string, val: unknown) => ipcRenderer.invoke('settings:set', key, val),
    getAll:          ()                          => ipcRenderer.invoke('settings:getAll'),
    getHomeDir:      ()                          => ipcRenderer.invoke('settings:getHomeDir'),
    getSpecialPaths: ()                          => ipcRenderer.invoke('settings:getSpecialPaths'),
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close:    () => ipcRenderer.invoke('window:close'),
  },
});
