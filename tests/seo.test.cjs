const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {files,run}=require('../scripts/seo.cjs'),{origin,guides}=require('../scripts/site-content.cjs');
const root=path.resolve(__dirname,'..');
test('published SEO metadata is current, canonical and discoverable without JavaScript',()=>{
 run(false);const output=files();
 for(const [name,page] of Object.entries(output).filter(([name])=>name.endsWith('.html'))){
  const url=origin+name.replace(/index\.html$/,'');
  assert(page.includes('rel="canonical" href="'+url+'"'));assert(page.match(/<title>[^<]+<\/title>/));assert(page.match(/name="description" content="[^"]+"/));assert(page.includes('property="og:image"'));assert(output['sitemap.xml'].includes('<loc>'+url+'</loc>'));
  for(const [,json] of page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)){const schema=JSON.parse(json);assert.equal(schema['@context'],'https://schema.org');assert(!schema.aggregateRating);}
  for(const [,link] of page.matchAll(/(?:href|src)="(\.{1,2}\/[^"#?]+)"/g))assert(fs.existsSync(path.resolve(root,path.dirname(name),link)),name+': '+link);
 }
 for(const g of guides){assert(output['index.html'].includes('./guides/'+g.slug+'.html'));assert(output['llms.txt'].includes(g.slug));}
});
test('SEO check accepts Windows CRLF checkout without hiding stale content',()=>{
 const os=require('node:os'),{execFileSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-seo-crlf-'));
 try{
  for(const name of [...Object.keys(files()),'scripts/seo.cjs','scripts/site-content.cjs','scripts/site-content-en.cjs','scripts/site-home.cjs','assets/locales.json','package.json']){
   fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});
   fs.writeFileSync(path.join(dir,name),fs.readFileSync(path.join(root,name),'utf8').replaceAll('\r\n','\n').replaceAll('\n','\r\n'));
  }
  execFileSync(process.execPath,[path.join(dir,'scripts/seo.cjs')],{stdio:'pipe'});
  const generated=Object.keys(files());
  const before=generated.map(name=>fs.readFileSync(path.join(dir,name),'utf8').replaceAll('\r\n','\n'));
  for(let i=0;i<2;i++)execFileSync(process.execPath,[path.join(dir,'scripts/seo.cjs'),'--write'],{stdio:'pipe'});
  assert.deepEqual(generated.map(name=>fs.readFileSync(path.join(dir,name),'utf8')),before,'regeneration must be idempotent');
  fs.appendFileSync(path.join(dir,'llms.txt'),'stale content');
  assert.throws(()=>execFileSync(process.execPath,[path.join(dir,'scripts/seo.cjs')],{stdio:'pipe'}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('every localized page has reciprocal language alternates, its own canonical and static translated content',()=>{
 const output=files(),urlFor=name=>origin+name.replace(/index\.html$/,'');
 const pages=Object.entries(output).filter(([name])=>name.endsWith('.html')&&name!=='editor.html');
 assert.equal(pages.length,18);
 for(const [name,page] of pages){
  const english=name.startsWith('en/');
  assert(page.includes('<html lang="'+(english?'en':'zh-CN')+'"'));
  const alternates=[...page.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)];
  assert.deepEqual(alternates.map(match=>match[1]),['zh-CN','en','x-default']);
  for(const [,language,url] of alternates){
   const relative=url.slice(origin.length),file=relative.endsWith('.html')?relative:relative+'index.html';
   assert(output[file],name+': alternate must be generated');
   if(language!=='x-default'){
    assert(output[file].includes('rel="canonical" href="'+url+'"'));
    assert(output[file].includes('href="'+urlFor(name)+'"'),'alternate must link back');
   }
  }
  if(english){assert(!page.includes('"inLanguage":"zh-CN"'));assert(page.includes('content="en_US"'));}
  if(name.includes('/guides/')||name.startsWith('guides/')){
   assert(page.includes('id="steps"'));assert(page.includes('id="example"'));assert(page.includes('id="evidence"'));
   assert(page.includes('dateModified'));assert(page.includes('<time datetime="2026-10-18">'));
  }
 }
 assert(output['en/index.html'].includes('md2chat is a free, open-source Markdown-to-chat converter.'));
 assert(output['index.html'].includes('md2chat 是免费开源的 Markdown 转聊天图文工具。'));
 assert(!output['editor.html'].includes('hreflang='),'the shared editor must not advertise a nonexistent English duplicate');
});
test('homepages unify all languages in one picker with static links only as a no-JavaScript fallback',()=>{
 const output=files();
 for(const [name,locale] of [['index.html','zh-CN'],['en/index.html','en']]){
  const page=output[name];
  const switches=[...page.matchAll(/<noscript><span class="site-languages"[^>]*>(.*?)<\/span><\/noscript>/g)];
  assert.equal(switches.length,1);
  assert(switches[0][0].includes('role="group"'));
  const links=[...switches[0][1].matchAll(/<a ([^>]+)>([^<]+)<\/a>/g)];
  assert.deepEqual(links.map(([,attrs,text])=>text),['中文','English']);
  assert.equal(links.filter(([,attrs])=>attrs.includes('aria-current="page"')).length,1);
  assert(links.find(([,attrs])=>attrs.includes('aria-current="page"'))[1].includes('lang="'+locale+'"'));
  assert.equal((page.match(/data-locale-select/g)||[]).length,1);
  assert.equal((page.match(/class="site-languages"/g)||[]).length,1,'no duplicate static links outside noscript');
  assert(page.includes('data-language-zh-cn="'+(locale==='en'?'../':'./')+'"'));
  assert(page.includes('data-language-en="'+(locale==='en'?'./':'./en/')+'"'));
  assert(page.includes('assets/language-picker.js'));
  assert(page.includes('assets/language-picker.css'));
 }
 assert(output['editor.html'].includes('data-locale-select'));
 assert(output['editor.html'].includes('assets/language-picker.js'));
});
test('guide examples match the editor seed and keep implementation evidence separate from client acceptance',()=>{
 const englishGuides=require('../scripts/site-content-en.cjs').guides;
 const examples=require('../assets/guide-examples.js');
 const parser=require('../assets/chat-markdown.js');
 for(const [locale,list] of [['zh-CN',guides],['en',englishGuides]]){
  for(const guide of list)assert.equal(guide.example,examples[locale]);
  assert(parser.parse(examples[locale]).some(block=>block.type==='table'));
 }
 const output=files();
 assert(output['llms.txt'].includes('Windows DingTalk generates a node tree with embedded PNGs.'));
 assert(!output['llms.txt'].includes('Windows DingTalk private clipboard is not implemented'));
 assert(output['en/guides/markdown-to-feishu.html'].includes('still needs a destination paste test'));
 assert(output['guides/markdown-to-wecom.html'].includes('测试未发送消息'));
});
