/********************************************************************
 * 統一非同步流程運行鎖：runToken + AbortController
 ********************************************************************/

const FlowRuntime = (() => {
  const active = new Map();
  let seq = 0;

  function appendFlowLog(line) {
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
      return;
    }
    console.log(line);
  }

  function createFlowRun(kind, options = {}) {
    const flowKind = String(kind || '').trim();
    if (!flowKind) {
      return { ok: false, locked: true, reason: 'missing-kind', run: null };
    }

    const cancelPrevious = options.cancelPrevious !== false;
    const old = active.get(flowKind);

    if (old && !old.cancelled && !old.controller.signal.aborted) {
      if (cancelPrevious) {
        cancelFlowRun(flowKind, 'superseded');
      } else {
        appendFlowLog(`[FLOW][LOCKED] kind=${flowKind} activeId=${old.id}`);
        return { ok: false, locked: true, reason: 'locked', run: null };
      }
    }

    const run = {
      id: `${flowKind}-${Date.now()}-${++seq}`,
      kind: flowKind,
      startedAt: Date.now(),
      controller: new AbortController(),
      cancelled: false,
    };

    active.set(flowKind, run);
    appendFlowLog(`[FLOW][START] kind=${flowKind} id=${run.id}`);
    return { ok: true, locked: false, reason: 'started', run };
  }

  function getActiveFlowRun(kind) {
    return active.get(String(kind || '').trim()) || null;
  }

  function isCurrentFlowRun(run) {
    if (!run || !run.kind || !run.id) {
      return false;
    }

    const activeRun = active.get(run.kind);
    return !!(
      activeRun
      && activeRun.id === run.id
      && !run.cancelled
      && !run.controller.signal.aborted
    );
  }

  function cancelFlowRun(kind, reason = 'manual') {
    const flowKind = String(kind || '').trim();
    const run = active.get(flowKind);
    if (!run) {
      return false;
    }

    run.cancelled = true;

    try {
      run.controller.abort();
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[ChatGPT toolbox] cancelFlowRun abort failed', error);
      appendFlowLog(`[FLOW][ABORT_FAILED] kind=${flowKind} reason=${reason} error=${errText}`);
    }

    appendFlowLog(`[FLOW][CANCEL] kind=${flowKind} id=${run.id} reason=${reason}`);
    return true;
  }

  function finishFlowRun(run, reason = 'done') {
    if (!run || !run.kind || !run.id) {
      return;
    }

    const activeRun = active.get(run.kind);
    if (activeRun && activeRun.id === run.id) {
      active.delete(run.kind);
    }

    appendFlowLog(`[FLOW][FINISH] kind=${run.kind} id=${run.id} reason=${reason}`);
  }

  function assertFlowAlive(run, stage) {
    if (isCurrentFlowRun(run)) {
      return true;
    }

    const reason = run && run.controller && run.controller.signal.aborted
      ? 'aborted'
      : (run && run.cancelled ? 'cancelled' : 'stale-run');

    appendFlowLog(
      `[FLOW][STOP] kind=${run ? run.kind : '-'} id=${run ? run.id : '-'} stage=${stage || '-'} reason=${reason}`,
    );

    if (reason === 'aborted') {
      appendFlowLog(`[FLOW][ABORTED] stage=${stage || '-'}`);
    } else if (reason === 'stale-run') {
      appendFlowLog(`[FLOW][STALE] stage=${stage || '-'}`);
    }

    return false;
  }

  function tryAcquireFlowRun(kind) {
    return createFlowRun(kind, { cancelPrevious: false });
  }

  return {
    createFlowRun,
    tryAcquireFlowRun,
    cancelFlowRun,
    finishFlowRun,
    isCurrentFlowRun,
    assertFlowAlive,
    getActiveFlowRun,
  };
})();


