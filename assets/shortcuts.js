(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShortcutKeys = api;
})(globalThis, () => {
  'use strict';
  const targets = ['image', 'wechat', 'dingtalk', 'feishu', 'wecom', 'email'];
  const modifiers = ['Control', 'Alt', 'Shift', 'Meta'];
  const invalid = '请使用一至两个修饰键和一个字母或数字。';
  const editing = ['KeyA', 'KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyY', 'KeyQ', 'KeyW', 'KeyS', 'KeyP', 'KeyO', 'KeyN', 'KeyF'];
  const unavailable = '快捷键注册失败，可能已被占用或被系统保留。请更换组合。';

  function binding(value, platform) {
    if (!value || !Array.isArray(value.modifiers) || value.modifiers.length < 1 || value.modifiers.length > 2
      || new Set(value.modifiers).size !== value.modifiers.length || value.modifiers.some(key => !modifiers.includes(key))
      || typeof value.key !== 'string' || !/^(Key[A-Z]|Digit[0-9])$/.test(value.key)) throw new Error(invalid);
    const mac = platform === 'darwin';
    const normalized = {modifiers: modifiers.filter(key => value.modifiers.includes(key)), key: value.key};
    const keys = normalized.modifiers;
    if (!mac && keys.includes('Meta')) throw new Error(invalid);
    if (!keys.includes('Control') && !(mac && keys.includes('Meta'))) {
      throw new Error('快捷键需要包含 Ctrl 或 Command，避免影响正常输入。');
    }
    const combo = keys.join('+');
    if (((combo === 'Control' || (mac && combo === 'Meta')) && editing.includes(value.key))
      || (mac && combo === 'Control+Meta' && value.key === 'KeyQ')
      || (combo === 'Control+Shift' && ['KeyZ', 'KeyV', 'KeyC'].includes(value.key))
      || (mac && combo === 'Shift+Meta' && ['KeyZ', 'KeyV', 'KeyC', 'KeyQ', 'Digit3', 'Digit4', 'Digit5'].includes(value.key))) {
      throw new Error('此组合用于常用编辑或系统操作，请更换快捷键。');
    }
    return normalized;
  }

  function identity(value) { return value.modifiers.join('+') + '+' + value.key; }

  function configuration(value, platform) {
    if (!value || typeof value.enabled !== 'boolean' || !value.bindings || typeof value.bindings !== 'object' || Array.isArray(value.bindings)) throw new Error(invalid);
    const result = {enabled: value.enabled, bindings: {}};
    const used = new Set();
    for (const [target, raw] of Object.entries(value.bindings)) {
      if (!targets.includes(target)) throw new Error('不支持的快捷键目标格式。');
      const key = binding(raw, platform), id = identity(key);
      if (used.has(id)) throw new Error('此快捷键已绑定其他格式，请使用不同的组合。');
      used.add(id); result.bindings[target] = key;
    }
    return result;
  }

  function fromEvent(event, platform) {
    if (event.isComposing || event.getModifierState?.('AltGraph') || ['Process', 'Dead', 'AltGraph'].includes(event.key)) {
      throw new Error('请结束输入法组合输入，并使用非 AltGr 的组合。');
    }
    if (['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'].includes(event.code)) return null;
    return binding({modifiers: modifiers.filter(key => event[{Control: 'ctrlKey', Alt: 'altKey', Shift: 'shiftKey', Meta: 'metaKey'}[key]]), key: event.code}, platform);
  }

  function format(value, platform) {
    if (!value) return '';
    const labels = platform === 'darwin'
      ? {Control: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘'}
      : {Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win'};
    return value.modifiers.map(key => labels[key]).concat(value.key.replace(/^(Key|Digit)/, '')).join(platform === 'darwin' ? ' ' : ' + ');
  }

  function suggestions(current, target, platform) {
    const used = new Set(Object.values(current.bindings).map(identity));
    const groups = platform === 'darwin' ? [['Alt', 'Meta'], ['Control', 'Alt']] : [['Control', 'Alt'], ['Control', 'Shift']];
    return groups.flatMap(keys => [...'7890123456'].map(key => ({modifiers: keys, key: 'Digit' + key})))
      .filter(value => !used.has(identity(value)));
  }
  return {targets, binding, configuration, fromEvent, format, suggestions, identity, unavailable};
});
