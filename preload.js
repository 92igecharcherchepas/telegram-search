const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appApi', {
  getDashboard: () => ipcRenderer.invoke('getDashboard'),
  openDataFolder: () => ipcRenderer.invoke('openDataFolder'),
  openDbFolder: () => ipcRenderer.invoke('openDbFolder')
});
