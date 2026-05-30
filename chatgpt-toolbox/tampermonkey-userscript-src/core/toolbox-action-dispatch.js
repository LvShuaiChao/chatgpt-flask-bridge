/********************************************************************
 * 统一动作分发：所有按钮点击 / 快捷键 / fallback 入口
 ********************************************************************/

const ToolboxActionDispatch = (() => {
  let executor = null;

  function appendDispatchLog(line) {
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
      return;
    }
    console.log(line);
  }

  function registerExecutor(fn) {
    if (typeof fn !== 'function') {
      console.error('[ToolboxActionDispatch] registerExecutor expected function, got', typeof fn);
      return;
    }
    executor = fn;
    appendDispatchLog('[ACTION_DISPATCH][EXECUTOR_REGISTERED]');
  }

  function resolveCanonicalAction(action, ctx = {}) {
    const raw = String(action || '').trim();
    let canonical = raw;

    if (typeof ToolboxActionRegistry !== 'undefined' && ToolboxActionRegistry && typeof ToolboxActionRegistry.normalizeAction === 'function') {
      canonical = ToolboxActionRegistry.normalizeAction(raw);
    }

    const button = ctx.button instanceof HTMLElement ? ctx.button : null;
    if (button && button.id && typeof ToolboxActionRegistry !== 'undefined' && ToolboxActionRegistry) {
      const fromId = ToolboxActionRegistry.resolveActionFromButtonId(button.id);
      if (fromId && (!canonical || canonical === raw)) {
        canonical = fromId;
      }
    }

    return {
      raw,
      canonical,
      handlerAction: (
        typeof ToolboxActionRegistry !== 'undefined'
        && ToolboxActionRegistry
        && typeof ToolboxActionRegistry.resolveHandlerAction === 'function'
      )
        ? ToolboxActionRegistry.resolveHandlerAction(canonical)
        : canonical,
    };
  }

  function precheckPayload(action, ctx = {}) {
    if (typeof CanonicalPayloadState === 'undefined' || !CanonicalPayloadState) {
      return { blocked: false };
    }
    if (ctx.skipPayloadPrecheck === true) {
      return { blocked: false };
    }
    const source = String(ctx.source || 'unknown').trim() || 'unknown';
    const block = CanonicalPayloadState.blockSendIfPayloadNotReady(action, `dispatch:${source}`);
    if (!block.blocked) {
      return block;
    }
    appendDispatchLog(
      `[ACTION_DISPATCH][PAYLOAD_BLOCK] action=${action} reason=${block.snapshot && block.snapshot.reason ? block.snapshot.reason : '-'} source=${source}`,
    );
    if (block.message && typeof setStatus === 'function') {
      setStatus(block.message, 'warn');
    } else if (block.message) {
      appendDispatchLog(`[ACTION_DISPATCH][PAYLOAD_BLOCK_MSG] ${block.message}`);
    }
    return block;
  }

  function dispatchToolboxAction(action, ctx = {}) {
    const source = String(ctx.source || 'unknown').trim() || 'unknown';
    const button = ctx.button || null;
    const event = ctx.event || null;
    const resolved = resolveCanonicalAction(action, ctx);

    appendDispatchLog(
      `[ACTION_DISPATCH][HIT] action=${resolved.canonical || '-'} handler=${resolved.handlerAction || '-'} raw=${resolved.raw || '-'} source=${source} id=${button && button.id ? button.id : '-'}`,
    );

    if (
      typeof ToolboxActionRegistry !== 'undefined'
      && ToolboxActionRegistry
      && typeof ToolboxActionRegistry.isClosedLoopAction === 'function'
      && ToolboxActionRegistry.isClosedLoopAction(resolved.canonical)
    ) {
      appendDispatchLog(
        `[CLOSED_LOOP][MODE_CLICK] action=${resolved.canonical} source=${source} id=${button && button.id ? button.id : '-'}`,
      );
    }

    const payloadBlock = precheckPayload(resolved.canonical, ctx);
    if (payloadBlock.blocked) {
      return false;
    }

    if (typeof executor !== 'function') {
      console.error('[ToolboxActionDispatch] no executor registered', {
        action: resolved.canonical,
        source,
      });
      appendDispatchLog(
        `[ACTION_DISPATCH][MISS] reason=no-executor action=${resolved.canonical || '-'} source=${source}`,
      );
      return false;
    }

    try {
      return executor(resolved.handlerAction || resolved.canonical, button, source, event, resolved);
    } catch (err) {
      console.error('[ToolboxActionDispatch] executor failed', err);
      const errText = err && err.message ? err.message : String(err);
      appendDispatchLog(
        `[ACTION_DISPATCH][ERROR] action=${resolved.canonical || '-'} source=${source} error=${errText}`,
      );
      return false;
    }
  }

  return {
    registerExecutor,
    dispatchToolboxAction,
    resolveCanonicalAction,
  };
})();
