const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../assets/vendor/highlight/highlight.min.js');
const cards=require('../assets/code-images.js');
test('JS highlighting preserves literal text while assigning syntax colors',()=>{
 const source='// 中文 <script> & test\nconst x = "hello";\nconst n = 42;\nconst quote = \'hi\';';
 const result=cards.tokens(source,'js',engine);
 assert.equal(result.label,'JavaScript');assert.equal(result.runs.map(r=>r.text).join(''),source);
 assert(new Set(result.runs.map(r=>r.color)).size>=4);
 for(const language of ['typescript','python','json','html','css','sql','go','bash'])assert(engine.getLanguage(language),language);
 assert.deepEqual(cards.tokens(source,'unknown-language',engine).runs.map(r=>r.text),[source]);
 assert.throws(()=>cards.tokens('x'.repeat(50001),'js',engine),/过长/);
});
test('wrapping preserves Unicode, indentation, blank lines, and original line numbering',()=>{
 const rows=cards.layout([{text:'\tconst 😀 = 1;\n\n尾行',color:'blue'}],s=>[...s].length,8);
 assert.equal(rows.map(r=>r.runs.map(x=>x.text).join('')).join(''),'    const 😀 = 1;尾行');
 assert.deepEqual(rows.map(r=>r.number),[1,null,2,3]);
 assert(rows.every(r=>r.width<=8));
});
test('long code splits into bounded PNG cards with continuous source line numbers',()=>{
 const labels=[];let canvas;
 global.document={createElement:()=>canvas={getContext:()=>({measureText:s=>({width:[...s].length*10}),scale(){},fillRect(){},fillText(text){labels.push(text)}}),toDataURL:()=> 'data:image/png;base64,PNG'}};
 try{
  const result=cards.render(Array.from({length:80},(_,i)=>'const n = '+i+';').join('\n'),'js',engine);
  assert.equal(result.length,3);assert(result.every(i=>i.width===i.displayWidth*2&&i.height===i.displayHeight*2));
  assert(labels.includes('37'));assert(labels.includes('80'));assert(labels.includes('3 / 3'));
 }finally{delete global.document;}
});
