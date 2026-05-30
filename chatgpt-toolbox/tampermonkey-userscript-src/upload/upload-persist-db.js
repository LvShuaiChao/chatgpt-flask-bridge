  /********************************************************************
   * UploadPersistDb：上传队列 IndexedDB / localStorage 持久化
   ********************************************************************/

  const UploadPersistDb = (() => {
    function create(deps) {
      const state = deps.state;
      const appendUploadLog = deps.appendUploadLog;
      const refs = deps.refs;
      const UPLOAD_DB_MAX_GROUPS = deps.UPLOAD_DB_MAX_GROUPS;
      const UPLOAD_DB_MAX_QUEUE_ROWS = deps.UPLOAD_DB_MAX_QUEUE_ROWS;
      const UPLOAD_DB_EMPTY_GROUP_TTL_MS = deps.UPLOAD_DB_EMPTY_GROUP_TTL_MS;
      const UPLOAD_DB_FAILED_ROW_TTL_MS = deps.UPLOAD_DB_FAILED_ROW_TTL_MS;
      const getActiveGroupId = deps.getActiveGroupId;
      const getActiveGroupFiles = deps.getActiveGroupFiles;
      const getUploadItemGroupId = deps.getUploadItemGroupId;
      const normalizeUploadItem = deps.normalizeUploadItem;
      const sanitizePersistedUploadRows = deps.sanitizePersistedUploadRows;
      const syncUploadItemSchemaInPlace = deps.syncUploadItemSchemaInPlace;
      const restoreUploadItemFromPersistRow = deps.restoreUploadItemFromPersistRow;
      const buildUploadHandleKey = deps.buildUploadHandleKey;
      const isFileHandleLike = deps.isFileHandleLike;
      const getQueueRestorePhase = deps.getQueueRestorePhase;
      const shouldAllowEmptyQueuePersist = deps.shouldAllowEmptyQueuePersist;
      const mergeActiveGroupQueueFromMemory = deps.mergeActiveGroupQueueFromMemory;
      const setQueueRestorePhase = deps.setQueueRestorePhase;
      const syncActiveGroupSelectionAfterQueueLoad = deps.syncActiveGroupSelectionAfterQueueLoad;
      const isPlainObject = deps.isPlainObject;
      const normalizeRestoreArray = deps.normalizeRestoreArray;
      const normalizeRestoreObject = deps.normalizeRestoreObject;
      const logDirtyRestoreEntry = deps.logDirtyRestoreEntry;
      const getRestoreDirtyValueText = deps.getRestoreDirtyValueText;
      const setLastRestoreWarning = deps.setLastRestoreWarning;
      const resetDirtyUploadRestoreState = deps.resetDirtyUploadRestoreState;
      const isInvalidRestoreStateError = deps.isInvalidRestoreStateError;
      const safeAssignRestoreState = deps.safeAssignRestoreState;
      const uploadTimers = deps.uploadTimers;
      const renderUploadListOnly = deps.renderUploadListOnly;
      const refreshUploadGroupCounts = deps.refreshUploadGroupCounts;
      const isUploadListDebugEnabled = deps.isUploadListDebugEnabled;
      const isBlobLike = deps.isBlobLike;
      const getObjectTag = deps.getObjectTag;
      const isUploadDebugEnabled = deps.isUploadDebugEnabled;
      const ensureUploadGroupStableKeys = deps.ensureUploadGroupStableKeys;
      const createDefaultGroup = deps.createDefaultGroup;
      const resolveUploadGroupSelection = deps.resolveUploadGroupSelection;
      const ensureActiveUploadGroupIdValid = deps.ensureActiveUploadGroupIdValid;
      const syncUploadGroupAppState = deps.syncUploadGroupAppState;
      const appendUploadGroupLog = deps.appendUploadGroupLog;
      const scheduleRenderUpload = deps.scheduleRenderUpload;
      const setStatus = deps.setStatus;
      const migrateLegacyUploadSelectionIfNeeded = deps.migrateLegacyUploadSelectionIfNeeded;
      const getToolboxPageState = deps.getToolboxPageState;
      const saveGlobalUploadActiveGroupId = deps.saveGlobalUploadActiveGroupId;
      const saveUploadLastActiveGroupId = deps.saveUploadLastActiveGroupId;
      const dedupeActiveGroupQueue = deps.dedupeActiveGroupQueue;
      const migrateMissingGroupIdRows = deps.migrateMissingGroupIdRows;
      const isStaleFailedUploadRow = deps.isStaleFailedUploadRow;
      const UploadPersistedKind = deps.UploadPersistedKind;
      const UploadRestoreState = deps.UploadRestoreState;
      const UPLOAD_HANDLE_DB_NAME = deps.UPLOAD_HANDLE_DB_NAME;
      const UPLOAD_HANDLE_STORE = deps.UPLOAD_HANDLE_STORE;
      const UPLOAD_HANDLE_DB_VERSION = deps.UPLOAD_HANDLE_DB_VERSION;
      const UPLOAD_PERSIST_TIMEOUT_MS = deps.UPLOAD_PERSIST_TIMEOUT_MS;
      const hasAttemptableUploadSource = deps.hasAttemptableUploadSource;
      const hasAttachmentEvidenceForItem = deps.hasAttachmentEvidenceForItem;
      const shouldPreserveMissingOrFailedState = deps.shouldPreserveMissingOrFailedState;
      const isUploadUnfinishedState = deps.isUploadUnfinishedState;
      const normalizeUploadState = deps.normalizeUploadState;
      const isFlaskLocalDirectSource = deps.isFlaskLocalDirectSource;
      const isFlaskLocalDirectItem = deps.isFlaskLocalDirectItem;
      const isFileLike = deps.isFileLike;
      const isPersistUploadBlobEnabled = deps.isPersistUploadBlobEnabled;
      const getUploadItemSizeBytes = deps.getUploadItemSizeBytes;
      const normalizeUploadRegistryStatus = deps.normalizeUploadRegistryStatus;
      const appendUploadSchemaAuditLog = deps.appendUploadSchemaAuditLog;
      const broadcastUploadGlobalStateChanged = deps.broadcastUploadGlobalStateChanged;
      const isProtectedUploadGroup = deps.isProtectedUploadGroup;
      const syncActiveGroupCountInCache = deps.syncActiveGroupCountInCache;
      const logSlowOperation = deps.logSlowOperation;
      const withTimeout = deps.withTimeout;
      const sleep = deps.sleep;
      const renderProjectCategoryChips = deps.renderProjectCategoryChips;
      const renderManageGroupList = deps.renderManageGroupList;
      const isComposerAttachmentReadyForUserVisibleUpload = deps.isComposerAttachmentReadyForUserVisibleUpload;
      const clearUploadFailureStatusIndicators = deps.clearUploadFailureStatusIndicators;
      const reconcileIdleUploadFailureState = deps.reconcileIdleUploadFailureState;
      const refreshUploadFailurePresentation = deps.refreshUploadFailurePresentation;
      const refreshQueueReadableState = deps.refreshQueueReadableState;
      const isUploadCriticalNow = deps.isUploadCriticalNow;
      const isUploadItemMissingSource = deps.isUploadItemMissingSource;
      const restoreMissingUploadItem = deps.restoreMissingUploadItem;
      const logUploadQueueSnapshot = deps.logUploadQueueSnapshot;
      const countRenderedUploadListItems = deps.countRenderedUploadListItems;
      const normalizePersistedKind = deps.normalizePersistedKind;
      const render = deps.render;
      const newId = deps.newId;

      [
        ['setStatus', setStatus],
        ['migrateLegacyUploadSelectionIfNeeded', migrateLegacyUploadSelectionIfNeeded],
        ['getToolboxPageState', getToolboxPageState],
        ['saveGlobalUploadActiveGroupId', saveGlobalUploadActiveGroupId],
        ['saveUploadLastActiveGroupId', saveUploadLastActiveGroupId],
        ['dedupeActiveGroupQueue', dedupeActiveGroupQueue],
        ['migrateMissingGroupIdRows', migrateMissingGroupIdRows],
        ['isStaleFailedUploadRow', isStaleFailedUploadRow],
        ['UploadPersistedKind', UploadPersistedKind],
        ['UploadRestoreState', UploadRestoreState],
        ['UPLOAD_HANDLE_DB_NAME', UPLOAD_HANDLE_DB_NAME],
        ['UPLOAD_HANDLE_STORE', UPLOAD_HANDLE_STORE],
        ['UPLOAD_HANDLE_DB_VERSION', UPLOAD_HANDLE_DB_VERSION],
        ['UPLOAD_PERSIST_TIMEOUT_MS', UPLOAD_PERSIST_TIMEOUT_MS],
        ['hasAttemptableUploadSource', hasAttemptableUploadSource],
        ['hasAttachmentEvidenceForItem', hasAttachmentEvidenceForItem],
        ['shouldPreserveMissingOrFailedState', shouldPreserveMissingOrFailedState],
        ['isUploadUnfinishedState', isUploadUnfinishedState],
        ['normalizeUploadState', normalizeUploadState],
        ['isFlaskLocalDirectSource', isFlaskLocalDirectSource],
        ['isFlaskLocalDirectItem', isFlaskLocalDirectItem],
        ['isFileLike', isFileLike],
        ['isPersistUploadBlobEnabled', isPersistUploadBlobEnabled],
        ['getUploadItemSizeBytes', getUploadItemSizeBytes],
        ['normalizeUploadRegistryStatus', normalizeUploadRegistryStatus],
        ['appendUploadSchemaAuditLog', appendUploadSchemaAuditLog],
        ['broadcastUploadGlobalStateChanged', broadcastUploadGlobalStateChanged],
        ['isProtectedUploadGroup', isProtectedUploadGroup],
        ['syncActiveGroupCountInCache', syncActiveGroupCountInCache],
        ['logSlowOperation', logSlowOperation],
        ['withTimeout', withTimeout],
        ['sleep', sleep],
        ['renderProjectCategoryChips', renderProjectCategoryChips],
        ['renderManageGroupList', renderManageGroupList],
        ['isComposerAttachmentReadyForUserVisibleUpload', isComposerAttachmentReadyForUserVisibleUpload],
        ['clearUploadFailureStatusIndicators', clearUploadFailureStatusIndicators],
        ['reconcileIdleUploadFailureState', reconcileIdleUploadFailureState],
        ['refreshUploadFailurePresentation', refreshUploadFailurePresentation],
        ['refreshQueueReadableState', refreshQueueReadableState],
        ['isUploadCriticalNow', isUploadCriticalNow],
        ['isUploadItemMissingSource', isUploadItemMissingSource],
        ['restoreMissingUploadItem', restoreMissingUploadItem],
        ['logUploadQueueSnapshot', logUploadQueueSnapshot],
        ['countRenderedUploadListItems', countRenderedUploadListItems],
        ['normalizePersistedKind', normalizePersistedKind],
        ['render', render],
        ['newId', newId],
        ['getRestoreDirtyValueText', getRestoreDirtyValueText],
      ].forEach(([name, value]) => {
        const ok =
          typeof value === 'function'
          || typeof value === 'object'
          || typeof value === 'string'
          || typeof value === 'number'
          || typeof value === 'boolean';
        if (!ok) {
          throw new Error(`UploadPersistDb missing dependency: ${name}`);
        }
      });

    function openUploadFileHandleDb() {
      if (refs.uploadFileHandleDbPromise) return refs.uploadFileHandleDbPromise;

      refs.uploadFileHandleDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error('当前浏览器不支持 IndexedDB'));
          return;
        }
        const req = indexedDB.open(UPLOAD_HANDLE_DB_NAME, UPLOAD_HANDLE_DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(UPLOAD_HANDLE_STORE)) {
            db.createObjectStore(UPLOAD_HANDLE_STORE, { keyPath: 'handleKey' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          const err = req.error || new Error('openUploadFileHandleDb failed');
          console.error('[ChatGPT toolbox] openUploadFileHandleDb failed', err);
          ToolboxShell.appendLog(`[UPLOAD_HANDLE_DB][OPEN_FAILED] error=${err.message || String(err)}`);
          refs.uploadFileHandleDbPromise = null;
          reject(err);
        };
      }).catch((err) => {
        refs.uploadFileHandleDbPromise = null;
        throw err;
      });

      return refs.uploadFileHandleDbPromise;
    }

    async function saveUploadFileHandle(handleKey, handle) {
      if (!handleKey || !isFileHandleLike(handle)) return false;
      try {
        const db = await openUploadFileHandleDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(UPLOAD_HANDLE_STORE, 'readwrite');
          const store = tx.objectStore(UPLOAD_HANDLE_STORE);
          store.put({
            handleKey,
            handle,
            updatedAt: Date.now(),
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('saveUploadFileHandle tx failed'));
          tx.onabort = () => reject(tx.error || new Error('saveUploadFileHandle tx aborted'));
        });
        return true;
      } catch (err) {
        console.error('[ChatGPT toolbox] saveUploadFileHandle failed', err);
        ToolboxShell.appendLog(`[UPLOAD_HANDLE_DB][SAVE_FAILED] key=${handleKey} error=${err && err.message ? err.message : String(err)}`);
        return false;
      }
    }

    async function loadUploadFileHandle(handleKey) {
      if (!handleKey) return null;
      try {
        const db = await openUploadFileHandleDb();
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(UPLOAD_HANDLE_STORE, 'readonly');
          const store = tx.objectStore(UPLOAD_HANDLE_STORE);
          const req = store.get(handleKey);
          req.onsuccess = () => resolve(req.result && req.result.handle ? req.result.handle : null);
          req.onerror = () => reject(req.error || new Error('loadUploadFileHandle get failed'));
        });
      } catch (err) {
        console.error('[ChatGPT toolbox] loadUploadFileHandle failed', err);
        ToolboxShell.appendLog(`[UPLOAD_HANDLE_DB][LOAD_FAILED] key=${handleKey} error=${err && err.message ? err.message : String(err)}`);
        return null;
      }
    }

    async function deleteUploadFileHandle(handleKey) {
      if (!handleKey) return false;
      try {
        const db = await openUploadFileHandleDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(UPLOAD_HANDLE_STORE, 'readwrite');
          tx.objectStore(UPLOAD_HANDLE_STORE).delete(handleKey);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('deleteUploadFileHandle tx failed'));
          tx.onabort = () => reject(tx.error || new Error('deleteUploadFileHandle tx aborted'));
        });
        return true;
      } catch (err) {
        console.error('[ChatGPT toolbox] deleteUploadFileHandle failed', err);
        ToolboxShell.appendLog(`[UPLOAD_HANDLE_DB][DELETE_FAILED] key=${handleKey} error=${err && err.message ? err.message : String(err)}`);
        return false;
      }
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

      return normalizeUploadState(q.state || UploadState.IDLE, true);
    }

    function getPersistedKindForItem(q) {
      if (!q) return UploadPersistedKind.METADATA_ONLY;
      if (isFlaskLocalDirectSource(q) || isFlaskLocalDirectItem(q)) {
        return UploadPersistedKind.FLASK_REF;
      }
      if (isFileHandleLike(q.fileHandle)) {
        return UploadPersistedKind.FILE_SYSTEM_HANDLE;
      }
      return UploadPersistedKind.METADATA_ONLY;
    }

    function getRestoreStateForItem(q) {
      if (!q) return UploadRestoreState.ERROR;
      if (q.restoreState) return q.restoreState;
      if (isFlaskLocalDirectSource(q) || isFlaskLocalDirectItem(q)) {
        return hasAttemptableUploadSource(q) ? UploadRestoreState.READY : UploadRestoreState.MISSING;
      }
      if (isFileHandleLike(q.fileHandle)) {
        return UploadRestoreState.READY;
      }
      return UploadRestoreState.NEEDS_REBIND;
    }

    function resolveUploadBlobCandidate(item) {
      if (!item) return null;

      if (isBlobLike(item.blob)) {
        return item.blob;
      }

      if (isBlobLike(item.sourceBlob)) {
        return item.sourceBlob;
      }

      if (isFileLike(item.file)) {
        return item.file;
      }

      if (isFileLike(item.sourceFile)) {
        return item.sourceFile;
      }

      if (isFileLike(item.originalFile)) {
        return item.originalFile;
      }

      return null;
    }

    function hasPersistableUploadBlob(item) {
      if (!isPersistUploadBlobEnabled()) {
        return false;
      }
      const blob = resolveUploadBlobCandidate(item);
      if (!blob) {
        return false;
      }

      const size = getUploadItemSizeBytes(item) || Number(blob.size) || 0;
      return size > 0 && size <= APP.uploadBlobMaxBytes;
    }

    function mergeQueueItemWithPersistedBlob(item, existingRow) {
      if (!item || !existingRow || hasAttemptableUploadSource(item)) {
        return item;
      }

      const size = getUploadItemSizeBytes(item) || Number(existingRow.size) || 0;
      const cacheKind = item.sourceKind || existingRow.sourceKind || 'cached-snapshot';
      const cacheReadMode = item.readMode || existingRow.readMode || 'indexeddb-blob';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][persist-row:merge-cache-metadata-only] name=${item.name || '-'} size=${size} sourceKind=${cacheKind}`,
      );

      return {
        ...item,
        sourceKind: cacheKind,
        readMode: cacheReadMode,
        size: item.size || existingRow.size || size,
        attachState: UploadState.MISSING_FILE,
        message: item.message || '禁止使用缓存快照上传，请重新绑定真实本地文件',
      };
    }

    function buildPersistRow(q, existingRow = null) {
      const mergedItem = normalizeUploadItem(
        mergeQueueItemWithPersistedBlob(q, existingRow) || q,
        {
          groupId: getUploadItemGroupId(q) || state.activeGroupId,
        },
      );
      const hasHandle = isFileHandleLike(mergedItem.fileHandle);
      const blobCandidate = resolveUploadBlobCandidate(mergedItem);
      const size = getUploadItemSizeBytes(mergedItem) || (blobCandidate ? Number(blobCandidate.size) || 0 : 0);
      const canSaveBlob = !!(
        isPersistUploadBlobEnabled()
        && blobCandidate
        && size > 0
        && size <= APP.uploadBlobMaxBytes
      );
      const mimeType = mergedItem.mimeType || mergedItem.type || 'application/octet-stream';
      const downloadUrl = String(mergedItem.downloadUrl || mergedItem.download_url || '').trim();
      const flaskPath = String(mergedItem.flaskPath || '').trim();
      const attachState = getPersistedUploadState(mergedItem);
      const registryStatus = normalizeUploadRegistryStatus(
        mergedItem.registryStatus || mergedItem.status || 'pending',
        mergedItem,
      );

      const row = {
        id: mergedItem.id,
        groupId: mergedItem.groupId || state.activeGroupId,
        name: mergedItem.name,
        displayPath: mergedItem.displayPath || mergedItem.name || '',
        size: mergedItem.size,
        lastModified: mergedItem.lastModified,
        mimeType,
        downloadUrl,
        sourceKind: mergedItem.sourceKind || '',
        readMode: mergedItem.readMode || '',
        registryStatus,
        attachState,
        composerPresence: mergedItem.composerPresence || '',
        sendState: mergedItem.sendState || '',
        message: mergedItem.message,
        handle: hasHandle ? mergedItem.fileHandle : null,
        persistedKind: getPersistedKindForItem(mergedItem),
        restoreState: getRestoreStateForItem(mergedItem),
        handleKey: String(mergedItem.handleKey || buildUploadHandleKey(mergedItem) || ''),
        flaskPath,
        uploadName: mergedItem.uploadName || '',
        manualPathNote: String(mergedItem.manualPathNote || '').trim(),
        blob: null,
        blobSaved: false,
        blobSavedAt: 0,
        debugSavedFrom: '',
      };
      row.type = row.mimeType;
      row.mime_type = row.mimeType;
      row.state = row.attachState;
      row.status = row.registryStatus;
      row.download_url = row.downloadUrl;

      if (canSaveBlob) {
        row.blob = blobCandidate;
        row.blobSaved = true;
        row.blobSavedAt = Date.now();
        row.debugSavedFrom = String(mergedItem.sourceKind || mergedItem.readMode || 'unknown');

        // 无 handle 的场景（input/拖拽未拿到句柄）才把 sourceKind 标记为缓存快照；
        // 跨窗口恢复后 UI 显示「缓存快照，需重新绑定」，禁止用缓存上传。
        if (!hasHandle) {
          row.sourceKind = 'cached-snapshot';
          row.readMode = 'indexeddb-blob';
        }

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][persist-row:blob-saved] name=${mergedItem.name || '-'} size=${size} sourceKind=${mergedItem.sourceKind || '-'} readMode=${mergedItem.readMode || '-'}`
        );
      } else if (blobCandidate && size > APP.uploadBlobMaxBytes) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][persist-row:blob-skip-large] name=${mergedItem.name || '-'} size=${size} limit=${APP.uploadBlobMaxBytes}`
        );
      } else {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][persist-row:no-readable-source] name=${mergedItem.name || '-'} handle=${hasHandle ? 1 : 0} blob=${blobCandidate ? 1 : 0}`
        );
      }

      appendUploadSchemaAuditLog('UPLOAD_PERSIST_ROW', row);
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
              const normalizedRecord = normalizeUploadItem(record, {
                groupId: getUploadItemGroupId(record) || state.activeGroupId,
              });

              const hasBlob = record.blob !== null && record.blob !== undefined;

              if (hasBlob || record.blobSaved || record.blobSavedAt || record.debugSavedFrom) {
                ToolboxShell.appendLog(
                  `[UPLOAD_DIAG][clear-persisted-blob:item] name=${normalizedRecord.name || '-'} id=${normalizedRecord.id || '-'} oldBlob=${hasBlob ? 1 : 0}`,
                );

                const row = buildPersistRow({
                  ...normalizedRecord,
                  blob: null,
                }, record);
                row.handle = record.handle || row.handle || null;
                row.blob = null;
                row.blobSaved = false;
                row.blobSavedAt = 0;
                row.debugSavedFrom = '';

                store.put(row);
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
      if (changed > 0) {
        broadcastUploadGlobalStateChanged('clear-persisted-blob', { changed });
      }
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
      if (refs.dbPromise) return refs.dbPromise;

      refs.dbPromise = new Promise((resolve, reject) => {
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
            refs.dbPromise = null;
            ToolboxShell.appendLog('[UPLOAD_DB][versionchange] db closed');
          };

          db.onclose = () => {
            refs.dbPromise = null;
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
          refs.dbPromise = null;

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
          refs.dbPromise = null;

          console.warn('[ChatGPT toolbox] IndexedDB open blocked');

          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog('[UPLOAD_DB][open:blocked] IndexedDB 被其他页面或旧连接阻塞');
          }

          reject(err);
        };
      }).catch((err) => {
        refs.dbPromise = null;
        throw err;
      });

      return refs.dbPromise;
    }

    async function debugReadBackPersistedQueue(stage) {
      if (!isUploadListDebugEnabled()) {
        return;
      }
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

        const summary = currentRows.map((r) => {
          const normalized = normalizeUploadItem(r, {
            groupId: getUploadItemGroupId(r) || state.activeGroupId,
          });
          return {
            id: normalized.id,
            name: normalized.name,
            state: normalized.attachState,
            registryStatus: normalized.registryStatus,
            mimeType: normalized.mimeType,
            blobSaved: !!r.blobSaved,
            hasBlob: isBlobLike(r.blob),
            blobTag: r.blob ? getObjectTag(r.blob) : '',
            blobSize: r.blob && typeof r.blob.size === 'number' ? r.blob.size : null,
            hasHandle: !!r.handle,
            handleName: r.handle && r.handle.name ? r.handle.name : '',
            debugSavedFrom: r.debugSavedFrom || '',
            message: normalized.message || '',
          };
        });

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

    async function persistQueue(stage = '', options = {}) {
      const persistStartedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const groupIdSnapshot = String(state.activeGroupId || '').trim();
      if (!groupIdSnapshot) {
        console.warn('[ChatGPT toolbox] persistQueue: activeGroupId 为空');
        return;
      }

      const queueSnapshot = getActiveGroupFiles().map((item) => ({
        ...item,
        groupId: groupIdSnapshot,
      }));
      const stageText = String(stage || '').trim() || '-';
      const restorePhase = getQueueRestorePhase();
      const allowEmpty = shouldAllowEmptyQueuePersist(stageText);
      const persistMode = options && options.mode ? String(options.mode) : 'full';
      const perfStartedAt = Date.now();

      if (!queueSnapshot.length) {
        if (restorePhase !== 'ready') {
          const skipLine = `[UPLOAD_PERSIST][SKIP_EMPTY_BEFORE_RESTORE] activeGroupId=${groupIdSnapshot || '-'} queueRestorePhase=${restorePhase} queueLoadedOnce=${state.queueLoadedOnce ? 1 : 0} stage=${stageText}`;
          console.warn(skipLine);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(skipLine);
          }
          return;
        }

        if (!allowEmpty.allow) {
          const skipLine = `[UPLOAD_PERSIST][SKIP_EMPTY_NO_EXPLICIT_ALLOW] activeGroupId=${groupIdSnapshot || '-'} queueRestorePhase=${restorePhase} queueLoadedOnce=${state.queueLoadedOnce ? 1 : 0} stage=${stageText}`;
          console.warn(skipLine);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(skipLine);
          }
          return;
        }
      }

      try {
        for (const item of queueSnapshot) {
          if (!item) continue;
          item.handleKey = String(item.handleKey || buildUploadHandleKey(item) || '');
          if (isFileHandleLike(item.fileHandle) && item.handleKey) {
            const saved = await saveUploadFileHandle(item.handleKey, item.fileHandle);
            if (!saved) {
              ToolboxShell.appendLog(
                `[UPLOAD_HANDLE_DB][SAVE_SKIP] id=${item.id || '-'} name=${item.name || '-'} key=${item.handleKey || '-'}`
              );
            }
          }
        }

        const db = await openDb();

        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const req = store.getAll();

          req.onerror = () => reject(req.error || new Error('IndexedDB queue getAll before persist failed'));

          req.onsuccess = () => {
            const rows = req.result || [];
            const existingRowsById = new Map();

            rows.forEach((r) => {
              if (!r || !r.id) {
                return;
              }

              const gid = String(r.groupId || '').trim() || groupIdSnapshot;
              if (gid === groupIdSnapshot) {
                existingRowsById.set(r.id, r);
              }
            });

            if (queueSnapshot.length > 0 || allowEmpty.allow) {
              rows.forEach((r) => {
                const gid = String(r.groupId || '').trim() || groupIdSnapshot;
                if (gid === groupIdSnapshot) {
                  store.delete(r.id);
                }
              });
            } else {
              const skipDeleteLine = `[UPLOAD_PERSIST][SKIP_DELETE_EMPTY] activeGroupId=${groupIdSnapshot || '-'} queueRestorePhase=${restorePhase} queueLoadedOnce=${state.queueLoadedOnce ? 1 : 0} stage=${stageText}`;
              console.warn(skipDeleteLine);
              if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
                ToolboxShell.appendLog(skipDeleteLine);
              }
            }

            queueSnapshot.forEach((q) => {
              const row = buildPersistRow({
                ...q,
                groupId: groupIdSnapshot,
              }, existingRowsById.get(q.id));

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

        if (isUploadListDebugEnabled()) {
          await debugReadBackPersistedQueue(`persistQueue:${stageText}:after-write`);
        }
        scheduleRefreshUploadGroupCounts(`persistQueue:${stageText}`, 1200);
        scheduleCleanupUploadDbGarbage(`persistQueue:${stageText}`, 6000);
      } catch (e) {
        const errText = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
        console.error('[ChatGPT toolbox] persist upload queue failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][persistQueue:failed] groupId=${groupIdSnapshot} queueLen=${queueSnapshot.length} stage=${stageText} error=${errText}`,
        );
        if (!isUploadListDebugEnabled()) {
          void debugReadBackPersistedQueue(`persistQueue:${stageText}:failed`);
        }
        throw e;
      } finally {
        const costMs = Date.now() - perfStartedAt;
        logPersistPerfIfSlow(
          `[PERF][persistQueue] cost=${costMs}ms mode=${persistMode} itemCount=${queueSnapshot.length} stage=${stageText}`,
          costMs,
          100,
        );
        logSlowOperation(
          'persistQueue',
          persistStartedAt,
          `mode=${persistMode} itemCount=${queueSnapshot.length} stage=${stageText}`,
        );
      }
    }

    async function persistQueueItem(item, stage = '') {
      const normalizedItem = item && typeof item === 'object'
        ? normalizeUploadItem(item, {
          groupId: getUploadItemGroupId(item) || state.activeGroupId,
        })
        : null;
      const itemId = normalizedItem && normalizedItem.id ? String(normalizedItem.id) : '';
      const groupIdSnapshot = normalizedItem && normalizedItem.groupId
        ? String(normalizedItem.groupId || '').trim()
        : String(state.activeGroupId || '').trim();

      if (!normalizedItem || !itemId || !groupIdSnapshot) {
        return;
      }

      const perfStartedAt = Date.now();
      const stageText = String(stage || '').trim() || '-';

      try {
        normalizedItem.handleKey = String(normalizedItem.handleKey || buildUploadHandleKey(normalizedItem) || '');
        if (isFileHandleLike(normalizedItem.fileHandle) && normalizedItem.handleKey) {
          const saved = await saveUploadFileHandle(normalizedItem.handleKey, normalizedItem.fileHandle);
          if (!saved) {
            ToolboxShell.appendLog(
              `[UPLOAD_HANDLE_DB][SAVE_SKIP] id=${normalizedItem.id || '-'} name=${normalizedItem.name || '-'} key=${normalizedItem.handleKey || '-'}`,
            );
          }
        }

        const db = await openDb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(APP.uploadStore, 'readwrite');
          const store = tx.objectStore(APP.uploadStore);
          const getReq = store.get(itemId);

          getReq.onerror = () => reject(getReq.error || new Error('IndexedDB queue get before item persist failed'));
          getReq.onsuccess = () => {
            const existingRow = getReq.result && typeof getReq.result === 'object'
              ? getReq.result
              : null;
            const row = buildPersistRow({
              ...normalizedItem,
              groupId: groupIdSnapshot,
            }, existingRow);
            const putReq = store.put(row);

            putReq.onerror = (event) => {
              if (!row.handle) {
                return;
              }
              const err = putReq.error || new Error('IndexedDB put item with handle failed');
              console.error('[ChatGPT toolbox] persistQueueItem put with handle failed, retry without handle', err);
              ToolboxShell.appendLog(
                `[UPLOAD_DIAG][persist:item-handle-failed] id=${row.id || '-'} name=${row.name || '-'} error=${err && err.message ? err.message : String(err)}`,
              );
              if (typeof event.preventDefault === 'function') {
                event.preventDefault();
              }
              if (typeof event.stopPropagation === 'function') {
                event.stopPropagation();
              }
              store.put({
                ...row,
                handle: null,
              });
            };
          };

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB queue item persist transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB queue item persist transaction aborted'));
        });
      } catch (error) {
        console.error('[ChatGPT toolbox] persistQueueItem failed', error);
        if (!isUploadListDebugEnabled()) {
          void debugReadBackPersistedQueue(`persistQueueItem:${stageText}:failed`);
        }
        throw error;
      } finally {
        const costMs = Date.now() - perfStartedAt;
        logPersistPerfIfSlow(
          `[PERF][persistQueueItem] cost=${costMs}ms itemId=${itemId} stage=${stageText}`,
          costMs,
          100,
        );
      }
    }

    function logPersistPerfIfSlow(line, costMs, thresholdMs = 100) {
      if (costMs <= thresholdMs) {
        return;
      }
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.warn(line);
      }
    }

    function scheduleRefreshUploadGroupCounts(reason = '', delayMs = 1200) {
      const waitMs = Math.max(200, Number(delayMs) || 0);
      if (refs.uploadGroupCountsRefreshTimer) {
        return;
      }
      refs.uploadGroupCountsRefreshTimer = window.setTimeout(() => {
        refs.uploadGroupCountsRefreshTimer = 0;
        void refreshUploadGroupCounts().catch((error) => {
          console.error('[ChatGPT toolbox] scheduleRefreshUploadGroupCounts failed', error);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            const errText = error && error.message ? error.message : String(error);
            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][refresh-counts:scheduled-failed] reason=${String(reason || '-')} error=${errText}`,
            );
          }
        });
      }, waitMs);
    }

    function scheduleCleanupUploadDbGarbage(reason = '', delayMs = 5000) {
      const waitMs = Math.max(800, Number(delayMs) || 0);
      if (refs.uploadDbCleanupTimer) {
        return;
      }
      refs.uploadDbCleanupTimer = window.setTimeout(() => {
        refs.uploadDbCleanupTimer = 0;
        void cleanupUploadDbGarbage(reason || 'scheduled-cleanup');
      }, waitMs);
    }

    function schedulePersistQueueItem(item, stage = '', delayMs = 500) {
      const itemId = item && item.id ? String(item.id) : '';
      if (!itemId) {
        return;
      }
      refs.persistQueueItemDirtyIds.add(itemId);
      refs.persistQueueItemPendingStage = String(stage || refs.persistQueueItemPendingStage || 'item-update');

      if (refs.persistQueueItemTimer) {
        return;
      }

      const critical = (
        typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
        && UploadCriticalRuntime.isUploadCriticalMode()
      );
      const waitMs = critical
        ? Math.max(Number(delayMs) || 0, 1200)
        : Math.max(Number(delayMs) || 0, 200);

      refs.persistQueueItemTimer = window.setTimeout(() => {
        const ids = Array.from(refs.persistQueueItemDirtyIds);
        const stageText = refs.persistQueueItemPendingStage || 'item-update';
        refs.persistQueueItemDirtyIds.clear();
        refs.persistQueueItemPendingStage = '';
        refs.persistQueueItemTimer = 0;

        ids.forEach((dirtyId) => {
          const dirtyItem = state.queue.find((x) => x && x.id === dirtyId);
          if (!dirtyItem) {
            return;
          }
          void persistQueueItem(dirtyItem, stageText).catch((error) => {
            const errText = error && error.message ? error.message : String(error);
            console.error('[ChatGPT toolbox] scheduled persistQueueItem failed', error);
            if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
              ToolboxShell.appendLog(
                `[UPLOAD_PERSIST][ITEM_FAILED] id=${dirtyId || '-'} stage=${stageText} error=${errText}`,
              );
            }
          });
        });
      }, waitMs);
    }

    function schedulePersistQueue(stage = '') {
      const stageText = String(stage || '').trim() || '-';
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(
          'UPLOAD_PERSIST:SCHEDULE',
          stageText,
          `[UPLOAD_PERSIST][SCHEDULE] stage=${stageText}`,
          2000,
        );
      } else if (isUploadDebugEnabled()) {
        ToolboxShell.appendLog(`[UPLOAD_PERSIST][SCHEDULE] stage=${stageText}`);
      }
      refs.persistQueuePromise = refs.persistQueuePromise
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
              persistQueue(stageText),
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

          let composerAttachmentReady = false;
          try {
            composerAttachmentReady = isComposerAttachmentReadyForUserVisibleUpload();
          } catch (readyCheckErr) {
            console.error('[ChatGPT toolbox] persist timeout composer attachment ready check failed', readyCheckErr);
            ToolboxShell.appendLog(
              `[UPLOAD_PERSIST][READY_CHECK_FAILED] error=${readyCheckErr && readyCheckErr.message ? readyCheckErr.message : String(readyCheckErr)}`,
            );
          }

          ToolboxShell.appendLog(
            `[UPLOAD_PERSIST][BACKGROUND_TIMEOUT] type=${errName} timeoutMs=${UPLOAD_PERSIST_TIMEOUT_MS} composerAttachmentReady=${composerAttachmentReady ? 1 : 0} note=timeout-does-not-cancel-indexeddb-write error=${errText}`,
          );

          // 持久化慢/超时不应阻塞上传主流程；附件已在输入框时只记日志，不弹 warn。
          if (!composerAttachmentReady) {
            const now = Date.now();
            if (!refs.lastPersistUserNotifyAt || now - refs.lastPersistUserNotifyAt >= 10000) {
              refs.lastPersistUserNotifyAt = now;
              if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.showToast === 'function') {
                ToolboxShell.showToast(
                  '本地队列保存较慢；附件已在输入框，不影响发送',
                  'info',
                  2600,
                );
              }
            }
          } else {
            ToolboxShell.appendLog(
              `[UPLOAD_PERSIST][TOAST_SUPPRESSED] reason=composer-attachment-ready error=${errText}`,
            );
          }

          // 永不向外抛出：避免 await schedulePersistQueue 导致 UI/流程卡死。
          return null;
        });

      return refs.persistQueuePromise;
    }

    async function awaitPersistQueueBriefly(stage, maxWaitMs = 300) {
      const waitMs = Math.max(0, Number(maxWaitMs) || 0);
      try {
        if (waitMs <= 0) {
          void schedulePersistQueue(stage);
          return { ok: true, waitedMs: 0, timedOut: false };
        }

        const startedAt = Date.now();
        const result = await Promise.race([
          schedulePersistQueue(stage).then(() => ({ timedOut: false })),
          sleep(waitMs).then(() => ({ timedOut: true })),
        ]);

        if (result && result.timedOut) {
          ToolboxShell.appendLog(
            `[UPLOAD_PERSIST][BACKGROUND_TIMEOUT] stage=${String(stage || '-')} briefWaitMs=${waitMs}`,
          );
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_PERSIST][BACKGROUND_DONE] stage=${String(stage || '-')} cost=${Date.now() - startedAt}ms`,
          );
        }

        return { ok: true, waitedMs: Date.now() - startedAt, timedOut: !!(result && result.timedOut) };
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] awaitPersistQueueBriefly failed', err);
        ToolboxShell.appendLog(
          `[UPLOAD_PERSIST][BACKGROUND_TIMEOUT] stage=${String(stage || '-')} error=${errText}`,
        );
        return { ok: false, error: errText };
      }
    }

    function persistQueueInBackground(stage) {
      void schedulePersistQueue(stage)
        .then(() => {
          ToolboxShell.appendLog(`[UPLOAD_PERSIST][BACKGROUND_DONE] stage=${String(stage || '-')} via=fire_and_forget`);
        })
        .catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] background persist failed', stage, err);
          ToolboxShell.appendLog(`[UPLOAD_PERSIST][BACKGROUND_TIMEOUT] stage=${String(stage || '-')} error=${errText}`);
        });
    }

    function persistQueueThrottled(stage, delayMs = 600) {
      refs.persistQueuePendingStage = stage || refs.persistQueuePendingStage || '-';

      if (refs.persistQueueThrottleTimer) {
        return;
      }

      const critical = isUploadCriticalNow();
      const effectiveDelayMs = critical
        ? Math.max(Number(delayMs) || 0, 3000)
        : delayMs;

      refs.persistQueueThrottleTimer = window.setTimeout(() => {
        const stageText = refs.persistQueuePendingStage;
        refs.persistQueuePendingStage = '';
        refs.persistQueueThrottleTimer = 0;

        persistQueueInBackground(stageText);
      }, effectiveDelayMs);
    }

    function schedulePersistQueueLight(reason, delayMs = 1500) {
      window.clearTimeout(refs.uploadPersistLightTimer);
      refs.uploadPersistLightTimer = window.setTimeout(() => {
        refs.uploadPersistLightTimer = 0;
        persistQueue(reason || 'light-persist').catch((err) => {
          const message = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] schedulePersistQueueLight failed', err);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(`[UPLOAD_PERF][PERSIST_ERROR] reason=${reason || '-'} error=${message}`);
          }
        });
      }, Math.max(300, Number(delayMs) || 1500));
    }

    function scheduleRefreshUploadGroupCountsLight(reason, delayMs = 2000) {
      window.clearTimeout(refs.uploadGroupCountLightTimer);
      refs.uploadGroupCountLightTimer = window.setTimeout(() => {
        refs.uploadGroupCountLightTimer = 0;
        refreshUploadGroupCounts().catch((err) => {
          const message = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] scheduleRefreshUploadGroupCountsLight failed', err);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(`[UPLOAD_PERF][COUNT_ERROR] reason=${reason || '-'} error=${message}`);
          }
        });
      }, Math.max(500, Number(delayMs) || 2000));
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
          saveGlobalUploadActiveGroupId(state.activeGroupId, 'upload-default-group-created');
          saveUploadLastActiveGroupId(state.activeGroupId, 'upload-default-group-created');
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
        if (state.activeGroupId) {
          saveGlobalUploadActiveGroupId(state.activeGroupId, 'load-groups');
          saveUploadLastActiveGroupId(state.activeGroupId, 'load-groups');
        }

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][active-resolve] pageGroup=${resolved.pageGroupId || '-'} globalGroup=${resolved.globalUploadActiveGroupId || resolved.uploadLastActiveGroupId || '-'} active=${state.activeGroupId || '-'} source=${resolved.reason || '-'}`,
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

    async function loadQueueForActiveGroup() {
      if (!state.activeGroupId) {
        console.warn('[ChatGPT toolbox] loadQueueForActiveGroup: activeGroupId 为空');
        setQueueRestorePhase('idle', {
          groupId: '',
          loadedOnce: false,
          reason: 'load-queue-no-active-group',
        });
        state.queue = [];
        setLastRestoreWarning('', { reason: 'load-queue-no-active-group' });
        clearUploadFailureStatusIndicators('load-queue-no-active-group');
        render();
        return;
      }

      try {
        setQueueRestorePhase('loading', {
          groupId: state.activeGroupId,
          loadedOnce: false,
          reason: 'load-queue-start',
        });
        ToolboxShell.appendLog(`[UPLOAD_RESTORE][START] activeGroupId=${state.activeGroupId || '-'}`);
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

        ToolboxShell.appendLog(`[UPLOAD_RESTORE][META_COUNT] count=${rows.length}`);
        ToolboxShell.appendLog(`[UPLOAD_RESTORE][GROUP_COUNT] count=${state.groups.length}`);
        const { scopedRows, skippedNonObjectCount } = sanitizePersistedUploadRows(rows, state.activeGroupId);
        if (skippedNonObjectCount > 0) {
          ToolboxShell.appendLog(
            `[UPLOAD_RESTORE][SKIP_INVALID_ROWS] count=${skippedNonObjectCount} activeGroupId=${state.activeGroupId || '-'}`
          );
        }
        const restoredItems = await Promise.all(
          scopedRows.map(async (r) => {
            try {
              return await restoreUploadItemFromPersistRow(r, state.activeGroupId);
            } catch (rowErr) {
              const fallback = normalizeUploadItem({
                id: r.id || newId(),
                groupId: state.activeGroupId,
                name: r.name || 'unknown',
                size: Number(r.size || 0),
                mimeType: r.mimeType || r.mime_type || r.type || 'application/octet-stream',
                downloadUrl: r.downloadUrl || r.download_url || '',
                lastModified: Number(r.lastModified || Date.now()),
                sourceKind: r.sourceKind || 'unknown',
                readMode: r.readMode || 'none',
                uploadName: '',
                persistedAttached: false,
                attachState: UploadState.MISSING_FILE,
                registryStatus: r.registryStatus || r.status || 'pending',
                message: '',
                restoreState: UploadRestoreState.ERROR,
              }, {
                groupId: state.activeGroupId,
              });
              restoreMissingUploadItem(fallback, UploadState.MISSING_FILE);
              safeAssignRestoreState(fallback, UploadRestoreState.ERROR, 'restore-fallback:item');
              fallback.state = UploadState.MISSING_FILE;
              fallback.message = `恢复失败：${rowErr && rowErr.message ? rowErr.message : String(rowErr)}`;
              fallback.persistedKind = normalizePersistedKind(r.persistedKind);
              syncUploadItemSchemaInPlace(fallback);
              ToolboxShell.appendLog(
                `[UPLOAD_RESTORE][ITEM] id=${fallback.id || '-'} name=${fallback.name || '-'} kind=${fallback.persistedKind || '-'} restoreState=${fallback.restoreState || '-'}`
              );
              return fallback;
            }
          })
        );
        const restoredBase = normalizeRestoreArray(restoredItems, 'loadQueueForActiveGroup.restoredItems').filter(Boolean);
        state.queue = mergeActiveGroupQueueFromMemory(restoredBase, 'loadQueueForActiveGroup');
        const invalidRestoredItems = state.queue.filter((item) => !isPlainObject(item));
        if (invalidRestoredItems.length > 0) {
          invalidRestoredItems.forEach((item, index) => {
            logDirtyRestoreEntry('SKIP_INVALID_RESTORED_ITEM', {
              index,
              actualType: item === null ? 'null' : typeof item,
              value: getRestoreDirtyValueText(item),
            });
          });
          state.queue = state.queue.filter((item) => isPlainObject(item));
          setLastRestoreWarning(`上传队列中跳过了 ${invalidRestoredItems.length} 条异常恢复结果`, {
            reason: 'load-queue-skip-invalid-restored-items',
            clearFailedStatus: true,
          });
        } else if (skippedNonObjectCount <= 0) {
          setLastRestoreWarning('', { reason: 'load-queue-success' });
        }
        clearUploadFailureStatusIndicators('load-queue-success');
        const restoreStat = {
          restored: state.queue.length,
          ready: state.queue.filter((x) => x.restoreState === UploadRestoreState.READY).length,
          needsRebind: state.queue.filter((x) => x.restoreState === UploadRestoreState.NEEDS_REBIND).length,
          permissionRequired: state.queue.filter((x) => x.restoreState === UploadRestoreState.PERMISSION_REQUIRED).length,
          missing: state.queue.filter((x) => x.restoreState === UploadRestoreState.MISSING).length,
        };
        const readableCount = state.queue.filter((x) => !isUploadItemMissingSource(x)).length;
        const handleCount = state.queue.filter((x) => x && x.fileHandle).length;
        const blobCount = state.queue.filter((x) => x && x.blob).length;
        ToolboxShell.appendLog(
          `[UPLOAD_RESTORE][DONE] restored=${restoreStat.restored} ready=${restoreStat.ready} needsRebind=${restoreStat.needsRebind} permissionRequired=${restoreStat.permissionRequired} missing=${restoreStat.missing}`
        );
        ToolboxShell.appendLog(
          `[UPLOAD_INIT][QUEUE_RESTORED] activeGroupId=${state.activeGroupId || '-'} restoredCount=${restoreStat.restored} readableCount=${readableCount} handleCount=${handleCount} blobCount=${blobCount} missingSourceCount=${restoreStat.missing}`,
        );

        setQueueRestorePhase('ready', {
          groupId: state.activeGroupId,
          loadedOnce: true,
          reason: 'load-queue-success',
        });
        refreshQueueReadableState();
        syncActiveGroupSelectionAfterQueueLoad(state.activeGroupId);
        await refreshUploadGroupCounts();
        dedupeActiveGroupQueue('load-queue');
        renderProjectCategoryChips();
        renderUploadListOnly('loadQueueForActiveGroup:success');
        render();
        const visibleListItems = countRenderedUploadListItems(refs.listEl);
        ToolboxShell.appendLog(
          `[UPLOAD_RESTORE][DONE_RENDER_SYNC] activeGroupId=${state.activeGroupId || '-'} restored=${restoreStat.restored} visibleListItems=${visibleListItems}`,
        );
        reconcileIdleUploadFailureState('load-queue-success');
        logUploadQueueSnapshot('loadQueue:after-load');
      } catch (e) {
        if (isInvalidRestoreStateError(e)) {
          setQueueRestorePhase('failed', {
            groupId: state.activeGroupId,
            loadedOnce: false,
            reason: 'load-queue-invalid-restore-state',
          });
          resetDirtyUploadRestoreState('invalid-restore-state', true);
          dedupeActiveGroupQueue('load-queue-invalid-restore-state');
          syncActiveGroupCountInCache();
          render();
          reconcileIdleUploadFailureState('load-queue-invalid-restore-state');
          setStatus('上传队列恢复状态无效，已重置', 'warn', {
            owner: 'upload',
            shortText: '提醒',
            persist: false,
          });
          return;
        }

        setQueueRestorePhase('failed', {
          groupId: state.activeGroupId,
          loadedOnce: false,
          reason: 'load-queue-catch',
        });
        console.error('[ChatGPT toolbox] load upload queue for group failed', e);
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[UPLOAD_RESTORE][FAILED] activeGroupId=${state.activeGroupId || '-'} error=${e && e.stack ? e.stack : (e && e.message ? e.message : String(e))}`,
          );
        }
        dedupeActiveGroupQueue('load-queue');
        syncActiveGroupCountInCache();
        renderUploadListOnly('load-queue-catch:error');
        const sendPhaseOnRestoreError = String(state.sendTask && state.sendTask.phase || 'idle').trim().toLowerCase();
        const sendTaskActiveOnRestoreError = sendPhaseOnRestoreError !== 'idle'
          && sendPhaseOnRestoreError !== 'failed'
          && sendPhaseOnRestoreError !== 'cancelled';
        if (!sendTaskActiveOnRestoreError) {
          reconcileIdleUploadFailureState('load-queue-catch');
        } else if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[UPLOAD_RESTORE][SKIP_SEND_UI_RECONCILE] reason=load-queue-catch sendPhase=${sendPhaseOnRestoreError}`,
          );
        }
        setLastRestoreWarning(`上传队列恢复状态无效，已重置：${e && e.message ? e.message : String(e)}`, {
          reason: 'load-queue-catch',
          clearFailedStatus: true,
        });
        setStatus('上传队列恢复状态无效，已重置', 'warn', {
          owner: 'upload',
          shortText: '提醒',
          persist: false,
          source: 'load-queue-restore',
          suppressSendButtonFailure: true,
        });
        if (!sendTaskActiveOnRestoreError) {
          refreshUploadFailurePresentation('load-queue-catch');
        }
      }
    }

      return {
      openUploadFileHandleDb,
      saveUploadFileHandle,
      loadUploadFileHandle,
      deleteUploadFileHandle,
      getPersistedUploadState,
      getPersistedKindForItem,
      getRestoreStateForItem,
      resolveUploadBlobCandidate,
      hasPersistableUploadBlob,
      mergeQueueItemWithPersistedBlob,
      buildPersistRow,
      clearPersistedUploadBlobs,
      cleanupUploadDbGarbage,
      openDb,
      debugReadBackPersistedQueue,
      persistQueue,
      persistQueueItem,
      logPersistPerfIfSlow,
      scheduleRefreshUploadGroupCounts,
      scheduleCleanupUploadDbGarbage,
      schedulePersistQueueItem,
      schedulePersistQueue,
      awaitPersistQueueBriefly,
      persistQueueInBackground,
      persistQueueThrottled,
      schedulePersistQueueLight,
      scheduleRefreshUploadGroupCountsLight,
      persistGroups,
      loadGroups,
      loadQueueForActiveGroup,
      };
    }

    return { create };
  })();
