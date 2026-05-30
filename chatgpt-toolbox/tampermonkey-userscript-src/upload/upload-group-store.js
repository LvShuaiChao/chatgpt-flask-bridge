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
          { id: globalUploadActiveGroupId, reason: 'global-upload-active' },
          { id: uploadLastActiveGroupId, reason: 'upload-last-active' },
          { id: lastManualGroupId, reason: 'last-manual' },
          { id: stateActiveGroupId, reason: 'state-active' },
          { id: pageGroupId, reason: 'page-state-legacy' },
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
          + `pageGroupId=${pageGroupId || '-'} globalUploadActiveGroupId=${globalUploadActiveGroupId || '-'} `
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
      if (incomingGroupId && incomingGroupId !== state.activeGroupId && !state.groups.some((g) => g.id === incomingGroupId)) {
        await loadGroups();
      }
      if (incomingGroupId && incomingGroupId !== state.activeGroupId) {
        state.activeGroupId = incomingGroupId;
        saveGlobalUploadActiveGroupId(incomingGroupId, `sync-${source || 'unknown'}`);
        saveUploadLastActiveGroupId(incomingGroupId, `sync-${source || 'unknown'}`);
      }
      await loadGroups();
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
      if (!groupId) return;

      appendUploadGroupLog('SWITCH', {
        targetGroupId: groupId,
        fromGroupId: getActiveGroupId() || '-',
        reason: options.reason || '-',
      });

      healStaleUploadRunningLockIfNeeded('switchGroup');

      const uploadActuallyRunning = !!(
        (typeof isUploadRunActuallyActive === 'function' && isUploadRunActuallyActive())
        || (typeof hasActiveUploadInProgressOnQueue === 'function' && hasActiveUploadInProgressOnQueue())
        || state.uploadAbortController
      );
      if (uploadActuallyRunning) {
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][SWITCH_BLOCKED_RUNNING] targetGroupId=${groupId || '-'} activeGroupId=${state.activeGroupId || '-'} stateRunning=${state.running ? 1 : 0} abort=${state.uploadAbortController ? 1 : 0}`,
        );
        setStatus('附件正在上传中，暂时不能切换分组', 'warn');
        return;
      }
      if (state.running) {
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][SWITCH_HEAL_STALE_RUNNING] targetGroupId=${groupId || '-'} activeGroupId=${state.activeGroupId || '-'} reason=state-running-without-real-upload`,
        );
        state.running = false;
        state.cancelled = false;
        state.activeId = '';
        state.uploadAbortController = null;
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
        await awaitPersistQueueBriefly('switchGroup:before', 300);

        state.activeGroupId = groupId;
        saveGlobalUploadActiveGroupId(groupId, options.reason || 'switch-group');
        saveUploadLastActiveGroupId(groupId, options.reason || 'switch-group');

        if (options.saveLastManual !== false) {
          saveLastManualUploadGroupId(groupId, options.reason || 'switch-group');
          refs.lastManualUploadGroupAt = Date.now();
        }

        await persistGroups();
        await loadQueueForActiveGroup();
        saveMultiUploadSelectionForActiveGroup();

        renderProjectCategoryChips();
        renderUploadListOnly('switch-group', { force: true });
        renderUploadButtonsOnly({
          immediate: true,
          force: true,
          buttonTasksReason: 'switch-group',
        });
        setStatus(`已切换到 ${getActiveGroupName()}`, 'success');
        render();

        syncUploadGroupAppState();
        appendUploadGroupLog('SWITCH', {
          phase: 'ok',
          fromGroupId: prevActiveGroupId || '-',
          targetGroupId: groupId || '-',
        });
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][switch:ok] from=${prevActiveGroupId || '-'} to=${groupId || '-'} count=${getActiveGroupFiles().length} selected=${getSelectedFileIdForActiveGroup() || '-'}`,
        );
        broadcastUploadGlobalStateChanged('switch-group', {
          sourceReason: options.reason || 'switch-group',
        });
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
        saveUploadLastActiveGroupId(group.id, 'create-group-inline');
        saveGlobalUploadActiveGroupId(group.id, 'create-group-inline');

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
        saveUploadLastActiveGroupId(state.activeGroupId, 'delete-group-inline');
        saveGlobalUploadActiveGroupId(state.activeGroupId, 'delete-group-inline');

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
        ToolboxShell.appendLog('[UPLOAD_DIAG][remove-file:skip] reason=empty-id');
        return false;
      }

      healStaleUploadRunningLockIfNeeded('remove-file-before-check');

      const uploadActuallyActive = state.running || isUploadRunActuallyActive();

      if (uploadActuallyActive) {
        setStatus('正在上传中，不能删除文件', 'warn');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:skip] reason=upload-running id=${fileId} running=${state.running ? 1 : 0}`,
        );
        return false;
      }

      const q = getActiveGroupFiles().find((item) => item && item.id === fileId);

      if (!q) {
        setStatus('未找到要删除的文件', 'warn');
        console.warn('[ChatGPT toolbox] removeFileFromCurrentGroup: 文件不存在', fileId);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:missing] id=${fileId} activeGroupId=${getActiveGroupId() || '-'}`,
        );
        return false;
      }

      if (!clearUploadFilesByUserAction('remove-file-from-current-group')) {
        return false;
      }

      const prevQueue = state.queue.slice();
      const activeGroupId = getActiveGroupId();

      try {
        state.queue = state.queue.filter((item) => item && item.id !== fileId);
        syncActiveGroupSelectionAfterQueueLoad(activeGroupId);

        render();
        syncGroupManagePanel({ force: true });

        setStatus(`已从界面移除：${q.name}，正在保存队列…`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:ui-removed] id=${fileId} name=${q.name || '-'} group=${activeGroupId || '-'}`,
        );

        await withAllowedEmptyQueuePersist('remove-file-from-current-group', () => (
          awaitPersistQueueBriefly('removeFileFromCurrentGroup', 300)
        ));

        render();
        syncGroupManagePanel({ force: true });

        setStatus(`已从工具箱移除：${q.name}`, 'success');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:ok] id=${fileId} name=${q.name || '-'} group=${activeGroupId || '-'}`,
        );
        broadcastUploadGlobalStateChanged('remove-file', {
          groupId: activeGroupId || '',
          fileId,
        });

        return true;
      } catch (e) {
        const errName = e && e.name ? e.name : 'Error';
        const errText = e && e.message ? e.message : String(e);

        state.queue = prevQueue;

        render();
        syncGroupManagePanel({ force: true });

        console.error('[ChatGPT toolbox] removeFileFromCurrentGroup failed', e);

        setStatus(`移除文件失败，已恢复原队列：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][remove-file:failed-rollback] id=${fileId} name=${q.name || '-'} type=${errName} error=${errText}`,
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
        saveGlobalUploadActiveGroupId(state.activeGroupId, 'import-groups-and-queue');
        saveUploadLastActiveGroupId(state.activeGroupId, 'import-groups-and-queue');

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
