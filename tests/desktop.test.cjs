const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {makePayload,validateParts,pruneImages}=require('../desktop/payload.cjs');
const png=Buffer.from('89504e470d0a1a0a','hex');
const nativeImage={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:1600,height:400}),toPNG:()=>png})};
test('native payload retains editable styled text, real image path and ordering',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-test-'));
 try{
  const p=await makePayload([{type:'text',text:'前文\n下一行',runs:[{text:'前文',bold:true},{text:'\n下一行'}]},{type:'image',src:'data:image/png;base64,'+png.toString('base64')},{type:'text',text:'后文 <script>'}],{directory:dir,nativeImage});
  const items=p.rich.contents[0].text.items;
  assert.deepEqual(items.map(i=>i.type),['text','newLine','text','newLine','image','newLine','text']);
  assert.equal(items[0].style.bold,true);assert.equal(items.at(-1).data.text,'后文 <script>');
  assert.deepEqual(await fs.readFile(items[4].data.path),png);assert.equal(items[4].data.authMediaId,'');
  assert.equal(items[4].style.width,1100);assert.equal(items[4].style.height,275);
  assert(!p.html.includes('<script>'));assert(p.html.includes('&lt;script&gt;'));assert.equal(p.imageCount,1);
  assert(p.plain.includes('[图片]'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('native entry rejects external paths and oversized input before filesystem access',()=>{
 for(const src of ['file:///etc/passwd','https://example.com/a.png','data:image/svg+xml;base64,AAA','data:image/png;base64,!!!'])assert.throws(()=>validateParts([{type:'image',src}]));
 assert.throws(()=>validateParts([{type:'text',text:'a'.repeat(2*1024*1024+1)}]));
 assert.throws(()=>validateParts([]));
});
test('cache pruning preserves current and recent images and never follows arbitrary filenames',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-prune-'));
 try{
  const old=path.join(dir,'a'.repeat(64)+'.png'),current=path.join(dir,'b'.repeat(64)+'.png'),recent=path.join(dir,'c'.repeat(64)+'.png'),other=path.join(dir,'do-not-delete.txt');
  for(const p of [old,current,recent,other])await fs.writeFile(p,'test');
  for(const p of [old,current,other])await fs.utimes(p,new Date(0),new Date(0));
  await pruneImages(dir,new Set([current]));
  await assert.rejects(()=>fs.stat(old));for(const p of [current,recent,other])assert((await fs.stat(p)).isFile());
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
