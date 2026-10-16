const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeWecomSegmentData}=require('../desktop/wecom-segment.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const source={type:'image',src:'data:image/jpeg;base64,/9j/2Q=='};
function native({width=1,height=1,bytes=png,empty=false}={}) {
 return {createFromDataURL:()=>({isEmpty:()=>empty,getSize:()=>({width,height}),toPNG:()=>bytes})};
}

test('WeCom text segments contain only editable plain text',async()=>{
 const text='前文 <strong>文字</strong>\n后文';
 const result=await makeWecomSegmentData({type:'text',text,runs:[{text,bold:true}]});
 assert.equal(result.type,'text');assert.deepEqual(result.data,{'text/plain':text});
});

test('WeCom image segments use only normalized PNG bytes',async()=>{
 let decoded;
 const nativeImage=native();const decode=nativeImage.createFromDataURL;
 nativeImage.createFromDataURL=src=>{decoded=src;return decode(src);};
 const result=await makeWecomSegmentData(source,{nativeImage});
 assert.equal(decoded,source.src);assert.equal(result.type,'image');
 assert.deepEqual(Object.keys(result.data),['image/png']);
 const blob=result.data['image/png'];assert.equal(blob.type,'image/png');
 assert.deepEqual(Buffer.from(await blob.arrayBuffer()),png);
});

test('WeCom segment validation rejects non-segments, tables and external image references before decoding',async()=>{
 let calls=0;const nativeImage={createFromDataURL:()=>{calls++;throw new Error('unexpected decode');}};
 for(const segment of [null,{},[],{type:'table',rows:[['a']]},{type:'html',html:'x'},{type:'text',text:1},...['https://example.com/a.png','file:///tmp/a.png','data:image/svg+xml;base64,AAAA','data:image/png;base64,!!!'].map(src=>({type:'image',src}))])await assert.rejects(()=>makeWecomSegmentData(segment,{nativeImage}));
 assert.equal(calls,0);
});

test('WeCom segment validation rejects oversized source data before decoding',async()=>{
 let calls=0;const nativeImage={createFromDataURL:()=>{calls++;}};
 await assert.rejects(()=>makeWecomSegmentData({type:'text',text:'a'.repeat(2*1024*1024+1)},{nativeImage}),/文字过长/);
 await assert.rejects(()=>makeWecomSegmentData({type:'image',src:'data:image/png;base64,'+'A'.repeat(15*1024*1024)},{nativeImage}),/图片必须/);
 assert.equal(calls,0);
});

test('WeCom image segments reject failed decoding, invalid dimensions and excessive decoded pixels',async()=>{
 await assert.rejects(()=>makeWecomSegmentData(source,{nativeImage:{createFromDataURL:()=>{throw new Error('bad image');}}}),/图片解码失败/);
 await assert.rejects(()=>makeWecomSegmentData(source,{nativeImage:native({empty:true})}),/图片解码失败/);
 for(const dimensions of [{width:0},{height:-1},{width:Infinity},{height:NaN},{width:1.5}])await assert.rejects(()=>makeWecomSegmentData(source,{nativeImage:native(dimensions)}),/图片尺寸无效/);
 await assert.rejects(()=>makeWecomSegmentData(source,{nativeImage:native({width:5000,height:4001})}),/2000 万像素/);
 assert.equal((await makeWecomSegmentData(source,{nativeImage:native({width:5000,height:4000})})).type,'image');
});

test('WeCom image segments reject empty or oversized PNG encoding',async()=>{
 await assert.rejects(()=>makeWecomSegmentData(source,{nativeImage:native({bytes:Buffer.alloc(0)})}),/图片转换失败/);
 await assert.rejects(()=>makeWecomSegmentData(source,{nativeImage:native({bytes:Buffer.alloc(15*1024*1024+1)})}),/转换后的图片过大/);
});
