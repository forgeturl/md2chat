/* One source of truth for the source pane, rendered result and editor example. */
(function(root, factory) {
 const api = factory();
 if (typeof module === 'object') module.exports = api; else root.md2chatDemo = api;
})(globalThis, () => {
 function source(t = text => text) {
  return '# '+t('流程示例')+'\n\n**'+t('文字')+'**'+t('与')+'*'+t('图表')+'*'+t('，按原顺序发出去。')+
   '\n\n```mermaid\nflowchart TD\n  A["'+t('粘贴 Markdown')+'"] -->|'+t('普通文字')+'| C["'+t('保留可编辑文字')+'"]\n'+
   '  A -->|'+t('Mermaid 图表')+'| D["'+t('渲染为清晰图片')+'"]\n'+
   '  C --> E["'+t('复制到聊天')+'"]\n  D --> E\n```';
 }
 async function render(source, parser, renderers, doc, {isCurrent=()=>true}={}) {
  if(source.length>30000)throw new Error('Demo source too large');
  const fragment = doc.createDocumentFragment();
  function image(result,alt,inline=false) {
   const node=doc.createElement('img');node.src=result.src;node.alt=alt;
   node.width=result.displayWidth||result.width;node.height=result.displayHeight||result.height;
   if(inline)node.className='demo-inline-math';
   return node;
  }
  for (const block of parser.compactImages(parser.parse(source))) {
   if(!isCurrent())throw Object.assign(new Error('Superseded'),{name:'AbortError'});
   if (block.type === 'text') {
    const paragraph = doc.createElement('p');
    for(const run of block.runs) {
     if(run.math)paragraph.appendChild(image(await renderers.math(run.math,false),run.text,true));
     else {const span=doc.createElement('span');span.innerHTML=parser.runsHtml([run]);paragraph.appendChild(span);}
    }
    fragment.appendChild(paragraph);
   } else if (block.type === 'mermaid') {
    fragment.appendChild(image(await renderers.mermaid(block.text),block.text));
   } else if(block.type==='math') {
    fragment.appendChild(image(await renderers.math(block.tex),block.tex));
   } else if(block.type==='code') {
    for(const result of await renderers.code(block.text,block.language))fragment.appendChild(image(result,block.text));
   } else if(block.type==='table') {
    for(const result of doc.defaultView.TableImages.render(block.header,block.rows))fragment.appendChild(image(result,[block.header,...block.rows].map(row=>row.join(' | ')).join('\n')));
   } else if(block.type==='image'&&/^(?:https?:\/\/|blob:|data:image\/(?:png|jpe?g|gif|webp|bmp);base64,)/i.test(block.src||'')) {
    const node=doc.createElement('img');node.src=block.src;node.alt='';node.referrerPolicy='no-referrer';await node.decode();fragment.appendChild(node);
   } else throw new Error('Unsupported demo block');
  }
  return fragment;
 }
 return {source, render};
});
