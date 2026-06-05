const ComposerCapability = (() => {
  const cache = {
    lightAt: 0,
    light: null,
    heavyAt: 0,
    heavy: null,
  };

  function nowMs() {
    return Date.now();
  }

  function readMainCapability(reason = '', options = {}) {
    if (typeof getPageCapability !== 'function') {
      return null;
    }
    const mode = options.mode === 'heavy' ? 'heavy' : 'light';
    const reasonText = String(reason || '').trim();
    const cap = getPageCapability(reasonText);
    if (!cap || typeof cap !== 'object') {
      return null;
    }
    return {
      ...cap,
      mode,
    };
  }

  function shouldReuse(at, maxAgeMs) {
    if (!at || !Number.isFinite(Number(at))) {
      return false;
    }
    return nowMs() - Number(at) <= Math.max(0, Number(maxAgeMs) || 0);
  }

  function getPageCapabilityUnified(reason = '', options = {}) {
    const light = options.light !== false;
    const heavy = options.heavy === true;
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Number(options.maxAgeMs) : 300;
    const mode = heavy ? 'heavy' : (light ? 'light' : 'heavy');

    if (mode === 'light' && cache.light && shouldReuse(cache.lightAt, maxAgeMs)) {
      return cache.light;
    }
    if (mode === 'heavy' && cache.heavy && shouldReuse(cache.heavyAt, maxAgeMs)) {
      return cache.heavy;
    }

    let cap = readMainCapability(reason, { mode });
    if (!cap) {
      return null;
    }

    cap = enrichCapabilityWithSendButton(cap);

    if (mode === 'light') {
      cache.light = cap;
      cache.lightAt = nowMs();
    } else {
      cache.heavy = cap;
      cache.heavyAt = nowMs();
      if (!cache.light) {
        cache.light = cap;
        cache.lightAt = cache.heavyAt;
      }
    }
    return cap;
  }

  function appendNativeSendReadyLog(state) {
    const line = `[COMPOSER_CAPABILITY][NATIVE_SEND_READY] source=unified/native-send-ready ready=${state.ready ? 1 : 0} sendSnapReady=${state.sendSnapReady ? 1 : 0} hasSubmitButton=${state.hasSubmitButton ? 1 : 0} canSendLight=${state.canSendLight ? 1 : 0} canSendForce=${state.canSendForce ? 1 : 0}`;
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLogIfChanged === 'function') {
      ToolboxShell.appendLogIfChanged(
        'COMPOSER_CAPABILITY:NATIVE_SEND_READY',
        `${state.ready ? 1 : 0}|${state.sendSnapReady ? 1 : 0}|${state.hasSubmitButton ? 1 : 0}|${state.canSendLight ? 1 : 0}|${state.canSendForce ? 1 : 0}`,
        line,
        1000,
      );
    } else if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  function probeDomSendButtonPresent() {
    const selectors = [
      'button#composer-submit-button',
      'button[data-testid="composer-submit-button"]',
      'button[data-testid="send-button"]',
      'button[aria-label="发送"]',
      'button[aria-label="发送消息"]',
      'button[aria-label="发送提示"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
    ];
    for (const selector of selectors) {
      const btn = document.querySelector(selector);
      if (btn instanceof HTMLButtonElement) {
        return true;
      }
    }
    return false;
  }

  function enrichCapabilityWithSendButton(cap) {
    if (!cap || typeof cap !== 'object') {
      return cap;
    }

    const domHasSendButton = probeDomSendButtonPresent();
    const hasSendButton = cap.hasSendButton === true
      || cap.has_send_button === true
      || domHasSendButton;

    let responseStateReason = String(cap.response_state_reason || '').trim();
    if (
      hasSendButton
      && (
        responseStateReason === 'send_button_missing'
        || responseStateReason === 'payload_ready_but_send_button_missing'
      )
    ) {
      responseStateReason = cap.can_send_now || cap.canSendNow ? 'ready' : 'composer_present';
    }

    const sendable = cap.sendable === true
      || (cap.can_send_now === true && hasSendButton && !cap.is_responding);

    return {
      ...cap,
      hasSendButton,
      has_send_button: hasSendButton,
      sendable,
      inputable: cap.inputable !== false && cap.can_accept_input !== false,
      reason: String(cap.reason || responseStateReason || '').trim() || responseStateReason,
      response_state_reason: responseStateReason || cap.response_state_reason,
    };
  }

  function callComposerOrLocal(name, args = []) {
    try {
      if (name === 'getComposerSendButtonSnapshot' && typeof getComposerSendButtonSnapshot === 'function') {
        return getComposerSendButtonSnapshot(...args);
      }
      if (name === 'hasRealSubmitButton' && typeof hasRealSubmitButton === 'function') {
        return hasRealSubmitButton(...args);
      }
      if (name === 'canSendNowLight' && typeof canSendNowLight === 'function') {
        return canSendNowLight(...args);
      }
      if (name === 'canSendNow' && typeof canSendNow === 'function') {
        return canSendNow(...args);
      }
      if (
        typeof ComposerApi !== 'undefined'
        && ComposerApi
        && typeof ComposerApi[name] === 'function'
      ) {
        return ComposerApi[name](...args);
      }
    } catch (err) {
      console.error(`[ChatGPT toolbox] ComposerCapability.${name} failed`, err);
    }
    return undefined;
  }

  function isNativeSendReadyForUpload(options = {}) {
    let sendSnapReady = false;
    const sendSnap = callComposerOrLocal('getComposerSendButtonSnapshot', [{ silent: true }]);
    if (sendSnap && sendSnap.ready === true) {
      sendSnapReady = true;
    }

    const hasSubmitButton = !!callComposerOrLocal('hasRealSubmitButton');
    const canSendLight = !!callComposerOrLocal('canSendNowLight');
    const canSendForce = !!callComposerOrLocal('canSendNow', [{ force: true }]);
    const ready = sendSnapReady || (hasSubmitButton && (canSendLight || canSendForce));

    if (options.log !== false) {
      appendNativeSendReadyLog({
        ready,
        sendSnapReady,
        hasSubmitButton,
        canSendLight,
        canSendForce,
      });
    }

    return ready;
  }

  return {
    getPageCapability: getPageCapabilityUnified,
    isNativeSendReadyForUpload,
  };
})();



