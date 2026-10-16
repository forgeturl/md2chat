const {RAW_FORMAT,pruneImages:defaultPruneImages}=require('./payload.cjs');
const {RAW_FORMAT:FEISHU_RAW_FORMAT,encodeClipboardData}=require('./feishu.cjs');

// Shared by the application and the native clipboard smoke tests.
async function writeClipboardPayload(payload,{target='dingtalk',platform=process.platform,clipboard,ClipboardItem,imageDirectory,pruneImages=defaultPruneImages}={}){
 // Keep readable text available when the target client does not import HTML.
 // Windows paragraph HTML still carries images, whose import needs client verification.
 const windowsHtml=platform==='win32'&&target==='dingtalk'&&payload.imageCount>0;
 const data={'text/plain':payload.plain,'text/html':payload.html};
 const native=platform==='darwin'&&target==='dingtalk';
 const feishuNative=platform==='darwin'&&target==='feishu';
 if(native)data[RAW_FORMAT]=new Blob([JSON.stringify(payload.rich)],{type:'application/json'});
 if(feishuNative)data[FEISHU_RAW_FORMAT]=new Blob([encodeClipboardData(payload.feishuFragment)],{type:'application/octet-stream'});
 await clipboard.write([new ClipboardItem(data)]);
 if(native&&!await clipboard.has(RAW_FORMAT))throw new Error('系统未保留钉钉图文格式');
 if(feishuNative&&!await clipboard.has(FEISHU_RAW_FORMAT))throw new Error('系统未保留飞书图文格式');
 // Clean only after the previous clipboard has been replaced successfully.
 if((platform==='win32'&&target==='dingtalk'||feishuNative)&&imageDirectory)await pruneImages(imageDirectory).catch(()=>{});
 return {images:payload.imageCount,native,target,windowsHtml,feishuNative};
}

module.exports={writeClipboardPayload};
