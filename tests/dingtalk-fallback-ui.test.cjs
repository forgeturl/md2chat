const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
function fixture(platform='win32'){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});return nodes.get(id);};
 const tests=['text','rewrite'].map(mode=>({...node(mode),dataset:{dingtalkHtmlTest:mode}}));
 const opened=[],copied=[],writes=[];
 const ctx={document:{getElementById:node,querySelectorAll:selector=>selector==='[data-dingtalk-html-test]'?tests:[]},window:{md2chatDesktop:platform?{platform,copyChatSegment:async part=>copied.push(part),testDingtalkHtml:async mode=>{writes.push(mode);return {mode};}}:undefined},WecomSegments:{create:options=>{ctx.copySegment=options.copySegment;return {open:(parts,target)=>opened.push({parts,target})};}},ChatClipboard:{writeSegment:async part=>copied.push(part)},lastCopyTarget:null,copying:false,clearTimeout(){},previewTimer:0,serializeInput:()=>ctx.currentSource,updatePreview:async()=>{ctx.refreshes++;},cachedPayload:{segments:[{type:'text',text:'前文'},{type:'image',src:'data:image/png;base64,AAAA'}]},cachedSource:'source',currentSource:'source',refreshes:0,status:node('status'),showCopyNotice(){},button:{disabled:false}};
 vm.createContext(ctx);
 vm.runInContext(app.slice(0,app.indexOf('let copying=')),ctx);
 vm.runInContext(app.slice(app.indexOf('const dingtalkSegmentsButton='),app.indexOf('const desktopRequired=')),ctx);
 vm.runInContext(app.slice(app.indexOf("dingtalkSegmentsButton.addEventListener("),app.indexOf('for(const copyButton of copyButtons)')),ctx);
 vm.runInContext(app.slice(app.indexOf('const dingtalkHtmlTests='),app.indexOf('// Reports intentionally')),ctx);
 return {ctx,node,tests,opened,copied,writes,fallback:()=>node('dingtalk-segments').listeners.click()};
}
test('Windows fallback opens an explicit DingTalk sequence without replacing the clipboard',async()=>{
 const f=fixture();assert.equal(f.node('dingtalk-segments').hidden,false);
 await f.fallback();assert.equal(f.opened.length,1);assert.equal(f.opened[0].target,'dingtalk');assert.equal(f.copied.length,0);
 await f.ctx.copySegment({type:'text',text:'前文'},'dingtalk');assert.equal(f.ctx.lastCopyTarget,'dingtalk');
 await f.ctx.copySegment({type:'text',text:'企微'},'wecom');assert.equal(f.ctx.lastCopyTarget,'wecom');
 f.ctx.currentSource='changed';await f.fallback();assert.equal(f.ctx.refreshes,1);assert.equal(f.opened.length,1);
});
test('Mac and web hide Windows fallback and experiments; busy copies block both',async()=>{
 for(const platform of ['darwin',null]){
  const f=fixture(platform);assert(f.node('dingtalk-segments').hidden);assert(f.node('dingtalk-html-tests').hidden);
  await f.fallback();await f.tests[0].listeners.click();assert.equal(f.opened.length,0);assert.equal(f.writes.length,0);
 }
 const f=fixture();f.ctx.copying=true;await f.fallback();await f.tests[0].listeners.click();assert.equal(f.writes.length,0);assert.equal(f.opened.length,0);
});
test('HTML tests run only on explicit click and explain that the clipboard was replaced',async()=>{
 const f=fixture();assert.equal(f.writes.length,0);assert.equal(f.node('dingtalk-html-tests').hidden,false);
 await f.tests[0].listeners.click();assert.deepEqual(f.writes,['text']);assert.match(f.node('diagnostic-status').textContent,/替换.*无图片/);
 await f.tests[1].listeners.click();assert.deepEqual(f.writes,['text','rewrite']);assert.match(f.node('diagnostic-status').textContent,/文档内容不变/);
 assert.equal(f.ctx.copying,false);assert(f.tests.every(button=>!button.disabled));
 f.ctx.window.md2chatDesktop.testDingtalkHtml=async()=>{throw new Error('没有 HTML');};
 await f.tests[1].listeners.click();assert.match(f.node('diagnostic-status').textContent,/未完成.*没有 HTML/);assert.equal(f.ctx.copying,false);
});
test('HTML-test IPC checks the caller and copy lock and releases it after failures',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');let handler;const calls=[];
 const ctx={copying:false,clipboardConversion:{busy:false},trusted:event=>{if(event!=='trusted')throw new Error('untrusted');},runDingtalkHtmlTest:async(mode,options)=>{calls.push({mode,options});if(mode==='invalid')throw new Error('invalid');return {mode};},process:{platform:'win32'},clipboard:{},ClipboardItem:class{},ipcMain:{handle:(_name,fn)=>{handler=fn;}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf("ipcMain.handle('md2chat:test-dingtalk-html'"),source.indexOf(' clipboardConversion=createClipboardConversion')),ctx);
 await assert.rejects(()=>handler('foreign','text'),/untrusted/);ctx.clipboardConversion.busy=true;
 await assert.rejects(()=>handler('trusted','text'),/稍候/);ctx.clipboardConversion.busy=false;ctx.copying=true;
 await assert.rejects(()=>handler('trusted','text'),/稍候/);assert.equal(calls.length,0);ctx.copying=false;
 await assert.rejects(()=>handler('trusted','invalid'),/invalid/);assert.equal(ctx.copying,false);
 assert.equal((await handler('trusted','rewrite')).mode,'rewrite');assert.equal(calls[1].options.platform,'win32');assert.equal(ctx.copying,false);
});
