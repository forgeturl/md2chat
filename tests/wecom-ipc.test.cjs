const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {makeWecomSegmentData}=require('../desktop/wecom-segment.cjs');
const source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
function setup(){
 const writes=[];let handler;
 const ctx={copying:false,clipboardConversion:{busy:false},trusted:event=>{if(event!=='trusted')throw new Error('untrusted');},makeWecomSegmentData,nativeImage:{createFromDataURL:()=>({isEmpty:()=>false,getSize:()=>({width:2,height:2}),toPNG:()=>Buffer.from('normalized PNG')})},ClipboardItem:class{constructor(data){this.data=data;}},clipboard:{write:async items=>{writes.push(items);}},ipcMain:{handle:(_channel,fn)=>{handler=fn;}}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf("ipcMain.handle('md2chat:copy-wecom-segment'"),source.indexOf("ipcMain.handle('md2chat:inspect'")),ctx);
 return {ctx,writes,copy:(event,segment)=>handler(event,segment)};
}
test('WeCom IPC rejects foreign frames and busy conversions before reading segment data',async()=>{
 const f=setup();
 await assert.rejects(()=>f.copy('foreign',{type:'text',text:'test'}),/untrusted/);
 f.ctx.clipboardConversion.busy=true;
 await assert.rejects(()=>f.copy('trusted',{type:'text',text:'test'}),/稍候/);
 f.ctx.clipboardConversion.busy=false;f.ctx.copying=true;
 await assert.rejects(()=>f.copy('trusted',{type:'text',text:'test'}),/稍候/);
 assert.equal(f.writes.length,0);
});
test('WeCom IPC writes only one representation and recovers after an invalid segment',async()=>{
 const f=setup();
 await assert.rejects(()=>f.copy('trusted',{type:'image',src:'https://example.com/x.png'}));
 assert.equal(f.ctx.copying,false);assert.equal(f.writes.length,0);
 assert.equal((await f.copy('trusted',{type:'text',text:'editable\n'})).type,'text');
 assert.deepEqual(Object.keys(f.writes[0][0].data),['text/plain']);
 assert.equal(f.writes[0][0].data['text/plain'],'editable\n');
 await f.copy('trusted',{type:'image',src:'data:image/png;base64,AAAA'});
 assert.deepEqual(Object.keys(f.writes[1][0].data),['image/png']);
 assert.equal(await f.writes[1][0].data['image/png'].text(),'normalized PNG');assert.equal(f.ctx.copying,false);
});
test('failed native writes release the WeCom IPC copy lock for retry',async()=>{
 const f=setup();f.ctx.clipboard.write=async()=>{throw new Error('denied');};
 await assert.rejects(()=>f.copy('trusted',{type:'text',text:'test'}),/denied/);assert.equal(f.ctx.copying,false);
});
