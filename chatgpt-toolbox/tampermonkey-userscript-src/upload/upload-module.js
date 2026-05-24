  /********************************************************************
   * 3. UploadModule：多文件上传模块
   ********************************************************************/

  const UploadModule = (() => {
    const DEFAULT_UPLOAD_GROUP_NAME = '默认组';
    const UPLOAD_PROJECT_NAME_KEY_MAP = Object.freeze({
      '浏览器': 'browser',
      '闲鱼': 'xianyu',
      '油猴flask': 'youhou-flask',
      '油猴上传': 'youhou-upload',
      'cursor插件': 'cursor-plugin',
    });
    const UPLOAD_DB_MAX_GROUPS = 50;
    const UPLOAD_DB_MAX_QUEUE_ROWS = 1000;
    const UPLOAD_DB_EMPTY_GROUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const UPLOAD_DB_FAILED_ROW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    const SEND_STABLE_RETRY_LIMIT = 30;
    const SEND_STABLE_RETRY_INTERVAL_MS = 300;
    const SEND_WAIT_TIMEOUT_MS = SEND_STABLE_RETRY_LIMIT * SEND_STABLE_RETRY_INTERVAL_MS;
    const PRE_SEND_OPPORTUNITY_POLL_MS = 350;
    const COPY_CONTINUE_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
    const COPY_CONTINUE_STABLE_ROUNDS = 2;
    const COPY_CONTINUE_STABLE_INTERVAL_MS = 350;
    /** 点击常用 Prompt 后是否自动发送（false 时仅填入输入框）。 */
    const QUICK_PROMPT_CLICK_AUTO_SEND = true;
    const QUICK_PROMPT_WRITE_SETTLE_MS = 120;

    const UPLOAD_DROP_HANDLED_PROP = '__cgptToolboxUploadDropHandledV1';
    let lastDropSignature = '';
    let lastDropSignatureAt = 0;

    const state = {
      groups: [],
      activeGroupId: '',
      selectedFileIdByGroup: {},
      queue: [],
      groupCounts: null,
      flaskFiles: [],
      running: false,
      cancelled: false,
      activeId: '',
      observer: null,
      uploadAbortController: null,
      uploadCancelRequested: false,
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
      waitingReply: false,
      waitingReplyRunId: null,
      waitingReplyCheckedAt: 0,
      waitingReplyTimer: null,
      pendingSendAfterReply: false,
      pendingSendAfterReplySource: '',
      pendingSendRetrying: false,
      replyWaitSawBusy: false,
      replyWaitAssistantCountBefore: 0,
      uploadSendFailureHint: '',
      uploadSendFailureHintAt: 0,
    };

    let host = null;
    let listEl = null;
    let groupListEl = null;
    let startBtn = null;
    let rootElRef = null;
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
    let uploadGroupsInitResolved = false;
    const uploadTimers = createTimerRegistry('UPLOAD');
    let quickPromptRenderSignature = '';
    let persistQueueThrottleTimer = 0;
    let persistQueuePendingStage = '';
    let uploadSendShortcutBound = false;
    let uploadSendShortcutLastAt = 0;
    let uploadSendShortcutRunning = false;
    let uploadSendTaskStartedAt = 0;
    let waitingReplyIdleStreak = 0;
    let uploadShortcutDebugLastAt = 0;
    let copyLastMessageShortcutBound = false;
    let copyLastMessageShortcutLastAt = 0;
    let copyLastMessageShortcutRunning = false;
    let shortcutWindowFallbackBound = false;
    let shortcutDebugLastAt = 0;
    let copyLastMessageTaskRunning = false;
    let copyLastMessageTaskSource = '';
    let copyLastMessageTaskStartedAt = 0;
    let copyLastMessageTaskStatus = '';
    let copyLastReplyTaskRunning = false;
    let copyLastReplyTaskStartedAt = 0;
    let copyLastReplyTaskStatus = '';
    let copyLastMessageWaiting = false;
    let copyLastMessageWaitRunId = 0;
    let copyContinueTaskRunning = false;
    let copyTaskStatus = 'idle';
    let copyContinueTaskStartedAt = 0;
    let copyHotkeyOnceTaskRunning = false;
    let copyHotkeyOnceTaskStartedAt = 0;
    let copyHotkeyContinueTaskRunning = false;
    let copyHotkeyContinueTaskStartedAt = 0;
    let copyHotkeyContinueLoopRunning = false;
    let copyHotkeyContinueLoopStopRequested = false;
    let copyHotkeyContinueLoopCount = 0;
    let copyHotkeyContinueLoopStartedAt = 0;
    const DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL = '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';
    let uploadUiActionLastKey = '';
    let uploadUiActionLastAt = 0;
    let quickPromptActiveCategory = '全部';
    let lastManualUploadGroupAt = 0;

    function getDefaultCopyHotkeyContinuePromptText() {
      if (typeof getDefaultTaskContinuePromptText === 'function') {
        return getDefaultTaskContinuePromptText();
      }
      if (typeof getDefaultContinuePromptText === 'function') {
        return getDefaultContinuePromptText();
      }
      return '请继续完成上一个任务。';
    }

    function formatContinuePromptPreview(text, maxLen = 160) {
      const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
      if (normalized.length <= maxLen) {
        return normalized;
      }
      return `${normalized.slice(0, maxLen)}...`;
    }

    function getCopyHotkeyContinueStopSignal(options = {}) {
      const override = String(options.doneSignal || '').trim();
      if (override) {
        return override;
      }

      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      let signal = String(
        cfg.copyHotkeyContinueStopSignal || DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL,
      ).trim();

      if (LEGACY_ASSISTANT_DONE_SIGNAL_LITERALS.includes(signal)) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[AUTOQ][TASK_SIGNAL][MIGRATE] from=${signal} to=${DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL}`,
          );
        }
        signal = DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL;
      }

      return signal || DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL;
    }

    function getCopyHotkeyContinuePromptText(options = {}) {
      const overridePrompt = String(options.continuePrompt || '').trim();
      if (overridePrompt) {
        return overridePrompt;
      }

      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      const signal = getCopyHotkeyContinueStopSignal(options);

      let text = String(cfg.copyHotkeyContinuePromptText || '').trim();

      if (!text) {
        text = getDefaultCopyHotkeyContinuePromptText();
      }

      if (typeof renderContinuePromptTemplate === 'function') {
        return renderContinuePromptTemplate(text, signal);
      }

      if (!text.includes(signal)) {
        text = [
          text,
          '',
          '如果任务已经完整完成，只能回复下面这一行，不能有任何其他文字：',
          '',
          signal,
        ].join('\n');
      }

      return text;
    }

    const LEGACY_ASSISTANT_DONE_SIGNAL_LITERALS = Object.freeze([
      'CHATGPT_TOOLBOX_DONE',
      '__CHATGPT_TOOLBOX_DONE__',
      '<<<CHATGPT_TOOLBOX_DONE>>>',
      '<<<TASK_DONE>>>',
      'TASK_DONE',
    ]);

    function uploadAnalyzeAssistantDoneSignalText(text, options = {}) {
      const configuredStopSignal = getCopyHotkeyContinueStopSignal(options);
      if (typeof analyzeAssistantDoneSignalText === 'function') {
        return analyzeAssistantDoneSignalText(text, {
          ...options,
          doneSignal: configuredStopSignal,
        });
      }
      console.error(
        '[UPLOAD][done-signal] analyzeAssistantDoneSignalText missing; '
        + 'fallback=hasAssistantDoneSignalInText',
      );
      const matched = typeof hasAssistantDoneSignalInText === 'function'
        ? hasAssistantDoneSignalInText(text, { doneSignal: configuredStopSignal })
        : false;
      return {
        matched,
        corrupted: false,
        lineCount: 0,
        configuredStopSignal,
        allowedSignals: configuredStopSignal ? [configuredStopSignal] : [],
        reason: 'analyzeAssistantDoneSignalText-missing',
      };
    }

    function formatDoneSignalPreview(text) {
      const preview = String(text || '').replace(/\r\n/g, '\n').trim();
      if (preview.length <= 120) {
        return preview;
      }
      return `${preview.slice(0, 120)}...`;
    }

    function logAssistantDoneSignalCheck(logPrefix, text, phase, extraFields, options = {}) {
      const analysis = uploadAnalyzeAssistantDoneSignalText(text, options);
      const rawPreview = formatDoneSignalPreview(
        String(text || '').replace(/\r\n/g, '\n').trim(),
      );
      const checkedPreview = formatDoneSignalPreview(
        cleanAssistantTextForDoneSignal(text).replace(/\r\n/g, '\n').trim(),
      );
      const extra = extraFields
        ? ` ${String(extraFields).trim()}`
        : '';
      const allowedSignalsText = (analysis.allowedSignals || []).join('|');
      const line = `[${logPrefix}][done-signal-check] phase=${phase || '-'} matched=${analysis.matched ? '1' : '0'} rawPreview=${rawPreview} checkedPreview=${checkedPreview} lineCount=${analysis.lineCount} configuredStopSignal=${analysis.configuredStopSignal} allowedSignals=${allowedSignalsText} reason=${analysis.reason}${extra}`;
      safeAppendLog(line);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
      console.warn(`[${logPrefix}][done-signal-check]`, {
        phase: phase || '-',
        matched: analysis.matched,
        rawPreview,
        checkedPreview,
        lineCount: analysis.lineCount,
        configuredStopSignal: analysis.configuredStopSignal,
        allowedSignals: analysis.allowedSignals,
        reason: analysis.reason,
      });
    }

    function hasAssistantDoneSignalInText(text, logPrefix, phase, extraFields, options = {}) {
      const matched = uploadAnalyzeAssistantDoneSignalText(text, options).matched;
      logAssistantDoneSignalCheck(logPrefix, text, phase, extraFields, options);
      return matched;
    }

    function getActiveGroupId() {
      return String(state.activeGroupId || '').trim();
    }

    function formatUploadGroupDiagFields(extra = {}) {
      const activeGroupId = getActiveGroupId();
      const groupCount = state.groups.length;
      const currentGroupFileCount = getActiveGroupFiles().length;
      const totalUploadItems = state.queue.length;
      const parts = [
        `activeGroupId=${activeGroupId || '-'}`,
        `groupCount=${groupCount}`,
        `currentGroupFileCount=${currentGroupFileCount}`,
        `totalUploadItems=${totalUploadItems}`,
      ];

      Object.keys(extra || {}).forEach((key) => {
        const value = extra[key];
        parts.push(`${key}=${value == null ? '-' : value}`);
      });

      return parts.join(' ');
    }

    function appendUploadGroupLog(tag, extra = {}) {
      if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.appendLog !== 'function') {
        return;
      }

      ToolboxShell.appendLog(`[UPLOAD_GROUP][${tag}] ${formatUploadGroupDiagFields(extra)}`);
    }

    function syncUploadGroupAppState() {
      if (typeof UploadGroupAppState === 'undefined') {
        return;
      }

      UploadGroupAppState.uploadGroups = state.groups.map((group) => ({ ...group }));
      UploadGroupAppState.activeUploadGroupId = getActiveGroupId();
      UploadGroupAppState.uploadItems = getActiveGroupFiles().map((item) => ({ ...item }));
    }

    function ensureActiveUploadGroupIdValid(reason = '') {
      if (!state.groups.length) {
        return false;
      }

      const activeGroupId = getActiveGroupId();

      if (activeGroupId && state.groups.some((group) => group.id === activeGroupId)) {
        return true;
      }

      const restored = resolveUploadGroupSelection({
        reason: reason || 'ensure-active-valid',
      });
      const fallbackGroupId = restored.resolvedGroupId || '';

      if (!fallbackGroupId) {
        console.warn('[ChatGPT toolbox] ensureActiveUploadGroupIdValid: no fallback group', {
          reason,
          previousActiveGroupId: activeGroupId || '',
        });
        return false;
      }

      console.warn('[ChatGPT toolbox] activeUploadGroupId invalid, fallback to restored group', {
        reason,
        previousActiveGroupId: activeGroupId || '',
        fallbackGroupId,
        source: restored.reason || '-',
      });

      state.activeGroupId = fallbackGroupId;
      appendUploadGroupLog('ACTIVE_FALLBACK', {
        reason: reason || '-',
        previousActiveGroupId: activeGroupId || '-',
        fallbackGroupId,
        source: restored.reason || '-',
      });
      syncUploadGroupAppState();
      return true;
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

      if (meta.skipLastSelectionSave) {
        return;
      }

      const activeGroup = getActiveGroup();
      const projectKey = getUploadGroupStableKey(activeGroup);
      if (!projectKey) {
        return;
      }

      const folderKey = file ? getUploadFileFolderKey(file) : '';
      saveMultiUploadLastSelection({
        projectKey,
        folderKey,
      });
    }

    function resolveSelectedFileIdForGroup(groupId, files) {
      const gid = String(groupId || '').trim();
      const group = state.groups.find((item) => item && item.id === gid) || null;
      const oldSelectedId = String(state.selectedFileIdByGroup[gid] || '').trim();
      if (oldSelectedId && files.some((file) => file && file.id === oldSelectedId)) {
        return oldSelectedId;
      }

      const saved = getMultiUploadLastSelection();
      const groupKey = getUploadGroupStableKey(group);
      if (saved.projectKey && groupKey && saved.projectKey === groupKey && saved.folderKey) {
        const savedFile = files.find(
          (file) => file && getUploadFileFolderKey(file) === saved.folderKey,
        );
        if (savedFile) {
          return savedFile.id;
        }

        logMultiUploadLastSelectionEvent('FOLDER_MISSING', {
          projectKey: groupKey,
          savedFolder: saved.folderKey,
          fallback: files.length ? getUploadFileFolderKey(files[0]) : '',
        });

        if (files.length > 0) {
          const fallbackFolderKey = getUploadFileFolderKey(files[0]);
          saveMultiUploadLastSelection({
            projectKey: groupKey,
            folderKey: fallbackFolderKey,
          });
          return files[0].id;
        }
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

    function saveMultiUploadSelectionForActiveGroup(options = {}) {
      const activeGroup = getActiveGroup();
      const projectKey = getUploadGroupStableKey(activeGroup);
      if (!projectKey) {
        return;
      }

      const selectedFile = getActiveGroupFiles().find(
        (item) => item && item.id === getSelectedFileIdForActiveGroup(),
      ) || null;
      const folderKey = selectedFile ? getUploadFileFolderKey(selectedFile) : '';

      saveMultiUploadLastSelection({
        projectKey,
        folderKey: options.folderKey != null ? options.folderKey : folderKey,
      });
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

    function safeAppendLog(text) {
      const line = String(text || '');
      if (!line) {
        return;
      }
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
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
        if (typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(btn, 'copy-continue-idle');
        }
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
      if (typeof startButtonLongWaitDangerTimer === 'function') {
        startButtonLongWaitDangerTimer(btn, 'long_wait_reply_or_send', BUTTON_LONG_WAIT_DANGER_MS);
      }
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
      const group = {
        id: createId('upload_group'),
        name: DEFAULT_UPLOAD_GROUP_NAME,
        key: 'default',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      return group;
    }

    function newId() {
      return createId('upload');
    }

    function isUploadUseUniqueFileNameEnabled() {
      return !!MemoryManager.get(MemoryManager.KEYS.uploadUseUniqueFileName, true);
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

      return text.includes('没有本地文件读取权限') ||
        text.includes('缺少文件，请重新拖入') ||
        text.includes('本地文件读取失败') ||
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

    function resetFlaskFilesForUpload(reason = '') {
      let changed = false;

      state.flaskFiles = (state.flaskFiles || []).map((row) => {
        if (!row) return row;

        if (row.status === 'uploaded') {
          changed = true;
          return {
            ...row,
            status: 'pending',
          };
        }

        return row;
      });

      if (changed) {
        ToolboxShell.appendLog(
          `[UPLOAD][FLASK_RESET_FOR_REUPLOAD] reason=${String(reason || '-')}`
        );
      }

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
    // 是否能重新读取本地文件，只看 fileHandle 是否存在且可 getFile

    function hasLocalReadableHandle(q) {
      return !!(
        q &&
        q.fileHandle &&
        typeof q.fileHandle.getFile === 'function'
      );
    }

        function isCachedUploadSnapshot(q) {
      // Blob persistence disabled - no cached snapshots
      return false;
    }

    function getUploadInlineStatusText(q) {
      if (!q) return '未知来源';

      if (
        q.state === UploadState.MISSING_FILE ||
        q.sourceKind === 'missing-file' ||
        q.sourceKind === 'missing-local' ||
        (!q.file && !q.fileHandle && !hasLocalReadableHandle(q))
      ) {
        return '需重新拖入';
      }

      if (q.state === UploadState.ATTACHED) {
        return '已绑定到输入框';
      }

      if (
        q.source === 'flask_local_direct'
        || q.sourceKind === 'flask_local_direct'
        || q.flask_local_direct === true
      ) {
        return '本地直读';
      }

      if (hasLocalReadableHandle(q) || q.fileHandle) {
        return '实时读取';
      }

      if (q.file) {
        return '本次选择';
      }

      return '需重新拖入';
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
        lines.push('说明：已保存本地文件句柄，刷新后可实时读取最新文件');
      } else if (isCachedUploadSnapshot(q)) {
              // lines.push('说明：这是浏览器 IndexedDB 中保存的文件快照，不是本地文件句柄；原文件变化后不会自动同步');
      } else if (q.sourceKind === 'session-file' && (q.file || q.blob)) {
              // lines.push('说明：仅当前页面内存可用，刷新后会变为需重新拖入');
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

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][persist-row:no-blob] name=${q.name || '-'} handle=${hasHandle ? 1 : 0} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'}`
      );

      return row;
    }

    async function clearPersistedUploadBlobs(reason) {
      if (!APP || !APP.uploadStore) {
        console.warn('[ChatGPT toolbox] clearPersistedUploadBlobs: APP.uploadStore not available');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][clear-persisted-blob:skip] reason=${reason || '-'} error=uploadStore-not-available`,
        );
        return;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][clear-persisted-blob:start] reason=${reason || '-'}`,
      );

      let changed = 0;

      try {
        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => {
            reject(req.error || new Error('IndexedDB uploadStore getAll failed'));
          };

          req.onsuccess = () => {
            const rows = Array.isArray(req.result) ? req.result : [];

            rows.forEach((record) => {
              if (!record) {
                return;
              }

              const hasBlob = record.blob !== null && record.blob !== undefined;

              if (hasBlob || record.blobSaved || record.blobSavedAt || record.debugSavedFrom) {
                ToolboxShell.appendLog(
                  `[UPLOAD_DIAG][clear-persisted-blob:item] name=${record.name || '-'} id=${record.id || '-'} oldBlob=${hasBlob ? 1 : 0}`,
                );

                record.blob = null;
                record.blobSaved = false;
                record.blobSavedAt = 0;
                record.debugSavedFrom = '';

                store.put(record);
                changed += 1;
              }
            });
          };

          tx.oncomplete = () => {
            resolve();
          };

          tx.onerror = () => {
            reject(tx.error || new Error('IndexedDB clearPersistedUploadBlobs transaction failed'));
          };

          tx.onabort = () => {
            reject(tx.error || new Error('IndexedDB clearPersistedUploadBlobs transaction aborted'));
          };
        });
      } catch (e) {
        console.error('[ChatGPT toolbox] clearPersistedUploadBlobs failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][clear-persisted-blob:error] reason=${reason || '-'} error=${e && e.message ? e.message : String(e)}`,
        );
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][clear-persisted-blob:done] changed=${changed}`,
      );
    }

    function isProtectedUploadGroup(group, activeGroupId) {
      const groupId = String(group && group.id ? group.id : '');
      if (!groupId || groupId === activeGroupId) {
        return true;
      }
      if (groupId === 'default' || String(group.key || '') === 'default') {
        return true;
      }
      return false;
    }

    function isStaleFailedUploadRow(row, now) {
      const stateText = String(row && row.state ? row.state : '');
      const isFailedOrMissing = (
        stateText === UploadState.FAILED
        || stateText === UploadState.MISSING_FILE
      );
      if (!isFailedOrMissing) {
        return false;
      }
      const updatedAt = Number(row.updatedAt || row.createdAt || 0);
      return updatedAt > 0 && now - updatedAt > UPLOAD_DB_FAILED_ROW_TTL_MS;
    }

    async function cleanupUploadDbGarbage(reason) {
      const now = Date.now();

      try {
        const db = await openDb();

        const { groups, rows } = await new Promise((resolve, reject) => {
          const tx = db.transaction([APP.uploadGroupStore, APP.uploadStore], 'readonly');
          const groupStore = tx.objectStore(APP.uploadGroupStore);
          const queueStore = tx.objectStore(APP.uploadStore);

          const groupReq = groupStore.getAll();
          const queueReq = queueStore.getAll();

          let groupsResult = [];
          let rowsResult = [];

          groupReq.onerror = () => {
            reject(groupReq.error || new Error('getAll groups failed'));
          };

          queueReq.onerror = () => {
            reject(queueReq.error || new Error('getAll queue failed'));
          };

          groupReq.onsuccess = () => {
            groupsResult = Array.isArray(groupReq.result) ? groupReq.result : [];
          };

          queueReq.onsuccess = () => {
            rowsResult = Array.isArray(queueReq.result) ? queueReq.result : [];
          };

          tx.oncomplete = () => {
            resolve({ groups: groupsResult, rows: rowsResult });
          };

          tx.onerror = () => {
            reject(tx.error || new Error('cleanupUploadDbGarbage read transaction failed'));
          };

          tx.onabort = () => {
            reject(tx.error || new Error('cleanupUploadDbGarbage read transaction aborted'));
          };
        });

        const activeGroupId = String(state.activeGroupId || '');
        const groupIds = new Set(
          groups.map((group) => String(group.id || '')).filter(Boolean),
        );

        const rowCountByGroup = new Map();
        rows.forEach((row) => {
          const groupId = String(row.groupId || '');
          rowCountByGroup.set(groupId, (rowCountByGroup.get(groupId) || 0) + 1);
        });

        const queueIdsToDelete = new Set();
        rows.forEach((row) => {
          const groupId = String(row.groupId || '');
          if (!groupId || !groupIds.has(groupId)) {
            queueIdsToDelete.add(row.id);
          }
        });

        rows.forEach((row) => {
          if (queueIdsToDelete.has(row.id)) {
            return;
          }
          if (isStaleFailedUploadRow(row, now)) {
            queueIdsToDelete.add(row.id);
          }
        });

        let survivingRowCount = rows.length - queueIdsToDelete.size;
        if (survivingRowCount > UPLOAD_DB_MAX_QUEUE_ROWS) {
          const overflowCandidates = rows
            .filter((row) => !queueIdsToDelete.has(row.id))
            .filter((row) => {
              const groupId = String(row.groupId || '');
              if (!groupId || !groupIds.has(groupId)) {
                return true;
              }
              return isStaleFailedUploadRow(row, now);
            })
            .sort(
              (a, b) => Number(a.updatedAt || a.createdAt || 0)
                - Number(b.updatedAt || b.createdAt || 0),
            );

          for (const row of overflowCandidates) {
            if (survivingRowCount <= UPLOAD_DB_MAX_QUEUE_ROWS) {
              break;
            }
            if (!queueIdsToDelete.has(row.id)) {
              queueIdsToDelete.add(row.id);
              survivingRowCount -= 1;
            }
          }
        }

        const groupsToDelete = new Set();
        const removableByTtl = groups
          .filter((group) => {
            const groupId = String(group.id || '');
            if (isProtectedUploadGroup(group, activeGroupId)) {
              return false;
            }
            const count = rowCountByGroup.get(groupId) || 0;
            if (count > 0) {
              return false;
            }
            const updatedAt = Number(group.updatedAt || group.createdAt || 0);
            return updatedAt > 0 && now - updatedAt > UPLOAD_DB_EMPTY_GROUP_TTL_MS;
          })
          .sort(
            (a, b) => Number(a.updatedAt || a.createdAt || 0)
              - Number(b.updatedAt || b.createdAt || 0),
          );

        removableByTtl.forEach((group) => {
          groupsToDelete.add(group.id);
        });

        let projectedGroupCount = groups.length - groupsToDelete.size;
        if (projectedGroupCount > UPLOAD_DB_MAX_GROUPS) {
          const moreEmptyGroups = groups
            .filter((group) => {
              const groupId = String(group.id || '');
              if (groupsToDelete.has(groupId) || isProtectedUploadGroup(group, activeGroupId)) {
                return false;
              }
              return (rowCountByGroup.get(groupId) || 0) === 0;
            })
            .sort(
              (a, b) => Number(a.updatedAt || a.createdAt || 0)
                - Number(b.updatedAt || b.createdAt || 0),
            );

          for (const group of moreEmptyGroups) {
            if (projectedGroupCount <= UPLOAD_DB_MAX_GROUPS) {
              break;
            }
            groupsToDelete.add(group.id);
            projectedGroupCount -= 1;
          }
        }

        if (!queueIdsToDelete.size && !groupsToDelete.size) {
          return;
        }

        await new Promise((resolve, reject) => {
          const tx = db.transaction([APP.uploadGroupStore, APP.uploadStore], 'readwrite');
          const groupStore = tx.objectStore(APP.uploadGroupStore);
          const queueStore = tx.objectStore(APP.uploadStore);

          rows.forEach((row) => {
            if (!queueIdsToDelete.has(row.id)) {
              return;
            }
            const groupId = String(row.groupId || '');
            queueStore.delete(row.id);
            const isOrphan = !groupId || !groupIds.has(groupId);
            ToolboxShell.appendLog(
              `[UPLOAD_DB_CLEANUP][${isOrphan ? 'queue_orphan_deleted' : 'queue_row_deleted'}] reason=${reason || '-'} id=${row.id || '-'} groupId=${groupId || '-'} state=${row.state || '-'}`,
            );
          });

          groups.forEach((group) => {
            if (!groupsToDelete.has(group.id)) {
              return;
            }
            groupStore.delete(group.id);
            ToolboxShell.appendLog(
              `[UPLOAD_DB_CLEANUP][empty_group_deleted] reason=${reason || '-'} groupId=${group.id || '-'} name=${group.name || '-'}`,
            );
          });

          tx.oncomplete = () => {
            resolve();
          };

          tx.onerror = () => {
            reject(tx.error || new Error('cleanupUploadDbGarbage delete transaction failed'));
          };

          tx.onabort = () => {
            reject(tx.error || new Error('cleanupUploadDbGarbage delete transaction aborted'));
          };
        });
      } catch (error) {
        console.error('[ChatGPT toolbox] cleanupUploadDbGarbage failed', error);
        ToolboxShell.appendLog(
          `[UPLOAD_DB_CLEANUP][error] reason=${reason || '-'} error=${error && error.message ? error.message : String(error)}`,
        );
      }
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
        void cleanupUploadDbGarbage('persist-queue');
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
          renderProjectCategoryChips();
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
            `[UPLOAD_GROUP][CREATE_DEFAULT_GROUP] store=${APP.uploadGroupStore} activeGroupId=${state.activeGroupId || '-'}`,
          );
          await persistGroups();
          saveCurrentToolboxBaseState('upload-default-group-created');
          ensureActiveUploadGroupIdValid('load-groups-default-created');
          syncUploadGroupAppState();
          appendUploadGroupLog('INIT', { stage: 'loadGroups:created-default' });
          void cleanupUploadDbGarbage('load-groups');
          return;
        }

        await ensureUploadGroupStableKeys();
        migrateLegacyUploadSelectionIfNeeded();

        const pageState = getToolboxPageState();
        const resolved = resolveUploadGroupSelection({
          pageState,
          reason: 'load-groups',
        });
        state.activeGroupId = resolved.resolvedGroupId || '';

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][active-resolve] pageGroup=${resolved.pageGroupId || '-'} globalGroup=${resolved.uploadLastActiveGroupId || '-'} active=${state.activeGroupId || '-'} source=${resolved.reason || '-'}`,
        );

        ensureActiveUploadGroupIdValid('load-groups');
        syncUploadGroupAppState();
        appendUploadGroupLog('INIT', { stage: 'loadGroups:ok' });
        void cleanupUploadDbGarbage('load-groups');
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

        ensureActiveUploadGroupIdValid('load-groups-failed');
        syncUploadGroupAppState();
        appendUploadGroupLog('INIT', { stage: 'loadGroups:failed-temp' });
      }
    }

    function resolveLegacyMissingGroupTargetId() {
      const resolved = resolveUploadGroupSelection({
        pageState: getToolboxPageState(),
        reason: 'legacy-missing-group',
      });
      return resolved.resolvedGroupId || '';
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

        // [DEPRECATED] Blob persistence is disabled
    function restoreBlobBackedUploadItem(item, row, restoredState) {
      console.warn('[ChatGPT toolbox] restoreBlobBackedUploadItem called but blob persistence is disabled');
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][restore-blob:deprecated] name=${item.name || '-'} id=${item.id || '-'}`
      );
      return restoreMissingUploadItem(item, restoredState);
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
      const hasBlob = false;
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
        blob: null,
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
        needsReDrag = restoreHandleBackedUploadItem(item, restoredState, false);
      } else {
        needsReDrag = restoreMissingUploadItem(item, restoredState);
      }

      console.debug('[ChatGPT toolbox] loadQueue row restore', {
        row: {
          id: row.id,
          name: row.name,
          state: row.state,
          hasHandle: !!row.handle,
        },
        item: describeUploadSource(item),
        needsReDrag,
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][restore-row] name=${item.name || '-'} blob=0 handle=${item.fileHandle ? 1 : 0} sourceKind=${item.sourceKind || '-'} readMode=${item.readMode || '-'}`,
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
        dedupeActiveGroupQueue('load-queue');
        render();
        logUploadQueueSnapshot('loadQueue:after-load');
      } catch (e) {
        console.warn('[ChatGPT toolbox] load upload queue for group failed', e);
        state.queue = [];
        dedupeActiveGroupQueue('load-queue');
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

    function normalizeUploadFolderPath(value) {
      return String(value || '')
        .replace(/\\/g, '/')
        .replace(/\/+/g, '/')
        .replace(/^\/+|\/+$/g, '')
        .trim()
        .toLowerCase();
    }

    function deriveUploadGroupStableKey(group) {
      if (!group || typeof group !== 'object') {
        return '';
      }

      const existingKey = String(group.key || '').trim();
      if (existingKey) {
        return existingKey;
      }

      const cleanName = stripTrailingCountFromGroupName(group.name || '');
      if (UPLOAD_PROJECT_NAME_KEY_MAP[cleanName]) {
        return UPLOAD_PROJECT_NAME_KEY_MAP[cleanName];
      }

      const slug = cleanName
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      if (slug) {
        return slug;
      }

      return String(group.id || '').trim();
    }

    function getUploadGroupStableKey(group) {
      return deriveUploadGroupStableKey(group);
    }

    function getUploadFileFolderKey(file) {
      if (!file || typeof file !== 'object') {
        return '';
      }

      const fileId = String(file.id || '').trim();
      if (fileId) {
        return fileId;
      }

      const normalizedPath = normalizeUploadFolderPath(
        file.displayPath || file.webkitRelativePath || file.manualPathNote || file.name || '',
      );
      return normalizedPath;
    }

    function persistCompactUiConfigPatch(patch) {
      const cfg = getCompactUiConfig();
      const next = Object.assign({}, cfg, patch || {});

      if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.saveConfig === 'function') {
        SettingsModule.saveConfig(next);
      } else {
        MemoryManager.set(
          MemoryManager.KEYS.compactUiConfig,
          normalizeCompactUiConfig(next),
        );
      }
    }

    function getMultiUploadLastSelection() {
      const cfg = getCompactUiConfig();
      const selection = cfg.multiUploadLastSelection || {};
      return {
        projectKey: typeof selection.projectKey === 'string' ? selection.projectKey : '',
        folderKey: typeof selection.folderKey === 'string' ? selection.folderKey : '',
        updatedAt: Number(selection.updatedAt) || 0,
      };
    }

    function saveMultiUploadLastSelection(next) {
      const current = getMultiUploadLastSelection();

      const projectKey = typeof next.projectKey === 'string'
        ? next.projectKey
        : current.projectKey;

      const folderKey = typeof next.folderKey === 'string'
        ? next.folderKey
        : current.folderKey;

      const savedSelection = {
        projectKey,
        folderKey,
        updatedAt: Date.now(),
      };

      persistCompactUiConfigPatch({
        multiUploadLastSelection: savedSelection,
      });

      if (projectKey && !folderKey) {
        console.info(
          '[MULTI_UPLOAD][LAST_SELECTION][SAVE_FOLDER_EMPTY]',
          { projectKey },
        );
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[MULTI_UPLOAD][LAST_SELECTION][SAVE_FOLDER_EMPTY] projectKey=${projectKey}`,
          );
        }
      }

      console.info('[MULTI_UPLOAD][LAST_SELECTION][SAVE]', savedSelection);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[MULTI_UPLOAD][LAST_SELECTION][SAVE] projectKey=${projectKey || '-'} folderKey=${folderKey || '-'}`,
        );
      }
    }

    function logMultiUploadLastSelectionEvent(tag, payload = {}) {
      const line = `[MULTI_UPLOAD][LAST_SELECTION][${tag}] ${JSON.stringify(payload)}`;
      console.info(line);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      }
    }

    async function ensureUploadGroupStableKeys() {
      let changed = false;

      state.groups.forEach((group) => {
        if (!group) {
          return;
        }

        const nextKey = deriveUploadGroupStableKey(group);
        if (group.key !== nextKey) {
          group.key = nextKey;
          group.updatedAt = Date.now();
          changed = true;
        }
      });

      if (changed) {
        await persistGroups();
      }
    }

    function migrateLegacyUploadSelectionIfNeeded() {
      const saved = getMultiUploadLastSelection();
      if (saved.projectKey) {
        return;
      }

      const legacyId = String(
        MemoryManager.get(MemoryManager.KEYS.lastManualUploadGroupId, '') || '',
      ).trim();
      if (!legacyId) {
        return;
      }

      const group = state.groups.find((item) => item && item.id === legacyId);
      if (!group) {
        return;
      }

      saveMultiUploadLastSelection({
        projectKey: getUploadGroupStableKey(group),
        folderKey: '',
      });
    }

    function isValidUploadGroupId(groupId) {
      const id = String(groupId || '').trim();
      return Boolean(id && state.groups.some((g) => g.id === id));
    }

    function resolveUploadGroupSelection(options = {}) {
      const pageState = options.pageState && typeof options.pageState === 'object'
        ? options.pageState
        : getToolboxPageState();
      const groups = Array.isArray(options.groups) ? options.groups : state.groups;
      const excludeGroupId = String(options.excludeGroupId || '').trim();

      const savedSelection = getMultiUploadLastSelection();
      const savedProjectKey = String(savedSelection.projectKey || '').trim();
      const savedFolderKey = String(savedSelection.folderKey || '').trim();

      const pageGroupId = String(readToolboxStateField(pageState, 'uploadActiveGroupId', '')).trim();
      const lastManualGroupId = getLastManualUploadGroupId();
      const uploadLastActiveGroupId = getUploadLastActiveGroupId();
      const stateActiveGroupId = String(state.activeGroupId || '').trim();
      const firstGroupId = groups[0] && groups[0].id
        ? String(groups[0].id).trim()
        : '';

      function isValidInGroups(id) {
        const trimmed = String(id || '').trim();
        return Boolean(trimmed && groups.some((g) => g && g.id === trimmed));
      }

      function findGroupIdForKey(projectKey) {
        const key = String(projectKey || '').trim();
        if (!key) return '';
        const found = groups.find((g) => g && getUploadGroupStableKey(g) === key);
        return (found && found.id) || '';
      }

      let resolvedGroupId = '';
      let reason = 'none';

      if (savedProjectKey) {
        const groupIdFromSaved = findGroupIdForKey(savedProjectKey);
        if (isValidInGroups(groupIdFromSaved) && groupIdFromSaved !== excludeGroupId) {
          resolvedGroupId = groupIdFromSaved;
          reason = 'multi-upload-last-selection';
        } else {
          if (groupIdFromSaved && groupIdFromSaved === excludeGroupId) {
            logMultiUploadLastSelectionEvent('EXCLUDE_DELETED_GROUP', {
              saved: savedProjectKey,
              excludedGroupId: excludeGroupId,
            });
            if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
              ToolboxShell.appendLog('[MULTI_UPLOAD][SELECTION][EXCLUDE_DELETED_GROUP]');
            }
          } else {
            logMultiUploadLastSelectionEvent('PROJECT_MISSING', {
              saved: savedProjectKey,
            });
          }
        }
      }

      if (!resolvedGroupId) {
        const fallthroughCandidates = [
          { id: pageGroupId, reason: 'page-state' },
          { id: lastManualGroupId, reason: 'last-manual' },
          { id: uploadLastActiveGroupId, reason: 'upload-last-active' },
          { id: stateActiveGroupId, reason: 'state-active' },
          { id: firstGroupId, reason: 'first-group' },
        ];

        for (const candidate of fallthroughCandidates) {
          if (isValidInGroups(candidate.id) && candidate.id !== excludeGroupId) {
            resolvedGroupId = candidate.id;
            reason = candidate.reason;
            break;
          }
        }
      }

      let resolvedFolderKey = '';
      if (resolvedGroupId && savedFolderKey && reason === 'multi-upload-last-selection') {
        const group = groups.find((item) => item && item.id === resolvedGroupId) || null;
        const groupKey = getUploadGroupStableKey(group);
        if (groupKey === savedProjectKey) {
          const files = (state.queue || []).filter(
            (file) => file && String(file.groupId || '').trim() === resolvedGroupId,
          );
          const savedFile = files.find(
            (file) => file && getUploadFileFolderKey(file) === savedFolderKey,
          );
          if (savedFile) {
            resolvedFolderKey = savedFolderKey;
          } else if (files.length > 0) {
            resolvedFolderKey = getUploadFileFolderKey(files[0]) || '';
            logMultiUploadLastSelectionEvent('FOLDER_MISSING', {
              projectKey: groupKey,
              savedFolder: savedFolderKey,
              fallback: resolvedFolderKey,
            });
          }
        }
      }

      const result = {
        reason,
        savedProjectKey,
        pageGroupId,
        lastManualGroupId,
        uploadLastActiveGroupId,
        stateActiveGroupId,
        resolvedGroupId,
        resolvedFolderKey,
        groupId: resolvedGroupId,
        source: reason,
      };

      console.info('[MULTI_UPLOAD][SELECTION][RESOLVE]', result);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[MULTI_UPLOAD][SELECTION][RESOLVE] reason=${reason} savedProjectKey=${savedProjectKey || '-'} `
          + `pageGroupId=${pageGroupId || '-'} lastManualGroupId=${lastManualGroupId || '-'} `
          + `uploadLastActiveGroupId=${uploadLastActiveGroupId || '-'} stateActiveGroupId=${stateActiveGroupId || '-'} `
          + `resolvedGroupId=${resolvedGroupId || '-'} resolvedFolderKey=${resolvedFolderKey || '-'}`,
        );
      }

      return result;
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

    async function switchGroup(groupId, options = {}) {
      if (!groupId) return;

      appendUploadGroupLog('SWITCH', {
        targetGroupId: groupId,
        fromGroupId: getActiveGroupId() || '-',
        reason: options.reason || '-',
      });

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
          lastManualUploadGroupAt = Date.now();
          saveUploadLastActiveGroupId(groupId, options.reason || 'switch-group');
        }

        saveMultiUploadSelectionForActiveGroup();

        if (options.savePageState !== false) {
          saveCurrentToolboxBaseState(options.reason || 'active-upload-group-change');
        }

        render();
        setStatus(`已切换到 ${getActiveGroupName()}`, 'success');

        syncUploadGroupAppState();
        appendUploadGroupLog('SWITCH', {
          phase: 'ok',
          fromGroupId: prevActiveGroupId || '-',
          targetGroupId: groupId || '-',
        });
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
          key: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        group.key = deriveUploadGroupStableKey(group);

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

      // Blob persistence disabled - sync removed

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
        setStatus('缺少文件，请重新拖入');
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

        renderProjectCategoryChips();
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

        renderProjectCategoryChips();
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

        if (typeof cleanupChatMessageCaches === 'function') {
          cleanupChatMessageCaches('upload-group-cleared');
        }

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
          button.textContent = '再次点击清空';
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
      const preferred = resolveUploadGroupSelection({
        reason: 'delete-group-inline',
        groups: nextGroups,
        excludeGroupId: group.id,
      });
      const resolvedCandidate = preferred.resolvedGroupId || '';
      const nextActiveGroupId = resolvedCandidate || (nextGroups[0] && nextGroups[0].id) || '';

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

        const nextActiveGroup = state.groups.find((g) => g.id === state.activeGroupId) || null;
        if (nextActiveGroup) {
          saveMultiUploadLastSelection({
            projectKey: getUploadGroupStableKey(nextActiveGroup),
            folderKey: '',
          });
        }
        saveLastManualUploadGroupId(state.activeGroupId, 'delete-group-inline');
        saveUploadLastActiveGroupId(state.activeGroupId, 'delete-group-inline');
        saveCurrentToolboxBaseState('delete-group-inline');

        if (!state.groups.some((g) => g.id === state.activeGroupId)) {
          console.warn('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]', {
            activeGroupId: state.activeGroupId,
            nextGroupIds: nextGroups.map((g) => g.id),
          });
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog('[UPLOAD_GROUP][delete-inline:active-invalid-fallback]');
          }
          state.activeGroupId = nextGroups[0].id;
        }

        syncGroupManagePanel({
          force: true,
        });

        setStatus(`已删除分组：${group.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][delete-inline:ok] groupId=${group.id || '-'} name=${group.name || '-'}`,
        );
        void cleanupUploadDbGarbage('delete-active-group');
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
        nextGroups = incomingGroups.map((g) => {
          const group = {
            id: String(g.id || createId('upload_group')),
            name: String(g.name || DEFAULT_UPLOAD_GROUP_NAME).slice(0, 24),
            key: String(g.key || '').trim(),
            createdAt: Number(g.createdAt) || Date.now(),
            updatedAt: Number(g.updatedAt) || Date.now(),
          };

          if (!group.key) {
            group.key = deriveUploadGroupStableKey(group);
          }

          return group;
        });

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

    function renderProjectCategoryChipHtml(group, activeGroupId) {
      return renderUploadGroupChipHtml(group, activeGroupId);
    }

    /** 项目分类统计（上传分组 chip），与页面连接状态无关。*/
    function renderUploadGroupFallbackChipHtml() {
      return `
          <button type="button"
            class="cgpt-chip-btn cgpt-upload-group-chip active"
            data-group-id=""
            title="默认：0 个文件">
            <span class="cgpt-chip-name">默认</span>
            <span class="cgpt-chip-count">0</span>
          </button>
        `;
    }

    function renderProjectCategoryChips() {
      if (!groupListEl) {
        ToolboxShell.appendLog('[UPLOAD_GROUP_UI][render-skip] reason=groupListEl-missing');
        return;
      }

      ensureActiveUploadGroupIdValid('render-chips');

      if (!state.groups.length) {
        if (!uploadGroupsInitResolved) {
          groupListEl.innerHTML = `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-group-chip active"
              data-group-id=""
              disabled
              title="正在加载上传分组">
              <span class="cgpt-chip-name">加载中</span>
              <span class="cgpt-chip-count">…</span>
            </button>
          `;
          appendUploadGroupLog('RENDER', { phase: 'waiting-init' });
          Promise.resolve(uploadModuleInitPromise)
            .then(() => {
              ensureActiveUploadGroupIdValid('render-chips-after-init');
              renderProjectCategoryChips();
            })
            .catch((err) => {
              console.error('[ChatGPT toolbox] renderProjectCategoryChips after init failed', err);
              renderProjectCategoryChips();
            });
          return;
        }

        appendUploadGroupLog('RENDER', { phase: 'empty-recovering' });
        groupListEl.innerHTML = renderUploadGroupFallbackChipHtml();
        ensureDefaultGroupReady()
          .then(() => {
            appendUploadGroupLog('RENDER', { phase: 'after-ensure-default' });
            renderProjectCategoryChips();
          })
          .catch((err) => {
            console.error('[ChatGPT toolbox] ensureDefaultGroupReady failed during render', err);
            groupListEl.innerHTML = renderUploadGroupFallbackChipHtml();
            appendUploadGroupLog('RENDER', { phase: 'fallback-after-error' });
          });
        return;
      }

      groupListEl.innerHTML = state.groups
        .map((group) => renderProjectCategoryChipHtml(group, state.activeGroupId))
        .join('');

      syncUploadGroupAppState();
      appendUploadGroupLog('RENDER', { phase: 'ok' });
    }

    function getCurrentConversationSnapshotStatsForHeader() {
      try {
        if (typeof buildConversationSnapshotForBridge === 'function') {
          const snapshot = buildConversationSnapshotForBridge(null);
          if (snapshot && snapshot.stats && typeof snapshot.stats === 'object') {
            return snapshot.stats;
          }
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] read snapshot stats for header failed', err);
        ToolboxShell.appendLog(`[TOOLBOX_TOP_STATUS][SNAPSHOT_STATS_FAILED] error=${errText}`);
      }

      return null;
    }

    function renderToolboxPageStatusRow() {
      let pageStatusRowEl = document.getElementById('cgpt-toolbox-page-status-row');

      if (!pageStatusRowEl) {
        if (
          typeof ToolboxShell !== 'undefined'
          && typeof ToolboxShell.ensureToolboxHeaderPageStatusRow === 'function'
        ) {
          pageStatusRowEl = ToolboxShell.ensureToolboxHeaderPageStatusRow();
        }
      }

      if (!pageStatusRowEl) {
        return;
      }

      const pageDisplayId = getBridgePageDisplayIdText();
      const stats = getCurrentConversationSnapshotStatsForHeader();

      const messageCount = stats ? Number(stats.total_count || 0) : 0;
      const roundCount = stats ? Number(stats.round_count || 0) : 0;
      const domEstimatedRound = stats
        ? Number(stats.dom_estimated_round_count || 0)
        : Number(getConversationTurnCount() || 0);

      logConversationTurnCountIfChanged(domEstimatedRound, 'renderToolboxPageStatusRow');

      const pageIdText = `页面ID:${pageDisplayId}`;
      const messageText = `消息:${messageCount}`;
      const roundText = `问答:${roundCount}`;
      const estimatedText = `估轮:${domEstimatedRound}`;

      const domEstimatedNumber = Number(domEstimatedRound);
      const isDomEstimatedWarning = Number.isFinite(domEstimatedNumber) && domEstimatedNumber > 20;
      const estimatedBadgeClass = [
        'cgpt-toolbox-top-status-badge',
        'cgpt-toolbox-turn-count-badge',
        isDomEstimatedWarning ? 'cgpt-toolbox-turn-count-warning' : '',
      ].filter(Boolean).join(' ');

      const estimatedTitle = isDomEstimatedWarning
        ? `${estimatedText}（页面 DOM 估算轮次，超过20次仅红色提示）`
        : `${estimatedText}（页面 DOM 估算轮次，不等于同步消息数）`;

      pageStatusRowEl.innerHTML = `
        <span id="cgpt-page-input-state" class="cgpt-status-pill cgpt-toolbox-top-status-badge cgpt-state-unknown">未知</span>
        <span class="cgpt-toolbox-top-status-badge cgpt-toolbox-page-id-badge" title="${escapeHtml(pageIdText)}">${escapeHtml(pageIdText)}</span>
        <span class="cgpt-toolbox-top-status-badge" title="${escapeHtml(messageText)}（同步快照总消息数）">${escapeHtml(messageText)}</span>
        <span class="cgpt-toolbox-top-status-badge" title="${escapeHtml(roundText)}（用户/AI 配对问答轮次）">${escapeHtml(roundText)}</span>
        <span class="${estimatedBadgeClass}" title="${escapeHtml(estimatedTitle)}">${escapeHtml(estimatedText)}</span>
      `;
      updateChatInputStateBadge();
    }

    function renderToolboxTopStatus() {
      renderToolboxPageStatusRow();
      renderProjectCategoryChips();
      updateChatInputStateBadge();
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

    function normalizeQuickPromptCategoryName(value) {
      const text = String(value || '').trim();
      if (!text || text === '鍏ㄩ儴') {
        if (text === '鍏ㄩ儴') {
          console.info('[QUICK_PROMPT][CATEGORY][NORMALIZE_MOJIBAKE]', {
            from: text,
            to: '全部',
          });
        }
        return '全部';
      }
      return text;
    }

    function getQuickPromptActiveCategory() {
      return normalizeQuickPromptCategoryName(quickPromptActiveCategory);
    }

    function saveQuickPromptActiveCategory(category, options = {}) {
      const nextCategory = normalizeQuickPromptCategoryName(category);
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

      // 项目文件夹/分组切换栏是核心功能，精简模式也必须显示。
      rootElRef.classList.remove('compact-hide-upload-groups');

      rootElRef.classList.toggle('compact-hide-upload-start', isCompact && !cfg.showUploadStartButton);
      rootElRef.classList.toggle('compact-hide-file-list', isCompact && !cfg.showUploadFileList);
      const shouldShowQuick = isCompact
        ? cfg.showCompactQuickPrompts !== false
        : cfg.showUploadQuickPrompts !== false;

      rootElRef.classList.toggle('compact-hide-quick-prompts', !shouldShowQuick);
    }

    function shouldQuickPromptAutoSend(cfg) {
      if (QUICK_PROMPT_CLICK_AUTO_SEND !== true) {
        return false;
      }
      return cfg.quickPromptClickAction !== 'fill';
    }

    function isQuickPromptNativeSendReady() {
      if (typeof ComposerApi.canSendNow !== 'function') {
        return false;
      }

      try {
        return !!ComposerApi.canSendNow({ maxAgeMs: 0 });
      } catch (canSendErr) {
        console.error('[ChatGPT toolbox] isQuickPromptNativeSendReady canSendNow failed', canSendErr);
        return false;
      }
    }

    function isQuickPromptComposerReadyForSend(expectedText, composerText) {
      const expected = String(expectedText || '').trim();
      const actual = String(composerText || '').trim();
      if (!actual) {
        return isQuickPromptNativeSendReady();
      }
      if (!expected) {
        return true;
      }
      if (actual === expected) {
        return true;
      }
      const expectedProbe = expected.slice(0, 80);
      const actualProbe = actual.slice(0, 80);
      if (actual.includes(expectedProbe) || expected.includes(actualProbe)) {
        return true;
      }
      if (isQuickPromptNativeSendReady()) {
        return true;
      }
      return actual.length >= Math.min(expected.length, 32);
    }

    async function waitQuickPromptComposerReadyForSend(expectedText, timeoutMs = 8000) {
      const startedAt = Date.now();
      let lastComposerText = '';

      while (Date.now() - startedAt < timeoutMs) {
        lastComposerText = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '')
          : '';

        if (isQuickPromptComposerReadyForSend(expectedText, lastComposerText)) {
          return {
            ok: true,
            composerText: lastComposerText,
            reason: isQuickPromptNativeSendReady() ? 'native_send_ready' : 'composer_ready',
            nativeSendReady: isQuickPromptNativeSendReady(),
          };
        }

        await sleep(100);
      }

      lastComposerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '')
        : '';
      const nativeSendReady = isQuickPromptNativeSendReady();
      const composerReady = isQuickPromptComposerReadyForSend(expectedText, lastComposerText);

      return {
        ok: nativeSendReady || composerReady,
        composerText: lastComposerText,
        reason: nativeSendReady ? 'native_send_ready' : (composerReady ? 'composer_ready' : 'composer_not_ready'),
        nativeSendReady,
      };
    }

    async function sendOrFillQuickPrompt(prompt, options = {}) {
      const cfg = getCompactUiConfig();
      const source = String(options.source || 'quick-prompt-click').trim() || 'quick-prompt-click';
      const text = String(prompt && prompt.content ? prompt.content : '').trim();
      const title = String(prompt && prompt.title ? prompt.title : '未命名').trim() || '未命名';
      const autoSend = shouldQuickPromptAutoSend(cfg);
      const action = autoSend ? 'send' : 'fill';

      ToolboxShell.appendLog(
        `[PROMPT][CLICK] source=${source} title=${title} text_len=${text.length} action=${action} auto_send=${autoSend ? 1 : 0} waiting=${isWaitingSendActive() ? 1 : 0}`,
      );

      if (!text) {
        setStatus(`Prompt 内容为空：${title}`, 'warn');
        ToolboxShell.appendLog(`[PROMPT][CLICK][SKIP] source=${source} reason=empty_prompt`);
        return;
      }

      if (autoSend && isWaitingSendActive()) {
        setStatus('当前已有发送任务进行中，请稍后再点击 Prompt', 'warn');
        ToolboxShell.appendLog(`[PROMPT][CLICK][SKIP] source=${source} reason=waiting_send_active`);
        return;
      }

      const existingText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';

      if (existingText && existingText !== text && cfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(
          `ChatGPT 输入框已有 ${existingText.length} 个字符，是否覆盖为快捷 Prompt：${title}？`
        );

        if (!okReplace) {
          setStatus('已取消：未覆盖输入框草稿', 'warn');
          ToolboxShell.appendLog(
            `[PROMPT][CLICK][SKIP] source=${source} reason=draft_overwrite_cancelled existingChars=${existingText.length} newChars=${text.length}`,
          );
          return;
        }
      } else if (existingText && existingText !== text) {
        ToolboxShell.appendLog(
          `[PROMPT][CLICK][OVERWRITE_DRAFT] source=${source} existingChars=${existingText.length} newChars=${text.length}`,
        );
      }

      setStatus('正在写入 Prompt...', 'running');

      const ok = ComposerApi.setComposerValue(text);

      if (!ok) {
        console.warn('[ChatGPT toolbox] quick prompt: composer not found', prompt);
        setStatus('未找到 ChatGPT 输入框，无法填入 Prompt', 'error');
        ToolboxShell.appendLog(`[PROMPT][CLICK][WRITE_FAILED] source=${source} reason=composer_not_found`);
        return;
      }

      if (typeof ComposerApi.focusComposerForNativeSend === 'function') {
        ComposerApi.focusComposerForNativeSend();
      }

      const syncResult = typeof ComposerApi.waitForComposerTextSynced === 'function'
        ? await ComposerApi.waitForComposerTextSynced(text, 8000, {})
        : {
            ok: true,
            reason: 'sync-check-unavailable',
          };

      await sleep(QUICK_PROMPT_WRITE_SETTLE_MS);

      const readyResult = autoSend
        ? await waitQuickPromptComposerReadyForSend(text, 8000)
        : {
            ok: true,
            composerText: typeof ComposerApi.getComposerText === 'function'
              ? String(ComposerApi.getComposerText() || '')
              : '',
            reason: 'fill_only',
            nativeSendReady: isQuickPromptNativeSendReady(),
          };

      const composerText = String(readyResult.composerText || '');
      const composerReady = !!readyResult.ok;

      ToolboxShell.appendLog(
        `[PROMPT][CLICK][WRITE_OK] source=${source} title=${title} chars=${text.length} composerChars=${composerText.length} sync=${syncResult.ok ? 1 : 0} syncReason=${syncResult.reason || '-'} composerReady=${composerReady ? 1 : 0} readyReason=${readyResult.reason || '-'} nativeSendReady=${readyResult.nativeSendReady ? 1 : 0}`,
      );

      if (!composerReady) {
        const blockReason = readyResult.reason || syncResult.reason || 'composer_not_ready';
        setStatus(`Prompt 写入未完成，无法发送：${blockReason}`, 'warn');
        ToolboxShell.appendLog(
          `[PROMPT][CLICK][WRITE_FAILED] source=${source} reason=${blockReason} composerChars=${composerText.length} nativeSendReady=${readyResult.nativeSendReady ? 1 : 0}`,
        );
        return;
      }

      if (!syncResult.ok) {
        ToolboxShell.appendLog(
          `[PROMPT][CLICK][WRITE_SYNC_WARN] source=${source} reason=${syncResult.reason || 'composer_text_not_synced'} composerChars=${composerText.length} readyReason=${readyResult.reason || '-'}`,
        );
      }

      if (!autoSend) {
        setStatus(`已填入 Prompt：${title}`, 'success');
        ToolboxShell.appendLog(`[PROMPT][CLICK][FILL_ONLY] source=${source} title=${title}`);
        return;
      }

      setStatus(`正在发送 Prompt：${title}`, 'running');
      ToolboxShell.appendLog(`[PROMPT][CLICK][SEND_START] source=${source} title=${title}`);

      const runId = claimWaitingSendRun(source, Date.now());

      try {
        const sent = await sendCurrentMessageFromUploadPanel(source, runId);

        if (sent) {
          setStatus(`Prompt 已发送，等待回复：${title}`, 'running');
          ToolboxShell.appendLog(`[PROMPT][CLICK][SEND_OK] source=${source} title=${title}`);
          return;
        }

        const hint = String(state.uploadSendFailureHint || '').trim();
        const reason = hint || 'send_message_button_failed';
        setStatus(`Prompt 发送失败：${reason}`, 'warn');
        ToolboxShell.appendLog(`[PROMPT][CLICK][SEND_FAILED] source=${source} title=${title} reason=${reason}`);
        resetUploadSendShortcutState('quick-prompt-send-failed', runId);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] quick prompt send failed', err);
        setStatus(`Prompt 发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[PROMPT][CLICK][SEND_FAILED] source=${source} title=${title} error=${errText}`);
        resetUploadSendShortcutState('quick-prompt-send-failed', runId);
      }
    }

    async function scrollChatToBottom(reason) {
      const reasonText = reason || 'unknown';

      const candidates = [
        document.scrollingElement,
        document.documentElement,
        document.body,
        document.querySelector('main'),
        document.querySelector('[role="main"]'),
        document.querySelector('[data-testid="conversation-turn-list"]')?.parentElement,
      ].filter(Boolean);

      const scrollables = Array.from(document.querySelectorAll('div, main, section'))
        .filter((el) => {
          const style = window.getComputedStyle(el);
          const overflowY = style.overflowY;
          const canScroll = el.scrollHeight > el.clientHeight + 80;
          return canScroll && ['auto', 'scroll', 'overlay'].includes(overflowY);
        })
        .sort((a, b) => b.scrollHeight - a.scrollHeight);

      const targets = [...new Set([...candidates, ...scrollables])];

      for (const el of targets) {
        try {
          if (!el) {
            continue;
          }
          el.scrollTop = el.scrollHeight;
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] scrollChatToBottom element failed', err);
          ToolboxShell.appendLog(`[SCROLL][BOTTOM_ELEMENT_FAILED] reason=${reasonText} error=${errText}`);
        }
      }

      try {
        window.scrollTo({
          top: Math.max(
            document.body ? document.body.scrollHeight : 0,
            document.documentElement ? document.documentElement.scrollHeight : 0,
          ),
          behavior: 'auto',
        });
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] scrollChatToBottom window failed', err);
        ToolboxShell.appendLog(`[SCROLL][BOTTOM_WINDOW_FAILED] reason=${reasonText} error=${errText}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 80));

      ToolboxShell.appendLog(`[SCROLL][BOTTOM] reason=${reasonText}`);
    }

    function getLastAssistantReplyText() {
      try {
        if (typeof getLatestAssistantMessageForCopy === 'function') {
          const picked = getLatestAssistantMessageForCopy({ forceRefresh: true });
          if (picked && picked.ok && picked.text) {
            return String(picked.text).trim();
          }
        }

        if (
          typeof ChatMessageExtractor !== 'undefined'
          && ChatMessageExtractor
          && typeof ChatMessageExtractor.buildRecords === 'function'
          && typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser === 'function'
        ) {
          const records = ChatMessageExtractor.buildRecords({ includeEmpty: false });
          const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);

          if (picked && picked.ok && picked.record) {
            const recordText = String(picked.record.text || '').trim();
            if (recordText) {
              return recordText;
            }
          }
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getLastAssistantReplyText extractor failed', err);
        ToolboxShell.appendLog(`[COPY][LATEST_READ_FAILED] reason=getLastAssistantReplyText error=${errText}`);
      }

      const assistantNodes = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]'),
      );
      const lastNode = assistantNodes.length > 0
        ? assistantNodes[assistantNodes.length - 1]
        : null;

      if (!lastNode) {
        return '';
      }

      return String(lastNode.innerText || lastNode.textContent || '').trim();
    }

    async function copyLatestAssistantReplyUnified(options) {
      const opts = Object.assign({
        reason: 'copy-latest',
        scrollBeforeCopy: true,
        scrollAfterCopy: true,
        prefilledText: '',
      }, options || {});

      ToolboxShell.appendLog(`[COPY][UNIFIED_START] reason=${opts.reason}`);

      if (opts.scrollBeforeCopy) {
        await scrollChatToBottom(`${opts.reason}:before-copy`);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }

      let text = String(opts.prefilledText || '').trim();

      if (!text) {
        try {
          text = getLastAssistantReplyText();
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] getLastAssistantReplyText failed', err);
          ToolboxShell.appendLog(`[COPY][LATEST_READ_FAILED] reason=${opts.reason} error=${errText}`);
          setStatus('复制失败：无法读取最后回复', 'error');
          return {
            ok: false,
            reason: 'read-failed',
            error: errText,
          };
        }
      }

      text = String(text || '').trim();

      if (!text || (typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(text))) {
        ToolboxShell.appendLog(
          `[COPY][LATEST_EMPTY] reason=${opts.reason} invalid=${text ? '1' : '0'}`,
        );
        setStatus('复制失败：最后回复为空', 'error');
        return {
          ok: false,
          reason: text ? 'invalid-assistant-text' : 'empty',
        };
      }

      if (typeof copyTextToClipboard !== 'function') {
        ToolboxShell.appendLog(`[COPY][CLIPBOARD_FAILED] reason=${opts.reason} error=copyTextToClipboard-missing`);
        setStatus('复制失败：剪贴板写入失败', 'error');
        return {
          ok: false,
          reason: 'clipboard-failed',
          error: 'copyTextToClipboard-missing',
        };
      }

      try {
        await copyTextToClipboard(text);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] clipboard write failed', err);
        ToolboxShell.appendLog(`[COPY][CLIPBOARD_FAILED] reason=${opts.reason} error=${errText}`);
        setStatus('复制失败：剪贴板写入失败', 'error');
        return {
          ok: false,
          reason: 'clipboard-failed',
          error: errText,
        };
      }

      ToolboxShell.appendLog(`[COPY][UNIFIED_DONE] reason=${opts.reason} chars=${text.length}`);
      setStatus(`已复制最后回复：${text.length} 字`, 'success');

      if (opts.scrollAfterCopy) {
        await scrollChatToBottom(`${opts.reason}:after-copy`);
      }

      return {
        ok: true,
        text,
        chars: text.length,
      };
    }

    function normalizeClipboardTextForCompare(text) {
      return String(text || '')
        .replace(/\r\n/g, '\n')
        .trim();
    }

    function waitClipboardHotkeyDelay(ms) {
      return new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
      });
    }

    async function ensureClipboardReadyBeforeSystemHotkey(expectedText, reason = 'copy-hotkey') {
      const reasonText = String(reason || 'copy-hotkey').trim() || 'copy-hotkey';
      const expected = String(expectedText || '');
      const expectedNormalized = normalizeClipboardTextForCompare(expected);

      if (!expectedNormalized) {
        ToolboxShell.appendLog(`[COPY_ACTION][CLIPBOARD_READY_FAILED] reason=${reasonText} error=empty-expected-text`);
        return {
          ok: false,
          verified: false,
          reason: 'empty-expected-text',
        };
      }

      await waitClipboardHotkeyDelay(220);

      const canReadClipboard = !!(
        navigator.clipboard
        && typeof navigator.clipboard.readText === 'function'
        && (!document.hasFocus || document.hasFocus())
      );

      if (!canReadClipboard) {
        ToolboxShell.appendLog(
          `[COPY_ACTION][CLIPBOARD_READY_SKIP_VERIFY] reason=${reasonText} chars=${expected.length} readText=unavailable`,
        );
        return {
          ok: true,
          verified: false,
          reason: 'readText-unavailable',
        };
      }

      const deadline = Date.now() + 900;
      let lastText = '';
      let lastError = '';

      while (Date.now() < deadline) {
        try {
          lastText = String(await navigator.clipboard.readText() || '');
          if (normalizeClipboardTextForCompare(lastText) === expectedNormalized) {
            ToolboxShell.appendLog(
              `[COPY_ACTION][CLIPBOARD_READY_OK] reason=${reasonText} chars=${expected.length} verified=1`,
            );
            return {
              ok: true,
              verified: true,
              reason: 'ok',
            };
          }
        } catch (error) {
          lastError = error && error.message ? error.message : String(error);
          console.warn('[ChatGPT toolbox] clipboard read before hotkey failed', error);
          ToolboxShell.appendLog(
            `[COPY_ACTION][CLIPBOARD_READ_FAILED] reason=${reasonText} error=${lastError}`,
          );
          await waitClipboardHotkeyDelay(180);
          return {
            ok: true,
            verified: false,
            reason: 'readText-failed',
            error: lastError,
          };
        }

        await waitClipboardHotkeyDelay(90);
      }

      ToolboxShell.appendLog(
        `[COPY_ACTION][CLIPBOARD_READY_FAILED] reason=${reasonText} error=clipboard-mismatch expectedChars=${expected.length} actualChars=${lastText.length} lastError=${lastError || '-'}`,
      );

      try {
        await copyTextToClipboard(expected);
        await waitClipboardHotkeyDelay(260);
        ToolboxShell.appendLog(
          `[COPY_ACTION][CLIPBOARD_RECOPY_OK] reason=${reasonText} chars=${expected.length}`,
        );
        return {
          ok: true,
          verified: false,
          reason: 'recopy-ok',
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.error('[ChatGPT toolbox] clipboard recopy before hotkey failed', error);
        ToolboxShell.appendLog(
          `[COPY_ACTION][CLIPBOARD_RECOPY_FAILED] reason=${reasonText} error=${errText}`,
        );
        return {
          ok: false,
          verified: false,
          reason: 'recopy-failed',
          error: errText,
        };
      }
    }

    async function sendConfiguredHotkey(reason) {
      const reasonText = String(reason || 'copy-hotkey').trim() || 'copy-hotkey';
      const hotkeyOk = await triggerSendHotkeyOnce();
      ToolboxShell.appendLog(
        `[COPY_ACTION][HOTKEY] reason=${reasonText} ok=${hotkeyOk ? 1 : 0}`,
      );
      return {
        ok: !!hotkeyOk,
        reason: hotkeyOk ? 'ok' : 'hotkey-failed',
        hotkeySent: !!hotkeyOk,
      };
    }

    async function sendContinuePromptFromUnifiedPipeline(reason, options = {}) {
      const reasonText = String(reason || 'copy-continue').trim() || 'copy-continue';
      const continueResult = await sendContinueMessageOnly(reasonText, options);
      const ok = !!(continueResult && continueResult.ok);
      ToolboxShell.appendLog(
        `[COPY_ACTION][CONTINUE] reason=${reasonText} ok=${ok ? 1 : 0}`,
      );
      return Object.assign({}, continueResult || {}, {
        ok,
        continueSent: ok,
      });
    }

    async function startLoopCopyHotkeyContinueFlow(source = 'button') {
      return toggleCopyHotkeyContinueLoop(source);
    }

    async function runCopyAction(actionType, options = {}) {
      const type = String(actionType || 'copy-only').trim() || 'copy-only';
      const source = String(options.source || 'runCopyAction').trim() || 'runCopyAction';
      const flowOptions = options && typeof options === 'object' ? options : {};

      ToolboxShell.appendLog(`[COPY_ACTION][START] type=${type}`);

      if (type === 'copy-only') {
        const result = await copyLastReplyWithState(source);
        ToolboxShell.appendLog(`[COPY_ACTION][DONE] type=${type} ok=${result ? 1 : 0}`);
        return result;
      }

      if (type === 'copy-and-continue') {
        const result = await copyLastMessageAndContinue(source);
        ToolboxShell.appendLog(
          `[COPY_ACTION][CONTINUE_DONE] type=${type} ok=${result ? 1 : 0}`,
        );
        return result;
      }

      if (type === 'copy-and-hotkey') {
        const result = await runCopyAndHotkeyAction(source, flowOptions);
        ToolboxShell.appendLog(
          `[COPY_ACTION][HOTKEY_DONE] type=${type} ok=${result && result.ok ? 1 : 0}`,
        );
        return result;
      }

      if (type === 'copy-hotkey-continue') {
        const result = await copyHotkeyAndContinueOnce(source, flowOptions);
        ToolboxShell.appendLog(
          `[COPY_ACTION][DONE] type=${type} ok=${result && result.ok ? 1 : 0}`,
        );
        return result;
      }

      if (type === 'loop-copy-hotkey-continue') {
        return startLoopCopyHotkeyContinueFlow(source);
      }

      ToolboxShell.appendLog(`[COPY_ACTION][UNKNOWN_TYPE] type=${type}`);
      return {
        ok: false,
        reason: 'unknown-action-type',
      };
    }

    async function waitAssistantStableForCopyContinue(source = 'copy-continue', options = {}) {
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

      if (shouldStop()) {
        return {
          ok: false,
          reason: 'cancelled',
        };
      }

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
        shouldStop,
        isGenerating: () => {
          return typeof ComposerApi !== 'undefined'
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy();
        },
      });

      const trimmedText = String(result && result.text ? result.text : '').trim();

      if (!result || !result.ok || !trimmedText) {
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

      if (typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(trimmedText)) {
        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][wait-failed] reason=invalid-assistant-text preview=${trimmedText.slice(0, 40)}`,
        );

        setStatus('等待回复完成失败：回复尚未就绪', 'warn');

        return {
          ok: false,
          reason: 'invalid-assistant-text',
          result,
        };
      }

      ToolboxShell.appendLog(
        `[UPLOAD_COPY_CONTINUE][wait-ok] chars=${trimmedText.length} reason=${result.reason || '-'}`,
      );

      return {
        ok: true,
        text: trimmedText,
        record: result.record || null,
        result,
      };
    }

    async function copyLastReplyWithState(source = 'button') {
      const btn = rootElRef ? qs(UploadSelectors.copyLastMessageBtn, rootElRef) : null;

      if (copyLastReplyTaskRunning) {
        const runningMs = Date.now() - Number(copyLastReplyTaskStartedAt || 0);
        if (runningMs <= 90000) {
          ToolboxShell.appendLog(
            `[COPY_LAST_REPLY][skip] reason=task-running runningMs=${runningMs}`,
          );
          return false;
        }
        ToolboxShell.appendLog(
          `[COPY_LAST_REPLY][stale-release] runningMs=${runningMs}`,
        );
        copyLastReplyTaskRunning = false;
        copyLastReplyTaskStartedAt = 0;
        copyLastReplyTaskStatus = '';
        copyLastMessageTaskRunning = false;
        copyLastMessageTaskStartedAt = 0;
        copyLastMessageTaskStatus = '';
        copyLastMessageWaiting = false;
      }

      copyLastReplyTaskRunning = true;
      copyLastReplyTaskStartedAt = Date.now();
      copyLastReplyTaskStatus = 'waiting';
      copyLastMessageTaskRunning = true;
      copyLastMessageTaskStartedAt = copyLastReplyTaskStartedAt;
      copyLastMessageTaskStatus = 'waiting';
      copyLastMessageTaskSource = String(source || 'button');
      copyLastMessageWaiting = true;
      renderUploadButtonsOnly();

      if (typeof markLatestAssistantMessageCacheDirty === 'function') {
        markLatestAssistantMessageCacheDirty();
      }

      if (btn && typeof setButtonWaitingDanger === 'function') {
        setButtonWaitingDanger(btn, true, 'wait_last_reply');
      }

      try {
        ToolboxShell.appendLog(
          `[COPY_LAST_REPLY][start] source=${String(source || '-')}`,
        );
        setStatus('正在等待最后回复稳定...', 'running');

        let prefilledText = '';
        if (typeof waitAssistantStableForCopyContinue === 'function') {
          const waitResult = await waitAssistantStableForCopyContinue(source);
          if (!waitResult || !waitResult.ok) {
            const reason = waitResult && waitResult.reason ? waitResult.reason : 'wait-assistant-failed';
            ToolboxShell.appendLog(
              `[COPY_LAST_REPLY][abort] reason=${reason}`,
            );
            setStatus(`复制最后回复失败：${reason}`, 'warn');
            copyLastReplyTaskStatus = 'failed';
            copyLastMessageTaskStatus = 'failed';
            copyLastMessageWaiting = false;
            renderUploadButtonsOnly();
            if (btn && typeof setButtonTemporaryError === 'function') {
              setButtonTemporaryError(btn, '复制失败', 1200);
            }
            return false;
          }
          prefilledText = String(waitResult.text || '').trim();
        }

        copyLastReplyTaskStatus = 'copying';
        copyLastMessageTaskStatus = 'copying';
        copyLastMessageWaiting = false;
        renderUploadButtonsOnly();

        const copyResult = await copyLatestAssistantReplyUnified({
          reason: `copy-only:${String(source || '-')}`,
          scrollBeforeCopy: true,
          scrollAfterCopy: true,
          prefilledText,
        });

        if (!copyResult || copyResult.ok !== true) {
          const failReason = copyResult && copyResult.reason ? copyResult.reason : 'copy-failed';
          ToolboxShell.appendLog(`[COPY_LAST_REPLY][abort] reason=${failReason}`);
          setStatus('复制最后回复失败：没有找到可复制的回复', 'warn');
          copyLastReplyTaskStatus = 'failed';
          copyLastMessageTaskStatus = 'failed';
          copyLastMessageWaiting = false;
          renderUploadButtonsOnly();
          if (btn && typeof setButtonTemporaryError === 'function') {
            setButtonTemporaryError(btn, '复制失败', 1200);
          }
          return false;
        }

        copyLastReplyTaskStatus = 'success';
        copyLastMessageTaskStatus = 'success';
        renderUploadButtonsOnly();

        ToolboxShell.appendLog(
          `[COPY_LAST_REPLY][done] chars=${copyResult.chars || 0}`,
        );
        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(source || '-', 'copyLastReply');
        }
        if (btn && typeof setButtonTemporaryOk === 'function') {
          setButtonTemporaryOk(btn, '已复制', 900);
        }
        return true;
      } catch (error) {
        const errText = typeof formatToolboxError === 'function'
          ? formatToolboxError(error)
          : String(error && error.message ? error.message : error);
        console.error('[COPY_LAST_REPLY][FAILED]', {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        ToolboxShell.appendLog(`[COPY_LAST_REPLY][failed] error=${errText}`);
        setStatus(`复制最后回复失败：${errText}`, 'error');
        copyLastReplyTaskStatus = 'failed';
        copyLastMessageTaskStatus = 'failed';
        copyLastMessageWaiting = false;
        renderUploadButtonsOnly();
        if (btn && typeof setButtonTemporaryError === 'function') {
          setButtonTemporaryError(btn, '复制失败', 1200);
        }
        return false;
      } finally {
        if (btn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(btn, 'copy_last_reply_done');
        }
        const resetDelay = copyLastReplyTaskStatus === 'success' ? 800 : 1200;
        window.setTimeout(() => {
          copyLastReplyTaskRunning = false;
          copyLastReplyTaskStartedAt = 0;
          copyLastReplyTaskStatus = '';
          copyLastMessageTaskRunning = false;
          copyLastMessageTaskStartedAt = 0;
          copyLastMessageTaskStatus = '';
          copyLastMessageTaskSource = '';
          copyLastMessageWaiting = false;
          renderUploadButtonsOnly();
        }, resetDelay);
      }
    }

    async function sendContinueMessageOnly(source = 'button', options = {}) {
      const sourceText = String(source || '');
      const isLoopMode = sourceText.startsWith('loop-');
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

      if (shouldStop()) {
        return {
          ok: false,
          reason: 'cancelled',
          assistantDoneSignal: false,
        };
      }

      safeAppendLog(`[UPLOAD_CONTINUE][SEND_START] source=${sourceText}`);
      console.warn('[UPLOAD_CONTINUE][SEND_START]', { source: sourceText });

      const assistantRawBeforeSend = getLastAssistantMessageTextForStopSignal();
      const doneBeforeSend = hasAssistantDoneSignalInText(
        assistantRawBeforeSend,
        'UPLOAD_CONTINUE',
        'before-send',
        `source=${sourceText}`,
        options,
      );
      if (doneBeforeSend) {
        const preview = formatDoneSignalPreview(assistantRawBeforeSend);
        const skipLine = `[UPLOAD_CONTINUE][skip] reason=assistant-done-signal-before-send source=${sourceText} preview=${preview}`;
        safeAppendLog(skipLine);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(skipLine);
        }
        console.warn('[UPLOAD_CONTINUE][skip]', {
          source: sourceText,
          reason: 'assistant-done-signal-before-send',
          preview,
        });
        return {
          ok: false,
          reason: 'assistant-done-signal-before-send',
          assistantDoneSignal: true,
        };
      }

      if (isWaitingSendActive()) {
        cancelWaitingSend('copy-continue');
      }

      const continuePromptText = getCopyHotkeyContinuePromptText(options);
      const promptPreview = formatContinuePromptPreview(continuePromptText, 160);
      const previewLine = `[UPLOAD_CONTINUE][PROMPT_PREVIEW] chars=${continuePromptText.length} preview=${promptPreview}`;
      safeAppendLog(previewLine);
      console.warn('[UPLOAD_CONTINUE][PROMPT_PREVIEW]', {
        chars: continuePromptText.length,
        preview: promptPreview,
      });

      let result = await sendContinueMessageOnceOnly(sourceText, options);
      let reason = result && result.reason ? result.reason : '';

      if (result && result.ok) {
        safeAppendLog(`[UPLOAD_CONTINUE][SEND_OK] source=${sourceText} reason=${reason || '-'}`);
        return result;
      }

      if (isLoopMode && isAssistantBusyReason(reason)) {
        const composerText = (
          typeof ComposerApi !== 'undefined'
          && ComposerApi
          && typeof ComposerApi.getComposerText === 'function'
        )
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';

        let busyNow = false;
        try {
          busyNow = (
            typeof ComposerApi !== 'undefined'
            && ComposerApi
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy()
          );
        } catch (busyCheckErr) {
          console.error('[UPLOAD_CONTINUE][BUSY_CHECK_FAILED]', {
            source: sourceText,
            error_type: busyCheckErr && busyCheckErr.name,
            error: busyCheckErr && busyCheckErr.message,
            stack: busyCheckErr && busyCheckErr.stack,
          });
          busyNow = false;
        }

        if (busyNow || !composerText) {
          safeAppendLog(
            `[UPLOAD_CONTINUE][BUSY_AFTER_SEND_TREAT_AS_ACCEPTED] source=${sourceText} reason=${reason || '-'} busyNow=${busyNow ? '1' : '0'} composerChars=${composerText.length}`,
          );

          console.warn('[UPLOAD_CONTINUE][BUSY_AFTER_SEND_TREAT_AS_ACCEPTED]', {
            source: sourceText,
            reason,
            result,
            busyNow,
            composerChars: composerText.length,
          });

          return {
            ok: true,
            reason: 'send-accepted-assistant-busy',
            detail: reason || '',
            assistantBusyAfterSend: busyNow,
          };
        }

        safeAppendLog(
          `[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=continue-send-not-confirmed detail=${reason || '-'}`,
        );
        console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', {
          source: sourceText,
          reason: 'continue-send-not-confirmed',
          detail: reason,
          composerText,
          busyNow,
          result,
        });

        return {
          ok: false,
          reason: 'continue-send-not-confirmed',
          detail: reason || '',
        };
      }

      safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=${reason || 'unknown'}`);
      console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', {
        source: sourceText,
        reason,
        result,
      });

      return {
        ok: false,
        reason: reason || 'send-failed',
        detail: reason || '',
      };
    }

    async function sendContinueMessageOnceOnly(source, options = {}) {
      const sourceText = String(source || '');
      const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;
      const text = getCopyHotkeyContinuePromptText(options);
      const stopSignal = getCopyHotkeyContinueStopSignal(options);

      if (shouldStop()) {
        return { ok: false, reason: 'cancelled' };
      }

      if (typeof sendContentViaComposer === 'function') {
        try {
          if (shouldStop()) {
            return { ok: false, reason: 'cancelled' };
          }
          const result = await sendContentViaComposer({
            source,
            content: text,
            allowReplaceDraft: true,
            waitUntilSendable: true,
            blockWhenResponding: false,
            timeoutMs: typeof SEND_WAIT_TIMEOUT_MS === 'number' ? SEND_WAIT_TIMEOUT_MS : 60000,
            shouldStop,
          });
          if (shouldStop()) {
            return { ok: false, reason: 'cancelled' };
          }
          if (!result || !result.ok) {
            const reason = result && result.reason ? result.reason : 'unknown';
            setStatus(`\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a${reason}`, 'warn');
            console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason, result });
            safeAppendLog(`[UPLOAD_CONTINUE][send-failed] reason=${reason}`);
            safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=${reason}`);
            return { ok: false, reason };
          }

          setStatus('已发送继续指令', 'success');
          console.warn('[UPLOAD_CONTINUE][SEND_OK]', { source, reason: result && result.reason });
          safeAppendLog(`[UPLOAD_CONTINUE][sent] chars=${text.length} stopSignal=${stopSignal}`);
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_OK] source=${sourceText} reason=${result && result.reason ? result.reason : '-'}`);
          return { ok: true, reason: result.reason || 'composer-send' };
        } catch (err) {
          const errText = formatToolboxError(err);
          console.error('[ChatGPT toolbox] send continue message failed', err);
          setStatus(`\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a${errText}`, 'error');
          safeAppendLog(`[UPLOAD_CONTINUE][send-failed] error=${errText}`);
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=${errText}`);
          return { ok: false, reason: errText };
        }
      }

      const existingText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';
      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};
      if (existingText && existingText !== text && cfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(`ChatGPT \u8f93\u5165\u6846\u5df2\u6709${existingText.length} \u4e2a\u5b57\u7b26\uff0c\u662f\u5426\u8986\u76d6\u5e76\u53d1\u9001\u201c\u7ee7\u7eed\u201d\uff1f`);
        if (!okReplace) {
          setStatus('\u5df2\u53d6\u6d88\u53d1\u9001\u7ee7\u7eed\uff1a\u672a\u8986\u76d6\u8f93\u5165\u6846\u8349\u7a3f', 'warn');
          console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'user-refused-overwrite' });
          safeAppendLog(`[UPLOAD_CONTINUE][send-cancel] reason=user-refused-overwrite existingChars=${existingText.length}`);
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=user-refused-overwrite`);
          return { ok: false, reason: 'user-refused-overwrite' };
        }
      } else if (existingText && existingText !== text) {
        safeAppendLog(`[UPLOAD_CONTINUE][auto-overwrite-draft] existingChars=${existingText.length} newChars=${text.length}`);
      }

      try {
        const okSet = typeof ComposerApi.setComposerValue === 'function'
          && ComposerApi.setComposerValue(text);
        if (!okSet) {
          setStatus('\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a\u672a\u627e\u5230\u8f93\u5165\u6846', 'warn');
          console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'composer-not-found' });
          safeAppendLog('[UPLOAD_CONTINUE][send-failed] reason=composer-not-found');
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=composer-not-found`);
          return { ok: false, reason: 'composer-not-found' };
        }
        await sleep(300);
        const sendWaitStartedAt = Date.now();
        while (typeof ComposerApi.canSendNow === 'function' && !ComposerApi.canSendNow()) {
          if (shouldStop()) {
            return { ok: false, reason: 'cancelled' };
          }
          if (Date.now() - sendWaitStartedAt >= 60000) {
            setStatus('\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a\u53d1\u9001\u6309\u94ae\u7b49\u5f85\u8d85\u65f6', 'warn');
            console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'send-button-wait-timeout' });
            safeAppendLog('[UPLOAD_CONTINUE][send-failed] reason=send-button-wait-timeout');
            safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=send-button-wait-timeout`);
            return { ok: false, reason: 'send-button-wait-timeout' };
          }
          await sleep(250);
        }
        if (typeof ComposerApi.clickSend !== 'function') {
          setStatus('\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a\u53d1\u9001 API \u4e0d\u53ef\u7528', 'warn');
          console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'send-api-missing' });
          safeAppendLog('[UPLOAD_CONTINUE][send-failed] reason=send-api-missing');
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=send-api-missing`);
          return { ok: false, reason: 'send-api-missing' };
        }
        if (shouldStop()) {
          return { ok: false, reason: 'cancelled' };
        }
        const clicked = ComposerApi.clickSend();
        if (!clicked) {
          setStatus('\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a\u70b9\u51fb\u53d1\u9001\u5931\u8d25', 'warn');
          console.warn('[UPLOAD_CONTINUE][SEND_FAILED]', { source, reason: 'click-send-failed' });
          safeAppendLog('[UPLOAD_CONTINUE][send-failed] reason=click-send-failed');
          safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=click-send-failed`);
          return { ok: false, reason: 'click-send-failed' };
        }
        setStatus('已发送继续指令', 'success');
        console.warn('[UPLOAD_CONTINUE][SEND_OK]', { source, reason: 'composer-click-send' });
        safeAppendLog(`[UPLOAD_CONTINUE][sent] chars=${text.length} stopSignal=${stopSignal}`);
        safeAppendLog(`[UPLOAD_CONTINUE][SEND_OK] source=${sourceText} reason=composer-click-send`);
        return { ok: true, reason: 'composer-click-send' };
      } catch (err) {
        const errText = formatToolboxError(err);
        console.error('[ChatGPT toolbox] send continue message failed', err);
          setStatus(`\u53d1\u9001\u7ee7\u7eed\u5931\u8d25\uff1a${errText}`, 'error');
        safeAppendLog(`[UPLOAD_CONTINUE][send-failed] error=${errText}`);
        safeAppendLog(`[UPLOAD_CONTINUE][SEND_FAILED] source=${sourceText} reason=${errText}`);
        return { ok: false, reason: errText };
      }
    }

    function getLastAssistantMessageTextForStopSignal() {
      const assistantNodes = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]'),
      );

      const lastNode = assistantNodes.length > 0
        ? assistantNodes[assistantNodes.length - 1]
        : null;

      if (!lastNode) {
        return '';
      }

      return String(lastNode.innerText || lastNode.textContent || '').trim();
    }

    function detectCopyHotkeyLoopStopSignal(cycleIndex) {
      const indexText = String(cycleIndex == null ? '-' : cycleIndex);
      const candidates = [];

      const domText = getLastAssistantMessageTextForStopSignal();
      if (domText) {
        candidates.push({ source: 'dom-latest-assistant', text: domText });
      }

      try {
        if (
          typeof ChatMessageExtractor !== 'undefined'
          && ChatMessageExtractor
          && typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser === 'function'
          && (typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
            || typeof ChatMessageExtractor.buildRecords === 'function')
        ) {
          const records = typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
            ? ChatMessageExtractor.getFastTailMessageRecords({ includeHidden: false })
            : ChatMessageExtractor.buildRecords({ includeEmpty: false });
          const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
          if (picked && picked.ok && picked.record) {
            const recordText = String(picked.record.text || '').trim();
            if (recordText) {
              candidates.push({ source: 'extractor-record', text: recordText });
            }
          }
        }
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[COPY_HOTKEY_CONTINUE_LOOP][detect-stop-signal-error]', {
          index: cycleIndex,
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][detect-stop-signal-error] index=${indexText} error=${errText}`,
        );
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][detect-stop-signal-error] index=${indexText} error=${errText}`,
          );
        }
      }

      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const matched = hasAssistantDoneSignalInText(
          candidate.text,
          'COPY_HOTKEY_CONTINUE_LOOP',
          'loop-detect',
          `index=${indexText} source=${candidate.source}`,
        );
        if (matched) {
          const preview = formatDoneSignalPreview(candidate.text);
          const hitLine = `[COPY_HOTKEY_CONTINUE_LOOP][assistant-done-signal] index=${indexText} source=${candidate.source} preview=${preview}`;
          safeAppendLog(hitLine);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(hitLine);
          }
          return {
            matched: true,
            reason: 'assistant-done-signal',
            source: candidate.source,
          };
        }
      }

      return {
        matched: false,
        reason: 'not-matched',
      };
    }

    function isAssistantBusyReason(reason) {
      const text = String(reason || '').toLowerCase();
      return (
        text.includes('assistant_busy')
        || text.includes('busy')
        || text.includes('generating')
        || text.includes('send_not_confirmed')
      );
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

        const copyResult = await copyLatestAssistantReplyUnified({
          reason: `copy-and-continue:${String(source || '-')}`,
          scrollBeforeCopy: true,
          scrollAfterCopy: true,
          prefilledText: waitResult.text,
        });

        if (!copyResult || copyResult.ok !== true) {
          const failReason = copyResult && copyResult.reason ? copyResult.reason : 'copy-failed';
          ToolboxShell.appendLog(`[UPLOAD_COPY_CONTINUE][abort] reason=${failReason}`);
          setStatus('复制最后回复失败：剪贴板 API 不可用', 'error');
          return false;
        }

        copyTaskStatus = 'copied';

        ToolboxShell.appendLog(
          `[UPLOAD_COPY_CONTINUE][copied] chars=${copyResult.chars || 0}`,
        );

        void playCopySuccessBeepSafe(source || '-', 'copyContinue');

        copyTaskStatus = 'sending_continue';
        if (btn) {
          btn.textContent = '发送继续...';
          btn.disabled = true;
        }

        const sentResult = await sendContinuePromptFromUnifiedPipeline('copy-continue-after-wait');

        if (!sentResult || !sentResult.ok) {
          ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][failed] reason=continue-send-failed');
          return false;
        }

        copyTaskStatus = 'done';
        setStatus('已复制最后回复，并发送：继续', 'success');
        ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][done] copied=1 sent=1');
        setButtonTemporaryOk(btn);

        return true;
      } catch (error) {
        copyTaskStatus = 'failed';
        const errText = formatToolboxError(error);
        console.error('[ChatGPT toolbox] copyLastMessageAndContinue failed', error);
        ToolboxShell.appendLog(`[UPLOAD_COPY_CONTINUE][failed] error=${errText}`);
        setStatus(`复制并继续失败：${errText}`, 'error');
        setButtonTemporaryError(btn, '复制失败', 1200);
        return false;
      } finally {
        copyContinueTaskRunning = false;
        copyContinueTaskStartedAt = 0;
        if (copyTaskStatus !== 'done' && copyTaskStatus !== 'failed') {
          copyTaskStatus = 'idle';
        }

        setCopyContinueButtonBusy(btn, false);

        if (btn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(btn, 'task_done');
        }

        renderUploadButtonsOnly();
      }
    }


    function buildAssistantMessageKeyFromRecord(record, textOverride = '') {
      const recordObj = record && typeof record === 'object' ? record : null;
      if (!recordObj) {
        return '';
      }
      const text = typeof ChatMessageExtractor !== 'undefined'
        && typeof ChatMessageExtractor.cleanMessageText === 'function'
        ? ChatMessageExtractor.cleanMessageText(textOverride || recordObj.text || '').trim()
        : String(textOverride || recordObj.text || '').trim();
      const turnId = String(recordObj.turn_id || '').trim();
      if (turnId) {
        return turnId;
      }
      return [
        turnId,
        text,
        String(recordObj.char_count || 0),
        String(recordObj.no_space_char_count || 0),
      ].join('||');
    }

    function getLastAssistantMessageKeySafe() {
      try {
        if (
          typeof ChatMessageExtractor === 'undefined'
          || typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser !== 'function'
          || (typeof ChatMessageExtractor.getFastTailMessageRecords !== 'function'
            && typeof ChatMessageExtractor.buildRecords !== 'function')
        ) {
          return '';
        }
        const records = typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
          ? ChatMessageExtractor.getFastTailMessageRecords({ includeHidden: false })
          : ChatMessageExtractor.buildRecords({ includeEmpty: false });
        const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
        if (!picked || !picked.ok || !picked.record) {
          return '';
        }
        return buildAssistantMessageKeyFromRecord(picked.record);
      } catch (error) {
        console.error('[COPY_HOTKEY_CONTINUE_LOOP][get-key-failed]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        return '';
      }
    }

    function logCopyHotkeyContinueStep(sourceText, step) {
      ToolboxShell.appendLog(
        `[COPY_HOTKEY_CONTINUE][STEP] source=${sourceText || '-'} step=${step}`,
      );
      console.warn('[COPY_HOTKEY_CONTINUE][STEP]', {
        source: sourceText || '-',
        step,
      });
    }

    function isCopyAndHotkeyShortcut(event) {
      const item = getCopyAndHotkeyShortcutConfig();
      return isShortcutEventMatched(event, item);
    }

    async function handleCopyHotkeyOnceTrigger(source = 'button', event = null) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }

      const sourceText = String(source || 'button').trim() || 'button';
      const actionSource = sourceText === 'delegated-click' ? 'button' : sourceText;

      if (actionSource === 'shortcut') {
        ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][shortcut-trigger]');
      } else {
        ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][click] source=button');
      }

      try {
        return await runCopyAndHotkeyAction(actionSource);
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const failTag = actionSource === 'shortcut'
          ? '[COPY_HOTKEY_ONCE][SHORTCUT_FAILED]'
          : '[COPY_HOTKEY_ONCE][CLICK_FAILED]';

        console.error(failTag, {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        ToolboxShell.appendLog(`${failTag} ${errText}`);
        setStatus(`复制+快捷键失败：${errText}`, 'error');

        return {
          ok: false,
          reason: 'exception',
          detail: errText,
          copied: false,
          hotkeySent: false,
        };
      }
    }

    function bindCopyAndHotkeyShortcut() {
      if (window.__xzCopyAndHotkeyShortcutBound) {
        ToolboxShell.appendLog('[SHORTCUT][bind-skip] copyAndHotkeyOnce=already-bound');
        return;
      }

      window.__xzCopyAndHotkeyShortcutBound = true;

      window.addEventListener(
        'keydown',
        (event) => {
          if (!isCopyAndHotkeyShortcut(event)) {
            return;
          }

          if (event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          if (shouldIgnoreToolboxShortcutTarget(event.target)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          void handleCopyHotkeyOnceTrigger('shortcut', event);
        },
        true,
      );

      const item = getCopyAndHotkeyShortcutConfig();
      ToolboxShell.appendLog('[SHORTCUT][bind] copyAndHotkeyOnce=configurable');
      console.log('[TOOLBOX][COPY_HOTKEY][SHORTCUT_BOUND]', {
        shortcut: item.label || '-',
      });
    }

    async function runCopyAndHotkeyAction(source = 'button', options = {}) {
      const sourceText = String(source || '');
      ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][start] source=${sourceText || '-'}`);
      setStatus('正在执行复制+快捷键...', 'running');
      console.log('[TOOLBOX][COPY_HOTKEY][START]', { source: sourceText });
      const flowOptions = options && typeof options === 'object' ? options : {};
      const shouldStop = typeof flowOptions.shouldStop === 'function'
        ? flowOptions.shouldStop
        : () => false;

      const btn = rootElRef ? qs(UploadSelectors.copyHotkeyOnceBtn, rootElRef) : null;

      if (copyHotkeyOnceTaskRunning) {
        const runningMs = Date.now() - Number(copyHotkeyOnceTaskStartedAt || 0);

        if (runningMs <= 90000) {
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_ONCE][skip] reason=task-running runningMs=${runningMs}`,
          );
          return {
            ok: false,
            reason: 'task-running',
            copied: false,
            hotkeySent: false,
          };
        }

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_ONCE][stale-release] runningMs=${runningMs}`,
        );
        copyHotkeyOnceTaskRunning = false;
        copyHotkeyOnceTaskStartedAt = 0;
      }

      if (copyHotkeyContinueTaskRunning || copyHotkeyContinueLoopRunning) {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_ONCE][skip] reason=copy-hotkey-continue-running continueTask=${copyHotkeyContinueTaskRunning ? '1' : '0'} loop=${copyHotkeyContinueLoopRunning ? '1' : '0'}`,
        );
        setStatus('复制+快捷键失败：当前已有复制+快捷键任务运行中', 'warn');
        return {
          ok: false,
          reason: 'copy-hotkey-continue-running',
          copied: false,
          hotkeySent: false,
        };
      }

      copyHotkeyOnceTaskRunning = true;
      copyHotkeyOnceTaskStartedAt = Date.now();

      if (btn && typeof startButtonLongWaitDangerTimer === 'function') {
        startButtonLongWaitDangerTimer(btn, 'long_wait_reply_or_hotkey', BUTTON_LONG_WAIT_DANGER_MS);
      }

      try {
        if (btn) {
          btn.dataset.busy = '1';
          btn.disabled = true;
          btn.textContent = '等待回复...';
        }

        setStatus('正在等待回答完成，然后复制并发送快捷键', 'running');

        const waitResult = await waitAssistantStableForCopyContinue(source, { shouldStop });

        if (!waitResult || !waitResult.ok) {
          const reason = waitResult && waitResult.reason
            ? waitResult.reason
            : 'wait-assistant-failed';

          ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][abort] reason=${reason}`);
          setStatus(`复制+快捷键失败：${reason}`, 'warn');

          return {
            ok: false,
            reason,
            copied: false,
            hotkeySent: false,
          };
        }

        if (!waitResult.text || !String(waitResult.text).trim()) {
          ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][abort] reason=empty-assistant-text');
          setStatus('复制+快捷键失败：最后回复为空', 'warn');

          return {
            ok: false,
            reason: 'empty-assistant-text',
            copied: false,
            hotkeySent: false,
          };
        }

        if (shouldStop()) {
          ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][abort] reason=cancelled-before-copy');
          return {
            ok: false,
            reason: 'cancelled',
            copied: false,
            hotkeySent: false,
          };
        }

        if (btn) {
          btn.textContent = '复制中...';
        }

        const copyResult = await copyLatestAssistantReplyUnified({
          reason: `copy-and-hotkey:${sourceText || '-'}`,
          scrollBeforeCopy: true,
          scrollAfterCopy: true,
          prefilledText: waitResult.text,
        });

        if (!copyResult || copyResult.ok !== true) {
          const failReason = copyResult && copyResult.reason ? copyResult.reason : 'copy-failed';
          const errText = copyResult && copyResult.error ? copyResult.error : failReason;
          console.error('[COPY_HOTKEY_ONCE][COPY_FAILED]', {
            source: sourceText,
            reason: failReason,
            error: errText,
          });
          ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][failed] reason=${failReason} detail=${errText}`);
          setStatus(`复制+快捷键失败：${errText}`, 'error');
          return {
            ok: false,
            reason: failReason,
            detail: errText,
            copied: false,
            hotkeySent: false,
          };
        }

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_ONCE][copied] chars=${copyResult.chars || 0}`,
        );

        if (btn) {
          btn.textContent = '确认剪贴板...';
        }

        const clipboardReady = await ensureClipboardReadyBeforeSystemHotkey(
          copyResult.text || waitResult.text,
          'copy-and-hotkey',
        );

        if (!clipboardReady || clipboardReady.ok !== true) {
          const failReason = clipboardReady && clipboardReady.reason ? clipboardReady.reason : 'clipboard-not-ready';
          const errText = clipboardReady && clipboardReady.error ? clipboardReady.error : failReason;
          ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][failed] reason=${failReason} detail=${errText}`);
          setStatus(`复制+快捷键失败：剪贴板未就绪：${errText}`, 'error');
          return {
            ok: false,
            reason: failReason,
            detail: errText,
            copied: false,
            hotkeySent: false,
          };
        }

        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(sourceText || '-', 'copyHotkeyOnce');
        }

        if (shouldStop()) {
          ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][abort] reason=cancelled-after-copy');
          return {
            ok: false,
            reason: 'cancelled',
            copied: true,
            hotkeySent: false,
          };
        }

        if (btn) {
          btn.textContent = '发送快捷键...';
        }

        const hotkeyResult = await sendConfiguredHotkey('copy-and-hotkey');

        if (!hotkeyResult || !hotkeyResult.ok) {
          ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][failed] reason=hotkey-failed');
          setStatus('复制成功，但 Ctrl+Alt+I 执行失败', 'error');

          return {
            ok: false,
            reason: 'hotkey-failed',
            copied: true,
            hotkeySent: false,
          };
        }

        ToolboxShell.appendLog('[COPY_HOTKEY_ONCE][done] copied=1 hotkey=1 continue=0');
        setStatus('已复制最后回复，并发送 Ctrl+Alt+I', 'success');

        if (btn) {
          setButtonTemporaryOk(btn);
        }

        return {
          ok: true,
          reason: 'ok',
          copied: true,
          hotkeySent: true,
          continueSent: false,
          copied_text: String(waitResult.text || ''),
        };
      } catch (error) {
        const errText = formatToolboxError(error);

        console.error('[COPY_HOTKEY_ONCE][ERROR]', {
          source: sourceText,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });

        ToolboxShell.appendLog(`[COPY_HOTKEY_ONCE][failed] source=${sourceText || '-'} error=${errText}`);
        setStatus(`复制+快捷键失败：${errText}`, 'error');

        if (btn) {
          setButtonTemporaryError(btn, '执行失败', 1200);
        }

        return {
          ok: false,
          reason: 'exception',
          detail: errText,
          copied: false,
          hotkeySent: false,
        };
      } finally {
        copyHotkeyOnceTaskRunning = false;
        copyHotkeyOnceTaskStartedAt = 0;

        if (btn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(btn, 'finally');
        }

        if (btn) {
          btn.dataset.busy = '0';
          btn.disabled = false;
          btn.textContent = '复制+快捷键';
        }

        renderUploadButtonsOnly();
      }
    }

    const copyAndSendHotkeyOnce = runCopyAndHotkeyAction;

    async function copyHotkeyAndContinueOnce(source = 'button', options = {}) {
      const sourceText = String(source || '');
      const flowOptions = options && typeof options === 'object' ? options : {};
      const shouldStop = typeof flowOptions.shouldStop === 'function' ? flowOptions.shouldStop : () => false;
      const isLoopMode = sourceText.startsWith('loop-') || copyHotkeyContinueLoopRunning === true;
      const btn = rootElRef ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef) : null;
      if (copyHotkeyContinueTaskRunning) {
        const runningMs = Date.now() - Number(copyHotkeyContinueTaskStartedAt || 0);
        if (runningMs <= 90000) {
          if (isLoopMode) {
            ToolboxShell.appendLog(
              `[COPY_HOTKEY_CONTINUE][loop-force-release] runningMs=${runningMs} source=${sourceText}`,
            );
            copyHotkeyContinueTaskRunning = false;
            copyHotkeyContinueTaskStartedAt = 0;
          } else {
            ToolboxShell.appendLog(
              `[COPY_HOTKEY_CONTINUE][skip] reason=task-running runningMs=${runningMs}`,
            );
            return {
              ok: false,
              assistantDoneSignal: false,
              reason: 'task-running',
              source: sourceText,
              loopMode: isLoopMode,
              copied: false,
              hotkeySent: false,
              continueSent: false,
              assistantMessageKey: '',
            };
          }
        } else {
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][stale-release] runningMs=${runningMs}`,
          );
          copyHotkeyContinueTaskRunning = false;
          copyHotkeyContinueTaskStartedAt = 0;
        }
      }
      copyHotkeyContinueTaskRunning = true;
      copyHotkeyContinueTaskStartedAt = Date.now();
      const loopOnceBtn = isLoopMode && rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef)
        : null;
      const waitDangerBtn = (!isLoopMode && btn) ? btn : loopOnceBtn;
      if (waitDangerBtn && typeof startButtonLongWaitDangerTimer === 'function') {
        startButtonLongWaitDangerTimer(waitDangerBtn, 'long_wait_reply_or_send', BUTTON_LONG_WAIT_DANGER_MS);
      }
      try {
        if (btn && !isLoopMode) {
          btn.dataset.busy = '1';
          btn.disabled = true;
          btn.textContent = '等待回复...';
        }
        if (!isLoopMode) {
          setStatus('正在等待回答完成，然后复制并发送快捷键', 'running');
        }
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE][start] source=${sourceText || '-'}`,
        );

        logCopyHotkeyContinueStep(sourceText, 'wait-reply');
        const waitResult = await waitAssistantStableForCopyContinue(source, { shouldStop });
        if (!waitResult || !waitResult.ok) {
          const reason = waitResult && waitResult.reason ? waitResult.reason : 'wait-assistant-failed';
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][abort] reason=${reason}`,
          );
          if (!isLoopMode) {
            setStatus(`复制+快捷键+继续失败：${reason}`, 'warn');
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: reason || 'wait-assistant-failed',
            source: sourceText,
            loopMode: isLoopMode,
            copied: false,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey: '',
          };
        }
        if (!waitResult.text || !String(waitResult.text).trim()) {
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][abort] reason=empty-assistant-text');
          if (!isLoopMode) {
            setStatus('复制+快捷键+继续失败：最后回复为空', 'warn');
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'empty-assistant-text',
            source: sourceText,
            loopMode: isLoopMode,
            copied: false,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey: '',
          };
        }

        const assistantMessageKey = buildAssistantMessageKeyFromRecord(
          waitResult.record,
          waitResult.text,
        ) || getLastAssistantMessageKeySafe();

        const assistantRawText = String(waitResult.text || '').trim();
        const assistantDoneSignalMatched = hasAssistantDoneSignalInText(
          assistantRawText,
          'COPY_HOTKEY_CONTINUE',
          'after-wait',
          `source=${sourceText || '-'}`,
          flowOptions,
        );

        if (assistantDoneSignalMatched) {
          const doneSignalLine = `[COPY_HOTKEY_CONTINUE][assistant-done-signal] source=${sourceText || '-'} key=${assistantMessageKey || '-'}`;
          safeAppendLog(doneSignalLine);
          console.warn('[COPY_HOTKEY_CONTINUE][assistant-done-signal]', {
            source: sourceText || '-',
            key: assistantMessageKey || '-',
            preview: formatDoneSignalPreview(assistantRawText),
          });
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(doneSignalLine);
          }

          setStatus('检测到终止信号，任务已完成，不再继续', 'success');

          return {
            ok: true,
            assistantDoneSignal: true,
            reason: 'assistant-done-signal',
            source: sourceText,
            loopMode: isLoopMode,
            copied: false,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        if (shouldStop()) {
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'cancelled',
            source: sourceText,
            loopMode: isLoopMode,
            copied: false,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        logCopyHotkeyContinueStep(sourceText, 'copy-last-reply');
        if (btn && !isLoopMode) {
          btn.textContent = '复制中...';
        }

        const copyResult = await copyLatestAssistantReplyUnified({
          reason: `copy-hotkey-continue:${sourceText || '-'}`,
          scrollBeforeCopy: true,
          scrollAfterCopy: true,
          prefilledText: waitResult.text,
        });

        if (!copyResult || copyResult.ok !== true) {
          const failReason = copyResult && copyResult.reason ? copyResult.reason : 'copy-failed';
          const errText = copyResult && copyResult.error ? copyResult.error : failReason;
          console.error('[COPY_HOTKEY_CONTINUE][COPY_FAILED]', {
            source: sourceText,
            loopMode: isLoopMode,
            reason: failReason,
            error: errText,
          });
          ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][failed] reason=${failReason} detail=${errText}`);
          if (!isLoopMode) {
            setStatus(`复制+快捷键+继续失败：${errText}`, 'error');
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: failReason,
            detail: errText,
            source: sourceText,
            loopMode: isLoopMode,
            copied: false,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE][copied] chars=${copyResult.chars || 0}`,
        );

        if (btn && !isLoopMode) {
          btn.textContent = '确认剪贴板...';
        }

        const clipboardReady = await ensureClipboardReadyBeforeSystemHotkey(
          copyResult.text || waitResult.text,
          'copy-hotkey-continue',
        );

        if (!clipboardReady || clipboardReady.ok !== true) {
          const failReason = clipboardReady && clipboardReady.reason ? clipboardReady.reason : 'clipboard-not-ready';
          const errText = clipboardReady && clipboardReady.error ? clipboardReady.error : failReason;
          ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][failed] reason=${failReason} detail=${errText}`);
          if (!isLoopMode) {
            setStatus(`复制+快捷键+继续失败：剪贴板未就绪：${errText}`, 'error');
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: failReason,
            detail: errText,
            source: sourceText,
            loopMode: isLoopMode,
            copied: false,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(sourceText || '-', 'copyHotkeyContinue');
        }

        if (shouldStop()) {
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'cancelled',
            source: sourceText,
            loopMode: isLoopMode,
            copied: true,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }

        logCopyHotkeyContinueStep(sourceText, 'send-hotkey');
        if (btn && !isLoopMode) {
          btn.textContent = '发送快捷键...';
        }
        const hotkeyResult = await sendConfiguredHotkey('copy-hotkey-continue');
        const hotkeyOk = !!(hotkeyResult && hotkeyResult.ok);
        if (!hotkeyOk) {
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][failed] reason=hotkey-failed');
          if (!isLoopMode) {
            setStatus('复制成功，但 Ctrl+Alt+I 执行失败', 'error');
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'hotkey-failed',
            source: sourceText,
            loopMode: isLoopMode,
            copied: true,
            hotkeySent: false,
            continueSent: false,
            assistantMessageKey,
          };
        }
        await sleep(300);

        if (shouldStop()) {
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'cancelled',
            source: sourceText,
            loopMode: isLoopMode,
            copied: true,
            hotkeySent: true,
            continueSent: false,
            assistantMessageKey,
          };
        }

        logCopyHotkeyContinueStep(sourceText, 'send-continue');
        if (btn && !isLoopMode) {
          btn.textContent = '发送继续指令...';
        }
        const continueSource = sourceText || 'copy-hotkey-continue-once';
        const loopContinuePromptTxt = getCopyHotkeyContinuePromptText(flowOptions);
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][continue-prompt] index=${copyHotkeyContinueLoopCount + 1} length=${loopContinuePromptTxt.length}`);
        const continueResult = await sendContinuePromptFromUnifiedPipeline(continueSource, flowOptions);
        if (!continueResult || !continueResult.ok) {
          const detail = continueResult && continueResult.reason ? continueResult.reason : '';
          if (
            detail === 'assistant-done-signal-before-send'
            || (continueResult && continueResult.assistantDoneSignal === true)
          ) {
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE][assistant-done-signal] source=${sourceText || '-'} reason=${detail || 'assistant-done-signal-before-send'}`,
            );
            setStatus('检测到终止信号，任务已完成，不再继续', 'success');
            return {
              ok: true,
              assistantDoneSignal: true,
              reason: detail || 'assistant-done-signal-before-send',
              source: sourceText,
              loopMode: isLoopMode,
              copied: true,
              hotkeySent: true,
              continueSent: false,
              assistantMessageKey,
            };
          }
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][failed] reason=continue-send-failed detail=${detail || '-'}`,
          );
          if (!isLoopMode) {
            setStatus('复制和快捷键已完成，但发送继续指令失败', 'error');
          }
          return {
            ok: false,
            assistantDoneSignal: false,
            reason: 'continue-send-failed',
            detail,
            source: sourceText,
            loopMode: isLoopMode,
            copied: true,
            hotkeySent: true,
            continueSent: false,
            assistantMessageKey,
          };
        }
        ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][done] copied=1 hotkey=1 continue=1');
        if (!isLoopMode) {
          setStatus('已复制最后回复，已发送 Ctrl+Alt+I，并发送继续指令', 'success');
          if (btn) {
            setButtonTemporaryOk(btn);
          }
        }
        return {
          ok: true,
          assistantDoneSignal: false,
          reason: 'ok',
          source: sourceText,
          loopMode: isLoopMode,
          copied_text: String(waitResult.text || ''),
          assistantMessageKey,
          continueSent: true,
          continueReason: continueResult && continueResult.reason ? continueResult.reason : '',
          hotkeySent: true,
          copied: true,
        };
      } catch (error) {
        const errText = formatToolboxError(error);
        console.error('[COPY_HOTKEY_CONTINUE][ERROR]', {
          source: sourceText,
          loopMode: isLoopMode,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][failed] source=${sourceText} error=${errText}`);
        if (!isLoopMode) {
          setStatus(`复制+快捷键+继续失败：${errText}`, 'error');
          if (btn) {
            setButtonTemporaryError(btn, '执行失败', 1200);
          }
        }
        return {
          ok: false,
          assistantDoneSignal: false,
          reason: 'exception',
          detail: errText,
          source: sourceText,
          loopMode: isLoopMode,
          copied: false,
          hotkeySent: false,
          continueSent: false,
          assistantMessageKey: '',
        };
      } finally {
        copyHotkeyContinueTaskRunning = false;
        copyHotkeyContinueTaskStartedAt = 0;

        if (waitDangerBtn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(
            waitDangerBtn,
            isLoopMode ? 'loop-cycle-finally' : 'finally',
          );
        }

        if (!isLoopMode) {
          if (btn) {
            btn.dataset.busy = '0';
            btn.disabled = false;
            btn.textContent = '复制+快捷键+继续';
          }
          renderUploadButtonsOnly();
        } else {
          safeAppendLog(`[COPY_HOTKEY_CONTINUE][KEEP_LOOP_STATE] source=${sourceText}`);
          console.warn('[COPY_HOTKEY_CONTINUE][KEEP_LOOP_STATE]', {
            source: sourceText,
            running: copyHotkeyContinueLoopRunning,
          });
        }
      }
    }

    async function runCopyHotkeyContinueOnceForTaskQueue(options = {}) {
      const flowOptions = options && typeof options === 'object' ? options : {};
      const source = String(flowOptions.source || 'task-queue').trim() || 'task-queue';
      const result = await copyHotkeyAndContinueOnce(source, flowOptions);
      return {
        ok: !!(result && result.ok),
        assistantDoneSignal: !!(result && result.assistantDoneSignal),
        reason: result && result.reason ? String(result.reason) : (result && result.ok ? 'ok' : 'unknown'),
        copied: !!(result && result.copied),
        hotkeySent: !!(result && result.hotkeySent),
        continueSent: !!(result && result.continueSent),
        copied_text: result && result.copied_text ? String(result.copied_text) : '',
        assistantMessageKey: result && result.assistantMessageKey ? String(result.assistantMessageKey) : '',
      };
    }

    async function waitAssistantCycleAfterContinue(source, previousKey) {
      const sourceText = String(source || '');
      const prevKey = String(previousKey || '');
      const startedAt = Date.now();
      const maxWaitMs = 180000;
      let sawBusy = false;

      safeAppendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-start] source=${sourceText} previousKey=${prevKey || '-'}`,
      );

      while (Date.now() - startedAt < maxWaitMs) {
        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          safeAppendLog('[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-page-navigating]');
          return false;
        }

        if (copyHotkeyContinueLoopStopRequested) {
          safeAppendLog('[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-stop-requested]');
          return false;
        }

        let busy = false;

        try {
          busy = (
            typeof ComposerApi !== 'undefined'
            && ComposerApi
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy()
          );
        } catch (error) {
          console.error('[COPY_HOTKEY_CONTINUE_LOOP][busy-check-failed]', {
            source: sourceText,
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          busy = false;
        }

        if (busy) {
          sawBusy = true;
        }

        const nextKey = getLastAssistantMessageKeySafe();

        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-poll] previousKey=${prevKey || '-'} nextKey=${nextKey || '-'} same=${nextKey && nextKey === prevKey ? '1' : '0'} busy=${busy ? '1' : '0'} sawBusy=${sawBusy ? '1' : '0'}`,
        );

        if (nextKey && prevKey && nextKey !== prevKey && !busy) {
          await sleep(600);
          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-done-by-poll] previousKey=${prevKey} nextKey=${nextKey}`,
          );
          return true;
        }

        if (sawBusy && !busy) {
          await sleep(800);
          const keyAfterIdle = getLastAssistantMessageKeySafe();
          if (!prevKey || keyAfterIdle !== prevKey) {
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-done] previousKey=${prevKey || '-'} nextKey=${keyAfterIdle || '-'}`,
            );
            return true;
          }
        }

        await sleep(1500);
      }

      safeAppendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][wait-cycle-timeout] source=${sourceText} previousKey=${prevKey || '-'} maxWaitMs=${maxWaitMs}`,
      );
      setStatus('连续复制+快捷键+继续：等待下一轮回复超时', 'warn');
      return false;
    }

    
    function getCopyHotkeyLoopAutomationConfig() {
      const cfg = getCompactUiConfig();

      const autoUploadInterval = Number(cfg.copyHotkeyLoopAutoUploadInterval || 5);
      const homeNavInterval = Number(cfg.copyHotkeyLoopHomeNavInterval || 20);

      return {
        autoUploadEnabled: cfg.copyHotkeyLoopAutoUploadEnabled !== false,
        autoUploadInterval: Number.isFinite(autoUploadInterval) && autoUploadInterval > 0
          ? Math.floor(autoUploadInterval)
          : 5,
        homeNavEnabled: cfg.copyHotkeyLoopHomeNavEnabled !== false,
        homeNavInterval: Number.isFinite(homeNavInterval) && homeNavInterval > 0
          ? Math.floor(homeNavInterval)
          : 20,
        homeNavUrl: String(cfg.copyHotkeyLoopHomeNavUrl || 'https://chatgpt.com/').trim() || 'https://chatgpt.com/',
      };
    }

    function isCopyHotkeyLoopIntervalHit(cycleIndex, enabled, interval) {
      const index = Number(cycleIndex) || 0;
      const step = Number(interval) || 0;

      return enabled === true && index > 0 && step > 0 && index % step === 0;
    }

    function requestCopyHotkeyLoopHomeNavigation(cycleIndex, cfg) {
      const targetUrl = String(
        cfg && cfg.homeNavUrl ? cfg.homeNavUrl : 'https://chatgpt.com/'
      ).trim() || 'https://chatgpt.com/';

      ToolboxShell.appendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][home-nav-request] index=${cycleIndex} url=${targetUrl}`
      );

      setStatus(
        `第 ${cycleIndex} 轮：正在返回 ChatGPT 首页...`,
        'running'
      );

      window.setTimeout(() => {
        try {
          window.location.assign(targetUrl);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          console.error('[COPY_HOTKEY_CONTINUE_LOOP][home-nav-failed]', {
            cycleIndex,
            targetUrl,
            error_type: error && error.name,
            error: errText,
            stack: error && error.stack,
          });
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][home-nav-failed] index=${cycleIndex} error=${errText}`
          );
          setStatus(`返回首页失败：${errText}`, 'error');
        }
      }, 600);
    }

    async function runCopyHotkeyLoopPostCycleActions(cycleIndex) {
      const cfg = getCopyHotkeyLoopAutomationConfig();

      const shouldHomeNav = isCopyHotkeyLoopIntervalHit(
        cycleIndex,
        cfg.homeNavEnabled,
        cfg.homeNavInterval,
      );

      if (shouldHomeNav) {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][post-cycle] action=home-nav index=${cycleIndex} uploadSkipped=1`
        );

        requestCopyHotkeyLoopHomeNavigation(cycleIndex, cfg);

        return {
          stop: true,
          reason: 'home-nav',
        };
      }

      const shouldAutoUpload = isCopyHotkeyLoopIntervalHit(
        cycleIndex,
        cfg.autoUploadEnabled,
        cfg.autoUploadInterval,
      );

      if (!shouldAutoUpload) {
        return {
          stop: false,
          reason: 'no-action',
        };
      }

      ToolboxShell.appendLog(
        `[COPY_HOTKEY_CONTINUE_LOOP][post-cycle] action=auto-upload index=${cycleIndex} interval=${cfg.autoUploadInterval}`
      );

      setStatus(
        `第 ${cycleIndex} 轮：正在自动上传...`,
        'running'
      );

      try {
        const uploadResult = await startUploadFromCurrentQueue({
          source: `copy-hotkey-loop-auto-upload-${cycleIndex}`,
        });

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][auto-upload-done] index=${cycleIndex} ok=${uploadResult && uploadResult.ok ? '1' : '0'} uploaded=${uploadResult && uploadResult.uploadedCount != null ? uploadResult.uploadedCount : '-'} failed=${uploadResult && uploadResult.failedCount != null ? uploadResult.failedCount : '-'} skipped=${uploadResult && uploadResult.skippedCount != null ? uploadResult.skippedCount : '-'} reason=${uploadResult && uploadResult.reason ? uploadResult.reason : '-'}`
        );

        return {
          stop: false,
          reason: 'auto-upload-done',
          uploadResult,
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);

        console.error('[COPY_HOTKEY_CONTINUE_LOOP][auto-upload-failed]', {
          cycleIndex,
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][auto-upload-failed] index=${cycleIndex} error=${errText}`
        );

        setStatus(`第 ${cycleIndex} 轮自动上传失败：${errText}`, 'error');

        return {
          stop: false,
          reason: 'auto-upload-failed',
          error: errText,
        };
      }
    }

    async function toggleCopyHotkeyContinueLoop(source = 'button') {
      const btn = rootElRef ? qs(UploadSelectors.copyHotkeyContinueLoopBtn, rootElRef) : null;
      if (copyHotkeyContinueLoopRunning) {
        copyHotkeyContinueLoopStopRequested = true;
        setStatus('正在停止连续复制+快捷键+继续...', 'warn');
        ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE_LOOP][stop-requested]');
        if (btn) {
          btn.textContent = '停止中...';
          btn.disabled = true;
        }
        return true;
      }
      copyHotkeyContinueLoopRunning = true;
      copyHotkeyContinueLoopStopRequested = false;
      copyHotkeyContinueLoopCount = 0;
      copyHotkeyContinueLoopStartedAt = Date.now();
      if (btn) {
        btn.dataset.running = '1';
        btn.textContent = '停止连续';
      }
      setStatus('连续复制+快捷键+继续已启动', 'running');
      renderUploadButtonsOnly();
      safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][start] source=${String(source || '-')}`);
      let loopStopReason = 'natural-end';
      try {
        while (!copyHotkeyContinueLoopStopRequested) {
          copyHotkeyContinueLoopCount += 1;
          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][cycle-start] index=${copyHotkeyContinueLoopCount}`,
          );
          const result = await copyHotkeyAndContinueOnce(`loop-${copyHotkeyContinueLoopCount}`);

          if (
            result
            && (
              result.assistantDoneSignal === true
              || result.reason === 'assistant-done-signal'
              || result.reason === 'assistant-done-signal-before-send'
            )
          ) {
            loopStopReason = 'assistant-done-signal';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=assistant-done-signal index=${copyHotkeyContinueLoopCount}`,
            );
            console.warn('[COPY_HOTKEY_CONTINUE_LOOP][stop]', {
              reason: 'assistant-done-signal',
              index: copyHotkeyContinueLoopCount,
            });
            break;
          }

          if (!result || result.ok === false) {
            const reason = result && result.reason ? result.reason : 'once-failed';
            const detail = result && result.detail ? result.detail : '';

            loopStopReason = `cycle-stop:${reason}`;

            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][cycle-stop] reason=${reason} detail=${detail || '-'} index=${copyHotkeyContinueLoopCount}`,
            );

            console.warn('[COPY_HOTKEY_CONTINUE_LOOP][CYCLE_STOP]', {
              reason,
              detail,
              index: copyHotkeyContinueLoopCount,
              result,
            });

            break;
          }

          if (copyHotkeyContinueLoopStopRequested) {
            loopStopReason = 'user-stop';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][cycle-stop] reason=user-stop index=${copyHotkeyContinueLoopCount}`,
            );
            break;
          }

          safeAppendLog(
            `[COPY_HOTKEY_CONTINUE_LOOP][before-wait-next] index=${copyHotkeyContinueLoopCount} key=${result.assistantMessageKey || '-'} reason=${result.continueReason || '-'}`,
          );

          const waited = await waitAssistantCycleAfterContinue(
            `loop-${copyHotkeyContinueLoopCount}`,
            result.assistantMessageKey || '',
          );
          if (!waited) {
            loopStopReason = copyHotkeyContinueLoopStopRequested
              ? 'user-stop'
              : 'wait-next-reply-failed';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyContinueLoopCount}`,
            );
            if (loopStopReason === 'wait-next-reply-failed') {
              console.warn('[COPY_HOTKEY_CONTINUE_LOOP][WAIT_NEXT_FAILED]', {
                index: copyHotkeyContinueLoopCount,
                previousKey: result.assistantMessageKey || '',
              });
            }
            break;
          }

          const stopSignalResult = detectCopyHotkeyLoopStopSignal(copyHotkeyContinueLoopCount);

          if (stopSignalResult && stopSignalResult.matched) {
            loopStopReason = stopSignalResult.reason || 'assistant-done-signal';

            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyContinueLoopCount}`,
            );

            break;
          }

          const postCycleAction = await runCopyHotkeyLoopPostCycleActions(copyHotkeyContinueLoopCount);

          if (postCycleAction && postCycleAction.stop) {
            loopStopReason = postCycleAction.reason || 'post-cycle-stop';

            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyContinueLoopCount}`
            );

            break;
          }
        }
      } catch (error) {
        const errText = formatToolboxError(error);
        loopStopReason = `exception:${errText}`;
        console.error('[COPY_HOTKEY_CONTINUE_LOOP][FAILED]', {
          error_type: error && error.name,
          error: errText,
          stack: error && error.stack,
        });
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][failed] error=${errText}`);
        setStatus(`连续复制+快捷键+继续失败：${errText}`, 'error');
      } finally {
        const stoppedByUser = copyHotkeyContinueLoopStopRequested;
        copyHotkeyContinueLoopRunning = false;
        copyHotkeyContinueLoopStopRequested = false;
        if (btn) {
          btn.dataset.running = '0';
          btn.disabled = false;
          btn.textContent = '连续复制+快捷键+继续';
        }
        if (stoppedByUser && loopStopReason === 'natural-end') {
          loopStopReason = 'user-stop';
        }
        if (loopStopReason === 'assistant-done-signal') {
          setStatus(
            `检测到终止信号，连续复制+快捷键+继续已结束，共执行 ${copyHotkeyContinueLoopCount} 轮`,
            'success',
          );
        } else if (stoppedByUser || loopStopReason === 'user-stop') {
          setStatus(
            `连续复制+快捷键+继续已停止，共执行 ${copyHotkeyContinueLoopCount} 轮`,
            'warn',
          );
        } else if (
          loopStopReason.startsWith('cycle-stop:')
          || loopStopReason.startsWith('exception:')
          || loopStopReason === 'wait-next-reply-failed'
        ) {
          setStatus(
            `连续复制+快捷键+继续已结束，共执行 ${copyHotkeyContinueLoopCount} 轮（${loopStopReason}）`,
            'warn',
          );
        } else {
          setStatus(
            `连续复制+快捷键+继续已结束，共执行 ${copyHotkeyContinueLoopCount} 轮`,
            'success',
          );
        }
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][finally] reason=${loopStopReason}`);
        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][done] cycles=${copyHotkeyContinueLoopCount} stoppedByUser=${stoppedByUser ? '1' : '0'} reason=${loopStopReason}`,
        );
        const loopOnceBtn = rootElRef
          ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef)
          : null;
        if (loopOnceBtn && typeof clearButtonLongWaitDangerTimer === 'function') {
          clearButtonLongWaitDangerTimer(loopOnceBtn, 'loop-finally');
        }
        renderUploadButtonsOnly();
      }
      return true;
    }

    function buildFlaskUploadListHtml() {
      const flaskRows = (state.flaskFiles || []).filter(
        (row) => row && row.status !== 'uploaded',
      );

      return flaskRows.map((row) => {
        const itemTitle = escapeHtml([
          `文件名：${row.name || '-'}`,
          `大小：${formatBytes(row.size)}`,
          '来源：本地直读',
          row.download_url ? `下载：${row.download_url}` : '',
        ].filter(Boolean).join('\n'));

        return `
            <div class="cgpt-upload-item flask-local-direct" data-flask-file-id="${escapeHtml(row.file_id || '')}" title="${itemTitle}">
              <div class="cgpt-upload-file-main">
                <div class="cgpt-upload-name">${escapeHtml(row.name || 'unknown')}</div>
                <div class="cgpt-upload-meta">
                  ${escapeHtml(formatBytes(row.size))}
                  <span class="cgpt-upload-dot">·</span>
                  <span class="cgpt-upload-source-label">本地直读</span>
                </div>
              </div>
            </div>
          `;
      }).join('');
    }

    function buildDropSignature(dataTransfer) {
      const files = Array.from(dataTransfer && dataTransfer.files ? dataTransfer.files : []);

      return files
        .map((file) => [
          String(file.name || '').trim().toLowerCase(),
          Number(file.size) || 0,
          Number(file.lastModified) || 0,
          String(file.type || '').trim().toLowerCase(),
        ].join('::'))
        .sort()
        .join('||');
    }

    function shouldSkipRecentDuplicateDrop(dataTransfer) {
      const signature = buildDropSignature(dataTransfer);

      if (!signature) return false;

      const now = Date.now();

      if (signature === lastDropSignature && now - lastDropSignatureAt < 1200) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][drop:skip-recent-duplicate] signature=${signature}`
        );
        return true;
      }

      lastDropSignature = signature;
      lastDropSignatureAt = now;
      return false;
    }

    const UPLOAD_DRAG_DEPTH_PROP = '__cgptUploadDragDepthV1';
    const UPLOAD_DRAG_BIND_CLEANUP_PROP = '__cgptUploadDragBindCleanupV1';
    const MULTI_UPLOAD_DRAG_OVER_LOG_INTERVAL_MS = 800;
    let lastMultiUploadDragOverLogAt = 0;

    function getDragEventTargetTag(e) {
      const target = e && e.target instanceof Element ? e.target : null;
      if (!target) return '-';
      const id = target.id ? `#${target.id}` : '';
      const cls = target.classList && target.classList.length
        ? `.${Array.from(target.classList).slice(0, 2).join('.')}`
        : '';
      return `${target.tagName.toLowerCase()}${id}${cls}`;
    }

    function getDragTransferMeta(e) {
      const transfer = e && e.dataTransfer ? e.dataTransfer : null;
      const items = transfer && transfer.items ? Array.from(transfer.items) : [];
      const files = transfer && transfer.files ? Array.from(transfer.files) : [];
      const hasFiles = hasDraggedFiles(e);
      return {
        has_files: hasFiles,
        items_len: items.length,
        files_len: files.length,
      };
    }

    function hasDraggedFiles(e) {
      const transfer = e && e.dataTransfer ? e.dataTransfer : null;
      if (!transfer) return false;

      if (transfer.files && transfer.files.length > 0) {
        return true;
      }

      const types = transfer.types ? Array.from(transfer.types) : [];
      if (types.includes('Files')) {
        return true;
      }

      const items = transfer.items ? Array.from(transfer.items) : [];
      return items.some((item) => item && item.kind === 'file');
    }

    function isEventInToolbox(e) {
      const target = e && e.target instanceof Element ? e.target : null;
      if (!target || typeof target.closest !== 'function') {
        return false;
      }

      if (typeof isInToolbox === 'function' && isInToolbox(target)) {
        return true;
      }

      return !!target.closest(`#${APP.rootId}, #${APP.panelId}`);
    }

    function shouldLetNativeChatGptHandleDrop(e) {
      try {
        if (isEventInToolbox(e)) {
          return false;
        }

        const target = e && e.target instanceof Element ? e.target : null;
        if (!target) {
          return false;
        }

        const nativeTarget = target.closest([
          '[data-testid="composer-root"]',
          '[data-testid="composer"]',
          '#prompt-textarea',
          'textarea[name="prompt-textarea"]',
          '[data-testid="composer-textarea"]',
          'form',
          'textarea',
          '[contenteditable="true"]',
          'input[type="file"]',
        ].join(','));

        return !!nativeTarget;
      } catch (error) {
        console.error('[MULTI_UPLOAD][DROP_ERROR]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        return false;
      }
    }

    function claimUploadDropEvent(e, source) {
      if (!e) return false;

      if (e[UPLOAD_DROP_HANDLED_PROP]) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][drop:skip-already-handled] source=${source || '-'}`
        );
        return false;
      }

      e[UPLOAD_DROP_HANDLED_PROP] = {
        source: source || '',
        at: Date.now(),
      };

      return true;
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

      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = options.dropEffect || 'copy';
      }

      return true;
    }

    function setMultiUploadDragOverVisual(on) {
      const targets = [];

      if (rootElRef) {
        targets.push(rootElRef);
      }

      if (listEl) {
        targets.push(listEl);
      }

      if (rootElRef && typeof rootElRef.querySelectorAll === 'function') {
        rootElRef.querySelectorAll(
          '.toolbox-upload-drop-zone, .toolbox-upload-file-list, .toolbox-upload-empty-state',
        ).forEach((el) => {
          targets.push(el);
        });
      }

      if (panelDropEl) {
        targets.push(panelDropEl);
      }

      const seen = new Set();
      targets.forEach((el) => {
        if (!el || seen.has(el)) return;
        seen.add(el);
        el.classList.toggle('is-drag-over', on);
        el.classList.toggle('cgpt-upload-dragging', on);
      });

      if (panelDropEl) {
        panelDropEl.classList.toggle('cgpt-toolbox-file-dragover', on);
      }
    }

    function adjustMultiUploadDragDepth(hostEl, delta) {
      if (!hostEl) return 0;

      const next = Math.max(0, Number(hostEl[UPLOAD_DRAG_DEPTH_PROP] || 0) + delta);
      hostEl[UPLOAD_DRAG_DEPTH_PROP] = next;
      return next;
    }

    async function collectDroppedFilesWithHandles(transfer) {
      const result = [];
      const seen = new Set();

      function pushEntry(file, handle) {
        if (!file) return;

        const key = buildQueueFileKey(file) || buildQueueLooseFileKey(file);
        if (key && seen.has(key)) {
          return;
        }

        if (key) {
          seen.add(key);
        }

        result.push({
          file,
          handle: isFileHandleLike(handle) ? handle : null,
        });
      }

      const directFiles = Array.from(transfer && transfer.files ? transfer.files : []).filter(Boolean);
      directFiles.forEach((file) => {
        pushEntry(file, null);
      });

      if (result.length) {
        return result;
      }

      const items = Array.from(transfer && transfer.items ? transfer.items : []);
      for (const item of items) {
        if (!item || item.kind !== 'file') {
          continue;
        }

        let handle = null;
        if (typeof item.getAsFileSystemHandle === 'function') {
          try {
            handle = await item.getAsFileSystemHandle();
          } catch (handleError) {
            console.error('[MULTI_UPLOAD][DROP_ERROR]', {
              error_type: handleError && handleError.name,
              error: handleError && handleError.message,
              stack: handleError && handleError.stack,
            });
          }
        }

        const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
        pushEntry(file, handle);
      }

      return result;
    }

    async function ensureUploadProjectForDrop(source) {
      if (state.activeGroupId && state.groups.some((g) => g && g.id === state.activeGroupId)) {
        return state.activeGroupId;
      }

      if (state.groups.length) {
        ensureActiveUploadGroupIdValid(`drop-${source || 'drag'}`);
        if (state.activeGroupId) {
          return state.activeGroupId;
        }
      }

      await ensureDefaultGroupReady();

      if (state.activeGroupId) {
        return state.activeGroupId;
      }

      const dragGroup = {
        id: createId('upload_group'),
        name: '当前拖拽项目',
        key: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      dragGroup.key = deriveUploadGroupStableKey(dragGroup);

      state.groups.push(dragGroup);
      state.activeGroupId = dragGroup.id;
      state.selectedFileIdByGroup[dragGroup.id] = '';

      await persistGroups();
      await schedulePersistQueue();
      saveCurrentToolboxBaseState(`drop-${source || 'drag'}`);
      syncUploadGroupAppState();
      render();

      ToolboxShell.appendLog(
        `[MULTI_UPLOAD][DROP][CREATE_PROJECT] project_id=${dragGroup.id} name=${dragGroup.name}`,
      );

      return dragGroup.id;
    }

    async function addDroppedFiles(dropped) {
      const entries = Array.isArray(dropped) ? dropped : [];
      const files = entries.map((entry) => entry && entry.file).filter(Boolean);
      const handles = entries.map((entry) => (entry && entry.handle) || null);

      await addFiles(files, {
        handles,
        sourceKind: 'drop',
      });
    }

    async function addDroppedFilesToCurrentUploadProject(files, source) {
      const fileList = Array.from(files || []).filter(Boolean);
      const validFiles = [];

      fileList.forEach((file) => {
        if (!file || Number(file.size) <= 0) {
          console.info('[MULTI_UPLOAD][DROP_SKIP_EMPTY_FILE]', {
            name: file && file.name ? file.name : '-',
            size: file && file.size,
          });
          return;
        }

        validFiles.push(file);
      });

      if (!validFiles.length) {
        console.info('[MULTI_UPLOAD][DROP_EMPTY]');
        setStatus('没有检测到可添加的文件');
        return {
          project_id: state.activeGroupId || '',
          added_count: 0,
          total_count: getActiveGroupFiles().length,
        };
      }

      try {
        const projectId = await ensureUploadProjectForDrop(source || 'drag_drop_toolbox');
        const beforeCount = getActiveGroupFiles().length;
        const dropped = await collectDroppedFilesFromFileList(validFiles);

        await addDroppedFiles(dropped);
        dedupeActiveGroupQueue('drop');

        const afterCount = getActiveGroupFiles().length;
        const addedCount = Math.max(0, afterCount - beforeCount);

        setStatus(`已拖入：${validFiles.length} 个文件，新增：${addedCount} 个`);

        const acceptedPayload = {
          project_id: projectId || state.activeGroupId || '',
          added_count: addedCount,
          total_count: afterCount,
        };
        console.info('[MULTI_UPLOAD][DROP_ACCEPTED]', acceptedPayload);
        ToolboxShell.appendLog(
          `[MULTI_UPLOAD][DROP_ACCEPTED] project_id=${acceptedPayload.project_id} added_count=${addedCount} total_count=${afterCount}`,
        );

        return acceptedPayload;
      } catch (error) {
        console.error('[MULTI_UPLOAD][DROP_ERROR]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        setStatus(`拖拽添加失败：${error && error.message ? error.message : String(error)}`, 'error');
        throw error;
      }
    }

    function collectDroppedFilesFromFileList(files) {
      return Array.from(files || []).filter(Boolean).map((file) => ({
        file,
        handle: null,
      }));
    }

    async function handleUploadDropEvent(e, source) {
      e.preventDefault();
      e.stopPropagation();

      const transfer = e.dataTransfer;
      const sourceText = String(source || 'drag_drop_toolbox');

      if (!transfer) {
        setStatus('拖拽失败：没有文件数据');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer');
        return;
      }

      const rawFiles = Array.from(transfer.files || []).filter(Boolean);
      console.info('[MULTI_UPLOAD][DROP]', {
        files_len: rawFiles.length,
        names: rawFiles.map((file) => file.name || 'unknown'),
        source: sourceText,
      });

      if (shouldSkipRecentDuplicateDrop(transfer)) {
        setStatus('已忽略重复拖拽事件');
        return;
      }

      if (!rawFiles.length) {
        const dropped = await collectDroppedFilesWithHandles(transfer);
        if (!dropped.length) {
          console.info('[MULTI_UPLOAD][DROP_EMPTY]');
          setStatus('没有检测到可添加的文件');
          ToolboxShell.appendLog('[UPLOAD_DIAG][drop:empty]');
          return;
        }

        await addDroppedFilesToCurrentUploadProject(
          dropped.map((entry) => entry.file).filter(Boolean),
          sourceText,
        );
        return;
      }

      await addDroppedFilesToCurrentUploadProject(rawFiles, sourceText);
    }

    function bindMultiUploadDragDrop(uploadRootEl) {
      if (!(uploadRootEl instanceof HTMLElement)) {
        return;
      }

      if (uploadRootEl.dataset.dragDropBound === '1') {
        return;
      }

      uploadRootEl.dataset.dragDropBound = '1';

      const allowGlobalCapture = uploadRootEl === document;

      function shouldHandleDragEvent(e) {
        if (!hasDraggedFiles(e)) {
          return false;
        }

        if (allowGlobalCapture) {
          return prepareUploadDragEvent(e);
        }

        if (!isEventInToolbox(e)) {
          return false;
        }

        if (shouldLetNativeChatGptHandleDrop(e)) {
          return false;
        }

        e.preventDefault();
        e.stopPropagation();

        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }

        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'copy';
        }

        return true;
      }

      function onDragEnter(e) {
        if (!shouldHandleDragEvent(e)) {
          return;
        }

        const depth = adjustMultiUploadDragDepth(uploadRootEl, 1);
        if (depth === 1) {
          setMultiUploadDragOverVisual(true);
        }

        const meta = getDragTransferMeta(e);
        console.info('[MULTI_UPLOAD][DRAG_ENTER]', {
          target: getDragEventTargetTag(e),
          has_files: meta.has_files,
          items_len: meta.items_len,
        });
      }

      function onDragOver(e) {
        if (!shouldHandleDragEvent(e)) {
          return;
        }

        const now = Date.now();
        if (now - lastMultiUploadDragOverLogAt >= MULTI_UPLOAD_DRAG_OVER_LOG_INTERVAL_MS) {
          lastMultiUploadDragOverLogAt = now;
          const meta = getDragTransferMeta(e);
          console.info('[MULTI_UPLOAD][DRAG_OVER]', {
            target: getDragEventTargetTag(e),
            has_files: meta.has_files,
            items_len: meta.items_len,
          });
        }
      }

      function onDragLeave(e) {
        if (!hasDraggedFiles(e)) {
          return;
        }

        const related = e.relatedTarget instanceof Node ? e.relatedTarget : null;
        if (related && uploadRootEl.contains(related)) {
          return;
        }

        const depth = adjustMultiUploadDragDepth(uploadRootEl, -1);
        if (depth <= 0) {
          uploadRootEl[UPLOAD_DRAG_DEPTH_PROP] = 0;
          setMultiUploadDragOverVisual(false);
        }
      }

      async function onDrop(e) {
        if (!hasDraggedFiles(e)) {
          return;
        }

        if (allowGlobalCapture) {
          if (!prepareUploadDragEvent(e)) {
            return;
          }
        } else if (!isEventInToolbox(e)) {
          return;
        } else if (shouldLetNativeChatGptHandleDrop(e)) {
          return;
        } else {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
        }

        uploadRootEl[UPLOAD_DRAG_DEPTH_PROP] = 0;
        setMultiUploadDragOverVisual(false);

        if (!claimUploadDropEvent(e, allowGlobalCapture ? 'global' : 'toolbox')) {
          return;
        }

        try {
          await handleUploadDropEvent(e, 'drag_drop_toolbox');
        } catch (error) {
          console.error('[MULTI_UPLOAD][DROP_ERROR]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
        }
      }

      uploadRootEl.addEventListener('dragenter', onDragEnter, true);
      uploadRootEl.addEventListener('dragover', onDragOver, true);
      uploadRootEl.addEventListener('dragleave', onDragLeave, true);
      uploadRootEl.addEventListener('drop', onDrop, true);

      uploadRootEl[UPLOAD_DRAG_BIND_CLEANUP_PROP] = () => {
        uploadRootEl.removeEventListener('dragenter', onDragEnter, true);
        uploadRootEl.removeEventListener('dragover', onDragOver, true);
        uploadRootEl.removeEventListener('dragleave', onDragLeave, true);
        uploadRootEl.removeEventListener('drop', onDrop, true);
        uploadRootEl[UPLOAD_DRAG_DEPTH_PROP] = 0;
        delete uploadRootEl.dataset.dragDropBound;
        delete uploadRootEl[UPLOAD_DRAG_BIND_CLEANUP_PROP];
      };
    }

    function unbindMultiUploadDragDrop(uploadRootEl) {
      if (!(uploadRootEl instanceof HTMLElement)) {
        return;
      }

      const cleanup = uploadRootEl[UPLOAD_DRAG_BIND_CLEANUP_PROP];
      if (typeof cleanup === 'function') {
        cleanup();
      }
    }

    function bindGlobalDropTarget(target, name) {
      if (!target) {
        console.warn('[ChatGPT toolbox] bindGlobalDropTarget: target 为空', name);
        return;
      }

      bindMultiUploadDragDrop(target);
    }

    function unbindGlobalDropTarget(target) {
      unbindMultiUploadDragDrop(target);
    }

    function syncGlobalDocumentDropBinding() {
      const cfg = getCompactUiConfig();

      if (cfg.globalDropCaptureEnabled) {
        bindGlobalDropTarget(document, 'document');
        return;
      }

      unbindGlobalDropTarget(document);
    }

    function bindAllMultiUploadDragDropTargets() {
      panelDropEl = document.getElementById(APP.panelId) || panelDropEl;

      if (rootElRef) {
        bindMultiUploadDragDrop(rootElRef);

        const uploadSection = rootElRef.querySelector('.toolbox-upload-drop-zone');
        if (uploadSection) {
          bindMultiUploadDragDrop(uploadSection);
        }
      }

      if (listEl) {
        bindMultiUploadDragDrop(listEl);
      }

      if (panelDropEl) {
        bindMultiUploadDragDrop(panelDropEl);
      }

      const toolboxRoot = document.getElementById(APP.rootId);
      if (toolboxRoot && toolboxRoot !== panelDropEl) {
        bindMultiUploadDragDrop(toolboxRoot);
      }

      syncGlobalDocumentDropBinding();
    }

    function bindUploadDropTargets(rootEl) {
      if (rootEl) {
        bindMultiUploadDragDrop(rootEl);
      }
      bindAllMultiUploadDragDropTargets();
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

        render();
        return;
      }

      const preferred = resolveUploadGroupSelection({
        reason: 'ensure-default-upload-group',
      });

      state.activeGroupId = preferred.resolvedGroupId || '';

      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][ensure-default-group] groupId=${state.activeGroupId || '-'} source=${preferred.reason || '-'}`,
      );

      saveCurrentToolboxBaseState('ensure-default-upload-group');

      await loadQueueForActiveGroup();

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


    function buildQueueLooseFileKey(fileOrItem) {
      if (!fileOrItem) return '';

      const name = String(fileOrItem.name || '').trim().toLowerCase();
      const size = Number(fileOrItem.size) || 0;

      if (!name && !size) {
        return '';
      }

      return `${name}::${size}`;
    }

    function dedupeActiveGroupQueue(reason) {
      const groupId = state.activeGroupId;
      if (!groupId || !Array.isArray(state.queue)) return;
      const seen = new Map();
      const keep = [];
      for (const item of state.queue) {
        if (!item || item.groupId !== groupId) {
          keep.push(item);
          continue;
        }
        let key = buildQueueLooseFileKey(item);
        if (!key) {
          key = buildQueueFileKey(item);
        }
        if (!key) {
          keep.push(item);
          continue;
        }
        if (seen.has(key)) {
          const id = item.id || item._uploadId || '?';
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][dedupe-active-group:remove] reason=${reason} name=${item.name || '-'} size=${item.size || 0} id=${id}`
          );
          continue;
        }
        seen.set(key, true);
        keep.push(item);
      }
      state.queue = keep;
    }

    async function addFiles(files, options = {}) {
      const cleanFiles = Array.from(files || []).filter(Boolean);
      const handles = Array.isArray(options.handles) ? options.handles : [];

      if (!ensureActiveUploadGroupIdValid('add-files')) {
        if (!state.groups.length) {
          await ensureDefaultGroupReady();
        }
      }

      if (!state.activeGroupId) {
        setStatus('请先选择文件组');
        console.warn('[ChatGPT toolbox] addFiles blocked: activeGroupId empty');
        appendUploadGroupLog('ADD_FILE', { phase: 'blocked', reason: 'empty-activeGroupId' });
        return;
      }

      const existingKeys = new Set(
        state.queue
          .filter((item) => item.groupId === state.activeGroupId)
          .map((item) => buildQueueFileKey(item))
          .filter(Boolean)
      );

      const existingLooseKeys = new Set(
        state.queue
          .filter((item) => item.groupId === state.activeGroupId)
          .map((item) => buildQueueLooseFileKey(item))
          .filter(Boolean)
      );

      let addedCount = 0;

      cleanFiles.forEach((file, index) => {
        const fileKey = buildQueueFileKey(file);
        const fileLooseKey = buildQueueLooseFileKey(file);
        const useLooseDedupe = options.sourceKind === 'drop';

        if (
          (fileKey && existingKeys.has(fileKey))
          || (useLooseDedupe && fileLooseKey && existingLooseKeys.has(fileLooseKey))
        ) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][add-file-skip-duplicate] index=${index} name=${file.name || '-'} size=${file.size || 0} fileKey=${fileKey || '-'} looseKey=${fileLooseKey || '-'}`
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

        if (fileLooseKey) {
          existingLooseKeys.add(fileLooseKey);
        }

        addedCount += 1;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][add-file] index=${index} name=${item.name || '-'} size=${item.size || 0} handle=${hasHandle ? 1 : 0} sourceKind=${item.sourceKind} readMode=${item.readMode}`,
        );
      });

      dedupeActiveGroupQueue('add-files');
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
      syncUploadGroupAppState();
      appendUploadGroupLog('ADD_FILE', {
        addedCount,
        groupId: state.activeGroupId || '-',
      });
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

    // 上传前统一入口：有 fileHandle 则必须 getFile() 从磁盘读最新文件，失败就直接报错，绝不走缓存降级
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

          console.warn('[ChatGPT toolbox] fileHandle.getFile failed, no fallback to cache', e);

          q.message = '文件句柄读取失败，无法从磁盘读取最新文件';
          q.state = UploadState.MISSING_FILE;
          q.sourceKind = 'missing-file';
          q.readMode = '';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][readFreshFile:handle-failed-no-fallback] name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} type=${errName} error=${errText}`,
          );

          throw new Error('文件句柄读取失败，无法保证从磁盘读取最新文件 ' + (q.name || '-'));
        }

        // handle 存在但 getFile 返回空/无效 → 也报错
        q.state = UploadState.MISSING_FILE;
        q.sourceKind = 'missing-file';
        q.readMode = '';
        q.message = '文件句柄读取返回空文件';

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][readFreshFile:handle-returned-invalid] name=${q.name || '-'}`,
        );

        throw new Error('文件句柄读取返回空文件，无法保证从磁盘读取最新文件 ' + (q.name || '-'));
      }

      // 没有 fileHandle → 无法从磁盘读取，直接报错
      q.state = UploadState.MISSING_FILE;
      q.sourceKind = 'missing-file';
      q.readMode = '';
      q.message = '缺少文件句柄，无法从磁盘读取最新文件';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][readFreshFile:no-handle] name=${q.name || '-'}`,
      );

      throw new Error('缺少文件句柄，无法从磁盘读取最新文件，缺少可读取的文件对象 ' + (q.name || '-'));
    }

    function cloneFileWithUniqueName(file, seq, total) {
      return cloneFileForUploadAttach(file, seq, total);
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
          return /确定|知道了|OK|Ok|ok|close|关闭/i.test(t);
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

    async function resolveLiveFileForUpload(item) {
      if (!item) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][live-read:null-item]');
        return null;
      }

      if (isFileLike(item.file)) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][live-read:session-file] name=${item.name || '-'} size=${item.size || 0}`
        );
        return item.file;
      }

      if (item.fileHandle && typeof item.fileHandle.getFile === 'function') {
        try {
          const file = await item.fileHandle.getFile();

          item.file = file;
          item.name = file.name || item.name;
          item.size = Number(file.size) || item.size;
          item.lastModified = Number(file.lastModified) || item.lastModified;
          item.type = file.type || item.type || 'application/octet-stream';
          item.blob = null;
          item.readMode = 'file-handle-live';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][live-read:handle] name=${item.name || '-'} size=${item.size}`
          );

          return file;
        } catch (e) {
          console.error('[ChatGPT toolbox] resolveLiveFileForUpload: handle.getFile failed', e);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][live-read:handle-failed] name=${item.name || '-'} error=${e && e.message ? e.message : String(e)}`
          );
        }
      }

      item.file = null;
      item.blob = null;
      item.state = UploadState.MISSING_FILE;
      item.message = '未保存文件内容，请重新拖入后再上传';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][live-read:missing] name=${item.name || '-'} reason=no-file-no-handle`
      );

      return null;
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
          releaseUploadPayload(q, 'attach-ok');

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
          releaseUploadPayload(q, 'post-evidence-attached');

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

    // TODO(cleanup-observe): 当前静态扫描无调用，待确认是否增加「上传此文件」UI 或删除。
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

    // TODO(cleanup-observe): 当前静态扫描无调用，待确认是否增加列表单文件上传入口或删除。
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

    function buildUploadListHtml() {
      const files = getActiveGroupFiles();
      const selectedFileId = getSelectedFileIdForActiveGroup();
      const activeGroupId = getActiveGroupId();
      const flaskHtml = buildFlaskUploadListHtml();

      if (!files.length && !flaskHtml) {
        return `
          <div class="cgpt-upload-item empty toolbox-upload-empty-state">
            <div>
              <div class="cgpt-upload-meta toolbox-upload-drop-hint">当前项目没有文件</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">松开鼠标，添加到当前项目</div>
            </div>
          </div>
        `;
      }

      const queueHtml = files.map((q) => {
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

      return `${flaskHtml}${queueHtml}`;
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
      el.classList.add('toolbox-upload-file-list');
      refreshQueueReadableState();
      el.innerHTML = buildUploadListHtml();
    }

    const uploadPageCapabilityCache = {
      at: 0,
      key: '',
      light: null,
      heavy: null,
    };

    function countActiveUploadItemsForCapability() {
      return getActiveGroupFiles().filter((item) => {
        const stateName = String(item && item.state ? item.state : '').trim();
        return stateName && stateName !== UploadState.CANCELLED && stateName !== UploadState.DONE;
      }).length;
    }

    function buildUploadPageCapabilityCacheKey() {
      const composerTextLen = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').length
        : 0;
      const responding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
        && ComposerApi.isAssistantLikelyBusy();

      return [
        location.href,
        composerTextLen,
        isWaitingSendActive() ? 1 : 0,
        state.waitingReply ? 1 : 0,
        countActiveUploadItemsForCapability(),
        responding ? 1 : 0,
      ].join('|');
    }

    function getUploadPageCapabilityLight() {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      let hasComposer = false;
      let canSendNow = false;
      let isResponding = false;
      let response_state = 'not_ready';
      let response_state_reason = '';
      let hasComposerPayload = false;

      try {
        hasComposer = typeof ComposerApi.hasComposer === 'function' && ComposerApi.hasComposer();
        isResponding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
        canSendNow = typeof ComposerApi.canSendNowLight === 'function'
          ? ComposerApi.canSendNowLight()
          : (
            typeof ComposerApi.canSendNow === 'function'
            && ComposerApi.canSendNow({ maxAgeMs: 450 })
          );

        if (typeof detectComposerResponseState === 'function') {
          const responseState = detectComposerResponseState({ light: true });
          response_state = String(responseState.response_state || response_state);
          response_state_reason = String(responseState.response_state_reason || '');
          canSendNow = responseState.can_send_now === true;
          isResponding = responseState.is_responding === true;
          hasComposerPayload = responseState.has_composer_payload === true;
        } else {
          response_state = isResponding ? 'generating' : (canSendNow ? 'ready' : 'not_ready');
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getUploadPageCapabilityLight failed', err);
        ToolboxShell.appendLog(`[UPLOAD][capability-light-failed] error=${errText}`);
      }

      const light = {
        hasComposer,
        canSendNow,
        can_send_now: canSendNow,
        isResponding,
        is_responding: isResponding,
        response_state,
        response_state_reason,
        hasComposerPayload,
        has_composer_payload: hasComposerPayload,
        sendable: hasComposer && canSendNow && !isResponding,
      };

      if (typeof logPerfThrottled === 'function') {
        const costMs = Math.round(
          ((typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now()) - startedAt,
        );
        logPerfThrottled(
          'capability-light',
          `[PERF][capability] cost=${costMs}ms heavy=0 reason=getUploadPageCapabilityLight`,
        );
      }

      return light;
    }

    function getUploadPageCapabilityHeavy() {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      let attachmentCount = 0;
      let hasComposerPayload = false;
      let response_state = 'not_ready';
      let response_state_reason = '';
      let canSendNow = false;
      let isResponding = false;

      try {
        attachmentCount = typeof ComposerApi.countAttachmentChips === 'function'
          ? ComposerApi.countAttachmentChips()
          : 0;

        if (typeof ComposerApi.getExistingComposerPayloadSnapshot === 'function') {
          const payloadSnapshot = ComposerApi.getExistingComposerPayloadSnapshot();
          hasComposerPayload = !!(payloadSnapshot && payloadSnapshot.hasPayload);
        }

        if (typeof detectComposerResponseState === 'function') {
          const responseState = detectComposerResponseState();
          response_state = String(responseState.response_state || response_state);
          response_state_reason = String(responseState.response_state_reason || '');
          canSendNow = responseState.can_send_now === true;
          isResponding = responseState.is_responding === true;
          if (Number.isFinite(Number(responseState.attachment_count))) {
            attachmentCount = Number(responseState.attachment_count);
          }
          if (responseState.has_composer_payload === true) {
            hasComposerPayload = true;
          }
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getUploadPageCapabilityHeavy failed', err);
        ToolboxShell.appendLog(`[UPLOAD][capability-heavy-failed] error=${errText}`);
      }

      const latestAssistant = getLatestAssistantMessageForCopy();

      const heavy = {
        attachmentCount,
        hasComposerPayload,
        has_composer_payload: hasComposerPayload,
        response_state,
        response_state_reason,
        canSendNow,
        can_send_now: canSendNow,
        isResponding,
        is_responding: isResponding,
        copyable: !!(latestAssistant && latestAssistant.ok),
        latestAssistant,
      };

      if (typeof logPerfThrottled === 'function') {
        const costMs = Math.round(
          ((typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now()) - startedAt,
        );
        logPerfThrottled(
          'capability-heavy',
          `[PERF][capability] cost=${costMs}ms heavy=1 reason=getUploadPageCapabilityHeavy attachmentCount=${attachmentCount}`,
        );
      }

      return heavy;
    }

    function getUploadPageCapability(options = {}) {
      const forceHeavy = options && options.heavy === true;
      const cacheKey = buildUploadPageCapabilityCacheKey();
      const now = Date.now();

      if (
        !forceHeavy
        && uploadPageCapabilityCache.key === cacheKey
        && uploadPageCapabilityCache.light
        && uploadPageCapabilityCache.heavy
        && now - uploadPageCapabilityCache.at < 500
      ) {
        return {
          ...uploadPageCapabilityCache.light,
          ...uploadPageCapabilityCache.heavy,
        };
      }

      const light = getUploadPageCapabilityLight();
      let heavy = uploadPageCapabilityCache.heavy;
      if (forceHeavy || !heavy || now - uploadPageCapabilityCache.at >= 500 || uploadPageCapabilityCache.key !== cacheKey) {
        heavy = getUploadPageCapabilityHeavy();
      }

      uploadPageCapabilityCache.at = now;
      uploadPageCapabilityCache.key = cacheKey;
      uploadPageCapabilityCache.light = light;
      uploadPageCapabilityCache.heavy = heavy;

      return { ...light, ...heavy };
    }

    function renderUploadButtonsOnly(options = {}) {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      let changedButtons = 0;
      const useHeavy = options && options.heavy === true;

      healStaleUploadRunningLockIfNeeded('renderUploadButtonsOnly');
      healStaleSendUiStateIfNeeded('renderUploadButtonsOnly');

      const capability = getUploadPageCapability({ heavy: useHeavy });

      const currentStartBtn = rootElRef
        ? qs(UploadSelectors.startBtn, rootElRef)
        : startBtn;

      if (currentStartBtn) {
        startBtn = currentStartBtn;
      }

      const uiRunning = isUploadRunActuallyActive();
      const activeFiles = getActiveGroupFiles();

      if (setButtonStateIfChanged(currentStartBtn, {
        text: uiRunning ? '上传中...' : '开始上传',
        title: uiRunning
          ? '正在上传中，再点击一次取消'
          : '只上传/绑定文件到 ChatGPT 输入框，不自动发送',
        disabled: uiRunning ? false : activeFiles.length <= 0,
        removeClasses: ['primary', 'danger'],
        addClasses: uiRunning ? ['danger'] : ['success'],
      })) {
        changedButtons += 1;
      }

      const startSendBtn = rootElRef ? qs(UploadSelectors.startSendBtn, rootElRef) : null;
      if (startSendBtn) {
        const waitingSend = isWaitingSendActive();
        const waitingReply = !!state.waitingReply;
        let sendTitle = '发送当前输入框中的文字和附件';

        if (waitingReply && state.pendingSendAfterReply) {
          sendTitle = '助手正在回复或发送按钮未就绪，脚本会持续检测，页面一可发送就自动点击发送；再次点击可取消';
        } else if (waitingReply) {
          sendTitle = '再次点击可取消等待回复';
        } else if (waitingSend) {
          sendTitle = '正在持续寻找发送按钮，直到发送成功；再次点击可取消';
        } else if (!capability.hasComposer) {
          sendTitle = '未找到 ChatGPT 输入框，点击后将持续等待';
        } else if (capability.isResponding) {
          sendTitle = '助手正在回复，暂不可发送';
        }

        const failureHint = state.uploadSendFailureHint
          && (Date.now() - Number(state.uploadSendFailureHintAt || 0) < 12000)
          ? String(state.uploadSendFailureHint)
          : '';

        const hasPendingComposerPayload = !!(
          capability.hasComposerPayload
          || capability.has_composer_payload
          || Number(capability.attachmentCount || 0) > 0
          || (
            typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
            && ComposerApi.hasVisibleComposerAttachmentPayload()
          )
          || (
            typeof ComposerApi.isAttachmentStillUploading === 'function'
            && ComposerApi.isAttachmentStillUploading()
          )
        );
        const pendingAttachmentWaitSend = hasPendingComposerPayload
          && !capability.canSendNow
          && !waitingSend
          && !waitingReply;

        let sendText = '发送信息';
        if (waitingReply && state.pendingSendAfterReply) {
          sendText = '等待可发...';
        } else if (waitingReply) {
          sendText = '等待回复...';
        } else if (waitingSend) {
          sendText = '发送中...';
        } else if (pendingAttachmentWaitSend) {
          sendText = '等待发送...';
          sendTitle = '附件已存在，正在等待发送按钮';
        } else if (failureHint) {
          sendText = failureHint.length > 22 ? `${failureHint.slice(0, 22)}…` : failureHint;
          sendTitle = failureHint;
        }

        const sendBusy = waitingSend || waitingReply;
        startSendBtn.dataset.uploadSendState = sendBusy
          ? (waitingReply ? 'waiting-reply' : 'sending')
          : (failureHint ? 'failed' : 'idle');
        startSendBtn.setAttribute('aria-busy', sendBusy ? 'true' : 'false');

        if (setButtonStateIfChanged(startSendBtn, {
          text: sendText,
          title: sendTitle,
          disabled: false,
          ariaDisabled: false,
          removeClasses: ['primary', 'danger', 'cgpt-wait-send-cancel', 'warning', 'waiting'],
          addClasses: sendBusy
            ? ['danger', 'cgpt-wait-send-cancel']
            : (failureHint ? ['warning'] : ['primary']),
        })) {
          changedButtons += 1;
        }
      }

      const copyContinueBtn = rootElRef ? qs(UploadSelectors.copyContinueBtn, rootElRef) : null;

      if (copyContinueBtn) {
        const busy = typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
        const actionBusy = copyContinueBtn.dataset.busy === '1';
        const waitingReplyBtn = copyContinueBtn.dataset.waitingReply === '1';
        const continueBtnText = actionBusy
          ? (waitingReplyBtn ? '等待回复...' : '继续中...')
          : '复制并继续';
        const waitingAnswer = isWaitingAnswerVisualState({
          text: continueBtnText,
          isResponding: busy,
        }) || waitingReplyBtn;

        if (setButtonStateIfChanged(copyContinueBtn, {
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
            'cgpt-btn-error',
            'cgpt-btn-ok',
            'failed',
            'error',
          ],
          addClasses: waitingAnswer
            ? ['cgpt-waiting-answer', 'copy-continue', 'cgpt-btn-copy-continue']
            : ['copy-continue', 'cgpt-btn-copy-continue'],
        })) {
          changedButtons += 1;
        }
        copyContinueBtn.dataset.assistantBusy = busy ? '1' : '0';
      }

      const copyLastMessageBtn = rootElRef ? qs(UploadSelectors.copyLastMessageBtn, rootElRef) : null;
      if (copyLastMessageBtn) {
        const taskRunning = copyLastReplyTaskRunning || copyLastMessageTaskRunning;
        const taskStatus = String(copyLastReplyTaskStatus || copyLastMessageTaskStatus || '').trim();

        let text = '复制最后回复';
        let title = '等待最后一条 assistant 回复稳定后复制到剪贴板';
        let addClasses = ['primary'];
        let disabled = false;

        if (taskRunning) {
          disabled = true;
          if (taskStatus === 'waiting' || copyLastMessageWaiting) {
            text = '等待回复...';
            title = '正在等待 ChatGPT 回复完成并稳定';
            addClasses = ['waiting', 'cgpt-waiting-answer'];
          } else if (taskStatus === 'copying') {
            text = '复制中...';
            title = '正在复制最后回复到剪贴板';
            addClasses = ['warning'];
          } else if (taskStatus === 'success') {
            text = '已复制';
            title = '最后回复已复制';
            addClasses = ['success'];
          } else if (taskStatus === 'failed') {
            text = '复制失败';
            title = '复制最后回复失败';
            addClasses = ['danger'];
          } else if (copyLastMessageWaiting) {
            text = '等待回复...';
            title = '正在等待 ChatGPT 回复完成并稳定';
            addClasses = ['waiting', 'cgpt-waiting-answer'];
          } else {
            text = '复制中...';
            title = '正在复制最后回复到剪贴板';
            addClasses = ['warning'];
          }
        }

        if (setButtonStateIfChanged(copyLastMessageBtn, {
          text,
          title,
          disabled,
          ariaDisabled: disabled,
          removeClasses: [
            'primary',
            'success',
            'warning',
            'orange',
            'amber',
            'teal',
            'purple',
            'cyan',
            'danger',
            'waiting',
            'cgpt-waiting-answer',
            'cgpt-btn-error',
            'cgpt-btn-ok',
            'failed',
            'error',
          ],
          addClasses,
        })) {
          changedButtons += 1;
        }
      }

      const copyHotkeyOnceBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyOnceBtn, rootElRef)
        : null;
      if (copyHotkeyOnceBtn) {
        if (setButtonStateIfChanged(copyHotkeyOnceBtn, {
          text: copyHotkeyOnceTaskRunning ? '处理中...' : '复制+快捷键',
          title: '等待回答完成 -> 复制最后回复 -> Ctrl+Alt+I，不发送继续指令',
          disabled: copyHotkeyOnceTaskRunning || copyHotkeyContinueTaskRunning || copyHotkeyContinueLoopRunning,
          ariaDisabled: copyHotkeyOnceTaskRunning || copyHotkeyContinueTaskRunning || copyHotkeyContinueLoopRunning,
          removeClasses: [
            'primary',
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'teal',
            'cyan',
            'cgpt-btn-error',
            'cgpt-btn-ok',
          ],
          addClasses: ['purple'],
        })) {
          changedButtons += 1;
        }
      }

      const copyHotkeyContinueOnceBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef)
        : null;
      if (copyHotkeyContinueOnceBtn) {
        if (setButtonStateIfChanged(copyHotkeyContinueOnceBtn, {
          text: copyHotkeyContinueTaskRunning ? '处理中...' : '复制+快捷键+继续',
          title: '等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令',
          disabled: copyHotkeyContinueTaskRunning || copyHotkeyContinueLoopRunning,
          ariaDisabled: copyHotkeyContinueTaskRunning || copyHotkeyContinueLoopRunning,
          removeClasses: [
            'primary',
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'teal',
            'cgpt-btn-error',
            'cgpt-btn-ok',
          ],
          addClasses: ['purple'],
        })) {
          changedButtons += 1;
        }
      }

      const copyHotkeyContinueLoopBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueLoopBtn, rootElRef)
        : null;
      if (copyHotkeyContinueLoopBtn) {
        copyHotkeyContinueLoopBtn.classList.remove(
          'primary',
          'success',
          'warning',
          'orange',
          'amber',
          'teal',
          'purple',
          'cyan',
          'danger',
          'cgpt-btn-error',
          'cgpt-btn-ok',
          'cgpt-action-running',
          'cgpt-waiting-answer',
        );

        if (copyHotkeyContinueLoopRunning) {
          copyHotkeyContinueLoopBtn.textContent = '停止连续';
          copyHotkeyContinueLoopBtn.classList.add('danger', 'cgpt-action-running');
          copyHotkeyContinueLoopBtn.disabled = false;
          copyHotkeyContinueLoopBtn.title = '点击停止循环';
        } else {
          copyHotkeyContinueLoopBtn.textContent = '连续复制+快捷键+继续';
          copyHotkeyContinueLoopBtn.classList.add('cyan');
          copyHotkeyContinueLoopBtn.disabled = false;
          copyHotkeyContinueLoopBtn.title = '等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令';
        }
        copyHotkeyContinueLoopBtn.setAttribute('aria-disabled', 'false');
      }

      applyUploadShortcutButtonTitles(rootElRef);

      if (typeof logPerfThrottled === 'function') {
        const costMs = Math.round(
          ((typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now()) - startedAt,
        );
        logPerfThrottled(
          'renderUploadButtonsOnly',
          `[PERF][renderUploadButtonsOnly] cost=${costMs}ms changedButtons=${changedButtons} heavy=${useHeavy ? 1 : 0}`,
        );
      }
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

      if (rootElRef) {
        ensureUploadActionToolbar(rootElRef);
        ensureUploadGroupSection(rootElRef);
        groupListEl = qs('#cgpt-upload-group-list', rootElRef);
      }

      refreshQueueReadableState();
      syncActiveGroupCountInCache();
      renderToolboxTopStatus();

      listEl.innerHTML = buildUploadListHtml();

      renderUploadButtonsOnly();

      if (managePanelEl && !managePanelEl.classList.contains('cgpt-toolbox-hidden')) {
        syncGroupManagePanel();
      }

      applyCompactUiVisibility();
      renderUploadQuickPrompts();
      bindAllMultiUploadDragDropTargets();
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


    function logUploadSendUiState(action, reason, runId) {
      let cap = {
        isResponding: false,
        canSendNow: false,
        response_state: '-',
      };

      try {
        cap = getUploadPageCapability({ heavy: true });
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] logUploadSendUiState capability failed', err);
        ToolboxShell.appendLog(`[SEND_UI][STATE][capability-error] error=${errText}`);
      }

      ToolboxShell.appendLog(
        `[SEND_UI][STATE] action=${String(action || '-')} reason=${String(reason || '-')} runId=${runId == null ? '-' : runId} autoSendRunId=${state.autoSendRunId || '-'} waitingSend=${state.waitingSend ? '1' : '0'} autoSendWaiting=${state.autoSendWaiting ? '1' : '0'} waitingReply=${state.waitingReply ? '1' : '0'} shortcutRunning=${uploadSendShortcutRunning ? '1' : '0'} isResponding=${cap.isResponding ? '1' : '0'} canSendNow=${cap.canSendNow ? '1' : '0'} responseState=${cap.response_state || '-'} attachmentCount=${Number(cap.attachmentCount || 0)}`
      );
    }

    function mapUploadSendFailureMessage(reason) {
      const normalized = String(reason || '').trim();
      const baseReason = normalized.startsWith('send_not_confirmed:')
        ? normalized.slice('send_not_confirmed:'.length)
        : normalized;

      if (baseReason === 'click_send_failed' || normalized === 'click_send_failed') {
        return '发送失败：未能点击 ChatGPT 发送按钮';
      }

      if (baseReason === 'send_button_wait_timeout') {
        return '发送失败：等待发送按钮超时';
      }

      if (baseReason === 'send_button_unavailable') {
        return '发送失败：ChatGPT 发送按钮不可用';
      }

      if (baseReason === 'composer_empty') {
        return '发送失败：输入框无文本且无附件';
      }

      if (baseReason === 'assistant_busy') {
        return '发送失败：助手正在回复';
      }

      if (baseReason === 'input_not_cleared') {
        return '发送失败：输入框内容未清空（send_not_confirmed: input_not_cleared）';
      }

      if (baseReason === 'attachment_not_ready') {
        return '发送失败：附件仍在处理中（send_not_confirmed: attachment_not_ready）';
      }

      if (baseReason === 'button_disabled') {
        return '发送失败：发送按钮不可用（send_not_confirmed: button_disabled）';
      }

      if (baseReason === 'send_button_not_found') {
        return '发送失败：未找到 ChatGPT 发送按钮';
      }

      if (baseReason === 'no_user_bubble_after_click') {
        return '发送失败：点击后未出现用户消息（send_not_confirmed: no_user_bubble_after_click）';
      }

      if (baseReason === 'conversation_switch_timeout') {
        return '发送失败：会话跳转后未能确认发送（send_not_confirmed: conversation_switch_timeout）';
      }

      if (baseReason === 'composer_text_not_synced') {
        return '发送失败：文本未写入输入框（send_not_confirmed: composer_text_not_synced）';
      }

      if (baseReason === 'no_send_progress_after_actions') {
        return '发送失败：已尝试点击/快捷键/真实 Enter，但页面没有发送进展';
      }

      if (normalized) {
        return `发送失败：${normalized}`;
      }

      return '发送失败：unknown';
    }

    function resetUploadSendUiState(reason, runId) {
      if (state.waitingSendAbortController) {
        try {
          state.waitingSendAbortController.abort();
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] resetUploadSendUiState abort failed', err);
          ToolboxShell.appendLog(
            `[SEND_UI][abort-error] reason=${String(reason || '-')} error=${errText}`,
          );
        }
        state.waitingSendAbortController = null;
      }

      if (state.waitingSendTimer) {
        clearTimeout(state.waitingSendTimer);
        state.waitingSendTimer = null;
      }

      if (state.waitingSendInterval) {
        clearInterval(state.waitingSendInterval);
        state.waitingSendInterval = null;
      }

      stopWaitingReplyCheck();
      waitingReplyIdleStreak = 0;
      state.replyWaitSawBusy = false;
      state.replyWaitAssistantCountBefore = 0;

      state.waitingSend = false;
      state.autoSendWaiting = false;
      state.cancelWaitingSend = false;
      state.uploadCancelRequested = false;
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      state.waitingReply = false;
      state.waitingReplyRunId = null;
      state.waitingReplyTimer = null;
      state.pendingSendAfterReply = false;
      state.pendingSendAfterReplySource = '';
      state.pendingSendRetrying = false;

      if (!String(reason || '').startsWith('send-message-not-sent:')) {
        state.uploadSendFailureHint = '';
        state.uploadSendFailureHintAt = 0;
      }

      logUploadSendUiState('reset', reason, runId);

      const sendBtn = rootElRef ? qs(UploadSelectors.startSendBtn, rootElRef) : null;
      if (sendBtn && typeof clearButtonLongWaitDangerTimer === 'function') {
        clearButtonLongWaitDangerTimer(sendBtn, reason || 'reset');
      }
    }

    function resetUploadSendButtonState(reason = 'send_failed_or_timeout', runId) {
      ToolboxShell.appendLog(
        `[SEND_UI][RESET] reason=${String(reason || 'send_failed_or_timeout')} runId=${runId == null ? '-' : runId}`,
      );
      resetUploadSendUiState(reason, runId);
    }

    function healStaleSendUiStateIfNeeded(context) {
      if (!isWaitingSendActive()) return false;
      if (state.waitingReply) return false;
      if (uploadSendTaskStartedAt <= 0) return false;
      const elapsed = Date.now() - uploadSendTaskStartedAt;
      if (elapsed < 8000) return false;

      try {
        const hasPendingComposerPayload = !!(
          (
            typeof ComposerApi.getExistingComposerPayloadSnapshot === 'function'
            && ComposerApi.getExistingComposerPayloadSnapshot().hasPayload
          )
          || (
            typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
            && ComposerApi.hasVisibleComposerAttachmentPayload()
          )
          || (
            typeof ComposerApi.isAttachmentStillUploading === 'function'
            && ComposerApi.isAttachmentStillUploading()
          )
        );

        if (hasPendingComposerPayload) {
          ToolboxShell.appendLog(
            `[SEND_UI][HEAL_STALE_SKIP] reason=${String(context || '-scheduled')} runningMs=${elapsed} cause=pending_composer_payload`,
          );
          return false;
        }

        const cap = getUploadPageCapability();
        const pageIdle = !cap.isResponding && cap.response_state !== 'generating';
        const noStopButton = !hasRealStopButtonForCopy();

        if (pageIdle && noStopButton) {
          ToolboxShell.appendLog(
            `[SEND_UI][HEAL_STALE] reason=${String(context || '-scheduled')} runningMs=${elapsed} isResponding=${cap.isResponding ? '1' : '0'} responseState=${cap.response_state || '-'} stopButton=${noStopButton ? '0' : '1'}`
          );
          resetUploadSendUiState('stale-send-ui:' + (context || '-scheduled'), state.autoSendRunId);
          scheduleRenderUpload('heal-stale-send-ui');
          return true;
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] healStaleSendUiStateIfNeeded error', err);
        ToolboxShell.appendLog(`[SEND_UI][HEAL_STALE_ERROR] error=${errText}`);
      }
      return false;
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

    function buildQueueUploadResult({
      ok = false,
      uploadedCount = 0,
      failedCount = 0,
      skippedCount = 0,
      reason = '',
      cancelled = false,
    } = {}) {
      return {
        ok: !!ok,
        uploadedCount: Number(uploadedCount) || 0,
        failedCount: Number(failedCount) || 0,
        skippedCount: Number(skippedCount) || 0,
        reason: String(reason || ''),
        cancelled: !!cancelled,
      };
    }

    function isNoFilesUploadReason(reason) {
      const normalized = String(reason || '').trim();
      return (
        normalized === 'no-files'
        || normalized === 'no-pending-files'
        || normalized === 'empty-queue'
      );
    }

    function toLegacyUploadResult(queueResult) {
      const result = queueResult && typeof queueResult === 'object' ? queueResult : {};
      const uploadedCount = Number(result.uploadedCount) || 0;
      const failedCount = Number(result.failedCount) || 0;
      const skippedCount = Number(result.skippedCount) || 0;
      const reason = String(result.reason || '');
      const cancelled = !!result.cancelled || reason === 'cancelled';

      if (cancelled) {
        return buildUploadResult(uploadedCount, failedCount, true, uploadedCount + failedCount + skippedCount, {
          skipped: false,
          reason: 'cancelled',
        });
      }

      if (isNoFilesUploadReason(reason)) {
        return buildUploadSkipResult('no-pending-files', {
          total: 0,
          failed: 0,
        });
      }

      if (result.ok) {
        return buildUploadResult(uploadedCount, failedCount, false, uploadedCount + failedCount + skippedCount, {
          skipped: skippedCount > 0,
          reason: reason || 'unified-file-input',
        });
      }

      return buildUploadResult(uploadedCount, failedCount, false, uploadedCount + failedCount + skippedCount, {
        skipped: false,
        reason: reason || 'upload-failed',
      });
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
        state.cancelWaitingSend = true;
        state.autoSendRunId += 1;
        resetUploadSendUiState('upload-run-cancelled', state.autoSendRunId);
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

    function clearStaleBusySendStateOnHomeReady(reason) {
      if (typeof isHomeNewChatReadyToSendNow !== 'function' || !isHomeNewChatReadyToSendNow()) {
        return false;
      }

      state.waitingSend = false;
      state.autoSendWaiting = false;
      state.waitingReply = false;
      state.replyBecameBusy = false;
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      state.pendingSendAfterReply = false;
      state.pendingSendAfterReplySource = '';
      state.pendingSendRetrying = false;

      ToolboxShell.appendLog(`[SEND][CLEAR_STALE_BUSY_STATE] reason=${reason || 'home-ready'}`);
      return true;
    }

    async function stopChatGPTGeneratingIfPossible() {
      const selectors = [
        'button[data-testid="stop-button"]',
        'button[data-testid="composer-stop-button"]',
        'button[aria-label="停止生成"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label*="Stop generating"]',
      ];

      for (const selector of selectors) {
        const buttons = Array.from(document.querySelectorAll(selector));

        for (const btn of buttons) {
          if (!btn || (typeof isInsideToolbox === 'function' && isInsideToolbox(btn))) {
            continue;
          }

          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);

          if (
            rect.width > 0
            && rect.height > 0
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && !btn.disabled
          ) {
            btn.click();
            ToolboxShell.appendLog(`[UPLOAD][STOP_GENERATING_CLICKED] selector=${selector}`);
            return true;
          }
        }
      }

      ToolboxShell.appendLog('[UPLOAD][STOP_GENERATING_NOT_FOUND]');
      return false;
    }

    function cancelCurrentUploadSend(reason) {
      state.uploadCancelRequested = true;
      state.cancelWaitingSend = true;

      if (state.uploadAbortController) {
        try {
          state.uploadAbortController.abort();
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] cancelCurrentUploadSend abort failed', err);
          ToolboxShell.appendLog(
            `[UPLOAD][CANCEL_ABORT_ERROR] reason=${String(reason || 'manual')} error=${errText}`,
          );
        }
      }

      if (state.running || state.activeId) {
        cancelCurrentUploadRun(String(reason || 'manual'));
      }

      if (isWaitingSendActive() || state.waitingReply) {
        const cancelRunId = state.autoSendRunId;
        state.autoSendRunId += 1;
        resetUploadSendUiState('cancel:' + reason, cancelRunId);
        ToolboxShell.appendLog(`[UPLOAD][WAIT_SEND][CANCEL] reason=${reason}`);
      }

      ToolboxShell.appendLog(`[UPLOAD][CANCEL_REQUEST] reason=${reason || 'manual'}`);
      void stopChatGPTGeneratingIfPossible();
      setStatus('已取消发送', 'warning');
      scheduleRenderUpload('send-cancel');

      return true;
    }

    function countVisibleAssistantMessagesForReplyWait() {
      try {
        if (typeof getValidAssistantTextsFromDom === 'function') {
          return getValidAssistantTextsFromDom().length;
        }
      } catch (err) {
        console.error('[ChatGPT toolbox] countVisibleAssistantMessagesForReplyWait failed', err);
      }

      return 0;
    }

    function isReplyGeneratingState(responseState) {
      const normalized = String(responseState || '').toLowerCase();
      return normalized === 'generating'
        || normalized === 'streaming'
        || normalized === 'responding'
        || normalized === 'submitted';
    }

    async function startUploadOnlyFlow(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const source = String(opts.source || 'button').trim() || 'button';

      if (state.running) {
        ToolboxShell.appendLog('[UPLOAD_ONLY][START][SKIP] reason=already-running');
        return false;
      }

      ToolboxShell.appendLog('[UPLOAD_ONLY][START]');
      setStatus('正在上传文件...', 'running');
      scheduleRenderUpload('upload-only:start');

      try {
        const uploadResult = await startUploadFromCurrentQueue({
          source: `upload-only:${source}`,
        });

        if (uploadResult && uploadResult.cancelled) {
          setStatus('上传已取消', 'warning');
          ToolboxShell.appendLog('[UPLOAD_ONLY][DONE] reason=cancelled');
          return false;
        }

        if (uploadResult && !uploadResult.ok && uploadResult.reason !== 'no-files') {
          setStatus(`上传失败：${uploadResult.reason || 'unknown'}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_ONLY][DONE] reason=${uploadResult.reason || 'failed'}`);
          return false;
        }

        setStatus('文件已上传到输入框', 'success');
        ToolboxShell.appendLog('[UPLOAD_ONLY][DONE]');
        scheduleRenderUpload('upload-only:done');
        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] startUploadOnlyFlow failed', err);
        ToolboxShell.appendLog(`[UPLOAD_ONLY][FAILED] error=${errText}`);
        setStatus(`上传失败：${errText}`, 'error');
        return false;
      }
    }

    async function startSendMessageFlow(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const source = String(opts.source || 'button').trim() || 'button';

      clearStaleBusySendStateOnHomeReady('send-start');

      if (isWaitingSendActive() || state.waitingReply) {
        ToolboxShell.appendLog('[SEND][START][SKIP] reason=already-waiting-send-or-reply');
        return false;
      }

      ToolboxShell.appendLog('[SEND][START]');
      const runId = claimWaitingSendRun(source, Date.now());

      try {
        return await sendCurrentMessageFromUploadPanel(source, runId);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] startSendMessageFlow failed', err);
        ToolboxShell.appendLog(`[SEND][FAILED] source=${source} error=${errText}`);
        setStatus(`发送信息失败：${errText}`, 'error');
        resetUploadSendUiState('send-flow-error', runId);
        return false;
      }
    }

    function cancelWaitingSend(reason = 'user-click') {
      if (!isWaitingSendActive() && !state.waitingReply) {
        return false;
      }

      const cancelRunId = state.autoSendRunId;
      state.cancelWaitingSend = true;
      state.autoSendRunId += 1;
      resetUploadSendUiState('cancel:' + reason, cancelRunId);
      ToolboxShell.appendLog(`[UPLOAD][WAIT_SEND][CANCEL] reason=${reason}`);
      setStatus('已取消等待发送', 'warning');
      scheduleRenderUpload('wait-send:cancel');
      return true;
    }

    function claimWaitingSendRun(source, runId) {
      const id = Number(runId) || Date.now();

      state.cancelWaitingSend = false;
      state.uploadCancelRequested = false;
      state.autoSendRunId = id;
      setWaitingSendActive(true);
      uploadSendShortcutRunning = true;
      uploadSendTaskStartedAt = Date.now();
      scheduleRenderUpload(`wait-send:claim:${source || '-'}`);
      logUploadSendUiState('claim', `wait-send:claim:${source || '-'}`, id);

      const sendBtn = rootElRef ? qs(UploadSelectors.startSendBtn, rootElRef) : null;
      if (sendBtn && typeof startButtonLongWaitDangerTimer === 'function') {
        startButtonLongWaitDangerTimer(sendBtn, 'long_wait_reply_or_send', BUTTON_LONG_WAIT_DANGER_MS);
      }

      return id;
    }

    function mapForeverSendFailureMessage(reason) {
      const normalized = String(reason || '').trim();
      if (normalized === 'assistant_busy') {
        return '助手正在回复，暂不可发送';
      }
      if (normalized === 'cancelled') {
        return '已取消发送';
      }
      if (normalized === 'composer_not_found') {
        return '长时间未找到 ChatGPT 输入框，已停止发送';
      }
      if (normalized === 'composer_empty') {
        return '输入框为空，无法发送';
      }
      if (normalized === 'send_button_not_found' || normalized === 'send_button_disabled') {
        return '发送按钮未就绪，已超时';
      }
      if (normalized === 'attachment_not_ready') {
        return '附件仍在处理，已超时';
      }
      if (normalized === 'send_not_confirmed' || normalized.startsWith('send_not_confirmed')) {
        return '发送未确认，请查看日志';
      }
      if (normalized === 'page_offline') {
        return '当前页面离线，已停止发送';
      }
      if (normalized === 'send_exception') {
        return '发送过程发生异常，请查看日志';
      }
      return '';
    }

    function enterUploadWaitingReplyAfterSend(runId, source) {
      state.waitingSend = false;
      state.autoSendWaiting = false;
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      state.cancelWaitingSend = false;
      state.pendingSendAfterReply = false;
      state.pendingSendAfterReplySource = '';
      state.pendingSendRetrying = false;
      state.uploadSendFailureHint = '';
      state.uploadSendFailureHintAt = 0;
      state.waitingReply = true;
      setStatus('已发送信息');
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:sent] runId=${runId} source=${source || '-'}`,
      );
      logUploadSendUiState('sent', 'waiting-reply', runId);
      updateChatInputStateBadge();
      startWaitingReplyCheck(runId, Date.now());
      scheduleRenderUpload('send-message:sent-waiting-reply');
    }

    function enterUploadWaitingReplyBlocked(runId, source) {
      clearStaleBusySendStateOnHomeReady('wait-reply-blocked');
      if (typeof isHomeNewChatReadyToSendNow === 'function' && isHomeNewChatReadyToSendNow()) {
        ToolboxShell.appendLog('[SEND][IGNORE_STALE_BUSY] reason=home_new_chat_skip_wait_reply_blocked');
        return;
      }

      state.waitingSend = true;
      state.autoSendWaiting = true;
      uploadSendShortcutRunning = true;
      uploadSendTaskStartedAt = Date.now();

      state.waitingReply = true;
      state.pendingSendAfterReply = true;
      state.pendingSendAfterReplySource = String(source || 'button');
      state.pendingSendRetrying = false;

      setStatus('助手正在回复，持续等待可发送机会...', 'running');

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:wait-reply] source=${source || '-'} reason=assistant_busy action=retry_after_reply runId=${runId}`,
      );

      logUploadSendUiState('waiting-reply', 'assistant-busy-retry-after-reply', runId);
      updateChatInputStateBadge();
      startWaitingReplyCheck(runId, Date.now());
      scheduleRenderUpload('send-message:blocked-waiting-reply-retry');
    }

    function shouldStopForeverSend(runId) {
      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        return true;
      }
      if (state.uploadCancelRequested) {
        return true;
      }
      if (state.cancelWaitingSend) {
        return true;
      }
      if (state.autoSendRunId !== runId) {
        return true;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return true;
      }
      return false;
    }

    function detectPendingComposerPayloadForSend() {
      const composerText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '')
        : '';
      const attachmentCount = typeof ComposerApi.countAttachmentChips === 'function'
        ? ComposerApi.countAttachmentChips()
        : 0;

      return !!(
        String(composerText || '').trim()
        || Number(attachmentCount || 0) > 0
        || (
          typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
          && ComposerApi.hasVisibleComposerAttachmentPayload()
        )
        || (
          typeof ComposerApi.isAttachmentStillUploading === 'function'
          && ComposerApi.isAttachmentStillUploading()
        )
      );
    }

    function isForeverRetryableSendReason(reason) {
      const normalized = String(reason || '').trim();

      if (!normalized) {
        return false;
      }

      if (normalized === 'cancelled' || normalized === 'page_navigating') {
        return false;
      }

      if (normalized === 'assistant_busy') {
        return true;
      }

      if (normalized === 'send_not_confirmed' || normalized.startsWith('send_not_confirmed:')) {
        return true;
      }

      return [
        'composer_empty',
        'send_button_not_found',
        'send_button_disabled',
        'attachment_not_ready',
        'send_button_wait_timeout',
        'send_button_unavailable',
        'click_send_failed',
        'no_send_progress_after_actions',
      ].includes(normalized);
    }

    function stopUploadSendTask(source) {
      const reason = String(source || 'page-navigation');
      copyHotkeyContinueLoopStopRequested = true;
      copyLastMessageWaitRunId += 1;
      cancelWaitingSend(reason);
      stopWaitingReplyCheck();
      state.autoSendRunId += 1;
      resetUploadSendUiState(`nav-cleanup:${reason}`, state.autoSendRunId);
      uploadTimers.clearAll();
      ToolboxShell.appendLog(`[UPLOAD][STOP_SEND_TASK] source=${reason}`);
    }

    function stopUploadTask(source) {
      const reason = String(source || 'page-navigation');
      copyHotkeyContinueLoopStopRequested = true;
      if (state.running || state.activeId || state.uploadAbortController) {
        cancelCurrentUploadRun(reason);
      }
      stopDuplicateWatcher(0);
      uploadTimers.clearAll();
      ToolboxShell.appendLog(`[UPLOAD][STOP_UPLOAD_TASK] source=${reason}`);
    }

    function clearUploadTransientFileRefs(source) {
      try {
        ToolboxShell.appendLog(
          `[UPLOAD_CLEANUP][TRANSIENT_FILES] source=${source || '-'}`,
        );

        const releaseItemRefs = (item) => {
          if (!item) return;
          releaseUploadPayload(item, `nav-cleanup:${source || '-'}`);
          if (item.rawFile) {
            item.rawFile = null;
          }
        };

        if (Array.isArray(state.queue)) {
          state.queue.forEach(releaseItemRefs);
        }

        if (Array.isArray(UploadGroupAppState.uploadItems)) {
          UploadGroupAppState.uploadItems.forEach(releaseItemRefs);
        }

        getActiveGroupFiles().forEach(releaseItemRefs);
      } catch (err) {
        console.error('[ChatGPT toolbox] clearUploadTransientFileRefs failed', err);

        const errName = err && err.name ? err.name : 'Error';
        const errText = err && err.message ? err.message : String(err);

        ToolboxShell.appendLog(
          `[UPLOAD_CLEANUP][TRANSIENT_FILES_ERROR] source=${source || '-'} type=${errName} error=${errText}`,
        );
      }
    }

    async function sendCurrentMessageFromUploadPanel(triggerSource, presetRunId) {
      const source = triggerSource || 'button';
      const usePresetRunId = presetRunId != null && Number(presetRunId) > 0;

      const runId = usePresetRunId
        ? Number(presetRunId)
        : claimWaitingSendRun(source, Date.now());

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:click] source=${source} runId=${runId} queue=${state.queue.length} running=${state.running}`
      );

      logUploadSendUiState('click', 'send-message-start', runId);
      clearStaleBusySendStateOnHomeReady('send-panel-click');

      let sendFailureHandled = false;

      function uploadSendFlowCancelCheck(stage) {
        const stageText = String(stage || '-');

        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:cancel-check] stage=${stageText} reason=page_navigating runId=${runId}`,
          );
          logUploadSendUiState('send-aborted', `page-navigating:${stageText}`, runId);
          resetUploadSendUiState(`send-message:page-navigating:${stageText}`, runId);
          return true;
        }

        if (state.autoSendRunId !== runId) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:cancel-check] stage=${stageText} reason=runId_changed runId=${runId} current=${state.autoSendRunId}`,
          );
          logUploadSendUiState('send-aborted', `runId-changed:${stageText}`, runId);
          return true;
        }

        if (state.uploadCancelRequested || state.cancelWaitingSend) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:cancel-check] stage=${stageText} reason=user_cancel runId=${runId} uploadCancelRequested=${state.uploadCancelRequested ? 1 : 0} cancelWaitingSend=${state.cancelWaitingSend ? 1 : 0}`,
          );
          logUploadSendUiState('send-aborted', `user-cancel:${stageText}`, runId);
          resetUploadSendUiState(`send-message:cancelled:${stageText}`, runId);
          return true;
        }

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:cancel-check] stage=${stageText} reason=offline runId=${runId}`,
          );
          setStatus('网络离线，已暂停发送', 'warn');
          logUploadSendUiState('send-aborted', `offline:${stageText}`, runId);
          resetUploadSendUiState(`send-message:offline:${stageText}`, runId);
          return true;
        }

        return false;
      }

      try {
        if (uploadSendFlowCancelCheck('enter-send-panel')) {
          sendFailureHandled = true;
          return false;
        }

        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          resetUploadSendUiState('send-message:page-navigating', runId);
          return false;
        }

        clearStaleBusySendStateOnHomeReady('send-panel-before-capability');
        const capability = getUploadPageCapability({ heavy: true });
        const homeReadyToSend = typeof isHomeNewChatReadyToSendNow === 'function'
          && isHomeNewChatReadyToSendNow();

        const hasPendingComposerPayload = !!(
          capability.hasComposerPayload
          || capability.has_composer_payload
          || Number(capability.attachmentCount || 0) > 0
          || (
            typeof ComposerApi.hasVisibleComposerAttachmentPayload === 'function'
            && ComposerApi.hasVisibleComposerAttachmentPayload()
          )
          || (
            typeof ComposerApi.isAttachmentStillUploading === 'function'
            && ComposerApi.isAttachmentStillUploading()
          )
        );

        if (capability.isResponding && !homeReadyToSend) {
          enterUploadWaitingReplyBlocked(runId, source);
          sendFailureHandled = true;
          return false;
        }

        if (capability.isResponding && homeReadyToSend) {
          ToolboxShell.appendLog('[SEND][IGNORE_STALE_BUSY] reason=home_new_chat_ready_to_send');
        }

        const composerTextNow = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '').trim()
          : '';
        const hasAnythingToSend = !!(
          hasPendingComposerPayload
          || composerTextNow
        );

        if (!capability.hasComposer && !hasAnythingToSend) {
          const blockReason = 'no-composer';
          const blockMessage = '未找到 ChatGPT 输入框';
          setStatus(blockMessage, 'warn');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:blocked] source=${source} reason=${blockReason}`,
          );
          resetUploadSendUiState(`send-message-blocked:${blockReason}`, runId);
          scheduleRenderUpload('send-message:blocked');
          sendFailureHandled = true;
          return false;
        }

        if (!hasAnythingToSend) {
          const blockReason = 'composer-empty';
          const blockMessage = '输入框为空，无法发送';
          setStatus(blockMessage, 'warn');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:blocked] source=${source} reason=${blockReason}`,
          );
          resetUploadSendUiState(`send-message-blocked:${blockReason}`, runId);
          scheduleRenderUpload('send-message:blocked');
          sendFailureHandled = true;
          return false;
        }

        if (!capability.canSendNow && hasPendingComposerPayload) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:wait-payload] source=${source} reason=payload_exists_but_send_not_ready attachmentCount=${Number(capability.attachmentCount || 0)} responseState=${capability.response_state || '-'}`,
          );
        }

        setStatus(
          !capability.canSendNow
            ? (hasPendingComposerPayload
              ? '附件已存在，继续等待发送按钮...'
              : '正在等待发送按钮就绪...')
            : '正在发送...',
          'running',
        );
        scheduleRenderUpload('send-message:start');

        if (uploadSendFlowCancelCheck('before-click-send-button-inner')) {
          sendFailureHandled = true;
          return false;
        }

        const stableSendSource = source === 'button' || source === 'shortcut'
          ? 'manual-send-message-button'
          : (
            source === 'quick-prompt-click'
            || source.startsWith('quick-prompt')
              ? source
              : `manual-send-message-${source}`
          );

        if (typeof stableSendMessage !== 'function') {
          console.error('[ChatGPT toolbox] stableSendMessage is not available');
          setStatus('发送模块未就绪，请刷新页面后重试', 'error');
          return false;
        }

        let sendResult = null;
        let outerAttempt = 0;
        let hasPendingComposerPayloadAfterFail = detectPendingComposerPayloadForSend();

        while (state.autoSendRunId === runId) {
          outerAttempt += 1;

          if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
            logUploadSendUiState('send-aborted', 'page-navigating', runId);
            resetUploadSendUiState('send-message:page-navigating', runId);
            return false;
          }

          const capabilityNow = getUploadPageCapability({ heavy: true });
          const homeReadyNow = typeof isHomeNewChatReadyToSendNow === 'function'
            && isHomeNewChatReadyToSendNow();
          if (capabilityNow.isResponding && !homeReadyNow) {
            enterUploadWaitingReplyBlocked(runId, source);
            sendFailureHandled = true;
            return false;
          }
          if (capabilityNow.isResponding && homeReadyNow) {
            ToolboxShell.appendLog('[SEND][IGNORE_STALE_BUSY] reason=home_new_chat_ready_to_send');
          }

          if (uploadSendFlowCancelCheck('before-stable-send-attempt')) {
            sendFailureHandled = true;
            return false;
          }

          sendResult = await stableSendMessage({
            source: stableSendSource,
            sendExistingComposer: true,
            maxAttempts: SEND_STABLE_RETRY_LIMIT,
            intervalMs: SEND_STABLE_RETRY_INTERVAL_MS,
            blockWhenResponding: true,
            shouldStop: () => shouldStopForeverSend(runId),
          });

          if (state.autoSendRunId !== runId) {
            logUploadSendUiState('send-aborted', 'runId-changed', runId);
            return false;
          }

          if (sendResult && sendResult.ok) {
            break;
          }

          const failReason = String((sendResult && sendResult.reason) || 'unknown');

          if (sendResult && sendResult.wait_reply) {
            enterUploadWaitingReplyBlocked(runId, source);
            sendFailureHandled = true;
            return false;
          }

          if (failReason === 'page_navigating' || failReason === 'cancelled') {
            break;
          }

          const hasPendingComposerPayloadAfterFail = detectPendingComposerPayloadForSend();

          if (!isForeverRetryableSendReason(failReason) || !hasPendingComposerPayloadAfterFail) {
            break;
          }

          if (outerAttempt === 1 || outerAttempt % 10 === 0) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][send-message-button:retry-forever] reason=${failReason} runId=${runId} outerAttempt=${outerAttempt}`,
            );
          }
          setStatus('附件已存在，继续等待发送按钮...', 'running');
          state.waitingSend = true;
          state.autoSendWaiting = true;
          uploadSendShortcutRunning = true;
          uploadSendTaskStartedAt = Date.now();
          scheduleRenderUpload('send-message:retry-transient');
          await sleep(800);
        }

        if (state.autoSendRunId !== runId) {
          logUploadSendUiState('send-aborted', 'runId-changed', runId);
          return false;
        }

        if (sendResult && sendResult.ok) {
          enterUploadWaitingReplyAfterSend(runId, sendResult.reason || source);
          return true;
        }

        const failReason = String((sendResult && sendResult.reason) || 'unknown');
        const composerTextAfterFail = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '')
          : '';
        const attachmentCountAfterFail = typeof ComposerApi.countAttachmentChips === 'function'
          ? ComposerApi.countAttachmentChips()
          : 0;

        const failMessage = mapForeverSendFailureMessage(failReason)
          || mapUploadSendFailureMessage(failReason);

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:not-sent] reason=${failReason} textLen=${composerTextAfterFail.length} attachmentCount=${attachmentCountAfterFail} runId=${runId} autoSendRunId=${state.autoSendRunId}`,
        );

        if (failReason === 'cancelled' || failReason === 'page_navigating') {
          logUploadSendUiState('cancelled', failReason, runId);
          return false;
        }

        console.error(
          '[ChatGPT toolbox] send message not sent',
          failReason,
          `textLen=${composerTextAfterFail.length}`,
          `attachmentCount=${attachmentCountAfterFail}`,
        );

        state.waitingSend = false;
        state.autoSendWaiting = false;
        uploadSendShortcutRunning = false;
        uploadSendTaskStartedAt = 0;
        resetUploadSendButtonState('send_failed_or_timeout', runId);

        if (state.autoSendRunId === runId) {
          const hintText = failMessage || '发送失败';
          setStatus(hintText, 'warn');
          state.uploadSendFailureHint = hintText;
          state.uploadSendFailureHintAt = Date.now();
        }

        scheduleRenderUpload('send-message:not-sent-reset');
        logUploadSendUiState('not-sent', failReason, runId);
        sendFailureHandled = true;
        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send current message failed', err);
        const failMessage = `发送失败：${errText}`;
        ToolboxShell.appendLog(`[UPLOAD_DIAG][send-message-button:failed] runId=${runId} error=${errText}`);
        logUploadSendUiState('error', errText, runId);
        resetUploadSendButtonState('send_failed_or_timeout', runId);
        if (state.autoSendRunId === runId) {
          setStatus(failMessage, 'warn');
          state.uploadSendFailureHint = failMessage;
          state.uploadSendFailureHintAt = Date.now();
        }
        scheduleRenderUpload('send-message:exception-reset');
        sendFailureHandled = true;
        return false;
      } finally {
        if (!state.waitingReply && !isWaitingSendActive()) {
          state.waitingSend = false;
          state.autoSendWaiting = false;
          uploadSendShortcutRunning = false;
          uploadSendTaskStartedAt = 0;
        }

        if (!state.waitingReply && !sendFailureHandled && !isWaitingSendActive()) {
          state.uploadSendFailureHint = '';
          state.uploadSendFailureHintAt = 0;
          resetUploadSendUiState(
            state.autoSendRunId === runId ? 'send-message-finally' : 'send-message-finally-runid-changed',
            runId,
          );
          scheduleRenderUpload(
            state.autoSendRunId === runId ? 'send-message:finally' : 'send-message:finally-runid-changed',
          );
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

    function isChatGPTComposerEditableTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) {
        return false;
      }

      return !!el.closest([
        '#prompt-textarea',
        '[data-testid="prompt-textarea"]',
        '[data-testid="composer-root"]',
        'main form [contenteditable="true"]',
        'main form textarea',
        'main [role="textbox"]',
      ].join(','));
    }

    function shouldIgnoreSendShortcutTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) return false;

      const inToolbox = !!el.closest(`#${APP.rootId}, #${APP.panelId}`);

      if (!inToolbox) {
        return isChatGPTComposerEditableTarget(el);
      }

      const editable = el.closest([
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="searchbox"]',
      ].join(','));

      if (editable) {
        return !editable.hasAttribute('data-enter-send');
      }

      if (el.closest('button[data-enter-keep-native="1"]')) {
        return true;
      }

      return false;
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
      resetUploadSendUiState(reason, runId);
      scheduleRenderUpload(`send-shortcut-reset:${reason || '-'}`);
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-shortcut:state-reset] reason=${reason || '-'} runId=${runId || '-'} autoSendRunId=${state.autoSendRunId || '-'} waitingSend=${state.waitingSend ? '1' : '0'} autoSendWaiting=${state.autoSendWaiting ? '1' : '0'} waitingReply=${state.waitingReply ? '1' : '0'} shortcutRunning=${uploadSendShortcutRunning ? '1' : '0'}`
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
      if (shouldIgnoreSendShortcutTarget(e.target)) {
        logUploadShortcutDebug(e, 'send-ignore', 'target-editable');
        return false;
      }
      const now = Date.now();
      if (now - uploadSendShortcutLastAt < 500) {
        e.preventDefault();
        e.stopPropagation();
        logUploadShortcutDebug(e, 'send-ignore', 'too-fast');
        return true;
      }
      uploadSendShortcutLastAt = now;
      e.preventDefault();
      e.stopPropagation();
      if (isWaitingSendActive()) {
        if (isChatGPTComposerEditableTarget(e.target)) {
          logUploadShortcutDebug(e, 'send-ignore', 'chatgpt-composer-waiting-send');
          return false;
        }

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

    async function triggerSendHotkeyOnce() {
      setStatus('正在请求 GUI 发送 Ctrl+Alt+I', 'running');
      ToolboxShell.appendLog('[SYSTEM_HOTKEY][REQUEST] combo=ctrl+alt+i');

      try {
        const result = await BridgeModule.sendSystemHotkey('ctrl+alt+i');
        setStatus('已请求 GUI 发送 Ctrl+Alt+I', 'success');
        ToolboxShell.appendLog('[SYSTEM_HOTKEY][DONE] combo=ctrl+alt+i result=' + JSON.stringify(result).slice(0, 200));
        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[SYSTEM_HOTKEY][FAILED]', {
          error_type: err && err.name,
          error: errText,
          stack: err && err.stack,
        });
        setStatus(`GUI 快捷键失败：${errText}`, 'error');
        ToolboxShell.appendLog('[SYSTEM_HOTKEY][FAILED] error=' + errText);
        return false;
      }
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

    function shouldIgnoreUploadStartShortcutTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) return false;

      const inToolbox = !!el.closest(`#${APP.rootId}, #${APP.panelId}`);
      if (!inToolbox) {
        return false;
      }

      return !!el.closest([
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="searchbox"]',
      ].join(','));
    }

    function handleUploadStartShortcutKeydown(e, source = 'document') {
      if (!isUploadStartShortcutEvent(e)) {
        return;
      }

      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (shouldIgnoreUploadStartShortcutTarget(e.target)) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-shortcut:skip] reason=toolbox-editable source=${source} key=${e.key || '-'} code=${e.code || '-'}`
        );
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
        `[UPLOAD_DIAG][upload-shortcut:trigger] source=${source} key=${e.key || '-'} code=${e.code || '-'}`
      );

      const btn = rootElRef
        ? qs(UploadSelectors.startBtn, rootElRef)
        : qs(UploadSelectors.startBtn);

      if (btn) {
        if (btn.disabled) {
          ToolboxShell.appendLog('[UPLOAD_DIAG][upload-shortcut:failed] reason=button-disabled');
          return;
        }

        btn.click();
        return;
      }

      ToolboxShell.appendLog('[UPLOAD_DIAG][upload-shortcut:failed] reason=button-not-found');
    }

    function bindUploadStartShortcut() {
      if (uploadStartShortcutBound) {
        return;
      }

      uploadStartShortcutBound = true;

      document.addEventListener('keydown', (e) => {
        handleUploadStartShortcutKeydown(e, 'document');
      }, true);

      window.addEventListener('keydown', (e) => {
        handleUploadStartShortcutKeydown(e, 'window');
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

      if (!ensureActiveUploadGroupIdValid('start-upload')) {
        if (!state.groups.length) {
          setStatus('请先选择文件组');
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-groups]');
          appendUploadGroupLog('START_UPLOAD', { phase: 'blocked', reason: 'no-groups' });
          return buildUploadSkipResult('no-active-group');
        }
      }

      if (!state.activeGroupId) {
        setStatus('请先选择文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-active-group]');
        appendUploadGroupLog('START_UPLOAD', { phase: 'blocked', reason: 'empty-activeGroupId' });
        return buildUploadSkipResult('no-active-group');
      }

      const activeFiles = getActiveGroupFiles();
      appendUploadGroupLog('START_UPLOAD', { phase: 'plan' });

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
          setStatus(`当前分组文件已全部绑定：${attachedCount}/${totalCount}；再次点击「开始上传」将再次绑定`, 'success');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:skip-all-attached] attached=${attachedCount} total=${totalCount}`,
          );
          return buildUploadResult(attachedCount, 0, false, totalCount, {
            skipped: true,
            reason: 'all-attached',
          });
        }

        scheduleRenderUpload('startUpload:skip-no-targets');
        setStatus(`当前没有可上传文件，缺少 ${missingTargets.length} 个，请重新绑定或重新拖入`);
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
          if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
            state.cancelled = true;
            break;
          }

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

    function isQueueItemAlreadyUploaded(q) {
      if (!q) return true;
      if (q.status === 'uploaded') return true;
      return q.state === UploadState.ATTACHED;
    }

    function isFlaskLocalDirectItem(item) {
      if (!item) return false;
      const source = String(
        item.source || item.origin || item.kind || item.sourceKind || '',
      ).trim();
      return (
        source === 'local_direct'
        || source === 'flask'
        || source === 'flask_local_direct'
        || item.local_direct === true
        || item.flask_local_direct === true
        || !!item.file_id
        || !!item.download_url
      );
    }

    function normalizeFlaskFilesFromBridge(list) {
      const rows = Array.isArray(list) ? list : [];
      return rows
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          ...item,
          source: 'flask_local_direct',
          status: item.status || 'pending',
        }));
    }

    function applyBridgeUploadFiles(patch) {
      const payload = patch && typeof patch === 'object' ? patch : {};
      if (!Object.prototype.hasOwnProperty.call(payload, 'upload_files')) {
        return;
      }
      const incoming = normalizeFlaskFilesFromBridge(payload.upload_files);
      state.flaskFiles = incoming;
      ToolboxShell.appendLog(
        `[UPLOAD][FLASK_SYNC] count=${incoming.length} names=${incoming.map((f) => f.name || '-').join('|')}`,
      );
      scheduleRenderUpload('bridge-upload-files-sync');
    }

    function getPendingUploadItems() {
      const items = [];
      const seen = new Set();

      const pushItem = (item, source) => {
        if (!item) return;
        const key = [
          source,
          item.id || item.file_id || '',
          item.name || item.filename || '',
          item.download_url || '',
        ].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
          ...item,
          source: source || item.source || 'browser_file',
        });
      };

      for (const item of state.queue || []) {
        if (!item) continue;
        if (isQueueItemAlreadyUploaded(item)) continue;
        if (!hasAttemptableUploadSource(item) && !isFlaskLocalDirectItem(item)) continue;
        pushItem(item, item.source || 'browser_file');
      }

      for (const item of state.flaskFiles || []) {
        if (!item) continue;
        if (item.status === 'uploaded') continue;
        if (!isFlaskLocalDirectItem(item)) continue;
        pushItem(item, 'flask_local_direct');
      }

      return items;
    }

    function getUploadCountStats() {
      const localFiles = (state.flaskFiles || []).filter(
        (item) => item && item.status !== 'uploaded',
      );
      const pendingItems = getPendingUploadItems();
      const uploadingCount = state.running
        ? pendingItems.length
        : 0;

      return {
        localFileCount: localFiles.length,
        pendingCount: pendingItems.length,
        uploadingCount,
      };
    }

    async function resolveUploadFileObject(item) {
      if (!item) {
        throw new Error('空文件项，无法解析上传对象');
      }

      if (item.file instanceof File) {
        return item.file;
      }

      if (item.blob instanceof Blob) {
        return new File(
          [item.blob],
          item.name || item.filename || 'upload.bin',
          { type: item.mime_type || item.type || 'application/octet-stream' },
        );
      }

      if (item.id && (item.fileHandle || item.file || item.blob)) {
        const fresh = await readFreshFile(item);
        const normalized = normalizeToNativeFile(fresh, item.name || 'upload.bin');
        if (normalized) {
          return normalized;
        }
        if (fresh instanceof Blob) {
          return new File(
            [fresh],
            item.name || 'upload.bin',
            { type: item.mime_type || item.type || 'application/octet-stream' },
          );
        }
        return fresh;
      }

      const fileName = item.name || item.filename || 'upload.bin';
      const downloadUrl = String(
        item.download_url || item.url || item.file_url || '',
      ).trim();

      if (!downloadUrl) {
        throw new Error(`文件缺少 download_url，无法从 Flask 获取内容：${fileName}`);
      }

      const response = await fetch(downloadUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(
          `下载文件失败：${response.status} ${response.statusText} ${fileName}`,
        );
      }

      const blob = await response.blob();

      return new File(
        [blob],
        fileName,
        { type: item.mime_type || blob.type || 'application/octet-stream' },
      );
    }

    function findChatGPTFileInput() {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (inputs.length > 0) {
        return inputs[0];
      }

      const attachButtons = Array.from(
        document.querySelectorAll('button, [role="button"]'),
      ).filter((el) => {
        const text = (el.innerText || el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const title = (el.getAttribute('title') || '').trim();
        return (
          text.includes('添加')
          || text.includes('上传')
          || text.includes('Attach')
          || text.includes('Upload')
          || aria.includes('Attach')
          || aria.includes('Upload')
          || aria.includes('添加')
          || aria.includes('上传')
          || title.includes('Attach')
          || title.includes('Upload')
        );
      });

      if (attachButtons.length > 0) {
        attachButtons[0].click();
      }

      return document.querySelector('input[type="file"]');
    }

    async function uploadFilesToChatGPT(files) {
      const cleanFiles = (files || []).filter(Boolean);
      if (!cleanFiles.length) {
        ToolboxShell.showToast('没有待上传文件', 'warn', 1800);
        return false;
      }

      if (
        typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.attachFilesByFileInput === 'function'
      ) {
        const uploadResult = await ComposerApi.attachFilesByFileInput(cleanFiles, 12000, {});
        if (uploadResult && uploadResult.ok) {
          return true;
        }
        const reason = (uploadResult && uploadResult.reason)
          ? uploadResult.reason
          : 'attachFilesByFileInput 未成功';
        throw new Error(reason);
      }

      const input = findChatGPTFileInput();
      if (!input) {
        throw new Error('未找到 ChatGPT 文件输入框 input[type=file]');
      }

      const dataTransfer = new DataTransfer();
      for (const file of cleanFiles) {
        dataTransfer.items.add(file);
      }

      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return true;
    }

    function releaseUploadPayload(item, reason) {
      if (!item) return;
      const name = item.name || '-';
      const id = item.id || item.file_id || '-';
      let released = false;

      if (item.file) {
        item.file = null;
        released = true;
      }

      if (item.blob) {
        item.blob = null;
        released = true;
      }

      if (item.arrayBuffer) {
        item.arrayBuffer = null;
        released = true;
      }

      if (item.objectUrl) {
        try {
          URL.revokeObjectURL(item.objectUrl);
        } catch (revokeErr) {
          const errText = revokeErr && revokeErr.message ? revokeErr.message : String(revokeErr);
          console.error('[ChatGPT toolbox] releaseUploadPayload revokeObjectURL failed', revokeErr);
          ToolboxShell.appendLog(`[UPLOAD][RELEASE_LARGE_OBJECTS][revoke-failed] name=${name} error=${errText}`);
        }
        item.objectUrl = '';
        released = true;
      }

      if (released) {
        ToolboxShell.appendLog(
          `[UPLOAD][RELEASE_LARGE_OBJECTS] name=${name} reason=${reason || 'uploaded'}`,
        );
      }
    }

    function markPendingItemsUploaded(pendingItems) {
      const flaskIds = [];

      for (const item of pendingItems || []) {
        if (!item) continue;

        if (item.source === 'flask_local_direct' || item.file_id) {
          item.status = 'uploaded';
          if (item.file_id) {
            flaskIds.push(item.file_id);
          }
          releaseUploadPayload(item, 'flask-uploaded');
          continue;
        }

        if (item.id) {
          updateItem(item.id, {
            state: UploadState.ATTACHED,
            message: '已绑定到输入框',
          });
          releaseUploadPayload(item, 'attached-to-input');
        }
      }

      if (flaskIds.length) {
        state.flaskFiles = (state.flaskFiles || []).map((row) => {
          if (!row || !row.file_id) return row;
          if (!flaskIds.includes(row.file_id)) return row;
          return {
            ...row,
            status: 'uploaded',
          };
        });
      }
    }

    async function startUploadFromCurrentQueue(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const uploadSource = String(opts.source || 'button').trim() || 'button';
      const shouldStop = typeof opts.shouldStop === 'function' ? opts.shouldStop : null;

      const checkShouldStop = () => !!(shouldStop && shouldStop());

      if (state.running) {
        setStatus('正在上传中，请稍候', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][FAILED] source=${uploadSource} reason=already-running`,
        );
        return buildQueueUploadResult({
          ok: false,
          reason: 'already-running',
        });
      }

      if (checkShouldStop()) {
        ToolboxShell.appendLog(
          `[UPLOAD][CANCELLED] source=${uploadSource}`,
        );
        return buildQueueUploadResult({
          ok: false,
          reason: 'cancelled',
          cancelled: true,
        });
      }

      // 重置已绑定的文件，允许再次上传
      resetQueueItemsForUpload({ forceResetAttached: true });
      resetFlaskFilesForUpload(`startUploadFromCurrentQueue:${uploadSource}`);

      const pendingItems = getPendingUploadItems();

      if (!pendingItems.length) {
        const stats = getUploadCountStats();
        const hint = '没有待上传文件：当前油猴上传队列为空，且没有可下载的 Flask 本地文件。';
        ToolboxShell.showToast(hint, 'warn', 2600);
        console.warn('[UPLOAD][NO_PENDING_FILES]', {
          uploadQueue: state.queue,
          flaskFiles: state.flaskFiles,
          stats,
        });
        ToolboxShell.appendLog(
          `[UPLOAD][FAILED] source=${uploadSource} reason=no-files queue=${(state.queue || []).length} flask=${(state.flaskFiles || []).length}`,
        );
        return buildQueueUploadResult({
          ok: false,
          reason: 'no-files',
        });
      }

      state.running = true;
      scheduleRenderUpload('startUploadFromCurrentQueue:start');

      try {
        setStatus('正在上传…', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][START] source=${uploadSource} pending=${pendingItems.length}`,
        );

        const files = [];
        for (const item of pendingItems) {
          if (checkShouldStop()) {
            ToolboxShell.appendLog(
              `[UPLOAD][CANCELLED] source=${uploadSource}`,
            );
            return buildQueueUploadResult({
              ok: false,
              reason: 'cancelled',
              cancelled: true,
            });
          }

          const file = await resolveUploadFileObject(item);
          files.push(file);
        }

        if (checkShouldStop()) {
          ToolboxShell.appendLog(
            `[UPLOAD][CANCELLED] source=${uploadSource}`,
          );
          return buildQueueUploadResult({
            ok: false,
            reason: 'cancelled',
            cancelled: true,
          });
        }

        await uploadFilesToChatGPT(files);
        markPendingItemsUploaded(pendingItems);

        scheduleRenderUpload('startUploadFromCurrentQueue:done');
        persistQueueThrottled('startUploadFromCurrentQueue:done');

        ToolboxShell.showToast(
          `已提交 ${files.length} 个文件到 ChatGPT 上传框`,
          'success',
          2200,
        );
        console.log('[UPLOAD][DONE]', files.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
        })));
        setStatus(`已提交 ${files.length} 个文件到 ChatGPT`, 'success');
        ToolboxShell.appendLog(
          `[UPLOAD][DONE] source=${uploadSource} uploaded=${files.length} failed=0 skipped=0`,
        );

        return buildQueueUploadResult({
          ok: true,
          uploadedCount: files.length,
          failedCount: 0,
          skippedCount: 0,
          reason: '',
        });
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const errStack = error && error.stack ? error.stack : errText;

        console.error('[UPLOAD][FAILED]', {
          source: uploadSource,
          error_type: errName,
          error: errText,
          stack: errStack,
        });
        ToolboxShell.appendLog(
          `[UPLOAD][FAILED] source=${uploadSource} reason=${errText}`,
        );
        ToolboxShell.showToast(`上传失败：${errText}`, 'error', 3200);
        setStatus(`上传失败：${errText}`, 'error');

        return buildQueueUploadResult({
          ok: false,
          uploadedCount: 0,
          failedCount: pendingItems.length,
          skippedCount: 0,
          reason: errText,
        });
      } finally {
        state.running = false;
        scheduleRenderUpload('startUploadFromCurrentQueue:finally');
      }
    }

    async function handleStartUploadClick(source = 'button') {
      const queueResult = await startUploadFromCurrentQueue({ source });
      return toLegacyUploadResult(queueResult);
    }

    async function triggerStartUpload(source = 'button') {
      return await handleStartUploadClick(source);
    }

    function getLatestAssistantTextForCopyCheck() {
      try {
        if (typeof getLatestAssistantMessageForCopy === 'function') {
          const cachedPick = getLatestAssistantMessageForCopy({ forceRefresh: false });
          if (cachedPick && cachedPick.ok && cachedPick.text) {
            return String(cachedPick.text).trim();
          }
        }

        const records = typeof ChatMessageExtractor.getFastTailMessageRecords === 'function'
          ? ChatMessageExtractor.getFastTailMessageRecords({ includeHidden: false })
          : ChatMessageExtractor.buildRecords({
            includeEmpty: false,
          });
        const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);

        if (!picked.ok || !picked.record) {
          return '';
        }

        return ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        const stack = err && err.stack ? String(err.stack).slice(0, 400) : '';
        console.error('[ChatGPT toolbox] getLatestAssistantTextForCopyCheck failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:assistant-text-check-failed] error=${errText} stack=${stack}`);
        return '';
      }
    }

    function hasRealStopButtonForCopy() {
      if (typeof hasRealChatGPTStopGeneratingButton === 'function') {
        return hasRealChatGPTStopGeneratingButton();
      }

      const selectors = [
        'button[data-testid="stop-button"]',
        'button[data-testid="composer-stop-button"]',
        'button[aria-label="停止生成"]',
        'button[aria-label="Stop generating"]',
        'button[aria-label*="Stop generating"]',
      ];

      for (const selector of selectors) {
        const buttons = Array.from(document.querySelectorAll(selector));

        for (const btn of buttons) {
          if (!btn) {
            continue;
          }

          if (typeof isInsideToolbox === 'function' && isInsideToolbox(btn)) {
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
      }

      return false;
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

    // TODO(cleanup-observe): 当前静态扫描无调用，待确认是否接入「等待回复完成再复制」流程或删除。
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
        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          return {
            ok: false,
            reason: 'page_navigating',
          };
        }

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
        if (shouldSkipGlobalShortcutForToolboxTarget(e.target)) {
          logShortcutDebug(e, 'copy-ignore', 'target-in-toolbox-non-editable');
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
        if (copyLastReplyTaskRunning || copyLastMessageTaskRunning || copyLastMessageShortcutRunning) {
          ToolboxShell.setStatus(
            '正在复制最后回复，请不要重复触发',
            'running',
            {
              persist: true,
              shortText: copyLastMessageWaiting ? '等回复' : '复制中',
            },
          );
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message-shortcut:ignored] reason=running');
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=running-or-ignored');
          return;
        }
        copyLastMessageShortcutRunning = true;
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message-shortcut:trigger] key=${e.key || '-'} code=${e.code || '-'}`
        );
        runUploadActionPromise(
          runCopyAction('copy-only', { source: 'shortcut' }),
          '复制最后回复',
        );
        window.setTimeout(() => {
          copyLastMessageShortcutRunning = false;
        }, 1200);
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

      if (typeof button.blur === 'function') {
        button.blur();
      }

      ToolboxShell.appendLog(
        `[UPLOAD_UI_ACTION][hit] action=${action} source=${src} disabled=${button.disabled ? '1' : '0'}`,
      );

      if (typeof ToolboxShell.suspendEdgeAutoHide === 'function') {
        ToolboxShell.suspendEdgeAutoHide(`run-action:${action}:${src}`, 3000);
      }

      if (
        action === 'send-message'
        && (isWaitingSendActive() || state.waitingReply)
      ) {
        cancelCurrentUploadSend(
          src === 'delegated-click' ? 'manual-click-upload-button' : src,
        );
        return true;
      }

      if (
        action === 'start-upload'
        && (state.running || isWaitingSendActive() || state.waitingReply)
      ) {
        cancelCurrentUploadSend('manual-click-upload-button');
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

      if (button.disabled && action !== 'copy-last-message' && action !== 'copy-continue' && action !== 'send-message') {
        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][ignored] action=${action} source=${src} reason=button-disabled`
        );
        return true;
      }

      if (action === 'copy-last-message') {
        runUploadActionPromise(
          runCopyAction('copy-only', { source: src }),
          '复制最后回复',
        );
        return true;
      }

      if (action === 'send-message') {
        void startSendMessageFlow({ source: src }).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] send message UI action failed', err);
          setStatus(`发送信息失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][send-message:failed] error=${errText}`);
        });

        return true;
      }

      if (action === 'copy-continue') {
        button.disabled = false;
        button.removeAttribute('disabled');
        runUploadActionPromise(
          runCopyAction('copy-and-continue', { source: src || 'runUploadUiAction' }),
          '复制并继续',
        );

        return true;
      }

      if (action === 'copy-hotkey-once') {
        runUploadActionPromise(
          handleCopyHotkeyOnceTrigger('button', event),
          '复制+快捷键',
        );
        return true;
      }

      if (action === 'start-upload') {
        void startUploadOnlyFlow({ source: src || 'button' }).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] start upload UI action failed', err);
          setStatus(`上传失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][start-upload:failed] error=${errText}`);
        });

        return true;
      }

      return false;
    }

    function findNewChatButton() {
      const selectors = [
        'a[data-testid="create-new-chat-button"]',
        '[data-testid="create-new-chat-button"]',
        '[data-sidebar-action="new-chat"]',
        'a[aria-label*="新聊天"]',
        'a[aria-label*="New chat"]',
        'a[href="/"]',
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el instanceof HTMLElement) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return el;
          }
        }
      }

      return null;
    }

    function clickElementLikeUser(el) {
      if (!(el instanceof HTMLElement)) {
        throw new Error('click_target_not_html_element');
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        throw new Error('click_target_not_visible');
      }

      el.scrollIntoView({
        block: 'center',
        inline: 'center',
        behavior: 'instant',
      });

      if (typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
      }

      const clickByNative = () => {
        if (typeof el.click === 'function') {
          el.click();
          return true;
        }
        return false;
      };

      const clickByMouseEvents = () => {
        const nextRect = el.getBoundingClientRect();
        const x = nextRect.left + nextRect.width / 2;
        const y = nextRect.top + nextRect.height / 2;

        const common = {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: 1,
        };

        const eventWindow = el.ownerDocument && el.ownerDocument.defaultView
          ? el.ownerDocument.defaultView
          : window;

        el.dispatchEvent(new eventWindow.MouseEvent('mousedown', common));
        el.dispatchEvent(new eventWindow.MouseEvent('mouseup', common));
        el.dispatchEvent(new eventWindow.MouseEvent('click', common));
        return true;
      };

      try {
        if (clickByNative()) {
          return {
            ok: true,
            method: 'native_click',
          };
        }
      } catch (error) {
        console.error('[TOOLBOX][GO_HOME][NATIVE_CLICK_FAILED]', error);
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[TOOLBOX][GO_HOME][NATIVE_CLICK_FAILED] type=${error && error.name ? error.name : 'Error'} error=${error && error.message ? error.message : String(error)}`,
          );
        }
      }

      clickByMouseEvents();

      return {
        ok: true,
        method: 'mouse_events',
      };
    }

    async function goHomeByClickNewChat(source) {
      const btn = findNewChatButton();

      if (!btn) {
        console.warn('[TOOLBOX][GO_HOME] 未找到新聊天按钮，取消回到首页动作');
        ToolboxShell.appendLog(
          `[TOOLBOX][GO_HOME] source=${source || '-'} reason=new_chat_button_not_found`,
        );
        setStatus('未找到新聊天按钮', 'warn');
        return {
          ok: false,
          reason: 'new_chat_button_not_found',
        };
      }

      try {
        console.log('[TOOLBOX][GO_HOME] 点击左侧新聊天按钮');
        ToolboxShell.appendLog(
          `[TOOLBOX][GO_HOME] source=${source || '-'} action=click-new-chat`,
        );
        setStatus('正在打开新聊天...', 'running');
        const clickResult = clickElementLikeUser(btn);
        ToolboxShell.appendLog(
          `[TOOLBOX][GO_HOME] source=${source || '-'} clicked=1 method=${clickResult && clickResult.method ? clickResult.method : '-'}`,
        );
        setStatus('已点击新聊天', 'ok');
        return {
          ok: true,
          reason: 'clicked_new_chat',
          method: clickResult && clickResult.method ? clickResult.method : '-',
        };
      } catch (err) {
        const errName = err && err.name ? err.name : 'Error';
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] go home by click new chat failed', err);
        ToolboxShell.appendLog(
          `[TOOLBOX][GO_HOME] source=${source || '-'} type=${errName} error=${errText}`,
        );
        setStatus(`打开新聊天失败：${errText}`, 'error');
        return {
          ok: false,
          reason: errText || 'click_new_chat_failed',
        };
      }
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
          if (typeof copyContinueBtn.blur === 'function') {
            copyContinueBtn.blur();
          }

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
          e.preventDefault();
          e.stopPropagation();
          if (typeof copyBtn.blur === 'function') {
            copyBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-last-reply');
          runUploadActionPromise(
            runCopyAction('copy-only', { source: 'delegated-click' }),
            '复制最后回复',
          );
          return;
        }

        const sendBtn = target.closest('#cgpt-upload-start-send');
        if (sendBtn) {
          if (sendBtn.dataset.uploadDirectSendClickBound === '1') {
            return;
          }
          if (typeof sendBtn.blur === 'function') {
            sendBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=send-message');
          runUploadUiAction('send-message', sendBtn, 'delegated-click', e);
          return;
        }

        const uploadBtn = target.closest('#cgpt-upload-start');
        if (uploadBtn) {
          if (uploadBtn.dataset.uploadDirectStartClickBound === '1') {
            return;
          }
          if (typeof uploadBtn.blur === 'function') {
            uploadBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=start-upload');
          runUploadUiAction('start-upload', uploadBtn, 'delegated-click', e);
          return;
        }

        const sendHotkeyBtn = target.closest('#cgpt-send-hotkey-once');
        if (sendHotkeyBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof sendHotkeyBtn.blur === 'function') {
            sendHotkeyBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=send-hotkey');
          runUploadActionPromise(triggerSendHotkeyOnce(), '发送 Ctrl+Alt+I');
          return;
        }

        const homeBtn = target.closest('#cgpt-open-chatgpt-home');
        if (homeBtn) {
          e.preventDefault();
          e.stopPropagation();

          if (typeof homeBtn.blur === 'function') {
            homeBtn.blur();
          }

          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=click-new-chat');
          void goHomeByClickNewChat('delegated-click').then((result) => {
            if (!result.ok) {
              console.warn('[TOOLBOX][GO_HOME] 回到首页失败:', result.reason);
            }
          });
          return;
        }

        const autoContinueBtn = target.closest('#cgpt-auto-continue-once');
        if (autoContinueBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof autoContinueBtn.blur === 'function') {
            autoContinueBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=auto-continue');
          runUploadActionPromise((async () => {
            if (!AutoQueueModule || typeof AutoQueueModule.triggerContinueOnce !== 'function') {
              setStatus('自动继续模块不可用', 'warn');
              return false;
            }
            return AutoQueueModule.triggerContinueOnce();
          })(), '自动继续');
          return;
        }

        const copyHotkeyOnceBtn = target.closest('#cgpt-copy-hotkey-once, [data-action="copy-hotkey-once"]');
        if (copyHotkeyOnceBtn) {
          if (typeof copyHotkeyOnceBtn.blur === 'function') {
            copyHotkeyOnceBtn.blur();
          }

          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-hotkey-once');
          runUploadActionPromise(
            handleCopyHotkeyOnceTrigger('delegated-click', e),
            '复制+快捷键',
          );

          return;
        }

        const copyHotkeyContinueOnceBtn = target.closest('#cgpt-copy-hotkey-continue-once');
        if (copyHotkeyContinueOnceBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof copyHotkeyContinueOnceBtn.blur === 'function') {
            copyHotkeyContinueOnceBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-hotkey-continue-once');
          runUploadActionPromise(
            runCopyAction('copy-hotkey-continue', { source: 'delegated-click' }),
            '复制+快捷键+继续',
          );
          return;
        }

        const copyHotkeyContinueLoopBtn = target.closest('#cgpt-copy-hotkey-continue-loop');
        if (copyHotkeyContinueLoopBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof copyHotkeyContinueLoopBtn.blur === 'function') {
            copyHotkeyContinueLoopBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-hotkey-continue-loop');
          runUploadActionPromise(
            runCopyAction('loop-copy-hotkey-continue', { source: 'delegated-click' }),
            '连续复制+快捷键+继续',
          );
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

    function bindUploadStartDirectClick(uploadBtn) {
      if (!(uploadBtn instanceof HTMLElement)) {
        return;
      }
      if (uploadBtn.dataset.uploadDirectStartClickBound === '1') {
        return;
      }
      uploadBtn.dataset.uploadDirectStartClickBound = '1';
      uploadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        if (typeof uploadBtn.blur === 'function') {
          uploadBtn.blur();
        }
        runUploadUiAction('start-upload', uploadBtn, 'direct-click', e);
      }, true);
    }

    function bindUploadStartSendDirectClick(sendBtn) {
      if (!(sendBtn instanceof HTMLElement)) {
        return;
      }
      if (sendBtn.dataset.uploadDirectSendClickBound === '1') {
        return;
      }
      sendBtn.dataset.uploadDirectSendClickBound = '1';
      sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') {
          e.stopImmediatePropagation();
        }
        if (typeof sendBtn.blur === 'function') {
          sendBtn.blur();
        }
        runUploadUiAction('send-message', sendBtn, 'direct-click', e);
      }, true);
    }

    function bindEvents(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        return;
      }

      if (rootEl.dataset.uploadEventsBound === '1') {
        ensureUploadActionButtons(rootEl);
        bindUploadDropTargets(rootEl);
        bindUploadSendShortcut();
        bindCopyLastMessageShortcut();
        bindUploadStartShortcut();
        bindCopyAndHotkeyShortcut();
        bindShortcutWindowFallback();
        bindUploadDelegatedClick(rootEl);
        bindUploadStartDirectClick(qs(UploadSelectors.startBtn, rootEl));
        bindUploadStartSendDirectClick(qs(UploadSelectors.startSendBtn, rootEl));
        bindUploadCompactActionButtons(rootEl);
        applyUploadShortcutButtonTitles(rootEl);
        return;
      }

      rootEl.dataset.uploadEventsBound = '1';

      const uploadStartBtn = qs('#cgpt-upload-start', rootEl);
      if (!uploadStartBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-start');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-btn]');
      } else {
        bindUploadStartDirectClick(uploadStartBtn);
      }

      const uploadStartSendBtn = qs(UploadSelectors.startSendBtn, rootEl);
      if (!uploadStartSendBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-start-send');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-send-btn]');
      } else {
        bindUploadStartSendDirectClick(uploadStartSendBtn);
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

            // Blob persistence binding removed - disabled

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
            setStatus(`重新绑定失败：${errText}`);
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

            setStatus(`上传队列保存失败或超时：${errText}`, 'error');

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

            const category = normalizeQuickPromptCategoryName(
              categoryBtn.getAttribute('data-upload-quick-prompt-category') || '全部',
            );
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

          await sendOrFillQuickPrompt(prompt, { source: 'quick-prompt-click' });
        });
      }

      bindUploadDropTargets(rootEl);
      bindUploadSendShortcut();
      bindCopyLastMessageShortcut();
      bindUploadStartShortcut();
      bindCopyAndHotkeyShortcut();
      bindShortcutWindowFallback();
      bindUploadDelegatedClick(rootEl);
      bindUploadCompactActionButtons(rootEl);
      applyUploadShortcutButtonTitles(rootEl);
    }

    function buildUploadActionRowHtml() {
      return `
          <div class="cgpt-row cgpt-upload-action-row">
            <button type="button" class="cgpt-btn success" id="cgpt-upload-start" title="只上传/绑定文件到 ChatGPT 输入框，不自动发送">开始上传</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send" title="发送当前输入框中的文字和附件">发送信息</button>
            <button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" title="先复制最后回复，再发送“继续”">复制并继续</button>
            <button type="button" class="cgpt-btn warning" id="cgpt-send-hotkey-once">发送 Ctrl+Alt+I</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-open-chatgpt-home" title="点击左侧新聊天">回到首页</button>
            <button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-once">自动继续</button>
            <button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom">复制最后回复</button>
            <button
              type="button"
              class="cgpt-btn purple"
              id="cgpt-copy-hotkey-once"
              data-action="copy-hotkey-once"
              title="复制最后回复，并发送配置的快捷键"
            >复制+快捷键</button>
            <button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">复制+快捷键+继续</button>
            <button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">连续复制+快捷键+继续</button>
          </div>
      `;
    }

    function buildUploadActionToolbarHtml() {
      return `
        <div class="cgpt-upload-action-toolbar">
          ${buildUploadActionRowHtml()}
        </div>
      `;
    }

    function ensureUploadActionToolbar(rootEl) {
      if (!rootEl) {
        return;
      }

      const uploadSection = rootEl.querySelector('.cgpt-section');
      let toolbar = rootEl.querySelector('.cgpt-upload-action-toolbar');
      let actionRow = rootEl.querySelector('.cgpt-upload-action-row');

      if (!toolbar) {
        toolbar = document.createElement('div');
        toolbar.className = 'cgpt-upload-action-toolbar';

        if (actionRow) {
          toolbar.appendChild(actionRow);
        } else {
          toolbar.innerHTML = buildUploadActionRowHtml();
          actionRow = toolbar.querySelector('.cgpt-upload-action-row');
        }

        if (uploadSection) {
          rootEl.insertBefore(toolbar, uploadSection);
        } else {
          rootEl.insertBefore(toolbar, rootEl.firstChild);
        }

        ToolboxShell.appendLog('[UPLOAD_UI][ACTION_TOOLBAR_INSERTED]');
      } else if (actionRow && actionRow.parentElement !== toolbar) {
        toolbar.appendChild(actionRow);
      } else if (!actionRow) {
        toolbar.innerHTML = buildUploadActionRowHtml();
      }

      const duplicateRows = rootEl.querySelectorAll('.cgpt-upload-action-row');
      if (duplicateRows.length > 1) {
        for (let i = 1; i < duplicateRows.length; i += 1) {
          duplicateRows[i].remove();
        }
        ToolboxShell.appendLog('[UPLOAD_UI][ACTION_ROW_DUPLICATE_REMOVED]');
      }

      if (uploadSection && toolbar.nextElementSibling !== uploadSection) {
        rootEl.insertBefore(toolbar, uploadSection);
      } else if (!uploadSection && rootEl.firstElementChild !== toolbar) {
        rootEl.insertBefore(toolbar, rootEl.firstChild);
      }
    }

    function ensureUploadGroupSection(rootEl) {
      if (!rootEl) {
        return;
      }

      ensureUploadActionToolbar(rootEl);

      let groupsHead = rootEl.querySelector('.cgpt-upload-groups-head');
      let groupList = rootEl.querySelector('#cgpt-upload-group-list');

      if (groupsHead && groupList) {
        groupsHead.id = 'cgpt-toolbox-project-stats-row';
        return;
      }

      const uploadSection = rootEl.querySelector('.cgpt-section');
      if (uploadSection) {
        uploadSection.classList.add('toolbox-upload-drop-zone');
      }
      const sectionTitle = uploadSection
        ? uploadSection.querySelector('.cgpt-section-title')
        : null;

      groupsHead = document.createElement('div');
      groupsHead.className = 'cgpt-upload-groups-head';
      groupsHead.id = 'cgpt-toolbox-project-stats-row';
      groupsHead.innerHTML = `
        <div class="cgpt-upload-group-bar">
          <div class="cgpt-upload-group-list" id="cgpt-upload-group-list"></div>
          <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">管理</button>
        </div>
      `;

      if (sectionTitle && sectionTitle.parentNode) {
        sectionTitle.insertAdjacentElement('afterend', groupsHead);
      } else if (uploadSection) {
        uploadSection.insertBefore(groupsHead, uploadSection.firstChild);
      } else {
        const toolbar = rootEl.querySelector('.cgpt-upload-action-toolbar');
        if (toolbar && toolbar.nextSibling) {
          rootEl.insertBefore(groupsHead, toolbar.nextSibling);
        } else {
          rootEl.insertBefore(groupsHead, rootEl.firstChild);
        }
      }

      ToolboxShell.appendLog('[UPLOAD_GROUP_UI][ENSURE_GROUP_SECTION_INSERTED]');
    }

    function ensureToolboxPageStatusRow(rootEl) {
      if (rootEl) {
        const legacyRows = rootEl.querySelectorAll(
          '#cgpt-toolbox-page-status-row, .cgpt-toolbox-top-status-row, .cgpt-toolbox-page-status-row',
        );
        legacyRows.forEach((row) => {
          if (!row.closest('.cgpt-toolbox-header')) {
            row.remove();
          }
        });

        const legacyStatusCounts = qs('#cgpt-upload-status-counts', rootEl);
        if (legacyStatusCounts) {
          legacyStatusCounts.remove();
        }

        const groupsHead = qs('.cgpt-upload-groups-head', rootEl);
        if (groupsHead && !groupsHead.id) {
          groupsHead.id = 'cgpt-toolbox-project-stats-row';
        }
      }

      if (
        typeof ToolboxShell !== 'undefined'
        && typeof ToolboxShell.ensureToolboxHeaderPageStatusRow === 'function'
      ) {
        ToolboxShell.ensureToolboxHeaderPageStatusRow();
      }
    }

    function ensureUploadActionButtons(rootEl) {
      const actionRow = qs('.cgpt-upload-action-row', rootEl);
      const copyLastBtn = qs(UploadSelectors.copyLastMessageBtn, actionRow);
      if (!actionRow || !copyLastBtn) {
        return;
      }

      const legacyUploadAndSendBtn = qs('#cgpt-upload-start-and-send', actionRow);
      if (legacyUploadAndSendBtn) {
        legacyUploadAndSendBtn.remove();
        ToolboxShell.appendLog('[UPLOAD_UI][REMOVED_LEGACY] button=cgpt-upload-start-and-send');
      }

      const uploadStartBtn = qs(UploadSelectors.startBtn, actionRow);
      if (uploadStartBtn) {
        uploadStartBtn.title = '只上传/绑定文件到 ChatGPT 输入框，不自动发送';
      }

      const uploadSendBtn = qs(UploadSelectors.startSendBtn, actionRow);
      if (uploadSendBtn) {
        uploadSendBtn.title = '发送当前输入框中的文字和附件';
      }

      let sendHotkeyBtn = qs(UploadSelectors.sendHotkeyBtn, actionRow);
      if (!sendHotkeyBtn) {
        sendHotkeyBtn = document.createElement('button');
        sendHotkeyBtn.type = 'button';
        sendHotkeyBtn.className = 'cgpt-btn warning';
        sendHotkeyBtn.id = 'cgpt-send-hotkey-once';
        sendHotkeyBtn.textContent = '发送 Ctrl+Alt+I';
        actionRow.insertBefore(sendHotkeyBtn, copyLastBtn);
      }

      let homeBtn = qs(UploadSelectors.homeBtn, actionRow);
      if (!homeBtn) {
        homeBtn = document.createElement('button');
        homeBtn.type = 'button';
        homeBtn.className = 'cgpt-btn primary';
        homeBtn.id = 'cgpt-open-chatgpt-home';
        homeBtn.textContent = '回到首页';
        homeBtn.title = '点击左侧新聊天';
        actionRow.insertBefore(homeBtn, copyLastBtn);
      }

      let autoContinueBtn = qs(UploadSelectors.autoContinueBtn, actionRow);
      if (!autoContinueBtn) {
        autoContinueBtn = document.createElement('button');
        autoContinueBtn.type = 'button';
        autoContinueBtn.className = 'cgpt-btn teal';
        autoContinueBtn.id = 'cgpt-auto-continue-once';
        autoContinueBtn.textContent = '自动继续';
        actionRow.insertBefore(autoContinueBtn, copyLastBtn);
      }

      actionRow.insertBefore(autoContinueBtn, copyLastBtn);
      actionRow.insertBefore(homeBtn, autoContinueBtn);
      actionRow.insertBefore(sendHotkeyBtn, homeBtn);

      let copyHotkeyOnceBtn = qs(UploadSelectors.copyHotkeyOnceBtn, actionRow);
      if (!copyHotkeyOnceBtn) {
        copyHotkeyOnceBtn = document.createElement('button');
        copyHotkeyOnceBtn.type = 'button';
        copyHotkeyOnceBtn.className = 'cgpt-btn purple';
        copyHotkeyOnceBtn.id = 'cgpt-copy-hotkey-once';
        copyHotkeyOnceBtn.dataset.action = 'copy-hotkey-once';
        copyHotkeyOnceBtn.textContent = '复制+快捷键';
        copyLastBtn.insertAdjacentElement('afterend', copyHotkeyOnceBtn);
      }
      copyHotkeyOnceBtn.dataset.action = 'copy-hotkey-once';
      copyHotkeyOnceBtn.title = getCopyAndHotkeyButtonTitle();

      let copyHotkeyContinueOnceBtn = qs(UploadSelectors.copyHotkeyContinueOnceBtn, actionRow);
      if (!copyHotkeyContinueOnceBtn) {
        copyHotkeyContinueOnceBtn = document.createElement('button');
        copyHotkeyContinueOnceBtn.type = 'button';
        copyHotkeyContinueOnceBtn.className = 'cgpt-btn purple';
        copyHotkeyContinueOnceBtn.id = 'cgpt-copy-hotkey-continue-once';
        copyHotkeyContinueOnceBtn.textContent = '复制+快捷键+继续';
        copyHotkeyOnceBtn.insertAdjacentElement('afterend', copyHotkeyContinueOnceBtn);
      }

      let copyHotkeyContinueLoopBtn = qs(UploadSelectors.copyHotkeyContinueLoopBtn, actionRow);
      if (!copyHotkeyContinueLoopBtn) {
        copyHotkeyContinueLoopBtn = document.createElement('button');
        copyHotkeyContinueLoopBtn.type = 'button';
        copyHotkeyContinueLoopBtn.className = 'cgpt-btn cyan';
        copyHotkeyContinueLoopBtn.id = 'cgpt-copy-hotkey-continue-loop';
        copyHotkeyContinueLoopBtn.textContent = '连续复制+快捷键+继续';
        copyHotkeyContinueLoopBtn.title = '等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令';
        copyHotkeyContinueOnceBtn.insertAdjacentElement('afterend', copyHotkeyContinueLoopBtn);
      }

      copyLastBtn.insertAdjacentElement('afterend', copyHotkeyOnceBtn);
      copyHotkeyOnceBtn.insertAdjacentElement('afterend', copyHotkeyContinueOnceBtn);
      copyHotkeyContinueOnceBtn.insertAdjacentElement('afterend', copyHotkeyContinueLoopBtn);
    }

    function bindUploadCompactActionButtons(rootEl) {
      DomUtil.bindClick(rootEl, UploadSelectors.sendHotkeyBtn, async (event) => {
        const btn = event && event.currentTarget
          ? event.currentTarget
          : qs(UploadSelectors.sendHotkeyBtn, rootEl);
        if (btn && typeof startButtonLongWaitDangerTimer === 'function') {
          startButtonLongWaitDangerTimer(btn, 'long_wait_reply_or_send', BUTTON_LONG_WAIT_DANGER_MS);
        }
        try {
          await triggerSendHotkeyOnce();
        } catch (error) {
          console.error('[SEND_HOTKEY][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`发送 Ctrl+Alt+I 失败：${error && error.message ? error.message : error}`, 'error');
        } finally {
          if (btn && typeof clearButtonLongWaitDangerTimer === 'function') {
            clearButtonLongWaitDangerTimer(btn, 'finally');
          }
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.homeBtn, async () => {
        const result = await goHomeByClickNewChat('bindClick');
        if (!result.ok) {
          console.warn('[TOOLBOX][GO_HOME] 回到首页失败:', result.reason);
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.autoContinueBtn, async (event) => {
        const btn = event && event.currentTarget
          ? event.currentTarget
          : qs(UploadSelectors.autoContinueBtn, rootEl);
        if (btn && typeof startButtonLongWaitDangerTimer === 'function') {
          startButtonLongWaitDangerTimer(btn, 'long_wait_reply_or_send', BUTTON_LONG_WAIT_DANGER_MS);
        }
        try {
          if (!AutoQueueModule || typeof AutoQueueModule.triggerContinueOnce !== 'function') {
            setStatus('自动继续模块不可用', 'warn');
            return;
          }
          await AutoQueueModule.triggerContinueOnce();
        } catch (error) {
          console.error('[AUTO_CONTINUE][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`自动继续失败：${error && error.message ? error.message : error}`, 'error');
        } finally {
          if (btn && typeof clearButtonLongWaitDangerTimer === 'function') {
            clearButtonLongWaitDangerTimer(btn, 'finally');
          }
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.copyHotkeyContinueOnceBtn, async () => {
        try {
          await runCopyAction('copy-hotkey-continue', { source: 'bindClick' });
        } catch (error) {
          console.error('[COPY_HOTKEY_CONTINUE][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`复制+快捷键+继续失败：${error && error.message ? error.message : error}`, 'error');
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.copyHotkeyContinueLoopBtn, async () => {
        try {
          await runCopyAction('loop-copy-hotkey-continue', { source: 'bindClick' });
        } catch (error) {
          console.error('[COPY_HOTKEY_CONTINUE_LOOP][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`连续复制+快捷键+继续失败：${error && error.message ? error.message : error}`, 'error');
        }
      }, 'UPLOAD');
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
          selector: '#cgpt-send-hotkey-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-send-hotkey-once',
        },
        {
          type: 'required',
          selector: '#cgpt-open-chatgpt-home',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-open-chatgpt-home',
        },
        {
          type: 'required',
          selector: '#cgpt-auto-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-auto-continue-once',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-list',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-group-list',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-upload-group-list',
        },
        {
          type: 'required',
          selector: '.cgpt-upload-action-toolbar',
          missingLog: '[UPLOAD_DOM][missing] .cgpt-upload-action-toolbar',
        },
        {
          type: 'order',
          before: '.cgpt-upload-action-toolbar',
          after: '.cgpt-section',
          message: '上传快捷操作工具栏应位于多文件上传卡片之前',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start',
          after: '#cgpt-upload-group-list',
          message: '文件组标签应位于上传快捷操作工具栏之后',
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
          invalidLog: '[UPLOAD_DOM][invalid] 复制最后回复按钮被错误放进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-open-chatgpt-home',
          message: '回到首页按钮被错误包进管理面板',
          invalidLog: '[UPLOAD_DOM][invalid] 回到首页按钮被错误包进管理面板',
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
          before: '#cgpt-upload-group-list',
          after: '#cgpt-upload-list',
          message: '上传文件列表应位于文件组标签之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start',
          after: '#cgpt-upload-list',
          message: '上传文件列表应位于上传快捷操作工具栏之后',
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
          after: '#cgpt-send-hotkey-once',
          message: '发送 Ctrl+Alt+I按钮应位于复制并继续按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-send-hotkey-once',
          after: '#cgpt-open-chatgpt-home',
          message: '回到首页按钮应位于发送 Ctrl+Alt+I按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-open-chatgpt-home',
          after: '#cgpt-auto-continue-once',
          message: '自动继续按钮应位于回到首页按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-auto-continue-once',
          after: '#cgpt-copy-last-message-scroll-bottom',
          message: '复制最后回复按钮应位于自动继续按钮之后',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-once',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-once',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-continue-loop',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-loop',
        },
        {
          type: 'order',
          before: '#cgpt-copy-last-message-scroll-bottom',
          after: '#cgpt-copy-hotkey-once',
          message: '复制+快捷键按钮应位于复制最后回复按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-copy-hotkey-once',
          after: '#cgpt-copy-hotkey-continue-once',
          message: '复制+快捷键+继续按钮应位于复制+快捷键按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-copy-hotkey-continue-once',
          after: '#cgpt-copy-hotkey-continue-loop',
          message: '连续复制+快捷键+继续按钮应位于复制+快捷键+继续按钮之后',
        },
      ], {
        moduleName: 'UPLOAD',
      });
    }

    async function applyToolboxPageState(pageState, reason = '') {
      if (!pageState || typeof pageState !== 'object') {
        return;
      }

      const shouldApplyDefaults = reason === 'init' || reason === 'route-key-changed';
      const shouldRestoreUploadGroup =
        shouldApplyDefaults || reason === 'upload-groups-ready';
      const toolboxRouteKey = getToolboxRouteKey();
      const reasonText = reason || '-';

      let targetGroupId = '';
      let source = '';

      if (shouldRestoreUploadGroup) {
        const savedSelection = getMultiUploadLastSelection();
        const skipManualNewer = (
          (reason === 'init' || reason === 'upload-groups-ready')
          && lastManualUploadGroupAt > 0
          && savedSelection.updatedAt > 0
          && lastManualUploadGroupAt >= savedSelection.updatedAt
          && isValidUploadGroupId(state.activeGroupId)
        );

        if (skipManualNewer) {
          ToolboxShell.appendLog(
            `[UPLOAD][PAGE_STATE][APPLY_SKIP_MANUAL_NEWER] reason=${reasonText} activeGroupId=${state.activeGroupId || '-'} manualAt=${lastManualUploadGroupAt} savedAt=${savedSelection.updatedAt}`,
          );
          targetGroupId = state.activeGroupId;
          source = 'manual-newer';
        } else {
          const resolved = resolveUploadGroupSelection({
            pageState,
            reason,
          });
          targetGroupId = resolved.resolvedGroupId;
          source = resolved.reason;

          const pageGroupId = resolved.pageGroupId;
          if (pageGroupId && !targetGroupId) {
            ToolboxShell.appendLog(
              `[UPLOAD_PAGE_STATE][restore-group-missing] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${pageGroupId}`,
            );
          }
        }
      } else {
        targetGroupId = String(readToolboxStateField(pageState, 'uploadActiveGroupId', '')).trim();

        if (targetGroupId && state.groups.some((g) => g.id === targetGroupId)) {
          source = 'page-state';
        } else {
          targetGroupId = '';
          source = '';
        }
      }

      if (!targetGroupId) {
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][restore-group-skip] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} noTarget=1`,
        );
      } else if (targetGroupId === state.activeGroupId) {
        ToolboxShell.appendLog(
          `[UPLOAD][PAGE_STATE][APPLY_SKIP_SAME_GROUP] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${targetGroupId || '-'} source=${source}`,
        );
      } else if (source !== 'manual-newer') {
        await switchGroup(targetGroupId, {
          savePageState: source !== 'page-state',
          saveLastManual: false,
          saveGlobalFallback: false,
          reason: `restore-page-state:${source}`,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][restore-group] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${targetGroupId || '-'} source=${source}`,
        );

        if (source === 'last-manual' || source === 'first-group') {
          saveCurrentToolboxBaseState(`restore-upload-group:${source}`);
        }
      }

      const categoryRaw = String(
        readToolboxStateField(pageState, 'quickPromptCategory', ''),
      ).trim();

      if (categoryRaw) {
        saveQuickPromptActiveCategory(categoryRaw, {
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
      ensureUploadActionToolbar(rootEl);
      ensureUploadGroupSection(rootEl);

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
      safeAppendLog('[UPLOAD_UI][ADD_FILE_BUTTON_REMOVED] \u624b\u52a8\u6dfb\u52a0\u6587\u4ef6\u6309\u94ae\u5df2\u4ece\u4e3b\u754c\u9762\u79fb\u9664\uff0c\u5f00\u59cb\u4e0a\u4f20\u5c06\u4f7f\u7528\u73b0\u6709\u6587\u4ef6\u8bb0\u5f55\u3002');
      uploadGroupsInitResolved = false;
      ensureToolboxPageStatusRow(rootEl);
      ensureUploadActionToolbar(rootEl);
      ensureUploadGroupSection(rootEl);
      ensureUploadActionButtons(rootEl);
      validateUploadDomStructure(rootEl);
      bindEvents(rootEl);

      
return clearPersistedUploadBlobs('startup-disable-blob-cache')
        .catch((e) => {
          console.warn('[ChatGPT toolbox] startup clearPersistedUploadBlobs failed', e);
        })
        .then(() => loadGroups())
        .then(() => refreshUploadGroupCounts())
        .then(() => loadQueueForActiveGroup())
        .then(() => render())
        .then(() => applyToolboxPageState(getToolboxPageState(), 'upload-groups-ready'))
        .then(() => {
          uploadGroupsInitResolved = true;
          ensureActiveUploadGroupIdValid('init-pipeline-complete');
          syncUploadGroupAppState();
                ToolboxShell.appendLog('[UPLOAD_DIAG][blob-cache-disabled] upload blob persistence disabled');
      appendUploadGroupLog('INIT', { stage: 'pipeline-complete', reason: reason || '-' });
        })
        .catch((err) => {
          const errName = err && err.name ? err.name : 'Error';
          const errText = err && err.message ? err.message : String(err);
          const errStack = err && err.stack ? err.stack : errText;
          console.error('[ChatGPT toolbox] init upload groups failed', err);
          setStatus(`上传队列初始化失败：${errText}`, 'error');
          ToolboxShell.appendLog(
            `[UPLOAD_INIT][FAILED] reason=${reason || '-'} stage=loadGroups-refreshCounts-loadQueue-render type=${errName} error=${errStack}`,
          );
          uploadGroupsInitResolved = true;
          ensureActiveUploadGroupIdValid('init-pipeline-failed');
          syncUploadGroupAppState();
          appendUploadGroupLog('INIT', { stage: 'pipeline-failed', reason: reason || '-' });
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
        ${buildUploadActionToolbarHtml()}
        <div class="cgpt-section toolbox-upload-drop-zone">
          <div class="cgpt-section-title">多文件上传</div>
          <div class="cgpt-upload-groups-head" id="cgpt-toolbox-project-stats-row">
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

              <!-- Blob persistence disabled - file content no longer saved to IndexedDB -->

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-use-unique-name-inline">
                上传时加时间戳/序号（仅内存，例：file_20260523_200319_01.zip）
              </label>

              <div class="cgpt-hint">这些设置对所有文件组生效。</div>
            </div>
          </div>

          <div class="cgpt-upload-list toolbox-upload-file-list" id="cgpt-upload-list"></div>

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

    async function trySendPendingAfterReplyOpportunity(runId) {
      if (!state.pendingSendAfterReply || state.pendingSendRetrying) {
        return false;
      }

      if (state.autoSendRunId !== runId) {
        return false;
      }

      if (shouldStopForeverSend(runId)) {
        resetUploadSendUiState('pending-send-after-reply:stopped', runId);
        scheduleRenderUpload('pending-send-after-reply:stopped');
        return true;
      }

      if (!detectPendingComposerPayloadForSend()) {
        resetUploadSendUiState('pending-send-after-reply:no-payload', runId);
        setStatus('待发送内容已不存在，停止等待发送', 'warn');
        scheduleRenderUpload('pending-send-after-reply:no-payload');
        return true;
      }

      const capability = getUploadPageCapability({ heavy: false });

      const canSendNow = !!(
        capability.canSendNow
        || capability.can_send_now
        || (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.canSendNowLight === 'function'
          && ComposerApi.canSendNowLight()
        )
        || (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.canSendNow === 'function'
          && ComposerApi.canSendNow({ maxAgeMs: 450 })
        )
      );

      const isResponding = !!(capability.isResponding || capability.is_responding);

      if (isResponding || !canSendNow) {
        return false;
      }

      state.pendingSendRetrying = true;
      state.waitingReply = false;
      state.waitingSend = true;
      state.autoSendWaiting = true;
      uploadSendShortcutRunning = true;
      uploadSendTaskStartedAt = Date.now();

      setStatus('检测到可发送，正在自动发送...', 'running');

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:opportunity-send] runId=${runId} source=${state.pendingSendAfterReplySource || '-'}`,
      );

      scheduleRenderUpload('pending-send-after-reply:opportunity');
      stopWaitingReplyCheck();

      try {
        await sendCurrentMessageFromUploadPanel(
          state.pendingSendAfterReplySource || 'retry-after-reply',
          runId,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] pending send after reply failed', err);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:opportunity-send-error] runId=${runId} error=${errText}`,
        );
      } finally {
        if (state.pendingSendRetrying && state.pendingSendAfterReply) {
          state.pendingSendRetrying = false;
          state.waitingReply = true;
          startWaitingReplyCheck(runId, Date.now());
        }
      }

      return true;
    }

    function startWaitingReplyCheck(runId, sendStartedAt) {
      stopWaitingReplyCheck();
      waitingReplyIdleStreak = 0;
      state.replyWaitSawBusy = false;
      state.replyWaitAssistantCountBefore = countVisibleAssistantMessagesForReplyWait();
      state.waitingReplyRunId = runId;
      state.waitingReplyCheckedAt = Date.now();
      logUploadSendUiState('waiting-reply-start', `runId=${runId}`, runId);

      const sendBtn = rootElRef ? qs(UploadSelectors.startSendBtn, rootElRef) : null;
      if (sendBtn && typeof startButtonLongWaitDangerTimer === 'function') {
        startButtonLongWaitDangerTimer(sendBtn, 'long_wait_reply_or_send', BUTTON_LONG_WAIT_DANGER_MS);
      }

      state.waitingReplyTimer = setInterval(function () {
        void (async function tickWaitingReplyOrSendOpportunity() {
          try {
            if (!state.waitingReply) {
              stopWaitingReplyCheck();
              return;
            }

            if (await trySendPendingAfterReplyOpportunity(runId)) {
              return;
            }

            var elapsed = Date.now() - state.waitingReplyCheckedAt;

            if (elapsed > 120000 && !state.pendingSendAfterReply) {
              logUploadSendUiState('timeout', 'waiting-reply', runId);
              finishWaitingReply('timeout');
              return;
            }

            var capability = getPageCapability('waiting-reply');
            var assistantCountNow = countVisibleAssistantMessagesForReplyWait();
            var assistantCountIncreased = assistantCountNow > state.replyWaitAssistantCountBefore;
            var stopVisible = hasRealStopButtonForCopy();

            var assistantBusy = typeof ComposerApi !== 'undefined'
              && typeof ComposerApi.isAssistantLikelyBusy === 'function'
              && ComposerApi.isAssistantLikelyBusy();

            var generatingState = isReplyGeneratingState(capability.response_state);

            if (stopVisible || assistantBusy || generatingState || assistantCountIncreased) {
              state.replyWaitSawBusy = true;
            }

            if (!capability.is_responding && !generatingState) {
              waitingReplyIdleStreak += 1;

              if (waitingReplyIdleStreak >= 2) {
                var latestAssistantTextLen = getLatestAssistantTextForCopyCheck().length;
                var hasReplyEvidence = state.replyWaitSawBusy || assistantCountIncreased;

                if (!hasReplyEvidence || latestAssistantTextLen <= 0) {
                  ToolboxShell.appendLog(
                    `[SEND_UI][reply_done_skip] runId=${runId} sawBusy=${state.replyWaitSawBusy ? 1 : 0} `
                    + `assistantIncreased=${assistantCountIncreased ? 1 : 0} textLen=${latestAssistantTextLen}`,
                  );
                  return;
                }

                if (state.pendingSendAfterReply) {
                  return;
                }

                logUploadSendUiState('reply_done', `idleStreak=${waitingReplyIdleStreak}`, runId);
                finishWaitingReply('reply_done');
              }
            } else {
              waitingReplyIdleStreak = 0;
            }
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] waiting reply check error', err);
            ToolboxShell.appendLog(`[SEND_UI][waiting-reply-check-error] error=${errText}`);
          }
        })();
      }, PRE_SEND_OPPORTUNITY_POLL_MS);
      state.waitingReplyTimerRef = state.waitingReplyTimer;
    }

    function stopWaitingReplyCheck() {
      if (state.waitingReplyTimer) {
        clearInterval(state.waitingReplyTimer);
        state.waitingReplyTimer = null;
      }
    }

    function finishWaitingReply(reason) {
      const runId = state.waitingReplyRunId;

      if (reason === 'reply_done') {
        setStatus('回复完成');

        if (
          typeof TitlePrefixModule !== 'undefined'
          && typeof TitlePrefixModule.startReplyDoneFlash === 'function'
        ) {
          TitlePrefixModule.startReplyDoneFlash('upload-waiting-reply-done');
        }

        if (
          typeof ToolboxShell !== 'undefined'
          && typeof ToolboxShell.flashHeaderTitleOnce === 'function'
        ) {
          ToolboxShell.flashHeaderTitleOnce('回复完成', {
            intervalMs: 450,
            autoStopMs: 2400,
          });
        }
      } else if (reason === 'timeout') {
        setStatus('等待回复超时', 'warn');
      } else if (reason === 'cancel') {
        setStatus('已取消等待回复');
      }

      resetUploadSendUiState(`waiting-reply:${reason}`, runId);
      scheduleRenderUpload(`waiting-reply:${reason || 'done'}`);
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

    let didLogUploadQueueLegacyFields = false;

    async function scanQueueRowsForLegacyFields() {
      if (didLogUploadQueueLegacyFields) {
        return;
      }
      didLogUploadQueueLegacyFields = true;

      if (!APP || !APP.uploadStore) {
        return;
      }

      const missingGroupIds = [];
      const legacyRowFields = [];

      try {
        const db = await openDb();
        const rows = await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readonly');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();
          req.onerror = () => {
            reject(req.error || new Error('IndexedDB uploadStore getAll failed'));
          };
          req.onsuccess = () => {
            resolve(Array.isArray(req.result) ? req.result : []);
          };
        });

        rows.forEach((row, index) => {
          if (!row || typeof row !== 'object') {
            return;
          }
          if (!String(row.groupId || '').trim()) {
            missingGroupIds.push(`queue[${index}].groupId`);
          }
          if (Object.prototype.hasOwnProperty.call(row, 'upload_active_group_id')) {
            legacyRowFields.push(`queue[${index}].upload_active_group_id`);
          }
        });
      } catch (error) {
        console.error('[ChatGPT toolbox] scanQueueRowsForLegacyFields failed', error);
        return;
      }

      if (missingGroupIds.length) {
        const line = `[FIELD][LEGACY_FOUND] scope=uploadQueue fields=${missingGroupIds.join(',')}`;
        console.warn(line);
        ToolboxShell.appendLog(line);
      }
      if (legacyRowFields.length) {
        const line = `[FIELD][LEGACY_FOUND] scope=uploadQueue fields=${legacyRowFields.join(',')}`;
        console.warn(line);
        ToolboxShell.appendLog(line);
      }
    }

    async function startUploadFromBridge(payload = {}) {
      const source = String(payload.source || 'bridge_command').trim() || 'bridge_command';
      const queueResult = await startUploadFromCurrentQueue({ source });
      const result = toLegacyUploadResult(queueResult);
      const status = getUploadStatus();
      const finalResult = {
        ...(result || {}),
        upload_status: status,
        queue_result: queueResult,
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
      scanQueueRowsForLegacyFields,
      refresh: () => {
        render();
        syncGlobalDocumentDropBinding();
      },
      isWaitingForReply: () => !!(
        state.waitingReply
        || state.waitingSend
        || state.autoSendWaiting
      ),
      isWaitingReplyOnly: () => !!state.waitingReply,
      isWaitingSendActive,
      refreshToolboxTopStatus: (reason = '') => {
        const runRefresh = () => {
          ensureActiveUploadGroupIdValid('refreshToolboxTopStatus');
          renderToolboxTopStatus();
          syncUploadGroupAppState();

          if (reason && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[TOOLBOX_TOP_STATUS][refresh] reason=${reason} page_display_id=${getBridgePageDisplayIdText()} turn_count=${getConversationTurnCount()}`,
            );
          }
        };

        Promise.resolve(uploadModuleInitPromise)
          .then(runRefresh)
          .catch((err) => {
            console.error('[ChatGPT toolbox] refreshToolboxTopStatus after init failed', err);
            runRefresh();
          });
      },
      refreshToolboxTurnStatus: (reason = '', mode = 'light') => {
        const runRefresh = () => {
          ensureActiveUploadGroupIdValid('refreshToolboxTurnStatus');
          renderToolboxTopStatus();
          syncUploadGroupAppState();
          renderUploadButtonsOnly({ heavy: mode === 'heavy' });
        };

        Promise.resolve(uploadModuleInitPromise)
          .then(runRefresh)
          .catch((err) => {
            console.error('[ChatGPT toolbox] refreshToolboxTurnStatus after init failed', err);
            runRefresh();
          });
      },
      renderUploadButtonsOnly,
      exportGroupsAndQueueMeta,
      importGroupsAndQueueMeta,
      resumeAfterForeground: async (reason = '-') => {
        const tag = String(reason || '-').trim() || '-';
        clearStaleBusySendStateOnHomeReady(`foreground-resume:${tag}`);
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[UPLOAD][FOREGROUND_RESUME] reason=${tag}`);
        }
        if (typeof updateChatInputStateBadge === 'function') {
          updateChatInputStateBadge();
        }
        ensureActiveUploadGroupIdValid(`foreground-resume:${tag}`);
        renderToolboxTopStatus();
        syncUploadGroupAppState();
        if (state.running) {
          ToolboxShell.appendLog(
            `[UPLOAD][FOREGROUND_RESUME] upload_running=1 waitingReply=${state.waitingReply ? 1 : 0} waitingSend=${state.waitingSend ? 1 : 0}`,
          );
        }
      },
      startUploadFromBridge,
      startUploadFromCurrentQueue,
      triggerStartUpload,
      handleStartUploadClick,
      startUploadOnlyFlow,
      startSendMessageFlow,
      clearStaleBusySendStateOnHomeReady,
      cancelCurrentUploadSend,
      applyBridgeUploadFiles,
      getPendingUploadItems,
      getUploadCountStats,
      runCopyHotkeyContinueOnceForTaskQueue,
      stopUploadSendTask,
      stopUploadTask,
      clearUploadTransientFileRefs,
    };
  })();

  function stopUploadSendTask(source) {
    if (typeof UploadModule !== 'undefined' && typeof UploadModule.stopUploadSendTask === 'function') {
      UploadModule.stopUploadSendTask(source);
    }
  }

  function stopUploadTask(source) {
    if (typeof UploadModule !== 'undefined' && typeof UploadModule.stopUploadTask === 'function') {
      UploadModule.stopUploadTask(source);
    }
  }

  function clearUploadTransientFileRefs(source) {
    if (typeof UploadModule !== 'undefined' && typeof UploadModule.clearUploadTransientFileRefs === 'function') {
      UploadModule.clearUploadTransientFileRefs(source);
    }
  }
