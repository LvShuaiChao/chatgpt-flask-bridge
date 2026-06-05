const CopyReplyWaiter = (() => {
  function isReplyDone(reason = '') {
    const authority = (
      typeof ToolboxAuthorityState !== 'undefined'
      && ToolboxAuthorityState
      && typeof ToolboxAuthorityState.getSnapshot === 'function'
    )
      ? ToolboxAuthorityState.getSnapshot(reason, { force: true })
      : null;

    if (!authority) {
      console.error('[COPY_REPLY_WAITER][NO_AUTHORITY_STATE]');
      return false;
    }

    return authority.replyState === 'ready' || authority.replyState === 'idle';
  }

  return {
    isReplyDone
  };
})();

if (typeof window !== 'undefined') {
  window.CopyReplyWaiter = CopyReplyWaiter;
}
