(function(root,factory){
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;else root.WecomSegments=api;
})(globalThis,root=>{
 'use strict';
 let nextId=0;
 const imageSource=/^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i;
 function snapshotParts(parts,clone=root.structuredClone){
  if(!Array.isArray(parts)||!parts.length||parts.length>500)throw new Error('企微分段内容为空或段落过多。');
  let size=0;
  for(const part of parts){
   if(part?.type==='text'&&typeof part.text==='string'&&part.text.length<=2*1024*1024)size+=part.text.length;
   else if(part?.type==='image'&&typeof part.src==='string'&&part.src.length<=15*1024*1024&&imageSource.test(part.src))size+=part.src.length;
   else throw new Error('企微分段内容无效，请重新生成预览。');
  }
  if(size>60*1024*1024)throw new Error('企微分段内容过大，请减少图片后重试。');
  const snapshot=clone(parts);
  // Separate text from adjacent image pastes without changing the editor's segments.
  snapshot.forEach((part,index)=>{
   if(part.type!=='text')return;
   const before=snapshot[index-1]?.type==='image'&&!/^\r?\n/.test(part.text)?'\n':'';
   const after=snapshot[index+1]?.type==='image'&&!part.text.endsWith('\n')?'\n':'';
   if(!before&&!after)return;
   if(Array.isArray(part.runs)&&part.runs.every(run=>run&&typeof run.text==='string')&&part.runs.map(run=>run.text).join('')===part.text){
    part.runs=[...(before?[{text:before}]:[]),...part.runs,...(after?[{text:after}]:[])];
   }
   part.text=before+part.text+after;
  });
  return snapshot;
 }
 function create({copySegment},env=root){
  if(typeof copySegment!=='function')throw new Error('企微分段复制暂不可用。');
  const document=env.document;
  let current=null;
  function element(tag,className,text){
   const node=document.createElement(tag);
   if(className)node.className=className;
   if(text!==undefined)node.textContent=text;
   return node;
  }
  function dispose(view){
   if(current!==view)return;
   current=null;
   const panel=view.panel;
   view.parts=[];view.buttons=[];view.status=null;view.panel=null;
   if(panel.open)panel.close();
   panel.replaceChildren();panel.remove();
  }
  function close(){if(current)dispose(current);}
  async function copy(view,index){
   if(current!==view||view.busy)return;
   view.busy=true;
   for(const button of view.buttons)button.disabled=true;
   view.status.classList.remove('is-error');
   view.status.textContent='正在复制第 '+(index+1)+'/'+view.parts.length+' 段…';
   try{
    // Invoke during the button click, before any await, to retain browser user activation.
    const result=copySegment(view.parts[index]);
    await result;
    if(current!==view)return;
    view.buttons[index].textContent='已复制，可再复制';
    view.buttons[index].classList.add('is-copied');
    view.status.textContent='已复制第 '+(index+1)+'/'+view.parts.length+' 段，请到企微粘贴后再继续。';
   }catch(error){
    if(current!==view)return;
    const reason=typeof error?.message==='string'?error.message.slice(0,500):'剪贴板访问未完成';
    view.status.classList.add('is-error');
    view.status.textContent='第 '+(index+1)+' 段复制失败：'+reason+'。请重试。';
   }finally{
    if(current===view){view.busy=false;for(const button of view.buttons)button.disabled=false;}
   }
  }
  function open(parts){
   if(current)throw new Error('请先关闭当前企微分段窗口，再打开新的转换内容。');
   const snapshot=snapshotParts(parts,env.structuredClone||root.structuredClone);
   const panel=element('dialog','wecom-segments-dialog');
   const title=element('h2','','企微分段复制');title.id='wecom-segments-title-'+(++nextId);
   panel.setAttribute('aria-labelledby',title.id);
   const heading=element('div','wecom-segments-heading');
   const closeButton=element('button','wecom-segments-close','关闭');closeButton.type='button';
   closeButton.setAttribute('aria-label','关闭企微分段窗口');closeButton.addEventListener('click',()=>dispose(view));
   heading.append(title,closeButton);
   const instruction=element('p','wecom-segments-instruction','企微图文需按编号逐段复制，再到企微按顺序粘贴。文字保持可编辑；每粘贴一段后，再回来复制下一段。');
   instruction.id=title.id+'-instruction';panel.setAttribute('aria-describedby',instruction.id);
   const note=element('p','help wecom-segments-note','文字按纯文本粘贴，粗体等样式可能不保留。不自动发送消息。');
   const list=element('ol','wecom-segments-list');
   const status=element('p','wecom-segments-status','共 '+snapshot.length+' 段，请从第 1 段开始复制。');
   status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
   const view={panel,parts:snapshot,buttons:[],status,busy:false};
   snapshot.forEach((part,index)=>{
    const kind=part.type==='text'?'文字':'图片';
    const card=element('li','wecom-segment-card'),header=element('div','wecom-segment-heading');
    const label=element('h3','','第 '+(index+1)+' 段 · '+kind);
    const button=element('button','','复制'+kind);button.type='button';
    button.setAttribute('aria-label','复制第'+(index+1)+'段'+kind);
    button.addEventListener('click',()=>{void copy(view,index);});
    header.append(label,button);card.append(header);view.buttons.push(button);
    if(part.type==='text')card.append(element('pre','wecom-segment-text',part.text));
    else{
     const image=element('img','wecom-segment-image');image.src=part.src;image.alt='第 '+(index+1)+' 段图片';
     card.append(image);
    }
    list.append(card);
   });
   const footer=element('div','wecom-segments-footer');footer.append(status);
   panel.append(heading,instruction,note,list,footer);
   panel.addEventListener('cancel',event=>{event.preventDefault();dispose(view);});
   panel.addEventListener('close',()=>dispose(view));
   document.body.append(panel);current=view;
   try{panel.showModal();}catch(error){dispose(view);throw error;}
  }
  return Object.freeze({open,close,get isOpen(){return current!==null;}});
 }
 return {create,snapshotParts};
});
