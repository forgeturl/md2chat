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
test('Mac WeCom sends the full text-image-text sequence to the native copy command once',async()=>{
 const f=fixture('darwin');await f.click();assert.equal(f.panels.length,0);assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].parts,f.parts);assert.equal(f.calls[0].target,'wecom');assert.equal(f.context.lastCopyTarget,'wecom');
});
test('Windows and website keep the existing WeCom segment workflow',async()=>{
 for(const platform of ['win32',undefined]){const f=fixture(platform);await f.click();assert.equal(f.calls.length,0);assert.equal(f.panels[0],f.parts);}
});
