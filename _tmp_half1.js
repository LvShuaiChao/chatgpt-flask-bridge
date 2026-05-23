  /********************************************************************
   * 3. UploadModule锛氬鏂囦欢涓婁紶妯″潡
   ********************************************************************/

  const UploadModule = (() => {
    const DEFAULT_UPLOAD_GROUP_NAME = '???';
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
    const DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL = '__CHATGPT_TOOLBOX_DONE__';
    let uploadUiActionLastKey = '';
    let uploadUiActionLastAt = 0;
    let quickPromptActiveCategory = '鍏ㄩ儴';

    function getDefaultCopyHotkeyContinuePromptText() {
      return [
        '请继续完成上一个任务。',
        '',
        '如果上一个任务已经完整完成、没有必要继续、没有剩余内容需要补充，请只回复下面这一行终止信号：',
        '',
        DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL,
        '',
        '除此之外不要输出任何多余文字。',
        '',
        '如果还需要继续，请直接继续输出后续内容，不要解释。',
      ].join('\n');
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

    function isCopyHotkeyContinueStopSignalText(text) {
      const raw = String(text || '').trim();
      if (!raw) {
        return false;
      }

      const signal = getCopyHotkeyContinueStopSignal();
      if (!signal) {
        return false;
      }

      if (raw === signal) {
        return true;
      }

      const lines = raw
        .split(/\r?\n/)
        .map((line) => String(line || '').trim())
        .filter(Boolean);

      return lines.length === 1 && lines[0] === signal;
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
        btn.textContent = String(options.idleText || '?????');
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
        options.text || (assistantBusy ? '绛夊緟鍥炲...' : '缁х画涓?..'),
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
      return false;
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

      return text.includes('鏈湴鏂囦欢璇诲彇澶辫触') ||
        text.includes('缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆') ||
        text.includes('娌℃湁鏈湴鏂囦欢璇诲彇鏉冮檺') ||
        text.includes('鏈湴鏂囦欢涓虹┖鎴栬鍙栧け璐?');
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

    // 娉ㄦ剰锛歞isplayPath 鍙槸灞曠ず淇℃伅锛屼笉鑳戒綔涓烘湰鍦拌鍙栦緷鎹?
    // 娴忚鍣ㄩ€氬父涓嶄細鏆撮湶鐪熷疄缁濆璺緞
    // 鏄惁鑳介噸鏂拌鍙栨湰鍦版枃浠讹紝鍙兘fileHandle 鏄惁瀛樺湪涓斿彲 getFile

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

      lines.push(`鏂囦欢鍚嶏細${q.name || '-'}`);
      lines.push(`澶у皬锛?{formatBytes(q.size)}`);

      if (q.lastModified) {
        const d = new Date(Number(q.lastModified));
        if (!Number.isNaN(d.getTime())) {
          lines.push(`淇敼鏃堕棿锛?{d.toLocaleString()}`);
        }
      }

      lines.push(`鏉ユ簮锛?{getUploadInlineStatusText(q)}`);

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
        lines.push('璇存槑锛氱己灏戝彲璇绘枃浠讹紝璇风偣鍑烩€滈噸鏂扮粦瀹氣€濇垨閲嶆柊鎷栧叆');
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
            ? '缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆'
            : (q.sourceKind === 'missing-local'
              ? '缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆'
              : (q.sourceKind === 'session-file'
                ? '缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆'
                : '缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆'));

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
            `[UPLOAD_DIAG][refreshQueue:attached-reset-after-reload] ${q.name} 椤甸潰闄勪欢鍖烘湭妫€娴嬪埌锛屽凡鏀逛负寰呬笂浼燻`
          );
          q.state = UploadState.IDLE;
          q.uploadName = '';
          if (!q.message) {
            q.message = q.persistedAttached
              ? '涓婃宸蹭笂浼狅紝鍒锋柊鍚庤鐐瑰嚮涓婁紶'
              : '椤甸潰闄勪欢鍖烘湭妫€娴嬪埌锛岃鍐嶆鐐瑰嚮涓婁紶';
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

    function openDb() {    function openDb() {    function openDb() {
      if (dbPromise) return dbPromise;

      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error('褰撳墠娴忚鍣ㄤ笉鏀寔 IndexedDB'));
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
            ToolboxShell.appendLog('[UPLOAD_DB][open:blocked] IndexedDB 琚叾浠栭〉闈㈡垨鏃ц繛鎺ラ樆濉?');
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

        ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}] IndexedDB鍥炶 ${summary.length} 鏉★細${summary.map((x) => `${x.name}:blob=${x.hasBlob ? 1 : 0},handle=${x.hasHandle ? 1 : 0},state=${x.state}`).join('|')}`);

        console.debug('[ChatGPT toolbox] persisted queue readback', {
          stage,
          activeGroupId: state.activeGroupId,
          summary,
        });
      } catch (e) {
        console.error('[ChatGPT toolbox] debugReadBackPersistedQueue failed', stage, e);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][${stage}] IndexedDB鍥炶澶辫触${e && e.message ? e.message : String(e)}`);
      }
    }

    async function persistQueue() {
      const groupIdSnapshot = String(state.activeGroupId || '').trim();
      if (!groupIdSnapshot) {
        console.warn('[ChatGPT toolbox] persistQueue: activeGroupId 涓虹┖');
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

          setStatus(`涓婁紶闃熷垪淇濆瓨澶辫触鎴栬秴鏃讹細${errText}`, 'error');

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
        setStatus(`涓婁紶鍒嗙粍鏁伴噺鍒锋柊澶辫触锛?{errText}`, 'error');
        return false;
      }
    }

    function renderUploadGroupChipHtml(group, activeGroupId) {
      const active = group.id === activeGroupId ? ' active' : '';
      const count = getUploadGroupFileCount(group.id);
      const cleanName = stripTrailingCountFromGroupName(group.name);
      const title = `${cleanName}锛?{count} 涓枃浠禶`;

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
        setStatus(`涓婁紶鍒嗙粍淇濆瓨澶辫触锛?{errText}`, 'error');
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
          '璇诲彇鏂囦欢缁勫け璐ワ紝褰撳墠涓轰复鏃堕粯璁ゅ垎缁勶紝璇峰嬁绔嬪嵆瀵煎叆/鍒犻櫎鍒嗙粍锛涜鍒锋柊鎴栨鏌?IndexedDB',
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

        setStatus(`涓婁紶闃熷垪鍏煎杩佺Щ澶辫触锛?{errText}`, 'error');

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
          item.message = '涓婃宸蹭笂浼狅紝鍒锋柊鍚庤鐐瑰嚮涓婁紶';
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
      item.message = '缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆';
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
        console.warn('[ChatGPT toolbox] loadQueueForActiveGroup: activeGroupId 涓虹┖');
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
        setStatus(`涓婁紶闃熷垪鎭㈠澶辫触锛?{e && e.message ? e.message : String(e)}`);
      }
    }

    function isHardFileReadFailure(reason) {
      const text = String(reason || '');

      return text.includes('缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆') ||
        text.includes('娌℃湁鏈湴鏂囦欢璇诲彇鏉冮檺') ||
        text.includes('鏈湴鏂囦欢璇诲彇澶辫触') ||
        text.includes('鏈湴鏂囦欢涓虹┖鎴栬鍙栧け璐?') ||
        text.includes('缂哄皯鍙鍙栫殑鏂囦欢瀵硅薄') ||
        text.includes('璇烽噸鏂版嫋鍏?') ||
        text.includes('娌℃湁鍙笂浼犵殑 File 瀵硅薄');
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

          ToolboxShell.appendLog(`澶辫触鏉＄洰宸插鏍镐负鎴愬姛锛?{q.name}`);
        }
      }
    }

    function getActiveGroup() {
      return state.groups.find((g) => g.id === state.activeGroupId) || null;
    }

    function getActiveGroupName() {
      const g = getActiveGroup();
      return g ? g.name : '鏈懡鍚嶇粍';
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
        setStatus('姝ｅ湪涓婁紶涓紝涓嶈兘鍒囨崲鍒嗙粍');
        return;
      }

      const exists = state.groups.some((g) => g.id === groupId);
      if (!exists) {
        console.warn('[ChatGPT toolbox] switchGroup: 鍒嗙粍涓嶅瓨鍦?', groupId);
        ToolboxShell.appendLog(`[UPLOAD_GROUP][switch:missing] groupId=${groupId || '-'}`);
        setStatus('鍒囨崲澶辫触锛氬垎缁勪笉瀛樺湪', 'error');
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
        setStatus(`宸插垏鎹㈠埌 ${getActiveGroupName()}`, 'success');

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

        setStatus(`鍒囨崲鍒嗙粍澶辫触锛屽凡鎭㈠鍘熷垎缁勶細${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][switch:failed-rollback] from=${prevActiveGroupId || '-'} to=${groupId || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    function buildRandomGroupName() {
      const tag = buildUploadTimestamp().slice(0, 20);
      const baseName = `椤圭洰_${tag}`;

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
        setStatus('姝ｅ湪涓婁紶涓紝涓嶈兘鏂板缓鍒嗙粍');
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

        setStatus(`宸叉柊寤哄垎缁勶細${group.name}`, 'success');
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

        setStatus(`鏂板缓鍒嗙粍澶辫触锛屽凡鎭㈠鍘熺姸鎬侊細${errText}`, 'error');

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
          '鏆傛棤鍒嗙粍',
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
            title="${escapeHtml(`${cleanName} 路 ${count} 涓枃浠禶`)}">
            <span class="cgpt-upload-manage-group-name">${escapeHtml(cleanName)}</span>
            <span class="cgpt-upload-manage-group-count">${count} 涓?/span>
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
        clearBtn.textContent = '娓呯┖褰撳墠缁?';
      }

      const deleteBtn = qs('#cgpt-upload-group-delete-inline', host || document);
      if (deleteBtn) {
        deleteBtn.textContent = '鍒犻櫎褰撳墠缁?';
      }

      clearConfirmUntil = 0;
      deleteConfirmUntil = 0;
    }

    async function renameActiveGroupInline() {
      const group = getActiveGroup();

      if (!group) {
        setStatus('褰撳墠娌℃湁鍙噸鍛藉悕鐨勫垎缁?');
        return false;
      }

      const text = String(groupNameInputEl ? groupNameInputEl.value : '').trim();

      if (!text) {
        setStatus('璇疯緭鍏ュ垎缁勫悕绉?');
        console.warn('[ChatGPT toolbox] renameActiveGroupInline: 鍒嗙粍鍚嶇О涓虹┖');
        return false;
      }

      if (text === group.name) {
        setStatus(`鍒嗙粍鍚嶇О鏈彉鍖栵細${group.name}`);
        return true;
      }

      if (state.groups.some((g) => g.id !== group.id && g.name === text)) {
        setStatus('鍒嗙粍鍚嶇О宸插瓨鍦?');
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

        setStatus(`宸蹭繚瀛樺垎缁勫悕绉帮細${group.name}`, 'success');

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

        setStatus(`淇濆瓨鍒嗙粍鍚嶇О澶辫触锛屽凡鎭㈠鍘熷悕绉帮細${errText}`, 'error');

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
        ToolboxShell.appendLog('[UPLOAD_GROUP][delete-queue:skip] groupId涓虹┖');
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
        setStatus('褰撳墠娌℃湁鍙竻绌虹殑鍒嗙粍');
        return;
      }

      const now = Date.now();

      if (now > clearConfirmUntil) {
        clearConfirmUntil = now + 3000;

        if (button) {
          button.textContent = '鍐嶆鐐瑰嚮娓呯┖';
        }

        setStatus('鍐嶆鐐瑰嚮纭娓呯┖褰撳墠缁勬枃浠?');
        return;
      }

      clearConfirmUntil = 0;

      const prevQueue = state.queue.slice();

      try {
        state.queue = [];

        await schedulePersistQueue();

        render();
        syncGroupManagePanel();

        setStatus(`宸叉竻绌哄垎缁勶細${group.name}`, 'success');
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

        setStatus(`娓呯┖鍒嗙粍澶辫触锛屽凡鎭㈠鍘熼槦鍒楋細${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][clear-inline:failed-rollback] groupId=${group.id || '-'} name=${group.name || '-'} type=${errName} error=${errText}`,
        );

        throw e;
      }
    }

    async function deleteActiveGroupInline(button) {
      const group = getActiveGroup();

      if (!group) {
        setStatus('褰撳墠娌℃湁鍙垹闄ょ殑鍒嗙粍');
        return;
      }

      if (state.groups.length <= 1) {
        setStatus('鑷冲皯淇濈暀涓€涓垎缁?');
        return;
      }

      const now = Date.now();

      if (now > deleteConfirmUntil) {
        deleteConfirmUntil = now + 3000;

        if (button) {
          button.textContent = '鍐嶆鐐瑰嚮鍒犻櫎';
        }

        setStatus('鍐嶆鐐瑰嚮纭鍒犻櫎褰撳墠缁?');
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
        setStatus('鍒犻櫎澶辫触锛氭病鏈夊彲鍒囨崲鐨勭洰鏍囧垎缁?', 'error');
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

          setStatus(`鍒嗙粍宸插垹闄わ紝浣嗘棫闃熷垪娓呯悊澶辫触锛?{cleanupText}`, 'error');
        }

        await refreshUploadGroupCounts();

        render();
        syncGroupManagePanel({
          force: true,
        });

        setStatus(`宸插垹闄ゅ垎缁勶細${group.name}`, 'success');

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

        setStatus(`鍒犻櫎鍒嗙粍澶辫触锛屽凡鎭㈠鍘熺姸鎬侊細${errText}`, 'error');

        throw e;
      }
    }

    async function removeFileFromCurrentGroup(id) {
      if (state.running) {
        setStatus('姝ｅ湪涓婁紶涓紝涓嶈兘鍒犻櫎鏂囦欢');
        return;
      }

      const q = getActiveGroupFiles().find((item) => item.id === id);

      if (!q) {
        setStatus('鏈壘鍒拌鍒犻櫎鐨勬枃浠?');
        console.warn('[ChatGPT toolbox] removeFileFromCurrentGroup: 鏂囦欢涓嶅瓨鍦?', id);
        return;
      }

      const prevQueue = state.queue.slice();

      try {
        state.queue = state.queue.filter((item) => item.id !== id);
        syncActiveGroupSelectionAfterQueueLoad(getActiveGroupId());

        await schedulePersistQueue();

        render();

        setStatus(`宸蹭粠宸ュ叿绠辩Щ闄わ細${q.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:ok] id=${id || '-'} name=${q.name || '-'}`,
        );
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.queue = prevQueue;

        render();

        console.error('[ChatGPT toolbox] removeFileFromCurrentGroup failed', e);

        setStatus(`绉婚櫎鏂囦欢澶辫触锛屽凡鎭㈠鍘熼槦鍒楋細${errText}`, 'error');

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
        throw new Error(`涓婁紶鍒嗙粍涓庨槦鍒楀鍑哄け璐ワ細${errText}`);
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

        setStatus(`瀵煎叆涓婁紶鍒嗙粍澶辫触锛屽凡鎭㈠鍘熺姸鎬侊細${errText}`, 'error');

        throw e;
      }
    }

    function renderProjectCategoryChipHtml(group, activeGroupId) {
      return renderUploadGroupChipHtml(group, activeGroupId);
    }

    /** 椤圭洰鍒嗙被缁熻锛堜笂浼犲垎缁?chip锛夛紝涓庨〉闈㈣繛鎺ョ姸鎬佹棤鍏炽€?*/
    function renderUploadGroupFallbackChipHtml() {
      return `
          <button type="button"
            class="cgpt-chip-btn cgpt-upload-group-chip active"
            data-group-id=""
            title="榛樿锛? 涓枃浠?>
            <span class="cgpt-chip-name">榛樿</span>
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
              title="姝ｅ湪鍔犺浇涓婁紶鍒嗙粍">
              <span class="cgpt-chip-name">鍔犺浇涓?/span>
              <span class="cgpt-chip-count">鈥?/span>
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
      const pageIdText = `椤甸潰ID:${pageDisplayId}`;
      const turnText = `杞?${turnCount}`;

      pageStatusRowEl.innerHTML = `
        <span id="cgpt-page-input-state" class="cgpt-status-pill cgpt-toolbox-top-status-badge cgpt-state-unknown">鏈煡</span>
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

      ToolboxShell.appendLog('[UPLOAD_DIAG][wait-upload-idle-timeout] 闄勪欢绌洪棽妫€娴嬭秴鏃讹紝浣嗘枃浠剁姸鎬佸凡鍐欏叆锛岀户缁粨鏉熶笂浼犳祦绋?');
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
      return text || '榛樿';
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

      // 椤圭洰鏂囦欢澶?鍒嗙粍鍒囨崲鏍忔槸鏍稿績鍔熻兘锛岀簿绠€妯″紡涔熷繀椤绘樉绀恒€?
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
      const title = String(prompt && prompt.title ? prompt.title : '鏈懡鍚?').trim() || '鏈懡鍚?';
      const action = cfg.quickPromptClickAction === 'fill' ? 'fill' : 'send';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][quick-prompt:click] title=${title} action=${action} waiting=${isWaitingSendActive() ? '1' : '0'}`
      );

      if (!text) {
        setStatus(`Prompt 鍐呭涓虹┖锛?{title}`, 'warn');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:empty] title=${title}`);
        return;
      }

      const existingText = typeof ComposerApi.getComposerText === 'function'
        ? String(ComposerApi.getComposerText() || '').trim()
        : '';

      if (existingText && existingText !== text && cfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(
          `ChatGPT 杈撳叆妗嗗凡鏈?${existingText.length} 涓瓧绗︼紝鏄惁瑕嗙洊涓哄揩鎹?Prompt锛?{title}锛焋,`
        );

        if (!okReplace) {
          setStatus('宸插彇娑堬細鏈鐩栬緭鍏ユ鑽夌', 'warn');
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
        setStatus('鏈壘鍒?ChatGPT 杈撳叆妗嗭紝鏃犳硶濉叆 Prompt', 'error');
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
        setStatus(`宸插～鍏?Prompt锛?{title}`, 'success');
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
          setStatus(`宸插彂閫?Prompt锛?{title}`, 'success');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][quick-prompt:send-confirmed] title=${title} reason=${sendResult.reason || '-'}`,
          );
          return;
        }

        setStatus(`蹇嵎 Prompt 鍙戦€佸け璐ワ細${sendResult.reason || 'unknown'}`, 'warn');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][quick-prompt:send-failed] title=${title} reason=${sendResult.reason || '-'}`,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] quick prompt send failed', err);
        setStatus(`蹇嵎 Prompt 鍙戦€佸け璐ワ細${errText}`, 'error');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:send-failed] title=${title} error=${errText}`);
      }
    }

    async function waitAssistantStableForCopyContinue(source = 'copy-continue') {
      ToolboxShell.appendLog(
        `[UPLOAD_COPY_CONTINUE][wait-start] source=${String(source || '-')}`,
      );

      setStatus('姝ｅ湪绛夊緟褰撳墠鍥炲瀹屾垚...', 'danger', {
        persist: true,
        shortText: '绛夊洖澶?',
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

        setStatus(`绛夊緟鍥炲瀹屾垚澶辫触锛?{reason}`, 'warn');

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

        setStatus('绛夊緟鍥炲瀹屾垚澶辫触锛氬洖澶嶅皻鏈氨缁?', 'warn');

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
        setStatus('姝ｅ湪绛夊緟鏈€鍚庡洖澶嶇ǔ瀹?..', 'running');

        let text = '';
        if (typeof waitAssistantStableForCopyContinue === 'function') {
          const waitResult = await waitAssistantStableForCopyContinue(source);
          if (!waitResult || !waitResult.ok) {
            const reason = waitResult && waitResult.reason ? waitResult.reason : 'wait-assistant-failed';
            ToolboxShell.appendLog(
              `[COPY_LAST_REPLY][abort] reason=${reason}`,
            );
            setStatus(`澶嶅埗鏈€鍚庡洖澶嶅け璐ワ細${reason}`, 'warn');
            copyLastReplyTaskStatus = 'failed';
            copyLastMessageTaskStatus = 'failed';
            copyLastMessageWaiting = false;
            renderUploadButtonsOnly();
            if (btn && typeof setButtonTemporaryError === 'function') {
              setButtonTemporaryError(btn, '澶嶅埗澶辫触', 1200);
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
          setStatus('澶嶅埗鏈€鍚庡洖澶嶅け璐ワ細娌℃湁鎵惧埌鍙鍒剁殑鍥炲', 'warn');
          copyLastReplyTaskStatus = 'failed';
          copyLastMessageTaskStatus = 'failed';
          copyLastMessageWaiting = false;
          renderUploadButtonsOnly();
          if (btn && typeof setButtonTemporaryError === 'function') {
            setButtonTemporaryError(btn, '澶嶅埗澶辫触', 1200);
          }
          return false;
        }

        copyLastReplyTaskStatus = 'copying';
        copyLastMessageTaskStatus = 'copying';
        copyLastMessageWaiting = false;
        renderUploadButtonsOnly();

        if (typeof copyTextToClipboard !== 'function') {
          ToolboxShell.appendLog('[COPY_LAST_REPLY][abort] reason=copyTextToClipboard-missing');
          setStatus('澶嶅埗澶辫触锛氬壀璐存澘鍑芥暟涓嶅彲鐢?', 'error');
          copyLastReplyTaskStatus = 'failed';
          copyLastMessageTaskStatus = 'failed';
          renderUploadButtonsOnly();
          if (btn && typeof setButtonTemporaryError === 'function') {
            setButtonTemporaryError(btn, '澶嶅埗澶辫触', 1200);
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
        setStatus('宸插鍒舵渶鍚庡洖澶?', 'success');
        if (typeof playCopySuccessBeepSafe === 'function') {
          void playCopySuccessBeepSafe(source || '-', 'copyLastReply');
        }
        if (btn && typeof setButtonTemporaryOk === 'function') {
          setButtonTemporaryOk(btn, '宸插鍒?', 900);
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
        setStatus(`澶嶅埗鏈€鍚庡洖澶嶅け璐ワ細${errText}`, 'error');
        copyLastReplyTaskStatus = 'failed';
        copyLastMessageTaskStatus = 'failed';
        copyLastMessageWaiting = false;
        renderUploadButtonsOnly();
        if (btn && typeof setButtonTemporaryError === 'function') {
          setButtonTemporaryError(btn, '澶嶅埗澶辫触', 1200);
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

      if (isWaitingSendActive()) {
        cancelWaitingSend('copy-continue');
      }

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

    function getCopyHotkeyLoopContinuePrompt() {
      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      const fallback = `请继续完成上一个任务。
如果你判断任务已经完成、没有必要继续、没有剩余内容需要输出，请只回复：
<<<TASK_DONE>>>
不要输出任何其他文字。
否则请继续输出剩余内容，不要重复已经输出过的内容。`;

      const prompt = String(cfg.copyHotkeyLoopContinuePrompt || '').trim();
      return prompt || fallback;
    }

    function getCopyHotkeyLoopStopSignalConfig() {
      const cfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      const signal = String(cfg.copyHotkeyLoopStopSignal || '<<<TASK_DONE>>>').trim();

      return {
        enabled: cfg.copyHotkeyLoopStopSignalEnabled !== false,
        signal: signal || '<<<TASK_DONE>>>',
      };
    }

    function getLastAssistantMessageTextForStopSignal() {
      const assistantNodes = Array.from(
        document.querySelectorAll('[data-message-author-role="assistant"]')
      );

      const lastNode = assistantNodes.length > 0
        ? assistantNodes[assistantNodes.length - 1]
        : null;

      if (!lastNode) {
        return '';
      }

      return String(lastNode.innerText || lastNode.textContent || '').trim();
    }

    function isCopyHotkeyLoopStopSignalMatched(text, signal) {
      const normalizedText = String(text || '').trim();
      const normalizedSignal = String(signal || '').trim();

      if (!normalizedText || !normalizedSignal) {
        return false;
      }

      if (normalizedText === normalizedSignal) {
        return true;
      }

      const textLines = normalizedText
        .split(/\r?\n/g)
        .map(function(line) { return String(line || '').trim(); })
        .filter(Boolean);

      return textLines.some(function(line) { return line === normalizedSignal; });
    }

    function detectCopyHotkeyLoopStopSignal(cycleIndex) {
      const cfg = getCopyHotkeyLoopStopSignalConfig();

      if (!cfg.enabled) {
        return {
          matched: false,
          reason: 'disabled',
        };
      }

      const assistantText = getLastAssistantMessageTextForStopSignal();
      const matched = isCopyHotkeyLoopStopSignalMatched(assistantText, cfg.signal);

      if (!matched) {
        return {
          matched: false,
          reason: 'not-matched',
        };
      }

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][stop-signal-matched] index=${cycleIndex} signal=${cfg.signal}`
        );
      }

      if (typeof setStatus === 'function') {
        setStatus(
          `连续复制+快捷键+继续：检测到终止信号，任务已完成`,
          'success'
        );
      }

      return {
        matched: true,
        reason: 'stop-signal',
        signal: cfg.signal,
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

    async function waitUntilAssistantIdleForContinue(source, maxWaitMs = 15000) {
      const startedAt = Date.now();

      while (Date.now() - startedAt < maxWaitMs) {
        let busy = false;

        try {
          busy = (
            typeof ComposerApi !== 'undefined'
            && ComposerApi
            && typeof ComposerApi.isAssistantLikelyBusy === 'function'
            && ComposerApi.isAssistantLikelyBusy()
          );
        } catch (error) {
          console.error('[UPLOAD_CONTINUE][WAIT_IDLE_CHECK_ERROR]', {
            source,
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          busy = false;
        }

        safeAppendLog(
          `[UPLOAD_CONTINUE][WAIT_IDLE_POLL] source=${String(source || '-')} busy=${busy ? '1' : '0'} elapsed=${Date.now() - startedAt}`,
        );

        if (!busy) {
          return true;
        }

        await sleep(800);
      }

      safeAppendLog(
        `[UPLOAD_CONTINUE][WAIT_IDLE_TIMEOUT] source=${String(source || '-')} maxWaitMs=${maxWaitMs}`,
      );

      return false;
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
          btn.textContent = '澶嶅埗涓?..';
          btn.disabled = true;
        }

        if (typeof copyTextToClipboard !== 'function') {
          setStatus('澶嶅埗鏈€鍚庡洖澶嶅け璐ワ細鍓创鏉?API 涓嶅彲鐢?', 'error');
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
          btn.textContent = '鍙戦€佺户缁?..';
          btn.disabled = true;
        }

        const sentResult = await sendContinueMessageOnly('copy-continue-after-wait');

        if (!sentResult || !sentResult.ok) {
          ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][failed] reason=continue-send-failed');
          return false;
        }

        copyTaskStatus = 'done';
        setStatus('宸插鍒舵渶鍚庡洖澶嶏紝骞跺彂閫侊細缁х画', 'success');
        ToolboxShell.appendLog('[UPLOAD_COPY_CONTINUE][done] copied=1 sent=1');
        setButtonTemporaryOk(btn);

        return true;
      } catch (error) {
        copyTaskStatus = 'failed';
        const errText = formatToolboxError(error);
        console.error('[ChatGPT toolbox] copyLastMessageAndContinue failed', error);
        ToolboxShell.appendLog(`[UPLOAD_COPY_CONTINUE][failed] error=${errText}`);
        setStatus(`澶嶅埗骞剁户缁け璐ワ細${errText}`, 'error');
        setButtonTemporaryError(btn, '澶嶅埗澶辫触', 1200);
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
          btn.textContent = '绛夊緟鍥炲...';
        }
        if (!isLoopMode) {
          setStatus('姝ｅ湪绛夊緟鍥炵瓟瀹屾垚锛岀劧鍚庡鍒跺苟鍙戦€佸揩鎹烽敭', 'running');
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
            setStatus(`澶嶅埗+蹇嵎閿?缁х画澶辫触锛?{reason}`, 'warn');
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
            setStatus('澶嶅埗+蹇嵎閿?缁х画澶辫触锛氭渶鍚庡洖澶嶄负绌?', 'warn');
          }
          return {
            ok: false,
            reason: 'empty-assistant-text',
            source: sourceText,
            loopMode: isLoopMode,
          };
        }

        if (isCopyHotkeyContinueStopSignalText(waitResult.text)) {
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][stop-signal] source=${sourceText || '-'} signal=${getCopyHotkeyContinueStopSignal()}`,
          );

          if (!isLoopMode) {
            setStatus('收到终止信号，任务已完成，不再继续', 'success');
          }

          return {
            ok: true,
            reason: 'stop-signal',
            shouldStopLoop: true,
            source: sourceText,
            loopMode: isLoopMode,
          };
        }

        const assistantMessageKey = buildAssistantMessageKeyFromRecord(
          waitResult.record,
          waitResult.text,
        ) || getLastAssistantMessageKeySafe();

        logCopyHotkeyContinueStep(sourceText, 'copy-last-reply');
        if (btn && !isLoopMode) {
          btn.textContent = '澶嶅埗涓?..';
        }
        if (typeof copyTextToClipboard !== 'function') {
          if (!isLoopMode) {
            setStatus('澶嶅埗澶辫触锛氬壀璐存澘 API 涓嶅彲鐢?', 'error');
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
            setStatus(`澶嶅埗+蹇嵎閿?缁х画澶辫触锛?{errText}`, 'error');
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
          btn.textContent = '鍙戦€佸揩鎹烽敭...';
        }
        const hotkeyOk = await triggerSendHotkeyOnce();
        if (!hotkeyOk) {
          ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE][failed] reason=hotkey-failed');
          if (!isLoopMode) {
            setStatus('澶嶅埗鎴愬姛锛屼絾 Ctrl+Alt+I 鎵ц澶辫触', 'error');
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
          btn.textContent = '鍙戦€佺户缁?..';
        }
        const continueSource = isLoopMode ? sourceText : 'copy-hotkey-continue-once';
        const loopContinuePromptTxt = getCopyHotkeyContinuePromptText();
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][continue-prompt] index=${copyHotkeyContinueLoopCount + 1} length=${loopContinuePromptTxt.length}`);
        const continueResult = await sendContinueMessageOnly(continueSource);
        if (!continueResult || !continueResult.ok) {
          const detail = continueResult && continueResult.reason ? continueResult.reason : '';
          ToolboxShell.appendLog(
            `[COPY_HOTKEY_CONTINUE][failed] reason=continue-send-failed detail=${detail || '-'}`,
          );
          if (!isLoopMode) {
            setStatus('澶嶅埗鍜屽揩鎹烽敭宸插畬鎴愶紝浣嗗彂閫?缁х画"澶辫触', 'error');
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
          setStatus('宸插鍒舵渶鍚庡洖澶嶏紝宸插彂閫?Ctrl+Alt+I锛屽苟鍙戦€佺户缁?', 'success');
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
          setStatus(`澶嶅埗+蹇嵎閿?缁х画澶辫触锛?{errText}`, 'error');
          if (btn) {
            setButtonTemporaryError(btn, '鎵ц澶辫触', 1200);
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
            btn.textContent = '澶嶅埗+蹇嵎閿?缁х画';
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
      setStatus('杩炵画澶嶅埗+蹇嵎閿?缁х画锛氱瓑寰呬笅涓€杞洖绛旇秴鏃?', 'warn');
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
        `????+???+???? ${cycleIndex} ???????????? ChatGPT ??`,
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
          setStatus(`???????${errText}`, 'error');
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
        `????+???+???? ${cycleIndex} ??????????????????`,
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

        setStatus(`? ${cycleIndex} ????????${errText}`, 'error');

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
        setStatus('姝ｅ湪鍋滄杩炵画澶嶅埗+蹇嵎閿?缁х画...', 'warn');
        ToolboxShell.appendLog('[COPY_HOTKEY_CONTINUE_LOOP][stop-requested]');
        if (btn) {
          btn.textContent = '鍋滄涓?..';
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
        btn.textContent = '鍋滄杩炵画';
      }
      setStatus('杩炵画澶嶅埗+蹇嵎閿?缁х画宸插惎鍔?', 'running');
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

          if (result && result.shouldStopLoop) {
            loopStopReason = 'stop-signal';
            safeAppendLog(
              `[COPY_HOTKEY_CONTINUE_LOOP][natural-stop] reason=stop-signal index=${copyHotkeyContinueLoopCount}`,
            );
            setStatus(
              `连续复制+快捷键+继续已完成，共执行 ${copyHotkeyContinueLoopCount} 轮`,
              'success',
            );
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
            loopStopReason = stopSignalResult.reason || 'stop-signal';

            if (typeof safeAppendLog === 'function') {
              safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][stop] reason=${loopStopReason} index=${copyHotkeyContinueLoopCount}`);
            }

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
        setStatus(`杩炵画澶嶅埗+蹇嵎閿?缁х画澶辫触锛?{errText}`, 'error');
      } finally {
        const stoppedByUser = copyHotkeyContinueLoopStopRequested;
        copyHotkeyContinueLoopRunning = false;
        copyHotkeyContinueLoopStopRequested = false;
        if (btn) {
// placeholder
true;
