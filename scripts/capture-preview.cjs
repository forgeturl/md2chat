// Run with Electron. Capture the real desktop UI without changing the clipboard.
const {app}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-preview-'));
app.setPath('userData',temporary);
const sample=[
 '# 项目小结（示例）','**下一步**：完成检查后，再安排发布。',
 '- [x] 明确需求','- [ ] 确认时间','',
 '| 阶段 | 安排 |','| --- | --- |','| 开发 | 本周完成 |','| 验证 | 发布前检查 |','',
 '```js','const message = "准备就绪";','console.log(message);','```','请确认后继续。'
].join('\n');
const timer=setTimeout(()=>{console.error('Desktop preview capture timed out');app.exit(1);},30000);
app.on('browser-window-created',(_event,window)=>{
 window.webContents.once('did-finish-load',async()=>{
  if(!window.webContents.getURL().endsWith('/editor.html'))return;
  try{
   window.setContentSize(1320,680);
   await window.webContents.executeJavaScript(`(async()=>{
    const input=document.getElementById('markdown-input');
    input.textContent=${JSON.stringify(sample)};
    input.dispatchEvent(new Event('input',{bubbles:true}));
    const deadline=Date.now()+15000;
    while(document.querySelector('[data-copy-target="dingtalk"]').disabled||!document.getElementById('message').textContent.includes('✅')){
     if(Date.now()>deadline)throw new Error('Preview did not finish');
     await new Promise(resolve=>setTimeout(resolve,100));
    }
    await Promise.all([...document.querySelectorAll('#message img')].map(image=>image.decode()));
    await document.fonts.ready;
    input.blur();window.getSelection().removeAllRanges();
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   })()`);
   const full=await window.webContents.capturePage();
   for(const file of ['assets/desktop-preview.png','docs/desktop-preview.png'])fs.writeFileSync(path.join(root,file),full.toPNG());
   for(const [selector,file] of [['.input-panel','assets/preview-before.png'],['.preview-panel','assets/preview-after.png']]){
    const bounds=await window.webContents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`);
    fs.writeFileSync(path.join(root,file),(await window.webContents.capturePage(bounds)).toPNG());
   }
   console.log('Captured desktop workspace and both panels from the current Electron app.');
   clearTimeout(timer);app.quit();
  }catch(error){console.error(error);app.exit(1);}
 });
});
app.once('will-quit',()=>fs.rmSync(temporary,{recursive:true,force:true}));
require('../desktop/main.cjs');
