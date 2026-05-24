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
    let activePromptSubtab = MemoryManager.get(
      MemoryManager.KEYS.promptManagerActiveSubtab,
      'list',
    );
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
      }

      return ok;
    }

    function savePrompts() {
      return savePromptManagerData({ prompts, categories });
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

    function renderPromptSubtabs() {
      const tabs = qsa('[data-prompt-subtab]', root);
      tabs.forEach((btn) => {
        const name = btn.getAttribute('data-prompt-subtab');
        btn.classList.toggle('active', name === activePromptSubtab);
      });

      const listPanel = qs('#cgpt-prompt-list-panel', root);
      const categoryPanel = qs('#cgpt-prompt-category-panel', root);

      if (listPanel) {
        listPanel.style.display = activePromptSubtab === 'list' ? '' : 'none';
      }

      if (categoryPanel) {
        categoryPanel.style.display = activePromptSubtab === 'category' ? '' : 'none';
      }
    }

    function render() {
      if (!listEl) return;

      renderPromptSubtabs();

      if (activePromptSubtab === 'list') {
        renderCategoryBar();
      }

      if (activePromptSubtab === 'category') {
        renderCategoryManager();
        renderCategoryDatalist();
      }

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
        actions.className = 'cgpt-prompt-actions';

        const batchLabel = document.createElement('label');
        batchLabel.className = 'cgpt-checkbox-line cgpt-prompt-batch-task-check';
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
          const ok = await copyTextToClipboard(item.content);
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

        const upBtn = createActionButton('↑');
        upBtn.title = '上移';
        upBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          movePrompt(item.id, -1);
        });

        const downBtn = createActionButton('↓');
        downBtn.title = '下移';
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
    }

    function createActionButton(text, type) {
      return createToolboxButton(text, {
        variant: type === 'primary' ? 'primary' : '',
        height: '28px',
        padding: '0 8px',
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

      savePrompts();
      render();
      notifyUploadQuickPromptsRefresh('prompt-move');
      setStatus('已调整排序');
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

        bindOnce(field, 'input', () => {
          savePromptEditorDraftDebounced();
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
        contentInput.value = item.content;
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
      const titleInput = qs('#cgpt-prompt-edit-title', modalOverlay);
      const categoryInput = qs('#cgpt-prompt-edit-category', modalOverlay);
      const contentInput = qs('#cgpt-prompt-edit-content', modalOverlay);

      const title = String(titleInput.value || '').trim();
      const category = ensureCategoryExists(categoryInput.value);
      const content = String(contentInput.value || '');

      if (!title) {
        alert('标题不能为空');
        return;
      }

      if (!content.trim()) {
        alert('Prompt 内容不能为空');
        return;
      }

      const existing = prompts.find((item) => item.id === editingPromptId);

      if (editingPromptId && !existing) {
        const msg = `保存失败：原 Prompt 已不存在，editingPromptId=${editingPromptId}`;
        console.warn('[PROMPT][SAVE_MISSING_EDITING_ID]', msg);
        ToolboxShell.appendLog(`[PROMPT][SAVE_MISSING_EDITING_ID] ${msg}`);
        alert('保存失败：原 Prompt 已不存在，请刷新 Prompt 管理后重试');
        reloadFromStorage();
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
        setStatus('保存失败：浏览器存储写入失败', 'error');
        return;
      }

      clearPromptEditorDraft();
      commitPromptManagerChange(message, {
        closeEditor: true,
        skipPersist: true,
        reason: 'prompt-save',
      });
    }

    function deleteCurrentPrompt() {
      if (!editingPromptId) return;
      deletePromptById(editingPromptId, { closeEditor: true });
    }

    function duplicateCurrentPrompt() {
      const item = prompts.find((prompt) => prompt.id === editingPromptId);
      if (!item) return;

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
        reason: 'prompt-save',
      });
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

    function buildImportConfirmMessage(rawCount, dedupedCount, internalRemoved) {
      let msg = `读取 ${rawCount} 条 Prompt`;
      if (internalRemoved > 0) {
        msg += `（文件内去重 ${internalRemoved} 条）`;
      }
      msg += `，待导入 ${dedupedCount} 条。\n\n点击“确定”：覆盖当前列表。\n点击“取消”：追加到当前列表。`;
      return msg;
    }

    function buildImportStatusMessage({
      added,
      skipped,
      conflicts,
      internalRemoved,
      replace,
    }) {
      const parts = [];

      if (replace) {
        parts.push(`覆盖导入完成：${added} 条`);
      } else {
        parts.push(`追加导入完成：新增 ${added} 条`);
        if (skipped > 0) {
          parts.push(`跳过完全相同 ${skipped} 条`);
        }
        if (conflicts > 0) {
          parts.push(`标题冲突已重命名 ${conflicts} 条`);
        }
      }

      if (internalRemoved > 0) {
        parts.push(`文件内去重 ${internalRemoved} 条`);
      }

      return parts.join('，');
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
      try {
        const data = await readJsonFileFromInput(event, {
          tag: '[PROMPT_IMPORT]',
        });

        if (!data) return;

        const importedData = normalizePromptManagerData(data);
        const rawCount = importedData.prompts.length;

        if (!rawCount) {
          alert('导入失败：文件中没有有效 Prompt');
          return;
        }

        const { items: dedupedImport, removed: internalRemoved } = dedupeImportFilePrompts(
          importedData.prompts,
        );

        if (!dedupedImport.length) {
          alert('导入失败：去重后没有可导入的 Prompt');
          return;
        }

        const replace = confirm(
          buildImportConfirmMessage(rawCount, dedupedImport.length, internalRemoved),
        );

        let added = 0;
        let skipped = 0;
        let conflicts = 0;

        if (replace) {
          const seenImportIds = new Set();

          prompts = dedupedImport.map((item) => {
            const record = createImportedPromptRecord(item, {}, { preserveId: true });

            if (!record.id || seenImportIds.has(record.id)) {
              record.id = createId('prompt');
            }

            seenImportIds.add(record.id);
            return record;
          });
          categories = importedData.categories.map((cat) => ({
            ...cat,
            id: createId('cat'),
            createdAt: nowMs(),
            updatedAt: nowMs(),
          }));
          added = prompts.length;
        } else {
          const appendResult = prepareAppendImportItems(dedupedImport, prompts);
          prompts = [...appendResult.toPrepend, ...prompts];
          added = appendResult.added;
          skipped = appendResult.skipped;
          conflicts = appendResult.conflicts;

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
        }

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
        setStatus(buildImportStatusMessage({
          added,
          skipped,
          conflicts,
          internalRemoved,
          replace,
        }));
        ToolboxShell.appendLog(
          `[PROMPT_IMPORT] mode=${replace ? 'replace' : 'append'} raw=${rawCount} deduped=${dedupedImport.length} added=${added} skipped=${skipped} conflicts=${conflicts} internalRemoved=${internalRemoved}`,
        );
      } catch (e) {
        const errText = getErrorText(e);
        console.error('[ChatGPT toolbox] Prompt import failed', e);
        alert(`导入失败：${errText}`);
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
        categoryAddBtn.addEventListener('click', () => {
          addPromptCategory();
        });
      }

      const categoryNameInput = qs('#cgpt-prompt-category-name', root);

      if (categoryNameInput) {
        categoryNameInput.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          addPromptCategory();
        });
      }

      const categoryManageList = qs('#cgpt-prompt-category-manage-list', root);

      if (categoryManageList) {
        categoryManageList.addEventListener('click', (e) => {
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
        });
      }

      const subtabBar = qs('#cgpt-prompt-subtabs', root);
      if (subtabBar) {
        subtabBar.addEventListener('click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-prompt-subtab]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activePromptSubtab = btn.getAttribute('data-prompt-subtab') || 'list';

          MemoryManager.set(
            MemoryManager.KEYS.promptManagerActiveSubtab,
            activePromptSubtab,
          );

          renderPromptSubtabs();

          if (activePromptSubtab === 'category') {
            renderCategoryManager();
            renderCategoryDatalist();
          }

          if (activePromptSubtab === 'list') {
            renderCategoryBar();
          }
        });
      }
    }

    const PROMPT_MODULE_HTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">Prompt 管理</div>
          <div id="cgpt-prompt-manage-tools" class="cgpt-grid-4" style="margin-top:8px;">
            <button type="button" class="cgpt-btn primary" id="cgpt-prompt-new-quick-btn">+ 新建 Prompt</button>
            <button type="button" class="cgpt-btn" id="cgpt-prompt-export-btn">导出</button>
            <button type="button" class="cgpt-btn" id="cgpt-prompt-import-btn">导入</button>
            <button type="button" class="cgpt-btn danger" id="cgpt-prompt-reset-btn">重置</button>
          </div>

          <div id="cgpt-prompt-subtabs" class="cgpt-prompt-subtabs">
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="list">Prompt 列表</button>
            <button type="button" class="cgpt-prompt-subtab" data-prompt-subtab="category">类别管理</button>
          </div>

          <div id="cgpt-prompt-list-panel" class="cgpt-prompt-panel">
            <div id="cgpt-prompt-category-bar" class="cgpt-prompt-category-bar"></div>
            <input id="cgpt-prompt-search" class="cgpt-input" placeholder="搜索标题、分类或内容..." style="margin-top:8px;">
            <div id="cgpt-prompt-list" class="cgpt-prompt-list" style="margin-top:8px;"></div>
            <div id="cgpt-prompt-status" class="cgpt-hint" style="margin-top:8px; display:none;"></div>
          </div>

          <div id="cgpt-prompt-category-panel" class="cgpt-prompt-panel" style="display:none;">
            <div class="cgpt-section" id="cgpt-prompt-category-manager" style="padding:10px; border:1px solid #2f3542; border-radius:10px;">
              <div class="cgpt-prompt-category-edit-row">
                <input class="cgpt-input" id="cgpt-prompt-category-name" placeholder="输入类别名称，例如：论文">
                <button type="button" class="cgpt-btn primary" id="cgpt-prompt-category-add">新建类别</button>
              </div>

              <div id="cgpt-prompt-category-manage-list" class="cgpt-prompt-category-manage-list"></div>
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
          activePromptSubtab = MemoryManager.get(
            MemoryManager.KEYS.promptManagerActiveSubtab,
            'list',
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
