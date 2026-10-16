const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('static entry assets resolve under a project subdirectory',()=>{
 const html=fs.readFileSync(path.join(root,'editor.html'),'utf8');
 const refs=[...html.matchAll(/(?:src|href)="(\.\/[^"?#]+)"/g)].map(m=>m[1]);assert(refs.length>=4);
 for(const ref of refs){assert(fs.existsSync(path.resolve(root,ref)));assert(new URL(ref,'https://example.com/md2chat/').pathname.startsWith('/md2chat/'));}
 assert(!html.includes('127.0.0.1'));assert(!html.includes('DingBridge'));
});
test('first-party frontend has no persistence or native API dependency',()=>{
 const js=fs.readFileSync(path.join(root,'assets/app.js'),'utf8');
 for(const marker of ['localStorage','sessionStorage','indexedDB','sendBeacon','/api/import','/api/copy','DingBridge','com.dingtalk.richTextAttributedString'])assert(!js.includes(marker),marker);
 assert(!js.includes('clipboard-source'));assert(!js.includes('NSPasteboard'));
});
test('build has a narrow public-file allowlist',()=>{
 const code=fs.readFileSync(path.join(root,'scripts/build.cjs'),'utf8');assert(code.includes("['index.html','editor.html','assets','guides','sitemap.xml','llms.txt','LICENSE','THIRD_PARTY_NOTICES.md']"));
});
test('latest download links match the complete release asset contract',()=>{
 const {expectedAssets}=require('../scripts/release-assets.cjs');
 const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
 for(const name of expectedAssets)assert(readme.includes('/releases/latest/download/'+name));
 const pkg=require('../package.json');
 assert.equal(pkg.version,require('../package-lock.json').version);
 assert.equal(pkg.build.artifactName,'md2chat-${os}-${arch}.${ext}');
 assert.equal(pkg.build.nsis.artifactName,'md2chat-windows-${arch}-setup.${ext}');
});
test('release checksums require all platform assets before publication',()=>{
 const {expectedAssets,writeChecksums}=require('../scripts/release-assets.cjs');
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'md2chat-release-'));
 try{
  for(const name of expectedAssets.slice(0,-1))fs.writeFileSync(path.join(dir,name),'sample');
  assert.throws(()=>writeChecksums(dir));assert(!fs.existsSync(path.join(dir,'SHA256SUMS.txt')));
  fs.writeFileSync(path.join(dir,expectedAssets.at(-1)),'sample');writeChecksums(dir);
  assert.equal(fs.readFileSync(path.join(dir,'SHA256SUMS.txt'),'utf8').trim().split('\n').length,5);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
