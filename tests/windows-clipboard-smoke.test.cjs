const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const fs=require('node:fs'),vm=require('node:vm');
const {parseArguments,probeMetadata,inspectCfHtml,captureClipboardBackup,errorMetadata,runWindowsClipboardSmoke}=require('../desktop/windows-clipboard-smoke.cjs');
const {writeClipboardPayload}=require('../desktop/clipboard-write.cjs');
const {RAW_FORMAT}=require('../desktop/payload.cjs');

test('Electron browser bootstrap starts the smoke when the default app owns require.main',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../desktop/windows-clipboard-smoke.cjs'),'utf8');
 const entry=source.slice(source.lastIndexOf('\nif('),source.lastIndexOf('\nmodule.exports='));
 for(const [runtime,nodeEntry,expected] of [
  [{versions:{electron:'44.8.0'},type:'browser'},false,1],
  [{versions:{electron:'44.8.0'},type:'renderer'},false,0],
  [{versions:{node:'22.12.0'}},false,0],
  [{versions:{node:'22.12.0'}},true,1]
 ]){
  let starts=0;const module={exports:{}},require=()=>assert.fail('entry must not load Electron unless its startup fails');
  require.main=nodeEntry?module:{id:'default_app/main'};
  vm.runInNewContext(entry,{process:runtime,module,require,main:()=>{starts++;return Promise.resolve();}});
  assert.equal(starts,expected);
 }
});

test('native smoke report output is opt-in through one explicit CLI argument',()=>{
 assert.deepEqual(parseArguments([]),{reportPath:undefined});
 assert.deepEqual(parseArguments(['--report','artifacts/windows clipboard.json']),{reportPath:path.resolve('artifacts/windows clipboard.json')});
 for(const args of [['--report'],['--report',''],['--report','--other'],['--other','file.json'],['--report','one.json','--report','two.json'],['file.json']])assert.throws(()=>parseArguments(args));
});

test('native CF_HTML metadata projection excludes content, URLs, paths and arbitrary probe fields',()=>{
 const metadata=probeMetadata({present:true,headerValid:true,byteLength:512,contentByteLength:480,
  validOffsets:true,validUtf8:true,validUtf8Boundaries:true,fragmentMarkers:{startPresent:true,endPresent:true,privateText:'PRIVATE_SENTINEL'},
  fragmentMarkersMatch:true,sourceUrlPresent:true,sourceUrl:'https://private.invalid/PRIVATE_SENTINEL',html:'PRIVATE_SENTINEL',path:'C:\\PRIVATE_SENTINEL',error:'PRIVATE_SENTINEL'});
 assert.equal(metadata.present,true);assert.equal(metadata.byteLength,512);assert.equal(metadata.validOffsets,true);
 assert.deepEqual(metadata.fragmentMarkers,{startPresent:true,endPresent:true});
 assert(!JSON.stringify(metadata).includes('PRIVATE_SENTINEL'));
 assert.equal(probeMetadata({byteLength:-1,contentByteLength:Infinity,present:'true'}).byteLength,null);
 assert.equal(probeMetadata({contentByteLength:Infinity}).contentByteLength,null);
 assert.equal(probeMetadata({present:'true'}).present,false);
});

test('the native probe executes asynchronously while the parent event loop continues running',async()=>{
 const {execFile}=require('node:child_process');let ticks=0,options;
 const timer=setInterval(()=>ticks++,5);
 try{
  const result=await inspectCfHtml(true,(_command,args,settings,callback)=>{
   options=settings;assert(args.includes('-SelfTest'));
   return execFile(process.execPath,['-e','setTimeout(()=>process.stdout.write(JSON.stringify({status:"self_test_passed",passed:9})),50)'],settings,callback);
  });
  assert.equal(result.passed,9);assert(ticks>0);assert.equal(options.timeout,45000);assert.equal(options.maxBuffer,64*1024);
 }finally{clearInterval(timer);}
});

test('native probe failures and malformed output never expose subprocess text',async()=>{
 await assert.rejects(()=>inspectCfHtml(false,(_command,_args,_settings,callback)=>callback(new Error('PRIVATE_SENTINEL'),'PRIVATE_SENTINEL')),error=>error.message==='CF_HTML probe failed');
 await assert.rejects(()=>inspectCfHtml(false,(_command,_args,_settings,callback)=>callback(null,'PRIVATE_SENTINEL')),error=>error.message==='CF_HTML probe returned invalid metadata');
});

test('native probe failure reports retain only fixed process codes, exit status and safe probe status',async()=>{
 for(const [failure,stdout,expected] of [
  [{code:'ETIMEDOUT',signal:'SIGTERM',killed:true},'PRIVATE_SENTINEL',{code:'ETIMEDOUT',numericExitCode:null,signal:'SIGTERM',killed:true,status:null}],
  [{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',signal:'SIGKILL',killed:true},'PRIVATE_SENTINEL',{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',numericExitCode:null,signal:'SIGKILL',killed:true,status:null}],
  [{code:1,signal:null,killed:false},'{"status":"probe_failed","stderr":"PRIVATE_SENTINEL"}',{code:null,numericExitCode:1,signal:null,killed:false,status:'probe_failed'}],
  [{code:'PRIVATE_SENTINEL',signal:'PRIVATE_SENTINEL',killed:false},'{"status":"PRIVATE_SENTINEL"}',{code:null,numericExitCode:null,signal:null,killed:false,status:null}]
 ]){
  await assert.rejects(()=>inspectCfHtml(true,(_command,_args,_settings,callback)=>callback(Object.assign(new Error('PRIVATE_SENTINEL'),failure),stdout)),error=>{
   const metadata=errorMetadata(error);assert.equal(metadata.errorCode,expected.code);
   for(const key of ['numericExitCode','signal','killed','status'])assert.equal(metadata.probe[key],expected[key]);
   assert(Number.isSafeInteger(metadata.probe.elapsedMs));assert(metadata.probe.elapsedMs>=0);
   assert(!JSON.stringify(metadata).includes('PRIVATE_SENTINEL'));return true;
  });
 }
});

test('clipboard backup skips the empty read-side item returned by Electron 44 without constructing an empty item',async()=>{
 let constructions=0;class ClipboardItem{constructor(data){constructions++;if(!Object.keys(data).length)throw new TypeError('an item needs a format');}}
 for(const items of [[],[{types:[],getType:()=>assert.fail('empty items have no data to read')}]]){
  const steps=[];
  const backup=await captureClipboardBackup({read:async()=>items},ClipboardItem,{onProgress:metadata=>steps.push(metadata)});
  assert.deepEqual(backup.items,[]);assert.equal(backup.metadata.itemCount,items.length);assert.equal(backup.metadata.formatCount,0);
  assert.equal(constructions,0);assert.equal(steps[0].check,'read');
 }
});

test('clipboard backup preserves all nonempty formats and does not swallow a failed getType',async()=>{
 const blob=new Blob(['PRIVATE_SENTINEL']),steps=[];let constructions=0;
 class ClipboardItem{constructor(data){constructions++;this.data=data;}}
 const backup=await captureClipboardBackup({read:async()=>[{types:[]},{types:['text/plain'],getType:async()=>blob}]},ClipboardItem,{onProgress:metadata=>steps.push(metadata)});
 assert.equal(backup.items.length,1);assert.equal(backup.items[0].data['text/plain'],blob);
 assert.equal(backup.metadata.itemCount,2);assert.equal(backup.metadata.formatCount,1);
 assert(steps.some(step=>step.check==='get_type'));assert(steps.some(step=>step.check==='construct'));
 assert(!JSON.stringify(steps).includes('PRIVATE_SENTINEL'));assert(!JSON.stringify(steps).includes('text/plain'));
 const failure=new TypeError('PRIVATE_SENTINEL');constructions=0;
 await assert.rejects(()=>captureClipboardBackup({read:async()=>[{types:['text/plain'],getType:async()=>{throw failure;}}]},ClipboardItem),error=>error===failure);
 assert.equal(constructions,0);
 await assert.rejects(()=>captureClipboardBackup({read:async()=>{throw failure;}},ClipboardItem),error=>error===failure);
 class FailedConstruction{constructor(){throw failure;}}
 await assert.rejects(()=>captureClipboardBackup({read:async()=>[{types:['text/plain'],getType:async()=>blob}]},FailedConstruction),error=>error===failure);
});

test('smoke error metadata allowlists error classes and codes without exception text',()=>{
 assert.deepEqual(errorMetadata(new TypeError('PRIVATE_SENTINEL')),{errorName:'TypeError',errorCode:null});
 assert.deepEqual(errorMetadata({name:'PRIVATE_SENTINEL',code:'PRIVATE_SENTINEL',message:'PRIVATE_SENTINEL'}),{errorName:'OtherError',errorCode:null});
 assert.deepEqual(errorMetadata({name:'Error',code:'ERR_ASSERTION'}),{errorName:'Error',errorCode:'ERR_ASSERTION'});
});

test('Windows native smoke refuses other platforms before touching a clipboard',async t=>{
 if(process.platform==='win32'){t.skip('the real Windows cases are executed by the Electron CLI');return;}
 const report=await runWindowsClipboardSmoke({clipboard:{read:()=>assert.fail('non-Windows unit tests must not access the OS clipboard')}});
 assert.equal(report.status,'failed');assert.equal(report.failure,'windows_required');
 assert.equal(report.dingtalkClientTested,false);assert.deepEqual(report.cases,[]);
});

test('shared production writer retains text and HTML, then prunes only after a Windows write succeeds',async()=>{
 const events=[],payload={plain:'synthetic text',html:'<p>synthetic text</p>',imageCount:1};
 class ClipboardItem{constructor(data){this.data=data;}}
 const clipboard={write:async items=>{events.push('write');assert.deepEqual(Object.keys(items[0].data),['text/plain','text/html']);},has:async()=>false};
 const result=await writeClipboardPayload(payload,{platform:'win32',clipboard,ClipboardItem,imageDirectory:'/synthetic-cache',pruneImages:async()=>events.push('prune')});
 assert.deepEqual(events,['write','prune']);assert.equal(result.windowsHtml,true);assert.equal(result.native,false);
 events.length=0;clipboard.write=async()=>{events.push('write');throw new Error('denied');};
 await assert.rejects(()=>writeClipboardPayload(payload,{platform:'win32',clipboard,ClipboardItem,imageDirectory:'/synthetic-cache',pruneImages:async()=>events.push('prune')}),/denied/);
 assert.deepEqual(events,['write']);
});

test('shared production writer verifies the Mac private representation after writing',async()=>{
 let written;class ClipboardItem{constructor(data){this.data=data;}}
 const clipboard={write:async items=>{written=items[0].data;},has:async type=>{assert.equal(type,RAW_FORMAT);return false;}};
 await assert.rejects(()=>writeClipboardPayload({plain:'synthetic',html:'<p>synthetic</p>',rich:{contents:[]},imageCount:0},{platform:'darwin',clipboard,ClipboardItem}),/未保留/);
 assert.deepEqual(Object.keys(written),['text/plain','text/html',RAW_FORMAT]);
});
