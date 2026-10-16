const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {EventEmitter} = require('node:events');
const vm = require('node:vm');
const {createPreferences} = require('../desktop/preferences.cjs');

async function fixture(t, overrides = {}) {
 const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'md2chat-preferences-'));
 t.after(() => fs.rm(directory, {recursive: true, force: true}));
 const handlers = new Map();
 const windows = [];
 const changes = [];
 let login = {supported: true, enabled: false};
 class BrowserWindow extends EventEmitter {
  constructor(options) {
   super(); this.options = options; this.webContents = new EventEmitter();
   this.webContents.mainFrame = {url: ''}; this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler; };
   this.dead = false; this.minimized = false; this.focusCount = 0; this.showCount = 0; this.restoreCount = 0;
   windows.push(this);
  }
  isDestroyed() { return this.dead; }
  isMinimized() { return this.minimized; }
  restore() { this.minimized = false; this.restoreCount++; }
  show() { this.showCount++; }
  focus() { this.focusCount++; }
  setMenu(value) { this.menu = value; }
  async loadFile(file) { this.file = file; this.webContents.mainFrame.url = pathToFileURL(file).href; }
  destroy() { this.dead = true; this.emit('closed'); }
 }
 const options = {
  app: {getPath: () => directory}, BrowserWindow,
  ipcMain: {handle: (channel, handler) => handlers.set(channel, handler), removeHandler: channel => handlers.delete(channel)},
  getLoginState: () => login,
  setLoginState: enabled => { login = {...login, enabled}; return login; },
  onChange: snapshot => changes.push(snapshot), platform: 'darwin', ...overrides
 };
 const controller = await createPreferences(options);
 t.after(() => controller.destroy());
 const event = () => ({sender: windows.at(-1).webContents, senderFrame: windows.at(-1).webContents.mainFrame});
 const invoke = (type, ...args) => handlers.get(`md2chat:preferences-${type}`)(event(), ...args);
 return {controller, directory, file: path.join(directory, 'preferences.json'), windows, handlers, changes, options, event, invoke};
}

test('preferences default, persist only local values, and reload without stale OS state', async t => {
 const f = await fixture(t);
 assert.deepEqual(f.controller.snapshot(), {pinnedTargets: [], showTrayLabel: false, platform: 'darwin', login: {supported: true, enabled: false}});
 await f.controller.open();
 const result = await f.invoke('set', {pinnedTargets: ['dingtalk'], showTrayLabel: true, openAtLogin: true});
 assert.equal(result.login.enabled, true);
 assert.equal(f.changes.length, 1);
 assert.deepEqual(JSON.parse(await fs.readFile(f.file)), {pinnedTargets: ['dingtalk'], showTrayLabel: true});
 f.controller.destroy();
 const reloaded = await createPreferences({...f.options, getLoginState: () => ({supported: true, enabled: false})});
 t.after(() => reloaded.destroy());
 assert.deepEqual(reloaded.snapshot(), {pinnedTargets: ['dingtalk'], showTrayLabel: true, platform: 'darwin', login: {supported: true, enabled: false}});
 const copy = reloaded.snapshot(); copy.login.enabled = true; copy.pinnedTargets.push('email');
 assert.deepEqual(reloaded.snapshot().pinnedTargets, ['dingtalk']);
 assert.equal(reloaded.snapshot().login.enabled, false);
});

test('damaged or invalid saved preferences warn and safely use defaults; IO failures propagate', async t => {
 const f = await fixture(t);
 f.controller.destroy();
 const warnings = [];
 const original = console.warn;
 console.warn = (...args) => warnings.push(args);
 try {
  for (const content of ['{invalid', '{"pinnedTarget":"other"}', '{"showTrayLabel":1}', '{"openAtLogin":true}', 'null', '[]', '{"pinnedTargets":["wechat","wechat"]}', '{"pinnedTargets":["qq"]}', '{"pinnedTargets":"wechat"}', '{"pinnedTargets":null}', '{"pinnedTarget":"email","pinnedTargets":["qq"]}', '{"unknown":true}']) {
   await fs.writeFile(f.file, content);
   const controller = await createPreferences(f.options);
   assert.deepEqual(controller.snapshot().pinnedTargets, []);
   assert.equal(controller.snapshot().showTrayLabel, false);
   controller.destroy();
  }
 } finally { console.warn = original; }
 assert.equal(warnings.length, 12);
 await assert.rejects(createPreferences({...f.options, app: {getPath: () => f.file}}), {code: 'ENOTDIR'});
});

test('invalid patches and unsupported login changes cannot change preferences', async t => {
 const f = await fixture(t, {getLoginState: () => ({supported: false, enabled: false, reason: '请先安装'})});
 await f.controller.open();
 for (const patch of [null, [], 'wechat', {pinnedTarget: 'wechat'}, {pinnedTargets: undefined}, {pinnedTargets: null}, {pinnedTargets: 'wechat'}, {pinnedTargets: ['qq']}, {pinnedTargets: ['wechat', 'wechat']}, {pinnedTargets: Array(6).fill('wechat')}, {pinnedTargets: new Array(1)}, {showTrayLabel: 'yes'}, {openAtLogin: 1}, {extra: true}, Object.create({pinnedTargets: ['email']})]) {
  assert.throws(() => f.invoke('set', patch));
 }
 await assert.rejects(f.invoke('set', {pinnedTargets: ['email'], openAtLogin: true}), /请先安装/);
 assert.deepEqual(f.controller.snapshot().pinnedTargets, []);
 assert.equal(f.changes.length, 0);
 await assert.rejects(fs.stat(f.file), {code: 'ENOENT'});
});

test('legacy single targets migrate to ordered arrays and the new field takes precedence', async t => {
 const f = await fixture(t);
 f.controller.destroy();
 for (const [saved, expected] of [
  [{pinnedTarget: null}, []],
  [{pinnedTarget: 'wechat', showTrayLabel: true}, ['wechat']],
  [{pinnedTarget: 'email', pinnedTargets: ['feishu', 'dingtalk']}, ['feishu', 'dingtalk']],
  [{pinnedTarget: 'invalid-old-field', pinnedTargets: []}, []]
 ]) {
  await fs.writeFile(f.file, JSON.stringify(saved));
  const controller = await createPreferences(f.options);
  try {
   assert.deepEqual(controller.snapshot().pinnedTargets, expected);
   assert.equal(Object.hasOwn(controller.snapshot(), 'pinnedTarget'), false);
   await controller.open();
   const window = f.windows.at(-1);
   await f.handlers.get('md2chat:preferences-set')({sender: window.webContents, senderFrame: window.webContents.mainFrame}, {showTrayLabel: !controller.snapshot().showTrayLabel});
   const written = JSON.parse(await fs.readFile(f.file));
   assert.deepEqual(written.pinnedTargets, expected);
   assert.equal(Object.hasOwn(written, 'pinnedTarget'), false);
  } finally { controller.destroy(); }
 }
});

test('multiple tray formats retain selection order, reorder, and clear durably', async t => {
 const f = await fixture(t);
 await f.controller.open();
 const selected = ['email', 'wechat', 'feishu', 'dingtalk', 'wecom'];
 await f.invoke('set', {pinnedTargets: selected});
 assert.deepEqual(f.controller.snapshot().pinnedTargets, selected);
 const reordered = ['wechat', 'email', 'feishu', 'dingtalk', 'wecom'];
 await f.invoke('set', {pinnedTargets: reordered});
 assert.deepEqual(JSON.parse(await fs.readFile(f.file)).pinnedTargets, reordered);
 assert.deepEqual(f.changes.map(state => state.pinnedTargets), [selected, reordered]);
 await f.invoke('set', {pinnedTargets: []});
 assert.deepEqual(JSON.parse(await fs.readFile(f.file)), {pinnedTargets: [], showTrayLabel: false});
 assert.equal(f.changes.length, 3);
});

test('queued patches, snapshots, and change callbacks cannot mutate stored format arrays', async t => {
 let release;
 let started;
 const beginning = new Promise(resolve => { started = resolve; });
 const blocked = new Promise(resolve => { release = resolve; });
 const f = await fixture(t, {
  setLoginState: async () => { started(); await blocked; },
  onChange: state => { state.pinnedTargets.push('email'); }
 });
 await f.controller.open();
 const first = f.invoke('set', {openAtLogin: true});
 await beginning;
 const selection = ['feishu', 'wechat'];
 const patch = {pinnedTargets: selection};
 const pending = f.invoke('set', patch);
 selection.reverse();
 patch.pinnedTargets = ['wecom'];
 release();
 const [, returned] = await Promise.all([first, pending]);
 assert.deepEqual(returned.pinnedTargets, ['feishu', 'wechat']);
 returned.pinnedTargets.push('email');
 assert.deepEqual(f.controller.snapshot().pinnedTargets, ['feishu', 'wechat']);
 const snapshot = f.controller.snapshot();
 snapshot.pinnedTargets.reverse();
 snapshot.pinnedTargets.push('dingtalk');
 const viaIPC = f.invoke('get');
 viaIPC.pinnedTargets.length = 0;
 assert.deepEqual(f.controller.snapshot().pinnedTargets, ['feishu', 'wechat']);
 assert.deepEqual(JSON.parse(await fs.readFile(f.file)).pinnedTargets, ['feishu', 'wechat']);
});

test('concurrent updates are serialized and merged with successful atomic files', async t => {
 let release;
 let started;
 const beginning = new Promise(resolve => { started = resolve; });
 const blocked = new Promise(resolve => { release = resolve; });
 const f = await fixture(t, {setLoginState: async () => { started(); await blocked; }});
 await f.controller.open();
 const first = f.invoke('set', {pinnedTargets: ['wechat'], openAtLogin: true});
 await beginning;
 const second = f.invoke('set', {showTrayLabel: true});
 assert.deepEqual(f.controller.snapshot().pinnedTargets, []);
 release();
 const [one, two] = await Promise.all([first, second]);
 assert.equal(one.showTrayLabel, false);
 assert.deepEqual(two.pinnedTargets, ['wechat']);
 assert.equal(two.showTrayLabel, true);
 assert.deepEqual(JSON.parse(await fs.readFile(f.file)), {pinnedTargets: ['wechat'], showTrayLabel: true});
 assert.deepEqual(await fs.readdir(f.directory), ['preferences.json']);
 assert.equal(f.changes.length, 2);
});

test('disabling login requires fresh OS confirmation before saving; pending enable remains valid', async t => {
 let login = {supported: true, registered: true, enabled: true};
 let requested;
 const f = await fixture(t, {
  getLoginState: () => login,
  setLoginState: async enabled => { requested = enabled; return {supported: true, registered: false, enabled: false}; }
 });
 await f.controller.open();
 const message = '系统尚未确认移除登录项，请在系统启动项设置中检查。';
 await assert.rejects(f.invoke('set', {openAtLogin: false, pinnedTargets: ['email']}), {message});
 assert.equal(requested, false);
 assert.deepEqual(f.controller.snapshot().pinnedTargets, []);
 assert.equal(f.changes.length, 0);
 await assert.rejects(fs.stat(f.file), {code: 'ENOENT'});
 login = {supported: true, enabled: true};
 await assert.rejects(f.invoke('set', {openAtLogin: false}), {message});
 login = {supported: true, registered: false, enabled: false};
 await f.invoke('set', {openAtLogin: false});
 assert.equal(f.changes.length, 1);
 login = {supported: true, registered: true, enabled: false, pending: true};
 const pending = await f.invoke('set', {openAtLogin: true});
 assert.equal(pending.login.pending, true);
 assert.equal(pending.login.enabled, false);
 assert.equal(f.changes.length, 2);
});

test('failed saves and OS changes leave local state unchanged and the queue recovers', async t => {
 const f = await fixture(t, {setLoginState: () => { throw new Error('OS failed'); }});
 await f.controller.open();
 await assert.rejects(f.invoke('set', {pinnedTargets: ['email'], openAtLogin: true}), /OS failed/);
 await fs.mkdir(f.file);
 await assert.rejects(f.invoke('set', {pinnedTargets: ['feishu']}));
 assert.deepEqual(f.controller.snapshot().pinnedTargets, []);
 assert.equal(f.changes.length, 0);
 assert.deepEqual(await fs.readdir(f.directory), ['preferences.json']);
 await fs.rmdir(f.file);
 await f.invoke('set', {pinnedTargets: ['wecom']});
 assert.deepEqual(f.controller.snapshot().pinnedTargets, ['wecom']);
 assert.equal(f.changes.length, 1);
});

test('IPC trusts only the preferences window main frame at its exact local URL', async t => {
 const f = await fixture(t);
 const get = f.handlers.get('md2chat:preferences-get');
 const set = f.handlers.get('md2chat:preferences-set');
 assert.throws(() => get({sender: {}, senderFrame: {}}), /不能访问/);
 await f.controller.open();
 const window = f.windows[0];
 const frame = window.webContents.mainFrame;
 const trusted = f.event();
 assert.equal(get(trusted).showTrayLabel, false);
 const attackers = [
  {sender: {}, senderFrame: frame},
  {sender: window.webContents, senderFrame: {url: frame.url}},
  {sender: window.webContents, senderFrame: null}
 ];
 for (const event of attackers) {
  assert.throws(() => get(event), /不能访问/);
  assert.throws(() => set(event, {pinnedTargets: ['email']}), /不能访问/);
 }
 const originalURL = frame.url;
 for (const url of ['https://example.com/', originalURL + '?other=1', originalURL.replace('preferences.html', 'editor.html')]) {
  frame.url = url;
  assert.throws(() => get(trusted), /不能访问/);
 }
 frame.url = originalURL;
 f.controller.destroy();
 assert.equal(f.handlers.size, 0);
 assert.throws(() => get(trusted), /不能访问/);
});

test('preferences window is isolated, reused, restored, and reopened; navigation stays blocked', async t => {
 const f = await fixture(t);
 const [one, two] = await Promise.all([f.controller.open(), f.controller.open()]);
 assert.equal(one, two);
 assert.equal(f.windows.length, 1);
 assert.equal(one.options.title, '首选项 · md2chat');
 assert.deepEqual(one.options.webPreferences, {preload: path.resolve(__dirname, '../desktop/preferences-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false});
 assert.equal(one.menu, null);
 assert.deepEqual(one.openHandler({url: 'https://example.com'}), {action: 'deny'});
 for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
  let prevented = false;
  one.webContents.emit(name, {preventDefault: () => { prevented = true; }});
  assert.equal(prevented, true);
 }
 one.minimized = true;
 await f.controller.open();
 assert.equal(one.restoreCount, 1);
 assert.equal(one.focusCount, 2);
 one.destroy();
 const reopened = await f.controller.open();
 assert.notEqual(reopened, one);
 assert.equal(f.windows.length, 2);
 f.controller.destroy();
 assert.equal(reopened.isDestroyed(), true);
 await assert.rejects(f.controller.open(), /已关闭/);
});

test('preferences preload exposes only the get and set capability', async () => {
 const source = await fs.readFile(path.resolve(__dirname, '../desktop/preferences-preload.cjs'), 'utf8');
 let api;
 const calls = [];
 vm.runInNewContext(source, {require: name => {
  assert.equal(name, 'electron');
  return {contextBridge: {exposeInMainWorld: (name, value) => { assert.equal(name, 'md2chatPreferences'); api = value; }}, ipcRenderer: {invoke: (...args) => { calls.push(args); return Promise.resolve({}); }}};
 }});
 assert.deepEqual(Object.keys(api), ['get', 'set']);
 assert.equal(Object.isFrozen(api), true);
 await api.get(); await api.set({pinnedTargets: ['wechat']});
 assert.deepEqual(calls, [['md2chat:preferences-get'], ['md2chat:preferences-set', {pinnedTargets: ['wechat']}]]);
});
