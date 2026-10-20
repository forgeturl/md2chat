const {test} = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const i18n = require('../assets/i18n.js'), demo = require('../assets/demo.js'), examples = require('../assets/guide-examples.js');
function fixture(search = '') {
 let locale = 'zh-CN';
 class Node {
  constructor() {this.events = {};this.textContent = '';this.image = false;}
  addEventListener(type, fn) {(this.events[type] ||= []).push(fn);}
  dispatchEvent(event) {for (const fn of this.events[event.type] || []) fn(event);}
  querySelector() {return this.image ? {} : null;}
 }
 const input = new Node(), clear = new Node(), win = new Node();let renders = 0;
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/editor-example.js'), 'utf8'), {
  navigator: {languages: ['zh-CN']}, localStorage: {getItem: () => 'zh-CN'}, location: {search}, URLSearchParams, Event,
  md2chatI18n: {...i18n, get locale() {return locale;}}, md2chatDemo: demo, md2chatGuideExamples: examples,
  document: {getElementById: id => id === 'markdown-input' ? input : clear}, window: win
 });
 input.addEventListener('input', () => renders++);
 return {input, clear, get renders() {return renders;}, language(code) {locale = code;win.dispatchEvent(new Event('md2chat:language'));}};
}
test('untouched default and guide examples follow all nine languages and refresh the preview', () => {
 for (const guide of [false, true]) {
  const f = fixture(guide ? '?example=chat-table' : '');
  for (const {code} of i18n.locales) {
   f.language(code);
   assert.equal(f.input.textContent, guide ? examples[code] : demo.source(text => i18n.translate(text, code)));
  }
  assert(f.renders > 0);
 }
});
test('editing, paste, drop, clear and undo permanently preserve user ownership', () => {
 for (const event of ['beforeinput','input','paste','drop','clear']) {
  const f = fixture(), original = f.input.textContent;
  (event === 'clear' ? f.clear : f.input).dispatchEvent(new Event(event === 'clear' ? 'click' : event));
  f.input.textContent = event === 'clear' ? '' : 'User document';
  f.language('en');assert.equal(f.input.textContent, event === 'clear' ? '' : 'User document');
  f.input.textContent = original;f.language('ja');assert.equal(f.input.textContent, original, 'undo must not restore example ownership');
 }
});
test('unannounced content and image changes are preserved', () => {
 for (const change of [f => {f.input.textContent = '';}, f => {f.input.textContent = 'Imported';}, f => {f.input.image = true;}]) {
  const f = fixture();change(f);const before = f.input.textContent;f.language('en');assert.equal(f.input.textContent, before);
 }
});
