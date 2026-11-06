// Executed only by the explicitly requested --smoke app run. All inputs are synthetic.
(async () => {
 const started=performance.now(),cases=[];
 try {
  if(!window.md2chatDesktop)throw new Error('Tauri bridge was not initialized');
  const examples=[
   ['table','前文\n\n| 项目 | 数量 |\n| --- | --- |\n| 苹果 | 2 |\n| 茶杯 | 3 |\n\n后文'],
   ['code','前文\n\n```javascript\nconst message = "你好，Tauri";\nconsole.log(message);\n```\n\n后文'],
   ['math','前文\n\n$$\n\\frac{a+b}{c}=\\sqrt{x^2+y^2}\n$$\n\n后文'],
   ['mermaid','前文\n\n```mermaid\nflowchart LR\n A[输入 Markdown] --> B[转换图片]\n B --> C[复制图文]\n```\n\n后文']
  ];
  const images=[];
  for(const [name,source] of examples){
   const payload=await buildPayload(source);
   const imageParts=payload.segments.filter(part=>part.type==='image');
   if(!imageParts.length)throw new Error(name+' did not generate a PNG');
   if(!payload.segments.some(part=>part.type==='text'&&part.text.includes('前文'))||!payload.segments.some(part=>part.type==='text'&&part.text.includes('后文')))throw new Error(name+' lost surrounding text');
   for(const part of imageParts){
    const image=new Image();image.src=part.src;await image.decode();
    if(!image.naturalWidth||!image.naturalHeight)throw new Error(name+' has an empty image');
    images.push({name,src:part.src,width:image.naturalWidth,height:image.naturalHeight});
   }
   cases.push({name,status:'passed',images:imageParts.length});
  }
  // Local SVG uses the real WebView decoder and canvas, including UTF-8 text.
  const svgData=xml=>'data:image/svg+xml;base64,'+btoa(String.fromCharCode(...new TextEncoder().encode(xml)));
  const original=await ChatRenderers.svg(svgData('\ufeff<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect x="10" y="10" width="30" height="20" fill="#123456"/><text x="10" y="65" font-size="16">中文 SVG</text></svg>'));
  if(original.width!==240||original.height!==160||original.displayWidth!==120||original.displayHeight!==80)throw new Error('SVG dimensions or 2x resolution lost');
  const svgImage=new Image();svgImage.src=original.src;await svgImage.decode();
  const svgCanvas=document.createElement('canvas');svgCanvas.width=240;svgCanvas.height=160;
  const svgContext=svgCanvas.getContext('2d');svgContext.drawImage(svgImage,0,0);
  if(svgContext.getImageData(0,0,1,1).data[3]!==0||Array.from(svgContext.getImageData(30,30,1,1).data).join(',')!=='18,52,86,255')throw new Error('SVG transparency or color lost');
  if(!svgContext.getImageData(0,90,240,60).data.some((value,index)=>index%4===3&&value>0))throw new Error('SVG text was not drawn');
  svgCanvas.width=0;svgCanvas.height=0;
  const viewBox=await ChatRenderers.svg(svgData('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 60"><rect width="180" height="60" fill="red"/></svg>'));
  if(viewBox.displayWidth!==180||viewBox.displayHeight!==60)throw new Error('SVG viewBox dimensions lost');
  for(const [xml,reason] of [['<svg>broken','解码'],['<html/>','解码'],['<svg xmlns="http://www.w3.org/2000/svg" width="0" height="10"/>','解码'],['<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"/>','2000 万像素']]){
   let rejected=false;
   try{await ChatRenderers.svg(svgData(xml));}catch(error){if(!error.message.includes(reason))throw error;rejected=true;}
   if(!rejected)throw new Error('Invalid or oversized SVG was accepted');
  }
  cases.push({name:'local-svg-rasterization',status:'passed',width:original.width,height:original.height});
  images.push({name:'local-svg',src:original.src,width:original.width,height:original.height});
  // WebKit collapses a zero-basis flex list inside an auto-height dialog.
  const segmentParts=(await buildPayload(examples[3][1])).segments;
  const segmentController=WecomSegments.create({copySegment:()=>{}});
  for(const [name,parts] of [['short',segmentParts],['scrolling',Array.from({length:8},()=>segmentParts).flat()]]){
   try{
    segmentController.open(parts);
    const panel=document.querySelector('.wecom-segments-dialog'),list=panel.querySelector('.wecom-segments-list');
    await Promise.all([...list.querySelectorAll('img')].map(image=>image.decode()));
    const bounds=panel.getBoundingClientRect(),listBounds=list.getBoundingClientRect();
    if(list.clientHeight<Math.min(160,innerHeight*.3))throw new Error(name+' segment list collapsed to '+list.clientHeight+'px');
    if(bounds.top<0||bounds.bottom>innerHeight+1||panel.scrollHeight>panel.clientHeight+1)throw new Error(name+' segment dialog exceeds its viewport');
    const first=list.querySelector('.wecom-segment-heading').getBoundingClientRect();
    if(first.top<listBounds.top||first.bottom>listBounds.bottom)throw new Error(name+' first segment copy button is clipped');
    list.scrollTop=list.scrollHeight;
    const last=list.lastElementChild.getBoundingClientRect();
    if(last.bottom>listBounds.bottom+1)throw new Error(name+' final segment is unreachable');
    cases.push({name:'segments-layout-'+name,status:'passed',listHeight:list.clientHeight,scrollHeight:list.scrollHeight});
   }finally{segmentController.close();}
  }
  // Background conversion has a separate registry and must preserve editor input.
  const input=document.getElementById('markdown-input');
  input.textContent='主编辑器保持不变 😀';
  const before=input.innerHTML;
  const background=await convertClipboardContent([{plain:examples[0][1],html:'',images:[]}],'dingtalk');
  if(!background.some(part=>part.type==='image')||input.innerHTML!==before)throw new Error('background conversion changed the editor or lost the table');
  const combined=await convertClipboardContent([{plain:examples[0][1],html:'',images:[]}],'image');
  if(combined.length!==1||combined[0].type!=='image')throw new Error('combined PNG conversion failed');
  cases.push({name:'hidden-window-background',status:'passed'});
  let denied=false;
  try{await window.__TAURI__.core.invoke('preferences_get');}catch(_){denied=true;}
  if(!denied)throw new Error('main window unexpectedly accessed preferences-only commands');
  cases.push({name:'command-window-isolation',status:'passed'});
  await window.__TAURI__.core.invoke('desktop_smoke_result',{report:{status:'passed',cases,images,elapsedMs:Math.round(performance.now()-started)}});
 }catch(error){
  await window.__TAURI__.core.invoke('desktop_smoke_result',{report:{status:'failed',cases,error:String(error.message||error),elapsedMs:Math.round(performance.now()-started)}});
 }
})();
