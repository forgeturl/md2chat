const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/tray-panel.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = () => ({
 title: '剪贴板转换',
 conversions: ['wechat', 'image', 'dingtalk', 'feishu', 'wecom', 'email'].map(icon => ({id: 'convert:' + icon, icon, label: icon, enabled: true})),
 actions: ['show-main', 'preferences', 'help', 'updates', 'quit'].map((id, i) => ({id, icon: ['window', 'preferences', 'help', 'update', 'quit'][i], label: id, enabled: true}))
});

async function fixture() {
 const elements = new Map(), events = new Map(), windowEvents = new Map(), calls = [];
 let value = snapshot(), subscriber, hold, failure, holdRead, language = 'zh-CN';
 const i18n = require('../assets/i18n.js'), catalog = require('../assets/locales.json');
 const document = {activeElement: null, hasFocus: () => true,
  getElementById: id => elements.get(id), createElement: tag => new Element(tag),
  addEventListener: (name, fn) => events.set(name, fn)};
 class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.events = new Map(); this.disabled = false; this.hidden = false; }
  setAttribute(name, value) { this[name] = value; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  appendChild(node) { node.remove(); this.children.push(node); node.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); this.parent = null; }
  querySelector(tag) { return this.children.find(node => node.tag === tag); }
  addEventListener(name, fn) { this.events.set(name, fn); }
  focus() { document.activeElement = this; }
 }
 for (const id of ['panel-menu', 'panel-title', 'panel-error', 'conversions', 'actions', 'quit-action']) elements.set(id, new Element('div'));
 const buttons = () => ['conversions', 'actions', 'quit-action'].flatMap(id => elements.get(id).children);
 elements.get('panel-menu').querySelectorAll = buttons;
 const tauri = {core: {invoke: async (command, args) => {
  calls.push({command, args});
  if (command === 'tray_panel_state') {
   const current = structuredClone(value);
   if (holdRead) await holdRead;
   return current;
  }
  if (command === 'tray_panel_action') { if (hold) await hold; if (failure) throw failure; }
 }}, event: {listen: async (_, fn) => { subscriber = fn; return () => {}; }}};
 vm.runInNewContext(source, {document, window: {__TAURI__: tauri, md2chatLocales: catalog, md2chatI18n: {t: source => i18n.translate(source,language)}, addEventListener: (name, fn) => windowEvents.set(name, fn)}});
 await tick();
 return {
  calls, elements, buttons,
  language(code) {language=code;windowEvents.get('md2chat:language')?.();},
  focused: () => document.activeElement?.dataset.action,
  key(key, shiftKey = false) { const event = {key, shiftKey, preventDefault() { this.prevented = true; }}; events.get('keydown')(event); return event; },
  async click(id) { buttons().find(row => row.dataset.action === id).events.get('click')(); await tick(); },
  async emit(next) { value = next; subscriber({payload: structuredClone(next)}); await tick(); },
  async focus() { windowEvents.get('focus')(); await tick(); },
  pauseAction() { let release; hold = new Promise(resolve => { release = resolve; }); return () => { hold = null; release(); }; },
  pauseRead() { let release; holdRead = new Promise(resolve => { release = resolve; }); return () => { holdRead = null; release(); }; },
  fail(reason) { failure = reason; }
 };
}

test('tray panel preserves pinned order, keyboard focus and navigation across busy updates', async () => {
 const ui = await fixture();
 assert.equal(ui.buttons().length, 11);
 for (const row of ui.buttons()) assert(fs.existsSync(path.resolve(__dirname, '..', row.querySelector('img').src)), row.dataset.action);
 assert.equal(ui.focused(), 'convert:wechat');
 ui.key('ArrowUp'); assert.equal(ui.focused(), 'quit');
 ui.key('ArrowDown'); assert.equal(ui.focused(), 'convert:wechat');
 ui.key('End'); assert.equal(ui.focused(), 'quit');
 ui.key('Home'); assert.equal(ui.focused(), 'convert:wechat');
 ui.key('Tab', true); assert.equal(ui.focused(), 'quit');
 const busy = snapshot(); busy.conversions.forEach(item => { item.enabled = false; });
 await ui.emit(busy);
 assert.equal(ui.focused(), 'quit');
 ui.key('Home'); assert.equal(ui.focused(), 'show-main');
 assert(ui.buttons().slice(0, 6).every(row => row.disabled));
 assert.equal(ui.buttons().filter(row => row.tabIndex === 0).length, 1);
 await ui.emit(snapshot());
 assert.equal(ui.focused(), 'show-main');
});

test('tray panel submits once, prevents disabled actions, and stays retryable after errors', async () => {
 const ui = await fixture(), release = ui.pauseAction();
 await ui.click('convert:wechat');
 await ui.click('convert:wechat');
 assert.equal(ui.calls.filter(call => call.command === 'tray_panel_action').length, 1);
 assert(ui.buttons().every(row => row.disabled));
 ui.fail('正在转换…'); release(); await tick();
 assert.equal(ui.elements.get('panel-error').textContent, '正在转换…');
 assert.equal(ui.elements.get('panel-error').hidden, false);
 assert(ui.buttons().every(row => !row.disabled));
 const busy = snapshot(); busy.conversions.forEach(item => { item.enabled = false; });
 await ui.emit(busy); await ui.click('convert:wechat');
 assert.equal(ui.calls.filter(call => call.command === 'tray_panel_action').length, 1);
 ui.key('Escape'); await tick();
 assert.equal(ui.calls.at(-1).command, 'tray_panel_hide');
});

test('a late state read cannot overwrite a newer busy event', async () => {
 const ui = await fixture(), release = ui.pauseRead();
 await ui.focus();
 const busy = snapshot(); busy.conversions.forEach(item => { item.enabled = false; });
 await ui.emit(busy); release(); await tick();
 assert(ui.buttons().slice(0, 6).every(row => row.disabled));
});

test('tray errors follow live language changes, including previously localized native errors',async()=>{
 const ui=await fixture(),i18n=require('../assets/i18n.js');
 ui.language('en');ui.fail('Converting…');await ui.click('show-main');
 // Native text may already have been localized when it reached the panel.
 ui.fail(i18n.translate('正在转换…','en'));await ui.click('show-main');
 for(const code of ['fr','de','ja','zh-CN']){ui.language(code);assert.equal(ui.elements.get('panel-error').textContent,i18n.translate('正在转换…',code));}
});
