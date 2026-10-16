const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');

function fixture(platform='win32'){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,disabled:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn;}});return nodes.get(id);};
 const tests=['text','rewrite'].map(mode=>({...node(mode),dataset:{dingtalkHtmlTest:mode}}));
 const writes=[];
 const ctx={
  document:{getElementById:node,querySelectorAll:selector=>selector==='[data-dingtalk-html-test]'?tests:[]},
  window:{md2chatDesktop:platform?{platform,testDingtalkHtml:async mode=>{writes.push(mode);return {mode};}}:undefined},
  copying:false,lastCopyTarget:null,button:{disabled:false},cachedPayload:{},cachedSource:'source',serializeInput:()=> 'source'
 };
 vm.createContext(ctx);
 vm.runInContext(app.slice(app.indexOf('const dingtalkHtmlTests='),app.indexOf('// Reports intentionally')),ctx);
 return {ctx,node,tests,writes};
}

test('Mac and web hide Windows HTML experiments; busy copies block them',async()=>{
 for(const platform of ['darwin',null]){
  const f=fixture(platform);assert(f.node('dingtalk-html-tests').hidden);
  await f.tests[0].listeners.click();assert.equal(f.writes.length,0);
 }
 const f=fixture();f.ctx.copying=true;await f.tests[0].listeners.click();assert.equal(f.writes.length,0);
});

test('HTML tests run only on explicit Windows clicks and explain clipboard replacement',async()=>{
 const f=fixture();assert.equal(f.writes.length,0);assert.equal(f.node('dingtalk-html-tests').hidden,false);
 await f.tests[0].listeners.click();assert.deepEqual(f.writes,['text']);assert.match(f.node('diagnostic-status').textContent,/替换.*无图片/);
 await f.tests[1].listeners.click();assert.deepEqual(f.writes,['text','rewrite']);assert.match(f.node('diagnostic-status').textContent,/文档内容不变/);
 assert.equal(f.ctx.lastCopyTarget,'dingtalk');assert.equal(f.ctx.copying,false);assert(f.tests.every(button=>!button.disabled));
 f.ctx.window.md2chatDesktop.testDingtalkHtml=async()=>{throw new Error('没有 HTML');};
 await f.tests[1].listeners.click();assert.match(f.node('diagnostic-status').textContent,/未完成.*没有 HTML/);assert.equal(f.ctx.copying,false);
});
