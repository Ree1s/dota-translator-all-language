const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dt', {
  onConfig: (fn) => ipcRenderer.on('config', (_e, cfg) => fn(cfg)),
  onLine: (fn) => ipcRenderer.on('line', (_e, row) => fn(row)),
  onStatus: (fn) => ipcRenderer.on('status', (_e, s) => fn(s)),
});
