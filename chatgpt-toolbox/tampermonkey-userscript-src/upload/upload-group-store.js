  /********************************************************************
   * UploadGroupStore：上传分组管理（不含上传按钮）
   ********************************************************************/

  const UploadGroupStore = (() => {
    function create(deps) {
      const state = deps.state;
      const appendUploadLog = deps.appendUploadLog;
      const appendUploadGroupLog = deps.appendUploadGroupLog;
      const DEFAULT_UPLOAD_GROUP_NAME = deps.DEFAULT_UPLOAD_GROUP_NAME;
      const UPLOAD_GLOBAL_SYNC_KEY = deps.UPLOAD_GLOBAL_SYNC_KEY;
      const UPLOAD_PROJECT_NAME_KEY_MAP = deps.UPLOAD_PROJECT_NAME_KEY_MAP;
      const refs = deps.refs;
      const getActiveGroupId = deps.getActiveGroupId;
      const getActiveGroupFiles = deps.getActiveGroupFiles;
      const getSelectedFileIdForActiveGroup = deps.getSelectedFileIdForActiveGroup;
      if (typeof getSelectedFileIdForActiveGroup !== 'function') {
        throw new Error('UploadGroupStore missing dependency: getSelectedFileIdForActiveGroup');
      }
      const getLocalUploadFileCount = deps.getLocalUploadFileCount;
      const normalizeUploadItem = deps.normalizeUploadItem;
      const syncUploadGroupAppState = deps.syncUploadGroupAppState;
      const scheduleRenderUpload = deps.scheduleRenderUpload;
      const scheduleRenderUploadListOnly = deps.scheduleRenderUploadListOnly;
      const persistGroups = deps.persistGroups;
      const persistQueue = deps.persistQueue;
      const loadGroups = deps.loadGroups;
      const loadQueueForActiveGroup = deps.loadQueueForActiveGroup;
      const renderUploadListOnly = deps.renderUploadListOnly;
      const refreshUploadGroupDomRefs = deps.refreshUploadGroupDomRefs;
      const syncGroupManagePanel = deps.syncGroupManagePanel;
      const renderProjectCategoryChips = deps.renderProjectCategoryChips;
      const renderUploadButtonsOnly = deps.renderUploadButtonsOnly;
      const render = deps.render;
      const setStatus = deps.setStatus;
      const getMultiUploadLastSelection = deps.getMultiUploadLastSelection;

      if (typeof getMultiUploadLastSelection !== 'function') {
        throw new Error('UploadGroupStore missing dependency: getMultiUploadLastSelection');
      }

      const awaitPersistQueueBriefly = deps.awaitPersistQueueBriefly;
      const deleteUploadQueueRowById = deps.deleteUploadQueueRowById;
      const markUploadFileDeletedTombstone = deps.markUploadFileDeletedTombstone;
      const clearUploadFileDeletedTombstone = deps.clearUploadFileDeletedTombstone;
      const isUploadFileDeletedByTombstone = deps.isUploadFileDeletedByTombstone;
      [
        ['deleteUploadQueueRowById', deleteUploadQueueRowById],
        ['markUploadFileDeletedTombstone', markUploadFileDeletedTombstone],
        ['clearUploadFileDeletedTombstone', clearUploadFileDeletedTombstone],
        ['isUploadFileDeletedByTombstone', isUploadFileDeletedByTombstone],
      ].forEach(([name, fn]) => {
        if (typeof fn !== 'function') {
          throw new Error(`UploadGroupStore missing dependency: ${name}`);
        }
      });
      const saveMultiUploadSelectionForActiveGroup = deps.saveMultiUploadSelectionForActiveGroup;
      const refreshUploadGroupCounts = deps.refreshUploadGroupCounts;
      const healStaleUploadRunningLockIfNeeded = deps.healStaleUploadRunningLockIfNeeded;
      const isUploadRunActuallyActive = deps.isUploadRunActuallyActive;
      const hasActiveUploadInProgressOnQueue = deps.hasActiveUploadInProgressOnQueue;
      const createId = deps.createId;
      const withAllowedEmptyQueuePersist = deps.withAllowedEmptyQueuePersist;
      const openDb = deps.openDb;
      const downloadJson = deps.downloadJson;
      const readJsonFile = deps.readJsonFile;
      const groupNameInputElRef = deps.groupNameInputElRef;
      const lastGroupNameInputValueRef = deps.lastGroupNameInputValueRef;
      const clearConfirmUntilRef = deps.clearConfirmUntilRef;
      const deleteConfirmUntilRef = deps.deleteConfirmUntilRef;
      const clearUploadFilesByUserAction = deps.clearUploadFilesByUserAction;
      const syncActiveGroupSelectionAfterQueueLoad = deps.syncActiveGroupSelectionAfterQueueLoad;
      if (typeof clearUploadFilesByUserAction !== 'function') {
        throw new Error('UploadGroupStore missing dependency: clearUploadFilesByUserAction');
      }
      if (typeof syncActiveGroupSelectionAfterQueueLoad !== 'function') {
        throw new Error('UploadGroupStore missing dependency: syncActiveGroupSelectionAfterQueueLoad');
      }

    const UPLOAD_GROUP_LAST_SELECTED_KEY = 'cgpt_toolbox_upload_group_last_selected_v1';
    const UPLOAD_GROUP_PAGE_SELECTED_PREFIX = 'cgpt_toolbox_upload_group_page_selected_v1:';

    function getUploadGroupPageScopeKey() {
      const pageInstanceId = String(
        (state && state.page_instance_id)
        || (typeof window !== 'undefined' && window.__CGPT_TOOLBOX_PAGE_INSTANCE_ID__)
        || (typeof getToolboxPageInstanceId === 'function' ? getToolboxPageInstanceId() : '')
        || '',
      ).trim();
      if (pageInstanceId) {
        return `page:${pageInstanceId}`;
      }

      const conversationId = String(
        (state && state.conversation_id)
        || (typeof getCurrentConversationIdSafe === 'function' ? getCurrentConversationIdSafe() : '')
        || '',
      ).trim();
      if (conversationId && conversationId !== '-') {
        return `conversation:${conversationId}`;
      }

      return `url:${location.origin}${location.pathname}`;
    }

    function getUploadGroupPageMemoryKey() {
      return `${UPLOAD_GROUP_PAGE_SELECTED_PREFIX}${getUploadGroupPageScopeKey()}`;
    }

    function getPageOnlySelectedUploadGroupId() {
      const pageKey = getUploadGroupPageMemoryKey();
      return String(localStorage.getItem(pageKey) || '').trim();
    }

    function getLastSelectedUploadGroupId() {
      return String(localStorage.getItem(UPLOAD_GROUP_LAST_SELECTED_KEY) || '').trim();
    }

    function loadPageSelectedUploadGroupId() {
      const pageKey = getUploadGroupPageMemoryKey();
      const pageValue = getPageOnlySelectedUploadGroupId();
      if (pageValue) {
        appendUploadLog(
          `[UPLOAD_GROUP][PAGE_SELECTED_LOAD] key=${pageKey} groupId=${pageValue}`,
        );
        return pageValue;
      }

      const lastValue = getLastSelectedUploadGroupId();
      if (lastValue) {
        appendUploadLog(
          `[UPLOAD_GROUP][PAGE_SELECTED_FALLBACK_LAST] key=${pageKey} groupId=${lastValue}`,
        );
        return lastValue;
      }

      appendUploadLog(
        `[UPLOAD_GROUP][PAGE_SELECTED_FALLBACK_DEFAULT] key=${pageKey}`,
      );
      return '';
    }

    function savePageSelectedUploadGroupId(groupId, reason = '-') {
      const normalizedGroupId = String(groupId || '').trim();
      const reasonText = String(reason || '-').trim() || '-';
      if (!normalizedGroupId) {
        appendUploadLog(
          `[UPLOAD_GROUP][PAGE_SELECTED_SAVE_SKIP] reason=${reasonText} groupId=-`,
        );
        return;
      }

      if (!state.groups.some((g) => g && g.id === normalizedGroupId)) {
        appendUploadLog(
          `[UPLOAD_GROUP][PAGE_SELECTED_SAVE_SKIP] reason=${reasonText} groupId=${normalizedGroupId} exists=0`,
        );
        return;
      }

      const pageKey = getUploadGroupPageMemoryKey();
      try {
        localStorage.setItem(pageKey, normalizedGroupId);
        localStorage.setItem(UPLOAD_GROUP_LAST_SELECTED_KEY, normalizedGroupId);
      } catch (error) {
        console.error('[ChatGPT toolbox] savePageSelectedUploadGroupId localStorage write failed', error);
      }

      appendUploadLog(
        `[UPLOAD_GROUP][PAGE_SELECTED_SAVE] reason=${reasonText} key=${pageKey} groupId=${normalizedGroupId} lastSelected=1`,
      );
    }

    function resolveInitialActiveUploadGroupId(groups, reason = '-') {
      const reasonText = String(reason || '-').trim() || '-';
      const groupList = Array.isArray(groups) ? groups : state.groups;
      const pageSelectedId = loadPageSelectedUploadGroupId();

      if (pageSelectedId && groupList.some((group) => group && group.id === pageSelectedId)) {
        appendUploadLog(
          `[UPLOAD_GROUP][RESOLVE_ACTIVE_PAGE_MEMORY] reason=${reasonText} groupId=${pageSelectedId}`,
        );
        return pageSelectedId;
      }

      if (pageSelectedId) {
        appendUploadLog(
          `[UPLOAD_GROUP][PAGE_MEMORY_GROUP_MISSING] reason=${reasonText} groupId=${pageSelectedId}`,
        );
      }

      const fallbackGroup = groupList.find((group) => group && group.id) || null;
      const fallbackId = fallbackGroup ? fallbackGroup.id : '';
      appendUploadLog(
        `[UPLOAD_GROUP][RESOLVE_ACTIVE_DEFAULT] reason=${reasonText} groupId=${fallbackId || '-'}`,
      );
      return fallbackId;
    }

    function reconcilePageActiveGroupAfterGlobalSync(groups, reason = '-') {
      const reasonText = String(reason || '-').trim() || '-';
      const groupList = Array.isArray(groups) ? groups : state.groups;
      const current = String(state.activeGroupId || '').trim();

      if (current && groupList.some((group) => group && group.id === current)) {
        appendUploadLog(
          `[UPLOAD_GROUP][KEEP_PAGE_ACTIVE_AFTER_SYNC] reason=${reasonText} groupId=${current}`,
        );
        return current;
      }

      const resolved = resolveInitialActiveUploadGroupId(groupList, `after-global-sync:${reasonText}`);
      state.activeGroupId = resolved;
      appendUploadLog(
        `[UPLOAD_GROUP][RESELECT_AFTER_SYNC] reason=${reasonText} old=${current || '-'} new=${resolved || '-'}`,
      );
      return resolved;
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

    function getActiveGroup() {
      return state.groups.find((g) => g.id === state.activeGroupId) || null;
    }

    function getActiveGroupName() {
      const g = getActiveGroup();
      return g ? g.name : '未命名组';
    }

    function markUploadGroupChipsActiveFast(targetGroupId, reason = '-') {
      const normalizedTargetGroupId = String(targetGroupId || '').trim();
      if (!normalizedTargetGroupId) {
        appendUploadLog(
          `[UPLOAD_GROUP][FAST_ACTIVE_SKIP] reason=${String(reason || '-')} target=-`,
        );
        return false;
      }
      const groupListEl = refs && refs.groupListEl ? refs.groupListEl : null;
      if (!groupListEl) {
        appendUploadLog(
          `[UPLOAD_GROUP][FAST_ACTIVE_SKIP] reason=${String(reason || '-')} target=${normalizedTargetGroupId} cause=group-list-missing`,
        );
        return false;
      }
      const chips = groupListEl.querySelectorAll('.cgpt-upload-group-chip[data-group-id]');
      chips.forEach((chip) => {
        const chipGroupId = String(chip.getAttribute('data-group-id') || '').trim();
        const isActive = chipGroupId === normalizedTargetGroupId;
        chip.classList.toggle('active', isActive);
        if (isActive) {
          chip.setAttribute('aria-current', 'true');
        } else {
          chip.removeAttribute('aria-current');
        }
      });
      appendUploadLog(
        `[UPLOAD_GROUP][FAST_ACTIVE_OK] reason=${String(reason || '-')} target=${normalizedTargetGroupId} chips=${chips.length}`,
      );
      return true;
    }

    function showUploadGroupSwitchingPlaceholder(targetGroupId, reason = '-') {
      const normalizedTargetGroupId = String(targetGroupId || '').trim();
      const targetGroup = state.groups.find((group) => {
        return group && String(group.id || '').trim() === normalizedTargetGroupId;
      }) || null;
      const targetName = targetGroup ? stripTrailingCountFromGroupName(targetGroup.name || '') : '当前文件组';
      if (!refs || !refs.listEl) {
        appendUploadLog(
          `[UPLOAD_GROUP][SWITCH_PLACEHOLDER_SKIP] reason=${String(reason || '-')} target=${normalizedTargetGroupId || '-'} cause=list-missing`,
        );
        return false;
      }
      refs.listEl.innerHTML = `
    <div class="cgpt-empty-state cgpt-upload-switching-placeholder">
      正在切换到 ${targetName || '当前文件组'}，请稍候...
    </div>
  `;
      appendUploadLog(
        `[UPLOAD_GROUP][SWITCH_PLACEHOLDER_OK] reason=${String(reason || '-')} target=${normalizedTargetGroupId || '-'} name=${targetName || '-'}`,
      );
      return true;
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
      const pageOnlySelectedGroupId = getPageOnlySelectedUploadGroupId();
      const lastSelectedUploadGroupId = getLastSelectedUploadGroupId();
      const lastManualGroupId = getLastManualUploadGroupId();
      const globalUploadActiveGroupId = getGlobalUploadActiveGroupId();
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

      if (isValidInGroups(pageOnlySelectedGroupId) && pageOnlySelectedGroupId !== excludeGroupId) {
        resolvedGroupId = pageOnlySelectedGroupId;
        reason = 'page-selected-memory';
      }

      if (!resolvedGroupId && savedProjectKey) {
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
          { id: lastSelectedUploadGroupId, reason: 'last-selected-fallback' },
          { id: pageGroupId, reason: 'page-state-legacy' },
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
        pageOnlySelectedGroupId,
        lastSelectedUploadGroupId,
        globalUploadActiveGroupId,
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
          + `pageGroupId=${pageGroupId || '-'} pageOnlySelectedGroupId=${pageOnlySelectedGroupId || '-'} `
          + `lastSelectedUploadGroupId=${lastSelectedUploadGroupId || '-'} `
          + `globalUploadActiveGroupId=${globalUploadActiveGroupId || '-'} `
          + `lastManualGroupId=${lastManualGroupId || '-'} `
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

    function saveGlobalUploadActiveGroupId(groupId, reason = '') {
      const id = String(groupId || '').trim();
      if (!id) {
        return;
      }
      if (!state.groups.some((g) => g.id === id)) {
        return;
      }
      MemoryManager.set(MemoryManager.KEYS.globalUploadActiveGroupId, id);
      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][save-global-upload-active] reason=${reason || '-'} groupId=${id}`,
      );
    }

    function getGlobalUploadActiveGroupId() {
      const globalId = String(
        MemoryManager.get(MemoryManager.KEYS.globalUploadActiveGroupId, '') || '',
      ).trim();
      if (state.groups.some((g) => g.id === globalId)) {
        return globalId;
      }
      return getUploadLastActiveGroupId();
    }

    function getUploadLastActiveGroupId() {
      const id = String(MemoryManager.get(MemoryManager.KEYS.uploadLastActiveGroupId, '') || '').trim();
      return state.groups.some((g) => g.id === id) ? id : '';
    }

    function broadcastUploadGlobalStateChanged(reason, payload = {}) {
      const message = {
        type: 'upload-global-state-changed',
        reason: String(reason || '').trim() || 'unknown',
        activeGroupId: String(state.activeGroupId || '').trim(),
        updatedAt: Date.now(),
        payload: payload && typeof payload === 'object' ? payload : {},
      };
      ToolboxShell.appendLog(
        `[UPLOAD_GLOBAL_SYNC][broadcast] reason=${message.reason} activeGroupId=${message.activeGroupId || '-'} running=${state.running ? 1 : 0}`,
      );
      try {
        localStorage.setItem(UPLOAD_GLOBAL_SYNC_KEY, JSON.stringify(message));
      } catch (error) {
        console.error('[ChatGPT toolbox] upload global sync localStorage write failed', error);
      }
      if (refs.uploadBroadcastChannel) {
        try {
          refs.uploadBroadcastChannel.postMessage(message);
        } catch (error) {
          console.error('[ChatGPT toolbox] upload global sync postMessage failed', error);
        }
      }
    }

    async function applyUploadGlobalSyncMessage(message, source) {
      const incomingGroupId = String(message && message.activeGroupId || '').trim();
      const localGroupId = String(state.activeGroupId || '').trim();
      const messageReason = String(message && message.reason || '').trim();
      const payload = message && message.payload && typeof message.payload === 'object'
        ? message.payload
        : {};
      if (
        messageReason === 'switch-group'
        || payload.pageOnly === true
        || payload.activeGroupOnly === true
      ) {
        ToolboxShell.appendLog(
          `[UPLOAD_GLOBAL_SYNC][IGNORE_PAGE_LOCAL_ACTIVE_GROUP] source=${source || '-'} reason=${messageReason || '-'} incoming=${incomingGroupId || '-'} local=${localGroupId || '-'}`,
        );
        return;
      }

      if (incomingGroupId) {
        ToolboxShell.appendLog(
          `[UPLOAD_GLOBAL_SYNC][IGNORE_REMOTE_ACTIVE_GROUP] source=${source || '-'} incoming=${incomingGroupId || '-'} local=${localGroupId || '-'} pageScope=${getUploadGroupPageScopeKey()}`,
        );
      }

      await loadGroups();
      reconcilePageActiveGroupAfterGlobalSync(state.groups, source || '-');
      await loadQueueForActiveGroup();
      await refreshUploadGroupCounts();
      render();
      ToolboxShell.appendLog(
        `[UPLOAD_GLOBAL_SYNC][applied] source=${source || '-'} activeGroupId=${state.activeGroupId || '-'} queue=${getActiveGroupFiles().length}`,
      );
    }

    async function handleUploadGlobalSyncMessage(message, source) {
      if (!message || message.type !== 'upload-global-state-changed') {
        return;
      }
      const incomingGroupId = String(message.activeGroupId || '').trim();
      ToolboxShell.appendLog(
        `[UPLOAD_GLOBAL_SYNC][receive] source=${source || '-'} reason=${message.reason || '-'} activeGroupId=${incomingGroupId || '-'} running=${state.running ? 1 : 0}`,
      );
      if (state.running) {
        refs.pendingUploadGlobalSyncMessage = message;
        ToolboxShell.appendLog(
          `[UPLOAD_GLOBAL_SYNC][skip-running] source=${source || '-'} reason=${message.reason || '-'} activeGroupId=${incomingGroupId || '-'}`
        );
        return;
      }
      await applyUploadGlobalSyncMessage(message, source);
    }

    function flushPendingUploadGlobalSync(reason = '') {
      if (!refs.pendingUploadGlobalSyncMessage || state.running) {
        return;
      }
      const message = refs.pendingUploadGlobalSyncMessage;
      refs.pendingUploadGlobalSyncMessage = null;
      void handleUploadGlobalSyncMessage(message, `pending:${reason || 'unknown'}`).catch((error) => {
        console.error('[ChatGPT toolbox] flushPendingUploadGlobalSync failed', error);
      });
    }

    function initUploadGlobalSync() {
      if (refs.uploadGlobalSyncInitialized) {
        return;
      }
      refs.uploadGlobalSyncInitialized = true;
      if ('BroadcastChannel' in window) {
        refs.uploadBroadcastChannel = new BroadcastChannel(UPLOAD_GLOBAL_SYNC_KEY);
        refs.uploadBroadcastChannel.onmessage = (event) => {
          void handleUploadGlobalSyncMessage(event.data, 'broadcast-channel');
        };
      }
      window.addEventListener('storage', (event) => {
        if (!event || event.key !== UPLOAD_GLOBAL_SYNC_KEY || !event.newValue) {
          return;
        }
        let data = null;
        try {
          data = JSON.parse(event.newValue || 'null');
        } catch (error) {
          console.error('[ChatGPT toolbox] parse upload global sync storage event failed', error);
          ToolboxShell.appendLog(
            `[UPLOAD_GLOBAL_SYNC][parse-failed] error=${error && error.message ? error.message : String(error)}`
          );
          return;
        }
        void handleUploadGlobalSyncMessage(data, 'storage');
      });
    }

    async function switchGroup(groupId, options = {}) {
      const targetGroupId = String(groupId || '').trim();
      if (!targetGroupId) {
        ToolboxShell.appendLog('[UPLOAD_GROUP][SWITCH_SKIP] reason=empty-target');
        return false;
      }
      const currentGroupId = String(state.activeGroupId || '').trim();
      const reasonText = String(options.reason || 'switch-group').trim() || 'switch-group';
      if (currentGroupId === targetGroupId) {
        appendUploadLog(
          `[UPLOAD_GROUP][SELECT_NOOP_FAST] reason=${reasonText} groupId=${targetGroupId}`,
        );
        return true;
      }
      if (
        state.switchingUploadGroup === true
        && String(state.switchingUploadGroupTargetId || '').trim() === targetGroupId
      ) {
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][SWITCH_SKIP] reason=in-flight target=${targetGroupId} active=${currentGroupId || '-'}`,
        );
        return false;
      }
      appendUploadGroupLog('SWITCH', {
        targetGroupId,
        fromGroupId: currentGroupId || '-',
        reason: reasonText,
      });
      const switchStartedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      healStaleUploadRunningLockIfNeeded('switchGroup');
      const uploadActuallyRunning = !!(
        (typeof isUploadRunActuallyActive === 'function' && isUploadRunActuallyActive())
        || (typeof hasActiveUploadInProgressOnQueue === 'function' && hasActiveUploadInProgressOnQueue())
        || state.uploadAbortController
      );
      if (uploadActuallyRunning) {
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][SWITCH_BLOCKED_RUNNING] targetGroupId=${targetGroupId} activeGroupId=${state.activeGroupId || '-'} stateRunning=${state.running ? 1 : 0} abort=${state.uploadAbortController ? 1 : 0}`,
        );
        setStatus('附件正在上传中，暂时不能切换分组', 'warn');
        return false;
      }
      if (state.running) {
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][SWITCH_HEAL_STALE_RUNNING] targetGroupId=${targetGroupId} activeGroupId=${state.activeGroupId || '-'} reason=state-running-without-real-upload`,
        );
        state.running = false;
        state.cancelled = false;
        state.activeId = '';
        state.uploadAbortController = null;
      }
      const exists = state.groups.some((g) => g && g.id === targetGroupId);
      if (!exists) {
        console.warn('[ChatGPT toolbox] switchGroup: 分组不存在', targetGroupId);
        ToolboxShell.appendLog(`[UPLOAD_GROUP][switch:missing] groupId=${targetGroupId}`);
        setStatus('切换失败：分组不存在', 'error');
        return false;
      }
      const prevActiveGroupId = state.activeGroupId;
      const prevActiveId = state.activeId;
      const prevQueue = Array.isArray(state.queue) ? state.queue.slice() : [];
      const prevSelectedFileIdByGroup = {
        ...(state.selectedFileIdByGroup || {}),
      };
      const switchToken = createId('upload_group_switch');
      state.switchingUploadGroup = true;
      state.switchingUploadGroupTargetId = targetGroupId;
      state.switchingUploadGroupToken = switchToken;
      try {
        state.activeGroupId = targetGroupId;
        state.activeId = '';
        syncUploadGroupAppState();
        markUploadGroupChipsActiveFast(targetGroupId, reasonText);
        showUploadGroupSwitchingPlaceholder(targetGroupId, reasonText);
        renderUploadButtonsOnly({
          immediate: true,
          force: true,
          buttonTasksReason: 'switch-group:instant-ui',
        });
        appendUploadGroupLog('SWITCH', {
          phase: 'instant-ui',
          fromGroupId: prevActiveGroupId || '-',
          targetGroupId,
          token: switchToken,
          reason: reasonText,
        });
        savePageSelectedUploadGroupId(targetGroupId, reasonText);
        if (options.saveLastManual !== false) {
          saveLastManualUploadGroupId(targetGroupId, reasonText);
          refs.lastManualUploadGroupAt = Date.now();
        }
        appendUploadLog(
          `[UPLOAD_GROUP][SELECT_PAGE_ONLY_FAST] reason=${reasonText} old=${prevActiveGroupId || '-'} new=${targetGroupId} pageScope=${getUploadGroupPageScopeKey()}`,
        );
        Promise.resolve(persistGroups())
          .catch((err) => {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] persistGroups after switchGroup failed', err);
            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][PERSIST_GROUPS_ASYNC_FAILED] target=${targetGroupId} error=${errText}`,
            );
          });
        await loadQueueForActiveGroup({
          reason: 'switch-group',
          silentRender: true,
          skipFullRender: true,
          skipRender: true,
          skipRefreshCounts: true,
          skipMigration: true,
        });
        if (
          String(state.switchingUploadGroupToken || '') !== switchToken
          || String(state.activeGroupId || '').trim() !== targetGroupId
        ) {
          appendUploadGroupLog('SWITCH', {
            phase: 'stale-result-ignored',
            fromGroupId: prevActiveGroupId || '-',
            targetGroupId,
            currentActiveGroupId: state.activeGroupId || '-',
            token: switchToken,
            currentToken: state.switchingUploadGroupToken || '-',
            reason: reasonText,
          });
          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][SWITCH_STALE_IGNORED] from=${prevActiveGroupId || '-'} target=${targetGroupId} current=${state.activeGroupId || '-'} token=${switchToken} currentToken=${state.switchingUploadGroupToken || '-'}`,
          );
          return false;
        }
        saveMultiUploadSelectionForActiveGroup();
        renderProjectCategoryChips();
        renderUploadListOnly('switch-group:fast', { force: true });
        renderUploadButtonsOnly({
          immediate: true,
          force: true,
          buttonTasksReason: 'switch-group:fast',
        });
        syncUploadGroupAppState();
        setStatus(`已切换到 ${getActiveGroupName()}`, 'success');
        const costMs = ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - switchStartedAt;
        appendUploadGroupLog('SWITCH', {
          phase: 'ok',
          fromGroupId: prevActiveGroupId || '-',
          targetGroupId,
          costMs: Math.round(costMs),
        });
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][SWITCH_FAST_OK] from=${prevActiveGroupId || '-'} to=${targetGroupId} count=${getActiveGroupFiles().length} selected=${getSelectedFileIdForActiveGroup() || '-'} costMs=${costMs.toFixed(1)}`,
        );
        Promise.resolve(refreshUploadGroupCounts({
          reason: 'switch-group:background',
          renderChips: true,
        }))
          .then(() => {
            renderProjectCategoryChips();
          })
          .catch((err) => {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] background refreshUploadGroupCounts failed after switchGroup', err);
            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][COUNT_REFRESH_ASYNC_FAILED] target=${targetGroupId} error=${errText}`,
            );
          });
        ToolboxShell.appendLog(
          `[UPLOAD_GLOBAL_SYNC][SKIP_ACTIVE_GROUP_BROADCAST] reason=${reasonText} activeGroupId=${targetGroupId} note=active-group-is-page-local`,
        );
        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);
        const isCurrentSwitch = String(state.switchingUploadGroupToken || '') === switchToken;
        if (isCurrentSwitch) {
          state.activeGroupId = prevActiveGroupId;
          state.activeId = prevActiveId;
          state.queue = prevQueue;
          state.selectedFileIdByGroup = prevSelectedFileIdByGroup;
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][SWITCH_ROLLBACK_SKIP_STALE] from=${prevActiveGroupId || '-'} target=${targetGroupId} current=${state.activeGroupId || '-'} token=${switchToken} currentToken=${state.switchingUploadGroupToken || '-'}`,
          );
        }
        if (isCurrentSwitch) {
          renderProjectCategoryChips();
          renderUploadListOnly('switch-group:rollback', { force: true });
          renderUploadButtonsOnly({
            immediate: true,
            force: true,
            buttonTasksReason: 'switch-group:rollback',
          });
          syncGroupManagePanel({
            force: true,
          });
        }
        console.error('[ChatGPT toolbox] switchGroup failed', e);
        setStatus(`切换分组失败，已恢复原分组：${errText}`, 'error');
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][switch:failed-rollback] from=${prevActiveGroupId || '-'} to=${targetGroupId} type=${errName} error=${errText}`,
        );
        throw e;
      } finally {
        if (String(state.switchingUploadGroupToken || '') === switchToken) {
          state.switchingUploadGroup = false;
          state.switchingUploadGroupTargetId = '';
          state.switchingUploadGroupToken = '';
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][SWITCH_FINALIZE_SKIP_STALE] target=${targetGroupId} token=${switchToken} currentToken=${state.switchingUploadGroupToken || '-'}`,
          );
        }
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
        await awaitPersistQueueBriefly('createGroupInline:before', 300);

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
        await awaitPersistQueueBriefly('createGroupInline:after-persist-groups', 300);

        saveLastManualUploadGroupId(group.id, 'create-group-inline');
        savePageSelectedUploadGroupId(group.id, 'create-group-inline');

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
        broadcastUploadGlobalStateChanged('create-group', { groupId: group.id });
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
        broadcastUploadGlobalStateChanged('rename-group', { groupId: group.id });

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

      if (!clearUploadFilesByUserAction('clear-active-group-inline')) {
        return;
      }

      const prevQueue = state.queue.slice();
      const groupId = String(group.id || '').trim();

      const removedItems = prevQueue.filter((item) => {
        return item && String(item.groupId || '').trim() === groupId;
      });

      try {
        state.queue = prevQueue.filter((item) => {
          return !item || String(item.groupId || '').trim() !== groupId;
        });

        await withAllowedEmptyQueuePersist('clear-active-group-inline', () => (
          awaitPersistQueueBriefly('clearActiveGroupQueueInline', 300)
        ));

        for (const item of removedItems) {
          if (!item) {
            continue;
          }

          const handleKey = String(item.handleKey || buildUploadHandleKey(item) || '').trim();

          if (handleKey) {
            await deleteUploadFileHandle(handleKey);
          }
        }

        await refreshUploadGroupCounts();

        render();
        syncGroupManagePanel();

        if (typeof cleanupChatMessageCaches === 'function') {
          cleanupChatMessageCaches('upload-group-cleared');
        }

        setStatus(`已清空分组：${group.name}`, 'success');
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][clear-inline:ok] groupId=${group.id || '-'} name=${group.name || '-'} removed=${removedItems.length}`,
        );
        broadcastUploadGlobalStateChanged('clear-group', {
          groupId: group.id,
          removed: removedItems.length,
        });
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
        await awaitPersistQueueBriefly('deleteActiveGroupInline:before', 300);

        state.groups = nextGroups;
        state.activeGroupId = nextActiveGroupId;
        state.activeId = '';
        state.queue = [];

        await persistGroups();
        await loadQueueForActiveGroup();

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
        savePageSelectedUploadGroupId(state.activeGroupId, 'delete-group-inline');

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
        broadcastUploadGlobalStateChanged('delete-group', {
          groupId: group.id,
          nextActiveGroupId: state.activeGroupId || '',
        });
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
      const fileId = String(id || '').trim();
      if (!fileId) {
        setStatus('删除失败：文件 ID 为空', 'error');
        ToolboxShell.appendLog('[UPLOAD_DELETE][SKIP] reason=empty-id');
        return false;
      }
      healStaleUploadRunningLockIfNeeded('remove-file-before-check');
      const uploadActuallyActive = state.running || isUploadRunActuallyActive();
      if (uploadActuallyActive) {
        setStatus('正在上传中，不能删除文件', 'warn');
        ToolboxShell.appendLog(
          `[UPLOAD_DELETE][SKIP] reason=upload-running id=${fileId} running=${state.running ? 1 : 0}`,
        );
        return false;
      }
      const activeGroupId = getActiveGroupId();
      const q = getActiveGroupFiles().find((item) => item && String(item.id || '').trim() === fileId);
      if (!q) {
        setStatus('未找到要删除的文件', 'warn');
        console.warn('[ChatGPT toolbox] removeFileFromCurrentGroup: 文件不存在', fileId);
        ToolboxShell.appendLog(
          `[UPLOAD_DELETE][MISSING] id=${fileId} activeGroupId=${activeGroupId || '-'}`,
        );
        return false;
      }
      if (!clearUploadFilesByUserAction('remove-file-from-current-group')) {
        ToolboxShell.appendLog(
          `[UPLOAD_DELETE][BLOCKED] id=${fileId} reason=clearUploadFilesByUserAction-return-false`,
        );
        return false;
      }
      const prevQueue = state.queue.slice();
      const prevActiveId = state.activeId;
      const prevSelectedFileIdByGroup = {
        ...(state.selectedFileIdByGroup || {}),
      };
      try {
        markUploadFileDeletedTombstone(fileId, activeGroupId, 'removeFileFromCurrentGroup:start');
        ToolboxShell.appendLog(
          `[UPLOAD_DELETE][START] id=${fileId} name=${q.name || '-'} group=${activeGroupId || '-'} queueBefore=${state.queue.length}`,
        );
        state.queue = state.queue.filter((item) => item && String(item.id || '').trim() !== fileId);
        if (String(state.activeId || '').trim() === fileId) {
          state.activeId = '';
        }
        if (
          state.selectedFileIdByGroup
          && activeGroupId
          && String(state.selectedFileIdByGroup[activeGroupId] || '').trim() === fileId
        ) {
          delete state.selectedFileIdByGroup[activeGroupId];
        }
        syncActiveGroupSelectionAfterQueueLoad(activeGroupId);
        renderUploadListOnly('remove-file:memory-removed', { force: true });
        syncGroupManagePanel({ force: true });
        setStatus(`已从界面移除：${q.name}，正在删除本地缓存…`, 'success');
        ToolboxShell.appendLog(
          `[UPLOAD_DELETE][MEMORY_REMOVED] id=${fileId} name=${q.name || '-'} group=${activeGroupId || '-'} queueAfter=${state.queue.length}`,
        );
        await deleteUploadQueueRowById(fileId, activeGroupId, {
          reason: 'removeFileFromCurrentGroup',
          item: q,
        });
        await withAllowedEmptyQueuePersist('remove-file-from-current-group', () => (
          persistQueue('removeFileFromCurrentGroup:full-sync', {
            mode: 'delete-file',
          })
        ));
        await refreshUploadGroupCounts();
        renderUploadListOnly('remove-file:done', { force: true });
        syncGroupManagePanel({ force: true });
        setStatus(`已从工具箱移除：${q.name}`, 'success');
        ToolboxShell.appendLog(
          `[UPLOAD_DELETE][OK] id=${fileId} name=${q.name || '-'} group=${activeGroupId || '-'} queueAfter=${state.queue.length}`,
        );
        broadcastUploadGlobalStateChanged('remove-file', {
          groupId: activeGroupId || '',
          fileId,
        });
        return true;
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.stack
          ? error.stack
          : (error && error.message ? error.message : String(error));
        state.queue = prevQueue;
        state.activeId = prevActiveId;
        state.selectedFileIdByGroup = prevSelectedFileIdByGroup;
        clearUploadFileDeletedTombstone(fileId, 'removeFileFromCurrentGroup:rollback');
        renderUploadListOnly('remove-file:rollback', { force: true });
        syncGroupManagePanel({ force: true });
        console.error('[ChatGPT toolbox] removeFileFromCurrentGroup failed', error);
        setStatus(`移除文件失败，已恢复原队列：${error && error.message ? error.message : String(error)}`, 'error');
        ToolboxShell.appendLog(
          `[UPLOAD_DELETE][FAILED_ROLLBACK] id=${fileId} name=${q.name || '-'} type=${errName} error=${errText}`,
        );
        throw error;
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

        const queue = (rows || []).map((r) => {
          const normalized = normalizeUploadItem(r, {
            groupId: getUploadItemGroupId(r) || state.activeGroupId,
          });
          return {
            id: normalized.id,
            groupId: normalized.groupId,
            name: normalized.name,
            displayPath: normalized.displayPath || normalized.name || '',
            size: normalized.size,
            lastModified: normalized.lastModified,
            mimeType: normalized.mimeType,
            downloadUrl: normalized.downloadUrl || '',
            sourceKind: normalized.sourceKind || '',
            readMode: normalized.readMode || '',
            registryStatus: normalized.registryStatus || 'pending',
            attachState: normalized.attachState || UploadState.IDLE,
            composerPresence: normalized.composerPresence || 'unbound',
            sendState: normalized.sendState || 'idle',
            restoreState: normalized.restoreState || '',
            persistedKind: normalized.persistedKind || '',
            flaskPath: normalized.flaskPath || '',
            uploadName: normalized.uploadName || '',
            manualPathNote: String(normalized.manualPathNote || '').trim(),
            message: normalized.message || '',
            blobSaved: !!r.blobSaved,
            blobSavedAt: Number(r.blobSavedAt) || 0,
          };
        });

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

              const normalized = normalizeUploadItem(r, { groupId });
              const row = buildPersistRow({
                ...normalized,
                groupId,
                blob: r.blob instanceof Blob ? r.blob : normalized.blob,
                handle: null,
                fileHandle: null,
              });
              row.handle = null;
              row.blob = r.blob instanceof Blob ? r.blob : row.blob;
              row.blobSaved = !!(r.blob instanceof Blob) || !!r.blobSaved || !!row.blobSaved;
              row.blobSavedAt = Number(r.blobSavedAt) || row.blobSavedAt || 0;
              appendUploadSchemaAuditLog('UPLOAD_IMPORT_ROW_NORMALIZED', row);

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
        savePageSelectedUploadGroupId(state.activeGroupId, 'import-groups-and-queue');

        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][import:ok] groups=${state.groups.length} queue=${incomingQueue.length} activeGroupId=${state.activeGroupId || '-'}`,
        );
        broadcastUploadGlobalStateChanged('import-groups', {
          groups: state.groups.length,
          queue: incomingQueue.length,
        });
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

      return {
      createDefaultGroup,
      getActiveGroup,
      getActiveGroupName,
      normalizeUploadFolderPath,
      deriveUploadGroupStableKey,
      getUploadGroupStableKey,
      getUploadFileFolderKey,
      ensureUploadGroupStableKeys,
      isValidUploadGroupId,
      resolveUploadGroupSelection,
      getUploadGroupPageScopeKey,
      getPageOnlySelectedUploadGroupId,
      getLastSelectedUploadGroupId,
      loadPageSelectedUploadGroupId,
      savePageSelectedUploadGroupId,
      resolveInitialActiveUploadGroupId,
      reconcilePageActiveGroupAfterGlobalSync,
      getLastManualUploadGroupId,
      saveLastManualUploadGroupId,
      saveUploadLastActiveGroupId,
      saveGlobalUploadActiveGroupId,
      getGlobalUploadActiveGroupId,
      getUploadLastActiveGroupId,
      broadcastUploadGlobalStateChanged,
      applyUploadGlobalSyncMessage,
      handleUploadGlobalSyncMessage,
      flushPendingUploadGlobalSync,
      initUploadGlobalSync,
      switchGroup,
      buildRandomGroupName,
      buildNextGroupName,
      createGroupInline,
      renameActiveGroupInline,
      deleteGroupQueue,
      clearActiveGroupQueueInline,
      deleteActiveGroupInline,
      removeFileFromCurrentGroup,
      exportGroupsAndQueueMeta,
      importGroupsAndQueueMeta,
      };
    }

    return { create };
  })();
