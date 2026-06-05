  /********************************************************************
   * AutoQueueListProfileConfig：自动队列列表 Profile 配置归一化
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 listProfiles / activeListProfileId / listPromptsText 的配置归一化。
   * 3. 不负责自动发送、不负责回复等待、不负责闭环、不负责按钮渲染。
   ********************************************************************/
  const AutoQueueListProfileConfig = (() => {
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

    function safeWarn(label, payload) {
      console.warn(label, payload || {});
    }

    function createFallbackId(prefix) {
      return String(prefix || 'autoq_list') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function create(deps = {}) {
      const config = deps.config;
      const normalizeNamedEntity = deps.normalizeNamedEntity;
      const createId = deps.createId;
      const buildUniqueName = deps.buildUniqueName;
      const pad2 = deps.pad2;
      const getDefaultAutoListPromptsText = deps.getDefaultAutoListPromptsText;

      if (!config || typeof config !== 'object') {
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][CREATE_FAILED] missing config');
      }

      function getDefaultListText() {
        if (typeof getDefaultAutoListPromptsText === 'function') {
          return String(getDefaultAutoListPromptsText() || '');
        }
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][DEFAULT_TEXT_FALLBACK] getDefaultAutoListPromptsText missing');
        return '';
      }

      function normalizeEntitySafe(item, options) {
        if (typeof normalizeNamedEntity === 'function') {
          return normalizeNamedEntity(item, options);
        }
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][NORMALIZE_ENTITY_FALLBACK] normalizeNamedEntity missing', {
          item,
          options,
        });
        const now = Date.now();
        const prefix = options && options.prefix ? options.prefix : 'autoq_list';
        const fallbackName = options && options.fallbackName ? options.fallbackName : '未命名列表';
        return {
          id: String(item && item.id || '').trim() || createFallbackId(prefix),
          name: String(item && item.name || '').trim() || fallbackName,
          createdAt: Number(item && item.createdAt || now),
          updatedAt: Number(item && item.updatedAt || now),
        };
      }

      function createIdSafe(prefix) {
        if (typeof createId === 'function') {
          return createId(prefix);
        }
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][CREATE_ID_FALLBACK] createId missing', { prefix });
        return createFallbackId(prefix);
      }

      function buildUniqueNameSafe(base, names) {
        if (typeof buildUniqueName === 'function') {
          return buildUniqueName(base, names);
        }
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][UNIQUE_NAME_FALLBACK] buildUniqueName missing', {
          base,
          count: names && typeof names.size === 'number' ? names.size : -1,
        });
        let name = String(base || '列表');
        let index = 2;
        while (names && names.has && names.has(name)) {
          name = String(base || '列表') + '_' + index;
          index += 1;
        }
        return name;
      }

      function pad2Safe(value) {
        if (typeof pad2 === 'function') {
          return pad2(value);
        }
        return String(value).padStart(2, '0');
      }

      function getDefaultListProfileMeta() {
        const defaultId = (typeof AutoqListStore !== 'undefined' && AutoqListStore.DEFAULT_LIST_ID)
          ? AutoqListStore.DEFAULT_LIST_ID
          : 'list_default';
        const defaultName = (typeof AutoqListStore !== 'undefined' && AutoqListStore.DEFAULT_LIST_NAME)
          ? AutoqListStore.DEFAULT_LIST_NAME
          : '默认列表';
        return { defaultId, defaultName };
      }

      function dedupeConfigListProfiles(rawProfiles) {
        const { defaultId, defaultName } = getDefaultListProfileMeta();
        const inputLists = Array.isArray(rawProfiles) ? rawProfiles : [];
        const result = [];
        const seenIds = new Set();
        let hasDefault = false;

        for (const item of inputLists) {
          if (!item || typeof item !== 'object') {
            continue;
          }

          const base = normalizeEntitySafe(item, {
            prefix: 'autoq_list',
            fallbackName: '未命名列表',
            maxNameLength: 24,
          });
          const profile = {
            ...base,
            text: String(item.text || ''),
          };

          const rawId = String(profile.id || '').trim();
          const rawName = String(profile.name || '').trim();
          const isDefaultById = rawId === defaultId;
          const isDefaultByName = rawName === defaultName;

          if (isDefaultById || isDefaultByName) {
            if (hasDefault) {
              safeWarn('[PROMPT_LIST][DEDUP_DEFAULT_LIST]', {
                removedId: rawId,
                removedName: rawName,
              });
              continue;
            }
            result.push({
              ...profile,
              id: defaultId,
              name: defaultName,
            });
            seenIds.add(defaultId);
            hasDefault = true;
            continue;
          }

          const id = rawId || createIdSafe('autoq_list');
          const name = rawName || '未命名列表';
          if (seenIds.has(id)) {
            safeWarn('[PROMPT_LIST][DEDUP_DUPLICATE_ID]', {
              removedId: id,
              removedName: name,
            });
            continue;
          }

          result.push({
            ...profile,
            id,
            name,
          });
          seenIds.add(id);
        }

        if (!hasDefault) {
          const { defaultId: id, defaultName: name } = getDefaultListProfileMeta();
          result.unshift({
            ...normalizeEntitySafe({ id, name }, {
              prefix: 'autoq_list',
              fallbackName: name,
              maxNameLength: 24,
            }),
            text: String(config && config.listPromptsText || getDefaultListText()),
          });
        }

        return result;
      }

      function getValidActiveListProfileId(lists) {
        const { defaultId } = getDefaultListProfileMeta();
        const savedActiveId = String(
          config && (config.activeListProfileId || config.lastSelectedListProfileId) || '',
        ).trim();
        const hasSavedActive = Array.isArray(lists)
          && lists.some((item) => item && item.id === savedActiveId);
        if (hasSavedActive) {
          return savedActiveId;
        }
        return defaultId;
      }

      function normalizeListProfiles() {
        if (!config || typeof config !== 'object') {
          console.error('[AUTOQ_LIST_PROFILE_CONFIG][NORMALIZE_FAILED] missing config');
          return null;
        }

        if (!Array.isArray(config.listProfiles)) {
          config.listProfiles = [];
        }

        config.listProfiles = dedupeConfigListProfiles(config.listProfiles);

        if (!config.listProfiles.length) {
          const { defaultId, defaultName } = getDefaultListProfileMeta();
          config.listProfiles.push({
            ...normalizeEntitySafe({ id: defaultId, name: defaultName }, {
              prefix: 'autoq_list',
              fallbackName: defaultName,
              maxNameLength: 24,
            }),
            text: String(config.listPromptsText || getDefaultListText()),
          });
        }

        config.activeListProfileId = getValidActiveListProfileId(config.listProfiles);

        const preferredId = String(
          config.activeListProfileId
          || config.lastSelectedListProfileId
          || '',
        ).trim();
        let active = preferredId
          ? config.listProfiles.find((item) => item.id === preferredId)
          : null;

        if (!active && typeof AutoqListStore !== 'undefined') {
          try {
            const fromStore = AutoqListStore.getLastSelectedAutoqTaskList();
            if (fromStore) {
              active = config.listProfiles.find((item) => item.id === fromStore.id) || null;
            }
          } catch (error) {
            console.error('[AUTOQ_LIST_STORE][ERROR]', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
          }
        }

        if (!active) {
          const sorted = config.listProfiles.slice().sort((a, b) => (
            (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
          ));
          active = sorted[0] || config.listProfiles[0] || null;
        }

        if (active) {
          config.activeListProfileId = active.id;
          config.lastSelectedListProfileId = active.id;
          config.listPromptsText = active.text;
        }

        return active || null;
      }

      function getActiveListProfile() {
        normalizeListProfiles();
        if (!config || !Array.isArray(config.listProfiles)) {
          console.error('[AUTOQ_LIST_PROFILE_CONFIG][GET_ACTIVE_FAILED] config.listProfiles invalid');
          return null;
        }
        return config.listProfiles.find((item) => item.id === config.activeListProfileId)
          || config.listProfiles[0]
          || null;
      }

      function buildAutoQueueListName() {
        const d = new Date();
        const base = '列表_'
          + d.getFullYear()
          + pad2Safe(d.getMonth() + 1)
          + pad2Safe(d.getDate())
          + '_'
          + pad2Safe(d.getHours())
          + pad2Safe(d.getMinutes())
          + pad2Safe(d.getSeconds());
        const names = new Set(
          config && Array.isArray(config.listProfiles)
            ? config.listProfiles.map((item) => item.name)
            : [],
        );
        return buildUniqueNameSafe(base, names);
      }

      return Object.freeze({
        getDefaultListProfileMeta,
        dedupeConfigListProfiles,
        getValidActiveListProfileId,
        normalizeListProfiles,
        getActiveListProfile,
        buildAutoQueueListName,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueListProfileConfig = AutoQueueListProfileConfig;


