  /********************************************************************
   * UploadQueueStore：上传队列状态（不含 UI / 上传执行）
   ********************************************************************/

  const UploadQueueStore = (() => {
    function create(deps) {
      const state = deps.state;
      const appendUploadLog = deps.appendUploadLog;
      const isUploadDebugEnabled = deps.isUploadDebugEnabled;
      const normalizeUploadCompareName = deps.normalizeUploadCompareName;
      const resolveUploadAttachmentPresenceLevel = deps.resolveUploadAttachmentPresenceLevel;
      const findUploadGroupById = deps.findUploadGroupById;
      const getActiveGroup = deps.getActiveGroup;
      const getUploadGroupStableKey = deps.getUploadGroupStableKey;
      const getUploadFileFolderKey = deps.getUploadFileFolderKey;
      const saveMultiUploadLastSelection = deps.saveMultiUploadLastSelection;
      const getMultiUploadLastSelection = deps.getMultiUploadLastSelection;
      const logMultiUploadLastSelectionEvent = deps.logMultiUploadLastSelectionEvent;
      const isFlaskLocalDirectItem = deps.isFlaskLocalDirectItem;
      const hasReusableUploadSourceForReset = deps.hasReusableUploadSourceForReset;
      const hasAttemptableUploadSource = deps.hasAttemptableUploadSource;
      const newId = deps.newId;
      const logDirtyRestoreEntry = deps.logDirtyRestoreEntry;
      const getRestoreDirtyValueText = deps.getRestoreDirtyValueText;
      const setLastRestoreWarning = deps.setLastRestoreWarning;
      const isPlainObject = deps.isPlainObject;
      const normalizeRestoreArray = deps.normalizeRestoreArray;
      const UploadState = deps.UploadState;
      const UploadRestoreState = deps.UploadRestoreState;
      const UploadPersistedKind = deps.UploadPersistedKind;

      [
        ['UploadState', UploadState],
        ['UploadRestoreState', UploadRestoreState],
        ['UploadPersistedKind', UploadPersistedKind],
      ].forEach(([name, value]) => {
        const ok =
          typeof value === 'object'
          || typeof value === 'string'
          || typeof value === 'number'
          || typeof value === 'boolean'
          || typeof value === 'function';
        if (!ok) {
          throw new Error(`UploadQueueStore missing dependency: ${name}`);
        }
      });

    function sanitizePersistedUploadRows(rows, activeGroupId) {
      const safeRows = normalizeRestoreArray(rows, 'loadQueueForActiveGroup.rows');
      const scopedRows = [];
      let skippedNonObjectCount = 0;

      safeRows.forEach((row, index) => {
        if (!isPlainObject(row)) {
          skippedNonObjectCount += 1;
          logDirtyRestoreEntry('SKIP_INVALID_ROW', {
            index,
            actualType: row === null ? 'null' : typeof row,
            value: getRestoreDirtyValueText(row),
          });
          return;
        }

        const groupId = String(row.groupId || '').trim();
        if (groupId !== activeGroupId) {
          return;
        }

        scopedRows.push(row);
      });

      if (skippedNonObjectCount > 0) {
        setLastRestoreWarning(`上传队列中跳过了 ${skippedNonObjectCount} 条损坏记录`, {
          reason: 'load-queue-skip-invalid-rows',
          clearFailedStatus: true,
        });
      }

      return {
        scopedRows,
        skippedNonObjectCount,
      };
    }

    function getActiveGroupId() {
      return String(state.activeGroupId || '').trim();
    }

    function getLocalUploadFileCount() {
      const activeFiles = getActiveGroupFiles().length;
      const uploadItems = Array.isArray(state.queue) ? state.queue.length : 0;
      const groupFiles = getActiveGroupFiles().length;
      return Math.max(activeFiles, uploadItems, groupFiles);
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

    function getUploadItemGroupId(item) {
      if (!item) return '';
      return String(
        item.groupId
        || item.uploadActiveGroupId
        || item.upload_active_group_id
        || item.projectGroupId
        || ''
      ).trim();
    }

    function normalizeUploadRegistryStatus(value, item = null) {
      const text = String(value || '').trim().toLowerCase();
      if (!text) {
        if (item && isFlaskLocalDirectItem(item)) {
          return 'registered';
        }
        return 'pending';
      }
      if (['registered', 'pending', 'missing', 'failed', 'permission_required', 'needs_rebind'].includes(text)) {
        return text;
      }
      if (text === 'uploaded' || text === 'attached' || text === 'done') {
        return 'registered';
      }
      if (text === 'pending_confirm') {
        return 'registered';
      }
      return text;
    }

    function normalizeUploadAttachState(rawState, item = null) {
      const normalized = typeof UploadStateUtils !== 'undefined' && UploadStateUtils
        && typeof UploadStateUtils.normalize === 'function'
        ? UploadStateUtils.normalize(rawState, UploadState.IDLE)
        : String(rawState || '').trim() || UploadState.IDLE;
      if (normalized === UploadState.IDLE && item && String(item.status || '').trim().toLowerCase() === 'pending_confirm') {
        return UploadState.ATTACHING;
      }
      return normalized;
    }

    function normalizeUploadComposerPresence(value, item = null) {
      const text = String(value || '').trim().toLowerCase();
      if (['composer-attached', 'conversation-sent', 'local-bound', 'unbound'].includes(text)) {
        return text;
      }
      if (item && typeof resolveUploadAttachmentPresenceLevel === 'function') {
        return resolveUploadAttachmentPresenceLevel(item);
      }
      return 'unbound';
    }

    function normalizeUploadSendState(value, item = null) {
      const text = String(value || '').trim().toLowerCase();
      if (['idle', 'sent', 'pending', 'failed', 'cancelled'].includes(text)) {
        return text;
      }
      const presence = item && typeof resolveUploadAttachmentPresenceLevel === 'function'
        ? resolveUploadAttachmentPresenceLevel(item)
        : 'unbound';
      if (presence === 'conversation-sent') {
        return 'sent';
      }
      return 'idle';
    }

    function applyUnifiedUploadAliases(target) {
      if (!target || typeof target !== 'object') {
        return target;
      }
      const restoreStateEnum = UploadRestoreState;
      const uploadStateEnum = UploadState;
      if (!restoreStateEnum || typeof restoreStateEnum !== 'object') {
        throw new Error('UploadQueueStore: UploadRestoreState is not injected');
      }
      if (!uploadStateEnum || typeof uploadStateEnum !== 'object') {
        throw new Error('UploadQueueStore: UploadState is not injected');
      }
      target.type = target.mimeType || target.type || 'application/octet-stream';
      target.mime_type = target.mimeType || target.mime_type || target.type || 'application/octet-stream';
      target.state = target.attachState || target.state || uploadStateEnum.IDLE;
      target.status = target.registryStatus || target.status || 'pending';
      target.download_url = target.downloadUrl || target.download_url || '';
      const restoreStateText = String(target.restoreState || '').trim().toLowerCase();
      const registryStatusText = String(target.registryStatus || target.status || '').trim().toLowerCase();
      const attachStateText = String(target.attachState || target.state || '').trim();
      target.needsRebind = !!(
        target.needsRebind === true
        || restoreStateText === restoreStateEnum.NEEDS_REBIND
        || registryStatusText === 'needs_rebind'
        || attachStateText === uploadStateEnum.NEEDS_REBIND
        || attachStateText === uploadStateEnum.MISSING_FILE
      );
      if (!String(target.missingReason || '').trim() && target.needsRebind) {
        target.missingReason = String(target.message || '').trim() || 'page-reloaded-file-object-lost';
      }
      return target;
    }

    function syncUploadItemSchemaInPlace(target) {
      if (!target || typeof target !== 'object') {
        return target;
      }
      const normalized = normalizeUploadItem(target, {
        groupId: getUploadItemGroupId(target) || state.activeGroupId,
      });
      Object.assign(target, normalized);
      return target;
    }

    function normalizeUploadItem(rawItem, options = {}) {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const fallbackGroupId = String(options.groupId || options.fallbackGroupId || getActiveGroupId() || '').trim();
      let normalizedName = String(item.name || item.filename || item.fileName || '').trim();
      if (normalizedName.includes('|')) {
        normalizedName = normalizedName.split('|')[0].trim();
      }
      normalizedName = normalizedName.replace(/\\/g, '/');
      const nameParts = normalizedName.split('/').filter(Boolean);
      if (nameParts.length > 0) {
        normalizedName = nameParts[nameParts.length - 1].trim();
      }
      const normalizedMimeType = String(item.mimeType || item.mime_type || item.type || '').trim();
      const normalizedDownloadUrl = String(item.downloadUrl || item.download_url || '').trim();
      const normalizedFlaskPath = String(item.flaskPath || '').trim();
      const normalizedGroupId = getUploadItemGroupId(item) || fallbackGroupId;
      const normalizedSourceKind = String(
        item.sourceKind
        || item.source
        || item.origin
        || item.kind
        || (item.file_id || normalizedDownloadUrl || normalizedFlaskPath ? 'flask_local_direct' : '')
        || 'browser_file',
      ).trim();
      const normalizedReadMode = String(item.readMode || '').trim();
      const normalizedHandleKey = String(item.handleKey || '').trim();
      const normalizedUploadName = String(item.uploadName || '').trim();
      const normalizedManualPathNote = String(item.manualPathNote || '').trim();
      const normalizedRestoreState = item.restoreState || '';
      const normalizedPersistedKind = String(item.persistedKind || '').trim();
      const attachState = normalizeUploadAttachState(item.attachState != null ? item.attachState : item.state, item);
      const composerPresence = normalizeUploadComposerPresence(item.composerPresence, item);
      const sendState = normalizeUploadSendState(item.sendState, item);
      const registryStatus = normalizeUploadRegistryStatus(
        item.registryStatus != null ? item.registryStatus : item.status,
        item,
      );

      const normalized = {
        ...item,
        id: item.id || item.file_id || newId(),
        name: normalizedName || 'unknown',
        mimeType: normalizedMimeType || 'application/octet-stream',
        downloadUrl: normalizedDownloadUrl,
        displayPath: String(item.displayPath || item.name || item.filename || item.fileName || '').trim(),
        size: Number(item.size) || 0,
        lastModified: Number(item.lastModified) || 0,
        groupId: normalizedGroupId,
        sourceKind: normalizedSourceKind,
        readMode: normalizedReadMode,
        registryStatus,
        attachState,
        composerPresence,
        sendState,
        restoreState: normalizedRestoreState,
        persistedKind: normalizedPersistedKind,
        handleKey: normalizedHandleKey,
        flaskPath: normalizedFlaskPath,
        uploadName: normalizedUploadName,
        manualPathNote: normalizedManualPathNote,
        message: String(item.message || '').trim(),
        file: item.file || null,
        blob: item.blob || null,
        fileHandle: item.fileHandle || null,
        persistedAttached: !!item.persistedAttached,
        attachedInSession: !!item.attachedInSession,
      };

      if (!normalized.uploadActiveGroupId) {
        normalized.uploadActiveGroupId = normalized.groupId;
      }

      applyUnifiedUploadAliases(normalized);
      logNormalizedUploadItem(normalized);
      return normalized;
    }

    function getUploadGroupById(groupId) {
      if (typeof findUploadGroupById === 'function') {
        return findUploadGroupById(groupId);
      }
      const gid = String(groupId || '').trim();
      if (!gid) return null;
      return (state.groups || []).find((group) => group && group.id === gid) || null;
    }

    function getActiveUploadScopeGroupId(options = {}) {
      const opts = options && typeof options === 'object' ? options : {};
      const groupId = String(opts.groupId || opts.scopeGroupId || getActiveGroupId() || '').trim();
      return groupId;
    }

    function isUploadItemInActiveScope(item, groupId) {
      if (!item) return false;
      const scopeGroupId = String(groupId || getActiveGroupId() || '').trim();
      if (!scopeGroupId) return true;
      const itemGroupId = getUploadItemGroupId(item);
      if (itemGroupId) {
        return itemGroupId === scopeGroupId;
      }
      if (typeof isFlaskLocalDirectItem === 'function' && isFlaskLocalDirectItem(item)) {
        return isFlaskUploadGroupId(scopeGroupId);
      }
      return false;
    }

    function getScopedQueueItemsForUpload(groupId) {
      const scopeGroupId = String(groupId || getActiveGroupId() || '').trim();
      return (state.queue || []).filter((item) => isUploadItemInActiveScope(item, scopeGroupId));
    }

    function getScopedFlaskFilesForUpload(groupId) {
      const scopeGroupId = String(groupId || getActiveGroupId() || '').trim();
      return (state.flaskFiles || []).filter((item) => isUploadItemInActiveScope(item, scopeGroupId));
    }

    function hasActiveScopeUploadableFiles(options = {}) {
      const groupId = getActiveUploadScopeGroupId(options);
      const queueFiles = getScopedQueueItemsForUpload(groupId).filter((item) => {
        if (!item) return false;
        if (typeof hasReusableUploadSourceForReset === 'function' && hasReusableUploadSourceForReset(item)) {
          return true;
        }
        if (typeof hasAttemptableUploadSource === 'function' && hasAttemptableUploadSource(item)) {
          return true;
        }
        return false;
      });
      const flaskFiles = getScopedFlaskFilesForUpload(groupId).filter((item) => {
        if (!item) return false;
        return typeof isFlaskLocalDirectItem === 'function' && isFlaskLocalDirectItem(item);
      });
      return queueFiles.length + flaskFiles.length > 0;
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

    function isFlaskUploadGroupId(groupId) {
      const group = getUploadGroupById(groupId);
      if (!group) return false;
      const stableKey = typeof getUploadGroupStableKey === 'function'
        ? String(getUploadGroupStableKey(group) || '').trim()
        : '';
      const name = String(group.name || group.title || '').trim();
      const lowerName = name.toLowerCase();
      return (
        stableKey === 'youhou-flask'
        || stableKey === 'flask'
        || name.includes('油猴flask')
        || lowerName.includes('flask')
      );
    }

    function logNormalizedUploadItem(item) {
      if (!item) {
        return;
      }
      appendUploadSchemaAuditLog('UPLOAD_ITEM_NORMALIZED', item);
    }

    function getUploadItemSchemaAuditData(item) {
      const normalized = item && typeof item === 'object' ? item : {};
      return {
        id: normalized.id || '',
        name: normalized.name || '',
        groupId: normalized.groupId || '',
        mimeType: normalized.mimeType || '',
        downloadUrl: normalized.downloadUrl || '',
        flaskPath: normalized.flaskPath || '',
        registryStatus: normalized.registryStatus || '',
        attachState: normalized.attachState || '',
        composerPresence: normalized.composerPresence || '',
        sendState: normalized.sendState || '',
        restoreState: normalized.restoreState || '',
        persistedKind: normalized.persistedKind || '',
      };
    }

    function appendUploadSchemaAuditLog(tag, item) {
      if (!isUploadDebugEnabled || !isUploadDebugEnabled()) {
        return;
      }
      const audit = getUploadItemSchemaAuditData(item);
      const line = [
        `[STATE_SCHEMA][${tag}]`,
        `id=${audit.id || '-'}`,
        `name=${audit.name || '-'}`,
        `groupId=${audit.groupId || '-'}`,
        `mimeType=${audit.mimeType || '-'}`,
        `downloadUrl=${audit.downloadUrl || '-'}`,
        `flaskPath=${audit.flaskPath || '-'}`,
        `registryStatus=${audit.registryStatus || '-'}`,
        `attachState=${audit.attachState || '-'}`,
        `composerPresence=${audit.composerPresence || '-'}`,
        `sendState=${audit.sendState || '-'}`,
        `restoreState=${audit.restoreState || '-'}`,
        `persistedKind=${audit.persistedKind || '-'}`,
      ].join(' ');
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(
          `STATE_SCHEMA:${tag}:${audit.id || audit.name || '-'}`,
          Object.values(audit).join('|'),
          line,
          1500,
        );
      } else if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.log(line);
      }
    }

      return {
      sanitizePersistedUploadRows,
      getActiveGroupId,
      getLocalUploadFileCount,
      getActiveGroupFiles,
      getUploadItemGroupId,
      normalizeUploadRegistryStatus,
      normalizeUploadAttachState,
      normalizeUploadComposerPresence,
      normalizeUploadSendState,
      applyUnifiedUploadAliases,
      syncUploadItemSchemaInPlace,
      normalizeUploadItem,
      getUploadGroupById,
      getActiveUploadScopeGroupId,
      isUploadItemInActiveScope,
      getScopedQueueItemsForUpload,
      getScopedFlaskFilesForUpload,
      hasActiveScopeUploadableFiles,
      getSelectedFileIdForActiveGroup,
      setSelectedFileIdForActiveGroup,
      resolveSelectedFileIdForGroup,
      syncActiveGroupSelectionAfterQueueLoad,
      saveMultiUploadSelectionForActiveGroup,
      isFlaskUploadGroupId,
      getUploadItemSchemaAuditData,
      appendUploadSchemaAuditLog,
      };
    }

    return { create };
  })();


