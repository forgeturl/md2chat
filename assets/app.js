const message=document.getElementById('message');
const copyButtons=[...document.querySelectorAll('[data-copy-target]')];
const wecomSegments=WecomSegments.create({copySegment:segment=>{
 const result=window.md2chatDesktop?window.md2chatDesktop.copyWecomSegment(segment):ChatClipboard.writeSegment(segment);
 return Promise.resolve(result).then(value=>{lastCopyTarget='wecom';return value;});
}});
let copying=false,lastCopyTarget=null;
const desktopRequired=b=>['image','dingtalk','feishu'].includes(b.dataset.copyTarget)&&!window.md2chatDesktop;
function copyTargetNote(target){if(target==='wecom'&&window.md2chatDesktop?.platform==='darwin')return 'Mac 企业微信支持一次粘贴整段图文，普通文字可编辑。';return target==='image'?'将完整内容合成一张 PNG，图片中的文字不可编辑。':target==='feishu'&&['darwin','win32'].includes(window.md2chatDesktop?.platform)?'请先展开飞书富文本输入框，再一次粘贴图文；普通输入框可能丢图。':ChatTargets.profile(target).note;}
const button={set disabled(value){for(const b of copyButtons)b.disabled=value||copying||desktopRequired(b);}};
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
function safeImageSource(src){return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(src)||/^https?:\/\//i.test(src)||/^blob:/i.test(src);}
function localImageSource(src){return typeof src==='string'&&/^(?:\/(?!\/)|[a-z]:[\\/]|file:)/i.test(src);}
function shortImageError(error){
 const message=String(error?.message||'读取失败。').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');
 if(error?.name==='TimeoutError'||error?.name==='AbortError'||/timed out|timeout/i.test(message))return '读取超时。';
 if(message==='Failed to fetch')return '无法访问。';
 if(message==='图片地址未返回图片数据')return '返回的不是图片。';
 if(message==='图片数据无法解码')return '图片无法解码。';
 const http=/^图片服务返回 HTTP (\d+)$/.exec(message);if(http)return 'HTTP '+http[1]+'。';
 return /[。！？]$/.test(message)?message:message+'。';
}
function imageResourceLabel(source){return /^data:/i.test(source)?'内嵌图片':/^blob:/i.test(source)?'临时图片':source;}
const assets=new Map();let nextAsset=1;let selectedImageId=null;let inputEpoch=0;
function sourceErrorRange(source,error){
 const markup=typeof error?.sourceMarkup==='string'?error.sourceMarkup:'';
 if(!markup)return null;
 if(Number.isInteger(error.sourceStart)&&Number.isInteger(error.sourceEnd)&&error.sourceStart>=0&&error.sourceEnd<=source.length&&source.slice(error.sourceStart,error.sourceEnd)===markup)return {start:error.sourceStart,end:error.sourceEnd};
 const start=source.indexOf(markup);return start<0?null:{start,end:start+markup.length};
}
const inputErrorHighlight='md2chat-source-error';
function clearInputError(){
 globalThis.CSS?.highlights?.delete(inputErrorHighlight);input.classList.remove('source-error-fallback');input.removeAttribute('aria-invalid');
}
function markInputError(snapshot,error){
 clearInputError();input.setAttribute('aria-invalid','true');
 let sourceRange=sourceErrorRange(snapshot.source,error);
 if(!sourceRange&&typeof error?.resource==='string'){const start=snapshot.source.indexOf(error.resource);if(start>=0)sourceRange={start,end:start+error.resource.length};}
 if(!sourceRange){input.classList.add('source-error-fallback');return;}
 const startEntry=snapshot.textSpans.find(span=>span.start<=sourceRange.start&&sourceRange.start<span.end);
 const endEntry=snapshot.textSpans.find(span=>span.start<sourceRange.end&&sourceRange.end<=span.end);
 if(!startEntry||!endEntry){input.classList.add('source-error-fallback');return;}
 const range=document.createRange();range.setStart(startEntry.node,sourceRange.start-startEntry.start);range.setEnd(endEntry.node,sourceRange.end-endEntry.start);
 if(globalThis.CSS?.highlights&&typeof globalThis.Highlight==='function')globalThis.CSS.highlights.set(inputErrorHighlight,new Highlight(range));
 else{input.classList.add('source-error-fallback');return;}
 const rect=range.getBoundingClientRect(),box=input.getBoundingClientRect();
 if(rect.top<box.top||rect.bottom>box.bottom)input.scrollTop+=rect.top-box.top-input.clientHeight/3;
}
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
function inputSnapshot(){
 let source='';const textSpans=[];
 function walk(node){
  if(node.nodeType===3){const start=source.length;source+=node.textContent;textSpans.push({node,start,end:source.length});return node.textContent;}
  if(node.nodeType!==1)return '';
  if(node.tagName==='IMG'){const value='\n[[DING_IMAGE:'+node.dataset.assetId+']]\n';source+=value;return value;}
  if(node.tagName==='BR'){source+='\n';return '\n';}
  let result=[...node.childNodes].map(walk).join('');
  if(['DIV','P','LI'].includes(node.tagName)&&result&&!result.endsWith('\n')){source+='\n';result+='\n';}
  return result;
 }
 [...input.childNodes].forEach(walk);return {source,textSpans};
}
function serializeInput(){return inputSnapshot().source;}
function blobToData(blob){if(blob.size>10*1024*1024)return Promise.reject(new Error('单张图片不能超过 10 MB'));return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('无法读取粘贴的图片'));reader.readAsDataURL(blob);});}
async function ensureImage(asset,{allowLocal=false}={}){
 const local=allowLocal&&localImageSource(asset?.src);
 if(local&&!window.md2chatDesktop?.readLocalImage)throw new Error('请使用桌面版读取，网页版请粘贴图片。');
 if(!asset||(!local&&!safeImageSource(asset.src)))throw new Error('图片地址格式不受支持，请粘贴图片本身。');
 // Preserve an existing source before decoding; generated images stay local.
 if(!asset.sourceUrl&&asset.src.length<=8192&&/^https:\/\//i.test(asset.src))asset.sourceUrl=asset.src;
 if(asset.ready)return asset;
 if(asset.failed)throw new Error(asset.failed);
 if(asset.pending)return asset.pending;
 if(asset.src.length>15*1024*1024)throw new Error('单张图片数据过大');
 asset.pending=(async()=>{
  try{
   if(local){
    asset.src=await window.md2chatDesktop.readLocalImage(asset.src);
    if(!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(asset.src)||asset.src.length>15*1024*1024)throw new Error('图片数据无效。');
   }else if(!asset.src.startsWith('data:')){
    const response=await fetch(asset.src,{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('图片服务返回 HTTP '+response.status);
    const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error('图片地址未返回图片数据');
    if(blob.size>10*1024*1024)throw new Error('单张图片不能超过 10 MB');
    asset.src=await blobToData(blob);
   }
   await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(image.naturalWidth*image.naturalHeight>20000000){reject(new Error('图片不能超过 2000 万像素'));return;}asset.width=image.naturalWidth;asset.height=image.naturalHeight;resolve();};image.onerror=()=>reject(new Error('图片数据无法解码'));image.src=asset.src;});
   asset.ready=true;return asset;
  }catch(error){
   asset.failed=shortImageError(error);
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

function renderTable(header,rows){return TableImages.render(header,rows);}

function buildPayload(source,imageAssets=assets){
 return ChatPayload.build(source,{markdown:ChatMarkdown,renderers:ChatRenderers,renderTable,imageAssets,ensureImage,describeImageError:(src,error)=>imageResourceLabel(src)+'：'+shortImageError(error)});
}
let cachedSource=null,cachedPayload=null,previewTimer,renderVersion=0;
if(window.md2chatDesktop){
 document.getElementById('back-home').hidden=true;
 document.querySelector('[data-copy-target="image"]').hidden=false;
 document.getElementById('image-copy-help').hidden=false;
 document.querySelector('.copy-label').textContent='转换 / 复制';
 for(const target of ['dingtalk','feishu']){
  document.getElementById(target+'-desktop-hint').hidden=true;
  const wrapper=document.getElementById(target+'-copy-wrapper');
  wrapper.classList.remove('desktop-only-copy');
  for(const name of ['tabindex','aria-label','aria-describedby'])wrapper.removeAttribute(name);
 }
 document.querySelector('.privacy-note').textContent='桌面版 · 无需登录 · 内容在本机处理 · 钉钉、Mac 飞书复制所需图片临时保存在本机';
 document.getElementById('copy-help').textContent='桌面版可直接使用下方的平台按钮；不同平台的粘贴方式略有不同。';
}
function conversionSummary(payload){return '原文图片 '+payload.originalImages+' 张 + 表格图片 '+payload.tableImages+' 张 + 公式 '+payload.mathImages+' 张 + 图表 '+payload.mermaidImages+' 张 + 代码 '+payload.codeImages+' 张 = 共 '+payload.imageCount+' 张图片。';}
function updateCopyControls(){for(const b of copyButtons){const target=b.dataset.copyTarget;b.setAttribute('aria-pressed','false');b.title=desktopRequired(b)?'':target==='image'?copyTargetNote(target):'复制到'+ChatTargets.profile(target).label+'：'+copyTargetNote(target);if(desktopRequired(b)){b.disabled=true;if(target!=='image')b.setAttribute('aria-describedby',target+'-desktop-hint');}else b.removeAttribute('aria-describedby');}}
updateCopyControls();
async function updatePreview(){
 const snapshot=inputSnapshot(),source=snapshot.source;const version=++renderVersion;clearInputError();
 button.disabled=true;
 if(source===cachedSource&&cachedPayload){button.disabled=false;return cachedPayload;}
 cachedPayload=null;
 if(!source.trim()){message.innerHTML='<p style="color:#718096">'+escapeHtml(window.md2chatI18n?.t('粘贴图文或 Markdown 后，这里会显示完整预览。') || '粘贴图文或 Markdown 后，这里会显示完整预览。')+'</p>';cachedSource=null;document.getElementById('conversion-info').textContent='';return null;}
 try{
  const payload=await buildPayload(source);
  if(version!==renderVersion)return null;
  message.innerHTML=payload.preview;cachedSource=source;cachedPayload=payload;button.disabled=false;updateCopyControls(true);
  document.getElementById('conversion-info').textContent=conversionSummary(payload);
  status.textContent=window.md2chatDesktop?'内容已准备好，可转图片或按平台复制。':'图文已准备好，点击目标平台图标复制。';return payload;
 }catch(error){if(version===renderVersion){message.textContent=error.message;status.textContent=error.message;markInputError(snapshot,error);document.getElementById('conversion-info').textContent='转换未完成，请根据提示调整内容后重试。';}return null;}
}
document.getElementById('clear-input').addEventListener('click',()=>{
 inputEpoch++;clearTimeout(previewTimer);input.replaceChildren();assets.clear();selectedImageId=null;cachedSource=null;cachedPayload=null;
 updateCopyControls(true);updatePreview();status.textContent='已清空，请粘贴新内容。';input.focus();
});
input.addEventListener('input',()=>{renderVersion++;clearInputError();button.disabled=true;cachedPayload=null;clearTimeout(previewTimer);status.textContent='正在准备文字、图片、公式和图表…';previewTimer=setTimeout(updatePreview,350);});
function nativeCopy(payload){
 const sink=document.createElement('div');sink.contentEditable='true';sink.setAttribute('aria-hidden','true');sink.style.cssText='position:fixed;left:-100000px;top:0;width:1100px;background:white;';
 sink.innerHTML=payload.html;document.body.appendChild(sink);
 const active=document.activeElement;const selection=getSelection();const previous=[];for(let i=0;i<selection.rangeCount;i++)previous.push(selection.getRangeAt(i).cloneRange());
 const onCopy=event=>{event.clipboardData.setData('text/html',payload.html);event.clipboardData.setData('text/plain',payload.plain);event.preventDefault();};
 sink.addEventListener('copy',onCopy);
 try{sink.focus();const range=document.createRange();range.selectNodeContents(sink);selection.removeAllRanges();selection.addRange(range);return document.execCommand('copy');}
 finally{sink.remove();selection.removeAllRanges();for(const range of previous){try{selection.addRange(range);}catch(_){}}if(active&&active.focus)active.focus();}
}
for(const copyButton of copyButtons)copyButton.addEventListener('click',async()=>{
 if(copying||desktopRequired(copyButton))return;
 clearTimeout(previewTimer);
 const target=copyButton.dataset.copyTarget,profile=target==='image'?null:ChatTargets.profile(target);
 if(!cachedPayload||cachedSource!==serializeInput()){const refreshed=await updatePreview();if(refreshed)status.textContent=target==='image'?'预览已更新，请再次点击“图片”。':'预览已更新，请点击平台图标复制。';return;}
 if(target==='wecom'&&window.md2chatDesktop?.platform!=='darwin'&&cachedPayload.segments.some(part=>part.type==='image')){
  try{wecomSegments.open(cachedPayload.segments);status.textContent='企微图文已分段，请按顺序复制并粘贴文字和图片。';}
  catch(error){showCopyNotice(error.message,true);}
  return;
 }
 copying=true;button.disabled=true;
 showCopyNotice('');status.textContent=target==='image'?'正在转图片…':'正在复制到剪贴板…';
 const payload=cachedPayload,source=cachedSource,parts=target==='email'?payload.emailSegments:payload.segments;
 try{
  if(target==='image'){
   let image;
   await window.md2chatDesktop.copyImage(async()=>{
    image=await ClipboardImage.render(parts,{fit:true});
    if(source!==serializeInput())throw new Error('内容已更新，请重新转图片。');
    return image;
   });
   lastCopyTarget='image';
   if(cachedSource===source&&serializeInput()===source){
    showCopyNotice('已转为图片并写入剪贴板，可以直接粘贴。');
    for(const b of copyButtons)b.setAttribute('aria-pressed',String(b===copyButton));
    message.innerHTML=ChatTargets.render([image],'wechat').html;
    document.getElementById('conversion-info').textContent=copyTargetNote('image');
    status.textContent='已转为图片并写入剪贴板，可以直接粘贴。';
   }else{
    const notice='已复制转换开始时的内容；当前文档已更新，请重新转图片。';
    showCopyNotice(notice);status.textContent=notice;
   }
   return;
  }
  let count,native=false,windowsHtml=false,feishuNative=false;
  if(window.md2chatDesktop){
   const result=await window.md2chatDesktop.copy(parts,target);count=result.images;native=result.native;windowsHtml=result.windowsHtml===true;feishuNative=result.feishuNative===true;
  }else{
   const adapted=ChatTargets.render(parts,target);adapted.plain=payload.plain;count=adapted.imageCount;
   if(navigator.clipboard?.write&&typeof ClipboardItem!=='undefined')await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([adapted.html],{type:'text/html'}),'text/plain':new Blob([adapted.plain],{type:'text/plain'})})]);
   else if(!nativeCopy(adapted))throw new Error('浏览器不支持自动复制');
  }
  lastCopyTarget=target;
  showCopyNotice(feishuNative?'✓ 已复制，请先展开飞书富文本输入框，再一次粘贴图文':'✓ 已复制到剪贴板，请到'+profile.label+(target==='email'?'编辑器':'聊天框')+'粘贴');
  if(cachedSource===source){
   for(const b of copyButtons)b.setAttribute('aria-pressed',String(b===copyButton));
   message.innerHTML=target==='email'?ChatTargets.render(parts,target).html:payload.preview;
   document.getElementById('conversion-info').textContent=target==='email'?'邮件预览：'+payload.tableCount+' 个可编辑表格，'+count+' 张图片。':conversionSummary(payload);
   status.textContent='已复制到剪贴板（'+profile.label+'图文，'+count+' 张图片'+(target==='email'?'，表格可编辑':'')+'）。'+(native?'到钉钉聊天框粘贴即可。':windowsHtml?'已写入 Chromium 兼容图文，请到钉钉粘贴并确认图片完整。':copyTargetNote(target));
  }
 }catch(error){showCopyNotice(target==='image'?'转图片未完成，请根据提示重试。':'复制失败，请查看下方提示后重试',true);status.textContent=target==='image'?error.message:'复制未完成：'+error.message+'。请允许剪贴板访问后重试。';}
 finally{copying=false;button.disabled=!cachedPayload||cachedSource!==serializeInput();}
});

updatePreview();

// Only the currently displayed snapshot is exported; closing invalidates pending work.
const diagnosticStatus=document.getElementById('diagnostic-status');
const diagnosticDialog=document.getElementById('diagnostic-dialog');
let diagnosticSample=null,diagnosticEpoch=0,diagnosticReading=false,diagnosticExporting=false,disposeDiagnosticPreview=()=>{};
const diagnosticDownloads=new Set();
let diagnosticMessage={source:'点击读取，查看剪贴板中的内容。',values:{}};
const diagnosticT=(source,values)=>{const text=window.md2chatI18n?.t(source)||source;return values?text.replace(/\{(\w+)\}/g,(_,key)=>String(values[key]??'')):text;};
function renderDiagnosticStatus(){
 const values=Object.fromEntries(Object.entries(diagnosticMessage.values).map(([key,value])=>[key,key==='reason'?diagnosticT(value):value]));
 diagnosticStatus.textContent=diagnosticT(diagnosticMessage.source,values);
}
function setDiagnosticStatus(source,values={}){diagnosticMessage={source,values};renderDiagnosticStatus();}
function renderDiagnosticPreview(){
 disposeDiagnosticPreview();
 const results=document.getElementById('diagnostic-report');results.replaceChildren();
 if(diagnosticSample)disposeDiagnosticPreview=ClipboardDiagnostics.renderPreview(results,diagnosticSample,{document,t:diagnosticT});
 else{const empty=document.createElement('p');empty.className='diagnostic-empty';empty.textContent=diagnosticT('尚未读取剪贴板。');results.append(empty);disposeDiagnosticPreview=()=>results.replaceChildren();}
}
window.addEventListener?.('md2chat:language',()=>{renderDiagnosticStatus();renderDiagnosticPreview();});
function recentCopyLine(){return '最近复制目标：'+(lastCopyTarget==='image'?'图片':lastCopyTarget?ChatTargets.profile(lastCopyTarget).label:'无')+'（仅记录本页操作，不代表当前剪贴板来源）';}
function activeDiagnostic(epoch){return diagnosticDialog.open&&epoch===diagnosticEpoch;}
function resetDiagnostics(){
 diagnosticEpoch++;diagnosticSample=null;diagnosticReading=false;diagnosticExporting=false;
 disposeDiagnosticPreview();disposeDiagnosticPreview=()=>{};
 for(const url of diagnosticDownloads)URL.revokeObjectURL(url);diagnosticDownloads.clear();
 document.getElementById('diagnostic-report').replaceChildren();renderDiagnosticPreview();
 document.getElementById('diagnostic-feedback').hidden=true;
 setDiagnosticStatus('点击读取，查看剪贴板中的内容。');
 document.getElementById('read-clipboard').disabled=false;document.getElementById('export-diagnostics').disabled=true;
}
diagnosticDialog.addEventListener('close',resetDiagnostics);
diagnosticDialog.addEventListener('cancel',resetDiagnostics);
async function showSample(origin,entries,metadata={},epoch=diagnosticEpoch){
 const sample=await ClipboardDiagnostics.capture(entries,{...metadata,origin,recentCopy:recentCopyLine()});
 if(!activeDiagnostic(epoch))return;
 diagnosticSample=sample;renderDiagnosticPreview();
 document.getElementById('export-diagnostics').disabled=false;
 setDiagnosticStatus(!sample.formats.length?'剪贴板中没有可读取的内容。':sample.incomplete?'部分内容未能读取，原因见下方。':'读取完成，识别结果如下。');
}
document.getElementById('read-clipboard').addEventListener('click',async()=>{
 if(diagnosticReading||diagnosticExporting||!diagnosticDialog.open)return;
 const epoch=diagnosticEpoch;diagnosticReading=true;diagnosticSample=null;disposeDiagnosticPreview();disposeDiagnosticPreview=()=>{};document.getElementById('diagnostic-feedback').hidden=true;
 const readButton=document.getElementById('read-clipboard');readButton.disabled=true;document.getElementById('export-diagnostics').disabled=true;
 setDiagnosticStatus('正在读取剪贴板…');
 try{
  if(window.md2chatDesktop){
   const {entries,...metadata}=await window.md2chatDesktop.inspect();
   if(activeDiagnostic(epoch))await showSample('系统剪贴板',entries,metadata,epoch);return;
  }
  if(!navigator.clipboard?.read)throw new Error('当前浏览器不支持直接读取');
  let timer,htmlMode='请求未经清理的 HTML；是否支持由浏览器决定';
  const request=navigator.clipboard.read({unsanitized:['text/html']}).catch(error=>{
   if(!activeDiagnostic(epoch))throw error;
   if(error.name==='TypeError'||error.name==='NotSupportedError'){htmlMode='浏览器不支持未经清理的 HTML，使用默认读取结果';return navigator.clipboard.read();}throw error;
  });
  const items=await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('读取超时')),10000);})]).finally(()=>clearTimeout(timer)),entries=[];
  let total=0;
  for(let itemIndex=0;itemIndex<items.length;itemIndex++)for(const type of items[itemIndex].types){
   if(!activeDiagnostic(epoch))return;
   if(entries.length>=ClipboardDiagnostics.FORMAT_LIMIT)throw new Error('剪贴板格式超过 1000，请缩小样本');
   try{
    const blob=await items[itemIndex].getType(type);
    if(blob.size>ClipboardDiagnostics.CAPTURE_LIMIT-total)entries.push({item:itemIndex,type,size:blob.size,error:'超过单次采集 60 MiB 限额，未采集'});
    else{total+=blob.size;entries.push({item:itemIndex,type,blob});}
   }catch{entries.push({item:itemIndex,type,error:'浏览器未允许读取此格式'});}
  }
  if(activeDiagnostic(epoch))await showSample('读取按钮',entries,{platform:'browser',userAgent:navigator.userAgent,htmlMode},epoch);
 }catch(error){if(activeDiagnostic(epoch))setDiagnosticStatus('读取失败：{reason}。可在此窗口按 ⌘V / Ctrl+V 粘贴。',{reason:error.message});}
 finally{if(activeDiagnostic(epoch)){diagnosticReading=false;readButton.disabled=false;document.getElementById('export-diagnostics').disabled=!diagnosticSample;}}
});
// Pasting remains a fallback without adding another control to the dialog.
diagnosticDialog.addEventListener('paste',async event=>{
 event.preventDefault();if(diagnosticReading||diagnosticExporting||!diagnosticDialog.open)return;
 const epoch=diagnosticEpoch;diagnosticReading=true;diagnosticSample=null;disposeDiagnosticPreview();disposeDiagnosticPreview=()=>{};document.getElementById('diagnostic-feedback').hidden=true;
 document.getElementById('read-clipboard').disabled=true;document.getElementById('export-diagnostics').disabled=true;
 try{
  const data=event.clipboardData,types=[...data.types],entries=[];
  if(types.length+data.files.length>ClipboardDiagnostics.FORMAT_LIMIT)throw new Error('剪贴板格式超过 1000，请缩小样本');
  for(const type of types){if(type==='Files')continue;try{entries.push({type,blob:new Blob([data.getData(type)],{type})});}catch{entries.push({type,error:'粘贴事件未提供数据'});}}
  for(const file of data.files)entries.push({type:file.type||'application/octet-stream',blob:file});
  await showSample('原生粘贴事件',entries,{platform:'browser',declaredTypes:types,userAgent:navigator.userAgent},epoch);
 }catch(error){if(activeDiagnostic(epoch))setDiagnosticStatus('读取失败：{reason}',{reason:error.message});}
 finally{if(activeDiagnostic(epoch)){diagnosticReading=false;document.getElementById('read-clipboard').disabled=false;document.getElementById('export-diagnostics').disabled=!diagnosticSample;}}
});
document.getElementById('export-diagnostics').addEventListener('click',async()=>{
 if(!diagnosticSample||diagnosticReading||diagnosticExporting||!diagnosticDialog.open)return;
 const epoch=diagnosticEpoch,button=document.getElementById('export-diagnostics');diagnosticExporting=true;button.disabled=true;document.getElementById('read-clipboard').disabled=true;
 try{
  const blob=ClipboardDiagnostics.bundle([diagnosticSample]),name='md2chat-clipboard-'+new Date().toISOString().replace(/[:.]/g,'-')+'.zip';
  if(window.md2chatDesktop){
   const bytes=new Uint8Array(await blob.arrayBuffer());if(!activeDiagnostic(epoch))return;let binary='';
   for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   const saved=await window.md2chatDesktop.saveDiagnostics(name,btoa(binary));
   if(activeDiagnostic(epoch)){setDiagnosticStatus(saved?'诊断 ZIP 已保存，可发送给开发者。':'已取消导出。');document.getElementById('diagnostic-feedback').hidden=!saved;}
  }else{
   const url=URL.createObjectURL(blob);diagnosticDownloads.add(url);
   const link=document.createElement('a');link.href=url;link.download=name;link.click();
   setTimeout(()=>{URL.revokeObjectURL(url);diagnosticDownloads.delete(url);},30000);
   setDiagnosticStatus('诊断 ZIP 已生成，请查看下载。');document.getElementById('diagnostic-feedback').hidden=false;
  }
 }catch(error){if(activeDiagnostic(epoch))setDiagnosticStatus('导出失败：{reason}',{reason:error.message});}
 finally{if(activeDiagnostic(epoch)){diagnosticExporting=false;button.disabled=!diagnosticSample;document.getElementById('read-clipboard').disabled=false;}}
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

// Localize only the empty UI hint; a language change never rewrites user content.
window.addEventListener?.('md2chat:language', () => { if (!serializeInput().trim()) void updatePreview(); });
