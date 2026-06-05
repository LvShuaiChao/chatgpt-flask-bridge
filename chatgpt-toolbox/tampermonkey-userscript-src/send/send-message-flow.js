const SendMessageFlow = (() => {
  async function run(options = {}) {
    const source = options.source || 'send-message-flow';
    const gate = SendButtonGate.getGate(source);
    if (!gate.ok) {
      SendTaskStore.setPhase('failed', gate.reason, {
        action: options.action || 'send-message'
      });
      return {
        ok: false,
        reason: gate.reason,
        gate
      };
    }

    SendTaskStore.setPhase('sending', source, {
      action: options.action || 'send-message',
      runId: options.runId || `send-${Date.now()}`,
      startedAt: Date.now()
    });

    if (
      typeof ComposerSendService !== 'undefined'
      && ComposerSendService
      && typeof ComposerSendService.sendCurrentComposer === 'function'
    ) {
      const result = await ComposerSendService.sendCurrentComposer(options);
      SendTaskStore.setPhase(result && result.ok ? 'success' : 'failed', source, {
        result
      });
      return result;
    }

    console.error('[SEND_MESSAGE_FLOW][MISSING] ComposerSendService.sendCurrentComposer');
    SendTaskStore.setPhase('failed', 'missing_composer_send_service');
    return {
      ok: false,
      reason: 'missing_composer_send_service'
    };
  }

  function cancel(reason = 'manual') {
    SendTaskStore.setPhase('cancelled', reason);
  }

  function getState() {
    return SendTaskStore.getState();
  }

  return {
    run,
    cancel,
    getState
  };
})();

if (typeof window !== 'undefined') {
  window.SendMessageFlow = SendMessageFlow;
}
