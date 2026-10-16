const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const {constants} = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {profile} = require('../assets/chat-targets.js');
const {makeWecomSegmentData} = require('./wecom-segment.cjs');

async function makeClipboardImageData(parts, {nativeImage}) {
 if (!Array.isArray(parts) || parts.length !== 1 || parts[0]?.type !== 'image' || typeof parts[0].src !== 'string' || !parts[0].src.startsWith('data:image/png;base64,')) throw new Error('转图片未生成完整的 PNG，请重试。');
 return (await makeWecomSegmentData(parts[0], {nativeImage})).data;
}

// Resolve only the exact cache URLs emitted by our Windows DingTalk payload.
// Other file references remain unsupported; clipboard HTML cannot select a disk path.
async function resolveCachedHtmlImages(html, {imageDirectory, onImage} = {}) {
 if(typeof html!=='string'||Buffer.byteLength(html)>8*1024*1024)throw new Error('剪贴板 HTML 过长，请分段转换。');
 if(!imageDirectory)return html;
 const directory=path.resolve(imageDirectory),prefix=pathToFileURL(directory+path.sep).href.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const chunks=[];let position=0,total=0,checkedDirectory=false;
 for(const match of html.matchAll(/<img src="([^"]*)"/g)){
  const src=match[1];if(!src.startsWith(prefix))continue;
  const filename=src.slice(prefix.length);
  if(!/^[a-f0-9]{64}\.png$/.test(filename))throw new Error('缓存图片路径无效，请重新复制原内容。');
  if(!checkedDirectory){
   let stat;try{stat=await fs.lstat(directory);}catch{throw new Error('缓存图片目录已失效，请重新复制原内容。');}
   if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('缓存图片目录无效，请重新复制原内容。');
   checkedDirectory=true;
  }
  const file=path.join(directory,filename);let stat;
  try{stat=await fs.lstat(file);}catch{throw new Error('缓存图片已失效，请重新复制原内容。');}
  if(stat.isSymbolicLink()||!stat.isFile())throw new Error('缓存图片不能是符号链接或其他非普通文件。');
  if(stat.size>15*1024*1024)throw new Error('缓存图片不能超过 15 MB。');
  total+=stat.size;if(total>60*1024*1024)throw new Error('剪贴板图文过大，请分段转换。');
  let handle,bytes;
  try{handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));}catch{throw new Error('缓存图片无法安全读取，请重新复制原内容。');}
  try{
   const opened=await handle.stat();
   if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size)throw new Error('缓存图片在读取期间已更新，请重新复制原内容。');
   // Read at most the checked size plus one byte, even if another process grows the file.
   const buffer=Buffer.alloc(stat.size+1);let length=0;
   while(length<buffer.length){const result=await handle.read(buffer,length,buffer.length-length,null);if(!result.bytesRead)break;length+=result.bytesRead;}
   if(length!==stat.size)throw new Error('缓存图片在读取期间已更新，请重新复制原内容。');
   bytes=buffer.subarray(0,length);
  }finally{await handle.close();}
  if(bytes.length<8||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw new Error('缓存图片数据不是 PNG，请重新复制原内容。');
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==filename.slice(0,-4))throw new Error('缓存图片校验失败，请重新复制原内容。');
  if(onImage)await onImage(bytes,filename);
  chunks.push(html.slice(position,match.index),'<img src="data:image/png;base64,'+bytes.toString('base64')+'"');
  position=match.index+match[0].length;
 }
 return chunks.length?chunks.join('')+html.slice(position):html;
}

// Read only the standard representations used by the converter, on an explicit menu click.
async function readClipboardSource(clipboard, {imageDirectory} = {}) {
 const items = await clipboard.read();
 if (items.length > 500) throw new Error('剪贴板内容过多，请分段转换。');
 const hash = crypto.createHash('sha256'), content = [];
 let total = 0;
 for (const item of items) {
  const types = [...item.types].sort();
  hash.update(JSON.stringify(types));
  const entry = {plain: '', html: '', images: []};
  const imageType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].find(type => types.includes(type));
  if (!imageType && types.includes('text/uri-list') && types.some(type => type.includes('WWKPrivatePBDataKey_Rich'))) throw new Error('这份企微剪贴板中的图片只有文件引用，无法直接转换。请复制 Markdown，或单独复制图片本身后重试。');
  for (const type of ['text/plain', 'text/html', imageType].filter(type => type && types.includes(type))) {
   const blob = await item.getType(type);
   total += blob.size;
   if (total > 60 * 1024 * 1024) throw new Error('剪贴板图文过大，请分段转换。');
   if (type.startsWith('image/') && blob.size > 10 * 1024 * 1024) throw new Error('单张图片不能超过 10 MB。');
   if (type.startsWith('text/') && blob.size > 8 * 1024 * 1024) throw new Error('剪贴板文字过长，请分段转换。');
   const bytes = Buffer.from(await blob.arrayBuffer());
   hash.update(JSON.stringify([type, bytes.length]));hash.update(bytes);
   if (type === 'text/plain') entry.plain = bytes.toString('utf8');
   else if (type === 'text/html') entry.html = await resolveCachedHtmlImages(bytes.toString('utf8'),{imageDirectory,onImage:(image,filename)=>{
    total+=image.length;if(total>60*1024*1024)throw new Error('剪贴板图文过大，请分段转换。');
    hash.update(JSON.stringify(['cached-image',filename,image.length]));hash.update(image);
   }});
   else entry.images.push('data:' + type + ';base64,' + bytes.toString('base64'));
  }
  content.push(entry);
 }
 return {content, fingerprint: hash.digest('hex')};
}

function createClipboardConversion({clipboard, imageDirectory, render, prepare, write, isCopying = () => false}) {
 let busy = false;
 return {
  get busy() {return busy;},
  async convert(target) {
   if (target !== 'image') profile(target);
   if (busy || isCopying()) throw new Error('正在转换或复制，请稍候再试。');
   busy = true;
   try {
    const source = await readClipboardSource(clipboard,{imageDirectory});
    if (!source.content.some(item => item.plain.trim() || item.html.trim() || item.images.length)) throw new Error('剪贴板中没有可转换的文字或图片，请先复制 Markdown 或图文。');
    const parts = await render(source.content, target);
    const payload = await prepare(parts, target);
    // Rendering can take seconds. Preserve anything copied while it was running.
    const current = await readClipboardSource(clipboard,{imageDirectory});
    if (current.fingerprint !== source.fingerprint) throw new Error('转换期间剪贴板已更新，已保留新内容。请重新选择转换格式。');
    return await write(payload, target);
   } finally {busy = false;}
  }
 };
}

// Only the trusted editor frame can answer a request; late replies cannot complete a newer one.
function createConversionBridge({ipcMain, trusted, getWebContents, timeoutMs = 60000}) {
 let ready = false, pending, nextId = 0;
 function finish(error, parts) {
  if (!pending) return;
  const request = pending;pending = null;clearTimeout(request.timer);
  if (error) request.reject(error);else request.resolve(parts);
 }
 function dispatch() {
  if (!ready || !pending || pending.sent) return;
  const contents = getWebContents();
  if (!contents || contents.isDestroyed()) return finish(new Error('转换窗口不可用，请重新打开 md2chat。'));
  pending.sent = true;
  try {contents.send(pending.channel, {id: pending.id, ...pending.data});}
  catch {finish(new Error('无法启动转换，请重试。'));}
 }
 const onReady = event => {try {trusted(event);} catch {return;}ready = true;dispatch();};
 const onResult = (event, id, result) => {
  try {trusted(event);} catch {return;}
  if (!pending || !pending.sent || pending.id !== id) return;
  if (typeof result?.error === 'string') finish(new Error(result.error.slice(0, 500)));
  else finish(null, result?.parts);
 };
 ipcMain.on('md2chat:conversion-ready', onReady);
 ipcMain.on('md2chat:conversion-result', onResult);
 function request(channel, data) {
  if (pending) return Promise.reject(new Error('正在转换，请稍候。'));
  return new Promise((resolve, reject) => {
   pending = {id: ++nextId, channel, data, resolve, reject};
   pending.timer = setTimeout(() => finish(new Error('转换超时，请减少内容后重试。')), timeoutMs);
   dispatch();
  });
 }
 return {
  render(content, target) {return request('md2chat:convert-clipboard', {content, target});},
  openWecomSegments(parts) {return request('md2chat:open-wecom-segments', {parts});},
  reset(message = '转换窗口已重新加载，请重试。') {ready = false;finish(new Error(message));},
  destroy() {this.reset();ipcMain.removeListener('md2chat:conversion-ready', onReady);ipcMain.removeListener('md2chat:conversion-result', onResult);}
 };
}
module.exports = {readClipboardSource, resolveCachedHtmlImages, createClipboardConversion, createConversionBridge, makeClipboardImageData};
