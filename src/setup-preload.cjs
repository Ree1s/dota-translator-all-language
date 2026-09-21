const { contextBridge, ipcRenderer } = require('electron');

// The setup window's whole reach into the app: ask what is set, try and
// save a key, open the guide, close. The key crosses this bridge once, on
// its way to be checked, and is never handed back.
contextBridge.exposeInMainWorld('setup', {
  state: () => ipcRenderer.invoke('setup:state'),
  save: (payload) => ipcRenderer.invoke('setup:save', payload),
  guide: () => ipcRenderer.invoke('setup:guide'),
  close: () => ipcRenderer.invoke('setup:close'),
  fit: () => ipcRenderer.invoke('setup:fit'),
  folder: () => ipcRenderer.invoke('setup:folder'),
  sayInto: (which) => ipcRenderer.invoke('setup:sayInto', which),
});
