const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=path.resolve(__dirname,'../scripts/build-desktop-release.cjs');
const source=fs.readFileSync(script,'utf8');
const secretNames=['CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID'];
const credentials=Object.fromEntries(secretNames.map(name=>[name,'test-placeholder-'+name]));
const appPath='release/mac-universal/md2chat.app';
const helpers=['md2chat Helper.app','md2chat Helper (GPU).app'];
function execute(args,{env=credentials,failCommand,failIndex=0,spawnError=false,helperNames=helpers}={}){
 const calls=[],reads=[];let failure,occurrences=0;
 const fakeFs={readdirSync(directory){reads.push(directory);assert.equal(directory,path.join(appPath,'Contents','Frameworks'));return ['Electron Framework.framework',...helperNames,'Squirrel.framework'];}};
 const fakeProcess={argv:['/stub/node',script,...args],env:{...env},execPath:'/stub/node',exit(status){throw Object.assign(new Error('Process exited: '+status),{exitStatus:status});}};
 const fakeSpawn=(command,commandArgs,options)=>{
  calls.push({command,args:[...commandArgs],options});
  if(command===failCommand&&occurrences++===failIndex)return spawnError?{error:new Error('Spawn failed')}:{status:17};
  return {status:0};
 };
 const context={process:fakeProcess,__dirname:path.dirname(script),__filename:script,console,Buffer,require(name){
  if(name==='node:child_process')return {spawnSync:fakeSpawn};
  if(name==='node:fs')return fakeFs;
  return require(name);
 }};
 try{vm.runInNewContext(source,context,{filename:script});}catch(error){failure=error;}
 return {calls,reads,failure};
}
test('Mac build creates a signed universal DMG and ZIP, then verifies every executable and notarization',()=>{
 const result=execute(['mac','universal']);assert.ifError(result.failure);
 assert.deepEqual(result.calls[0].args,['node_modules/electron-builder/cli.js','--mac','dmg','zip','--universal','--publish','never','-c.forceCodeSigning=true']);
 assert.equal(result.calls[0].command,'/stub/node');
 const binaries=[path.join(appPath,'Contents','MacOS','md2chat'),path.join(appPath,'Contents','Frameworks','Electron Framework.framework','Electron Framework'),...helpers.map(name=>path.join(appPath,'Contents','Frameworks',name,'Contents','MacOS',name.slice(0,-4)))];
 const lipoCalls=result.calls.filter(call=>call.command==='lipo');
 assert.deepEqual(lipoCalls.map(call=>call.args),binaries.map(binary=>[binary,'-verify_arch','arm64','x86_64']));
 assert.deepEqual(result.calls.slice(-3).map(({command,args})=>({command,args})),[
  {command:'codesign',args:['--verify','--deep','--strict',appPath]},
  {command:'spctl',args:['--assess','--type','execute','--verbose',appPath]},
  {command:'xcrun',args:['stapler','validate',appPath]}
 ]);
 assert.equal(result.calls.length,1+binaries.length+3);
});
test('Windows build requires no Apple secrets and creates the x64 installer',()=>{
 const result=execute(['win','x64'],{env:{}});assert.ifError(result.failure);
 assert.deepEqual(result.calls.map(({command,args})=>({command,args})),[{command:'/stub/node',args:['node_modules/electron-builder/cli.js','--win','nsis','--x64','--publish','never']}]);
 assert.deepEqual(result.reads,[]);
});
test('unsupported targets fail before building',()=>{
 for(const target of [['mac','arm64'],['mac','x64'],['win','arm64'],['win','universal'],['linux','x64'],['mac'],[]]){
  const result=execute(target);assert.match(result.failure?.message||'',/Invalid build target/);assert.equal(result.calls.length,0);
 }
});
test('each signing and notarization credential is required before a Mac build starts',()=>{
 for(const name of secretNames){
  const env={...credentials};delete env[name];const result=execute(['mac','universal'],{env});
  assert.match(result.failure?.message||'',new RegExp('Configure GitHub Actions Secrets:.*'+name));assert.equal(result.calls.length,0);
 }
 const result=execute(['mac','universal'],{env:{}});
 for(const name of secretNames)assert(result.failure.message.includes(name));
 assert.equal(result.calls.length,0);
});
test('builder and verification failures stop subsequent release commands',()=>{
 for(const [failCommand,failIndex] of [['/stub/node',0],['lipo',0],['lipo',3],['codesign',0],['spctl',0],['xcrun',0]]){
  const result=execute(['mac','universal'],{failCommand,failIndex});assert(result.failure);
  assert.equal(result.failure.exitStatus,17);assert.equal(result.calls.at(-1).command,failCommand);
 }
 const result=execute(['mac','universal'],{failCommand:'/stub/node',spawnError:true});assert.match(result.failure?.message||'',/Spawn failed/);assert.equal(result.calls.length,1);
});
test('a universal Mac application must contain helper executables for verification',()=>{
 const result=execute(['mac','universal'],{helperNames:[]});assert(result.failure);
 assert(!result.calls.some(call=>call.command==='codesign'));
});
