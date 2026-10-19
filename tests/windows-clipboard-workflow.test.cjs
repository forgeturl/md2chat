const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const root=path.join(__dirname,'..'),read=name=>yaml.load(fs.readFileSync(path.join(root,'.github/workflows',name),'utf8'));
function matchesPushPath(paths,file){
 // This workflow uses exact files and directory/** patterns, applied in GitHub order.
 let included=false;
 for(const pattern of paths){
  const negative=pattern.startsWith('!'),glob=negative?pattern.slice(1):pattern;
  const matches=glob.endsWith('/**')?file.startsWith(glob.slice(0,-2)):file===glob;
  if(matches)included=!negative;
 }
 return included;
}
test('release Windows native clipboard failures block publication and preserve QA evidence',()=>{
 const workflow=read('desktop-release.yml'),steps=workflow.jobs.validate.steps;
 const index=steps.findIndex(step=>step.run?.includes('npm run desktop:test:windows'));assert(index>=0);
 assert.equal(steps[index].if,"matrix.platform == 'win'");assert(!steps[index]['continue-on-error']);
 const evidence=steps.find(step=>step.with?.name==='windows-clipboard-qa-release');
 assert.match(evidence.if,/always\(\)/);assert(evidence.with.path.includes('release/qa/windows-clipboard.txt'));assert(evidence.with.path.includes('docs/windows-clipboard-qa.md'));assert(evidence.with.path.includes('examples/windows-clipboard/'));
 assert(workflow.jobs.windows_package.steps.some(step=>step.name==='Build Windows installer'));
 assert(workflow.jobs.publish.needs.includes('validate'));assert(workflow.jobs.publish.needs.includes('windows_package'));
});
test('Windows clipboard validation can run independently without publishing or secrets',()=>{
 const workflow=read('windows-clipboard.yml');assert(Object.hasOwn(workflow.on,'workflow_dispatch'));
 assert.equal(workflow.jobs.clipboard['runs-on'],'windows-latest');assert.equal(workflow.permissions.contents,'read');
 const text=JSON.stringify(workflow);assert(!text.includes('secrets.'));assert(!text.includes('gh release'));
 const steps=workflow.jobs.clipboard.steps,nativeTest=steps.find(step=>step.run?.includes('npm run desktop:test:windows'));
 assert(nativeTest);assert(!nativeTest['continue-on-error']);assert.match(nativeTest.run,/if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/);
 const evidence=steps.find(step=>step.with?.name==='windows-clipboard-qa');assert.match(evidence.if,/always\(\)/);
 for(const file of ['release/qa/windows-clipboard.txt','docs/windows-clipboard-qa.md','examples/windows-clipboard/'])assert(evidence.with.path.includes(file));
 const cleanup=read('actions-cleanup.yml');assert(!Object.hasOwn(cleanup.on,'workflow_run'));
 assert(Object.hasOwn(cleanup.on,'workflow_dispatch'));assert.deepEqual(cleanup.on.schedule,[{cron:'23 18 * * *'}]);
});
test('automatic Windows validation covers native clipboard integration without web or version-only edits',()=>{
 const push=read('windows-clipboard.yml').on.push;assert.deepEqual(push.branches,['main']);
 for(const file of [
  'src-tauri/src/clipboard/windows.rs','src-tauri/src/clipboard/native.rs','src-tauri/src/clipboard/mod.rs',
  'src-tauri/src/clipboard/payload.rs','src-tauri/src/clipboard/cache.rs','src-tauri/src/clipboard/summary.rs',
  'src-tauri/src/clipboard/future/helper.rs','src-tauri/src/lib.rs','src-tauri/src/shell.rs','src-tauri/src/images.rs',
  'src-tauri/src/shortcuts/mod.rs','src-tauri/src/shortcuts/registry.rs','src-tauri/src/preferences.rs',
  'src-tauri/build.rs','src-tauri/tauri.conf.json','scripts/native.cjs','scripts/native-env.cjs',
  'scripts/build-desktop.cjs','scripts/inspect-windows-clipboard.ps1','tests/windows-clipboard-workflow.test.cjs',
  'examples/windows-clipboard/two-images.md','.github/workflows/windows-clipboard.yml'
 ])assert(matchesPushPath(push.paths,file),file+' must trigger Windows validation');
 for(const file of [
  'assets/app.js','assets/tauri-bridge.js','assets/wecom-segments.js','assets/landing.css','editor.html','index.html',
  'package.json','package-lock.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock','src-tauri/src/clipboard/macos.rs',
  'src-tauri/src/updates.rs','docs/release-notes.md'
 ])assert(!matchesPushPath(push.paths,file),file+' must not trigger Windows validation');
});
test('standalone Windows validation builds the frontend once through its native test prehook',()=>{
 const steps=read('windows-clipboard.yml').jobs.clipboard.steps;
 assert(!steps.some(step=>step.run==='npm run check'));
 assert(!steps.some(step=>step.run==='node scripts/build-desktop.cjs'));
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert.equal(pkg.scripts['predesktop:test:windows'],'node scripts/build-desktop.cjs');
 assert.match(pkg.scripts['desktop:test:windows'],/clipboard::tests::native_roundtrip.*--ignored.*--test-threads=1/);
 const regression=steps.findIndex(step=>step.name==='Test shortcuts and desktop regression');
 assert(regression>steps.findIndex(step=>step.run?.includes('npm run desktop:test:windows')));
 assert.equal(steps[regression].run,'node scripts/native.cjs cargo test --locked --manifest-path src-tauri/Cargo.toml');
});
