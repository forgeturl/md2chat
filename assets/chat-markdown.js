/* Chat adapter for Marked 15.0.12. Never insert Markdown's raw HTML. */
(function(root){
 const md=typeof module==='object'?require('./vendor/marked.js'):root.marked;
 const lexer=new md.Marked({gfm:true,breaks:true,extensions:[{
  name:'chatImage',level:'inline',start:src=>src.indexOf('[[DING_IMAGE:'),
  tokenizer(src){const match=/^\[\[DING_IMAGE:(\d+)\]\]/.exec(src);if(match)return {type:'chatImage',raw:match[0],id:match[1]};}
 }]});
 const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(all,e)=>{
  if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):all;}
  return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()];
 });
 function runsHtml(runs){return runs.map(r=>{
  let text=esc(r.text).replace(/\n/g,'<br>');
  if(r.code)text='<code style="font-family:monospace;white-space:pre-wrap">'+text+'</code>';
  if(r.bold)text='<strong>'+text+'</strong>';
  if(r.italic)text='<em>'+text+'</em>';
  if(r.strikethrough)text='<s>'+text+'</s>';
  return text;
 }).join('');}
 function normalize(source){
  let fence=null;
  return source.replace(/\r\n?/g,'\n').split('\n').map(line=>{
   const m=/^ {0,3}(`{3,}|~{3,})/.exec(line);
   if(m){if(!fence)fence=m[1];else if(m[1][0]===fence[0]&&m[1].length>=fence.length)fence=null;return line;}
   return !fence&&/^\s*\\\|/.test(line)?line.replace(/\\\|/g,'|'):line;
  }).join('\n');
 }
 function parse(source){
  const blocks=[];
  const append=(text,style={})=>({type:'run',text,...style});
  function inline(tokens,style={}){
   const out=[];
   for(const t of tokens||[]){
    switch(t.type){
     case 'strong':out.push(...inline(t.tokens,{...style,bold:true}));break;
     case 'em':out.push(...inline(t.tokens,{...style,italic:true}));break;
     case 'del':out.push(...inline(t.tokens,{...style,strikethrough:true}));break;
     case 'codespan':out.push(append(t.text,{...style,code:true}));break;
     case 'br':out.push(append('\n',style));break;
     case 'chatImage':out.push({type:'image',id:t.id});break;
     case 'image':out.push({type:'image',src:t.href});break;
     case 'link':{
      const label=inline(t.tokens,style);out.push(...label);
      const text=label.filter(p=>p.type==='run').map(p=>p.text).join('');
      if(text!==t.href)out.push(append('（'+t.href+'）',style));break;
     }
     case 'escape':out.push(append(t.text,style));break;
     case 'html':out.push(append(t.raw,style));break;
     default:out.push(...(t.tokens?inline(t.tokens,style):[append(decode(t.text||t.raw||''),style)]));
    }
   }
   return out;
  }
  function emit(pieces,prefix=''){
   let runs=[];let atStart=true;
   const flush=()=>{if(runs.length){const text=runs.map(r=>r.text).join('');if(text.trim())blocks.push({type:'text',text,runs});runs=[];}};
   for(const piece of pieces){
    if(piece.type==='image'){flush();blocks.push(piece);atStart=true;continue;}
    for(const [i,line] of piece.text.split('\n').entries()){
     if(i){runs.push({text:'\n'});atStart=true;}
     if(line){if(atStart&&prefix)runs.push({text:prefix});atStart=false;const {type,...run}=piece;runs.push({...run,text:line});}
    }
   }
   flush();
  }
  const cell=t=>inline(t.tokens).map(p=>p.type==='image'?'[图片：'+(p.src||p.id)+']':p.text).join('');
  function walk(tokens,depth=0,quote=''){
   for(const [tokenIndex,t] of tokens.entries()){
    switch(t.type){
     case 'space':{
      const last=blocks[blocks.length-1];
      if(last?.type==='text'&&t.raw.includes('\n\n')&&tokens.slice(tokenIndex+1).some(next=>!['space','def'].includes(next.type))){last.text+='\n';last.runs.push({text:'\n'});}break;
     }
     case 'def':break;
     case 'heading':emit([append('【',{bold:true}),...inline(t.tokens,{bold:true}),append('】',{bold:true})],quote);break;
     case 'paragraph':case 'text':emit(t.tokens?inline(t.tokens):[append(t.text||'')],quote);break;
     case 'blockquote':walk(t.tokens,depth,quote+'│ ');break;
     case 'list':
      t.items.forEach((item,i)=>{
       const prefix='  '.repeat(depth)+(item.task?(item.checked?'☑ ':'☐ '):t.ordered?(Number(t.start)+i)+'. ':'• ');
       const start=blocks.length;walk(item.tokens,depth+1,quote);
       const first=blocks[start];
       if(first?.type==='text'){first.text=prefix+first.text;first.runs.unshift({text:prefix});}
       else blocks.splice(start,0,{type:'text',text:prefix.trimEnd(),runs:[{text:prefix.trimEnd()}]});
      });break;
     case 'code':emit([append('⟦代码'+(t.lang?' · '+t.lang:'')+'⟧\n',{bold:true}),append(t.text,{code:true})],quote);break;
     case 'hr':emit([append('────────────')],quote);break;
     case 'table':blocks.push({type:'table',header:t.header.map(cell),rows:t.rows.map(row=>row.map(cell))});break;
     case 'html':emit([append(t.raw)],quote);break;
     default:emit([append(t.raw||t.text||'')],quote);
    }
   }
  }
  walk(lexer.lexer(normalize(source)));return blocks;
 }
 function compactImages(blocks){
  return blocks.map((block,index)=>{
   if(block.type!=='text')return block;
   const imageLike=b=>b&&['image','table'].includes(b.type);
   let start=0,end=block.text.length;
   if(imageLike(blocks[index-1]))start=(block.text.match(/^(?:[ \t]*\n)+/)||[''])[0].length;
   if(imageLike(blocks[index+1]))end-=((block.text.slice(start).match(/\n[ \t\r\n]*$/)||[''])[0].length);
   let offset=0;const runs=[];
   for(const run of block.runs){const text=run.text.slice(Math.max(0,start-offset),Math.max(0,end-offset));if(text)runs.push({...run,text});offset+=run.text.length;}
   return {...block,text:block.text.slice(start,end),runs};
  }).filter(b=>b.type!=='text'||b.text.trim());
 }
 const api={parse,runsHtml,compactImages};if(typeof module==='object')module.exports=api;else root.ChatMarkdown=api;
})(typeof globalThis==='object'?globalThis:this);
