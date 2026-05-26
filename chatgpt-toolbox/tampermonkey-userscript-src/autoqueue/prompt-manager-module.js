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
    let activeCategory = MemoryManager.get(
      MemoryManager.KEYS.promptManagerActiveCategory,
      '全部',
    );
    let activePromptSubtab = normalizePromptSubtab(
      MemoryManager.get(
        MemoryManager.KEYS.promptManagerActiveSubtab,
        'manage',
      ),
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

      const title = String(item.title || '').trim();
      const content = String(item.content || '');

      if (!title || !content.trim()) return null;

      return {
        id: String(item.id || createId('prompt')),
        title,
        category: normalizePromptCategoryName(item.category),
        content,
        createdAt: Number(item.createdAt || nowMs()),
        updatedAt: Number(item.updatedAt || nowMs()),
      };
    }

    function buildNormalizedDefaultPrompts() {
      return createDefaultPrompts().map((item) => normalizePromptItem({
        id: createId('prompt'),
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

      if (!nextPrompts.length) {
        nextPrompts = buildNormalizedDefaultPrompts();
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

    function applyPromptManagerData(data) {
      const normalized = normalizePromptManagerData(data);
      prompts = normalized.prompts;
      categories = normalized.categories;
    }

    function loadPromptManagerData() {
      const raw = MemoryManager.get(STORAGE_KEY, null);

      if (!raw) {
        const defaults = normalizePromptManagerData(null);
        savePromptManagerData(defaults);
        return defaults;
      }

      const normalized = normalizePromptManagerData(raw);

      if (Array.isArray(raw) || (raw && typeof raw === 'object' && !Array.isArray(raw.categories))) {
        savePromptManagerData(normalized);
      }

      return normalized;
    }

    function savePromptManagerData(data) {
      const payload = data || { prompts, categories };

      const ok = MemoryManager.set(STORAGE_KEY, {
        prompts: payload.prompts || prompts,
        categories: payload.categories || categories,
      });

      if (!ok) {
        console.error('[ChatGPT toolbox] savePromptManagerData failed');
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog('[Prompt 管理] 保存失败：浏览器存储写入失败');
        }
      } else {
        let preserveAutoQueue = 0;
        if (typeof AutoQueueModule !== 'undefined' && typeof AutoQueueModule.getConfig === 'function') {
          const autoCfg = AutoQueueModule.getConfig();
          const tasks = autoCfg && Array.isArray(autoCfg.autoQueueTasks) ? autoCfg.autoQueueTasks : [];
          preserveAutoQueue = tasks.length;
        }
        ToolboxShell.appendLog(
          `[PROMPT][SAVE] count=${(payload.prompts || prompts).length} preserveAutoQueue=${preserveAutoQueue}`,
        );
      }

      return ok;
    }

    function getPromptCategoryCount(categoryName) {
      const normalized = normalizePromptCategoryName(categoryName);
      return prompts.filter((item) => getPromptCategoryName(item) === normalized).length;
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

    function normalizeActiveCategory() {
      const filterNames = getPromptCategoriesForFilter().map((cat) => cat.name);

      if (!filterNames.includes(activeCategory)) {
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
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

    function renderCategoryDatalist() {
      const list = document.getElementById('cgpt-prompt-category-options');

      if (!list) return;

      list.innerHTML = categories.map((cat) => `
        <option value="${escapeHtml(cat.name)}"></option>
      `).join('');
    }

    function renderCategoryManager() {
      const listEl = qs('#cgpt-prompt-category-manage-list', root);

      if (!listEl) return;

      if (!categories.length) {
        listEl.innerHTML = renderEmptyState('暂无类别', 'cgpt-log-empty cgpt-empty-state');
        return;
      }

      listEl.innerHTML = categories.map((cat) => {
        const count = getPromptCategoryCount(cat.name);
        const locked = cat.name === '默认';

        return `
      <div class="cgpt-prompt-category-manage-item" data-category-id="${escapeHtml(cat.id)}">
        <div class="cgpt-prompt-category-manage-main">
          <div class="cgpt-prompt-category-manage-name">${escapeHtml(cat.name)}</div>
          <div class="cgpt-prompt-category-manage-meta">${count} Prompt</div>
        </div>

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
    `;
      }).join('');
    }

    function addPromptCategory() {
      const input = qs('#cgpt-prompt-category-name', root);
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
        activeCategory = nextName;
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
      }

      savePromptManagerData();
      render();
      notifyUploadQuickPromptsRefresh('prompt-save');

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

      const count = getPromptCategoryCount(cat.name);

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
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
      }

      if (!savePromptManagerData()) {
        setStatus('保存失败：浏览器存储写入失败', 'error');
        return;
      }

      render();
      notifyUploadQuickPromptsRefresh('prompt-save');

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

    function renderCategoryBar() {
      if (!root) return;

      const bar = qs('#cgpt-prompt-category-bar', root);
      if (!bar) return;

      const filterCategories = getPromptCategoriesForFilter();
      const current = normalizeActiveCategory();

      bar.innerHTML = renderPromptCategoryChips(
        filterCategories.map((cat) => cat.name),
        current,
        (name) => getPromptCategoryCount(name),
        'data-prompt-category',
      );
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

    function savePromptDisplayConfig(nextConfig, reason = '') {
      const current = getPromptDisplayConfig();
      const next = Object.assign({}, current, nextConfig || {});

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

        quickPromptClickAction: actionEl && actionEl.value === 'fill'
          ? 'fill'
          : 'send',

        confirmPromptDraftOverwrite: confirmEl
          ? !!confirmEl.checked
          : current.confirmPromptDraftOverwrite === true,

        quickPromptIds: selectedIds,
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
      } else if (mode === 'none') {
        cfg.quickPromptIds = [];
      } else if (mode === 'invert') {
        cfg.quickPromptIds = allIds.filter((id) => !currentSelected.has(id));
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
      renderCategoryDatalist();

      const items = filteredPrompts();
      listEl.innerHTML = '';

      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'cgpt-hint';
        empty.style.padding = '16px 8px';
        empty.style.textAlign = 'center';
        empty.textContent = '没有匹配Prompt';
        listEl.appendChild(empty);
        clearPromptStatus();

        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
          ToolboxShell.purgeForbiddenStatusBadge('prompt-render-empty');
        }

        return;
      }

      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'cgpt-prompt-item';
        row.dataset.id = item.id;

        const title = document.createElement('div');
        title.className = 'cgpt-prompt-title';
        title.textContent = item.title;

        const meta = document.createElement('div');
        meta.className = 'cgpt-prompt-meta';
        meta.textContent = `分类：${item.category || '默认'}｜字数：${String(item.content || '').length}`;

        const preview = document.createElement('div');
        preview.className = 'cgpt-prompt-preview';
        preview.textContent = item.content.replace(/\s+/g, ' ').slice(0, 140);

        row.appendChild(title);
        row.appendChild(meta);
        row.appendChild(preview);

        const actions = document.createElement('div');
        actions.className = 'cgpt-prompt-actions cgpt-prompt-actions-compact';

        const batchLabel = document.createElement('label');
        batchLabel.className = 'cgpt-prompt-batch-check';
        batchLabel.title = '加入批量任务';
        const batchCheck = document.createElement('input');
        batchCheck.type = 'checkbox';
        batchCheck.checked = (
          typeof AutoQueueModule !== 'undefined'
          && typeof AutoQueueModule.isPromptBatchTaskSelected === 'function'
          && AutoQueueModule.isPromptBatchTaskSelected(item.id)
        );
        batchCheck.addEventListener('click', (e) => {
          e.stopPropagation();
        });
        batchCheck.addEventListener('change', (e) => {
          e.stopPropagation();
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
          render();
        });
        const batchText = document.createElement('span');
        batchText.textContent = '加入批量任务';
        batchLabel.appendChild(batchCheck);
        batchLabel.appendChild(batchText);
        actions.appendChild(batchLabel);

        const fillBtn = createActionButton('填入');
        fillBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          sendPrompt(item.content, false);
        });

        const sendBtn = createActionButton('发送', 'primary');
        sendBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          void sendPrompt(item.content, true);
        });

        const copyBtn = createActionButton('复制');
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await copyTextUnified(item.content, 'prompt-manager:copy-item');
          if (ok) {
            setStatus(`已复制：${item.title}`);
          } else {
            setStatus('复制失败，请手动复制', 'error');
          }
        });

        const editBtn = createActionButton('编辑');
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditor(item.id);
        });

        const deleteBtn = createActionButton('删除');
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deletePromptById(item.id);
        });

        const upBtn = createActionButton('↑', '', 'cgpt-prompt-order-btn');
        upBtn.title = '上移';
        upBtn.dataset.promptId = item.id;
        upBtn.dataset.action = 'move-up';
        upBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          movePrompt(item.id, -1);
        });

        const downBtn = createActionButton('↓', '', 'cgpt-prompt-order-btn');
        downBtn.title = '下移';
        downBtn.dataset.promptId = item.id;
        downBtn.dataset.action = 'move-down';
        downBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          movePrompt(item.id, 1);
        });

        actions.appendChild(fillBtn);
        actions.appendChild(sendBtn);
        actions.appendChild(copyBtn);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        actions.appendChild(upBtn);
        actions.appendChild(downBtn);

        row.appendChild(actions);

        listEl.appendChild(row);
      }

      clearPromptStatus();

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.purgeForbiddenStatusBadge === 'function') {
        ToolboxShell.purgeForbiddenStatusBadge('prompt-render-end');
      }

      logPromptListCompactLayout('render');
    }

    function logPromptListCompactLayout(reason = '') {
      const list = root ? root.querySelector('#cgpt-prompt-list') : null;
      if (!list) {
        ToolboxShell.appendLog(`[PROMPT_UI][COMPACT_CHECK] reason=${reason} result=missing-list`);
        return;
      }

      const firstItem = list.querySelector('.cgpt-prompt-item');
      const firstActions = list.querySelector('.cgpt-prompt-actions, .cgpt-prompt-actions-compact');

      if (!firstItem || !firstActions) {
        ToolboxShell.appendLog(`[PROMPT_UI][COMPACT_CHECK] reason=${reason} result=empty`);
        return;
      }

      const itemStyle = window.getComputedStyle(firstItem);
      const actionStyle = window.getComputedStyle(firstActions);

      ToolboxShell.appendLog(
        `[PROMPT_UI][COMPACT_CHECK] reason=${reason} itemPadding=${itemStyle.padding} itemMargin=${itemStyle.margin} actionGap=${actionStyle.gap} actionWrap=${actionStyle.flexWrap}`,
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

    function schedulePromptAutoSave(reason) {
      if (promptAutoSaveTimer) {
        clearTimeout(promptAutoSaveTimer);
      }

      promptAutoSaveTimer = setTimeout(() => {
        promptAutoSaveTimer = null;
        savePromptListFromState(reason || 'auto-save');
      }, 500);
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
        || String(draft.category || '').trim()
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
        category: '默认',
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

          if (field.id === 'cgpt-prompt-edit-category' && editingPromptId) {
            const item = prompts.find((prompt) => prompt.id === editingPromptId);

            if (item) {
              item.category = String(event.target.value || '') || '默认';
              item.updatedAt = Date.now();
              schedulePromptAutoSave('category-input');
            }
          }
        });
      });
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

    function openEditor(id) {
      editingPromptId = id;
      editorOpenBaseline = captureEditorBaseline(id);

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
        categoryInput.value = item.category || '默认';
        setPromptTextareaValueAndUpdateCount(contentInput, item.content, 'open-editor');
        deleteBtn.style.display = '';
        duplicateBtn.style.display = '';
      } else {
        modalTitle.textContent = '新建 Prompt';
        titleInput.value = '';
        categoryInput.value = '默认';
        contentInput.value = '';
        deleteBtn.style.display = 'none';
        duplicateBtn.style.display = 'none';
      }

      const draft = readPromptEditorDraft();

      if (draftHasMeaningfulContent(draft)) {
        titleInput.value = String(draft.title || '');
        categoryInput.value = String(draft.category || '') || '默认';
        contentInput.value = String(draft.content || '');
        console.log('[PROMPT_DRAFT][RESTORE]', {
          key: getPromptEditorDraftKey(),
          editingPromptId: editingPromptId || null,
        });
        setStatus('已恢复未保存草稿');
      }

      renderCategoryDatalist();
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
        const category = ensureCategoryExists(categoryInput.value);
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
        activeCategory = '全部';
        MemoryManager.set(
          MemoryManager.KEYS.promptManagerActiveCategory,
          activeCategory,
        );
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

      const categoryInput = qs('#cgpt-prompt-edit-category', editorRoot);
      if (!(categoryInput instanceof HTMLInputElement)) return;

      const brokenPlaceholder = String(categoryInput.getAttribute('placeholder') || '');
      if (!brokenPlaceholder.includes('论>') && categoryInput.list === 'cgpt-prompt-category-options') {
        return;
      }

      categoryInput.setAttribute('placeholder', '例如：代码、Cursor、论文');
      categoryInput.setAttribute('list', 'cgpt-prompt-category-options');

      let datalist = qs('#cgpt-prompt-category-options', editorRoot);
      if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = 'cgpt-prompt-category-options';
        categoryInput.insertAdjacentElement('afterend', datalist);
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
              <input class="cgpt-input" id="cgpt-prompt-edit-category" list="cgpt-prompt-category-options" placeholder="例如：代码、Cursor、论文">
              <datalist id="cgpt-prompt-category-options"></datalist>
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

      bindClick(root, '#cgpt-prompt-new-quick-btn', () => openEditor(null), {
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

          activeCategory = btn.getAttribute('data-prompt-category') || '全部';

          MemoryManager.set(
            MemoryManager.KEYS.promptManagerActiveCategory,
            activeCategory,
          );

          render();
          setStatus(`已切换分类：${activeCategory}`);
        }, 'bound_prompt_category_bar_click');
      }

      const categoryAddBtn = qs('#cgpt-prompt-category-add', root);

      if (categoryAddBtn) {
        bindOnce(categoryAddBtn, 'click', () => {
          addPromptCategory();
        });
      }

      const categoryNameInput = qs('#cgpt-prompt-category-name', root);

      if (categoryNameInput) {
        bindOnce(categoryNameInput, 'keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          addPromptCategory();
        });
      }

      const categoryManageList = qs('#cgpt-prompt-category-manage-list', root);

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
        <div class="cgpt-section">
          <div id="cgpt-prompt-subtabs" class="cgpt-prompt-subtabs">
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="manage">Prompt 管理</button>
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="display">Prompt 展示</button>
          </div>

          <div id="cgpt-prompt-manage-panel" class="cgpt-prompt-panel">
            <div id="cgpt-prompt-manage-tools" class="cgpt-grid-4" style="margin-top:8px;">
              <button type="button" class="cgpt-btn primary" id="cgpt-prompt-new-quick-btn">+ 新建 Prompt</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-export-btn">导出</button>
              <button type="button" class="cgpt-btn" id="cgpt-prompt-import-btn">导入</button>
              <button type="button" class="cgpt-btn danger" id="cgpt-prompt-reset-btn">重置</button>
            </div>

            <div id="cgpt-prompt-category-bar" class="cgpt-prompt-category-bar"></div>
            <input id="cgpt-prompt-search" class="cgpt-input" placeholder="搜索标题、分类或内容...">
            <div id="cgpt-prompt-list" class="cgpt-prompt-list"></div>

            <div class="cgpt-section" id="cgpt-prompt-category-manager" style="margin-top:10px; padding:10px; border:1px solid #2f3542; border-radius:10px;">
              <div class="cgpt-section-title">类别管理</div>
              <div class="cgpt-prompt-category-edit-row">
                <input class="cgpt-input" id="cgpt-prompt-category-name" placeholder="输入类别名称，例如：论文">
                <button type="button" class="cgpt-btn primary" id="cgpt-prompt-category-add">新建类别</button>
              </div>
              <div id="cgpt-prompt-category-manage-list" class="cgpt-prompt-category-manage-list"></div>
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
                <label>点击 Prompt 后的动作</label>
                <select class="cgpt-select" id="cgpt-prompt-display-click-action">
                  <option value="send">填入并发送</option>
                  <option value="fill">只填入输入框</option>
                </select>
              </div>

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
        },
        onBind: () => {
          createEditorModal();
          bindPromptEditorModalResize();
          bindEvents();
        },
        onRender: () => {
          activePromptSubtab = normalizePromptSubtab(
            MemoryManager.get(
              MemoryManager.KEYS.promptManagerActiveSubtab,
              'manage',
            ),
          );
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
