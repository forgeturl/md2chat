const fs=require('node:fs/promises');
const {constants}=require('node:fs');
const path=require('node:path');
const {fileURLToPath}=require('node:url');
const MAX_BYTES=10*1024*1024;

function localImagePath(source,{platform=process.platform}={}){
 if(typeof source!=='string'||!source||source.length>8192||/[\x00-\x1f\x7f]/.test(source))throw new Error('路径无效。');
 const windows=platform==='win32';let filename=source;
 if(/^file:/i.test(source)){
  try{
   const url=new URL(source);
   if(url.protocol!=='file:'||url.host||url.username||url.password||url.search||url.hash)throw new Error();
   filename=fileURLToPath(url,{windows});
  }catch{throw new Error('路径无效。');}
 }
 if(/[\x00-\x1f\x7f]/.test(filename)||!(windows?/^[a-z]:[\\/]/i.test(filename):filename.startsWith('/'))||/^(?:\/\/|\\\\)/.test(filename))throw new Error('路径无效。');
 return (windows?path.win32:path.posix).normalize(filename);
}
function imageMime(bytes){
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
 if(bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.length>=6&&['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))return 'image/gif';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 if(bytes.length>=2&&bytes[0]===0x42&&bytes[1]===0x4d)return 'image/bmp';
 throw new Error('不支持的图片格式。');
}
async function readLocalImage(source,{nativeImage}={}){
 const filename=localImagePath(source);let handle;
 try{
  const stat=await fs.lstat(filename);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('不是普通图片文件。');
  if(stat.size>MAX_BYTES)throw new Error('超过 10 MB。');
  handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));
  const opened=await handle.stat();
  if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw new Error('文件已更新，请重试。');
  const buffer=Buffer.alloc(stat.size+1);let length=0;
  while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}
  const after=await handle.stat();
  if(length!==stat.size||after.size!==stat.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)throw new Error('文件已更新，请重试。');
  const bytes=buffer.subarray(0,length),mime=imageMime(bytes),image=nativeImage.createFromBuffer(bytes);
  if(image.isEmpty())throw new Error('图片数据损坏。');
  const {width,height}=image.getSize();
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0)throw new Error('图片尺寸无效。');
  if(width*height>20000000)throw new Error('超过 2000 万像素。');
  return 'data:'+mime+';base64,'+bytes.toString('base64');
 }catch(error){
  if(error.code==='ENOENT'||error.code==='ENOTDIR')throw new Error('文件不存在。');
  if(error.code==='EACCES'||error.code==='EPERM')throw new Error('无读取权限。');
  if(error.code)throw new Error('读取失败。');
  throw error;
 }finally{await handle?.close();}
}
module.exports={localImagePath,readLocalImage};
