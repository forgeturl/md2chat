const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const targets=require('../assets/chat-targets.js');
const {makePayload,validateParts}=require('../desktop/payload.cjs');
const png='data:image/png;base64,AAAA',parts=[{type:'text',text:'开头<script>'},{type:'image',src:png},{type:'text',text:'结尾'}];
test('all standard profiles keep text/image/text ordering and escape input',()=>{
 for(const target of Object.keys(targets.profiles)){
  const p=targets.render(parts,target);assert.equal(p.imageCount,1);assert(p.html.indexOf('开头')<p.html.indexOf('<img'));assert(p.html.indexOf('<img')<p.html.indexOf('结尾'));assert(!p.html.includes('<script>'));assert.equal(p.plain,'开头<script>\n[图片]\n结尾');assert(!p.html.includes('com.dingtalk'));
 }
 assert.throws(()=>targets.render(parts,'__proto__'));
 assert.throws(()=>targets.render([{type:'image',src:'file:///private/x'}],'wechat'));
});
test('only email accepts bounded editable tables and escapes every cell',()=>{
 const table={type:'table',rows:[['标题'],['<img onerror=alert(1)>']]};
 validateParts([table],'email');const p=targets.render([table],'email');assert.match(p.html,/<th /);assert.match(p.html,/&lt;img/);assert(!p.html.includes('<img'));assert.equal(p.imageCount,0);
 for(const target of ['dingtalk','wechat','feishu','wecom'])assert.throws(()=>validateParts([table],target));
 assert.throws(()=>validateParts([{type:'table',rows:[[{}]]}],'email'));
 assert.throws(()=>validateParts([{type:'table',rows:Array(2001).fill(['x'])}],'email'));
});
test('standard image HTML respects logical 2x sizing with safe fallback and no source upscaling',()=>{
 const cases=[
  [{displayWidth:320,width:640},320],
  [{displayWidth:320},320],
  [{displayWidth:1280,width:640},640],
  [{displayWidth:2200,width:4000},1100],
  [{width:640},640],
  [{width:1600},1100],
  [{},null]
 ];
 for(const hint of [Infinity,NaN,0,-1,'320','" onerror="bad']){
  cases.push([{displayWidth:hint,width:640},640],[{displayWidth:hint,width:hint},null]);
 }
 for(const target of Object.keys(targets.profiles))for(const [dimensions,expected] of cases){
  const output=targets.render([{type:'image',src:png,...dimensions}],target);
  const match=/\bwidth="([^"]*)"/.exec(output.html);
  assert.equal(match?Number(match[1]):null,expected);
  assert(!output.html.includes('onerror'));assert(!/NaN|Infinity/.test(output.html));
  assert.equal(output.plain,'[图片]');assert.equal(output.imageCount,1);
 }
});
test('standard payloads carry no private data or cached files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-target-'));
 const nativeImage={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:20,height:10}),toPNG:()=>Buffer.from('sample')})};
 try{
  for(const target of ['wechat','feishu','wecom','email']){const p=await makePayload(parts,{directory:dir,nativeImage,target,platform:'win32'});assert.equal(p.rich,undefined);assert.equal(p.feishuFragment,undefined);assert.equal(p.imageCount,1);assert.match(p.html,/<img/);}
  assert.deepEqual(await fs.readdir(dir),[]);
  const p=await makePayload(parts,{directory:dir,nativeImage,target:'dingtalk'});assert.equal(p.rich.contents[0].text.items.filter(x=>x.type==='image').length,1);assert.equal((await fs.readdir(dir)).length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('desktop standard profiles receive the same logical image width as native payloads',async()=>{
 const nativeImage={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:640,height:240}),toPNG:()=>Buffer.from('sample')})};
 for(const target of ['wechat','feishu','wecom','email']){
  const result=await makePayload([{type:'image',src:png,displayWidth:320}],{directory:'/unused-by-standard-profiles',nativeImage,target,platform:'win32'});
  assert.match(result.html,/<img [^>]*width="320"/);assert.equal(result.plain,'[图片]');
 }
});
