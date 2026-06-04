/********************************************************************
 * 统一动作分发：所有按钮点击 / 快捷键 / fallback 入口
 ********************************************************************/

const ToolboxActionDispatch = (() => {
  let executor = null;
  let payloadPrecheckBypass = null;

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

  function registerPayloadPrecheckBypass(fn) {
    if (typeof fn !== 'function') {
      console.error('[ToolboxActionDispatch] registerPayloadPrecheckBypass expected function, got', typeof fn);
      return;
    }
    payloadPrecheckBypass = fn;
    appendDispatchLog('[ACTION_DISPATCH][PAYLOAD_PRECHECK_BYPASS_REGISTERED]');
  }

  function resolveCanonicalAction(action, ctx = {}) {
    const raw = String(action || '').trim();
    let canonical = raw;

    if (typeof ToolboxActionRegistry !== 'undefined' && ToolboxActionRegistry && typeof ToolboxActionRegistry.normalizeAction === 'function') {
      canonical = ToolboxActionRegistry.normalizeAction(raw);
    }

    const button = ctx.button instanceof HTMLElement ? ctx.button : null;
    if (button && button.id === 'cgpt-copy-last-message-scroll-bottom') {
      canonical = (
        typeof ToolboxActionRegistry !== 'undefined'
        && ToolboxActionRegistry
        && ToolboxActionRegistry.ACTION
      )
        ? ToolboxActionRegistry.ACTION.COPY_ONLY
        : 'copy-only';
    } else if (button && button.id && typeof ToolboxActionRegistry !== 'undefined' && ToolboxActionRegistry) {
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
    if (typeof payloadPrecheckBypass === 'function') {
      try {
        if (payloadPrecheckBypass(action, ctx) === true) {
          return { blocked: false };
        }
      } catch (err) {
        console.error('[ToolboxActionDispatch] payloadPrecheckBypass failed', err);
        appendDispatchLog(
          `[ACTION_DISPATCH][PAYLOAD_PRECHECK_BYPASS_ERROR] error=${err && err.message ? err.message : String(err)}`,
        );
      }
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
    let dispatchAction = action;

    if (button instanceof HTMLElement && button.id === 'cgpt-copy-last-message-scroll-bottom') {
      dispatchAction = 'copy-only';
      const resolvedCopyOnly = resolveCanonicalAction(dispatchAction, ctx);
      appendDispatchLog(
        `[ACTION_DISPATCH][COPY_ONLY_HIT] raw=${resolvedCopyOnly.raw || '-'} resolvedAction=${resolvedCopyOnly.canonical || '-'} source=${source} id=${button.id}`,
      );
      const payloadBlockCopyOnly = precheckPayload(resolvedCopyOnly.canonical, ctx);
      if (payloadBlockCopyOnly.blocked) {
        return false;
      }
      if (typeof executor !== 'function') {
        console.error('[ToolboxActionDispatch] no executor registered', {
          action: resolvedCopyOnly.canonical,
          source,
        });
        appendDispatchLog(
          `[ACTION_DISPATCH][MISS] reason=no-executor action=${resolvedCopyOnly.canonical || '-'} source=${source}`,
        );
        return false;
      }
      try {
        return executor(
          resolvedCopyOnly.handlerAction || resolvedCopyOnly.canonical,
          button,
          source,
          event,
          resolvedCopyOnly,
        );
      } catch (err) {
        console.error('[ToolboxActionDispatch] executor failed', err);
        const errText = err && err.message ? err.message : String(err);
        appendDispatchLog(
          `[ACTION_DISPATCH][ERROR] action=${resolvedCopyOnly.canonical || '-'} source=${source} error=${errText}`,
        );
        return false;
      }
    }

    if (button instanceof HTMLElement) {
      const runtimeAction = String(button.dataset.cgptRuntimeAction || '').trim();
      const baseAction = String(
        button.dataset.cgptBaseAction || button.dataset.action || '',
      ).trim();
      if (runtimeAction || baseAction) {
        appendDispatchLog(
          `[TOOLBOX_ACTION][RUNTIME_ACTION] base=${baseAction || '-'} runtime=${runtimeAction || '-'} id=${button.id || '-'}`,
        );
      }
      if (runtimeAction) {
        dispatchAction = runtimeAction;
        if (runtimeAction === 'cancel' || runtimeAction === 'stop') {
          const ownerButtonId = String(
            button.dataset.cgptOwnerButtonId || button.id || '',
          ).trim();
          if (
            ownerButtonId === 'cgpt-copy-hotkey-once'
            || baseAction === 'cancel-copy-hotkey-once'
          ) {
            dispatchAction = 'copy-and-hotkey';
          } else if (ownerButtonId === 'cgpt-send-message-once') {
            dispatchAction = 'cancel-send';
          } else if (ownerButtonId === 'cgpt-send-copy-hotkey-once') {
            dispatchAction = 'cancel-send-copy-hotkey';
          } else if (
            baseAction === 'copy-hotkey-once'
            || baseAction === 'copy-and-hotkey'
          ) {
            dispatchAction = 'copy-and-hotkey';
          } else if (baseAction === 'send-message') {
            dispatchAction = 'cancel-send';
          } else if (!ownerButtonId) {
            appendDispatchLog(
              `[TOOLBOX_ACTION][CANCEL_OWNER_UNKNOWN] id=${button.id || '-'} action=${baseAction || '-'} runtime=${runtimeAction}`,
            );
          }
        }
      } else if (baseAction) {
        dispatchAction = baseAction;
      }
    }

    const resolved = resolveCanonicalAction(dispatchAction, ctx);

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
    registerPayloadPrecheckBypass,
    dispatchToolboxAction,
    resolveCanonicalAction,
  };
})();
