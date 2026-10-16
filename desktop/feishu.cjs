const path = require('node:path');
const crypto = require('node:crypto');

const FORMAT = 'org.chromium.web-custom-data';
const RAW_FORMAT = `electron application/osclipboard;format="${FORMAT}"`;
const FRAGMENT_TYPE = 'application/x-editor-kit-fragment';
const BUSINESS_TYPE = 'application/x-editor-kit-business-key';
const MAX_STRING_BYTES = 8 * 1024 * 1024;
const SIZE_ERROR = '飞书图文数据超过 8 MiB，请减少内容后重试';

function makeFragment(parts) {
 if (!Array.isArray(parts) || !parts.length) throw new Error('飞书内容为空');
 const ops = [];
 let stringBytes = 0;
 const countString = value => {
  stringBytes += Buffer.byteLength(value, 'utf16le');
  if (stringBytes > MAX_STRING_BYTES) throw new Error(SIZE_ERROR);
 };
 for (const [index, part] of parts.entries()) {
  if (index) ops.push({insert:'\n'});
  if (part?.type === 'text' && typeof part.text === 'string') {
   countString(part.text);
   const runs = Array.isArray(part.runs) && part.runs.length < 10000 &&
    part.runs.every(run => run && typeof run.text === 'string') &&
    part.runs.map(run => run.text).join('') === part.text ? part.runs : [{text:part.text}];
   for (const run of runs) {
    if (!run.text) continue;
    const attributes = {};
    for (const style of ['bold','italic','strikethrough']) {
     if (run[style] === true) attributes[style] = 'true';
    }
    ops.push(Object.keys(attributes).length ? {insert:run.text,attributes} : {insert:run.text});
   }
  } else if (part?.type === 'image') {
   if (typeof part.path !== 'string' || !path.isAbsolute(part.path)) throw new Error('飞书图片必须使用本机缓存的绝对路径');
   countString(part.path);
   const uuid = crypto.randomUUID();
   const image = {src:part.path,zoneId:'0',key:uuid,imageState:'INITIAL',width:part.width,height:part.height};
   ops.push({insert:'*',attributes:{uuid,entityType:'image',image:JSON.stringify(image)}});
  } else throw new Error('飞书内容格式错误');
 }
 return {deltas:{0:{ops,zoneId:'0',zoneType:'Z'}},editorUniqueId:crypto.randomBytes(3).toString('hex')};
}

// Chromium stores custom DataTransfer strings as a Pickle on the macOS pasteboard.
function encodeClipboardData(fragment) {
 const entries = [[BUSINESS_TYPE,'IM_CHAT'],[FRAGMENT_TYPE,JSON.stringify(fragment)]];
 if (typeof entries[1][1] !== 'string') throw new Error('飞书图文数据格式错误');
 let stringBytes = 0, payloadSize = 4;
 for (const entry of entries) for (const value of entry) {
  const length = Buffer.byteLength(value, 'utf16le');
  stringBytes += length;
  if (stringBytes > MAX_STRING_BYTES) throw new Error(SIZE_ERROR);
  payloadSize += 4 + length + ((4 - length % 4) % 4);
 }
 const buffer = Buffer.alloc(4 + payloadSize);
 buffer.writeUInt32LE(payloadSize, 0);
 buffer.writeUInt32LE(entries.length, 4);
 let offset = 8;
 for (const entry of entries) for (const value of entry) {
  buffer.writeUInt32LE(value.length, offset);
  offset += 4;
  offset += buffer.write(value, offset, 'utf16le');
  offset = Math.ceil(offset / 4) * 4;
 }
 return buffer;
}

module.exports = {FORMAT,RAW_FORMAT,FRAGMENT_TYPE,BUSINESS_TYPE,makeFragment,encodeClipboardData};
