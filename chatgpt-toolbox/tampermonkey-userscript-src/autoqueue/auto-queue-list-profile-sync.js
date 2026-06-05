(function initAutoQueueListProfileSyncModule() {
  const AutoQueueListProfileSync = (() => {
    function safeLog(line) {
      const text = String(line || '').trim();
      if (!text) {
        return;
      }
      if (
        typeof ToolboxShell !== 'undefined'
        && ToolboxShell
        && typeof ToolboxShell.appendLog === 'function'
      ) {
        ToolboxShell.appendLog(text);
        return;
      }
      console.log(text);
    }

    function getTaskCountFromText(text) {
      return String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .length;
    }

    function create(deps = {}) {
      const config = deps.config;
      const normalizeListProfiles = deps.normalizeListProfiles;

      if (!config || typeof config !== 'object') {
        console.error('[AUTOQ_LIST_SYNC][CREATE_FAILED] missing config');
      }

      function hydrate(reason = '') {
        if (!config || typeof config !== 'object') {
          console.error('[AUTOQ_LIST_SYNC][HYDRATE_FAILED] missing config');
          return false;
        }

        if (typeof AutoqListStore === 'undefined') {
          safeLog(`[AUTOQ_LIST_SYNC][HYDRATE_SKIP] reason=${String(reason || '-')} store=missing`);
          return false;
        }

        try {
          const patch = AutoqListStore.listStoreToConfigProfiles(
            AutoqListStore.loadAutoqTaskListStore(),
          );

          if (Array.isArray(patch.listProfiles) && patch.listProfiles.length) {
            config.listProfiles = patch.listProfiles;
          }

          if (patch.activeListProfileId) {
            config.activeListProfileId = patch.activeListProfileId;
          }

          if (patch.lastSelectedListProfileId) {
            config.lastSelectedListProfileId = patch.lastSelectedListProfileId;
          }

          if (typeof patch.listPromptsText === 'string') {
            config.listPromptsText = patch.listPromptsText;
          }

          const active = (patch.listProfiles || []).find(
            (item) => item && item.id === patch.activeListProfileId,
          );

          console.log('[AUTOQ_LIST][RESTORE_LAST_SELECTED]', {
            reason: String(reason || '-'),
            listId: patch.activeListProfileId || '',
            name: active && active.name ? active.name : '',
            taskCount: getTaskCountFromText(patch.listPromptsText),
          });

          return true;
        } catch (error) {
          console.error('[AUTOQ_LIST_STORE][HYDRATE_ERROR]', error);
          safeLog(
            `[AUTOQ_LIST_STORE][HYDRATE_ERROR] reason=${String(reason || '-')} error=${error && error.message ? error.message : String(error)}`,
          );
          return false;
        }
      }

      function persist(reason = '') {
        if (!config || typeof config !== 'object') {
          console.error('[AUTOQ_LIST_SYNC][PERSIST_FAILED] missing config');
          return false;
        }

        if (typeof AutoqListStore === 'undefined') {
          safeLog(`[AUTOQ_LIST_SYNC][PERSIST_SKIP] reason=${String(reason || '-')} store=missing`);
          return false;
        }

        try {
          if (typeof normalizeListProfiles === 'function') {
            normalizeListProfiles();
          } else {
            console.error('[AUTOQ_LIST_SYNC][NORMALIZE_MISSING] normalizeListProfiles is not function');
          }

          const store = AutoqListStore.configProfilesToListStore(config);
          const activeId = String(config.activeListProfileId || store.lastSelectedListId || '').trim();

          if (activeId) {
            store.lastSelectedListId = activeId;
            config.lastSelectedListProfileId = activeId;
          }

          AutoqListStore.saveAutoqTaskListStore(store, reason || 'sync-from-config');

          safeLog(
            `[AUTOQ_LIST_SYNC][PERSIST_OK] reason=${String(reason || '-')} activeId=${activeId || '-'}`,
          );

          return true;
        } catch (error) {
          console.error('[AUTOQ_LIST_STORE][PERSIST_ERROR]', error);
          safeLog(
            `[AUTOQ_LIST_STORE][PERSIST_ERROR] reason=${String(reason || '-')} error=${error && error.message ? error.message : String(error)}`,
          );
          return false;
        }
      }

      return Object.freeze({
        hydrate,
        persist,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueListProfileSync = AutoQueueListProfileSync;
})();


