const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ClipboardDiagnostics=require('../assets/clipboard-diagnostics.js');
const source=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
function fixture(desktop){
 const elements=new Map(),downloads=[],created=[],revoked=[],events=new Map();let language='zh-CN';
 const i18n=require('../assets/i18n.js');
 function node(tag='div'){
  let text='';return {tagName:tag,children:[],listeners:{},open:true,
   get textContent(){return text+this.children.map(child=>child.textContent).join('\n');},set textContent(value){text=value;this.children=[];},
   append(...children){this.children.push(...children);},replaceChildren(...children){text='';this.children=children;},
   addEventListener(name,listener){this.listeners[name]=listener;},click(){downloads.push(this.download);}
  };
 }
 const element=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
 const urls={createObjectURL(blob){const url='blob:test-'+created.length;created.push({url,blob});return url;},revokeObjectURL(url){revoked.push(url);}};
 const document={getElementById:element,createElement(tag){assert(['a','p','section','div','h3','span','pre','figure','img','figcaption'].includes(tag),'must not parse clipboard HTML into DOM');return node(tag);}};
 const diagnostics={...ClipboardDiagnostics,renderPreview(container,sample,options){return ClipboardDiagnostics.renderPreview(container,sample,{...options,...urls});}};
 element('diagnostic-feedback').hidden=true;
 const context={lastCopyTarget:'dingtalk',document,window:{isSecureContext:true,md2chatDesktop:desktop,md2chatI18n:{t:source=>i18n.translate(source,language)},addEventListener(name,listener){events.set(name,listener);}},navigator:{clipboard:{}},Blob,ClipboardDiagnostics:diagnostics,ChatTargets:require('../assets/chat-targets.js'),setTimeout(fn,ms){return setTimeout(fn,ms).unref();},clearTimeout,btoa,atob,URL:urls};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('const diagnosticStatus='),source.indexOf('// Tray conversions')),context);
 return {context,downloads,created,revoked,element,read:()=>element('read-clipboard').listeners.click(),export:()=>element('export-diagnostics').listeners.click(),
  close(type='close'){element('diagnostic-dialog').open=false;element('diagnostic-dialog').listeners[type]();},
  language(code){language=code;events.get('md2chat:language')?.();},
  reopen(){element('diagnostic-dialog').open=true;},report:()=>element('diagnostic-report').textContent};
}

test('readable HTML is shown as inert text and image references are clearly marked without fetching',async()=>{
 const f=fixture(),html='<script>evil()</script><p>用户正文</p><img src="https://example.com/image.png?auth=TOKEN">';
 await f.context.showSample('测试',[{type:'text/html',blob:new Blob([html])}]);
 assert.match(f.report(),/图文内容/);assert.match(f.report(),/用户正文/);assert.match(f.report(),/地址未加载/);assert.match(f.report(),/example.com/);
 assert(!f.report().includes('evil()'));assert(!f.report().includes('<p>'));assert.equal(f.created.length,0);
});

test('export contains only the displayed sample and never rereads the clipboard',async()=>{
 let reads=0,saved,content='first';
 const f=fixture({inspect:async()=>{reads++;return {platform:'win32',version:'test',entries:[{type:'text/plain',base64:Buffer.from(content).toString('base64'),text:content}]};},saveDiagnostics:async(name,data)=>{saved={name,bytes:Buffer.from(data,'base64')};return true;}});
 for(const text of ['first','second']){content=text;await f.read();}
 assert.match(f.report(),/second/);assert(!f.report().includes('first'));
 await f.export();assert.equal(reads,2);assert.equal(saved.bytes.readUInt32LE(0),0x04034b50);assert(saved.bytes.includes(Buffer.from('second')));assert(!saved.bytes.includes(Buffer.from('first')));
 assert.match(f.element('diagnostic-status').textContent,/已保存/);
});

test('closing or Escape removes text, images, raw data and object URLs and disables exporting',async()=>{
 for(const event of ['close','cancel']){
  let saves=0;
  const f=fixture({saveDiagnostics:async()=>{saves++;return true;}});
  await f.context.showSample('测试',[{type:'text/plain',blob:new Blob(['PRIVATE'])},{type:'image/png',blob:new Blob([new Uint8Array([255,0,1])])}]);
  assert.match(f.report(),/PRIVATE/);assert.equal(f.created.length,1);
  f.close(event);assert.deepEqual(f.revoked,[f.created[0].url]);assert(!f.report().includes('PRIVATE'));assert.match(f.report(),/尚未读取/);
  f.reopen();await f.export();assert.equal(saves,0);assert.equal(f.element('export-diagnostics').disabled,true);
 }
});

test('a pending native read cannot restore a closed or reopened dialog',async()=>{
 let finish;
 const f=fixture({inspect:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=f.read();f.close();f.reopen();finish({entries:[{type:'text/plain',base64:btoa('OLD-PRIVATE'),text:'OLD-PRIVATE'}]});await pending;
 assert(!f.report().includes('OLD-PRIVATE'));assert.equal(f.element('export-diagnostics').disabled,true);
});

test('closing during blob decoding discards the completed capture',async()=>{
 let finish;
 const f=fixture();
 const capture=f.context.showSample('test',[{type:'text/plain',blob:{size:3,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})}}]);
 f.close();f.reopen();finish(new TextEncoder().encode('OLD').buffer);await capture;
 assert(!f.report().includes('OLD'));assert.equal(f.element('export-diagnostics').disabled,true);
});

test('failed and binary formats distinguish unreadable data from data retained for ZIP',async()=>{
 const f=fixture();await f.context.showSample('测试',[{type:'private/format',error:'系统未提供数据'},{type:'binary/custom',blob:new Blob([new Uint8Array([255,0])])}]);
 assert.match(f.report(),/未能读取/);assert.match(f.report(),/系统未提供数据/);assert.match(f.report(),/原始数据已读取/);assert.match(f.element('diagnostic-status').textContent,/部分内容未能读取/);
});

test('browser fallback reads custom MIME and shows parsed JSON to the customer',async()=>{
 const f=fixture();let attempts=0;
 f.context.navigator.clipboard.read=async options=>{
  attempts++;if(options){const error=new Error('unsupported');error.name='NotSupportedError';throw error;}
  return [{types:['web custom'],getType:async()=>new Blob(['{"message":"识别成功"}'])}];
 };
 await f.read();assert.equal(attempts,2);assert.match(f.report(),/结构化数据/);assert.match(f.report(),/识别成功/);
});

test('dialog paste remains available as a fallback without another input or action button',async()=>{
 const f=fixture();let prevented=false;
 await f.element('diagnostic-dialog').listeners.paste({preventDefault(){prevented=true;},clipboardData:{types:['text/plain'],getData:()=> '粘贴内容',files:[]}});
 assert(prevented);assert.match(f.report(),/粘贴内容/);
});

test('cancelled export stays retryable, and a save completing after close cannot repopulate status',async()=>{
 let attempts=0,finish;
 const f=fixture({saveDiagnostics:async()=>++attempts===1?false:new Promise(resolve=>{finish=resolve;})});
 await f.context.showSample('测试',[{type:'text/plain',blob:new Blob(['sample'])}]);
 await f.export();assert.match(f.element('diagnostic-status').textContent,/取消导出/);assert.equal(f.element('export-diagnostics').disabled,false);
 const saving=f.export();await new Promise(resolve=>setImmediate(resolve));assert(finish);f.close();f.reopen();finish(true);await saving;
 assert.match(f.element('diagnostic-status').textContent,/点击读取/);assert.equal(f.element('export-diagnostics').disabled,true);
});

test('language switching updates diagnostic labels and errors without rereading or translating clipboard content',async()=>{
 const i18n=require('../assets/i18n.js'),data=require('../assets/locales.json');let reads=0,saved;
 const original='用户原文：文字 图片 软件更新';
 const f=fixture({inspect:async()=>{reads++;return {entries:[{type:'text/plain',base64:Buffer.from(original).toString('base64')},{type:'private/custom',error:'系统未提供此格式的数据'}]};},saveDiagnostics:async(name,value)=>{saved=Buffer.from(value,'base64');return true;}});
 await f.read();let initial;
 for(const {code} of data.locales){
  f.language(code);
  assert(f.report().includes(original));assert(f.report().includes(i18n.translate('文字',code)));assert(f.report().includes(i18n.translate('未能读取',code)));
  assert(f.report().includes(i18n.translate('系统未提供此格式的数据',code)));
  assert.equal(f.element('diagnostic-status').textContent,i18n.translate(initial?'诊断 ZIP 已保存，可发送给开发者。':'部分内容未能读取，原因见下方。',code));
  await f.export();if(!initial)initial=saved;else assert.deepEqual(saved,initial,'language must not change exported original data');
 }
 assert.equal(reads,1);
 f.close();for(const {code} of data.locales){f.language(code);assert.equal(f.element('diagnostic-report').children.length,1);assert.equal(f.report(),i18n.translate('尚未读取剪贴板。',code));}
});

test('export feedback appears only after success and is cleared on another read or close',async()=>{
 let saved=false;
 const f=fixture({inspect:async()=>({entries:[{type:'text/plain',base64:btoa('sample')}]}),saveDiagnostics:async()=>saved});
 assert(f.element('diagnostic-feedback').hidden);await f.read();await f.export();assert(f.element('diagnostic-feedback').hidden);
 saved=true;await f.export();assert.equal(f.element('diagnostic-feedback').hidden,false);
 await f.read();assert(f.element('diagnostic-feedback').hidden);await f.export();f.close();assert(f.element('diagnostic-feedback').hidden);
});

test('read errors translate again when language changes without rerunning the failed request',async()=>{
 const i18n=require('../assets/i18n.js');let reads=0;
 const f=fixture({inspect:async()=>{reads++;throw new Error('当前浏览器不支持直接读取');}});
 await f.read();f.language('en');assert.match(f.element('diagnostic-status').textContent,/Read failed/);assert(!/[\u3400-\u9fff]/.test(f.element('diagnostic-status').textContent));
 f.language('ja');assert(f.element('diagnostic-status').textContent.includes(i18n.translate('当前浏览器不支持直接读取','ja')));assert.equal(reads,1);
});
