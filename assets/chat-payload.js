/* Markdown → ordered chat segments. Renderers and image loading are injected so pages and plugins share one pipeline. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChatPayload=api;})(globalThis,()=>{
 const escapeHtml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 // deps: {markdown, renderers:{math,mermaid,code}, renderTable, imageAssets, ensureImage, describeImageError}
 async function build(source,deps){
  const {markdown,renderers,renderTable,imageAssets=new Map(),ensureImage,describeImageError=(src,error)=>src+'：'+error.message}=deps;
  if(source.length>2*1024*1024)throw new Error('文字过长，请分段转换（最多 2 MB 字符）。');
  const blocks=markdown.compactImages(markdown.parse(source)),parts=[],plain=[],preview=[],segments=[],emailTables=new Map(),emailSkip=new Set();let tableCount=0,imageCount=0,tableImages=0,originalImages=0,mathImages=0,mermaidImages=0,codeImages=0,codeCount=0;
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
     if(!run.math){rendered.push(markdown.runsHtml([run]));appendText(run.text,run);continue;}
     try{
      const image=await renderers.math(run.math,false);mathImages++;imageCount++;
      segments.push({type:'image',src:image.src,displayWidth:image.displayWidth||image.width});
      rendered.push('<img src="'+image.src+'" width="'+image.displayWidth+'" height="'+image.displayHeight+'" alt="'+escapeHtml(run.text)+'" style="display:inline-block;vertical-align:middle;max-width:100%;height:auto">');
     }catch(error){throw new Error('第 '+(mathImages+1)+' 个公式：'+error.message);}
    }
    const textHtml=rendered.join('');
    appendText('\n');
    parts.push(textHtml);plain.push(block.text);preview.push('<div style="white-space:pre-wrap;margin:0">'+textHtml+'</div>');
   }else if(block.type==='code'){
    codeCount++;
    try{for(const image of await renderers.code(block.text,block.language)){codeImages++;appendImage(image);}}
    catch(error){throw new Error('第 '+codeCount+' 个代码块：'+error.message);}
    const fence='`'.repeat(Math.max(3,...[...block.text.matchAll(/`+/g)].map(m=>m[0].length+1)));
    plain.push(fence+block.language+'\n'+block.text+'\n'+fence);
   }else if(block.type==='math'||block.type==='mermaid'){
    try{
     const image=block.type==='math'?await renderers.math(block.tex):await renderers.mermaid(block.text);
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
    try{const image=await ensureImage(asset,{allowLocal:!block.id});originalImages++;appendImage(image,image.sourceUrl);plain.push('[图片]');}
    catch(error){
     if(block.id)throw error;
     const failure=new Error(describeImageError(block.src,error));failure.resource=block.src;failure.sourceMarkup=block.markdown;failure.sourceStart=block.sourceStart;failure.sourceEnd=block.sourceEnd;throw failure;
    }
   }
  }
  const cleanSegment=s=>{if(s.type!=='text')return s;const runs=s.runs.map(r=>({...r}));while(runs.length&&!runs[0].text.replace(/^\n+/,''))runs.shift();while(runs.length&&!runs.at(-1).text.replace(/\n+$/,''))runs.pop();if(runs.length){runs[0].text=runs[0].text.replace(/^\n+/,'');runs.at(-1).text=runs.at(-1).text.replace(/\n+$/,'');}return {...s,text:runs.map(r=>r.text).join(''),runs};};
  const clean=list=>list.map(cleanSegment).filter(s=>s.type!=='text'||s.text.trim());
  return {html:"<meta charset='utf-8'>\n<article class=\"4ever-article\">\n"+parts.join(lineBreak)+'</article>',plain:plain.join('\n'),preview:preview.join(''),emailSegments:clean(segments.flatMap((s,i)=>emailSkip.has(i)?[]:[emailTables.get(i)||s])),segments:clean(segments),tableCount,imageCount,tableImages,originalImages,mathImages,mermaidImages,codeImages};
 }
 return {build};
});
