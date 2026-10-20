const {test} = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../assets/i18n.js');
const data = require('../assets/i18n-data.js');
const demo = require('../assets/demo.js');
const markdown = require('../assets/chat-markdown.js');

test('browser language matching respects priority, regional aliases and safe fallback', () => {
 assert.equal(i18n.detect(['xx-YY','ja-JP','en-US']), 'ja');
 assert.equal(i18n.detect(['pt-PT']), 'pt-BR');
 assert.equal(i18n.detect(['zh-HK']), 'zh-CN');
 assert.equal(i18n.detect(['de-AT']), 'de');
 assert.equal(i18n.detect(['xx']), 'en');
 assert.equal(i18n.resolve('fr', ['zh-CN']), 'fr');
 assert.equal(i18n.resolve('auto', ['ko-KR']), 'ko');
 assert.equal(i18n.resolve('unsupported', ['es-MX']), 'es');
 assert.equal(i18n.valid('../../en'), false);
});
test('every authored UI message has all nine translations and preserves placeholders', () => {
 const tokens = text => [...text.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort();
 for (const [key, entry] of Object.entries(data.messages)) {
  for (const {code} of data.locales) {
   assert.ok(typeof entry[code] === 'string' && entry[code].length, `${key}: ${code}`);
   assert.deepEqual(tokens(entry[code]), tokens(entry.en), `${key}: ${code}`);
  }
 }
 assert.equal(i18n.translate('unknown text', 'de'), 'unknown text');
 assert.equal(i18n.translate('首选项', 'invalid'), 'Preferences');
});
test('all demo locales render precisely the text from the displayed source, followed by one diagram', () => {
 for (const {code} of data.locales) {
  const t = key => i18n.translate(key, code);
  const source = demo.source(t), blocks = markdown.compactImages(markdown.parse(source));
  assert.deepEqual(blocks.map(b=>b.type), ['text','text','mermaid']);
  assert.equal(blocks[0].text, '【'+t('流程示例')+'】');
  assert.equal(blocks[1].text, t('文字')+t('与')+t('图表')+t('，按原顺序发出去。'));
  assert.equal(blocks[1].runs.filter(r=>r.bold).map(r=>r.text).join(''),t('文字'));
  assert.equal(blocks[1].runs.filter(r=>r.italic).map(r=>r.text).join(''),t('图表'));
  assert.equal((blocks[2].text.match(/-->/g)||[]).length, 4);
  assert.ok(blocks[2].text.includes(t('复制到聊天')));
 }
});
test('dynamic conversion counts stay accurate in translated status messages', () => {
 const source='原文图片 1 张 + 表格图片 2 张 + 公式 3 张 + 图表 4 张 + 代码 5 张 = 共 15 张图片。';
 assert.equal(i18n.translate(source,'zh-CN'),source);
 assert.equal(i18n.translate(source,'en'),'Original 1 · Tables 2 · Equations 3 · Diagrams 4 · Code 5 · Total 15 images');
 assert.equal(i18n.translate('已复制第 2/4 段，请到企微粘贴后再继续。','en'),'Copied part 2/4. Paste it in WeCom before continuing.');
});
test('desktop update and help UI has authored translations, including native install prompts', () => {
 const fs=require('node:fs');
 const updates=fs.readFileSync(require.resolve('../assets/updates.js'),'utf8');
 const html=fs.readFileSync(require.resolve('../editor.html'),'utf8');
 const help=html.slice(html.indexOf('<dialog id="help-dialog"'),html.indexOf('<dialog id="diagnostic-dialog"'));
 const native=fs.readFileSync(require.resolve('../src-tauri/src/updates.rs'),'utf8');
 const messages=new Set();
 for(const match of updates.matchAll(/'([^'\n]+)'/g)){
  if(/[\u3400-\u9fff]/.test(match[1])&&!/[<>]/.test(match[1]))messages.add(match[1]);
 }
 for(const text of [help,updates])for(const match of text.matchAll(/>\s*([^<>]+?)\s*</g)){
  if(/[\u3400-\u9fff]/.test(match[1]))messages.add(match[1]);
 }
 for(const match of native.matchAll(/locale::tr\([^,]+,\s*"([^"]+)"\)/g))messages.add(match[1]);
 for(const message of messages)for(const {code} of data.locales){
  assert.equal(typeof data.messages[message]?.[code],'string',`${code}: missing desktop message ${message}`);
 }
});
test('native preference save errors translate both the rollback notice and the specific reason', () => {
 const prefix='未能保存，已恢复原设置。',reason='无法写入本机首选项，请检查磁盘空间和目录权限。';
 for(const {code} of data.locales){
  const value=i18n.translate(prefix+reason,code);
  assert(value.includes(i18n.translate(reason,code)));
  if(!['zh-CN','ja'].includes(code))assert(!/[\u3400-\u9fff]/.test(value),`${code}: ${value}`);
 }
});
test('UI labels and platform tooltips translate while editor and preview content stay untouched', async () => {
 function element(selectors=[],values={}) {
  return {nodeType:1,childNodes:[],parentElement:null,values:{...values},
   closest(query){return query.split(',').some(value=>selectors.includes(value))?this:this.parentElement?.closest(query)||null;},
   hasAttribute(key){return Object.hasOwn(this.values,key);},getAttribute(key){return this.values[key]??null;},
   setAttribute(key,value){this.values[key]=value;}};
 }
 const root=element(),editor=element(['[contenteditable]'],{'aria-label':'粘贴图文或 Markdown 内容'}),preview=element(['#message'],{'aria-label':'转换预览内容'});
 const pasted=element([],{'title':'软件更新'}),userText={nodeType:3,nodeValue:'软件更新',parentElement:pasted};
 pasted.parentElement=editor;pasted.childNodes=[userText];editor.childNodes=[pasted];
 const profiles=require('../assets/chat-targets.js').profiles;
 const buttons=Object.values(profiles).map(profile=>element([],{title:'复制到'+profile.label+'：'+profile.note}));
 root.childNodes=[editor,preview,...buttons];for(const child of root.childNodes)child.parentElement=root;
 const win={document:{documentElement:root,readyState:'loading',addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null},
  navigator:{languages:['zh-CN']},localStorage:{getItem:()=> 'zh-CN',setItem(){}},location:{search:''},dispatchEvent(){},CustomEvent:class{}};
 i18n.start(win);
 for(const {code} of data.locales){
  await i18n.set(code);
  assert.equal(editor.getAttribute('aria-label'),i18n.translate('粘贴图文或 Markdown 内容',code));
  assert.equal(preview.getAttribute('aria-label'),i18n.translate('转换预览内容',code));
  assert.equal(userText.nodeValue,'软件更新');assert.equal(pasted.getAttribute('title'),'软件更新');
  if(!['zh-CN','ja'].includes(code))for(const button of buttons)assert(!/[\u3400-\u9fff]/.test(button.getAttribute('title')),code+': '+button.getAttribute('title'));
 }
});
test('image composition errors use document-neutral wording and translate in every locale', () => {
 const fs=require('node:fs');
 const source=fs.readFileSync(require.resolve('../assets/clipboard-image.js'),'utf8');
 const messages=[...source.matchAll(/new Error\('([^']*)'\)/g)].map(match=>match[1]);
 messages.push('第 2 张图片无法读取，请检查原图后重试。','第 12 张图片尺寸无效，请检查原图后重试。',
  '正在转换或复制，请稍候再试。','转换期间剪贴板已更新，已保留新内容。请重新转图片。',
  '已复制转换开始时的内容；当前文档已更新，请重新转图片。');
 for(const message of messages){
  assert(!message.includes('重新复制'));
  for(const {code} of data.locales)if(code!=='zh-CN'){
   const translated=i18n.translate(message,code);
   assert.notEqual(translated,message,`${code}: ${message}`);
   if(message.startsWith('第 12'))assert(translated.includes('12'));
  }
 }
});
test('all nine public languages navigate to complete pages without changing editor routing', async () => {
 function windowFor(pageLocale, routes={}) {
  const navigations=[],saved=[],events=[];
  const element={nodeType:1,childNodes:[],closest:()=>null,hasAttribute:()=>false,getAttribute:()=>pageLocale};
  const win={
   document:{documentElement:element,readyState:'loading',addEventListener(){},querySelectorAll:()=>[],
    querySelector:selector=>pageLocale?{getAttribute:()=>routes[selector.match(/data-site-locale="([^"]+)"/)?.[1]]||null}:null},
   navigator:{languages:['en-US']},location:{search:'',assign:url=>navigations.push(url)},
   localStorage:{getItem:()=>null,setItem:(key,value)=>saved.push([key,value])},
   dispatchEvent:event=>events.push(event),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}
  };
  return {win,navigations,saved,events};
 }
 const {editions,route}=require('../scripts/site-locales.cjs');
 for(const {code} of editions){
  const from=code==='zh-CN'?'en':'zh-CN',to=code,url='./'+route(code);
  const state=windowFor(from,{[code]:url});
  i18n.start(state.win);await i18n.set(to);
  assert.deepEqual(state.navigations,[url]);
  assert.deepEqual(state.saved,[['md2chat.language',to]]);
  assert.equal(state.events.length,0,'navigate instead of partially translating the old page');
 }
 const editor=windowFor(null);
 i18n.start(editor.win);await i18n.set('ja');
 assert.deepEqual(editor.navigations,[]);
 assert.equal(editor.win.document.documentElement.lang,'ja');
 assert.equal(editor.events.at(-1).detail.locale,'ja');
 const home=windowFor('zh-CN',{en:'./en/'});
 i18n.start(home.win);await i18n.set('auto');
 assert.deepEqual(home.navigations,['./en/']);
});

test('desktop preferences, tray, help, and diagnostic static copy has all nine translations',()=>{
 const fs=require('node:fs'),files=['../desktop/preferences.html','../desktop/tray-panel.html','../editor.html'];
 for(const file of files){
  const source=fs.readFileSync(require.resolve(file),'utf8').replace(/<(script|style|textarea|pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<div[^>]*contenteditable[^>]*>[\s\S]*?<\/div>/gi,''),strings=new Set();
  for(const match of source.matchAll(/>\s*([^<>]+?)\s*</g))if(/[\u3400-\u9fff]/.test(match[1]))strings.add(match[1]);
  for(const match of source.matchAll(/(?:aria-label|title|placeholder)="([^"]+)"/g))if(/[\u3400-\u9fff]/.test(match[1]))strings.add(match[1]);
  for(const source of strings)for(const {code} of data.locales)assert.equal(typeof data.messages[source]?.[code],'string',file+': '+code+': '+source);
 }
});

test('diagnostic, tray and WeCom error paths translate in each locale and retain placeholder values',()=>{
 const sources=['读取失败：当前浏览器不支持直接读取。可在此窗口按 ⌘V / Ctrl+V 粘贴。','导出失败：保存诊断包失败，请选择可写的位置。','第 3 段复制失败：剪贴板访问未完成。请重试。','第 3 段图片','✓ 已复制到剪贴板，请到微信聊天框粘贴','邮件预览：2 个可编辑表格，3 张图片。','请在 md2chat 桌面应用中打开。','超过 8 MiB 解析限额；原始数据已完整保留'];
 for(const source of sources)for(const {code} of data.locales)if(code!=='zh-CN'){
  const translated=i18n.translate(source,code);assert.notEqual(translated,source,code+': '+source);assert(!translated.includes('{'),translated);
  if(!['ja','ko'].includes(code))assert(!/[\u3400-\u9fff]/.test(translated),code+': '+translated);
 }
});

test('native menus and save-dialog captions use the same complete locale catalog',()=>{
 const fs=require('node:fs');
 for(const file of ['../src-tauri/src/shell.rs','../src-tauri/src/shell/tray_panel.rs','../src-tauri/src/lib.rs']){
  const source=fs.readFileSync(require.resolve(file),'utf8');
  for(const match of source.matchAll(/locale::tr\([^,]+,\s*"([^"]+)"/g))for(const {code} of data.locales)assert.equal(typeof data.messages[match[1]]?.[code],'string',file+': '+match[1]);
 }
 const tray=fs.readFileSync(require.resolve('../desktop/tray-panel.html'),'utf8');assert(tray.indexOf('i18n.js')<tray.indexOf('tray-panel.js'));
});
