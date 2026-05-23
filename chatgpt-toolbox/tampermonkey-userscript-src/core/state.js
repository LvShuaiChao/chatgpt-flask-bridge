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
      'button[data-testid="send-button"]',
      'button[data-testid="composer-submit-button"]',
      'button#composer-submit-button',
      'button[aria-label="发送"]',
      'button[aria-label="发送消息"]',
      'button[aria-label="发送提示"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send prompt"]',
      'button[type="submit"]',
    ],
    stopButton: 'button[data-testid="stop-button"]',
    duplicateDialog: '[role="dialog"], [role="alertdialog"], [aria-modal="true"]',
  });

  const UploadSelectors = Object.freeze({
    module: '#cgpt-upload-module',
    list: '#cgpt-upload-list',
    startBtn: '#cgpt-upload-start',
    startSendBtn: '#cgpt-upload-start-send',
    copyContinueBtn: '#cgpt-upload-continue-once',
    sendHotkeyBtn: '#cgpt-send-hotkey-once',
    autoContinueBtn: '#cgpt-auto-continue-once',
    copyLastMessageBtn: '#cgpt-copy-last-message-scroll-bottom',
    copyHotkeyContinueOnceBtn: '#cgpt-copy-hotkey-continue-once',
    copyHotkeyContinueLoopBtn: '#cgpt-copy-hotkey-continue-loop',
    groupList: '#cgpt-upload-group-list',
    managePanel: '#cgpt-upload-manage-panel',
    manageGroupList: '#cgpt-upload-manage-group-list',
    groupNameInput: '#cgpt-upload-group-name-input',
    quickPrompts: '#cgpt-upload-quick-prompts',
  });

  const SettingsSelectors = Object.freeze({
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
    };
  }

  function createDefaultModeSettings() {
    return cloneDefaultModeSettings();
  }

  function createDefaultAutoConfig() {
    return {
      listPromptsText: '请先自我介绍一下\n请再用 3 点总结你能做什么',
      continuePromptsText: '继续',
      promptMode: 'continue',
      listProfiles: [],
      activeListProfileId: '',
      modeSettings: createDefaultModeSettings(),
    };
  }

  const DEFAULT_AUTO_CONFIG = Object.freeze(createDefaultAutoConfig());

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

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  function bindOnce(el, eventName, handler, fourth) {
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
    return EventBinder.on(el, eventName, handler, opts);
  }

