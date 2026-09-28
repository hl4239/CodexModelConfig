const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  pickCli: () => ipcRenderer.invoke('desktop:pick-cli'),
  openData: () => ipcRenderer.invoke('desktop:open-data'),
  exportConfig: kind => ipcRenderer.invoke('desktop:export', kind)
});
