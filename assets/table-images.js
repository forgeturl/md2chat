/* Shared production table rasterizer. */
(function(root){
function render(header,rows,document=root.document){
 if(header.length>20)throw new Error('表格最多支持 20 列，请拆分后转换。');
 const count=header.length,scale=2,width=1100,pad=12,fontSize=count>6?14:18,lineHeight=fontSize+10;
 const widths=count===4?[70,200,340,490]:count===2?[300,800]:Array.from({length:count},(_,i)=>Math.floor(width/count)+(i<width%count?1:0));
 const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d');
 const font="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif";
 ctx.font=fontSize+'px '+font;
 const wrap=(text,max)=>{
  const result=[];let line='';
  for(const char of text){if(char==='\n'){result.push(line);line='';continue;}if(line&&ctx.measureText(line+char).width>max){result.push(line);line=char;}else line+=char;}
  result.push(line);return result;
 };
 const layout=row=>{const cells=row.map((cell,i)=>wrap(cell,Math.max(12,widths[i]-pad*2)));return {cells,height:Math.max(...cells.map(c=>c.length))*lineHeight+pad*2};};
 const heading=layout(header);const body=rows.map(layout);const chunks=[];let chunk=[],height=heading.height;
 for(const row of body){
  if(row.height+heading.height>4000)throw new Error('单个表格单元格过长，请拆分成多行后重试。');
  if(chunk.length&&height+row.height>1800){chunks.push(chunk);chunk=[];height=heading.height;}
  chunk.push(row);height+=row.height;
 }
 if(chunk.length||!chunks.length)chunks.push(chunk);
 return chunks.map(chunk=>{
  const h=heading.height+chunk.reduce((sum,row)=>sum+row.height,0);
  canvas.width=(width+2)*scale;canvas.height=(h+2)*scale;ctx.scale(scale,scale);ctx.textBaseline='top';ctx.font=fontSize+'px '+font;
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width+2,h+2);let y=1;
  [heading,...chunk].forEach((row,index)=>{
   let x=1;row.cells.forEach((lines,i)=>{
    ctx.fillStyle=index===0?'#e9f0fb':index%2===0?'#f7f9fc':'#ffffff';ctx.fillRect(x,y,widths[i],row.height);
    ctx.strokeStyle='#c9d4e2';ctx.lineWidth=1;ctx.strokeRect(x,y,widths[i],row.height);
    ctx.fillStyle='#253247';lines.forEach((line,j)=>ctx.fillText(line,x+pad,y+pad+j*lineHeight));x+=widths[i];
   });y+=row.height;
  });
  return {src:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height};
 });
}
const api={render};if(typeof module==='object')module.exports=api;else root.TableImages=api;
})(globalThis);
