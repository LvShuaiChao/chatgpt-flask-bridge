  /********************************************************************
   * 3. UploadModule：多文件上传模块
   ********************************************************************/

  const UploadModule = (() => {
    const DEFAULT_UPLOAD_GROUP_NAME = '默认组';
    const SEND_WAIT_TIMEOUT_MS = 60 * 1000;
    const COPY_CONTINUE_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
    const COPY_CONTINUE_STABLE_ROUNDS = 2;
    const COPY_CONTINUE_STABLE_INTERVAL_MS = 350;

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
      uploadSendFailureHint: '',
      uploadSendFailureHintAt: 0,
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
    let copyLastMessageHardResetTimer = 0;
    let copyContinueTaskRunning = false;
    let copyTaskStatus = 'idle';
    let copyContinueTaskStartedAt = 0;
    let copyHotkeyContinueTaskRunning = false;
    let copyHotkeyContinueTaskStartedAt = 0;
    let copyHotkeyContinueLoopRunning = false;
    let copyHotkeyContinueLoopStopRequested = false;
    let copyHotkeyContinueLoopCount = 0;
    let copyHotkeyContinueLoopStartedAt = 0;
    const DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL = 'CHATGPT_TOOLBOX_DONE';
    let uploadUiActionLastKey = '';
    let uploadUiActionLastAt = 0;
    let quickPromptActiveCategory = '全部';

    function getDefaultCopyHotkeyContinuePromptText() {
      if (typeof getDefaultContinuePromptText === 'function') {
        return getDefaultContinuePromptText();
      }
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
        '5. 只有在你非常确定最开始的任务已经完整完成，并且没有任何剩余内容需要输出时，才允许只回复下面这一行终止信号：',
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

    function formatContinuePromptPreview(text, maxLen = 160) {
      const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
      if (normalized.length <= maxLen) {
        return normalized;
      }
      return `${normalized.slice(0, maxLen)}...`;
    }

    function getCopyHotkeyContinueStopSignal() {
      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      const signal = String(
        cfg.copyHotkeyContinueStopSignal || DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL,
      ).trim();

      return signal || DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL;
    }

    function getCopyHotkeyContinuePromptText() {
      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      const signal = getCopyHotkeyContinueStopSignal();

      let text = String(cfg.copyHotkeyContinuePromptText || '').trim();

      if (!text) {
        text = getDefaultCopyHotkeyContinuePromptText();
      }

      if (!text.includes(signal)) {
        text = [
          text,
          '',
          '如果没有必要继续，请只回复下面这一行终止信号，不要输出任何多余文字：',
          '',
          signal,
        ].join('\n');
      }

      return text;
    }

    const ASSISTANT_DONE_SIGNAL_LITERALS = Object.freeze([
      'CHATGPT_TOOLBOX_DONE',
      '<<<CHATGPT_TOOLBOX_DONE>>>',
    ]);

    function getAssistantDoneSignalLiteralSet() {
      const literals = new Set(ASSISTANT_DONE_SIGNAL_LITERALS);
      const configured = String(getCopyHotkeyContinueStopSignal() || '').trim();
      if (configured) {
        literals.add(configured);
      }
      return literals;
    }

    function analyzeAssistantDoneSignalText(text) {
      const configuredStopSignal = getCopyHotkeyContinueStopSignal();
      const allowedSignals = getAssistantDoneSignalLiteralSet();
      const raw = String(text || '').replace(/\r\n/g, '\n').trim();
      const checked = cleanAssistantTextForDoneSignal(text).replace(/\r\n/g, '\n').trim();
      const lines = checked
        .split('\n')
        .map((line) => String(line || '').trim())
        .filter(Boolean);
      const lineCount = lines.length;

      if (!checked) {
        return {
          matched: false,
          lineCount: 0,
          configuredStopSignal,
          allowedSignals: Array.from(allowedSignals),
          reason: 'empty-text',
        };
      }

      if (lineCount !== 1) {
        return {
          matched: false,
          lineCount,
          configuredStopSignal,
          allowedSignals: Array.from(allowedSignals),
          reason: lineCount === 0 ? 'empty-lines' : 'multiple-non-empty-lines',
        };
      }

      const onlyLine = lines[0];
      if (allowedSignals.has(onlyLine)) {
        return {
          matched: true,
          lineCount,
          configuredStopSignal,
          allowedSignals: Array.from(allowedSignals),
          reason: 'strict-exact-single-line-match',
        };
      }

      return {
        matched: false,
        lineCount,
        configuredStopSignal,
        allowedSignals: Array.from(allowedSignals),
        reason: 'line-not-equal-to-stop-signal',
      };
    }

    function isAssistantDoneSignalText(text) {
      return analyzeAssistantDoneSignalText(text).matched;
    }

    function formatDoneSignalPreview(text) {
      const preview = String(text || '').replace(/\r\n/g, '\n').trim();
      if (preview.length <= 120) {
        return preview;
      }
      return `${preview.slice(0, 120)}...`;
    }

    function cleanAssistantTextForDoneSignal(text) {
      const raw = String(text || '').trim();
      if (
        typeof ChatMessageExtractor !== 'undefined'
        && ChatMessageExtractor
        && typeof ChatMessageExtractor.cleanMessageText === 'function'
      ) {
        return String(ChatMessageExtractor.cleanMessageText(raw) || '').trim();
      }
      return raw;
    }

    function logAssistantDoneSignalCheck(logPrefix, text, phase, extraFields) {
      const analysis = analyzeAssistantDoneSignalText(text);
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

    function hasAssistantDoneSignalInText(text, logPrefix, phase, extraFields) {
      const matched = isAssistantDoneSignalText(text);
      logAssistantDoneSignalCheck(logPrefix, text, phase, extraFields);
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

      const fallbackGroup = state.groups[0];
      const fallbackGroupId = fallbackGroup && fallbackGroup.id ? fallbackGroup.id : '';

      if (!fallbackGroupId) {
        console.warn('[ChatGPT toolbox] ensureActiveUploadGroupIdValid: no fallback group', {
          reason,
          previousActiveGroupId: activeGroupId || '',
        });
        return false;
      }

      console.warn('[ChatGPT toolbox] activeUploadGroupId invalid, fallback to first group', {
        reason,
        previousActiveGroupId: activeGroupId || '',
        fallbackGroupId,
      });

      state.activeGroupId = fallbackGroupId;
      appendUploadGroupLog('ACTIVE_FALLBACK', {
        reason: reason || '-',
        previousActiveGroupId: activeGroupId || '-',
        fallbackGroupId,
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

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][persist-row:no-blob] name=${q.name || '-'} handle=${hasHandle ? 1 : 0} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'}`
      );

      return row;
    }

    async function clearPersistedUploadBlobs(reason) {
      if (!APP || !APP.uploadStore) {
        console.warn('[ChatGPT toolbox] clearPersistedUploadBlobs: APP.uploadStore not available');
        return;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][clear-persisted-blob:start] reason=${reason || '-'}`
      );

      let changed = 0;

      try {
        const all = await APP.uploadStore.getAll();

        for (const record of all) {
          if (!record) continue;

          const hasBlob = record.blob !== null && record.blob !== undefined;

          if (hasBlob || record.blobSaved || record.blobSavedAt || record.debugSavedFrom) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][clear-persisted-blob:item] name=${record.name || '-'} id=${record.id || '-'} oldBlob=${hasBlob ? 1 : 0}`
            );

            record.blob = null;
            record.blobSaved = false;
            record.blobSavedAt = 0;
            record.debugSavedFrom = '';

            await APP.uploadStore.put(record);
            changed++;
          }
        }
      } catch (e) {
        console.error('[ChatGPT toolbox] clearPersistedUploadBlobs failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][clear-persisted-blob:error] reason=${reason || '-'} error=${e && e.message ? e.message : String(e)}`
        );
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][clear-persisted-blob:done] changed=${changed}`
      );
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

        ensureActiveUploadGroupIdValid('load-groups');
        syncUploadGroupAppState();
        appendUploadGroupLog('INIT', { stage: 'loadGroups:ok' });
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
        }

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
      const turnCount = getConversationTurnCount();
      logConversationTurnCountIfChanged(turnCount, 'renderToolboxPageStatusRow');
      const pageIdText = `页面ID:${pageDisplayId}`;
      const turnText = `轮次:${turnCount}`;

      pageStatusRowEl.innerHTML = `
        <span id="cgpt-page-input-state" class="cgpt-status-pill cgpt-toolbox-top-status-badge cgpt-state-unknown">未知</span>
        <span class="cgpt-toolbox-top-status-badge cgpt-toolbox-page-id-badge" title="${escapeHtml(pageIdText)}">${escapeHtml(pageIdText)}</span>
        <span class="cgpt-toolbox-top-status-badge cgpt-toolbox-turn-count-badge" title="${escapeHtml(turnText)}">${escapeHtml(turnText)}</span>
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

    function getQuickPromptActiveCategory() {
      return String(quickPromptActiveCategory || '鍏ㄩ儴').trim() || '鍏ㄩ儴';
    }

    function saveQuickPromptActiveCategory(category, options = {}) {
      const nextCategory = String(category || '鍏ㄩ儴').trim() || '鍏ㄩ儴';
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

      return ['鍏ㄩ儴', ...names];
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
          `ChatGPT 输入框已有 ${existingText.length} 个字符，是否覆盖为快捷 Prompt：${title}？`
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

      try {
        ToolboxShell.appendLog(
          `[COPY_LAST_REPLY][start] source=${String(source || '-')}`,
        );
        setStatus('正在等待最后回复稳定...', 'running');

        let text = '';
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
          text = String(waitResult.text || '').trim();
        } else if (typeof extractLatestAssistantMessageText === 'function') {
          text = String(extractLatestAssistantMessageText() || '').trim();
        } else if (typeof getLastAssistantText === 'function') {
          text = String(getLastAssistantText() || '').trim();
        }

        if (
          !text
          || (typeof isInvalidAssistantReplyText === 'function' && isInvalidAssistantReplyText(text))
        ) {
          ToolboxShell.appendLog(
            `[COPY_LAST_REPLY][abort] reason=${text ? 'invalid-assistant-text' : 'empty-text'}`,
          );
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

        copyLastReplyTaskStatus = 'copying';
        copyLastMessageTaskStatus = 'copying';
        copyLastMessageWaiting = false;
        renderUploadButtonsOnly();

        if (typeof copyTextToClipboard !== 'function') {
          ToolboxShell.appendLog('[COPY_LAST_REPLY][abort] reason=copyTextToClipboard-missing');
          setStatus('复制失败：剪贴板函数不可用', 'error');
          copyLastReplyTaskStatus = 'failed';
          copyLastMessageTaskStatus = 'failed';
          renderUploadButtonsOnly();
          if (btn && typeof setButtonTemporaryError === 'function') {
            setButtonTemporaryError(btn, '复制失败', 1200);
          }
          return false;
        }

        await copyTextToClipboard(text);
        copyLastReplyTaskStatus = 'success';
        copyLastMessageTaskStatus = 'success';
        renderUploadButtonsOnly();

        ToolboxShell.appendLog(
          `[COPY_LAST_REPLY][done] chars=${text.length}`,
        );
        setStatus('已复制最后回复', 'success');
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

    async function sendContinueMessageOnly(source = 'button') {
      const sourceText = String(source || '');
      const isLoopMode = sourceText.startsWith('loop-');

      safeAppendLog(`[UPLOAD_CONTINUE][SEND_START] source=${sourceText}`);
      console.warn('[UPLOAD_CONTINUE][SEND_START]', { source: sourceText });

      const assistantRawBeforeSend = getLastAssistantMessageTextForStopSignal();
      const doneBeforeSend = hasAssistantDoneSignalInText(
        assistantRawBeforeSend,
        'UPLOAD_CONTINUE',
        'before-send',
        `source=${sourceText}`,
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

      const continuePromptText = getCopyHotkeyContinuePromptText();
      const promptPreview = formatContinuePromptPreview(continuePromptText, 160);
      const previewLine = `[UPLOAD_CONTINUE][PROMPT_PREVIEW] chars=${continuePromptText.length} preview=${promptPreview}`;
      safeAppendLog(previewLine);
      console.warn('[UPLOAD_CONTINUE][PROMPT_PREVIEW]', {
        chars: continuePromptText.length,
        preview: promptPreview,
      });

      let result = await sendContinueMessageOnceOnly(sourceText);
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

    async function sendContinueMessageOnceOnly(source) {
      const sourceText = String(source || '');
      const text = getCopyHotkeyContinuePromptText();
      const stopSignal = getCopyHotkeyContinueStopSignal();

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
          && typeof ChatMessageExtractor.buildRecords === 'function'
          && typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser === 'function'
        ) {
          const records = ChatMessageExtractor.buildRecords({ includeEmpty: false });
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

        const sentResult = await sendContinueMessageOnly('copy-continue-after-wait');

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
          || typeof ChatMessageExtractor.buildRecords !== 'function'
          || typeof ChatMessageExtractor.getLatestAssistantAfterLatestUser !== 'function'
        ) {
          return '';
        }
        const records = ChatMessageExtractor.buildRecords({ includeEmpty: false });
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

    async function copyHotkeyAndContinueOnce(source = 'button') {
      const sourceText = String(source || '');
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
              reason: 'task-running',
              source: sourceText,
              loopMode: isLoopMode,
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
        const waitResult = await waitAssistantStableForCopyContinue(source);
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
            reason: reason || 'wait-assistant-failed',
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        if (!waitResult.text || !String(waitResult.text).trim()) {
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][abort] reason=empty-assistant-text');
          if (!isLoopMode) {
            setStatus('复制+快捷键+继续失败：最后回复为空', 'warn');
          }
          return {
            ok: false,
            reason: 'empty-assistant-text',
            source: sourceText,
            loopMode: isLoopMode,
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

        logCopyHotkeyContinueStep(sourceText, 'copy-last-reply');
        if (btn && !isLoopMode) {
          btn.textContent = '复制中...';
        }
        if (typeof copyTextToClipboard !== 'function') {
          if (!isLoopMode) {
            setStatus('复制失败：剪贴板 API 不可用', 'error');
          }
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][abort] reason=copyTextToClipboard-missing');
          return {
            ok: false,
            reason: 'copyTextToClipboard-missing',
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        try {
          await copyTextToClipboard(waitResult.text);
        } catch (copyError) {
          const errText = formatToolboxError(copyError);
          console.error('[COPY_HOTKEY_CONTINUE][COPY_FAILED]', {
            source: sourceText,
            loopMode: isLoopMode,
            error_type: copyError && copyError.name,
            error: errText,
            stack: copyError && copyError.stack,
          });
          ToolboxShell.appendLog(`[COPY_HOTKEY_CONTINUE][failed] reason=copy-failed detail=${errText}`);
          if (!isLoopMode) {
            setStatus(`复制+快捷键+继续失败：${errText}`, 'error');
          }
          return {
            ok: false,
            reason: 'copy-failed',
            detail: errText,
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE][copied] chars=${String(waitResult.text || '').length}`,
        );
        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(sourceText || '-', 'copyHotkeyContinue');
        }

        logCopyHotkeyContinueStep(sourceText, 'send-hotkey');
        if (btn && !isLoopMode) {
          btn.textContent = '发送快捷键...';
        }
        const hotkeyOk = await triggerSendHotkeyOnce();
        if (!hotkeyOk) {
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][failed] reason=hotkey-failed');
          if (!isLoopMode) {
            setStatus('复制成功，但 Ctrl+Alt+I 执行失败', 'error');
          }
          return {
            ok: false,
            reason: 'hotkey-failed',
            source: sourceText,
            loopMode: isLoopMode,
          };
        }
        await sleep(300);

        logCopyHotkeyContinueStep(sourceText, 'send-continue');
        if (btn && !isLoopMode) {
          btn.textContent = '发送继续指令...';
        }
        const continueSource = isLoopMode ? sourceText : 'copy-hotkey-continue-once';
        const loopContinuePromptTxt = getCopyHotkeyContinuePromptText();
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][continue-prompt] index=${copyHotkeyContinueLoopCount + 1} length=${loopContinuePromptTxt.length}`);
        const continueResult = await sendContinueMessageOnly(continueSource);
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
            reason: 'continue-send-failed',
            detail,
            source: sourceText,
            loopMode: isLoopMode,
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
          reason: 'exception',
          detail: errText,
          source: sourceText,
          loopMode: isLoopMode,
        };
      } finally {
        copyHotkeyContinueTaskRunning = false;
        copyHotkeyContinueTaskStartedAt = 0;

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
        const uploadResult = await handleStartUploadClick(`copy-hotkey-loop-auto-upload-${cycleIndex}`);

        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][auto-upload-done] index=${cycleIndex} success=${uploadResult && uploadResult.success != null ? uploadResult.success : '-'} failed=${uploadResult && uploadResult.failed != null ? uploadResult.failed : '-'} skipped=${uploadResult && uploadResult.skipped ? '1' : '0'} reason=${uploadResult && uploadResult.reason ? uploadResult.reason : '-'}`
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
        btn.textContent = '停止杩炵画';
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

    async function handleUploadDropEvent(e) {
      e.preventDefault();
      e.stopPropagation();

      const transfer = e.dataTransfer;

      if (!transfer) {
        setStatus('拖拽失败：没有文件数据');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer');
        return;
      }

      if (shouldSkipRecentDuplicateDrop(transfer)) {
        setStatus('已忽略重复拖拽事件');
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

      dedupeActiveGroupQueue('drop');

      const afterCount = state.queue.length;
      const addedCount = Math.max(0, afterCount - beforeCount);

      setStatus(`已拖入：${dropped.length} 个文件，新增：${addedCount} 个`);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:done] dropped=${dropped.length} added=${addedCount} before=${beforeCount} after=${afterCount}`
      );
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
      if (!claimUploadDropEvent(e, 'root')) return;

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
      if (!claimUploadDropEvent(e, 'global')) return;

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

    function buildUploadListHtml() {
      const files = getActiveGroupFiles();
      const selectedFileId = getSelectedFileIdForActiveGroup();
      const activeGroupId = getActiveGroupId();
      const flaskHtml = buildFlaskUploadListHtml();

      if (!files.length && !flaskHtml) {
        return `
          <div class="cgpt-upload-item empty">
            <div>
              <div class="cgpt-upload-meta">当前项目没有文件</div>
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
      refreshQueueReadableState();
      el.innerHTML = buildUploadListHtml();
    }

    function getUploadPageCapability() {
      let hasComposer = false;
      let canSendNow = false;
      let isResponding = false;
      let attachmentCount = 0;
      let response_state = 'not_ready';
      let response_state_reason = '';

      try {
        hasComposer = typeof ComposerApi.hasComposer === 'function' && ComposerApi.hasComposer();
        canSendNow = typeof ComposerApi.canSendNow === 'function' && ComposerApi.canSendNow();
        isResponding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
        attachmentCount = typeof ComposerApi.countAttachmentChips === 'function'
          ? ComposerApi.countAttachmentChips()
          : 0;

        if (typeof detectComposerResponseState === 'function') {
          const responseState = detectComposerResponseState();
          response_state = String(responseState.response_state || response_state);
          response_state_reason = String(responseState.response_state_reason || '');
          canSendNow = responseState.can_send_now === true;
          isResponding = responseState.is_responding === true;
          if (Number.isFinite(Number(responseState.attachment_count))) {
            attachmentCount = Number(responseState.attachment_count);
          }
        } else {
          response_state = isResponding ? 'generating' : (canSendNow ? 'ready' : 'not_ready');
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getUploadPageCapability failed', err);
        ToolboxShell.appendLog(`[UPLOAD][capability-check-failed] error=${errText}`);
      }

      const latestAssistant = getLatestAssistantMessageForCopy();

      return {
        hasComposer,
        canSendNow,
        can_send_now: canSendNow,
        isResponding,
        is_responding: isResponding,
        response_state,
        response_state_reason,
        attachmentCount,
        sendable: hasComposer && canSendNow && !isResponding,
        copyable: !!(latestAssistant && latestAssistant.ok),
      };
    }

    function renderUploadButtonsOnly() {
      healStaleUploadRunningLockIfNeeded('renderUploadButtonsOnly');
      healStaleSendUiStateIfNeeded('renderUploadButtonsOnly');

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
        const waitingReply = !!state.waitingReply;
        let sendTitle = '';

        if (waitingReply) {
          sendTitle = '再次点击可取消等待回复';
        } else if (waitingSend) {
          sendTitle = '正在发送，再次点击可取消';
        } else if (!capability.hasComposer) {
          sendTitle = '未找到 ChatGPT 输入框';
        } else if (capability.isResponding) {
          sendTitle = '助手正在回复，暂不可发送';
        } else if (!capability.canSendNow) {
          sendTitle = '当前页面暂不可发送';
        }

        const failureHint = state.uploadSendFailureHint
          && (Date.now() - Number(state.uploadSendFailureHintAt || 0) < 12000)
          ? String(state.uploadSendFailureHint)
          : '';

        let sendText = '发送信息';
        if (waitingReply) {
          sendText = '等待回复...';
        } else if (waitingSend) {
          sendText = '发送中...';
        } else if (failureHint) {
          sendText = failureHint.length > 22 ? `${failureHint.slice(0, 22)}…` : failureHint;
          sendTitle = failureHint;
        }

        setButtonState(startSendBtn, {
          text: sendText,
          title: sendTitle,
          disabled: !waitingSend && !waitingReply && !capability.hasComposer,
          ariaDisabled: !waitingSend && !waitingReply && !capability.hasComposer,
          removeClasses: ['primary', 'danger', 'cgpt-wait-send-cancel', 'warning'],
          addClasses: (waitingSend || waitingReply)
            ? ['danger', 'cgpt-wait-send-cancel']
            : (failureHint ? ['warning'] : ['primary']),
        });
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
            'cgpt-btn-error',
            'cgpt-btn-ok',
            'failed',
            'error',
          ],
          addClasses: waitingAnswer
            ? ['cgpt-waiting-answer', 'copy-continue', 'cgpt-btn-copy-continue']
            : ['copy-continue', 'cgpt-btn-copy-continue'],
        });
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

        setButtonState(copyLastMessageBtn, {
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
        });
      }

      const copyHotkeyContinueOnceBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef)
        : null;
      if (copyHotkeyContinueOnceBtn) {
        setButtonState(copyHotkeyContinueOnceBtn, {
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
        });
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
        cap = getUploadPageCapability();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] logUploadSendUiState capability failed', err);
        ToolboxShell.appendLog(`[UPLOAD_SEND_UI][STATE][capability-error] error=${errText}`);
      }

      ToolboxShell.appendLog(
        `[UPLOAD_SEND_UI][STATE] action=${String(action || '-')} reason=${String(reason || '-')} runId=${runId == null ? '-' : runId} autoSendRunId=${state.autoSendRunId || '-'} waitingSend=${state.waitingSend ? '1' : '0'} autoSendWaiting=${state.autoSendWaiting ? '1' : '0'} waitingReply=${state.waitingReply ? '1' : '0'} shortcutRunning=${uploadSendShortcutRunning ? '1' : '0'} isResponding=${cap.isResponding ? '1' : '0'} canSendNow=${cap.canSendNow ? '1' : '0'} responseState=${cap.response_state || '-'} attachmentCount=${Number(cap.attachmentCount || 0)}`
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

      if (baseReason === 'send_button_unavailable' || baseReason === 'send_button_wait_timeout') {
        return '发送失败：ChatGPT 发送按钮不可用';
      }

      if (baseReason === 'composer_empty') {
        return '发送失败：输入框无文本且无附件';
      }

      if (baseReason === 'assistant_busy') {
        return '发送失败：助手正在回复';
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
            `[UPLOAD_SEND_UI][abort-error] reason=${String(reason || '-')} error=${errText}`,
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

      state.waitingSend = false;
      state.autoSendWaiting = false;
      state.cancelWaitingSend = false;
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      state.waitingReply = false;
      state.waitingReplyRunId = null;
      state.waitingReplyTimer = null;

      if (!String(reason || '').startsWith('send-message-not-sent:')) {
        state.uploadSendFailureHint = '';
        state.uploadSendFailureHintAt = 0;
      }

      logUploadSendUiState('reset', reason, runId);
    }

    function healStaleSendUiStateIfNeeded(context) {
      if (!isWaitingSendActive()) return false;
      if (state.waitingReply) return false;
      if (uploadSendTaskStartedAt <= 0) return false;
      const elapsed = Date.now() - uploadSendTaskStartedAt;
      if (elapsed < 8000) return false;

      try {
        const cap = getUploadPageCapability();
        const pageIdle = !cap.isResponding && cap.response_state !== 'generating';
        const noStopButton = !hasRealStopButtonForCopy();

        if (pageIdle && noStopButton) {
          ToolboxShell.appendLog(
            `[UPLOAD_SEND_UI][HEAL_STALE] reason=${String(context || '-scheduled')} runningMs=${elapsed} isResponding=${cap.isResponding ? '1' : '0'} responseState=${cap.response_state || '-'} stopButton=${noStopButton ? '0' : '1'}`
          );
          resetUploadSendUiState('stale-send-ui:' + (context || '-scheduled'), state.autoSendRunId);
          scheduleRenderUpload('heal-stale-send-ui');
          return true;
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] healStaleSendUiStateIfNeeded error', err);
        ToolboxShell.appendLog(`[UPLOAD_SEND_UI][HEAL_STALE_ERROR] error=${errText}`);
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
      if (!isWaitingSendActive() && !state.waitingReply) {
        return false;
      }

      const cancelRunId = state.autoSendRunId;
      state.cancelWaitingSend = true;
      state.autoSendRunId += 1;
      resetUploadSendUiState('cancel:' + reason, cancelRunId);
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
      logUploadSendUiState('claim', `wait-send:claim:${source || '-'}`, id);

      return id;
    }

    async function sendCurrentMessageFromUploadPanel(triggerSource, presetRunId) {
      const source = triggerSource || 'button';
      const usePresetRunId = presetRunId != null && Number(presetRunId) > 0;

      if (!usePresetRunId && !isWaitingSendActive()) {
        const capability = getUploadPageCapability();
        if (!capability.canSendNow) {
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

      logUploadSendUiState('click', 'send-message-start', runId);

      let sendFailureHandled = false;

      try {
        setStatus('正在等待发送按钮...');

        const sendResult = await sendContentViaComposer({
          source,
          sendExistingComposer: true,
          waitUntilSendable: true,
          timeoutMs: SEND_WAIT_TIMEOUT_MS,
          blockWhenResponding: false,
        });

        if (state.autoSendRunId !== runId) {
          logUploadSendUiState('send-aborted', 'runId-changed', runId);
          return false;
        }

        if (sendResult.ok) {
          state.waitingSend = false;
          state.autoSendWaiting = false;
          uploadSendShortcutRunning = false;
          uploadSendTaskStartedAt = 0;
          state.cancelWaitingSend = false;
          state.uploadSendFailureHint = '';
          state.uploadSendFailureHintAt = 0;

          state.waitingReply = true;
          setStatus('已发送信息');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:sent] runId=${runId} reason=${sendResult.reason || '-'}`,
          );
          logUploadSendUiState('sent', 'waiting-reply', runId);
          updateChatInputStateBadge();
          startWaitingReplyCheck(runId, Date.now());
          scheduleRenderUpload('send-message:sent-waiting-reply');
          return true;
        }

        const failReason = String(sendResult.reason || 'unknown');
        const composerTextAfterFail = typeof ComposerApi.getComposerText === 'function'
          ? String(ComposerApi.getComposerText() || '')
          : '';
        const attachmentCountAfterFail = typeof ComposerApi.countAttachmentChips === 'function'
          ? ComposerApi.countAttachmentChips()
          : 0;
        const failMessage = mapUploadSendFailureMessage(failReason);

        console.error(
          '[ChatGPT toolbox] send message not sent',
          failReason,
          `textLen=${composerTextAfterFail.length}`,
          `attachmentCount=${attachmentCountAfterFail}`,
        );
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:not-sent] reason=${failReason} textLen=${composerTextAfterFail.length} attachmentCount=${attachmentCountAfterFail} runId=${runId} autoSendRunId=${state.autoSendRunId}`,
        );

        state.waitingSend = false;
        state.autoSendWaiting = false;
        uploadSendShortcutRunning = false;
        uploadSendTaskStartedAt = 0;
        resetUploadSendUiState(`send-message-not-sent:${failReason}`, runId);

        if (state.autoSendRunId === runId) {
          setStatus(failMessage, 'warn');
          state.uploadSendFailureHint = failMessage;
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
        resetUploadSendUiState(`send-message-not-sent:exception:${errText}`, runId);
        if (state.autoSendRunId === runId) {
          setStatus(failMessage, 'warn');
          state.uploadSendFailureHint = failMessage;
          state.uploadSendFailureHintAt = Date.now();
        }
        scheduleRenderUpload('send-message:exception-reset');
        sendFailureHandled = true;
        return false;
      } finally {
        if (!state.waitingReply) {
          state.waitingSend = false;
          state.autoSendWaiting = false;
          uploadSendShortcutRunning = false;
          uploadSendTaskStartedAt = 0;
        }

        if (!state.waitingReply && !sendFailureHandled) {
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
      if (shouldIgnoreToolboxShortcutTarget(e.target)) {
        logUploadShortcutDebug(e, 'send-ignore', 'target-in-toolbox-editable');
        return false;
      }
      if (shouldSkipGlobalShortcutForToolboxTarget(e.target)) {
        logUploadShortcutDebug(e, 'send-ignore', 'target-in-toolbox-non-editable');
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

        if (shouldSkipGlobalShortcutForToolboxTarget(e.target)) {
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

    function markPendingItemsUploaded(pendingItems) {
      const flaskIds = [];

      for (const item of pendingItems || []) {
        if (!item) continue;

        if (item.source === 'flask_local_direct' || item.file_id) {
          item.status = 'uploaded';
          if (item.file_id) {
            flaskIds.push(item.file_id);
          }
          continue;
        }

        if (item.id) {
          updateItem(item.id, {
            state: UploadState.ATTACHED,
            message: '已绑定到输入框',
          });
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

    async function handleStartUploadClick(source = 'button') {
      const uploadSource = String(source || 'button').trim() || 'button';

      if (state.running) {
        setStatus('正在上传中，请稍候', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][START][SKIP] source=${uploadSource} reason=already-running`,
        );
        return buildUploadSkipResult('already-running');
      }

      // 重置已绑定的文件，允许再次上传
      resetQueueItemsForUpload({ forceResetAttached: true });

      resetFlaskFilesForUpload(`handleStartUploadClick:${uploadSource}`);

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
          `[UPLOAD][NO_PENDING_FILES] queue=${(state.queue || []).length} flask=${(state.flaskFiles || []).length}`,
        );
        return buildUploadSkipResult('no-pending-files', {
          total: 0,
          failed: 0,
        });
      }

      state.running = true;
      scheduleRenderUpload('handleStartUploadClick:start');

      try {
        setStatus('正在上传…', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][START][UNIFIED] source=${uploadSource} pending=${pendingItems.length}`,
        );

        const files = [];
        for (const item of pendingItems) {
          const file = await resolveUploadFileObject(item);
          files.push(file);
        }

        await uploadFilesToChatGPT(files);
        markPendingItemsUploaded(pendingItems);

        scheduleRenderUpload('handleStartUploadClick:done');
        persistQueueThrottled('handleStartUploadClick:done');

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

        return buildUploadResult(files.length, 0, false, files.length, {
          skipped: false,
          reason: 'unified-file-input',
        });
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const errStack = error && error.stack ? error.stack : errText;

        console.error('[UPLOAD][FAILED]', {
          error_type: errName,
          error: errText,
          stack: errStack,
        });
        ToolboxShell.showToast(`上传失败：${errText}`, 'error', 3200);
        setStatus(`上传失败：${errText}`, 'error');

        return buildUploadResult(0, pendingItems.length, false, pendingItems.length, {
          skipped: false,
          reason: errText,
        });
      } finally {
        state.running = false;
        scheduleRenderUpload('handleStartUploadClick:finally');
      }
    }

    async function triggerStartUpload(source = 'button') {
      return await handleStartUploadClick(source);
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
      copyLastMessageTaskStatus = '';
      copyLastReplyTaskRunning = false;
      copyLastReplyTaskStartedAt = 0;
      copyLastReplyTaskStatus = '';
      copyLastMessageWaiting = false;

      const copyLastMessageBtn = rootElRef
        ? qs('#cgpt-copy-last-message-scroll-bottom', rootElRef)
        : null;

      if (copyLastMessageBtn) {
        setButtonState(copyLastMessageBtn, {
          text: '复制最后回复',
          title: '等待最后一条 assistant 回复稳定后复制到剪贴板',
          disabled: false,
          removeClasses: [
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'teal',
            'purple',
            'cyan',
            'waiting',
            'cgpt-waiting-answer',
            'cgpt-btn-error',
            'cgpt-btn-ok',
            'failed',
            'error',
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
            setButtonTemporaryOk(copyLastMessageBtn);
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
            setButtonTemporaryOk(copyLastMessageBtn);
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
        setButtonTemporaryError(copyLastMessageBtn, '复制失败', 1200);

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
      return copyLastReplyWithState(triggerSource || 'button');
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
          copyLastReplyWithState('shortcut'),
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

      if (action === 'send-message' && (isWaitingSendActive() || state.waitingReply)) {
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
        runUploadActionPromise(
          copyLastReplyWithState(src),
          '复制最后回复',
        );
        return true;
      }

      if (action === 'send-message') {
        const capability = getUploadPageCapability();
        if (!capability.canSendNow) {
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
            copyLastReplyWithState('delegated-click'),
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

        const copyHotkeyContinueOnceBtn = target.closest('#cgpt-copy-hotkey-continue-once');
        if (copyHotkeyContinueOnceBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof copyHotkeyContinueOnceBtn.blur === 'function') {
            copyHotkeyContinueOnceBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-hotkey-continue-once');
          runUploadActionPromise(
            copyHotkeyAndContinueOnce('delegated-click'),
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
            toggleCopyHotkeyContinueLoop('delegated-click'),
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
        if (isWaitingSendActive() || state.waitingReply) {
          cancelWaitingSend('direct-button-click');
          return;
        }
        runUploadUiAction('send-message', sendBtn, 'direct-click', e);
      }, true);
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

            const category = categoryBtn.getAttribute('data-upload-quick-prompt-category') || '鍏ㄩ儴';
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
      bindUploadCompactActionButtons(rootEl);
      applyUploadShortcutButtonTitles(rootEl);
    }

    function ensureUploadGroupSection(rootEl) {
      if (!rootEl) {
        return;
      }

      let groupsHead = rootEl.querySelector('.cgpt-upload-groups-head');
      let groupList = rootEl.querySelector('#cgpt-upload-group-list');

      if (groupsHead && groupList) {
        groupsHead.id = 'cgpt-toolbox-project-stats-row';
        return;
      }

      const actionRow = rootEl.querySelector('.cgpt-upload-action-row');

      groupsHead = document.createElement('div');
      groupsHead.className = 'cgpt-upload-groups-head';
      groupsHead.id = 'cgpt-toolbox-project-stats-row';
      groupsHead.innerHTML = `
        <div class="cgpt-upload-group-bar">
          <div class="cgpt-upload-group-list" id="cgpt-upload-group-list"></div>
          <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">绠＄悊</button>
        </div>
      `;

      if (actionRow && actionRow.parentNode) {
        actionRow.parentNode.insertBefore(groupsHead, actionRow);
      } else {
        rootEl.insertBefore(groupsHead, rootEl.firstChild);
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

      let sendHotkeyBtn = qs(UploadSelectors.sendHotkeyBtn, actionRow);
      if (!sendHotkeyBtn) {
        sendHotkeyBtn = document.createElement('button');
        sendHotkeyBtn.type = 'button';
        sendHotkeyBtn.className = 'cgpt-btn warning';
        sendHotkeyBtn.id = 'cgpt-send-hotkey-once';
        sendHotkeyBtn.textContent = '发送 Ctrl+Alt+I';
        actionRow.insertBefore(sendHotkeyBtn, copyLastBtn);
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
      actionRow.insertBefore(sendHotkeyBtn, autoContinueBtn);

      let copyHotkeyContinueOnceBtn = qs(UploadSelectors.copyHotkeyContinueOnceBtn, actionRow);
      if (!copyHotkeyContinueOnceBtn) {
        copyHotkeyContinueOnceBtn = document.createElement('button');
        copyHotkeyContinueOnceBtn.type = 'button';
        copyHotkeyContinueOnceBtn.className = 'cgpt-btn purple';
        copyHotkeyContinueOnceBtn.id = 'cgpt-copy-hotkey-continue-once';
        copyHotkeyContinueOnceBtn.textContent = '复制+快捷键+继续';
        copyLastBtn.insertAdjacentElement('afterend', copyHotkeyContinueOnceBtn);
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

      if (copyHotkeyContinueOnceBtn.compareDocumentPosition(copyLastBtn) & Node.DOCUMENT_POSITION_FOLLOWING) {
        copyLastBtn.insertAdjacentElement('afterend', copyHotkeyContinueOnceBtn);
      }
      if (copyHotkeyContinueLoopBtn.compareDocumentPosition(copyHotkeyContinueOnceBtn) & Node.DOCUMENT_POSITION_FOLLOWING) {
        copyHotkeyContinueOnceBtn.insertAdjacentElement('afterend', copyHotkeyContinueLoopBtn);
      }
    }

    function bindUploadCompactActionButtons(rootEl) {
      DomUtil.bindClick(rootEl, UploadSelectors.sendHotkeyBtn, async () => {
        try {
          await triggerSendHotkeyOnce();
        } catch (error) {
          console.error('[SEND_HOTKEY][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`发送 Ctrl+Alt+I 失败：${error && error.message ? error.message : error}`, 'error');
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.autoContinueBtn, async () => {
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
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.copyHotkeyContinueOnceBtn, async () => {
        try {
          await copyHotkeyAndContinueOnce('bindClick');
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
          await toggleCopyHotkeyContinueLoop('bindClick');
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
          type: 'order',
          before: '#cgpt-upload-group-list',
          after: '#cgpt-upload-start',
          message: '项目分组栏应位于开始上传按钮之前',
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
          after: '#cgpt-send-hotkey-once',
          message: '发送 Ctrl+Alt+I按钮应位于复制并继续按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-send-hotkey-once',
          after: '#cgpt-auto-continue-once',
          message: '自动继续按钮应位于发送 Ctrl+Alt+I按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-auto-continue-once',
          after: '#cgpt-copy-last-message-scroll-bottom',
          message: '复制最后回复按钮应位于自动继续按钮之后',
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
          after: '#cgpt-copy-hotkey-continue-once',
          message: '复制+快捷键+继续按钮应位于复制最后回复按钮之后',
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
        const preferred = resolvePreferredUploadGroupId(pageState, reason);
        targetGroupId = preferred.groupId;
        source = preferred.source;

        const pageGroupId = resolvePageUploadGroupId(pageState);

        if (pageGroupId && !preferred.groupId) {
          ToolboxShell.appendLog(
            `[UPLOAD_PAGE_STATE][restore-group-missing] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${pageGroupId}`,
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
          `[UPLOAD_PAGE_STATE][restore-group-skip] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} noTarget=1`,
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
          `[UPLOAD_PAGE_STATE][restore-group] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${targetGroupId || '-'} source=${source}`,
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
        saveQuickPromptActiveCategory('鍏ㄩ儴', {
          savePageState: false,
          reason: 'restore-page-state-default',
        });
        renderUploadQuickPrompts();
      }
    }

    function restoreUploadDomRefs(rootEl) {
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
        <div class="cgpt-section">
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
          <div class="cgpt-row cgpt-upload-action-row">
            <button type="button" class="cgpt-btn success" id="cgpt-upload-start">开始上传</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send">发送信息</button>
            <button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" title="先复制最后回复，再发送“继续”">复制并继续</button>
            <button type="button" class="cgpt-btn warning" id="cgpt-send-hotkey-once">发送 Ctrl+Alt+I</button>
            <button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-once">自动继续</button>
            <button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom">复制最后回复</button>
            <button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">复制+快捷键+继续</button>
            <button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" title="等待回答完成 -> 检查终止信号 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续指令">连续复制+快捷键+继续</button>
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

    function startWaitingReplyCheck(runId, sendStartedAt) {
      stopWaitingReplyCheck();
      waitingReplyIdleStreak = 0;
      state.waitingReplyRunId = runId;
      state.waitingReplyCheckedAt = Date.now();
      logUploadSendUiState('waiting-reply-start', `runId=${runId}`, runId);
      state.waitingReplyTimer = setInterval(function () {
        if (!state.waitingReply) {
          stopWaitingReplyCheck();
          return;
        }
        var elapsed = Date.now() - state.waitingReplyCheckedAt;
        if (elapsed > 120000) {
          logUploadSendUiState('timeout', 'waiting-reply', runId);
          finishWaitingReply('timeout');
          return;
        }
        try {
          var capability = getPageCapability('waiting-reply');
          if (!capability.is_responding && capability.response_state !== 'generating') {
            waitingReplyIdleStreak += 1;
            if (waitingReplyIdleStreak >= 2) {
              logUploadSendUiState('reply_done', `idleStreak=${waitingReplyIdleStreak}`, runId);
              finishWaitingReply('reply_done');
            }
          } else {
            waitingReplyIdleStreak = 0;
          }
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] waiting reply check error', err);
          ToolboxShell.appendLog(`[UPLOAD_SEND_UI][waiting-reply-check-error] error=${errText}`);
        }
      }, 1500);
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

    async function startUploadFromBridge(payload = {}) {
      const source = String(payload.source || 'bridge_command').trim() || 'bridge_command';
      const result = await handleStartUploadClick(source);
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
      isWaitingForReply: () => !!(
        state.waitingReply
        || state.waitingSend
        || state.autoSendWaiting
      ),
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
      exportGroupsAndQueueMeta,
      importGroupsAndQueueMeta,
      startUploadFromBridge,
      triggerStartUpload,
      handleStartUploadClick,
      applyBridgeUploadFiles,
      getPendingUploadItems,
      getUploadCountStats,
    };
  })();
