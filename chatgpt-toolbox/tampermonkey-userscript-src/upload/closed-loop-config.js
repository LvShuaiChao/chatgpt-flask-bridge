  /********************************************************************
   * ClosedLoopConfig：闭环模式常量与纯函数配置
   ********************************************************************/

  const ClosedLoopConfig = (() => {
    const CLOSED_LOOP_CONTINUE_MODES = {
      WITH_HOTKEY: 'with_hotkey',
      WITH_HOTKEY_EVERY_ROUND: 'with_hotkey_every_round',
      WITHOUT_HOTKEY: 'without_hotkey',
    };

    const CLOSED_LOOP_ACTIONS = Object.freeze({
      WITH_HOTKEY: Object.freeze({
        mode: CLOSED_LOOP_CONTINUE_MODES.WITH_HOTKEY,
        action: 'closed-loop-with-hotkey',
        buttonId: 'cgpt-closed-loop-upload-every5-hotkey-btn',
        selector: '#cgpt-closed-loop-upload-every5-hotkey-btn',
        toolbarKey: 'closed-loop-with-hotkey',
        label: '',
        title: '快捷键模式：等待回复完成 -> 复制最后回复 -> 判断终止信号 -> 触发配置快捷键 -> 使用稳定直接发送链路发送继续指令；按配置间隔自动上传代码',
      }),
      WITH_HOTKEY_EVERY_ROUND: Object.freeze({
        mode: CLOSED_LOOP_CONTINUE_MODES.WITH_HOTKEY_EVERY_ROUND,
        action: 'closed-loop-with-hotkey-upload-every-round',
        buttonId: 'cgpt-closed-loop-upload-every-round-hotkey-btn',
        selector: '#cgpt-closed-loop-upload-every-round-hotkey-btn',
        toolbarKey: 'closed-loop-with-hotkey-upload-every-round',
        label: '',
        title: '快捷键模式：等待回复完成 -> 复制最后回复 -> 判断终止信号 -> 触发配置快捷键 -> 使用稳定直接发送链路发送继续指令；每一轮都自动重新上传代码',
        datasetClosedLoopMode: 'with_hotkey_every_round',
      }),
      WITHOUT_HOTKEY: Object.freeze({
        mode: CLOSED_LOOP_CONTINUE_MODES.WITHOUT_HOTKEY,
        action: 'closed-loop-without-hotkey',
        buttonId: 'cgpt-closed-loop-upload-every5-btn',
        selector: '#cgpt-closed-loop-upload-every5-btn',
        toolbarKey: 'closed-loop-without-hotkey',
        label: '',
        title: '直接发送模式：等待回复完成 -> 判断终止信号 -> 直接发送继续指令；按配置间隔自动上传代码，不触发快捷键',
        datasetClosedLoopMode: 'without_hotkey',
      }),
    });

    const CLOSED_LOOP_CONTINUE_ACTIONS = Object.freeze({
      WITH_HOTKEY: Object.freeze(Object.assign({}, CLOSED_LOOP_ACTIONS.WITH_HOTKEY, {
        id: CLOSED_LOOP_ACTIONS.WITH_HOTKEY.buttonId,
      })),
      WITH_HOTKEY_EVERY_ROUND: Object.freeze(Object.assign({}, CLOSED_LOOP_ACTIONS.WITH_HOTKEY_EVERY_ROUND, {
        id: CLOSED_LOOP_ACTIONS.WITH_HOTKEY_EVERY_ROUND.buttonId,
      })),
      WITHOUT_HOTKEY: Object.freeze(Object.assign({}, CLOSED_LOOP_ACTIONS.WITHOUT_HOTKEY, {
        id: CLOSED_LOOP_ACTIONS.WITHOUT_HOTKEY.buttonId,
      })),
    });

    function normalizeClosedLoopAction(action) {
      const key = String(action || '').trim();
      return key;
    }

    function getClosedLoopModeFromAction(action) {
      const normalized = normalizeClosedLoopAction(action);
      if (normalized === CLOSED_LOOP_ACTIONS.WITHOUT_HOTKEY.action) {
        return CLOSED_LOOP_CONTINUE_MODES.WITHOUT_HOTKEY;
      }
      if (normalized === CLOSED_LOOP_ACTIONS.WITH_HOTKEY_EVERY_ROUND.action) {
        return CLOSED_LOOP_CONTINUE_MODES.WITH_HOTKEY_EVERY_ROUND;
      }
      if (normalized === CLOSED_LOOP_ACTIONS.WITH_HOTKEY.action) {
        return CLOSED_LOOP_CONTINUE_MODES.WITH_HOTKEY;
      }
      return null;
    }

    function isClosedLoopCanonicalAction(action) {
      const normalized = normalizeClosedLoopAction(action);
      return (
        normalized === CLOSED_LOOP_ACTIONS.WITH_HOTKEY.action
        || normalized === CLOSED_LOOP_ACTIONS.WITH_HOTKEY_EVERY_ROUND.action
        || normalized === CLOSED_LOOP_ACTIONS.WITHOUT_HOTKEY.action
      );
    }

    function isClosedLoopEveryRoundUploadMode(mode) {
      return String(mode || '').trim() === CLOSED_LOOP_CONTINUE_MODES.WITH_HOTKEY_EVERY_ROUND;
    }

    function getClosedLoopEffectiveUploadInterval(mode, cfg = null) {
      if (isClosedLoopEveryRoundUploadMode(mode)) {
        return 1;
      }
      const interval = cfg && typeof cfg === 'object'
        ? Number(cfg.autoUploadInterval || 5)
        : 5;
      return Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 5;
    }

    function getClosedLoopUploadPolicyText(mode, cfg = null) {
      const interval = getClosedLoopEffectiveUploadInterval(mode, cfg);
      return interval <= 1 ? '每一轮上传' : `每${interval}轮上传`;
    }

    function getClosedLoopStepSourcePolicyTag(mode) {
      return isClosedLoopEveryRoundUploadMode(mode) ? 'every-round' : 'every-n';
    }

    function getClosedLoopStepSourceTag(mode, round) {
      const n = Math.max(0, Number(round) || 0);
      return `closed-loop-${getClosedLoopStepSourcePolicyTag(mode)}-${n}`;
    }

    function isClosedLoopStepSource(sourceText) {
      return /^closed-loop-every(?:5|n|round)-\d+$/.test(String(sourceText || ''));
    }

    function parseClosedLoopStepRound(sourceText) {
      const match = String(sourceText || '').match(/closed-loop-every(?:5|n|round)-(\d+)/);
      return match ? Number(match[1]) || 0 : 0;
    }

    function getClosedLoopUploadFailedSource(useHotkey, round, mode) {
      const uploadEveryRound = isClosedLoopEveryRoundUploadMode(mode);
      if (useHotkey) {
        return round === 1
          ? 'closed-loop-hotkey-initial-upload'
          : (uploadEveryRound ? 'closed-loop-hotkey-every-round-upload' : 'closed-loop-hotkey-every-n-upload');
      }
      return round === 1
        ? 'closed-loop-initial-upload'
        : (uploadEveryRound ? 'closed-loop-every-round-upload' : 'closed-loop-every-n-upload');
    }

    function getClosedLoopButtonLabel(mode, cfg = null) {
      const intervalText = getClosedLoopUploadPolicyText(mode, cfg);
      if (mode === CLOSED_LOOP_CONTINUE_MODES.WITHOUT_HOTKEY) {
        return `闭环-仅对话+${intervalText}`;
      }
      return `闭环-快捷键模式+${intervalText}`;
    }

    function getClosedLoopModeLabel(mode, cfg = null) {
      return getClosedLoopButtonLabel(mode, cfg);
    }

    function getClosedLoopContinueActionDef(mode) {
      if (mode === CLOSED_LOOP_CONTINUE_MODES.WITHOUT_HOTKEY) {
        return CLOSED_LOOP_CONTINUE_ACTIONS.WITHOUT_HOTKEY;
      }
      if (mode === CLOSED_LOOP_CONTINUE_MODES.WITH_HOTKEY_EVERY_ROUND) {
        return CLOSED_LOOP_CONTINUE_ACTIONS.WITH_HOTKEY_EVERY_ROUND;
      }
      return CLOSED_LOOP_CONTINUE_ACTIONS.WITH_HOTKEY;
    }

    return Object.freeze({
      CLOSED_LOOP_CONTINUE_MODES: Object.freeze(CLOSED_LOOP_CONTINUE_MODES),
      CLOSED_LOOP_ACTIONS,
      CLOSED_LOOP_CONTINUE_ACTIONS,
      normalizeClosedLoopAction,
      getClosedLoopModeFromAction,
      isClosedLoopCanonicalAction,
      isClosedLoopEveryRoundUploadMode,
      getClosedLoopEffectiveUploadInterval,
      getClosedLoopUploadPolicyText,
      getClosedLoopStepSourcePolicyTag,
      getClosedLoopStepSourceTag,
      isClosedLoopStepSource,
      parseClosedLoopStepRound,
      getClosedLoopUploadFailedSource,
      getClosedLoopButtonLabel,
      getClosedLoopModeLabel,
      getClosedLoopContinueActionDef,
    });
  })();
