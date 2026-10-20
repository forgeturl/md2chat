const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const {checkReadmes, stamp} = require('../scripts/check-readmes.cjs');
const {editions, route, sourcePath} = require('../scripts/site-locales.cjs');
test('all README translations are present and a source edit requires review of every language', () => {
 checkReadmes(root);
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-readme-'));
 try {
  for (const file of ['README.md','docs','LICENSE','THIRD_PARTY_NOTICES.md']) fs.cpSync(path.join(root,file),path.join(temp,file),{recursive:true});
  fs.appendFileSync(path.join(temp,'README.md'),'\nA reviewed source change.\n');
  assert.throws(() => checkReadmes(temp), /translation needs review/);
  stamp(temp,'en');
  assert.throws(() => checkReadmes(temp), /translation needs review/,'reviewing English must not mark other languages current');
  for (const {code} of editions.filter(item=>item.code!=='zh-CN')) stamp(temp,code);
  checkReadmes(temp);
  assert.throws(() => stamp(temp,'../README'), /Choose one/);
  fs.appendFileSync(path.join(temp,'docs/readme/en.md'),'\n[Broken](missing.md)\n');
  assert.throws(() => checkReadmes(temp), /Broken README link/);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('localized sources are grouped while built routes, assets and public URLs remain valid', () => {
 const {buildSite} = require('../scripts/build.cjs');
 const {files} = require('../scripts/seo.cjs');
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'md2chat-public-'));
 try {
  buildSite(root,temp);
  for (const [publicPath, content] of Object.entries(files())) {
   assert.equal(fs.readFileSync(path.join(temp,publicPath),'utf8').replaceAll('\r\n','\n'),content,publicPath);
  }
  for (const {code,directory} of editions.filter(item=>item.directory)) {
   assert(!fs.existsSync(path.join(root,directory)),directory+' must not be scattered at the source root');
   assert.equal(sourcePath(route(code)+'index.html'),'site/locales/'+directory+'/index.html');
   assert(fs.existsSync(path.join(temp,directory,'index.html')));
  }
  for (const privatePath of ['site','docs','src-tauri','scripts','README.md']) assert(!fs.existsSync(path.join(temp,privatePath)));
  assert.equal(sourcePath('assets/style.css'),'assets/style.css');
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
