// Only an untouched built-in example follows the interface language.
(() => {
 const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
 let preference = 'auto';
 try { preference = localStorage.getItem('md2chat.language') || 'auto'; } catch (_) {}
 const params = new URLSearchParams(location.search);
 const requested = params.get('lang');
 const locale = md2chatI18n.resolve(md2chatI18n.locales.some(item => item.code === requested) ? requested : preference,languages);
 const input = document.getElementById('markdown-input');
 const source = locale => params.get('example') === 'chat-table'
  ? md2chatGuideExamples[locale] || md2chatGuideExamples.en
  : md2chatDemo.source(text => md2chatI18n.translate(text,locale));
 let seeded = source(locale), owned = false, replacing = false;
 input.textContent = seeded;
 const claim = () => {if (!replacing) owned = true;};
 for (const event of ['beforeinput', 'input', 'paste', 'drop']) input.addEventListener(event, claim);
 document.getElementById('clear-input').addEventListener('click', claim);
 window.addEventListener('md2chat:language', () => {
  if (owned) return;
  // Preserve content changed by an integration even if it did not emit input.
  if (input.textContent !== seeded || input.querySelector('img')) {owned = true;return;}
  const next = source(md2chatI18n.locale);
  if (next === seeded) return;
  seeded = next;input.textContent = next;
  replacing = true;
  try {input.dispatchEvent(new Event('input', {bubbles: true}));}
  finally {replacing = false;}
 });
})();
