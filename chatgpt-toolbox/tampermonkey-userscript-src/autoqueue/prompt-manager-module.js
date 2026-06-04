  /********************************************************************
   * 5. PromptManagerModule：Prompt 管理模块
   ********************************************************************/

  const PromptManagerModule = (() => {
    const STORAGE_KEY = MemoryManager.KEYS.promptManagerData;

    let root = null;
    let listEl = null;
    let searchEl = null;
    let statusEl = null;

    const promptStatus = createModuleStatus('PROMPT', {
      getLocalEl: () => statusEl,
      useGlobal: false,
      useLog: false,
    });
    let importFileEl = null;
    let promptImporting = false;
    let modalOverlay = null;
    let categoryManagerOverlay = null;
    let categoryPickerOverlay = null;
    let categoryManagerOutsideClickBound = false;
    let categoryManagerOutsideClickHandler = null;

    const PROMPT_EDITOR_MODAL_POSITION_KEY = 'promptEditorModalPosition';
    const PROMPT_EDITOR_DRAFT_KEY = 'promptEditorDraftV1';

    const promptEditorPosition = createPersistedPanelPositionController({
      key: PROMPT_EDITOR_MODAL_POSITION_KEY,
      defaultWidth: 520,
      defaultHeight: 420,
      logPrefix: 'PROMPT_EDITOR_MODAL',
      memory: MemoryManager,
      appendLog: (line) => {
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(line);
        }
      },
    });
    let promptEditorResizeBound = false;
    let promptEditorDraftEventsBound = false;
    let promptEditorCloseConfirmOverlay = null;
    let editorOpenBaseline = null;

    let prompts = [];
    let categories = [];
    let searchKeyword = '';
    let activeCategory = typeof PromptCategoryState !== "undefined"
      && typeof PromptCategoryState.getActiveCategory === "function"
      ? PromptCategoryState.getActiveCategory()
      : (function () {
          var val = readDataStorage("promptManagerActiveCategory", null);
          if (val == null) {
            val = MemoryManager.get(
              MemoryManager.KEYS.promptManagerActiveCategory,
              "全部",
            );
            if (val != null) {
              writeDataStorage("promptManagerActiveCategory", val);
            }
          }
          return val != null ? val : "全部";
        })();
    let activePromptSubtab = normalizePromptSubtab(
      (function () {
        var val = readDataStorage("promptManagerActiveSubtab", null);
        if (val == null) {
          val = MemoryManager.get(
            MemoryManager.KEYS.promptManagerActiveSubtab,
            "manage",
          );
          if (val != null) {
            writeDataStorage("promptManagerActiveSubtab", val);
          }
        }
        return val != null ? val : "manage";
      })(),
    );
    let selectedPromptId = String(
      readDataStorage("promptManagerSelectedPromptId", "") || ""
    );

    function normalizePromptSubtab(value) {
      const raw = String(value || '').trim();

      if (raw === 'display') {
        return 'display';
      }

      if (raw === 'list' || raw === 'category' || raw === 'manage') {
        return 'manage';
      }

      return 'manage';
    }
    let editingPromptId = null;
    let sendLock = false;

    function getPromptCategoryName(item) {
      return normalizePromptCategoryName(item, '默认');
    }

    function createPromptCategory(name, order) {
      const cleanName = normalizePromptCategoryName(name);

      return {
        id: createId('cat'),
        name: cleanName,
        order: Number.isFinite(Number(order)) ? Number(order) : Date.now(),
        createdAt: nowMs(),
        updatedAt: nowMs(),
      };
    }

    function deriveCategoriesFromPrompts(promptList) {
      const map = new Map();

      DEFAULT_PROMPT_CATEGORIES.forEach((cat) => {
        map.set(cat.name, {
          id: cat.id,
          name: cat.name,
          order: cat.order,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
      });

      (promptList || []).forEach((p) => {
        const name = normalizePromptCategoryName(p.category);

        if (!map.has(name)) {
          map.set(name, createPromptCategory(name, map.size));
        }
      });

      return Array.from(map.values());
    }

    function normalizePromptItem(item) {
      if (!item) return null;

      const title = String(item.title || item.name || item.label || "").trim();
      const content = String(item.content || item.prompt || item.text || item.message || item.raw_content || "");

      if (!title || !content.trim()) return null;

      const legacyTitleField = (item.title ? "title" : (item.name ? "name" : (item.label ? "label" : "-")));
      const legacyContentField = (item.content ? "content" : (item.prompt ? "prompt" : (item.text ? "text" : (item.message ? "message" : (item.raw_content ? "raw_content" : "-")))));

      if (legacyTitleField !== "title" && legacyTitleField !== "-") {
        console.log(
          "[PROMPT][MIGRATE_LEGACY_FIELD] id=" + String(item.id || "-") + " titleField=" + legacyTitleField + " contentField=" + legacyContentField
        );
      } else if (legacyContentField !== "content" && legacyContentField !== "-") {
        console.log(
          "[PROMPT][MIGRATE_LEGACY_FIELD] id=" + String(item.id || "-") + " titleField=" + legacyTitleField + " contentField=" + legacyContentField
        );
      }

      return {
        id: String(item.id || createId("prompt")),
        title,
        category: normalizePromptCategoryName(item.category),
        content,
        createdAt: Number(item.createdAt || nowMs()),
        updatedAt: Number(item.updatedAt || nowMs()),
      };
    }

    function createStablePromptId(item, index) {
      const title = String(item && item.title ? item.title : '').trim();
      const category = String(item && item.category ? item.category : '默认').trim() || '默认';
      const base = `${category}::${title}::${Number.isFinite(Number(index)) ? Number(index) : 0}`;
      let hash = 0;

      for (let i = 0; i < base.length; i += 1) {
        hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
      }

      return `default_prompt_${Math.abs(hash)}`;
    }

    function buildNormalizedDefaultPrompts() {
      const defaults = createDefaultPrompts();
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[PROMPT_MANAGER][BUILTIN_PROMPT_REGISTER] count=${Array.isArray(defaults) ? defaults.length : 0}`,
        );
      }
      return defaults.map((item, index) => normalizePromptItem({
        id: item && item.id ? item.id : createStablePromptId(item, index),
        title: item.title,
        category: item.category || '默认',
        content: item.content,
        createdAt: nowMs(),
        updatedAt: nowMs(),
      })).filter(Boolean);
    }

    function normalizePromptManagerData(raw) {
      let nextPrompts = [];
      let nextCategories = [];

      if (Array.isArray(raw)) {
        nextPrompts = raw;
        nextCategories = deriveCategoriesFromPrompts(nextPrompts);
      } else if (raw && typeof raw === 'object') {
        nextPrompts = Array.isArray(raw.prompts) ? raw.prompts : [];
        nextCategories = Array.isArray(raw.categories) ? raw.categories : [];
      }

      nextPrompts = nextPrompts
        .map((item) => normalizePromptItem(item))
        .filter(Boolean);

      const beforeBuiltinCleanup = nextPrompts.length;
      nextPrompts = nextPrompts.filter((p) => {
        const id = String(p && p.id || '');
        const title = String(p && p.title || '').trim();
        const category = String(p && p.category || '').trim();
        const content = String(p && p.content || '');
        const isBuiltinId = id.startsWith('default_prompt_');
        const isMathOnce = content.includes('math_once_one_by_one');
        const isNumericTitle = title === '数字计算';
        const isDefaultCategory = category === '默认';
        if (isBuiltinId && isMathOnce && (isNumericTitle || isDefaultCategory)) {
          return false;
        }
        return true;
      });
      if (beforeBuiltinCleanup !== nextPrompts.length) {
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog('[AUTOQ][DEFAULT_SEED][CLEANUP] target=promptManager.prompts removed=builtin-math_once_one_by_one');
        }
      }

      if (!nextPrompts.length) {
        nextPrompts = [];
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog('[AUTOQ][DEFAULT_SEED][SKIP] reason=user-manual-mode target=promptManager.prompts');
        }
      }

      if (!nextCategories.length) {
        nextCategories = deriveCategoriesFromPrompts(nextPrompts);
      }

      const categoryNames = new Set();

      nextCategories = nextCategories
        .map((cat, index) => {
          const name = normalizePromptCategoryName(cat.name);

          return {
            id: String(cat.id || createId('cat')),
            name,
            order: Number.isFinite(Number(cat.order)) ? Number(cat.order) : index,
            createdAt: Number(cat.createdAt) || nowMs(),
            updatedAt: Number(cat.updatedAt) || nowMs(),
          };
        })
        .filter((cat) => {
          if (categoryNames.has(cat.name)) return false;
          categoryNames.add(cat.name);
          return true;
        });

      deriveCategoriesFromPrompts(nextPrompts).forEach((cat) => {
        if (!categoryNames.has(cat.name)) {
          nextCategories.push(cat);
          categoryNames.add(cat.name);
        }
      });

      nextCategories.sort((a, b) => Number(a.order) - Number(b.order));

      nextPrompts.forEach((p) => {
        p.category = normalizePromptCategoryName(p.category);
      });

      return {
        prompts: nextPrompts,
        categories: nextCategories,
      };
    }

    function isCursorCategoryValue(value) {
      const text = String(value == null ? '' : value).trim();
      return text.toLowerCase() === 'cursor';
    }

    function removeCursorPromptGroupFromData(data, source = '') {
      const inputPrompts = Array.isArray(data && data.prompts) ? data.prompts : [];
      const inputCategories = Array.isArray(data && data.categories) ? data.categories : [];

      const nextPrompts = inputPrompts.filter((prompt) => {
        if (!prompt) return false;
        return !(
          isCursorCategoryValue(prompt.category)
          || isCursorCategoryValue(prompt.categoryId)
          || isCursorCategoryValue(prompt.categoryName)
          || isCursorCategoryValue(prompt.group)
          || isCursorCategoryValue(prompt.groupId)
          || isCursorCategoryValue(prompt.groupName)
        );
      });

      const nextCategories = inputCategories.filter((cat) => {
        if (!cat) return false;
        return !(
          isCursorCategoryValue(cat.id)
          || isCursorCategoryValue(cat.name)
          || isCursorCategoryValue(cat.label)
          || isCursorCategoryValue(cat.title)
        );
      });

      const removedPrompts = inputPrompts.length - nextPrompts.length;
      const removedCategories = inputCategories.length - nextCategories.length;
      const hasCursorData = removedPrompts > 0 || removedCategories > 0;

      const cleaned = normalizePromptManagerData({
        prompts: nextPrompts,
        categories: nextCategories,
      });

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        if (hasCursorData) {
          ToolboxShell.appendLog(
            `[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP] removedCategories=${removedCategories} removedPrompts=${removedPrompts} reason=remove-cursor-group source=${String(source || '-')}`,
          );
        } else {
          ToolboxShell.appendLog(
            `[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP_SKIP] reason=no-cursor-data source=${String(source || '-')}`,
          );
        }
      }

      if (hasCursorData) {
        console.log(
          `[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP] removedCategories=${removedCategories} removedPrompts=${removedPrompts} reason=remove-cursor-group source=${String(source || '-')}`,
        );
      } else {
        console.log(
          `[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP_SKIP] reason=no-cursor-data source=${String(source || '-')}`,
        );
      }

      return {
        data: cleaned,
        migrated: hasCursorData,
        removedCategories,
        removedPrompts,
      };
    }

    function applyPromptManagerData(data) {
      const normalized = normalizePromptManagerData(data);
      prompts = normalized.prompts;
      categories = normalized.categories;
    }

    function loadPromptManagerData() {
      // 1. 优先读取新存储（统一 key）
      let data = null;
      try {
        data = readDataStorage("promptManagerData", null);
      } catch (err) {
        console.error("[PROMPT][LOAD] readDataStorage failed", err);
      }

      if (data) {
        const normalized = normalizePromptManagerData(data);
        // 若新 key 里只有默认 Prompt，继续检查 legacy key（兼容旧版本）
        const defaults = buildNormalizedDefaultPrompts();
        const defaultIds = new Set();
        for (let di = 0; di < defaults.length; di += 1) {
          defaultIds.add(defaults[di].id);
        }
        const onlyDefaults = (
          normalized.prompts.length > 0 &&
          normalized.prompts.length === defaults.length &&
          normalized.prompts.every(function (p) { return defaultIds.has(p.id); })
        );
        if (!onlyDefaults) {
          console.log(
            "[PROMPT][LOAD] source=DATA_STORAGE key=cgpt_toolbox_data:promptManagerData count=" + String(normalized.prompts.length)
          );
          try {
            const migrated = removeCursorPromptGroupFromData(normalized, 'DATA_STORAGE');
            if (migrated.migrated) {
              savePromptManagerData(migrated.data);
              if (isCursorCategoryValue(activeCategory)) {
                activeCategory = '全部';
                writeDataStorage("promptManagerActiveCategory", activeCategory);
              }
            }
            return migrated.data;
          } catch (err) {
            console.warn("[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP] failed source=DATA_STORAGE", err);
            if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
              ToolboxShell.appendLog(
                "[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP] failed source=DATA_STORAGE error=" + String((err && err.message) || err),
              );
            }
            return normalized;
          }
        }
        // 否则继续向下尝试 legacy key
      }
      const legacyPrefixes = [APP.storagePrefix];
      if (Array.isArray(APP.storageLegacyPrefixes)) {
        for (let idx = 0; idx < APP.storageLegacyPrefixes.length; idx += 1) {
          legacyPrefixes.push(APP.storageLegacyPrefixes[idx]);
        }
      }

      let migratedFrom = "";
      let bestRaw = null;

      for (let idx = 0; idx < legacyPrefixes.length; idx += 1) {
        const prefix = legacyPrefixes[idx];
        const fullKey = prefix + "promptManagerData";
        let raw = null;

        try {
          if (typeof GM_getValue === "function") {
            raw = GM_getValue(fullKey, null);
          }
        } catch (err) {
          console.error("[PROMPT][MIGRATE] GM_getValue failed", fullKey, err);
        }

        if (raw == null) {
          try {
            const rawText = window.localStorage.getItem(fullKey);
            if (rawText != null && rawText !== "") {
              raw = JSON.parse(rawText);
            }
          } catch (err) {
            console.error("[PROMPT][MIGRATE] localStorage read failed", fullKey, err);
          }
        }

        if (raw) {
          const normalized = normalizePromptManagerData(raw);
          // 如果是只有默认数据，继续检查下一个旧 key
          const defaults = buildNormalizedDefaultPrompts();
          const defaultIds = new Set();
          for (let di = 0; di < defaults.length; di += 1) {
            defaultIds.add(defaults[di].id);
          }
          const isOnlyDefaults = (
            normalized.prompts.length > 0 &&
            normalized.prompts.length === defaults.length &&
            normalized.prompts.every(function (p) { return defaultIds.has(p.id); })
          );

          if (!isOnlyDefaults) {
            bestRaw = normalized;
            migratedFrom = fullKey;
            break;
          }
          // 当前 legacy key 仅含默认数据，继续下一个 key
        }
      }

      // 3. 找到可用 legacy 数据：回写到新 key 并返回
      if (bestRaw) {
        let bestAfter = bestRaw;
        try {
          const migrated = removeCursorPromptGroupFromData(bestRaw, 'LEGACY');
          bestAfter = migrated.data;
          if (migrated.migrated) {
            if (isCursorCategoryValue(activeCategory)) {
              activeCategory = '全部';
              writeDataStorage("promptManagerActiveCategory", activeCategory);
            }
          }
        } catch (err) {
          console.warn("[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP] failed source=LEGACY", err);
          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              "[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP] failed source=LEGACY error=" + String((err && err.message) || err),
            );
          }
        }
        try {
          writeDataStorage("promptManagerData", {
            prompts: bestAfter.prompts,
            categories: bestAfter.categories,
          });
        } catch (err) {
          console.error("[PROMPT][MIGRATE_STORAGE] writeDataStorage failed", err);
        }
        console.log(
          "[PROMPT][MIGRATE_STORAGE] from=" + migratedFrom
          + " to=cgpt_toolbox_data:promptManagerData count=" + String(bestAfter.prompts.length)
        );
        console.log(
          "[PROMPT][LOAD] source=legacy key=" + migratedFrom + " count=" + String(bestAfter.prompts.length)
        );
        try {
          savePromptManagerData(bestAfter);
        } catch (err) {
          console.error("[PROMPT][MIGRATE_STORAGE] savePromptManagerData failed", err);
        }
        return bestAfter;
      }

      // 4. 未命中任何存储：初始化默认 Prompt
      let defaults = normalizePromptManagerData(null);
      try {
        const migrated = removeCursorPromptGroupFromData(defaults, 'DEFAULT');
        defaults = migrated.data;
      } catch (err) {
        console.warn("[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP] failed source=DEFAULT", err);
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            "[PROMPT][MIGRATE_REMOVE_CURSOR_GROUP] failed source=DEFAULT error=" + String((err && err.message) || err),
          );
        }
      }
      try {
        writeDataStorage("promptManagerData", {
          prompts: defaults.prompts,
          categories: defaults.categories,
        });
      } catch (err) {
        console.error("[PROMPT][LOAD] initial writeDataStorage failed", err);
      }
      console.log(
        "[PROMPT][LOAD] source=default key=cgpt_toolbox_data:promptManagerData count=" + String(defaults.prompts.length)
      );
      savePromptManagerData(defaults);
      return defaults;
    }

    function savePromptManagerData(data) {
      const payload = data || { prompts, categories };
      const promptCount = (payload.prompts || prompts).length;
      const categoryCount = (payload.categories || categories).length;

      let ok = false;
      let errorType = "";
      let errorMsg = "";

      try {
        ok = writeDataStorage("promptManagerData", {
          prompts: payload.prompts || prompts,
          categories: payload.categories || categories,
        });
      } catch (err) {
        errorType = (err && err.name) || "Error";
        errorMsg = (err && err.message) || String(err);
        console.error(
          "[PROMPT][SAVE] save failed",
          { error_type: errorType, error: errorMsg, key: "cgpt_toolbox_data:promptManagerData" }
        );
        if (typeof ToolboxShell !== "undefined" && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            "[PROMPT][SAVE] save failed error_type=" + errorType + " error=" + errorMsg
          );
        }
      }

      if (!ok) {
        if (!errorType) {
          console.error("[ChatGPT toolbox] savePromptManagerData failed");
          if (typeof ToolboxShell !== "undefined" && ToolboxShell.appendLog) {
            ToolboxShell.appendLog("[Prompt 管理] 保存失败：浏览器存储写入失败");
          }
        }
      } else {
        console.log(
          "[PROMPT][SAVE] key=cgpt_toolbox_data:promptManagerData count=" + String(promptCount)
        );
        let preserveAutoQueue = 0;
        if (typeof AutoQueueModule !== "undefined" && typeof AutoQueueModule.getConfig === "function") {
          const autoCfg = AutoQueueModule.getConfig();
          const tasks = autoCfg && Array.isArray(autoCfg.autoQueueTasks) ? autoCfg.autoQueueTasks : [];
          preserveAutoQueue = tasks.length;
        }
        if (typeof ToolboxShell !== "undefined" && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            "[PROMPT][SAVE] count=" + String(promptCount) + " preserveAutoQueue=" + String(preserveAutoQueue)
          );
        }
      }

      return ok;
    }

    function getPromptCategoryCounts(promptList, categoryList) {
      const list = Array.isArray(promptList) ? promptList : [];
      const cats = Array.isArray(categoryList) ? categoryList : [];
      const counts = {};
      let total = 0;

      cats.forEach((cat) => {
        const name = normalizePromptCategoryName(cat && cat.name);
        if (name) {
          counts[name] = 0;
        }
      });

      list.forEach((prompt) => {
        total += 1;
        const category = normalizePromptCategoryName(prompt && prompt.category) || '默认';
        counts[category] = (counts[category] || 0) + 1;
      });

      counts.__all__ = total;
      return counts;
    }

    function getPromptCategoriesForFilter() {
      return [
        { id: '__all__', name: '全部' },
        ...categories.map((cat) => ({ id: cat.id, name: cat.name })),
      ];
    }

    function getPromptCategoriesFromList(list) {
      const names = categories.map((cat) => cat.name);

      (list || []).forEach((item) => {
        const name = getPromptCategoryName(item);

        if (!names.includes(name)) {
          names.push(name);
        }
      });

      return ['全部', ...names];
    }

    function syncActiveCategoryFromSharedState() {
      if (typeof PromptCategoryState !== 'undefined'
        && typeof PromptCategoryState.getActiveCategory === 'function') {
        activeCategory = PromptCategoryState.getActiveCategory();
      }
      return normalizeActiveCategory();
    }

    function persistActivePromptCategory(category) {
      activeCategory = category;
      if (typeof PromptCategoryState !== 'undefined'
        && typeof PromptCategoryState.setActiveCategory === 'function') {
        PromptCategoryState.setActiveCategory(category);
        return activeCategory;
      }

      MemoryManager.set(
        MemoryManager.KEYS.promptManagerActiveCategory,
        activeCategory,
      );
      writeDataStorage("promptManagerActiveCategory", activeCategory);
      return activeCategory;
    }

    function normalizeActiveCategory() {
      const filterNames = getPromptCategoriesForFilter().map((cat) => cat.name);

      if (!filterNames.includes(activeCategory)) {
        persistActivePromptCategory('全部');
      }

      return activeCategory;
    }

    function ensureCategoryExists(name) {
      const cleanName = normalizePromptCategoryName(name);
      const exists = categories.some((cat) => cat.name === cleanName);

      if (!exists) {
        categories.push(createPromptCategory(cleanName, categories.length));
        categories.sort((a, b) => Number(a.order) - Number(b.order));
      }

      return cleanName;
    }

    function getDefaultPromptEditorCategory() {
      syncActiveCategoryFromSharedState();

      if (typeof PromptCategoryState !== 'undefined'
        && typeof PromptCategoryState.getEditorDefaultCategory === 'function') {
        return PromptCategoryState.getEditorDefaultCategory();
      }

      const current = normalizePromptCategoryName(activeCategory || '');

      if (current && current !== '全部') {
        return current;
      }

      return '默认';
    }

    function renderEditorCategoryOptions(selectedName = '') {
      const select = modalOverlay
        ? qs('#cgpt-prompt-edit-category', modalOverlay)
        : null;

      if (!(select instanceof HTMLSelectElement)) {
        return;
      }

      const selected = normalizePromptCategoryName(selectedName || '默认');

      const names = categories
        .map((cat) => normalizePromptCategoryName(cat.name))
        .filter(Boolean);

      if (!names.includes('默认')) {
        names.unshift('默认');
      }

      const uniqueNames = Array.from(new Set(names));

      select.innerHTML = uniqueNames.map((name) => `
        <option value="${escapeHtml(name)}">${escapeHtml(name)}</option>
      `).join('');

      select.value = uniqueNames.includes(selected) ? selected : '默认';
    }

    function renderCategoryManager() {
      const host = categoryManagerOverlay || root;
      const listEl = qs('#cgpt-prompt-category-manage-list', host);

      if (!listEl) return;

      const counts = getPromptCategoryCounts(prompts, categories);

      if (!categories.length) {
        listEl.innerHTML = renderEmptyState('暂无类别', 'cgpt-log-empty cgpt-empty-state');
        return;
      }

      listEl.innerHTML = categories.map((cat) => {
        const count = Number(counts[normalizePromptCategoryName(cat.name)] || 0);
        const locked = cat.name === '默认';

        return `
      <div class="cgpt-category-item cgpt-prompt-category-manage-item" data-category-id="${escapeHtml(cat.id)}">
        <div class="cgpt-prompt-category-manage-main">
          <div class="cgpt-category-name cgpt-prompt-category-manage-name">${escapeHtml(cat.name)}</div>
          <div class="cgpt-category-count cgpt-prompt-category-manage-meta">${count} Prompt</div>
        </div>
        <div class="cgpt-category-actions">
          <button type="button"
            class="cgpt-toolbox-small-btn"
            data-category-rename="${escapeHtml(cat.id)}">
            重命名
          </button>
          <button type="button"
            class="cgpt-toolbox-small-btn"
            data-category-delete="${escapeHtml(cat.id)}"
            ${locked ? 'disabled' : ''}>
            删除
          </button>
        </div>
      </div>
    `;
      }).join('');
    }

    function addPromptCategory() {
      const host = categoryManagerOverlay || root;
      const input = qs('#cgpt-prompt-category-name', host);
      const name = normalizePromptCategoryName(input && input.value);

      if (!name) {
        setStatus('类别名称不能为空');
        return;
      }

      if (categories.some((cat) => cat.name === name)) {
        setStatus(`类别已存在：${name}`);
        return;
      }

      categories.push(createPromptCategory(name, categories.length));
      categories.sort((a, b) => Number(a.order) - Number(b.order));

      if (!savePromptManagerData()) {
        setStatus('保存失败：浏览器存储写入失败', 'error');
        return;
      }

      ToolboxShell.appendLog('[PROMPT_UI][CATEGORY_CREATE] category=' + name);

      if (input) input.value = '';

      render();

      setStatus(`已新建类别：${name}`);
      notifyUploadQuickPromptsRefresh('prompt-save');
    }

    function renamePromptCategory(categoryId) {
      const cat = categories.find((x) => x.id === categoryId);

      if (!cat) {
        setStatus('类别不存在');
        return;
      }

      const oldName = cat.name;
      const nextName = normalizePromptCategoryName(
        window.prompt('工具箱名称', oldName),
      );

      if (!nextName) {
        setStatus('类别名称不能为空');
        return;
      }

      if (nextName !== oldName && categories.some((x) => x.name === nextName)) {
        setStatus(`类别已存在：${nextName}`);
        return;
      }

      cat.name = nextName;
      cat.updatedAt = nowMs();

      prompts.forEach((p) => {
        if (normalizePromptCategoryName(p.category) === oldName) {
          p.category = nextName;
          p.updatedAt = nowMs();
        }
      });

      if (activeCategory === oldName) {
        persistActivePromptCategory(nextName);
      }

      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh('prompt-save');

      ToolboxShell.appendLog('[PROMPT_UI][CATEGORY_RENAME] old=' + oldName + ' new=' + nextName);
      setStatus(`已重命名类别：${oldName} -> ${nextName}`);
    }

    function deletePromptCategory(categoryId) {
      const cat = categories.find((x) => x.id === categoryId);

      if (!cat) {
        setStatus('类别不存在');
        return;
      }

      if (cat.name === '默认') {
        setStatus('默认类别不能删除');
        return;
      }

      const counts = getPromptCategoryCounts(prompts, categories);
      const count = Number(counts[normalizePromptCategoryName(cat.name)] || 0);

      const ok = window.confirm(
        `确定删除类别：${cat.name}”吗？该类别：${count} Prompt 会移动到“默认”。`,
      );

      if (!ok) return;

      prompts.forEach((p) => {
        if (normalizePromptCategoryName(p.category) === cat.name) {
          p.category = '默认';
          p.updatedAt = nowMs();
        }
      });

      categories = categories.filter((x) => x.id !== categoryId);

      if (!categories.some((x) => x.name === '默认')) {
        categories.unshift({
          id: 'default',
          name: '默认',
          order: 0,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });
      }

      if (activeCategory === cat.name) {
        persistActivePromptCategory('全部');
        ToolboxShell.appendLog('[PROMPT_UI][CATEGORY_RESET_TO_ALL] reason=active-category-deleted');
      }

      if (!savePromptManagerData()) {
        setStatus('保存失败：浏览器存储写入失败', 'error');
        return;
      }

      render();
      notifyUploadQuickPromptsRefresh('prompt-save');

      ToolboxShell.appendLog('[PROMPT_UI][CATEGORY_DELETE] category=' + cat.name + ' removedPrompts=' + String(count));
      setStatus(`已删除类别：${cat.name}，相关 Prompt 已移动到默认`);
    }

    applyPromptManagerData(loadPromptManagerData());

    function notifyUploadQuickPromptsRefresh(reason = '') {
      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }

      if (
        typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.onPromptManagerChanged === 'function'
      ) {
        AutoQueueModule.onPromptManagerChanged(reason || 'prompt-manager-change');
      }
    }

    function commitPromptManagerChange(message, options = {}) {
      if (!options.skipPersist) {
        savePromptManagerData();
      }
      render();
      notifyUploadQuickPromptsRefresh(options.reason || 'prompt-manager-change');

      if (options.closeEditor) {
        closeEditorImmediate();
      }

      if (message) {
        setStatus(message);
      }
    }

    function deletePromptById(promptId, options = {}) {
      flushPromptDetailBeforeSwitch();

      const item = prompts.find((prompt) => prompt.id === promptId);

      if (!item) {
        setStatus('Prompt 不存在');
        return false;
      }

      if (options.confirm !== false) {
        const ok = window.confirm(`确定删除这个 Prompt 吗？\n\n${item.title}`);
        if (!ok) return false;
      }

      prompts = prompts.filter((prompt) => prompt.id !== promptId);
      if (String(selectedPromptId || '') === String(promptId || '')) {
        const next = prompts[0] || null;
        persistSelectedPromptId(next ? next.id : '', 'delete-selected');
      }
      commitPromptManagerChange(promptDeletedMessage(item.title), {
        closeEditor: options.closeEditor === true,
        reason: 'prompt-delete',
      });
      return true;
    }

    function reloadFromStorage() {
      applyPromptManagerData(loadPromptManagerData());
      searchKeyword = '';
      render();
      notifyUploadQuickPromptsRefresh('prompt-reload');
    }

    function clearPromptStatus() {
      promptStatus.clear();
    }

    function setStatus(message, timeout) {
      const text = String(message || '').trim();

      if (/^\d+\s*条\s*[，,]\s*当前显示\s*\d+\s*条$/.test(text)) {
        clearPromptStatus();

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
          ToolboxShell.purgeForbiddenStatusBadge('prompt-local-stat-status');
        }

        return;
      }

      const ms = timeout == null ? 1800 : timeout;

      if (ms > 0) {
        promptStatus.set(text, 'info', { timeoutMs: ms });
      } else {
        promptStatus.set(text, 'info');
      }
    }

    function filteredPrompts() {
      const category = normalizeActiveCategory();
      const kw = searchKeyword.trim().toLowerCase();

      let list = prompts.slice();

      if (category !== '全部') {
        list = list.filter((item) => getPromptCategoryName(item) === category);
      }

      if (!kw) {
        return list;
      }

      return list.filter((item) => {
        const haystack = [
          item.title || '',
          item.category || '',
          item.content || '',
        ].join('\n').toLowerCase();

        return haystack.includes(kw);
      });
    }

    function persistSelectedPromptId(id, source = '') {
      selectedPromptId = String(id || '');
      writeDataStorage("promptManagerSelectedPromptId", selectedPromptId);
      if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.set === 'function') {
        MemoryManager.set("promptManagerSelectedPromptId", selectedPromptId);
      }
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[PROMPT][SELECT] source=${source || '-'} id=${selectedPromptId || '-'}`,
        );
      }
    }

    function findPromptById(id) {
      const targetId = String(id || '');
      if (!targetId) return null;
      return prompts.find((item) => String(item.id || '') === targetId) || null;
    }

    function resolveSelectedPromptForItems(items) {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) {
        // Filtering/searching should not permanently rewrite user's selectedPromptId.
        return null;
      }
      const current = list.find((item) => String(item.id || '') === selectedPromptId);
      if (current) {
        return current;
      }
      // Selected prompt is not visible under current filter; use first visible as a temporary selection.
      // IMPORTANT: do NOT persist this fallback.
      const first = list[0];
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[PROMPT][SELECT_VISIBLE_FALLBACK] id=${String(first && first.id ? first.id : '-')}`,
        );
      }
      return first;
    }

    function selectPrompt(id, source = '') {
      const nextId = String(id || '');
      if (!nextId) {
        persistSelectedPromptId('', source || 'clear');
        render();
        return;
      }
      const item = findPromptById(nextId);
      if (!item) {
        persistSelectedPromptId('', source || 'missing');
        render();
        return;
      }
      persistSelectedPromptId(nextId, source || 'select');
      render();
    }

    function escapeCssIdent(value) {
      const text = String(value || '');
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(text);
      }
      return text.replace(/["\\]/g, '\\$&');
    }

    function focusSelectedPromptRow(id) {
      if (!listEl) return;
      const targetId = String(id || selectedPromptId || '');
      if (!targetId) return;
      const safeId = escapeCssIdent(targetId);
      const row = listEl.querySelector(`[data-prompt-nav-item="1"][data-id="${safeId}"]`);
      if (!(row instanceof HTMLElement)) return;
      row.focus({ preventScroll: true });
      row.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      });
    }

    function movePromptSelectionByKeyboard(delta, source) {
      const items = filteredPrompts();
      if (!items.length) return;

      let currentIndex = items.findIndex((item) => String(item.id || '') === String(selectedPromptId || ''));
      if (currentIndex < 0) {
        currentIndex = 0;
      } else {
        currentIndex += delta;
      }
      if (currentIndex < 0) currentIndex = 0;
      if (currentIndex >= items.length) currentIndex = items.length - 1;

      const next = items[currentIndex];
      if (!next || !next.id) return;
      persistSelectedPromptId(next.id, source || 'keyboard');
      render();
      window.requestAnimationFrame(() => focusSelectedPromptRow(next.id));
    }

    function jumpPromptSelectionByKeyboard(position, source) {
      const items = filteredPrompts();
      if (!items.length) return;

      const next = position === 'end'
        ? items[items.length - 1]
        : items[0];
      if (!next || !next.id) return;
      persistSelectedPromptId(next.id, source || 'keyboard-jump');
      render();
      window.requestAnimationFrame(() => focusSelectedPromptRow(next.id));
    }

    function handlePromptListKeydown(event) {
      if (!event) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target) {
        const tag = String(target.tagName || '').toLowerCase();
        if (
          tag === 'input'
          || tag === 'textarea'
          || tag === 'select'
          || target.isContentEditable
        ) {
          return;
        }
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        movePromptSelectionByKeyboard(1, 'keyboard-arrow-down');
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        movePromptSelectionByKeyboard(-1, 'keyboard-arrow-up');
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        jumpPromptSelectionByKeyboard('start', 'keyboard-home');
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        jumpPromptSelectionByKeyboard('end', 'keyboard-end');
      }
    }

    function renderPromptDetailPanel(item) {
      const panel = root ? qs('#cgpt-prompt-detail-panel', root) : null;
      if (!panel) return;
      panel.innerHTML = '';

      if (!item) {
        const empty = document.createElement('div');
        empty.className = 'cgpt-prompt-detail-empty';
        empty.innerHTML = `
          <div class="cgpt-panel-title">Prompt 详情</div>
          <div class="cgpt-hint">左侧选择一个 Prompt 后，这里显示完整内容。</div>
        `;
        panel.appendChild(empty);
        return;
      }

      const autosaveHint = document.createElement('div');
      autosaveHint.className = 'cgpt-hint cgpt-prompt-detail-autosave-hint';
      autosaveHint.textContent = '直接编辑，停顿后自动保存';

      const title = document.createElement('input');
      title.type = 'text';
      title.id = 'cgpt-prompt-detail-title-input';
      title.className = 'cgpt-prompt-detail-title cgpt-input';
      title.dataset.promptId = String(item.id || '');
      title.value = item.title || '未命名 Prompt';
      title.setAttribute('aria-label', 'Prompt 标题');
      bindOnce(title, 'input', () => {
        onPromptDetailTitleInput(item);
      }, `bound_prompt_detail_title_input_${item.id}`);

      const meta = document.createElement('div');
      meta.id = 'cgpt-prompt-detail-meta';
      meta.className = 'cgpt-prompt-detail-meta';
      meta.textContent = `分类：${item.category || '默认'}｜字数：${String(item.content || '').length}`;

      const content = document.createElement('textarea');
      content.id = 'cgpt-prompt-detail-content';
      content.className = 'cgpt-prompt-detail-content cgpt-input';
      content.dataset.promptId = String(item.id || '');
      content.readOnly = false;
      content.spellcheck = true;
      content.value = String(item.content || '');
      bindOnce(content, 'input', () => {
        onPromptDetailContentInput(item);
      }, `bound_prompt_detail_content_input_${item.id}`);

      const actions = document.createElement('div');
      actions.className = 'cgpt-prompt-detail-actions';

      const batchLabel = document.createElement('label');
      batchLabel.className = 'cgpt-checkbox-line cgpt-prompt-detail-batch-check';
      const batchCheck = document.createElement('input');
      batchCheck.type = 'checkbox';
      batchCheck.checked = (
        typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.isPromptBatchTaskSelected === 'function'
        && AutoQueueModule.isPromptBatchTaskSelected(item.id)
      );
      batchCheck.addEventListener('change', () => {
        if (
          typeof AutoQueueModule === 'undefined'
          || typeof AutoQueueModule.addPromptBatchTask !== 'function'
          || typeof AutoQueueModule.removePromptBatchTask !== 'function'
        ) {
          batchCheck.checked = false;
          return;
        }
        if (batchCheck.checked) {
          AutoQueueModule.addPromptBatchTask(item.id);
        } else {
          AutoQueueModule.removePromptBatchTask(item.id);
        }
        renderPromptDetailPanel(item);
      });
      const batchText = document.createElement('span');
      batchText.textContent = '加入批量任务';
      batchLabel.appendChild(batchCheck);
      batchLabel.appendChild(batchText);

      const fillBtn = createActionButton('填入');
      fillBtn.addEventListener('click', () => {
        sendPrompt(item.content, false);
      });

      const sendBtn = createActionButton('发送', 'primary');
      sendBtn.addEventListener('click', () => {
        void sendPrompt(item.content, true);
      });

      const copyBtn = createActionButton('复制');
      copyBtn.addEventListener('click', async () => {
        const ok = await copyTextUnified(item.content, 'prompt-manager:copy-detail');
        if (ok) {
          setStatus(`已复制：${item.title}`);
        } else {
          setStatus('复制失败，请手动复制', 'error');
        }
      });

      const deleteBtn = createActionButton('删除');
      deleteBtn.classList.add('danger');
      deleteBtn.addEventListener('click', () => {
        deletePromptById(item.id);
      });

      const upBtn = createActionButton('上移');
      upBtn.addEventListener('click', () => {
        movePrompt(item.id, -1);
      });

      const downBtn = createActionButton('下移');
      downBtn.addEventListener('click', () => {
        movePrompt(item.id, 1);
      });

      actions.appendChild(batchLabel);
      actions.appendChild(fillBtn);
      actions.appendChild(sendBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(deleteBtn);
      actions.appendChild(upBtn);
      actions.appendChild(downBtn);

      panel.appendChild(autosaveHint);
      panel.appendChild(title);
      panel.appendChild(meta);
      panel.appendChild(content);
      panel.appendChild(actions);
      promptDetailDirty = false;
    }

    function renderCategoryBar() {
      if (!root) return;

      const bar = qs('#cgpt-prompt-category-bar', root);
      if (!bar) return;

      const filterCategories = getPromptCategoriesForFilter();
      const current = normalizeActiveCategory();
      const counts = getPromptCategoryCounts(prompts, categories);

      const allNames = filterCategories.map((cat) => cat.name);
      const normalNames = allNames.filter((name) => String(name || '').trim() && String(name || '').trim() !== '全部');
      const maxChipCount = 8;

      let visibleNames = allNames.slice();
      let moreHiddenCount = 0;

      if (normalNames.length + 1 > maxChipCount) {
        const ensure = (name, list) => {
          const text = String(name || '').trim();
          if (!text) return;
          if (!list.includes(text)) list.push(text);
        };

        visibleNames = [];
        ensure('全部', visibleNames);
        ensure('默认', visibleNames);
        ensure(current, visibleNames);

        const ranked = normalNames
          .filter((name) => name !== '默认' && name !== current)
          .map((name) => ({ name, count: Number(counts[normalizePromptCategoryName(name)] || 0) }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

        const remainingSlots = Math.max(0, maxChipCount - 1 - visibleNames.length);
        ranked.slice(0, remainingSlots).forEach((item) => ensure(item.name, visibleNames));

        const hiddenNames = normalNames.filter((name) => !visibleNames.includes(name));
        moreHiddenCount = hiddenNames.length;
        visibleNames.push('__more__');
      }

      bar.innerHTML = renderPromptCategoryChips(
        visibleNames.map((name) => (name === '__more__' ? `更多 ${moreHiddenCount}...` : name)),
        current,
        (name) => {
          if (name === '全部') return Number(counts.__all__ || 0);
          if (String(name || '').startsWith('更多 ')) return moreHiddenCount;
          const normalized = normalizePromptCategoryName(name);
          return Number(counts[normalized] || 0);
        },
        'data-prompt-category',
      );
    }

    function toggleCategoryManagerModal(show, source = '') {
      if (!categoryManagerOverlay && root) {
        categoryManagerOverlay = qs('#cgpt-prompt-category-popover', root);
      }
      if (!categoryManagerOverlay) return;

      const nextShow = show === true ? true : (show === false ? false : categoryManagerOverlay.style.display === 'none');
      categoryManagerOverlay.style.display = nextShow ? 'block' : 'none';

      if (nextShow) {
        ToolboxShell.appendLog('[PROMPT_UI][CATEGORY_MANAGER_OPEN] source=' + (source || 'manage-button'));
        renderCategoryManager();
        const input = qs('#cgpt-prompt-category-name', categoryManagerOverlay);
        if (input) {
          window.setTimeout(() => input.focus(), 50);
        }

        if (!categoryManagerOutsideClickBound) {
          categoryManagerOutsideClickBound = true;
          categoryManagerOutsideClickHandler = (event) => {
            if (!categoryManagerOverlay || categoryManagerOverlay.style.display === 'none') return;
            const target = event && event.target ? event.target : null;
            const manageBtn = root ? qs('#cgpt-prompt-category-manage-btn', root) : null;

            if (target instanceof Node) {
              if (categoryManagerOverlay.contains(target)) return;
              if (manageBtn && manageBtn.contains && manageBtn.contains(target)) return;
            }

            ToolboxShell.appendLog('[PROMPT_UI][CATEGORY_MANAGER_CLOSE] source=outside-click');
            categoryManagerOverlay.style.display = 'none';
          };
          window.addEventListener('mousedown', categoryManagerOutsideClickHandler, true);
        }
      } else {
        ToolboxShell.appendLog('[PROMPT_UI][CATEGORY_MANAGER_CLOSE] source=' + (source || 'toggle'));
      }
    }

    function renderCategoryPickerList() {
      if (!categoryPickerOverlay) {
        categoryPickerOverlay = root ? qs('#cgpt-prompt-category-picker-modal', root) : null;
      }
      if (!categoryPickerOverlay) return;

      const wrap = qs('#cgpt-prompt-category-picker-list', categoryPickerOverlay);
      if (!wrap) return;

      const filterCategories = getPromptCategoriesForFilter();
      const current = normalizeActiveCategory();
      const counts = getPromptCategoryCounts(prompts, categories);

      const names = filterCategories.map((cat) => cat.name);
      wrap.innerHTML = renderPromptCategoryChips(
        names,
        current,
        (name) => {
          if (name === '全部') return Number(counts.__all__ || 0);
          return Number(counts[normalizePromptCategoryName(name)] || 0);
        },
        'data-prompt-category-pick',
      );
    }

    function toggleCategoryPickerModal(show) {
      if (!categoryPickerOverlay) {
        categoryPickerOverlay = root ? qs('#cgpt-prompt-category-picker-modal', root) : null;
      }
      if (!categoryPickerOverlay) return;
      if (show) {
        renderCategoryPickerList();
      }
      categoryPickerOverlay.style.display = show ? 'flex' : 'none';
    }

    function getPromptDisplayConfig() {
      if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.getConfig === 'function') {
        return SettingsModule.getConfig();
      }

      const saved = MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {};

      if (typeof normalizeCompactUiConfig === 'function') {
        return normalizeCompactUiConfig(saved);
      }

      return Object.assign({}, DEFAULT_COMPACT_UI_CONFIG || {}, saved);
    }

    function normalizeQuickPromptSelectionMode(value) {
      if (typeof window.normalizeQuickPromptSelectionMode === 'function') {
        return window.normalizeQuickPromptSelectionMode(value);
      }
      const raw = String(value || '').trim().toLowerCase();
      return raw === 'manual' ? 'manual' : 'auto';
    }

    function shouldMarkQuickPromptSelectionManualByReason(reason = '') {
      const normalized = String(reason || '').trim().toLowerCase();
      if (!normalized) return false;
      // 任何来自“展示设置”面板的显式选择行为，都视为用户手动选择（包括全不选）。
      return normalized.startsWith('bulk-')
        || normalized.startsWith('display-')
        || normalized.includes('prompt-check-change')
        || normalized.includes('display-option-change');
    }

    function savePromptDisplayConfig(nextConfig, reason = '') {
      const current = getPromptDisplayConfig();
      const merged = Object.assign({}, current, nextConfig || {});
      const next = Object.assign({}, merged, {
        quickPromptSelectionMode: normalizeQuickPromptSelectionMode(
          shouldMarkQuickPromptSelectionManualByReason(reason)
            ? 'manual'
            : (merged.quickPromptSelectionMode || 'auto'),
        ),
      });

      if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.saveConfig === 'function') {
        SettingsModule.saveConfig(next);
      } else if (typeof normalizeCompactUiConfig === 'function') {
        MemoryManager.set(MemoryManager.KEYS.compactUiConfig, normalizeCompactUiConfig(next));
      } else {
        MemoryManager.set(MemoryManager.KEYS.compactUiConfig, next);
      }

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }

      notifyUploadQuickPromptsRefresh(reason || 'prompt-display-config-change');

      ToolboxShell.appendLog(
        `[PROMPT_DISPLAY][SAVE] reason=${reason || '-'} selected=${Array.isArray(next.quickPromptIds) ? next.quickPromptIds.length : 0}`,
      );
    }

    function getPromptIdsFromPromptList(promptList) {
      return (Array.isArray(promptList) ? promptList : [])
        .map((item) => String(item && item.id ? item.id : '').trim())
        .filter(Boolean);
    }

    function readPromptDisplayConfigFromUi() {
      const current = getPromptDisplayConfig();

      const selectedIds = qsa('[data-prompt-display-id]', root)
        .filter((input) => input instanceof HTMLInputElement && input.checked)
        .map((input) => String(input.getAttribute('data-prompt-display-id') || '').trim())
        .filter(Boolean);

      const uploadVisibleEl = qs('#cgpt-prompt-display-upload-visible', root);
      const compactVisibleEl = qs('#cgpt-prompt-display-compact-visible', root);
      const actionEl = qs('#cgpt-prompt-display-click-action', root);
      const confirmEl = qs('#cgpt-prompt-display-confirm-overwrite', root);

      return Object.assign({}, current, {
        showUploadQuickPrompts: uploadVisibleEl
          ? !!uploadVisibleEl.checked
          : current.showUploadQuickPrompts !== false,

        showCompactQuickPrompts: compactVisibleEl
          ? !!compactVisibleEl.checked
          : current.showCompactQuickPrompts !== false,

        // 上传页常用 Prompt 点击固定填入并发送；此配置仅保留兼容，保存时强制 send。
        quickPromptClickAction: 'send',

        confirmPromptDraftOverwrite: confirmEl
          ? !!confirmEl.checked
          : current.confirmPromptDraftOverwrite === true,

        quickPromptIds: selectedIds,
        quickPromptSelectionMode: normalizeQuickPromptSelectionMode(current.quickPromptSelectionMode || 'auto'),
      });
    }

    function renderPromptDisplayCheckboxList(promptList, selectedIds) {
      const list = Array.isArray(promptList) ? promptList : [];
      const selected = new Set(
        Array.isArray(selectedIds)
          ? selectedIds.map((id) => String(id))
          : [],
      );

      if (!list.length) {
        return '<div class="cgpt-log-empty">暂无 Prompt，请先在“Prompt 管理”里新建。</div>';
      }

      return list.map((item) => {
        const id = String(item && item.id ? item.id : '');
        const title = String(item && item.title ? item.title : '未命名 Prompt');
        const category = String(item && item.category ? item.category : '默认');
        const content = String(item && item.content ? item.content : '');
        const checked = selected.has(id) ? ' checked' : '';

        return `
      <label class="cgpt-prompt-display-row">
        <input
          type="checkbox"
          data-prompt-display-id="${escapeHtml(id)}"
          ${checked}
        >
        <span class="cgpt-prompt-display-main">
          <strong>${escapeHtml(title)}</strong>
          <small>分类：${escapeHtml(category)}｜字数：${content.length}</small>
        </span>
      </label>
    `;
      }).join('');
    }

    function renderPromptDisplayPanel() {
      if (!root) return;

      const cfg = getPromptDisplayConfig();
      const list = prompts.slice();
      const allIds = getPromptIdsFromPromptList(list);
      const selectedIds = Array.isArray(cfg.quickPromptIds)
        ? cfg.quickPromptIds.map((id) => String(id)).filter(Boolean)
        : [];

      const selectedSet = new Set(selectedIds);
      const validSelectedCount = allIds.filter((id) => selectedSet.has(id)).length;

      const uploadVisibleEl = qs('#cgpt-prompt-display-upload-visible', root);
      if (uploadVisibleEl) {
        uploadVisibleEl.checked = cfg.showUploadQuickPrompts !== false;
      }

      const compactVisibleEl = qs('#cgpt-prompt-display-compact-visible', root);
      if (compactVisibleEl) {
        compactVisibleEl.checked = cfg.showCompactQuickPrompts !== false;
      }

      const actionEl = qs('#cgpt-prompt-display-click-action', root);
      if (actionEl) {
        actionEl.value = cfg.quickPromptClickAction === 'fill' ? 'fill' : 'send';
      }

      const confirmEl = qs('#cgpt-prompt-display-confirm-overwrite', root);
      if (confirmEl) {
        confirmEl.checked = cfg.confirmPromptDraftOverwrite === true;
      }

      const countEl = qs('#cgpt-prompt-display-count', root);
      if (countEl) {
        countEl.textContent = `已选 ${validSelectedCount} / ${allIds.length}`;
      }

      [
        '#cgpt-prompt-display-select-all',
        '#cgpt-prompt-display-clear-all',
        '#cgpt-prompt-display-invert',
      ].forEach((selector) => {
        const btn = qs(selector, root);
        if (btn) {
          btn.disabled = allIds.length === 0;
        }
      });

      const displayListEl = qs('#cgpt-prompt-display-list', root);
      if (displayListEl) {
        displayListEl.innerHTML = renderPromptDisplayCheckboxList(list, selectedIds);
      }
    }

    function applyPromptDisplaySelection(mode) {
      const list = prompts.slice();
      const allIds = getPromptIdsFromPromptList(list);
      const cfg = readPromptDisplayConfigFromUi();
      const currentSelected = new Set(
        Array.isArray(cfg.quickPromptIds)
          ? cfg.quickPromptIds.map((id) => String(id)).filter(Boolean)
          : [],
      );

      if (mode === 'all') {
        cfg.quickPromptIds = allIds;
        cfg.quickPromptSelectionMode = 'manual';
      } else if (mode === 'none') {
        cfg.quickPromptIds = [];
        cfg.quickPromptSelectionMode = 'manual';
      } else if (mode === 'invert') {
        cfg.quickPromptIds = allIds.filter((id) => !currentSelected.has(id));
        cfg.quickPromptSelectionMode = 'manual';
      } else {
        ToolboxShell.appendLog(`[PROMPT_DISPLAY][BULK][SKIP] unknownMode=${mode}`);
        return;
      }

      savePromptDisplayConfig(cfg, `bulk-${mode}`);
      renderPromptDisplayPanel();

      ToolboxShell.appendLog(
        `[PROMPT_DISPLAY][BULK] mode=${mode} selected=${cfg.quickPromptIds.length}/${allIds.length}`,
      );
    }

    function renderPromptSubtabs() {
      const normalized = normalizePromptSubtab(activePromptSubtab);
      activePromptSubtab = normalized;

      const tabs = qsa('[data-prompt-subtab]', root);
      tabs.forEach((btn) => {
        const name = normalizePromptSubtab(btn.getAttribute('data-prompt-subtab'));
        btn.classList.toggle('active', name === normalized);
      });

      const managePanel = qs('#cgpt-prompt-manage-panel', root);
      const displayPanel = qs('#cgpt-prompt-display-panel', root);
      const manageTools = qs('#cgpt-prompt-manage-tools', root);

      if (managePanel) {
        managePanel.style.display = normalized === 'manage' ? '' : 'none';
      }

      if (displayPanel) {
        displayPanel.style.display = normalized === 'display' ? '' : 'none';
      }

      if (manageTools) {
        manageTools.style.display = normalized === 'manage' ? '' : 'none';
      }
    }

    function render() {
      if (!listEl) return;

      flushPromptDetailBeforeSwitch();

      syncActiveCategoryFromSharedState();
      activePromptSubtab = normalizePromptSubtab(activePromptSubtab);
      renderPromptSubtabs();

      if (activePromptSubtab === 'display') {
        renderPromptDisplayPanel();
        clearPromptStatus();

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
          ToolboxShell.purgeForbiddenStatusBadge('prompt-render-display');
        }

        return;
      }

      renderCategoryBar();
      renderCategoryManager();

      const items = filteredPrompts();
      const selectedItem = resolveSelectedPromptForItems(items);
      listEl.innerHTML = '';

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'cgpt-hint cgpt-prompt-list-empty';
        empty.style.padding = '16px 8px';
        empty.style.textAlign = 'center';
        const hasFilter = searchKeyword.trim() || activeCategory !== '全部';
        if (hasFilter) {
          empty.textContent = '没有匹配 Prompt';
        } else {
          empty.innerHTML = '当前分类没有 Prompt<br>可以点击左上角「+ 新增 Prompt」创建';
        }
        listEl.appendChild(empty);
        renderPromptDetailPanel(null);
        clearPromptStatus();

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
          ToolboxShell.purgeForbiddenStatusBadge('prompt-render-empty');
        }

        return;
      }

      for (const item of items) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'cgpt-prompt-nav-item';
        row.dataset.id = item.id;
        row.dataset.promptNavItem = '1';
        if (selectedItem && String(selectedItem.id || '') === String(item.id || '')) {
          row.classList.add('active');
          row.tabIndex = 0;
        } else {
          row.tabIndex = -1;
        }

        const title = document.createElement('div');
        title.className = 'cgpt-prompt-nav-title';
        title.textContent = item.title || '未命名 Prompt';

        const meta = document.createElement('div');
        meta.className = 'cgpt-prompt-nav-meta';
        meta.textContent = `${item.category || '默认'}｜${String(item.content || '').length} 字`;

        row.appendChild(title);
        row.appendChild(meta);
        row.addEventListener('click', () => {
          selectPrompt(item.id, 'left-list-click');
          window.requestAnimationFrame(() => focusSelectedPromptRow(item.id));
        });
        listEl.appendChild(row);
      }

      clearPromptStatus();

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
        ToolboxShell.purgeForbiddenStatusBadge('prompt-render-end');
      }

      renderPromptDetailPanel(selectedItem);
      logPromptListCompactLayout('render');
    }

    function logPromptListCompactLayout(reason = '') {
      const list = root ? root.querySelector('#cgpt-prompt-list') : null;
      if (!list) {
        ToolboxShell.appendLog(`[PROMPT_UI][COMPACT_CHECK] reason=${reason} result=missing-list`);
        return;
      }

      const firstItem = list.querySelector('.cgpt-prompt-nav-item');

      if (!firstItem) {
        ToolboxShell.appendLog(`[PROMPT_UI][COMPACT_CHECK] reason=${reason} result=empty`);
        return;
      }

      const hasTitle = !!firstItem.querySelector('.cgpt-prompt-nav-title');
      const hasMeta = !!firstItem.querySelector('.cgpt-prompt-nav-meta');
      const detailPanel = root ? root.querySelector('#cgpt-prompt-detail-panel') : null;
      const hasDetail = !!detailPanel;
      const itemStyle = window.getComputedStyle(firstItem);

      ToolboxShell.appendLog(
        `[PROMPT_UI][COMPACT_CHECK] reason=${reason} itemPadding=${itemStyle.padding} itemMargin=${itemStyle.margin} title=${hasTitle ? 1 : 0} meta=${hasMeta ? 1 : 0} detail=${hasDetail ? 1 : 0}`,
      );
    }

    function createActionButton(text, type, extraClass = '') {
      const classes = ['compact'];
      const extra = String(extraClass || '').trim();
      if (extra) {
        classes.push(extra);
      }
      return createToolboxButton(text, {
        variant: type === 'primary' ? 'primary' : '',
        classes,
      });
    }

    let promptAutoSaveTimer = null;
    let promptDetailDirty = false;
    let promptDetailDerivedRefreshTimer = null;
    let promptDetailMetaRefreshTimer = null;
    const PROMPT_DETAIL_AUTOSAVE_DELAY_MS = 700;
    const PROMPT_DETAIL_DERIVED_REFRESH_DELAY_MS = 700;
    const PROMPT_DETAIL_META_REFRESH_DELAY_MS = 500;

    function readPromptDetailPanelDom() {
      const panel = root ? qs('#cgpt-prompt-detail-panel', root) : null;
      if (!panel) {
        return null;
      }

      const contentEl = qs('#cgpt-prompt-detail-content', panel);
      const titleEl = qs('#cgpt-prompt-detail-title-input', panel);
      const promptId = contentEl
        ? String(contentEl.dataset.promptId || '')
        : (titleEl ? String(titleEl.dataset.promptId || '') : '');

      if (!promptId) {
        return null;
      }

      return {
        promptId,
        title: titleEl ? String(titleEl.value || '') : '',
        content: contentEl ? String(contentEl.value || '') : '',
      };
    }

    function flushPromptDetailPanelToRecord() {
      const dom = readPromptDetailPanelDom();
      if (!dom) {
        return false;
      }

      const item = findPromptById(dom.promptId);
      if (!item) {
        return false;
      }

      let changed = false;
      const nextTitle = String(dom.title || '').trim();

      if (nextTitle && nextTitle !== String(item.title || '')) {
        item.title = nextTitle;
        item.updatedAt = nowMs();
        changed = true;
      }

      const nextContent = String(dom.content || '');
      if (nextContent !== String(item.content || '')) {
        item.content = nextContent;
        item.updatedAt = nowMs();
        changed = true;
      }

      return changed;
    }

    function flushPromptDetailBeforeSwitch() {
      if (!promptDetailDirty) {
        return;
      }

      const changed = flushPromptDetailPanelToRecord();
      promptDetailDirty = false;

      if (promptAutoSaveTimer) {
        clearTimeout(promptAutoSaveTimer);
        promptAutoSaveTimer = null;
      }

      if (changed) {
        savePromptListFromState('detail-switch-flush');
      }
    }

    function schedulePromptDetailDerivedRefresh(recId) {
      if (promptDetailDerivedRefreshTimer) {
        clearTimeout(promptDetailDerivedRefreshTimer);
      }

      promptDetailDerivedRefreshTimer = setTimeout(() => {
        promptDetailDerivedRefreshTimer = null;
        refreshPromptDetailDerivedUiDebounced(recId);
      }, PROMPT_DETAIL_DERIVED_REFRESH_DELAY_MS);
    }

    function refreshPromptDetailDerivedUiDebounced(recId) {
      const activeId = String(selectedPromptId || '');
      const expectedId = String(recId || '');

      if (expectedId && activeId && expectedId !== activeId) {
        console.log(
          '[PROMPT_TEMPLATE][DERIVED_REFRESH_SKIP] reason=active_changed expected_id=%s active_id=%s',
          expectedId,
          activeId,
        );
        return;
      }

      const item = findPromptById(expectedId || activeId);
      if (!item) {
        return;
      }

      try {
        const panel = root ? qs('#cgpt-prompt-detail-panel', root) : null;
        const meta = panel ? qs('#cgpt-prompt-detail-meta', panel) : null;

        if (meta) {
          meta.textContent = `分类：${item.category || '默认'}｜字数：${String(item.content || '').length}`;
        }

        if (listEl && item.id) {
          const safeId = escapeCssIdent(item.id);
          const row = listEl.querySelector(`[data-prompt-nav-item="1"][data-id="${safeId}"]`);

          if (row) {
            const rowTitle = row.querySelector('.cgpt-prompt-nav-title');
            const rowMeta = row.querySelector('.cgpt-prompt-nav-meta');

            if (rowTitle) {
              rowTitle.textContent = item.title || '未命名 Prompt';
            }

            if (rowMeta) {
              rowMeta.textContent = `${item.category || '默认'}｜${String(item.content || '').length} 字`;
            }
          }
        }

        setStatus('Prompt 已自动保存', 'success');
        console.log(
          '[PROMPT_TEMPLATE][DERIVED_REFRESH_DONE] id=%s name=%s',
          item.id,
          item.title,
        );
      } catch (err) {
        console.warn(
          '[PROMPT_TEMPLATE][DERIVED_REFRESH_FAIL] error_type=%s error=%s',
          (err && err.name) || 'Error',
          (err && err.message) || String(err),
          err,
        );
      }
    }

    function schedulePromptDetailMetaRefresh(recId) {
      if (promptDetailMetaRefreshTimer) {
        clearTimeout(promptDetailMetaRefreshTimer);
      }

      promptDetailMetaRefreshTimer = setTimeout(() => {
        promptDetailMetaRefreshTimer = null;
        refreshPromptDetailMetaUiDebounced(recId);
      }, PROMPT_DETAIL_META_REFRESH_DELAY_MS);
    }

    function refreshPromptDetailMetaUiDebounced(recId) {
      const activeId = String(selectedPromptId || '');
      const expectedId = String(recId || '');

      if (expectedId && activeId && expectedId !== activeId) {
        console.log(
          '[PROMPT_TEMPLATE][META_REFRESH_SKIP] reason=active_changed expected_id=%s active_id=%s',
          expectedId,
          activeId,
        );
        return;
      }

      const item = findPromptById(expectedId || activeId);
      if (!item) {
        return;
      }

      try {
        if (listEl && item.id) {
          const safeId = escapeCssIdent(item.id);
          const row = listEl.querySelector(`[data-prompt-nav-item="1"][data-id="${safeId}"]`);
          const rowTitle = row ? row.querySelector('.cgpt-prompt-nav-title') : null;

          if (rowTitle) {
            rowTitle.textContent = item.title || '未命名 Prompt';
          }
        }

        console.log(
          '[PROMPT_TEMPLATE][META_REFRESH_DONE] id=%s name=%s',
          item.id,
          item.title,
        );
      } catch (err) {
        console.warn(
          '[PROMPT_TEMPLATE][META_REFRESH_FAIL] error_type=%s error=%s',
          (err && err.name) || 'Error',
          (err && err.message) || String(err),
          err,
        );
      }
    }

    function onPromptDetailContentInput(item) {
      if (!item || !item.id) {
        return;
      }

      flushPromptDetailPanelToRecord();
      promptDetailDirty = true;
      schedulePromptAutoSave('detail-content-input', { delayMs: PROMPT_DETAIL_AUTOSAVE_DELAY_MS });
      schedulePromptDetailDerivedRefresh(item.id);

      console.log(
        '[PROMPT_TEMPLATE][EDITOR_CHANGED] id=%s name=%s content_len=%s',
        item.id,
        item.title,
        String(item.content || '').length,
      );
    }

    function onPromptDetailTitleInput(item) {
      if (!item || !item.id) {
        return;
      }

      flushPromptDetailPanelToRecord();
      promptDetailDirty = true;
      schedulePromptAutoSave('detail-title-input', { delayMs: PROMPT_DETAIL_AUTOSAVE_DELAY_MS });
      schedulePromptDetailMetaRefresh(item.id);

      console.log(
        '[PROMPT_TEMPLATE][META_EDITED] id=%s name=%s',
        item.id,
        item.title,
      );
    }

    function updatePromptEditorCharCount(textarea, reason = '') {
      if (!(textarea instanceof HTMLTextAreaElement)) {
        return 0;
      }

      const chars = String(textarea.value || '').length;
      const counter = textarea.parentElement
        ? textarea.parentElement.querySelector('[data-char-count-for]')
        : null;

      if (counter instanceof HTMLElement) {
        counter.textContent = `字数：${chars}`;
      }

      return chars;
    }

    function setPromptTextareaValueAndUpdateCount(textarea, value, reason) {
      if (!(textarea instanceof HTMLTextAreaElement)) {
        return;
      }

      textarea.value = String(value || '');
      const chars = updatePromptEditorCharCount(textarea, reason || 'program-set');

      textarea.dispatchEvent(new Event('input', {
        bubbles: true,
      }));

      ToolboxShell.appendLog(
        `[TEXTAREA][SET_VALUE] reason=${reason || '-'} chars=${chars}`,
      );
    }

    function savePromptListFromState(reason) {
      const ok = savePromptManagerData({ prompts, categories });

      if (ok) {
        ToolboxShell.appendLog(
          `[PROMPT][AUTO_SAVE] reason=${reason || '-'} count=${prompts.length}`,
        );
      }

      return ok;
    }

    function schedulePromptAutoSave(reason, options = {}) {
      const delayMs = Number.isFinite(Number(options.delayMs))
        ? Number(options.delayMs)
        : 500;

      if (promptAutoSaveTimer) {
        clearTimeout(promptAutoSaveTimer);
      }

      promptAutoSaveTimer = setTimeout(() => {
        promptAutoSaveTimer = null;
        savePromptListFromState(reason || 'auto-save');
      }, delayMs);
    }

    function focusMoveButtonById(itemId, actionName) {
      requestAnimationFrame(() => {
        const selector = `[data-prompt-id="${CSS.escape(String(itemId))}"][data-action="${CSS.escape(String(actionName))}"]`;
        const btn = document.querySelector(selector);

        if (btn instanceof HTMLElement) {
          btn.focus({
            preventScroll: true,
          });
        }
      });
    }

    function movePrompt(id, direction) {
      flushPromptDetailBeforeSwitch();

      const index = prompts.findIndex((item) => item.id === id);
      if (index < 0) return;

      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prompts.length) return;

      const temp = prompts[index];
      prompts[index] = prompts[nextIndex];
      prompts[nextIndex] = temp;

      savePromptListFromState(direction < 0 ? 'move-up' : 'move-down');
      render();
      notifyUploadQuickPromptsRefresh('prompt-move');
      setStatus('已调整排序');

      if (direction < 0) {
        ToolboxShell.appendLog(`[PROMPT][MOVE_UP] id=${temp.id} from=${index} to=${nextIndex}`);
        focusMoveButtonById(temp.id, 'move-up');
      } else {
        ToolboxShell.appendLog(`[PROMPT][MOVE_DOWN] id=${temp.id} from=${index} to=${nextIndex}`);
        focusMoveButtonById(temp.id, 'move-down');
      }
    }

    function getPromptEditorDraftKey() {
      const id = editingPromptId ? String(editingPromptId) : '__new__';
      return `${PROMPT_EDITOR_DRAFT_KEY}:${id}`;
    }

    function readPromptEditorDraft() {
      return MemoryManager.get(getPromptEditorDraftKey(), null);
    }

    function draftHasMeaningfulContent(draft) {
      if (!draft || typeof draft !== 'object') {
        return false;
      }

      return !!(
        String(draft.title || '').trim()
        || String(draft.content || '').trim()
      );
    }

    function captureEditorBaseline(id) {
      const item = prompts.find((prompt) => prompt.id === id) || null;

      if (item) {
        return {
          title: String(item.title || ''),
          category: String(item.category || '默认'),
          content: String(item.content || ''),
        };
      }

      return {
        title: '',
        category: getDefaultPromptEditorCategory(),
        content: '',
      };
    }

    function getEditorFieldValues() {
      const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
      const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
      const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);

      return {
        title: titleInput ? String(titleInput.value || '') : '',
        category: categoryInput ? String(categoryInput.value || '') : '',
        content: contentInput ? String(contentInput.value || '') : '',
      };
    }

    function editorValuesEqual(left, right) {
      const a = left || {};
      const b = right || {};

      return String(a.title || '') === String(b.title || '')
        && String(a.category || '') === String(b.category || '')
        && String(a.content || '') === String(b.content || '');
    }

    function hasUnsavedEditorChanges() {
      if (!modalOverlay || modalOverlay.style.display === 'none') {
        return false;
      }

      const baseline = editorOpenBaseline || captureEditorBaseline(editingPromptId);
      return !editorValuesEqual(getEditorFieldValues(), baseline);
    }

    function writePromptEditorDraft() {
      if (!modalOverlay) {
        return;
      }

      const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
      const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
      const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);

      const draft = {
        editingPromptId: editingPromptId || null,
        title: titleInput ? String(titleInput.value || '') : '',
        category: categoryInput ? String(categoryInput.value || '') : '',
        content: contentInput ? String(contentInput.value || '') : '',
        updatedAt: Date.now(),
      };

      const ok = MemoryManager.set(getPromptEditorDraftKey(), draft);

      if (!ok) {
        console.error('[PROMPT_DRAFT][SAVE_FAILED]', {
          error_type: 'StorageWriteFailed',
          error: 'MemoryManager.set returned false',
          stack: '',
          key: getPromptEditorDraftKey(),
        });
      }
    }

    function clearPromptEditorDraft() {
      const key = getPromptEditorDraftKey();
      MemoryManager.remove(key);
      console.log('[PROMPT_DRAFT][CLEAR]', { key });
    }

    const savePromptEditorDraftDebounced = debounceSave(() => {
      writePromptEditorDraft();
    }, 500);

    function bindPromptEditorDraftEvents() {
      if (promptEditorDraftEventsBound || !modalOverlay) {
        return;
      }

      promptEditorDraftEventsBound = true;

      const fieldSelectors = [
        '#cgpt-prompt-edit-title',
        '#cgpt-prompt-edit-category',
        '#cgpt-prompt-edit-content',
      ];

      fieldSelectors.forEach((selector) => {
        const field = qs(selector, modalOverlay);

        if (!field) {
          return;
        }

        bindOnce(field, 'input', (event) => {
          savePromptEditorDraftDebounced();

          if (field.id === 'cgpt-prompt-edit-content' && editingPromptId) {
            const item = prompts.find((prompt) => prompt.id === editingPromptId);

            if (item) {
              item.content = String(event.target.value || '');
              item.updatedAt = Date.now();
              schedulePromptAutoSave('content-input');
            } else {
              ToolboxShell.appendLog(`[PROMPT][EDIT_MISSING] id=${editingPromptId || '-'}`);
            }
          }

          if (field.id === 'cgpt-prompt-edit-title' && editingPromptId) {
            const item = prompts.find((prompt) => prompt.id === editingPromptId);

            if (item) {
              item.title = String(event.target.value || '');
              item.updatedAt = Date.now();
              schedulePromptAutoSave('title-input');
            }
          }

        });
      });

      const categoryField = qs('#cgpt-prompt-edit-category', modalOverlay);

      if (categoryField) {
        bindOnce(categoryField, 'change', () => {
          savePromptEditorDraftDebounced();

          if (editingPromptId) {
            const item = prompts.find((prompt) => prompt.id === editingPromptId);

            if (item) {
              item.category = String(categoryField.value || '') || '默认';
              item.updatedAt = Date.now();
              schedulePromptAutoSave('category-change');
            }
          }
        });
      }
    }

    function ensurePromptEditorCloseConfirmOverlay() {
      if (promptEditorCloseConfirmOverlay) {
        return promptEditorCloseConfirmOverlay;
      }

      promptEditorCloseConfirmOverlay = document.createElement('div');
      promptEditorCloseConfirmOverlay.id = 'cgpt-prompt-editor-close-confirm';
      promptEditorCloseConfirmOverlay.className = 'cgpt-modal-overlay';
      promptEditorCloseConfirmOverlay.style.zIndex = '2147483647';
      promptEditorCloseConfirmOverlay.innerHTML = `
        <div class="cgpt-modal" style="width:min(420px, calc(100vw - 36px));">
          <div class="cgpt-modal-header">
            <div>未保存的 Prompt 编辑</div>
          </div>
          <div class="cgpt-modal-body" style="padding:14px 16px;">
            当前 Prompt 有未保存内容，关闭前请选择操作。
          </div>
          <div class="cgpt-modal-actions" style="justify-content:flex-end; gap:8px; padding:12px 16px;">
            <button type="button" class="cgpt-btn primary" id="cgpt-prompt-close-confirm-save">保存</button>
            <button type="button" class="cgpt-btn danger" id="cgpt-prompt-close-confirm-discard">放弃</button>
            <button type="button" class="cgpt-btn" id="cgpt-prompt-close-confirm-continue">继续编辑</button>
          </div>
        </div>
      `;

      document.body.appendChild(promptEditorCloseConfirmOverlay);

      promptEditorCloseConfirmOverlay.addEventListener('mousedown', (event) => {
        if (event.target === promptEditorCloseConfirmOverlay) {
          event.stopPropagation();
        }
      });

      return promptEditorCloseConfirmOverlay;
    }

    function showPromptEditorCloseConfirm(onChoose) {
      const overlay = ensurePromptEditorCloseConfirmOverlay();
      const finish = (action) => {
        overlay.style.display = 'none';
        onChoose(action);
      };

      const saveBtn = qs('#cgpt-prompt-close-confirm-save', overlay);
      const discardBtn = qs('#cgpt-prompt-close-confirm-discard', overlay);
      const continueBtn = qs('#cgpt-prompt-close-confirm-continue', overlay);

      saveBtn.onclick = () => finish('save');
      discardBtn.onclick = () => finish('discard');
      continueBtn.onclick = () => finish('continue');

      overlay.style.display = 'flex';
    }

    function openEditor(id, options = {}) {
      editingPromptId = id;
      editorOpenBaseline = captureEditorBaseline(id);

      const forcedCategory = normalizePromptCategoryName(options.category || '');
      const defaultCategory = forcedCategory || getDefaultPromptEditorCategory();

      const item = prompts.find((prompt) => prompt.id === id) || null;
      const modalTitle = qs('#cgpt-prompt-editor-title', modalOverlay);
      const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
      const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
      const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);
      const deleteBtn = qs('#cgpt-prompt-delete-btn', modalOverlay);
      const duplicateBtn = qs('#cgpt-prompt-duplicate-btn', modalOverlay);

      if (item) {
        modalTitle.textContent = '编辑 Prompt';
        titleInput.value = item.title;

        const itemCategory = item.category || '默认';
        renderEditorCategoryOptions(itemCategory);
        categoryInput.value = itemCategory;

        setPromptTextareaValueAndUpdateCount(contentInput, item.content, 'open-editor');
        deleteBtn.style.display = '';
        duplicateBtn.style.display = '';
      } else {
        modalTitle.textContent = '新建 Prompt';
        titleInput.value = '';

        renderEditorCategoryOptions(defaultCategory);
        categoryInput.value = defaultCategory;

        contentInput.value = '';
        deleteBtn.style.display = 'none';
        duplicateBtn.style.display = 'none';
      }

      const draft = readPromptEditorDraft();

      if (draftHasMeaningfulContent(draft)) {
        titleInput.value = String(draft.title || '');

        const draftCategory = editingPromptId
          ? String(draft.category || '') || defaultCategory
          : defaultCategory;
        renderEditorCategoryOptions(draftCategory);
        categoryInput.value = draftCategory;

        contentInput.value = String(draft.content || '');
        console.log('[PROMPT_DRAFT][RESTORE]', {
          key: getPromptEditorDraftKey(),
          editingPromptId: editingPromptId || null,
          source: options.source || '-',
        });
        setStatus('已恢复未保存草稿');
      }

      modalOverlay.style.display = 'flex';

      const modal = modalOverlay.querySelector('.cgpt-modal');
      restorePromptEditorModalPosition(modal, 'open-editor-modal');

      window.setTimeout(() => {
        titleInput.focus();
      }, 50);
    }

    function closeEditorImmediate() {
      if (modalOverlay) {
        modalOverlay.style.display = 'none';
      }

      editorOpenBaseline = null;
      editingPromptId = null;
    }

    function closeEditor() {
      if (!modalOverlay || modalOverlay.style.display === 'none') {
        closeEditorImmediate();
        return;
      }

      if (!hasUnsavedEditorChanges()) {
        closeEditorImmediate();
        return;
      }

      writePromptEditorDraft();

      showPromptEditorCloseConfirm((action) => {
        if (action === 'continue') {
          return;
        }

        if (action === 'discard') {
          clearPromptEditorDraft();
          closeEditorImmediate();
          return;
        }

        if (action === 'save') {
          saveEditor();
        }
      });
    }

    function saveEditor() {
      const saveBtn = modalOverlay ? qs('#cgpt-prompt-save-btn', modalOverlay) : null;

      try {
        if (saveBtn && typeof setButtonRunning === 'function') {
          setButtonRunning(saveBtn, '保存中', { reason: 'prompt-save', disabled: true, allowCancel: false });
        }

        const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
        const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
        const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);

        const title = String(titleInput.value || '').trim();
        const rawCategory = categoryInput instanceof HTMLSelectElement
          ? categoryInput.value
          : categoryInput.value;
        const category = ensureCategoryExists(rawCategory || '默认');
        const content = String(contentInput.value || '');

        if (!title) {
          alert('标题不能为空');
          if (saveBtn && typeof setButtonIdle === 'function') {
            setButtonIdle(saveBtn, '保存', { reason: 'prompt-save-validation' });
          }
          return;
        }

        if (!content.trim()) {
          alert('Prompt 内容不能为空');
          if (saveBtn && typeof setButtonIdle === 'function') {
            setButtonIdle(saveBtn, '保存', { reason: 'prompt-save-validation' });
          }
          return;
        }

        const existing = prompts.find((item) => item.id === editingPromptId);

        if (editingPromptId && !existing) {
          const msg = `保存失败：原 Prompt 已不存在，editingPromptId=${editingPromptId}`;
          console.warn('[PROMPT][SAVE_MISSING_EDITING_ID]', msg);
          ToolboxShell.appendLog(`[PROMPT][SAVE_MISSING_EDITING_ID] ${msg}`);
          alert('保存失败：原 Prompt 已不存在，请刷新 Prompt 管理后重试');
          reloadFromStorage();
          if (saveBtn && typeof setButtonFailed === 'function') {
            setButtonFailed(saveBtn, '保存失败', { reason: 'prompt-save-missing' });
          }
          return;
        }

        if (existing) {
          existing.title = title;
          existing.category = category;
          existing.content = content;
          existing.updatedAt = nowMs();
        } else {
          ToolboxShell.appendLog(
            `[PROMPT][CREATE] title=${title} category=${category}`,
          );
          prompts.unshift({
            id: createId('prompt'),
            title,
            category,
            content,
            createdAt: nowMs(),
            updatedAt: nowMs(),
          });
        }

        const message = existing ? '已保存修改' : UiMessages.promptCreated;
        const ok = savePromptManagerData();

        if (!ok) {
          if (saveBtn && typeof setButtonFailed === 'function') {
            setButtonFailed(saveBtn, '保存失败', { reason: 'prompt-save-storage' });
          }
          setStatus('保存失败：浏览器存储写入失败', 'error');
          return;
        }

        clearPromptEditorDraft();
        commitPromptManagerChange(message, {
          closeEditor: true,
          skipPersist: true,
          reason: 'prompt-save',
        });
      } catch (err) {
        console.error('[PROMPT][SAVE_FAILED]', err);
        if (saveBtn && typeof setButtonFailed === 'function') {
          setButtonFailed(saveBtn, '保存失败', { reason: 'prompt-save-exception' });
        }
        setStatus('保存 Prompt 失败', 'error');
      }
    }

    function deleteCurrentPrompt() {
      if (!editingPromptId) return;

      const deleteBtn = modalOverlay ? qs('#cgpt-prompt-delete-btn', modalOverlay) : null;

      try {
        const item = prompts.find((prompt) => prompt.id === editingPromptId);
        if (!item) {
          setStatus('Prompt 不存在', 'warn');
          return;
        }

        const ok = window.confirm(`确定删除这个 Prompt 吗？\n\n${item.title}`);
        if (!ok) {
          return;
        }

        if (deleteBtn && typeof setButtonRunning === 'function') {
          setButtonRunning(deleteBtn, '删除中', {
            reason: 'prompt-delete',
            disabled: true,
            allowCancel: false,
          });
        }

        const deleted = deletePromptById(editingPromptId, { closeEditor: true, confirm: false });
        if (!deleted) {
          if (deleteBtn && typeof setButtonFailed === 'function') {
            setButtonFailed(deleteBtn, '删除失败', { reason: 'prompt-delete-failed' });
          }
          setStatus('删除 Prompt 失败', 'error');
        }
      } catch (err) {
        console.error('[PROMPT][DELETE_FAILED]', err);
        if (deleteBtn && typeof setButtonFailed === 'function') {
          setButtonFailed(deleteBtn, '删除失败', { reason: 'prompt-delete-exception' });
        }
        setStatus('删除 Prompt 失败', 'error');
      }
    }

    function duplicateCurrentPrompt() {
      const duplicateBtn = modalOverlay ? qs('#cgpt-prompt-duplicate-btn', modalOverlay) : null;

      try {
        const item = prompts.find((prompt) => prompt.id === editingPromptId);
        if (!item) {
          setStatus('Prompt 不存在', 'warn');
          return;
        }

        if (duplicateBtn && typeof setButtonRunning === 'function') {
          setButtonRunning(duplicateBtn, '复制中', {
            reason: 'prompt-duplicate',
            disabled: true,
            allowCancel: false,
          });
        }

        prompts.unshift({
          id: createId('prompt'),
          title: `${item.title} - 副本`,
          category: ensureCategoryExists(item.category),
          content: item.content,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        });

        commitPromptManagerChange(UiMessages.promptDuplicated, {
          closeEditor: true,
          reason: 'prompt-duplicate',
        });
      } catch (err) {
        console.error('[PROMPT][DUPLICATE_FAILED]', err);
        if (duplicateBtn && typeof setButtonFailed === 'function') {
          setButtonFailed(duplicateBtn, '复制失败', { reason: 'prompt-duplicate-exception' });
        }
        setStatus('复制 Prompt 失败', 'error');
      }
    }

    function exportPrompts() {
      flushPromptDetailBeforeSwitch();

      const data = {
        version: 4,
        exportedAt: new Date().toISOString(),
        prompts: prompts.slice(),
        categories: categories.slice(),
      };

      downloadJsonFile(`chatgpt-prompts-${buildDateStamp()}.json`, data);
      setStatus(UiMessages.promptExported);
    }

    function promptExactKey(item) {
      const category = getPromptCategoryName(item);
      const title = String(item.title || '').trim();
      const content = String(item.content || '');
      return `${category}\u0001${title}\u0001${content}`;
    }

    function promptTitleCategoryKey(item) {
      const category = getPromptCategoryName(item);
      const title = String(item.title || '').trim();
      return `${category}\u0001${title}`;
    }

    function dedupeImportFilePrompts(items) {
      const seen = new Set();
      const deduped = [];
      let removed = 0;

      for (const item of items) {
        const key = promptExactKey(item);
        if (seen.has(key)) {
          removed += 1;
          continue;
        }
        seen.add(key);
        deduped.push(item);
      }

      return { items: deduped, removed };
    }

    function isPromptTitleTaken(title, category, promptList) {
      const cat = normalizePromptCategoryName(category);
      const candidate = String(title || '').trim();
      return promptList.some(
        (p) => getPromptCategoryName(p) === cat && String(p.title || '').trim() === candidate,
      );
    }

    function findUniqueImportTitle(baseTitle, category, promptList) {
      const base = String(baseTitle || '').trim();
      const first = `${base}（导入）`;

      if (!isPromptTitleTaken(first, category, promptList)) {
        return first;
      }

      for (let n = 2; n < 10000; n += 1) {
        const candidate = `${base}（导入${n}）`;
        if (!isPromptTitleTaken(candidate, category, promptList)) {
          return candidate;
        }
      }

      return `${base}（导入${nowMs()}）`;
    }

    function createImportedPromptRecord(item, overrides = {}, options = {}) {
      const preserveId = options.preserveId === true;
      const sourceId = String(item && item.id ? item.id : '').trim();

      return {
        ...item,
        ...overrides,
        id: preserveId && sourceId ? sourceId : createId('prompt'),
        createdAt: Number(item && item.createdAt) || nowMs(),
        updatedAt: nowMs(),
      };
    }

    function prepareAppendImportItems(importItems, existingPrompts) {
      const workingList = existingPrompts.slice();
      const toPrepend = [];
      let skipped = 0;
      let conflicts = 0;

      for (const item of importItems) {
        if (workingList.some((p) => promptExactKey(p) === promptExactKey(item))) {
          skipped += 1;
          continue;
        }

        let title = String(item.title || '').trim();
        const category = getPromptCategoryName(item);
        const hasTitleCategoryConflict = workingList.some(
          (p) => promptTitleCategoryKey(p) === promptTitleCategoryKey(item),
        );

        if (hasTitleCategoryConflict) {
          conflicts += 1;
          title = findUniqueImportTitle(title, category, workingList);
        }

        const record = createImportedPromptRecord(item, { title, category });
        toPrepend.push(record);
        workingList.unshift(record);
      }

      return {
        toPrepend,
        added: toPrepend.length,
        skipped,
        conflicts,
      };
    }

    async function importPrompts(event) {
      flushPromptDetailBeforeSwitch();

      if (promptImporting) {
        ToolboxShell.appendLog('[PROMPT_IMPORT][SKIP] reason=already-importing');
        return;
      }

      const file = event && event.target && event.target.files
        ? event.target.files[0]
        : null;
      const fileName = file && file.name ? file.name : '-';

      promptImporting = true;

      try {
        ToolboxShell.appendLog(`[PROMPT_IMPORT][START] file=${fileName}`);

        const data = await readJsonFileFromInput(event, {
          tag: '[PROMPT_IMPORT]',
        });

        if (!data) return;

        const importedData = normalizePromptManagerData(data);
        const rawCount = importedData.prompts.length;

        ToolboxShell.appendLog(`[PROMPT_IMPORT][PARSED] count=${rawCount}`);

        if (!rawCount) {
          const msg = '文件中没有有效 Prompt';
          setStatus(`Prompt 导入失败：${msg}`);
          ToolboxShell.appendLog(`[PROMPT_IMPORT][FAILED] ${msg}`);
          return;
        }

        const { items: dedupedImport, removed: internalRemoved } = dedupeImportFilePrompts(
          importedData.prompts,
        );

        if (!dedupedImport.length) {
          const msg = '去重后没有可导入的 Prompt';
          setStatus(`Prompt 导入失败：${msg}`);
          ToolboxShell.appendLog(`[PROMPT_IMPORT][FAILED] ${msg}`);
          return;
        }

        const appendResult = prepareAppendImportItems(dedupedImport, prompts);
        prompts = [...appendResult.toPrepend, ...prompts];
        const { added, skipped, conflicts } = appendResult;

        importedData.categories.forEach((cat) => {
          if (!categories.some((x) => x.name === cat.name)) {
            categories.push({
              ...cat,
              id: createId('cat'),
              createdAt: nowMs(),
              updatedAt: nowMs(),
            });
          }
        });

        prompts.forEach((p) => {
          p.category = ensureCategoryExists(p.category);
        });

        categories.sort((a, b) => Number(a.order) - Number(b.order));
        savePromptManagerData();
        persistActivePromptCategory('全部');
        render();
        notifyUploadQuickPromptsRefresh('prompt-import');

        setStatus(`已导入 ${added} 条 Prompt`, 'success');

        ToolboxShell.appendLog(
          `[PROMPT_IMPORT][DEDUP] added=${added} skipped=${skipped} conflicts=${conflicts} internalRemoved=${internalRemoved}`,
        );
        ToolboxShell.appendLog(
          `[PROMPT_IMPORT][DONE] added=${added} skipped=${skipped} total=${dedupedImport.length}`,
        );
      } catch (e) {
        const errText = getErrorText(e);
        console.error('[PROMPT_IMPORT][FAILED]', {
          error_type: e && e.name,
          error: errText,
          stack: e && e.stack,
        });
        setStatus(`Prompt 导入失败：${errText}`);
        ToolboxShell.appendLog(`[PROMPT_IMPORT][FAILED] ${errText}`);
      } finally {
        promptImporting = false;
        if (event && event.target) {
          event.target.value = '';
        }
      }
    }

    function resetDefaultPrompts() {
      flushPromptDetailBeforeSwitch();

      const ok = confirm('确定重置为默认 Prompt 吗？当前所有自定义 Prompt 会被覆盖。');
      if (!ok) return;

      const defaults = normalizePromptManagerData(null);
      prompts = defaults.prompts;
      categories = defaults.categories;
      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh('prompt-reset');
      setStatus('已重置为默认 Prompt');
    }

    async function sendPrompt(content, autoSend) {
      if (autoSend && sendLock) {
        setStatus('正在发送中，请勿重复点击');
        return;
      }

      const text = String(content || '').trim();

      if (!text) {
        setStatus('Prompt 内容为空', 'warn');
        return;
      }

      const existingText = ComposerApi.getComposerText();

      const compactCfg = typeof getCompactUiConfig === 'function'
        ? getCompactUiConfig()
        : {};

      if (existingText && existingText !== text && compactCfg.confirmPromptDraftOverwrite === true) {
        const okReplace = window.confirm(
          `ChatGPT 输入框已有 ${existingText.length} 个字符，是否覆盖？`,
        );

        if (!okReplace) {
          setStatus('已取消：未覆盖输入框草稿', 'warn');
          ToolboxShell.appendLog(
            `[Prompt 管理] 已阻止覆盖草稿 existing=${existingText.length} new=${text.length}`,
          );
          return;
        }
      } else if (existingText && existingText !== text) {
        ToolboxShell.appendLog(
          `[Prompt 管理] 自动覆盖草稿 existing=${existingText.length} new=${text.length}`,
        );
      }

      if (!autoSend) {
        const okSet = ComposerApi.setComposerValue(text);

        if (!okSet) {
          console.error('[ChatGPT toolbox] Prompt fill failed: composer not found');
          ToolboxShell.appendLog('[Prompt 管理] 填入失败：未找到输入框');
          alert('没有找到 ChatGPT 输入框。请确认当前页面是 ChatGPT 对话页面');
          return;
        }

        setStatus('已填入输入框，未自动发送');
        return;
      }

      sendLock = true;
      setStatus('正在发送 Prompt…');

      try {
        const sendResult = await sendContentViaComposer({
          source: 'prompt-manager',
          content: text,
          allowReplaceDraft: true,
          waitUntilSendable: true,
          timeoutMs: 60000,
          blockWhenResponding: true,
        });

        if (!sendResult.ok) {
          setStatus(`Prompt 发送失败：${sendResult.reason || 'unknown'}`, 'warn');
          ToolboxShell.appendLog(`[Prompt 管理] 发送失败：${sendResult.reason || 'unknown'}`);
          return;
        }

        setStatus(`已发送 Prompt：${sendResult.reason}`, 'success');
        ToolboxShell.appendLog(`[Prompt 管理] 已发送 Prompt reason=${sendResult.reason}`);
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] Prompt send failed', err);
        setStatus(`Prompt 发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[Prompt 管理] 发送失败：${errText}`);
      } finally {
        sendLock = false;
      }
    }

    function repairPromptEditorCategoryField(editorRoot) {
      if (!editorRoot) return;

      let categoryField = qs('#cgpt-prompt-edit-category', editorRoot);

      if (categoryField instanceof HTMLInputElement) {
        const currentValue = categoryField.value || getDefaultPromptEditorCategory();
        const datalist = qs('#cgpt-prompt-category-options', editorRoot);
        if (datalist) {
          datalist.remove();
        }

        const select = document.createElement('select');
        select.className = 'cgpt-select cgpt-prompt-category-select';
        select.id = 'cgpt-prompt-edit-category';
        categoryField.replaceWith(select);
        categoryField = select;
        renderEditorCategoryOptions(currentValue);
      }

      if (categoryField instanceof HTMLSelectElement) {
        renderEditorCategoryOptions(categoryField.value || getDefaultPromptEditorCategory());
      }
    }

    function clampPromptEditorModalPosition(left, top, modal) {
      return promptEditorPosition.clampPosition(left, top, modal);
    }

    function applyPromptEditorModalPosition(modal, left, top, reason = '') {
      return promptEditorPosition.applyPosition(modal, left, top, reason);
    }

    function restorePromptEditorModalPosition(modal, reason = '') {
      return promptEditorPosition.restorePosition(modal, reason);
    }

    function bindPromptEditorModalDrag(modalOverlayEl) {
      const overlay = modalOverlayEl || modalOverlay;
      bindDraggablePanel({
        overlay,
        modalSelector: '.cgpt-modal',
        headerSelector: '.cgpt-modal-header',
        dragBoundDataset: 'promptEditorDragBound',
        position: promptEditorPosition,
        logPrefix: 'PROMPT_EDITOR_MODAL',
        consoleLabel: 'prompt editor',
        appendLog: (line) => {
          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(line);
          }
        },
      });
    }

    function bindPromptEditorModalResize() {
      if (promptEditorResizeBound) {
        return;
      }

      promptEditorResizeBound = true;

      window.addEventListener('resize', () => {
        if (!modalOverlay) {
          return;
        }

        const modal = modalOverlay.querySelector('.cgpt-modal');

        if (!modal || modalOverlay.style.display === 'none' || modalOverlay.hidden) {
          return;
        }

        const rect = modal.getBoundingClientRect();
        const pos = clampPromptEditorModalPosition(rect.left, rect.top, modal);
        applyPromptEditorModalPosition(modal, pos.left, pos.top, 'window-resize');
      }, { passive: true });
    }

    function createEditorModal() {
      if (document.getElementById('cgpt-prompt-editor-overlay')) {
        modalOverlay = document.getElementById('cgpt-prompt-editor-overlay');
        repairPromptEditorCategoryField(modalOverlay);
        bindPromptEditorModalDrag(modalOverlay);
        bindPromptEditorDraftEvents();
        restorePromptEditorModalPosition(
          modalOverlay.querySelector('.cgpt-modal'),
          'create-editor-modal-existing',
        );
        return;
      }

      modalOverlay = document.createElement('div');
      modalOverlay.id = 'cgpt-prompt-editor-overlay';
      modalOverlay.className = 'cgpt-modal-overlay';
      modalOverlay.innerHTML = `
        <div class="cgpt-modal">
          <div class="cgpt-modal-header">
            <div id="cgpt-prompt-editor-title">编辑 Prompt</div>
            <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-prompt-editor-close">关闭</button>
          </div>

          <div class="cgpt-modal-body">
            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-title">标题 / 按钮名称</label>
              <input class="cgpt-input" id="cgpt-prompt-edit-title" placeholder="例如：找 bug">
            </div>

            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-category">分类</label>
              <select class="cgpt-select cgpt-prompt-category-select" id="cgpt-prompt-edit-category"></select>
            </div>

            <div class="cgpt-modal-field">
              <label for="cgpt-prompt-edit-content">Prompt 内容</label>
              <textarea class="cgpt-textarea" id="cgpt-prompt-edit-content" style="min-height:300px;" placeholder="请输入完Prompt..."></textarea>
            </div>
          </div>

          <div class="cgpt-modal-actions">
            <div class="cgpt-modal-actions-left">
              <button type="button" class="cgpt-btn danger" id="cgpt-prompt-delete-btn">删除</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-duplicate-btn">复制一份</button>
            </div>
            <div class="cgpt-modal-actions-right">
              <button type="button" class="cgpt-btn" id="cgpt-prompt-cancel-btn">取消</button>
              <button type="button" class="cgpt-btn primary" id="cgpt-prompt-save-btn">保存</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(modalOverlay);
      renderEditorCategoryOptions(getDefaultPromptEditorCategory());

      const modal = modalOverlay.querySelector('.cgpt-modal');
      restorePromptEditorModalPosition(modal, 'create-editor-modal');
      bindPromptEditorModalDrag(modalOverlay);

      qs('#cgpt-prompt-editor-close', modalOverlay).addEventListener('click', closeEditor);
      qs('#cgpt-prompt-cancel-btn', modalOverlay).addEventListener('click', closeEditor);
      qs('#cgpt-prompt-save-btn', modalOverlay).addEventListener('click', saveEditor);
      qs('#cgpt-prompt-delete-btn', modalOverlay).addEventListener('click', deleteCurrentPrompt);
      qs('#cgpt-prompt-duplicate-btn', modalOverlay).addEventListener('click', duplicateCurrentPrompt);
      bindPromptEditorDraftEvents();

      modalOverlay.addEventListener('mousedown', (event) => {
        if (event.target === modalOverlay) {
          closeEditor();
        }
      });
    }

    function bindEvents() {
      if (!root) return;
      if (root.dataset.promptManagerEventsBound === '1') {
        ToolboxShell.appendLog('[PROMPT_MANAGER][BIND_EVENTS_SKIP_DUPLICATE]');
        return;
      }
      root.dataset.promptManagerEventsBound = '1';
      ToolboxShell.appendLog('[PROMPT_MANAGER][BIND_EVENTS_ONCE]');

      if (listEl) {
        listEl.tabIndex = 0;
        listEl.title = '支持 ↑/↓ 快速切换 Prompt，Home/End 跳转首尾';
        DomUtil.bindOnce(listEl, 'keydown', handlePromptListKeydown, 'bound_prompt_list_keydown');
      }

      bindClick(root, '#cgpt-prompt-new-quick-btn', () => {
        const category = getDefaultPromptEditorCategory();
        ToolboxShell.appendLog(
          `[PROMPT][NEW][CATEGORY] activeCategory=${activeCategory || '-'} defaultCategory=${category || '-'}`,
        );
        openEditor(null, {
          category,
          source: 'new-quick-from-active-category',
        });
      }, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-new-quick-btn',
      });
      bindClick(root, '#cgpt-prompt-export-btn', exportPrompts, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-export-btn',
      });
      bindClick(root, '#cgpt-prompt-import-btn', () => {
        if (importFileEl) importFileEl.click();
      }, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-import-btn',
      });
      bindClick(root, '#cgpt-prompt-reset-btn', resetDefaultPrompts, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-reset-btn',
      });

      if (importFileEl) {
        bindOnce(importFileEl, 'change', importPrompts);
      }

      if (searchEl) {
        bindOnce(searchEl, 'input', (event) => {
          searchKeyword = String(event.target.value || '').trim().toLowerCase();
          render();
        });
      }

      const categoryBar = qs('#cgpt-prompt-category-bar', root);
      if (categoryBar) {
        DomUtil.bindOnce(categoryBar, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-prompt-category]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          const nextCategory = btn.getAttribute('data-prompt-category') || '全部';

          if (String(nextCategory).startsWith('更多 ')) {
            toggleCategoryPickerModal(true);
            return;
          }

          activeCategory = nextCategory;

          persistActivePromptCategory(activeCategory);

          render();
          setStatus(`已切换分类：${activeCategory}`);

          const counts = getPromptCategoryCounts(prompts, categories);
          const normalized = normalizePromptCategoryName(activeCategory);
          const count = normalized === '全部'
            ? Number(counts.__all__ || 0)
            : Number(counts[normalized] || 0);
          ToolboxShell.appendLog(
            '[PROMPT_UI][CATEGORY_SELECT] category=' + normalized + ' count=' + String(count) + ' source=horizontal-tabs',
          );
        }, 'bound_prompt_category_bar_click');
      }

      bindClick(root, '#cgpt-prompt-category-manage-btn', () => {
        toggleCategoryManagerModal(true, 'manage-button');
      }, {
        moduleName: 'PromptManagerModule',
        bindMissingLog: '[PROMPT][bind-missing] #cgpt-prompt-category-manage-btn',
      });

      if (categoryPickerOverlay) {
        const closeBtn = qs('#cgpt-prompt-category-picker-close', categoryPickerOverlay);
        if (closeBtn) {
          bindOnce(closeBtn, 'click', () => toggleCategoryPickerModal(false));
        }
        const pickerBody = qs('#cgpt-prompt-category-picker-list', categoryPickerOverlay);
        if (pickerBody) {
          DomUtil.bindOnce(pickerBody, 'click', (e) => {
            const btn = e.target instanceof HTMLElement
              ? e.target.closest('[data-prompt-category-pick]')
              : null;
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            const picked = btn.getAttribute('data-prompt-category-pick') || '全部';
            activeCategory = picked;
            persistActivePromptCategory(activeCategory);
            toggleCategoryPickerModal(false);
            render();
            setStatus(`已切换分类：${activeCategory}`);
          }, 'bound_prompt_category_picker_click');
        }
        categoryPickerOverlay.addEventListener('mousedown', (event) => {
          if (event.target === categoryPickerOverlay) {
            toggleCategoryPickerModal(false);
          }
        });
      }

      const categoryAddBtn = qs('#cgpt-prompt-category-add', categoryManagerOverlay || root);

      if (categoryAddBtn) {
        bindOnce(categoryAddBtn, 'click', () => {
          addPromptCategory();
        });
      }

      const categoryNameInput = qs('#cgpt-prompt-category-name', categoryManagerOverlay || root);

      if (categoryNameInput) {
        bindOnce(categoryNameInput, 'keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          addPromptCategory();
        });
      }

      const categoryManageList = qs('#cgpt-prompt-category-manage-list', categoryManagerOverlay || root);

      if (categoryManageList) {
        DomUtil.bindOnce(categoryManageList, 'click', (e) => {
          const target = e.target instanceof HTMLElement ? e.target : null;

          if (!target) return;

          const renameBtn = target.closest('[data-category-rename]');

          if (renameBtn) {
            e.preventDefault();
            e.stopPropagation();
            renamePromptCategory(renameBtn.getAttribute('data-category-rename'));
            return;
          }

          const deleteBtn = target.closest('[data-category-delete]');

          if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            deletePromptCategory(deleteBtn.getAttribute('data-category-delete'));
          }
        }, 'bound_prompt_category_manage_list_click');
      }

      const subtabBar = qs('#cgpt-prompt-subtabs', root);
      if (subtabBar) {
        DomUtil.bindOnce(subtabBar, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-prompt-subtab]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activePromptSubtab = normalizePromptSubtab(btn.getAttribute('data-prompt-subtab'));

          MemoryManager.set(
            MemoryManager.KEYS.promptManagerActiveSubtab,
            activePromptSubtab,
          );
          writeDataStorage("promptManagerActiveSubtab", activePromptSubtab);

          render();
        }, 'bound_prompt_subtab_bar_click');
      }

      [
        ['#cgpt-prompt-display-select-all', 'all'],
        ['#cgpt-prompt-display-clear-all', 'none'],
        ['#cgpt-prompt-display-invert', 'invert'],
      ].forEach(([selector, mode]) => {
        const btn = qs(selector, root);
        if (!btn) return;

        bindOnce(btn, 'click', () => {
          applyPromptDisplaySelection(mode);
        });
      });

      [
        '#cgpt-prompt-display-upload-visible',
        '#cgpt-prompt-display-compact-visible',
        '#cgpt-prompt-display-click-action',
        '#cgpt-prompt-display-confirm-overwrite',
      ].forEach((selector) => {
        const el = qs(selector, root);
        if (!el) return;

        bindOnce(el, 'change', () => {
          const cfg = readPromptDisplayConfigFromUi();
          savePromptDisplayConfig(cfg, 'display-option-change');
          renderPromptDisplayPanel();
        });
      });

      const promptDisplayList = qs('#cgpt-prompt-display-list', root);
      if (promptDisplayList) {
        DomUtil.bindOnce(promptDisplayList, 'change', (e) => {
          const target = e.target;
          if (!(target instanceof HTMLInputElement)) return;
          if (!target.matches('[data-prompt-display-id]')) return;

          const cfg = readPromptDisplayConfigFromUi();
          savePromptDisplayConfig(cfg, 'display-prompt-check-change');
          renderPromptDisplayPanel();
        }, 'bound_prompt_display_list_change');
      }
    }

    const PROMPT_MODULE_HTML = `
        <div class="cgpt-section cgpt-prompt-page">
          <style>
            .cgpt-prompt-body {
              display: grid;
              grid-template-columns: 260px minmax(0, 1fr);
              gap: 12px;
              min-height: 0;
              flex: 1 1 auto;
            }
            .cgpt-prompt-list-panel,
            .cgpt-prompt-detail-panel {
              border: 1px solid rgba(148, 163, 184, 0.28);
              border-radius: 10px;
              background: rgba(15, 23, 42, 0.72);
              padding: 10px;
              min-height: 0;
            }
            .cgpt-prompt-list-panel {
              display: flex;
              flex-direction: column;
              gap: 10px;
              overflow: hidden;
            }
            .cgpt-prompt-detail-panel {
              display: flex;
              flex-direction: column;
              gap: 10px;
              overflow: hidden;
            }
            .cgpt-prompt-list {
              display: flex;
              flex-direction: column;
              gap: 0 !important;
              flex: 1 1 auto;
              min-height: 0;
              overflow: auto;
              border: 1px solid #2f3542;
              border-radius: 12px;
              background: #0f1115;
            }
            .cgpt-prompt-nav-item {
              width: 100%;
              border: 0;
              border-bottom: 1px solid rgba(55, 65, 81, 0.7);
              background: transparent;
              color: #e5e7eb;
              padding: 8px 10px;
              text-align: left;
              cursor: pointer;
            }
            .cgpt-prompt-nav-item:hover {
              background: rgba(37, 99, 235, 0.14);
            }
            .cgpt-prompt-nav-item.active {
              background: rgba(37, 99, 235, 0.34);
              box-shadow: inset 3px 0 0 #3b82f6;
            }
            .cgpt-prompt-nav-title {
              font-size: 13px;
              font-weight: 700;
              line-height: 1.3;
              color: #f8fafc;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .cgpt-prompt-nav-meta {
              margin-top: 3px;
              font-size: 12px;
              line-height: 1.25;
              color: #94a3b8;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .cgpt-prompt-detail-autosave-hint {
              font-size: 12px;
              color: #64748b;
              line-height: 1.35;
            }
            .cgpt-prompt-detail-title {
              width: 100%;
              box-sizing: border-box;
              font-size: 16px;
              font-weight: 800;
              color: #f8fafc;
              line-height: 1.35;
            }
            .cgpt-prompt-detail-meta {
              font-size: 12px;
              color: #94a3b8;
              line-height: 1.35;
            }
            .cgpt-prompt-detail-content {
              flex: 1 1 auto;
              min-height: 260px;
              resize: none;
              overflow: auto;
              line-height: 1.5;
              font-size: 13px;
              white-space: pre-wrap;
            }
            .cgpt-prompt-detail-actions {
              display: flex;
              align-items: center;
              flex-wrap: wrap;
              gap: 8px;
              flex: 0 0 auto;
            }
            .cgpt-prompt-detail-empty {
              padding: 18px;
              border: 1px dashed rgba(148, 163, 184, 0.35);
              border-radius: 10px;
              color: #94a3b8;
            }
            @media (max-width: 760px) {
              .cgpt-prompt-body {
                grid-template-columns: 1fr;
              }
              .cgpt-prompt-detail-content {
                min-height: 180px;
              }
            }
          </style>
          <div id="cgpt-prompt-subtabs" class="cgpt-prompt-subtabs">
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="manage">Prompt 列表</button>
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="display">展示预览</button>
          </div>

          <div id="cgpt-prompt-manage-panel" class="cgpt-prompt-panel">
            <div id="cgpt-prompt-manage-tools" class="cgpt-prompt-toolbar">
              <button type="button" class="cgpt-btn primary" id="cgpt-prompt-new-quick-btn">+ 新增 Prompt</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-export-btn">导出</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-import-btn">导入</button>
              <button type="button" class="cgpt-btn danger" id="cgpt-prompt-reset-btn">重置</button>
            </div>

            <div class="cgpt-prompt-body">
              <main class="cgpt-prompt-list-panel">
                <div class="cgpt-prompt-filter-row cgpt-prompt-category-row" style="display:flex; align-items:flex-start; gap:10px; position:relative;">
                  <div id="cgpt-prompt-category-bar" class="cgpt-prompt-category-bar" style="flex:1 1 auto; min-width:0;"></div>
                  <button type="button" class="cgpt-btn compact" id="cgpt-prompt-category-manage-btn" style="flex:0 0 auto;">管理分类</button>

                  <div id="cgpt-prompt-category-popover"
                    style="display:none; position:absolute; top:calc(100% + 8px); right:0; width:380px; max-width:min(92vw, 420px); z-index:9999; padding:10px; border-radius:12px; border:1px solid #2f3542; background:#0f131a; box-shadow: 0 18px 60px rgba(0,0,0,.55);">
                    <div class="cgpt-panel-title" style="margin:0 0 8px 0;">分类管理</div>
                    <div class="cgpt-category-create-row cgpt-prompt-category-edit-row" style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
                      <input class="cgpt-input" id="cgpt-prompt-category-name" placeholder="输入分类名称" style="flex:1 1 auto; min-width:0;">
                      <button type="button" class="cgpt-btn primary" id="cgpt-prompt-category-add" style="flex:0 0 auto;">新建</button>
                    </div>
                    <div id="cgpt-prompt-category-manage-list" class="cgpt-category-list cgpt-prompt-category-manage-list"></div>
                  </div>
                </div>
                <input id="cgpt-prompt-search" class="cgpt-prompt-search cgpt-input" placeholder="搜索标题、分类或内容...">
                <div id="cgpt-prompt-list" class="cgpt-prompt-list"></div>
              </main>
              <aside id="cgpt-prompt-detail-panel" class="cgpt-prompt-detail-panel"></aside>
            </div>

            <div id="cgpt-prompt-status" class="cgpt-hint" style="margin-top:8px; display:none;"></div>
          </div>

          <div id="cgpt-prompt-display-panel" class="cgpt-prompt-panel" style="display:none;">
            <div class="cgpt-section" style="padding:10px; border:1px solid #2f3542; border-radius:10px;">
              <div class="cgpt-section-title">Prompt 展示设置</div>

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-prompt-display-upload-visible">
                多文件上传页显示常用 Prompt 区
              </label>

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-prompt-display-compact-visible">
                精简模式显示常用 Prompt 区
              </label>

              <div class="cgpt-kv">
                <label>常用 Prompt 默认点击动作</label>
                <select class="cgpt-select" id="cgpt-prompt-display-click-action" disabled title="多文件上传页常用 Prompt 固定为填入并发送">
                  <option value="send" selected>填入并发送</option>
                </select>
              </div>
              <div class="cgpt-hint">多文件上传页的常用 Prompt 点击后固定为填入并发送，不受此项影响。</div>

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-prompt-display-confirm-overwrite">
                覆盖输入框草稿前弹窗确认
              </label>

              <div class="cgpt-section-title" style="margin-top:10px;">主页显示的 Prompt</div>
              <div class="cgpt-hint">勾选后，这些 Prompt 会显示在多文件上传页/主页的“常用 Prompt”区域。</div>

              <div class="cgpt-setting-prompt-toolbar">
                <button type="button" class="cgpt-btn compact" id="cgpt-prompt-display-select-all">全选</button>
                <button type="button" class="cgpt-btn compact" id="cgpt-prompt-display-clear-all">全不选</button>
                <button type="button" class="cgpt-btn compact" id="cgpt-prompt-display-invert">反选</button>
                <span class="cgpt-hint" id="cgpt-prompt-display-count">已选 0 / 0</span>
              </div>

              <div id="cgpt-prompt-display-list" class="cgpt-settings-prompt-list"></div>
            </div>
          </div>

          <input id="cgpt-prompt-import-file" type="file" accept="application/json,.json" style="display:none;">
        </div>
      `;

    function mount(targetHost) {
      mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-prompt-module',
        moduleName: 'PROMPT',
        html: PROMPT_MODULE_HTML,
        onRefs: (mountedRoot) => {
          root = mountedRoot;
          listEl = qs('#cgpt-prompt-list', root);
          searchEl = qs('#cgpt-prompt-search', root);
          statusEl = qs('#cgpt-prompt-status', root);
          importFileEl = qs('#cgpt-prompt-import-file', root);
          categoryManagerOverlay = qs('#cgpt-prompt-category-popover', root);
        },
        onBind: () => {
          createEditorModal();
          bindPromptEditorModalResize();
          bindEvents();
        },
        onRender: () => {
          if (typeof PromptCategoryState !== 'undefined'
            && typeof PromptCategoryState.hydrateFromStorage === 'function') {
            activeCategory = PromptCategoryState.hydrateFromStorage();
          } else {
            var restoredCat = readDataStorage("promptManagerActiveCategory", null);
            if (restoredCat != null) {
              activeCategory = persistActivePromptCategory(restoredCat);
            } else {
              activeCategory = persistActivePromptCategory(
                MemoryManager.get(
                  MemoryManager.KEYS.promptManagerActiveCategory,
                  activeCategory,
                ),
              );
            }
          }
          var restoredSubtab = readDataStorage("promptManagerActiveSubtab", null);
          if (restoredSubtab != null) {
            activePromptSubtab = normalizePromptSubtab(restoredSubtab);
          } else {
            activePromptSubtab = normalizePromptSubtab(
              MemoryManager.get(
                MemoryManager.KEYS.promptManagerActiveSubtab,
                'manage',
              ),
            );
          }
          render();
        },
      });
    }

    function getPromptById(promptId) {
      return prompts.find((item) => String(item.id) === String(promptId)) || null;
    }

    return {
      mount,
      getPrompts: () => prompts.slice(),
      getPromptById,
      reloadFromStorage,
      getPromptCategoryName,
      getPromptCategoriesFromList,
      exportData: () => ({
        version: 4,
        exportedAt: new Date().toISOString(),
        prompts: prompts.slice(),
        categories: categories.slice(),
      }),
    };
  })();
