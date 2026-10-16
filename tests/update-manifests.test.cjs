const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),yaml=require('js-yaml');
const {validateManifests}=require('../scripts/update-manifests.cjs');
const {expectedAssets}=require('../scripts/release-assets.cjs');
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-manifests-'));
 try{
  const files=expectedAssets.map(url=>{const data=Buffer.from(url);fs.writeFileSync(path.join(dir,url),data);return {url,size:data.length,sha512:crypto.createHash('sha512').update(data).digest('base64')};});
  const specs=[['latest-mac.yml',files.slice(0,2)],['latest.yml',files.slice(2)]];
  for(const [name,entries] of specs)fs.writeFileSync(path.join(dir,name),yaml.dump({version:'0.6.0',files:entries,path:entries.at(-1).url,sha512:entries.at(-1).sha512,releaseNotes:'Sample changes'}));
  fn(dir);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function changeManifest(dir,name,change){
 const filename=path.join(dir,name),info=yaml.load(fs.readFileSync(filename,'utf8'));
 change(info);fs.writeFileSync(filename,yaml.dump(info));
}
function snapshot(dir){return new Map(fs.readdirSync(dir).map(name=>[name,fs.readFileSync(path.join(dir,name))]));}
function assertUnchanged(dir,before){
 assert.deepEqual(fs.readdirSync(dir),[...before.keys()]);
 for(const [name,content] of before)assert.deepEqual(fs.readFileSync(path.join(dir,name)),content,name);
}
test('universal Mac and Windows update manifests are verified without merging or rewriting files',()=>fixture(dir=>{
 const before=snapshot(dir);assert.doesNotThrow(()=>validateManifests(dir,'0.6.0'));assertUnchanged(dir,before);
 const mac=yaml.load(fs.readFileSync(path.join(dir,'latest-mac.yml'),'utf8'));
 assert.deepEqual(mac.files.map(file=>file.url),['md2chat-mac-universal.dmg','md2chat-mac-universal.zip']);
}));
test('missing manifests or assets prevent update publication',()=>{
 for(const name of ['latest-mac.yml','latest.yml',...expectedAssets])fixture(dir=>{
  fs.unlinkSync(path.join(dir,name));const before=snapshot(dir);assert.throws(()=>validateManifests(dir,'0.6.0'));assertUnchanged(dir,before);
 });
});
test('every manifest must match the release version and complete asset set',()=>{
 fixture(dir=>assert.throws(()=>validateManifests(dir,'0.7.0')));
 for(const name of ['latest-mac.yml','latest.yml']){
  fixture(dir=>{changeManifest(dir,name,info=>{info.version='0.5.0';});assert.throws(()=>validateManifests(dir,'0.6.0'));});
  fixture(dir=>{changeManifest(dir,name,info=>{info.files=[];});assert.throws(()=>validateManifests(dir,'0.6.0'));});
 }
 fixture(dir=>{changeManifest(dir,'latest-mac.yml',info=>{info.files[1]={...info.files[0]};});assert.throws(()=>validateManifests(dir,'0.6.0'));});
 for(const url of ['md2chat-mac-arm64.zip','../outside.zip','https://example.org/file.exe'])fixture(dir=>{
  changeManifest(dir,'latest.yml',info=>{info.files[0].url=url;});assert.throws(()=>validateManifests(dir,'0.6.0'),/Unexpected/);
 });
});
test('actual asset content, recorded size, and SHA-512 must agree',()=>{
 for(const name of expectedAssets){
  fixture(dir=>{const filename=path.join(dir,name),data=fs.readFileSync(filename);data[0]^=1;fs.writeFileSync(filename,data);assert.throws(()=>validateManifests(dir,'0.6.0'),/checksum/i);});
  fixture(dir=>{fs.writeFileSync(path.join(dir,name),'');assert.throws(()=>validateManifests(dir,'0.6.0'),/checksum/i);});
 }
 for(const name of ['latest-mac.yml','latest.yml']){
  fixture(dir=>{changeManifest(dir,name,info=>{info.files[0].size++;});assert.throws(()=>validateManifests(dir,'0.6.0'),/checksum/i);});
  fixture(dir=>{changeManifest(dir,name,info=>{info.files[0].sha512='invalid';});assert.throws(()=>validateManifests(dir,'0.6.0'),/checksum/i);});
 }
});
test('legacy update path and SHA-512 identify one verified asset',()=>{
 for(const name of ['latest-mac.yml','latest.yml']){
  fixture(dir=>{changeManifest(dir,name,info=>{info.path='unverified.zip';});assert.throws(()=>validateManifests(dir,'0.6.0'),/legacy/i);});
  fixture(dir=>{changeManifest(dir,name,info=>{info.sha512='unverified';});assert.throws(()=>validateManifests(dir,'0.6.0'),/legacy/i);});
 }
});
test('release cannot publish without matching update notes on both platforms',()=>{
 for(const name of ['latest-mac.yml','latest.yml']){
  fixture(dir=>{changeManifest(dir,name,info=>{delete info.releaseNotes;});assert.throws(()=>validateManifests(dir,'0.6.0'),/notes/i);});
  fixture(dir=>{changeManifest(dir,name,info=>{info.releaseNotes='Different changes';});assert.throws(()=>validateManifests(dir,'0.6.0'),/notes/i);});
 }
});
