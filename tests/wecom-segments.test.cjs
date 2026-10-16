const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,snapshotParts}=require('../assets/wecom-segments.js');
const image='data:image/png;base64,iVBORw0KGgo=';

// A small DOM double keeps these interaction tests independent of browser dependencies.
class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes={};this.listeners={};this.textContent='';this.className='';this.disabled=false;this.open=false;this.classList={add:(...names)=>this.setClasses(names,true),remove:(...names)=>this.setClasses(names,false)};}
 setClasses(names,add){const classes=new Set(this.className.split(/\s+/).filter(Boolean));for(const name of names)if(add)classes.add(name);else classes.delete(name);this.className=[...classes].join(' ');}
 setAttribute(name,value){this.attributes[name]=value;}
 append(...nodes){for(const node of nodes){this.children.push(node);node.parentNode=this;}}
 replaceChildren(...nodes){for(const node of this.children)node.parentNode=null;this.children=[];this.append(...nodes);}
 remove(){if(this.parentNode){const parent=this.parentNode;parent.children=parent.children.filter(node=>node!==this);this.parentNode=null;}}
 addEventListener(name,listener){(this.listeners[name]||=[]).push(listener);}
 dispatch(name,event={}){for(const listener of this.listeners[name]||[])listener(event);}
 click(){if(!this.disabled)this.dispatch('click');}
 showModal(){this.open=true;}
 close(){this.open=false;this.dispatch('close');}
}
function fixture(copySegment=()=>{}){
 const body=new Element('body');
 const env={document:{body,createElement:tag=>new Element(tag)},structuredClone};
 const controller=create({copySegment},env);
 const all=node=>[node,...node.children.flatMap(all)];
 return {body,controller,nodes:()=>all(body),buttons:()=>all(body).filter(node=>/^复制第\d+段/.test(node.attributes['aria-label']||'')),status:()=>all(body).find(node=>node.attributes.role==='status'),dialog:()=>body.children[0]};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('ordered cards safely display text and allowlisted images with accessible copy labels',()=>{
 const f=fixture();
 f.controller.open([{type:'text',text:'前文 <img src=x onerror=alert(1)>'},{type:'image',src:image},{type:'text',text:'后文'}]);
 assert.equal(f.controller.isOpen,true);assert.equal(f.dialog().open,true);
 assert(f.dialog().attributes['aria-labelledby']);
 assert.deepEqual(f.buttons().map(button=>button.attributes['aria-label']),['复制第1段文字','复制第2段图片','复制第3段文字']);
 assert.deepEqual(f.nodes().filter(node=>node.tagName==='PRE').map(node=>node.textContent),['前文 <img src=x onerror=alert(1)>\n','\n后文']);
 assert.deepEqual(f.nodes().filter(node=>node.tagName==='IMG').map(node=>node.src),[image]);
 f.controller.close();assert.equal(f.controller.isOpen,false);assert.equal(f.body.children.length,0);
});

test('a click invokes copying synchronously using a detached snapshot and disables concurrent copies',async()=>{
 const calls=[];let finish;
 const f=fixture(segment=>{calls.push(segment);return new Promise(resolve=>{finish=resolve;});});
 const parts=[{type:'text',text:'原文',runs:[{text:'原文',bold:true}]},{type:'image',src:image}];
 f.controller.open(parts);parts[0].text='改文';parts[0].runs[0].text='改文';parts.pop();
 const buttons=f.buttons();buttons[0].click();
 assert.equal(calls.length,1,'copy begins before the click returns');
 assert.equal(calls[0].text,'原文\n');assert.equal(calls[0].runs[0].text,'原文');assert.equal(calls[0].runs.map(run=>run.text).join(''),'原文\n');assert.notEqual(calls[0],parts[0]);
 assert(buttons.every(button=>button.disabled));buttons[1].click();assert.equal(calls.length,1);
 finish();await tick();
 assert(buttons.every(button=>!button.disabled));assert.match(buttons[0].textContent,/已复制/);
 assert.match(f.status().textContent,/已复制第 1\/2 段.*到企微粘贴/);assert(!f.status().textContent.includes('已粘贴'));
 f.controller.close();
});

test('text-only and image-only content are copied as their original segment types',async()=>{
 for(const part of [{type:'text',text:'可编辑文字'},{type:'image',src:image}]){
  const calls=[],f=fixture(segment=>calls.push(segment));f.controller.open([part]);f.buttons()[0].click();await tick();
  assert.deepEqual(calls,[part]);assert.match(f.status().textContent,/已复制第 1\/1 段/);f.controller.close();
 }
});

test('text-image-text copies include explicit newline boundaries without mutating source parts',async()=>{
 const calls=[],f=fixture(segment=>calls.push(segment));
 const parts=[{type:'text',text:'前文',runs:[{text:'前文',bold:true}]},{type:'image',src:image},{type:'text',text:'后文',runs:[{text:'后文',italic:true}]}];
 f.controller.open(parts);
 for(const button of f.buttons()){button.click();await tick();}
 assert.deepEqual(calls.map(part=>part.type==='text'?part.text:part.src),['前文\n',image,'\n后文']);
 assert.equal(calls[0].runs.map(run=>run.text).join(''),calls[0].text);
 assert.equal(calls[2].runs.map(run=>run.text).join(''),calls[2].text);
 assert.equal(parts[0].text,'前文');assert.deepEqual(parts[0].runs,[{text:'前文',bold:true}]);
 assert.equal(parts[2].text,'后文');assert.deepEqual(parts[2].runs,[{text:'后文',italic:true}]);
 f.controller.close();
});

test('boundary normalization preserves existing newlines and leaves text-only content unchanged',()=>{
 const imagePart={type:'image',src:image};
 const parts=[{type:'text',text:'前文\n\n'},imagePart,{type:'text',text:'\n已有段落\n'},imagePart,{type:'text',text:'\r\n后文'}];
 assert.deepEqual(snapshotParts(parts),parts);
 const plain=[{type:'text',text:'纯文字一'},{type:'text',text:'纯文字二'}];
 assert.deepEqual(snapshotParts(plain),plain);
 const middle=snapshotParts([imagePart,{type:'text',text:'两图中间'},imagePart]);
 assert.equal(middle[1].text,'\n两图中间\n');
});

test('a failed copy stays retryable without claiming success',async()=>{
 let attempts=0;
 const f=fixture(()=>{if(++attempts===1)throw new Error('权限未允许');});
 f.controller.open([{type:'text',text:'示例'}]);const button=f.buttons()[0];
 button.click();await tick();assert.match(f.status().textContent,/复制失败.*权限未允许.*重试/);assert(!button.disabled);assert(!button.textContent.includes('已复制'));
 button.click();await tick();assert.equal(attempts,2);assert.match(f.status().textContent,/已复制第 1\/1 段/);f.controller.close();
});

test('a rejected asynchronous copy also releases all buttons for retry',async()=>{
 let rejectCopy;
 const f=fixture(()=>new Promise((_resolve,reject)=>{rejectCopy=reject;}));
 f.controller.open([{type:'text',text:'示例'},{type:'image',src:image}]);f.buttons()[1].click();
 rejectCopy(new Error('图片写入失败'));await tick();
 assert.match(f.status().textContent,/第 2 段复制失败.*图片写入失败/);assert(f.buttons().every(button=>!button.disabled));f.controller.close();
});

test('open cannot replace an active sequence and Escape removes its content',()=>{
 const f=fixture();f.controller.open([{type:'text',text:'保留当前序列'}]);const panel=f.dialog();
 assert.throws(()=>f.controller.open([{type:'text',text:'不要替换'}]),/请先关闭当前企微分段窗口/);
 assert.equal(f.nodes().find(node=>node.tagName==='PRE').textContent,'保留当前序列');
 let prevented=false;panel.dispatch('cancel',{preventDefault(){prevented=true;}});
 assert(prevented);assert.equal(f.controller.isOpen,false);assert.equal(f.body.children.length,0);assert.equal(panel.children.length,0);
 f.controller.open([{type:'text',text:'新序列'}]);f.dialog().close();assert.equal(f.controller.isOpen,false);assert.equal(f.body.children.length,0);
});

test('completion or rejection after closing cannot change a later session',async()=>{
 for(const reject of [false,true]){
  let finish;
  const f=fixture(()=>new Promise((resolve,rejectPromise)=>{finish=reject?()=>rejectPromise(new Error('旧错误')):resolve;}));
  f.controller.open([{type:'text',text:'旧序列'}]);f.buttons()[0].click();f.controller.close();
  f.controller.open([{type:'text',text:'新序列'}]);const status=f.status().textContent;
  finish();await tick();assert.equal(f.status().textContent,status);assert(!f.buttons()[0].disabled);assert(!f.buttons()[0].textContent.includes('已复制'));f.controller.close();
 }
});

test('invalid or external images and unsupported segments never create a dialog',()=>{
 const f=fixture();
 for(const parts of [[],[{type:'image',src:'https://example.com/private.png'}],[{type:'image',src:'data:image/svg+xml;base64,AAAA'}],[{type:'image',src:'data:image/png;base64,AAAA" onerror="bad'}],[{type:'table',rows:[['x']]}],[{type:'text',text:3}]]){
  assert.throws(()=>f.controller.open(parts));assert.equal(f.controller.isOpen,false);assert.equal(f.body.children.length,0);
 }
 const parts=[{type:'image',src:image}];assert.notEqual(snapshotParts(parts),parts);
});

test('DingTalk segmentation labels the target and copies each text or image with its target',async()=>{
 const calls=[],f=fixture((part,target)=>calls.push({part,target}));
 f.controller.open([{type:'text',text:'安全文字 <img src=x onerror=alert(1)>'},{type:'image',src:image}],'dingtalk');
 assert.equal(f.nodes().find(node=>node.tagName==='H2').textContent,'钉钉分段复制');
 const instruction=f.nodes().find(node=>node.className==='wecom-segments-instruction');
 assert.match(instruction.textContent,/钉钉图文需按编号逐段复制，再到钉钉按顺序粘贴/);
 assert(f.nodes().some(node=>node.attributes['aria-label']==='关闭钉钉分段窗口'));
 assert.throws(()=>f.controller.open([{type:'text',text:'不能替换'}],'wecom'),/请先关闭当前钉钉分段窗口/);
 assert(f.nodes().some(node=>node.className==='help wecom-segments-note'&&node.textContent.includes('文字按纯文本粘贴')));
 assert(!f.nodes().some(node=>node.textContent.includes('企微')));
 assert.equal(f.nodes().filter(node=>node.tagName==='IMG').length,1);
 for(const button of f.buttons()){button.click();await tick();assert.match(f.status().textContent,/到钉钉粘贴后再继续/);}
 assert.deepEqual(calls.map(call=>call.target),['dingtalk','dingtalk']);
 assert.deepEqual(calls.map(call=>call.part.type),['text','image']);
 assert.equal(calls[0].part.text,'安全文字 <img src=x onerror=alert(1)>\n');
 f.controller.close();
});

test('adjacent sessions keep their own copy targets and ignore a previous target completion',async()=>{
 for(const [first,second] of [['wecom','dingtalk'],['dingtalk','wecom']]){
  let finish;const calls=[];
  const f=fixture((part,target)=>{calls.push({part,target});if(calls.length===1)return new Promise(resolve=>{finish=resolve;});});
  f.controller.open([{type:'text',text:'旧序列'}],first);f.buttons()[0].click();f.controller.close();
  f.controller.open([{type:'text',text:'新序列'}],second);const initial=f.status().textContent;
  finish();await tick();assert.equal(f.status().textContent,initial);
  f.buttons()[0].click();await tick();
  assert.deepEqual(calls.map(call=>call.target),[first,second]);
  assert.deepEqual(calls.map(call=>call.part.text),['旧序列','新序列']);
  assert.match(f.status().textContent,new RegExp('到'+(second==='wecom'?'企微':'钉钉')+'粘贴'));
  f.controller.close();
 }
 const defaults=[],f=fixture((_part,target)=>defaults.push(target));
 f.controller.open([{type:'text',text:'默认企微'}]);f.buttons()[0].click();await tick();assert.deepEqual(defaults,['wecom']);f.controller.close();
});

test('unknown or injected segment targets are rejected before any dialog is created',()=>{
 const f=fixture();
 for(const target of ['unknown','__proto__','constructor','<img src=x onerror=alert(1)>',null,{},[]]){
  assert.throws(()=>f.controller.open([{type:'text',text:'样本'}],target),/不支持.*目标/);
  assert.equal(f.controller.isOpen,false);assert.equal(f.body.children.length,0);
 }
});
