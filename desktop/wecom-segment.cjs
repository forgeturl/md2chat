const {validateParts}=require('./payload.cjs');

// WeCom chooses one clipboard representation. Copy each editable text/image
// segment separately so an image cannot hide its surrounding text on paste.
async function makeWecomSegmentData(segment,{nativeImage}={}) {
 validateParts([segment],'wecom');
 if(segment.type==='text')return {type:'text',data:{'text/plain':segment.text}};

 let image;
 try {image=nativeImage.createFromDataURL(segment.src);}
 catch {throw new Error('图片解码失败');}
 if(!image||image.isEmpty())throw new Error('图片解码失败');
 const {width,height}=image.getSize();
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw new Error('图片尺寸无效');
 if(width*height>20000000)throw new Error('图片不能超过 2000 万像素');
 const bytes=image.toPNG();
 if(!Buffer.isBuffer(bytes)||!bytes.length)throw new Error('图片转换失败');
 if(bytes.length>15*1024*1024)throw new Error('转换后的图片过大');
 return {type:'image',data:{'image/png':new Blob([bytes],{type:'image/png'})}};
}

module.exports={makeWecomSegmentData};
