const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {runFeishuClipboardSmoke,parseCustomData}=require('../desktop/feishu-smoke.cjs');
const {RAW_FORMAT:FEISHU_RAW_FORMAT}=require('../desktop/feishu.cjs');

function fixture({empty=false,emptyItem=false,failBackup=false,failWrite=false,corruptStyle=false,corruptPickle=false,corruptNativeStyle=false,corruptCache=false,failRestore=false}={}){
 class ClipboardItem{
  constructor(data){assert(Object.keys(data).length,'Electron refuses empty ClipboardItems');this.data=Object.fromEntries(Object.entries(data).map(([type,value])=>[type,value instanceof Blob?value:new Blob([value],{type})]));this.types=Object.keys(this.data);}
  async getType(type){return this.data[type];}
 }
 const original=empty?[]:[new ClipboardItem({'text/plain':'PRIVATE_SENTINEL','text/html':'<p>PRIVATE_SENTINEL</p>','application/private-PRIVATE_SENTINEL':new Blob([Uint8Array.from([0,1,2,255])])}),new ClipboardItem({'text/rtf':'PRIVATE_SENTINEL_RTF'})];
 if(emptyItem)original.unshift({types:[]});
 let current=original,writes=0;
 const calls=[];
 const clipboard={
  async read(){if(failBackup&&writes===0)return [{types:['text/plain'],getType:async()=>{throw new Error('PRIVATE_SENTINEL');}}];return current;},
  async write(items){
   writes++;calls.push(items);
   if(failWrite&&writes===1||failRestore&&writes>1)throw new Error('PRIVATE_SENTINEL');
   if(writes===1&&(corruptStyle||corruptPickle||corruptNativeStyle||corruptCache)){
    const data={...items[0].data};
    if(corruptStyle)data['text/html']=new Blob([(await data['text/html'].text()).replaceAll('<strong>','<span>').replaceAll('</strong>','</span>')],{type:'text/html'});
    if(corruptPickle||corruptNativeStyle){
     let bytes=Buffer.from(await data[FEISHU_RAW_FORMAT].arrayBuffer());
     if(corruptPickle)bytes.writeUInt32LE(bytes.length,0);
     else {const before=Buffer.from('"bold":"true"','utf16le'),after=Buffer.from('"bold":"TRUE"','utf16le'),index=bytes.indexOf(before);assert(index>=0);after.copy(bytes,index);}
     data[FEISHU_RAW_FORMAT]=new Blob([bytes],{type:'application/octet-stream'});
    }
    if(corruptCache){const fragment=parseCustomData(Buffer.from(await data[FEISHU_RAW_FORMAT].arrayBuffer())),op=fragment.deltas['0'].ops.find(op=>op.attributes?.entityType==='image');await fs.writeFile(JSON.parse(op.attributes.image).src,'PRIVATE_SENTINEL');}
    current=[new ClipboardItem(data)];
   }else current=items;
  },
  async has(type){return current.some(item=>item.types.includes(type));},
  async clear(){calls.push('clear');current=[];}
 };
 function image(bytes){
  const valid=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  return {isEmpty:()=>!valid,getSize:()=>({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}),toDataURL:()=> 'data:image/png;base64,'+bytes.toString('base64'),toPNG:()=>Buffer.from(bytes)};
 }
 const nativeImage={createFromBuffer:bytes=>image(bytes),createFromDataURL:source=>image(Buffer.from(source.slice(source.indexOf(',')+1),'base64'))};
 return {dependencies:{clipboard,ClipboardItem,nativeImage},original,calls,current:()=>current};
}

test('Feishu native smoke refuses other platforms before accessing a clipboard',async()=>{
 const report=await runFeishuClipboardSmoke({clipboard:{read:()=>assert.fail('must not read clipboard')}},{platform:'win32'});
 assert.equal(report.failure,'macos_required');assert.equal(report.status,'failed');assert.equal(report.feishuClientTested,false);assert.deepEqual(report.cases,[]);
});

test('Feishu whole-message smoke uses real payload/writer and restores every original representation',async()=>{
 const f=fixture(),temporaryRoot=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-feishu-test-'));
 try{
  const report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin',temporaryRoot});
  assert.equal(report.status,'passed');assert.equal(report.feishuClientTested,false);assert.equal(report.clipboardRestored,true);assert.equal(report.temporaryFilesRemoved,true);
  assert.equal(report.cases.length,1);const result=report.cases[0];
  assert.equal(result.status,'passed');assert.equal(result.write.images,2);assert.equal(result.write.target,'feishu');assert.equal(result.write.feishuNative,true);
  assert.deepEqual(result.observed.html.decodedImageSizes,[{width:2,height:3},{width:3,height:2}]);
  assert.equal(result.observed.html.textAndImagesOrdered,true);assert.equal(result.observed.plainTextMatches,true);
  assert.deepEqual(result.observed.html.styles,{bold:true,italic:true,strikethrough:true});
  assert.equal(result.observed.nativeFragment.businessKeyMatches,true);assert.equal(result.observed.nativeFragment.textAndImagesOrdered,true);
  assert.equal(result.observed.nativeFragment.images,2);assert.deepEqual(result.observed.nativeFragment.styles,{bold:true,italic:true,strikethrough:true});
  assert(result.observed.nativeFragment.cachedImages.every(image=>image.bytes>0&&image.bytesMatch&&image.insideTemporaryDirectory));
  assert.deepEqual(result.observed.nativeFragment.cachedImages.map(image=>image.size),[{width:2,height:3},{width:3,height:2}]);
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].length,1);assert.deepEqual(f.calls[0][0].types,['text/plain','text/html',FEISHU_RAW_FORMAT]);
  const restored=f.current();assert.equal(restored.length,f.original.length);
  for(let index=0;index<restored.length;index++){
   assert.deepEqual(restored[index].types,f.original[index].types);
   for(const type of restored[index].types)assert.deepEqual(Buffer.from(await (await restored[index].getType(type)).arrayBuffer()),Buffer.from(await (await f.original[index].getType(type)).arrayBuffer()));
  }
  assert.deepEqual(await fs.readdir(temporaryRoot),[]);assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
 }finally{await fs.rm(temporaryRoot,{recursive:true,force:true});}
});

test('an incomplete clipboard backup prevents all writes and never exposes the failed content',async()=>{
 const f=fixture({failBackup:true}),report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin'});
 assert.equal(report.status,'failed');assert.equal(report.failure,'clipboard_backup_failed');assert.equal(report.clipboardRestored,false);assert.equal(report.temporaryFilesRemoved,true);
 assert.deepEqual(f.calls,[]);assert.deepEqual(report.cases,[]);assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});

test('a failed whole-message write still restores the original clipboard',async()=>{
 const f=fixture({failWrite:true}),report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin'});
 assert.equal(report.status,'failed');assert.equal(report.cases[0].check,'write');assert.equal(report.clipboardRestored,true);assert.equal(report.temporaryFilesRemoved,true);
 assert.equal(f.calls.length,2);assert.equal(await (await f.current()[0].getType('text/plain')).text(),'PRIVATE_SENTINEL');assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});

test('lost rich-text styles fail the round trip and the backup is restored',async()=>{
 const f=fixture({corruptStyle:true}),report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin'});
 assert.equal(report.status,'failed');assert.equal(report.cases[0].check,'run_styles');assert.equal(report.cases[0].observed.html.styles.bold,false);
 assert.equal(report.clipboardRestored,true);assert.equal(report.temporaryFilesRemoved,true);assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});

test('invalid custom-data pickle framing fails without exposing native data',async()=>{
 const f=fixture({corruptPickle:true}),report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin'});
 assert.equal(report.status,'failed');assert.equal(report.cases[0].check,'native_fragment');assert.equal(report.clipboardRestored,true);assert.equal(report.temporaryFilesRemoved,true);
 assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});

test('native style corruption fails even when the HTML alternative still preserves style',async()=>{
 const f=fixture({corruptNativeStyle:true}),report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin'});
 assert.equal(report.status,'failed');assert.equal(report.cases[0].check,'native_fragment');assert.equal(report.clipboardRestored,true);assert.equal(report.temporaryFilesRemoved,true);
 assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});

test('native image cache corruption fails and all temporary files are removed',async()=>{
 const f=fixture({corruptCache:true}),temporaryRoot=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-feishu-test-'));
 try{
  const report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin',temporaryRoot});
  assert.equal(report.status,'failed');assert.equal(report.cases[0].check,'native_fragment');assert.equal(report.clipboardRestored,true);assert.equal(report.temporaryFilesRemoved,true);
  assert.deepEqual(await fs.readdir(temporaryRoot),[]);assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
 }finally{await fs.rm(temporaryRoot,{recursive:true,force:true});}
});

test('empty native clipboard items are skipped before constructing the backup',async()=>{
 const f=fixture({emptyItem:true}),report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin'});
 assert.equal(report.status,'passed');assert.equal(report.clipboardRestored,true);assert.equal(f.current().length,2);
 for(let index=0;index<2;index++)assert.deepEqual(f.current()[index].types,f.original[index+1].types);
});

test('an originally empty clipboard is cleared after the single whole-message write',async()=>{
 const f=fixture({empty:true}),report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin'});
 assert.equal(report.status,'passed');assert.equal(report.clipboardRestored,true);assert.equal(f.calls.length,2);assert.equal(f.calls.at(-1),'clear');assert.deepEqual(f.current(),[]);
});

test('restore failure is reported without the underlying error or original clipboard values',async()=>{
 const f=fixture({failRestore:true}),report=await runFeishuClipboardSmoke(f.dependencies,{platform:'darwin'});
 assert.equal(report.status,'failed');assert.equal(report.restoreFailure,'clipboard_restore_failed');assert.equal(report.clipboardRestored,false);assert.equal(report.temporaryFilesRemoved,true);
 assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
});
