(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ClipboardSource=api;})(globalThis,()=>{
 async function toSource({plain='',html='',images=[]}={}, {registerImage,htmlToSource}={}){
  let source=plain,htmlImages=[];
  if(html){
   const template=document.createElement('template');template.innerHTML=html;
   htmlImages=[...template.content.querySelectorAll('img')];
   if(htmlImages.length){
    let index=0;
    const addImage=src=>{const selected=images.length===htmlImages.length?images[index]:src;index++;return registerImage(selected);};
    const placeholders=plain.match(/\[图片\]/g)||[];
    if(placeholders.length===htmlImages.length)source=plain.replace(/\[图片\]/g,()=>addImage(htmlImages[index]?.getAttribute('src')||''));
    else source=await htmlToSource(html,addImage);
   }else if(!plain.trim())source=await htmlToSource(html,registerImage);
  }
  if(!htmlImages.length){
   for(const src of images){const token=registerImage(src);source=source.includes('[图片]')?source.replace('[图片]',()=>token):source+'\n'+token;}
  }
  if(/^\s*\[图片\]\s*$/m.test(source))throw new Error('输入中只有 [图片] 占位符，没有对应图片数据。请重新复制完整图文或粘贴图片本身。');
  return source.trim()?source:'';
 }
 return {toSource};
});
