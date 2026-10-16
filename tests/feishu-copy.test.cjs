const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {makePayload,RAW_FORMAT:DINGTALK_RAW}=require('../desktop/payload.cjs');
const {writeClipboardPayload}=require('../desktop/clipboard-write.cjs');
const {RAW_FORMAT:FEISHU_RAW}=require('../desktop/feishu.cjs');
const png=Buffer.from('89504e470d0a1a0a','hex');
const nativeImage={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:640,height:240}),toPNG:()=>png})};
const parts=[{type:'text',text:'前文',runs:[{text:'前文',bold:true}]},{type:'image',src:'data:image/png;base64,'+png.toString('base64'),displayWidth:320},{type:'text',text:'后文'}];
class ClipboardItem {constructor(data){this.data=data;this.types=Object.keys(data);}async getType(type){const value=this.data[type];return value instanceof Blob?value:new Blob([value]);}}

test('Mac Feishu payload references only its normalized local PNG cache and keeps standard fallbacks',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-feishu-copy-'));
 try{
  const payload=await makePayload(parts,{directory,nativeImage,target:'feishu',platform:'darwin'});
  const ops=payload.feishuFragment.deltas['0'].ops,image=JSON.parse(ops.find(op=>op.attributes?.image).attributes.image);
  assert.deepEqual(ops.map(op=>op.insert),['前文','\n','*','\n','后文']);
  assert.equal(ops[0].attributes.bold,'true');assert.equal(image.imageState,'INITIAL');
  assert.equal(path.dirname(image.src),directory);assert.match(path.basename(image.src),/^[a-f0-9]{64}\.png$/);
  assert.deepEqual(await fs.readFile(image.src),png);assert.equal(image.width,320);assert.equal(image.height,120);
  for(const key of ['token','copyId','needCopy'])assert(!Object.hasOwn(image,key));
  assert.equal(payload.rich,undefined);assert.equal(payload.plain,'前文\n[图片]\n后文');
  assert.match(payload.html,/<strong>前文<\/strong>/);assert.match(payload.html,/<img src="data:image\/png;base64,/);
  assert(!payload.html.includes(directory));
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('Mac Feishu writer writes one item with a real Chromium custom representation and prunes after replacing it',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-feishu-write-'));
 try{
  const payload=await makePayload(parts,{directory,nativeImage,target:'feishu',platform:'darwin'}),events=[];let written;
  const clipboard={write:async items=>{events.push('write');assert.equal(items.length,1);written=items[0];},has:async type=>{events.push('has');assert.equal(type,FEISHU_RAW);return written.types.includes(type);}};
  const result=await writeClipboardPayload(payload,{target:'feishu',platform:'darwin',clipboard,ClipboardItem,imageDirectory:directory,pruneImages:async()=>events.push('prune')});
  assert.deepEqual(events,['write','has','prune']);assert.deepEqual(written.types,['text/plain','text/html',FEISHU_RAW]);
  const buffer=Buffer.from(await (await written.getType(FEISHU_RAW)).arrayBuffer());
  assert.equal(buffer.readUInt32LE(0),buffer.length-4);assert.equal(buffer.readUInt32LE(4),2);
  assert(buffer.toString('utf16le').includes('application/x-editor-kit-fragment'));assert(buffer.toString('utf16le').includes('IM_CHAT'));
  assert.equal(result.feishuNative,true);assert.equal(result.native,false);assert.equal(result.windowsHtml,false);assert.equal(result.images,1);
  assert(!written.types.includes(DINGTALK_RAW));assert(!written.types.includes('image/png'));
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('Feishu copy failure or missing native representation never prunes images or reports success',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-feishu-failure-'));
 try{
  const payload=await makePayload(parts,{directory,nativeImage,target:'feishu',platform:'darwin'});let pruned=false;
  for(const clipboard of [{write:async()=>{throw new Error('denied');},has:async()=>false},{write:async()=>{},has:async()=>false}]){
   await assert.rejects(()=>writeClipboardPayload(payload,{target:'feishu',platform:'darwin',clipboard,ClipboardItem,imageDirectory:directory,pruneImages:async()=>{pruned=true;}}),/denied|未保留飞书/);
   assert.equal(pruned,false);assert.equal((await fs.readdir(directory)).length,1);
  }
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('Windows and Linux Feishu keep standard HTML without Mac cache or Chromium private data',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-feishu-platform-'));
 try{
  let previous;
  for(const platform of ['win32','linux']){
   const payload=await makePayload(parts,{directory,nativeImage,target:'feishu',platform});
   assert.equal(payload.feishuFragment,undefined);assert.deepEqual(await fs.readdir(directory),[]);
   let written;const result=await writeClipboardPayload(payload,{platform,target:'feishu',ClipboardItem,clipboard:{write:async items=>{written=items;},has:async()=>assert.fail('standard paths must not inspect private formats')}});
   assert.equal(result.feishuNative,false);assert.deepEqual(written[0].types,['text/plain','text/html']);
   if(previous)assert.deepEqual(payload,previous);previous=payload;
  }
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('editor Feishu copy remains one request and explains the required rich-text input',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../assets/app.js'),'utf8'),calls=[],notices=[];
 const copyButton={dataset:{copyTarget:'feishu'},setAttribute(){},addEventListener(_name,callback){this.click=callback;}};
 const payload={segments:parts,preview:'preview'};
 const context={window:{md2chatDesktop:{platform:'darwin',copy:async(value,target)=>{calls.push({value,target});return {images:1,native:false,feishuNative:true};}}},ChatTargets:require('../assets/chat-targets.js'),copyButtons:[copyButton],copying:false,button:{},status:{},message:{},document:{getElementById:()=>({})},cachedPayload:payload,cachedSource:'source',serializeInput:()=>'source',previewTimer:0,clearTimeout(){},conversionSummary:()=>'summary',showCopyNotice:text=>notices.push(text)};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const desktopRequired='),source.indexOf('\nconst button=')),context);
 vm.runInContext(source.slice(source.indexOf('for(const copyButton of copyButtons)copyButton.addEventListener'),source.indexOf('\nupdatePreview();')),context);
 await copyButton.click();assert.equal(calls.length,1);assert.equal(calls[0].value,parts);assert.equal(calls[0].target,'feishu');
 assert.match(notices.at(-1),/展开飞书富文本输入框.*一次粘贴/);assert.match(context.status.textContent,/普通输入框可能丢图/);
 assert(!context.status.textContent.includes('钉钉'));assert.equal(context.copying,false);
});

test('tray Feishu conversion explains rich-text paste after the shared native writer completes',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../desktop/main.cjs'),'utf8'),notifications=[];
 class Notification {static isSupported(){return true;}constructor(options){notifications.push(options);}show(){}}
 const context={clipboardConversion:{convert:async target=>{assert.equal(target,'feishu');return {feishuNative:true};}},Notification,profile:require('../assets/chat-targets.js').profile,dialog:{showMessageBox:()=>assert.fail('notification is supported')}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf(' async function convertClipboard(target)'),source.indexOf(' function createWindow()')),context);
 await context.convertClipboard('feishu');assert.equal(notifications.length,1);assert.match(notifications[0].body,/展开飞书富文本输入框.*一次粘贴/);
});
