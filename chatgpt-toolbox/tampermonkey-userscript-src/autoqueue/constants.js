  /********************************************************************
   * 批量任务完成标记：唯一常量与检测辅助（auto-queue / upload 共用）
   ********************************************************************/

  const BATCH_TASK_DONE_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>';

  function hasBatchTaskDoneSignal(text) {
    const raw = String(text || '');
    if (!raw) {
      return false;
    }
    if (raw.includes(BATCH_TASK_DONE_SIGNAL)) {
      return true;
    }
    if (typeof parseBatchStopSignal === 'function') {
      const parsed = parseBatchStopSignal(raw, 'hasBatchTaskDoneSignal');
      return !!(parsed && parsed.terminal === true && parsed.type === 'stop');
    }
    return false;
  }

  function isDoneSignalReason(reason) {
    const text = String(reason || '');
    if (!text) {
      return false;
    }
    if (text.includes(BATCH_TASK_DONE_SIGNAL)) {
      return true;
    }
    return (
      text.includes('task-done-signal')
      || text.includes('assistant-done-signal')
      || text.includes('task-done-signal-before-send')
      || text.includes('assistant-done-signal-before-send')
      || text.includes('done-marker-detected')
      || text.includes('terminal-confirm')
      || text.includes('model-stop-signal')
      || text.includes('legacy-model-stop-signal')
    );
  }
