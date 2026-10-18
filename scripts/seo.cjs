const fs=require('node:fs'),path=require('node:path');
const {origin,guides}=require('./site-content.cjs');
const englishGuides=require('./site-content-en.cjs').guides;
const {content:home}=require('./site-home.cjs');
const translations=require('../assets/locales.json').messages;
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const route=(locale,slug='')=>(locale==='en'?'en/':'')+(slug?'guides/'+slug+'.html':'');
const locales=['zh-CN','en'];
function alternates(slug=''){
 return [...locales.map(locale=>`<link rel="alternate" hreflang="${locale}" href="${origin+route(locale,slug)}">`),
  `<link rel="alternate" hreflang="x-default" href="${origin+route('zh-CN',slug)}">`].join('\n');
}
function metadata(title,description,url,schema,{locale='zh-CN',slug,paired=false}={}){
 const imageAlt=locale==='en'?'md2chat Markdown input and chat preview':'md2chat Markdown 输入与图文预览界面';
 return `<!-- seo:start -->
<link rel="canonical" href="${url}">
${paired?alternates(slug):''}
<meta property="og:type" content="${slug?'article':'website'}"><meta property="og:locale" content="${locale==='en'?'en_US':'zh_CN'}"><meta property="og:site_name" content="md2chat">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}assets/desktop-preview.png"><meta property="og:image:alt" content="${imageAlt}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${origin}assets/desktop-preview.png">
${schema?'<script type="application/ld+json">'+JSON.stringify(schema).replaceAll('<','\\u003c')+'</script>':''}
<!-- seo:end -->`;
}
function replaceRegion(page,name,html,before){
 const region=`<!-- ${name}:start -->\n${html}\n<!-- ${name}:end -->`;
 const marker=new RegExp(`<!-- ${name}:start -->[\\s\\S]*?<!-- ${name}:end -->`);
 if(marker.test(page))return page.replace(marker,()=>region);
 const index=page.indexOf(before);
 if(index===-1)throw new Error('Missing homepage anchor: '+name);
 return page.slice(0,index)+region+'\n'+page.slice(index);
}
function homeSections(locale){
 const c=home[locale];
 return `<section class="product-details" data-no-i18n aria-labelledby="features-title"><h2 id="features-title">${esc(c.featuresTitle)}</h2>
<div class="feature-grid">${c.features.map(([title,text])=>`<article><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join('\n')}</div></section>
<section class="product-details" data-no-i18n aria-labelledby="compatibility-title"><h2 id="compatibility-title">${esc(c.compatibilityTitle)}</h2>
<div class="table-scroll" tabindex="0" role="region" aria-labelledby="compatibility-title"><table><thead><tr>${c.columns.map(value=>`<th scope="col">${esc(value)}</th>`).join('')}</tr></thead><tbody>${c.rows.map(row=>`<tr>${row.map((value,i)=>i===0?`<th scope="row">${esc(value)}</th>`:`<td>${esc(value)}</td>`).join('')}</tr>`).join('\n')}</tbody></table></div>
<p><a href="https://github.com/forgeturl/md2chat/blob/main/docs/compatibility.md">${esc(c.evidence)}</a></p></section>
<section class="product-details" data-no-i18n aria-labelledby="faq-title"><h2 id="faq-title">${esc(c.faqTitle)}</h2>
${c.questions.map(([question,answer])=>`<details><summary>${esc(question)}</summary><p>${esc(answer)}</p></details>`).join('\n')}</section>`;
}
// This build-time translation only handles trusted homepage UI, never editor input.
function englishHome(page){
 const attributes={'主导航':'Main navigation','Markdown 转换示例':'Markdown conversion example'};
 return page.replace(/>([^<]+)</g,(all,text)=>{
  const key=text.trim(),entry=translations[key];
  return entry?('>'+text.replace(key,esc(entry.en))+'<'):all;
 }).replace(/\b(aria-label|title|alt)="([^"]*)"/g,(all,name,value)=>
  (translations[value]||attributes[value])?`${name}="${esc(translations[value]?.en||attributes[value])}"`:all);
}
function homepage(source,locale,list){
 const english=locale==='en',c=home[locale],url=origin+route(locale);
 let page=source.replace(/\n?<!-- seo:start -->[\s\S]*?<!-- seo:end -->\n?/,'\n');
 if(english)page=englishHome(page).replaceAll('="./assets/','="../assets/').replaceAll('="./editor.html','="../editor.html');
 page=page.replace(/<html[^>]*>/,`<html lang="${locale}" data-site-language="${locale}">`)
  .replace(/<title>.*?<\/title>/,`<title>${esc(c.title)}</title>`)
  .replace(/<meta name="description" content="[^"]*">/,`<meta name="description" content="${esc(c.description)}">`)
  .replace(/<h1 id="hero-title"[^>]*>[\s\S]*?<\/h1>/,`<h1 id="hero-title">${c.heading}</h1>`);
 page=replaceRegion(page,'product-definition',`<p class="product-definition" data-no-i18n>${esc(c.definition)}</p>`,' </div>\n <div class="demo-pair"');
 const languageLinks=`<span class="site-languages" data-no-i18n><a href="${english?'../':'./'}" lang="zh-CN" hreflang="zh-CN"${english?'':' aria-current="page"'}>中文</a><a href="${english?'./':'./en/'}" lang="en" hreflang="en"${english?' aria-current="page"':''}>English</a></span>`;
 page=replaceRegion(page,'site-languages',languageLinks,'  <select class="language-select"');
 page=replaceRegion(page,'product-details',homeSections(locale),'<section class="guides-section"');
 const links=`<section class="guides-section" id="guides" aria-labelledby="guides-title" data-no-i18n>
 <div class="section-heading"><h2 id="guides-title">${esc(c.guidesTitle)}</h2><p>${esc(c.guidesLabel)}</p></div>
 <div class="guide-links">${list.map(g=>`<a href="./guides/${g.slug}.html"><span>${esc(g.title)}</span><span aria-hidden="true">↗</span></a>`).join('\n')}</div>
</section>`;
 page=page.replace(/<section class="guides-section"[\s\S]*?<\/section>/,()=>links);
 const schema={'@context':'https://schema.org','@type':'SoftwareApplication','@id':origin+'#app',name:'md2chat',url,description:c.description,
  inLanguage:locale,applicationCategory:'ProductivityApplication',operatingSystem:'macOS, Windows, Web',isAccessibleForFree:true,
  offers:{'@type':'Offer',price:'0',priceCurrency:'USD'},license:'https://github.com/forgeturl/md2chat/blob/main/LICENSE',
  downloadUrl:'https://github.com/forgeturl/md2chat/releases/latest',screenshot:origin+'assets/desktop-preview.png',sameAs:['https://github.com/forgeturl/md2chat']};
 return page.replace('</head>',metadata(c.title,c.description,url,schema,{locale,paired:true})+'\n</head>');
}
function guidePage(g,locale,list){
 const english=locale==='en',prefix=english?'../../':'../',url=origin+route(locale,g.slug),title=g.title+' | md2chat';
 const labels=english?{editor:'Try the editor',download:'Download desktop',steps:'Step by step',example:'A public example',check:'Check the opening text, table image and closing text in your own draft. Ordinary text should remain editable.',evidence:'Implementation and validation records',sources:'Official sources',related:'Related guides',cta:'Try the sample in the editor',feedback:'Report an issue',reviewed:'Content reviewed',contents:'On this page'}:
  {editor:'试用转换器',download:'下载桌面版',steps:'操作步骤',example:'可复现的公开示例',check:'在自己的草稿中核对开头、表格图片和结尾，并检查普通文字仍可编辑。',evidence:'实现与验证依据',sources:'官方资料',related:'相关指南',cta:'在编辑器试用此示例',feedback:'反馈问题',reviewed:'内容核对日期',contents:'本页内容'};
 const headings=[...g.sections.map(([h],i)=>[h,'answer-'+i]),[labels.steps,'steps'],[labels.example,'example'],[labels.evidence,'evidence']];
 const schema={'@context':'https://schema.org','@type':'TechArticle',headline:g.title,description:g.description,url,inLanguage:locale,
  dateModified:g.reviewed,author:{'@type':'Organization',name:'md2chat contributors',url:'https://github.com/forgeturl/md2chat'},citation:g.evidence.map(([,link])=>link)};
 return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(g.description)}"><link rel="icon" href="${prefix}assets/favicon.png"><link rel="stylesheet" href="${prefix}assets/landing.css?v=${version}"><link rel="stylesheet" href="${prefix}assets/site-guides.css?v=${version}">
${metadata(title,g.description,url,schema,{locale,slug:g.slug,paired:true})}</head>
<body><div class="shell guide"><header class="nav"><a class="brand" href="../">md2chat</a><nav class="nav-links" aria-label="${english?'Navigation':'导航'}"><a href="${prefix}editor.html">${labels.editor}</a><a href="../#download">${labels.download}</a><a href="${english?'../../guides/':'../en/guides/'}${g.slug}.html" lang="${english?'zh-CN':'en'}" hreflang="${english?'zh-CN':'en'}">${english?'中文':'English'}</a></nav></header>
<main><h1>${esc(g.title)}</h1><p class="lead">${esc(g.description)}</p><p class="reviewed">${labels.reviewed}：<time datetime="${g.reviewed}">${g.reviewed}</time></p>
<nav class="guide-contents" aria-label="${labels.contents}">${headings.map(([h,id])=>`<a href="#${id}">${esc(h)}</a>`).join('')}</nav>
${g.sections.map(([h,p],i)=>`<section id="answer-${i}"><h2>${esc(h)}</h2><p>${esc(p)}</p></section>`).join('\n')}
<section id="steps"><h2>${labels.steps}</h2><ol>${g.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol></section>
<section id="example"><h2>${labels.example}</h2><pre><code>${esc(g.example)}</code></pre><p>${labels.check}</p><p><a class="button" href="${prefix}editor.html?example=chat-table&amp;lang=${locale}">${labels.cta}</a></p></section>
<section id="evidence"><h2>${labels.evidence}</h2><ul>${g.evidence.map(([label,link])=>`<li><a href="${esc(link)}">${esc(label)}</a></li>`).join('')}</ul></section>
${g.sources?.length?`<section><h2>${labels.sources}</h2><ul>${g.sources.map(([label,link])=>`<li><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></li>`).join('')}</ul></section>`:''}
<section><h2>${labels.related}</h2><ul>${list.filter(x=>x.slug!==g.slug).map(x=>`<li><a href="./${x.slug}.html">${esc(x.title)}</a></li>`).join('')}</ul></section></main>
<footer class="footer"><a href="https://github.com/forgeturl/md2chat/blob/main/docs/compatibility.md">${labels.evidence}</a><a href="https://github.com/forgeturl/md2chat/issues">${labels.feedback}</a></footer></div></body></html>\n`;
}
function files(){
 if(new Set(guides.map(g=>g.slug)).size!==guides.length||guides.length!==englishGuides.length||guides.some(g=>!englishGuides.some(e=>e.slug===g.slug)))throw new Error('Every guide must have exactly one matching English edition.');
 const output={},source=fs.readFileSync(path.join(root,'index.html'),'utf8').replaceAll('\r\n','\n');
 for(const [locale,list] of [['zh-CN',guides],['en',englishGuides]]){
  output[locale==='en'?'en/index.html':'index.html']=homepage(source,locale,list);
  for(const g of list)output[route(locale,g.slug)]=guidePage(g,locale,list);
 }
 let editor=fs.readFileSync(path.join(root,'editor.html'),'utf8').replaceAll('\r\n','\n');
 const title='Markdown 图文转换器 — 微信、钉钉、飞书、企微、邮件 | md2chat';
 const description='在线输入 Markdown 或图文，按目标复制；企微图文按顺序分段复制、粘贴，钉钉、飞书请下载桌面版。表格和代码转图片，邮件保留可编辑表格；不上传正文，实际粘贴以客户端为准。';
 editor=editor.replace(/<title>.*?<\/title>/,`<title>${title}</title>`).replace(/<meta name="description" content="[^"]*">/,`<meta name="description" content="${description}">`)
  .replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,()=>metadata(title,description,origin+'editor.html'));
 output['editor.html']=editor;
 output['assets/guide-examples.js']='// Generated by scripts/seo.cjs from the public guide examples.\n'+
  '(function(root){const examples='+JSON.stringify({'zh-CN':guides[0].example,en:englishGuides[0].example})+';if(typeof module===\'object\')module.exports=examples;else root.md2chatGuideExamples=examples;})(globalThis);\n';
 for(const name of Object.keys(output).filter(name=>name.endsWith('.html')))output[name]=output[name].replace(/((?:src|href)="\.{1,2}\/assets\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g,'$1?v='+version+'"');
 const routes=Object.keys(output).filter(name=>name.endsWith('.html')).map(name=>name.replace(/index\.html$/,''));
 output['sitemap.xml']='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+routes.map(p=>`<url><loc>${origin+p}</loc></url>`).join('\n')+'\n</urlset>\n';
 output['llms.txt']='# md2chat\n\n> '+home.en.definition+'\n\n## Product\n\n- [中文首页]('+origin+'): '+home['zh-CN'].description+'\n- [English home]('+origin+'en/): '+home.en.description+'\n- [Web editor]('+origin+'editor.html): Local conversion; browser and destination-client limitations apply.\n- [Source, releases and compatibility](https://github.com/forgeturl/md2chat): MIT-licensed source and validation records.\n\n'+
  [['中文指南',guides,'zh-CN'],['English guides',englishGuides,'en']].map(([label,list,locale])=>'## '+label+'\n\n'+list.map(g=>'- ['+g.title+']('+origin+route(locale,g.slug)+'): '+g.description).join('\n')).join('\n\n')+
  '\n\n## Compatibility and evidence\n\n'+home.en.rows.map(([name,,limit])=>'- '+name+': '+limit).join('\n')+
  '\n\nWindows DingTalk generates a node tree with embedded PNGs. Windows Feishu generates editor fragments and local PNG references. Source-sample rewriting and format implementation are not acceptance of newly generated content. WeCom image content requires sequential text and PNG copies. The web editor disables DingTalk and Feishu copying. Ordinary text remains editable; text inside PNGs does not.\n\n## Privacy\n\nConversion runs locally without an account. Content is not uploaded to md2chat. Remote image URLs still contact their original hosts. Native copying may cache PNGs locally. AI tool names describe possible Markdown sources, not official integrations.\n';
 return output;
}
function run(write){
 let failed=false;
 for(const [name,content] of Object.entries(files())){
  const file=path.join(root,name);
  if(write){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
  else if(!fs.existsSync(file)||fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')!==content){console.error('SEO output outdated: '+name);failed=true;}
 }
 if(failed)throw new Error('Run npm run seo:generate and review the public text.');
}
if(require.main===module){run(process.argv.includes('--write'));console.log('SEO pages, language alternates, sitemap and llms.txt are consistent.');}
module.exports={files,run};
