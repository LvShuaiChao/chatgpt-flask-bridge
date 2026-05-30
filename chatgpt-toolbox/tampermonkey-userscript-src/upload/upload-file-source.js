  /********************************************************************
   * UploadFileSource：文件来源、权限、可读性与重绑
   ********************************************************************/

  const UploadFileSource = (() => {
    function create(deps) {
      const state = deps.state;
      const appendUploadLog = deps.appendUploadLog;
      const getActiveGroupId = deps.getActiveGroupId;
      const getScopedQueueItemsForUpload = deps.getScopedQueueItemsForUpload;
      const normalizeUploadItem = deps.normalizeUploadItem;
      const syncUploadItemSchemaInPlace = deps.syncUploadItemSchemaInPlace;
      const loadUploadFileHandle = deps.loadUploadFileHandle;
      const deleteUploadFileHandle = deps.deleteUploadFileHandle;
      const getPersistedKindForItem = deps.getPersistedKindForItem;
      const getRestoreStateForItem = deps.getRestoreStateForItem;
      const schedulePersistQueueItem = deps.schedulePersistQueueItem;
      const scheduleRenderUploadListOnly = deps.scheduleRenderUploadListOnly;
      const renderUploadListOnly = deps.renderUploadListOnly;
      const UploadState = deps.UploadState;
      const UploadRestoreState = deps.UploadRestoreState;
      const UploadPersistedKind = deps.UploadPersistedKind;
      const isFlaskLocalDirectSource = deps.isFlaskLocalDirectSource;
      const isFlaskLocalDirectItem = deps.isFlaskLocalDirectItem;
      const isFileLike = deps.isFileLike;
      const isBlobLike = deps.isBlobLike;
      const isUploadUnfinishedState = deps.isUploadUnfinishedState;
      const normalizeUploadState = deps.normalizeUploadState;
      const safeAssignRestoreState = deps.safeAssignRestoreState;
      const isUploadDebugEnabled = deps.isUploadDebugEnabled;
      const resetDirtyUploadRestoreState = deps.resetDirtyUploadRestoreState;
      const normalizeRestoreObject = deps.normalizeRestoreObject;
      const isPlainObject = deps.isPlainObject;
      const hasAttachmentEvidenceForItem = deps.hasAttachmentEvidenceForItem;
      const awaitPersistQueueBriefly = deps.awaitPersistQueueBriefly;
      const persistQueueThrottled = deps.persistQueueThrottled;
      const getActiveUploadScopeGroupId = deps.getActiveUploadScopeGroupId;
      const isUploadItemInActiveScope = deps.isUploadItemInActiveScope;
      const buildVirtualFilePrepareSource = deps.buildVirtualFilePrepareSource;
      const isCadenceUploadSource = deps.isCadenceUploadSource;
      const prepareVirtualUploadFileForItem = deps.prepareVirtualUploadFileForItem;
      const isQueueItemAlreadyUploaded = deps.isQueueItemAlreadyUploaded;
      const isLegacyUploadItemAttached = deps.isLegacyUploadItemAttached;
      const summarizeUploadAttachmentPresenceForScope = deps.summarizeUploadAttachmentPresenceForScope;
      const STRICT_UPLOAD_CACHE_FORBIDDEN_MESSAGE = deps.STRICT_UPLOAD_CACHE_FORBIDDEN_MESSAGE;
      const describeUploadSource = deps.describeUploadSource;
      const logUploadItemSource = deps.logUploadItemSource;
      const getActiveGroupFiles = deps.getActiveGroupFiles;
      const refreshUploadGroupCounts = deps.refreshUploadGroupCounts;
      const broadcastUploadGlobalStateChanged = deps.broadcastUploadGlobalStateChanged;
      const render = deps.render;

      [
        ['UploadState', UploadState],
        ['UploadRestoreState', UploadRestoreState],
        ['UploadPersistedKind', UploadPersistedKind],
        ['isFlaskLocalDirectSource', isFlaskLocalDirectSource],
        ['isFlaskLocalDirectItem', isFlaskLocalDirectItem],
        ['isFileLike', isFileLike],
        ['isBlobLike', isBlobLike],
        ['isUploadUnfinishedState', isUploadUnfinishedState],
        ['normalizeUploadState', normalizeUploadState],
        ['safeAssignRestoreState', safeAssignRestoreState],
        ['isUploadDebugEnabled', isUploadDebugEnabled],
        ['resetDirtyUploadRestoreState', resetDirtyUploadRestoreState],
        ['normalizeRestoreObject', normalizeRestoreObject],
        ['isPlainObject', isPlainObject],
        ['hasAttachmentEvidenceForItem', hasAttachmentEvidenceForItem],
        ['awaitPersistQueueBriefly', awaitPersistQueueBriefly],
        ['persistQueueThrottled', persistQueueThrottled],
        ['getActiveUploadScopeGroupId', getActiveUploadScopeGroupId],
        ['isUploadItemInActiveScope', isUploadItemInActiveScope],
        ['buildVirtualFilePrepareSource', buildVirtualFilePrepareSource],
        ['isCadenceUploadSource', isCadenceUploadSource],
        ['prepareVirtualUploadFileForItem', prepareVirtualUploadFileForItem],
        ['isQueueItemAlreadyUploaded', isQueueItemAlreadyUploaded],
        ['isLegacyUploadItemAttached', isLegacyUploadItemAttached],
        ['summarizeUploadAttachmentPresenceForScope', summarizeUploadAttachmentPresenceForScope],
        ['STRICT_UPLOAD_CACHE_FORBIDDEN_MESSAGE', STRICT_UPLOAD_CACHE_FORBIDDEN_MESSAGE],
        ['describeUploadSource', describeUploadSource],
        ['logUploadItemSource', logUploadItemSource],
        ['getActiveGroupFiles', getActiveGroupFiles],
        ['refreshUploadGroupCounts', refreshUploadGroupCounts],
        ['broadcastUploadGlobalStateChanged', broadcastUploadGlobalStateChanged],
        ['render', render],
      ].forEach(([name, value]) => {
        const ok =
          typeof value === 'function'
          || typeof value === 'object'
          || typeof value === 'string'
          || typeof value === 'number'
          || typeof value === 'boolean';

        if (!ok) {
          throw new Error(`UploadFileSource missing dependency: ${name}`);
        }
      });

      const newId = deps.newId;
      const createId = deps.createId;
      const setStatus = deps.setStatus;
      const scheduleRenderUpload = deps.scheduleRenderUpload;
      const persistQueue = deps.persistQueue;
      const openUploadFileHandleDb = deps.openUploadFileHandleDb;
      const getUploadItemGroupId = deps.getUploadItemGroupId;
      const UploadSelectors = deps.UploadSelectors;
      const qs = deps.qs;

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

    function buildUploadHandleKey(item) {
      if (!item) return '';
      const id = String(item.id || '').trim();
      const groupId = String(item.groupId || state.activeGroupId || '').trim();
      if (!id) return '';
      return `upload:${groupId || '-'}:${id}`;
    }

    function hasActuallyReusableUploadSource(q) {
      return hasAttemptableUploadSource(q);
    }

    function hasReusableUploadSourceForReset(q) {
      return hasAttemptableUploadSource(q);
    }

    function markUploadItemNeedsRebind(item, reason = '', source = '') {
      if (!item || typeof item !== 'object') {
        return;
      }

      const reasonText = String(reason || 'file-handle-unavailable').trim() || 'file-handle-unavailable';

      item.state = UploadState.NEEDS_REBIND;
      item.attachState = UploadState.NEEDS_REBIND;
      item.status = 'needs_rebind';
      item.registryStatus = 'needs_rebind';
      item.restoreState = UploadRestoreState.NEEDS_REBIND;
      item.needsRebind = true;
      item.missingReason = reasonText;
      item.sourceKind = 'missing-file';
      item.readMode = '';
      item.localReadable = false;
      item.localBound = false;
      item.reusableForCadence = false;
      item.uploadName = '';
      item.message = `文件源已失效，请重新选择：${reasonText}`;
      item.updatedAt = Date.now();

      item.file = null;
      item.sourceFile = null;
      item.originalFile = null;
      item.blob = null;
      item.sourceBlob = null;
      item.fileHandle = null;
      item.handle = null;
      item.localHandle = null;

      syncUploadItemSchemaInPlace(item);

      ToolboxShell.appendLog(
        `[UPLOAD_REBIND][MARK] source=${source || '-'} name=${item.name || item.filename || '-'} reason=${reasonText}`,
      );
    }

    async function ensureReusableFileForUploadItem(item, source = '') {
      if (!item) {
        return false;
      }

      if (item.restoreState === UploadRestoreState.NEEDS_REBIND) {
        ToolboxShell.appendLog(
          `[UPLOAD][FILE_HANDLE_RELOAD_FAILED] source=${source || '-'} name=${item.name || item.filename || '-'} reason=needs-rebind`,
        );
        return false;
      }
      if (item.restoreState === UploadRestoreState.PERMISSION_REQUIRED) {
        ToolboxShell.appendLog(
          `[UPLOAD][FILE_HANDLE_RELOAD_FAILED] source=${source || '-'} name=${item.name || item.filename || '-'} reason=permission-required`,
        );
        return false;
      }

      if (isUploadSourceCacheForbidden(item) && !hasLocalReadableHandle(item) && !isFlaskLocalDirectSource(item)) {
        markCacheForbiddenUploadItems([item], source || 'ensureReusableFileForUploadItem');
        return false;
      }

      if (isFlaskLocalDirectSource(item) || isFlaskLocalDirectItem(item)) {
        const hasFlaskEndpoint = !!(
          String(typeof item.download_url === 'string' ? item.download_url : '').trim()
          || String(item.file_id || '').trim()
        );
        if (hasFlaskEndpoint) {
          return true;
        }
      }

      if (
        isFileLike(item.file)
        || isFileLike(item.sourceFile)
        || isFileLike(item.originalFile)
      ) {
        return true;
      }

      if (item.fileHandle && typeof item.fileHandle.getFile === 'function') {
        try {
          const file = await item.fileHandle.getFile();
          if (isFileLike(file)) {
            item.file = file;
            item.sourceFile = file;
            item.originalFile = file;
            item.name = item.name || file.name;
            item.size = item.size || file.size;
            item.type = item.type || file.type;
            ToolboxShell.appendLog(
              `[UPLOAD][FILE_HANDLE_RELOAD_OK] source=${source || '-'} name=${file.name || '-'} size=${file.size || 0}`,
            );
            return true;
          }
        } catch (e) {
          console.error('[ChatGPT toolbox] ensureReusableFileForUploadItem: fileHandle.getFile failed', e);
          const errText = e && e.message ? e.message : String(e);
          ToolboxShell.appendLog(
            `[UPLOAD][FILE_HANDLE_RELOAD_FAILED] source=${source || '-'} name=${item.name || item.filename || '-'} reason=getFile-error error=${errText}`,
          );

          markUploadItemNeedsRebind(item, errText, source || 'ensureReusableFileForUploadItem');

          scheduleRenderUpload(`file-handle-reload-failed:${source || '-'}`);
          persistQueueThrottled(`file-handle-reload-failed:${source || '-'}`);

          return false;
        }
      }

      ToolboxShell.appendLog(
        `[UPLOAD][FILE_HANDLE_RELOAD_FAILED] source=${source || '-'} name=${item.name || item.filename || '-'} reason=no-readable-source`,
      );
      markUploadItemNeedsRebind(item, 'no-readable-source', source || 'ensureReusableFileForUploadItem');

      scheduleRenderUpload(`no-readable-source:${source || '-'}`);
      persistQueueThrottled(`no-readable-source:${source || '-'}`);

      return false;
    }

    async function getPendingUploadItemsForStart(source = '', options = {}) {
      const scopeGroupId = getActiveUploadScopeGroupId(options);
      const items = [];
      const seen = new Set();
      const forceReupload = options && typeof options === 'object' && options.forceReupload === true;

      const pushItem = (item, itemSource) => {
        if (!item) return;
        if (!isUploadItemInActiveScope(item, scopeGroupId)) return;
        const key = [
          itemSource,
          item.id || item.file_id || '',
          item.name || item.filename || '',
          typeof item.download_url === 'string' ? item.download_url : '',
        ].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
          ...item,
          groupId: getUploadItemGroupId(item) || scopeGroupId,
          source: itemSource || item.source || 'browser_file',
        });
      };

      for (const item of state.queue || []) {
        if (!item) continue;
        if (!isUploadItemInActiveScope(item, scopeGroupId)) continue;

        if (item.restoreState === UploadRestoreState.NEEDS_REBIND || item.needsRebind === true) {
          ToolboxShell.appendLog(
            `[UPLOAD_RESTORE][NEEDS_REBIND] id=${item.id || '-'} name=${item.name || item.filename || '-'} `
            + `reason=${String(item.missingReason || 'page-reloaded-file-object-lost').trim()}`,
          );
          continue;
        }
        if (item.restoreState === UploadRestoreState.PERMISSION_REQUIRED) {
          ToolboxShell.appendLog(
            `[UPLOAD_RESTORE][PERMISSION_REQUIRED] id=${item.id || '-'} name=${item.name || item.filename || '-'}`
          );
          continue;
        }

        const reusable = await ensureReusableFileForUploadItem(item, source);
        if (!reusable) {
          ToolboxShell.appendLog(
            `[UPLOAD][PENDING_SKIP] source=${source || '-'} groupId=${scopeGroupId || '-'} name=${item.name || item.filename || '-'} reason=no-reusable-source state=${item.state || '-'} status=${item.status || '-'}`,
          );
          continue;
        }

        const virtualPrepareSource = buildVirtualFilePrepareSource(source, options);
        const virtualPrepareOpts = {
          ...options,
          source,
          parentSource: source,
          cadenceUpload: isCadenceUploadSource(source) || options.cadenceUpload === true,
          continueWithUpload: isCadenceUploadSource(source) || options.continueWithUpload === true,
        };
        try {
          await prepareVirtualUploadFileForItem(item, virtualPrepareSource, virtualPrepareOpts);
        } catch (virtualErr) {
          const virtualErrText = virtualErr && virtualErr.message ? virtualErr.message : String(virtualErr);
          ToolboxShell.appendLog(
            `[UPLOAD][PENDING_SKIP] source=${source || '-'} groupId=${scopeGroupId || '-'} name=${item.name || item.filename || '-'} reason=virtual-file-failed detail=${virtualErrText}`,
          );
          continue;
        }

        if (!forceReupload && isQueueItemAlreadyUploaded(item)) {
          ToolboxShell.appendLog(
            `[UPLOAD][SKIP_ALREADY_UPLOADED] original=${item.originalUploadName || item.name || item.filename || '-'} virtual=${item.virtualUploadName || '-'} timestamp=${item.virtualUploadTimestamp || '-'} fingerprint=${item.uploadedFingerprint || '-'} attachedVirtual=${item.attachedVirtualUploadName || '-'} source=${source || '-'}`,
          );
          continue;
        }

        pushItem(item, item.source || 'browser_file');
      }

      for (const item of state.flaskFiles || []) {
        if (!item) continue;
        if (!isUploadItemInActiveScope(item, scopeGroupId)) continue;
        if (!isFlaskLocalDirectItem(item)) continue;

        const flaskVirtualPrepareSource = buildVirtualFilePrepareSource(source, options);
        const flaskVirtualPrepareOpts = {
          ...options,
          source,
          parentSource: source,
          cadenceUpload: isCadenceUploadSource(source) || options.cadenceUpload === true,
          continueWithUpload: isCadenceUploadSource(source) || options.continueWithUpload === true,
        };
        try {
          await prepareVirtualUploadFileForItem(item, flaskVirtualPrepareSource, flaskVirtualPrepareOpts);
        } catch (virtualErr) {
          ToolboxShell.appendLog(
            `[UPLOAD][PENDING_SKIP] source=${source || '-'} groupId=${scopeGroupId || '-'} name=${item.name || item.filename || '-'} reason=virtual-file-failed`,
          );
          continue;
        }

        if (!forceReupload && isQueueItemAlreadyUploaded(item)) {
          ToolboxShell.appendLog(
            `[UPLOAD][SKIP_ALREADY_UPLOADED] original=${item.originalUploadName || item.name || item.filename || '-'} virtual=${item.virtualUploadName || '-'} timestamp=${item.virtualUploadTimestamp || '-'} fingerprint=${item.uploadedFingerprint || '-'} attachedVirtual=${item.attachedVirtualUploadName || '-'} source=${source || '-'}`,
          );
          continue;
        }

        pushItem(item, 'flask_local_direct');
      }

      ToolboxShell.appendLog(
        `[UPLOAD][PENDING_FOR_START] source=${source || '-'} groupId=${scopeGroupId || '-'} count=${items.length}`,
      );
      return items;
    }

    function diagnoseNoPendingUploadItems(scopeGroupId = '', pendingItems = []) {
      const inScope = (item) => item && isUploadItemInActiveScope(item, scopeGroupId);
      const scopedQueue = (state.queue || []).filter(inScope);
      const scopedFlask = (state.flaskFiles || []).filter(inScope);
      const scopedItems = scopedQueue.concat(scopedFlask);
      const isFinalItem = (item) => {
        if (!item) {
          return false;
        }
        const normalizedItem = normalizeUploadItem(item, {
          groupId: scopeGroupId || getUploadItemGroupId(item) || state.activeGroupId,
        });
        return normalizedItem.attachState === UploadState.ATTACHED
          || normalizedItem.sendState === 'sent';
      };
      const blockedItems = scopedItems.filter((item) => item && isUploadSourceCacheForbidden(item));
      const missingSourceItems = scopedItems.filter(
        (item) => item && !isFinalItem(item) && !hasAttemptableUploadSource(item),
      );
      const needsRebindItems = scopedItems.filter((item) => {
        if (!item) {
          return false;
        }
        const normalizedStatus = String(item.status || '').trim().toLowerCase();
        return (
          item.restoreState === UploadRestoreState.NEEDS_REBIND
          || item.registryStatus === 'needs_rebind'
          || normalizedStatus === 'needs_rebind'
        );
      });
      const missingFileItems = scopedItems.filter((item) => {
        if (!item) {
          return false;
        }
        return (
          item.restoreState === UploadRestoreState.MISSING
          || item.state === UploadState.MISSING_FILE
          || item.sourceKind === 'missing-file'
        );
      });
      const uploadedItems = scopedItems.filter((item) => item && isQueueItemAlreadyUploaded(item));
      const attachedItems = scopedItems.filter((item) => item && isLegacyUploadItemAttached(item));
      const firstBlocked = blockedItems[0] || null;
      const firstBlockedReason = firstBlocked
        ? String(firstBlocked.cacheSourceBlockedReason || firstBlocked.message || firstBlocked.status || '').trim()
        : '';
      const summary = {
        activeGroupId: scopeGroupId || state.activeGroupId || '',
        totalItems: scopedItems.length,
        pendingCount: Array.isArray(pendingItems) ? pendingItems.length : 0,
        uploadedCount: uploadedItems.length,
        attachedCount: attachedItems.length,
        missingSourceCount: missingSourceItems.length,
        needsRebindCount: needsRebindItems.length,
        missingCount: missingFileItems.length,
        blockedCount: blockedItems.length,
        firstBlockedReason: firstBlockedReason || '',
      };
      const presenceSummary = summarizeUploadAttachmentPresenceForScope(scopeGroupId);
      ToolboxShell.appendLog(
        `[UPLOAD_START][NO_PENDING_DIAG] activeGroupId=${summary.activeGroupId || '-'} totalItems=${summary.totalItems} pendingCount=${summary.pendingCount} uploadedCount=${summary.uploadedCount} attachedCount=${summary.attachedCount} missingSourceCount=${summary.missingSourceCount} needsRebindCount=${summary.needsRebindCount} missingCount=${summary.missingCount} blockedCount=${summary.blockedCount} firstBlockedReason=${summary.firstBlockedReason || '-'} localBound=${presenceSummary.localBound} composerAttached=${presenceSummary.composerAttached} conversationSent=${presenceSummary.conversationSent}`,
      );
      return summary;
    }

    function resolveNoPendingUploadResult(summary = {}) {
      if (!summary.totalItems) {
        return {
          reason: 'no-files',
          message: '当前项目没有文件，请先选择或拖入文件',
          shouldOpenPicker: true,
        };
      }
      if (summary.blockedCount > 0) {
        return {
          reason: 'blocked',
          message: `存在被拦截文件：${summary.firstBlockedReason || '状态受限'}`,
          shouldOpenPicker: false,
        };
      }
      if (summary.totalItems > 0 && summary.pendingCount === 0 && summary.needsRebindCount > 0) {
        ToolboxShell.appendLog(
          `[UPLOAD_START][NO_PENDING_REASON] reason=missing-local-file-needs-rebind totalItems=${summary.totalItems} needsRebind=${summary.needsRebindCount} missing=${summary.missingCount || 0}`,
        );
        return {
          reason: 'missing-local-file-needs-rebind',
          message: '刷新页面或换电脑后，浏览器不会保留本地文件读取权限。请点击「重新绑定」重新选择同名文件。',
          shouldOpenPicker: false,
        };
      }
      if (summary.missingSourceCount > 0) {
        return {
          reason: 'missing-local-file-needs-rebind',
          message: '当前组文件源已失效。刷新/换电脑后需重新绑定，请点击「重新绑定」或重新拖入文件。',
          shouldOpenPicker: false,
        };
      }
      if (summary.uploadedCount + summary.attachedCount >= summary.totalItems) {
        return {
          reason: 'already-uploaded',
          message: '当前组文件已上传，无需重复上传',
          shouldOpenPicker: false,
          skipSuccess: true,
        };
      }
      return {
        reason: 'no-files',
        message: '没有待上传文件',
        shouldOpenPicker: false,
      };
    }

    function canReadFromLocal(q) {
      return !!(
        q &&
        q.sourceKind === 'local-handle' &&
        hasLocalReadableHandle(q)
      );
    }

    function isUploadItemAttemptable(item) {
      if (!item || isUploadSourceCacheForbidden(item)) {
        return false;
      }

      if (
        item.needsRebind === true
        || item.restoreState === UploadRestoreState.NEEDS_REBIND
        || item.restoreState === UploadRestoreState.MISSING
        || item.state === UploadState.MISSING_FILE
        || item.state === UploadState.NEEDS_REBIND
        || item.attachState === UploadState.MISSING_FILE
        || item.attachState === UploadState.NEEDS_REBIND
        || item.registryStatus === 'needs_rebind'
        || String(item.status || '').trim().toLowerCase() === 'needs_rebind'
      ) {
        return false;
      }

      if (isFileLike(item.file) || isFileLike(item.sourceFile) || isFileLike(item.originalFile)) {
        return true;
      }

      if (isBlobLike(item.blob) || isBlobLike(item.sourceBlob)) {
        return true;
      }

      if (hasLocalReadableHandle(item)) {
        return true;
      }

      if (item.fileHandle && typeof item.fileHandle.getFile === 'function') {
        return true;
      }

      if (isFlaskLocalDirectSource(item)) {
        return !!(
          String(typeof item.download_url === 'string' ? item.download_url : '').trim()
          || String(item.file_id || '').trim()
        );
      }

      return false;
    }

    function hasAttemptableUploadSource(q) {
      return isUploadItemAttemptable(q);
    }

    function getUploadLocalFileDiagnostics(scopeGroupId = '', pendingItems = []) {
      return diagnoseNoPendingUploadItems(scopeGroupId, pendingItems);
    }

    function hasReadableFreshLocalSource(q) {
      if (!q) {
        return false;
      }
      if (hasLocalReadableHandle(q)) {
        return true;
      }
      if (isFlaskLocalDirectSource(q) && hasAttemptableUploadSource(q)) {
        return true;
      }
      return false;
    }

    function clearStaleUnreadableFlagsForReadableItem(q, reason = '') {
      if (!q || !hasReadableFreshLocalSource(q)) {
        return false;
      }
      let changed = false;
      const oldRestoreState = q.restoreState;
      const oldRegistryStatus = q.registryStatus;
      const oldStatus = q.status;
      const oldSourceKind = q.sourceKind;
      const oldState = q.state;
      const oldMessage = q.message;

      if (
        q.restoreState === UploadRestoreState.NEEDS_REBIND
        || q.restoreState === UploadRestoreState.MISSING
        || q.restoreState === UploadRestoreState.PERMISSION_REQUIRED
      ) {
        q.restoreState = UploadRestoreState.READY;
        changed = true;
      }
      if (String(q.registryStatus || '').trim().toLowerCase() === 'needs_rebind') {
        q.registryStatus = 'ready';
        changed = true;
      }
      if (String(q.status || '').trim().toLowerCase() === 'needs_rebind') {
        q.status = 'ready';
        changed = true;
      }
      if (
        q.sourceKind === 'missing-file'
        || q.sourceKind === 'missing-local'
        || q.sourceKind === 'cached-snapshot'
        || q.sourceKind === 'cached-only'
        || q.sourceKind === 'indexeddb-blob'
        || q.sourceKind === 'session-file'
        || q.sourceKind === 'session-blob'
      ) {
        q.sourceKind = hasLocalReadableHandle(q) ? 'local-handle' : q.sourceKind;
        changed = true;
      }
      if (q.state === UploadState.MISSING_FILE) {
        q.state = UploadState.IDLE;
        changed = true;
      }
      if (
        String(q.message || '').includes('重新绑定')
        || String(q.message || '').includes('重新选择')
        || String(q.message || '').includes('文件源已失效')
        || String(q.message || '').includes('本地不可读')
        || String(q.message || '').includes('缺少文件')
        || String(q.message || '').includes('缓存快照')
      ) {
        q.message = '';
        changed = true;
      }
      if (String(q.error || '').trim()) {
        q.error = '';
        changed = true;
      }
      if (String(q.lastError || '').trim()) {
        q.lastError = '';
        changed = true;
      }
      if (changed) {
        ToolboxShell.appendLog(
          `[UPLOAD_UI][READABLE_STATE_FIX] reason=${reason || '-'} `
          + `name=${q.name || '-'} `
          + `restoreState=${oldRestoreState || '-'}=>${q.restoreState || '-'} `
          + `registryStatus=${oldRegistryStatus || '-'}=>${q.registryStatus || '-'} `
          + `status=${oldStatus || '-'}=>${q.status || '-'} `
          + `sourceKind=${oldSourceKind || '-'}=>${q.sourceKind || '-'} `
          + `state=${oldState || '-'}=>${q.state || '-'} `
          + `message=${oldMessage ? 1 : 0}=>${q.message ? 1 : 0}`,
        );
      }
      return changed;
    }

    function hasLocalReadableHandle(q) {
      return !!(
        q &&
        q.fileHandle &&
        typeof q.fileHandle.getFile === 'function'
      );
    }

    function isUploadSourceCacheForbidden(q) {
      if (!q) {
        return false;
      }
      if (hasLocalReadableHandle(q) || isFlaskLocalDirectSource(q)) {
        return false;
      }
      const kind = String(q.sourceKind || '').trim();
      const readMode = String(q.readMode || '').trim();
      if (
        kind === 'cached-snapshot'
        || kind === 'cached-only'
        || kind === 'indexeddb-blob'
        || kind === 'session-file'
        || kind === 'session-blob'
        || readMode === 'indexeddb-blob'
        || readMode === 'snapshot'
        || readMode === 'session'
      ) {
        return true;
      }
      return !!(
        isFileLike(q.file)
        || isFileLike(q.sourceFile)
        || isFileLike(q.originalFile)
        || isBlobLike(q.blob)
        || isBlobLike(q.sourceBlob)
      );
    }

    function isCachedUploadSnapshot(q) {
      return isUploadSourceCacheForbidden(q);
    }

    function markCacheForbiddenUploadItems(items, stage = '') {
      let count = 0;
      const stageText = String(stage || '-').trim() || '-';
      const forbiddenMessage = STRICT_UPLOAD_CACHE_FORBIDDEN_MESSAGE;

      (items || []).forEach((q) => {
        if (!q || !isUploadSourceCacheForbidden(q)) {
          return;
        }

        q.state = UploadState.MISSING_FILE;
        q.sourceKind = q.sourceKind || 'cached-snapshot';
        q.readMode = q.readMode || '';
        q.message = forbiddenMessage;
        q.updatedAt = Date.now();
        count += 1;

        ToolboxShell.appendLog(
          `[UPLOAD][BLOCK_CACHE_SOURCE] stage=${stageText} name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'}`,
        );
      });

      return count;
    }

    function blockUploadIfCacheSourcesPresent(files, stage = '') {
      const blockedItems = (files || []).filter(isUploadSourceCacheForbidden);
      if (!blockedItems.length) {
        return false;
      }

      markCacheForbiddenUploadItems(blockedItems, stage);
      setStatus('上传失败：当前文件是缓存快照，必须重新绑定真实本地文件后才能上传。', 'error');
      scheduleRenderUpload(`block-cache-source:${stage || 'upload'}`);
      persistQueueThrottled(`block-cache-source:${stage || 'upload'}`);
      return true;
    }

    function isUploadItemLocallyUnreadable(q) {
      if (!q) {
        return true;
      }

      if (hasReadableFreshLocalSource(q) || hasAttemptableUploadSource(q)) {
        return false;
      }

      if (isUploadSourceCacheForbidden(q)) {
        return true;
      }

      if (
        q.state === UploadState.MISSING_FILE
        || q.sourceKind === 'missing-file'
        || q.sourceKind === 'missing-local'
      ) {
        return true;
      }

      if (hasAttemptableUploadSource(q)) {
        return false;
      }

      return true;
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
          item.message = '全局文件已绑定，可在当前页上传';
          item.uploadName = '';
        }
      } else {
        item.state = normalizeUploadState(restoredState, true);
      }

      syncUploadItemSchemaInPlace(item);
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

      syncUploadItemSchemaInPlace(item);
      return true;
    }

    async function restoreUploadItemFromPersistRow(row, activeGroupId) {
      const safeRow = normalizeRestoreObject(row, 'persist-row');
      if (!isPlainObject(row)) {
        resetDirtyUploadRestoreState('invalid-persist-row', row);
        return null;
      }
      const restoredState = row.state || UploadState.IDLE;
      const handleKey = String(safeRow.handleKey || '').trim();
      let handle = safeRow.handle || null;
      if (!isFileHandleLike(handle) && handleKey) {
        handle = await loadUploadFileHandle(handleKey);
      }
      const persistedBlob = safeRow.blob || null;
      const hasBlob = isBlobLike(persistedBlob);
      const hasHandle = !!(handle && isFileHandleLike(handle));
      const persistedKind = String(safeRow.persistedKind || '').trim() || (
        hasHandle ? UploadPersistedKind.FILE_SYSTEM_HANDLE : UploadPersistedKind.METADATA_ONLY
      );

        const item = normalizeUploadItem({
          id: safeRow.id || newId(),
          groupId: safeRow.groupId || activeGroupId,
          name: safeRow.name || 'unknown',
          displayPath: safeRow.displayPath || safeRow.name || 'unknown',
          size: Number(safeRow.size) || 0,
          lastModified: Number(safeRow.lastModified) || 0,
          mimeType: safeRow.mimeType || safeRow.mime_type || safeRow.type || 'application/octet-stream',
          type: safeRow.type || safeRow.mime_type || 'application/octet-stream',
          downloadUrl: safeRow.downloadUrl || safeRow.download_url || '',
          file: null,
          blob: null,
          fileHandle: hasHandle ? handle : null,
          attachState: safeRow.attachState || safeRow.state || UploadState.IDLE,
          registryStatus: safeRow.registryStatus || safeRow.status || 'pending',
          composerPresence: safeRow.composerPresence || 'unbound',
          sendState: safeRow.sendState || 'idle',
          message: '',
          uploadName: safeRow.uploadName || '',
          manualPathNote: String(safeRow.manualPathNote || '').trim(),
          persistedAttached: false,
        attachedInSession: false,
        sourceKind: safeRow.sourceKind || '',
        readMode: safeRow.readMode || '',
        persistedKind,
        restoreState: UploadRestoreState.ERROR,
        handleKey,
        flaskPath: String(safeRow.flaskPath || ''),
      }, {
        groupId: activeGroupId,
      });

      let needsReDrag = false;

      if (persistedKind === UploadPersistedKind.FILE_SYSTEM_HANDLE && item.fileHandle) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][restore-row:handle] name=${item.name || '-'} handle=1`
        );
        try {
          const permission = typeof item.fileHandle.queryPermission === 'function'
            ? await item.fileHandle.queryPermission({ mode: 'read' })
            : 'granted';
          if (permission === 'granted') {
            const file = await item.fileHandle.getFile();
            if (isFileLike(file)) {
              item.file = file;
              item.sourceFile = file;
              item.originalFile = file;
              safeAssignRestoreState(item, UploadRestoreState.READY, 'restore-item:file-handle-ready');
              needsReDrag = restoreHandleBackedUploadItem(item, restoredState, hasBlob);
            } else {
              safeAssignRestoreState(item, UploadRestoreState.ERROR, 'restore-item:file-handle-error');
              needsReDrag = restoreMissingUploadItem(item, restoredState);
            }
          } else {
            safeAssignRestoreState(item, UploadRestoreState.PERMISSION_REQUIRED, 'restore-item:permission-required');
            item.state = UploadState.MISSING_FILE;
            item.message = '需要重新授权';
            needsReDrag = true;
          }
        } catch (e) {
          console.error('[ChatGPT toolbox] restore file handle item failed', e);
          safeAssignRestoreState(item, UploadRestoreState.ERROR, 'restore-item:handle-catch-error');
          item.state = UploadState.MISSING_FILE;
          item.message = `句柄恢复失败：${e && e.message ? e.message : String(e)}`;
          needsReDrag = true;
        }
      } else if (persistedKind === UploadPersistedKind.FLASK_REF) {
        safeAssignRestoreState(
          item,
          hasAttemptableUploadSource(item) ? UploadRestoreState.READY : UploadRestoreState.MISSING,
          'restore-item:flask-ref',
        );
        item.sourceKind = 'flask_local_direct';
        item.readMode = item.readMode || 'flask-local-direct';
        item.state = item.restoreState === UploadRestoreState.READY ? UploadState.IDLE : UploadState.MISSING_FILE;
        item.message = item.restoreState === UploadRestoreState.READY ? '' : '文件不存在';
      } else if (hasBlob) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][restore-row:blob-cache-forbidden] name=${item.name || '-'} blob=1 size=${item.size || 0}`,
        );

        item.sourceKind = safeRow.sourceKind || 'cached-snapshot';
        item.readMode = safeRow.readMode || 'indexeddb-blob';
        item.state = UploadState.MISSING_FILE;
        item.message = '需要重新选择';
        safeAssignRestoreState(item, UploadRestoreState.NEEDS_REBIND, 'restore-item:blob-needs-rebind');
        item.uploadName = '';
        item.persistedAttached = false;
        item.attachedInSession = false;
        needsReDrag = true;
      } else {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][restore-row:missing] name=${item.name || '-'} reason=no-handle-no-blob`
        );
        needsReDrag = restoreMissingUploadItem(item, restoredState);
        safeAssignRestoreState(item, UploadRestoreState.NEEDS_REBIND, 'restore-item:missing-needs-rebind');
      }

      if (!item.restoreState) {
        safeAssignRestoreState(
          item,
          needsReDrag ? UploadRestoreState.NEEDS_REBIND : UploadRestoreState.READY,
          'restore-item:final-default',
        );
      }
      syncUploadItemSchemaInPlace(item);

      console.debug('[ChatGPT toolbox] loadQueue row restore', {
        row: {
          id: safeRow.id,
          name: safeRow.name,
          state: safeRow.state,
          hasHandle: hasHandle ? 1 : 0,
          hasBlob: hasBlob ? 1 : 0,
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

      ToolboxShell.appendLog(
        `[UPLOAD_RESTORE][ITEM] id=${item.id || '-'} name=${item.name || '-'} kind=${item.persistedKind || '-'} restoreState=${item.restoreState || '-'}`
      );
      return item;
    }

    async function readFreshFile(q) {
      if (!q) {
        throw new Error('readFreshFile: empty queue item');
      }

      return resolveStrictLocalUploadFile(q, { source: 'readFreshFile' });
    }

    async function prepareFilesForAttach(files, source = '') {
      const list = Array.isArray(files) ? files.filter(Boolean) : [];
      const tag = String(source || '').trim() || 'unknown';

      // Fixed behavior: upload file name is already prepared by `createTimestampedUploadFile()` (virtualUploadName).
      ToolboxShell.appendLog(
        `[UPLOAD_FILE_NAME][PREPARE] source=${tag} count=${list.length}`,
      );

      return list;
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
        ToolboxShell.appendLog('[UPLOAD_DIAG][picker:before-open] mode=input-file multiple=0');

        input.click();
      });
    }

    function pickLocalFilesByInputMultiple() {
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

        function finishOk(files) {
          if (finished) return;
          finished = true;
          cleanup();

          const clean = Array.from(files || []).filter(Boolean);
          resolve(clean.map((file) => ({
            file,
            handle: null,
            source: 'input-file',
          })));
        }

        function finishFailed(err) {
          if (finished) return;
          finished = true;
          cleanup();
          reject(err);
        }

        function readSelectedFiles() {
          const files = input.files ? Array.from(input.files).filter(Boolean) : [];
          if (!files.length) {
            finishFailed(new Error('用户取消选择文件'));
            return;
          }
          finishOk(files);
        }

        function onWindowFocus() {
          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
          }

          focusCancelTimer = window.setTimeout(() => {
            focusCancelTimer = 0;

            if (finished) return;

            const files = input.files ? Array.from(input.files).filter(Boolean) : [];
            if (files.length) {
              finishOk(files);
              return;
            }

            finishFailed(new Error('用户取消选择文件'));
          }, 1200);
        }

        input.type = 'file';
        input.multiple = true;
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

          readSelectedFiles();
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

        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 multiple=1');
        input.click();
      });
    }

    async function pickLocalFilesWithHandlesForAdd() {
      const showOpenFilePicker = getShowOpenFilePickerFn();

      if (!showOpenFilePicker) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 supported=0 multiple=1');
        return pickLocalFilesByInputMultiple();
      }

      ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=file-system-access supported=1 multiple=1');

      let handles;
      try {
        handles = await showOpenFilePicker({
          multiple: true,
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

      const entries = [];
      const list = Array.isArray(handles) ? handles : [];
      for (const handle of list) {
        if (!handle || typeof handle.getFile !== 'function') {
          continue;
        }

        const file = await handle.getFile();
        if (!file) {
          continue;
        }

        entries.push({
          file,
          handle,
          source: 'file-system-access',
        });
      }

      if (!entries.length) {
        throw new Error('未选择到有效文件');
      }

      return entries;
    }

    async function pickOneLocalFileWithHandle() {
      const showOpenFilePicker = getShowOpenFilePickerFn();

      if (!showOpenFilePicker) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 supported=0');
        return pickOneLocalFileByInput();
      }

      ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=file-system-access supported=1');
      ToolboxShell.appendLog('[UPLOAD_DIAG][picker:before-open] mode=file-system-access multiple=0');

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

    function validateRebindFile(oldItem, newFile) {
      if (!(newFile instanceof File) && !isFileLike(newFile)) {
        return {
          ok: false,
          reason: 'not-file',
        };
      }
      const expectedName = String(oldItem && (oldItem.name || oldItem.filename) || '').trim();
      const actualName = String(newFile.name || '').trim();
      if (expectedName && actualName && expectedName !== actualName) {
        return {
          ok: false,
          reason: 'filename-mismatch',
          detail: `expected=${expectedName} actual=${actualName}`,
        };
      }
      const expectedSize = Number(oldItem && oldItem.size) || 0;
      const actualSize = Number(newFile.size) || 0;
      if (expectedSize > 0 && actualSize > 0 && expectedSize !== actualSize) {
        return {
          ok: false,
          reason: 'filesize-mismatch',
          detail: `expected=${expectedSize} actual=${actualSize}`,
        };
      }
      return {
        ok: true,
        reason: 'ok',
      };
    }

    function applyReboundFile(item, file, handle) {
      if (!item || !isFileLike(file)) {
        return false;
      }
      const hasHandle = isFileHandleLike(handle);
      item.file = file;
      item.sourceFile = file;
      item.originalFile = file;
      item.blob = file;
      item.sourceBlob = file;
      item.name = file.name || item.name || 'unknown';
      item.size = file.size || 0;
      item.type = file.type || item.type || 'application/octet-stream';
      item.lastModified = file.lastModified || Date.now();
      item.state = UploadState.IDLE;
      item.attachState = UploadState.IDLE;
      item.status = 'ready';
      item.registryStatus = 'ready';
      item.needsRebind = false;
      item.missingReason = '';
      item.message = '';
      item.error = '';
      item.lastError = '';
      if (hasHandle) {
        item.fileHandle = handle;
        item.sourceKind = 'local-handle';
        item.readMode = 'handle';
        item.persistedKind = UploadPersistedKind.FILE_SYSTEM_HANDLE;
        item.handleKey = buildUploadHandleKey(item);
      } else {
        item.fileHandle = null;
        item.sourceKind = 'browser_file';
        item.readMode = 'file';
        item.persistedKind = UploadPersistedKind.METADATA_ONLY;
        item.handleKey = '';
      }
      safeAssignRestoreState(item, UploadRestoreState.READY, 'rebind:applyReboundFile');
      item.uploadName = '';
      item.persistedAttached = false;
      item.attachedInSession = false;
      clearStaleUnreadableFlagsForReadableItem(item, 'applyReboundFile');
      syncUploadItemSchemaInPlace(item);
      ToolboxShell.appendLog(
        `[UPLOAD_REBIND][OK] id=${item.id || '-'} name=${item.name || '-'} size=${item.size || 0}`,
      );
      return true;
    }

    async function rebindUploadFile(id) {
      ToolboxShell.appendLog(`[UPLOAD_REBIND][START] id=${id || '-'}`);

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
        const picked = await pickOneLocalFileForRebind();
        const file = picked.file;
        const handle = picked.handle;

        if (!file) {
          throw new Error('重新绑定文件为空');
        }

        const validation = validateRebindFile(q, file);
        if (!validation.ok) {
          if (validation.reason === 'filename-mismatch') {
            const oldName = q.name || '';
            const ok = window.confirm(
              `重新选择的文件名和原记录不同。\n\n原文件：${oldName}\n新文件：${file.name}\n\n是否继续绑定？`,
            );
            if (!ok) {
              ToolboxShell.appendLog(
                `[UPLOAD_REBIND][FAILED] id=${id || '-'} name=${q.name || '-'} reason=${validation.reason} detail=${validation.detail || '-'}`,
              );
              setStatus('已取消重新绑定');
              return;
            }
          } else {
            ToolboxShell.appendLog(
              `[UPLOAD_REBIND][FAILED] id=${id || '-'} name=${q.name || '-'} reason=${validation.reason} detail=${validation.detail || '-'}`,
            );
            setStatus(`重新绑定失败：${validation.reason === 'filesize-mismatch' ? '文件大小不匹配' : '无效文件'}`);
            return;
          }
        }

        const hasHandle = isFileHandleLike(handle);

        if (!hasHandle) {
          q.fileHandle = null;
          q.file = null;
          q.sourceFile = null;
          q.originalFile = null;
          q.blob = null;
          q.sourceBlob = null;
          q.state = UploadState.MISSING_FILE;
          q.sourceKind = 'missing-file';
          q.readMode = '';
          q.message = '需要重新选择';
          q.persistedKind = UploadPersistedKind.METADATA_ONLY;
          safeAssignRestoreState(q, UploadRestoreState.NEEDS_REBIND, 'rebind:file-needs-rebind');
          q.handleKey = '';
          q.uploadName = '';
          q.persistedAttached = false;

          await awaitPersistQueueBriefly('rebindUploadFile:no-handle', 300);
          await refreshUploadGroupCounts();
          render();
          broadcastUploadGlobalStateChanged('rebind-file', {
            id,
            groupId: state.activeGroupId || '',
            success: false,
          });

          setStatus('重新绑定失败：未获得本地文件句柄，无法保证从磁盘读取');
          ToolboxShell.appendLog(`[UPLOAD_REBIND][FAILED] id=${id || '-'} name=${q.name || '-'} reason=no-handle`);
          return;
        }

        q.fileHandle = handle;

        let freshFile = null;
        try {
          freshFile = await handle.getFile();
        } catch (readErr) {
          const errText = readErr && readErr.message ? readErr.message : String(readErr);
          const errStack = readErr && readErr.stack ? readErr.stack : '';
          console.error('[UPLOAD_REBIND][ERROR]', readErr);
          ToolboxShell.appendLog(
            `[UPLOAD_REBIND][ERROR] id=${id || '-'} error=${errText} stack=${String(errStack).slice(0, 1200)}`,
          );
          markUploadItemNeedsRebind(q, errText, 'rebind:read-after-bind-failed');
          q.message = `重新绑定后读取失败：${errText}`;
          await awaitPersistQueueBriefly('rebindUploadFile:read-after-bind-failed', 300);
          await refreshUploadGroupCounts();
          render();
          setStatus(`重新绑定后读取失败：${errText}`);
          return;
        }
        if (!freshFile || Number(freshFile.size || 0) <= 0) {
          markUploadItemNeedsRebind(q, 'empty-after-bind', 'rebind:empty-after-bind');
          q.message = '重新绑定后文件为空或不可读';
          await awaitPersistQueueBriefly('rebindUploadFile:empty-after-bind', 300);
          await refreshUploadGroupCounts();
          render();
          setStatus('重新绑定失败：文件为空或不可读');
          ToolboxShell.appendLog(`[UPLOAD_REBIND][EMPTY_AFTER_BIND] id=${id || '-'} name=${q.name || '-'}`);
          return;
        }

        const reboundValidation = validateRebindFile(q, freshFile);
        if (!reboundValidation.ok && reboundValidation.reason !== 'filename-mismatch') {
          ToolboxShell.appendLog(
            `[UPLOAD_REBIND][FAILED] id=${id || '-'} name=${q.name || '-'} reason=${reboundValidation.reason} detail=${reboundValidation.detail || '-'}`,
          );
          setStatus(`重新绑定失败：${reboundValidation.reason === 'filesize-mismatch' ? '文件大小不匹配' : '无效文件'}`);
          return;
        }

        applyReboundFile(q, freshFile, handle);
        ToolboxShell.appendLog(
          `[UPLOAD_REBIND][STATE_READY] id=${id || '-'} name=${q.name || '-'} `
          + `sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} `
          + `state=${q.state || '-'} status=${q.status || '-'} `
          + `restoreState=${q.restoreState || '-'} handle=${hasLocalReadableHandle(q) ? 1 : 0}`,
        );

        await awaitPersistQueueBriefly('rebindUploadFile:ok', 300);
        await refreshUploadGroupCounts();

        render();
        broadcastUploadGlobalStateChanged('rebind-file', {
          id,
          groupId: state.activeGroupId || '',
          success: true,
        });

        setStatus(`已重新绑定文件：${q.name}`);
        ToolboxShell.appendLog(`[UPLOAD_REBIND][MATCH_OK] id=${id || '-'} name=${q.name || '-'} size=${q.size || 0}`);
        ToolboxShell.appendLog(`[UPLOAD_REBIND][DONE] id=${id || '-'} source=${picked.source || '-'} handle=${hasHandle ? 1 : 0}`);
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
        ToolboxShell.appendLog(`[UPLOAD_REBIND][FAILED] id=${id || '-'} error=${errText}`);
      }
    }

    async function requestUploadFilePermission(id) {
      if (!id) return;
      const q = getActiveGroupFiles().find((item) => item && item.id === id);
      if (!q) return;
      ToolboxShell.appendLog(`[UPLOAD_HANDLE][REQUEST_PERMISSION] id=${id || '-'} name=${q.name || '-'}`);
      try {
        const handle = q.fileHandle || await loadUploadFileHandle(String(q.handleKey || ''));
        if (!isFileHandleLike(handle)) {
          safeAssignRestoreState(q, UploadRestoreState.MISSING, 'rebind:file-missing');
          q.state = UploadState.MISSING_FILE;
          q.message = '文件句柄不存在';
          await awaitPersistQueueBriefly('requestUploadFilePermission:missing-handle', 300);
          render();
          ToolboxShell.appendLog(`[UPLOAD_HANDLE][GET_FILE_FAILED] id=${id || '-'} reason=missing-handle`);
          return;
        }
        q.fileHandle = handle;
        const permission = typeof handle.requestPermission === 'function'
          ? await handle.requestPermission({ mode: 'read' })
          : 'granted';
        if (permission !== 'granted') {
          safeAssignRestoreState(q, UploadRestoreState.PERMISSION_REQUIRED, 'rebind:file-permission-required');
          q.state = UploadState.MISSING_FILE;
          q.message = '需要重新授权';
          await awaitPersistQueueBriefly('requestUploadFilePermission:permission-denied', 300);
          render();
          ToolboxShell.appendLog(`[UPLOAD_HANDLE][PERMISSION_DENIED] id=${id || '-'} name=${q.name || '-'}`);
          return;
        }
        ToolboxShell.appendLog(`[UPLOAD_HANDLE][PERMISSION_GRANTED] id=${id || '-'} name=${q.name || '-'}`);
        const file = await handle.getFile();
        if (!isFileLike(file)) {
          throw new Error('getFile 返回空文件');
        }
        q.file = file;
        q.sourceFile = file;
        q.originalFile = file;
        q.blob = file;
        q.sourceBlob = file;
        safeAssignRestoreState(q, UploadRestoreState.READY, 'rebind:file-ready-final');
        q.persistedKind = UploadPersistedKind.FILE_SYSTEM_HANDLE;
        q.state = UploadState.IDLE;
        q.message = '';
        await awaitPersistQueueBriefly('requestUploadFilePermission:ok', 300);
        render();
        ToolboxShell.appendLog(`[UPLOAD_HANDLE][GET_FILE_OK] id=${id || '-'} name=${q.name || '-'} size=${q.size || 0}`);
      } catch (err) {
        console.error('[ChatGPT toolbox] requestUploadFilePermission failed', err);
        safeAssignRestoreState(q, UploadRestoreState.ERROR, 'rebind:file-error');
        q.state = UploadState.MISSING_FILE;
        q.message = `授权读取失败：${err && err.message ? err.message : String(err)}`;
        await awaitPersistQueueBriefly('requestUploadFilePermission:failed', 300);
        render();
        ToolboxShell.appendLog(`[UPLOAD_HANDLE][GET_FILE_FAILED] id=${id || '-'} error=${err && err.message ? err.message : String(err)}`);
      }
    }

    function throwStrictCacheForbidden(item, callerSource = '') {
      markCacheForbiddenUploadItems([item], callerSource || 'strict-local-file');
      const err = new Error(STRICT_UPLOAD_CACHE_FORBIDDEN_MESSAGE);
      console.error('[ChatGPT toolbox] resolveStrictLocalUploadFile: cache forbidden', {
        name: err.name,
        message: err.message,
        stack: err.stack,
        callerSource,
        itemName: item && (item.name || item.filename) ? (item.name || item.filename) : '-',
      });
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][readFreshFile:cache-forbidden] stage=${callerSource || '-'} name=${item && (item.name || item.filename) ? (item.name || item.filename) : '-'} sourceKind=${item && item.sourceKind ? item.sourceKind : '-'} readMode=${item && item.readMode ? item.readMode : '-'}`,
      );
      throw err;
    }

    function resolveFlaskLocalDirectDownloadUrl(q) {
      const direct = String(
        typeof q.download_url === 'string' ? q.download_url : '',
      ).trim();
      if (direct) {
        return direct;
      }

      const fileId = String(q.file_id || '').trim();
      if (!fileId) {
        return '';
      }

      let base = 'http://127.0.0.1:5000';
      if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.get === 'function') {
        const stored = String(MemoryManager.get('bridgeBaseUrl', base) || '').trim();
        if (stored) {
          base = stored;
        }
      }

      return `${base.replace(/\/$/, '')}/api/upload_files/${encodeURIComponent(fileId)}/content`;
    }

    function hasStrictLocalCachePayload(item) {
      if (!item) {
        return false;
      }

      return !!(
        isFileLike(item.file)
        || isFileLike(item.sourceFile)
        || isFileLike(item.originalFile)
        || isBlobLike(item.blob)
        || isBlobLike(item.sourceBlob)
      );
    }

    async function resolveStrictLocalUploadFile(item, options = {}) {
      const callerSource = String(options.source || 'resolveStrictLocalUploadFile').trim()
        || 'resolveStrictLocalUploadFile';
      const itemName = item && (item.name || item.filename)
        ? (item.name || item.filename)
        : '-';

      ToolboxShell.appendLog(
        `[UPLOAD_STRICT_SOURCE][ENTER] source=${callerSource} name=${itemName}`,
      );

      if (!item) {
        throw new Error(`${callerSource}: empty queue item`);
      }

      if (item.fileHandle && typeof item.fileHandle.getFile === 'function') {
        try {
          const fresh = await item.fileHandle.getFile();

          if (fresh && fresh.size >= 0) {
            item.file = fresh;
            item.blob = fresh;
            item.name = fresh.name || item.name;
            item.size = fresh.size;
            item.type = fresh.type || item.type || 'application/octet-stream';
            item.lastModified = fresh.lastModified || item.lastModified;
            item.sourceKind = 'local-handle';
            item.readMode = 'handle';
            item.message = '';

            ToolboxShell.appendLog(
              `[UPLOAD_FILE][USE_FILE_HANDLE] name=${item.name || '-'} size=${item.size || 0}`,
            );

            return fresh;
          }
        } catch (e) {
          const errName = e && e.name ? e.name : 'Error';
          const errText = e && e.message ? e.message : String(e);
          const errStack = e && e.stack ? e.stack : '-';

          console.error('[ChatGPT toolbox] resolveStrictLocalUploadFile: fileHandle.getFile failed', e);

          item.message = '文件句柄读取失败，无法从磁盘读取最新文件';
          item.state = UploadState.MISSING_FILE;
          item.sourceKind = 'missing-file';
          item.readMode = '';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][strict-local-file:handle-failed] source=${callerSource} name=${itemName} error.name=${errName} error.message=${errText} stack=${errStack}`,
          );

          throw new Error('文件句柄读取失败，无法保证从磁盘读取最新文件 ' + itemName);
        }

        item.state = UploadState.MISSING_FILE;
        item.sourceKind = 'missing-file';
        item.readMode = '';
        item.message = '文件句柄读取返回空文件';

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][strict-local-file:handle-invalid] source=${callerSource} name=${itemName}`,
        );

        throw new Error('文件句柄读取返回空文件，无法保证从磁盘读取最新文件 ' + itemName);
      }

      const isFlaskDirect = isFlaskLocalDirectSource(item) || isFlaskLocalDirectItem(item);
      if (isFlaskDirect) {
        const fileName = item.name || item.filename || 'upload.bin';
        const localDirectUrl = resolveFlaskLocalDirectDownloadUrl(item);

        if (!localDirectUrl) {
          throw new Error(`文件缺少 download_url/file_id，无法从 Flask 本地直读：${fileName}`);
        }

        item.source = item.source || 'flask_local_direct';
        item.sourceKind = 'flask_local_direct';
        item.readMode = item.readMode || 'flask-local-direct';

        const response = await fetch(localDirectUrl, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(
            `Flask 本地直读失败：${response.status} ${response.statusText} ${fileName}`,
          );
        }

        const blob = await response.blob();
        if (!blob || Number(blob.size) <= 0) {
          throw new Error(`Flask 本地直读返回空文件：${fileName}`);
        }

        const freshFile = new File(
          [blob],
          fileName,
          {
            type: item.mime_type || item.type || blob.type || 'application/octet-stream',
            lastModified: item.lastModified || Date.now(),
          },
        );

        item.file = freshFile;
        item.blob = freshFile;
        item.size = freshFile.size;
        item.type = freshFile.type || item.type || 'application/octet-stream';
        item.message = '';

        ToolboxShell.appendLog(
          `[UPLOAD_FILE][USE_FLASK_LOCAL_DIRECT] name=${fileName} size=${freshFile.size || 0} file_id=${item.file_id || '-'} url=${localDirectUrl}`,
        );

        return freshFile;
      }

      if (isUploadSourceCacheForbidden(item) || hasStrictLocalCachePayload(item)) {
        throwStrictCacheForbidden(item, callerSource);
      }

      item.state = UploadState.MISSING_FILE;
      item.sourceKind = 'missing-file';
      item.readMode = '';
      item.message = '缺少文件句柄，无法从磁盘读取最新文件';

      ToolboxShell.appendLog(
        `[UPLOAD_FILE][NEED_REBIND] name=${itemName}`,
      );
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][strict-local-file:missing-handle] source=${callerSource} name=${itemName}`,
      );

      throw new Error('缺少文件句柄，无法从磁盘读取最新文件，缺少可读取的文件对象 ' + itemName);
    }

      return {
      isFileHandleLike,
      getPageWindowForFilePicker,
      getShowOpenFilePickerFn,
      buildUploadHandleKey,
      hasActuallyReusableUploadSource,
      hasReusableUploadSourceForReset,
      markUploadItemNeedsRebind,
      ensureReusableFileForUploadItem,
      getPendingUploadItemsForStart,
      diagnoseNoPendingUploadItems,
      resolveNoPendingUploadResult,
      canReadFromLocal,
      isUploadItemAttemptable,
      hasAttemptableUploadSource,
      getUploadLocalFileDiagnostics,
      hasReadableFreshLocalSource,
      clearStaleUnreadableFlagsForReadableItem,
      hasLocalReadableHandle,
      isUploadSourceCacheForbidden,
      isCachedUploadSnapshot,
      markCacheForbiddenUploadItems,
      blockUploadIfCacheSourcesPresent,
      isUploadItemLocallyUnreadable,
      restoreHandleBackedUploadItem,
      restoreMissingUploadItem,
      restoreUploadItemFromPersistRow,
      readFreshFile,
      prepareFilesForAttach,
      pickOneLocalFileByInput,
      pickLocalFilesByInputMultiple,
      pickLocalFilesWithHandlesForAdd,
      pickOneLocalFileWithHandle,
      pickOneLocalFileForRebind,
      validateRebindFile,
      applyReboundFile,
      rebindUploadFile,
      requestUploadFilePermission,
      throwStrictCacheForbidden,
      resolveFlaskLocalDirectDownloadUrl,
      hasStrictLocalCachePayload,
      resolveStrictLocalUploadFile,
      };
    }

    return { create };
  })();
