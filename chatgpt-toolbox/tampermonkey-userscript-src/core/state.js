  /********************************************************************
   * 模块隔离说明
   *
   * ToolboxShell
   * - 只负责总面板、选项卡、全局状态、日志、位置记忆。
   *
   * ComposerApi
   * - 只负责与 ChatGPT 页面输入框、发送按钮、附件与 input、附件证据识别。?
   *
   * UploadModule
   * - 只负责多文件上传。
   *
   * AutoQueueModule
   * - 只负责自动指令队列。?
   *
   * PromptManagerModule
   * - 只负责 Prompt 的增删改查、排序、导入导出、填入、发送等。?
   *
   * TitlePrefixModule
   * - 只负责浏览器标签页标题的 ChatGPT 前缀与规范化。?
   *
   * TitleBlinkNotifyModule
   * - 回答完成后在页面失焦时闪烁标签标题提醒。?
   *
   * ExportModule
   * - 只负责对话导出、配置导出、issues 统计。?
   ********************************************************************/

  const APP = Object.freeze({
    rootId: 'cgpt-toolbox-root',
    toggleId: 'cgpt-toolbox-toggle',
    panelId: 'cgpt-toolbox-panel',
    styleId: 'cgpt-toolbox-style',
    edgeHotzoneId: 'cgpt-toolbox-edge-hotzone',
    restoreHotzoneId: 'cgpt-toolbox-restore-hotzone',
    restoreHandleId: 'cgpt-toolbox-restore-handle',
    storagePrefix: 'cgpt_toolbox_tabs_v31:',
    uploadDbName: 'cgpt-toolbox-upload-db-v31',
    uploadDbVersion: 3,
    uploadBlobMaxBytes: 20 * 1024 * 1024,
    uploadStore: 'queue',
    uploadGroupStore: 'groups',
  });

  const UploadState = Object.freeze({
    IDLE: 'IDLE',
    // @deprecated 旧缓存可能含 READY；新流程不再产生，normalizeUploadState 会归一化为 IDLE。
    // 删除条件：升级 uploadDbVersion 后迁移一个版本，且无旧状态迁移日志。
    READY: 'READY',
    READING: 'READING',
    ATTACHING: 'ATTACHING',
    ATTACHED: 'ATTACHED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    MISSING_FILE: 'MISSING_FILE',
  });

  // @deprecated 仅用于兼容旧版本上传缓存状态，新上传流程不再产生这些状态。
  // 删除条件：升级 uploadDbVersion 后迁移一个版本，且无旧状态迁移日志。
  const LEGACY_UPLOAD_STATES = Object.freeze(new Set([
    'VERIFYING',
    'PENDING_CONFIRM',
    'PLATFORM_DUPLICATE',
  ]));

  const UploadStateMeta = (() => {
    const LEGACY_UNFINISHED = LEGACY_UPLOAD_STATES;

    const RUNNING = new Set([
      UploadState.READING,
      UploadState.ATTACHING,
    ]);

    const SUCCESS = new Set([
      UploadState.ATTACHED,
    ]);

    const FAILED = new Set([
      UploadState.FAILED,
      UploadState.CANCELLED,
      UploadState.MISSING_FILE,
    ]);

    function normalize(state) {
      return String(state || '').trim();
    }

    function isRunning(state) {
      return RUNNING.has(normalize(state));
    }

    function isLegacyUnfinished(state) {
      return LEGACY_UNFINISHED.has(normalize(state));
    }

    function isSuccess(state) {
      return SUCCESS.has(normalize(state));
    }

    function isFailed(state) {
      return FAILED.has(normalize(state));
    }

    function isFinal(state) {
      const value = normalize(state);
      return SUCCESS.has(value) || FAILED.has(value);
    }

    function isUnfinished(state) {
      const value = normalize(state);
      return isRunning(value) || isLegacyUnfinished(value);
    }

    function count(items) {
      const list = Array.isArray(items) ? items : [];

      return list.reduce((acc, item) => {
        const state = item && item.state;
        acc.total += 1;

        if (isSuccess(state)) {
          acc.success += 1;
        }

        if (isFailed(state)) {
          acc.failed += 1;
        }

        if (state === UploadState.CANCELLED) {
          acc.cancelled += 1;
        }

        if (state === UploadState.MISSING_FILE) {
          acc.missing += 1;
        }

        if (isUnfinished(state)) {
          acc.unfinished += 1;
        }

        return acc;
      }, {
        total: 0,
        success: 0,
        failed: 0,
        cancelled: 0,
        missing: 0,
        unfinished: 0,
      });
    }

    function allSettled(items) {
      const list = Array.isArray(items) ? items : [];
      return list.length > 0 && list.every((item) => item && isFinal(item.state));
    }

    return {
      isRunning,
      isLegacyUnfinished,
      isSuccess,
      isFailed,
      isFinal,
      isUnfinished,
      count,
      allSettled,
    };
  })();

  function isLegacyUploadState(value) {
    const ok = UploadStateMeta.isLegacyUnfinished(value);
    if (ok) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[UPLOAD_LEGACY_STATE][HIT] state=${String(value || '-')}`,
        );
      }
    }
    return ok;
  }

  function isUploadUnfinishedState(value) {
    return UploadStateMeta.isUnfinished(value);
  }

  const UploadStateUtils = Object.freeze({
    isFinal: UploadStateMeta.isFinal,
    isSuccess: UploadStateMeta.isSuccess,
    isFailed: UploadStateMeta.isFailed,
    count: UploadStateMeta.count,
    allSettled: UploadStateMeta.allSettled,
  });

  const SELECTORS = Object.freeze({
    composer: '[data-testid="composer"]',
    composerTextarea: [
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '[data-testid="composer-textarea"]',
      'div#prompt-textarea',
      '[data-testid="composer"] textarea',
      '[data-testid="composer"] [contenteditable="true"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'form div[contenteditable="true"]',
    ],
    sendButton: [
      'button#composer-submit-button',
      'button[data-testid="composer-submit-button"]',
      'button[data-testid="send-button"]',
      '[data-testid="composer"] button[type="submit"]',
      'form button[type="submit"]',
      'button[aria-label="发送"]',
      'button[aria-label="发送消息"]',
      'button[aria-label="发送提示"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
    ],
    stopButton: 'button[data-testid="stop-button"]',
    duplicateDialog: '[role="dialog"], [role="alertdialog"], [aria-modal="true"]',
  });

  const UploadSelectors = Object.freeze({
    module: '#cgpt-upload-module',
    list: '#cgpt-upload-list',

    // 上传按钮：只负责上传
    startBtn: '#cgpt-upload-start',

    // 发送按钮：只负责发送。新 ID 不再带 upload-start，避免语义和状态污染。
    sendMessageBtn: '#cgpt-send-message-once',

    // 旧 ID 只用于兼容迁移，不允许新渲染继续使用。
    legacyStartSendBtn: '#cgpt-upload-start-send',

    copyContinueBtn: '#cgpt-upload-continue-once',
    // @deprecated 独立“发送快捷键”按钮已移除，仅用于历史 DOM 清理。
    legacySendHotkeyBtn: '#cgpt-send-hotkey-once',
    autoContinueBtn: '#cgpt-auto-continue-once',
    autoContinueUntilDoneBtn: '#cgpt-auto-continue-until-done',
    copyLastMessageBtn: '#cgpt-copy-last-message-scroll-bottom',
    copyHotkeyOnceBtn: '#cgpt-copy-hotkey-once',
    copyHotkeyContinueOnceBtn: '#cgpt-copy-hotkey-continue-once',
    copyHotkeyContinueLoopBtn: '#cgpt-copy-hotkey-continue-loop',
    copyHotkeyContinueLoopUploadVerifyBtn: '#cgpt-copy-hotkey-continue-loop-upload-verify',
    groupList: '#cgpt-upload-group-list',
    managePanel: '#cgpt-upload-manage-panel',
    manageGroupList: '#cgpt-upload-manage-group-list',
    groupNameInput: '#cgpt-upload-group-name-input',
    quickPrompts: '#cgpt-upload-quick-prompts',
  });

  /** Upload area core action buttons (upload/copy/hotkey). Send is separate — see SendActionSelectors. */
  const UploadCoreActionSelectors = Object.freeze([
    UploadSelectors.startBtn,
    UploadSelectors.copyContinueBtn,
    UploadSelectors.autoContinueBtn,
    UploadSelectors.autoContinueUntilDoneBtn,
    UploadSelectors.copyLastMessageBtn,
    UploadSelectors.copyHotkeyOnceBtn,
    UploadSelectors.copyHotkeyContinueOnceBtn,
    UploadSelectors.copyHotkeyContinueLoopBtn,
    UploadSelectors.copyHotkeyContinueLoopUploadVerifyBtn,
  ]);

  const SendActionSelectors = Object.freeze([
    UploadSelectors.sendMessageBtn,
  ]);

  const HomeActionSelectors = Object.freeze({
    homeBtn: '#cgpt-open-chatgpt-home',
  });

  const SettingsSelectors = Object.freeze({
    showUploadGroups: '#cgpt-setting-compact-show-upload-groups',
    showUploadStart: '#cgpt-setting-compact-show-upload-start',
    showFileList: '#cgpt-setting-compact-show-file-list',
  });

  const UiMessages = Object.freeze({
    promptCreated: '已新建 Prompt',
    promptDuplicated: '已复制 Prompt',
    promptExported: '已导出 Prompt',
  });

  function promptDeletedMessage(title) {
    const name = String(title || '').trim();
    return name ? `已删除 Prompt：${name}` : '已删除 Prompt';
  }

  const DEFAULT_MODE_SETTINGS = Object.freeze({
    continue: Object.freeze({
      loopMode: false,
      randomMinSec: 3,
      randomMaxSec: 20,
      maxLoopCount: 0,
      logPinned: true,
      autoScrollPanel: true,
    }),
    list: Object.freeze({
      loopMode: false,
      randomMinSec: 3,
      randomMaxSec: 20,
      maxLoopCount: 0,
      logPinned: true,
      autoScrollPanel: true,
    }),
    task: Object.freeze({
      loopMode: false,
      randomMinSec: 3,
      randomMaxSec: 20,
      maxLoopCount: 0,
      logPinned: true,
      autoScrollPanel: true,
    }),
  });

  function cloneModeSettingItem(item) {
    return {
      loopMode: !!item.loopMode,
      randomMinSec: Number(item.randomMinSec) || 3,
      randomMaxSec: Number(item.randomMaxSec) || 20,
      maxLoopCount: Number(item.maxLoopCount) || 0,
      logPinned: item.logPinned !== false,
      autoScrollPanel: item.autoScrollPanel !== false,
    };
  }

  function cloneDefaultModeSettings() {
    return {
      continue: cloneModeSettingItem(DEFAULT_MODE_SETTINGS.continue),
      list: cloneModeSettingItem(DEFAULT_MODE_SETTINGS.list),
      task: cloneModeSettingItem(DEFAULT_MODE_SETTINGS.task),
    };
  }

  const DEFAULT_BATCH_DONE_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';
  const DEFAULT_BATCH_BLOCKED_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_BLOCKED_NEED_INPUT_7F3B9C>>>';
  const DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_NO_MORE_CONTENT_7F3B9C>>>';
  const DEFAULT_TASK_DONE_SIGNAL = DEFAULT_BATCH_DONE_SIGNAL;

  const LEGACY_BATCH_CONTINUE_PROMPT_TEMPLATE_V2 = `请继续完成上一个任务。

默认行为：继续输出剩余内容。

你必须优先判断“还有没有未输出完的内容”，而不是优先判断是否停止。

只有同时满足下面所有条件时，才允许停止：
1. 你能明确回忆并确认最开始的任务目标是什么。
2. 你能确认该目标的所有部分都已经完整覆盖。
3. 上一轮回答不是因为长度限制、网络中断、生成中断、代码块未闭合、列表未完成、编号未结束而停止。
4. 没有任何剩余文件、剩余检查项、剩余代码、剩余 Cursor 指令、剩余结论需要补充。
5. 不是因为“看起来已经总结过”而停止，必须是确实没有任何可继续输出的内容。

如果以上 5 条有任何一条不能确定，请不要停止，继续输出剩余内容。

如果你非常确定任务已经完整完成，并且没有任何剩余内容，只能回复下面这一行，不能有任何其他文字：
{{DONE_SIGNAL}}

如果不确定是否已经完成，必须继续输出，禁止输出终止信号。

继续输出时必须遵守：
1. 不要重复已经输出过的内容。
2. 不要重新开始整个任务。
3. 不要扩展到新任务。
4. 只补充当前任务尚未完成、尚未输出、尚未覆盖的部分。
5. 如果上一轮回答像是被截断，请从中断位置继续。`;

  const DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE = `请继续完成上一个任务。

如果还有未输出完的内容，请继续输出剩余内容。

如果已经没有可继续输出的内容，但由于缺少源码、日志、构建结果、测试结果、用户确认等外部材料，无法判断任务是否真实完成，请只输出：
{{BLOCKED_SIGNAL}}

如果你非常确定任务已经完整完成，并且没有任何剩余内容，只输出：
{{DONE_SIGNAL}}

如果你确定当前回复内容已经输出完，但不能证明工程任务真实完成，只输出：
{{NO_MORE_CONTENT_SIGNAL}}

继续输出时必须遵守：
1. 不要重复已经输出过的内容。
2. 不要重新开始整个任务。
3. 不要扩展到新任务。
4. 只补充当前任务尚未完成、尚未输出、尚未覆盖的部分。
5. 如果上一轮回答像是被截断，请从中断位置继续。`;

  const LEGACY_BATCH_CONTINUE_PROMPT_TEMPLATE_V1 = `请继续完成上一个任务。

你必须先判断“最开始的任务目标”是否已经完整完成，而不是机械地继续输出。

判断规则：
1. 如果最开始的任务目标已经完整完成，并且没有遗漏内容、没有未输出完的代码、没有未覆盖的文件、没有剩余检查项，只能回复下面这一行，不能有任何其他文字：
{{DONE_SIGNAL}}

2. 如果还没有完成，请继续输出剩余内容。
3. 不要重复已经输出过的内容。
4. 不要重新开始整个任务。
5. 不要扩展到新任务。
6. 只补充当前任务中尚未完成、尚未输出、尚未覆盖的部分。
7. 如果上一轮回答因为长度限制、网络中断、生成中断、代码块未闭合、列表未完成、编号未结束而停止，请从中断位置继续。`;

  const LEGACY_TASK_DONE_SIGNALS = Object.freeze([
    'CHATGPT_TOOLBOX_DONE',
    '__CHATGPT_TOOLBOX_DONE__',
    '<<<CHATGPT_TOOLBOX_DONE>>>',
    '<<<TASK_DONE>>>',
    'TASK_DONE',
  ]);

  function isLegacyTaskDoneSignalValue(value) {
    const trimmed = String(value || '').trim();
    return trimmed.length > 0 && LEGACY_TASK_DONE_SIGNALS.includes(trimmed);
  }

  function migrateTaskDoneSignalValue(value, logFn) {
    const trimmed = String(value || '').trim();
    if (!trimmed || !isLegacyTaskDoneSignalValue(trimmed)) {
      return trimmed;
    }
    if (typeof logFn === 'function') {
      logFn(`[AUTOQ][TASK_SIGNAL][MIGRATE] from=${trimmed} to=${DEFAULT_TASK_DONE_SIGNAL}`);
    }
    return DEFAULT_TASK_DONE_SIGNAL;
  }

  function analyzeDoneSignalText(text, options = {}) {
    const configuredSignal = typeof options.doneSignal === 'string'
      ? normalizeDoneSignal(options.doneSignal)
      : normalizeDoneSignal(DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL);
  // 连续运行/批量任务：仅匹配当前配置的终止信号，避免旧版别名或模型偶发短句误触发停止。
    const allowedSignals = new Set([configuredSignal]);

    const checked = cleanAssistantTextForDoneSignal(text)
      .replace(/\r\n/g, '\n')
      .trim();

    if (typeof isCorruptedBatchSignalText === 'function' && isCorruptedBatchSignalText(checked)) {
      return {
        matched: false,
        corrupted: true,
        lineCount: 0,
        reason: 'corrupted-signal',
        allowedSignals: Array.from(allowedSignals),
        configuredSignal,
      };
    }

    const lines = checked
      .split('\n')
      .map((line) => String(line || '').trim())
      .filter(Boolean);

    if (lines.length === 1 && allowedSignals.has(lines[0])) {
      return {
        matched: true,
        corrupted: false,
        lineCount: 1,
        reason: 'strict-exact-single-line-match',
        allowedSignals: Array.from(allowedSignals),
        configuredSignal,
      };
    }

    return {
      matched: false,
      corrupted: false,
      lineCount: lines.length,
      reason: lines.length === 0 ? 'empty' : 'not-single-line-stop-signal',
      allowedSignals: Array.from(allowedSignals),
      configuredSignal,
    };
  }

  function isCorruptedBatchSignalText(text) {
    const value = String(text || '');
    return (
      value.includes('<<<XZ_TOOLBOX_BATCH_<<<XZ_TOOLBOX_BATCH_')
      || value.includes('_7F3B9C>>>_7F3B9C>>>')
      || /<<<XZ_TOOLBOX_BATCH_[^>]+<<<XZ_TOOLBOX_BATCH_/.test(value)
    );
  }

  function normalizeReplyText(text) {
    return String(text || '')
      .replace(/\u200B|\u200C|\u200D|\uFEFF/g, '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  const BATCH_REPLY_BLOCKED_TEXT_PATTERNS = [
    /当前没有新的?剩余内容可以继续输出/,
    /当前没有可继续补充的剩余内容/,
    /没有可继续输出的内容/,
    /不能输出[\s\S]*XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C/,
    /缺少?实际验证材料/,
    /没有实际修改、扫描、构建、测试结果/,
    /任务不能判定完整完成/,
    /无法判定任务完整完成/,
    /需要用户提供/,
  ];

  function classifyBatchReply(replyText) {
    const text = normalizeReplyText(replyText);

    if (!text) {
      return {
        shouldStop: false,
        status: 'empty',
        reason: 'empty-reply',
      };
    }

    if (text.includes(DEFAULT_BATCH_DONE_SIGNAL)) {
      return {
        shouldStop: true,
        status: 'done',
        reason: 'done-marker-detected',
      };
    }

    if (text.includes(DEFAULT_BATCH_BLOCKED_SIGNAL)) {
      return {
        shouldStop: true,
        status: 'blocked',
        reason: 'blocked-marker-detected',
      };
    }

    if (text.includes(DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL)) {
      return {
        shouldStop: true,
        status: 'no_more_content',
        reason: 'no-more-content-marker-detected',
      };
    }

    for (const pattern of BATCH_REPLY_BLOCKED_TEXT_PATTERNS) {
      if (pattern.test(text)) {
        return {
          shouldStop: true,
          status: 'blocked',
          reason: 'blocked-text-detected',
        };
      }
    }

    return {
      shouldStop: false,
      status: 'continue',
      reason: 'no-terminal-state-detected',
    };
  }

  function repairCorruptedDoneSignalText(value, logFn) {
    const text = String(value || '').trim();

    if (!text) {
      return DEFAULT_BATCH_DONE_SIGNAL;
    }

    const knownGood = [
      '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>',
      'CHATGPT_TOOLBOX_DONE',
      '__CHATGPT_TOOLBOX_DONE__',
      '<<<CHATGPT_TOOLBOX_DONE>>>',
      '<<<TASK_DONE>>>',
      'TASK_DONE',
    ];

    if (knownGood.includes(text)) {
      if (text !== DEFAULT_BATCH_DONE_SIGNAL && typeof logFn === 'function') {
        logFn(
          `[AUTOQ][TASK_SIGNAL][REPAIR_CORRUPTED] field=doneSignal oldLength=${text.length} new=${DEFAULT_BATCH_DONE_SIGNAL}`,
        );
      }
      return DEFAULT_BATCH_DONE_SIGNAL;
    }

    if (
      text.includes('XZ_TOOLBOX_BATCH_')
      || text.includes('TASK_DONE_7F3B9C')
      || text.length > 80
    ) {
      if (typeof logFn === 'function') {
        logFn(
          `[AUTOQ][TASK_SIGNAL][REPAIR_CORRUPTED] field=doneSignal oldLength=${text.length} new=${DEFAULT_BATCH_DONE_SIGNAL}`,
        );
      }
      return DEFAULT_BATCH_DONE_SIGNAL;
    }

    return text;
  }

  function normalizeContinuePromptTemplateForCompare(text) {
    return String(text || '').replace(/\r\n/g, '\n').trim();
  }

  function isLegacyDefaultBatchContinuePromptTemplate(text) {
    const normalized = normalizeContinuePromptTemplateForCompare(text);
    if (!normalized) {
      return false;
    }

    if (normalized === normalizeContinuePromptTemplateForCompare(LEGACY_BATCH_CONTINUE_PROMPT_TEMPLATE_V1)) {
      return true;
    }

    if (normalized === normalizeContinuePromptTemplateForCompare(LEGACY_BATCH_CONTINUE_PROMPT_TEMPLATE_V2)) {
      return true;
    }

    if (
      normalized.includes('如果不确定是否已经完成，必须继续输出，禁止输出终止信号')
      || normalized.includes('只有同时满足下面所有条件时，才允许停止')
    ) {
      return true;
    }

    if (normalized === normalizeContinuePromptTemplateForCompare(getLegacyShortContinuePromptText())) {
      return true;
    }

    if (normalized === normalizeContinuePromptTemplateForCompare(getLegacyDefaultContinuePromptText())) {
      return true;
    }

    if (
      normalized.includes('你必须先判断“最开始的任务目标”是否已经完整完成，而不是机械地继续输出')
      || normalized.includes('你需要先判断上一个任务是否还有剩余内容，但默认不要轻易停止')
      || (
        normalized.includes('如果上一个任务已经完整完成、没有必要继续、没有剩余内容需要补充')
        && normalized.includes('除此之外不要输出任何多余文字')
      )
    ) {
      return true;
    }

    return false;
  }

  function repairCorruptedContinuePromptTemplate(value, logFn, fieldName) {
    const text = String(value || '').trim();
    const field = String(fieldName || 'continuePromptTemplate');

    if (!text) {
      return '';
    }

    if (isCorruptedBatchSignalText(text)) {
      if (typeof logFn === 'function') {
        logFn(
          `[AUTOQ][TASK_PROMPT][REPAIR_CORRUPTED_TEMPLATE] field=${field} oldLength=${text.length}`,
        );
      }
      return DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
    }

    if (isLegacyDefaultBatchContinuePromptTemplate(text)) {
      if (typeof logFn === 'function') {
        logFn(
          `[AUTOQ][TASK_PROMPT][MIGRATE_DEFAULT_TEMPLATE] field=${field} oldLength=${text.length}`,
        );
      }
      return DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
    }

    if (text.includes(DEFAULT_BATCH_DONE_SIGNAL)) {
      const repaired = text.replaceAll(DEFAULT_BATCH_DONE_SIGNAL, '{{DONE_SIGNAL}}');
      if (repaired !== text && typeof logFn === 'function') {
        logFn(
          `[AUTOQ][TASK_PROMPT][TEMPLATE_REPAIR] field=${field} action=replace-done-signal-with-placeholder`,
        );
      }
      return repaired;
    }

    return text;
  }

  function normalizeDoneSignal(value) {
    return repairCorruptedDoneSignalText(value);
  }

  function renderContinuePromptTemplate(template, doneSignal) {
    const safeTemplate = String(template || DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE);
    const safeDoneSignal = normalizeDoneSignal(doneSignal || DEFAULT_BATCH_DONE_SIGNAL);
    return safeTemplate
      .replaceAll('{{DONE_SIGNAL}}', safeDoneSignal)
      .replaceAll('{{BLOCKED_SIGNAL}}', DEFAULT_BATCH_BLOCKED_SIGNAL)
      .replaceAll('{{NO_MORE_CONTENT_SIGNAL}}', DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL);
  }

  function getContinuePromptTemplateForDisplay(value, logFn, fieldName) {
    const text = String(value || '').trim();
    if (!text) {
      return DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
    }
    return repairCorruptedContinuePromptTemplate(text, logFn, fieldName || 'continuePromptTemplate');
  }

  function getDefaultTaskContinuePromptText() {
    return DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
  }

  function createDefaultTaskQueueSettings() {
    return {
      stopOnMaxContinueRounds: true,
      defaultMaxContinueRoundsMigratedToUnlimited: false,
      /** true = 每个任务完成后点击 ChatGPT 新聊天再发下一个；false = 在当前对话继续 */
      switchNewChatBetweenTasks: true,
      /** false = 单任务发送失败后继续下一个；true = 立即停止整个批量任务组 */
      stopBatchOnTaskSendFailure: false,
      verifyAfterDoneSignal: true,
      verifyAfterDoneSignalUploadFile: true,

      // 批量任务组：每 N 次对话自动上传一次文件
      taskAutoUploadEveryNMessagesEnabled: true,
      taskAutoUploadEveryNMessages: 5,
      taskAutoUploadCountInitialPrompt: true,
      taskAutoUploadCountContinuePrompt: true,
      taskAutoUploadCountVerifyPrompt: true,

      taskRotateNewChatByPageTurnEnabled: true,
      taskRotateNewChatPageTurnThreshold: 30,
      taskRotateForceUploadAfterNewChat: true,
      maxConversationRoundsPerPage: 30,
      enableAutoNewChatWhenRoundLimitReached: true,

      // 批量任务组发送限速：默认 3 小时最多 150 条，低于 ChatGPT 3 小时 160 条的默认上限，预留 10 条安全余量
      taskSendRateLimitEnabled: true,
      taskSendRateLimitWindowMinutes: 180,
      taskSendRateLimitMaxMessages: 150,

      // 批量任务组上传限速：默认 3 小时最多 80 个文件，避免超过 ChatGPT 文件上传额度
      taskUploadRateLimitEnabled: true,
      taskUploadRateLimitWindowMinutes: 180,
      taskUploadRateLimitMaxFiles: 80,

      showRuntimeStats: true,
      preserveRuntimeStatsAverage: false,
      runtimeStatsRefreshIntervalMs: 1000,

      taskRelentlessSendRetryEnabled: true,
      taskRelentlessSendRetryIntervalMs: 1500,
      taskRelentlessSendRetryMaxIntervalMs: 10000,
      taskRelentlessSendRetryBackoffEnabled: true,

      verifyAfterDoneSignalPrompt: [
        '请根据我刚才上传的代码文件和当前任务要求，检查任务是否已经完整完成。',
        '',
        '当前任务标题：{{taskTitle}}',
        '当前任务内容：',
        '{{taskContent}}',
        '',
        '你需要判断：',
        '1. 是否已经完整完成当前任务。',
        '2. 是否还有遗漏文件、遗漏检查项、遗漏代码、遗漏结论。',
        '3. 如果确实完成，只回复：{{doneSignal}}',
        '4. 如果没有完成，请继续输出剩余内容，不要回复终止信号。',
      ].join('\n'),
    };
  }

  function createDefaultModeSettings() {
    return cloneDefaultModeSettings();
  }

  const DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';

  function getLegacyShortContinuePromptText() {
    return [
      '请继续完成上一个任务。',
      '',
      '如果上一个任务已经完整完成、没有必要继续、没有剩余内容需要补充，只能回复下面这一行，不能有任何其他文字：',
      '',
      DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL,
      '',
      '除此之外不要输出任何多余文字。',
      '',
      '如果还需要继续，请直接继续输出后续内容，不要解释。',
    ].join('\n');
  }

  function getLegacyDefaultContinuePromptText() {
    return [
      '请继续完成上一个任务。',
      '',
      '你需要先判断上一个任务是否还有剩余内容，但默认不要轻易停止。',
      '',
      '判断原则：',
      '1. 如果无法非常明确地确认“最开始的任务目标”已经完整完成，请继续输出。',
      '2. 如果还有任何遗漏内容、未输出完的代码、未输出完的检查项、未输出完的整改指令、未覆盖的文件或未完成的步骤，请继续输出。',
      '3. 如果只是阶段性完成、局部完成、当前小节完成，不代表整个任务完成，必须继续。',
      '4. 如果上一次回答因为长度限制、网络中断、生成中断、代码块未闭合、列表未完成、编号未结束而停止，请从中断位置继续。',
      '5. 只有在你非常确定最开始的任务已经完整完成，并且没有任何剩余内容需要输出时，才允许只回复下面这一行，不能有任何其他文字：',
      '',
      DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL,
      '',
      '不要输出任何其他文字。',
      '',
      '继续输出时必须遵守：',
      '1. 不要重新开始整个任务。',
      '2. 不要重复已经输出过的内容。',
      '3. 不要扩展到新任务、新需求、新建议。',
      '4. 不要自由发挥，不要补充无关背景知识。',
      '5. 只输出“原任务中尚未完成、尚未覆盖、尚未输出完”的部分。',
      '6. 如果需要继续代码，从上一次中断的位置继续。',
      '7. 如果需要继续分析，从上一次中断的小节继续。',
      '8. 如果已经列过结论，不要重复结论，只补遗漏项。',
      '9. 如果不确定是否已经完成，优先继续，而不是输出终止信号。',
      '',
      '请直接继续输出剩余内容。',
    ].join('\n');
  }

  function getDefaultContinuePromptText() {
    return DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
  }

  function isLegacyContinuePromptText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed === '继续') {
      return true;
    }
    if (trimmed === getLegacyShortContinuePromptText()) {
      return true;
    }
    if (typeof isLegacyDefaultBatchContinuePromptTemplate === 'function'
      && isLegacyDefaultBatchContinuePromptTemplate(trimmed)) {
      return true;
    }
    if (trimmed === getLegacyDefaultContinuePromptText()) {
      return true;
    }
    if (trimmed.includes('<<<TASK_DONE>>>')) {
      return true;
    }
    return false;
  }

  function migrateContinuePromptTextIfNeeded(storedText, logFn) {
    const trimmed = String(storedText || '').trim();

    if (!trimmed) {
      return { value: '', migrated: false, reason: 'empty-use-runtime-default' };
    }

    if (trimmed === '继续') {
      if (typeof logFn === 'function') {
        logFn('[CONTINUE_PROMPT][MIGRATE_DEFAULT] old=continue new=explicit-task-done');
      }
      return { value: '', migrated: true, reason: 'old-continue' };
    }

    if (isLegacyContinuePromptText(trimmed)) {
      if (typeof logFn === 'function') {
        logFn('[CONTINUE_PROMPT][MIGRATE_DEFAULT] old=legacy-prompt new=explicit-task-done');
      }
      return { value: '', migrated: true, reason: 'legacy-prompt' };
    }

    if (typeof logFn === 'function') {
      logFn('[CONTINUE_PROMPT][KEEP_USER_CUSTOM] reason=user-customized');
    }
    return { value: trimmed, migrated: false, reason: 'user-customized' };
  }

  function createDefaultAutoConfig() {
    return {
      listPromptsText: '请先自我介绍一下\n请再用 3 点总结你能做什么',
      continuePromptsText: '',
      promptMode: 'continue',
      listProfiles: [],
      activeListProfileId: '',
      taskProfiles: [],
      activeTaskProfileId: '',
      taskQueueSettings: createDefaultTaskQueueSettings(),
      modeSettings: createDefaultModeSettings(),
    };
  }

  function getDefaultAutoListPromptsText() {
    return createDefaultAutoConfig().listPromptsText;
  }

  function createDefaultPrompts() {
    return [
    {
      title: '找僵尸代码',
      category: '代码',
      content: `请你作为资深代码审查专家，帮我识别当前代码中的僵尸代码（dead code / unreachable code），并给出可执行清理方案。

请按下面格式输出：
1. 僵尸代码清单：
- 文件路径
- 函数/变量/分支名称
- 为什么判定为僵尸代码（无引用、永远不会执行、被新逻辑替代等）

2. 风险评估：
- 删除后是否可能影响运行时行为
- 是否与反射、动态调用、配置开关、埋点或兼容逻辑有关

3. 清理建议：
- 可直接删除
- 建议保留但标记 @deprecated
- 建议先加日志观察再删除

4. 如果代码量不大，请直接给出清理后的关键代码片段。`,
    },
    {
      title: '找 bug',
      category: '代码',
      content: `请根据我提供的代码，整理完整的 bug 定位和修改建议。

要求：
1. 明确指出可能存在 bug 的位置。
2. 说明 bug 产生的原因。
3. 给出修改方案。
4. 如果代码不长，直接给出修改后的完整代码。
5. 不要泛泛而谈，要结合具体代码分析。`,
    },
    {
      title: '整理成 Cursor 指令',
      category: 'Cursor',
      content: `请根据你在上文中刚刚对我的代码所做的修改、优化和建议，进行整理和汇总。

我的目标不是让你再次修改代码，而是让你把这些已经给出的修改内容，转换成一段适合直接发给 Cursor 的指令。

要求：
1. 基于你上文已经给出的修改内容来总结，不要重新发散分析。
2. 把已经修改过的内容、建议修改的内容、以及后续可继续优化的内容，整理成 Cursor 更容易执行的任务描述。
3. 表达方式要适合 Cursor 使用，强调“基于现有代码继续修改和完善”。
4. 不要写成聊天式描述，要写成明确的执行指令。
5. 如果上文已经给出了修改后的代码，也要把对应修改目标一并总结进去。
6. 输出结果要尽量清楚、简洁、可直接复制给 Cursor。
7. 只给出对出的要求，不要输出多余的文字说明。

输出格式：
指令放到代码块中`,
    },
    {
      title: '重复代码审查',
      category: '代码',
      content: `请针对我提供的代码进行深度审查，重点识别冗余、重复、可抽象的逻辑。

要求：
1. 明确指出重复模块、重复函数或重复逻辑块。
2. 分析这些重复代码对维护性、性能、可读性的影响。
3. 给出重构方案。
4. 如果代码不长，直接给出修改后的完整代码。
5. 不要破坏原有功能和调用方式。`,
    },
  ];
  }











  const DEFAULT_PROMPT_CATEGORIES = Object.freeze([
    { id: 'default', name: '默认', order: 0 },
    { id: 'code', name: '代码', order: 1 },
    { id: 'paper', name: '论文', order: 2 },
    { id: 'cursor', name: 'Cursor', order: 3 },
  ]);

  /**
   * 上传分组对外镜像（由 UploadModule 在 load/switch/render 时同步）。
   * 真实队列与 IndexedDB 仍在 UploadModule 闭包内维护。
   */
  const UploadGroupAppState = {
    uploadGroups: [],
    activeUploadGroupId: '',
    uploadItems: [],
  };

  let toolboxPageNavigating = false;

  function isToolboxPageNavigating() {
    return toolboxPageNavigating === true;
  }

  function setToolboxPageNavigating(active) {
    toolboxPageNavigating = !!active;
  }

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function normalizeBindOptions(eventName, fourth, defaultModuleName = '') {
    const opts = {};

    if (typeof fourth === 'string') {
      opts.key = fourth;
    } else if (fourth && typeof fourth === 'object') {
      if (
        fourth.key != null
        || fourth.moduleName != null
        || fourth.listenerOptions != null
      ) {
        Object.assign(opts, fourth);
      } else {
        opts.listenerOptions = fourth;
      }
    }

    opts.key = opts.key || String(eventName || '');

    if (defaultModuleName && !opts.moduleName) {
      opts.moduleName = defaultModuleName;
    }

    return opts;
  }

  function bindOnce(el, eventName, handler, fourth) {
    return EventBinder.on(
      el,
      eventName,
      handler,
      normalizeBindOptions(eventName, fourth),
    );
  }

