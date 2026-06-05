const SendShortcut = (() => {
  function bind(reason = '') {
    if (
      typeof ToolboxShortcutRegistry !== 'undefined'
      && ToolboxShortcutRegistry
      && typeof ToolboxShortcutRegistry.register === 'function'
    ) {
      return ToolboxShortcutRegistry.register('send-shortcut', {
        source: reason || 'send-shortcut'
      });
    }
    console.error('[SEND_SHORTCUT][MISSING] ToolboxShortcutRegistry.register');
    return {
      ok: false,
      reason: 'missing_shortcut_registry'
    };
  }

  function dispatch(reason = '') {
    if (
      typeof ToolboxActionDispatch !== 'undefined'
      && ToolboxActionDispatch
      && typeof ToolboxActionDispatch.dispatch === 'function'
    ) {
      return ToolboxActionDispatch.dispatch('send-message', {
        source: reason || 'send-shortcut'
      });
    }
    console.error('[SEND_SHORTCUT][MISSING] ToolboxActionDispatch.dispatch');
    return {
      ok: false,
      reason: 'missing_action_dispatch'
    };
  }

  return {
    bind,
    dispatch
  };
})();

if (typeof window !== 'undefined') {
  window.SendShortcut = SendShortcut;
}
