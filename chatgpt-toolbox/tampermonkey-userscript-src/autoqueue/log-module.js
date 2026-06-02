  /********************************************************************
   * 6. LogModule：工具箱日志
   *
   * 设计原则：
   * - 记录日志与显示日志解耦
   * - 默认不渲染到 DOM，避免长任务时刷屏卡顿
   * - 日志写入内存环形缓冲区，用户主动查看时才渲染
   * - 复制功能从内存读取，不依赖 DOM
   ********************************************************************/

  const LogModule = (() => {
    const TOOLBOX_MAX_DOM_LOG_LINES = 500;
    const TOOLBOX_MAX_MEMORY_LOG_LINES = 1000;
    const TOOLBOX_MAX_LOG_TEXT_LEN = 3000;
    // 默认显示条数
    const DEFAULT_LOG_RENDER_LIMIT = 100;

    const state = {
      lines: [],
      visible: false,
      renderLimit: DEFAULT_LOG_RENDER_LIMIT,
    };

    let mounted = false;
    let rootEl = null;
    let listEl = null;
    let toggleBtnEl = null;
    const logBuffer = [];
    const logTimers = createTimerRegistry('LOG');
    let logDomDirty = false;
    let renderScheduled = false;
    let errorLogCountRefreshTimer = 0;
    let cachedErrorLogCount = 0;
    let errorLogCountDirty = true;
    let lastErrorLogCountComputeAt = 0;

    const COPY_ERROR_LOG_BUTTON_SELECTOR = '#cgpt-log-copy-errors, #cgpt-autoq-copy-errors, [data-action="copy-error-log"], .cgpt-log-copy-errors-btn';

    function collectCopyErrorLogButtons(root) {
      const scopes = [];
      const seen = new Set();
      const buttons = [];
      if (root && typeof root.querySelectorAll === 'function') {
        scopes.push(root);
      }
      if (rootEl && rootEl !== root && typeof rootEl.querySelectorAll === 'function') {
        scopes.push(rootEl);
      }
      if (typeof document !== 'undefined' && document && typeof document.querySelectorAll === 'function') {
        scopes.push(document);
      }
      scopes.forEach((scope) => {
        scope.querySelectorAll(COPY_ERROR_LOG_BUTTON_SELECTOR).forEach((btn) => {
          if (!(btn instanceof HTMLButtonElement)) {
            return;
          }
          if (seen.has(btn)) {
            return;
          }
          seen.add(btn);
          buttons.push(btn);
        });
      });
      return buttons;
    }

    function applyCopyErrorLogButtonCount(btn, count) {
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
      btn.textContent = `复制错误日志（${count}）`;
      btn.title = `复制错误日志，共 ${count} 条`;
      btn.dataset.errorLogCount = String(count);
    }

    function renderCopyErrorLogButtonHtml(options = {}) {
      const id = String(options.id || 'cgpt-log-copy-errors').trim() || 'cgpt-log-copy-errors';
      const extraClass = String(options.extraClass || '').trim();
      const action = String(options.action || 'copy-error-log').trim() || 'copy-error-log';
      const buttonRole = String(options.buttonRole || 'copy-error-log').trim() || 'copy-error-log';
      const source = String(options.source || 'log-tab').trim() || 'log-tab';
      const className = `cgpt-btn cgpt-log-copy-errors-btn${extraClass ? ` ${extraClass}` : ''}`;
      return [
        '<button type="button"',
        ` class="${escapeHtml(className)}"`,
        ` id="${escapeHtml(id)}"`,
        ` data-action="${escapeHtml(action)}"`,
        ` data-button-role="${escapeHtml(buttonRole)}"`,
        ` data-copy-error-log-source="${escapeHtml(source)}"`,
        ' title="复制错误日志，共 0 条"',
        '>复制错误日志（0）</button>',
      ].join('');
    }

    function markErrorLogCountDirty() {
      errorLogCountDirty = true;
    }

    function shouldRefreshErrorLogCountNow() {
      return collectCopyErrorLogButtons(document).some((btn) => btn.isConnected);
    }

    function setLogStatus(text, type, options = {}) {
      if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.setStatus !== 'function') {
        return;
      }
      ToolboxShell.setStatus(text, type, {
        ...options,
        owner: options.owner || 'logger',
      });
    }

    function normalizeToolboxLogText(text) {
      const raw = String(text || '');
      if (raw.length <= TOOLBOX_MAX_LOG_TEXT_LEN) {
        return raw;
      }
      return `${raw.slice(0, TOOLBOX_MAX_LOG_TEXT_LEN)} ...[truncated ${raw.length - TOOLBOX_MAX_LOG_TEXT_LEN}]`;
    }

    async function copyAllLogs(source = 'log-module') {
      flushLogBufferSync();
      const text = state.lines.length > 0
        ? state.lines.join('\n')
        : '暂无日志。';
      const ok = await copyWithStatus({
        text,
        successText: `已复制日志（${state.lines.length} 条）`,
        failedPrefix: '复制日志失败',
        logPrefix: 'LOG_COPY',
        emptyText: '暂无日志',
        playSuccessBeep: false,
        statusOwner: 'logger',
      });
      ToolboxShell.appendLog(
        `[LOG_COPY][${ok ? 'ok' : 'failed'}] source=${String(source || '-')} lines=${state.lines.length} chars=${text.length}`,
      );
      return ok;
    }

    async function runCopyToolboxLogWithFeedback(source = 'log-module', button = null) {
      const src = String(source || 'log-module').trim() || 'log-module';
      const idleText = '复制日志';
      const btn = typeof setShortActionButtonBusy === 'function'
        ? setShortActionButtonBusy(button, '复制中', {
          action: 'copy-log',
          selector: '#cgpt-copy-toolbox-log',
          idleText,
        })
        : (button instanceof HTMLElement ? button : null);

      ToolboxShell.appendLog(`[COPY_LOG][START] source=${src}`);

      if (!btn && typeof document !== 'undefined') {
        const fallbackBtn = document.querySelector('#cgpt-copy-toolbox-log');
        if (fallbackBtn instanceof HTMLElement && typeof setShortActionButtonBusy === 'function') {
          setShortActionButtonBusy(fallbackBtn, '复制中', {
            action: 'copy-log',
            idleText,
          });
        }
      }

      const activeBtn = btn instanceof HTMLElement
        ? btn
        : (typeof document !== 'undefined'
          ? document.querySelector('#cgpt-copy-toolbox-log')
          : null);

      try {
        const ok = await copyAllLogs(src);
        if (ok) {
          if (activeBtn instanceof HTMLElement) {
            activeBtn.classList.remove('cgpt-btn-busy');
            activeBtn.textContent = '已复制';
            if (typeof scheduleRestoreShortActionButton === 'function') {
              scheduleRestoreShortActionButton(activeBtn, 800, { idleText });
            } else if (typeof restoreShortActionButton === 'function') {
              window.setTimeout(() => restoreShortActionButton(activeBtn, { idleText }), 800);
            }
          }
          ToolboxShell.appendLog(`[COPY_LOG][ok] source=${src}`);
          return true;
        }

        if (activeBtn instanceof HTMLElement) {
          activeBtn.textContent = '复制失败';
          activeBtn.classList.add('cgpt-btn-failed');
          if (typeof scheduleRestoreShortActionButton === 'function') {
            scheduleRestoreShortActionButton(activeBtn, 1200, { idleText });
          } else if (typeof restoreShortActionButton === 'function') {
            window.setTimeout(() => restoreShortActionButton(activeBtn, { idleText }), 1200);
          }
        }
        ToolboxShell.appendLog(`[COPY_LOG][failed] source=${src} reason=copy-returned-false`);
        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[COPY_LOG][failed]', err);
        setLogStatus(`复制日志失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[COPY_LOG][failed] source=${src} error=${errText}`);
        if (activeBtn instanceof HTMLElement) {
          activeBtn.textContent = '复制失败';
          activeBtn.classList.add('cgpt-btn-failed');
          if (typeof scheduleRestoreShortActionButton === 'function') {
            scheduleRestoreShortActionButton(activeBtn, 1200, { idleText });
          } else if (typeof restoreShortActionButton === 'function') {
            window.setTimeout(() => restoreShortActionButton(activeBtn, { idleText }), 1200);
          }
        }
        return false;
      }
    }

    function handleCopyToolboxLog(source = 'log-module', button = null) {
      void runCopyToolboxLogWithFeedback(source, button).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] copy log failed', err);
        setLogStatus(`复制日志失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[LOG_COPY][failed] source=${String(source || '-')} error=${errText}`);
      });
    }

    function invokeCopyToolboxLog(source = 'manual', button = null) {
      const logModule = globalThis.__CGPT_TOOLBOX_LOG_MODULE__;
      if (!logModule || typeof logModule.copyAllLogs !== 'function') {
        const msg = '日志模块未就绪，无法复制日志';
        console.error('[ChatGPT toolbox] copy log skipped: LogModule not ready');
        setLogStatus(msg, 'warn');
        ToolboxShell.appendLog(`[LOG_COPY][skip] source=${String(source || '-')} reason=log_module_not_ready`);
        return false;
      }
      if (typeof logModule.runCopyToolboxLogWithFeedback === 'function') {
        void logModule.runCopyToolboxLogWithFeedback(source, button).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] copy log failed', err);
          setLogStatus(`复制日志失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[LOG_COPY][failed] source=${String(source || '-')} error=${errText}`);
        });
        return true;
      }
      if (typeof logModule.handleCopyToolboxLog === 'function') {
        logModule.handleCopyToolboxLog(source, button);
        return true;
      }
      void logModule.copyAllLogs(source).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] copy log failed', err);
        setLogStatus(`复制日志失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[LOG_COPY][failed] source=${String(source || '-')} error=${errText}`);
      });
      return true;
    }

    function bindLogCopy(root) {
      bindClick(root, '#cgpt-log-copy', (event, el) => {
        const btn = el instanceof HTMLElement
          ? el
          : (event && event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
        handleCopyToolboxLog('log-tab-button', btn);
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
        MemoryManager.remove(MemoryManager.KEYS.logPersistEnabled);
        MemoryManager.remove(MemoryManager.KEYS.logPersistLines);
        logDomDirty = false;
        render();
        updateCopyErrorLogButtonCount(root);
        setLogStatus('已清空日志');
      }, {
        moduleName: 'LogModule',
        bindMissingConsole: '[ChatGPT toolbox] LogModule.bindEvents: 缺少 #cgpt-log-clear',
        bindMissingLog: '[LOG][bind-missing] #cgpt-log-clear',
      });
    }

    function bindLogToggle(root) {
      toggleBtnEl = qs('#cgpt-log-toggle', root);
      if (!toggleBtnEl) return;

      bindOnce(toggleBtnEl, 'click', () => {
        state.visible = !state.visible;
        updateToggleBtn();
        render();
        updateCopyErrorLogButtonCount(root);
      });
    }

    function updateToggleBtn() {
      if (!toggleBtnEl) return;

      toggleBtnEl.textContent = state.visible ? '隐藏日志' : '显示最近日志';
    }

    const COPY_ERROR_REAL_EXCEPTION_RE = /typeerror|referenceerror|syntaxerror|uncaught|stack=|\[error\]|\[failed\]|error=/i;

    const COPY_ERROR_CAPABILITY_NOISE_REASONS = [
      'home_new_chat_payload_but_send_button_missing',
      'send_button_missing',
      'payload_ready_but_send_button_missing',
      'attachment_ready_but_send_button_missing',
    ];

    function lineHasRealExceptionSignal(line) {
      return COPY_ERROR_REAL_EXCEPTION_RE.test(String(line || ''));
    }

    function isStateOverrideNoiseLogLine(line) {
      const text = String(line || '');
      if (text.includes('[BRIDGE][STATE_OVERRIDE]')) return true;
      if (text.includes('[TOOLBOX_TOP_STATUS][STATE_OVERRIDE]')) return true;
      if (text.includes('[COMPOSER][BUSY_OVERRIDE]')) return true;
      return false;
    }

    function isCapabilityNoiseReasonLogLine(line) {
      const lower = String(line || '').toLowerCase();
      const hitsNoiseReason = COPY_ERROR_CAPABILITY_NOISE_REASONS.some((reason) => lower.includes(reason));
      if (!hitsNoiseReason) {
        return false;
      }
      return !lineHasRealExceptionSignal(line);
    }

    function isRealToolboxErrorLogLine(line) {
      const text = String(line || '').trim();
      if (!text) {
        return false;
      }

      if (
        text.includes('[BUTTON_CLASS_CLEANUP]')
        || text.includes('[BUTTON_COLOR]')
        || text.includes('[BUTTON_VIEW][APPLY]')
        || text.includes('removed=cgpt-btn-danger')
        || (text.includes('removed=') && text.includes('cgpt-btn-failed'))
      ) {
        return false;
      }

      if (
        text.includes('[TOOLBOX_TOP_ALERT][SHOW]')
        && (
          text.includes('level=error')
          || text.includes('text=报错')
        )
      ) {
        return true;
      }

      if (
        /\[(ERROR|FAILED|EXCEPTION|FATAL)\]/i.test(text)
        || /\]\[(ERROR|FAILED|EXCEPTION|FATAL)\]/i.test(text)
        || /\b(ReferenceError|TypeError|SyntaxError|RangeError|UnhandledPromiseRejection)\b/.test(text)
        || /\berror=/.test(text)
        || text.includes('启动失败')
        || text.includes('报错')
      ) {
        return true;
      }

      return false;
    }

    function isCopyableErrorLogLine(line) {
      const text = String(line || '');
      if (!text.trim()) {
        return false;
      }
      if (isStateOverrideNoiseLogLine(text)) {
        return false;
      }
      if (isCapabilityNoiseReasonLogLine(text)) {
        return false;
      }

      return isRealToolboxErrorLogLine(text);
    }

    function collectCopyableErrorLogLines() {
      flushLogBufferSync();
      return state.lines.filter((line) => isCopyableErrorLogLine(line));
    }

    function getErrorLogCount() {
      const now = Date.now();
      if (!errorLogCountDirty && now - lastErrorLogCountComputeAt < 5000) {
        return cachedErrorLogCount;
      }
      const lines = collectCopyableErrorLogLines();
      cachedErrorLogCount = lines.length;
      errorLogCountDirty = false;
      lastErrorLogCountComputeAt = now;
      return cachedErrorLogCount;
    }

    function updateCopyErrorLogButtonCount(root) {
      const count = getErrorLogCount();
      collectCopyErrorLogButtons(root || document).forEach((btn) => {
        applyCopyErrorLogButtonCount(btn, count);
      });
    }

    function scheduleUpdateCopyErrorLogButtonCount(root) {
      if (errorLogCountRefreshTimer) {
        clearTimeout(errorLogCountRefreshTimer);
      }
      errorLogCountRefreshTimer = setTimeout(() => {
        errorLogCountRefreshTimer = 0;
        updateCopyErrorLogButtonCount(root);
      }, 80);
    }

    async function copyErrorLogs(source = 'log-module') {
      flushLogBufferSync();
      updateCopyErrorLogButtonCount(document);
      const errorLines = collectCopyableErrorLogLines();
      const text = errorLines.length > 0
        ? errorLines.join('\n')
        : '未发现错误日志。';
      const ok = await copyWithStatus({
        text,
        successText: `已复制错误日志（${errorLines.length} 条）`,
        failedPrefix: '复制错误日志失败',
        logPrefix: 'LOG_COPY_ERRORS',
        emptyText: '未发现错误日志',
        playSuccessBeep: false,
        statusOwner: 'logger',
      });
      ToolboxShell.appendLog(
        `[LOG_COPY_ERRORS][${ok ? 'ok' : 'failed'}] source=${String(source || '-')} lines=${errorLines.length} chars=${text.length}`,
      );
      updateCopyErrorLogButtonCount(document);
      return ok;
    }

    function handleCopyErrorLogs(source = 'log-module') {
      void copyErrorLogs(source).catch((err) => {
        const errText = err && err.stack ? err.stack : String(err);
        console.error('[ChatGPT toolbox] copy error logs failed', err);
        setLogStatus(`复制错误日志失败：${err && err.message ? err.message : String(err)}`, 'error');
        ToolboxShell.appendLog(`[LOG_COPY_ERRORS][failed] source=${String(source || '-')} error=${errText}`);
      });
    }

    function invokeCopyErrorLogs(source = 'manual') {
      const logModule = globalThis.__CGPT_TOOLBOX_LOG_MODULE__;
      if (!logModule || typeof logModule.copyErrorLogs !== 'function') {
        const msg = '日志模块未就绪，无法复制错误日志';
        console.error('[ChatGPT toolbox] copy error logs skipped: LogModule not ready');
        setLogStatus(msg, 'warn');
        ToolboxShell.appendLog(`[LOG_COPY_ERRORS][skip] source=${String(source || '-')} reason=log_module_not_ready`);
        return false;
      }
      if (typeof logModule.handleCopyErrorLogs === 'function') {
        logModule.handleCopyErrorLogs(source);
        return true;
      }
      void logModule.copyErrorLogs(source).catch((err) => {
        const errText = err && err.stack ? err.stack : String(err);
        console.error('[ChatGPT toolbox] copy error logs failed', err);
        setLogStatus(`复制错误日志失败：${err && err.message ? err.message : String(err)}`, 'error');
        ToolboxShell.appendLog(`[LOG_COPY_ERRORS][failed] source=${String(source || '-')} error=${errText}`);
      });
      return true;
    }

    function bindLogCopyErrors(root) {
      bindClick(root, COPY_ERROR_LOG_BUTTON_SELECTOR, (event, el) => {
        const source = el && el.dataset && el.dataset.copyErrorLogSource
          ? el.dataset.copyErrorLogSource
          : 'log-tab-button';
        handleCopyErrorLogs(source);
      }, {
        moduleName: 'LogModule',
        bindMissingConsole: '[ChatGPT toolbox] LogModule.bindEvents: 缺少复制错误日志按钮',
        bindMissingLog: '[LOG][bind-missing] copy-error-log-button',
        key: 'click:copy-error-log-buttons',
      });
    }

    function bindEvents(root) {
      bindLogCopy(root);
      bindLogClear(root);
      bindLogToggle(root);
      bindLogCopyErrors(root);
    }

    const LOG_MODULE_HTML = `
        <div class="cgpt-log-panel">
          <div class="cgpt-log-actions">
            <button type="button" class="cgpt-btn" id="cgpt-log-copy">复制日志</button>
            ${renderCopyErrorLogButtonHtml({
              id: 'cgpt-log-copy-errors',
              source: 'log-tab-button',
            })}
            <button type="button" class="cgpt-btn" id="cgpt-log-toggle" data-dynamic-label-allowed="1">显示最近日志</button>
            <button type="button" class="cgpt-btn danger cgpt-log-clear-right" id="cgpt-log-clear">清空日志</button>
          </div>
          <div class="cgpt-log-list" id="cgpt-log-list" style="display:none;"></div>
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
          rootEl = mountedRoot;
          const logRefs = collectDomRefs(mountedRoot, {
            list: '#cgpt-log-list',
            toggle: '#cgpt-log-toggle',
          }, {
            moduleName: 'LOG',
          });
          listEl = logRefs.list;
          toggleBtnEl = logRefs.toggle;
          MemoryManager.remove(MemoryManager.KEYS.logPersistEnabled);
          MemoryManager.remove(MemoryManager.KEYS.logPersistLines);
          updateToggleBtn();
          updateCopyErrorLogButtonCount(mountedRoot);
        },
        onBind: (mountedRoot) => {
          bindEvents(mountedRoot);
        },
        onRender: () => {
          // 初始化时不渲染日志内容
          render();
          updateCopyErrorLogButtonCount(rootEl);
        },
      });
    }

    function isLogTabVisible() {
      return typeof ToolboxShell.getActiveTab === 'function'
        && ToolboxShell.getActiveTab() === 'log';
    }

    function flushLogBufferSync() {
      logTimers.clearTimeout('log-flush');

      if (!logBuffer.length) {
        return;
      }

      const batch = logBuffer.splice(0, logBuffer.length);

      batch.forEach((text) => {
        const line = `[${nowTimeText()}] ${normalizeToolboxLogText(text)}`;
        state.lines.unshift(line);
      });

      if (state.lines.length > TOOLBOX_MAX_MEMORY_LOG_LINES) {
        state.lines.length = TOOLBOX_MAX_MEMORY_LOG_LINES;
      }

      logDomDirty = true;
      markErrorLogCountDirty();
      if (shouldRefreshErrorLogCountNow()) {
        scheduleUpdateCopyErrorLogButtonCount(rootEl);
      }
    }

    function flushLogBuffer() {
      flushLogBufferSync();

      if (mounted && state.visible && isLogTabVisible()) {
        scheduleRender();
      }
    }

    function scheduleRender() {
      if (renderScheduled) return;

      renderScheduled = true;
      logTimers.timeout('render', () => {
        renderScheduled = false;
        render();
      }, 400);
    }

    function flushDomIfNeeded() {
      if (!logDomDirty || !mounted) {
        return;
      }

      if (logTimers.has('log-flush')) {
        return;
      }

      if (state.visible) {
        scheduleRender();
      }
    }

    function add(text) {
      logBuffer.push(normalizeToolboxLogText(text));

      if (logBuffer.length > TOOLBOX_MAX_DOM_LOG_LINES) {
        logBuffer.splice(0, logBuffer.length - TOOLBOX_MAX_DOM_LOG_LINES);
      }

      if (!logTimers.has('log-flush')) {
        logTimers.timeout('log-flush', flushLogBuffer, 200);
      }

      markErrorLogCountDirty();
      if (shouldRefreshErrorLogCountNow()) {
        scheduleUpdateCopyErrorLogButtonCount(rootEl);
      }
    }

    function render() {
      if (!listEl) return;

      // 隐藏状态：不渲染日志内容
      if (!state.visible) {
        listEl.style.display = 'none';
        updateCopyErrorLogButtonCount(rootEl);
        return;
      }

      // 显示状态：渲染最近 N 条日志
      listEl.style.display = 'block';

      if (!state.lines.length) {
        listEl.innerHTML = renderEmptyState('暂无日志', 'cgpt-log-empty cgpt-empty-state');
        updateCopyErrorLogButtonCount(rootEl);
        return;
      }

      const recentLines = state.lines.slice(
        0,
        Math.min(state.renderLimit, TOOLBOX_MAX_DOM_LOG_LINES, 100),
      );
      listEl.innerHTML = recentLines
        .map((line) => `<div class="cgpt-log-line">${escapeHtml(line)}</div>`)
        .join('');

      logDomDirty = false;
      updateCopyErrorLogButtonCount(rootEl);
    }

    return {
      mount,
      add,
      flushDomIfNeeded,
      copyAllLogs,
      runCopyToolboxLogWithFeedback,
      handleCopyToolboxLog,
      invokeCopyToolboxLog,
      copyErrorLogs,
      handleCopyErrorLogs,
      invokeCopyErrorLogs,
      updateCopyErrorLogButtonCount,
      renderCopyErrorLogButtonHtml,
    };
  })();

  globalThis.__CGPT_TOOLBOX_LOG_MODULE__ = LogModule;
