const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
const parts=[{type:'text',text:'前文',runs:[{text:'前文',bold:true}]},{type:'image',src:'data:image/png;base64,AAAA',displayWidth:320},{type:'text',text:'后文'}];
test('editor Feishu copy remains one request and explains the required rich-text input',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../assets/app.js'),'utf8'),calls=[],notices=[];
 const copyButton={dataset:{copyTarget:'feishu'},setAttribute(){},addEventListener(_name,callback){this.click=callback;}};
 const payload={segments:parts,preview:'preview'};
 const context={window:{md2chatDesktop:{platform:'darwin',copy:async(value,target)=>{calls.push({value,target});return {images:1,native:false,feishuNative:true};}}},ChatTargets:require('../assets/chat-targets.js'),copyButtons:[copyButton],copying:false,button:{},status:{},message:{},document:{getElementById:()=>({})},cachedPayload:payload,cachedSource:'source',serializeInput:()=>'source',previewTimer:0,clearTimeout(){},conversionSummary:()=>'summary',showCopyNotice:text=>notices.push(text)};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('const desktopRequired='),source.indexOf('\nconst button=')),context);
 vm.runInContext(source.slice(source.indexOf('for(const copyButton of copyButtons)copyButton.addEventListener'),source.indexOf('\nupdatePreview();')),context);
 await copyButton.click();assert.equal(calls.length,1);assert.equal(calls[0].value,parts);assert.equal(calls[0].target,'feishu');
 assert.match(notices.at(-1),/展开飞书富文本输入框.*一次粘贴/);assert.match(context.status.textContent,/普通输入框可能丢图/);
 assert(!context.status.textContent.includes('钉钉'));assert.equal(context.copying,false);
});
