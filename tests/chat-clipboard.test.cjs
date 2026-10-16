const {test}=require('node:test'),assert=require('node:assert/strict');
const {writeSegment}=require('../assets/chat-clipboard.js');
const fs=require('node:fs'),vm=require('node:vm');
test('segment copy writes editable text or real PNG bytes, never competing representations',async()=>{
 const calls=[],png=Uint8Array.from([137,80,78,71,13,10,26,10]);
 const env={Blob,atob,ClipboardItem:class{constructor(data){this.data=data}},navigator:{clipboard:{writeText:async text=>calls.push(text),write:async items=>calls.push(items)}}};
 await writeSegment({type:'text',text:'前文'},env);
 await writeSegment({type:'image',src:'data:image/png;base64,'+Buffer.from(png).toString('base64')},env);
 await writeSegment({type:'text',text:'后文'},env);
 assert.equal(calls[0],'前文');assert.equal(calls[2],'后文');
 const item=calls[1][0];assert.deepEqual(Object.keys(item.data),['image/png']);
 const blob=await item.data['image/png'];assert.equal(blob.type,'image/png');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),png);
 env.navigator.clipboard.write=async items=>{await items[0].data['image/png']};
 await assert.rejects(()=>writeSegment({type:'image',src:'https://example.com/image.png'},env),/尚未转换/);
});
test('platform copy uses selected target, serializes requests and recovers from denial',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
 const payload={segments:[{type:'text',text:'前文'}],emailSegments:[{type:'table',rows:[['标题']]}],preview:'preview'};
 const calls=[],buttons=['wechat','email'].map(target=>({dataset:{copyTarget:target},setAttribute(){},addEventListener(_,fn){this.click=fn}}));
 const notices=[];
 const ctx={showCopyNotice:(text,error=false)=>notices.push({text,error}),cachedPayload:payload,cachedSource:'input',serializeInput:()=> 'input',previewTimer:0,clearTimeout(){},status:{},document:{getElementById:()=>({})},conversionSummary:()=>'summary',copying:false,lastCopyTarget:null,copyButtons:buttons,button:{},message:{},ChatTargets:require('../assets/chat-targets.js'),window:{md2chatDesktop:{copy:async(parts,target)=>{calls.push({parts,target});return {images:0,native:false}}}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf("for(const copyButton of copyButtons)copyButton.addEventListener"),source.indexOf('\nupdatePreview();')),ctx);
 await buttons[0].click();assert.equal(calls[0].target,'wechat');assert.equal(calls[0].parts,payload.segments);assert.equal(ctx.lastCopyTarget,'wechat');assert.match(notices.at(-1).text,/已复制到剪贴板.*微信/);assert.equal(notices.at(-1).error,false);
 await buttons[1].click();assert.equal(calls[1].target,'email');assert.equal(calls[1].parts,payload.emailSegments);assert.match(ctx.message.innerHTML,/<table/);
 ctx.window.md2chatDesktop.copy=async()=>{throw new Error('denied')};await buttons[0].click();assert.equal(ctx.lastCopyTarget,'email');assert.equal(ctx.copying,false);assert.equal(ctx.button.disabled,false);assert.match(ctx.status.textContent,/denied/);assert.equal(notices.at(-1).error,true);assert(!notices.at(-1).text.includes('已复制'));
 ctx.copying=true;await buttons[0].click();assert.equal(calls.length,2);
});
