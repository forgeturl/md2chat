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
test('non-DingTalk native payload carries no private data or cached files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-target-'));
 const nativeImage={createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:20,height:10}),toPNG:()=>Buffer.from('sample')})};
 try{
  for(const target of ['wechat','feishu','wecom','email']){const p=await makePayload(parts,{directory:dir,nativeImage,target});assert.equal(p.rich,undefined);assert.equal(p.imageCount,1);assert.match(p.html,/<img/);}
  assert.deepEqual(await fs.readdir(dir),[]);
  const p=await makePayload(parts,{directory:dir,nativeImage,target:'dingtalk'});assert.equal(p.rich.contents[0].text.items.filter(x=>x.type==='image').length,1);assert.equal((await fs.readdir(dir)).length,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
