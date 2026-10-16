(function () {
  'use strict';

  const bridge = window.md2chatPreferences;
  const content = document.getElementById('preferences-content');
  const targets = document.getElementById('target-options');
  const targetList = document.getElementById('target-list');
  const targetRows = new Map(Array.from(targetList.querySelectorAll('[data-target]'), row => [row.dataset.target, row]));
  const trayLabelRow = document.getElementById('tray-label-row');
  const showTrayLabel = document.getElementById('show-tray-label');
  const openAtLogin = document.getElementById('open-at-login');
  const loginDescription = document.getElementById('login-description');
  const status = document.getElementById('preferences-status');
  const retryLoad = document.getElementById('retry-load');
  const canonicalTargets = ['wechat', 'dingtalk', 'feishu', 'wecom', 'email'];
  const validTargets = new Set(canonicalTargets);
  let snapshot = null;
  let busy = false;
  let draggedTarget = null;
  let loginRefreshSequence = 0;

  function setStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }

  function normalize(value) {
    if (!value || typeof value !== 'object' || !value.login || typeof value.login !== 'object') {
      throw new Error('INVALID_PREFERENCES');
    }
    return {
      pinnedTargets: Array.isArray(value.pinnedTargets)
        ? Array.from(new Set(value.pinnedTargets.filter(target => validTargets.has(target))))
        : [],
      showTrayLabel: value.showTrayLabel === true,
      platform: value.platform,
      login: { ...value.login }
    };
  }

  function loginIsEditable() {
    return Boolean(snapshot && snapshot.login.supported);
  }

  function saveFailureMessage(error) {
    const fallback = '未能保存，已恢复原设置。请重试。';
    if (!error || typeof error.message !== 'string') return fallback;
    const reason = error.message
      .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
      .replace(/^Error:\s*/i, '')
      .split(/[\r\n]/, 1)[0]
      .trim();
    if (!reason || reason.length > 240 || !/[\u3400-\u9fff]/.test(reason)) return fallback;
    if (/(?:[a-z]:[\\/]|(?:file|https?):\/\/|\/(?:Users|home|private|var|tmp|Library|Applications|Volumes|System|usr|opt|etc|mnt|root)\/|\.(?:[cm]?js|json):\d)/i.test(reason)) return fallback;
    return '未能保存，已恢复原设置。' + reason;
  }

  function updateDisabledState() {
    const unavailable = busy || !snapshot;
    targets.disabled = unavailable;
    for (const [target, row] of targetRows) {
      const index = snapshot ? snapshot.pinnedTargets.indexOf(target) : -1;
      row.draggable = !unavailable && index !== -1;
      row.querySelector('[data-move="up"]').disabled = unavailable || index <= 0;
      row.querySelector('[data-move="down"]').disabled = unavailable || index === -1 || index === snapshot.pinnedTargets.length - 1;
    }
    showTrayLabel.disabled = unavailable || snapshot.platform !== 'darwin';
    openAtLogin.disabled = unavailable || !loginIsEditable();
    retryLoad.disabled = busy;
    content.setAttribute('aria-busy', String(busy));
  }

  function renderLoginState() {
    openAtLogin.checked = Boolean(snapshot.login.registered ?? snapshot.login.enabled);
    const login = snapshot.login;
    if (login.reason) {
      loginDescription.textContent = String(login.reason);
    } else if (login.pending) {
      loginDescription.textContent = '请在系统设置中允许 md2chat 开机自启动。';
    } else if (login.blocked) {
      loginDescription.textContent = '开机自启动已被系统关闭，请在系统设置中允许。';
    } else if (!login.supported) {
      loginDescription.textContent = '请安装桌面版后设置开机自启动。';
    } else {
      loginDescription.textContent = '登录电脑后，在后台启动 md2chat。';
    }
    openAtLogin.disabled = busy || !loginIsEditable();
  }

  function render(value) {
    snapshot = normalize(value);
    const ordered = snapshot.pinnedTargets.concat(canonicalTargets.filter(target => !snapshot.pinnedTargets.includes(target)));
    for (const target of ordered) {
      const row = targetRows.get(target);
      const selected = snapshot.pinnedTargets.includes(target);
      row.querySelector('input').checked = selected;
      row.classList.toggle('is-selected', selected);
      targetList.appendChild(row);
    }
    trayLabelRow.hidden = snapshot.platform !== 'darwin';
    showTrayLabel.checked = snapshot.showTrayLabel;
    renderLoginState();
    updateDisabledState();
  }

  async function load() {
    if (busy) return;
    loginRefreshSequence++;
    busy = true;
    retryLoad.hidden = true;
    setStatus('正在读取设置…', 'loading');
    updateDisabledState();
    try {
      if (!bridge || typeof bridge.get !== 'function' || typeof bridge.set !== 'function') {
        throw new Error('BRIDGE_UNAVAILABLE');
      }
      render(await bridge.get());
      setStatus('更改会立即生效，并保存在本机。', 'saved');
    } catch (_) {
      setStatus('无法读取首选项，请重新加载或重启 md2chat。', 'error');
      retryLoad.hidden = false;
    } finally {
      busy = false;
      updateDisabledState();
    }
  }

  async function refreshLoginState() {
    if (busy) return;
    if (!snapshot) {
      load();
      return;
    }
    const previous = snapshot;
    const sequence = ++loginRefreshSequence;
    try {
      const latest = normalize(await bridge.get());
      if (busy || sequence !== loginRefreshSequence || snapshot !== previous) return;
      snapshot = {...snapshot, login: latest.login};
      renderLoginState();
    } catch (_) {
      // Keep the last confirmed system state until the next focus refresh.
    }
  }

  async function save(change) {
    if (busy || !snapshot) return;
    loginRefreshSequence++;
    const previous = snapshot;
    const focused = document.activeElement;
    clearDrag();
    busy = true;
    updateDisabledState();
    setStatus('正在保存…', 'loading');
    try {
      render(await bridge.set(change));
      setStatus(change.openAtLogin && snapshot.login.pending
        ? '设置已保存，请在系统设置中允许开机自启动。'
        : '已保存，更改已生效。', 'saved');
    } catch (error) {
      render(previous);
      setStatus(saveFailureMessage(error), 'error');
    } finally {
      busy = false;
      updateDisabledState();
      if (focused && typeof focused.focus === 'function') {
        const focusTarget = focused.disabled && typeof focused.closest === 'function'
          ? focused.closest('.target-option')?.querySelector('input')
          : focused;
        if (focusTarget && !focusTarget.disabled) focusTarget.focus({preventScroll: true});
      }
    }
  }

  function clearDrag() {
    draggedTarget = null;
    for (const row of targetRows.values()) row.classList.remove('is-dragging', 'is-drop-target');
  }

  function eventRow(event) {
    const row = event.target && typeof event.target.closest === 'function'
      ? event.target.closest('.target-option')
      : null;
    return row && targetRows.get(row.dataset.target) === row ? row : null;
  }

  function moveTarget(target, destination) {
    if (busy || !snapshot) return;
    const order = snapshot.pinnedTargets.slice();
    const source = order.indexOf(target);
    if (source === -1 || destination < 0 || destination >= order.length || source === destination) return;
    order.splice(source, 1);
    order.splice(destination, 0, target);
    save({pinnedTargets: order});
  }

  targets.addEventListener('change', (event) => {
    const input = event.target;
    if (busy || !snapshot || input.name !== 'pinnedTargets' || !validTargets.has(input.value) || !eventRow(event)) return;
    const order = snapshot.pinnedTargets.filter(target => target !== input.value);
    if (input.checked) order.push(input.value);
    save({pinnedTargets: order});
  });
  targets.addEventListener('click', (event) => {
    const button = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-move]') : null;
    const row = eventRow(event);
    if (!button || button.disabled || !row || busy || !snapshot) return;
    const direction = button.dataset.move;
    if (direction !== 'up' && direction !== 'down') return;
    moveTarget(row.dataset.target, snapshot.pinnedTargets.indexOf(row.dataset.target) + (direction === 'up' ? -1 : 1));
  });
  targets.addEventListener('dragstart', (event) => {
    const row = eventRow(event);
    if (busy || !snapshot || !row || !snapshot.pinnedTargets.includes(row.dataset.target)
      || event.target.closest('input,button')) {
      event.preventDefault();
      clearDrag();
      return;
    }
    clearDrag();
    draggedTarget = row.dataset.target;
    row.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedTarget);
    }
  });
  targets.addEventListener('dragover', (event) => {
    const row = eventRow(event);
    if (busy || !snapshot || !draggedTarget || !snapshot.pinnedTargets.includes(draggedTarget)
      || !row || !snapshot.pinnedTargets.includes(row.dataset.target) || row.dataset.target === draggedTarget) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    for (const candidate of targetRows.values()) candidate.classList.toggle('is-drop-target', candidate === row);
  });
  targets.addEventListener('drop', (event) => {
    const row = eventRow(event);
    const source = draggedTarget;
    clearDrag();
    if (busy || !snapshot || !source || !snapshot.pinnedTargets.includes(source)
      || !row || !snapshot.pinnedTargets.includes(row.dataset.target)) return;
    event.preventDefault();
    moveTarget(source, snapshot.pinnedTargets.indexOf(row.dataset.target));
  });
  targets.addEventListener('dragend', clearDrag);
  showTrayLabel.addEventListener('change', () => save({ showTrayLabel: showTrayLabel.checked }));
  openAtLogin.addEventListener('change', () => save({ openAtLogin: openAtLogin.checked }));
  retryLoad.addEventListener('click', load);
  window.addEventListener('focus', refreshLoginState);
  load();
}());
