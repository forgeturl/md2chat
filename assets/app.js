const message=document.getElementById('message');
const button=document.getElementById('copy-all');
const status=document.getElementById('status');
const input=document.getElementById('markdown-input');
const escapeHtml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const assets=new Map();let nextAsset=1;let selectedImageId=null;
function safeImageSource(src){return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(src)||/^https?:\/\//i.test(src)||/^blob:/i.test(src);}
function registerImage(src){
 if(!safeImageSource(src))throw new Error('粘贴的图片只有应用专有地址，网页无法读取。请从钉钉复制图片本身，再粘贴到原位置。');
 const id=String(nextAsset++);assets.set(id,{src});return '\n[[DING_IMAGE:'+id+']]\n';
}
function htmlToSource(markup){
 const template=document.createElement('template');template.innerHTML=markup;
 function walk(node){
  if(node.nodeType===3)return node.textContent.trim()?node.textContent:'';
  if(node.nodeType!==1&&node.nodeType!==11)return '';
  const tag=node.nodeName.toLowerCase();
  if(['script','style','meta','head','iframe','object','embed'].includes(tag))return '';
  if(tag==='img')return registerImage(node.getAttribute('src')||'');
  if(tag==='br')return '\n';
  if(tag==='table'){
   const rows=[...node.querySelectorAll('tr')].map(tr=>[...tr.children].filter(el=>['TD','TH'].includes(el.tagName)).map(cell=>cell.textContent.trim().replace(/\|/g,'\\|').replace(/\n/g,' ')));
   if(!rows.length)return '';
   return '\n'+rows.map((row,i)=>'| '+row.join(' | ')+' |'+(i===0?'\n| '+row.map(()=> '---').join(' | ')+' |':'')).join('\n')+'\n';
  }
  let result=[...node.childNodes].map(walk).join('');
  if(['p','div','li','h1','h2','h3','h4','h5','h6','blockquote','pre'].includes(tag)&&result&&!result.endsWith('\n'))result+='\n';
  return result;
 }
 return walk(template.content);
}
function sourceFragment(source){
 const fragment=document.createDocumentFragment();const regex=/\[\[DING_IMAGE:(\d+)\]\]/g;let last=0,match;
 while((match=regex.exec(source))){
  fragment.appendChild(document.createTextNode(source.slice(last,match.index)));
  const asset=assets.get(match[1]);if(!asset)throw new Error('图片引用已失效，请重新粘贴原图。');
  const img=document.createElement('img');img.dataset.assetId=match[1];img.alt='原文图片';img.contentEditable='false';
  img.style.cssText='display:inline-block;max-width:100%;max-height:280px;height:auto;vertical-align:middle;margin:8px 0';
  if(asset.src.startsWith('data:')||asset.src.startsWith('blob:'))img.src=asset.src;
  else{img.alt='原图正在读取…';ensureImage(asset).then(()=>{img.src=asset.src;}).catch(()=>{img.alt='原图读取受限：点击这里，然后粘贴图片本身';img.style.cssText+=';min-width:280px;min-height:44px;outline:2px dashed #d79425;cursor:pointer';});}
  fragment.appendChild(img);last=regex.lastIndex;
 }
 fragment.appendChild(document.createTextNode(source.slice(last)));return fragment;
}
function serializeInput(){
 function walk(node){
  if(node.nodeType===3)return node.textContent;
  if(node.nodeType!==1)return '';
  if(node.tagName==='IMG')return '\n[[DING_IMAGE:'+node.dataset.assetId+']]\n';
  if(node.tagName==='BR')return '\n';
  let result=[...node.childNodes].map(walk).join('');
  if(['DIV','P','LI'].includes(node.tagName)&&result&&!result.endsWith('\n'))result+='\n';
  return result;
 }
 return [...input.childNodes].map(walk).join('');
}
function blobToData(blob){if(blob.size>10*1024*1024)return Promise.reject(new Error('单张图片不能超过 10 MB'));return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取粘贴的图片'));reader.readAsDataURL(blob);});}
async function ensureImage(asset){
 if(!asset||!safeImageSource(asset.src))throw new Error('图片地址格式不受支持，请粘贴图片本身。');
 if(asset.ready)return asset;
 if(asset.failed)throw new Error(asset.failed);
 if(asset.pending)return asset.pending;
 if(asset.src.length>15*1024*1024)throw new Error('单张图片数据过大');
 asset.pending=(async()=>{
  try{
   if(!asset.src.startsWith('data:')){
    const response=await fetch(asset.src,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('图片服务返回 HTTP '+response.status);
    const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error('图片地址未返回图片数据');
    if(blob.size>10*1024*1024)throw new Error('单张图片不能超过 10 MB');
    asset.src=await blobToData(blob);
   }
   await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(image.naturalWidth*image.naturalHeight>20000000){reject(new Error('图片不能超过 2000 万像素'));return;}asset.width=image.naturalWidth;asset.height=image.naturalHeight;resolve();};image.onerror=()=>reject(new Error('图片数据无法解码'));image.src=asset.src;});
   asset.ready=true;return asset;
  }catch(error){
   const reason=error.message==='Failed to fetch'?'网页无法直接读取该图片地址（可能是跨域、登录权限或网络限制）':error.message;
   asset.failed='原图未能读取：'+reason+'。请从钉钉复制图片本身，再粘贴到输入框；只有一张缺图时会自动原位替换。';
   throw new Error(asset.failed);
  }finally{asset.pending=null;}
 })();
 return asset.pending;
}
input.addEventListener('click',event=>{
 const image=event.target.closest('img[data-asset-id]');
 if(image){selectedImageId=image.dataset.assetId;input.querySelectorAll('img').forEach(img=>img.style.outline='');image.style.outline='3px solid #1769df';status.textContent='已选中这张图片。从钉钉复制图片本身后，在此处粘贴即可原位替换。';}
 else selectedImageId=null;
});
async function replaceImage(id,src){
 const asset={src};assets.set(id,asset);
 const targets=[...input.querySelectorAll('img[data-asset-id]')].filter(img=>img.dataset.assetId===id);
 targets.forEach(img=>{img.src=src;img.alt='已补充的原图';img.style.outline='';});
 selectedImageId=null;cachedSource=null;cachedPayload=null;
 await updatePreview();
}
input.addEventListener('paste',async event=>{
 event.preventDefault();
 const data=event.clipboardData,markup=data.getData('text/html'),plain=data.getData('text/plain');
 const files=[...data.files].filter(file=>file.type.startsWith('image/'));
 const selection=getSelection();let range=selection.rangeCount?selection.getRangeAt(0).cloneRange():null;
 if(!range||!input.contains(range.commonAncestorContainer)){range=document.createRange();range.selectNodeContents(input);range.collapse(false);}
 try{
  const imageTemplate=document.createElement('template');imageTemplate.innerHTML=markup;
  const htmlImages=[...imageTemplate.content.querySelectorAll('img')];
  const onlyImageText=!plain.trim()||plain.trim()==='[图片]';
  const imageOnly=onlyImageText&&(files.length===1||(htmlImages.length===1&&!imageTemplate.content.textContent.trim()));
  if(imageOnly){
   const failedIds=[...input.querySelectorAll('img[data-asset-id]')].map(img=>img.dataset.assetId).filter(id=>assets.get(id)?.failed);
   const target=selectedImageId||(failedIds.length===1?failedIds[0]:null);
   if(target){
    const src=files.length?await blobToData(files[0]):htmlImages[0].getAttribute('src');
    if(!src||!safeImageSource(src))throw new Error('仍然没有得到可读取的图片数据，请在钉钉中对图片使用“复制”，而不是复制整条消息。');
    await replaceImage(target,src);return;
   }
  }
  let source=plain;
  if(markup){
   const template=document.createElement('template');template.innerHTML=markup;
   const imgs=[...template.content.querySelectorAll('img')];
   if(imgs.length){
    const placeholders=plain.match(/\[图片\]/g)||[];
    if(placeholders.length===imgs.length){let i=0;source=plain.replace(/\[图片\]/g,()=>registerImage(imgs[i++].getAttribute('src')||''));}
    else source=htmlToSource(markup);
   }else if(!plain&&template.content.querySelector('table'))source=htmlToSource(markup);
  }
  if(!/\[\[DING_IMAGE:\d+\]\]/.test(source)&&files.length){
   for(const file of files){const token=registerImage(await blobToData(file));if(source.includes('[图片]'))source=source.replace('[图片]',token);else source+='\n'+token;}
  }
  // Prefer real image files supplied alongside HTML over a remote image URL.
  const ids=[...source.matchAll(/\[\[DING_IMAGE:(\d+)\]\]/g)].map(match=>match[1]);
  if(files.length&&ids.length===files.length){
   for(let i=0;i<ids.length;i++){const asset=assets.get(ids[i]);if(asset&&!asset.src.startsWith('data:'))assets.set(ids[i],{src:await blobToData(files[i])});}
  }
  const fragment=sourceFragment(source);const tail=fragment.lastChild;
  range.deleteContents();range.insertNode(fragment);
  if(tail){range.setStartAfter(tail);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
  await updatePreview();
 }catch(error){status.textContent='粘贴未完成：'+error.message;button.disabled=true;}
});

function parseMarkdown(source){return ChatMarkdown.parse(source);}
function renderTable(header,rows){
 if(header.length>20)throw new Error('表格最多支持 20 列，请拆分后转换。');
 const count=header.length,scale=2,width=1100,pad=12,fontSize=count>6?14:18,lineHeight=fontSize+10;
 const widths=count===4?[70,200,340,490]:count===2?[300,800]:Array.from({length:count},(_,i)=>Math.floor(width/count)+(i<width%count?1:0));
 const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d');
 const font="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";
 ctx.font=fontSize+'px '+font;
 const wrap=(text,max)=>{
  const result=[];let line='';
  for(const char of text){if(char==='\n'){result.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>max){result.push(line);line=char;}else line+=char;}
  result.push(line);return result;
 };
 const layout=row=>{const cells=row.map((cell,i)=>wrap(cell,Math.max(12,widths[i]-pad*2)));return {cells,height:Math.max(...cells.map(c=>c.length))*lineHeight+pad*2};};
 const heading=layout(header);const body=rows.map(layout);const chunks=[];let chunk=[],height=heading.height;
 for(const row of body){
  if(row.height+heading.height>4000)throw new Error('单个表格单元格过长，请拆分成多行后重试。');
  if(chunk.length&&height+row.height>1800){chunks.push(chunk);chunk=[];height=heading.height;}
  chunk.push(row);height+=row.height;
 }
 if(chunk.length||!chunks.length)chunks.push(chunk);
 return chunks.map(chunk=>{
  const h=heading.height+chunk.reduce((sum,row)=>sum+row.height,0);
  canvas.width=(width+2)*scale;canvas.height=(h+2)*scale;ctx.scale(scale,scale);ctx.textBaseline='top';ctx.font=fontSize+'px '+font;
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width+2,h+2);let y=1;
  [heading,...chunk].forEach((row,index)=>{
   let x=1;row.cells.forEach((lines,i)=>{
    ctx.fillStyle=index===0?'#e9f0fb':index%2===0?'#f7f9fc':'#ffffff';ctx.fillRect(x,y,widths[i],row.height);
    ctx.strokeStyle='#c9d4e2';ctx.lineWidth=1;ctx.strokeRect(x,y,widths[i],row.height);
    ctx.fillStyle='#253247';lines.forEach((line,j)=>ctx.fillText(line,x+pad,y+pad+j*lineHeight));x+=widths[i];
   });y+=row.height;
  });
  return {src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
 });
}

async function buildPayload(source){
 if(source.length>2*1024*1024)throw new Error('文字过长，请分段转换（最多 2 MB 字符）。');
 const blocks=ChatMarkdown.compactImages(parseMarkdown(source)),parts=[],plain=[],preview=[];let tableCount=0,imageCount=0,tableImages=0,originalImages=0;
 const lineBreak='<br>';
 const appendImage=image=>{
  imageCount++;
  parts.push('<img src="'+escapeHtml(image.src)+'" width="'+image.width+'" height="'+image.height+'">');
  preview.push('<img src="'+escapeHtml(image.src)+'" alt="图文中的图片 '+imageCount+'" style="display:block;max-width:100%;width:auto;height:auto;margin:0">');
 };
 for(const block of blocks){
  if(block.type==='text'){
   if(/^\s*\[图片\]\s*$/m.test(block.text))throw new Error('输入中只有 [图片] 占位符，没有对应图片数据。请从钉钉重新复制完整图文，或删除占位符后在原位置粘贴图片。');
   const textHtml=ChatMarkdown.runsHtml(block.runs);
   parts.push(textHtml);plain.push(block.text);preview.push('<div style="white-space:pre-wrap;margin:0">'+textHtml+'</div>');
  }else if(block.type==='table'){
   tableCount++;
   for(const image of renderTable(block.header,block.rows)){tableImages++;appendImage(image);}
   plain.push([block.header,...block.rows].map(row=>row.join(' | ')).join('\n'));
  }else{
   const asset=block.id?assets.get(block.id):{src:block.src};
   if(!asset)throw new Error('原文图片引用已失效，请重新粘贴完整图文。');
   const image=await ensureImage(asset);originalImages++;appendImage(image);plain.push('[图片]');
  }
 }
 return {html:"<meta charset='utf-8'>\n<article class=\"4ever-article\">\n"+parts.join(lineBreak)+'</article>',plain:plain.join('\n'),preview:preview.join(''),tableCount,imageCount,tableImages,originalImages};
}
let cachedSource=null,cachedPayload=null,previewTimer,renderVersion=0;
async function updatePreview(){
 const source=serializeInput();const version=++renderVersion;
 button.disabled=true;
 if(source===cachedSource&&cachedPayload){button.disabled=false;return cachedPayload;}
 cachedPayload=null;
 if(!source.trim()){message.innerHTML='<p style="color:#718096">粘贴图文或 Markdown 后，这里会显示完整预览。</p>';cachedSource=null;document.getElementById('conversion-info').textContent='';return null;}
 try{
  const payload=await buildPayload(source);
  if(version!==renderVersion)return null;
  message.innerHTML=payload.preview;cachedSource=source;cachedPayload=payload;button.disabled=false;
  document.getElementById('conversion-info').textContent='原文图片 '+payload.originalImages+' 张 + 表格图片 '+payload.tableImages+' 张 = 共 '+payload.imageCount+' 张图片。';
  status.textContent='图文已准备好，可以复制。';return payload;
 }catch(error){if(version===renderVersion){message.textContent=error.message;status.textContent=error.message;document.getElementById('conversion-info').textContent='转换未完成，请根据上方提示调整内容后重试。';}return null;}
}
input.addEventListener('input',()=>{button.disabled=true;cachedPayload=null;clearTimeout(previewTimer);status.textContent='正在准备文字和图片…';previewTimer=setTimeout(updatePreview,350);});
function nativeCopy(payload){
 const sink=document.createElement('div');sink.contentEditable='true';sink.setAttribute('aria-hidden','true');sink.style.cssText='position:fixed;left:-100000px;top:0;width:1100px;background:white;';
 sink.innerHTML=payload.html;document.body.appendChild(sink);
 const active=document.activeElement;const selection=getSelection();const previous=[];for(let i=0;i<selection.rangeCount;i++)previous.push(selection.getRangeAt(i).cloneRange());
 const onCopy=event=>{event.clipboardData.setData('text/html',payload.html);event.clipboardData.setData('text/plain',payload.plain);event.preventDefault();};
 sink.addEventListener('copy',onCopy);
 try{sink.focus();const range=document.createRange();range.selectNodeContents(sink);selection.removeAllRanges();selection.addRange(range);return document.execCommand('copy');}
 finally{sink.remove();selection.removeAllRanges();for(const range of previous){try{selection.addRange(range);}catch(_){}}if(active&&active.focus)active.focus();}
}
button.addEventListener('click',async()=>{
 clearTimeout(previewTimer);
 if(!cachedPayload||cachedSource!==serializeInput()){await updatePreview();status.textContent='预览已更新，请再点一次复制。';return;}
 button.disabled=true;
 try{
  if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined'){
   await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([cachedPayload.html],{type:'text/html'}),'text/plain':new Blob([cachedPayload.plain],{type:'text/plain'})})]);
  }else if(!nativeCopy(cachedPayload))throw new Error('浏览器不支持自动复制，请选中预览后手动复制');
  status.textContent='已复制标准图文，含 '+cachedPayload.imageCount+' 张图片。请在目标聊天框确认图片是否保留。';
 }catch(error){status.textContent='复制未完成：'+error.message+'。请允许剪贴板访问，或选中下方预览手动复制。';}
 finally{button.disabled=false;}
});

updatePreview();

// Reports intentionally contain metadata only, never text, source HTML, or URLs.
const diagnosticStatus=document.getElementById('diagnostic-status');
const sampleHistory=[];
function sourceKind(src){
 if(/^data:/i.test(src))return '内嵌图片';
 if(/^https?:/i.test(src))return '远程图片地址';
 if(/^file:/i.test(src))return '本地文件引用';
 if(/^blob:/i.test(src))return '临时 blob 引用';
 return '其他引用';
}
async function showSample(origin,entries,declaredTypes=[]){
 const lines=['md2chat 浏览器剪贴板报告','入口：'+origin,'可见格式：'+[...new Set([...declaredTypes,...entries.map(e=>e.type)])].join(', ')];
 let images=0,files=0;
 for(const entry of entries){
  if(entry.error){lines.push(entry.type+'：读取失败（'+entry.error+'）');continue;}
  lines.push(entry.type+'：'+entry.blob.size+' 字节');
  if(entry.type==='text/html'){
   const template=document.createElement('template');template.innerHTML=await entry.blob.text();
   const list=[...template.content.querySelectorAll('img')];images+=list.length;
   lines.push('HTML 图片标签：'+list.length+'；表格标签：'+template.content.querySelectorAll('table').length);
   list.forEach((img,i)=>lines.push('图片 '+(i+1)+'：'+sourceKind(img.getAttribute('src')||'')));
  }else if(entry.type.startsWith('image/'))files++;
 }
 lines.push('HTML 图片 '+images+' 个；独立图片数据 '+files+' 份。');
 if(images&&!files)lines.push('图片只在 HTML 中引用；本报告不代表图片已能读取或粘贴。');
 if(!images&&!files)lines.push('浏览器没有收到图片；不代表原生应用的专有剪贴板中没有图片。');
 lines.push('安全上下文：'+window.isSecureContext+'；Clipboard.read：'+!!navigator.clipboard?.read);
 lines.push('报告不包含正文、HTML 源码或图片地址；未读取原生私有格式。');
 sampleHistory.push(lines.join('\n'));if(sampleHistory.length>2)sampleHistory.shift();
 document.getElementById('diagnostic-report').textContent=lines.join('\n');
 document.getElementById('copy-report').disabled=false;
 diagnosticStatus.textContent='排查完成。最近两份元数据报告仅保留在页面内存中。';
}
document.getElementById('read-clipboard').addEventListener('click',async()=>{
 const readButton=document.getElementById('read-clipboard');readButton.disabled=true;
 diagnosticStatus.textContent='正在读取浏览器可见的剪贴板格式…';
 try{
  if(!navigator.clipboard?.read)throw new Error('Clipboard.read unavailable');
  let timer;
  const items=await Promise.race([navigator.clipboard.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('读取超时，请手动粘贴')),10000);})]).finally(()=>clearTimeout(timer)),entries=[];
  for(const item of items)for(const type of item.types){try{entries.push({type,blob:await item.getType(type)});}catch(error){entries.push({type,error:error.name});}}
  await showSample('读取按钮',entries);
 }catch(error){diagnosticStatus.textContent='无法直接读取（'+error.name+'），请在排查框按 ⌘V / Ctrl+V 粘贴。';}
 finally{readButton.disabled=false;}
});
document.getElementById('clipboard-paste').addEventListener('paste',async event=>{
 event.preventDefault();const data=event.clipboardData,types=[...data.types],entries=[];
 for(const type of types){if(type==='Files')continue;const value=data.getData(type);if(value)entries.push({type,blob:new Blob([value],{type})});}
 for(const file of data.files)entries.push({type:file.type||'application/octet-stream',blob:file});
 event.currentTarget.textContent='已接收样本，仅显示格式统计。';await showSample('原生粘贴事件',entries,types);
});
document.getElementById('copy-report').addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(sampleHistory.join('\n\n────────\n\n'));diagnosticStatus.textContent='元数据报告已复制，当前剪贴板已被报告替换。';}
 catch(_){diagnosticStatus.textContent='自动复制失败，请手动选中上面的报告复制。';}
});
