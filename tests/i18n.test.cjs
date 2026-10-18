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
