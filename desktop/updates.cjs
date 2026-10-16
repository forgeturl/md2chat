// Only the main process chooses the update feed and performs installation.
function releaseNotes(value) {
 const text = Array.isArray(value) ? value.map(item => `${item.version || ''}\n${item.note || ''}`).join('\n\n') : typeof value === 'string' ? value : '';
 return text.slice(0, 20000).replace(/<[^>]*>/g, '').trim() || '此版本未提供更新说明。';
}
function createUpdates({updater, version, available = () => '', publish = () => {}, confirmInstall = async () => false, timers = globalThis}) {
 let state = {phase: 'idle', currentVersion: version, version: '', notes: '', progress: 0, message: ''};
 let operation = null, installing = false, initialTimer, intervalTimer;
 const listeners = [];
 updater.autoDownload = false;
 updater.autoInstallOnAppQuit = false;
 updater.allowPrerelease = false;
 updater.allowDowngrade = false;
 updater.disableDifferentialDownload = true;
 const snapshot = () => ({...state});
 const set = values => {state = {...state, ...values};publish(snapshot());};
 const on = (name, fn) => {updater.on(name, fn);listeners.push([name, fn]);};
 const failure = () => {installing = false;set({phase: 'error', message: '更新失败，请检查网络后重试；也可从 GitHub Releases 下载安装。'});};
 on('checking-for-update', () => set({phase: 'checking', message: ''}));
 on('update-available', info => set({phase: 'available', version: info.version, notes: releaseNotes(info.releaseNotes), progress: 0, message: ''}));
 on('update-not-available', () => set({phase: 'current', version: '', notes: '', message: '已经是最新版本。'}));
 on('download-progress', info => set({phase: 'downloading', progress: Math.max(0, Math.min(100, Number(info.percent) || 0))}));
 on('update-downloaded', () => set({phase: 'downloaded', progress: 100, message: ''}));
 on('error', failure);
 function run(action) {
  if (operation) return operation;
  operation = Promise.resolve().then(action).catch(failure).finally(() => {operation = null;});
  return operation;
 }
 async function check() {
  if (['downloading', 'downloaded', 'installing'].includes(state.phase)) return snapshot();
  const reason = available();
  if (reason) {set({phase: 'unavailable', message: reason});return snapshot();}
  await run(() => updater.checkForUpdates());return snapshot();
 }
 async function download() {
  if (state.phase !== 'available' || operation) return snapshot();
  set({phase: 'downloading', progress: 0});
  await run(() => updater.downloadUpdate());return snapshot();
 }
 async function install() {
  if (state.phase !== 'downloaded' || installing) return snapshot();
  installing = true;
  try {
   if (await confirmInstall()) {set({phase: 'installing', message: '正在准备安装，请稍候…'});updater.quitAndInstall(false, true);}
   else installing = false;
  } catch {failure();}
  return snapshot();
 }
 return {snapshot, check, download, install, start() {
  if (initialTimer || intervalTimer) return;
  initialTimer = timers.setTimeout(() => {void check();}, 15000);
  intervalTimer = timers.setInterval(() => {if (state.phase !== 'available') void check();}, 6 * 60 * 60 * 1000);
  initialTimer.unref?.();intervalTimer.unref?.();
 }, destroy() {timers.clearTimeout(initialTimer);timers.clearInterval(intervalTimer);for (const [name, fn] of listeners) updater.removeListener(name, fn);}};
}
module.exports = {createUpdates, releaseNotes};
