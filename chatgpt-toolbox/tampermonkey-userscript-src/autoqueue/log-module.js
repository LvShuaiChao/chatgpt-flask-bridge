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
    // 持久化存储上限
    const PERSIST_MAX_LINES = 300;

    const state = {
      lines: [],
      visible: false,
      renderLimit: DEFAULT_LOG_RENDER_LIMIT,
    };

    let mounted = false;
    let listEl = null;
    let hintEl = null;
    let toggleBtnEl = null;
    const logBuffer = [];
    const logTimers = createTimerRegistry('LOG');
    let logDomDirty = false;
    let renderScheduled = false;

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

    function isLogPersistEnabled() {
      return !!MemoryManager.get(MemoryManager.KEYS.logPersistEnabled, false);
    }

    function persistLogLines() {
      if (!isLogPersistEnabled()) return;

      MemoryManager.set(MemoryManager.KEYS.logPersistLines, state.lines.slice(0, PERSIST_MAX_LINES));
    }

    function loadPersistedLogLines() {
      if (!isLogPersistEnabled()) return;

      const lines = MemoryManager.get(MemoryManager.KEYS.logPersistLines, []);

      if (Array.isArray(lines)) {
        state.lines = lines.slice(0, PERSIST_MAX_LINES);
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

    function bindLogCopy(root) {
      bindClick(root, '#cgpt-log-copy', () => {
        void copyAllLogs('log-tab-button').catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] copy log failed', err);
          setLogStatus(`复制日志失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[LOG_COPY][failed] source=log-tab-button error=${errText}`);
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

      const lower = text.toLowerCase();
      const errorKeywords = [
        'error', 'warn', 'failed', 'fail', 'exception', 'traceback',
        '失败', '错误', '异常', '超时', 'timeout', 'unauthorized',
        'forbidden', 'not found', 'undefined', 'null',
      ];

      return errorKeywords.some((kw) => lower.includes(kw));
    }

    function bindLogCopyErrors(root) {
      bindClick(root, '#cgpt-log-copy-errors', () => {
        flushLogBufferSync();

        const errorLines = state.lines.filter((line) => isCopyableErrorLogLine(line));

        const text = errorLines.length > 0
          ? errorLines.join('\n')
          : '未发现错误日志。';

        void copyWithStatus({
          text,
          successText: `已复制错误日志（${errorLines.length} 条）`,
          failedPrefix: '复制错误日志失败',
          logPrefix: 'LOG_COPY_ERRORS',
          emptyText: '未发现错误日志',
          playSuccessBeep: false,
          statusOwner: 'logger',
        });
      }, {
        moduleName: 'LogModule',
        bindMissingConsole: '[ChatGPT toolbox] LogModule.bindEvents: 缺少 #cgpt-log-copy-errors',
        bindMissingLog: '[LOG][bind-missing] #cgpt-log-copy-errors',
      });
    }

    function bindEvents(root) {
      bindLogPersist(root);
      bindLogCopy(root);
      bindLogClear(root);
      bindLogToggle(root);
      bindLogCopyErrors(root);
    }

    const LOG_MODULE_HTML = `
        <div class="cgpt-log-panel">
          <div class="cgpt-log-actions">
            <button type="button" class="cgpt-btn" id="cgpt-log-copy">复制日志</button>
            <button type="button" class="cgpt-btn" id="cgpt-log-toggle">显示最近日志</button>
            <button type="button" class="cgpt-btn" id="cgpt-log-copy-errors">复制错误日志</button>
            <button type="button" class="cgpt-btn danger cgpt-log-clear-right" id="cgpt-log-clear">清空日志</button>
          </div>
          <label class="cgpt-checkbox-line cgpt-log-advanced" style="margin:6px 0 0;">
            <input type="checkbox" id="cgpt-log-persist">
            刷新后保留日志（默认关闭）
          </label>
          <div class="cgpt-log-hint" id="cgpt-log-hint" style="padding:12px 8px;color:#94a3b8;font-size:12px;line-height:1.6;">
            日志已在后台记录，默认不实时显示以避免卡顿。需要查看时点击"显示最近日志"，需要排查时点击"复制日志"。
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
          const logRefs = collectDomRefs(mountedRoot, {
            list: '#cgpt-log-list',
            hint: '#cgpt-log-hint',
            toggle: '#cgpt-log-toggle',
            persist: {
              selector: '#cgpt-log-persist',
              required: false,
            },
          }, {
            moduleName: 'LOG',
          });
          listEl = logRefs.list;
          hintEl = logRefs.hint;
          toggleBtnEl = logRefs.toggle;
          if (logRefs.persist) {
            logRefs.persist.checked = isLogPersistEnabled();
          }
          loadPersistedLogLines();
          updateToggleBtn();
        },
        onBind: (mountedRoot) => {
          bindEvents(mountedRoot);
        },
        onRender: () => {
          // 初始化时不渲染日志内容，只显示提示
          render();
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
      persistLogLines();
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
    }

    function render() {
      if (!listEl || !hintEl) return;

      // 隐藏状态：只显示提示，不渲染日志内容
      if (!state.visible) {
        listEl.style.display = 'none';
        hintEl.style.display = 'block';
        return;
      }

      // 显示状态：渲染最近 N 条日志
      hintEl.style.display = 'none';
      listEl.style.display = 'block';

      if (!state.lines.length) {
        listEl.innerHTML = renderEmptyState('暂无日志', 'cgpt-log-empty cgpt-empty-state');
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
    }

    return {
      mount,
      add,
      flushDomIfNeeded,
      copyAllLogs,
    };
  })();

  globalThis.__CGPT_TOOLBOX_LOG_MODULE__ = LogModule;
