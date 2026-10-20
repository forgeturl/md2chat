const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {buildHistory,validateHistory} = require('../scripts/update-history.cjs');
const {catalog,fixture} = require('./helpers/update-history.cjs');
function withFiles(fn, data = catalog()) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-history-'));
 const history = buildHistory(data,'0.7.0');
 try {for (const [name,bytes] of history.files) fs.writeFileSync(path.join(dir,name),bytes);return fn(dir,history);}
 finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('history is split by language and 50-patch ranges, with a small current-version manifest',()=>withFiles((dir,history)=>{
 const index=JSON.parse(history.files.get('update-history-v1.json'));
 assert.deepEqual(index.chunks.map(chunk=>chunk.versions),[['0.7.0'],['0.6.50'],['0.6.49']]);
 const names=validateHistory(dir,history.metadata,'0.7.0');assert.equal(names.length,28);
 const en=JSON.parse(history.files.get(index.chunks[1].files.en.file));
 assert.equal(en.locale,'en');assert.deepEqual(en.releases[0].summary,['en update 0.6.50']);
 assert.deepEqual(en.releases[0].important,['Save your settings.']);
 assert.equal(history.metadata.current.version,'0.7.0');assert.equal(history.metadata.releases,undefined);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/update-history-v1.json'),'utf8')),fixture(),'the Node producer and native reader share one protocol fixture');
}));
test('newly prepared summaries validate regardless of version and translation property order',()=>{
 const data=catalog();
 data[0]={important:data[1].important,summary:Object.fromEntries(Object.entries(data[0].summary).reverse()),version:data[0].version};
 withFiles((dir,history)=>{
  assert.equal(validateHistory(dir,history.metadata,'0.7.0').length,28);
 },data);
});
test('missing, corrupt or mismatched historical files stop release validation',()=>{
 for (const mutate of [
  (dir,h)=>fs.unlinkSync(path.join(dir,h.metadata.history.file)),
  (dir,h)=>fs.appendFileSync(path.join(dir,[...h.files.keys()][0]),'changed'),
  (dir,h)=>{h.metadata.current.summary.en=['Mismatch'];},
  (dir,h)=>{h.metadata.history.file='../outside.json';},
  (dir,h)=>fs.writeFileSync(path.join(dir,'update-history-v1-obsolete.json'),'{}')
 ]) withFiles((dir,history)=>{mutate(dir,history);assert.throws(()=>validateHistory(dir,history.metadata,'0.7.0'));});
});
test('unpublished tags stay in authoring records and are omitted from runtime history',()=>{
 const data=catalog();data.splice(1,0,{version:'0.6.51',unpublished:true});
 const history=buildHistory(data,'0.7.0'),index=JSON.parse(history.files.get('update-history-v1.json'));
 assert(!index.chunks.flatMap(chunk=>chunk.versions).includes('0.6.51'));
});
