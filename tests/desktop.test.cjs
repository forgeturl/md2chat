const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pathToFileURL}=require('node:url');
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
test('2x images retain logical dimensions while PNG cache bytes and legacy sizing stay unchanged',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-display-'));
 const image={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:640,height:240}),toPNG:()=>png})};
 try{
  for(const [hint,expectedWidth] of [[320,320],[1280,640],[undefined,640],[Infinity,640],[NaN,640],[0,640],[-1,640],['320',640],['" onerror="bad',640]]){
   const part={type:'image',src:'data:image/png;base64,'+png.toString('base64'),displayWidth:hint};
   const result=await makePayload([part],{directory:dir,nativeImage:image});
   const item=result.rich.contents[0].text.items[0],expectedHeight=Math.round(240*expectedWidth/640);
   assert.equal(item.style.width,expectedWidth);assert.equal(item.style.height,expectedHeight);
   assert.match(result.html,new RegExp('width="'+expectedWidth+'" height="'+expectedHeight+'"'));
   assert.deepEqual(await fs.readFile(item.data.path),png);assert.equal(result.plain,'[图片]');
   assert.equal(part.displayWidth,hint);
  }
  assert.equal((await fs.readdir(dir)).length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
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
test('Windows DingTalk uses ordered paragraphs and escaped local PNG file URLs for two images',async()=>{
 const prefix=process.platform==='win32'?'md2chat win & quotes-':'md2chat win & "quotes"-';
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),prefix));
 const first='data:image/png;base64,'+png.toString('base64'),second='data:image/png;base64,AAAA';
 const secondBytes=Buffer.from('second PNG');
 const images={createFromDataURL:src=>({isEmpty:()=>false,getSize:()=>src===first?{width:2204,height:316}:{width:748,height:176},toPNG:()=>src===first?png:secondBytes})};
 try{
  const result=await makePayload([{type:'text',text:'前文 <script>'},{type:'image',src:first,displayWidth:640},{type:'text',text:'中间 & 文字'},{type:'image',src:second},{type:'text',text:'后文'}],{directory:dir,nativeImage:images,platform:'win32'});
  const imageItems=result.rich.contents[0].text.items.filter(item=>item.type==='image');
  assert.equal(imageItems.length,2);assert.equal(result.imageCount,2);
  const urls=imageItems.map(item=>pathToFileURL(item.data.path).href.replaceAll('&','&amp;'));
  assert.match(result.html,/<article\b/);assert.equal((result.html.match(/<p>/g)||[]).length,5);
  assert(result.html.includes('<p><img src="'+urls[0]+'" width="640" height="92"></p>'));
  assert(result.html.includes('<p><img src="'+urls[1]+'" width="748" height="176"></p>'));
  const positions=['前文 &lt;script&gt;',urls[0],'中间 &amp; 文字',urls[1],'后文'].map(value=>result.html.indexOf(value));
  assert(positions.every((value,index)=>value>=0&&(!index||value>positions[index-1])));
  assert(!result.html.includes('data:image/'));assert(!result.html.includes('<script>'));assert(!result.html.includes(' onerror='));
  assert(result.html.includes('%20'));assert(result.html.includes('&amp;'));
  if(process.platform!=='win32')assert(result.html.includes('%22quotes%22'));
  assert.equal(result.plain,'前文 <script>\n[图片]\n中间 & 文字\n[图片]\n后文');
  assert.deepEqual(await fs.readFile(imageItems[0].data.path),png);assert.deepEqual(await fs.readFile(imageItems[1].data.path),secondBytes);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Windows DingTalk paragraphs preserve styles across run boundaries and retain empty lines',async()=>{
 const text='前&<\n粗后\n\n尾"\n';
 const runs=[{text:'前&<',bold:true},{text:'\n粗',italic:true},{text:'后\n\n尾"\n',strikethrough:true}];
 const result=await makePayload([{type:'text',text,runs},{type:'text',text:''}],{directory:'/unused-for-text',nativeImage,platform:'win32'});
 assert.equal((result.html.match(/<p>/g)||[]).length,6);
 assert.match(result.html,/<p><span[^>]*><span[^>]*><strong>前&amp;&lt;<\/strong><\/span><\/span><\/p>/);
 assert.match(result.html,/<p><span[^>]*><span[^>]*><em>粗<\/em><\/span><\/span><span[^>]*><span[^>]*><s>后<\/s><\/span><\/span><\/p>/);
 assert.match(result.html,/<p><span[^>]*><span[^>]*><s>尾&quot;<\/s><\/span><\/span><\/p>/);
 assert.equal((result.html.match(/<p><br><\/p>/g)||[]).length,3);
 assert.equal(result.plain,text+'\n');
 const items=result.rich.contents[0].text.items.filter(item=>item.type==='text');
 assert.equal(items[0].style.bold,true);assert.equal(items[1].style.italic,true);assert.equal(items[2].style.strikethrough,true);
});
test('Windows DingTalk preserves existing safe HTTPS sources and falls back for unsupported or credentialed URLs',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-win-source-'));
 const part={type:'image',src:'data:image/png;base64,'+png.toString('base64')};
 try{
  const sourceUrl='HTTPS://example.invalid/image.png?one=1&two=%22onerror%22#safe';
  const result=await makePayload([{...part,sourceUrl}],{directory:dir,nativeImage,platform:'win32'});
  assert(result.html.includes('src="https://example.invalid/image.png?one=1&amp;two=%22onerror%22#safe"'));
  assert(!result.html.includes('src="file:'));assert.equal((await fs.readdir(dir)).length,1);
  assert.deepEqual(await fs.readFile(result.rich.contents[0].text.items[0].data.path),png);
  const prefix='https://example.invalid/';
  const boundary=await makePayload([{...part,sourceUrl:prefix+'x'.repeat(8192-prefix.length)}],{directory:dir,nativeImage,platform:'win32'});
  assert(boundary.html.includes('src="https://example.invalid/'));assert(!boundary.html.includes('src="file:'));
  for(const sourceUrl of ['http://example.invalid/image.png','file:///tmp/image.png','data:image/png;base64,AAAA','javascript:alert(1)','https://user:password@example.invalid/image.png','https://user@example.invalid/image.png','https://:password@example.invalid/image.png','https://','https:example.invalid/image.png','https://example.invalid/'+('x'.repeat(8192)),undefined,null,42,{}]){
   const fallback=await makePayload([{...part,sourceUrl}],{directory:dir,nativeImage,platform:'win32'});
   const file=fallback.rich.contents[0].text.items[0].data.path;
   assert(fallback.html.includes('src="'+pathToFileURL(file).href+'"'));
   assert(!fallback.html.includes('src="https:'));
  }
  await assert.rejects(()=>makePayload([{type:'image',src:'https://example.invalid/image.png',sourceUrl:'https://example.invalid/image.png'}],{directory:dir,nativeImage,platform:'win32'}),/完整的内嵌图片/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Windows DingTalk compatibility does not change other platforms or other targets',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-platform-isolation-'));
 const parts=[{type:'text',text:'前\n后'},{type:'image',src:'data:image/png;base64,'+png.toString('base64'),sourceUrl:'https://example.invalid/original.png'}];
 try{
  for(const platform of ['darwin','linux']){
   const result=await makePayload(parts,{directory:dir,nativeImage,platform});
   assert(!result.html.includes('<p>'));assert(result.html.includes('前</span></span><br><span'));
   assert(result.html.includes('<img src="data:image/png;base64,'));assert(!result.html.includes('https://example.invalid'));
  }
  for(const target of ['wechat','wecom','email']){
   const windows=await makePayload(parts,{directory:dir,nativeImage,target,platform:'win32'});
   const mac=await makePayload(parts,{directory:dir,nativeImage,target,platform:'darwin'});
   assert.deepEqual(windows,mac);assert(windows.html.includes('data:image/png;base64,'));
   assert(!windows.html.includes('https://example.invalid'));assert(!windows.html.includes('file:'));
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
