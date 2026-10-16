const {test}=require('node:test'),assert=require('node:assert/strict');
const {runDingtalkHtmlTest}=require('../desktop/dingtalk-html-test.cjs');
const sample='<article><!--StartFragment--><p>PRIVATE正文</p><p><img src="file:///PRIVATE_PATH/a.png"></p><!--EndFragment--></article>';
function item(html,types=['text/html']){return {types,getType:async type=>{assert.equal(type,'text/html');return new Blob([html],{type});}};}
function fixture(items=[item(sample)]){
 const writes=[],reads=[];
 class ClipboardItem{constructor(data){this.data=data;this.types=Object.keys(data);}}
 const clipboard={read:async()=>{reads.push(1);return items;},write:async data=>writes.push(data)};
 return {writes,reads,clipboard,options:{clipboard,ClipboardItem,platform:'win32'}};
}
test('fixed text experiment writes only its fixed HTML and never reads clipboard content',async()=>{
 const f=fixture(),result=await runDingtalkHtmlTest('text',f.options);
 assert.equal(f.reads.length,0);assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0][0].types,['text/html']);
 assert.equal(f.writes[0][0].data['text/html'],'<article><p><strong>md2chat HTML 文字测试</strong></p></article>');
 assert.equal(result.mode,'text');assert.equal(result.htmlImages,0);assert.equal(result.bytes,Buffer.byteLength(f.writes[0][0].data['text/html']));
});
test('rewrite preserves the exact HTML string, checks it twice, and returns metadata only',async()=>{
 const f=fixture(),result=await runDingtalkHtmlTest('rewrite',f.options);
 assert.equal(f.reads.length,2);assert.deepEqual(f.writes[0][0].types,['text/html']);assert.equal(f.writes[0][0].data['text/html'],sample);
 assert.equal(result.mode,'rewrite');assert.equal(result.htmlImages,1);assert.equal(result.bytes,Buffer.byteLength(sample));
 assert(!JSON.stringify(result).includes('PRIVATE'));assert(!JSON.stringify(result).includes('file:'));
});
test('unsupported platforms and modes fail without reading or writing',async()=>{
 for(const platform of ['darwin','linux','other']){const f=fixture();await assert.rejects(()=>runDingtalkHtmlTest('text',{...f.options,platform}),/Windows/);assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);}
 for(const mode of ['',null,undefined,'html','__proto__',{}]){const f=fixture();await assert.rejects(()=>runDingtalkHtmlTest(mode,f.options),/测试模式/);assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);}
});
test('rewrite requires exactly one readable HTML sample',async()=>{
 for(const entries of [[],[{types:['text/plain'],getType(){assert.fail('plain text must not be read');}}],[item(sample),item(sample)]]){
  const f=fixture(entries);await assert.rejects(()=>runDingtalkHtmlTest('rewrite',f.options),/一份 HTML/);assert.equal(f.writes.length,0);
 }
 const f=fixture([{types:['text/html'],getType:async()=>{throw new Error('PRIVATE_PATH');}}]);
 await assert.rejects(()=>runDingtalkHtmlTest('rewrite',f.options),error=>!error.message.includes('PRIVATE_PATH')&&/读取/.test(error.message));assert.equal(f.writes.length,0);
});
test('HTML size is bounded using both declared size and actual UTF-8 data',async()=>{
 for(const html of ['x'.repeat(8*1024*1024+1),'中'.repeat(Math.floor(8*1024*1024/3)+1)]){
  const f=fixture([item(html)]);await assert.rejects(()=>runDingtalkHtmlTest('rewrite',f.options),/8 MiB/);assert.equal(f.writes.length,0);
 }
 const f=fixture([{types:['text/html'],getType:async()=>({size:1,text:async()=> 'x'.repeat(8*1024*1024+1)})}]);
 await assert.rejects(()=>runDingtalkHtmlTest('rewrite',f.options),/8 MiB/);assert.equal(f.writes.length,0);
});
test('HTML and format changes between snapshots prevent replacement',async()=>{
 for(const changed of [[item(sample+'changed')],[item(sample,['text/html','text/plain'])],[]]){
  const f=fixture();let call=0;f.clipboard.read=async()=>++call===1?[item(sample)]:changed;
  await assert.rejects(()=>runDingtalkHtmlTest('rewrite',f.options),/已更新/);assert.equal(f.writes.length,0);
 }
});
test('format order alone does not count as a clipboard change and other representations are not read',async()=>{
 const f=fixture();let count=0;
 f.clipboard.read=async()=>[item(sample,++count===1?['text/html','text/plain']:['text/plain','text/html'])];
 await runDingtalkHtmlTest('rewrite',f.options);assert.equal(f.writes.length,1);
});
test('read and write failures never disclose original exception details',async()=>{
 const read=fixture();read.clipboard.read=async()=>{throw new Error('PRIVATE_DISK_PATH');};
 await assert.rejects(()=>runDingtalkHtmlTest('rewrite',read.options),error=>/读取/.test(error.message)&&!error.message.includes('PRIVATE'));
 const write=fixture();write.clipboard.write=async()=>{throw new Error('PRIVATE_DISK_PATH');};
 await assert.rejects(()=>runDingtalkHtmlTest('text',write.options),error=>/写入/.test(error.message)&&!error.message.includes('PRIVATE'));
});
test('comments and scripts in rewritten HTML are counted inertly and remain unchanged',async()=>{
 const html='<script>"<img src=PRIVATE>"</script><!--<img src=PRIVATE>--><p><img src="https://PRIVATE"></p>';
 const f=fixture([item(html)]),result=await runDingtalkHtmlTest('rewrite',f.options);
 assert.equal(result.htmlImages,1);assert.equal(f.writes[0][0].data['text/html'],html);assert(!JSON.stringify(result).includes('PRIVATE'));
});
