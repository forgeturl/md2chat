const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('md2chatDesktop',Object.freeze({
 platform:process.platform,
 copy:parts=>ipcRenderer.invoke('md2chat:copy',parts),
 inspect:()=>ipcRenderer.invoke('md2chat:inspect')
}));
