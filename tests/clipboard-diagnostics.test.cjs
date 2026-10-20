const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {summarizeHtml,htmlLines,formatName}=require('../assets/clipboard-diagnostics.js');

test('diagnostic HTML summary distinguishes picture sources without exposing URLs or text',()=>{
 const html='<div class="private-container"><p>PRIVATE_BODY<img src="https://private.example/secret.png?token=PRIVATE_TOKEN#fragment" width="320" height="180" data-auth-media-id="PRIVATE_ID"></p><img src="file:///C:/PRIVATE_PATH/photo.png"><img src="dingtalk://PRIVATE_RESOURCE"></div>';
 const summary=summarizeHtml(html);
 assert.equal(summary.imageCount,3);assert.equal(summary.tableCount,0);
 assert.deepEqual(summary.images[0],{source:{kind:'https',query:true,fragment:true,mime:'other',base64:false,bytes:null},attributes:['src','width','height','data-auth-media-id'],width:320,height:180,ancestors:['p','div'],srcset:false});
 assert.equal(summary.images[1].source.kind,'file');assert.equal(summary.images[2].source.kind,'other');
 const serialized=JSON.stringify(summary)+'\n'+htmlLines(summary).join('\n');
 for(const secret of ['PRIVATE_BODY','private.example','secret.png','PRIVATE_TOKEN','PRIVATE_ID','PRIVATE_PATH','PRIVATE_RESOURCE','private-container'])assert.equal(serialized.includes(secret),false,secret);
});

test('data images report only an allowlisted MIME, encoding and decoded byte count',()=>{
 const summary=summarizeHtml('<img src="data:image/png;base64,AQIDBA=="><img src="data:image/svg+xml,%3Csvg%3E%E4%B8%AD%3C/svg%3E"><img src="data:PRIVATE_MIME;base64,AAAA"><img src="data:image/png;base64,INVALID!">');
 assert.deepEqual(summary.images[0].source,{kind:'data',query:false,fragment:false,mime:'image/png',base64:true,bytes:4});
 assert.equal(summary.images[1].source.mime,'image/svg+xml');assert.equal(summary.images[1].source.bytes,14);
 assert.equal(summary.images[2].source.mime,'other');assert.equal(summary.images[3].source.bytes,null);
 assert.equal(htmlLines(summary).join('\n').includes('PRIVATE_MIME'),false);
});

test('all source categories and query/fragment flags are finite metadata',()=>{
 const sources=['http://private/a','blob:https://private/uuid','cid:private-id','../private/a.png?x#y','','//private/a.png','PRIVATE-SCHEME:secret'];
 const summary=summarizeHtml(sources.map(src=>'<img src="'+src+'">').join(''));
 assert.deepEqual(summary.images.map(image=>image.source.kind),['http','blob','cid','relative','empty','relative','other']);
 assert.equal(summary.images[3].source.query,true);assert.equal(summary.images[3].source.fragment,true);
});

test('entity decoding handles encoded schemes and dimensions without disclosing values',()=>{
 const summary=summarizeHtml('<IMG SRC="h&#116;tps&colon;//secret/a?x=1&amp;y=2&#35;part" WIDTH="&#51;20" height="180px"><img src="data&colon;image/png;base64,AQI&#61;"><img src="&#x66;ile:///secret">');
 assert.equal(summary.images[0].source.kind,'https');assert.equal(summary.images[0].source.query,true);assert.equal(summary.images[0].source.fragment,true);assert.equal(summary.images[0].width,320);assert.equal(summary.images[0].height,180);
 assert.equal(summary.images[1].source.bytes,2);assert.equal(summary.images[2].source.kind,'file');
});

test('quoted greater-than characters and image-looking attribute values do not break lexical scanning',()=>{
 const summary=summarizeHtml('<div title="<img src=secret>"><img alt="a > b <table>" src="https://private/a>b" data-type="image"></div>');
 assert.equal(summary.imageCount,1);assert.equal(summary.tableCount,0);assert.deepEqual(summary.images[0].ancestors,['div']);
 assert.deepEqual(summary.images[0].attributes,['alt','src','data-type']);
});

test('comments and raw-text elements do not contribute fake images, tables or fragment markers',()=>{
 const raw=['script','style','textarea','title','xmp','iframe','noembed','noframes','noscript'];
 const summary=summarizeHtml('<!-- <img src="secret"> -->'+raw.map(tag=>'<'+tag+'>fake <img src="secret"><table><!--StartFragment--></'+tag+'>').join('')+'<img src="relative.png"><plaintext><img src="secret">');
 assert.equal(summary.imageCount,1);assert.equal(summary.tableCount,0);assert.deepEqual(summary.fragment,{start:false,end:false});
});

test('a raw-text closing token must have a tag-name boundary',()=>{
 const summary=summarizeHtml('<script></script-private><img src="secret"></script><img src="real.png">');
 assert.equal(summary.imageCount,1);
});

test('HTML fragments and structural counts survive independently of body content',()=>{
 const summary=summarizeHtml('<!DOCTYPE html><html><body><!--StartFragment--><div><table><tr><th>A</th><td><img src="a"></td></tr></table></div><!--EndFragment--></body></html>');
 assert.deepEqual(summary.fragment,{start:true,end:true});assert.equal(summary.tableCount,1);
 assert.deepEqual(summary.images[0].ancestors,['td','tr','table','div']);assert.equal(summary.tags.table,1);assert.equal(summary.tags.img,1);assert.equal(summary.tags.html,1);
 assert.match(htmlLines(summary).join('\n'),/StartFragment.*有.*EndFragment.*有/);
});

test('void tags do not become ancestors and matching closes remove nested ancestors',()=>{
 const summary=summarizeHtml('<div><br><input><section><p></section><img src="a"><hr><img src="b"></div><img src="c">');
 assert.deepEqual(summary.images.map(image=>image.ancestors),[['div'],['div'],[]]);
});

test('unknown tag and attribute names never appear in returned metadata',()=>{
 const summary=summarizeHtml('<PRIVATE_TAG><img PRIVATE_TOKEN="x" onerror="secret" data-private-token="secret" DATA-MEDIA-ID="secret" data-width="240" width="50%" height="-1" srcset="private 1x"></PRIVATE_TAG>');
 assert.deepEqual(summary.tags,{other:1,img:1});assert.deepEqual(summary.images[0].attributes,['other','data-media-id','data-width','width','height','srcset']);
 assert.deepEqual(summary.images[0].ancestors,['other']);assert.equal(summary.images[0].width,null);assert.equal(summary.images[0].height,null);assert.equal(summary.images[0].srcset,true);
 assert.equal(JSON.stringify(summary).toLowerCase().includes('private'),false);
});

test('empty, unquoted and duplicate attributes use HTML first-attribute semantics',()=>{
 const summary=summarizeHtml('<img src=http://private/a width=120 height=60 src="file:///ignored" width=900><img src><img>');
 assert.equal(summary.images[0].source.kind,'http');assert.equal(summary.images[0].width,120);assert.equal(summary.images[1].source.kind,'empty');assert.equal(summary.images[2].source.kind,'empty');
 assert.deepEqual(summary.images[0].attributes,['src','width','height']);
});

test('picture detail limit is explicit while total picture counts remain accurate',()=>{
 const summary=summarizeHtml('<img src="a">'.repeat(27));
 assert.equal(summary.imageCount,27);assert.equal(summary.images.length,20);assert.equal(summary.truncated,true);
 assert.match(htmlLines(summary).join('\n'),/截断/);
});

test('oversized inputs, attributes and ancestry are bounded and marked truncated',()=>{
 const huge=summarizeHtml('x'.repeat(8*1024*1024)+'<img src="private">');
 assert.equal(huge.imageCount,0);assert.equal(huge.truncated,true);
 const depth=summarizeHtml('<div>'.repeat(400)+'<img src="a">'+'</div>'.repeat(400));
 assert.equal(depth.truncated,true);assert.equal(depth.images[0].ancestors.length,4);
 const attrs=summarizeHtml('<img '+Array.from({length:150},(_,i)=>'private'+i+'="secret"').join(' ')+'>');
 assert.equal(attrs.truncated,true);assert.deepEqual(attrs.images[0].attributes,['other']);
});

test('malformed HTML finishes safely and does not invent attributes from unclosed quotes',()=>{
 for(const html of ['<','<!-- unfinished','<img src="https://secret/a>','<img src="data:image/png;base64,AAAA"','<script>unclosed <img src="secret">'])assert.doesNotThrow(()=>summarizeHtml(html));
 assert.equal(summarizeHtml('<img src="https://secret/a>').imageCount,0);
});

test('summary validates input types',()=>{
 for(const input of [undefined,null,{},[],42,true])assert.throws(()=>summarizeHtml(input),TypeError);
 assert.deepEqual(summarizeHtml(''),{images:[],imageCount:0,tableCount:0,tags:{},fragment:{start:false,end:false},truncated:false});
});

test('UMD exposes the same diagnostics in a browser without DOM globals',()=>{
 const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/clipboard-diagnostics.js'),'utf8'),context);
 assert.equal(typeof context.ClipboardDiagnostics.summarizeHtml,'function');
 assert.equal(context.ClipboardDiagnostics.summarizeHtml('<img src="https://secret">').images[0].source.kind,'https');
});

test('human-readable metadata sanitizes malformed external summaries too',()=>{
 const lines=htmlLines({imageCount:1,tableCount:0,tags:{'PRIVATE_TAG':1,img:1},fragment:{start:true,end:false},images:[{source:{kind:'PRIVATE_URL',mime:'PRIVATE_MIME',bytes:'PRIVATE_BYTES',query:true},attributes:['src','PRIVATE_TOKEN'],ancestors:['PRIVATE_TAG'],width:'PRIVATE_WIDTH',height:10,srcset:false}]});
 assert.equal(lines.join('\n').includes('PRIVATE_'),false);
});

test('clipboard format names are allowlisted instead of exposing custom names',()=>{
 for(const name of ['text/html','text/plain','text/rtf','text/uri-list','image/png','image/jpeg','image/gif','image/webp','image/bmp','image/tiff','image/svg+xml','application/bookmark','electron application/bookmark','HTML Format','application/osclipboard;format="HTML Format"','application/osclipboard;format="com.dingtalk.richTextAttributedString"','electron application/osclipboard;format="HTML Format"','electron application/osclipboard;format="com.dingtalk.richTextAttributedString"'])assert.equal(formatName(name),name);
 assert.equal(formatName('application/private-token'),'其他格式');
 assert.equal(formatName('application/osclipboard;format="C:/PRIVATE_PATH"'),'其他系统格式');
 assert.equal(formatName(null),'其他格式');
});

test('ZIP opens in an independent reader and preserves native bytes, decoded text, custom names and two samples',async()=>{
 const {capture,bundle}=require('../assets/clipboard-diagnostics.js'),os=require('node:os'),{spawnSync}=require('node:child_process');
 const html='<p>正文😀</p><img src="https://private.example/a?token=secret">',binary=Buffer.from([0,255,3,128,0]);
 const first=await capture([{item:2,type:'text/html',nativeType:'HTML Format (ID 49300)',base64:Buffer.from('CF_HTML_HEADER\r\n'+html+'\0').toString('base64'),html,text:'CF_HTML_HEADER\r\n'+html},
  {type:'application/private',nativeType:'com.private/path',base64:binary.toString('base64')},
  {type:'private/json',blob:new Blob(['{"content":"用户正文"}'])},
  {type:'CF_BITMAP',error:'对象句柄无法导出'}],{origin:'system',version:'test',platform:'win32'});
 const second=await capture([{type:'text/plain',blob:new Blob(['第二次样本'])}],{origin:'paste',platform:'browser'});
 assert.equal(first.incomplete,true);assert.equal(first.formats[0].html.imageCount,1);
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-zip-'));
 try{
  const file=path.join(directory,'bundle.zip');fs.writeFileSync(file,Buffer.from(await bundle([first,second]).arrayBuffer()));
  const result=spawnSync('python3',['-c',`
import sys,zipfile,json
with zipfile.ZipFile(sys.argv[1]) as archive:
 assert archive.testzip() is None
 manifest=json.loads(archive.read('manifest.json'))
 assert len(manifest['samples'])==2
 sample=manifest['samples'][0]
 assert sample['formats'][0]['nativeType']=='HTML Format (ID 49300)'
 assert archive.read('sample-1/format-0001.bin').endswith(b'\\x00')
 assert b'CF_HTML_HEADER' in archive.read('sample-1/format-0001.bin')
 assert '正文😀' in archive.read('sample-1/format-0001.html.txt').decode()
 assert archive.read('sample-1/format-0002.bin')==bytes([0,255,3,128,0])
 assert json.loads(archive.read('sample-1/format-0003.parsed.json'))['content']=='用户正文'
 assert archive.read('sample-2/format-0001.txt').decode()=='第二次样本'
 assert '对象句柄' in sample['formats'][3]['error']
 assert all('..' not in name and not name.startswith('/') for name in archive.namelist())
 assert all(info.compress_type==zipfile.ZIP_STORED for info in archive.infolist())
` ,file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('capture records limits and decode failures while preserving successfully captured bytes',async()=>{
 const {capture,CAPTURE_LIMIT}=require('../assets/clipboard-diagnostics.js');let decoded=false;
 const sample=await capture([{type:'huge',blob:{size:CAPTURE_LIMIT+1,arrayBuffer(){decoded=true;throw new Error();}}},
  {type:'corrupt-base64',base64:'%%%'},{type:'utf16',blob:new Blob([Buffer.from([0xff,0xfe,0x2d,0x4e])])},
  {type:'text/plain',blob:new Blob(['sample'])}]);
 assert.equal(decoded,false);assert.equal(sample.incomplete,true);assert.match(sample.formats[0].error,/60 MiB/);
 assert.match(sample.formats[1].error,/读取/);assert.equal(sample.formats[2].preview,'中');assert.equal(sample.formats[3].preview,'sample');
});

test('HTML diagnostic details decode chat JSON attributes and preserve URLs as data',async()=>{
 const {capture}=require('../assets/clipboard-diagnostics.js');
 const html='<p data-clipboard-cangjie="{&quot;children&quot;:[{&quot;src&quot;:&quot;file:///C:/image.png&quot;}]}">正文</p><img src="https://private/a?token=x&amp;b=y"><script>"<img src=bad>"</script>';
 const sample=await capture([{type:'text/html',blob:new Blob([html])}]);
 const file=sample.files.find(file=>file.name.endsWith('.html-details.json')),detail=JSON.parse(new TextDecoder().decode(file.data));
 assert.equal(detail.tags[0].attributes[0].json.children[0].src,'file:///C:/image.png');
 assert.equal(detail.tags.filter(tag=>tag.name==='img').length,1);
 assert.equal(detail.tags.find(tag=>tag.name==='img').attributes[0].value,'https://private/a?token=x&b=y');
});
