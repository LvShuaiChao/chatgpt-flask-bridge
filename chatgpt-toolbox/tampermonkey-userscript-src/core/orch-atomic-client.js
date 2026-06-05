/********************************************************************
 * GUI 编排原子动作客户端：仅执行单步页面操作并回报结果
 ********************************************************************/

const OrchAtomicClient = (() => {
  const ACTIVE_RUNS = new Map();
  const WAIT_REPLY_MAX_MS = 5 * 60 * 1000;
  const WAIT_REPLY_STABLE_MS = 3000;

  function appendOrchLog(line) {
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
      return;
    }
    console.log(line);
  }

  function isOrchSendCopyHotkeyEnabled() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('cgpt_toolbox_enable_orch_send_copy_hotkey') === '1') {
        return true;
      }
    } catch (storageErr) {
      console.error('[OrchAtomicClient] localStorage read failed', storageErr);
    }
    if (typeof MemoryManager !== 'undefined' && MemoryManager && typeof MemoryManager.get === 'function') {
      const flag = MemoryManager.get('orchSendCopyHotkeyEnabled', false);
      return flag === true || flag === 'true' || flag === 1;
    }
    return false;
  }

  function buildPageSnapshotForOrch(reason = 'orch') {
    const identity = typeof getPageIdentity === 'function' ? getPageIdentity() : {};
    const capability = typeof getPageCapability === 'function'
      ? getPageCapability(reason)
      : {};
    const responseState = typeof detectResponseState === 'function'
      ? detectResponseState({ reason })
      : {};
    return {
      client_id: identity.client_id || '',
      page_instance_id: identity.page_instance_id || '',
      conversation_id: identity.conversation_id || '',
      url: (identity.url || location.href || '').trim(),
      response_state: String(
        responseState.response_state
          || capability.response_state
          || '',
      ).trim(),
      is_responding: Boolean(
        responseState.is_responding
          || capability.is_responding,
      ),
      can_send_now: Boolean(
        responseState.can_send_now
          || capability.can_send_now,
      ),
      can_accept_input: Boolean(
        responseState.can_accept_input
          || capability.can_accept_input,
      ),
      visibility_state: document.visibilityState || '',
      has_focus: document.hasFocus(),
    };
  }

  async function reportStepResult(cmd, result) {
    const payload = {
      run_id: String(cmd.run_id || '').trim(),
      step_id: String(cmd.step_id || '').trim(),
      ok: result.ok === true,
      error: String(result.error || '').trim(),
      page_snapshot: buildPageSnapshotForOrch('orch-step-result'),
      detail: result.detail && typeof result.detail === 'object' ? result.detail : {},
    };
    appendOrchLog(
      `[BRIDGE_RESULT][RECV] run_id=${payload.run_id} step_id=${payload.step_id} ok=${payload.ok ? 1 : 0} flow=gui-orch`,
    );
    if (typeof BridgeModule === 'undefined' || !BridgeModule || typeof BridgeModule.report !== 'function') {
      console.error('[OrchAtomicClient] BridgeModule.report missing', payload);
      return { ok: false, error: 'bridge_report_missing' };
    }
    return BridgeModule.report('orch_step_result', payload);
  }

  function isRunCancelled(cmd) {
    const runId = String(cmd.run_id || '').trim();
    const state = ACTIVE_RUNS.get(runId);
    return !!(state && state.cancelRequested);
  }

  function markRunActive(cmd) {
    const runId = String(cmd.run_id || '').trim();
    if (!runId) {
      return;
    }
    ACTIVE_RUNS.set(runId, { cancelRequested: false, stepId: cmd.step_id });
  }

  function clearRun(cmd) {
    const runId = String(cmd.run_id || '').trim();
    if (runId) {
      ACTIVE_RUNS.delete(runId);
    }
  }

  function cancelRun(runId) {
    const id = String(runId || '').trim();
    if (!id) {
      return;
    }
    const state = ACTIVE_RUNS.get(id) || { cancelRequested: false };
    state.cancelRequested = true;
    ACTIVE_RUNS.set(id, state);
  }

  async function sleepMs(ms) {
    await new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  async function atomicDetectPageState(cmd) {
    const snap = buildPageSnapshotForOrch('detect_page_state');
    if (!snap.page_instance_id) {
      return { ok: false, error: 'missing_page_instance_id', detail: { snap } };
    }
    return { ok: true, detail: { snap } };
  }

  async function atomicDetectComposerState(cmd) {
    const snap = buildPageSnapshotForOrch('detect_composer_state');
    const textLen = typeof getComposerTextLength === 'function'
      ? Number(getComposerTextLength() || 0)
      : 0;
    return {
      ok: true,
      detail: {
        snap,
        text_len: textLen,
        sendable: snap.can_send_now,
        inputable: snap.can_accept_input,
      },
    };
  }

  async function atomicPreflightPage(cmd) {
    const page = await atomicDetectPageState(cmd);
    if (!page.ok) {
      return page;
    }
    const composer = await atomicDetectComposerState(cmd);
    if (!composer.ok) {
      return composer;
    }
    return { ok: true, detail: { page: page.detail, composer: composer.detail } };
  }

  async function atomicUploadFiles(cmd) {
    if (typeof ensureLocalFilesUploadedBeforeSendCopyHotkey !== 'function') {
      return { ok: true, detail: { skipped: 'no_upload_helper' } };
    }
    const ownerButtonId = String(cmd.payload?.owner_button_id || 'cgpt-send-copy-hotkey-once').trim();
    const uploadResult = await ensureLocalFilesUploadedBeforeSendCopyHotkey('orch-upload', {
      ownerButtonId,
      runId: cmd.run_id,
    });
    if (!uploadResult || uploadResult.ok !== true) {
      return {
        ok: false,
        error: String(uploadResult?.reason || 'upload_failed'),
        detail: uploadResult || {},
      };
    }
    return { ok: true, detail: uploadResult };
  }

  async function atomicSendMessage(cmd) {
    const src = String(cmd.payload?.source || 'orch-send').trim() || 'orch-send';
    if (typeof triggerSendFromToolbox !== 'function') {
      return { ok: false, error: 'triggerSendFromToolbox_missing' };
    }
    const sendOk = await triggerSendFromToolbox(src, {
      action: 'send-message',
      compositeAction: 'orch-atomic-send',
      skipSendCopyHotkeyPipeline: true,
    });
    if (sendOk !== true) {
      return { ok: false, error: 'send_failed' };
    }
    return { ok: true, detail: { sent: true } };
  }

  function hashText(text) {
    const value = String(text || '');
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  async function readLastAssistantSnapshot() {
    if (typeof extractLatestAssistantReplySnapshot === 'function') {
      return extractLatestAssistantReplySnapshot({ reason: 'orch-wait-reply' });
    }
    return { text: '', length: 0 };
  }

  async function atomicWaitReplyStateOnce(cmd) {
    const started = Date.now();
    let lastHash = '';
    let lastChangeAt = 0;
    while (Date.now() - started < WAIT_REPLY_MAX_MS) {
      if (isRunCancelled(cmd)) {
        return { ok: false, error: 'cancelled' };
      }
      const snap = buildPageSnapshotForOrch('wait_reply_state_once');
      if (!snap.is_responding) {
        const assistant = await readLastAssistantSnapshot();
        const textHash = hashText(assistant.text || '');
        const now = Date.now();
        if (textHash !== lastHash) {
          lastHash = textHash;
          lastChangeAt = now;
        }
        if (lastChangeAt > 0 && now - lastChangeAt >= WAIT_REPLY_STABLE_MS) {
          return {
            ok: true,
            detail: { stable_ms: now - lastChangeAt, length: assistant.length || 0 },
          };
        }
      }
      await sleepMs(500);
    }
    return { ok: false, error: 'wait_reply_timeout' };
  }

  async function atomicCopyLastAssistantMessage(cmd) {
    if (typeof copyLatestAssistantReplyUnified !== 'function') {
      return { ok: false, error: 'copy_helper_missing' };
    }
    const copyResult = await copyLatestAssistantReplyUnified({
      reason: `orch:${cmd.step_id || '-'}`,
      scrollBeforeCopy: true,
    });
    if (!copyResult || copyResult.ok !== true) {
      return {
        ok: false,
        error: String(copyResult?.reason || 'copy_failed'),
        detail: copyResult || {},
      };
    }
    const text = String(copyResult.text || '');
    return {
      ok: true,
      detail: {
        text_len: text.length,
        copied_len: text.length,
      },
    };
  }

  async function executeOrchCommand(cmd) {
    if (!cmd || typeof cmd !== 'object') {
      return { ok: false, error: 'invalid_command' };
    }
    const action = String(cmd.action || '').trim();
    appendOrchLog(
      `[BRIDGE_CMD][SEND] run_id=${cmd.run_id || '-'} step_id=${cmd.step_id || '-'} action=${action} flow=gui-orch`,
    );
    markRunActive(cmd);
    let result = { ok: false, error: `unknown_action:${action}` };
    try {
      if (action === 'detect_page_state') {
        result = await atomicDetectPageState(cmd);
      } else if (action === 'detect_composer_state') {
        result = await atomicDetectComposerState(cmd);
      } else if (action === 'preflight_page') {
        result = await atomicPreflightPage(cmd);
      } else if (action === 'upload_files' || action === 'upload_if_needed') {
        result = await atomicUploadFiles(cmd);
      } else if (action === 'send_message') {
        result = await atomicSendMessage(cmd);
      } else if (action === 'wait_reply_state_once' || action === 'wait_reply_done') {
        result = await atomicWaitReplyStateOnce(cmd);
      } else if (action === 'copy_last_assistant_message' || action === 'copy_last_reply') {
        result = await atomicCopyLastAssistantMessage(cmd);
      } else {
        result = { ok: false, error: `unsupported_atomic_action:${action}` };
      }
    } catch (err) {
      const errType = err && err.name ? err.name : 'Error';
      const errText = err && err.message ? err.message : String(err);
      console.error('[OrchAtomicClient][STEP_FAILED]', {
        run_id: cmd.run_id,
        step_id: cmd.step_id,
        action,
        error_type: errType,
        error: errText,
        stack: err && err.stack,
      });
      appendOrchLog(
        `[ORCH][STEP_FAIL] run_id=${cmd.run_id || '-'} step_id=${cmd.step_id || '-'} `
        + `action=${action} error_type=${errType} error=${errText} flow=gui-orch`,
      );
      result = { ok: false, error: errText, detail: { error_type: errType } };
    } finally {
      clearRun(cmd);
    }
    await reportStepResult(cmd, result);
    return result;
  }

  async function requestOrchTaskStart(taskType, payload = {}) {
    const body = {
      task_type: taskType,
      owner_button_id: payload.owner_button_id || 'cgpt-send-copy-hotkey-once',
      client_id: payload.client_id || '',
      page_instance_id: payload.page_instance_id || '',
      conversation_id: payload.conversation_id || '',
      source: payload.source || 'userscript',
      hotkey_combo: typeof getCopyThenShortcutTargetCombo === 'function'
        ? getCopyThenShortcutTargetCombo()
        : '',
      ...payload,
    };
    const identity = typeof getPageIdentity === 'function' ? getPageIdentity() : {};
    body.client_id = body.client_id || identity.client_id || '';
    body.page_instance_id = body.page_instance_id || identity.page_instance_id || '';
    body.conversation_id = body.conversation_id || identity.conversation_id || '';
    appendOrchLog(
      `[ORCH][TASK_REQUEST] task_type=${taskType} owner=${body.owner_button_id} flow=gui-orch`,
    );
    if (typeof BridgeModule === 'undefined' || !BridgeModule || typeof BridgeModule.report !== 'function') {
      return { ok: false, error: 'bridge_report_missing' };
    }
    return BridgeModule.report('orch_task_request', body);
  }

  async function requestOrchTaskCancel(payload = {}) {
    appendOrchLog(
      `[ORCH][TASK_CANCEL][REQUEST] run_id=${payload.run_id || '-'} owner=${payload.owner_button_id || '-'} flow=gui-orch`,
    );
    if (typeof BridgeModule === 'undefined' || !BridgeModule || typeof BridgeModule.report !== 'function') {
      return { ok: false, error: 'bridge_report_missing' };
    }
    if (payload.run_id) {
      cancelRun(payload.run_id);
    }
    return BridgeModule.report('orch_task_cancel', payload);
  }

  function mergeOrchRuntimeIntoSnapshot(snapshot = {}) {
    const base = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const orchViews = base.orchButtonViews
      || base.orch_button_views
      || {};
    return {
      ...base,
      orchButtonViews: orchViews,
      orchEnabled: base.orchEnabled === true || base.orch_enabled === true,
    };
  }

  return Object.freeze({
    isOrchSendCopyHotkeyEnabled,
    executeOrchCommand,
    requestOrchTaskStart,
    requestOrchTaskCancel,
    cancelRun,
    mergeOrchRuntimeIntoSnapshot,
    buildPageSnapshotForOrch,
  });
})();


