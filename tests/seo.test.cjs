const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {files,run}=require('../scripts/seo.cjs'),{origin,guides}=require('../scripts/site-content.cjs');
const root=path.resolve(__dirname,'..');
const {editions,route}=require('../scripts/site-locales.cjs');
const {content}=require('../scripts/site-copy.cjs');
test('published SEO metadata is current, canonical and discoverable without JavaScript',()=>{
 run(false);const output=files();
 for(const [name,page] of Object.entries(output).filter(([name])=>name.endsWith('.html'))){
  const url=origin+name.replace(/index\.html$/,'');
  assert(page.includes('rel="canonical" href="'+url+'"'));assert(page.match(/<title>[^<]+<\/title>/));assert(page.match(/name="description" content="[^"]+"/));assert(page.includes('property="og:image"'));assert(output['sitemap.xml'].includes('<loc>'+url+'</loc>'));
  for(const [,json] of page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)){const schema=JSON.parse(json);assert.equal(schema['@context'],'https://schema.org');assert(!schema.aggregateRating);}
  for(const [,link] of page.matchAll(/(?:href|src)="((?:\.{1,2}\/)+[^"#?]+)"/g))assert(fs.existsSync(path.resolve(root,path.dirname(name),link)),name+': '+link);
 }
 for(const g of guides){assert(output['index.html'].includes('./guides/'+g.slug+'.html'));assert(output['llms.txt'].includes(g.slug));}
});
test('SEO check accepts Windows CRLF checkout without hiding stale content',()=>{
 const os=require('node:os'),{execFileSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'md2chat-seo-crlf-'));
 try{
  fs.cpSync(path.join(root,'assets'),path.join(dir,'assets'),{recursive:true});
  for(const name of [...Object.keys(files()),'scripts/seo.cjs','scripts/site-content.cjs','scripts/site-content-en.cjs','scripts/site-home.cjs','scripts/site-copy.cjs','scripts/site-locales.cjs',...fs.readdirSync(path.join(root,'scripts/site-copy')).map(name=>'scripts/site-copy/'+name),'assets/locales.json','package.json']){
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
test('website assets have normalized content hashes so website-only releases do not reuse stale UI',()=>{
 const {createHash}=require('node:crypto'),output=files();
 for(const [name,page] of Object.entries(output).filter(([name])=>name.endsWith('.html'))){
  for(const [,relative,digest] of page.matchAll(/(?:src|href)="((?:\.{1,2}\/)+assets\/[^"?]+\.(?:js|css))\?v=[^"&]+&amp;h=([a-f0-9]{12})"/g)){
   const asset=path.posix.normalize(path.posix.join(path.posix.dirname(name),relative));
   const source=output[asset]??fs.readFileSync(path.join(root,asset),'utf8');
   assert.equal(digest,createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex').slice(0,12));
  }
  assert(page.includes('&amp;h='),name);
 }
});
test('every localized page has reciprocal language alternates, its own canonical and static translated content',()=>{
 const output=files(),urlFor=name=>origin+name.replace(/index\.html$/,'');
 const pages=Object.entries(output).filter(([name])=>name.endsWith('.html')&&name!=='editor.html');
 assert.equal(pages.length,81);
 for(const [name,page] of pages){
  const edition=editions.find(item=>item.directory&&name.startsWith(item.directory+'/'))||editions[0];
  assert(page.includes('<html lang="'+edition.code+'"'));
  const alternates=[...page.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)];
  assert.deepEqual(alternates.map(match=>match[1]),[...editions.map(item=>item.code),'x-default']);
  for(const [,language,url] of alternates){
   const relative=url.slice(origin.length),file=relative.endsWith('.html')?relative:relative+'index.html';
   assert(output[file],name+': alternate must be generated');
   if(language!=='x-default'){
    assert(output[file].includes('rel="canonical" href="'+url+'"'));
    assert(output[file].includes('href="'+urlFor(name)+'"'),'alternate must link back');
   }
  }
  assert(page.includes('"inLanguage":"'+edition.code+'"'));assert(page.includes('content="'+edition.ogLocale+'"'));
  if(name.includes('/guides/')||name.startsWith('guides/')){
   assert(page.includes('id="steps"'));assert(page.includes('id="example"'));assert(page.includes('id="evidence"'));
   assert(page.includes('dateModified'));assert(page.includes('<time datetime="2026-10-18">'));
  }
 }
 assert(output['en/index.html'].includes('md2chat is a free, open-source Markdown-to-chat converter.'));
 assert(output['index.html'].includes('md2chat 是免费开源的 Markdown 转聊天图文工具。'));
 assert(!output['editor.html'].includes('hreflang='),'the shared editor must not advertise a nonexistent English duplicate');
});
test('homepages and guides expose one native language menu with nine crawlable same-page links',()=>{
 const output=files();
 for(const [name,page] of Object.entries(output).filter(([name])=>name.endsWith('.html')&&name!=='editor.html')){
  const locale=page.match(/<html lang="([^"]+)"/)[1];
  const switches=[...page.matchAll(/<details class="site-language-picker">([\s\S]*?)<\/details>/g)];
  assert.equal(switches.length,1);
  assert.equal((switches[0][1].match(/<summary /g)||[]).length,1);
  const links=[...switches[0][1].matchAll(/<a ([^>]+)>/g)];
  assert.equal(links.length,9);
  assert.deepEqual(links.map(([,attrs])=>attrs.match(/data-site-locale="([^"]+)"/)[1]),editions.map(item=>item.code));
  assert.equal(links.filter(([,attrs])=>attrs.includes('aria-current="page"')).length,1);
  assert(links.find(([,attrs])=>attrs.includes('aria-current="page"'))[1].includes('lang="'+locale+'"'));
  const slug=name.includes('guides/')?path.basename(name,'.html'):'';
  for(const [,attrs] of links){
   const language=attrs.match(/data-site-locale="([^"]+)"/)[1],href=attrs.match(/href="([^"]+)"/)[1];
   const resolved=new URL(href,origin+name).href;
   assert.equal(resolved,origin+route(language,slug));
  }
  assert(!page.includes('data-locale-select'),'static pages must not expose a second UI-only selector');
  assert(!page.includes('<noscript>'),'links must exist both with and without JavaScript');
  assert(page.includes('assets/site-language.js'));
  assert(page.includes('assets/language-picker.css'));
 }
 assert(output['editor.html'].includes('data-locale-select'));
 assert(output['editor.html'].includes('assets/language-picker.js'));
});
test('guide examples match the editor seed and keep implementation evidence separate from client acceptance',()=>{
 const examples=require('../assets/guide-examples.js');
 const parser=require('../assets/chat-markdown.js');
 for(const {code:locale} of editions){
  const list=content[locale].guides;
  for(const guide of list)assert.equal(guide.example,examples[locale]);
  assert(parser.parse(examples[locale]).some(block=>block.type==='table'));
 }
 const output=files();
 assert(output['llms.txt'].includes('Windows DingTalk generates a node tree with embedded PNGs.'));
 assert(!output['llms.txt'].includes('Windows DingTalk private clipboard is not implemented'));
 assert(output['en/guides/markdown-to-feishu.html'].includes('still needs a destination paste test'));
 assert(output['guides/markdown-to-wecom.html'].includes('测试未发送消息'));
});
test('all nine editions contain real translated product facts, complete guides and matching editor examples',()=>{
 const output=files(),vm=require('node:vm'),i18n=require('../assets/i18n.js');
 const examples=require('../assets/guide-examples.js');
 const esc=text=>text.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 for(const {code,name} of editions){
  const copy=content[code],page=output[route(code)+'index.html'];
  assert.deepEqual(Object.keys(copy.home).sort(),Object.keys(content.en.home).sort());
  assert.deepEqual(Object.keys(copy.labels).sort(),Object.keys(content.en.labels).sort());
  assert.equal(copy.home.features.length,3);assert.equal(copy.home.rows.length,4);assert.equal(copy.home.questions.length,3);
  assert(page.includes(esc(copy.home.definition)));assert(page.includes(esc(copy.home.description)));
  assert.equal((page.match(/<h1\b/g)||[]).length,1);
  assert(output['llms.txt'].includes('- ['+name+']('+origin+route(code)+')'));
  const rendered={textContent:''};
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/editor-example.js'),'utf8'),{
   navigator:{languages:['en']},localStorage:{getItem:()=> 'en'},location:{search:'?example=chat-table&lang='+code},URLSearchParams,
   md2chatI18n:i18n,md2chatGuideExamples:examples,document:{getElementById:()=>rendered}
  });
  assert.equal(rendered.textContent,examples[code],'guide CTA must seed its own language: '+code);
  for(const guide of copy.guides){
   const html=output[route(code,guide.slug)];
   assert(html.includes(esc(guide.title)));assert(html.includes(esc(guide.description)));
   assert(guide.sections.length>=4);assert(guide.steps.length>=3);assert(guide.evidence.length>=1);
   for(const [heading,text] of guide.sections){assert(heading.length>=2);assert(text.length>45,code+'/'+guide.slug+': empty or incomplete answer');assert(html.includes(esc(text)));}
   if(!['zh-CN','en'].includes(code)){
    const original=content.en.guides.find(g=>g.slug===guide.slug);
    assert.notEqual(guide.title,original.title);
    for(const [,text] of guide.sections)assert(!original.sections.some(([,english])=>text===english),'no English fallback body');
   }
  }
 }
 assert.equal(Object.keys(output).filter(name=>name.endsWith('.html')).length,82);
});
