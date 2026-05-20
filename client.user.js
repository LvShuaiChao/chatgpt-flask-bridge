// ==UserScript==
// @name         ChatGPT 工具箱：多文件上传 + 自动指令队列 + Prompt 管理
// @namespace    https://github.com/xiaozhang/chatgpt-toolbox
// @version      3.6.2
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
     * ExportModule
     * - 只负责对话导出、配置导出、issues 统计。?
     ********************************************************************/
  
    const APP = Object.freeze({
      rootId: 'cgpt-toolbox-root',
      toggleId: 'cgpt-toolbox-toggle',
      panelId: 'cgpt-toolbox-panel',
      styleId: 'cgpt-toolbox-style',
      edgeHotzoneId: 'cgpt-toolbox-edge-hotzone',
      storagePrefix: 'cgpt_toolbox_tabs_v31:',
      uploadDbName: 'cgpt-toolbox-upload-db-v31',
      uploadDbVersion: 3,
      uploadBlobMaxBytes: 20 * 1024 * 1024,
      uploadStore: 'queue',
      uploadGroupStore: 'groups',
    });
  
    const UploadState = Object.freeze({
      IDLE: 'IDLE',
      READY: 'READY',
      READING: 'READING',
      ATTACHING: 'ATTACHING',
      VERIFYING: 'VERIFYING',
      ATTACHED: 'ATTACHED',
      PENDING_CONFIRM: 'PENDING_CONFIRM',
      PLATFORM_DUPLICATE: 'PLATFORM_DUPLICATE',
      FAILED: 'FAILED',
      CANCELLED: 'CANCELLED',
      MISSING_FILE: 'MISSING_FILE',
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
        'button[aria-label*="发送"]',
        'button[aria-label*="发"]',
        'button[aria-label*="Send"]',
        'button[title*="发送"]',
        'button[title*="发"]',
        'button[title*="Send"]',
        'form button[type="submit"]',
      ],
      stopButton: 'button[data-testid="stop-button"]',
      duplicateDialog: '[role="dialog"], [role="alertdialog"], [aria-modal="true"]',
    });
  
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
  
    const DEFAULT_AUTO_CONFIG = Object.freeze({
      listPromptsText: '请先自我介绍一下\n请再用 3 点总结你能做什么',
      continuePromptsText: '继续',
      promptMode: 'continue',
      listProfiles: [],
      activeListProfileId: '',
    });
  
    const DEFAULT_PROMPTS = Object.freeze([
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
    ]);
  
  
  
  
  
  
  
  
  
  
  
    const DEFAULT_PROMPT_CATEGORIES = Object.freeze([
      { id: 'default', name: '默认', order: 0 },
      { id: 'code', name: '代码', order: 1 },
      { id: 'paper', name: '论文', order: 2 },
      { id: 'cursor', name: 'Cursor', order: 3 },
    ]);
  
    const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  
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
      const fullKey = storageKey(key);
  
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(fullKey, null);
          return v == null ? fallback : v;
        }
      } catch (e) {
        console.warn('[ChatGPT toolbox] GM_getValue failed', key, e);
      }
  
      try {
        const raw = window.localStorage.getItem(fullKey);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        console.warn('[ChatGPT toolbox] localStorage read failed', key, e);
        return fallback;
      }
    }
  
    function writeStorage(key, value) {
      const fullKey = storageKey(key);
  
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue(fullKey, value);
          return;
        }
      } catch (e) {
        console.warn('[ChatGPT toolbox] GM_setValue failed', key, e);
      }
  
      try {
        if (value == null) {
          window.localStorage.removeItem(fullKey);
          return;
        }
  
        window.localStorage.setItem(fullKey, JSON.stringify(value));
      } catch (e) {
        console.warn('[ChatGPT toolbox] localStorage write failed', key, e);
      }
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
  
    const MemoryManager = (() => {
      const KEYS = Object.freeze({
        toolboxTitle: 'toolboxTitle',
        activeTab: 'activeTab',
        panelHidden: 'panelHidden',
        panelPosition: 'panelPosition',
        panelSizeFull: 'panelSizeFull',
        panelSizeCompact: 'panelSizeCompact',
        compactMode: 'compactMode',
        uploadActiveGroupId: 'uploadActiveGroupId',
        uploadBlobPersistEnabled: 'uploadBlobPersistEnabled',
        uploadUseUniqueFileName: 'uploadUseUniqueFileName',
        uploadUseUniqueFileNameMigrated: 'uploadUseUniqueFileNameMigrated',
        autoQueueConfig: 'autoQueueConfig',
        promptManagerData: 'promptManagerData',
        promptManagerActiveCategory: 'promptManagerActiveCategory',
        logPersistEnabled: 'logPersistEnabled',
        logPersistLines: 'logPersistLines',
        compactUiConfig: 'compactUiConfig',
        rememberActiveTab: 'rememberActiveTab',
        edgeAutoHideEnabled: 'edgeAutoHideEnabled',
        edgeHidden: 'edgeHidden',
        edgeSide: 'edgeSide',
      });
  
      const LEGACY_KEYS = Object.freeze({
        autoConfig: 'autoConfig',
        promptManagerPrompts: 'promptManagerPrompts',
        position: 'position',
        panelSize: 'panelSize',
      });
  
      let migrated = false;
  
      function get(key, fallback) {
        return readStorage(key, fallback);
      }
  
      function set(key, value) {
        writeStorage(key, value);
      }
  
      function remove(key) {
        writeStorage(key, null);
      }
  
      function migrateLegacyKeys() {
        if (migrated) return;
        migrated = true;
  
        if (get(KEYS.autoQueueConfig, null) == null) {
          const oldAuto = get(LEGACY_KEYS.autoConfig, null);
          if (oldAuto) {
            set(KEYS.autoQueueConfig, oldAuto);
          }
        }
  
        if (get(KEYS.promptManagerData, null) == null) {
          const oldPrompts = get(LEGACY_KEYS.promptManagerPrompts, null);
          if (oldPrompts) {
            set(KEYS.promptManagerData, oldPrompts);
          }
        }
  
        if (!get(KEYS.uploadUseUniqueFileNameMigrated, false)) {
          if (get(KEYS.uploadUseUniqueFileName, null) == null) {
            set(KEYS.uploadUseUniqueFileName, true);
          }
          set(KEYS.uploadUseUniqueFileNameMigrated, true);
        }
      }
  
      function getToolboxState() {
        migrateLegacyKeys();
  
        return {
          toolboxTitle: get(KEYS.toolboxTitle, '小张工具箱'),
          activeTab: get(KEYS.activeTab, 'upload'),
          panelHidden: !!get(KEYS.panelHidden, false),
          panelPosition: get(KEYS.panelPosition, null),
          panelSizeFull: get(KEYS.panelSizeFull, null),
          panelSizeCompact: get(KEYS.panelSizeCompact, null),
          compactMode: !!get(KEYS.compactMode, false),
          uploadActiveGroupId: get(KEYS.uploadActiveGroupId, ''),
          uploadBlobPersistEnabled: !!get(KEYS.uploadBlobPersistEnabled, true),
          logPersistEnabled: !!get(KEYS.logPersistEnabled, false),
          edgeAutoHideEnabled: get(KEYS.edgeAutoHideEnabled, true) !== false,
          edgeHidden: !!get(KEYS.edgeHidden, false),
          edgeSide: get(KEYS.edgeSide, 'right'),
        };
      }
  
      function saveToolboxPatch(patch) {
        migrateLegacyKeys();
  
        Object.keys(patch || {}).forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(KEYS, key)) {
            console.warn('[ChatGPT toolbox] MemoryManager.saveToolboxPatch: unknown key', key);
            return;
          }
  
          set(KEYS[key], patch[key]);
        });
      }
  
      function saveActiveGroupId(groupId) {
        set(KEYS.uploadActiveGroupId, String(groupId || ''));
      }
  
      migrateLegacyKeys();
  
      return {
        KEYS,
        get,
        set,
        remove,
        getToolboxState,
        saveToolboxPatch,
        saveActiveGroupId,
        migrateLegacyKeys,
      };
    })();
  
    function shouldRememberActiveTab() {
      return !!MemoryManager.get(MemoryManager.KEYS.rememberActiveTab, true);
    }
  
    const DEFAULT_COMPACT_UI_CONFIG = Object.freeze({
      showUploadGroups: true,
      showUploadStartButton: true,
      showUploadFileList: true,
      showUploadQuickPrompts: true,
      showCompactQuickPrompts: true,
      quickPromptIds: [],
      quickPromptClickAction: 'send',
      quickPromptActiveCategory: '全部',
      globalDropCaptureEnabled: false,
    });
  
    function normalizeCompactUiConfig(input) {
      const cfg = Object.assign({}, DEFAULT_COMPACT_UI_CONFIG, input || {});
  
      if (input && !input.quickPromptActionVersion && input.quickPromptClickAction === 'fill') {
        cfg.quickPromptClickAction = 'send';
        cfg.quickPromptActionVersion = 1;
      }
  
      cfg.quickPromptClickAction = cfg.quickPromptClickAction === 'fill' ? 'fill' : 'send';
      cfg.quickPromptActiveCategory = String(cfg.quickPromptActiveCategory || '全部').trim() || '全部';
  
      const legacyShowQuick = input && input.showQuickPrompts !== false;
      if (cfg.showUploadQuickPrompts == null) {
        cfg.showUploadQuickPrompts = legacyShowQuick;
      }
      if (cfg.showCompactQuickPrompts == null) {
        cfg.showCompactQuickPrompts = legacyShowQuick;
      }
      cfg.showQuickPrompts = cfg.showUploadQuickPrompts || cfg.showCompactQuickPrompts;
  
      return cfg;
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
      const el = target instanceof Element ? target : null;
      if (!el) return false;
  
      return !!el.closest('textarea,input,[contenteditable="true"],[role="textbox"]');
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
  
    function downloadTextFile(filename, text, mimeType) {
      const blob = new Blob([text], {
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
  
    const TitlePrefixModule = (() => {
      const PREFIX = 'ChatGPT - ';
  
      let started = false;
      let fixing = false;
      let titleObserver = null;
      let headObserver = null;
      let intervalId = 0;
  
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
  
        intervalId = window.setInterval(() => {
          fixTitle();
        }, 1000);
      }
  
      function stop() {
        if (titleObserver) {
          titleObserver.disconnect();
          titleObserver = null;
        }
  
        if (headObserver) {
          headObserver.disconnect();
          headObserver = null;
        }
  
        if (intervalId) {
          window.clearInterval(intervalId);
          intervalId = 0;
        }
  
        started = false;
      }
  
      function applyIssueTotalToTitle(issueTotal) {
        const base = stripKnownPrefixes(document.title);
        const next = issueTotal > 0
          ? `(${issueTotal}) ${PREFIX}${base || 'ChatGPT'}`
          : `${PREFIX}${base || 'ChatGPT'}`;
  
        document.title = next;
        fixTitle();
      }
  
      return {
        start,
        stripKnownPrefixes,
        applyIssueTotalToTitle,
      };
    })();
  
    /********************************************************************
     * 1. ToolboxShell：统一外壳
     ********************************************************************/
  
    const ToolboxShell = (() => {
      const TOOLBOX_DEFAULT_TITLE = '小张工具箱';
  
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
  
      const EDGE_DOCK_CONTACT_TOLERANCE = 2;
      const EDGE_RESTORE_OFFSET = 24;
      const SHELL_EVENTS_VERSION = 'edge-hide-v6-no-prompt-count-status';
  
      const EDGE_HANDLE_SIZE = Object.freeze({
        width: 110,
        height: 34,
      });
  
      const VALID_EDGE_SIDES = Object.freeze(['left', 'right', 'top', 'bottom']);
  
      let edgeRestoreClickGuardUntil = 0;
      let edgeRevealTimer = 0;
      let edgeRehideGuardUntil = 0;
      let edgeAutoHideSuspendUntil = 0;
      let isDraggingToolbox = false;
      let isResizingToolbox = false;
  
      const EDGE_SNAP_DISTANCE = 36;
      const EDGE_HIDE_VISIBLE_SIZE = 18;
  
      let edgeHotzone = null;
      let edgeHotzoneHovering = false;
      const EDGE_REVEAL_HOTZONE_THICKNESS = 72;
      const EDGE_REVEAL_HOTZONE_EXTRA = 36;
  
      function getEdgeContactLimit() {
        return PANEL_VIEWPORT_MARGIN + EDGE_DOCK_CONTACT_TOLERANCE;
      }
  
      function isStrictlyTouchingEdge(rect, side) {
        if (!rect || !side) return false;
  
        const limit = getEdgeContactLimit();
  
        if (side === 'left') {
          return rect.left <= limit;
        }
  
        if (side === 'right') {
          return window.innerWidth - rect.right <= limit;
        }
  
        if (side === 'top') {
          return rect.top <= limit;
        }
  
        if (side === 'bottom') {
          return window.innerHeight - rect.bottom <= limit;
        }
  
        return false;
      }
      const DRAG_CLICK_THRESHOLD = 5;
      const TOGGLE_CLICK_SUPPRESS_MS = 100;
      const TOOLBOX_DEBUG_DRAG = false;
  
      let toggleDragState = null;
      let suppressToggleClick = false;
  
      const VALID_TABS = Object.freeze(['upload', 'autoq', 'prompt', 'bridge', 'export', 'log', 'settings']);
  
      let root = null;
      let panel = null;
      let titleEl = null;
      let currentActiveTab = 'upload';
      let latestStatusText = '';
      let compactMode = false;
      let panelResizeObserver = null;
      let panelSizeSaveTimer = 0;
      let clampViewportTimer = 0;
      let viewportGuardBound = false;
      let creatingToolbox = false;
      let appendingLog = false;
  
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
            'cgpt-edge-left',
            'cgpt-edge-right',
            'cgpt-edge-top',
            'cgpt-edge-bottom',
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
  
      function applyDragTransform(dx, dy) {
        if (!root) return;
  
        const x = Math.round(dx);
        const y = Math.round(dy);
        const next = `translate3d(${x}px, ${y}px, 0)`;
  
        if (root.style.transform !== next) {
          root.style.transform = next;
        }
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
  
      function injectStyle() {
        const old = document.getElementById(APP.styleId);
        if (old) {
          old.remove();
        }
  
        const style = document.createElement('style');
        style.id = APP.styleId;
        style.textContent = `
          #${APP.rootId} {
            position: fixed;
            right: 16px;
            bottom: 16px;
            z-index: 2147483647;
            font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #f2f2f2;
          }
  
          #${APP.rootId} * {
            box-sizing: border-box;
          }
  
          #${APP.rootId}.cgpt-toolbox-dragging {
            transition: none !important;
            will-change: transform;
            transform-style: preserve-3d;
            backface-visibility: hidden;
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
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 82px;
            height: 34px;
            border: 1px solid #334155;
            background: #111827;
            color: #f8fafc;
            border-radius: 999px;
            padding: 0 12px;
            cursor: grab;
            box-shadow: 0 6px 18px rgba(0,0,0,0.35);
            user-select: none;
            touch-action: none;
          }
  
          #${APP.toggleId}:active {
            cursor: grabbing;
          }
  
          #${APP.toggleId}:hover {
            background: #1f2937;
          }
  
          #${APP.rootId}.cgpt-edge-hidden {
            transition: transform 160ms ease, opacity 160ms ease;
            opacity: 0.72;
          }
  
          #${APP.rootId}.cgpt-edge-hidden:hover {
            transform: none !important;
            opacity: 1;
          }
  
          #${APP.rootId}.cgpt-edge-hidden.cgpt-edge-left {
            transform: translateX(calc(-100% + ${EDGE_HIDE_VISIBLE_SIZE}px));
          }
  
          #${APP.rootId}.cgpt-edge-hidden.cgpt-edge-right {
            transform: translateX(calc(100% - ${EDGE_HIDE_VISIBLE_SIZE}px));
          }
  
          #${APP.rootId}.cgpt-edge-hidden.cgpt-edge-top {
            transform: translateY(calc(-100% + ${EDGE_HIDE_VISIBLE_SIZE}px));
          }
  
          #${APP.rootId}.cgpt-edge-hidden.cgpt-edge-bottom {
            transform: translateY(calc(100% - ${EDGE_HIDE_VISIBLE_SIZE}px));
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden {
            transition: transform 160ms ease;
            opacity: 1;
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden.cgpt-edge-hidden {
            transform: none !important;
            opacity: 1;
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden[data-edge-side="left"] {
            transform: translateX(calc(-100% + ${EDGE_HIDE_VISIBLE_SIZE}px));
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden[data-edge-side="right"] {
            transform: translateX(calc(100% - ${EDGE_HIDE_VISIBLE_SIZE}px));
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden[data-edge-side="top"] {
            transform: translateY(calc(-100% + ${EDGE_HIDE_VISIBLE_SIZE}px));
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden[data-edge-side="bottom"] {
            transform: translateY(calc(100% - ${EDGE_HIDE_VISIBLE_SIZE}px));
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-revealed {
            transition: left 160ms ease, top 160ms ease, transform 160ms ease;
            transform: none !important;
            opacity: 1 !important;
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.panelId} {
            display: none !important;
            pointer-events: none !important;
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-revealed #${APP.panelId} {
            display: flex !important;
            pointer-events: auto !important;
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden #${APP.toggleId},
          #${APP.rootId}.cgpt-toolbox-edge-revealed #${APP.toggleId} {
            min-width: 82px;
            width: auto;
            height: 34px;
            padding: 0 12px;
            writing-mode: horizontal-tb;
            text-orientation: mixed;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            box-shadow: 0 8px 22px rgba(0,0,0,0.42);
            opacity: 0.92;
          }
  
          #${APP.rootId}.cgpt-toolbox-edge-hidden #${APP.toggleId}:hover,
          #${APP.rootId}.cgpt-toolbox-edge-revealed #${APP.toggleId}:hover {
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
  
          #${APP.edgeHotzoneId}.debug {
            background: rgba(59, 130, 246, 0.12);
            outline: 1px dashed rgba(96, 165, 250, 0.45);
          }
  
          #${APP.panelId} {
            display: flex;
            flex-direction: column;
            position: absolute;
            right: 0;
            bottom: 42px;
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
  
          #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-page.active {
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
  
          #${APP.panelId}.cgpt-toolbox-compact #cgpt-toolbox-rename {
            display: none !important;
          }
  
          #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-content {
            padding: 8px;
            overflow-y: auto;
          }
  
          #${APP.panelId}.cgpt-toolbox-compact,
          #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-content,
          #${APP.panelId}.cgpt-toolbox-compact .cgpt-section,
          #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] {
            overflow-x: hidden !important;
          }
  
          #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-section-title,
          #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-hint,
          #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-groups-label {
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
            gap: 5px;
            overflow-x: hidden !important;
            overflow-y: hidden !important;
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
            font-weight: 700;
            color: #f8fafc;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
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
            top: 44px;
            transform: translateX(-50%) translateY(-8px);
            z-index: 5;
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
            gap: 6px;
            padding: 8px;
            overflow-x: auto;
            overflow-y: hidden;
            background: #0f1115;
            border-bottom: 1px solid #2f3542;
            scrollbar-width: thin;
          }
  
          .cgpt-toolbox-tab {
            flex: 0 0 auto;
            min-width: 86px;
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
            gap: 6px;
            overflow-x: auto;
            overflow-y: hidden;
            padding-bottom: 4px;
            margin-bottom: 8px;
          }
  
          .cgpt-upload-quick-prompt-group {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            flex: 0 0 auto;
            height: 26px;
            max-width: 100px;
            padding: 0 9px;
            border: 1px solid #475569;
            background: #171b22;
            color: #d1d5db;
            border-radius: 999px;
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
            overflow: hidden;
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
            gap: 8px;
            align-items: center;
          }
  
          .cgpt-upload-quick-prompt-chip {
            height: 30px;
            max-width: 180px;
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
            overflow-y: auto;
            padding: 10px;
          }
  
          .cgpt-toolbox-page {
            display: none;
          }
  
          .cgpt-toolbox-page.active {
            display: block;
          }
  
          .cgpt-log-panel {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
  
          .cgpt-log-actions {
            display: flex;
            gap: 8px;
            align-items: center;
          }
  
          .cgpt-log-list {
            height: 100%;
            min-height: 260px;
            max-height: calc(100vh - 220px);
            overflow: auto;
            border: 1px solid #2f3542;
            border-radius: 10px;
            background: #0f1115;
            padding: 8px;
            font-family: Consolas, "SFMono-Regular", monospace;
            font-size: 11px;
            color: #cbd5e1;
            white-space: pre-wrap;
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
          }
  
          .cgpt-section-title {
            font-weight: 700;
            margin-bottom: 8px;
            color: #f8fafc;
          }
  
          .cgpt-row {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-top: 8px;
          }
  
          .cgpt-row > * {
            min-width: 0;
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
  
          .cgpt-btn.danger {
            background: #991b1b;
            border-color: #ef4444;
          }
  
          .cgpt-btn.danger:hover {
            background: #b91c1c;
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
  
          #cgpt-upload-start-send:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }
  
          #cgpt-copy-last-message-scroll-bottom {
            background: #ea580c !important;
            border-color: #f97316 !important;
            color: #ffffff !important;
            pointer-events: auto !important;
            user-select: none !important;
            touch-action: manipulation !important;
          }
  
          #cgpt-copy-last-message-scroll-bottom[disabled] {
            pointer-events: auto !important;
          }
  
          #cgpt-copy-last-message-scroll-bottom:hover:not(:disabled) {
            background: #f97316 !important;
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
  
          .cgpt-grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
  
          .cgpt-grid-3 {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
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
  
          .cgpt-progress-track {
            height: 8px;
            background: #0f1115;
            border: 1px solid #334155;
            border-radius: 999px;
            overflow: hidden;
          }
  
          .cgpt-progress-bar {
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #22c55e, #3b82f6);
            transition: width 160ms ease;
          }
  
          .cgpt-upload-groups-head {
            margin-bottom: 8px;
          }
  
          .cgpt-upload-groups-label {
            display: block;
            font-size: 11px;
            color: #94a3b8;
            margin-bottom: 4px;
          }
  
          .cgpt-upload-group-bar {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 6px;
            align-items: center;
          }
  
          .cgpt-upload-group-list {
            display: flex;
            gap: 6px;
            overflow-x: auto;
            padding-bottom: 2px;
          }
  
          .cgpt-chip-name {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
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
            overflow: auto;
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
  
          .cgpt-upload-state {
            display: flex;
            align-items: center;
            justify-content: flex-end;
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
  
          .cgpt-upload-manage-check {
            margin-top: 4px;
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
  
          .cgpt-badge {
            display: inline-flex;
            align-items: center;
            height: 22px;
            padding: 0 7px;
            border-radius: 999px;
            border: 1px solid #475569;
            color: #cbd5e1;
            background: #111827;
            white-space: nowrap;
          }
  
          .cgpt-badge.ok {
            border-color: #22c55e;
            color: #bbf7d0;
          }
  
          .cgpt-badge.warn {
            border-color: #f59e0b;
            color: #fde68a;
          }
  
          .cgpt-badge.err {
            border-color: #ef4444;
            color: #fecaca;
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
            max-height: 320px;
            overflow-y: auto;
            border: 1px solid #2f3542;
            border-radius: 12px;
            background: #0f1115;
          }
  
          .cgpt-prompt-item {
            border-bottom: 1px solid #202633;
            padding: 9px;
          }
  
          .cgpt-prompt-item:last-child {
            border-bottom: none;
          }
  
          .cgpt-prompt-item.clickable {
            cursor: pointer;
          }
  
          .cgpt-prompt-item.clickable:hover {
            background: #172033;
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
  
          .cgpt-prompt-category-bar {
            display: flex;
            gap: 6px;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 4px 0 8px;
            margin-top: 8px;
          }
  
          .cgpt-prompt-category-chip {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            flex: 0 0 auto;
            height: 28px;
            max-width: 120px;
            padding: 0 10px;
            border: 1px solid #475569;
            background: #171b22;
            color: #d1d5db;
            border-radius: 999px;
            cursor: pointer;
            font-size: 12px;
            white-space: nowrap;
            overflow: hidden;
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
            max-height: 220px;
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
              right: -6px;
            }
  
            .cgpt-grid-2,
            .cgpt-grid-3,
            .cgpt-grid-4 {
              grid-template-columns: 1fr;
            }
  
            .cgpt-prompt-actions {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }
        `;
  
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
  
        if (!Number.isFinite(n)) {
          return min;
        }
  
        if (max < min) {
          return min;
        }
  
        return Math.min(Math.max(n, min), max);
      }
  
      function saveCurrentRootPosition(reason) {
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
  
        MemoryManager.saveToolboxPatch({
          panelPosition: {
            left,
            top,
          },
        });
  
        appendLog(`[TOOLBOX_POSITION][SAVE] reason=${reason || '-'} left=${left} top=${top}`);
      }
  
      function clampRootToViewport(reason, options) {
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
          saveCurrentRootPosition(`clamp:${reason || '-'}`);
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
            save: true,
            allowEdgeHidden: true,
          });
        });
  
        window.addEventListener('orientationchange', () => {
          scheduleClampRootToViewport('orientation-change', {
            save: true,
            allowEdgeHidden: true,
          });
        });
  
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            scheduleClampRootToViewport('visibility-visible', {
              save: true,
              allowEdgeHidden: true,
            });
          }
        });
      }
  
      function resetToolboxPosition() {
        if (!root) {
          return;
        }
  
        root.classList.remove('cgpt-toolbox-edge-hidden', 'cgpt-edge-hidden', 'cgpt-toolbox-edge-revealed');
        root.removeAttribute('data-edge-side');
        delete root.dataset.edgeSide;
  
        root.style.left = 'auto';
        root.style.top = 'auto';
        root.style.right = '16px';
        root.style.bottom = '16px';
        root.style.transform = '';
  
        MemoryManager.saveToolboxPatch({
          panelPosition: null,
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
  
      function writeCompactMode(value) {
        compactMode = !!value;
        MemoryManager.set(MemoryManager.KEYS.compactMode, compactMode);
        applyCompactMode({
          save: true,
        });
      }
  
      function getToolboxTitle() {
        return toolboxTitle || TOOLBOX_DEFAULT_TITLE;
      }
  
      function applyToolboxTitle(nextTitle) {
        const text = String(nextTitle || '').trim() || TOOLBOX_DEFAULT_TITLE;
        toolboxTitle = text.slice(0, 40);
  
        if (titleEl) {
          titleEl.textContent = toolboxTitle;
        }
  
        const toggle = qs(`#${APP.toggleId}`, root);
        if (toggle) {
          toggle.textContent = toolboxTitle;
        }
  
        if (titleEl) {
          titleEl.title = latestStatusText
            ? `${toolboxTitle}${latestStatusText}`
            : toolboxTitle;
        }
      }
  
      function saveToolboxTitle(nextTitle) {
        applyToolboxTitle(nextTitle);
        MemoryManager.set(MemoryManager.KEYS.toolboxTitle, toolboxTitle);
      }
  
      function getPanelSizeMemoryKey() {
        return compactMode
          ? MemoryManager.KEYS.panelSizeCompact
          : MemoryManager.KEYS.panelSizeFull;
      }
  
      function normalizeTab(tab) {
        const text = String(tab || '').trim();
        return VALID_TABS.includes(text) ? text : 'upload';
      }
  
      function applyToolboxUiState(options = {}) {
        create();
  
        const mem = MemoryManager.getToolboxState();
  
        applyToolboxTitle(mem.toolboxTitle);
  
        const hidden = !!mem.panelHidden;
  
        if (panel) {
          if (hidden) {
            panel.classList.add('cgpt-toolbox-hidden');
          } else {
            panel.classList.remove('cgpt-toolbox-hidden');
          }
        }
  
        compactMode = !!mem.compactMode;
        applyCompactMode({
          save: false,
        });
  
        const savedPos = mem.panelPosition || {};
        const hasSavedPosition = Number.isFinite(Number(savedPos.left)) && Number.isFinite(Number(savedPos.top));
        const savedSnapEdge = String(savedPos.edge || '').trim();
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
  
            if (savedSnapEdge) {
              root.dataset.snapEdge = savedSnapEdge;
            } else {
              root.dataset.snapEdge = '';
            }
  
            if (mem.panelPosition && !hasSavedPosition) {
              MemoryManager.saveToolboxPatch({
                panelPosition: null,
              });
              root.style.left = 'auto';
              root.style.top = 'auto';
              root.style.right = '16px';
              root.style.bottom = '16px';
              scheduleClampRootToViewport('restore-invalid-position', { save: true, allowEdgeHidden: true });
            } else if (hasSavedPosition) {
              const useRootLeftTop = hidden
                || savedPos.mode === 'left-top'
                || !!savedSnapEdge;
  
              console.debug('[ChatGPT toolbox] restore toolbox position', savedPos);
  
              if (useRootLeftTop) {
                root.style.left = `${Number(savedPos.left)}px`;
                root.style.top = `${Number(savedPos.top)}px`;
                root.style.right = 'auto';
                root.style.bottom = 'auto';
              } else {
                applyPanelPosition(Number(savedPos.left), Number(savedPos.top));
              }
            }
          }
        }
  
        window.requestAnimationFrame(() => {
          if (isEdgeHidden()) {
            applyEdgeHiddenPosition(getEdgeHiddenSide());
            updateEdgeHotzone('applyToolboxUiState');
            scheduleClampRootToViewport('restore-position', { save: true, allowEdgeHidden: true });
          } else if (hidden) {
            keepRootInViewport({
              save: false,
            });
            scheduleClampRootToViewport('restore-position', { save: true, allowEdgeHidden: true });
  
            if (root && root.dataset.snapEdge) {
              snapRootToEdge({
                log: false,
              });
            }
          } else {
            keepPanelInViewport({
              save: false,
            });
            scheduleClampRootToViewport('restore-position', { save: true, allowEdgeHidden: false });
          }
  
          updateEdgeAutoHide();
        });
  
        const rememberActiveTab = shouldRememberActiveTab();
  
        const activeTab = rememberActiveTab
          ? normalizeTab(mem.activeTab || 'upload')
          : 'upload';
  
        if (rememberActiveTab && activeTab !== mem.activeTab) {
          MemoryManager.set(MemoryManager.KEYS.activeTab, activeTab);
        }
  
        if (!rememberActiveTab && mem.activeTab !== 'upload') {
          MemoryManager.set(MemoryManager.KEYS.activeTab, 'upload');
        }
  
        if (options.restoreTab !== false) {
          switchTab(activeTab);
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
  
      function applyCompactMode(options = {}) {
        if (!panel) return;
  
        const shouldSave = options.save === true;
  
        panel.classList.toggle('cgpt-toolbox-compact', compactMode);
  
        const compactBtn = qs('#cgpt-toolbox-compact', root);
        if (compactBtn) {
          compactBtn.textContent = compactMode ? '完整' : '精简';
          compactBtn.title = compactMode ? '切换到完整模式' : '切换到精简模式';
        }
  
        const activeTab = shouldRememberActiveTab()
          ? normalizeTab(MemoryManager.get(MemoryManager.KEYS.activeTab, 'upload'))
          : normalizeTab(currentActiveTab || 'upload');
        switchTab(activeTab);
  
        if (compactMode) {
          panel.setAttribute('data-compact-active-tab', activeTab);
        } else {
          panel.removeAttribute('data-compact-active-tab');
        }
  
        restorePanelSize();
  
        window.setTimeout(() => {
          scheduleClampRootToViewport(compactMode ? 'compact-mode-on' : 'compact-mode-off', {
            save: shouldSave,
            allowEdgeHidden: false,
          });
  
          if (shouldSave) {
            schedulePanelSizeSave();
          }
        }, 0);
  
        if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
          UploadModule.refresh();
        }
      }
  
      function bindCompactButton() {
        const compactBtn = qs('#cgpt-toolbox-compact', root);
        if (!compactBtn || compactBtn.dataset.bound === '1') return;
  
        compactBtn.dataset.bound = '1';
        compactBtn.addEventListener('click', () => {
          writeCompactMode(!compactMode);
        });
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
            ensureEdgeHotzoneElement();
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
            purgeForbiddenStatusBadge('reuse-existing-dom');
  
            const legacyRenameBtn = qs('#cgpt-toolbox-rename', root);
            if (legacyRenameBtn) {
              legacyRenameBtn.remove();
            }
  
            const legacyResetBtn = qs('#cgpt-toolbox-reset-pos', root);
            if (legacyResetBtn) {
              legacyResetBtn.remove();
            }
  
            const legacyHideBtn = qs('#cgpt-toolbox-hide', root);
            if (legacyHideBtn) {
              legacyHideBtn.remove();
            }
  
            const legacyFooter = qs('.cgpt-toolbox-footer', root);
            if (legacyFooter) {
              legacyFooter.remove();
            }
  
            ensureCompactButton();
            bindCompactButton();
            bindEvents();
            applyToolboxUiState({
              restoreTab: false,
            });
  
            window.setTimeout(() => {
              keepPanelInViewport({
                save: false,
              });
            }, 100);
  
            return root;
          }
        }
  
        root = document.createElement('div');
        root.id = APP.rootId;
        root.innerHTML = `
          <button id="${APP.toggleId}" type="button">小张工具箱</button>
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
  
        bindEvents();
        applyToolboxUiState({
          restoreTab: false,
        });
  
        window.setTimeout(() => {
          scheduleClampRootToViewport('create', {
            save: true,
            allowEdgeHidden: true,
          });
        }, 100);
  
        window.setTimeout(() => {
          scheduleClampRootToViewport('create-late', {
            save: true,
            allowEdgeHidden: true,
          });
        }, 500);
  
          bindViewportGuard();
  
          return root;
        } finally {
          creatingToolbox = false;
        }
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
  
        bindToggleDrag();
        bindEdgeHoverReveal();
  
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
        bindDrag();
        bindPanelResizeHandles();
        bindPanelResizePersistence();
  
        window.addEventListener('resize', () => {
          scheduleClampRootToViewport('window-resize(shell)', {
            save: true,
            allowEdgeHidden: true,
          });
  
          if (isEdgeHidden()) {
            applyEdgeHiddenPosition(getEdgeHiddenSide());
            normalizeEdgeVisualState('resize');
            updateEdgeHotzone('window-resize');
            return;
          }
  
          if (isPanelHiddenNow()) {
            keepRootInViewport({
              save: true,
            });
            updateEdgeAutoHide();
            return;
          }
  
          restorePanelSize();
  
          window.setTimeout(() => {
            keepPanelInViewport({
              save: true,
            });
            schedulePanelSizeSave();
            updateEdgeAutoHide();
            scheduleClampRootToViewport('window-resize(panel)', {
              save: true,
              allowEdgeHidden: false,
            });
          }, 0);
        });
  
        root.dataset.shellEventsVersion = SHELL_EVENTS_VERSION;
      }
  
      function switchTab(tab) {
        const nextTab = normalizeTab(tab);
  
        qsa('.cgpt-toolbox-tab', root).forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-tab') === nextTab);
        });
  
        qsa('.cgpt-toolbox-page', root).forEach((page) => {
          page.classList.toggle('active', page.getAttribute('data-page') === nextTab);
        });
  
        currentActiveTab = nextTab;
  
        if (shouldRememberActiveTab()) {
          MemoryManager.set(MemoryManager.KEYS.activeTab, nextTab);
        }
  
        if (panel && compactMode) {
          panel.setAttribute('data-compact-active-tab', nextTab);
        }
  
        if (nextTab === 'log' && typeof LogModule.flushDomIfNeeded === 'function') {
          LogModule.flushDomIfNeeded();
        }
      }
  
      function restoreActiveTab() {
        const rememberActiveTab = shouldRememberActiveTab();
  
        const activeTab = rememberActiveTab
          ? normalizeTab(MemoryManager.get(MemoryManager.KEYS.activeTab, 'upload'))
          : 'upload';
  
        switchTab(activeTab);
        return activeTab;
      }
  
      function getActiveTab() {
        return currentActiveTab || 'upload';
      }
  
      function getCurrentPanelDefaultSize() {
        return compactMode ? PANEL_COMPACT_DEFAULT_SIZE : PANEL_DEFAULT_SIZE;
      }
  
      function clampNumber(value, min, max) {
        const n = Number.parseInt(value, 10);
  
        if (!Number.isFinite(n)) {
          return min;
        }
  
        return Math.max(min, Math.min(max, n));
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
  
        const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - width - PANEL_VIEWPORT_MARGIN);
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
        if (!root || !panel) {
          console.warn('[ChatGPT toolbox] applyPanelPosition: root panel 未初始化');
          return;
        }
  
        const safe = clampPanelPosition({
          left,
          top,
        });
  
        const rootRect = root.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
  
        const offsetLeft = panelRect.left - rootRect.left;
        const offsetTop = panelRect.top - rootRect.top;
  
        applyRootPosition(safe.left - offsetLeft, safe.top - offsetTop);
      }
  
      function normalizeEdgeSide(side) {
        const text = String(side || '').trim();
        return VALID_EDGE_SIDES.includes(text) ? text : 'right';
      }
  
      function isEdgeAutoHideEnabled() {
        return MemoryManager.get(MemoryManager.KEYS.edgeAutoHideEnabled, true) !== false;
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
            'cgpt-edge-left',
            'cgpt-edge-right',
            'cgpt-edge-top',
            'cgpt-edge-bottom',
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
  
        MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
  
        edgeRehideGuardUntil = Date.now() + 300;
  
        appendLog(`[TOOLBOX_EDGE][reveal] reason=${reasonText} side=${root.dataset.edgeSide || '-'}`);
  
        normalizeEdgeVisualState(`reveal:${reasonText}`);
        applyFullRevealPositionFromEdge(reasonText);
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
  
          root.classList.remove('cgpt-toolbox-edge-revealed');
          applyEdgeHiddenPosition(side);
  
          normalizeEdgeVisualState(`rehide:${reasonText}`);
          updateEdgeHotzone(`rehide:${reasonText}`);
  
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
  
        const distances = [
          { side: 'left', value: panelRect.left },
          { side: 'right', value: window.innerWidth - panelRect.right },
          { side: 'top', value: panelRect.top },
          { side: 'bottom', value: window.innerHeight - panelRect.bottom },
        ];
  
        distances.sort((a, b) => a.value - b.value);
  
        const nearest = distances[0];
  
        if (!nearest) return '';
  
        return nearest.side;
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
  
        if (!side || !VALID_EDGE_SIDES.includes(side)) {
          hideEdgeHotzone(`invalid-side:${reasonText}`);
          return;
        }
  
        const extra = EDGE_REVEAL_HOTZONE_EXTRA;
        const thickness = EDGE_REVEAL_HOTZONE_THICKNESS;
  
        edgeHotzone.classList.add('active');
  
        if (side === 'right') {
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
        } else if (side === 'left') {
          const height = Math.min(window.innerHeight, size.height + EDGE_HANDLE_SIZE.height + extra * 2);
          const top = Math.max(
            0,
            Math.min(
              window.innerHeight - height,
              rootRect.top - size.height - extra,
            ),
          );
  
          Object.assign(edgeHotzone.style, {
            left: '0px',
            right: '',
            top: `${Math.round(top)}px`,
            bottom: '',
            width: `${thickness}px`,
            height: `${Math.round(height)}px`,
          });
        } else if (side === 'top') {
          const width = Math.min(window.innerWidth, size.width + EDGE_HANDLE_SIZE.width + extra * 2);
          const left = Math.max(
            0,
            Math.min(
              window.innerWidth - width,
              rootRect.left - extra,
            ),
          );
  
          Object.assign(edgeHotzone.style, {
            left: `${Math.round(left)}px`,
            right: '',
            top: '0px',
            bottom: '',
            width: `${Math.round(width)}px`,
            height: `${thickness}px`,
          });
        } else if (side === 'bottom') {
          const width = Math.min(window.innerWidth, size.width + EDGE_HANDLE_SIZE.width + extra * 2);
          const left = Math.max(
            0,
            Math.min(
              window.innerWidth - width,
              rootRect.left - extra,
            ),
          );
  
          Object.assign(edgeHotzone.style, {
            left: `${Math.round(left)}px`,
            right: '',
            top: '',
            bottom: '0px',
            width: `${Math.round(width)}px`,
            height: `${thickness}px`,
          });
        }
  
        appendLog(`[TOOLBOX_EDGE][hotzone:update] side=${side} reason=${reasonText}`);
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
  
      function applyEdgeHiddenPosition(side) {
        if (!root) return;
  
        const nextSide = normalizeEdgeSide(side);
        const current = getRootCurrentPosition();
        const size = getEdgeHiddenRootSize();
  
        let left = current.left;
        let top = current.top;
  
        if (nextSide === 'left') {
          left = PANEL_VIEWPORT_MARGIN;
          top = clampEdgeNumber(
            current.top,
            PANEL_VIEWPORT_MARGIN,
            window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN,
          );
        } else if (nextSide === 'right') {
          left = window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN;
          top = clampEdgeNumber(
            current.top,
            PANEL_VIEWPORT_MARGIN,
            window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN,
          );
        } else if (nextSide === 'top') {
          left = clampEdgeNumber(
            current.left,
            PANEL_VIEWPORT_MARGIN,
            window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN,
          );
          top = PANEL_VIEWPORT_MARGIN;
        } else if (nextSide === 'bottom') {
          left = clampEdgeNumber(
            current.left,
            PANEL_VIEWPORT_MARGIN,
            window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN,
          );
          top = window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN;
        }
  
        applyRootPosition(left, top);
        scheduleClampRootToViewport('after-edge-hide', {
          save: true,
          allowEdgeHidden: true,
        });
      }
  
      function buildRestorePositionFromEdge(side, size) {
        const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        const width = Number(size && size.width) || PANEL_DEFAULT_SIZE.width;
        const height = Number(size && size.height) || PANEL_DEFAULT_SIZE.height;
  
        const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - width - PANEL_VIEWPORT_MARGIN);
        const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - height - PANEL_VIEWPORT_MARGIN);
  
        let left = Number.isFinite(Number(saved.left)) ? Number(saved.left) : PANEL_VIEWPORT_MARGIN;
        let top = Number.isFinite(Number(saved.top)) ? Number(saved.top) : PANEL_VIEWPORT_MARGIN;
  
        const nextSide = normalizeEdgeSide(side);
  
        if (nextSide === 'left') {
          left = PANEL_VIEWPORT_MARGIN + EDGE_RESTORE_OFFSET;
        } else if (nextSide === 'right') {
          left = maxLeft - EDGE_RESTORE_OFFSET;
        } else if (nextSide === 'top') {
          top = PANEL_VIEWPORT_MARGIN + EDGE_RESTORE_OFFSET;
        } else if (nextSide === 'bottom') {
          top = maxTop - EDGE_RESTORE_OFFSET;
        }
  
        return {
          left: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(left, maxLeft)),
          top: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop)),
        };
      }
  
      function buildRevealPositionFromEdge(side, size) {
        const nextSide = normalizeEdgeSide(side);
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
  
        let left = currentPanelRect && currentPanelRect.left > 0
          ? currentPanelRect.left
          : maxLeft;
  
        let top = currentPanelRect && currentPanelRect.top > 0
          ? currentPanelRect.top
          : PANEL_VIEWPORT_MARGIN;
  
        if (nextSide === 'right') {
          left = maxLeft;
        } else if (nextSide === 'left') {
          left = PANEL_VIEWPORT_MARGIN;
        } else if (nextSide === 'top') {
          top = PANEL_VIEWPORT_MARGIN;
        } else if (nextSide === 'bottom') {
          top = maxTop;
        }
  
        left = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(left, maxLeft));
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
  
          const pos = buildRevealPositionFromEdge(side, size);
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
  
        const nextSide = normalizeEdgeSide(side);
  
        clearEdgeRevealTimer();
  
        savePanelPositionFromDom();
  
        root.classList.remove(
          'cgpt-edge-hidden',
          'cgpt-edge-left',
          'cgpt-edge-right',
          'cgpt-edge-top',
          'cgpt-edge-bottom',
        );
        root.dataset.snapEdge = '';
  
        applyEdgeHiddenPosition(nextSide);
  
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
      }
  
      function restorePanelFromEdgeHidden(reason = 'unknown') {
        if (!root || !panel) {
          console.warn('[ChatGPT toolbox] restorePanelFromEdgeHidden: root 或 panel 不存在');
          return;
        }
  
        if (!isEdgeHidden()) return;
  
        const reasonText = String(reason || 'unknown');
  
        clearEdgeRevealTimer();
  
        hideEdgeHotzone(`restore:${reasonText}`);
  
        const side = getEdgeHiddenSide();
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
  
        root.classList.remove('cgpt-toolbox-edge-hidden', 'cgpt-toolbox-edge-revealed');
        root.classList.remove(
          'cgpt-edge-hidden',
          'cgpt-edge-left',
          'cgpt-edge-right',
          'cgpt-edge-top',
          'cgpt-edge-bottom',
        );
        root.removeAttribute('data-edge-side');
        delete root.dataset.edgeSide;
        root.dataset.snapEdge = '';
  
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
  
          appendLog(`[TOOLBOX_EDGE][panel-restore] reason=${reasonText} horizontal=true reposition=skip-drag-out`);
          return;
        }
  
        window.requestAnimationFrame(() => {
          const pos = buildRestorePositionFromEdge(side, size);
          applyPanelPosition(pos.left, pos.top);
  
          scheduleClampRootToViewport('edge-reveal', {
            save: true,
            allowEdgeHidden: false,
          });
  
          updateEdgeAutoHide();
  
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
        if (isDraggingToolbox) {
          appendLog(`[TOOLBOX_EDGE][auto-hide-skip] reason=${reason || '-'} dragging=1`);
          return;
        }
  
        if (isEdgeAutoHideSuspended()) {
          appendLog(`[TOOLBOX_EDGE][auto-hide-skip] reason=${reason} auto-hide-suspended`);
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
          if (isEdgeHidden()) {
            restorePanelFromEdgeHidden('settings-disabled');
          }
  
          clearFloatEdgeHiddenClasses();
  
          root.classList.remove(
            'cgpt-edge-hidden',
            'cgpt-edge-left',
            'cgpt-edge-right',
            'cgpt-edge-top',
            'cgpt-edge-bottom',
          );
  
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
            clampRootToViewport('resize-end', {
              save: true,
              allowEdgeHidden: false,
            });
          });
  
          savePanelSizeFromDom();
  
          if (isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed')) {
            scheduleHidePanelToEdge('resize-end', 500);
          }
  
          if (isEdgeHidden()) {
            updateEdgeHotzone('resize-end');
          }
  
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
  
      function savePanelPositionFromDom() {
        if (!panel) {
          console.warn('[ChatGPT toolbox] savePanelPositionFromDom: panel 未初始化');
          return;
        }
  
        const rect = panel.getBoundingClientRect();
  
        const pos = clampPanelPosition({
          left: Math.round(rect.left),
          top: Math.round(rect.top),
        });
  
        MemoryManager.set(MemoryManager.KEYS.panelPosition, pos);
  
        if (TOOLBOX_DEBUG_DRAG) {
          console.debug('[ChatGPT toolbox] save panel position', pos);
        }
      }
  
      function keepPanelInViewport(options = {}) {
        if (!root || !panel) {
          console.warn('[ChatGPT toolbox] keepPanelInViewport: root panel 未初始化');
          return;
        }
  
        if (panel.classList.contains('cgpt-toolbox-hidden')) {
          if (TOOLBOX_DEBUG_DRAG) {
            console.debug('[ChatGPT toolbox] keepPanelInViewport: 面板已隐藏，跳过校正');
          }
          return;
        }
  
        if (isEdgeHidden()) {
          if (TOOLBOX_DEBUG_DRAG) {
            console.debug('[ChatGPT toolbox] keepPanelInViewport: 贴边隐藏中，跳过校正');
          }
          return;
        }
  
        const shouldSave = options.save === true;
  
        const rootRect = root.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
  
        let targetPanelLeft = panelRect.left;
        let targetPanelTop = panelRect.top;
  
        if (panelRect.left < PANEL_VIEWPORT_MARGIN) {
          targetPanelLeft = PANEL_VIEWPORT_MARGIN;
        }
  
        if (panelRect.right > window.innerWidth - PANEL_VIEWPORT_MARGIN) {
          targetPanelLeft -= panelRect.right - (window.innerWidth - PANEL_VIEWPORT_MARGIN);
        }
  
        if (panelRect.top < PANEL_VIEWPORT_MARGIN) {
          targetPanelTop = PANEL_VIEWPORT_MARGIN;
        }
  
        if (panelRect.bottom > window.innerHeight - PANEL_VIEWPORT_MARGIN) {
          targetPanelTop -= panelRect.bottom - (window.innerHeight - PANEL_VIEWPORT_MARGIN);
        }
  
        targetPanelLeft = Math.max(PANEL_VIEWPORT_MARGIN, targetPanelLeft);
        targetPanelTop = Math.max(PANEL_VIEWPORT_MARGIN, targetPanelTop);
  
        const offsetLeft = panelRect.left - rootRect.left;
        const offsetTop = panelRect.top - rootRect.top;
  
        const nextRootLeft = targetPanelLeft - offsetLeft;
        const nextRootTop = targetPanelTop - offsetTop;
  
        const currentRootPos = getRootCurrentPosition();
  
        if (
          Math.abs(nextRootLeft - currentRootPos.left) > 0.5 ||
          Math.abs(nextRootTop - currentRootPos.top) > 0.5
        ) {
          if (TOOLBOX_DEBUG_DRAG) {
            console.debug('[ChatGPT toolbox] keepPanelInViewport: 修正面板位置', {
              panelRect: {
                left: panelRect.left,
                top: panelRect.top,
                right: panelRect.right,
                bottom: panelRect.bottom,
              },
              targetPanel: {
                left: targetPanelLeft,
                top: targetPanelTop,
              },
              rootMove: {
                from: currentRootPos,
                to: { left: nextRootLeft, top: nextRootTop },
              },
              viewport: {
                width: window.innerWidth,
                height: window.innerHeight,
              },
            });
          }
  
          applyRootPosition(nextRootLeft, nextRootTop);
  
          if (shouldSave) {
            savePanelPositionFromDom();
          }
        }
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
  
      function savePanelSizeFromDom() {
        if (!panel) return;
  
        if (isEdgeHidden()) return;
  
        if (panel.classList.contains('cgpt-toolbox-hidden')) return;
  
        const rect = panel.getBoundingClientRect();
  
        if (rect.width <= 0 || rect.height <= 0) {
          console.warn('[ChatGPT toolbox] savePanelSizeFromDom: invalid rect', rect);
          return;
        }
  
        const next = normalizePanelSize({
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
  
        MemoryManager.set(getPanelSizeMemoryKey(), next);
  
        if (TOOLBOX_DEBUG_DRAG) {
          console.debug('[ChatGPT toolbox] save panel size', getPanelSizeMemoryKey(), next);
        }
  
        keepPanelInViewport({
          save: false,
        });
      }
  
      function schedulePanelSizeSave() {
        if (isDraggingToolbox) {
          return;
        }
  
        if (panelSizeSaveTimer) {
          window.clearTimeout(panelSizeSaveTimer);
        }
  
        panelSizeSaveTimer = window.setTimeout(() => {
          savePanelSizeFromDom();
        }, 200);
      }
  
      function bindPanelResizePersistence() {
        if (!panel || panelResizeObserver) return;
  
        if (typeof ResizeObserver !== 'function') {
          console.warn('[ChatGPT toolbox] ResizeObserver 不可用，面板宽高不会自动保存');
          return;
        }
  
        panelResizeObserver = new ResizeObserver(() => {
          schedulePanelSizeSave();
        });
  
        panelResizeObserver.observe(panel);
      }
  
      function clearFloatEdgeHiddenClasses() {
        if (!root) return;
  
        root.classList.remove(
          'cgpt-edge-hidden',
          'cgpt-edge-left',
          'cgpt-edge-right',
          'cgpt-edge-top',
          'cgpt-edge-bottom',
        );
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
          Math.min(window.innerWidth - width - PANEL_VIEWPORT_MARGIN, left),
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
          MemoryManager.set(MemoryManager.KEYS.panelPosition, {
            ...saved,
            left: safeLeft,
            top: safeTop,
            mode: 'left-top',
            edge: root.dataset.snapEdge || saved.edge || '',
          });
        }
      }
  
      function getNearestEdge(left, top, width, height) {
        const distances = [
          { edge: 'left', value: left },
          { edge: 'right', value: window.innerWidth - left - width },
          { edge: 'top', value: top },
          { edge: 'bottom', value: window.innerHeight - top - height },
        ];
  
        distances.sort((a, b) => a.value - b.value);
  
        return distances[0];
      }
  
      function snapRootToEdge(options = {}) {
        if (!root) return;
  
        const rect = root.getBoundingClientRect();
        const nearest = getNearestEdge(rect.left, rect.top, rect.width, rect.height);
  
        let left = rect.left;
        let top = rect.top;
        let edge = '';
        let shouldDock = false;
  
        if (nearest.value <= EDGE_SNAP_DISTANCE) {
          edge = nearest.edge;
  
          if (edge === 'left') {
            left = PANEL_VIEWPORT_MARGIN;
          } else if (edge === 'right') {
            left = window.innerWidth - rect.width - PANEL_VIEWPORT_MARGIN;
          } else if (edge === 'top') {
            top = PANEL_VIEWPORT_MARGIN;
          } else if (edge === 'bottom') {
            top = window.innerHeight - rect.height - PANEL_VIEWPORT_MARGIN;
          }
  
          shouldDock = nearest.value <= getEdgeContactLimit();
        }
  
        setRootLeftTop(left, top, {
          save: false,
        });
  
        const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        MemoryManager.set(MemoryManager.KEYS.panelPosition, {
          ...saved,
          left,
          top,
          mode: 'left-top',
          edge: shouldDock ? edge : '',
        });
  
        root.dataset.snapEdge = shouldDock ? edge : '';
  
        if (shouldDock && edge && isEdgeAutoHideEnabled()) {
          dockPanelToEdge(edge, 'toggle-drag-snap');
  
          if (options.log) {
            appendLog(`[TOOLBOX_DRAG][snap] edge=${edge} left=${Math.round(left)} top=${Math.round(top)} docked=true touching=true`);
          }
  
          return;
        }
  
        updateEdgeAutoHide();
  
        if (options.log) {
          appendLog(
            `[TOOLBOX_DRAG][snap] edge=${edge || '-'} left=${Math.round(left)} top=${Math.round(top)} docked=false touching=${shouldDock}`,
          );
        }
      }
  
      function isPanelHiddenNow() {
        return !!(panel && panel.classList.contains('cgpt-toolbox-hidden'));
      }
  
      function updateEdgeAutoHide() {
        if (!root) return;
  
        if (isEdgeHidden()) {
          clearFloatEdgeHiddenClasses();
          appendLog('[TOOLBOX_EDGE][float-auto-hide-skip] reason=panel-edge-hidden');
          return;
        }
  
        const enabled = isEdgeAutoHideEnabled();
        const edge = root.dataset.snapEdge || '';
        const panelHidden = isPanelHiddenNow();
        const shouldHide = enabled && !!edge && panelHidden && !isEdgeHidden();
  
        root.classList.toggle('cgpt-edge-hidden', shouldHide);
        root.classList.toggle('cgpt-edge-left', shouldHide && edge === 'left');
        root.classList.toggle('cgpt-edge-right', shouldHide && edge === 'right');
        root.classList.toggle('cgpt-edge-top', shouldHide && edge === 'top');
        root.classList.toggle('cgpt-edge-bottom', shouldHide && edge === 'bottom');
  
        appendLog(
          `[TOOLBOX_EDGE][float-auto-hide-check] enabled=${enabled} panelHidden=${panelHidden} edge=${edge || '-'} shouldHide=${shouldHide} horizontal=true`,
        );
  
        if (shouldHide) {
          appendLog(`[TOOLBOX_EDGE][float-auto-hide] edge=${edge} horizontal=true`);
        }
      }
  
      function showPanel() {
        if (!panel) return;
  
        clearFloatEdgeHiddenClasses();
        panel.classList.remove('cgpt-toolbox-hidden');
        MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
        appendLog('[TOOLBOX_EDGE][panel-show]');
        updateEdgeAutoHide();
      }
  
      function hidePanel() {
        if (!panel) return;
  
        panel.classList.add('cgpt-toolbox-hidden');
        MemoryManager.set(MemoryManager.KEYS.panelHidden, true);
  
        const edge = root?.dataset?.snapEdge || '';
        appendLog(`[TOOLBOX_EDGE][panel-hide] edge=${edge || '-'}`);
        updateEdgeAutoHide();
      }
  
      function togglePanelHidden() {
        if (!panel) {
          console.warn('[ChatGPT toolbox] togglePanelHidden: panel 不存在');
          appendLog('[TOOLBOX_EDGE][toggle] panel 不存在');
          return;
        }
  
        if (panel.classList.contains('cgpt-toolbox-hidden')) {
          showPanel();
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
          restorePanelFromEdgeHidden(reasonText);
          appendLog(`[TOOLBOX_EDGE][drag-out-restore] type=panel-edge-hidden reason=${reasonText}`);
          return;
        }
  
        if (root.classList.contains('cgpt-edge-hidden') || panel.classList.contains('cgpt-toolbox-hidden')) {
          root.dataset.snapEdge = '';
  
          root.classList.remove(
            'cgpt-edge-hidden',
            'cgpt-edge-left',
            'cgpt-edge-right',
            'cgpt-edge-top',
            'cgpt-edge-bottom',
          );
  
          panel.classList.remove('cgpt-toolbox-hidden');
          MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
  
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
              clampRootToViewport('drag-end', {
                save: true,
                allowEdgeHidden: true,
              });
              snapRootToEdge({
                log: true,
              });
              saveCurrentRootPosition('drag-end');
            });
          } else {
            appendLog('[TOOLBOX_DRAG][toggle-up] moved=false');
          }
        };
  
        toggle.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          if (!root) return;
  
          clearEdgeRevealTimer();
          exitEdgeHiddenStateForDragStart();
          isDraggingToolbox = true;
  
          const wasHiddenBeforeDrag =
            isEdgeHidden() ||
            root.classList.contains('cgpt-edge-hidden') ||
            isPanelHiddenNow();
  
          if (wasHiddenBeforeDrag) {
            restorePanelForToggleDragOut('toggle-drag-start');
          }
  
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
            restoredFromHidden: wasHiddenBeforeDrag,
            wasPanelEdgeHidden: isEdgeHidden(),
            wasFloatEdgeHidden: root.classList.contains('cgpt-edge-hidden'),
            wasPanelHidden: isPanelHiddenNow(),
          };
  
          root.style.transform = '';
          root.classList.add('cgpt-toolbox-dragging');
          addGlobalDraggingClass();
  
          appendLog(`[TOOLBOX_DRAG][toggle-down] left=${Math.round(rect.left)} top=${Math.round(rect.top)}`);
  
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
            toggleDragState.moved = true;
            suppressToggleClick = true;
          }
  
          if (!toggleDragState.moved) return;
  
          e.preventDefault();
  
          toggleDragState.latestDx = dx;
          toggleDragState.latestDy = dy;
  
          if (toggleDragState.dragRafId) return;
  
          toggleDragState.dragRafId = window.requestAnimationFrame(() => {
            toggleDragState.dragRafId = 0;
  
            if (!toggleDragState || !root) return;
  
            toggleDragState.committedDx = toggleDragState.latestDx;
            toggleDragState.committedDy = toggleDragState.latestDy;
  
            applyDragTransform(toggleDragState.committedDx, toggleDragState.committedDy);
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
  
          if (root) {
            root.classList.remove('cgpt-edge-hidden');
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
            return;
          }
  
          if (Date.now() < edgeRestoreClickGuardUntil) {
            return;
          }
  
          if (isEdgeHidden()) {
            restorePanelFromEdgeHidden('toggle-click');
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
  
            applyDragTransform(committedDx, committedDy);
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
  
          applyRootPosition(finalLeft, finalTop);
  
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
  
          appendLog(`[TOOLBOX_DRAG][drag-end] left=${Math.round(finalLeft)} top=${Math.round(finalTop)}`);
  
          schedulePostDragLayout(() => {
            keepPanelInViewport({
              save: false,
            });
            savePanelPositionFromDom();
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
  
          ensureRootPositionAnchored();
  
          const pos = getRootCurrentPosition();
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
        ].includes(normalizedType)) {
          return normalizedType;
        }
        const value = String(text || '');
        if (/失败|错误|异常|超时|缺少|不可用|无法|未找到/.test(value)) {
          return 'error';
        }
        if (/等待|正在|上传中|复制中|同步中|处理中|轮询中/.test(value)) {
          return 'running';
        }
        if (/成功|完成|已复制|已上传|已发送|在线|已绑定/.test(value)) {
          return 'success';
        }
        if (/离线|未绑定|需要|跳过|暂无|未知/.test(value)) {
          return 'warn';
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
  
        if (statusType === 'error' || statusType === 'warn' || statusType === 'offline') {
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
          if (/离线/.test(value)) return '离线';
          return '提醒';
        }
  
        if (statusType === 'offline') {
          return '离线';
        }
  
        if (statusType === 'online') {
          return '在线';
        }
  
        if (statusType === 'running') {
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
  
      function showToast(text, type = 'info', timeoutMs = 1400) {
        create();
        const toastType = inferStatusType(text, type);
        let box = qs('#cgpt-toolbox-toast', root);
        if (!box) {
          box = document.createElement('div');
          box.id = 'cgpt-toolbox-toast';
          box.className = 'cgpt-toolbox-toast';
          root.appendChild(box);
        }
        box.textContent = String(text || '');
        box.classList.remove(
          'cgpt-toast-idle',
          'cgpt-toast-running',
          'cgpt-toast-success',
          'cgpt-toast-warn',
          'cgpt-toast-error',
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
      }
  
      function appendLog(text) {
        const message = String(text || '');
  
        if (appendingLog) {
          console.debug('[ChatGPT toolbox][LOG_REENTER]', message);
          return;
        }
  
        appendingLog = true;
  
        try {
          if (creatingToolbox) {
            LogModule.add(message);
            return;
          }
  
          if (!root) {
            LogModule.add(message);
            return;
          }
  
          create();
          LogModule.add(message);
        } finally {
          appendingLog = false;
        }
      }
  
      return {
        create,
        getHost,
        setStatus,
        showToast,
        appendLog,
        purgeForbiddenStatusBadge,
        switchTab,
        normalizeTab,
        restoreActiveTab,
        getActiveTab,
        applyToolboxUiState,
        getToolboxTitle,
        setEdgeAutoHideEnabled,
        suspendEdgeAutoHide,
        resetToolboxPosition,
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
  
    function getMessageContentElement(el) {
      if (!el) return null;
  
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
      ];
  
      for (const selector of selectors) {
        const node = el.querySelector(selector);
        if (node && node instanceof HTMLElement && !isInToolbox(node)) {
          const text = String(node.innerText || node.textContent || '').trim();
          if (text) {
            return node;
          }
        }
      }
  
      return el;
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
  
      const rawText = String(clone.innerText || clone.textContent || '');
  
      return cleanCopiedMessageText(rawText);
    }
  
    function findConversationMessageElements() {
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
  
          const rect = container.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
  
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
  
    function findLastConversationMessageElement() {
      const messages = findConversationMessageElements();
  
      if (!messages.length) {
        return null;
      }
  
      return messages[messages.length - 1] || null;
    }
  
    function getConversationMainRoot() {
      const lastMessage = findLastConversationMessageElement();
  
      if (lastMessage) {
        const root = lastMessage.closest(
          [
            'main',
            '[role="main"]',
            '[data-testid="conversation-turns"]',
            '[data-testid^="conversation"]',
          ].join(','),
        );
  
        if (root && !isInToolbox(root) && !isChatSidebarElement(root)) {
          return root;
        }
      }
  
      const composer = qs('[data-testid="composer"]');
      if (composer) {
        const root = composer.closest('main, [role="main"]');
        if (root && !isInToolbox(root) && !isChatSidebarElement(root)) {
          return root;
        }
      }
  
      const main = qs('main');
      if (main && !isInToolbox(main) && !isChatSidebarElement(main)) {
        return main;
      }
  
      return null;
    }
  
    function getChatScrollContainers() {
      const containers = [];
      const mainRoot = getConversationMainRoot();
      const lastMessage = findLastConversationMessageElement();
  
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
      add(mainRoot);
  
      let node = lastMessage instanceof HTMLElement ? lastMessage.parentElement : null;
  
      while (node && node !== document.body && node !== document.documentElement) {
        if (isInToolbox(node)) {
          node = node.parentElement;
          continue;
        }
  
        if (isChatSidebarElement(node)) {
          node = node.parentElement;
          continue;
        }
  
        const style = window.getComputedStyle(node);
        const overflowY = String(style.overflowY || '').toLowerCase();
        const canScroll =
          ['auto', 'scroll'].includes(overflowY) && node.scrollHeight > node.clientHeight + 24;
  
        if (canScroll) {
          add(node);
        }
  
        if (node === mainRoot) {
          break;
        }
  
        node = node.parentElement;
      }
  
      ToolboxShell.appendLog(`[CHAT_PAGE][scroll-containers] count=${containers.length}`);
  
      return containers;
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
  
        const lastMessage = findLastConversationMessageElement();
        if (lastMessage && typeof lastMessage.scrollIntoView === 'function') {
          try {
            lastMessage.scrollIntoView({
              block: 'end',
              inline: 'nearest',
              behavior: 'auto',
            });
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.warn('[ChatGPT toolbox] last message scrollIntoView failed', err);
            ToolboxShell.appendLog(`[CHAT_PAGE][force-end:last-message-failed] reason=${reasonText} stage=${stage} error=${errText}`);
          }
        }
      };
  
      runOnce('immediate');
  
      await sleep(50);
      runOnce('50ms');
  
      await sleep(150);
      runOnce('200ms');
  
      await sleep(300);
      runOnce('500ms');
  
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
  
    function getLastConversationMessageText(options = {}) {
      const preferAssistant = options.preferAssistant !== false;
      const messages = findConversationMessageElements();
  
      if (!messages.length) {
        return {
          ok: false,
          text: '',
          role: '',
          reason: 'no-message-elements',
        };
      }
  
      const reversed = messages.slice().reverse();
  
      if (preferAssistant) {
        for (const el of reversed) {
          const role = getMessageRole(el);
          if (role && role !== 'assistant') continue;
  
          const text = getVisibleTextFromElement(el);
          if (!text) continue;
  
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:text-picked] role=${role || '-'} chars=${text.length} cleaned=1`,
          );
  
          return {
            ok: true,
            text,
            role: role || 'unknown',
            reason: 'last-assistant-or-unknown',
          };
        }
      }
  
      for (const el of reversed) {
        const role = getMessageRole(el);
        if (role && role !== 'assistant' && role !== 'user') continue;
  
        const text = getVisibleTextFromElement(el);
        if (!text) continue;
  
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:text-picked] role=${role || '-'} chars=${text.length} cleaned=1`,
        );
  
        return {
          ok: true,
          text,
          role: role || 'unknown',
          reason: 'last-visible-message',
        };
      }
  
      return {
        ok: false,
        text: '',
        role: '',
        reason: 'empty-message-text',
      };
    }
  
    /********************************************************************
     * 2. ComposerApi：ChatGPT 页面操作隔离
     ********************************************************************/

    const UPLOAD_ATTACH_TIMEOUT_MS = 60000;

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
  
      function findSendButton() {
        const selectors = SELECTORS.sendButton || [];
  
        for (const sel of selectors) {
          const btn = qs(sel);
          if (btn instanceof HTMLButtonElement && !isInToolbox(btn) && isElementVisible(btn)) {
            return btn;
          }
        }
  
        const buttons = qsa('button');
        return buttons.find((btn) => {
          if (!(btn instanceof HTMLButtonElement)) return false;
          if (isInToolbox(btn) || !isElementVisible(btn)) return false;
  
          const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
          const title = (btn.getAttribute('title') || '').toLowerCase();
          const text = (btn.textContent || '').trim().toLowerCase();
  
          return aria.includes('send') ||
            aria.includes('发送') ||
            title.includes('send') ||
            title.includes('发送') ||
            text === '发送';
        }) || null;
      }
  
      function getSendButton() {
        return findSendButton();
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
        if (!composer) return false;
  
        if (composer.getAttribute && composer.getAttribute('aria-disabled') === 'true') {
          return false;
        }
  
        const sendBtn = getSendButton();
        if (!sendBtn) {
          return false;
        }
  
        return isSendButtonReady(sendBtn);
      }
  
      function clickSend() {
        const sendBtn = getSendButton();
  
        if (!isSendButtonReady(sendBtn)) {
          ToolboxShell.appendLog('[COMPOSER][click-send:blocked] reason=send-button-not-ready');
          return false;
        }
  
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
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      function getComposerDropTargets() {
        const targets = [];
        const composerRoot = getComposerRoot();
        const composer = getComposer();
  
        if (composerRoot instanceof HTMLElement && !isInToolbox(composerRoot)) {
          targets.push(composerRoot);
        }
  
        if (composer instanceof HTMLElement && !isInToolbox(composer)) {
          targets.push(composer);
        }
  
        const candidates = [
          '[data-testid="composer"]',
          'form',
          'main form',
          'main [contenteditable="true"]',
          '#prompt-textarea',
          '[data-testid="composer-textarea"]',
        ];
  
        candidates.forEach((sel) => {
          qsa(sel).forEach((el) => {
            if (el instanceof HTMLElement && !isInToolbox(el) && isElementVisible(el)) {
              targets.push(el);
            }
          });
        });
  
        return [...new Set(targets)];
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      function createFileDataTransfer(files) {
        const dt = new DataTransfer();
  
        files.forEach((file, index) => {
          const normalized = normalizeToNativeFile(
            file,
            file && file.name ? file.name : `upload_${index + 1}.bin`
          );
  
          if (!normalized) {
            console.warn('[ChatGPT toolbox] createFileDataTransfer skipped invalid file', {
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
  
        return dt;
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      function findFileInputs() {
        const root = getComposerRoot();
        const list = [];
  
        if (root) {
          list.push(...qsa('input[type="file"]', root));
        }
  
        list.push(...qsa('[data-testid="composer"] input[type="file"]'));
        list.push(...qsa('main form input[type="file"]'));
        list.push(...qsa('main input[type="file"]'));
        list.push(...qsa('input[type="file"]'));
  
        return [...new Set(list)].filter((input) => {
          if (!(input instanceof HTMLInputElement)) return false;
          if (isInToolbox(input)) return false;
          if (input.disabled) return false;
  
          return true;
        });
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      function dispatchFilesToInput(input, files) {
        ToolboxShell.appendLog('[DEAD_CODE_CHECK] deprecated: dispatchFilesToInput 被调用');
        const dt = createFileDataTransfer(files);
  
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
  
      function isLikelyAttachmentChipText(raw) {
        return /remove|删除|移除|附件|file|文件|attachment|uploaded|upload|\.zip|\.js|\.py|\.txt|\.json|\.md|\.csv|\.xlsx|\.docx|\.pdf/i.test(raw);
      }

      function countAttachmentChips() {
        const roots = [
          getComposerRoot(),
          qs('[data-testid="composer"]'),
          qs('form'),
          qs('main'),
          document.body,
        ].filter(Boolean);

        const seen = new Set();
        let count = 0;

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
            count += 1;
          });
        });

        return count;
      }

      function collectAttachmentChipText() {
        const roots = [
          getComposerRoot(),
          qs('[data-testid="composer"]'),
          qs('form'),
          qs('main'),
          document.body,
        ].filter(Boolean);

        const pieces = [];
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

            if (!raw) return;

            if (!isLikelyAttachmentChipText(raw)) {
              return;
            }

            seen.add(el);

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
        const text = collectAttachmentChipText();

        const names = buildUploadEvidenceNames(
          uploadName,
          options.extraNames || [],
        );

        const ok = fileNameEvidenceAny(names, text);

        return {
          ok,
          reason: ok
            ? `附件区域识别到文件名：${names.join('|')}`
            : `未识别到附件文件名：${names.join('|')}`,
          textPreview: text.slice(0, 500),
        };
      }
  
      async function waitLegacyInputSettled(uploadFile, options = {}) {
        const uploadName = uploadFile && uploadFile.name ? uploadFile.name : '';
        const timeoutMs = Number(options.timeoutMs) || UPLOAD_ATTACH_TIMEOUT_MS;
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
                `[UPLOAD_DIAG][legacy-input:evidence-ok] ${uploadName} reason=${evidence.reason || '-'}`
              );
            }

            stableCount += 1;
            lastReason = evidence.reason || '附件区域识别到文件名';

            if (stableCount >= stableNeed || Date.now() - firstEvidenceAt >= 800) {
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][legacy-input:settled-ok] ${uploadName} reason=${lastReason}`
              );

              return {
                ok: true,
                reason: lastReason,
                level: 'name',
              };
            }
          } else if (chipCountBefore >= 0 && nowCount > chipCountBefore) {
            if (!firstEvidenceAt) {
              firstEvidenceAt = Date.now();
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][legacy-input:chip-count-ok] ${uploadName} count=${chipCountBefore}->${nowCount}`
              );
            }

            stableCount += 1;
            lastReason = `附件数量增加：${chipCountBefore} -> ${nowCount}`;

            if (stableCount >= stableNeed || Date.now() - firstEvidenceAt >= 800) {
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][legacy-input:settled-ok-by-count] ${uploadName} reason=${lastReason}`
              );

              return {
                ok: true,
                reason: lastReason,
                level: 'count',
              };
            }
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
          `[UPLOAD_DIAG][legacy-input:settled-timeout] ${uploadName} reason=${lastReason || '-'} chipBefore=${chipCountBefore} chipAfter=${chipAfter} textPreview=${lastTextPreview || collectAttachmentChipText().slice(0, 500)}`
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
              `[UPLOAD_DIAG][legacy-input:chip-count-ok] batch count=${chipCountBefore}->${nowCount}`
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
          `[UPLOAD_DIAG][legacy-input:settled-timeout] batch uploadNames=${cleanFiles.map((f) => f.name).join('|')} chipBefore=${chipCountBefore} chipAfter=${chipAfter} textPreview=${lastTextPreview || collectAttachmentChipText().slice(0, 500)}`
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
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      function hasAttachmentUploadError() {
        const text = collectComposerAttachmentStatusText();
  
        return /failed|失败|error|错误|无法上传|upload failed|unsupported|不支持|too large|过大/i.test(text);
      }
  
      function findChatGptUploadErrorText() {
        const nodes = qsa('[role="alert"], [data-sonner-toast], [data-toast], .toast, .text-token-text-error, .bg-red-500, .bg-red-600');
  
        for (const node of nodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (isInToolbox(node)) continue;
  
          const text = String(node.innerText || node.textContent || '').trim();
  
          if (
            text.includes('files.oaiusercontent.com') ||
            text.includes('上传') && text.includes('失败') ||
            /upload.*failed/i.test(text)
          ) {
            return text.slice(0, 300);
          }
        }
  
        return '';
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      async function waitForAttachmentSettled(files, timeoutMs, options = {}) {
        ToolboxShell.appendLog('[DEAD_CODE_CHECK] deprecated: waitForAttachmentSettled 被调用');
        const signal = options.signal;
        const isCancelled = typeof options.isCancelled === 'function'
          ? options.isCancelled
          : () => !!(signal && signal.aborted);
  
        const deadline = Date.now() + (Number(timeoutMs) || 60000);
        let stableSince = 0;
        let lastText = '';
  
        while (Date.now() < deadline) {
          if (isCancelled()) {
            return {
              ok: false,
              cancelled: true,
              reason: '用户已停止上传',
            };
          }
  
          const uploadErrorText = findChatGptUploadErrorText();
          if (uploadErrorText) {
            return {
              ok: false,
              level: 'platform-error',
              reason: `ChatGPT 平台上传失败：${uploadErrorText}`,
            };
          }
  
          const chipText = collectAttachmentChipText();
          const allNamesVisible = files.every((f) => fileNameEvidence(f.name, chipText));
  
          const statusText = collectComposerAttachmentStatusText();
          const uploading = isAttachmentStillUploading();
          const hasError = hasAttachmentUploadError();
  
          if (hasError) {
            return {
              ok: false,
              reason: `ChatGPT 附件区出现上传错误：${statusText.slice(0, 300)}`,
            };
          }
  
          if (allNamesVisible && !uploading) {
            if (!stableSince || statusText !== lastText) {
              stableSince = Date.now();
              lastText = statusText;
            }
  
            if (Date.now() - stableSince >= 1800) {
              return {
                ok: true,
                reason: '附件文件名存在，且上传状态已稳定',
              };
            }
          } else {
            stableSince = 0;
            lastText = statusText;
          }
  
          await sleep(500);
        }
  
        return {
          ok: false,
          reason: `附件已触发但未确认上传完成；最后状态：${collectComposerAttachmentStatusText().slice(0, 300)}`,
        };
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      async function dispatchFilesByDrop(files, timeoutMs, options = {}) {
        ToolboxShell.appendLog('[DEAD_CODE_CHECK] deprecated: dispatchFilesByDrop 被调用');
        const signal = options.signal;
        const isCancelled = typeof options.isCancelled === 'function'
          ? options.isCancelled
          : () => !!(signal && signal.aborted);
  
        const cleanFiles = files
          .map((f, index) => normalizeToNativeFile(f, f && f.name ? f.name : `upload_${index + 1}.bin`))
          .filter(Boolean);
  
        if (!cleanFiles.length) {
          return {
            ok: false,
            reason: 'drop 上传失败：没File 对象',
          };
        }
  
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            reason: '用户已停止上传',
          };
        }
  
        const targets = getComposerDropTargets();
  
        if (!targets.length) {
          return {
            ok: false,
            reason: 'drop 上传失败：找不到 ChatGPT composer 目标',
          };
        }
  
        const chipBefore = countAttachmentChips();
  
        for (const target of targets) {
          if (isCancelled()) {
            return {
              ok: false,
              cancelled: true,
              reason: '用户已停止上传',
            };
          }
  
          const dt = createFileDataTransfer(cleanFiles);
  
          console.debug('[ChatGPT toolbox] try drop files to composer target', {
            target,
            fileNames: cleanFiles.map((f) => f.name),
          });
  
          try {
            const eventInit = {
              bubbles: true,
              cancelable: true,
              composed: true,
              dataTransfer: dt,
            };
  
            target.dispatchEvent(new DragEvent('dragenter', eventInit));
            target.dispatchEvent(new DragEvent('dragover', eventInit));
            target.dispatchEvent(new DragEvent('drop', eventInit));
  
            const ev = await waitForAttachmentEvidence(cleanFiles, chipBefore, timeoutMs || 6000, options);
  
            if (ev.cancelled) {
              return {
                ok: false,
                cancelled: true,
                reason: ev.reason || '用户已停止上传',
              };
            }
  
            if (ev.ok) {
              return {
                ok: true,
                reason: `drop 上传成功：${ev.reason}`,
                level: ev.level,
              };
            }
          } catch (e) {
            console.warn('[ChatGPT toolbox] dispatch drop files failed', { target, fileNames: cleanFiles.map((f) => f.name) }, e);
          }
        }
  
        return {
          ok: false,
          reason: 'drop 上传未确认附件出现',
        };
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      async function dispatchFilesByPaste(files, timeoutMs, options = {}) {
        ToolboxShell.appendLog('[DEAD_CODE_CHECK] deprecated: dispatchFilesByPaste 被调用');
        const signal = options.signal;
        const isCancelled = typeof options.isCancelled === 'function'
          ? options.isCancelled
          : () => !!(signal && signal.aborted);
  
        const cleanFiles = files
          .map((f, index) => normalizeToNativeFile(f, f && f.name ? f.name : `upload_${index + 1}.bin`))
          .filter(Boolean);
  
        if (!cleanFiles.length) {
          return {
            ok: false,
            reason: 'paste 上传失败：没File 对象',
          };
        }
  
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            reason: '用户已停止上传',
          };
        }
  
        const composer = getComposer();
        const target = composer || getComposerRoot();
  
        if (!(target instanceof HTMLElement)) {
          return {
            ok: false,
            reason: 'paste 上传失败：找不到输入框',
          };
        }
  
        const chipBefore = countAttachmentChips();
  
        try {
          const dt = createFileDataTransfer(cleanFiles);
  
          target.focus();
  
          console.debug('[ChatGPT toolbox] try paste files to composer', {
            target,
            fileNames: cleanFiles.map((f) => f.name),
          });
  
          const pasteEvent = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            composed: true,
            clipboardData: dt,
          });
  
          target.dispatchEvent(pasteEvent);
  
          const ev = await waitForAttachmentEvidence(cleanFiles, chipBefore, timeoutMs || 6000, options);
  
          if (ev.cancelled) {
            return {
              ok: false,
              cancelled: true,
              reason: ev.reason || '用户已停止上传',
            };
          }
  
          if (ev.ok) {
            return {
              ok: true,
              reason: `paste 上传成功：${ev.reason}`,
              level: ev.level,
            };
          }
  
          return {
            ok: false,
            reason: 'paste 上传未确认附件出现',
          };
        } catch (e) {
          console.warn('[ChatGPT toolbox] dispatch paste files failed', { fileNames: cleanFiles.map((f) => f.name) }, e);
          return {
            ok: false,
            reason: `paste 上传异常：${e && e.message ? e.message : String(e)}`,
          };
        }
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      async function dispatchFilesByInput(files, timeoutMs, options = {}) {
        ToolboxShell.appendLog('[DEAD_CODE_CHECK] deprecated: dispatchFilesByInput 被调用');
        const signal = options.signal;
        const isCancelled = typeof options.isCancelled === 'function'
          ? options.isCancelled
          : () => !!(signal && signal.aborted);
  
        const cleanFiles = files
          .map((f, index) => normalizeToNativeFile(f, f && f.name ? f.name : `upload_${index + 1}.bin`))
          .filter(Boolean);
  
        if (!cleanFiles.length) {
          return {
            ok: false,
            reason: 'input 上传失败：没File 对象',
          };
        }
  
        if (isCancelled()) {
          return {
            ok: false,
            cancelled: true,
            reason: '用户已停止上传',
          };
        }
  
        const chipBefore = countAttachmentChips();
        const inputs = findFileInputs();
  
        console.debug('[ChatGPT toolbox] file input candidates', inputs.map((input) => ({
          accept: input.getAttribute('accept'),
          multiple: input.multiple,
          disabled: input.disabled,
          visible: isElementVisible(input),
          outerHTML: input.outerHTML.slice(0, 200),
        })));
  
        if (!inputs.length) {
          ToolboxShell.appendLog('input 上传失败：找不到 ChatGPT 文件 input');
          return {
            ok: false,
            reason: 'input 上传失败：找不到 ChatGPT 文件 input',
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
            console.debug('[ChatGPT toolbox] try input files', {
              input,
              accept: input.getAttribute('accept'),
              multiple: input.multiple,
              fileNames: cleanFiles.map((f) => f.name),
            });
  
            dispatchFilesToInput(input, cleanFiles);
  
            const ev = await waitForAttachmentEvidence(cleanFiles, chipBefore, timeoutMs || 6000, options);
  
            if (ev.cancelled) {
              return {
                ok: false,
                cancelled: true,
                reason: ev.reason || '用户已停止上传',
              };
            }
  
            if (ev.ok) {
              return {
                ok: true,
                reason: `input 上传成功：${ev.reason}`,
                level: ev.level,
              };
            }
          } catch (e) {
            console.warn('[ChatGPT toolbox] dispatch files to input failed', {
              input,
              accept: input.getAttribute('accept'),
              fileNames: cleanFiles.map((f) => f.name),
            }, e);
          }
        }
  
        return {
          ok: false,
          reason: 'input 上传未确认附件出现',
        };
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
  
      async function attachFilesLegacyInputOnly(files, timeoutMs = UPLOAD_ATTACH_TIMEOUT_MS, options = {}) {
        ToolboxShell.appendLog('[UPLOAD_PATH] using attachFilesLegacyInputOnly');
        const signal = options.signal;
        const isCancelled = typeof options.isCancelled === 'function'
          ? options.isCancelled
          : () => !!(signal && signal.aborted);
  
        const cleanFiles = files
          .map((f, index) => normalizeToNativeFile(f, f && f.name ? f.name : `upload_${index + 1}.bin`))
          .filter(Boolean);
  
        ToolboxShell.appendLog(`[UPLOAD_DIAG][legacy-input:start] inputFiles=${files.length} cleanFiles=${cleanFiles.length} names=${cleanFiles.map((f) => f.name).join('|')}`);
  
        if (!cleanFiles.length) {
          ToolboxShell.appendLog(`[UPLOAD_DIAG][legacy-input:no-clean-file] raw=${files.map((f, i) => `${i}:${f && f.name || '-'} tag=${f ? Object.prototype.toString.call(f) : '-'} size=${f && f.size}`).join('|')}`);
  
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
                `[UPLOAD_DIAG][legacy-input:batch-evidence-ok] reason=${evidence.reason || '-'} level=${evidence.level || '-'}`
              );

              return {
                ok: true,
                method: 'legacy-input',
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
                  `[UPLOAD_DIAG][legacy-input:settled-failed] ${f.name} reason=${settled.reason || '-'} textPreview=${settled.textPreview || '-'}`
                );

                return {
                  ok: false,
                  method: 'legacy-input',
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
              method: 'legacy-input',
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
          method: 'legacy-input',
          reason: '旧版 input 上传已触发，但未检测到 ChatGPT 附件出现',
        };
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      async function attachFiles(files, timeoutMs, options = {}) {
        ToolboxShell.appendLog('[DEAD_CODE_CHECK] deprecated: attachFiles 被调用');
        const signal = options.signal;
        const isCancelled = typeof options.isCancelled === 'function'
          ? options.isCancelled
          : () => !!(signal && signal.aborted);
  
        const cleanFiles = files
          .map((f, index) => normalizeToNativeFile(f, f && f.name ? f.name : `upload_${index + 1}.bin`))
          .filter(Boolean);
  
        if (!cleanFiles.length) {
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
  
        console.debug('[ChatGPT toolbox] attachFiles start', {
          fileNames: cleanFiles.map((f) => f.name),
          fileSizes: cleanFiles.map((f) => f.size),
        });
  
        const methods = [
          ['input', dispatchFilesByInput],
          ['drop', dispatchFilesByDrop],
          ['paste', dispatchFilesByPaste],
        ];
  
        const failures = [];
  
        for (const [name, fn] of methods) {
          if (isCancelled()) {
            return {
              ok: false,
              cancelled: true,
              reason: '用户已停止上传',
            };
          }
  
          const result = await fn(cleanFiles, timeoutMs || 7000, options);
  
          console.debug('[ChatGPT toolbox] attachFiles method result', {
            method: name,
            result,
          });
  
          ToolboxShell.appendLog(`上传方式结果 ${name}：${result && result.ok ? '成功' : '失败'}：${result && result.reason ? result.reason : '无原因'}`);
  
          if (result && result.cancelled) {
            return {
              ok: false,
              cancelled: true,
              reason: result.reason || '用户已停止上传',
            };
          }
  
          if (result && result.ok) {
            ToolboxShell.appendLog(`附件确认成功：${cleanFiles.map((f) => f.name).join(', ')}｜方式：${name}`);
  
            return {
              ok: true,
              reason: result.reason || `${name} 上传成功`,
              level: result.level || name,
              method: name,
            };
          }
  
          failures.push(`${name}: ${result && result.reason ? result.reason : '未知失败'}`);
        }
  
        ToolboxShell.appendLog(`附件确认失败：${failures.join('|')}`);
  
        return {
          ok: false,
          reason: `所有上传方式均未确认成功：${failures.join('|')}`,
        };
      }
  
      /** @deprecated 旧多策略上传链路，正式入口为 attachFilesLegacyInputOnly */
      function debugUploadTargets() {
        ToolboxShell.appendLog('[DEAD_CODE_CHECK] deprecated: debugUploadTargets 被调用');
        const inputs = findFileInputs();
        const dropTargets = getComposerDropTargets();
  
        const info = {
          inputs: inputs.map((input) => ({
            accept: input.getAttribute('accept'),
            multiple: input.multiple,
            disabled: input.disabled,
            visible: isElementVisible(input),
            outerHTML: input.outerHTML.slice(0, 300),
          })),
          dropTargets: dropTargets.map((el) => ({
            tag: el.tagName,
            id: el.id,
            className: String(el.className || ''),
            testid: el.getAttribute('data-testid'),
          })),
        };
  
        console.debug('[ChatGPT toolbox] upload targets', info);
  
        return info;
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
        canSendNow,
        isAssistantLikelyBusy,
        attachFilesLegacyInputOnly,
        collectAttachmentChipText,
        countAttachmentChips,
        findAttachmentEvidence,
        fileNameEvidence,
        buildUploadEvidenceNames,
        fileNameEvidenceAny,
        isAttachmentStillUploading,
        getChatMessageElementsInOrder,
      };
    })();
  
    /********************************************************************
     * 3. UploadModule：多文件上传模块
     ********************************************************************/
  
    const UploadModule = (() => {
      const DEFAULT_UPLOAD_GROUP_NAME = '默认组';
      const SEND_WAIT_TIMEOUT_MS = 60 * 1000;
  
      const state = {
        groups: [],
        activeGroupId: '',
        queue: [],
        groupCounts: null,
        running: false,
        cancelled: false,
        activeId: '',
        observer: null,
        uploadAbortController: null,
        runId: 0,
        autoSendWaiting: false,
        autoSendRunId: 0,
        autoSendStartedAt: 0,
        autoSendLastStatusAt: 0,
        autoSendLastLogAt: 0,
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
      let uploadRenderRaf = 0;
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
      let uploadDelegatedClickBound = false;
      let copyLastMessageHardResetTimer = 0;
      let uploadUiActionLastKey = '';
      let uploadUiActionLastAt = 0;
  
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
  
      function getUploadRenameStatusText() {
        return isUploadUseUniqueFileNameEnabled()
          ? '上传前重命名：时间戳 + 序号（已开启）'
          : '上传前重命名：时间戳 + 序号（已关闭，上传时保留原名）';
      }
  
      function syncUploadRenameStatusEl() {
        const el = rootElRef ? qs('#cgpt-upload-rename-status', rootElRef) : null;
  
        if (!el) {
          return;
        }
  
        el.textContent = getUploadRenameStatusText();
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
        let changed = false;
  
        state.queue.forEach((q) => {
          if (!q) return;
  
          if (forceAll || hasAttemptableUploadSource(q)) {
            q.state = UploadState.IDLE;
            q.message = '';
            q.uploadName = '';
            q.persistedAttached = false;
            q.attachedInSession = false;
            changed = true;
          }
        });
  
        return changed;
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
  
      function getUploadInlineStatusText(q) {
        if (!q) return '未知';
  
        if (
          q.state === UploadState.MISSING_FILE ||
          q.sourceKind === 'missing-file' ||
          (!q.file && !q.blob && !(q.fileHandle && typeof q.fileHandle.getFile === 'function'))
        ) {
          return '缺少文件，请重新拖入';
        }
  
        if (q.fileHandle && typeof q.fileHandle.getFile === 'function') {
          return '本地文件';
        }
  
        if (q.file || q.blob) {
          return '缓存文件';
        }
  
        return '未知';
      }
  
      function getUploadSourceLabel(q) {
        return getUploadInlineStatusText(q);
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
  
        lines.push(`来源：${getUploadSourceLabel(q)}`);
  
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
  
            const recoverable = canReadFromLocal(q);
  
            if (recoverable) {
              logUploadItemSource('refreshQueueReadableState:mark-idle', q, {
                reason: 'reliable-file-or-blob-available',
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
  
        if (rawState === UploadState.ATTACHED) {
          return UploadState.IDLE;
        }
  
        if (
          rawState === UploadState.ATTACHING ||
          rawState === UploadState.READING ||
          rawState === UploadState.VERIFYING ||
          rawState === UploadState.PENDING_CONFIRM ||
          rawState === UploadState.CANCELLED ||
          rawState === UploadState.FAILED ||
          rawState === UploadState.MISSING_FILE ||
          rawState === UploadState.READY
        ) {
          return UploadState.IDLE;
        }
  
        return rawState || UploadState.IDLE;
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
          q.state === UploadState.READING ||
          q.state === UploadState.ATTACHING ||
          q.state === UploadState.VERIFYING ||
          q.state === UploadState.PENDING_CONFIRM ||
          q.state === UploadState.CANCELLED
        ) {
          return UploadState.IDLE;
        }
  
        if (q.state === UploadState.FAILED) {
          return UploadState.IDLE;
        }
  
        if (q.state === UploadState.READY) {
          return UploadState.IDLE;
        }
  
        return q.state || UploadState.IDLE;
      }
  
      function buildPersistRow(q) {
        const sourceInfo = describeUploadSource(q);
  
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
          handle: null,
          uploadName: q.uploadName || '',
          manualPathNote: String(q.manualPathNote || '').trim(),
          blob: null,
          blobSaved: false,
          blobSavedAt: 0,
          debugSavedFrom: '',
          debugSavedAt: Date.now(),
        };
  
        if (!isUploadBlobPersistEnabled()) {
          console.debug('[ChatGPT toolbox] buildPersistRow: Blob 持久化未开启', sourceInfo);
          return row;
        }
  
        if (isFileLike(q.file)) {
          if (q.file.size > APP.uploadBlobMaxBytes) {
            console.warn('[ChatGPT toolbox] buildPersistRow: 文件超过限制，跳Blob 保存', {
              sourceInfo,
              limit: APP.uploadBlobMaxBytes,
            });
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
  
          return row;
        }
  
        if (isBlobLike(q.blob)) {
          if (q.blob.size > APP.uploadBlobMaxBytes) {
            console.warn('[ChatGPT toolbox] buildPersistRow: q.blob 超过限制，跳Blob 保存', {
              sourceInfo,
              limit: APP.uploadBlobMaxBytes,
            });
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
  
          return row;
        }
  
        console.warn('[ChatGPT toolbox] buildPersistRow: 没有可保存的 File/Blob', sourceInfo);
  
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
  
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
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
        if (!state.activeGroupId) {
          console.warn('[ChatGPT toolbox] persistQueue: activeGroupId 为空');
          return;
        }
  
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
                const gid = r.groupId || state.activeGroupId;
                if (gid === state.activeGroupId) {
                  store.delete(r.id);
                }
              });
  
              state.queue.forEach((q) => {
                store.put(buildPersistRow({
                  ...q,
                  groupId: state.activeGroupId,
                }));
              });
            };
  
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB queue persist transaction failed'));
          });
  
          await debugReadBackPersistedQueue('persistQueue:after-write');
          await refreshUploadGroupCounts();
        } catch (e) {
          console.error('[ChatGPT toolbox] persist upload queue failed', e);
          throw e;
        }
      }
  
      const UPLOAD_PERSIST_TIMEOUT_MS = 2500;
  
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
            console.warn('[ChatGPT toolbox] previous persistQueue failed before next run', e);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][persistQueue:previous-failed] ${e && e.message ? e.message : String(e)}`
            );
          })
          .then(() => withTimeout(
            persistQueue(),
            UPLOAD_PERSIST_TIMEOUT_MS,
            'persistQueue'
          ))
          .then(() => {
            renderGroups();
            renderManageGroupList();
          })
          .catch((e) => {
            console.warn('[ChatGPT toolbox] schedulePersistQueue failed or timeout', e);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][persistQueue:failed-or-timeout] ${e && e.message ? e.message : String(e)}`
            );
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
          state.groupCounts.set(state.activeGroupId, state.queue.length);
        }
      }
  
      function getUploadGroupFileCount(groupId) {
        if (state.groupCounts && state.groupCounts.has(groupId)) {
          return state.groupCounts.get(groupId) || 0;
        }
  
        if (groupId === state.activeGroupId) {
          return state.queue.length;
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
          return;
        }
  
        const fallbackGroupId = state.groups[0].id;
  
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
            const groupId = row.groupId || fallbackGroupId;
  
            if (!groupId) return;
  
            counts.set(groupId, (counts.get(groupId) || 0) + 1);
          });
  
          state.groupCounts = counts;
        } catch (e) {
          console.error('[ChatGPT toolbox] refreshUploadGroupCounts failed', e);
          syncActiveGroupCountInCache();
        }
      }
  
      function renderUploadGroupChipHtml(group, activeGroupId) {
        const active = group.id === activeGroupId ? ' active' : '';
        const count = getUploadGroupFileCount(group.id);
        const cleanName = stripTrailingCountFromGroupName(group.name);
        const title = `${cleanName}：${count} 个文件`;
  
        return `
            <button type="button"
              class="cgpt-upload-group-chip${active}"
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
                store.put(g);
              });
            };
  
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB groups transaction failed'));
          });
        } catch (e) {
          console.warn('[ChatGPT toolbox] persist upload groups failed', e);
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
            MemoryManager.saveActiveGroupId(state.activeGroupId);
            await persistGroups();
            return;
          }
  
          const savedActiveGroupId = MemoryManager.get(MemoryManager.KEYS.uploadActiveGroupId, '');
          const exists = state.groups.some((g) => g.id === savedActiveGroupId);
  
          state.activeGroupId = exists ? savedActiveGroupId : state.groups[0].id;
          MemoryManager.saveActiveGroupId(state.activeGroupId);
        } catch (e) {
          console.warn('[ChatGPT toolbox] load upload groups failed', e);
  
          const defaultGroup = createDefaultGroup();
          state.groups = [defaultGroup];
          state.activeGroupId = defaultGroup.id;
          MemoryManager.saveActiveGroupId(state.activeGroupId);
          void persistGroups();
        }
      }
  
      async function migrateMissingGroupIdRows() {
        const targetId = state.groups[0] && state.groups[0].id;
        if (!targetId) return;
  
        try {
          const db = await openDb();
  
          await new Promise((resolve, reject) => {
            const tx = db.transaction(APP.uploadStore, 'readwrite');
            const store = tx.objectStore(APP.uploadStore);
            const req = store.getAll();
  
            req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll for migration failed'));
  
            req.onsuccess = () => {
              const rows = req.result || [];
  
              rows.forEach((r) => {
                if (!r.groupId) {
                  r.groupId = targetId;
                  store.put(r);
                }
              });
            };
  
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB queue migration transaction failed'));
          });
        } catch (e) {
          console.warn('[ChatGPT toolbox] migrate missing groupId rows failed', e);
        }
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
  
          await migrateMissingGroupIdRows();
  
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
            .filter((r) => r.groupId === state.activeGroupId)
            .map((r) => {
              const restoredState = r.state || UploadState.READY;
              const hasBlob = isBlobLike(r.blob);
              const handle = r.handle || null;
  
              const item = {
                id: r.id || newId(),
                groupId: r.groupId || state.activeGroupId,
                name: r.name || 'unknown',
                displayPath: r.displayPath || r.name || 'unknown',
                size: Number(r.size) || 0,
                lastModified: Number(r.lastModified) || 0,
                type: r.type || 'application/octet-stream',
                file: null,
                blob: hasBlob ? r.blob : null,
                fileHandle: handle && isFileHandleLike(handle) ? handle : null,
                state: UploadState.IDLE,
                message: '',
                uploadName: r.uploadName || '',
                manualPathNote: String(r.manualPathNote || '').trim(),
                persistedAttached: false,
                attachedInSession: false,
                sourceKind: '',
              };
  
              let needsReDrag = false;
  
              if (item.fileHandle) {
                item.sourceKind = 'local-handle';
  
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
              } else if (hasBlob) {
                const restoredFile = normalizeToNativeFile(r.blob, item.name || 'upload.bin');
  
                item.file = restoredFile;
                item.blob = restoredFile || r.blob;
                item.sourceKind = 'cached-blob';
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
  
                needsReDrag = false;
  
                ToolboxShell.appendLog(
                  `[UPLOAD_DIAG][loadQueue:cached-blob-restored] name=${item.name || '-'} groupId=${item.groupId || '-'} size=${item.size}`,
                );
              } else {
                item.sourceKind = 'missing-local';
                item.state = UploadState.MISSING_FILE;
                item.message = '缺少文件，请重新拖入';
                item.uploadName = '';
                needsReDrag = true;
                if (restoredState === UploadState.ATTACHED) {
                  item.persistedAttached = true;
                }
              }
  
              console.debug('[ChatGPT toolbox] loadQueue row restore', {
                row: {
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
                },
                item: describeUploadSource(item),
                needsReDrag,
              });
  
              logUploadItemSource('loadQueue:item-restored', item, {
                reason: needsReDrag ? 'missing-readable-source' : 'restored-readable-source',
              });
  
              return item;
            });
  
          refreshQueueReadableState();
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
          q.state === UploadState.PENDING_CONFIRM
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
  
      async function switchGroup(groupId) {
        if (!groupId) return;
  
        healStaleUploadRunningLockIfNeeded('switchGroup');
  
        if (state.running) {
          setStatus('正在上传中，不能切换分组');
          return;
        }
  
        const exists = state.groups.some((g) => g.id === groupId);
        if (!exists) {
          console.warn('[ChatGPT toolbox] switchGroup: 分组不存在', groupId);
          return;
        }
  
        await schedulePersistQueue();
  
        state.activeGroupId = groupId;
        state.activeId = '';
        MemoryManager.saveActiveGroupId(groupId);
  
        await loadQueueForActiveGroup();
  
        render();
        setStatus(`已切换到 ${getActiveGroupName()}`);
      }
  
      function buildRandomGroupName() {
        const tag = buildUploadTimestamp().slice(0, 20);
        const baseName = `项目_${tag}`;
  
        const existingNames = new Set(
          state.groups.map((g) => String(g.name || '').trim())
        );
  
        if (!existingNames.has(baseName)) {
          return baseName;
        }
  
        let index = 2;
        let name = `${baseName}_${index}`;
  
        while (existingNames.has(name)) {
          index += 1;
          name = `${baseName}_${index}`;
        }
  
        return name;
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
        state.queue = [];
  
        MemoryManager.saveActiveGroupId(group.id);
  
        await persistGroups();
        await schedulePersistQueue();
  
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
  
        setStatus(`已新建分组：${group.name}`);
        ToolboxShell.appendLog(`已新建文件组${group.name}`);
      }
  
      async function renameActiveGroup() {
        const group = getActiveGroup();
  
        if (!group) {
          setStatus('当前没有可重命名的分组');
          return;
        }
  
        const name = window.prompt('请输入新的分组名称：', group.name);
        const text = String(name || '').trim();
  
        if (!text) {
          console.warn('[ChatGPT toolbox] renameActiveGroup: 分组名称为空');
          return;
        }
  
        if (state.groups.some((g) => g.id !== group.id && g.name === text)) {
          setStatus('分组名称已存在');
          return;
        }
  
        group.name = text.slice(0, 24);
        group.updatedAt = Date.now();
  
        await persistGroups();
  
        render();
        setStatus(`已重命名分组${group.name}`);
      }
  
      async function deleteGroupQueue(groupId) {
        try {
          const db = await openDb();
  
          await new Promise((resolve, reject) => {
            const tx = db.transaction(APP.uploadStore, 'readwrite');
            const store = tx.objectStore(APP.uploadStore);
            const req = store.getAll();
  
            req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll before delete group failed'));
  
            req.onsuccess = () => {
              const rows = req.result || [];
  
              rows.forEach((r) => {
                if (r.groupId === groupId) {
                  store.delete(r.id);
                }
              });
            };
  
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB delete group queue transaction failed'));
          });
  
          await refreshUploadGroupCounts();
        } catch (e) {
          console.warn('[ChatGPT toolbox] delete group queue failed', groupId, e);
        }
      }
  
      async function deleteActiveGroup() {
        const group = getActiveGroup();
  
        if (!group) {
          setStatus('当前没有可删除的分组');
          return;
        }
  
        if (state.groups.length <= 1) {
          setStatus('至少保留一个分组');
          return;
        }
  
        const ok = window.confirm(`确定删除分组${group.name}”及其文件队列吗？`);
        if (!ok) return;
  
        await deleteGroupQueue(group.id);
  
        state.groups = state.groups.filter((g) => g.id !== group.id);
        state.activeGroupId = state.groups[0].id;
        state.queue = [];
  
        MemoryManager.saveActiveGroupId(state.activeGroupId);
  
        await persistGroups();
        await loadQueueForActiveGroup();
  
        render();
        setStatus(`已删除分组：${group.name}`);
      }
  
      async function clearActiveGroupQueue() {
        const group = getActiveGroup();
  
        if (!group) {
          setStatus('当前没有可清空的分组');
          return;
        }
  
        const ok = window.confirm(`确定清空${group.name}”的文件队列吗？`);
        if (!ok) return;
  
        state.queue = [];
  
        await schedulePersistQueue();
  
        render();
        setStatus(`已清空分组：${group.name}`);
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
          manageGroupListEl.innerHTML = `
            <div class="cgpt-upload-manage-empty">暂无分组</div>
          `;
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
  
        group.name = text.slice(0, 24);
        group.updatedAt = Date.now();
  
        await persistGroups();
  
        lastGroupNameInputValue = group.name;
  
        renderGroups();
        renderManageGroupList();
        render();
        syncGroupManagePanel();
  
        setStatus(`已保存分组名称：${group.name}`);
        ToolboxShell.appendLog(`已重命名文件组：${group.name}`);
  
        return true;
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
  
        state.queue = [];
  
        await schedulePersistQueue();
  
        render();
        syncGroupManagePanel();
  
        setStatus(`已清空分组：${group.name}`);
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
  
        await deleteGroupQueue(group.id);
  
        state.groups = state.groups.filter((g) => g.id !== group.id);
        state.activeGroupId = state.groups[0].id;
        state.queue = [];
  
        MemoryManager.saveActiveGroupId(state.activeGroupId);
  
        await persistGroups();
        await loadQueueForActiveGroup();
  
        render();
        syncGroupManagePanel();
  
        setStatus(`已删除分组：${group.name}`);
      }
  
      async function removeFileFromCurrentGroup(id) {
        if (state.running) {
          setStatus('正在上传中，不能删除文件');
          return;
        }
  
        const q = state.queue.find((item) => item.id === id);
  
        if (!q) {
          setStatus('未找到要删除的文件');
          console.warn('[ChatGPT toolbox] removeFileFromCurrentGroup: 文件不存在', id);
          return;
        }
  
        state.queue = state.queue.filter((item) => item.id !== id);
  
        await schedulePersistQueue();
  
        render();
  
        setStatus(`已从工具箱移除：${q.name}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][remove-file] removed from toolbox queue only: ${q.name}`);
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
          console.error('[ChatGPT toolbox] exportGroupsAndQueueMeta failed', e);
          return {
            activeGroupId: state.activeGroupId,
            groups: state.groups.slice(),
            queue: [],
          };
        }
      }
  
      async function importGroupsAndQueueMeta(payload) {
        if (!payload || typeof payload !== 'object') {
          console.warn('[ChatGPT toolbox] importGroupsAndQueueMeta: invalid payload', payload);
          return;
        }
  
        const incomingGroups = Array.isArray(payload.groups) ? payload.groups : [];
        const incomingQueue = Array.isArray(payload.queue) ? payload.queue : [];
  
        if (!incomingGroups.length) {
          const defaultGroup = createDefaultGroup();
          state.groups = [defaultGroup];
          state.activeGroupId = defaultGroup.id;
        } else {
          state.groups = incomingGroups.map((g) => ({
            id: String(g.id || createId('upload_group')),
            name: String(g.name || DEFAULT_UPLOAD_GROUP_NAME).slice(0, 24),
            createdAt: Number(g.createdAt) || Date.now(),
            updatedAt: Number(g.updatedAt) || Date.now(),
          }));
  
          const wantedId = String(payload.activeGroupId || '');
          const exists = state.groups.some((g) => g.id === wantedId);
          state.activeGroupId = exists ? wantedId : state.groups[0].id;
        }
  
        MemoryManager.saveActiveGroupId(state.activeGroupId);
  
        await persistGroups();
  
        try {
          const db = await openDb();
  
          await new Promise((resolve, reject) => {
            const tx = db.transaction(APP.uploadStore, 'readwrite');
            const store = tx.objectStore(APP.uploadStore);
            const clearReq = store.clear();
  
            clearReq.onerror = () => reject(clearReq.error || new Error('IndexedDB queue clear on import failed'));
  
            clearReq.onsuccess = () => {
              incomingQueue.forEach((r) => {
                if (!r || !r.id) return;
  
                const row = {
                  id: String(r.id),
                  groupId: String(r.groupId || state.activeGroupId),
                  name: r.name || 'unknown',
                  displayPath: r.displayPath || r.name || '',
                  size: Number(r.size) || 0,
                  lastModified: Number(r.lastModified) || 0,
                  type: r.type || 'application/octet-stream',
                  state: r.state || UploadState.READY,
                  message: r.message || '',
                  sourceKind: r.sourceKind || '',
                  handle: null,
                  uploadName: r.uploadName || '',
                  manualPathNote: String(r.manualPathNote || '').trim(),
                  blob: r.blob instanceof Blob ? r.blob : null,
                  blobSaved: !!(r.blob instanceof Blob) || !!r.blobSaved,
                  blobSavedAt: Number(r.blobSavedAt) || 0,
                };
  
                store.put(row);
              });
            };
  
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB queue import transaction failed'));
          });
        } catch (e) {
          console.error('[ChatGPT toolbox] importGroupsAndQueueMeta queue write failed', e);
          throw e;
        }
  
        state.queue = [];
        await loadQueueForActiveGroup();
        await refreshUploadGroupCounts();
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
        return (targets || []).every((q) => {
          return q &&
            (
              q.state === UploadState.ATTACHED ||
              q.state === UploadState.FAILED ||
              q.state === UploadState.CANCELLED ||
              q.state === UploadState.MISSING_FILE
            );
        });
      }
  
      function countUploadResult(targets) {
        const list = targets || [];
        return {
          success: list.filter((q) => q && q.state === UploadState.ATTACHED).length,
          failed: list.filter((q) => q && (
            q.state === UploadState.FAILED ||
            q.state === UploadState.MISSING_FILE ||
            q.state === UploadState.CANCELLED
          )).length,
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
  
      function saveQuickPromptActiveCategory(category) {
        const cfg = getCompactUiConfig();
        const next = Object.assign({}, cfg, {
          quickPromptActiveCategory: String(category || '全部').trim() || '全部',
        });
  
        if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.saveConfig === 'function') {
          SettingsModule.saveConfig(next);
          return;
        }
  
        MemoryManager.set(MemoryManager.KEYS.compactUiConfig, normalizeCompactUiConfig(next));
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
  
      function isQuickPromptSendButtonReady(btn) {
        if (typeof ComposerApi.isSendButtonReady === 'function') {
          return ComposerApi.isSendButtonReady(btn);
        }
  
        return !!(btn && !btn.disabled && isElementVisible(btn));
      }
  
      async function waitForSendButtonReady(timeoutMs = 3000) {
        const start = Date.now();
  
        while (Date.now() - start < timeoutMs) {
          const btn = typeof ComposerApi.findSendButton === 'function'
            ? ComposerApi.findSendButton()
            : null;
  
          const composerReady = typeof ComposerApi.canSendNow === 'function'
            ? ComposerApi.canSendNow()
            : true;
  
          if (btn && isQuickPromptSendButtonReady(btn) && composerReady) {
            return btn;
          }
  
          await sleep(120);
        }
  
        return null;
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
  
        if (!text) {
          setStatus(`Prompt 内容为空：${prompt && prompt.title ? prompt.title : '未命名'}`);
          return;
        }
  
        const ok = ComposerApi.setComposerValue(text);
        if (!ok) {
          console.warn('[ChatGPT toolbox] quick prompt: composer not found', prompt);
          setStatus('未找到 ChatGPT 输入框，无法填入 Prompt');
          return;
        }
  
        if (cfg.quickPromptClickAction !== 'fill') {
          await sleep(120);
  
          const sendBtn = await waitForSendButtonReady(3000);
  
          if (sendBtn) {
            sendBtn.click();
            setStatus(`已发送 Prompt：${prompt.title || '未命名'}`);
            ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:send] ${prompt.title || prompt.id}`);
            return;
          }
  
          const clicked = typeof ComposerApi.clickSend === 'function' && ComposerApi.clickSend();
          if (clicked) {
            setStatus(`已发送 Prompt：${prompt.title || '未命名'}`);
            ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:send-fallback] ${prompt.title || prompt.id}`);
            return;
          }
  
          console.warn('[ChatGPT toolbox] quick prompt: send button unavailable', prompt);
          setStatus(`已填入 Prompt，但发送按钮不可用：${prompt.title || '未命名'}`);
          ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:send-unavailable] ${prompt.title || prompt.id}`);
          return;
        }
  
        setStatus(`已填入 Prompt：${prompt.title || '未命名'}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:fill] ${prompt.title || prompt.id}`);
      }
  
      function buildUploadListHtml() {
        if (!state.queue.length) {
          return `
            <div class="cgpt-upload-item empty">
              <div>
                <div class="cgpt-upload-meta">当前组暂无文件</div>
              </div>
            </div>
          `;
        }
  
        return state.queue.map((q) => {
          const activeClass = state.activeId === q.id ? 'active' : '';
          const itemTitle = escapeHtml(buildUploadItemTitle(q));
          return `
              <div class="cgpt-upload-item ${activeClass}" data-id="${q.id}" title="${itemTitle}">
                <div class="cgpt-upload-file-main">
                  <div class="cgpt-upload-name">${escapeHtml(q.name || 'unknown')}</div>
                  <div class="cgpt-upload-meta">
                    ${escapeHtml(formatBytes(q.size))}
                    <span class="cgpt-upload-dot">·</span>
                    ${escapeHtml(getUploadInlineStatusText(q))}
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
  
      function scheduleRenderUpload() {
        if (uploadRenderRaf) {
          return;
        }
  
        uploadRenderRaf = window.requestAnimationFrame(() => {
          uploadRenderRaf = 0;
          renderUploadListOnly();
          renderUploadButtonsOnly();
        });
      }
  
      function renderUploadListOnly() {
        const el = listEl || (rootElRef ? qs('#cgpt-upload-list', rootElRef) : null);
        if (!el) return;
  
        listEl = el;
        refreshQueueReadableState();
        el.innerHTML = buildUploadListHtml();
      }
  
      function renderUploadButtonsOnly() {
        const startBtnEl = startBtn || (rootElRef ? qs('#cgpt-upload-start', rootElRef) : null);
        if (startBtnEl) {
          startBtnEl.classList.remove('primary', 'danger');
          startBtnEl.classList.add('success');
  
          if (state.running) {
            startBtnEl.disabled = true;
            startBtnEl.textContent = '上传中';
          } else {
            startBtnEl.disabled = state.queue.length <= 0;
            startBtnEl.textContent = '开始上传';
          }
        }
  
        const startSendBtn = rootElRef ? qs('#cgpt-upload-start-send', rootElRef) : null;
        if (startSendBtn) {
          startSendBtn.textContent = state.autoSendWaiting || uploadSendShortcutRunning
            ? '等待发送中'
            : '发送信息';
          startSendBtn.title = '发送信息快捷键：Ctrl + Enter';
          startSendBtn.disabled = false;
        }
  
        const copyLastMessageBtn = rootElRef ? qs('#cgpt-copy-last-message-scroll-bottom', rootElRef) : null;
        if (copyLastMessageBtn) {
          if (copyLastMessageWaiting) {
            copyLastMessageBtn.textContent = '等待回答';
          } else if (copyLastMessageTaskRunning) {
            copyLastMessageBtn.textContent = '复制中';
          } else {
            copyLastMessageBtn.textContent = '复制最后消息';
          }
          copyLastMessageBtn.title = '复制最后消息：空闲时立即复制；回答中则等待回答完成后复制。快捷键：F8；备用：Alt + C / Ctrl + Alt + C';
          copyLastMessageBtn.disabled = false;
        }
      }
  
      function buildQuickPromptRenderSignature() {
        const cfg = getCompactUiConfig();
        const promptsVersion = PromptManagerModule && typeof PromptManagerModule.getVersion === 'function'
          ? PromptManagerModule.getVersion()
          : JSON.stringify(PromptManagerModule && typeof PromptManagerModule.getPrompts === 'function'
            ? PromptManagerModule.getPrompts().map((p) => p.id)
            : []);
  
        return JSON.stringify({
          isCompact: isCompactUploadView(),
          showUploadQuickPrompts: cfg.showUploadQuickPrompts !== false,
          showCompactQuickPrompts: cfg.showCompactQuickPrompts !== false,
          quickPromptIds: cfg.quickPromptIds || [],
          quickPromptActiveCategory: cfg.quickPromptActiveCategory || '全部',
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
        let activeCategory = String(cfg.quickPromptActiveCategory || '全部').trim() || '全部';
  
        if (!groups.includes(activeCategory)) {
          activeCategory = '全部';
          saveQuickPromptActiveCategory(activeCategory);
        }
  
        const visiblePrompts = activeCategory === '全部'
          ? selected
          : selected.filter((p) => getPromptCategoryName(p) === activeCategory);
  
        const groupsHtml = groups.map((name) => {
          const count = getQuickPromptCategoryCount(name, selected);
  
          return `
              <button type="button"
                class="cgpt-upload-quick-prompt-group${name === activeCategory ? ' active' : ''}"
                data-upload-quick-prompt-category="${escapeHtml(name)}"
                title="${escapeHtml(`${name}：${count} Prompt`)}">
                <span class="cgpt-chip-name">${escapeHtml(name)}</span>
                <span class="cgpt-chip-count">${count}</span>
              </button>
            `;
        }).join('');
  
        const chipsHtml = visiblePrompts.map((p) => `
              <button type="button"
                class="cgpt-upload-quick-prompt-chip"
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
  
        syncUploadRenameStatusEl();
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
            console.warn('[ChatGPT toolbox] getAsFileSystemHandle failed', e);
            return null;
          }
        }
  
        return null;
      }
  
      async function collectDroppedFilesWithHandles(dataTransfer) {
        const result = [];
  
        const items = Array.from(dataTransfer.items || []);
  
        if (items.length) {
          for (const item of items) {
            if (!item || item.kind !== 'file') continue;
  
            let file = null;
            let handle = null;
  
            try {
              handle = await getHandleFromDataTransferItem(item);
            } catch (e) {
              console.warn('[ChatGPT toolbox] get handle from dropped item failed', e);
              handle = null;
            }
  
            if (handle && typeof handle.getFile === 'function') {
              try {
                file = await handle.getFile();
              } catch (e) {
                console.error('[ChatGPT toolbox] dropped handle.getFile failed', e);
                file = null;
              }
            }
  
            if (!file && typeof item.getAsFile === 'function') {
              file = item.getAsFile();
            }
  
            if (!file) continue;
  
            const normalized = normalizeToNativeFile(file, file.name || 'unknown');
  
            if (!normalized) continue;
  
            result.push({
              file: normalized,
              handle: handle && typeof handle.getFile === 'function' ? handle : null,
            });
          }
  
          return result;
        }
  
        const files = Array.from(dataTransfer.files || []);
  
        files.forEach((rawFile) => {
          if (!rawFile) return;
  
          const normalized = normalizeToNativeFile(rawFile, rawFile.name || 'unknown');
  
          if (!normalized) return;
  
          result.push({
            file: normalized,
            handle: null,
          });
        });
  
        return result;
      }
  
      async function addDroppedFiles(dropped) {
        const files = dropped.map((x) => x.file);
        const handles = dropped.map((x) => x.handle || null);
  
        await addFiles(files, {
          handles,
          sourceKind: 'drop',
        });
      }
  
      async function handleUploadDropEvent(e) {
        e.preventDefault();
        e.stopPropagation();
  
        const transfer = e.dataTransfer;
  
        if (!transfer) {
          setStatus('拖拽失败：没有文件数据');
          return;
        }
  
        if (!state.activeGroupId) {
          await ensureDefaultGroupReady();
        }
  
        if (!state.activeGroupId) {
          setStatus('拖拽失败：没有可用文件组');
          console.warn('[ChatGPT toolbox] drop failed: activeGroupId empty');
          return;
        }
  
        const dropped = await collectDroppedFilesWithHandles(transfer);
  
        if (!dropped.length) {
          setStatus('没有检测到可添加的文件');
          return;
        }
  
        await addDroppedFiles(dropped);
  
        setStatus(`已拖：${dropped.length} 个文件`);
      }
  
      function onUploadRootDragOver(e) {
        if (!hasDraggedFiles(e)) return;
  
        if (shouldLetNativeChatGptHandleDrop(e)) {
          return;
        }
  
        e.preventDefault();
        e.stopPropagation();
  
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
  
        if (rootElRef) {
          rootElRef.classList.add('cgpt-upload-dragging');
        }
      }
  
      function onUploadRootDragLeave(e) {
        if (rootElRef) {
          rootElRef.classList.remove('cgpt-upload-dragging');
        }
      }
  
      async function onUploadRootDrop(e) {
        if (!hasDraggedFiles(e)) return;
  
        if (shouldLetNativeChatGptHandleDrop(e)) {
          return;
        }
  
        if (rootElRef) {
          rootElRef.classList.remove('cgpt-upload-dragging');
        }
  
        await handleUploadDropEvent(e);
      }
  
      function onGlobalUploadDragOver(e) {
        if (!hasDraggedFiles(e)) return;
  
        if (shouldLetNativeChatGptHandleDrop(e)) {
          return;
        }
  
        e.preventDefault();
        e.stopPropagation();
  
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }
  
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
        if (!hasDraggedFiles(e)) return;
  
        if (shouldLetNativeChatGptHandleDrop(e)) {
          return;
        }
  
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
  
          MemoryManager.saveActiveGroupId(defaultGroup.id);
  
          await persistGroups();
          await schedulePersistQueue();
  
          renderGroups();
          render();
          return;
        }
  
        state.activeGroupId = state.groups[0].id;
        MemoryManager.saveActiveGroupId(state.activeGroupId);
  
        await loadQueueForActiveGroup();
  
        renderGroups();
        render();
      }
  
      async function addFiles(files, options = {}) {
        const cleanFiles = Array.from(files || []).filter(Boolean);
        const handles = Array.isArray(options.handles) ? options.handles : [];
  
        if (!state.activeGroupId) {
          setStatus('请先选择文件组');
          console.warn('[ChatGPT toolbox] addFiles blocked: activeGroupId empty');
          return;
        }
  
        cleanFiles.forEach((file, index) => {
          const handle = handles[index] || null;
          const hasHandle = !!(handle && typeof handle.getFile === 'function');
  
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
        });
  
        await schedulePersistQueue();
        await refreshUploadGroupCounts();
  
        render();
  
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][drop:addFiles] count=${cleanFiles.length} group=${state.activeGroupId || '-'}`,
        );
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
              q.message = '';
  
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][readFreshFile:local-handle] name=${q.name || '-'} size=${q.size || 0}`,
              );
  
              return fresh;
            }
          } catch (e) {
            console.warn('[ChatGPT toolbox] fileHandle.getFile failed, fallback to cached file/blob if available', e);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][readFreshFile:handle-failed] name=${q.name || '-'} error=${e && e.message ? e.message : String(e)}`,
            );
          }
        }
  
        if (q.file || q.blob) {
          const cachedFile = normalizeToNativeFile(q.file || q.blob, q.name);
  
          if (cachedFile) {
            q.file = cachedFile;
            q.blob = cachedFile;
            q.sourceKind = 'cached-blob';
            q.message = '';
  
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][readFreshFile:cached-blob] name=${q.name || cachedFile.name} size=${cachedFile.size}`,
            );
  
            return cachedFile;
          }
        }
  
        q.state = UploadState.MISSING_FILE;
        q.sourceKind = 'missing-file';
        q.message = '缺少文件，请重新拖入';
  
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
  
      async function uploadOne(q, seq, total, options = {}) {
        const runId = options.runId;
        const signal = options.signal;
        let errText = '';
  
        ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:start] seq=${seq}/${total} name=${q.name} state=${q.state}`);
  
        if (isUploadCancelled(runId, signal)) {
          updateItem(q.id, {
            state: UploadState.CANCELLED,
            message: '用户已停止上传',
          });
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${UploadState.CANCELLED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
          );
          return false;
        }
  
        try {
          updateItem(q.id, {
            state: UploadState.READING,
            message: '上传中',
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
            updateItem(q.id, {
              state: UploadState.CANCELLED,
              message: '用户已停止上传',
            });
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${UploadState.CANCELLED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
            );
            return false;
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
            message: '上传中',
          });
  
          ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:before-attach] name=${q.name} uploadName=${uploadFile.name} size=${uploadFile.size}`);
  
          const result = await ComposerApi.attachFilesLegacyInputOnly([uploadFile], UPLOAD_ATTACH_TIMEOUT_MS, {
            signal,
            runId,
            isCancelled: () => isUploadCancelled(runId, signal),
          });
  
          ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:attach-result] name=${q.name} ok=${result.ok ? 1 : 0} reason=${result.reason || ''}`);
  
          if (isUploadCancelled(runId, signal) || result.cancelled) {
            updateItem(q.id, {
              state: UploadState.CANCELLED,
              message: '用户已停止上传',
            });
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${UploadState.CANCELLED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
            );
            return false;
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
            q.state = UploadState.ATTACHED;
            q.message = '';
            q.attachedInSession = true;
            q.persistedAttached = true;
            q.updatedAt = Date.now();

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:post-chip-count-attached] name=${q.name || '-'} uploadName=${uploadFile.name || '-'} chipBefore=${chipCountBefore} chipAfter=${chipCountAfter}`
            );

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${q.state} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
            );
            return true;
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
          if (
            q &&
            (
              q.state === UploadState.ATTACHING ||
              q.state === UploadState.READING ||
              q.state === UploadState.VERIFYING
            )
          ) {
            q.state = UploadState.FAILED;
            q.message = errText || '上传流程未正常结束';
  
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:force-finalize-failed] name=${q.name || '-'} state=${q.state}`
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
  
        const q = state.queue.find((item) => item && item.id === id);
  
        if (!q) {
          setStatus('未找到要上传的文件');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][single-upload:not-found] id=${id}`);
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
            if (
              item &&
              (
                item.state === UploadState.READING ||
                item.state === UploadState.ATTACHING ||
                item.state === UploadState.VERIFYING ||
                item.state === UploadState.PENDING_CONFIRM
              )
            ) {
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
        const q = state.queue.find((item) => item && item.id === id);
  
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
        return state.queue.some((q) => q && (
          q.state === UploadState.READING ||
          q.state === UploadState.ATTACHING ||
          q.state === UploadState.VERIFYING ||
          q.state === UploadState.PENDING_CONFIRM
        ));
      }
  
      function healStaleUploadRunningLockIfNeeded(context) {
        if (!state.running) return false;
        if (hasActiveUploadInProgressOnQueue()) return false;
        if (state.uploadAbortController) return false;
  
        ToolboxShell.appendLog(`[UPLOAD_DIAG][heal-running-lock] ctx=${String(context || '-')} activeId=${state.activeId || '-'}`);
        state.running = false;
        state.cancelled = false;
        state.activeId = '';
        state.uploadAbortController = null;
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
        state.autoSendWaiting = false;
        state.autoSendRunId += 1;
      }
  
      async function waitSendConfirmed(options = {}) {
        const runId = Number(options.runId) || 0;
        const startedAt = Date.now();
  
        while (Date.now() - startedAt < 5000) {
          if (state.autoSendRunId !== runId) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][auto-send-confirm:stale] runId=${runId} current=${state.autoSendRunId}`
            );
            return false;
          }
  
          if (ComposerApi.isAssistantLikelyBusy()) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][auto-send-confirm:busy] runId=${runId}`
            );
            return true;
          }
  
          if (!ComposerApi.canSendNow()) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][auto-send-confirm:send-disabled] runId=${runId}`
            );
            return true;
          }
  
          await sleep(250);
        }
  
        return false;
      }
  
      async function waitForSendButtonAndClick(options = {}) {
        const runId = Number(options.runId) || 0;
        const reason = String(options.reason || 'upload-then-send');
        const isManualSend = reason === 'manual-send-message';
        const timeoutMs = Number(options.timeoutMs || SEND_WAIT_TIMEOUT_MS);
  
        state.autoSendWaiting = true;
        state.autoSendRunId = runId;
        state.autoSendStartedAt = Date.now();
        state.autoSendLastStatusAt = 0;
        state.autoSendLastLogAt = 0;
  
        scheduleRenderUpload('auto-send-wait:start');
  
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][auto-send-wait:start] runId=${runId} reason=${reason}`
        );
  
        try {
          while (state.autoSendWaiting && state.autoSendRunId === runId) {
            if (state.cancelled) {
              state.autoSendWaiting = false;
              setStatus('已取消等待发送');
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][auto-send-wait:cancelled] runId=${runId}`
              );
              scheduleRenderUpload('auto-send-wait:cancelled');
              return false;
            }
  
            const now = Date.now();
            const waitedMs = now - state.autoSendStartedAt;
  
            if (waitedMs >= timeoutMs) {
              state.autoSendWaiting = false;
  
              setStatus(
                `发送超时：等待发送按钮超过 ${Math.round(timeoutMs / 1000)}s`,
                'warn'
              );
  
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][auto-send-wait:timeout] runId=${runId} reason=${reason} waited=${waitedMs} timeout=${timeoutMs} canSend=${ComposerApi.canSendNow()} busy=${ComposerApi.isAssistantLikelyBusy()}`
              );
  
              scheduleRenderUpload('auto-send-wait:timeout');
              return false;
            }
  
            if (now - state.autoSendLastStatusAt >= 1000) {
              state.autoSendLastStatusAt = now;
              setStatus(
                `正在等待发送按钮... ${Math.round(waitedMs / 1000)}s / ${Math.round(timeoutMs / 1000)}s`,
                'running'
              );
              scheduleRenderUpload('auto-send-wait:status');
            }
  
            if (now - state.autoSendLastLogAt >= 3000) {
              state.autoSendLastLogAt = now;
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][auto-send-wait:poll] runId=${runId} waited=${waitedMs} canSend=${ComposerApi.canSendNow()} busy=${ComposerApi.isAssistantLikelyBusy()}`
              );
            }
  
            if (ComposerApi.isAssistantLikelyBusy()) {
              await sleep(500);
              continue;
            }
  
            if (!ComposerApi.canSendNow()) {
              await sleep(500);
              continue;
            }
  
            const okSend = ComposerApi.clickSend();
  
            if (!okSend) {
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][auto-send-wait:click-failed] runId=${runId}`
              );
              await sleep(500);
              continue;
            }
  
            const confirmed = await waitSendConfirmed({
              runId,
              reason,
            });
  
            if (confirmed) {
              state.autoSendWaiting = false;
              if (!isManualSend) {
                setStatus('上传完成，并已自动发送');
              }
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][auto-send-wait:sent] runId=${runId} reason=${reason} waited=${Date.now() - state.autoSendStartedAt}`
              );
              scheduleRenderUpload('auto-send-wait:sent');
              return true;
            }
  
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][auto-send-wait:not-confirmed-retry] runId=${runId}`
            );
  
            await sleep(600);
          }
  
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][auto-send-wait:stopped] runId=${runId} current=${state.autoSendRunId}`
          );
          scheduleRenderUpload('auto-send-wait:stopped');
          return false;
        } finally {
          if (state.autoSendRunId === runId) {
            state.autoSendWaiting = false;
            scheduleRenderUpload('auto-send-wait:finally');
          }
        }
      }
  
      async function waitAndClickSendAfterUpload(uploadResult) {
        const result = uploadResult || {};
        const success = Number(result.success) || 0;
        const failed = Number(result.failed) || 0;
        const cancelled = !!result.cancelled;
  
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-send:check] success=${success} failed=${failed} cancelled=${cancelled}`
        );
  
        if (cancelled) {
          setStatus('上传已取消，不发送');
          ToolboxShell.appendLog('[UPLOAD_DIAG][upload-send:skip] reason=cancelled');
          return false;
        }
  
        if (result.skipped || (Number(result.total) || 0) <= 0) {
          setStatus('没有可上传文件，不发送');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][upload-send:skip] reason=${result.reason || 'skipped-or-empty'}`
          );
          return false;
        }
  
        if (success <= 0) {
          setStatus('没有上传成功的文件，不发送');
          ToolboxShell.appendLog('[UPLOAD_DIAG][upload-send:skip] reason=no-success');
          return false;
        }
  
        const runId = Date.now();
  
        return waitForSendButtonAndClick({
          runId,
          reason: 'upload-then-send',
          timeoutMs: SEND_WAIT_TIMEOUT_MS,
        });
      }
  
      async function sendCurrentMessageFromUploadPanel(triggerSource) {
        const runId = Date.now();
        const source = triggerSource || 'button';
  
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:click] source=${source} runId=${runId} queue=${state.queue.length} running=${state.running}`
        );
  
        try {
          state.autoSendWaiting = false;
          state.autoSendRunId = runId;
          state.autoSendWaiting = true;
          uploadSendTaskStartedAt = Date.now();
          state.autoSendStartedAt = Date.now();
          state.autoSendLastStatusAt = 0;
          state.autoSendLastLogAt = 0;
  
          scheduleRenderUpload('send-message:start');
  
          setStatus('正在等待发送按钮...');
  
          const ok = await waitForSendButtonAndClick({
            runId,
            reason: 'manual-send-message',
            requireUploadSuccess: false,
            timeoutMs: SEND_WAIT_TIMEOUT_MS,
          });
  
          if (ok) {
            setStatus('已发送信息');
            ToolboxShell.appendLog(`[UPLOAD_DIAG][send-message-button:sent] runId=${runId}`);
            return true;
          }
  
          setStatus('发送未完成');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][send-message-button:not-sent] runId=${runId}`);
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
  
      function shouldIgnoreUploadSendShortcutTarget(target) {
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
  
      function isEnterKeyEvent(e) {
        return e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
      }
  
      function isCopyLastMessageShortcutEvent(e) {
        const key = String(e.key || '').toLowerCase();
        const code = String(e.code || '').toLowerCase();
        if (e.key === 'F8' || e.code === 'F8') {
          return true;
        }
        if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (key === 'c' || code === 'keyc')) {
          return true;
        }
        if (!e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (key === 'c' || code === 'keyc')) {
          return true;
        }
        return false;
      }
  
      function isUploadSendShortcutEvent(e) {
        return !!(
          e
          && e.ctrlKey
          && !e.shiftKey
          && !e.altKey
          && !e.metaKey
          && isEnterKeyEvent(e)
        );
      }
  
      function resetUploadSendShortcutState(reason, runId) {
        uploadSendShortcutRunning = false;
        uploadSendTaskStartedAt = 0;
        if (runId == null || state.autoSendRunId === runId) {
          state.autoSendWaiting = false;
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
        if (shouldIgnoreUploadSendShortcutTarget(e.target)) {
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
        if (uploadSendShortcutRunning || state.autoSendWaiting) {
          const runningMs = uploadSendTaskStartedAt ? Date.now() - uploadSendTaskStartedAt : 0;
          if (runningMs > 30000 && !ComposerApi.isAssistantLikelyBusy()) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][send-shortcut:stale-reset] runningMs=${runningMs} waiting=${state.autoSendWaiting ? '1' : '0'}`
            );
            resetUploadSendShortcutState('stale-shortcut-auto-reset', state.autoSendRunId);
          } else {
            setStatus('正在等待发送中，请不要重复触发', 'warn');
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][send-shortcut:ignored] reason=running shortcutRunning=${uploadSendShortcutRunning ? '1' : '0'} autoSendWaiting=${state.autoSendWaiting ? '1' : '0'} runningMs=${runningMs}`
            );
            return true;
          }
        }
        uploadSendShortcutRunning = true;
        uploadSendTaskStartedAt = Date.now();
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-shortcut:trigger] key=${e.key || '-'} code=${e.code || '-'} source=${source || '-'}`
        );
        setStatus('快捷键触发：正在等待发送按钮', 'running');
        void sendCurrentMessageFromUploadPanel('shortcut').catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] send shortcut failed', err);
          setStatus(`快捷键发送失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][send-shortcut:failed] error=${errText}`);
          resetUploadSendShortcutState('shortcut-catch', state.autoSendRunId);
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
        ToolboxShell.appendLog('[SHORTCUT][bind] send=Ctrl+Enter');
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
  
        if (!state.queue.length) {
          setStatus('当前分组没有文件');
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-empty-queue]');
          return buildUploadSkipResult('empty-queue');
        }
  
        refreshQueueReadableState();
        await reconcileFailedItems();
        scheduleRenderUpload('startUpload:after-refresh');
        persistQueueThrottled('startUpload:after-refresh');
  
        logUploadQueueSnapshot('startUpload:after-refresh');
  
        const attachedCount = state.queue.filter((q) => q && q.state === UploadState.ATTACHED).length;
        const uploadablePlan = state.queue.filter((q) => {
          return q &&
            q.state !== UploadState.ATTACHED &&
            q.state !== UploadState.CANCELLED;
        });
  
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][startUpload:plan] total=${state.queue.length} attached=${attachedCount} uploadable=${uploadablePlan.length}`
        );
  
        const targets = state.queue.filter((q) => {
          if (!q) return false;
  
          if (
            q.state === UploadState.ATTACHING ||
            q.state === UploadState.READING ||
            q.state === UploadState.VERIFYING
          ) {
            return false;
          }
  
          return hasAttemptableUploadSource(q);
        });
  
        const uploadableTargets = targets;
        const missingTargets = state.queue.filter((q) => q && !hasAttemptableUploadSource(q));
  
        uploadableTargets.forEach((q) => {
          logUploadItemSource('startUpload:uploadable', q);
        });
  
        missingTargets.forEach((q) => {
          logUploadItemSource('startUpload:missing', q, {
            reason: 'not readable before upload',
          });
        });
  
        if (!targets.length) {
          scheduleRenderUpload('startUpload:skip-no-targets');
          setStatus('当前没有可上传文件，请重新拖入');
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-targets]');
          return buildUploadSkipResult('no-uploadable-targets');
        }
  
        if (!uploadableTargets.length) {
          scheduleRenderUpload('startUpload:block-no-source');
          setStatus('当前没有可上传文件，请重新拖入');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:block-no-source] missing=${missingTargets.length}`
          );
          return buildUploadSkipResult('no-uploadable-targets');
        }
  
        const missingChanged = markMissingLocalFiles(uploadableTargets);
  
        if (missingChanged) {
          scheduleRenderUpload('startUpload:missing-marked');
          persistQueueThrottled('startUpload:missing-marked');
        }
  
        const reallyUploadable = uploadableTargets;
  
        if (!reallyUploadable.length) {
          scheduleRenderUpload('startUpload:block-no-source-empty');
          setStatus('当前没有可上传文件，请重新拖入');
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:block-no-source]');
          return buildUploadSkipResult('no-uploadable-targets');
        }
  
        if (missingChanged && reallyUploadable.length < uploadableTargets.length) {
          ToolboxShell.appendLog(`本次跳过 ${uploadableTargets.length - reallyUploadable.length} 个缺少文件项，实际上传 ${reallyUploadable.length} 个`);
        } else if (missingTargets.length) {
          ToolboxShell.appendLog(`本次跳过 ${missingTargets.length} 个缺少文件项，继续上传 ${reallyUploadable.length} 个可上传文件`);
        }
  
        startDuplicateWatcher();
  
        state.running = true;
        state.cancelled = false;
        state.runId += 1;
        const runId = state.runId;
        state.uploadAbortController = new AbortController();
  
        scheduleRenderUpload('startUpload:before-loop');
  
        ToolboxShell.appendLog(`开始批量上传：当前：${getActiveGroupName()}，文件数 ${reallyUploadable.length}`);
  
        reallyUploadable.forEach((q) => {
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
  
        const total = reallyUploadable.length;
  
        try {
          for (let i = 0; i < reallyUploadable.length; i += 1) {
            if (state.cancelled || runId !== state.runId) {
              break;
            }
  
            const q = reallyUploadable[i];
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
  
          let settledTargets = resolveUploadTargets(reallyUploadable);
  
          settledTargets.forEach((item) => {
            if (
              item.state === UploadState.READING ||
              item.state === UploadState.ATTACHING ||
              item.state === UploadState.VERIFYING ||
              item.state === UploadState.PENDING_CONFIRM
            ) {
              updateItem(item.id, {
                state: UploadState.FAILED,
                message: '上传流程结束时仍未完成',
              });
            }
          });
  
          await reconcileFailedItems();
  
          settledTargets = resolveUploadTargets(reallyUploadable);
  
          const result = countUploadResult(settledTargets);
  
          if (areAllUploadTargetsSettled(settledTargets)) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][startUpload:all-targets-settled] success=${result.success} failed=${result.failed}`
            );
          }
  
          const allAttached = settledTargets.every((q) => q && q.state === UploadState.ATTACHED);
  
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
          if (runId === state.runId || state.cancelled) {
            const stillRunningItems = state.queue.filter((item) => {
              return item &&
                (
                  item.state === UploadState.ATTACHING ||
                  item.state === UploadState.READING ||
                  item.state === UploadState.VERIFYING
                );
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
  
            const settledTargets = resolveUploadTargets(reallyUploadable);
            const result = countUploadResult(settledTargets);
  
            render();
  
            setStatus(
              state.cancelled
                ? `已停止上传：成功 ${result.success}，失：${result.failed}`
                : `上传完成：成：${result.success}，失：${result.failed}`,
              state.cancelled ? 'warn' : 'success',
            );
  
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][startUpload:finalize] success=${result.success} failed=${result.failed} running=${state.running} groupId=${state.activeGroupId || '-'}`,
            );
  
            persistQueueInBackground('startUpload:finalize');
  
            finalResult = buildUploadResult(
              result.success,
              result.failed,
              state.cancelled,
              reallyUploadable.length,
            );
          }
        }
  
        return finalResult || buildUploadSkipResult('upload-not-finalized');
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
          copyLastMessageBtn.disabled = false;
          copyLastMessageBtn.textContent = '复制最后消息';
          copyLastMessageBtn.title = '复制最后消息：空闲时立即复制；回答中则等待回答完成后复制。快捷键：F8；备用：Alt + C / Ctrl + Alt + C';
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
  
      function getLatestAssistantTextForCopyCheck() {
        const result = getLastConversationMessageText({
          preferAssistant: true,
        });
  
        if (!result || !result.ok || !result.text) {
          return '';
        }
  
        return String(result.text || '').trim();
      }
  
      function hasRealStopButtonForCopy() {
        const selectors = [
          'button[data-testid="stop-button"]',
          'button[aria-label*="Stop"]',
          'button[aria-label*="停止"]',
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
          if (hasRealStopButtonForCopy()) {
            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-fast] reason=real-stop-button');
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
  
        try {
          void withTimeout(
            forceChatPageToAbsoluteEnd('copy-last-message-before-background'),
            1200,
            'force-end-before-copy-background'
          ).catch((err) => {
            const errText = err && err.message ? err.message : String(err);
            console.warn('[ChatGPT toolbox] force end before copy background failed', err);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:force-end-before-bg-failed] error=${errText}`);
          });
  
          await sleep(30);
  
          const result = getLastConversationMessageText({
            preferAssistant: true,
          });
  
          if (!result.ok || !result.text) {
            ToolboxShell.setStatus('未找到可复制的最后一条消息', 'warn');
  
            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('未找到最后消息', 'warn');
            }
  
            ToolboxShell.appendLog(
              `[CHAT_PAGE][copy-last-message:skip] source=${source} reason=${result.reason || '-'}`
            );
  
            void forceChatPageToAbsoluteEnd('copy-last-message-no-message').catch((scrollErr) => {
              const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
              console.warn('[ChatGPT toolbox] force end after no message failed', scrollErr);
              ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:no-message-scroll-failed] error=${scrollErrText}`);
            });
  
            return false;
          }
  
          await copyTextToClipboard(result.text);
  
          window.setTimeout(() => {
            try {
              ToolboxShell.setStatus(
                `已复制最后一条消息：${result.text.length} 字`,
                'success',
                {
                  persist: false,
                },
              );
  
              if (typeof ToolboxShell.showToast === 'function') {
                ToolboxShell.showToast(`已复制 ${result.text.length} 字`, 'success', 900);
              }
  
              ToolboxShell.appendLog(
                `[CHAT_PAGE][copy-last-message:ok] source=${source} role=${result.role || '-'} chars=${result.text.length} reason=${result.reason || '-'}`
              );
            } catch (uiErr) {
              const uiErrText = uiErr && uiErr.message ? uiErr.message : String(uiErr);
              console.error('[ChatGPT toolbox] copy success UI update failed', uiErr);
              ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:success-ui-failed] error=${uiErrText}`);
            }
          }, 0);
  
          void forceChatPageToAbsoluteEnd('copy-last-message-after-copy').catch((scrollErr) => {
            const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
            console.warn('[ChatGPT toolbox] force end after copy failed', scrollErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:after-copy-scroll-failed] error=${scrollErrText}`);
          });
  
          return true;
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          const isFocusClipboardError = /Document is not focused|clipboard|writeText/i.test(errText);
          console.error('[ChatGPT toolbox] copy last message failed', err);
  
          ToolboxShell.setStatus(
            isFocusClipboardError
              ? '复制失败：浏览器拒绝写入剪贴板，请启用 GM_setClipboard 或重新点击复制'
              : `复制最后一条消息失败：${errText}`,
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
  
          void forceChatPageToAbsoluteEnd('copy-last-message-error').catch((scrollErr) => {
            const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
            console.warn('[ChatGPT toolbox] force end after copy error failed', scrollErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:force-end-error-failed] error=${scrollErrText}`);
          });
  
          return false;
        }
      }
  
      async function copyLastMessageAndScrollBottom(triggerSource) {
        const source = triggerSource || 'button';
        const copyLastMessageBtn = rootElRef
          ? qs('#cgpt-copy-last-message-scroll-bottom', rootElRef)
          : null;
  
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
                '正在执行复制最后消息，请不要重复触发',
                'running',
                {
                  persist: true,
                  shortText: copyLastMessageWaiting ? '等回答' : '复制中',
                },
              );
  
              if (typeof ToolboxShell.showToast === 'function') {
                ToolboxShell.showToast(
                  copyLastMessageWaiting ? '正在等待回答完成' : '正在复制',
                  'running',
                  900,
                );
              }
  
              ToolboxShell.appendLog(
                `[CHAT_PAGE][copy-last-message:ignored] reason=task-running source=${source} current=${copyLastMessageTaskSource || '-'} runningMs=${runningMs}`
              );
  
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
  
          if (!busyAtClick) {
            ToolboxShell.setStatus(
              '正在复制最后消息...',
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
            copyLastMessageBtn.disabled = false;
            copyLastMessageBtn.textContent = '等待回答';
          }
  
          ToolboxShell.setStatus(
            '正在回答中，等待回答完成后复制最后消息...',
            'running',
            {
              persist: true,
              shortText: '等回答',
            },
          );
  
          if (typeof ToolboxShell.showToast === 'function') {
            ToolboxShell.showToast('等待回答完成后复制', 'running', 1100);
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
            '回答已完成，正在复制最后消息...',
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
            `复制最后消息失败：${errText}`,
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
  
      function shouldIgnoreCopyLastMessageShortcutTarget(target) {
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
          if (shouldIgnoreCopyLastMessageShortcutTarget(e.target)) {
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
              '正在复制最后消息，请不要重复触发',
              'running',
              {
                persist: true,
                shortText: copyLastMessageWaiting ? '等回答' : '复制中',
              },
            );
            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message-shortcut:ignored] reason=running');
            return;
          }
          copyLastMessageShortcutRunning = true;
          ToolboxShell.setStatus(
            '快捷键触发：正在复制最后消息',
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
              `快捷键复制最后消息失败：${errText}`,
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
        ToolboxShell.appendLog('[SHORTCUT][bind] copy=F8|Alt+C|Ctrl+Alt+C');
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
        }
  
        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][hit] action=${action} source=${src} disabled=${button.disabled ? '1' : '0'}`,
        );
  
        if (typeof ToolboxShell.suspendEdgeAutoHide === 'function') {
          ToolboxShell.suspendEdgeAutoHide(`run-action:${action}:${src}`, 3000);
        }
  
        if (shouldSkipUploadUiAction(action, src, 350)) {
          return true;
        }
  
        if (button.disabled && action !== 'copy-last-message') {
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
              `复制最后消息失败：${errText}`,
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
          void sendCurrentMessageFromUploadPanel(src).catch((err) => {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] send message UI action failed', err);
            setStatus(`发送信息失败：${errText}`, 'error');
            ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][send-message:failed] error=${errText}`);
            resetUploadSendShortcutState('ui-action-catch', state.autoSendRunId);
          });
  
          return true;
        }
  
        if (action === 'start-upload') {
          if (state.running) {
            setStatus('正在上传中，请稍后', 'running');
            ToolboxShell.appendLog('[UPLOAD_UI_ACTION][start-upload:ignored] reason=running');
            return true;
          }
  
          void (async () => {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][upload-button:click] source=${src} total=${state.queue.length}`,
            );
  
            const changed = resetQueueItemsForUpload();
  
            if (changed) {
              ToolboxShell.appendLog('[UPLOAD_DIAG][upload:reset-before-start]');
              scheduleRenderUpload('upload:reset-before-start');
              persistQueueThrottled('upload:reset-before-start');
            }
  
            await startUpload();
          })().catch((err) => {
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
        if (uploadDelegatedClickBound) {
          return;
        }
  
        uploadDelegatedClickBound = true;
  
        rootEl.addEventListener('click', (e) => {
          const target = e.target instanceof Element ? e.target : null;
          if (!target) {
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
  
      function bindEvents(rootEl) {
        const uploadStartBtn = qs('#cgpt-upload-start', rootEl);
        if (!uploadStartBtn) {
          console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-start');
          ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-btn]');
        }
  
        const uploadStartSendBtn = qs('#cgpt-upload-start-send', rootEl);
        if (!uploadStartSendBtn) {
          console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-start-send');
          ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-send-btn]');
        }
  
        const copyLastMessageBtn = qs('#cgpt-copy-last-message-scroll-bottom', rootEl);
  
        if (!copyLastMessageBtn) {
          console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-copy-last-message-scroll-bottom');
          ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-copy-last-message-btn]');
        }
  
        const addInlineBtn = qs('#cgpt-upload-group-add-inline', rootEl);
        if (addInlineBtn) {
          addInlineBtn.addEventListener('click', () => {
            void createGroupInline();
          });
        }
  
        qs('#cgpt-upload-group-manage', rootEl).addEventListener('click', () => {
          toggleGroupManagePanel();
        });
  
        qs('#cgpt-upload-group-rename-inline', rootEl).addEventListener('click', () => {
          void renameActiveGroupInline();
        });
  
        if (groupNameInputEl) {
          groupNameInputEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
  
            e.preventDefault();
            e.stopPropagation();
  
            void renameActiveGroupInline();
          });
  
          groupNameInputEl.addEventListener('blur', () => {
            const text = String(groupNameInputEl.value || '').trim();
  
            if (!text) return;
            if (text === lastGroupNameInputValue) return;
  
            void renameActiveGroupInline();
          });
        }
  
        qs('#cgpt-upload-group-clear-inline', rootEl).addEventListener('click', (e) => {
          void clearActiveGroupQueueInline(e.currentTarget);
        });
  
        qs('#cgpt-upload-group-delete-inline', rootEl).addEventListener('click', (e) => {
          void deleteActiveGroupInline(e.currentTarget);
        });
  
        qs('#cgpt-upload-blob-persist-inline', rootEl).addEventListener('change', async (e) => {
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
  
        const uniqueNameEl = qs('#cgpt-upload-use-unique-name-inline', rootEl);
  
        if (uniqueNameEl) {
          uniqueNameEl.addEventListener('change', (e) => {
            const checked = !!e.target.checked;
  
            setUploadUseUniqueFileNameEnabled(checked);
  
            setStatus(checked ? '已开启：上传前重命名（时间戳 + 序号）' : '已关闭：上传前重命名偏好（上传时仍会自动重命名）');
            ToolboxShell.appendLog(checked ? '已开启上传前重命名（时间戳 + 序号）' : '已关闭上传前重命名偏好');
            syncUploadRenameStatusEl();
          });
        }
  
        groupListEl.addEventListener('click', async (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('.cgpt-upload-group-chip[data-group-id]')
            : null;
  
          if (!btn) return;
  
          const groupId = btn.getAttribute('data-group-id');
          if (!groupId) return;
  
          await switchGroup(groupId);
        });
  
        if (manageGroupListEl) {
          manageGroupListEl.addEventListener('click', async (e) => {
            const btn = e.target instanceof HTMLElement
              ? e.target.closest('.cgpt-upload-manage-group-item[data-group-id]')
              : null;
  
            if (!btn) return;
  
            const groupId = btn.getAttribute('data-group-id');
            if (!groupId) return;
  
            const currentText = groupNameInputEl ? String(groupNameInputEl.value || '').trim() : '';
            const currentGroup = getActiveGroup();
  
            if (currentGroup && currentText && currentText !== currentGroup.name) {
              await renameActiveGroupInline();
            }
  
            await switchGroup(groupId);
            syncGroupManagePanel({
              force: true,
            });
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
  
          const itemEl = target.closest('.cgpt-upload-item[data-id]');
  
          if (!itemEl) return;
          if (itemEl.classList.contains('empty')) return;
  
          const id = itemEl.getAttribute('data-id');
          if (!id) return;
  
          const q = state.queue.find((item) => item && item.id === id);
          if (!q) {
            setStatus('未找到对应文件');
            ToolboxShell.appendLog(`[UPLOAD_DIAG][upload-list-click:missing-item] id=${id || '-'}`);
            return;
          }
  
          state.activeId = id;
  
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][upload-list-click:upload] id=${id || '-'} name=${q.name || '-'} state=${q.state || '-'} running=${state.running}`,
          );
  
          try {
            await uploadSingleFromListClick(id);
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] upload list item click failed', err);
            setStatus(`点击文件上传失败：${errText}`);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][upload-list-click:failed] id=${id || '-'} error=${errText}`,
            );
          }
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
              saveQuickPromptActiveCategory(category);
  
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
        bindShortcutWindowFallback();
        bindUploadDelegatedClick(rootEl);
      }
  
      function validateUploadDomStructure(rootEl) {
        const managePanel = qs('#cgpt-upload-manage-panel', rootEl);
        const startBtn = qs('#cgpt-upload-start', rootEl);
        const startSendBtn = qs('#cgpt-upload-start-send', rootEl);
        const copyLastMessageBtn = qs('#cgpt-copy-last-message-scroll-bottom', rootEl);
        const listEl = qs('#cgpt-upload-list', rootEl);
        const quickPromptEl = qs('#cgpt-upload-quick-prompts', rootEl);
  
        if (!copyLastMessageBtn) {
          ToolboxShell.appendLog('[UPLOAD_DOM][missing] #cgpt-copy-last-message-scroll-bottom');
        }
  
        if (managePanel && copyLastMessageBtn && managePanel.contains(copyLastMessageBtn)) {
          ToolboxShell.appendLog('[UPLOAD_DOM][invalid] 复制最后消息按钮被错误放进管理面板');
        }
  
        if (!startBtn) {
          console.error('[ChatGPT toolbox] UploadModule DOM 错误：缺少 #cgpt-upload-start');
        }
  
        if (!startSendBtn) {
          console.error('[ChatGPT toolbox] UploadModule DOM 错误：缺少 #cgpt-upload-start-send');
        }
  
        if (!listEl) {
          console.error('[ChatGPT toolbox] UploadModule DOM 错误：缺少 #cgpt-upload-list');
        }
  
        if (managePanel && startBtn && managePanel.contains(startBtn)) {
          console.error('[ChatGPT toolbox] UploadModule DOM 错误：上传按钮被错误包进管理面板');
        }
  
        if (managePanel && startSendBtn && managePanel.contains(startSendBtn)) {
          console.error('[ChatGPT toolbox] UploadModule DOM 错误：发送信息按钮被错误包进管理面板');
        }
  
        if (managePanel && listEl && managePanel.contains(listEl)) {
          console.error('[ChatGPT toolbox] UploadModule DOM 错误：上传列表被错误包进管理面板');
        }
  
        if (managePanel && quickPromptEl && managePanel.contains(quickPromptEl)) {
          console.error('[ChatGPT toolbox] UploadModule DOM 错误：常用 Prompt 被错误包进管理面板');
        }
  
        if (startBtn && quickPromptEl && listEl) {
          const listAfterStart = !!(startBtn.compareDocumentPosition(listEl) & Node.DOCUMENT_POSITION_FOLLOWING);
          const quickAfterList = !!(listEl.compareDocumentPosition(quickPromptEl) & Node.DOCUMENT_POSITION_FOLLOWING);
  
          if (!listAfterStart) {
            console.error('[ChatGPT toolbox] UploadModule DOM 错误：上传文件列表应位于上传按钮之后');
          }
  
          if (!quickAfterList) {
            console.error('[ChatGPT toolbox] UploadModule DOM 错误：常用 Prompt 应位于上传文件列表之后');
          }
        }
      }
  
      function mount(targetHost) {
        if (!targetHost || targetHost.querySelector('#cgpt-upload-module')) return;
  
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
              <button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom">复制最后消息</button>
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
  
        listEl = qs('#cgpt-upload-list', rootEl);
        groupListEl = qs('#cgpt-upload-group-list', rootEl);
        managePanelEl = qs('#cgpt-upload-manage-panel', rootEl);
        manageGroupListEl = qs('#cgpt-upload-manage-group-list', rootEl);
        groupNameInputEl = qs('#cgpt-upload-group-name-input', rootEl);
        startBtn = qs('#cgpt-upload-start', rootEl);
  
        validateUploadDomStructure(rootEl);
  
        bindEvents(rootEl);
        loadGroups()
          .then(() => refreshUploadGroupCounts())
          .then(() => loadQueueForActiveGroup())
          .then(() => render())
          .catch((err) => {
            console.error('[ChatGPT toolbox] init upload groups failed', err);
            render();
          });
  
        document.addEventListener('keydown', (e) => {
          if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.code !== 'KeyU') return;
  
          if (isEditableTarget(e.target)) {
            // 保留原脚本习惯：输入框内也允Ctrl/Cmd + Shift + U 触发上传
            return;
          }
  
          e.preventDefault();
  
          (async () => {
            try {
              const changed = resetQueueItemsForUpload();
  
              if (changed) {
                ToolboxShell.appendLog('[UPLOAD_DIAG][upload:reset-before-start]');
                scheduleRenderUpload('upload:reset-before-start');
                persistQueueThrottled('upload:reset-before-start');
              }
  
              await startUpload();
            } catch (err) {
              console.error('[ChatGPT toolbox] upload shortcut failed', err);
            }
          })();
        }, true);
      }
  
      function getUploadStatus() {
        return {
          groupCount: state.groups.length,
          activeGroupId: state.activeGroupId,
          activeGroupName: getActiveGroupName(),
          total: state.queue.length,
          attached: state.queue.filter((q) => q.state === UploadState.ATTACHED).length,
          failed: state.queue.filter((q) => q.state === UploadState.FAILED).length,
          running: state.running,
        };
      }
  
      async function startUploadFromBridge(payload = {}) {
        const source = String(payload.source || 'bridge-start-upload').trim() || 'bridge-start-upload';
        const resetBeforeStart = payload.reset_before_start !== false;
        const forceRestart = payload.force_restart !== false;
  
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][START] source=${source} total=${state.queue.length} running=${state.running}`
        );
  
        if (resetBeforeStart) {
          const changed = resetQueueItemsForUpload({
            forceAll: true,
            reason: source,
          });
  
          ToolboxShell.appendLog(
            `[BRIDGE][UPLOAD][RESET] source=${source} changed=${changed} total=${state.queue.length}`
          );
  
          if (changed) {
            scheduleRenderUpload('bridge-start-upload:reset');
            persistQueueThrottled('bridge-start-upload:reset');
          }
        }
  
        const result = await startUpload({
          forceRestart,
          reason: source,
        });
  
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
        getStatus: getUploadStatus,
        refresh: () => {
          render();
          syncGlobalDocumentDropBinding();
        },
        exportGroupsAndQueueMeta,
        importGroupsAndQueueMeta,
        startUploadFromBridge,
      };
    })();
  
    /********************************************************************
     * 4. AutoQueueModule：自动指令队列模   ********************************************************************/
  
    const AutoQueueModule = (() => {
      MemoryManager.migrateLegacyKeys();
  
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
          .map((item) => ({
            id: String(item.id || createId('autoq_list')),
            name: String(item.name || '未命名列表').trim().slice(0, 24) || '未命名列表',
            text: String(item.text || ''),
            createdAt: Number(item.createdAt) || nowMs(),
            updatedAt: Number(item.updatedAt) || nowMs(),
          }));
  
        if (!config.listProfiles.length) {
          config.listProfiles.push({
            id: createId('autoq_list'),
            name: '默认列表',
            text: String(config.listPromptsText || DEFAULT_AUTO_CONFIG.listPromptsText),
            createdAt: nowMs(),
            updatedAt: nowMs(),
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
  
        if (!names.has(base)) {
          return base;
        }
  
        let index = 2;
        let name = `${base}_${index}`;
  
        while (names.has(name)) {
          index += 1;
          name = `${base}_${index}`;
        }
  
        return name;
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
  
      function cleanLegacyGlobalModeFields(cfg = config) {
        delete cfg.loopMode;
        delete cfg.randomMinSec;
        delete cfg.randomMaxSec;
        delete cfg.maxLoopCount;
        delete cfg.autoScrollPanel;
      }
  
      function migrateLegacyGlobalModeSettings(cfg = config) {
        const hasLegacy = (
          Object.prototype.hasOwnProperty.call(cfg, 'loopMode')
          || Object.prototype.hasOwnProperty.call(cfg, 'randomMinSec')
          || Object.prototype.hasOwnProperty.call(cfg, 'randomMaxSec')
          || Object.prototype.hasOwnProperty.call(cfg, 'maxLoopCount')
          || Object.prototype.hasOwnProperty.call(cfg, 'autoScrollPanel')
        );
  
        if (!hasLegacy) return;
  
        cfg.modeSettings = ensureModeSettings(cfg);
  
        const targetMode = normalizeAutoMode(cfg.promptMode);
        const target = cfg.modeSettings[targetMode];
        const minSec = Math.max(1, Number(cfg.randomMinSec) || target.randomMinSec);
  
        target.loopMode = !!cfg.loopMode;
        target.randomMinSec = minSec;
        target.randomMaxSec = Math.max(minSec, Number(cfg.randomMaxSec) || target.randomMaxSec);
        target.maxLoopCount = Math.max(0, Number(cfg.maxLoopCount) || target.maxLoopCount);
  
        if (Object.prototype.hasOwnProperty.call(cfg, 'autoScrollPanel')) {
          target.autoScrollPanel = !!cfg.autoScrollPanel;
          target.logPinned = !!cfg.autoScrollPanel;
        }
  
        cleanLegacyGlobalModeFields(cfg);
      }
  
      function normalizeAutoConfig(cfg = config) {
        migrateLegacyGlobalModeSettings(cfg);
        cfg.modeSettings = ensureModeSettings(cfg);
        cleanLegacyGlobalModeFields(cfg);
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
        cleanLegacyGlobalModeFields();
  
        const active = getActiveListProfile();
  
        if (active) {
          config.listPromptsText = active.text;
        }
  
        MemoryManager.set(
          MemoryManager.KEYS.autoQueueConfig,
          JSON.parse(JSON.stringify(config)),
        );
      }
  
      const debouncedSaveConfig = debounceSave(saveConfig, 300);
  
      function applyConfig(next) {
        const incoming = next && typeof next === 'object'
          ? JSON.parse(JSON.stringify(next))
          : {};
  
        migrateLegacyGlobalModeSettings(incoming);
  
        Object.keys(config).forEach((key) => {
          delete config[key];
        });
  
        Object.assign(config, createDefaultAutoConfig(), incoming);
  
        if (!config.modeSettings || typeof config.modeSettings !== 'object') {
          config.modeSettings = createDefaultModeSettings();
        } else {
          config.modeSettings = JSON.parse(JSON.stringify(config.modeSettings));
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
  
        if (promptsEl) {
          setPromptsTextByMode(m, promptsEl.value);
        }
  
        readCurrentModeSettingsFromUi(m);
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
          class="cgpt-autoq-list-chip${active}"
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
  
        readPanelConfig('list');
  
        config.activeListProfileId = target.id;
        config.listPromptsText = String(target.text || '');
  
        refreshPromptTextareaForMode('list');
        renderListProfiles();
        saveConfig();
        updateStatus();
  
        ToolboxShell.setStatus(`已切换列表：${target.name}`);
        ToolboxShell.appendLog(`[自动指令] 已切换列表模板：${target.name}`);
      }
  
      function createListProfileInline() {
        readPanelConfig('list');
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
        readPanelConfig('list');
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
  
        if (busy) {
          state.replyBecameBusy = true;
          state.idleSince = 0;
          updateStatus();
          return;
        }
  
        if (!state.replyBecameBusy) {
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
  
        if (!ComposerApi.canSendNow()) {
          ToolboxShell.setStatus('当前找不到可用输入框或发送按钮不可用');
          return;
        }
  
        const okSet = ComposerApi.setComposerValue(prompt);
  
        if (!okSet) {
          log('写入输入框失败');
          return;
        }
  
        window.setTimeout(() => {
          const okSend = ComposerApi.clickSend();
  
          if (!okSend) {
            log('发送失败：找不到发送按钮');
            return;
          }
  
          state.sentCount += 1;
          state.waitingReply = true;
          state.replyBecameBusy = false;
          state.idleSince = 0;
  
          log(`已发送：${prompt.slice(0, 80)}`);
          updateStatus();
        }, 250);
      }
  
      function tick() {
        try {
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
          newListBtn.addEventListener('click', () => {
            createListProfileInline();
          });
        }
  
        const saveNameBtn = qs('#cgpt-autoq-list-save-name', root);
        if (saveNameBtn) {
          saveNameBtn.addEventListener('click', () => {
            renameActiveListProfileInline();
          });
        }
  
        const deleteListBtn = qs('#cgpt-autoq-list-delete', root);
        if (deleteListBtn) {
          deleteListBtn.addEventListener('click', (e) => {
            deleteActiveListProfileInline(e.currentTarget);
          });
        }
  
        if (listProfileNameEl) {
          listProfileNameEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
  
            e.preventDefault();
            e.stopPropagation();
  
            renameActiveListProfileInline();
          });
  
          listProfileNameEl.addEventListener('blur', () => {
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
        if (!targetHost || targetHost.querySelector('#cgpt-autoq-module')) return;
  
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
        ensureTicker();
      }
  
      function exportConfig() {
        readPanelConfig(config.promptMode);
        normalizeListProfiles();
        config.modeSettings = ensureModeSettings(config);
        cleanLegacyGlobalModeFields();
  
        const active = getActiveListProfile();
  
        if (active) {
          config.listPromptsText = active.text;
        }
  
        return JSON.parse(JSON.stringify(config));
      }
  
      return {
        mount,
        getConfig: () => {
          config.modeSettings = ensureModeSettings(config);
          cleanLegacyGlobalModeFields();
          return JSON.parse(JSON.stringify(config));
        },
        exportConfig,
        getState: () => Object.assign({}, state, {
          queue: state.queue.slice(),
        }),
        applyConfig,
      };
    })();
  
    /********************************************************************
     * 5. PromptManagerModule：Prompt 管理模块
     ********************************************************************/
  
    const PromptManagerModule = (() => {
      const STORAGE_KEY = MemoryManager.KEYS.promptManagerData;
  
      let root = null;
      let listEl = null;
      let searchEl = null;
      let statusEl = null;
      let importFileEl = null;
      let modalOverlay = null;
  
      let prompts = [];
      let categories = [];
      let searchKeyword = '';
      let activeCategory = MemoryManager.get(
        MemoryManager.KEYS.promptManagerActiveCategory,
        '全部',
      );
      let editingPromptId = null;
      let sendLock = false;
  
      function normalizePromptCategoryName(name) {
        const text = String(name || '').trim();
        return text || '默认';
      }
  
      function getPromptCategoryName(item) {
        return normalizePromptCategoryName(item && item.category);
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
  
      function createDefaultPrompts() {
        return DEFAULT_PROMPTS.map((item) => normalizePromptItem({
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
          nextPrompts = createDefaultPrompts();
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
        MemoryManager.migrateLegacyKeys();
  
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
  
        MemoryManager.set(STORAGE_KEY, {
          prompts: payload.prompts || prompts,
          categories: payload.categories || categories,
        });
      }
  
      function savePrompts() {
        savePromptManagerData({ prompts, categories });
      }
  
      function getPromptCategoryCount(categoryName) {
        if (categoryName === '全部') {
          return prompts.length;
        }
  
        return prompts.filter((p) => normalizePromptCategoryName(p.category) === categoryName).length;
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
          listEl.innerHTML = '<div class="cgpt-log-empty">暂无类别</div>';
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
            重命
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
  
        savePromptManagerData();
  
        if (input) input.value = '';
  
        render();
        renderCategoryManager();
        renderCategoryDatalist();
  
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
        renderCategoryManager();
        renderCategoryDatalist();
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
  
        savePromptManagerData();
        render();
        renderCategoryManager();
        renderCategoryDatalist();
        notifyUploadQuickPromptsRefresh();
  
        setStatus(`已删除类别：${cat.name}，相Prompt 已移动到默认`);
      }
  
      applyPromptManagerData(loadPromptManagerData());
  
      function notifyUploadQuickPromptsRefresh() {
        if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
          UploadModule.refresh();
        }
      }
  
      function reloadFromStorage() {
        applyPromptManagerData(loadPromptManagerData());
        searchKeyword = '';
        render();
        renderCategoryManager();
        renderCategoryDatalist();
        notifyUploadQuickPromptsRefresh();
      }
  
      function clearPromptStatus() {
        if (!statusEl) return;
        statusEl.textContent = '';
        statusEl.style.display = 'none';
      }
  
      function setStatus(message, timeout) {
        if (!statusEl) return;
  
        const text = String(message || '').trim();
  
        if (/^\d+\s*条\s*[，,]\s*当前显示\s*\d+\s*条$/.test(text)) {
          clearPromptStatus();
  
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
            ToolboxShell.purgeForbiddenStatusBadge('prompt-local-stat-status');
          }
  
          return;
        }
  
        statusEl.style.display = '';
        statusEl.textContent = text;
  
        const ms = timeout == null ? 1800 : timeout;
  
        if (ms > 0) {
          window.clearTimeout(setStatus.timer);
          setStatus.timer = window.setTimeout(() => {
            if (statusEl && statusEl.textContent === text) {
              statusEl.textContent = '';
              statusEl.style.display = 'none';
            }
          }, ms);
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
  
        bar.innerHTML = filterCategories.map((cat) => {
          const name = cat.name;
          const count = getPromptCategoryCount(name);
  
          return `
        <button type="button"
          class="cgpt-prompt-category-chip ${name === current ? 'active' : ''}"
          data-prompt-category="${escapeHtml(name)}"
          title="${escapeHtml(`${name}：${count} Prompt`)}">
          <span class="cgpt-chip-name">${escapeHtml(name)}</span>
          <span class="cgpt-chip-count">${count}</span>
        </button>
      `;
        }).join('');
      }
  
      function render() {
        if (!listEl) return;
  
        renderCategoryBar();
        renderCategoryManager();
        renderCategoryDatalist();
  
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
            sendPrompt(item.content, true);
          });
  
          const copyBtn = createActionButton('复制');
          copyBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await copyToClipboard(item.content, {
              success: '已复制 Prompt 内容',
              failure: '复制失败，请手动复制',
            });
            if (ok) {
              setStatus(`已复制：${item.title}`);
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
            const ok = window.confirm(`确定删除这个 Prompt 吗？\n\n${item.title}`);
            if (!ok) return;
            prompts = prompts.filter((prompt) => prompt.id !== item.id);
            savePrompts();
            render();
            notifyUploadQuickPromptsRefresh();
            setStatus('已删Prompt');
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
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        btn.className = type === 'primary' ? 'cgpt-btn primary' : 'cgpt-btn';
        btn.style.height = '28px';
        btn.style.padding = '0 8px';
        return btn;
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
          setStatus('已保存修改');
        } else {
          prompts.unshift({
            id: createId('prompt'),
            title,
            category,
            content,
            createdAt: nowMs(),
            updatedAt: nowMs(),
          });
          setStatus('已新Prompt');
        }
  
        savePrompts();
        render();
        notifyUploadQuickPromptsRefresh();
        closeEditor();
      }
  
      function deleteCurrentPrompt() {
        if (!editingPromptId) return;
  
        const item = prompts.find((prompt) => prompt.id === editingPromptId);
        if (!item) return;
  
        const ok = confirm(`确定删除这个 Prompt 吗？\n\n${item.title}`);
        if (!ok) return;
  
        prompts = prompts.filter((prompt) => prompt.id !== editingPromptId);
  
        savePrompts();
        render();
        notifyUploadQuickPromptsRefresh();
        closeEditor();
        setStatus('已删Prompt');
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
  
        savePromptManagerData();
        render();
        notifyUploadQuickPromptsRefresh();
        closeEditor();
        setStatus('已复Prompt');
      }
  
      function exportPrompts() {
        const data = {
          version: 4,
          exportedAt: new Date().toISOString(),
          prompts: prompts.slice(),
          categories: categories.slice(),
        };
  
        const date = new Date();
        const filename = `chatgpt-prompts-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}.json`;
  
        downloadTextFile(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
        setStatus('已导Prompt');
      }
  
      function importPrompts(event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
  
        if (!file) return;
  
        const reader = new FileReader();
  
        reader.onload = () => {
          try {
            const data = JSON.parse(String(reader.result || ''));
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
            console.error('[ChatGPT toolbox] Prompt import failed', e);
            alert('导入失败：JSON 文件格式不正确');
          }
        };
  
        reader.onerror = () => {
          console.warn('[ChatGPT toolbox] Prompt import read failed', reader.error);
          alert('导入失败：文件读取失败');
        };
  
        reader.readAsText(file, 'utf-8');
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
  
      function sendPrompt(content, autoSend) {
        if (autoSend && sendLock) {
          setStatus('正在发送中，请勿重复点击');
          return;
        }
  
        const okSet = ComposerApi.setComposerValue(content);
  
        if (!okSet) {
          console.error('[ChatGPT toolbox] Prompt fill failed: composer not found');
          ToolboxShell.appendLog('[Prompt 管理] 填入失败：未找到输入框');
          alert('没有找到 ChatGPT 输入框。请确认当前页面ChatGPT 对话页面');
          return;
        }
  
        if (!autoSend) {
          setStatus('已填入输入框，未自动发送');
          return;
        }
  
        sendLock = true;
        setStatus('已填入，正在发送…');
  
        window.setTimeout(() => {
          const okSend = ComposerApi.clickSend();
  
          if (okSend) {
            setStatus('已发送 Prompt');
            ToolboxShell.appendLog('[Prompt 管理] 已发送 Prompt');
          } else {
            setStatus('已填入，但没有找到可用发送按钮');
            console.error('[ChatGPT toolbox] Prompt send failed: no send button');
            ToolboxShell.appendLog('[Prompt 管理] 发送失败：发送按钮不可用');
          }
  
          sendLock = false;
        }, 260);
      }
  
      function createEditorModal() {
        if (document.getElementById('cgpt-prompt-editor-overlay')) {
          modalOverlay = document.getElementById('cgpt-prompt-editor-overlay');
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
                <input class="cgpt-input" id="cgpt-prompt-edit-category" list="cgpt-prompt-category-options" placeholder="例如：代码、Cursor、论>
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
        qs('#cgpt-prompt-new-quick-btn', root).addEventListener('click', () => openEditor(null));
        qs('#cgpt-prompt-export-btn', root).addEventListener('click', exportPrompts);
        qs('#cgpt-prompt-import-btn', root).addEventListener('click', () => importFileEl.click());
        qs('#cgpt-prompt-reset-btn', root).addEventListener('click', resetDefaultPrompts);
  
        importFileEl.addEventListener('change', importPrompts);
  
        searchEl.addEventListener('input', (event) => {
          searchKeyword = String(event.target.value || '').trim().toLowerCase();
          render();
        });
  
        const categoryBar = qs('#cgpt-prompt-category-bar', root);
        if (categoryBar) {
          categoryBar.addEventListener('click', (e) => {
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
          });
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
      }
  
      function mount(targetHost) {
        if (!targetHost || targetHost.querySelector('#cgpt-prompt-module')) return;
  
        root = document.createElement('div');
        root.id = 'cgpt-prompt-module';
        root.innerHTML = `
          <div class="cgpt-section">
            <div class="cgpt-section-title">Prompt 管理</div>
            <div id="cgpt-prompt-manage-tools" class="cgpt-grid-4" style="margin-top:8px;">
              <button type="button" class="cgpt-btn primary" id="cgpt-prompt-new-quick-btn">+ 新建 Prompt</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-export-btn">导出</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-import-btn">导入</button>
              <button type="button" class="cgpt-btn danger" id="cgpt-prompt-reset-btn">重置</button>
            </div>
  
            <div class="cgpt-section" id="cgpt-prompt-category-manager" style="margin-top:8px; padding:10px; border:1px solid #2f3542; border-radius:10px;">
              <div class="cgpt-section-title">类别管理</div>
  
              <div class="cgpt-prompt-category-edit-row">
                <input class="cgpt-input" id="cgpt-prompt-category-name" placeholder="输入类别名称，例如：论文">
                <button type="button" class="cgpt-btn primary" id="cgpt-prompt-category-add">新建类别</button>
              </div>
  
              <div id="cgpt-prompt-category-manage-list" class="cgpt-prompt-category-manage-list"></div>
            </div>
  
            <div style="margin-top:8px;">
              <div id="cgpt-prompt-category-bar" class="cgpt-prompt-category-bar"></div>
              <input id="cgpt-prompt-search" class="cgpt-input" placeholder="搜索标题、分类或内容...">
            </div>
  
            <input id="cgpt-prompt-import-file" type="file" accept="application/json,.json" style="display:none;">
          </div>
  
          <div class="cgpt-section">
            <div class="cgpt-section-title">Prompt 列表</div>
            <div id="cgpt-prompt-list" class="cgpt-prompt-list"></div>
            <div id="cgpt-prompt-status" class="cgpt-hint" style="margin-top:8px; display:none;"></div>
          </div>
        `;
  
        targetHost.appendChild(root);
  
        listEl = qs('#cgpt-prompt-list', root);
        searchEl = qs('#cgpt-prompt-search', root);
        statusEl = qs('#cgpt-prompt-status', root);
        importFileEl = qs('#cgpt-prompt-import-file', root);
  
        createEditorModal();
        bindEvents();
        render();
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
  
    const SettingsModule = (() => {
      let host = null;
      let root = null;
  
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
          `[SETTINGS][quickPrompt] upload=${cfg.showUploadQuickPrompts !== false} compact=${cfg.showCompactQuickPrompts !== false} selected=${(cfg.quickPromptIds || []).length}`,
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
          showUploadGroups: !!qs('#cgpt-setting-compact-show-upload-groups', root)?.checked,
          showUploadStartButton: !!qs('#cgpt-setting-compact-show-upload-start', root)?.checked,
          showUploadFileList: !!qs('#cgpt-setting-compact-show-file-list', root)?.checked,
          showUploadQuickPrompts,
          showCompactQuickPrompts,
          showQuickPrompts: showUploadQuickPrompts || showCompactQuickPrompts,
          quickPromptClickAction: qs('#cgpt-setting-compact-prompt-action', root)?.value || 'send',
          quickPromptActiveCategory: current.quickPromptActiveCategory || '全部',
          quickPromptIds,
          globalDropCaptureEnabled: !!qs('#cgpt-setting-global-drop-capture', root)?.checked,
        };
      }
  
      function render() {
        if (!root) return;
  
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
  
        const globalDropEl = qs('#cgpt-setting-global-drop-capture', root);
        if (globalDropEl) globalDropEl.checked = !!cfg.globalDropCaptureEnabled;
  
        const rememberActiveTabEl = qs('#cgpt-setting-remember-active-tab', root);
        if (rememberActiveTabEl) {
          rememberActiveTabEl.checked = shouldRememberActiveTab();
        }
  
        const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);
        if (edgeAutoHideEl) {
          edgeAutoHideEl.checked = MemoryManager.get(MemoryManager.KEYS.edgeAutoHideEnabled, true) !== false;
        }
  
        const promptListEl = qs('#cgpt-setting-compact-prompt-list', root);
        if (!promptListEl) return;
  
        const prompts = typeof PromptManagerModule !== 'undefined' && typeof PromptManagerModule.getPrompts === 'function'
          ? PromptManagerModule.getPrompts()
          : [];
        const selected = new Set(cfg.quickPromptIds || []);
  
        if (!prompts.length) {
          promptListEl.innerHTML = '<div class="cgpt-upload-meta">暂无 Prompt，请先到 Prompt 管理中添加。</div>';
          return;
        }
  
        promptListEl.innerHTML = prompts.map((p) => {
          const checked = selected.has(p.id) ? 'checked' : '';
          return `
            <label class="cgpt-checkbox-line cgpt-settings-prompt-row">
              <input type="checkbox" data-compact-prompt-id="${escapeHtml(p.id)}" ${checked}>
              <span>${escapeHtml(p.title || '未命名Prompt')}</span>
            </label>
          `;
        }).join('');
      }
  
      function bindEvents() {
        const ids = [
          'cgpt-setting-compact-show-upload-groups',
          'cgpt-setting-compact-show-upload-start',
          'cgpt-setting-compact-show-file-list',
          'cgpt-setting-upload-show-quick-prompts',
          'cgpt-setting-compact-show-quick-prompts',
          'cgpt-setting-global-drop-capture',
        ];
  
        ids.forEach((id) => {
          const el = qs(`#${id}`, root);
          if (!el) return;
  
          el.addEventListener('change', () => {
            const cfg = readFromUi();
            saveConfig(cfg);
            render();
          });
        });
  
        const actionEl = qs('#cgpt-setting-compact-prompt-action', root);
        if (actionEl) {
          actionEl.addEventListener('change', () => {
            const cfg = readFromUi();
            saveConfig(cfg);
            render();
          });
        }
  
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
  
        const rememberActiveTabEl = qs('#cgpt-setting-remember-active-tab', root);
  
        if (rememberActiveTabEl) {
          rememberActiveTabEl.addEventListener('change', () => {
            const enabled = !!rememberActiveTabEl.checked;
  
            MemoryManager.set(
              MemoryManager.KEYS.rememberActiveTab,
              enabled,
            );
  
            if (!enabled) {
              MemoryManager.set(MemoryManager.KEYS.activeTab, 'upload');
              ToolboxShell.appendLog('[SETTINGS][rememberActiveTab] 已关闭，下次默认打开多文件上传');
            } else {
              const currentTab = typeof ToolboxShell.getActiveTab === 'function'
                ? ToolboxShell.getActiveTab()
                : 'upload';
  
              MemoryManager.set(
                MemoryManager.KEYS.activeTab,
                currentTab || 'upload',
              );
  
              ToolboxShell.appendLog('[SETTINGS][rememberActiveTab] 已开启，开始记住当前选项卡');
            }
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
      }
  
      function mount(target) {
        host = target;
        if (!host) return;
  
        host.innerHTML = `
          <div class="cgpt-section">
            <div class="cgpt-section-title">设置</div>
  
            <div class="cgpt-section-title" style="margin-top: 4px;">基础设置</div>
  
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-remember-active-tab">
              记住上次选择的选项卡。
            </label>
            <div class="cgpt-hint">关闭后，每次刷新页面默认打开“多文件上传”。</div>
  
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-edge-auto-hide">
              工具箱贴边自动隐藏
            </label>
            <div class="cgpt-hint">开启后，拖动工具箱贴住浏览器四边后自动收起，只保留边缘把手；只是靠近边缘不会隐藏。关闭后只保留普通拖拽，不自动隐藏。</div>
  
            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn" id="cgpt-setting-reset-toolbox-position">重置工具箱位置</button>
            </div>
            <div class="cgpt-hint">当工具箱跑出屏幕或贴边状态异常时，可用此按钮将其恢复到右下角。</div>
  
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-upload-show-quick-prompts">
              上传页显示常用 Prompt 快捷区
            </label>
            <div class="cgpt-hint">开启后，在多文件上传页显示常用 Prompt 快捷按钮。</div>
  
            <div class="cgpt-section-title" style="margin-top: 10px;">精简模式显示内容</div>
  
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
  
            <div class="cgpt-section-title" style="margin-top: 10px;">常用 Prompt 快捷区</div>
            <div class="cgpt-hint">选择要显示在上传页快捷区域的 Prompt。点击后默认填入并发送到 ChatGPT，也可改为只填入输入框。</div>
            <div id="cgpt-setting-compact-prompt-list" class="cgpt-settings-prompt-list"></div>
  
            <div class="cgpt-section-title" style="margin-top: 10px;">拖拽上传</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-global-drop-capture">
              页面空白处拖入文件时加入工具箱队列
            </label>
            <div class="cgpt-hint">拖到 ChatGPT 输入框仍由 ChatGPT 原生处理；拖到工具箱面板内始终加入队列。</div>
          </div>
        `
  
        root = host;
        bindEvents();
        render();
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
      const PAGE_INSTANCE_ID = `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  
      const state = {
        mounted: false,
        root: null,
        timerId: 0,
        polling: false,
        handlingMessageId: null,
        lastIdentityKey: '',
        lastErrorLogAt: 0,
        lastErrorText: '',
        uploadBlockNextChatReason: '',
      };
  
      const CLIENT_ID = (() => {
        try {
          const saved = sessionStorage.getItem(CLIENT_ID_KEY);
          if (saved) return saved;
          const created = `tm-${Math.random().toString(36).slice(2, 10)}`;
          sessionStorage.setItem(CLIENT_ID_KEY, created);
          return created;
        } catch (error) {
          console.error('[BridgeModule] 无法使用 sessionStorage，使用临时 CLIENT_ID:', error);
          return `tm-${Math.random().toString(36).slice(2, 10)}`;
        }
      })();
  
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
          'X-Request-Source': SOURCE,
        };
        if (cfg.bridgeApiToken) {
          headers.Authorization = `Bearer ${cfg.bridgeApiToken}`;
          headers['X-API-Key'] = cfg.bridgeApiToken;
        }
        return headers;
      }
  
      function detectResponseState() {
        const isResponding = ComposerApi.isAssistantLikelyBusy();
        const composerText = ComposerApi.getComposerText();
        const sendButton = ComposerApi.findSendButton();
        const canAcceptInput = !isResponding && (!sendButton || ComposerApi.isSendButtonReady(sendButton));
  
        if (isResponding) {
          return {
            is_responding: true,
            response_state: 'generating',
            response_state_reason: 'assistant_busy',
            can_accept_input: false,
            response_state_at: Date.now(),
          };
        }
  
        if (composerText) {
          return {
            is_responding: false,
            response_state: 'composing',
            response_state_reason: 'composer_has_text',
            can_accept_input: canAcceptInput,
            response_state_at: Date.now(),
          };
        }
  
        return {
          is_responding: false,
          response_state: 'idle',
          response_state_reason: 'no_indicator',
          can_accept_input: canAcceptInput,
          response_state_at: Date.now(),
        };
      }
  
      function getBindRequestToken() {
        try {
          const url = new URL(location.href);
          const fromQuery = url.searchParams.get('xz_bind_token');
          if (fromQuery) {
            sessionStorage.setItem('xz_bind_token', fromQuery);
            return fromQuery;
          }
          const hash = String(location.hash || '');
          const match = hash.match(/xz_bind_token=([a-zA-Z0-9_-]+)/);
          if (match && match[1]) {
            sessionStorage.setItem('xz_bind_token', match[1]);
            return match[1];
          }
          return sessionStorage.getItem('xz_bind_token') || '';
        } catch (error) {
          logBridgeError(`getBindRequestToken 失败: ${error && error.message ? error.message : String(error)}`, error);
          return '';
        }
      }
  
      function getPageIdentity() {
        try {
          const url = new URL(location.href);
          const path = url.pathname || '';
  
          let pageType = 'unknown';
          let conversationId = '';
          const conversationMatch = path.match(/^\/c\/([^/?#]+)/);
          if (conversationMatch) {
            pageType = 'conversation';
            conversationId = conversationMatch[1];
          } else if (path === '/' || path === '') {
            pageType = 'home';
          } else if (path.startsWith('/backend-api/') || path.includes('/sentinel/')) {
            pageType = 'ignored';
          } else {
            pageType = 'other';
          }
  
          const bindToken = getBindRequestToken();
          const responseState = detectResponseState();
          return {
            client_id: CLIENT_ID,
            page_instance_id: PAGE_INSTANCE_ID,
            script_version: SCRIPT_VERSION,
            upload_bridge_supported: true,
            upload_bridge_version: 1,
            page_url: location.href,
            page_title: document.title || '',
            page_type: pageType,
            conversation_id: conversationId,
            bind_request_id: bindToken,
            launch_token: bindToken,
            is_top_frame: window.top === window.self,
            visibility_state: document.visibilityState,
            has_focus: document.hasFocus(),
            pathname: location.pathname,
            last_seen: Date.now() / 1000,
            is_responding: Boolean(responseState.is_responding),
            response_state: responseState.response_state || 'unknown',
            response_state_reason: responseState.response_state_reason || '',
            response_state_at: responseState.response_state_at || Date.now(),
            can_accept_input: Boolean(responseState.can_accept_input),
          };
        } catch (error) {
          logBridgeError(`getPageIdentity 失败: ${error && error.message ? error.message : String(error)}`, error);
          return {
            client_id: CLIENT_ID,
            page_instance_id: PAGE_INSTANCE_ID,
            script_version: SCRIPT_VERSION,
            upload_bridge_supported: true,
            upload_bridge_version: 1,
            page_url: location.href,
            page_title: document.title || '',
            page_type: 'unknown',
            conversation_id: '',
            bind_request_id: '',
            launch_token: '',
            is_top_frame: window.top === window.self,
            visibility_state: document.visibilityState,
            has_focus: document.hasFocus(),
            pathname: location.pathname,
            last_seen: Date.now() / 1000,
            is_responding: false,
            response_state: 'unknown',
            response_state_reason: 'identity_exception',
            response_state_at: Date.now(),
            can_accept_input: false,
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
              if (response.status < 200 || response.status >= 300) {
                const error = new Error(`HTTP ${response.status}: ${response.responseText || ''}`);
                logBridgeError(error.message, error);
                reject(error);
                return;
              }
              try {
                resolve(JSON.parse(response.responseText));
              } catch (error) {
                const parseError = new Error(`响应解析失败: ${response.responseText || ''}`);
                logBridgeError(parseError.message, error);
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
  
      async function report(event, payload, messageId) {
        return apiRequest({
          action: 'report',
          event,
          payload: payload || {},
          message_id: messageId || null,
        }).catch((error) => {
          logBridgeError(`[REPORT] ${error && error.message ? error.message : String(error)}`, error);
        });
      }
  
      async function sendTextToChatGPT(result) {
        const messageId = result.message_id || result.id;
        const content = String(result.content || '');
  
        if (state.uploadBlockNextChatReason) {
          const reason = state.uploadBlockNextChatReason;
          state.uploadBlockNextChatReason = '';
  
          await ack(messageId, false, reason);
          await report('send_failed', {
            reason: 'upload_before_send_failed',
            detail: reason,
            text_len: content.length,
          }, messageId);
  
          ToolboxShell.appendLog(
            `[BRIDGE][UPLOAD][BLOCK_CHAT] messageId=${String(messageId || '').slice(0, 8)} reason=${reason}`
          );
  
          return;
        }
  
        if (!content.trim()) {
          await ack(messageId, false, '消息内容为空');
          return;
        }
  
        const inputOk = ComposerApi.setComposerValue(content);
        if (!inputOk) {
          await ack(messageId, false, '没有找到 ChatGPT 输入框');
          await report('send_failed', { reason: 'composer_not_found' }, messageId);
          logBridgeError('发送失败：没有找到 ChatGPT 输入框');
          return;
        }
  
        await sleep(300);
        const clickOk = ComposerApi.clickSend();
        await ack(messageId, clickOk, clickOk ? '已发送到 ChatGPT' : '输入成功，但发送按钮不可用');
        await report(clickOk ? 'send_success' : 'send_failed', {
          reason: clickOk ? 'sent' : 'send_button_unavailable',
          text_len: content.length,
        }, messageId);
        if (!clickOk) {
          logBridgeError('发送失败：发送按钮不可用');
        }
      }
  
      async function closeCurrentPageCommand(messageId) {
        await ack(messageId, true, '已收到关闭当前页面命令');
        await report('close_page_requested', { page_url: location.href }, messageId);
        window.setTimeout(() => {
          try {
            window.open('', '_self');
            window.close();
          } catch (error) {
            logBridgeError(`window.close 失败: ${error && error.message ? error.message : String(error)}`, error);
          }
        }, 200);
      }
  
      async function reloadCurrentPageCommand(messageId) {
        await ack(messageId, true, '已收到刷新当前页面命令');
        await report('reload_page_requested', { page_url: location.href }, messageId);
        window.setTimeout(() => {
          location.reload();
        }, 200);
      }
  
      async function openUrlCommand(result) {
        const messageId = result.message_id || result.id;
        const url = String(result.url || '').trim();
        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) {
            await ack(messageId, false, `不允许打开非 http/https 地址: ${url}`);
            return;
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
          await ack(messageId, true, `已打开: ${parsed.href}`);
        } catch (error) {
          logBridgeError(`open_url 失败: ${error && error.message ? error.message : String(error)}`, error);
          await ack(messageId, false, `打开网页失败: ${error && error.message ? error.message : String(error)}`);
        }
      }
  
      async function startUploadCommand(result) {
        const messageId = result.message_id || result.id;
        const payload = result.payload || {};
  
        if (!UploadModule || typeof UploadModule.startUploadFromBridge !== 'function') {
          const reason = 'UploadModule.startUploadFromBridge 不存在，无法执行油猴上传';
          if (payload.block_next_chat_on_failed !== false) {
            state.uploadBlockNextChatReason = reason;
          }
          await ack(messageId, false, reason);
          await report('command_failed', {
            command: 'start_upload',
            reason,
          }, messageId);
          return false;
        }
  
        await ack(messageId, true, '已收到开始上传命令');
  
        let uploadResult = null;
  
        try {
          uploadResult = await UploadModule.startUploadFromBridge({
            ...payload,
            source: payload.source || 'gui-send-before-message',
          });
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.error('[ChatGPT toolbox] start_upload command failed', error);
  
          if (payload.block_next_chat_on_failed !== false) {
            state.uploadBlockNextChatReason = `发送前上传失败：${errText}`;
          }
  
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
          if (payload.block_next_chat_on_failed !== false) {
            state.uploadBlockNextChatReason = reason;
          }
  
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
  
        await report('control_done', {
          command: 'start_upload',
          result: uploadResult,
        }, messageId);
  
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][OK] success=${success} failed=${failed} attached=${attached}`
        );
  
        return true;
      }

      function collectConversationMessagesForBridge(maxMessages = 200) {
        const limit = Math.max(1, Number(maxMessages) || 200);
        const nodes = ComposerApi && typeof ComposerApi.getChatMessageElementsInOrder === 'function'
          ? ComposerApi.getChatMessageElementsInOrder()
          : [];
        const messages = [];

        nodes.forEach((el) => {
          if (!el || isInToolbox(el)) return;

          const role = String(el.getAttribute('data-message-author-role') || '').trim().toLowerCase();
          if (role !== 'user' && role !== 'assistant') return;

          let text = '';
          if (typeof getVisibleTextFromElement === 'function') {
            text = getVisibleTextFromElement(el);
          } else {
            text = String(el.innerText || el.textContent || '');
          }

          text = String(text || '')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          if (!text) return;

          messages.push({
            role,
            text,
            content: text,
          });
        });

        return messages.slice(-limit);
      }

      async function flashPageCommand(result) {
        const messageId = result.message_id || result.id;
        const payload = result.payload || {};

        try {
          await ack(messageId, true, '已收到定位绑定页命令');

          const oldTitle = document.title || 'ChatGPT';
          const message = String(payload.message || '当前页面是 GUI 绑定的 ChatGPT 页面');
          const durationMs = Math.max(800, Number(payload.duration_ms) || 5000);
          const blinkCount = Math.max(2, Number(payload.blink_count) || 8);

          try {
            if (typeof window.focus === 'function') {
              window.focus();
            }
          } catch (focusError) {
            console.warn('[ChatGPT toolbox] window.focus failed', focusError);
          }

          if (ToolboxShell && typeof ToolboxShell.showToast === 'function') {
            ToolboxShell.showToast(message, 'success', durationMs);
          }

          if (ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(`[BRIDGE][FLASH_PAGE] ${message}`);
          }

          let count = 0;
          const timer = window.setInterval(() => {
            count += 1;
            document.title = count % 2 === 1 ? `【定位】${oldTitle}` : oldTitle;
            if (count >= blinkCount) {
              window.clearInterval(timer);
              document.title = oldTitle;
            }
          }, Math.max(200, Math.floor(durationMs / blinkCount)));

          await report('control_done', {
            command: 'flash_page',
            result: {
              ok: true,
              page: getPageIdentity(),
            },
          }, messageId);

          return true;
        } catch (error) {
          const reason = error && error.message ? error.message : String(error);
          console.error('[ChatGPT toolbox] flash_page failed', error);
          await report('command_failed', {
            command: 'flash_page',
            reason,
          }, messageId);
          return false;
        }
      }

      async function handleCommandMessage(result) {
        const command = result.command || '';
        const messageId = result.message_id || result.id;
        if (command === 'reload_self') {
          await reloadCurrentPageCommand(messageId);
          return true;
        }
        if (command === 'close_self') {
          await closeCurrentPageCommand(messageId);
          return true;
        }
        if (command === 'open_url') {
          await openUrlCommand(result);
          return true;
        }
        if (command === 'flash_page') {
          await flashPageCommand(result);
          return true;
        }
        if (command === 'sync_conversation') {
          const payload = result.payload || {};
          const identity = getPageIdentity();
          const maxMessages = Math.max(1, Number(payload.max_messages) || 200);
          const messages = collectConversationMessagesForBridge(maxMessages);

          ToolboxShell.appendLog(
            `[BRIDGE][SYNC_SNAPSHOT] messages=${messages.length} conversation_id=${identity.conversation_id || '-'}`,
          );

          await report(
            'conversation_snapshot',
            {
              ...identity,
              page: identity,
              session_id: payload.session_id || '',
              conversation_id: identity.conversation_id || payload.conversation_id || '',
              page_url: identity.page_url || location.href,
              page_instance_id: identity.page_instance_id || '',
              client_id: identity.client_id || '',
              messages,
              text: String((document.body && document.body.innerText) || '').slice(0, 6000),
            },
            messageId,
          );
          await ack(messageId, true, `已回传当前页面快照，messages=${messages.length}`);
          return true;
        }
        if (command === 'start_upload') {
          await startUploadCommand(result);
          return true;
        }
        await ack(messageId, false, `未知命令: ${command || '-'}`);
        return false;
      }
  
      async function handleOutboundMessage(result) {
        if (!result || !result.has_message) return;
        const messageId = result.message_id || result.id;
        if (!messageId) {
          logBridgeError('服务端消息缺少 message_id');
          return;
        }
        if (state.handlingMessageId && state.handlingMessageId !== messageId) return;
        if (state.handlingMessageId === messageId && !result.retry) return;
  
        state.handlingMessageId = messageId;
        try {
          if (result.type === 'command') {
            await handleCommandMessage(result);
          } else {
            await sendTextToChatGPT(result);
          }
        } catch (error) {
          logBridgeError(`handleOutboundMessage 失败: ${error && error.message ? error.message : String(error)}`, error);
          await ack(messageId, false, error && error.message ? error.message : String(error));
        } finally {
          if (state.handlingMessageId === messageId) {
            state.handlingMessageId = null;
          }
        }
      }
  
      async function pollBridge() {
        const cfg = getConfig();
        if (!cfg.bridgeEnabled || state.polling || state.handlingMessageId) return;
        state.polling = true;
        updateStatus('轮询中...');
        try {
          const result = await apiRequest({ action: 'poll' });
          await handleOutboundMessage(result);
          updateStatus('在线');
        } catch (error) {
          updateStatus(`连接失败：${error && error.message ? error.message : String(error)}`);
        } finally {
          state.polling = false;
        }
      }
  
      function identityKey(identity) {
        return [identity.page_type || '', identity.conversation_id || '', identity.page_url || ''].join('|');
      }
  
      function checkPageIdentityChange() {
        const identity = getPageIdentity();
        const key = identityKey(identity);
        if (key === state.lastIdentityKey) return;
        if (state.lastIdentityKey) {
          ToolboxShell.appendLog(`[BRIDGE][IDENTITY_CHANGE] ${identity.page_type || '-'} ${identity.conversation_id || ''}`);
        }
        state.lastIdentityKey = key;
        debugLog(`identity changed: ${key}`);
      }
  
      function start() {
        stop();
        const cfg = getConfig();
        if (!cfg.bridgeEnabled) {
          updateStatus('未启用');
          return;
        }
        state.lastIdentityKey = identityKey(getPageIdentity());
        pollBridge();
        state.timerId = window.setInterval(() => {
          checkPageIdentityChange();
          pollBridge();
        }, cfg.bridgePollIntervalMs);
        updateStatus(`已启动：${getBridgeUrl()}`);
        ToolboxShell.appendLog(`[BRIDGE][START] ${getBridgeUrl()}`);
      }
  
      function stop() {
        if (state.timerId) {
          window.clearInterval(state.timerId);
          state.timerId = 0;
        }
        state.polling = false;
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
          updateStatus('连接测试成功');
          ToolboxShell.appendLog(`[BRIDGE][TEST][OK] ${JSON.stringify(result).slice(0, 300)}`);
        } catch (error) {
          const text = error && error.message ? error.message : String(error);
          updateStatus(`测试失败：${text}`);
          ToolboxShell.appendLog(`[BRIDGE][TEST][ERROR] ${text}`);
        }
      }
  
      function updateStatus(text) {
        if (!state.root) return;
        const el = qs('#cgpt-bridge-status', state.root);
        if (el) {
          el.textContent = String(text || '');
        }
      }
  
      function renderConfigToUi() {
        if (!state.root) return;
        const cfg = getConfig();
        qs('#cgpt-bridge-enabled', state.root).checked = !!cfg.bridgeEnabled;
        qs('#cgpt-bridge-base-url', state.root).value = cfg.bridgeBaseUrl;
        qs('#cgpt-bridge-path', state.root).value = cfg.bridgePath;
        qs('#cgpt-bridge-token', state.root).value = cfg.bridgeApiToken;
        qs('#cgpt-bridge-debug', state.root).checked = !!cfg.bridgeDebugEnabled;
        qs('#cgpt-bridge-timeout', state.root).value = String(cfg.bridgeRequestTimeoutMs);
        qs('#cgpt-bridge-interval', state.root).value = String(cfg.bridgePollIntervalMs);
        qs('#cgpt-bridge-url', state.root).textContent = getBridgeUrl();
      }
  
      function saveConfigFromUi() {
        if (!state.root) return;
        saveConfig({
          bridgeEnabled: !!qs('#cgpt-bridge-enabled', state.root).checked,
          bridgeBaseUrl: normalizeBridgeBaseUrl(qs('#cgpt-bridge-base-url', state.root).value),
          bridgePath: normalizeBridgePath(qs('#cgpt-bridge-path', state.root).value),
          bridgeApiToken: String(qs('#cgpt-bridge-token', state.root).value || '').trim(),
          bridgeDebugEnabled: !!qs('#cgpt-bridge-debug', state.root).checked,
          bridgeRequestTimeoutMs: Number(qs('#cgpt-bridge-timeout', state.root).value) || 30000,
          bridgePollIntervalMs: Number(qs('#cgpt-bridge-interval', state.root).value) || 1000,
        });
        renderConfigToUi();
        start();
      }
  
      function mount(targetHost) {
        if (!targetHost) {
          logBridgeError('mount 失败: targetHost 为空');
          return;
        }
  
        const existed = targetHost.querySelector('#cgpt-bridge-module');
        if (existed) {
          state.root = existed;
          state.mounted = true;
          renderConfigToUi();
          return;
        }
  
        const root = document.createElement('div');
        root.id = 'cgpt-bridge-module';
        root.innerHTML = `
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
          </div>
        `;
  
        targetHost.appendChild(root);
        state.root = root;
        state.mounted = true;
  
        qs('#cgpt-bridge-save', root).addEventListener('click', saveConfigFromUi);
        qs('#cgpt-bridge-test', root).addEventListener('click', () => {
          testConnection();
        });
        qs('#cgpt-bridge-stop', root).addEventListener('click', () => {
          saveConfig({ bridgeEnabled: false });
          renderConfigToUi();
          stop();
        });
        qs('#cgpt-bridge-copy-url', root).addEventListener('click', () => {
          copyTextToClipboard(getBridgeUrl()).then(
            () => {
              updateStatus('已复制 Bridge 地址');
            },
            (error) => {
              const text = error && error.message ? error.message : String(error);
              logBridgeError(`复制 Bridge 地址失败: ${text}`, error);
              updateStatus(`复制失败：${text}`);
            },
          );
        });
  
        renderConfigToUi();
        start();
      }
  
      return {
        mount,
      };
    })();
  
    /********************************************************************
     * 7. ExportModule：导出统计模   ********************************************************************/
  
    const ExportModule = (() => {
      let root = null;
      let statsLineEl = null;
      let settingsImportFileEl = null;
  
      const REVIEW_JSON_MARKER = '<<<REVIEW_JSON>>>';
  
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
        const nodes = ComposerApi.getChatMessageElementsInOrder();
        const header = `=== ChatGPT 对话全文 ===\n导出时间${new Date().toLocaleString()}\n`;
  
        if (nodes.length > 0) {
          const blocks = nodes.map((el, i) => {
            const role = el.getAttribute('data-message-author-role') || '';
            const label = roleLabelForExport(role);
  
            let text = String(el.innerText || '')
              .replace(/[\u200B-\u200D\uFEFF]/g, '')
              .replace(/\s+\n/g, '\n')
              .trim();
  
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
          statsLineEl.textContent = s.issueTotal > 0
            ? `issues 总数${s.issueTotal} 条；JSON 块：${s.jsonBlocks}；助手消息：${s.assistantWithRoleCount}`
            : `issues 总数；JSON 块：${s.jsonBlocks}；助手消息：${s.assistantWithRoleCount}`;
        }
  
        applyIssueTotalToTabTitle(s.issueTotal);
  
        return s;
      }
  
      function bindEvents() {
        qs('#cgpt-export-copy-chat', root).addEventListener('click', () => {
          copyTextToClipboard(buildChatExportText()).then(
            () => {
              ToolboxShell.appendLog('已复制完整对话');
              ToolboxShell.setStatus('已复制完整对话');
            },
            (e) => {
              console.warn('[ChatGPT toolbox] copy full chat failed', e);
              ToolboxShell.setStatus(`复制完整对话失败${e && e.message ? e.message : String(e)}`);
            },
          );
        });
  
        qs('#cgpt-export-copy-panel', root).addEventListener('click', () => {
          copyTextToClipboard(buildPanelExportText()).then(
            () => {
              ToolboxShell.appendLog('已复制工具箱配置');
              ToolboxShell.setStatus('已复制工具箱配置');
            },
            (e) => {
              console.warn('[ChatGPT toolbox] copy panel config failed', e);
              ToolboxShell.setStatus(`复制工具箱配置失败：${e && e.message ? e.message : String(e)}`);
            },
          );
        });
  
        qs('#cgpt-export-refresh-stats', root).addEventListener('click', () => {
          const s = renderStats();
          ToolboxShell.appendLog(`issues 统计刷新${s.issueTotal} 条`);
        });
  
        qs('#cgpt-export-copy-stats', root).addEventListener('click', () => {
          const s = renderStats();
  
          copyTextToClipboard(JSON.stringify(s, null, 2)).then(
            () => {
              ToolboxShell.appendLog('已复issues 统计 JSON');
              ToolboxShell.setStatus('已复issues 统计 JSON');
            },
            (e) => {
              console.warn('[ChatGPT toolbox] copy stats failed', e);
              ToolboxShell.setStatus(`复制 issues 统计失败${e && e.message ? e.message : String(e)}`);
            },
          );
        });
  
        qs('#cgpt-export-prompts', root).addEventListener('click', () => {
          const data = PromptManagerModule.exportData();
          const date = new Date();
          const filename = `chatgpt-prompts-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}.json`;
          downloadTextFile(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
          ToolboxShell.appendLog('已导Prompt 管理数据');
          ToolboxShell.setStatus('已导Prompt 管理数据');
        });
  
        qs('#cgpt-export-settings', root).addEventListener('click', async () => {
          try {
            const payload = await buildSettingsExportPayload();
            const date = new Date();
            const filename = `chatgpt-toolbox-settings-${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}.json`;
            downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
            ToolboxShell.appendLog('已导出工具箱设置');
            ToolboxShell.setStatus('已导出工具箱设置');
          } catch (e) {
            console.error('[ChatGPT toolbox] export settings failed', e);
            ToolboxShell.setStatus(`导出设置失败${e && e.message ? e.message : String(e)}`);
          }
        });
  
        settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);
  
        qs('#cgpt-export-settings-import', root).addEventListener('click', () => {
          if (settingsImportFileEl) {
            settingsImportFileEl.click();
          }
        });
  
        if (settingsImportFileEl) {
          settingsImportFileEl.addEventListener('change', async () => {
            const file = settingsImportFileEl.files && settingsImportFileEl.files[0];
            settingsImportFileEl.value = '';
  
            if (!file) return;
  
            try {
              const text = await file.text();
              const payload = JSON.parse(text);
              const ok = await importSettingsPayload(payload);
  
              if (ok) {
                ToolboxShell.appendLog('已导入工具箱设置');
                ToolboxShell.setStatus('已导入工具箱设置');
              } else {
                ToolboxShell.setStatus('导入设置失败：文件格式无效');
              }
            } catch (e) {
              console.error('[ChatGPT toolbox] import settings failed', file && file.name, e);
              ToolboxShell.setStatus(`导入设置失败${e && e.message ? e.message : String(e)}`);
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
          autoQueueConfig: AutoQueueModule.exportConfig(),
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
  
        const tab = ToolboxShell.normalizeTab(
          payload.toolbox && payload.toolbox.activeTab
            ? payload.toolbox.activeTab
            : MemoryManager.get(MemoryManager.KEYS.activeTab, 'upload'),
        );
  
        ToolboxShell.switchTab(tab);
  
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
  
      function mount(targetHost) {
        if (!targetHost || targetHost.querySelector('#cgpt-export-module')) return;
  
        root = document.createElement('div');
        root.id = 'cgpt-export-module';
        root.innerHTML = `
          <div class="cgpt-section">
            <div class="cgpt-section-title">对话导出</div>
            <div class="cgpt-hint">复制当前页面对话全文，适合保存审稿、代码审查和长对话上下文</div>
            <div class="cgpt-row" style="flex-wrap:wrap;">
              <button type="button" class="cgpt-btn primary" id="cgpt-export-copy-chat">复制完整对话</button>
              <button type="button" class="cgpt-btn" id="cgpt-export-copy-panel">复制工具箱配置</button>
              <button type="button" class="cgpt-btn" id="cgpt-export-prompts">导出 Prompt</button>
            </div>
          </div>
  
          <div class="cgpt-section">
            <div class="cgpt-section-title">issues 统计</div>
            <div class="cgpt-hint">
              会扫描助手回复中JSON 对象，统计形{"issues": [...]} 的结果数量，并同步到浏览器标         </div>
            <div class="cgpt-row" style="flex-wrap:wrap;">
              <button type="button" class="cgpt-btn primary" id="cgpt-export-refresh-stats">刷新统计</button>
              <button type="button" class="cgpt-btn" id="cgpt-export-copy-stats">复制统计 JSON</button>
            </div>
            <div id="cgpt-export-stats-line" class="cgpt-hint" style="margin-top:8px;">issues 总数div>
          </div>
  
          <div class="cgpt-section cgpt-export-advanced">
            <div class="cgpt-section-title">设置备份</div>
            <div class="cgpt-hint">导出/导入工具UI 状态、自动指令、Prompt、文件组与队列元数据（默认不含真实文Blobdiv>
            <div class="cgpt-row" style="flex-wrap:wrap;">
              <button type="button" class="cgpt-btn primary" id="cgpt-export-settings">导出工具箱设置</button>
              <button type="button" class="cgpt-btn" id="cgpt-export-settings-import">导入工具箱设置</button>
              <input type="file" id="cgpt-export-settings-import-file" accept="application/json,.json" class="cgpt-toolbox-hidden">
            </div>
          </div>
        `;
  
        targetHost.appendChild(root);
  
        statsLineEl = qs('#cgpt-export-stats-line', root);
  
        bindEvents();
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
      let logFlushTimer = 0;
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
  
      function mount(targetHost) {
        if (!targetHost) {
          console.warn('[ChatGPT toolbox] LogModule.mount: targetHost 为空');
          return;
        }
  
        if (targetHost.querySelector('#cgpt-log-module')) {
          mounted = true;
          listEl = qs('#cgpt-log-list', targetHost);
          loadPersistedLogLines();
          render();
          return;
        }
  
        const root = document.createElement('div');
        root.id = 'cgpt-log-module';
        root.innerHTML = `
          <div class="cgpt-log-panel">
            <div class="cgpt-log-actions">
              <button type="button" class="cgpt-btn" id="cgpt-log-copy">复制日志</button>
              <button type="button" class="cgpt-btn danger" id="cgpt-log-clear">清空日志</button>
            </div>
            <label class="cgpt-checkbox-line cgpt-log-advanced" style="margin:6px 0 0;">
              <input type="checkbox" id="cgpt-log-persist" ${isLogPersistEnabled() ? 'checked' : ''}>
              刷新后保留日志（默认关闭）
            </label>
            <div class="cgpt-log-list" id="cgpt-log-list"></div>
          </div>
        `;
  
        targetHost.appendChild(root);
  
        listEl = qs('#cgpt-log-list', root);
        mounted = true;
  
        loadPersistedLogLines();
  
        const persistEl = qs('#cgpt-log-persist', root);
        if (persistEl) {
          persistEl.addEventListener('change', () => {
            MemoryManager.set(MemoryManager.KEYS.logPersistEnabled, !!persistEl.checked);
  
            if (!persistEl.checked) {
              MemoryManager.remove(MemoryManager.KEYS.logPersistLines);
            } else {
              persistLogLines();
            }
          });
        }
  
        qs('#cgpt-log-copy', root).addEventListener('click', async () => {
          if (logFlushTimer) {
            window.clearTimeout(logFlushTimer);
            flushLogBuffer();
          }
  
          const text = state.lines.join('\n');
  
          try {
            await copyTextToClipboard(text);
            ToolboxShell.setStatus('已复制日志');
          } catch (e) {
            console.error('[ChatGPT toolbox] copy log failed', e);
            ToolboxShell.setStatus('复制日志失败');
          }
        });
  
        qs('#cgpt-log-clear', root).addEventListener('click', () => {
          logBuffer.length = 0;
  
          if (logFlushTimer) {
            window.clearTimeout(logFlushTimer);
            logFlushTimer = 0;
          }
  
          state.lines = [];
          logDomDirty = false;
          render();
          persistLogLines();
          ToolboxShell.setStatus('已清空日志');
        });
  
        render();
      }
  
      function isLogTabVisible() {
        return typeof ToolboxShell.getActiveTab === 'function'
          && ToolboxShell.getActiveTab() === 'log';
      }
  
      function flushLogBuffer() {
        logFlushTimer = 0;
  
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
  
        if (logFlushTimer) {
          return;
        }
  
        render();
        logDomDirty = false;
      }
  
      function add(text) {
        logBuffer.push(String(text || ''));
  
        if (!logFlushTimer) {
          logFlushTimer = window.setTimeout(flushLogBuffer, 200);
        }
      }
  
      function render() {
        if (!listEl) return;
  
        if (!state.lines.length) {
          listEl.innerHTML = '<div class="cgpt-log-empty">暂无日志</div>';
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
  
    function safeInitStep(name, fn) {
      try {
        fn();
        return true;
      } catch (e) {
        console.error(`[ChatGPT toolbox] 初始化失败：${name}`, e);
        return false;
      }
    }
  
    function initToolbox() {
      safeInitStep('MemoryManager.migrateLegacyKeys', () => {
        MemoryManager.migrateLegacyKeys();
      });
  
      safeInitStep('ToolboxShell.create', () => {
        ToolboxShell.create();
      });
  
      safeInitStep('TitlePrefixModule.start', () => {
        TitlePrefixModule.start();
      });
  
      safeInitStep('UploadModule.mount', () => {
        UploadModule.mount(ToolboxShell.getHost('upload'));
      });
  
      safeInitStep('AutoQueueModule.mount', () => {
        AutoQueueModule.mount(ToolboxShell.getHost('autoq'));
      });
  
      safeInitStep('PromptManagerModule.mount', () => {
        PromptManagerModule.mount(ToolboxShell.getHost('prompt'));
      });
  
      safeInitStep('BridgeModule.mount', () => {
        BridgeModule.mount(ToolboxShell.getHost('bridge'));
      });
  
      safeInitStep('ExportModule.mount', () => {
        ExportModule.mount(ToolboxShell.getHost('export'));
      });
  
      safeInitStep('LogModule.mount', () => {
        LogModule.mount(ToolboxShell.getHost('log'));
      });
  
      safeInitStep('SettingsModule.mount', () => {
        SettingsModule.mount(ToolboxShell.getHost('settings'));
      });
  
      safeInitStep('ToolboxShell.restoreActiveTab', () => {
        ToolboxShell.restoreActiveTab();
      });
  
      safeInitStep('ToolboxShell.appendLog', () => {
        ToolboxShell.appendLog('工具箱初始化完成');
        ToolboxShell.appendLog('[DEAD_CODE_CHECK] 当前上传入口仅使用 attachFilesLegacyInputOnly');
      });
    }
  
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initToolbox, {
        once: true,
      });
    } else {
      initToolbox();
    }
  })();
  