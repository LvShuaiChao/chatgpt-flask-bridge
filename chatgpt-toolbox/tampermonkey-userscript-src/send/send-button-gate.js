const SendButtonGate = (() => {
  function getGate(reason = '') {
    const authority = (
      typeof ToolboxAuthorityState !== 'undefined'
      && ToolboxAuthorityState
      && typeof ToolboxAuthorityState.getSnapshot === 'function'
    )
      ? ToolboxAuthorityState.getSnapshot(reason)
      : null;

    if (!authority) {
      console.error('[SEND_BUTTON_GATE][NO_AUTHORITY_STATE]');
      return {
        ok: false,
        reason: 'no_authority_state',
        authority: null
      };
    }

    if (!authority.composer || !authority.composer.sendReady) {
      return {
        ok: false,
        reason: 'composer_not_send_ready',
        authority
      };
    }

    if (authority.replyState === 'answering') {
      return {
        ok: false,
        reason: 'reply_answering',
        authority
      };
    }

    return {
      ok: true,
      reason: 'ok',
      authority
    };
  }

  return {
    getGate
  };
})();

if (typeof window !== 'undefined') {
  window.SendButtonGate = SendButtonGate;
}
