(function(root){
 async function imageBlob(src,env){
  if(!/^data:image\/(png|jpe?g|gif|webp|bmp);base64,/i.test(src))throw new Error('图片尚未转换完成，请重新生成预览');
  if(/^data:image\/png;base64,/i.test(src)){
   const bytes=env.atob(src.slice(src.indexOf(',')+1));
   return new env.Blob([Uint8Array.from(bytes,c=>c.charCodeAt(0))],{type:'image/png'});
  }
  const image=new env.Image();image.src=src;await image.decode();
  if(image.naturalWidth*image.naturalHeight>20000000)throw new Error('图片过大，请缩小后重试');
  const canvas=env.document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  canvas.getContext('2d').drawImage(image,0,0);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('图片转 PNG 失败')),'image/png'));
 }
 function writeSegment(segment,env=root){
  if(segment.type==='text'){
   if(!env.navigator.clipboard?.writeText)throw new Error('浏览器不支持文字复制，请使用 HTTPS 访问并允许剪贴板权限');
   return env.navigator.clipboard.writeText(segment.text);
  }
  if(!env.navigator.clipboard?.write||!env.ClipboardItem)throw new Error('浏览器不支持图片复制，请使用新版 Chrome 并允许剪贴板权限');
  // One real PNG representation, with no competing HTML/text alternative.
  // Pass the promise immediately to keep the original click's user activation.
  const blob=imageBlob(segment.src,env);
  blob.catch(()=>{});
  return env.navigator.clipboard.write([new env.ClipboardItem({'image/png':blob})]);
 }
 const api={writeSegment};if(typeof module==='object')module.exports=api;else root.ChatClipboard=api;
})(globalThis);
