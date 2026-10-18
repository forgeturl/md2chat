/* Compose already-converted clipboard segments into one local PNG. */
(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;else root.ClipboardImage=api;
})(globalThis,root=>{
 'use strict';
 const CONTENT_WIDTH=1100,PADDING=32,FONT_SIZE=20,LINE_HEIGHT=30,GAP=16,SCALE=2,MIN_FIT_SCALE=1;
 const MAX_PIXELS=20000000,MAX_TEXT=200000,MAX_PARTS=500,MAX_RUNS=20000;
 const MAX_IMAGE_SOURCE=15*1024*1024,MAX_SOURCE=60*1024*1024,MAX_DECODED_PIXELS=40000000,MAX_PNG_BYTES=10*1024*1024;
 const imageSource=/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i;
 const tooLarge=()=>new Error('生成的图片过大（最多 2,000 万像素），请减少内容或分段转换。');
 const tooLong=()=>new Error('内容过长，无法生成一张清晰的长图，请减少内容后重试。');
 const style=run=>({bold:!!run.bold,italic:!!run.italic,strikethrough:!!run.strikethrough,code:!!run.code});
 const sameStyle=(a,b)=>a.bold===b.bold&&a.italic===b.italic&&a.strikethrough===b.strikethrough&&a.code===b.code;
 function font(run){
  return (run.italic?'italic ':'')+(run.bold?'600 ':'400 ')+(run.code?19:FONT_SIZE)+'px '+(run.code?'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace':'-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif');
 }
 function snapshot(parts){
  if(!Array.isArray(parts)||!parts.length)throw new Error('剪贴板没有可转为图片的内容。');
  if(parts.length>MAX_PARTS)throw new Error('内容段落过多（最多 500 段），请分段转换。');
  let textSize=0,sourceSize=0,runCount=0;
  const result=parts.map(part=>{
   if(part?.type==='text'&&typeof part.text==='string'){
    textSize+=part.text.length;sourceSize+=part.text.length;
    if(textSize>MAX_TEXT)throw new Error('文字过长（最多 200,000 字符），请分段转换。');
    let runs;
    if(part.runs===undefined)runs=[{text:part.text,...style({})}];
    else{
     if(!Array.isArray(part.runs)||(runCount+=part.runs.length)>MAX_RUNS)throw new Error('文字样式过多，请分段转换。');
     let length=0;
     runs=part.runs.map(run=>{
      if(typeof run?.text!=='string'||(length+=run.text.length)>part.text.length)throw new Error('文字样式内容无效，请重新转换。');
      return {text:run.text,...style(run)};
     });
     if(runs.map(run=>run.text).join('')!==part.text)throw new Error('文字样式内容无效，请重新转换。');
    }
    return {type:'text',text:part.text,runs};
   }
   if(part?.type==='image'&&typeof part.src==='string'){
    if(part.src.length>MAX_IMAGE_SOURCE)throw new Error('单张图片数据过大，请压缩图片后重试。');
    if(!imageSource.test(part.src))throw new Error('转图片仅支持内嵌的 PNG、JPEG、GIF、WebP 或 BMP 图片。');
    if(part.displayWidth!==undefined&&(!Number.isFinite(part.displayWidth)||part.displayWidth<=0))throw new Error('图片显示尺寸无效，请重新转换。');
    sourceSize+=part.src.length;
    return {type:'image',src:part.src,width:part.width,height:part.height,displayWidth:part.displayWidth};
   }
   throw new Error('转换内容无效，请重新复制完整图文。');
  });
  if(sourceSize>MAX_SOURCE)throw new Error('图文数据过大，请减少图片后重试。');
  if(!result.some(part=>part.type==='image'||part.text.trim()))throw new Error('剪贴板没有可转为图片的内容。');
  return result;
 }
 function checkHeight(bottom,scale){
  const width=Math.ceil((CONTENT_WIDTH+PADDING*2)*scale),height=Math.ceil(Math.ceil(bottom+PADDING)*scale);
  if(!Number.isSafeInteger(height)||height<=0||width*height>MAX_PIXELS)throw tooLarge();
  return height;
 }
 // Image dimensions are natural bitmap dimensions; measure receives text and its style.
 function layout(parts,measure,scale=SCALE){
  const content=snapshot(parts),nodes=[];
  if(typeof measure!=='function')throw new Error('文字测量暂不可用，请重试。');
  if(typeof Intl.Segmenter!=='function')throw new Error('当前环境不支持完整文字排版，请更新应用后重试。');
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  let y=PADDING,hasPart=false;
  for(const part of content){
   if(part.type==='text'&&!part.text)continue;
   if(hasPart)y+=GAP;
   hasPart=true;
   if(part.type==='image'){
    if(!Number.isFinite(part.width)||!Number.isFinite(part.height)||part.width<=0||part.height<=0)throw new Error('图片尺寸无效，请重新复制图片。');
    const ratio=Math.min(1,CONTENT_WIDTH/part.width,(part.displayWidth??part.width)/part.width),width=part.width*ratio,height=part.height*ratio;
    checkHeight(y+height,scale);
    nodes.push({type:'image',src:part.src,x:PADDING,y,width,height});y+=height;
    continue;
   }
   let row={type:'text',x:PADDING,y,width:0,height:LINE_HEIGHT,runs:[]},runIndex=0,runEnd=part.runs[0]?.text.length||0;
   const flush=()=>{checkHeight(y+LINE_HEIGHT,scale);nodes.push(row);y+=LINE_HEIGHT;row={type:'text',x:PADDING,y,width:0,height:LINE_HEIGHT,runs:[]};};
   const widthOf=(text,run)=>{
    const width=measure(text,run);
    if(!Number.isFinite(width)||width<0)throw new Error('文字排版失败，请重试。');
    return width;
   };
   for(const grapheme of segmenter.segment(part.text)){
    while(runIndex<part.runs.length-1&&grapheme.index>=runEnd){runIndex++;runEnd+=part.runs[runIndex].text.length;}
    const current=part.runs[runIndex]||style({}),glyph=grapheme.segment;
    if(glyph==='\n'||glyph==='\r'||glyph==='\r\n'){flush();continue;}
    const text=glyph==='\t'?'    ':glyph;
    let last=row.runs.at(-1),matches=last&&sameStyle(last,current),width=widthOf(matches?last.text+text:text,current);
    let added=width-(matches?last.width:0);
    if(row.width+added>CONTENT_WIDTH&&row.runs.length){flush();last=null;matches=false;width=widthOf(text,current);added=width;}
    if(width>CONTENT_WIDTH)throw new Error('文字中有过长的组合字符，无法排版，请拆分内容后重试。');
    if(matches){last.text+=text;last.width=width;}
    else row.runs.push({text,width,...style(current)});
    row.width+=added;
   }
   flush();
  }
  const width=CONTENT_WIDTH+PADDING*2,height=Math.ceil(y+PADDING);
  checkHeight(y,scale);
  return {nodes,width,height,pixelWidth:Math.ceil(width*scale),pixelHeight:Math.ceil(height*scale),scale};
 }
 async function decodeImage(src,index){
  if(typeof root.Image!=='function')throw new Error('图片解码暂不可用，请重试。');
  const image=new root.Image();image.decoding='async';
  try{
   if(typeof image.decode==='function'){image.src=src;await image.decode();}
   else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=src;});
  }catch{throw new Error('第 '+index+' 张图片无法读取，请重新复制完整图片。');}
  if(!Number.isSafeInteger(image.naturalWidth)||!Number.isSafeInteger(image.naturalHeight)||image.naturalWidth<=0||image.naturalHeight<=0)throw new Error('第 '+index+' 张图片尺寸无效，请重新复制图片。');
  return image;
 }
 function pngSource(canvas){
  return new Promise((resolve,reject)=>{
   try{
    canvas.toBlob(blob=>{
     if(!blob){reject(new Error('图片生成失败，请减少内容后重试。'));return;}
     if(blob.size>MAX_PNG_BYTES){reject(new Error('生成的 PNG 文件过大（最多 10 MB），请减少内容或压缩原图后重试。'));return;}
     try{
      const reader=new root.FileReader();
      reader.onload=()=>typeof reader.result==='string'&&reader.result.startsWith('data:image/png;base64,')?resolve(reader.result):reject(new Error('PNG 图片编码失败，请重试。'));
      reader.onerror=()=>reject(new Error('PNG 图片编码失败，请重试。'));
      reader.readAsDataURL(blob);
     }catch{reject(new Error('PNG 图片编码失败，请重试。'));}
    },'image/png');
   }catch{reject(new Error('图片生成失败，请减少内容后重试。'));}
  });
 }
 // Scales from the sharp default down to MIN_FIT_SCALE, largest first, that keep the bitmap within the pixel limit.
 function fitScales(content,measure){
  let base;
  try{base=layout(content,measure,MIN_FIT_SCALE);}
  catch(error){if(error.message===tooLarge().message)throw tooLong();throw error;}
  const largest=Math.min(SCALE,Math.floor(Math.sqrt(MAX_PIXELS/(base.width*base.height))*20)/20),scales=[];
  for(let scale=largest;scale>MIN_FIT_SCALE;scale=Math.round((scale-0.25)*100)/100)scales.push(scale);
  return [...scales,MIN_FIT_SCALE];
 }
 // fit: one image for any length that fits at MIN_FIT_SCALE, lowering resolution instead of failing at the pixel or PNG limit.
 async function render(parts,{fit=false}={}){
  const content=snapshot(parts);
  if(!root.document?.createElement)throw new Error('转图片暂不可用，请在应用内重试。');
  const canvas=root.document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('转图片暂不可用，请在应用内重试。');
  const images=new Map();let decodedPixels=0,imageIndex=0;
  try{
   for(const part of content){
    if(part.type!=='image')continue;
    imageIndex++;
    const cached=images.get(part.src),image=cached||await decodeImage(part.src,imageIndex);
    if(!cached)decodedPixels+=image.naturalWidth*image.naturalHeight;
    if(decodedPixels>MAX_DECODED_PIXELS)throw new Error('原图总尺寸过大，请压缩图片或分段转换。');
    part.width=image.naturalWidth;part.height=image.naturalHeight;images.set(part.src,image);
   }
   const measure=(text,run)=>{ctx.font=font(run);return ctx.measureText(text).width;};
   const scales=fit?fitScales(content,measure):[SCALE];
   for(let attempt=0;;attempt++){
    // The complete layout has passed the pixel limit before allocating the output bitmap.
    const page=layout(content,measure,scales[attempt]);
    canvas.width=page.pixelWidth;canvas.height=page.pixelHeight;
    ctx.scale(page.scale,page.scale);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,page.width,page.height);
    ctx.textBaseline='alphabetic';
    for(const node of page.nodes){
     if(node.type==='image'){ctx.drawImage(images.get(node.src),node.x,node.y,node.width,node.height);continue;}
     let x=node.x;
     for(const run of node.runs){
      ctx.font=font(run);
      if(run.code){ctx.fillStyle='#f1f3f5';ctx.fillRect(x-2,node.y+3,run.width+4,24);}
      ctx.fillStyle=run.code?'#334155':'#20242b';ctx.fillText(run.text,x,node.y+23);
      if(run.strikethrough){ctx.fillRect(x,node.y+16,run.width,1.2);}
      x+=run.width;
     }
    }
    let src;
    try{src=await pngSource(canvas);}
    catch(error){if(attempt+1<scales.length&&/PNG 文件过大/.test(error.message))continue;throw error;}
    return {type:'image',src,width:page.pixelWidth,height:page.pixelHeight,displayWidth:page.width,displayHeight:page.height};
   }
  }finally{canvas.width=0;canvas.height=0;images.clear();}
 }
 return Object.freeze({render,layout,fitScales});
});
