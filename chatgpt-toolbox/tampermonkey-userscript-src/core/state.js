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
   * ResponseDoneNotifyModule
   * - 回答完成后的「回复完成」未读提醒；用户回到页面并交互后自动确认清除。?
   *
   * ExportModule
   * - 只负责对话导出、配置导出、设置备份。?
   ********************************************************************/

  const APP = Object.freeze({
    rootId: 'cgpt-toolbox-root',
    toggleId: 'cgpt-toolbox-toggle',
    panelId: 'cgpt-toolbox-panel',
    styleId: 'cgpt-toolbox-style',
    restoreHotzoneId: 'cgpt-toolbox-restore-hotzone',
    restoreHandleId: 'cgpt-toolbox-restore-handle',
    storagePrefix: 'cgpt_toolbox_tabs_v32:',
    DATA_STORAGE_PREFIX: 'cgpt_toolbox_data:',
    storageLegacyPrefixes: Array.from(
      { length: 31 },
      (_, index) => `cgpt_toolbox_tabs_v${31 - index}:`,
    ),
    uploadDbName: 'cgpt-toolbox-upload-db-v32',
    uploadDbVersion: 1,
    uploadBlobMaxBytes: 0,
    persistUploadBlobEnabled: false,
    uploadStore: 'queue',
    uploadGroupStore: 'groups',
  });

  const UploadState = Object.freeze({
    IDLE: 'IDLE',
    READING: 'READING',
    ATTACHING: 'ATTACHING',
    ATTACHED: 'ATTACHED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    MISSING_FILE: 'MISSING_FILE',
    NEEDS_REBIND: 'NEEDS_REBIND',
  });

  const UploadStateLegacyAliases = Object.freeze({
    READY: UploadState.IDLE,
    DONE: UploadState.ATTACHED,
    UPLOADED: UploadState.ATTACHED,
    PENDING_CONFIRM: UploadState.ATTACHING,
  });

  function normalizeUploadStateValue(value, fallback = UploadState.IDLE) {
    const text = String(value || '').trim();
    if (!text) {
      return fallback;
    }
    if (Object.prototype.hasOwnProperty.call(UploadState, text)) {
      return UploadState[text];
    }
    const canonicalValues = Object.values(UploadState);
    if (canonicalValues.includes(text)) {
      return text;
    }
    if (Object.prototype.hasOwnProperty.call(UploadStateLegacyAliases, text)) {
      return UploadStateLegacyAliases[text];
    }
    return fallback;
  }

  const UploadStateMeta = (() => {
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
      UploadState.NEEDS_REBIND,
    ]);

    function normalize(state) {
      return normalizeUploadStateValue(state, '');
    }

    function isRunning(state) {
      return RUNNING.has(normalize(state));
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
      return isRunning(value);
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

        if (state === UploadState.MISSING_FILE || state === UploadState.NEEDS_REBIND) {
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
      isSuccess,
      isFailed,
      isFinal,
      isUnfinished,
      count,
      allSettled,
    };
  })();

  function isUploadUnfinishedState(value) {
    return UploadStateMeta.isUnfinished(value);
  }

  const UploadStateUtils = Object.freeze({
    normalize: normalizeUploadStateValue,
    isRunning: UploadStateMeta.isRunning,
    isUnfinished: UploadStateMeta.isUnfinished,
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
    sendCopyHotkeyBtn: '#cgpt-send-copy-hotkey-once',

    copyContinueBtn: '#cgpt-upload-continue-once',
    autoContinueBtn: '#cgpt-auto-continue-once',
    autoContinueUntilDoneBtn: '#cgpt-auto-continue-until-done',
    copyLastMessageBtn: '#cgpt-copy-last-message-scroll-bottom',
    copyLogBtn: '#cgpt-copy-toolbox-log',
    copyHotkeyOnceBtn: '#cgpt-copy-hotkey-once',
    copyHotkeyContinueOnceBtn: '#cgpt-copy-hotkey-continue-once',
    copyHotkeyContinueLoopBtn: '#cgpt-copy-hotkey-continue-loop',
    closedLoopUploadEvery5HotkeyBtn: '#cgpt-closed-loop-upload-every5-hotkey-btn',
    closedLoopUploadEveryRoundHotkeyBtn: '#cgpt-closed-loop-upload-every-round-hotkey-btn',
    closedLoopUploadEvery5Btn: '#cgpt-closed-loop-upload-every5-btn',
    /** @deprecated 旧 ID，迁移后指向 closedLoopUploadEvery5HotkeyBtn */
    copyHotkeyContinueLoopUploadVerifyBtn: '#cgpt-closed-loop-upload-every5-hotkey-btn',
    groupList: '#cgpt-upload-group-list',
    managePanel: '#cgpt-upload-manage-panel',
    manageGroupList: '#cgpt-upload-manage-group-list',
    groupNameInput: '#cgpt-upload-group-name-input',
    quickPrompts: '#cgpt-upload-quick-prompts',
  });

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

  const DEFAULT_BATCH_STOP_SIGNAL = typeof BATCH_TASK_DONE_SIGNAL === 'string'
    ? BATCH_TASK_DONE_SIGNAL
    : '<<<XZ_TOOLBOX_BATCH_TASK_STOP_7F3B9C>>>';
  // 旧停止符仅保留兼容解析，新逻辑只输出 DEFAULT_BATCH_STOP_SIGNAL。
  const LEGACY_BATCH_DONE_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';
  const LEGACY_BATCH_NO_MORE_CONTENT_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_NO_MORE_CONTENT_7F3B9C>>>';
  const LEGACY_BATCH_BLOCKED_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_BLOCKED_NEED_INPUT_7F3B9C>>>';
  const DEFAULT_BATCH_DONE_SIGNAL = DEFAULT_BATCH_STOP_SIGNAL;
  const DEFAULT_BATCH_BLOCKED_SIGNAL = LEGACY_BATCH_BLOCKED_SIGNAL;
  const DEFAULT_BATCH_NO_MORE_CONTENT_SIGNAL = LEGACY_BATCH_NO_MORE_CONTENT_SIGNAL;
  const DEFAULT_TASK_DONE_SIGNAL = DEFAULT_BATCH_STOP_SIGNAL;

  const DETAILED_CURSOR_MODIFICATION_INSTRUCTION_BLOCK = `
如果当前任务涉及代码修改、修复方案、重构建议、Bug 定位、UI 行为修复、状态同步、闭环控制、上传逻辑、按钮状态、Prompt 修改、日志排查、构建问题、测试问题、Cursor 修改建议或 Claude Code 修改建议，必须给出详细的 Cursor / Claude Code 修改指令。
Cursor / Claude Code 修改指令必须尽可能可直接粘贴执行，不能只写概要。至少需要包含：
1. 修改目标：
   - 明确这次要解决什么问题。
   - 明确用户看到的错误现象是什么。
   - 明确修改后的目标行为是什么。
2. 涉及文件：
   - 写出完整或相对文件路径。
   - 如果不确定路径，必须给出搜索关键词和可能所在模块。
   - 不要只写“相关文件”。
3. 具体定位：
   - 写出函数名、类名、变量名、常量名、DOM id、按钮 id、配置字段、状态字段或日志标签。
   - 如果涉及前端按钮或状态机，必须写出 action、data-action、button id、phase/state 字段。
   - 如果涉及后端或 Python，必须写出模块名、函数名、类名。
4. 修改前问题：
   - 说明当前逻辑为什么会出错。
   - 如果是状态不同步，要说明是哪几个状态源不一致。
   - 如果是异步/闭环/上传问题，要说明哪个阶段可能提前执行或重复执行。
5. 修改后逻辑：
   - 说明应该新增、替换或删除哪些逻辑。
   - 如果涉及状态机，必须写出状态流转顺序。
   - 如果涉及等待、轮询、上传、发送，必须写出前置条件和后置条件。
6. 代码要求：
   - 代码量不大时，直接给出完整修改后的函数或关键代码片段。
   - 代码量较大时，给出可直接粘贴给 Cursor 执行的分步修改指令。
   - 不要只说“增加判断”“优化逻辑”“完善日志”，必须写出判断条件、字段名、函数名和日志名。
7. 日志要求：
   - 如果涉及运行时行为，必须给出需要新增或修改的日志标签。
   - 日志应包含关键字段，例如 runId、round、phase、action、source、reason、count、groupId、delayMs、delaySec、error message。
   - 如果是异常，必须输出具体 error.message 或 stack 摘要。
8. 验证步骤：
   - 给出明确的手动验证步骤。
   - 给出预期日志。
   - 给出异常场景验证。
   - 如果需要构建，写出构建命令。
   - 如果需要测试，写出测试命令或最小复现步骤。
9. 边界条件：
   - 说明空输入、重复点击、页面刷新、后台恢复、网络延迟、上传失败、状态失效、旧配置迁移等边界情况。
   - 如果缺少源码、日志、构建结果、测试结果或用户确认，必须说明缺少什么，不能假装已经验证完成。
10. 输出格式：
   - 如果任务还没有完成，继续输出尚未完成的分析、代码或 Cursor 修改指令。
   - 不要重复之前已经输出过的内容。
   - 不要重新开始整个任务。
   - 不要扩展到无关任务。
   - 不要输出笼统建议，要输出可执行修改指令。
`;

  function hasDetailedCursorInstructionBlock(text) {
    const normalized = String(text || '');
    return (
      normalized.includes('Cursor / Claude Code 修改指令')
      || normalized.includes('Cursor 修改指令必须尽可能可直接粘贴执行')
      || normalized.includes('Claude Code 修改建议')
      || (
        normalized.includes('涉及文件')
        && normalized.includes('函数名')
        && normalized.includes('验证步骤')
        && normalized.includes('日志要求')
      )
    );
  }

  function appendDetailedCursorInstructionBlock(text) {
    const base = String(text || '').trim();
    if (!base) {
      return DETAILED_CURSOR_MODIFICATION_INSTRUCTION_BLOCK.trim();
    }
    if (hasDetailedCursorInstructionBlock(base)) {
      return base;
    }
    return [
      base,
      '',
      DETAILED_CURSOR_MODIFICATION_INSTRUCTION_BLOCK.trim(),
    ].join('\n');
  }

  function logPromptDetailCursorBlock(source, promptText) {
    if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.appendLog !== 'function') {
      return;
    }
    const prompt = String(promptText || '');
    const hasDetailed = hasDetailedCursorInstructionBlock(prompt);
    ToolboxShell.appendLog(
      `[PROMPT][DETAIL_CURSOR_BLOCK] source=${String(source || '-')} hasDetailed=${hasDetailed ? 1 : 0} len=${prompt.length}`,
    );
  }

  if (typeof window !== 'undefined') {
    window.DETAILED_CURSOR_MODIFICATION_INSTRUCTION_BLOCK = DETAILED_CURSOR_MODIFICATION_INSTRUCTION_BLOCK;
    window.appendDetailedCursorInstructionBlock = appendDetailedCursorInstructionBlock;
    window.hasDetailedCursorInstructionBlock = hasDetailedCursorInstructionBlock;
  }

  const LEGACY_BATCH_CONTINUE_PROMPT_TEMPLATE_V2 = `请继续完成上一个任务。

默认行为：继续输出剩余内容。

你必须优先判断“还有没有未输出完的内容”，而不是优先判断是否停止。

只有同时满足下面所有条件时，才允许停止：
1. 你能明确回忆并确认最开始的任务目标是什么。
2. 你能确认该目标的所有部分都已经完整覆盖。
3. 上一轮回答不是因为长度限制、网络中断、生成中断、代码块未闭合、列表未完成、编号未结束而停止。
4. 没有任何剩余文件、剩余检查项、剩余代码、剩余工具指令、剩余结论需要补充。
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

  const DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE_BASE = `请继续完成当前任务。

你必须先判断“最开始那个 Prompt 的任务目标”是否已经完整完成，而不是机械地继续，也不是机械地停止。

只允许两种结果：

1. 如果你非常确定最开始那个 Prompt 的任务目标已经完整完成，并且没有任何剩余内容、遗漏内容、未输出完的代码、未覆盖的文件、未完成的检查项或未完成的修改指令，只能回复下面这一行，不能有任何其他文字：
{{STOP_SIGNAL}}

2. 如果最开始那个 Prompt 的任务目标还没有完成，或者你无法确认它已经完整完成，不要输出任何终止符号，直接继续补充尚未完成、尚未输出、尚未覆盖的内容。

如果还缺少源码、日志、构建结果、测试结果、用户确认等外部材料，说明任务尚未进入可停止状态。此时不要输出终止符号，应继续说明缺少什么材料，或者继续补充当前能够完成的部分。

继续输出时必须遵守：
1. 不要重复之前已经输出过的内容。
2. 不要重新开始整个任务。
3. 不要扩展到新任务。
4. 只补充当前任务尚未完成、尚未输出、尚未覆盖的部分。
5. 如果上一轮回答像是被截断，请从中断位置继续。

不要使用 try/pass。如果必须捕获异常，必须打印或记录具体错误。`;

  const DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE = appendDetailedCursorInstructionBlock(
    DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE_BASE,
  );

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

  function isExactSingleLineBatchSignalText(text, signal) {
    const expected = String(signal || '').trim();
    const normalized = normalizeReplyText(text);
    if (!expected || !normalized) {
      return false;
    }
    const lines = normalized
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => String(line || '').trim())
      .filter(Boolean);
    return lines.length === 1 && lines[0] === expected;
  }

  function normalizeBatchSignalText(text) {
    return String(text || '')
      .replace(/\u200b/g, '')
      .replace(/\u200c/g, '')
      .replace(/\u200d/g, '')
      .replace(/\ufeff/g, '')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  function isExactBatchStopSignalText(text) {
    const raw = normalizeBatchSignalText(text);
    return raw === DEFAULT_BATCH_STOP_SIGNAL
      || raw === LEGACY_BATCH_DONE_SIGNAL
      || raw === LEGACY_BATCH_NO_MORE_CONTENT_SIGNAL
      || raw === LEGACY_BATCH_BLOCKED_SIGNAL;
  }

  function parseBatchStopSignal(text, source = '-') {
    const raw = normalizeBatchSignalText(text);
    if (raw === DEFAULT_BATCH_STOP_SIGNAL) {
      return {
        matched: true,
        terminal: true,
        shouldContinue: false,
        type: 'stop',
        reason: 'task-done-signal',
        signal: DEFAULT_BATCH_STOP_SIGNAL,
        legacy: false,
        source,
      };
    }
    if (
      raw === LEGACY_BATCH_DONE_SIGNAL
      || raw === LEGACY_BATCH_NO_MORE_CONTENT_SIGNAL
      || raw === LEGACY_BATCH_BLOCKED_SIGNAL
    ) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[AUTOQ][LEGACY_STOP_SIGNAL_COMPAT] signal=${raw} action=treat-as-model-stop source=${String(source || '-')}`,
        );
      }
      return {
        matched: true,
        terminal: true,
        shouldContinue: false,
        type: 'stop',
        reason: 'legacy-model-stop-signal',
        signal: raw,
        legacy: true,
        source,
      };
    }
    return {
      matched: false,
      terminal: false,
      shouldContinue: true,
      type: 'continue',
      reason: 'no-stop-signal',
      signal: '',
      legacy: false,
      source,
    };
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

  function classifyReplyState(replyText, isGenerating) {
    if (isGenerating === true) {
      return {
        type: 'generating',
        done: false,
        reason: 'assistant-generating',
      };
    }

    const text = normalizeReplyText(replyText);

    if (!text) {
      return {
        type: 'empty',
        done: false,
        reason: 'empty-reply',
      };
    }

    const stopParsed = parseBatchStopSignal(text, 'classifyReplyState');
    if (stopParsed.terminal) {
      return {
        type: 'stop',
        done: true,
        reason: stopParsed.reason,
        legacy: stopParsed.legacy,
        signal: stopParsed.signal,
      };
    }

    return {
      type: 'normal_reply_done',
      done: true,
      reason: 'reply-stopped-without-terminal-marker',
    };
  }

  function mapReplyStateToBatchDecision(replyState) {
    const stateType = replyState && replyState.type ? String(replyState.type) : 'continue';
    const reason = replyState && replyState.reason ? String(replyState.reason) : 'unknown-reply-state';

    if (stateType === 'stop' || stateType === 'done' || stateType === 'blocked' || stateType === 'no_more_content') {
      return {
        shouldStop: true,
        status: 'stop',
        reason,
      };
    }

    if (stateType === 'empty') {
      return {
        shouldStop: false,
        status: 'empty',
        reason,
      };
    }

    if (stateType === 'generating') {
      return {
        shouldStop: false,
        status: 'generating',
        reason,
      };
    }

    return {
      shouldStop: false,
      status: 'normal_reply_done',
      reason,
    };
  }

  function classifyBatchReply(replyText, options) {
    const isGenerating = options && typeof options === 'object' && options.isGenerating === true;
    if (options && typeof options === 'object' && Object.prototype.hasOwnProperty.call(options, 'isGenerating')) {
      return mapReplyStateToBatchDecision(classifyReplyState(replyText, isGenerating));
    }

    const text = normalizeReplyText(replyText);

    if (!text) {
      return {
        shouldStop: false,
        status: 'empty',
        reason: 'empty-reply',
      };
    }

    const stopParsed = parseBatchStopSignal(text, 'classifyBatchReply');
    if (stopParsed.terminal) {
      return {
        shouldStop: true,
        status: 'stop',
        reason: stopParsed.reason,
      };
    }

    return {
      shouldStop: false,
      status: 'normal_reply_done',
      reason: 'reply-stopped-without-terminal-marker',
    };
  }

  function repairCorruptedDoneSignalText(value, logFn) {
    const text = String(value || '').trim();

    if (!text) {
      return DEFAULT_BATCH_STOP_SIGNAL;
    }

    const knownGood = [
      DEFAULT_BATCH_STOP_SIGNAL,
      LEGACY_BATCH_DONE_SIGNAL,
      LEGACY_BATCH_NO_MORE_CONTENT_SIGNAL,
      LEGACY_BATCH_BLOCKED_SIGNAL,
      '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>',
      'CHATGPT_TOOLBOX_DONE',
      '__CHATGPT_TOOLBOX_DONE__',
      '<<<CHATGPT_TOOLBOX_DONE>>>',
      '<<<TASK_DONE>>>',
      'TASK_DONE',
    ];

    if (knownGood.includes(text)) {
      if (text !== DEFAULT_BATCH_STOP_SIGNAL && typeof logFn === 'function') {
        logFn(
          `[AUTOQ][TASK_SIGNAL][REPAIR_CORRUPTED] field=doneSignal oldLength=${text.length} new=${DEFAULT_BATCH_STOP_SIGNAL}`,
        );
      }
      return text === DEFAULT_BATCH_STOP_SIGNAL ? text : DEFAULT_BATCH_STOP_SIGNAL;
    }

    if (
      text.includes('XZ_TOOLBOX_BATCH_')
      || text.includes('TASK_DONE_7F3B9C')
      || text.length > 80
    ) {
      if (typeof logFn === 'function') {
        logFn(
          `[AUTOQ][TASK_SIGNAL][REPAIR_CORRUPTED] field=doneSignal oldLength=${text.length} new=${DEFAULT_BATCH_STOP_SIGNAL}`,
        );
      }
      return DEFAULT_BATCH_STOP_SIGNAL;
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

    if (
      normalized.includes('请继续完成当前任务')
      && normalized.includes('最开始那个 Prompt')
      && !hasDetailedCursorInstructionBlock(normalized)
    ) {
      return true;
    }

    if (
      normalized.includes('Cursor 修改指令')
      && !normalized.includes('函数名')
      && !normalized.includes('验证步骤')
    ) {
      return true;
    }

    if (
      normalized.includes('涉及代码修改')
      && !normalized.includes('Cursor / Claude Code 修改指令必须尽可能可直接粘贴执行')
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

    if (
      text.includes('请继续完成当前任务')
      && text.includes('最开始那个 Prompt')
      && !hasDetailedCursorInstructionBlock(text)
    ) {
      if (typeof logFn === 'function') {
        logFn(
          `[AUTOQ][TASK_PROMPT][MIGRATE_TO_DETAILED_CURSOR_TEMPLATE] field=${field} oldLength=${text.length}`,
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
    const rawTemplate = String(template || DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE);
    let safeTemplate = rawTemplate;
    if (!rawTemplate.trim()) {
      safeTemplate = DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
    } else if (isLegacyDefaultBatchContinuePromptTemplate(rawTemplate)) {
      safeTemplate = DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
    } else if (
      rawTemplate.includes('请继续完成当前任务')
      && rawTemplate.includes('最开始那个 Prompt')
      && !hasDetailedCursorInstructionBlock(rawTemplate)
    ) {
      safeTemplate = DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
    }
    const safeStopSignal = normalizeDoneSignal(doneSignal || DEFAULT_BATCH_STOP_SIGNAL);
    const rendered = safeTemplate
      .replaceAll('{{STOP_SIGNAL}}', safeStopSignal)
      .replaceAll('{{DONE_SIGNAL}}', safeStopSignal)
      .replaceAll('{{BLOCKED_SIGNAL}}', safeStopSignal)
      .replaceAll('{{NO_MORE_CONTENT_SIGNAL}}', safeStopSignal);
    logPromptDetailCursorBlock('renderContinuePromptTemplate', rendered);
    return rendered;
  }

  function getContinuePromptTemplateForDisplay(value, logFn, fieldName) {
    const text = String(value || '').trim();
    if (!text) {
      return DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE;
    }
    return repairCorruptedContinuePromptTemplate(text, logFn, fieldName || 'continuePromptTemplate');
  }

  function getDefaultBatchContinuePromptText() {
    return appendDetailedCursorInstructionBlock(DEFAULT_BATCH_CONTINUE_PROMPT_TEMPLATE);
  }

  function getDefaultTaskContinuePromptText() {
    return getDefaultBatchContinuePromptText();
  }

  function createDefaultTaskQueueSettings() {
    const settings = {
      stopOnMaxContinueRounds: true,
      defaultMaxContinueRoundsMigratedToUnlimited: false,
      appendTaskInputToInitialPrompt: false,
      skipFailedTasks: false,
      /** true = 每个任务完成后点击 ChatGPT 新聊天再发下一个；false = 在当前对话继续 */
      switchNewChatBetweenTasks: true,
      /** true = 批量任务每个任务开始前强制回主页/新会话（优先于 30 轮阈值） */
      forceHomeBeforeEachBatchTask: true,
      switchNewChatAfterAllDone: false,
      /** false = 单任务发送失败后继续下一个；true = 立即停止整个批量任务组 */
      stopBatchOnTaskSendFailure: false,
      verifyAfterDoneSignal: false,
      verifyAfterDoneSignalUploadFile: false,

      // 批量任务组：每 N 次对话自动上传一次文件
      taskAutoUploadEveryNMessagesEnabled: true,
      taskAutoUploadEveryNMessages: 5,
      taskAutoUploadCountInitialPrompt: true,
      taskAutoUploadCountContinuePrompt: true,
      taskAutoUploadCountVerifyPrompt: false,
      taskAutoUploadCountMode: 'assistantAnswer',

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

      // 批量任务：上传/消息额度不足时的等待策略
      // wait_until_available：一直等待额度恢复
      // stop_on_limit：额度满立即停止整个批量任务组
      // wait_max_then_stop：最多等待指定时间后停止
      taskQuotaWaitMode: 'wait_until_available',
      taskQuotaMaxWaitMinutes: 30,

      showRuntimeStats: true,
      preserveRuntimeStatsAverage: false,
      runtimeStatsRefreshIntervalMs: 1000,
      debugAutoQueueTrace: true,
      debugMode: false,
      advancedDebugAutoRefresh: false,
      advancedDebugRefreshIntervalMs: 1500,

      taskRelentlessSendRetryEnabled: true,
      taskRelentlessSendRetryIntervalMs: 1500,
      taskRelentlessSendRetryMaxIntervalMs: 10000,
      taskRelentlessSendRetryBackoffEnabled: true,

      /** 列表模式：单任务发送失败后继续下一个（默认开启） */
      listContinueOnTaskFailure: true,
      /** 列表模式：发送按钮找不到时尝试键盘发送兜底 */
      listEnableKeyboardSendFallback: true,
      /** 列表模式：单任务最大发送重试次数 */
      listMaxSendRetry: 3,
      /** 列表模式：单任务等待回复最长时间（毫秒），0 = 不限制 */
      listReplyWaitTimeoutMs: 0,
      /** 列表模式：等待发送按钮最长时间（毫秒） */
      listSendButtonWaitTimeoutMs: 60000,
      /** 列表模式：无进展检测时间（毫秒） */
      listNoProgressTimeoutMs: 300000,

      verifyAfterDoneSignalPrompt: [
        '这是一次“完成状态二次确认”，不是重新执行任务。',
        '已重新上传当前项目文件/附件，请结合附件、原始任务内容和上一轮助手回复判断当前任务是否真的已经完整完成。',
        '',
        '任务标题：{{taskTitle}}',
        '任务简述：{{taskBrief}}',
        '',
        '原始任务内容：',
        '{{taskContent}}',
        '',
        '上一轮助手回复：',
        '{{lastReply}}',
        '',
        '判断规则：',
        '1. 如果你确认任务已经完整完成，并且没有任何遗漏，只输出：{{doneSignal}}',
        '2. 如果仍有遗漏，不要输出终止符，直接继续补充缺失内容。',
        '3. 不要重复已经回答过的内容。',
        '4. 不要把这次确认当成重新执行整项任务。',
      ].join('\n'),
    };
    if (typeof getDefaultVerifyAfterDoneSignalPromptTemplate === 'function') {
      settings.verifyAfterDoneSignalPrompt = getDefaultVerifyAfterDoneSignalPromptTemplate();
    }
    return settings;
  }

  function createDefaultModeSettings() {
    return cloneDefaultModeSettings();
  }

  const DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL = DEFAULT_BATCH_STOP_SIGNAL;

  function getDefaultDoneSignal() {
    return DEFAULT_BATCH_STOP_SIGNAL;
  }

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
    return getDefaultBatchContinuePromptText();
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
      // 用户手动模式：不内置/不自动注入默认示例 Prompt
      listPromptsText: '',
      continuePromptsText: '',
      promptMode: 'continue',
      listProfiles: [],
      activeListProfileId: '',
      lastSelectedListProfileId: '',
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
    // 用户手动模式：不内置/不自动注入任何默认 Prompt（包括 math_once_one_by_one / 数字计算）
    return [];
  }











  const DEFAULT_PROMPT_CATEGORIES = Object.freeze([
    { id: 'default', name: '默认', order: 0 },
    { id: 'code', name: '代码', order: 1 },
    { id: 'paper', name: '论文', order: 2 },
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

  function findUploadGroupById(groupId) {
    const gid = String(groupId || '').trim();
    if (!gid) {
      return null;
    }
    const groups = Array.isArray(UploadGroupAppState.uploadGroups)
      ? UploadGroupAppState.uploadGroups
      : [];
    return groups.find((group) => group && group.id === gid) || null;
  }

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

