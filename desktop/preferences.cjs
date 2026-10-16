const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {randomUUID} = require('node:crypto');

const CHANNEL_GET = 'md2chat:preferences-get';
const CHANNEL_SET = 'md2chat:preferences-set';
const TARGETS = new Set(['wechat', 'dingtalk', 'feishu', 'wecom', 'email']);
const defaults = () => ({pinnedTargets: [], showTrayLabel: false});

function validatePatch(patch, allowLogin = true) {
 if (!patch || typeof patch !== 'object' || Array.isArray(patch) || ![Object.prototype, null].includes(Object.getPrototypeOf(patch))) throw new Error('首选项必须是一个设置对象。');
 const allowed = allowLogin ? ['pinnedTargets', 'showTrayLabel', 'openAtLogin'] : ['pinnedTargets', 'showTrayLabel'];
 const result = {};
 for (const key of Reflect.ownKeys(patch)) {
  if (!allowed.includes(key)) throw new Error('包含未知的首选项。');
  const value = patch[key];
  if (key === 'pinnedTargets') {
   if (!Array.isArray(value) || value.length > TARGETS.size || new Set(value).size !== value.length || [...value].some(target => !TARGETS.has(target))) throw new Error('请选择不重复的有效托盘格式。');
   result[key] = [...value];
  } else {
   if (typeof value !== 'boolean') throw new Error('首选项开关必须为布尔值。');
   result[key] = value;
  }
 }
 return result;
}

async function readPreferences(file) {
 let raw;
 try { raw = await fs.readFile(file, 'utf8'); }
 catch (error) { if (error.code === 'ENOENT') return defaults(); throw error; }
 try {
  const saved = JSON.parse(raw);
  if (saved && typeof saved === 'object' && !Array.isArray(saved) && Object.hasOwn(saved, 'pinnedTarget')) {
   if (!Object.hasOwn(saved, 'pinnedTargets')) {
    if (saved.pinnedTarget !== null && !TARGETS.has(saved.pinnedTarget)) throw new Error('已保存的托盘格式无效。');
    saved.pinnedTargets = saved.pinnedTarget === null ? [] : [saved.pinnedTarget];
   }
   delete saved.pinnedTarget;
  }
  return {...defaults(), ...validatePatch(saved, false)};
 }
 catch (error) {
  console.warn('md2chat: 无法读取已保存的首选项，使用默认设置。', error.message);
  return defaults();
 }
}

async function writePreferences(file, preferences) {
 await fs.mkdir(path.dirname(file), {recursive: true});
 const temporary = `${file}.${randomUUID()}.tmp`;
 try {
  await fs.writeFile(temporary, JSON.stringify(preferences, null, 2) + '\n', {encoding: 'utf8', mode: 0o600, flag: 'wx'});
  await fs.rename(temporary, file);
 } finally { await fs.rm(temporary, {force: true}).catch(() => {}); }
}

async function createPreferences({app, BrowserWindow, ipcMain, nativeImage, getLoginState, setLoginState, onChange = () => {}, platform = process.platform}) {
 const file = path.join(app.getPath('userData'), 'preferences.json');
 const page = path.join(__dirname, 'preferences.html');
 const pageURL = pathToFileURL(page).href;
 let preferences = await readPreferences(file);
 let window = null;
 let opening = null;
 let destroyed = false;
 let operations = Promise.resolve();
 const snapshot = () => ({...preferences, pinnedTargets: [...preferences.pinnedTargets], platform, login: {...getLoginState()}});
 function assertTrusted(event) {
  const contents = window && !window.isDestroyed() && window.webContents;
  if (destroyed || !contents || event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== pageURL) throw new Error('此窗口不能访问首选项。');
 }
 function enqueue(patch) {
  const operation = operations.then(async () => {
   if (destroyed) throw new Error('首选项已关闭。');
   if (Object.hasOwn(patch, 'openAtLogin')) {
    const state = getLoginState();
    if (!state.supported) throw new Error(state.reason || '当前不能设置开机自启动。');
    await setLoginState(patch.openAtLogin);
    const updated = getLoginState();
    if (!patch.openAtLogin && (updated.registered ?? updated.enabled)) throw new Error('系统尚未确认移除登录项，请在系统启动项设置中检查。');
   }
   const next = {...preferences, pinnedTargets: Object.hasOwn(patch, 'pinnedTargets') ? [...patch.pinnedTargets] : [...preferences.pinnedTargets]};
   if (Object.hasOwn(patch, 'showTrayLabel')) next.showTrayLabel = patch.showTrayLabel;
   if (next.pinnedTargets.length !== preferences.pinnedTargets.length || next.pinnedTargets.some((target, index) => target !== preferences.pinnedTargets[index]) || next.showTrayLabel !== preferences.showTrayLabel) {
    await writePreferences(file, next);
    preferences = next;
   }
   const result = snapshot();
   if (Reflect.ownKeys(patch).length) {
    try { await onChange({...result, pinnedTargets: [...result.pinnedTargets], login: {...result.login}}); }
    catch (error) { console.warn('md2chat: 首选项已保存，但刷新界面失败。', error.message); }
   }
   return result;
  });
  operations = operation.catch(() => {});
  return operation;
 }
 ipcMain.handle(CHANNEL_GET, event => { assertTrusted(event); return snapshot(); });
 ipcMain.handle(CHANNEL_SET, (event, patch) => { assertTrusted(event); return enqueue(validatePatch(patch)); });

 async function open() {
  if (destroyed) throw new Error('首选项已关闭。');
  if (opening) return opening;
  if (window && !window.isDestroyed()) {
   if (window.isMinimized()) window.restore();
   window.show(); window.focus();
   return window;
  }
  const icon = nativeImage?.createFromPath(path.join(__dirname, '../assets/app-icon.png'));
  const current = new BrowserWindow({
   width: 600, height: 680, minWidth: 520, minHeight: 560,
   title: '首选项 · md2chat', backgroundColor: '#f6f8fb', show: false,
   autoHideMenuBar: true, ...(icon && !icon.isEmpty() ? {icon} : {}),
   webPreferences: {preload: path.join(__dirname, 'preferences-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false}
  });
  window = current;
  current.setMenu(null);
  current.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) current.webContents.on(name, event => event.preventDefault());
  current.on('closed', () => { if (window === current) window = null; });
  opening = (async () => {
   try {
    await current.loadFile(page);
    if (destroyed || current.isDestroyed()) throw new Error('首选项窗口已关闭。');
    current.show(); current.focus();
    return current;
   } catch (error) {
    if (!current.isDestroyed()) current.destroy();
    if (window === current) window = null;
    throw error;
   } finally { opening = null; }
  })();
  return opening;
 }
 function destroy() {
  destroyed = true;
  ipcMain.removeHandler(CHANNEL_GET);
  ipcMain.removeHandler(CHANNEL_SET);
  if (window && !window.isDestroyed()) window.destroy();
  window = null;
 }
 return {snapshot, open, destroy};
}

module.exports = {createPreferences};
