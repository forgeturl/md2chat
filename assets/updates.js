(() => {
 'use strict';
 const api = window.md2chatDesktop?.updates;
 if (!api) return;
 const t = (source, values = {}) => (window.md2chatI18n?.t(source) || source).replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
 const entry = document.createElement('button');entry.type = 'button';entry.className = 'update-entry';
 document.getElementById('utility-actions').append(entry);
 const panel = document.createElement('dialog');panel.className = 'update-dialog';
 panel.setAttribute('aria-labelledby','update-title');
 panel.innerHTML = '<header class="update-heading"><img src="./assets/app-icon.png" width="48" height="48" alt=""><div><h2 id="update-title">软件更新</h2><p>获取最新功能与修复</p></div><button type="button" class="update-dismiss" aria-label="关闭">×</button></header><div class="update-content"><div class="update-versions"><div><span class="update-current-label">当前版本</span><strong class="update-current" data-no-i18n></strong></div><span class="update-version-arrow" aria-hidden="true">→</span><div class="update-next-wrap"><span>可用版本</span><strong class="update-next" data-no-i18n></strong></div></div><section class="update-state" role="status" aria-live="polite" aria-atomic="true"><span class="update-indicator" aria-hidden="true"></span><div><h3 class="update-state-title"></h3><p class="update-status"></p></div><span class="update-percent" data-no-i18n></span></section><progress max="100" aria-label="更新下载进度"></progress><section class="update-release"><div class="update-release-heading"><h3>本次更新</h3><a class="update-details-link" href="https://github.com/forgeturl/md2chat/releases/latest" target="_blank" rel="noopener noreferrer">查看完整更新说明 ↗</a></div><div class="update-notes" data-no-i18n></div></section><p class="update-footnote">安装前请保存输入内容。</p></div><footer class="update-footer"><a href="https://github.com/forgeturl/md2chat/releases/latest" target="_blank" rel="noopener noreferrer">前往下载页面 ↗</a><div class="update-actions"><button type="button" class="update-close">稍后</button><button type="button" class="update-action">检查更新</button></div></footer>';
 document.body.append(panel);
 const find = name => panel.querySelector(name);
 const action = find('.update-action'), progress = find('progress');
 let state = {phase: 'idle'}, pending = false, renderedNotes, statusRevision = 0;
 const labels = {idle:'检查更新',checking:'正在检查…',current:'再次检查',available:'下载更新',downloading:'正在下载…',downloaded:'重启并安装',installing:'正在准备安装…',error:'重新检查',unavailable:'检查更新'};
 const titles = {idle:'检查新版本',checking:'正在检查更新…',current:'当前已是最新版本。',available:'发现新版本',downloading:'正在下载更新…',downloaded:'更新已准备好',installing:'正在安装更新…',error:'更新暂未完成',unavailable:'请手动下载新版'};
 function renderLegacy(notes, container) {
  let versionSeen = false, list;
  for (const line of notes.split(/\r?\n/)) {
   if (/^#{1,6}\s+v?\d+\.\d+\.\d+\s*$/.test(line)) {
    if (versionSeen) break;
    versionSeen = true;continue;
   }
   if (!line.trim()) {list = null;continue;}
   if (/^[-*]\s+/.test(line)) {
    if (!list) {list = document.createElement('ul');container.append(list);}
    const item = document.createElement('li');item.textContent = line.replace(/^[-*]\s+/,'');list.append(item);
   } else {
    list = null;const item = document.createElement(/^#{1,6}\s+/.test(line)?'h4':'p');
    item.textContent = line.replace(/^#{1,6}\s+/,'');container.append(item);
   }
  }
 }
 const stableVersion = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.split('.').map(Number).every(Number.isSafeInteger);
 const compare = (a, b) => {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
 };
 const linesFor = (translations, locale) => {
  const lines = translations?.[locale] || translations?.en || translations?.['zh-CN'];
  return Array.isArray(lines) ? lines.filter(line => typeof line === 'string' && line.trim()) : [];
 };
 let historyDetails, renderedRange;
 function renderNotes() {
  const locale = window.md2chatI18n?.locale || 'en';
  const key = JSON.stringify([state.notes, state.releases, state.currentVersion, state.version, locale]);
  if (key === renderedNotes) return;
  renderedNotes = key;
  const range = state.currentVersion + ':' + state.version;
  const expanded = range === renderedRange && !!historyDetails?.open;
  renderedRange = range;
  const container = find('.update-notes');container.replaceChildren();
  const link = find('.update-details-link');
  link.href = stableVersion(state.version) ? 'https://github.com/forgeturl/md2chat/releases/tag/v' + state.version : 'https://github.com/forgeturl/md2chat/releases/latest';
  const releases = Array.isArray(state.releases) && stableVersion(state.currentVersion) && stableVersion(state.version)
   ? state.releases.filter(item => item && stableVersion(item.version) && compare(item.version, state.currentVersion) > 0 && compare(item.version, state.version) <= 0 && linesFor(item.summary, locale).length).sort((a,b) => compare(b.version,a.version)) : [];
  const unique = releases.filter((item, index) => !index || item.version !== releases[index - 1].version);
  function text(tag, value, parent) {const node = document.createElement(tag);node.textContent = value;parent.append(node);return node;}
  function list(lines, parent) {const ul = document.createElement('ul');parent.append(ul);for (const line of lines) text('li', line, ul);}
  if (!unique.length) {
   historyDetails = undefined;
   if (state.notes) {
    text('p', t('该版本尚未提供多语言摘要，可展开原文或查看完整说明。'), container);
    const details = document.createElement('details');container.append(details);
    text('summary', t('查看原始更新说明'), details);
    renderLegacy(state.notes, details);
   }
   find('.update-release').hidden = !state.notes;
   return;
  }
  find('.update-release').hidden = false;
  text('p', t('本次升级包含 {n} 个版本的更新', {n: unique.length}), container).className = 'update-release-count';
  // Notices for every crossed version stay visible, including collapsed history.
  for (const release of unique) {
   const important = linesFor(release.important, locale);
   if (!important.length) continue;
   const notice = document.createElement('aside');notice.className = 'update-important';container.append(notice);
   text('strong', t('升级提醒') + ' · v' + release.version, notice);list(important, notice);
  }
  function appendRelease(release, parent) {
   const section = document.createElement('section');section.className = 'update-version-notes';parent.append(section);
   text('h4', 'v' + release.version, section);list(linesFor(release.summary, locale), section);
  }
  unique.slice(0,3).forEach(release => appendRelease(release, container));
  historyDetails = undefined;
  if (unique.length > 3) {
   historyDetails = document.createElement('details');historyDetails.className = 'update-history';historyDetails.open = expanded;container.append(historyDetails);
   text('summary', t('更早的 {n} 个版本', {n: unique.length - 3}), historyDetails);
   unique.slice(3).forEach(release => appendRelease(release, historyDetails));
  }
 }
 function render(next) {
  state = next;
  const active = ['available','downloading','downloaded'].includes(state.phase);
  const percent = Math.max(0,Math.min(100,Math.floor(Number(state.progress) || 0)));
  entry.textContent = active && state.version ? t('更新 {version}',{version:'v'+state.version}) : t('检查更新');
  panel.dataset.phase = state.phase;
  find('.update-current').textContent = state.currentVersion ? 'v'+state.currentVersion : '—';
  find('.update-next').textContent = state.version ? 'v'+state.version : '—';
  find('.update-next-wrap').hidden = !state.version;
  find('.update-version-arrow').hidden = !state.version;
  find('.update-state-title').textContent = t(titles[state.phase] || titles.idle);
  const defaults = {idle:'手动检查可用的更新。',checking:'正在连接 GitHub，请稍候。',current:'你可以继续使用当前版本。',available:'查看更新内容后，选择下载更新。',downloading:'下载期间可以关闭此窗口，继续编辑。',downloaded:'请先保存输入内容，再重启并安装。',installing:'应用将退出并重新打开。'};
  const message = state.phase === 'downloading' ? defaults.downloading : state.message || defaults[state.phase] || '';
  find('.update-status').textContent = t(message);
  find('.update-percent').textContent = state.phase === 'downloading' ? percent+'%' : '';
  renderNotes();
  progress.hidden = state.phase !== 'downloading';progress.value = percent;
  action.textContent = t(labels[state.phase] || labels.idle);
  action.disabled = pending || ['checking','downloading','installing'].includes(state.phase);
  find('.update-close').textContent = t(active ? '稍后' : '关闭');
 }
 async function invoke(method) {
  if (pending) return;
  statusRevision++;
  pending = true;render(state);
  try {render(await api[method]());}
  catch (error) {
   const message = window.md2chatI18n?.has(error?.message) ? error.message : '暂时无法操作更新，请稍后重试。';
   render({...state,phase:'error',message});
  }
  finally {pending = false;render(state);}
 }
 function open() {if (!panel.open) panel.showModal();}
 entry.addEventListener('click', () => {open();if (['idle','current','error','unavailable'].includes(state.phase)) void invoke('check');});
 for (const close of panel.querySelectorAll('.update-close,.update-dismiss')) close.addEventListener('click', () => panel.close());
 action.addEventListener('click', () => void invoke(state.phase === 'available' ? 'download' : state.phase === 'downloaded' ? 'install' : 'check'));
 window.addEventListener('md2chat:language', () => render(state));
 api.subscribe(next => {statusRevision++;render(next);});api.onOpen(open);
 render(state);
 const startupRevision = statusRevision;
 void api.status().then(next => {if (statusRevision === startupRevision) render(next);}).catch(() => {});
})();
