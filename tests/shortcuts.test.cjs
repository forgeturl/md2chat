const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const keys = require('../assets/shortcuts.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const binding = {modifiers: ['Control', 'Alt'], key: 'Digit7'};

test('shortcut input is limited, normalized and checked for duplicate and reserved combinations on both systems', () => {
 assert.deepEqual(keys.binding({modifiers: ['Alt', 'Control'], key: 'Digit7'}, 'win32'), binding);
 for (const platform of ['darwin', 'win32']) {
  for (const value of [null, {modifiers: [], key: 'Digit7'}, {modifiers: ['Control', 'Control'], key: 'Digit7'},
   {modifiers: ['Control', 'Alt', 'Shift'], key: 'Digit7'}, {modifiers: ['Alt'], key: 'KeyA'},
   {modifiers: ['Control'], key: 'F12'}, {modifiers: ['Control'], key: 'Space'}]) {
   assert.throws(() => keys.binding(value, platform));
  }
  assert.throws(() => keys.configuration({enabled: false, bindings: {email: binding, image: {...binding, modifiers: ['Alt', 'Control']}}}, platform), /已绑定/);
 }
 assert.throws(() => keys.binding({modifiers: ['Control'], key: 'KeyC'}, 'win32'), /常用编辑/);
 assert.throws(() => keys.binding({modifiers: ['Control'], key: 'KeyC'}, 'darwin'), /常用编辑/);
 assert.throws(() => keys.binding({modifiers: ['Meta', 'Control'], key: 'KeyQ'}, 'darwin'), /系统操作/);
 assert.throws(() => keys.binding({modifiers: ['Meta', 'Shift'], key: 'Digit4'}, 'darwin'), /系统操作/);
 assert.throws(() => keys.binding({modifiers: ['Meta'], key: 'Digit7'}, 'win32'));
 assert.equal(keys.format({modifiers: ['Alt', 'Meta'], key: 'Digit7'}, 'darwin'), '⌥ ⌘ 7');
 assert.equal(keys.format(binding, 'win32'), 'Ctrl + Alt + 7');
});

test('recording ignores modifier-only presses and rejects IME or AltGr input', () => {
 assert.equal(keys.fromEvent({code: 'ControlLeft', key: 'Control'}, 'win32'), null);
 assert.deepEqual(keys.fromEvent({code: 'Digit7', key: '7', ctrlKey: true, altKey: true}, 'win32'), binding);
 for (const extra of [{isComposing: true}, {key: 'Dead'}, {getModifierState: key => key === 'AltGraph'}]) {
  assert.throws(() => keys.fromEvent({code: 'Digit7', ctrlKey: true, altKey: true, ...extra}, 'win32'), /输入法/);
 }
});

test('suggestions avoid existing bindings without claiming or probing system availability', () => {
 const state = {enabled: false, bindings: {email: binding}};
 const suggestions = keys.suggestions(state, 'image', 'win32');
 assert(suggestions.length > 6);
 assert(!suggestions.some(value => keys.identity(value) === keys.identity(binding)));
 for (const value of suggestions) assert.deepEqual(keys.binding(value, 'win32'), value);
});

async function fixture(initial = {}) {
 const elements = new Map(), events = new Map(), documentEvents = new Map(), calls = [];
 let state = {platform: 'darwin', configuration: {enabled: false, bindings: {}}, statuses: {}, sessionId: null, ...clone(initial)};
 let sessionSequence = 0, failure = null, pendingSession = null, onTest, subscription;
 const document = {
  getElementById: id => elements.get(id),
  addEventListener: (name, callback) => documentEvents.set(name, callback),
  removeEventListener: (name, callback) => { if (documentEvents.get(name) === callback) documentEvents.delete(name); }
 };
 class Element {
  constructor() { this.events = new Map(); this.dataset = {}; this.disabled = false; this.hidden = false; }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setAttribute(name, value) { this[name] = value; }
  focus() { document.activeElement = this; }
  closest(selector) { return selector === '[data-shortcut-action]' ? this : this.row || null; }
 }
 for (const id of ['shortcut-settings', 'shortcuts-enabled', 'shortcuts-status', 'shortcuts-warning', 'shortcuts-retry', 'shortcuts-test', 'shortcuts-capture', 'shortcuts-captured-key', 'shortcuts-save', 'shortcuts-cancel']) elements.set(id, new Element());
 const rows = new Map(keys.targets.map(target => {
  const row = new Element(); row.dataset = {shortcutTarget: target, label: target};
  row.controls = Object.fromEntries(['record', 'suggest', 'clear', 'status'].map(action => {
   const control = new Element(); control.dataset.shortcutAction = action; control.row = row;
   return [action, control];
  }));
  row.querySelector = selector => selector === '[data-shortcut-status]' ? row.controls.status : row.controls[selector.match(/="(\w+)"/)[1]];
  return [target, row];
 }));
 elements.get('shortcut-settings').querySelectorAll = () => [...rows.values()];
 function publish() {
  state.statuses = Object.fromEntries(Object.keys(state.configuration.bindings).map(target => [target,
   !state.configuration.enabled ? 'disabled' : state.recording ? 'paused' : 'registered']));
  return clone(state);
 }
 const bridge = {
  get: async () => { calls.push(['get']); return publish(); },
  set: async configuration => {
   calls.push(['set', clone(configuration)]);
   if (failure) throw failure;
   state.configuration = clone(configuration); return publish();
  },
  session: async mode => {
   calls.push(['session', mode]);
   if (pendingSession) await pendingSession;
   state.sessionId = ++sessionSequence; state.recording = mode === 'record'; return publish();
  },
  endSession: async id => { calls.push(['endSession', id]); state.sessionId = null; state.recording = false; return publish(); },
  subscribe: callback => { subscription = callback; },
  onTest: callback => { onTest = callback; }
 };
 let locale='zh-CN';const i18n=require('../assets/i18n.js');
 const window = {md2chatShortcuts: bridge, ShortcutKeys: keys, md2chatI18n:{t:source=>i18n.translate(source,locale)}, addEventListener: (name, callback) => events.set(name, callback)};
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/shortcut-settings.js'), 'utf8'), {window, document, setTimeout, clearTimeout});
 await tick();
 return {
  elements, rows, calls, documentEvents,
  async language(code){locale=code;events.get('md2chat:language')?.();await tick();},
  async click(id) { const control = elements.get(id); if (!control.disabled) control.events.get('click')?.({target: control}); await tick(); },
  async action(target, action) { const control = rows.get(target).controls[action]; elements.get('shortcut-settings').events.get('click')({target: control}); await tick(); },
  async enable(value) { const control = elements.get('shortcuts-enabled'); control.checked = value; control.events.get('change')(); await tick(); },
  async key(extra) { const event = {key: '7', code: 'Digit7', ctrlKey: true, altKey: true, preventDefault() {}, stopPropagation() {}, ...extra}; documentEvents.get('keydown')?.(event); await tick(); },
  async event(name) { events.get(name)?.(); await tick(); },
  fail: error => { failure = error; },
  pauseSession: () => { let release; pendingSession = new Promise(resolve => { release = resolve; }); return () => { pendingSession = null; release(); }; },
  receive: value => onTest({sessionId: state.sessionId, target: 'email', ...value}),
  publish: patch => { state = {...state, ...clone(patch)}; subscription(publish()); }
 };
}

test('disabled UI only loads settings, attaches no key handler, and saves without silently enabling', async () => {
 const f = await fixture();
 assert.equal(f.elements.get('shortcuts-enabled').checked, false);
 assert.deepEqual(f.calls, [['get']]);
 assert.equal(f.documentEvents.has('keydown'), false);
 await f.action('email', 'suggest');
 assert.equal(f.calls.at(-1)[0], 'set');
 assert.equal(f.calls.at(-1)[1].enabled, false);
 assert.equal(f.rows.get('email').controls.status.textContent, '启用时检查可用性');
 assert.equal(f.documentEvents.has('keydown'), false);
 await f.action('email', 'clear');
 assert.deepEqual(f.calls.at(-1)[1], {enabled: false, bindings: {}});
});

test('recording saves one valid combination only after confirmation and cleans up listeners', async () => {
 const f = await fixture();
 await f.action('email', 'record');
 assert.equal(f.documentEvents.has('keydown'), true);
 await f.key({shiftKey: true});
 assert.equal(f.elements.get('shortcuts-save').disabled, true);
 await f.key();
 assert.equal(f.elements.get('shortcuts-save').disabled, false);
 assert.equal(f.calls.filter(call => call[0] === 'set').length, 0);
 await f.click('shortcuts-save');
 assert.deepEqual(f.calls.at(-1), ['set', {enabled: false, bindings: {email: binding}}]);
 assert.equal(f.documentEvents.has('keydown'), false);
 assert.equal(f.elements.get('shortcuts-capture').hidden, true);
 assert(f.calls.findIndex(call => call[0] === 'endSession') < f.calls.findIndex(call => call[0] === 'set'));
});

test('master switch saves the requested value and preserves bindings when toggled off and back on', async () => {
 const f = await fixture({configuration: {enabled: false, bindings: {email: binding}}});
 await f.enable(true);
 assert.equal(f.elements.get('shortcuts-enabled').checked, true);
 assert.deepEqual(f.calls.at(-1), ['set', {enabled: true, bindings: {email: binding}}]);
 assert.equal(f.rows.get('email').controls.status.textContent, '已注册');
 await f.enable(false);
 assert.equal(f.elements.get('shortcuts-enabled').checked, false);
 assert.deepEqual(f.calls.at(-1), ['set', {enabled: false, bindings: {email: binding}}]);
});

test('Escape, blur, timeout state updates and a blur during startup cancel without saving', async () => {
 const f = await fixture();
 for (const cancel of [() => f.key({key: 'Escape', code: 'Escape'}), () => f.event('blur'), () => f.publish({sessionId: null})]) {
  await f.action('email', 'record'); await f.key(); await cancel(); await tick();
  assert.equal(f.documentEvents.has('keydown'), false);
  assert.equal(f.elements.get('shortcuts-capture').hidden, true);
 }
 const release = f.pauseSession();
 await f.action('email', 'record'); await f.event('blur'); release(); await tick(); await tick();
 assert.equal(f.documentEvents.has('keydown'), false);
 assert.equal(f.elements.get('shortcuts-capture').hidden, true);
 assert.equal(f.calls.filter(call => call[0] === 'set').length, 0);
});

test('duplicates and save failures preserve the previous binding and master switch', async () => {
 const f = await fixture({configuration: {enabled: true, bindings: {email: binding}}});
 await f.action('image', 'record'); await f.key();
 assert.equal(f.elements.get('shortcuts-save').disabled, true);
 assert.match(f.elements.get('shortcuts-status').textContent, /已绑定/);
 await f.click('shortcuts-cancel');
 f.fail(new Error(keys.unavailable));
 await f.enable(false);
 assert.equal(f.elements.get('shortcuts-enabled').checked, true);
 assert.equal(f.rows.get('email').controls.record.textContent, '⌃ ⌥ 7');
 assert.match(f.elements.get('shortcuts-status').textContent, /注册失败/);
});

test('test sessions report reception without configuration or conversion calls and restore on exit', async () => {
 const f = await fixture({configuration: {enabled: true, bindings: {email: binding}}});
 await f.click('shortcuts-test');
 assert.equal(f.elements.get('shortcuts-save').hidden, true);
 f.receive(); assert.match(f.elements.get('shortcuts-status').textContent, /剪贴板未改变/);
 await f.key({key: 'Escape', code: 'Escape'});
 assert.equal(f.documentEvents.has('keydown'), false);
 assert.equal(f.calls.some(call => call[0] === 'set'), false);
 assert.deepEqual(f.calls.map(call => call[0]), ['get', 'session', 'endSession']);
});

test('shortcut scripts are scoped to preferences and do not change the web editor keyboard path', () => {
 const markup = fs.readFileSync(require.resolve('../desktop/preferences.html'), 'utf8');
 assert(markup.includes('shortcut-settings.js'));
 assert(!/<input[^>]+id="shortcuts-enabled"[^>]+checked/.test(markup));
 for (const file of ['../editor.html', '../index.html']) assert(!fs.readFileSync(require.resolve(file), 'utf8').includes('shortcut-settings.js'));
});

test('shortcut UI and runtime messages have translations in every supported language', () => {
 const data = require('../assets/i18n-data.js');
 const files = ['../assets/shortcuts.js', '../assets/shortcut-settings.js',
  '../src-tauri/src/shortcuts/config.rs', '../src-tauri/src/shortcuts/registry.rs', '../src-tauri/src/shortcuts/mod.rs'];
 const messages = new Set();
 for (const file of files) {
  const source = fs.readFileSync(require.resolve(file), 'utf8').split('#[cfg(test)]')[0];
  for (const match of source.matchAll(/['"]([^'"\n]*[\u3400-\u9fff][^'"\n]*)['"]/g)) if (match[1].length < 150 && !/[<>]/.test(match[1])) messages.add(match[1]);
 }
 const html = fs.readFileSync(require.resolve('../desktop/preferences.html'), 'utf8').split('<section id="shortcut-settings"')[1].split('</section>')[0];
 for (const match of html.matchAll(/>([^<>]*[\u3400-\u9fff][^<>]*)</g)) messages.add(match[1]);
 for (const message of messages) for (const {code} of data.locales) assert.equal(typeof data.messages[message]?.[code], 'string', `${code}: ${message}`);
});

test('shortcut status follows live language switching without reloading settings or registering keys',async()=>{
 const f=await fixture(),i18n=require('../assets/i18n.js');
 for(const code of ['en','fr','de','ja','zh-CN']){
  await f.language(code);assert.equal(f.elements.get('shortcuts-status').textContent,i18n.translate('全局快捷键已关闭，不占用任何按键。',code));
 }
 assert.deepEqual(f.calls,[['get']]);assert.equal(f.documentEvents.has('keydown'),false);
});
