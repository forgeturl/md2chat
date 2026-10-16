const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('md2chatDesktop',Object.freeze({
 platform:process.platform,
 copy:(parts,target='dingtalk')=>ipcRenderer.invoke('md2chat:copy',parts,target),
 copyWecomSegment:segment=>ipcRenderer.invoke('md2chat:copy-wecom-segment',segment),
 inspect:()=>ipcRenderer.invoke('md2chat:inspect'),
 onConvertClipboard:callback=>{
  const listener=async(_event,request)=>{
   try{const parts=await callback(request.content,request.target);ipcRenderer.send('md2chat:conversion-result',request.id,{parts});}
   catch(error){ipcRenderer.send('md2chat:conversion-result',request.id,{error:error?.message||'转换失败，请重试。'});}
  };
  ipcRenderer.on('md2chat:convert-clipboard',listener);
  ipcRenderer.send('md2chat:conversion-ready');
  return ()=>ipcRenderer.removeListener('md2chat:convert-clipboard',listener);
 },
 onWecomSegments:callback=>{
  const listener=(_event,request)=>{
   try{callback(request.parts);ipcRenderer.send('md2chat:conversion-result',request.id,{parts:[]});}
   catch(error){ipcRenderer.send('md2chat:conversion-result',request.id,{error:error?.message||'无法打开企微分段窗口，请重试。'});}
  };
  ipcRenderer.on('md2chat:open-wecom-segments',listener);
  return ()=>ipcRenderer.removeListener('md2chat:open-wecom-segments',listener);
 },
 updates:Object.freeze({
  status:()=>ipcRenderer.invoke('md2chat:update-status'),
  check:()=>ipcRenderer.invoke('md2chat:update-check'),
  download:()=>ipcRenderer.invoke('md2chat:update-download'),
  install:()=>ipcRenderer.invoke('md2chat:update-install'),
  subscribe:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('md2chat:update-state',listener);return ()=>ipcRenderer.removeListener('md2chat:update-state',listener);},
  onOpen:callback=>{const listener=()=>callback();ipcRenderer.on('md2chat:update-open',listener);return ()=>ipcRenderer.removeListener('md2chat:update-open',listener);}
 })
}));
