/* GitHub-light code images. Only the highlighter's escaped span output is read.
   Palette reference: github.com/sindresorhus/github-markdown-css/blob/main/github-markdown-light.css */
(function(root){
 const colors={plain:'#1f2328',keyword:'#cf222e',string:'#0a3069',number:'#0550ae',literal:'#0550ae',comment:'#59636e',doctag:'#cf222e',title:'#6639ba',built_in:'#953800',type:'#953800',attr:'#0550ae',attribute:'#0550ae',variable:'#953800',regexp:'#0a3069',symbol:'#0550ae',meta:'#0550ae',tag:'#116329',name:'#116329',selector_tag:'#116329',addition:'#116329',deletion:'#82071e'};
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
  const {label,runs}=tokens(source,language,engine),font='16px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=font;
  const padding=18,lineHeight=26,rows=layout(runs,s=>ctx.measureText(s).width,560);
  const width=Math.max(320,Math.ceil(Math.max(...rows.map(r=>r.width)))+padding*2),pageSize=36,pages=Math.ceil(rows.length/pageSize),images=[];
  for(let page=0;page<pages;page++){
   const slice=rows.slice(page*pageSize,(page+1)*pageSize),height=padding*2+slice.length*lineHeight+(pages>1?24:0);
   canvas.width=width*2;canvas.height=height*2;ctx.scale(2,2);
   ctx.fillStyle='#f6f8fa';ctx.strokeStyle='#d1d9e0';ctx.lineWidth=1;
   ctx.beginPath();ctx.roundRect(.5,.5,width-1,height-1,6);ctx.fill();ctx.stroke();
   ctx.font=font;ctx.textBaseline='middle';ctx.textAlign='left';
   slice.forEach((row,index)=>{
    const y=padding+(index+.5)*lineHeight;let x=padding;
    for(const run of row.runs){ctx.fillStyle=run.color;ctx.fillText(run.text,x,y);x+=ctx.measureText(run.text).width;}
   });
   if(pages>1){ctx.font='11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';ctx.textAlign='right';ctx.fillStyle='#59636e';ctx.fillText(label.slice(0,24)+' · '+(page+1)+' / '+pages,width-padding,height-padding-3);}
   images.push({src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,displayWidth:width,displayHeight:height});
  }
  return images;
 }
 const api={tokens,layout,render};if(typeof module==='object')module.exports=api;else root.CodeImages=api;
})(globalThis);
