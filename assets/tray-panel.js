(function () {
  'use strict';
  const tauri = window.__TAURI__;
  const menu = document.getElementById('panel-menu');
  const title = document.getElementById('panel-title');
  const error = document.getElementById('panel-error');
  const rows = new Map();
  const icons = new Set(['image', 'wechat', 'dingtalk', 'feishu', 'wecom', 'email', 'window', 'preferences', 'help', 'update', 'quit']);
  const platforms = new Set(['wechat', 'dingtalk', 'feishu', 'wecom', 'email']);
  let acting = false;
  let sequence = 0, lastError;
  const t = source => window.md2chatI18n?.t(source) || source;

  function enabledRows() { return Array.from(menu.querySelectorAll('button')).filter(row => !row.disabled); }
  function focusRow(row) {
    for (const button of rows.values()) button.tabIndex = button === row ? 0 : -1;
    row?.focus();
  }
  function focusFirst() { focusRow(enabledRows()[0]); }
  function report(reason) {
    lastError = reason instanceof Error ? reason.message : String(reason);
    lastError = Object.entries(window.md2chatLocales?.messages || {}).find(([,entry])=>Object.values(entry).includes(lastError))?.[0] || lastError;
    error.textContent = t(lastError);
    error.hidden = false;
  }
  async function invoke(command, args) {
    if (!tauri?.core?.invoke) throw new Error('请在 md2chat 桌面应用中打开。');
    return tauri.core.invoke(command, args);
  }
  async function activate(id) {
    const row = rows.get(id);
    if (acting || !row || row.disabled) return;
    acting = true;
    error.hidden = true;
    menu.setAttribute('aria-busy', 'true');
    for (const button of rows.values()) button.disabled = true;
    try { await invoke('tray_panel_action', {action: id}); }
    catch (reason) { report(reason); }
    finally {
      acting = false;
      await load(false);
    }
  }
  function render(value) {
    const focused = document.activeElement?.dataset?.action;
    title.textContent = value.title;
    const present = new Set();
    for (const item of [...value.conversions, ...value.actions]) {
      if (!icons.has(item.icon)) continue;
      present.add(item.id);
      let row = rows.get(item.id);
      if (!row) {
        row = document.createElement('button');
        row.type = 'button';
        row.className = 'menu-item';
        row.setAttribute('role', 'menuitem');
        row.dataset.action = item.id;
        row.tabIndex = -1;
        const icon = document.createElement('img');
        icon.src = './assets/' + (platforms.has(item.icon) ? 'platforms/' : 'menu-icons/') + item.icon + '.svg';
        icon.alt = '';
        row.append(icon, document.createElement('span'));
        row.addEventListener('click', () => { void activate(item.id); });
        rows.set(item.id, row);
      }
      row.querySelector('span').textContent = item.label;
      row.disabled = acting || !item.enabled;
      const group = item.id.startsWith('convert:') ? 'conversions' : item.id === 'quit' ? 'quit-action' : 'actions';
      document.getElementById(group).appendChild(row);
    }
    for (const [id, row] of rows) if (!present.has(id)) { row.remove(); rows.delete(id); }
    menu.setAttribute('aria-busy', String(acting));
    const available = enabledRows();
    const selected = rows.get(focused);
    const next = selected && !selected.disabled ? selected : available[0];
    for (const button of rows.values()) button.tabIndex = button === next ? 0 : -1;
    // Moving existing rows can discard DOM focus. Preserve it across busy/locale updates.
    if (focused && document.hasFocus()) focusRow(next);
  }
  async function load(focus) {
    const request = ++sequence;
    try {
      const value = await invoke('tray_panel_state');
      if (request !== sequence) return;
      render(value);
      if (focus && document.hasFocus()) focusFirst();
    } catch (reason) { if (request === sequence) report(reason); }
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      void invoke('tray_panel_hide').catch(report);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;
    event.preventDefault();
    const buttons = enabledRows();
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement);
    const backward = event.key === 'ArrowUp' || event.key === 'Tab' && event.shiftKey;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : current < 0 ? backward ? buttons.length - 1 : 0
        : (current + (backward ? -1 : 1) + buttons.length) % buttons.length;
    focusRow(buttons[index]);
  });
  document.addEventListener('contextmenu', event => event.preventDefault());
  window.addEventListener('md2chat:language', () => {if (!error.hidden && lastError) error.textContent = t(lastError);});
  window.addEventListener('focus', () => { error.hidden = true; void load(true); });
  // Native Focused(false) hides the window even when the WebView is busy.
  // Subscribe before reading state so changes during startup cannot be missed.
  void (async () => {
    try {
      if (tauri?.event?.listen) await tauri.event.listen('md2chat:tray-panel', event => {
        sequence++;
        render(event.payload);
      });
      await load(true);
    } catch (reason) { report(reason); }
  })();
}());
