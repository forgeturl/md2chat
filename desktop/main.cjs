const {app,BrowserWindow,Menu,ipcMain,clipboard,ClipboardItem,nativeImage,shell,session,Tray,dialog}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {makePayload,pruneImages,RAW_FORMAT}=require('./payload.cjs');
const {createIntegration,startHidden}=require('./integration.cjs');
app.setName('md2chat');
let win,copying=false,quitting=false,integration;
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
function showWindow(){if(!win||win.isDestroyed())return;if(win.isMinimized())win.restore();win.show();win.focus();integration?.refreshApplicationMenu();}
app.on('second-instance',showWindow);
app.on('before-quit',()=>{quitting=true;});
app.on('will-quit',()=>integration?.destroy());
const entry=path.join(__dirname,'../editor.html'),entryURL=pathToFileURL(entry).href;
function trusted(event){if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==entryURL)throw new Error('不允许的调用来源');}
async function inspect(){
 const formats=[];let images=0;
 for(const item of await clipboard.read())for(const type of item.types){
  const blob=await item.getType(type);formats.push({type,bytes:blob.size||0});
  if(type===RAW_FORMAT){try{const data=JSON.parse(await blob.text());for(const c of data.contents||[])images+=(c.text?.items||[]).filter(i=>i.type==='image').length;}catch{}}
 }
 return {formats,images,platform:process.platform};
}
if(primaryInstance)app.whenReady().then(async()=>{
 const cache=path.join(app.getPath('userData'),'clipboard-images');
 // Do not inspect clipboard contents on startup. Keep image references alive while a DingTalk item exists.
 if(!await clipboard.has(RAW_FORMAT))await pruneImages(cache).catch(()=>{});
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 ipcMain.handle('md2chat:copy',async(event,parts)=>{
  trusted(event);if(copying)throw new Error('正在复制，请稍候');copying=true;
  try{
   const payload=await makePayload(parts,{directory:cache,nativeImage});
   const data={'text/plain':payload.plain,'text/html':payload.html};
   if(process.platform==='darwin')data[RAW_FORMAT]=new Blob([JSON.stringify(payload.rich)],{type:'application/json'});
   await clipboard.write([new ClipboardItem(data)]);
   if(process.platform==='darwin'&&!await clipboard.has(RAW_FORMAT))throw new Error('系统未保留钉钉图文格式');
   return {images:payload.imageCount,native:process.platform==='darwin'};
  }finally{copying=false;}
 });
 ipcMain.handle('md2chat:inspect',async event=>{trusted(event);return inspect();});
 function createWindow(){
  win=new BrowserWindow({width:1320,height:880,minWidth:760,minHeight:560,title:'md2chat · 贴贴 Markdown',show:false,icon:path.join(__dirname,'../assets/app-icon.png'),backgroundColor:'#f3f5f8',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\/(github\.com|forgeturl\.github\.io)\//.test(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.on('close',event=>{if(!quitting&&integration?.hasTray){event.preventDefault();win.hide();}});
  win.once('ready-to-show',()=>{if(!integration?.hasTray||!startHidden(app,process.platform,process.argv,process.execPath))showWindow();});
  win.loadFile(entry);
 }
 integration=createIntegration({app,Tray,Menu,nativeImage,dialog,showWindow});
 createWindow();app.on('activate',showWindow);
});
app.on('window-all-closed',()=>{if(!integration?.hasTray)app.quit();});
