  /********************************************************************
   * UploadSendTaskState：发送任务 canonical state 纯函数
   *
   * 说明：
   * 1. 从 upload-module.js 拆出。
   * 2. 只负责 phase/subPhase 归一化和 canonical task 快照构造。
   * 3. 不读写 DOM，不读写按钮，不读写上传队列，不修改闭环状态。
   ********************************************************************/
  const UploadSendTaskState = (() => {
    const CANONICAL_SEND_PHASES = Object.freeze({
      IDLE: 'idle',
      WAITING_SEND: 'waiting_send',
      SENDING: 'sending',
      WAITING_REPLY: 'waiting_reply',
      SUCCESS: 'success',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
    });

    function nowForTaskState() {
      return Date.now();
    }

    function createIdleCanonicalSendTask(extra = {}) {
      const ts = nowForTaskState();
      return {
        running: false,
        phase: CANONICAL_SEND_PHASES.IDLE,
        subPhase: '',
        action: '',
        ownerButtonId: '',
        runId: '',
        reason: '',
        error: '',
        cancelRequested: false,
        abortController: null,
        startedAt: 0,
        updatedAt: ts,
        finishedAt: 0,
        ...extra,
      };
    }

    function normalizeCanonicalSendPhase(phase) {
      const value = String(phase || '').trim().toLowerCase();
      if (
        value === CANONICAL_SEND_PHASES.IDLE
        || value === CANONICAL_SEND_PHASES.WAITING_SEND
        || value === CANONICAL_SEND_PHASES.SENDING
        || value === CANONICAL_SEND_PHASES.WAITING_REPLY
        || value === CANONICAL_SEND_PHASES.SUCCESS
        || value === CANONICAL_SEND_PHASES.FAILED
        || value === CANONICAL_SEND_PHASES.CANCELLED
      ) {
        return value;
      }
      if (
        value === 'waiting'
        || value === 'waiting_input'
        || value === 'waiting_attachment'
        || value === 'waiting_page_reply_to_send'
        || value === 'ready_to_click'
        || value === 'waiting_composer'
        || value === 'writing_text'
        || value === 'preparing'
        || value === 'checking_composer'
      ) {
        return CANONICAL_SEND_PHASES.WAITING_SEND;
      }
      if (
        value === 'clicking_send'
        || value === 'sending_hotkey'
        || value === 'sending_continue'
        || value === 'confirming_clipboard'
        || value === 'copying'
        || value === 'running'
      ) {
        return CANONICAL_SEND_PHASES.SENDING;
      }
      if (
        value === 'sent_waiting_response'
        || value === 'waiting_reply'
        || value === 'stopping_response'
      ) {
        return CANONICAL_SEND_PHASES.WAITING_REPLY;
      }
      if (value === 'success' || value === 'done' || value === 'completed') {
        return CANONICAL_SEND_PHASES.SUCCESS;
      }
      if (value === 'fail' || value === 'failed' || value === 'error') {
        return CANONICAL_SEND_PHASES.FAILED;
      }
      if (value === 'cancel' || value === 'cancelled' || value === 'canceled') {
        return CANONICAL_SEND_PHASES.CANCELLED;
      }
      return CANONICAL_SEND_PHASES.IDLE;
    }

    function normalizeCanonicalSendSubPhase(phase, subPhase) {
      const rawSubPhase = String(subPhase || '').trim();
      if (rawSubPhase) {
        return rawSubPhase;
      }
      const rawPhase = String(phase || '').trim().toLowerCase();
      if (!rawPhase) {
        return '';
      }
      const normalizedPhase = normalizeCanonicalSendPhase(rawPhase);
      if (rawPhase !== normalizedPhase) {
        return rawPhase;
      }
      return '';
    }

    function isCanonicalSendTaskRunning(task) {
      if (!task || typeof task !== 'object') {
        return false;
      }
      const phase = normalizeCanonicalSendPhase(task.phase);
      if (phase === CANONICAL_SEND_PHASES.IDLE) {
        return false;
      }
      if (
        phase === CANONICAL_SEND_PHASES.SUCCESS
        || phase === CANONICAL_SEND_PHASES.FAILED
        || phase === CANONICAL_SEND_PHASES.CANCELLED
      ) {
        return false;
      }
      return task.running === true;
    }

    function buildCanonicalSendTaskFromRaw(rawTask = {}, extra = {}) {
      const ts = nowForTaskState();
      const source = rawTask && typeof rawTask === 'object' ? rawTask : {};
      const rawPhase = source.phase;
      const rawSubPhase = source.subPhase;
      const phase = normalizeCanonicalSendPhase(rawPhase);
      const subPhase = normalizeCanonicalSendSubPhase(rawPhase, rawSubPhase);
      const running = (
        source.running === true
        || (
          phase !== CANONICAL_SEND_PHASES.IDLE
          && phase !== CANONICAL_SEND_PHASES.SUCCESS
          && phase !== CANONICAL_SEND_PHASES.FAILED
          && phase !== CANONICAL_SEND_PHASES.CANCELLED
        )
      );
      return {
        running,
        phase,
        subPhase,
        action: String(source.action || extra.action || ''),
        ownerButtonId: String(source.ownerButtonId || extra.ownerButtonId || ''),
        runId: String(source.runId || extra.runId || ''),
        reason: String(source.reason || extra.reason || ''),
        error: String(source.error || extra.error || ''),
        cancelRequested: source.cancelRequested === true || extra.cancelRequested === true,
        abortController: source.abortController || extra.abortController || null,
        startedAt: Number(source.startedAt || extra.startedAt || 0),
        updatedAt: Number(source.updatedAt || extra.updatedAt || ts),
        finishedAt: Number(source.finishedAt || extra.finishedAt || 0),
      };
    }

    return Object.freeze({
      CANONICAL_SEND_PHASES,
      nowForTaskState,
      createIdleCanonicalSendTask,
      normalizeCanonicalSendPhase,
      normalizeCanonicalSendSubPhase,
      isCanonicalSendTaskRunning,
      buildCanonicalSendTaskFromRaw,
    });
  })();

  globalThis.UploadSendTaskState = UploadSendTaskState;


