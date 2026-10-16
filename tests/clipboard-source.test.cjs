const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../assets/clipboard-source.js'),'utf8');
function setup(){
 const registered=[],converted=[];
 const images=html=>[...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gi)].map(match=>({getAttribute:name=>name==='src'?match[1]:null}));
 const context={document:{createElement(tag){assert.equal(tag,'template');return {innerHTML:'',get content(){return {querySelectorAll:selector=>{assert.equal(selector,'img');return images(this.innerHTML);}};}};}}};
 vm.createContext(context);vm.runInContext(code,context);
 const dependencies={registerImage(src){if(!/^data:image\//.test(src)&&!/^https?:\/\//.test(src))throw new Error('图片数据缺失');registered.push(src);return '[[DING_IMAGE:'+registered.length+']]';},htmlToSource(html,registerImage){converted.push(html);return html.replace(/<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gi,(_,src)=>registerImage(src)).replace(/<[^>]*>/g,'');}};
 return {convert:data=>context.ClipboardSource.toSource(data,dependencies),registered,converted};
}
test('clipboard source preserves plain Markdown when HTML supplies the same text',async()=>{
 const {convert,converted,registered}=setup();const source='# 标题\n\n**加粗**';
 assert.equal(await convert({plain:source,html:'<h1>标题</h1><p><strong>加粗</strong></p>'}),source);
 assert.deepEqual(converted,[]);assert.deepEqual(registered,[]);
});
test('HTML-only text and tables are delegated to the existing importer',async()=>{
 const {convert,converted}=setup();const html='<table><tr><td>A</td><td>B</td></tr></table>';
 assert.equal(await convert({html}),'AB');assert.deepEqual(converted,[html]);
 assert.equal(await convert({plain:'  ',html:'<p>只有 HTML 文字</p>'}),'只有 HTML 文字');
});
test('matching plain placeholders retain text and image order',async()=>{
 const {convert,registered,converted}=setup();
 assert.equal(await convert({plain:'开头\n[图片]\n中间\n[图片]\n结尾',html:'<img src="https://example.com/first.png"><img src="https://example.com/second.png">'}),'开头\n[[DING_IMAGE:1]]\n中间\n[[DING_IMAGE:2]]\n结尾');
 assert.deepEqual(registered,['https://example.com/first.png','https://example.com/second.png']);assert.deepEqual(converted,[]);
});
test('HTML supplies image positions when plain placeholders do not match',async()=>{
 const {convert,converted,registered}=setup();const html='<p>开头</p><img src="https://example.com/a.png"><p>结尾</p>';
 assert.equal(await convert({plain:'开头结尾',html}),'开头[[DING_IMAGE:1]]结尾');
 assert.deepEqual(converted,[html]);assert.deepEqual(registered,['https://example.com/a.png']);
});
test('matching standalone images replace HTML references without adding duplicates',async()=>{
 for(const plain of ['前文 [图片] 后文','前文后文']){
  const {convert,registered}=setup();const source=await convert({plain,html:'前文<img src="https://example.com/remote.png">后文',images:['data:image/png;base64,AAAA']});
  assert.equal((source.match(/DING_IMAGE/g)||[]).length,1);assert.deepEqual(registered,['data:image/png;base64,AAAA']);
 }
});
test('mismatched standalone images do not duplicate images already imported from HTML',async()=>{
 const {convert,registered}=setup();
 await convert({html:'<img src="https://example.com/one.png"><img src="https://example.com/two.png">',images:['data:image/png;base64,AAAA']});
 assert.deepEqual(registered,['https://example.com/one.png','https://example.com/two.png']);
});
test('standalone images replace plain placeholders and append extra images in order',async()=>{
 const {convert,registered}=setup();
 assert.equal(await convert({plain:'前文\n[图片]\n后文',images:['data:image/png;base64,AAAA','data:image/png;base64,BBBB']}),'前文\n[[DING_IMAGE:1]]\n后文\n[[DING_IMAGE:2]]');
 assert.deepEqual(registered,['data:image/png;base64,AAAA','data:image/png;base64,BBBB']);
});
test('unresolved image placeholders and unreadable HTML images reject conversion',async()=>{
 const {convert}=setup();
 await assert.rejects(()=>convert({plain:'前文\n[图片]\n后文'}),/占位符/);
 await assert.rejects(()=>convert({html:'<img src="dingtalk://private-image">'}),/图片数据缺失/);
});
test('empty input does not create source or register images',async()=>{
 const {convert,registered}=setup();assert.equal(await convert({}),'');assert.equal(await convert({plain:' \n ',html:'<p></p>'}),'');assert.deepEqual(registered,[]);
});
