const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {parseArguments,probeMetadata,inspectCfHtml,runWindowsClipboardSmoke}=require('../desktop/windows-clipboard-smoke.cjs');
const {writeClipboardPayload}=require('../desktop/clipboard-write.cjs');
const {RAW_FORMAT}=require('../desktop/payload.cjs');

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
  assert.equal(result.passed,9);assert(ticks>0);assert.equal(options.timeout,15000);assert.equal(options.maxBuffer,64*1024);
 }finally{clearInterval(timer);}
});

test('native probe failures and malformed output never expose subprocess text',async()=>{
 await assert.rejects(()=>inspectCfHtml(false,(_command,_args,_settings,callback)=>callback(new Error('PRIVATE_SENTINEL'),'PRIVATE_SENTINEL')),error=>error.message==='CF_HTML probe failed');
 await assert.rejects(()=>inspectCfHtml(false,(_command,_args,_settings,callback)=>callback(null,'PRIVATE_SENTINEL')),error=>error.message==='CF_HTML probe returned invalid metadata');
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
