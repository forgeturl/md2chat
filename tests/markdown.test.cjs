const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const chat=require('../assets/chat-markdown.js');
const plain=s=>chat.parse(s).map(b=>b.text||'').join('\n');
test('headings, emphasis, tasks, nested lists and references',()=>{
 assert.equal(plain('# 标题'),'标题');assert.equal(plain('标题\n==='),'标题');
 const runs=chat.parse('**粗 *粗斜*** ~~删除~~ `a_b`')[0].runs;
 assert(runs.some(r=>r.text==='粗斜'&&r.bold&&r.italic));assert(runs.some(r=>r.strikethrough));assert(runs.some(r=>r.text==='a_b'&&r.code));
 assert.equal(plain('- [x] 完成\n- [ ] 待办'),'✅ 完成\n⬜ 待办');
 assert.equal(plain('3. 三\n4. 四\n   - 子项'),'3. 三\n4. 四\n  • 子项');
 assert(plain('> 外层\n>\n>> 内层').includes('│ │ 内层'));
 assert.equal(plain('[文档][site]\n\n[site]: https://example.com'),'文档（https://example.com）');
 assert.equal(plain('https://example.com'),'https://example.com');
});
test('task emojis remain editable with emphasis, nesting and uppercase checked markers',()=>{
 const blocks=chat.parse('- [X] **完成**\n  - [ ] 待办\n\n> - [x] 引用');
 assert.equal(blocks.map(block=>block.text).join('\n'),'✅ 完成\n  ⬜ 待办\n\n✅ │ 引用');
 assert(blocks.every(block=>block.type==='text'&&block.runs.map(run=>run.text).join('')===block.text));
 assert(blocks[0].runs.some(run=>run.text==='完成'&&run.bold));
 assert.equal(plain('`- [x] 原样`'),'- [x] 原样');
 assert.equal(plain('```text\n- [ ] 原样\n```'),'- [ ] 原样');
});
test('code, escapes and paragraph spacing are preserved',()=>{
 const code='  const a = "**literal**";\n\n  <script>x</script>\n  [[DING_IMAGE:9]]';
 assert.equal(plain('```js\n'+code+'\n```'),code);
 assert.equal(plain('\\*原样\\* a_b_c'),'*原样* a_b_c');
 assert.equal(plain('甲\n\n乙'),'甲\n\n乙');
});
test('GFM tables, escaped pipes and inline images',()=>{
 assert.equal(chat.parse('| A | B |\n|---|---|\n|a\\|b|**粗**|')[0].rows[0][0],'a|b');
 assert.equal(chat.parse('\\|A\\|B\\|\n\\|---\\|---\\|\n\\|1\\|2\\|')[0].rows.length,1);
 assert.deepEqual(chat.parse('前文 [[DING_IMAGE:1]] 后文').map(b=>b.type),['text','image','text']);
 assert.equal(chat.parse('![图](https://example.com/a.png "说明")')[0].src,'https://example.com/a.png');
 assert.equal(chat.parse('![图](https://example.com/a.png "说明")')[0].markdown,'![图](https://example.com/a.png "说明")');
 const source='```md\n![假](http://example.com/same)\n```\n\n- ![真](http://example.com/same)';
 const image=chat.parse(source).find(block=>block.type==='image');
 assert.equal(source.slice(image.sourceStart,image.sourceEnd),'![真](http://example.com/same)');
 const reference='![引用][asset]\n\n[asset]: https://example.com/ref.png';
 const referenced=chat.parse(reference).find(block=>block.type==='image');assert.equal(reference.slice(referenced.sourceStart,referenced.sourceEnd),'![引用][asset]');
});
test('raw HTML and links cannot inject active markup',()=>{
 assert(!chat.runsHtml(chat.parse('<img src=x onerror=alert(1)>')[0].runs).includes('<img'));
 assert(!chat.runsHtml(chat.parse('[点](javascript:alert%281%29)')[0].runs).includes('href='));
});
test('image boundaries collapse extra newlines without losing styles or code indentation',()=>{
 const blocks=[{type:'text',text:'甲\n\n',runs:[{text:'甲',bold:true},{text:'\n\n'}]},{type:'image',id:'1'},{type:'text',text:'\n\n  乙',runs:[{text:'\n\n  乙',code:true}]}];
 const result=chat.compactImages(blocks);assert.equal(result[0].text,'甲');assert.equal(result[2].text,'  乙');assert(result[0].runs[0].bold);assert(result[2].runs[0].code);
 assert.equal(blocks[0].text,'甲\n\n');
});
const code=fs.readFileSync(path.join(__dirname,'../assets/app.js'),'utf8');
test('HTML tables containing images fail explicitly instead of silently dropping those images',()=>{
 const table={nodeType:1,nodeName:'TABLE',querySelector:selector=>selector==='img'?{}:null};
 const ctx={registerImage(){assert.fail('must not partially import');},document:{createElement:()=>({content:{nodeType:11,nodeName:'#document-fragment',childNodes:[table]}})}};
 vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('function htmlToSource('),code.indexOf('function sourceFragment(')),ctx);
 assert.throws(()=>ctx.htmlToSource('<table><tr><td><img src="data:image/png;base64,AAAA"></td></tr></table>'),/表格单元格中的图片/);
});
function payloadContext(){
 const ctx={ChatMarkdown:chat,ChatPayload:require('../assets/chat-payload.js'),ChatRenderers:{},assets:new Map([['1',{src:'data:image/png;base64,ORIGINAL',width:32,height:24}]]),ensureImage:async a=>a,renderTable:()=>[{src:'data:image/png;base64,TABLE',width:100,height:100}]};vm.createContext(ctx);
 vm.runInContext(code.slice(code.indexOf('const escapeHtml='),code.indexOf('const assets='))+code.slice(code.indexOf('function buildPayload('),code.indexOf('let cachedSource=')),ctx);return ctx;
}
test('task emojis survive chat, email, plaintext and WeCom segments without becoming images',async()=>{
 const {render,profiles}=require('../assets/chat-targets.js');
 const {snapshotParts}=require('../assets/wecom-segments.js');
 const result=await payloadContext().buildPayload('- [x] **完成**\n- [ ] 待办\n\n[[DING_IMAGE:1]]\n\n- [X] 后续');
 assert.equal(result.imageCount,1);assert.equal(result.originalImages,1);
 assert.equal(result.plain,'✅ 完成\n⬜ 待办\n[图片]\n✅ 后续');
 assert(result.html.includes('✅ <strong>完成</strong>'));assert(result.preview.includes('⬜ 待办'));
 for(const target of Object.keys(profiles)){
  const parts=target==='email'?result.emailSegments:result.segments;
  const output=render(parts,target);
  assert.equal(output.plain,result.plain);assert.equal(output.imageCount,1);
  assert(output.html.includes('✅ <strong>完成</strong>'));assert(output.html.includes('⬜ 待办'));
 }
 const segments=snapshotParts(result.segments);
 assert.deepEqual(Array.from(segments,part=>part.type),['text','image','text']);
 assert.equal(segments[0].text,'✅ 完成\n⬜ 待办\n');assert.equal(segments[2].text,'\n✅ 后续');
 assert(segments.filter(part=>part.type==='text').every(part=>part.runs.map(run=>run.text).join('')===part.text));
});
test('payload retains table contents in text fallback and images in HTML order',async()=>{
 const ctx=payloadContext(),result=await ctx.buildPayload('# 示例\n\n**文字**\n\n|A|B|\n|---|---|\n|1|2|\n\n[[DING_IMAGE:1]]\n\n尾文');
 assert.equal(result.tableCount,1);assert.equal(result.imageCount,2);assert(result.html.includes('<strong>文字</strong>'));
 assert(result.html.indexOf('TABLE')<result.html.indexOf('ORIGINAL'));assert(result.plain.includes('A | B\n1 | 2'));assert(result.plain.includes('尾文'));
 await assert.rejects(()=>ctx.buildPayload('[图片]'),/占位符/);await assert.rejects(()=>ctx.buildPayload('[[DING_IMAGE:999]]'),/失效/);
 const fixture=fs.readFileSync(path.join(__dirname,'../examples/reading-club.md'),'utf8');assert.equal(chat.parse(fixture).find(b=>b.type==='table').rows.length,2);
});
test('remote images load by default without credentials, unsafe schemes are rejected',async()=>{
 const requests=[];const ctx={AbortSignal,fetch:async(url,options)=>{requests.push({url,options});return {ok:false,status:403};}};vm.createContext(ctx);
 vm.runInContext(code.slice(code.indexOf('function safeImageSource('),code.indexOf('function registerImage('))+code.slice(code.indexOf('async function ensureImage('),code.indexOf("input.addEventListener('click'")),ctx);
 await assert.rejects(()=>ctx.ensureImage({src:'https://example.com/photo.png'}),/HTTP 403/);assert.equal(requests.length,1);assert.equal(requests[0].url,'https://example.com/photo.png');assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.referrerPolicy,'no-referrer');
 await assert.rejects(()=>ctx.ensureImage({src:'javascript:alert(1)'}),/不受支持/);assert.equal(requests.length,1);
});
test('remote image normalization preserves its existing HTTPS source for Windows copies',async()=>{
 const requests=[],remote='https://example.com/original.png?size=large',data='data:image/png;base64,AAAA';
 class Image{constructor(){this.naturalWidth=320;this.naturalHeight=200;}set src(_value){this.onload();}}
 const ctx={AbortSignal,Image,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,blob:async()=>new Blob(['PNG'],{type:'image/png'})};},blobToData:async()=>data};
 vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('function safeImageSource('),code.indexOf('function registerImage('))+code.slice(code.indexOf('async function ensureImage('),code.indexOf("input.addEventListener('click'")),ctx);
 const asset={src:remote};await ctx.ensureImage(asset);
 assert.equal(asset.src,data);assert.equal(asset.sourceUrl,remote);assert.equal(requests.length,1);
 await ctx.ensureImage(asset);assert.equal(requests.length,1);assert.equal(asset.sourceUrl,remote);
 const local={src:data};await ctx.ensureImage(local);assert.equal(local.sourceUrl,undefined);
 const http={src:'http://example.com/image.png'};await ctx.ensureImage(http);assert.equal(http.sourceUrl,undefined);
});
test('desktop Markdown local images are embedded in preview and copy segments in source order',async()=>{
 const ctx=payloadContext(),requests=[],filename='/private/tmp/md2chat-local.png',data='data:image/png;base64,AAAA';
 ctx.window={md2chatDesktop:{readLocalImage:async src=>{requests.push(src);return data;}}};
 ctx.Image=class{constructor(){this.naturalWidth=320;this.naturalHeight=200;}set src(value){assert.equal(value,data);this.onload();}};
 ctx.fetch=()=>assert.fail('local images must not use network fetch');
 vm.runInContext(code.slice(code.indexOf('function safeImageSource('),code.indexOf('function registerImage('))+code.slice(code.indexOf('async function ensureImage('),code.indexOf("input.addEventListener('click'")),ctx);
 const result=await ctx.buildPayload('前文\n\n![游戏实际效果]('+filename+')\n\n后文');
 assert.deepEqual(requests,[filename]);
 assert.deepEqual(Array.from(result.segments,part=>part.type),['text','image','text']);
 assert.equal(result.segments[1].src,data);assert.equal(result.segments[1].displayWidth,320);
 assert.equal(result.segments[1].sourceUrl,undefined);assert.equal(result.originalImages,1);
 assert(result.preview.includes('<img src="'+data+'"'));assert(!result.html.includes(filename));
});
test('local image paths require the desktop Markdown path, never HTML or browser fetch',async()=>{
 const requests=[],ctx={window:{},fetch:()=>assert.fail('local paths must not be fetched'),assets:new Map(),nextAsset:1};vm.createContext(ctx);
 vm.runInContext(code.slice(code.indexOf('function safeImageSource('),code.indexOf('function htmlToSource('))+code.slice(code.indexOf('async function ensureImage('),code.indexOf("input.addEventListener('click'")),ctx);
 for(const src of ['/tmp/image.png','file:///tmp/image.png','C:\\Pictures\\image.png']){
  await assert.rejects(()=>ctx.ensureImage({src},{allowLocal:true}),/桌面版.*网页版/);
 }
 ctx.window.md2chatDesktop={readLocalImage:async src=>{requests.push(src);return 'data:image/png;base64,AAAA';}};
 await assert.rejects(()=>ctx.ensureImage({src:'/tmp/image.png'}),/不受支持/);
 assert.throws(()=>ctx.registerImage('file:///tmp/image.png'),/无法读取/);
 assert.equal(requests.length,0);
});
test('local image failures identify the file with a short reason',async()=>{
 const ctx=payloadContext();ctx.URL=URL;
 ctx.window={md2chatDesktop:{readLocalImage:async()=>{throw new Error('不支持的图片格式。');}}};
 vm.runInContext(code.slice(code.indexOf('function safeImageSource('),code.indexOf('function registerImage('))+code.slice(code.indexOf('async function ensureImage('),code.indexOf("input.addEventListener('click'")),ctx);
 for(const source of ['/tmp/theme-plaques.provenance.json','file:///tmp/%E7%94%9F%E6%88%90%20%E8%AE%B0%E5%BD%95.json','C:\\Pictures\\记录.json']){
  const filename=source.startsWith('file:')?'生成 记录.json':source.split(/[\\/]/).at(-1);
  await assert.rejects(()=>ctx.buildPayload('![记录]('+source+')'),{message:source+'：不支持的图片格式。'});
 }
 ctx.window.md2chatDesktop.readLocalImage=async()=>{throw new Error('文件不存在。');};
 await assert.rejects(()=>ctx.buildPayload('![图](/tmp/missing.png)'),{message:'/tmp/missing.png：文件不存在。'});
 ctx.window.md2chatDesktop.readLocalImage=async()=>'<invalid image>';
 await assert.rejects(()=>ctx.buildPayload('![图](/tmp/invalid.png)'),{message:'/tmp/invalid.png：图片数据无效。'});
 ctx.window.md2chatDesktop.readLocalImage=async()=>'data:image/png;base64,AAAA';
 ctx.Image=class{set src(_value){this.onerror();}};
 await assert.rejects(()=>ctx.buildPayload('![图](/tmp/broken.png)'),{message:'/tmp/broken.png：图片无法解码。'});
});
test('Markdown image failures retain the complete resource and source markup',async()=>{
 const ctx=payloadContext(),resource='http://127.0.0.1:54847/index.html',markup='![本地试玩]('+resource+')';
 ctx.ensureImage=async()=>{throw new Error('返回的不是图片。');};
 await assert.rejects(()=>ctx.buildPayload('前文\n\n'+markup+'\n\n后文'),error=>{
  assert.equal(error.message,resource+'：返回的不是图片。');
  assert.equal(error.sourceMarkup,markup);assert.equal(('前文\n\n'+markup+'\n\n后文').slice(error.sourceStart,error.sourceEnd),markup);return true;
 });
 const embedded='data:image/png;base64,'+'A'.repeat(10000);ctx.ensureImage=async()=>{const error=new Error('The operation timed out');error.name='TimeoutError';throw error;};
 await assert.rejects(()=>ctx.buildPayload('![图]('+embedded+')'),error=>error.message==='内嵌图片：读取超时。'&&!error.message.includes('AAAA'));
});
test('source error ranges target the complete failing Markdown image reference',()=>{
 const markup='![本地试玩](http://127.0.0.1:54847/index.html)',source='```md\n'+markup+'\n```\n\n'+markup+'\n\n后文',start=source.lastIndexOf(markup);
 const ctx={};vm.createContext(ctx);
 vm.runInContext(code.slice(code.indexOf('function sourceErrorRange('),code.indexOf('function clearInputError(')),ctx);
 const range=ctx.sourceErrorRange(source,{sourceMarkup:markup,sourceStart:start,sourceEnd:start+markup.length});
 assert.equal(range.start,start);assert.equal(source.slice(range.start,range.end),markup);
 assert.equal(ctx.sourceErrorRange(source,{sourceMarkup:'不存在'}),null);
});
test('editing invalidates an in-flight preview before the debounce fires',()=>{
 let inputHandler;
 const ctx={renderVersion:4,clearInputError(){},button:{},cachedPayload:{},previewTimer:1,status:{},
  input:{addEventListener:(name,handler)=>{assert.equal(name,'input');inputHandler=handler;}},
  clearTimeout(){},setTimeout(){return 2;},updatePreview(){}};
 vm.createContext(ctx);
 vm.runInContext(code.slice(code.indexOf("input.addEventListener('input'"),code.indexOf('function nativeCopy(')),ctx);
 inputHandler();
 assert.equal(ctx.renderVersion,5);
 assert.equal(ctx.cachedPayload,null);
 assert.equal(ctx.previewTimer,2);
});
test('only imported original images carry source URLs through generated segments',async()=>{
 const ctx=payloadContext(),sourceUrl='https://example.com/original.png';
 ctx.assets.get('1').sourceUrl=sourceUrl;
 ctx.ChatRenderers={code:async()=>[{src:'data:image/png;base64,CODE',width:40,height:20,sourceUrl:'https://example.com/SHOULD-NOT-PROPAGATE'}]};
 const result=await ctx.buildPayload('[[DING_IMAGE:1]]\n\n| A | B |\n|---|---|\n|1|2|\n\n```js\nconst x=1;\n```');
 const images=result.segments.filter(part=>part.type==='image');
 assert.equal(images.length,3);assert.equal(images[0].sourceUrl,sourceUrl);
 assert(images.slice(1).every(part=>part.sourceUrl===undefined));
 assert.equal(result.emailSegments.find(part=>part.type==='image').sourceUrl,sourceUrl);
 assert(!result.preview.includes(sourceUrl));assert(!result.html.includes(sourceUrl));
});
test('inline and display math parsing does not interpret code or currency as math',()=>{
 const inline=chat.parse('能量 $E=mc^2$，以及 \\(a+b\\)。')[0];
 assert.deepEqual(inline.runs.filter(r=>r.math).map(r=>r.math),['E=mc^2','a+b']);
 assert.equal(chat.parse('$$\n\\frac{1}{2}\n$$')[0].tex,'\\frac{1}{2}');
 assert.equal(chat.parse('\\[x^2\\]')[0].tex,'x^2');
 assert(!chat.parse('`$x$`')[0].runs.some(r=>r.math));
 assert(!chat.parse('价格 $5 和 $10')[0].runs.some(r=>r.math));
 assert(!chat.parse('\\$x\\$')[0].runs.some(r=>r.math));
 assert.equal(chat.parse('```js\nconst x = "$y$";\n```')[0].type,'code');
 assert.equal(chat.parse('```mermaid\nflowchart LR\n A-->B\n```')[0].type,'mermaid');
 assert.equal(chat.parse('```text\nflowchart LR\n A-->B\n```')[0].type,'code');
});
test('math and diagrams enter the copied HTML as PNG, plaintext retains their source',async()=>{
 const ctx=payloadContext();const calls=[];
 const image={src:'data:image/png;base64,RENDERED',width:80,height:40,displayWidth:40,displayHeight:20};
 ctx.ChatRenderers={math:async(tex,display)=>{calls.push({tex,display});return image},mermaid:async source=>{calls.push({source});return image}};
 const result=await ctx.buildPayload('前文 $x^2$ 后文\n\n$$\\frac{1}{2}$$\n\n```mermaid\nflowchart LR\n A-->B\n```');
 assert.equal(result.mathImages,2);assert.equal(result.mermaidImages,1);assert.equal(result.imageCount,3);
 assert.equal((result.html.match(/<img /g)||[]).length,3);assert(result.html.includes('前文 <img'));assert(result.html.includes('vertical-align:middle'));
 assert(result.plain.includes('$x^2$'));assert(result.plain.includes('\\frac{1}{2}'));assert(result.plain.includes('```mermaid\nflowchart LR\n A-->B\n```'));
 assert.equal(calls[0].display,false);
 ctx.ChatRenderers.math=async()=>{throw new Error('测试错误')};await assert.rejects(()=>ctx.buildPayload('$bad$'),/第 1 个公式：测试错误/);
 ctx.ChatRenderers.mermaid=async()=>{throw new Error('测试错误')};await assert.rejects(()=>ctx.buildPayload('```mermaid\nbad\n```'),/第 1 个 Mermaid 图：测试错误/);
});
test('renderers reject external resources and per-diagram config before loading libraries',async()=>{
 const ctx={URL,document:{currentScript:{src:'https://example.com/md2chat/assets/renderers.js'}}};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/renderers.js'),'utf8'),ctx);
 await assert.rejects(()=>ctx.ChatRenderers.math('\\require{html}'),/外部资源/);
 await assert.rejects(()=>ctx.ChatRenderers.mermaid('%%{init: {securityLevel: "loose"}}%%\nflowchart LR\n A-->B'),/配置/);
 await assert.rejects(()=>ctx.ChatRenderers.mermaid('flowchart LR\n A[https://example.com]'),/外部资源/);
});
test('code payload uses colored image parts in order and retains complete source fallback',async()=>{
 const ctx=payloadContext();const source='const value = "<script> & ```";\n\tconsole.log(value);';
 ctx.ChatRenderers={code:async(text,lang)=>{assert.equal(text,source);assert.equal(lang,'js');return [1,2].map(n=>({src:'data:image/png;base64,CODE'+n,width:100,height:40,displayWidth:50,displayHeight:20}));}};
 const result=await ctx.buildPayload('开头\n\n~~~~js\n'+source+'\n~~~~\n\n结尾');
 assert.equal(result.codeImages,2);assert.equal(result.imageCount,2);
 assert(result.html.indexOf('CODE1')<result.html.indexOf('CODE2'));assert(result.html.indexOf('CODE2')<result.html.indexOf('结尾'));
 assert(result.plain.includes('````js\n'+source+'\n````'));assert(!result.html.includes('<script>'));
 assert.equal(chat.parse('```JavaScript title=test\nconst x=1;\n```')[0].language,'javascript');
 ctx.ChatRenderers.code=async()=>{throw new Error('测试错误')};await assert.rejects(()=>ctx.buildPayload('```js\na\n```'),/第 1 个代码块：测试错误/);
});
test('chat segments preserve editable text around each real image without table fallback duplication',async()=>{
 const result=await payloadContext().buildPayload('开头 **文字**\n\n| 项目 | 数量 |\n|---|---|\n| 苹果 | 2 |\n\n结束文字');
 assert.deepEqual(Array.from(result.segments||[],s=>s.type),['text','image','text']);
 assert.equal(result.segments[0].text,'开头 文字');assert.equal(result.segments[1].src,'data:image/png;base64,TABLE');assert.equal(result.segments[2].text,'结束文字');
 const only=await payloadContext().buildPayload('只有文字\n\n下一段');assert.equal(only.segments.length,1);assert.equal(only.segments[0].text,'只有文字\n\n下一段');
});

test('email replaces table image groups with one editable table without changing chat segments',async()=>{
 const ctx=payloadContext();const payload=await ctx.buildPayload('前文\n\n| 品名 | 数量 |\n| --- | --- |\n| 苹果 | 2 |\n\n后文');
 assert.equal(payload.emailSegments.map(s=>s.type).join(','),'text,table,text');
 assert.equal(payload.segments.map(s=>s.type).join(','),'text,image,text');
 assert.equal(payload.emailSegments[1].rows[1][0],'苹果');
 assert.equal(payload.emailSegments[0].text,'前文');assert.equal(payload.emailSegments[2].text,'后文');
});
