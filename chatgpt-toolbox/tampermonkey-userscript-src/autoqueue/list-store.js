(function initAutoqListStoreModule() {
  const AUTOQ_TASK_LIST_STORE_KEY = 'cgpt_toolbox_autoq_task_lists_v2';
  const STORE_VERSION = 2;
  const DEFAULT_LIST_ID = 'list_default';
  const DEFAULT_LIST_NAME = '默认列表';

  function readRawStore() {
    try {
      if (typeof readLocalJson === 'function') {
        return readLocalJson(AUTOQ_TASK_LIST_STORE_KEY, null, '[AUTOQ_LIST_STORE][LOAD]');
      }
      if (typeof GM_getValue === 'function') {
        const raw = GM_getValue(AUTOQ_TASK_LIST_STORE_KEY, null);
        if (raw == null) return null;
        if (typeof raw === 'string') {
          return JSON.parse(raw);
        }
        return raw;
      }
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(AUTOQ_TASK_LIST_STORE_KEY);
        return raw ? JSON.parse(raw) : null;
      }
    } catch (error) {
      console.error('[AUTOQ_LIST_STORE][ERROR]', error);
    }
    return null;
  }

  function writeRawStoreOnLoadIfNeeded(store) {
    try {
      const raw = readRawStore();
      const beforeCount = raw && Array.isArray(raw.lists) ? raw.lists.length : -1;
      const afterCount = Array.isArray(store.lists) ? store.lists.length : 0;
      const beforeLast = raw && typeof raw === 'object'
        ? String(raw.lastSelectedListId || '').trim()
        : '';
      const afterLast = String(store.lastSelectedListId || '').trim();

      if (beforeCount !== afterCount || beforeLast !== afterLast) {
        writeRawStore(store);
        return true;
      }
    } catch (error) {
      console.error('[AUTOQ_LIST_STORE][LOAD_PERSIST_ERROR]', error);
    }
    return false;
  }

  function writeRawStore(store) {
    try {
      if (typeof writeLocalJson === 'function') {
        writeLocalJson(AUTOQ_TASK_LIST_STORE_KEY, store, '[AUTOQ_LIST_STORE][SAVE]');
        return;
      }
      if (typeof GM_setValue === 'function') {
        GM_setValue(AUTOQ_TASK_LIST_STORE_KEY, store);
        return;
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(AUTOQ_TASK_LIST_STORE_KEY, JSON.stringify(store));
      }
    } catch (error) {
      console.error('[AUTOQ_LIST_STORE][ERROR]', error);
      throw error;
    }
  }

  function nowMs() {
    return Date.now();
  }

  function createListId() {
    if (typeof createId === 'function') {
      return createId('autoq_list');
    }
    return `autoq_list_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function dedupeAutoqTaskLists(rawLists) {
    const inputLists = Array.isArray(rawLists) ? rawLists : [];
    const result = [];
    const seenIds = new Set();
    let hasDefault = false;

    for (const item of inputLists) {
      const normalized = normalizeListItem(item);
      if (!normalized) {
        continue;
      }

      const rawId = String(normalized.id || '').trim();
      const rawName = String(normalized.name || '').trim();
      const isDefaultById = rawId === DEFAULT_LIST_ID;
      const isDefaultByName = rawName === DEFAULT_LIST_NAME;

      if (isDefaultById || isDefaultByName) {
        if (hasDefault) {
          console.warn('[PROMPT_LIST][DEDUP_DEFAULT_LIST]', {
            removedId: rawId,
            removedName: rawName,
          });
          continue;
        }

        result.push({
          ...normalized,
          id: DEFAULT_LIST_ID,
          name: DEFAULT_LIST_NAME,
        });
        seenIds.add(DEFAULT_LIST_ID);
        hasDefault = true;
        continue;
      }

      const id = rawId || createListId();
      const name = rawName || '未命名列表';

      if (seenIds.has(id)) {
        console.warn('[PROMPT_LIST][DEDUP_DUPLICATE_ID]', {
          removedId: id,
          removedName: name,
        });
        continue;
      }

      result.push({
        ...normalized,
        id,
        name,
      });
      seenIds.add(id);
    }

    if (!hasDefault) {
      const ts = nowMs();
      result.unshift({
        id: DEFAULT_LIST_ID,
        name: DEFAULT_LIST_NAME,
        createdAt: ts,
        updatedAt: ts,
        text: '',
        tasks: [],
      });
    }

    return result;
  }

  function normalizeListItem(item, fallbackText) {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const rawId = String(item.id || '').trim();
    const rawName = String(item.name || '').trim();
    const isDefaultCandidate = rawId === DEFAULT_LIST_ID || rawName === DEFAULT_LIST_NAME;
    const id = rawId || (isDefaultCandidate ? DEFAULT_LIST_ID : createListId());
    const name = rawName || (isDefaultCandidate ? DEFAULT_LIST_NAME : '未命名列表');
    const createdAt = Number(item.createdAt) || nowMs();
    const updatedAt = Number(item.updatedAt) || createdAt;

    let text = '';
    if (typeof item.text === 'string') {
      text = item.text;
    } else if (Array.isArray(item.tasks)) {
      text = item.tasks
        .map((task) => {
          if (!task || typeof task !== 'object') return '';
          return String(task.initialPrompt || task.prompt || task.text || task.content || '').trim();
        })
        .filter(Boolean)
        .join('\n');
    }

    if (!text && typeof fallbackText === 'string') {
      text = fallbackText;
    }

    return {
      id,
      name: name.slice(0, 24),
      createdAt,
      updatedAt,
      text: String(text || ''),
      tasks: Array.isArray(item.tasks) ? item.tasks : [],
    };
  }

  function ensureDefaultAutoqTaskList(store) {
    if (!store || typeof store !== 'object') {
      return createEmptyStore();
    }
    if (!Array.isArray(store.lists)) {
      store.lists = [];
    }

    store.lists = dedupeAutoqTaskLists(
      store.lists.map((item) => normalizeListItem(item)).filter(Boolean),
    );

    store.version = STORE_VERSION;
    return store;
  }

  function createEmptyStore() {
    const ts = nowMs();
    return ensureDefaultAutoqTaskList({
      version: STORE_VERSION,
      lastSelectedListId: DEFAULT_LIST_ID,
      lists: [{
        id: DEFAULT_LIST_ID,
        name: DEFAULT_LIST_NAME,
        createdAt: ts,
        updatedAt: ts,
        text: '',
        tasks: [],
      }],
    });
  }

  function migrateLegacyAutoqTaskLists(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const fromVersion = Number(raw.version) || 0;
    const lists = [];
    let lastSelectedListId = String(raw.lastSelectedListId || raw.activeListId || '').trim();

    if (Array.isArray(raw.lists) && raw.lists.length) {
      raw.lists.forEach((item) => {
        const normalized = normalizeListItem(item);
        if (normalized) lists.push(normalized);
      });
    } else if (Array.isArray(raw.listProfiles) && raw.listProfiles.length) {
      raw.listProfiles.forEach((item) => {
        const normalized = normalizeListItem(item, raw.listPromptsText);
        if (normalized) lists.push(normalized);
      });
      if (!lastSelectedListId) {
        lastSelectedListId = String(raw.activeListProfileId || '').trim();
      }
    } else if (Array.isArray(raw.defaultTasks) || Array.isArray(raw.tasks)) {
      const tasks = Array.isArray(raw.defaultTasks) ? raw.defaultTasks : raw.tasks;
      const ts = nowMs();
      lists.push({
        id: DEFAULT_LIST_ID,
        name: DEFAULT_LIST_NAME,
        createdAt: ts,
        updatedAt: ts,
        text: '',
        tasks,
      });
    } else {
      const nameKeys = Object.keys(raw).filter((key) => (
        key !== 'version'
        && key !== 'lastSelectedListId'
        && key !== 'activeListId'
        && Array.isArray(raw[key])
      ));
      if (nameKeys.length) {
        nameKeys.forEach((name) => {
          const ts = nowMs();
          lists.push({
            id: createListId(),
            name: String(name).slice(0, 24),
            createdAt: ts,
            updatedAt: ts,
            text: '',
            tasks: raw[name],
          });
        });
      } else if (typeof raw.listPromptsText === 'string' && raw.listPromptsText.trim()) {
        const ts = nowMs();
        lists.push({
          id: DEFAULT_LIST_ID,
          name: DEFAULT_LIST_NAME,
          createdAt: ts,
          updatedAt: ts,
          text: raw.listPromptsText,
          tasks: [],
        });
      }
    }

    if (!lists.length) {
      return null;
    }

    ensureDefaultAutoqTaskList({ version: STORE_VERSION, lastSelectedListId: '', lists });

    const store = {
      version: STORE_VERSION,
      lastSelectedListId: lastSelectedListId || lists[0].id,
      lists,
    };

    ensureDefaultAutoqTaskList(store);

    if (!store.lists.some((item) => item.id === store.lastSelectedListId)) {
      store.lastSelectedListId = pickMostRecentlyUpdatedList(store.lists).id;
    }

    console.log('[AUTOQ_LIST_STORE][MIGRATE]', {
      fromVersion,
      toVersion: STORE_VERSION,
      listCount: store.lists.length,
    });

    return store;
  }

  function pickMostRecentlyUpdatedList(lists) {
    const items = Array.isArray(lists) ? lists.filter(Boolean) : [];
    if (!items.length) {
      return { id: DEFAULT_LIST_ID, name: DEFAULT_LIST_NAME };
    }
    const sorted = items.slice().sort((a, b) => (
      (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
    ));
    return sorted[0] || items[0];
  }

  function loadAutoqTaskListStore() {
    try {
      const raw = readRawStore();
      let store = null;

      if (raw && typeof raw === 'object' && Number(raw.version) === STORE_VERSION && Array.isArray(raw.lists)) {
        store = ensureDefaultAutoqTaskList({
          version: STORE_VERSION,
          lastSelectedListId: String(raw.lastSelectedListId || '').trim(),
          lists: raw.lists.map((item) => normalizeListItem(item)).filter(Boolean),
        });
      } else if (raw) {
        store = migrateLegacyAutoqTaskLists(raw);
      }

      if (!store && typeof MemoryManager !== 'undefined' && typeof MemoryManager.get === 'function') {
        const cfg = MemoryManager.get(MemoryManager.KEYS.autoQueueConfig, null);
        if (cfg && typeof cfg === 'object') {
          store = migrateLegacyAutoqTaskLists(cfg);
        }
      }

      if (!store) {
        store = createEmptyStore();
      }

      ensureDefaultAutoqTaskList(store);

      if (!store.lastSelectedListId || !store.lists.some((item) => item.id === store.lastSelectedListId)) {
        store.lastSelectedListId = DEFAULT_LIST_ID;
      }

      const persisted = writeRawStoreOnLoadIfNeeded(store);
      if (persisted) {
        console.log('[AUTOQ_LIST_STORE][LOAD_DEDUP_PERSIST]', {
          listCount: store.lists.length,
          lastSelectedListId: store.lastSelectedListId,
        });
      }

      console.log('[AUTOQ_LIST_STORE][LOAD]', {
        version: store.version,
        listCount: store.lists.length,
        lastSelectedListId: store.lastSelectedListId,
      });

      return store;
    } catch (error) {
      console.error('[AUTOQ_LIST_STORE][ERROR]', error);
      return createEmptyStore();
    }
  }

  function saveAutoqTaskListStore(store, reason) {
    try {
      const next = ensureDefaultAutoqTaskList(
        store && typeof store === 'object' ? store : createEmptyStore(),
      );
      writeRawStore(next);
      console.log('[AUTOQ_LIST_STORE][SAVE]', {
        reason: String(reason || '-'),
        listCount: next.lists.length,
        lastSelectedListId: next.lastSelectedListId,
      });
      return next;
    } catch (error) {
      console.error('[AUTOQ_LIST_STORE][ERROR]', error);
      throw error;
    }
  }

  function getAllAutoqTaskLists(store) {
    const resolved = store && typeof store === 'object' ? store : loadAutoqTaskListStore();
    return Array.isArray(resolved.lists) ? resolved.lists.slice() : [];
  }

  function getLastSelectedAutoqTaskList(store) {
    const resolved = store && typeof store === 'object' ? store : loadAutoqTaskListStore();
    const lists = getAllAutoqTaskLists(resolved);
    const lastId = String(resolved.lastSelectedListId || '').trim();

    if (lastId) {
      const found = lists.find((item) => item.id === lastId);
      if (found) return found;
    }

    return pickMostRecentlyUpdatedList(lists);
  }

  function setActiveAutoqTaskList(listId, reason, store) {
    const resolved = store && typeof store === 'object' ? store : loadAutoqTaskListStore();
    const id = String(listId || '').trim();
    const target = resolved.lists.find((item) => item.id === id);

    if (!target) {
      console.warn('[AUTOQ_LIST_STORE][SELECT] list not found', id);
      return null;
    }

    resolved.lastSelectedListId = target.id;
    saveAutoqTaskListStore(resolved, reason || 'set-active');

    console.log('[AUTOQ_LIST][SELECT]', {
      listId: target.id,
      name: target.name,
      taskCount: String(target.text || '').split('\n').filter((line) => line.trim()).length,
      reason: String(reason || '-'),
    });

    return target;
  }

  function listStoreToConfigProfiles(store) {
    const resolved = ensureDefaultAutoqTaskList(store || loadAutoqTaskListStore());
    const active = getLastSelectedAutoqTaskList(resolved);

    return {
      listProfiles: resolved.lists.map((item) => ({
        id: item.id,
        name: item.name,
        text: String(item.text || ''),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      activeListProfileId: active ? active.id : DEFAULT_LIST_ID,
      lastSelectedListProfileId: resolved.lastSelectedListId,
      listPromptsText: active ? String(active.text || '') : '',
    };
  }

  function configProfilesToListStore(config) {
    const store = loadAutoqTaskListStore();
    const cfg = config && typeof config === 'object' ? config : {};
    const incoming = Array.isArray(cfg.listProfiles) ? cfg.listProfiles : [];

    if (!incoming.length) {
      return store;
    }

    const byId = new Map(store.lists.map((item) => [item.id, item]));

    incoming.forEach((profile) => {
      const normalized = normalizeListItem(profile);
      if (!normalized) return;

      const existing = byId.get(normalized.id);
      if (existing) {
        existing.name = normalized.name;
        existing.text = normalized.text;
        existing.updatedAt = Math.max(
          Number(existing.updatedAt) || 0,
          Number(normalized.updatedAt) || 0,
        );
      } else {
        store.lists.push(normalized);
        byId.set(normalized.id, normalized);
      }
    });

    const activeId = String(
      cfg.activeListProfileId
      || cfg.lastSelectedListProfileId
      || store.lastSelectedListId
      || '',
    ).trim();

    if (activeId && store.lists.some((item) => item.id === activeId)) {
      store.lastSelectedListId = activeId;
    }

    const active = store.lists.find((item) => item.id === activeId);
    if (active && typeof cfg.listPromptsText === 'string' && cfg.listPromptsText !== active.text) {
      active.text = cfg.listPromptsText;
      active.updatedAt = nowMs();
    }

    ensureDefaultAutoqTaskList(store);
    return saveAutoqTaskListStore(store, 'sync-from-config');
  }

  globalThis.AutoqListStore = Object.freeze({
    AUTOQ_TASK_LIST_STORE_KEY,
    STORE_VERSION,
    DEFAULT_LIST_ID,
    DEFAULT_LIST_NAME,
    loadAutoqTaskListStore,
    saveAutoqTaskListStore,
    getAllAutoqTaskLists,
    getLastSelectedAutoqTaskList,
    setActiveAutoqTaskList,
    ensureDefaultAutoqTaskList,
    dedupeAutoqTaskLists,
    migrateLegacyAutoqTaskLists,
    listStoreToConfigProfiles,
    configProfilesToListStore,
    pickMostRecentlyUpdatedList,
    createListId,
  });
})();


