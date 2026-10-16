const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('tray renderer uses isolated image assets and selects email table segments without changing editor state',async()=>{
 const code=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8'),seen=[];
 const editorAssets=new Map([['1',{src:'editor-image'}]]),segments=[{type:'image',src:'clipboard-image'}],emailSegments=[{type:'table',rows:[['标题']]}];
 const png={type:'image',src:'data:image/png;base64,AAAA'};
 const ctx={ChatTargets:require('../assets/chat-targets.js'),ClipboardImage:{render:async parts=>{assert.equal(parts,segments);return png;}},assets:editorAssets,window:{},safeImageSource:src=>src==='clipboard-image',htmlToSource(){},ClipboardSource:{toSource:async(_item,{registerImage})=>registerImage('clipboard-image')},buildPayload:async(source,imageAssets)=>{seen.push({source,imageAssets});return {segments,emailSegments};}};
 vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('async function convertClipboardContent(')),ctx);
 assert.equal(await ctx.convertClipboardContent([{}],'wechat'),segments);
 assert.equal(await ctx.convertClipboardContent([{}],'email'),emailSegments);
 assert.equal((await ctx.convertClipboardContent([{}],'image'))[0],png);
 assert.equal(editorAssets.get('1').src,'editor-image');assert.equal(editorAssets.size,1);
 assert.equal(seen[0].imageAssets.get('1').src,'clipboard-image');assert.notEqual(seen[0].imageAssets,seen[1].imageAssets);
});
