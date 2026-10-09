/* Local-only SVG renderers. Libraries are loaded lazily from this site's assets. */
(function(root){
 const assetBase=new URL('./vendor/',document.currentScript.src);
 const loading=new Map(),cache=new Map();let serial=Promise.resolve(),nextId=0;
 function load(name){
  if(!loading.has(name))loading.set(name,new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=new URL(name,assetBase).href;
   script.onload=resolve;script.onerror=()=>{loading.delete(name);reject(new Error('渲染器加载失败，请刷新页面重试'));};document.head.appendChild(script);
  }));return loading.get(name);
 }
 async function mathEngine(){
  if(!loading.has('mathjax/tex-svg.js'))root.MathJax={startup:{typeset:false},tex:{packages:['base','ams'],maxBuffer:10000,maxMacros:1000},svg:{fontCache:'local'}};
  await load('mathjax/tex-svg.js');await root.MathJax.startup.promise;return root.MathJax;
 }
 async function diagramEngine(){
  await load('mermaid/mermaid.min.js');
  root.mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:'default',htmlLabels:false,fontFamily:'Arial, sans-serif',maxTextSize:30000,maxEdges:300,flowchart:{htmlLabels:false,useMaxWidth:false},secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','htmlLabels','flowchart','themeCSS']});
  return root.mermaid;
 }
 function cleanSVG(svg){
  if(svg.querySelector('foreignObject'))throw new Error('此图包含暂不支持的 HTML 标签，请改用普通文字标签');
  for(const node of svg.querySelectorAll('script,iframe,object,embed,image'))node.remove();
  for(const node of [svg,...svg.querySelectorAll('*')]){
   for(const attr of [...node.attributes]){
    if(/^on/i.test(attr.name)||((attr.localName==='href'||attr.name==='src')&&!attr.value.startsWith('#')))node.removeAttributeNode(attr);
    else if(/url\(\s*["']?(?!#)/i.test(attr.value)&&!/^url\(\s*["']?#/.test(attr.value))throw new Error('图表包含外部资源引用');
   }
  }
  for(const style of svg.querySelectorAll('style'))if(/@import|https?:|data:|file:|javascript:/i.test(style.textContent))throw new Error('图表包含外部样式引用');
 }
 async function raster(svg,width,height,padding){
  cleanSVG(svg);
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('无法确定渲染尺寸');
  const ratio=Math.min(1,1100/width);width=Math.ceil(width*ratio);height=Math.ceil(height*ratio);
  if(height>5000||(width+padding*2)*(height+padding*2)*4>20000000)throw new Error('渲染结果过大，请拆分内容');
  svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.style.maxWidth='none';svg.style.width=width+'px';svg.style.height=height+'px';svg.style.color='#202938';
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
  try{
   const image=new Image();image.src=url;await image.decode();
   const displayWidth=width+padding*2,displayHeight=height+padding*2;
   const canvas=document.createElement('canvas');canvas.width=displayWidth*2;canvas.height=displayHeight*2;
   const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,displayWidth,displayHeight);ctx.drawImage(image,padding,padding,width,height);
   return {src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,displayWidth,displayHeight};
  }finally{URL.revokeObjectURL(url);}
 }
 async function run(type,source,display){
  if(type==='math'&&(source.length>10000||/\\(?:require|href|url|includegraphics)\b/.test(source)))throw new Error('公式过长或含不支持的外部资源命令');
  if(type==='mermaid'&&(source.length>30000||/%%\s*\{|^\s*---|(?:https?|data|file|javascript):|\b(?:img|image)\s*:/i.test(source)))throw new Error('图表过长或含配置/外部资源；请使用不带配置的 Mermaid 源码');
  const holder=document.createElement('div');holder.style.cssText='position:fixed;left:-20000px;top:0;width:1100px;font-size:20px;pointer-events:none';holder.setAttribute('aria-hidden','true');document.body.appendChild(holder);
  try{
   if(type==='math'){
    const engine=await mathEngine(),container=await engine.tex2svgPromise(source,{display});
    const bad=container.querySelector('[data-mjx-error]');if(bad)throw new Error('公式语法错误：'+bad.getAttribute('data-mjx-error'));
    holder.appendChild(container);const svg=container.querySelector('svg');if(!svg)throw new Error('公式未生成图像');
    const size=svg.getBoundingClientRect();return await raster(svg,size.width,size.height,display?10:2);
   }
   const engine=await diagramEngine(),result=await engine.render('md2chat-diagram-'+(++nextId),source,holder);
   const doc=new DOMParser().parseFromString(result.svg,'image/svg+xml');const svg=doc.documentElement;
   if(svg.localName!=='svg'||doc.querySelector('parsererror'))throw new Error('图表生成了无效 SVG');
   const box=(svg.getAttribute('viewBox')||'').split(/[ ,]+/).map(Number);return await raster(svg,box[2],box[3],12);
  }finally{holder.remove();}
 }
 function render(type,source,display=true){
  const key=type+'|'+display+'|'+source;
  if(cache.has(key))return cache.get(key);
  const result=serial.then(()=>run(type,source,display));serial=result.catch(()=>{});cache.set(key,result);
  result.catch(()=>cache.delete(key));if(cache.size>24)cache.delete(cache.keys().next().value);return result;
 }
 root.ChatRenderers={math:(tex,display=true)=>render('math',tex,display),mermaid:source=>render('mermaid',source),code:async(source,language)=>{
  await load('highlight/highlight.min.js');return root.CodeImages.render(source,language,root.hljs);
 }};
})(globalThis);
