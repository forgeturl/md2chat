const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {run}=require('../scripts/release.cjs');
async function fixture(action){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-tauri-version-'));
 fs.mkdirSync(path.join(root,'docs'));fs.mkdirSync(path.join(root,'src-tauri'));
 const pkg={name:'md2chat',version:'0.6.6',build:{publish:{provider:'github',owner:'forgeturl',repo:'md2chat'}}};
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));
 fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify({version:pkg.version,packages:{'':{version:pkg.version}}}));
 fs.writeFileSync(path.join(root,'docs/release-notes.md'),'# v0.6.6\n\n- 既有说明。\n');
 fs.writeFileSync(path.join(root,'notes.md'),'- 使用 Tauri 桌面运行时。\n');
 fs.writeFileSync(path.join(root,'src-tauri/Cargo.toml'),'[package]\nname = "md2chat"\nversion = "0.6.6"\n\n[dependencies]\nserde = "1"\n');
 fs.writeFileSync(path.join(root,'src-tauri/Cargo.lock'),'version = 4\n\n[[package]]\nname = "another"\nversion = "9.9.9"\n\n[[package]]\nname = "md2chat"\nversion = "0.6.6"\n');
 fs.writeFileSync(path.join(root,'src-tauri/tauri.conf.json'),JSON.stringify({version:'../package.json'}));
 const options={root,env:{},log(){},fetchImpl:async()=>new Response(JSON.stringify({tag_name:'v0.6.5',draft:false,prerelease:false}))};
 try{await action(root,options);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('release preparation keeps Rust package and lock versions in the same atomic update',()=>fixture(async(root,options)=>{
 await run(['prepare','patch','--notes-file',path.join(root,'notes.md')],options);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'0.6.7');
 assert.match(fs.readFileSync(path.join(root,'src-tauri/Cargo.toml'),'utf8'),/version = "0.6.7"/);
 const lock=fs.readFileSync(path.join(root,'src-tauri/Cargo.lock'),'utf8');
 assert.match(lock,/name = "md2chat"\nversion = "0.6.7"/);assert.match(lock,/name = "another"\nversion = "9.9.9"/);
}));
test('Rust and frontend version drift prevents any preparation writes',()=>fixture(async(root,options)=>{
 fs.writeFileSync(path.join(root,'src-tauri/Cargo.toml'),'[package]\nname = "md2chat"\nversion = "0.1.0"\n');
 await assert.rejects(()=>run(['prepare','patch','--notes-file',path.join(root,'notes.md')],options),/Cargo.toml/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,'0.6.6');
}));
