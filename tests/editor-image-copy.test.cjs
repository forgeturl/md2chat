const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../assets/app.js'),'utf8');
const html=fs.readFileSync(require.resolve('../editor.html'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({platform='darwin',renderError,hold=false,busy=false}={}){
 const calls=[],notices=[],attributes={};let release,current='source',clipboard='original',sequence=1,locked=busy,renders=0,afterWrite;
 const pending=hold?new Promise(resolve=>{release=resolve;}):Promise.resolve();
 const segments=[{type:'text',text:'完整正文'}],image={type:'image',src:'data:image/png;base64,AAAA',width:100,height:200};
 const copyButton={dataset:{copyTarget:'image'},setAttribute(name,value){attributes[name]=value;},addEventListener(_name,callback){this.click=callback;}};
 const payload={segments,preview:'editable preview'};
 const context={window:{md2chatDesktop:{platform,copyImage:async render=>{
  if(locked)throw new Error('正在转换或复制，请稍候再试。');
  locked=true;const expected=sequence;
  try{const value=await render();if(sequence!==expected)throw new Error('转换期间剪贴板已更新，已保留新内容。请重新转图片。');calls.push(value);clipboard='generated PNG';afterWrite?.();}
  finally{locked=false;}
 }}},
  ClipboardImage:{render:async parts=>{renders++;assert.equal(parts,segments);await pending;if(renderError)throw new Error(renderError);return image;}},
  ChatTargets:require('../assets/chat-targets.js'),copyButtons:[copyButton],copying:false,button:{},status:{},message:{innerHTML:payload.preview},
  document:{getElementById:()=>({})},cachedPayload:payload,cachedSource:'source',serializeInput:()=>current,
  previewTimer:0,clearTimeout(){},conversionSummary:()=>'summary',showCopyNotice:text=>notices.push(text)};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const desktopRequired='),source.indexOf('\nconst button=')),context);
 vm.runInContext(source.slice(source.indexOf('for(const copyButton of copyButtons)copyButton.addEventListener'),source.indexOf('\nupdatePreview();')),context);
 return {context,calls,notices,attributes,copyButton,image,release,edit(){current='edited';},click:()=>copyButton.click(),
  copyElsewhere(){clipboard='new content';sequence++;},clipboard:()=>clipboard,locked:()=>locked,renders:()=>renders,afterWrite(fn){afterWrite=fn;}};
}
test('main editor has a desktop image action before the platform targets',()=>{
 const targets=[...html.matchAll(/data-copy-target="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(targets,['image','wechat','dingtalk','feishu','wecom','email']);
});
test('image action follows the shared disabled state and stays unavailable on the website',()=>{
 const image={dataset:{copyTarget:'image'}},wechat={dataset:{copyTarget:'wechat'}};
 for(const desktop of [true,false]){
  const context={window:{md2chatDesktop:desktop?{}:undefined},document:{getElementById:()=>({}),querySelectorAll:()=>[image,wechat]},WecomSegments:{create:()=>({})},ChatTargets:require('../assets/chat-targets.js')};
  vm.createContext(context);
  vm.runInContext(source.slice(0,source.indexOf("\nconst status="))+'\nbutton.disabled=true;',context);
  assert.equal(image.disabled,true);assert.equal(wechat.disabled,true);
  vm.runInContext('button.disabled=false;',context);
  assert.equal(image.disabled,!desktop);assert.equal(wechat.disabled,false);
 }
});
test('Mac and Windows main editor compose the current document and copy one real image',async()=>{
 for(const platform of ['darwin','win32']){
  const f=fixture({platform});await f.click();
  assert.deepEqual(f.calls,[f.image]);
  assert.equal(f.context.lastCopyTarget,'image');
  assert.match(f.context.status.textContent,/已转为图片/);
  assert.match(f.context.message.innerHTML,/<img /);
  assert.equal(f.attributes['aria-pressed'],'true');
  assert.equal(f.context.copying,false);assert.equal(f.context.button.disabled,false);
 }
});
test('image composition locks repeated clicks and refuses stale content before touching clipboard',async()=>{
 const f=fixture({hold:true}),first=f.click();await tick();
 assert.equal(f.context.copying,true);assert.equal(f.context.button.disabled,true);
 await f.click();assert.equal(f.calls.length,0);
 f.edit();f.release();await first;
 assert.equal(f.calls.length,0);assert.match(f.context.status.textContent,/内容已更新/);
 assert.equal(f.context.message.innerHTML,'editable preview');
 assert.equal(f.context.copying,false);assert.equal(f.context.button.disabled,true);
});
test('image rendering failure preserves clipboard and preview and allows retry',async()=>{
 const f=fixture({renderError:'内容过长'});await f.click();
 assert.equal(f.calls.length,0);assert.equal(f.context.message.innerHTML,'editable preview');
 assert.match(f.context.status.textContent,/内容过长/);
 assert.equal(f.context.copying,false);assert.equal(f.context.button.disabled,false);
});
test('copying a platform after image conversion restores editable output from the original document',async()=>{
 const f=fixture();await f.click();
 f.copyButton.dataset.copyTarget='wechat';
 f.context.window.md2chatDesktop.copy=async(parts,target)=>{
  assert.equal(parts,f.context.cachedPayload.segments);assert.equal(target,'wechat');
  return {images:0,native:false};
 };
 await f.click();
 assert.equal(f.context.message.innerHTML,'editable preview');
 assert.equal(f.context.lastCopyTarget,'wechat');
});
test('a failed preview refresh retains its error instead of announcing an updated preview',async()=>{
 const f=fixture();f.context.cachedPayload=null;
 f.context.updatePreview=async()=>{f.context.status.textContent='公式转换失败';return null;};
 await f.click();
 assert.equal(f.context.status.textContent,'公式转换失败');assert.equal(f.calls.length,0);
});
test('new clipboard content during image composition is preserved and the operation unlocks',async()=>{
 const f=fixture({hold:true}),copy=f.click();await tick();
 assert.equal(f.locked(),true);f.copyElsewhere();f.release();await copy;
 assert.equal(f.clipboard(),'new content');assert.equal(f.calls.length,0);assert.equal(f.locked(),false);
 assert.match(f.context.status.textContent,/已保留新内容/);assert(!f.notices.some(text=>text.includes('可以直接粘贴')));
});
test('an existing tray conversion rejects the editor action before allocating its image',async()=>{
 const f=fixture({busy:true});await f.click();
 assert.equal(f.renders(),0);assert.equal(f.calls.length,0);assert.equal(f.clipboard(),'original');
 assert.match(f.context.status.textContent,/正在转换或复制/);
});
test('document edits during native writing receive a settled stale-document notice, not success',async()=>{
 const f=fixture();f.afterWrite(()=>f.edit());await f.click();
 assert.equal(f.calls.length,1);assert.match(f.context.status.textContent,/当前文档已更新/);
 assert(!f.notices.some(text=>text.includes('可以直接粘贴')));
 assert.equal(f.context.message.innerHTML,'editable preview');
});
