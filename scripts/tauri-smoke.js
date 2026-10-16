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
