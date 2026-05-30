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

      return EventBinder.on(
        el,
        eventName,
        handler,
        normalizeBindOptions(eventName, key, 'DomUtil'),
      );
    }

    function bindClick(root, selector, handler, moduleName) {
      const el = byId(root, selector, moduleName);
      return bindOnce(el, 'click', async (event) => {
        if (event && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        if (event && typeof event.stopPropagation === 'function') {
          event.stopPropagation();
        }
        if (event && event.currentTarget && typeof event.currentTarget.blur === 'function') {
          event.currentTarget.blur();
        }
        await handler(event);
      }, `click:${selector}`);
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

  function normalizeQuickPromptSelectionMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === 'manual' ? 'manual' : 'auto';
  }

  if (typeof window !== 'undefined' && typeof window.normalizeQuickPromptSelectionMode !== 'function') {
    window.normalizeQuickPromptSelectionMode = normalizeQuickPromptSelectionMode;
  }

  function isToolboxDebugEnabled(options = {}) {
    if (options && options.debug === true) {
      return true;
    }
    if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.get === 'function') {
      if (MemoryManager.get('bridgeDebugEnabled', false)) {
        return true;
      }
    }
    if (typeof getCompactUiConfig === 'function') {
      const cfg = getCompactUiConfig();
      if (cfg && cfg.taskQueueSettings && cfg.taskQueueSettings.debugMode) {
        return true;
      }
    }
    return false;
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
  function dataStorageKey(key) {
    return `${APP.DATA_STORAGE_PREFIX}${key}`;
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

  function readDataStorage(key, fallback) {
    return StorageKit.readJson(key, fallback, { dataScoped: true });
  }

  function writeDataStorage(key, value) {
    return StorageKit.writeJson(key, value, { dataScoped: true });
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

  const perfLogThrottleAt = {};

  function isToolboxPerfDebugEnabled() {
    if (typeof MemoryManager === 'undefined' || typeof MemoryManager.get !== 'function') {
      return false;
    }
    return !!MemoryManager.get('bridgeDebugEnabled', false);
  }

  // ---- Perf counters (always-on, lightweight) ----
  // Bucketed counters for "per minute" rates and debugging snapshots.
  // Exposed as global functions so other modules (that don't import) can call them.
  const PerfCounters = (() => {
    const BUCKET_MS = 1000;
    const WINDOW_S = 60;
    const buckets = new Map(); // name -> Array(WINDOW_S) of counts
    let startedAt = Date.now();
    let lastTick = 0;

    function ensureBuckets(name) {
      const key = String(name || 'unknown');
      let arr = buckets.get(key);
      if (!arr) {
        arr = new Array(WINDOW_S).fill(0);
        buckets.set(key, arr);
      }
      return arr;
    }

    function tick(now) {
      const t = Number(now || Date.now());
      const sec = Math.floor(t / BUCKET_MS);
      if (!lastTick) {
        lastTick = sec;
        return sec;
      }
      if (sec <= lastTick) return sec;

      const delta = Math.min(WINDOW_S, sec - lastTick);
      if (delta >= WINDOW_S) {
        buckets.forEach((arr) => arr.fill(0));
      } else {
        // clear advanced buckets
        for (let i = 1; i <= delta; i += 1) {
          const idx = (lastTick + i) % WINDOW_S;
          buckets.forEach((arr) => {
            arr[idx] = 0;
          });
        }
      }
      lastTick = sec;
      return sec;
    }

    function inc(name, n = 1, now) {
      const sec = tick(now);
      const idx = sec % WINDOW_S;
      const arr = ensureBuckets(name);
      arr[idx] += Number(n || 1) || 1;
    }

    function perMinute(name, now) {
      tick(now);
      const arr = ensureBuckets(name);
      return arr.reduce((a, b) => a + b, 0);
    }

    function snapshot(now) {
      const t = Number(now || Date.now());
      tick(t);

      const result = {
        uptimeMs: Math.max(0, t - startedAt),
        logsPerMinute: perMinute('log.append', t),
        composerDetectCountPerMinute: perMinute('composer.detect', t),
        uploadRenderCountPerMinute: perMinute('upload.render', t),
        topStatusRefreshCountPerMinute: perMinute('topStatus.refresh', t),
        bridgePollCountPerMinute: perMinute('bridge.poll', t),
        queuePendingCheckCountPerMinute: perMinute('chatQueue.pendingCheck', t),
        titleFlashStopKeydownPerMinute: perMinute('titleFlash.stop.keydown', t),
      };

      if (typeof performance !== 'undefined' && performance && performance.memory) {
        try {
          result.memory = {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
          };
        } catch (e) {
          // ignore
        }
      }

      return result;
    }

    function reset(reason = '') {
      void reason;
      startedAt = Date.now();
      lastTick = 0;
      buckets.clear();
    }

    return {
      inc,
      perMinute,
      snapshot,
      reset,
    };
  })();

  function registerPerfDebugApis() {
    const target = getDebugApiTarget();
    // global helpers for modules without imports
    target.__CGPT_TOOLBOX_PERF_INC__ = (name, n) => {
      PerfCounters.inc(name, n);
    };
    target.__CGPT_TOOLBOX_PERF_SNAPSHOT__ = () => PerfCounters.snapshot();
  }

  function logPerfThrottled(tag, message, throttleMs = 2000) {
    if (!isToolboxPerfDebugEnabled()) return;

    const key = String(tag || 'default');
    const now = Date.now();
    const lastAt = Number(perfLogThrottleAt[key] || 0);
    if (now - lastAt < throttleMs) {
      return;
    }

    perfLogThrottleAt[key] = now;
    console.log(message);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(message);
    }
  }

  function logPerfIfSlow(tag, message, costMs, thresholdMs = 80) {
    const cost = Number(costMs);
    const threshold = Number(thresholdMs);
    if (!Number.isFinite(cost) || !Number.isFinite(threshold) || cost <= threshold) {
      return;
    }

    const key = String(tag || 'default');
    const now = Date.now();
    const lastAt = Number(perfLogThrottleAt[key] || 0);
    if (now - lastAt < 2000) {
      return;
    }

    perfLogThrottleAt[key] = now;
    console.log(message);
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(message);
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
      || text === '等待回复...'
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

  function isToolboxCopyActionButton(button) {
    if (!button) {
      return false;
    }
    const id = String(button.id || '');
    return id === 'cgpt-upload-continue-once' || id === 'cgpt-copy-last-message-scroll-bottom';
  }

  function setButtonTemporaryError(button, text, delayMs = 1200) {
    if (!button) {
      return;
    }

    const oldText = button.textContent;
    button.classList.remove('cgpt-btn-ok', 'danger', 'failed', 'error');
    button.classList.add('cgpt-btn-error');

    if (text) {
      button.textContent = text;
    }

    window.setTimeout(() => {
      button.classList.remove('cgpt-btn-error');
      if (text) {
        button.textContent = oldText;
      }
      if (typeof button.blur === 'function') {
        button.blur();
      }
    }, delayMs);
  }

  function setButtonTemporaryOk(button, delayMs = 800) {
    if (!button) {
      return;
    }

    button.classList.remove('cgpt-btn-error', 'danger', 'failed', 'error');
    button.classList.add('cgpt-btn-ok');

    window.setTimeout(() => {
      button.classList.remove('cgpt-btn-ok');
      if (typeof button.blur === 'function') {
        button.blur();
      }
    }, delayMs);
  }

  const BUTTON_LONG_WAIT_DANGER_MS = 10000;
  const buttonWaitTimers = new WeakMap();

  const PERMANENT_DANGER_BUTTON_IDS = new Set([
    'cgpt-log-clear',
    'cgpt-prompt-delete-btn',
    'cgpt-prompt-reset-btn',
  ]);

  function isPermanentDangerButton(button) {
    if (!button) {
      return false;
    }

    const id = String(button.id || '').trim();
    if (PERMANENT_DANGER_BUTTON_IDS.has(id)) {
      return true;
    }

    if (id === 'cgpt-copy-hotkey-continue-loop' && button.classList.contains('cgpt-action-running')) {
      return true;
    }

    return false;
  }

  const SEND_ONLY_BUTTON_IDS = new Set([
    'cgpt-send-message-once',
    'cgpt-upload-start-send',
  ]);

  const UPLOAD_ONLY_NO_WAIT_DANGER_IDS = new Set([
    'cgpt-upload-start',
  ]);

  function setButtonWaitingDanger(button, enabled, reason) {
    if (!button || isPermanentDangerButton(button)) {
      return;
    }

    const buttonId = String(button.id || '').trim();
    if (UPLOAD_ONLY_NO_WAIT_DANGER_IDS.has(buttonId)) {
      return;
    }

    if (SEND_ONLY_BUTTON_IDS.has(buttonId)) {
      if (enabled) {
        button.classList.add('cgpt-btn-busy');
        button.dataset.waitDanger = '1';
        button.dataset.waitDangerReason = reason || 'waiting';
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BUTTON][WAIT_DANGER_ON] id=${button.id || '-'} text=${String(button.textContent || '').trim()} reason=${reason || '-'} sendButtonVmOnly=1`,
          );
        }
        return;
      }

      button.classList.remove('cgpt-btn-busy', 'cgpt-btn-waiting-danger');
      delete button.dataset.waitDanger;
      delete button.dataset.waitDangerReason;
      return;
    }

    if (enabled) {
      button.classList.add('cgpt-btn-busy');
      button.classList.remove('cgpt-btn-waiting-danger');
      button.dataset.waitDanger = '1';
      button.dataset.waitDangerReason = reason || 'waiting';

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[BUTTON][WAIT_DANGER_ON] id=${button.id || '-'} text=${String(button.textContent || '').trim()} reason=${reason || '-'}`,
        );
      }
      return;
    }

    button.classList.remove('cgpt-btn-busy', 'cgpt-btn-waiting-danger');
    delete button.dataset.waitDanger;
    delete button.dataset.waitDangerReason;

    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(
        `[BUTTON][WAIT_DANGER_OFF] id=${button.id || '-'} text=${String(button.textContent || '').trim()} reason=${reason || '-'}`,
      );
    }
  }

  function startButtonLongWaitDangerTimer(button, reason, delayMs) {
    if (!button || isPermanentDangerButton(button)) {
      return;
    }

    const buttonId = String(button.id || '').trim();
    if (UPLOAD_ONLY_NO_WAIT_DANGER_IDS.has(buttonId)) {
      return;
    }

    clearButtonLongWaitDangerTimer(button, 'restart');

    const waitMs = Number(delayMs || BUTTON_LONG_WAIT_DANGER_MS);
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
      ToolboxShell.appendLog(
        `[BUTTON][LONG_WAIT_TIMER_START] id=${button.id || '-'} text=${String(button.textContent || '').trim()} delayMs=${waitMs} reason=${reason || '-'}`,
      );
    }

    const timer = window.setTimeout(() => {
      if (SEND_ONLY_BUTTON_IDS.has(buttonId)) {
        button.classList.add('cgpt-btn-busy');
        button.dataset.waitDanger = '1';
        button.dataset.waitDangerReason = reason || 'long_wait';
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BUTTON][LONG_WAIT_DANGER] id=${button.id || '-'} text=${String(button.textContent || '').trim()} reason=${reason || 'long_wait'} sendButtonVmOnly=1`,
          );
        }
        return;
      }
      setButtonWaitingDanger(button, true, reason || 'long_wait');
    }, waitMs);

    buttonWaitTimers.set(button, timer);
  }

  function clearButtonLongWaitDangerTimer(button, reason) {
    if (!button) {
      return;
    }

    const timer = buttonWaitTimers.get(button);
    if (timer) {
      window.clearTimeout(timer);
      buttonWaitTimers.delete(button);
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[BUTTON][LONG_WAIT_TIMER_CLEAR] id=${button.id || '-'} text=${String(button.textContent || '').trim()} reason=${reason || '-'}`,
        );
      }
    }

    setButtonWaitingDanger(button, false, reason || 'clear');
  }

  function shouldSkipGlobalShortcutForToolboxEditing(target) {
    const toolboxRoot = document.querySelector(`#${APP.rootId}`)
      || document.querySelector(`#${APP.panelId}`);

    if (!toolboxRoot || !(target instanceof Element) || !toolboxRoot.contains(target)) {
      return false;
    }

    const tagName = String(target.tagName || '').toLowerCase();
    const isEditable =
      tagName === 'input' ||
      tagName === 'textarea' ||
      target.isContentEditable === true
      || !!target.closest('[contenteditable="true"]');

    return isEditable;
  }

  function installToolboxKeyboardGuard(rootEl) {
    if (!rootEl) {
      return;
    }

    if (rootEl.dataset.toolboxKeyboardGuardBound === '1') {
      return;
    }

    rootEl.dataset.toolboxKeyboardGuardBound = '1';

    rootEl.addEventListener('keydown', (event) => {
      const target = event.target;
      if (!target) {
        return;
      }

      const el = target instanceof Element ? target : null;
      if (!el) {
        return;
      }

      const tagName = String(el.tagName || '').toLowerCase();
      const isEditable =
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        el.isContentEditable === true ||
        !!el.closest('[contenteditable="true"]');

      if (isEditable) {
        return;
      }

      const btn = el.closest('button');
      if (!btn) {
        return;
      }

      const key = String(event.key || '');
      const isEnterOrSpace = key === 'Enter' || key === ' ';
      if (!isEnterOrSpace) {
        return;
      }

      const id = btn.id || '-';

      if (btn.hasAttribute('data-enter-keep-native')) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[TOOLBOX_KEYBOARD_GUARD][ALLOW_BUTTON_ENTER] id=${id} key=${key}`,
          );
        }
        return;
      }

      const shouldBlockButtonEnter =
        btn.hasAttribute('data-enter-block') ||
        btn.hasAttribute('data-danger-enter-block');

      if (!shouldBlockButtonEnter) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[TOOLBOX_KEYBOARD_GUARD][ALLOW_BUTTON_ENTER] id=${id} key=${key}`,
          );
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (typeof btn.blur === 'function') {
        btn.blur();
      }

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[TOOLBOX_KEYBOARD_GUARD][BLOCK_BUTTON_ENTER] id=${id} key=${key} reason=danger-button`,
        );
      }
    }, true);
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

    button.classList.remove(...styleClasses, 'cgpt-btn-error', 'cgpt-btn-ok');

    if (waiting) {
      button.classList.add('cgpt-waiting-answer');
      if (!isToolboxCopyActionButton(button)) {
        button.classList.add('danger');
      }
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
      el.addEventListener(eventName, async (event) => {
        if (eventName === 'click') {
          if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
          }
          if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
          }
          const clickTarget = (event && event.currentTarget) || el;
          if (clickTarget && typeof clickTarget.blur === 'function') {
            clickTarget.blur();
          }
        }

        try {
          const result = handler(event, el);
          if (result && typeof result.then === 'function') {
            await result;
          }
        } catch (error) {
          const moduleName = options.moduleName || 'EventBinder';
          const errText = error && error.message ? error.message : String(error);
          console.error(`[${moduleName}][${eventName}-failed]`, {
            error_type: error && error.name,
            error: errText,
            stack: error && error.stack,
          });
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
    function fullKey(key, scoped = true, dataScoped = false) {
      if (dataScoped) return dataStorageKey(key);
      return scoped ? storageKey(key) : String(key || "");
    }

    function legacyFullKeys(key, scoped = true) {
      if (!scoped || !APP || !Array.isArray(APP.storageLegacyPrefixes)) {
        return [];
      }

      return APP.storageLegacyPrefixes
        .filter((prefix) => typeof prefix === 'string' && prefix && prefix !== APP.storagePrefix)
        .map((prefix) => `${prefix}${key}`);
    }

    function migrateLegacyValue(key, value, legacyKey, tag) {
      const ok = writeJson(key, value, { scoped: true, tag });
      if (ok) {
        console.info('[ChatGPT toolbox] migrated legacy storage key', {
          tag,
          legacyKey,
          currentKey: storageKey(key),
        });
      }
      return value;
    }

    function readJson(key, fallback, options = {}) {
      const scoped = options.scoped !== false;
      const tag = options.tag || '[STORAGE]';
      const resolvedKey = fullKey(key, scoped, options.dataScoped);

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
        if (raw != null && raw !== '') {
          const parsed = JSON.parse(raw);
          return parsed == null ? fallback : parsed;
        }
      } catch (error) {
        logError(`${tag}[localStorage-read-failed]`, error, resolvedKey);
      }

      const legacyKeys = legacyFullKeys(key, scoped);
      for (let i = 0; i < legacyKeys.length; i += 1) {
        const legacyKey = legacyKeys[i];
        try {
          if (typeof GM_getValue === 'function') {
            const value = GM_getValue(legacyKey, null);
            if (value != null) {
              return migrateLegacyValue(key, value, legacyKey, tag);
            }
          }
        } catch (error) {
          logError(`${tag}[GM_getValue-legacy-failed]`, error, legacyKey);
        }

        try {
          const raw = window.localStorage.getItem(legacyKey);
          if (raw != null && raw !== '') {
            const parsed = JSON.parse(raw);
            if (parsed != null) {
              return migrateLegacyValue(key, parsed, legacyKey, tag);
            }
          }
        } catch (error) {
          logError(`${tag}[localStorage-legacy-read-failed]`, error, legacyKey);
        }
      }

      return fallback;
    }

    function writeJson(key, value, options = {}) {
      const scoped = options.scoped !== false;
      const tag = options.tag || '[STORAGE]';
      const resolvedKey = fullKey(key, scoped, options.dataScoped);

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
      playSuccessBeep = true,
      statusOwner = 'logger',
    } = options || {};

    const content = String(text ?? '');
    const resolvedSuccessStatus = successText || successStatus || successLog || '已复制';
    const resolvedSuccessLog = successLog || resolvedSuccessStatus;
    const resolvedFailPrefix = failedPrefix || failStatusPrefix || '复制失败';
    const resolvedLogPrefix = logPrefix || 'COPY';

    if (!content) {
      const msg = emptyText || '没有可复制的内容';
      ToolboxShell.setStatus(msg, 'warn', { owner: statusOwner });
      ToolboxShell.appendLog(`[${resolvedLogPrefix}][skip] reason=empty`);
      return false;
    }

    try {
      const copied = await copyTextUnified(content, `${resolvedLogPrefix}:copyWithStatus`);
      if (copied !== true) {
        const failReason = 'clipboard-write-returned-false';
        console.error('[ChatGPT toolbox] copyWithStatus failed: clipboard writer returned false', {
          logPrefix: resolvedLogPrefix,
          chars: content.length,
          reason: failReason,
        });
        ToolboxShell.setStatus(`${resolvedFailPrefix}：剪贴板写入失败`, 'error', {
          owner: statusOwner,
        });
        ToolboxShell.appendLog(
          `[${resolvedLogPrefix}][failed] reason=${failReason} chars=${content.length}`,
        );
        return false;
      }
      ToolboxShell.setStatus(resolvedSuccessStatus, 'success', { owner: statusOwner });
      ToolboxShell.appendLog(`[${resolvedLogPrefix}][ok] chars=${content.length} ${resolvedSuccessLog}`);

      if (playSuccessBeep !== false) {
        void playCopySuccessBeep(`copyWithStatus:${resolvedLogPrefix}`).catch((error) => {
          const errText = error && error.message ? error.message : String(error);
          console.warn('[ChatGPT toolbox] copyWithStatus beep failed', error);
          ToolboxShell.appendLog(`[BEEP][COPY_SUCCESS_FAILED] source=copyWithStatus:${resolvedLogPrefix} error=${errText}`);
        });
      }

      return true;
    } catch (error) {
      const errText = getErrorText(error);
      const failTag = failLog || `[ChatGPT toolbox] ${resolvedFailPrefix}`;
      console.error(failTag, error);

      if (typeof formatFailStatus === 'function') {
        ToolboxShell.setStatus(formatFailStatus(errText), 'error', { owner: statusOwner });
      } else {
        ToolboxShell.setStatus(`${resolvedFailPrefix}：${errText}`, 'error', {
          owner: statusOwner,
        });
      }

      ToolboxShell.appendLog(`[${resolvedLogPrefix}][failed] error=${errText}`);
      return false;
    }
  }

  function getDebugApiTarget() {
    return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  }

  function createDebugApiContext(context = {}) {
    const shell = context.shell || context.ToolboxShell || null;
    const appendLog = typeof context.appendLog === 'function'
      ? context.appendLog
      : (shell && typeof shell.appendLog === 'function' ? shell.appendLog.bind(shell) : null);

    return {
      target: context.target || getDebugApiTarget(),
      override: context.override === true,
      appendLog,
    };
  }

  function registerToolboxDebugApi(nameOrPayload, maybeFn, maybeOptions = {}) {
    const payload = (
      nameOrPayload
      && typeof nameOrPayload === 'object'
      && !Array.isArray(nameOrPayload)
      && typeof maybeFn === 'undefined'
    )
      ? nameOrPayload
      : {
        name: nameOrPayload,
        fn: maybeFn,
        ...maybeOptions,
      };

    const { name, fn } = payload;
    const fullName = String(name || '').startsWith('__cgpt')
      ? String(name)
      : `__cgptToolbox${String(name || '')}`;
    const { target, override, appendLog } = createDebugApiContext(payload);

    if (typeof fn !== 'function') {
      console.error('[ChatGPT toolbox] registerToolboxDebugApi requires function', fullName);
      return;
    }

    if (target[fullName] && !override) {
      if (appendLog) {
        appendLog(`[DEBUG_API][skip-existing] ${fullName}`);
      }
      return;
    }

    target[fullName] = fn;

    if (appendLog) {
      appendLog(`[DEBUG_API][registered] ${fullName}`);
    }
  }

  function registerToolboxDebugApis(apiMapOrPayload, maybeOptions = {}) {
    const payload = (
      apiMapOrPayload
      && typeof apiMapOrPayload === 'object'
      && !Array.isArray(apiMapOrPayload)
      && Object.prototype.hasOwnProperty.call(apiMapOrPayload, 'apiMap')
      && typeof maybeOptions === 'object'
      && Object.keys(maybeOptions).length === 0
    )
      ? apiMapOrPayload
      : {
        apiMap: apiMapOrPayload,
        ...maybeOptions,
      };

    const { apiMap } = payload;
    Object.entries(apiMap || {}).forEach(([name, fn]) => {
      registerToolboxDebugApi({
        ...payload,
        name,
        fn,
      });
    });
  }

  function createModuleStatus(moduleName, options = {}) {
    const getLocalEl = options.getLocalEl || (() => null);
    const useGlobal = options.useGlobal !== false;
    const useLog = options.useLog !== false;
    const owner = String(options.owner || '').trim();
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
        ToolboxShell.setStatus(text, type, owner ? {
          ...opts,
          owner: opts && opts.owner ? opts.owner : owner,
        } : opts);
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
    const name = String(moduleName || 'MODULE').trim() || 'MODULE';

    const globalTarget = getDebugApiTarget();
    if (!globalTarget.__CGPT_TOOLBOX_TIMERS__) {
      globalTarget.__CGPT_TOOLBOX_TIMERS__ = new Map();
    }
    // keep last registry for each moduleName
    try {
      globalTarget.__CGPT_TOOLBOX_TIMERS__.set(name, {
        moduleName: name,
        timers,
        rafs,
        intervals,
      });
    } catch (e) {
      // ignore
    }

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

    const api = {
      timeout,
      clearTimeout: clearTimeoutByName,
      raf,
      clearRaf,
      interval,
      clearInterval: clearIntervalByName,
      clearAll,
      has,
    };
    api._dump = () => ({
      moduleName: name,
      timeouts: timers.size,
      rafs: rafs.size,
      intervals: intervals.size,
    });
    return api;
  }

  function createObserverRegistry(moduleName) {
    const name = String(moduleName || 'MODULE').trim() || 'MODULE';
    const observers = new Map(); // name -> MutationObserver

    const globalTarget = getDebugApiTarget();
    if (!globalTarget.__CGPT_TOOLBOX_OBSERVERS__) {
      globalTarget.__CGPT_TOOLBOX_OBSERVERS__ = new Map();
    }
    try {
      globalTarget.__CGPT_TOOLBOX_OBSERVERS__.set(name, observers);
    } catch (e) {
      // ignore
    }

    function register(observerName, observer) {
      const key = String(observerName || '').trim() || 'observer';
      if (!(observer instanceof MutationObserver)) {
        return false;
      }
      if (observers.has(key)) {
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[OBSERVER][SKIP_DUPLICATE] module=${name} name=${key}`);
        }
        return false;
      }
      observers.set(key, observer);
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[OBSERVER][CREATE] module=${name} name=${key}`);
      }
      return true;
    }

    function disconnect(observerName) {
      const key = String(observerName || '').trim() || 'observer';
      const obs = observers.get(key);
      if (!obs) return false;
      try {
        obs.disconnect();
      } catch (error) {
        console.warn(`[ChatGPT toolbox] ${name}.observer disconnect failed`, error);
      }
      observers.delete(key);
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[OBSERVER][DISCONNECT] module=${name} name=${key}`);
      }
      return true;
    }

    function disconnectAll() {
      Array.from(observers.keys()).forEach((k) => disconnect(k));
    }

    function dump() {
      return {
        moduleName: name,
        activeObservers: observers.size,
        names: Array.from(observers.keys()),
      };
    }

    return {
      register,
      disconnect,
      disconnectAll,
      dump,
      has: (observerName) => observers.has(String(observerName || '').trim() || 'observer'),
    };
  }

  function dumpAllTimers() {
    const target = getDebugApiTarget();
    const map = target.__CGPT_TOOLBOX_TIMERS__;
    if (!map || typeof map.forEach !== 'function') {
      return { total: { timeouts: 0, rafs: 0, intervals: 0 }, modules: [] };
    }
    const modules = [];
    const total = { timeouts: 0, rafs: 0, intervals: 0 };
    map.forEach((entry) => {
      const t = entry && entry.timers ? entry.timers.size : 0;
      const r = entry && entry.rafs ? entry.rafs.size : 0;
      const i = entry && entry.intervals ? entry.intervals.size : 0;
      modules.push({
        moduleName: entry && entry.moduleName ? entry.moduleName : '-',
        timeouts: t,
        rafs: r,
        intervals: i,
      });
      total.timeouts += t;
      total.rafs += r;
      total.intervals += i;
    });
    modules.sort((a, b) => (b.intervals + b.timeouts + b.rafs) - (a.intervals + a.timeouts + a.rafs));
    return { total, modules };
  }

  function dumpAllObservers() {
    const target = getDebugApiTarget();
    const map = target.__CGPT_TOOLBOX_OBSERVERS__;
    if (!map || typeof map.forEach !== 'function') {
      return { total: 0, modules: [] };
    }
    const modules = [];
    let total = 0;
    map.forEach((observers, moduleName) => {
      const size = observers && typeof observers.size === 'number' ? observers.size : 0;
      total += size;
      modules.push({
        moduleName: String(moduleName || '-'),
        activeObservers: size,
        names: observers && typeof observers.keys === 'function' ? Array.from(observers.keys()) : [],
      });
    });
    modules.sort((a, b) => b.activeObservers - a.activeObservers);
    return { total, modules };
  }

  function registerRuntimeDebugApis(context = {}) {
    registerPerfDebugApis();
    registerToolboxDebugApis({
      ...context,
      apiMap: {
        DumpTimers: () => dumpAllTimers(),
        DumpObservers: () => dumpAllObservers(),
        PerfSnapshot: () => {
          const snap = PerfCounters.snapshot();
          const timers = dumpAllTimers();
          const observers = dumpAllObservers();
          return {
            ...snap,
            activeTimers: timers.total.timeouts,
            activeIntervals: timers.total.intervals,
            activeRafs: timers.total.rafs,
            activeObservers: observers.total,
          };
        },
      },
    });
  }

  function registerRuntimeDebugApi(context = {}) {
    registerRuntimeDebugApis(context);
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

      if (type === 'contains') {
        const parent = qs(rule.parent, root);
        const childSelector = String(rule.child || '').trim();

        if (parent && childSelector && !parent.querySelector(childSelector)) {
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
      globalUploadActiveGroupId: 'globalUploadActiveGroupId',
      uploadLastActiveGroupId: 'uploadLastActiveGroupId',
      lastManualUploadGroupId: 'lastManualUploadGroupId',
      uploadBlobPersistEnabled: 'uploadBlobPersistEnabled',
      autoQueueConfig: 'autoQueueConfig',
      promptManagerData: 'promptManagerData',
      promptManagerActiveCategory: 'promptManagerActiveCategory',
      promptManagerActiveSubtab: 'promptManagerActiveSubtab',
      autoqueueActiveSubtab: 'autoqueueActiveSubtab',
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
      conversationSnapshotCache: 'conversationSnapshotCacheV1',
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
  const TOOLBOX_PAGE_STATE_SAVE_DEBOUNCE_MS = 750;
  let toolboxPageStateSaveTimer = 0;
  let toolboxPageStateSavePending = null;
  let toolboxPageStateSaveLastSignature = '';

  function buildToolboxPageStateSaveSignature(toolboxRouteKey, patch) {
    const key = String(toolboxRouteKey || '').trim();
    let patchText = '';

    try {
      patchText = JSON.stringify(patch || {});
    } catch (error) {
      const errText = error && error.message ? error.message : String(error);
      console.error('[ChatGPT toolbox] buildToolboxPageStateSaveSignature failed', error);
      patchText = `serialize-failed:${errText}`;
    }

    return `${key}|${patchText}`;
  }

  function flushToolboxPageStateSaveNow() {
    if (toolboxPageStateSaveTimer) {
      window.clearTimeout(toolboxPageStateSaveTimer);
      toolboxPageStateSaveTimer = 0;
    }

    const pending = toolboxPageStateSavePending;
    toolboxPageStateSavePending = null;

    if (!pending) {
      return;
    }

    const signature = buildToolboxPageStateSaveSignature(
      pending.toolboxRouteKey,
      pending.patch,
    );

    if (signature === toolboxPageStateSaveLastSignature) {
      return;
    }

    toolboxPageStateSaveLastSignature = signature;
    saveToolboxPageStatePatchImmediate(pending.patch, pending.reason);
  }

  const TOOLBOX_PAGE_STATE_LEGACY_READ_ALIASES = Object.freeze({
    activeTab: ['active_tab'],
    uploadActiveGroupId: ['upload_active_group_id'],
    layoutState: ['layout_state'],
    quickPromptCategory: ['quick_prompt_category'],
  });

  const TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS = Object.freeze([
    'active_tab',
    'upload_active_group_id',
    'layout_state',
    'quick_prompt_category',
  ]);

  const TOOLBOX_PAGE_STATE_PATCH_ALLOW_KEYS = Object.freeze([
    'activeTab',
    'uploadActiveGroupId',
    'layoutState',
    'uploadSelection',
    'quickPromptCategory',
    'toolboxRouteKey',
    'page_instance_id',
    'url',
    'pathname',
    'conversation_id',
    'updatedAt',
  ]);

  function readToolboxStateField(state, fieldName, fallback = '') {
    const src = state && typeof state === 'object' ? state : {};
    const key = String(fieldName || '').trim();
    if (!key) {
      return fallback;
    }

    const readValue = (fieldKey) => {
      if (!Object.prototype.hasOwnProperty.call(src, fieldKey)) {
        return undefined;
      }
      const value = src[fieldKey];
      if (value == null) {
        return undefined;
      }
      if (typeof value === 'string') {
        const text = value.trim();
        return text || undefined;
      }
      return value;
    };

    const direct = readValue(key);
    if (direct !== undefined) {
      return direct;
    }

    const legacyKeys = TOOLBOX_PAGE_STATE_LEGACY_READ_ALIASES[key];
    if (Array.isArray(legacyKeys)) {
      for (let i = 0; i < legacyKeys.length; i += 1) {
        const legacyValue = readValue(legacyKeys[i]);
        if (legacyValue !== undefined) {
          return legacyValue;
        }
      }
    }

    return fallback;
  }

  function normalizeToolboxStatePatchForWrite(patch) {
    const input = patch && typeof patch === 'object' ? patch : {};
    const out = {};
    const droppedKeys = [];

    const activeTab = readToolboxStateField(input, 'activeTab', '');
    if (activeTab) {
      out.activeTab = activeTab;
    }

    const uploadSelection = input.uploadSelection && typeof input.uploadSelection === 'object'
      ? input.uploadSelection
      : {};
    const uploadActiveGroupId = String(
      readToolboxStateField(input, 'uploadActiveGroupId', '')
      || readToolboxStateField(uploadSelection, 'activeGroupId', '')
      || '',
    ).trim();
    if (uploadActiveGroupId) {
      out.uploadActiveGroupId = uploadActiveGroupId;
      out.uploadSelection = { activeGroupId: uploadActiveGroupId };
    }

    const layoutState = readToolboxStateField(input, 'layoutState', null);
    if (layoutState && typeof layoutState === 'object') {
      out.layoutState = layoutState;
    }

    const quickPromptCategory = readToolboxStateField(input, 'quickPromptCategory', '');
    if (quickPromptCategory) {
      out.quickPromptCategory = quickPromptCategory;
    }

    TOOLBOX_PAGE_STATE_PATCH_ALLOW_KEYS.forEach((key) => {
      if (
        key === 'activeTab'
        || key === 'quickPromptCategory'
        || key === 'uploadActiveGroupId'
        || key === 'uploadSelection'
        || key === 'layoutState'
      ) {
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(input, key)) {
        return;
      }
      const value = input[key];
      if (value == null) {
        return;
      }
      out[key] = value;
    });

    Object.keys(input).forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        return;
      }
      if (TOOLBOX_PAGE_STATE_PATCH_ALLOW_KEYS.includes(key)) {
        return;
      }
      if (TOOLBOX_PAGE_STATE_LEGACY_READ_ALIASES[key]) {
        return;
      }
      droppedKeys.push(key);
    });

    toolboxPageStateAppendLog(
      `[STATE_SCHEMA][PAGE_STATE_SAVE_FILTER] kept=${Object.keys(out).join(',') || '-'} dropped=${droppedKeys.join(',') || '-'}`,
    );

    return out;
  }

  let didLogCanonicalFieldValidation = false;

  function logLegacyFieldFinding(scope, fields) {
    const list = Array.isArray(fields) ? fields.filter(Boolean) : [];
    if (!list.length) {
      return;
    }
    const line = `[FIELD][LEGACY_FOUND] scope=${scope} fields=${list.join(',')}`;
    console.warn(line);
    toolboxPageStateAppendLog(line);
  }

  async function scanUploadQueueCanonicalFields() {
    if (typeof UploadModule === 'undefined'
      || typeof UploadModule.scanQueueRowsForLegacyFields !== 'function') {
      return;
    }
    try {
      await UploadModule.scanQueueRowsForLegacyFields();
    } catch (error) {
      console.error('[ChatGPT toolbox] scanUploadQueueCanonicalFields failed', error);
    }
  }

  function validateCanonicalFieldsOnStartup() {
    if (didLogCanonicalFieldValidation) {
      return;
    }
    didLogCanonicalFieldValidation = true;

    try {
      if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.get === 'function') {
        const cfg = MemoryManager.get(MemoryManager.KEYS.autoQueueConfig, null);
        if (cfg && typeof cfg === 'object' && Array.isArray(cfg.taskProfiles)) {
          const legacyTaskFields = [];
          cfg.taskProfiles.forEach((profile, profileIndex) => {
            if (!profile || typeof profile !== 'object') {
              return;
            }
            if (Object.prototype.hasOwnProperty.call(profile, 'continuePrompt')) {
              legacyTaskFields.push(`taskProfiles[${profileIndex}].continuePrompt`);
            }
            if (Object.prototype.hasOwnProperty.call(profile, 'defaultContinuePrompt')) {
              legacyTaskFields.push(`taskProfiles[${profileIndex}].defaultContinuePrompt`);
            }
            (profile.tasks || []).forEach((task, taskIndex) => {
              if (task && Object.prototype.hasOwnProperty.call(task, 'continuePrompt')) {
                legacyTaskFields.push(`taskProfiles[${profileIndex}].tasks[${taskIndex}].continuePrompt`);
              }
            });
          });
          logLegacyFieldFinding('autoQueueConfig', legacyTaskFields);
        }
      }
    } catch (error) {
      console.error('[ChatGPT toolbox] validateCanonicalFieldsOnStartup autoQueueConfig failed', error);
    }

    try {
      const states = readAllToolboxPageStates();
      const pageLegacyFields = [];
      Object.entries(states).forEach(([routeKey, state]) => {
        if (!state || typeof state !== 'object') {
          return;
        }
        TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS.forEach((legacyKey) => {
          if (Object.prototype.hasOwnProperty.call(state, legacyKey)) {
            pageLegacyFields.push(`${routeKey}.${legacyKey}`);
          }
        });
      });
      logLegacyFieldFinding('pageState', pageLegacyFields);

      if (pageLegacyFields.length) {
        let migrated = false;
        Object.keys(states).forEach((routeKey) => {
          const state = states[routeKey];
          if (!state || typeof state !== 'object') {
            return;
          }
          const patch = normalizeToolboxStatePatchForWrite(state);
          const nextState = {
            ...state,
            ...patch,
          };
          TOOLBOX_PAGE_STATE_LEGACY_WRITE_KEYS.forEach((legacyKey) => {
            if (Object.prototype.hasOwnProperty.call(nextState, legacyKey)) {
              delete nextState[legacyKey];
              migrated = true;
            }
          });
          states[routeKey] = nextState;
        });
        if (migrated) {
          writeAllToolboxPageStates(states);
          toolboxPageStateAppendLog('[FIELD][LEGACY_MIGRATED] scope=pageState');
        }
      }
    } catch (error) {
      console.error('[ChatGPT toolbox] validateCanonicalFieldsOnStartup pageState failed', error);
    }

    void scanUploadQueueCanonicalFields();
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

  function getToolboxRouteKey() {
    return `page:${getToolboxPageInstanceId()}`;
  }

  function getToolboxConversationStateKey() {
    const conversationId = parseConversationIdFromPath(window.location.pathname || '');
    return conversationId ? `conversationState:${conversationId}` : '';
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
    const toolboxRouteKey = getToolboxRouteKey();
    const states = readAllToolboxPageStates();
    const state = states[toolboxRouteKey];
    if (!state || typeof state !== 'object') {
      return {};
    }
    return state;
  }

  function saveToolboxPageStatePatchImmediate(patch, reason = '') {
    const toolboxRouteKey = getToolboxRouteKey();
    const states = readAllToolboxPageStates();
    const oldState = states[toolboxRouteKey] && typeof states[toolboxRouteKey] === 'object'
      ? states[toolboxRouteKey]
      : {};
    const bindingPatch = getToolboxPageBindingPatch();

    const normalizedPatch = normalizeToolboxStatePatchForWrite(patch || {});

    states[toolboxRouteKey] = {
      ...oldState,
      ...normalizedPatch,
      ...bindingPatch,
      toolboxRouteKey,
      page_instance_id: getToolboxPageInstanceId(),
      url: window.location.href,
      pathname: window.location.pathname,
      updatedAt: Date.now(),
    };

    writeAllToolboxPageStates(states);
    const activeTab = readToolboxStateField(states[toolboxRouteKey], 'activeTab', '');
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
      `[TOOLBOX_TAB][SAVE] reason=${reason || '-'} toolboxRouteKey=${toolboxRouteKey} activeTab=${activeTab || '-'} `
      + `compactMode=${compactModeFlag ? 'true' : 'false'} `
      + `isApplyingToolboxPageState=${isApplyingToolboxPageState ? 'true' : 'false'} `
      + `fields=${Object.keys(patch || {}).join(',')}`,
    );
    toolboxPageStateAppendLog(
      `[TOOLBOX_PAGE_STATE][save] reason=${reason || '-'} toolboxRouteKey=${toolboxRouteKey} fields=${Object.keys(patch || {}).join(',')}`,
    );
  }

  function saveToolboxPageStatePatch(patch, reason = '') {
    const toolboxRouteKey = getToolboxRouteKey();
    const normalizedPatch = patch && typeof patch === 'object' ? patch : {};
    const signature = buildToolboxPageStateSaveSignature(toolboxRouteKey, normalizedPatch);
    const reasonText = String(reason || '').trim();
    const immediateReasons = new Set([
      'before-route-key-change',
      'panel-drag-end',
      'panel-hide',
      'panel-show',
      'init',
    ]);
    const shouldFlushImmediately = immediateReasons.has(reasonText)
      || reasonText.includes('drag-end')
      || reasonText.includes('route-change');

    if (shouldFlushImmediately) {
      if (toolboxPageStateSaveTimer) {
        window.clearTimeout(toolboxPageStateSaveTimer);
        toolboxPageStateSaveTimer = 0;
      }
      toolboxPageStateSavePending = null;

      if (signature !== toolboxPageStateSaveLastSignature) {
        toolboxPageStateSaveLastSignature = signature;
        saveToolboxPageStatePatchImmediate(normalizedPatch, reasonText);
      }
      return;
    }

    if (signature === toolboxPageStateSaveLastSignature && toolboxPageStateSaveTimer) {
      return;
    }

    toolboxPageStateSavePending = {
      patch: normalizedPatch,
      reason: reasonText,
      toolboxRouteKey,
    };

    if (toolboxPageStateSaveTimer) {
      window.clearTimeout(toolboxPageStateSaveTimer);
    }

    toolboxPageStateSaveTimer = window.setTimeout(() => {
      toolboxPageStateSaveTimer = 0;
      flushToolboxPageStateSaveNow();
    }, TOOLBOX_PAGE_STATE_SAVE_DEBOUNCE_MS);
  }

  let isApplyingToolboxPageState = false;
  let toolboxPageStateApplySeq = 0;

  function collectCurrentToolboxPageState() {
    const state = {};

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.getActiveTab === 'function') {
      state.activeTab = ToolboxShell.getActiveTab();
    }

    if (typeof UploadModule !== 'undefined' && typeof UploadModule.getQuickPromptActiveCategory === 'function') {
      state.quickPromptCategory = UploadModule.getQuickPromptActiveCategory();
    }

    state.toolboxRouteKey = getToolboxRouteKey();
    state.page_instance_id = getToolboxPageInstanceId();
    state.url = window.location.href;
    state.pathname = window.location.pathname;
    state.updatedAt = Date.now();

    return state;
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

  function saveToolboxBaseStateForRouteKey(toolboxRouteKey, reason = '', meta = {}) {
    const key = String(toolboxRouteKey || '').trim();

    if (!key) {
      toolboxPageStateAppendLog(
        `[TOOLBOX_PAGE_STATE][save-for-key-skip] reason=${reason || '-'} toolboxRouteKey=empty`,
      );
      return;
    }

    if (isApplyingToolboxPageState) {
      toolboxPageStateAppendLog(
        `[TOOLBOX_PAGE_STATE][save-for-key-skip] reason=${reason || '-'} toolboxRouteKey=${key} applying=true`,
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
      toolboxRouteKey: key,
      updatedAt: Date.now(),
    };

    if (reason === 'before-route-key-change') {
      nextState.url = metaObj.url || oldState.url || '';
      nextState.pathname = metaObj.pathname || oldState.pathname || '';
    } else {
      nextState.url = metaObj.url || oldState.url || patch.url || window.location.href;
      nextState.pathname = metaObj.pathname || oldState.pathname || patch.pathname || window.location.pathname;
    }

    states[key] = nextState;

    writeAllToolboxPageStates(states);
    toolboxPageStateAppendLog(
      `[TOOLBOX_PAGE_STATE][save-for-key] reason=${reason || '-'} toolboxRouteKey=${key} fields=${Object.keys(patch || {}).join(',')}`,
    );
  }

  let lastToolboxRouteKey = '';
  let lastToolboxConversationKey = '';


  const DEFAULT_MULTI_UPLOAD_LAST_SELECTION = Object.freeze({
    projectKey: '',
    folderKey: '',
    updatedAt: 0,
  });

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
    continueAutomation: Object.freeze({
      autoUploadEnabled: true,
      autoUploadInterval: 5,
      // 闭环每轮回复完成后，进入下一轮之前的随机等待区间（毫秒）。默认 40～60 秒。
      closedLoopNextDelayMinMs: 40000,
      closedLoopNextDelayMaxMs: 60000,
      // 兼容旧配置字段。新逻辑不再主动使用该字段作为唯一等待时间。
      closedLoopNextDelayMs: 0,
      homeNavEnabled: true,
      homeNavInterval: 20,
      homeNavUrl: 'https://chatgpt.com/',
    }),
    copyHotkeyContinuePromptText: '',
    copyHotkeyContinueStopSignal: (
      typeof getDefaultDoneSignal === 'function'
        ? getDefaultDoneSignal()
        : '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>'
    ),
    multiUploadLastSelection: DEFAULT_MULTI_UPLOAD_LAST_SELECTION,
    uploadQuotaWindowHours: 3,
    uploadQuotaMaxFiles: 80,
    messageQuotaWindowHours: 3,
    messageQuotaMaxMessages: 150,
    uploadQuotaRecords: [],
    messageQuotaRecords: [],
    uploadLoopMode: 'closed',
  });

  function normalizeCompactUiConfig(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const cfg = Object.assign({}, DEFAULT_COMPACT_UI_CONFIG, raw);

    if (!raw.quickPromptActionVersion && raw.quickPromptClickAction === 'fill') {
      cfg.quickPromptClickAction = 'send';
      cfg.quickPromptActionVersion = 1;
    }

    cfg.quickPromptClickAction = cfg.quickPromptClickAction === 'fill' ? 'fill' : 'send';
    const rawQuickCategory = String(cfg.quickPromptActiveCategory || '全部').trim();
    if (rawQuickCategory === '鍏ㄩ儴') {
      console.info('[QUICK_PROMPT][CATEGORY][NORMALIZE_MOJIBAKE]', {
        from: rawQuickCategory,
        to: '全部',
      });
      cfg.quickPromptActiveCategory = '全部';
    } else {
      cfg.quickPromptActiveCategory = rawQuickCategory || '全部';
    }

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

    cfg.showUploadGroups = cfg.showUploadGroups !== false;

    function normalizePositiveInt(value, fallback, min, max) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      const intValue = Math.floor(n);
      if (intValue < min) return fallback;
      if (intValue > max) return max;
      return intValue;
    }

    function normalizeClosedLoopNextDelayMs(value, fallback, min, max) {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      const intValue = Math.round(n);
      if (intValue < min) return fallback;
      if (intValue > max) return max;
      return intValue;
    }

    function normalizeClosedLoopDelayRangeMs(rawMin, rawMax, legacySingleMs, rawMinSec, rawMaxSec) {
      let minMs = Number(rawMin);
      let maxMs = Number(rawMax);
      const legacyMs = Number(legacySingleMs);

      if (!Number.isFinite(minMs) || minMs <= 0) {
        const secMin = Number(rawMinSec);
        if (Number.isFinite(secMin) && secMin > 0) {
          minMs = Math.round(secMin * 1000);
        } else if (Number.isFinite(legacyMs) && legacyMs >= 10000) {
          minMs = legacyMs;
        } else {
          minMs = 40000;
        }
      }
      if (!Number.isFinite(maxMs) || maxMs <= 0) {
        const secMax = Number(rawMaxSec);
        if (Number.isFinite(secMax) && secMax > 0) {
          maxMs = Math.round(secMax * 1000);
        } else if (Number.isFinite(legacyMs) && legacyMs >= 10000) {
          maxMs = legacyMs;
        } else {
          maxMs = 60000;
        }
      }

      minMs = Math.round(minMs);
      maxMs = Math.round(maxMs);
      minMs = Math.max(1000, Math.min(600000, minMs));
      maxMs = Math.max(1000, Math.min(600000, maxMs));
      if (minMs > maxMs) {
        const tmp = minMs;
        minMs = maxMs;
        maxMs = tmp;
      }
      return {
        minMs,
        maxMs,
      };
    }

    const continueAutomationRaw = (
      raw.continueAutomation && typeof raw.continueAutomation === 'object'
    ) ? raw.continueAutomation : {};
    const closedLoopDelayRange = normalizeClosedLoopDelayRangeMs(
      continueAutomationRaw.closedLoopNextDelayMinMs,
      continueAutomationRaw.closedLoopNextDelayMaxMs,
      continueAutomationRaw.closedLoopNextDelayMs,
      continueAutomationRaw.closedLoopNextDelayMinSec,
      continueAutomationRaw.closedLoopNextDelayMaxSec,
    );
    cfg.continueAutomation = {
      autoUploadEnabled: continueAutomationRaw.autoUploadEnabled !== false,
      autoUploadInterval: normalizePositiveInt(continueAutomationRaw.autoUploadInterval, 5, 1, 999),
      closedLoopNextDelayMinMs: closedLoopDelayRange.minMs,
      closedLoopNextDelayMaxMs: closedLoopDelayRange.maxMs,
      closedLoopNextDelayMs: closedLoopDelayRange.minMs,
      homeNavEnabled: continueAutomationRaw.homeNavEnabled !== false,
      homeNavInterval: normalizePositiveInt(continueAutomationRaw.homeNavInterval, 20, 1, 999),
      homeNavUrl: (
        typeof continueAutomationRaw.homeNavUrl === 'string'
        && continueAutomationRaw.homeNavUrl.trim().length > 0
      ) ? continueAutomationRaw.homeNavUrl.trim() : 'https://chatgpt.com/',
    };

    cfg.uploadQuotaWindowHours = normalizePositiveInt(cfg.uploadQuotaWindowHours, 3, 1, 72);
    cfg.uploadQuotaMaxFiles = normalizePositiveInt(cfg.uploadQuotaMaxFiles, 80, 1, 10000);
    cfg.messageQuotaWindowHours = normalizePositiveInt(cfg.messageQuotaWindowHours, 3, 1, 72);
    cfg.messageQuotaMaxMessages = normalizePositiveInt(cfg.messageQuotaMaxMessages, 150, 1, 10000);
    cfg.uploadQuotaRecords = Array.isArray(cfg.uploadQuotaRecords) ? cfg.uploadQuotaRecords : [];
    cfg.messageQuotaRecords = Array.isArray(cfg.messageQuotaRecords) ? cfg.messageQuotaRecords : [];
    cfg.uploadLoopMode = String(cfg.uploadLoopMode || 'closed').trim() === 'open' ? 'open' : 'closed';

    // 继续指令 & 终止信号（兼容旧版 copyHotkeyLoop* 字段）
    const legacyLoopPrompt = typeof cfg.copyHotkeyLoopContinuePrompt === 'string'
      ? cfg.copyHotkeyLoopContinuePrompt.trim()
      : '';
    cfg.copyHotkeyContinuePromptText = String(cfg.copyHotkeyContinuePromptText || legacyLoopPrompt || '').trim();

    const legacyLoopStop = typeof cfg.copyHotkeyLoopStopSignal === 'string'
      ? cfg.copyHotkeyLoopStopSignal.trim()
      : '';
    const DEFAULT_BATCH_TASK_DONE_SIGNAL = typeof getDefaultDoneSignal === 'function'
      ? getDefaultDoneSignal()
      : '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';
    const LEGACY_COPY_HOTKEY_CONTINUE_STOP_SIGNALS = new Set([
      'CHATGPT_TOOLBOX_DONE',
      '<<<CHATGPT_TOOLBOX_DONE>>>',
      '__CHATGPT_TOOLBOX_DONE__',
      '<<<TASK_DONE>>>',
      'TASK_DONE',
    ]);
    const nextStopSignal = String(
      cfg.copyHotkeyContinueStopSignal || legacyLoopStop || DEFAULT_BATCH_TASK_DONE_SIGNAL,
    ).trim();
    if (LEGACY_COPY_HOTKEY_CONTINUE_STOP_SIGNALS.has(nextStopSignal)) {
      cfg.copyHotkeyContinueStopSignal = DEFAULT_BATCH_TASK_DONE_SIGNAL;
    } else {
      cfg.copyHotkeyContinueStopSignal = nextStopSignal || DEFAULT_BATCH_TASK_DONE_SIGNAL;
    }

    delete cfg.copyHotkeyLoopContinuePrompt;
    delete cfg.copyHotkeyLoopStopSignalEnabled;
    delete cfg.copyHotkeyLoopStopSignal;

    const savedSelection = raw.multiUploadLastSelection && typeof raw.multiUploadLastSelection === 'object'
      ? raw.multiUploadLastSelection
      : {};
    cfg.multiUploadLastSelection = {
      projectKey: typeof savedSelection.projectKey === 'string' ? savedSelection.projectKey : '',
      folderKey: typeof savedSelection.folderKey === 'string' ? savedSelection.folderKey : '',
      updatedAt: Number(savedSelection.updatedAt) || 0,
    };

    return cfg;
  }

  const CompactUiConfigStore = (() => {
    function readRaw() {
      return MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {};
    }

    function get() {
      return normalizeCompactUiConfig(readRaw());
    }

    function save(next) {
      const normalized = normalizeCompactUiConfig(next || {});
      MemoryManager.set(MemoryManager.KEYS.compactUiConfig, normalized);
      return normalized;
    }

    function patch(patch) {
      return save(Object.assign({}, get(), patch || {}));
    }

    return Object.freeze({
      get,
      save,
      patch,
    });
  })();

  const PromptCategoryState = (() => {
    const ALL_CATEGORY = '全部';
    const DEFAULT_EDITOR_CATEGORY = '默认';

    function normalizeCategoryName(name) {
      const text = String(name || '').trim();
      if (!text || text === '鍏ㄩ儴') {
        return ALL_CATEGORY;
      }
      return text;
    }

    function readStoredCategory() {
      let val = readDataStorage("promptManagerActiveCategory", null);
      if (val != null && String(val).trim()) {
        return normalizeCategoryName(val);
      }
      const fromPromptManager = MemoryManager.get(
        MemoryManager.KEYS.promptManagerActiveCategory,
        null,
      );
      if (fromPromptManager != null && String(fromPromptManager).trim()) {
        writeDataStorage("promptManagerActiveCategory", fromPromptManager);
        return normalizeCategoryName(fromPromptManager);
      }

      const compactCfg = CompactUiConfigStore.get();
      return normalizeCategoryName(compactCfg.quickPromptActiveCategory);
    }

    let activeCategory = readStoredCategory();

    function getActiveCategory() {
      return normalizeCategoryName(activeCategory);
    }

    function getEditorDefaultCategory() {
      const current = getActiveCategory();
      return current !== ALL_CATEGORY ? current : DEFAULT_EDITOR_CATEGORY;
    }

    function setActiveCategory(category, options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      activeCategory = normalizeCategoryName(category);

      MemoryManager.set(
        MemoryManager.KEYS.promptManagerActiveCategory,
        activeCategory,
      );
      writeDataStorage("promptManagerActiveCategory", activeCategory);

      if (opts.syncCompactUi !== false) {
        CompactUiConfigStore.patch({
          quickPromptActiveCategory: activeCategory,
        });
      }

      return activeCategory;
    }

    function hydrateFromStorage() {
      activeCategory = readStoredCategory();
      return activeCategory;
    }

    return Object.freeze({
      getActiveCategory,
      setActiveCategory,
      getEditorDefaultCategory,
      normalizeCategoryName,
      hydrateFromStorage,
    });
  })();

  function getUploadQuotaLimit() {
    const cfg = normalizeCompactUiConfig(
      MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {},
    );
    return cfg.uploadQuotaMaxFiles;
  }

  function getMessageQuotaLimit() {
    const cfg = normalizeCompactUiConfig(
      MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {},
    );
    return cfg.messageQuotaMaxMessages;
  }

  const DEFAULT_SHORTCUT_CONFIG = Object.freeze({
    sendMessage: {
      enabled: true,
      label: 'Ctrl+Alt+S',
      key: 's',
      code: 'KeyS',
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    copyLastMessage: {
      enabled: false,
      label: '',
      key: '',
      code: '',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    },
    sendCopyAndHotkeyOnce: {
      enabled: true,
      label: 'Ctrl+Alt+J',
      key: 'j',
      code: 'KeyJ',
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    copyAndHotkeyOnce: {
      enabled: true,
      label: 'Ctrl+Alt+K',
      key: 'k',
      code: 'KeyK',
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    copyThenShortcutTargetHotkey: {
      enabled: true,
      label: 'Ctrl+Alt+I',
      key: 'i',
      code: 'KeyI',
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    },
    startUpload: {
      enabled: true,
      label: 'Ctrl+I',
      key: 'i',
      code: 'KeyI',
      ctrl: true,
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

  function isPlainEnterShortcutItem(item) {
    if (!item || typeof item !== 'object') return false;

    const key = String(item.key || '').toLowerCase();
    const code = String(item.code || '').toLowerCase();
    const label = String(item.label || '').trim();
    const isEnterKey = key === 'enter' || code === 'enter' || code === 'numpadenter';
    const isEnterLabel = label === 'Enter' || label.toLowerCase() === 'enter';

    return (isEnterKey || isEnterLabel)
      && !item.ctrl
      && !item.alt
      && !item.shift
      && !item.meta;
  }

  function migrateUnsafePlainEnterSendShortcut(sendMessage, rawConfig) {
    if (!isPlainEnterShortcutItem(sendMessage)) {
      return false;
    }

    const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : null;
    const hasExplicitConfig = !!(raw && raw.sendMessage);

    if (hasExplicitConfig) {
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog('[SHORTCUT][PLAIN_ENTER_ALLOWED] source=user-config');
        ToolboxShell.appendLog('[SHORTCUT][PLAIN_ENTER_MIGRATE_SKIP] reason=user-explicit-config');
      }
      return false;
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog('[SHORTCUT][PLAIN_ENTER_MIGRATE_SKIP] reason=no-explicit-config');
    }

    return false;
  }

  const LEGACY_DEFAULT_SENDMESSAGE_CTRL_ENTER = Object.freeze({
    enabled: true,
    label: 'Ctrl+Enter',
    key: 'Enter',
    code: 'Enter',
    ctrl: true,
    alt: false,
    shift: false,
    meta: false,
  });

  function isShortcutItemSame(a, b) {
    const x = a && typeof a === 'object' ? a : {};
    const y = b && typeof b === 'object' ? b : {};
    return String(x.label || '') === String(y.label || '')
      && String(x.key || '') === String(y.key || '')
      && String(x.code || '') === String(y.code || '')
      && !!x.ctrl === !!y.ctrl
      && !!x.alt === !!y.alt
      && !!x.shift === !!y.shift
      && !!x.meta === !!y.meta;
  }

  function migrateLegacyCtrlEnterDefaultSendShortcut(sendMessage, rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') {
      return false;
    }

    const rawSend = rawConfig.sendMessage;
    if (!isShortcutItemSame(rawSend, LEGACY_DEFAULT_SENDMESSAGE_CTRL_ENTER)) {
      return false;
    }

    const rawCopyLast = rawConfig.copyLastMessage;
    const rawSendCopyOnce = rawConfig.sendCopyAndHotkeyOnce;
    const rawCopyOnce = rawConfig.copyAndHotkeyOnce;
    const rawCopyThen = rawConfig.copyThenShortcutTargetHotkey;
    const rawStartUpload = rawConfig.startUpload;

    const otherLooksDefault = (!rawCopyLast || isShortcutItemSame(rawCopyLast, DEFAULT_SHORTCUT_CONFIG.copyLastMessage))
      && (!rawSendCopyOnce || isShortcutItemSame(rawSendCopyOnce, DEFAULT_SHORTCUT_CONFIG.sendCopyAndHotkeyOnce))
      && (!rawCopyOnce || isShortcutItemSame(rawCopyOnce, DEFAULT_SHORTCUT_CONFIG.copyAndHotkeyOnce))
      && (!rawCopyThen || isShortcutItemSame(rawCopyThen, DEFAULT_SHORTCUT_CONFIG.copyThenShortcutTargetHotkey))
      && (!rawStartUpload || isShortcutItemSame(rawStartUpload, DEFAULT_SHORTCUT_CONFIG.startUpload));

    if (!otherLooksDefault) {
      return false;
    }

    sendMessage.label = DEFAULT_SHORTCUT_CONFIG.sendMessage.label;
    sendMessage.key = DEFAULT_SHORTCUT_CONFIG.sendMessage.key;
    sendMessage.code = DEFAULT_SHORTCUT_CONFIG.sendMessage.code;
    sendMessage.ctrl = DEFAULT_SHORTCUT_CONFIG.sendMessage.ctrl;
    sendMessage.alt = DEFAULT_SHORTCUT_CONFIG.sendMessage.alt;
    sendMessage.shift = DEFAULT_SHORTCUT_CONFIG.sendMessage.shift;
    sendMessage.meta = DEFAULT_SHORTCUT_CONFIG.sendMessage.meta;
    return true;
  }

  function getShortcutConfig() {
    const raw = MemoryManager.get(
      MemoryManager.KEYS.shortcutConfig,
      null,
    );

    const sendMessage = cloneShortcutItem(
      raw && raw.sendMessage,
      DEFAULT_SHORTCUT_CONFIG.sendMessage,
    );

    const copyLastMessage = cloneShortcutItem(
      raw && raw.copyLastMessage,
      DEFAULT_SHORTCUT_CONFIG.copyLastMessage,
    );
    const sendCopyAndHotkeyOnce = cloneShortcutItem(
      raw && raw.sendCopyAndHotkeyOnce,
      DEFAULT_SHORTCUT_CONFIG.sendCopyAndHotkeyOnce,
    );
    const copyAndHotkeyOnce = cloneShortcutItem(
      raw && raw.copyAndHotkeyOnce,
      DEFAULT_SHORTCUT_CONFIG.copyAndHotkeyOnce,
    );
    const copyThenShortcutTargetHotkey = cloneShortcutItem(
      raw && raw.copyThenShortcutTargetHotkey,
      DEFAULT_SHORTCUT_CONFIG.copyThenShortcutTargetHotkey,
    );
    const startUpload = cloneShortcutItem(
      raw && raw.startUpload,
      DEFAULT_SHORTCUT_CONFIG.startUpload,
    );

    const migratedUnsafeEnter = migrateUnsafePlainEnterSendShortcut(sendMessage, raw);
    const migratedLegacyCtrlEnter = migrateLegacyCtrlEnterDefaultSendShortcut(sendMessage, raw);
    if ((migratedUnsafeEnter || migratedLegacyCtrlEnter) && raw) {
      saveShortcutConfig({
        sendMessage,
        copyLastMessage,
        sendCopyAndHotkeyOnce,
        copyAndHotkeyOnce,
        copyThenShortcutTargetHotkey,
        startUpload,
      });
    }

    return {
      sendMessage,
      copyLastMessage,
      sendCopyAndHotkeyOnce,
      copyAndHotkeyOnce,
      copyThenShortcutTargetHotkey,
      startUpload,
    };
  }

  function saveShortcutConfig(config) {
    MemoryManager.set(
      MemoryManager.KEYS.shortcutConfig,
      {
        sendMessage: cloneShortcutItem(config && config.sendMessage, DEFAULT_SHORTCUT_CONFIG.sendMessage),
        copyLastMessage: cloneShortcutItem(config && config.copyLastMessage, DEFAULT_SHORTCUT_CONFIG.copyLastMessage),
        sendCopyAndHotkeyOnce: cloneShortcutItem(
          config && config.sendCopyAndHotkeyOnce,
          DEFAULT_SHORTCUT_CONFIG.sendCopyAndHotkeyOnce,
        ),
        copyAndHotkeyOnce: cloneShortcutItem(
          config && config.copyAndHotkeyOnce,
          DEFAULT_SHORTCUT_CONFIG.copyAndHotkeyOnce,
        ),
        copyThenShortcutTargetHotkey: cloneShortcutItem(
          config && config.copyThenShortcutTargetHotkey,
          DEFAULT_SHORTCUT_CONFIG.copyThenShortcutTargetHotkey,
        ),
        startUpload: cloneShortcutItem(config && config.startUpload, DEFAULT_SHORTCUT_CONFIG.startUpload),
      },
    );
    logShortcutTargetWarnings(
      getShortcutConfig(),
    );
  }

  function resetShortcutConfig() {
    MemoryManager.set(
      MemoryManager.KEYS.shortcutConfig,
      {
        sendMessage: cloneShortcutItem(DEFAULT_SHORTCUT_CONFIG.sendMessage, DEFAULT_SHORTCUT_CONFIG.sendMessage),
        copyLastMessage: cloneShortcutItem(DEFAULT_SHORTCUT_CONFIG.copyLastMessage, DEFAULT_SHORTCUT_CONFIG.copyLastMessage),
        sendCopyAndHotkeyOnce: cloneShortcutItem(
          DEFAULT_SHORTCUT_CONFIG.sendCopyAndHotkeyOnce,
          DEFAULT_SHORTCUT_CONFIG.sendCopyAndHotkeyOnce,
        ),
        copyAndHotkeyOnce: cloneShortcutItem(
          DEFAULT_SHORTCUT_CONFIG.copyAndHotkeyOnce,
          DEFAULT_SHORTCUT_CONFIG.copyAndHotkeyOnce,
        ),
        copyThenShortcutTargetHotkey: cloneShortcutItem(
          DEFAULT_SHORTCUT_CONFIG.copyThenShortcutTargetHotkey,
          DEFAULT_SHORTCUT_CONFIG.copyThenShortcutTargetHotkey,
        ),
        startUpload: cloneShortcutItem(DEFAULT_SHORTCUT_CONFIG.startUpload, DEFAULT_SHORTCUT_CONFIG.startUpload),
      },
    );
    logShortcutTargetWarnings(getShortcutConfig());
  }

  function getCopyAndHotkeyShortcutConfig() {
    const cfg = getShortcutConfig();
    return cloneShortcutItem(
      cfg.copyAndHotkeyOnce,
      DEFAULT_SHORTCUT_CONFIG.copyAndHotkeyOnce,
    );
  }

  function getCopyThenShortcutTargetConfig() {
    const cfg = getShortcutConfig();
    return cloneShortcutItem(
      cfg.copyThenShortcutTargetHotkey,
      DEFAULT_SHORTCUT_CONFIG.copyThenShortcutTargetHotkey,
    );
  }

  function shortcutItemToSystemCombo(item) {
    if (!item || typeof item !== 'object') {
      return '';
    }

    if (item.enabled === false) {
      return '';
    }

    const labelText = String(item.label || '').trim();
    if (
      !labelText
      && !item.ctrl
      && !item.alt
      && !item.shift
      && !item.meta
      && !item.key
      && !item.code
    ) {
      return '';
    }

    if (item.label) {
      return normalizeShortcutText(item.label);
    }

    const parts = [];
    if (item.ctrl) parts.push('ctrl');
    if (item.alt) parts.push('alt');
    if (item.shift) parts.push('shift');
    if (item.meta) parts.push('meta');

    const code = String(item.code || '').toLowerCase();
    const key = String(item.key || '').toLowerCase();
    let main = '';

    if (/^key[a-z]$/.test(code)) {
      main = code.replace(/^key/, '');
    } else if (/^digit\d$/.test(code)) {
      main = code.replace(/^digit/, '');
    } else if (/^f\d{1,2}$/.test(key)) {
      main = key;
    } else if (key && !['control', 'shift', 'alt', 'meta'].includes(key)) {
      main = key.length === 1 ? key : key;
    }

    if (main) {
      parts.push(main);
    }

    return parts.join('+');
  }

  function getCopyThenShortcutTargetLabel() {
    const item = getCopyThenShortcutTargetConfig();
    if (!item || item.enabled === false) {
      return '';
    }
    return String(item.label || '').trim();
  }

  function getCopyThenShortcutTargetCombo() {
    const item = getCopyThenShortcutTargetConfig();
    return shortcutItemToSystemCombo(item);
  }

  function logShortcutTargetWarnings(cfg) {
    const config = cfg && typeof cfg === 'object' ? cfg : getShortcutConfig();
    const norm = (item) => normalizeShortcutText(item && item.label ? item.label : '');
    const triggerLabel = norm(config.copyAndHotkeyOnce);
    const targetLabel = norm(config.copyThenShortcutTargetHotkey);
    const sendLabel = norm(config.sendMessage);

    if (triggerLabel && targetLabel && triggerLabel === targetLabel) {
      ToolboxShell.appendLog(
        '[SHORTCUT][WARN] copyThenHotkeyHotkey equals copyThenShortcutTargetHotkey',
      );
    }

    if (sendLabel && targetLabel && sendLabel === targetLabel) {
      ToolboxShell.appendLog(
        '[SHORTCUT][WARN] copyThenShortcutTargetHotkey equals sendHotkey',
      );
    }
  }

  function getCopyAndHotkeyButtonLabel() {
    return '复制+快捷键';
  }

  function getCopyAndHotkeyButtonTitle() {
    const label = getCopyThenShortcutTargetLabel();
    const combo = getCopyThenShortcutTargetCombo();
    const resolved = label || combo || '未设置';
    return `复制 ChatGPT 最后一条回复，然后触发内部目标快捷键 ${resolved}。`;
  }

  function getCopyHotkeyContinueFlowTitle() {
    const label = getCopyThenShortcutTargetLabel();
    const combo = getCopyThenShortcutTargetCombo();
    const resolved = label || combo || '未设置';
    return `等待回答完成 -> 检查终止信号 -> 复制最后回复 -> 内部目标快捷键 ${resolved} -> 发送继续指令`;
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

  function normalizeShortcutText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/controlleft|controlright|ctrlleft|ctrlright/g, 'ctrl')
      .replace(/altleft|altright/g, 'alt')
      .replace(/metaleft|metaright|winleft|winright|osleft|osright/g, 'meta')
      .replace(/control/g, 'ctrl')
      .replace(/command/g, 'meta')
      .replace(/cmd/g, 'meta');
  }

  function shortcutFromEvent(event) {
    const e = event || {};
    const parts = [];

    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('meta');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');

    const key = String(e.key || '').toLowerCase();

    if (!['control', 'shift', 'alt', 'meta'].includes(key)) {
      parts.push(key);
    }

    return parts.join('+');
  }

  function isShortcutMatched(event, shortcutText) {
    const rawShortcut = String(shortcutText || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
    const eventCode = String((event && event.code) || '').toLowerCase();

    // Side-specific Shift: allow explicit "ShiftRight"/"ShiftLeft" to bind
    // only that physical key, so left Shift won't trigger right Shift actions.
    if (rawShortcut === 'shiftright') {
      return eventCode === 'shiftright';
    }
    if (rawShortcut === 'shiftleft') {
      return eventCode === 'shiftleft';
    }

    return normalizeShortcutText(shortcutFromEvent(event))
      === normalizeShortcutText(shortcutText);
  }

  function isShortcutEventMatched(e, item) {
    if (!item || item.enabled === false) {
      return false;
    }

    if (item.label && isShortcutMatched(e, item.label)) {
      return true;
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

  function isShortcutConfigEventMatched(e, item) {
    if (!item || item.enabled === false) {
      return false;
    }

    return isShortcutEventMatched(e, item)
      || (item.label ? isShortcutMatched(e, item.label) : false);
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
    if (
      currentAction === 'copyThenShortcutTargetHotkey'
      || currentAction === 'copyLastMessage'
    ) {
      return '';
    }

    const current = config[currentAction];
    const sig = shortcutSignature(current);

    if (!sig) {
      return '';
    }

    const hiddenShortcutActions = new Set([
      'copyThenShortcutTargetHotkey',
      'copyLastMessage',
    ]);

    return Object.keys(config).find((key) => {
      if (key === currentAction) return false;
      if (hiddenShortcutActions.has(key)) return false;
      return shortcutSignature(config[key]) === sig;
    }) || '';
  }

  function applyUploadShortcutButtonTitles(rootEl) {
    const scope = rootEl || document;
    const shortcutCfg = getShortcutConfig();

    const uploadStartSendBtn = qs(UploadSelectors.sendMessageBtn, scope);
    if (uploadStartSendBtn) {
      let waitingSend = false;
      if (typeof UploadModule !== 'undefined') {
        if (typeof UploadModule.isWaitingSendActive === 'function') {
          waitingSend = UploadModule.isWaitingSendActive();
        } else if (typeof UploadModule.syncSendTaskPhase === 'function') {
          waitingSend = UploadModule.syncSendTaskPhase() === 'waiting_send';
        }
      }

      uploadStartSendBtn.title = waitingSend
        ? '等待发送'
        : `发送信息快捷键：${shortcutCfg.sendMessage.label || '未设置'}`;
    }

    const sendCopyHotkeyBtn = qs(UploadSelectors.sendCopyHotkeyBtn, scope);
    if (sendCopyHotkeyBtn) {
      const triggerLabel = shortcutCfg.sendCopyAndHotkeyOnce && shortcutCfg.sendCopyAndHotkeyOnce.label
        ? shortcutCfg.sendCopyAndHotkeyOnce.label
        : '未设置';
      const targetLabel = typeof getCopyThenShortcutTargetLabel === 'function'
        ? getCopyThenShortcutTargetLabel()
        : '';
      sendCopyHotkeyBtn.title = `触发快捷键：${triggerLabel}；流程：发送消息 -> 等待回复完成 -> 复制最后回复 -> ${targetLabel || '目标快捷键'}`;
    }

    const copyContinueBtn = qs(UploadSelectors.copyContinueBtn, scope);
    if (copyContinueBtn) {
      let copyTitle = '先复制最后回复，再发送“继续”';
      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.syncCopyContinueTaskPhase === 'function'
      ) {
        const copyPhase = UploadModule.syncCopyContinueTaskPhase();
        if (copyPhase === 'waiting_reply') {
          copyTitle = '正在等待回复';
        } else if (copyPhase === 'copying' || copyPhase === 'sending_continue' || copyPhase === 'running') {
          copyTitle = '复制并继续任务进行中';
        } else if (copyPhase === 'cancelling') {
          copyTitle = '停止请求已提交，正在等待复制并继续任务退出';
        }
      }
      copyContinueBtn.title = copyTitle;
    }

    const copyLastMessageBtn = qs(UploadSelectors.copyLastMessageBtn, scope) ;
    if (copyLastMessageBtn) {
      copyLastMessageBtn.title = '复制 ChatGPT 最后一条回复到剪贴板';
    }

    const uploadStartBtn = qs(UploadSelectors.startBtn, scope);
    if (uploadStartBtn) {
      let uploadTitle = `开始上传快捷键：${shortcutCfg.startUpload.label || '未设置'}`;
      if (typeof UploadModule !== 'undefined' && typeof UploadModule.syncUploadTaskPhase === 'function') {
        const uploadPhase = UploadModule.syncUploadTaskPhase();
        if (uploadPhase === 'uploading') {
          uploadTitle = '上传中';
        } else if (uploadPhase === 'cancelling') {
          uploadTitle = '正在取消上传';
        } else if (uploadPhase === 'success') {
          uploadTitle = '上传完成';
        }
      }
      uploadStartBtn.title = uploadTitle;
    }

    const copyHotkeyOnceBtn = qs(UploadSelectors.copyHotkeyOnceBtn, scope);
    if (copyHotkeyOnceBtn) {
      copyHotkeyOnceBtn.title = getCopyAndHotkeyButtonTitle();
      copyHotkeyOnceBtn.textContent = getCopyAndHotkeyButtonLabel();
    }

    const autoContinueBtn = (
      typeof UploadModule !== 'undefined'
      && (
        typeof UploadModule.findAutoContinueButton === 'function'
        || typeof UploadModule.resolveAutoContinueButton === 'function'
      )
    )
      ? (
        typeof UploadModule.findAutoContinueButton === 'function'
          ? UploadModule.findAutoContinueButton(scope)
          : UploadModule.resolveAutoContinueButton(scope)
      )
      : qs(UploadSelectors.autoContinueBtn, scope);
    if (autoContinueBtn) {
      let autoTitle = '复用自动指令队列：循环发送“继续”；再点一次停止';
      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.getAutoContinueButtonView === 'function'
        && typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.getState === 'function'
      ) {
        const view = UploadModule.getAutoContinueButtonView(AutoQueueModule.getState());
        if (view && view.title) {
          autoTitle = view.title;
        }
      }
      autoContinueBtn.title = autoTitle;
    }

    const continueFlowTitle = getCopyHotkeyContinueFlowTitle();
    const copyHotkeyContinueOnceBtn = qs(UploadSelectors.copyHotkeyContinueOnceBtn, scope);
    if (copyHotkeyContinueOnceBtn) {
      copyHotkeyContinueOnceBtn.title = continueFlowTitle;
    }

    const copyHotkeyContinueLoopBtn = qs(UploadSelectors.copyHotkeyContinueLoopBtn, scope);
    if (copyHotkeyContinueLoopBtn) {
      copyHotkeyContinueLoopBtn.title = continueFlowTitle;
    }

    const copyHotkeyUploadVerifyLoopHotkeyBtn = qs(UploadSelectors.closedLoopUploadEvery5HotkeyBtn, scope);
    if (copyHotkeyUploadVerifyLoopHotkeyBtn) {
      const targetLabel = getCopyThenShortcutTargetLabel() || '目标快捷键';
      copyHotkeyUploadVerifyLoopHotkeyBtn.title = `等待回复完成 -> 复制最后回复 -> 判断终止信号 -> ${targetLabel} -> 发送继续指令；按配置间隔自动上传代码`;
    }

    const copyHotkeyUploadVerifyLoopEveryRoundBtn = qs(UploadSelectors.closedLoopUploadEveryRoundHotkeyBtn, scope);
    if (copyHotkeyUploadVerifyLoopEveryRoundBtn) {
      const targetLabel = getCopyThenShortcutTargetLabel() || '目标快捷键';
      copyHotkeyUploadVerifyLoopEveryRoundBtn.title = `等待回复完成 -> 复制最后回复 -> 判断终止信号 -> ${targetLabel} -> 发送继续指令；每一轮都自动重新上传代码`;
    }

    const copyHotkeyUploadVerifyLoopPlainBtn = qs(UploadSelectors.closedLoopUploadEvery5Btn, scope);
    if (copyHotkeyUploadVerifyLoopPlainBtn) {
      copyHotkeyUploadVerifyLoopPlainBtn.title = '等待回复完成 -> 复制最后回复 -> 判断终止信号 -> 发送继续指令；按配置间隔自动上传代码';
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

  const TOOLBOX_DOM_EXCLUDE_SELECTOR = [
    `#${APP.rootId}`,
    '#xz-toolbox-root',
    '.xz-toolbox-root',
    '.cgpt-toolbox-root',
    '[data-xz-toolbox="1"]',
    '[data-cgpt-toolbox-root="1"]',
  ].join(', ');

  function isInToolbox(el) {
    return !!(el && el.closest && el.closest(TOOLBOX_DOM_EXCLUDE_SELECTOR));
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

  /** 全脚本唯一剪贴板写入入口；禁止在其他位置调用 clipboard API。 */
  async function copyTextUnified(text, reason = '') {
    const value = String(text || '').trim();

    if (!value) {
      console.warn('[COPY][SKIP_EMPTY]', {
        reason,
        textLength: 0,
        url: location.href,
      });
      return false;
    }

    console.log('[COPY][START]', {
      reason,
      textLength: value.length,
      url: location.href,
    });

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(value);
        console.log('[COPY][OK]', {
          reason,
          method: 'navigator.clipboard.writeText',
          textLength: value.length,
        });
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[COPY][OK] reason=${reason || '-'} method=navigator chars=${value.length}`);
        }
        return true;
      } catch (error) {
        console.error('[COPY][NAVIGATOR_FAILED]', {
          reason,
          error,
          stack: error && error.stack,
        });
      }
    }

    if (typeof GM_setClipboard === 'function') {
      try {
        GM_setClipboard(value, 'text');
        console.log('[COPY][OK]', {
          reason,
          method: 'GM_setClipboard',
          textLength: value.length,
        });
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[COPY][OK] reason=${reason || '-'} method=GM_setClipboard chars=${value.length}`);
        }
        return true;
      } catch (error) {
        console.error('[COPY][GM_SET_CLIPBOARD_FAILED]', {
          reason,
          error,
          stack: error && error.stack,
        });
      }
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', 'readonly');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';

      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      const ok = document.execCommand('copy');

      document.body.removeChild(textarea);

      if (ok) {
        console.log('[COPY][OK]', {
          reason,
          method: 'document.execCommand',
          textLength: value.length,
        });
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[COPY][OK] reason=${reason || '-'} method=execCommand chars=${value.length}`);
        }
        return true;
      }

      console.error('[COPY][EXEC_COMMAND_RETURN_FALSE]', {
        reason,
        textLength: value.length,
      });
      return false;
    } catch (error) {
      console.error('[COPY][EXEC_COMMAND_FAILED]', {
        reason,
        error,
        stack: error && error.stack,
      });
      return false;
    }
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
    let replyDoneFlashStopTimer = 0;
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

      function stopReplyDoneFlashWithHeader(reason = '') {
        stopReplyDoneFlash(reason);
        if (typeof ToolboxShell !== 'undefined'
          && typeof ToolboxShell.stopHeaderTitleFlash === 'function') {
          ToolboxShell.stopHeaderTitleFlash(reason);
        }
      }

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          stopReplyDoneFlashWithHeader('visibility-visible');
        }
      }, true);

      document.addEventListener('pointerdown', () => {
        stopReplyDoneFlashWithHeader('pointerdown');
      }, true);

      document.addEventListener('keydown', () => {
        stopReplyDoneFlashWithHeader('keydown');
      }, true);
    }


    function stopReplyDoneFlash(reason = '') {
      const wasActive = !!replyDoneFlashTimer || !!replyDoneFlashBaseTitle;

      if (replyDoneFlashTimer) {
        window.clearInterval(replyDoneFlashTimer);
        replyDoneFlashTimer = 0;
      }

      if (replyDoneFlashStopTimer) {
        window.clearTimeout(replyDoneFlashStopTimer);
        replyDoneFlashStopTimer = 0;
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

    function startReplyDoneFlash(reason = '', options = {}) {
      const currentBase = stripKnownPrefixes(document.title) || 'ChatGPT';
      const cleanBase = currentBase
        .replace(/^🔔\s*回复完成\s*[-:：]\s*/u, '')
        .replace(/^【回复完成】\s*/u, '')
        .trim() || 'ChatGPT';

      stopReplyDoneFlash(`restart:${reason || '-'}`);

      replyDoneFlashBaseTitle = cleanBase;
      replyDoneFlashOn = false;

      const intervalMs = Number(options.intervalMs || 600);
      const autoStopMs = Number(options.autoStopMs || 0);

      const tick = () => {
        replyDoneFlashOn = !replyDoneFlashOn;
        document.title = replyDoneFlashOn
          ? normalizeTitle(`【回复完成】 ${replyDoneFlashBaseTitle}`)
          : normalizeTitle(replyDoneFlashBaseTitle);
      };

      tick();
      replyDoneFlashTimer = window.setInterval(tick, intervalMs);

      if (replyDoneFlashStopTimer) {
        window.clearTimeout(replyDoneFlashStopTimer);
        replyDoneFlashStopTimer = 0;
      }

      if (autoStopMs > 0) {
        replyDoneFlashStopTimer = window.setTimeout(() => {
          stopReplyDoneFlash(`auto-stop:${reason || 'reply-done'}`);
        }, autoStopMs);
      }

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        const flashMode = autoStopMs > 0 ? 'timed' : 'until-user-action';
        ToolboxShell.appendLog(
          `[TITLE_FLASH][start] reason=${reason || 'reply-done'} intervalMs=${intervalMs} `
          + `autoStopMs=${autoStopMs} mode=${flashMode}`,
        );
      }
    }

    return {
      start,
      startReplyDoneFlash,
      stopReplyDoneFlash,
    };
  })();

  /********************************************************************
   * 1. ToolboxShell：统一外壳
   ********************************************************************/

