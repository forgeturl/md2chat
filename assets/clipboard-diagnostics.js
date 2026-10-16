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

 return {summarizeHtml,htmlLines,formatName};
});
