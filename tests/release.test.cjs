const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('static entry assets resolve under a project subdirectory',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
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
 const code=fs.readFileSync(path.join(root,'scripts/build.cjs'),'utf8');assert(code.includes("['index.html','assets','LICENSE','THIRD_PARTY_NOTICES.md']"));
});
