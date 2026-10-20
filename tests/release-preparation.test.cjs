const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {run}=require('../scripts/release.cjs');
const {locales,entryFile,readSource}=require('../scripts/release-summaries.cjs');
function writeCatalog(root,catalog){fs.rmSync(path.join(root,'docs/releases'),{recursive:true,force:true});for(const entry of catalog){const file=path.join(root,entryFile(entry.version));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,json(entry));}}
const summary=()=>({summary:Object.fromEntries(locales.map(code=>[code,['A concise update.']]))});

const latestUrl='https://api.github.com/repos/forgeturl/md2chat/releases/latest';
const repositoryUrl='https://api.github.com/repos/forgeturl/md2chat';
const newNotes='- 修复更新检查失败后无法再次检查的问题。\n';
const json=value=>JSON.stringify(value,null,2)+'\n';
const response=(value,status=200)=>new Response(json(value),{status,headers:{'content-type':'application/json'}});
const latest=(version='0.6.2')=>response({tag_name:'v'+version,draft:false,prerelease:false});

async function fixture(fn,{version='0.6.2',notes}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-release-preparation-'));
 const historicalNotes=notes??'# v'+version+'\n\n- 当前版本说明。\n\n## v0.5.1\n\n- 历史版本说明保留原文。\n';
 const pkg={name:'md2chat',version,private:true,description:'preserve package fields',build:{publish:{provider:'github',owner:'forgeturl',repo:'md2chat'}}};
 const lock={name:'md2chat',version,lockfileVersion:3,requires:true,packages:{'':{name:'md2chat',version,dependencies:{'preserved-dependency':'1.2.3'}},'node_modules/preserved-dependency':{version:'1.2.3',resolved:'https://example.invalid/dependency.tgz'}}};
 fs.mkdirSync(path.join(root,'docs'));
 fs.writeFileSync(path.join(root,'package.json'),json(pkg));
 fs.writeFileSync(path.join(root,'package-lock.json'),json(lock));
 fs.writeFileSync(path.join(root,'docs/release-notes.md'),historicalNotes);
 const notesFile=path.join(root,'input-notes.md');
 fs.writeFileSync(notesFile,newNotes);
 fs.writeFileSync(notesFile+'.json',json(summary()));
 writeCatalog(root,[{...summary(),version},...([...historicalNotes.matchAll(/^#{1,6}\s+v(\d+\.\d+\.\d+)\s*$/gm)].map(m=>m[1]).filter(v=>v!==version).map(v=>({...summary(),version:v})))]);
 const logs=[];
 const options={root,fetchImpl:async()=>latest(),env:{},log:(...args)=>logs.push(args.map(String).join(' '))};
 try{return await fn({root,notesFile,historicalNotes,pkg,lock,logs,options});}
 finally{fs.rmSync(root,{recursive:true,force:true});}
}

function readJson(root,name){return name==='summary-catalog' ? readSource(root).catalog : JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));}
function editJson(root,name,change){const value=readJson(root,name);change(value);if(name==='summary-catalog')writeCatalog(root,value);else fs.writeFileSync(path.join(root,name),json(value));}
function snapshot(root){
 const files={};
 function visit(directory){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
   const full=path.join(directory,entry.name);
   if(entry.isDirectory())visit(full);
   else files[path.relative(root,full)]=fs.readFileSync(full).toString('base64');
  }
 }
 visit(root);return files;
}
async function rejectsWithoutWriting(root,action){
 const before=snapshot(root);
 await assert.rejects(action);
 assert.deepEqual(snapshot(root),before,'a rejected release operation must preserve every fixture file');
}
const prepareArgs=(notesFile,version='patch')=>['prepare',version,'--notes-file',notesFile,'--summary-file',notesFile+'.json'];

test('prepare synchronizes package and lock versions and preserves historical notes and unrelated data',async()=>{
 for(const [bump,expected] of [['patch','0.6.3'],['minor','0.7.0'],['major','1.0.0'],['2.3.4','2.3.4']]){
  await fixture(async({root,notesFile,historicalNotes,pkg,lock,options})=>{
   await run(prepareArgs(notesFile,bump),options);
   assert.deepEqual(readJson(root,'package.json'),{...pkg,version:expected});
   assert.deepEqual(readJson(root,'package-lock.json'),{...lock,version:expected,packages:{...lock.packages,'':{...lock.packages[''],version:expected}}});
   const notes=fs.readFileSync(path.join(root,'docs/release-notes.md'),'utf8');
   assert.match(notes,new RegExp('^# v'+expected.replaceAll('.','\\.')+'\\s*\\n'));
   assert(notes.includes(newNotes.trim()),'new release notes must contain the supplied changes');
   assert(notes.endsWith(historicalNotes),'historical notes must remain byte-for-byte intact');
   assert.equal(fs.readFileSync(notesFile,'utf8'),newNotes);
  });
 }
});

test('version comparison is numeric and accepts 0.10.0 after 0.9.9',async()=>fixture(async({root,notesFile,options})=>{
 options.fetchImpl=async()=>latest('0.9.9');
 await run(prepareArgs(notesFile,'minor'),options);
 assert.equal(readJson(root,'package.json').version,'0.10.0');
},{version:'0.9.9'}));

test('prepare defaults to a patch increment when the increment argument is omitted',async()=>fixture(async({root,notesFile,options})=>{
 await run(['prepare','--notes-file',notesFile,'--summary-file',notesFile+'.json'],options);
 assert.equal(readJson(root,'package.json').version,'0.6.3');
}));

test('preparation preserves concurrent edits made while waiting for GitHub',async()=>fixture(async({root,notesFile,historicalNotes,options})=>{
 options.fetchImpl=async()=>{
  editJson(root,'package.json',pkg=>{pkg.description='edited while checking GitHub';});
  return latest();
 };
 await assert.rejects(()=>run(prepareArgs(notesFile),options),/changed during validation/);
 assert.equal(readJson(root,'package.json').description,'edited while checking GitHub');
 assert.equal(readJson(root,'package.json').version,'0.6.2');
 assert.equal(readJson(root,'package-lock.json').version,'0.6.2');
 assert.equal(fs.readFileSync(path.join(root,'docs/release-notes.md'),'utf8'),historicalNotes);
 assert(!fs.readdirSync(root).some(name=>name.includes('.release-')));
}));

test('prepare requires a candidate greater than both local version and GitHub Latest',async()=>{
 for(const candidate of ['0.6.1','0.6.2'])await fixture(async({root,notesFile,options})=>{
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile,candidate),options));
 });
 for(const remote of ['0.6.3','0.7.0'])await fixture(async({root,notesFile,options})=>{
  options.fetchImpl=async()=>latest(remote);
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 });
});

test('only canonical stable versions with safe integer components can be prepared',async()=>{
 for(const candidate of ['v0.6.3','0.06.3','00.6.3','0.6.03','0.6','0.6.3.0','0.6.3-beta.1','0.6.3+build.1','-1.0.0','9007199254740992.0.0','0.9007199254740992.0','0.6.9007199254740992']){
  await fixture(async({root,notesFile,options})=>{
   await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile,candidate),options));
  });
 }
 await fixture(async({root,notesFile,options})=>{
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 },{version:'0.6.9007199254740991'});
});

test('inconsistent or missing lockfile package versions prevent preparation before writes',async()=>{
 for(const change of [lock=>{lock.version='0.5.1';},lock=>{lock.packages[''].version='0.5.1';},lock=>{delete lock.packages[''].version;},lock=>{delete lock.packages[''];}]){
  await fixture(async({root,notesFile,options})=>{
   editJson(root,'package-lock.json',change);
   await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
  });
 }
});

test('empty, heading-only, comment-only, placeholder, or already-versioned input notes are rejected',async()=>{
 const invalid=['',' \n\t\n','<!-- explain the changes later -->\n','## 更新内容\n','# v0.6.3\n\n- 实际变更。\n','## v0.6.3\n\n- 实际变更。\n','TODO\n','- TBD\n','- 待补充\n','<!-- TODO -->\n\n- TODO\n'];
 for(const notes of invalid)await fixture(async({root,notesFile,options})=>{
  fs.writeFileSync(notesFile,notes);
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 });
});

test('missing input notes and malformed local JSON do not partially update a release',async()=>{
 await fixture(async({root,notesFile,options})=>{
  fs.unlinkSync(notesFile);
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 });
 for(const name of ['package.json','package-lock.json'])await fixture(async({root,notesFile,options})=>{
  fs.writeFileSync(path.join(root,name),'{ invalid json');
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 });
});

test('unknown, missing, repeated, and misplaced command arguments fail without writes',async()=>{
 await fixture(async({root,notesFile,options})=>{
  const invalid=[[],['unknown'],['prepare'],['prepare','patch'],['prepare','patch','--notes-file'],['prepare','patch','--notes-file',notesFile,'--force'],['prepare','patch','minor','--notes-file',notesFile],['prepare','patch','--notes-file',notesFile,'--notes-file',notesFile],['verify'],['verify','--tag'],['verify','--tag','v0.6.2','--force'],['verify','--tag','v0.6.2','--tag','v0.6.2']];
  for(const args of invalid)await rejectsWithoutWriting(root,()=>run(args,options));
 });
});

test('HTTP authentication, rate limiting, and server errors cannot be mistaken for a first release',async()=>{
 for(const status of [401,403,429,500,503])await fixture(async({root,notesFile,options})=>{
  options.fetchImpl=async()=>response({message:'API error'},status);
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 });
});

test('network and timeout failures preserve all files and never fall back to a first release',async()=>{
 for(const failure of [new Error('network unavailable'),new DOMException('request timed out','TimeoutError'),new DOMException('request aborted','AbortError')]){
  await fixture(async({root,notesFile,options})=>{
   options.fetchImpl=async()=>{throw failure;};
   await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
  });
 }
});

test('malformed or non-stable Latest responses block preparation',async()=>{
 for(const value of [{},{tag_name:'v0.6.2',draft:true,prerelease:false},{tag_name:'v0.6.2',draft:false,prerelease:true},{tag_name:'v0.6.2-beta.1',draft:false,prerelease:false},{tag_name:'v0.06.2',draft:false,prerelease:false}]){
  await fixture(async({root,notesFile,options})=>{
   options.fetchImpl=async()=>response(value);
   await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
  });
 }
 await fixture(async({root,notesFile,options})=>{
  options.fetchImpl=async()=>new Response('{ invalid json',{status:200});
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 });
});

test('a genuine Latest 404 permits preparation only after confirming repository availability',async()=>fixture(async({root,notesFile,options})=>{
 const requested=[];
 options.fetchImpl=async input=>{
  requested.push(String(input));
  return String(input)===latestUrl?response({message:'Not Found'},404):response({full_name:'forgeturl/md2chat'});
 };
 await run(prepareArgs(notesFile),options);
 assert.deepEqual(requested,[latestUrl,repositoryUrl]);
 assert.equal(readJson(root,'package.json').version,'0.6.3');
}));

test('Latest 404 with unavailable, forbidden, or mismatched repository is not a first release',async()=>{
 for(const [status,value] of [[404,{message:'Not Found'}],[403,{message:'Forbidden'}],[500,{message:'Error'}],[200,{full_name:'another/repo'}],[200,{}]]){
  await fixture(async({root,notesFile,options})=>{
   options.fetchImpl=async input=>String(input)===latestUrl?response({message:'Not Found'},404):response(value,status);
   await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
  });
 }
 await fixture(async({root,notesFile,options})=>{
  options.fetchImpl=async input=>{if(String(input)===latestUrl)return response({message:'Not Found'},404);throw new Error('repository check unavailable');};
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 });
});

test('verify is read-only and accepts matching tag, package, lock and meaningful current notes',async()=>fixture(async({root,options})=>{
 options.fetchImpl=async()=>latest('0.6.1');
 const before=snapshot(root);
 await run(['verify','--tag','v0.6.2'],options);
 assert.deepEqual(snapshot(root),before);
}));

test('verify refuses a missing or mismatched canonical v-prefixed tag',async()=>{
 for(const tag of ['0.6.2','v0.6.1','v0.6.3','v0.06.2','v0.6.2-beta.1','v0.6.2+build.1'])await fixture(async({root,options})=>{
  options.fetchImpl=async()=>latest('0.6.1');
  await rejectsWithoutWriting(root,()=>run(['verify','--tag',tag],options));
 });
});

test('verify checks both lock versions and the first release-notes version',async()=>{
 for(const change of [lock=>{lock.version='0.6.1';},lock=>{lock.packages[''].version='0.6.1';}])await fixture(async({root,options})=>{
  editJson(root,'package-lock.json',change);
  options.fetchImpl=async()=>latest('0.6.1');
  await rejectsWithoutWriting(root,()=>run(['verify','--tag','v0.6.2'],options));
 });
 for(const notes of ['# v0.6.1\n\n- 有效但版本不匹配。\n','# v0.6.3\n\n- 未来版本。\n\n## v0.6.2\n\n- 旧版本。\n','- 没有版本标题。\n'])await fixture(async({root,options})=>{
  options.fetchImpl=async()=>latest('0.6.1');
  await rejectsWithoutWriting(root,()=>run(['verify','--tag','v0.6.2'],options));
 },{notes});
});

test('verify requires substantive current-version notes and does not borrow historical content',async()=>{
 for(const body of ['', '\n<!-- TODO: write release notes -->\n','\n## 变更说明\n','\n- TODO\n','\n- 待补充\n'])await fixture(async({root,options})=>{
  options.fetchImpl=async()=>latest('0.6.1');
  await rejectsWithoutWriting(root,()=>run(['verify','--tag','v0.6.2'],options));
 },{notes:'# v0.6.2\n'+body+'\n## v0.6.1\n\n- 这是旧版本的真实说明，不能充当新版内容。\n'});
});

test('verify prevents re-publishing Latest or downgrading the update channel',async()=>{
 for(const remote of ['0.6.2','0.6.3','0.10.0'])await fixture(async({root,options})=>{
  options.fetchImpl=async()=>latest(remote);
  await rejectsWithoutWriting(root,()=>run(['verify','--tag','v0.6.2'],options));
 });
});

test('GitHub authentication is optional and tokens are sent as headers without being logged',async()=>{
 for(const tokenName of [null,'GH_TOKEN','GITHUB_TOKEN'])await fixture(async({notesFile,logs,options})=>{
  const token='sensitive-release-test-token';
  options.env=tokenName?{[tokenName]:token}:{};
  const calls=[];
  options.fetchImpl=async(input,init)=>{calls.push({url:String(input),headers:new Headers(init?.headers)});return latest();};
  await run(prepareArgs(notesFile),options);
  assert.equal(calls[0].url,latestUrl);
  assert.equal(calls[0].headers.get('authorization'),tokenName?'Bearer '+token:null);
  assert(!logs.join('\n').includes(token),'access token must never be printed in successful command output');
 });
});

test('preparation requires complete translated summaries and updates their history atomically',async()=>fixture(async({root,notesFile,options})=>{
 const previous=readJson(root,'summary-catalog');
 const input=summary();input.important=summary().summary;
 fs.writeFileSync(notesFile+'.json',json(input));
 await run(prepareArgs(notesFile),options);
 const catalog=readJson(root,'summary-catalog');
 assert.deepEqual(catalog,[{...input,version:'0.6.3'},...previous]);
}));
test('incomplete summaries and concurrent summary edits stop preparation without partial writes',async()=>{
 await fixture(async({root,notesFile,options})=>{
  const input=summary();delete input.summary.ja;fs.writeFileSync(notesFile+'.json',json(input));
  await rejectsWithoutWriting(root,()=>run(prepareArgs(notesFile),options));
 });
 await fixture(async({root,notesFile,options})=>{
  options.fetchImpl=async()=>{editJson(root,'summary-catalog',catalog=>{catalog[0].summary.en=['Concurrent edit.'];});return latest();};
  await assert.rejects(()=>run(prepareArgs(notesFile),options),/changed during validation/);
  assert.equal(readJson(root,'package.json').version,'0.6.2');
  assert.equal(readJson(root,'summary-catalog')[0].summary.en[0],'Concurrent edit.');
 });
});
test('a confirmed unpublished predecessor can be skipped when preparing a successor but cannot be published',async()=>fixture(async({root,notesFile,options})=>{
 editJson(root,'summary-catalog',catalog=>{catalog[0]={version:'0.6.2',unpublished:true};});
 options.fetchImpl=async()=>latest('0.6.1');
 await rejectsWithoutWriting(root,()=>run(['verify','--tag','v0.6.2'],options));
 await run(prepareArgs(notesFile),options);
 assert.equal(readJson(root,'summary-catalog')[1].unpublished,true);
}));

test('preparation adds only one summary file and preserves historical files byte for byte',async()=>fixture(async({root,notesFile,options})=>{
 const originals=readSource(root).originals;
 await run(prepareArgs(notesFile),options);
 for(const [file,content] of originals)assert.equal(fs.readFileSync(file,'utf8'),content);
 assert(fs.existsSync(path.join(root,entryFile('0.6.3'))));
 assert(!fs.existsSync(path.join(root,'docs/update-summaries.json')));
}));
test('concurrent creation of the candidate summary cannot be overwritten',async()=>fixture(async({root,notesFile,options})=>{
 const candidate=path.join(root,entryFile('0.6.3'));
 options.fetchImpl=async()=>{fs.writeFileSync(candidate,json({...summary(),version:'0.6.3'}));return latest();};
 await assert.rejects(()=>run(prepareArgs(notesFile),options),/changed during validation/);
 assert.equal(readJson(root,'package.json').version,'0.6.2');assert(fs.existsSync(candidate));
}));
