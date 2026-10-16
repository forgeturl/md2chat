const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ClipboardDiagnostics=require('../assets/clipboard-diagnostics.js');
const {inspectClipboard}=require('../desktop/clipboard-diagnostics.cjs');
const source=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
function fixture(desktop){
 const elements=new Map(),writes=[];
 const element=id=>{
  if(!elements.has(id))elements.set(id,{listeners:{},addEventListener(name,listener){this.listeners[name]=listener;}});
  return elements.get(id);
 };
 const context={lastCopyTarget:'dingtalk',document:{getElementById:element,createElement(){assert.fail('diagnostics must not build a DOM from clipboard HTML');}},window:{isSecureContext:true,md2chatDesktop:desktop},navigator:{clipboard:{writeText:async text=>writes.push(text)}},Blob,ClipboardDiagnostics,ChatTargets:require('../assets/chat-targets.js'),setTimeout,clearTimeout};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const diagnosticStatus='),source.indexOf('// Tray conversions')),context);
 return {context,writes,element,read:()=>element('read-clipboard').listeners.click(),copy:()=>element('copy-report').listeners.click(),report:()=>element('diagnostic-report').textContent};
}

test('browser HTML diagnostics expose useful reference types and structure without content or DOM parsing',async()=>{
 const f=fixture();
 const html='<!--StartFragment--><article><p>PRIVATE-BODY</p><img src="https://example.com/PRIVATE-PATH?auth=PRIVATE-TOKEN" data-media-id="PRIVATE-ID" width="320"><img src="file:///C:/PRIVATE-FILE.png"></article><!--EndFragment-->';
 await f.context.showSample('测试',[{type:'text/html',blob:new Blob([html])}]);
 const report=f.report();
 for(const expected of ['src=https','src=file','data-media-id','320','article','StartFragment 有','不代表当前剪贴板来源'])assert(report.includes(expected),expected);
 for(const secret of ['PRIVATE-','example.com','file:///C:'])assert(!report.includes(secret),secret);
 await f.copy();assert.equal(f.writes[0],report);
});

test('desktop read and report copy use sanitized metadata and retain exactly the last two samples',async()=>{
 let html='<div><img src="data:image/png;base64,AAAA"></div>';
 const writes=[],desktop={inspect:()=>inspectClipboard({read:async()=>[{types:['text/html'],getType:async()=>new Blob([html])}]},{platform:'win32',version:'0.6.2'}),copy:async parts=>writes.push(parts[0].text)};
 const f=fixture(desktop);
 await f.read();assert(f.report().includes('src=data'));assert(f.report().includes('Mac 钉钉专用格式图片：不适用'));
 assert(f.report().includes('不代表 Windows 原生 CF_HTML 头'));
 html='<p><img src="https://example.com/PRIVATE"></p>';await f.read();
 html='<span><img src="file:///PRIVATE.png"></span>';await f.read();
 await f.copy();
 assert.equal(writes.length,1);assert(writes[0].includes('src=https'));assert(writes[0].includes('src=file'));assert(!writes[0].includes('src=data'));assert(!writes[0].includes('PRIVATE'));
 assert(f.element('diagnostic-status').textContent.includes('剪贴板已被报告替换'));
});

test('skipped and unreadable HTML is marked incomplete without claiming no images exist',async()=>{
 const f=fixture();
 await f.context.showSample('测试',[{type:'text/html',blob:{size:8*1024*1024+1,text(){assert.fail('oversized HTML must not be decoded');}}}]);
 assert(f.report().includes('统计不完整'));assert(!f.report().includes('未发现图片'));
 await f.context.showSample('测试',[{type:'text/html',error:'PRIVATE-ERROR'}]);
 assert(f.report().includes('读取失败'));assert(f.report().includes('统计不完整'));assert(!f.report().includes('PRIVATE-ERROR'));
});

test('browser clipboard reads stop at the format limit and never disclose custom format names',async()=>{
 const f=fixture();let reads=0;
 f.context.navigator.clipboard.read=async()=>[{types:Array.from({length:110},(_,i)=>'private/PRIVATE-'+i),getType:async()=>{reads++;return new Blob(['PRIVATE-BODY']);}}];
 await f.read();assert.equal(reads,100);assert(f.report().includes('格式超过排查限额'));assert(!f.report().includes('PRIVATE-'));
});
