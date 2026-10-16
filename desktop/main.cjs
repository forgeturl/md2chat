const {app,BrowserWindow,Menu,ipcMain,clipboard,ClipboardItem,nativeImage,shell,session,Tray,dialog,Notification}=require('electron');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {makePayload,pruneImages,RAW_FORMAT,validateParts}=require('./payload.cjs');
const {makeWecomSegmentData}=require('./wecom-segment.cjs');
const {createIntegration,startHidden,loginState,setLogin}=require('./integration.cjs');
const {createPreferences}=require('./preferences.cjs');
const {createUpdates}=require('./updates.cjs');
const {createClipboardConversion,createConversionBridge,makeClipboardImageData,resolveCachedHtmlImages}=require('./clipboard-conversion.cjs');
const {profile}=require('../assets/chat-targets.js');
const {inspectClipboard}=require('./clipboard-diagnostics.cjs');
const {runDingtalkHtmlTest}=require('./dingtalk-html-test.cjs');
const {writeClipboardPayload}=require('./clipboard-write.cjs');
const {readLocalImage}=require('./local-images.cjs');
const {RAW_FORMAT:FEISHU_RAW_FORMAT}=require('./feishu.cjs');
app.setName('md2chat');
let win,copying=false,quitting=false,integration,updates,clipboardConversion,conversionBridge,preferences;
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
function showWindow(){if(!win||win.isDestroyed())return;if(win.webContents.isCrashed())void win.loadFile(entry);if(win.isMinimized())win.restore();win.show();win.focus();integration?.refreshApplicationMenu();}
app.on('second-instance',showWindow);
app.on('before-quit',()=>{quitting=true;});
// Native updater closes windows before app.before-quit; bypass tray hiding first.
require('electron').autoUpdater.on('before-quit-for-update',()=>{quitting=true;});
app.on('will-quit',()=>{integration?.destroy();updates?.destroy();conversionBridge?.destroy();preferences?.destroy();});
const entry=path.join(__dirname,'../editor.html'),entryURL=pathToFileURL(entry).href;
function trusted(event){if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==entryURL)throw new Error('不允许的调用来源');}
async function inspect(){
 return inspectClipboard(clipboard,{platform:process.platform,version:app.getVersion()});
}
async function writePayload(payload,target){
 return writeClipboardPayload(payload,{target,platform:process.platform,clipboard,ClipboardItem,imageDirectory:path.join(app.getPath('userData'),'clipboard-images')});
}
if(primaryInstance)app.whenReady().then(async()=>{
 const {autoUpdater}=require('electron-updater');
 const notified=new Set();
 function openUpdates(){showWindow();win?.webContents.send('md2chat:update-open');void updates.check();}
 updates=createUpdates({updater:autoUpdater,version:app.getVersion(),available:()=>{
  if(!app.isPackaged)return '开发模式不安装更新，请使用已发布的桌面版。';
  if(process.platform==='darwin'&&!app.isInApplicationsFolder())return '请先把 md2chat 移到「应用程序」，再检查更新。';
  return ['darwin','win32'].includes(process.platform)?'':'当前系统不支持应用内更新。';
 },publish:state=>{
  if(win&&!win.isDestroyed())win.webContents.send('md2chat:update-state',state);
  if(state.phase==='available'&&!notified.has(state.version)){
   notified.add(state.version);
   if(Notification.isSupported()){
    const notice=new Notification({title:'md2chat 有新版本',body:`v${state.version} 已发布，点击查看更新内容。`});
    notice.on('click',openUpdates);notice.show();
   }
  }
 },confirmInstall:async()=>{
  showWindow();
  if(copying||clipboardConversion?.busy)return false;
  const result=await dialog.showMessageBox(win,{type:'question',title:'重启并安装更新',message:'现在安装新版 md2chat？',detail:'应用将退出并重新打开。当前输入不会保存，请先复制或保存需要的内容。',buttons:['取消','重启并安装'],defaultId:0,cancelId:0,noLink:true});
  return result.response===1;
 }});
 for(const action of ['check','download','install'])ipcMain.handle(`md2chat:update-${action}`,async event=>{trusted(event);return updates[action]();});
 ipcMain.handle('md2chat:update-status',event=>{trusted(event);return updates.snapshot();});
 const cache=path.join(app.getPath('userData'),'clipboard-images');
 // Do not read clipboard content on startup. Native Mac fragments can still
 // reference cached PNGs; defer cleanup while their representation is present.
 // Windows cleanup happens after the next successful DingTalk copy.
 if(process.platform!=='win32'&&!await clipboard.has(RAW_FORMAT)&&!await clipboard.has(FEISHU_RAW_FORMAT))await pruneImages(cache).catch(()=>{});
 session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 session.defaultSession.setPermissionCheckHandler(()=>false);
 ipcMain.handle('md2chat:copy',async(event,parts,target='dingtalk')=>{
  trusted(event);if(copying||clipboardConversion?.busy)throw new Error('正在转换或复制，请稍候');copying=true;
  try{
   if(target==='wecom'&&Array.isArray(parts)&&parts.some(part=>part?.type==='image'))throw new Error('企微图文请使用分段复制，按顺序粘贴文字和图片。');
   const payload=await makePayload(parts,{directory:cache,nativeImage,target,platform:process.platform});
   return await writePayload(payload,target);
  }finally{copying=false;}
 });
 ipcMain.handle('md2chat:copy-wecom-segment',async(event,segment)=>{
  trusted(event);if(copying||clipboardConversion?.busy)throw new Error('正在转换或复制，请稍候');copying=true;
  try{
   const {data,type}=await makeWecomSegmentData(segment,{nativeImage});
   await clipboard.write([new ClipboardItem(data)]);
   return {type};
  }finally{copying=false;}
 });
 ipcMain.handle('md2chat:inspect',async event=>{trusted(event);return inspect();});
 ipcMain.handle('md2chat:read-local-image',async(event,source)=>{
  trusted(event);return readLocalImage(source,{nativeImage});
 });
 ipcMain.handle('md2chat:resolve-clipboard-html',async(event,html)=>{
  trusted(event);if(copying||clipboardConversion?.busy)throw new Error('正在转换或复制，请稍候');
  return resolveCachedHtmlImages(html,{imageDirectory:cache});
 });
 conversionBridge=createConversionBridge({ipcMain,trusted,getWebContents:()=>win?.webContents});
 ipcMain.handle('md2chat:test-dingtalk-html',async(event,mode)=>{
  trusted(event);if(copying||clipboardConversion?.busy)throw new Error('正在转换或复制，请稍候');copying=true;
  try{return await runDingtalkHtmlTest(mode,{clipboard,ClipboardItem,platform:process.platform});}
  finally{copying=false;}
 });
 clipboardConversion=createClipboardConversion({clipboard,imageDirectory:cache,render:async(content,target)=>{
  if(win?.webContents.isCrashed())await win.loadFile(entry);
  return conversionBridge.render(content,target);
 },prepare:async(parts,target)=>{
  if(target==='image')return {imageData:await makeClipboardImageData(parts,{nativeImage})};
  validateParts(parts,target);
  if(target==='wecom'&&parts.some(part=>part.type==='image'))return {segments:parts};
  return makePayload(parts,{directory:cache,nativeImage,target,platform:process.platform});
 },write:async(payload,target)=>{
  if(target==='image'){
   await clipboard.write([new ClipboardItem(payload.imageData)]);
   return {images:1,target};
  }
  if(payload.segments){
   showWindow();await conversionBridge.openWecomSegments(payload.segments);
   return {segmented:true,target};
  }
  return writePayload(payload,target);
 },isCopying:()=>copying});
 async function convertClipboard(target){
  try{
   const result=await clipboardConversion.convert(target);
   if(result.segmented)return;
   const body=target==='image'?'已转为图片并写入剪贴板，可以直接粘贴。':result.feishuNative?'已转为飞书图文，请先展开飞书富文本输入框，再一次粘贴。':'已转为'+profile(target).label+'格式并写入剪贴板，请到'+(target==='email'?'邮件编辑器':'对应聊天框')+'粘贴。';
   if(Notification.isSupported())new Notification({title:'剪贴板转换完成',body}).show();
   else await dialog.showMessageBox({type:'info',title:'剪贴板转换完成',message:body});
  }catch(error){await dialog.showMessageBox({type:'error',title:'剪贴板转换未完成',message:error.message});}
 }
 function createWindow(){
  win=new BrowserWindow({width:1320,height:880,minWidth:760,minHeight:560,title:'md2chat · 贴贴 Markdown',show:false,icon:path.join(__dirname,'../assets/app-icon.png'),backgroundColor:'#f4f6f4',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false,backgroundThrottling:false}});
  win.webContents.on('did-start-loading',()=>conversionBridge.reset());
  win.webContents.on('render-process-gone',()=>conversionBridge.reset('转换器异常退出，请重新选择转换格式重试。'));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\/(github\.com|forgeturl\.github\.io)\//.test(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.on('close',event=>{if(!quitting&&integration?.hasTray){event.preventDefault();win.hide();}});
  win.once('ready-to-show',()=>{if(!integration?.hasTray||!startHidden(app,process.platform,process.argv,process.execPath))showWindow();});
  win.loadFile(entry);
 }
 preferences=await createPreferences({app,BrowserWindow,ipcMain,nativeImage,
  getLoginState:()=>loginState(app,process.platform,process.execPath),
  setLoginState:enabled=>setLogin(app,process.platform,process.execPath,enabled),
  onChange:()=>integration?.refreshTray()
 });
 integration=createIntegration({app,Tray,Menu,nativeImage,dialog,showWindow,openPreferences:()=>preferences.open(),getPreferences:()=>preferences.snapshot(),checkUpdates:openUpdates,convertClipboard,convertClipboardToImage:()=>convertClipboard('image'),getClipboardConversionState:()=>({busy:copying||clipboardConversion.busy})});
 createWindow();app.on('activate',showWindow);
 updates.start();
});
app.on('window-all-closed',()=>{if(!integration?.hasTray)app.quit();});
