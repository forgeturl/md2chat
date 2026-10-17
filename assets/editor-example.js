// Seed the built-in example before the editor starts. Never change input on language switches.
(() => {
 const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
 let preference = 'auto';
 try { preference = localStorage.getItem('md2chat.language') || 'auto'; } catch (_) {}
 const locale = md2chatI18n.resolve(preference,languages);
 document.getElementById('markdown-input').textContent = md2chatDemo.source(text => md2chatI18n.translate(text,locale));
})();
