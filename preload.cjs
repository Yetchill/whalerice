const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('whale', {
  state: () => ipcRenderer.invoke('state'),
  save: value => ipcRenderer.invoke('save', value),
  setScale: value => ipcRenderer.invoke('setScale', value),
  refresh: () => ipcRenderer.invoke('refresh'),
  settings: () => ipcRenderer.invoke('settings'),
  contextMenu: () => ipcRenderer.invoke('contextMenu'),
  importKeyFile: () => ipcRenderer.invoke('importKeyFile'),
  subscribe: callback => {const handler = (_, state) => callback(state); ipcRenderer.on('update', handler); return () => ipcRenderer.removeListener('update', handler);}
});
