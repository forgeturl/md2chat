(() => {
 const code = document.getElementById('demo-source'), preview = document.getElementById('demo-preview');
 const status = document.getElementById('demo-status'), retry = document.getElementById('demo-retry');
 let generation = 0;
 async function refresh() {
  const current = ++generation;
  const source = md2chatDemo.source(md2chatI18n.t);
  // Add syntax color without changing a single character of the displayed source.
  code.replaceChildren();
  source.split('\n').forEach((line, index, lines) => {
   const span = document.createElement('span');
   if (line.startsWith('# ')) span.className = 'syntax-heading';
   else if (line.startsWith('```')) span.className = 'syntax-fence';
   span.textContent = line + (index < lines.length - 1 ? '\n' : '');
   code.appendChild(span);
  });
  preview.replaceChildren(); preview.setAttribute('aria-busy', 'true');
  status.textContent = md2chatI18n.t('正在生成预览…'); retry.hidden = true;
  try {
   const content = await md2chatDemo.render(source, ChatMarkdown, ChatRenderers, document);
   if (current !== generation) return;
   preview.replaceChildren(content); preview.setAttribute('aria-busy', 'false'); status.textContent = '';
  } catch (_) {
   if (current !== generation) return;
   preview.setAttribute('aria-busy', 'false'); status.textContent = md2chatI18n.t('预览暂时不可用，请重试。'); retry.hidden = false;
  }
 }
 retry.addEventListener('click', refresh);
 window.addEventListener('md2chat:language', refresh);
 // i18n applies at DOMContentLoaded; use that event as the first render trigger.
 if (document.readyState !== 'loading') refresh();
})();
