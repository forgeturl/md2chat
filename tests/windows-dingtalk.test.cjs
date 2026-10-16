const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {makePayload,pruneImages,RAW_FORMAT}=require('../desktop/payload.cjs');
const {inspectClipboard}=require('../desktop/clipboard-diagnostics.cjs');
const png=Buffer.from('89504e470d0a1a0a','hex');
const image={type:'image',src:'data:image/png;base64,'+png.toString('base64')};
const nativeImage={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:400,height:100}),toPNG:()=>png})};
async function fixture(platform='win32'){
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-win-copy-')),directory=path.join(userData,'clipboard-images');
 await fs.mkdir(directory);
 const writes=[];
 const clipboard={write:async items=>writes.push(items),has:async type=>writes.at(-1)?.some(item=>item.types.includes(type))||false,read:async()=>writes.at(-1)||[]};
 class ClipboardItem{constructor(data){this.data=data;this.types=Object.keys(data);}async getType(type){const data=this.data[type];return data instanceof Blob?data:new Blob([data],{type});}}
 const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8');
 const context={process:{platform},Blob,ClipboardItem,clipboard,RAW_FORMAT,pruneImages,path,app:{getPath:()=>userData}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('async function writePayload('),source.indexOf('if(primaryInstance)app.whenReady()')),context);
 return {directory,writes,clipboard,write:context.writePayload,cleanup:()=>fs.rm(userData,{recursive:true,force:true})};
}

test('Windows image copy writes only paragraph HTML, preserving two images around editable text',async()=>{
 const f=await fixture();
 try{
  const payload=await makePayload([{type:'text',text:'前文'},image,{type:'text',text:'中间'},image,{type:'text',text:'后文'}],{directory:f.directory,nativeImage,platform:'win32'});
  const result=await f.write(payload,'dingtalk');
  assert.deepEqual(f.writes[0][0].types,['text/html']);
  assert.equal(result.windowsHtml,true);assert.equal(result.native,false);assert.equal(result.images,2);
  const report=await inspectClipboard(f.clipboard,{platform:'win32'});
  assert.deepEqual(report.html[0].images.map(image=>image.source.kind),['file','file']);
  assert(report.html[0].images.every(image=>image.ancestors[0]==='p'));
  assert.equal(report.htmlImages,2);assert.equal(report.html[0].tags.p,5);
  assert(!payload.html.includes('[图片]'));assert(!payload.html.includes('data:image/'));
 }finally{await f.cleanup();}
});

test('Mac native copies, other targets and Windows text-only copies retain their representations',async()=>{
 for(const [platform,target,images,expected] of [
  ['darwin','dingtalk',1,['text/plain','text/html',RAW_FORMAT]],
  ['win32','wechat',1,['text/plain','text/html']],
  ['win32','dingtalk',0,['text/plain','text/html']]
 ]){
  const f=await fixture(platform);
  try{
   const payload=await makePayload(images?[{type:'text',text:'前文'},image]:[{type:'text',text:'纯文字'}],{directory:f.directory,nativeImage,platform,target});
   await f.write(payload,target);assert.deepEqual(f.writes[0][0].types,expected);
  }finally{await f.cleanup();}
 }
});

test('a clipboard write failure keeps image cache intact and never reports success',async()=>{
 const f=await fixture();
 try{
  const payload=await makePayload([image],{directory:f.directory,nativeImage,platform:'win32'});
  const files=await fs.readdir(f.directory);assert.equal(files.length,1);
  f.clipboard.write=async()=>{throw new Error('write denied');};
  await assert.rejects(()=>f.write(payload,'dingtalk'),/write denied/);
  assert.deepEqual(await fs.readdir(f.directory),files);
 }finally{await f.cleanup();}
});

test('Windows cache pruning waits until a successful explicit copy replaces the previous clipboard',async()=>{
 const f=await fixture();
 try{
  const old=path.join(f.directory,'a'.repeat(64)+'.png');await fs.writeFile(old,png);await fs.utimes(old,new Date(0),new Date(0));
  const payload=await makePayload([image],{directory:f.directory,nativeImage,platform:'win32'});
  const write=f.clipboard.write;f.clipboard.write=async items=>{assert.deepEqual(await fs.readFile(old),png);return write(items);};
  await f.write(payload,'dingtalk');await assert.rejects(()=>fs.stat(old),{code:'ENOENT'});
  const current=payload.rich.contents[0].text.items[0].data.path;assert.deepEqual(await fs.readFile(current),png);
 }finally{await f.cleanup();}
});

test('Windows editor paste delegates file HTML to the restricted cache reader while other inputs stay local',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../assets/app.js'),'utf8'),calls=[];
 const context={window:{md2chatDesktop:{platform:'win32',resolveClipboardHtml:async html=>{calls.push(html);return '<img src="data:image/png;base64,AAAA">';}}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function readableClipboardHtml('),source.indexOf("input.addEventListener('paste'")),context);
 const html='<p><img src="file:///managed-cache.png"></p>';
 assert.match(await context.readableClipboardHtml(html),/data:image/);assert.deepEqual(calls,[html]);
 const remote='<img src="https://example.com/image.png">';assert.equal(await context.readableClipboardHtml(remote),remote);assert.equal(calls.length,1);
 context.window.md2chatDesktop.platform='darwin';assert.equal(await context.readableClipboardHtml(html),html);assert.equal(calls.length,1);
});

test('cache-reader IPC rejects foreign frames and overlapping copies before reading files',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8'),calls=[];let handler;
 const context={copying:false,clipboardConversion:{busy:false},cache:'/managed-cache',trusted:event=>{if(event!=='trusted')throw new Error('untrusted');},resolveCachedHtmlImages:async(html,options)=>{calls.push({html,options});return 'resolved';},ipcMain:{handle:(_name,fn)=>{handler=fn;}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf("ipcMain.handle('md2chat:resolve-clipboard-html'"),source.indexOf(' conversionBridge=createConversionBridge')),context);
 await assert.rejects(()=>handler('foreign','html'),/untrusted/);assert.equal(calls.length,0);
 context.copying=true;await assert.rejects(()=>handler('trusted','html'),/稍候/);context.copying=false;
 context.clipboardConversion.busy=true;await assert.rejects(()=>handler('trusted','html'),/稍候/);context.clipboardConversion.busy=false;
 assert.equal(await handler('trusted','html'),'resolved');assert.equal(calls[0].options.imageDirectory,'/managed-cache');
});
