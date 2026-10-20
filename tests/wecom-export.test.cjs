const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../assets/app.js'),'utf8');
function fixture(platform){
 const calls=[],panels=[],parts=[{type:'text',text:'前文😀'},{type:'image',src:'data:image/png;base64,AAAA'},{type:'text',text:'后文'}];
 const b={dataset:{copyTarget:'wecom'},addEventListener(_e,fn){this.click=fn;},setAttribute(){}};
 const context={window:{md2chatDesktop:platform?{platform,copy:async(value,target)=>{calls.push({parts:value,target});return {images:1,wecomNative:platform==='darwin'};}}:undefined},
 desktopRequired:()=>false,copyButtons:[b],copying:false,button:{},cachedSource:'sample',cachedPayload:{segments:parts,preview:'preview'},serializeInput:()=>'sample',
 clearTimeout(){},previewTimer:0,status:{},message:{},document:{getElementById:()=>({})},ChatTargets:require('../assets/chat-targets.js'),
 wecomSegments:{open:value=>panels.push(value)},showCopyNotice(){},conversionSummary:()=>'summary',copyTargetNote:()=>''};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('for(const copyButton of copyButtons)copyButton.addEventListener'),source.indexOf('\nupdatePreview();')),context);
 return {click:()=>b.click(),calls,panels,parts,context};
}
test('Mac and Windows WeCom send the full text-image-text sequence to the native copy command once',async()=>{
 for(const platform of ['darwin','win32']){
 const f=fixture(platform);await f.click();assert.equal(f.panels.length,0);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].parts,f.parts);assert.equal(f.calls[0].target,'wecom');assert.equal(f.context.lastCopyTarget,'wecom');
 }
});
test('website keeps the existing WeCom segment workflow',async()=>{
 const f=fixture();await f.click();assert.equal(f.calls.length,0);assert.equal(f.panels[0],f.parts);
});

test('Markdown numbered lists and emphasis survive the Windows copy boundary with ordered image segments',async()=>{
 const markdown=require('../assets/chat-markdown.js'),payload=require('../assets/chat-payload.js');
 const src='data:image/png;base64,AAAA';
 const source='## 中文😀\n\n3. **编号三**\n4. 编号四\n\n- 项目甲\n\n![图]('+src+')\n\n尾文';
 const result=await payload.build(source,{markdown,renderers:{},renderTable:()=>[],ensureImage:async asset=>({...asset,width:30,height:20})});
 const f=fixture('win32');f.context.cachedPayload=result;await f.click();
 assert.equal(f.panels.length,0);assert.equal(f.calls.length,1);
 const copied=f.calls[0].parts;
 assert.deepEqual(copied.map(part=>part.type),['text','image','text']);
 assert(copied[0].text.includes('3. 编号三\n4. 编号四'));
 assert(copied[0].text.includes('• 项目甲'));
 assert(copied[0].runs.some(run=>run.text==='编号三'&&run.bold));
 assert(copied[0].text.includes('中文😀'));assert.equal(copied[1].src,src);
 assert(copied[2].text.includes('尾文'));
});
