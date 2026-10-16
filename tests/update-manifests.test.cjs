const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),yaml=require('js-yaml');
const {combineManifests}=require('../scripts/update-manifests.cjs');
const {expectedAssets}=require('../scripts/release-assets.cjs');
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-manifests-'));
 try{
  const files=expectedAssets.map(url=>{const data=Buffer.from(url);fs.writeFileSync(path.join(dir,url),data);return {url,size:data.length,sha512:crypto.createHash('sha512').update(data).digest('base64')};});
  const specs=[['latest-mac-arm64.yml',files.slice(0,2)],['latest-mac-x64.yml',files.slice(2,4)],['latest.yml',files.slice(4)]];
  for(const [name,entries] of specs)fs.writeFileSync(path.join(dir,name),yaml.dump({version:'0.6.0',files:entries,path:entries.at(-1).url,sha512:entries.at(-1).sha512,releaseNotes:'Sample changes'}));
  fn(dir);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('release metadata retains both Mac architectures and verified Windows installer',()=>fixture(dir=>{
 const mac=combineManifests(dir,'0.6.0');assert.equal(mac.files.length,4);
 assert(mac.files.some(f=>f.url==='md2chat-mac-arm64.zip'));assert(mac.files.some(f=>f.url==='md2chat-mac-x64.zip'));
 assert.equal(yaml.load(fs.readFileSync(path.join(dir,'latest-mac.yml'),'utf8')).version,'0.6.0');
}));
test('missing, wrong-version, tampered or external assets prevent update publication',()=>{
 fixture(dir=>{assert.throws(()=>combineManifests(dir,'0.7.0'));assert(!fs.existsSync(path.join(dir,'latest-mac.yml')));});
 fixture(dir=>{fs.unlinkSync(path.join(dir,expectedAssets[0]));assert.throws(()=>combineManifests(dir,'0.6.0'));});
 fixture(dir=>{fs.appendFileSync(path.join(dir,expectedAssets[0]),'bad');assert.throws(()=>combineManifests(dir,'0.6.0'),/checksum/);});
 fixture(dir=>{const filename=path.join(dir,'latest.yml'),info=yaml.load(fs.readFileSync(filename,'utf8'));info.files[0].url='https://example.org/file.exe';fs.writeFileSync(filename,yaml.dump(info));assert.throws(()=>combineManifests(dir,'0.6.0'),/Unexpected/);});
});
test('release cannot silently publish without consistent update notes',()=>fixture(dir=>{
 const filename=path.join(dir,'latest.yml'),info=yaml.load(fs.readFileSync(filename,'utf8'));delete info.releaseNotes;fs.writeFileSync(filename,yaml.dump(info));assert.throws(()=>combineManifests(dir,'0.6.0'),/notes/);
}));
