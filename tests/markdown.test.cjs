const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const chat=require('../assets/chat-markdown.js');
const plain=s=>chat.parse(s).map(b=>b.text||'').join('\n');
test('headings, emphasis, tasks, nested lists and references',()=>{
 assert.equal(plain('# 标题'),'【标题】');assert.equal(plain('标题\n==='),'【标题】');
 const runs=chat.parse('**粗 *粗斜*** ~~删除~~ `a_b`')[0].runs;
 assert(runs.some(r=>r.text==='粗斜'&&r.bold&&r.italic));assert(runs.some(r=>r.strikethrough));assert(runs.some(r=>r.text==='a_b'&&r.code));
 assert.equal(plain('- [x] 完成\n- [ ] 待办'),'☑ 完成\n☐ 待办');
 assert.equal(plain('3. 三\n4. 四\n   - 子项'),'3. 三\n4. 四\n  • 子项');
 assert(plain('> 外层\n>\n>> 内层').includes('│ │ 内层'));
 assert.equal(plain('[文档][site]\n\n[site]: https://example.com'),'文档（https://example.com）');
 assert.equal(plain('https://example.com'),'https://example.com');
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
function payloadContext(){
 const ctx={ChatMarkdown:chat,assets:new Map([['1',{src:'data:image/png;base64,ORIGINAL',width:32,height:24}]]),ensureImage:async a=>a,renderTable:()=>[{src:'data:image/png;base64,TABLE',width:100,height:100}]};vm.createContext(ctx);
 vm.runInContext(code.slice(code.indexOf('const escapeHtml='),code.indexOf('const assets='))+code.slice(code.indexOf('function parseMarkdown('),code.indexOf('function renderTable('))+code.slice(code.indexOf('async function buildPayload('),code.indexOf('let cachedSource=')),ctx);return ctx;
}
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
test('diagnostic reports exclude clipboard text content',async()=>{
 const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id)};
 const ctx={document:{getElementById:el},window:{isSecureContext:true},navigator:{clipboard:{}},Blob};vm.createContext(ctx);
 const start=code.indexOf('const diagnosticStatus=');const end=code.indexOf("document.getElementById('read-clipboard').addEventListener");vm.runInContext(code.slice(start,end),ctx);
 await ctx.showSample('测试',[{type:'text/plain',blob:new Blob(['PRIVATE-SAMPLE-123'])}]);
 assert(!el('diagnostic-report').textContent.includes('PRIVATE-SAMPLE'));assert(el('diagnostic-report').textContent.includes('text/plain'));
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
