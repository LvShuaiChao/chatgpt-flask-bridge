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

      if (
        q.source === 'flask_local_direct'
        || q.sourceKind === 'flask_local_direct'
        || q.flask_local_direct === true
      ) {
        return '本地直读';
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

    function renderProjectCategoryChipHtml(group, activeGroupId) {
      return renderUploadGroupChipHtml(group, activeGroupId);
    }

    /** 项目分类统计（上传分组 chip），与页面连接状态无关。 */
    function renderProjectCategoryChips() {
      if (!groupListEl) {
        ToolboxShell.appendLog('[UPLOAD_GROUP_UI][render-skip] reason=groupListEl-missing');
        return;
      }

      if (!state.groups.length) {
        groupListEl.innerHTML = `
          <button type="button"
            class="cgpt-chip-btn cgpt-upload-group-chip active"
            data-group-id=""
            title="默认：0 个文件">
            <span class="cgpt-chip-name">默认</span>
            <span class="cgpt-chip-count">0</span>
          </button>
        `;
        return;
      }

      groupListEl.innerHTML = state.groups
        .map((group) => renderProjectCategoryChipHtml(group, state.activeGroupId))
        .join('');
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
      const turnText = `轮:${turnCount}`;

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
      const text = '\u7ee7\u7eed';
      const sourceText = String(source || '-');

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
          setStatus('\u5df2\u53d1\u9001\uff1a\u7ee7\u7eed', 'success');
          console.warn('[UPLOAD_CONTINUE][SEND_OK]', { source, reason: result && result.reason });
          safeAppendLog(`[UPLOAD_CONTINUE][sent] text=\u7ee7\u7eed reason=${result.reason || '-'}`);
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
        setStatus('\u5df2\u53d1\u9001\uff1a\u7ee7\u7eed', 'success');
        console.warn('[UPLOAD_CONTINUE][SEND_OK]', { source, reason: 'composer-click-send' });
        safeAppendLog('[UPLOAD_CONTINUE][sent] text=\u7ee7\u7eed');
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
        } else if (!capability.can_send_now) {
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
          title: '等待回答完成 -> 复制最后回复 -> 发送 Ctrl+Alt+I -> 发送继续',
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
          copyHotkeyContinueLoopBtn.title = '循环执行：等待回答完成 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续';
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
        if (!capability.can_send_now) {
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
          updateChatInputStateBadge();
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
          <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">管理</button>
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
        copyHotkeyContinueLoopBtn.title = '循环执行：等待回答完成 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续';
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
        saveQuickPromptActiveCategory('全部', {
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
      ensureToolboxPageStatusRow(rootEl);
      ensureUploadGroupSection(rootEl);
      ensureUploadActionButtons(rootEl);
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

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-blob-persist-inline">
                保存小文件内容到 IndexedDB
              </label>

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-use-unique-name-inline">
                上传时加时间戳+序号（仅内存，例：…_20260523_200319_01.zip）
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
            <button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" title="复制最后回复 -> 发送 Ctrl+Alt+I -> 发送继续">复制+快捷键+继续</button>
            <button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" title="循环执行：等待回答完成 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续">连续复制+快捷键+继续</button>
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
        renderToolboxTopStatus();
        if (reason && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[TOOLBOX_TOP_STATUS][refresh] reason=${reason} page_display_id=${getBridgePageDisplayIdText()} turn_count=${getConversationTurnCount()}`,
          );
        }
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
