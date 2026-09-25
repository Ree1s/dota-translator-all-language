const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('composer', {
  state: () => ipcRenderer.invoke('composer:state'),
  translate: payload => ipcRenderer.invoke('composer:translate', payload),
  copy: () => ipcRenderer.invoke('composer:copy'),
  restore: () => ipcRenderer.invoke('composer:restore'),
  hide: () => ipcRenderer.invoke('composer:hide'),
  onOpen: cb => ipcRenderer.on('composer:open', (_e, state) => cb(state)),
});
