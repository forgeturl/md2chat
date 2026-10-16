const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('md2chatDesktop',Object.freeze({
 platform:process.platform,
 copy:(parts,target='dingtalk')=>ipcRenderer.invoke('md2chat:copy',parts,target),
 inspect:()=>ipcRenderer.invoke('md2chat:inspect'),
 updates:Object.freeze({
  status:()=>ipcRenderer.invoke('md2chat:update-status'),
  check:()=>ipcRenderer.invoke('md2chat:update-check'),
  download:()=>ipcRenderer.invoke('md2chat:update-download'),
  install:()=>ipcRenderer.invoke('md2chat:update-install'),
  subscribe:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('md2chat:update-state',listener);return ()=>ipcRenderer.removeListener('md2chat:update-state',listener);},
  onOpen:callback=>{const listener=()=>callback();ipcRenderer.on('md2chat:update-open',listener);return ()=>ipcRenderer.removeListener('md2chat:update-open',listener);}
 })
}));
