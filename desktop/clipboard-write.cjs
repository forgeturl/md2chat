const {RAW_FORMAT,pruneImages:defaultPruneImages}=require('./payload.cjs');

// Shared by the application and the Windows native clipboard smoke test.
async function writeClipboardPayload(payload,{target='dingtalk',platform=process.platform,clipboard,ClipboardItem,imageDirectory,pruneImages=defaultPruneImages}={}){
 // Keep readable text available when the target client does not import HTML.
 // Windows paragraph HTML still carries images, whose import needs client verification.
 const windowsHtml=platform==='win32'&&target==='dingtalk'&&payload.imageCount>0;
 const data={'text/plain':payload.plain,'text/html':payload.html};
 const native=platform==='darwin'&&target==='dingtalk';
 if(native)data[RAW_FORMAT]=new Blob([JSON.stringify(payload.rich)],{type:'application/json'});
 await clipboard.write([new ClipboardItem(data)]);
 if(native&&!await clipboard.has(RAW_FORMAT))throw new Error('系统未保留钉钉图文格式');
 // Clean only after the previous clipboard has been replaced successfully.
 if(platform==='win32'&&target==='dingtalk'&&imageDirectory)await pruneImages(imageDirectory).catch(()=>{});
 return {images:payload.imageCount,native,target,windowsHtml};
}

module.exports={writeClipboardPayload};
