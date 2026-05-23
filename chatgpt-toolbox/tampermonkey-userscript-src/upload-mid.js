    function buildFlaskUploadListHtml() {
      const flaskRows = (state.flaskFiles || []).filter(
        (row) => row && row.status !== 'uploaded',
      );

      return flaskRows.map((row) => {
        const itemTitle = escapeHtml([
          `文件名：${row.name || '-'}`,
          `大小：${formatBytes(row.size)}`,
          '来源：本地直读',
          row.download_url ? `下载：${row.download_url}` : '',
        ].filter(Boolean).join('\n'));

        return `
            <div class="cgpt-upload-item flask-local-direct" data-flask-file-id="${escapeHtml(row.file_id || '')}" title="${itemTitle}">
              <div class="cgpt-upload-file-main">
                <div class="cgpt-upload-name">${escapeHtml(row.name || 'unknown')}</div>
                <div class="cgpt-upload-meta">
                  ${escapeHtml(formatBytes(row.size))}
                  <span class="cgpt-upload-dot">·</span>
                  <span class="cgpt-upload-source-label">本地直读</span>
                </div>
              </div>
            </div>
          `;
      }).join('');
    }

    function buildUploadListHtml() {
      const files = getActiveGroupFiles();
      const selectedFileId = getSelectedFileIdForActiveGroup();
      const activeGroupId = getActiveGroupId();
      const flaskHtml = buildFlaskUploadListHtml();

      if (!files.length && !flaskHtml) {
        return `
          <div class="cgpt-upload-item empty">
            <div>
              <div class="cgpt-upload-meta">当前项目没有文件</div>
            </div>
          </div>
        `;
      }

      const queueHtml = files.map((q) => {
        const activeClass = selectedFileId === q.id ? 'active' : '';
        const cachedClass = isCachedUploadSnapshot(q) ? 'cached-snapshot' : '';
        const sourceText = getUploadInlineStatusText(q);
        const itemTitle = escapeHtml(buildUploadItemTitle(q));

        const rebindButtonHtml = shouldShowRebindButton(q)
          ? `
            <button type="button"
              class="cgpt-upload-file-rebind"
              data-upload-rebind-id="${escapeHtml(q.id)}"
              title="重新选择本地文件">
              重新绑定
            </button>
          `
          : '';

        return `
            <div class="cgpt-upload-item ${activeClass} ${cachedClass}" data-id="${q.id}" data-group-id="${escapeHtml(activeGroupId)}" data-file-id="${escapeHtml(q.id)}" title="${itemTitle}">
              <div class="cgpt-upload-file-main">
                <div class="cgpt-upload-name">${escapeHtml(q.name || 'unknown')}</div>
                <div class="cgpt-upload-meta">
                  ${escapeHtml(formatBytes(q.size))}
                  <span class="cgpt-upload-dot">·</span>
                  <span class="cgpt-upload-source-label ${isCachedUploadSnapshot(q) ? 'cached-source' : ''}">
                    ${escapeHtml(sourceText)}
                  </span>
                  ${rebindButtonHtml}
                </div>
              </div>
              <div class="cgpt-upload-actions-cell">
                <button type="button"
                  class="cgpt-upload-file-remove"
                  data-upload-remove-id="${escapeHtml(q.id)}"
                  title="移除">
                  ×
                </button>
              </div>
            </div>
          `;
      }).join('');

      return `${flaskHtml}${queueHtml}`;
    }

    function scheduleRenderUpload(reason = '') {
      const reasonText = String(reason || '').trim();

      if (reasonText && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(`[UPLOAD_RENDER][schedule] reason=${reasonText}`);
      }

      if (uploadTimers.has('upload-render', 'raf')) {
        return;
      }

      uploadTimers.raf('upload-render', () => {
        renderUploadListOnly();
        renderUploadButtonsOnly();
      });
    }

    function renderUploadListOnly() {
      const el = listEl || (rootElRef ? qs(UploadSelectors.list, rootElRef) : null);
      if (!el) return;

      listEl = el;
      refreshQueueReadableState();
      el.innerHTML = buildUploadListHtml();
    }

    function getUploadPageCapability() {
      let hasComposer = false;
      let canSendNow = false;
      let isResponding = false;

      try {
        hasComposer = typeof ComposerApi.hasComposer === 'function' && ComposerApi.hasComposer();
        canSendNow = typeof ComposerApi.canSendNow === 'function' && ComposerApi.canSendNow();
        isResponding = typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] getUploadPageCapability failed', err);
        ToolboxShell.appendLog(`[UPLOAD][capability-check-failed] error=${errText}`);
      }

      const latestAssistant = getLatestAssistantMessageForCopy();

      return {
        hasComposer,
        canSendNow,
        isResponding,
        sendable: hasComposer && canSendNow && !isResponding,
        copyable: !!(latestAssistant && latestAssistant.ok),
      };
    }

    function renderUploadButtonsOnly() {
      healStaleUploadRunningLockIfNeeded('renderUploadButtonsOnly');

      const capability = getUploadPageCapability();

      const currentStartBtn = rootElRef
        ? qs(UploadSelectors.startBtn, rootElRef)
        : startBtn;

      if (currentStartBtn) {
        startBtn = currentStartBtn;
      }

      const uiRunning = isUploadRunActuallyActive();

      const activeFiles = getActiveGroupFiles();

      setButtonState(currentStartBtn, {
        text: uiRunning ? '正在上传' : '开始上传',
        disabled: uiRunning || activeFiles.length <= 0,
        removeClasses: ['primary', 'danger'],
        addClasses: ['success'],
      });

      const startSendBtn = rootElRef ? qs(UploadSelectors.startSendBtn, rootElRef) : null;
      if (startSendBtn) {
        const waitingSend = isWaitingSendActive();
        let sendTitle = '';

        if (waitingSend) {
          sendTitle = '再次点击可取消等待发送';
        } else if (!capability.hasComposer) {
          sendTitle = '未找到 ChatGPT 输入框';
        } else if (capability.isResponding) {
          sendTitle = '助手正在回复，暂不可发送';
        } else if (!capability.can_send_now) {
          sendTitle = '当前页面暂不可发送';
        }

        setButtonState(startSendBtn, {
          text: waitingSend ? '取消等待' : '发送信息',
          title: sendTitle,
          disabled: !waitingSend && !capability.hasComposer,
          ariaDisabled: !waitingSend && !capability.hasComposer,
          removeClasses: ['primary', 'danger', 'cgpt-wait-send-cancel'],
          addClasses: waitingSend ? ['danger', 'cgpt-wait-send-cancel'] : ['primary'],
        });
      }

      const copyContinueBtn = rootElRef ? qs(UploadSelectors.copyContinueBtn, rootElRef) : null;

      if (copyContinueBtn) {
        const busy = typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy();
        const actionBusy = copyContinueBtn.dataset.busy === '1';
        const waitingReply = copyContinueBtn.dataset.waitingReply === '1';
        const continueBtnText = actionBusy
          ? (waitingReply ? '等待回复...' : '继续中...')
          : '复制并继续';
        const waitingAnswer = isWaitingAnswerVisualState({
          text: continueBtnText,
          isResponding: busy,
        }) || waitingReply;

        setButtonState(copyContinueBtn, {
          text: continueBtnText,
          title: busy
            ? '当前正在回复：点击后会等待回复完成，再复制并继续'
            : '先复制最后回复，再发送“继续”',
          disabled: false,
          ariaDisabled: actionBusy,
          removeClasses: [
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'cgpt-waiting-answer',
            'cgpt-btn-error',
            'cgpt-btn-ok',
            'failed',
            'error',
          ],
          addClasses: waitingAnswer
            ? ['cgpt-waiting-answer', 'copy-continue', 'cgpt-btn-copy-continue']
            : ['copy-continue', 'cgpt-btn-copy-continue'],
        });
        copyContinueBtn.dataset.assistantBusy = busy ? '1' : '0';
      }

      const copyLastMessageBtn = rootElRef ? qs(UploadSelectors.copyLastMessageBtn, rootElRef) : null;
      if (copyLastMessageBtn) {
        const taskRunning = copyLastReplyTaskRunning || copyLastMessageTaskRunning;
        const taskStatus = String(copyLastReplyTaskStatus || copyLastMessageTaskStatus || '').trim();

        let text = '复制最后回复';
        let title = '等待最后一条 assistant 回复稳定后复制到剪贴板';
        let addClasses = ['primary'];
        let disabled = false;

        if (taskRunning) {
          disabled = true;
          if (taskStatus === 'waiting' || copyLastMessageWaiting) {
            text = '等待回复...';
            title = '正在等待 ChatGPT 回复完成并稳定';
            addClasses = ['waiting', 'cgpt-waiting-answer'];
          } else if (taskStatus === 'copying') {
            text = '复制中...';
            title = '正在复制最后回复到剪贴板';
            addClasses = ['warning'];
          } else if (taskStatus === 'success') {
            text = '已复制';
            title = '最后回复已复制';
            addClasses = ['success'];
          } else if (taskStatus === 'failed') {
            text = '复制失败';
            title = '复制最后回复失败';
            addClasses = ['danger'];
          } else if (copyLastMessageWaiting) {
            text = '等待回复...';
            title = '正在等待 ChatGPT 回复完成并稳定';
            addClasses = ['waiting', 'cgpt-waiting-answer'];
          } else {
            text = '复制中...';
            title = '正在复制最后回复到剪贴板';
            addClasses = ['warning'];
          }
        }

        setButtonState(copyLastMessageBtn, {
          text,
          title,
          disabled,
          ariaDisabled: disabled,
          removeClasses: [
            'primary',
            'success',
            'warning',
            'orange',
            'amber',
            'teal',
            'purple',
            'cyan',
            'danger',
            'waiting',
            'cgpt-waiting-answer',
            'cgpt-btn-error',
            'cgpt-btn-ok',
            'failed',
            'error',
          ],
          addClasses,
        });
      }


      const copyHotkeyContinueOnceBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueOnceBtn, rootElRef)
        : null;
      if (copyHotkeyContinueOnceBtn) {
        setButtonState(copyHotkeyContinueOnceBtn, {
          text: copyHotkeyContinueTaskRunning ? '处理中...' : '复制+快捷键+继续',
          title: '等待回答完成 -> 复制最后回复 -> 发送 Ctrl+Alt+I -> 发送继续',
          disabled: copyHotkeyContinueTaskRunning || copyHotkeyContinueLoopRunning,
          ariaDisabled: copyHotkeyContinueTaskRunning || copyHotkeyContinueLoopRunning,
          removeClasses: [
            'primary',
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'teal',
            'cgpt-btn-error',
            'cgpt-btn-ok',
          ],
          addClasses: ['purple'],
        });
      }

      const copyHotkeyContinueLoopBtn = rootElRef
        ? qs(UploadSelectors.copyHotkeyContinueLoopBtn, rootElRef)
        : null;
      if (copyHotkeyContinueLoopBtn) {
        copyHotkeyContinueLoopBtn.classList.remove(
          'primary',
          'success',
          'warning',
          'orange',
          'amber',
          'teal',
          'purple',
          'cyan',
          'danger',
          'cgpt-btn-error',
          'cgpt-btn-ok',
          'cgpt-action-running',
          'cgpt-waiting-answer',
        );

        if (copyHotkeyContinueLoopRunning) {
          copyHotkeyContinueLoopBtn.textContent = '停止连续';
          copyHotkeyContinueLoopBtn.classList.add('danger', 'cgpt-action-running');
          copyHotkeyContinueLoopBtn.disabled = false;
          copyHotkeyContinueLoopBtn.title = '点击停止循环';
        } else {
          copyHotkeyContinueLoopBtn.textContent = '连续复制+快捷键+继续';
          copyHotkeyContinueLoopBtn.classList.add('cyan');
          copyHotkeyContinueLoopBtn.disabled = false;
          copyHotkeyContinueLoopBtn.title = '循环执行：等待回答完成 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续';
        }
        copyHotkeyContinueLoopBtn.setAttribute('aria-disabled', 'false');
      }

      applyUploadShortcutButtonTitles(rootElRef);
    }

    function buildQuickPromptRenderSignature() {
      const cfg = getCompactUiConfig();
      const promptsVersion = JSON.stringify(
        PromptManagerModule && typeof PromptManagerModule.getPrompts === 'function'
          ? PromptManagerModule.getPrompts().map((p) => p.id)
          : [],
      );

      return JSON.stringify({
        isCompact: isCompactUploadView(),
        showUploadQuickPrompts: cfg.showUploadQuickPrompts !== false,
        showCompactQuickPrompts: cfg.showCompactQuickPrompts !== false,
        quickPromptIds: cfg.quickPromptIds || [],
        quickPromptActiveCategory: getQuickPromptActiveCategory(),
        promptsVersion,
      });
    }

    function renderUploadQuickPrompts() {
      const signature = buildQuickPromptRenderSignature();

      if (signature === quickPromptRenderSignature) {
        return;
      }

      quickPromptRenderSignature = signature;

      const box = rootElRef ? qs('#cgpt-upload-quick-prompts', rootElRef) : null;
      if (!box) return;

      const cfg = getCompactUiConfig();
      const isCompact = isCompactUploadView();

      const shouldShow = isCompact
        ? cfg.showCompactQuickPrompts !== false
        : cfg.showUploadQuickPrompts !== false;

      const groupsEl = qs('#cgpt-upload-quick-prompt-groups', box);
      const promptsListEl = qs('#cgpt-upload-quick-prompts-list', box);

      if (!shouldShow) {
        box.classList.add('cgpt-toolbox-hidden');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][quick-prompt:hidden-by-config] isCompact=${isCompact}`,
        );
        return;
      }

      box.classList.remove('cgpt-toolbox-hidden');

      const ids = new Set(cfg.quickPromptIds || []);
      const prompts = typeof PromptManagerModule !== 'undefined' && typeof PromptManagerModule.getPrompts === 'function'
        ? PromptManagerModule.getPrompts()
        : [];

      if (!prompts.length) {
        if (groupsEl) groupsEl.innerHTML = '';
        if (promptsListEl) {
          promptsListEl.innerHTML = '<div class="cgpt-upload-meta">暂无 Prompt，请先到 Prompt 管理中添加。</div>';
        }
        ToolboxShell.appendLog('[UPLOAD_DIAG][quick-prompt:empty-prompts]');
        return;
      }

      const selected = prompts.filter((p) => ids.has(p.id));

      if (!selected.length) {
        if (groupsEl) groupsEl.innerHTML = '';
        if (promptsListEl) {
          promptsListEl.innerHTML = '<div class="cgpt-upload-meta">未选择常用 Prompt，请到设置中勾选。</div>';
        }
        ToolboxShell.appendLog('[UPLOAD_DIAG][quick-prompt:empty-selected]');
        return;
      }

      const groups = getQuickPromptGroups(selected);
      let activeCategory = getQuickPromptActiveCategory();

      if (!groups.includes(activeCategory)) {
        activeCategory = '全部';
        saveQuickPromptActiveCategory(activeCategory, {
          reason: 'quick-category-fallback',
        });
      }

      const visiblePrompts = activeCategory === '全部'
        ? selected
        : selected.filter((p) => getPromptCategoryName(p) === activeCategory);

      const groupsHtml = groups.map((name) => {
        const count = getQuickPromptCategoryCount(name, selected);

        return `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-quick-prompt-group${name === activeCategory ? ' active' : ''}"
              data-upload-quick-prompt-category="${escapeHtml(name)}"
              title="${escapeHtml(`${name}：${count} Prompt`)}">
              <span class="cgpt-chip-name">${escapeHtml(name)}</span>
              <span class="cgpt-chip-count">${count}</span>
            </button>
          `;
      }).join('');

      const chipsHtml = visiblePrompts.map((p) => `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-quick-prompt-chip"
              data-upload-quick-prompt-id="${escapeHtml(p.id)}"
              title="${escapeHtml(p.title || '')}">
              ${escapeHtml(p.title || 'Prompt')}
            </button>
          `).join('');

      if (groupsEl && promptsListEl) {
        groupsEl.innerHTML = groupsHtml;
        promptsListEl.innerHTML = chipsHtml;
      } else {
        box.innerHTML = `
        <div class="cgpt-upload-quick-prompts-title">常用 Prompt</div>

        <div class="cgpt-upload-quick-prompt-groups" id="cgpt-upload-quick-prompt-groups">
          ${groupsHtml}
        </div>

        <div class="cgpt-upload-quick-prompts-list" id="cgpt-upload-quick-prompts-list">
          ${chipsHtml}
        </div>
      `;
      }

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][quick-prompt:render] isCompact=${isCompact} shouldShow=true selected=${selected.length} total=${prompts.length} category=${activeCategory} visible=${visiblePrompts.length}`,
      );
    }

    function getQuickPromptCategoryCount(category, selectedPrompts) {
      if (category === '全部') {
        return selectedPrompts.length;
      }

      return selectedPrompts.filter((p) => getPromptCategoryName(p) === category).length;
    }

    function render() {
      if (!listEl) return;

      if (rootElRef) {
        ensureUploadGroupSection(rootElRef);
        groupListEl = qs('#cgpt-upload-group-list', rootElRef);
      }

      refreshQueueReadableState();
      syncActiveGroupCountInCache();
      renderToolboxTopStatus();

      listEl.innerHTML = buildUploadListHtml();

      renderUploadButtonsOnly();

      if (managePanelEl && !managePanelEl.classList.contains('cgpt-toolbox-hidden')) {
        syncGroupManagePanel();
      }

      applyCompactUiVisibility();
      renderUploadQuickPrompts();
    }

    function hasDraggedFiles(e) {
      const dt = e && e.dataTransfer;
      if (!dt) return false;

      if (Array.from(dt.types || []).includes('Files')) {
        return true;
      }

      return !!(dt.files && dt.files.length);
    }

    async function getHandleFromDataTransferItem(item) {
      if (item && typeof item.getAsFileSystemHandle === 'function') {
        try {
          return await item.getAsFileSystemHandle();
        } catch (e) {
          const errName = e && e.name ? e.name : 'Error';
          const errText = e && e.message ? e.message : String(e);
          console.warn('[ChatGPT toolbox] getAsFileSystemHandle failed', e);
          if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][drop:getAsFileSystemHandle-failed] type=${errName} kind=${item && item.kind ? item.kind : '-'} typeText=${item && item.type ? item.type : '-'} error=${errText}`,
            );
          }
          return null;
        }
      }

      return null;
    }

    async function collectDroppedFilesWithHandles(dataTransfer) {
      const result = [];
      const seen = new Map();

      function buildDroppedFileKey(file) {
        if (!file) return '';

        const name = String(file.name || '').trim().toLowerCase();
        const size = Number(file.size) || 0;
        const lastModified = Number(file.lastModified) || 0;
        const type = String(file.type || '').trim().toLowerCase();
        const path = String(file.webkitRelativePath || '').trim().toLowerCase();

        if (!name && !size && !lastModified && !path) {
          return '';
        }

        return `${name}::${size}::${lastModified}::${type}::${path}`;
      }

      function pushDroppedFile(file, handle, source) {
        const normalized = normalizeToNativeFile(
          file,
          file && file.name ? file.name : 'unknown',
        );

        if (!normalized) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][drop:skip-invalid] source=${source || '-'} name=${file && file.name ? file.name : '-'}`
          );
          return;
        }

        const key = buildDroppedFileKey(normalized);
        const nextHasHandle = isFileHandleLike(handle);

        if (key && seen.has(key)) {
          const existing = seen.get(key);

          if (existing && !existing.handle && nextHasHandle) {
            existing.file = normalized;
            existing.handle = handle;
            existing.source = source || '';

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][drop:dedupe-prefer-handle] source=${source || '-'} name=${normalized.name || '-'} size=${normalized.size || 0}`
            );
            return;
          }

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][drop:skip-duplicate] source=${source || '-'} key=${key || '-'} name=${normalized.name || '-'} size=${normalized.size || 0}`
          );
          return;
        }

        const entry = {
          file: normalized,
          handle: nextHasHandle ? handle : null,
          source: source || '',
        };

        result.push(entry);

        if (key) {
          seen.set(key, entry);
        }
      }

      const items = Array.from(dataTransfer && dataTransfer.items ? dataTransfer.items : []);
      const files = Array.from(dataTransfer && dataTransfer.files ? dataTransfer.files : []);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:collect-start] items=${items.length} files=${files.length} types=${Array.from(dataTransfer && dataTransfer.types ? dataTransfer.types : []).join('|')}`
      );

      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];

        if (!item || item.kind !== 'file') {
          continue;
        }

        let file = null;
        let handle = null;

        try {
          handle = await getHandleFromDataTransferItem(item);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] get handle from dropped item failed', err);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][drop:item-handle-failed] index=${index} error=${errText}`
          );
          handle = null;
        }

        if (handle && typeof handle.getFile === 'function') {
          try {
            file = await handle.getFile();
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] dropped handle.getFile failed', err);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][drop:item-getFile-failed] index=${index} error=${errText}`
            );
            file = null;
          }
        }

        if (!file && typeof item.getAsFile === 'function') {
          try {
            file = item.getAsFile();
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] dropped item.getAsFile failed', err);
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][drop:item-getAsFile-failed] index=${index} error=${errText}`
            );
            file = null;
          }
        }

        if (file) {
          pushDroppedFile(file, handle, 'items');
        }
      }

      files.forEach((rawFile, index) => {
        if (!rawFile) return;
        pushDroppedFile(rawFile, null, `files:${index}`);
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:collect-done] items=${items.length} files=${files.length} collected=${result.length}`
      );

      return result;
    }

    async function addDroppedFiles(dropped) {
      const safeDropped = Array.isArray(dropped) ? dropped.filter((x) => x && x.file) : [];

      if (!safeDropped.length) {
        setStatus('没有检测到可添加的文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:addFiles-skip] reason=empty-dropped');
        return;
      }

      const files = safeDropped.map((x) => x.file);
      const handles = safeDropped.map((x) => x.handle || null);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:addFiles-before] count=${files.length} names=${files.map((f) => f.name || '-').join('|')}`
      );

      await addFiles(files, {
        handles,
        sourceKind: 'drop',
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:addFiles-after] count=${files.length} queue=${state.queue.length}`
      );
    }

    async function handleUploadDropEvent(e) {
      e.preventDefault();
      e.stopPropagation();

      const transfer = e.dataTransfer;

      if (!transfer) {
        setStatus('拖拽失败：没有文件数据');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:failed] reason=no-dataTransfer');
        return;
      }

      if (!state.activeGroupId) {
        await ensureDefaultGroupReady();
      }

      if (!state.activeGroupId) {
        setStatus('拖拽失败：没有可用文件组');
        console.warn('[ChatGPT toolbox] drop failed: activeGroupId empty');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:failed] reason=empty-activeGroupId');
        return;
      }

      const dropped = await collectDroppedFilesWithHandles(transfer);

      if (!dropped.length) {
        setStatus('没有检测到可添加的文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][drop:empty]');
        return;
      }

      const beforeCount = state.queue.length;

      await addDroppedFiles(dropped);

      const afterCount = state.queue.length;
      const addedCount = Math.max(0, afterCount - beforeCount);

      setStatus(`已拖入：${dropped.length} 个文件，新增：${addedCount} 个`);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:done] dropped=${dropped.length} added=${addedCount} before=${beforeCount} after=${afterCount}`
      );
    }

    function prepareUploadDragEvent(e, options = {}) {
      if (!hasDraggedFiles(e)) {
        return false;
      }

      if (shouldLetNativeChatGptHandleDrop(e)) {
        return false;
      }

      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = options.dropEffect || 'copy';
      }

      return true;
    }

    function onUploadRootDragOver(e) {
      if (!prepareUploadDragEvent(e)) return;

      if (rootElRef) {
        rootElRef.classList.add('cgpt-upload-dragging');
      }
    }

    function onUploadRootDragLeave() {
      if (rootElRef) {
        rootElRef.classList.remove('cgpt-upload-dragging');
      }
    }

    async function onUploadRootDrop(e) {
      if (!prepareUploadDragEvent(e)) return;

      if (rootElRef) {
        rootElRef.classList.remove('cgpt-upload-dragging');
      }

      await handleUploadDropEvent(e);
    }

    function onGlobalUploadDragOver(e) {
      if (!prepareUploadDragEvent(e)) return;

      if (panelDropEl) {
        panelDropEl.classList.add('cgpt-toolbox-file-dragover');
      }
    }

    function onGlobalUploadDragLeave(e) {
      const related = e.relatedTarget instanceof Node ? e.relatedTarget : null;

      if (related && document.contains(related)) {
        return;
      }

      if (panelDropEl) {
        panelDropEl.classList.remove('cgpt-toolbox-file-dragover');
      }
    }

    async function onGlobalUploadDrop(e) {
      if (!prepareUploadDragEvent(e)) return;

      if (panelDropEl) {
        panelDropEl.classList.remove('cgpt-toolbox-file-dragover');
      }

      await handleUploadDropEvent(e);
    }

    function bindGlobalDropTarget(target, name) {
      if (!target) {
        console.warn('[ChatGPT toolbox] bindGlobalDropTarget: target 为空', name);
        return;
      }

      if (uploadDropBoundTargets.has(target)) {
        return;
      }

      uploadDropBoundTargets.add(target);

      if (target.dataset) {
        target.dataset.cgptUploadDropBound = '1';
      }

      target.addEventListener('dragover', onGlobalUploadDragOver, true);
      target.addEventListener('dragleave', onGlobalUploadDragLeave, true);
      target.addEventListener('drop', onGlobalUploadDrop, true);
    }

    function unbindGlobalDropTarget(target) {
      if (!target || !uploadDropBoundTargets.has(target)) {
        return;
      }

      target.removeEventListener('dragover', onGlobalUploadDragOver, true);
      target.removeEventListener('dragleave', onGlobalUploadDragLeave, true);
      target.removeEventListener('drop', onGlobalUploadDrop, true);

      uploadDropBoundTargets.delete(target);

      if (target.dataset) {
        delete target.dataset.cgptUploadDropBound;
      }
    }

    function syncGlobalDocumentDropBinding() {
      const cfg = getCompactUiConfig();

      if (cfg.globalDropCaptureEnabled) {
        bindGlobalDropTarget(document, 'document');
        return;
      }

      unbindGlobalDropTarget(document);
    }

    function bindUploadRootDropHandlers(rootEl) {
      if (!rootEl || uploadDropBoundTargets.has(rootEl)) {
        return;
      }

      uploadDropBoundTargets.add(rootEl);

      rootEl.addEventListener('dragover', onUploadRootDragOver, true);
      rootEl.addEventListener('dragleave', onUploadRootDragLeave, true);
      rootEl.addEventListener('drop', onUploadRootDrop, true);
    }

    function bindUploadDropTargets(rootEl) {
      bindUploadRootDropHandlers(rootEl);
      syncGlobalDocumentDropBinding();
    }

    async function ensureDefaultGroupReady() {
      if (state.activeGroupId) return;

      if (!state.groups.length) {
        const defaultGroup = createDefaultGroup();

        state.groups = [defaultGroup];
        state.activeGroupId = defaultGroup.id;

        await persistGroups();
        await schedulePersistQueue();

        saveCurrentToolboxBaseState('ensure-default-upload-group');

        render();
        return;
      }

      const preferred = resolvePreferredUploadGroupId(getToolboxPageState(), 'ensure-default-upload-group');

      state.activeGroupId = preferred.groupId || state.groups[0].id;

      ToolboxShell.appendLog(
        `[UPLOAD_PAGE_STATE][ensure-default-group] groupId=${state.activeGroupId || '-'} source=${preferred.source || '-'}`,
      );

      saveCurrentToolboxBaseState('ensure-default-upload-group');

      await loadQueueForActiveGroup();

      render();
    }

    function buildQueueFileKey(fileOrItem) {
      if (!fileOrItem) return '';

      const name = String(fileOrItem.name || '').trim().toLowerCase();
      const size = Number(fileOrItem.size) || 0;
      const lastModified = Number(fileOrItem.lastModified) || 0;
      const type = String(fileOrItem.type || '').trim().toLowerCase();
      const path = String(
        fileOrItem.webkitRelativePath
        || fileOrItem.displayPath
        || '',
      ).trim().toLowerCase();

      if (!name && !size && !lastModified && !path) {
        return '';
      }

      return `${name}::${size}::${lastModified}::${type}::${path}`;
    }

    async function addFiles(files, options = {}) {
      const cleanFiles = Array.from(files || []).filter(Boolean);
      const handles = Array.isArray(options.handles) ? options.handles : [];

      if (!ensureActiveUploadGroupIdValid('add-files')) {
        if (!state.groups.length) {
          await ensureDefaultGroupReady();
        }
      }

      if (!state.activeGroupId) {
        setStatus('请先选择文件组');
        console.warn('[ChatGPT toolbox] addFiles blocked: activeGroupId empty');
        appendUploadGroupLog('ADD_FILE', { phase: 'blocked', reason: 'empty-activeGroupId' });
        return;
      }

      const existingKeys = new Set(
        state.queue
          .filter((item) => item.groupId === state.activeGroupId)
          .map((item) => buildQueueFileKey(item))
          .filter(Boolean)
      );

      let addedCount = 0;

      cleanFiles.forEach((file, index) => {
        const fileKey = buildQueueFileKey(file);

        if (fileKey && existingKeys.has(fileKey)) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][add-file-skip-duplicate] index=${index} name=${file.name || '-'} size=${file.size || 0} fileKey=${fileKey}`
          );
          return;
        }

        const handle = handles[index] || null;
        const hasHandle = isFileHandleLike(handle);

        const item = {
          id: newId(),
          groupId: state.activeGroupId,
          name: file.name || 'unknown',
          size: file.size || 0,
          type: file.type || 'application/octet-stream',
          lastModified: file.lastModified || Date.now(),
          file,
          blob: file,
          fileHandle: hasHandle ? handle : null,
          sourceKind: hasHandle ? 'local-handle' : 'session-file',
          readMode: hasHandle ? 'handle' : 'snapshot',
          state: UploadState.IDLE,
          message: '',
          uploadName: '',
          persistedAttached: false,
        };

        state.queue.push(item);

        if (fileKey) {
          existingKeys.add(fileKey);
        }

        addedCount += 1;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][add-file] index=${index} name=${item.name || '-'} size=${item.size || 0} handle=${hasHandle ? 1 : 0} sourceKind=${item.sourceKind} readMode=${item.readMode}`,
        );
      });

      await schedulePersistQueue();
      await refreshUploadGroupCounts();

      if (addedCount > 0) {
        const lastAdded = getActiveGroupFiles()[getActiveGroupFiles().length - 1];
        if (lastAdded && lastAdded.id) {
          setSelectedFileIdForActiveGroup(lastAdded.id, { reason: 'add-files' });
        }
      }

      render();

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][addFiles:done] count=${addedCount} queue=${getActiveGroupFiles().length} group=${state.activeGroupId || '-'}`,
      );
      syncUploadGroupAppState();
      appendUploadGroupLog('ADD_FILE', {
        addedCount,
        groupId: state.activeGroupId || '-',
      });
    }

    function pickOneLocalFileByInput() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        let finished = false;
        let focusCancelTimer = 0;

        function cleanup() {
          window.removeEventListener('focus', onWindowFocus, true);

          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
            focusCancelTimer = 0;
          }

          if (input && input.parentNode) {
            input.parentNode.removeChild(input);
          }
        }

        function finishOk(file) {
          if (finished) return;
          finished = true;
          cleanup();

          resolve({
            file,
            handle: null,
            source: 'input-file',
          });
        }

        function finishFailed(err) {
          if (finished) return;
          finished = true;
          cleanup();
          reject(err);
        }

        function readSelectedFile() {
          const file = input.files && input.files[0] ? input.files[0] : null;

          if (!file) {
            finishFailed(new Error('用户取消选择文件'));
            return;
          }

          finishOk(file);
        }

        function onWindowFocus() {
          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
          }

          focusCancelTimer = window.setTimeout(() => {
            focusCancelTimer = 0;

            if (finished) return;

            const file = input.files && input.files[0] ? input.files[0] : null;

            if (file) {
              finishOk(file);
              return;
            }

            finishFailed(new Error('用户取消选择文件'));
          }, 1200);
        }

        input.type = 'file';
        input.style.position = 'fixed';
        input.style.left = '-9999px';
        input.style.top = '-9999px';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
        input.style.zIndex = '-1';

        input.addEventListener('change', () => {
          if (focusCancelTimer) {
            window.clearTimeout(focusCancelTimer);
            focusCancelTimer = 0;
          }

          readSelectedFile();
        }, {
          once: true,
        });

        input.addEventListener('cancel', () => {
          finishFailed(new Error('用户取消选择文件'));
        }, {
          once: true,
        });

        document.body.appendChild(input);

        window.setTimeout(() => {
          window.addEventListener('focus', onWindowFocus, true);
        }, 0);

        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1');

        input.click();
      });
    }

    async function pickOneLocalFileWithHandle() {
      const showOpenFilePicker = getShowOpenFilePickerFn();

      if (!showOpenFilePicker) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=input-file fallback=1 supported=0');
        return pickOneLocalFileByInput();
      }

      ToolboxShell.appendLog('[UPLOAD_DIAG][picker] mode=file-system-access supported=1');

      let handles;

      try {
        handles = await showOpenFilePicker({
          multiple: false,
        });
      } catch (e) {
        if (e && (e.name === 'AbortError' || e.code === 20)) {
          throw new Error('用户取消选择文件');
        }

        console.error('[ChatGPT toolbox] showOpenFilePicker failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][picker:file-system-access-failed] error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }

      const handle = handles && handles[0] ? handles[0] : null;

      if (!handle || typeof handle.getFile !== 'function') {
        const err = new Error('未获取到有效文件句柄');
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: invalid handle', handle);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][picker:invalid-handle] error=${err.message}`);
        throw err;
      }

      let file;

      try {
        file = await handle.getFile();
      } catch (e) {
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: handle.getFile failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][picker:getFile-failed] error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }

      if (!file) {
        const err = new Error('文件句柄读取文件失败');
        console.error('[ChatGPT toolbox] pickOneLocalFileWithHandle: empty file', handle);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][picker:empty-file] error=${err.message}`);
        throw err;
      }

      return {
        file,
        handle,
        source: 'file-system-access',
      };
    }

    async function pickOneLocalFileForRebind() {
      return pickOneLocalFileWithHandle();
    }


    async function rebindUploadFile(id) {
      if (!id) {
        setStatus('重新绑定失败：缺少文件 ID');
        ToolboxShell.appendLog('[UPLOAD_DIAG][rebind-file:skip] reason=empty-id');
        return;
      }

      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('重新绑定失败：未找到队列文件');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:missing] id=${id || '-'}`);
        return;
      }

      try {
        const oldName = q.name || '';
        const picked = await pickOneLocalFileForRebind();
        const file = picked.file;
        const handle = picked.handle;

        if (!file) {
          throw new Error('重新绑定文件为空');
        }

        if (oldName && file.name && oldName !== file.name) {
          const ok = window.confirm(
            `重新选择的文件名和原缓存文件不同。\n\n原文件：${oldName}\n新文件：${file.name}\n\n是否继续绑定？`,
          );

          if (!ok) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][rebind-file:cancel-name-mismatch] id=${id || '-'} old=${oldName} next=${file.name}`,
            );
            setStatus('已取消重新绑定');
            return;
          }
        }

        const hasHandle = isFileHandleLike(handle);

        q.name = file.name || q.name || 'unknown';
        q.size = file.size || 0;
        q.type = file.type || q.type || 'application/octet-stream';
        q.lastModified = file.lastModified || Date.now();
        q.file = file;
        q.blob = file;

        if (hasHandle) {
          q.fileHandle = handle;
          q.sourceKind = 'local-handle';
          q.readMode = 'handle';
          q.message = '';
        } else {
          q.fileHandle = null;
          q.sourceKind = 'session-file';
          q.readMode = 'snapshot';
        }

        q.state = UploadState.IDLE;
        q.message = '';
        q.uploadName = '';
        q.persistedAttached = false;

        await schedulePersistQueue();
        await refreshUploadGroupCounts();

        render();

        setStatus(`已重新绑定文件：${q.name}`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][rebind-file:success] id=${id || '-'} source=${picked.source || '-'} handle=${hasHandle ? 1 : 0} sourceKind=${q.sourceKind} readMode=${q.readMode} name=${q.name || '-'} size=${q.size || 0}`,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);

        if (errText.includes('用户取消选择文件') || errText.includes('未选择文件')) {
          console.warn('[ChatGPT toolbox] rebind upload file cancelled', err);
          setStatus('已取消重新绑定');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:cancelled] id=${id || '-'} error=${errText}`);
          return;
        }

        console.warn('[ChatGPT toolbox] rebind upload file failed', err);
        console.error('[ChatGPT toolbox] rebind upload file failed', err);
        setStatus(`重新绑定失败：${errText}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:failed] id=${id || '-'} error=${errText}`);
      }
    }

    // 上传前统一入口：有 fileHandle 则 getFile() 读最新；否则用 file/blob 缓存快照
    async function readFreshFile(q) {
      if (!q) {
        throw new Error('readFreshFile: empty queue item');
      }

      if (q.fileHandle && typeof q.fileHandle.getFile === 'function') {
        try {
          const fresh = await q.fileHandle.getFile();

          if (fresh && fresh.size >= 0) {
            q.file = fresh;
            q.blob = fresh;
            q.name = fresh.name || q.name;
            q.size = fresh.size;
            q.type = fresh.type || q.type || 'application/octet-stream';
            q.lastModified = fresh.lastModified || q.lastModified;
            q.sourceKind = 'local-handle';
            q.readMode = 'handle';
            q.message = '';

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][readFreshFile:local-handle] name=${q.name || '-'} size=${q.size || 0} readMode=handle`,
            );

            return fresh;
          }
        } catch (e) {
          const errName = e && e.name ? e.name : 'Error';
          const errText = e && e.message ? e.message : String(e);

          console.warn('[ChatGPT toolbox] fileHandle.getFile failed, fallback to cached file/blob if available', e);

          q.message = `本地文件句柄读取失败，将尝试缓存快照：${errText}`;

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][readFreshFile:handle-failed-use-cache] name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} type=${errName} error=${errText}`,
          );
        }
      }

      if (q.file || q.blob) {
        const cachedFile = normalizeToNativeFile(q.file || q.blob, q.name);

        if (cachedFile) {
          q.file = cachedFile;
          q.blob = cachedFile;
          q.sourceKind = 'cached-blob';
          q.readMode = 'snapshot';

          if (!q.message) {
            q.message = '';
          }

          setStatus(`正在使用缓存快照上传：${q.name || '-'}`, 'running');

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][readFreshFile:cached-blob] name=${q.name || cachedFile.name} size=${cachedFile.size} readMode=snapshot`,
          );

          return cachedFile;
        }
      }

      q.state = UploadState.MISSING_FILE;
      q.sourceKind = 'missing-file';
      q.readMode = '';
      q.message = '缺少文件，请重新拖入';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][readFreshFile:missing] name=${q.name || '-'}`,
      );

      throw new Error(`缺少文件，请重新拖入：${q.name || '-'}`);
    }

    function cloneFileWithUniqueName(file, seq, total) {
      return cloneFileForUploadAttach(file, seq, total);
    }

    async function makeUploadFile(file, seq, total) {
      const renamed = cloneFileWithUniqueName(file, seq, total);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][makeUploadFile:rename-only] original=${file.name} upload=${renamed.name} size=${renamed.size}`
      );

      return renamed;
    }

    function dismissDuplicateDialogs() {
      const dialogs = qsa(SELECTORS.duplicateDialog).filter((el) => {
        return !isInToolbox(el) && isElementVisible(el);
      });

      dialogs.forEach((dialog) => {
        const text = String(dialog.innerText || dialog.textContent || '');

        if (!/已上传过|重复|duplicate|already uploaded/i.test(text)) return;

        const buttons = qsa('button, [role="button"]', dialog);
        const ok = buttons.find((btn) => {
          const t = String(btn.textContent || btn.getAttribute('aria-label') || '');
          return /确定|知道|OK|Ok|ok|close|关闭/i.test(t);
        });

        if (ok instanceof HTMLElement) {
          ok.click();
          ToolboxShell.appendLog('已自动关闭平台重复提示');
        }
      });
    }

    function startDuplicateWatcher() {
      if (state.observer) return;

      state.observer = new MutationObserver(() => {
        dismissDuplicateDialogs();
      });

      state.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    function stopDuplicateWatcher(graceMs = 0) {
      if (!state.observer) {
        return;
      }

      const delay = Math.max(0, Number(graceMs) || 0);

      const disconnectObserver = () => {
        if (!state.observer) {
          return;
        }

        state.observer.disconnect();
        state.observer = null;
      };

      if (delay > 0) {
        window.setTimeout(disconnectObserver, delay);
        return;
      }

      disconnectObserver();
    }

    const NON_UPLOADABLE_RUNNING_OR_FINAL_STATES = new Set([
      UploadState.ATTACHING,
      UploadState.READING,
      UploadState.ATTACHED,
      UploadState.CANCELLED,
      'VERIFYING',
      'PENDING_CONFIRM',
      'PLATFORM_DUPLICATE',
    ]);

    function logUploadFinal(q, stateValue, errText = '') {
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][uploadOne:final] name=${q && q.name ? q.name : '-'} state=${stateValue} groupId=${q && q.groupId ? q.groupId : '-'} sourceKind=${q && q.sourceKind ? q.sourceKind : '-'} size=${q && q.size ? q.size : 0} err=${errText || ''}`,
      );
    }

    function markUploadCancelled(q, reason = '用户已停止上传') {
      updateItem(q.id, {
        state: UploadState.CANCELLED,
        message: reason,
      });
      logUploadFinal(q, UploadState.CANCELLED, '');
      return false;
    }

    function isUploadItemBlockedByState(q) {
      if (!q) return true;
      return NON_UPLOADABLE_RUNNING_OR_FINAL_STATES.has(q.state)
        || isUploadUnfinishedState(q.state);
    }

    function isUploadItemUploadable(q) {
      if (isUploadItemBlockedByState(q)) return false;
      return hasAttemptableUploadSource(q);
    }

    function isUploadItemMissingSource(q) {
      if (isUploadItemBlockedByState(q)) return false;
      return !hasAttemptableUploadSource(q);
    }

    async function uploadOne(q, seq, total, options = {}) {
      const runId = options.runId;
      const signal = options.signal;
      let errText = '';

      ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:start] seq=${seq}/${total} name=${q.name} state=${q.state}`);

      if (isUploadCancelled(runId, signal)) {
        return markUploadCancelled(q);
      }

      try {
        updateItem(q.id, {
          state: UploadState.READING,
          message: '正在上传',
        });

        let fresh;

        try {
          fresh = await readFreshFile(q);

          ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:fresh-ok] name=${q.name} fresh=${fresh && fresh.name} size=${fresh && fresh.size} tag=${fresh ? Object.prototype.toString.call(fresh) : '-'}`);
        } catch (e) {
          console.warn('[ChatGPT toolbox] read fresh file failed', { name: q.name, id: q.id }, e);
          console.warn('[ChatGPT toolbox] read fresh file failed with source detail', {
            error: e,
            source: describeUploadSource(q),
            queue: state.queue.map((item) => describeUploadSource(item)),
          });

          ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:read-failed] ${q.name} ${e && e.message ? e.message : String(e)}`);

          const errMsg = e && e.message ? e.message : String(e);
          const missingFile = isHardFileReadFailure(errMsg);

          updateItem(q.id, {
            state: missingFile ? UploadState.MISSING_FILE : UploadState.FAILED,
            message: missingFile ? errMsg : `读取失败：${errMsg}`,
          });

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${missingFile ? UploadState.MISSING_FILE : UploadState.FAILED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=${errMsg}`
          );
          return false;
        }

        if (isUploadCancelled(runId, signal)) {
          return markUploadCancelled(q);
        }

        let uploadFile = normalizeToNativeFile(fresh, q.name) || fresh;

        if (isUploadUseUniqueFileNameEnabled()) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:before-make-upload-file] name=${q.name} fresh=${fresh.name} size=${fresh.size} seq=${seq}/${total}`
          );

          try {
            uploadFile = await makeUploadFile(fresh, seq, total);

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:make-upload-file-ok] original=${fresh.name} upload=${uploadFile.name} size=${uploadFile.size}`
            );
          } catch (e) {
            console.warn('[ChatGPT toolbox] makeUploadFile failed; fallback to original file', {
              name: fresh.name,
              seq,
              total,
            }, e);

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][uploadOne:make-upload-file-failed] name=${fresh.name} error=${e && e.message ? e.message : String(e)}`
            );

            uploadFile = fresh;
          }
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:rename-disabled] name=${fresh.name} size=${fresh.size}`
          );
        }

        console.debug('[ChatGPT toolbox] upload file name resolved', {
          originalName: fresh.name,
          uploadName: uploadFile.name,
          seq,
          total,
          uniqueNameEnabled: isUploadUseUniqueFileNameEnabled(),
        });

        updateItem(q.id, {
          state: UploadState.ATTACHING,
          message: '正在上传',
        });

        ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:before-attach] name=${q.name} uploadName=${uploadFile.name} size=${uploadFile.size}`);

        const result = await ComposerApi.attachFilesByFileInput([uploadFile], 8000, {
          signal,
          runId,
          isCancelled: () => isUploadCancelled(runId, signal),
        });

        ToolboxShell.appendLog(`[UPLOAD_DIAG][uploadOne:attach-result] name=${q.name} ok=${result.ok ? 1 : 0} reason=${result.reason || ''}`);

        if (isUploadCancelled(runId, signal) || result.cancelled) {
          return markUploadCancelled(q);
        }

        if (result.ok) {
          q.state = UploadState.ATTACHED;
          q.message = '';
          q.attachedInSession = true;
          q.persistedAttached = true;
          q.updatedAt = Date.now();

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${q.state} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
          );
          return true;
        }

        const postEvidence = ComposerApi.findAttachmentEvidence(uploadFile, {
          extraNames: [q.name, uploadFile.name].filter(Boolean),
        });
        const postChipCount = ComposerApi.countAttachmentChips();
        const chipCountBefore = Number.isFinite(Number(result.chipCountBefore))
          ? Number(result.chipCountBefore)
          : -1;
        const chipCountAfter = Number.isFinite(Number(result.chipCountAfter))
          ? Number(result.chipCountAfter)
          : postChipCount;
        const chipCountIncreased = chipCountBefore >= 0 && chipCountAfter > chipCountBefore;

        if (postEvidence && postEvidence.ok) {
          q.state = UploadState.ATTACHED;
          q.message = '';
          q.attachedInSession = true;
          q.persistedAttached = true;
          q.updatedAt = Date.now();

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:post-evidence-attached] name=${q.name || '-'} uploadName=${uploadFile.name || '-'} reason=${postEvidence.reason || '-'} chipCount=${postChipCount}`
          );

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${q.state} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=`
          );
          return true;
        }

        if (chipCountIncreased) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:chip-count-increased-but-need-name] name=${q.name || '-'} uploadName=${uploadFile.name || '-'} chipBefore=${chipCountBefore} chipAfter=${chipCountAfter}`
          );
        }

        console.warn('[ChatGPT toolbox] legacy input upload failed', {
          name: q.name,
          uploadName: uploadFile.name,
          reason: result.reason,
          result,
          postEvidence,
          postChipCount,
          textPreview: postEvidence && postEvidence.textPreview ? postEvidence.textPreview : '',
        });

        const failMessage = result.settledFailed || /未确认上传完成|附件已触发/.test(result.reason || '')
          ? (result.reason || '附件已出现但未能确认稳定')
          : (result.reason || '上传失败');

        updateItem(q.id, {
          state: UploadState.FAILED,
          message: failMessage,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][uploadOne:final] name=${q.name || '-'} state=${UploadState.FAILED} groupId=${q.groupId || '-'} sourceKind=${q.sourceKind || '-'} size=${q.size || 0} err=${failMessage}`
        );
        return false;
      } catch (err) {
        errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] uploadOne failed', err);

        updateItem(q.id, {
          state: UploadState.FAILED,
          message: errText,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][uploadOne:error] name=${q && q.name ? q.name : '-'} error=${errText}`
        );
        return false;
      } finally {
        const isCurrentRun = runId == null || runId === state.runId;

        if (
          isCurrentRun &&
          q &&
          isUploadUnfinishedState(q.state)
        ) {
          q.state = UploadState.FAILED;
          q.message = errText || '上传流程未正常结束';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:force-finalize-failed] name=${q.name || '-'} state=${q.state} runId=${runId || '-'}`
          );
        } else if (!isCurrentRun) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][uploadOne:skip-finalize-stale-run] name=${q && q.name ? q.name : '-'} runId=${runId || '-'} current=${state.runId || '-'}`
          );
        }

        persistQueueThrottled('uploadOne:finally');
      }
    }

    async function uploadSingleById(id) {
      healStaleUploadRunningLockIfNeeded('uploadSingleById');

      if (state.running) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][single-upload:restart-running]');
        cancelCurrentUploadRun('uploadSingleById-restart');
      }

      if (!id) {
        setStatus('未找到文件 ID');
        ToolboxShell.appendLog('[UPLOAD_DIAG][single-upload:missing-id]');
        return;
      }

      refreshQueueReadableState();
      await reconcileFailedItems();

      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('未找到要上传的文件');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][single-upload:not-found] id=${id} group=${getActiveGroupId() || '-'}`);
        render();
        return;
      }

      logUploadItemSource('single-upload:before-check', q);

      if (!hasAttemptableUploadSource(q)) {
        markMissingLocalFiles([q]);
        render();
        persistQueueInBackground('single-upload:missing-source');

        setStatus(`缺少文件，请重新拖入：${q.name || '-'}`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][single-upload:missing-source] id=${q.id || '-'} name=${q.name || '-'} sourceKind=${q.sourceKind || '-'}`,
        );
        return;
      }

      q.state = UploadState.IDLE;
      q.message = '';
      q.uploadName = '';
      q.persistedAttached = false;
      q.attachedInSession = false;
      q.updatedAt = Date.now();

      startDuplicateWatcher();

      state.running = true;
      state.cancelled = false;
      state.runId += 1;
      state.activeId = q.id;
      state.uploadAbortController = new AbortController();

      const runId = state.runId;
      const signal = state.uploadAbortController.signal;

      scheduleRenderUpload('single-upload:start');

      setStatus(`正在上传：${q.name || '-'}`, 'running');
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][single-upload:start] id=${q.id || '-'} name=${q.name || '-'} groupId=${q.groupId || '-'}`,
      );

      persistQueueThrottled('single-upload:before-upload');

      try {
        await uploadOne(q, 1, 1, {
          runId,
          signal,
        });

        if (state.cancelled || runId !== state.runId) {
          return;
        }

        let settledTargets = resolveUploadTargets([q]);

        settledTargets.forEach((item) => {
          if (item && isUploadUnfinishedState(item.state)) {
            updateItem(item.id, {
              state: UploadState.FAILED,
              message: '单文件上传流程结束时仍未完成',
            });
          }
        });

        await reconcileFailedItems();

        settledTargets = resolveUploadTargets([q]);

        const allAttached = settledTargets.every((item) => item && item.state === UploadState.ATTACHED);

        if (!allAttached) {
          await waitUntilComposerUploadIdle({
            runId,
            signal,
            timeoutMs: 3000,
          });
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);

        console.error('[ChatGPT toolbox] single upload failed', err);

        updateItem(q.id, {
          state: UploadState.FAILED,
          message: errText,
        });

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][single-upload:error] id=${q.id || '-'} name=${q.name || '-'} error=${errText}`,
        );
      } finally {
        stopDuplicateWatcher(3000);

        if (runId === state.runId || state.cancelled) {
          state.running = false;
          state.activeId = '';
          state.uploadAbortController = null;

          const settledTargets = resolveUploadTargets([q]);
          const result = countUploadResult(settledTargets);

          render();

          if (state.cancelled) {
            setStatus(`已停止上传：${q.name || '-'}`, 'warn');
          } else if (result.success > 0) {
            setStatus(`上传完成：${q.name || '-'}`, 'success');
          } else {
            setStatus(`上传失败：${q.name || '-'}`, 'error');
          }

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][single-upload:finalize] success=${result.success} failed=${result.failed} running=${state.running} id=${q.id || '-'} name=${q.name || '-'}`,
          );

          persistQueueInBackground('single-upload:finalize');
        }
      }
    }

    async function uploadSingleFromListClick(id) {
      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('未找到对应文件');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][single-click-upload:return-missing] id=${id || '-'}`);
        return;
      }

      if (!hasAttemptableUploadSource(q)) {
        q.state = UploadState.MISSING_FILE;
        q.message = '缺少文件，请重新拖入';
        q.updatedAt = Date.now();

        render();
        setStatus('缺少文件，请重新拖入');
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][single-click-upload:return-no-source] id=${id || '-'} name=${q.name || '-'}`,
        );
        return;
      }

      if (state.running) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][single-click-upload:restart-running]');
        cancelCurrentUploadRun('single-file-click-restart');
      }

      q.state = UploadState.IDLE;
      q.message = '';
      q.uploadName = '';
      q.persistedAttached = false;
      q.attachedInSession = false;
      q.updatedAt = Date.now();

      state.activeId = id;

      render();
      setStatus(`正在上传：${q.name || id}`, 'running');

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][single-click-upload:start] id=${id || '-'} name=${q.name || '-'}`,
      );

      await uploadSingleById(id);
    }

    function markMissingLocalFiles(items) {
      let changed = false;

      (items || []).forEach((q) => {
        if (!q) return;
        if (q.state === UploadState.ATTACHED) return;

        if (hasAttemptableUploadSource(q)) {
          if (q.state === UploadState.MISSING_FILE) {
            q.state = UploadState.IDLE;
            q.message = '';
            changed = true;
          }
          return;
        }

        q.state = UploadState.MISSING_FILE;
        q.sourceKind = 'missing-file';
        q.message = '缺少文件，请重新拖入';
        changed = true;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][startUpload:missing-file] name=${q.name || '-'} state=${q.state} size=${q.size || 0}`,
        );
      });

      return changed;
    }

    function hasActiveUploadInProgressOnQueue() {
      return state.queue.some((q) => q && isUploadUnfinishedState(q.state));
    }

    function isUploadRunActuallyActive() {
      if (!state.running) {
        return false;
      }

      if (state.uploadAbortController) {
        return true;
      }

      if (hasActiveUploadInProgressOnQueue()) {
        return true;
      }

      return false;
    }

    function healStaleUploadRunningLockIfNeeded(context) {
      if (!state.running) return false;
      if (hasActiveUploadInProgressOnQueue()) return false;
      if (state.uploadAbortController) return false;

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][heal-running-lock] ctx=${String(context || '-')} activeId=${state.activeId || '-'}`
      );

      state.running = false;
      state.cancelled = false;
      state.activeId = '';
      state.uploadAbortController = null;

      if (rootElRef) {
        renderUploadButtonsOnly();
      }

      return true;
    }

    function buildUploadSkipResult(reason, extra = {}) {
      return {
        success: 0,
        failed: 0,
        cancelled: false,
        total: 0,
        skipped: true,
        reason: String(reason || 'unknown'),
        ...extra,
      };
    }

    function buildUploadResult(success, failed, cancelled, total, extra = {}) {
      return {
        success: Number(success) || 0,
        failed: Number(failed) || 0,
        cancelled: !!cancelled,
        total: Number(total) || 0,
        skipped: false,
        ...extra,
      };
    }

    function cancelCurrentUploadRun(context) {
      const ctx = String(context || '-');
      ToolboxShell.appendLog(`[UPLOAD_DIAG][cancel-upload-run] ctx=${ctx} runId=${state.runId}`);

      state.cancelled = true;
      state.runId += 1;

      if (state.uploadAbortController) {
        state.uploadAbortController.abort();
        state.uploadAbortController = null;
      }

      if (state.activeId) {
        updateItem(state.activeId, {
          state: UploadState.CANCELLED,
          message: '上传已中断以便重新开始',
        });
      }

      state.running = false;
      state.activeId = '';
      if (isWaitingSendActive()) {
        cancelWaitingSend('upload-run-cancelled');
      } else {
        setWaitingSendActive(false);
        state.autoSendRunId += 1;
      }
    }

    function setWaitingSendActive(active) {
      const on = !!active;
      state.waitingSend = on;
      state.autoSendWaiting = on;
    }

    function isWaitingSendActive() {
      return !!(state.waitingSend || state.autoSendWaiting || uploadSendShortcutRunning);
    }

    function cancelWaitingSend(reason = 'user-click') {
      if (!isWaitingSendActive()) {
        return false;
      }

      state.cancelWaitingSend = true;
      setWaitingSendActive(false);
      state.autoSendRunId += 1;
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;

      if (state.waitingSendTimer) {
        clearTimeout(state.waitingSendTimer);
        state.waitingSendTimer = null;
      }

      if (state.waitingSendInterval) {
        clearInterval(state.waitingSendInterval);
        state.waitingSendInterval = null;
      }

      if (state.waitingSendAbortController) {
        try {
          state.waitingSendAbortController.abort();
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] cancel waiting send abort failed', err);
          ToolboxShell.appendLog(
            `[UPLOAD][WAIT_SEND][CANCEL][abort-error] reason=${reason} error=${errText}`,
          );
        }
        state.waitingSendAbortController = null;
      }

      ToolboxShell.appendLog(`[UPLOAD][WAIT_SEND][CANCEL] reason=${reason}`);
      setStatus('已取消等待发送');
      scheduleRenderUpload('wait-send:cancel');
      return true;
    }

    function claimWaitingSendRun(source, runId) {
      const id = Number(runId) || Date.now();

      state.cancelWaitingSend = false;
      state.autoSendRunId = id;
      setWaitingSendActive(true);
      uploadSendShortcutRunning = true;
      uploadSendTaskStartedAt = Date.now();
      scheduleRenderUpload(`wait-send:claim:${source || '-'}`);

      return id;
    }

    async function sendCurrentMessageFromUploadPanel(triggerSource, presetRunId) {
      const source = triggerSource || 'button';
      const usePresetRunId = presetRunId != null && Number(presetRunId) > 0;

      if (!usePresetRunId && !isWaitingSendActive()) {
        const capability = getUploadPageCapability();
        if (!capability.can_send_now) {
          const blockReason = !capability.hasComposer
            ? 'no-composer'
            : capability.isResponding
              ? 'assistant-busy'
              : 'send-not-ready';
          const blockMessage = !capability.hasComposer
            ? '未找到 ChatGPT 输入框'
            : capability.isResponding
              ? '助手正在回复，暂不可发送'
              : '当前页面暂不可发送';
          setStatus(blockMessage, 'warn');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:blocked] source=${source} reason=${blockReason}`,
          );
          scheduleRenderUpload('send-message:blocked');
          return false;
        }
      }

      const runId = usePresetRunId
        ? Number(presetRunId)
        : claimWaitingSendRun(source, Date.now());

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-message-button:click] source=${source} runId=${runId} queue=${state.queue.length} running=${state.running}`
      );

      try {
        setStatus('正在等待发送按钮...');

        const sendResult = await sendContentViaComposer({
          source,
          sendExistingComposer: true,
          waitUntilSendable: true,
          timeoutMs: SEND_WAIT_TIMEOUT_MS,
          blockWhenResponding: false,
        });

        if (sendResult.ok) {
          setStatus('已发送信息');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:sent] runId=${runId} reason=${sendResult.reason || '-'}`,
          );
          updateChatInputStateBadge();
          return true;
        }

        if (!state.cancelWaitingSend) {
          setStatus(`发送未完成：${sendResult.reason || 'unknown'}`);
        }
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:not-sent] runId=${runId} reason=${sendResult.reason || '-'} cancelled=${state.cancelWaitingSend ? '1' : '0'}`,
        );
        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send current message failed', err);
        setStatus(`发送信息失败：${errText}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][send-message-button:failed] runId=${runId} error=${errText}`);
        return false;
      } finally {
        if (state.autoSendRunId === runId) {
          resetUploadSendShortcutState('send-message-finally', runId);
        } else {
          uploadSendShortcutRunning = false;
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-shortcut:state-reset-skip-waiting] reason=runId-changed runId=${runId} autoSendRunId=${state.autoSendRunId}`
          );
          scheduleRenderUpload('send-message:finally-runid-changed');
        }
      }
    }

    function shouldIgnoreToolboxShortcutTarget(target) {
      const el = target instanceof Element ? target : null;
      if (!el) return false;
      const inToolbox = !!el.closest(`#${APP.rootId}`);
      if (!inToolbox) {
        return false;
      }
      return !!el.closest([
        'input',
        'textarea',
        'select',
        '[contenteditable="true"]',
        '[role="textbox"]',
      ].join(','));
    }

    function getShortcutTargetText(target) {
      const el = target instanceof Element ? target : null;
      if (!el) {
        return '-';
      }
      const parts = [el.tagName.toLowerCase()];
      if (el.id) {
        parts.push(`#${el.id}`);
      }
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).slice(0, 3).join('.');
        if (cls) {
          parts.push(`.${cls}`);
        }
      }
      return parts.join('');
    }

    function logUploadShortcutDebug(e, stage, extra) {
      const now = Date.now();
      if (now - uploadShortcutDebugLastAt < 120) {
        return;
      }
      uploadShortcutDebugLastAt = now;
      ToolboxShell.appendLog(
        `[SHORTCUT][${stage}] key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? '1' : '0'} alt=${e.altKey ? '1' : '0'} shift=${e.shiftKey ? '1' : '0'} meta=${e.metaKey ? '1' : '0'} repeat=${e.repeat ? '1' : '0'} target=${getShortcutTargetText(e.target)} extra=${extra || '-'}`
      );
    }

    function logShortcutDebug(e, stage, extra) {
      const now = Date.now();
      if (now - shortcutDebugLastAt < 250) {
        return;
      }
      shortcutDebugLastAt = now;
      const target = e && e.target instanceof Element
        ? `${e.target.tagName.toLowerCase()}${e.target.id ? `#${e.target.id}` : ''}${e.target.className ? `.${String(e.target.className).split(/\s+/).slice(0, 2).join('.')}` : ''}`
        : '-';
      ToolboxShell.appendLog(
        `[SHORTCUT][${stage}] key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? '1' : '0'} alt=${e.altKey ? '1' : '0'} shift=${e.shiftKey ? '1' : '0'} meta=${e.metaKey ? '1' : '0'} repeat=${e.repeat ? '1' : '0'} target=${target} extra=${extra || '-'}`
      );
    }

    function isCopyLastMessageShortcutEvent(e) {
      const cfg = getShortcutConfig();
      return isShortcutEventMatched(e, cfg.copyLastMessage);
    }

    function isUploadSendShortcutEvent(e) {
      const cfg = getShortcutConfig();
      return isShortcutEventMatched(e, cfg.sendMessage);
    }

    function resetUploadSendShortcutState(reason, runId) {
      uploadSendShortcutRunning = false;
      uploadSendTaskStartedAt = 0;
      if (runId == null || state.autoSendRunId === runId) {
        setWaitingSendActive(false);
        state.cancelWaitingSend = false;
      }
      scheduleRenderUpload(`send-shortcut-reset:${reason || '-'}`);
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-shortcut:state-reset] reason=${reason || '-'} runId=${runId || '-'} autoSendRunId=${state.autoSendRunId || '-'} waiting=${state.autoSendWaiting ? '1' : '0'}`
      );
    }

    function handleUploadSendShortcutKeydown(e, source) {
      if (!isUploadSendShortcutEvent(e)) {
        return false;
      }
      logUploadShortcutDebug(e, 'send-match', source || '-');
      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        logUploadShortcutDebug(e, 'send-ignore', 'repeat');
        return true;
      }
      if (shouldIgnoreToolboxShortcutTarget(e.target)) {
        logUploadShortcutDebug(e, 'send-ignore', 'target-in-toolbox-editable');
        return false;
      }
      if (shouldSkipGlobalShortcutForToolboxTarget(e.target)) {
        logUploadShortcutDebug(e, 'send-ignore', 'target-in-toolbox-non-editable');
        return false;
      }
      const now = Date.now();
      if (now - uploadSendShortcutLastAt < 800) {
        e.preventDefault();
        e.stopPropagation();
        logUploadShortcutDebug(e, 'send-ignore', 'too-fast');
        return true;
      }
      uploadSendShortcutLastAt = now;
      e.preventDefault();
      e.stopPropagation();
      if (isWaitingSendActive()) {
        const runningMs = uploadSendTaskStartedAt ? Date.now() - uploadSendTaskStartedAt : 0;
        if (runningMs > 30000 && !ComposerApi.isAssistantLikelyBusy()) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-shortcut:stale-reset] runningMs=${runningMs} waiting=${state.autoSendWaiting ? '1' : '0'}`
          );
          resetUploadSendShortcutState('stale-shortcut-auto-reset', state.autoSendRunId);
        } else {
          cancelWaitingSend('shortcut-click');
          return true;
        }
      }
      const runId = claimWaitingSendRun('shortcut', Date.now());
      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][send-shortcut:trigger] key=${e.key || '-'} code=${e.code || '-'} source=${source || '-'} runId=${runId}`
      );
      setStatus('快捷键触发：正在等待发送按钮', 'running');
      void sendCurrentMessageFromUploadPanel('shortcut', runId).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send shortcut failed', err);
        setStatus(`快捷键发送失败：${errText}`, 'error');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][send-shortcut:failed] error=${errText}`);
        resetUploadSendShortcutState('shortcut-catch', runId);
      });
      return true;
    }

    async function triggerSendHotkeyOnce() {
      setStatus('正在请求 GUI 发送 Ctrl+Alt+I', 'running');
      ToolboxShell.appendLog('[SYSTEM_HOTKEY][REQUEST] combo=ctrl+alt+i');

      try {
        const result = await BridgeModule.sendSystemHotkey('ctrl+alt+i');
        setStatus('已请求 GUI 发送 Ctrl+Alt+I', 'success');
        ToolboxShell.appendLog('[SYSTEM_HOTKEY][DONE] combo=ctrl+alt+i result=' + JSON.stringify(result).slice(0, 200));
        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[SYSTEM_HOTKEY][FAILED]', {
          error_type: err && err.name,
          error: errText,
          stack: err && err.stack,
        });
        setStatus(`GUI 快捷键失败：${errText}`, 'error');
        ToolboxShell.appendLog('[SYSTEM_HOTKEY][FAILED] error=' + errText);
        return false;
      }
    }

