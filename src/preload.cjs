const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dt', {
  onConfig: (fn) => ipcRenderer.on('config', (_e, cfg) => fn(cfg)),
  onPending: (fn) => ipcRenderer.on('pending', (_e, row) => fn(row)),
  onFonts: (fn) => ipcRenderer.on('fonts', (_e, dir) => fn(dir)),
  onLayout: (fn) => ipcRenderer.on('layout', (_e, l) => fn(l)),
  onSeen: (fn) => ipcRenderer.on('seen', (_e, s) => fn(s)),
  onLine: (fn) => ipcRenderer.on('line', (_e, row) => fn(row)),
  onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
});
