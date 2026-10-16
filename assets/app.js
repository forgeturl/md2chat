const message=document.getElementById('message');
const copyButtons=[...document.querySelectorAll('[data-copy-target]')];
const wecomSegments=WecomSegments.create({copySegment:(segment,target='wecom')=>{
 const result=window.md2chatDesktop?window.md2chatDesktop.copyChatSegment(segment):ChatClipboard.writeSegment(segment);
 return Promise.resolve(result).then(value=>{lastCopyTarget=target;return value;});
}});
let copying=false,lastCopyTarget=null;
const dingtalkSegmentsButton=document.getElementById('dingtalk-segments');
dingtalkSegmentsButton.hidden=window.md2chatDesktop?.platform!=='win32';
const desktopRequired=b=>b.dataset.copyTarget==='dingtalk'&&!window.md2chatDesktop;
const button={set disabled(value){for(const b of copyButtons)b.disabled=value||copying||desktopRequired(b);dingtalkSegmentsButton.disabled=value||copying;}};
const status=document.getElementById('status');
const copyNotice=document.getElementById('copy-notice');
let copyNoticeTimer;
function showCopyNotice(text,error=false){
 clearTimeout(copyNoticeTimer);
 copyNotice.textContent=text;
 copyNotice.classList.toggle('copy-notice-error',error);
 copyNotice.classList.toggle('is-visible',!!text);
 if(text)copyNoticeTimer=setTimeout(()=>{copyNotice.classList.remove('is-visible');copyNotice.textContent='';},5000);
}
const input=document.getElementById('markdown-input');
const escapeHtml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const assets=new Map();let nextAsset=1;let selectedImageId=null;let inputEpoch=0;
function safeImageSource(src){return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(src)||/^https?:\/\//i.test(src)||/^blob:/i.test(src);}
function registerImage(src){
 if(!safeImageSource(src))throw new Error('粘贴的图片只有应用专有地址，网页无法读取。请从钉钉复制图片本身，再粘贴到原位置。');
 const id=String(nextAsset++);assets.set(id,{src});return '\n[[DING_IMAGE:'+id+']]\n';
}
function htmlToSource(markup,imageRegistrar=registerImage){
 const template=document.createElement('template');template.innerHTML=markup;
 function walk(node){
  if(node.nodeType===3)return node.textContent.trim()?node.textContent:'';
  if(node.nodeType!==1&&node.nodeType!==11)return '';
  const tag=node.nodeName.toLowerCase();
  if(['script','style','meta','head','iframe','object','embed'].includes(tag))return '';
  if(tag==='img')return imageRegistrar(node.getAttribute('src')||'');
  if(tag==='br')return '\n';
  if(tag==='table'){
   if(node.querySelector('img'))throw new Error('暂不支持表格单元格中的图片，请将图片移到表格外后重试。');
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
 // Preserve an existing source before decoding; generated images stay local.
 if(!asset.sourceUrl&&asset.src.length<=8192&&/^https:\/\//i.test(asset.src))asset.sourceUrl=asset.src;
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
async function readableClipboardHtml(markup){
 if(window.md2chatDesktop?.platform==='win32'&&/file:/i.test(markup))return window.md2chatDesktop.resolveClipboardHtml(markup);
 return markup;
}
input.addEventListener('paste',async event=>{
 event.preventDefault();
 const epoch=inputEpoch;
 const data=event.clipboardData,plain=data.getData('text/plain');let markup=data.getData('text/html');
 const files=[...data.files].filter(file=>file.type.startsWith('image/'));
 const selection=getSelection();let range=selection.rangeCount?selection.getRangeAt(0).cloneRange():null;
 if(!range||!input.contains(range.commonAncestorContainer)){range=document.createRange();range.selectNodeContents(input);range.collapse(false);}
 try{
  markup=await readableClipboardHtml(markup);if(epoch!==inputEpoch)return;
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
    if(epoch!==inputEpoch)return;
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
   for(const file of files){const src=await blobToData(file);if(epoch!==inputEpoch)return;const token=registerImage(src);if(source.includes('[图片]'))source=source.replace('[图片]',token);else source+='\n'+token;}
  }
  // Prefer real image files supplied alongside HTML over a remote image URL.
  const ids=[...source.matchAll(/\[\[DING_IMAGE:(\d+)\]\]/g)].map(match=>match[1]);
  if(files.length&&ids.length===files.length){
   for(let i=0;i<ids.length;i++){const asset=assets.get(ids[i]);if(asset&&!asset.src.startsWith('data:')){const src=await blobToData(files[i]);if(epoch!==inputEpoch)return;assets.set(ids[i],{src});}}
  }
  if(epoch!==inputEpoch)return;
  const fragment=sourceFragment(source);const tail=fragment.lastChild;
  range.deleteContents();range.insertNode(fragment);
  if(tail){range.setStartAfter(tail);range.collapse(true);selection.removeAllRanges();selection.addRange(range);}
  await updatePreview();
 }catch(error){if(epoch!==inputEpoch)return;status.textContent='粘贴未完成：'+error.message;button.disabled=true;}
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

async function buildPayload(source,imageAssets=assets){
 if(source.length>2*1024*1024)throw new Error('文字过长，请分段转换（最多 2 MB 字符）。');
 const blocks=ChatMarkdown.compactImages(parseMarkdown(source)),parts=[],plain=[],preview=[],segments=[],emailTables=new Map(),emailSkip=new Set();let tableCount=0,imageCount=0,tableImages=0,originalImages=0,mathImages=0,mermaidImages=0,codeImages=0,codeCount=0;
 const appendText=(text,run={})=>{if(segments.at(-1)?.type==='text'){segments.at(-1).text+=text;segments.at(-1).runs.push({...run,text});}else segments.push({type:'text',text,runs:[{...run,text}]});};
 const lineBreak='<br>';
 const appendImage=(image,sourceUrl)=>{
  imageCount++;
  segments.push({type:'image',src:image.src,displayWidth:image.displayWidth||image.width,...(sourceUrl?{sourceUrl}:{})});
  parts.push('<img src="'+escapeHtml(image.src)+'" width="'+(image.displayWidth||image.width)+'" height="'+(image.displayHeight||image.height)+'">');
  preview.push('<img src="'+escapeHtml(image.src)+'" alt="图文中的图片 '+imageCount+'" style="display:block;max-width:100%;width:'+(image.displayWidth?image.displayWidth+'px':'auto')+';height:auto;margin:0">');
 };
 for(const block of blocks){
  if(block.type==='text'){
   if(/^\s*\[图片\]\s*$/m.test(block.text))throw new Error('输入中只有 [图片] 占位符，没有对应图片数据。请从钉钉重新复制完整图文，或删除占位符后在原位置粘贴图片。');
   const rendered=[];
   for(const run of block.runs){
    if(!run.math){rendered.push(ChatMarkdown.runsHtml([run]));appendText(run.text,run);continue;}
    try{
     const image=await ChatRenderers.math(run.math,false);mathImages++;imageCount++;
     segments.push({type:'image',src:image.src,displayWidth:image.displayWidth||image.width});
     rendered.push('<img src="'+image.src+'" width="'+image.displayWidth+'" height="'+image.displayHeight+'" alt="'+escapeHtml(run.text)+'" style="display:inline-block;vertical-align:middle;max-width:100%;height:auto">');
    }catch(error){throw new Error('第 '+(mathImages+1)+' 个公式：'+error.message);}
   }
   const textHtml=rendered.join('');
   appendText('\n');
   parts.push(textHtml);plain.push(block.text);preview.push('<div style="white-space:pre-wrap;margin:0">'+textHtml+'</div>');
  }else if(block.type==='code'){
   codeCount++;
   try{for(const image of await ChatRenderers.code(block.text,block.language)){codeImages++;appendImage(image);}}
   catch(error){throw new Error('第 '+codeCount+' 个代码块：'+error.message);}
   const fence='`'.repeat(Math.max(3,...[...block.text.matchAll(/`+/g)].map(m=>m[0].length+1)));
   plain.push(fence+block.language+'\n'+block.text+'\n'+fence);
  }else if(block.type==='math'||block.type==='mermaid'){
   try{
    const image=block.type==='math'?await ChatRenderers.math(block.tex):await ChatRenderers.mermaid(block.text);
    if(block.type==='math')mathImages++;else mermaidImages++;
    appendImage(image);plain.push(block.type==='math'?'$$\n'+block.tex+'\n$$':'```mermaid\n'+block.text+'\n```');
   }catch(error){throw new Error((block.type==='math'?'第 '+(mathImages+1)+' 个公式':'第 '+(mermaidImages+1)+' 个 Mermaid 图')+'：'+error.message);}
  }else if(block.type==='table'){
   tableCount++;
   const start=segments.length;
   for(const image of renderTable(block.header,block.rows)){tableImages++;appendImage(image);}
   emailTables.set(start,{type:'table',rows:[block.header,...block.rows]});
   for(let i=start+1;i<segments.length;i++)emailSkip.add(i);
   plain.push([block.header,...block.rows].map(row=>row.join(' | ')).join('\n'));
  }else{
   const asset=block.id?imageAssets.get(block.id):{src:block.src};
   if(!asset)throw new Error('原文图片引用已失效，请重新粘贴完整图文。');
   const image=await ensureImage(asset);originalImages++;appendImage(image,image.sourceUrl);plain.push('[图片]');
  }
 }
 const cleanSegment=s=>{if(s.type!=='text')return s;const runs=s.runs.map(r=>({...r}));while(runs.length&&!runs[0].text.replace(/^\n+/,''))runs.shift();while(runs.length&&!runs.at(-1).text.replace(/\n+$/,''))runs.pop();if(runs.length){runs[0].text=runs[0].text.replace(/^\n+/,'');runs.at(-1).text=runs.at(-1).text.replace(/\n+$/,'');}return {...s,text:runs.map(r=>r.text).join(''),runs};};
 const clean=list=>list.map(cleanSegment).filter(s=>s.type!=='text'||s.text.trim());
 return {html:"<meta charset='utf-8'>\n<article class=\"4ever-article\">\n"+parts.join(lineBreak)+'</article>',plain:plain.join('\n'),preview:preview.join(''),emailSegments:clean(segments.flatMap((s,i)=>emailSkip.has(i)?[]:[emailTables.get(i)||s])),segments:clean(segments),tableCount,imageCount,tableImages,originalImages,mathImages,mermaidImages,codeImages};
}
let cachedSource=null,cachedPayload=null,previewTimer,renderVersion=0;
if(window.md2chatDesktop){
 document.getElementById('back-home').hidden=true;
 document.getElementById('dingtalk-desktop-hint').hidden=true;
 const dingtalkWrapper=document.getElementById('dingtalk-copy-wrapper');
 dingtalkWrapper.classList.remove('desktop-only-copy');
 for(const name of ['tabindex','aria-label','aria-describedby'])dingtalkWrapper.removeAttribute(name);
 document.querySelector('.privacy-note').textContent='桌面版 · 无需登录 · 内容在本机处理 · 钉钉复制所需图片临时保存在本机';
 document.getElementById('copy-help').textContent='点击平台图标复制，再到对应聊天框粘贴。Mac 钉钉使用原生图文；Windows 钉钉一次图文粘贴尚未解决，可用“钉钉分段复制（备用）”分别复制文字和图片。企微图文请逐段复制粘贴。飞书、邮件为实验性适配。关闭窗口后可从菜单栏／托盘重新打开。';
 document.getElementById('diagnostic-help').textContent='点击后读取系统剪贴板格式、图片引用类型和脱敏结构。请分别读取 md2chat 与钉钉复制的内容，再复制报告；截图或复制其他内容会替换当前剪贴板。报告不含正文、图片内容、链接或文件路径。';
}
function conversionSummary(payload){return '原文图片 '+payload.originalImages+' 张 + 表格图片 '+payload.tableImages+' 张 + 公式 '+payload.mathImages+' 张 + 图表 '+payload.mermaidImages+' 张 + 代码 '+payload.codeImages+' 张 = 共 '+payload.imageCount+' 张图片。';}
function updateCopyControls(){for(const b of copyButtons){b.setAttribute('aria-pressed','false');b.title=desktopRequired(b)?'':'复制到'+ChatTargets.profile(b.dataset.copyTarget).label+'：'+ChatTargets.profile(b.dataset.copyTarget).note;if(desktopRequired(b)){b.disabled=true;b.setAttribute('aria-describedby','dingtalk-desktop-hint');}else b.removeAttribute('aria-describedby');}}
updateCopyControls();
async function updatePreview(){
 const source=serializeInput();const version=++renderVersion;
 button.disabled=true;
 if(source===cachedSource&&cachedPayload){button.disabled=false;return cachedPayload;}
 cachedPayload=null;
 if(!source.trim()){message.innerHTML='<p style="color:#718096">粘贴图文或 Markdown 后，这里会显示完整预览。</p>';cachedSource=null;document.getElementById('conversion-info').textContent='';return null;}
 try{
  const payload=await buildPayload(source);
  if(version!==renderVersion)return null;
  message.innerHTML=payload.preview;cachedSource=source;cachedPayload=payload;button.disabled=false;updateCopyControls(true);
  document.getElementById('conversion-info').textContent=conversionSummary(payload);
  status.textContent='图文已准备好，点击目标平台图标复制。';return payload;
 }catch(error){if(version===renderVersion){message.textContent=error.message;status.textContent=error.message;document.getElementById('conversion-info').textContent='转换未完成，请根据提示调整内容后重试。';}return null;}
}
document.getElementById('clear-input').addEventListener('click',()=>{
 inputEpoch++;clearTimeout(previewTimer);input.replaceChildren();assets.clear();selectedImageId=null;cachedSource=null;cachedPayload=null;
 updateCopyControls(true);updatePreview();status.textContent='已清空，请粘贴新内容。';input.focus();
});
input.addEventListener('input',()=>{button.disabled=true;cachedPayload=null;clearTimeout(previewTimer);status.textContent='正在准备文字、图片、公式和图表…';previewTimer=setTimeout(updatePreview,350);});
function nativeCopy(payload){
 const sink=document.createElement('div');sink.contentEditable='true';sink.setAttribute('aria-hidden','true');sink.style.cssText='position:fixed;left:-100000px;top:0;width:1100px;background:white;';
 sink.innerHTML=payload.html;document.body.appendChild(sink);
 const active=document.activeElement;const selection=getSelection();const previous=[];for(let i=0;i<selection.rangeCount;i++)previous.push(selection.getRangeAt(i).cloneRange());
 const onCopy=event=>{event.clipboardData.setData('text/html',payload.html);event.clipboardData.setData('text/plain',payload.plain);event.preventDefault();};
 sink.addEventListener('copy',onCopy);
 try{sink.focus();const range=document.createRange();range.selectNodeContents(sink);selection.removeAllRanges();selection.addRange(range);return document.execCommand('copy');}
 finally{sink.remove();selection.removeAllRanges();for(const range of previous){try{selection.addRange(range);}catch(_){}}if(active&&active.focus)active.focus();}
}
dingtalkSegmentsButton.addEventListener('click',async()=>{
 if(copying||window.md2chatDesktop?.platform!=='win32')return;
 clearTimeout(previewTimer);
 if(!cachedPayload||cachedSource!==serializeInput()){await updatePreview();status.textContent='预览已更新，请再次点击分段复制。';return;}
 try{wecomSegments.open(cachedPayload.segments,'dingtalk');status.textContent='已打开钉钉分段复制：请逐段复制并到钉钉草稿粘贴，确认文字和图片；Windows 结果仍需实测。';}
 catch(error){showCopyNotice(error.message,true);}
});
for(const copyButton of copyButtons)copyButton.addEventListener('click',async()=>{
 if(copying||desktopRequired(copyButton))return;
 clearTimeout(previewTimer);
 const target=copyButton.dataset.copyTarget,profile=ChatTargets.profile(target);
 if(!cachedPayload||cachedSource!==serializeInput()){await updatePreview();status.textContent='预览已更新，请点击平台图标复制。';return;}
 if(target==='wecom'&&cachedPayload.segments.some(part=>part.type==='image')){
  try{wecomSegments.open(cachedPayload.segments);status.textContent='企微图文已分段，请按顺序复制并粘贴文字和图片。';}
  catch(error){showCopyNotice(error.message,true);}
  return;
 }
 copying=true;button.disabled=true;
 showCopyNotice('');status.textContent='正在复制到剪贴板…';
 const payload=cachedPayload,source=cachedSource,parts=target==='email'?payload.emailSegments:payload.segments;
 try{
  let count,native=false,windowsHtml=false;
  if(window.md2chatDesktop){
   const result=await window.md2chatDesktop.copy(parts,target);count=result.images;native=result.native;windowsHtml=result.windowsHtml===true;
  }else{
   const adapted=ChatTargets.render(parts,target);adapted.plain=payload.plain;count=adapted.imageCount;
   if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined')await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([adapted.html],{type:'text/html'}),'text/plain':new Blob([adapted.plain],{type:'text/plain'})})]);
   else if(!nativeCopy(adapted))throw new Error('浏览器不支持自动复制');
  }
  lastCopyTarget=target;
  showCopyNotice('✓ 已复制到剪贴板，请到'+profile.label+(target==='email'?'编辑器':'聊天框')+'粘贴');
  if(cachedSource===source){
   for(const b of copyButtons)b.setAttribute('aria-pressed',String(b===copyButton));
   message.innerHTML=target==='email'?ChatTargets.render(parts,target).html:payload.preview;
   document.getElementById('conversion-info').textContent=target==='email'?'邮件预览：'+payload.tableCount+' 个可编辑表格，'+count+' 张图片。':conversionSummary(payload);
   status.textContent='已复制到剪贴板（'+profile.label+'图文，'+count+' 张图片'+(target==='email'?'，表格可编辑':'')+'）。'+(native?'到钉钉聊天框粘贴即可。':windowsHtml?'已保留纯文本兜底；Windows 钉钉一次图文粘贴尚未解决。图片缺失时可使用“钉钉分段复制（备用）”。':profile.note);
  }
 }catch(error){showCopyNotice('复制失败，请查看下方提示后重试',true);status.textContent='复制未完成：'+error.message+'。请允许剪贴板访问后重试。';}
 finally{copying=false;button.disabled=!cachedPayload||cachedSource!==serializeInput();}
});

updatePreview();

// Explicit Windows-only experiments isolate HTML acceptance from image handling.
const dingtalkHtmlTests=document.getElementById('dingtalk-html-tests');
dingtalkHtmlTests.hidden=window.md2chatDesktop?.platform!=='win32';
for(const testButton of document.querySelectorAll('[data-dingtalk-html-test]'))testButton.addEventListener('click',async()=>{
 if(copying||window.md2chatDesktop?.platform!=='win32')return;
 copying=true;button.disabled=true;
 const testButtons=[...document.querySelectorAll('[data-dingtalk-html-test]')];
 for(const b of testButtons)b.disabled=true;
 try{
  const result=await window.md2chatDesktop.testDingtalkHtml(testButton.dataset.dingtalkHtmlTest);
  lastCopyTarget='dingtalk';
  document.getElementById('diagnostic-status').textContent=result.mode==='text'?'剪贴板已替换为无图片的 HTML 文字测试。请到钉钉草稿粘贴，记录是否出现“md2chat HTML 文字测试”，无需发送。':'已保持读取到的 HTML 文档内容不变并重新写入剪贴板。请粘贴到钉钉草稿，与直接从钉钉复制时的结果比较；无需发送。';
 }catch(error){document.getElementById('diagnostic-status').textContent='HTML 测试未完成：'+error.message;}
 finally{copying=false;button.disabled=!cachedPayload||cachedSource!==serializeInput();for(const b of testButtons)b.disabled=false;}
});

// Reports intentionally contain metadata only, never text, source HTML, or URLs.
const diagnosticStatus=document.getElementById('diagnostic-status');
const sampleHistory=[];
function rememberReport(lines){
 const text=lines.join('\n');sampleHistory.push(text);if(sampleHistory.length>2)sampleHistory.shift();
 document.getElementById('diagnostic-report').textContent=text;
 document.getElementById('copy-report').disabled=false;
 diagnosticStatus.textContent='排查完成。最近两份脱敏报告仅保留在页面内存中。';
}
function recentCopyLine(){return '最近复制目标：'+(lastCopyTarget?ChatTargets.profile(lastCopyTarget).label:'无')+'（仅记录本页操作，不代表当前剪贴板来源）';}
function desktopReportLines(report){
 const native=report.macDingtalk;
 const nativeCount=!native.applicable?'不适用（仅 macOS）':!native.present?'未发现该格式':native.images===null?'未能统计':native.images;
 const lines=['md2chat 桌面剪贴板报告','报告版本：2','应用版本：'+report.version,'系统：'+report.platform,recentCopyLine(),
  ...report.formats.map(format=>format.type+'：'+(format.bytes===null?'大小未知':format.bytes+' 字节')+(format.unreadable?'；读取失败':'')+(format.skipped?'；超过排查限额，未解析':'')),
  'Mac 钉钉专用格式图片：'+nativeCount,'独立图片格式：'+report.imageFormats+' 种（同一图片可能有多种格式）',
  'HTML 图片标签：'+report.htmlImages+'；HTML 表格：'+report.htmlTables];
 report.html.forEach((summary,index)=>lines.push('HTML 样本 '+(index+1)+'：',...ClipboardDiagnostics.htmlLines(summary)));
 if(report.platform==='win32'&&report.html.length)lines.push('以上为解码后的 HTML；片段标记统计不代表 Windows 原生 CF_HTML 头是否存在或有效。');
 if(report.truncated)lines.push('内容超过排查限额，以上仅为部分统计。');
 if(report.formats.some(format=>format.unreadable))lines.push('部分格式读取失败，图片统计可能不完整。');
 lines.push('结构按静态标签扫描，不执行 HTML，也不请求图片。','格式或标签存在不代表钉钉已成功导入图片。','报告不含正文、HTML 源码、图片内容、链接、文件路径或属性值。');
 return lines;
}
async function showSample(origin,entries,declaredTypes=[]){
 const lines=['md2chat 浏览器剪贴板报告','报告版本：2',recentCopyLine(),'入口：'+origin,'可见格式：'+[...new Set([...declaredTypes,...entries.map(e=>e.type)].slice(0,100).map(ClipboardDiagnostics.formatName))].join(', ')];
 let images=0,files=0,decodedBytes=0,incomplete=false;
 for(const entry of entries.slice(0,100)){
  const type=ClipboardDiagnostics.formatName(entry.type);
  if(entry.error){lines.push(type+'：读取失败');incomplete=true;continue;}
  lines.push(type+'：'+entry.blob.size+' 字节');
  if(entry.type==='text/html'){
   if(decodedBytes+entry.blob.size>8*1024*1024){lines.push('HTML 超过排查限额，未解析。');incomplete=true;continue;}
   decodedBytes+=entry.blob.size;
   const summary=ClipboardDiagnostics.summarizeHtml(await entry.blob.text());images+=summary.imageCount;
   incomplete||=summary.truncated;
   lines.push(...ClipboardDiagnostics.htmlLines(summary));
  }else if(entry.type.startsWith('image/'))files++;
 }
 if(entries.length>100||declaredTypes.length>100){lines.push('格式超过排查限额，以上仅为部分统计。');incomplete=true;}
 lines.push('HTML 图片 '+images+' 个；独立图片格式 '+files+' 种（同一图片可能有多种格式）。');
 if(images&&!files)lines.push('图片只在 HTML 中引用；本报告不代表图片已能读取或粘贴。');
 if(incomplete)lines.push('图片统计不完整，请缩小样本后重试。');
 else if(!images&&!files)lines.push('浏览器可见格式中未发现图片；不代表原生应用的专有剪贴板中没有图片。');
 lines.push('安全上下文：'+window.isSecureContext+'；Clipboard.read：'+!!navigator.clipboard?.read);
 lines.push('结构按静态标签扫描，不执行 HTML，也不请求图片。','报告不含正文、HTML 源码、图片内容、链接、文件路径或属性值；未读取原生私有格式。');
 rememberReport(lines);
}
document.getElementById('read-clipboard').addEventListener('click',async()=>{
 const readButton=document.getElementById('read-clipboard');readButton.disabled=true;
 diagnosticStatus.textContent='正在读取剪贴板格式与脱敏结构…';
 try{
  if(window.md2chatDesktop){
   const report=await window.md2chatDesktop.inspect();
   rememberReport(desktopReportLines(report));return;
  }
  if(!navigator.clipboard?.read)throw new Error('Clipboard.read unavailable');
  let timer;
  const items=await Promise.race([navigator.clipboard.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('读取超时，请手动粘贴')),10000);})]).finally(()=>clearTimeout(timer)),entries=[],declaredTypes=[];
  for(const item of items){for(const type of item.types){declaredTypes.push(type);if(declaredTypes.length>100)break;}if(declaredTypes.length>100)break;}
  outer:for(const item of items)for(const type of item.types){if(entries.length>=100)break outer;try{entries.push({type,blob:await item.getType(type)});}catch{entries.push({type,error:true});}}
  await showSample('读取按钮',entries,declaredTypes);
 }catch(error){diagnosticStatus.textContent='无法直接读取（'+error.name+'），请在排查框按 ⌘V / Ctrl+V 粘贴。';}
 finally{readButton.disabled=false;}
});
document.getElementById('clipboard-paste').addEventListener('paste',async event=>{
 event.preventDefault();const data=event.clipboardData,types=[...data.types],entries=[];
 for(const type of types.slice(0,100)){if(type==='Files')continue;const value=data.getData(type);if(value)entries.push({type,blob:new Blob([value],{type})});}
 for(const file of data.files){if(entries.length>=100)break;entries.push({type:file.type||'application/octet-stream',blob:file});}
 event.currentTarget.textContent='已接收样本，仅显示格式统计。';await showSample('原生粘贴事件',entries,types);
});
document.getElementById('copy-report').addEventListener('click',async()=>{
 try{const report=sampleHistory.join('\n\n────────\n\n');if(window.md2chatDesktop)await window.md2chatDesktop.copy([{type:'text',text:report}]);else await navigator.clipboard.writeText(report);diagnosticStatus.textContent='元数据报告已复制，当前剪贴板已被报告替换。';}
 catch(_){diagnosticStatus.textContent='自动复制失败，请手动选中上面的报告复制。';}
});

// Tray conversions use their own image registry and never replace the editor's input or preview.
async function convertClipboardContent(content,target){
 if(target!=='image')ChatTargets.profile(target);
 const imageAssets=new Map();let nextId=1;
 const register=src=>{
  if(!safeImageSource(src))throw new Error('剪贴板图片无法读取，请复制图片本身后重试。');
  const id=String(nextId++);imageAssets.set(id,{src});return '\n[[DING_IMAGE:'+id+']]\n';
 };
 const sources=[];
 for(const item of content)sources.push(await ClipboardSource.toSource(item,{registerImage:register,htmlToSource}));
 const source=sources.join('\n');
 if(!source.trim())throw new Error('剪贴板中没有可转换的文字或图片。');
 const payload=await buildPayload(source,imageAssets);
 if(target==='image')return [await ClipboardImage.render(payload.segments)];
 return target==='email'?payload.emailSegments:payload.segments;
}
window.md2chatDesktop?.onWecomSegments?.(parts=>wecomSegments.open(parts));
window.md2chatDesktop?.onConvertClipboard?.(convertClipboardContent);
