const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const readWorkflow=name=>require('js-yaml').load(fs.readFileSync(path.join(root,'.github/workflows',name),'utf8'));
function readPngSize(file){
 const image=fs.readFileSync(file);
 assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(image.subarray(12,16).toString('ascii'),'IHDR');
 return {width:image.readUInt32BE(16),height:image.readUInt32BE(20)};
}
function matchesEvent(condition,eventName,ref){
 assert.equal(typeof condition,'string');
 return require('node:vm').runInNewContext(condition.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g,''),{github:{event_name:eventName,ref},startsWith:(value,prefix)=>value.startsWith(prefix)});
}
function assertOnlyPushedVersionTags(condition){
 for(const [eventName,ref,expected] of [['push','refs/tags/v0.6.1',true],['push','refs/heads/main',false],['push','refs/tags/test',false],['pull_request','refs/pull/1/merge',false],['workflow_dispatch','refs/tags/v0.6.1',false],['workflow_dispatch','refs/heads/main',false]]){
  assert.equal(matchesEvent(condition,eventName,ref),expected,eventName+' '+ref);
 }
}
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
 const code=fs.readFileSync(path.join(root,'scripts/build.cjs'),'utf8');assert(code.includes("['index.html','editor.html','assets','guides',...editions.map(item=>item.directory).filter(Boolean),'sitemap.xml','llms.txt','LICENSE','THIRD_PARTY_NOTICES.md']"));
 assert.deepEqual(require('../scripts/site-locales.cjs').editions.map(item=>item.directory),['','en','es','pt-br','ja','ko','de','fr','hi']);
});
test('latest download links and Tauri configuration match the public release asset contract',()=>{
 const {expectedAssets,installerAssets}=require('../scripts/release-assets.cjs');
 assert.deepEqual(expectedAssets,['md2chat-mac-universal.dmg','md2chat-mac-universal.app.tar.gz','md2chat-mac-universal.app.tar.gz.sig','md2chat-windows-x64-setup.exe','md2chat-windows-x64-setup.exe.sig','latest.json']);
 const readme=fs.readFileSync(path.join(root,'README.md'),'utf8');
 for(const name of installerAssets)assert(readme.includes('/releases/latest/download/'+name));
 const pkg=require('../package.json'), config=require('../src-tauri/tauri.conf.json');
 assert.equal(pkg.version,require('../package-lock.json').version);
 assert.equal(config.version,'../package.json');
 assert(config.plugins.updater.endpoints.includes('https://github.com/forgeturl/md2chat/releases/latest/download/latest.json'));
 assert.equal(config.bundle.createUpdaterArtifacts,true);
 assert(!pkg.dependencies?.['electron-updater']);assert(!pkg.devDependencies?.electron);
});
test('Mac DMG guidance assets keep the configured size and left-to-right copy layout',()=>{
 const config=require('../src-tauri/tauri.conf.json'),dmg=config.bundle.macOS.dmg;
 assert.deepEqual(dmg,{
  background:'../desktop/dmg/background.png',
  windowSize:{width:660,height:400},
  appPosition:{x:170,y:220},
  applicationFolderPosition:{x:490,y:220}
 });
 const background=path.resolve(root,'src-tauri',dmg.background);
 assert.deepEqual(readPngSize(background),dmg.windowSize);
 assert.deepEqual(readPngSize(path.join(path.dirname(background),'background@2x.png')),{width:1320,height:800});
 const svg=fs.readFileSync(path.join(root,'desktop/dmg/background.svg'),'utf8');
 assert.match(svg,/<svg[^>]*\bwidth="660"[^>]*\bheight="400"[^>]*\bviewBox="0 0 660 400"/);
 assert.match(svg,/将左侧 md2chat 拖到右侧 Applications 文件夹/);
 assert.match(svg,/复制完成后，请从“应用程序”中打开 md2chat/);
 assert.match(svg,/d="M32 24h48m-13-13 13 13-13 13"/,'the installation arrow must continue pointing right');
 const settings=fs.readFileSync(path.join(root,'desktop/dmg/settings.py'),'utf8');
 assert.match(settings,/application\s*=\s*os\.path\.abspath\(defines\["app"\]\)/);
 assert.match(settings,/background\s*=\s*os\.path\.abspath\(defines\["background"\]\)/);
 assert.match(settings,/files\s*=\s*\[application\]/);
 assert.match(settings,/symlinks\s*=\s*\{"Applications":\s*"\/Applications"\}/);
 const appPoint=settings.match(/app_name:\s*\((\d+),\s*(\d+)\)/),applicationsPoint=settings.match(/"Applications":\s*\((\d+),\s*(\d+)\)/);
 assert(appPoint);assert(applicationsPoint);
 assert.deepEqual(appPoint.slice(1).map(Number),[dmg.appPosition.x,dmg.appPosition.y]);
 assert.deepEqual(applicationsPoint.slice(1).map(Number),[dmg.applicationFolderPosition.x,dmg.applicationFolderPosition.y]);
 assert(Number(appPoint[1])<Number(applicationsPoint[1]),'the app must remain left of Applications');
 const guidance=fs.readFileSync(path.join(root,'desktop/dmg/README.md'),'utf8');
 assert.match(guidance,/`background\.svg` is the editable source/);
 assert.match(guidance,/app on the left and the Applications shortcut on the right/);
});
test('release checksums require all platform assets before publication',()=>{
 const {expectedAssets,writeChecksums}=require('../scripts/release-assets.cjs');
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'md2chat-release-'));
 try{
  for(const name of expectedAssets.slice(0,-1))fs.writeFileSync(path.join(dir,name),'sample');
  assert.throws(()=>writeChecksums(dir));assert(!fs.existsSync(path.join(dir,'SHA256SUMS.txt')));
  fs.writeFileSync(path.join(dir,expectedAssets.at(-1)),JSON.stringify({version:'0.6.23'}));writeChecksums(dir);
  const lines=fs.readFileSync(path.join(dir,'SHA256SUMS.txt'),'utf8').trim().split('\n');
  assert.equal(lines.length,expectedAssets.length);
  const digest=require('node:crypto').createHash('sha256').update('sample').digest('hex');
  assert.deepEqual(lines,expectedAssets.map(name=>(name==='latest.json' ? require('node:crypto').createHash('sha256').update(JSON.stringify({version:'0.6.23'})).digest('hex') : digest)+'  '+name));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('desktop release compiles Mac architectures in parallel and packages one universal app',()=>{
 const workflow=readWorkflow('desktop-release.yml');
 assert.deepEqual(workflow.on.push.tags,['v*']);
 assert(Object.hasOwn(workflow.on,'workflow_dispatch'));
 const binaries=workflow.jobs.mac_binaries;
 assert.deepEqual(binaries.strategy.matrix.include.map(({arch,target})=>({arch,target})),[
  {arch:'arm64',target:'aarch64-apple-darwin'},
  {arch:'x64',target:'x86_64-apple-darwin'}
 ]);
 assert(binaries.strategy.matrix.include.every(({os})=>os==='macos-15'));
 const compile=binaries.steps.find(step=>step.run?.includes('--compile-only'));
 assert(compile); assert.equal(compile.env.TAURI_UPDATER_PUBLIC_KEY,'${{ secrets.TAURI_UPDATER_PUBLIC_KEY }}');
 for(const secret of ['CSC_LINK','CSC_KEY_PASSWORD','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID','TAURI_SIGNING_PRIVATE_KEY'])assert(!JSON.stringify(binaries).includes(secret));
 const binaryUpload=binaries.steps.find(step=>step.uses?.startsWith('actions/upload-artifact@'));
 assert.equal(binaryUpload.with.name,'mac-binary-${{ matrix.arch }}');
 assert.equal(binaryUpload.with['compression-level'],0);
 const mac=workflow.jobs.mac_package;
 const python=mac.steps.find(step=>step.uses?.startsWith('actions/setup-python@'));
 assert.equal(python.uses,'actions/setup-python@v6');
 assert.deepEqual(python.with,{'python-version':'3.13',cache:'pip','cache-dependency-path':'scripts/dmgbuild-requirements.txt'});
 const installDmgbuild=mac.steps.find(step=>step.run?.includes('pip install'));
 assert.equal(installDmgbuild.run,'python3 -m pip install --disable-pip-version-check --only-binary=:all: --require-hashes -r scripts/dmgbuild-requirements.txt');
 const combine=mac.steps.find(step=>step.run?.includes('lipo -create'));
 assert(combine); assert.match(combine.run,/aarch64-apple-darwin/); assert.match(combine.run,/x86_64-apple-darwin/); assert.match(combine.run,/chmod 755/);
 const macStep=mac.steps.find(step=>step.run?.includes('scripts/build-desktop-release.cjs mac universal'));
 assert(macStep); assert.match(macStep.run,/--prebuilt/);
 assert(mac.steps.indexOf(python)<mac.steps.indexOf(installDmgbuild));
 assert(mac.steps.indexOf(installDmgbuild)<mac.steps.indexOf(macStep));
 const requirements=fs.readFileSync(path.join(root,'scripts/dmgbuild-requirements.txt'),'utf8').trim().split(/\n(?=[A-Za-z0-9])/);
 assert(requirements.some(entry=>entry.startsWith('dmgbuild==')));
 for(const entry of requirements)assert.match(entry,/^[A-Za-z0-9._-]+==[^\s\\]+\s+\\\r?\n\s+--hash=sha256:[a-f0-9]{64}$/);
 const macUpload=mac.steps.find(step=>step.with?.name==='desktop-mac-universal'); assert(macUpload);
 const win=workflow.jobs.windows_package;
 assert(win.steps.some(step=>step.run?.includes('scripts/build-desktop-release.cjs win x64')));
 assert(win.steps.some(step=>step.with?.name==='desktop-win-x64'));
 assert.match(workflow.jobs.publish.if,/github\.event_name\s*==\s*'push'/);
 assert.match(workflow.jobs.publish.if,/startsWith\(github\.ref,\s*'refs\/tags\/v'\)/);
 assert.match(workflow.jobs.publish.if,/&&/);
 for(const name of ['CSC_LINK','CSC_KEY_PASSWORD','APPLE_SIGNING_IDENTITY','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID','TAURI_SIGNING_PRIVATE_KEY','TAURI_UPDATER_PUBLIC_KEY'])assert.equal(macStep.env[name],'${{ secrets.'+name+' }}');
});
test('shared preflight checks gate both tag releases and manual installer builds',()=>{
 const workflow=readWorkflow('desktop-release.yml'),preflight=workflow.jobs.preflight;
 assert.equal(preflight.if,undefined,'manual builds must also pass the common checks');
 assert.equal(preflight['runs-on'],'ubuntu-latest');
 const commonChecks=Object.entries(workflow.jobs).flatMap(([name,job])=>(job.steps||[]).filter(step=>step.run==='npm run check').map(()=>name));
 assert.deepEqual(commonChecks,['preflight'],'run the shared checks once, before native jobs');
 const installIndex=preflight.steps.findIndex(step=>step.run==='npm ci --ignore-scripts');
 assert(installIndex>=0&&installIndex<preflight.steps.findIndex(step=>step.run==='npm run check'));
 for(const name of ['validate','mac_binaries','windows_package','build-site'])assert.equal(workflow.jobs[name].needs,'preflight',name);
 for(const name of ['validate','mac_binaries','windows_package']){
  const expression=workflow.jobs[name].if.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g,'');
  for(const [eventName,result,cancelled,expected] of [
   ['push','success',false,true],['push','failure',false,false],['push','skipped',false,false],
   ['workflow_dispatch','success',false,true],['workflow_dispatch','failure',false,false],
   ['workflow_dispatch','skipped',false,false],['workflow_dispatch','success',true,false]
  ])assert.equal(require('node:vm').runInNewContext(expression,{github:{event_name:eventName},needs:{preflight:{result}},cancelled:()=>cancelled}),expected,name+' '+eventName+' '+result);
 }
 assert.deepEqual([...workflow.jobs.mac_package.needs].sort(),['mac_binaries','preflight']);
 const macExpression=workflow.jobs.mac_package.if.replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/g,'');
 assert.equal(require('node:vm').runInNewContext(macExpression,{github:{event_name:'workflow_dispatch'},needs:{preflight:{result:'success'},mac_binaries:{result:'success'}},cancelled:()=>false}),true);
 assert.equal(require('node:vm').runInNewContext(macExpression,{github:{event_name:'workflow_dispatch'},needs:{preflight:{result:'failure'},mac_binaries:{result:'success'}},cancelled:()=>false}),false);
 assert.equal(require('node:vm').runInNewContext(macExpression,{github:{event_name:'push'},needs:{preflight:{result:'success'},mac_binaries:{result:'failure'}},cancelled:()=>false}),false);
 for(const job of [preflight,workflow.jobs.publish]){
  const guard=job.steps.find(step=>step.run?.startsWith('npm run release:verify'));
  assert(guard,'validate the version before building and recheck before publishing');
  assert.equal(guard.run,'npm run release:verify -- --tag "$GITHUB_REF_NAME"');
  assert.equal(guard.env.GH_TOKEN,'${{ github.token }}');
 }
 assertOnlyPushedVersionTags(preflight.steps.find(step=>step.run?.startsWith('npm run release:verify')).if);
 assert(workflow.jobs.validate.steps.some(step=>step.run?.startsWith('cargo test --locked')),'retain native tests on both operating systems');
 const publish=workflow.jobs.publish.steps;
 assert(publish.findIndex(step=>step.run?.startsWith('npm run release:verify'))<publish.findIndex(step=>step.run?.includes('gh release create')));
});
test('desktop workflows pin Rust and isolate writable release caches by target',()=>{
 const release=readWorkflow('desktop-release.yml'),windows=readWorkflow('windows-clipboard.yml');
 const rustSteps=[...Object.values(release.jobs),...Object.values(windows.jobs)].flatMap(job=>job.steps||[]).filter(step=>step.uses?.startsWith('dtolnay/rust-toolchain@'));
 assert(rustSteps.length>=5); for(const step of rustSteps)assert.equal(step.uses,'dtolnay/rust-toolchain@1.99.1');
 const validateCache=release.jobs.validate.steps.find(step=>step.uses?.startsWith('Swatinem/rust-cache@'));
 assert.equal(validateCache.with['save-if'],false);
 const binaryCache=release.jobs.mac_binaries.steps.find(step=>step.uses?.startsWith('Swatinem/rust-cache@'));
 assert.match(binaryCache.with['shared-key'],/matrix\.target/);
 const windowsCache=release.jobs.windows_package.steps.find(step=>step.uses?.startsWith('Swatinem/rust-cache@'));
 assert.equal(windowsCache.with['shared-key'],'build-x86_64-pc-windows-msvc');
 const standaloneCache=windows.jobs.clipboard.steps.find(step=>step.uses?.startsWith('Swatinem/rust-cache@'));
 assert.equal(standaloneCache.with['shared-key'],'build-x86_64-pc-windows-msvc'); assert.equal(standaloneCache.with['save-if'],false);
});
test('main, pull requests, and manual checks do not build or deploy the website',()=>{
 const workflow=readWorkflow('pages.yml');
 assert.equal(workflow.name,'Check');
 assert.deepEqual(workflow.on.push.branches,['main']);
 assert(Object.hasOwn(workflow.on,'pull_request'));
 assert(Object.hasOwn(workflow.on,'workflow_dispatch'));
 assert.equal(workflow.jobs.check.if,undefined);
 assert(workflow.jobs.check.steps.some(step=>step.run==='npm run check'));
 for(const job of Object.values(workflow.jobs))for(const step of job.steps||[]){
  assert(!/\bnpm\s+run\s+build\b/.test(step.run||''),'website build belongs to the release workflow');
  assert(!/^actions\/(?:upload-pages-artifact|deploy-pages)@/.test(step.uses||''),'checks must not upload or deploy Pages');
 }
});
test('website-only deployment is manual on main and cannot compile or publish desktop apps',()=>{
 const workflow=readWorkflow('website-deploy.yml');
 assert.deepEqual(Object.keys(workflow.on),['workflow_dispatch']);
 assert.deepEqual(Object.keys(workflow.jobs),['deploy']);
 const deploy=workflow.jobs.deploy;
 assert.equal(deploy.if,"github.ref == 'refs/heads/main'");
 assert.deepEqual(deploy.steps.filter(step=>step.run).map(step=>step.run),['npm ci --ignore-scripts','npm run check','npm run build']);
 assert.deepEqual(deploy.steps.filter(step=>step.uses).map(step=>step.uses.split('@')[0]),['actions/checkout','actions/setup-node','actions/upload-pages-artifact','actions/deploy-pages']);
 assert.equal(deploy.steps.find(step=>step.uses?.startsWith('actions/upload-pages-artifact@')).with.path,'dist');
 assert.equal(deploy.permissions.pages,'write');
 assert.equal(deploy.permissions['id-token'],'write');
 assert.equal(deploy.permissions.contents,'read');
 assert.equal(deploy.environment.name,'github-pages');
 assert.equal(deploy.concurrency.group,'pages');
 assert.equal(deploy.concurrency['cancel-in-progress'],false);
});
test('website artifacts are built from the pushed version tag before publishing installers',()=>{
 const workflow=readWorkflow('desktop-release.yml'),site=workflow.jobs['build-site'];
 assert(site);
 assertOnlyPushedVersionTags(site.if);
 assertOnlyPushedVersionTags(workflow.jobs.publish.if);
 const checkout=site.steps.find(step=>step.uses?.startsWith('actions/checkout@'));
 assert(checkout);
 assert(!checkout.with?.ref||['${{ github.ref }}','${{ github.sha }}'].includes(checkout.with.ref),'website must use the release tag rather than main');
 for(const command of ['npm ci --ignore-scripts','npm run build'])assert(site.steps.some(step=>step.run===command),command);
 const upload=site.steps.find(step=>step.uses?.startsWith('actions/upload-pages-artifact@'));
 assert(upload);
 assert.equal(upload.with.path,'dist');
 assert.equal(upload.with['retention-days'],3);
 assert.deepEqual([...workflow.jobs.publish.needs].sort(),['build-site','mac_package','validate','windows_package']);
});
test('Pages deployment follows a successful complete release and serializes production changes',()=>{
 const workflow=readWorkflow('desktop-release.yml'),deploy=workflow.jobs['deploy-pages'];
 assert(deploy);
 assert.deepEqual([...deploy.needs].sort(),['build-site','publish']);
 assert(!/\b(?:always|failure|cancelled)\s*\(/.test(deploy.if||''),'failed releases must not deploy the website');
 assert.equal(deploy.permissions.pages,'write');
 assert.equal(deploy.permissions['id-token'],'write');
 assert.equal(deploy.environment.name,'github-pages');
 assert(deploy.steps.some(step=>step.uses?.startsWith('actions/deploy-pages@')));
 assert.equal(workflow.concurrency.group,'desktop-release','different version tags must share the release lock');
 assert.equal(workflow.concurrency['cancel-in-progress'],false);
 assert.equal(deploy.concurrency.group,'pages');
 assert.equal(deploy.concurrency['cancel-in-progress'],false);
});
test('Pages deployment gate accepts Latest, skips older versions, and fails closed on API errors',()=>{
 const deploy=readWorkflow('desktop-release.yml').jobs['deploy-pages'];
 const gate=deploy.steps.find(step=>step.run?.includes('gh release view'));
 const action=deploy.steps.find(step=>step.uses?.startsWith('actions/deploy-pages@'));
 assert(gate?.id);
 assert.equal(deploy.permissions.contents,'read');
 for(const [value,expected] of [['true',true],['false',false],['',false]]){
  assert.equal(require('node:vm').runInNewContext(action.if,{steps:{[gate.id]:{outputs:{deploy:value}}}}),expected);
 }
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'md2chat-pages-gate-'));
 try{
  fs.writeFileSync(path.join(dir,'gh'),['#!/bin/sh','printf \'%s\\n\' "$@" > "$STUB_GH_ARGS"','if [ "$STUB_GH_EXIT" != "0" ]; then exit "$STUB_GH_EXIT"; fi','printf \'%s\\n\' "$STUB_LATEST_TAG"',''].join('\n'),{mode:0o755});
  for(const [latestTag,exitCode,expected] of [['v0.6.1',0,'deploy=true\n'],['v0.6.2',0,'deploy=false\n'],['v0.6.1',1,'']]){
   fs.writeFileSync(path.join(dir,'output'),'');
   fs.writeFileSync(path.join(dir,'summary'),'');
   const result=require('node:child_process').spawnSync('bash',['-e','-c','export PATH="$PWD:$PATH"\n'+gate.run],{cwd:dir,encoding:'utf8',env:{...process.env,GH_TOKEN:'test-token',GITHUB_REPOSITORY:'forgeturl/md2chat',GITHUB_REF_NAME:'v0.6.1',GITHUB_OUTPUT:'output',GITHUB_STEP_SUMMARY:'summary',STUB_GH_ARGS:'args',STUB_LATEST_TAG:latestTag,STUB_GH_EXIT:String(exitCode)}});
   assert.ifError(result.error);
   assert.equal(result.status,exitCode,result.stderr);
   assert.equal(fs.readFileSync(path.join(dir,'output'),'utf8'),expected);
   assert.deepEqual(fs.readFileSync(path.join(dir,'args'),'utf8').trim().split(/\r?\n/),['release','view','--repo','forgeturl/md2chat','--json','tagName','--jq','.tagName']);
   if(latestTag!=='v0.6.1')assert.match(fs.readFileSync(path.join(dir,'summary'),'utf8'),/no longer Latest/);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('workflow cleanup runs daily or manually without spawning after every check or release',()=>{
 const cleanup=readWorkflow('actions-cleanup.yml');
 assert.deepEqual(Object.keys(cleanup.on).sort(),['schedule','workflow_dispatch']);
 assert.deepEqual(cleanup.on.schedule,[{cron:'23 18 * * *'}]);
 assert(cleanup.jobs.cleanup.steps.some(step=>step.run==='node scripts/cleanup-actions.cjs --keep 10 --delete'));
});
