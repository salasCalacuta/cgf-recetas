const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('costorecetasElectron', {
  saveExportFile: (folderPath, fileName, contents) =>
    ipcRenderer.invoke('save-export-file', { folderPath, fileName, contents }),
  pickExportFolder: () => ipcRenderer.invoke('pick-export-folder'),
})
