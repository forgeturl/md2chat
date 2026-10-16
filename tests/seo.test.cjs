const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {files,run}=require('../scripts/seo.cjs'),{origin,guides}=require('../scripts/site-content.cjs');
const root=path.resolve(__dirname,'..');
test('published SEO metadata is current, canonical and discoverable without JavaScript',()=>{
 run(false);const output=files();
 for(const [name,page] of Object.entries(output).filter(([name])=>name.endsWith('.html'))){
  const url=origin+(name==='index.html'?'':name);
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
  for(const name of [...Object.keys(files()),'scripts/seo.cjs','scripts/site-content.cjs','package.json']){
   fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});
   fs.writeFileSync(path.join(dir,name),fs.readFileSync(path.join(root,name),'utf8').replaceAll('\r\n','\n').replaceAll('\n','\r\n'));
  }
  execFileSync(process.execPath,[path.join(dir,'scripts/seo.cjs')],{stdio:'pipe'});
  fs.appendFileSync(path.join(dir,'llms.txt'),'stale content');
  assert.throws(()=>execFileSync(process.execPath,[path.join(dir,'scripts/seo.cjs')],{stdio:'pipe'}));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
