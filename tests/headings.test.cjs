const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const markdown=require('../assets/chat-markdown.js'),payload=require('../assets/chat-payload.js');
const targets=require('../assets/chat-targets.js'),matrix=require('./fixtures/heading-capabilities.json');
const PNG='data:image/png;base64,AAAA';
async function build(source){
 return payload.build(source,{markdown,renderers:{},renderTable:()=>[{src:PNG,width:30,height:20}],ensureImage:async asset=>({...asset,width:30,height:20})});
}
const headingSource=Array.from({length:6},(_,i)=>'#'.repeat(i+1)+' 标题'+(i+1)).join('\n\n');

test('all heading levels and Setext headings retain text, spacing and handwritten brackets',()=>{
 const blocks=markdown.parse(headingSource+'\n\n【手写正文】\n\n# 【手写标题】\n\n一级\n===\n\n二级\n---');
 for(let i=0;i<6;i++){
  assert.equal(blocks[i].text,'标题'+(i+1));
  assert.deepEqual(blocks[i].runs[0],{text:'标题'+(i+1),bold:true,heading:i+1});
 }
 assert.equal(blocks[6].text,'【手写正文】\n');assert.equal(blocks[6].runs[0].heading,undefined);
 assert.equal(blocks[7].text,'【手写标题】');
 assert.equal(blocks[8].runs[0].heading,1);assert.equal(blocks[9].runs[0].heading,2);
 assert.equal(markdown.parse('```md\n# 原样\n```')[0].text,'# 原样');
 assert.equal(markdown.parse('\\# 普通文字')[0].runs[0].heading,undefined);
 const nested=markdown.parse('> ## 引用标题\n\n- ### 列表标题');
 assert(nested[0].text.includes('│ 引用标题'));assert(nested[1].text.includes('• 列表标题'));
 assert(nested.every(block=>block.runs.some(run=>run.heading&&run.bold)));
});

test('platform headings keep body emphasis, image order and source data intact',async()=>{
 const result=await build(headingSource+'\n\n**正文加粗**\n\n![图]('+PNG+')\n\n## 【手写标题】');
 const original=JSON.stringify(result.segments);
 assert(!result.plain.includes('【标题'));assert(result.preview.includes('<strong>标题1</strong>'));
 assert.deepEqual(result.segments.map(part=>part.type),['text','image','text']);
 for(const {target,platform,style} of matrix){
  assert.equal(targets.headingStyle(target,platform),style,target+'/'+platform);
  if(target==='image')continue;
  const output=targets.render(target==='email'?result.emailSegments:result.segments,target,platform);
  for(let i=1;i<=6;i++)assert.equal(output.html.includes('<strong>标题'+i+'</strong>'),style==='bold',target+'/'+platform+'/'+i);
  assert(output.html.includes('<strong>正文加粗</strong>'));
  assert.equal(output.imageCount,1);assert.equal(output.plain,result.plain);
  assert(output.html.indexOf('正文加粗')<output.html.indexOf('<img'));
  assert(output.html.indexOf('<img')<output.html.indexOf('【手写标题】'));
 }
 assert.equal(JSON.stringify(result.segments),original);
 const segments=require('../assets/wecom-segments.js').snapshotParts(result.segments);
 const writes=[];
 await require('../assets/chat-clipboard.js').writeSegment(segments[0],{navigator:{clipboard:{writeText:async text=>writes.push(text)}}});
 assert(writes[0].startsWith('标题1\n标题2'));assert(!writes[0].includes('【标题'));
});

test('tray and shortcut conversion preserve heading metadata until the platform export',async()=>{
 const source=fs.readFileSync(require.resolve('../assets/app.js'),'utf8');
 const context={ChatTargets:targets,window:{},safeImageSource:()=>true,ClipboardSource:{toSource:async item=>item.plain},htmlToSource(){},
  buildPayload:build,ClipboardImage:{render:async parts=>{assert(parts[0].runs.some(run=>run.heading===2&&run.bold));return {type:'image',src:PNG};}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function convertClipboardContent(')),context);
 for(const {target,platform,style,available} of matrix){
  if(platform==='web'||!available)continue;
  const parts=await context.convertClipboardContent([{plain:'## 标题\n\n**正文加粗**'}],target);
  if(target==='image'){assert.equal(parts[0].src,PNG);continue;}
  assert.equal(parts[0].text,'标题\n正文加粗');
  assert(parts[0].runs.some(run=>run.heading===2));
  assert.equal(targets.render(parts,target,platform).html.includes('<strong>标题</strong>'),style==='bold');
 }
});

test('copy preview follows the selected platform without changing the generic bold preview',async()=>{
 const source=fs.readFileSync(require.resolve('../assets/app.js'),'utf8');
 const result=await build('## 标题\n\n**正文加粗**');
 for(const {target,platform,style,available} of matrix){
  if(!available||target==='image')continue;
  const b={dataset:{copyTarget:target},setAttribute(){},addEventListener(_event,fn){this.click=fn;}};
  const context={ChatTargets:targets,window:{md2chatDesktop:platform==='web'?undefined:{platform,copy:async()=>({images:0})}},
   desktopRequired:()=>false,copyButtons:[b],copying:false,button:{},cachedPayload:result,cachedSource:'source',serializeInput:()=>'source',
   clearTimeout(){},previewTimer:0,status:{},message:{},document:{getElementById:()=>({})},showCopyNotice(){},conversionSummary:()=>'',copyTargetNote:()=>'',
   navigator:{clipboard:{write:async()=>{}}},Blob,ClipboardItem:class{}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('for(const copyButton of copyButtons)copyButton.addEventListener'),source.indexOf('\nupdatePreview();')),context);
  await b.click();
  assert.equal(context.message.innerHTML.includes('<strong>标题</strong>'),style==='bold',target+'/'+platform);
  assert(context.message.innerHTML.includes('<strong>正文加粗</strong>'));
 }
 assert(result.preview.includes('<strong>标题</strong>'));
});
