const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspectClipboard}=require('../desktop/clipboard-diagnostics.cjs');
const {RAW_FORMAT}=require('../desktop/payload.cjs');
const item=data=>({types:Object.keys(data),getType:async type=>data[type] instanceof Blob?data[type]:new Blob([data[type]],{type})});

test('Windows HTML diagnostics distinguish image references without returning content or changing the clipboard',async()=>{
 const secret='PRIVATE-WORK-TOKEN';
 const html='<article><p>'+secret+'</p><img src="https://example.com/'+secret+'.png?token='+secret+'" data-media-id="'+secret+'" width="320"><div><img src="file:///C:/Users/'+secret+'/image.png"></div></article>';
 const report=await inspectClipboard({read:async()=>[item({'text/html':html,'image/png':'PNG bytes'})]},{platform:'win32',version:'0.6.2'});
 assert.equal(report.platform,'win32');assert.equal(report.version,'0.6.2');
 assert.equal(report.htmlImages,2);assert.equal(report.htmlTables,0);assert.equal(report.imageFormats,1);
 assert.deepEqual(report.html[0].images.map(image=>image.source.kind),['https','file']);
 assert.equal(report.html[0].images[0].source.query,true);
 assert.deepEqual(report.macDingtalk,{applicable:false,present:false,images:null});
 for(const value of [secret,'example.com','file:///C:'])assert(!JSON.stringify(report).includes(value));
});

test('Mac private image count is separate from HTML images and independent image formats',async()=>{
 const rich={contents:[{text:{items:[{type:'text',data:{text:'PRIVATE-BODY'}},{type:'image',data:{path:'/private/sensitive.png'}}]}}]};
 const report=await inspectClipboard({read:async()=>[item({[RAW_FORMAT]:JSON.stringify(rich),'text/html':'<img src="data:image/png;base64,AAAA">'})]},{platform:'darwin'});
 assert.deepEqual(report.macDingtalk,{applicable:true,present:true,images:1});
 assert.equal(report.htmlImages,1);assert.equal(report.imageFormats,0);
 assert(!JSON.stringify(report).includes('PRIVATE-BODY'));assert(!JSON.stringify(report).includes('sensitive.png'));
 const absent=await inspectClipboard({read:async()=>[]},{platform:'darwin'});
 assert.deepEqual(absent.macDingtalk,{applicable:true,present:false,images:0});
});

test('unreadable, invalid and oversized representations do not hide the remaining metadata',async()=>{
 const failed={types:['private/format'],getType:async()=>{throw new Error('PRIVATE-ERROR-PATH');}};
 const huge={size:8*1024*1024+1,text(){assert.fail('oversized HTML must not be read');}};
 const report=await inspectClipboard({read:async()=>[failed,{types:['text/html'],getType:async()=>huge},item({[RAW_FORMAT]:'not JSON','image/png':'PNG'})]},{platform:'darwin'});
 assert.equal(report.formats[0].unreadable,true);assert.equal(report.formats[1].skipped,true);
 assert.equal(report.macDingtalk.images,null);assert.equal(report.truncated,true);assert.equal(report.imageFormats,1);
 assert(!JSON.stringify(report).includes('PRIVATE-ERROR-PATH'));
});

test('plain text payloads are never decoded for diagnostic reports and format counts are bounded',async()=>{
 const plain={size:12,text(){assert.fail('plain text is not needed');}};
 const report=await inspectClipboard({read:async()=>[{types:['text/plain'],getType:async()=>plain}]},{platform:'win32'});
 assert.equal(report.formats[0].bytes,12);assert.equal(report.html.length,0);
 const many=await inspectClipboard({read:async()=>Array.from({length:150},()=>item({'text/plain':'private'}))},{platform:'win32'});
 assert.equal(many.formats.length,100);assert.equal(many.truncated,true);
});

test('HTML decoding has a total budget across all clipboard entries',async()=>{
 let reads=0;
 const html={size:5*1024*1024,text:async()=>{reads++;return '<img src="https://example.com/a.png">';}};
 const report=await inspectClipboard({read:async()=>[{types:['text/html'],getType:async()=>html},{types:['text/html'],getType:async()=>html}]},{platform:'win32'});
 assert.equal(reads,1);assert.equal(report.htmlImages,1);assert.equal(report.formats[1].skipped,true);assert.equal(report.truncated,true);
});
