/**
 * Phase 2: extract upload-module.js functions into 5 store modules + thin wrappers.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODULE_PATH = path.join(ROOT, 'tampermonkey-userscript-src/upload/upload-module.js');
const OUT_DIR = path.join(ROOT, 'tampermonkey-userscript-src/upload');
const ORDER_PATH = path.join(ROOT, 'tampermonkey-userscript-src/.build-order.json');

const src = fs.readFileSync(MODULE_PATH, 'utf8');

function findFunctionBodyStart(source, fnIndex) {
  let i = fnIndex;
  let parenDepth = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth -= 1;
    else if (ch === '{' && parenDepth === 0) return i;
    i += 1;
  }
  return -1;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let i = openIndex;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (inSingle) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inDouble = false;
      i += 1;
      continue;
    }
    if (inTemplate) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '`') inTemplate = false;
      i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i += 1;
      continue;
    }

    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function extractFunction(source, name) {
  const re = new RegExp(`\\n    (async )?function ${name}\\s*\\(`);
  const match = re.exec(source);
  if (!match) return null;
  const fnStart = match.index + 1;
  const bodyOpen = findFunctionBodyStart(source, fnStart);
  if (bodyOpen < 0) return null;
  const bodyClose = findMatchingBrace(source, bodyOpen);
  if (bodyClose < 0) return null;
  return {
    text: source.slice(fnStart, bodyClose + 1),
    async: !!match[1],
    start: fnStart,
    end: bodyClose + 1,
  };
}

const REFS_REPLACE = {
  'upload-group-store.js': [
    ['uploadBroadcastChannel', 'refs.uploadBroadcastChannel'],
    ['uploadGlobalSyncInitialized', 'refs.uploadGlobalSyncInitialized'],
    ['pendingUploadGlobalSyncMessage', 'refs.pendingUploadGlobalSyncMessage'],
    ['lastManualUploadGroupAt', 'refs.lastManualUploadGroupAt'],
  ],
  'upload-persist-db.js': [
    ['dbPromise', 'refs.dbPromise'],
    ['persistQueuePromise', 'refs.persistQueuePromise'],
    ['persistQueueAllowEmptyReason', 'refs.persistQueueAllowEmptyReason'],
    ['uploadFileHandleDbPromise', 'refs.uploadFileHandleDbPromise'],
    ['uploadGroupCountsRefreshTimer', 'refs.uploadGroupCountsRefreshTimer'],
    ['uploadDbCleanupTimer', 'refs.uploadDbCleanupTimer'],
    ['persistQueueItemDirtyIds', 'refs.persistQueueItemDirtyIds'],
    ['persistQueueItemPendingStage', 'refs.persistQueueItemPendingStage'],
    ['persistQueueItemTimer', 'refs.persistQueueItemTimer'],
    ['persistQueuePendingStage', 'refs.persistQueuePendingStage'],
    ['persistQueueThrottleTimer', 'refs.persistQueueThrottleTimer'],
    ['uploadPersistLightTimer', 'refs.uploadPersistLightTimer'],
    ['uploadGroupCountLightTimer', 'refs.uploadGroupCountLightTimer'],
    ['lastPersistUserNotifyAt', 'refs.lastPersistUserNotifyAt'],
  ],
  'upload-render-list.js': [
    ['listEl', 'refs.listEl'],
    ['groupListEl', 'refs.groupListEl'],
    ['managePanelEl', 'refs.managePanelEl'],
    ['manageGroupListEl', 'refs.manageGroupListEl'],
    ['rootElRef', 'refs.rootElRef'],
  ],
};

const MODULE_DEPS = {
  'upload-queue-store.js': [
    'state', 'appendUploadLog', 'UploadState', 'UploadRestoreState', 'UploadPersistedKind',
    'isUploadDebugEnabled', 'normalizeUploadCompareName',
    'resolveUploadAttachmentPresenceLevel', 'findUploadGroupById', 'getActiveGroup',
    'getUploadGroupStableKey', 'getUploadFileFolderKey', 'saveMultiUploadLastSelection',
    'getMultiUploadLastSelection', 'logMultiUploadLastSelectionEvent', 'isFlaskLocalDirectItem',
    'hasReusableUploadSourceForReset', 'hasAttemptableUploadSource', 'newId',
    'logDirtyRestoreEntry', 'getRestoreDirtyValueText', 'setLastRestoreWarning',
    'isPlainObject', 'normalizeRestoreArray',
  ],
  'upload-group-store.js': [
    'state', 'appendUploadLog', 'appendUploadGroupLog', 'DEFAULT_UPLOAD_GROUP_NAME',
    'UPLOAD_GLOBAL_SYNC_KEY', 'UPLOAD_PROJECT_NAME_KEY_MAP', 'refs',
    'getActiveGroupId', 'getActiveGroupFiles', 'getLocalUploadFileCount', 'normalizeUploadItem',
    'syncUploadGroupAppState', 'scheduleRenderUpload', 'scheduleRenderUploadListOnly',
    'persistGroups', 'persistQueue', 'loadGroups', 'loadQueueForActiveGroup',
    'renderUploadListOnly', 'refreshUploadGroupDomRefs', 'syncGroupManagePanel',
    'renderProjectCategoryChips', 'renderUploadButtonsOnly', 'render', 'setStatus',
    'awaitPersistQueueBriefly', 'saveMultiUploadSelectionForActiveGroup',
    'refreshUploadGroupCounts', 'healStaleUploadRunningLockIfNeeded',
    'isUploadRunActuallyActive', 'hasActiveUploadInProgressOnQueue',
    'createId', 'withAllowedEmptyQueuePersist', 'openDb',
    'downloadJson', 'readJsonFile', 'groupNameInputElRef',
    'lastGroupNameInputValueRef', 'clearConfirmUntilRef', 'deleteConfirmUntilRef',
    'getMultiUploadLastSelection',
    'getSelectedFileIdForActiveGroup',
  ],
  'upload-persist-db.js': [
    'state', 'appendUploadLog', 'refs', 'UPLOAD_DB_MAX_GROUPS', 'UPLOAD_DB_MAX_QUEUE_ROWS',
    'UPLOAD_DB_EMPTY_GROUP_TTL_MS', 'UPLOAD_DB_FAILED_ROW_TTL_MS',
    'getActiveGroupId', 'getActiveGroupFiles', 'getUploadItemGroupId', 'normalizeUploadItem',
    'sanitizePersistedUploadRows', 'syncUploadItemSchemaInPlace', 'restoreUploadItemFromPersistRow',
    'buildUploadHandleKey', 'isFileHandleLike',
    'getQueueRestorePhase', 'shouldAllowEmptyQueuePersist', 'mergeActiveGroupQueueFromMemory',
    'setQueueRestorePhase', 'syncActiveGroupSelectionAfterQueueLoad',
    'isPlainObject', 'normalizeRestoreArray', 'normalizeRestoreObject',
    'logDirtyRestoreEntry', 'getRestoreDirtyValueText', 'setLastRestoreWarning', 'resetDirtyUploadRestoreState',
    'isInvalidRestoreStateError', 'safeAssignRestoreState', 'uploadTimers',
    'renderUploadListOnly', 'refreshUploadGroupCounts',
    'isUploadListDebugEnabled', 'isBlobLike', 'getObjectTag',
    'isUploadDebugEnabled', 'ensureUploadGroupStableKeys', 'createDefaultGroup',
    'resolveUploadGroupSelection', 'ensureActiveUploadGroupIdValid', 'syncUploadGroupAppState',
    'appendUploadGroupLog', 'scheduleRenderUpload',
    'setStatus', 'migrateLegacyUploadSelectionIfNeeded', 'getToolboxPageState',
    'saveGlobalUploadActiveGroupId', 'saveUploadLastActiveGroupId',
    'dedupeActiveGroupQueue', 'migrateMissingGroupIdRows', 'isStaleFailedUploadRow',
    'UploadPersistedKind', 'UploadRestoreState', 'UPLOAD_HANDLE_DB_NAME', 'UPLOAD_HANDLE_STORE',
    'UPLOAD_HANDLE_DB_VERSION', 'UPLOAD_PERSIST_TIMEOUT_MS', 'hasAttemptableUploadSource',
    'hasAttachmentEvidenceForItem', 'shouldPreserveMissingOrFailedState', 'isUploadUnfinishedState',
    'normalizeUploadState', 'isFlaskLocalDirectSource', 'isFlaskLocalDirectItem', 'isFileLike',
    'isPersistUploadBlobEnabled', 'getUploadItemSizeBytes', 'normalizeUploadRegistryStatus',
    'appendUploadSchemaAuditLog', 'broadcastUploadGlobalStateChanged', 'isProtectedUploadGroup',
    'syncActiveGroupCountInCache', 'logSlowOperation', 'withTimeout', 'sleep',
    'renderProjectCategoryChips', 'renderManageGroupList',
    'isComposerAttachmentReadyForUserVisibleUpload', 'clearUploadFailureStatusIndicators',
    'reconcileIdleUploadFailureState', 'refreshUploadFailurePresentation', 'refreshQueueReadableState',
    'isUploadCriticalNow', 'isUploadItemMissingSource', 'restoreMissingUploadItem',
    'logUploadQueueSnapshot', 'countRenderedUploadListItems', 'normalizePersistedKind',
    'render', 'newId',
  ],
  'upload-file-source.js': [
    'state', 'appendUploadLog', 'getActiveGroupId', 'getScopedQueueItemsForUpload',
    'normalizeUploadItem', 'syncUploadItemSchemaInPlace', 'loadUploadFileHandle',
    'deleteUploadFileHandle', 'getPersistedKindForItem',
    'getRestoreStateForItem', 'schedulePersistQueueItem',
    'scheduleRenderUploadListOnly', 'renderUploadListOnly',
    'UploadState', 'UploadRestoreState', 'UploadPersistedKind',
    'isFlaskLocalDirectSource', 'isFlaskLocalDirectItem',
    'isFileLike', 'isBlobLike', 'isUploadUnfinishedState',
    'normalizeUploadState', 'safeAssignRestoreState', 'isUploadDebugEnabled',
    'resetDirtyUploadRestoreState', 'normalizeRestoreObject', 'isPlainObject',
    'hasAttachmentEvidenceForItem', 'awaitPersistQueueBriefly',
    'persistQueueThrottled', 'getActiveUploadScopeGroupId', 'isUploadItemInActiveScope',
    'buildVirtualFilePrepareSource', 'isCadenceUploadSource', 'prepareVirtualUploadFileForItem',
    'isQueueItemAlreadyUploaded', 'isLegacyUploadItemAttached',
    'summarizeUploadAttachmentPresenceForScope', 'STRICT_UPLOAD_CACHE_FORBIDDEN_MESSAGE',
    'describeUploadSource', 'logUploadItemSource', 'getActiveGroupFiles',
    'refreshUploadGroupCounts', 'broadcastUploadGlobalStateChanged', 'render',
    'newId', 'createId', 'setStatus', 'scheduleRenderUpload', 'persistQueue',
    'openUploadFileHandleDb', 'getUploadItemGroupId',
    'getPendingUploadItemsForStart', 'UploadSelectors', 'qs',
  ],
  'upload-render-list.js': [
    'state', 'appendUploadLog', 'refs', 'getActiveGroupId', 'getActiveGroupFiles',
    'getSelectedFileIdForActiveGroup', 'getActiveGroup', 'getUploadGroupStableKey',
    'hasAttemptableUploadSource', 'isUploadItemLocallyUnreadable', 'getActiveGroupDbCount',
    'getQueueRestorePhase', 'diagnoseUploadListRender', 'uploadTimers', 'UploadSelectors',
    'qs', 'escapeHtml', 'formatFileSize', 'isUploadDebugEnabled', 'renderUploadButtonsOnly',
    'scheduleRenderUpload', 'setSelectedFileIdForActiveGroup', 'rebindUploadFile',
    'requestUploadFilePermission', 'removeFileFromCurrentGroup', 'switchGroup',
    'renameActiveGroupInline', 'deleteActiveGroupInline', 'clearActiveGroupQueueInline',
    'createGroupInline', 'ensureQueueReadyForVisibleUploadList', 'scheduleQueueRestoreForVisibleMismatch',
    'countRenderedUploadListItems', 'renderProjectCategoryChips', 'UPLOAD_PROJECT_NAME_KEY_MAP',
  ],
};

const MODULES = {
  'upload-queue-store.js': {
    constName: 'UploadQueueStore',
    ensureFn: 'ensureUploadQueueStore',
    header: 'UploadQueueStore：上传队列状态（不含 UI / 上传执行）',
    extraHelpers: ['isFlaskUploadGroupId', 'logNormalizedUploadItem', 'getUploadItemSchemaAuditData', 'appendUploadSchemaAuditLog'],
    functions: [
      'sanitizePersistedUploadRows',
      'getActiveGroupId',
      'getLocalUploadFileCount',
      'getActiveGroupFiles',
      'getCurrentGroupUploadNameSet',
      'getUploadItemGroupId',
      'normalizeUploadRegistryStatus',
      'normalizeUploadAttachState',
      'normalizeUploadComposerPresence',
      'normalizeUploadSendState',
      'applyUnifiedUploadAliases',
      'syncUploadItemSchemaInPlace',
      'normalizeUploadItem',
      'getUploadGroupById',
      'getActiveUploadScopeGroupId',
      'isUploadItemInActiveScope',
      'getScopedQueueItemsForUpload',
      'getScopedFlaskFilesForUpload',
      'hasActiveScopeUploadableFiles',
      'getSelectedFileIdForActiveGroup',
      'setSelectedFileIdForActiveGroup',
      'resolveSelectedFileIdForGroup',
      'syncActiveGroupSelectionAfterQueueLoad',
      'saveMultiUploadSelectionForActiveGroup',
    ],
  },
  'upload-group-store.js': {
    constName: 'UploadGroupStore',
    ensureFn: 'ensureUploadGroupStore',
    header: 'UploadGroupStore：上传分组管理（不含上传按钮）',
    functions: [
      'createDefaultGroup',
      'getActiveGroup',
      'getActiveGroupName',
      'normalizeUploadFolderPath',
      'deriveUploadGroupStableKey',
      'getUploadGroupStableKey',
      'getUploadFileFolderKey',
      'ensureUploadGroupStableKeys',
      'isValidUploadGroupId',
      'resolveUploadGroupSelection',
      'getLastManualUploadGroupId',
      'saveLastManualUploadGroupId',
      'saveUploadLastActiveGroupId',
      'saveGlobalUploadActiveGroupId',
      'getGlobalUploadActiveGroupId',
      'getUploadLastActiveGroupId',
      'broadcastUploadGlobalStateChanged',
      'applyUploadGlobalSyncMessage',
      'handleUploadGlobalSyncMessage',
      'flushPendingUploadGlobalSync',
      'initUploadGlobalSync',
      'switchGroup',
      'buildRandomGroupName',
      'buildNextGroupName',
      'createGroupInline',
      'renameActiveGroupInline',
      'deleteGroupQueue',
      'clearActiveGroupQueueInline',
      'deleteActiveGroupInline',
      'removeFileFromCurrentGroup',
      'exportGroupsAndQueueMeta',
      'importGroupsAndQueueMeta',
    ],
  },
  'upload-persist-db.js': {
    constName: 'UploadPersistDb',
    ensureFn: 'ensureUploadPersistDb',
    header: 'UploadPersistDb：上传队列 IndexedDB / localStorage 持久化',
    functions: [
      'openUploadFileHandleDb',
      'saveUploadFileHandle',
      'loadUploadFileHandle',
      'deleteUploadFileHandle',
      'getPersistedUploadState',
      'getPersistedKindForItem',
      'getRestoreStateForItem',
      'resolveUploadBlobCandidate',
      'hasPersistableUploadBlob',
      'mergeQueueItemWithPersistedBlob',
      'buildPersistRow',
      'clearPersistedUploadBlobs',
      'cleanupUploadDbGarbage',
      'openDb',
      'debugReadBackPersistedQueue',
      'persistQueue',
      'persistQueueItem',
      'logPersistPerfIfSlow',
      'scheduleRefreshUploadGroupCounts',
      'scheduleCleanupUploadDbGarbage',
      'schedulePersistQueueItem',
      'schedulePersistQueue',
      'awaitPersistQueueBriefly',
      'persistQueueInBackground',
      'persistQueueThrottled',
      'schedulePersistQueueLight',
      'scheduleRefreshUploadGroupCountsLight',
      'persistGroups',
      'loadGroups',
      'loadQueueForActiveGroup',
    ],
  },
  'upload-file-source.js': {
    constName: 'UploadFileSource',
    ensureFn: 'ensureUploadFileSource',
    header: 'UploadFileSource：文件来源、权限、可读性与重绑',
    functions: [
      'isFileHandleLike',
      'getPageWindowForFilePicker',
      'getShowOpenFilePickerFn',
      'buildUploadHandleKey',
      'hasActuallyReusableUploadSource',
      'hasReusableUploadSourceForReset',
      'markUploadItemNeedsRebind',
      'ensureReusableFileForUploadItem',
      'getPendingUploadItemsForStart',
      'diagnoseNoPendingUploadItems',
      'resolveNoPendingUploadResult',
      'canReadFromLocal',
      'isUploadItemAttemptable',
      'hasAttemptableUploadSource',
      'getUploadLocalFileDiagnostics',
      'hasReadableFreshLocalSource',
      'clearStaleUnreadableFlagsForReadableItem',
      'hasLocalReadableHandle',
      'isUploadSourceCacheForbidden',
      'isCachedUploadSnapshot',
      'markCacheForbiddenUploadItems',
      'blockUploadIfCacheSourcesPresent',
      'isUploadItemLocallyUnreadable',
      'restoreHandleBackedUploadItem',
      'restoreMissingUploadItem',
      'restoreUploadItemFromPersistRow',
      'readFreshFile',
      'prepareFilesForAttach',
      'pickOneLocalFileByInput',
      'pickLocalFilesByInputMultiple',
      'pickLocalFilesWithHandlesForAdd',
      'pickOneLocalFileWithHandle',
      'pickOneLocalFileForRebind',
      'validateRebindFile',
      'applyReboundFile',
      'rebindUploadFile',
      'requestUploadFilePermission',
      'throwStrictCacheForbidden',
      'resolveFlaskLocalDirectDownloadUrl',
      'hasStrictLocalCachePayload',
      'resolveStrictLocalUploadFile',
    ],
  },
  'upload-render-list.js': {
    constName: 'UploadRenderList',
    ensureFn: 'ensureUploadRenderList',
    header: 'UploadRenderList：上传列表与分组 chip UI 渲染',
    functions: [
      'buildFlaskUploadListHtml',
      'buildUploadQueueItemHtml',
      'buildUploadListHtml',
      'getUploadListItemsToRender',
      'buildLimitedUploadQueueListHtml',
      'renderUploadListOnly',
      'updateUploadListItemDom',
      'scheduleRenderUploadListOnly',
      'renderUploadGroupChipHtml',
      'renderProjectCategoryChipHtml',
      'renderUploadGroupFallbackChipHtml',
      'renderProjectCategoryChips',
      'renderManageGroupList',
      'syncGroupManagePanel',
      'refreshUploadGroupDomRefs',
      'toggleGroupManagePanel',
    ],
  },
};

function makeWrapper(name, async, ensureFn) {
  if (async) {
    return `    async function ${name}(...args) {\n      return ${ensureFn}().${name}(...args);\n    }`;
  }
  return `    function ${name}(...args) {\n      return ${ensureFn}().${name}(...args);\n    }`;
}

const allReplacements = [];
const report = [];

for (const [fileName, cfg] of Object.entries(MODULES)) {
  const fnList = [...(cfg.functions || []), ...(cfg.extraHelpers || [])];
  const extracted = [];
  const missing = [];

  for (const fn of fnList) {
    const item = extractFunction(src, fn);
    if (!item) {
      missing.push(fn);
      continue;
    }
    extracted.push({ name: fn, ...item });
  }

  const exportNames = cfg.functions.filter((n) => !missing.includes(n));
  const helperNames = (cfg.extraHelpers || []).filter((n) => !missing.includes(n));
  const exportSet = new Set([...exportNames, ...helperNames]);
  const depKeys = (MODULE_DEPS[fileName] || ['state']).filter((k) => !exportSet.has(k));
  const preamble = depKeys.map((k) => `      const ${k} = deps.${k};`).join('\n');
  const refRules = REFS_REPLACE[fileName] || [];

  const bodyParts = extracted.map((e) => {
    let text = e.text;
    for (const [from, to] of refRules) {
      text = text.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
    }
    return text;
  });

  const returnObj = exportNames.map((n) => `      ${n},`).join('\n');
  const content = `  /********************************************************************
   * ${cfg.header}
   ********************************************************************/

  const ${cfg.constName} = (() => {
    function create(deps) {
${preamble}

${bodyParts.join('\n\n')}

      return {
${returnObj}
      };
    }

    return { create };
  })();
`;

  fs.writeFileSync(path.join(OUT_DIR, fileName), content, 'utf8');
  const lines = content.split('\n').length;
  report.push(`${fileName}: ${exportNames.length} exported, ${helperNames.length} helpers internal, ${lines} lines, missing=[${missing.join(', ')}]`);

  for (const e of extracted) {
    if (!cfg.functions.includes(e.name)) continue;
    allReplacements.push({
      start: e.start,
      end: e.end,
      replacement: makeWrapper(e.name, e.async, cfg.ensureFn),
      name: e.name,
    });
  }
}

// Sort replacements reverse by start so offsets stay valid
allReplacements.sort((a, b) => b.start - a.start);

let patched = src;
for (const r of allReplacements) {
  patched = patched.slice(0, r.start) + '\n' + r.replacement + patched.slice(r.end);
}

// Inject store bootstrap after appendUploadLog
const injectMarker = '    function appendUploadLog(message) {';

const bootstrap = `
    const uploadModuleRefs = {
      get dbPromise() { return dbPromise; },
      set dbPromise(v) { dbPromise = v; },
      get persistQueuePromise() { return persistQueuePromise; },
      set persistQueuePromise(v) { persistQueuePromise = v; },
      get persistQueueAllowEmptyReason() { return persistQueueAllowEmptyReason; },
      set persistQueueAllowEmptyReason(v) { persistQueueAllowEmptyReason = v; },
      get uploadBroadcastChannel() { return uploadBroadcastChannel; },
      set uploadBroadcastChannel(v) { uploadBroadcastChannel = v; },
      get uploadGlobalSyncInitialized() { return uploadGlobalSyncInitialized; },
      set uploadGlobalSyncInitialized(v) { uploadGlobalSyncInitialized = v; },
      get pendingUploadGlobalSyncMessage() { return pendingUploadGlobalSyncMessage; },
      set pendingUploadGlobalSyncMessage(v) { pendingUploadGlobalSyncMessage = v; },
      get lastManualUploadGroupAt() { return lastManualUploadGroupAt; },
      set lastManualUploadGroupAt(v) { lastManualUploadGroupAt = v; },
      get listEl() { return listEl; },
      set listEl(v) { listEl = v; },
      get groupListEl() { return groupListEl; },
      set groupListEl(v) { groupListEl = v; },
      get managePanelEl() { return managePanelEl; },
      set managePanelEl(v) { managePanelEl = v; },
      get manageGroupListEl() { return manageGroupListEl; },
      set manageGroupListEl(v) { manageGroupListEl = v; },
      get rootElRef() { return rootElRef; },
      set rootElRef(v) { rootElRef = v; },
      get uploadFileHandleDbPromise() { return uploadFileHandleDbPromise; },
      set uploadFileHandleDbPromise(v) { uploadFileHandleDbPromise = v; },
      get uploadGroupCountsRefreshTimer() { return uploadGroupCountsRefreshTimer; },
      set uploadGroupCountsRefreshTimer(v) { uploadGroupCountsRefreshTimer = v; },
      get uploadDbCleanupTimer() { return uploadDbCleanupTimer; },
      set uploadDbCleanupTimer(v) { uploadDbCleanupTimer = v; },
      get persistQueueItemDirtyIds() { return persistQueueItemDirtyIds; },
      set persistQueueItemDirtyIds(v) { persistQueueItemDirtyIds = v; },
      get persistQueueItemPendingStage() { return persistQueueItemPendingStage; },
      set persistQueueItemPendingStage(v) { persistQueueItemPendingStage = v; },
      get persistQueueItemTimer() { return persistQueueItemTimer; },
      set persistQueueItemTimer(v) { persistQueueItemTimer = v; },
      get persistQueuePendingStage() { return persistQueuePendingStage; },
      set persistQueuePendingStage(v) { persistQueuePendingStage = v; },
      get persistQueueThrottleTimer() { return persistQueueThrottleTimer; },
      set persistQueueThrottleTimer(v) { persistQueueThrottleTimer = v; },
      get uploadPersistLightTimer() { return uploadPersistLightTimer; },
      set uploadPersistLightTimer(v) { uploadPersistLightTimer = v; },
      get uploadGroupCountLightTimer() { return uploadGroupCountLightTimer; },
      set uploadGroupCountLightTimer(v) { uploadGroupCountLightTimer = v; },
      get lastPersistUserNotifyAt() { return lastPersistUserNotifyAt; },
      set lastPersistUserNotifyAt(v) { lastPersistUserNotifyAt = v; },
    };

    let uploadQueueStoreInstance = null;
    let uploadGroupStoreInstance = null;
    let uploadPersistDbInstance = null;
    let uploadFileSourceInstance = null;
    let uploadRenderListInstance = null;

    function ensureUploadQueueStore() {
      if (uploadQueueStoreInstance) return uploadQueueStoreInstance;
      uploadQueueStoreInstance = UploadQueueStore.create({
        state,
        appendUploadLog,
        UploadState,
        UploadRestoreState,
        UploadPersistedKind,
        isUploadDebugEnabled,
        normalizeUploadCompareName,
        resolveUploadAttachmentPresenceLevel,
        findUploadGroupById,
        getActiveGroup: () => ensureUploadGroupStore().getActiveGroup(),
        getUploadGroupStableKey: (...a) => ensureUploadGroupStore().getUploadGroupStableKey(...a),
        getUploadFileFolderKey: (...a) => ensureUploadGroupStore().getUploadFileFolderKey(...a),
        saveMultiUploadLastSelection,
        getMultiUploadLastSelection,
        logMultiUploadLastSelectionEvent,
        isFlaskLocalDirectItem,
        hasReusableUploadSourceForReset: (...a) => ensureUploadFileSource().hasReusableUploadSourceForReset(...a),
        hasAttemptableUploadSource: (...a) => ensureUploadFileSource().hasAttemptableUploadSource(...a),
        newId,
        logDirtyRestoreEntry,
        getRestoreDirtyValueText,
        setLastRestoreWarning,
        isPlainObject,
        normalizeRestoreArray,
      });
      return uploadQueueStoreInstance;
    }

    function ensureUploadGroupStore() {
      if (uploadGroupStoreInstance) return uploadGroupStoreInstance;
      uploadGroupStoreInstance = UploadGroupStore.create({
        state,
        appendUploadLog,
        appendUploadGroupLog,
        DEFAULT_UPLOAD_GROUP_NAME,
        UPLOAD_GLOBAL_SYNC_KEY,
        UPLOAD_PROJECT_NAME_KEY_MAP,
        refs: uploadModuleRefs,
        getMultiUploadLastSelection,
        getActiveGroupId: () => ensureUploadQueueStore().getActiveGroupId(),
        getActiveGroupFiles: () => ensureUploadQueueStore().getActiveGroupFiles(),
        getSelectedFileIdForActiveGroup: () => ensureUploadQueueStore().getSelectedFileIdForActiveGroup(),
        getLocalUploadFileCount: (...a) => ensureUploadQueueStore().getLocalUploadFileCount(...a),
        normalizeUploadItem: (...a) => ensureUploadQueueStore().normalizeUploadItem(...a),
        syncUploadGroupAppState,
        scheduleRenderUpload,
        scheduleRenderUploadListOnly: (...a) => ensureUploadRenderList().scheduleRenderUploadListOnly(...a),
        persistGroups: (...a) => ensureUploadPersistDb().persistGroups(...a),
        persistQueue: (...a) => ensureUploadPersistDb().persistQueue(...a),
        loadGroups: (...a) => ensureUploadPersistDb().loadGroups(...a),
        loadQueueForActiveGroup: (...a) => ensureUploadPersistDb().loadQueueForActiveGroup(...a),
        renderUploadListOnly: (...a) => ensureUploadRenderList().renderUploadListOnly(...a),
        refreshUploadGroupDomRefs: (...a) => ensureUploadRenderList().refreshUploadGroupDomRefs(...a),
        syncGroupManagePanel: (...a) => ensureUploadRenderList().syncGroupManagePanel(...a),
        renderProjectCategoryChips: (...a) => ensureUploadRenderList().renderProjectCategoryChips(...a),
        renderUploadButtonsOnly,
        render,
        setStatus,
        awaitPersistQueueBriefly: (...a) => ensureUploadPersistDb().awaitPersistQueueBriefly(...a),
        saveMultiUploadSelectionForActiveGroup: (...a) => ensureUploadQueueStore().saveMultiUploadSelectionForActiveGroup(...a),
        refreshUploadGroupCounts,
        healStaleUploadRunningLockIfNeeded,
        isUploadRunActuallyActive,
        hasActiveUploadInProgressOnQueue,
        createId,
        withAllowedEmptyQueuePersist,
        clearActiveGroupQueueInline: (...a) => ensureUploadGroupStore().clearActiveGroupQueueInline(...a),
        deleteGroupQueue: (...a) => ensureUploadGroupStore().deleteGroupQueue(...a),
        downloadJson,
        readJsonFile,
        groupNameInputElRef: () => groupNameInputEl,
        lastGroupNameInputValueRef: () => lastGroupNameInputValue,
        clearConfirmUntilRef: () => clearConfirmUntil,
        deleteConfirmUntilRef: () => deleteConfirmUntil,
      });
      return uploadGroupStoreInstance;
    }

    function ensureUploadPersistDb() {
      if (uploadPersistDbInstance) return uploadPersistDbInstance;
      uploadPersistDbInstance = UploadPersistDb.create({
        state,
        appendUploadLog,
        refs: uploadModuleRefs,
        UPLOAD_DB_MAX_GROUPS,
        UPLOAD_DB_MAX_QUEUE_ROWS,
        UPLOAD_DB_EMPTY_GROUP_TTL_MS,
        UPLOAD_DB_FAILED_ROW_TTL_MS,
        getActiveGroupId: () => ensureUploadQueueStore().getActiveGroupId(),
        getActiveGroupFiles: () => ensureUploadQueueStore().getActiveGroupFiles(),
        getUploadItemGroupId: (...a) => ensureUploadQueueStore().getUploadItemGroupId(...a),
        normalizeUploadItem: (...a) => ensureUploadQueueStore().normalizeUploadItem(...a),
        sanitizePersistedUploadRows: (...a) => ensureUploadQueueStore().sanitizePersistedUploadRows(...a),
        syncUploadItemSchemaInPlace: (...a) => ensureUploadQueueStore().syncUploadItemSchemaInPlace(...a),
        restoreUploadItemFromPersistRow: (...a) => ensureUploadFileSource().restoreUploadItemFromPersistRow(...a),
        buildUploadHandleKey: (...a) => ensureUploadFileSource().buildUploadHandleKey(...a),
        isFileHandleLike: (...a) => ensureUploadFileSource().isFileHandleLike(...a),
        saveUploadFileHandle: (...a) => ensureUploadPersistDb().saveUploadFileHandle(...a),
        getQueueRestorePhase,
        shouldAllowEmptyQueuePersist,
        mergeActiveGroupQueueFromMemory,
        setQueueRestorePhase,
        syncActiveGroupSelectionAfterQueueLoad: (...a) => ensureUploadQueueStore().syncActiveGroupSelectionAfterQueueLoad(...a),
        isPlainObject,
        normalizeRestoreArray,
        normalizeRestoreObject,
        logDirtyRestoreEntry,
        setLastRestoreWarning,
        resetDirtyUploadRestoreState,
        isInvalidRestoreStateError,
        safeAssignRestoreState,
        uploadTimers,
        scheduleRefreshUploadGroupCountsLight: (...a) => ensureUploadPersistDb().scheduleRefreshUploadGroupCountsLight(...a),
        renderUploadListOnly: (...a) => ensureUploadRenderList().renderUploadListOnly(...a),
        refreshUploadGroupCounts,
        isUploadListDebugEnabled,
        isBlobLike,
        getObjectTag,
        isUploadDebugEnabled,
        ensureUploadGroupStableKeys: (...a) => ensureUploadGroupStore().ensureUploadGroupStableKeys(...a),
        createDefaultGroup: (...a) => ensureUploadGroupStore().createDefaultGroup(...a),
        resolveUploadGroupSelection: (...a) => ensureUploadGroupStore().resolveUploadGroupSelection(...a),
        ensureActiveUploadGroupIdValid,
        syncUploadGroupAppState,
        appendUploadGroupLog,
        scheduleRenderUpload,
        setStatus,
        migrateLegacyUploadSelectionIfNeeded,
        getToolboxPageState: () => {
          if (typeof getToolboxPageState === 'function') {
            return getToolboxPageState();
          }
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog('[UPLOAD_GROUP][WARN] getToolboxPageState missing, fallback empty page state');
          }
          return {};
        },
        saveGlobalUploadActiveGroupId,
        saveUploadLastActiveGroupId,
        dedupeActiveGroupQueue,
        migrateMissingGroupIdRows,
        isStaleFailedUploadRow,
        UploadPersistedKind,
        UploadRestoreState,
        UPLOAD_HANDLE_DB_NAME,
        UPLOAD_HANDLE_STORE,
        UPLOAD_HANDLE_DB_VERSION,
        UPLOAD_PERSIST_TIMEOUT_MS,
        hasAttemptableUploadSource: (...a) => ensureUploadFileSource().hasAttemptableUploadSource(...a),
        hasAttachmentEvidenceForItem,
        shouldPreserveMissingOrFailedState,
        isUploadUnfinishedState,
        normalizeUploadState,
        isFlaskLocalDirectSource,
        isFlaskLocalDirectItem,
        isFileLike,
        isPersistUploadBlobEnabled,
        getUploadItemSizeBytes,
        normalizeUploadRegistryStatus: (...a) => ensureUploadQueueStore().normalizeUploadRegistryStatus(...a),
        appendUploadSchemaAuditLog,
        broadcastUploadGlobalStateChanged: (...a) => ensureUploadGroupStore().broadcastUploadGlobalStateChanged(...a),
        isProtectedUploadGroup,
        syncActiveGroupCountInCache,
        logSlowOperation,
        withTimeout,
        sleep,
        renderProjectCategoryChips,
        renderManageGroupList,
        isComposerAttachmentReadyForUserVisibleUpload,
        clearUploadFailureStatusIndicators,
        reconcileIdleUploadFailureState,
        refreshUploadFailurePresentation,
        refreshQueueReadableState,
        isUploadCriticalNow,
        isUploadItemMissingSource,
        restoreMissingUploadItem: (...a) => ensureUploadFileSource().restoreMissingUploadItem(...a),
        logUploadQueueSnapshot,
        countRenderedUploadListItems,
        normalizePersistedKind,
        render,
        newId,
      });
      return uploadPersistDbInstance;
    }

    function ensureUploadFileSource() {
      if (uploadFileSourceInstance) return uploadFileSourceInstance;
      uploadFileSourceInstance = UploadFileSource.create({
        state,
        appendUploadLog,
        getActiveGroupId: () => ensureUploadQueueStore().getActiveGroupId(),
        getScopedQueueItemsForUpload: (...a) => ensureUploadQueueStore().getScopedQueueItemsForUpload(...a),
        normalizeUploadItem: (...a) => ensureUploadQueueStore().normalizeUploadItem(...a),
        syncUploadItemSchemaInPlace: (...a) => ensureUploadQueueStore().syncUploadItemSchemaInPlace(...a),
        loadUploadFileHandle: (...a) => ensureUploadPersistDb().loadUploadFileHandle(...a),
        saveUploadFileHandle: (...a) => ensureUploadPersistDb().saveUploadFileHandle(...a),
        deleteUploadFileHandle: (...a) => ensureUploadPersistDb().deleteUploadFileHandle(...a),
        getPersistedKindForItem: (...a) => ensureUploadPersistDb().getPersistedKindForItem(...a),
        getRestoreStateForItem: (...a) => ensureUploadPersistDb().getRestoreStateForItem(...a),
        resolveUploadBlobCandidate: (...a) => ensureUploadPersistDb().resolveUploadBlobCandidate(...a),
        schedulePersistQueueItem: (...a) => ensureUploadPersistDb().schedulePersistQueueItem(...a),
        scheduleRenderUploadListOnly: (...a) => ensureUploadRenderList().scheduleRenderUploadListOnly(...a),
        renderUploadListOnly: (...a) => ensureUploadRenderList().renderUploadListOnly(...a),

        UploadState,
        UploadRestoreState,
        UploadPersistedKind,

        isFlaskLocalDirectSource,
        isFlaskLocalDirectItem,
        isFileLike,
        isBlobLike,
        isUploadUnfinishedState,
        normalizeUploadState,
        safeAssignRestoreState,
        isUploadDebugEnabled,
        resetDirtyUploadRestoreState,
        normalizeRestoreObject,
        isPlainObject,
        hasAttachmentEvidenceForItem,
        awaitPersistQueueBriefly: (...a) => ensureUploadPersistDb().awaitPersistQueueBriefly(...a),
        persistQueueThrottled,
        getActiveUploadScopeGroupId: (...a) => ensureUploadQueueStore().getActiveUploadScopeGroupId(...a),
        isUploadItemInActiveScope: (...a) => ensureUploadQueueStore().isUploadItemInActiveScope(...a),
        buildVirtualFilePrepareSource,
        isCadenceUploadSource,
        prepareVirtualUploadFileForItem,
        isQueueItemAlreadyUploaded,
        isLegacyUploadItemAttached,
        summarizeUploadAttachmentPresenceForScope,
        STRICT_UPLOAD_CACHE_FORBIDDEN_MESSAGE,
        describeUploadSource,
        logUploadItemSource,
        getActiveGroupFiles: () => ensureUploadQueueStore().getActiveGroupFiles(),
        refreshUploadGroupCounts,
        broadcastUploadGlobalStateChanged: (...a) => ensureUploadGroupStore().broadcastUploadGlobalStateChanged(...a),
        render,

        newId,
        createId,
        setStatus,
        scheduleRenderUpload,
        persistQueue: (...a) => ensureUploadPersistDb().persistQueue(...a),
        openUploadFileHandleDb: (...a) => ensureUploadPersistDb().openUploadFileHandleDb(...a),
        buildUploadHandleKey: (...a) => ensureUploadFileSource().buildUploadHandleKey(...a),
        getUploadItemGroupId: (...a) => ensureUploadQueueStore().getUploadItemGroupId(...a),
        markUploadItemNeedsRebind: (...a) => ensureUploadFileSource().markUploadItemNeedsRebind(...a),
        hasActuallyReusableUploadSource: (...a) => ensureUploadFileSource().hasActuallyReusableUploadSource(...a),
        canReadFromLocal: (...a) => ensureUploadFileSource().canReadFromLocal(...a),
        isUploadSourceCacheForbidden: (...a) => ensureUploadFileSource().isUploadSourceCacheForbidden(...a),
        isCachedUploadSnapshot: (...a) => ensureUploadFileSource().isCachedUploadSnapshot(...a),
        hasLocalReadableHandle: (...a) => ensureUploadFileSource().hasLocalReadableHandle(...a),
        hasReadableFreshLocalSource: (...a) => ensureUploadFileSource().hasReadableFreshLocalSource(...a),
        isUploadItemLocallyUnreadable: (...a) => ensureUploadFileSource().isUploadItemLocallyUnreadable(...a),
        throwStrictCacheForbidden: (...a) => ensureUploadFileSource().throwStrictCacheForbidden(...a),
        resolveFlaskLocalDirectDownloadUrl: (...a) => ensureUploadFileSource().resolveFlaskLocalDirectDownloadUrl(...a),
        hasStrictLocalCachePayload: (...a) => ensureUploadFileSource().hasStrictLocalCachePayload(...a),
        validateRebindFile: (...a) => ensureUploadFileSource().validateRebindFile(...a),
        applyReboundFile: (...a) => ensureUploadFileSource().applyReboundFile(...a),
        restoreHandleBackedUploadItem: (...a) => ensureUploadFileSource().restoreHandleBackedUploadItem(...a),
        restoreMissingUploadItem: (...a) => ensureUploadFileSource().restoreMissingUploadItem(...a),
        clearStaleUnreadableFlagsForReadableItem: (...a) => ensureUploadFileSource().clearStaleUnreadableFlagsForReadableItem(...a),
        ensureReusableFileForUploadItem: (...a) => ensureUploadFileSource().ensureReusableFileForUploadItem(...a),
        getPendingUploadItemsForStart: (...a) => ensureUploadFileSource().getPendingUploadItemsForStart(...a),
        UploadSelectors,
        qs,
      });
      return uploadFileSourceInstance;
    }

    function ensureUploadRenderList() {
      if (uploadRenderListInstance) return uploadRenderListInstance;
      uploadRenderListInstance = UploadRenderList.create({
        state,
        appendUploadLog,
        refs: uploadModuleRefs,
        getActiveGroupId: () => ensureUploadQueueStore().getActiveGroupId(),
        getActiveGroupFiles: () => ensureUploadQueueStore().getActiveGroupFiles(),
        getSelectedFileIdForActiveGroup: () => ensureUploadQueueStore().getSelectedFileIdForActiveGroup(),
        getActiveGroup: () => ensureUploadGroupStore().getActiveGroup(),
        getUploadGroupStableKey: (...a) => ensureUploadGroupStore().getUploadGroupStableKey(...a),
        hasAttemptableUploadSource: (...a) => ensureUploadFileSource().hasAttemptableUploadSource(...a),
        isUploadItemLocallyUnreadable: (...a) => ensureUploadFileSource().isUploadItemLocallyUnreadable(...a),
        getActiveGroupDbCount,
        getQueueRestorePhase,
        diagnoseUploadListRender,
        uploadTimers,
        UploadSelectors,
        qs,
        escapeHtml,
        formatFileSize,
        isUploadDebugEnabled,
        renderUploadButtonsOnly,
        scheduleRenderUpload,
        setSelectedFileIdForActiveGroup: (...a) => ensureUploadQueueStore().setSelectedFileIdForActiveGroup(...a),
        rebindUploadFile: (...a) => ensureUploadFileSource().rebindUploadFile(...a),
        requestUploadFilePermission: (...a) => ensureUploadFileSource().requestUploadFilePermission(...a),
        removeFileFromCurrentGroup: (...a) => ensureUploadGroupStore().removeFileFromCurrentGroup(...a),
        switchGroup: (...a) => ensureUploadGroupStore().switchGroup(...a),
        renameActiveGroupInline: (...a) => ensureUploadGroupStore().renameActiveGroupInline(...a),
        deleteActiveGroupInline: (...a) => ensureUploadGroupStore().deleteActiveGroupInline(...a),
        clearActiveGroupQueueInline: (...a) => ensureUploadGroupStore().clearActiveGroupQueueInline(...a),
        createGroupInline: (...a) => ensureUploadGroupStore().createGroupInline(...a),
        ensureQueueReadyForVisibleUploadList,
        scheduleQueueRestoreForVisibleMismatch,
        countRenderedUploadListItems,
        buildUploadQueueItemHtml: (...a) => ensureUploadRenderList().buildUploadQueueItemHtml(...a),
        getUploadListItemsToRender: (...a) => ensureUploadRenderList().getUploadListItemsToRender(...a),
        buildLimitedUploadQueueListHtml: (...a) => ensureUploadRenderList().buildLimitedUploadQueueListHtml(...a),
        renderProjectCategoryChips: (...a) => ensureUploadRenderList().renderProjectCategoryChips(...a),
        toggleGroupManagePanel: (...a) => ensureUploadRenderList().toggleGroupManagePanel(...a),
        renderManageGroupList: (...a) => ensureUploadRenderList().renderManageGroupList(...a),
        syncGroupManagePanel: (...a) => ensureUploadRenderList().syncGroupManagePanel(...a),
        UPLOAD_PROJECT_NAME_KEY_MAP,
      });
      return uploadRenderListInstance;
    }

`;

// Find appendUploadLog closing brace - inject after it
const appendLogStart = patched.indexOf(injectMarker);
const appendLogBodyOpen = findFunctionBodyStart(patched, appendLogStart);
const appendLogEnd = findMatchingBrace(patched, appendLogBodyOpen) + 1;

patched = patched.slice(0, appendLogEnd) + bootstrap + patched.slice(appendLogEnd);

fs.writeFileSync(MODULE_PATH, patched, 'utf8');

// Update build order
const order = JSON.parse(fs.readFileSync(ORDER_PATH, 'utf8'));
const insertBefore = 'upload/upload-module.js';
const newParts = [
  'upload/upload-queue-store.js',
  'upload/upload-group-store.js',
  'upload/upload-persist-db.js',
  'upload/upload-file-source.js',
  'upload/upload-render-list.js',
];
const idx = order.parts.indexOf(insertBefore);
if (idx < 0) throw new Error('upload-module.js not in build order');
const filtered = order.parts.filter((p) => !newParts.includes(p));
const insertAt = filtered.indexOf(insertBefore);
filtered.splice(insertAt, 0, ...newParts);
order.parts = filtered;
fs.writeFileSync(ORDER_PATH, JSON.stringify(order, null, 2) + '\n', 'utf8');

console.log('Phase 2 split generated.\n');
report.forEach((line) => console.log(line));
console.log(`\nReplaced ${allReplacements.length} functions with wrappers in upload-module.js`);
console.log('Updated .build-order.json');
