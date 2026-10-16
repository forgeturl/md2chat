// Native clipboard round trip only; this does not test the Feishu client.
// Run explicitly: electron desktop/feishu-smoke.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {makePayload,RAW_FORMAT}=require('./payload.cjs');
const {RAW_FORMAT:FEISHU_RAW_FORMAT,FRAGMENT_TYPE,BUSINESS_TYPE}=require('./feishu.cjs');
const {writeClipboardPayload}=require('./clipboard-write.cjs');
const {summarizeHtml,formatName}=require('../assets/clipboard-diagnostics.js');

// Small, different PNGs with dimensions 2 × 3 and 3 × 2; no network or user files.
const PNGS=[
 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGNQTX79H4QZMBgAvOsOreLUivUAAAAASUVORK5CYII=',
 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGMQW+z1H4YZkDkAlZAMDUl7ctEAAAAASUVORK5CYII='
];
const TEXT={front:'飞书烟测前文🌿',bold:'烟测粗体',italic:'烟测斜体',strike:'烟测删除线',middle:'飞书烟测中间',back:'飞书烟测后文'};

async function readSnapshot(clipboard){
 const items=await clipboard.read(),metadata={itemCount:items.length,formats:[]},values={},types=[],itemTypes=[];
 for(const item of items)itemTypes.push([...item.types]);
 for(const item of items)for(const type of item.types){
  const blob=await item.getType(type);types.push(type);
  metadata.formats.push({type:type===FEISHU_RAW_FORMAT?'feishu_custom_data':formatName(type),bytes:Number.isSafeInteger(blob.size)?blob.size:null});
  if(type==='text/html'||type==='text/plain')values[type]=await blob.text();
  if(type===FEISHU_RAW_FORMAT)values[type]=Buffer.from(await blob.arrayBuffer());
 }
 return {metadata,values,types,itemTypes};
}

function imageSources(html){
 return [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"[^>]*>/gi)].map(match=>({source:match[1],position:match.index}));
}

// Parse the native bytes independently of the production encoder. Chromium's
// custom-data pickle stores a size header, entry count, and aligned UTF-16 pairs.
function parseCustomData(bytes){
 assert(Buffer.isBuffer(bytes));assert(bytes.length>=8);
 assert.equal(bytes.readUInt32LE(0),bytes.length-4);
 const count=bytes.readUInt32LE(4);assert.equal(count,2);let offset=8;
 function readString(){
  assert(offset+4<=bytes.length);const length=bytes.readUInt32LE(offset);offset+=4;
  const end=offset+length*2;assert(end<=bytes.length);
  const value=bytes.toString('utf16le',offset,end);offset=(end+3)&~3;assert(offset<=bytes.length);
  for(let index=end;index<offset;index++)assert.equal(bytes[index],0);
  return value;
 }
 const data=new Map();
 for(let index=0;index<count;index++){const key=readString();assert(!data.has(key));data.set(key,readString());}
 assert.equal(offset,bytes.length);assert.equal(data.get(BUSINESS_TYPE),'IM_CHAT');assert(data.has(FRAGMENT_TYPE));
 return JSON.parse(data.get(FRAGMENT_TYPE));
}

async function checkFragment(fragment,payload,{directory,nativeImage,sources,front}){
 assert.deepEqual(fragment,payload.feishuFragment);
 const zone=fragment.deltas?.['0'];assert.equal(zone?.zoneId,'0');assert.equal(zone?.zoneType,'Z');
 const ops=zone.ops;assert(Array.isArray(ops));assert(ops.every(op=>typeof op.insert==='string'));
 const images=ops.filter(op=>op.attributes?.entityType==='image');assert.equal(images.length,2);
 const textAndImagesOrdered=ops.map(op=>op.insert).join('')===[front,'*',TEXT.middle,'*',TEXT.back].join('\n');
 assert.equal(textAndImagesOrdered,true);
 const styleFor=(text,key)=>ops.some(op=>op.insert===text&&op.attributes?.[key]==='true');
 const styles={bold:styleFor(TEXT.bold,'bold'),italic:styleFor(TEXT.italic,'italic'),strikethrough:styleFor(TEXT.strike,'strikethrough')};
 assert.deepEqual(styles,{bold:true,italic:true,strikethrough:true});
 const cachedImages=[];
 for(const [index,op] of images.entries()){
  assert.equal(op.insert,'*');const image=JSON.parse(op.attributes.image);
  assert.equal(image.imageState,'INITIAL');assert.equal(image.zoneId,'0');assert.equal(image.key,op.attributes.uuid);
  assert(path.isAbsolute(image.src));assert.equal(path.dirname(image.src),directory);assert(/^[a-f0-9]{64}\.png$/.test(path.basename(image.src)));
  const stat=await fs.lstat(image.src);assert(stat.isFile());assert.equal(stat.isSymbolicLink(),false);
  const bytes=await fs.readFile(image.src),expected=nativeImage.createFromDataURL(sources[index]).toPNG();
  assert.deepEqual(bytes,expected);
  const decoded=nativeImage.createFromBuffer(bytes);assert.equal(decoded.isEmpty(),false);const size=decoded.getSize();
  assert.deepEqual(size,index?{width:3,height:2}:{width:2,height:3});assert.deepEqual({width:image.width,height:image.height},size);
  cachedImages.push({bytes:bytes.length,size,bytesMatch:true,insideTemporaryDirectory:true});
 }
 return {businessKeyMatches:true,ops:ops.length,images:images.length,textAndImagesOrdered,styles,cachedImages};
}

async function runFeishuClipboardSmoke({clipboard,ClipboardItem,nativeImage},{platform=process.platform,temporaryRoot=os.tmpdir()}={}){
 const report={schemaVersion:1,status:'running',feishuClientTested:false,
  runtime:{platform,architecture:process.arch,electron:process.versions.electron||null,chromium:process.versions.chrome||null,node:process.versions.node},
  cases:[],clipboardRestored:false,temporaryFilesRemoved:false};
 if(platform!=='darwin'){report.status='failed';report.failure='macos_required';return report;}
 let backup=[],captured=false,directory,phase='clipboard_backup',record;
 try{
  // Materialize every representation before the first write. Abort on any read
  // failure rather than replacing a clipboard that cannot be restored completely.
  for(const item of await clipboard.read()){
   if(!item.types.length)continue;
   const data=Object.create(null);
   for(const type of item.types){const blob=await item.getType(type);data[type]=new Blob([await blob.arrayBuffer()],{type:blob.type});}
   backup.push(new ClipboardItem(data));
  }
  captured=true;
  phase='image_setup';
  directory=await fs.mkdtemp(path.join(temporaryRoot,'md2chat-feishu-native-'));
  const sources=PNGS.map(bytes=>{
   const image=nativeImage.createFromBuffer(Buffer.from(bytes,'base64'));
   assert.equal(image.isEmpty(),false);return image.toDataURL();
  });
  assert.notEqual(sources[0],sources[1]);
  const runs=[{text:TEXT.front+'\n'},{text:TEXT.bold,bold:true},{text:' / '},{text:TEXT.italic,italic:true},{text:' / '},{text:TEXT.strike,strikethrough:true}];
  const front=runs.map(run=>run.text).join('');
  const parts=[{type:'text',text:front,runs},{type:'image',src:sources[0]},{type:'text',text:TEXT.middle},{type:'image',src:sources[1]},{type:'text',text:TEXT.back}];
  record={id:'production_native_html_and_plain',status:'running',check:'write'};report.cases.push(record);
  phase='clipboard_round_trip';
  const payload=await makePayload(parts,{directory,nativeImage,target:'feishu',platform});
  const written=await writeClipboardPayload(payload,{target:'feishu',platform,clipboard,ClipboardItem,imageDirectory:directory});
  record.write={images:written.images,feishuNative:written.feishuNative===true,target:'feishu'};
  record.check='native_read';
  const current=await readSnapshot(clipboard);record.observed=current.metadata;
  record.check='representations';
  assert(current.types.includes('text/html'));assert(current.types.includes('text/plain'));
  assert(current.types.includes(FEISHU_RAW_FORMAT));
  assert(current.itemTypes.some(types=>['text/html','text/plain',FEISHU_RAW_FORMAT].every(type=>types.includes(type))));
  assert(!current.types.includes('image/png'));assert(!current.types.includes(RAW_FORMAT));
  record.check='native_fragment';
  const fragment=parseCustomData(current.values[FEISHU_RAW_FORMAT]);
  record.observed.nativeFragment=await checkFragment(fragment,payload,{directory,nativeImage,sources,front});
  const html=current.values['text/html'],plain=current.values['text/plain'];
  const summary=summarizeHtml(html),images=imageSources(html);
  record.observed.html={images:summary.imageCount,sourceKinds:summary.images.map(image=>image.source.kind),imageSizes:summary.images.map(image=>({width:image.width,height:image.height}))};
  record.check='image_content';
  assert.equal(summary.imageCount,2);assert.equal(images.length,2);
  assert.deepEqual(images.map(image=>image.source),imageSources(payload.html).map(image=>image.source));
  assert.notEqual(images[0].source,images[1].source);
  const sizes=images.map(({source})=>{const image=nativeImage.createFromDataURL(source);assert.equal(image.isEmpty(),false);return image.getSize();});
  record.observed.html.decodedImageSizes=sizes;assert.deepEqual(sizes,[{width:2,height:3},{width:3,height:2}]);
  record.check='content_order';
  const positions=[html.indexOf(TEXT.front),images[0].position,html.indexOf(TEXT.middle),images[1].position,html.indexOf(TEXT.back)];
  record.observed.html.textAndImagesOrdered=positions.every((position,index)=>position>=0&&(!index||position>positions[index-1]));
  assert.equal(record.observed.html.textAndImagesOrdered,true);
  record.observed.plainTextMatches=plain.replace(/\r\n/g,'\n')===[front,'[图片]',TEXT.middle,'[图片]',TEXT.back].join('\n');
  assert.equal(record.observed.plainTextMatches,true);
  record.check='run_styles';
  record.observed.html.styles={bold:html.includes('<strong>'+TEXT.bold+'</strong>'),italic:html.includes('<em>'+TEXT.italic+'</em>'),strikethrough:html.includes('<s>'+TEXT.strike+'</s>')};
  assert.deepEqual(record.observed.html.styles,{bold:true,italic:true,strikethrough:true});
  record.status='passed';delete record.check;
 }catch{
  report.failure=phase+'_failed';
  if(record){record.status='failed';record.failure='native_clipboard_case_failed';}
 }finally{
  try{if(captured){if(backup.length)await clipboard.write(backup);else await clipboard.clear();report.clipboardRestored=true;}}
  catch{report.restoreFailure='clipboard_restore_failed';}
  try{if(directory)await fs.rm(directory,{recursive:true,force:true});report.temporaryFilesRemoved=true;}
  catch{report.cleanupFailure='temporary_cleanup_failed';}
 }
 report.status=!report.failure&&!report.restoreFailure&&!report.cleanupFailure&&report.cases.length===1&&report.cases[0].status==='passed'?'passed':'failed';
 return report;
}

async function main(){
 const electron=require('electron');
 await electron.app.whenReady();
 const report=await runFeishuClipboardSmoke(electron);
 await new Promise(resolve=>process.stdout.write(JSON.stringify(report)+'\n',resolve));
 electron.app.exit(report.status==='passed'?0:1);
}
// Electron 44's default-app loader does not set require.main to this module.
const electronEntry=process.type==='browser'&&process.argv[1]&&path.resolve(process.argv[1])===__filename;
if(require.main===module||electronEntry)main().catch(()=>{process.stdout.write(JSON.stringify({schemaVersion:1,status:'failed',failure:'native_smoke_failed',feishuClientTested:false,cases:[]})+'\n');require('electron').app.exit(1);});
module.exports={runFeishuClipboardSmoke,parseCustomData};
