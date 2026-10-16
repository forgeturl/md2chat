(() => {
 'use strict';
 const api = window.md2chatDesktop?.updates;
 if (!api) return;
 const entry = document.createElement('button');entry.type = 'button';entry.className = 'update-entry';entry.textContent = '检查更新';
 document.getElementById('utility-actions').append(entry);
 const panel = document.createElement('dialog');panel.className = 'update-dialog';
 panel.innerHTML = '<h2>软件更新</h2><p class="update-version"></p><p class="update-status" role="status" aria-live="polite"></p><pre class="update-notes"></pre><progress max="100" aria-label="更新下载进度"></progress><p class="help">更新时会连接 GitHub；不会上传输入内容。安装前请保存需要的内容。</p><div class="update-actions"><button type="button" class="update-close">稍后</button><button type="button" class="update-action">检查更新</button></div><p><a href="https://github.com/forgeturl/md2chat/releases/latest" target="_blank" rel="noopener noreferrer">前往下载页面 ↗</a></p>';
 document.body.append(panel);
 const find = name => panel.querySelector(name);
 const action = find('.update-action'), progress = find('progress');
 let state = {phase: 'idle'}, pending = false;
 const labels = {idle:'检查更新',checking:'正在检查…',current:'再次检查',available:'下载更新',downloading:'正在下载…',downloaded:'重启并安装',installing:'正在准备安装…',error:'重新检查',unavailable:'检查更新'};
 function render(next) {
  state = next;
  entry.textContent = ['available','downloading','downloaded'].includes(state.phase) ? `更新 v${state.version}` : '检查更新';
  find('.update-version').textContent = `当前版本 v${state.currentVersion || ''}${state.version ? ` → 新版本 v${state.version}` : ''}`;
  find('.update-status').textContent = state.message || ({available:'发现新版本，请查看更新内容。',downloading:`正在下载 ${Math.floor(state.progress)}%`,downloaded:'下载完成，点击重启并安装。'}[state.phase] || labels[state.phase]);
  find('.update-notes').textContent = state.notes || '';
  find('.update-notes').hidden = !state.notes;
  progress.hidden = state.phase !== 'downloading';progress.value = state.progress || 0;
  action.textContent = labels[state.phase] || '检查更新';
  action.disabled = pending || ['checking','downloading','installing'].includes(state.phase);
 }
 async function invoke(method) {
  if (pending) return;
  pending = true;render(state);
  try {render(await api[method]());}
  catch {find('.update-status').textContent = '暂时无法操作更新，请稍后重试。';}
  finally {pending = false;action.disabled = ['checking','downloading','installing'].includes(state.phase);}
 }
 function open() {if (!panel.open) panel.showModal();}
 entry.addEventListener('click', () => {open();if (['idle','current','error','unavailable'].includes(state.phase)) void invoke('check');});
 find('.update-close').addEventListener('click', () => panel.close());
 action.addEventListener('click', () => void invoke(state.phase === 'available' ? 'download' : state.phase === 'downloaded' ? 'install' : 'check'));
 api.subscribe(render);api.onOpen(open);
 void api.status().then(render).catch(() => {});
})();
