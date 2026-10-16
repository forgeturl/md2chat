const crypto=require('node:crypto');
const {summarizeHtml}=require('../assets/clipboard-diagnostics.js');
const MAX_HTML_BYTES=8*1024*1024,MAX_FORMATS=100;
const TEXT_HTML='<article><p><strong>md2chat HTML 文字测试</strong></p></article>';

// Only inspect format names and the single HTML representation. In particular,
// do not resolve image references or reconstruct the source HTML.
async function htmlSnapshot(clipboard){
 let items;
 try{items=await clipboard.read();}catch{throw new Error('无法读取当前剪贴板，请重新复制钉钉图文后再试。');}
 if(!Array.isArray(items)||items.length>MAX_FORMATS)throw new Error('剪贴板格式过多，请仅复制一份 HTML 后再试。');
 const formats=[],htmlItems=[];let count=0;
 try{
  for(const item of items){
   const types=Array.from(item.types);
   count+=types.length;
   if(count>MAX_FORMATS||types.some(type=>typeof type!=='string'||type.length>4096))throw new Error();
   formats.push(types.slice().sort());
   for(const type of types)if(type==='text/html')htmlItems.push(item);
  }
 }catch{throw new Error('无法读取剪贴板格式，请仅复制一份 HTML 后再试。');}
 if(htmlItems.length!==1)throw new Error('当前剪贴板需要恰好一份 HTML，请先从钉钉复制一条图文。');
 let blob;
 try{blob=await htmlItems[0].getType('text/html');}catch{throw new Error('无法读取剪贴板 HTML，请重新复制钉钉图文后再试。');}
 if(!Number.isSafeInteger(blob?.size)||blob.size<0)throw new Error('无法读取剪贴板 HTML 大小，请重新复制后再试。');
 if(blob.size>MAX_HTML_BYTES)throw new Error('HTML 超过 8 MiB，请复制更短的图文后再试。');
 let html;
 try{html=await blob.text();}catch{throw new Error('无法读取剪贴板 HTML，请重新复制钉钉图文后再试。');}
 if(typeof html!=='string')throw new Error('无法读取剪贴板 HTML，请重新复制钉钉图文后再试。');
 const bytes=Buffer.byteLength(html);
 if(bytes>MAX_HTML_BYTES)throw new Error('HTML 超过 8 MiB，请复制更短的图文后再试。');
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(formats)).update('\0').update(html).digest('hex');
 return {html,bytes,fingerprint};
}

// Caller owns the trusted-frame check and copy/conversion lock. Both modes are
// explicit experiments: they overwrite the clipboard and never send a message.
async function runDingtalkHtmlTest(mode,{clipboard,ClipboardItem,platform=process.platform}={}){
 if(platform!=='win32')throw new Error('此项 HTML 测试仅适用于 Windows 桌面版。');
 if(mode!=='text'&&mode!=='rewrite')throw new Error('不支持的 HTML 测试模式。');
 const original=mode==='rewrite'?await htmlSnapshot(clipboard):null;
 const html=original?original.html:TEXT_HTML,bytes=original?original.bytes:Buffer.byteLength(html);
 const summary=summarizeHtml(html);
 if(original){
  let current;
  try{current=await htmlSnapshot(clipboard);}catch{throw new Error('剪贴板已更新或无法核对，已保留当前内容，请重新复制后再试。');}
  if(current.fingerprint!==original.fingerprint)throw new Error('剪贴板已更新，已保留新内容，请重新复制后再试。');
 }
 try{await clipboard.write([new ClipboardItem({'text/html':html})]);}
 catch{throw new Error('无法写入 HTML 测试，请重试。');}
 return {mode,bytes,htmlImages:summary.imageCount,htmlTables:summary.tableCount,truncated:summary.truncated};
}

module.exports={runDingtalkHtmlTest};
