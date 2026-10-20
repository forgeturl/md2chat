(function () {
  'use strict';
  const root = document.getElementById('shortcut-settings');
  if (!root) return;
  const bridge = window.md2chatShortcuts, keys = window.ShortcutKeys;
  const enabled = document.getElementById('shortcuts-enabled');
  const status = document.getElementById('shortcuts-status');
  const warning = document.getElementById('shortcuts-warning');
  const retry = document.getElementById('shortcuts-retry');
  const test = document.getElementById('shortcuts-test');
  const capture = document.getElementById('shortcuts-capture');
  const capturedKey = document.getElementById('shortcuts-captured-key');
  const save = document.getElementById('shortcuts-save');
  const cancel = document.getElementById('shortcuts-cancel');
  const rows = new Map(Array.from(root.querySelectorAll('[data-shortcut-target]'), row => [row.dataset.shortcutTarget, row]));
  let snapshot = null, busy = false, mode = null, sessionId = null, candidate = null, recordingTarget = null;
  let timer, cancelPending = false, disposed = false, statusSource;
  const t = value => window.md2chatI18n?.t(value) || value;
  const labels = {disabled: '启用时检查可用性', registered: '已注册', unavailable: '暂不可用，请更换或重试', paused: '录制期间暂停'};

  function message(value, error = false) { statusSource = value; status.textContent = t(value); status.dataset.state = error ? 'error' : 'saved'; }

  function accept(value) {
    if (!value || !['darwin', 'win32'].includes(value.platform)) throw new Error('无法读取快捷键设置，请重试。');
    snapshot = {...value, configuration: keys.configuration(value.configuration, value.platform)};
    if (mode && sessionId && value.sessionId !== sessionId) {
      resetSession();
      message('快捷键录制或测试已结束。');
    }
    render();
  }

  function render() {
    const locked = busy || !snapshot || Boolean(mode);
    enabled.disabled = locked;
    enabled.checked = snapshot?.configuration.enabled === true;
    warning.hidden = !snapshot?.warning;
    warning.textContent = snapshot?.warning ? t(snapshot.warning) : '';
    retry.disabled = busy || Boolean(mode);
    test.disabled = locked || !snapshot?.configuration.enabled || !Object.values(snapshot.statuses || {}).includes('registered');
    test.textContent = t(mode === 'test' ? '正在测试…' : '测试快捷键');
    for (const [target, row] of rows) {
      const binding = snapshot?.configuration.bindings[target];
      const record = row.querySelector('[data-shortcut-action="record"]');
      record.textContent = keys.format(binding, snapshot?.platform) || t('点击录制');
      record.disabled = locked;
      record.setAttribute('aria-label', t('录制快捷键') + ' · ' + t(row.dataset.label));
      row.querySelector('[data-shortcut-action="suggest"]').disabled = locked;
      row.querySelector('[data-shortcut-action="clear"]').disabled = locked || !binding;
      const state = row.querySelector('[data-shortcut-status]');
      state.textContent = binding ? t(labels[snapshot.statuses?.[target]] || labels.disabled) : t('未配置');
      state.dataset.state = snapshot?.statuses?.[target] || 'disabled';
    }
    capture.hidden = !mode;
    capturedKey.textContent = mode === 'test' ? t('按下已配置的快捷键，仅检测按键，不转换剪贴板。')
      : candidate ? keys.format(candidate, snapshot.platform) : t('请按下一组快捷键…');
    save.hidden = mode !== 'record';
    save.disabled = busy || !candidate;
    cancel.disabled = busy;
    cancel.textContent = t(mode === 'test' ? '结束测试' : '取消');
    root.setAttribute('aria-busy', String(busy));
  }

  function safeError(error) {
    const text = String(error?.message || '快捷键操作未完成，请重试。');
    return /[\u3400-\u9fff]/.test(text) && text.length < 240 && !/(?:https?:|\/Users\/|\/private\/)/i.test(text)
      ? text : '快捷键操作未完成，请重试。';
  }

  async function load() {
    if (busy || mode) return;
    busy = true; render();
    try {
      if (!bridge || !keys) throw new Error('请在桌面版中配置全局快捷键。');
      accept(await bridge.get());
      message(snapshot.warning || (snapshot.configuration.enabled ? '快捷键设置已读取。' : '全局快捷键已关闭，不占用任何按键。'), Boolean(snapshot.warning));
    } catch (error) { message(safeError(error), true); }
    finally { busy = false; render(); }
  }

  async function apply(configuration) {
    accept(await bridge.set(keys.configuration(configuration, snapshot.platform)));
    message(snapshot.warning || (snapshot.configuration.enabled ? '已保存，更改已生效。' : '已保存。快捷键保持关闭，不占用任何按键。'), Boolean(snapshot.warning));
  }

  async function change(work) {
    if (busy || !snapshot || mode) return;
    busy = true; render();
    try { await work(); }
    catch (error) {
      // Failed native registration leaves the previous configuration intact.
      try { accept(await bridge.get()); } catch (_) {}
      message(safeError(error), true);
    } finally { busy = false; render(); }
  }

  function resetSession() {
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey, true);
    mode = null; sessionId = null; candidate = null; recordingTarget = null; cancelPending = false;
    render();
  }

  async function endSession() {
    const id = sessionId;
    // Restore registrations before applying a newly recorded binding.
    const value = id ? await bridge.endSession(id) : null;
    resetSession();
    if (value) accept(value);
  }

  async function stop() {
    if (!mode) return;
    if (busy) { cancelPending = true; return; }
    busy = true; render();
    try { await endSession(); message('快捷键录制或测试已结束。'); }
    catch (error) { message(safeError(error), true); }
    finally { busy = false; render(); }
  }

  async function start(nextMode, target) {
    if (busy || !snapshot || mode) return;
    busy = true; mode = nextMode; recordingTarget = target; cancelPending = false; render();
    try {
      const value = await bridge.session(nextMode);
      sessionId = value.sessionId;
      if (!sessionId) throw new Error('快捷键录制或测试已结束。');
      accept(value);
      if (cancelPending || disposed) { await endSession(); return; }
      document.addEventListener('keydown', onKey, true);
      timer = setTimeout(() => { void stop(); }, 55000);
      message(nextMode === 'test' ? '按下已配置的快捷键，仅检测按键，不转换剪贴板。' : '请使用一至两个修饰键和一个字母或数字。');
      cancel.focus();
    } catch (error) { resetSession(); message(safeError(error), true); }
    finally { busy = false; render(); }
  }

  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void stop(); return; }
    if (mode !== 'record') return;
    // Keep Tab navigation available unless it is part of an attempted shortcut.
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) return;
    event.preventDefault(); event.stopPropagation();
    if (busy || event.repeat) return;
    try {
      const value = keys.fromEvent(event, snapshot.platform);
      if (!value) return;
      const bindings = {...snapshot.configuration.bindings, [recordingTarget]: value};
      keys.configuration({...snapshot.configuration, bindings}, snapshot.platform);
      candidate = value;
      message('按保存应用此组合，或继续按键重新录制。');
    } catch (error) { candidate = null; message(safeError(error), true); }
    render();
  }

  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-shortcut-action]');
    const row = button?.closest('[data-shortcut-target]');
    if (!button || button.disabled || !row || rows.get(row.dataset.shortcutTarget) !== row) return;
    const target = row.dataset.shortcutTarget;
    if (button.dataset.shortcutAction === 'record') void start('record', target);
    else if (button.dataset.shortcutAction === 'clear') void change(() => {
      const bindings = {...snapshot.configuration.bindings}; delete bindings[target];
      return apply({...snapshot.configuration, bindings});
    });
    else if (button.dataset.shortcutAction === 'suggest') void change(async () => {
      for (const binding of keys.suggestions(snapshot.configuration, target, snapshot.platform)) {
        try { await apply({...snapshot.configuration, bindings: {...snapshot.configuration.bindings, [target]: binding}}); return; }
        catch (error) { if (!safeError(error).includes(keys.unavailable)) throw error; }
      }
      throw new Error('建议组合暂不可用，请点击录制自行设置。');
    });
  });
  enabled.addEventListener('change', () => {
    const next = enabled.checked;
    void change(() => apply({...snapshot.configuration, enabled: next}));
  });
  retry.addEventListener('click', () => {
    if (snapshot?.configuration.enabled) void change(() => apply(snapshot.configuration));
    else void load();
  });
  test.addEventListener('click', () => { void start('test'); });
  cancel.addEventListener('click', () => { void stop(); });
  save.addEventListener('click', async () => {
    if (busy || mode !== 'record' || !candidate) return;
    const binding = candidate, target = recordingTarget;
    busy = true; render();
    try { await endSession(); await apply({...snapshot.configuration, bindings: {...snapshot.configuration.bindings, [target]: binding}}); }
    catch (error) { message(safeError(error), true); }
    finally { busy = false; render(); }
  });
  window.addEventListener('blur', () => { void stop(); });
  window.addEventListener('pagehide', () => { disposed = true; void stop(); });
  window.addEventListener('md2chat:language', () => {render();if (statusSource) status.textContent = t(statusSource);});
  bridge?.subscribe(value => { try { accept(value); if (value.warning) message(value.warning, true); } catch (_) {} });
  bridge?.onTest(value => {
    if (mode === 'test' && value.sessionId === sessionId && rows.has(value.target)) message('已收到快捷键，剪贴板未改变。');
  });
  void load();
}());
