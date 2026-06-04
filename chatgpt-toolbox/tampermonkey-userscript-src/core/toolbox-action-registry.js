/********************************************************************
 * 工具箱动作注册中心：canonical action、别名、按钮元数据
 ********************************************************************/

const ToolboxActionRegistry = (() => {
  const ACTION = Object.freeze({
    START_UPLOAD: 'start-upload',
    SEND_MESSAGE: 'send-message',
    SEND_COPY_HOTKEY: 'send-copy-hotkey',
    COPY_HOTKEY_ONCE: 'copy-hotkey-once',
    COPY_AND_CONTINUE: 'copy-and-continue',
    COPY_HOTKEY_CONTINUE_ONCE: 'copy-hotkey-continue',
    COPY_HOTKEY_CONTINUE_LOOP: 'loop-copy-hotkey-continue',
    CLOSED_LOOP_HOTKEY_EVERY_N: 'closed-loop-with-hotkey',
    CLOSED_LOOP_HOTKEY_EVERY_ROUND: 'closed-loop-with-hotkey-upload-every-round',
    CLOSED_LOOP_DIRECT_EVERY_N: 'closed-loop-without-hotkey',
    STOP_CLOSED_LOOP: 'stop-closed-loop',
    COPY_ONLY: 'copy-only',
    COPY_LOG: 'copy-log',
    AUTO_CONTINUE: 'auto-continue',
    AUTO_CONTINUE_UNTIL_DONE: 'auto-continue-until-done',
    CLICK_NEW_CHAT: 'click-new-chat',
    TOGGLE_UPLOAD_GROUP_MANAGE: 'toggle-upload-group-manage',
  });

  /** @type {Record<string, string>} 旧名 / 变体 -> canonical action */
  const ACTION_ALIASES = Object.freeze({
    'copy-last-message': ACTION.COPY_ONLY,
    'copy-continue': ACTION.COPY_AND_CONTINUE,
    'copy-and-hotkey': ACTION.COPY_HOTKEY_ONCE,
    'copy-hotkey-once': ACTION.COPY_HOTKEY_ONCE,
    'send-copy-hotkey-once': ACTION.SEND_COPY_HOTKEY,
    'send-and-copy-hotkey': ACTION.SEND_COPY_HOTKEY,
    'closed-loop-upload-continue-hotkey': ACTION.CLOSED_LOOP_HOTKEY_EVERY_N,
    'closed-loop-with-hotkey': ACTION.CLOSED_LOOP_HOTKEY_EVERY_N,
    'closed-loop-upload-continue': ACTION.CLOSED_LOOP_DIRECT_EVERY_N,
    'closed-loop-without-hotkey': ACTION.CLOSED_LOOP_DIRECT_EVERY_N,
    'closed-loop-with-hotkey-upload-every-round': ACTION.CLOSED_LOOP_HOTKEY_EVERY_ROUND,
    'toggle-upload-manage': ACTION.TOGGLE_UPLOAD_GROUP_MANAGE,
    send: ACTION.SEND_MESSAGE,
    'send-once': ACTION.SEND_MESSAGE,
    'autoq-start-upload': ACTION.START_UPLOAD,
    'autoqueue-start-upload': ACTION.START_UPLOAD,
  });

  /** @type {Record<string, string>} 按钮 id -> canonical action（镜像按钮） */
  const BUTTON_ID_ALIAS = Object.freeze({
    'cgpt-autoq-start-upload': ACTION.START_UPLOAD,
  });

  /**
   * 部分 canonical action 仍由 upload-module 内旧 handler 键处理
   * @type {Record<string, string>}
   */
  const HANDLER_ACTION_ALIASES = Object.freeze({
    [ACTION.COPY_HOTKEY_ONCE]: 'copy-and-hotkey',
    [ACTION.COPY_AND_CONTINUE]: 'copy-and-continue',
    [ACTION.COPY_HOTKEY_CONTINUE_ONCE]: 'copy-hotkey-continue',
  });

  const CLOSED_LOOP_CANONICAL = new Set([
    ACTION.CLOSED_LOOP_HOTKEY_EVERY_N,
    ACTION.CLOSED_LOOP_HOTKEY_EVERY_ROUND,
    ACTION.CLOSED_LOOP_DIRECT_EVERY_N,
  ]);

  const SEND_PAYLOAD_ACTIONS = new Set([
    ACTION.SEND_MESSAGE,
    ACTION.SEND_COPY_HOTKEY,
    ACTION.CLOSED_LOOP_HOTKEY_EVERY_N,
    ACTION.CLOSED_LOOP_HOTKEY_EVERY_ROUND,
    ACTION.CLOSED_LOOP_DIRECT_EVERY_N,
  ]);

  function appendRegistryLog(line) {
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
      return;
    }
    console.log(line);
  }

  function normalizeAction(action) {
    const key = String(action || '').trim();
    if (!key) {
      return '';
    }
    if (ACTION_ALIASES[key]) {
      return ACTION_ALIASES[key];
    }
    return key;
  }

  function resolveHandlerAction(action) {
    const canonical = normalizeAction(action);
    if (!canonical) {
      return '';
    }
    return HANDLER_ACTION_ALIASES[canonical] || canonical;
  }

  function resolveActionFromButtonId(buttonId) {
    const id = String(buttonId || '').trim();
    if (!id) {
      return '';
    }
    return BUTTON_ID_ALIAS[id] || '';
  }

  function isClosedLoopAction(action) {
    return CLOSED_LOOP_CANONICAL.has(normalizeAction(action));
  }

  function isClosedLoopStopAction(action) {
    return normalizeAction(action) === ACTION.STOP_CLOSED_LOOP;
  }

  function actionRequiresComposerPayload(action) {
    const canonical = normalizeAction(action);
    if (canonical === ACTION.STOP_CLOSED_LOOP) {
      return false;
    }
    return SEND_PAYLOAD_ACTIONS.has(canonical);
  }

  function buildUploadToolbarRegistry() {
    const UploadSelectorsRef = typeof UploadSelectors !== 'undefined' ? UploadSelectors : {};
    const HomeActionSelectorsRef = typeof HomeActionSelectors !== 'undefined' ? HomeActionSelectors : {};

    return Object.freeze({
      startUpload: Object.freeze({
        key: 'startUpload',
        id: 'cgpt-upload-start',
        selector: UploadSelectorsRef.startBtn || '#cgpt-upload-start',
        action: ACTION.START_UPLOAD,
        handlerAction: ACTION.START_UPLOAD,
        label: '开始上传',
        className: 'cgpt-btn cgpt-btn-upload cgpt-btn-idle',
        title: '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
        required: true,
        dataButtonRole: 'upload-start',
        shortcutConfigKey: 'startUpload',
        visibleInUploadToolbar: true,
      }),
      sendMessage: Object.freeze({
        key: 'sendMessage',
        id: 'cgpt-send-message-once',
        selector: UploadSelectorsRef.sendMessageBtn || '#cgpt-send-message-once',
        action: ACTION.SEND_MESSAGE,
        handlerAction: ACTION.SEND_MESSAGE,
        label: '发送消息',
        className: 'cgpt-btn cgpt-send-btn cgpt-send-btn-idle',
        title: '发送当前输入框中的文字和附件（点击 ChatGPT 页面发送按钮）',
        required: true,
        shortcutConfigKey: 'sendMessage',
        visibleInUploadToolbar: true,
      }),
      sendCopyHotkeyOnce: Object.freeze({
        key: 'sendCopyHotkeyOnce',
        id: 'cgpt-send-copy-hotkey-once',
        selector: UploadSelectorsRef.sendCopyHotkeyBtn || '#cgpt-send-copy-hotkey-once',
        action: ACTION.SEND_COPY_HOTKEY,
        handlerAction: ACTION.SEND_COPY_HOTKEY,
        label: '发送+复制+快捷键',
        className: 'cgpt-btn purple',
        title: '先发送当前输入框消息，等待回答完成后复用“复制+快捷键”流程',
        required: true,
        shortcutConfigKey: 'sendCopyAndHotkeyOnce',
        visibleInUploadToolbar: true,
      }),
      copyHotkeyOnce: Object.freeze({
        key: 'copyHotkeyOnce',
        id: 'cgpt-copy-hotkey-once',
        selector: UploadSelectorsRef.copyHotkeyOnceBtn || '#cgpt-copy-hotkey-once',
        action: ACTION.COPY_HOTKEY_ONCE,
        handlerAction: 'copy-and-hotkey',
        label: '复制+快捷键',
        className: 'cgpt-btn purple',
        title: '复制最后回复，并发送配置的目标快捷键',
        required: true,
        shortcutConfigKey: 'copyAndHotkeyOnce',
        visibleInUploadToolbar: true,
      }),
      copyContinue: Object.freeze({
        key: 'copyContinue',
        id: 'cgpt-upload-continue-once',
        selector: UploadSelectorsRef.copyContinueBtn || '#cgpt-upload-continue-once',
        action: ACTION.COPY_AND_CONTINUE,
        handlerAction: ACTION.COPY_AND_CONTINUE,
        label: '复制并继续',
        className: 'cgpt-btn cgpt-btn-copy-continue',
        title: '先复制最后回复，再发送“继续”',
        required: true,
        visibleInUploadToolbar: true,
      }),
      autoContinue: Object.freeze({
        key: 'autoContinue',
        id: 'cgpt-auto-continue-once',
        selector: UploadSelectorsRef.autoContinueBtn || '#cgpt-auto-continue-once',
        action: ACTION.AUTO_CONTINUE,
        handlerAction: ACTION.AUTO_CONTINUE,
        label: '无限继续',
        className: 'cgpt-btn teal',
        title: '',
        required: true,
        visibleInUploadToolbar: true,
      }),
      autoContinueUntilDone: Object.freeze({
        key: 'autoContinueUntilDone',
        id: 'cgpt-auto-continue-until-done',
        selector: UploadSelectorsRef.autoContinueUntilDoneBtn || '#cgpt-auto-continue-until-done',
        action: ACTION.AUTO_CONTINUE_UNTIL_DONE,
        handlerAction: ACTION.AUTO_CONTINUE_UNTIL_DONE,
        label: '无限继续直到完成',
        className: 'cgpt-btn teal',
        title: '循环发送强约束继续指令；只有检测到严格完成信号才停止',
        required: true,
        visibleInUploadToolbar: true,
      }),
      copyLastReply: Object.freeze({
        key: 'copyLastReply',
        id: 'cgpt-copy-last-message-scroll-bottom',
        selector: UploadSelectorsRef.copyLastMessageBtn || '#cgpt-copy-last-message-scroll-bottom',
        action: ACTION.COPY_ONLY,
        handlerAction: ACTION.COPY_ONLY,
        label: '复制最后回复',
        className: 'cgpt-btn',
        title: '等待最后一条 assistant 回复稳定后复制到剪贴板',
        required: true,
        visibleInUploadToolbar: true,
      }),
      copyToolboxLog: Object.freeze({
        key: 'copyToolboxLog',
        id: 'cgpt-copy-toolbox-log',
        selector: UploadSelectorsRef.copyLogBtn || '#cgpt-copy-toolbox-log',
        action: ACTION.COPY_LOG,
        handlerAction: ACTION.COPY_LOG,
        label: '复制日志',
        className: 'cgpt-btn primary',
        title: '复制小张工具箱内存日志，便于排查上传、发送、等待回复等问题',
        required: true,
        visibleInUploadToolbar: true,
      }),
      goHome: Object.freeze({
        key: 'goHome',
        id: 'cgpt-open-chatgpt-home',
        selector: HomeActionSelectorsRef.homeBtn || '#cgpt-open-chatgpt-home',
        action: ACTION.CLICK_NEW_CHAT,
        handlerAction: 'click-new-chat',
        label: '回到首页',
        className: 'cgpt-btn cgpt-btn-home',
        title: '点击左侧新聊天',
        required: true,
        visibleInUploadToolbar: true,
      }),
      copyHotkeyContinue: Object.freeze({
        key: 'copyHotkeyContinue',
        id: 'cgpt-copy-hotkey-continue-once',
        selector: UploadSelectorsRef.copyHotkeyContinueOnceBtn || '#cgpt-copy-hotkey-continue-once',
        action: ACTION.COPY_HOTKEY_CONTINUE_ONCE,
        handlerAction: 'copy-hotkey-continue',
        label: '复制+快捷键+继续',
        className: 'cgpt-btn purple',
        title: '等待回答完成 -> 检查终止信号 -> 复制最后回复 -> 目标快捷键 -> 发送继续指令',
        required: true,
        visibleInUploadToolbar: true,
      }),
      copyHotkeyContinueLoop: Object.freeze({
        key: 'copyHotkeyContinueLoop',
        id: 'cgpt-copy-hotkey-continue-loop',
        selector: UploadSelectorsRef.copyHotkeyContinueLoopBtn || '#cgpt-copy-hotkey-continue-loop',
        action: ACTION.COPY_HOTKEY_CONTINUE_LOOP,
        handlerAction: ACTION.COPY_HOTKEY_CONTINUE_LOOP,
        label: '无限连续复制+快捷键+继续',
        className: 'cgpt-btn cyan',
        title: '等待回答完成 -> 检查终止信号 -> 复制最后回复 -> 目标快捷键 -> 发送继续指令',
        required: true,
        visibleInUploadToolbar: true,
      }),
      closedLoopWithHotkey: Object.freeze({
        key: 'closedLoopWithHotkey',
        id: 'cgpt-closed-loop-upload-every5-hotkey-btn',
        selector: UploadSelectorsRef.closedLoopUploadEvery5HotkeyBtn || '#cgpt-closed-loop-upload-every5-hotkey-btn',
        action: ACTION.CLOSED_LOOP_HOTKEY_EVERY_N,
        handlerAction: ACTION.CLOSED_LOOP_HOTKEY_EVERY_N,
        label: '',
        className: 'cgpt-btn cyan cgpt-btn-closed-loop cgpt-btn-closed-loop-idle cgpt-closed-loop-mode-hotkey-every5',
        title: '快捷键模式闭环',
        required: true,
        visibleInUploadToolbar: false,
      }),
      closedLoopWithHotkeyEveryRound: Object.freeze({
        key: 'closedLoopWithHotkeyEveryRound',
        id: 'cgpt-closed-loop-upload-every-round-hotkey-btn',
        selector: UploadSelectorsRef.closedLoopUploadEveryRoundHotkeyBtn || '#cgpt-closed-loop-upload-every-round-hotkey-btn',
        action: ACTION.CLOSED_LOOP_HOTKEY_EVERY_ROUND,
        handlerAction: ACTION.CLOSED_LOOP_HOTKEY_EVERY_ROUND,
        label: '',
        className: 'cgpt-btn cyan cgpt-btn-closed-loop cgpt-btn-closed-loop-idle cgpt-closed-loop-mode-hotkey-every-round',
        title: '快捷键模式闭环（每1轮上传）',
        required: true,
        visibleInUploadToolbar: false,
      }),
      closedLoopWithoutHotkey: Object.freeze({
        key: 'closedLoopWithoutHotkey',
        id: 'cgpt-closed-loop-upload-every5-btn',
        selector: UploadSelectorsRef.closedLoopUploadEvery5Btn || '#cgpt-closed-loop-upload-every5-btn',
        action: ACTION.CLOSED_LOOP_DIRECT_EVERY_N,
        handlerAction: ACTION.CLOSED_LOOP_DIRECT_EVERY_N,
        label: '',
        className: 'cgpt-btn cyan cgpt-btn-closed-loop cgpt-btn-closed-loop-idle cgpt-closed-loop-mode-direct-every5',
        title: '直接发送模式闭环',
        required: true,
        visibleInUploadToolbar: false,
      }),
      stopClosedLoop: Object.freeze({
        key: 'stopClosedLoop',
        id: '',
        selector: '',
        action: ACTION.STOP_CLOSED_LOOP,
        handlerAction: ACTION.STOP_CLOSED_LOOP,
        label: '停止闭环继续',
        className: 'cgpt-btn danger',
        title: '停止当前闭环任务',
        required: false,
        visibleInUploadToolbar: false,
      }),
    });
  }

  let uploadToolbarRegistryCache = null;

  function getUploadToolbarRegistry() {
    if (!uploadToolbarRegistryCache) {
      uploadToolbarRegistryCache = buildUploadToolbarRegistry();
    }
    return uploadToolbarRegistryCache;
  }

  function getUploadToolbarButtonDefs() {
    return Object.values(getUploadToolbarRegistry());
  }

  function getUploadUiActionDefs() {
    const defs = getUploadToolbarButtonDefs();
    return [
      ...defs
        .map((def) => ({
          selector: String(def.selector || '').trim(),
          action: def.action,
          handlerAction: def.handlerAction || def.action,
          label: def.label,
        }))
        .filter((def) => def.selector),
      {
        selector: '#cgpt-upload-group-manage',
        action: ACTION.TOGGLE_UPLOAD_GROUP_MANAGE,
        handlerAction: ACTION.TOGGLE_UPLOAD_GROUP_MANAGE,
        label: '上传设置',
      },
    ];
  }

  function findRegistryEntryByAction(action) {
    const canonical = normalizeAction(action);
    const defs = getUploadToolbarButtonDefs();
    return defs.find((def) => def.action === canonical) || null;
  }

  function findRegistryEntryById(buttonId) {
    const defs = getUploadToolbarButtonDefs();
    return defs.find((def) => def.id === buttonId) || null;
  }

  return {
    ACTION,
    ACTION_ALIASES,
    BUTTON_ID_ALIAS,
    HANDLER_ACTION_ALIASES,
    normalizeAction,
    resolveHandlerAction,
    resolveActionFromButtonId,
    isClosedLoopAction,
    isClosedLoopStopAction,
    actionRequiresComposerPayload,
    getUploadToolbarRegistry,
    getUploadToolbarButtonDefs,
    getUploadUiActionDefs,
    findRegistryEntryByAction,
    findRegistryEntryById,
    appendRegistryLog,
  };
})();
