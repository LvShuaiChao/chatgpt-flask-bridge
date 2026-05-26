  /********************************************************************
   * UploadButtonVm：上传区按钮状态判定矩阵（文字 / phase / disabled / action）
   ********************************************************************/

  function buildTaskPhaseEnum() {
    const phases = typeof ButtonTasks !== 'undefined' && Array.isArray(ButtonTasks.Phases)
      ? ButtonTasks.Phases
      : [
        'idle',
        'uploading',
        'waiting_send',
        'sending',
        'waiting_reply',
        'copying',
        'running',
        'cancelling',
        'cancelled',
        'success',
        'failed',
      ];
    const out = {};
    for (const phase of phases) {
      const key = String(phase || '').trim().toUpperCase().replace(/-/g, '_');
      if (key) {
        out[key] = phase;
      }
    }
    return Object.freeze(out);
  }

  const TaskPhase = buildTaskPhaseEnum();

  const CANCELLABLE_TASK_PHASES = typeof ButtonTasks !== 'undefined' && ButtonTasks.CancellablePhases
    ? ButtonTasks.CancellablePhases
    : new Set([
      TaskPhase.UPLOADING,
      TaskPhase.WAITING_SEND,
      TaskPhase.SENDING,
      TaskPhase.WAITING_REPLY,
      TaskPhase.RUNNING,
      TaskPhase.COPYING,
    ]);

  function createRunId(prefix = 'task') {
    if (typeof ButtonTasks !== 'undefined' && typeof ButtonTasks.createTaskRunId === 'function') {
      return ButtonTasks.createTaskRunId(prefix);
    }
    return `${String(prefix || 'task')}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeTaskPhase(phase) {
    const value = String(phase || TaskPhase.IDLE).trim().toLowerCase();
    return Object.values(TaskPhase).includes(value) ? value : TaskPhase.IDLE;
  }

  function isCopyHotkeyLoopPhaseActive(phase) {
    const normalized = String(phase || TaskPhase.IDLE).trim().toLowerCase();
    return normalized !== TaskPhase.IDLE
      && normalized !== 'stopped'
      && normalized !== TaskPhase.SUCCESS
      && normalized !== TaskPhase.FAILED
      && normalized !== TaskPhase.CANCELLED;
  }

  function resolveSnapshotLoopActive(snapshot, taskKey, activeFlagKey) {
    if (snapshot[activeFlagKey] != null) {
      return !!snapshot[activeFlagKey];
    }
    const task = snapshot[taskKey] && typeof snapshot[taskKey] === 'object'
      ? snapshot[taskKey]
      : {};
    return isCopyHotkeyLoopPhaseActive(task.phase);
  }

  function resolveSnapshotTaskActive(snapshot, taskKey, activeFlagKey) {
    if (snapshot[activeFlagKey] != null) {
      return !!snapshot[activeFlagKey];
    }
    const task = snapshot[taskKey] && typeof snapshot[taskKey] === 'object'
      ? snapshot[taskKey]
      : {};
    const phase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    return phase !== TaskPhase.IDLE
      && phase !== TaskPhase.SUCCESS
      && phase !== TaskPhase.FAILED
      && phase !== TaskPhase.CANCELLED;
  }

  function getCopyHotkeyMutualBlockView(blockedBy) {
    if (blockedBy === 'uploadVerify') {
      return {
        phase: TaskPhase.RUNNING,
        text: '闭环继续运行中',
        title: '闭环继续+每5轮上传正在运行；请先停止该任务后再使用此按钮',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
      };
    }

    if (blockedBy === 'loop') {
      return {
        phase: TaskPhase.RUNNING,
        text: '连续复制运行中',
        title: '连续复制+快捷键+继续正在运行；请先停止该任务后再使用此按钮',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
      };
    }

    return {
      phase: TaskPhase.RUNNING,
      text: '复制流程运行中',
      title: '另一复制快捷键任务正在运行；请先停止后再使用此按钮',
      disabled: true,
      allowCancel: false,
      action: 'none',
      buttonPhase: 'disabled',
    };
  }

  function getUploadButtonViewState(snapshot = {}) {
    // 仅依据 uploadTask / uploadRunning / activeFilesCount，禁止读取 waitingSend / waitingReply / messageSending。
    const task = snapshot.uploadTask && typeof snapshot.uploadTask === 'object'
      ? snapshot.uploadTask
      : {};
    const phase = normalizeTaskPhase(task.phase);
    const uploadRunning = phase === TaskPhase.UPLOADING || phase === TaskPhase.CANCELLING;

    if (task.cancelRequested || phase === TaskPhase.CANCELLING) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '正在取消',
        title: '正在取消上传流程',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'disabled',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '上传失败',
        title: '上传失败，可再次点击开始',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.SUCCESS,
        text: '上传完成',
        title: '上传完成',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'success',
      };
    }

    if (phase === TaskPhase.CANCELLED) {
      return {
        phase: TaskPhase.CANCELLED,
        text: '已取消',
        title: '上传已取消',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'cancelled',
      };
    }

    if (task.parentTask === 'copyHotkeyContinueLoop' && uploadRunning) {
      const cycleIndex = Number(task.cycleIndex) || 0;
      const cycleLabel = cycleIndex > 0 ? `第 ${cycleIndex} 轮` : '循环';
      return {
        phase: TaskPhase.UPLOADING,
        text: `${cycleLabel}自动上传中`,
        title: '连续复制循环触发的自动上传，停止请点对应循环按钮',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'waiting',
      };
    }

    if (uploadRunning) {
      return {
        phase: TaskPhase.UPLOADING,
        text: '上传中，点击取消',
        title: '正在上传，再次点击可取消',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'danger',
      };
    }

    const noFiles = Number(snapshot.activeFilesCount || 0) <= 0;
    return {
      phase: TaskPhase.IDLE,
      text: '开始上传',
      title: '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
      disabled: noFiles,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getCopyLastReplyButtonViewState(snapshot = {}) {
    const task = snapshot.copyTask && typeof snapshot.copyTask === 'object'
      ? snapshot.copyTask
      : {};
    const phase = normalizeTaskPhase(task.phase || snapshot.copyStatus || TaskPhase.IDLE);
    const running = phase !== TaskPhase.IDLE
      && phase !== TaskPhase.SUCCESS
      && phase !== TaskPhase.FAILED
      && phase !== TaskPhase.CANCELLED;

    if (phase === TaskPhase.SUCCESS || snapshot.copyStatus === 'success') {
      return {
        phase: TaskPhase.SUCCESS,
        text: '已复制',
        title: '最后回复已复制',
        disabled: false,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'success',
      };
    }

    if (phase === TaskPhase.FAILED || snapshot.copyStatus === 'failed') {
      return {
        phase: TaskPhase.FAILED,
        text: '复制失败',
        title: '复制最后回复失败',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (running && (phase === TaskPhase.WAITING_REPLY || snapshot.copyWaiting || snapshot.copyStatus === 'waiting')) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复后复制',
        title: '正在等待 ChatGPT 回复完成并稳定',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'waiting',
      };
    }

    if (running && (phase === TaskPhase.COPYING || snapshot.copyStatus === 'copying')) {
      return {
        phase: TaskPhase.COPYING,
        text: '复制中',
        title: '正在复制最后回复到剪贴板',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (running) {
      return {
        phase: TaskPhase.COPYING,
        text: '复制中',
        title: '正在复制最后回复到剪贴板',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '复制最后回复',
      title: '等待最后一条 assistant 回复稳定后复制到剪贴板',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getCopyHotkeyOnceButtonViewState(snapshot = {}) {
    const onceRunning = resolveSnapshotTaskActive(
      snapshot,
      'copyHotkeyOnceTask',
      'copyHotkeyOnceActive',
    );
    const continueRunning = resolveSnapshotTaskActive(
      snapshot,
      'copyHotkeyContinueTask',
      'copyHotkeyContinueActive',
    );
    const loopRunning = resolveSnapshotLoopActive(
      snapshot,
      'copyHotkeyContinueLoopTask',
      'copyHotkeyLoopActive',
    );
    const uploadVerifyRunning = resolveSnapshotLoopActive(
      snapshot,
      'copyHotkeyUploadVerifyLoopTask',
      'copyHotkeyUploadVerifyLoopActive',
    );

    if (uploadVerifyRunning) {
      return getCopyHotkeyMutualBlockView('uploadVerify');
    }

    if (loopRunning) {
      return getCopyHotkeyMutualBlockView('loop');
    }

    if (continueRunning) {
      return getCopyHotkeyMutualBlockView('continue');
    }

    if (onceRunning) {
      return {
        phase: TaskPhase.RUNNING,
        text: '处理中...',
        title: '复制+快捷键流程进行中',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.onceLabel || '复制+快捷键',
      title: snapshot.onceTitle || '复制 ChatGPT 最后一条回复，然后触发内部目标快捷键。',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getSendHotkeyButtonViewState(snapshot = {}) {
    const task = snapshot.sendHotkeyTask && typeof snapshot.sendHotkeyTask === 'object'
      ? snapshot.sendHotkeyTask
      : {};
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = rawPhase === 'sending_hotkey' ? rawPhase : normalizeTaskPhase(rawPhase);

    if (phase === 'sending_hotkey') {
      return {
        phase: 'sending_hotkey',
        text: '发送中...',
        title: '正在请求 GUI 发送目标快捷键',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.SUCCESS,
        text: '已发送',
        title: '快捷键已发送',
        disabled: false,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'success',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '发送失败',
        title: task.lastError
          ? `发送失败：${task.lastError}`
          : '发送目标快捷键失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.sendHotkeyLabel || '发送快捷键',
      title: snapshot.sendHotkeyTitle || '发送配置的快捷键',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'warning',
    };
  }

  function getCopyHotkeyContinueOnceButtonViewState(snapshot = {}) {
    const task = snapshot.copyHotkeyContinueTask && typeof snapshot.copyHotkeyContinueTask === 'object'
      ? snapshot.copyHotkeyContinueTask
      : {};
    const loopRunning = resolveSnapshotLoopActive(
      snapshot,
      'copyHotkeyContinueLoopTask',
      'copyHotkeyLoopActive',
    );
    const uploadVerifyRunning = resolveSnapshotLoopActive(
      snapshot,
      'copyHotkeyUploadVerifyLoopTask',
      'copyHotkeyUploadVerifyLoopActive',
    );
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = rawPhase === 'sending_hotkey' || rawPhase === 'sending_continue'
      ? rawPhase
      : normalizeTaskPhase(rawPhase);

    if (uploadVerifyRunning) {
      return getCopyHotkeyMutualBlockView('uploadVerify');
    }

    if (loopRunning) {
      return getCopyHotkeyMutualBlockView('loop');
    }

    if (phase === TaskPhase.CANCELLING || task.cancelRequested) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '正在取消',
        title: '正在取消复制+快捷键+继续',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (phase === TaskPhase.CANCELLED) {
      return {
        phase: TaskPhase.CANCELLED,
        text: '已取消',
        title: '任务已取消',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'cancelled',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '执行失败',
        title: task.lastError
          ? `执行失败：${task.lastError}`
          : '复制+快捷键+继续失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.SUCCESS,
        text: '已完成',
        title: '已复制、发送快捷键并发送继续指令',
        disabled: false,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'success',
      };
    }

    if (phase === TaskPhase.WAITING_REPLY) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复，点击取消',
        title: '正在等待 ChatGPT 回复完成，再次点击可取消',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'waiting',
      };
    }

    if (phase === TaskPhase.COPYING) {
      return {
        phase: TaskPhase.COPYING,
        text: '复制中...',
        title: '正在复制最后回复',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === 'sending_hotkey') {
      return {
        phase: 'sending_hotkey',
        text: '发送快捷键，点击取消',
        title: '正在发送目标快捷键，再次点击可取消',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'running',
      };
    }

    if (phase === 'sending_continue') {
      return {
        phase: 'sending_continue',
        text: '发送继续指令，点击取消',
        title: '正在发送继续指令，再次点击可取消',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'running',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.continueLabel || '复制+快捷键+继续',
      title: snapshot.continueTitle || '等待回答完成 -> 检查终止信号 -> 复制 -> 快捷键 -> 继续',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getAutoContinueButtonViewState(autoState) {
    if (!autoState || typeof autoState !== 'object') {
      return {
        phase: TaskPhase.IDLE,
        text: '自动继续',
        title: '复用自动指令队列：循环发送“继续”；再点一次停止',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'idle',
      };
    }

    const phase = String(autoState.phase || TaskPhase.IDLE).trim().toLowerCase();
    const stopRequested = !!autoState.stopRequested;
    const activePhases = new Set([
      'preparing',
      'uploading',
      'upload_attached',
      'sending',
      'sent',
      'waiting_reply',
      'reply_ready',
      'running',
    ]);
    const cancelling = !!(autoState.cancelling || (stopRequested && activePhases.has(phase)));
    const failed = phase === TaskPhase.FAILED || !!autoState.failed;

    if (cancelling) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '自动继续',
        title: '停止请求已提交，正在等待自动继续任务退出',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (failed && phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '继续失败',
        title: autoState.phaseReason
          ? `自动继续失败：${autoState.phaseReason}`
          : '自动继续失败，可再次点击重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (phase === 'waiting_reply' || autoState.waitingReply) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复，点击停止',
        title: '正在等待 ChatGPT 回复完成，再次点击停止自动继续',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'waiting',
      };
    }

    if (activePhases.has(phase) || autoState.running) {
      return {
        phase: TaskPhase.RUNNING,
        text: '停止继续',
        title: '自动继续正在运行，点击后停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'danger',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '自动继续',
      title: '复用自动指令队列：循环发送“继续”；再点一次停止',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getAutoContinueUntilDoneButtonViewState(autoState) {
    const shared = getAutoContinueButtonViewState(autoState);
    const autoQueueSharedHint = '（与「自动继续」共用 AutoQueue 运行态）';
    const running = shared.phase !== TaskPhase.IDLE
      && shared.phase !== TaskPhase.SUCCESS
      && shared.phase !== TaskPhase.FAILED
      && shared.phase !== TaskPhase.CANCELLED;

    if (running) {
      return {
        ...shared,
        text: shared.action === 'stop' ? '停止智能继续' : shared.text,
        title: shared.title
          ? `${shared.title}${autoQueueSharedHint}`
          : `当前自动继续任务正在运行${autoQueueSharedHint}`,
        buttonPhase: shared.buttonPhase === 'idle' ? 'danger' : shared.buttonPhase,
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: '自动继续直到完成',
      title: '循环发送强约束继续指令；只有检测到严格完成信号才停止',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getActionPhaseFromSnapshot(action, snapshot = {}) {
    const normalized = String(action || '').trim();

    if (normalized === 'send-message') {
      const send = snapshot.sendTask && typeof snapshot.sendTask === 'object'
        ? snapshot.sendTask
        : {};
      return normalizeTaskPhase(send.phase);
    }

    if (normalized === 'send-hotkey') {
      const task = snapshot.sendHotkeyTask && typeof snapshot.sendHotkeyTask === 'object'
        ? snapshot.sendHotkeyTask
        : {};
      return String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    }

    if (normalized === 'copy-only' || normalized === 'copy-last-reply') {
      const copy = snapshot.copyTask && typeof snapshot.copyTask === 'object'
        ? snapshot.copyTask
        : {};
      return normalizeTaskPhase(copy.phase || snapshot.copyStatus);
    }

    if (normalized === 'copy-and-continue' || normalized === 'copy-continue') {
      const task = snapshot.copyContinueTask && typeof snapshot.copyContinueTask === 'object'
        ? snapshot.copyContinueTask
        : {};
      const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
      return rawPhase === 'sending_continue'
        ? rawPhase
        : normalizeTaskPhase(rawPhase);
    }

    if (normalized === 'copy-hotkey-once' || normalized === 'copy-and-hotkey') {
      const task = snapshot.copyHotkeyOnceTask && typeof snapshot.copyHotkeyOnceTask === 'object'
        ? snapshot.copyHotkeyOnceTask
        : {};
      if (resolveSnapshotTaskActive(snapshot, 'copyHotkeyOnceTask', 'copyHotkeyOnceActive')) {
        return String(task.phase || TaskPhase.RUNNING).trim().toLowerCase();
      }
      return String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    }

    if (normalized === 'copy-hotkey-continue') {
      const task = snapshot.copyHotkeyContinueTask && typeof snapshot.copyHotkeyContinueTask === 'object'
        ? snapshot.copyHotkeyContinueTask
        : {};
      const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
      return rawPhase === 'sending_hotkey' || rawPhase === 'sending_continue'
        ? rawPhase
        : normalizeTaskPhase(rawPhase);
    }

    return TaskPhase.IDLE;
  }

  function getPageReplyStatus(snapshot = {}) {
    if (snapshot.waitingReply) {
      return 'waiting_reply';
    }
    if (snapshot.messageSending) {
      return 'sending';
    }
    if (snapshot.assistantBusy) {
      return 'answering';
    }
    return 'idle';
  }

  function computeUploadActionDisabled(action, snapshot = {}) {
    const normalized = String(action || '').trim();
    const sendPhase = getActionPhaseFromSnapshot('send-message', snapshot);
    const sendHotkeyPhase = getActionPhaseFromSnapshot('send-hotkey', snapshot);
    const copyPhase = getActionPhaseFromSnapshot('copy-only', snapshot);
    const copyHotkeyPhase = getActionPhaseFromSnapshot('copy-hotkey-continue', snapshot);
    const waitContinuePhase = getActionPhaseFromSnapshot('copy-and-continue', snapshot);

    let disabled = false;
    let reason = 'ok';

    if (normalized === 'send-message') {
      disabled = sendPhase === TaskPhase.SENDING;
      reason = disabled ? `send-message-${sendPhase}` : 'ok';
    } else if (normalized === 'send-hotkey') {
      disabled = sendHotkeyPhase === 'sending_hotkey';
      reason = disabled ? `send-hotkey-${sendHotkeyPhase}` : 'ok';
    } else if (normalized === 'copy-only' || normalized === 'copy-last-reply') {
      disabled = copyPhase === TaskPhase.COPYING;
      reason = disabled ? `copy-last-reply-${copyPhase}` : 'ok';
    } else if (normalized === 'copy-hotkey-continue') {
      disabled = copyHotkeyPhase === TaskPhase.COPYING;
      reason = disabled ? `copy-hotkey-continue-${copyHotkeyPhase}` : 'ok';
    } else if (normalized === 'copy-and-continue' || normalized === 'copy-continue') {
      if (
        waitContinuePhase === TaskPhase.COPYING
        || waitContinuePhase === 'sending_continue'
        || waitContinuePhase === TaskPhase.CANCELLING
      ) {
        disabled = true;
        reason = `wait-reply-continue-self-${waitContinuePhase}`;
      } else {
        disabled = false;
        reason = 'ok';
      }
    }

    return {
      disabled,
      reason,
      sendPhase,
      sendHotkeyPhase,
      copyPhase,
      copyHotkeyPhase,
      waitContinuePhase,
      pageReplyStatus: getPageReplyStatus(snapshot),
    };
  }

  function logButtonDisabledDecide(action, decide = {}, extra = {}) {
    const normalized = String(action || '-').trim() || '-';
    const payload = {
      action: normalized,
      disabled: decide.disabled ? 1 : 0,
      reason: decide.reason || '-',
      sendPhase: decide.sendPhase || '-',
      sendHotkeyPhase: decide.sendHotkeyPhase || '-',
      copyPhase: decide.copyPhase || '-',
      copyHotkeyPhase: decide.copyHotkeyPhase || '-',
      waitContinuePhase: decide.waitContinuePhase || '-',
      pageReplyStatus: decide.pageReplyStatus || '-',
      viewDisabled: extra.viewDisabled != null ? (extra.viewDisabled ? 1 : 0) : '-',
    };
    const line = `[BUTTON_DISABLED][DECIDE] action=${payload.action} disabled=${payload.disabled}`
      + ` reason=${payload.reason} sendPhase=${payload.sendPhase} sendHotkeyPhase=${payload.sendHotkeyPhase}`
      + ` copyPhase=${payload.copyPhase} copyHotkeyPhase=${payload.copyHotkeyPhase}`
      + ` waitContinuePhase=${payload.waitContinuePhase} pageReplyStatus=${payload.pageReplyStatus}`
      + ` viewDisabled=${payload.viewDisabled}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function getCopyContinueButtonViewState(snapshot = {}) {
    const task = snapshot.copyContinueTask && typeof snapshot.copyContinueTask === 'object'
      ? snapshot.copyContinueTask
      : {};
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const phase = rawPhase === 'sending_continue'
      ? rawPhase
      : normalizeTaskPhase(rawPhase);
    const assistantBusy = !!snapshot.assistantBusy;

    if (phase === TaskPhase.CANCELLING || task.cancelRequested || task.stopRequested) {
      return {
        phase: TaskPhase.CANCELLING,
        text: '复制并继续',
        title: '停止请求已提交，正在等待复制并继续任务退出',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '复制失败',
        title: '复制并继续失败，可再次点击重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.SUCCESS,
        text: '已完成',
        title: '已复制最后回复并发送继续',
        disabled: false,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'success',
      };
    }

    if (phase === TaskPhase.WAITING_REPLY) {
      return {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复，点击取消',
        title: '正在等待 ChatGPT 回复完成，再次点击可取消',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'waiting',
      };
    }

    if (phase === TaskPhase.COPYING) {
      return {
        phase: TaskPhase.COPYING,
        text: '复制中...',
        title: '正在复制最后回复',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === 'sending_continue') {
      return {
        phase: 'sending_continue',
        text: '发送继续...',
        title: '正在发送“继续”指令',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === TaskPhase.RUNNING) {
      return {
        phase: TaskPhase.RUNNING,
        text: '继续中，点击取消',
        title: '复制并继续任务进行中，再次点击可取消',
        disabled: false,
        allowCancel: true,
        action: 'cancel',
        buttonPhase: 'running',
      };
    }

    if (assistantBusy) {
      const busyView = {
        phase: TaskPhase.WAITING_REPLY,
        text: '等待回复后继续',
        title: '助手正在回复，点击后等待回复完成再复制并继续',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'waiting',
      };
      const busyLine = `[COPY_CONTINUE_BUTTON][ASSISTANT_BUSY_CLICKABLE] assistantBusy=${assistantBusy ? 1 : 0}`
        + ` disabled=${busyView.disabled ? 1 : 0}`
        + ` action=${busyView.action}`
        + ` buttonPhase=${busyView.buttonPhase}`;
      console.log(busyLine);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(busyLine);
      }
      return busyView;
    }

    return {
      phase: TaskPhase.IDLE,
      text: '复制并继续',
      title: '先复制最后回复，再发送“继续”',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getHomeButtonViewState(snapshot = {}) {
    const task = snapshot.homeTask && typeof snapshot.homeTask === 'object'
      ? snapshot.homeTask
      : {};
    const phase = normalizeTaskPhase(task.phase);

    if (phase === TaskPhase.RUNNING) {
      return {
        phase: TaskPhase.RUNNING,
        text: '跳转中',
        title: '正在跳转到 ChatGPT 首页',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'running',
      };
    }

    if (phase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.SUCCESS,
        text: '已跳转',
        title: '已跳转到新聊天',
        disabled: false,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'success',
      };
    }

    if (phase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '跳转失败',
        title: task.lastError
          ? `跳转失败：${task.lastError}`
          : '跳转失败，可重试',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.homeLabel || '回到首页',
      title: snapshot.homeTitle || '点击左侧新聊天',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function getCopyHotkeyLoopButtonViewState(snapshot = {}) {
    const task = snapshot.copyHotkeyContinueLoopTask && typeof snapshot.copyHotkeyContinueLoopTask === 'object'
      ? snapshot.copyHotkeyContinueLoopTask
      : {};
    const rawPhase = String(task.phase || TaskPhase.IDLE).trim().toLowerCase();
    const loopActive = rawPhase !== TaskPhase.IDLE
      && rawPhase !== 'stopped'
      && rawPhase !== TaskPhase.SUCCESS
      && rawPhase !== TaskPhase.FAILED
      && rawPhase !== TaskPhase.CANCELLED;

    if (rawPhase === 'stopping') {
      return {
        phase: 'stopping',
        text: '停止中',
        title: '停止请求已提交，正在等待连续复制任务退出',
        disabled: true,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'cancelled',
      };
    }

    if (rawPhase === 'stopped' || rawPhase === TaskPhase.CANCELLED) {
      return {
        phase: TaskPhase.CANCELLED,
        text: '已停止',
        title: '连续复制已停止',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'cancelled',
      };
    }

    if (rawPhase === TaskPhase.FAILED) {
      return {
        phase: TaskPhase.FAILED,
        text: '循环失败',
        title: task.lastError ? `循环失败：${task.lastError}` : '连续复制失败',
        disabled: false,
        allowCancel: false,
        action: 'start',
        buttonPhase: 'failed',
      };
    }

    if (rawPhase === TaskPhase.SUCCESS) {
      return {
        phase: TaskPhase.SUCCESS,
        text: '已完成',
        title: '连续复制流程已完成',
        disabled: false,
        allowCancel: false,
        action: 'none',
        buttonPhase: 'success',
      };
    }

    if (loopActive || CANCELLABLE_TASK_PHASES.has(rawPhase) || rawPhase === 'waiting_next_reply' || rawPhase === 'auto_uploading' || rawPhase === 'home_navigation') {
      const phaseLabels = {
        waiting_reply: '等待回复，点击停止',
        copying: '复制中，点击停止',
        sending_hotkey: '发送快捷键，点击停止',
        sending_continue: '发送继续，点击停止',
        waiting_next_reply: '等待下一轮，点击停止',
        auto_uploading: '自动上传中，点击停止',
        home_navigation: '跳转首页中，点击停止',
        running: '停止连续',
      };
      const text = phaseLabels[rawPhase] || '停止连续';
      return {
        phase: TaskPhase.RUNNING,
        text,
        title: '连续复制+快捷键+继续运行中，再次点击停止',
        disabled: false,
        allowCancel: true,
        action: 'stop',
        buttonPhase: 'danger',
      };
    }

    return {
      phase: TaskPhase.IDLE,
      text: snapshot.loopLabel || '连续复制+快捷键+继续',
      title: snapshot.loopTitle || '循环：等待回答 -> 复制 -> 快捷键 -> 继续',
      disabled: false,
      allowCancel: false,
      action: 'start',
      buttonPhase: 'idle',
    };
  }

  function mapViewStateToToolboxOptions(view = {}, reason = '') {
    const buttonPhase = String(view.buttonPhase || 'idle');
    const base = {
      text: view.text || '',
      title: view.title || '',
      disabled: !!view.disabled,
      allowCancel: !!view.allowCancel,
      reason,
      ariaBusy: CANCELLABLE_TASK_PHASES.has(view.phase),
    };

    if (buttonPhase === 'waiting') {
      return { ...base, phase: ButtonState.Phase.WAITING };
    }
    if (buttonPhase === 'running' || buttonPhase === 'sending') {
      if (view.disabled && !view.allowCancel) {
        return { ...base, phase: ButtonState.Phase.RUNNING, allowCancel: false, disabled: true };
      }
      if (view.allowCancel) {
        return { ...base, phase: ButtonState.Phase.RUNNING };
      }
      return { ...base, phase: ButtonState.Phase.RUNNING, allowCancel: false };
    }
    if (buttonPhase === 'success') {
      return { ...base, phase: ButtonState.Phase.SUCCESS };
    }
    if (buttonPhase === 'failed') {
      return { ...base, phase: ButtonState.Phase.FAILED };
    }
    if (buttonPhase === 'cancelled') {
      return { ...base, phase: ButtonState.Phase.CANCELLED };
    }
    if (buttonPhase === 'danger') {
      return { ...base, phase: ButtonState.Phase.DANGER };
    }
    if (buttonPhase === 'warning') {
      return { ...base, phase: ButtonState.Phase.WARNING || ButtonState.Phase.IDLE };
    }
    if (buttonPhase === 'disabled') {
      return { ...base, phase: ButtonState.Phase.DISABLED };
    }

    return {
      ...base,
      phase: ButtonState.Phase.IDLE,
      disabled: !!view.disabled,
    };
  }

  function captureButtonRenderSnapshot(button) {
    if (!button) {
      return { phase: '-', text: '-' };
    }
    return {
      phase: String(button.dataset.cgptButtonPhase || button.dataset.cgptTaskPhase || '-').trim() || '-',
      text: String(button.textContent || '').trim() || '-',
    };
  }

  function logButtonRenderChange(button, before, reason, buttonName = '') {
    if (!button) {
      return;
    }
    const after = captureButtonRenderSnapshot(button);
    const name = String(buttonName || button.dataset.action || button.id || '-').trim() || '-';
    if (before.phase === after.phase && before.text === after.text) {
      return;
    }
    const line = `[BUTTON_RENDER][CHANGE] button=${name} oldPhase=${before.phase} newPhase=${after.phase}`
      + ` oldText=${before.text} newText=${after.text} reason=${reason || '-'}`;
    console.log(line);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    }
  }

  function applyUploadButtonViewState(button, view, reason = '', applyOptions = {}) {
    if (!button || !view || typeof ButtonState === 'undefined') {
      return false;
    }

    const beforeRender = captureButtonRenderSnapshot(button);
    const snapshot = applyOptions.snapshot && typeof applyOptions.snapshot === 'object'
      ? applyOptions.snapshot
      : {};
    const action = String(button.dataset.action || button.id || '').trim();
    let resolvedView = view;

    if (action) {
      const decide = computeUploadActionDisabled(action, snapshot);
      const viewDisabled = !!view.disabled;

      if (action === 'copy-and-continue' || action === 'copy-continue') {
        if (decide.disabled !== viewDisabled) {
          resolvedView = {
            ...view,
            disabled: decide.disabled,
            buttonPhase: decide.disabled
              ? (view.buttonPhase === 'waiting' ? view.buttonPhase : 'running')
              : (view.buttonPhase === 'disabled' ? 'idle' : view.buttonPhase),
          };
        }
      }

      if (
        action === 'copy-and-continue'
        || action === 'copy-continue'
        || decide.disabled
      ) {
        logButtonDisabledDecide(action, decide, { viewDisabled: !!resolvedView.disabled });
      }
    }

    const options = mapViewStateToToolboxOptions(resolvedView, reason);
    button.dataset.cgptTaskPhase = resolvedView.phase || TaskPhase.IDLE;
    button.dataset.cgptButtonAction = resolvedView.action || '';

    const changed = ButtonState.setToolboxButtonState(button, options);
    if (typeof ButtonState.assertCancellableButtonConsistency === 'function') {
      ButtonState.assertCancellableButtonConsistency(button, resolvedView, reason);
    }
    logButtonRenderChange(
      button,
      beforeRender,
      reason,
      applyOptions.buttonName || action,
    );
    return changed;
  }

  const UploadButtonVm = Object.freeze({
    TaskPhase,
    CANCELLABLE_TASK_PHASES,
    createRunId,
    normalizeTaskPhase,
    getUploadButtonViewState,
    getCopyLastReplyButtonViewState,
    getCopyHotkeyOnceButtonViewState,
    getSendHotkeyButtonViewState,
    getCopyHotkeyContinueOnceButtonViewState,
    getCopyHotkeyLoopButtonViewState,
    getAutoContinueButtonViewState,
    getAutoContinueUntilDoneButtonViewState,
    getHomeButtonViewState,
    getCopyContinueButtonViewState,
    getActionPhaseFromSnapshot,
    computeUploadActionDisabled,
    logButtonDisabledDecide,
    mapViewStateToToolboxOptions,
    applyUploadButtonViewState,
  });
