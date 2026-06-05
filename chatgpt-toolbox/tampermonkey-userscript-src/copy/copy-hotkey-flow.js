const CopyHotkeyFlow = (() => {
  async function runOnce(options = {}) {
    const source = options.source || 'copy-hotkey-flow';

    if (!CopyReplyWaiter.isReplyDone(source)) {
      return {
        ok: false,
        reason: 'reply_not_done'
      };
    }

    const text = CopyTextSource.getLatestAssistantText(source);
    if (!text) {
      console.error('[COPY_HOTKEY_FLOW][EMPTY_TEXT]');
      return {
        ok: false,
        reason: 'empty_text'
      };
    }

    if (
      typeof CopyPipeline !== 'undefined'
      && CopyPipeline
      && typeof CopyPipeline.copyText === 'function'
    ) {
      const copied = await CopyPipeline.copyText(text, options);
      if (!copied || copied.ok === false) {
        return {
          ok: false,
          reason: 'copy_failed',
          copied
        };
      }
    } else {
      console.error('[COPY_HOTKEY_FLOW][MISSING] CopyPipeline.copyText');
      return {
        ok: false,
        reason: 'missing_copy_pipeline'
      };
    }

    if (
      typeof ToolboxActionDispatch !== 'undefined'
      && ToolboxActionDispatch
      && typeof ToolboxActionDispatch.dispatch === 'function'
    ) {
      return ToolboxActionDispatch.dispatch('send-hotkey', {
        source
      });
    }

    console.error('[COPY_HOTKEY_FLOW][MISSING] ToolboxActionDispatch.dispatch');
    return {
      ok: false,
      reason: 'missing_action_dispatch'
    };
  }

  return {
    runOnce
  };
})();

if (typeof window !== 'undefined') {
  window.CopyHotkeyFlow = CopyHotkeyFlow;
}
