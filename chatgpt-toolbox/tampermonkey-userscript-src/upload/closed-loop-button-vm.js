  /********************************************************************
   * ClosedLoopButtonVm：闭环按钮 owner / 文案 / view state
   ********************************************************************/

  const ClosedLoopButtonVm = (() => {
    const CL_PHASE = Object.freeze({
      IDLE: 'idle',
      RUNNING: 'running',
    });

    const CLOSED_LOOP_BUTTON_ACTIONS = new Set([
      'closed-loop-with-hotkey',
      'closed-loop-with-hotkey-upload-every-round',
      'closed-loop-without-hotkey',
    ]);

    const CLOSED_LOOP_BUTTON_IDS = new Set([
      'cgpt-closed-loop-upload-every5-hotkey-btn',
      'cgpt-closed-loop-upload-every-round-hotkey-btn',
      'cgpt-closed-loop-upload-every5-btn',
    ]);

    const CLOSED_LOOP_BUTTON_GROUP = 'closed-loop';

    function withClosedLoopStyleFields(view = {}) {
      return {
        ...view,
        buttonGroup: CLOSED_LOOP_BUTTON_GROUP,
        forceClosedLoopStyle: true,
      };
    }

    function getToolboxRunningOwnerFromRuntime(runtimeState = {}) {
      if (runtimeState.runningOwner && typeof runtimeState.runningOwner === 'object') {
        return runtimeState.runningOwner;
      }
      if (typeof window !== 'undefined' && window.__cgptToolboxRunningOwner) {
        return window.__cgptToolboxRunningOwner;
      }
      return null;
    }

    function getClosedLoopOwnerFromSnapshot(snapshot = {}) {
      const direct = String(
        snapshot.closedLoopOwner
        || snapshot.closedLoopContinueOwner
        || snapshot.owner
        || snapshot.taskOwner
        || '',
      ).trim();
      if (direct) {
        return direct;
      }
      const runningOwner = getToolboxRunningOwnerFromRuntime(snapshot);
      if (runningOwner && runningOwner.action) {
        return String(runningOwner.action).trim();
      }
      if (!snapshot.closedLoopContinueRunning) {
        return '';
      }
      const mode = String(snapshot.closedLoopContinueMode || snapshot.closedLoopMode || '').trim();
      if (mode === 'without_hotkey') {
        return 'closed-loop-without-hotkey';
      }
      if (mode === 'with_hotkey_every_round') {
        return 'closed-loop-with-hotkey-upload-every-round';
      }
      if (mode === 'with_hotkey') {
        return 'closed-loop-with-hotkey';
      }
      return '';
    }

    function getClosedLoopOwnerActionFromSnapshot(snapshot = {}) {
      return getClosedLoopOwnerFromSnapshot(snapshot);
    }

    function resolveClosedLoopOwnerAction(snapshot = {}) {
      return getClosedLoopOwnerActionFromSnapshot(snapshot);
    }

    function resolveActionForClosedLoopMode(mode) {
      const modeText = String(mode || 'with_hotkey').trim();
      if (modeText === 'without_hotkey') {
        return 'closed-loop-without-hotkey';
      }
      if (modeText === 'with_hotkey_every_round') {
        return 'closed-loop-with-hotkey-upload-every-round';
      }
      return 'closed-loop-with-hotkey';
    }

    function isClosedLoopStopLikeText(text) {
      const normalized = String(text || '').trim();
      return normalized.includes('停止闭环继续') || normalized.includes('正在停止闭环');
    }

    function isClosedLoopLikeText(text) {
      const t = String(text || '').trim();
      return t.includes('闭环')
        || t.includes('停止闭环继续')
        || t.includes('停止环继续')
        || t.startsWith('环-')
        || t.includes('快捷键模式+每')
        || t.includes('仅对话+每');
    }

    function isClosedLoopButtonAction(action) {
      return CLOSED_LOOP_BUTTON_ACTIONS.has(String(action || '').trim());
    }

    function isClosedLoopButtonElement(button) {
      if (!button) {
        return false;
      }
      const id = String(button.id || '').trim();
      const action = String(
        button.dataset?.action
        || button.dataset?.cgptButtonAction
        || button.dataset?.cgptRuntimeAction
        || '',
      ).trim();
      return CLOSED_LOOP_BUTTON_IDS.has(id) || CLOSED_LOOP_BUTTON_ACTIONS.has(action);
    }

    function isClosedLoopModeButton(buttonOrAction) {
      if (!buttonOrAction) {
        return false;
      }
      if (typeof buttonOrAction === 'string') {
        return isClosedLoopButtonAction(buttonOrAction);
      }
      return isClosedLoopButtonElement(buttonOrAction);
    }

    function getClosedLoopIdleTextByAction(action, snapshot = {}) {
      void snapshot;
      const normalized = String(action || '').trim();
      if (normalized === 'closed-loop-with-hotkey-upload-every-round') {
        return '闭环-快捷键模式+每一轮上传';
      }
      if (normalized === 'closed-loop-with-hotkey') {
        return '闭环-快捷键模式+每5轮上传';
      }
      if (normalized === 'closed-loop-without-hotkey') {
        return '闭环-仅对话+每5轮上传';
      }
      return '闭环';
    }

    function isCurrentClosedLoopOwnerButton(action, button, snapshot = {}) {
      const normalizedAction = String(action || '').trim();
      const owner = getClosedLoopOwnerFromSnapshot(snapshot);
      if (!owner) {
        return false;
      }
      if (!isClosedLoopButtonAction(normalizedAction) && !isClosedLoopButtonElement(button)) {
        return false;
      }
      if (normalizedAction) {
        return normalizedAction === owner;
      }
      if (button && button.id) {
        const id = String(button.id || '').trim();
        if (owner === 'closed-loop-with-hotkey-upload-every-round') {
          return id === 'cgpt-closed-loop-upload-every-round-hotkey-btn';
        }
        if (owner === 'closed-loop-without-hotkey') {
          return id === 'cgpt-closed-loop-upload-every5-btn';
        }
        if (owner === 'closed-loop-with-hotkey') {
          return id === 'cgpt-closed-loop-upload-every5-hotkey-btn';
        }
      }
      return false;
    }

    function isClosedLoopOwnerAction(action, snapshot = {}) {
      return isCurrentClosedLoopOwnerButton(action, null, snapshot);
    }

    function formatClosedLoopRunningButtonWaitSuffix(snapshot = {}) {
      const waitVisual = snapshot.closedLoopWaitVisual || {};
      const closedLoopRunning = snapshot.closedLoopContinueRunning === true || waitVisual.running === true;
      if (!closedLoopRunning) {
        return '';
      }

      const waitKind = String(waitVisual.waitKind || 'idle');
      const phase = String(waitVisual.phase || snapshot.closedLoopPhase || 'idle');

      if (phase === 'post_reply_delay' || waitKind === 'next-step') {
        const ms = Math.max(
          0,
          Number(waitVisual.postReplyDelayRemainingMs || waitVisual.nextStepRemainingMs || 0),
        );
        const sec = Math.max(0, Math.ceil(ms / 1000));
        return `（等待 ${sec}s）`;
      }

      if (phase === 'waiting_reply' || waitKind === 'reply') {
        const ms = Math.max(0, Number(waitVisual.replyWaitElapsedMs || 0));
        const sec = Math.floor(ms / 1000);
        return `（回复中 ${sec}s）`;
      }

      if (phase === 'reply_done_stable') {
        return '（确认完成）';
      }

      if (phase === 'sending') {
        return '（发送中）';
      }

      if (waitVisual.runningButtonText) {
        const custom = String(waitVisual.runningButtonText || '').trim();
        const base = '停止闭环继续';
        if (custom.startsWith(base) && custom.length > base.length) {
          return custom.slice(base.length);
        }
      }

      return '';
    }

    function resolveClosedLoopStopButtonText(snapshot = {}, stopping = false) {
      if (stopping) {
        return '正在停止闭环继续';
      }
      return `停止闭环继续${formatClosedLoopRunningButtonWaitSuffix(snapshot)}`;
    }

    function getClosedLoopContinueButtonViewState(snapshot = {}, mode = 'with_hotkey') {
      const running = snapshot.closedLoopContinueRunning === true;
      const stopping = snapshot.closedLoopContinueStopping === true;
      const modeText = String(mode || 'with_hotkey').trim();
      const actionByMode = {
        with_hotkey: 'closed-loop-with-hotkey',
        with_hotkey_every_round: 'closed-loop-with-hotkey-upload-every-round',
        without_hotkey: 'closed-loop-without-hotkey',
      };
      const currentAction = actionByMode[modeText] || 'closed-loop-with-hotkey';
      const owner = getClosedLoopOwnerFromSnapshot(snapshot);
      const isOwner = running && owner === currentAction;
      const idleText = getClosedLoopIdleTextByAction(currentAction, snapshot);
      const buttonName = currentAction;

      if (running && isOwner) {
        const loopTask = snapshot.copyHotkeyUploadVerifyLoopTask && typeof snapshot.copyHotkeyUploadVerifyLoopTask === 'object'
          ? snapshot.copyHotkeyUploadVerifyLoopTask
          : {};
        const loopPhase = String(loopTask.phase || '').trim().toLowerCase();
        const loopRound = Math.max(
          0,
          Number(loopTask.cycleIndex != null ? loopTask.cycleIndex : 0)
            || Number(snapshot.closedLoopContinueRound || 0)
            || 0,
        );
        const retryingCurrentRound = snapshot.closedLoopRetryingCurrentRound === true;
        if (!stopping && loopPhase === 'paused') {
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(
              `[BUTTON_STATE][PAUSED] button=${buttonName} mode=${modeText} round=${loopTask.round != null ? loopTask.round : '-'}`,
            );
          }
          return withClosedLoopStyleFields({
            phase: 'paused',
            text: '已暂停',
            title: loopTask.lastError
              ? `闭环已暂停：${String(loopTask.lastError)}。点击停止当前闭环任务`
              : '闭环已暂停，点击停止当前闭环任务',
            disabled: false,
            allowCancel: true,
            action: currentAction,
            runtimeAction: 'stop-closed-loop',
            buttonPhase: 'danger',
            forceDanger: true,
          });
        }
        const stopButtonText = resolveClosedLoopStopButtonText(snapshot, stopping);
        if (!stopping && loopPhase === 'waiting_next_reply') {
          return withClosedLoopStyleFields({
            phase: CL_PHASE.RUNNING,
            text: stopButtonText,
            title: '点击停止当前闭环任务',
            disabled: false,
            allowCancel: true,
            action: currentAction,
            runtimeAction: 'stop-closed-loop',
            buttonPhase: 'danger',
            forceDanger: true,
          });
        }
        if (!stopping && retryingCurrentRound) {
          return withClosedLoopStyleFields({
            phase: CL_PHASE.RUNNING,
            text: stopButtonText,
            title: '点击停止当前闭环任务',
            disabled: false,
            allowCancel: true,
            action: currentAction,
            runtimeAction: 'stop-closed-loop',
            buttonPhase: 'danger',
            forceDanger: true,
          });
        }
        return withClosedLoopStyleFields({
          phase: stopping ? 'stopping' : CL_PHASE.RUNNING,
          text: stopButtonText,
          title: stopping ? '正在停止闭环继续任务' : '点击停止当前闭环任务',
          disabled: false,
          allowCancel: true,
          action: currentAction,
          runtimeAction: 'stop-closed-loop',
          buttonPhase: 'danger',
          forceDanger: true,
        });
      }

      if (running && !isOwner) {
        return withClosedLoopStyleFields({
          phase: CL_PHASE.IDLE,
          text: idleText,
          title: '当前已有闭环任务运行中，请先停止当前闭环任务',
          disabled: true,
          allowCancel: false,
          action: currentAction,
          buttonPhase: 'closed-loop-idle',
          preserveBaseColorWhenDisabled: true,
          lockedByClosedLoop: true,
        });
      }

      return withClosedLoopStyleFields({
        phase: CL_PHASE.IDLE,
        text: idleText,
        title: snapshot.closedLoopTitle || '点击启动该闭环模式',
        disabled: false,
        allowCancel: false,
        action: currentAction,
        buttonPhase: 'closed-loop-idle',
      });
    }

    return Object.freeze({
      getClosedLoopOwnerFromSnapshot,
      getClosedLoopOwnerActionFromSnapshot,
      resolveClosedLoopOwnerAction,
      isClosedLoopOwnerAction,
      resolveActionForClosedLoopMode,
      isClosedLoopStopLikeText,
      isClosedLoopLikeText,
      isClosedLoopButtonAction,
      isClosedLoopButtonElement,
      isClosedLoopModeButton,
      getClosedLoopIdleTextByAction,
      isCurrentClosedLoopOwnerButton,
      formatClosedLoopRunningButtonWaitSuffix,
      resolveClosedLoopStopButtonText,
      getClosedLoopContinueButtonViewState,
      CLOSED_LOOP_BUTTON_ACTIONS,
      CLOSED_LOOP_BUTTON_IDS,
      CLOSED_LOOP_BUTTON_GROUP,
    });
  })();
