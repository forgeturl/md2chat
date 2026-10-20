(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ClipboardDiagnostics=api;})(globalThis,()=>{
 const MAX_INPUT=8*1024*1024,MAX_IMAGES=20,MAX_ATTRIBUTES=128,MAX_ANCESTORS=256;
 const STANDARD_TAGS=new Set(('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr acronym applet big center dir font frame frameset marquee noembed noframes param plaintext strike tt xmp').split(' '));
 const VOID_TAGS=new Set('area base br col embed hr img input link meta param source track wbr frame'.split(' '));
 const RAW_TAGS=new Set('script style textarea title xmp iframe noembed noframes noscript plaintext'.split(' '));
 const IMAGE_ATTRIBUTES=new Set(('src srcset sizes width height alt title class id style align border hspace vspace loading decoding crossorigin referrerpolicy usemap ismap role aria-label aria-hidden draggable contenteditable data-type data-media-id data-mediaid data-image-id data-imageid data-src data-width data-height data-auth-media-id data-authmediaid data-original data-original-src data-lazy-src data-mime data-size data-file-id data-fileid data-name data-url data-ding-type data-ding-image data-dingtalk-id data-node-type').split(' '));
 const MIME_TYPES=new Set('image/png image/jpeg image/gif image/webp image/bmp image/tiff image/svg+xml image/avif image/x-icon image/vnd.microsoft.icon'.split(' '));
 const SOURCE_KINDS=new Set('data https http file blob cid relative empty other'.split(' '));
 const STANDARD_FORMATS=new Set([...('text/plain text/html text/rtf text/uri-list image/png image/jpeg image/gif image/webp image/bmp image/tiff image/svg+xml application/bookmark'.split(' ')),'electron application/bookmark']);
 const NATIVE_FORMATS=new Set(['HTML Format','com.dingtalk.richTextAttributedString']);
 const ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",colon:':',sol:'/',bsol:'\\',quest:'?',num:'#',equals:'=',semi:';',comma:',',percnt:'%',plus:'+',period:'.',Tab:'\t',NewLine:'\n',nbsp:'\u00a0'};
 const safeCount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.min(Math.floor(value),MAX_INPUT):0;
 const safeDimension=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000?value:null;
 const safeTag=name=>STANDARD_TAGS.has(name)?name:'other';
 const safeAttribute=name=>IMAGE_ATTRIBUTES.has(name)?name:'other';
 const isSpace=character=>character===' '||character==='\t'||character==='\r'||character==='\n'||character==='\f';

 function formatName(type){
  if(typeof type!=='string')return '其他格式';
  if(STANDARD_FORMATS.has(type))return type;
  if(NATIVE_FORMATS.has(type))return type;
  for(const name of NATIVE_FORMATS){
   for(const prefix of ['application/osclipboard;format="','electron application/osclipboard;format="']){
    const known=prefix+name+'"';if(type===known)return known;
   }
  }
  return /^(?:electron )?application\/osclipboard\b/.test(type)?'其他系统格式':'其他格式';
 }

 function decodeEntities(value){
  return value.replace(/&(#(?:x[0-9a-f]{1,8}|[0-9]{1,10})|[a-z][a-z0-9]{0,15});/gi,(_,entity)=>{
   if(entity[0]==='#'){
    const hex=entity[1]?.toLowerCase()==='x',number=parseInt(entity.slice(hex?2:1),hex?16:10);
    return number>0&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff)?String.fromCodePoint(number):'\ufffd';
   }
   return Object.prototype.hasOwnProperty.call(ENTITIES,entity)?ENTITIES[entity]:_;
  });
 }

 function dataBytes(value,base64){
  if(base64){
   let length=0,padding=0,ended=false;
   for(let index=0;index<value.length;index++){
    const character=value[index];if(isSpace(character))continue;
    if(character==='='){ended=true;padding++;if(padding>2)return null;}
    else if(ended||!/[a-z0-9+/]/i.test(character))return null;
    length++;
   }
   if(!length)return 0;
   if(length%4===1||(padding&&length%4!==0))return null;
   return Math.floor(length*3/4)-padding;
  }
  let bytes=0;
  for(let index=0;index<value.length;index++){
   const code=value.charCodeAt(index);
   if(value[index]==='%'){
    if(!/^[0-9a-f]{2}$/i.test(value.slice(index+1,index+3)))return null;
    bytes++;index+=2;
   }else if(code<0x80)bytes++;
   else if(code<0x800)bytes+=2;
   else if(code>=0xd800&&code<=0xdbff&&value.charCodeAt(index+1)>=0xdc00&&value.charCodeAt(index+1)<=0xdfff){bytes+=4;index++;}
   else bytes+=3;
  }
  return bytes;
 }

 function sourceSummary(value){
  const source={kind:'empty',query:false,fragment:false,mime:'other',base64:false,bytes:null};
  if(typeof value!=='string')return source;
  const decoded=decodeEntities(value).trim().replace(/[\t\r\n]/g,'');
  if(!decoded)return source;
  source.query=decoded.includes('?');source.fragment=decoded.includes('#');
  const scheme=/^([a-z][a-z0-9+.-]*):/i.exec(decoded);
  const schemeName=scheme?scheme[1].toLowerCase():'';
  source.kind=scheme?(['data','https','http','file','blob','cid'].includes(schemeName)?schemeName:'other'):'relative';
  if(source.kind==='data'){
   const comma=decoded.indexOf(',');if(comma<0)return source;
   const header=decoded.slice(5,comma),mime=header.split(';',1)[0].toLowerCase();
   source.mime=MIME_TYPES.has(mime)?mime:'other';source.base64=/(?:^|;)base64(?:;|$)/i.test(header);
   source.bytes=dataBytes(decoded.slice(comma+1),source.base64);
  }
  return source;
 }

 function dimension(value){
  if(typeof value!=='string')return null;
  const decoded=decodeEntities(value).trim();
  return /^\d+(?:\.\d+)?(?:px)?$/i.test(decoded)?safeDimension(Number(decoded.replace(/px$/i,''))):null;
 }

 // Lexical scanning never creates DOM nodes, loads resources or executes source.
 function tagEnd(html,start){
  let quote='';
  for(let index=start;index<html.length;index++){
   const character=html[index];
   if(quote){if(character===quote)quote='';}
   else if(character==='"'||character==="'")quote=character;
   else if(character==='>')return index;
  }
  return -1;
 }

 function attributes(html,start,end,summary){
  const values=Object.create(null),names=[],seen=new Set();let count=0,index=start;
  while(index<end){
   while(index<end&&(isSpace(html[index])||html[index]==='/'))index++;
   if(index>=end)break;
   const nameStart=index;
   while(index<end&&!isSpace(html[index])&&!['=','/','>'].includes(html[index]))index++;
   if(index===nameStart){index++;continue;}
   const nameLength=index-nameStart,name=nameLength<=64?html.slice(nameStart,index).toLowerCase():'other';
   while(index<end&&isSpace(html[index]))index++;
   let valueStart=index,valueEnd=index;
   if(html[index]==='='){
    index++;while(index<end&&isSpace(html[index]))index++;
    if(html[index]==='"'||html[index]==="'"){
     const quote=html[index++];valueStart=index;
     while(index<end&&html[index]!==quote)index++;
     valueEnd=index;if(index<end)index++;
    }else{
     valueStart=index;while(index<end&&!isSpace(html[index]))index++;valueEnd=index;
    }
   }
   count++;if(count>MAX_ATTRIBUTES||nameLength>64){summary.truncated=true;if(count>MAX_ATTRIBUTES)continue;}
   const safeName=safeAttribute(name);
   if(!seen.has(safeName)){seen.add(safeName);names.push(safeName);}
   if(['src','width','height','srcset'].includes(name)&&!Object.prototype.hasOwnProperty.call(values,name))values[name]=html.slice(valueStart,valueEnd);
  }
  return {values,names};
 }

 function summarizeHtml(input){
  if(typeof input!=='string')throw new TypeError('HTML must be a string');
  const summary={images:[],imageCount:0,tableCount:0,tags:{},fragment:{start:false,end:false},truncated:input.length>MAX_INPUT};
  const html=input.slice(0,MAX_INPUT),ancestors=[];let index=0;
  while(index<html.length){
   const opening=html.indexOf('<',index);if(opening<0)break;index=opening;
   if(html.startsWith('<!--',index)){
    const close=html.indexOf('-->',index+4);if(close<0)break;
    const body=html.slice(index+4,Math.min(close,index+40)).trim();
    if(close-index<=36&&body==='StartFragment')summary.fragment.start=true;
    if(close-index<=36&&body==='EndFragment')summary.fragment.end=true;
    index=close+3;continue;
   }
   if(html[index+1]==='!'||html[index+1]==='?'){
    const close=tagEnd(html,index+2);if(close<0)break;index=close+1;continue;
   }
   const closing=html[index+1]==='/',nameStart=index+(closing?2:1);let nameEnd=nameStart;
   if(!/[a-z]/i.test(html[nameStart]||'')){index++;continue;}
   while(nameEnd<html.length&&/[a-z0-9:_-]/i.test(html[nameEnd]))nameEnd++;
   if(nameEnd<html.length&&!isSpace(html[nameEnd])&&!['/','>'].includes(html[nameEnd])){index++;continue;}
   const close=tagEnd(html,nameEnd);if(close<0)break;
   const nameLength=nameEnd-nameStart,name=nameLength<=128?html.slice(nameStart,nameEnd).toLowerCase():'other';
   if(nameLength>128)summary.truncated=true;
   index=close+1;
   if(closing){
    let last=ancestors.length-1;while(last>=0&&ancestors[last].name!==name)last--;if(last>=0)ancestors.length=last;
    continue;
   }
   const tag=safeTag(name);summary.tags[tag]=(summary.tags[tag]||0)+1;
   if(name==='table')summary.tableCount++;
   if(name==='img'){
    summary.imageCount++;
    if(summary.images.length<MAX_IMAGES){
     const {values,names}=attributes(html,nameEnd,close,summary);
     summary.images.push({source:sourceSummary(values.src),attributes:names,width:dimension(values.width),height:dimension(values.height),ancestors:ancestors.slice(-4).reverse().map(entry=>entry.tag),srcset:Object.prototype.hasOwnProperty.call(values,'srcset')});
    }else summary.truncated=true;
   }
   if(RAW_TAGS.has(name)){
    if(name==='plaintext')break;
    const endPattern=new RegExp('</'+name+'(?=[\\t\\n\\f\\r />])','gi');endPattern.lastIndex=index;
    const match=endPattern.exec(html);if(!match)break;
    const rawEnd=tagEnd(html,match.index+name.length+2);if(rawEnd<0)break;index=rawEnd+1;
    continue;
   }
   if(!VOID_TAGS.has(name)){
    if(ancestors.length===MAX_ANCESTORS){ancestors.shift();summary.truncated=true;}
    ancestors.push({name,tag});
   }
  }
  return summary;
 }

 function htmlLines(summary){
  summary=summary&&typeof summary==='object'?summary:{};
  const fragment=summary.fragment||{},tags=summary.tags&&typeof summary.tags==='object'?summary.tags:{};
  const tagCounts=Object.entries(tags).filter(([name,count])=>(STANDARD_TAGS.has(name)||name==='other')&&safeCount(count)>0).slice(0,STANDARD_TAGS.size+1).map(([name,count])=>name+'='+safeCount(count));
  const lines=['HTML 图片标签：'+safeCount(summary.imageCount)+'；HTML 表格：'+safeCount(summary.tableCount),'HTML 片段标记：StartFragment '+(fragment.start===true?'有':'无')+'；EndFragment '+(fragment.end===true?'有':'无'),'HTML 结构计数：'+(tagCounts.join('，')||'无')];
  const images=Array.isArray(summary.images)?summary.images.slice(0,MAX_IMAGES):[];
  images.forEach((image,index)=>{
   image=image&&typeof image==='object'?image:{};const source=image.source&&typeof image.source==='object'?image.source:{};
   const kind=SOURCE_KINDS.has(source.kind)?source.kind:'other',mime=MIME_TYPES.has(source.mime)?source.mime:'other';
   const names=Array.isArray(image.attributes)?[...new Set(image.attributes.slice(0,MAX_ATTRIBUTES).map(safeAttribute))]:[];
   const ancestry=Array.isArray(image.ancestors)?image.ancestors.slice(0,4).map(safeTag):[];
   const width=safeDimension(image.width),height=safeDimension(image.height);
   lines.push('图片 '+(index+1)+'：src='+kind+'；查询参数 '+(source.query===true?'有':'无')+'；片段 '+(source.fragment===true?'有':'无')+'；srcset '+(image.srcset===true?'有':'无'));
   if(kind==='data')lines.push('  data MIME='+mime+'；base64 '+(source.base64===true?'是':'否')+'；解码字节 '+(typeof source.bytes==='number'&&Number.isFinite(source.bytes)&&source.bytes>=0?safeCount(source.bytes):'未知'));
   lines.push('  尺寸属性：'+(width===null?'未知':width)+' × '+(height===null?'未知':height)+'；属性名：'+(names.join(', ')||'无')+'；祖先（近→远）：'+(ancestry.join(' > ')||'无'));
  });
  if(summary.truncated===true)lines.push('HTML 诊断已截断：最多扫描 8 MiB 字符、列出 20 张图片；属性和嵌套深度也有上限。');
  return lines;
 }

 // Preserve actual attributes, including chat-client JSON trees, as inert diagnostic data.
 function htmlDetails(input){
  const html=input.slice(0,MAX_INPUT),tags=[];let index=0,truncated=input.length>MAX_INPUT;
  const pattern=/([a-z_:][a-z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
  while(index<html.length){
   const start=html.indexOf('<',index);if(start<0)break;
   if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);if(end<0)break;index=end+3;continue;}
   const match=/^<(\/?)([a-z][a-z0-9:_-]*)(?=[\s/>])/i.exec(html.slice(start,start+256));
   if(!match){index=start+1;continue;}
   const end=tagEnd(html,start+match[0].length);if(end<0)break;
   index=end+1;const name=match[2].toLowerCase(),closing=!!match[1],attributes=[];
   if(!closing){
    pattern.lastIndex=0;const source=html.slice(start+match[0].length,end);let attribute;
    while((attribute=pattern.exec(source))){
     if(attributes.length===MAX_ATTRIBUTES){truncated=true;break;}
     const value=decodeEntities(attribute[2]??attribute[3]??attribute[4]??'');
     const entry={name:attribute[1],value};
     if(/^[\s]*[\[{]/.test(value))try{entry.json=JSON.parse(value);}catch{entry.jsonError='属性值不是有效的 JSON';}
     attributes.push(entry);
    }
   }
   tags.push({name,closing,attributes});
   if(tags.length===10000){truncated=true;break;}
   if(!closing&&RAW_TAGS.has(name)){
    if(name==='plaintext')break;
    const close=new RegExp('</'+name+'(?=[\\t\\n\\f\\r />])','gi');close.lastIndex=index;
    const found=close.exec(html);if(!found)break;index=found.index;
   }
  }
  return {tags,truncated,note:'静态标签与属性解析，不执行 HTML；完整源码见 HTML 文本文件。'};
 }
 const CAPTURE_LIMIT=60*1024*1024,FORMAT_LIMIT=1000,PARSE_LIMIT=8*1024*1024;
 const encoder=()=>new TextEncoder();
 function decodeBase64(value){
  const text=atob(value),bytes=new Uint8Array(text.length);
  for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);
  return bytes;
 }
 function extension(type){return ({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp','image/tiff':'tiff','image/svg+xml':'svg.txt'})[type]||'bin';}
 async function capture(entries,metadata={}){
  const sample={...metadata,capturedAt:new Date().toISOString(),formats:[],files:[],incomplete:false};let total=0;
  for(let i=0;i<entries.length;i++){
   const entry=entries[i],record={index:i+1,item:entry.item??0,type:entry.type,nativeType:entry.nativeType||entry.type,bytes:entry.size??entry.blob?.size??null};
   sample.formats.push(record);
   if(i>=FORMAT_LIMIT){record.error='超过 1000 种格式限额，未采集';sample.incomplete=true;continue;}
   if(entry.error){record.error=typeof entry.error==='string'?entry.error:'读取失败';sample.incomplete=true;continue;}
   if(record.bytes!==null&&record.bytes>CAPTURE_LIMIT-total){record.error='超过单次采集 60 MiB 限额，未采集';sample.incomplete=true;continue;}
   try{
    const bytes=entry.blob?new Uint8Array(await entry.blob.arrayBuffer()):decodeBase64(entry.base64);
    if(bytes.length>CAPTURE_LIMIT-total){record.error='超过单次采集 60 MiB 限额，未采集';sample.incomplete=true;continue;}
    total+=bytes.length;record.bytes=bytes.length;
    const prefix='format-'+String(i+1).padStart(4,'0');record.rawFile=prefix+'.'+extension(entry.type);
    sample.files.push({name:record.rawFile,data:bytes});
    if(entry.blob?.name)record.fileName=entry.blob.name;
    if(bytes.length>PARSE_LIMIT){record.parseNote='超过 8 MiB 解析限额；原始数据已完整保留';continue;}
    let text=entry.text;
    if(text===undefined){
     try{
      const utf16=bytes[0]===0xff&&bytes[1]===0xfe?'utf-16le':bytes[0]===0xfe&&bytes[1]===0xff?'utf-16be':null;
      text=new TextDecoder(utf16||'utf-8',{fatal:true}).decode(bytes);
      if(text.includes('\0'))text=undefined;
     }catch{ /* Binary formats remain available as original bytes. */ }
    }
    if(typeof text==='string'){
     record.textFile=prefix+(entry.type==='text/html'?'.html.txt':'.txt');sample.files.push({name:record.textFile,data:encoder().encode(text)});
     record.preview=text.slice(0,2000);record.previewTruncated=text.length>2000;
     try{
      const json=JSON.parse(text);record.jsonFile=prefix+'.parsed.json';sample.files.push({name:record.jsonFile,data:encoder().encode(JSON.stringify(json,null,2))});
     }catch{ /* Not every textual representation is JSON. */ }
    }
    if(entry.parseError)record.parseError=entry.parseError;
    if(entry.type==='text/html'&&typeof (entry.html??text)==='string'){
     const html=entry.html??text;record.html=summarizeHtml(html);
     const readable=readableHtml(html);record.readablePreview=readable.slice(0,4000);record.readablePreviewTruncated=readable.length>4000;
     record.htmlDetailsFile=prefix+'.html-details.json';
     sample.files.push({name:record.htmlDetailsFile,data:encoder().encode(JSON.stringify(htmlDetails(html),null,2))});
    }
    if(!record.textFile)record.parseNote='二进制格式，原始数据已保留';
   }catch{record.error='读取此格式数据失败';sample.incomplete=true;}
  }
  sample.bytes=total;return sample;
 }
 function report(sample){
  const lines=['md2chat 剪贴板诊断报告','报告版本：3','采集时间：'+sample.capturedAt,'入口：'+sample.origin,'应用版本：'+(sample.version||'Web'),'系统：'+(sample.platform||'browser'),sample.recentCopy||'',
   '包含原始内容：正文、HTML、图片、链接、文件路径及私有格式可能出现在诊断包中。',
   '采集格式：'+sample.formats.length+'；原始数据：'+sample.bytes+' 字节；'+(sample.incomplete?'部分格式未采集，请查看下方原因':'所有列出的格式均已采集')];
  if(sample.htmlMode)lines.push('HTML 读取方式：'+sample.htmlMode);
  for(const format of sample.formats){
   lines.push('', '['+format.index+'] 项目 '+(format.item+1)+' · '+format.nativeType+(format.type===format.nativeType?'':' → '+format.type),
    '大小：'+(format.bytes??'未知')+' 字节'+(format.rawFile?'；原始文件：'+format.rawFile:''));
   if(format.error)lines.push('未采集：'+format.error);
   if(format.parseError)lines.push('解析失败：'+format.parseError+'；原始数据已保留');
   if(format.parseNote)lines.push(format.parseNote);
   if(format.jsonFile)lines.push('JSON 解析：'+format.jsonFile);
   if(format.html)lines.push(...htmlLines(format.html),'HTML 标签、原始属性及属性内 JSON：'+format.htmlDetailsFile);
   if(format.preview!==undefined)lines.push('文本预览'+(format.previewTruncated?'（前 2000 字符，完整内容见文件）':'')+'：',format.preview);
  }
  lines.push('',sample.platform==='browser'?'浏览器仅开放部分格式；系统私有格式请使用桌面版读取。':'系统对象句柄或不可读格式会列出原因；二进制私有格式保留原始字节。',
   '只解析剪贴板已有数据，不执行 HTML、不请求链接或读取引用的本地文件。','样本仅保留在本页内存中；导出 ZIP 后可手动发送给开发者。');
  return lines.join('\n');
 }
 function readableHtml(input){
  const html=input.slice(0,MAX_INPUT),parts=[];let index=0;
  while(index<html.length){
   const start=html.indexOf('<',index);
   if(start<0){parts.push(decodeEntities(html.slice(index)));break;}
   parts.push(decodeEntities(html.slice(index,start)));
   if(html.startsWith('<!--',start)){const end=html.indexOf('-->',start+4);if(end<0)break;index=end+3;continue;}
   const end=tagEnd(html,start+1);if(end<0)break;
   const match=/^<(\/?)([a-z][a-z0-9:_-]*)(?=[\s/>])/i.exec(html.slice(start,end+1));index=end+1;
   if(!match)continue;
   const name=match[2].toLowerCase();
   if(['br','p','div','li','tr','h1','h2','h3','h4','h5','h6','blockquote','section'].includes(name))parts.push('\n');
   if(name==='td'||name==='th')parts.push('\t');
   if(!match[1]&&RAW_TAGS.has(name)){
    if(name==='plaintext'){parts.push(decodeEntities(html.slice(index)));break;}
    const close=new RegExp('</'+name+'(?=[\\t\\n\\f\\r />])','gi');close.lastIndex=index;
    const found=close.exec(html);if(!found)break;const rawEnd=tagEnd(html,found.index+2);if(rawEnd<0)break;index=rawEnd+1;
   }
  }
  return parts.join('').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 }
 const PREVIEW_IMAGES=new Set(['image/png','image/jpeg','image/gif','image/webp','image/bmp','image/avif']);
 function preview(sample){
  const files=new Map(sample.files.map(file=>[file.name,file.data]));
  return sample.formats.map(format=>{
   const type=format.type,kind=type==='text/html'?'html':type.startsWith('image/')||/^windows-dib-/.test(type)?'image':format.jsonFile?'json':type==='text/plain'?'text':type==='text/uri-list'?'links':'other';
   const row={format,kind,text:kind==='html'?format.readablePreview:kind==='json'?new TextDecoder().decode(files.get(format.jsonFile)).slice(0,2000):format.preview,images:[],references:[]};
   if(kind==='image'&&format.rawFile&&PREVIEW_IMAGES.has(type))row.images.push({type,data:files.get(format.rawFile)});
   if(kind==='html'&&format.htmlDetailsFile){
    const details=JSON.parse(new TextDecoder().decode(files.get(format.htmlDetailsFile))),seen=new Set();
    const reference=value=>{
     if(typeof value!=='string'||!value||seen.has(value)||seen.size>=MAX_IMAGES)return;seen.add(value);
     const match=/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(value);
     if(match&&PREVIEW_IMAGES.has(match[1].toLowerCase())){
      try{row.images.push({type:match[1].toLowerCase(),data:decodeBase64(match[2].replace(/\s/g,''))});}catch{row.references.push({notice:true,value:'图片数据无法预览'});}
     }else row.references.push({notice:value.startsWith('data:'),value:value.startsWith('data:')?'图片数据已保留，当前格式不能预览。':value});
    };
    const inspectJson=value=>{
     const pending=[value];let count=0;
     while(pending.length&&count++<10000){
      const item=pending.pop();if(!item||typeof item!=='object')continue;
      for(const [key,value] of Object.entries(item)){
       if(typeof value==='string'&&(/^data:image\//i.test(value)||['src','imageUrl','image_url'].includes(key)))reference(value);
       else if(value&&typeof value==='object')pending.push(value);
      }
     }
    };
    for(const tag of details.tags)for(const attribute of tag.attributes){
     if(tag.name==='img'&&attribute.name.toLowerCase()==='src')reference(attribute.value);
     if(attribute.json)inspectJson(attribute.json);
    }
   }
   return row;
  });
 }
 function renderPreview(container,sample,{document=container.ownerDocument,t=value=>value,createObjectURL=blob=>URL.createObjectURL(blob),revokeObjectURL=url=>URL.revokeObjectURL(url)}={}){
  const urls=[],rows=preview(sample);
  const node=(tag,className,text)=>{const element=document.createElement(tag);element.className=className||'';if(text!==undefined)element.textContent=text;return element;};
  container.replaceChildren();
  if(!rows.length)container.append(node('p','diagnostic-empty',t('剪贴板中没有可读取的内容。')));
  const titles={text:'文字',html:'图文内容',image:'图片',json:'结构化数据',links:'链接',other:'其他内容'};
  for(const row of rows){
   const format=row.format,card=node('section','diagnostic-card'),heading=node('div','diagnostic-card-heading');
   heading.append(node('h3','',t(titles[row.kind])),node('span','diagnostic-badge'+(format.error?' is-error':''),t(format.error?'未能读取':row.kind==='other'||row.kind==='image'&&!row.images.length?'已读取':'已识别')));card.append(heading);
   card.append(node('p','diagnostic-format',format.nativeType+' · '+(format.bytes===null?t('大小未知'):format.bytes+' B')));
   if(format.error)card.append(node('p','diagnostic-note is-error',t(format.error)));
   else{
    if(row.text!==undefined&&row.text!==''){
     card.append(node('pre','diagnostic-text',row.text));
     if(format.previewTruncated||format.readablePreviewTruncated)card.append(node('p','diagnostic-note',t('仅展示部分内容，完整数据在 ZIP 中。')));
    }else if(row.kind==='text')card.append(node('p','diagnostic-note',t('文字内容为空。')));
    for(const [index,image] of row.images.entries()){
     const figure=node('figure','diagnostic-picture'),img=node('img','clipboard-image'),caption=node('figcaption','diagnostic-note',t('图片预览'));
     const url=createObjectURL(new Blob([image.data],{type:image.type}));urls.push(url);img.src=url;img.alt=t('图片预览')+' '+(index+1);
     img.addEventListener('error',()=>{img.hidden=true;heading.children[1].textContent=t('已读取');caption.textContent=t('图片数据已读取，当前格式不能预览。');});
     figure.append(img,caption);card.append(figure);
    }
    if(row.references.length){
     card.append(node('p','diagnostic-note',t('识别到图片引用，以下地址未加载：')));
     for(const reference of row.references)card.append(node('p','diagnostic-reference',reference.notice?t(reference.value):reference.value));
    }
    if(row.kind==='html'&&format.html?.tableCount)card.append(node('p','diagnostic-note',t('已识别表格')+'：'+format.html.tableCount));
    if(row.kind==='image'&&!row.images.length)card.append(node('p','diagnostic-note',t('图片数据已读取，当前格式不能预览。')));
    if(row.kind==='other'&&row.text===undefined)card.append(node('p','diagnostic-note',t('原始数据已读取，将包含在 ZIP 中。')));
    if(format.parseError)card.append(node('p','diagnostic-note is-error',t('部分内容无法解析，原始数据已保留。')));
    if(format.parseNote&&!row.text&&!row.images.length)card.append(node('p','diagnostic-note',t(format.parseNote)));
   }
   container.append(card);
  }
  return ()=>{for(const url of urls)revokeObjectURL(url);urls.length=0;container.replaceChildren();};
 }
 const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
 // ZIP STORE avoids dependencies and retains byte-for-byte native representations.
 function zip(files){
  const chunks=[],central=[];let offset=0,centralSize=0;
  for(const file of files){
   const name=encoder().encode(file.name),data=file.data,crc=crc32(data);
   const header=new Uint8Array(30+name.length),view=new DataView(header.buffer);
   view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint16(12,33,true);
   view.setUint32(14,crc,true);view.setUint32(18,data.length,true);view.setUint32(22,data.length,true);view.setUint16(26,name.length,true);header.set(name,30);
   const directory=new Uint8Array(46+name.length),dv=new DataView(directory.buffer);
   dv.setUint32(0,0x02014b50,true);dv.setUint16(4,20,true);dv.setUint16(6,20,true);dv.setUint16(8,0x800,true);dv.setUint16(14,33,true);
   dv.setUint32(16,crc,true);dv.setUint32(20,data.length,true);dv.setUint32(24,data.length,true);dv.setUint16(28,name.length,true);dv.setUint32(42,offset,true);directory.set(name,46);
   chunks.push(header,data);central.push(directory);offset+=header.length+data.length;centralSize+=directory.length;
  }
  const end=new Uint8Array(22),view=new DataView(end.buffer);view.setUint32(0,0x06054b50,true);view.setUint16(8,files.length,true);view.setUint16(10,files.length,true);view.setUint32(12,centralSize,true);view.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end],{type:'application/zip'});
 }
 function bundle(samples){
  if(!samples.length)throw new Error('请先读取剪贴板');
  const files=[{name:'README.txt',data:encoder().encode('md2chat 剪贴板诊断包\n包含用户原始剪贴板内容，请仅发送给可信任的开发者。\nmanifest.json 记录格式、解析结果及失败原因；report.txt 为摘要和文本预览。\nsample-N/ 中 .bin/图片文件是原始字节，.txt 是解码文本，.html.txt 是 HTML 源码，.parsed.json 是格式化 JSON，.html-details.json 包含 HTML 标签、原始属性及属性内的 JSON（如钉钉图文树）。\nHTML 不会被执行；链接、图片引用和文件路径不会自动下载。二进制私有格式可能需要专用工具解析。\n本 ZIP 使用 STORE 保存，不进行压缩。\n')}];
  const manifests=samples.map((sample,index)=>{
   const {files:raw,...manifest}=sample,folder='sample-'+(index+1)+'/';
   for(const file of raw)files.push({name:folder+file.name,data:file.data});
   return {...manifest,directory:folder};
  });
  files.push({name:'manifest.json',data:encoder().encode(JSON.stringify({schemaVersion:3,samples:manifests},null,2))},
   {name:'report.txt',data:encoder().encode(samples.map(report).join('\n\n────────\n\n'))});
  return zip(files);
 }
 return {summarizeHtml,htmlLines,formatName,capture,report,bundle,preview,renderPreview,CAPTURE_LIMIT,FORMAT_LIMIT};
});
