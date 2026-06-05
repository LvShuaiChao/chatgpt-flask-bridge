/********************************************************************
 * 统一快捷键注册与单监听器分发
 ********************************************************************/

const ToolboxShortcutRegistry = (() => {
  const SHORTCUT_ACTION_REGISTRY = Object.freeze([
    Object.freeze({
      configKey: 'sendCopyAndHotkeyOnce',
      action: 'send-copy-hotkey',
      label: '发送+复制+快捷键',
      priority: 10,
    }),
    Object.freeze({
      configKey: 'copyAndHotkeyOnce',
      action: 'copy-hotkey-once',
      handlerAction: 'copy-and-hotkey',
      label: '复制+快捷键',
      priority: 20,
    }),
    Object.freeze({
      configKey: 'startUpload',
      action: 'start-upload',
      label: '开始上传',
      priority: 30,
    }),
    Object.freeze({
      configKey: 'copyLastMessage',
      action: 'copy-only',
      label: '复制最后回复',
      priority: 40,
    }),
    Object.freeze({
      configKey: 'sendMessage',
      action: 'send-message',
      label: '发送消息',
      priority: 100,
    }),
  ]);

  let dispatchShortcut = null;
  let bound = false;

  function appendShortcutLog(line) {
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
      return;
    }
    console.log(line);
  }

  function registerShortcutDispatcher(fn) {
    if (typeof fn !== 'function') {
      console.error('[ToolboxShortcutRegistry] registerShortcutDispatcher expected function');
      return;
    }
    dispatchShortcut = fn;
    appendShortcutLog('[SHORTCUT_REGISTRY][DISPATCHER_REGISTERED]');
  }

  function getShortcutItem(configKey) {
    const cfg = typeof getShortcutConfig === 'function' ? getShortcutConfig() : {};
    return cfg && cfg[configKey] ? cfg[configKey] : null;
  }

  function isEventMatched(event, item) {
    if (!item || item.enabled === false) {
      return false;
    }
    if (typeof isShortcutConfigEventMatched === 'function') {
      return isShortcutConfigEventMatched(event, item);
    }
    if (typeof isShortcutEventMatched === 'function') {
      return isShortcutEventMatched(event, item);
    }
    return false;
  }

  function matchShortcutAction(event) {
    const sorted = [...SHORTCUT_ACTION_REGISTRY].sort((a, b) => a.priority - b.priority);
    for (const entry of sorted) {
      const item = getShortcutItem(entry.configKey);
      if (isEventMatched(event, item)) {
        return entry;
      }
    }
    return null;
  }

  function shouldIgnoreTarget(event) {
    if (typeof shouldIgnoreToolboxShortcutTarget === 'function') {
      return shouldIgnoreToolboxShortcutTarget(event.target);
    }
    return false;
  }

  function handleToolboxShortcut(event, source = 'document') {
    if (!event || event.defaultPrevented) {
      return false;
    }

    const matched = matchShortcutAction(event);
    if (!matched) {
      return false;
    }

    if (event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      appendShortcutLog(`[SHORTCUT_REGISTRY][SKIP] reason=repeat action=${matched.action} source=${source}`);
      return true;
    }

    if (shouldIgnoreTarget(event)) {
      appendShortcutLog(`[SHORTCUT_REGISTRY][SKIP] reason=ignore-target action=${matched.action} source=${source}`);
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') {
      event.stopImmediatePropagation();
    }

    const keyLabel = typeof formatShortcutFromEvent === 'function'
      ? formatShortcutFromEvent(event)
      : (event.key || event.code || '-');

    appendShortcutLog(
      `[SHORTCUT_REGISTRY][MATCH] action=${matched.action} configKey=${matched.configKey} key=${keyLabel} source=${source}`,
    );

    if (typeof dispatchShortcut !== 'function') {
      console.error('[ToolboxShortcutRegistry] shortcut matched but no dispatcher', matched);
      appendShortcutLog(`[SHORTCUT_REGISTRY][MISS] reason=no-dispatcher action=${matched.action}`);
      return true;
    }

    try {
      dispatchShortcut(matched, event, source);
    } catch (err) {
      console.error('[ToolboxShortcutRegistry] dispatchShortcut failed', err);
      const errText = err && err.message ? err.message : String(err);
      appendShortcutLog(`[SHORTCUT_REGISTRY][ERROR] action=${matched.action} error=${errText}`);
    }

    return true;
  }

  function bindUnifiedToolboxShortcut() {
    if (bound || (typeof window !== 'undefined' && window.__cgptUnifiedToolboxShortcutBound)) {
      appendShortcutLog('[SHORTCUT_REGISTRY][bind-skip] reason=already-bound');
      return;
    }
    bound = true;
    if (typeof window !== 'undefined') {
      window.__cgptUnifiedToolboxShortcutBound = true;
    }

    const listener = (event) => {
      handleToolboxShortcut(event, 'unified-document');
    };

    document.addEventListener('keydown', listener, true);
    appendShortcutLog('[SHORTCUT_REGISTRY][bind] unified keydown listener active');
  }

  return {
    SHORTCUT_ACTION_REGISTRY,
    registerShortcutDispatcher,
    bindUnifiedToolboxShortcut,
    handleToolboxShortcut,
    matchShortcutAction,
  };
})();


