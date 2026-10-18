// Seed the built-in example before the editor starts. Never change input on language switches.
(() => {
 const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
 let preference = 'auto';
 try { preference = localStorage.getItem('md2chat.language') || 'auto'; } catch (_) {}
 const params = new URLSearchParams(location.search);
 const requested = params.get('lang');
 const locale = md2chatI18n.resolve(md2chatI18n.locales.some(item => item.code === requested) ? requested : preference,languages);
 document.getElementById('markdown-input').textContent = params.get('example') === 'chat-table'
  ? md2chatGuideExamples[locale === 'zh-CN' ? 'zh-CN' : 'en']
  : md2chatDemo.source(text => md2chatI18n.translate(text,locale));
})();
