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
 assert.deepEqual(expectedAssets,['md2chat-mac-universal.dmg','md2chat-mac-universal.zip','md2chat-windows-x64-setup.exe']);
 const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
 for(const name of expectedAssets)assert(readme.includes('/releases/latest/download/'+name));
 assert(!/\/releases\/latest\/download\/md2chat-mac-(?:arm64|x64)\./.test(readme));
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
  const lines=fs.readFileSync(path.join(dir,'SHA256SUMS.txt'),'utf8').trim().split('\n');
  assert.equal(lines.length,3);
  const digest=require('node:crypto').createHash('sha256').update('sample').digest('hex');
  assert.deepEqual(lines,expectedAssets.map(name=>digest+'  '+name));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('desktop release builds one universal Mac package and publishes only pushed version tags',()=>{
 const workflow=require('js-yaml').load(fs.readFileSync(path.join(root,'.github/workflows/desktop-release.yml'),'utf8'));
 assert.deepEqual(workflow.on.push.tags,['v*']);
 assert(Object.hasOwn(workflow.on,'workflow_dispatch'));
 const matrix=workflow.jobs.build.strategy.matrix.include;
 assert.deepEqual(matrix.map(({platform,arch})=>({platform,arch})),[{platform:'mac',arch:'universal'},{platform:'win',arch:'x64'}]);
 assert.match(workflow.jobs.publish.if,/github\.event_name\s*==\s*'push'/);
 assert.match(workflow.jobs.publish.if,/startsWith\(github\.ref,\s*'refs\/tags\/v'\)/);
 assert.match(workflow.jobs.publish.if,/&&/);
 const macStep=workflow.jobs.build.steps.find(step=>step.run?.includes('scripts/build-desktop-release.cjs mac'));
 assert(macStep);
 for(const name of ['CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID'])assert.equal(macStep.env[name],'${{ secrets.'+name+' }}');
});
