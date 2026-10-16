const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const os=require('node:os'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {makePayload}=require('../desktop/payload.cjs');
const {readClipboardSource,resolveCachedHtmlImages,createClipboardConversion,createConversionBridge,makeClipboardImageData}=require('../desktop/clipboard-conversion.cjs');
const item=data=>({types:Object.keys(data),getType:async type=>new Blob([data[type]],{type})});
function fixture(initial={'text/plain':'# 示例'}){
 let current=[item(initial)];const calls=[];
 const clipboard={read:async()=>current};
 const options={clipboard,render:async(content,target)=>{calls.push({content,target});return [{type:'text',text:'【示例】'}];},prepare:async(parts,target)=>({parts,target}),write:async payload=>{calls.push({written:payload});return {images:0};}};
 return {calls,options,set:data=>{current=[item(data)];}};
}
test('conversion reads standard clipboard data and writes the selected target only after rendering',async()=>{
 const f=fixture({'text/plain':'# 示例','text/html':'<p># 示例</p>','image/png':Buffer.from([137,80,78,71])});
 const flow=createClipboardConversion(f.options);
 await flow.convert('wechat');
 assert.equal(f.calls[0].target,'wechat');assert.equal(f.calls[0].content[0].plain,'# 示例');
 assert.match(f.calls[0].content[0].images[0],/^data:image\/png;base64,/);
 assert.equal(f.calls[1].written.target,'wechat');assert.equal(flow.busy,false);
 await assert.rejects(()=>flow.convert('unknown'),/不支持/);assert.equal(f.calls.length,2);
});
test('empty, unreadable, unsupported and oversized clipboard content never writes output',async()=>{
 for(const data of [{},{'text/plain':' \n\t'},{'text/rtf':'{\\rtf1 sample}'},{'image/png':Buffer.alloc(10*1024*1024+1)},{'text/plain':'x'.repeat(8*1024*1024+1)}]){
  const f=fixture(data),flow=createClipboardConversion(f.options);
  await assert.rejects(()=>flow.convert('email'));assert.equal(f.calls.length,0);assert.equal(flow.busy,false);
 }
 const f=fixture();f.options.clipboard.read=async()=>{throw new Error('read denied');};
 await assert.rejects(()=>createClipboardConversion(f.options).convert('wechat'),/read denied/);assert.equal(f.calls.length,0);
});
test('render and prepare failures preserve input and allow retry',async()=>{
 for(const stage of ['render','prepare']){
  const f=fixture(),original=f.options[stage];let fail=true;
  f.options[stage]=async(...args)=>{if(fail)throw new Error('failed '+stage);return original(...args);};
  const flow=createClipboardConversion(f.options);
  await assert.rejects(()=>flow.convert('dingtalk'),new RegExp('failed '+stage));
  assert(!f.calls.some(c=>c.written));assert.equal(flow.busy,false);
  fail=false;
  await flow.convert('dingtalk');assert(f.calls.some(c=>c.written));
 }
});
test('newly copied text or image data during conversion is retained',async()=>{
 for(const data of [{'text/plain':'new copy'},{'text/plain':'# 示例','image/png':Buffer.from('new image')}]){
  const f=fixture();f.options.prepare=async()=>{f.set(data);return {};};
  const flow=createClipboardConversion(f.options);
  await assert.rejects(()=>flow.convert('wechat'),/剪贴板已更新/);
  assert(!f.calls.some(c=>c.written));assert.equal(flow.busy,false);
 }
});
test('concurrent tray conversion and editor copy are rejected until the active request finishes',async()=>{
 const f=fixture();let release;
 f.options.render=()=>new Promise(resolve=>{release=resolve;});
 const flow=createClipboardConversion(f.options),first=flow.convert('wechat');
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(flow.busy,true);await assert.rejects(()=>flow.convert('email'),/稍候/);
 await assert.rejects(()=>flow.convert('image'),/稍候/);
 release([{type:'text',text:'ready'}]);await first;assert.equal(flow.busy,false);
 const busy=createClipboardConversion({...f.options,isCopying:()=>true});
 await assert.rejects(()=>busy.convert('wechat'),/稍候/);assert.equal(busy.busy,false);
});
test('image conversion shares clipboard-change protection and the conversion lock',async()=>{
 const f=fixture(),flow=createClipboardConversion(f.options);
 await flow.convert('image');assert.equal(f.calls[0].target,'image');assert.equal(f.calls[1].written.target,'image');
 f.options.prepare=async()=>{f.set({'text/plain':'new copy'});return {};};
 const changed=createClipboardConversion(f.options);
 await assert.rejects(()=>changed.convert('image'),/剪贴板已更新/);assert.equal(changed.busy,false);
 const busy=createClipboardConversion({...f.options,isCopying:()=>true});
 await assert.rejects(()=>busy.convert('image'),/稍候/);
});
test('image output accepts exactly one normalized PNG without competing text representations',async()=>{
 const nativeImage={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:16,height:24}),toPNG:()=>Buffer.from('PNG bytes')})};
 const png={type:'image',src:'data:image/png;base64,AAAA'};
 const data=await makeClipboardImageData([png],{nativeImage});
 assert.deepEqual(Object.keys(data),['image/png']);assert.equal(await data['image/png'].text(),'PNG bytes');
 for(const parts of [[],[png,png],[{type:'text',text:'no image'}],[{type:'image',src:'https://example.com/image.png'}],[{type:'image',src:'data:image/jpeg;base64,AAAA'}]]){
  await assert.rejects(()=>makeClipboardImageData(parts,{nativeImage}),/完整的 PNG/);
 }
});
test('desktop image conversion writes only the generated image and keeps the editor hidden',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8'),writes=[];
 const clipboard={read:async()=>[item({'text/plain':'# Example'})],write:async items=>{writes.push(items);}};
 const ctx={createClipboardConversion,makeClipboardImageData,clipboard,cache:'/unused-image-cache',win:{webContents:{isCrashed:()=>false}},conversionBridge:{render:async(_content,target)=>{assert.equal(target,'image');return [{type:'image',src:'data:image/png;base64,AAAA'}];}},nativeImage:{createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:16,height:24}),toPNG:()=>Buffer.from('PNG bytes')})},ClipboardItem:class{constructor(data){this.data=data;}},copying:false,showWindow(){assert.fail('image conversion should stay in the background');},validateParts(){assert.fail('image is not a platform profile');},makePayload(){assert.fail('image output should not create rich text or cached files');}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('clipboardConversion=createClipboardConversion('),source.indexOf(' async function convertClipboard(')),ctx);
 const result=await ctx.clipboardConversion.convert('image');
 assert.equal(result.images,1);assert.equal(result.target,'image');assert.equal(writes.length,1);
 assert.deepEqual(Object.keys(writes[0][0].data),['image/png']);assert.equal(await writes[0][0].data['image/png'].text(),'PNG bytes');
});
test('private representations are never read and changes to supported image bytes are detected',async()=>{
 const first=item({'text/plain':'sample','image/png':'one','image/jpeg':'unused','private/format':'secret'});
 const read=[];const get=first.getType;first.getType=type=>{read.push(type);return get(type);};
 const a=await readClipboardSource({read:async()=>[first]});
 assert.deepEqual(read,['text/plain','image/png']);
 const b=await readClipboardSource({read:async()=>[item({'text/plain':'sample','image/png':'two','image/jpeg':'unused','private/format':'secret'})]});
 assert.notEqual(a.fingerprint,b.fingerprint);
});
test('WeCom image-file references without image bytes cannot silently become text-only output',async()=>{
 const f=fixture({'text/plain':'synthetic before and after','text/uri-list':'file:///synthetic-test/image.png','electron application/osclipboard;format="WWKPrivatePBDataKey_Rich"':'synthetic identity'});
 await assert.rejects(()=>createClipboardConversion(f.options).convert('wecom'),/图片只有文件引用/);
 assert.equal(f.calls.length,0);
});
const cachePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYfkAAAAASUVORK5CYII=','base64');
const cacheName=bytes=>crypto.createHash('sha256').update(bytes).digest('hex')+'.png';
const cachedHtml=(directory,name=cacheName(cachePng))=>'<article><p><img src="'+pathToFileURL(path.join(directory,name)).href.replaceAll('&','&amp;')+'" width="1" height="1"></p></article>';
test('Windows DingTalk HTML-only output can be converted again to image, WeChat and email using its managed cache',async()=>{
 const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'md2chat cached & images-'));
 const nativeImage={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:1,height:1}),toPNG:()=>cachePng})};
 const png='data:image/png;base64,'+cachePng.toString('base64');
 try{
  const original=await makePayload([{type:'text',text:'前文'},{type:'image',src:png},{type:'text',text:'中间'},{type:'image',src:png},{type:'text',text:'后文'}],{directory,nativeImage,platform:'win32'});
  assert(original.html.includes('file:'));assert(original.html.includes('&amp;'));
  const clipboard={read:async()=>[item({'text/html':original.html})]};
  const source=await readClipboardSource(clipboard,{imageDirectory:directory});
  assert(!source.content[0].html.includes('file:'));assert.equal((source.content[0].html.match(/data:image\/png;base64,/g)||[]).length,2);
  assert.equal((await readClipboardSource(clipboard,{imageDirectory:directory})).fingerprint,source.fingerprint);
  assert.notEqual((await readClipboardSource(clipboard)).fingerprint,source.fingerprint);
  for(const target of ['image','wechat','email']){
   const writes=[];
   const flow=createClipboardConversion({clipboard,imageDirectory:directory,render:async(content,selected)=>{
    assert.equal(selected,target);assert(!content[0].html.includes('file:'));assert(content[0].html.includes(png));
    return target==='image'?[{type:'image',src:png}]:[{type:'text',text:'前文'},{type:'image',src:png},{type:'text',text:'中间'},{type:'image',src:png},{type:'text',text:'后文'}];
   },prepare:async(parts,selected)=>selected==='image'?{imageData:await makeClipboardImageData(parts,{nativeImage})}:makePayload(parts,{directory,nativeImage,target:selected,platform:'win32'}),write:async payload=>{writes.push(payload);return {target};}});
   assert.deepEqual(await flow.convert(target),{target});assert.equal(writes.length,1);assert.equal(flow.busy,false);
   if(target==='image')assert.deepEqual(Buffer.from(await writes[0].imageData['image/png'].arrayBuffer()),cachePng);
   else assert.equal((writes[0].html.match(/data:image\/png;base64,/g)||[]).length,2);
  }
 }finally{await fs.promises.rm(directory,{recursive:true,force:true});}
});
test('managed-cache resolver leaves unrelated file references untouched without filesystem access',async t=>{
 for(const method of ['lstat','open','readFile','realpath'])t.mock.method(fs.promises,method,async()=>assert.fail('external files must not be inspected or read'));
 const html='<img src="file:///outside/private.png"><img src="file:///managed-cache-sibling/'+cacheName(cachePng)+'">';
 assert.equal(await resolveCachedHtmlImages(html,{imageDirectory:'/managed-cache'}),html);
 assert.equal(await resolveCachedHtmlImages(html),html);
});
test('managed-cache resolver rejects missing, non-PNG, mismatched, oversized and escaped cache entries',async()=>{
 const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'md2chat-cache-validation-'));
 try{
  await assert.rejects(()=>resolveCachedHtmlImages(cachedHtml(directory),{imageDirectory:directory}),/缓存图片/);
  const outside=cachedHtml(directory,'../'+cacheName(cachePng));assert.equal(await resolveCachedHtmlImages(outside,{imageDirectory:directory}),outside);
  const prefix=pathToFileURL(directory+path.sep).href;
  for(const suffix of ['../'+cacheName(cachePng),'%2e%2e/'+cacheName(cachePng),cacheName(cachePng)+'?outside=1',cacheName(cachePng)+'#fragment']){
   await assert.rejects(()=>resolveCachedHtmlImages('<img src="'+prefix+suffix+'">',{imageDirectory:directory}),/缓存图片/);
  }
  const nonPng=Buffer.from('not a PNG');await fs.promises.writeFile(path.join(directory,cacheName(nonPng)),nonPng);
  await assert.rejects(()=>resolveCachedHtmlImages(cachedHtml(directory,cacheName(nonPng)),{imageDirectory:directory}),/PNG/);
  await fs.promises.writeFile(path.join(directory,'a'.repeat(64)+'.png'),cachePng);
  await assert.rejects(()=>resolveCachedHtmlImages(cachedHtml(directory,'a'.repeat(64)+'.png'),{imageDirectory:directory}),/校验/);
  const oversized=path.join(directory,'b'.repeat(64)+'.png');await fs.promises.writeFile(oversized,'');await fs.promises.truncate(oversized,15*1024*1024+1);
  await assert.rejects(()=>resolveCachedHtmlImages(cachedHtml(directory,path.basename(oversized)),{imageDirectory:directory}),/15 MB/);
  const subdirectory=path.join(directory,'c'.repeat(64)+'.png');await fs.promises.mkdir(subdirectory);
  await assert.rejects(()=>resolveCachedHtmlImages(cachedHtml(directory,path.basename(subdirectory)),{imageDirectory:directory}),/普通文件/);
 }finally{await fs.promises.rm(directory,{recursive:true,force:true});}
});
test('managed-cache resolver rejects symlinks before opening the linked image',async t=>{
 const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'md2chat-cache-symlink-'));
 try{
  const target=path.join(directory,'original.png'),link=path.join(directory,cacheName(cachePng));await fs.promises.writeFile(target,cachePng);
  try{await fs.promises.symlink(target,link);}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('symbolic links are unavailable for this account');return;}throw error;}
  const open=t.mock.method(fs.promises,'open',async()=>assert.fail('a cache symlink must never be opened'));
  await assert.rejects(()=>resolveCachedHtmlImages(cachedHtml(directory),{imageDirectory:directory}),/符号链接/);
  assert.equal(open.mock.calls.length,0);
 }finally{await fs.promises.rm(directory,{recursive:true,force:true});}
});
test('managed-cache resolver bounds HTML and all referenced PNG bytes even outside clipboard conversion',async()=>{
 await assert.rejects(()=>resolveCachedHtmlImages('x'.repeat(8*1024*1024+1)),/HTML.*过长/);
 const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'md2chat-cache-budget-'));
 try{
  const bytes=Buffer.alloc(11*1024*1024);cachePng.copy(bytes,0,0,8);const name=cacheName(bytes);
  await fs.promises.writeFile(path.join(directory,name),bytes);
  await assert.rejects(()=>resolveCachedHtmlImages(cachedHtml(directory,name).repeat(6),{imageDirectory:directory}),/过大/);
  await assert.rejects(()=>readClipboardSource({read:async()=>[item({'text/html':cachedHtml(directory,name).repeat(6)})]},{imageDirectory:directory}),/过大/);
  await assert.rejects(()=>readClipboardSource({read:async()=>[item({'text/html':cachedHtml(directory,name).repeat(5),'image/png':Buffer.alloc(6*1024*1024)})]},{imageDirectory:directory}),/过大/);
 }finally{await fs.promises.rm(directory,{recursive:true,force:true});}
});
test('managed cache changes during rendering prevent writeback and release the conversion lock',async()=>{
 const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'md2chat-cache-change-'));
 try{
  const file=path.join(directory,cacheName(cachePng));await fs.promises.writeFile(file,cachePng);
  const f=fixture({'text/html':cachedHtml(directory)});f.options.imageDirectory=directory;
  f.options.prepare=async()=>{await fs.promises.writeFile(file,Buffer.concat([cachePng,Buffer.from('changed')]));return {};};
  const flow=createClipboardConversion(f.options);
  await assert.rejects(()=>flow.convert('wechat'),/缓存图片.*校验/);assert(!f.calls.some(call=>call.written));assert.equal(flow.busy,false);
 }finally{await fs.promises.rm(directory,{recursive:true,force:true});}
});
function bridgeFixture(timeoutMs=1000){
 const ipcMain=new EventEmitter(),sent=[];const sender={isDestroyed:()=>false,send:(...args)=>sent.push(args)};
 const event={sender},bridge=createConversionBridge({ipcMain,trusted:e=>{if(e.sender!==sender)throw new Error('untrusted');},getWebContents:()=>sender,timeoutMs});
 return {ipcMain,sent,event,bridge};
}
test('conversion waits for the renderer and ignores untrusted or stale IPC replies',async()=>{
 const f=bridgeFixture();
 try{
  const result=f.bridge.render([{plain:'sample'}],'email');
  assert.equal(f.sent.length,0);
  f.ipcMain.emit('md2chat:conversion-ready',{sender:{}});assert.equal(f.sent.length,0);
  f.ipcMain.emit('md2chat:conversion-ready',f.event);assert.equal(f.sent.length,1);
  const request=f.sent[0][1];assert.equal(request.target,'email');
  f.ipcMain.emit('md2chat:conversion-result',{sender:{}},request.id,{parts:['untrusted']});
  f.ipcMain.emit('md2chat:conversion-result',f.event,request.id+1,{parts:['stale']});
  f.ipcMain.emit('md2chat:conversion-result',f.event,request.id,{parts:[{type:'text',text:'ready'}]});
  assert.deepEqual(await result,[{type:'text',text:'ready'}]);
 }finally{f.bridge.destroy();}
});
test('renderer timeout, reload and error release the request and reject late replies',async()=>{
 const f=bridgeFixture(15);
 try{
  await assert.rejects(()=>f.bridge.render([],'wechat'),/超时/);
  const reload=f.bridge.render([],'wechat');f.bridge.reset();await assert.rejects(()=>reload,/重新加载/);
  const failed=f.bridge.render([],'wechat');f.ipcMain.emit('md2chat:conversion-ready',f.event);
  const id=f.sent.at(-1)[1].id;
  f.ipcMain.emit('md2chat:conversion-result',f.event,id-1,{parts:[]});
  f.ipcMain.emit('md2chat:conversion-result',f.event,id,{error:'invalid formula'});
  await assert.rejects(()=>failed,/invalid formula/);
 }finally{f.bridge.destroy();}
 assert.equal(f.ipcMain.listenerCount('md2chat:conversion-ready'),0);
});
test('tray WeCom panel waits for a trusted acknowledgement and surfaces an already-open panel error',async()=>{
 const f=bridgeFixture();
 try{
  f.ipcMain.emit('md2chat:conversion-ready',f.event);
  const parts=[{type:'text',text:'before'},{type:'image',src:'data:image/png;base64,AAAA'}];
  const first=f.bridge.openWecomSegments(parts),request=f.sent.at(-1);
  assert.equal(request[0],'md2chat:open-wecom-segments');assert.deepEqual(request[1].parts,parts);
  f.ipcMain.emit('md2chat:conversion-result',f.event,request[1].id,{parts:[]});await first;
  const duplicate=f.bridge.openWecomSegments(parts);
  f.ipcMain.emit('md2chat:conversion-result',f.event,f.sent.at(-1)[1].id,{error:'请先关闭当前企微分段窗口'});
  await assert.rejects(()=>duplicate,/先关闭/);
 }finally{f.bridge.destroy();}
});
test('tray renderer uses isolated image assets and selects email table segments without changing editor state',async()=>{
 const code=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8'),seen=[];
 const editorAssets=new Map([['1',{src:'editor-image'}]]),segments=[{type:'image',src:'clipboard-image'}],emailSegments=[{type:'table',rows:[['标题']]}];
 const png={type:'image',src:'data:image/png;base64,AAAA'};
 const ctx={ChatTargets:require('../assets/chat-targets.js'),ClipboardImage:{render:async parts=>{assert.equal(parts,segments);return png;}},assets:editorAssets,window:{},safeImageSource:src=>src==='clipboard-image',htmlToSource(){},ClipboardSource:{toSource:async(_item,{registerImage})=>registerImage('clipboard-image')},buildPayload:async(source,imageAssets)=>{seen.push({source,imageAssets});return {segments,emailSegments};}};
 vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('async function convertClipboardContent(')),ctx);
 assert.equal(await ctx.convertClipboardContent([{}],'wechat'),segments);
 assert.equal(await ctx.convertClipboardContent([{}],'email'),emailSegments);
 assert.equal((await ctx.convertClipboardContent([{}],'image'))[0],png);
 assert.equal(editorAssets.get('1').src,'editor-image');assert.equal(editorAssets.size,1);
 assert.equal(seen[0].imageAssets.get('1').src,'clipboard-image');assert.notEqual(seen[0].imageAssets,seen[1].imageAssets);
});
