  /********************************************************************
   * ClosedLoopConfig：闭环模式常量与纯函数配置
   ********************************************************************/

  const ClosedLoopConfig = (() => {
    const CLOSED_LOOP_CONTINUE_MODES = {
      WITH_HOTKEY: 'with_hotkey',
      WITH_HOTKEY_EVERY_ROUND: 'with_hotkey_every_round',
      WITHOUT_HOTKEY: 'without_hotkey',
    };

    /** 每1轮上传：与「每5轮上传」并列时的界面文案 */
    const CLOSED_LOOP_UPLOAD_EVERY_ROUND_LABEL = '每1轮上传';

    const STALE_CLOSED_LOOP_UPLOAD_INTERVAL_TEXTS = new Set([
      '每轮上传',
      '每一轮上传',
      '每一轮',
    ]);

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
        title: '快捷键模式：等待回复完成 -> 复制最后回复 -> 判断终止信号 -> 触发配置快捷键 -> 使用稳定直接发送链路发送继续指令；每轮都自动重新上传代码',
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
      const normalized = key;
      console.log('[CLOSED_LOOP_CONFIG][ACTION_NORMALIZED]', {
        input: action,
        normalized,
        source: 'closed-loop-config:normalizeClosedLoopAction',
        ts: Date.now(),
      });
      return normalized;
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

    function normalizeClosedLoopUploadPolicyText(text) {
      const normalized = String(text || '').trim();
      if (STALE_CLOSED_LOOP_UPLOAD_INTERVAL_TEXTS.has(normalized)) {
        return CLOSED_LOOP_UPLOAD_EVERY_ROUND_LABEL;
      }
      return normalized;
    }

    function normalizeClosedLoopButtonLabel(text, expectedLabel = '') {
      const current = String(text || '').trim();
      const expected = String(expectedLabel || '').trim();
      if (!current) {
        return expected;
      }
      if (current.includes('停止闭环继续') || current.includes('停止环继续') || current.includes('正在停止')) {
        return current;
      }
      if (expected && current === expected) {
        return expected;
      }
      if (/每一轮|每1轮|每轮上传/.test(current) && expected.includes(CLOSED_LOOP_UPLOAD_EVERY_ROUND_LABEL)) {
        return expected;
      }
      const intervalPart = current.replace(/^.*\+/, '');
      const fixedInterval = normalizeClosedLoopUploadPolicyText(intervalPart);
      if (fixedInterval !== intervalPart && current.includes('+')) {
        return `${current.split('+')[0]}+${fixedInterval}`;
      }
      return current;
    }

    function getClosedLoopUploadPolicyText(mode, cfg = null) {
      const interval = getClosedLoopEffectiveUploadInterval(mode, cfg);
      return interval <= 1 ? CLOSED_LOOP_UPLOAD_EVERY_ROUND_LABEL : `每${interval}轮上传`;
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
      let label;
      if (mode === CLOSED_LOOP_CONTINUE_MODES.WITHOUT_HOTKEY) {
        label = `闭环-仅对话+${intervalText}`;
      } else {
        label = `闭环-快捷键+${intervalText}`;
      }
      console.log('[CLOSED_LOOP_CONFIG][BUTTON_LABEL_RESOLVED]', {
        action: mode,
        label,
        source: 'closed-loop-config:getClosedLoopButtonLabel',
        ts: Date.now(),
      });
      return label;
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

    if (typeof window !== 'undefined') {
      window.ToolboxClosedLoopConfig = window.ToolboxClosedLoopConfig || {};
      window.ToolboxClosedLoopConfig.normalizeClosedLoopAction = normalizeClosedLoopAction;
      window.ToolboxClosedLoopConfig.getClosedLoopButtonLabel = getClosedLoopButtonLabel;
      window.ToolboxClosedLoopConfig.getClosedLoopUploadPolicyText = getClosedLoopUploadPolicyText;
      window.ToolboxClosedLoopConfig.getClosedLoopStepSourcePolicyTag = getClosedLoopStepSourcePolicyTag;
      window.ToolboxClosedLoopConfig.getClosedLoopStepSourceTag = getClosedLoopStepSourceTag;
      window.ToolboxClosedLoopConfig.isClosedLoopStepSource = isClosedLoopStepSource;
      window.ToolboxClosedLoopConfig.parseClosedLoopStepRound = parseClosedLoopStepRound;
      window.ToolboxClosedLoopConfig.getClosedLoopUploadFailedSource = getClosedLoopUploadFailedSource;
      window.ToolboxClosedLoopConfig.getClosedLoopModeLabel = getClosedLoopModeLabel;
      window.ToolboxClosedLoopConfig.getClosedLoopContinueActionDef = getClosedLoopContinueActionDef;
      window.ToolboxClosedLoopConfig.isClosedLoopEveryRoundUploadMode = isClosedLoopEveryRoundUploadMode;
      window.ToolboxClosedLoopConfig.getClosedLoopEffectiveUploadInterval = getClosedLoopEffectiveUploadInterval;
    }

    return Object.freeze({
      CLOSED_LOOP_CONTINUE_MODES: Object.freeze(CLOSED_LOOP_CONTINUE_MODES),
      CLOSED_LOOP_UPLOAD_EVERY_ROUND_LABEL,
      CLOSED_LOOP_ACTIONS,
      CLOSED_LOOP_CONTINUE_ACTIONS,
      normalizeClosedLoopUploadPolicyText,
      normalizeClosedLoopButtonLabel,
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
