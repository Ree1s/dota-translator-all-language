const { contextBridge, ipcRenderer } = require('electron');

// The say window's whole reach into the app: what language it will be,
// the line to translate, and close.
contextBridge.exposeInMainWorld('say', {
  state: () => ipcRenderer.invoke('say:state'),
  send: (text) => ipcRenderer.invoke('say:send', text),
  close: () => ipcRenderer.invoke('say:close'),
});
