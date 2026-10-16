// Native clipboard round-trip test. Restores every original representation in finally.
const {app,clipboard,ClipboardItem,nativeImage}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {makePayload,RAW_FORMAT}=require('./payload.cjs');
app.whenReady().then(async()=>{
 let backup=[],dir,captured=false;
 try{
  for(const item of await clipboard.read()){const data={};for(const type of item.types)data[type]=await item.getType(type);backup.push(new ClipboardItem(data));}
  captured=true;
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-smoke-'));
  const src=nativeImage.createFromPath(path.join(__dirname,'../docs/segments-preview.png')).toDataURL();
  const p=await makePayload([{type:'text',text:'开头文字'},{type:'image',src},{type:'text',text:'结尾文字'}],{directory:dir,nativeImage});
  await clipboard.write([new ClipboardItem({'text/plain':p.plain,'text/html':p.html,[RAW_FORMAT]:new Blob([JSON.stringify(p.rich)])})]);
  assert(await clipboard.has(RAW_FORMAT));
  const all=await clipboard.read(),item=all.find(i=>i.types.includes(RAW_FORMAT));
  const actual=JSON.parse(await (await item.getType(RAW_FORMAT)).text());
  assert.deepEqual(actual,p.rich);assert.equal(await clipboard.readText(),p.plain);
  console.log('PASS: native clipboard text/image/text JSON, HTML and plain text round trip');
 }catch(error){console.error(error);process.exitCode=1;}
 finally{try{if(captured){if(backup.length)await clipboard.write(backup);else clipboard.clear();}}catch{console.error('Clipboard restore failed');process.exitCode=1;}if(dir)await fs.rm(dir,{recursive:true,force:true});app.exit(process.exitCode||0);}
});
