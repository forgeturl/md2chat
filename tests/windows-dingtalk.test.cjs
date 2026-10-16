const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
test('Windows editor paste delegates file HTML to the restricted cache reader while other inputs stay local',async()=>{
 const source=await fs.readFile(path.join(__dirname,'../assets/app.js'),'utf8'),calls=[];
 const context={window:{md2chatDesktop:{platform:'win32',resolveClipboardHtml:async html=>{calls.push(html);return '<img src="data:image/png;base64,AAAA">';}}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function readableClipboardHtml('),source.indexOf("input.addEventListener('paste'")),context);
 const html='<p><img src="file:///managed-cache.png"></p>';
 assert.match(await context.readableClipboardHtml(html),/data:image/);assert.deepEqual(calls,[html]);
 const remote='<img src="https://example.com/image.png">';assert.equal(await context.readableClipboardHtml(remote),remote);assert.equal(calls.length,1);
 context.window.md2chatDesktop.platform='darwin';assert.equal(await context.readableClipboardHtml(html),html);assert.equal(calls.length,1);
});
