const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('md2chatDesktop',Object.freeze({
 platform:process.platform,
 copy:(parts,target='dingtalk')=>ipcRenderer.invoke('md2chat:copy',parts,target),
 inspect:()=>ipcRenderer.invoke('md2chat:inspect')
}));
