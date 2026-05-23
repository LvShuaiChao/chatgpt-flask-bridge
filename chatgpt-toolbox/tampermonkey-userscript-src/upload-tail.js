    function bindUploadDelegatedClick(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        ToolboxShell.appendLog('[UPLOAD_UI_ACTION][bind-skip] reason=root-missing');
        return;
      }

      if (rootEl.dataset.uploadDelegatedClickBound === '1') {
        return;
      }

      rootEl.dataset.uploadDelegatedClickBound = '1';

      rootEl.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) {
          return;
        }

        const copyContinueBtn = target.closest('#cgpt-upload-continue-once');
        if (copyContinueBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof copyContinueBtn.blur === 'function') {
            copyContinueBtn.blur();
          }

          const busyState = clearStaleUploadButtonBusy(copyContinueBtn, {
            action: 'copy-continue',
            source: 'delegated-click',
          });
          if (busyState.skipped) {
            ToolboxShell.appendLog(
              `[UPLOAD_UI_ACTION][skip] action=copy-continue reason=button-busy busyMs=${busyState.busyMs}`,
            );
            return;
          }

          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-continue');
          runUploadUiAction('copy-continue', copyContinueBtn, 'delegated-click', e);
          return;
        }

        const copyBtn = target.closest('#cgpt-copy-last-message-scroll-bottom');
        if (copyBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof copyBtn.blur === 'function') {
            copyBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-last-reply');
          runUploadActionPromise(
            copyLastReplyWithState('delegated-click'),
            '复制最后回复',
          );
          return;
        }

        const sendBtn = target.closest('#cgpt-upload-start-send');
        if (sendBtn) {
          if (typeof sendBtn.blur === 'function') {
            sendBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=send-message');
          runUploadUiAction('send-message', sendBtn, 'delegated-click', e);
          return;
        }

        const uploadBtn = target.closest('#cgpt-upload-start');
        if (uploadBtn) {
          if (typeof uploadBtn.blur === 'function') {
            uploadBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=start-upload');
          runUploadUiAction('start-upload', uploadBtn, 'delegated-click', e);
          return;
        }

        const sendHotkeyBtn = target.closest('#cgpt-send-hotkey-once');
        if (sendHotkeyBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof sendHotkeyBtn.blur === 'function') {
            sendHotkeyBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=send-hotkey');
          runUploadActionPromise(triggerSendHotkeyOnce(), '发送 Ctrl+Alt+I');
          return;
        }

        const autoContinueBtn = target.closest('#cgpt-auto-continue-once');
        if (autoContinueBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof autoContinueBtn.blur === 'function') {
            autoContinueBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=auto-continue');
          runUploadActionPromise((async () => {
            if (!AutoQueueModule || typeof AutoQueueModule.triggerContinueOnce !== 'function') {
              setStatus('自动继续模块不可用', 'warn');
              return false;
            }
            return AutoQueueModule.triggerContinueOnce();
          })(), '自动继续');
          return;
        }

        const copyHotkeyContinueOnceBtn = target.closest('#cgpt-copy-hotkey-continue-once');
        if (copyHotkeyContinueOnceBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof copyHotkeyContinueOnceBtn.blur === 'function') {
            copyHotkeyContinueOnceBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-hotkey-continue-once');
          runUploadActionPromise(
            copyHotkeyAndContinueOnce('delegated-click'),
            '复制+快捷键+继续',
          );
          return;
        }

        const copyHotkeyContinueLoopBtn = target.closest('#cgpt-copy-hotkey-continue-loop');
        if (copyHotkeyContinueLoopBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof copyHotkeyContinueLoopBtn.blur === 'function') {
            copyHotkeyContinueLoopBtn.blur();
          }
          ToolboxShell.appendLog('[UPLOAD_UI_ACTION][event] source=delegated-click action=copy-hotkey-continue-loop');
          runUploadActionPromise(
            toggleCopyHotkeyContinueLoop('delegated-click'),
            '连续复制+快捷键+继续',
          );
          return;
        }
      }, true);
    }

    function runUploadActionPromise(promise, actionName) {
      Promise.resolve(promise).catch((err) => {
        const errName = err && err.name ? err.name : 'Error';
        const errText = err && err.message ? err.message : String(err);

        console.error(`[ChatGPT toolbox] upload action failed: ${actionName}`, err);

        setStatus(`${actionName}失败：${errText}`, 'error');

        ToolboxShell.appendLog(
          `[UPLOAD_ACTION][FAILED] action=${actionName} type=${errName} error=${errText}`,
        );
      });
    }

    function bindEvents(rootEl) {
      if (!(rootEl instanceof HTMLElement)) {
        return;
      }

      if (rootEl.dataset.uploadEventsBound === '1') {
        bindUploadDropTargets(rootEl);
        bindUploadSendShortcut();
        bindCopyLastMessageShortcut();
        bindUploadStartShortcut();
        bindShortcutWindowFallback();
        bindUploadDelegatedClick(rootEl);
        bindUploadCompactActionButtons(rootEl);
        applyUploadShortcutButtonTitles(rootEl);
        return;
      }

      rootEl.dataset.uploadEventsBound = '1';

      const uploadStartBtn = qs('#cgpt-upload-start', rootEl);
      if (!uploadStartBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-start');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-btn]');
      }

      const uploadStartSendBtn = qs(UploadSelectors.startSendBtn, rootEl);
      if (!uploadStartSendBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-start-send');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-send-btn]');
      }

      const copyContinueBtn = qs(UploadSelectors.copyContinueBtn, rootEl);
      if (!copyContinueBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-continue-once');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-copy-continue-btn]');
      }

      const copyLastMessageBtn = qs('#cgpt-copy-last-message-scroll-bottom', rootEl);

      if (!copyLastMessageBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-copy-last-message-scroll-bottom');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-copy-last-message-btn]');
      }

      const addInlineBtn = qs('#cgpt-upload-group-add-inline', rootEl);
      if (addInlineBtn) {
        addInlineBtn.addEventListener('click', () => {
          runUploadActionPromise(createGroupInline(), '新建分组');
        });
      }

      const groupManageBtn = qs('#cgpt-upload-group-manage', rootEl);
      if (!groupManageBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-manage');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-manage-btn]');
      } else {
        groupManageBtn.addEventListener('click', () => {
          toggleGroupManagePanel();
        });
      }

      const groupRenameBtn = qs('#cgpt-upload-group-rename-inline', rootEl);
      if (!groupRenameBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-rename-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-rename-btn]');
      } else {
        groupRenameBtn.addEventListener('click', () => {
          runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        });
      }

      if (groupNameInputEl) {
        groupNameInputEl.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          e.stopPropagation();

          runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        });

        groupNameInputEl.addEventListener('blur', () => {
          const text = String(groupNameInputEl.value || '').trim();

          if (!text) return;
          if (text === lastGroupNameInputValue) return;

          runUploadActionPromise(renameActiveGroupInline(), '重命名分组');
        });
      }

      const groupClearBtn = qs('#cgpt-upload-group-clear-inline', rootEl);
      if (!groupClearBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-clear-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-clear-btn]');
      } else {
        groupClearBtn.addEventListener('click', (e) => {
          runUploadActionPromise(clearActiveGroupQueueInline(e.currentTarget), '清空当前分组');
        });
      }

      const groupDeleteBtn = qs('#cgpt-upload-group-delete-inline', rootEl);
      if (!groupDeleteBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-group-delete-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-delete-btn]');
      } else {
        groupDeleteBtn.addEventListener('click', (e) => {
          runUploadActionPromise(deleteActiveGroupInline(e.currentTarget), '删除当前分组');
        });
      }

      const blobPersistEl = qs('#cgpt-upload-blob-persist-inline', rootEl);
      if (!blobPersistEl) {
        console.error('[ChatGPT toolbox] bindEvents: 缺少 #cgpt-upload-blob-persist-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-blob-persist-el]');
      } else {
        blobPersistEl.addEventListener('change', async (e) => {
        const checked = !!e.target.checked;
        MemoryManager.set(MemoryManager.KEYS.uploadBlobPersistEnabled, checked);

        try {
          await schedulePersistQueue();
          setStatus(checked
            ? '已开启：小文件内容已尝试保存IndexedDB'
            : '已关闭：仅保存文件句柄与元数据');
          ToolboxShell.appendLog(checked
            ? '已开启文件内容本地保存，并已重新保存当前队列'
            : '已关闭文件内容本地保存');
        } catch (err) {
          console.error('[ChatGPT toolbox] persist queue after blob switch failed', err);
          setStatus('保存文件内容开关已变更，但队列保存失败，请看控制台');
        }
        });
      }

      const uniqueNameEl = qs('#cgpt-upload-use-unique-name-inline', rootEl);

      if (uniqueNameEl) {
        uniqueNameEl.addEventListener('change', (e) => {
          const checked = !!e.target.checked;

          setUploadUseUniqueFileNameEnabled(checked);

          setStatus(
            checked
              ? '已开启：上传前重命名（时间戳 + 序号）'
              : '已关闭：上传时保留原文件名',
          );
          ToolboxShell.appendLog(
            checked
              ? '已开启上传前重命名（时间戳 + 序号）'
              : '已关闭上传前重命名，上传时保留原文件名',
          );
        });
      }

      groupListEl.addEventListener('click', async (e) => {
        const btn = e.target instanceof HTMLElement
          ? e.target.closest('.cgpt-upload-group-chip[data-group-id]')
          : null;

        if (!btn) return;

        const groupId = btn.getAttribute('data-group-id');
        if (!groupId) return;

        try {
          await switchGroup(groupId, {
            source: 'user',
            saveGlobalFallback: true,
            savePageState: true,
            saveLastManual: true,
            reason: 'user-switch-upload-group',
          });
        } catch (err) {
          const errName = err && err.name ? err.name : 'Error';
          const errText = err && err.message ? err.message : String(err);

          console.error('[ChatGPT toolbox] group chip switch failed', err);

          setStatus(`切换分组失败：${errText}`, 'error');

          ToolboxShell.appendLog(
            `[UPLOAD_GROUP][chip-switch:failed] groupId=${groupId || '-'} type=${errName} error=${errText}`,
          );
        }
      });

      if (manageGroupListEl) {
        manageGroupListEl.addEventListener('click', async (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('.cgpt-upload-manage-group-item[data-group-id]')
            : null;

          if (!btn) return;

          const groupId = btn.getAttribute('data-group-id');
          if (!groupId) return;

          try {
            const currentText = groupNameInputEl ? String(groupNameInputEl.value || '').trim() : '';
            const currentGroup = getActiveGroup();

            if (currentGroup && currentText && currentText !== currentGroup.name) {
              await renameActiveGroupInline();
            }

            await switchGroup(groupId, {
              source: 'user',
              saveGlobalFallback: true,
              savePageState: true,
              saveLastManual: true,
              reason: 'user-switch-upload-group',
            });
            syncGroupManagePanel({
              force: true,
            });
          } catch (err) {
            const errName = err && err.name ? err.name : 'Error';
            const errText = err && err.message ? err.message : String(err);

            console.error('[ChatGPT toolbox] manage group switch failed', err);

            setStatus(`管理列表切换分组失败：${errText}`, 'error');

            ToolboxShell.appendLog(
              `[UPLOAD_GROUP][manage-switch:failed] groupId=${groupId || '-'} type=${errName} error=${errText}`,
            );
          }
        });
      }

      listEl.addEventListener('click', async (e) => {
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (!target) return;

        const removeBtn = target.closest('[data-upload-remove-id]');

        if (removeBtn) {
          e.preventDefault();
          e.stopPropagation();

          const id = removeBtn.getAttribute('data-upload-remove-id');
          if (!id) return;

          try {
            await removeFileFromCurrentGroup(id);
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.error('[ChatGPT toolbox] remove file from current group failed', err);
            ToolboxShell.appendLog(`[UPLOAD_DIAG][remove-file:failed] id=${id || '-'} error=${errText}`);
            setStatus(`移除文件失败：${errText}`);
          }

          return;
        }

        const rebindBtn = target.closest('[data-upload-rebind-id]');

        if (rebindBtn) {
          e.preventDefault();
          e.stopPropagation();

          const id = rebindBtn.getAttribute('data-upload-rebind-id');
          if (!id) return;

          try {
            await rebindUploadFile(id);
          } catch (err) {
            const errName = err && err.name ? err.name : 'Error';
            const errText = err && err.message ? err.message : String(err);

            console.error('[ChatGPT toolbox] rebind upload file failed', err);

            setStatus(`重新绑定文件失败：${errText}`, 'error');

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][rebind-file:failed] id=${id || '-'} type=${errName} error=${errText}`,
            );
          }

          return;
        }

        const itemEl = target.closest('.cgpt-upload-item[data-id]');

        if (!itemEl) return;
        if (itemEl.classList.contains('empty')) return;

        const id = itemEl.getAttribute('data-id');
        if (!id) return;

        const q = getActiveGroupFiles().find((item) => item && item.id === id);
        if (!q) {
          setStatus('未找到对应文件');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][upload-list-click:missing-item] id=${id || '-'} group=${getActiveGroupId() || '-'}`);
          return;
        }

        setSelectedFileIdForActiveGroup(id, { reason: 'upload-list-click' });
        renderUploadListOnly();
        renderUploadButtonsOnly();

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-list-click:select] id=${id || '-'} name=${q.name || '-'} group=${getActiveGroupId() || '-'}`,
        );
      });

      const quickPromptBox = qs('#cgpt-upload-quick-prompts', rootEl);
      if (quickPromptBox) {
        quickPromptBox.addEventListener('click', async (e) => {
          const target = e.target instanceof HTMLElement ? e.target : null;
          if (!target) return;

          const categoryBtn = target.closest('[data-upload-quick-prompt-category]');
          if (categoryBtn) {
            e.preventDefault();
            e.stopPropagation();

            const category = categoryBtn.getAttribute('data-upload-quick-prompt-category') || '全部';
            saveQuickPromptActiveCategory(category, {
              reason: 'quick-category-click',
            });

            ToolboxShell.appendLog(`[UPLOAD_DIAG][quick-prompt:category] ${category}`);

            renderUploadQuickPrompts();
            return;
          }

          const promptBtn = target.closest('[data-upload-quick-prompt-id]');
          if (!promptBtn) return;

          e.preventDefault();
          e.stopPropagation();

          const id = promptBtn.getAttribute('data-upload-quick-prompt-id');
          const prompts = typeof PromptManagerModule !== 'undefined' && typeof PromptManagerModule.getPrompts === 'function'
            ? PromptManagerModule.getPrompts()
            : [];

          const prompt = prompts.find((p) => p.id === id);

          if (!prompt) {
            setStatus('未找到对应 Prompt');
            return;
          }

          await sendOrFillQuickPrompt(prompt);
        });
      }

      bindUploadDropTargets(rootEl);
      bindUploadSendShortcut();
      bindCopyLastMessageShortcut();
      bindUploadStartShortcut();
      bindShortcutWindowFallback();
      bindUploadDelegatedClick(rootEl);
      bindUploadCompactActionButtons(rootEl);
      applyUploadShortcutButtonTitles(rootEl);
    }

    function ensureUploadGroupSection(rootEl) {
      if (!rootEl) {
        return;
      }

      let groupsHead = rootEl.querySelector('.cgpt-upload-groups-head');
      let groupList = rootEl.querySelector('#cgpt-upload-group-list');

      if (groupsHead && groupList) {
        groupsHead.id = 'cgpt-toolbox-project-stats-row';
        return;
      }

      const actionRow = rootEl.querySelector('.cgpt-upload-action-row');

      groupsHead = document.createElement('div');
      groupsHead.className = 'cgpt-upload-groups-head';
      groupsHead.id = 'cgpt-toolbox-project-stats-row';
      groupsHead.innerHTML = `
        <div class="cgpt-upload-group-bar">
          <div class="cgpt-upload-group-list" id="cgpt-upload-group-list"></div>
          <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">管理</button>
        </div>
      `;

      if (actionRow && actionRow.parentNode) {
        actionRow.parentNode.insertBefore(groupsHead, actionRow);
      } else {
        rootEl.insertBefore(groupsHead, rootEl.firstChild);
      }

      ToolboxShell.appendLog('[UPLOAD_GROUP_UI][ENSURE_GROUP_SECTION_INSERTED]');
    }

    function ensureToolboxPageStatusRow(rootEl) {
      if (rootEl) {
        const legacyRows = rootEl.querySelectorAll(
          '#cgpt-toolbox-page-status-row, .cgpt-toolbox-top-status-row, .cgpt-toolbox-page-status-row',
        );
        legacyRows.forEach((row) => {
          if (!row.closest('.cgpt-toolbox-header')) {
            row.remove();
          }
        });

        const legacyStatusCounts = qs('#cgpt-upload-status-counts', rootEl);
        if (legacyStatusCounts) {
          legacyStatusCounts.remove();
        }

        const groupsHead = qs('.cgpt-upload-groups-head', rootEl);
        if (groupsHead && !groupsHead.id) {
          groupsHead.id = 'cgpt-toolbox-project-stats-row';
        }
      }

      if (
        typeof ToolboxShell !== 'undefined'
        && typeof ToolboxShell.ensureToolboxHeaderPageStatusRow === 'function'
      ) {
        ToolboxShell.ensureToolboxHeaderPageStatusRow();
      }
    }

    function ensureUploadActionButtons(rootEl) {
      const actionRow = qs('.cgpt-upload-action-row', rootEl);
      const copyLastBtn = qs(UploadSelectors.copyLastMessageBtn, actionRow);
      if (!actionRow || !copyLastBtn) {
        return;
      }

      let sendHotkeyBtn = qs(UploadSelectors.sendHotkeyBtn, actionRow);
      if (!sendHotkeyBtn) {
        sendHotkeyBtn = document.createElement('button');
        sendHotkeyBtn.type = 'button';
        sendHotkeyBtn.className = 'cgpt-btn warning';
        sendHotkeyBtn.id = 'cgpt-send-hotkey-once';
        sendHotkeyBtn.textContent = '发送 Ctrl+Alt+I';
        actionRow.insertBefore(sendHotkeyBtn, copyLastBtn);
      }

      let autoContinueBtn = qs(UploadSelectors.autoContinueBtn, actionRow);
      if (!autoContinueBtn) {
        autoContinueBtn = document.createElement('button');
        autoContinueBtn.type = 'button';
        autoContinueBtn.className = 'cgpt-btn teal';
        autoContinueBtn.id = 'cgpt-auto-continue-once';
        autoContinueBtn.textContent = '自动继续';
        actionRow.insertBefore(autoContinueBtn, copyLastBtn);
      }

      actionRow.insertBefore(autoContinueBtn, copyLastBtn);
      actionRow.insertBefore(sendHotkeyBtn, autoContinueBtn);

      let copyHotkeyContinueOnceBtn = qs(UploadSelectors.copyHotkeyContinueOnceBtn, actionRow);
      if (!copyHotkeyContinueOnceBtn) {
        copyHotkeyContinueOnceBtn = document.createElement('button');
        copyHotkeyContinueOnceBtn.type = 'button';
        copyHotkeyContinueOnceBtn.className = 'cgpt-btn purple';
        copyHotkeyContinueOnceBtn.id = 'cgpt-copy-hotkey-continue-once';
        copyHotkeyContinueOnceBtn.textContent = '复制+快捷键+继续';
        copyLastBtn.insertAdjacentElement('afterend', copyHotkeyContinueOnceBtn);
      }

      let copyHotkeyContinueLoopBtn = qs(UploadSelectors.copyHotkeyContinueLoopBtn, actionRow);
      if (!copyHotkeyContinueLoopBtn) {
        copyHotkeyContinueLoopBtn = document.createElement('button');
        copyHotkeyContinueLoopBtn.type = 'button';
        copyHotkeyContinueLoopBtn.className = 'cgpt-btn cyan';
        copyHotkeyContinueLoopBtn.id = 'cgpt-copy-hotkey-continue-loop';
        copyHotkeyContinueLoopBtn.textContent = '连续复制+快捷键+继续';
        copyHotkeyContinueLoopBtn.title = '循环执行：等待回答完成 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续';
        copyHotkeyContinueOnceBtn.insertAdjacentElement('afterend', copyHotkeyContinueLoopBtn);
      }

      if (copyHotkeyContinueOnceBtn.compareDocumentPosition(copyLastBtn) & Node.DOCUMENT_POSITION_FOLLOWING) {
        copyLastBtn.insertAdjacentElement('afterend', copyHotkeyContinueOnceBtn);
      }
      if (copyHotkeyContinueLoopBtn.compareDocumentPosition(copyHotkeyContinueOnceBtn) & Node.DOCUMENT_POSITION_FOLLOWING) {
        copyHotkeyContinueOnceBtn.insertAdjacentElement('afterend', copyHotkeyContinueLoopBtn);
      }
    }

    function bindUploadCompactActionButtons(rootEl) {
      DomUtil.bindClick(rootEl, UploadSelectors.sendHotkeyBtn, async () => {
        try {
          await triggerSendHotkeyOnce();
        } catch (error) {
          console.error('[SEND_HOTKEY][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`发送 Ctrl+Alt+I 失败：${error && error.message ? error.message : error}`, 'error');
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.autoContinueBtn, async () => {
        try {
          if (!AutoQueueModule || typeof AutoQueueModule.triggerContinueOnce !== 'function') {
            setStatus('自动继续模块不可用', 'warn');
            return;
          }
          await AutoQueueModule.triggerContinueOnce();
        } catch (error) {
          console.error('[AUTO_CONTINUE][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`自动继续失败：${error && error.message ? error.message : error}`, 'error');
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.copyHotkeyContinueOnceBtn, async () => {
        try {
          await copyHotkeyAndContinueOnce('bindClick');
        } catch (error) {
          console.error('[COPY_HOTKEY_CONTINUE][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`复制+快捷键+继续失败：${error && error.message ? error.message : error}`, 'error');
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.copyHotkeyContinueLoopBtn, async () => {
        try {
          await toggleCopyHotkeyContinueLoop('bindClick');
        } catch (error) {
          console.error('[COPY_HOTKEY_CONTINUE_LOOP][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`连续复制+快捷键+继续失败：${error && error.message ? error.message : error}`, 'error');
        }
      }, 'UPLOAD');
    }

    function validateUploadDomStructure(rootEl) {
      validateDomRules(rootEl, [
        {
          type: 'required',
          selector: '#cgpt-copy-last-message-scroll-bottom',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-last-message-scroll-bottom',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-copy-last-message-scroll-bottom',
          message: '复制最后回复按钮被错误放进管理面板',
          invalidLog: '[UPLOAD_DOM][invalid] 复制最后回复按钮被错误放进管理面板',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-start',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-start-send',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-upload-continue-once',
        },
        {
          type: 'required',
          selector: '#cgpt-send-hotkey-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-send-hotkey-once',
        },
        {
          type: 'required',
          selector: '#cgpt-auto-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-auto-continue-once',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-list',
        },
        {
          type: 'required',
          selector: '#cgpt-upload-group-list',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-upload-group-list',
        },
        {
          type: 'order',
          before: '#cgpt-upload-group-list',
          after: '#cgpt-upload-start',
          message: '项目分组栏应位于开始上传按钮之前',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-start',
          message: '上传按钮被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-start-send',
          message: '发送信息按钮被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-continue-once',
          message: '复制并继续按钮被错误放进管理面板',
          invalidLog: '[UPLOAD_DOM][invalid] 复制并继续按钮被错误放进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-list',
          message: '上传列表被错误包进管理面板',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-quick-prompts',
          message: '常用 Prompt 被错误包进管理面板',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start',
          after: '#cgpt-upload-list',
          message: '上传文件列表应位于上传按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-list',
          after: '#cgpt-upload-quick-prompts',
          message: '常用 Prompt 应位于上传文件列表之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start-send',
          after: '#cgpt-upload-continue-once',
          message: '复制并继续按钮应位于发送信息按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-upload-continue-once',
          after: '#cgpt-send-hotkey-once',
          message: '发送 Ctrl+Alt+I按钮应位于复制并继续按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-send-hotkey-once',
          after: '#cgpt-auto-continue-once',
          message: '自动继续按钮应位于发送 Ctrl+Alt+I按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-auto-continue-once',
          after: '#cgpt-copy-last-message-scroll-bottom',
          message: '复制最后回复按钮应位于自动继续按钮之后',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-continue-once',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-once',
        },
        {
          type: 'required',
          selector: '#cgpt-copy-hotkey-continue-loop',
          missingLog: '[UPLOAD_DOM][missing] #cgpt-copy-hotkey-continue-loop',
        },
        {
          type: 'order',
          before: '#cgpt-copy-last-message-scroll-bottom',
          after: '#cgpt-copy-hotkey-continue-once',
          message: '复制+快捷键+继续按钮应位于复制最后回复按钮之后',
        },
        {
          type: 'order',
          before: '#cgpt-copy-hotkey-continue-once',
          after: '#cgpt-copy-hotkey-continue-loop',
          message: '连续复制+快捷键+继续按钮应位于复制+快捷键+继续按钮之后',
        },
      ], {
        moduleName: 'UPLOAD',
      });
    }

    async function applyToolboxPageState(pageState, reason = '') {
      if (!pageState || typeof pageState !== 'object') {
        return;
      }

      const shouldApplyDefaults = reason === 'init' || reason === 'route-key-changed';
      const shouldRestoreUploadGroup =
        shouldApplyDefaults || reason === 'upload-groups-ready';
      const toolboxRouteKey = getToolboxRouteKey();
      const reasonText = reason || '-';

      let targetGroupId = '';
      let source = '';

      if (shouldRestoreUploadGroup) {
        const preferred = resolvePreferredUploadGroupId(pageState, reason);
        targetGroupId = preferred.groupId;
        source = preferred.source;

        const pageGroupId = resolvePageUploadGroupId(pageState);

        if (pageGroupId && !preferred.groupId) {
          ToolboxShell.appendLog(
            `[UPLOAD_PAGE_STATE][restore-group-missing] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${pageGroupId}`,
          );
        }
      } else {
        targetGroupId = String(readToolboxStateField(pageState, 'uploadActiveGroupId', '')).trim();

        if (targetGroupId && state.groups.some((g) => g.id === targetGroupId)) {
          source = 'page';
        } else {
          targetGroupId = '';
          source = '';
        }
      }

      if (!targetGroupId) {
        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][restore-group-skip] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} noTarget=1`,
        );
      } else {
        if (targetGroupId !== state.activeGroupId) {
          await switchGroup(targetGroupId, {
            savePageState: source !== 'page',
            saveLastManual: false,
            saveGlobalFallback: false,
            reason: `restore-page-state:${source}`,
          });
        }

        ToolboxShell.appendLog(
          `[UPLOAD_PAGE_STATE][restore-group] reason=${reasonText} toolboxRouteKey=${toolboxRouteKey} groupId=${targetGroupId || '-'} source=${source}`,
        );

        if (source === 'last-manual' || source === 'first') {
          saveCurrentToolboxBaseState(`restore-upload-group:${source}`);
        }
      }

      const category = String(readToolboxStateField(pageState, 'quickPromptCategory', '')).trim();

      if (category) {
        saveQuickPromptActiveCategory(category, {
          savePageState: false,
          reason: 'restore-page-state',
        });
        renderUploadQuickPrompts();
      } else if (shouldApplyDefaults) {
        saveQuickPromptActiveCategory('全部', {
          savePageState: false,
          reason: 'restore-page-state-default',
        });
        renderUploadQuickPrompts();
      }
    }

    function restoreUploadDomRefs(rootEl) {
      ensureUploadGroupSection(rootEl);

      host = host || (rootEl && rootEl.parentElement) || null;
      rootElRef = rootEl;
      panelDropEl = document.getElementById(APP.panelId);
      listEl = qs(UploadSelectors.list, rootEl);
      groupListEl = qs('#cgpt-upload-group-list', rootEl);
      managePanelEl = qs('#cgpt-upload-manage-panel', rootEl);
      manageGroupListEl = qs('#cgpt-upload-manage-group-list', rootEl);
      groupNameInputEl = qs('#cgpt-upload-group-name-input', rootEl);
      startBtn = qs(UploadSelectors.startBtn, rootEl);
    }

    function runUploadModuleInitPipeline(rootEl, reason = 'mount') {
      safeAppendLog('[UPLOAD_UI][ADD_FILE_BUTTON_REMOVED] \u624b\u52a8\u6dfb\u52a0\u6587\u4ef6\u6309\u94ae\u5df2\u4ece\u4e3b\u754c\u9762\u79fb\u9664\uff0c\u5f00\u59cb\u4e0a\u4f20\u5c06\u4f7f\u7528\u73b0\u6709\u6587\u4ef6\u8bb0\u5f55\u3002');
      uploadGroupsInitResolved = false;
      ensureToolboxPageStatusRow(rootEl);
      ensureUploadGroupSection(rootEl);
      ensureUploadActionButtons(rootEl);
      validateUploadDomStructure(rootEl);
      bindEvents(rootEl);

      return loadGroups()
        .then(() => refreshUploadGroupCounts())
        .then(() => loadQueueForActiveGroup())
        .then(() => render())
        .then(() => applyToolboxPageState(getToolboxPageState(), 'upload-groups-ready'))
        .then(() => {
          uploadGroupsInitResolved = true;
          ensureActiveUploadGroupIdValid('init-pipeline-complete');
          syncUploadGroupAppState();
          appendUploadGroupLog('INIT', { stage: 'pipeline-complete', reason: reason || '-' });
        })
        .catch((err) => {
          const errName = err && err.name ? err.name : 'Error';
          const errText = err && err.message ? err.message : String(err);
          const errStack = err && err.stack ? err.stack : errText;
          console.error('[ChatGPT toolbox] init upload groups failed', err);
          setStatus(`上传队列初始化失败：${errText}`, 'error');
          ToolboxShell.appendLog(
            `[UPLOAD_INIT][FAILED] reason=${reason || '-'} stage=loadGroups-refreshCounts-loadQueue-render type=${errName} error=${errStack}`,
          );
          uploadGroupsInitResolved = true;
          ensureActiveUploadGroupIdValid('init-pipeline-failed');
          syncUploadGroupAppState();
          appendUploadGroupLog('INIT', { stage: 'pipeline-failed', reason: reason || '-' });
          render();
          throw err;
        });
    }

    function mount(targetHost) {
      if (!targetHost) {
        console.error('[ChatGPT toolbox] UploadModule.mount: targetHost 为空');
        ToolboxShell.appendLog('[UPLOAD][mount-failed] targetHost empty');
        uploadModuleInitPromise = Promise.resolve();
        return uploadModuleInitPromise;
      }

      const existed = targetHost.querySelector('#cgpt-upload-module');
      if (existed) {
        host = targetHost;
        restoreUploadDomRefs(existed);
        ToolboxShell.appendLog('[UPLOAD][mount-reuse-dom] rebind refs and reinit groups');
        uploadModuleInitPromise = runUploadModuleInitPipeline(existed, 'mount-reuse-dom');
        return uploadModuleInitPromise;
      }

      host = targetHost;

      const rootEl = document.createElement('div');
      rootEl.id = 'cgpt-upload-module';
      rootEl.innerHTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">多文件上传</div>
          <div class="cgpt-upload-groups-head" id="cgpt-toolbox-project-stats-row">
            <div class="cgpt-upload-group-bar">
              <div class="cgpt-upload-group-list" id="cgpt-upload-group-list"></div>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">管理</button>
            </div>
          </div>
          <div class="cgpt-upload-manage-panel cgpt-toolbox-hidden" id="cgpt-upload-manage-panel">
            <div class="cgpt-upload-manage-title">文件组管理</div>

            <div class="cgpt-upload-manage-layout">
              <div class="cgpt-upload-manage-left">
                <div class="cgpt-upload-manage-subtitle-row">
                  <span>全部分组</span>
                  <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-add-inline">新建</button>
                </div>
                <div class="cgpt-upload-manage-group-list" id="cgpt-upload-manage-group-list"></div>
              </div>

              <div class="cgpt-upload-manage-right">
                <div class="cgpt-upload-manage-subtitle">当前分组</div>

                <div class="cgpt-upload-manage-row">
                  <input class="cgpt-input" id="cgpt-upload-group-name-input" placeholder="当前分组名称">
                  <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-rename-inline">保存名称</button>
                </div>

                <div class="cgpt-upload-manage-row">
                  <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-clear-inline">清空当前组</button>
                  <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-delete-inline">删除当前组</button>
                </div>

                <div class="cgpt-hint">这里只管理当前文件组，不会自动上传到 ChatGPT。</div>
              </div>
            </div>

            <div class="cgpt-upload-common-settings">
              <div class="cgpt-upload-manage-subtitle">公共上传设置</div>

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-blob-persist-inline">
                保存小文件内容到 IndexedDB
              </label>

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-use-unique-name-inline">
                上传时加时间戳+序号（仅内存，例：…_20260523_200319_01.zip）
              </label>

              <div class="cgpt-hint">这些设置对所有文件组生效。</div>
            </div>
          </div>
          <div class="cgpt-row cgpt-upload-action-row">
            <button type="button" class="cgpt-btn success" id="cgpt-upload-start">开始上传</button>
            <button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send">发送信息</button>
            <button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" title="先复制最后回复，再发送“继续”">复制并继续</button>
            <button type="button" class="cgpt-btn warning" id="cgpt-send-hotkey-once">发送 Ctrl+Alt+I</button>
            <button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-once">自动继续</button>
            <button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom">复制最后回复</button>
            <button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" title="复制最后回复 -> 发送 Ctrl+Alt+I -> 发送继续">复制+快捷键+继续</button>
            <button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" title="循环执行：等待回答完成 -> 复制最后回复 -> Ctrl+Alt+I -> 发送继续">连续复制+快捷键+继续</button>
          </div>

          <div class="cgpt-upload-list" id="cgpt-upload-list"></div>

          <div id="cgpt-upload-quick-prompts" class="cgpt-upload-quick-prompts">
            <div class="cgpt-upload-quick-prompts-title">常用 Prompt</div>
            <div class="cgpt-upload-quick-prompt-groups" id="cgpt-upload-quick-prompt-groups"></div>
            <div class="cgpt-upload-quick-prompts-list" id="cgpt-upload-quick-prompts-list"></div>
          </div>
        </div>
      `;

      targetHost.appendChild(rootEl);

      rootElRef = rootEl;

      panelDropEl = document.getElementById(APP.panelId);

      listEl = qs(UploadSelectors.list, rootEl);
      groupListEl = qs('#cgpt-upload-group-list', rootEl);
      managePanelEl = qs('#cgpt-upload-manage-panel', rootEl);
      manageGroupListEl = qs('#cgpt-upload-manage-group-list', rootEl);
      groupNameInputEl = qs('#cgpt-upload-group-name-input', rootEl);
      startBtn = qs(UploadSelectors.startBtn, rootEl);

      uploadModuleInitPromise = runUploadModuleInitPipeline(rootEl, 'mount-new-dom');

      return uploadModuleInitPromise;
    }

    function getUploadStatus() {
      const activeFiles = getActiveGroupFiles();
      return {
        groupCount: state.groups.length,
        activeGroupId: state.activeGroupId,
        activeGroupName: getActiveGroupName(),
        selectedFileId: getSelectedFileIdForActiveGroup(),
        total: activeFiles.length,
        attached: activeFiles.filter((q) => q && q.state === UploadState.ATTACHED).length,
        failed: activeFiles.filter(isUploadFailedState).length,
        missing: activeFiles.filter((q) => q && q.state === UploadState.MISSING_FILE).length,
        running: state.running,
      };
    }

    function getUploadInitPromise() {
      return uploadModuleInitPromise || Promise.resolve();
    }

    async function startUploadFromBridge(payload = {}) {
      const source = String(payload.source || 'bridge_command').trim() || 'bridge_command';
      const result = await handleStartUploadClick(source);
      const status = getUploadStatus();
      const finalResult = {
        ...(result || {}),
        upload_status: status,
      };

      ToolboxShell.appendLog(
        `[BRIDGE][UPLOAD][DONE] source=${source} success=${Number(finalResult.success) || 0} failed=${Number(finalResult.failed) || 0} cancelled=${finalResult.cancelled ? 1 : 0} skipped=${finalResult.skipped ? 1 : 0} total=${Number(finalResult.total) || 0} attached=${Number(status.attached) || 0}`
      );

      return finalResult;
    }

    return {
      mount,
      applyToolboxPageState,
      getStatus: getUploadStatus,
      getQuickPromptActiveCategory,
      getUploadInitPromise,
      refresh: () => {
        render();
        syncGlobalDocumentDropBinding();
      },
      isWaitingForReply: () => !!(
        state.waitingReply
        || state.waitingSend
        || state.autoSendWaiting
      ),
      refreshToolboxTopStatus: (reason = '') => {
        const runRefresh = () => {
          ensureActiveUploadGroupIdValid('refreshToolboxTopStatus');
          renderToolboxTopStatus();
          syncUploadGroupAppState();

          if (reason && typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
            ToolboxShell.appendLog(
              `[TOOLBOX_TOP_STATUS][refresh] reason=${reason} page_display_id=${getBridgePageDisplayIdText()} turn_count=${getConversationTurnCount()}`,
            );
          }
        };

        Promise.resolve(uploadModuleInitPromise)
          .then(runRefresh)
          .catch((err) => {
            console.error('[ChatGPT toolbox] refreshToolboxTopStatus after init failed', err);
            runRefresh();
          });
      },
      exportGroupsAndQueueMeta,
      importGroupsAndQueueMeta,
      startUploadFromBridge,
      triggerStartUpload,
      handleStartUploadClick,
      applyBridgeUploadFiles,
      getPendingUploadItems,
      getUploadCountStats,
    };
  })();
