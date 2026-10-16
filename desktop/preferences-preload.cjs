const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('md2chatPreferences', Object.freeze({
 get: () => ipcRenderer.invoke('md2chat:preferences-get'),
 set: patch => ipcRenderer.invoke('md2chat:preferences-set', patch)
}));
