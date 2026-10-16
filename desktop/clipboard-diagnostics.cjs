const {summarizeHtml,formatName}=require('../assets/clipboard-diagnostics.js');
const {RAW_FORMAT}=require('./payload.cjs');
const MAX_BYTES=8*1024*1024,MAX_FORMATS=100;

// Invoked only by the explicit diagnostic action. Return metadata across IPC,
// never clipboard text, HTML, image bytes, file paths, or exception messages.
async function inspectClipboard(clipboard,{platform=process.platform,version}={}) {
 const report={platform,version,formats:[],html:[],htmlImages:0,htmlTables:0,imageFormats:0,
  macDingtalk:{applicable:platform==='darwin',present:false,images:platform==='darwin'?0:null},truncated:false};
 let decodedBytes=0;
 const items=await clipboard.read();
 outer:for(const item of items)for(const type of item.types){
  if(report.formats.length>=MAX_FORMATS){report.truncated=true;break outer;}
  const format={type:formatName(type),bytes:null};report.formats.push(format);
  if(type===RAW_FORMAT)report.macDingtalk.present=true;
  try{
   const blob=await item.getType(type);
   format.bytes=Number.isSafeInteger(blob?.size)&&blob.size>=0?blob.size:null;
   if(/^image\//.test(type))report.imageFormats++;
   if(type==='text/html'||type===RAW_FORMAT&&report.macDingtalk.applicable){
    if(format.bytes===null||decodedBytes+format.bytes>MAX_BYTES){
     format.skipped=true;report.truncated=true;
     if(type===RAW_FORMAT)report.macDingtalk.images=null;
     continue;
    }
    decodedBytes+=format.bytes;
    const text=await blob.text();
    if(type==='text/html'){
     const summary=summarizeHtml(text);report.html.push(summary);
     report.htmlImages+=summary.imageCount;report.htmlTables+=summary.tableCount;
     report.truncated||=summary.truncated;
    }else{
     const rich=JSON.parse(text);
     if(!Array.isArray(rich.contents))throw new Error('Invalid private format');
     for(const content of rich.contents){
      if(!Array.isArray(content?.text?.items))continue;
      if(report.macDingtalk.images!==null)report.macDingtalk.images+=content.text.items.filter(part=>part?.type==='image').length;
     }
    }
   }
  }catch{
   format.unreadable=true;
   if(type===RAW_FORMAT&&report.macDingtalk.applicable)report.macDingtalk.images=null;
  }
 }
 return report;
}
module.exports={inspectClipboard};
