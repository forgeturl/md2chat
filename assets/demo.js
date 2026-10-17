/* One source of truth for the source pane, rendered result and editor example. */
(function(root, factory) {
 const api = factory();
 if (typeof module === 'object') module.exports = api; else root.md2chatDemo = api;
})(globalThis, () => {
 function source(t = text => text) {
  return '# '+t('流程示例')+'\n\n**'+t('文字')+'**'+t('与')+'*'+t('图表')+'*'+t('，按原顺序发出去。')+
   '\n\n```mermaid\nflowchart TD\n  A["'+t('粘贴 Markdown')+'"] --> B{"'+t('识别内容')+'"}\n'+
   '  B -->|'+t('普通文字')+'| C["'+t('保留可编辑文字')+'"]\n'+
   '  B -->|'+t('Mermaid 图表')+'| D["'+t('渲染为清晰图片')+'"]\n'+
   '  C --> E["'+t('复制到聊天')+'"]\n  D --> E\n```';
 }
 async function render(source, parser, renderers, doc) {
  const fragment = doc.createDocumentFragment();
  for (const block of parser.compactImages(parser.parse(source))) {
   if (block.type === 'text') {
    const paragraph = doc.createElement('p');
    paragraph.innerHTML = parser.runsHtml(block.runs);
    fragment.appendChild(paragraph);
   } else if (block.type === 'mermaid') {
    const result = await renderers.mermaid(block.text);
    const image = doc.createElement('img'); image.src = result.src;
    image.width = result.displayWidth; image.height = result.displayHeight;
    // The original diagram source remains available in the adjacent source pane.
    image.alt = block.text;
    fragment.appendChild(image);
   } else throw new Error('Unsupported demo block');
  }
  return fragment;
 }
 return {source, render};
});
