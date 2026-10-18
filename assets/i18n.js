/* UI translation only. User input, previews and diagnostic samples are never translated. */
(function(root, factory) {
 const data = typeof module === 'object' ? require('./i18n-data.js') : root.md2chatLocales;
 const api = factory(data);
 if (typeof module === 'object') module.exports = api;
 else { root.md2chatI18n = api; api.start(root); }
})(globalThis, data => {
 'use strict';
 const codes = new Set(data.locales.map(item => item.code));
 const key = 'md2chat.language';
 function match(value) {
  const tag = String(value || '').replaceAll('_', '-').toLowerCase();
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN';
  if (tag === 'pt' || tag.startsWith('pt-')) return 'pt-BR';
  const base = tag.split('-')[0];
  return codes.has(base) ? base : null;
 }
 function detect(languages) {
  for (const language of languages || []) { const supported = match(language); if (supported) return supported; }
  return 'en';
 }
 function valid(value) { return value === 'auto' || codes.has(value); }
 function resolve(preference, languages) { return codes.has(preference) ? preference : detect(languages); }
 function translate(source, locale) {
  const entry = data.messages[source];
  if (entry) return entry[locale] || entry.en || source;
  if (locale === 'zh-CN') return source;
  const format = (key, values) => (data.messages[key]?.[locale] || data.messages[key]?.en || key)
   .replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  let match;
  if ((match = /^第 (\d+) 张图片无法读取，请检查原图后重试。$/.exec(source))) return format('第 {n} 张图片无法读取，请检查原图后重试。',{n:match[1]});
  if ((match = /^第 (\d+) 张图片尺寸无效，请检查原图后重试。$/.exec(source))) return format('第 {n} 张图片尺寸无效，请检查原图后重试。',{n:match[1]});
  if ((match = /^原文图片 (\d+) 张 \+ 表格图片 (\d+) 张 \+ 公式 (\d+) 张 \+ 图表 (\d+) 张 \+ 代码 (\d+) 张 = 共 (\d+) 张图片。$/.exec(source)))
   return format('来源 {a} · 表格 {b} · 公式 {c} · 图表 {d} · 代码 {e} · 总计 {n}', Object.fromEntries(['a','b','c','d','e','n'].map((key,i)=>[key,match[i+1]])));
  if ((match = /^已复制到剪贴板（(微信|钉钉|飞书|企微|邮件)图文，(\d+) 张图片(?:，表格可编辑)?）。([\s\S]*)$/.exec(source)))
   return format('已复制到 {target} · {n} 张图片',{target:translate(match[1],locale),n:match[2]}) + ' · ' + translate('复制说明',locale);
  if ((match = /^共 (\d+) 段，请从第 1 段开始复制。$/.exec(source))) return format('共 {n} 段，请从第 1 段开始复制。',{n:match[1]});
  if ((match = /^正在复制第 (\d+)\/(\d+) 段…$/.exec(source))) return format('正在复制第 {i}/{n} 段…',{i:match[1],n:match[2]});
  if ((match = /^已复制第 (\d+)\/(\d+) 段，请到企微粘贴后再继续。$/.exec(source))) return format('已复制第 {i}/{n} 段，请到企微粘贴后再继续。',{i:match[1],n:match[2]});
  if ((match = /^第 (\d+) 段 · (文字|图片)$/.exec(source))) return format('第 {i} 段 · {kind}',{i:match[1],kind:translate(match[2],locale)});
  if ((match = /^复制第(\d+)段(文字|图片)$/.exec(source))) return translate('复制',locale)+' '+format('第 {i} 段 · {kind}',{i:match[1],kind:translate(match[2],locale)});
  if ((match = /^更新 (v[\d.]+)$/.exec(source))) return format('更新 {version}',{version:match[1]});
  if ((match = /^当前版本 (v[\d.]+)(?: → 新版本 (v[\d.]+))?$/.exec(source))) return format('当前版本 {current} → 新版本 {next}',{current:match[1],next:match[2] || match[1]});
  return source;
 }
 let locale = 'en', preference = 'auto';
 const api = {locales:data.locales, match, detect, valid, resolve, translate, t:source => translate(source, locale),
  get locale() { return locale; }, get preference() { return preference; }, start};
 function start(win) {
  const doc = win.document;
  const languages = win.navigator.languages?.length ? win.navigator.languages : [win.navigator.language];
  try { const saved = win.localStorage.getItem(key); if (valid(saved)) preference = saved; } catch (_) {}
  // Static landing pages keep their authored language on first load; desktop
  // and the shared editor retain their saved-language behavior.
  const pageLocale = doc.documentElement.getAttribute('data-site-language');
  const requestedLocale = new URLSearchParams(win.location?.search || '').get('lang');
  if (codes.has(pageLocale)) preference = pageLocale;
  else if (!win.md2chatLocale && codes.has(requestedLocale)) preference = requestedLocale;
  locale = resolve(preference, languages);
  const englishSources = new Map(Object.entries(data.messages).map(([source, entry]) => [entry.en, source]));
  const originals = new WeakMap(), attributes = new WeakMap();
  const excluded = 'script,style,pre,code,textarea,[contenteditable],#message,#diagnostic-report,#clipboard-images,[data-no-i18n],[aria-hidden="true"]';
  function text(node) {
   const parent = node.parentElement;
   if (!parent || parent.closest(excluded) || parent.closest('select')) return;
   const previous = originals.get(node);
   const current = node.nodeValue;
   const source = previous && current === previous.output ? previous.source : current;
   const trimmed = source.trim();
   if (!trimmed) return;
   const translated = translate(pageLocale === 'en' ? (englishSources.get(trimmed) || trimmed) : trimmed, locale);
   const output = source.replace(trimmed, translated);
   originals.set(node, {source, output});
   if (current !== output) node.nodeValue = output;
  }
  function attrs(element) {
   if (element.closest('script,style,[data-no-i18n],#message,#diagnostic-report')) return;
   const saved = attributes.get(element) || {};
   for (const name of ['aria-label','title','data-placeholder','placeholder']) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name), previous = saved[name];
    const source = previous && previous.output === current ? previous.source : current;
    const output = translate(pageLocale === 'en' ? (englishSources.get(source) || source) : source, locale);
    saved[name] = {source, output};
    if (output !== current) element.setAttribute(name, output);
   }
   attributes.set(element, saved);
  }
  function walk(node) {
   if (node.nodeType === 3) { text(node); return; }
   if (node.nodeType !== 1 && node.nodeType !== 9) return;
   if (node.nodeType === 1 && node.closest(excluded)) return;
   if (node.nodeType === 1) attrs(node);
   for (const child of node.childNodes) walk(child);
  }
  function renderSelect(select) {
   if (!select.options.length) {
    for (const item of [{code:'auto',name:''}, ...data.locales]) {
     const option = doc.createElement('option'); option.value = item.code; option.textContent = item.name;
     select.appendChild(option);
    }
    select.addEventListener('change', () => { void set(select.value); });
   }
   select.options[0].textContent = (data.locales.find(item=>item.code===detect(languages))?.name || 'English') + ' · ' + translate('自动',locale);
   select.value = preference;
   select.setAttribute('aria-label', translate('语言',locale));
  }
  function apply(value) {
   preference = valid(value) ? value : 'auto'; locale = resolve(preference, languages);
   doc.documentElement.lang = locale;
   // Public pages are fully authored in the URL language at build time.
   // Translating them again can mix languages or alter names in the text.
   if (!codes.has(pageLocale)) walk(doc.documentElement);
   for (const select of doc.querySelectorAll('[data-locale-select]')) renderSelect(select);
   win.dispatchEvent(new win.CustomEvent('md2chat:language', {detail:{locale,preference}}));
  }
  function persist(value) { try { win.localStorage.setItem(key, value); } catch (_) {} }
  let busy = false, revision = 0;
  async function set(value) {
   if (!valid(value) || busy) return;
   // Public pages always navigate to another complete edition; the editor
   // retains in-place UI switching and never replaces the user's input.
   const nextLocale = resolve(value, languages);
   const pageTarget = doc.querySelector('[data-site-locale="'+nextLocale+'"]')?.getAttribute('href');
   if (pageTarget && nextLocale !== pageLocale) {
    persist(value); win.location.assign(pageTarget); return;
   }
   busy = true; revision++;
   const selects = [...doc.querySelectorAll('[data-locale-select]')];
   for (const select of selects) select.disabled = true;
   try {
    if (win.md2chatLocale) await win.md2chatLocale.set(value, detect(languages));
    const status = doc.querySelector('[data-locale-status]'); if (status) status.textContent = '';
    persist(value); apply(value);
   } catch (_) {
    apply(preference);
    const status = doc.querySelector('[data-locale-status]');
    if (status) status.textContent = translate('未能保存语言设置，请重试。',locale);
   } finally { busy = false; for (const select of selects) select.disabled = false; }
  }
  api.set = set;
  function init() {
   apply(preference);
   new win.MutationObserver(records => {
    for (const record of records) {
     if (record.type === 'characterData') text(record.target);
     else if (record.type === 'attributes') attrs(record.target);
     else for (const node of record.addedNodes) walk(node);
    }
   }).observe(doc.body, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','data-placeholder','placeholder']});
   win.addEventListener('storage', event => { if (!codes.has(pageLocale) && event.key === key) apply(event.newValue); });
   if (win.md2chatLocale) {
    win.md2chatLocale.subscribe(value => { if (valid(value.preference)) { persist(value.preference); apply(value.preference); } });
    const initialRevision = revision;
    void win.md2chatLocale.get().then(async value => {
     if (revision !== initialRevision) return;
     const saved = valid(value.preference) ? value.preference : 'auto';
     await win.md2chatLocale.set(saved, detect(languages));
     if (revision === initialRevision) { persist(saved); apply(saved); }
    }).catch(() => {
     const status = doc.querySelector('[data-locale-status]');
     if (status) status.textContent = translate('未能保存语言设置，请重试。',locale);
    });
   }
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, {once:true}); else init();
 }
 return api;
});
