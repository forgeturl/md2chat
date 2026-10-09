/* Syntax-colored code cards. Only the highlighter's escaped span output is read. */
(function(root){
 const colors={plain:'#e6edf3',keyword:'#ff7b72',string:'#a5d6ff',number:'#79c0ff',literal:'#79c0ff',comment:'#8b949e',doctag:'#8b949e',title:'#d2a8ff',built_in:'#ffa657',type:'#ffa657',attr:'#79c0ff',attribute:'#79c0ff',variable:'#ffa657',regexp:'#a5d6ff',symbol:'#79c0ff',meta:'#a5d6ff',tag:'#7ee787',name:'#7ee787',selector_tag:'#7ee787',addition:'#7ee787',deletion:'#ff7b72'};
 const decode=s=>s.replace(/&(amp|lt|gt|quot|#x27|#39);/g,(_,e)=>({amp:'&',lt:'<',gt:'>',quot:'"','#x27':"'",'#39':"'"}[e]));
 function tokens(source,language,engine){
  if(source.length>50000)throw new Error('代码块过长，请拆分为每块不超过 50,000 字符');
  const grammar=language&&engine.getLanguage(language);
  if(!grammar)return {label:language||'代码',runs:[{text:source,color:colors.plain}]};
  const html=engine.highlight(source,{language,ignoreIllegals:true}).value,runs=[],stack=[colors.plain];
  for(const match of html.matchAll(/<span\b[^>]*>|<\/span>|[^<]+/g)){
   const part=match[0];
   if(part.startsWith('<span')){const name=/hljs-([\w-]+)/.exec(part)?.[1];stack.push(colors[name]||stack.at(-1));}
   else if(part==='</span>')stack.pop();
   else runs.push({text:decode(part),color:stack.at(-1)});
  }
  return {label:grammar.name||language,runs};
 }
 function layout(runs,measure,maxWidth){
  const rows=[];let line=1,column=0,row={number:1,runs:[],width:0};
  const flush=()=>{rows.push(row);row={number:null,runs:[],width:0};};
  for(const run of runs)for(const char of run.text){
   if(char==='\n'){flush();row.number=++line;column=0;continue;}
   const text=char==='\t'?' '.repeat(4-column%4):char;
   for(const glyph of text){
    const width=measure(glyph);if(row.width+width>maxWidth&&row.width)flush();
    const last=row.runs.at(-1);if(last?.color===run.color)last.text+=glyph;else row.runs.push({text:glyph,color:run.color});
    row.width+=width;column++;
   }
  }
  flush();if(rows.length>2000)throw new Error('代码行数过多，请分段转换');return rows;
 }
 function render(source,language,engine){
  const {label,runs}=tokens(source,language,engine),font='18px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=font;
  const rows=layout(runs,s=>ctx.measureText(s).width,880);
  const width=Math.max(520,Math.ceil(Math.max(...rows.map(r=>r.width)))+96),pageSize=36,pages=Math.ceil(rows.length/pageSize),images=[];
  for(let page=0;page<pages;page++){
   const slice=rows.slice(page*pageSize,(page+1)*pageSize),height=76+slice.length*28;
   canvas.width=width*2;canvas.height=height*2;ctx.scale(2,2);
   ctx.fillStyle='#0d1117';ctx.fillRect(0,0,width,height);ctx.fillStyle='#161b22';ctx.fillRect(0,0,width,48);
   ctx.font='600 14px -apple-system, BlinkMacSystemFont, sans-serif';ctx.textBaseline='middle';ctx.fillStyle='#c9d1d9';ctx.fillText(label.slice(0,60),24,24);
   if(pages>1){ctx.textAlign='right';ctx.fillStyle='#8b949e';ctx.fillText((page+1)+' / '+pages,width-24,24);ctx.textAlign='left';}
   ctx.font=font;
   slice.forEach((row,index)=>{
    const y=70+index*28;ctx.fillStyle='#8b949e';ctx.textAlign='right';if(row.number!==null)ctx.fillText(String(row.number),52,y);ctx.textAlign='left';let x=72;
    for(const run of row.runs){ctx.fillStyle=run.color;ctx.fillText(run.text,x,y);x+=ctx.measureText(run.text).width;}
   });
   images.push({src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,displayWidth:width,displayHeight:height});
  }
  return images;
 }
 const api={tokens,layout,render};if(typeof module==='object')module.exports=api;else root.CodeImages=api;
})(globalThis);
