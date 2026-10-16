const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../assets/preferences.js'), 'utf8');
const canonical = ['wechat', 'dingtalk', 'feishu', 'wecom', 'email'];
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(initial = {}) {
 const elements = new Map();
 const windowEvents = new Map();
 const calls = [];
 let state = {pinnedTargets: [], showTrayLabel: false, platform: 'darwin', login: {supported: true, enabled: false}, ...initial};
 let fail = null;
 let hold = null;
 let readHold = null;
 let getCount = 0;
 let appendCount = 0;
 const document = {getElementById: id => elements.get(id), activeElement: null};
 class Element {
  constructor(kind, parent = null) {
   this.kind = kind; this.parent = parent; this.dataset = {}; this.events = new Map(); this.classes = new Set();
   this.checked = false; this.disabled = false; this.hidden = false; this.draggable = false;
   this.classList = {
    add: (...names) => names.forEach(name => this.classes.add(name)),
    remove: (...names) => names.forEach(name => this.classes.delete(name)),
    toggle: (name, force) => {
     const enabled = force ?? !this.classes.has(name);
     if (enabled) this.classes.add(name); else this.classes.delete(name);
    }
   };
  }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setAttribute(name, value) { this[name] = value; }
  focus() { document.activeElement = this; }
  closest(selector) {
   if (selector === '.target-option') return this.kind === 'row' ? this : this.parent?.closest(selector) || null;
   if (selector === '[data-move]') return this.kind === 'button' ? this : null;
   if (selector === 'input,button') return ['input', 'button'].includes(this.kind) ? this : null;
   return null;
  }
 }
 for (const id of ['preferences-content', 'target-options', 'target-list', 'tray-label-row', 'show-tray-label', 'open-at-login', 'login-description', 'preferences-status', 'retry-load']) elements.set(id, new Element(id));
 const list = elements.get('target-list');
 const rows = new Map(canonical.map(target => {
  const row = new Element('row'); row.dataset.target = target;
  const input = new Element('input', row); input.name = 'pinnedTargets'; input.value = target;
  const up = new Element('button', row); up.dataset.move = 'up';
  const down = new Element('button', row); down.dataset.move = 'down';
  row.input = input; row.up = up; row.down = down;
  row.querySelector = selector => selector === 'input' ? input : selector.includes('"up"') ? up : down;
  return [target, row];
 }));
 list.children = Array.from(rows.values());
 list.querySelectorAll = () => Array.from(rows.values());
 list.appendChild = row => { appendCount++; list.children = list.children.filter(child => child !== row); list.children.push(row); };
 const bridge = {
  get: async () => { getCount++; const captured = copy(state); if (readHold) await readHold; return captured; },
  set: async patch => {
   calls.push(copy(patch));
   if (hold) await hold;
   if (fail) throw fail;
   state = {...state, ...copy(patch)};
   return copy(state);
  }
 };
 const window = {md2chatPreferences: bridge, addEventListener: (name, callback) => windowEvents.set(name, callback)};
 vm.runInNewContext(source, {document, window});
 await tick();
 const targets = elements.get('target-options');
 function dispatch(name, target, extra = {}) {
  const event = {target, prevented: false, preventDefault() { this.prevented = true; }, ...extra};
  targets.events.get(name)?.(event);
  return event;
 }
 return {
  elements, rows, calls,
  order: () => list.children.map(row => row.dataset.target),
  async select(target, checked) {
   const input = rows.get(target).input; input.checked = checked; input.focus();
   dispatch('change', input); await tick();
  },
  async move(target, direction) {
   const button = rows.get(target)[direction]; button.focus(); dispatch('click', button); await tick();
  },
  dispatch,
  fail: error => { fail = error; },
  pause: () => { let release; hold = new Promise(resolve => { release = resolve; }); return () => { hold = null; release(); }; },
  pauseRead: () => { let release; readHold = new Promise(resolve => { release = resolve; }); return () => { readHold = null; release(); }; },
  setState: patch => { state = {...state, ...copy(patch)}; },
  async focus() { windowEvents.get('focus')(); await tick(); },
  getCount: () => getCount,
  appendCount: () => appendCount,
  focused: () => document.activeElement
 };
}

test('selected tray formats render in saved order, then unselected formats; controls obey boundaries', async () => {
 const f = await fixture({pinnedTargets: ['email', 'wechat'], login: {supported: true, registered: true, enabled: false, pending: true}});
 assert.deepEqual(f.order(), ['email', 'wechat', 'dingtalk', 'feishu', 'wecom']);
 assert.equal(f.rows.get('email').input.checked, true);
 assert.equal(f.rows.get('email').up.disabled, true);
 assert.equal(f.rows.get('email').down.disabled, false);
 assert.equal(f.rows.get('wechat').down.disabled, true);
 assert.equal(f.rows.get('dingtalk').up.disabled, true);
 assert.equal(f.rows.get('dingtalk').down.disabled, true);
 assert.equal(f.rows.get('dingtalk').draggable, false);
 assert.equal(f.elements.get('open-at-login').checked, true);
 assert.equal(f.elements.get('open-at-login').disabled, false);
});

test('checking appends a format, unchecking removes it, and keyboard order actions preserve focus', async () => {
 const f = await fixture({pinnedTargets: ['email', 'wechat']});
 await f.select('feishu', true);
 assert.deepEqual(f.calls.at(-1), {pinnedTargets: ['email', 'wechat', 'feishu']});
 assert.deepEqual(f.order(), ['email', 'wechat', 'feishu', 'dingtalk', 'wecom']);
 await f.move('wechat', 'up');
 assert.deepEqual(f.calls.at(-1), {pinnedTargets: ['wechat', 'email', 'feishu']});
 assert.equal(f.focused(), f.rows.get('wechat').input);
 await f.select('email', false);
 assert.deepEqual(f.calls.at(-1), {pinnedTargets: ['wechat', 'feishu']});
 await f.select('wechat', false);
 await f.select('feishu', false);
 assert.deepEqual(f.calls.at(-1), {pinnedTargets: []});
 assert.deepEqual(f.order(), canonical);
 assert.equal(Array.from(f.rows.values()).some(row => row.input.checked), false);
});

test('save failure restores selections and order and retains a safe Chinese system reason', async () => {
 const f = await fixture({pinnedTargets: ['email', 'wechat']});
 f.fail(new Error("Error invoking remote method 'md2chat:preferences-set': Error: 系统尚未确认移除登录项，请在系统启动项设置中检查。"));
 await f.move('wechat', 'up');
 assert.deepEqual(f.order(), ['email', 'wechat', 'dingtalk', 'feishu', 'wecom']);
 assert.match(f.elements.get('preferences-status').textContent, /系统尚未确认移除登录项/);
 assert.equal(f.rows.get('wechat').down.disabled, true);
 await f.select('feishu', true);
 assert.equal(f.rows.get('feishu').input.checked, false);
 assert.deepEqual(f.order(), ['email', 'wechat', 'dingtalk', 'feishu', 'wecom']);
 f.fail(new Error('保存失败 ENOENT /Users/example/private/preferences.json'));
 await f.select('feishu', true);
 assert.equal(f.elements.get('preferences-status').textContent, '未能保存，已恢复原设置。请重试。');
});

test('drag ordering accepts only an active internal drag of a selected format', async () => {
 const f = await fixture({pinnedTargets: ['wechat', 'email', 'feishu']});
 const transfer = {setData() {}, getData: () => 'email'};
 f.dispatch('drop', f.rows.get('wechat'), {dataTransfer: transfer});
 assert.equal(f.calls.length, 0);
 const rejected = f.dispatch('dragstart', f.rows.get('dingtalk'), {dataTransfer: transfer});
 assert.equal(rejected.prevented, true);
 f.dispatch('drop', f.rows.get('wechat'), {dataTransfer: transfer});
 assert.equal(f.calls.length, 0);
 f.dispatch('dragstart', f.rows.get('wechat'), {dataTransfer: transfer});
 assert.equal(f.dispatch('dragover', f.rows.get('feishu'), {dataTransfer: transfer}).prevented, true);
 f.dispatch('drop', f.rows.get('feishu'), {dataTransfer: transfer});
 await tick();
 assert.deepEqual(f.calls.at(-1), {pinnedTargets: ['email', 'feishu', 'wechat']});
 f.dispatch('dragstart', f.rows.get('wechat'), {dataTransfer: transfer});
 f.dispatch('dragend', f.rows.get('wechat'));
 f.dispatch('drop', f.rows.get('email'), {dataTransfer: transfer});
 assert.equal(f.calls.length, 1);
 f.dispatch('dragstart', f.rows.get('wechat'), {dataTransfer: transfer});
 f.dispatch('drop', f.rows.get('dingtalk'), {dataTransfer: transfer});
 assert.equal(f.calls.length, 1);
});

test('pending saves disable controls and ignore concurrent events; focus refreshes system state', async () => {
 const f = await fixture({pinnedTargets: ['wechat', 'email']});
 const release = f.pause();
 await f.move('email', 'up');
 assert.equal(f.elements.get('target-options').disabled, true);
 assert.equal(f.rows.get('wechat').draggable, false);
 assert.equal(f.rows.get('email').up.disabled, true);
 const reads = f.getCount();
 await f.focus();
 assert.equal(f.getCount(), reads);
 await f.select('feishu', true);
 assert.equal(f.calls.length, 1);
 release(); await tick();
 assert.deepEqual(f.order(), ['email', 'wechat', 'dingtalk', 'feishu', 'wecom']);
 assert.equal(f.rows.get('feishu').input.checked, false);
 assert.equal(f.elements.get('target-options').disabled, false);
 f.setState({login: {supported: true, registered: false, enabled: false}});
 await f.focus();
 assert.equal(f.getCount(), reads + 1);
 assert.equal(f.elements.get('open-at-login').checked, false);
});

test('activating the window refreshes only system login state without disabling or rebuilding drag rows', async () => {
 const f = await fixture({pinnedTargets: ['wechat', 'email'], login: {supported: true, registered: true, enabled: false, pending: true}});
 const appends = f.appendCount();
 const release = f.pauseRead();
 f.setState({pinnedTargets: ['email'], showTrayLabel: true, login: {supported: true, registered: false, enabled: false}});
 await f.focus();
 assert.equal(f.elements.get('target-options').disabled, false);
 assert.equal(f.rows.get('wechat').draggable, true);
 assert.equal(f.elements.get('preferences-content')['aria-busy'], 'false');
 assert.equal(f.appendCount(), appends);
 const transfer = {setData() {}};
 assert.equal(f.dispatch('dragstart', f.rows.get('wechat'), {dataTransfer: transfer}).prevented, false);
 release(); await tick();
 assert.equal(f.elements.get('open-at-login').checked, false);
 assert.equal(f.elements.get('show-tray-label').checked, false);
 assert.deepEqual(f.order(), ['wechat', 'email', 'dingtalk', 'feishu', 'wecom']);
 assert.equal(f.appendCount(), appends);
 f.dispatch('drop', f.rows.get('email'), {dataTransfer: transfer});
 await tick();
 assert.deepEqual(f.calls.at(-1), {pinnedTargets: ['email', 'wechat']});
});

test('a delayed focus refresh cannot overwrite the system snapshot returned by a later save', async () => {
 const f = await fixture({pinnedTargets: ['wechat', 'email'], login: {supported: true, registered: true, enabled: false, pending: true}});
 const releaseRead = f.pauseRead();
 await f.focus();
 f.setState({login: {supported: true, registered: false, enabled: false}});
 await f.move('email', 'up');
 assert.equal(f.elements.get('open-at-login').checked, false);
 assert.deepEqual(f.order(), ['email', 'wechat', 'dingtalk', 'feishu', 'wecom']);
 const appends = f.appendCount();
 releaseRead(); await tick();
 assert.equal(f.elements.get('open-at-login').checked, false);
 assert.deepEqual(f.order(), ['email', 'wechat', 'dingtalk', 'feishu', 'wecom']);
 assert.equal(f.appendCount(), appends);
});

test('out of order focus reads cannot replace the newest system state', async () => {
 const f = await fixture({login: {supported: true, registered: true, enabled: false, pending: true}});
 const releaseOldRead = f.pauseRead();
 await f.focus();
 f.setState({login: {supported: true, registered: false, enabled: false}});
 const releaseNewRead = f.pauseRead();
 await f.focus();
 releaseNewRead(); await tick();
 assert.equal(f.elements.get('open-at-login').checked, false);
 releaseOldRead(); await tick();
 assert.equal(f.elements.get('open-at-login').checked, false);
});
