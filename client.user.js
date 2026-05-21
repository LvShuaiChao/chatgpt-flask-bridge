// ==UserScript==
// @name         ChatGPT 工具箱：多文件上传 + 自动指令队列 + Prompt 管理
// @namespace    https://github.com/xiaozhang/chatgpt-toolbox
// @version      3.6.6
// @description  一个统一工具箱面板：多文件队列上传、自动指令队列、Prompt 管理、标题前缀、对话导出与 issues 统计。每个功能独立模块，放到不同选项卡。?
// @author       小张
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://*.chat.openai.com/*
// @connect      *
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        unsafeWindow
// @grant        window.close
// @noframes
// @exclude      https://chatgpt.com/backend-api/*
// @exclude      https://*.chatgpt.com/backend-api/*
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

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
    copyLastMessageBtn: '#cgpt-copy-last-message-scroll-bottom',
    groupList: '#cgpt-upload-group-list',
    managePanel: '#cgpt-upload-manage-panel',
    manageGroupList: '#cgpt-upload-manage-group-list',
    groupNameInput: '#cgpt-upload-group-name-input',
    quickPrompts: '#cgpt-upload-quick-prompts',
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

  const DomUtil = (() => {
    function byId(root, selector, moduleName) {
      const el = qs(selector, root);

      if (!el) {
        console.error(`[ChatGPT toolbox] ${moduleName}: 缺少节点 ${selector}`);

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(`[${moduleName}][missing-dom] ${selector}`);
        }
      }

      return el;
    }

    function bindOnce(el, eventName, handler, key) {
      if (!el || !eventName || typeof handler !== 'function') {
        return false;
      }

      return EventBinder.on(el, eventName, handler, {
        key: key || eventName,
        moduleName: 'DomUtil',
      });
    }

    function bindClick(root, selector, handler, moduleName) {
      const el = byId(root, selector, moduleName);
      return bindOnce(el, 'click', handler, `click:${selector}`);
    }

    function bindChange(root, selector, handler, moduleName) {
      const el = byId(root, selector, moduleName);
      return bindOnce(el, 'change', handler, `change:${selector}`);
    }

    function bindInput(root, selector, handler, moduleName) {
      const el = byId(root, selector, moduleName);
      return bindOnce(el, 'input', handler, `input:${selector}`);
    }

    function setText(root, selector, value, moduleName) {
      const el = byId(root, selector, moduleName);
      if (!el) return false;
      el.textContent = String(value ?? '');
      return true;
    }

    function setValue(root, selector, value, moduleName) {
      const el = byId(root, selector, moduleName);
      if (!el) return false;
      el.value = String(value ?? '');
      return true;
    }

    function setChecked(root, selector, value, moduleName) {
      const el = byId(root, selector, moduleName);
      if (!el) return false;
      el.checked = !!value;
      return true;
    }

    function getValue(root, selector, fallback, moduleName) {
      const el = byId(root, selector, moduleName);
      if (!el) return fallback;
      return String(el.value ?? fallback ?? '');
    }

    function getChecked(root, selector, fallback, moduleName) {
      const el = byId(root, selector, moduleName);
      if (!el) return !!fallback;
      return !!el.checked;
    }

    return {
      bindOnce,
      bindClick,
      bindChange,
      bindInput,
      byId,
      setText,
      setValue,
      setChecked,
      getValue,
      getChecked,
    };
  })();

  function mountSingletonModule(options) {
    const {
      targetHost,
      moduleId,
      moduleName,
      html,
      onRefs,
      onBind,
      onRender,
      onAfterMount,
    } = options || {};

    if (!targetHost) {
      console.error(`[ChatGPT toolbox] ${moduleName}: targetHost 为空`);

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[${moduleName}][mount-failed] targetHost empty`);
      }

      return null;
    }

    let root = targetHost.querySelector(`#${moduleId}`);
    const reused = !!root;

    if (!root) {
      root = document.createElement('div');
      root.id = moduleId;
      root.innerHTML = html;
      targetHost.appendChild(root);
    }

    if (typeof onRefs === 'function') {
      onRefs(root, reused);
    }

    if (typeof onBind === 'function') {
      onBind(root, reused);
    }

    if (typeof onRender === 'function') {
      onRender(root, reused);
    }

    if (typeof onAfterMount === 'function') {
      onAfterMount(root, reused);
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(`[${moduleName}][mount] reused=${reused ? 1 : 0}`);
    }

    return root;
  }

  function normalizePromptCategoryName(item, fallback = '默认') {
    const category = typeof item === 'string'
      ? item
      : String(item && item.category ? item.category : '');
    const text = String(category || '').trim();
    return text || fallback;
  }

  function isEditableElement(target, options = {}) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;

    if (options.onlyToolbox === true && !el.closest(`#${APP.rootId}`)) {
      return false;
    }

    return !!el.closest([
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="textbox"]',
    ].join(','));
  }

  function qs(sel, root) {
    try {
      return (root || document).querySelector(sel);
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      console.error('[ChatGPT toolbox] querySelector failed', { sel, err });

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[DOM][qs-failed] selector=${String(sel || '-')} error=${errText}`);
      }

      return null;
    }
  }

  function qsa(sel, root) {
    try {
      return Array.from((root || document).querySelectorAll(sel));
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      console.error('[ChatGPT toolbox] querySelectorAll failed', { sel, err });

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[DOM][qsa-failed] selector=${String(sel || '-')} error=${errText}`);
      }

      return [];
    }
  }

  function storageKey(key) {
    return `${APP.storagePrefix}${key}`;
  }

  function readStorage(key, fallback) {
    return StorageKit.readJson(key, fallback, { scoped: true });
  }

  function writeStorage(key, value) {
    return StorageKit.writeJson(key, value, { scoped: true });
  }

  function readLocalJson(key, fallback, tag = '[STORAGE]') {
    return StorageKit.readJson(key, fallback, { scoped: false, tag });
  }

  function writeLocalJson(key, value, tag = '[STORAGE]') {
    return StorageKit.writeJson(key, value, { scoped: false, tag });
  }

  function clonePlainObject(value, fallback = null, tag = '[CLONE]') {
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(value);
      } catch (error) {
        console.warn(`[ChatGPT toolbox] ${tag} structuredClone failed`, error);
      }
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      const errText = getErrorText(error);
      console.warn(`[ChatGPT toolbox] ${tag} JSON clone failed`, error);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`${tag}[json-clone-failed] error=${errText}`);
      }

      return fallback;
    }
  }

  function readJsonFileFromInput(event, options = {}) {
    const tag = options.tag || '[JSON_IMPORT]';
    const file = event && event.target && event.target.files
      ? event.target.files[0]
      : null;

    if (!file) {
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        try {
          const raw = String(reader.result || '');
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        } finally {
          if (event.target) {
            event.target.value = '';
          }
        }
      };

      reader.onerror = () => {
        const error = reader.error || new Error('FileReader read failed');
        if (event.target) {
          event.target.value = '';
        }
        reject(error);
      };

      reader.readAsText(file, options.encoding || 'utf-8');
    }).catch((error) => {
      const errText = getErrorText(error);
      console.warn(`[ChatGPT toolbox] ${tag} read failed`, error);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`${tag}[read-failed] file=${file.name || '-'} error=${errText}`);
      }

      throw error;
    });
  }

  function debounceSave(fn, delay) {
    let timer = 0;

    return function debouncedSave(...args) {
      if (timer) {
        window.clearTimeout(timer);
      }

      timer = window.setTimeout(() => {
        fn(...args);
      }, delay);
    };
  }

  function bindClick(root, selector, handler, options = {}) {
    return EventBinder.bind(root, selector, 'click', (event, el) => {
      handler(event, el);
    }, {
      ...options,
      moduleName: options.moduleName || 'Module',
      required: options.required,
      missingLog: options.bindMissingLog,
      key: options.key || `click:${selector}`,
    });
  }

  function bindSettingChange(root, selector, handler, options = {}) {
    return EventBinder.bind(root, selector, 'change', handler, {
      ...options,
      moduleName: options.moduleName || 'SETTINGS',
      required: options.required === true,
      key: options.key || `change:${selector}`,
    });
  }

  function setButtonState(button, options = {}) {
    if (!button) return;

    const {
      text,
      title,
      disabled,
      addClasses,
      removeClasses,
      ariaDisabled,
    } = options || {};

    if (Array.isArray(removeClasses) && removeClasses.length) {
      button.classList.remove(...removeClasses);
    }

    if (Array.isArray(addClasses) && addClasses.length) {
      button.classList.add(...addClasses);
    }

    if (text != null) {
      button.textContent = text;
    }

    if (title != null) {
      button.title = title;
    }

    if (disabled != null) {
      const isCopyContinueBtn = button.id === 'cgpt-upload-continue-once';
      const effectiveDisabled = isCopyContinueBtn ? false : !!disabled;

      button.disabled = effectiveDisabled;

      if (!effectiveDisabled) {
        button.removeAttribute('disabled');
      }
    }

    if (ariaDisabled != null) {
      button.setAttribute('aria-disabled', ariaDisabled ? 'true' : 'false');
    }
  }

  function isWaitingAnswerVisualState(options = {}) {
    const text = String(options.text || options.buttonText || '').trim();
    const state = String(options.state || '').trim().toLowerCase();
    const responseState = String(
      options.responseState || options.response_state || '',
    ).trim().toLowerCase();

    if (options.copyLastMessageWaiting) {
      return true;
    }

    if (
      text === '等待回答'
      || /等待回复/.test(text)
      || /正在等待回复/.test(text)
      || text === '回答中'
      || /回答中/.test(text)
    ) {
      return true;
    }

    if (state === 'pending_reply' || state === 'generating') {
      return true;
    }

    if (responseState === 'pending_reply' || responseState === 'generating') {
      return true;
    }

    if (options.isResponding === true || options.is_responding === true) {
      return true;
    }

    return false;
  }

  function applyWaitingAnswerButtonStyle(button, waiting, options = {}) {
    if (!button) {
      return;
    }

    const styleClasses = [
      'danger',
      'primary',
      'success',
      'warning',
      'orange',
      'amber',
      'cgpt-waiting-answer',
    ];

    if (Array.isArray(options.extraRemoveClasses)) {
      options.extraRemoveClasses.forEach((name) => {
        const cls = String(name || '').trim();
        if (cls && !styleClasses.includes(cls)) {
          styleClasses.push(cls);
        }
      });
    }

    button.classList.remove(...styleClasses);

    if (waiting) {
      button.classList.add('danger', 'cgpt-waiting-answer');
      return;
    }

    const idleClass = String(options.idleClass || 'primary').trim() || 'primary';
    button.classList.add(idleClass);

    if (Array.isArray(options.extraIdleClasses)) {
      options.extraIdleClasses.forEach((name) => {
        const cls = String(name || '').trim();
        if (cls) {
          button.classList.add(cls);
        }
      });
    }
  }

  function createToolboxButton(text, options = {}) {
    const btn = document.createElement('button');

    btn.type = 'button';
    btn.textContent = String(text || '');

    const variant = String(options.variant || options.type || '').trim();

    const classes = ['cgpt-btn'];

    if (variant === 'primary') {
      classes.push('primary');
    }

    if (variant === 'danger') {
      classes.push('danger');
    }

    if (variant === 'small') {
      classes.push('small');
    }

    if (Array.isArray(options.classes)) {
      options.classes.forEach((name) => {
        const cls = String(name || '').trim();
        if (cls) {
          classes.push(cls);
        }
      });
    }

    btn.className = classes.join(' ');

    if (options.title != null) {
      btn.title = String(options.title);
    }

    if (options.disabled != null) {
      btn.disabled = !!options.disabled;
    }

    if (options.dataset && typeof options.dataset === 'object') {
      Object.entries(options.dataset).forEach(([key, value]) => {
        btn.dataset[key] = String(value);
      });
    }

    if (options.height != null) {
      btn.style.height = String(options.height);
    }

    if (options.padding != null) {
      btn.style.padding = String(options.padding);
    }

    return btn;
  }

  function buildUniqueName(baseName, existingNames) {
    const names = existingNames instanceof Set
      ? existingNames
      : new Set(existingNames || []);

    if (!names.has(baseName)) {
      return baseName;
    }

    let index = 2;
    let name = `${baseName}_${index}`;

    while (names.has(name)) {
      index += 1;
      name = `${baseName}_${index}`;
    }

    return name;
  }

  function normalizeEntityName(raw, maxLength = 24) {
    return String(raw || '').trim().slice(0, maxLength);
  }

  function getErrorText(error) {
    if (error == null) return 'unknown error';

    if (error instanceof Error && error.message) {
      return error.message;
    }

    if (typeof DOMException !== 'undefined' && error instanceof DOMException && error.message) {
      return error.message;
    }

    if (typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch (jsonError) {
        console.warn('[ChatGPT toolbox] stringify error object failed', jsonError);
        return Object.prototype.toString.call(error);
      }
    }

    return String(error);
  }

  function logError(tag, error, extra = '') {
    const errText = getErrorText(error);
    console.error(`[ChatGPT toolbox] ${tag}`, error);

    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`${tag}${extra ? ` ${extra}` : ''} error=${errText}`);
    }

    return errText;
  }

  const EventBinder = (() => {
    const registry = new WeakMap();

    function getSet(el) {
      let set = registry.get(el);

      if (!set) {
        set = new Set();
        registry.set(el, set);
      }

      return set;
    }

    function makeKey(eventName, key) {
      return `${String(eventName || '')}::${String(key || '')}`;
    }

    function on(el, eventName, handler, options = {}) {
      if (!el || !eventName || typeof handler !== 'function') {
        return false;
      }

      const bindKey = makeKey(eventName, options.key || eventName);
      const set = getSet(el);

      if (set.has(bindKey)) {
        return true;
      }

      set.add(bindKey);
      el.addEventListener(eventName, (event) => {
        try {
          handler(event, el);
        } catch (error) {
          const moduleName = options.moduleName || 'EventBinder';
          logError(`[${moduleName}][${eventName}-failed]`, error, options.key || '');
        }
      }, options.listenerOptions);

      return true;
    }

    function query(root, selector, options = {}) {
      const el = qs(selector, root);

      if (!el && options.required !== false) {
        const moduleName = options.moduleName || 'MODULE';
        const msg = options.missingLog || `[${moduleName}][bind-missing] ${selector}`;
        console.error(`[ChatGPT toolbox] ${msg}`);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(msg);
        }
      }

      return el;
    }

    function bind(root, selector, eventName, handler, options = {}) {
      const el = query(root, selector, options);
      if (!el) return null;

      on(el, eventName, handler, {
        ...options,
        key: options.key || `${eventName}:${selector}`,
      });

      return el;
    }

    return {
      on,
      bind,
      query,
    };
  })();

  const StorageKit = (() => {
    function fullKey(key, scoped = true) {
      return scoped ? storageKey(key) : String(key || '');
    }

    function readJson(key, fallback, options = {}) {
      const scoped = options.scoped !== false;
      const tag = options.tag || '[STORAGE]';
      const resolvedKey = fullKey(key, scoped);

      try {
        if (scoped && typeof GM_getValue === 'function') {
          const value = GM_getValue(resolvedKey, null);
          if (value != null) return value;
        }
      } catch (error) {
        logError(`${tag}[GM_getValue-failed]`, error, resolvedKey);
      }

      try {
        const raw = window.localStorage.getItem(resolvedKey);
        if (raw == null || raw === '') return fallback;

        const parsed = JSON.parse(raw);
        return parsed == null ? fallback : parsed;
      } catch (error) {
        logError(`${tag}[localStorage-read-failed]`, error, resolvedKey);
        return fallback;
      }
    }

    function writeJson(key, value, options = {}) {
      const scoped = options.scoped !== false;
      const tag = options.tag || '[STORAGE]';
      const resolvedKey = fullKey(key, scoped);

      try {
        if (scoped && typeof GM_setValue === 'function') {
          GM_setValue(resolvedKey, value);
          return true;
        }
      } catch (error) {
        logError(`${tag}[GM_setValue-failed]`, error, resolvedKey);
      }

      try {
        if (value == null) {
          window.localStorage.removeItem(resolvedKey);
        } else {
          window.localStorage.setItem(resolvedKey, JSON.stringify(value));
        }

        return true;
      } catch (error) {
        logError(`${tag}[localStorage-write-failed]`, error, resolvedKey);
        return false;
      }
    }

    return {
      readJson,
      writeJson,
    };
  })();

  async function copyWithStatus(options) {
    const {
      text,
      successText,
      successLog,
      successStatus,
      failedPrefix,
      failLog,
      failStatusPrefix,
      formatFailStatus,
      logPrefix,
      emptyText,
    } = options || {};

    const content = String(text ?? '');
    const resolvedSuccessStatus = successText || successStatus || successLog || '已复制';
    const resolvedSuccessLog = successLog || resolvedSuccessStatus;
    const resolvedFailPrefix = failedPrefix || failStatusPrefix || '复制失败';
    const resolvedLogPrefix = logPrefix || 'COPY';

    if (!content) {
      const msg = emptyText || '没有可复制的内容';
      ToolboxShell.setStatus(msg, 'warn');
      ToolboxShell.appendLog(`[${resolvedLogPrefix}][skip] reason=empty`);
      return false;
    }

    try {
      await copyTextToClipboard(content);
      ToolboxShell.setStatus(resolvedSuccessStatus, 'success');
      ToolboxShell.appendLog(`[${resolvedLogPrefix}][ok] chars=${content.length} ${resolvedSuccessLog}`);

      void playCopySuccessBeep(`copyWithStatus:${resolvedLogPrefix}`).catch((error) => {
        const errText = error && error.message ? error.message : String(error);
        console.warn('[ChatGPT toolbox] copyWithStatus beep failed', error);
        ToolboxShell.appendLog(`[BEEP][COPY_SUCCESS_FAILED] source=copyWithStatus:${resolvedLogPrefix} error=${errText}`);
      });

      return true;
    } catch (error) {
      const errText = getErrorText(error);
      const failTag = failLog || `[ChatGPT toolbox] ${resolvedFailPrefix}`;
      console.error(failTag, error);

      if (typeof formatFailStatus === 'function') {
        ToolboxShell.setStatus(formatFailStatus(errText), 'error');
      } else {
        ToolboxShell.setStatus(`${resolvedFailPrefix}：${errText}`, 'error');
      }

      ToolboxShell.appendLog(`[${resolvedLogPrefix}][failed] error=${errText}`);
      return false;
    }
  }

  function getDebugApiTarget() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  function registerToolboxDebugApi(name, fn, options = {}) {
    const fullName = String(name || '').startsWith('__cgpt')
      ? String(name)
      : `__cgptToolbox${String(name || '')}`;
    const target = options.target || getDebugApiTarget();

    if (typeof fn !== 'function') {
      console.error('[ChatGPT toolbox] registerToolboxDebugApi requires function', fullName);
      return;
    }

    if (target[fullName] && options.override !== true) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[DEBUG_API][skip-existing] ${fullName}`);
      }
      return;
    }

    target[fullName] = fn;

    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`[DEBUG_API][registered] ${fullName}`);
    }
  }

  function registerToolboxDebugApis(apiMap, options = {}) {
    Object.entries(apiMap || {}).forEach(([name, fn]) => {
      registerToolboxDebugApi(name, fn, options);
    });
  }

  function createModuleStatus(moduleName, options = {}) {
    const getLocalEl = options.getLocalEl || (() => null);
    const useGlobal = options.useGlobal !== false;
    const useLog = options.useLog !== false;
    let clearTimer = 0;

    function set(message, type = 'info', opts = {}) {
      const text = String(message || '').trim();
      const localEl = getLocalEl();

      if (localEl) {
        localEl.style.display = text ? '' : 'none';
        localEl.textContent = text;
        localEl.setAttribute('data-status-type', type || 'info');
      }

      if (useGlobal && text && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.setStatus === 'function') {
        ToolboxShell.setStatus(text, type, opts);
      }

      if (useLog && text && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[${moduleName}][STATUS][${type || 'info'}] ${text}`);
      }

      if (clearTimer) {
        window.clearTimeout(clearTimer);
        clearTimer = 0;
      }

      if (opts.timeoutMs && localEl) {
        clearTimer = window.setTimeout(() => {
          clearTimer = 0;
          if (localEl) {
            localEl.textContent = '';
            localEl.style.display = 'none';
          }
        }, opts.timeoutMs);
      }
    }

    function clear() {
      set('', 'info');
    }

    return {
      set,
      clear,
    };
  }

  function createTimerRegistry(moduleName) {
    const timers = new Map();
    const rafs = new Map();
    const intervals = new Map();

    function logTimerCleanupFailure(action, error) {
      const errText = getErrorText(error);
      console.warn(`[ChatGPT toolbox] ${moduleName}.timers ${action} failed`, error);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[${moduleName}][TIMERS][${action}-failed] error=${errText}`);
      }
    }

    function timeout(name, fn, delayMs) {
      clearTimeoutByName(name);

      const timerId = window.setTimeout(() => {
        timers.delete(name);
        try {
          fn();
        } catch (error) {
          logTimerCleanupFailure(`timeout:${name}`, error);
        }
      }, delayMs);

      timers.set(name, timerId);
      return timerId;
    }

    function clearTimeoutByName(name) {
      const timerId = timers.get(name);

      if (timerId) {
        window.clearTimeout(timerId);
        timers.delete(name);
      }
    }

    function raf(name, fn) {
      clearRaf(name);

      const rafId = window.requestAnimationFrame(() => {
        rafs.delete(name);
        try {
          fn();
        } catch (error) {
          logTimerCleanupFailure(`raf:${name}`, error);
        }
      });

      rafs.set(name, rafId);
      return rafId;
    }

    function clearRaf(name) {
      const rafId = rafs.get(name);

      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafs.delete(name);
      }
    }

    function interval(name, fn, delayMs) {
      clearIntervalByName(name);

      const intervalId = window.setInterval(fn, delayMs);
      intervals.set(name, intervalId);
      return intervalId;
    }

    function clearIntervalByName(name) {
      const intervalId = intervals.get(name);

      if (intervalId) {
        window.clearInterval(intervalId);
        intervals.delete(name);
      }
    }

    function clearAll() {
      timers.forEach((id) => {
        try {
          window.clearTimeout(id);
        } catch (error) {
          logTimerCleanupFailure('clear-timeout', error);
        }
      });

      rafs.forEach((id) => {
        try {
          window.cancelAnimationFrame(id);
        } catch (error) {
          logTimerCleanupFailure('clear-raf', error);
        }
      });

      intervals.forEach((id) => {
        try {
          window.clearInterval(id);
        } catch (error) {
          logTimerCleanupFailure('clear-interval', error);
        }
      });

      timers.clear();
      rafs.clear();
      intervals.clear();

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[${moduleName}][TIMERS][clear-all]`);
      }
    }

    function has(name, kind = 'timeout') {
      if (kind === 'raf') {
        return rafs.has(name);
      }

      if (kind === 'interval') {
        return intervals.has(name);
      }

      return timers.has(name);
    }

    return {
      timeout,
      clearTimeout: clearTimeoutByName,
      raf,
      clearRaf,
      interval,
      clearInterval: clearIntervalByName,
      clearAll,
      has,
    };
  }

  function collectDomRefs(root, schema, options = {}) {
    const moduleName = options.moduleName || 'MODULE';
    const refs = {};
    const missing = [];

    Object.entries(schema || {}).forEach(([name, item]) => {
      const selector = typeof item === 'string' ? item : item.selector;
      const required = typeof item === 'string' ? true : item.required !== false;
      const multiple = typeof item === 'object' && item.multiple === true;

      const value = multiple ? qsa(selector, root) : qs(selector, root);
      refs[name] = value;

      const empty = multiple ? !value.length : !value;

      if (empty && required) {
        missing.push(`${name}:${selector}`);
      }
    });

    if (missing.length) {
      console.error(`[ChatGPT toolbox] ${moduleName} DOM missing`, missing);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[${moduleName}][DOM_MISSING] ${missing.join(',')}`);
      }
    }

    return refs;
  }

  function validateDomRules(root, rules, options = {}) {
    const moduleName = options.moduleName || 'MODULE';

    (rules || []).forEach((rule) => {
      const type = rule.type;

      if (type === 'required') {
        const el = qs(rule.selector, root);

        if (!el) {
          if (rule.missingLog && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(rule.missingLog);
          } else {
            const msg = rule.message || `UploadModule DOM 错误：缺少 ${rule.selector}`;
            console.error(`[ChatGPT toolbox] ${msg}`);

            if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
              ToolboxShell.appendLog(`[${moduleName}][DOM_MISSING] ${rule.selector}`);
            }
          }
        }

        return;
      }

      if (type === 'notContains') {
        const parent = qs(rule.parent, root);
        const child = qs(rule.child, root);

        if (parent && child && parent.contains(child)) {
          const msg = rule.message || 'DOM invalid';
          console.error(`[ChatGPT toolbox] UploadModule DOM 错误：${msg}`);

          if (rule.invalidLog && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(rule.invalidLog);
          } else if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(`[${moduleName}][DOM_INVALID] ${msg}`);
          }
        }

        return;
      }

      if (type === 'order') {
        const before = qs(rule.before, root);
        const after = qs(rule.after, root);

        if (before && after) {
          const ok = !!(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);

          if (!ok) {
            const msg = rule.message || 'DOM order invalid';
            console.error(`[ChatGPT toolbox] UploadModule DOM 错误：${msg}`);

            if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
              ToolboxShell.appendLog(`[${moduleName}][DOM_ORDER_INVALID] ${msg}`);
            }
          }
        }
      }
    });
  }

  function clampNumber(value, fallback, min, max) {
    const n = Number(value);
    const safe = Number.isFinite(n) ? n : fallback;
    return Math.max(min, Math.min(safe, max));
  }

  function normalizeBySchema(input, schema) {
    const raw = input && typeof input === 'object' ? input : {};
    const output = {};

    Object.entries(schema || {}).forEach(([key, rule]) => {
      const value = raw[key];

      if (typeof rule.normalize === 'function') {
        output[key] = rule.normalize(value, raw);
        return;
      }

      if (value == null) {
        output[key] = rule.defaultValue;
        return;
      }

      output[key] = value;
    });

    return output;
  }

  const RouteChangeBus = (() => {
    let installed = false;
    let rawPushState = null;
    let rawReplaceState = null;
    let popstateHandler = null;
    const listeners = new Set();

    function emit(reason) {
      listeners.forEach((fn) => {
        try {
          fn(reason);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.error('[ChatGPT toolbox][ROUTE_CHANGE_BUS][listener-failed]', error);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(
              `[ROUTE_CHANGE_BUS][listener-failed] reason=${String(reason || '-')} error=${errText}`,
            );
          }
        }
      });
    }

    function onPopState() {
      window.setTimeout(() => emit('popstate'), 0);
    }

    function install() {
      if (installed) return;
      installed = true;

      rawPushState = history.pushState.bind(history);
      rawReplaceState = history.replaceState.bind(history);
      popstateHandler = onPopState;

      window.addEventListener('popstate', popstateHandler);

      history.pushState = function patchedToolboxPushState(...args) {
        const result = rawPushState.apply(this, args);
        window.setTimeout(() => emit('pushState'), 0);
        return result;
      };

      history.replaceState = function patchedToolboxReplaceState(...args) {
        const result = rawReplaceState.apply(this, args);
        window.setTimeout(() => emit('replaceState'), 0);
        return result;
      };
    }

    function subscribe(fn) {
      if (typeof fn !== 'function') {
        console.error('[ChatGPT toolbox][ROUTE_CHANGE_BUS] subscribe requires function');
        return () => {};
      }

      install();
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    return {
      subscribe,
    };
  })();

  let toolboxRoutePipelineRunning = false;

  async function runToolboxRouteChangePipeline(reason = '') {
    if (toolboxRoutePipelineRunning) {
      return;
    }

    toolboxRoutePipelineRunning = true;

    try {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.handleRouteChange === 'function') {
        await ToolboxShell.handleRouteChange(reason);
      }

      if (typeof BridgeModule !== 'undefined' && typeof BridgeModule.handleRouteChange === 'function') {
        await BridgeModule.handleRouteChange(reason);
      }
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[ChatGPT toolbox][ROUTE_PIPELINE] failed', error);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[ROUTE_PIPELINE][failed] reason=${reason || '-'} error=${errText}`);
      }
    } finally {
      toolboxRoutePipelineRunning = false;
    }
  }

  function installUnifiedRouteChangePipeline() {
    if (window.__cgptUnifiedRoutePipelineBound) {
      return;
    }

    window.__cgptUnifiedRoutePipelineBound = true;

    RouteChangeBus.subscribe((routeReason) => {
      window.setTimeout(() => {
        void runToolboxRouteChangePipeline(routeReason);
      }, 0);
    });

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog('[ROUTE_PIPELINE][bind] unified page-state + bridge identity');
    }
  }

  const MemoryManager = (() => {
    const KEYS = Object.freeze({
      toolboxTitle: 'toolboxTitle',
      panelHidden: 'panelHidden',
      panelPosition: 'panelPosition',
      panelSizeFull: 'panelSizeFull',
      panelSizeCompact: 'panelSizeCompact',
      compactMode: 'compactMode',
      uploadLastActiveGroupId: 'uploadLastActiveGroupId',
      lastManualUploadGroupId: 'lastManualUploadGroupId',
      uploadBlobPersistEnabled: 'uploadBlobPersistEnabled',
      uploadUseUniqueFileName: 'uploadUseUniqueFileName',
      uploadUseUniqueFileNameMigrated: 'uploadUseUniqueFileNameMigrated',
      autoQueueConfig: 'autoQueueConfig',
      promptManagerData: 'promptManagerData',
      promptManagerActiveCategory: 'promptManagerActiveCategory',
      promptManagerActiveSubtab: 'promptManagerActiveSubtab',
      logPersistEnabled: 'logPersistEnabled',
      logPersistLines: 'logPersistLines',
      compactUiConfig: 'compactUiConfig',
      edgeAutoHideEnabled: 'edgeAutoHideEnabled',
      edgeHidden: 'edgeHidden',
      edgeSide: 'edgeSide',
      activeTab: 'activeTab',
      hiddenTitlePosition: 'hiddenTitlePosition',
      shortcutConfig: 'shortcutConfig',
      beepConfig: 'beepConfig',
    });

    function get(key, fallback) {
      return readStorage(key, fallback);
    }

    function set(key, value) {
      return writeStorage(key, value);
    }

    function remove(key) {
      writeStorage(key, null);
    }

    if (!get(KEYS.uploadUseUniqueFileNameMigrated, false)) {
      if (get(KEYS.uploadUseUniqueFileName, null) == null) {
        set(KEYS.uploadUseUniqueFileName, true);
      }
      set(KEYS.uploadUseUniqueFileNameMigrated, true);
    }

    function getToolboxState() {
      return {
        toolboxTitle: get(KEYS.toolboxTitle, '小张工具箱'),
        panelHidden: !!get(KEYS.panelHidden, false),
        panelPosition: get(KEYS.panelPosition, null),
        panelSizeFull: get(KEYS.panelSizeFull, null),
        panelSizeCompact: get(KEYS.panelSizeCompact, null),
        compactMode: !!get(KEYS.compactMode, false),
        uploadBlobPersistEnabled: !!get(KEYS.uploadBlobPersistEnabled, true),
        logPersistEnabled: !!get(KEYS.logPersistEnabled, false),
        edgeAutoHideEnabled: get(KEYS.edgeAutoHideEnabled, false) === true,
        edgeHidden: !!get(KEYS.edgeHidden, false),
        edgeSide: get(KEYS.edgeSide, 'right'),
      };
    }

    function saveToolboxPatch(patch) {
      Object.keys(patch || {}).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(KEYS, key)) {
          console.warn('[ChatGPT toolbox] MemoryManager.saveToolboxPatch: unknown key', key);
          return;
        }

        set(KEYS[key], patch[key]);
      });
    }

    return {
      KEYS,
      get,
      set,
      remove,
      getToolboxState,
      saveToolboxPatch,
    };
  })();

  const TOOLBOX_PAGE_STATE_ROOT_KEY = 'cgpt_toolbox_page_state_v1';

  const TOOLBOX_STATE_FIELD_ALIASES = Object.freeze({
    activeTab: ['activeTab', 'active_tab'],
    uploadActiveGroupId: ['uploadActiveGroupId', 'upload_active_group_id'],
    quickPromptCategory: ['quickPromptCategory', 'quick_prompt_category', 'selectedQuickCategory'],
  });

  function readToolboxStateField(state, fieldName, fallback = '') {
    const src = state && typeof state === 'object' ? state : {};
    const keys = TOOLBOX_STATE_FIELD_ALIASES[fieldName] || [fieldName];

    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (!Object.prototype.hasOwnProperty.call(src, key)) {
        continue;
      }

      const value = src[key];
      if (value == null) {
        continue;
      }

      if (typeof value === 'string') {
        const text = value.trim();
        if (text) {
          return text;
        }
        continue;
      }

      return value;
    }

    return fallback;
  }

  function normalizeToolboxStatePatchForWrite(patch) {
    const input = patch && typeof patch === 'object' ? patch : {};
    const out = { ...input };

    const activeTab = readToolboxStateField(input, 'activeTab', '');
    if (activeTab) {
      out.activeTab = activeTab;
    }
    delete out.active_tab;

    const uploadActiveGroupId = readToolboxStateField(input, 'uploadActiveGroupId', '');
    if (uploadActiveGroupId) {
      out.uploadActiveGroupId = uploadActiveGroupId;
    }
    delete out.upload_active_group_id;
    delete out.uploadLastActiveGroupId;

    const quickPromptCategory = readToolboxStateField(input, 'quickPromptCategory', '');
    if (quickPromptCategory) {
      out.quickPromptCategory = quickPromptCategory;
    }
    delete out.quick_prompt_category;
    delete out.selectedQuickCategory;

    return out;
  }

  function parseConversationIdFromPath(pathname) {
    const path = String(pathname || '');
    const match = path.match(/\/c\/([^/?#]+)/);
    return match && match[1] ? match[1] : '';
  }

  const TOOLBOX_PAGE_INSTANCE_STORAGE_KEY = 'tm_toolbox_page_instance_id';

  function getToolboxPageInstanceId() {
    try {
      let id = sessionStorage.getItem(TOOLBOX_PAGE_INSTANCE_STORAGE_KEY);
      if (!id) {
        id = `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        sessionStorage.setItem(TOOLBOX_PAGE_INSTANCE_STORAGE_KEY, id);
      }
      return id;
    } catch (err) {
      return `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    }
  }

  function getToolboxPageKey() {
    return `page:${getToolboxPageInstanceId()}`;
  }

  function getToolboxConversationStateKey() {
    const conversationId = parseConversationIdFromPath(window.location.pathname || '');
    return conversationId ? `conversationState:${conversationId}` : '';
  }

  /** @deprecated 对话级状态已停用，仅保留空对象兼容读取。 */
  function readToolboxConversationState() {
    return {};
  }

  /** @deprecated 对话级状态已停用，不再写入。 */
  function saveToolboxConversationStatePatch(_patch, reason = '') {
    toolboxPageStateAppendLog(
      `[TOOLBOX_CONV_STATE][save-skip] reason=${reason || '-'} deprecated=conversation_state_disabled`,
    );
  }

  function getMergedToolboxApplyState() {
    return getToolboxPageState();
  }

  function toolboxPageStateAppendLog(text) {
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(text);
    }
  }

  function getToolboxPageBindingPatch() {
    const patch = {};
    const conversationId = parseConversationIdFromPath(window.location.pathname || '');

    if (conversationId) {
      patch.conversation_id = conversationId;
    }

    return patch;
  }

  function readAllToolboxPageStates() {
    const parsed = readLocalJson(TOOLBOX_PAGE_STATE_ROOT_KEY, {}, '[TOOLBOX_PAGE_STATE]');
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  }

  function writeAllToolboxPageStates(states) {
    const entries = Object.entries(states || {});
    entries.sort((a, b) => {
      const at = Number(a[1]?.updatedAt || 0);
      const bt = Number(b[1]?.updatedAt || 0);
      return bt - at;
    });
    const limited = Object.fromEntries(entries.slice(0, 80));
    writeLocalJson(TOOLBOX_PAGE_STATE_ROOT_KEY, limited, '[TOOLBOX_PAGE_STATE]');
  }

  function getToolboxPageState() {
    const pageKey = getToolboxPageKey();
    const states = readAllToolboxPageStates();
    const state = states[pageKey];
    if (!state || typeof state !== 'object') {
      return {};
    }
    return state;
  }

  function saveToolboxPageStatePatch(patch, reason = '') {
    const pageKey = getToolboxPageKey();
    const states = readAllToolboxPageStates();
    const oldState = states[pageKey] && typeof states[pageKey] === 'object'
      ? states[pageKey]
      : {};
    const bindingPatch = getToolboxPageBindingPatch();

    const normalizedPatch = normalizeToolboxStatePatchForWrite(patch || {});

    states[pageKey] = {
      ...oldState,
      ...normalizedPatch,
      ...bindingPatch,
      pageKey,
      page_instance_id: getToolboxPageInstanceId(),
      url: window.location.href,
      pathname: window.location.pathname,
      updatedAt: Date.now(),
    };

    writeAllToolboxPageStates(states);
    const activeTab = readToolboxStateField(states[pageKey], 'activeTab', '');
    const uploadActiveGroupId = readToolboxStateField(
      states[pageKey],
      'uploadActiveGroupId',
      readToolboxStateField(states[pageKey], 'upload_active_group_id', ''),
    );
    let compactModeFlag = false;
    try {
      if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.get === 'function') {
        compactModeFlag = !!MemoryManager.get(MemoryManager.KEYS.compactMode, false);
      }
    } catch (error) {
      toolboxPageStateAppendLog(
        `[TOOLBOX_TAB][SAVE][WARN] reason=compact_mode_read_failed error=${error && error.stack ? error.stack : String(error)}`,
      );
    }
    toolboxPageStateAppendLog(
      `[TOOLBOX_TAB][SAVE] reason=${reason || '-'} pageKey=${pageKey} activeTab=${activeTab || '-'} `
      + `uploadActiveGroupId=${uploadActiveGroupId || '-'} compactMode=${compactModeFlag ? 'true' : 'false'} `
      + `isApplyingToolboxPageState=${isApplyingToolboxPageState ? 'true' : 'false'} `
      + `fields=${Object.keys(patch || {}).join(',')}`,
    );
    toolboxPageStateAppendLog(
      `[TOOLBOX_PAGE_STATE][save] reason=${reason || '-'} pageKey=${pageKey} fields=${Object.keys(patch || {}).join(',')}`,
    );
  }

  let isApplyingToolboxPageState = false;
  let toolboxPageStateApplySeq = 0;

  function collectCurrentToolboxPageState() {
    const state = {};

    if (typeof UploadModule !== 'undefined' && typeof UploadModule.getStatus === 'function') {
      const status = UploadModule.getStatus();
      const groupId = String(status.activeGroupId || '').trim();
      if (groupId) {
        state.uploadActiveGroupId = groupId;
      }
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.getActiveTab === 'function') {
      state.activeTab = ToolboxShell.getActiveTab();
    }

    if (typeof UploadModule !== 'undefined' && typeof UploadModule.getQuickPromptActiveCategory === 'function') {
      state.quickPromptCategory = UploadModule.getQuickPromptActiveCategory();
    }

    state.pageKey = getToolboxPageKey();
    state.page_instance_id = getToolboxPageInstanceId();
    state.url = window.location.href;
    state.pathname = window.location.pathname;
    state.updatedAt = Date.now();

    return state;
  }

  function collectCurrentToolboxConversationState() {
    return {};
  }

  function collectCurrentToolboxBaseState() {
    return collectCurrentToolboxPageState();
  }

  function saveCurrentToolboxBaseState(reason = '') {
    if (isApplyingToolboxPageState) {
      toolboxPageStateAppendLog(
        `[TOOLBOX_PAGE_STATE][save-skip] reason=${reason || '-'} applying=true`,
      );
      return;
    }

    saveToolboxPageStatePatch(
      collectCurrentToolboxPageState(),
      reason || 'save-current-toolbox-page-state',
    );
  }

  function saveToolboxBaseStateForPageKey(pageKey, reason = '', meta = {}) {
    const key = String(pageKey || '').trim();

    if (!key) {
      toolboxPageStateAppendLog(
        `[TOOLBOX_PAGE_STATE][save-for-key-skip] reason=${reason || '-'} pageKey=empty`,
      );
      return;
    }

    if (isApplyingToolboxPageState) {
      toolboxPageStateAppendLog(
        `[TOOLBOX_PAGE_STATE][save-for-key-skip] reason=${reason || '-'} pageKey=${key} applying=true`,
      );
      return;
    }

    const patch = normalizeToolboxStatePatchForWrite(collectCurrentToolboxPageState());
    const states = readAllToolboxPageStates();
    const oldState = states[key] && typeof states[key] === 'object'
      ? states[key]
      : {};
    const metaObj = meta && typeof meta === 'object' ? meta : {};

    const nextState = {
      ...oldState,
      ...patch,
      pageKey: key,
      updatedAt: Date.now(),
    };

    if (reason === 'before-page-key-change') {
      nextState.url = metaObj.url || oldState.url || '';
      nextState.pathname = metaObj.pathname || oldState.pathname || '';
    } else {
      nextState.url = metaObj.url || oldState.url || patch.url || window.location.href;
      nextState.pathname = metaObj.pathname || oldState.pathname || patch.pathname || window.location.pathname;
    }

    states[key] = nextState;

    writeAllToolboxPageStates(states);
    toolboxPageStateAppendLog(
      `[TOOLBOX_PAGE_STATE][save-for-key] reason=${reason || '-'} pageKey=${key} fields=${Object.keys(patch || {}).join(',')}`,
    );
  }

  let lastToolboxPageKey = '';
  let lastToolboxConversationKey = '';


  const DEFAULT_COMPACT_UI_CONFIG = Object.freeze({
    showUploadGroups: true,
    showUploadStartButton: true,
    showUploadFileList: true,
    showUploadQuickPrompts: true,
    showCompactQuickPrompts: true,
    quickPromptIds: [],
    quickPromptClickAction: 'send',
    quickPromptActiveCategory: '全部',
    confirmPromptDraftOverwrite: false,
    globalDropCaptureEnabled: false,
    restoreScrollAfterCopyLastMessage: false,
  });

  function normalizeCompactUiConfig(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const cfg = Object.assign({}, DEFAULT_COMPACT_UI_CONFIG, raw);

    if (!raw.quickPromptActionVersion && raw.quickPromptClickAction === 'fill') {
      cfg.quickPromptClickAction = 'send';
      cfg.quickPromptActionVersion = 1;
    }

    cfg.quickPromptClickAction = cfg.quickPromptClickAction === 'fill' ? 'fill' : 'send';
    cfg.quickPromptActiveCategory = String(cfg.quickPromptActiveCategory || '全部').trim() || '全部';

    cfg.confirmPromptDraftOverwrite = cfg.confirmPromptDraftOverwrite === true;

    const hasUploadQuick = Object.prototype.hasOwnProperty.call(raw, 'showUploadQuickPrompts');
    const hasCompactQuick = Object.prototype.hasOwnProperty.call(raw, 'showCompactQuickPrompts');
    const hasLegacyQuick = Object.prototype.hasOwnProperty.call(raw, 'showQuickPrompts');

    if (!hasUploadQuick && hasLegacyQuick) {
      cfg.showUploadQuickPrompts = raw.showQuickPrompts !== false;
    }

    if (!hasCompactQuick && hasLegacyQuick) {
      cfg.showCompactQuickPrompts = raw.showQuickPrompts !== false;
    }

    cfg.showUploadQuickPrompts = cfg.showUploadQuickPrompts !== false;
    cfg.showCompactQuickPrompts = cfg.showCompactQuickPrompts !== false;
    cfg.restoreScrollAfterCopyLastMessage = cfg.restoreScrollAfterCopyLastMessage === true;

    if (!Array.isArray(cfg.quickPromptIds)) {
      cfg.quickPromptIds = [];
    }

    return cfg;
  }

  const DEFAULT_SHORTCUT_CONFIG = Object.freeze({
    sendMessage: {
      enabled: true,
      label: 'Ctrl+Enter',
      key: 'Enter',
      code: 'Enter',
      ctrl: true,
      alt: false,
      shift: false,
      meta: false,
    },
    copyLastMessage: {
      enabled: true,
      label: 'F8',
      key: 'F8',
      code: 'F8',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    },
    startUpload: {
      enabled: false,
      label: '',
      key: '',
      code: '',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    },
  });

  function cloneShortcutItem(item, fallback) {
    const src = item && typeof item === 'object' ? item : fallback;

    return {
      enabled: src.enabled !== false,
      label: String(src.label || ''),
      key: String(src.key || ''),
      code: String(src.code || ''),
      ctrl: !!src.ctrl,
      alt: !!src.alt,
      shift: !!src.shift,
      meta: !!src.meta,
    };
  }

  function getShortcutConfig() {
    const raw = MemoryManager.get(
      MemoryManager.KEYS.shortcutConfig,
      null,
    );

    return {
      sendMessage: cloneShortcutItem(
        raw && raw.sendMessage,
        DEFAULT_SHORTCUT_CONFIG.sendMessage,
      ),
      copyLastMessage: cloneShortcutItem(
        raw && raw.copyLastMessage,
        DEFAULT_SHORTCUT_CONFIG.copyLastMessage,
      ),
      startUpload: cloneShortcutItem(
        raw && raw.startUpload,
        DEFAULT_SHORTCUT_CONFIG.startUpload,
      ),
    };
  }

  function saveShortcutConfig(config) {
    MemoryManager.set(
      MemoryManager.KEYS.shortcutConfig,
      {
        sendMessage: cloneShortcutItem(config && config.sendMessage, DEFAULT_SHORTCUT_CONFIG.sendMessage),
        copyLastMessage: cloneShortcutItem(config && config.copyLastMessage, DEFAULT_SHORTCUT_CONFIG.copyLastMessage),
        startUpload: cloneShortcutItem(config && config.startUpload, DEFAULT_SHORTCUT_CONFIG.startUpload),
      },
    );
  }

  function resetShortcutConfig() {
    MemoryManager.set(
      MemoryManager.KEYS.shortcutConfig,
      {
        sendMessage: cloneShortcutItem(DEFAULT_SHORTCUT_CONFIG.sendMessage, DEFAULT_SHORTCUT_CONFIG.sendMessage),
        copyLastMessage: cloneShortcutItem(DEFAULT_SHORTCUT_CONFIG.copyLastMessage, DEFAULT_SHORTCUT_CONFIG.copyLastMessage),
        startUpload: cloneShortcutItem(DEFAULT_SHORTCUT_CONFIG.startUpload, DEFAULT_SHORTCUT_CONFIG.startUpload),
      },
    );
  }

  function isPureModifierKeyEvent(e) {
    const key = String(e.key || '').toLowerCase();
    const code = String(e.code || '').toLowerCase();

    return [
      'control',
      'ctrl',
      'shift',
      'alt',
      'meta',
      'os',
    ].includes(key) || [
      'controlleft',
      'controlright',
      'shiftleft',
      'shiftright',
      'altleft',
      'altright',
      'metaleft',
      'metaright',
      'osleft',
      'osright',
    ].includes(code);
  }

  function formatShortcutFromEvent(e) {
    const parts = [];

    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');

    let main = '';

    if (e.code === 'Space') {
      main = 'Space';
    } else if (e.code === 'NumpadEnter') {
      main = 'NumpadEnter';
    } else if (/^Key[A-Z]$/.test(e.code || '')) {
      main = String(e.code).replace(/^Key/, '').toUpperCase();
    } else if (/^Digit\d$/.test(e.code || '')) {
      main = String(e.code).replace(/^Digit/, '');
    } else if (/^F\d{1,2}$/i.test(e.key || '')) {
      main = String(e.key).toUpperCase();
    } else {
      main = e.key || e.code || '';
    }

    const lowerMain = String(main || '').toLowerCase();

    if (['control', 'ctrl', 'shift', 'alt', 'meta', 'os'].includes(lowerMain)) {
      main = '';
    }

    if (main) {
      parts.push(main);
    }

    return parts.join('+');
  }

  function shortcutItemFromEvent(e) {
    if (isPureModifierKeyEvent(e)) {
      return {
        enabled: true,
        label: '',
        key: '',
        code: '',
        ctrl: !!e.ctrlKey,
        alt: !!e.altKey,
        shift: !!e.shiftKey,
        meta: !!e.metaKey,
        pureModifier: true,
      };
    }

    return {
      enabled: true,
      label: formatShortcutFromEvent(e),
      key: String(e.key || ''),
      code: String(e.code || ''),
      ctrl: !!e.ctrlKey,
      alt: !!e.altKey,
      shift: !!e.shiftKey,
      meta: !!e.metaKey,
    };
  }

  function isShortcutEventMatched(e, item) {
    if (!item || item.enabled === false) {
      return false;
    }

    if (!item.key && !item.code) {
      return false;
    }

    if (!!e.ctrlKey !== !!item.ctrl) return false;
    if (!!e.altKey !== !!item.alt) return false;
    if (!!e.shiftKey !== !!item.shift) return false;
    if (!!e.metaKey !== !!item.meta) return false;

    const eventKey = String(e.key || '').toLowerCase();
    const eventCode = String(e.code || '').toLowerCase();
    const itemKey = String(item.key || '').toLowerCase();
    const itemCode = String(item.code || '').toLowerCase();

    return eventCode === itemCode || eventKey === itemKey;
  }

  function shortcutSignature(item) {
    if (!item || !item.enabled || (!item.key && !item.code)) {
      return '';
    }

    return [
      item.ctrl ? 'Ctrl' : '',
      item.alt ? 'Alt' : '',
      item.shift ? 'Shift' : '',
      item.meta ? 'Meta' : '',
      item.code || item.key || '',
    ].filter(Boolean).join('+').toLowerCase();
  }

  function findShortcutConflict(config, currentAction) {
    const current = config[currentAction];
    const sig = shortcutSignature(current);

    if (!sig) {
      return '';
    }

    return Object.keys(config).find((key) => {
      if (key === currentAction) return false;
      return shortcutSignature(config[key]) === sig;
    }) || '';
  }

  function applyUploadShortcutButtonTitles(rootEl) {
    const scope = rootEl || document;
    const shortcutCfg = getShortcutConfig();

    const uploadStartSendBtn = qs(UploadSelectors.startSendBtn, scope);
    if (uploadStartSendBtn) {
      const waitingSend = uploadStartSendBtn.classList.contains('cgpt-wait-send-cancel')
        || String(uploadStartSendBtn.textContent || '').trim() === '取消等待';

      uploadStartSendBtn.title = waitingSend
        ? '再次点击可取消等待发送'
        : `发送信息快捷键：${shortcutCfg.sendMessage.label || '未设置'}`;
    }

    const copyContinueBtn = qs(UploadSelectors.copyContinueBtn, scope);
    if (copyContinueBtn) {
      copyContinueBtn.title = '先复制最后回复，再发送“继续”';
    }

    const copyLastMessageBtn = qs(UploadSelectors.copyLastMessageBtn, scope) ;
    if (copyLastMessageBtn) {
      copyLastMessageBtn.title = `复制最后回复快捷键：${shortcutCfg.copyLastMessage.label || '未设置'}`;
    }

    const uploadStartBtn = qs(UploadSelectors.startBtn, scope);
    if (uploadStartBtn) {
      uploadStartBtn.title = `开始上传快捷键：${shortcutCfg.startUpload.label || '未设置'}`;
    }
  }

  function formatBytes(size) {
    const n = Number(size) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function pad3(n) {
    return String(n).padStart(3, '0');
  }

  function nowTimeText() {
    const d = new Date();
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function nowMs() {
    return Date.now();
  }

  function createId(prefix) {
    return `${prefix || 'id'}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeTimestamp(value, fallback = nowMs()) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function createBaseEntity(prefix, patch = {}) {
    const ts = nowMs();

    return {
      id: String(patch.id || createId(prefix || 'entity')),
      createdAt: normalizeTimestamp(patch.createdAt, ts),
      updatedAt: normalizeTimestamp(patch.updatedAt, ts),
    };
  }

  function normalizeNamedEntity(input, options = {}) {
    const prefix = options.prefix || 'entity';
    const fallbackName = options.fallbackName || '未命名';
    const maxNameLength = Number(options.maxNameLength) || 24;

    const base = createBaseEntity(prefix, input || {});
    const name = normalizeEntityName(
      input && input.name != null ? input.name : fallbackName,
      maxNameLength,
    ) || fallbackName;

    return {
      ...base,
      name,
    };
  }

  function buildUploadTimestamp() {
    const d = new Date();
    const rand = Math.random().toString(36).slice(2, 7);

    return [
      d.getFullYear(),
      pad2(d.getMonth() + 1),
      pad2(d.getDate()),
    ].join('') + '_' + [
      pad2(d.getHours()),
      pad2(d.getMinutes()),
      pad2(d.getSeconds()),
    ].join('') + '_' + pad3(d.getMilliseconds()) + '_' + rand;
  }

  function buildTimestampedFileName(fileName, tag) {
    const raw = String(fileName || 'file').replace(/^.*[/\\]/, '');
    const dot = raw.lastIndexOf('.');

    if (dot > 0) {
      return `${raw.slice(0, dot)}_${tag}${raw.slice(dot)}`;
    }

    return `${raw}_${tag}`;
  }

  function getObjectTag(value) {
    return Object.prototype.toString.call(value);
  }

  function isFileLike(value) {
    return !!(
      value &&
      (
        value instanceof File ||
        getObjectTag(value) === '[object File]'
      ) &&
      typeof value.name === 'string' &&
      typeof value.size === 'number'
    );
  }

  function isBlobLike(value) {
    return !!(
      value &&
      (
        value instanceof Blob ||
        getObjectTag(value) === '[object Blob]' ||
        getObjectTag(value) === '[object File]'
      ) &&
      typeof value.size === 'number' &&
      typeof value.slice === 'function'
    );
  }

  function normalizeToNativeFile(value, fallbackName) {
    if (value instanceof File) {
      return value;
    }

    if (value instanceof Blob) {
      return new File([value], fallbackName || 'upload.bin', {
        type: value.type || 'application/octet-stream',
        lastModified: Date.now(),
      });
    }

    if (isFileLike(value)) {
      return new File([value], value.name || fallbackName || 'upload.bin', {
        type: value.type || 'application/octet-stream',
        lastModified: Number(value.lastModified) || Date.now(),
      });
    }

    return null;
  }

  function isElementVisible(el) {
    if (!el) return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }

    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEditableTarget(target) {
    return isEditableElement(target);
  }

  function isInToolbox(el) {
    return !!(el && el.closest && el.closest(`#${APP.rootId}`));
  }

  function isChatGptNativeComposerTarget(target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;

    if (isInToolbox(el)) {
      return false;
    }

    return !!el.closest([
      '[data-testid="composer"]',
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '[data-testid="composer-textarea"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'form textarea',
      'form [contenteditable="true"]',
    ].join(','));
  }

  function shouldLetNativeChatGptHandleDrop(e) {
    if (!e || !e.target) return false;
    return isChatGptNativeComposerTarget(e.target);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function renderEmptyState(text, className = 'cgpt-empty-state') {
    return `<div class="${className}">${escapeHtml(text || '暂无数据')}</div>`;
  }

  function copyTextToClipboardByTextarea(text) {
    return new Promise((resolve, reject) => {
      const value = String(text || '');
      let ta = null;

      try {
        if (typeof window.focus === 'function') {
          window.focus();
        }

        ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.left = '12px';
        ta.style.top = '12px';
        ta.style.width = '1px';
        ta.style.height = '1px';
        ta.style.opacity = '0';
        ta.style.zIndex = '2147483647';

        document.body.appendChild(ta);

        ta.focus();
        ta.select();
        ta.setSelectionRange(0, value.length);

        const ok = document.execCommand('copy');

        if (!ok) {
          reject(new Error('document.execCommand("copy") returned false'));
          return;
        }

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[CLIPBOARD][textarea-copy-ok] chars=${value.length}`);
        }

        resolve(true);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] textarea fallback copy failed', err);
        console.error('[ChatGPT toolbox] textarea fallback copy failed', err);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[CLIPBOARD][textarea-copy-failed] error=${errText}`);
        }

        reject(err);
      } finally {
        if (ta && ta.parentNode) {
          ta.parentNode.removeChild(ta);
        }
      }
    });
  }

  function copyTextToClipboard(text) {
    const value = String(text || '');

    if (typeof GM_setClipboard === 'function') {
      try {
        GM_setClipboard(value, 'text');

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[CLIPBOARD][gm-set-ok] chars=${value.length}`);
        }

        return Promise.resolve(true);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] GM_setClipboard failed, fallback to browser clipboard', err);
        console.error('[ChatGPT toolbox] GM_setClipboard failed', err);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[CLIPBOARD][gm-set-failed] error=${errText}`);
        }
      }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(value).then(
        () => {
          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(`[CLIPBOARD][navigator-write-ok] chars=${value.length}`);
          }

          return true;
        },
        (err) => {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] navigator.clipboard.writeText failed, fallback to execCommand', err);
          console.error('[ChatGPT toolbox] navigator.clipboard.writeText failed', err);

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[CLIPBOARD][navigator-write-failed] error=${errText} focused=${document.hasFocus ? document.hasFocus() : '-'}`
            );
          }

          return copyTextToClipboardByTextarea(value);
        },
      );
    }

    return copyTextToClipboardByTextarea(value);
  }

  const DEFAULT_BEEP_CONFIG = Object.freeze({
    volume: 0.35,
    durationMs: 1000,
    frequency: 1000,
    type: 'sine',
    copySuccessEnabled: true,
    copySuccessCooldownMs: 800,
  });

  const BEEP_CONFIG_SCHEMA = Object.freeze({
    volume: {
      defaultValue: DEFAULT_BEEP_CONFIG.volume,
      normalize: (value) => clampNumber(value, DEFAULT_BEEP_CONFIG.volume, 0, 1),
    },
    durationMs: {
      defaultValue: DEFAULT_BEEP_CONFIG.durationMs,
      normalize: (value) => clampNumber(value, DEFAULT_BEEP_CONFIG.durationMs, 30, 10000),
    },
    frequency: {
      defaultValue: DEFAULT_BEEP_CONFIG.frequency,
      normalize: (value) => clampNumber(value, DEFAULT_BEEP_CONFIG.frequency, 80, 6000),
    },
    type: {
      defaultValue: DEFAULT_BEEP_CONFIG.type,
      normalize: (value) => {
        const allowed = new Set(['sine', 'square', 'sawtooth', 'triangle']);
        return allowed.has(String(value || '')) ? String(value) : DEFAULT_BEEP_CONFIG.type;
      },
    },
    copySuccessEnabled: {
      defaultValue: DEFAULT_BEEP_CONFIG.copySuccessEnabled,
      normalize: (value) => value !== false,
    },
    copySuccessCooldownMs: {
      defaultValue: DEFAULT_BEEP_CONFIG.copySuccessCooldownMs,
      normalize: (value) => clampNumber(
        value,
        DEFAULT_BEEP_CONFIG.copySuccessCooldownMs,
        0,
        10000,
      ),
    },
  });

  let beepAudioContext = null;
  let beepUnlocked = false;
  let documentBeepUnlockBound = false;

  async function waitBeepAudioRunning(audioCtx, reason = '', timeoutMs = 350) {
    if (!audioCtx) {
      return false;
    }

    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (audioCtx.state === 'running') {
        return true;
      }

      await sleep(30);
    }

    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(
        `[BEEP][WAIT_RUNNING_TIMEOUT] reason=${reason || '-'} state=${audioCtx.state}`,
      );
    }

    return audioCtx.state === 'running';
  }

  function normalizeBeepConfig(input) {
    return normalizeBySchema(input, BEEP_CONFIG_SCHEMA);
  }

  function getBeepConfig() {
    const raw = MemoryManager.get(MemoryManager.KEYS.beepConfig, null);
    const cfg = normalizeBeepConfig(raw);

    if (
      raw &&
      Number(raw.durationMs) === 120 &&
      Number(raw.frequency) === 880
    ) {
      cfg.durationMs = DEFAULT_BEEP_CONFIG.durationMs;
      cfg.frequency = DEFAULT_BEEP_CONFIG.frequency;
      MemoryManager.set(MemoryManager.KEYS.beepConfig, cfg);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[BEEP][MIGRATE_DEFAULTS] durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
        );
      }
    }

    return cfg;
  }

  function saveBeepConfig(next) {
    const cfg = normalizeBeepConfig(next || {});
    MemoryManager.set(MemoryManager.KEYS.beepConfig, cfg);
    return cfg;
  }

  function getBeepSettings() {
    const cfg = getBeepConfig();

    return {
      enabled: true,
      volume: cfg.volume,
      durationMs: cfg.durationMs,
      frequency: cfg.frequency,
      type: cfg.type,
      copySuccessEnabled: cfg.copySuccessEnabled !== false,
      copySuccessCooldownMs: Number(cfg.copySuccessCooldownMs) || 0,
    };
  }

  function mergeBeepPlaySettings(base, override) {
    if (!override || typeof override !== 'object') {
      return base;
    }

    const durationMs = Number.isFinite(Number(override.durationMs))
      ? Number(override.durationMs)
      : Number.isFinite(Number(override.duration))
        ? Math.round(Number(override.duration) * 1000)
        : base.durationMs;

    return {
      enabled: base.enabled,
      volume: Number.isFinite(Number(override.volume)) ? Number(override.volume) : base.volume,
      durationMs,
      frequency: Number.isFinite(Number(override.frequency)) ? Number(override.frequency) : base.frequency,
      type: override.type || base.type,
    };
  }

  function getBeepAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog('[BEEP][CONTEXT_SKIP] unsupported');
      }
      return null;
    }

    if (!beepAudioContext || beepAudioContext.state === 'closed') {
      beepAudioContext = new AudioContextClass();

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[BEEP][CONTEXT_CREATE] state=${beepAudioContext.state}`);
      }
    }

    return beepAudioContext;
  }

  async function unlockBeepAudio(reason = '') {
    const audioCtx = getBeepAudioContext();

    if (!audioCtx) {
      console.warn('[BEEP][UNLOCK_FAILED] AudioContext not supported reason=' + (reason || '-'));
      return false;
    }

    try {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      beepUnlocked = await waitBeepAudioRunning(audioCtx, reason || 'unlock');

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[BEEP][UNLOCK_OK] reason=${reason || '-'} state=${audioCtx.state} unlocked=${beepUnlocked ? 1 : 0}`,
        );
      }

      return beepUnlocked;
    } catch (error) {
      console.error('[BEEP][UNLOCK_FAILED] reason=' + (reason || '-'), error);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        const errText = error && error.message ? error.message : String(error);
        ToolboxShell.appendLog(`[BEEP][UNLOCK_FAILED] reason=${reason || '-'} error=${errText}`);
      }

      return false;
    }
  }

  const unlockToolboxAudio = unlockBeepAudio;

  function bindDocumentBeepAudioUnlock() {
    if (documentBeepUnlockBound) {
      return;
    }

    documentBeepUnlockBound = true;

    const unlockOnce = () => {
      void unlockBeepAudio('document-user-gesture');
    };

    document.addEventListener('pointerdown', unlockOnce, { once: true, capture: true });
    document.addEventListener('keydown', unlockOnce, { once: true, capture: true });

    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog('[BEEP][UNLOCK_BIND_DOCUMENT]');
    }
  }

  function bindToolboxAudioUnlockEvents(shellRoot) {
    bindDocumentBeepAudioUnlock();

    if (!(shellRoot instanceof HTMLElement)) {
      return;
    }

    if (shellRoot.dataset.audioUnlockBound === '1') {
      return;
    }

    shellRoot.dataset.audioUnlockBound = '1';

    const unlockOnce = () => {
      void unlockBeepAudio('toolbox-user-gesture');
    };

    shellRoot.addEventListener('pointerdown', unlockOnce, {
      capture: true,
    });

    shellRoot.addEventListener('keydown', () => {
      void unlockBeepAudio('toolbox-keyboard');
    }, true);

    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog('[BEEP][UNLOCK_BIND_TOOLBOX]');
    }
  }

  async function playBeepBySettings(reason = '', overrideConfig = null) {
    const settings = mergeBeepPlaySettings(getBeepSettings(), overrideConfig);

    if (!settings.enabled) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[BEEP][SKIP] reason=disabled source=${reason || '-'}`);
      }
      return false;
    }

    const audioCtx = getBeepAudioContext();

    if (!audioCtx) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[BEEP][FAILED] reason=no_audio_context source=${reason || '-'}`);
      }
      return false;
    }

    try {
      await unlockBeepAudio('play:' + (reason || '-'));

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      if (audioCtx.state !== 'running') {
        await sleep(60);

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
      }

      await waitBeepAudioRunning(audioCtx, 'play:' + (reason || '-'));

      if (audioCtx.state !== 'running') {
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BEEP][SKIP] reason=not_running state=${audioCtx.state} source=${reason || '-'}`,
          );
        }
        return false;
      }

      const now = audioCtx.currentTime;
      const durationSec = Math.max(0.03, Math.min(settings.durationMs, 2000) / 1000);
      const volume = Math.max(0, Math.min(settings.volume, 1));
      const frequency = Math.max(80, Math.min(settings.frequency, 6000));
      const waveType = settings.type || 'sine';

      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = waveType;
      oscillator.frequency.setValueAtTime(frequency, now);

      gainNode.gain.setValueAtTime(0.0001, now);
      gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start(now);
      oscillator.stop(now + durationSec + 0.03);

      oscillator.onended = () => {
        try {
          oscillator.disconnect();
          gainNode.disconnect();
        } catch (error) {
          console.warn('[BEEP][DISCONNECT_FAILED] source=' + (reason || '-'), error);
        }
      };

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[BEEP][PLAY_OK] source=${reason || '-'} volume=${volume} durationMs=${settings.durationMs} frequency=${frequency} type=${waveType}`,
        );
      }

      return true;
    } catch (error) {
      console.error('[BEEP][PLAY_FAILED] source=' + (reason || '-'), error);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        const errText = error && error.message ? error.message : String(error);
        ToolboxShell.appendLog(`[BEEP][PLAY_FAILED] source=${reason || '-'} error=${errText}`);
      }

      return false;
    }
  }

  const playToolboxBeep = playBeepBySettings;

  let lastCopySuccessBeepAt = 0;

  async function playCopySuccessBeep(reason = '', options = {}) {
    const cfg = getBeepConfig();
    const force = options && options.force === true;
    const ignoreCooldown = options && options.ignoreCooldown === true;

    if (cfg.copySuccessEnabled === false && !force) {
      ToolboxShell.appendLog(
        `[BEEP][COPY_SUCCESS_SKIP] reason=disabled source=${reason || '-'}`,
      );
      return false;
    }

    const now = Date.now();
    const cooldownMs = Number(cfg.copySuccessCooldownMs || 0);

    if (!ignoreCooldown && cooldownMs > 0 && now - lastCopySuccessBeepAt < cooldownMs) {
      ToolboxShell.appendLog(
        `[BEEP][COPY_SUCCESS_SKIP] reason=cooldown source=${reason || '-'} elapsed=${now - lastCopySuccessBeepAt}`,
      );
      return false;
    }

    lastCopySuccessBeepAt = now;

    try {
      const ok = await playBeepBySettings(`copy-success:${reason || '-'}`, {
        frequency: cfg.frequency,
        durationMs: cfg.durationMs,
        volume: cfg.volume,
        type: cfg.type,
      });

      ToolboxShell.appendLog(
        `[BEEP][COPY_SUCCESS_${ok ? 'OK' : 'FAILED'}] source=${reason || '-'} force=${force ? '1' : '0'} ignoreCooldown=${ignoreCooldown ? '1' : '0'}`,
      );

      return ok;
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.warn('[ChatGPT toolbox] copy success beep failed', error);
      ToolboxShell.appendLog(
        `[BEEP][COPY_SUCCESS_FAILED] source=${reason || '-'} error=${errText}`,
      );
      return false;
    }
  }

  function downloadTextFile(filename, text, mimeType) {
    const blob = new Blob([String(text || '')], {
      type: mimeType || 'text/plain;charset=utf-8',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  function downloadJsonFile(filename, data) {
    const text = JSON.stringify(data, null, 2);
    downloadTextFile(filename, text, 'application/json;charset=utf-8');
  }

  function buildDateStamp() {
    const d = new Date();
    return [
      d.getFullYear(),
      pad2(d.getMonth() + 1),
      pad2(d.getDate()),
    ].join('');
  }

  function buildDateTimeStamp() {
    const d = new Date();
    return [
      d.getFullYear(),
      pad2(d.getMonth() + 1),
      pad2(d.getDate()),
      '_',
      pad2(d.getHours()),
      pad2(d.getMinutes()),
      pad2(d.getSeconds()),
    ].join('');
  }

  const TitlePrefixModule = (() => {
    const PREFIX = 'ChatGPT - ';

    let started = false;
    let fixing = false;
    let titleObserver = null;
    let headObserver = null;
    let replyDoneFlashTimer = 0;
    let replyDoneFlashBaseTitle = '';
    let replyDoneFlashOn = false;

    function stripKnownPrefixes(value) {
      let text = String(value || '').trim();

      text = text
        .replace(/^\(\d+\)\s+/, '')
        .replace(/^\[\d+\]\s+/, '')
        .trim();

      while (text.startsWith(PREFIX)) {
        text = text.slice(PREFIX.length).trim();
      }

      text = text.replace(/^ChatGPT\s*[-—：]\s*/i, '').trim();

      return text;
    }

    function normalizeTitle(value) {
      const raw = String(value || '').trim();

      const issuePrefixMatch = raw.match(/^(\(\d+\)|\[\d+\])\s+/);
      const issuePrefix = issuePrefixMatch ? `${issuePrefixMatch[1]} ` : '';

      const body = stripKnownPrefixes(raw);

      if (!body) {
        return `${issuePrefix}ChatGPT`.trim();
      }

      if (body === 'ChatGPT') {
        return `${issuePrefix}ChatGPT`.trim();
      }

      return `${issuePrefix}${PREFIX}${body}`.trim();
    }

    function getRawDocumentTitleDescriptor() {
      const proto = Document.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'title');

      if (!desc || typeof desc.get !== 'function' || typeof desc.set !== 'function') {
        console.warn('[ChatGPT toolbox] Document.title descriptor unavailable');
        return null;
      }

      return desc;
    }

    function patchDocumentTitle() {
      const desc = getRawDocumentTitleDescriptor();
      if (!desc) return;

      Object.defineProperty(document, 'title', {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          return desc.get.call(document);
        },
        set(value) {
          const next = normalizeTitle(value);
          desc.set.call(document, next);
        },
      });
    }

    function fixTitle() {
      if (fixing) return;

      const titleEl = document.querySelector('title');

      if (titleEl && titleEl.textContent) {
        const next = normalizeTitle(titleEl.textContent);

        if (titleEl.textContent !== next) {
          fixing = true;
          titleEl.textContent = next;
          fixing = false;
        }

        return;
      }

      if (document.title) {
        const next = normalizeTitle(document.title);

        if (document.title !== next) {
          fixing = true;
          document.title = next;
          fixing = false;
        }
      }
    }

    function observeTitleNode() {
      if (titleObserver) {
        titleObserver.disconnect();
        titleObserver = null;
      }

      const titleEl = document.querySelector('title');
      if (!titleEl) return;

      titleObserver = new MutationObserver(() => {
        fixTitle();
      });

      titleObserver.observe(titleEl, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    function observeHead() {
      if (headObserver) {
        headObserver.disconnect();
        headObserver = null;
      }

      const target = document.head || document.documentElement;
      if (!target) return;

      headObserver = new MutationObserver(() => {
        observeTitleNode();
        fixTitle();
      });

      headObserver.observe(target, {
        childList: true,
        subtree: true,
      });
    }

    function start() {
      if (started) return;
      started = true;

      patchDocumentTitle();

      queueMicrotask(() => {
        fixTitle();
        observeTitleNode();
        observeHead();
      });

      window.setTimeout(() => {
        fixTitle();
        observeTitleNode();
        observeHead();
      }, 0);

      window.setTimeout(() => {
        fixTitle();
      }, 800);

      window.setInterval(() => {
        fixTitle();
      }, 1000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          stopReplyDoneFlash('visibility-visible');
        }
      }, true);

      document.addEventListener('pointerdown', () => {
        stopReplyDoneFlash('pointerdown');
      }, true);

      document.addEventListener('keydown', () => {
        stopReplyDoneFlash('keydown');
      }, true);
    }


    function applyIssueTotalToTitle(issueTotal) {
      const base = stripKnownPrefixes(document.title);
      const next = issueTotal > 0
        ? `(${issueTotal}) ${PREFIX}${base || 'ChatGPT'}`
        : `${PREFIX}${base || 'ChatGPT'}`;

      document.title = next;
      fixTitle();
    }

    function stopReplyDoneFlash(reason = '') {
      const wasActive = !!replyDoneFlashTimer || !!replyDoneFlashBaseTitle;

      if (replyDoneFlashTimer) {
        window.clearInterval(replyDoneFlashTimer);
        replyDoneFlashTimer = 0;
      }

      if (replyDoneFlashBaseTitle) {
        document.title = normalizeTitle(replyDoneFlashBaseTitle || 'ChatGPT');
      }

      replyDoneFlashBaseTitle = '';
      replyDoneFlashOn = false;

      if (wasActive && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[TITLE_FLASH][stop] reason=${reason || '-'}`);
      }
    }

    function startReplyDoneFlash(reason = '') {
      const currentBase = stripKnownPrefixes(document.title) || 'ChatGPT';
      const cleanBase = currentBase.replace(/^🔔\s*回复完成\s*[-:：]\s*/u, '').trim() || 'ChatGPT';

      stopReplyDoneFlash(`restart:${reason || '-'}`);

      replyDoneFlashBaseTitle = cleanBase;
      replyDoneFlashOn = false;

      const tick = () => {
        replyDoneFlashOn = !replyDoneFlashOn;
        document.title = replyDoneFlashOn
          ? `🔔 回复完成 - ${replyDoneFlashBaseTitle}`
          : replyDoneFlashBaseTitle;
      };

      tick();
      replyDoneFlashTimer = window.setInterval(tick, 900);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[TITLE_FLASH][start] reason=${reason || '-'} base=${replyDoneFlashBaseTitle}`);
      }
    }

    return {
      start,
      applyIssueTotalToTitle,
      startReplyDoneFlash,
      stopReplyDoneFlash,
    };
  })();

  /********************************************************************
   * 1. ToolboxShell：统一外壳
   ********************************************************************/

  const ToolboxShell = (() => {
    const TOOLBOX_DEFAULT_TITLE = '小张工具箱';
    const TOOLBOX_RESTORE_HANDLE_TITLE = '小张工具箱';

    let toolboxTitle = TOOLBOX_DEFAULT_TITLE;

    const VIEWPORT_SAFE_MARGIN = 8;
    const TOOLBOX_MIN_VISIBLE_WIDTH = 64;
    const TOOLBOX_MIN_VISIBLE_HEIGHT = 34;

    const PANEL_DEFAULT_SIZE = Object.freeze({
      width: 520,
      height: 500,
      minWidth: 300,
      minHeight: 240,
    });

    const PANEL_COMPACT_DEFAULT_SIZE = Object.freeze({
      width: 340,
      height: 280,
      minWidth: 280,
      minHeight: 180,
    });

    const PANEL_VIEWPORT_MARGIN = 8;

    // 只允许 1px 以内的浏览器小数误差，不能再把 8px/10px 当作贴边。
    const EDGE_DOCK_CONTACT_TOLERANCE = 1;
    const EDGE_CONTACT_EPSILON = 1;
    const EDGE_RESTORE_OFFSET = 24;
    const SHELL_EVENTS_VERSION = 'edge-hide-v7-panel-minimize-toggle-visibility';

    const EDGE_HANDLE_SIZE = Object.freeze({
      width: 110,
      height: 34,
    });

    const HIDDEN_TOGGLE_SIZE = Object.freeze({
      width: 38,
      height: 34,
    });

    // 自动隐藏只允许向右侧触发，禁止左侧/上侧/下侧触发隐藏。
    const EDGE_AUTO_HIDE_SIDE = 'right';
    const VALID_EDGE_SIDES = Object.freeze([EDGE_AUTO_HIDE_SIDE]);

    const TOOLBOX_FLOATING_HIDDEN_CLASS = 'cgpt-toolbox-floating-hidden';

    function isFloatingEdgeHidden() {
      return !!(root && (
        root.classList.contains('cgpt-edge-hidden')
        || root.classList.contains(TOOLBOX_FLOATING_HIDDEN_CLASS)
      ));
    }

    function setFloatingEdgeHidden(active, reason = '') {
      if (!root) {
        return;
      }

      const on = Boolean(active);
      root.classList.toggle('cgpt-edge-hidden', on);
      root.classList.toggle(TOOLBOX_FLOATING_HIDDEN_CLASS, on);

      if (on) {
        root.classList.add('cgpt-edge-right');
      } else {
        root.classList.remove('cgpt-edge-right');
      }
    }

    let edgeRestoreClickGuardUntil = 0;
    let edgeRevealTimer = 0;
    let edgeRehideGuardUntil = 0;
    let edgeAutoHideSuspendUntil = 0;
    let forceShowingUntil = 0;
    let isDraggingToolbox = false;
    let isResizingToolbox = false;

    const EDGE_HIDE_VISIBLE_SIZE = 18;

    let edgeHotzone = null;
    let edgeHotzoneHovering = false;
    const EDGE_REVEAL_HOTZONE_THICKNESS = 72;
    const EDGE_REVEAL_HOTZONE_EXTRA = 36;

    let restoreHotzone = null;
    let restoreHotzoneHoverTimer = 0;
    let restoreHandle = null;
    let lastPanelVisibleRect = null;

    const RESTORE_HOTZONE_WIDTH = 260;
    const RESTORE_HOTZONE_MIN_HEIGHT = 180;
    const RESTORE_HOTZONE_EXTRA = 48;
    const RESTORE_HOTZONE_HOVER_DELAY = 120;

    function getEdgeContactLimit() {
      return EDGE_DOCK_CONTACT_TOLERANCE;
    }

    function getRightEdgeDistance(rect) {
      if (!rect) return Number.POSITIVE_INFINITY;
      return window.innerWidth - rect.right;
    }

    function isAutoHideTriggerSide(side) {
      return String(side || '').trim() === EDGE_AUTO_HIDE_SIDE;
    }

    function isStrictlyTouchingEdge(rect, side) {
      if (!rect || !isAutoHideTriggerSide(side)) return false;

      const distance = getRightEdgeDistance(rect);

      // distance <= 1 表示已经贴住右边缘，或者轻微越界。
      // 不允许 8px、10px、36px 这种「靠近边缘」触发隐藏。
      return distance <= EDGE_CONTACT_EPSILON;
    }
    const DRAG_CLICK_THRESHOLD = 5;
    const TOGGLE_CLICK_SUPPRESS_MS = 100;

    let toggleDragState = null;
    let suppressToggleClick = false;
    let floatingTitleDragState = null;

    const VALID_TABS = Object.freeze(['upload', 'autoq', 'prompt', 'bridge', 'export', 'log', 'settings']);

    let root = null;
    let panel = null;
    let titleEl = null;
    let currentActiveTab = 'upload';
    let latestStatusText = '';
    let compactMode = false;
    let panelResizeObserver = null;
    let clampViewportTimer = 0;
    let viewportGuardBound = false;
    let creatingToolbox = false;
    let appendingLog = false;
    let toolboxWatchdogTimer = 0;
    let globalErrorGuardBound = false;
    let toolboxEnterSendLocked = false;
    let hiddenTitlePosition = null;
    let hiddenTitlePositionLocked = false;

    function addGlobalDraggingClass() {
      if (document.documentElement) {
        document.documentElement.classList.add('cgpt-toolbox-global-dragging');
      } else {
        console.warn('[ChatGPT toolbox] addGlobalDraggingClass: documentElement 不存在');
        appendLog('[TOOLBOX_DRAG][warn] documentElement 不存在');
      }

      if (document.body) {
        document.body.classList.add('cgpt-toolbox-global-dragging');
      } else {
        console.warn('[ChatGPT toolbox] addGlobalDraggingClass: document.body 不存在');
        appendLog('[TOOLBOX_DRAG][warn] document.body 不存在');
      }
    }

    function removeGlobalDraggingClass() {
      if (document.documentElement) {
        document.documentElement.classList.remove('cgpt-toolbox-global-dragging');
      }

      if (document.body) {
        document.body.classList.remove('cgpt-toolbox-global-dragging');
      }
    }

    function clearDragVisualState() {
      if (root) {
        root.classList.remove('cgpt-toolbox-dragging');
        root.style.transform = '';
      }

      removeGlobalDraggingClass();
    }

    function exitEdgeHiddenStateForDragStart() {
      if (root) {
        root.classList.remove(
          'cgpt-toolbox-edge-hidden',
          'cgpt-edge-hidden',
          'cgpt-toolbox-edge-revealed',
          'cgpt-edge-right',
        );

        root.removeAttribute('data-edge-side');
        delete root.dataset.edgeSide;
        root.style.transform = '';
      }

      if (edgeHotzone) {
        edgeHotzone.classList.remove('active');
        edgeHotzone.style.display = 'none';
      }

      MemoryManager.saveToolboxPatch({
        edgeHidden: false,
      });
    }

    function applyDragPosition(left, top, reason = '') {
      if (!root || !panel) return;

      if (isPanelVisibleNow()) {
        applyPanelPosition(left, top);
      } else {
        const safeLeft = Math.round(left);
        const safeTop = Math.round(top);

        root.style.left = `${safeLeft}px`;
        root.style.top = `${safeTop}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.transform = '';
      }

      appendLog(
        `[TOOLBOX_DRAG][dragging-position] left=${Math.round(left)} top=${Math.round(top)} reason=${reason || '-'} panelVisible=${isPanelVisibleNow() ? 1 : 0}`,
      );

      updateFloatingTitlePosition(reason || 'dragging');
    }

    function schedulePostDragLayout(work) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          work();
        });
        return;
      }

      window.setTimeout(work, 0);
    }

    /* ===== toolbox UI: styles ===== */
    const TOOLBOX_STYLE = `

        :root {
          --cgpt-color-primary-bg: #1d4ed8;
          --cgpt-color-primary-border: #3b82f6;
          --cgpt-color-success-bg: #166534;
          --cgpt-color-success-border: #22c55e;
          --cgpt-color-danger-bg: #dc2626;
          --cgpt-color-danger-border: #ef4444;
          --cgpt-color-warning-bg: #ea580c;
          --cgpt-color-warning-border: #f97316;
          --cgpt-color-border: #475569;
          --cgpt-color-panel-bg: #0f172a;
        }

        .cgpt-empty-state {
          padding: 10px 8px;
          color: #94a3b8;
          font-size: 12px;
          text-align: center;
        }

        #${APP.rootId} {
          position: fixed;
          left: 0;
          top: 0;
          right: auto;
          bottom: auto;
          width: 0;
          height: 0;
          z-index: 2147483647;
          font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #f2f2f2;
          pointer-events: none;
        }

        #${APP.rootId} #${APP.panelId},
        #${APP.rootId} #${APP.toggleId},
        #${APP.rootId} #cgpt-toolbox-floating-title {
          pointer-events: auto;
        }

        #${APP.rootId} * {
          box-sizing: border-box;
        }

        #${APP.rootId}.cgpt-toolbox-dragging {
          transition: none !important;
          will-change: left, top;
        }

        #${APP.rootId}.cgpt-toolbox-dragging #${APP.panelId} {
          box-shadow: none !important;
          transition: none !important;
          filter: none !important;
          background: #0f1115 !important;
        }

        #${APP.rootId}.cgpt-toolbox-dragging,
        #${APP.rootId}.cgpt-toolbox-dragging #${APP.panelId} {
          cursor: grabbing !important;
        }

        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-section,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-list,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-quick-prompts {
          box-shadow: none !important;
        }

        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-item:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-quick-prompt-chip:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-quick-prompt-group:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-toolbox-tab:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-btn:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-toolbox-small-btn:hover {
          background: inherit !important;
          border-color: inherit !important;
        }

        html.cgpt-toolbox-global-dragging,
        body.cgpt-toolbox-global-dragging {
          cursor: grabbing !important;
        }

        #${APP.toggleId} {
          display: none;
          align-items: center;
          justify-content: center;
          width: 38px;
          min-width: 38px;
          height: 34px;
          border: 1px solid #334155;
          background: #111827;
          color: #f8fafc;
          border-radius: 999px;
          padding: 0;
          cursor: grab;
          box-shadow: 0 6px 18px rgba(0,0,0,0.35);
          user-select: none;
          touch-action: none;
        }

        #${APP.rootId}.cgpt-toolbox-panel-hidden #${APP.toggleId},
        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.toggleId},
        #${APP.rootId}.cgpt-edge-hidden #${APP.toggleId} {
          display: none !important;
        }

        #${APP.rootId}.cgpt-toolbox-edge-revealed #${APP.toggleId} {
          display: none !important;
        }

        #${APP.toggleId}:active {
          cursor: grabbing;
        }

        #${APP.toggleId}:hover {
          background: #1f2937;
        }

        .cgpt-toolbox-toggle-icon {
          position: relative;
          display: block;
          width: 16px;
          height: 12px;
          border-top: 2px solid #f8fafc;
          border-bottom: 2px solid #f8fafc;
        }

        .cgpt-toolbox-toggle-icon::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 4px;
          border-top: 2px solid #f8fafc;
        }

        #${APP.rootId}.cgpt-edge-hidden,
        #${APP.rootId}.cgpt-toolbox-floating-hidden {
          transition: transform 160ms ease, opacity 160ms ease;
          opacity: 0.72;
        }

        #${APP.rootId}.cgpt-edge-hidden:hover,
        #${APP.rootId}.cgpt-toolbox-floating-hidden:hover {
          transform: none !important;
          opacity: 1;
        }

        #${APP.rootId}.cgpt-edge-hidden.cgpt-edge-right,
        #${APP.rootId}.cgpt-toolbox-floating-hidden.cgpt-edge-right {
          transform: translateX(calc(100% - ${EDGE_HIDE_VISIBLE_SIZE}px));
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden {
          transition: transform 160ms ease;
          opacity: 1;
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden.cgpt-edge-hidden {
          transform: none !important;
          opacity: 1;
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden[data-edge-side="right"] {
          transform: translateX(calc(100% - ${EDGE_HIDE_VISIBLE_SIZE}px));
        }

        #${APP.rootId}.cgpt-toolbox-edge-revealed {
          transition: left 160ms ease, top 160ms ease, transform 160ms ease;
          transform: none !important;
          opacity: 1 !important;
        }

        #${APP.rootId}.cgpt-toolbox-panel-hidden #${APP.panelId},
        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.panelId},
        #${APP.rootId}.cgpt-edge-hidden #${APP.panelId},
        #${APP.rootId}.cgpt-toolbox-floating-hidden #${APP.panelId} {
          display: none !important;
          pointer-events: none !important;
        }

        #${APP.rootId}.cgpt-toolbox-edge-revealed #${APP.panelId} {
          display: flex !important;
          pointer-events: auto !important;
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.toggleId},
        #${APP.rootId}.cgpt-edge-hidden #${APP.toggleId},
        #${APP.rootId}.cgpt-toolbox-floating-hidden #${APP.toggleId} {
          width: 38px;
          min-width: 38px;
          height: 34px;
          padding: 0;
          writing-mode: horizontal-tb;
          text-orientation: mixed;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          box-shadow: 0 8px 22px rgba(0,0,0,0.42);
          opacity: 0.92;
          pointer-events: auto;
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.toggleId}:hover,
        #${APP.rootId}.cgpt-edge-hidden #${APP.toggleId}:hover,
        #${APP.rootId}.cgpt-toolbox-floating-hidden #${APP.toggleId}:hover {
          opacity: 1;
        }

        #${APP.edgeHotzoneId} {
          position: fixed;
          z-index: 2147483646;
          display: none;
          pointer-events: none;
          background: transparent;
        }

        #${APP.edgeHotzoneId}.active {
          display: block;
          pointer-events: auto;
        }

        #${APP.restoreHotzoneId} {
          position: fixed;
          z-index: 2147483646;
          display: none;
          pointer-events: none;
          background: transparent;
        }

        #${APP.restoreHotzoneId}.active {
          display: block;
          pointer-events: auto;
        }

        #${APP.restoreHandleId} {
          position: fixed;
          z-index: 2147483647;
          display: none;
          right: 10px;
          top: 80px;
          height: 34px;
          max-width: 132px;
          padding: 0 12px;
          border: 1px solid #334155;
          border-radius: 999px;
          background: #111827;
          color: #f8fafc;
          font-size: 12px;
          font-weight: 700;
          box-shadow: 0 8px 22px rgba(0,0,0,0.42);
          cursor: pointer;
          white-space: nowrap;
          pointer-events: auto;
        }

        #${APP.restoreHandleId}.active {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
        }

        #${APP.restoreHandleId}:hover {
          background: #1d4ed8;
          border-color: #3b82f6;
        }

        #${APP.panelId} {
          display: flex;
          flex-direction: column;
          position: fixed;
          left: 80px;
          top: 80px;
          right: auto;
          bottom: auto;
          width: 520px;
          height: 500px;
          min-width: 300px;
          min-height: 240px;
          max-width: calc(100vw - 32px);
          max-height: calc(100vh - 82px);
          background: #0f1115;
          color: #f2f2f2;
          border: 1px solid #2f3542;
          border-radius: 14px;
          overflow: hidden;
          resize: none;
          box-shadow: 0 14px 36px rgba(0,0,0,0.42);
          pointer-events: auto;
        }

        .cgpt-resize-handle {
          position: absolute;
          z-index: 3;
          background: transparent;
        }

        .cgpt-resize-n {
          left: 12px;
          right: 12px;
          top: 0;
          height: 6px;
          cursor: ns-resize;
        }

        .cgpt-resize-s {
          left: 12px;
          right: 12px;
          bottom: 0;
          height: 6px;
          cursor: ns-resize;
        }

        .cgpt-resize-e {
          top: 12px;
          bottom: 12px;
          right: 0;
          width: 6px;
          cursor: ew-resize;
        }

        .cgpt-resize-w {
          top: 12px;
          bottom: 12px;
          left: 0;
          width: 8px;
          cursor: ew-resize;
        }

        .cgpt-resize-ne {
          right: 0;
          top: 0;
          width: 14px;
          height: 14px;
          cursor: nesw-resize;
        }

        .cgpt-resize-nw {
          left: 0;
          top: 0;
          width: 14px;
          height: 14px;
          cursor: nwse-resize;
        }

        .cgpt-resize-se {
          right: 0;
          bottom: 0;
          width: 16px;
          height: 16px;
          cursor: nwse-resize;
        }

        .cgpt-resize-sw {
          left: 0;
          bottom: 0;
          width: 14px;
          height: 14px;
          cursor: nesw-resize;
        }

        .cgpt-resize-se::after {
          content: "";
          position: absolute;
          right: 4px;
          bottom: 4px;
          width: 10px;
          height: 10px;
          opacity: 0.75;
          pointer-events: none;
          background:
            linear-gradient(135deg, transparent 0 45%, #64748b 45% 55%, transparent 55%),
            linear-gradient(135deg, transparent 0 65%, #64748b 65% 75%, transparent 75%);
        }

        #${APP.panelId}.cgpt-resizing {
          user-select: none;
        }

        #${APP.panelId}.cgpt-resizing * {
          user-select: none;
        }

        #${APP.panelId}.cgpt-toolbox-compact {
          width: 340px;
          min-width: 280px;
          min-height: 180px;
          max-height: calc(100vh - 82px);
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-tabs {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-page {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-page[data-page="upload"] {
          display: block !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header {
          height: 34px;
          flex-basis: 34px;
          padding: 0 8px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-title {
          font-size: 12px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-actions {
          gap: 5px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-small-btn {
          height: 24px;
          padding: 0 7px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-content {
          padding: 8px;
          overflow-y: auto;
          overflow-x: hidden !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-content,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-section,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] {
          overflow-x: hidden !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-section-title,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-hint {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-groups-head {
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-bar {
          display: grid !important;
          grid-template-columns: 1fr auto;
          gap: 5px;
          align-items: center;
          margin-top: 4px;
          margin-bottom: 6px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-list {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 5px;
          overflow-x: hidden !important;
          overflow-y: visible !important;
          padding-bottom: 0 !important;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-chip {
          flex: 0 0 auto;
          height: 26px;
          max-width: 92px;
          padding: 0 8px;
          font-size: 12px;
          border-radius: 999px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] #cgpt-upload-group-manage {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-upload-groups .cgpt-upload-groups-head {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-upload-start #cgpt-upload-start {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-file-list .cgpt-upload-list {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-quick-prompts .cgpt-upload-quick-prompts {
          display: none !important;
        }

        #cgpt-upload-module.compact-hide-quick-prompts .cgpt-upload-quick-prompts {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-section {
          padding: 8px;
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-list {
          max-height: 160px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-item {
          grid-template-columns: 1fr auto;
          gap: 6px;
          padding: 5px 6px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-actions-cell {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-name {
          font-size: 12px;
          line-height: 1.25;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-meta {
          font-size: 11px;
          line-height: 1.2;
          margin-top: 1px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-manage-panel {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-file-remove {
          display: inline-flex !important;
          width: 20px;
          height: 20px;
          min-width: 20px;
          padding: 0;
          font-size: 13px;
          line-height: 18px;
          border-radius: 999px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-settings-section,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-log,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-clear-log,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-delete,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-save-name,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-new,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-list-name-row,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-send-once {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-section {
          padding: 8px;
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-label {
          display: none;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-section-title,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-hint,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] #cgpt-prompt-manage-tools,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-preview,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] #cgpt-prompt-status {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-section {
          padding: 8px;
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-list {
          max-height: 220px;
          overflow-x: hidden;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-category-bar {
          gap: 5px;
          padding: 2px 0 6px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-category-chip {
          height: 24px;
          max-width: 86px;
          padding: 0 7px;
          font-size: 11px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-section-title,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-hint,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-stats-line,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-export-advanced,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-panel,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-prompts,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-stats {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-section {
          padding: 8px;
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="log"] .cgpt-log-advanced {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="log"] .cgpt-log-list {
          max-height: 220px;
        }

        .cgpt-toolbox-hidden {
          display: none !important;
        }

        .cgpt-toolbox-header {
          flex: 0 0 42px;
          height: 42px;
          padding: 0 10px 0 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          background: #111827;
          border-bottom: 1px solid #2f3542;
          cursor: move;
          user-select: none;
          touch-action: none;
        }

        .cgpt-toolbox-title {
          flex: 1 1 auto;
          min-width: 0;
          font-size: 13px;
          font-weight: 800;
          color: #f8fafc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.2px;
        }

        .cgpt-toolbox-header-actions {
          flex: 0 0 auto;
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .cgpt-toolbox-status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          max-width: 72px;
          height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.85);
          color: #cbd5e1;
        }

        .cgpt-toolbox-status-badge.cgpt-status-hidden {
          display: none !important;
        }

        #cgpt-toolbox-status-badge.cgpt-status-hidden {
          display: none !important;
        }

        #cgpt-prompt-status:empty {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-status-badge {
          display: none !important;
        }

        .cgpt-status-idle {
          background: rgba(30, 41, 59, 0.88);
          color: #cbd5e1;
          border-color: rgba(148, 163, 184, 0.35);
        }

        .cgpt-status-running {
          background: rgba(37, 99, 235, 0.22);
          color: #bfdbfe;
          border-color: rgba(96, 165, 250, 0.7);
        }

        .cgpt-status-danger {
          background: rgba(220, 38, 38, 0.92);
          color: #ffffff;
          border-color: #ef4444;
        }

        .cgpt-status-success,
        .cgpt-status-online {
          background: rgba(22, 163, 74, 0.22);
          color: #bbf7d0;
          border-color: rgba(74, 222, 128, 0.65);
        }

        .cgpt-status-warn,
        .cgpt-status-offline {
          background: rgba(202, 138, 4, 0.22);
          color: #fde68a;
          border-color: rgba(250, 204, 21, 0.65);
        }

        .cgpt-status-error {
          background: rgba(220, 38, 38, 0.22);
          color: #fecaca;
          border-color: rgba(248, 113, 113, 0.7);
        }

        .cgpt-toolbox-toast {
          position: absolute;
          left: 50%;
          top: 46px;
          transform: translateX(-50%) translateY(-8px);
          z-index: 20;
          min-width: 88px;
          max-width: calc(100% - 24px);
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          text-align: center;
          pointer-events: none;
          opacity: 0;
          transition: opacity 140ms ease, transform 140ms ease;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.96);
          color: #e5e7eb;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-toolbox-toast.show {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        .cgpt-toast-success,
        .cgpt-toast-online {
          background: rgba(22, 101, 52, 0.96);
          color: #dcfce7;
          border-color: rgba(74, 222, 128, 0.75);
        }

        .cgpt-toast-running {
          background: rgba(30, 64, 175, 0.96);
          color: #dbeafe;
          border-color: rgba(96, 165, 250, 0.75);
        }

        .cgpt-toast-danger {
          background: rgba(220, 38, 38, 0.96);
          color: #ffffff;
          border-color: rgba(239, 68, 68, 0.85);
        }

        .cgpt-toast-warn,
        .cgpt-toast-offline {
          background: rgba(133, 77, 14, 0.96);
          color: #fef3c7;
          border-color: rgba(250, 204, 21, 0.75);
        }

        .cgpt-toast-error {
          background: rgba(153, 27, 27, 0.96);
          color: #fee2e2;
          border-color: rgba(248, 113, 113, 0.8);
        }

        .cgpt-toolbox-small-btn {
          height: 26px;
          padding: 0 8px;
          border: 1px solid #475569;
          background: #1f2937;
          color: #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
        }

        .cgpt-toolbox-small-btn:hover {
          background: #273449;
        }

        .cgpt-toolbox-tabs {
          flex: 0 0 auto;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 10px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible;
          background: #0f1115;
          border-bottom: 1px solid #2f3542;
        }

        .cgpt-toolbox-tab {
          flex: 0 1 auto;
          min-width: 0;
          max-width: 120px;
          height: 32px;
          border: 1px solid #3f4655;
          background: #171b22;
          color: #d1d5db;
          border-radius: 9px;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-settings-prompt-list {
          margin-top: 8px;
          max-height: 260px;
          overflow-y: auto;
          border: 1px solid #2f3542;
          border-radius: 10px;
          padding: 8px;
          background: #0f1115;
        }

        .cgpt-settings-prompt-row {
          margin-bottom: 6px;
        }

        .cgpt-shortcut-settings {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
        }

        .cgpt-shortcut-row {
          display: grid;
          grid-template-columns: minmax(150px, 1.2fr) minmax(120px, 1fr) auto auto;
          gap: 8px;
          align-items: center;
        }

        #cgpt-toolbox-panel.cgpt-toolbox-compact .cgpt-shortcut-row {
          grid-template-columns: 1fr;
        }

        .cgpt-shortcut-row .cgpt-input {
          height: 30px;
        }

        .cgpt-upload-quick-prompts {
          margin-top: 12px;
          border: 1px solid #2f3542;
          background: #10151f;
          border-radius: 12px;
          padding: 10px;
        }

        .cgpt-upload-quick-prompts-title {
          font-weight: 700;
          color: #f8fafc;
          margin-bottom: 8px;
        }

        .cgpt-upload-quick-prompt-groups {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible;
          padding-bottom: 0;
          margin-bottom: 8px;
        }

        .cgpt-upload-quick-prompt-group {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          flex: 0 1 auto;
          min-width: 0;
          height: 26px;
          max-width: 150px;
          padding: 0 9px;
          border: 1px solid #475569;
          background: #171b22;
          color: #d1d5db;
          border-radius: 999px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-upload-quick-prompt-group:hover {
          background: #202633;
        }

        .cgpt-upload-quick-prompt-group.active {
          background: #22324a;
          border-color: #4b6b95;
          color: #dbeafe;
          font-weight: 650;
          box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.10);
        }

        .cgpt-upload-quick-prompts-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
        }

        .cgpt-upload-quick-prompt-chip {
          flex: 0 1 auto;
          min-width: 0;
          height: 30px;
          max-width: 150px;
          padding: 0 10px;
          border: 1px solid #475569;
          background: #171b22;
          color: #f8fafc;
          border-radius: 999px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-upload-quick-prompt-chip:hover {
          background: #1d4ed8;
          border-color: #60a5fa;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts {
          margin-top: 6px;
          padding: 6px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts-title {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-groups {
          gap: 5px;
          margin-bottom: 6px;
          overflow-x: hidden !important;
          overflow-y: hidden !important;
          padding-bottom: 0 !important;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-list::-webkit-scrollbar,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-groups::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-group {
          height: 24px;
          max-width: 78px;
          padding: 0 7px;
          font-size: 11px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts-list {
          gap: 5px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-chip {
          height: 26px;
          max-width: 110px;
          padding: 0 8px;
          font-size: 12px;
        }

        .cgpt-toolbox-tab:hover {
          background: #202633;
        }

        .cgpt-toolbox-tab.active {
          background: #22324a;
          border-color: #4b6b95;
          color: #dbeafe;
          font-weight: 650;
          box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.10);
        }

        .cgpt-toolbox-content {
          flex: 1 1 auto;
          min-height: 0;
          min-width: 0;
          overflow-y: auto;
          overflow-x: hidden !important;
          padding: 10px;
        }

        .cgpt-toolbox-page {
          display: none;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .cgpt-toolbox-page.active {
          display: block;
        }

        #${APP.rootId}[data-active-tab="log"] .cgpt-toolbox-content,
        #${APP.rootId}[data-active-tab="log"] .cgpt-toolbox-page[data-page="log"],
        #${APP.rootId}[data-active-tab="log"] #cgpt-log-tab-host {
          min-height: 0;
          overflow: hidden !important;
        }

        #${APP.rootId}[data-active-tab="log"] .cgpt-toolbox-page[data-page="log"].active {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        #${APP.rootId}[data-active-tab="log"] #cgpt-log-tab-host {
          display: flex;
          flex: 1 1 auto;
        }

        .cgpt-log-panel {
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
          gap: 8px;
        }

        .cgpt-log-actions {
          display: flex;
          flex: 0 0 auto;
          gap: 8px;
          align-items: center;
        }

        #cgpt-log-module {
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        #cgpt-log-module .cgpt-log-advanced {
          flex: 0 0 auto;
        }

        .cgpt-log-list {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto !important;
          overflow-x: hidden;
          border: 1px solid #2f3542;
          border-radius: 10px;
          background: #0f1115;
          padding: 8px;
          font-family: Consolas, "SFMono-Regular", monospace;
          font-size: 11px;
          color: #cbd5e1;
          white-space: pre-wrap;
        }

        #cgpt-log-module textarea {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto !important;
          resize: none;
        }

        .cgpt-log-line {
          padding: 3px 0;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }

        .cgpt-log-line:last-child {
          border-bottom: none;
        }

        .cgpt-log-empty {
          color: #94a3b8;
          text-align: center;
          padding: 18px 0;
        }

        .cgpt-section {
          border: 1px solid #2f3542;
          background: #141821;
          border-radius: 12px;
          padding: 10px;
          margin-bottom: 10px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .cgpt-section-title {
          font-weight: 700;
          margin-bottom: 8px;
          color: #f8fafc;
        }

        .cgpt-settings-subtabs {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin: 8px 0 10px;
          padding: 4px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          border: 1px solid #2f3542;
          background: #111827;
          border-radius: 10px;
        }

        .cgpt-settings-subtab {
          flex: 1 1 120px;
          min-width: 0;
          max-width: 100%;
          height: 30px;
          border: 1px solid #334155;
          background: #171b22;
          color: #cbd5e1;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-settings-subtab.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 700;
        }

        .cgpt-settings-panel {
          margin-top: 8px;
        }

        .cgpt-settings-panel .cgpt-section-title {
          margin-top: 10px;
        }

        .cgpt-row,
        .cgpt-log-actions,
        .cgpt-upload-action-row {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
          min-width: 0;
          max-width: 100%;
          flex-wrap: wrap;
          overflow-x: hidden;
        }

        .cgpt-prompt-actions {
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .cgpt-row > * {
          min-width: 0;
        }

        #${APP.panelId} input,
        #${APP.panelId} textarea,
        #${APP.panelId} select {
          min-width: 0;
          max-width: 100%;
        }

        .cgpt-btn {
          height: 32px;
          padding: 0 10px;
          border: 1px solid #475569;
          background: #1f2937;
          color: #f2f2f2;
          border-radius: 9px;
          cursor: pointer;
          white-space: nowrap;
        }

        .cgpt-btn.compact {
          height: 28px;
          padding: 0 8px;
        }

        .cgpt-btn:hover {
          background: #273449;
        }

        .cgpt-btn.primary {
          background: #1d4ed8;
          border-color: #3b82f6;
        }

        .cgpt-btn.primary:hover {
          background: #2563eb;
        }

        .cgpt-btn.danger,
        .cgpt-waiting-answer {
          background: #dc2626;
          border-color: #ef4444;
          color: #ffffff;
        }

        .cgpt-btn.danger:hover,
        .cgpt-waiting-answer:hover {
          background: #b91c1c;
          border-color: #f87171;
          color: #ffffff;
        }

        .cgpt-btn.success {
          background: #166534;
          border-color: #22c55e;
        }

        .cgpt-btn.success:hover {
          background: #15803d;
        }

        #cgpt-upload-start {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        #cgpt-upload-start:hover:not(:disabled) {
          background: #15803d !important;
        }

        #cgpt-upload-start:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .cgpt-upload-action-row {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        #cgpt-upload-start-send {
          background: #1d4ed8 !important;
          border-color: #3b82f6 !important;
          color: #ffffff !important;
        }

        #cgpt-upload-start-send:hover:not(:disabled) {
          background: #2563eb !important;
        }

        #cgpt-upload-start-send.cgpt-wait-send-cancel,
        #cgpt-upload-start-send.cgpt-wait-send-cancel:hover:not(:disabled) {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          cursor: pointer;
          opacity: 1;
        }

        #cgpt-upload-start-send:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        #cgpt-upload-continue-once,
        #cgpt-upload-continue-once.copy-continue,
        #cgpt-upload-continue-once.cgpt-btn-busy {
          background: #7c3aed !important;
          border-color: #a78bfa !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        #cgpt-upload-continue-once:hover {
          background: #8b5cf6 !important;
        }

        #cgpt-upload-continue-once[aria-disabled="true"] {
          background: #7c3aed !important;
          border-color: #a78bfa !important;
          color: #ffffff !important;
          opacity: 1 !important;
          cursor: default;
        }

        #cgpt-upload-continue-once.cgpt-btn-busy {
          box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.45);
        }

        #cgpt-copy-last-message-scroll-bottom {
          background: #1d4ed8 !important;
          border-color: #3b82f6 !important;
          color: #ffffff !important;
          pointer-events: auto !important;
          user-select: none !important;
          touch-action: manipulation !important;
        }

        #cgpt-copy-last-message-scroll-bottom[disabled] {
          pointer-events: auto !important;
        }

        #cgpt-copy-last-message-scroll-bottom:hover:not(:disabled) {
          background: #2563eb !important;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer,
        #cgpt-copy-last-message-scroll-bottom.danger {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer:hover:not(:disabled),
        #cgpt-copy-last-message-scroll-bottom.danger:hover:not(:disabled) {
          background: #b91c1c !important;
          border-color: #f87171 !important;
        }

        #cgpt-upload-continue-once.cgpt-waiting-answer,
        #cgpt-upload-continue-once.cgpt-waiting-answer.copy-continue,
        #cgpt-upload-continue-once.cgpt-waiting-answer.cgpt-btn-busy {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.45);
        }

        #cgpt-upload-continue-once.cgpt-waiting-answer:hover,
        #cgpt-upload-continue-once.cgpt-waiting-answer.copy-continue:hover {
          background: #b91c1c !important;
          border-color: #f87171 !important;
        }

        #cgpt-copy-last-message-scroll-bottom:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .cgpt-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .cgpt-input,
        .cgpt-textarea,
        .cgpt-select {
          width: 100%;
          background: #0f1115;
          color: #f8fafc;
          border: 1px solid #374151;
          border-radius: 9px;
          padding: 8px;
          outline: none;
        }

        .cgpt-textarea {
          resize: vertical;
          min-height: 110px;
          font-family: Consolas, "SFMono-Regular", monospace;
        }

        .cgpt-hint {
          color: #94a3b8;
          font-size: 12px;
          line-height: 1.5;
        }

        .cgpt-grid-4 {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }

        .cgpt-kv {
          display: grid;
          grid-template-columns: 92px 1fr;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
        }

        .cgpt-kv label {
          color: #cbd5e1;
          white-space: nowrap;
        }

        .cgpt-checkbox-line {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #cbd5e1;
        }

        .cgpt-checkbox-line input {
          width: 16px;
          height: 16px;
          accent-color: #60a5fa;
        }

        .cgpt-upload-groups-head {
          margin-bottom: 8px;
        }

        .cgpt-upload-group-bar {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 6px;
          align-items: center;
        }

        .cgpt-upload-group-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible;
          padding-bottom: 0;
        }

        .cgpt-chip-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-chip-count {
          margin-left: 4px;
          font-weight: 700;
          opacity: 0.95;
          flex: 0 0 auto;
        }

        .cgpt-upload-group-chip {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          flex: 0 1 auto;
          min-width: 0;
          height: 28px;
          padding: 0 10px;
          border: 1px solid #475569;
          background: #171b22;
          color: #d1d5db;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
          max-width: 140px;
          overflow: hidden;
        }

        .cgpt-upload-group-chip:hover {
          background: #202633;
        }

        .cgpt-upload-group-chip.active {
          background: #22324a;
          border-color: #4b6b95;
          color: #dbeafe;
          font-weight: 650;
          box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.10);
        }

        #cgpt-upload-module.cgpt-upload-dragging {
          outline: 1px dashed #60a5fa;
          outline-offset: -4px;
        }

        #${APP.panelId}.cgpt-toolbox-file-dragover {
          border-color: #60a5fa;
          box-shadow:
            0 0 0 2px rgba(96, 165, 250, 0.45),
            0 14px 36px rgba(0,0,0,0.42);
        }

        #${APP.panelId}.cgpt-toolbox-file-dragover .cgpt-toolbox-content {
          background: rgba(59, 130, 246, 0.06);
        }

        .cgpt-upload-list {
          max-height: 260px;
          overflow-y: auto;
          overflow-x: hidden;
          border: 1px solid #2f3542;
          border-radius: 12px;
          background: #0f1115;
          margin-top: 8px;
        }

        .cgpt-upload-list + .cgpt-upload-quick-prompts {
          margin-top: 12px;
        }

        .cgpt-upload-item {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          padding: 6px 8px;
          border-bottom: 1px solid #202633;
          cursor: pointer;
          align-items: center;
        }

        .cgpt-upload-item:last-child {
          border-bottom: none;
        }

        .cgpt-upload-item:hover {
          background: #172033;
        }

        .cgpt-upload-item.active {
          border-left: 3px solid #3b82f6;
          background: #111f36;
        }

        .cgpt-upload-item.cached-snapshot {
          background: rgba(239, 68, 68, 0.10);
          border-left: 3px solid rgba(248, 113, 113, 0.75);
        }

        .cgpt-upload-item.cached-snapshot:hover {
          background: rgba(239, 68, 68, 0.16);
        }

        .cgpt-upload-item.cached-snapshot.active {
          background: rgba(239, 68, 68, 0.18);
          border-left-color: #f87171;
        }

        .cgpt-upload-source-label.cached-source {
          color: #fecaca;
          font-weight: 700;
        }

        .cgpt-upload-file-rebind {
          margin-left: 8px;
          border: 1px solid rgba(248, 113, 113, 0.75);
          background: rgba(127, 29, 29, 0.28);
          color: #fee2e2;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 11px;
          line-height: 1.4;
          cursor: pointer;
        }

        .cgpt-upload-file-rebind:hover {
          background: rgba(185, 28, 28, 0.42);
          border-color: #fca5a5;
        }

        .cgpt-upload-item.empty {
          cursor: default;
        }

        .cgpt-upload-item.empty:hover {
          background: transparent;
        }

        .cgpt-upload-name {
          font-weight: 650;
          color: #f8fafc;
          word-break: break-all;
          font-size: 12px;
        }

        .cgpt-upload-meta {
          color: #94a3b8;
          margin-top: 2px;
          font-size: 11px;
        }

        .cgpt-upload-dot {
          margin: 0 4px;
        }

        .cgpt-upload-actions-cell {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
        }

        .cgpt-upload-file-remove {
          width: 22px;
          height: 22px;
          border: 1px solid #ef4444;
          background: #111827;
          color: #fecaca;
          border-radius: 999px;
          cursor: pointer;
          line-height: 18px;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .cgpt-upload-file-remove:hover {
          background: #991b1b;
          color: #ffffff;
        }

        .cgpt-upload-manage-panel {
          margin-top: 8px;
          padding: 8px;
          border: 1px solid #334155;
          border-radius: 10px;
          background: #10151f;
          max-height: 260px;
          overflow-y: auto;
        }

        .cgpt-upload-manage-title {
          font-weight: 700;
          color: #f8fafc;
          margin-bottom: 8px;
        }

        .cgpt-upload-manage-layout {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 8px;
          min-width: 0;
        }

        .cgpt-upload-manage-left,
        .cgpt-upload-manage-right {
          min-width: 0;
        }

        .cgpt-upload-manage-subtitle {
          font-size: 11px;
          color: #94a3b8;
          margin-bottom: 6px;
        }

        .cgpt-upload-manage-subtitle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 6px;
        }

        .cgpt-upload-manage-subtitle-row .cgpt-toolbox-small-btn {
          height: 24px;
          padding: 0 8px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .cgpt-upload-manage-group-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 180px;
          overflow-y: auto;
          border: 1px solid #2f3542;
          border-radius: 9px;
          background: #0f1115;
          padding: 6px;
        }

        .cgpt-upload-manage-group-item {
          width: 100%;
          min-height: 30px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 6px;
          align-items: center;
          border: 1px solid #374151;
          background: #171b22;
          color: #d1d5db;
          border-radius: 8px;
          padding: 0 8px;
          cursor: pointer;
          text-align: left;
        }

        .cgpt-upload-manage-group-item:hover {
          background: #202633;
        }

        .cgpt-upload-manage-group-item.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 650;
        }

        .cgpt-upload-manage-group-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-upload-manage-group-count {
          color: #cbd5e1;
          font-size: 11px;
          white-space: nowrap;
        }

        .cgpt-upload-manage-empty {
          color: #94a3b8;
          text-align: center;
          padding: 12px 0;
        }

        @media (max-width: 620px) {
          .cgpt-upload-manage-layout {
            grid-template-columns: 1fr;
          }

          .cgpt-upload-manage-group-list {
            max-height: 140px;
          }
        }

        .cgpt-upload-manage-row {
          display: flex;
          gap: 6px;
          align-items: center;
          margin-bottom: 8px;
        }

        .cgpt-upload-manage-row .cgpt-input {
          flex: 1 1 auto;
          min-width: 0;
        }

        .cgpt-upload-manage-row .cgpt-toolbox-small-btn {
          white-space: nowrap;
          flex-shrink: 0;
        }

        #cgpt-upload-group-rename-inline {
          min-width: 76px;
          flex: 0 0 76px;
          white-space: nowrap;
        }

        .cgpt-upload-common-settings {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #334155;
        }

        .cgpt-upload-common-settings .cgpt-checkbox-line {
          margin-top: 6px;
        }

        .cgpt-upload-common-settings .cgpt-hint {
          margin-top: 6px;
        }

        .cgpt-autoq-mode-tabs {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 8px;
        }

        .cgpt-autoq-mode-tab {
          height: 32px;
          border: 1px solid #475569;
          border-radius: 9px;
          background: #1f2937;
          color: #d1d5db;
          cursor: pointer;
          font-weight: 650;
        }

        .cgpt-autoq-mode-tab:hover {
          background: #202633;
        }

        .cgpt-autoq-mode-tab.active {
          border-color: #3b82f6;
          background: #1d4ed8;
          color: #fff;
        }

        .cgpt-autoq-list-header {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
        }

        .cgpt-autoq-list-name-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
        }

        #cgpt-autoq-list-save-name,
        #cgpt-autoq-list-delete,
        #cgpt-autoq-list-new {
          min-width: 76px;
          white-space: nowrap;
        }

        .cgpt-autoq-label {
          display: block;
          margin-bottom: 6px;
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 650;
        }

        .cgpt-autoq-editor-block #cgpt-autoq-prompts {
          width: 100%;
          min-height: 140px;
          max-height: 180px;
          resize: vertical;
        }

        .cgpt-autoq-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 10px;
        }

        #cgpt-autoq-start {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        #cgpt-autoq-start:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        #cgpt-autoq-stop {
          background: #991b1b !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        #cgpt-autoq-stop:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .cgpt-autoq-settings-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 12px;
          align-items: center;
        }

        .cgpt-autoq-settings-grid .cgpt-kv {
          grid-template-columns: 110px 1fr;
          margin-top: 0;
        }

        .cgpt-autoq-status-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px 10px;
          color: #cbd5e1;
          font-size: 12px;
        }

        .cgpt-autoq-status-recent {
          margin-top: 6px;
          color: #94a3b8;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-autoq-log {
          margin-top: 8px;
          max-height: 120px;
          min-height: 60px;
          overflow-y: auto;
          border: 1px solid #2f3542;
          border-radius: 10px;
          background: #0f1115;
          padding: 8px;
          font-family: Consolas, "SFMono-Regular", monospace;
          font-size: 11px;
          white-space: pre-wrap;
        }

        @media (max-width: 620px) {
          .cgpt-autoq-settings-grid {
            grid-template-columns: 1fr;
          }

          .cgpt-autoq-status-grid {
            grid-template-columns: 1fr;
          }
        }

        .cgpt-autoq-list-profile-chips {
          flex: 1 1 auto;
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 2px;
        }

        .cgpt-autoq-list-chip {
          height: 28px;
          padding: 0 10px;
          border: 1px solid #475569;
          background: #171b22;
          color: #d1d5db;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-autoq-list-chip:hover {
          background: #202633;
        }

        .cgpt-autoq-list-chip.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 650;
        }

        #cgpt-autoq-list-name {
          min-width: 0;
        }

        .cgpt-prompt-list {
          max-height: 360px;
          overflow-y: auto;
          border: 1px solid #2f3542;
          border-radius: 12px;
          background: #0f1115;
        }

        .cgpt-prompt-subtabs {
          display: flex;
          gap: 6px;
          margin-top: 10px;
          padding: 4px;
          border: 1px solid #2f3542;
          background: #111827;
          border-radius: 10px;
        }

        .cgpt-prompt-subtab {
          flex: 1;
          height: 30px;
          border: 1px solid #334155;
          background: #171b22;
          color: #cbd5e1;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
        }

        .cgpt-prompt-subtab.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 700;
        }

        .cgpt-prompt-panel {
          margin-top: 8px;
        }

        #cgpt-prompt-category-manager {
          margin-top: 0 !important;
        }

        .cgpt-prompt-item {
          border-bottom: 1px solid #202633;
          padding: 9px;
        }

        .cgpt-prompt-item:last-child {
          border-bottom: none;
        }

        .cgpt-prompt-title {
          font-weight: 700;
          color: #f8fafc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-prompt-meta {
          margin-top: 4px;
          color: #94a3b8;
          font-size: 12px;
        }

        .cgpt-prompt-category-bar,
        .cgpt-upload-quick-prompt-groups,
        .cgpt-upload-quick-prompts-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
        }

        .cgpt-prompt-category-bar {
          padding: 4px 0 8px;
          margin-top: 8px;
        }

        .cgpt-prompt-category-chip,
        .cgpt-upload-quick-prompt-group,
        .cgpt-upload-quick-prompt-chip {
          flex: 0 1 auto;
          min-width: 0;
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-prompt-category-chip {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          height: 28px;
          padding: 0 10px;
          border: 1px solid #475569;
          background: #171b22;
          color: #d1d5db;
          border-radius: 999px;
          cursor: pointer;
          font-size: 12px;
        }

        .cgpt-prompt-category-chip:hover {
          background: #202633;
        }

        .cgpt-prompt-category-chip.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 650;
        }

        .cgpt-prompt-category-edit-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
          margin-bottom: 10px;
        }

        .cgpt-prompt-category-manage-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 300px;
          overflow-y: auto;
        }

        .cgpt-prompt-category-manage-item {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 8px;
          align-items: center;
          border: 1px solid #2f3542;
          background: #0f1115;
          border-radius: 10px;
          padding: 8px;
        }

        .cgpt-prompt-category-manage-name {
          font-weight: 700;
          color: #f8fafc;
        }

        .cgpt-prompt-category-manage-meta {
          color: #94a3b8;
          font-size: 11px;
          margin-top: 2px;
        }

        .cgpt-prompt-category-manage-item button {
          white-space: nowrap;
        }

        @media (max-width: 620px) {
          .cgpt-prompt-category-edit-row {
            grid-template-columns: 1fr;
          }

          .cgpt-prompt-category-manage-item {
            grid-template-columns: 1fr;
          }
        }

        .cgpt-prompt-preview {
          margin-top: 5px;
          color: #cbd5e1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-prompt-actions {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 6px;
          margin-top: 8px;
          min-width: 0;
        }

        .cgpt-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          background: rgba(0, 0, 0, 0.42);
          display: none;
          align-items: center;
          justify-content: center;
        }

        .cgpt-modal {
          width: min(760px, calc(100vw - 36px));
          max-height: calc(100vh - 52px);
          background: #0f1115;
          color: #f8fafc;
          border: 1px solid #334155;
          border-radius: 14px;
          box-shadow: 0 16px 44px rgba(0,0,0,0.45);
          overflow: hidden;
        }

        .cgpt-modal-header {
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          background: #111827;
          border-bottom: 1px solid #2f3542;
          font-weight: 700;
          cursor: grab;
          user-select: none;
          touch-action: none;
        }

        .cgpt-modal-dragging,
        .cgpt-modal-dragging .cgpt-modal-header {
          cursor: grabbing !important;
        }

        .cgpt-modal-dragging {
          transition: none !important;
        }

        .cgpt-modal-body {
          padding: 12px;
          max-height: calc(100vh - 52px - 44px - 56px);
          overflow-y: auto;
        }

        .cgpt-modal-field {
          margin-bottom: 10px;
        }

        .cgpt-modal-field label {
          display: block;
          margin-bottom: 5px;
          color: #cbd5e1;
          font-weight: 650;
        }

        .cgpt-modal-actions {
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          background: #111827;
          border-top: 1px solid #2f3542;
          gap: 8px;
        }

        .cgpt-modal-actions-left,
        .cgpt-modal-actions-right {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        @media (max-width: 620px) {
          #${APP.panelId} {
            width: calc(100vw - 20px);
            max-width: calc(100vw - 20px);
            max-height: calc(100vh - 24px);
          }

          .cgpt-grid-4 {
            grid-template-columns: 1fr;
          }

          .cgpt-prompt-actions {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        /* 独立悬浮标题牌：正常展开时显示在面板上方 */
        #cgpt-toolbox-floating-title {
          position: fixed;
          z-index: 2147483647;
          display: none;
          align-items: center;
          justify-content: center;
          height: 28px;
          min-width: 96px;
          max-width: 220px;
          padding: 0 12px;
          border: 1px solid #334155;
          border-radius: 999px;
          background: #111827;
          color: #f8fafc;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
          user-select: none;
          cursor: grab;
          touch-action: none;
          pointer-events: auto;
        }

        #${APP.rootId}.cgpt-toolbox-dragging #cgpt-toolbox-floating-title {
          cursor: grabbing !important;
        }

        #${APP.rootId}:not(.cgpt-toolbox-panel-hidden):not(.cgpt-toolbox-edge-hidden):not(.cgpt-edge-hidden) #cgpt-toolbox-floating-title,
        #${APP.rootId}.cgpt-toolbox-edge-revealed:not(.cgpt-toolbox-panel-hidden):not(.cgpt-edge-hidden) #cgpt-toolbox-floating-title {
          display: inline-flex;
        }

        #${APP.rootId}.cgpt-toolbox-panel-hidden #cgpt-toolbox-floating-title,
        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #cgpt-toolbox-floating-title,
        #${APP.rootId}.cgpt-edge-hidden #cgpt-toolbox-floating-title {
          display: inline-flex !important;
        }

        #${APP.rootId}.cgpt-toolbox-dragging:not(.cgpt-toolbox-panel-hidden):not(.cgpt-toolbox-edge-hidden):not(.cgpt-edge-hidden) #cgpt-toolbox-floating-title {
          display: inline-flex !important;
        }

        #${APP.panelId} .cgpt-toolbox-header .cgpt-toolbox-title {
          display: none !important;
        }

        #${APP.panelId} .cgpt-toolbox-header {
          justify-content: flex-end !important;
        }

        #${APP.rootId}:not(.cgpt-toolbox-panel-hidden):not(.cgpt-toolbox-edge-hidden) #${APP.toggleId} {
          display: none !important;
        }

        #${APP.rootId}.cgpt-edge-hidden,
        #${APP.rootId}.cgpt-toolbox-edge-hidden {
          transform: none !important;
        }

        /* 工具箱内部禁止横向滚动（完整模式 + 精简模式） */
        #${APP.panelId},
        #${APP.panelId} .cgpt-toolbox-content,
        #${APP.panelId} .cgpt-toolbox-page,
        #${APP.panelId} .cgpt-section {
          max-width: 100%;
        }

        #${APP.panelId} {
          min-width: 300px;
          overflow: hidden;
        }

        #${APP.panelId} *,
        #${APP.panelId} *::before,
        #${APP.panelId} *::after {
          box-sizing: border-box;
        }
      
    `;

    function injectStyle() {
      const old = document.getElementById(APP.styleId);
      if (old) {
        old.remove();
      }
      const style = document.createElement('style');
      style.id = APP.styleId;
      style.textContent = TOOLBOX_STYLE;
      document.documentElement.appendChild(style);
    }

    function getViewportSize() {
      return {
        width: Math.max(320, window.innerWidth || document.documentElement.clientWidth || 320),
        height: Math.max(240, window.innerHeight || document.documentElement.clientHeight || 240),
      };
    }

    function normalizeRootFixedPosition() {
      if (!root) {
        return null;
      }

      const rect = root.getBoundingClientRect();
      const viewport = getViewportSize();

      let left = rect.left;
      let top = rect.top;
      let width = rect.width || EDGE_HANDLE_SIZE.width || 110;
      let height = rect.height || EDGE_HANDLE_SIZE.height || 34;

      if (!Number.isFinite(left)) left = viewport.width - width - VIEWPORT_SAFE_MARGIN;
      if (!Number.isFinite(top)) top = viewport.height - height - VIEWPORT_SAFE_MARGIN;
      if (!Number.isFinite(width) || width <= 0) width = EDGE_HANDLE_SIZE.width || 110;
      if (!Number.isFinite(height) || height <= 0) height = EDGE_HANDLE_SIZE.height || 34;

      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      };
    }

    function clampNumber(value, min, max) {
      const n = Number(value);
      const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
      const rawMax = Number.isFinite(Number(max)) ? Number(max) : safeMin;
      const safeMax = Math.max(safeMin, rawMax);

      if (!Number.isFinite(n)) {
        return safeMin;
      }

      return Math.min(Math.max(n, safeMin), safeMax);
    }

    function saveCurrentRootPosition(reason, options = {}) {
      if (panel && isPanelVisibleNow()) {
        savePanelPositionFromDom(reason || 'save-root-position-panel-visible');
        appendLog(`[TOOLBOX_POSITION][SAVE_ROOT_SKIP] reason=${reason || '-'} panelVisible=1 usePanelPosition=1`);
        return;
      }

      if (isPanelHiddenNow()) {
        if (!root) {
          return;
        }

        const rect = root.getBoundingClientRect();
        const left = Math.round(rect.left);
        const top = Math.round(rect.top);

        if (!Number.isFinite(left) || !Number.isFinite(top)) {
          appendLog(`[TOOLBOX_POSITION][SAVE_HIDDEN_SKIP] reason=${reason || '-'} invalid left/top`);
          return;
        }

        saveHiddenTitlePosition({ left, top }, reason || 'save-root-position-hidden');
        return;
      }

      if (!root) {
        return;
      }

      const rect = root.getBoundingClientRect();
      const left = Math.round(rect.left);
      const top = Math.round(rect.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        appendLog(`[TOOLBOX_POSITION][SAVE_SKIP] reason=${reason || '-'} invalid left/top`);
        return;
      }

      const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
      const mode = options.mode || 'left-top';

      const panelPosition = {
        ...saved,
        left,
        top,
        mode,
        edge: root && root.dataset ? (root.dataset.snapEdge || saved.edge || '') : (saved.edge || ''),
        updatedAt: Date.now(),
      };

      MemoryManager.saveToolboxPatch({
        panelPosition,
      });

      saveCurrentToolboxBaseState(reason || 'save-root-position');

      appendLog(`[TOOLBOX_POSITION][SAVE] reason=${reason || '-'} left=${left} top=${top} mode=${mode}`);
    }

    function clampRootToViewport(reason, options) {
      if (panel && isPanelVisibleNow()) {
        keepPanelInViewport({
          save: options && options.save === true,
        });
        appendLog(`[TOOLBOX_POSITION][CLAMP_ROOT_SKIP] reason=${reason || '-'} panelVisible=1 usePanelClamp=1`);
        return false;
      }

      if (!root) {
        return false;
      }

      const opts = options || {};
      const allowEdgeHidden = opts.allowEdgeHidden !== false;
      const saveAfterClamp = opts.save !== false;
      const rect = normalizeRootFixedPosition();

      if (!rect) {
        return false;
      }

      const isEdgeHiddenNow = root.classList.contains('cgpt-toolbox-edge-hidden')
        || root.classList.contains('cgpt-edge-hidden');

      let minLeft = VIEWPORT_SAFE_MARGIN;
      let minTop = VIEWPORT_SAFE_MARGIN;
      let maxLeft = rect.viewportWidth - rect.width - VIEWPORT_SAFE_MARGIN;
      let maxTop = rect.viewportHeight - rect.height - VIEWPORT_SAFE_MARGIN;

      if (allowEdgeHidden && isEdgeHiddenNow) {
        minLeft = -(rect.width - TOOLBOX_MIN_VISIBLE_WIDTH);
        minTop = -(rect.height - TOOLBOX_MIN_VISIBLE_HEIGHT);
        maxLeft = rect.viewportWidth - TOOLBOX_MIN_VISIBLE_WIDTH;
        maxTop = rect.viewportHeight - TOOLBOX_MIN_VISIBLE_HEIGHT;
      }

      if (maxLeft < minLeft) {
        minLeft = VIEWPORT_SAFE_MARGIN;
        maxLeft = Math.max(VIEWPORT_SAFE_MARGIN, rect.viewportWidth - TOOLBOX_MIN_VISIBLE_WIDTH);
      }

      if (maxTop < minTop) {
        minTop = VIEWPORT_SAFE_MARGIN;
        maxTop = Math.max(VIEWPORT_SAFE_MARGIN, rect.viewportHeight - TOOLBOX_MIN_VISIBLE_HEIGHT);
      }

      const nextLeft = clampNumber(rect.left, minLeft, maxLeft);
      const nextTop = clampNumber(rect.top, minTop, maxTop);

      const changed = Math.abs(nextLeft - rect.left) > 0.5 || Math.abs(nextTop - rect.top) > 0.5;

      if (!changed) {
        return false;
      }

      root.style.left = `${Math.round(nextLeft)}px`;
      root.style.top = `${Math.round(nextTop)}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';

      if (saveAfterClamp) {
        if (isPanelHiddenNow() && hiddenTitlePositionLocked) {
          appendLog(
            `[TOOLBOX_POSITION][CLAMP_SAVE_SKIP] reason=${reason || '-'} hidden-title-locked=1`,
          );
          return true;
        }

        saveCurrentRootPosition(`clamp:${reason || '-'}`, {
          mode: 'left-top',
        });
      }

      appendLog(
        `[TOOLBOX_POSITION][CLAMP] reason=${reason || '-'} left=${Math.round(rect.left)} top=${Math.round(rect.top)} -> left=${Math.round(nextLeft)} top=${Math.round(nextTop)} edgeHidden=${isEdgeHiddenNow ? '1' : '0'}`
      );

      return true;
    }

    function scheduleClampRootToViewport(reason, options) {
      if (clampViewportTimer) {
        window.clearTimeout(clampViewportTimer);
      }

      clampViewportTimer = window.setTimeout(() => {
        clampViewportTimer = 0;

        try {
          clampRootToViewport(reason, options || {});
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] clampRootToViewport failed', err);
          appendLog(`[TOOLBOX_POSITION][CLAMP_FAILED] reason=${reason || '-'} error=${errText}`);
        }
      }, 50);
    }

    function bindViewportGuard() {
      if (viewportGuardBound) {
        return;
      }

      viewportGuardBound = true;

      window.addEventListener('resize', () => {
        scheduleClampRootToViewport('window-resize', {
          save: !isPanelHiddenNow(),
          allowEdgeHidden: true,
        });
        window.setTimeout(() => {
          syncToolboxFloatingLayout('window-resize');
          repairInvisibleToolboxState('window-resize');
          updateFloatingTitlePosition('window-resize');
        }, 80);
      });

      window.addEventListener('orientationchange', () => {
        scheduleClampRootToViewport('orientation-change', {
          save: !isPanelHiddenNow(),
          allowEdgeHidden: true,
        });
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          scheduleClampRootToViewport('visibility-visible', {
            save: !isPanelHiddenNow(),
            allowEdgeHidden: true,
          });
          repairInvisibleToolboxState('visibility-visible');
          updateFloatingTitlePosition('visibility-visible');
        }
      });
    }

    function resetToolboxPosition() {
      if (!root) {
        return;
      }

      clearEdgeHiddenStateClasses();

      panel = panel || qs(`#${APP.panelId}`, root);
      if (panel) {
        panel.classList.remove('cgpt-toolbox-hidden');
        syncPanelHiddenClass('resetToolboxPosition');
      }

      const hotzone = document.getElementById(APP.edgeHotzoneId);
      if (hotzone) {
        hotzone.classList.remove('active');
        hotzone.removeAttribute('style');
      }

      root.style.left = 'auto';
      root.style.top = 'auto';
      root.style.right = '16px';
      root.style.bottom = '16px';
      root.style.transform = '';

      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
      MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);
      MemoryManager.set(MemoryManager.KEYS.edgeSide, 'right');

      hideRestoreHotzone('resetToolboxPosition');
      hideRestoreHandle('resetToolboxPosition');

      MemoryManager.saveToolboxPatch({
        panelPosition: null,
        panelHidden: false,
        edgeHidden: false,
        edgeSide: 'right',
      });

      scheduleClampRootToViewport('reset-position', {
        save: true,
        allowEdgeHidden: false,
      });

      setStatus('已重置工具箱位置', 'success', {
        persist: false,
      });

      showToast('已重置位置', 'success', 1000);

      appendLog('[TOOLBOX_POSITION][RESET]');
    }

    function writeCompactMode(value, options = {}) {
      const nextCompactMode = !!value;
      const oldCompactMode = !!compactMode;

      if (panel && isPanelVisibleNow()) {
        savePanelSizeFromDom({
          userAction: true,
          key: getPanelSizeMemoryKeyForMode(oldCompactMode),
          reason: 'before-compact-mode-change',
        });
      }

      compactMode = nextCompactMode;

      if (options.saveGlobal !== false) {
        MemoryManager.set(MemoryManager.KEYS.compactMode, compactMode);
      }

      if (options.save !== false) {
        saveToolboxPageStatePatch(
          {
            compactMode,
          },
          options.reason || 'compact-mode-change',
        );
      }

      applyCompactMode({
        save: options.save !== false,
        reason: options.reason || 'write-compact-mode',
        anchor: options.anchor || null,
        restoreAnchor: options.restoreAnchor === true,
      });

      if (options.save !== false) {
        saveCurrentToolboxBaseState(options.reason || 'compact-mode-change');
      }

      appendLog(
        `[TOOLBOX_COMPACT][write] reason=${options.reason || '-'} old=${oldCompactMode ? 1 : 0} next=${compactMode ? 1 : 0}`,
      );
    }

    function getToolboxTitle() {
      return toolboxTitle || TOOLBOX_DEFAULT_TITLE;
    }

    function applyToolboxTitle(_nextTitle) {
      const text = TOOLBOX_DEFAULT_TITLE;
      toolboxTitle = text;

      if (titleEl) {
        titleEl.textContent = toolboxTitle;
        titleEl.title = latestStatusText
          ? `${toolboxTitle} - ${latestStatusText}`
          : toolboxTitle;
      }

      const floatingTitle = getFloatingTitleEl();
      if (floatingTitle) {
        floatingTitle.textContent = toolboxTitle;
        floatingTitle.title = latestStatusText
          ? `${toolboxTitle} - ${latestStatusText}。点击展开/收起，拖拽移动`
          : `${toolboxTitle}。点击展开/收起，拖拽移动`;
      }

      const toggle = qs(`#${APP.toggleId}`, root);
      if (toggle) {
        toggle.replaceChildren();
        const icon = document.createElement('span');
        icon.className = 'cgpt-toolbox-toggle-icon';
        icon.setAttribute('aria-hidden', 'true');
        toggle.appendChild(icon);
        const toggleTitle = isToolboxInAnyHiddenState()
          ? TOOLBOX_RESTORE_HANDLE_TITLE
          : toolboxTitle;
        toggle.title = toggleTitle;
        toggle.setAttribute('aria-label', `打开${toggleTitle}`);
      }

      updateFloatingTitlePosition('apply-title');
    }

    function saveToolboxTitle(_nextTitle) {
      applyToolboxTitle(TOOLBOX_DEFAULT_TITLE);
    }

    function getPanelSizeMemoryKeyForMode(isCompactMode) {
      return isCompactMode
        ? MemoryManager.KEYS.panelSizeCompact
        : MemoryManager.KEYS.panelSizeFull;
    }

    function getPanelSizeMemoryKey() {
      return getPanelSizeMemoryKeyForMode(compactMode);
    }

    function normalizeTab(tab) {
      const text = String(tab || '').trim();
      return VALID_TABS.includes(text) ? text : 'upload';
    }

    function applyToolboxUiState(options = {}) {
      create();

      const mem = MemoryManager.getToolboxState();

      applyToolboxTitle(TOOLBOX_DEFAULT_TITLE);

      const hidden = !!mem.panelHidden;

      if (panel) {
        if (hidden) {
          panel.classList.add('cgpt-toolbox-hidden');
        } else {
          panel.classList.remove('cgpt-toolbox-hidden');
        }
        syncPanelHiddenClass('applyToolboxUiState');
      }

      compactMode = !!mem.compactMode;
      applyCompactMode({
        save: false,
        reason: 'applyToolboxUiState',
        restoreAnchor: false,
      });

      const savedGlobalPos = readSavedPanelPosition();
      const savedSnapEdge = String((savedGlobalPos && savedGlobalPos.edge) || '').trim();
      const edgeDocked = !!mem.edgeHidden && mem.edgeAutoHideEnabled && !hidden;

      if (root) {
        clearFloatEdgeHiddenClasses();

        if (edgeDocked) {
          const side = normalizeEdgeSide(mem.edgeSide);

          root.classList.add('cgpt-toolbox-edge-hidden');
          root.classList.remove('cgpt-toolbox-edge-revealed');
          root.dataset.edgeSide = side;
          root.dataset.snapEdge = '';
        } else {
          root.classList.remove('cgpt-toolbox-edge-hidden', 'cgpt-toolbox-edge-revealed');
          root.removeAttribute('data-edge-side');
          delete root.dataset.edgeSide;

          root.dataset.snapEdge = savedSnapEdge;

          if (!hidden && !isEdgeHidden()) {
            const savedPositionApplied = applySavedPanelPosition('applyToolboxUiState');

            if (!savedPositionApplied) {
              applyPanelPosition(
                Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - PANEL_DEFAULT_SIZE.width - PANEL_VIEWPORT_MARGIN),
                PANEL_VIEWPORT_MARGIN,
              );

              appendLog('[TOOLBOX_POSITION][RESTORE_DEFAULT] reason=applyToolboxUiState');
            }
          } else if (hidden && savedGlobalPos) {
            root.style.left = `${savedGlobalPos.left}px`;
            root.style.top = `${savedGlobalPos.top}px`;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
          } else if (hidden) {
            root.style.left = 'auto';
            root.style.top = 'auto';
            root.style.right = '16px';
            root.style.bottom = '16px';
            scheduleClampRootToViewport('restore-invalid-position', { save: false, allowEdgeHidden: true });
          }
        }
      }

      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (!hidden && !isEdgeHidden()) {
            const restoredAgain = applySavedPanelPosition('applyToolboxUiState-final');

            if (restoredAgain) {
              appendLog('[TOOLBOX_POSITION][RESTORE_GLOBAL_FINAL] reason=applyToolboxUiState-final');
            }
          }
        }, 80);
      });

      window.requestAnimationFrame(() => {
        if (isEdgeHidden()) {
          applyEdgeHiddenPosition();
          updateEdgeHotzone('applyToolboxUiState');
          scheduleClampRootToViewport('restore-position', { save: false, allowEdgeHidden: true });
        } else if (hidden) {
          keepRootInViewport({
            save: false,
          });
          scheduleClampRootToViewport('restore-position', { save: false, allowEdgeHidden: true });

          if (root && root.dataset.snapEdge) {
            snapRootToEdge({
              log: false,
            });
          }
        } else {
          keepPanelInViewport({
            save: false,
          });
          scheduleClampRootToViewport('restore-position', { save: false, allowEdgeHidden: false });
        }

        updateEdgeAutoHide();
        updateRestoreHotzone('applyToolboxUiState');
        repairInvisibleToolboxState('applyToolboxUiState');
        syncToolboxFloatingLayout('apply-ui-state');
      });

      if (options.restoreTab !== false) {
        switchTab('upload', { save: false, reason: 'applyToolboxUiState-default' });
        appendLog('[TOOLBOX_TAB][DEFAULT] active=upload reason=applyToolboxUiState-default');
      }

      normalizeEdgeVisualState('applyToolboxUiState');
    }

    function getPanelMinSize() {
      if (compactMode) {
        return {
          minWidth: PANEL_COMPACT_DEFAULT_SIZE.minWidth,
          minHeight: PANEL_COMPACT_DEFAULT_SIZE.minHeight,
        };
      }

      return {
        minWidth: PANEL_DEFAULT_SIZE.minWidth,
        minHeight: PANEL_DEFAULT_SIZE.minHeight,
      };
    }

    function getPanelSizeFallback() {
      if (compactMode) {
        return {
          width: PANEL_COMPACT_DEFAULT_SIZE.width,
          height: PANEL_COMPACT_DEFAULT_SIZE.height,
        };
      }

      return {
        width: PANEL_DEFAULT_SIZE.width,
        height: PANEL_DEFAULT_SIZE.height,
      };
    }

    function logToolboxHorizontalOverflow(reason = '') {
      if (!panel) {
        return;
      }

      try {
        const panelWidth = panel.clientWidth;
        const overflowItems = Array.from(panel.querySelectorAll('*')).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > panelWidth + 4;
        }).slice(0, 8);

        if (!overflowItems.length) {
          appendLog(`[TOOLBOX_LAYOUT][overflow-x-ok] reason=${reason || '-'}`);
          return;
        }

        appendLog(
          `[TOOLBOX_LAYOUT][overflow-x-found] reason=${reason || '-'} count=${overflowItems.length} items=${overflowItems.map((el) => {
            const cls = String(el.className || '').trim().replace(/\s+/g, '.');
            return `${el.tagName.toLowerCase()}#${el.id || '-'}${cls ? `.${cls}` : ''}`;
          }).join('|')}`,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] logToolboxHorizontalOverflow failed', err);
        appendLog(`[TOOLBOX_LAYOUT][overflow-x-log-failed] reason=${reason || '-'} error=${errText}`);
      }
    }

    function scheduleToolboxHorizontalOverflowLog(reason, delayMs = 0) {
      window.setTimeout(() => {
        logToolboxHorizontalOverflow(reason);
      }, Math.max(0, Number(delayMs) || 0));
    }

    function getCompactToggleAnchor() {
      const compactBtn = qs('#cgpt-toolbox-compact', root);
      if (!compactBtn || !panel) {
        return null;
      }

      const btnRect = compactBtn.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      if (
        btnRect.width <= 0 ||
        btnRect.height <= 0 ||
        panelRect.width <= 0 ||
        panelRect.height <= 0
      ) {
        return null;
      }

      return {
        buttonCenterX: btnRect.left + btnRect.width / 2,
        buttonCenterY: btnRect.top + btnRect.height / 2,
        panelLeft: panelRect.left,
        panelTop: panelRect.top,
        panelRight: panelRect.right,
        panelBottom: panelRect.bottom,
        panelWidth: panelRect.width,
        panelHeight: panelRect.height,
      };
    }

    function restorePanelPositionByCompactAnchor(anchor, reason = '', options = {}) {
      if (!anchor || !panel) {
        return;
      }

      const compactBtn = qs('#cgpt-toolbox-compact', root);
      if (!compactBtn) {
        return;
      }

      const btnRect = compactBtn.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      if (
        btnRect.width <= 0 ||
        btnRect.height <= 0 ||
        panelRect.width <= 0 ||
        panelRect.height <= 0
      ) {
        return;
      }

      const newButtonCenterX = btnRect.left + btnRect.width / 2;
      const newButtonCenterY = btnRect.top + btnRect.height / 2;

      const deltaX = anchor.buttonCenterX - newButtonCenterX;
      const deltaY = anchor.buttonCenterY - newButtonCenterY;

      let nextLeft = panelRect.left + deltaX;
      let nextTop = panelRect.top + deltaY;

      const maxLeft = window.innerWidth - panelRect.width - PANEL_VIEWPORT_MARGIN;
      const maxTop = window.innerHeight - panelRect.height - PANEL_VIEWPORT_MARGIN;

      nextLeft = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(nextLeft, maxLeft));
      nextTop = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(nextTop, maxTop));

      applyPanelPosition(nextLeft, nextTop);

      window.requestAnimationFrame(() => {
        if (options.save === true) {
          savePanelPositionFromDom(`compact-anchor:${reason || '-'}`);
        }

        syncToolboxFloatingLayout(`compact-anchor:${reason || '-'}`);
        updateFloatingTitlePosition(`compact-anchor:${reason || '-'}`);

        const finalBtnRect = compactBtn.getBoundingClientRect();
        const finalPanelRect = panel.getBoundingClientRect();

        appendLog(
          `[TOOLBOX_COMPACT][anchor-restore] reason=${reason || '-'} ` +
          `anchorX=${Math.round(anchor.buttonCenterX)} ` +
          `anchorY=${Math.round(anchor.buttonCenterY)} ` +
          `btnX=${Math.round(finalBtnRect.left + finalBtnRect.width / 2)} ` +
          `btnY=${Math.round(finalBtnRect.top + finalBtnRect.height / 2)} ` +
          `panelLeft=${Math.round(finalPanelRect.left)} ` +
          `panelTop=${Math.round(finalPanelRect.top)} ` +
          `panelRight=${Math.round(finalPanelRect.right)} ` +
          `panelWidth=${Math.round(finalPanelRect.width)}`
        );
      });
    }

    function applyCompactMode(options = {}) {
      if (!panel) return;

      const shouldSave = options.save === true;
      const reason = options.reason || (compactMode ? 'compact-mode-on' : 'compact-mode-off');
      const shouldRestoreAnchor = options.restoreAnchor === true;
      const anchor = shouldRestoreAnchor
        ? (options.anchor || getCompactToggleAnchor())
        : null;

      panel.classList.toggle('cgpt-toolbox-compact', compactMode);

      const compactBtn = qs('#cgpt-toolbox-compact', root);
      if (compactBtn) {
        compactBtn.textContent = compactMode ? '完整' : '精简';
        compactBtn.title = compactMode ? '切换到完整模式' : '切换到精简模式';
      }

      if (compactMode) {
        switchTab('upload', { save: false, reason });
        currentActiveTab = 'upload';
        panel.setAttribute('data-compact-active-tab', 'upload');
        appendLog(`[TOOLBOX_COMPACT][force-upload] reason=${reason}`);
      } else {
        panel.removeAttribute('data-compact-active-tab');

        const activeTab = normalizeTab(currentActiveTab || 'upload');
        switchTab(activeTab);
        appendLog(`[TOOLBOX_COMPACT][exit] reason=${reason}`);
      }

      restorePanelSize();

      window.requestAnimationFrame(() => {
        if (shouldRestoreAnchor && anchor) {
          restorePanelPositionByCompactAnchor(anchor, reason, {
            save: shouldSave,
          });
        }

        window.setTimeout(() => {
          keepPanelInViewport({
            save: shouldSave,
            reason: `compact-mode:${reason}`,
          });

          if (shouldSave) {
            savePanelPositionFromDom(`compact-mode:${reason}`);
          }

          scheduleToolboxHorizontalOverflowLog(reason, 0);
        }, 0);
      });

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }
    }

    function bindCompactButton() {
      const compactBtn = qs('#cgpt-toolbox-compact', root);
      bindOnce(compactBtn, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const anchor = getCompactToggleAnchor();

        writeCompactMode(!compactMode, {
          reason: 'compact-button-click',
          anchor,
          restoreAnchor: true,
        });
      });
    }

    function ensureFloatingTitleElement() {
      if (!root) return;

      let floatingTitle = qs('#cgpt-toolbox-floating-title', root);
      if (floatingTitle) return;

      floatingTitle = document.createElement('div');
      floatingTitle.id = 'cgpt-toolbox-floating-title';
      floatingTitle.className = 'cgpt-toolbox-floating-title';
      floatingTitle.textContent = toolboxTitle || TOOLBOX_DEFAULT_TITLE;

      const panelEl = qs(`#${APP.panelId}`, root);
      if (panelEl) {
        root.insertBefore(floatingTitle, panelEl);
      } else {
        root.appendChild(floatingTitle);
      }

      bindFloatingTitleToggleEvents();
    }

    function ensureCompactButton() {
      if (!root) return;

      let compactBtn = qs('#cgpt-toolbox-compact', root);
      if (compactBtn) return;

      const actions = qs('.cgpt-toolbox-header-actions', root);
      if (!actions) return;

      compactBtn = document.createElement('button');
      compactBtn.type = 'button';
      compactBtn.className = 'cgpt-toolbox-small-btn';
      compactBtn.id = 'cgpt-toolbox-compact';
      compactBtn.textContent = '精简';
      actions.insertBefore(compactBtn, actions.firstChild);
    }

    function isValidShellRoot(node) {
      if (!(node instanceof HTMLElement)) return false;

      const nextPanel = node.querySelector(`#${APP.panelId}`);
      const nextToggle = node.querySelector(`#${APP.toggleId}`);
      const nextHeader = node.querySelector('.cgpt-toolbox-header');
      const nextContent = node.querySelector('.cgpt-toolbox-content');

      return !!(nextPanel && nextToggle && nextHeader && nextContent);
    }

    function create() {
      if (creatingToolbox && root) {
        return root;
      }

      if (creatingToolbox) {
        return null;
      }

      creatingToolbox = true;

      try {
        injectStyle();

        if (root) {
          if (!document.documentElement.contains(root)) {
            try {
              document.documentElement.appendChild(root);
              panel = qs(`#${APP.panelId}`, root);
              titleEl = qs('.cgpt-toolbox-title', root);
              migrateToolboxToastToPanel('create-existing-root-detached');
              appendLog('[TOOLBOX_WATCHDOG][REMOUNT] reason=create-existing-root-detached');
            } catch (err) {
              const errText = err && err.message ? err.message : String(err);
              console.error('[ChatGPT toolbox] remount detached root failed', err);
              appendLog(`[TOOLBOX_WATCHDOG][REMOUNT_FAILED] reason=create-existing-root-detached error=${errText}`);
            }
          }

          ensureEdgeHotzoneElement();
          ensureRestoreHotzoneElement();
          ensureRestoreHandleElement();
          bindToolboxAudioUnlockEvents(root);
          updateRestoreHotzone('create-existing-root');
          ensureFloatingTitleElement();
          window.setTimeout(() => {
            repairInvisibleToolboxState('create-existing-root-detached');
          }, 300);
          purgeForbiddenStatusBadge('create-existing-root');
          return root;
        }

        const existing = document.getElementById(APP.rootId);

      if (existing) {
        if (!isValidShellRoot(existing)) {
          console.warn('[ChatGPT toolbox] 检测到不完整的旧工具箱 DOM，已删除并重新创建', existing);
          const oldHotzone = document.getElementById(APP.edgeHotzoneId);
          if (oldHotzone) {
            oldHotzone.remove();
          }
          edgeHotzone = null;
          existing.remove();
        } else if (existing.dataset.shellEventsVersion !== SHELL_EVENTS_VERSION) {
          console.warn('[ChatGPT toolbox] 检测到旧版事件绑定，已删除并重新创建', existing);
          const oldHotzone = document.getElementById(APP.edgeHotzoneId);
          if (oldHotzone) {
            oldHotzone.remove();
          }
          edgeHotzone = null;
          existing.remove();
        } else {
          root = existing;
          panel = qs(`#${APP.panelId}`, root);
          titleEl = qs('.cgpt-toolbox-title', root);
          migrateToolboxToastToPanel('reuse-existing-dom');
          purgeForbiddenStatusBadge('reuse-existing-dom');

          ensureCompactButton();
          ensureFloatingTitleElement();
          ensureRestoreHotzoneElement();
          ensureRestoreHandleElement();
          bindCompactButton();
          bindEvents();
          bindToolboxAudioUnlockEvents(root);
          applyToolboxUiState({
            restoreTab: false,
          });
          updateRestoreHotzone('create-existing-root');

          window.setTimeout(() => {
            syncToolboxFloatingLayout('reuse-existing-dom');
            repairInvisibleToolboxState('reuse-existing-dom');
          }, 100);

          window.setTimeout(() => {
            repairInvisibleToolboxState('create-reuse-delayed');
          }, 300);

          return root;
        }
      }

      root = document.createElement('div');
      root.id = APP.rootId;
      root.innerHTML = `
        <button id="${APP.toggleId}" type="button" aria-label="打开小张工具箱" title="小张工具箱">
          <span class="cgpt-toolbox-toggle-icon" aria-hidden="true"></span>
        </button>
        <div id="cgpt-toolbox-floating-title" class="cgpt-toolbox-floating-title">
          小张工具箱
        </div>
        <div id="${APP.panelId}">
          <div class="cgpt-toolbox-header" id="cgpt-toolbox-drag-handle">
            <div class="cgpt-toolbox-title">小张工具箱</div>
            <div class="cgpt-toolbox-header-actions">
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-toolbox-compact">精简</button>
            </div>
          </div>

          <div class="cgpt-toolbox-tabs">
            <button type="button" class="cgpt-toolbox-tab active" data-tab="upload" data-full-label="多文件上传" data-short-label="上传">多文件上传</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="autoq" data-full-label="自动指令" data-short-label="指令">自动指令</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="prompt" data-full-label="Prompt 管理" data-short-label="Prompt">Prompt 管理</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="bridge" data-full-label="浏览器桥接" data-short-label="桥接">浏览器桥接</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="export" data-full-label="导出统计" data-short-label="导出">导出统计</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="log" data-full-label="日志" data-short-label="日志">日志</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="settings" data-full-label="设置" data-short-label="设置">设置</button>
          </div>

          <div class="cgpt-toolbox-content">
            <div class="cgpt-toolbox-page active" data-page="upload">
              <div id="cgpt-upload-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="autoq">
              <div id="cgpt-autoq-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="prompt">
              <div id="cgpt-prompt-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="bridge">
              <div id="cgpt-bridge-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="export">
              <div id="cgpt-export-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="log">
              <div id="cgpt-log-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="settings">
              <div id="cgpt-settings-tab-host"></div>
            </div>
          </div>

          <div class="cgpt-resize-handle cgpt-resize-n" data-resize-dir="n"></div>
          <div class="cgpt-resize-handle cgpt-resize-s" data-resize-dir="s"></div>
          <div class="cgpt-resize-handle cgpt-resize-e" data-resize-dir="e"></div>
          <div class="cgpt-resize-handle cgpt-resize-w" data-resize-dir="w"></div>
          <div class="cgpt-resize-handle cgpt-resize-ne" data-resize-dir="ne"></div>
          <div class="cgpt-resize-handle cgpt-resize-nw" data-resize-dir="nw"></div>
          <div class="cgpt-resize-handle cgpt-resize-se" data-resize-dir="se"></div>
          <div class="cgpt-resize-handle cgpt-resize-sw" data-resize-dir="sw"></div>
        </div>
      `;

      document.documentElement.appendChild(root);
      purgeForbiddenStatusBadge('create-new-root');

      panel = qs(`#${APP.panelId}`, root);
      titleEl = qs('.cgpt-toolbox-title', root);

      migrateToolboxToastToPanel('create-new-root');

      bindEvents();
      bindToolboxAudioUnlockEvents(root);
      applyToolboxUiState({
        restoreTab: false,
      });

      ensureRestoreHandleElement();

      window.setTimeout(() => {
        if (panel && isPanelVisibleNow()) {
          keepPanelInViewport({
            save: false,
          });
        } else {
          scheduleClampRootToViewport('create', {
            save: false,
            allowEdgeHidden: true,
          });
        }
        repairInvisibleToolboxState('create-delayed');
      }, 100);

      window.setTimeout(() => {
        repairInvisibleToolboxState('create-300ms');
      }, 300);

      window.setTimeout(() => {
        scheduleClampRootToViewport('create-late', {
          save: false,
          allowEdgeHidden: true,
        });
      }, 500);

      scheduleToolboxHorizontalOverflowLog('create', 300);

        bindViewportGuard();

        return root;
      } finally {
        creatingToolbox = false;

        if (root) {
          startToolboxWatchdog();
          bindGlobalErrorGuard();
        }
      }
    }

    function isToolboxPanelVisibleForHotkey() {
      if (!panel) return false;

      if (panel.classList.contains('cgpt-toolbox-hidden')) {
        return false;
      }

      if (root?.classList?.contains('cgpt-toolbox-panel-hidden')) {
        return false;
      }

      if (root?.classList?.contains('cgpt-toolbox-edge-hidden')) {
        return false;
      }

      if (root?.classList?.contains('cgpt-edge-hidden')) {
        return false;
      }

      return true;
    }

    function isEditableElementForToolboxHotkey(el) {
      if (!el || el === document || el === window) return false;

      const tagName = String(el.tagName || '').toLowerCase();

      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        return true;
      }

      if (el.isContentEditable) {
        return true;
      }

      const role = String(el.getAttribute?.('role') || '').toLowerCase();
      if (role === 'textbox' || role === 'combobox' || role === 'searchbox') {
        return true;
      }

      const editableParent = el.closest?.(
        'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]',
      );

      return Boolean(editableParent);
    }

    function findToolboxSendMessageButton() {
      if (!root) return null;

      const selectors = [
        '#cgpt-upload-start-send',
      ];

      for (const selector of selectors) {
        const btn = root.querySelector(selector);
        if (btn) return btn;
      }

      const buttons = Array.from(root.querySelectorAll('button'));
      return buttons.find((btn) => {
        const text = String(btn.textContent || '').trim();
        return text === '发送消息' || text === '发送信息';
      }) || null;
    }

    function shouldSkipEnterSendBecauseOtherButtonFocused(target, sendBtn) {
      const focusedButton = target?.closest?.('button');

      if (!focusedButton) {
        return false;
      }

      if (focusedButton === sendBtn) {
        return false;
      }

      return true;
    }

    function triggerToolboxSendMessageByEnter(event) {
      if (!event) return;

      if (event.key !== 'Enter') {
        return;
      }

      if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      if (event.isComposing) {
        appendLog('[TOOLBOX_HOTKEY][enter-send-skip] reason=ime-composing');
        return;
      }

      if (!isToolboxPanelVisibleForHotkey()) {
        return;
      }

      const target = event.target;

      if (!root || !root.contains(target)) {
        return;
      }

      if (isEditableElementForToolboxHotkey(target)) {
        return;
      }

      const sendBtn = findToolboxSendMessageButton();

      if (!sendBtn) {
        appendLog('[TOOLBOX_HOTKEY][enter-send-skip] reason=send-button-missing');
        return;
      }

      if (shouldSkipEnterSendBecauseOtherButtonFocused(target, sendBtn)) {
        appendLog('[TOOLBOX_HOTKEY][enter-send-skip] reason=other-button-focused');
        return;
      }

      if (sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') {
        appendLog('[TOOLBOX_HOTKEY][enter-send-skip] reason=send-button-disabled');
        return;
      }

      if (toolboxEnterSendLocked) {
        appendLog('[TOOLBOX_HOTKEY][enter-send-skip] reason=locked');
        return;
      }

      toolboxEnterSendLocked = true;

      window.setTimeout(() => {
        toolboxEnterSendLocked = false;
      }, 800);

      event.preventDefault();
      event.stopPropagation();

      appendLog('[TOOLBOX_HOTKEY][enter-send] trigger=enter');

      try {
        sendBtn.click();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] enter send failed', err);
        appendLog(`[TOOLBOX_HOTKEY][enter-send-failed] error=${errText}`);
      }
    }

    function bindToolboxEnterSendHotkey() {
      if (!root) {
        appendLog('[TOOLBOX_HOTKEY][bind-skip] reason=root-missing');
        return;
      }

      if (root.dataset.enterSendHotkeyBound === '1') {
        return;
      }

      root.dataset.enterSendHotkeyBound = '1';

      if (!root.hasAttribute('tabindex')) {
        root.setAttribute('tabindex', '-1');
      }

      root.addEventListener('keydown', triggerToolboxSendMessageByEnter, true);

      root.addEventListener('pointerdown', (e) => {
        if (!root) return;

        const target = e.target instanceof Element ? e.target : null;

        if (target && target.closest([
          'input',
          'textarea',
          'select',
          'button',
          '[contenteditable="true"]',
          '[role="textbox"]',
          '[role="combobox"]',
          '[role="searchbox"]',
        ].join(','))) {
          appendLog('[TOOLBOX_HOTKEY][focus-root-skip] reason=editable-or-button');
          return;
        }

        try {
          root.focus({
            preventScroll: true,
          });
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] focus root failed', err);
          appendLog(`[TOOLBOX_HOTKEY][focus-root-failed] error=${errText}`);
        }
      });

      appendLog('[TOOLBOX_HOTKEY][enter-send-bind]');
    }

    function bindEvents() {
      if (!root) {
        console.warn('[ChatGPT toolbox] bindEvents: root 未初始化');
        return;
      }

      panel = panel || qs(`#${APP.panelId}`, root);
      const toggle = qs(`#${APP.toggleId}`, root);

      if (!panel) {
        console.warn('[ChatGPT toolbox] bindEvents: panel 不存在，取消绑定');
        return;
      }

      if (!toggle) {
        console.warn('[ChatGPT toolbox] bindEvents: toggle 不存在，取消绑定');
        return;
      }

      ensureEdgeHotzoneElement();
      ensureRestoreHotzoneElement();
      ensureRestoreHandleElement();
      bindToolboxConsoleRescueApi();

      bindToggleDrag();
      bindEdgeHoverReveal();
      bindFloatingTitleToggleEvents();

      if (root.dataset.shellEventsVersion === SHELL_EVENTS_VERSION) {
        return;
      }

      if (titleEl && titleEl.dataset.titleBound !== '1') {
        titleEl.dataset.titleBound = '1';
        titleEl.addEventListener('dblclick', () => {
          const name = window.prompt('工具箱名称', getToolboxTitle());
          if (name === null) return;

          const text = String(name || '').trim();
          if (!text) {
            console.warn('[ChatGPT toolbox] rename toolbox: 名称为空');
            return;
          }

          saveToolboxTitle(text);
          appendLog(`工具箱已重命名为${toolboxTitle}`);
        });
      }

      qsa('.cgpt-toolbox-tab', root).forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          switchTab(tab);
        });
      });

      bindCompactButton();
      bindPanelPinOnClick();
      bindToolboxEnterSendHotkey();
      bindDrag();
      bindPanelResizeHandles();
      bindPanelResizePersistence();

      window.addEventListener('resize', () => {
        appendLog('[TOOLBOX_LAYOUT][window-resize-clamp-only]');

        scheduleClampRootToViewport('window-resize(shell)', {
          save: false,
          allowEdgeHidden: true,
        });

        if (isEdgeHidden()) {
          applyEdgeHiddenPosition();
          normalizeEdgeVisualState('resize');
          updateEdgeHotzone('window-resize');
          updateRestoreHotzone('window-resize');
          repairInvisibleToolboxState('window-resize-edge');
          return;
        }

        if (isPanelHiddenNow()) {
          keepRootInViewport({
            save: false,
          });
          updateEdgeAutoHide();
          updateRestoreHotzone('window-resize');
          repairInvisibleToolboxState('window-resize-panel-hidden');
          updateFloatingTitlePosition('window-resize-panel-hidden');
          return;
        }

        window.setTimeout(() => {
          keepPanelInViewport({
            save: false,
          });
          updateEdgeAutoHide();
          scheduleClampRootToViewport('window-resize(panel)', {
            save: false,
            allowEdgeHidden: false,
          });
          syncToolboxFloatingLayout('window-resize');
        }, 0);

        window.setTimeout(() => {
          syncToolboxFloatingLayout('window-resize');
          scheduleToolboxHorizontalOverflowLog('window-resize', 0);
        }, 80);
      });

      root.dataset.shellEventsVersion = SHELL_EVENTS_VERSION;

      bindToolboxPageStateRouteWatcher();
    }

    function switchTab(tab, options = {}) {
      let nextTab = normalizeTab(tab);

      if (compactMode && nextTab !== 'upload') {
        appendLog(`[TOOLBOX_COMPACT][block-non-upload-tab] requested=${nextTab}`);
        nextTab = 'upload';
      }

      qsa('.cgpt-toolbox-tab', root).forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === nextTab);
      });

      qsa('.cgpt-toolbox-page', root).forEach((page) => {
        page.classList.toggle('active', page.getAttribute('data-page') === nextTab);
      });

      currentActiveTab = nextTab;

      if (root) {
        root.dataset.activeTab = nextTab;
      }

      if (panel) {
        panel.dataset.activeTab = nextTab;
      }

      if (options.save !== false) {
        const pageKey = typeof getToolboxPageKey === 'function' ? getToolboxPageKey() : '-';
        appendLog(
          `[TOOLBOX_TAB][SAVE] source=switchTab pageKey=${pageKey} activeTab=${nextTab} `
          + `reason=${options.reason || `switch-tab:${nextTab}`} compactMode=${compactMode ? 'true' : 'false'} `
          + `isApplyingToolboxPageState=${isApplyingToolboxPageState ? 'true' : 'false'}`,
        );
        saveToolboxPageStatePatch(
          {
            ...collectCurrentToolboxPageState(),
            activeTab: nextTab,
          },
          `switch-tab:${nextTab}`,
        );
      }

      if (panel && compactMode) {
        panel.setAttribute('data-compact-active-tab', 'upload');
      }

      if (nextTab === 'log' && typeof LogModule.flushDomIfNeeded === 'function') {
        LogModule.flushDomIfNeeded();
      }

      scheduleToolboxHorizontalOverflowLog(`switch-tab:${nextTab}`, 0);
    }

    function restoreActiveTab() {
      const pageState = typeof getToolboxPageState === 'function' ? getToolboxPageState() : {};
      const pageTab = readToolboxStateField(pageState, 'activeTab', '');
      if (pageTab) {
        const tab = normalizeTab(pageTab);
        switchTab(tab, { reason: 'restore-page-state' });
        appendLog(`[TOOLBOX_TAB][RESTORE] source=page active=${tab}`);
        return tab;
      }
      switchTab('upload', { save: false, reason: 'restore-default-upload' });
      appendLog('[TOOLBOX_TAB][RESTORE] source=default active=upload');
      return 'upload';
    }

    function getActiveTab() {
      return currentActiveTab || 'upload';
    }

    function getCurrentPanelDefaultSize() {
      return compactMode ? PANEL_COMPACT_DEFAULT_SIZE : PANEL_DEFAULT_SIZE;
    }

    function getPanelMaxSize() {
      return {
        width: Math.max(PANEL_DEFAULT_SIZE.minWidth, window.innerWidth - PANEL_VIEWPORT_MARGIN * 2),
        height: Math.max(PANEL_DEFAULT_SIZE.minHeight, window.innerHeight - 82),
      };
    }

    function normalizePanelSize(size) {
      const defaults = getCurrentPanelDefaultSize();
      const maxSize = getPanelMaxSize();

      return {
        width: clampNumber(size && size.width, defaults.minWidth, maxSize.width),
        height: clampNumber(size && size.height, defaults.minHeight, maxSize.height),
      };
    }

    function getCurrentPanelVisualSize() {
      const fallback = normalizePanelSize(
        MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
      );
      if (!panel) return fallback;

      const rect = panel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }

      return fallback;
    }

    function applyPanelSize(size) {
      if (!panel) return;

      const next = normalizePanelSize(size || getCurrentPanelDefaultSize());

      panel.style.width = `${next.width}px`;
      panel.style.height = `${next.height}px`;

      window.setTimeout(() => {
        keepPanelInViewport({
          save: false,
        });
      }, 0);
    }

    function getRootCurrentPosition() {
      const rect = root.getBoundingClientRect();

      return {
        left: rect.left,
        top: rect.top,
      };
    }

    function ensureRootPositionAnchored() {
      if (!root) return;

      const usesLeftTop = root.style.left && root.style.top
        && root.style.right === 'auto'
        && root.style.bottom === 'auto';

      if (usesLeftTop) return;

      const pos = getRootCurrentPosition();
      applyRootPosition(pos.left, pos.top);
    }

    function applyRootPosition(left, top) {
      if (!root) return;

      const safeLeft = Number.isFinite(left) ? left : PANEL_VIEWPORT_MARGIN;
      const safeTop = Number.isFinite(top) ? top : PANEL_VIEWPORT_MARGIN;

      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.left = `${Math.round(safeLeft)}px`;
      root.style.top = `${Math.round(safeTop)}px`;
    }

    function getHiddenToggleAnchorPosition(reason = '') {
      if (!root || !panel) {
        appendLog(`[TOOLBOX_HIDE_ANCHOR][skip] reason=${reason || '-'} missing-root-or-panel`);
        return null;
      }

      const margin = PANEL_VIEWPORT_MARGIN;
      const gap = 6;
      const now = Date.now();
      let source = 'panel-rect';
      let rect = null;

      if (
        lastPanelVisibleRect &&
        Number.isFinite(Number(lastPanelVisibleRect.left)) &&
        Number.isFinite(Number(lastPanelVisibleRect.top)) &&
        Number(lastPanelVisibleRect.width) > 0 &&
        Number(lastPanelVisibleRect.height) > 0 &&
        now - Number(lastPanelVisibleRect.updatedAt || 0) < 10000
      ) {
        rect = lastPanelVisibleRect;
        source = 'last-visible-panel-rect';
      } else {
        const panelRect = panel.getBoundingClientRect();
        if (!panelRect || panelRect.width <= 0 || panelRect.height <= 0) {
          appendLog(`[TOOLBOX_HIDE_ANCHOR][skip] reason=${reason || '-'} invalid-panel-rect`);
          return null;
        }
        rect = panelRect;
      }

      const hiddenWidth = HIDDEN_TOGGLE_SIZE && HIDDEN_TOGGLE_SIZE.width
        ? HIDDEN_TOGGLE_SIZE.width
        : 110;
      const hiddenHeight = HIDDEN_TOGGLE_SIZE && HIDDEN_TOGGLE_SIZE.height
        ? HIDDEN_TOGGLE_SIZE.height
        : 34;

      const rawLeft = Number(rect.left);
      const rawTop = Math.max(
        margin,
        Number(rect.top) - hiddenHeight - gap,
      );
      const left = clampNumber(
        rawLeft,
        margin,
        Math.max(margin, window.innerWidth - hiddenWidth - margin),
      );
      const top = clampNumber(
        rawTop,
        margin,
        Math.max(margin, window.innerHeight - hiddenHeight - margin),
      );

      appendLog(
        `[TOOLBOX_HIDE_ANCHOR][calc] reason=${reason || '-'} source=${source} left=${Math.round(left)} top=${Math.round(top)} panelLeft=${Math.round(Number(rect.left))} panelTop=${Math.round(Number(rect.top))}`,
      );

      return {
        left,
        top,
        source,
      };
    }

    function saveHiddenTitlePosition(pos, reason = '') {
      if (!pos) {
        return false;
      }

      const left = Number(pos.left);
      const top = Number(pos.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        appendLog(`[TOOLBOX_HIDE_TITLE][save-skip] reason=${reason || '-'} invalid-pos=1`);
        return false;
      }

      const margin = PANEL_VIEWPORT_MARGIN;
      const width = HIDDEN_TOGGLE_SIZE && HIDDEN_TOGGLE_SIZE.width
        ? HIDDEN_TOGGLE_SIZE.width
        : 110;
      const height = HIDDEN_TOGGLE_SIZE && HIDDEN_TOGGLE_SIZE.height
        ? HIDDEN_TOGGLE_SIZE.height
        : 34;

      hiddenTitlePosition = {
        left: clampNumber(left, margin, Math.max(margin, window.innerWidth - width - margin)),
        top: clampNumber(top, margin, Math.max(margin, window.innerHeight - height - margin)),
        updatedAt: Date.now(),
        reason: String(reason || '-'),
      };

      hiddenTitlePositionLocked = true;
      MemoryManager.set(MemoryManager.KEYS.hiddenTitlePosition, hiddenTitlePosition);

      appendLog(
        `[TOOLBOX_HIDE_TITLE][save] reason=${reason || '-'} left=${Math.round(hiddenTitlePosition.left)} top=${Math.round(hiddenTitlePosition.top)}`,
      );

      return true;
    }

    function clearHiddenTitlePosition(reason = '') {
      hiddenTitlePosition = null;
      hiddenTitlePositionLocked = false;
      MemoryManager.remove(MemoryManager.KEYS.hiddenTitlePosition);

      appendLog(`[TOOLBOX_HIDE_TITLE][clear] reason=${reason || '-'}`);
    }

    function readPersistedHiddenTitlePosition() {
      const saved = MemoryManager.get(MemoryManager.KEYS.hiddenTitlePosition, null);
      if (!saved || typeof saved !== 'object') {
        return null;
      }

      const left = Number(saved.left);
      const top = Number(saved.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
      }

      return {
        left,
        top,
        updatedAt: saved.updatedAt || 0,
        reason: saved.reason || 'persisted',
        source: 'memory',
      };
    }

    function getLockedHiddenTitlePosition(reason = '') {
      if (
        hiddenTitlePositionLocked &&
        hiddenTitlePosition &&
        Number.isFinite(Number(hiddenTitlePosition.left)) &&
        Number.isFinite(Number(hiddenTitlePosition.top))
      ) {
        return hiddenTitlePosition;
      }

      const persisted = readPersistedHiddenTitlePosition();
      if (persisted) {
        hiddenTitlePosition = persisted;
        hiddenTitlePositionLocked = true;
        return hiddenTitlePosition;
      }

      const pos = getHiddenToggleAnchorPosition(reason || 'get-locked-hidden-title-position');

      if (!pos) {
        return null;
      }

      saveHiddenTitlePosition(pos, reason || 'get-locked-hidden-title-position');
      return hiddenTitlePosition;
    }

    function anchorRootToHiddenTogglePosition(reason = '') {
      const pos = getHiddenToggleAnchorPosition(reason);

      if (!pos) {
        return false;
      }

      saveHiddenTitlePosition(pos, reason || 'anchor-root-hidden-toggle');

      applyRootPosition(pos.left, pos.top);

      appendLog(
        `[TOOLBOX_HIDE_ANCHOR][apply] reason=${reason || '-'} source=${pos.source || '-'} left=${Math.round(pos.left)} top=${Math.round(pos.top)}`,
      );

      return true;
    }

    function clampPanelPosition(pos) {
      if (!panel) {
        return {
          left: PANEL_VIEWPORT_MARGIN,
          top: PANEL_VIEWPORT_MARGIN,
        };
      }

      const rect = panel.getBoundingClientRect();
      const width = rect.width || PANEL_DEFAULT_SIZE.width;
      const height = rect.height || PANEL_DEFAULT_SIZE.height;

      const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - width);
      const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - height - PANEL_VIEWPORT_MARGIN);

      const rawLeft = Number(pos.left);
      const rawTop = Number(pos.top);
      const left = Number.isFinite(rawLeft) ? rawLeft : PANEL_VIEWPORT_MARGIN;
      const top = Number.isFinite(rawTop) ? rawTop : PANEL_VIEWPORT_MARGIN;

      return {
        left: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(left, maxLeft)),
        top: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop)),
      };
    }

    function applyPanelPosition(left, top) {
      if (!panel) {
        console.warn('[ChatGPT toolbox] applyPanelPosition: panel 未初始化');
        return;
      }

      const safe = clampPanelPosition({
        left,
        top,
      });

      panel.style.position = 'fixed';
      panel.style.left = `${Math.round(safe.left)}px`;
      panel.style.top = `${Math.round(safe.top)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      if (root) {
        root.style.position = 'fixed';
        root.style.left = '0px';
        root.style.top = '0px';
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.width = '0px';
        root.style.height = '0px';
        root.style.transform = '';
      }

      window.requestAnimationFrame(() => {
        rememberLastPanelVisibleRect('applyPanelPosition');
      });
    }

    function normalizeEdgeSide(side) {
      const text = String(side || '').trim();
      if (text && text !== EDGE_AUTO_HIDE_SIDE) {
        appendLog(`[TOOLBOX_EDGE][unexpected-side] side=${text}`);
      }
      return VALID_EDGE_SIDES.includes(text) ? text : EDGE_AUTO_HIDE_SIDE;
    }

    function isEdgeAutoHideEnabled() {
      return MemoryManager.get(MemoryManager.KEYS.edgeAutoHideEnabled, false) === true;
    }

    function isEdgeHidden() {
      return !!(root && root.classList.contains('cgpt-toolbox-edge-hidden'));
    }

    function normalizeEdgeVisualState(reason = 'unknown') {
      if (!root || !panel) return;

      const reasonText = String(reason || 'unknown');
      const edgeHidden = root.classList.contains('cgpt-toolbox-edge-hidden');
      const revealed = root.classList.contains('cgpt-toolbox-edge-revealed');

      if (edgeHidden && !revealed) {
        panel.classList.add('cgpt-toolbox-hidden');
        appendLog(`[TOOLBOX_EDGE][normalize] reason=${reasonText} hidden-without-revealed`);
        return;
      }

      if (edgeHidden && revealed) {
        panel.classList.remove('cgpt-toolbox-hidden');
        root.classList.remove(
          'cgpt-edge-hidden',
          'cgpt-edge-right',
        );
        appendLog(`[TOOLBOX_EDGE][normalize] reason=${reasonText} revealed-visible`);
        return;
      }

      if (!edgeHidden) {
        root.classList.remove('cgpt-toolbox-edge-revealed');
      }
    }

    function clearEdgeRevealTimer() {
      if (edgeRevealTimer) {
        window.clearTimeout(edgeRevealTimer);
        edgeRevealTimer = 0;
      }
    }

    function suspendEdgeAutoHide(reason, durationMs) {
      const ms = Number(durationMs || 3000);
      edgeAutoHideSuspendUntil = Date.now() + ms;
      clearEdgeRevealTimer();

      appendLog(
        `[TOOLBOX_EDGE][auto-hide-suspend] reason=${reason || '-'} ms=${ms}`,
      );
    }

    function suspendAutoHideForForceShow(reason = '', durationMs = 3000) {
      forceShowingUntil = Date.now() + Number(durationMs || 3000);
      edgeAutoHideSuspendUntil = Math.max(edgeAutoHideSuspendUntil || 0, forceShowingUntil);
      clearEdgeRevealTimer();

      appendLog(
        `[TOOLBOX_RESTORE][force-show-suspend] reason=${reason || '-'} ms=${durationMs}`,
      );
    }

    function isEdgeAutoHideSuspended() {
      return Date.now() < edgeAutoHideSuspendUntil;
    }

    function isToolboxInteracting() {
      if (isDraggingToolbox || isResizingToolbox) {
        return true;
      }

      if (panel && panel.classList.contains('cgpt-resizing')) {
        return true;
      }

      const active = document.activeElement;

      if (active && root && root.contains(active)) {
        const tag = String(active.tagName || '').toUpperCase();

        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          return true;
        }

        if (active.isContentEditable) {
          return true;
        }
      }

      return false;
    }

    function revealPanelFromEdgeHover(reason) {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] revealPanelFromEdgeHover: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][reveal-skip] reason=${reasonText} missing-root-or-panel`);
        return;
      }

      if (!isEdgeHidden()) {
        appendLog(`[TOOLBOX_EDGE][reveal-skip] reason=${reasonText} not-edge-hidden`);
        return;
      }

      clearEdgeRevealTimer();

      root.classList.add('cgpt-toolbox-edge-revealed');
      panel.classList.remove('cgpt-toolbox-hidden');
      root.classList.remove('cgpt-toolbox-panel-hidden');
      syncPanelHiddenClass(`reveal:${reasonText}`);

      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

      edgeRehideGuardUntil = Date.now() + 300;

      appendLog(`[TOOLBOX_EDGE][reveal] reason=${reasonText} side=${root.dataset.edgeSide || '-'}`);

      normalizeEdgeVisualState(`reveal:${reasonText}`);
      applyFullRevealPositionFromEdge(reasonText);
      updateRestoreHotzone(`reveal:${reasonText}`);
    }

    function scheduleHidePanelToEdge(reason, delayMs = 450) {
      if (isDraggingToolbox) {
        appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${String(reason || '-')} dragging=1`);
        return;
      }

      const reasonText = String(reason || 'unknown');

      clearEdgeRevealTimer();

      edgeRevealTimer = window.setTimeout(() => {
        edgeRevealTimer = 0;

        if (isEdgeAutoHideSuspended()) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} auto-hide-suspended`);
          return;
        }

        if (!root || !panel) {
          console.warn('[ChatGPT toolbox] scheduleHidePanelToEdge: root 或 panel 不存在');
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} missing-root-or-panel`);
          return;
        }

        if (!isEdgeHidden()) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} not-edge-hidden`);
          return;
        }

        if (Date.now() < edgeRehideGuardUntil) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} guard-active`);
          return;
        }

        if (isDraggingToolbox) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} dragging=1`);
          return;
        }

        if (isToolboxInteracting()) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} dragging-or-resizing-or-input`);
          return;
        }

        if (edgeHotzoneHovering) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} hotzone-hovering`);
          return;
        }

        const side = getEdgeHiddenSide();

        rememberLastPanelVisibleRect(`rehide:${reasonText}`);

        root.classList.remove('cgpt-toolbox-edge-revealed');
        applyEdgeHiddenPosition();

        normalizeEdgeVisualState(`rehide:${reasonText}`);
        updateEdgeHotzone(`rehide:${reasonText}`);
        updateRestoreHotzone(`rehide:${reasonText}`);
        showRestoreHandle('edge-rehide');

        appendLog(`[TOOLBOX_EDGE][rehide] reason=${reasonText} side=${side}`);
      }, delayMs);
    }

    function getEdgeHiddenSide() {
      return normalizeEdgeSide(
        root?.dataset?.edgeSide || MemoryManager.get(MemoryManager.KEYS.edgeSide, 'right'),
      );
    }

    function clampEdgeNumber(value, min, max) {
      const n = Number(value);
      const safeMax = Math.max(min, max);

      if (!Number.isFinite(n)) {
        return min;
      }

      return Math.max(min, Math.min(safeMax, n));
    }

    function getNearestAutoHideSide(panelRect) {
      if (!panelRect) return '';

      if (isStrictlyTouchingEdge(panelRect, EDGE_AUTO_HIDE_SIDE)) {
        return EDGE_AUTO_HIDE_SIDE;
      }

      return '';
    }

    function getEdgeHiddenRootSize() {
      const toggle = root ? qs(`#${APP.toggleId}`, root) : null;
      const toggleRect = toggle instanceof HTMLElement ? toggle.getBoundingClientRect() : null;
      const rootRect = getRootRect();

      return {
        width: Math.max(EDGE_HANDLE_SIZE.width, toggleRect?.width || rootRect?.width || EDGE_HANDLE_SIZE.width),
        height: Math.max(EDGE_HANDLE_SIZE.height, toggleRect?.height || rootRect?.height || EDGE_HANDLE_SIZE.height),
      };
    }

    function ensureEdgeHotzoneElement() {
      edgeHotzone = document.getElementById(APP.edgeHotzoneId);
      if (!edgeHotzone) {
        if (!document.body) {
          console.warn('[ChatGPT toolbox] ensureEdgeHotzoneElement: document.body 不存在');
          appendLog('[TOOLBOX_EDGE][hotzone:warn](document.body 缺失，无法创建贴边热区)');
          return;
        }

        edgeHotzone = document.createElement('div');
        edgeHotzone.id = APP.edgeHotzoneId;
        edgeHotzone.setAttribute('aria-hidden', 'true');
        document.body.appendChild(edgeHotzone);
      }

      bindEdgeHotzoneEvents();
    }

    function hideEdgeHotzone(reason = 'unknown') {
      if (!edgeHotzone) return;

      edgeHotzone.classList.remove('active');
      edgeHotzoneHovering = false;
      Object.assign(edgeHotzone.style, {
        left: '',
        right: '',
        top: '',
        bottom: '',
        width: '',
        height: '',
      });

      appendLog(`[TOOLBOX_EDGE][hotzone:hide] reason=${String(reason || 'unknown')}`);
    }

    function updateEdgeHotzone(reason = 'unknown') {
      const reasonText = String(reason || 'unknown');

      if (!edgeHotzone) return;

      if (!root || !panel || !isEdgeHidden()) {
        hideEdgeHotzone(`not-hidden:${reasonText}`);
        return;
      }

      const side = getEdgeHiddenSide();
      const rootRect = root.getBoundingClientRect();
      const size = getCurrentPanelVisualSize();

      const extra = EDGE_REVEAL_HOTZONE_EXTRA;
      const thickness = EDGE_REVEAL_HOTZONE_THICKNESS;

      edgeHotzone.classList.add('active');

      const height = Math.min(window.innerHeight, size.height + EDGE_HANDLE_SIZE.height + extra * 2);
      const top = Math.max(
        0,
        Math.min(
          window.innerHeight - height,
          rootRect.top - size.height - extra,
        ),
      );

      Object.assign(edgeHotzone.style, {
        right: '0px',
        left: '',
        top: `${Math.round(top)}px`,
        bottom: '',
        width: `${thickness}px`,
        height: `${Math.round(height)}px`,
      });

      appendLog(`[TOOLBOX_EDGE][hotzone:update] side=right reason=${reasonText}`);
    }

    function bindEdgeHotzoneEvents() {
      if (!edgeHotzone) return;
      if (edgeHotzone.dataset.bound === '1') return;

      edgeHotzone.dataset.bound = '1';

      edgeHotzone.addEventListener('mouseenter', () => {
        edgeHotzoneHovering = true;
        if (isDraggingToolbox || isResizingToolbox) return;

        if (isEdgeHidden()) {
          revealPanelFromEdgeHover('edge-hotzone-hover');
          updateEdgeHotzone('edge-hotzone-hover');
        }
      });

      edgeHotzone.addEventListener('mouseleave', () => {
        edgeHotzoneHovering = false;
        if (isDraggingToolbox || isResizingToolbox) return;

        if (isEdgeHidden() && root && root.classList.contains('cgpt-toolbox-edge-revealed')) {
          scheduleHidePanelToEdge('edge-hotzone-leave', 700);
        }
      });

      edgeHotzone.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (isDraggingToolbox || isResizingToolbox) return;

        if (isEdgeHidden()) {
          restorePanelFromEdgeHidden('edge-hotzone-click');
          hideEdgeHotzone('edge-hotzone-click');
        }
      });
    }

    function rememberLastPanelVisibleRect(reason = '') {
      if (!panel) return;

      const hidden = panel.classList.contains('cgpt-toolbox-hidden');

      if (hidden && !root?.classList.contains('cgpt-toolbox-edge-revealed')) {
        return;
      }

      const rect = panel.getBoundingClientRect();

      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return;
      }

      lastPanelVisibleRect = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        updatedAt: Date.now(),
      };

      appendLog(
        `[TOOLBOX_RESTORE_HOTZONE][remember] reason=${reason || '-'} left=${lastPanelVisibleRect.left} top=${lastPanelVisibleRect.top} width=${lastPanelVisibleRect.width} height=${lastPanelVisibleRect.height}`,
      );
    }

    function ensureRestoreHotzoneElement() {
      restoreHotzone = document.getElementById(APP.restoreHotzoneId);

      if (!restoreHotzone) {
        if (!document.body) {
          console.warn('[ChatGPT toolbox] ensureRestoreHotzoneElement: document.body 不存在');
          appendLog('[TOOLBOX_RESTORE_HOTZONE][warn] document.body 缺失，无法创建恢复热区');
          return;
        }

        restoreHotzone = document.createElement('div');
        restoreHotzone.id = APP.restoreHotzoneId;
        restoreHotzone.setAttribute('aria-hidden', 'true');
        document.body.appendChild(restoreHotzone);
      }

      bindRestoreHotzoneEvents();
    }

    function hideRestoreHotzone(reason = '') {
      if (!restoreHotzone) return;

      restoreHotzone.classList.remove('active');
      Object.assign(restoreHotzone.style, {
        left: '',
        right: '',
        top: '',
        bottom: '',
        width: '',
        height: '',
      });

      appendLog(`[TOOLBOX_RESTORE_HOTZONE][hide] reason=${reason || '-'}`);
    }

    function ensureRestoreHandleElement() {
      restoreHandle = document.getElementById(APP.restoreHandleId);

      if (!restoreHandle) {
        if (!document.body) {
          console.warn('[ChatGPT toolbox] ensureRestoreHandleElement: document.body 不存在');
          appendLog('[TOOLBOX_RESTORE_HANDLE][warn] document.body 缺失，无法创建恢复把手');
          return;
        }

        restoreHandle = document.createElement('button');
        restoreHandle.id = APP.restoreHandleId;
        restoreHandle.type = 'button';
        restoreHandle.textContent = '小张工具箱';
        restoreHandle.title = '点击恢复工具箱';
        document.body.appendChild(restoreHandle);
      }

      bindRestoreHandleEvents();
    }

    function showRestoreHandle(reason = '', options = {}) {
      ensureRestoreHandleElement();

      if (!restoreHandle) return;

      const force = options.force === true;

      if (!force && isFloatingTitleActuallyVisible()) {
        hideRestoreHandle(`skip-floating-title-visible:${reason || '-'}`);

        appendLog(
          `[TOOLBOX_RESTORE_HANDLE][show-skip] reason=${reason || '-'} floatingTitleVisible=1`,
        );

        return;
      }

      const rect = lastPanelVisibleRect;

      let left = window.innerWidth - 150;
      let top = 80;

      if (rect) {
        left = Math.max(12, Math.min(window.innerWidth - 150, Number(rect.left) || left));
        top = Math.max(12, Math.min(window.innerHeight - 48, Number(rect.top) || top));
      }

      restoreHandle.textContent = TOOLBOX_RESTORE_HANDLE_TITLE;
      restoreHandle.title = '点击恢复工具箱';

      Object.assign(restoreHandle.style, {
        left: `${Math.round(left)}px`,
        right: '',
        top: `${Math.round(top)}px`,
        bottom: '',
        display: 'inline-flex',
        visibility: 'visible',
        opacity: '1',
        pointerEvents: 'auto',
      });

      restoreHandle.classList.add('active');

      appendLog(
        `[TOOLBOX_RESTORE_HANDLE][show] reason=${reason || '-'} left=${Math.round(left)} top=${Math.round(top)} force=${force ? 1 : 0}`,
      );
    }

    function hideRestoreHandle(reason = '') {
      if (!restoreHandle) return;

      restoreHandle.classList.remove('active');
      restoreHandle.style.display = 'none';

      appendLog(`[TOOLBOX_RESTORE_HANDLE][hide] reason=${reason || '-'}`);
    }

    function bindRestoreHandleEvents() {
      if (!restoreHandle) return;

      if (restoreHandle.dataset.bound === '1') {
        return;
      }

      restoreHandle.dataset.bound = '1';

      restoreHandle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        restoreToolboxFromHiddenState('restore-handle-click');
      });

      restoreHandle.addEventListener('mouseenter', () => {
        restoreToolboxFromHiddenState('restore-handle-hover');
      });

      appendLog('[TOOLBOX_RESTORE_HANDLE][bind-ok]');
    }

    function restoreToolboxFromHiddenState(reason = '', options = {}) {
      if (!root || !panel) {
        appendLog(`[TOOLBOX_RESTORE][skip] reason=${reason || '-'} missing-root-or-panel`);
        return;
      }

      if (isDraggingToolbox || isResizingToolbox) {
        appendLog(`[TOOLBOX_RESTORE][skip] reason=${reason || '-'} dragging-or-resizing`);
        return;
      }

      suspendAutoHideForForceShow(reason || 'restore', 3000);
      clearHiddenTitlePosition(`restore:${reason || '-'}`);

      clearEdgeRevealTimer();

      clearRootEdgeState(`restore:${reason || '-'}`);
      forcePanelVisible(`restore:${reason || '-'}`);

      const savedPos = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
      const size = normalizePanelSize(
        MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
      );

      let left = Number.isFinite(Number(savedPos.left))
        ? Number(savedPos.left)
        : window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN;

      let top = Number.isFinite(Number(savedPos.top))
        ? Number(savedPos.top)
        : PANEL_VIEWPORT_MARGIN;

      left = Math.max(
        PANEL_VIEWPORT_MARGIN,
        Math.min(window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN, left),
      );

      top = Math.max(
        PANEL_VIEWPORT_MARGIN,
        Math.min(window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN, top),
      );

      applyPanelSize(size);
      applyPanelPosition(left, top);

      hideRestoreHotzone(`restore:${reason || '-'}`);
      hideRestoreHandle(`restore:${reason || '-'}`);
      hideEdgeHotzone(`restore:${reason || '-'}`);

      syncPanelHiddenClass(`restore:${reason || '-'}`);

      appendLog(
        `[TOOLBOX_RESTORE][show] reason=${reason || '-'} left=${Math.round(left)} top=${Math.round(top)} width=${size.width} height=${size.height}`,
      );

      window.requestAnimationFrame(() => {
        panel.style.display = 'flex';
        panel.style.pointerEvents = 'auto';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';

        keepPanelInViewport({
          save: true,
        });

        const panelRect = panel.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();

        appendLog(
          `[TOOLBOX_RESTORE][rect-check] reason=${reason || '-'} ` +
          `rootLeft=${Math.round(rootRect.left)} rootTop=${Math.round(rootRect.top)} ` +
          `panelLeft=${Math.round(panelRect.left)} panelTop=${Math.round(panelRect.top)} ` +
          `panelRight=${Math.round(panelRect.right)} panelBottom=${Math.round(panelRect.bottom)} ` +
          `panelWidth=${Math.round(panelRect.width)} panelHeight=${Math.round(panelRect.height)} ` +
          `visible=${isPanelVisibleNow() ? 1 : 0}`
        );

        syncToolboxFloatingLayout(`restore:${reason || '-'}`);
        updateFloatingTitlePosition(`restore:${reason || '-'}`);
        rememberLastPanelVisibleRect(`restore:${reason || '-'}`);

        appendLog(
          `[TOOLBOX_RESTORE][after-frame] panelHidden=${panel.classList.contains('cgpt-toolbox-hidden') ? 1 : 0} edgeHidden=${root.classList.contains('cgpt-toolbox-edge-hidden') ? 1 : 0} floatHidden=${root.classList.contains('cgpt-edge-hidden') ? 1 : 0}`,
        );
      });
    }

    function isRestoreHandleActuallyVisible() {
      if (!restoreHandle) return false;

      const style = window.getComputedStyle(restoreHandle);
      const rect = restoreHandle.getBoundingClientRect();

      return (
        restoreHandle.classList.contains('active')
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 10
        && rect.height > 10
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight
      );
    }

    function isFloatingTitleActuallyVisible() {
      const floatingTitle = getFloatingTitleEl();

      if (!floatingTitle) {
        return false;
      }

      return isElementVisible(floatingTitle);
    }

    function repairInvisibleToolboxState(reason = '') {
      if (!root || !panel) return;

      if (isPanelHiddenNow() && hiddenTitlePositionLocked) {
        updateFloatingTitlePosition(`repair-hidden-title:${reason || '-'}`);
        appendLog(`[TOOLBOX_HIDE_TITLE][repair-skip-root] reason=${reason || '-'}`);
        return;
      }

      const panelHidden = isPanelHiddenNow();
      const edgeHidden = root.classList.contains('cgpt-toolbox-edge-hidden');
      const floatHidden = root.classList.contains('cgpt-edge-hidden');
      const restoreVisible = isRestoreHandleActuallyVisible();
      const floatingTitleVisible = isFloatingTitleActuallyVisible();

      if ((panelHidden || edgeHidden || floatHidden) && !restoreVisible && !floatingTitleVisible) {
        appendLog(
          `[TOOLBOX_REPAIR][restore-entry-missing] reason=${reason || '-'} panelHidden=${panelHidden ? 1 : 0} edgeHidden=${edgeHidden ? 1 : 0} floatHidden=${floatHidden ? 1 : 0}`,
        );

        showRestoreHandle(`repair:${reason || '-'}`, {
          force: true,
        });

        updateRestoreHotzone(`repair:${reason || '-'}`);
      }
    }

    function isToolboxInAnyHiddenState() {
      if (!panel || !root) return false;

      const panelHidden = isPanelHiddenNow();
      const edgeHiddenDocked =
        root.classList.contains('cgpt-toolbox-edge-hidden') &&
        !root.classList.contains('cgpt-toolbox-edge-revealed');
      const floatHidden = isFloatingEdgeHidden();
      const visuallyHidden =
        !panelHidden &&
        !edgeHiddenDocked &&
        !floatHidden &&
        !isPanelVisibleNow();

      return panelHidden || edgeHiddenDocked || floatHidden || visuallyHidden;
    }

    function bindToolboxConsoleRescueApi() {
      const target = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

      if (target.__cgptToolboxRescueBound === '1') {
        return;
      }

      target.__cgptToolboxRescueBound = '1';

      // @deprecated 控制台救援 API，确认无旧版救援脚本依赖后再删除
      registerToolboxDebugApis({
        __cgptToolboxShow: () => {
          appendLog('[TOOLBOX_RESCUE_API][CALL] name=__cgptToolboxShow');
          restoreToolboxFromHiddenState('console');
        },
        __cgptToolboxReset: () => {
          appendLog('[TOOLBOX_RESCUE_API][CALL] name=__cgptToolboxReset');
          resetToolboxPosition();
          restoreToolboxFromHiddenState('console-reset');
        },
        __cgptToolboxForceShow: () => {
          appendLog('[TOOLBOX_RESCUE_API][CALL] name=__cgptToolboxForceShow');
          forceShowingUntil = Date.now() + 10000;
          edgeAutoHideSuspendUntil = Math.max(edgeAutoHideSuspendUntil || 0, forceShowingUntil);

          clearEdgeHiddenStateClasses();

          if (panel) {
            panel.classList.remove('cgpt-toolbox-hidden');
            panel.style.display = 'flex';
            panel.style.pointerEvents = 'auto';
            panel.style.visibility = 'visible';
            panel.style.opacity = '1';
          }

          MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
          MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);

          applyPanelSize(normalizePanelSize(
            MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback()
          ));
          applyPanelPosition(80, 80);
          hideRestoreHotzone('console-force-show');
          hideRestoreHandle('console-force-show');
          hideEdgeHotzone('console-force-show');

          syncPanelHiddenClass('console-force-show');
          syncToolboxFloatingLayout('console-force-show');
          updateFloatingTitlePosition('console-force-show');
          repairInvisibleToolboxState('console-force-show');

          appendLog('[TOOLBOX_RESTORE][console-force-show]');
        },
        __cgptToolboxClearPosition: () => {
          MemoryManager.set(MemoryManager.KEYS.panelPosition, {
            left: 80,
            top: 80,
            mode: 'panel',
            edge: '',
          });

          MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
          MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);

          clearRootEdgeState('console-clear-position');
          forcePanelVisible('console-clear-position');

          if (panel) {
            applyPanelSize(getPanelSizeFallback());
            applyPanelPosition(80, 80);
          }

          appendLog('[TOOLBOX_POSITION][CLEAR] left=80 top=80 mode=panel');
        },
      }, {
        override: true,
        target,
      });
    }

    function updateRestoreHotzone(reason = '') {
      ensureRestoreHotzoneElement();

      if (!restoreHotzone || !root || !panel) {
        return;
      }

      const panelHidden = isPanelHiddenNow();
      const edgeHidden = isEdgeHidden();
      const edgeRevealed = root.classList.contains('cgpt-toolbox-edge-revealed');
      const edgeHiddenDocked = edgeHidden && !edgeRevealed;
      const floatEdgeHidden = root.classList.contains('cgpt-edge-hidden');
      const shouldShow = panelHidden || edgeHiddenDocked || floatEdgeHidden;

      if (!shouldShow) {
        hideRestoreHotzone(`visible:${reason || '-'}`);
        hideRestoreHandle(`visible:${reason || '-'}`);
        return;
      }

      let rect = lastPanelVisibleRect;

      if (!rect) {
        const savedPos = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        const size = normalizePanelSize(
          MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
        );

        const fallbackLeft = Number.isFinite(Number(savedPos.left))
          ? Number(savedPos.left)
          : Math.max(0, window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN);

        const fallbackTop = Number.isFinite(Number(savedPos.top))
          ? Number(savedPos.top)
          : Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN);

        rect = {
          left: fallbackLeft,
          top: fallbackTop,
          right: fallbackLeft + size.width,
          bottom: fallbackTop + size.height,
          width: size.width,
          height: size.height,
        };
      }

      const hotzoneWidth = RESTORE_HOTZONE_WIDTH;
      const hotzoneHeight = Math.max(
        RESTORE_HOTZONE_MIN_HEIGHT,
        Math.min(window.innerHeight, rect.height + RESTORE_HOTZONE_EXTRA * 2),
      );

      let top = Math.round(rect.top - RESTORE_HOTZONE_EXTRA);
      top = Math.max(0, Math.min(window.innerHeight - hotzoneHeight, top));

      Object.assign(restoreHotzone.style, {
        right: '0px',
        left: '',
        top: `${top}px`,
        bottom: '',
        width: `${hotzoneWidth}px`,
        height: `${Math.round(hotzoneHeight)}px`,
      });

      restoreHotzone.classList.add('active');

      if (isFloatingTitleActuallyVisible()) {
        hideRestoreHandle(`updateRestoreHotzone:floating-title-visible:${reason || '-'}`);
      } else {
        showRestoreHandle(`updateRestoreHotzone:floating-title-missing:${reason || '-'}`, {
          force: true,
        });
      }

      appendLog(
        `[TOOLBOX_RESTORE_HOTZONE][update] reason=${reason || '-'} panelHidden=${panelHidden ? 1 : 0} edgeHiddenDocked=${edgeHiddenDocked ? 1 : 0} floatEdgeHidden=${floatEdgeHidden ? 1 : 0} top=${top} width=${hotzoneWidth} height=${Math.round(hotzoneHeight)}`,
      );
    }

    function restoreToolboxFromHotzone(reason = '') {
      restoreToolboxFromHiddenState(`hotzone:${reason || '-'}`);
    }

    function bindRestoreHotzoneEvents() {
      if (!restoreHotzone) return;

      if (restoreHotzone.dataset.bound === '1') {
        return;
      }

      restoreHotzone.dataset.bound = '1';

      restoreHotzone.addEventListener('mouseenter', () => {
        if (restoreHotzoneHoverTimer) {
          window.clearTimeout(restoreHotzoneHoverTimer);
          restoreHotzoneHoverTimer = 0;
        }

        restoreHotzoneHoverTimer = window.setTimeout(() => {
          restoreHotzoneHoverTimer = 0;
          restoreToolboxFromHotzone('hover');
        }, RESTORE_HOTZONE_HOVER_DELAY);
      });

      restoreHotzone.addEventListener('mouseleave', () => {
        if (restoreHotzoneHoverTimer) {
          window.clearTimeout(restoreHotzoneHoverTimer);
          restoreHotzoneHoverTimer = 0;
        }
      });

      restoreHotzone.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (restoreHotzoneHoverTimer) {
          window.clearTimeout(restoreHotzoneHoverTimer);
          restoreHotzoneHoverTimer = 0;
        }

        restoreToolboxFromHotzone('click');
      });

      appendLog('[TOOLBOX_RESTORE_HOTZONE][bind-ok]');
    }

    function applyEdgeHiddenPosition() {
      if (!root) return;

      const current = getRootCurrentPosition();
      const size = getEdgeHiddenRootSize();

      const left = window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN;
      const top = clampEdgeNumber(
        current.top,
        PANEL_VIEWPORT_MARGIN,
        window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN,
      );

      applyRootPosition(left, top);
      scheduleClampRootToViewport('after-edge-hide', {
        save: true,
        allowEdgeHidden: true,
      });
    }

    function buildRestorePositionFromEdge(size) {
      const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
      const width = Number(size && size.width) || PANEL_DEFAULT_SIZE.width;
      const height = Number(size && size.height) || PANEL_DEFAULT_SIZE.height;

      const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - width - PANEL_VIEWPORT_MARGIN);
      const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - height - PANEL_VIEWPORT_MARGIN);

      let top = Number.isFinite(Number(saved.top)) ? Number(saved.top) : PANEL_VIEWPORT_MARGIN;
      const left = maxLeft - EDGE_RESTORE_OFFSET;

      return {
        left: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(left, maxLeft)),
        top: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop)),
      };
    }

    function buildRevealPositionFromEdge(size) {
      const width = Number(size && size.width) || PANEL_DEFAULT_SIZE.width;
      const height = Number(size && size.height) || PANEL_DEFAULT_SIZE.height;

      const maxLeft = Math.max(
        PANEL_VIEWPORT_MARGIN,
        window.innerWidth - width - PANEL_VIEWPORT_MARGIN,
      );

      const maxTop = Math.max(
        PANEL_VIEWPORT_MARGIN,
        window.innerHeight - height - PANEL_VIEWPORT_MARGIN,
      );

      const currentPanelRect = panel ? panel.getBoundingClientRect() : null;

      const left = maxLeft;

      let top = currentPanelRect && currentPanelRect.top > 0
        ? currentPanelRect.top
        : PANEL_VIEWPORT_MARGIN;

      top = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop));

      return {
        left,
        top,
      };
    }

    function applyFullRevealPositionFromEdge(reason = 'unknown') {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] applyFullRevealPositionFromEdge: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][reveal-position-skip] reason=${reasonText} missing-root-or-panel`);
        return;
      }

      if (!isEdgeHidden()) {
        appendLog(`[TOOLBOX_EDGE][reveal-position-skip] reason=${reasonText} not-edge-hidden`);
        return;
      }

      const side = getEdgeHiddenSide();
      const size = normalizePanelSize(
        MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
      );

      applyPanelSize(size);

      panel.classList.remove('cgpt-toolbox-hidden');
      root.classList.add('cgpt-toolbox-edge-revealed');

      window.requestAnimationFrame(() => {
        if (!root || !panel) return;
        if (!isEdgeHidden()) return;
        if (!root.classList.contains('cgpt-toolbox-edge-revealed')) return;

        const pos = buildRevealPositionFromEdge(size);
        applyPanelPosition(pos.left, pos.top);

        keepPanelInViewport({
          save: false,
        });

        updateEdgeHotzone(`reveal-position:${reasonText}`);

        appendLog(
          `[TOOLBOX_EDGE][reveal-position] reason=${reasonText} side=${side} left=${Math.round(pos.left)} top=${Math.round(pos.top)}`,
        );
      });
    }

    function dockPanelToEdge(side, reason = 'unknown') {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] dockPanelToEdge: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][panel-dock-skip] reason=${reasonText} missing-root-or-panel`);
        return;
      }

      if (!isEdgeAutoHideEnabled()) {
        appendLog(`[TOOLBOX_EDGE][panel-dock-skip] reason=${reasonText} disabled`);
        return;
      }

      const rawSide = String(side || '').trim();

      if (!isAutoHideTriggerSide(rawSide)) {
        appendLog(`[TOOLBOX_EDGE][panel-dock-skip] reason=${reasonText} side=${rawSide || '-'} only-right-enabled`);
        return;
      }

      const nextSide = EDGE_AUTO_HIDE_SIDE;

      clearEdgeRevealTimer();

      rememberLastPanelVisibleRect(`dock:${reasonText}`);

      savePanelPositionFromDom(`dock-panel-to-edge:${reasonText}`);

      root.classList.remove(
        'cgpt-edge-hidden',
        'cgpt-edge-right',
      );
      root.dataset.snapEdge = '';

      applyEdgeHiddenPosition();

      root.dataset.edgeSide = nextSide;
      root.classList.add('cgpt-toolbox-edge-hidden');
      root.classList.remove('cgpt-toolbox-edge-revealed');

      panel.classList.remove('cgpt-toolbox-hidden');

      MemoryManager.set(MemoryManager.KEYS.edgeHidden, true);
      MemoryManager.set(MemoryManager.KEYS.edgeSide, nextSide);
      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

      appendLog(`[TOOLBOX_EDGE][panel-dock] side=${nextSide} reason=${reasonText} horizontal=true`);

      normalizeEdgeVisualState(`dock:${reasonText}`);

      updateEdgeHotzone(`dock:${reasonText}`);
      updateRestoreHotzone(`dock:${reasonText}`);
      showRestoreHandle('edge-hidden');
    }

    function restorePanelFromEdgeHidden(reason = 'unknown') {
      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] restorePanelFromEdgeHidden: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][panel-restore-skip] reason=${String(reason || 'unknown')} missing-root-or-panel`);
        return;
      }

      const reasonText = String(reason || 'unknown');
      const wasEdgeDocked =
        isEdgeHidden() || root.classList.contains('cgpt-toolbox-edge-revealed');

      if (!wasEdgeDocked) {
        appendLog(`[TOOLBOX_EDGE][panel-restore-skip] reason=${reasonText} not-edge-docked`);
        return;
      }

      clearEdgeRevealTimer();

      hideEdgeHotzone(`restore:${reasonText}`);
      hideRestoreHotzone(`restorePanelFromEdgeHidden:${reasonText}`);
      hideRestoreHandle(`restorePanelFromEdgeHidden:${reasonText}`);

      const size = normalizePanelSize(
        MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
      );

      edgeRestoreClickGuardUntil = Date.now() + 300;

      if (
        reasonText.includes('toggle-click')
        || reasonText.includes('edge-hotzone-click')
        || reasonText.includes('pin:')
      ) {
        edgeRehideGuardUntil = Date.now() + 1200;
      }

      clearEdgeHiddenStateClasses();

      panel.classList.remove('cgpt-toolbox-hidden');

      MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);
      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

      normalizeEdgeVisualState(`restore:${reasonText}`);

      applyPanelSize(size);

      const skipReposition = reasonText.includes('toggle-drag-out') || reasonText.includes('drag-out');

      if (skipReposition) {
        keepPanelInViewport({
          save: false,
        });

        scheduleClampRootToViewport('edge-reveal(skip-reposition)', {
          save: true,
          allowEdgeHidden: false,
        });

        updateEdgeAutoHide();
        hideRestoreHotzone(`restorePanelFromEdgeHidden:${reasonText}`);

        appendLog(`[TOOLBOX_EDGE][panel-restore] reason=${reasonText} horizontal=true reposition=skip-drag-out`);
        return;
      }

      window.requestAnimationFrame(() => {
        const pos = buildRestorePositionFromEdge(size);
        applyPanelPosition(pos.left, pos.top);

        scheduleClampRootToViewport('edge-reveal', {
          save: true,
          allowEdgeHidden: false,
        });

        updateEdgeAutoHide();
        rememberLastPanelVisibleRect(`restorePanelFromEdgeHidden:${reasonText}`);

        appendLog(`[TOOLBOX_EDGE][panel-restore] reason=${reasonText} horizontal=true`);
      });
    }

    function pinRevealedEdgePanel(reason = 'unknown') {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] pinRevealedEdgePanel: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][pin-skip] reason=${reasonText} missing-root-or-panel`);
        return false;
      }

      if (!isEdgeHidden()) {
        appendLog(`[TOOLBOX_EDGE][pin-skip] reason=${reasonText} not-edge-hidden`);
        return false;
      }

      if (!root.classList.contains('cgpt-toolbox-edge-revealed')) {
        appendLog(`[TOOLBOX_EDGE][pin-skip] reason=${reasonText} not-revealed`);
        return false;
      }

      clearEdgeRevealTimer();
      edgeRehideGuardUntil = Date.now() + 1200;
      restorePanelFromEdgeHidden(`pin:${reasonText}`);
      appendLog(`[TOOLBOX_EDGE][pin] reason=${reasonText}`);
      return true;
    }

    function maybeAutoHideAtEdge(reason = 'unknown') {
      if (isDraggingToolbox || Date.now() < edgeAutoHideSuspendUntil) {
        appendLog(
          `[TOOLBOX_EDGE][auto-hide-skip] reason=${reason || '-'} dragging=${isDraggingToolbox ? 1 : 0} suspend=${Date.now() < edgeAutoHideSuspendUntil ? 1 : 0}`,
        );
        return;
      }

      if (!root || !panel) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=no-root-or-panel');
        return;
      }

      if (!isEdgeAutoHideEnabled()) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=disabled');
        return;
      }

      if (isEdgeHidden()) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=already-edge-hidden');
        return;
      }

      if (panel.classList.contains('cgpt-toolbox-hidden')) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=panel-hidden');
        return;
      }

      const rect = panel.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        console.warn('[ChatGPT toolbox] maybeAutoHideAtEdge: invalid panel rect', rect);
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=invalid-panel-rect');
        return;
      }

      const side = getNearestAutoHideSide(rect);
      const touching = side ? isStrictlyTouchingEdge(rect, side) : false;

      appendLog(
        `[TOOLBOX_EDGE][auto-hide-check] reason=${reason} left=${Math.round(rect.left)} right=${Math.round(window.innerWidth - rect.right)} top=${Math.round(rect.top)} bottom=${Math.round(window.innerHeight - rect.bottom)} side=${side || '-'} touching=${touching}`,
      );

      if (!side) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=not-near-edge');
        return;
      }

      if (!touching) {
        appendLog(`[TOOLBOX_EDGE][auto-hide-skip] reason=near-but-not-touching side=${side}`);
        return;
      }

      dockPanelToEdge(side, reason);
    }

    function setEdgeAutoHideEnabled(enabled) {
      const next = !!enabled;

      MemoryManager.set(MemoryManager.KEYS.edgeAutoHideEnabled, next);

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] setEdgeAutoHideEnabled: root/panel 未初始化');
        appendLog(
          `[SETTINGS][edgeAutoHide] ${next ? '已开启' : '已关闭'}，但 root/panel 未初始化，无法同步 UI`,
        );
        return;
      }

      if (!next) {
        clearEdgeRevealTimer();
        hideEdgeHotzone('settings-disabled');

        if (isEdgeHidden() || root.classList.contains('cgpt-toolbox-edge-revealed')) {
          restorePanelFromEdgeHidden('settings-disabled');
        }

        clearFloatEdgeHiddenClasses();
        clearEdgeHiddenStateClasses();

        panel.classList.remove('cgpt-toolbox-hidden');

        MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);
        MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

        appendLog('[SETTINGS][edgeAutoHide] 已关闭，并清理当前贴边隐藏状态');
        return;
      }

      updateEdgeAutoHide();

      appendLog('[SETTINGS][edgeAutoHide] 已开启');
    }

    function clampPanelRect(rect) {
      const mins = getPanelMinSize();

      const width = Math.max(mins.minWidth, Math.min(rect.width, window.innerWidth - PANEL_VIEWPORT_MARGIN * 2));
      const height = Math.max(mins.minHeight, Math.min(rect.height, window.innerHeight - PANEL_VIEWPORT_MARGIN * 2));

      let left = rect.left;
      let top = rect.top;

      const maxLeft = window.innerWidth - width - PANEL_VIEWPORT_MARGIN;
      const maxTop = window.innerHeight - height - PANEL_VIEWPORT_MARGIN;

      left = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(left, maxLeft));
      top = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop));

      return {
        left,
        top,
        width,
        height,
      };
    }

    function applyPanelRect(rect) {
      if (!panel || !root) {
        console.warn('[ChatGPT toolbox] applyPanelRect: panel root 未初始化');
        return;
      }

      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      panel.style.width = `${Math.round(rect.width)}px`;
      panel.style.height = `${Math.round(rect.height)}px`;

      applyPanelPosition(rect.left, rect.top);
    }

    function resizePanelByPointer(dir, start, pointerX, pointerY) {
      const dx = pointerX - start.pointerX;
      const dy = pointerY - start.pointerY;

      const mins = getPanelMinSize();
      const maxSize = getPanelMaxSize();

      let nextLeft = start.left;
      let nextTop = start.top;
      let nextWidth = start.width;
      let nextHeight = start.height;

      if (dir.includes('e')) {
        nextWidth = start.width + dx;
      }

      if (dir.includes('s')) {
        nextHeight = start.height + dy;
      }

      if (dir.includes('w')) {
        nextWidth = start.width - dx;
        nextLeft = start.left + dx;
      }

      if (dir.includes('n')) {
        nextHeight = start.height - dy;
        nextTop = start.top + dy;
      }

      if (nextWidth < mins.minWidth) {
        if (dir.includes('w')) {
          nextLeft = start.left + start.width - mins.minWidth;
        }
        nextWidth = mins.minWidth;
      }

      if (nextHeight < mins.minHeight) {
        if (dir.includes('n')) {
          nextTop = start.top + start.height - mins.minHeight;
        }
        nextHeight = mins.minHeight;
      }

      if (nextWidth > maxSize.width) {
        if (dir.includes('w')) {
          nextLeft = start.left + start.width - maxSize.width;
        }
        nextWidth = maxSize.width;
      }

      if (nextHeight > maxSize.height) {
        if (dir.includes('n')) {
          nextTop = start.top + start.height - maxSize.height;
        }
        nextHeight = maxSize.height;
      }

      const clamped = clampPanelRect({
        left: nextLeft,
        top: nextTop,
        width: nextWidth,
        height: nextHeight,
      });

      applyPanelRect(clamped);
    }

    function startPanelResize(e) {
      if (!(e.currentTarget instanceof HTMLElement)) return;

      const dir = e.currentTarget.getAttribute('data-resize-dir') || '';
      if (!dir) return;

      e.preventDefault();
      e.stopPropagation();

      if (!panel || !root) {
        console.warn('[ChatGPT toolbox] startPanelResize: panel root 未初始化');
        return;
      }

      ensureRootPositionAnchored();

      const startRect = panel.getBoundingClientRect();

      const start = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        left: startRect.left,
        top: startRect.top,
        width: startRect.width,
        height: startRect.height,
      };

      panel.classList.add('cgpt-resizing');
      clearEdgeRevealTimer();
      isResizingToolbox = true;

      const activePointerId = e.pointerId;

      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== activePointerId) return;

        moveEvent.preventDefault();

        resizePanelByPointer(dir, start, moveEvent.clientX, moveEvent.clientY);
      };

      const onUp = (upEvent) => {
        if (upEvent.pointerId !== activePointerId) return;

        panel.classList.remove('cgpt-resizing');
        isResizingToolbox = false;

        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        schedulePostDragLayout(() => {
          keepPanelInViewport({
            save: false,
          });
          clampRootToViewport('resize-end', {
            save: false,
            allowEdgeHidden: false,
          });
          syncToolboxFloatingLayout('panel-resize-end');

          if (isPanelVisibleNow()) {
            savePanelPositionFromDom('resize-end');
          }
        });

        savePanelSizeFromDom({
          userAction: true,
          reason: 'resize-handle-pointerup',
        });

        if (isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed')) {
          scheduleHidePanelToEdge('resize-end', 500);
        }

        if (isEdgeHidden()) {
          updateEdgeHotzone('resize-end');
        }

        rememberLastPanelVisibleRect('resize-end');
        updateRestoreHotzone('resize-end');

        if (e.currentTarget.hasPointerCapture && e.currentTarget.hasPointerCapture(activePointerId)) {
          try {
            e.currentTarget.releasePointerCapture(activePointerId);
          } catch (err) {
            console.debug('[ChatGPT toolbox] resize releasePointerCapture failed', err);
          }
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);

      try {
        e.currentTarget.setPointerCapture(activePointerId);
      } catch (err) {
        console.debug('[ChatGPT toolbox] resize setPointerCapture failed', err);
      }
    }

    function bindPanelResizeHandles() {
      if (!panel) return;
      if (panel.dataset.resizeHandlesBound === '1') return;

      panel.dataset.resizeHandlesBound = '1';

      qsa('.cgpt-resize-handle', panel).forEach((handle) => {
        handle.addEventListener('pointerdown', startPanelResize);
      });
    }

    function readToolboxLayoutFlagsFromDom() {
      if (!root) {
        return {
          panel_hidden: false,
          edge_docked: false,
          edge_revealed: false,
          floating_hidden: false,
          hidden: false,
        };
      }

      const panel_hidden = isPanelHiddenNow();
      const edge_docked = isEdgeHidden() && !root.classList.contains('cgpt-toolbox-edge-revealed');
      const edge_revealed = isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed');
      const floating_hidden = isFloatingEdgeHidden();

      return {
        panel_hidden,
        edge_docked,
        edge_revealed,
        floating_hidden,
        hidden: panel_hidden || edge_docked || floating_hidden,
      };
    }

    function collectToolboxLayoutState() {
      const flags = readToolboxLayoutFlagsFromDom();
      const layout = {
        mode: compactMode ? 'compact' : 'full',
        hidden: flags.hidden,
        panel_hidden: flags.panel_hidden,
        edge_docked: flags.edge_docked,
        edge_revealed: flags.edge_revealed,
        floating_hidden: flags.floating_hidden,
        edge_hidden: flags.edge_docked,
        anchor: (root && root.dataset && root.dataset.snapEdge) || '',
        updatedAt: Date.now(),
      };
      if (panel) {
        const rect = panel.getBoundingClientRect();
        layout.x = Math.round(rect.left);
        layout.y = Math.round(rect.top);
        layout.width = Math.round(rect.width);
        layout.height = Math.round(rect.height);
      }
      return layout;
    }

    function saveToolboxLayoutState(reason = '') {
      const layout = collectToolboxLayoutState();
      saveToolboxPageStatePatch(
        { layout_state: layout },
        reason || 'save-toolbox-layout',
      );
      appendLog(
        `[TOOLBOX][LAYOUT][save] reason=${reason || '-'} `
          + `panel_hidden=${layout.panel_hidden ? 1 : 0} `
          + `edge_docked=${layout.edge_docked ? 1 : 0} `
          + `edge_revealed=${layout.edge_revealed ? 1 : 0} `
          + `floating_hidden=${layout.floating_hidden ? 1 : 0} mode=${layout.mode}`,
      );
    }

    function readSavedPanelPosition() {
      const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null);

      if (!saved || typeof saved !== 'object') {
        return null;
      }

      const left = Number(saved.left);
      const top = Number(saved.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
      }

      return {
        left,
        top,
        mode: saved.mode || 'panel',
        edge: saved.edge || '',
        updatedAt: Number(saved.updatedAt || 0),
      };
    }

    function applySavedPanelPosition(reason = '') {
      if (!panel) {
        console.warn('[ChatGPT toolbox] applySavedPanelPosition: panel 未初始化');
        return false;
      }

      const saved = readSavedPanelPosition();

      if (!saved) {
        appendLog(`[TOOLBOX_POSITION][RESTORE_SKIP] reason=${reason || '-'} noSavedPosition=1`);
        return false;
      }

      const pos = clampPanelPosition({
        left: saved.left,
        top: saved.top,
      });

      applyPanelPosition(pos.left, pos.top);

      if (root) {
        root.dataset.snapEdge = saved.edge || '';
      }

      appendLog(
        `[TOOLBOX_POSITION][RESTORE_GLOBAL] reason=${reason || '-'} left=${pos.left} top=${pos.top} savedLeft=${saved.left} savedTop=${saved.top}`,
      );

      return true;
    }

    function applyToolboxLayoutStateFromPage(pageState, reason = '') {
      const layout = pageState && pageState.layout_state;

      if (!layout || typeof layout !== 'object') {
        return false;
      }

      const savedGlobal = readSavedPanelPosition();
      const layoutUpdatedAt = Number(layout.updatedAt || 0);
      const globalUpdatedAt = Number(savedGlobal && savedGlobal.updatedAt || 0);

      const wantPanelHidden = layout.panel_hidden === true
        || (layout.hidden === true && layout.edge_docked !== true && layout.floating_hidden !== true);
      const wantEdgeDocked = layout.edge_docked === true || layout.edge_hidden === true;
      const wantFloatingHidden = layout.floating_hidden === true;
      const wantAnyHidden = wantPanelHidden || wantEdgeDocked || wantFloatingHidden || layout.hidden === true;
      const currentlyHidden = isToolboxInAnyHiddenState();

      if (wantAnyHidden !== currentlyHidden || wantEdgeDocked !== isEdgeHidden()) {
        if (!wantAnyHidden) {
          showPanel({ save: false, reason: reason || 'restore-layout-visible' });
          setFloatingEdgeHidden(false, reason || 'restore-layout-visible');
          clearFloatEdgeHiddenClasses();
          root.classList.remove('cgpt-toolbox-edge-hidden', 'cgpt-toolbox-edge-revealed');
          updateEdgeAutoHide();
        } else if (wantEdgeDocked) {
          hidePanel({ save: false, reason: reason || 'restore-layout-edge-docked' });
          setFloatingEdgeHidden(false, reason || 'restore-layout-edge-docked');
          root.classList.add('cgpt-toolbox-edge-hidden');
          if (layout.edge_revealed === true) {
            root.classList.add('cgpt-toolbox-edge-revealed');
          } else {
            root.classList.remove('cgpt-toolbox-edge-revealed');
          }
          clearFloatEdgeHiddenClasses();
          normalizeEdgeVisualState(reason || 'restore-layout-edge-docked');
        } else {
          hidePanel({ save: false, reason: reason || 'restore-layout-hidden' });
          if (wantFloatingHidden) {
            setFloatingEdgeHidden(true, reason || 'restore-layout-floating-hidden');
          } else if (isEdgeAutoHideEnabled()) {
            updateEdgeAutoHide();
          }
        }
      } else if (wantEdgeDocked && layout.edge_revealed === true && !root.classList.contains('cgpt-toolbox-edge-revealed')) {
        root.classList.add('cgpt-toolbox-edge-revealed');
        normalizeEdgeVisualState(reason || 'restore-layout-edge-revealed');
      }

      if (
        layout.x != null &&
        layout.y != null &&
        panel &&
        !layout.hidden &&
        layoutUpdatedAt > 0 &&
        layoutUpdatedAt >= globalUpdatedAt
      ) {
        const pos = clampPanelPosition({
          left: Number(layout.x),
          top: Number(layout.y),
        });

        applyPanelPosition(pos.left, pos.top);

        MemoryManager.set(MemoryManager.KEYS.panelPosition, {
          ...pos,
          mode: 'panel',
          edge: layout.anchor || '',
          updatedAt: layoutUpdatedAt || Date.now(),
        });

        appendLog(
          `[TOOLBOX][LAYOUT][apply-page-position] reason=${reason || '-'} left=${pos.left} top=${pos.top} source=page`,
        );

        return true;
      }

      appendLog(
        `[TOOLBOX][LAYOUT][skip-page-position] reason=${reason || '-'} layoutUpdatedAt=${layoutUpdatedAt} globalUpdatedAt=${globalUpdatedAt}`,
      );

      return false;
    }

    function savePanelPositionFromDom(reason = '') {
      if (!panel) {
        console.warn('[ChatGPT toolbox] savePanelPositionFromDom: panel 未初始化');
        return;
      }

      const rect = panel.getBoundingClientRect();

      const pos = clampPanelPosition({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
      });

      const panelPosition = {
        ...pos,
        mode: 'panel',
        edge: root && root.dataset ? (root.dataset.snapEdge || '') : '',
        updatedAt: Date.now(),
      };

      MemoryManager.set(MemoryManager.KEYS.panelPosition, panelPosition);

      saveToolboxLayoutState(reason || 'panel-drag-end');
      saveCurrentToolboxBaseState(reason || 'panel-drag-end');

      appendLog(
        `[TOOLBOX_POSITION][SAVE_PANEL] reason=${reason || '-'} left=${pos.left} top=${pos.top}`,
      );
    }

    function keepPanelInViewport(options = {}) {
      if (!panel) {
        console.warn('[ChatGPT toolbox] keepPanelInViewport: panel 未初始化');
        return;
      }

      if (panel.classList.contains('cgpt-toolbox-hidden')) {
        return;
      }

      if (root && isEdgeHidden()) {
        return;
      }

      const shouldSave = options.save === true;
      const rect = panel.getBoundingClientRect();

      let nextLeft = rect.left;
      let nextTop = rect.top;

      if (rect.left < PANEL_VIEWPORT_MARGIN) {
        nextLeft = PANEL_VIEWPORT_MARGIN;
      }

      if (rect.right > window.innerWidth - PANEL_VIEWPORT_MARGIN) {
        nextLeft = window.innerWidth - rect.width - PANEL_VIEWPORT_MARGIN;
      }

      if (rect.top < PANEL_VIEWPORT_MARGIN) {
        nextTop = PANEL_VIEWPORT_MARGIN;
      }

      if (rect.bottom > window.innerHeight - PANEL_VIEWPORT_MARGIN) {
        nextTop = window.innerHeight - rect.height - PANEL_VIEWPORT_MARGIN;
      }

      nextLeft = Math.max(PANEL_VIEWPORT_MARGIN, nextLeft);
      nextTop = Math.max(PANEL_VIEWPORT_MARGIN, nextTop);

      if (
        Math.abs(nextLeft - rect.left) > 0.5 ||
        Math.abs(nextTop - rect.top) > 0.5
      ) {
        applyPanelPosition(nextLeft, nextTop);
      }

      if (shouldSave) {
        savePanelPositionFromDom('keepPanelInViewport');
      }

      updateFloatingTitlePosition(options.reason || 'keep-panel');
    }

    function getFloatingTitleEl() {
      if (!root) return null;

      let floatingTitle = qs('#cgpt-toolbox-floating-title', root);
      if (!floatingTitle) {
        ensureFloatingTitleElement();
        floatingTitle = qs('#cgpt-toolbox-floating-title', root);
      }

      return floatingTitle;
    }

    function isPanelVisibleNow() {
      if (!root || !panel) return false;
      if (panel.classList.contains('cgpt-toolbox-hidden')) return false;
      if (root.classList.contains('cgpt-toolbox-panel-hidden')) return false;
      if (root.classList.contains('cgpt-edge-hidden')) return false;
      const edgeDocked =
        root.classList.contains('cgpt-toolbox-edge-hidden') &&
        !root.classList.contains('cgpt-toolbox-edge-revealed');
      if (edgeDocked) return false;
      const style = window.getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0 &&
        rect.width > 10 &&
        rect.height > 10
      );
    }

    function getCurrentToolboxDragBaseRect() {
      if (panel && isPanelVisibleNow()) {
        return panel.getBoundingClientRect();
      }

      if (root) {
        return root.getBoundingClientRect();
      }

      return null;
    }

    function finishFloatingTitleDrag(state, wasMoved) {
      if (state && state.dragRafId) {
        window.cancelAnimationFrame(state.dragRafId);
        state.dragRafId = 0;
      }

      clearDragVisualState();

      if (wasMoved) {
        if (isPanelVisibleNow()) {
          savePanelPositionFromDom('floating-title-drag-end');
        } else if (root) {
          const rect = root.getBoundingClientRect();

          MemoryManager.saveToolboxPatch({
            panelPosition: {
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              mode: 'left-top',
              edge: root.dataset.snapEdge || '',
              updatedAt: Date.now(),
            },
          });

          saveCurrentToolboxBaseState('floating-title-drag-end-hidden');

          appendLog(
            `[TOOLBOX_TITLE_DRAG][save-hidden-position] left=${Math.round(rect.left)} top=${Math.round(rect.top)}`,
          );
        }

        updateFloatingTitlePosition('floating-title-drag-end');

        appendLog('[TOOLBOX_TITLE_DRAG][end] moved=1');
      } else {
        appendLog('[TOOLBOX_TITLE_DRAG][end] moved=0');
      }
    }

    function bindFloatingTitleToggleEvents() {
      const floatingTitle = getFloatingTitleEl();

      if (!floatingTitle) {
        appendLog('[TOOLBOX_TITLE][bind-skip] floatingTitle 不存在');
        return;
      }

      if (floatingTitle.dataset.toggleBound === '1') {
        return;
      }

      floatingTitle.dataset.toggleBound = '1';
      floatingTitle.setAttribute('role', 'button');
      floatingTitle.setAttribute('tabindex', '0');
      floatingTitle.title = `${getToolboxTitle()}：点击展开/收起，拖拽移动`;

      floatingTitle.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) {
          return;
        }

        if (!root) {
          appendLog('[TOOLBOX_TITLE_DRAG][down-skip] reason=no-root');
          return;
        }

        const rect = getCurrentToolboxDragBaseRect();

        if (!rect) {
          appendLog('[TOOLBOX_TITLE_DRAG][down-skip] reason=no-base-rect');
          return;
        }

        floatingTitleDragState = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          moved: false,
          dragRafId: 0,
          latestDx: 0,
          latestDy: 0,
          wasHidden: isToolboxInAnyHiddenState(),
        };

        try {
          floatingTitle.setPointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] floatingTitle setPointerCapture failed', err);
          appendLog(`[TOOLBOX_TITLE_DRAG][error] setPointerCapture failed: ${errText}`);
        }

        appendLog(
          `[TOOLBOX_TITLE_DRAG][down] left=${Math.round(rect.left)} top=${Math.round(rect.top)} hidden=${floatingTitleDragState.wasHidden ? 1 : 0}`,
        );

        e.preventDefault();
        e.stopPropagation();
      });

      floatingTitle.addEventListener('pointermove', (e) => {
        if (!floatingTitleDragState) return;
        if (e.pointerId !== floatingTitleDragState.pointerId) return;

        const dx = e.clientX - floatingTitleDragState.startClientX;
        const dy = e.clientY - floatingTitleDragState.startClientY;
        const movedDistance = Math.sqrt(dx * dx + dy * dy);

        if (movedDistance >= DRAG_CLICK_THRESHOLD) {
          if (!floatingTitleDragState.moved) {
            floatingTitleDragState.moved = true;
            isDraggingToolbox = true;
            suppressToggleClick = true;

            root.classList.add('cgpt-toolbox-dragging');
            addGlobalDraggingClass();

            edgeAutoHideSuspendUntil = Date.now() + 2000;

            appendLog('[TOOLBOX_TITLE_DRAG][start]');
          }
        }

        if (!floatingTitleDragState.moved) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        floatingTitleDragState.latestDx = dx;
        floatingTitleDragState.latestDy = dy;

        if (floatingTitleDragState.dragRafId) {
          return;
        }

        floatingTitleDragState.dragRafId = window.requestAnimationFrame(() => {
          if (!floatingTitleDragState || !root) return;

          floatingTitleDragState.dragRafId = 0;

          const nextLeft = floatingTitleDragState.startLeft + floatingTitleDragState.latestDx;
          const nextTop = floatingTitleDragState.startTop + floatingTitleDragState.latestDy;

          applyDragPosition(nextLeft, nextTop, 'floating-title-dragging');
        });
      });

      floatingTitle.addEventListener('pointerup', (e) => {
        if (!floatingTitleDragState) return;
        if (e.pointerId !== floatingTitleDragState.pointerId) return;

        const state = floatingTitleDragState;
        const wasMoved = state.moved;

        try {
          floatingTitle.releasePointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] floatingTitle releasePointerCapture failed', err);
          appendLog(`[TOOLBOX_TITLE_DRAG][error] releasePointerCapture failed: ${errText}`);
        }

        finishFloatingTitleDrag(state, wasMoved);

        floatingTitleDragState = null;
        isDraggingToolbox = false;

        if (wasMoved) {
          suppressToggleClick = true;
        }

        window.setTimeout(() => {
          suppressToggleClick = false;
        }, TOGGLE_CLICK_SUPPRESS_MS);

        e.preventDefault();
        e.stopPropagation();
      });

      floatingTitle.addEventListener('pointercancel', (e) => {
        if (!floatingTitleDragState) return;

        const state = floatingTitleDragState;
        const wasMoved = state.moved;

        try {
          floatingTitle.releasePointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] floatingTitle pointercancel releasePointerCapture failed', err);
          appendLog(`[TOOLBOX_TITLE_DRAG][error] pointercancel releasePointerCapture failed: ${errText}`);
        }

        finishFloatingTitleDrag(state, wasMoved);

        floatingTitleDragState = null;
        isDraggingToolbox = false;
        suppressToggleClick = true;

        window.setTimeout(() => {
          suppressToggleClick = false;
        }, TOGGLE_CLICK_SUPPRESS_MS);
      });

      floatingTitle.addEventListener('click', (e) => {
        if (suppressToggleClick) {
          appendLog('[TOOLBOX_TITLE][click-skip] reason=suppress-after-drag');
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (isDraggingToolbox || isResizingToolbox) {
          appendLog('[TOOLBOX_TITLE][click-skip] reason=dragging-or-resizing');
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (isToolboxInAnyHiddenState()) {
          restoreToolboxFromHiddenState('floating-title-click');
        } else {
          hidePanel({
            reason: 'floating-title-click',
            skipEdgeAutoHide: true,
          });
        }

        appendLog(
          `[TOOLBOX_TITLE][toggle] hidden=${panel && panel.classList.contains('cgpt-toolbox-hidden') ? 1 : 0}`,
        );
      });

      floatingTitle.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (isToolboxInAnyHiddenState()) {
          restoreToolboxFromHiddenState('floating-title-keyboard');
        } else {
          hidePanel({
            reason: 'floating-title-keyboard',
            skipEdgeAutoHide: true,
          });
        }

        appendLog(
          `[TOOLBOX_TITLE][keyboard-toggle] key=${e.key} hidden=${panel && panel.classList.contains('cgpt-toolbox-hidden') ? 1 : 0}`,
        );
      });

      appendLog('[TOOLBOX_TITLE][bind-ok]');
    }

    function updateFloatingTitlePosition(reason = '') {
      const title = getFloatingTitleEl();
      if (!title || !root) {
        return;
      }

      const hiddenState = isToolboxInAnyHiddenState();

      if (!isDraggingToolbox && !isPanelVisibleNow() && !hiddenState) {
        title.style.display = 'none';
        return;
      }

      title.style.display = 'inline-flex';

      const titleRect = title.getBoundingClientRect();
      const gap = 6;
      const margin = PANEL_VIEWPORT_MARGIN;
      let targetLeft;
      let targetTop;
      let source = 'unknown';

      if (panel && isPanelVisibleNow()) {
        const panelRect = panel.getBoundingClientRect();
        targetLeft = panelRect.left;
        targetTop = panelRect.top - titleRect.height - gap;
        source = 'panel-visible';
      } else if (hiddenState) {
        const locked = getLockedHiddenTitlePosition(`update-title:${reason || '-'}`);

        if (locked) {
          targetLeft = locked.left;
          targetTop = locked.top;
          source = 'hidden-title-locked';
        } else if (
          lastPanelVisibleRect &&
          Number.isFinite(Number(lastPanelVisibleRect.left)) &&
          Number.isFinite(Number(lastPanelVisibleRect.top))
        ) {
          targetLeft = Number(lastPanelVisibleRect.left);
          targetTop = Math.max(margin, Number(lastPanelVisibleRect.top) - titleRect.height - gap);
          source = 'last-panel-visible-fallback';
        } else {
          const savedPos = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
          targetLeft = Number.isFinite(Number(savedPos.left)) ? Number(savedPos.left) : margin;
          targetTop = Number.isFinite(Number(savedPos.top))
            ? Math.max(margin, Number(savedPos.top) - titleRect.height - gap)
            : margin;
          source = 'saved-panel-position-fallback';
        }
      } else {
        const rootRect = root.getBoundingClientRect();
        targetLeft = rootRect.left;
        targetTop = rootRect.top;
        source = 'root-visible-fallback';
      }
      const safeLeft = clampNumber(
        targetLeft,
        margin,
        window.innerWidth - titleRect.width - margin,
      );
      const safeTop = clampNumber(
        targetTop,
        margin,
        window.innerHeight - titleRect.height - margin,
      );

      title.style.left = `${Math.round(safeLeft)}px`;
      title.style.top = `${Math.round(safeTop)}px`;
      title.style.right = 'auto';
      title.style.bottom = 'auto';

      const reasonText = reason || '-';
      if (reasonText.indexOf('drag') >= 0) {
        appendLog(
          `[TOOLBOX_DRAG][drag-title-position] left=${Math.round(safeLeft)} top=${Math.round(safeTop)} reason=${reasonText}`,
        );
      } else {
        appendLog(
          `[TOOLBOX_TITLE][position] reason=${reasonText} source=${source} left=${Math.round(safeLeft)} top=${Math.round(safeTop)}`,
        );
      }
    }

    function keepToggleFullyInViewport(reason = '') {
      if (!root) return;

      const toggle = qs(`#${APP.toggleId}`, root);
      if (!toggle) return;

      const style = window.getComputedStyle(toggle);
      if (style.display === 'none') return;

      const rect = toggle.getBoundingClientRect();
      const margin = PANEL_VIEWPORT_MARGIN;
      let dx = 0;
      let dy = 0;

      if (rect.left < margin) {
        dx = margin - rect.left;
      } else if (rect.right > window.innerWidth - margin) {
        dx = window.innerWidth - margin - rect.right;
      }

      if (rect.top < margin) {
        dy = margin - rect.top;
      } else if (rect.bottom > window.innerHeight - margin) {
        dy = window.innerHeight - margin - rect.bottom;
      }

      if (dx === 0 && dy === 0) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const nextLeft = rootRect.left + dx;
      const nextTop = rootRect.top + dy;

      root.style.left = `${Math.round(nextLeft)}px`;
      root.style.top = `${Math.round(nextTop)}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';

      appendLog(
        `[TOOLBOX_TOGGLE][clamp] reason=${reason || '-'} dx=${Math.round(dx)} dy=${Math.round(dy)} left=${Math.round(nextLeft)} top=${Math.round(nextTop)}`,
      );
    }

    function syncToolboxFloatingLayout(reason = '') {
      if (isEdgeHidden()) {
        if (
          !root.classList.contains('cgpt-toolbox-edge-revealed') ||
          isToolboxInAnyHiddenState()
        ) {
          updateFloatingTitlePosition(reason || 'sync');
        }
        return;
      }

      if (panel && isPanelVisibleNow()) {
        keepPanelInViewport({
          save: false,
        });
        updateFloatingTitlePosition(reason || 'sync');
        return;
      }

      if (isPanelHiddenNow() || isToolboxInAnyHiddenState()) {
        updateFloatingTitlePosition(reason || 'sync');
        return;
      }

      updateFloatingTitlePosition(reason || 'sync');
    }

    function restorePanelSize() {
      const key = getPanelSizeMemoryKey();
      const saved = MemoryManager.get(key, null);
      const fallback = getPanelSizeFallback();

      if (saved && saved.width && saved.height) {
        applyPanelSize(saved);
        window.setTimeout(() => {
          keepPanelInViewport({
            save: false,
          });
        }, 0);
        return;
      }

      applyPanelSize(fallback);
      window.setTimeout(() => {
        keepPanelInViewport({
          save: false,
        });
      }, 0);
    }

    function savePanelSizeFromDom(options = {}) {
      if (!panel) return;

      if (options.userAction !== true) {
        return;
      }

      if (isEdgeHidden()) return;

      if (panel.classList.contains('cgpt-toolbox-hidden')) return;

      const rect = panel.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        console.warn('[ChatGPT toolbox] savePanelSizeFromDom: invalid rect', rect);
        appendLog('[TOOLBOX_SIZE][save-skip] reason=invalid-rect');
        return;
      }

      const next = normalizePanelSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });

      const key = options.key || getPanelSizeMemoryKey();

      MemoryManager.set(key, next);

      appendLog(
        `[TOOLBOX_SIZE][save] reason=${options.reason || '-'} key=${key} width=${next.width} height=${next.height} compact=${compactMode ? 1 : 0}`,
      );

      keepPanelInViewport({
        save: false,
      });
    }

    function bindPanelResizePersistence() {
      if (!panel || panelResizeObserver) return;

      if (typeof ResizeObserver !== 'function') {
        console.warn('[ChatGPT toolbox] ResizeObserver 不可用，跳过面板尺寸观察');
        return;
      }

      panelResizeObserver = new ResizeObserver(() => {
        if (isDraggingToolbox || isResizingToolbox) {
          return;
        }

        keepPanelInViewport({
          save: false,
        });

        syncToolboxFloatingLayout('panel-resize-observer');
      });

      panelResizeObserver.observe(panel);
    }

    function clearFloatEdgeHiddenClasses() {
      if (!root) return;

      root.classList.remove(
        'cgpt-edge-hidden',
        TOOLBOX_FLOATING_HIDDEN_CLASS,
        'cgpt-edge-right',
      );
    }

    const EDGE_STATE_CLASSES = Object.freeze([
      'cgpt-toolbox-edge-hidden',
      'cgpt-toolbox-edge-revealed',
      'cgpt-toolbox-panel-hidden',
      'cgpt-edge-hidden',
      TOOLBOX_FLOATING_HIDDEN_CLASS,
      'cgpt-edge-right',
    ]);

    function clearRootEdgeState(reason = '') {
      if (!root) return;

      root.classList.remove(...EDGE_STATE_CLASSES);
      root.removeAttribute('data-edge-side');
      root.removeAttribute('data-snap-edge');
      delete root.dataset.edgeSide;
      delete root.dataset.snapEdge;
      root.style.transform = '';
      root.style.opacity = '';
      root.style.pointerEvents = '';

      appendLog(`[TOOLBOX_EDGE][clear-root-state] reason=${reason || '-'}`);
    }

    function forcePanelVisible(reason = '') {
      if (!panel) return;

      panel.classList.remove('cgpt-toolbox-hidden');
      panel.style.display = 'flex';
      panel.style.pointerEvents = 'auto';
      panel.style.visibility = 'visible';
      panel.style.opacity = '1';

      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
      MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);

      appendLog(`[TOOLBOX_EDGE][force-panel-visible] reason=${reason || '-'}`);
    }

    function clearEdgeHiddenStateClasses() {
      clearRootEdgeState('clearEdgeHiddenStateClasses');
    }

    function keepRootInViewport(options = {}) {
      if (!root) {
        console.warn('[ChatGPT toolbox] keepRootInViewport: root 未初始化');
        return;
      }

      const rect = getRootRect();

      if (!rect) return;

      setRootLeftTop(rect.left, rect.top, {
        save: options.save === true,
      });

      if (root.dataset.snapEdge) {
        snapRootToEdge({
          log: false,
        });
      }
    }

    function getRootRect() {
      if (!root) return null;
      return root.getBoundingClientRect();
    }

    function setRootLeftTop(left, top, options = {}) {
      if (!root) return;

      const rect = getRootRect();
      const width = rect ? rect.width : 100;
      const height = rect ? rect.height : 40;

      const safeLeft = Math.max(
        PANEL_VIEWPORT_MARGIN,
        Math.min(window.innerWidth - width, left),
      );

      const safeTop = Math.max(
        PANEL_VIEWPORT_MARGIN,
        Math.min(window.innerHeight - height - PANEL_VIEWPORT_MARGIN, top),
      );

      root.style.left = `${safeLeft}px`;
      root.style.top = `${safeTop}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';

      if (options.save) {
        const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        const panelPosition = {
          ...saved,
          left: safeLeft,
          top: safeTop,
          mode: 'left-top',
          edge: root.dataset.snapEdge || saved.edge || '',
          updatedAt: Date.now(),
        };
        MemoryManager.set(MemoryManager.KEYS.panelPosition, panelPosition);
        saveCurrentToolboxBaseState(options.reason || 'set-root-left-top');
      }
    }


    function snapRootToEdge(options = {}) {
      if (!root) return false;

      const rect = root.getBoundingClientRect();
      const rightDistance = window.innerWidth - rect.right;

      let left = rect.left;
      const top = rect.top;
      let edge = '';
      let shouldDock = false;

      if (rightDistance <= getEdgeContactLimit()) {
        edge = EDGE_AUTO_HIDE_SIDE;
        left = window.innerWidth - rect.width;
        shouldDock = true;
      }

      if (shouldDock) {
        setRootLeftTop(left, top, {
          save: false,
        });

        const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        const panelPosition = {
          ...saved,
          left,
          top,
          mode: 'left-top',
          edge,
          updatedAt: Date.now(),
        };
        MemoryManager.set(MemoryManager.KEYS.panelPosition, panelPosition);
        saveCurrentToolboxBaseState('snap-root-to-edge');

        root.dataset.snapEdge = edge;

        if (isEdgeAutoHideEnabled()) {
          dockPanelToEdge(edge, 'toggle-drag-snap');

          if (options.log) {
            appendLog(`[TOOLBOX_DRAG][snap] edge=${edge} left=${Math.round(left)} top=${Math.round(top)} docked=true touching=true`);
          }

          return true;
        }
      }

      root.dataset.snapEdge = '';

      const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
      const panelPosition = {
        ...saved,
        left: rect.left,
        top: rect.top,
        mode: 'left-top',
        edge: '',
        updatedAt: Date.now(),
      };
      MemoryManager.set(MemoryManager.KEYS.panelPosition, panelPosition);
      saveCurrentToolboxBaseState('snap-root-clear-edge');

      updateEdgeAutoHide();

      if (options.log) {
        appendLog(
          `[TOOLBOX_DRAG][snap] edge=- left=${Math.round(rect.left)} top=${Math.round(rect.top)} docked=false touching=false rightDistance=${Math.round(rightDistance)}`,
        );
      }

      return false;
    }

    function isPanelHiddenNow() {
      return !!(
        (panel && panel.classList.contains('cgpt-toolbox-hidden')) ||
        (root && root.classList.contains('cgpt-toolbox-panel-hidden'))
      );
    }

    function syncPanelHiddenClass(reason = '') {
      if (!root || !panel) return;
      const hidden = panel.classList.contains('cgpt-toolbox-hidden');
      root.classList.toggle('cgpt-toolbox-panel-hidden', hidden);
      appendLog(
        `[TOOLBOX_PANEL][visibility-class] reason=${reason || '-'} hidden=${hidden}`,
      );
    }

    function updateEdgeAutoHide() {
      if (!root) return;

      if (Date.now() < forceShowingUntil) {
        root.classList.remove(
          'cgpt-toolbox-edge-hidden',
          'cgpt-toolbox-edge-revealed',
          'cgpt-edge-hidden',
          'cgpt-edge-right',
        );

        if (panel) {
          panel.classList.remove('cgpt-toolbox-hidden');
        }

        hideRestoreHotzone('force-show-updateEdgeAutoHide');
        hideRestoreHandle('force-show-updateEdgeAutoHide');
        hideEdgeHotzone('force-show-updateEdgeAutoHide');

        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=force-show-active');
        return;
      }

      if (isEdgeHidden()) {
        clearFloatEdgeHiddenClasses();
        appendLog('[TOOLBOX_EDGE][float-auto-hide-skip] reason=panel-edge-hidden');
        updateRestoreHotzone('updateEdgeAutoHide');
        repairInvisibleToolboxState('updateEdgeAutoHide-edge');
        return;
      }

      const enabled = isEdgeAutoHideEnabled();
      const edge = root.dataset.snapEdge || '';
      const panelHidden = isPanelHiddenNow();
      const shouldHide = enabled && edge === EDGE_AUTO_HIDE_SIDE && panelHidden && !isEdgeHidden();

      setFloatingEdgeHidden(shouldHide, 'updateEdgeAutoHide');

      appendLog(
        `[TOOLBOX_EDGE][float-auto-hide-check] enabled=${enabled} panelHidden=${panelHidden} edge=${edge || '-'} shouldHide=${shouldHide} horizontal=true`,
      );

      if (shouldHide) {
        appendLog(`[TOOLBOX_EDGE][float-auto-hide] edge=${edge} horizontal=true`);
      }

      updateRestoreHotzone('updateEdgeAutoHide');
      repairInvisibleToolboxState('updateEdgeAutoHide');
    }

    function showPanel(options = {}) {
      restoreToolboxFromHiddenState(options.reason || 'showPanel', options);

      if (options.save !== false) {
        saveCurrentToolboxBaseState(options.reason || 'panel-show');
      }
    }

    function hidePanel(options = {}) {
      if (!panel || !root) return;

      const reason = options.reason || 'hidePanel';
      rememberLastPanelVisibleRect(reason);

      if (options.save !== false) {
        savePanelPositionFromDom(`${reason}:save-visible-panel`);
      }

      const anchored = anchorRootToHiddenTogglePosition(reason);

      if (!anchored) {
        const rect = panel.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          const fallbackPos = {
            left: Number(rect.left),
            top: Math.max(PANEL_VIEWPORT_MARGIN, Number(rect.top) - (HIDDEN_TOGGLE_SIZE.height || 34) - 6),
          };
          saveHiddenTitlePosition(fallbackPos, `${reason}:fallback`);
          const lockedFallback = getLockedHiddenTitlePosition(`${reason}:fallback-locked`);
          if (lockedFallback) {
            applyRootPosition(lockedFallback.left, lockedFallback.top);
            appendLog(
              `[TOOLBOX_HIDE_ANCHOR][fallback-apply] reason=${reason || '-'} left=${Math.round(lockedFallback.left)} top=${Math.round(lockedFallback.top)} panelLeft=${Math.round(Number(rect.left))} panelTop=${Math.round(Number(rect.top))}`,
            );
          } else {
            console.warn('[ChatGPT toolbox] hidePanel fallback locked position missing', rect);
            appendLog(
              `[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} missing-locked-fallback`,
            );
          }
        } else {
          console.warn('[ChatGPT toolbox] hidePanel fallback apply skipped: invalid panel rect', rect);
          appendLog(
            `[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} invalid-panel-rect`,
          );
        }
      }

      panel.classList.add('cgpt-toolbox-hidden');
      root.classList.add('cgpt-toolbox-panel-hidden');

      if (options.saveGlobal !== false) {
        MemoryManager.set(MemoryManager.KEYS.panelHidden, true);
      }

      if (options.save !== false) {
        saveToolboxLayoutState(options.reason || 'panel-hide');
        saveCurrentToolboxBaseState(options.reason || 'panel-hide');
      }

      const edge = root?.dataset?.snapEdge || '';
      appendLog(`[TOOLBOX_EDGE][panel-hide] edge=${edge || '-'}`);

      syncPanelHiddenClass(reason);

      updateFloatingTitlePosition(`hide-panel:${reason}`);

      updateRestoreHotzone(reason);
      hideRestoreHandle(`${reason}:floating-title-primary`);

      window.requestAnimationFrame(() => {
        updateFloatingTitlePosition(`hide-panel:${reason}:raf`);

        window.setTimeout(() => {
          if (!isFloatingTitleActuallyVisible()) {
            showRestoreHandle('hidePanel:floating-title-missing', {
              force: true,
            });
          }
        }, 120);
      });

      if (options.skipEdgeAutoHide !== true) {
        updateEdgeAutoHide();
      }
    }

    function togglePanelHidden() {
      if (!panel) {
        console.warn('[ChatGPT toolbox] togglePanelHidden: panel 不存在');
        appendLog('[TOOLBOX_EDGE][toggle] panel 不存在');
        return;
      }

      if (isToolboxInAnyHiddenState()) {
        restoreToolboxFromHiddenState('toggle-panel-hidden');
      } else {
        hidePanel();
      }
    }

    function restorePanelForToggleDragOut(reason) {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] restorePanelForToggleDragOut: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][drag-out-restore-skip] reason=${reasonText} missing-root-or-panel`);
        return;
      }

      if (isEdgeHidden()) {
        clearHiddenTitlePosition(`drag-out:${reasonText}`);
        restorePanelFromEdgeHidden(reasonText);
        appendLog(`[TOOLBOX_EDGE][drag-out-restore] type=panel-edge-hidden reason=${reasonText}`);
        return;
      }

      if (root.classList.contains('cgpt-edge-hidden') || panel.classList.contains('cgpt-toolbox-hidden')) {
        clearHiddenTitlePosition(`drag-out:${reasonText}`);
        root.dataset.snapEdge = '';

        root.classList.remove(
          'cgpt-edge-hidden',
          'cgpt-edge-right',
        );

        panel.classList.remove('cgpt-toolbox-hidden');
        if (root) {
          root.classList.remove('cgpt-toolbox-panel-hidden');
        }
        MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
        syncPanelHiddenClass('restorePanelForToggleDragOut');

        updateEdgeAutoHide();

        appendLog(`[TOOLBOX_EDGE][drag-out-restore] type=float-edge-hidden reason=${reasonText}`);
        return;
      }

      appendLog(`[TOOLBOX_EDGE][drag-out-restore-skip] reason=${reasonText} type=normal`);
    }

    function revealFloatBallTemporarily(reason = 'hover') {
      if (!root) return;

      if (!isPanelHiddenNow() || isEdgeHidden()) return;

      const wasFloatHidden = root.classList.contains('cgpt-edge-hidden');

      clearFloatEdgeHiddenClasses();

      if (wasFloatHidden) {
        appendLog(`[TOOLBOX_EDGE][float-restore] reason=${reason}`);
      }
    }

    function bindEdgeHoverReveal() {
      if (!root) return;

      if (root.dataset.edgeHoverBound === '1') {
        return;
      }

      root.dataset.edgeHoverBound = '1';

      const onEdgeHoverEnter = () => {
        if (isDraggingToolbox) {
          return;
        }

        if (isEdgeHidden()) {
          revealPanelFromEdgeHover('root-hover');
          updateEdgeHotzone('root-hover');
        }
      };

      const onEdgeHoverLeave = (reason) => {
        if (isDraggingToolbox) {
          return;
        }

        if (edgeHotzoneHovering) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reason} hotzone-hovering`);
          return;
        }

        if (isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed')) {
          scheduleHidePanelToEdge(reason, 700);
        }
      };

      root.addEventListener('mouseenter', onEdgeHoverEnter);
      root.addEventListener('mouseleave', () => {
        onEdgeHoverLeave('root-or-panel-leave');
      });

      if (panel) {
        panel.addEventListener('mouseenter', onEdgeHoverEnter);
        panel.addEventListener('mouseleave', () => {
          onEdgeHoverLeave('root-or-panel-leave');
        });
      }
    }

    function bindPanelPinOnClick() {
      if (!panel) return;
      if (panel.dataset.edgePinBound === '1') {
        return;
      }

      panel.dataset.edgePinBound = '1';

      const handlePin = (e) => {
        if (isDraggingToolbox || isResizingToolbox) {
          return;
        }

        if (!root || !panel) {
          return;
        }

        if (!isEdgeHidden()) {
          return;
        }

        if (!root.classList.contains('cgpt-toolbox-edge-revealed')) {
          return;
        }

        const target = e && e.target instanceof Element ? e.target : null;
        if (target && target.closest('.cgpt-resize-handle')) {
          return;
        }

        if (target && target.closest([
          '#cgpt-copy-last-message-scroll-bottom',
          '#cgpt-upload-continue-once',
          '#cgpt-upload-start-send',
          '#cgpt-upload-start',
          '.cgpt-upload-quick-prompt-chip',
          '.cgpt-btn',
          'button',
          'input',
          'textarea',
          'select',
          '[contenteditable="true"]',
          '[role="textbox"]',
        ].join(','))) {
          appendLog('[TOOLBOX_EDGE][pin-skip] reason=action-or-editable-target');
          return;
        }

        pinRevealedEdgePanel('panel-pointerdown');
      };

      panel.addEventListener('pointerdown', handlePin, true);
    }

    function bindToggleDrag() {
      const toggle = qs(`#${APP.toggleId}`, root);

      if (!toggle) {
        console.warn('[ChatGPT toolbox] bindToggleDrag: toggle 不存在');
        return;
      }

      if (toggle.dataset.dragBound === '1') {
        return;
      }

      toggle.dataset.dragBound = '1';

      const finishToggleDrag = (state, wasMoved) => {
        if (state.dragRafId) {
          window.cancelAnimationFrame(state.dragRafId);
          state.dragRafId = 0;
        }

        state.committedDx = state.latestDx;
        state.committedDy = state.latestDy;

        clearDragVisualState();

        if (wasMoved && root) {
          const finalLeft = state.startLeft + state.committedDx;
          const finalTop = state.startTop + state.committedDy;

          root.style.left = `${Math.round(finalLeft)}px`;
          root.style.top = `${Math.round(finalTop)}px`;
          root.style.right = 'auto';
          root.style.bottom = 'auto';

          root.dataset.snapEdge = '';

          appendLog(
            `[TOOLBOX_DRAG][toggle-up] left=${Math.round(finalLeft)} top=${Math.round(finalTop)}`,
          );

          schedulePostDragLayout(() => {
            clampRootToViewport('toggle-drag-end', {
              save: true,
              allowEdgeHidden: true,
            });
            keepToggleFullyInViewport('toggle-drag-end');
            const docked = snapRootToEdge({
              log: true,
            });
            keepToggleFullyInViewport('toggle-drag-end-after-snap');

            if (!docked) {
              saveCurrentRootPosition('drag-end', {
                mode: 'left-top',
              });
            } else {
              saveCurrentRootPosition('drag-end');
            }
          });
        } else {
          appendLog('[TOOLBOX_DRAG][toggle-up] moved=false');
        }
      };

      toggle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (!root) return;

        clearEdgeRevealTimer();

        const wasPanelEdgeHidden = isEdgeHidden();
        const wasFloatEdgeHidden = root.classList.contains('cgpt-edge-hidden');
        const wasPanelHidden = isPanelHiddenNow();
        const wasHiddenBeforeDrag = wasPanelEdgeHidden || wasFloatEdgeHidden || wasPanelHidden;

        ensureRootPositionAnchored();

        const rect = root.getBoundingClientRect();

        toggleDragState = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          startWidth: rect.width,
          startHeight: rect.height,
          latestDx: 0,
          latestDy: 0,
          committedDx: 0,
          committedDy: 0,
          dragRafId: 0,
          moved: false,
          restoreApplied: false,
          restoredFromHidden: wasHiddenBeforeDrag,
          wasPanelEdgeHidden,
          wasFloatEdgeHidden,
          wasPanelHidden,
        };

        appendLog(
          `[TOOLBOX_DRAG][toggle-down] left=${Math.round(rect.left)} top=${Math.round(rect.top)} edgeHidden=${wasPanelEdgeHidden ? '1' : '0'} floatHidden=${wasFloatEdgeHidden ? '1' : '0'} panelHidden=${wasPanelHidden ? '1' : '0'}`,
        );

        try {
          toggle.setPointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] setPointerCapture failed', err);
          appendLog(`[TOOLBOX_DRAG][error] setPointerCapture failed: ${errText}`);
        }

        e.preventDefault();
      });

      toggle.addEventListener('pointermove', (e) => {
        if (!toggleDragState) return;
        if (e.pointerId !== toggleDragState.pointerId) return;

        const dx = e.clientX - toggleDragState.startClientX;
        const dy = e.clientY - toggleDragState.startClientY;
        const movedDistance = Math.sqrt(dx * dx + dy * dy);

        if (movedDistance >= DRAG_CLICK_THRESHOLD) {
          if (!toggleDragState.moved) {
            toggleDragState.moved = true;
            suppressToggleClick = true;
            isDraggingToolbox = true;

            if (!toggleDragState.restoreApplied) {
              toggleDragState.restoreApplied = true;

              if (
                toggleDragState.wasPanelEdgeHidden ||
                toggleDragState.wasFloatEdgeHidden ||
                toggleDragState.wasPanelHidden
              ) {
                exitEdgeHiddenStateForDragStart();
                restorePanelForToggleDragOut('toggle-drag-start');
              }

              root.style.transform = '';
              root.classList.add('cgpt-toolbox-dragging');
              addGlobalDraggingClass();
              edgeAutoHideSuspendUntil = Date.now() + 2000;

              const floatingTitle = getFloatingTitleEl();
              if (floatingTitle && panel && isPanelVisibleNow() && !isEdgeHidden()) {
                floatingTitle.style.display = 'inline-flex';
                updateFloatingTitlePosition('toggle-drag-start');
                appendLog('[TOOLBOX_DRAG][drag-start-title] visible=1');
              }

              appendLog('[TOOLBOX_DRAG][restore-before-real-drag]');
            }
          }
        }

        if (!toggleDragState.moved) return;

        edgeAutoHideSuspendUntil = Date.now() + 800;

        e.preventDefault();

        toggleDragState.latestDx = dx;
        toggleDragState.latestDy = dy;

        if (toggleDragState.dragRafId) return;

        toggleDragState.dragRafId = window.requestAnimationFrame(() => {
          toggleDragState.dragRafId = 0;

          if (!toggleDragState || !root) return;

          toggleDragState.committedDx = toggleDragState.latestDx;
          toggleDragState.committedDy = toggleDragState.latestDy;

          edgeAutoHideSuspendUntil = Date.now() + 800;

          const nextLeft = toggleDragState.startLeft + toggleDragState.committedDx;
          const nextTop = toggleDragState.startTop + toggleDragState.committedDy;
          applyDragPosition(nextLeft, nextTop, 'toggle-dragging');
        });
      });

      toggle.addEventListener('pointerup', (e) => {
        if (!toggleDragState) return;
        if (e.pointerId !== toggleDragState.pointerId) return;

        const state = toggleDragState;
        const wasMoved = state.moved;

        try {
          toggle.releasePointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] releasePointerCapture failed', err);
          appendLog(`[TOOLBOX_DRAG][error] releasePointerCapture failed: ${errText}`);
        }

        finishToggleDrag(state, wasMoved);

        toggleDragState = null;
        isDraggingToolbox = false;

        if (wasMoved) {
          suppressToggleClick = true;
        }

        window.setTimeout(() => {
          suppressToggleClick = false;
        }, TOGGLE_CLICK_SUPPRESS_MS);

        e.preventDefault();
      });

      toggle.addEventListener('pointercancel', (e) => {
        if (!toggleDragState) return;

        const state = toggleDragState;
        const wasMoved = state.moved;

        try {
          toggle.releasePointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] releasePointerCapture failed', err);
          appendLog(`[TOOLBOX_DRAG][error] pointercancel releasePointerCapture failed: ${errText}`);
        }

        finishToggleDrag(state, wasMoved);

        toggleDragState = null;
        isDraggingToolbox = false;
        suppressToggleClick = true;

        window.setTimeout(() => {
          suppressToggleClick = false;
        }, TOGGLE_CLICK_SUPPRESS_MS);

        if (!wasMoved) {
          updateEdgeAutoHide();
        }
      });

      toggle.addEventListener('mouseenter', () => {
        if (isDraggingToolbox) {
          return;
        }

        if (isEdgeHidden()) {
          revealPanelFromEdgeHover('toggle-hover');
          return;
        }

        revealFloatBallTemporarily('hover');

        if (isFloatingEdgeHidden()) {
          setFloatingEdgeHidden(false, 'toggle-hover-reveal');
        }
      });

      toggle.addEventListener('mouseleave', () => {
        if (isDraggingToolbox) {
          return;
        }

        if (isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed')) {
          scheduleHidePanelToEdge('toggle-leave', 450);
          return;
        }

        updateEdgeAutoHide();
      });

      toggle.addEventListener('click', () => {
        if (suppressToggleClick) {
          suppressToggleClick = false;
          appendLog('[TOOLBOX_EDGE][toggle-click-skip] reason=suppress-after-drag');
          return;
        }

        if (isEdgeHidden()) {
          restorePanelFromEdgeHidden('toggle-click');
          appendLog('[TOOLBOX_EDGE][toggle-click] action=restore-edge-hidden');
          return;
        }

        if (root && root.classList.contains('cgpt-edge-hidden')) {
          clearFloatEdgeHiddenClasses();
          showPanel();
          appendLog('[TOOLBOX_EDGE][toggle-click] action=restore-float-hidden');
          return;
        }

        if (Date.now() < edgeRestoreClickGuardUntil) {
          appendLog('[TOOLBOX_EDGE][toggle-click-skip] reason=restore-guard');
          return;
        }

        togglePanelHidden();
      });
    }

    function bindDrag() {
      const handle = qs('#cgpt-toolbox-drag-handle', root);
      if (!handle) return;

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      let activePointerId = null;
      let dragRafId = 0;
      let latestDx = 0;
      let latestDy = 0;
      let committedDx = 0;
      let committedDy = 0;

      const onPointerMove = (e) => {
        if (!dragging) return;
        if (activePointerId !== null && e.pointerId !== activePointerId) return;

        e.preventDefault();

        latestDx = e.clientX - startX;
        latestDy = e.clientY - startY;

        if (dragRafId) return;

        dragRafId = window.requestAnimationFrame(() => {
          dragRafId = 0;

          if (!dragging || !root) return;

          committedDx = latestDx;
          committedDy = latestDy;

          edgeAutoHideSuspendUntil = Date.now() + 800;

          const nextLeft = startLeft + committedDx;
          const nextTop = startTop + committedDy;
          applyDragPosition(nextLeft, nextTop, 'panel-dragging');
        });
      };

      const stopDrag = (e) => {
        if (!dragging) return;
        if (activePointerId !== null && e && e.pointerId !== activePointerId) return;

        committedDx = latestDx;
        committedDy = latestDy;

        const finalLeft = startLeft + committedDx;
        const finalTop = startTop + committedDy;

        dragging = false;
        isDraggingToolbox = false;

        if (dragRafId) {
          window.cancelAnimationFrame(dragRafId);
          dragRafId = 0;
        }

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', stopDrag);
        window.removeEventListener('pointercancel', stopDrag);

        clearDragVisualState();

        if (isPanelVisibleNow()) {
          applyPanelPosition(finalLeft, finalTop);
        } else {
          applyRootPosition(finalLeft, finalTop);
        }

        if (e && handle.hasPointerCapture && handle.hasPointerCapture(e.pointerId)) {
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.warn('[ChatGPT toolbox] drag handle releasePointerCapture failed', err);
            appendLog(`[TOOLBOX_DRAG][error] handle releasePointerCapture failed: ${errText}`);
          }
        }

        activePointerId = null;

        appendLog(`[TOOLBOX_DRAG][drag-end] left=${Math.round(finalLeft)} top=${Math.round(finalTop)} panelVisible=${isPanelVisibleNow() ? 1 : 0}`);

        schedulePostDragLayout(() => {
          keepPanelInViewport({
            save: false,
          });
          updateFloatingTitlePosition('panel-drag-end');
          appendLog('[TOOLBOX_DRAG][drag-end-title] visible=1');
          savePanelPositionFromDom('panel-drag-end');
          rememberLastPanelVisibleRect('panel-drag-end');
          updateRestoreHotzone('panel-drag-end');
        });

        window.setTimeout(() => {
          if (!isDraggingToolbox) {
            maybeAutoHideAtEdge('drag-end-delayed');
          }
        }, 180);
      };

      handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('button')) return;

        if (isEdgeHidden()) {
          restorePanelFromEdgeHidden('header-drag-start');
        }

        exitEdgeHiddenStateForDragStart();
        clearEdgeRevealTimer();

        dragging = true;
        isDraggingToolbox = true;
        activePointerId = e.pointerId;

        let pos;
        if (isPanelVisibleNow() && panel) {
          pos = panel.getBoundingClientRect();
        } else {
          ensureRootPositionAnchored();
          pos = getRootCurrentPosition();
        }
        startX = e.clientX;
        startY = e.clientY;
        startLeft = pos.left;
        startTop = pos.top;

        latestDx = 0;
        latestDy = 0;
        committedDx = 0;
        committedDy = 0;

        if (root) {
          root.style.transform = '';
          root.classList.add('cgpt-toolbox-dragging');
        }

        addGlobalDraggingClass();

        e.preventDefault();

        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', stopDrag);
        window.addEventListener('pointercancel', stopDrag);

        try {
          handle.setPointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] drag handle setPointerCapture failed', err);
          appendLog(`[TOOLBOX_DRAG][error] handle setPointerCapture failed: ${errText}`);
        }

        appendLog(`[TOOLBOX_DRAG][drag-start] left=${Math.round(startLeft)} top=${Math.round(startTop)}`);
      });
    }


    function getHost(name) {
      create();
      return qs(`#cgpt-${name}-tab-host`, root);
    }

    function inferStatusType(text, type) {
      const normalizedType = String(type || '').trim().toLowerCase();
      if ([
        'idle',
        'running',
        'success',
        'warn',
        'error',
        'offline',
        'online',
        'danger',
      ].includes(normalizedType)) {
        return normalizedType;
      }
      const value = String(text || '');
      if (/失败|错误|异常|超时|缺少|不可用|无法|未找到/.test(value)) {
        return 'error';
      }
      if (/离线|未绑定|需要重新绑定|需要重新授权|暂无|未知/.test(value)) {
        return 'warn';
      }
      if (/等待回答|正在等待回答|正在等待回复|等待回复|回答中/.test(value)) {
        return 'danger';
      }
      if (/等待|正在|上传中|复制中|同步中|处理中|轮询中/.test(value)) {
        return 'running';
      }
      if (/成功|完成|已复制|已上传|已发送|在线|已绑定/.test(value)) {
        return 'success';
      }
      return 'idle';
    }

    function ensureStatusBadge() {
      create();
      let badge = qs('#cgpt-toolbox-status-badge', root);
      if (badge) {
        return badge;
      }
      badge = document.createElement('span');
      badge.id = 'cgpt-toolbox-status-badge';
      badge.className = 'cgpt-toolbox-status-badge cgpt-status-idle';
      badge.textContent = '就绪';
      const headerActions = qs('.cgpt-toolbox-header-actions', root);
      const header = qs('.cgpt-toolbox-header', root);
      if (headerActions) {
        headerActions.insertBefore(badge, headerActions.firstChild);
      } else if (header) {
        header.appendChild(badge);
      } else {
        root.appendChild(badge);
      }
      return badge;
    }

    function shouldPersistStatus(statusType, text, options) {
      const opts = options || {};

      if (opts.persist === true) {
        return true;
      }

      if (opts.persist === false) {
        return false;
      }

      const value = String(text || '');

      if (
        statusType === 'error'
        || statusType === 'warn'
        || statusType === 'danger'
        || statusType === 'offline'
        || statusType === 'online'
      ) {
        return true;
      }

      if (/等待|正在|上传中|同步中|发送中|回答中|处理中|轮询中/.test(value)) {
        return true;
      }

      if (/失败|错误|异常|超时|离线|未绑定|不可用/.test(value)) {
        return true;
      }

      return false;
    }

    function buildShortStatusText(text, statusType, options) {
      const opts = options || {};

      if (opts.shortText) {
        return String(opts.shortText);
      }

      const value = String(text || '');

      if (statusType === 'error') {
        return '失败';
      }

      if (statusType === 'warn') {
        if (/未绑定/.test(value)) return '未绑定';
        if (/页面异常/.test(value)) return '页面异常';
        return '提醒';
      }

      if (statusType === 'danger') {
        if (/等待回答/.test(value)) return '等回答';
        if (/正在等待回复|等待回复/.test(value)) return '等回复';
        if (/回答中/.test(value)) return '回答中';
        return '等待中';
      }

      if (statusType === 'offline') {
        return '离线';
      }

      if (statusType === 'online') {
        if (/可发送/.test(value)) return '可发送';
        if (/待输入/.test(value)) return '待输入';
        if (/已连接/.test(value)) return '已连接';
        return '在线';
      }

      if (statusType === 'running') {
        if (/回答中/.test(value)) return '回答中';
        if (/生成中/.test(value)) return '生成中';
        if (/等待回答/.test(value)) return '等回答';
        if (/等待发送/.test(value)) return '等发送';
        if (/上传/.test(value)) return '上传中';
        if (/同步/.test(value)) return '同步中';
        if (/复制/.test(value)) return '复制中';
        return '处理中';
      }

      if (statusType === 'success') {
        return '完成';
      }

      return '就绪';
    }

    function isPromptCountStatusText(text) {
      const value = String(text || '').trim();
      return /^\d+\s*条\s*[，,]\s*当前显示\s*\d+\s*条$/.test(value);
    }

    function purgeForbiddenStatusBadge(reason) {
      if (!root) {
        return;
      }

      const badge = qs('#cgpt-toolbox-status-badge', root);

      if (!badge) {
        return;
      }

      const text = String(badge.textContent || '').trim();

      if (!text || isPromptCountStatusText(text)) {
        badge.textContent = '';
        badge.title = '';
        badge.classList.add('cgpt-status-hidden');
        badge.style.display = 'none';
        root.removeAttribute('data-status-type');

        if (window.console && typeof console.debug === 'function') {
          console.debug(
            '[ChatGPT toolbox][STATUS_BADGE][PURGE]',
            reason || '-',
            text || '-',
          );
        }
      }
    }

    function hideStatusBadge() {
      const badge = root ? qs('#cgpt-toolbox-status-badge', root) : null;

      if (!badge) {
        return;
      }

      badge.classList.add('cgpt-status-hidden');
      badge.textContent = '';
      badge.title = '';
      badge.style.display = 'none';
    }

    function setStatus(text, type, options) {
      create();

      const rawStatusText = String(text || '').trim();

      if (isPromptCountStatusText(rawStatusText)) {
        latestStatusText = '';
        hideStatusBadge();
        purgeForbiddenStatusBadge('setStatus-prompt-count');
        return;
      }

      const opts = options || {};
      latestStatusText = rawStatusText;

      const statusType = inferStatusType(latestStatusText, type);
      const persistent = shouldPersistStatus(statusType, latestStatusText, opts);

      if (persistent) {
        const badge = ensureStatusBadge();
        const shortText = buildShortStatusText(latestStatusText, statusType, opts);

        if (badge) {
          badge.style.display = '';
          badge.textContent = shortText || '状态';
          badge.title = latestStatusText || shortText || '';
          badge.classList.remove(
            'cgpt-status-idle',
            'cgpt-status-running',
            'cgpt-status-success',
            'cgpt-status-warn',
            'cgpt-status-error',
            'cgpt-status-danger',
            'cgpt-status-offline',
            'cgpt-status-online',
            'cgpt-status-hidden',
          );
          badge.classList.add(`cgpt-status-${statusType}`);
        }
      } else {
        hideStatusBadge();
      }

      if (root) {
        root.setAttribute('data-status-type', statusType);
      }

      if (!titleEl) {
        titleEl = qs('.cgpt-toolbox-title', root);
      }

      if (titleEl) {
        titleEl.title = latestStatusText
          ? `${getToolboxTitle()} - ${latestStatusText}`
          : getToolboxTitle();
      }

      if (latestStatusText) {
        LogModule.add(`[状态][${statusType}] ${latestStatusText}`);
      }
    }

    function migrateToolboxToastToPanel(reason = '') {
      if (!root || !panel) {
        return;
      }

      const oldRootToast = qs('#cgpt-toolbox-toast', root);
      if (oldRootToast && oldRootToast.parentElement !== panel) {
        panel.appendChild(oldRootToast);
        appendLog(`[TOOLBOX_TOAST][migrate] from=root to=panel reason=${reason || '-'}`);
      }
    }

    function ensureToolboxToast() {
      create();

      if (!panel) {
        panel = root ? qs(`#${APP.panelId}`, root) : null;
      }

      if (!panel) {
        console.warn('[ChatGPT toolbox] ensureToolboxToast: panel 不存在');
        appendLog('[TOOLBOX_TOAST][skip] reason=missing-panel');
        return null;
      }

      let box = qs('#cgpt-toolbox-toast', panel);

      if (!box) {
        const oldBox = root ? qs('#cgpt-toolbox-toast', root) : null;

        if (oldBox) {
          box = oldBox;
          panel.appendChild(box);
        } else {
          box = document.createElement('div');
          box.id = 'cgpt-toolbox-toast';
          box.className = 'cgpt-toolbox-toast';
          panel.appendChild(box);
        }
      }

      return box;
    }

    function showToast(text, type = 'info', timeoutMs = 1400) {
      create();
      const toastType = inferStatusType(text, type);
      const box = ensureToolboxToast();

      if (!box) {
        return;
      }

      box.textContent = String(text || '');
      box.classList.remove(
        'cgpt-toast-idle',
        'cgpt-toast-running',
        'cgpt-toast-success',
        'cgpt-toast-warn',
        'cgpt-toast-error',
        'cgpt-toast-danger',
        'cgpt-toast-offline',
        'cgpt-toast-online',
        'show',
      );
      box.classList.add(`cgpt-toast-${toastType}`);
      window.clearTimeout(box.__cgptToastTimer || 0);
      requestAnimationFrame(() => {
        box.classList.add('show');
      });
      box.__cgptToastTimer = window.setTimeout(() => {
        box.classList.remove('show');
      }, timeoutMs);

      appendLog(
        `[TOOLBOX_TOAST][show] type=${toastType} text=${String(text || '').slice(0, 40)} host=panel`,
      );
    }

    function startToolboxWatchdog() {
      if (toolboxWatchdogTimer) {
        return;
      }

      toolboxWatchdogTimer = window.setInterval(() => {
        try {
          const domRoot = document.getElementById(APP.rootId);

          if (!root && domRoot && isValidShellRoot(domRoot)) {
            root = domRoot;
            panel = qs(`#${APP.panelId}`, root);
            titleEl = qs('.cgpt-toolbox-title', root);
            bindEvents();
            ensureEdgeHotzoneElement();
            ensureRestoreHotzoneElement();
            updateRestoreHotzone('watchdog-adopt');
            appendLog('[TOOLBOX_WATCHDOG][ADOPT] reason=found-existing-dom');
            return;
          }

          if (root && !document.documentElement.contains(root)) {
            document.documentElement.appendChild(root);
            panel = qs(`#${APP.panelId}`, root);
            titleEl = qs('.cgpt-toolbox-title', root);
            bindEvents();
            ensureEdgeHotzoneElement();
            ensureRestoreHotzoneElement();
            updateRestoreHotzone('watchdog-remount');
            appendLog('[TOOLBOX_WATCHDOG][REMOUNT] reason=interval-detached-root');
            return;
          }

          if (!domRoot) {
            root = null;
            panel = null;
            titleEl = null;
            create();
            void mountAllModules('watchdog-recreate');
            appendLog('[TOOLBOX_WATCHDOG][RECREATE] reason=missing-root');
          }
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] toolbox watchdog failed', err);
          appendLog(`[TOOLBOX_WATCHDOG][FAILED] error=${errText}`);
        }
      }, 3000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') {
          return;
        }

        try {
          const domRoot = document.getElementById(APP.rootId);
          if (!domRoot || (root && !document.documentElement.contains(root))) {
            appendLog('[TOOLBOX_WATCHDOG][VISIBILITY_CHECK]');
            create();
            mountAllModules('watchdog-visibility-recreate');
          }

          repairInvisibleToolboxState('watchdog-visibility');
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] visibility watchdog failed', err);
          appendLog(`[TOOLBOX_WATCHDOG][VISIBILITY_FAILED] error=${errText}`);
        }
      });
    }

    function bindGlobalErrorGuard() {
      if (globalErrorGuardBound) {
        return;
      }

      globalErrorGuardBound = true;

      window.addEventListener('error', (event) => {
        const msg = event && event.message ? event.message : 'unknown';
        const file = event && event.filename ? event.filename : '-';
        const line = event && event.lineno ? event.lineno : '-';

        const fileText = String(file || '');
        const msgText = String(msg || '');

        const isToolboxError =
          fileText.includes('chatgpt-toolbox') ||
          fileText.includes('cgpt-toolbox') ||
          msgText.includes('[ChatGPT toolbox]') ||
          msgText.includes('[TOOLBOX_') ||
          msgText.includes('[CGPT_');

        if (!isToolboxError) {
          console.debug('[ChatGPT toolbox] ignored page error', {
            message: msgText,
            file: fileText,
            line,
          });
          return;
        }

        console.error('[ChatGPT toolbox] global toolbox error captured', event.error || event);
        appendLog(`[GLOBAL_ERROR][toolbox] message=${msgText} file=${fileText} line=${line}`);
      }, true);

      window.addEventListener('unhandledrejection', (event) => {
        const reason = event && event.reason
          ? (event.reason.message ? event.reason.message : String(event.reason))
          : 'unknown';

        const stack = event && event.reason && event.reason.stack
          ? String(event.reason.stack).slice(0, 500)
          : '';

        const reasonText = String(reason || '');
        const stackText = String(stack || '');

        const isToolboxRejection =
          reasonText.includes('[ChatGPT toolbox]') ||
          reasonText.includes('[TOOLBOX_') ||
          reasonText.includes('[CGPT_') ||
          stackText.includes('cgpt-toolbox') ||
          stackText.includes('chatgpt-toolbox');

        if (!isToolboxRejection) {
          console.debug('[ChatGPT toolbox] ignored page rejection', {
            reason: reasonText,
            stack: stackText,
          });
          return;
        }

        console.warn('[ChatGPT toolbox] toolbox unhandled rejection captured', event.reason);
        appendLog(`[GLOBAL_REJECTION][toolbox] reason=${reasonText} stack=${stackText}`);
      }, true);
    }

    function appendLog(text) {
      const message = String(text || '');

      if (appendingLog) {
        console.debug('[ChatGPT toolbox][LOG_REENTER]', message);
        return;
      }

      appendingLog = true;

      try {
        if (typeof LogModule !== 'undefined' && LogModule.add) {
          LogModule.add(message);
        } else {
          console.debug('[ChatGPT toolbox][LOG_BEFORE_READY]', message);
        }
      } catch (err) {
        console.error('[ChatGPT toolbox] appendLog failed', err, message);
      } finally {
        appendingLog = false;
      }
    }

    function applyPagePanelPositionFromState(savedPos, reason = '') {
      if (!root || !panel || !savedPos || typeof savedPos !== 'object') {
        return;
      }

      const hasSavedPosition = Number.isFinite(Number(savedPos.left))
        && Number.isFinite(Number(savedPos.top));

      if (!hasSavedPosition) {
        return;
      }

      const savedGlobal = readSavedPanelPosition();
      const pageUpdatedAt = Number(savedPos.updatedAt || 0);
      const globalUpdatedAt = Number(savedGlobal && savedGlobal.updatedAt || 0);

      if (!(pageUpdatedAt > 0 && pageUpdatedAt >= globalUpdatedAt)) {
        appendLog(
          `[TOOLBOX_PAGE_STATE][skip-page-panel-position] reason=${reason || '-'} pageUpdatedAt=${pageUpdatedAt} globalUpdatedAt=${globalUpdatedAt}`,
        );
        return;
      }

      const savedSnapEdge = String(savedPos.edge || '').trim();
      const hidden = isPanelHiddenNow();

      clearFloatEdgeHiddenClasses();
      root.classList.remove('cgpt-toolbox-edge-hidden', 'cgpt-toolbox-edge-revealed');
      root.removeAttribute('data-edge-side');
      delete root.dataset.edgeSide;

      if (savedSnapEdge) {
        root.dataset.snapEdge = savedSnapEdge;
      } else {
        root.dataset.snapEdge = '';
      }

      const pos = clampPanelPosition({
        left: Number(savedPos.left),
        top: Number(savedPos.top),
      });

      if (!hidden) {
        applyPanelPosition(pos.left, pos.top);
      } else {
        root.style.left = `${pos.left}px`;
        root.style.top = `${pos.top}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
      }

      window.requestAnimationFrame(() => {
        if (hidden) {
          keepRootInViewport({
            save: false,
          });
          scheduleClampRootToViewport(reason || 'restore-page-position', {
            save: false,
            allowEdgeHidden: true,
          });

          if (root && root.dataset.snapEdge) {
            snapRootToEdge({
              log: false,
            });
          }
        } else {
          keepPanelInViewport({
            save: false,
          });
        }

        updateEdgeAutoHide();
      });
    }

    async function applyToolboxPageState(reason = '') {
      create();

      const applySeq = ++toolboxPageStateApplySeq;
      const pageKeyAtStart = getToolboxPageKey();
      const state = getToolboxPageState();

      const abortIfStaleApply = () => {
        if (applySeq !== toolboxPageStateApplySeq) {
          appendLog(
            `[TOOLBOX_PAGE_STATE][apply-skip-stale] reason=${reason || '-'} seq=${applySeq} current=${toolboxPageStateApplySeq}`,
          );
          return true;
        }

        if (getToolboxPageKey() !== pageKeyAtStart) {
          appendLog(
            `[TOOLBOX_PAGE_STATE][apply-abort] reason=page-key-changed old=${pageKeyAtStart} current=${getToolboxPageKey()}`,
          );
          return true;
        }

        return false;
      };

      isApplyingToolboxPageState = true;

      try {
        const activeTabField = readToolboxStateField(state, 'activeTab', '');
        const uploadGroupField = readToolboxStateField(
          state,
          'uploadActiveGroupId',
          readToolboxStateField(state, 'upload_active_group_id', ''),
        );
        appendLog(
          `[TOOLBOX_PAGE_STATE][APPLY] reason=${reason || '-'} pageKey=${pageKeyAtStart} seq=${applySeq} `
          + `activeTab=${activeTabField || '-'} uploadActiveGroupId=${uploadGroupField || '-'} `
          + `compactMode=${compactMode ? 'true' : 'false'} isApplyingToolboxPageState=true `
          + `keys=${Object.keys(state).join(',')}`,
        );
        appendLog(
          `[TOOLBOX_PAGE_STATE][apply] reason=${reason || '-'} pageKey=${pageKeyAtStart} seq=${applySeq} keys=${Object.keys(state).join(',')}`,
        );

        if (abortIfStaleApply()) {
          return;
        }

        const activeTab = normalizeTab(readToolboxStateField(state, 'activeTab', 'upload'));
        switchTab(activeTab, {
          save: false,
          reason: reason || 'restore-page-state',
        });

        if (abortIfStaleApply()) {
          return;
        }

        if (typeof UploadModule !== 'undefined'
          && typeof UploadModule.applyToolboxPageState === 'function') {
          await UploadModule.applyToolboxPageState(state, reason);
        }

        if (abortIfStaleApply()) {
          return;
        }
      } catch (error) {
        appendLog(
          `[TOOLBOX_PAGE_STATE][apply-error] reason=${reason || '-'} error=${error && error.stack ? error.stack : String(error)}`,
        );
      } finally {
        if (applySeq === toolboxPageStateApplySeq) {
          isApplyingToolboxPageState = false;
        }
      }
    }

    async function applyConversationToolboxState(reason = '') {
      appendLog(`[TOOLBOX_CONV_STATE][disabled] reason=${reason || '-'}`);
    }

    async function handleRouteChange(reason = '') {
      const nextPageKey = getToolboxPageKey();
      const nextConvKey = getToolboxConversationStateKey();

      if (!lastToolboxPageKey) {
        lastToolboxPageKey = nextPageKey;
        lastToolboxConversationKey = nextConvKey;
        return;
      }

      const pageKeyChanged = nextPageKey !== lastToolboxPageKey;
      const convKeyChanged = nextConvKey !== lastToolboxConversationKey;

      if (!pageKeyChanged && !convKeyChanged) {
        return;
      }

      if (pageKeyChanged) {
        const oldKey = lastToolboxPageKey;
        const oldStates = readAllToolboxPageStates();
        const oldPageState = oldStates[oldKey] && typeof oldStates[oldKey] === 'object'
          ? oldStates[oldKey]
          : {};

        saveToolboxBaseStateForPageKey(oldKey, 'before-page-key-change', {
          url: oldPageState.url || window.location.href,
          pathname: oldPageState.pathname || window.location.pathname,
        });

        lastToolboxPageKey = nextPageKey;

        appendLog(
          `[TOOLBOX_PAGE_STATE][page-change] reason=${reason || '-'} old=${oldKey} next=${nextPageKey}`,
        );

        await applyToolboxPageState('page-key-changed');
      }

      if (convKeyChanged) {
        lastToolboxConversationKey = nextConvKey;
        appendLog(
          `[TOOLBOX_CONV_STATE][conversation-change-skip] reason=${reason || '-'} next=${nextConvKey || '-'} disabled=conversation_state`,
        );
      }
    }

    function checkToolboxPageKeyChanged(reason = '') {
      void handleRouteChange(reason).catch((error) => {
        appendLog(
          `[TOOLBOX_PAGE_STATE][route-change-error] reason=${reason || '-'} error=${error && error.stack ? error.stack : String(error)}`,
        );
      });
    }

    function bindToolboxPageStateRouteWatcher() {
      if (window.__cgptToolboxPageStateWatcherBound) {
        return;
      }

      window.__cgptToolboxPageStateWatcherBound = true;
      lastToolboxPageKey = getToolboxPageKey();
      lastToolboxConversationKey = getToolboxConversationStateKey();

      installUnifiedRouteChangePipeline();

      window.setInterval(() => {
        checkToolboxPageKeyChanged('interval');
      }, 1500);

      appendLog(`[TOOLBOX_PAGE_STATE][route-watch-bind] pageKey=${lastToolboxPageKey}`);
    }

    return {
      create,
      getHost,
      setStatus,
      showToast,
      appendLog,
      purgeForbiddenStatusBadge,
      switchTab,
      restoreActiveTab,
      getActiveTab,
      applyToolboxUiState,
      applyToolboxPageState,
      handleRouteChange,
      setEdgeAutoHideEnabled,
      suspendEdgeAutoHide,
      resetToolboxPosition,
      restoreToolboxFromHiddenState,
    };
  })();

  function isChatSidebarElement(el) {
    if (!el || !el.closest) return false;

    return !!el.closest(
      [
        'aside',
        'nav',
        '[data-testid*="sidebar"]',
        '[data-testid*="history"]',
        '[aria-label*="历史"]',
        '[aria-label*="聊天"]',
        '[aria-label*="Chat history"]',
        '[aria-label*="conversation"]',
      ].join(','),
    );
  }

  function forceScrollContainerToEnd(el, reason = 'unknown') {
    if (!el) return false;

    const reasonText = String(reason || 'unknown');

    try {
      if (
        el === document.scrollingElement ||
        el === document.documentElement ||
        el === document.body
      ) {
        const maxY = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0,
          el.scrollHeight || 0,
        );

        window.scrollTo({
          top: maxY,
          left: 0,
          behavior: 'auto',
        });

        if (document.documentElement) {
          document.documentElement.scrollTop = maxY;
        }

        if (document.body) {
          document.body.scrollTop = maxY;
        }

        return true;
      }

      el.scrollTop = el.scrollHeight;
      return true;
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      console.warn('[ChatGPT toolbox] forceScrollContainerToEnd failed', err);
      ToolboxShell.appendLog(`[CHAT_PAGE][force-end:container-failed] reason=${reasonText} error=${errText}`);
      return false;
    }
  }

  const COMPOSER_AREA_SELECTORS_FOR_MESSAGE = [
    '[data-testid="composer"]',
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    '[data-testid="composer-textarea"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"]',
  ].join(',');

  function isInComposerArea(el) {
    if (!el) return false;
    return !!el.closest(COMPOSER_AREA_SELECTORS_FOR_MESSAGE);
  }

  function getMessageContentElement(el) {
    if (!el) return null;

    const nodes = getMessageContentElements(el);
    if (nodes.length > 0) {
      return nodes[0];
    }

    return el;
  }

  function getMessageContentElements(el) {
    if (!el) return [];

    const selectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"] [data-message-content]',
      '[data-message-author-role="assistant"] .whitespace-pre-wrap',
      '[data-message-author-role="assistant"] [class*="markdown"]',

      '[data-message-author-role="user"] [data-message-content]',
      '[data-message-author-role="user"] .whitespace-pre-wrap',

      '.markdown',
      '[data-message-content]',
      '[class*="markdown"]',
      '.whitespace-pre-wrap',
      'pre',
      'code',
    ];

    const nodes = [];

    selectors.forEach((selector) => {
      qsa(selector, el).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (isInToolbox(node)) return;
        if (isInComposerArea(node)) return;
        if (isChatSidebarElement(node)) return;

        const text = String(node.innerText || node.textContent || '').trim();
        if (!text) return;

        nodes.push(node);
      });
    });

    const unique = [];
    nodes.forEach((node) => {
      const isInsideExisting = unique.some((old) => old !== node && old.contains(node));
      if (isInsideExisting) return;

      for (let i = unique.length - 1; i >= 0; i -= 1) {
        if (node.contains(unique[i])) {
          unique.splice(i, 1);
        }
      }

      if (!unique.includes(node)) {
        unique.push(node);
      }
    });

    unique.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return unique;
  }

  function extractCleanTextFromNode(node) {
    if (!node) return '';

    const clone = node.cloneNode(true);

    clone.querySelectorAll([
      'button',
      'svg',
      'style',
      'script',
      '[aria-hidden="true"]',
      '[data-testid="copy-turn-action-button"]',
      '[data-testid="feedback-actions"]',
      '[data-testid*="feedback"]',
      '[data-testid*="copy"]',
      '[class*="text-token-text-tertiary"]',
    ].join(',')).forEach((child) => {
      child.remove();
    });

    const rawText = String(clone.textContent || clone.innerText || '');
    return cleanCopiedMessageText(rawText);
  }

  function getFullMessageTextFromElement(el) {
    if (!el) {
      return {
        text: '',
        contentNodeCount: 0,
        contentTextChars: 0,
        fullTurnTextChars: 0,
        source: 'empty',
      };
    }

    const contentNodes = getMessageContentElements(el);

    const contentText = contentNodes
      .map((node) => extractCleanTextFromNode(node))
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const fullTurnText = extractCleanTextFromNode(el)
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const cleanFn =
      typeof ChatMessageExtractor !== 'undefined' &&
      ChatMessageExtractor &&
      typeof ChatMessageExtractor.cleanMessageText === 'function'
        ? ChatMessageExtractor.cleanMessageText
        : cleanCopiedMessageText;

    const cleanedContentText = cleanFn(contentText);
    const cleanedFullTurnText = cleanFn(fullTurnText);

    const afterThinkingText = extractFinalAnswerAfterThinkingText(cleanedFullTurnText || fullTurnText);
    const cleanedAfterThinking = cleanFn(afterThinkingText);

    if (afterThinkingText && afterThinkingText.length >= 20 && cleanedAfterThinking.length >= 20) {
      return {
        text: cleanedAfterThinking,
        contentNodeCount: contentNodes.length,
        contentTextChars: cleanedContentText.length,
        fullTurnTextChars: cleanedFullTurnText.length,
        source: 'after-thinking',
      };
    }

    let finalText = cleanedContentText;
    let source = 'content-nodes';

    if (
      cleanedFullTurnText &&
      cleanedFullTurnText.length > cleanedContentText.length * 1.5 &&
      cleanedFullTurnText.length - cleanedContentText.length > 80
    ) {
      finalText = cleanedFullTurnText;
      source = 'full-turn-fallback';
    }

    return {
      text: finalText,
      contentNodeCount: contentNodes.length,
      contentTextChars: cleanedContentText.length,
      fullTurnTextChars: cleanedFullTurnText.length,
      source,
    };
  }

  function cleanCopiedMessageText(text) {
    let value = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const lines = value.split('\n');

    while (lines.length > 0) {
      const first = String(lines[0] || '').trim();

      if (
        /^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)$/i.test(first) ||
        /^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)\s*[:：]$/i.test(first)
      ) {
        lines.shift();
        continue;
      }

      break;
    }

    value = lines.join('\n').trim();

    value = value
      .replace(/^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)\s*[:：]\s*/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return value;
  }

  function getVisibleTextFromElement(el) {
    if (!el) return '';

    const contentEl = getMessageContentElement(el) || el;
    const clone = contentEl.cloneNode(true);

    clone.querySelectorAll([
      'button',
      'svg',
      'style',
      'script',
      '[aria-hidden="true"]',
      '[data-testid="copy-turn-action-button"]',
      '[data-testid="feedback-actions"]',
      '[data-testid*="feedback"]',
      '[data-testid*="copy"]',
      '[class*="text-token-text-tertiary"]',
    ].join(',')).forEach((node) => {
      node.remove();
    });

    const rawText = String(clone.textContent || clone.innerText || '');
    const fullTurnRawText = el !== contentEl
      ? String(el.textContent || el.innerText || '')
      : rawText;

    const afterThinking = extractFinalAnswerAfterThinkingText(fullTurnRawText);

    if (afterThinking && afterThinking.length >= 20) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[CHAT_PAGE][message-extract-after-thinking] chars=${afterThinking.length}`,
        );
      }

      return (
        typeof ChatMessageExtractor !== 'undefined' &&
        ChatMessageExtractor &&
        typeof ChatMessageExtractor.cleanMessageText === 'function'
          ? ChatMessageExtractor.cleanMessageText(afterThinking)
          : cleanCopiedMessageText(afterThinking)
      );
    }

    return cleanCopiedMessageText(rawText);
  }

  function findConversationMessageElements(options = {}) {
    const includeHidden = options.includeHidden === true;
    const selectors = [
      'article[data-testid^="conversation-turn-"]',
      '[data-testid^="conversation-turn-"]',
      '[data-message-author-role]',
    ];

    const seen = new Set();
    const result = [];

    selectors.forEach((selector) => {
      qsa(selector).forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (isInToolbox(el)) return;

        const container = el.closest(
          'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]'
        ) || el;

        if (!(container instanceof HTMLElement)) return;
        if (seen.has(container)) return;
        if (isInToolbox(container)) return;

        if (!includeHidden) {
          const rect = container.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
        }

        seen.add(container);
        result.push(container);
      });
    });

    result.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return result;
  }

  function getChatScrollContainers() {
    const containers = [];

    const add = (el) => {
      if (!el) return;

      if (
        !(el instanceof HTMLElement) &&
        el !== document.scrollingElement &&
        el !== document.documentElement &&
        el !== document.body
      ) {
        return;
      }

      if (isInToolbox(el)) return;
      if (isChatSidebarElement(el)) return;
      if (containers.includes(el)) return;

      containers.push(el);
    };

    add(document.scrollingElement);
    add(document.documentElement);
    add(document.body);

    const candidateSelectors = [
      'main',
      '[role="main"]',
      '[data-testid="conversation-turns"]',
      '[data-testid^="conversation"]',
      '[data-radix-scroll-area-viewport]',
      '.overflow-y-auto',
      '.overflow-auto',
      '[class*="overflow-y-auto"]',
      '[class*="overflow-auto"]',
    ];

    candidateSelectors.forEach((selector) => {
      qsa(selector).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (isInToolbox(node)) return;
        if (isChatSidebarElement(node)) return;

        const canScroll = node.scrollHeight > node.clientHeight + 24;
        if (canScroll) {
          add(node);
        }
      });
    });

    const lastTurn = qsa('[data-testid^="conversation-turn"], [data-message-author-role]')
      .filter((node) => node instanceof HTMLElement)
      .pop();

    let cursor = lastTurn instanceof HTMLElement ? lastTurn.parentElement : null;
    let depth = 0;

    while (cursor && depth < 8) {
      if (!isInToolbox(cursor) && !isChatSidebarElement(cursor)) {
        const canScroll = cursor.scrollHeight > cursor.clientHeight + 24;
        if (canScroll) {
          add(cursor);
        }
      }

      cursor = cursor.parentElement;
      depth += 1;
    }

    ToolboxShell.appendLog(`[CHAT_PAGE][scroll-containers] count=${containers.length}`);

    return containers;
  }

  function saveChatScrollPositionsForCopy(tag = 'copy-last-message') {
    const tagText = String(tag || 'copy-last-message');
    const containers = getChatScrollContainers();
    const snapshots = containers.map((container) => ({
      container,
      scrollTop: container.scrollTop,
      scrollLeft: container.scrollLeft,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    }));

    ToolboxShell.appendLog(`[CHAT_PAGE][${tagText}:save-scroll] count=${snapshots.length}`);

    return snapshots;
  }

  function restoreChatScrollPositions(saved, tag = 'copy-last-message') {
    const tagText = String(tag || 'copy-last-message');

    if (!Array.isArray(saved) || !saved.length) {
      ToolboxShell.appendLog(`[CHAT_PAGE][${tagText}:restore-scroll] count=0 enabled=true`);
      return;
    }

    saved.forEach((item) => {
      const container = item && item.container;

      if (!container) {
        return;
      }

      container.scrollTop = Number(item.scrollTop) || 0;
      container.scrollLeft = Number(item.scrollLeft) || 0;
    });

    ToolboxShell.appendLog(`[CHAT_PAGE][${tagText}:restore-scroll] count=${saved.length} enabled=true`);
  }

  async function forceChatPageToAbsoluteEnd(reason = 'unknown') {
    const reasonText = String(reason || 'unknown');

    const runOnce = (stage) => {
      const containers = getChatScrollContainers();

      containers.forEach((containerEl) => {
        if (isChatSidebarElement(containerEl)) {
          ToolboxShell.appendLog(`[CHAT_PAGE][force-end:skip-sidebar] reason=${reasonText} stage=${stage}`);
          return;
        }

        forceScrollContainerToEnd(containerEl, `${reasonText}:${stage}`);
      });

      ToolboxShell.appendLog(`[CHAT_PAGE][force-end:stage] reason=${reasonText} stage=${stage}`);
    };

    runOnce('immediate');

    await sleep(80);
    runOnce('80ms');

    await sleep(160);
    runOnce('240ms');

    await sleep(260);
    runOnce('500ms');

    await sleep(350);
    runOnce('850ms');

    ToolboxShell.appendLog(`[CHAT_PAGE][force-end:done] reason=${reasonText}`);

    return true;
  }

  function getMessageRole(el) {
    if (!el) return '';

    const direct = el.getAttribute('data-message-author-role');
    if (direct) return String(direct || '').toLowerCase();

    const roleNode = el.querySelector('[data-message-author-role]');
    if (roleNode) {
      return String(roleNode.getAttribute('data-message-author-role') || '').toLowerCase();
    }

    const text = String(el.getAttribute('data-testid') || '').toLowerCase();
    if (text.includes('conversation-turn')) {
      return '';
    }

    return '';
  }

  function getConversationTurnId(el) {
    if (!el) return '';

    const direct = el.getAttribute && el.getAttribute('data-testid');
    if (direct && /^conversation-turn-/i.test(String(direct))) {
      return String(direct);
    }

    const turn = el.closest && el.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]');
    if (turn) {
      return String(turn.getAttribute('data-testid') || '');
    }

    return '';
  }

  function isThinkingBoundaryLine(line) {
    const text = String(line || '').trim();

    if (!text) {
      return false;
    }

    return (
      /^已思考\s*\d+/.test(text) ||
      /^已思考.*秒/.test(text) ||
      /^已思考.*分钟/.test(text) ||
      /^Thought for\s+\d+/i.test(text) ||
      /^Thinking/i.test(text) ||
      /^正在思考/.test(text)
    );
  }

  function isThinkingUiNoiseLine(line) {
    const text = String(line || '').trim();

    if (!text) {
      return false;
    }

    return (
      isThinkingBoundaryLine(text) ||
      text === '展开' ||
      text === '收起' ||
      text === 'Show more' ||
      text === 'Show less'
    );
  }

  function extractFinalAnswerAfterThinkingText(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n');
    const lines = raw.split('\n');

    let boundaryIndex = -1;

    for (let i = 0; i < lines.length; i += 1) {
      if (isThinkingBoundaryLine(lines[i])) {
        boundaryIndex = i;
      }
    }

    if (boundaryIndex < 0) {
      return '';
    }

    const afterLines = lines
      .slice(boundaryIndex + 1)
      .filter((line) => !isThinkingUiNoiseLine(line));

    const afterText = afterLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

    return afterText;
  }

  function isTextBeforeThinkingBoundary(rawText, selectedText) {
    const raw = String(rawText || '');
    const selected = String(selectedText || '').trim();

    if (!raw || !selected) return false;

    const boundaryMatch = raw.search(/已思考\s*\d+|Thought for\s+\d+|Thinking|正在思考/i);
    if (boundaryMatch < 0) return false;

    const selectedIndex = raw.indexOf(selected.slice(0, Math.min(40, selected.length)));

    return selectedIndex >= 0 && selectedIndex < boundaryMatch;
  }

  function chooseAssistantFinalAnswerText(rawText, fallbackText, meta = {}) {
    const cleanFn =
      typeof ChatMessageExtractor !== 'undefined' &&
      ChatMessageExtractor &&
      typeof ChatMessageExtractor.cleanMessageText === 'function'
        ? ChatMessageExtractor.cleanMessageText
        : cleanCopiedMessageText;

    const cleanedRaw = cleanFn(rawText || '');

    const afterThinking = extractFinalAnswerAfterThinkingText(rawText);

    const cleanedAfterThinking = cleanFn(afterThinking || '');

    if (cleanedAfterThinking && cleanedAfterThinking.length >= 20) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[CHAT_PAGE][assistant-final-answer-picked] source=after-thinking chars=${cleanedAfterThinking.length} fallbackChars=${String(fallbackText || cleanedRaw || '').length} turn=${meta.turnId || '-'}`,
        );
      }

      return {
        text: cleanedAfterThinking,
        source: 'after-thinking',
      };
    }

    const fallback = String(fallbackText || cleanedRaw || '').trim();

    return {
      text: fallback,
      source: 'fallback-full',
    };
  }

  const ChatMessageExtractor = (() => {
    const UI_NOISE_EXACT_LINES = new Set([
      '复制',
      '编辑',
      '分享',
      '重新生成',
      '赞',
      '踩',
      'ChatGPT 也可能会犯错',
      'ChatGPT can make mistakes',
      'Check out the response',
      'Regenerate',
      'Copy',
      'Edit',
      'Share',
    ]);

    const COMPOSER_AREA_SELECTORS = [
      '[data-testid="composer"]',
      '#prompt-textarea',
      'textarea[name="prompt-textarea"]',
      '[data-testid="composer-textarea"]',
      '[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"][role="textbox"]',
    ].join(',');

    function isInComposerArea(el) {
      if (!el) return false;
      return !!el.closest(COMPOSER_AREA_SELECTORS);
    }

    function isToolboxRoot(el) {
      if (!el) return false;
      return !!el.closest(`#${APP.rootId}`);
    }

    function resolveMessageRole(el) {
      let role = getMessageRole(el);
      if (role) return role;

      const roleNode = el.querySelector && el.querySelector('[data-message-author-role]');
      if (roleNode) {
        role = String(roleNode.getAttribute('data-message-author-role') || '').toLowerCase();
        if (role) return role;
      }

      if (el.querySelector && el.querySelector('[data-message-author-role="user"]')) {
        return 'user';
      }

      if (
        el.querySelector &&
        el.querySelector('[data-message-author-role="assistant"], .markdown, [data-message-content]')
      ) {
        return 'assistant';
      }

      return 'unknown';
    }

    function isUiNoiseLine(line) {
      const trimmed = String(line || '').trim();
      if (!trimmed) return false;
      if (UI_NOISE_EXACT_LINES.has(trimmed)) return true;
      if (/^已思考.*秒$/.test(trimmed)) return true;
      if (/^Thought for \d+/i.test(trimmed)) return true;
      if (/^Read for \d+/i.test(trimmed)) return true;
      return false;
    }

    function cleanMessageText(text) {
      let value = cleanCopiedMessageText(text);
      if (!value) return '';

      const parts = value.split(/(```[\s\S]*?```)/g);
      const rebuilt = [];

      parts.forEach((part) => {
        if (!part) return;

        if (part.startsWith('```')) {
          rebuilt.push(part);
          return;
        }

        const lines = part.split('\n');
        const filtered = lines.filter((line) => !isUiNoiseLine(line));
        rebuilt.push(filtered.join('\n'));
      });

      return rebuilt
        .join('')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    function collectMessageElements(options = {}) {
      const includeHidden = options.includeHidden === true;
      const seen = new Set();
      const result = [];

      const addElement = (el) => {
        if (!(el instanceof HTMLElement)) return;
        if (isToolboxRoot(el)) return;
        if (isInToolbox(el)) return;
        if (isInComposerArea(el)) return;
        if (isChatSidebarElement(el)) return;

        const container = el.closest(
          'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]'
        ) || el;

        if (!(container instanceof HTMLElement)) return;
        if (seen.has(container)) return;

        if (!includeHidden) {
          const rect = container.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
        }

        seen.add(container);
        result.push(container);
      };

      findConversationMessageElements({ includeHidden }).forEach(addElement);

      qsa('[data-message-author-role]').forEach((el) => {
        if (!(el instanceof HTMLElement)) return;

        let parent = el.parentElement;
        let nested = false;

        while (parent) {
          if (parent.matches && parent.matches('[data-message-author-role]')) {
            nested = true;
            break;
          }
          parent = parent.parentElement;
        }

        if (!nested) {
          addElement(el);
        }
      });

      result.sort((a, b) => {
        if (a === b) return 0;
        const pos = a.compareDocumentPosition(b);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      return result;
    }

    function buildRecords(options = {}) {
      const includeEmpty = options.includeEmpty === true;
      const includeHidden = options.includeHidden === true;

      try {
        const messages = collectMessageElements({ includeHidden });
        const records = [];
        const seenTurnIds = new Set();
        const seenNodes = new WeakSet();

        messages.forEach((el) => {
          const container = el.closest(
            'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]'
          ) || el;
          const node = container instanceof HTMLElement ? container : el;

          if (seenNodes.has(node)) return;
          seenNodes.add(node);

          const role = resolveMessageRole(el);
          if (role && !['assistant', 'user', 'system', 'tool', 'unknown'].includes(role)) {
            return;
          }

          const containerForText = node instanceof HTMLElement ? node : el;
          const fullTurnRawText = String(
            containerForText.textContent || containerForText.innerText || '',
          );
          const extractResult = getFullMessageTextFromElement(el);
          const finalPick = chooseAssistantFinalAnswerText(
            fullTurnRawText,
            extractResult.text,
            { turnId: getConversationTurnId(el) },
          );
          const text = cleanMessageText(finalPick.text);
          if (!includeEmpty && !text) return;

          const turnId = getConversationTurnId(el);
          const stats = getCopiedTextStats(text);
          const rect = el.getBoundingClientRect();
          const hasThinkingBoundary = /已思考|Thought for|Thinking|正在思考/i.test(fullTurnRawText)
            ? 1
            : 0;

          if (turnId) {
            if (seenTurnIds.has(turnId)) return;
            seenTurnIds.add(turnId);
          }

          if (hasThinkingBoundary) {
            ToolboxShell.appendLog(
              `[CHAT_PAGE][conversation-record] turn=${turnId || '-'} role=${role} extract_source=${finalPick.source || extractResult.source || 'unknown'} hasThinking=${hasThinkingBoundary} chars=${stats.charCount}`,
            );
          }

          records.push({
            index: records.length,
            role,
            text,
            element: el,
            turn_id: turnId,
            char_count: stats.charCount,
            no_space_char_count: stats.noSpaceCharCount,
            han_count: stats.hanCount,
            line_count: stats.lineCount,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            extract_source: finalPick.source || extractResult.source || 'unknown',
            has_thinking_boundary: hasThinkingBoundary,
            content_node_count: extractResult.contentNodeCount,
            content_text_chars: extractResult.contentTextChars,
            full_turn_text_chars: extractResult.fullTurnTextChars,
          });
        });

        records.sort((a, b) => {
          const ta = Number.isFinite(Number(a.top)) ? Number(a.top) : 0;
          const tb = Number.isFinite(Number(b.top)) ? Number(b.top) : 0;

          if (Math.abs(ta - tb) > 2) {
            return ta - tb;
          }

          if (a.element && b.element && a.element !== b.element) {
            const pos = a.element.compareDocumentPosition(b.element);
            if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
            if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          }

          return 0;
        });

        records.forEach((record, index) => {
          record.index = index;
        });

        return records;
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] ChatMessageExtractor.buildRecords failed', error);
        ToolboxShell.appendLog(`[CHAT_PAGE][conversation-records:failed] error=${errText}`);
        throw error;
      }
    }

    function getLatestUserRecord(records) {
      const list = Array.isArray(records) ? records : [];
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].role === 'user') {
          return list[i];
        }
      }
      return null;
    }

    function getLatestAssistantAfterLatestUser(records, options = {}) {
      const allowNoUserFallback = options.allowNoUserFallback === true;
      const list = Array.isArray(records) ? records : [];
      const latestUser = getLatestUserRecord(list);

      if (!latestUser) {
        if (allowNoUserFallback) {
          for (let i = list.length - 1; i >= 0; i -= 1) {
            if (list[i].role === 'assistant') {
              return {
                ok: true,
                record: list[i],
                latestUser: null,
                reason: 'no-latest-user-fallback-last-assistant',
              };
            }
          }
        }

        return {
          ok: false,
          reason: 'no-latest-user',
          latestUser: null,
        };
      }

      const userIdx = list.findIndex((item) => item === latestUser || item.index === latestUser.index);

      for (let i = list.length - 1; i > userIdx; i -= 1) {
        if (list[i].role === 'assistant') {
          return {
            ok: true,
            record: list[i],
            latestUser,
            reason: 'latest-assistant-after-latest-user',
          };
        }
      }

      return {
        ok: false,
        reason: 'no-assistant-after-latest-user',
        latestUser,
      };
    }

    function buildStableSignature(record, text) {
      return [
        record.turn_id || '',
        text,
        String(record.char_count || 0),
        String(record.no_space_char_count || 0),
      ].join('||');
    }

    async function waitLatestAssistantStable(options = {}) {
      const timeoutMs = Number(options.timeoutMs ?? 12000);
      const intervalMs = Number(options.intervalMs ?? 300);
      const stableRounds = Number(options.stableRounds ?? 2);
      const isGenerating = typeof options.isGenerating === 'function' ? options.isGenerating : () => false;

      const startedAt = Date.now();
      let stableCount = 0;
      let lastSignature = '';
      let lastPicked = null;

      while (Date.now() - startedAt < timeoutMs) {
        if (isGenerating()) {
          stableCount = 0;
          lastSignature = '';
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-check] state=generating');
          await sleep(intervalMs);
          continue;
        }

        const records = buildRecords({ includeEmpty: false });
        const picked = getLatestAssistantAfterLatestUser(records);
        lastPicked = picked;

        if (!picked.ok) {
          stableCount = 0;
          lastSignature = '';
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:stable-check] state=${picked.reason || 'no-assistant'}`
          );
          await sleep(intervalMs);
          continue;
        }

        const record = picked.record;
        const text = cleanMessageText(record.text || '');
        const signature = buildStableSignature(record, text);

        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:stable-check] stable=${stableCount}/${stableRounds} chars=${record.char_count} source=${record.extract_source || '-'} hasThinking=${record.has_thinking_boundary ?? 0} contentNodes=${record.content_node_count ?? '-'} contentChars=${record.content_text_chars ?? '-'} fullTurnChars=${record.full_turn_text_chars ?? '-'} turn=${record.turn_id || '-'}`
        );

        if (signature && signature === lastSignature) {
          stableCount += 1;
        } else {
          stableCount = 1;
          lastSignature = signature;
        }

        if (stableCount >= stableRounds && text) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-ok]');
          return {
            ok: true,
            record,
            text,
            reason: 'stable',
            latestUser: picked.latestUser || null,
          };
        }

        await sleep(intervalMs);
      }

      ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-timeout]');

      const finalRecords = buildRecords({ includeEmpty: false });
      const finalPicked = getLatestAssistantAfterLatestUser(finalRecords);

      return {
        ok: false,
        reason: finalPicked.reason === 'no-assistant-after-latest-user'
          ? 'no-assistant-after-latest-user'
          : 'timeout',
        lastRecord: finalPicked.record || lastPicked?.record || null,
        latestUser: finalPicked.latestUser || lastPicked?.latestUser || null,
      };
    }

    return {
      buildRecords,
      getLatestAssistantAfterLatestUser,
      cleanMessageText,
      waitLatestAssistantStable,
    };
  })();

  function buildConversationMessageRecords(options = {}) {
    return ChatMessageExtractor.buildRecords(options);
  }

  function getLatestConversationMessageRecord(options = {}) {
    const preferredRole = String(options.role || '').toLowerCase();
    const preferAssistant = options.preferAssistant !== false;
    const allowPreviousAssistantFallback = options.allowPreviousAssistantFallback === true;
    const records = buildConversationMessageRecords({
      includeEmpty: false,
    });

    if (!records.length) {
      return null;
    }

    if (preferredRole) {
      for (let i = records.length - 1; i >= 0; i -= 1) {
        if (records[i].role === preferredRole) {
          return records[i];
        }
      }
      return null;
    }

    if (preferAssistant) {
      const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
      if (picked.ok && picked.record) {
        return picked.record;
      }

      if (allowPreviousAssistantFallback) {
        for (let i = records.length - 1; i >= 0; i -= 1) {
          if (records[i].role === 'assistant') {
            return records[i];
          }
        }
      }

      return null;
    }

    return records[records.length - 1] || null;
  }

  function getLatestAssistantAfterLatestUserRecord(options = {}) {
    const records = buildConversationMessageRecords({
      includeEmpty: false,
      includeHidden: options.includeHidden === true,
    });
    const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records, {
      allowNoUserFallback: options.allowNoUserFallback === true,
    });

    if (!picked.ok || !picked.record) {
      return null;
    }

    const text = ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();

    return {
      ...picked.record,
      text,
      ok: true,
      latestUser: picked.latestUser || null,
      reason: picked.reason || '',
    };
  }

  function getLatestAssistantMessageForCopy() {
    const record = getLatestAssistantAfterLatestUserRecord({
      includeHidden: true,
    });

    if (!record || !record.text) {
      return {
        ok: false,
        text: '',
        reason: 'no-assistant-after-latest-user',
        record: null,
      };
    }

    return {
      ok: true,
      text: record.text,
      record,
    };
  }

  function pickLatestAssistantTextFromBridgeSnapshot() {
    try {
      const snapshot = buildConversationSnapshotForBridge(null);
      const latest = snapshot && (snapshot.latest_assistant_reply || snapshot.latest_message);
      if (!latest || latest.role !== 'assistant') {
        return { ok: false, text: '', reason: 'no_assistant_message', record: null };
      }
      const text = ChatMessageExtractor.cleanMessageText(latest.text || '').trim();
      if (!text) {
        return { ok: false, text: '', reason: 'empty_content', record: latest };
      }
      return {
        ok: true,
        text,
        reason: 'bridge_snapshot',
        record: latest,
        role: 'assistant',
      };
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      ToolboxShell.appendLog(`[COPY_LAST][SNAPSHOT_FAIL] error=${errText}`);
      return { ok: false, text: '', reason: 'snapshot_failed', record: null };
    }
  }

  function tryCopyLastAssistantSnapshotFallback(records, triggerReason = '') {
    const snapshotPick = pickLatestAssistantTextFromBridgeSnapshot();
    if (!snapshotPick.ok || !snapshotPick.text) {
      ToolboxShell.appendLog(
        `[COPY_LAST][SNAPSHOT_FALLBACK_REJECTED] trigger=${triggerReason || '-'} reason=${snapshotPick.reason || 'no_text'}`,
      );
      return null;
    }

    let latestUser = null;
    for (let i = records.length - 1; i >= 0; i -= 1) {
      if (records[i].role === 'user') {
        latestUser = records[i];
        break;
      }
    }

    const snapIdx =
      snapshotPick.record && Number.isFinite(snapshotPick.record.index)
        ? snapshotPick.record.index
        : -1;

    if (latestUser && snapIdx >= 0 && snapIdx <= latestUser.index) {
      ToolboxShell.appendLog(
        `[COPY_LAST][SNAPSHOT_FALLBACK_REJECTED] trigger=${triggerReason || '-'} reason=before_latest_user latestUserIndex=${latestUser.index} snapshotIndex=${snapIdx}`,
      );
      return null;
    }

    ToolboxShell.appendLog(
      `[COPY_LAST][SNAPSHOT_FALLBACK_OK] trigger=${triggerReason || '-'} chars=${snapshotPick.text.length}`,
    );

    return {
      ok: true,
      text: snapshotPick.text,
      role: 'assistant',
      reason: 'snapshot_fallback',
      record: snapshotPick.record || null,
    };
  }

  function bridgeSafeConversationRecord(record) {
    if (!record || typeof record !== 'object') {
      return null;
    }
    const safe = {};
    Object.keys(record).forEach((key) => {
      if (key === 'element') {
        return;
      }
      const value = record[key];
      if (value instanceof Node) {
        return;
      }
      if (typeof value === 'function') {
        return;
      }
      safe[key] = value;
    });
    return safe;
  }

  function buildConversationSnapshotForBridge(resolvePageIdentity) {
    try {
      const rawMessages = buildConversationMessageRecords({
        includeEmpty: false,
        includeHidden: true,
      });

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[CHAT_PAGE][conversation-snapshot] messages=${rawMessages.length} includeHidden=1`,
        );
      }

      const messages = rawMessages
        .map((record) => bridgeSafeConversationRecord(record))
        .filter(Boolean);

      const latestAny = messages.length ? messages[messages.length - 1] : null;
      const pickedAssistant = ChatMessageExtractor.getLatestAssistantAfterLatestUser(rawMessages);
      const latestAssistant = pickedAssistant.ok && pickedAssistant.record
        ? bridgeSafeConversationRecord(pickedAssistant.record)
        : null;

      const page = typeof resolvePageIdentity === 'function' ? resolvePageIdentity() : {};

      return {
        page,
        message_count: messages.length,
        latest_message: latestAny,
        latest_assistant_reply: latestAssistant,
        latest_assistant_message: latestAssistant,
        latest_any_message: latestAny,
        has_new_assistant_after_latest_user: Boolean(latestAssistant),
        messages,
        text: messages.map((m) => {
          const label = m.role === 'assistant' ? '助手' : (m.role === 'user' ? '用户' : m.role || '消息');
          return `--- ${label} ${m.index + 1} ---\n${m.text || ''}`;
        }).join('\n\n'),
      };
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[ChatGPT toolbox] buildConversationSnapshotForBridge failed', error);
      ToolboxShell.appendLog(`[CHAT_PAGE][conversation-snapshot:failed] error=${errText}`);
      throw error;
    }
  }

  /********************************************************************
   * 2. ComposerApi：ChatGPT 页面操作隔离
   ********************************************************************/

  const ComposerApi = (() => {
    function getComposer() {
      for (const sel of SELECTORS.composerTextarea) {
        const el = qs(sel);
        if (el instanceof HTMLElement && !isInToolbox(el) && isElementVisible(el)) {
          return el;
        }
      }

      return null;
    }

    function hasComposer() {
      return getComposer() instanceof HTMLElement;
    }

    function canAcceptInput() {
      const composer = getComposer();

      if (!(composer instanceof HTMLElement)) {
        return false;
      }

      if (composer.getAttribute && composer.getAttribute('aria-disabled') === 'true') {
        return false;
      }

      if (!isElementVisible(composer)) {
        return false;
      }

      return true;
    }

    function canAcceptTextInput() {
      return canAcceptInput();
    }

    function getComposerRoot() {
      const c = qs(SELECTORS.composer);
      if (c instanceof HTMLElement && !isInToolbox(c)) return c;

      const editor = getComposer();
      if (editor) {
        const form = editor.closest('form');
        if (form instanceof HTMLElement) return form;
        return editor;
      }

      return null;
    }

    function isButtonBelongsToComposer(btn, composer, composerRoot, composerForm) {
      if (!(btn instanceof HTMLElement)) {
        return false;
      }

      if (composerRoot instanceof HTMLElement && composerRoot.contains(btn)) {
        return true;
      }

      if (composerForm instanceof HTMLElement && composerForm.contains(btn)) {
        return true;
      }

      const btnForm = btn.closest('form');
      if (btnForm instanceof HTMLElement && composerForm instanceof HTMLElement && btnForm === composerForm) {
        return true;
      }

      if (composer instanceof HTMLElement && composer.contains(btn)) {
        return true;
      }

      return false;
    }

    function isButtonNearComposer(btn, composer) {
      if (!(btn instanceof HTMLElement) || !(composer instanceof HTMLElement)) {
        return false;
      }

      if (!isElementVisible(btn)) {
        return false;
      }

      const btnRect = btn.getBoundingClientRect();
      const composerRect = composer.getBoundingClientRect();

      if (btnRect.width <= 0 || btnRect.height <= 0) {
        return false;
      }

      const verticalDistance = Math.abs(
        ((btnRect.top + btnRect.bottom) / 2) - ((composerRect.top + composerRect.bottom) / 2),
      );

      const horizontalDistance = Math.abs(
        ((btnRect.left + btnRect.right) / 2) - ((composerRect.left + composerRect.right) / 2),
      );

      return verticalDistance <= 160 && horizontalDistance <= 900;
    }

    const composerLogThrottle = new Map();

    function appendComposerLogThrottled(key, text, intervalMs = 5000) {
      const now = Date.now();
      const last = Number(composerLogThrottle.get(key) || 0);

      if (now - last < intervalMs) {
        return;
      }

      composerLogThrottle.set(key, now);
      ToolboxShell.appendLog(text);
    }

    function isLikelyComposerSendButton(btn) {
      if (!(btn instanceof HTMLButtonElement)) {
        return false;
      }

      const testId = String(btn.getAttribute('data-testid') || '').toLowerCase();
      const id = String(btn.id || '').toLowerCase();
      const aria = String(btn.getAttribute('aria-label') || '').trim().toLowerCase();
      const title = String(btn.getAttribute('title') || '').trim().toLowerCase();
      const text = String(btn.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const type = String(btn.getAttribute('type') || '').toLowerCase();

      const positive = [
        testId === 'send-button',
        testId === 'composer-submit-button',
        id === 'composer-submit-button',
        ['发送', '发送消息', '发送提示', 'send', 'send message', 'send prompt'].includes(aria),
        ['发送', '发送消息', 'send', 'send message'].includes(title),
        ['发送', 'send'].includes(text),
      ];

      if (positive.some(Boolean)) {
        return true;
      }

      const negativeText = `${testId} ${id} ${aria} ${title} ${text}`;
      if (/attach|upload|file|附件|上传|voice|mic|microphone|audio|tool|工具|model|模型|search|搜索/i.test(negativeText)) {
        return false;
      }

      if (type === 'submit') {
        return false;
      }

      return false;
    }

    function findSendButton(options = {}) {
      const silent = options.silent === true;
      const composer = getComposer();
      if (!(composer instanceof HTMLElement)) {
        if (!silent) {
          appendComposerLogThrottled(
            'find-send-button:composer-not-found',
            '[COMPOSER][find-send-button:skip] reason=composer-not-found',
          );
        }
        return null;
      }

      const composerRoot = getComposerRoot();
      const composerForm = composer.closest('form');
      const scopes = [];

      if (composerRoot instanceof HTMLElement) {
        scopes.push(composerRoot);
      }

      if (composerForm instanceof HTMLElement && !scopes.includes(composerForm)) {
        scopes.push(composerForm);
      }

      const main = qs('main');
      if (main instanceof HTMLElement && !scopes.includes(main)) {
        scopes.push(main);
      }

      if (document.body instanceof HTMLElement && !scopes.includes(document.body)) {
        scopes.push(document.body);
      }

      const selectors = SELECTORS.sendButton || [];

      for (const scope of scopes) {
        for (const sel of selectors) {
          const candidates = Array.from(scope.querySelectorAll(sel));

          for (const candidate of candidates) {
            if (!(candidate instanceof HTMLButtonElement)) {
              continue;
            }

            if (isInToolbox(candidate)) {
              continue;
            }

            if (!isElementVisible(candidate)) {
              continue;
            }

            if (
              scope !== document.body &&
              !isButtonBelongsToComposer(candidate, composer, composerRoot, composerForm)
            ) {
              continue;
            }

            if (!isLikelyComposerSendButton(candidate)) {
              continue;
            }

            if (
              scope === document.body &&
              !isButtonBelongsToComposer(candidate, composer, composerRoot, composerForm) &&
              !isButtonNearComposer(candidate, composer)
            ) {
              continue;
            }

            const source = scope === composerRoot
              ? 'composerRoot'
              : (scope === composerForm ? 'composerForm' : (scope === main ? 'main' : 'document.body'));
            if (!silent) {
              appendComposerLogThrottled(
                `find-send-button:found:${source}`,
                `[COMPOSER][find-send-button:found] source=${source} `
                + `testid=${String(candidate.getAttribute('data-testid') || '-')}`
                + ` id=${String(candidate.id || '-')}`
                + ` aria=${String(candidate.getAttribute('aria-label') || '-')}`
                + ` title=${String(candidate.getAttribute('title') || '-')}`,
                1000,
              );
            }
            return candidate;
          }
        }
      }

      if (!silent) {
        appendComposerLogThrottled(
          'find-send-button:no-scoped-send-button',
          '[COMPOSER][find-send-button:not-found] reason=no-scoped-send-button',
        );
      }
      return null;
    }


    function isSendButtonReady(btn) {
      if (!btn || !isElementVisible(btn)) return false;
      if (btn.disabled) return false;

      const ariaDisabled = btn.getAttribute('aria-disabled');
      if (ariaDisabled === 'true') return false;

      if (btn.getAttribute('data-disabled') === 'true') return false;

      const style = window.getComputedStyle(btn);
      if (style.pointerEvents === 'none') return false;

      return true;
    }

    function setNativeTextareaValue(el, value) {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');

      if (desc && desc.set) {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
    }

    function setComposerValue(value) {
      const el = getComposer();
      if (!el) return false;

      el.focus();

      if (el.matches && el.matches('textarea,input')) {
        setNativeTextareaValue(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }

      if (el.isContentEditable) {
        const selection = window.getSelection();
        const range = document.createRange();

        range.selectNodeContents(el);
        range.collapse(false);

        selection.removeAllRanges();
        selection.addRange(range);

        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, value);
        } catch (e) {
          console.warn('[ChatGPT toolbox] execCommand insertText failed; fallback to textContent', e);
          el.textContent = value;
        }

        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value,
        }));

        el.dispatchEvent(new Event('change', {
          bubbles: true,
        }));

        return true;
      }

      return false;
    }

    function getComposerText() {
      const el = getComposer();
      if (!el) return '';

      if (el.matches && el.matches('textarea,input')) {
        return String(el.value || '').trim();
      }

      return String(el.innerText || el.textContent || '')
        .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function canSendNow() {
      const composer = getComposer();
      if (!(composer instanceof HTMLElement)) {
        return false;
      }

      if (composer.getAttribute && composer.getAttribute('aria-disabled') === 'true') {
        return false;
      }

      const sendBtn = findSendButton();
      if (!sendBtn) {
        return false;
      }

      return isSendButtonReady(sendBtn);
    }

    function clickSend() {
      const sendBtn = findSendButton();

      if (!isSendButtonReady(sendBtn)) {
        ToolboxShell.appendLog('[COMPOSER][click-send:blocked] reason=send-button-not-ready');
        return false;
      }

      const debugText = [
        `testid=${sendBtn.getAttribute('data-testid') || '-'}`,
        `id=${sendBtn.id || '-'}`,
        `aria=${sendBtn.getAttribute('aria-label') || '-'}`,
        `title=${sendBtn.getAttribute('title') || '-'}`,
        `text=${String(sendBtn.textContent || '').replace(/\s+/g, ' ').trim() || '-'}`,
      ].join(' ');

      ToolboxShell.appendLog(`[COMPOSER][click-send] ${debugText}`);

      sendBtn.click();
      return true;
    }

    function isAssistantLikelyBusy() {
      const stopBtn = qs(SELECTORS.stopButton);
      if (stopBtn && isElementVisible(stopBtn) && !stopBtn.disabled) {
        return true;
      }

      const hints = [
        '.result-streaming',
        '[data-testid="stop-button"]',
        '[aria-label*="Stop"]',
        '[aria-label*="停止"]',
      ];

      return hints.some((sel) => {
        const el = qs(sel);
        return el && !isInToolbox(el) && isElementVisible(el);
      });
    }


    function isLikelyAttachmentChipText(raw) {
      return /remove|删除|移除|附件|file|文件|attachment|uploaded|upload|\.zip|\.js|\.py|\.txt|\.json|\.md|\.csv|\.xlsx|\.docx|\.pdf/i.test(raw);
    }

    function forEachLikelyAttachmentElement(callback) {
      const roots = [
        getComposerRoot(),
        qs('[data-testid="composer"]'),
        qs('form'),
        qs('main'),
        document.body,
      ].filter(Boolean);

      const seen = new Set();

      roots.forEach((root) => {
        qsa(
          [
            'button',
            '[role="button"]',
            '[data-testid]',
            '[aria-label]',
            '[title]',
            'a',
            'span',
            'div',
          ].join(','),
          root,
        ).forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          if (isInToolbox(el)) return;
          if (seen.has(el)) return;

          const raw = [
            el.innerText || '',
            el.textContent || '',
            el.getAttribute('aria-label') || '',
            el.getAttribute('title') || '',
            el.getAttribute('data-testid') || '',
          ].join(' ').trim();

          if (!raw || !isLikelyAttachmentChipText(raw)) return;

          seen.add(el);
          callback(el, raw, seen);
        });
      });
    }

    function countAttachmentChips() {
      let count = 0;
      forEachLikelyAttachmentElement(() => {
        count += 1;
      });
      return count;
    }

    function isLikelyAttachmentRemoveButton(el) {
      if (!(el instanceof HTMLElement)) return false;
      if (isInToolbox(el)) return false;
      if (!isElementVisible(el)) return false;

      const raw = [
        el.innerText || '',
        el.textContent || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
        el.getAttribute('data-testid') || '',
        el.getAttribute('class') || '',
      ].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();

      if (!raw) return false;

      const hasRemoveIntent = /remove|delete|dismiss|clear|删除|移除|清除|关闭/.test(raw);
      const attachmentHint = /attach|附件|file|文件|upload|上传|chip|pill|token/.test(raw);
      const hasRemoveTestId = /data-testid[^a-z0-9]*(remove|delete|close|dismiss)/.test(raw);

      if (!hasRemoveIntent && !hasRemoveTestId) {
        return false;
      }

      return attachmentHint || hasRemoveTestId;
    }

    function collectComposerAttachmentRemoveButtons() {
      const roots = [
        getComposerRoot(),
        qs('[data-testid="composer"]'),
        qs('main'),
      ].filter(Boolean);

      const seen = new Set();
      const removeButtons = [];

      roots.forEach((root) => {
        qsa('button, [role="button"]', root).forEach((el) => {
          if (!(el instanceof HTMLElement)) return;
          if (seen.has(el)) return;
          seen.add(el);
          if (!isLikelyAttachmentRemoveButton(el)) return;
          removeButtons.push(el);
        });
      });

      return removeButtons;
    }

    async function clearAttachments(reason = '') {
      const maxRounds = 6;
      let removed = 0;
      let rounds = 0;

      for (let round = 0; round < maxRounds; round += 1) {
        const removeButtons = collectComposerAttachmentRemoveButtons();
        if (!removeButtons.length) {
          break;
        }

        let clicked = 0;
        removeButtons.forEach((btn) => {
          try {
            btn.click();
            clicked += 1;
          } catch (error) {
            const errText = error && error.message ? error.message : String(error);
            console.warn('[ChatGPT toolbox] clearAttachments click failed', error);
            ToolboxShell.appendLog(
              `[COMPOSER][clear-attachments:click-failed] reason=${reason || '-'} error=${errText}`
            );
          }
        });

        removed += clicked;
        rounds += 1;

        ToolboxShell.appendLog(
          `[COMPOSER][clear-attachments:round] reason=${reason || '-'} round=${round + 1} clicked=${clicked}`
        );

        if (!clicked) {
          break;
        }

        await sleep(180);
      }

      const remaining = countAttachmentChips();

      return {
        ok: true,
        reason: reason || '',
        removed,
        rounds,
        remaining,
      };
    }

    function collectAttachmentChipText() {
      const pieces = [];

      forEachLikelyAttachmentElement((el, _raw, seen) => {
        const nodes = [
          el,
          el.parentElement,
          el.closest('li'),
          el.closest('[role="listitem"]'),
          el.closest('[data-testid]'),
          el.closest('div'),
        ];

        nodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (isInToolbox(node)) return;
          if (seen.has(node)) return;

          seen.add(node);

          pieces.push(
            [
              node.innerText || '',
              node.textContent || '',
              node.getAttribute('aria-label') || '',
              node.getAttribute('title') || '',
              node.getAttribute('data-testid') || '',
            ].join(' '),
          );
        });
      });

      return pieces.join('\n').slice(0, 20000);
    }

    function stripExt(s) {
      return String(s || '').replace(/\.[^.]+$/, '');
    }

    function fileNameEvidence(fileName, haystack) {
      const raw = String(fileName || '').replace(/^.*[/\\]/, '').trim();
      if (!raw) return false;

      const low = String(haystack || '').toLowerCase();
      const name = raw.toLowerCase();

      if (low.includes(name)) return true;

      const stem = stripExt(name)
        .replace(/_\d{8}_\d{6}_\d{3}_[a-z0-9]{4,10}(?:_\d{2,3})?$/i, '')
        .trim();

      if (stem.length >= 8 && low.includes(stem)) return true;
      if (stem.length >= 16 && low.includes(stem.slice(0, 16))) return true;

      return false;
    }

    function buildUploadEvidenceNames(fileOrName, extraNames = []) {
      const names = [];

      const add = (value) => {
        const text = String(value || '').replace(/^.*[/\\]/, '').trim();
        if (!text) return;
        if (!names.includes(text)) names.push(text);

        const stem = stripExt(text).trim();
        if (stem && !names.includes(stem)) names.push(stem);

        const normalizedStem = stem
          .replace(/_\d{8}_\d{6}_\d{3}_[a-z0-9]{4,10}(?:_\d{2,3})?$/i, '')
          .trim();

        if (normalizedStem && !names.includes(normalizedStem)) {
          names.push(normalizedStem);
        }
      };

      if (fileOrName && typeof fileOrName === 'object') {
        add(fileOrName.name);
        add(fileOrName.originalName);
        add(fileOrName.uploadName);
      } else {
        add(fileOrName);
      }

      extraNames.forEach(add);

      return names;
    }

    function fileNameEvidenceAny(names, haystack) {
      const list = Array.isArray(names) ? names : [names];
      return list.some((name) => fileNameEvidence(name, haystack));
    }

    function findAttachmentEvidence(uploadName, options = {}) {
      const roots = getAttachmentEvidenceRoots();
      const text = collectAttachmentChipText();

      const names = buildUploadEvidenceNames(
        uploadName,
        options.extraNames || [],
      );

      const ok = fileNameEvidenceAny(names, text);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][attachment-evidence] roots=${roots.length} ok=${ok ? 1 : 0} textPreview=${text.slice(0, 200)}`
      );

      return {
        ok,
        reason: ok
          ? `附件区域识别到文件名：${names.join('|')}`
          : `未识别到附件文件名：${names.join('|')}`,
        textPreview: text.slice(0, 500),
        rootsCount: roots.length,
      };
    }

    async function waitLegacyInputSettled(uploadFile, options = {}) {
      const uploadName = uploadFile && uploadFile.name ? uploadFile.name : '';
      const timeoutMs = Number(options.timeoutMs) || 8000;
      const stableNeed = Number(options.stableNeed) || 2;
      const pollMs = Number(options.pollMs) || 250;
      const chipCountBefore = Number.isFinite(Number(options.chipCountBefore))
        ? Number(options.chipCountBefore)
        : -1;

      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);

      const startAt = Date.now();
      let firstEvidenceAt = 0;
      let stableCount = 0;
      let lastReason = '';
      let lastTextPreview = '';

      while (Date.now() - startAt < timeoutMs) {
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            reason: '用户已停止上传',
          };
        }

        const evidence = findAttachmentEvidence(uploadFile, {
          extraNames: options.extraNames || [],
        });

        if (evidence && evidence.textPreview) {
          lastTextPreview = evidence.textPreview;
        }

        const nowCount = countAttachmentChips();

        if (evidence && evidence.ok) {
          if (!firstEvidenceAt) {
            firstEvidenceAt = Date.now();
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][file-input:evidence-ok] ${uploadName} reason=${evidence.reason || '-'}`
            );
          }

          stableCount += 1;
          lastReason = evidence.reason || '附件区域识别到文件名';

          if (stableCount >= stableNeed || Date.now() - firstEvidenceAt >= 800) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][file-input:settled-ok] ${uploadName} reason=${lastReason}`
            );

            return {
              ok: true,
              reason: lastReason,
              level: 'name',
            };
          }
        } else if (chipCountBefore >= 0 && nowCount > chipCountBefore) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][file-input:chip-count-increased-but-need-name] ${uploadName} count=${chipCountBefore}->${nowCount}`
          );
          stableCount = 0;
          lastReason = evidence && evidence.reason
            ? evidence.reason
            : `附件数量增加但未匹配文件名：${chipCountBefore} -> ${nowCount}`;
        } else {
          stableCount = 0;
          lastReason = evidence && evidence.reason
            ? evidence.reason
            : '未识别到附件文件名';
        }

        await sleep(pollMs);
      }

      const chipAfter = countAttachmentChips();

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][file-input:settled-timeout] ${uploadName} reason=${lastReason || '-'} chipBefore=${chipCountBefore} chipAfter=${chipAfter} textPreview=${lastTextPreview || collectAttachmentChipText().slice(0, 500)}`
      );

      return {
        ok: false,
        reason: lastReason || '等待附件稳定超时',
        textPreview: lastTextPreview || collectAttachmentChipText().slice(0, 500),
      };
    }

    async function waitForAttachmentEvidence(files, chipCountBefore, timeoutMs, options = {}) {
      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);

      const cleanFiles = (files || []).filter(Boolean);
      const extraNames = cleanFiles.map((item) => item && item.name).filter(Boolean);
      const deadline = Date.now() + timeoutMs;
      let lastTextPreview = '';

      while (Date.now() < deadline) {
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            level: 'cancelled',
            reason: '用户已停止上传',
          };
        }

        const text = collectAttachmentChipText();
        lastTextPreview = text.slice(0, 500);

        const allNamed = cleanFiles.length > 0 && cleanFiles.every((f) => {
          const names = buildUploadEvidenceNames(f, extraNames);
          return fileNameEvidenceAny(names, text);
        });

        if (allNamed) {
          return {
            ok: true,
            level: 'name',
            reason: `附件区域识别到文件名：${cleanFiles.map((f) => f.name).join('|')}`,
          };
        }

        const nowCount = countAttachmentChips();
        if (chipCountBefore >= 0 && nowCount > chipCountBefore) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][file-input:chip-count-ok] batch count=${chipCountBefore}->${nowCount}`
          );

          return {
            ok: true,
            level: 'count',
            reason: `附件数量增加：${chipCountBefore} -> ${nowCount}`,
          };
        }

        await sleep(250);
      }

      const chipAfter = countAttachmentChips();

      console.debug('[ChatGPT toolbox] attachment evidence timeout', {
        expectedFiles: cleanFiles.map((f) => f.name),
        chipCountBefore,
        chipCountAfter: chipAfter,
        chipText: collectAttachmentChipText(),
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][file-input:settled-timeout] batch uploadNames=${cleanFiles.map((f) => f.name).join('|')} chipBefore=${chipCountBefore} chipAfter=${chipAfter} textPreview=${lastTextPreview || collectAttachmentChipText().slice(0, 500)}`
      );

      return {
        ok: false,
        level: 'none',
        reason: '超时未检测到附件 chip',
        textPreview: lastTextPreview || collectAttachmentChipText().slice(0, 500),
      };
    }

    function collectComposerAttachmentStatusText() {
      const root = getComposerRoot() || qs('main') || document.body;
      const parts = [];

      qsa('[data-testid], [aria-label], [title], [role], button, div, span', root).forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (isInToolbox(el)) return;

        const text = [
          el.innerText || '',
          el.textContent || '',
          el.getAttribute('aria-label') || '',
          el.getAttribute('title') || '',
          el.getAttribute('data-testid') || '',
          el.getAttribute('role') || '',
        ].join(' ').trim();

        if (!text) return;

        if (/upload|上传|processing|处理中|loading|加载|progress|spinner|附件|file|文件|remove|删除|移除/i.test(text)) {
          parts.push(text.slice(0, 300));
        }
      });

      return [...new Set(parts)].join('\n');
    }

    function isAttachmentStillUploading() {
      const root = getComposerRoot() || qs('main') || document.body;

      const busyNode = qsa('[role="progressbar"], [aria-busy="true"], [data-testid*="progress"], [data-testid*="spinner"], svg[class*="animate"], .animate-spin', root)
        .find((el) => el instanceof HTMLElement || el instanceof SVGElement);

      if (busyNode && !isInToolbox(busyNode)) {
        return true;
      }

      const text = collectComposerAttachmentStatusText();

      return /uploading|上传中|processing|处理中|loading|加载中|扫描中|正在上传|正在处理/i.test(text);
    }


    function findFileInputsLegacy() {
      const root = getComposerRoot();
      const list = [];

      if (root) {
        list.push(...qsa('input[type="file"]', root));
      }

      list.push(...qsa('main input[type="file"]'));
      list.push(...qsa('input[type="file"]'));

      return [...new Set(list)].filter((x) => {
        if (!(x instanceof HTMLInputElement)) return false;
        if (isInToolbox(x)) return false;
        if (x.disabled) return false;
        return true;
      });
    }

    function dispatchFilesToInputLegacy(input, files) {
      const dt = new DataTransfer();

      files.forEach((file, index) => {
        const normalized = normalizeToNativeFile(
          file,
          file && file.name ? file.name : `upload_${index + 1}.bin`
        );

        if (!normalized) {
          console.warn('[ChatGPT toolbox] dispatchFilesToInputLegacy skipped invalid file', {
            index,
            file,
            tag: file ? Object.prototype.toString.call(file) : '',
            name: file && file.name,
            size: file && file.size,
          });
          return;
        }

        dt.items.add(normalized);
      });

      input.value = '';

      const filesDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');

      if (filesDesc && typeof filesDesc.set === 'function') {
        filesDesc.set.call(input, dt.files);
      } else {
        input.files = dt.files;
      }

      input.dispatchEvent(new Event('input', {
        bubbles: true,
        composed: true,
      }));

      input.dispatchEvent(new Event('change', {
        bubbles: true,
        composed: true,
      }));

      window.setTimeout(() => {
        input.value = '';
      }, 0);
    }

    async function attachFilesByFileInput(files, timeoutMs = 8000, options = {}) {
      ToolboxShell.appendLog('[UPLOAD_PATH] using attachFilesByFileInput');
      const signal = options.signal;
      const isCancelled = typeof options.isCancelled === 'function'
        ? options.isCancelled
        : () => !!(signal && signal.aborted);

      const cleanFiles = files
        .map((f, index) => normalizeToNativeFile(f, f && f.name ? f.name : `upload_${index + 1}.bin`))
        .filter(Boolean);

      ToolboxShell.appendLog(`[UPLOAD_DIAG][file-input:start] inputFiles=${files.length} cleanFiles=${cleanFiles.length} names=${cleanFiles.map((f) => f.name).join('|')}`);

      if (!cleanFiles.length) {
        ToolboxShell.appendLog(`[UPLOAD_DIAG][file-input:no-clean-file] raw=${files.map((f, i) => `${i}:${f && f.name || '-'} tag=${f ? Object.prototype.toString.call(f) : '-'} size=${f && f.size}`).join('|')}`);

        return {
          ok: false,
          reason: '没有可上传的 File 对象',
        };
      }

      if (isCancelled()) {
        return {
          ok: false,
          cancelled: true,
          reason: '用户已停止上传',
        };
      }

      const inputs = findFileInputsLegacy();

      ToolboxShell.appendLog(`旧版 input 上传：发现 ${inputs.length} 个文input`);

      if (!inputs.length) {
        console.warn('[ChatGPT toolbox] legacy input upload failed: no file inputs');
        return {
          ok: false,
          reason: '旧版 input 上传失败：找不到 ChatGPT 文件 input',
        };
      }

      for (const input of inputs) {
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            reason: '用户已停止上传',
          };
        }

        try {
          console.debug('[ChatGPT toolbox] legacy input upload try', {
            input,
            accept: input.getAttribute('accept'),
            multiple: input.multiple,
            disabled: input.disabled,
            visible: isElementVisible(input),
            files: cleanFiles.map((f) => ({
              name: f.name,
              size: f.size,
              type: f.type,
            })),
          });

          const chipCountBefore = countAttachmentChips();

          dispatchFilesToInputLegacy(input, cleanFiles);

          ToolboxShell.appendLog(`已触发旧版 input change：${cleanFiles.map((f) => f.name).join(', ')} chipBefore=${chipCountBefore}`);

          const evidence = await waitForAttachmentEvidence(
            cleanFiles,
            chipCountBefore,
            timeoutMs,
            {
              signal,
              isCancelled,
            },
          );

          if (evidence && evidence.ok) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][file-input:batch-evidence-ok] reason=${evidence.reason || '-'} level=${evidence.level || '-'}`
            );

            return {
              ok: true,
              method: 'file-input',
              level: evidence.level || 'evidence',
              reason: evidence.reason || '旧版 input 上传成功',
            };
          }

          const settledReasons = [];

          for (const f of cleanFiles) {
            if (isCancelled()) {
              return {
                ok: false,
                cancelled: true,
                reason: '用户已停止上传',
              };
            }

            const settled = await waitLegacyInputSettled(f, {
              timeoutMs,
              pollMs: 250,
              stableNeed: 2,
              chipCountBefore,
              extraNames: cleanFiles.map((item) => item && item.name).filter(Boolean),
              signal,
              isCancelled,
            });

            if (settled.cancelled) {
              return {
                ok: false,
                cancelled: true,
                reason: settled.reason || '用户已停止上传',
              };
            }

            if (!settled.ok) {
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][file-input:settled-failed] ${f.name} reason=${settled.reason || '-'} textPreview=${settled.textPreview || '-'}`
              );

              return {
                ok: false,
                method: 'file-input',
                settledFailed: true,
                reason: settled.reason || '附件已出现但未能确认稳定',
                chipCountBefore,
                chipCountAfter: countAttachmentChips(),
                textPreview: settled.textPreview || '',
              };
            }

            settledReasons.push(settled.reason || '附件区域识别到文件名');
          }

          return {
            ok: true,
            method: 'file-input',
            level: 'name',
            reason: `旧版 input 上传成功：${settledReasons.join('；')}`,
          };
        } catch (e) {
          console.warn('[ChatGPT toolbox] legacy input dispatch failed', {
            input,
            files: cleanFiles.map((f) => f.name),
          }, e);
        }
      }

      return {
        ok: false,
        method: 'file-input',
        reason: '旧版 input 上传已触发，但未检测到 ChatGPT 附件出现',
      };
    }


    function getChatMessageElementsInOrder() {
      const nodes = qsa('[data-message-author-role]').filter((el) => !isInToolbox(el));

      const topLevel = nodes.filter((el) => {
        let p = el.parentElement;

        while (p) {
          if (p.matches && p.matches('[data-message-author-role]') && nodes.includes(p)) {
            return false;
          }

          p = p.parentElement;
        }

        return true;
      });

      topLevel.sort((a, b) => {
        const pos = a.compareDocumentPosition(b);

        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;

        return 0;
      });

      return topLevel;
    }

    return {
      getComposerText,
      setComposerValue,
      findSendButton,
      isSendButtonReady,
      clickSend,
      hasComposer,
      canAcceptInput,
      canAcceptTextInput,
      canSendNow,
      isAssistantLikelyBusy,
      attachFilesByFileInput,
      clearAttachments,
      collectAttachmentChipText,
      countAttachmentChips,
      findAttachmentEvidence,
      fileNameEvidence,
      isAttachmentStillUploading,
      getChatMessageElementsInOrder,
    };
  })();

  function detectComposerResponseState() {
    const isResponding = ComposerApi.isAssistantLikelyBusy();
    const composerAvailable = typeof ComposerApi.canAcceptInput === 'function'
      ? ComposerApi.canAcceptInput()
      : (typeof ComposerApi.hasComposer === 'function'
        ? ComposerApi.hasComposer()
        : !!ComposerApi.getComposerText());
    const composerText = ComposerApi.getComposerText();
    const sendButton = ComposerApi.findSendButton({ silent: true });
    const canAcceptInput = composerAvailable && !isResponding;
    const canSendNow = composerAvailable
      && !isResponding
      && !!sendButton
      && ComposerApi.isSendButtonReady(sendButton);

    if (isResponding) {
      return {
        is_responding: true,
        response_state: 'generating',
        response_state_reason: 'assistant_busy',
        can_accept_input: false,
        can_send_now: false,
        response_state_at: Date.now(),
      };
    }

    if (!composerAvailable) {
      return {
        is_responding: false,
        response_state: 'no_composer',
        response_state_reason: 'composer_not_found',
        can_accept_input: false,
        can_send_now: false,
        response_state_at: Date.now(),
      };
    }

    if (composerText) {
      return {
        is_responding: false,
        response_state: 'composing',
        response_state_reason: 'composer_has_text',
        can_accept_input: canAcceptInput,
        can_send_now: canSendNow,
        response_state_at: Date.now(),
      };
    }

    return {
      is_responding: false,
      response_state: 'idle',
      response_state_reason: sendButton ? 'empty_composer' : 'send_button_not_found',
      can_accept_input: canAcceptInput,
      can_send_now: canSendNow,
      response_state_at: Date.now(),
    };
  }

  const ReplyDoneTitleFlashWatcher = (() => {
    let started = false;
    let timer = 0;
    let wasBusy = false;
    let lastFlashAt = 0;

    function check(reason = '') {
      let busy = false;

      try {
        busy = typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] reply done title flash check failed', err);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[TITLE_FLASH][check-failed] reason=${reason || '-'} error=${errText}`);
        }
        return;
      }

      if (busy) {
        if (!wasBusy && typeof TitlePrefixModule.stopReplyDoneFlash === 'function') {
          TitlePrefixModule.stopReplyDoneFlash(`assistant-start:${reason || '-'}`);
        }
        wasBusy = true;
        return;
      }

      if (wasBusy) {
        wasBusy = false;

        const now = Date.now();
        if (now - lastFlashAt < 1500) {
          return;
        }

        lastFlashAt = now;
        TitlePrefixModule.startReplyDoneFlash(`assistant-finished:${reason || '-'}`);
      }
    }

    function start() {
      if (started) {
        return;
      }

      started = true;
      wasBusy = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      timer = window.setInterval(() => {
        check('interval');
      }, 1000);

      document.addEventListener('visibilitychange', () => {
        check('visibilitychange');
      }, true);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[TITLE_FLASH][watcher-start] busy=${wasBusy ? '1' : '0'}`);
      }
    }

    function stop() {
      if (timer) {
        window.clearInterval(timer);
        timer = 0;
      }

      started = false;
      wasBusy = false;
      TitlePrefixModule.stopReplyDoneFlash('watcher-stop');
    }

    return {
      start,
      stop,
      check,
    };
  })();

  const BridgePollRuntime = {
    bridge_connected: false,
    last_poll_ok: null,
    last_poll_error: '',
    last_poll_at: 0,
  };

  function updateBridgePollRuntime(patch) {
    if (!patch || typeof patch !== 'object') {
      return;
    }
    Object.assign(BridgePollRuntime, patch);
  }

  function resetBridgePollRuntime(reason = '') {
    updateBridgePollRuntime({
      bridge_connected: false,
      last_poll_ok: false,
      last_poll_error: String(reason || '').trim(),
      last_poll_at: Date.now(),
    });
  }

  function markBridgePollSuccess() {
    updateBridgePollRuntime({
      bridge_connected: true,
      last_poll_ok: true,
      last_poll_error: '',
      last_poll_at: Date.now(),
    });
  }

  function markBridgePollFailure(errorText) {
    updateBridgePollRuntime({
      bridge_connected: false,
      last_poll_ok: false,
      last_poll_error: String(errorText || '').trim() || 'bridge_poll_failed',
      last_poll_at: Date.now(),
    });
  }

  function resolvePageCapabilityReason(responseState, conversationId, url) {
    const pathname = location.pathname || '';
    const isHomePage = pathname === '/' || pathname === '';
    const composerReason = String(responseState.response_state_reason || '').trim();

    if (composerReason) {
      return composerReason;
    }

    if (!conversationId && isHomePage) {
      return 'page_home';
    }

    if (url && !conversationId) {
      return 'conversation_not_syncable';
    }

    return '';
  }

  function getPageCapability(reason = '') {
    const conversationId = parseConversationIdFromPath(location.pathname || '');
    const url = location.href || '';
    const pathname = location.pathname || '';
    const isHomePage = pathname === '/' || pathname === '';
    const responseState = detectComposerResponseState();
    const clientId = (() => {
      try {
        return sessionStorage.getItem('tm_bridge_client_id') || '';
      } catch (err) {
        console.error('[ChatGPT toolbox] getPageCapability client_id read failed', err);
        return '';
      }
    })();

    const responding = Boolean(responseState.is_responding);

    return {
      client_id: clientId,
      page_instance_id: getToolboxPageInstanceId(),
      conversation_id: conversationId,
      url,
      page_type: conversationId ? 'conversation' : (isHomePage ? 'home' : 'unknown'),
      online: true,
      syncable: Boolean(url),
      conversation_syncable: Boolean(conversationId),
      inputable: Boolean(responseState.can_accept_input),
      sendable: Boolean(responseState.can_send_now),
      is_responding: responding,
      responding,
      response_state: responseState.response_state || 'unknown',
      response_state_reason: resolvePageCapabilityReason(responseState, conversationId, url),
      bridge_connected: Boolean(BridgePollRuntime.bridge_connected),
      last_poll_ok: BridgePollRuntime.last_poll_ok,
      last_poll_error: String(BridgePollRuntime.last_poll_error || '').trim(),
      last_poll_at: Number(BridgePollRuntime.last_poll_at || 0),
      visibility_state: document.visibilityState || 'unknown',
      has_focus: document.hasFocus(),
      reason: String(reason || '').trim(),
    };
  }

  function logPageCapability(capability, tag = '[CAPABILITY]') {
    const cap = capability && typeof capability === 'object' ? capability : getPageCapability('');
    const prefix = String(tag || '[CAPABILITY]').trim();
    const line = `${prefix} client_id=${cap.client_id || '-'} `
      + `page_instance_id=${cap.page_instance_id || '-'} `
      + `conversation_id=${cap.conversation_id || '-'} `
      + `url=${cap.url || '-'} `
      + `online=${cap.online ? 1 : 0} syncable=${cap.syncable ? 1 : 0} `
      + `conversation_syncable=${cap.conversation_syncable ? 1 : 0} `
      + `sendable=${cap.sendable ? 1 : 0} inputable=${cap.inputable ? 1 : 0} `
      + `bridge_connected=${cap.bridge_connected ? 1 : 0} `
      + `response_state=${cap.response_state || '-'} `
      + `response_state_reason=${cap.response_state_reason || '-'} `
      + `reason=${cap.reason || '-'}`;

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  async function waitComposerSendConfirmed(content, timeoutMs = 5000) {
    const startedAt = Date.now();
    const contentText = String(content || '').trim();
    const contentProbe = contentText.slice(0, 80);

    while (Date.now() - startedAt < timeoutMs) {
      if (ComposerApi.isAssistantLikelyBusy()) {
        return { ok: true, reason: 'assistant_busy' };
      }

      const latest = getLatestConversationMessageRecord({ preferAssistant: false });
      if (latest && latest.role === 'user') {
        const latestText = String(latest.text || '').trim();
        if (!contentText || (contentProbe && latestText.includes(contentProbe))) {
          return { ok: true, reason: 'latest_user_matches' };
        }
      }

      const composerText = ComposerApi.getComposerText();
      if (!composerText && !ComposerApi.canSendNow()) {
        return { ok: true, reason: 'composer_cleared' };
      }

      await sleep(250);
    }

    return { ok: false, reason: 'timeout' };
  }

  async function sendContentViaComposer(options = {}) {
    const source = String(options.source || 'unknown');
    const content = String(options.content || '').trim();
    const sendExistingComposer = options.sendExistingComposer === true;
    const allowReplaceDraft = options.allowReplaceDraft === true;
    const waitUntilSendable = options.waitUntilSendable !== false;
    const blockWhenResponding = options.blockWhenResponding !== false;
    const timeoutMs = Number(options.timeoutMs || 60000);

    logPageCapability(getPageCapability(`send:${source}`), '[SEND][CAPABILITY]');

    if (!sendExistingComposer && !content) {
      return { ok: false, reason: 'empty_content', source };
    }

    const responseState = detectComposerResponseState();

    if (blockWhenResponding && responseState.is_responding) {
      return {
        ok: false,
        reason: 'assistant_busy',
        response_state: responseState,
        source,
      };
    }

    if (!sendExistingComposer && !responseState.can_accept_input) {
      return {
        ok: false,
        reason: responseState.response_state_reason || 'cannot_accept_input',
        response_state: responseState,
        source,
      };
    }

    if (!sendExistingComposer) {
      const existingText = ComposerApi.getComposerText();
      if (existingText && existingText !== content && !allowReplaceDraft) {
        return {
          ok: false,
          reason: 'composer_has_existing_text',
          existing_len: existingText.length,
          source,
        };
      }

      const okSet = ComposerApi.setComposerValue(content);
      if (!okSet) {
        return { ok: false, reason: 'composer_not_found', source };
      }

      await sleep(300);
    } else if (!ComposerApi.getComposerText()) {
      return { ok: false, reason: 'composer_empty', source };
    }

    const startedAt = Date.now();
    while (waitUntilSendable && !ComposerApi.canSendNow()) {
      if (Date.now() - startedAt >= timeoutMs) {
        return { ok: false, reason: 'send_button_wait_timeout', source };
      }
      await sleep(250);
    }

    if (!ComposerApi.canSendNow()) {
      return { ok: false, reason: 'send_button_unavailable', source };
    }

    const okClick = ComposerApi.clickSend();
    if (!okClick) {
      return { ok: false, reason: 'click_send_failed', source };
    }

    const confirmed = await waitComposerSendConfirmed(
      sendExistingComposer ? ComposerApi.getComposerText() : content,
      Number(options.confirmTimeoutMs || 5000),
    );

    if (!confirmed.ok) {
      return {
        ok: false,
        reason: `send_not_confirmed:${confirmed.reason}`,
        source,
      };
    }

    return { ok: true, reason: confirmed.reason, source };
  }

  function getCopiedTextStats(text) {
    const value = String(text || '');

    const charCount = Array.from(value).length;
    const noSpaceCharCount = Array.from(value.replace(/\s+/g, '')).length;
    const hanCount = (value.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) || []).length;
    const lineCount = value ? value.split(/\r\n|\r|\n/).length : 0;

    return {
      charCount,
      noSpaceCharCount,
      hanCount,
      lineCount,
    };
  }

  /********************************************************************
   * 3. UploadModule：多文件上传模块
   ********************************************************************/

  const UploadModule = (() => {
    const DEFAULT_UPLOAD_GROUP_NAME = '默认组';
    const SEND_WAIT_TIMEOUT_MS = 60 * 1000;
    const COPY_CONTINUE_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
    const COPY_CONTINUE_STABLE_ROUNDS = 2;
    const COPY_CONTINUE_STABLE_INTERVAL_MS = 350;

    const state = {
      groups: [],
      activeGroupId: '',
      selectedFileIdByGroup: {},
      queue: [],
      groupCounts: null,
      running: false,
      cancelled: false,
      activeId: '',
      observer: null,
      uploadAbortController: null,
      runId: 0,
      waitingSend: false,
      autoSendWaiting: false,
      autoSendRunId: 0,
      autoSendStartedAt: 0,
      autoSendLastStatusAt: 0,
      autoSendLastLogAt: 0,
      cancelWaitingSend: false,
      waitingSendTimer: null,
      waitingSendInterval: null,
      waitingSendAbortController: null,
    };

    let host = null;
    let listEl = null;
    let groupListEl = null;
    let startBtn = null;
    let rootElRef = null;
    const uploadDropBoundTargets = new WeakSet();
    let panelDropEl = null;
    let dbPromise = null;
    let managePanelEl = null;
    let manageGroupListEl = null;
    let groupNameInputEl = null;
    let lastGroupNameInputValue = '';
    let clearConfirmUntil = 0;
    let deleteConfirmUntil = 0;
    let persistQueuePromise = Promise.resolve();
    let uploadModuleInitPromise = Promise.resolve();
    const uploadTimers = createTimerRegistry('UPLOAD');
    let quickPromptRenderSignature = '';
    let persistQueueThrottleTimer = 0;
    let persistQueuePendingStage = '';
    let uploadSendShortcutBound = false;
    let uploadSendShortcutLastAt = 0;
    let uploadSendShortcutRunning = false;
    let uploadSendTaskStartedAt = 0;
    let uploadShortcutDebugLastAt = 0;
    let copyLastMessageShortcutBound = false;
    let copyLastMessageShortcutLastAt = 0;
    let copyLastMessageShortcutRunning = false;
    let shortcutWindowFallbackBound = false;
    let shortcutDebugLastAt = 0;
    let copyLastMessageTaskRunning = false;
    let copyLastMessageTaskSource = '';
    let copyLastMessageTaskStartedAt = 0;
    let copyLastMessageWaiting = false;
    let copyLastMessageWaitRunId = 0;
    let copyLastMessageHardResetTimer = 0;
    let copyContinueTaskRunning = false;
    let copyTaskStatus = 'idle';
    let copyContinueTaskStartedAt = 0;
    let uploadUiActionLastKey = '';
    let uploadUiActionLastAt = 0;
    let quickPromptActiveCategory = '全部';

    function getActiveGroupId() {
      return String(state.activeGroupId || '').trim();
    }

    function getActiveGroupFiles() {
      const groupId = getActiveGroupId();
      if (!groupId) {
        return [];
      }
      return (state.queue || []).filter(
        (file) => file && String(file.groupId || '').trim() === groupId,
      );
    }

    function getSelectedFileIdForActiveGroup() {
      const groupId = getActiveGroupId();
      if (!groupId) {
        return '';
      }
      return String(
        state.selectedFileIdByGroup[groupId] || state.activeId || '',
      ).trim();
    }

    function setSelectedFileIdForActiveGroup(fileId, meta = {}) {
      const groupId = getActiveGroupId();
      const id = String(fileId || '').trim();
      if (!groupId) {
        return;
      }
      state.selectedFileIdByGroup[groupId] = id;
      state.activeId = id;
      const file = getActiveGroupFiles().find((item) => item.id === id) || null;
      console.log('[UPLOAD][FILE_SELECT]', {
        projectKey: groupId,
        fileId: id,
        fileName: file && file.name ? file.name : '',
        reason: meta.reason || '',
      });
    }

    function resolveSelectedFileIdForGroup(groupId, files) {
      const gid = String(groupId || '').trim();
      const oldSelectedId = String(state.selectedFileIdByGroup[gid] || '').trim();
      if (oldSelectedId && files.some((file) => file && file.id === oldSelectedId)) {
        return oldSelectedId;
      }
      if (files.length > 0) {
        return files[0].id;
      }
      return '';
    }

    function syncActiveGroupSelectionAfterQueueLoad(groupId) {
      const gid = String(groupId || getActiveGroupId() || '').trim();
      const files = getActiveGroupFiles();
      const selectedId = resolveSelectedFileIdForGroup(gid, files);
      state.selectedFileIdByGroup[gid] = selectedId;
      state.activeId = selectedId;
      console.log('[UPLOAD][PROJECT_SWITCH]', {
        activeProjectKey: gid,
        fileCount: files.length,
        selectedFileId: selectedId,
      });
    }

    function getSelectedUploadFile() {
      const groupId = getActiveGroupId();
      const fileId = getSelectedFileIdForActiveGroup();
      if (!groupId || !fileId) {
        return null;
      }
      return getActiveGroupFiles().find((file) => file.id === fileId) || null;
    }

    function shouldSkipUploadUiAction(actionKey, source, intervalMs) {
      const now = Date.now();
      const action = String(actionKey || '');
      const src = String(source || '');
      const gap = now - uploadUiActionLastAt;

      const previousWasPointerDown = uploadUiActionLastKey === `${action}:pointerdown`;
      const currentIsMouseFollowup =
        src === 'mousedown' ||
        src === 'click' ||
        src === 'delegated-click';

      if (previousWasPointerDown && currentIsMouseFollowup && gap < Number(intervalMs || 350)) {
        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][skip] action=${actionKey} source=${source || '-'} gap=${gap} reason=pointerdown-already-handled`,
        );
        return true;
      }

      uploadUiActionLastKey = `${action}:${src}`;
      uploadUiActionLastAt = now;
      return false;
    }

    function formatToolboxError(err) {
      return err && err.message ? err.message : String(err);
    }

    function clearStaleUploadButtonBusy(button, options = {}) {
      const maxBusyMs = Number(options.maxBusyMs) > 0 ? Number(options.maxBusyMs) : 90000;
      const action = String(options.action || 'button');
      const source = String(options.source || '-');
      const logTag = String(options.logTag || 'UPLOAD_UI_ACTION');

      if (!button || button.dataset.busy !== '1') {
        return { wasBusy: false, skipped: false, busyMs: 0 };
      }

      const busyAt = Number(button.dataset.busyAt || 0);
      const busyMs = busyAt > 0 ? Date.now() - busyAt : 0;

      if (busyAt > 0 && busyMs <= maxBusyMs) {
        return { wasBusy: true, skipped: true, busyMs };
      }

      ToolboxShell.appendLog(
        `[${logTag}][stale-button-release] action=${action} source=${source} busyMs=${busyMs || '-'}`,
      );
      button.dataset.busy = '0';
      button.dataset.busyAt = '0';
      button.dataset.waitingReply = '0';
      return { wasBusy: true, skipped: false, busyMs };
    }

    function setCopyContinueButtonBusy(btn, busy, options = {}) {
      if (!btn) {
        return;
      }

      if (!busy) {
        btn.dataset.busy = '0';
        btn.dataset.busyAt = '0';
        btn.dataset.waitingReply = '0';
        btn.classList.remove('cgpt-btn-busy');
        btn.textContent = String(options.idleText || '复制并继续');
        applyWaitingAnswerButtonStyle(btn, false, {
          extraIdleClasses: ['copy-continue'],
        });
        btn.disabled = false;
        btn.removeAttribute('disabled');
        btn.removeAttribute('aria-disabled');
        btn.setAttribute('aria-disabled', 'false');
        return;
      }

      const startedAt = Number(options.startedAt) > 0 ? Number(options.startedAt) : Date.now();
      const assistantBusy = !!options.assistantBusy;
      btn.dataset.busy = '1';
      btn.dataset.busyAt = String(startedAt);
      btn.dataset.waitingReply = assistantBusy ? '1' : '0';
      btn.classList.add('cgpt-btn-busy');
      const busyText = String(
        options.text || (assistantBusy ? '等待回复...' : '继续中...'),
      );
      btn.textContent = busyText;
      applyWaitingAnswerButtonStyle(btn, isWaitingAnswerVisualState({
        text: busyText,
        isResponding: assistantBusy,
      }), {
        extraIdleClasses: ['copy-continue'],
      });
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
    }

    function playCopySuccessBeepSafe(source, logPrefix) {
      const tag = String(logPrefix || 'copy');
      return playCopySuccessBeep(String(source || '-'), {
        force: true,
        ignoreCooldown: true,
      }).catch((beepError) => {
        const beepErrText = formatToolboxError(beepError);
        console.warn('[ChatGPT toolbox] copy success beep failed', beepError);
        ToolboxShell.appendLog(
          `[BEEP][COPY_SUCCESS_FAILED] source=${tag}:${source || '-'} error=${beepErrText}`,
        );
      });
    }

    function createDefaultGroup() {
      return {
        id: createId('upload_group'),
        name: DEFAULT_UPLOAD_GROUP_NAME,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    function newId() {
      return createId('upload');
    }

    function isUploadBlobPersistEnabled() {
      return !!MemoryManager.get(MemoryManager.KEYS.uploadBlobPersistEnabled, true);
    }

    function isUploadUseUniqueFileNameEnabled() {
      return !!MemoryManager.get(MemoryManager.KEYS.uploadUseUniqueFileName, true);
    }

    function setUploadUseUniqueFileNameEnabled(value) {
      MemoryManager.set(MemoryManager.KEYS.uploadUseUniqueFileName, !!value);
    }

    function isFileHandleLike(value) {
      return !!(
        value &&
        typeof value.getFile === 'function'
      );
    }

    function getPageWindowForFilePicker() {
      try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
          return unsafeWindow;
        }
      } catch (e) {
        console.warn('[ChatGPT toolbox] unsafeWindow unavailable for file picker', e);
      }

      return window;
    }

    function getShowOpenFilePickerFn() {
      const pageWin = getPageWindowForFilePicker();

      if (pageWin && typeof pageWin.showOpenFilePicker === 'function') {
        return pageWin.showOpenFilePicker.bind(pageWin);
      }

      if (typeof window.showOpenFilePicker === 'function') {
        return window.showOpenFilePicker.bind(window);
      }

      return null;
    }

    function hasActuallyReusableUploadSource(q) {
      return !!(
        q &&
        (
          isFileLike(q.file) ||
          isBlobLike(q.blob)
        )
      );
    }

    function canReadFromLocal(q) {
      return !!(
        q &&
        q.sourceKind === 'local-handle' &&
        hasLocalReadableHandle(q)
      );
    }

    function hasAttemptableUploadSource(q) {
      return !!(
        q &&
        (
          q.file ||
          q.blob ||
          (
            q.fileHandle &&
            typeof q.fileHandle.getFile === 'function'
          )
        )
      );
    }

    function isHandleReadFailureMessage(message) {
      const text = String(message || '');

      return text.includes('本地文件读取失败') ||
        text.includes('缺少文件，请重新拖入') ||
        text.includes('没有本地文件读取权限') ||
        text.includes('本地文件为空或读取失败');
    }

    function shouldPreserveMissingOrFailedState(q) {
      if (!q) return false;

      if (hasAttemptableUploadSource(q)) {
        return false;
      }

      const isMissingOrFailed = q.state === UploadState.MISSING_FILE || q.state === UploadState.FAILED;

      if (!isMissingOrFailed) {
        return false;
      }

      if (isHandleReadFailureMessage(q.message)) {
        return true;
      }

      if (
        q.state === UploadState.MISSING_FILE &&
        (q.sourceKind === 'cached-only' || q.sourceKind === 'missing-local')
      ) {
        return true;
      }

      if (
        q.state === UploadState.MISSING_FILE &&
        !hasActuallyReusableUploadSource(q) &&
        isFileHandleLike(q.fileHandle)
      ) {
        return true;
      }

      return false;
    }

    function resetQueueItemsForUpload(options = {}) {
      const opts = options || {};
      const forceAll = !!opts.forceAll;
      const forceResetAttached = opts.forceResetAttached === true;
      const preserveAttached = opts.preserveAttached !== false;
      let changed = false;

      state.queue.forEach((q) => {
        if (!q) return;

        if (
          q.state === UploadState.ATTACHED &&
          preserveAttached &&
          !forceResetAttached
        ) {
          return;
        }

        if (
          q.state === UploadState.ATTACHED &&
          q.attachedInSession &&
          !forceResetAttached
        ) {
          return;
        }

        if (forceAll || hasAttemptableUploadSource(q)) {
          q.state = UploadState.IDLE;
          q.message = '';
          q.uploadName = '';
          q.persistedAttached = false;
          q.attachedInSession = false;
          q.updatedAt = Date.now();
          changed = true;
        }
      });

      return changed;
    }

    function isUploadFailedState(q) {
      return !!q && (
        q.state === UploadState.FAILED ||
        q.state === UploadState.MISSING_FILE ||
        q.state === UploadState.CANCELLED
      );
    }

    function shouldShowRebindButton(q) {
      if (!q) return false;

      if (isCachedUploadSnapshot(q)) {
        return true;
      }

      return (
        q.state === UploadState.MISSING_FILE ||
        q.sourceKind === 'missing-file' ||
        q.sourceKind === 'missing-local' ||
        (!q.file && !q.blob && !hasLocalReadableHandle(q))
      );
    }

    function describeUploadSource(q) {
      if (!q) {
        return {
          exists: false,
        };
      }

      return {
        exists: true,
        id: q.id || '',
        groupId: q.groupId || '',
        name: q.name || '',
        displayPath: q.displayPath || '',
        size: Number(q.size) || 0,
        lastModified: Number(q.lastModified) || 0,
        sourceKind: q.sourceKind || '',
        state: q.state || '',
        message: q.message || '',
        uploadName: q.uploadName || '',

        hasFile: !!q.file,
        isFile: isFileLike(q.file),
        fileTag: q.file ? getObjectTag(q.file) : '',
        fileName: q.file && q.file.name ? q.file.name : '',
        fileSize: q.file && typeof q.file.size === 'number' ? q.file.size : null,
        fileType: q.file && q.file.type ? q.file.type : '',

        hasBlob: !!q.blob,
        isBlob: isBlobLike(q.blob),
        blobTag: q.blob ? getObjectTag(q.blob) : '',
        blobSize: q.blob && typeof q.blob.size === 'number' ? q.blob.size : null,
        blobType: q.blob && q.blob.type ? q.blob.type : '',

        hasHandle: !!q.fileHandle,
        isHandle: isFileHandleLike(q.fileHandle),
        handleName: q.fileHandle && q.fileHandle.name ? q.fileHandle.name : '',
        handleKind: q.fileHandle && q.fileHandle.kind ? q.fileHandle.kind : '',

        readable: hasActuallyReusableUploadSource(q),
        attemptable: hasAttemptableUploadSource(q),
      };
    }

    function logUploadItemSource(stage, q, extra = {}) {
      const info = describeUploadSource(q);
      const text = [
        `[UPLOAD_DIAG][${stage}]`,
        `name=${info.name || '-'}`,
        `groupId=${info.groupId || '-'}`,
        `sourceKind=${info.sourceKind || '-'}`,
        `state=${info.state || '-'}`,
        `size=${info.size || 0}`,
        `lastModified=${info.lastModified || 0}`,
        `readable=${info.readable ? '1' : '0'}`,
        `file=${info.isFile ? '1' : '0'}(${info.fileTag || '-'}/${info.fileSize ?? '-'})`,
        `blob=${info.isBlob ? '1' : '0'}(${info.blobTag || '-'}/${info.blobSize ?? '-'})`,
        `handle=${info.isHandle ? '1' : '0'}(${info.handleName || '-'})`,
        extra.reason ? `reason=${extra.reason}` : '',
      ].filter(Boolean).join(' ');

      ToolboxShell.appendLog(text);
      console.debug('[ChatGPT toolbox] upload item source', stage, info, extra);
    }

    function logUploadQueueSnapshot(stage, extra = {}) {
      try {
        const list = state.queue.map((q) => describeUploadSource(q));
        const reusable = list.filter((x) => x.readable).length;
        const attemptable = list.filter((x) => x.attemptable).length;
        const missing = list.length - attemptable;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][${stage}] queue=${list.length} reusable=${reusable} attemptable=${attemptable} missing=${missing}`,
        );

        console.debug('[ChatGPT toolbox] upload queue snapshot', {
          stage,
          reusable,
          attemptable,
          missing,
          extra,
          list,
        });
      } catch (e) {
        console.warn('[ChatGPT toolbox] logUploadQueueSnapshot failed', stage, e);
      }
    }

    // 注意：displayPath 只是展示信息，不能作为本地读取依据
    // 浏览器通常不会暴露真实绝对路径
    // 是否能重新读取本地文件，只能fileHandle 是否存在且可 getFile

    function hasLocalReadableHandle(q) {
      return !!(
        q &&
        q.fileHandle &&
        typeof q.fileHandle.getFile === 'function'
      );
    }

    function isCachedUploadSnapshot(q) {
      if (!q) return false;

      if (
        q.state === UploadState.MISSING_FILE ||
        q.sourceKind === 'missing-file' ||
        q.sourceKind === 'missing-local'
      ) {
        return false;
      }

      if (hasLocalReadableHandle(q)) {
        return false;
      }

      if (q.sourceKind === 'session-file') {
        return false;
      }

      return (
        q.sourceKind === 'cached-blob' ||
        q.sourceKind === 'cached-only' ||
        q.readMode === 'snapshot'
      ) && Boolean(q.file || q.blob);
    }

    function getUploadInlineStatusText(q) {
      if (!q) return '未知来源';

      if (
        q.state === UploadState.MISSING_FILE ||
        q.sourceKind === 'missing-file' ||
        q.sourceKind === 'missing-local' ||
        (!q.file && !q.blob && !hasLocalReadableHandle(q))
      ) {
        return '缺少文件：请重新绑定';
      }

      if (q.state === UploadState.ATTACHED) {
        return '已绑定到输入框';
      }

      if (hasLocalReadableHandle(q)) {
        return '本地直读';
      }

      if (isCachedUploadSnapshot(q)) {
        if (q.sourceKind === 'cached-only') {
          return '缺少原文件：使用缓存';
        }
        return '可上传：缓存文件';
      }

      if (q.file || q.blob) {
        return '本次选择';
      }

      return '未知来源';
    }

    function buildUploadItemTitle(q) {
      if (!q) return '';

      const lines = [];

      lines.push(`文件名：${q.name || '-'}`);
      lines.push(`大小：${formatBytes(q.size)}`);

      if (q.lastModified) {
        const d = new Date(Number(q.lastModified));
        if (!Number.isNaN(d.getTime())) {
          lines.push(`修改时间：${d.toLocaleString()}`);
        }
      }

      lines.push(`来源：${getUploadInlineStatusText(q)}`);

      if (hasLocalReadableHandle(q)) {
        lines.push('说明：已保存本地文件句柄，刷新后可重新读取原文件');
      } else if (isCachedUploadSnapshot(q)) {
        lines.push('说明：这是浏览器 IndexedDB 中保存的文件快照，不是本地文件句柄；原文件变化后不会自动同步');
      } else if (q.sourceKind === 'session-file' && (q.file || q.blob)) {
        lines.push('说明：仅当前页面内存可用，刷新后会尝试转为缓存快照');
      } else if (
        q.sourceKind === 'missing-file' ||
        q.sourceKind === 'missing-local' ||
        q.state === UploadState.MISSING_FILE
      ) {
        lines.push('说明：缺少可读文件，请点击“重新绑定”或重新拖入');
      }

      return lines.join('\n');
    }

    function refreshQueueReadableState() {
      let changed = false;

      state.queue.forEach((q) => {
        if (!q) return;

        const attemptable = hasAttemptableUploadSource(q);

        if (!attemptable) {
          if (q.state !== UploadState.MISSING_FILE) {
            logUploadItemSource('refreshQueueReadableState:mark-missing', q, {
              reason: 'file/blob/handle all missing',
            });
            q.state = UploadState.MISSING_FILE;
            changed = true;
          }

          const msg = q.sourceKind === 'cached-only'
            ? '缺少文件，请重新拖入'
            : (q.sourceKind === 'missing-local'
              ? '缺少文件，请重新拖入'
              : (q.sourceKind === 'session-file'
                ? '缺少文件，请重新拖入'
                : '缺少文件，请重新拖入'));

          if (q.message !== msg) {
            q.message = msg;
            changed = true;
          }

          if (!q.sourceKind || q.sourceKind === '') {
            q.sourceKind = 'missing-local';
            changed = true;
          }

          q.uploadName = '';
          return;
        }

        if (q.state === UploadState.CANCELLED) {
          if (state.running || state.cancelled) {
            return;
          }

          return;
        }

        if (
          q.state === UploadState.MISSING_FILE ||
          q.state === UploadState.FAILED
        ) {
          if (shouldPreserveMissingOrFailedState(q)) {
            logUploadItemSource('refreshQueueReadableState:keep-missing', q, {
              reason: 'handle-read-failure-or-no-reliable-source',
            });
            return;
          }

          const recoverable = hasActuallyReusableUploadSource(q) || canReadFromLocal(q);

          if (recoverable) {
            logUploadItemSource('refreshQueueReadableState:mark-idle', q, {
              reason: 'file/blob/handle-available',
            });
            q.state = UploadState.IDLE;
            q.message = '';
            q.uploadName = '';
            changed = true;
          }

          return;
        }

        if (q.state === UploadState.ATTACHED && hasAttachmentEvidenceForItem(q)) {
          if (q.persistedAttached) {
            q.persistedAttached = false;
            changed = true;
          }
          return;
        }

        if (q.state === UploadState.ATTACHED && !hasAttachmentEvidenceForItem(q)) {
          if (state.running || q.attachedInSession) {
            return;
          }

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][refreshQueue:attached-reset-after-reload] ${q.name} 页面附件区未检测到，已改为待上传`
          );
          q.state = UploadState.IDLE;
          q.uploadName = '';
          if (!q.message) {
            q.message = q.persistedAttached
              ? '上次已上传，刷新后请点击上传'
              : '页面附件区未检测到，请再次点击上传';
          }
          changed = true;
        }
      });

      return changed;
    }

    function normalizeUploadState(rawState, hasReadableFile) {
      if (!hasReadableFile) {
        return UploadState.MISSING_FILE;
      }

      if (rawState === UploadState.READY || rawState === 'READY') {
        return UploadState.IDLE;
      }

      if (rawState === UploadState.ATTACHED) {
        return UploadState.IDLE;
      }

      if (
        rawState === UploadState.READING ||
        rawState === UploadState.ATTACHING ||
        rawState === UploadState.CANCELLED ||
        rawState === UploadState.FAILED ||
        rawState === UploadState.MISSING_FILE ||
        isLegacyUploadState(rawState)
      ) {
        return UploadState.IDLE;
      }

      if (rawState === UploadState.IDLE) {
        return UploadState.IDLE;
      }

      return UploadState.IDLE;
    }

    function getPersistedUploadState(q) {
      if (!q) return UploadState.IDLE;

      if (q.sourceKind === 'cached-only' || q.sourceKind === 'missing-local') {
        return UploadState.MISSING_FILE;
      }

      if (!hasAttemptableUploadSource(q)) {
        return UploadState.MISSING_FILE;
      }

      if (shouldPreserveMissingOrFailedState(q)) {
        return UploadState.MISSING_FILE;
      }

      if (q.state === UploadState.ATTACHED) {
        if (hasAttachmentEvidenceForItem(q)) {
          return UploadState.ATTACHED;
        }
        return UploadState.IDLE;
      }

      if (
        isUploadUnfinishedState(q.state) ||
        q.state === UploadState.CANCELLED
      ) {
        return UploadState.IDLE;
      }

      if (q.state === UploadState.FAILED) {
        return UploadState.IDLE;
      }

      if (q.state === UploadState.READY || q.state === 'READY') {
        return UploadState.IDLE;
      }

      return q.state || UploadState.IDLE;
    }

    function buildPersistRow(q) {
      const sourceInfo = describeUploadSource(q);
      const hasHandle = isFileHandleLike(q.fileHandle);

      const row = {
        id: q.id,
        groupId: q.groupId || state.activeGroupId,
        name: q.name,
        displayPath: q.displayPath || q.name || '',
        size: q.size,
        lastModified: q.lastModified,
        type: q.type,
        state: getPersistedUploadState(q),
        message: q.message,
        sourceKind: q.sourceKind || '',
        readMode: q.readMode || '',
        handle: hasHandle ? q.fileHandle : null,
        uploadName: q.uploadName || '',
        manualPathNote: String(q.manualPathNote || '').trim(),
        blob: null,
        blobSaved: false,
        blobSavedAt: 0,
        debugSavedFrom: '',
      };

      const logPersistRow = (blobSaved) => {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][persist-row] name=${q.name || '-'} blob=${blobSaved ? 1 : 0} handle=${hasHandle ? 1 : 0} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'}`,
        );
      };

      if (hasHandle) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][persist:handle] name=${q.name || '-'} handle=1 sourceKind=${q.sourceKind || '-'}`,
        );
      }

      if (!isUploadBlobPersistEnabled()) {
        console.debug('[ChatGPT toolbox] buildPersistRow: Blob 持久化未开启', sourceInfo);
        logPersistRow(false);
        return row;
      }

      if (isFileLike(q.file)) {
        if (q.file.size > APP.uploadBlobMaxBytes) {
          console.warn('[ChatGPT toolbox] buildPersistRow: 文件超过限制，跳Blob 保存', {
            sourceInfo,
            limit: APP.uploadBlobMaxBytes,
          });
          logPersistRow(false);
          return row;
        }

        row.blob = q.file;
        row.blobSaved = true;
        row.blobSavedAt = Date.now();
        row.debugSavedFrom = 'file';

        console.debug('[ChatGPT toolbox] buildPersistRow: Blob q.file 保存', {
          sourceInfo,
          blobSaved: true,
        });

        logPersistRow(true);
        return row;
      }

      if (isBlobLike(q.blob)) {
        if (q.blob.size > APP.uploadBlobMaxBytes) {
          console.warn('[ChatGPT toolbox] buildPersistRow: q.blob 超过限制，跳Blob 保存', {
            sourceInfo,
            limit: APP.uploadBlobMaxBytes,
          });
          logPersistRow(false);
          return row;
        }

        row.blob = q.blob;
        row.blobSaved = true;
        row.blobSavedAt = Date.now();
        row.debugSavedFrom = 'blob';

        console.debug('[ChatGPT toolbox] buildPersistRow: Blob q.blob 保存', {
          sourceInfo,
          blobSaved: true,
        });

        logPersistRow(true);
        return row;
      }

      console.warn('[ChatGPT toolbox] buildPersistRow: 没有可保存的 File/Blob', sourceInfo);

      logPersistRow(false);
      return row;
    }

    function openDb() {
      if (dbPromise) return dbPromise;

      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error('当前浏览器不支持 IndexedDB'));
          return;
        }

        const req = indexedDB.open(APP.uploadDbName, APP.uploadDbVersion);

        req.onupgradeneeded = () => {
          const db = req.result;

          if (!db.objectStoreNames.contains(APP.uploadStore)) {
            const queueStore = db.createObjectStore(APP.uploadStore, {
              keyPath: 'id',
            });
            queueStore.createIndex('groupId', 'groupId', { unique: false });
          } else {
            const tx = req.transaction;
            const queueStore = tx.objectStore(APP.uploadStore);
            if (!queueStore.indexNames.contains('groupId')) {
              queueStore.createIndex('groupId', 'groupId', { unique: false });
            }
          }

          if (!db.objectStoreNames.contains(APP.uploadGroupStore)) {
            db.createObjectStore(APP.uploadGroupStore, {
              keyPath: 'id',
            });
          }
        };

        req.onsuccess = () => {
          const db = req.result;

          db.onversionchange = () => {
            db.close();
            dbPromise = null;
            ToolboxShell.appendLog('[UPLOAD_DB][versionchange] db closed');
          };

          db.onclose = () => {
            dbPromise = null;
            ToolboxShell.appendLog('[UPLOAD_DB][closed] IndexedDB connection closed');
          };

          db.onerror = (event) => {
            console.error('[ChatGPT toolbox] IndexedDB connection error', event);
            ToolboxShell.appendLog('[UPLOAD_DB][connection-error] IndexedDB connection error');
          };

          resolve(db);
        };

        req.onerror = () => {
          const err = req.error || new Error('IndexedDB open failed');
          dbPromise = null;

          console.error('[ChatGPT toolbox] IndexedDB open failed', err);

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[UPLOAD_DB][open:failed] error=${err && err.message ? err.message : String(err)}`,
            );
          }

          reject(err);
        };

        req.onblocked = () => {
          const err = new Error('IndexedDB open blocked by another tab or old connection');
          dbPromise = null;

          console.warn('[ChatGPT toolbox] IndexedDB open blocked');

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog('[UPLOAD_DB][open:blocked] IndexedDB 被其他页面或旧连接阻塞');
          }

          reject(err);
        };
      }).catch((err) => {
        dbPromise = null;
        throw err;
      });

      return dbPromise;
    }

    async function debugReadBackPersistedQueue(stage) {
      try {
        const db = await openDb();

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB debug getAll failed'));
        });

        const currentRows = rows.filter((r) => r.groupId === state.activeGroupId);

        const summary = currentRows.map((r) => ({
          id: r.id,
          name: r.name,
          state: r.state,
          blobSaved: !!r.blobSaved,
          hasBlob: isBlobLike(r.blob),
          blobTag: r.blob ? getObjectTag(r.blob) : '',
          blobSize: r.blob && typeof r.blob.size === 'number' ? r.blob.size : null,
          hasHandle: !!r.handle,
          handleName: r.handle && r.handle.name ? r.handle.name : '',
          debugSavedFrom: r.debugSavedFrom || '',
          message: r.message || '',
        }));

        ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}] IndexedDB回读 ${summary.length} 条：${summary.map((x) => `${x.name}:blob=${x.hasBlob ? 1 : 0},handle=${x.hasHandle ? 1 : 0},state=${x.state}`).join('|')}`);

        console.debug('[ChatGPT toolbox] persisted queue readback', {
          stage,
          activeGroupId: state.activeGroupId,
          summary,
        });
      } catch (e) {
        console.error('[ChatGPT toolbox] debugReadBackPersistedQueue failed', stage, e);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}] IndexedDB回读失败${e && e.message ? e.message : String(e)}`);
      }
    }

    async function persistQueue() {
      const groupIdSnapshot = String(state.activeGroupId || '').trim();
      if (!groupIdSnapshot) {
        console.warn('[ChatGPT toolbox] persistQueue: activeGroupId 为空');
        return;
      }

      const queueSnapshot = getActiveGroupFiles().map((item) => ({
        ...item,
        groupId: groupIdSnapshot,
      }));

      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll before persist failed'));

          req.onsuccess = () => {
            const rows = req.result || [];

            rows.forEach((r) => {
              const gid = String(r.groupId || '').trim() || groupIdSnapshot;
              if (gid === groupIdSnapshot) {
                store.delete(r.id);
              }
            });

            queueSnapshot.forEach((q) => {
              const row = buildPersistRow({
                ...q,
                groupId: groupIdSnapshot,
              });

              const putReq = store.put(row);

              putReq.onerror = (ev) => {
                if (!row.handle) {
                  return;
                }

                const err = putReq.error || new Error('IndexedDB put with handle failed');

                console.error('[ChatGPT toolbox] persist row with handle failed, retry without handle', err);
                ToolboxShell.appendLog(
                  `[UPLOAD_DIAG][persist:handle-failed] name=${row.name || '-'} error=${err && err.message ? err.message : String(err)}`,
                );

                if (typeof ev.preventDefault === 'function') {
                  ev.preventDefault();
                }

                if (typeof ev.stopPropagation === 'function') {
                  ev.stopPropagation();
                }

                store.put({
                  ...row,
                  handle: null,
                });
              };
            });
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB queue persist transaction failed'));
        });

        await debugReadBackPersistedQueue('persistQueue:after-write');
        await refreshUploadGroupCounts();
      } catch (e) {
        const errText = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
        console.error('[ChatGPT toolbox] persist upload queue failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][persistQueue:failed] groupId=${groupIdSnapshot} queueLen=${queueSnapshot.length} error=${errText}`,
        );
        throw e;
      }
    }

    const UPLOAD_PERSIST_TIMEOUT_MS = 8000;

    function withTimeout(promise, timeoutMs, label) {
      let timer = 0;

      return Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = window.setTimeout(() => {
            reject(new Error(`${label || 'operation'} timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]).finally(() => {
        if (timer) {
          window.clearTimeout(timer);
        }
      });
    }

    function schedulePersistQueue() {
      persistQueuePromise = persistQueuePromise
        .catch((e) => {
          const errText = e && e.message ? e.message : String(e);
          console.warn('[ChatGPT toolbox] previous persistQueue failed before next run', e);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][persistQueue:previous-failed] error=${errText}`
          );
        })
        .then(async () => {
          const startedAt = Date.now();

          const timeoutTimer = window.setTimeout(() => {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][persistQueue:slow] running>${UPLOAD_PERSIST_TIMEOUT_MS}ms`
            );
          }, UPLOAD_PERSIST_TIMEOUT_MS);

          try {
            await withTimeout(
              persistQueue(),
              UPLOAD_PERSIST_TIMEOUT_MS,
              'persistQueue',
            );
          } finally {
            window.clearTimeout(timeoutTimer);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][persistQueue:done] cost=${Date.now() - startedAt}ms`
            );
          }
        })
        .then(() => {
          renderGroups();
          renderManageGroupList();
        })
        .catch((e) => {
          const errName = e && e.name ? e.name : 'Error';
          const errText = e && e.message ? e.message : String(e);

          console.warn('[ChatGPT toolbox] schedulePersistQueue failed or timeout', e);

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][persistQueue:failed-or-timeout] type=${errName} timeoutMs=${UPLOAD_PERSIST_TIMEOUT_MS} note=timeout-does-not-cancel-indexeddb-write error=${errText}`,
          );

          setStatus(`上传队列保存失败或超时：${errText}`, 'error');

          throw e;
        });

      return persistQueuePromise;
    }

    function persistQueueInBackground(stage) {
      void schedulePersistQueue()
        .then(() => {
          ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}:persist-ok]`);
        })
        .catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] background persist failed', stage, err);
          ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}:persist-failed] ${errText}`);
        });
    }

    function persistQueueThrottled(stage, delayMs = 600) {
      persistQueuePendingStage = stage || persistQueuePendingStage || '-';

      if (persistQueueThrottleTimer) {
        return;
      }

      persistQueueThrottleTimer = window.setTimeout(() => {
        const stageText = persistQueuePendingStage;
        persistQueuePendingStage = '';
        persistQueueThrottleTimer = 0;

        persistQueueInBackground(stageText);
      }, delayMs);
    }

    function stripTrailingCountFromGroupName(name) {
      return String(name || '').replace(/\s+\d+$/, '').trim();
    }

    function syncActiveGroupCountInCache() {
      if (!state.groupCounts) {
        state.groupCounts = new Map();
      }

      state.groups.forEach((group) => {
        if (!state.groupCounts.has(group.id)) {
          state.groupCounts.set(group.id, 0);
        }
      });

      if (state.activeGroupId) {
        state.groupCounts.set(state.activeGroupId, getActiveGroupFiles().length);
      }
    }

    function getUploadGroupFileCount(groupId) {
      if (state.groupCounts && state.groupCounts.has(groupId)) {
        return state.groupCounts.get(groupId) || 0;
      }

      if (groupId === state.activeGroupId) {
        return getActiveGroupFiles().length;
      }

      return 0;
    }

    async function refreshUploadGroupCounts() {
      const counts = new Map();

      state.groups.forEach((group) => {
        counts.set(group.id, 0);
      });

      if (!state.groups.length) {
        state.groupCounts = counts;
        return true;
      }

      try {
        const db = await openDb();

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
          req.onerror = () => reject(req.error || new Error('refreshUploadGroupCounts getAll failed'));
        });

        rows.forEach((row) => {
          const groupId = String(row.groupId || '').trim();
          if (!groupId) {
            return;
          }
          if (!counts.has(groupId)) {
            return;
          }
          counts.set(groupId, (counts.get(groupId) || 0) + 1);
        });

        state.groupCounts = counts;
        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);
        console.error('[ChatGPT toolbox] refreshUploadGroupCounts failed', e);
        syncActiveGroupCountInCache();
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][refresh-counts:failed] activeGroupId=${state.activeGroupId || '-'} groups=${state.groups.length} type=${errName} error=${errText}`,
        );
        setStatus(`上传分组数量刷新失败：${errText}`, 'error');
        return false;
      }
    }

    function renderUploadGroupChipHtml(group, activeGroupId) {
      const active = group.id === activeGroupId ? ' active' : '';
      const count = getUploadGroupFileCount(group.id);
      const cleanName = stripTrailingCountFromGroupName(group.name);
      const title = `${cleanName}：${count} 个文件`;

      return `
          <button type="button"
            class="cgpt-chip-btn cgpt-upload-group-chip${active}"
            data-group-id="${escapeHtml(group.id)}"
            title="${escapeHtml(title)}">
            <span class="cgpt-chip-name">${escapeHtml(cleanName)}</span>
            <span class="cgpt-chip-count">${count}</span>
          </button>
        `;
    }

    async function persistGroups() {
      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadGroupStore, 'readwrite');
          const store = tx.objectStore(APP.uploadGroupStore);

          const clearReq = store.clear();

          clearReq.onerror = () => reject(clearReq.error || new Error('IndexedDB groups clear failed'));
          clearReq.onsuccess = () => {
            state.groups.forEach((g) => {
              const putReq = store.put(g);

              putReq.onerror = () => {
                reject(putReq.error || new Error(`IndexedDB groups put failed: ${g && g.id ? g.id : '-'}`));
              };
            });
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB groups transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB groups transaction aborted'));
        });
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);
        console.error('[ChatGPT toolbox] persist upload groups failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][persist-failed] groups=${state.groups.length} activeGroupId=${state.activeGroupId || '-'} type=${errName} error=${errText}`,
        );
        setStatus(`上传分组保存失败：${errText}`, 'error');
        throw e;
      }
    }

    async function loadGroups() {
      try {
        const db = await openDb();

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadGroupStore, 'readonly');
          const store = tx.objectStore(APP.uploadGroupStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB groups getAll failed'));
        });

        state.groups = rows;

        if (!state.groups.length) {
          const defaultGroup = createDefaultGroup();
          state.groups = [defaultGroup];
          state.activeGroupId = defaultGroup.id;
          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][load-empty] store=${APP.uploadGroupStore} activeGroupId=${state.activeGroupId || '-'}`,
          );
          await persistGroups();
          saveCurrentToolboxBaseState('upload-default-group-created');
          return;
        }

        const pageState = getToolboxPageState();
        const pageGroupId = resolvePageUploadGroupId(pageState);
        const pageGroupExists = Boolean(pageGroupId);
        const globalGroupId = getUploadLastActiveGroupId();
        const globalGroupExists = Boolean(globalGroupId);
        const preferred = resolvePreferredUploadGroupId(pageState, 'load-groups');

        if (preferred.groupId) {
          state.activeGroupId = preferred.groupId;
        } else if (!state.activeGroupId && state.groups.length) {
          state.activeGroupId = state.groups[0].id;
        }

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][active-resolve] pageGroup=${pageGroupId || '-'} pageExists=${pageGroupExists ? 1 : 0} globalGroup=${globalGroupId || '-'} globalExists=${globalGroupExists ? 1 : 0} active=${state.activeGroupId || '-'} source=${preferred.source || '-'}`,
        );
      } catch (e) {
        const errStack = e && e.stack ? e.stack : String(e);
        const errName = e && e.name ? e.name : 'Error';
        console.error('[ChatGPT toolbox] load upload groups failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][load-failed] store=${APP.uploadGroupStore} type=${errName} error=${errStack}`,
        );
        setStatus(
          '读取文件组失败，当前为临时默认分组，请勿立即导入/删除分组；请刷新或检查 IndexedDB',
          'error',
        );

        if (!state.groups.length) {
          const tempGroup = createDefaultGroup();
          tempGroup.__temporary = true;
          state.groups = [tempGroup];
          state.activeGroupId = tempGroup.id;
        }
      }
    }

    function resolveLegacyMissingGroupTargetId() {
      const pageState = getToolboxPageState();
      const pageGroupId = resolvePageUploadGroupId(pageState);
      const globalGroupId = getUploadLastActiveGroupId();

      const candidates = [
        state.activeGroupId,
        pageGroupId,
        globalGroupId,
        state.groups[0] && state.groups[0].id,
      ].filter(Boolean);

      return candidates.find((id) => state.groups.some((g) => g.id === id)) || '';
    }

    async function migrateMissingGroupIdRows() {
      const targetId = resolveLegacyMissingGroupTargetId();

      if (!targetId) {
        ToolboxShell.appendLog('[UPLOAD_GROUP][migrate-missing-group-skip] reason=no-target-group');
        return false;
      }

      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll for migration failed'));

          req.onsuccess = () => {
            const rows = req.result || [];
            let changed = 0;

            rows.forEach((r) => {
              if (!r.groupId) {
                r.groupId = targetId;
                store.put(r);
                changed += 1;
              }
            });

            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][migrate-missing-group] target=${targetId} changed=${changed}`,
            );
            if (changed > 0) {
              ToolboxShell.appendLog(
                `[UPLOAD_GROUP][LEGACY_MIGRATE_HIT] count=${changed}`,
              );
            }
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB queue migration transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB queue migration transaction aborted'));
        });

        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        console.error('[ChatGPT toolbox] migrate missing groupId rows failed', e);

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][migrate-missing-group-error] target=${targetId || '-'} type=${errName} error=${errText}`,
        );

        setStatus(`上传队列兼容迁移失败：${errText}`, 'error');

        return false;
      }
    }

    function restoreHandleBackedUploadItem(item, restoredState, hasBlob) {
      item.sourceKind = 'local-handle';
      item.readMode = 'handle';
      item.state = UploadState.IDLE;
      item.message = '';

      if (restoredState === UploadState.ATTACHED) {
        if (hasAttachmentEvidenceForItem(item)) {
          item.state = UploadState.ATTACHED;
          item.attachedInSession = true;
          item.message = '';
        } else {
          item.persistedAttached = true;
          item.state = UploadState.IDLE;
          item.message = '上次已上传，刷新后请点击上传';
          item.uploadName = '';
        }
      } else {
        item.state = normalizeUploadState(restoredState, true);
      }

      return false;
    }

    function restoreBlobBackedUploadItem(item, row, restoredState) {
      const restoredFile = normalizeToNativeFile(row.blob, item.name || 'upload.bin');

      item.file = restoredFile;
      item.blob = restoredFile || row.blob;
      item.sourceKind = 'cached-blob';
      item.readMode = 'snapshot';
      item.uploadName = '';

      if (restoredState === UploadState.ATTACHED && hasAttachmentEvidenceForItem(item)) {
        item.state = UploadState.ATTACHED;
        item.attachedInSession = true;
        item.message = '';
      } else {
        item.state = UploadState.IDLE;
        item.message = restoredState === UploadState.ATTACHED
          ? '上次已上传，当前可重新上传'
          : '';
      }

      if (restoredState === UploadState.ATTACHED) {
        item.persistedAttached = true;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][loadQueue:cached-blob-restored] name=${item.name || '-'} groupId=${item.groupId || '-'} size=${item.size}`,
      );

      return false;
    }

    function restoreMissingUploadItem(item, restoredState) {
      item.sourceKind = 'missing-file';
      item.readMode = '';
      item.state = UploadState.MISSING_FILE;
      item.message = '缺少文件，请重新拖入';
      item.uploadName = '';

      if (restoredState === UploadState.ATTACHED) {
        item.persistedAttached = true;
      }

      return true;
    }

    function restoreUploadItemFromPersistRow(row, activeGroupId) {
      const restoredState = row.state || UploadState.IDLE;
      const hasBlob = isBlobLike(row.blob);
      const handle = row.handle || null;

      const item = {
        id: row.id || newId(),
        groupId: row.groupId || activeGroupId,
        name: row.name || 'unknown',
        displayPath: row.displayPath || row.name || 'unknown',
        size: Number(row.size) || 0,
        lastModified: Number(row.lastModified) || 0,
        type: row.type || 'application/octet-stream',
        file: null,
        blob: hasBlob ? row.blob : null,
        fileHandle: handle && isFileHandleLike(handle) ? handle : null,
        state: UploadState.IDLE,
        message: '',
        uploadName: row.uploadName || '',
        manualPathNote: String(row.manualPathNote || '').trim(),
        persistedAttached: false,
        attachedInSession: false,
        sourceKind: row.sourceKind || '',
        readMode: row.readMode || '',
      };

      let needsReDrag = false;

      if (item.fileHandle) {
        needsReDrag = restoreHandleBackedUploadItem(item, restoredState, hasBlob);
      } else if (hasBlob) {
        needsReDrag = restoreBlobBackedUploadItem(item, row, restoredState);
      } else {
        needsReDrag = restoreMissingUploadItem(item, restoredState);
      }

      console.debug('[ChatGPT toolbox] loadQueue row restore', {
        row: {
          id: row.id,
          name: row.name,
          state: row.state,
          blobSaved: !!row.blobSaved,
          hasBlob: isBlobLike(row.blob),
          blobTag: row.blob ? getObjectTag(row.blob) : '',
          blobSize: row.blob && typeof row.blob.size === 'number' ? row.blob.size : null,
          hasHandle: !!row.handle,
          handleName: row.handle && row.handle.name ? row.handle.name : '',
          debugSavedFrom: row.debugSavedFrom || '',
        },
        item: describeUploadSource(item),
        needsReDrag,
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][restore-row] name=${item.name || '-'} blob=${hasBlob ? 1 : 0} handle=${item.fileHandle ? 1 : 0} sourceKind=${item.sourceKind || '-'} readMode=${item.readMode || '-'}`,
      );

      logUploadItemSource('loadQueue:item-restored', item, {
        reason: needsReDrag ? 'missing-readable-source' : 'restored-readable-source',
      });

      return item;
    }

    async function loadQueueForActiveGroup() {
      if (!state.activeGroupId) {
        console.warn('[ChatGPT toolbox] loadQueueForActiveGroup: activeGroupId 为空');
        state.queue = [];
        render();
        return;
      }

      try {
        const db = await openDb();

        const migrated = await migrateMissingGroupIdRows();

        if (migrated === false) {
          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][load-queue:migrate-skipped] groupId=${state.activeGroupId || '-'} note=legacy-rows-without-groupId-may-be-invisible`,
          );
        }

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);

          if (store.indexNames.contains('groupId')) {
            const index = store.index('groupId');
            const req = index.getAll(state.activeGroupId);

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error || new Error('IndexedDB queue group index getAll failed'));
            return;
          }

          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll failed'));
        });

        state.queue = rows
          .filter((r) => String(r.groupId || '').trim() === state.activeGroupId)
          .map((r) => restoreUploadItemFromPersistRow(r, state.activeGroupId));

        refreshQueueReadableState();
        syncActiveGroupSelectionAfterQueueLoad(state.activeGroupId);
        await refreshUploadGroupCounts();
        render();
        logUploadQueueSnapshot('loadQueue:after-load');
      } catch (e) {
        console.warn('[ChatGPT toolbox] load upload queue for group failed', e);
        state.queue = [];
        syncActiveGroupCountInCache();
        render();
        setStatus(`上传队列恢复失败：${e && e.message ? e.message : String(e)}`);
      }
    }

    function isHardFileReadFailure(reason) {
      const text = String(reason || '');

      return text.includes('缺少文件，请重新拖入') ||
        text.includes('没有本地文件读取权限') ||
        text.includes('本地文件读取失败') ||
        text.includes('本地文件为空或读取失败') ||
        text.includes('缺少可读取的文件对象') ||
        text.includes('请重新拖入') ||
        text.includes('没有可上传的 File 对象');
    }

    function hasAttachmentEvidenceForItem(q) {
      if (!q) return false;

      const haystack = ComposerApi.collectAttachmentChipText();

      const names = [
        q.uploadName,
        q.name,
      ].filter(Boolean);

      return names.some((name) => ComposerApi.fileNameEvidence(name, haystack));
    }

    async function reconcileFailedItems() {
      const candidates = state.queue.filter((q) =>
        q.state === UploadState.FAILED ||
        isLegacyUploadState(q.state)
      );

      for (const q of candidates) {
        if (hasAttachmentEvidenceForItem(q)) {
          updateItem(q.id, {
            state: UploadState.ATTACHED,
            message: '',
          });

          ToolboxShell.appendLog(`失败条目已复核为成功：${q.name}`);
        }
      }
    }

    function getActiveGroup() {
      return state.groups.find((g) => g.id === state.activeGroupId) || null;
    }

    function getActiveGroupName() {
      const g = getActiveGroup();
      return g ? g.name : '未命名组';
    }

    function resolvePageUploadGroupId(pageState) {
      const stateObj = pageState && typeof pageState === 'object'
        ? pageState
        : getToolboxPageState();

      const groupId = String(readToolboxStateField(stateObj, 'uploadActiveGroupId', '')).trim();

      if (groupId && state.groups.some((g) => g.id === groupId)) {
        return groupId;
      }

      return '';
    }

    function getLastManualUploadGroupId() {
      const id = String(
        MemoryManager.get(MemoryManager.KEYS.lastManualUploadGroupId, '') || '',
      ).trim();

      if (!id) {
        return '';
      }

      return state.groups.some((g) => g.id === id) ? id : '';
    }

    function saveLastManualUploadGroupId(groupId, reason = '') {
      const id = String(groupId || '').trim();

      if (!id) {
        return;
      }

      if (!state.groups.some((g) => g.id === id)) {
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][save-last-manual-skip] reason=${reason || '-'} groupId=${id} exists=0`,
        );
        return;
      }

      MemoryManager.set(MemoryManager.KEYS.lastManualUploadGroupId, id);

      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][save-last-manual] reason=${reason || '-'} groupId=${id}`,
      );
    }

    function saveUploadLastActiveGroupId(groupId, reason = '') {
      const id = String(groupId || '').trim();
      if (!id) {
        return;
      }
      if (!state.groups.some((g) => g.id === id)) {
        return;
      }
      MemoryManager.set(MemoryManager.KEYS.uploadLastActiveGroupId, id);
      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][save-global-active] reason=${reason || '-'} groupId=${id}`,
      );
    }

    function getUploadLastActiveGroupId() {
      const id = String(MemoryManager.get(MemoryManager.KEYS.uploadLastActiveGroupId, '') || '').trim();
      return state.groups.some((g) => g.id === id) ? id : '';
    }

    function resolveFallbackUploadGroupId(pageState) {
      const pageGroupId = String(
        pageState ? readToolboxStateField(pageState, 'uploadActiveGroupId', '') : '',
      ).trim();

      const candidates = [
        pageGroupId,
        String(state.activeGroupId || '').trim(),
        state.groups[0] && state.groups[0].id,
      ].filter(Boolean);

      return candidates.find((id) => state.groups.some((g) => g.id === id)) || '';
    }

    function resolvePreferredUploadGroupId(pageState, reason = '') {
      const pageGroupId = resolvePageUploadGroupId(pageState);

      if (pageGroupId) {
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][RESOLVE] reason=${reason || '-'} source=page groupId=${pageGroupId}`,
        );
        return {
          groupId: pageGroupId,
          source: 'page',
        };
      }

      const fallbackGroupId = resolveFallbackUploadGroupId(pageState);
      if (fallbackGroupId) {
        const activeId = String(state.activeGroupId || '').trim();
        const globalGroupId = getUploadLastActiveGroupId();
        const lastManualGroupId = getLastManualUploadGroupId();
        let source = 'fallback';

        if (activeId && fallbackGroupId === activeId) {
          source = 'active';
        } else if (globalGroupId && fallbackGroupId === globalGroupId) {
          source = 'global';
        } else if (lastManualGroupId && fallbackGroupId === lastManualGroupId) {
          source = 'last-manual';
        } else if (state.groups[0] && fallbackGroupId === state.groups[0].id) {
          source = 'first';
        }

        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][FALLBACK] reason=${reason || '-'} source=${source} groupId=${fallbackGroupId}`,
        );
        return {
          groupId: fallbackGroupId,
          source,
        };
      }

      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][RESOLVE] reason=${reason || '-'} source=none groupId=-`,
      );
      return {
        groupId: '',
        source: 'none',
      };
    }

    async function switchGroup(groupId, options = {}) {
      if (!groupId) return;

      healStaleUploadRunningLockIfNeeded('switchGroup');

      if (state.running) {
        setStatus('正在上传中，不能切换分组');
        return;
      }

      const exists = state.groups.some((g) => g.id === groupId);
      if (!exists) {
        console.warn('[ChatGPT toolbox] switchGroup: 分组不存在', groupId);
        ToolboxShell.appendLog(`[UPLOAD_GROUP][switch:missing] groupId=${groupId || '-'}`);
        setStatus('切换失败：分组不存在', 'error');
        return;
      }

      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = state.queue.slice();

      try {
        await schedulePersistQueue();

        state.activeGroupId = groupId;

        await loadQueueForActiveGroup();

        if (options.saveGlobalFallback === true) {
          saveUploadLastActiveGroupId(groupId, options.reason || 'switch-group');
        }

        if (options.saveLastManual !== false) {
          saveLastManualUploadGroupId(groupId, options.reason || 'switch-group');
        }

        if (options.savePageState !== false) {
          saveCurrentToolboxBaseState(options.reason || 'active-upload-group-change');
        }

        render();
        setStatus(`已切换到 ${getActiveGroupName()}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][switch:ok] from=${prevActiveGroupId || '-'} to=${groupId || '-'} count=${getActiveGroupFiles().length} selected=${getSelectedFileIdForActiveGroup() || '-'}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.activeGroupId = prevActiveGroupId;
        state.activeId = prevActiveId;
        state.queue = prevQueue;

        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] switchGroup failed', e);

        setStatus(`切换分组失败，已恢复原分组：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][switch:failed-rollback] from=${prevActiveGroupId || '-'} to=${groupId || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    function buildRandomGroupName() {
      const tag = buildUploadTimestamp().slice(0, 20);
      const baseName = `项目_${tag}`;

      const existingNames = new Set(
        state.groups.map((g) => String(g.name || '').trim())
      );

      return buildUniqueName(baseName, existingNames);
    }

    function buildNextGroupName() {
      return buildRandomGroupName();
    }

    async function createGroupInline() {
      healStaleUploadRunningLockIfNeeded('createGroupInline');

      if (state.running) {
        setStatus('正在上传中，不能新建分组');
        return;
      }

      const prevGroups = state.groups.slice();
      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = state.queue.slice();

      try {
        await schedulePersistQueue();

        const groupName = buildNextGroupName();

        const group = {
          id: createId('upload_group'),
          name: groupName,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        state.groups.push(group);
        state.activeGroupId = group.id;
        state.activeId = '';
        state.selectedFileIdByGroup[group.id] = '';
        state.queue = [];

        await persistGroups();
        await schedulePersistQueue();

        saveLastManualUploadGroupId(group.id, 'create-group-inline');
        saveUploadLastActiveGroupId(group.id, 'create-group-inline');

        saveCurrentToolboxBaseState('create-group-inline');
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][save-page-active-group] reason=create-group-inline groupId=${group.id}`,
        );

        if (managePanelEl && managePanelEl.classList.contains('cgpt-toolbox-hidden')) {
          managePanelEl.classList.remove('cgpt-toolbox-hidden');
        }

        render();

        syncGroupManagePanel({
          force: true,
        });

        if (groupNameInputEl) {
          groupNameInputEl.focus();
          groupNameInputEl.select();
        }

        setStatus(`已新建分组：${group.name}`, 'success');
        ToolboxShell.appendLog(`[UPLOAD_GROUP][create-inline:ok] groupId=${group.id} name=${group.name}`);
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.groups = prevGroups;
        state.activeGroupId = prevActiveGroupId;
        state.activeId = prevActiveId;
        state.queue = prevQueue;

        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] createGroupInline failed', e);

        setStatus(`新建分组失败，已恢复原状态：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][create-inline:failed-rollback] type=${errName} error=${errText}`,
        );

        throw e;
      }
    }


    function toggleGroupManagePanel() {
      if (!managePanelEl) return;

      const hidden = managePanelEl.classList.contains('cgpt-toolbox-hidden');
      managePanelEl.classList.toggle('cgpt-toolbox-hidden', !hidden);

      if (hidden) {
        syncGroupManagePanel({
          force: true,
        });
      }
    }

    function renderManageGroupList() {
      if (!manageGroupListEl) return;

      if (!state.groups.length) {
        manageGroupListEl.innerHTML = renderEmptyState(
          '暂无分组',
          'cgpt-upload-manage-empty cgpt-empty-state',
        );
        return;
      }

      manageGroupListEl.innerHTML = state.groups.map((g) => {
        const active = g.id === state.activeGroupId ? ' active' : '';
        const count = getUploadGroupFileCount(g.id);
        const cleanName = stripTrailingCountFromGroupName(g.name);

        return `
          <button type="button"
            class="cgpt-upload-manage-group-item${active}"
            data-group-id="${escapeHtml(g.id)}"
            title="${escapeHtml(`${cleanName} · ${count} 个文件`)}">
            <span class="cgpt-upload-manage-group-name">${escapeHtml(cleanName)}</span>
            <span class="cgpt-upload-manage-group-count">${count} 个</span>
          </button>
        `;
      }).join('');
    }

    function syncGroupManagePanel(options = {}) {
      const group = getActiveGroup();

      renderManageGroupList();

      const force = options.force === true;
      const inputFocused = document.activeElement === groupNameInputEl;

      if (groupNameInputEl && (force || !inputFocused)) {
        const nextName = group ? group.name : '';
        groupNameInputEl.value = nextName;
        lastGroupNameInputValue = nextName;
      }

      const blobPersistEl = qs('#cgpt-upload-blob-persist-inline', host || document);

      if (blobPersistEl) {
        blobPersistEl.checked = isUploadBlobPersistEnabled();
      }

      const uniqueNameEl = qs('#cgpt-upload-use-unique-name-inline', host || document);

      if (uniqueNameEl) {
        uniqueNameEl.checked = isUploadUseUniqueFileNameEnabled();
      }

      const clearBtn = qs('#cgpt-upload-group-clear-inline', host || document);
      if (clearBtn) {
        clearBtn.textContent = '清空当前组';
      }

      const deleteBtn = qs('#cgpt-upload-group-delete-inline', host || document);
      if (deleteBtn) {
        deleteBtn.textContent = '删除当前组';
      }

      clearConfirmUntil = 0;
      deleteConfirmUntil = 0;
    }

    async function renameActiveGroupInline() {
      const group = getActiveGroup();

      if (!group) {
        setStatus('当前没有可重命名的分组');
        return false;
      }

      const text = String(groupNameInputEl ? groupNameInputEl.value : '').trim();

      if (!text) {
        setStatus('请输入分组名称');
        console.warn('[ChatGPT toolbox] renameActiveGroupInline: 分组名称为空');
        return false;
      }

      if (text === group.name) {
        setStatus(`分组名称未变化：${group.name}`);
        return true;
      }

      if (state.groups.some((g) => g.id !== group.id && g.name === text)) {
        setStatus('分组名称已存在');
        return false;
      }

      const prevName = group.name;
      const prevUpdatedAt = group.updatedAt;
      const nextName = normalizeEntityName(text);

      try {
        group.name = nextName;
        group.updatedAt = Date.now();

        await persistGroups();

        lastGroupNameInputValue = group.name;

        renderGroups();
        renderManageGroupList();
        render();
        syncGroupManagePanel();

        setStatus(`已保存分组名称：${group.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][rename-inline:ok] groupId=${group.id || '-'} oldName=${prevName || '-'} newName=${group.name || '-'}`,
        );

        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        group.name = prevName;
        group.updatedAt = prevUpdatedAt;

        if (groupNameInputEl) {
          groupNameInputEl.value = prevName;
        }

        renderGroups();
        renderManageGroupList();
        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] renameActiveGroupInline failed', e);

        setStatus(`保存分组名称失败，已恢复原名称：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][rename-inline:failed-rollback] groupId=${group.id || '-'} oldName=${prevName || '-'} nextName=${nextName || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    async function deleteGroupQueue(groupId) {
      const targetGroupId = String(groupId || '').trim();

      if (!targetGroupId) {
        const msg = 'deleteGroupQueue skipped: empty groupId';
        console.warn(`[ChatGPT toolbox] ${msg}`);
        ToolboxShell.appendLog('[UPLOAD_GROUP][delete-queue:skip] groupId为空');
        return;
      }

      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => {
            reject(req.error || new Error('IndexedDB getAll failed before delete group queue'));
          };

          req.onsuccess = () => {
            const rows = req.result || [];
            let deleted = 0;

            rows.forEach((row) => {
              const rowGroupId = String(row && row.groupId || '').trim();

              if (rowGroupId === targetGroupId) {
                store.delete(row.id);
                deleted += 1;
              }
            });

            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][delete-queue] groupId=${targetGroupId} deleted=${deleted}`,
            );
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => {
            reject(tx.error || new Error('IndexedDB delete group queue transaction failed'));
          };
          tx.onabort = () => {
            reject(tx.error || new Error('IndexedDB delete group queue transaction aborted'));
          };
        });

        await refreshUploadGroupCounts();
      } catch (e) {
        console.error('[ChatGPT toolbox] deleteGroupQueue failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][delete-queue:error] groupId=${targetGroupId} error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }
    }

    async function clearActiveGroupQueueInline(button) {
      const group = getActiveGroup();

      if (!group) {
        setStatus('当前没有可清空的分组');
        return;
      }

      const now = Date.now();

      if (now > clearConfirmUntil) {
        clearConfirmUntil = now + 3000;

        if (button) {
          button.textContent = '再次点击清空';
        }

        setStatus('再次点击确认清空当前组文件');
        return;
      }

      clearConfirmUntil = 0;

      const prevQueue = state.queue.slice();

      try {
        state.queue = [];

        await schedulePersistQueue();

        render();
        syncGroupManagePanel();

        setStatus(`已清空分组：${group.name}`, 'success');
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][clear-inline:ok] groupId=${group.id || '-'} name=${group.name || '-'} removed=${prevQueue.length}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.queue = prevQueue;

        render();
        syncGroupManagePanel();

        console.error('[ChatGPT toolbox] clearActiveGroupQueueInline failed', e);

        setStatus(`清空分组失败，已恢复原队列：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][clear-inline:failed-rollback] groupId=${group.id || '-'} name=${group.name || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    async function deleteActiveGroupInline(button) {
      const group = getActiveGroup();

      if (!group) {
        setStatus('当前没有可删除的分组');
        return;
      }

      if (state.groups.length <= 1) {
        setStatus('至少保留一个分组');
        return;
      }

      const now = Date.now();

      if (now > deleteConfirmUntil) {
        deleteConfirmUntil = now + 3000;

        if (button) {
          button.textContent = '再次点击删除';
        }

        setStatus('再次点击确认删除当前组');
        return;
      }

      deleteConfirmUntil = 0;

      const prevGroups = state.groups.slice();
      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = state.queue.slice();
      const nextGroups = state.groups.filter((g) => g.id !== group.id);
      const preferred = resolvePreferredUploadGroupId(getToolboxPageState(), 'delete-group-inline');
      const nextActiveGroupId = preferred.groupId || (nextGroups[0] && nextGroups[0].id) || '';

      if (!nextActiveGroupId) {
        setStatus('删除失败：没有可切换的目标分组', 'error');
        return;
      }

      try {
        await schedulePersistQueue();

        state.groups = nextGroups;
        state.activeGroupId = nextActiveGroupId;
        state.activeId = '';
        state.queue = [];

        if (state.activeGroupId) {
          saveLastManualUploadGroupId(state.activeGroupId, 'delete-group-inline');
        }

        await persistGroups();
        await loadQueueForActiveGroup();

        saveCurrentToolboxBaseState('delete-group-inline');

        try {
          await deleteGroupQueue(group.id);
        } catch (cleanupErr) {
          const cleanupText = cleanupErr && cleanupErr.message ? cleanupErr.message : String(cleanupErr);

          console.error('[ChatGPT toolbox] deleteActiveGroupInline cleanup queue failed', cleanupErr);

          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][delete-inline:queue-cleanup-failed] groupId=${group.id || '-'} name=${group.name || '-'} error=${cleanupText}`,
          );

          setStatus(`分组已删除，但旧队列清理失败：${cleanupText}`, 'error');
        }

        await refreshUploadGroupCounts();

        render();
        syncGroupManagePanel({
          force: true,
        });

        setStatus(`已删除分组：${group.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][delete-inline:ok] groupId=${group.id || '-'} name=${group.name || '-'}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.groups = prevGroups;
        state.activeGroupId = prevActiveGroupId;
        state.activeId = prevActiveId;
        state.queue = prevQueue;

        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] deleteActiveGroupInline failed', e);

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][delete-inline:failed-rollback] groupId=${group.id || '-'} name=${group.name || '-'} type=${errName} error=${errText}`,
        );

        setStatus(`删除分组失败，已恢复原状态：${errText}`, 'error');

        throw e;
      }
    }

    async function removeFileFromCurrentGroup(id) {
      if (state.running) {
        setStatus('正在上传中，不能删除文件');
        return;
      }

      const q = getActiveGroupFiles().find((item) => item.id === id);

      if (!q) {
        setStatus('未找到要删除的文件');
        console.warn('[ChatGPT toolbox] removeFileFromCurrentGroup: 文件不存在', id);
        return;
      }

      const prevQueue = state.queue.slice();

      try {
        state.queue = state.queue.filter((item) => item.id !== id);
        syncActiveGroupSelectionAfterQueueLoad(getActiveGroupId());

        await schedulePersistQueue();

        render();

        setStatus(`已从工具箱移除：${q.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:ok] id=${id || '-'} name=${q.name || '-'}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.queue = prevQueue;

        render();

        console.error('[ChatGPT toolbox] removeFileFromCurrentGroup failed', e);

        setStatus(`移除文件失败，已恢复原队列：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:failed-rollback] id=${id || '-'} name=${q.name || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    async function exportGroupsAndQueueMeta() {
      try {
        const db = await openDb();

        const groups = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadGroupStore, 'readonly');
          const store = tx.objectStore(APP.uploadGroupStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB groups export getAll failed'));
        });

        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error('IndexedDB queue export getAll failed'));
        });

        const queue = (rows || []).map((r) => ({
          id: r.id,
          groupId: r.groupId,
          name: r.name,
          displayPath: r.displayPath || r.name || '',
          size: r.size,
          lastModified: r.lastModified,
          type: r.type,
          state: r.state,
          message: r.message,
          sourceKind: r.sourceKind || '',
          readMode: r.readMode || '',
          uploadName: r.uploadName || '',
          manualPathNote: String(r.manualPathNote || '').trim(),
          blobSaved: !!r.blobSaved,
          blobSavedAt: Number(r.blobSavedAt) || 0,
        }));

        return {
          activeGroupId: state.activeGroupId,
          groups,
          queue,
        };
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);
        console.error('[ChatGPT toolbox] exportGroupsAndQueueMeta failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][export-meta:failed] activeGroupId=${state.activeGroupId || '-'} type=${errName} error=${errText}`,
        );
        throw new Error(`上传分组与队列导出失败：${errText}`);
      }
    }

    async function importGroupsAndQueueMeta(payload) {
      if (!payload || typeof payload !== 'object') {
        console.warn('[ChatGPT toolbox] importGroupsAndQueueMeta: invalid payload', payload);
        return;
      }

      const prevGroups = state.groups.slice();
      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = state.queue.slice();

      const incomingGroups = Array.isArray(payload.groups) ? payload.groups : [];
      const incomingQueue = Array.isArray(payload.queue) ? payload.queue : [];

      let nextGroups = [];
      let nextActiveGroupId = '';

      if (!incomingGroups.length) {
        const defaultGroup = createDefaultGroup();
        nextGroups = [defaultGroup];
        nextActiveGroupId = defaultGroup.id;
      } else {
        nextGroups = incomingGroups.map((g) => ({
          id: String(g.id || createId('upload_group')),
          name: String(g.name || DEFAULT_UPLOAD_GROUP_NAME).slice(0, 24),
          createdAt: Number(g.createdAt) || Date.now(),
          updatedAt: Number(g.updatedAt) || Date.now(),
        }));

        const wantedId = String(payload.activeGroupId || '');
        const exists = nextGroups.some((g) => g.id === wantedId);
        nextActiveGroupId = exists ? wantedId : nextGroups[0].id;
      }

      const validGroupIds = new Set(nextGroups.map((g) => String(g.id || '').trim()).filter(Boolean));

      try {
        state.groups = nextGroups;
        state.activeGroupId = nextActiveGroupId;
        state.activeId = '';

        await persistGroups();

        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const clearReq = store.clear();

          clearReq.onerror = () => reject(clearReq.error || new Error('IndexedDB queue clear on import failed'));

          clearReq.onsuccess = () => {
            incomingQueue.forEach((r) => {
              if (!r || !r.id) return;

              const rawGroupId = String(r.groupId || '').trim();
              const groupId = validGroupIds.has(rawGroupId)
                ? rawGroupId
                : state.activeGroupId;

              if (rawGroupId && rawGroupId !== groupId) {
                ToolboxShell.appendLog(
                  `[UPLOAD][IMPORT][QUEUE_GROUP_FALLBACK] old=${rawGroupId} fallback=${groupId}`,
                );
              }

              const row = {
                id: String(r.id),
                groupId,
                name: r.name || 'unknown',
                displayPath: r.displayPath || r.name || '',
                size: Number(r.size) || 0,
                lastModified: Number(r.lastModified) || 0,
                type: r.type || 'application/octet-stream',
                state: r.state || UploadState.IDLE,
                message: r.message || '',
                sourceKind: r.sourceKind || '',
                readMode: r.readMode || '',
                handle: null,
                uploadName: r.uploadName || '',
                manualPathNote: String(r.manualPathNote || '').trim(),
                blob: r.blob instanceof Blob ? r.blob : null,
                blobSaved: !!(r.blob instanceof Blob) || !!r.blobSaved,
                blobSavedAt: Number(r.blobSavedAt) || 0,
              };

              const putReq = store.put(row);

              putReq.onerror = () => {
                console.error('[ChatGPT toolbox] import queue row put failed', {
                  id: row.id,
                  name: row.name,
                  error: putReq.error,
                });
              };
            });
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB queue import transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB queue import transaction aborted'));
        });

        state.queue = [];

        await loadQueueForActiveGroup();
        await refreshUploadGroupCounts();

        saveCurrentToolboxBaseState('import-groups-and-queue');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][import:ok] groups=${state.groups.length} queue=${incomingQueue.length} activeGroupId=${state.activeGroupId || '-'}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.groups = prevGroups;
        state.activeGroupId = prevActiveGroupId;
        state.activeId = prevActiveId;
        state.queue = prevQueue;

        render();
        syncGroupManagePanel({
          force: true,
        });

        console.error('[ChatGPT toolbox] importGroupsAndQueueMeta failed', e);

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][import:failed-rollback] type=${errName} error=${errText}`,
        );

        setStatus(`导入上传分组失败，已恢复原状态：${errText}`, 'error');

        throw e;
      }
    }

    function renderGroups() {
      if (!groupListEl) return;

      if (!state.groups.length) {
        groupListEl.innerHTML = '';
        return;
      }

      groupListEl.innerHTML = state.groups.map((g) => renderUploadGroupChipHtml(g, state.activeGroupId)).join('');
    }

    function setStatus(text, type) {
      ToolboxShell.setStatus(text, type);
    }

    function updateItem(id, patch) {
      const q = state.queue.find((x) => x.id === id);
      if (!q) return;

      if (
        q.state === UploadState.CANCELLED &&
        state.cancelled &&
        patch.state &&
        patch.state !== UploadState.CANCELLED
      ) {
        return;
      }

      Object.assign(q, patch);

      if (patch.state === UploadState.ATTACHED) {
        q.attachedInSession = true;

        if (Object.prototype.hasOwnProperty.call(patch, 'persistedAttached')) {
          q.persistedAttached = !!patch.persistedAttached;
        } else {
          q.persistedAttached = true;
        }
      }

      if (
        patch.state &&
        UploadStateUtils &&
        typeof UploadStateUtils.isFinal === 'function' &&
        UploadStateUtils.isFinal(patch.state)
      ) {
        window.setTimeout(() => {
          const healed = healStaleUploadRunningLockIfNeeded(`updateItem-final-state:${patch.state}`);

          if (healed) {
            render();
            persistQueueInBackground(`updateItem-final-state:${patch.state}`);
          }
        }, 300);
      }

      if (state.running) {
        scheduleRenderUpload('updateItem');
        persistQueueThrottled('updateItem');
      } else {
        render();
        persistQueueInBackground('updateItem');
      }
    }

    function isUploadCancelled(runId, signal) {
      return state.cancelled ||
        runId !== state.runId ||
        (signal && signal.aborted);
    }

    async function waitUntilComposerUploadIdle(options = {}) {
      const timeoutMs = Number(options.timeoutMs) || 30000;
      const runId = options.runId;
      const signal = options.signal;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (isUploadCancelled(runId, signal)) {
          return false;
        }

        if (!ComposerApi.isAttachmentStillUploading()) {
          await sleep(800);

          if (!ComposerApi.isAttachmentStillUploading()) {
            return true;
          }
        }

        await sleep(500);
      }

      ToolboxShell.appendLog('[UPLOAD_DIAG][wait-upload-idle-timeout] 附件空闲检测超时，但文件状态已写入，继续结束上传流程');
      return false;
    }

    function areAllUploadTargetsSettled(targets) {
      return UploadStateUtils.allSettled(targets);
    }

    function countUploadResult(targets) {
      const stats = UploadStateUtils.count(targets);
      return {
        success: stats.success,
        failed: stats.failed,
      };
    }

    function resolveUploadTargets(targets) {
      return (targets || [])
        .map((old) => state.queue.find((item) => item && old && item.id === old.id))
        .filter(Boolean);
    }

    function isCompactUploadView() {
      const panelEl = document.getElementById(APP.panelId);
      return !!(panelEl && panelEl.classList.contains('cgpt-toolbox-compact'));
    }

    function getCompactUiConfig() {
      if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.getConfig === 'function') {
        return SettingsModule.getConfig();
      }

      const saved = MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {};
      return normalizeCompactUiConfig(saved);
    }

    function getQuickPromptActiveCategory() {
      return String(quickPromptActiveCategory || '全部').trim() || '全部';
    }

    function saveQuickPromptActiveCategory(category, options = {}) {
      const nextCategory = String(category || '全部').trim() || '全部';
      quickPromptActiveCategory = nextCategory;

      const cfg = getCompactUiConfig();
      const next = Object.assign({}, cfg, {
        quickPromptActiveCategory: nextCategory,
      });

      if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.saveConfig === 'function') {
        SettingsModule.saveConfig(next);
      } else {
        MemoryManager.set(
          MemoryManager.KEYS.compactUiConfig,
          normalizeCompactUiConfig(next),
        );
      }

      if (options.savePageState !== false) {
        saveCurrentToolboxBaseState(options.reason || 'quick-category-change');
      }
    }

    function getPromptCategoryName(prompt) {
      if (typeof PromptManagerModule !== 'undefined'
        && typeof PromptManagerModule.getPromptCategoryName === 'function') {
        return PromptManagerModule.getPromptCategoryName(prompt);
      }

      const text = String(prompt && prompt.category ? prompt.category : '').trim();
      return text || '默认';
    }

    function getQuickPromptGroups(promptList) {
      if (typeof PromptManagerModule !== 'undefined'
        && typeof PromptManagerModule.getPromptCategoriesFromList === 'function') {
        return PromptManagerModule.getPromptCategoriesFromList(promptList);
      }

      const names = [];

      (promptList || []).forEach((p) => {
        const name = getPromptCategoryName(p);
        if (!names.includes(name)) {
          names.push(name);
        }
      });

      return ['全部', ...names];
    }

    function applyCompactUiVisibility() {
      if (!rootElRef) return;

      const cfg = getCompactUiConfig();
      const isCompact = isCompactUploadView();

      rootElRef.classList.toggle('compact-hide-upload-groups', isCompact && !cfg.showUploadGroups);
      rootElRef.classList.toggle('compact-hide-upload-start', isCompact && !cfg.showUploadStartButton);
      rootElRef.classList.toggle('compact-hide-file-list', isCompact && !cfg.showUploadFileList);
      const shouldShowQuick = isCompact
        ? cfg.showCompactQuickPrompts !== false
        : cfg.showUploadQuickPrompts !== false;

      rootElRef.classList.toggle('compact-hide-quick-prompts', !shouldShowQuick);
    }

    async function sendOrFillQuickPrompt(prompt) {
      const cfg = getCompactUiConfig();
      const text = String(prompt && prompt.content ? prompt.content : '').trim();
      const title = String(prompt && prompt.title ? prompt.title : '未命名').trim() || '未命名';
      const action = cfg.quickPromptClickAction === 'fill' ? 'fill' : 'send';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][quick-prompt:click] title=${title} action=${action} waiting=${isWaitingSendActive() ? '1' : '0'}`
      );

      if (!text) {
        setStatus(`Prompt 内容为空：${title}`, 'warn');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:empty] title=${title}`);
        return;
      }

      const existingText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';

      if (existingText && existingText !== text && cfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(
          `ChatGPT 输入框已有 ${existingText.length} 个字符，是否覆盖为快捷 Prompt：${title}？`,
        );

        if (!okReplace) {
          setStatus('已取消：未覆盖输入框草稿', 'warn');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][quick-prompt:block-draft-overwrite] title=${title} existingChars=${existingText.length} newChars=${text.length}`,
          );
          return;
        }
      } else if (existingText && existingText !== text) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][quick-prompt:auto-overwrite-draft] title=${title} existingChars=${existingText.length} newChars=${text.length}`,
        );
      }

      const ok = ComposerApi.setComposerValue(text);

      if (!ok) {
        console.warn('[ChatGPT toolbox] quick prompt: composer not found', prompt);
        setStatus('未找到 ChatGPT 输入框，无法填入 Prompt', 'error');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:composer-not-found] title=${title}`);
        return;
      }

      const composerText = typeof ComposerApi.getComposerText === 'function'
        ? ComposerApi.getComposerText()
        : '';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][quick-prompt:filled] title=${title} chars=${text.length} composerChars=${composerText.length}`,
      );

      if (action === 'fill') {
        setStatus(`已填入 Prompt：${title}`, 'success');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:fill] ${title}`);
        return;
      }

      try {
        const sendResult = await sendContentViaComposer({
          source: 'quick-prompt',
          content: text,
          allowReplaceDraft: true,
          waitUntilSendable: true,
          timeoutMs: SEND_WAIT_TIMEOUT_MS,
          blockWhenResponding: false,
        });

        if (sendResult.ok) {
          setStatus(`已发送 Prompt：${title}`, 'success');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][quick-prompt:send-confirmed] title=${title} reason=${sendResult.reason || '-'}`,
          );
          return;
        }

        setStatus(`快捷 Prompt 发送失败：${sendResult.reason || 'unknown'}`, 'warn');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][quick-prompt:send-failed] title=${title} reason=${sendResult.reason || '-'}`,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] quick prompt send failed', err);
        setStatus(`快捷 Prompt 发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:send-failed] title=${title} error=${errText}`);
      }
    }

    async function waitAssistantStableForCopyContinue(source = 'copy-continue') {
      ToolboxShell.appendLog(
        `[UPLOAD_COPY_CONTINUE][wait-start] source=${String(source || '-')}`,
      );

      setStatus('正在等待当前回复完成...', 'danger', {
        persist: true,
        shortText: '等回复',
      });

      if (
        typeof ChatMessageExtractor === 'undefined'
        || typeof ChatMessageExtractor.waitLatestAssistantStable !== 'function'
      ) {
        ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][wait-failed] reason=waitLatestAssistantStable-missing');
        return {
          ok: false,
          reason: 'waitLatestAssistantStable-missing',
        };
      }

      const result = await ChatMessageExtractor.waitLatestAssistantStable({
        timeoutMs: COPY_CONTINUE_WAIT_TIMEOUT_MS,
        intervalMs: COPY_CONTINUE_STABLE_INTERVAL_MS,
        stableRounds: COPY_CONTINUE_STABLE_ROUNDS,
        isGenerating: () => {
          return typeof ComposerApi !== 'undefined'
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy();
        },
      });

      if (!result || !result.ok || !String(result.text || '').trim()) {
        const reason = result && result.reason ? result.reason : 'unknown';

        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][wait-failed] reason=${reason}`,
        );

        setStatus(`等待回复完成失败：${reason}`, 'warn');

        return {
          ok: false,
          reason,
          result,
        };
      }

      ToolboxShell.appendLog(
        `[UPLOAD_COPY_CONTINUE][wait-ok] chars=${String(result.text || '').length} reason=${result.reason || '-'}`,
      );

      return {
        ok: true,
        text: String(result.text || '').trim(),
        record: result.record || null,
        result,
      };
    }

    async function sendContinueMessageOnly(source = 'button') {
      const text = '继续';

      ToolboxShell.appendLog(
        `[UPLOAD_CONTINUE][send-start] source=${String(source || '-')}`,
      );

      if (isWaitingSendActive()) {
        cancelWaitingSend('copy-continue');
      }

      if (typeof sendContentViaComposer === 'function') {
        try {
          const result = await sendContentViaComposer({
            source,
            content: text,
            allowReplaceDraft: true,
            waitUntilSendable: true,
            blockWhenResponding: false,
            timeoutMs: typeof SEND_WAIT_TIMEOUT_MS === 'number' ? SEND_WAIT_TIMEOUT_MS : 60000,
          });

          if (!result || !result.ok) {
            const reason = result && result.reason ? result.reason : 'unknown';
            setStatus(`发送继续失败：${reason}`, 'warn');
            ToolboxShell.appendLog(`[UPLOAD_CONTINUE][send-failed] reason=${reason}`);
            return false;
          }

          setStatus('已发送：继续', 'success');
          ToolboxShell.appendLog(
            `[UPLOAD_CONTINUE][sent] text=继续 reason=${result.reason || '-'}`,
          );
          return true;
        } catch (err) {
          const errText = formatToolboxError(err);
          console.error('[ChatGPT toolbox] send continue message failed', err);
          setStatus(`发送继续失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_CONTINUE][send-failed] error=${errText}`);
          return false;
        }
      }

      const existingText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';

      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      if (existingText && existingText !== text && cfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(
          `ChatGPT 输入框已有 ${existingText.length} 个字符，是否覆盖并发送“继续”？`,
        );

        if (!okReplace) {
          setStatus('已取消发送继续：未覆盖输入框草稿', 'warn');
          ToolboxShell.appendLog(
            `[UPLOAD_CONTINUE][send-cancel] reason=user-refused-overwrite existingChars=${existingText.length}`,
          );
          return false;
        }
      } else if (existingText && existingText !== text) {
        ToolboxShell.appendLog(
          `[UPLOAD_CONTINUE][auto-overwrite-draft] existingChars=${existingText.length} newChars=${text.length}`,
        );
      }

      try {
        const okSet = typeof ComposerApi.setComposerValue === 'function'
          && ComposerApi.setComposerValue(text);

        if (!okSet) {
          setStatus('发送继续失败：未找到输入框', 'warn');
          ToolboxShell.appendLog('[UPLOAD_CONTINUE][send-failed] reason=composer-not-found');
          return false;
        }

        await sleep(300);

        const sendWaitStartedAt = Date.now();
        while (typeof ComposerApi.canSendNow === 'function' && !ComposerApi.canSendNow()) {
          if (Date.now() - sendWaitStartedAt >= 60000) {
            setStatus('发送继续失败：发送按钮等待超时', 'warn');
            ToolboxShell.appendLog('[UPLOAD_CONTINUE][send-failed] reason=send-button-wait-timeout');
            return false;
          }
          await sleep(250);
        }

        if (typeof ComposerApi.clickSend !== 'function') {
          setStatus('发送继续失败：发送 API 不可用', 'warn');
          ToolboxShell.appendLog('[UPLOAD_CONTINUE][send-failed] reason=send-api-missing');
          return false;
        }

        const clicked = ComposerApi.clickSend();
        if (!clicked) {
          setStatus('发送继续失败：点击发送失败', 'warn');
          ToolboxShell.appendLog('[UPLOAD_CONTINUE][send-failed] reason=click-send-failed');
          return false;
        }

        setStatus('已发送：继续', 'success');
        ToolboxShell.appendLog('[UPLOAD_CONTINUE][sent] text=继续');
        return true;
      } catch (err) {
        const errText = formatToolboxError(err);
        console.error('[ChatGPT toolbox] send continue message failed', err);
        setStatus(`发送继续失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[UPLOAD_CONTINUE][send-failed] error=${errText}`);
        return false;
      }
    }

    async function copyLastMessageAndContinue(source = 'button') {
      const btn = rootElRef ? qs(UploadSelectors.copyContinueBtn, rootElRef) : null;

      if (copyContinueTaskRunning) {
        const runningMs = Date.now() - Number(copyContinueTaskStartedAt || 0);

        if (runningMs <= 90000) {
          ToolboxShell.appendLog(
            `[UPLOAD_COPY_CONTINUE][skip] reason=task-running runningMs=${runningMs}`,
          );
          return false;
        }

        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][stale-release] runningMs=${runningMs}`,
        );
        copyContinueTaskRunning = false;
        copyContinueTaskStartedAt = 0;
      }

      if (btn) {
        const busyState = clearStaleUploadButtonBusy(btn, {
          action: 'copy-continue',
          source: String(source || '-'),
          logTag: 'UPLOAD_COPY_CONTINUE',
        });
        if (busyState.skipped) {
          ToolboxShell.appendLog(
            `[UPLOAD_COPY_CONTINUE][skip] reason=button-busy busyMs=${busyState.busyMs}`,
          );
          return false;
        }
      }

      copyContinueTaskRunning = true;
      copyContinueTaskStartedAt = Date.now();
      copyTaskStatus = 'waiting_assistant';

      void unlockToolboxAudio('copy-continue-start');

      if (btn && btn.dataset.busy === '1') {
        ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][skip] reason=button-busy-after-claim');
        copyContinueTaskRunning = false;
        copyContinueTaskStartedAt = 0;
        copyTaskStatus = 'idle';
        return false;
      }

      const assistantBusy = typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      setCopyContinueButtonBusy(btn, true, {
        startedAt: copyContinueTaskStartedAt,
        assistantBusy,
      });

      ToolboxShell.appendLog(
        `[UPLOAD_COPY_CONTINUE][start] source=${String(source || '-')} assistantBusy=${assistantBusy ? '1' : '0'}`,
      );

      try {
        const waitResult = await waitAssistantStableForCopyContinue(source);

        if (!waitResult.ok) {
          ToolboxShell.appendLog(
            `[UPLOAD_COPY_CONTINUE][abort] reason=wait-assistant-failed detail=${waitResult.reason || '-'}`,
          );
          return false;
        }

        copyTaskStatus = 'copying';
        if (btn) {
          btn.dataset.waitingReply = '0';
          btn.textContent = '复制中...';
          btn.disabled = true;
        }

        if (typeof copyTextToClipboard !== 'function') {
          setStatus('复制最后回复失败：剪贴板 API 不可用', 'error');
          ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][abort] reason=copyTextToClipboard-missing');
          return false;
        }

        await copyTextToClipboard(waitResult.text);
        copyTaskStatus = 'copied';

        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][copied] chars=${String(waitResult.text || '').length}`,
        );

        void playCopySuccessBeepSafe(source || '-', 'copyContinue');

        copyTaskStatus = 'sending_continue';
        if (btn) {
          btn.textContent = '发送继续...';
          btn.disabled = true;
        }

        const sent = await sendContinueMessageOnly('copy-continue-after-wait');

        if (!sent) {
          ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][failed] reason=continue-send-failed');
          return false;
        }

        copyTaskStatus = 'done';
        setStatus('已复制最后回复，并发送：继续', 'success');
        ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][done] copied=1 sent=1');

        return true;
      } catch (error) {
        copyTaskStatus = 'failed';
        const errText = formatToolboxError(error);
        console.error('[ChatGPT toolbox] copyLastMessageAndContinue failed', error);
        ToolboxShell.appendLog(`[UPLOAD_COPY_CONTINUE][failed] error=${errText}`);
        setStatus(`复制并继续失败：${errText}`, 'error');
        return false;
      } finally {
        copyContinueTaskRunning = false;
        copyContinueTaskStartedAt = 0;
        if (copyTaskStatus !== 'done' && copyTaskStatus !== 'failed') {
          copyTaskStatus = 'idle';
        }

        setCopyContinueButtonBusy(btn, false);

        renderUploadButtonsOnly();
      }
    }

    function buildUploadListHtml() {
      const files = getActiveGroupFiles();
      const selectedFileId = getSelectedFileIdForActiveGroup();
      const activeGroupId = getActiveGroupId();

      if (!files.length) {
        return `
          <div class="cgpt-upload-item empty">
            <div>
              <div class="cgpt-upload-meta">当前项目没有文件</div>
            </div>
          </div>
        `;
      }

      return files.map((q) => {
        const activeClass = selectedFileId === q.id ? 'active' : '';
        const cachedClass = isCachedUploadSnapshot(q) ? 'cached-snapshot' : '';
        const sourceText = getUploadInlineStatusText(q);
        const itemTitle = escapeHtml(buildUploadItemTitle(q));

        const rebindButtonHtml = shouldShowRebindButton(q)
          ? `
            <button type="button"
              class="cgpt-upload-file-rebind"
              data-upload-rebind-id="${escapeHtml(q.id)}"
              title="重新选择本地文件">
              重新绑定
            </button>
          `
          : '';

        return `
            <div class="cgpt-upload-item ${activeClass} ${cachedClass}" data-id="${q.id}" data-group-id="${escapeHtml(activeGroupId)}" data-file-id="${escapeHtml(q.id)}" title="${itemTitle}">
              <div class="cgpt-upload-file-main">
                <div class="cgpt-upload-name">${escapeHtml(q.name || 'unknown')}</div>
                <div class="cgpt-upload-meta">
                  ${escapeHtml(formatBytes(q.size))}
                  <span class="cgpt-upload-dot">·</span>
                  <span class="cgpt-upload-source-label ${isCachedUploadSnapshot(q) ? 'cached-source' : ''}">
                    ${escapeHtml(sourceText)}
                  </span>
                  ${rebindButtonHtml}
                </div>
              </div>
              <div class="cgpt-upload-actions-cell">
                <button type="button"
                  class="cgpt-upload-file-remove"
                  data-upload-remove-id="${escapeHtml(q.id)}"
                  title="移除">
                  ×
                </button>
              </div>
            </div>
          `;
      }).join('');
    }

    function scheduleRenderUpload(reason = '') {
      const reasonText = String(reason || '').trim();

      if (reasonText && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[UPLOAD_RENDER][schedule] reason=${reasonText}`);
      }

      if (uploadTimers.has('upload-render', 'raf')) {
        return;
      }

      uploadTimers.raf('upload-render', () => {
        renderUploadListOnly();
        renderUploadButtonsOnly();
      });
    }

    function renderUploadListOnly() {
      const el = listEl || (rootElRef ? qs(UploadSelectors.list, rootElRef) : null);
      if (!el) return;

      listEl = el;
      refreshQueueReadableState();
      el.innerHTML = buildUploadListHtml();
    }

    function getUploadPageCapability() {
      let hasComposer = false;
      let canSendNow = false;
      let isResponding = false;

      try {
        hasComposer = typeof ComposerApi.hasComposer === 'function' && ComposerApi.hasComposer();
        canSendNow = typeof ComposerApi.canSendNow === 'function' && ComposerApi.canSendNow();
        isResponding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getUploadPageCapability failed', err);
        ToolboxShell.appendLog(`[UPLOAD][capability-check-failed] error=${errText}`);
      }

      const latestAssistant = getLatestAssistantMessageForCopy();

      return {
        hasComposer,
        canSendNow,
        isResponding,
        sendable: hasComposer && canSendNow && !isResponding,
        copyable: !!(latestAssistant && latestAssistant.ok),
      };
    }

    function renderUploadButtonsOnly() {
      healStaleUploadRunningLockIfNeeded('renderUploadButtonsOnly');

      const capability = getUploadPageCapability();

      const currentStartBtn = rootElRef
        ? qs(UploadSelectors.startBtn, rootElRef)
        : startBtn;

      if (currentStartBtn) {
        startBtn = currentStartBtn;
      }

      const uiRunning = isUploadRunActuallyActive();

      const activeFiles = getActiveGroupFiles();

      setButtonState(currentStartBtn, {
        text: uiRunning ? '正在上传' : '开始上传',
        disabled: uiRunning || activeFiles.length <= 0,
        removeClasses: ['primary', 'danger'],
        addClasses: ['success'],
      });

      const startSendBtn = rootElRef ? qs(UploadSelectors.startSendBtn, rootElRef) : null;
      if (startSendBtn) {
        const waitingSend = isWaitingSendActive();
        let sendTitle = '';

        if (waitingSend) {
          sendTitle = '再次点击可取消等待发送';
        } else if (!capability.hasComposer) {
          sendTitle = '未找到 ChatGPT 输入框';
        } else if (capability.isResponding) {
          sendTitle = '助手正在回复，暂不可发送';
        } else if (!capability.sendable) {
          sendTitle = '当前页面暂不可发送';
        }

        setButtonState(startSendBtn, {
          text: waitingSend ? '取消等待' : '发送信息',
          title: sendTitle,
          disabled: !waitingSend && !capability.hasComposer,
          ariaDisabled: !waitingSend && !capability.hasComposer,
          removeClasses: ['primary', 'danger', 'cgpt-wait-send-cancel'],
          addClasses: waitingSend ? ['danger', 'cgpt-wait-send-cancel'] : ['primary'],
        });
      }

      const copyContinueBtn = rootElRef ? qs(UploadSelectors.copyContinueBtn, rootElRef) : null;

      if (copyContinueBtn) {
        const busy = typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
        const actionBusy = copyContinueBtn.dataset.busy === '1';
        const waitingReply = copyContinueBtn.dataset.waitingReply === '1';
        const continueBtnText = actionBusy
          ? (waitingReply ? '等待回复...' : '继续中...')
          : '复制并继续';
        const waitingAnswer = isWaitingAnswerVisualState({
          text: continueBtnText,
          isResponding: busy,
        }) || waitingReply;

        setButtonState(copyContinueBtn, {
          text: continueBtnText,
          title: busy
            ? '当前正在回复：点击后会等待回复完成，再复制并继续'
            : '先复制最后回复，再发送“继续”',
          disabled: false,
          ariaDisabled: actionBusy,
          removeClasses: [
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'cgpt-waiting-answer',
          ],
          addClasses: waitingAnswer
            ? ['danger', 'cgpt-waiting-answer', 'copy-continue']
            : ['primary', 'copy-continue'],
        });
        copyContinueBtn.dataset.assistantBusy = busy ? '1' : '0';
      }

      const copyLastMessageBtn = rootElRef ? qs(UploadSelectors.copyLastMessageBtn, rootElRef) : null;
      if (copyLastMessageBtn) {
        let copyBtnText = '复制最后回复';
        if (copyLastMessageWaiting) {
          copyBtnText = '等待回答';
        } else if (copyLastMessageTaskRunning) {
          copyBtnText = '复制中';
        }

        const waitingAnswer = isWaitingAnswerVisualState({
          text: copyBtnText,
          copyLastMessageWaiting,
          isResponding: capability.isResponding,
        });

        setButtonState(copyLastMessageBtn, {
          text: copyBtnText,
          disabled: copyLastMessageWaiting || copyLastMessageTaskRunning,
          removeClasses: [
            'primary',
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'cgpt-waiting-answer',
          ],
          addClasses: waitingAnswer
            ? ['danger', 'cgpt-waiting-answer']
            : ['primary'],
        });
      }

      applyUploadShortcutButtonTitles(rootElRef);
    }

    function buildQuickPromptRenderSignature() {
      const cfg = getCompactUiConfig();
      const promptsVersion = JSON.stringify(
        PromptManagerModule && typeof PromptManagerModule.getPrompts === 'function'
          ? PromptManagerModule.getPrompts().map((p) => p.id)
          : [],
      );

      return JSON.stringify({
        isCompact: isCompactUploadView(),
        showUploadQuickPrompts: cfg.showUploadQuickPrompts !== false,
        showCompactQuickPrompts: cfg.showCompactQuickPrompts !== false,
        quickPromptIds: cfg.quickPromptIds || [],
        quickPromptActiveCategory: getQuickPromptActiveCategory(),
        promptsVersion,
      });
    }

    function renderUploadQuickPrompts() {
      const signature = buildQuickPromptRenderSignature();

      if (signature === quickPromptRenderSignature) {
        return;
      }

      quickPromptRenderSignature = signature;

      const box = rootElRef ? qs('#cgpt-upload-quick-prompts', rootElRef) : null;
      if (!box) return;

      const cfg = getCompactUiConfig();
      const isCompact = isCompactUploadView();

      const shouldShow = isCompact
        ? cfg.showCompactQuickPrompts !== false
        : cfg.showUploadQuickPrompts !== false;

      const groupsEl = qs('#cgpt-upload-quick-prompt-groups', box);
      const promptsListEl = qs('#cgpt-upload-quick-prompts-list', box);

      if (!shouldShow) {
        box.classList.add('cgpt-toolbox-hidden');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][quick-prompt:hidden-by-config] isCompact=${isCompact}`,
        );
        return;
      }

      box.classList.remove('cgpt-toolbox-hidden');

      const ids = new Set(cfg.quickPromptIds || []);
      const prompts = typeof PromptManagerModule !== 'undefined' && typeof PromptManagerModule.getPrompts === 'function'
        ? PromptManagerModule.getPrompts()
        : [];

      if (!prompts.length) {
        if (groupsEl) groupsEl.innerHTML = '';
        if (promptsListEl) {
          promptsListEl.innerHTML = '<div class="cgpt-upload-meta">暂无 Prompt，请先到 Prompt 管理中添加。</div>';
        }
        ToolboxShell.appendLog('[UPLOAD_DIAG][quick-prompt:empty-prompts]');
        return;
      }

      const selected = prompts.filter((p) => ids.has(p.id));

      if (!selected.length) {
        if (groupsEl) groupsEl.innerHTML = '';
        if (promptsListEl) {
          promptsListEl.innerHTML = '<div class="cgpt-upload-meta">未选择常用 Prompt，请到设置中勾选。</div>';
        }
        ToolboxShell.appendLog('[UPLOAD_DIAG][quick-prompt:empty-selected]');
        return;
      }

      const groups = getQuickPromptGroups(selected);
      let activeCategory = getQuickPromptActiveCategory();

      if (!groups.includes(activeCategory)) {
        activeCategory = '全部';
        saveQuickPromptActiveCategory(activeCategory, {
          reason: 'quick-category-fallback',
        });
      }

      const visiblePrompts = activeCategory === '全部'
        ? selected
        : selected.filter((p) => getPromptCategoryName(p) === activeCategory);

      const groupsHtml = groups.map((name) => {
        const count = getQuickPromptCategoryCount(name, selected);

        return `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-quick-prompt-group${name === activeCategory ? ' active' : ''}"
              data-upload-quick-prompt-category="${escapeHtml(name)}"
              title="${escapeHtml(`${name}：${count} Prompt`)}">
              <span class="cgpt-chip-name">${escapeHtml(name)}</span>
              <span class="cgpt-chip-count">${count}</span>
            </button>
          `;
      }).join('');

      const chipsHtml = visiblePrompts.map((p) => `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-quick-prompt-chip"
              data-upload-quick-prompt-id="${escapeHtml(p.id)}"
              title="${escapeHtml(p.title || '')}">
              ${escapeHtml(p.title || 'Prompt')}
            </button>
          `).join('');

      if (groupsEl && promptsListEl) {
        groupsEl.innerHTML = groupsHtml;
        promptsListEl.innerHTML = chipsHtml;
      } else {
        box.innerHTML = `
        <div class="cgpt-upload-quick-prompts-title">常用 Prompt</div>

        <div class="cgpt-upload-quick-prompt-groups" id="cgpt-upload-quick-prompt-groups">
          ${groupsHtml}
        </div>

        <div class="cgpt-upload-quick-prompts-list" id="cgpt-upload-quick-prompts-list">
          ${chipsHtml}
        </div>
      `;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][quick-prompt:render] isCompact=${isCompact} shouldShow=true selected=${selected.length} total=${prompts.length} category=${activeCategory} visible=${visiblePrompts.length}`,
      );
    }

    function getQuickPromptCategoryCount(category, selectedPrompts) {
      if (category === '全部') {
        return selectedPrompts.length;
      }

      return selectedPrompts.filter((p) => getPromptCategoryName(p) === category).length;
    }

    function render() {
      if (!listEl) return;

      refreshQueueReadableState();
      syncActiveGroupCountInCache();
      renderGroups();

      listEl.innerHTML = buildUploadListHtml();

      renderUploadButtonsOnly();

      if (managePanelEl && !managePanelEl.classList.contains('cgpt-toolbox-hidden')) {
        syncGroupManagePanel();
      }

      applyCompactUiVisibility();
      renderUploadQuickPrompts();
    }

    function hasDraggedFiles(e) {
      const dt = e && e.dataTransfer;
      if (!dt) return false;

      if (Array.from(dt.types || []).includes('Files')) {
        return true;
      }

      return !!(dt.files && dt.files.length);
    }

    async function getHandleFromDataTransferItem(item) {
      if (item && typeof item.getAsFileSystemHandle === 'function') {
        try {
          return await item.getAsFileSystemHandle();
        } catch (e) {
          const errName = e && e.name ? e.name : 'Error';
          const errText = e && e.message ? e.message : String(e);
          console.warn('[ChatGPT toolbox] getAsFileSystemHandle failed', e);
          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][drop:getAsFileSystemHandle-failed] type=${errName} kind=${item && item.kind ? item.kind : '-'} typeText=${item && item.type ? item.type : '-'} error=${errText}`,
            );
          }
          return null;
        }
      }

      return null;
    }

    async function collectDroppedFilesWithHandles(dataTransfer) {
      const result = [];
      const seen = new Map();

      function buildDroppedFileKey(file) {
        if (!file) return '';

        const name = String(file.name || '').trim().toLowerCase();
        const size = Number(file.size) || 0;
        const lastModified = Number(file.lastModified) || 0;
        const type = String(file.type || '').trim().toLowerCase();
        const path = String(file.webkitRelativePath || '').trim().toLowerCase();

        if (!name && !size && !lastModified && !path) {
          return '';
        }

        return `${name}::${size}::${lastModified}::${type}::${path}`;
      }

      function pushDroppedFile(file, handle, source) {
        const normalized = normalizeToNativeFile(
          file,
          file && file.name ? file.name : 'unknown',
        );

        if (!normalized) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][drop:skip-invalid] source=${source || '-'} name=${file && file.name ? file.name : '-'}`
          );
          return;
        }

        const key = buildDroppedFileKey(normalized);
        const nextHasHandle = isFileHandleLike(handle);

        if (key && seen.has(key)) {
          const existing = seen.get(key);

          if (existing && !existing.handle && nextHasHandle) {
            existing.file = normalized;
            existing.handle = handle;
            existing.source = source || '';

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][drop:dedupe-prefer-handle] source=${source || '-'} name=${normalized.name || '-'} size=${normalized.size || 0}`
            );
            return;
          }

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][drop:skip-duplicate] source=${source || '-'} key=${key || '-'} name=${normalized.name || '-'} size=${normalized.size || 0}`
          );
          return;
        }

        const entry = {
          file: normalized,
          handle: nextHasHandle ? handle : null,
          source: source || '',
        };

        result.push(entry);

        if (key) {
          seen.set(key, entry);
        }
      }

      const items = Array.from(dataTransfer && dataTransfer.items ? dataTransfer.items : []);
      const files = Array.from(dataTransfer && dataTransfer.files ? dataTransfer.files : []);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:collect-start] items=${items.length} files=${files.length} types=${Array.from(dataTransfer && dataTransfer.types ? dataTransfer.types : []).join('|')}`
      );

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];

        if (!item || item.kind !== 'file') {
          continue;
        }

        let file = null;
        let handle = null;

        try {
          handle = await getHandleFromDataTransferItem(item);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] get handle from dropped item failed', err);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][drop:item-handle-failed] index=${index} error=${errText}`
          );
          handle = null;
        }

        if (handle && typeof handle.getFile === 'function') {
          try {
            file = await handle.getFile();
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] dropped handle.getFile failed', err);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][drop:item-getFile-failed] index=${index} error=${errText}`
            );
            file = null;
          }
        }

        if (!file && typeof item.getAsFile === 'function') {
          try {
            file = item.getAsFile();
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] dropped item.getAsFile failed', err);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][drop:item-getAsFile-failed] index=${index} error=${errText}`
            );
            file = null;
          }
        }

        if (file) {
          pushDroppedFile(file, handle, 'items');
        }
      }

      files.forEach((rawFile, index) => {
        if (!rawFile) return;
        pushDroppedFile(rawFile, null, `files:${index}`);
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:collect-done] items=${items.length} files=${files.length} collected=${result.length}`
      );

      return result;
    }

    async function addDroppedFiles(dropped) {
      const safeDropped = Array.isArray(dropped) ? dropped.filter((x) => x && x.file) : [];

      if (!safeDropped.length) {
        setStatus('没有检测到可添加的文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:addFiles-skip] reason=empty-dropped');
        return;
      }

      const files = safeDropped.map((x) => x.file);
      const handles = safeDropped.map((x) => x.handle || null);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:addFiles-before] count=${files.length} names=${files.map((f) => f.name || '-').join('|')}`
      );

      await addFiles(files, {
        handles,
        sourceKind: 'drop',
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:addFiles-after] count=${files.length} queue=${state.queue.length}`
      );
    }

    async function handleUploadDropEvent(e) {
      e.preventDefault();
      e.stopPropagation();

      const transfer = e.dataTransfer;

      if (!transfer) {
        setStatus('拖拽失败：没有文件数据');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer');
        return;
      }

      if (!state.activeGroupId) {
        await ensureDefaultGroupReady();
      }

      if (!state.activeGroupId) {
        setStatus('拖拽失败：没有可用文件组');
        console.warn('[ChatGPT toolbox] drop failed: activeGroupId empty');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:failed] reason=empty-activeGroupId');
        return;
      }

      const dropped = await collectDroppedFilesWithHandles(transfer);

      if (!dropped.length) {
        setStatus('没有检测到可添加的文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:empty]');
        return;
      }

      const beforeCount = state.queue.length;

      await addDroppedFiles(dropped);

      const afterCount = state.queue.length;
      const addedCount = Math.max(0, afterCount - beforeCount);

      setStatus(`已拖入：${dropped.length} 个文件，新增：${addedCount} 个`);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:done] dropped=${dropped.length} added=${addedCount} before=${beforeCount} after=${afterCount}`
      );
    }

    function prepareUploadDragEvent(e, options = {}) {
      if (!hasDraggedFiles(e)) {
        return false;
      }

      if (shouldLetNativeChatGptHandleDrop(e)) {
        return false;
      }

      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = options.dropEffect || 'copy';
      }

      return true;
    }

    function onUploadRootDragOver(e) {
      if (!prepareUploadDragEvent(e)) return;

      if (rootElRef) {
        rootElRef.classList.add('cgpt-upload-dragging');
      }
    }

    function onUploadRootDragLeave() {
      if (rootElRef) {
        rootElRef.classList.remove('cgpt-upload-dragging');
      }
    }

    async function onUploadRootDrop(e) {
      if (!prepareUploadDragEvent(e)) return;

      if (rootElRef) {
        rootElRef.classList.remove('cgpt-upload-dragging');
      }

      await handleUploadDropEvent(e);
    }

    function onGlobalUploadDragOver(e) {
      if (!prepareUploadDragEvent(e)) return;

      if (panelDropEl) {
        panelDropEl.classList.add('cgpt-toolbox-file-dragover');
      }
    }

    function onGlobalUploadDragLeave(e) {
      const related = e.relatedTarget instanceof Node ? e.relatedTarget : null;

      if (related && document.contains(related)) {
        return;
      }

      if (panelDropEl) {
        panelDropEl.classList.remove('cgpt-toolbox-file-dragover');
      }
    }

    async function onGlobalUploadDrop(e) {
      if (!prepareUploadDragEvent(e)) return;

      if (panelDropEl) {
        panelDropEl.classList.remove('cgpt-toolbox-file-dragover');
      }

      await handleUploadDropEvent(e);
    }

    function bindGlobalDropTarget(target, name) {
      if (!target) {
        console.warn('[ChatGPT toolbox] bindGlobalDropTarget: target 为空', name);
        return;
      }

      if (uploadDropBoundTargets.has(target)) {
        return;
      }

      uploadDropBoundTargets.add(target);

      if (target.dataset) {
        target.dataset.cgptUploadDropBound = '1';
      }

      target.addEventListener('dragover', onGlobalUploadDragOver, true);
      target.addEventListener('dragleave', onGlobalUploadDragLeave, true);
      target.addEventListener('drop', onGlobalUploadDrop, true);
    }

    function unbindGlobalDropTarget(target) {
      if (!target || !uploadDropBoundTargets.has(target)) {
        return;
      }

      target.removeEventListener('dragover', onGlobalUploadDragOver, true);
      target.removeEventListener('dragleave', onGlobalUploadDragLeave, true);
      target.removeEventListener('drop', onGlobalUploadDrop, true);

      uploadDropBoundTargets.delete(target);

      if (target.dataset) {
        delete target.dataset.cgptUploadDropBound;
      }
    }

    function syncGlobalDocumentDropBinding() {
      const cfg = getCompactUiConfig();

      if (cfg.globalDropCaptureEnabled) {
        bindGlobalDropTarget(document, 'document');
        return;
      }

      unbindGlobalDropTarget(document);
    }

    function bindUploadRootDropHandlers(rootEl) {
      if (!rootEl || uploadDropBoundTargets.has(rootEl)) {
        return;
      }

      uploadDropBoundTargets.add(rootEl);

      rootEl.addEventListener('dragover', onUploadRootDragOver, true);
      rootEl.addEventListener('dragleave', onUploadRootDragLeave, true);
      rootEl.addEventListener('drop', onUploadRootDrop, true);
    }

    function bindUploadDropTargets(rootEl) {
      bindUploadRootDropHandlers(rootEl);
      syncGlobalDocumentDropBinding();
    }

    async function ensureDefaultGroupReady() {
      if (state.activeGroupId) return;

      if (!state.groups.length) {
        const defaultGroup = createDefaultGroup();

        state.groups = [defaultGroup];
        state.activeGroupId = defaultGroup.id;

        await persistGroups();
        await schedulePersistQueue();

        saveCurrentToolboxBaseState('ensure-default-upload-group');

        renderGroups();
        render();
        return;
      }

      const preferred = resolvePreferredUploadGroupId(getToolboxPageState(), 'ensure-default-upload-group');

      state.activeGroupId = preferred.groupId || state.groups[0].id;

      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][ensure-default-group] groupId=${state.activeGroupId || '-'} source=${preferred.source || '-'}`,
      );

      saveCurrentToolboxBaseState('ensure-default-upload-group');

      await loadQueueForActiveGroup();

      renderGroups();
      render();
    }

    function buildQueueFileKey(fileOrItem) {
      if (!fileOrItem) return '';

      const name = String(fileOrItem.name || '').trim().toLowerCase();
      const size = Number(fileOrItem.size) || 0;
      const lastModified = Number(fileOrItem.lastModified) || 0;
      const type = String(fileOrItem.type || '').trim().toLowerCase();
      const path = String(
        fileOrItem.webkitRelativePath
        || fileOrItem.displayPath
        || '',
      ).trim().toLowerCase();

      if (!name && !size && !lastModified && !path) {
        return '';
      }

      return `${name}::${size}::${lastModified}::${type}::${path}`;
    }

    async function addFiles(files, options = {}) {
      const cleanFiles = Array.from(files || []).filter(Boolean);
      const handles = Array.isArray(options.handles) ? options.handles : [];

      if (!state.activeGroupId) {
        setStatus('请先选择文件组');
        console.warn('[ChatGPT toolbox] addFiles blocked: activeGroupId empty');
        return;
      }

      const existingKeys = new Set(
        state.queue
          .filter((item) => item.groupId === state.activeGroupId)
          .map((item) => buildQueueFileKey(item))
          .filter(Boolean)
      );

      let addedCount = 0;

      cleanFiles.forEach((file, index) => {
        const fileKey = buildQueueFileKey(file);

        if (fileKey && existingKeys.has(fileKey)) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][add-file-skip-duplicate] index=${index} name=${file.name || '-'} size=${file.size || 0} fileKey=${fileKey}`
          );
          return;
        }

        const handle = handles[index] || null;
        const hasHandle = isFileHandleLike(handle);

        const item = {
          id: newId(),
          groupId: state.activeGroupId,
          name: file.name || 'unknown',
          size: file.size || 0,
          type: file.type || 'application/octet-stream',
          lastModified: file.lastModified || Date.now(),
          file,
          blob: file,
          fileHandle: hasHandle ? handle : null,
          sourceKind: hasHandle ? 'local-handle' : 'session-file',
          readMode: hasHandle ? 'handle' : 'snapshot',
          state: UploadState.IDLE,
          message: '',
          uploadName: '',
          persistedAttached: false,
        };

        state.queue.push(item);

        if (fileKey) {
          existingKeys.add(fileKey);
        }

        addedCount += 1;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][add-file] index=${index} name=${item.name || '-'} size=${item.size || 0} handle=${hasHandle ? 1 : 0} sourceKind=${item.sourceKind} readMode=${item.readMode}`,
        );
      });

      await schedulePersistQueue();
      await refreshUploadGroupCounts();

      if (addedCount > 0) {
        const lastAdded = getActiveGroupFiles()[getActiveGroupFiles().length - 1];
        if (lastAdded && lastAdded.id) {
          setSelectedFileIdForActiveGroup(lastAdded.id, { reason: 'add-files' });
        }
      }

      render();

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][addFiles:done] count=${addedCount} queue=${getActiveGroupFiles().length} group=${state.activeGroupId || '-'}`,
      );
    }

    function pickOneLocalFileByInput() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        let finished = false;
        let focusCancelTimer = 0;

        function cleanup() {
          window.removeEventListener('focus', onWindowFocus, true);

          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
            focusCancelTimer = 0;
          }

          if (input && input.parentNode) {
            input.parentNode.removeChild(input);
          }
        }

        function finishOk(file) {
          if (finished) return;
          finished = true;
          cleanup();

          resolve({
            file,
            handle: null,
            source: 'input-file',
          });
        }

        function finishFailed(err) {
          if (finished) return;
          finished = true;
          cleanup();
          reject(err);
        }

        function readSelectedFile() {
          const file = input.files && input.files[0] ? input.files[0] : null;

          if (!file) {
            finishFailed(new Error('用户取消选择文件'));
            return;
          }

          finishOk(file);
        }

        function onWindowFocus() {
          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
          }

          focusCancelTimer = window.setTimeout(() => {
            focusCancelTimer = 0;

            if (finished) return;

            const file = input.files && input.files[0] ? input.files[0] : null;

            if (file) {
              finishOk(file);
              return;
            }

            finishFailed(new Error('用户取消选择文件'));
          }, 1200);
        }

        input.type = 'file';
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.top = '-9999px';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        input.style.zIndex = '-1';

        input.addEventListener('change', () => {
          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
            focusCancelTimer = 0;
          }

          readSelectedFile();
        }, {
          once: true,
        });

        input.addEventListener('cancel', () => {
          finishFailed(new Error('用户取消选择文件'));
        }, {
          once: true,
        });

        document.body.appendChild(input);

        window.setTimeout(() => {
          window.addEventListener('focus', onWindowFocus, true);
        }, 0);

        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1');

        input.click();
      });
    }

    async function pickOneLocalFileWithHandle() {
      const showOpenFilePicker = getShowOpenFilePickerFn();

      if (!showOpenFilePicker) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 supported=0');
        return pickOneLocalFileByInput();
      }

      ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=file-system-access supported=1');

      let handles;

      try {
        handles = await showOpenFilePicker({
          multiple: false,
        });
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.code === 20)) {
          throw new Error('用户取消选择文件');
        }

        console.error('[ChatGPT toolbox] showOpenFilePicker failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][picker:file-system-access-failed] error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }

      const handle = handles && handles[0] ? handles[0] : null;

      if (!handle || typeof handle.getFile !== 'function') {
        const err = new Error('未获取到有效文件句柄');
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: invalid handle', handle);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][picker:invalid-handle] error=${err.message}`);
        throw err;
      }

      let file;

      try {
        file = await handle.getFile();
      } catch (e) {
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: handle.getFile failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][picker:getFile-failed] error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }

      if (!file) {
        const err = new Error('文件句柄读取文件失败');
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: empty file', handle);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][picker:empty-file] error=${err.message}`);
        throw err;
      }

      return {
        file,
        handle,
        source: 'file-system-access',
      };
    }

    async function pickOneLocalFileForRebind() {
      return pickOneLocalFileWithHandle();
    }


    async function rebindUploadFile(id) {
      if (!id) {
        setStatus('重新绑定失败：缺少文件 ID');
        ToolboxShell.appendLog('[UPLOAD_DIAG][rebind-file:skip] reason=empty-id');
        return;
      }

      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('重新绑定失败：未找到队列文件');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:missing] id=${id || '-'}`);
        return;
      }

      try {
        const oldName = q.name || '';
        const picked = await pickOneLocalFileForRebind();
        const file = picked.file;
        const handle = picked.handle;

        if (!file) {
          throw new Error('重新绑定文件为空');
        }

        if (oldName && file.name && oldName !== file.name) {
          const ok = window.confirm(
            `重新选择的文件名和原缓存文件不同。\n\n原文件：${oldName}\n新文件：${file.name}\n\n是否继续绑定？`,
          );

          if (!ok) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][rebind-file:cancel-name-mismatch] id=${id || '-'} old=${oldName} next=${file.name}`,
            );
            setStatus('已取消重新绑定');
            return;
          }
        }

        const hasHandle = isFileHandleLike(handle);

        q.name = file.name || q.name || 'unknown';
        q.size = file.size || 0;
        q.type = file.type || q.type || 'application/octet-stream';
        q.lastModified = file.lastModified || Date.now();
        q.file = file;
        q.blob = file;

        if (hasHandle) {
          q.fileHandle = handle;
          q.sourceKind = 'local-handle';
          q.readMode = 'handle';
          q.message = '';
        } else {
          q.fileHandle = null;
          q.sourceKind = 'session-file';
          q.readMode = 'snapshot';
        }

        q.state = UploadState.IDLE;
        q.message = '';
        q.uploadName = '';
        q.persistedAttached = false;

        await schedulePersistQueue();
        await refreshUploadGroupCounts();

        render();

        setStatus(`已重新绑定文件：${q.name}`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][rebind-file:success] id=${id || '-'} source=${picked.source || '-'} handle=${hasHandle ? 1 : 0} sourceKind=${q.sourceKind} readMode=${q.readMode} name=${q.name || '-'} size=${q.size || 0}`,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);

        if (errText.includes('用户取消选择文件') || errText.includes('未选择文件')) {
          console.warn('[ChatGPT toolbox] rebind upload file cancelled', err);
          setStatus('已取消重新绑定');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:cancelled] id=${id || '-'} error=${errText}`);
          return;
        }

        console.warn('[ChatGPT toolbox] rebind upload file failed', err);
        console.error('[ChatGPT toolbox] rebind upload file failed', err);
        setStatus(`重新绑定失败：${errText}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:failed] id=${id || '-'} error=${errText}`);
      }
    }

    // 上传前统一入口：有 fileHandle 则 getFile() 读最新；否则用 file/blob 缓存快照
    async function readFreshFile(q) {
      if (!q) {
        throw new Error('readFreshFile: empty queue item');
      }

      if (q.fileHandle && typeof q.fileHandle.getFile === 'function') {
        try {
          const fresh = await q.fileHandle.getFile();

          if (fresh && fresh.size >= 0) {
            q.file = fresh;
            q.blob = fresh;
            q.name = fresh.name || q.name;
            q.size = fresh.size;
            q.type = fresh.type || q.type || 'application/octet-stream';
            q.lastModified = fresh.lastModified || q.lastModified;
            q.sourceKind = 'local-handle';
            q.readMode = 'handle';
            q.message = '';

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][readFreshFile:local-handle] name=${q.name || '-'} size=${q.size || 0} readMode=handle`,
            );

            return fresh;
          }
        } catch (e) {
          const errName = e && e.name ? e.name : 'Error';
          const errText = e && e.message ? e.message : String(e);

          console.warn('[ChatGPT toolbox] fileHandle.getFile failed, fallback to cached file/blob if available', e);

          q.message = `本地文件句柄读取失败，将尝试缓存快照：${errText}`;

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][readFreshFile:handle-failed-use-cache] name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} type=${errName} error=${errText}`,
          );
        }
      }

      if (q.file || q.blob) {
        const cachedFile = normalizeToNativeFile(q.file || q.blob, q.name);

        if (cachedFile) {
          q.file = cachedFile;
          q.blob = cachedFile;
          q.sourceKind = 'cached-blob';
          q.readMode = 'snapshot';

          if (!q.message) {
            q.message = '';
          }

          setStatus(`正在使用缓存快照上传：${q.name || '-'}`, 'running');

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][readFreshFile:cached-blob] name=${q.name || cachedFile.name} size=${cachedFile.size} readMode=snapshot`,
          );

          return cachedFile;
        }
      }

      q.state = UploadState.MISSING_FILE;
      q.sourceKind = 'missing-file';
      q.readMode = '';
      q.message = '缺少文件，请重新拖入';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][readFreshFile:missing] name=${q.name || '-'}`,
      );

      throw new Error(`缺少文件，请重新拖入：${q.name || '-'}`);
    }

    function cloneFileWithUniqueName(file, seq, total) {
      const safeSeq = Math.max(1, Number(seq) || 1);
      const safeTotal = Math.max(safeSeq, Number(total) || safeSeq);
      const seqWidth = safeTotal > 99 ? 3 : 2;

      const tag = `${buildUploadTimestamp()}_${String(safeSeq).padStart(seqWidth, '0')}`;

      const newName = buildTimestampedFileName(file.name, tag);

      return new File([file], newName, {
        type: file.type || 'application/octet-stream',
        lastModified: file.lastModified || Date.now(),
      });
    }

    async function makeUploadFile(file, seq, total) {
      const renamed = cloneFileWithUniqueName(file, seq, total);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][makeUploadFile:rename-only] original=${file.name} upload=${renamed.name} size=${renamed.size}`
      );

      return renamed;
    }

    function dismissDuplicateDialogs() {
      const dialogs = qsa(SELECTORS.duplicateDialog).filter((el) => {
        return !isInToolbox(el) && isElementVisible(el);
      });

      dialogs.forEach((dialog) => {
        const text = String(dialog.innerText || dialog.textContent || '');

        if (!/已上传过|重复|duplicate|already uploaded/i.test(text)) return;

        const buttons = qsa('button, [role="button"]', dialog);
        const ok = buttons.find((btn) => {
          const t = String(btn.textContent || btn.getAttribute('aria-label') || '');
          return /确定|知道|OK|Ok|ok|close|关闭/i.test(t);
        });

        if (ok instanceof HTMLElement) {
          ok.click();
          ToolboxShell.appendLog('已自动关闭平台重复提示');
        }
      });
    }

    function startDuplicateWatcher() {
      if (state.observer) return;

      state.observer = new MutationObserver(() => {
        dismissDuplicateDialogs();
      });

      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    function stopDuplicateWatcher(graceMs = 0) {
      if (!state.observer) {
        return;
      }

      const delay = Math.max(0, Number(graceMs) || 0);

      const disconnectObserver = () => {
        if (!state.observer) {
          return;
        }

        state.observer.disconnect();
        state.observer = null;
      };

      if (delay > 0) {
        window.setTimeout(disconnectObserver, delay);
        return;
      }

      disconnectObserver();
    }

    const NON_UPLOADABLE_RUNNING_OR_FINAL_STATES = new Set([
      UploadState.ATTACHING,
      UploadState.READING,
      UploadState.ATTACHED,
      UploadState.CANCELLED,
      'VERIFYING',
      'PENDING_CONFIRM',
      'PLATFORM_DUPLICATE',
    ]);

    function logUploadFinal(q, stateValue, errText = '') {
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][uploadOne:final] name=${q && q.name ? q.name : '-'} state=${stateValue} groupId=${q && q.groupId ? q.groupId : '-'} sourceKind=${q && q.sourceKind ? q.sourceKind : '-'} size=${q && q.size ? q.size : 0} err=${errText || ''}`,
      );
    }

    function markUploadCancelled(q, reason = '用户已停止上传') {
      updateItem(q.id, {
        state: UploadState.CANCELLED,
        message: reason,
      });
      logUploadFinal(q, UploadState.CANCELLED, '');
      return false;
    }

    function isUploadItemBlockedByState(q) {
      if (!q) return true;
      return NON_UPLOADABLE_RUNNING_OR_FINAL_STATES.has(q.state)
        || isUploadUnfinishedState(q.state);
    }

    function isUploadItemUploadable(q) {
      if (isUploadItemBlockedByState(q)) return false;
      return hasAttemptableUploadSource(q);
    }

    function isUploadItemMissingSource(q) {
      if (isUploadItemBlockedByState(q)) return false;
      return !hasAttemptableUploadSource(q);
    }

    async function uploadOne(q, seq, total, options = {}) {
      const runId = options.runId;
      const signal = options.signal;
      let errText = '';

      ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:start] seq=${seq}/${total} name=${q.name} state=${q.state}`);

      if (isUploadCancelled(runId, signal)) {
        return markUploadCancelled(q);
      }

      try {
        updateItem(q.id, {
          state: UploadState.READING,
          message: '正在上传',
        });

        let fresh;

        try {
          fresh = await readFreshFile(q);

          ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:fresh-ok] name=${q.name} fresh=${fresh && fresh.name} size=${fresh && fresh.size} tag=${fresh ? Object.prototype.toString.call(fresh) : '-'}`);
        } catch (e) {
          console.warn('[ChatGPT toolbox] read fresh file failed', { name: q.name, id: q.id }, e);
          console.warn('[ChatGPT toolbox] read fresh file failed with source detail', {
            error: e,
            source: describeUploadSource(q),
            queue: state.queue.map((item) => describeUploadSource(item)),
          });

          ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:read-failed] ${q.name} ${e && e.message ? e.message : String(e)}`);

          const errMsg = e && e.message ? e.message : String(e);
          const missingFile = isHardFileReadFailure(errMsg);

          updateItem(q.id, {
            state: missingFile ? UploadState.MISSING_FILE : UploadState.FAILED,
            message: missingFile ? errMsg : `读取失败：${errMsg}`,
          });

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${missingFile ? UploadState.MISSING_FILE : UploadState.FAILED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=${errMsg}`
          );
          return false;
        }

        if (isUploadCancelled(runId, signal)) {
          return markUploadCancelled(q);
        }

        let uploadFile = normalizeToNativeFile(fresh, q.name) || fresh;

        if (isUploadUseUniqueFileNameEnabled()) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:before-make-upload-file] name=${q.name} fresh=${fresh.name} size=${fresh.size} seq=${seq}/${total}`
          );

          try {
            uploadFile = await makeUploadFile(fresh, seq, total);

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:make-upload-file-ok] original=${fresh.name} upload=${uploadFile.name} size=${uploadFile.size}`
            );
          } catch (e) {
            console.warn('[ChatGPT toolbox] makeUploadFile failed; fallback to original file', {
              name: fresh.name,
              seq,
              total,
            }, e);

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:make-upload-file-failed] name=${fresh.name} error=${e && e.message ? e.message : String(e)}`
            );

            uploadFile = fresh;
          }
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:rename-disabled] name=${fresh.name} size=${fresh.size}`
          );
        }

        console.debug('[ChatGPT toolbox] upload file name resolved', {
          originalName: fresh.name,
          uploadName: uploadFile.name,
          seq,
          total,
          uniqueNameEnabled: isUploadUseUniqueFileNameEnabled(),
        });

        updateItem(q.id, {
          state: UploadState.ATTACHING,
          uploadName: uploadFile.name,
          message: '正在上传',
        });

        ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:before-attach] name=${q.name} uploadName=${uploadFile.name} size=${uploadFile.size}`);

        const result = await ComposerApi.attachFilesByFileInput([uploadFile], 8000, {
          signal,
          runId,
          isCancelled: () => isUploadCancelled(runId, signal),
        });

        ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:attach-result] name=${q.name} ok=${result.ok ? 1 : 0} reason=${result.reason || ''}`);

        if (isUploadCancelled(runId, signal) || result.cancelled) {
          return markUploadCancelled(q);
        }

        if (result.ok) {
          q.state = UploadState.ATTACHED;
          q.message = '';
          q.attachedInSession = true;
          q.persistedAttached = true;
          q.updatedAt = Date.now();

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${q.state} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
          );
          return true;
        }

        const postEvidence = ComposerApi.findAttachmentEvidence(uploadFile, {
          extraNames: [q.name, uploadFile.name].filter(Boolean),
        });
        const postChipCount = ComposerApi.countAttachmentChips();
        const chipCountBefore = Number.isFinite(Number(result.chipCountBefore))
          ? Number(result.chipCountBefore)
          : -1;
        const chipCountAfter = Number.isFinite(Number(result.chipCountAfter))
          ? Number(result.chipCountAfter)
          : postChipCount;
        const chipCountIncreased = chipCountBefore >= 0 && chipCountAfter > chipCountBefore;

        if (postEvidence && postEvidence.ok) {
          q.state = UploadState.ATTACHED;
          q.message = '';
          q.attachedInSession = true;
          q.persistedAttached = true;
          q.updatedAt = Date.now();

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:post-evidence-attached] name=${q.name || '-'} uploadName=${uploadFile.name || '-'} reason=${postEvidence.reason || '-'} chipCount=${postChipCount}`
          );

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${q.state} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
          );
          return true;
        }

        if (chipCountIncreased) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:chip-count-increased-but-need-name] name=${q.name || '-'} uploadName=${uploadFile.name || '-'} chipBefore=${chipCountBefore} chipAfter=${chipCountAfter}`
          );
        }

        console.warn('[ChatGPT toolbox] legacy input upload failed', {
          name: q.name,
          uploadName: uploadFile.name,
          reason: result.reason,
          result,
          postEvidence,
          postChipCount,
          textPreview: postEvidence && postEvidence.textPreview ? postEvidence.textPreview : '',
        });

        const failMessage = result.settledFailed || /未确认上传完成|附件已触发/.test(result.reason || '')
          ? (result.reason || '附件已出现但未能确认稳定')
          : (result.reason || '上传失败');

        updateItem(q.id, {
          state: UploadState.FAILED,
          message: failMessage,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${UploadState.FAILED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=${failMessage}`
        );
        return false;
      } catch (err) {
        errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] uploadOne failed', err);

        updateItem(q.id, {
          state: UploadState.FAILED,
          message: errText,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][uploadOne:error] name=${q && q.name ? q.name : '-'} error=${errText}`
        );
        return false;
      } finally {
        const isCurrentRun = runId == null || runId === state.runId;

        if (
          isCurrentRun &&
          q &&
          isUploadUnfinishedState(q.state)
        ) {
          q.state = UploadState.FAILED;
          q.message = errText || '上传流程未正常结束';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:force-finalize-failed] name=${q.name || '-'} state=${q.state} runId=${runId || '-'}`
          );
        } else if (!isCurrentRun) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:skip-finalize-stale-run] name=${q && q.name ? q.name : '-'} runId=${runId || '-'} current=${state.runId || '-'}`
          );
        }

        persistQueueThrottled('uploadOne:finally');
      }
    }

    async function uploadSingleById(id) {
      healStaleUploadRunningLockIfNeeded('uploadSingleById');

      if (state.running) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][single-upload:restart-running]');
        cancelCurrentUploadRun('uploadSingleById-restart');
      }

      if (!id) {
        setStatus('未找到文件 ID');
        ToolboxShell.appendLog('[UPLOAD_DIAG][single-upload:missing-id]');
        return;
      }

      refreshQueueReadableState();
      await reconcileFailedItems();

      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('未找到要上传的文件');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][single-upload:not-found] id=${id} group=${getActiveGroupId() || '-'}`);
        render();
        return;
      }

      logUploadItemSource('single-upload:before-check', q);

      if (!hasAttemptableUploadSource(q)) {
        markMissingLocalFiles([q]);
        render();
        persistQueueInBackground('single-upload:missing-source');

        setStatus(`缺少文件，请重新拖入：${q.name || '-'}`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][single-upload:missing-source] id=${q.id || '-'} name=${q.name || '-'} sourceKind=${q.sourceKind || '-'}`,
        );
        return;
      }

      q.state = UploadState.IDLE;
      q.message = '';
      q.uploadName = '';
      q.persistedAttached = false;
      q.attachedInSession = false;
      q.updatedAt = Date.now();

      startDuplicateWatcher();

      state.running = true;
      state.cancelled = false;
      state.runId += 1;
      state.activeId = q.id;
      state.uploadAbortController = new AbortController();

      const runId = state.runId;
      const signal = state.uploadAbortController.signal;

      scheduleRenderUpload('single-upload:start');

      setStatus(`正在上传：${q.name || '-'}`, 'running');
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][single-upload:start] id=${q.id || '-'} name=${q.name || '-'} groupId=${q.groupId || '-'}`,
      );

      persistQueueThrottled('single-upload:before-upload');

      try {
        await uploadOne(q, 1, 1, {
          runId,
          signal,
        });

        if (state.cancelled || runId !== state.runId) {
          return;
        }

        let settledTargets = resolveUploadTargets([q]);

        settledTargets.forEach((item) => {
          if (item && isUploadUnfinishedState(item.state)) {
            updateItem(item.id, {
              state: UploadState.FAILED,
              message: '单文件上传流程结束时仍未完成',
            });
          }
        });

        await reconcileFailedItems();

        settledTargets = resolveUploadTargets([q]);

        const allAttached = settledTargets.every((item) => item && item.state === UploadState.ATTACHED);

        if (!allAttached) {
          await waitUntilComposerUploadIdle({
            runId,
            signal,
            timeoutMs: 3000,
          });
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);

        console.error('[ChatGPT toolbox] single upload failed', err);

        updateItem(q.id, {
          state: UploadState.FAILED,
          message: errText,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][single-upload:error] id=${q.id || '-'} name=${q.name || '-'} error=${errText}`,
        );
      } finally {
        stopDuplicateWatcher(3000);

        if (runId === state.runId || state.cancelled) {
          state.running = false;
          state.activeId = '';
          state.uploadAbortController = null;

          const settledTargets = resolveUploadTargets([q]);
          const result = countUploadResult(settledTargets);

          render();

          if (state.cancelled) {
            setStatus(`已停止上传：${q.name || '-'}`, 'warn');
          } else if (result.success > 0) {
            setStatus(`上传完成：${q.name || '-'}`, 'success');
          } else {
            setStatus(`上传失败：${q.name || '-'}`, 'error');
          }

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][single-upload:finalize] success=${result.success} failed=${result.failed} running=${state.running} id=${q.id || '-'} name=${q.name || '-'}`,
          );

          persistQueueInBackground('single-upload:finalize');
        }
      }
    }

    async function uploadSingleFromListClick(id) {
      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('未找到对应文件');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][single-click-upload:return-missing] id=${id || '-'}`);
        return;
      }

      if (!hasAttemptableUploadSource(q)) {
        q.state = UploadState.MISSING_FILE;
        q.message = '缺少文件，请重新拖入';
        q.updatedAt = Date.now();

        render();
        setStatus('缺少文件，请重新拖入');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][single-click-upload:return-no-source] id=${id || '-'} name=${q.name || '-'}`,
        );
        return;
      }

      if (state.running) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][single-click-upload:restart-running]');
        cancelCurrentUploadRun('single-file-click-restart');
      }

      q.state = UploadState.IDLE;
      q.message = '';
      q.uploadName = '';
      q.persistedAttached = false;
      q.attachedInSession = false;
      q.updatedAt = Date.now();

      state.activeId = id;

      render();
      setStatus(`正在上传：${q.name || id}`, 'running');

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][single-click-upload:start] id=${id || '-'} name=${q.name || '-'}`,
      );

      await uploadSingleById(id);
    }

    function markMissingLocalFiles(items) {
      let changed = false;

      (items || []).forEach((q) => {
        if (!q) return;
        if (q.state === UploadState.ATTACHED) return;

        if (hasAttemptableUploadSource(q)) {
          if (q.state === UploadState.MISSING_FILE) {
            q.state = UploadState.IDLE;
            q.message = '';
            changed = true;
          }
          return;
        }

        q.state = UploadState.MISSING_FILE;
        q.sourceKind = 'missing-file';
        q.message = '缺少文件，请重新拖入';
        changed = true;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][startUpload:missing-file] name=${q.name || '-'} state=${q.state} size=${q.size || 0}`,
        );
      });

      return changed;
    }

    function hasActiveUploadInProgressOnQueue() {
      return state.queue.some((q) => q && isUploadUnfinishedState(q.state));
    }

    function isUploadRunActuallyActive() {
      if (!state.running) {
        return false;
      }

      if (state.uploadAbortController) {
        return true;
      }

      if (hasActiveUploadInProgressOnQueue()) {
        return true;
      }

      return false;
    }

    function healStaleUploadRunningLockIfNeeded(context) {
      if (!state.running) return false;
      if (hasActiveUploadInProgressOnQueue()) return false;
      if (state.uploadAbortController) return false;

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][heal-running-lock] ctx=${String(context || '-')} activeId=${state.activeId || '-'}`
      );

      state.running = false;
      state.cancelled = false;
      state.activeId = '';
      state.uploadAbortController = null;

      if (rootElRef) {
        renderUploadButtonsOnly();
      }

      return true;
    }

    function buildUploadSkipResult(reason, extra = {}) {
      return {
        success: 0,
        failed: 0,
        cancelled: false,
        total: 0,
        skipped: true,
        reason: String(reason || 'unknown'),
        ...extra,
      };
    }

    function buildUploadResult(success, failed, cancelled, total, extra = {}) {
      return {
        success: Number(success) || 0,
        failed: Number(failed) || 0,
        cancelled: !!cancelled,
        total: Number(total) || 0,
        skipped: false,
        ...extra,
      };
    }

    function cancelCurrentUploadRun(context) {
      const ctx = String(context || '-');
      ToolboxShell.appendLog(`[UPLOAD_DIAG][cancel-upload-run] ctx=${ctx} runId=${state.runId}`);

      state.cancelled = true;
      state.runId += 1;

      if (state.uploadAbortController) {
        state.uploadAbortController.abort();
        state.uploadAbortController = null;
      }

      if (state.activeId) {
        updateItem(state.activeId, {
          state: UploadState.CANCELLED,
          message: '上传已中断以便重新开始',
        });
      }

      state.running = false;
      state.activeId = '';
      if (isWaitingSendActive()) {
        cancelWaitingSend('upload-run-cancelled');
      } else {
        setWaitingSendActive(false);
        state.autoSendRunId += 1;
      }
    }

    function setWaitingSendActive(active) {
      const on = !!active;
      state.waitingSend = on;
      state.autoSendWaiting = on;
    }

    function isWaitingSendActive() {
      return !!(state.waitingSend || state.autoSendWaiting || uploadSendShortcutRunning);
    }

    function cancelWaitingSend(reason = 'user-click') {
      if (!isWaitingSendActive()) {
        return false;
      }

      state.cancelWaitingSend = true;
      setWaitingSendActive(false);
      state.autoSendRunId += 1;
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;

      if (state.waitingSendTimer) {
        clearTimeout(state.waitingSendTimer);
        state.waitingSendTimer = null;
      }

      if (state.waitingSendInterval) {
        clearInterval(state.waitingSendInterval);
        state.waitingSendInterval = null;
      }

      if (state.waitingSendAbortController) {
        try {
          state.waitingSendAbortController.abort();
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] cancel waiting send abort failed', err);
          ToolboxShell.appendLog(
            `[UPLOAD][WAIT_SEND][CANCEL][abort-error] reason=${reason} error=${errText}`,
          );
        }
        state.waitingSendAbortController = null;
      }

      ToolboxShell.appendLog(`[UPLOAD][WAIT_SEND][CANCEL] reason=${reason}`);
      setStatus('已取消等待发送');
      scheduleRenderUpload('wait-send:cancel');
      return true;
    }

    function claimWaitingSendRun(source, runId) {
      const id = Number(runId) || Date.now();

      state.cancelWaitingSend = false;
      state.autoSendRunId = id;
      setWaitingSendActive(true);
      uploadSendShortcutRunning = true;
      uploadSendTaskStartedAt = Date.now();
      scheduleRenderUpload(`wait-send:claim:${source || '-'}`);

      return id;
    }

    async function sendCurrentMessageFromUploadPanel(triggerSource, presetRunId) {
      const source = triggerSource || 'button';
      const usePresetRunId = presetRunId != null && Number(presetRunId) > 0;

      if (!usePresetRunId && !isWaitingSendActive()) {
        const capability = getUploadPageCapability();
        if (!capability.sendable) {
          const blockReason = !capability.hasComposer
            ? 'no-composer'
            : capability.isResponding
              ? 'assistant-busy'
              : 'send-not-ready';
          const blockMessage = !capability.hasComposer
            ? '未找到 ChatGPT 输入框'
            : capability.isResponding
              ? '助手正在回复，暂不可发送'
              : '当前页面暂不可发送';
          setStatus(blockMessage, 'warn');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:blocked] source=${source} reason=${blockReason}`,
          );
          scheduleRenderUpload('send-message:blocked');
          return false;
        }
      }

      const runId = usePresetRunId
        ? Number(presetRunId)
        : claimWaitingSendRun(source, Date.now());

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:click] source=${source} runId=${runId} queue=${state.queue.length} running=${state.running}`
      );

      try {
        setStatus('正在等待发送按钮...');

        const sendResult = await sendContentViaComposer({
          source,
          sendExistingComposer: true,
          waitUntilSendable: true,
          timeoutMs: SEND_WAIT_TIMEOUT_MS,
          blockWhenResponding: false,
        });

        if (sendResult.ok) {
          setStatus('已发送信息');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:sent] runId=${runId} reason=${sendResult.reason || '-'}`,
          );
          return true;
        }

        if (!state.cancelWaitingSend) {
          setStatus(`发送未完成：${sendResult.reason || 'unknown'}`);
        }
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:not-sent] runId=${runId} reason=${sendResult.reason || '-'} cancelled=${state.cancelWaitingSend ? '1' : '0'}`,
        );
        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send current message failed', err);
        setStatus(`发送信息失败：${errText}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][send-message-button:failed] runId=${runId} error=${errText}`);
        return false;
      } finally {
        if (state.autoSendRunId === runId) {
          resetUploadSendShortcutState('send-message-finally', runId);
        } else {
          uploadSendShortcutRunning = false;
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-shortcut:state-reset-skip-waiting] reason=runId-changed runId=${runId} autoSendRunId=${state.autoSendRunId}`
          );
          scheduleRenderUpload('send-message:finally-runid-changed');
        }
      }
    }

    function shouldIgnoreToolboxShortcutTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) return false;
      const inToolbox = !!el.closest(`#${APP.rootId}`);
      if (!inToolbox) {
        return false;
      }
      return !!el.closest([
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
      ].join(','));
    }

    function getShortcutTargetText(target) {
      const el = target instanceof Element ? target : null;
      if (!el) {
        return '-';
      }
      const parts = [el.tagName.toLowerCase()];
      if (el.id) {
        parts.push(`#${el.id}`);
      }
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 3).join('.');
        if (cls) {
          parts.push(`.${cls}`);
        }
      }
      return parts.join('');
    }

    function logUploadShortcutDebug(e, stage, extra) {
      const now = Date.now();
      if (now - uploadShortcutDebugLastAt < 120) {
        return;
      }
      uploadShortcutDebugLastAt = now;
      ToolboxShell.appendLog(
        `[SHORTCUT][${stage}] key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? '1' : '0'} alt=${e.altKey ? '1' : '0'} shift=${e.shiftKey ? '1' : '0'} meta=${e.metaKey ? '1' : '0'} repeat=${e.repeat ? '1' : '0'} target=${getShortcutTargetText(e.target)} extra=${extra || '-'}`
      );
    }

    function logShortcutDebug(e, stage, extra) {
      const now = Date.now();
      if (now - shortcutDebugLastAt < 250) {
        return;
      }
      shortcutDebugLastAt = now;
      const target = e && e.target instanceof Element
        ? `${e.target.tagName.toLowerCase()}${e.target.id ? `#${e.target.id}` : ''}${e.target.className ? `.${String(e.target.className).split(/\s+/).slice(0, 2).join('.')}` : ''}`
        : '-';
      ToolboxShell.appendLog(
        `[SHORTCUT][${stage}] key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? '1' : '0'} alt=${e.altKey ? '1' : '0'} shift=${e.shiftKey ? '1' : '0'} meta=${e.metaKey ? '1' : '0'} repeat=${e.repeat ? '1' : '0'} target=${target} extra=${extra || '-'}`
      );
    }

    function isCopyLastMessageShortcutEvent(e) {
      const cfg = getShortcutConfig();
      return isShortcutEventMatched(e, cfg.copyLastMessage);
    }

    function isUploadSendShortcutEvent(e) {
      const cfg = getShortcutConfig();
      return isShortcutEventMatched(e, cfg.sendMessage);
    }

    function resetUploadSendShortcutState(reason, runId) {
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      if (runId == null || state.autoSendRunId === runId) {
        setWaitingSendActive(false);
        state.cancelWaitingSend = false;
      }
      scheduleRenderUpload(`send-shortcut-reset:${reason || '-'}`);
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-shortcut:state-reset] reason=${reason || '-'} runId=${runId || '-'} autoSendRunId=${state.autoSendRunId || '-'} waiting=${state.autoSendWaiting ? '1' : '0'}`
      );
    }

    function handleUploadSendShortcutKeydown(e, source) {
      if (!isUploadSendShortcutEvent(e)) {
        return false;
      }
      logUploadShortcutDebug(e, 'send-match', source || '-');
      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        logUploadShortcutDebug(e, 'send-ignore', 'repeat');
        return true;
      }
      if (shouldIgnoreToolboxShortcutTarget(e.target)) {
        logUploadShortcutDebug(e, 'send-ignore', 'target-in-toolbox-editable');
        return false;
      }
      const now = Date.now();
      if (now - uploadSendShortcutLastAt < 800) {
        e.preventDefault();
        e.stopPropagation();
        logUploadShortcutDebug(e, 'send-ignore', 'too-fast');
        return true;
      }
      uploadSendShortcutLastAt = now;
      e.preventDefault();
      e.stopPropagation();
      if (isWaitingSendActive()) {
        const runningMs = uploadSendTaskStartedAt ? Date.now() - uploadSendTaskStartedAt : 0;
        if (runningMs > 30000 && !ComposerApi.isAssistantLikelyBusy()) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-shortcut:stale-reset] runningMs=${runningMs} waiting=${state.autoSendWaiting ? '1' : '0'}`
          );
          resetUploadSendShortcutState('stale-shortcut-auto-reset', state.autoSendRunId);
        } else {
          cancelWaitingSend('shortcut-click');
          return true;
        }
      }
      const runId = claimWaitingSendRun('shortcut', Date.now());
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-shortcut:trigger] key=${e.key || '-'} code=${e.code || '-'} source=${source || '-'} runId=${runId}`
      );
      setStatus('快捷键触发：正在等待发送按钮', 'running');
      void sendCurrentMessageFromUploadPanel('shortcut', runId).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send shortcut failed', err);
        setStatus(`快捷键发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][send-shortcut:failed] error=${errText}`);
        resetUploadSendShortcutState('shortcut-catch', runId);
      });
      return true;
    }

    function bindUploadSendShortcut() {
      if (uploadSendShortcutBound) {
        return;
      }
      uploadSendShortcutBound = true;
      document.addEventListener('keydown', (e) => {
        handleUploadSendShortcutKeydown(e, 'document');
      }, true);
      window.addEventListener('keydown', (e) => {
        handleUploadSendShortcutKeydown(e, 'window');
      }, true);
      ToolboxShell.appendLog('[SHORTCUT][bind] send=configurable');
    }

    let uploadStartShortcutBound = false;
    let uploadStartShortcutLastAt = 0;

    function isUploadStartShortcutEvent(e) {
      const cfg = getShortcutConfig();
      return isShortcutEventMatched(e, cfg.startUpload);
    }

    function bindUploadStartShortcut() {
      if (uploadStartShortcutBound) {
        return;
      }

      uploadStartShortcutBound = true;

      document.addEventListener('keydown', (e) => {
        if (!isUploadStartShortcutEvent(e)) {
          return;
        }

        if (e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (isEditableTarget(e.target)) {
          return;
        }

        const now = Date.now();
        if (now - uploadStartShortcutLastAt < 800) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        uploadStartShortcutLastAt = now;

        e.preventDefault();
        e.stopPropagation();

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-shortcut:trigger] key=${e.key || '-'} code=${e.code || '-'}`
        );

        const btn = qs(UploadSelectors.startBtn);
        if (btn) {
          btn.click();
          return;
        }

        ToolboxShell.appendLog('[UPLOAD_DIAG][upload-shortcut:failed] reason=button-not-found');
      }, true);

      ToolboxShell.appendLog('[SHORTCUT][bind] upload-start=configurable');
    }

    async function startUpload(options = {}) {
      const opts = options || {};
      const forceRestart = !!opts.forceRestart;
      const uploadReason = opts.reason || 'default';
      let finalResult = null;

      healStaleUploadRunningLockIfNeeded('startUpload');

      if (state.running) {
        if (forceRestart) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:force-restart] reason=${uploadReason} runId=${state.runId}`
          );
          cancelCurrentUploadRun(`startUpload-force-restart:${uploadReason}`);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:force-restart-wait-old-run] reason=${uploadReason} runId=${state.runId}`
          );
          await sleep(120);
          state.cancelled = false;
        } else {
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-already-running]');
          return buildUploadSkipResult('already-running');
        }
      }

      if (!state.activeGroupId) {
        setStatus('请先选择文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-active-group]');
        return buildUploadSkipResult('no-active-group');
      }

      const activeFiles = getActiveGroupFiles();

      if (!activeFiles.length) {
        setStatus('当前项目没有文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-empty-queue]');
        return buildUploadSkipResult('empty-queue');
      }

      refreshQueueReadableState();
      await reconcileFailedItems();
      scheduleRenderUpload('startUpload:after-refresh');
      persistQueueThrottled('startUpload:after-refresh');

      logUploadQueueSnapshot('startUpload:after-refresh');

      const attachedCount = activeFiles.filter((q) => q && q.state === UploadState.ATTACHED).length;
      const uploadablePlan = activeFiles.filter((q) => {
        return q &&
          q.state !== UploadState.ATTACHED &&
          q.state !== UploadState.CANCELLED;
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][startUpload:plan] group=${getActiveGroupId() || '-'} total=${activeFiles.length} attached=${attachedCount} uploadable=${uploadablePlan.length}`
      );

      const uploadableTargets = activeFiles.filter(isUploadItemUploadable);
      const missingTargets = activeFiles.filter(isUploadItemMissingSource);

      uploadableTargets.forEach((q) => {
        logUploadItemSource('startUpload:uploadable', q);
      });

      missingTargets.forEach((q) => {
        logUploadItemSource('startUpload:missing', q, {
          reason: 'not readable before upload',
        });
      });

      if (!uploadableTargets.length) {
        const totalCount = activeFiles.filter(Boolean).length;

        if (totalCount > 0 && attachedCount === totalCount) {
          setStatus(`当前分组文件已全部绑定：${attachedCount}/${totalCount}；再次点击“开始上传”将再次绑定`, 'success');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:skip-all-attached] attached=${attachedCount} total=${totalCount}`,
          );
          return buildUploadResult(attachedCount, 0, false, totalCount, {
            skipped: true,
            reason: 'all-attached',
          });
        }

        scheduleRenderUpload('startUpload:skip-no-targets');
        setStatus(`当前没有可上传文件，缺失 ${missingTargets.length} 个，请重新绑定或重新拖入`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][startUpload:skip-no-targets] missing=${missingTargets.length}`,
        );
        return buildUploadSkipResult('no-uploadable-targets', {
          failed: missingTargets.length,
          total: totalCount,
        });
      }

      const missingChanged = markMissingLocalFiles([
        ...uploadableTargets,
        ...missingTargets,
      ]);

      if (missingChanged) {
        scheduleRenderUpload('startUpload:missing-marked');
        persistQueueThrottled('startUpload:missing-marked');
      }

      if (missingTargets.length) {
        ToolboxShell.appendLog(
          `本次跳过 ${missingTargets.length} 个缺少文件项，继续上传 ${uploadableTargets.length} 个可上传文件`
        );
      }

      startDuplicateWatcher();

      state.running = true;
      state.cancelled = false;
      state.runId += 1;
      const runId = state.runId;
      state.uploadAbortController = new AbortController();

      scheduleRenderUpload('startUpload:before-loop');

      ToolboxShell.appendLog(`开始批量上传：当前：${getActiveGroupName()}，文件数 ${uploadableTargets.length}`);

      uploadableTargets.forEach((q) => {
        if (
          q.state === UploadState.CANCELLED ||
          q.state === UploadState.FAILED
        ) {
          q.state = UploadState.IDLE;
          q.message = '';
          q.uploadName = '';
        }
      });

      persistQueueThrottled('startUpload:before-upload');

      const total = uploadableTargets.length;

      try {
        for (let i = 0; i < uploadableTargets.length; i += 1) {
          if (state.cancelled || runId !== state.runId) {
            break;
          }

          const q = uploadableTargets[i];
          state.activeId = q.id;

          setStatus(`正在上传 ${getActiveGroupName()} ${i + 1}/${total}：${q.name}`);
          ToolboxShell.appendLog(`批量上传 ${i + 1}/${total} 个：${q.name}`);

          await uploadOne(q, i + 1, total, {
            runId,
            signal: state.uploadAbortController.signal,
          });

          if (state.cancelled || runId !== state.runId) {
            break;
          }
        }

        let settledTargets = resolveUploadTargets(uploadableTargets);

        settledTargets.forEach((item) => {
          if (isUploadUnfinishedState(item.state)) {
            updateItem(item.id, {
              state: UploadState.FAILED,
              message: '上传流程结束时仍未完成',
            });
          }
        });

        await reconcileFailedItems();

        settledTargets = resolveUploadTargets(uploadableTargets);

        const result = countUploadResult([...settledTargets, ...missingTargets]);

        if (areAllUploadTargetsSettled(settledTargets)) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:all-targets-settled] success=${result.success} failed=${result.failed}`
          );
        }

        const finalTargets = [...settledTargets, ...missingTargets];
        const allAttached = finalTargets.every((q) => q && q.state === UploadState.ATTACHED);

        if (!allAttached) {
          await waitUntilComposerUploadIdle({
            runId,
            signal: state.uploadAbortController && state.uploadAbortController.signal,
            timeoutMs: 3000,
          });
        } else {
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-idle-wait] 所有文件已确认 ATTACHED，跳过长时间空闲等待');
        }
      } finally {
        stopDuplicateWatcher(3000);

        if (runId === state.runId || state.cancelled) {
          const stillRunningItems = state.queue.filter((item) => {
            return item && isUploadUnfinishedState(item.state);
          });

          if (stillRunningItems.length) {
            stillRunningItems.forEach((item) => {
              item.state = UploadState.FAILED;
              item.message = '上传流程超时或未正常结束，请重新点击上传';
            });

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][startUpload:force-clear-running-items] count=${stillRunningItems.length}`
            );
          }

          state.running = false;
          state.activeId = '';
          state.uploadAbortController = null;

          const settledTargets = resolveUploadTargets(uploadableTargets);
          const result = countUploadResult([...settledTargets, ...missingTargets]);

          renderUploadButtonsOnly();
          render();

          const uploadStatusType = state.cancelled
            ? 'warn'
            : result.failed > 0
              ? 'error'
              : 'success';
          const uploadStatusText = state.cancelled
            ? `已停止上传：成功 ${result.success}，失败 ${result.failed}`
            : result.failed > 0
              ? `上传未全部完成：成功 ${result.success}，失败 ${result.failed}`
              : `上传完成：成功 ${result.success}，失败 0`;
          setStatus(uploadStatusText, uploadStatusType);

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:finalize] success=${result.success} failed=${result.failed} running=${state.running} groupId=${state.activeGroupId || '-'}`,
          );

          persistQueueInBackground('startUpload:finalize');

          finalResult = buildUploadResult(
            result.success,
            result.failed,
            state.cancelled,
            uploadableTargets.length + missingTargets.length,
          );
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:skip-finalize-run-mismatch] runId=${runId} currentRunId=${state.runId} cancelled=${state.cancelled ? 1 : 0}`
          );
        }

        window.setTimeout(() => {
          const healed = healStaleUploadRunningLockIfNeeded(`startUpload:finally:${uploadReason}`);

          if (healed) {
            render();
            persistQueueInBackground(`startUpload:finally-healed:${uploadReason}`);
          }
        }, 300);
      }

      return finalResult || buildUploadSkipResult('upload-not-finalized');
    }

    async function triggerStartUpload(source = 'button') {
      const uploadSource = String(source || 'button').trim() || 'button';

      if (state.running) {
        setStatus('正在上传中，请稍后', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][START][SKIP] source=${uploadSource} reason=already-running`
        );
        return buildUploadSkipResult('already-running');
      }

      const activeFiles = getActiveGroupFiles();
      const selectedFile = getSelectedUploadFile();
      const fileCount = activeFiles.filter(Boolean).length;
      const queueCount = activeFiles.length;

      ToolboxShell.appendLog(
        `[UPLOAD][START][TRIGGERED] source=${uploadSource} group=${getActiveGroupId() || '-'} file_count=${fileCount} queue_count=${queueCount} selected=${selectedFile ? selectedFile.id : '-'}`
      );

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][upload-button:click] source=${uploadSource} group=${getActiveGroupId() || '-'} total=${queueCount}`
      );

      if (selectedFile) {
        console.log('[UPLOAD][SELECTED_FILE_UPLOAD]', {
          projectKey: getActiveGroupId(),
          fileId: selectedFile.id,
          fileName: selectedFile.name,
        });
        return await uploadSingleFromListClick(selectedFile.id);
      }

      const allItems = activeFiles.filter(Boolean);
      const attachedItems = allItems.filter((q) => q.state === UploadState.ATTACHED);
      const allAttached = allItems.length > 0 && attachedItems.length === allItems.length;

      let changed = false;

      if (allAttached) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][manual-repeat-upload-detected] total=${allItems.length} attached=${attachedItems.length}`,
        );

        changed = resetQueueItemsForUpload({
          preserveAttached: false,
          forceResetAttached: true,
          forceAll: true,
          reason: 'manual-repeat-upload',
        });

        setStatus('准备再次上传，不清空输入框已有附件', 'info');
      } else {
        changed = resetQueueItemsForUpload({
          preserveAttached: true,
          reason: 'manual-start-upload',
        });
      }

      if (changed) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][upload:reset-before-start]');
        scheduleRenderUpload('upload:reset-before-start');
        persistQueueThrottled('upload:reset-before-start');
      }

      return await startUpload({
        reason: uploadSource,
      });
    }

    function startCopyLastMessageHardResetTimer(source) {
      if (copyLastMessageHardResetTimer) {
        window.clearTimeout(copyLastMessageHardResetTimer);
      }

      copyLastMessageHardResetTimer = window.setTimeout(() => {
        copyLastMessageHardResetTimer = 0;

        if (!copyLastMessageTaskRunning && !copyLastMessageWaiting) {
          return;
        }

        if (copyLastMessageWaiting) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:hard-reset-skip] reason=waiting-reply source=${source || '-'}`
          );
          return;
        }

        const runningMs = Date.now() - Number(copyLastMessageTaskStartedAt || 0);

        if (runningMs < 8000) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:hard-reset-skip] reason=not-stale runningMs=${runningMs} source=${source || '-'}`
          );
          return;
        }

        console.warn('[ChatGPT toolbox] copy last message hard reset triggered');
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:hard-reset] source=${source || '-'} runningMs=${runningMs}`
        );

        releaseCopyLastMessageTaskLock('hard-reset-timeout');
      }, 9000);
    }

    function clearCopyLastMessageHardResetTimer(reason) {
      if (copyLastMessageHardResetTimer) {
        window.clearTimeout(copyLastMessageHardResetTimer);
        copyLastMessageHardResetTimer = 0;
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:hard-reset-clear] reason=${reason || '-'}`);
      }
    }

    function releaseCopyLastMessageTaskLock(reason) {
      copyLastMessageTaskRunning = false;
      copyLastMessageTaskSource = '';
      copyLastMessageTaskStartedAt = 0;
      copyLastMessageWaiting = false;

      const copyLastMessageBtn = rootElRef
        ? qs('#cgpt-copy-last-message-scroll-bottom', rootElRef)
        : null;

      if (copyLastMessageBtn) {
        setButtonState(copyLastMessageBtn, {
          text: '复制最后回复',
          disabled: false,
          removeClasses: [
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'cgpt-waiting-answer',
          ],
          addClasses: ['primary'],
        });
        applyUploadShortcutButtonTitles(rootElRef);
      }

      ToolboxShell.appendLog(
        `[CHAT_PAGE][copy-last-message:lock-release] reason=${reason || '-'} running=${copyLastMessageTaskRunning ? '1' : '0'} waiting=${copyLastMessageWaiting ? '1' : '0'}`
      );
    }

    function resetCopyLastMessageTaskState(reason) {
      releaseCopyLastMessageTaskLock(reason || 'reset');
      ToolboxShell.appendLog(
        `[CHAT_PAGE][copy-last-message:state-reset] reason=${reason || '-'} running=${copyLastMessageTaskRunning ? '1' : '0'} waiting=${copyLastMessageWaiting ? '1' : '0'}`
      );
    }

    function validateStableCopyRecord(stableResult) {
      const records = ChatMessageExtractor.buildRecords({
        includeEmpty: false,
      });

      const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
      const latestUser = picked.latestUser || null;

      if (!latestUser) {
        return {
          ok: false,
          reason: 'no-latest-user',
          latestUser: null,
          picked,
        };
      }

      if (!picked.ok || !picked.record) {
        return {
          ok: false,
          reason: picked.reason || 'no-assistant-after-latest-user',
          latestUser,
          picked,
        };
      }

      const stableTurn = String(stableResult && stableResult.record && stableResult.record.turn_id || '');
      const pickedTurn = String(picked.record.turn_id || '');

      const stableText = ChatMessageExtractor.cleanMessageText(stableResult && stableResult.text || '').trim();
      const pickedText = ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();

      const sameTurn = stableTurn && pickedTurn && stableTurn === pickedTurn;
      const sameText = stableText && pickedText && stableText === pickedText;

      if (!sameTurn && !sameText) {
        return {
          ok: false,
          reason: 'stable-record-not-current-latest',
          latestUser,
          picked,
          stableTurn,
          pickedTurn,
          stableChars: stableText.length,
          pickedChars: pickedText.length,
        };
      }

      return {
        ok: true,
        reason: 'validated-current-latest',
        latestUser,
        picked,
        text: pickedText || stableText,
        record: picked.record,
      };
    }

    function getLatestAssistantTextForCopyCheck() {
      try {
        const records = ChatMessageExtractor.buildRecords({
          includeEmpty: false,
        });
        const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);

        if (!picked.ok || !picked.record) {
          return '';
        }

        return ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] getLatestAssistantTextForCopyCheck failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:assistant-text-check-failed] error=${errText}`);
        return '';
      }
    }

    function hasRealStopButtonForCopy() {
      const selectors = [
        'button[data-testid="stop-button"]',
        'button[aria-label*="Stop"]',
        'button[aria-label*="停止"]',
        '.result-streaming',
        '[data-testid="stop-button"]',
      ];

      for (const selector of selectors) {
        const btn = qs(selector);

        if (!btn) {
          continue;
        }

        if (isInToolbox(btn)) {
          continue;
        }

        if (!isElementVisible(btn)) {
          continue;
        }

        if (btn.disabled) {
          continue;
        }

        return true;
      }

      return false;
    }

    function isAssistantDefinitelyGeneratingForCopyFast() {
      try {
        if (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy()
        ) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-fast] reason=composer-busy');
          return true;
        }

        if (hasRealStopButtonForCopy()) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-fast] reason=real-stop-or-streaming');
          return true;
        }

        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] copy fast busy-check failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:busy-fast-failed] error=${errText}`);
        return false;
      }
    }

    async function isAssistantReallyGeneratingForCopy() {
      try {
        if (hasRealStopButtonForCopy()) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-check] reason=real-stop-button');
          return true;
        }

        const before = getLatestAssistantTextForCopyCheck();
        await sleep(700);

        if (hasRealStopButtonForCopy()) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-check] reason=real-stop-button-after-wait');
          return true;
        }

        const after = getLatestAssistantTextForCopyCheck();

        if (before && after && before !== after) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:busy-check] reason=text-changing before=${before.length} after=${after.length}`
          );
          return true;
        }

        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:busy-check] reason=idle before=${before.length} after=${after.length}`
        );

        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] copy busy-check failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:busy-check-failed] error=${errText}`);
        return false;
      }
    }

    async function waitUntilAssistantIdleForCopy(options) {
      const opts = options || {};
      const runId = opts.runId;
      const timeoutMs = Number(opts.timeoutMs || 10 * 60 * 1000);
      const stableIdleMs = Number(opts.stableIdleMs || 1600);
      const pollMs = Number(opts.pollMs || 800);

      const startedAt = Date.now();
      let idleSince = 0;
      let sawBusy = false;
      let lastLogAt = 0;

      while (Date.now() - startedAt < timeoutMs) {
        if (!copyLastMessageTaskRunning) {
          return {
            ok: false,
            reason: 'task-stopped',
          };
        }

        if (runId !== copyLastMessageWaitRunId) {
          return {
            ok: false,
            reason: 'cancelled',
          };
        }

        const busy = await isAssistantReallyGeneratingForCopy();

        if (busy) {
          sawBusy = true;
          idleSince = 0;

          const now = Date.now();
          if (now - lastLogAt > 5000) {
            lastLogAt = now;
            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:waiting-reply]');
          }

          await sleep(pollMs);
          continue;
        }

        if (!idleSince) {
          idleSince = Date.now();
          await sleep(pollMs);
          continue;
        }

        if (Date.now() - idleSince >= stableIdleMs) {
          return {
            ok: true,
            reason: sawBusy ? 'reply-finished' : 'already-idle',
          };
        }

        await sleep(pollMs);
      }

      return {
        ok: false,
        reason: 'timeout',
      };
    }

    async function copyLastMessageNow(triggerSource) {
      const source = triggerSource || 'button';
      const cfg = getCompactUiConfig();
      const shouldRestoreScroll = cfg.restoreScrollAfterCopyLastMessage === true;
      let savedScrollPositions = null;

      ToolboxShell.appendLog(`[COPY_LAST][BEGIN] source=${source}`);

      try {
        savedScrollPositions = saveChatScrollPositionsForCopy('copy-last-message');

        try {
          await withTimeout(
            forceChatPageToAbsoluteEnd('copy-last-message-before-copy'),
            2500,
            'force-end-before-copy'
          );
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] force end before copy failed', err);
          ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:force-end-before-copy-failed] error=${errText}`);
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:continue-after-force-end-timeout]');
        }

        await sleep(180);

        const beforeRecords = ChatMessageExtractor.buildRecords({
          includeEmpty: false,
        });

        const beforePicked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(beforeRecords);

        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:before-pick] ok=${beforePicked.ok ? 1 : 0} reason=${beforePicked.reason || '-'} latestUserIndex=${beforePicked.latestUser ? beforePicked.latestUser.index : -1} assistantIndex=${beforePicked.record ? beforePicked.record.index : -1}`,
        );

        if (beforePicked.ok && beforePicked.text) {
          ToolboxShell.appendLog('[COPY_LAST][DOM_OK] stage=before-pick');
        } else {
          ToolboxShell.appendLog(
            `[COPY_LAST][DOM_FAILED] stage=before-pick reason=${beforePicked.reason || '-'}`,
          );
        }

        const stableResult = await ChatMessageExtractor.waitLatestAssistantStable({
          timeoutMs: 15000,
          intervalMs: 300,
          stableRounds: 3,
          isGenerating: isAssistantDefinitelyGeneratingForCopyFast,
        });

        if (!stableResult.ok || !stableResult.text) {
          const reason = stableResult.reason || 'unknown';

          if (reason === 'no-assistant-after-latest-user') {
            ToolboxShell.setStatus(
              '最后一条回复还没有生成，未复制上一轮内容',
              'warn',
              {
                persist: true,
                shortText: '未生成',
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('最后一条回复还没有生成', 'warn', 1200);
            }

            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:no-latest-assistant]');
          } else if (reason === 'timeout') {
            ToolboxShell.setStatus(
              '等待最后回复稳定超时，请稍后再试',
              'warn',
              {
                persist: true,
                shortText: '超时',
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('等待回复稳定超时', 'warn', 1200);
            }

            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-timeout]');
          } else {
            ToolboxShell.setStatus('未找到可复制的最后一条回复', 'warn');

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('未找到最后消息', 'warn');
            }
          }

          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:skip] source=${source} reason=${reason}`
          );
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=no-message');

          if (!shouldRestoreScroll) {
            void forceChatPageToAbsoluteEnd('copy-last-message-no-message').catch((scrollErr) => {
              const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
              console.warn('[ChatGPT toolbox] force end after no message failed', scrollErr);
              ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:no-message-scroll-failed] error=${scrollErrText}`);
            });
          }

          return false;
        }

        const finalValidate = validateStableCopyRecord(stableResult);

        if (!finalValidate.ok) {
          const reason = finalValidate.reason || 'final-validate-failed';
          ToolboxShell.appendLog(
            `[COPY_LAST][DOM_FAILED] stage=final-validate reason=${reason}`,
          );

          const snapshotFallback = tryCopyLastAssistantSnapshotFallback(
            beforeRecords,
            `final-validate-failed:${reason}`,
          );
          if (snapshotFallback && snapshotFallback.text) {
            await copyTextToClipboard(snapshotFallback.text);
            const stats = getCopiedTextStats(snapshotFallback.text);
            ToolboxShell.appendLog(
              `[COPY_LAST][OK] chars=${stats.charCount} source=${source} role=assistant reason=snapshot_fallback`,
            );

        void playCopySuccessBeepSafe(source || '-', 'copyLastMessage');

        ToolboxShell.setStatus(
          `已复制最后一条回复（快照兜底）：${stats.charCount} 字符`,
              'success',
              { persist: false },
            );
            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast(`已复制 ${stats.charCount} 字符`, 'success', 900);
            }
            return true;
          }

          ToolboxShell.setStatus(
            reason === 'no-assistant-after-latest-user'
              ? '最后一条回复还没有生成，未复制上一轮内容'
              : '最后消息校验失败，未复制旧内容',
            'warn',
            {
              persist: true,
              shortText: '未复制',
            },
          );

          if (typeof ToolboxShell.showToast === 'function') {
            ToolboxShell.showToast('最后消息未确认，未复制旧内容', 'warn', 1500);
          }

          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:final-validate-failed] reason=${reason} latestUserIndex=${finalValidate.latestUser ? finalValidate.latestUser.index : -1} pickedIndex=${finalValidate.picked && finalValidate.picked.record ? finalValidate.picked.record.index : -1}`,
          );

          return false;
        }

        const result = {
          ok: true,
          text: finalValidate.text,
          role: finalValidate.record?.role || 'assistant',
          reason: finalValidate.reason || stableResult.reason || 'stable',
          record: finalValidate.record || stableResult.record || null,
        };

        const preview = result.text.replace(/\s+/g, ' ').slice(0, 120);
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:record-picked] index=${result.record?.index ?? -1} role=${result.role || '-'} chars=${result.record?.char_count ?? 0} turn=${result.record?.turn_id || '-'} preview=${preview}`
        );

        const rawFromElement = result.record && result.record.element
          ? String(result.record.element.textContent || result.record.element.innerText || '')
          : '';

        const afterThinking = extractFinalAnswerAfterThinkingText(rawFromElement);
        const cleanedAfterThinking = ChatMessageExtractor.cleanMessageText(afterThinking || '');

        if (
          cleanedAfterThinking &&
          cleanedAfterThinking.length > String(result.text || '').length + 30
        ) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:replace-with-after-thinking] oldChars=${String(result.text || '').length} newChars=${cleanedAfterThinking.length}`,
          );
          result.text = cleanedAfterThinking;
          result.reason = 'after-thinking-final-answer';
        }

        if (
          rawFromElement &&
          isTextBeforeThinkingBoundary(rawFromElement, result.text) &&
          cleanedAfterThinking
        ) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:before-thinking-detected] oldChars=${String(result.text || '').length} afterThinkingChars=${cleanedAfterThinking.length}`,
          );
          result.text = cleanedAfterThinking;
          result.reason = 'replace-before-thinking-with-final-answer';
        }

        await copyTextToClipboard(result.text);

        const stats = getCopiedTextStats(result.text);

        ToolboxShell.appendLog(
          `[COPY_LAST][OK] chars=${stats.charCount} source=${source} role=${result.role || '-'}`,
        );

        void playCopySuccessBeepSafe(source || '-', 'copyLastMessage');

        window.setTimeout(() => {
          try {
            ToolboxShell.setStatus(
              `已复制最后一条回复：${stats.charCount} 字符，汉字 ${stats.hanCount}`,
              'success',
              {
                persist: false,
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast(
                `已复制 ${stats.charCount} 字符`,
                'success',
                900
              );
            }

            ToolboxShell.appendLog(
              `[CHAT_PAGE][copy-last-message:ok] source=${source} role=${result.role || '-'} chars=${stats.charCount} han=${stats.hanCount} no_space=${stats.noSpaceCharCount} lines=${stats.lineCount} reason=${result.reason || '-'}`
            );
          } catch (uiErr) {
            const uiErrText = uiErr && uiErr.message ? uiErr.message : String(uiErr);
            console.error('[ChatGPT toolbox] copy success UI update failed', uiErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:success-ui-failed] error=${uiErrText}`);
          }
        }, 0);

        if (!shouldRestoreScroll) {
          void forceChatPageToAbsoluteEnd('copy-last-message-after-copy').catch((scrollErr) => {
            const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
            console.warn('[ChatGPT toolbox] force end after copy failed', scrollErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:after-copy-scroll-failed] error=${scrollErrText}`);
          });
        }

        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        const isFocusClipboardError = /Document is not focused|clipboard|writeText/i.test(errText);
        console.error('[ChatGPT toolbox] copy last message failed', err);

        ToolboxShell.setStatus(
          isFocusClipboardError
            ? '复制失败：浏览器拒绝写入剪贴板，请启用 GM_setClipboard 或重新点击复制'
            : `复制最后一条回复失败：${errText}`,
          'error',
          {
            persist: true,
            shortText: '复制失败',
          },
        );

        if (typeof ToolboxShell.showToast === 'function') {
          ToolboxShell.showToast(
            isFocusClipboardError ? '剪贴板被浏览器拒绝' : '复制失败',
            'error',
            1500,
          );
        }

        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:failed] source=${source} error=${errText}`);
        ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=copy-failed');

        if (!shouldRestoreScroll) {
          void forceChatPageToAbsoluteEnd('copy-last-message-error').catch((scrollErr) => {
            const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
            console.warn('[ChatGPT toolbox] force end after copy error failed', scrollErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:force-end-error-failed] error=${scrollErrText}`);
          });
        }

        return false;
      } finally {
        if (shouldRestoreScroll) {
          try {
            restoreChatScrollPositions(savedScrollPositions, 'copy-last-message');
          } catch (restoreErr) {
            const restoreErrText = restoreErr && restoreErr.message ? restoreErr.message : String(restoreErr);
            console.warn('[ChatGPT toolbox] restore scroll after copy failed', restoreErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:restore-scroll-failed] error=${restoreErrText}`);
          }
        } else {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:restore-scroll-skip] enabled=false');
        }
      }
    }

    async function copyLastMessageAndScrollBottom(triggerSource) {
      const source = triggerSource || 'button';
      const copyLastMessageBtn = rootElRef
        ? qs('#cgpt-copy-last-message-scroll-bottom', rootElRef)
        : null;

      ToolboxShell.appendLog(`[COPY_LAST][START] source=${source}`);
      ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:click] source=${source}`);
      ToolboxShell.appendLog(
        `[CHAT_PAGE][copy-last-message:task-state] running=${copyLastMessageTaskRunning ? '1' : '0'} waiting=${copyLastMessageWaiting ? '1' : '0'} source=${source}`
      );

      if (copyLastMessageTaskRunning) {
        const runningMs = Date.now() - Number(copyLastMessageTaskStartedAt || 0);

        if (runningMs > 8000) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:stale-task-force-release] runningMs=${runningMs} source=${source}`
          );
          releaseCopyLastMessageTaskLock('stale-task-force-release');
        } else {
          const stillBusy = isAssistantDefinitelyGeneratingForCopyFast();

          if (runningMs > 3000 && !stillBusy) {
            ToolboxShell.appendLog(
              `[CHAT_PAGE][copy-last-message:stale-task-idle-release] runningMs=${runningMs} source=${source}`
            );
            releaseCopyLastMessageTaskLock('stale-task-idle-release');
          } else {
            ToolboxShell.setStatus(
              copyLastMessageWaiting
                ? '正在回答中，等待回答完成后复制最后回复...'
                : '正在执行复制最后回复，请不要重复触发',
              copyLastMessageWaiting ? 'danger' : 'running',
              {
                persist: true,
                shortText: copyLastMessageWaiting ? '等回答' : '复制中',
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast(
                copyLastMessageWaiting ? '正在等待回答完成' : '正在复制',
                copyLastMessageWaiting ? 'danger' : 'running',
                900,
              );
            }

            ToolboxShell.appendLog(
              `[CHAT_PAGE][copy-last-message:ignored] reason=task-running source=${source} current=${copyLastMessageTaskSource || '-'} runningMs=${runningMs}`
            );
            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=running-or-ignored');

            return false;
          }
        }
      }

      copyLastMessageTaskRunning = true;
      copyLastMessageTaskSource = source;
      copyLastMessageTaskStartedAt = Date.now();
      startCopyLastMessageHardResetTimer(source);
      try {
        const busyAtClick = isAssistantDefinitelyGeneratingForCopyFast();
        const latestAny = getLatestConversationMessageRecord({
          preferAssistant: false,
        });

        if (!busyAtClick && latestAny && latestAny.role === 'user') {
          ToolboxShell.setStatus(
            '最后一条消息是用户消息，等待助手回复后再复制',
            'running',
            {
              persist: true,
              shortText: '等回答',
            },
          );

          ToolboxShell.appendLog(
            `[COPY_LAST][WAIT_AFTER_USER] source=${source} latestUserIndex=${latestAny.index}`,
          );

          copyLastMessageWaiting = true;
          copyLastMessageWaitRunId += 1;

          const waitResult = await waitUntilAssistantIdleForCopy({
            runId: copyLastMessageWaitRunId,
            timeoutMs: 10 * 60 * 1000,
            stableIdleMs: 1600,
            pollMs: 800,
          });

          if (!waitResult.ok) {
            ToolboxShell.appendLog(
              `[COPY_LAST][WAIT_AFTER_USER_FAILED] source=${source} reason=${waitResult.reason || '-'}`,
            );
            return false;
          }

          const copiedAfterUser = await copyLastMessageNow(source);
          if (copiedAfterUser) {
            ToolboxShell.appendLog(
              `[COPY_LAST][ASSISTANT_AFTER_USER_OK] source=${source}`,
            );
          }
          return copiedAfterUser;
        }

        if (!busyAtClick) {
          ToolboxShell.setStatus(
            '正在复制最后回复...',
            'running',
            {
              persist: true,
              shortText: '复制中',
            },
          );
          const copied = await copyLastMessageNow(source);
          if (copied) {
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:direct-copy-done] source=${source}`);
          }
          return copied;
        }

        copyLastMessageWaiting = true;
        copyLastMessageWaitRunId += 1;
        const runId = copyLastMessageWaitRunId;

        if (copyLastMessageBtn) {
          setButtonState(copyLastMessageBtn, {
            text: '等待回答',
            disabled: false,
            removeClasses: [
              'primary',
              'success',
              'warning',
              'orange',
              'amber',
            ],
            addClasses: ['danger', 'cgpt-waiting-answer'],
          });
        }

        ToolboxShell.setStatus(
          '正在回答中，等待回答完成后复制最后回复...',
          'danger',
          {
            persist: true,
            shortText: '等回答',
          },
        );

        if (typeof ToolboxShell.showToast === 'function') {
          ToolboxShell.showToast('等待回答完成后复制', 'danger', 1100);
        }

        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:wait-start] source=${source}`);

        const waitResult = await waitUntilAssistantIdleForCopy({
          runId,
          timeoutMs: 10 * 60 * 1000,
          stableIdleMs: 1600,
          pollMs: 800,
        });

        if (!waitResult.ok) {
          ToolboxShell.setStatus(
            `等待回答完成后复制失败：${waitResult.reason}`,
            'warn',
            {
              persist: true,
              shortText: '失败',
            },
          );

          if (typeof ToolboxShell.showToast === 'function') {
            ToolboxShell.showToast('等待复制失败', 'warn', 1200);
          }

          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:wait-failed] source=${source} reason=${waitResult.reason || '-'}`
          );

          return false;
        }

        ToolboxShell.setStatus(
          '回答已完成，正在复制最后回复...',
          'running',
          {
            persist: true,
            shortText: '复制中',
          },
        );
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:wait-finished] source=${source} reason=${waitResult.reason || '-'}`
        );

        const copied = await copyLastMessageNow(source);

        if (copied) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:wait-copy-done] source=${source}`
          );
        }

        return copied;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] copy last message smart flow failed', err);

        ToolboxShell.setStatus(
          `复制最后回复失败：${errText}`,
          'error',
          {
            persist: true,
            shortText: '失败',
          },
        );

        if (typeof ToolboxShell.showToast === 'function') {
          ToolboxShell.showToast('复制失败', 'error', 1200);
        }

        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:smart-flow-failed] source=${source} error=${errText}`
        );

        return false;
      } finally {
        clearCopyLastMessageHardResetTimer('copy-last-message-finally');
        resetCopyLastMessageTaskState('copy-last-message-finally');
      }
    }

    function bindCopyLastMessageShortcut() {
      if (copyLastMessageShortcutBound) {
        return;
      }
      copyLastMessageShortcutBound = true;
      document.addEventListener('keydown', (e) => {
        if (!isCopyLastMessageShortcutEvent(e)) {
          return;
        }
        logShortcutDebug(e, 'copy-match');
        if (e.repeat) {
          logShortcutDebug(e, 'copy-ignore', 'repeat');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (shouldIgnoreToolboxShortcutTarget(e.target)) {
          logShortcutDebug(e, 'copy-ignore', 'target-in-toolbox-editable');
          return;
        }
        const now = Date.now();
        if (now - copyLastMessageShortcutLastAt < 800) {
          logShortcutDebug(e, 'copy-ignore', 'too-fast');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        copyLastMessageShortcutLastAt = now;
        e.preventDefault();
        e.stopPropagation();
        if (copyLastMessageTaskRunning || copyLastMessageShortcutRunning) {
          ToolboxShell.setStatus(
            '正在复制最后回复，请不要重复触发',
            'running',
            {
              persist: true,
              shortText: copyLastMessageWaiting ? '等回答' : '复制中',
            },
          );
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message-shortcut:ignored] reason=running');
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=running-or-ignored');
          return;
        }
        copyLastMessageShortcutRunning = true;
        ToolboxShell.setStatus(
          '快捷键触发：正在复制最后回复',
          'running',
          {
            persist: true,
            shortText: '复制中',
          },
        );
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message-shortcut:trigger] key=${e.key || '-'} code=${e.code || '-'}`
        );
        void copyLastMessageAndScrollBottom('shortcut').catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] copy last message shortcut failed', err);
          ToolboxShell.setStatus(
            `快捷键复制最后回复失败：${errText}`,
            'error',
            {
              persist: true,
              shortText: '失败',
            },
          );
          ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message-shortcut:failed] error=${errText}`);
        }).finally(() => {
          copyLastMessageShortcutRunning = false;
        });
      }, true);
      ToolboxShell.appendLog('[SHORTCUT][bind] copy=configurable');
    }

    function bindShortcutWindowFallback() {
      if (shortcutWindowFallbackBound) {
        return;
      }
      shortcutWindowFallbackBound = true;
      window.addEventListener('keydown', (e) => {
        if (!isCopyLastMessageShortcutEvent(e)) {
          return;
        }
        logShortcutDebug(e, 'window-seen');
      }, true);
    }

    function runUploadUiAction(action, button, source, event) {
      const src = source || 'unknown';

      if (!action || !button) {
        return false;
      }

      if (event) {
        event.preventDefault();
        event.stopPropagation();

        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }

      ToolboxShell.appendLog(
        `[UPLOAD_UI_ACTION][hit] action=${action} source=${src} disabled=${button.disabled ? '1' : '0'}`,
      );

      if (typeof ToolboxShell.suspendEdgeAutoHide === 'function') {
        ToolboxShell.suspendEdgeAutoHide(`run-action:${action}:${src}`, 3000);
      }

      if (action === 'send-message' && isWaitingSendActive()) {
        cancelWaitingSend(src === 'delegated-click' ? 'button-click' : src);
        return true;
      }

      if (shouldSkipUploadUiAction(action, src, 350)) {
        return true;
      }

      if (action === 'copy-continue') {
        const busyState = clearStaleUploadButtonBusy(button, {
          action: 'copy-continue',
          source: src,
        });
        if (busyState.skipped) {
          ToolboxShell.appendLog(
            `[UPLOAD_UI_ACTION][skip] action=copy-continue source=${src} reason=button-busy busyMs=${busyState.busyMs}`,
          );
          return true;
        }
      }

      if (button.disabled && action !== 'copy-last-message' && action !== 'copy-continue') {
        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][ignored] action=${action} source=${src} reason=button-disabled`
        );
        return true;
      }

      if (action === 'copy-last-message') {
        void copyLastMessageAndScrollBottom(src).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] copy last message UI action failed', err);
          ToolboxShell.setStatus(
            `复制最后回复失败：${errText}`,
            'error',
            {
              persist: true,
              shortText: '失败',
            },
          );
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][copy-last-message:failed] error=${errText}`);
          resetCopyLastMessageTaskState('ui-action-catch');
        });

        return true;
      }

      if (action === 'send-message') {
        const capability = getUploadPageCapability();
        if (!capability.sendable) {
          const blockReason = !capability.hasComposer
            ? 'no-composer'
            : capability.isResponding
              ? 'assistant-busy'
              : 'send-not-ready';
          ToolboxShell.appendLog(
            `[UPLOAD_UI_ACTION][send-message:blocked] source=${src} reason=${blockReason}`,
          );
          return true;
        }

        const runId = claimWaitingSendRun(src, Date.now());
        void sendCurrentMessageFromUploadPanel(src, runId).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] send message UI action failed', err);
          setStatus(`发送信息失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][send-message:failed] error=${errText}`);
          resetUploadSendShortcutState('ui-action-catch', runId);
        });

        return true;
      }

      if (action === 'copy-continue') {
        button.disabled = false;
        button.removeAttribute('disabled');
        runUploadActionPromise(
          copyLastMessageAndContinue(src || 'runUploadUiAction'),
          '复制并继续',
        );

        return true;
      }

      if (action === 'start-upload') {
        void triggerStartUpload(src || 'button').catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] start upload UI action failed', err);
          setStatus(`上传失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][start-upload:failed] error=${errText}`);
        });

        return true;
      }

      return false;
    }

    function bindUploadDelegatedClick(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        ToolboxShell.appendLog('[UPLOAD_UI_ACTION][bind-skip] reason=root-missing');
        return;
      }

      if (rootEl.dataset.uploadDelegatedClickBound === '1') {
        return;
      }

      rootEl.dataset.uploadDelegatedClickBound = '1';

      rootEl.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) {
          return;
        }

        const copyContinueBtn = target.closest('#cgpt-upload-continue-once');
        if (copyContinueBtn) {
          e.preventDefault();
          e.stopPropagation();

          const busyState = clearStaleUploadButtonBusy(copyContinueBtn, {
            action: 'copy-continue',
            source: 'delegated-click',
          });
          if (busyState.skipped) {
            ToolboxShell.appendLog(
              `[UPLOAD_UI_ACTION][skip] action=copy-continue reason=button-busy busyMs=${busyState.busyMs}`,
            );
            return;
          }

          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-continue');
          runUploadUiAction('copy-continue', copyContinueBtn, 'delegated-click', e);
          return;
        }

        const copyBtn = target.closest('#cgpt-copy-last-message-scroll-bottom');
        if (copyBtn) {
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-last-message');
          runUploadUiAction('copy-last-message', copyBtn, 'delegated-click', e);
          return;
        }

        const sendBtn = target.closest('#cgpt-upload-start-send');
        if (sendBtn) {
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=send-message');
          runUploadUiAction('send-message', sendBtn, 'delegated-click', e);
          return;
        }

        const uploadBtn = target.closest('#cgpt-upload-start');
        if (uploadBtn) {
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=start-upload');
          runUploadUiAction('start-upload', uploadBtn, 'delegated-click', e);
          return;
        }
      }, true);
    }

    function runUploadActionPromise(promise, actionName) {
      Promise.resolve(promise).catch((err) => {
        const errName = err && err.name ? err.name : 'Error';
        const errText = err && err.message ? err.message : String(err);

        console.error(`[ChatGPT toolbox] upload action failed: ${actionName}`, err);

        setStatus(`${actionName}失败：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_ACTION][FAILED] action=${actionName} type=${errName} error=${errText}`,
        );
      });
    }

    function bindEvents(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        return;
      }

      if (rootEl.dataset.uploadEventsBound === '1') {
        bindUploadDropTargets(rootEl);
        bindUploadSendShortcut();
        bindCopyLastMessageShortcut();
        bindUploadStartShortcut();
        bindShortcutWindowFallback();
        bindUploadDelegatedClick(rootEl);
        applyUploadShortcutButtonTitles(rootEl);
        return;
      }

      rootEl.dataset.uploadEventsBound = '1';

      const uploadStartBtn = qs('#cgpt-upload-start', rootEl);
      if (!uploadStartBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-start');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-btn]');
      }

      const uploadStartSendBtn = qs(UploadSelectors.startSendBtn, rootEl);
      if (!uploadStartSendBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-start-send');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-send-btn]');
      }

      const copyContinueBtn = qs(UploadSelectors.copyContinueBtn, rootEl);
      if (!copyContinueBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-continue-once');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-copy-continue-btn]');
      }

      const copyLastMessageBtn = qs('#cgpt-copy-last-message-scroll-bottom', rootEl);

      if (!copyLastMessageBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-copy-last-message-scroll-bottom');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-copy-last-message-btn]');
      }

      const addInlineBtn = qs('#cgpt-upload-group-add-inline', rootEl);
      if (addInlineBtn) {
        addInlineBtn.addEventListener('click', () => {
          runUploadActionPromise(createGroupInline(), '新建分组');
        });
      }

      const groupManageBtn = qs('#cgpt-upload-group-manage', rootEl);
      if (!groupManageBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-manage');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-manage-btn]');
      } else {
        groupManageBtn.addEventListener('click', () => {
          toggleGroupManagePanel();
        });
      }

      const groupRenameBtn = qs('#cgpt-upload-group-rename-inline', rootEl);
      if (!groupRenameBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-rename-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-rename-btn]');
      } else {
        groupRenameBtn.addEventListener('click', () => {
          runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        });
      }

      if (groupNameInputEl) {
        groupNameInputEl.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          e.stopPropagation();

          runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        });

        groupNameInputEl.addEventListener('blur', () => {
          const text = String(groupNameInputEl.value || '').trim();

          if (!text) return;
          if (text === lastGroupNameInputValue) return;

          runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        });
      }

      const groupClearBtn = qs('#cgpt-upload-group-clear-inline', rootEl);
      if (!groupClearBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-clear-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-clear-btn]');
      } else {
        groupClearBtn.addEventListener('click', (e) => {
          runUploadActionPromise(clearActiveGroupQueueInline(e.currentTarget), '清空当前分组');
        });
      }

      const groupDeleteBtn = qs('#cgpt-upload-group-delete-inline', rootEl);
      if (!groupDeleteBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-delete-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-delete-btn]');
      } else {
        groupDeleteBtn.addEventListener('click', (e) => {
          runUploadActionPromise(deleteActiveGroupInline(e.currentTarget), '删除当前分组');
        });
      }

      const blobPersistEl = qs('#cgpt-upload-blob-persist-inline', rootEl);
      if (!blobPersistEl) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-blob-persist-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-blob-persist-el]');
      } else {
        blobPersistEl.addEventListener('change', async (e) => {
        const checked = !!e.target.checked;
        MemoryManager.set(MemoryManager.KEYS.uploadBlobPersistEnabled, checked);

        try {
          await schedulePersistQueue();
          setStatus(checked
            ? '已开启：小文件内容已尝试保存IndexedDB'
            : '已关闭：仅保存文件句柄与元数据');
          ToolboxShell.appendLog(checked
            ? '已开启文件内容本地保存，并已重新保存当前队列'
            : '已关闭文件内容本地保存');
        } catch (err) {
          console.error('[ChatGPT toolbox] persist queue after blob switch failed', err);
          setStatus('保存文件内容开关已变更，但队列保存失败，请看控制台');
        }
        });
      }

      const uniqueNameEl = qs('#cgpt-upload-use-unique-name-inline', rootEl);

      if (uniqueNameEl) {
        uniqueNameEl.addEventListener('change', (e) => {
          const checked = !!e.target.checked;

          setUploadUseUniqueFileNameEnabled(checked);

          setStatus(
            checked
              ? '已开启：上传前重命名（时间戳 + 序号）'
              : '已关闭：上传时保留原文件名',
          );
          ToolboxShell.appendLog(
            checked
              ? '已开启上传前重命名（时间戳 + 序号）'
              : '已关闭上传前重命名，上传时保留原文件名',
          );
        });
      }

      groupListEl.addEventListener('click', async (e) => {
        const btn = e.target instanceof HTMLElement
          ? e.target.closest('.cgpt-upload-group-chip[data-group-id]')
          : null;

        if (!btn) return;

        const groupId = btn.getAttribute('data-group-id');
        if (!groupId) return;

        try {
          await switchGroup(groupId, {
            source: 'user',
            saveGlobalFallback: true,
            savePageState: true,
            saveLastManual: true,
            reason: 'user-switch-upload-group',
          });
        } catch (err) {
          const errName = err && err.name ? err.name : 'Error';
          const errText = err && err.message ? err.message : String(err);

          console.error('[ChatGPT toolbox] group chip switch failed', err);

          setStatus(`切换分组失败：${errText}`, 'error');

          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][chip-switch:failed] groupId=${groupId || '-'} type=${errName} error=${errText}`,
          );
        }
      });

      if (manageGroupListEl) {
        manageGroupListEl.addEventListener('click', async (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('.cgpt-upload-manage-group-item[data-group-id]')
            : null;

          if (!btn) return;

          const groupId = btn.getAttribute('data-group-id');
          if (!groupId) return;

          try {
            const currentText = groupNameInputEl ? String(groupNameInputEl.value || '').trim() : '';
            const currentGroup = getActiveGroup();

            if (currentGroup && currentText && currentText !== currentGroup.name) {
              await renameActiveGroupInline();
            }

            await switchGroup(groupId, {
              source: 'user',
              saveGlobalFallback: true,
              savePageState: true,
              saveLastManual: true,
              reason: 'user-switch-upload-group',
            });
            syncGroupManagePanel({
              force: true,
            });
          } catch (err) {
            const errName = err && err.name ? err.name : 'Error';
            const errText = err && err.message ? err.message : String(err);

            console.error('[ChatGPT toolbox] manage group switch failed', err);

            setStatus(`管理列表切换分组失败：${errText}`, 'error');

            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][manage-switch:failed] groupId=${groupId || '-'} type=${errName} error=${errText}`,
            );
          }
        });
      }

      listEl.addEventListener('click', async (e) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (!target) return;

        const removeBtn = target.closest('[data-upload-remove-id]');

        if (removeBtn) {
          e.preventDefault();
          e.stopPropagation();

          const id = removeBtn.getAttribute('data-upload-remove-id');
          if (!id) return;

          try {
            await removeFileFromCurrentGroup(id);
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] remove file from current group failed', err);
            ToolboxShell.appendLog(`[UPLOAD_DIAG][remove-file:failed] id=${id || '-'} error=${errText}`);
            setStatus(`移除文件失败：${errText}`);
          }

          return;
        }

        const rebindBtn = target.closest('[data-upload-rebind-id]');

        if (rebindBtn) {
          e.preventDefault();
          e.stopPropagation();

          const id = rebindBtn.getAttribute('data-upload-rebind-id');
          if (!id) return;

          try {
            await rebindUploadFile(id);
          } catch (err) {
            const errName = err && err.name ? err.name : 'Error';
            const errText = err && err.message ? err.message : String(err);

            console.error('[ChatGPT toolbox] rebind upload file failed', err);

            setStatus(`重新绑定文件失败：${errText}`, 'error');

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][rebind-file:failed] id=${id || '-'} type=${errName} error=${errText}`,
            );
          }

          return;
        }

        const itemEl = target.closest('.cgpt-upload-item[data-id]');

        if (!itemEl) return;
        if (itemEl.classList.contains('empty')) return;

        const id = itemEl.getAttribute('data-id');
        if (!id) return;

        const q = getActiveGroupFiles().find((item) => item && item.id === id);
        if (!q) {
          setStatus('未找到对应文件');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][upload-list-click:missing-item] id=${id || '-'} group=${getActiveGroupId() || '-'}`);
          return;
        }

        setSelectedFileIdForActiveGroup(id, { reason: 'upload-list-click' });
        renderUploadListOnly();
        renderUploadButtonsOnly();

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-list-click:select] id=${id || '-'} name=${q.name || '-'} group=${getActiveGroupId() || '-'}`,
        );
      });

      const quickPromptBox = qs('#cgpt-upload-quick-prompts', rootEl);
      if (quickPromptBox) {
        quickPromptBox.addEventListener('click', async (e) => {
          const target = e.target instanceof HTMLElement ? e.target : null;
          if (!target) return;

          const categoryBtn = target.closest('[data-upload-quick-prompt-category]');
          if (categoryBtn) {
            e.preventDefault();
            e.stopPropagation();

            const category = categoryBtn.getAttribute('data-upload-quick-prompt-category') || '全部';
            saveQuickPromptActiveCategory(category, {
              reason: 'quick-category-click',
            });

            ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:category] ${category}`);

            renderUploadQuickPrompts();
            return;
          }

          const promptBtn = target.closest('[data-upload-quick-prompt-id]');
          if (!promptBtn) return;

          e.preventDefault();
          e.stopPropagation();

          const id = promptBtn.getAttribute('data-upload-quick-prompt-id');
          const prompts = typeof PromptManagerModule !== 'undefined' && typeof PromptManagerModule.getPrompts === 'function'
            ? PromptManagerModule.getPrompts()
            : [];

          const prompt = prompts.find((p) => p.id === id);

          if (!prompt) {
            setStatus('未找到对应 Prompt');
            return;
          }

          await sendOrFillQuickPrompt(prompt);
        });
      }

      bindUploadDropTargets(rootEl);
      bindUploadSendShortcut();
      bindCopyLastMessageShortcut();
      bindUploadStartShortcut();
      bindShortcutWindowFallback();
      bindUploadDelegatedClick(rootEl);
      applyUploadShortcutButtonTitles(rootEl);
    }

    function validateUploadDomStructure(rootEl) {
      validateDomRules(rootEl, [
        {
          type: 'required',
          selector: '#cgpt-copy-last-message-scroll-bottom',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-last-message-scroll-bottom',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-copy-last-message-scroll-bottom',
          message: '复制最后回复按钮被错误放进管理面板',
          invalidLog: '[UPLOAD_DOM][invalid] 复制最后回复按钮被错误放进管理面板',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-start',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-start-send',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-upload-continue-once',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-list',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-start',
          message: '上传按钮被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-start-send',
          message: '发送信息按钮被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-continue-once',
          message: '复制并继续按钮被错误放进管理面板',
          invalidLog: '[UPLOAD_DOM][invalid] 复制并继续按钮被错误放进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-list',
          message: '上传列表被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-quick-prompts',
          message: '常用 Prompt 被错误包进管理面板',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start',
          after: '#cgpt-upload-list',
          message: '上传文件列表应位于上传按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-list',
          after: '#cgpt-upload-quick-prompts',
          message: '常用 Prompt 应位于上传文件列表之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start-send',
          after: '#cgpt-upload-continue-once',
          message: '复制并继续按钮应位于发送信息按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-continue-once',
          after: '#cgpt-copy-last-message-scroll-bottom',
          message: '复制并继续按钮应位于复制最后回复按钮之前',
        },
      ], {
        moduleName: 'UPLOAD',
      });
    }

    async function applyToolboxPageState(pageState, reason = '') {
      if (!pageState || typeof pageState !== 'object') {
        return;
      }

      const shouldApplyDefaults = reason === 'init' || reason === 'page-key-changed';
      const shouldRestoreUploadGroup =
        shouldApplyDefaults || reason === 'upload-groups-ready';
      const pageKey = getToolboxPageKey();
      const reasonText = reason || '-';

      let targetGroupId = '';
      let source = '';

      if (shouldRestoreUploadGroup) {
        const preferred = resolvePreferredUploadGroupId(pageState, reason);
        targetGroupId = preferred.groupId;
        source = preferred.source;

        const pageGroupId = resolvePageUploadGroupId(pageState);

        if (pageGroupId && !preferred.groupId) {
          ToolboxShell.appendLog(
            `[UPLOAD_PAGE_STATE][restore-group-missing] reason=${reasonText} pageKey=${pageKey} groupId=${pageGroupId}`,
          );
        }
      } else {
        targetGroupId = String(readToolboxStateField(pageState, 'uploadActiveGroupId', '')).trim();

        if (targetGroupId && state.groups.some((g) => g.id === targetGroupId)) {
          source = 'page';
        } else {
          targetGroupId = '';
          source = '';
        }
      }

      if (!targetGroupId) {
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][restore-group-skip] reason=${reasonText} pageKey=${pageKey} noTarget=1`,
        );
      } else {
        if (targetGroupId !== state.activeGroupId) {
          await switchGroup(targetGroupId, {
            savePageState: source !== 'page',
            saveLastManual: false,
            saveGlobalFallback: false,
            reason: `restore-page-state:${source}`,
          });
        }

        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][restore-group] reason=${reasonText} pageKey=${pageKey} groupId=${targetGroupId || '-'} source=${source}`,
        );

        if (source === 'last-manual' || source === 'first') {
          saveCurrentToolboxBaseState(`restore-upload-group:${source}`);
        }
      }

      const category = String(readToolboxStateField(pageState, 'quickPromptCategory', '')).trim();

      if (category) {
        saveQuickPromptActiveCategory(category, {
          savePageState: false,
          reason: 'restore-page-state',
        });
        renderUploadQuickPrompts();
      } else if (shouldApplyDefaults) {
        saveQuickPromptActiveCategory('全部', {
          savePageState: false,
          reason: 'restore-page-state-default',
        });
        renderUploadQuickPrompts();
      }
    }

    function restoreUploadDomRefs(rootEl) {
      host = host || (rootEl && rootEl.parentElement) || null;
      rootElRef = rootEl;
      panelDropEl = document.getElementById(APP.panelId);
      listEl = qs(UploadSelectors.list, rootEl);
      groupListEl = qs('#cgpt-upload-group-list', rootEl);
      managePanelEl = qs('#cgpt-upload-manage-panel', rootEl);
      manageGroupListEl = qs('#cgpt-upload-manage-group-list', rootEl);
      groupNameInputEl = qs('#cgpt-upload-group-name-input', rootEl);
      startBtn = qs(UploadSelectors.startBtn, rootEl);
    }

    function runUploadModuleInitPipeline(rootEl, reason = 'mount') {
      validateUploadDomStructure(rootEl);
      bindEvents(rootEl);

      return loadGroups()
        .then(() => refreshUploadGroupCounts())
        .then(() => loadQueueForActiveGroup())
        .then(() => render())
        .then(() => applyToolboxPageState(getToolboxPageState(), 'upload-groups-ready'))
        .catch((err) => {
          const errName = err && err.name ? err.name : 'Error';
          const errText = err && err.message ? err.message : String(err);
          const errStack = err && err.stack ? err.stack : errText;
          console.error('[ChatGPT toolbox] init upload groups failed', err);
          setStatus(`上传队列初始化失败：${errText}`, 'error');
          ToolboxShell.appendLog(
            `[UPLOAD_INIT][FAILED] reason=${reason || '-'} stage=loadGroups-refreshCounts-loadQueue-render type=${errName} error=${errStack}`,
          );
          render();
          throw err;
        });
    }

    function mount(targetHost) {
      if (!targetHost) {
        console.error('[ChatGPT toolbox] UploadModule.mount: targetHost 为空');
        ToolboxShell.appendLog('[UPLOAD][mount-failed] targetHost empty');
        uploadModuleInitPromise = Promise.resolve();
        return uploadModuleInitPromise;
      }

      const existed = targetHost.querySelector('#cgpt-upload-module');
      if (existed) {
        host = targetHost;
        restoreUploadDomRefs(existed);
        ToolboxShell.appendLog('[UPLOAD][mount-reuse-dom] rebind refs and reinit groups');
        uploadModuleInitPromise = runUploadModuleInitPipeline(existed, 'mount-reuse-dom');
        return uploadModuleInitPromise;
      }

      host = targetHost;

      const rootEl = document.createElement('div');
      rootEl.id = 'cgpt-upload-module';
      rootEl.innerHTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">多文件上传</div>
          <div class="cgpt-upload-groups-head">
            <div class="cgpt-upload-group-bar">
              <div class="cgpt-upload-group-list" id="cgpt-upload-group-list"></div>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">管理</button>
            </div>
          </div>
          <div class="cgpt-upload-manage-panel cgpt-toolbox-hidden" id="cgpt-upload-manage-panel">
            <div class="cgpt-upload-manage-title">文件组管理</div>

            <div class="cgpt-upload-manage-layout">
              <div class="cgpt-upload-manage-left">
                <div class="cgpt-upload-manage-subtitle-row">
                  <span>全部分组</span>
                  <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-add-inline">新建</button>
                </div>
                <div class="cgpt-upload-manage-group-list" id="cgpt-upload-manage-group-list"></div>
              </div>

              <div class="cgpt-upload-manage-right">
                <div class="cgpt-upload-manage-subtitle">当前分组</div>

                <div class="cgpt-upload-manage-row">
                  <input class="cgpt-input" id="cgpt-upload-group-name-input" placeholder="当前分组名称">
                  <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-rename-inline">保存名称</button>
                </div>

                <div class="cgpt-upload-manage-row">
                  <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-clear-inline">清空当前组</button>
                  <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-delete-inline">删除当前组</button>
                </div>

                <div class="cgpt-hint">这里只管理当前文件组，不会自动上传到 ChatGPT。</div>
              </div>
            </div>

            <div class="cgpt-upload-common-settings">
              <div class="cgpt-upload-manage-subtitle">公共上传设置</div>

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-blob-persist-inline">
                保存小文件内容到 IndexedDB
              </label>

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-use-unique-name-inline">
                上传重命名：时间戳 + 序号
              </label>

              <div class="cgpt-hint">这些设置对所有文件组生效。</div>
            </div>
          </div>
          <div class="cgpt-row cgpt-upload-action-row">
            <button type="button" class="cgpt-btn success" id="cgpt-upload-start">开始上传</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send">发送信息</button>
            <button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" title="先复制最后回复，再发送“继续”">复制并继续</button>
            <button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom">复制最后回复</button>
          </div>

          <div class="cgpt-upload-list" id="cgpt-upload-list"></div>

          <div id="cgpt-upload-quick-prompts" class="cgpt-upload-quick-prompts">
            <div class="cgpt-upload-quick-prompts-title">常用 Prompt</div>
            <div class="cgpt-upload-quick-prompt-groups" id="cgpt-upload-quick-prompt-groups"></div>
            <div class="cgpt-upload-quick-prompts-list" id="cgpt-upload-quick-prompts-list"></div>
          </div>
        </div>
      `;

      targetHost.appendChild(rootEl);

      rootElRef = rootEl;

      panelDropEl = document.getElementById(APP.panelId);

      listEl = qs(UploadSelectors.list, rootEl);
      groupListEl = qs('#cgpt-upload-group-list', rootEl);
      managePanelEl = qs('#cgpt-upload-manage-panel', rootEl);
      manageGroupListEl = qs('#cgpt-upload-manage-group-list', rootEl);
      groupNameInputEl = qs('#cgpt-upload-group-name-input', rootEl);
      startBtn = qs(UploadSelectors.startBtn, rootEl);

      uploadModuleInitPromise = runUploadModuleInitPipeline(rootEl, 'mount-new-dom');

      return uploadModuleInitPromise;
    }

    function getUploadStatus() {
      const activeFiles = getActiveGroupFiles();
      return {
        groupCount: state.groups.length,
        activeGroupId: state.activeGroupId,
        activeGroupName: getActiveGroupName(),
        selectedFileId: getSelectedFileIdForActiveGroup(),
        total: activeFiles.length,
        attached: activeFiles.filter((q) => q && q.state === UploadState.ATTACHED).length,
        failed: activeFiles.filter(isUploadFailedState).length,
        missing: activeFiles.filter((q) => q && q.state === UploadState.MISSING_FILE).length,
        running: state.running,
      };
    }

    function getUploadInitPromise() {
      return uploadModuleInitPromise || Promise.resolve();
    }

    async function startUploadFromBridge(payload = {}) {
      const source = String(payload.source || 'bridge_command').trim() || 'bridge_command';
      const result = await triggerStartUpload(source);
      const status = getUploadStatus();
      const finalResult = {
        ...(result || {}),
        upload_status: status,
      };

      ToolboxShell.appendLog(
        `[BRIDGE][UPLOAD][DONE] source=${source} success=${Number(finalResult.success) || 0} failed=${Number(finalResult.failed) || 0} cancelled=${finalResult.cancelled ? 1 : 0} skipped=${finalResult.skipped ? 1 : 0} total=${Number(finalResult.total) || 0} attached=${Number(status.attached) || 0}`
      );

      return finalResult;
    }

    return {
      mount,
      applyToolboxPageState,
      getStatus: getUploadStatus,
      getQuickPromptActiveCategory,
      getUploadInitPromise,
      refresh: () => {
        render();
        syncGlobalDocumentDropBinding();
      },
      exportGroupsAndQueueMeta,
      importGroupsAndQueueMeta,
      startUploadFromBridge,
      triggerStartUpload,
    };
  })();

  /********************************************************************
   * 4. AutoQueueModule：自动指令队列模   ********************************************************************/

  const AutoQueueModule = (() => {
    const config = Object.assign(
      createDefaultAutoConfig(),
      MemoryManager.get(MemoryManager.KEYS.autoQueueConfig, null) || {},
    );

    function repairAutoQueuePromptConfigIfNeeded() {
      const continueText = String(config.continuePromptsText || '').trim();
      const listText = String(config.listPromptsText || '').trim();

      if (continueText === '继续' && listText === '继续') {
        config.listPromptsText = DEFAULT_AUTO_CONFIG.listPromptsText;
        saveConfig();
        ToolboxShell.appendLog('[自动指令] 已修复被污染的列表模式默认指令');
      }
    }

    function normalizeListProfiles() {
      if (!Array.isArray(config.listProfiles)) {
        config.listProfiles = [];
      }

      config.listProfiles = config.listProfiles
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const base = normalizeNamedEntity(item, {
            prefix: 'autoq_list',
            fallbackName: '未命名列表',
            maxNameLength: 24,
          });

          return {
            ...base,
            text: String(item.text || ''),
          };
        });

      if (!config.listProfiles.length) {
        config.listProfiles.push({
          ...normalizeNamedEntity(null, {
            prefix: 'autoq_list',
            fallbackName: '默认列表',
            maxNameLength: 24,
          }),
          text: String(config.listPromptsText || DEFAULT_AUTO_CONFIG.listPromptsText),
        });
      }

      const exists = config.listProfiles.some((item) => item.id === config.activeListProfileId);

      if (!exists) {
        config.activeListProfileId = config.listProfiles[0].id;
      }

      const active = config.listProfiles.find((item) => item.id === config.activeListProfileId)
        || config.listProfiles[0]
        || null;

      if (active) {
        config.listPromptsText = active.text;
      }
    }

    function getActiveListProfile() {
      normalizeListProfiles();

      return config.listProfiles.find((item) => item.id === config.activeListProfileId) || config.listProfiles[0] || null;
    }

    function buildAutoQueueListName() {
      const d = new Date();
      const base = `列表_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;

      const names = new Set(config.listProfiles.map((item) => item.name));

      return buildUniqueName(base, names);
    }

    function normalizeAutoMode(mode) {
      return mode === 'list' ? 'list' : 'continue';
    }

    function ensureModeSettings(cfg = config) {
      const base = cloneDefaultModeSettings();
      const raw = cfg && typeof cfg.modeSettings === 'object'
        ? cfg.modeSettings
        : {};

      return {
        continue: cloneModeSettingItem(Object.assign({}, base.continue, raw.continue || {})),
        list: cloneModeSettingItem(Object.assign({}, base.list, raw.list || {})),
      };
    }

    function normalizeAutoConfig(cfg = config) {
      cfg.modeSettings = ensureModeSettings(cfg);
      cfg.promptMode = normalizeAutoMode(cfg.promptMode);
      return cfg;
    }

    normalizeAutoConfig(config);
    normalizeListProfiles();

    function getModeSettings(mode) {
      const m = normalizeAutoMode(mode);
      config.modeSettings = ensureModeSettings(config);
      return config.modeSettings[m];
    }

    function patchModeSettings(mode, patch) {
      const m = normalizeAutoMode(mode);
      config.modeSettings = ensureModeSettings(config);

      const target = config.modeSettings[m];
      const safePatch = patch && typeof patch === 'object' ? patch : {};

      if (Object.prototype.hasOwnProperty.call(safePatch, 'loopMode')) {
        target.loopMode = !!safePatch.loopMode;
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'randomMinSec')) {
        target.randomMinSec = Math.max(1, Number(safePatch.randomMinSec) || 1);
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'randomMaxSec')) {
        target.randomMaxSec = Math.max(target.randomMinSec, Number(safePatch.randomMaxSec) || target.randomMinSec);
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'maxLoopCount')) {
        target.maxLoopCount = Math.max(0, Number(safePatch.maxLoopCount) || 0);
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'logPinned')) {
        target.logPinned = !!safePatch.logPinned;
      }

      if (Object.prototype.hasOwnProperty.call(safePatch, 'autoScrollPanel')) {
        target.autoScrollPanel = !!safePatch.autoScrollPanel;
      }
    }

    function readCurrentModeSettingsFromUi(mode) {
      if (!root) return;

      const m = normalizeAutoMode(mode);
      const loopEl = qs('#cgpt-autoq-loop', root);
      const minEl = qs('#cgpt-autoq-min-sec', root);
      const maxEl = qs('#cgpt-autoq-max-sec', root);
      const maxLoopEl = qs('#cgpt-autoq-max-loop', root);
      const logPinnedEl = qs('#cgpt-autoq-log-pinned', root);
      const autoScrollEl = qs('#cgpt-autoq-auto-scroll', root);
      const minSec = Math.max(1, Number(minEl && minEl.value) || 3);

      patchModeSettings(m, {
        loopMode: !!(loopEl && loopEl.checked),
        randomMinSec: minSec,
        randomMaxSec: Math.max(minSec, Number(maxEl && maxEl.value) || minSec),
        maxLoopCount: Math.max(0, Number(maxLoopEl && maxLoopEl.value) || 0),
        logPinned: !!(logPinnedEl && logPinnedEl.checked),
        autoScrollPanel: !!(autoScrollEl && autoScrollEl.checked),
      });
    }

    function applyModeSettingsToUi(mode) {
      if (!root) return;

      const settings = getModeSettings(mode);
      const loopEl = qs('#cgpt-autoq-loop', root);
      const minEl = qs('#cgpt-autoq-min-sec', root);
      const maxEl = qs('#cgpt-autoq-max-sec', root);
      const maxLoopEl = qs('#cgpt-autoq-max-loop', root);
      const logPinnedEl = qs('#cgpt-autoq-log-pinned', root);
      const autoScrollEl = qs('#cgpt-autoq-auto-scroll', root);

      if (loopEl) loopEl.checked = !!settings.loopMode;
      if (minEl) minEl.value = String(Number(settings.randomMinSec) || 3);
      if (maxEl) maxEl.value = String(Number(settings.randomMaxSec) || 20);
      if (maxLoopEl) maxLoopEl.value = String(Number(settings.maxLoopCount) || 0);
      if (logPinnedEl) logPinnedEl.checked = !!settings.logPinned;
      if (autoScrollEl) autoScrollEl.checked = !!settings.autoScrollPanel;
    }

    function refreshPromptTextareaForMode(mode) {
      if (!promptsEl) return;

      const m = normalizeAutoMode(mode);

      if (m === 'list') {
        const active = getActiveListProfile();
        promptsEl.value = active ? String(active.text || '') : '';
        return;
      }

      promptsEl.value = String(config.continuePromptsText || '继续');
    }

    function switchPromptMode(nextMode) {
      const prevMode = normalizeAutoMode(config.promptMode);
      const normalizedNext = normalizeAutoMode(nextMode);

      if (prevMode === normalizedNext) {
        updateModeTabs();
        renderListPanelVisibility();
        renderListProfiles();
        updateStatus();
        return;
      }

      readPanelConfig(prevMode);
      log(`已保：${prevMode} 模式设置`);

      config.promptMode = normalizedNext;
      normalizeAutoConfig(config);

      refreshPromptTextareaForMode(normalizedNext);
      applyModeSettingsToUi(normalizedNext);
      updateModeTabs();
      renderListPanelVisibility();
      renderListProfiles();
      saveConfig();
      updateStatus();

      log(`已切换到 ${normalizedNext} 模式`);
      log(`已恢：${normalizedNext} 模式设置`);

      ToolboxShell.setStatus(normalizedNext === 'list' ? '已切换到列表模式' : '已切换到继续模式');
    }

    const state = {
      running: false,
      waitingReply: false,
      queue: [],
      idx: 0,
      sentCount: 0,
      nextSendAt: 0,
      completedLoops: 0,
      tickTimer: null,
      replyBecameBusy: false,
      idleSince: 0,
      waitingStartedAt: 0,
      waitingNoBusyTimeoutMs: 45000,
      sendingNow: false,
    };

    let root = null;
    let promptsEl = null;
    let statusEl = null;
    let logEl = null;
    let startBtn = null;
    let stopBtn = null;
    let listPanelEl = null;
    let listProfilesEl = null;
    let listProfileNameEl = null;
    let listProfileDeleteConfirmUntil = 0;

    function saveConfig() {
      normalizeListProfiles();
      config.modeSettings = ensureModeSettings(config);

      const active = getActiveListProfile();

      if (active) {
        config.listPromptsText = active.text;
      }

      MemoryManager.set(
        MemoryManager.KEYS.autoQueueConfig,
        clonePlainObject(config, createDefaultAutoConfig(), '[AUTOQ][saveConfig]'),
      );
    }

    const debouncedSaveConfig = debounceSave(saveConfig, 300);

    function applyConfig(next) {
      const incoming = next && typeof next === 'object'
        ? clonePlainObject(next, {}, '[AUTOQ][applyConfig]')
        : {};

      Object.keys(config).forEach((key) => {
        delete config[key];
      });

      Object.assign(config, createDefaultAutoConfig(), incoming);

      if (!config.modeSettings || typeof config.modeSettings !== 'object') {
        config.modeSettings = createDefaultModeSettings();
      } else {
        config.modeSettings = clonePlainObject(
          config.modeSettings,
          createDefaultModeSettings(),
          '[AUTOQ][modeSettings]',
        );
      }

      normalizeAutoConfig(config);
      normalizeListProfiles();

      if (!root) return;

      applyModeSettingsToUi(config.promptMode);
      refreshPromptTextareaForMode(config.promptMode);
      updateModeTabs();
      renderListPanelVisibility();
      renderListProfiles();
      updateStatus();
    }

    function getActiveListProfileName() {
      const active = getActiveListProfile();
      return active ? String(active.name || '') : '';
    }

    function updateModeTabs() {
      if (!root) return;

      qsa('.cgpt-autoq-mode-tab', root).forEach((btn) => {
        const mode = btn.getAttribute('data-autoq-mode');
        btn.classList.toggle('active', mode === config.promptMode);
      });
    }

    function renderListPanelVisibility() {
      if (!listPanelEl) return;
      listPanelEl.classList.toggle('cgpt-toolbox-hidden', config.promptMode !== 'list');
    }

    function splitPrompts(text) {
      return String(text || '')
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean);
    }

    function getPromptsTextByMode(mode) {
      if (mode === 'continue') {
        return config.continuePromptsText || '继续';
      }

      normalizeListProfiles();

      const active = getActiveListProfile();
      return active ? String(active.text || '') : '';
    }

    function setPromptsTextByMode(mode, text) {
      const value = String(text || '');

      if (mode === 'continue') {
        config.continuePromptsText = value;
        return;
      }

      normalizeListProfiles();

      const active = getActiveListProfile();

      if (active) {
        active.text = value;
        active.updatedAt = nowMs();
      }

      config.listPromptsText = value;
    }

    function getRandomDelayMs() {
      const modeSettings = getModeSettings(config.promptMode);
      const minSec = Number(modeSettings.randomMinSec);
      const maxSec = Number(modeSettings.randomMaxSec);

      const safeMin = Number.isFinite(minSec) ? Math.max(1, minSec) : 3;
      const safeMax = Number.isFinite(maxSec) ? Math.max(safeMin, maxSec) : 20;

      const sec = safeMin + Math.random() * (safeMax - safeMin);
      return Math.round(sec * 1000);
    }

    function log(text) {
      const line = `[${nowTimeText()}] ${String(text || '')}`;
      const modeSettings = getModeSettings(config.promptMode);

      if (logEl) {
        logEl.textContent = `${line}\n${logEl.textContent || ''}`.slice(0, 6000);

        if (modeSettings.logPinned) {
          logEl.scrollTop = 0;
        }

        if (modeSettings.autoScrollPanel && root) {
          const page = root.closest('.cgpt-toolbox-page');

          if (page) {
            page.scrollTop = page.scrollHeight;
          }
        }
      }

      ToolboxShell.appendLog(`[自动指令] ${text}`);
      updateStatus();
    }

    function readAdvancedConfigOnly() {
      readCurrentModeSettingsFromUi(config.promptMode);
      debouncedSaveConfig();
    }

    function readPanelConfig(mode = config.promptMode) {
      const m = normalizeAutoMode(mode);
      const currentMode = normalizeAutoMode(config.promptMode);

      if (promptsEl && m === currentMode) {
        setPromptsTextByMode(m, promptsEl.value);
      }

      readCurrentModeSettingsFromUi(currentMode);
      normalizeListProfiles();
      saveConfig();
    }

    function renderListProfiles() {
      if (!listProfilesEl) return;

      normalizeListProfiles();
      renderListPanelVisibility();

      listProfilesEl.innerHTML = config.listProfiles.map((item) => {
        const active = item.id === config.activeListProfileId ? ' active' : '';

        return `
      <button type="button"
        class="cgpt-chip-btn cgpt-autoq-list-chip${active}"
        data-list-id="${escapeHtml(item.id)}"
        title="${escapeHtml(item.name)}">
        ${escapeHtml(item.name)}
      </button>
    `;
      }).join('');

      const active = getActiveListProfile();

      if (listProfileNameEl && active && document.activeElement !== listProfileNameEl) {
        listProfileNameEl.value = active.name;
      }
    }

    function switchListProfile(profileId) {
      normalizeListProfiles();

      const target = config.listProfiles.find((item) => item.id === profileId);

      if (!target) {
        console.warn('[ChatGPT toolbox] switchListProfile: profile not found', profileId);
        ToolboxShell.setStatus('列表模板不存在');
        return;
      }

      readPanelConfig(config.promptMode);

      config.activeListProfileId = target.id;
      config.listPromptsText = String(target.text || '');

      if (config.promptMode === 'list') {
        refreshPromptTextareaForMode('list');
      }
      renderListProfiles();
      saveConfig();
      updateStatus();

      ToolboxShell.setStatus(`已切换列表：${target.name}`);
      ToolboxShell.appendLog(`[自动指令] 已切换列表模板：${target.name}`);
    }

    function createListProfileInline() {
      readPanelConfig(config.promptMode);
      normalizeListProfiles();

      const profile = {
        id: createId('autoq_list'),
        name: buildAutoQueueListName(),
        text: '',
        createdAt: nowMs(),
        updatedAt: nowMs(),
      };

      config.listProfiles.push(profile);
      config.activeListProfileId = profile.id;
      config.listPromptsText = '';

      if (config.promptMode !== 'list') {
        switchPromptMode('list');
      } else {
        refreshPromptTextareaForMode('list');
      }
      renderListProfiles();
      saveConfig();
      updateStatus();

      if (listProfileNameEl) {
        listProfileNameEl.focus();
        listProfileNameEl.select();
      }

      ToolboxShell.setStatus(`已新建列表：${profile.name}`);
      ToolboxShell.appendLog(`[自动指令] 已新建列表：${profile.name}`);
    }

    function renameActiveListProfileInline() {
      normalizeListProfiles();

      const active = getActiveListProfile();

      if (!active) {
        ToolboxShell.setStatus('当前没有可重命名的列表');
        return;
      }

      const text = String(listProfileNameEl ? listProfileNameEl.value : '').trim();

      if (!text) {
        ToolboxShell.setStatus('列表名称不能为空');
        console.warn('[ChatGPT toolbox] renameActiveListProfileInline: empty name');
        return;
      }

      const nextName = text.slice(0, 24);

      if (config.listProfiles.some((item) => item.id !== active.id && item.name === nextName)) {
        ToolboxShell.setStatus('列表名称已存在');
        return;
      }

      active.name = nextName;
      active.updatedAt = nowMs();

      renderListProfiles();
      saveConfig();

      ToolboxShell.setStatus(`已保存列表名称：${active.name}`);
    }

    function deleteActiveListProfileInline(button) {
      readPanelConfig(config.promptMode);
      normalizeListProfiles();

      if (config.listProfiles.length <= 1) {
        ToolboxShell.setStatus('至少保留一个列表');
        return;
      }

      const active = getActiveListProfile();

      if (!active) {
        ToolboxShell.setStatus('当前没有可删除的列表');
        return;
      }

      const now = Date.now();

      if (now > listProfileDeleteConfirmUntil) {
        listProfileDeleteConfirmUntil = now + 3000;

        if (button) {
          button.textContent = '再次点击删除';
        }

        ToolboxShell.setStatus('再次点击确认删除当前列表');
        return;
      }

      listProfileDeleteConfirmUntil = 0;

      const deletedName = active.name;

      config.listProfiles = config.listProfiles.filter((item) => item.id !== active.id);
      config.activeListProfileId = config.listProfiles[0].id;

      const next = getActiveListProfile();

      if (next) {
        config.listPromptsText = String(next.text || '');
      }

      refreshPromptTextareaForMode('list');

      if (button) {
        button.textContent = '删除列表';
      }

      renderListProfiles();
      saveConfig();
      updateStatus();

      ToolboxShell.setStatus(`已删除列表：${deletedName}`);
    }

    function updateStatus() {
      const running = !!state.running;
      const modeText = config.promptMode === 'list' ? '列表模式' : '继续模式';
      const listName = config.promptMode === 'list' ? getActiveListProfileName() : '';

      if (statusEl) {
        const recentLog = logEl
          ? String(logEl.textContent || '').split('\n').map((x) => x.trim()).find(Boolean) || ''
          : '';

        statusEl.innerHTML = `
    <div class="cgpt-autoq-status-grid">
      <div>模式：${escapeHtml(modeText)}</div>
      <div>列表：${escapeHtml(listName || '-')}</div>
      <div>运行中：${running ? '是' : '否'}</div>
    </div>
    <div class="cgpt-autoq-status-recent" title="${escapeHtml(recentLog)}">最近：${escapeHtml(recentLog || '-')}</div>
  `;
      }

      if (startBtn) {
        startBtn.disabled = running;
        startBtn.textContent = running ? '运行中' : '开始';
      }

      if (stopBtn) {
        stopBtn.disabled = !running;
      }
    }

    function prepareQueue() {
      readPanelConfig(config.promptMode);

      const text = getPromptsTextByMode(config.promptMode);
      const prompts = splitPrompts(text);

      if (!prompts.length) {
        log('指令为空，无法开始');
        return false;
      }

      state.queue = prompts;
      state.idx = 0;
      state.sentCount = 0;
      state.completedLoops = 0;
      state.nextSendAt = 0;
      state.waitingReply = false;
      state.replyBecameBusy = false;
      state.idleSince = 0;
      state.waitingStartedAt = 0;
      state.sendingNow = false;

      return true;
    }

    function start() {
      if (state.running) return;
      if (!prepareQueue()) return;

      state.running = true;

      log(`开始运行，队列 ${state.queue.length} 条`);

      ensureTicker();
      updateStatus();

      ToolboxShell.setStatus('自动指令队列已开启');
    }

    function stop() {
      state.running = false;
      state.waitingReply = false;
      state.nextSendAt = 0;

      if (state.tickTimer) {
        window.clearInterval(state.tickTimer);
        state.tickTimer = null;
      }

      log('已停止');
      updateStatus();

      ToolboxShell.setStatus('自动指令队列已停止');
    }

    function shouldFinishAllLoops() {
      const modeSettings = getModeSettings(config.promptMode);

      if (!modeSettings.loopMode) return state.idx >= state.queue.length;

      const max = Number(modeSettings.maxLoopCount) || 0;

      if (max <= 0) return false;

      return state.completedLoops >= max;
    }

    function advanceAfterSend() {
      const modeSettings = getModeSettings(config.promptMode);

      state.idx += 1;

      if (state.idx >= state.queue.length) {
        state.completedLoops += 1;

        if (modeSettings.loopMode && !shouldFinishAllLoops()) {
          state.idx = 0;
        }
      }

      if (shouldFinishAllLoops()) {
        log('队列已全部完成');
        stop();
        return;
      }

      state.nextSendAt = Date.now() + getRandomDelayMs();
    }

    function maybeUpdateWaitingState() {
      if (!state.waitingReply) return;

      const busy = ComposerApi.isAssistantLikelyBusy();
      const waitedMs = Date.now() - Number(state.waitingStartedAt || 0);
      const maxWaitMs = Number(state.waitingNoBusyTimeoutMs) || 60000;

      if (busy) {
        state.replyBecameBusy = true;
        state.idleSince = 0;
        updateStatus();
        return;
      }

      if (!state.replyBecameBusy) {
        if (state.waitingStartedAt && waitedMs >= maxWaitMs) {
          log(`等待回复超时，继续下一条：${Math.round(waitedMs / 1000)}s`);
          state.waitingReply = false;
          state.replyBecameBusy = false;
          state.idleSince = 0;
          state.waitingStartedAt = 0;
          advanceAfterSend();
          updateStatus();
        }
        return;
      }

      if (!state.idleSince) {
        state.idleSince = Date.now();
        return;
      }

      if (Date.now() - state.idleSince >= 1600) {
        state.waitingReply = false;
        state.replyBecameBusy = false;
        state.idleSince = 0;

        advanceAfterSend();
        updateStatus();
      }
    }

    function maybeSendNext() {
      if (!state.running || state.waitingReply) return;
      if (!state.queue.length) return;
      if (Date.now() < state.nextSendAt) return;
      if (ComposerApi.isAssistantLikelyBusy()) return;

      const prompt = state.queue[state.idx];

      if (!prompt) {
        advanceAfterSend();
        updateStatus();
        return;
      }

      if (state.sendingNow) {
        return;
      }

      state.sendingNow = true;

      void sendContentViaComposer({
        source: 'auto-queue',
        content: prompt,
        allowReplaceDraft: true,
        waitUntilSendable: true,
        timeoutMs: 60000,
        blockWhenResponding: true,
      }).then((sendResult) => {
        if (!sendResult.ok) {
          log(`发送失败：${sendResult.reason || 'unknown'}`);
          return;
        }

        state.sentCount += 1;
        state.waitingReply = true;
        state.replyBecameBusy = false;
        state.idleSince = 0;
        state.waitingStartedAt = Date.now();
        log(`已发送：${prompt.slice(0, 80)} reason=${sendResult.reason || '-'}`);
        updateStatus();
      }).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] auto queue send failed', err);
        log(`发送异常：${errText}`);
      }).finally(() => {
        state.sendingNow = false;
      });
    }

    function tick() {
      try {
        if (!state.running && !state.waitingReply) {
          return;
        }

        maybeUpdateWaitingState();
        maybeSendNext();
        updateStatus();
      } catch (e) {
        console.warn('[ChatGPT toolbox] auto queue tick failed', e);
        log(`运行异常：${e && e.message ? e.message : String(e)}`);
      }
    }

    function ensureTicker() {
      if (state.tickTimer) return;

      state.tickTimer = window.setInterval(tick, 500);
    }

    function bindEvents() {
      if (startBtn) {
        startBtn.addEventListener('click', () => {
          start();
        });
      }

      if (stopBtn) {
        stopBtn.addEventListener('click', () => {
          stop();
        });
      }

      qsa('.cgpt-autoq-mode-tab', root).forEach((btn) => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-autoq-mode');
          switchPromptMode(mode === 'list' ? 'list' : 'continue');
        });
      });

      qsa('input', root).forEach((el) => {
        el.addEventListener('change', () => {
          readAdvancedConfigOnly();
          updateStatus();
        });
      });

      promptsEl.addEventListener('input', () => {
        setPromptsTextByMode(config.promptMode, promptsEl.value);
        renderListProfiles();
        debouncedSaveConfig();
      });

      qs('#cgpt-autoq-send-once', root).addEventListener('click', () => {
        readPanelConfig();

        const prompts = splitPrompts(getPromptsTextByMode(config.promptMode));
        const prompt = prompts[0] || '继续';

        if (!ComposerApi.setComposerValue(prompt)) {
          log('写入输入框失败');
          return;
        }

        window.setTimeout(() => {
          if (ComposerApi.clickSend()) {
            log(`手动发送：${prompt.slice(0, 80)}`);
          } else {
            log('手动发送失败');
          }
        }, 200);
      });

      qs('#cgpt-autoq-clear-log', root).addEventListener('click', () => {
        if (logEl) logEl.textContent = '';
        updateStatus();
      });

      if (listProfilesEl) {
        listProfilesEl.addEventListener('click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('.cgpt-autoq-list-chip[data-list-id]')
            : null;

          if (!btn) return;

          const id = btn.getAttribute('data-list-id');

          if (!id) {
            console.warn('[ChatGPT toolbox] list chip clicked without id');
            return;
          }

          switchListProfile(id);
        });
      }

      const newListBtn = qs('#cgpt-autoq-list-new', root);
      if (newListBtn) {
        bindOnce(newListBtn, 'click', () => {
          createListProfileInline();
        });
      }

      const saveNameBtn = qs('#cgpt-autoq-list-save-name', root);
      if (saveNameBtn) {
        bindOnce(saveNameBtn, 'click', () => {
          renameActiveListProfileInline();
        });
      }

      const deleteListBtn = qs('#cgpt-autoq-list-delete', root);
      if (deleteListBtn) {
        bindOnce(deleteListBtn, 'click', (e) => {
          deleteActiveListProfileInline(e.currentTarget);
        });
      }

      if (listProfileNameEl) {
        bindOnce(listProfileNameEl, 'keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          e.stopPropagation();

          renameActiveListProfileInline();
        });

        bindOnce(listProfileNameEl, 'blur', () => {
          const active = getActiveListProfile();
          const text = String(listProfileNameEl.value || '').trim();

          if (!active) return;
          if (!text) return;
          if (text === active.name) return;

          renameActiveListProfileInline();
        });
      }
    }

    function mount(targetHost) {
      if (!targetHost) {
        console.error('[ChatGPT toolbox] AutoQueueModule.mount: targetHost 为空');
        ToolboxShell.appendLog('[AUTOQ][mount-failed] targetHost empty');
        return;
      }

      const existed = targetHost.querySelector('#cgpt-autoq-module');
      if (existed) {
        root = existed;
        promptsEl = qs('#cgpt-autoq-prompts', root);
        statusEl = qs('#cgpt-autoq-status', root);
        logEl = qs('#cgpt-autoq-log', root);
        startBtn = qs('#cgpt-autoq-start', root);
        stopBtn = qs('#cgpt-autoq-stop', root);
        listPanelEl = qs('#cgpt-autoq-list-panel', root);
        listProfilesEl = qs('#cgpt-autoq-list-profile-chips', root);
        listProfileNameEl = qs('#cgpt-autoq-list-name', root);
        normalizeAutoConfig(config);
        bindEvents();
        updateStatus();
        return;
      }

      normalizeAutoConfig(config);
      const uiModeSettings = getModeSettings(config.promptMode);

      root = document.createElement('div');
      root.id = 'cgpt-autoq-module';
      root.innerHTML = `
        <div class="cgpt-section cgpt-autoq-section">
          <div class="cgpt-section-title">自动指令队列</div>

          <div class="cgpt-autoq-mode-tabs">
            <button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'continue' ? ' active' : ''}" data-autoq-mode="continue">继续模式</button>
            <button type="button" class="cgpt-autoq-mode-tab${config.promptMode === 'list' ? ' active' : ''}" data-autoq-mode="list">列表模式</button>
          </div>

          <div class="cgpt-autoq-list-panel${config.promptMode === 'list' ? '' : ' cgpt-toolbox-hidden'}" id="cgpt-autoq-list-panel">
            <div class="cgpt-autoq-list-header">
              <div class="cgpt-autoq-list-profile-chips" id="cgpt-autoq-list-profile-chips"></div>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-new">新建列表</button>
            </div>

            <div class="cgpt-autoq-list-name-row">
              <input class="cgpt-input" id="cgpt-autoq-list-name" placeholder="列表名称">
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-save-name">保存名称</button>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-autoq-list-delete">删除列表</button>
            </div>
          </div>

          <div class="cgpt-autoq-editor-block">
            <label class="cgpt-autoq-label" for="cgpt-autoq-prompts">指令内容</label>
            <textarea class="cgpt-textarea" id="cgpt-autoq-prompts"></textarea>
          </div>

          <div class="cgpt-autoq-actions">
            <button type="button" class="cgpt-btn success" id="cgpt-autoq-start">开始</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-autoq-send-once">发送一次</button>
            <button type="button" class="cgpt-btn danger" id="cgpt-autoq-stop" disabled>停止</button>
            <button type="button" class="cgpt-btn" id="cgpt-autoq-clear-log">清空日志</button>
          </div>
        </div>

        <div class="cgpt-section cgpt-autoq-settings-section">
          <div class="cgpt-section-title">执行设置</div>

          <div class="cgpt-autoq-settings-grid">
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-autoq-loop" ${uiModeSettings.loopMode ? 'checked' : ''}>
              循环模式
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-autoq-log-pinned" ${uiModeSettings.logPinned ? 'checked' : ''}>
              日志置顶
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-autoq-min-sec">最小间隔（秒）</label>
              <input class="cgpt-input" id="cgpt-autoq-min-sec" type="number" min="1" value="${Number(uiModeSettings.randomMinSec) || 3}">
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-autoq-max-sec">最大间隔（秒）</label>
              <input class="cgpt-input" id="cgpt-autoq-max-sec" type="number" min="1" value="${Number(uiModeSettings.randomMaxSec) || 20}">
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-autoq-max-loop">最大循环次数</label>
              <input class="cgpt-input" id="cgpt-autoq-max-loop" type="number" min="0" value="${Number(uiModeSettings.maxLoopCount) || 0}">
            </div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-autoq-auto-scroll" ${uiModeSettings.autoScrollPanel ? 'checked' : ''}>
              自动滚动面板
            </label>
          </div>

          <div class="cgpt-hint">最大循环次数为 0 表示不限制。</div>
        </div>

        <div class="cgpt-section cgpt-autoq-status-section">
          <div class="cgpt-section-title">运行状态</div>
          <div id="cgpt-autoq-status" class="cgpt-autoq-status"></div>
          <div id="cgpt-autoq-log" class="cgpt-autoq-log"></div>
        </div>
      `

      targetHost.appendChild(root);

      promptsEl = qs('#cgpt-autoq-prompts', root);
      statusEl = qs('#cgpt-autoq-status', root);
      logEl = qs('#cgpt-autoq-log', root);
      startBtn = qs('#cgpt-autoq-start', root);
      stopBtn = qs('#cgpt-autoq-stop', root);
      listPanelEl = qs('#cgpt-autoq-list-panel', root);
      listProfilesEl = qs('#cgpt-autoq-list-profile-chips', root);
      listProfileNameEl = qs('#cgpt-autoq-list-name', root);

      repairAutoQueuePromptConfigIfNeeded();

      normalizeAutoConfig(config);
      normalizeListProfiles();
      applyModeSettingsToUi(config.promptMode);
      refreshPromptTextareaForMode(config.promptMode);
      updateModeTabs();
      renderListPanelVisibility();
      renderListProfiles();

      bindEvents();
      updateStatus();
    }

    function snapshotConfig() {
      normalizeListProfiles();
      const snapshot = clonePlainObject(config, createDefaultAutoConfig(), '[AUTOQ][snapshotConfig]');
      snapshot.modeSettings = ensureModeSettings(snapshot);
      return snapshot;
    }

    function exportConfig() {
      return snapshotConfig();
    }

    return {
      mount,
      getConfig: () => {
        config.modeSettings = ensureModeSettings(config);
        return clonePlainObject(config, createDefaultAutoConfig(), '[AUTOQ][getConfig]');
      },
      exportConfig,
      snapshotConfig,
      getState: () => Object.assign({}, state, {
        queue: state.queue.slice(),
      }),
      applyConfig,
    };
  })();

  function renderPromptCategoryChips(categoryNames, activeName, countGetter, dataAttrName) {
    const names = Array.isArray(categoryNames) ? categoryNames : [];
    const current = String(activeName || '全部').trim() || '全部';
    const attrName = String(dataAttrName || 'data-prompt-category').trim() || 'data-prompt-category';
    const getCount = typeof countGetter === 'function'
      ? countGetter
      : () => 0;

    return names.map((name) => {
      const text = String(name || '').trim() || '默认';
      const count = Number(getCount(text)) || 0;
      const activeClass = text === current ? ' active' : '';

      return [
        `<button type="button" class="cgpt-prompt-category-chip${activeClass}" ${attrName}="${escapeHtml(text)}">`,
        `${escapeHtml(text)} ${count}`,
        '</button>',
      ].join('');
    }).join('');
  }

  /********************************************************************
   * 5. PromptManagerModule：Prompt 管理模块
   ********************************************************************/

  const PromptManagerModule = (() => {
    const STORAGE_KEY = MemoryManager.KEYS.promptManagerData;

    let root = null;
    let listEl = null;
    let searchEl = null;
    let statusEl = null;

    const promptStatus = createModuleStatus('PROMPT', {
      getLocalEl: () => statusEl,
      useGlobal: false,
      useLog: false,
    });
    let importFileEl = null;
    let modalOverlay = null;

    const PROMPT_EDITOR_MODAL_POSITION_KEY = 'promptEditorModalPosition';

    let promptEditorDragState = null;
    let promptEditorResizeBound = false;

    let prompts = [];
    let categories = [];
    let searchKeyword = '';
    let activeCategory = MemoryManager.get(
      MemoryManager.KEYS.promptManagerActiveCategory,
      '全部',
    );
    let activePromptSubtab = MemoryManager.get(
      MemoryManager.KEYS.promptManagerActiveSubtab,
      'list',
    );
    let editingPromptId = null;
    let sendLock = false;

    function getPromptCategoryName(item) {
      return normalizePromptCategoryName(item, '默认');
    }

    function createPromptCategory(name, order) {
      const cleanName = normalizePromptCategoryName(name);

      return {
        id: createId('cat'),
        name: cleanName,
        order: Number.isFinite(Number(order)) ? Number(order) : Date.now(),
        createdAt: nowMs(),
        updatedAt: nowMs(),
      };
    }

    function deriveCategoriesFromPrompts(promptList) {
      const map = new Map();

      DEFAULT_PROMPT_CATEGORIES.forEach((cat) => {
        map.set(cat.name, {
          id: cat.id,
          name: cat.name,
          order: cat.order,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
      });

      (promptList || []).forEach((p) => {
        const name = normalizePromptCategoryName(p.category);

        if (!map.has(name)) {
          map.set(name, createPromptCategory(name, map.size));
        }
      });

      return Array.from(map.values());
    }

    function normalizePromptItem(item) {
      if (!item) return null;

      const title = String(item.title || '').trim();
      const content = String(item.content || '');

      if (!title || !content.trim()) return null;

      return {
        id: String(item.id || createId('prompt')),
        title,
        category: normalizePromptCategoryName(item.category),
        content,
        createdAt: Number(item.createdAt || nowMs()),
        updatedAt: Number(item.updatedAt || nowMs()),
      };
    }

    function buildNormalizedDefaultPrompts() {
      return createDefaultPrompts().map((item) => normalizePromptItem({
        id: createId('prompt'),
        title: item.title,
        category: item.category || '默认',
        content: item.content,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      })).filter(Boolean);
    }

    function normalizePromptManagerData(raw) {
      let nextPrompts = [];
      let nextCategories = [];

      if (Array.isArray(raw)) {
        nextPrompts = raw;
        nextCategories = deriveCategoriesFromPrompts(nextPrompts);
      } else if (raw && typeof raw === 'object') {
        nextPrompts = Array.isArray(raw.prompts) ? raw.prompts : [];
        nextCategories = Array.isArray(raw.categories) ? raw.categories : [];
      }

      nextPrompts = nextPrompts
        .map((item) => normalizePromptItem(item))
        .filter(Boolean);

      if (!nextPrompts.length) {
        nextPrompts = buildNormalizedDefaultPrompts();
      }

      if (!nextCategories.length) {
        nextCategories = deriveCategoriesFromPrompts(nextPrompts);
      }

      const categoryNames = new Set();

      nextCategories = nextCategories
        .map((cat, index) => {
          const name = normalizePromptCategoryName(cat.name);

          return {
            id: String(cat.id || createId('cat')),
            name,
            order: Number.isFinite(Number(cat.order)) ? Number(cat.order) : index,
            createdAt: Number(cat.createdAt) || nowMs(),
            updatedAt: Number(cat.updatedAt) || nowMs(),
          };
        })
        .filter((cat) => {
          if (categoryNames.has(cat.name)) return false;
          categoryNames.add(cat.name);
          return true;
        });

      deriveCategoriesFromPrompts(nextPrompts).forEach((cat) => {
        if (!categoryNames.has(cat.name)) {
          nextCategories.push(cat);
          categoryNames.add(cat.name);
        }
      });

      nextCategories.sort((a, b) => Number(a.order) - Number(b.order));

      nextPrompts.forEach((p) => {
        p.category = normalizePromptCategoryName(p.category);
      });

      return {
        prompts: nextPrompts,
        categories: nextCategories,
      };
    }

    function applyPromptManagerData(data) {
      const normalized = normalizePromptManagerData(data);
      prompts = normalized.prompts;
      categories = normalized.categories;
    }

    function loadPromptManagerData() {
      const raw = MemoryManager.get(STORAGE_KEY, null);

      if (!raw) {
        const defaults = normalizePromptManagerData(null);
        savePromptManagerData(defaults);
        return defaults;
      }

      const normalized = normalizePromptManagerData(raw);

      if (Array.isArray(raw) || (raw && typeof raw === 'object' && !Array.isArray(raw.categories))) {
        savePromptManagerData(normalized);
      }

      return normalized;
    }

    function savePromptManagerData(data) {
      const payload = data || { prompts, categories };

      const ok = MemoryManager.set(STORAGE_KEY, {
        prompts: payload.prompts || prompts,
        categories: payload.categories || categories,
      });

      if (!ok) {
        console.error('[ChatGPT toolbox] savePromptManagerData failed');
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog('[Prompt 管理] 保存失败：浏览器存储写入失败');
        }
      }

      return ok;
    }

    function savePrompts() {
      return savePromptManagerData({ prompts, categories });
    }

    function getPromptCategoryCount(categoryName) {
      const normalized = normalizePromptCategoryName(categoryName);
      return prompts.filter((item) => getPromptCategoryName(item) === normalized).length;
    }

    function getPromptCategoriesForFilter() {
      return [
        { id: '__all__', name: '全部' },
        ...categories.map((cat) => ({ id: cat.id, name: cat.name })),
      ];
    }

    function getPromptCategoriesFromList(list) {
      const names = categories.map((cat) => cat.name);

      (list || []).forEach((item) => {
        const name = getPromptCategoryName(item);

        if (!names.includes(name)) {
          names.push(name);
        }
      });

      return ['全部', ...names];
    }

    function normalizeActiveCategory() {
      const filterNames = getPromptCategoriesForFilter().map((cat) => cat.name);

      if (!filterNames.includes(activeCategory)) {
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
      }

      return activeCategory;
    }

    function ensureCategoryExists(name) {
      const cleanName = normalizePromptCategoryName(name);
      const exists = categories.some((cat) => cat.name === cleanName);

      if (!exists) {
        categories.push(createPromptCategory(cleanName, categories.length));
        categories.sort((a, b) => Number(a.order) - Number(b.order));
      }

      return cleanName;
    }

    function renderCategoryDatalist() {
      const list = document.getElementById('cgpt-prompt-category-options');

      if (!list) return;

      list.innerHTML = categories.map((cat) => `
        <option value="${escapeHtml(cat.name)}"></option>
      `).join('');
    }

    function renderCategoryManager() {
      const listEl = qs('#cgpt-prompt-category-manage-list', root);

      if (!listEl) return;

      if (!categories.length) {
        listEl.innerHTML = renderEmptyState('暂无类别', 'cgpt-log-empty cgpt-empty-state');
        return;
      }

      listEl.innerHTML = categories.map((cat) => {
        const count = getPromptCategoryCount(cat.name);
        const locked = cat.name === '默认';

        return `
      <div class="cgpt-prompt-category-manage-item" data-category-id="${escapeHtml(cat.id)}">
        <div class="cgpt-prompt-category-manage-main">
          <div class="cgpt-prompt-category-manage-name">${escapeHtml(cat.name)}</div>
          <div class="cgpt-prompt-category-manage-meta">${count} Prompt</div>
        </div>

        <button type="button"
          class="cgpt-toolbox-small-btn"
          data-category-rename="${escapeHtml(cat.id)}">
          重命名
        </button>

        <button type="button"
          class="cgpt-toolbox-small-btn"
          data-category-delete="${escapeHtml(cat.id)}"
          ${locked ? 'disabled' : ''}>
          删除
        </button>
      </div>
    `;
      }).join('');
    }

    function addPromptCategory() {
      const input = qs('#cgpt-prompt-category-name', root);
      const name = normalizePromptCategoryName(input && input.value);

      if (!name) {
        setStatus('类别名称不能为空');
        return;
      }

      if (categories.some((cat) => cat.name === name)) {
        setStatus(`类别已存在：${name}`);
        return;
      }

      categories.push(createPromptCategory(name, categories.length));
      categories.sort((a, b) => Number(a.order) - Number(b.order));

      if (!savePromptManagerData()) {
        setStatus('保存失败：浏览器存储写入失败', 'error');
        return;
      }

      if (input) input.value = '';

      render();

      setStatus(`已新建类别：${name}`);
      notifyUploadQuickPromptsRefresh();
    }

    function renamePromptCategory(categoryId) {
      const cat = categories.find((x) => x.id === categoryId);

      if (!cat) {
        setStatus('类别不存在');
        return;
      }

      const oldName = cat.name;
      const nextName = normalizePromptCategoryName(
        window.prompt('工具箱名称', oldName),
      );

      if (!nextName) {
        setStatus('类别名称不能为空');
        return;
      }

      if (nextName !== oldName && categories.some((x) => x.name === nextName)) {
        setStatus(`类别已存在：${nextName}`);
        return;
      }

      cat.name = nextName;
      cat.updatedAt = nowMs();

      prompts.forEach((p) => {
        if (normalizePromptCategoryName(p.category) === oldName) {
          p.category = nextName;
          p.updatedAt = nowMs();
        }
      });

      if (activeCategory === oldName) {
        activeCategory = nextName;
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
      }

      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh();

      setStatus(`已重命名类别：${oldName} -> ${nextName}`);
    }

    function deletePromptCategory(categoryId) {
      const cat = categories.find((x) => x.id === categoryId);

      if (!cat) {
        setStatus('类别不存在');
        return;
      }

      if (cat.name === '默认') {
        setStatus('默认类别不能删除');
        return;
      }

      const count = getPromptCategoryCount(cat.name);

      const ok = window.confirm(
        `确定删除类别：${cat.name}”吗？该类别：${count} Prompt 会移动到“默认”。`,
      );

      if (!ok) return;

      prompts.forEach((p) => {
        if (normalizePromptCategoryName(p.category) === cat.name) {
          p.category = '默认';
          p.updatedAt = nowMs();
        }
      });

      categories = categories.filter((x) => x.id !== categoryId);

      if (!categories.some((x) => x.name === '默认')) {
        categories.unshift({
          id: 'default',
          name: '默认',
          order: 0,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
      }

      if (activeCategory === cat.name) {
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
      }

      if (!savePromptManagerData()) {
        setStatus('保存失败：浏览器存储写入失败', 'error');
        return;
      }

      render();
      notifyUploadQuickPromptsRefresh();

      setStatus(`已删除类别：${cat.name}，相关 Prompt 已移动到默认`);
    }

    applyPromptManagerData(loadPromptManagerData());

    function notifyUploadQuickPromptsRefresh() {
      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }
    }

    function commitPromptManagerChange(message, options = {}) {
      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh();

      if (options.closeEditor) {
        closeEditor();
      }

      if (message) {
        setStatus(message);
      }
    }

    function deletePromptById(promptId, options = {}) {
      const item = prompts.find((prompt) => prompt.id === promptId);

      if (!item) {
        setStatus('Prompt 不存在');
        return false;
      }

      if (options.confirm !== false) {
        const ok = window.confirm(`确定删除这个 Prompt 吗？\n\n${item.title}`);
        if (!ok) return false;
      }

      prompts = prompts.filter((prompt) => prompt.id !== promptId);
      commitPromptManagerChange(promptDeletedMessage(item.title), {
        closeEditor: options.closeEditor === true,
      });
      return true;
    }

    function reloadFromStorage() {
      applyPromptManagerData(loadPromptManagerData());
      searchKeyword = '';
      render();
      notifyUploadQuickPromptsRefresh();
    }

    function clearPromptStatus() {
      promptStatus.clear();
    }

    function setStatus(message, timeout) {
      const text = String(message || '').trim();

      if (/^\d+\s*条\s*[，,]\s*当前显示\s*\d+\s*条$/.test(text)) {
        clearPromptStatus();

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
          ToolboxShell.purgeForbiddenStatusBadge('prompt-local-stat-status');
        }

        return;
      }

      const ms = timeout == null ? 1800 : timeout;

      if (ms > 0) {
        promptStatus.set(text, 'info', { timeoutMs: ms });
      } else {
        promptStatus.set(text, 'info');
      }
    }

    function filteredPrompts() {
      const category = normalizeActiveCategory();
      const kw = searchKeyword.trim().toLowerCase();

      let list = prompts.slice();

      if (category !== '全部') {
        list = list.filter((item) => getPromptCategoryName(item) === category);
      }

      if (!kw) {
        return list;
      }

      return list.filter((item) => {
        const haystack = [
          item.title || '',
          item.category || '',
          item.content || '',
        ].join('\n').toLowerCase();

        return haystack.includes(kw);
      });
    }

    function renderCategoryBar() {
      if (!root) return;

      const bar = qs('#cgpt-prompt-category-bar', root);
      if (!bar) return;

      const filterCategories = getPromptCategoriesForFilter();
      const current = normalizeActiveCategory();

      bar.innerHTML = renderPromptCategoryChips(
        filterCategories.map((cat) => cat.name),
        current,
        (name) => getPromptCategoryCount(name),
        'data-prompt-category',
      );
    }

    function renderPromptSubtabs() {
      const tabs = qsa('[data-prompt-subtab]', root);
      tabs.forEach((btn) => {
        const name = btn.getAttribute('data-prompt-subtab');
        btn.classList.toggle('active', name === activePromptSubtab);
      });

      const listPanel = qs('#cgpt-prompt-list-panel', root);
      const categoryPanel = qs('#cgpt-prompt-category-panel', root);

      if (listPanel) {
        listPanel.style.display = activePromptSubtab === 'list' ? '' : 'none';
      }

      if (categoryPanel) {
        categoryPanel.style.display = activePromptSubtab === 'category' ? '' : 'none';
      }
    }

    function render() {
      if (!listEl) return;

      renderPromptSubtabs();

      if (activePromptSubtab === 'list') {
        renderCategoryBar();
      }

      if (activePromptSubtab === 'category') {
        renderCategoryManager();
        renderCategoryDatalist();
      }

      const items = filteredPrompts();
      listEl.innerHTML = '';

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'cgpt-hint';
        empty.style.padding = '16px 8px';
        empty.style.textAlign = 'center';
        empty.textContent = '没有匹配Prompt';
        listEl.appendChild(empty);
        clearPromptStatus();

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
          ToolboxShell.purgeForbiddenStatusBadge('prompt-render-empty');
        }

        return;
      }

      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'cgpt-prompt-item';
        row.dataset.id = item.id;

        const title = document.createElement('div');
        title.className = 'cgpt-prompt-title';
        title.textContent = item.title;

        const meta = document.createElement('div');
        meta.className = 'cgpt-prompt-meta';
        meta.textContent = `分类：${item.category || '默认'}｜字数：${String(item.content || '').length}`;

        const preview = document.createElement('div');
        preview.className = 'cgpt-prompt-preview';
        preview.textContent = item.content.replace(/\s+/g, ' ').slice(0, 140);

        row.appendChild(title);
        row.appendChild(meta);
        row.appendChild(preview);

        const actions = document.createElement('div');
        actions.className = 'cgpt-prompt-actions';

        const fillBtn = createActionButton('填入');
        fillBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          sendPrompt(item.content, false);
        });

        const sendBtn = createActionButton('发送', 'primary');
        sendBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void sendPrompt(item.content, true);
        });

        const copyBtn = createActionButton('复制');
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await copyTextToClipboard(item.content);
          if (ok) {
            setStatus(`已复制：${item.title}`);
          } else {
            setStatus('复制失败，请手动复制', 'error');
          }
        });

        const editBtn = createActionButton('编辑');
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditor(item.id);
        });

        const deleteBtn = createActionButton('删除');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deletePromptById(item.id);
        });

        const upBtn = createActionButton('↑');
        upBtn.title = '上移';
        upBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          movePrompt(item.id, -1);
        });

        const downBtn = createActionButton('↓');
        downBtn.title = '下移';
        downBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          movePrompt(item.id, 1);
        });

        actions.appendChild(fillBtn);
        actions.appendChild(sendBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        actions.appendChild(upBtn);
        actions.appendChild(downBtn);

        row.appendChild(actions);

        listEl.appendChild(row);
      }

      clearPromptStatus();

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
        ToolboxShell.purgeForbiddenStatusBadge('prompt-render-end');
      }
    }

    function createActionButton(text, type) {
      return createToolboxButton(text, {
        variant: type === 'primary' ? 'primary' : '',
        height: '28px',
        padding: '0 8px',
      });
    }

    function movePrompt(id, direction) {
      const index = prompts.findIndex((item) => item.id === id);
      if (index < 0) return;

      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prompts.length) return;

      const temp = prompts[index];
      prompts[index] = prompts[nextIndex];
      prompts[nextIndex] = temp;

      savePrompts();
      render();
      notifyUploadQuickPromptsRefresh();
      setStatus('已调整排序');
    }

    function openEditor(id) {
      editingPromptId = id;

      const item = prompts.find((prompt) => prompt.id === id) || null;
      const modalTitle = qs('#cgpt-prompt-editor-title', modalOverlay);
      const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
      const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
      const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);
      const deleteBtn = qs('#cgpt-prompt-delete-btn', modalOverlay);
      const duplicateBtn = qs('#cgpt-prompt-duplicate-btn', modalOverlay);

      if (item) {
        modalTitle.textContent = '编辑 Prompt';
        titleInput.value = item.title;
        categoryInput.value = item.category || '默认';
        contentInput.value = item.content;
        deleteBtn.style.display = '';
        duplicateBtn.style.display = '';
      } else {
        modalTitle.textContent = '新建 Prompt';
        titleInput.value = '';
        categoryInput.value = '默认';
        contentInput.value = '';
        deleteBtn.style.display = 'none';
        duplicateBtn.style.display = 'none';
      }

      renderCategoryDatalist();
      modalOverlay.style.display = 'flex';

      const modal = modalOverlay.querySelector('.cgpt-modal');
      restorePromptEditorModalPosition(modal, 'open-editor-modal');

      window.setTimeout(() => {
        titleInput.focus();
      }, 50);
    }

    function closeEditor() {
      if (modalOverlay) {
        modalOverlay.style.display = 'none';
      }

      editingPromptId = null;
    }

    function saveEditor() {
      const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
      const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
      const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);

      const title = String(titleInput.value || '').trim();
      const category = ensureCategoryExists(categoryInput.value);
      const content = String(contentInput.value || '');

      if (!title) {
        alert('标题不能为空');
        return;
      }

      if (!content.trim()) {
        alert('Prompt 内容不能为空');
        return;
      }

      const existing = prompts.find((item) => item.id === editingPromptId);

      if (existing) {
        existing.title = title;
        existing.category = category;
        existing.content = content;
        existing.updatedAt = nowMs();
      } else {
        prompts.unshift({
          id: createId('prompt'),
          title,
          category,
          content,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
      }

      commitPromptManagerChange(
        existing ? '已保存修改' : UiMessages.promptCreated,
        { closeEditor: true },
      );
    }

    function deleteCurrentPrompt() {
      if (!editingPromptId) return;
      deletePromptById(editingPromptId, { closeEditor: true });
    }

    function duplicateCurrentPrompt() {
      const item = prompts.find((prompt) => prompt.id === editingPromptId);
      if (!item) return;

      prompts.unshift({
        id: createId('prompt'),
        title: `${item.title} - 副本`,
        category: ensureCategoryExists(item.category),
        content: item.content,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      });

      commitPromptManagerChange(UiMessages.promptDuplicated, {
        closeEditor: true,
      });
    }

    function exportPrompts() {
      const data = {
        version: 4,
        exportedAt: new Date().toISOString(),
        prompts: prompts.slice(),
        categories: categories.slice(),
      };

      downloadJsonFile(`chatgpt-prompts-${buildDateStamp()}.json`, data);
      setStatus(UiMessages.promptExported);
    }

    async function importPrompts(event) {
      try {
        const data = await readJsonFileFromInput(event, {
          tag: '[PROMPT_IMPORT]',
        });

        if (!data) return;

        const importedData = normalizePromptManagerData(data);

        if (!importedData.prompts.length) {
          alert('导入失败：文件中没有有效 Prompt');
          return;
        }

        const replace = confirm(
          `读取 ${importedData.prompts.length} Prompt。\n\n点击“确定”：覆盖当前列表。\n点击“取消”：追加到当前列表。`,
        );

        if (replace) {
          prompts = importedData.prompts.map((item) => ({
            ...item,
            id: createId('prompt'),
            createdAt: nowMs(),
            updatedAt: nowMs(),
          }));
          categories = importedData.categories.map((cat) => ({
            ...cat,
            id: createId('cat'),
            createdAt: nowMs(),
            updatedAt: nowMs(),
          }));
        } else {
          const appended = importedData.prompts.map((item) => ({
            ...item,
            id: createId('prompt'),
            createdAt: nowMs(),
            updatedAt: nowMs(),
          }));

          prompts = [...appended, ...prompts];

          importedData.categories.forEach((cat) => {
            if (!categories.some((x) => x.name === cat.name)) {
              categories.push({
                ...cat,
                id: createId('cat'),
                createdAt: nowMs(),
                updatedAt: nowMs(),
              });
            }
          });
        }

        prompts.forEach((p) => {
          p.category = ensureCategoryExists(p.category);
        });

        categories.sort((a, b) => Number(a.order) - Number(b.order));
        savePromptManagerData();
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
        render();
        notifyUploadQuickPromptsRefresh();
        setStatus('导入完成');
      } catch (e) {
        const errText = getErrorText(e);
        console.error('[ChatGPT toolbox] Prompt import failed', e);
        alert(`导入失败：${errText}`);
      }
    }

    function resetDefaultPrompts() {
      const ok = confirm('确定重置为默认 Prompt 吗？当前所有自定义 Prompt 会被覆盖。');
      if (!ok) return;

      const defaults = normalizePromptManagerData(null);
      prompts = defaults.prompts;
      categories = defaults.categories;
      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh();
      setStatus('已重置为默认 Prompt');
    }

    async function sendPrompt(content, autoSend) {
      if (autoSend && sendLock) {
        setStatus('正在发送中，请勿重复点击');
        return;
      }

      const text = String(content || '').trim();

      if (!text) {
        setStatus('Prompt 内容为空', 'warn');
        return;
      }

      const existingText = ComposerApi.getComposerText();

      const compactCfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      if (existingText && existingText !== text && compactCfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(
          `ChatGPT 输入框已有 ${existingText.length} 个字符，是否覆盖？`,
        );

        if (!okReplace) {
          setStatus('已取消：未覆盖输入框草稿', 'warn');
          ToolboxShell.appendLog(
            `[Prompt 管理] 已阻止覆盖草稿 existing=${existingText.length} new=${text.length}`,
          );
          return;
        }
      } else if (existingText && existingText !== text) {
        ToolboxShell.appendLog(
          `[Prompt 管理] 自动覆盖草稿 existing=${existingText.length} new=${text.length}`,
        );
      }

      if (!autoSend) {
        const okSet = ComposerApi.setComposerValue(text);

        if (!okSet) {
          console.error('[ChatGPT toolbox] Prompt fill failed: composer not found');
          ToolboxShell.appendLog('[Prompt 管理] 填入失败：未找到输入框');
          alert('没有找到 ChatGPT 输入框。请确认当前页面是 ChatGPT 对话页面');
          return;
        }

        setStatus('已填入输入框，未自动发送');
        return;
      }

      sendLock = true;
      setStatus('正在发送 Prompt…');

      try {
        const sendResult = await sendContentViaComposer({
          source: 'prompt-manager',
          content: text,
          allowReplaceDraft: true,
          waitUntilSendable: true,
          timeoutMs: 60000,
          blockWhenResponding: true,
        });

        if (!sendResult.ok) {
          setStatus(`Prompt 发送失败：${sendResult.reason || 'unknown'}`, 'warn');
          ToolboxShell.appendLog(`[Prompt 管理] 发送失败：${sendResult.reason || 'unknown'}`);
          return;
        }

        setStatus(`已发送 Prompt：${sendResult.reason}`, 'success');
        ToolboxShell.appendLog(`[Prompt 管理] 已发送 Prompt reason=${sendResult.reason}`);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] Prompt send failed', err);
        setStatus(`Prompt 发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[Prompt 管理] 发送失败：${errText}`);
      } finally {
        sendLock = false;
      }
    }

    function repairPromptEditorCategoryField(editorRoot) {
      if (!editorRoot) return;

      const categoryInput = qs('#cgpt-prompt-edit-category', editorRoot);
      if (!(categoryInput instanceof HTMLInputElement)) return;

      const brokenPlaceholder = String(categoryInput.getAttribute('placeholder') || '');
      if (!brokenPlaceholder.includes('论>') && categoryInput.list === 'cgpt-prompt-category-options') {
        return;
      }

      categoryInput.setAttribute('placeholder', '例如：代码、Cursor、论文');
      categoryInput.setAttribute('list', 'cgpt-prompt-category-options');

      let datalist = qs('#cgpt-prompt-category-options', editorRoot);
      if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'cgpt-prompt-category-options';
        categoryInput.insertAdjacentElement('afterend', datalist);
      }
    }

    function readPromptEditorModalPosition() {
      const pos = MemoryManager.get(PROMPT_EDITOR_MODAL_POSITION_KEY, null);

      if (!pos || typeof pos !== 'object') {
        return null;
      }

      const left = Number(pos.left);
      const top = Number(pos.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
      }

      return {
        left,
        top,
      };
    }

    function savePromptEditorModalPosition(left, top, reason = '') {
      const next = {
        left: Math.round(Number(left) || 0),
        top: Math.round(Number(top) || 0),
        updatedAt: Date.now(),
      };

      MemoryManager.set(PROMPT_EDITOR_MODAL_POSITION_KEY, next);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[PROMPT_EDITOR_MODAL][position-save] reason=${reason || '-'} left=${next.left} top=${next.top}`,
        );
      }
    }

    function clampPromptEditorModalPosition(left, top, modal) {
      const margin = 8;
      const rect = modal && typeof modal.getBoundingClientRect === 'function'
        ? modal.getBoundingClientRect()
        : null;

      const width = rect && rect.width > 0 ? rect.width : 520;
      const height = rect && rect.height > 0 ? rect.height : 420;

      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const maxTop = Math.max(margin, window.innerHeight - height - margin);

      return {
        left: Math.max(margin, Math.min(Number(left) || margin, maxLeft)),
        top: Math.max(margin, Math.min(Number(top) || margin, maxTop)),
      };
    }

    function applyPromptEditorModalPosition(modal, left, top, reason = '') {
      if (!modal) {
        return;
      }

      const pos = clampPromptEditorModalPosition(left, top, modal);

      modal.style.position = 'fixed';
      modal.style.left = `${Math.round(pos.left)}px`;
      modal.style.top = `${Math.round(pos.top)}px`;
      modal.style.right = 'auto';
      modal.style.bottom = 'auto';
      modal.style.margin = '0';
      modal.style.transform = 'none';

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[PROMPT_EDITOR_MODAL][position-apply] reason=${reason || '-'} left=${Math.round(pos.left)} top=${Math.round(pos.top)}`,
        );
      }
    }

    function restorePromptEditorModalPosition(modal, reason = '') {
      if (!modal) {
        return;
      }

      const saved = readPromptEditorModalPosition();

      if (saved) {
        applyPromptEditorModalPosition(modal, saved.left, saved.top, reason || 'restore-saved');
        return;
      }

      const rect = modal.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width : 520;
      const height = rect && rect.height > 0 ? rect.height : 420;

      const left = Math.max(8, Math.round((window.innerWidth - width) / 2));
      const top = Math.max(8, Math.round((window.innerHeight - height) / 2));

      applyPromptEditorModalPosition(modal, left, top, reason || 'restore-center');
    }

    function bindPromptEditorModalDrag(modalOverlayEl) {
      const overlay = modalOverlayEl || modalOverlay;
      if (!overlay) {
        return;
      }

      const modal = overlay.querySelector('.cgpt-modal');
      const header = overlay.querySelector('.cgpt-modal-header');

      if (!modal || !header) {
        console.error('[ChatGPT toolbox] Prompt editor modal drag bind failed: missing modal/header');

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog('[PROMPT_EDITOR_MODAL][drag-bind-failed] missing modal/header');
        }

        return;
      }

      if (header.dataset.promptEditorDragBound === '1') {
        return;
      }

      header.dataset.promptEditorDragBound = '1';

      header.addEventListener('pointerdown', (event) => {
        if (event.button != null && event.button !== 0) {
          return;
        }

        const target = event.target instanceof HTMLElement ? event.target : null;

        if (
          target
          && target.closest('button,input,textarea,select,a,[contenteditable="true"]')
        ) {
          return;
        }

        const rect = modal.getBoundingClientRect();

        promptEditorDragState = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          moved: false,
        };

        try {
          header.setPointerCapture(event.pointerId);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.warn('[ChatGPT toolbox] prompt editor setPointerCapture failed', error);

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[PROMPT_EDITOR_MODAL][drag-capture-failed] error=${errText}`,
            );
          }
        }

        modal.classList.add('cgpt-modal-dragging');

        event.preventDefault();
        event.stopPropagation();
      });

      header.addEventListener('pointermove', (event) => {
        if (!promptEditorDragState) {
          return;
        }

        if (event.pointerId !== promptEditorDragState.pointerId) {
          return;
        }

        const dx = event.clientX - promptEditorDragState.startClientX;
        const dy = event.clientY - promptEditorDragState.startClientY;

        if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) {
          promptEditorDragState.moved = true;
        }

        if (!promptEditorDragState.moved) {
          return;
        }

        const nextLeft = promptEditorDragState.startLeft + dx;
        const nextTop = promptEditorDragState.startTop + dy;

        applyPromptEditorModalPosition(
          modal,
          nextLeft,
          nextTop,
          'dragging',
        );

        event.preventDefault();
        event.stopPropagation();
      });

      function finishDrag(event, reason) {
        if (!promptEditorDragState) {
          return;
        }

        const state = promptEditorDragState;
        promptEditorDragState = null;

        try {
          header.releasePointerCapture(state.pointerId);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.warn('[ChatGPT toolbox] prompt editor releasePointerCapture failed', error);

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[PROMPT_EDITOR_MODAL][drag-release-failed] reason=${reason || '-'} error=${errText}`,
            );
          }
        }

        modal.classList.remove('cgpt-modal-dragging');

        if (state.moved) {
          const rect = modal.getBoundingClientRect();
          const pos = clampPromptEditorModalPosition(rect.left, rect.top, modal);

          applyPromptEditorModalPosition(modal, pos.left, pos.top, reason || 'drag-end');
          savePromptEditorModalPosition(pos.left, pos.top, reason || 'drag-end');

          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
      }

      header.addEventListener('pointerup', (event) => {
        finishDrag(event, 'pointerup');
      });

      header.addEventListener('pointercancel', (event) => {
        finishDrag(event, 'pointercancel');
      });
    }

    function bindPromptEditorModalResize() {
      if (promptEditorResizeBound) {
        return;
      }

      promptEditorResizeBound = true;

      window.addEventListener('resize', () => {
        if (!modalOverlay) {
          return;
        }

        const modal = modalOverlay.querySelector('.cgpt-modal');

        if (!modal || modalOverlay.style.display === 'none' || modalOverlay.hidden) {
          return;
        }

        const rect = modal.getBoundingClientRect();
        const pos = clampPromptEditorModalPosition(rect.left, rect.top, modal);
        applyPromptEditorModalPosition(modal, pos.left, pos.top, 'window-resize');
      }, { passive: true });
    }

    function createEditorModal() {
      if (document.getElementById('cgpt-prompt-editor-overlay')) {
        modalOverlay = document.getElementById('cgpt-prompt-editor-overlay');
        repairPromptEditorCategoryField(modalOverlay);
        bindPromptEditorModalDrag(modalOverlay);
        restorePromptEditorModalPosition(
          modalOverlay.querySelector('.cgpt-modal'),
          'create-editor-modal-existing',
        );
        return;
      }

      modalOverlay = document.createElement('div');
      modalOverlay.id = 'cgpt-prompt-editor-overlay';
      modalOverlay.className = 'cgpt-modal-overlay';
      modalOverlay.innerHTML = `
        <div class="cgpt-modal">
          <div class="cgpt-modal-header">
            <div id="cgpt-prompt-editor-title">编辑 Prompt</div>
            <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-prompt-editor-close">关闭</button>
          </div>

          <div class="cgpt-modal-body">
            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-title">标题 / 按钮名称</label>
              <input class="cgpt-input" id="cgpt-prompt-edit-title" placeholder="例如：找 bug">
            </div>

            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-category">分类</label>
              <input class="cgpt-input" id="cgpt-prompt-edit-category" list="cgpt-prompt-category-options" placeholder="例如：代码、Cursor、论文">
              <datalist id="cgpt-prompt-category-options"></datalist>
            </div>

            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-content">Prompt 内容</label>
              <textarea class="cgpt-textarea" id="cgpt-prompt-edit-content" style="min-height:300px;" placeholder="请输入完Prompt..."></textarea>
            </div>
          </div>

          <div class="cgpt-modal-actions">
            <div class="cgpt-modal-actions-left">
              <button type="button" class="cgpt-btn danger" id="cgpt-prompt-delete-btn">删除</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-duplicate-btn">复制一份</button>
            </div>
            <div class="cgpt-modal-actions-right">
              <button type="button" class="cgpt-btn" id="cgpt-prompt-cancel-btn">取消</button>
              <button type="button" class="cgpt-btn primary" id="cgpt-prompt-save-btn">保存</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modalOverlay);

      const modal = modalOverlay.querySelector('.cgpt-modal');
      restorePromptEditorModalPosition(modal, 'create-editor-modal');
      bindPromptEditorModalDrag(modalOverlay);

      qs('#cgpt-prompt-editor-close', modalOverlay).addEventListener('click', closeEditor);
      qs('#cgpt-prompt-cancel-btn', modalOverlay).addEventListener('click', closeEditor);
      qs('#cgpt-prompt-save-btn', modalOverlay).addEventListener('click', saveEditor);
      qs('#cgpt-prompt-delete-btn', modalOverlay).addEventListener('click', deleteCurrentPrompt);
      qs('#cgpt-prompt-duplicate-btn', modalOverlay).addEventListener('click', duplicateCurrentPrompt);

      modalOverlay.addEventListener('mousedown', (event) => {
        if (event.target === modalOverlay) {
          closeEditor();
        }
      });
    }

    function bindEvents() {
      bindClick(root, '#cgpt-prompt-new-quick-btn', () => openEditor(null), {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-new-quick-btn',
      });
      bindClick(root, '#cgpt-prompt-export-btn', exportPrompts, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-export-btn',
      });
      bindClick(root, '#cgpt-prompt-import-btn', () => {
        if (importFileEl) importFileEl.click();
      }, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-import-btn',
      });
      bindClick(root, '#cgpt-prompt-reset-btn', resetDefaultPrompts, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-reset-btn',
      });

      if (importFileEl) {
        bindOnce(importFileEl, 'change', importPrompts);
      }

      if (searchEl) {
        bindOnce(searchEl, 'input', (event) => {
          searchKeyword = String(event.target.value || '').trim().toLowerCase();
          render();
        });
      }

      const categoryBar = qs('#cgpt-prompt-category-bar', root);
      if (categoryBar) {
        DomUtil.bindOnce(categoryBar, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-prompt-category]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activeCategory = btn.getAttribute('data-prompt-category') || '全部';

          MemoryManager.set(
            MemoryManager.KEYS.promptManagerActiveCategory,
            activeCategory,
          );

          render();
          setStatus(`已切换分类：${activeCategory}`);
        }, 'bound_prompt_category_bar_click');
      }

      const categoryAddBtn = qs('#cgpt-prompt-category-add', root);

      if (categoryAddBtn) {
        categoryAddBtn.addEventListener('click', () => {
          addPromptCategory();
        });
      }

      const categoryNameInput = qs('#cgpt-prompt-category-name', root);

      if (categoryNameInput) {
        categoryNameInput.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          addPromptCategory();
        });
      }

      const categoryManageList = qs('#cgpt-prompt-category-manage-list', root);

      if (categoryManageList) {
        categoryManageList.addEventListener('click', (e) => {
          const target = e.target instanceof HTMLElement ? e.target : null;

          if (!target) return;

          const renameBtn = target.closest('[data-category-rename]');

          if (renameBtn) {
            e.preventDefault();
            e.stopPropagation();
            renamePromptCategory(renameBtn.getAttribute('data-category-rename'));
            return;
          }

          const deleteBtn = target.closest('[data-category-delete]');

          if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            deletePromptCategory(deleteBtn.getAttribute('data-category-delete'));
          }
        });
      }

      const subtabBar = qs('#cgpt-prompt-subtabs', root);
      if (subtabBar) {
        subtabBar.addEventListener('click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-prompt-subtab]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activePromptSubtab = btn.getAttribute('data-prompt-subtab') || 'list';

          MemoryManager.set(
            MemoryManager.KEYS.promptManagerActiveSubtab,
            activePromptSubtab,
          );

          renderPromptSubtabs();

          if (activePromptSubtab === 'category') {
            renderCategoryManager();
            renderCategoryDatalist();
          }

          if (activePromptSubtab === 'list') {
            renderCategoryBar();
          }
        });
      }
    }

    const PROMPT_MODULE_HTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">Prompt 管理</div>
          <div id="cgpt-prompt-manage-tools" class="cgpt-grid-4" style="margin-top:8px;">
            <button type="button" class="cgpt-btn primary" id="cgpt-prompt-new-quick-btn">+ 新建 Prompt</button>
            <button type="button" class="cgpt-btn" id="cgpt-prompt-export-btn">导出</button>
            <button type="button" class="cgpt-btn" id="cgpt-prompt-import-btn">导入</button>
            <button type="button" class="cgpt-btn danger" id="cgpt-prompt-reset-btn">重置</button>
          </div>

          <div id="cgpt-prompt-subtabs" class="cgpt-prompt-subtabs">
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="list">Prompt 列表</button>
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="category">类别管理</button>
          </div>

          <div id="cgpt-prompt-list-panel" class="cgpt-prompt-panel">
            <div id="cgpt-prompt-category-bar" class="cgpt-prompt-category-bar"></div>
            <input id="cgpt-prompt-search" class="cgpt-input" placeholder="搜索标题、分类或内容..." style="margin-top:8px;">
            <div id="cgpt-prompt-list" class="cgpt-prompt-list" style="margin-top:8px;"></div>
            <div id="cgpt-prompt-status" class="cgpt-hint" style="margin-top:8px; display:none;"></div>
          </div>

          <div id="cgpt-prompt-category-panel" class="cgpt-prompt-panel" style="display:none;">
            <div class="cgpt-section" id="cgpt-prompt-category-manager" style="padding:10px; border:1px solid #2f3542; border-radius:10px;">
              <div class="cgpt-prompt-category-edit-row">
                <input class="cgpt-input" id="cgpt-prompt-category-name" placeholder="输入类别名称，例如：论文">
                <button type="button" class="cgpt-btn primary" id="cgpt-prompt-category-add">新建类别</button>
              </div>

              <div id="cgpt-prompt-category-manage-list" class="cgpt-prompt-category-manage-list"></div>
            </div>
          </div>

          <input id="cgpt-prompt-import-file" type="file" accept="application/json,.json" style="display:none;">
        </div>
      `;

    function mount(targetHost) {
      mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-prompt-module',
        moduleName: 'PROMPT',
        html: PROMPT_MODULE_HTML,
        onRefs: (mountedRoot) => {
          root = mountedRoot;
          listEl = qs('#cgpt-prompt-list', root);
          searchEl = qs('#cgpt-prompt-search', root);
          statusEl = qs('#cgpt-prompt-status', root);
          importFileEl = qs('#cgpt-prompt-import-file', root);
        },
        onBind: () => {
          createEditorModal();
          bindPromptEditorModalResize();
          bindEvents();
        },
        onRender: () => {
          activePromptSubtab = MemoryManager.get(
            MemoryManager.KEYS.promptManagerActiveSubtab,
            'list',
          );
          render();
        },
      });
    }

    return {
      mount,
      getPrompts: () => prompts.slice(),
      reloadFromStorage,
      getPromptCategoryName,
      getPromptCategoriesFromList,
      exportData: () => ({
        version: 4,
        exportedAt: new Date().toISOString(),
        prompts: prompts.slice(),
        categories: categories.slice(),
      }),
    };
  })();

  /********************************************************************
   * 5b. SettingsModule：精简模式与工具箱设置
   ********************************************************************/

  function renderPromptCheckboxList(promptList, selectedIds) {
    const list = Array.isArray(promptList) ? promptList : [];
    const selected = new Set(
      Array.isArray(selectedIds)
        ? selectedIds.map((id) => String(id))
        : [],
    );

    if (!list.length) {
      return '<div class="cgpt-log-empty">暂无 Prompt</div>';
    }

    return list.map((prompt) => {
      const id = String(prompt && prompt.id ? prompt.id : '');
      const title = String(prompt && prompt.title ? prompt.title : '未命名');
      const category = String(prompt && prompt.category ? prompt.category : '默认');
      const checked = selected.has(id) ? ' checked' : '';

      return `
      <label class="cgpt-setting-prompt-checkbox">
        <input
          type="checkbox"
          data-compact-prompt-id="${escapeHtml(id)}"
          ${checked}
        >
        <span>${escapeHtml(title)}</span>
        <small>${escapeHtml(category)}</small>
      </label>
    `;
    }).join('');
  }

  const SettingsModule = (() => {
    let host = null;
    let root = null;
    let activeSettingsSubtab = 'basic';

    function getConfig() {
      const saved = MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {};
      const cfg = normalizeCompactUiConfig(saved);

      if (saved && !saved.quickPromptActionVersion && saved.quickPromptClickAction === 'fill') {
        cfg.quickPromptClickAction = 'send';
        cfg.quickPromptActionVersion = 1;
        MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
        return normalizeCompactUiConfig(cfg);
      }

      return cfg;
    }

    function saveConfig(next) {
      const cfg = normalizeCompactUiConfig(next || {});
      cfg.quickPromptActionVersion = 1;
      MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);

      ToolboxShell.appendLog(
        `[SETTINGS][quickPrompt] upload=${cfg.showUploadQuickPrompts !== false} compact=${cfg.showCompactQuickPrompts !== false} confirmOverwrite=${cfg.confirmPromptDraftOverwrite ? 1 : 0} selected=${(cfg.quickPromptIds || []).length}`,
      );

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }
    }

    function readFromUi() {
      const current = getConfig();

      const quickPromptIds = qsa('[data-compact-prompt-id]', root)
        .filter((x) => x.checked)
        .map((x) => x.getAttribute('data-compact-prompt-id'))
        .filter(Boolean);

      const uploadQuickEl = qs('#cgpt-setting-upload-show-quick-prompts', root);
      const compactQuickEl = qs('#cgpt-setting-compact-show-quick-prompts', root);

      const showUploadQuickPrompts = uploadQuickEl
        ? !!uploadQuickEl.checked
        : current.showUploadQuickPrompts !== false;

      const showCompactQuickPrompts = compactQuickEl
        ? !!compactQuickEl.checked
        : current.showCompactQuickPrompts !== false;

      return {
        showUploadGroups: !!qs(SettingsSelectors.showUploadGroups, root)?.checked,
        showUploadStartButton: !!qs(SettingsSelectors.showUploadStart, root)?.checked,
        showUploadFileList: !!qs(SettingsSelectors.showFileList, root)?.checked,
        showUploadQuickPrompts,
        showCompactQuickPrompts,
        quickPromptClickAction: qs('#cgpt-setting-compact-prompt-action', root)?.value || 'send',
        confirmPromptDraftOverwrite: !!qs('#cgpt-setting-confirm-prompt-draft-overwrite', root)?.checked,
        quickPromptActiveCategory: current.quickPromptActiveCategory || '全部',
        quickPromptIds,
        globalDropCaptureEnabled: !!qs('#cgpt-setting-global-drop-capture', root)?.checked,
        restoreScrollAfterCopyLastMessage: !!qs('#cgpt-setting-restore-scroll-after-copy', root)?.checked,
      };
    }

    function renderSettingsSubtabs() {
      if (!root) return;

      const tabs = qsa('[data-settings-subtab]', root);
      const panels = qsa('[data-settings-panel]', root);

      tabs.forEach((btn) => {
        const name = btn.getAttribute('data-settings-subtab') || 'basic';
        btn.classList.toggle('active', name === activeSettingsSubtab);
      });

      panels.forEach((panelEl) => {
        const name = panelEl.getAttribute('data-settings-panel') || 'basic';
        panelEl.style.display = name === activeSettingsSubtab ? '' : 'none';
      });
    }

    function render() {
      if (!root) return;

      renderSettingsSubtabs();

      const cfg = getConfig();

      const groupsEl = qs('#cgpt-setting-compact-show-upload-groups', root);
      if (groupsEl) groupsEl.checked = !!cfg.showUploadGroups;

      const startEl = qs('#cgpt-setting-compact-show-upload-start', root);
      if (startEl) startEl.checked = !!cfg.showUploadStartButton;

      const fileListEl = qs('#cgpt-setting-compact-show-file-list', root);
      if (fileListEl) fileListEl.checked = !!cfg.showUploadFileList;

      const uploadQuickEl = qs('#cgpt-setting-upload-show-quick-prompts', root);
      if (uploadQuickEl) {
        uploadQuickEl.checked = cfg.showUploadQuickPrompts !== false;
      }

      const quickEl = qs('#cgpt-setting-compact-show-quick-prompts', root);
      if (quickEl) {
        quickEl.checked = cfg.showCompactQuickPrompts !== false;
      }

      const actionEl = qs('#cgpt-setting-compact-prompt-action', root);
      if (actionEl) actionEl.value = cfg.quickPromptClickAction || 'send';

      const confirmPromptDraftOverwriteEl = qs('#cgpt-setting-confirm-prompt-draft-overwrite', root);
      if (confirmPromptDraftOverwriteEl) {
        confirmPromptDraftOverwriteEl.checked = cfg.confirmPromptDraftOverwrite === true;
      }

      const globalDropEl = qs('#cgpt-setting-global-drop-capture', root);
      if (globalDropEl) globalDropEl.checked = !!cfg.globalDropCaptureEnabled;

      const restoreScrollEl = qs('#cgpt-setting-restore-scroll-after-copy', root);
      if (restoreScrollEl) {
        restoreScrollEl.checked = cfg.restoreScrollAfterCopyLastMessage === true;
      }

      const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);
      if (edgeAutoHideEl) {
        edgeAutoHideEl.checked = MemoryManager.get(MemoryManager.KEYS.edgeAutoHideEnabled, false) === true;
      }

      const beepCfg = getBeepConfig();
      const beepCopySuccessEl = qs('#cgpt-setting-beep-copy-success-enabled', root);
      if (beepCopySuccessEl) {
        beepCopySuccessEl.checked = beepCfg.copySuccessEnabled !== false;
      }

      const beepVolumeEl = qs('#cgpt-setting-beep-volume', root);
      if (beepVolumeEl) {
        beepVolumeEl.value = String(beepCfg.volume);
      }

      const beepDurationEl = qs('#cgpt-setting-beep-duration', root);
      if (beepDurationEl) {
        beepDurationEl.value = String(beepCfg.durationMs);
      }

      const beepFrequencyEl = qs('#cgpt-setting-beep-frequency', root);
      if (beepFrequencyEl) {
        beepFrequencyEl.value = String(beepCfg.frequency);
      }

      const promptListEl = qs('#cgpt-setting-compact-prompt-list', root);

      if (promptListEl) {
        const promptList = typeof PromptManagerModule !== 'undefined'
          && typeof PromptManagerModule.getPrompts === 'function'
          ? PromptManagerModule.getPrompts()
          : [];

        promptListEl.innerHTML = renderPromptCheckboxList(
          promptList,
          cfg.quickPromptIds || [],
        );
      }
    }

    function renderShortcutSettings() {
      if (!host) {
        return;
      }

      const cfg = getShortcutConfig();

      const map = [
        {
          action: 'sendMessage',
          enabledId: 'cgpt-shortcut-send-enabled',
          labelId: 'cgpt-shortcut-send-label',
        },
        {
          action: 'copyLastMessage',
          enabledId: 'cgpt-shortcut-copy-enabled',
          labelId: 'cgpt-shortcut-copy-label',
        },
        {
          action: 'startUpload',
          enabledId: 'cgpt-shortcut-upload-enabled',
          labelId: 'cgpt-shortcut-upload-label',
        },
      ];

      map.forEach((item) => {
        const data = cfg[item.action];
        const enabledEl = qs(`#${item.enabledId}`, host);
        const labelEl = qs(`#${item.labelId}`, host);

        if (enabledEl) {
          enabledEl.checked = data.enabled !== false;
        }

        if (labelEl) {
          labelEl.value = data.label || '未设置';
        }
      });
    }

    function bindEvents() {
      function updateShortcutAction(action, patch) {
        const cfg = getShortcutConfig();
        const oldActionConfig = cloneShortcutItem(
          cfg[action],
          DEFAULT_SHORTCUT_CONFIG[action],
        );

        cfg[action] = Object.assign(
          {},
          cfg[action] || {},
          patch || {},
        );

        const conflict = findShortcutConflict(cfg, action);

        if (conflict) {
          cfg[action] = oldActionConfig;

          renderShortcutSettings();
          applyUploadShortcutButtonTitles();

          ToolboxShell.appendLog(
            `[SETTINGS][shortcut-conflict-blocked] action=${action} conflict=${conflict}`,
          );
          ToolboxShell.setStatus(
            `快捷键冲突，已取消保存：${oldActionConfig.label || cfg[action].label || ''}`,
            'warn',
            {
              persist: true,
              shortText: '冲突',
            },
          );
          return;
        }

        saveShortcutConfig(cfg);
        renderShortcutSettings();
        applyUploadShortcutButtonTitles();

        ToolboxShell.appendLog(
          `[SETTINGS][shortcut] action=${action} label=${cfg[action].label || '-'} enabled=${cfg[action].enabled !== false ? '1' : '0'}`
        );
      }

      function bindShortcutEnabled(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('change', () => {
          updateShortcutAction(action, {
            enabled: !!el.checked,
          });
        });
      }

      function bindShortcutClear(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('click', () => {
          updateShortcutAction(action, {
            enabled: false,
            label: '',
            key: '',
            code: '',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
          });
        });
      }

      function bindShortcutRecord(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('click', () => {
          const oldText = el.textContent;
          el.textContent = '按下快捷键...';
          let recordTimer = 0;

          const cleanupRecordListener = () => {
            if (recordTimer) {
              window.clearTimeout(recordTimer);
              recordTimer = 0;
            }

            document.removeEventListener('keydown', onKeyDown, true);
          };

          const onKeyDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') {
              cleanupRecordListener();
              el.textContent = oldText || '录制';
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:cancel] action=${action}`);
              return;
            }

            const next = shortcutItemFromEvent(e);

            if (next.pureModifier) {
              ToolboxShell.appendLog(
                `[SETTINGS][shortcut-record:wait-main-key] action=${action} key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? 1 : 0} alt=${e.altKey ? 1 : 0} shift=${e.shiftKey ? 1 : 0} meta=${e.metaKey ? 1 : 0}`,
              );
              el.textContent = '继续按主键...';
              return;
            }

            if (!next.key && !next.code) {
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:skip] action=${action} reason=empty-key`);
              el.textContent = oldText || '录制';
              cleanupRecordListener();
              return;
            }

            if (!next.label) {
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:skip] action=${action} reason=empty-label`);
              el.textContent = oldText || '录制';
              cleanupRecordListener();
              return;
            }

            cleanupRecordListener();

            const shortcutData = {
              enabled: next.enabled,
              label: next.label,
              key: next.key,
              code: next.code,
              ctrl: next.ctrl,
              alt: next.alt,
              shift: next.shift,
              meta: next.meta,
            };

            updateShortcutAction(action, shortcutData);

            ToolboxShell.appendLog(
              `[SETTINGS][shortcut-record:ok] action=${action} label=${next.label}`,
            );

            el.textContent = oldText || '录制';
          };

          recordTimer = window.setTimeout(() => {
            recordTimer = 0;
            el.textContent = oldText || '录制';
            document.removeEventListener('keydown', onKeyDown, true);
            ToolboxShell.appendLog(`[SETTINGS][shortcut-record:timeout] action=${action}`);
          }, 8000);

          document.addEventListener('keydown', onKeyDown, true);
        });
      }

      bindShortcutEnabled('cgpt-shortcut-send-enabled', 'sendMessage');
      bindShortcutEnabled('cgpt-shortcut-copy-enabled', 'copyLastMessage');
      bindShortcutEnabled('cgpt-shortcut-upload-enabled', 'startUpload');

      bindShortcutRecord('cgpt-shortcut-send-record', 'sendMessage');
      bindShortcutRecord('cgpt-shortcut-copy-record', 'copyLastMessage');
      bindShortcutRecord('cgpt-shortcut-upload-record', 'startUpload');

      bindShortcutClear('cgpt-shortcut-send-clear', 'sendMessage');
      bindShortcutClear('cgpt-shortcut-copy-clear', 'copyLastMessage');
      bindShortcutClear('cgpt-shortcut-upload-clear', 'startUpload');

      const resetShortcutBtn = qs('#cgpt-shortcut-reset-defaults', root);
      if (resetShortcutBtn) {
        resetShortcutBtn.addEventListener('click', () => {
          resetShortcutConfig();
          renderShortcutSettings();
          applyUploadShortcutButtonTitles();
          ToolboxShell.appendLog('[SETTINGS][shortcut-reset-defaults]');
        });
      }

      const onCompactSettingChange = () => {
        const cfg = readFromUi();
        saveConfig(cfg);
        render();
      };

      [
        '#cgpt-setting-compact-show-upload-groups',
        '#cgpt-setting-compact-show-upload-start',
        '#cgpt-setting-compact-show-file-list',
        '#cgpt-setting-upload-show-quick-prompts',
        '#cgpt-setting-compact-show-quick-prompts',
        '#cgpt-setting-global-drop-capture',
        '#cgpt-setting-restore-scroll-after-copy',
        '#cgpt-setting-compact-prompt-action',
        '#cgpt-setting-confirm-prompt-draft-overwrite',
      ].forEach((selector) => {
        bindSettingChange(root, selector, onCompactSettingChange, {
          moduleName: 'SETTINGS',
        });
      });

      const listEl = qs('#cgpt-setting-compact-prompt-list', root);
      if (listEl) {
        listEl.addEventListener('change', (e) => {
          const target = e.target;
          if (!(target instanceof HTMLInputElement)) return;
          if (!target.matches('[data-compact-prompt-id]')) return;

          const cfg = readFromUi();
          saveConfig(cfg);
          render();
        });
      }

      const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);

      if (edgeAutoHideEl) {
        edgeAutoHideEl.addEventListener('change', () => {
          const enabled = !!edgeAutoHideEl.checked;

          if (typeof ToolboxShell.setEdgeAutoHideEnabled === 'function') {
            ToolboxShell.setEdgeAutoHideEnabled(enabled);
          } else {
            MemoryManager.set(MemoryManager.KEYS.edgeAutoHideEnabled, enabled);
            ToolboxShell.appendLog(
              `[SETTINGS][edgeAutoHide] ${enabled ? '已开启' : '已关闭'}，但 ToolboxShell.setEdgeAutoHideEnabled 不存在`,
            );
          }

          render();
        });
      }

      const resetPosBtn = qs('#cgpt-setting-reset-toolbox-position', root);
      if (resetPosBtn) {
        resetPosBtn.addEventListener('click', () => {
          if (typeof ToolboxShell.resetToolboxPosition === 'function') {
            ToolboxShell.resetToolboxPosition();
          } else {
            ToolboxShell.appendLog('[SETTINGS][reset-position] ToolboxShell.resetToolboxPosition 不存在');
          }
        });
      }

      const forceShowBtn = qs('#cgpt-setting-force-show-toolbox', root);
      bindOnce(forceShowBtn, 'click', () => {
          if (typeof ToolboxShell.restoreToolboxFromHiddenState === 'function') {
            ToolboxShell.restoreToolboxFromHiddenState('settings-force-show');
          } else if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.__cgptToolboxShow === 'function') {
            unsafeWindow.__cgptToolboxShow();
          } else if (typeof window.__cgptToolboxShow === 'function') {
            window.__cgptToolboxShow();
          } else {
            ToolboxShell.appendLog('[SETTINGS][force-show-toolbox] restoreToolboxFromHiddenState 不存在');
          }

          if (typeof ToolboxShell.resetToolboxPosition === 'function') {
            ToolboxShell.resetToolboxPosition();
          }

          ToolboxShell.appendLog('[SETTINGS][force-show-toolbox]');
      });

      function readBeepFromUi() {
        const volumeEl = qs('#cgpt-setting-beep-volume', root);
        const durationEl = qs('#cgpt-setting-beep-duration', root);
        const frequencyEl = qs('#cgpt-setting-beep-frequency', root);
        const current = getBeepConfig();

        return normalizeBeepConfig({
          ...current,
          volume: volumeEl ? Number(volumeEl.value) : current.volume,
          durationMs: durationEl ? Number(durationEl.value) : current.durationMs,
          frequency: frequencyEl ? Number(frequencyEl.value) : current.frequency,
          type: current.type,
        });
      }

      function bindBeepSettingInput(id) {
        const el = qs(`#${id}`, root);
        bindOnce(el, 'change', () => {
          const cfg = readBeepFromUi();
          saveBeepConfig(cfg);
          ToolboxShell.appendLog(
            `[SETTINGS][beep] volume=${cfg.volume} durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
          );
        });
      }

      bindBeepSettingInput('cgpt-setting-beep-volume');
      bindBeepSettingInput('cgpt-setting-beep-duration');
      bindBeepSettingInput('cgpt-setting-beep-frequency');

      const beepCopySuccessEl = qs('#cgpt-setting-beep-copy-success-enabled', root);
      bindOnce(beepCopySuccessEl, 'change', () => {
        const current = getBeepConfig();
        const cfg = saveBeepConfig({
          ...current,
          copySuccessEnabled: beepCopySuccessEl.checked !== false,
        });

        ToolboxShell.appendLog(
          `[SETTINGS][beep-copy-success] enabled=${cfg.copySuccessEnabled !== false ? '1' : '0'}`,
        );
      }, {
        key: 'change:beep-copy-success-enabled',
        moduleName: 'SETTINGS',
      });

      const settingsBeepRefs = collectDomRefs(root, {
        testBeep: {
          selector: '#cgpt-setting-test-beep',
          required: false,
        },
        testTitleFlash: {
          selector: '#cgpt-setting-test-title-flash',
          required: false,
        },
        beepStatus: {
          selector: '#cgpt-setting-beep-status',
          required: false,
        },
      }, {
        moduleName: 'SETTINGS',
      });

      bindOnce(settingsBeepRefs.testBeep, 'click', async () => {
          const statusEl = settingsBeepRefs.beepStatus;

          if (statusEl) {
            statusEl.textContent = '正在测试...';
          }

          const cfg = saveBeepConfig(readBeepFromUi());

          ToolboxShell.appendLog(
            `[SETTINGS][beep-test] start volume=${cfg.volume} durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
          );

          const unlocked = await unlockToolboxAudio('settings-test');

          if (!unlocked) {
            if (statusEl) {
              statusEl.textContent = '测试失败：浏览器音频未解锁';
            }

            ToolboxShell.appendLog('[SETTINGS][beep-test] failed reason=unlock-failed');
            return;
          }

          const ok = await playToolboxBeep('settings-test', {
            volume: cfg.volume,
            durationMs: cfg.durationMs,
            frequency: cfg.frequency,
            type: cfg.type,
          });

          if (statusEl) {
            statusEl.textContent = ok
              ? '已播放测试蜂鸣'
              : '测试失败，请查看日志';
          }

          ToolboxShell.appendLog(`[SETTINGS][beep-test] result=${ok ? 'ok' : 'failed'}`);
      });

      bindOnce(settingsBeepRefs.testTitleFlash, 'click', () => {
        const statusEl = settingsBeepRefs.beepStatus;

        if (
          typeof TitlePrefixModule !== 'undefined'
          && typeof TitlePrefixModule.startReplyDoneFlash === 'function'
        ) {
          TitlePrefixModule.startReplyDoneFlash('settings-test');

          if (statusEl) {
            statusEl.textContent = '已开始测试标题闪烁';
          }

          ToolboxShell.appendLog('[SETTINGS][title-flash-test] start');
          return;
        }

        if (statusEl) {
          statusEl.textContent = '测试失败：标题闪烁模块不可用';
        }

        ToolboxShell.appendLog('[SETTINGS][title-flash-test] failed reason=module-missing');
      });

      const settingsSubtabs = qs('#cgpt-settings-subtabs', root);
      bindOnce(settingsSubtabs, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-settings-subtab]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activeSettingsSubtab = btn.getAttribute('data-settings-subtab') || 'basic';
          MemoryManager.set('settingsActiveSubtab', activeSettingsSubtab);
          renderSettingsSubtabs();

          ToolboxShell.appendLog(`[SETTINGS][subtab] active=${activeSettingsSubtab}`);
      });
    }

    function mount(target) {
      host = target;
      if (!host) return;

      host.innerHTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">设置</div>

          <div class="cgpt-settings-subtabs" id="cgpt-settings-subtabs">
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="basic">基础</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="shortcut">快捷键</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="ui">界面</button>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="basic">
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-edge-auto-hide">
              工具箱贴边自动隐藏
            </label>
            <div class="cgpt-hint">开启后，拖动工具箱贴住浏览器右边缘后自动收起，只保留边缘把手；只是靠近边缘不会隐藏。关闭后只保留普通拖拽，不自动隐藏。</div>

            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn" id="cgpt-setting-reset-toolbox-position">重置工具箱位置</button>
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-force-show-toolbox">强制显示工具箱</button>
            </div>
            <div class="cgpt-hint">当工具箱跑出屏幕、贴边状态异常或隐藏后找不到入口时，可先点「强制显示工具箱」，再按需重置位置。</div>

            <div class="cgpt-section-title" style="margin-top: 12px;">蜂鸣器</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-beep-copy-success-enabled">
              复制成功后播放蜂鸣器
            </label>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-volume">音量</label>
              <input type="range" class="cgpt-input" id="cgpt-setting-beep-volume" min="0.05" max="1" step="0.05">
            </div>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-duration">时长 (毫秒)</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-beep-duration" min="30" max="10000" step="10">
            </div>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-frequency">频率 (Hz)</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-beep-frequency" min="80" max="6000" step="10">
            </div>
            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-test-beep">测试蜂鸣器</button>
              <button type="button" class="cgpt-btn" id="cgpt-setting-test-title-flash">测试标题闪烁</button>
              <span class="cgpt-hint" id="cgpt-setting-beep-status">未测试</span>
            </div>
            <div class="cgpt-hint">蜂鸣器用于复制成功提醒；浏览器可能要求先点击页面或工具箱一次后才允许播放声音。</div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="shortcut">
            <div class="cgpt-hint">
              点击录制后，按下完整快捷键。例如：Ctrl+Alt+C。只按 Ctrl/Alt/Shift 不会保存，需再按一个主键。按 Esc 可取消。
            </div>

            <div class="cgpt-shortcut-settings">
              <div class="cgpt-shortcut-row" data-shortcut-action="sendMessage">
                <label class="cgpt-checkbox-line">
                  <input type="checkbox" id="cgpt-shortcut-send-enabled">
                  启用发送信息快捷键
                </label>
                <input id="cgpt-shortcut-send-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-send-record">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-send-clear">清空</button>
              </div>

              <div class="cgpt-shortcut-row" data-shortcut-action="copyLastMessage">
                <label class="cgpt-checkbox-line">
                  <input type="checkbox" id="cgpt-shortcut-copy-enabled">
                  启用复制最后回复快捷键
                </label>
                <input id="cgpt-shortcut-copy-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-record">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-clear">清空</button>
              </div>

              <div class="cgpt-shortcut-row" data-shortcut-action="startUpload">
                <label class="cgpt-checkbox-line">
                  <input type="checkbox" id="cgpt-shortcut-upload-enabled">
                  启用开始上传快捷键
                </label>
                <input id="cgpt-shortcut-upload-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-upload-record">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-upload-clear">清空</button>
              </div>

              <div class="cgpt-row">
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-reset-defaults">
                  恢复默认快捷键
                </button>
              </div>
            </div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="ui">
            <div class="cgpt-section-title" style="margin-top: 4px;">精简模式显示内容</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-upload-groups">
              显示上传分组切换
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-upload-start">
              显示上传按钮
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-file-list">
              显示上传文件列表
            </label>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-upload-show-quick-prompts">
              上传页显示常用 Prompt 快捷区
            </label>
            <div class="cgpt-hint">开启后，在多文件上传页显示常用 Prompt 快捷按钮。</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-quick-prompts">
              精简模式显示常用 Prompt 快捷区
            </label>

            <div class="cgpt-kv">
              <label>Prompt 动作</label>
              <select class="cgpt-select" id="cgpt-setting-compact-prompt-action">
                <option value="send">填入并发送</option>
                <option value="fill">只填入输入框</option>
              </select>
            </div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-confirm-prompt-draft-overwrite">
              覆盖输入框草稿前弹窗确认
            </label>
            <div class="cgpt-hint">关闭时，点击常用 Prompt 或 Prompt 管理发送会直接覆盖输入框已有内容，不再弹出浏览器确认框。</div>

            <div class="cgpt-section-title" style="margin-top: 10px;">常用 Prompt 快捷区</div>
            <div class="cgpt-hint">选择要显示在上传页快捷区域的 Prompt。点击后默认填入并发送到 ChatGPT，也可改为只填入输入框。</div>
            <div id="cgpt-setting-compact-prompt-list" class="cgpt-settings-prompt-list"></div>

            <div class="cgpt-section-title" style="margin-top: 10px;">拖拽上传</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-global-drop-capture">
              页面空白处拖入文件时加入工具箱队列
            </label>
            <div class="cgpt-hint">拖到 ChatGPT 输入框仍由 ChatGPT 原生处理；拖到工具箱面板内始终加入队列。</div>

            <div class="cgpt-section-title" style="margin-top: 10px;">复制回复</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-restore-scroll-after-copy">
              复制最后消息后恢复原滚动位置
            </label>
          </div>
        </div>
      `;

      root = host;

      collectDomRefs(root, {
        subtabs: '#cgpt-settings-subtabs',
        testBeep: {
          selector: '#cgpt-setting-test-beep',
          required: false,
        },
        beepStatus: {
          selector: '#cgpt-setting-beep-status',
          required: false,
        },
      }, {
        moduleName: 'SETTINGS',
      });

      activeSettingsSubtab = MemoryManager.get('settingsActiveSubtab', 'basic');
      bindEvents();
      render();
      renderShortcutSettings();
      renderSettingsSubtabs();
    }

    return {
      mount,
      getConfig,
      saveConfig,
    };
  })();

  /********************************************************************
   * 6. BridgeModule：浏览器桥接模   ********************************************************************/

  const BridgeModule = (() => {
    const DEFAULT_BRIDGE_BASE_URL = 'http://127.0.0.1:5000';
    const DEFAULT_BRIDGE_PATH = '/api/bridge';
    const SOURCE = 'tampermonkey';
    const SCRIPT_VERSION = 'merged-bridge-1.0.0';
    const CLIENT_ID_KEY = 'tm_bridge_client_id';
    const PAGE_INSTANCE_ID = getToolboxPageInstanceId();

    const state = {
      root: null,
      timerId: 0,
      bridgeRunId: 0,
      polling: false,
      handlingMessageId: null,
      lastBusyHeartbeatAt: 0,
      lastIdentityKey: '',
      lastIdentityLogKey: '',
      pendingIdentityOldKey: '',
      pendingIdentityReason: '',
      pageIdentityListenersInstalled: false,
      lastErrorLogAt: 0,
      lastErrorText: '',
      uploadBlockNextChatReason: '',
      uploadBlockNextChatAt: 0,
      uploadBlockNextChatSourceMessageId: '',
    };

    const bridgeTimers = createTimerRegistry('BRIDGE');

    const bridgeStatus = createModuleStatus('BRIDGE', {
      getLocalEl: () => (state.root ? qs('#cgpt-bridge-status', state.root) : null),
      useGlobal: false,
      useLog: false,
    });

    const CLIENT_ID = (() => {
      try {
        const saved = sessionStorage.getItem(CLIENT_ID_KEY);
        if (saved) return saved;
        const created = `tm-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(CLIENT_ID_KEY, created);
        return created;
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const tempId = `tm-${Math.random().toString(36).slice(2, 10)}`;

        console.error('[BridgeModule] 无法使用 sessionStorage，使用临时 CLIENT_ID:', error);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][CLIENT_ID][TEMP] type=${errName} client_id=${tempId} error=${errText}`,
          );
        }

        return tempId;
      }
    })();

    function getBridgePageKey() {
      return `${CLIENT_ID}::${PAGE_INSTANCE_ID}`;
    }

    function buildVisibilityPayload() {
      const visibilityState = document.visibilityState || 'unknown';
      const hasFocus = document.hasFocus();

      return {
        visibility_state: visibilityState,
        has_focus: hasFocus,
      };
    }

    function getConfig() {
      return {
        bridgeEnabled: !!MemoryManager.get('bridgeEnabled', true),
        bridgeBaseUrl: normalizeBridgeBaseUrl(MemoryManager.get('bridgeBaseUrl', DEFAULT_BRIDGE_BASE_URL)),
        bridgePath: normalizeBridgePath(MemoryManager.get('bridgePath', DEFAULT_BRIDGE_PATH)),
        bridgeApiToken: String(MemoryManager.get('bridgeApiToken', '') || '').trim(),
        bridgeDebugEnabled: !!MemoryManager.get('bridgeDebugEnabled', false),
        bridgeRequestTimeoutMs: Number(MemoryManager.get('bridgeRequestTimeoutMs', 30000)) || 30000,
        bridgePollIntervalMs: Number(MemoryManager.get('bridgePollIntervalMs', 1000)) || 1000,
      };
    }

    function saveConfig(patch) {
      Object.keys(patch || {}).forEach((key) => {
        MemoryManager.set(key, patch[key]);
      });
    }

    function normalizeBridgeBaseUrl(value) {
      let text = String(value || '').trim();
      if (!text) return DEFAULT_BRIDGE_BASE_URL;
      text = text.replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(text)) {
        text = `http://${text}`;
      }
      return text;
    }

    function normalizeBridgePath(value) {
      const text = String(value || DEFAULT_BRIDGE_PATH).trim();
      return text.startsWith('/') ? text : `/${text}`;
    }

    function getBridgeUrl() {
      const cfg = getConfig();
      return `${cfg.bridgeBaseUrl}${cfg.bridgePath}`;
    }

    function logBridgeError(text, errorObj) {
      const now = Date.now();
      const content = String(text || 'unknown_error');
      const shouldLog = content !== state.lastErrorText || (now - state.lastErrorLogAt) >= 5000;
      if (!shouldLog) return;
      state.lastErrorText = content;
      state.lastErrorLogAt = now;
      if (errorObj) {
        console.error('[BridgeModule]', content, errorObj);
      } else {
        console.error('[BridgeModule]', content);
      }
      ToolboxShell.appendLog(`[BRIDGE][ERROR] ${content}`);
    }

    function debugLog(text) {
      const cfg = getConfig();
      if (!cfg.bridgeDebugEnabled) return;
      ToolboxShell.appendLog(`[BRIDGE][DEBUG] ${String(text || '')}`);
    }

    function buildBridgeHeaders() {
      const cfg = getConfig();
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Source': SOURCE,
      };
      if (cfg.bridgeApiToken) {
        headers.Authorization = `Bearer ${cfg.bridgeApiToken}`;
        headers['X-API-Key'] = cfg.bridgeApiToken;
      }
      return headers;
    }

    function detectResponseState() {
      return detectComposerResponseState();
    }

    const BRIDGE_DEPRECATED_FIELDS_LOGGED = new Set();

    function bridgeUrlFrom(obj) {
      if (!obj || typeof obj !== 'object') {
        return '';
      }
      return String(
        obj.url
        || obj.page_url
        || obj.target_url
        || obj.target_page_url
        || obj.conversation_url
        || '',
      ).trim();
    }

    function bridgeContentFrom(obj) {
      if (!obj || typeof obj !== 'object') {
        return '';
      }
      const readOrder = [
        ['content', 'content'],
        ['final_prompt', 'content'],
        ['text', 'content'],
        ['message', 'content'],
        ['raw_content', 'content'],
        ['raw_user_text', 'content'],
      ];
      for (const [field, replacement] of readOrder) {
        const value = String(obj[field] || '').trim();
        if (!value) {
          continue;
        }
        if (field !== 'content' && !BRIDGE_DEPRECATED_FIELDS_LOGGED.has(`poll:${field}`)) {
          BRIDGE_DEPRECATED_FIELDS_LOGGED.add(`poll:${field}`);
          ToolboxShell.appendLog(
            `[FIELD][DEPRECATED] bridge_poll field=${field} replacement=${replacement}`,
          );
        }
        return value;
      }
      return '';
    }

    function normalizeBridgePollMessage(raw) {
      if (!raw || typeof raw !== 'object') {
        return raw;
      }
      const messageId = String(raw.message_id || raw.id || '').trim();
      const content = bridgeContentFrom(raw);
      const url = bridgeUrlFrom(raw);
      const normalized = {
        ...raw,
        message_id: messageId,
        content,
      };

      if (messageId && normalized.id) {
        ToolboxShell.appendLog('[FIELD][DEPRECATED] poll message field=id write=message_id');
        delete normalized.id;
      }

      if (url) {
        if (normalized.page_url || normalized.target_url || normalized.target_page_url || normalized.conversation_url) {
          ToolboxShell.appendLog('[FIELD][DEPRECATED] poll message url alias fields collapsed to url');
        }
        normalized.url = url;
        delete normalized.page_url;
        delete normalized.target_url;
        delete normalized.target_page_url;
        delete normalized.conversation_url;
      }

      return normalized;
    }

    function withBridgeUrlFields(fields) {
      const patch = fields && typeof fields === 'object' ? { ...fields } : {};
      const url = bridgeUrlFrom(patch) || location.href;
      patch.url = url;
      return patch;
    }

    const BIND_TOKEN_META_KEY = 'xz_bind_token_meta';
    const BIND_TOKEN_MAX_AGE_MS = 5 * 60 * 1000;

    function clearStoredBindRequestToken(reason = '') {
      try {
        sessionStorage.removeItem('xz_bind_token');
        sessionStorage.removeItem(BIND_TOKEN_META_KEY);
        const conversationId = parseConversationIdFromPath(location.pathname || '') || '';
        ToolboxShell.appendLog(
          `[BRIDGE][BIND_TOKEN][CLEAR] reason=${reason || '-'} `
            + `client_id=${CLIENT_ID} `
            + `page_instance_id=${PAGE_INSTANCE_ID} `
            + `conversation_id=${conversationId || '-'}`,
        );
      } catch (error) {
        logBridgeError(
          `clearStoredBindRequestToken 失败: ${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function saveStoredBindRequestToken(token) {
      const value = String(token || '').trim();
      if (!value) {
        return;
      }

      const meta = {
        token: value,
        client_id: CLIENT_ID,
        page_instance_id: PAGE_INSTANCE_ID,
        savedAt: Date.now(),
      };

      sessionStorage.setItem('xz_bind_token', value);
      sessionStorage.setItem(BIND_TOKEN_META_KEY, JSON.stringify(meta));
      ToolboxShell.appendLog(
        `[BRIDGE][BIND_TOKEN][SAVE] client_id=${CLIENT_ID} page_instance_id=${PAGE_INSTANCE_ID}`,
      );
    }

    function clearBindRequestTokenFromLocation(reason = '') {
      try {
        const url = new URL(location.href);
        let changed = false;

        if (url.searchParams.has('xz_bind_token')) {
          url.searchParams.delete('xz_bind_token');
          changed = true;
        }

        const hash = String(url.hash || '');
        if (hash.includes('xz_bind_token=')) {
          const parts = hash.slice(1).split('&').filter((part) => part && !part.startsWith('xz_bind_token='));
          url.hash = parts.length ? `#${parts.join('&')}` : '';
          changed = true;
        }

        if (changed) {
          history.replaceState(history.state, document.title, url.toString());
          ToolboxShell.appendLog(
            `[BRIDGE][BIND_TOKEN][URL_CLEAN] reason=${reason || '-'} client_id=${CLIENT_ID} page_instance_id=${PAGE_INSTANCE_ID}`,
          );
        }
      } catch (error) {
        logBridgeError(
          `clearBindRequestTokenFromLocation failed: ${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function readStoredBindRequestToken() {
      try {
        const rawMeta = sessionStorage.getItem(BIND_TOKEN_META_KEY);
        if (!rawMeta) {
          const legacy = String(sessionStorage.getItem('xz_bind_token') || '').trim();
          if (legacy) {
            clearStoredBindRequestToken('legacy-without-meta');
          }
          return '';
        }

        const meta = JSON.parse(rawMeta);
        const token = String(meta && meta.token ? meta.token : '').trim();
        const savedAt = Number(meta && meta.savedAt ? meta.savedAt : 0);
        const metaClientId = String(meta && meta.client_id ? meta.client_id : '').trim();
        const metaPageInstanceId = String(meta && meta.page_instance_id ? meta.page_instance_id : '').trim();
        const legacyPageKey = String(meta && meta.pageKey ? meta.pageKey : '').trim();

        if (!token) {
          clearStoredBindRequestToken('empty-token');
          return '';
        }

        if (!savedAt || Date.now() - savedAt > BIND_TOKEN_MAX_AGE_MS) {
          clearStoredBindRequestToken('expired');
          return '';
        }

        if (metaPageInstanceId && metaPageInstanceId !== PAGE_INSTANCE_ID) {
          clearStoredBindRequestToken('page-instance-mismatch');
          return '';
        }

        if (metaClientId && metaClientId !== CLIENT_ID) {
          clearStoredBindRequestToken('client-id-mismatch');
          return '';
        }

        if (!metaPageInstanceId && legacyPageKey) {
          ToolboxShell.appendLog(
            `[FIELD][DEPRECATED] bind_token_meta field=pageKey replacement=page_instance_id legacy=${legacyPageKey}`,
          );
          saveStoredBindRequestToken(token);
          return token;
        }

        return token;
      } catch (error) {
        clearStoredBindRequestToken('read-meta-failed');
        logBridgeError(
          `readStoredBindRequestToken 失败: ${error && error.message ? error.message : String(error)}`,
          error,
        );
        return '';
      }
    }

    function getBindRequestToken() {
      try {
        const url = new URL(location.href);
        const fromQuery = url.searchParams.get('xz_bind_token');
        if (fromQuery) {
          saveStoredBindRequestToken(fromQuery);
          clearBindRequestTokenFromLocation('query');
          return fromQuery;
        }
        const hash = String(location.hash || '');
        const match = hash.match(/xz_bind_token=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          saveStoredBindRequestToken(match[1]);
          clearBindRequestTokenFromLocation('hash');
          return match[1];
        }
        return readStoredBindRequestToken();
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);

        logBridgeError(
          `[getBindRequestToken][failed] type=${errName} url=${location.href} error=${errText}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][BIND_TOKEN][FAILED] type=${errName} url=${location.href} error=${errText}`,
          );
        }

        if (typeof updateStatus === 'function') {
          updateStatus(`绑定 token 获取失败：${errText}`);
        }

        return '';
      }
    }

    function logIdentityThrottled(identity) {
      const cfg = getConfig();
      if (!cfg.bridgeDebugEnabled) return;

      const key = [
        identity.page_type || '',
        identity.conversation_id || '',
        identity.pathname || '',
        identity.visibility_state || '',
        identity.has_focus ? 'focus' : 'blur',
      ].join('|');

      const now = Date.now();

      if (key === state.lastIdentityLogKey && now - Number(state.lastIdentityLogAt || 0) < 5000) {
        return;
      }

      state.lastIdentityLogKey = key;
      state.lastIdentityLogAt = now;

      ToolboxShell.appendLog(
        `[BRIDGE][IDENTITY] page_type=${identity.page_type || '-'} conversation_id=${identity.conversation_id || '-'} pathname=${identity.pathname || '-'}`,
      );
    }

    function getPageIdentity() {
      try {
        const url = new URL(location.href);
        const path = url.pathname || '';

        let pageType = 'unknown';
        const conversationId = parseConversationIdFromPath(path);
        const bindToken = getBindRequestToken();
        const hasBindTokenInUrl = Boolean(
          url.searchParams.get('xz_bind_token')
          || (url.hash && url.hash.includes('xz_bind_token=')),
        );
        if (conversationId) {
          pageType = 'conversation';
        } else if (path === '/' || path === '' || hasBindTokenInUrl) {
          pageType = 'home';
        } else if (path.startsWith('/backend-api/') || path.includes('/sentinel/')) {
          pageType = 'ignored';
        } else {
          pageType = 'other';
        }

        const responseState = detectResponseState();
        const visibilityPayload = buildVisibilityPayload();
        const identity = {
          client_id: CLIENT_ID,
          page_instance_id: PAGE_INSTANCE_ID,
          page_key: getBridgePageKey(),
          script_version: SCRIPT_VERSION,
          upload_bridge_supported: true,
          upload_bridge_version: 1,
          url: location.href,
          page_title: document.title || '',
          page_type: pageType,
          conversation_id: conversationId,
          bind_request_id: bindToken,
          is_top_frame: window.top === window.self,

          ...visibilityPayload,

          heartbeat_alive: true,
          pathname: location.pathname,
          last_seen: Date.now() / 1000,
          is_responding: Boolean(responseState.is_responding),
          response_state: responseState.response_state || 'unknown',
          response_state_reason: responseState.response_state_reason || '',
          response_state_at: responseState.response_state_at || Date.now(),
          can_accept_input: Boolean(responseState.can_accept_input),
          can_send_now: Boolean(responseState.can_send_now),
        };
        logIdentityThrottled(identity);
        logPageCapability(getPageCapability('getPageIdentity'), '[BRIDGE][IDENTITY]');

        return identity;
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const fallbackPathname = location && location.pathname ? location.pathname : '';
        const fallbackConversationId = parseConversationIdFromPath(fallbackPathname);

        logBridgeError(
          `[getPageIdentity][failed] type=${errName} pathname=${fallbackPathname || '-'} error=${errText}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][IDENTITY][FAILED] type=${errName} pathname=${fallbackPathname || '-'} conversation_id=${fallbackConversationId || '-'} error=${errText}`,
          );
        }

        return {
          client_id: CLIENT_ID,
          page_instance_id: PAGE_INSTANCE_ID,
          page_key: getBridgePageKey(),
          script_version: SCRIPT_VERSION,
          upload_bridge_supported: true,
          upload_bridge_version: 1,
          url: location.href,
          page_title: document.title || '',
          page_type: fallbackConversationId ? 'conversation' : 'unknown',
          conversation_id: fallbackConversationId || '',
          bind_request_id: '',
          is_top_frame: window.top === window.self,
          ...buildVisibilityPayload(),
          heartbeat_alive: true,
          pathname: fallbackPathname,
          last_seen: Date.now() / 1000,
          is_responding: false,
          response_state: 'unknown',
          response_state_reason: `identity_exception:${errName}`,
          response_state_at: Date.now(),
          can_accept_input: false,
          can_send_now: false,
          identity_error: errText,
        };
      }
    }

    function apiRequest(body) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
          const error = new Error('GM_xmlhttpRequest 不可用，请检查油猴 @grant 和 @connect 权限');
          logBridgeError(error.message, error);
          reject(error);
          return;
        }

        const cfg = getConfig();
        const reqUrl = getBridgeUrl();
        GM_xmlhttpRequest({
          method: 'POST',
          url: reqUrl,
          headers: buildBridgeHeaders(),
          data: JSON.stringify({
            ...getPageIdentity(),
            ...body,
          }),
          timeout: cfg.bridgeRequestTimeoutMs,
          onload(response) {
            const action = body && body.action ? body.action : '-';
            const responseText = String(response.responseText || '');
            const responsePreview = responseText.slice(0, 500).replace(/\s+/g, ' ');

            if (response.status < 200 || response.status >= 300) {
              const error = new Error(
                `HTTP ${response.status} action=${action} url=${reqUrl} response=${responsePreview}`,
              );

              logBridgeError(
                `[apiRequest][http-failed] action=${action} url=${reqUrl} status=${response.status} response_len=${responseText.length} response=${responsePreview}`,
                error,
              );

              reject(error);
              return;
            }
            try {
              resolve(JSON.parse(response.responseText));
            } catch (error) {
              const parseError = new Error(
                `响应解析失败 action=${action} url=${reqUrl} response=${responsePreview}`,
              );

              logBridgeError(
                `[apiRequest][json-parse-failed] action=${action} url=${reqUrl} response_len=${responseText.length} response=${responsePreview}`,
                error,
              );

              reject(parseError);
            }
          },
          onerror(error) {
            logBridgeError(`请求失败: ${error && error.message ? error.message : String(error)}`, error);
            reject(error);
          },
          ontimeout() {
            const error = new Error(`请求超时 (${cfg.bridgeRequestTimeoutMs}ms): ${reqUrl}`);
            logBridgeError(error.message, error);
            reject(error);
          },
        });
      });
    }

    async function ack(messageId, success, detail) {
      return apiRequest({
        action: 'ack',
        message_id: messageId,
        success,
        detail: detail || '',
      });
    }

    async function report(event, payload, messageId, options = {}) {
      try {
        await apiRequest({
          action: 'report',
          event,
          payload: payload || {},
          message_id: messageId || null,
        });
        return { ok: true };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`[REPORT] ${errText}`, error);

        if (options.throwOnError === true) {
          throw error;
        }

        return { ok: false, error: errText };
      }
    }

    async function reportStrict(event, payload, messageId) {
      return report(event, payload, messageId, { throwOnError: true });
    }

    async function reportBestEffort(event, payload, messageId) {
      return report(event, payload, messageId);
    }

    function reportFocusState(reason) {
      void reportBestEffort('focus_state', {
        reason: reason || '-',
        has_focus: document.hasFocus(),
        visibility_state: document.visibilityState,
        page_url: location.href,
        page_title: document.title || '',
        event_at: Date.now(),
      });
    }

    function installFocusStateListeners() {
      if (state.focusStateListenersInstalled) {
        return;
      }
      state.focusStateListenersInstalled = true;
      state.onWindowFocus = () => reportFocusState('window_focus');
      state.onWindowBlur = () => reportFocusState('window_blur');
      state.onVisibilityChange = () => reportFocusState('visibilitychange');
      window.addEventListener('focus', state.onWindowFocus, true);
      window.addEventListener('blur', state.onWindowBlur, true);
      document.addEventListener('visibilitychange', state.onVisibilityChange, true);
    }

    function removeFocusStateListeners() {
      if (!state.focusStateListenersInstalled) {
        return;
      }
      if (state.onWindowFocus) {
        window.removeEventListener('focus', state.onWindowFocus, true);
      }
      if (state.onWindowBlur) {
        window.removeEventListener('blur', state.onWindowBlur, true);
      }
      if (state.onVisibilityChange) {
        document.removeEventListener('visibilitychange', state.onVisibilityChange, true);
      }
      state.onWindowFocus = null;
      state.onWindowBlur = null;
      state.onVisibilityChange = null;
      state.focusStateListenersInstalled = false;
    }

    async function waitForBridgeAssistantReply(messageId, result) {
      const sessionId = String(result.session_id || '').trim();
      const turnId = String(result.turn_id || '').trim();
      const identity = getPageIdentity();
      const timeoutMs = 10 * 60 * 1000;
      const noBusyGraceMs = 15000;
      const stableIdleMs = 1600;
      const pollMs = 800;
      const startedAt = Date.now();
      let idleSince = 0;
      let sawBusy = false;
      let lastAssistantText = '';

      ToolboxShell.appendLog(
        `[BRIDGE][REPLY_WAIT] messageId=${String(messageId || '').slice(0, 8)} `
        + `session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
      );

      while (Date.now() - startedAt < timeoutMs) {
        let busy = false;
        try {
          busy = typeof ComposerApi.isAssistantLikelyBusy === 'function'
            ? ComposerApi.isAssistantLikelyBusy()
            : false;
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          logBridgeError(`[BRIDGE][REPLY_WAIT] busy-check-failed error=${errText}`, error);
        }

        if (busy) {
          sawBusy = true;
          idleSince = 0;
          await sleep(pollMs);
          continue;
        }

        try {
          const latestAssistant = getLatestAssistantAfterLatestUserRecord({
            includeHidden: true,
          });
          const text = latestAssistant && latestAssistant.text
            ? String(latestAssistant.text).trim()
            : '';

          if (text) {
            if (text === lastAssistantText) {
              if (!idleSince) {
                idleSince = Date.now();
              }
              if (Date.now() - idleSince >= stableIdleMs) {
                await report(
                  'assistant_reply',
                  withBridgeUrlFields({
                    session_id: sessionId,
                    turn_id: turnId,
                    client_id: identity.client_id || CLIENT_ID,
                    page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
                    conversation_id: identity.conversation_id || '',
                    text,
                    content: text,
                    assistant_text: text,
                    ok: true,
                  }),
                  messageId,
                );
                return true;
              }
            } else {
              lastAssistantText = text;
              idleSince = Date.now();
            }
          }
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          logBridgeError(`[BRIDGE][REPLY_WAIT] snapshot-check-failed error=${errText}`, error);
        }

        if (!sawBusy && Date.now() - startedAt >= noBusyGraceMs) {
          await report(
            'assistant_reply_empty',
            withBridgeUrlFields({
              session_id: sessionId,
              turn_id: turnId,
              client_id: identity.client_id || CLIENT_ID,
              page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
              conversation_id: identity.conversation_id || '',
              reason: 'no-busy-observed-and-no-assistant-after-latest-user',
            }),
            messageId,
          );
          return false;
        }

        await sleep(pollMs);
      }

      await report(
        'assistant_reply_empty',
        withBridgeUrlFields({
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          reason: 'reply-wait-timeout',
        }),
        messageId,
      );
      return false;
    }

    async function sendTextToChatGPT(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const content = bridgeContentFrom(normalized);
      const sessionId = String(normalized.session_id || '').trim();
      const turnId = String(normalized.turn_id || '').trim();
      const identity = getPageIdentity();
      const targetUrl = bridgeUrlFrom(normalized);
      const allowReplaceDraft = normalized.allow_replace_draft === true
        || normalized.payload?.allow_replace_draft === true;

      const blockReason = String(state.uploadBlockNextChatReason || '');
      const blockAt = Number(state.uploadBlockNextChatAt || 0);
      const blockFresh = blockReason && Date.now() - blockAt <= 60000;

      if (blockReason && blockFresh) {
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';

        await ack(messageId, false, blockReason);
        await report('send_failed', {
          reason: 'upload_before_send_failed',
          detail: blockReason,
          text_len: content.length,
        }, messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][BLOCK_CHAT] messageId=${String(messageId || '').slice(0, 8)} reason=${blockReason}`
        );

        return false;
      }

      if (blockReason && !blockFresh) {
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][BLOCK_CHAT_EXPIRED] age=${Date.now() - blockAt} reason=${blockReason}`
        );
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';
      }

      if (!content.trim()) {
        await ack(messageId, false, '消息内容为空');
        await reportBestEffort('send_failed', withBridgeUrlFields({
          reason: 'empty_content',
          text_len: 0,
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          url: targetUrl,
        }), messageId);
        return false;
      }

      const sendResult = await sendContentViaComposer({
        source: 'bridge',
        content,
        allowReplaceDraft,
        waitUntilSendable: true,
        timeoutMs: 60000,
        blockWhenResponding: true,
      });

      if (!sendResult.ok) {
        const reason = sendResult.reason || 'send_failed';
        const ackMessages = {
          assistant_busy: 'ChatGPT 正在生成回复，暂不能发送',
          composer_has_existing_text: 'ChatGPT 输入框已有内容，已拒绝覆盖草稿',
          composer_not_found: '没有找到 ChatGPT 输入框',
          send_button_unavailable: '输入成功，但发送按钮不可用',
          send_button_wait_timeout: '等待发送按钮超时',
          click_send_failed: '点击发送失败',
        };
        const ackText = ackMessages[reason]
          || (reason.startsWith('send_not_confirmed')
            ? `点击发送后未确认成功：${reason}`
            : `发送失败：${reason}`);

        await ack(messageId, false, ackText);
        await report('send_failed', withBridgeUrlFields({
          reason,
          text_len: content.length,
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          url: targetUrl,
        }), messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][SEND][FAILED] messageId=${String(messageId || '').slice(0, 8)} reason=${reason}`,
        );
        logBridgeError(`发送失败 reason=${reason}`);
        return false;
      }

      await ack(messageId, true, `已发送到 ChatGPT：${sendResult.reason}`);
      await report('send_success', withBridgeUrlFields({
        reason: sendResult.reason,
        message_status: sendResult.reason,
        text_len: content.length,
        session_id: sessionId,
        turn_id: turnId,
        client_id: identity.client_id || CLIENT_ID,
        page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
        conversation_id: identity.conversation_id || '',
        url: targetUrl,
        ok: true,
      }), messageId);

      try {
        await waitForBridgeAssistantReply(messageId, normalized);
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`[BRIDGE][REPLY_WAIT] failed error=${errText}`, error);
        await report(
          'assistant_reply_failed',
          withBridgeUrlFields({
            session_id: sessionId,
            turn_id: turnId,
            client_id: identity.client_id || CLIENT_ID,
            page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
            conversation_id: identity.conversation_id || '',
            reason: errText,
          }),
          messageId,
        );
      }

      return true;
    }

    async function closeCurrentPageCommand(messageId) {
      await report('close_page_requested', withBridgeUrlFields({}), messageId);
      await ack(messageId, true, '已发起关闭当前页面请求');

      window.setTimeout(() => {
        try {
          window.open('', '_self');
          window.close();
        } catch (error) {
          logBridgeError(`window.close 失败: ${error && error.message ? error.message : String(error)}`, error);
        }

        window.setTimeout(() => {
          report('close_page_still_alive', withBridgeUrlFields({
            page_title: document.title || '',
            event_at: Date.now(),
          }), messageId);
        }, 1000);
      }, 200);
      return true;
    }

    async function openUrlCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const url = bridgeUrlFrom(normalized);
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          await ack(messageId, false, `不允许打开非 http/https 地址: ${url}`);
          return false;
        }
        if (typeof GM_openInTab === 'function') {
          GM_openInTab(parsed.href, {
            active: result.active !== false,
            insert: true,
            setParent: true,
          });
        } else {
          window.open(parsed.href, '_blank', 'noopener,noreferrer');
        }

        await report('open_url_requested', withBridgeUrlFields({
          url: parsed.href,
          active: result.active !== false,
        }), messageId);

        await ack(messageId, true, `已发起打开请求: ${parsed.href}`);
        return true;
      } catch (error) {
        logBridgeError(`open_url 失败: ${error && error.message ? error.message : String(error)}`, error);
        await ack(messageId, false, `打开网页失败: ${error && error.message ? error.message : String(error)}`);
        return false;
      }
    }

    function setUploadBlockReason(reason, sourceMessageId) {
      state.uploadBlockNextChatReason = String(reason || '');
      state.uploadBlockNextChatAt = Date.now();
      state.uploadBlockNextChatSourceMessageId = String(sourceMessageId || '');
    }

    function base64ToUint8Array(base64) {
      const binary = atob(String(base64 || ''));
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    async function uploadCurrentFileCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const payload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const fileInfo = payload.file && typeof payload.file === 'object' ? payload.file : {};
      const requestId = String(payload.request_id || '').trim();

      await report('command_received', {
        command: 'upload_current_file',
        request_id: requestId,
      }, messageId);

      if (!fileInfo.content_base64) {
        const reason = '上传命令缺少文件内容';
        await report('command_failed', {
          command: 'upload_current_file',
          request_id: requestId,
          reason,
        }, messageId);
        await ack(messageId, false, reason);
        return false;
      }

      try {
        const bytes = base64ToUint8Array(fileInfo.content_base64);
        const mime = fileInfo.mime || 'application/octet-stream';
        const name = fileInfo.name || 'upload.bin';
        const blob = new Blob([bytes], { type: mime });
        const file = new File([blob], name, {
          type: mime,
          lastModified: Date.now(),
        });

        if (!ComposerApi || typeof ComposerApi.attachFilesByFileInput !== 'function') {
          throw new Error('ComposerApi.attachFilesByFileInput 不可用');
        }

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD_CURRENT_FILE][START] request_id=${requestId || '-'} `
          + `name=${name} size=${file.size}`,
        );

        const uploadResult = await ComposerApi.attachFilesByFileInput([file], 12000, {});

        if (!uploadResult || !uploadResult.ok) {
          const reason = (uploadResult && uploadResult.reason)
            ? uploadResult.reason
            : '未找到 ChatGPT 文件上传 input 或设置 input.files 失败';

          await report('control_done', {
            command: 'upload_current_file',
            request_id: requestId,
            ok: false,
            message: reason,
            detail: { file_name: name },
            result: uploadResult || {},
          }, messageId);

          await report('command_failed', {
            command: 'upload_current_file',
            request_id: requestId,
            reason,
          }, messageId);

          await ack(messageId, false, reason);
          return false;
        }

        const detail = {
          file_name: name,
          size: file.size,
        };

        await report('control_done', {
          command: 'upload_current_file',
          request_id: requestId,
          ok: true,
          message: '文件已提交到上传控件',
          detail,
          result: uploadResult,
        }, messageId);

        await ack(messageId, true, `文件已提交：${name}`);
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD_CURRENT_FILE][OK] request_id=${requestId || '-'} name=${name}`,
        );
        return true;
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const reason = `上传当前文件失败：${errText}`;

        console.error('[ChatGPT toolbox] upload_current_file command failed', error);
        ToolboxShell.appendLog(`[BRIDGE][UPLOAD_CURRENT_FILE][FAILED] ${reason}`);

        await report('control_done', {
          command: 'upload_current_file',
          request_id: requestId,
          ok: false,
          message: reason,
          result: { reason: errText },
        }, messageId);

        await report('command_failed', {
          command: 'upload_current_file',
          request_id: requestId,
          reason: errText,
        }, messageId);

        await ack(messageId, false, reason);
        return false;
      }
    }

    async function startUploadCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const payload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const bridgeSource = 'bridge_command';

      const setUploadBlockOnFailed = (reason) => {
        if (payload.block_next_chat_on_failed !== false) {
          setUploadBlockReason(reason, messageId);
        }
      };

      if (!UploadModule || typeof UploadModule.triggerStartUpload !== 'function') {
        const reason = 'UploadModule.triggerStartUpload 不存在，无法执行油猴上传';
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason,
        }, messageId);

        return false;
      }

      let uploadResult = null;

      try {
        ToolboxShell.appendLog(
          `[TM_CONTROL][START_UPLOAD][RECEIVED] source=${bridgeSource}`
        );
        console.log(
          `[TM_CONTROL][START_UPLOAD][RECEIVED] source=${bridgeSource}`
        );

        await report('command_received', {
          command: 'start_upload',
        }, messageId);

        uploadResult = await UploadModule.triggerStartUpload(bridgeSource);
        const uploadStatus = UploadModule.getStatus
          ? UploadModule.getStatus()
          : {};
        uploadResult = {
          ...(uploadResult || {}),
          upload_status: uploadStatus,
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const reason = `发送前上传失败：${errText}`;

        console.error('[ChatGPT toolbox] start_upload command failed', error);
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason: errText,
        }, messageId);

        return false;
      }

      const uploadStatus = uploadResult && uploadResult.upload_status
        ? uploadResult.upload_status
        : {};

      const success = Number(uploadResult && uploadResult.success) || 0;
      const failed = Number(uploadResult && uploadResult.failed) || 0;
      const attached = Number(uploadStatus.attached) || 0;
      const cancelled = Boolean(uploadResult && uploadResult.cancelled);
      const skipped = Boolean(uploadResult && uploadResult.skipped);
      const requireAllSuccess = payload.require_all_success !== false;

      let ok = true;
      let reason = '';

      if (cancelled) {
        ok = false;
        reason = '发送前上传已取消';
      } else if (requireAllSuccess && failed > 0) {
        ok = false;
        reason = `发送前上传存在失败文件：failed=${failed}`;
      } else if (success <= 0 && attached <= 0) {
        ok = false;
        reason = skipped
          ? `发送前上传跳过：${uploadResult.reason || '没有可上传文件'}`
          : '发送前上传没有成功文件';
      }

      if (!ok) {
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason,
          result: uploadResult,
        }, messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][FAILED] reason=${reason} success=${success} failed=${failed} attached=${attached}`
        );

        return false;
      }

      if (state.uploadBlockNextChatReason) {
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][CLEAR_OLD_BLOCK] reason=${state.uploadBlockNextChatReason}`
        );
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';
      }

      await report('control_done', {
        command: 'start_upload',
        result: uploadResult,
      }, messageId);

      await ack(
        messageId,
        true,
        `上传完成：success=${success}, failed=${failed}, attached=${attached}`,
      );

      ToolboxShell.appendLog(
        `[BRIDGE][UPLOAD][OK] success=${success} failed=${failed} attached=${attached}`
      );

      return true;
    }

    async function handleCommandMessage(result) {
      const normalized = normalizeBridgePollMessage(result);
      const cmdPayload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const command = String(
        normalized.command
        || cmdPayload.command
        || normalized.action
        || ''
      ).trim();
      const messageId = normalized.message_id || normalized.id;
      if (command === 'close_self') {
        return await closeCurrentPageCommand(messageId);
      }
      if (command === 'open_url') {
        return await openUrlCommand(normalized);
      }
      if (command === 'sync_conversation') {
        try {
          const responseState = detectResponseState();
          const capability = getPageCapability('sync_conversation');
          const snapshot = buildConversationSnapshotForBridge(getPageIdentity);
          const cmdPayload = normalized.payload && typeof normalized.payload === 'object'
            ? normalized.payload
            : {};

          snapshot.command_type = cmdPayload.command_type || 'read_snapshot';
          snapshot.require_input = false;
          snapshot.allow_while_generating = true;
          snapshot.allow_generating = true;
          snapshot.allow_hidden = true;
          snapshot.allow_not_focused = true;
          snapshot.simple_online_policy = true;
          snapshot.capability = capability;
          snapshot.syncable = capability.syncable;
          snapshot.conversation_syncable = capability.conversation_syncable;
          snapshot.sendable = capability.sendable;
          snapshot.can_accept_input = Boolean(responseState.can_accept_input);
          snapshot.can_send_now = Boolean(responseState.can_send_now);
          snapshot.is_responding = Boolean(responseState.is_responding);
          const visibilityPayload = buildVisibilityPayload();
          snapshot.visibility_state = visibilityPayload.visibility_state;
          snapshot.has_focus = visibilityPayload.has_focus;
          snapshot.response_state = responseState.response_state || 'unknown';
          snapshot.response_state_reason = responseState.response_state_reason || '';

          const identity = getPageIdentity();
          logPageCapability(capability, '[SYNC][BRIDGE]');

          ToolboxShell.appendLog(
            `[BRIDGE][SYNC_CONVERSATION][messages=${snapshot.message_count}] `
            + `syncable=${capability.syncable ? 'yes' : 'no'} `
            + `conversation_syncable=${capability.conversation_syncable ? 'yes' : 'no'} `
            + `input=${snapshot.can_accept_input ? 'yes' : 'no'} `
            + `is_responding=${snapshot.is_responding ? 'yes' : 'no'} `
            + `response_state=${snapshot.response_state || '-'} `
            + `command_type=${snapshot.command_type}`
          );

          snapshot.session_id = cmdPayload.session_id || snapshot.session_id || '';
          snapshot.request_id = cmdPayload.request_id || snapshot.request_id || '';
          snapshot.turn_id = cmdPayload.turn_id || snapshot.turn_id || '';
          snapshot.client_id = cmdPayload.client_id || snapshot.client_id || CLIENT_ID;
          snapshot.page_instance_id = cmdPayload.page_instance_id || snapshot.page_instance_id || PAGE_INSTANCE_ID;
          snapshot.conversation_id = cmdPayload.conversation_id || snapshot.conversation_id || identity.conversation_id || '';
          const snapshotUrl = bridgeUrlFrom(cmdPayload)
            || bridgeUrlFrom(snapshot.page)
            || bridgeUrlFrom(identity)
            || location.href;
          snapshot.url = snapshotUrl;
          snapshot.mode = cmdPayload.mode || snapshot.mode || 'merge';

          await reportStrict(
            'conversation_snapshot',
            snapshot,
            messageId,
          );
          await ack(messageId, true, '已回传当前页面快照');
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          const errStack = error && error.stack ? error.stack : errText;
          console.error('[ChatGPT toolbox] sync_conversation report failed', error);
          ToolboxShell.appendLog(`[BRIDGE][SYNC_CONVERSATION][report-failed] error=${errStack}`);
          await ack(messageId, false, `同步对话失败：${errText}`);
          return false;
        }
        return true;
      }
      if (command === 'start_upload') {
        return await startUploadCommand(normalized);
      }
      if (command === 'upload_current_file') {
        return await uploadCurrentFileCommand(normalized);
      }
      await ack(messageId, false, `未知命令: ${command || '-'}`);
      return false;
    }

    async function handleOutboundMessage(result) {
      if (!result || !result.has_message) {
        return {
          handled: false,
          ok: true,
          reason: 'no-message',
        };
      }

      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;

      if (!messageId) {
        logBridgeError('服务端消息缺少 message_id');
        return {
          handled: false,
          ok: false,
          reason: 'missing-message-id',
        };
      }

      if (state.handlingMessageId && state.handlingMessageId !== messageId) {
        await report('client_busy', {
          current_message_id: state.handlingMessageId,
          ignored_message_id: messageId,
          reason: 'handling_other_message',
        }, messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][BUSY] current=${String(state.handlingMessageId || '').slice(0, 8)} incoming=${String(messageId || '').slice(0, 8)}`
        );

        return {
          handled: false,
          ok: true,
          reason: 'client-busy',
        };
      }

      if (state.handlingMessageId === messageId && !normalized.retry) {
        return {
          handled: false,
          ok: true,
          reason: 'duplicate',
        };
      }

      state.handlingMessageId = messageId;

      try {
        let ok = false;

        if (normalized.type === 'command') {
          ok = await handleCommandMessage(normalized);
        } else {
          const content = bridgeContentFrom(normalized);
          ToolboxShell.appendLog(
            `[BRIDGE][POLL][CHAT] message_id=${String(messageId).slice(0, 8)} `
            + `content_len=${content.length} url=${bridgeUrlFrom(normalized) || '-'}`,
          );
          ok = await sendTextToChatGPT(normalized);
        }

        return {
          handled: true,
          ok: ok === true,
          reason: ok === true ? 'ok' : 'message-handler-returned-false',
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`handleOutboundMessage 失败: ${errText}`, error);
        await ack(messageId, false, errText);

        return {
          handled: true,
          ok: false,
          reason: errText,
        };
      } finally {
        if (state.handlingMessageId === messageId) {
          state.handlingMessageId = null;
        }
      }
    }

    function formatBridgeStatusReasonSuffix(capability) {
      const reason = String(
        capability && capability.response_state_reason
          ? capability.response_state_reason
          : '',
      ).trim();
      return reason ? ` (${reason})` : '';
    }

    function getBridgePollStatusPresentation() {
      const capability = getPageCapability('bridge-poll');
      logPageCapability(capability, '[BRIDGE][POLL]');

      const reasonSuffix = formatBridgeStatusReasonSuffix(capability);

      if (!capability.bridge_connected) {
        const pollError = capability.last_poll_error || 'bridge_unreachable';
        return {
          text: `Bridge 离线：${pollError}`,
          type: 'offline',
          shortText: '离线',
        };
      }

      if (capability.responding || capability.is_responding) {
        return {
          text: `Bridge 已连接 · 回答中${reasonSuffix}`,
          type: 'danger',
          shortText: '回答中',
        };
      }

      if (capability.sendable) {
        return {
          text: `Bridge 已连接 · 可发送${reasonSuffix}`,
          type: 'online',
          shortText: '可发送',
        };
      }

      if (capability.inputable) {
        return {
          text: `Bridge 已连接 · 待输入${reasonSuffix}`,
          type: 'online',
          shortText: '待输入',
        };
      }

      return {
        text: `Bridge 已连接 · 页面异常${reasonSuffix}`,
        type: 'warn',
        shortText: '页面异常',
      };
    }

    /* ===== bridge core: heartbeat / poll / report / control claim ===== */
    async function pollBridge() {
      const cfg = getConfig();

      if (!cfg.bridgeEnabled || state.polling) {
        return;
      }

      if (state.handlingMessageId) {
        const now = Date.now();

        if (now - Number(state.lastBusyHeartbeatAt || 0) >= 3000) {
          state.lastBusyHeartbeatAt = now;
          const identity = getPageIdentity();
          const responseState = detectResponseState();

          await report('heartbeat_busy', {
            ...identity,
            busy: true,
            handling_message_id: state.handlingMessageId,
            visibility_state: document.visibilityState,
            has_focus: document.hasFocus(),
            is_responding: Boolean(responseState.is_responding),
            response_state: responseState.response_state || 'unknown',
            can_accept_input: Boolean(responseState.can_accept_input),
          }, state.handlingMessageId);
        }

        return;
      }

      const runId = state.bridgeRunId;
      state.polling = true;
      try {
        const result = await apiRequest({ action: 'poll' });

        if (runId !== state.bridgeRunId || !state.timerId) {
          ToolboxShell.appendLog('[BRIDGE][POLL][STALE_RESULT_IGNORED]');
          return;
        }

        const handled = await handleOutboundMessage(result);

        if (runId === state.bridgeRunId && state.timerId) {
          markBridgePollSuccess();
          if (!handled || handled.handled !== true || handled.ok === true) {
            const pres = getBridgePollStatusPresentation();
            updateStatus(pres.text);
            ToolboxShell.setStatus(pres.text, pres.type, {
              persist: true,
              shortText: pres.shortText,
            });
            renderBridgeCapabilityPanel(getPageCapability('bridge-poll'));
          } else {
            const failReason = handled.reason || '-';
            updateStatus(`消息处理失败：${failReason}`);
            ToolboxShell.setStatus(`消息处理失败：${failReason}`, 'error', { persist: true });
          }
        }
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const bridgeUrl = getBridgeUrl();

        markBridgePollFailure(errText);
        const pres = getBridgePollStatusPresentation();
        updateStatus(pres.text);
        ToolboxShell.setStatus(pres.text, pres.type, {
          persist: true,
          shortText: pres.shortText,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-poll-offline'));

        logBridgeError(
          `[pollBridge][failed] action=poll url=${bridgeUrl} type=${errName} error=${errText}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][POLL][FAILED] url=${bridgeUrl} type=${errName} error=${errText}`,
          );
        }
      } finally {
        if (runId === state.bridgeRunId) {
          state.polling = false;
        }
      }
    }

    function identityKey(identity) {
      if (!identity || typeof identity !== 'object') {
        return '';
      }

      return [
        String(identity.client_id || '').trim(),
        String(identity.page_instance_id || '').trim(),
        String(identity.page_type || '').trim(),
        String(identity.conversation_id || '').trim(),
        String(identity.pathname || '').trim(),
      ].join('|');
    }

    async function reportIdentityChanged(identity, oldKey, newKey, reason) {
      const eventAt = Date.now();
      const payload = withBridgeUrlFields({
        client_id: identity.client_id,
        page_instance_id: identity.page_instance_id,
        page_title: identity.page_title,
        page_type: identity.page_type,
        conversation_id: identity.conversation_id,
        pathname: identity.pathname,
        url: bridgeUrlFrom(identity) || location.href,
        visibility_state: identity.visibility_state,
        has_focus: identity.has_focus,
        old_identity_key: oldKey || '',
        new_identity_key: newKey || '',
        reason: reason || 'identity_change',
        event_at: eventAt,
      });
      ToolboxShell.appendLog(
        `[BRIDGE][IDENTITY_CHANGE] reason=${payload.reason} `
          + `client_id=${payload.client_id || '-'} `
          + `page_instance_id=${payload.page_instance_id || '-'} `
          + `page_type=${payload.page_type || '-'} `
          + `conversation_id=${payload.conversation_id || '-'} `
          + `pathname=${payload.pathname || '-'} `
          + `old_identity_key=${payload.old_identity_key || '-'} `
          + `new_identity_key=${payload.new_identity_key || '-'} `
          + `url=${payload.url || '-'}`,
      );
      try {
        await reportStrict('identity_change', payload);
      } catch (error) {
        logBridgeError(
          `[IDENTITY_CHANGE][report-failed] reason=${reason || '-'} `
            + `error=${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function flushIdentityChangeReport() {
      bridgeTimers.clearTimeout('identity-report-debounce');
      const latest = getPageIdentity();
      const newKey = identityKey(latest);
      const oldKey = state.pendingIdentityOldKey || '';
      const reason = state.pendingIdentityReason || 'identity_change';
      state.pendingIdentityOldKey = '';
      state.pendingIdentityReason = '';
      state.lastIdentityKey = newKey;
      if (!oldKey || oldKey === newKey) {
        return;
      }
      reportIdentityChanged(latest, oldKey, newKey, reason);
      const becameConversation = (
        (latest.page_type || '') === 'conversation'
        && Boolean((latest.conversation_id || '').trim())
      );
      if (becameConversation) {
        ToolboxShell.appendLog(
          '[BRIDGE][IDENTITY_CHANGE] conversation_ready immediate_poll',
        );
        pollBridge();
      }
    }

    function checkPageIdentityChange(reason) {
      const identity = getPageIdentity();
      const key = identityKey(identity);
      if (key === state.lastIdentityKey) {
        return;
      }
      const oldKey = state.lastIdentityKey || '';
      if (!state.pendingIdentityOldKey && oldKey) {
        state.pendingIdentityOldKey = oldKey;
      }
      state.pendingIdentityReason = reason || state.pendingIdentityReason || 'identity_change';
      debugLog(`identity changed: ${oldKey || '-'} -> ${key}`);
      bridgeTimers.timeout('identity-report-debounce', () => {
        flushIdentityChangeReport();
      }, 200);
    }

    async function handleRouteChange(reason = '') {
      const identity = getPageIdentity();
      const key = identityKey(identity);

      if (key === state.lastIdentityKey) {
        return;
      }

      const oldKey = state.lastIdentityKey || '';
      state.pendingIdentityOldKey = oldKey;
      state.pendingIdentityReason = reason || 'route_change';
      state.lastIdentityKey = key;
      bridgeTimers.clearTimeout('identity-report-debounce');
      debugLog(`route identity changed: ${oldKey || '-'} -> ${key}`);
      flushIdentityChangeReport();
    }

    function installPageIdentityListeners() {
      if (state.pageIdentityListenersInstalled) {
        return;
      }

      state.pageIdentityListenersInstalled = true;
    }

    function removePageIdentityListeners() {
      state.pageIdentityListenersInstalled = false;
    }

    function start() {
      stop();
      const cfg = getConfig();
      if (!cfg.bridgeEnabled) {
        resetBridgePollRuntime('bridge_disabled');
        updateStatus('未启用');
        return;
      }
      state.bridgeRunId += 1;
      state.lastIdentityKey = identityKey(getPageIdentity());
      state.lastIdentityLogKey = '';
      state.pendingIdentityOldKey = '';
      state.pendingIdentityReason = '';
      installFocusStateListeners();
      installPageIdentityListeners();
      reportFocusState('bridge_start');
      pollBridge();
      state.timerId = window.setInterval(() => {
        checkPageIdentityChange();
        pollBridge();
      }, cfg.bridgePollIntervalMs);
      updateStatus(`已启动：${getBridgeUrl()}`);
      ToolboxShell.appendLog(`[BRIDGE][START] ${getBridgeUrl()}`);
    }

    function stop() {
      state.bridgeRunId += 1;
      if (state.timerId) {
        window.clearInterval(state.timerId);
        state.timerId = 0;
      }
      bridgeTimers.clearTimeout('identity-report-debounce');
      removeFocusStateListeners();
      removePageIdentityListeners();
      state.polling = false;
      resetBridgePollRuntime('bridge_stopped');
      updateStatus('已停止');
    }

    async function testConnection() {
      updateStatus('正在测试连接...');
      try {
        const result = await apiRequest({
          action: 'poll',
          source: SOURCE,
          test_connection: true,
        });
        markBridgePollSuccess();
        const pres = getBridgePollStatusPresentation();
        updateStatus(`连接测试成功 · ${pres.shortText}`);
        ToolboxShell.setStatus(`连接测试成功 · ${pres.text}`, pres.type, {
          persist: true,
          shortText: pres.shortText,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-test'));
        ToolboxShell.appendLog(`[BRIDGE][TEST][OK] ${JSON.stringify(result).slice(0, 300)}`);
      } catch (error) {
        const text = error && error.message ? error.message : String(error);
        markBridgePollFailure(text);
        const pres = getBridgePollStatusPresentation();
        updateStatus(pres.text);
        ToolboxShell.setStatus(pres.text, pres.type, {
          persist: true,
          shortText: pres.shortText,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-test-failed'));
        ToolboxShell.appendLog(`[BRIDGE][TEST][ERROR] ${text}`);
      }
    }

    function updateStatus(text) {
      bridgeStatus.set(String(text || ''), 'info');
    }

    const BRIDGE_FIELD_MAP = Object.freeze([
      {
        key: 'bridgeEnabled',
        selector: '#cgpt-bridge-enabled',
        type: 'checked',
        defaultValue: true,
      },
      {
        key: 'bridgeBaseUrl',
        selector: '#cgpt-bridge-base-url',
        type: 'value',
        normalize: normalizeBridgeBaseUrl,
        defaultValue: DEFAULT_BRIDGE_BASE_URL,
      },
      {
        key: 'bridgePath',
        selector: '#cgpt-bridge-path',
        type: 'value',
        normalize: normalizeBridgePath,
        defaultValue: DEFAULT_BRIDGE_PATH,
      },
      {
        key: 'bridgeApiToken',
        selector: '#cgpt-bridge-token',
        type: 'value',
        normalize: (value) => String(value || '').trim(),
        defaultValue: '',
      },
      {
        key: 'bridgeDebugEnabled',
        selector: '#cgpt-bridge-debug',
        type: 'checked',
        defaultValue: false,
      },
      {
        key: 'bridgeRequestTimeoutMs',
        selector: '#cgpt-bridge-timeout',
        type: 'number',
        defaultValue: 30000,
      },
      {
        key: 'bridgePollIntervalMs',
        selector: '#cgpt-bridge-interval',
        type: 'number',
        defaultValue: 1000,
      },
    ]);

    function formatBridgeCapabilityText(capability) {
      const cap = capability && typeof capability === 'object'
        ? capability
        : getPageCapability('bridge-panel');

      const identity = getPageIdentity();
      const yesNo = (value) => (value ? 'yes' : 'no');

      const pollAt = Number(cap.last_poll_at || 0);
      const pollAtText = pollAt > 0 ? new Date(pollAt).toLocaleString() : '-';

      return [
        `client_id: ${cap.client_id || identity.client_id || '-'}`,
        `page_instance_id: ${cap.page_instance_id || identity.page_instance_id || '-'}`,
        `conversation_id: ${cap.conversation_id || identity.conversation_id || '-'}`,
        `url: ${cap.url || identity.url || '-'}`,
        `page_type: ${cap.page_type || identity.page_type || '-'}`,
        `online: ${yesNo(cap.online)}`,
        `inputable: ${yesNo(cap.inputable)}`,
        `sendable: ${yesNo(cap.sendable)}`,
        `response_state: ${cap.response_state || '-'}`,
        `response_state_reason: ${cap.response_state_reason || '-'}`,
        `bridge_connected: ${yesNo(cap.bridge_connected)}`,
        `last_poll_ok: ${cap.last_poll_ok === null || cap.last_poll_ok === undefined ? '-' : yesNo(cap.last_poll_ok)}`,
        `last_poll_error: ${cap.last_poll_error || '-'}`,
        `last_poll_at: ${pollAtText}`,
        `syncable: ${yesNo(cap.syncable)}`,
        `conversation_syncable: ${yesNo(cap.conversation_syncable)}`,
        `is_responding: ${yesNo(cap.is_responding)}`,
        `responding: ${yesNo(cap.responding)}`,
        `visibility_state: ${cap.visibility_state || document.visibilityState || '-'}`,
        `has_focus: ${yesNo(cap.has_focus)} (display only)`,
      ].join('\n');
    }

    function renderBridgeCapabilityPanel(capability) {
      if (!state.root) {
        return;
      }

      const textEl = qs('#cgpt-bridge-capability-text', state.root);

      if (!textEl) {
        return;
      }

      textEl.textContent = formatBridgeCapabilityText(capability);
    }

    function renderBridgeConfigToUi() {
      if (!state.root) return;

      const cfg = getConfig();

      BRIDGE_FIELD_MAP.forEach((field) => {
        if (field.type === 'checked') {
          DomUtil.setChecked(state.root, field.selector, cfg[field.key], 'BRIDGE');
          return;
        }

        DomUtil.setValue(state.root, field.selector, cfg[field.key], 'BRIDGE');
      });

      DomUtil.setText(state.root, '#cgpt-bridge-url', getBridgeUrl(), 'BRIDGE');
      renderBridgeCapabilityPanel();
    }

    function readBridgeConfigFromUi() {
      if (!state.root) return {};

      const patch = {};

      BRIDGE_FIELD_MAP.forEach((field) => {
        let value;

        if (field.type === 'checked') {
          value = DomUtil.getChecked(state.root, field.selector, field.defaultValue, 'BRIDGE');
        } else if (field.type === 'number') {
          value = Number(DomUtil.getValue(state.root, field.selector, field.defaultValue, 'BRIDGE')) || field.defaultValue;
        } else {
          value = DomUtil.getValue(state.root, field.selector, field.defaultValue, 'BRIDGE');
        }

        patch[field.key] = typeof field.normalize === 'function'
          ? field.normalize(value)
          : value;
      });

      return patch;
    }

    function renderConfigToUi() {
      renderBridgeConfigToUi();
    }

    function saveConfigFromUi() {
      if (!state.root) return;

      saveConfig(readBridgeConfigFromUi());
      renderConfigToUi();
      start();
    }

    function bindBridgeEvents(mountRoot) {
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-save', saveConfigFromUi, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-test', () => {
        testConnection();
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-stop', () => {
        saveConfig({ bridgeEnabled: false });
        renderConfigToUi();
        stop();
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-copy-url', () => {
        void copyWithStatus({
          text: getBridgeUrl(),
          successText: '已复制 Bridge 地址',
          failedPrefix: '复制 Bridge 地址失败',
          logPrefix: 'BRIDGE_COPY_URL',
        });
      }, 'BRIDGE');
    }

    const BRIDGE_MODULE_HTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">浏览器桥接</div>
          <div class="cgpt-hint">用于连接本地 Python Flask Bridge，实现页面绑定、消息下发、回复回传、刷新、关闭、同步当前对话等能力。</div>

          <label class="cgpt-checkbox-line">
            <input type="checkbox" id="cgpt-bridge-enabled">
            启用桥接轮询
          </label>

          <div class="cgpt-form-grid">
            <label>服务地址</label>
            <input class="cgpt-input" id="cgpt-bridge-base-url" placeholder="http://127.0.0.1:5000">

            <label>接口路径</label>
            <input class="cgpt-input" id="cgpt-bridge-path" placeholder="/api/bridge">

            <label>API Token</label>
            <input class="cgpt-input" id="cgpt-bridge-token" placeholder="可留空">

            <label>请求超时 ms</label>
            <input class="cgpt-input" id="cgpt-bridge-timeout" type="number" min="1000">

            <label>轮询间隔 ms</label>
            <input class="cgpt-input" id="cgpt-bridge-interval" type="number" min="500">
          </div>

          <label class="cgpt-checkbox-line" style="margin-top:8px;">
            <input type="checkbox" id="cgpt-bridge-debug">
            开启调试日志
          </label>

          <div class="cgpt-row" style="margin-top:10px; flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-bridge-save">保存并重启桥接</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-test">测试连接</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-stop">停止轮询</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-copy-url">复制地址</button>
          </div>

          <div class="cgpt-hint" style="margin-top:10px;">
            当前地址：<span id="cgpt-bridge-url"></span>
          </div>

          <div class="cgpt-hint" style="margin-top:6px;">
            状态：<span id="cgpt-bridge-status">未启动</span>
          </div>

          <div class="cgpt-hint" style="margin-top:10px; font-weight:600;">
            页面能力（当前标签页，仅展示不拦截同步）
          </div>
          <pre id="cgpt-bridge-capability-text" class="cgpt-hint" style="margin:4px 0 0; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; white-space:pre-wrap; font-family:ui-monospace,monospace; font-size:11px; line-height:1.45;">-</pre>
        </div>
      `;

    function mount(targetHost) {
      if (!targetHost) {
        logBridgeError('mount 失败: targetHost 为空');
        return;
      }

      const mountedRoot = mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-bridge-module',
        moduleName: 'BRIDGE',
        html: BRIDGE_MODULE_HTML,
        onRefs: (rootEl) => {
          state.root = rootEl;
          state.mounted = true;
        },
        onBind: (rootEl) => {
          bindBridgeEvents(rootEl);
        },
        onRender: () => {
          renderConfigToUi();
        },
        onAfterMount: () => {
          start();
        },
      });

      if (!mountedRoot) {
        logBridgeError('mount 失败: mountSingletonModule 返回空');
      }
    }

    return {
      mount,
      handleRouteChange,
    };
  })();

  /********************************************************************
   * 7. ExportModule：导出统计模   ********************************************************************/

  const ExportModule = (() => {
    let root = null;
    let statsLineEl = null;
    let settingsImportFileEl = null;

    const REVIEW_JSON_MARKER = '<<<REVIEW_JSON>>>';

    function getExportMessageRole(el) {
      return getMessageRole(el);
    }

    function roleLabelForExport(role) {
      if (role === 'user') return '用户';
      if (role === 'assistant') return '助手';
      if (role === 'system') return '系统';

      return role || '消息';
    }

    function insertReviewJsonMarkerForAssistant(text) {
      if (!text || text === '（空）') return text;

      const full = text;
      const wsMatch = full.match(/^\s*/);
      const wsLen = wsMatch ? wsMatch[0].length : 0;
      const rest = full.slice(wsLen);

      if (rest.startsWith('{') || rest.startsWith('[')) {
        return `${full.slice(0, wsLen)}${REVIEW_JSON_MARKER}\n${rest}`;
      }

      const j = rest.search(/[\{\[]/);
      if (j === -1) return text;

      const jsonPart = rest.slice(j).trimStart();
      if (!jsonPart.startsWith('{') && !jsonPart.startsWith('[')) return text;

      const before = rest.slice(0, j).trimEnd();
      const prefix = full.slice(0, wsLen);

      if (before) {
        return `${prefix}${before}\n\n${REVIEW_JSON_MARKER}\n${jsonPart}`;
      }

      return `${prefix}${REVIEW_JSON_MARKER}\n${jsonPart}`;
    }

    function buildChatExportText() {
      const header = `=== ChatGPT 对话全文 ===\n导出时间${new Date().toLocaleString()}\n`;

      try {
        const records = ChatMessageExtractor.buildRecords({
          includeEmpty: true,
          includeHidden: true,
        });

        if (records.length > 0) {
          const blocks = records.map((rec, i) => {
            const label = roleLabelForExport(rec.role || '');
            let text = String(rec.text || '').trim();

            if (!text) text = '（空）';

            if (rec.role === 'assistant') {
              text = insertReviewJsonMarkerForAssistant(text);
            }

            return `--- ${label} ${i + 1} ---\n${text}`;
          });

          return `${header}\n${blocks.join('\n\n')}`;
        }
      } catch (exportErr) {
        const exportErrText = exportErr && exportErr.message ? exportErr.message : String(exportErr);
        console.warn('[ChatGPT toolbox] buildChatExportText records failed, fallback to ComposerApi', exportErr);
        ToolboxShell.appendLog(`[EXPORT][chat-records-failed] error=${exportErrText}`);
      }

      const nodes = ComposerApi.getChatMessageElementsInOrder();

      if (nodes.length > 0) {
        const blocks = nodes.map((el, i) => {
          const role = getExportMessageRole(el);
          const label = roleLabelForExport(role);

          let text = getVisibleTextFromElement(el);

          if (!text) text = '（空）';

          if (role === 'assistant') {
            text = insertReviewJsonMarkerForAssistant(text);
          }

          return `--- ${label} ${i + 1} ---\n${text}`;
        });

        return `${header}\n${blocks.join('\n\n')}`;
      }

      const main = qs('main');

      if (main) {
        const text = String(main.innerText || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

        if (text) {
          return `${header}\n（未识别到标准消息节点，已用 main 文本兜底）\n\n${text}`;
        }
      }

      return `${header}\n未找到对话内容。`;
    }

    function buildPanelExportText() {
      const autoCfg = AutoQueueModule.getConfig();
      const autoState = AutoQueueModule.getState();
      const uploadStatus = UploadModule.getStatus();
      const promptCount = PromptManagerModule.getPrompts().length;

      const continueLoop = autoCfg.modeSettings &&
        autoCfg.modeSettings.continue &&
        autoCfg.modeSettings.continue.loopMode;
      const listLoop = autoCfg.modeSettings &&
        autoCfg.modeSettings.list &&
        autoCfg.modeSettings.list.loopMode;
      const continueMin = autoCfg.modeSettings && autoCfg.modeSettings.continue
        ? autoCfg.modeSettings.continue.randomMinSec
        : 3;
      const continueMax = autoCfg.modeSettings && autoCfg.modeSettings.continue
        ? autoCfg.modeSettings.continue.randomMaxSec
        : 20;
      const listMin = autoCfg.modeSettings && autoCfg.modeSettings.list
        ? autoCfg.modeSettings.list.randomMinSec
        : 3;
      const listMax = autoCfg.modeSettings && autoCfg.modeSettings.list
        ? autoCfg.modeSettings.list.randomMaxSec
        : 20;

      return `=== ChatGPT 工具箱配置导出 ===
导出时间：${new Date().toLocaleString()}

【自动指令】
模式：${autoCfg.promptMode === 'continue' ? '继续模式' : '列表模式'}
继续模式循环：${continueLoop ? '是' : '否'}
继续模式间隔：${continueMin} ~ ${continueMax} 秒
列表模式循环：${listLoop ? '是' : '否'}
列表模式间隔：${listMin} ~ ${listMax} 秒
运行状态：${autoState.running ? '运行中' : '已停止'}
已发送：${autoState.sentCount}

【继续模式指令】
${autoCfg.continuePromptsText || '（空）'}

【列表模式指令】
${autoCfg.listPromptsText || '（空）'}

【Prompt 管理】
Prompt 总数：${promptCount}

【上传队列】
分组数：${uploadStatus.groupCount}
当前分组：${uploadStatus.activeGroupName}（${uploadStatus.activeGroupId}）
当前组队列数量：${uploadStatus.total}
已挂载：${uploadStatus.attached}
失败：${uploadStatus.failed}
运行状态：${uploadStatus.running ? '运行中' : '已停止'}
`;
    }
    function stripMarkdownCodeFences(text) {
      return String(text || '').replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');
    }

    function extractJsonObjectsFromText(raw) {
      const text = stripMarkdownCodeFences(raw);
      const out = [];
      let i = 0;

      while (i < text.length) {
        const start = text.indexOf('{', i);

        if (start === -1) break;

        let depth = 0;
        let inStr = false;
        let esc = false;
        let closed = false;

        for (let j = start; j < text.length; j += 1) {
          const c = text[j];

          if (inStr) {
            if (esc) {
              esc = false;
            } else if (c === '\\') {
              esc = true;
            } else if (c === '"') {
              inStr = false;
            }

            continue;
          }

          if (c === '"') {
            inStr = true;
            continue;
          }

          if (c === '{') {
            depth += 1;
          } else if (c === '}') {
            depth -= 1;

            if (depth === 0) {
              const slice = text.slice(start, j + 1);

              try {
                out.push(JSON.parse(slice));
              } catch (e) {
                console.debug('[ChatGPT toolbox] skip invalid JSON candidate', e);
              }

              i = j + 1;
              closed = true;
              break;
            }
          }
        }

        if (!closed) {
          i = start + 1;
        }
      }

      return dedupeParsedObjects(out);
    }

    function dedupeParsedObjects(objs) {
      const seen = new Set();
      const out = [];

      for (const o of objs) {
        try {
          const k = JSON.stringify(o);

          if (seen.has(k)) continue;

          seen.add(k);
          out.push(o);
        } catch (e) {
          console.debug('[ChatGPT toolbox] JSON stringify failed during dedupe', e);
          out.push(o);
        }
      }

      return out;
    }

    function isReviewPayload(obj) {
      return !!(obj && typeof obj === 'object' && Array.isArray(obj.issues));
    }

    function getAssistantMessageFullText(el) {
      if (!el) return '';

      const z = (s) => String(s || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
      const chunks = [];

      qsa('pre, code', el).forEach((node) => {
        if (isInToolbox(node)) return;

        const t = z(node.textContent);
        if (t) chunks.push(t);
      });

      chunks.push(z(el.innerText));
      chunks.push(z(el.textContent));

      return [...new Set(chunks.filter(Boolean))].join('\n\n');
    }

    function scanReviewIssueStats() {
      const assistantEls = ComposerApi.getChatMessageElementsInOrder()
        .filter((el) => (el.getAttribute('data-message-author-role') || '') === 'assistant');

      let jsonBlocks = 0;
      let issueTotal = 0;
      let metaSumDeclared = 0;
      const items = [];

      assistantEls.forEach((el, idx) => {
        const raw = getAssistantMessageFullText(el);
        const payloads = extractJsonObjectsFromText(raw).filter(isReviewPayload);

        payloads.forEach((obj) => {
          jsonBlocks += 1;

          const n = obj.issues.length;
          issueTotal += n;

          const metaCount = obj.meta && typeof obj.meta.issue_count === 'number'
            ? obj.meta.issue_count
            : null;

          if (metaCount != null) {
            metaSumDeclared += metaCount;
          }

          items.push({
            msgIndex: idx + 1,
            qid: obj.qid || '',
            issueCount: n,
            metaIssueCount: metaCount,
          });
        });
      });

      return {
        assistantWithRoleCount: assistantEls.length,
        jsonBlocks,
        issueTotal,
        metaSumDeclared,
        items,
      };
    }

    function applyIssueTotalToTabTitle(issueTotal) {
      TitlePrefixModule.applyIssueTotalToTitle(issueTotal);
    }

    function renderStats() {
      const s = scanReviewIssueStats();

      if (statsLineEl) {
        statsLineEl.textContent =
          `issues 总数：${s.issueTotal} 条；JSON 块：${s.jsonBlocks}；助手消息：${s.assistantWithRoleCount}`;
      }

      applyIssueTotalToTabTitle(s.issueTotal);

      return s;
    }

    const EXPORT_ACTIONS = Object.freeze([
      {
        selector: '#cgpt-export-copy-chat',
        name: 'copy-chat',
        handler: () => copyWithStatus({
          text: buildChatExportText(),
          successText: '已复制完整对话',
          failedPrefix: '复制完整对话失败',
          logPrefix: 'EXPORT_COPY_CHAT',
        }),
      },
      {
        selector: '#cgpt-export-copy-panel',
        name: 'copy-panel',
        handler: () => copyWithStatus({
          text: buildPanelExportText(),
          successText: '已复制工具箱配置',
          failedPrefix: '复制工具箱配置失败',
          logPrefix: 'EXPORT_COPY_PANEL',
        }),
      },
      {
        selector: '#cgpt-export-refresh-stats',
        name: 'refresh-stats',
        handler: () => {
          const s = renderStats();
          ToolboxShell.appendLog(`issues 统计刷新：${s.issueTotal} 条`);
        },
      },
      {
        selector: '#cgpt-export-copy-stats',
        name: 'copy-stats',
        handler: () => {
          const s = renderStats();
          return copyWithStatus({
            text: JSON.stringify(s, null, 2),
            successText: '已复制 issues 统计 JSON',
            failedPrefix: '复制 issues 统计失败',
            logPrefix: 'EXPORT_COPY_STATS',
          });
        },
      },
    ]);

    function bindEvents() {
      EXPORT_ACTIONS.forEach((action) => {
        DomUtil.bindClick(root, action.selector, () => {
          void Promise.resolve(action.handler()).catch((error) => {
            const errText = error && error.message ? error.message : String(error);
            console.error(`[ChatGPT toolbox] Export action failed: ${action.name}`, error);
            ToolboxShell.appendLog(`[EXPORT][${action.name}][failed] error=${errText}`);
          });
        }, 'EXPORT');
      });

      DomUtil.bindClick(root, '#cgpt-export-prompts', () => {
        const data = PromptManagerModule.exportData();
        downloadJsonFile(`chatgpt-prompts-${buildDateStamp()}.json`, data);
        ToolboxShell.appendLog('已导出 Prompt 管理数据');
        ToolboxShell.setStatus('已导出 Prompt 管理数据');
      }, 'EXPORT');

      bindClick(root, '#cgpt-export-settings', () => {
        void (async () => {
          try {
            const payload = await buildSettingsExportPayload();
            downloadJsonFile(`chatgpt-toolbox-settings-${buildDateTimeStamp()}.json`, payload);
            ToolboxShell.appendLog('已导出工具箱设置');
            ToolboxShell.setStatus('已导出工具箱设置');
          } catch (e) {
            const errText = logError('[EXPORT][settings-export]', e);
            ToolboxShell.setStatus(`导出设置失败：${errText}`);
          }
        })();
      }, {
        moduleName: 'ExportModule',
        bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings',
        bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings',
      });

      settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);

      bindClick(root, '#cgpt-export-settings-import', () => {
        if (settingsImportFileEl) {
          settingsImportFileEl.click();
        }
      }, {
        moduleName: 'ExportModule',
        bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings-import',
        bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings-import',
      });

      if (settingsImportFileEl) {
        bindOnce(settingsImportFileEl, 'change', async (event) => {
          try {
            const payload = await readJsonFileFromInput(event, {
              tag: '[SETTINGS_IMPORT]',
            });

            if (!payload) return;

            const ok = await importSettingsPayload(payload);

            if (ok) {
              ToolboxShell.appendLog('已导入工具箱设置');
              ToolboxShell.setStatus('已导入工具箱设置');
            } else {
              ToolboxShell.setStatus('导入失败：文件格式无效');
            }
          } catch (e) {
            const errText = logError('[EXPORT][settings-import]', e);
            ToolboxShell.setStatus(`导入失败：${errText}`);
          }
        });
      }
    }

    async function buildSettingsExportPayload() {
      const uploadGroups = await UploadModule.exportGroupsAndQueueMeta();

      return {
        version: APP.storagePrefix,
        schemaVersion: 4,
        exportedAt: new Date().toISOString(),
        toolbox: MemoryManager.getToolboxState(),
        autoQueueConfig: AutoQueueModule.snapshotConfig(),
        prompts: MemoryManager.get(MemoryManager.KEYS.promptManagerData, []),
        uploadGroups,
      };
    }

    async function importSettingsPayload(payload) {
      if (!payload || typeof payload !== 'object') {
        console.warn('[ChatGPT toolbox] importSettingsPayload: invalid payload', payload);
        return false;
      }

      if (payload.toolbox && typeof payload.toolbox === 'object') {
        MemoryManager.saveToolboxPatch(payload.toolbox);
        ToolboxShell.applyToolboxUiState({
          restoreTab: false,
        });
      }

      if (payload.autoQueueConfig && typeof payload.autoQueueConfig === 'object') {
        MemoryManager.set(MemoryManager.KEYS.autoQueueConfig, payload.autoQueueConfig);
        AutoQueueModule.applyConfig(payload.autoQueueConfig);
      }

      if (payload.prompts != null) {
        MemoryManager.set(MemoryManager.KEYS.promptManagerData, payload.prompts);
        PromptManagerModule.reloadFromStorage();
      }

      if (payload.uploadGroups && typeof payload.uploadGroups === 'object') {
        await UploadModule.importGroupsAndQueueMeta(payload.uploadGroups);
      }

      ToolboxShell.switchTab('upload');

      const autoCfgForUi = payload.autoQueueConfig && typeof payload.autoQueueConfig === 'object'
        ? payload.autoQueueConfig
        : MemoryManager.get(MemoryManager.KEYS.autoQueueConfig, createDefaultAutoConfig());
      AutoQueueModule.applyConfig(autoCfgForUi);
      PromptManagerModule.reloadFromStorage();

      if (typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }

      return true;
    }

    function buildExportChatSectionHtml() {
      return `
        <div class="cgpt-section">
          <div class="cgpt-section-title">对话导出</div>
          <div class="cgpt-hint">复制当前页面对话全文，适合保存审稿、代码审查和长对话上下文。</div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-copy-chat">复制完整对话</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-copy-panel">复制工具箱配置</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-prompts">导出 Prompt</button>
          </div>
        </div>
      `;
    }

    function buildExportStatsSectionHtml() {
      return `
        <div class="cgpt-section">
          <div class="cgpt-section-title">issues 统计</div>
          <div class="cgpt-hint">
            会扫描助手回复中的 JSON 对象，统计形如 {"issues": [...]} 的结果数量，并同步到浏览器标题。
          </div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-refresh-stats">刷新统计</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-copy-stats">复制统计 JSON</button>
          </div>
          <div id="cgpt-export-stats-line" class="cgpt-hint" style="margin-top:8px;">issues 总数：-</div>
        </div>
      `;
    }

    function buildExportSettingsBackupSectionHtml() {
      return `
        <div class="cgpt-section cgpt-export-advanced">
          <div class="cgpt-section-title">设置备份</div>
          <div class="cgpt-hint">
            导出/导入工具 UI 状态、自动指令、Prompt、文件组与队列元数据（默认不含真实文件 Blob）。
          </div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-settings">导出工具箱设置</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-settings-import">导入工具箱设置</button>
            <input type="file" id="cgpt-export-settings-import-file" accept="application/json,.json" class="cgpt-toolbox-hidden">
          </div>
        </div>
      `;
    }

    function buildExportModuleHtml() {
      return `
        ${buildExportChatSectionHtml()}
        ${buildExportStatsSectionHtml()}
        ${buildExportSettingsBackupSectionHtml()}
      `;
    }

    function mount(targetHost) {
      mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-export-module',
        moduleName: 'EXPORT',
        html: buildExportModuleHtml(),
        onRefs: (mountedRoot) => {
          root = mountedRoot;
          statsLineEl = qs('#cgpt-export-stats-line', root);
          settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);
        },
        onBind: () => {
          bindEvents();
        },
        onRender: () => {
          renderStats();
        },
      });
    }

    return {
      mount,
    };
  })();

  /********************************************************************
   * 6. LogModule：工具箱日志
   ********************************************************************/

  const LogModule = (() => {
    const state = {
      lines: [],
    };

    let mounted = false;
    let listEl = null;
    const logBuffer = [];
    const logTimers = createTimerRegistry('LOG');
    let logDomDirty = false;

    function isLogPersistEnabled() {
      return !!MemoryManager.get(MemoryManager.KEYS.logPersistEnabled, false);
    }

    function persistLogLines() {
      if (!isLogPersistEnabled()) return;

      MemoryManager.set(MemoryManager.KEYS.logPersistLines, state.lines.slice(0, 500));
    }

    function loadPersistedLogLines() {
      if (!isLogPersistEnabled()) return;

      const lines = MemoryManager.get(MemoryManager.KEYS.logPersistLines, []);

      if (Array.isArray(lines)) {
        state.lines = lines.slice(0, 500);
      }
    }

    function bindLogPersist(root) {
      const persistEl = qs('#cgpt-log-persist', root);
      if (!persistEl) return;

      bindOnce(persistEl, 'change', () => {
        MemoryManager.set(MemoryManager.KEYS.logPersistEnabled, !!persistEl.checked);

        if (!persistEl.checked) {
          MemoryManager.remove(MemoryManager.KEYS.logPersistLines);
        } else {
          persistLogLines();
        }
      });
    }

    function bindLogCopy(root) {
      bindClick(root, '#cgpt-log-copy', () => {
        if (logTimers.has('log-flush')) {
          logTimers.clearTimeout('log-flush');
          flushLogBuffer();
        }

        const text = state.lines.join('\n');

        void copyWithStatus({
          text,
          successText: '已复制日志',
          failedPrefix: '复制日志失败',
          logPrefix: 'LOG_COPY',
        });
      }, {
        moduleName: 'LogModule',
        bindMissingConsole: '[ChatGPT toolbox] LogModule.bindEvents: 缺少 #cgpt-log-copy',
        bindMissingLog: '[LOG][bind-missing] #cgpt-log-copy',
      });
    }

    function bindLogClear(root) {
      bindClick(root, '#cgpt-log-clear', () => {
        logBuffer.length = 0;

        logTimers.clearTimeout('log-flush');

        state.lines = [];
        logDomDirty = false;
        render();
        persistLogLines();
        ToolboxShell.setStatus('已清空日志');
      }, {
        moduleName: 'LogModule',
        bindMissingConsole: '[ChatGPT toolbox] LogModule.bindEvents: 缺少 #cgpt-log-clear',
        bindMissingLog: '[LOG][bind-missing] #cgpt-log-clear',
      });
    }

    function bindEvents(root) {
      bindLogPersist(root);
      bindLogCopy(root);
      bindLogClear(root);
    }

    const LOG_MODULE_HTML = `
        <div class="cgpt-log-panel">
          <div class="cgpt-log-actions">
            <button type="button" class="cgpt-btn" id="cgpt-log-copy">复制日志</button>
            <button type="button" class="cgpt-btn danger" id="cgpt-log-clear">清空日志</button>
          </div>
          <label class="cgpt-checkbox-line cgpt-log-advanced" style="margin:6px 0 0;">
            <input type="checkbox" id="cgpt-log-persist">
            刷新后保留日志（默认关闭）
          </label>
          <div class="cgpt-log-list" id="cgpt-log-list"></div>
        </div>
      `;

    function mount(targetHost) {
      mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-log-module',
        moduleName: 'LOG',
        html: LOG_MODULE_HTML,
        onRefs: (mountedRoot) => {
          mounted = true;
          const logRefs = collectDomRefs(mountedRoot, {
            list: '#cgpt-log-list',
            persist: {
              selector: '#cgpt-log-persist',
              required: false,
            },
          }, {
            moduleName: 'LOG',
          });
          listEl = logRefs.list;
          if (logRefs.persist) {
            logRefs.persist.checked = isLogPersistEnabled();
          }
          loadPersistedLogLines();
        },
        onBind: (mountedRoot) => {
          bindEvents(mountedRoot);
        },
        onRender: () => {
          render();
        },
      });
    }

    function isLogTabVisible() {
      return typeof ToolboxShell.getActiveTab === 'function'
        && ToolboxShell.getActiveTab() === 'log';
    }

    function flushLogBuffer() {
      logTimers.clearTimeout('log-flush');

      if (!logBuffer.length) {
        return;
      }

      const batch = logBuffer.splice(0, logBuffer.length);

      batch.forEach((text) => {
        const line = `[${nowTimeText()}] ${String(text || '')}`;
        state.lines.unshift(line);
      });

      if (state.lines.length > 500) {
        state.lines.length = 500;
      }

      logDomDirty = true;
      persistLogLines();

      if (mounted && isLogTabVisible()) {
        render();
        logDomDirty = false;
      }
    }

    function flushDomIfNeeded() {
      if (!logDomDirty || !mounted) {
        return;
      }

      if (logTimers.has('log-flush')) {
        return;
      }

      render();
      logDomDirty = false;
    }

    function add(text) {
      logBuffer.push(String(text || ''));

      if (!logTimers.has('log-flush')) {
        logTimers.timeout('log-flush', flushLogBuffer, 200);
      }
    }

    function render() {
      if (!listEl) return;

      if (!state.lines.length) {
        listEl.innerHTML = renderEmptyState('暂无日志', 'cgpt-log-empty cgpt-empty-state');
        return;
      }

      listEl.innerHTML = state.lines
        .map((line) => `<div class="cgpt-log-line">${escapeHtml(line)}</div>`)
        .join('');
    }

    return {
      mount,
      add,
      flushDomIfNeeded,
    };
  })();

  /********************************************************************
   * 7. 初始化入   ********************************************************************/

  async function safeInitStep(name, fn) {
    try {
      await fn();
      return true;
    } catch (e) {
      const errText = logError(`[INIT][${name}]`, e);

      const moduleMatch = String(name || '').match(/^(\w+)\.mount:/);
      if (moduleMatch && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT_FAILED] module=${moduleMatch[1]} error=${errText}`);
        if (typeof ToolboxShell.setStatus === 'function') {
          ToolboxShell.setStatus(`模块初始化失败：${moduleMatch[1]}：${errText}`, 'error');
        }
      }

      return false;
    }
  }

  async function mountAllModules(reason = 'init') {
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT] reason=${reason}`);
    }

    const failedNames = [];

    if (!await safeInitStep(`UploadModule.mount:${reason}`, async () => {
      const initPromise = UploadModule.mount(ToolboxShell.getHost('upload'));
      if (initPromise && typeof initPromise.then === 'function') {
        await initPromise;
      }
    })) {
      failedNames.push('UploadModule');
    }

    if (!await safeInitStep(`AutoQueueModule.mount:${reason}`, () => {
      AutoQueueModule.mount(ToolboxShell.getHost('autoq'));
    })) {
      failedNames.push('AutoQueueModule');
    }

    if (!await safeInitStep(`PromptManagerModule.mount:${reason}`, () => {
      PromptManagerModule.mount(ToolboxShell.getHost('prompt'));
    })) {
      failedNames.push('PromptManagerModule');
    }

    if (!await safeInitStep(`BridgeModule.mount:${reason}`, () => {
      BridgeModule.mount(ToolboxShell.getHost('bridge'));
    })) {
      failedNames.push('BridgeModule');
    }

    if (!await safeInitStep(`ExportModule.mount:${reason}`, () => {
      ExportModule.mount(ToolboxShell.getHost('export'));
    })) {
      failedNames.push('ExportModule');
    }

    if (!await safeInitStep(`LogModule.mount:${reason}`, () => {
      LogModule.mount(ToolboxShell.getHost('log'));
    })) {
      failedNames.push('LogModule');
    }

    if (!await safeInitStep(`SettingsModule.mount:${reason}`, () => {
      SettingsModule.mount(ToolboxShell.getHost('settings'));
    })) {
      failedNames.push('SettingsModule');
    }

    if (failedNames.length && typeof ToolboxShell !== 'undefined') {
      if (ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT_SUMMARY] failed=${failedNames.join('|')}`);
      }
      if (typeof ToolboxShell.setStatus === 'function') {
        ToolboxShell.setStatus(`部分模块初始化失败：${failedNames.join('、')}`, 'error');
      }
    }

    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(`[TOOLBOX_MODULES][MOUNT_DONE] reason=${reason}`);
    }
  }

  async function initToolbox() {
    await safeInitStep('ToolboxShell.create', () => {
      ToolboxShell.create();
    });

    await safeInitStep('TitlePrefixModule.start', () => {
      TitlePrefixModule.start();
    });

    await safeInitStep('ReplyDoneTitleFlashWatcher.start', () => {
      ReplyDoneTitleFlashWatcher.start();
    });

    await mountAllModules('init');

    await safeInitStep('ToolboxShell.applyPageState', async () => {
      const waitUpload = typeof UploadModule !== 'undefined'
        && typeof UploadModule.getUploadInitPromise === 'function'
        ? UploadModule.getUploadInitPromise()
        : Promise.resolve();

      await waitUpload;
      ToolboxShell.applyToolboxPageState('init');
    });

    await safeInitStep('ToolboxShell.appendLog', () => {
      ToolboxShell.appendLog('工具箱初始化完成');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      void initToolbox();
    }, {
      once: true,
    });
  } else {
    void initToolbox();
  }
})();
