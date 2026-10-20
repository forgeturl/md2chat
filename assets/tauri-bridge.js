(function () {
 'use strict';
 const tauri = window.__TAURI__;
 if (!tauri?.core?.invoke || !tauri?.event?.listen) return;
 const invoke = async (command, args) => {
  try { return await tauri.core.invoke(command, args); }
  catch (error) { throw error instanceof Error ? error : new Error(typeof error === 'string' ? error : '桌面操作失败，请重试。'); }
 };
 const platformHint = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
 const platform = /mac|darwin/i.test(platformHint) ? 'darwin' : /win/i.test(platformHint) ? 'win32' : 'linux';
 function subscribe(name, callback) {
  let disposed = false, unlisten;
  void tauri.event.listen(name, event => { if (!disposed) callback(event.payload); })
   .then(stop => { if (disposed) stop(); else unlisten = stop; })
   .catch(() => {});
  return () => { disposed = true; unlisten?.(); };
 }
 let renderCallback, segmentsCallback, imageCallback, readyPromise, listenerPromise, backgroundLockRequested=false, rendering=false;
 const pending = new Set();
 async function convert(request) {
  if (!request || !Number.isSafeInteger(request.id) || request.id <= 0 || !['render', 'segments', 'editor-image'].includes(request.kind) || pending.has(request.id)) return;
  pending.add(request.id);
  let ownsRenderer=false;
  try {
   const input = await invoke('conversion_take', {id: request.id});
   const kind = input.kind || request.kind;
   // A native timeout releases its lock; an old browser decode can still be pending.
   // Do not allocate another large bitmap until that renderer actually settles.
   if (kind === 'render' || kind === 'editor-image') {
    if (rendering) throw new Error('正在转换或复制，请稍候再试。');
    rendering=true;ownsRenderer=true;
   }
   let parts;
   if (kind === 'segments' && segmentsCallback) { await segmentsCallback(input.parts); parts = []; }
   else if (kind === 'render' && renderCallback) parts = await renderCallback(input.content, input.target);
   else if (kind === 'editor-image' && imageCallback) parts = [await imageCallback()];
   else throw new Error('转换窗口尚未准备好，请重试。');
   await invoke('conversion_result', {id: request.id, result: {parts}});
  } catch (error) {
   await invoke('conversion_result', {id: request.id, result: {error: error?.message || '转换失败，请重试。'}}).catch(() => {});
  } finally { if (ownsRenderer) rendering=false; pending.delete(request.id); }
 }
 function ready() {
  if (!renderCallback || !segmentsCallback) return Promise.resolve();
  // WebView2 does not expose Tauri's macOS background-throttling policy.
  // A held Web Lock keeps the hidden renderer available for tray conversions.
  if (!backgroundLockRequested && navigator.locks?.request) {
   backgroundLockRequested=true;
   void navigator.locks.request('md2chat-background-renderer', () => new Promise(() => {})).catch(() => {});
  }
  if (!listenerPromise) listenerPromise = tauri.event.listen('md2chat:conversion-request', event => { void convert(event.payload); })
   .catch(error => { listenerPromise = undefined; throw error; });
  if (!readyPromise) readyPromise = listenerPromise.then(() => invoke('conversion_ready')).catch(error => { readyPromise = undefined; throw error; });
  return readyPromise;
 }
 function startupFailed(error) {
  console.error('md2chat desktop conversion bridge could not start.', error);
  const status = document.getElementById?.('status');
  if (status) status.textContent = '无法连接桌面转换，请重启应用。';
 }
 const desktop = Object.freeze({
  platform,
  copy: (parts, target = 'dingtalk') => invoke('desktop_copy', {parts, target}),
  copyWecomSegment: segment => invoke('desktop_copy_segment', {segment}),
  async copyImage(render) {
   if (imageCallback) throw new Error('正在转换或复制，请稍候再试。');
   if (typeof render !== 'function') throw new Error('转图片暂不可用，请在应用内重试。');
   if (!renderCallback || !segmentsCallback) throw new Error('转换窗口尚未准备好，请重试。');
   imageCallback=render;
   try { await ready(); return await invoke('desktop_copy_image'); }
   finally { imageCallback=undefined; }
  },
  testDingtalkHtml: mode => invoke('desktop_test_dingtalk_html', {mode}),
  inspect: () => invoke('desktop_inspect'),
  saveDiagnostics: (name, data) => invoke('desktop_save_diagnostics', {name, data}),
  readLocalImage: source => invoke('desktop_read_local_image', {source}),
  resolveClipboardHtml: html => invoke('desktop_resolve_clipboard_html', {html}),
  ready,
  onConvertClipboard(callback) {
   renderCallback = callback; void ready().catch(startupFailed);
   return () => { if (renderCallback === callback) renderCallback = undefined; };
  },
  onWecomSegments(callback) {
   segmentsCallback = callback; void ready().catch(startupFailed);
   return () => { if (segmentsCallback === callback) segmentsCallback = undefined; };
  },
  updates: Object.freeze({
   status: () => invoke('update_status'), check: () => invoke('update_check'),
   download: () => invoke('update_download'), install: () => invoke('update_install'),
   subscribe: callback => subscribe('md2chat:update-state', callback),
   onOpen: callback => subscribe('md2chat:update-open', callback)
  })
 });
 Object.defineProperty(window, 'md2chatDesktop', {value: desktop});
 Object.defineProperty(window, 'md2chatPreferences', {value: Object.freeze({
  get: () => invoke('preferences_get'), set: patch => invoke('preferences_set', {patch})
 })});
 Object.defineProperty(window, 'md2chatShortcuts', {value: Object.freeze({
  get: () => invoke('shortcuts_get'),
  set: configuration => invoke('shortcuts_set', {configuration}),
  session: mode => invoke('shortcuts_session', {mode}),
  endSession: sessionId => invoke('shortcuts_end_session', {sessionId}),
  subscribe: callback => subscribe('md2chat:shortcuts-state', callback),
  onTest: callback => subscribe('md2chat:shortcut-test', callback)
 })});
 Object.defineProperty(window, 'md2chatLocale', {value: Object.freeze({
  get: () => invoke('locale_get'), set: (preference, detected) => invoke('locale_set', {preference, detected}),
  subscribe: callback => subscribe('md2chat:locale', callback)
 })});
 document.addEventListener('click', event => {
  const anchor = event.target?.closest?.('a[href]');
  if (!anchor) return;
  let url;
  try { url = new URL(anchor.href, window.location.href); } catch (_) { return; }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin === window.location.origin) return;
  event.preventDefault();
  void invoke('desktop_open_external', {url: url.href}).catch(() => {});
 });
}());
