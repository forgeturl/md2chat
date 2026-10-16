const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const targets = require('../assets/chat-targets.js');
const {makeFragment}=require('./feishu.cjs');
const FORMAT = 'com.dingtalk.richTextAttributedString';
const RAW_FORMAT = `electron application/osclipboard;format="${FORMAT}"`;
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const style = run => ({bold:run.bold===true,italic:run.italic===true,strikethrough:run.strikethrough===true,underLine:false,indent:0,lightColor:'#222222',darkColor:'#eeeeee'});
function httpsImageSource(value) {
 if(typeof value!=='string'||value.length>8192||!/^https:\/\//i.test(value))return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
function validateParts(parts, target='dingtalk') {
 targets.profile(target);
 if (!Array.isArray(parts) || !parts.length || parts.length > 500) throw new Error('内容为空或段落过多');
 let total=0;
 for (const p of parts) {
  if(p?.type==='table'&&target==='email'){
   if(!Array.isArray(p.rows)||!p.rows.length||p.rows.length>2000||p.rows.some(r=>!Array.isArray(r)||!r.length||r.length>100||r.some(c=>typeof c!=='string'||c.length>10000)))throw new Error('表格格式错误或过大');
   total+=Buffer.byteLength(JSON.stringify(p.rows));continue;
  }
  if (!p || !['text','image'].includes(p.type)) throw new Error('不支持的内容类型');
  const value=p.type==='text'?p.text:p.src;
  if (typeof value!=='string') throw new Error('内容格式错误');
  total+=Buffer.byteLength(value);
  if (p.type==='image' && (!/^data:image\/(png|jpe?g|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/i.test(value) || value.length>15*1024*1024)) throw new Error('图片必须是完整的内嵌图片，且小于 10 MB');
  if (p.type==='text' && value.length>2*1024*1024) throw new Error('文字过长');
 }
 if(total>60*1024*1024)throw new Error('图文过大，请减少图片后重试');
}
async function makePayload(parts, {directory, nativeImage, target='dingtalk', platform=process.platform}) {
 validateParts(parts,target);
 const windowsDingtalk=target==='dingtalk'&&platform==='win32';
 const macFeishu=target==='feishu'&&platform==='darwin';
 const items=[],html=[],plain=[],normalized=[],feishuParts=[];let imageCount=0;
 const newline=()=>items.push({type:'newLine',data:{}});
 for(const [index,p] of parts.entries()) {
  if(index){newline();if(!windowsDingtalk)html.push('<br>');plain.push('\n');}
  if(p.type==='table'){normalized.push(p);continue;}
  if(p.type==='text') {
   normalized.push(p);
   if(macFeishu)feishuParts.push(p);
   const runs=Array.isArray(p.runs)&&p.runs.length<10000&&p.runs.every(r=>r&&typeof r.text==='string')&&p.runs.map(r=>r.text).join('')===p.text?p.runs:[{text:p.text}];
   let paragraph=[];
   const finishParagraph=()=>{html.push('<p>'+(paragraph.length?paragraph.join(''):'<br>')+'</p>');paragraph=[];};
   for(const run of runs)for(const [i,line] of run.text.split('\n').entries()) {
    if(i){newline();if(windowsDingtalk)finishParagraph();else html.push('<br>');}
    if(!line)continue;
    items.push({type:'text',data:{text:line},style:style(run)});
    let text=esc(line);if(run.bold)text='<strong>'+text+'</strong>';if(run.italic)text='<em>'+text+'</em>';if(run.strikethrough)text='<s>'+text+'</s>';
    (windowsDingtalk?paragraph:html).push('<span data-type="text"><span data-type="leaf">'+text+'</span></span>');
   }
   if(windowsDingtalk)finishParagraph();
   plain.push(p.text);
  } else {
   const img=nativeImage.createFromDataURL(p.src);
   if(img.isEmpty())throw new Error('图片解码失败');
   const {width,height}=img.getSize();
   if(width*height>20000000)throw new Error('图片不能超过 2000 万像素');
   const bytes=img.toPNG();if(bytes.length>15*1024*1024)throw new Error('转换后的图片过大');
   const filename=crypto.createHash('sha256').update(bytes).digest('hex')+'.png';
   const file=path.join(directory,filename);
   if(target==='dingtalk'||macFeishu){await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.writeFile(file,bytes,{mode:0o600});}
   const requestedWidth=Number.isFinite(p.displayWidth)&&p.displayWidth>0?p.displayWidth:width;
   const displayWidth=Math.min(width,1100,Math.max(1,requestedWidth)),displayHeight=Math.round(height*displayWidth/width);
   normalized.push({type:'image',src:'data:image/png;base64,'+bytes.toString('base64'),width:displayWidth,height:displayHeight});
   if(macFeishu)feishuParts.push({type:'image',path:file,width:displayWidth,height:displayHeight});
   items.push({type:'image',data:{authMediaId:'',filename,path:file,text:'',url:''},style:{width:displayWidth,height:displayHeight,indent:0,mode:0}});
   const imageSource=windowsDingtalk?(httpsImageSource(p.sourceUrl)||pathToFileURL(file).href):'data:image/png;base64,'+bytes.toString('base64');
   const imageHtml=`<img src="${esc(imageSource)}" width="${displayWidth}" height="${displayHeight}">`;
   html.push(windowsDingtalk?'<p>'+imageHtml+'</p>':imageHtml);
   plain.push('[图片]');imageCount++;
  }
 }
 if(target!=='dingtalk'){
  const payload=targets.render(normalized,target);
  if(macFeishu)payload.feishuFragment=makeFragment(feishuParts);
  return payload;
 }
 return {rich:{contents:[{type:'markdown',text:{fallbackText:'',items,minSupportVersion:'1.2',version:'2.0'}}]},html:'<meta charset="utf-8"><article class="4ever-article">'+html.join('')+'</article>',plain:plain.join(''),imageCount};
}
async function pruneImages(directory, protectedFiles=new Set()) {
 for(const name of await fs.readdir(directory).catch(()=>[])) {
  if(!/^[a-f0-9]{64}\.png$/.test(name))continue;
  const file=path.join(directory,name),stat=await fs.lstat(file);
  if(stat.isFile()&&!protectedFiles.has(file)&&Date.now()-stat.mtimeMs>7*86400000)await fs.unlink(file);
 }
}
module.exports={FORMAT,RAW_FORMAT,validateParts,makePayload,pruneImages};
