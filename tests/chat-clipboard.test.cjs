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
test('copy progress advances only after success and does not advance after denied clipboard access',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/app.js'),'utf8');
 const payload={segments:[{type:'text',text:'前文'},{type:'image',src:'PNG'},{type:'text',text:'后文'}]};
 const ctx={cachedPayload:payload,cachedSource:'input',serializeInput:()=> 'input',previewTimer:0,clearTimeout(){},status:{},copyMode:{value:'segments'},segmentIndex:0,updateCopyControls(){},ChatClipboard:{writeSegment:async()=>{}},button:{addEventListener:(_,fn)=>ctx.click=fn}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf("button.addEventListener('click',async()=>{"),source.indexOf('\nupdatePreview();')),ctx);
 await ctx.click();assert.equal(ctx.segmentIndex,1);assert.match(ctx.status.textContent,/已复制第 1\/3/);
 ctx.ChatClipboard.writeSegment=async()=>{throw new Error('denied')};await ctx.click();assert.equal(ctx.segmentIndex,1);assert.match(ctx.status.textContent,/段落未前进/);
 ctx.ChatClipboard.writeSegment=async()=>{};await ctx.click();await ctx.click();assert.equal(ctx.segmentIndex,2);assert.match(ctx.status.textContent,/最后一段/);
});
