const fs=require('node:fs'),path=require('node:path');
const {origin,guides}=require('./site-content.cjs');
const root=path.resolve(__dirname,'..');
const version=require('../package.json').version;
const esc=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function metadata(title,description,url,schema){return `<!-- seo:start -->
<link rel="canonical" href="${url}">
<meta property="og:type" content="website"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="md2chat">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${origin}assets/desktop-preview.png"><meta property="og:image:alt" content="md2chat Markdown 输入与图文预览界面">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${origin}assets/desktop-preview.png">
${schema?'<script type="application/ld+json">'+JSON.stringify(schema).replaceAll('<','\\u003c')+'</script>':''}
<!-- seo:end -->`;}
function files(){
 const output={};
 for(const file of ['index.html','editor.html']){
  const original=fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
  const title=file==='index.html'?'md2chat — AI 回答 / Markdown 转聊天图文 | 免费开源桌面工具':'Markdown 图文转换器 — 微信、钉钉、飞书、企微、邮件 | md2chat';
  const description=file==='index.html'?'把 DeepSeek、Codex、Cursor 等 AI 工具中复制的 Markdown 转成聊天图文：文字可编辑，表格、代码、公式与 Mermaid 转图片。免费开源、本机处理，提供 macOS、Windows 和网页版。':'在线输入 Markdown 或图文，按目标复制；企微图文按顺序分段复制、粘贴，钉钉请下载桌面版。表格和代码转图片，邮件保留可编辑表格；不上传正文，实际粘贴以客户端为准。';
  const url=origin+(file==='index.html'?'':file);
  const schema=file==='index.html'?{'@context':'https://schema.org','@type':'SoftwareApplication',name:'md2chat',url:origin,description,applicationCategory:'ProductivityApplication',operatingSystem:'macOS, Windows',isAccessibleForFree:true,offers:{'@type':'Offer',price:'0',priceCurrency:'USD'},license:'https://github.com/forgeturl/md2chat/blob/main/LICENSE',downloadUrl:'https://github.com/forgeturl/md2chat/releases/latest',screenshot:origin+'assets/desktop-preview.png'}:null;
  let page=original.replace(/<title>.*?<\/title>/,`<title>${title}</title>`).replace(/<meta name="description" content="[^"]*">/,`<meta name="description" content="${description}">`);
  const meta=metadata(title,description,url,schema);
  page=page.includes('<!-- seo:start -->')?page.replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,()=>meta):page.replace('</head>',meta+'\n</head>');
  page=page.replace(/((?:src|href)=".\/assets\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g,'$1?v='+version+'"');
  output[file]=page;
 }
 for(const g of guides){
  const url=origin+'guides/'+g.slug+'.html',title=g.title+' | md2chat';
  const schema={'@context':'https://schema.org','@type':'TechArticle',headline:g.title,description:g.description,url,inLanguage:'zh-CN',author:{'@type':'Organization',name:'md2chat contributors',url:'https://github.com/forgeturl/md2chat'}};
  output['guides/'+g.slug+'.html']=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(g.description)}"><link rel="icon" href="../assets/favicon.png"><link rel="stylesheet" href="../assets/landing.css">${metadata(title,g.description,url,schema)}</head>
<body><div class="shell guide"><header class="nav"><a class="brand" href="../">md2chat</a><nav class="nav-links"><a href="../editor.html">试用转换器</a><a href="../#download">下载桌面版</a></nav></header><main><h1>${esc(g.title)}</h1><p class="lead">${esc(g.description)}</p>${g.sections.map(([h,p])=>`<section><h2>${esc(h)}</h2><p>${esc(p)}</p></section>`).join('\n')}${g.sources?.length?`<section><h2>官方资料</h2><ul>${g.sources.map(([label,url])=>`<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a></li>`).join('')}</ul></section>`:''}<section><h2>相关指南</h2><ul>${guides.filter(x=>x!==g).map(x=>`<li><a href="./${x.slug}.html">${esc(x.title)}</a></li>`).join('')}</ul></section><p><a class="button" href="../editor.html">用公开示例试一下</a></p></main><footer class="footer"><a href="https://github.com/forgeturl/md2chat/blob/main/docs/compatibility.md">兼容性与验证记录</a><a href="https://github.com/forgeturl/md2chat/issues">反馈问题</a></footer></div></body></html>\n`;
 }
 const routes=['','editor.html',...guides.map(g=>'guides/'+g.slug+'.html')];
 output['sitemap.xml']='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+routes.map(route=>`<url><loc>${origin+route}</loc></url>`).join('\n')+'\n</urlset>\n';
 output['llms.txt']='# md2chat\n\n> Free, open-source Markdown-to-chat converter. Turn Markdown copied from AI tools such as DeepSeek, Codex, Cursor, ChatGPT and Claude into chat-ready content. Keeps editable text and turns complex blocks into images. Local processing, macOS / Windows desktop app and web editor. AI tools are content source examples, not verified integrations.\n\n## Product and evidence\n\n- [Home]('+origin+'): Features and latest downloads.\n- [Editor]('+origin+'editor.html): Local conversion; browser clipboard limitations apply.\n- [Source and compatibility](https://github.com/forgeturl/md2chat): MIT license, tests, releases and evidence.\n'+guides.map(g=>'- ['+g.title+']('+origin+'guides/'+g.slug+'.html): '+g.description).join('\n')+'\n\n## Limits\n\nMac DingTalk native text/image/text paste has been tested on Apple Silicon. Windows DingTalk private clipboard is not implemented. WeChat uses standard HTML. WeCom image content uses sequential plain-text and PNG copies on web and desktop. The segment panel was tested end to end in Mac WeCom 5.0.12 drafts: five web segments with two images and three desktop segments with one image. Windows WeCom and sent messages have not been verified. Text remains editable; emphasis styling is not guaranteed. Mac Feishu native editor fragments were manually tested in the expanded rich-text input with two images, ordered editable text and emphasis styles, including a user-sent message. Feishu web and Windows, and email remain experimental without client acceptance. Clipboard generation is not proof of successful pasting or email delivery. No guarantee of compatibility with every client version. No user content is uploaded to md2chat; remote image URLs still contact their source.\n';
 return output;
}
function run(write){let failed=false;for(const [name,content] of Object.entries(files())){const file=path.join(root,name);if(write){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}else if(!fs.existsSync(file)||fs.readFileSync(file,'utf8').replaceAll('\r\n','\n')!==content){console.error('SEO output outdated: '+name);failed=true;}}if(failed)throw new Error('Run npm run seo:generate and review the public text.');}
if(require.main===module){run(process.argv.includes('--write'));console.log('SEO pages, canonical metadata, sitemap and llms.txt are consistent.');}
module.exports={files,run};
