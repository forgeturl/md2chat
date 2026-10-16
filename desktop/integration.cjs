const path = require('node:path');

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
function createIntegration({app, Tray, Menu, nativeImage, dialog, showWindow, checkUpdates = showWindow, platform = process.platform, execPath = process.execPath}) {
 let tray;
 async function toggleLogin(item) {
  try {
   const result = setLogin(app, platform, execPath, item.checked);
   if (!item.checked && result.registered) throw new Error('系统尚未确认移除登录项，请在系统启动项设置中检查。');
   if (item.checked && !result.enabled) {
    await dialog.showMessageBox({type: 'info', title: '开机自启动', message: result.pending ? '需要在系统设置中允许 md2chat 登录项' : '系统尚未确认开机自启动生效', detail: platform === 'darwin' ? '请在「系统设置 → 通用 → 登录项」检查并允许 md2chat。' : '请在「设置 → 应用 → 启动」检查 md2chat 是否被禁用。'});
   }
  } catch (error) {
   await dialog.showMessageBox({type: 'error', title: '开机自启动', message: '未能更改开机自启动', detail: error.message});
  } finally { refreshApplicationMenu(); }
 }
 function settingsItems() {
  const state = loginState(app, platform, execPath);
  return [{label: '开机自启动', type: 'checkbox', checked: state.registered ?? state.enabled, enabled: state.supported, click: toggleLogin},
   ...(!state.supported ? [{label: state.reason, enabled: false}] : state.pending ? [{label: '等待系统批准登录项', enabled: false}] : state.blocked ? [{label: '启动项已被系统禁用', enabled: false}] : [])];
 }
 const help = [{label: '检查更新', click: checkUpdates}, {label: '反馈问题', click: () => require('electron').shell.openExternal('https://github.com/forgeturl/md2chat/issues')}];
 function refreshApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   ...(platform === 'darwin' ? [{role: 'appMenu'}] : []),
   {role: 'editMenu'}, {role: 'viewMenu'}, {role: 'windowMenu'},
   {label: '设置', submenu: [{label: '显示主窗口', click: showWindow}, ...settingsItems(), {type: 'separator'}, {label: '退出 md2chat', accelerator: platform === 'darwin' ? 'Command+Q' : 'Control+Q', click: () => app.quit()}]},
   {label: '帮助', submenu: help}
  ]));
 }
 refreshApplicationMenu();
 try {
  const image = nativeImage.createFromPath(path.join(__dirname, '../assets/app-icon.png'));
  if (image.isEmpty()) throw new Error('图标资源缺失');
  tray = new Tray(image.resize({width: platform === 'darwin' ? 18 : 24, height: platform === 'darwin' ? 18 : 24}));
  tray.setToolTip('md2chat · 贴贴 Markdown');
  const popup = () => tray.popUpContextMenu(Menu.buildFromTemplate([
   {label: '显示主窗口', click: showWindow},
   {type: 'separator'}, ...settingsItems(), {type: 'separator'},
   ...help, {type: 'separator'}, {label: '退出 md2chat', click: () => app.quit()}
  ]));
  tray.on('right-click', popup);
  tray.on('click', platform === 'darwin' ? popup : showWindow);
  if (platform === 'win32') tray.on('double-click', showWindow);
 } catch (error) {
  if (tray) tray.destroy();tray = null;
  dialog.showErrorBox('托盘暂不可用', '主窗口仍可正常使用；关闭窗口会退出应用。' + error.message);
 }
 return {get hasTray() {return !!tray;}, refreshApplicationMenu, destroy() {if (tray) {tray.destroy();tray = null;}}};
}
module.exports = {loginOptions, loginState, setLogin, startHidden, createIntegration};
