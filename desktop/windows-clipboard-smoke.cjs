// Windows only. Run through the installed Electron CLI, never the regular app:
// node node_modules/electron/cli.js desktop/windows-clipboard-smoke.cjs --report artifacts/windows-clipboard.json
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process');
const {makePayload,RAW_FORMAT}=require('./payload.cjs');
const {writeClipboardPayload}=require('./clipboard-write.cjs');
const {makeWecomSegmentData}=require('./wecom-segment.cjs');
const {resolveCachedHtmlImages,readClipboardSource}=require('./clipboard-conversion.cjs');
const {runDingtalkHtmlTest}=require('./dingtalk-html-test.cjs');
const {summarizeHtml,formatName}=require('../assets/clipboard-diagnostics.js');

function parseArguments(args){
 let reportPath;
 for(let index=0;index<args.length;index++){
  if(args[index]!=='--report'||reportPath||typeof args[index+1]!=='string'||!args[index+1]||args[index+1].startsWith('--'))throw new Error('Invalid smoke-test arguments');
  reportPath=path.resolve(args[++index]);
 }
 return {reportPath};
}

// Project only fixed metadata fields; never include probe stdout or an exception.
function probeMetadata(value={}){
 const count=number=>Number.isSafeInteger(number)&&number>=0?number:null;
 return {present:value.present===true,headerValid:value.headerValid===true,
  byteLength:count(value.byteLength),contentByteLength:count(value.contentByteLength),
  validOffsets:value.validOffsets===true,validUtf8:value.validUtf8===true,validUtf8Boundaries:value.validUtf8Boundaries===true,
  fragmentMarkers:{startPresent:value.fragmentMarkers?.startPresent===true,endPresent:value.fragmentMarkers?.endPresent===true},
  fragmentMarkersMatch:value.fragmentMarkersMatch===true,sourceUrlPresent:value.sourceUrlPresent===true};
}

function inspectCfHtml(selfTest=false,execute=execFile){
 // Windows clipboard owners may need to dispatch messages while another process
 // requests delayed data. Keep Electron's main loop running during the probe.
 return new Promise((resolve,reject)=>{
  execute('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'../scripts/inspect-windows-clipboard.ps1'),...(selfTest?['-SelfTest']:[])],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:64*1024},(error,stdout)=>{
   if(error){reject(new Error('CF_HTML probe failed'));return;}
   try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'').trim()));}catch{reject(new Error('CF_HTML probe returned invalid metadata'));}
  });
 });
}

async function snapshot(clipboard,nativeImage){
 const items=await clipboard.read(),metadata={itemCount:items.length,formats:[]},values={};
 for(const item of items)for(const type of item.types){
  const blob=await item.getType(type);
  metadata.formats.push({type:formatName(type),bytes:Number.isSafeInteger(blob?.size)?blob.size:null});
  if(type==='text/html'||type==='text/plain')values[type]=await blob.text();
  if(type==='image/png'){
   const image=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
   assert.equal(image.isEmpty(),false);
   metadata.png=image.getSize();assert(metadata.png.width>0&&metadata.png.height>0);
  }
 }
 metadata.types=[...new Set(metadata.formats.map(format=>format.type))].sort();
 if(values['text/html']!==undefined){
  const html=summarizeHtml(values['text/html']);
  metadata.html={images:html.imageCount,tables:html.tableCount,paragraphs:html.tags.p||0,
   sourceKinds:html.images.map(image=>image.source.kind),imageSizes:html.images.map(image=>({width:image.width,height:image.height}))};
 }
 return {metadata,values};
}

async function runWindowsClipboardSmoke({app,clipboard,ClipboardItem,nativeImage},{onProgress}={}){
 const report={schemaVersion:1,status:'running',dingtalkClientTested:false,
  runtime:{platform:process.platform,architecture:process.arch,osRelease:os.release(),electron:process.versions.electron,chromium:process.versions.chrome,node:process.versions.node},
  cases:[],clipboardRestored:false,temporaryFilesRemoved:false};
 if(process.platform!=='win32'){report.status='failed';report.failure='windows_required';return report;}
 let backup=[],captured=false,directory,phase='cf_html_probe_self_test';
 async function progress(stage,record){
  report.phase=stage;
  if(onProgress)try{await onProgress(report,{phase:stage,...(record?{caseId:record.id,status:record.status,check:record.check}:{})});}
  catch{report.progressFailure='progress_report_failed';report.status='failed';}
 }
 async function observe(record,{html=false,plain=false,images=0,sourceKinds,pngSize}={}){
  record.expected={html,plain,images,sourceKinds,pngSize};record.check='native_read';
  await progress('case_check',record);
  const current=await snapshot(clipboard,nativeImage);record.observed=current.metadata;
  record.check='cf_html_probe';
  await progress('case_check',record);
  const cfHtml=probeMetadata(await inspectCfHtml());record.observed.cfHtml=cfHtml;
  record.check='representations';
  assert.equal(current.values['text/html']!==undefined,html);
  assert.equal(current.values['text/plain']!==undefined,plain);
  assert.equal(await clipboard.has(RAW_FORMAT),false);
  assert.equal(cfHtml.present,html);
  if(html){
   record.check='cf_html_header';
   assert.equal(cfHtml.headerValid,true);assert.equal(cfHtml.validOffsets,true);
   assert.equal(cfHtml.validUtf8,true);assert.equal(cfHtml.validUtf8Boundaries,true);
   if(cfHtml.fragmentMarkers.startPresent||cfHtml.fragmentMarkers.endPresent)assert.equal(cfHtml.fragmentMarkersMatch,true);
   record.check='html_structure';
   assert.equal(current.metadata.html.images,images);
   if(sourceKinds)assert.deepEqual(current.metadata.html.sourceKinds,sourceKinds);
  }
  if(pngSize)assert.deepEqual(current.metadata.png,pngSize);
  record.check='case_content';
  return current;
 }
 async function run(id,operation){
  const record={id,status:'running',check:'write'};report.cases.push(record);await progress('case_start',record);
  try{await operation(record);record.status='passed';delete record.check;}catch{record.status='failed';record.failure='native_clipboard_case_failed';}
  await progress('case_complete',record);
 }
 try{
  await progress(phase);
  const probeSelfTest=await inspectCfHtml(true);
  report.cfHtmlProbeSelfTest={passed:Number.isSafeInteger(probeSelfTest.passed)?probeSelfTest.passed:0};
  assert.equal(probeSelfTest.status,'self_test_passed');assert(report.cfHtmlProbeSelfTest.passed>=9);
  await progress('cf_html_probe_self_test_complete');
  phase='clipboard_backup';
  await progress(phase);
  // Abort before writing anything if every available representation cannot be saved.
  for(const item of await clipboard.read()){
   const data={};for(const type of item.types)data[type]=await item.getType(type);
   backup.push(new ClipboardItem(data));
  }
  captured=true;
  await progress('clipboard_backup_complete');
  phase='image_setup';await progress(phase);
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'md2chat-windows-native-'));
  const imageDirectory=path.join(directory,'clipboard cache & images');await fs.mkdir(imageDirectory);
  const first=nativeImage.createFromBitmap(Buffer.alloc(2*3*4,255),{width:2,height:3,scaleFactor:1});
  const second=nativeImage.createFromBitmap(Buffer.alloc(3*2*4,127),{width:3,height:2,scaleFactor:1});
  assert.equal(first.isEmpty(),false);assert.equal(second.isEmpty(),false);
  const image={type:'image',src:first.toDataURL()},otherImage={type:'image',src:second.toDataURL()};
  const front='烟测前文🌿',middle='烟测中间',back='烟测后文';
  const parts=[{type:'text',text:front},image,{type:'text',text:middle},otherImage,{type:'text',text:back}];
  await progress('image_setup_complete');
  const payload=selected=>makePayload(selected,{directory:imageDirectory,nativeImage,target:'dingtalk',platform:'win32'});
  const write=async(value,target='dingtalk')=>writeClipboardPayload(value,{target,platform:process.platform,clipboard,ClipboardItem,imageDirectory});
  const checkText=(value,expected)=>assert.equal(value.replace(/\r\n/g,'\n'),expected);
  const checkOrder=html=>{
   const positions=[front,middle,back].map(text=>html.indexOf(text));
   assert(positions.every((position,index)=>position>=0&&(!index||position>positions[index-1])));
  };
  await run('plain_text',async record=>{
   await clipboard.writeText(front);
   const current=await observe(record,{plain:true});checkText(current.values['text/plain'],front);
  });
  await run('html_only_no_images',async record=>{
   await runDingtalkHtmlTest('text',{clipboard,ClipboardItem,platform:process.platform});
   const current=await observe(record,{html:true});assert(current.values['text/html'].includes('md2chat HTML 文字测试'));
  });
  await run('production_html_and_plain',async record=>{
   const value=await payload([{type:'text',text:front}]);record.write=await write(value);
   const current=await observe(record,{html:true,plain:true});checkText(current.values['text/plain'],front);
   assert.equal(record.write.native,false);assert.equal(record.write.windowsHtml,false);
  });
  await run('production_one_file_image',async record=>{
   const value=await payload([{type:'text',text:front},image,{type:'text',text:back}]);record.write=await write(value);
   const current=await observe(record,{html:true,plain:true,images:1,sourceKinds:['file']});
   checkText(current.values['text/plain'],front+'\n[图片]\n'+back);
   assert.equal(record.write.windowsHtml,true);assert.deepEqual(current.metadata.html.imageSizes,[{width:2,height:3}]);
  });
  await run('production_two_file_images',async record=>{
   const value=await payload(parts);record.write=await write(value);
   const current=await observe(record,{html:true,plain:true,images:2,sourceKinds:['file','file']});
   checkText(current.values['text/plain'],front+'\n[图片]\n'+middle+'\n[图片]\n'+back);checkOrder(current.values['text/html']);
   assert.deepEqual(current.metadata.html.imageSizes,[{width:2,height:3},{width:3,height:2}]);
  });
  await run('production_existing_https_reference',async record=>{
   const value=await payload([{type:'text',text:front},{...image,sourceUrl:'https://example.invalid/md2chat-smoke.png'},{type:'text',text:back}]);
   record.write=await write(value);record.networkRequestsPerformed=false;
   await observe(record,{html:true,plain:true,images:1,sourceKinds:['https']});
  });
  await run('standalone_png',async record=>{
   const segment=await makeWecomSegmentData(image,{nativeImage});await clipboard.write([new ClipboardItem(segment.data)]);
   await observe(record,{pngSize:{width:2,height:3}});
  });
  await run('production_html_rewrite',async record=>{
   await write(await payload(parts));const original=await snapshot(clipboard,nativeImage);
   await runDingtalkHtmlTest('rewrite',{clipboard,ClipboardItem,platform:process.platform});
   const current=await observe(record,{html:true,images:2,sourceKinds:['file','file']});checkOrder(current.values['text/html']);
   record.htmlContentUnchanged=current.values['text/html']===original.values['text/html'];assert.equal(record.htmlContentUnchanged,true);
  });
  await run('managed_cache_readback',async record=>{
   await write(await payload(parts));
   const firstRead=await readClipboardSource(clipboard,{imageDirectory}),secondRead=await readClipboardSource(clipboard,{imageDirectory});
   record.fingerprintStable=firstRead.fingerprint===secondRead.fingerprint;assert.equal(record.fingerprintStable,true);
   const original=await snapshot(clipboard,nativeImage);
   const html=await resolveCachedHtmlImages(original.values['text/html'],{imageDirectory});
   assert.equal(html,firstRead.content[0].html);assert.equal(html.includes('file:'),false);
   const imageData=[...html.matchAll(/<img src="(data:image\/png;base64,[^"]+)"/g)];assert.equal(imageData.length,2);
   record.resolvedImageSizes=imageData.map(match=>nativeImage.createFromDataURL(match[1]).getSize());
   assert.deepEqual(record.resolvedImageSizes,[{width:2,height:3},{width:3,height:2}]);
   await clipboard.write([new ClipboardItem({'text/html':html})]);
   const current=await observe(record,{html:true,images:2,sourceKinds:['data','data']});checkOrder(current.values['text/html']);
  });
 }catch{report.failure=phase+'_failed';}
 finally{
  await progress('clipboard_restore');
  try{if(captured){if(backup.length)await clipboard.write(backup);else clipboard.clear();report.clipboardRestored=true;}}catch{report.restoreFailure='clipboard_restore_failed';}
  await progress('temporary_cleanup');
  try{if(directory)await fs.rm(directory,{recursive:true,force:true});report.temporaryFilesRemoved=true;}catch{report.cleanupFailure='temporary_cleanup_failed';}
 }
 report.status=!report.failure&&!report.progressFailure&&!report.restoreFailure&&!report.cleanupFailure&&report.cases.length===9&&report.cases.every(record=>record.status==='passed')?'passed':'failed';
 await progress('complete');
 return report;
}

async function main(){
 const electron=require('electron');let options;
 try{options=parseArguments(process.argv.slice(2));}catch{
  process.stdout.write(JSON.stringify({schemaVersion:1,status:'failed',failure:'invalid_arguments',dingtalkClientTested:false,cases:[]})+'\n');electron.app.exit(1);return;
 }
 async function onProgress(report,progress){
  report.phase=progress.phase;
  process.stdout.write(JSON.stringify({smoke:'windows_clipboard',...progress})+'\n');
  if(options.reportPath){await fs.mkdir(path.dirname(options.reportPath),{recursive:true});await fs.writeFile(options.reportPath,JSON.stringify(report,null,2)+'\n');}
 }
 const startup={schemaVersion:1,status:'running',dingtalkClientTested:false,cases:[]};
 await onProgress(startup,{phase:'main_start'});
 await onProgress(startup,{phase:'app_when_ready_wait'});
 await electron.app.whenReady();
 await onProgress(startup,{phase:'app_ready'});
 const report=await runWindowsClipboardSmoke(electron,{onProgress});
 if(options.reportPath){
  try{await fs.mkdir(path.dirname(options.reportPath),{recursive:true});await fs.writeFile(options.reportPath,JSON.stringify(report,null,2)+'\n');}
  catch{report.status='failed';report.failure='report_write_failed';}
 }
 await new Promise(resolve=>process.stdout.write(JSON.stringify(report)+'\n',resolve));
 electron.app.exit(report.status==='passed'?0:1);
}

if(require.main===module)main().catch(()=>{process.stdout.write(JSON.stringify({schemaVersion:1,status:'failed',failure:'native_smoke_failed',dingtalkClientTested:false,cases:[]})+'\n');process.exitCode=1;require('electron').app.exit(1);});
module.exports={parseArguments,probeMetadata,inspectCfHtml,runWindowsClipboardSmoke};
