const path = require('node:path');
const {profiles} = require('../assets/chat-targets.js');
const {createMenuIcons} = require('./menu-icons.cjs');

// Login state belongs to the OS, not a second preferences file that can go stale.
function loginOptions(platform, execPath) {
 return platform === 'win32' ? {path: execPath, args: ['--autostart']} : {};
}
function loginState(app, platform, execPath) {
 if (!app.isPackaged) return {supported: false, enabled: false, reason: '请安装桌面版后设置开机自启动'};
 if (platform === 'darwin' && typeof app.isInApplicationsFolder === 'function' && !app.isInApplicationsFolder()) return {supported: false, enabled: false, reason: '请先把 md2chat 移到「应用程序」'};
 if (!['darwin', 'win32'].includes(platform)) return {supported: false, enabled: false, reason: '此系统不支持开机自启动设置'};
 try {
  const state = app.getLoginItemSettings(loginOptions(platform, execPath));
  const pending = platform === 'darwin' && state.status === 'requires-approval';
  const blocked = platform === 'win32' && state.openAtLogin && state.executableWillLaunchAtLogin === false;
  return {supported: true, registered: !!state.openAtLogin || pending, enabled: !!state.openAtLogin && !pending && !blocked, pending, blocked, wasOpenedAtLogin: !!state.wasOpenedAtLogin};
 } catch {
  return {supported: false, enabled: false, reason: '暂时无法读取系统启动项'};
 }
}
function setLogin(app, platform, execPath, enabled) {
 if (!loginState(app, platform, execPath).supported) throw new Error('当前不能设置开机自启动，请先安装桌面版。');
 app.setLoginItemSettings({...loginOptions(platform, execPath), openAtLogin: enabled, ...(platform === 'win32' ? {enabled} : {})});
 return loginState(app, platform, execPath);
}
function startHidden(app, platform, argv, execPath) {
 if (platform === 'win32') return argv.includes('--autostart');
 return platform === 'darwin' && loginState(app, platform, execPath).wasOpenedAtLogin === true;
}
function createIntegration({app, Tray, Menu, nativeImage, dialog, shell, showWindow, openPreferences = showWindow, getPreferences = () => ({pinnedTargets: [], showTrayLabel: false}), checkUpdates = showWindow, convertClipboard, convertClipboardToImage, getClipboardConversionState = () => ({busy: false}), platform = process.platform, execPath = process.execPath}) {
 const menuIcon = createMenuIcons(nativeImage);
 let tray, trayMenu;
 function preferences() {
  try {
   const value = getPreferences();
   const pinnedTargets = Array.isArray(value?.pinnedTargets) ? [...new Set(value.pinnedTargets.filter(target => typeof target === 'string' && Object.hasOwn(profiles, target)))] : [];
   return {pinnedTargets, showTrayLabel: value?.showTrayLabel === true};
  } catch { return {pinnedTargets: [], showTrayLabel: false}; }
 }
 const formatItem = (target, busy) => ({label: (target === 'wecom' ? '企业微信' : profiles[target].label) + '格式', icon: menuIcon(target), enabled: !busy, click: () => convertClipboard(target)});
 function clipboardItems(busy) {
  const submenu = [
   ...(typeof convertClipboardToImage === 'function' ? [{label: '转图片', icon: menuIcon('image'), enabled: !busy, click: convertClipboardToImage}] : []),
   ...(typeof convertClipboard === 'function' ? Object.keys(profiles).map(target => formatItem(target, busy)) : [])
  ];
  return submenu.length ? [{label: busy ? '正在转换…' : '剪贴板转换', icon: menuIcon('clipboard'), enabled: !busy, submenu}] : [];
 }
 const helpItem = {label: '帮助 ↗', icon: menuIcon('help'), click: () => (shell || require('electron').shell).openExternal('https://github.com/forgeturl/md2chat/issues')};
 const updateItem = {label: '检查更新', icon: menuIcon('update'), click: checkUpdates};
 function refreshApplicationMenu() {
  const preferencesItem = {label: '首选项', icon: menuIcon('preferences'), click: openPreferences, ...(platform === 'darwin' ? {accelerator: 'Command+,'} : {})};
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   ...(platform === 'darwin' ? [{role: 'appMenu', submenu: [{role: 'about'}, {type: 'separator'}, preferencesItem, helpItem, updateItem, {type: 'separator'}, {role: 'services'}, {type: 'separator'}, {role: 'hide'}, {role: 'hideOthers'}, {role: 'unhide'}, {type: 'separator'}, {role: 'quit'}]}] : [{label: '文件', icon: menuIcon('window'), submenu: [{label: '显示主窗口', icon: menuIcon('window'), click: showWindow}, preferencesItem, helpItem, updateItem, {type: 'separator'}, {label: '退出 md2chat', icon: menuIcon('quit'), accelerator: 'Control+Q', click: () => app.quit()}]}]),
   {role: 'editMenu'}, {role: 'viewMenu'}, {role: 'windowMenu'}
  ]));
 }
 function refreshTray() {
  if (!tray) return;
  const value = preferences(), busy = getClipboardConversionState()?.busy === true;
  if (platform === 'darwin' && typeof tray.setTitle === 'function') tray.setTitle(value.showTrayLabel ? 'md2chat' : '');
  const conversions = clipboardItems(busy);
  trayMenu = Menu.buildFromTemplate([
   ...(typeof convertClipboard === 'function' ? value.pinnedTargets.map(target => formatItem(target, busy)) : []),
   ...conversions, ...(conversions.length ? [{type: 'separator'}] : []),
   {label: '显示主窗口', icon: menuIcon('window'), click: showWindow},
   {label: '首选项', icon: menuIcon('preferences'), click: openPreferences}, helpItem, updateItem,
   {type: 'separator'}, {label: '退出 md2chat', icon: menuIcon('quit'), click: () => app.quit()}
  ]);
 }
 refreshApplicationMenu();
 try {
  const image = nativeImage.createFromPath(path.join(__dirname, '../assets/menu-icons/tray.png'));
  if (image.isEmpty()) throw new Error('图标资源缺失');
  const size = platform === 'darwin' ? 22 : 24, trayImage = image.resize({width: size, height: size});
  if (typeof trayImage.setTemplateImage === 'function') trayImage.setTemplateImage(false);
  tray = new Tray(trayImage);
  tray.setToolTip('md2chat · 贴贴 Markdown');
  const popup = () => {
   refreshTray();
   tray.popUpContextMenu(trayMenu);
  };
  tray.on('right-click', popup);
  tray.on('click', platform === 'darwin' ? popup : showWindow);
  if (platform === 'win32') tray.on('double-click', showWindow);
  refreshTray();
 } catch (error) {
  if (tray) tray.destroy();tray = null;
  dialog.showErrorBox('托盘暂不可用', '主窗口仍可正常使用；关闭窗口会退出应用。' + error.message);
 }
 return {get hasTray() {return !!tray;}, refreshApplicationMenu, refreshTray, destroy() {if (tray) {tray.destroy();tray = null;trayMenu = null;}}};
}
module.exports = {loginOptions, loginState, setLogin, startHidden, createIntegration};
