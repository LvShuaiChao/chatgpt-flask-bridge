  /********************************************************************
   * 7. ExportModule：导出统计模   ********************************************************************/

  const ExportModule = (() => {
    let root = null;
    let settingsImportFileEl = null;
    let settingsImportBtn = null;

    const REVIEW_JSON_MARKER = '<<<REVIEW_JSON>>>';

    function rememberExportButtonIdleText(btn) {
      if (!btn) {
        return '';
      }
      if (!btn.dataset.cgptExportIdleText) {
        btn.dataset.cgptExportIdleText = String(btn.textContent || '').trim() || '操作';
      }
      return btn.dataset.cgptExportIdleText;
    }

    function setExportButtonRunning(btn, text) {
      if (!btn) {
        return;
      }
      rememberExportButtonIdleText(btn);
      if (typeof setButtonRunning === 'function') {
        setButtonRunning(btn, text, { reason: 'export-running', disabled: true });
        return;
      }
      btn.textContent = text;
      btn.disabled = true;
    }

    function setExportButtonSuccess(btn, text) {
      if (!btn) {
        return;
      }
      if (typeof setButtonSuccess === 'function') {
        setButtonSuccess(btn, text, { reason: 'export-success' });
        return;
      }
      btn.textContent = text;
    }

    function setExportButtonFailed(btn, text) {
      if (!btn) {
        return;
      }
      if (typeof setButtonFailed === 'function') {
        setButtonFailed(btn, text, { reason: 'export-failed' });
        return;
      }
      btn.textContent = text;
    }

    function restoreExportButton(btn, originalText) {
      if (!btn) {
        return;
      }
      const idleText = originalText || rememberExportButtonIdleText(btn);
      if (typeof setButtonIdle === 'function') {
        setButtonIdle(btn, idleText, { reason: 'export-restore' });
        return;
      }
      btn.textContent = idleText;
      btn.disabled = false;
      btn.removeAttribute('disabled');
    }

    function flashExportButton(btn, runningText, successText, failedText, taskFn) {
      if (!btn) {
        return Promise.resolve(false);
      }
      const idleText = rememberExportButtonIdleText(btn);
      setExportButtonRunning(btn, runningText);
      return Promise.resolve(taskFn())
        .then((ok) => {
          if (ok) {
            setExportButtonSuccess(btn, successText);
          } else {
            setExportButtonFailed(btn, failedText);
          }
          window.setTimeout(() => restoreExportButton(btn, idleText), 1200);
          return ok;
        })
        .catch((error) => {
          const errText = error && error.message ? error.message : String(error);
          setExportButtonFailed(btn, failedText);
          window.setTimeout(() => restoreExportButton(btn, idleText), 1400);
          throw error;
        });
    }

    function getExportMessageRole(el) {
      return getMessageRole(el);
    }

    function roleLabelForExport(role) {
      if (role === 'user') return '用户';
      if (role === 'assistant') return '助手';
      if (role === 'system') return '系统';

      return role || '消息';
    }

    function insertReviewJsonMarkerForAssistant(text) {
      if (!text || text === '（空）') return text;

      const full = text;
      const wsMatch = full.match(/^\s*/);
      const wsLen = wsMatch ? wsMatch[0].length : 0;
      const rest = full.slice(wsLen);

      if (rest.startsWith('{') || rest.startsWith('[')) {
        return `${full.slice(0, wsLen)}${REVIEW_JSON_MARKER}\n${rest}`;
      }

      const j = rest.search(/[\{\[]/);
      if (j === -1) return text;

      const jsonPart = rest.slice(j).trimStart();
      if (!jsonPart.startsWith('{') && !jsonPart.startsWith('[')) return text;

      const before = rest.slice(0, j).trimEnd();
      const prefix = full.slice(0, wsLen);

      if (before) {
        return `${prefix}${before}\n\n${REVIEW_JSON_MARKER}\n${jsonPart}`;
      }

      return `${prefix}${REVIEW_JSON_MARKER}\n${jsonPart}`;
    }

    function buildChatExportText() {
      const header = `=== ChatGPT 对话全文 ===\n导出时间${new Date().toLocaleString()}\n`;

      try {
        const records = ChatMessageExtractor.buildRecords({
          includeEmpty: true,
          includeHidden: true,
        });

        if (records.length > 0) {
          const blocks = records.map((rec, i) => {
            const label = roleLabelForExport(rec.role || '');
            let text = String(rec.text || '').trim();

            if (!text) text = '（空）';

            if (rec.role === 'assistant') {
              text = insertReviewJsonMarkerForAssistant(text);
            }

            return `--- ${label} ${i + 1} ---\n${text}`;
          });

          return `${header}\n${blocks.join('\n\n')}`;
        }
      } catch (exportErr) {
        const exportErrText = exportErr && exportErr.message ? exportErr.message : String(exportErr);
        console.warn('[ChatGPT toolbox] buildChatExportText records failed, fallback to ComposerApi', exportErr);
        ToolboxShell.appendLog(`[EXPORT][chat-records-failed] error=${exportErrText}`);
      }

      const nodes = ComposerApi.getChatMessageElementsInOrder();

      if (nodes.length > 0) {
        const blocks = nodes.map((el, i) => {
          const role = getExportMessageRole(el);
          const label = roleLabelForExport(role);

          let text = getVisibleTextFromElement(el);

          if (!text) text = '（空）';

          if (role === 'assistant') {
            text = insertReviewJsonMarkerForAssistant(text);
          }

          return `--- ${label} ${i + 1} ---\n${text}`;
        });

        return `${header}\n${blocks.join('\n\n')}`;
      }

      const main = qs('main');

      if (main) {
        const text = String(main.innerText || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();

        if (text) {
          return `${header}\n（未识别到标准消息节点，已用 main 文本兜底）\n\n${text}`;
        }
      }

      return `${header}\n未找到对话内容。`;
    }

    function buildPanelExportText() {
      const autoCfg = AutoQueueModule.getConfig();
      const autoState = AutoQueueModule.getState();
      const runtimeStatus = UploadModule.getUnifiedRuntimeStatus
        ? UploadModule.getUnifiedRuntimeStatus('export-panel')
        : null;
      const uploadStatus = runtimeStatus && runtimeStatus.uploadQueue
        ? runtimeStatus.uploadQueue
        : UploadModule.getStatus();
      const legacyFlags = runtimeStatus && runtimeStatus.legacyFlags
        ? runtimeStatus.legacyFlags
        : {};
      const uploadTaskPhase = runtimeStatus && runtimeStatus.uploadTask
        ? String(runtimeStatus.uploadTask.phase || 'idle')
        : 'idle';
      const sendTaskPhase = runtimeStatus && runtimeStatus.sendTask
        ? String(runtimeStatus.sendTask.phase || 'idle')
        : 'idle';
      const uploadRunning = !!(
        legacyFlags.running
        || uploadStatus.running
        || uploadTaskPhase === 'uploading'
        || uploadTaskPhase === 'cancelling'
      );
      const promptCount = PromptManagerModule.getPrompts().length;

      const continueLoop = autoCfg.modeSettings &&
        autoCfg.modeSettings.continue &&
        autoCfg.modeSettings.continue.loopMode;
      const listLoop = autoCfg.modeSettings &&
        autoCfg.modeSettings.list &&
        autoCfg.modeSettings.list.loopMode;
      const continueMin = autoCfg.modeSettings && autoCfg.modeSettings.continue
        ? autoCfg.modeSettings.continue.randomMinSec
        : 3;
      const continueMax = autoCfg.modeSettings && autoCfg.modeSettings.continue
        ? autoCfg.modeSettings.continue.randomMaxSec
        : 20;
      const listMin = autoCfg.modeSettings && autoCfg.modeSettings.list
        ? autoCfg.modeSettings.list.randomMinSec
        : 3;
      const listMax = autoCfg.modeSettings && autoCfg.modeSettings.list
        ? autoCfg.modeSettings.list.randomMaxSec
        : 20;

      return `=== ChatGPT 工具箱配置导出 ===
导出时间：${new Date().toLocaleString()}

【自动指令】
模式：${typeof AutoQueueModule.getModeLabel === 'function' ? AutoQueueModule.getModeLabel(autoCfg.promptMode) : (autoCfg.promptMode === 'task' ? '批量任务组模式' : (autoCfg.promptMode === 'list' ? '列表模式' : '继续模式'))}
继续模式循环：${continueLoop ? '是' : '否'}
继续模式间隔：${continueMin} ~ ${continueMax} 秒
列表模式循环：${listLoop ? '是' : '否'}
列表模式间隔：${listMin} ~ ${listMax} 秒
运行状态：${autoState.running ? '运行中' : '已停止'}
已发送：${autoState.sentCount}

【继续模式指令】
${autoCfg.continuePromptsText || '（空）'}

【列表模式指令】
${autoCfg.listPromptsText || '（空）'}

【Prompt 管理】
Prompt 总数：${promptCount}

【上传队列】
分组数：${uploadStatus.groupCount}
当前分组：${uploadStatus.activeGroupName}（${uploadStatus.activeGroupId}）
当前组队列数量：${uploadStatus.total}
已挂载：${uploadStatus.attached}
失败：${uploadStatus.failed}
运行状态：${uploadRunning ? '运行中' : '已停止'}
上传任务：${uploadTaskPhase}
发送任务：${sendTaskPhase}
`;
    }
    const EXPORT_ACTIONS = Object.freeze([
      {
        selector: '#cgpt-export-copy-chat',
        name: 'copy-chat',
        runningText: '复制中',
        successText: '已复制',
        failedText: '复制失败',
        handler: () => copyWithStatus({
          text: buildChatExportText(),
          successText: '已复制完整对话',
          failedPrefix: '复制完整对话失败',
          logPrefix: 'EXPORT_COPY_CHAT',
        }),
      },
      {
        selector: '#cgpt-export-copy-panel',
        name: 'copy-panel',
        runningText: '复制中',
        successText: '已复制',
        failedText: '复制失败',
        handler: () => copyWithStatus({
          text: buildPanelExportText(),
          successText: '已复制工具箱配置',
          failedPrefix: '复制工具箱配置失败',
          logPrefix: 'EXPORT_COPY_PANEL',
        }),
      },
    ]);

    function bindExportActionWithButtonState(action) {
      DomUtil.bindClick(root, action.selector, () => {
        const btn = root ? qs(action.selector, root) : null;
        void flashExportButton(
          btn,
          action.runningText,
          action.successText,
          action.failedText,
          () => Promise.resolve(action.handler()),
        ).catch((error) => {
          const errText = error && error.message ? error.message : String(error);
          console.error(`[EXPORT][${action.name}][failed]`, error);
          ToolboxShell.appendLog(`[EXPORT][${action.name}][failed] error=${errText}`);
        });
      }, 'EXPORT');
    }

    function bindEvents() {
      EXPORT_ACTIONS.forEach((action) => {
        bindExportActionWithButtonState(action);
      });

      bindClick(root, '#cgpt-export-settings', () => {
        const btn = root ? qs('#cgpt-export-settings', root) : null;
        void flashExportButton(btn, '导出中', '已导出', '导出失败', async () => {
          try {
            const payload = await buildSettingsExportPayload();
            downloadJsonFile(`chatgpt-toolbox-settings-${buildDateTimeStamp()}.json`, payload);
            ToolboxShell.appendLog('已导出工具箱设置');
            ToolboxShell.setStatus('已导出工具箱设置');
            return true;
          } catch (e) {
            const errText = logError('[EXPORT][settings-export]', e);
            ToolboxShell.setStatus(`导出设置失败：${errText}`);
            return false;
          }
        });
      }, {
        moduleName: 'ExportModule',
        bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings',
        bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings',
      });

      settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);
      settingsImportBtn = qs('#cgpt-export-settings-import', root);

      bindClick(root, '#cgpt-export-settings-import', () => {
        if (settingsImportBtn) {
          setExportButtonRunning(settingsImportBtn, '选择文件');
        }
        if (settingsImportFileEl) {
          settingsImportFileEl.click();
        } else if (settingsImportBtn) {
          restoreExportButton(settingsImportBtn);
        }
      }, {
        moduleName: 'ExportModule',
        bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings-import',
        bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings-import',
      });

      if (settingsImportFileEl) {
        bindOnce(settingsImportFileEl, 'change', async (event) => {
          const files = event && event.target && event.target.files
            ? event.target.files
            : null;
          if (!files || !files.length) {
            if (settingsImportBtn) {
              restoreExportButton(settingsImportBtn);
            }
            ToolboxShell.appendLog('[EXPORT][settings-import][cancelled] reason=no-file-selected');
            return;
          }

          if (settingsImportBtn) {
            setExportButtonRunning(settingsImportBtn, '导入中');
          }

          try {
            const payload = await readJsonFileFromInput(event, {
              tag: '[SETTINGS_IMPORT]',
            });

            if (!payload) {
              if (settingsImportBtn) {
                restoreExportButton(settingsImportBtn);
              }
              return;
            }

            const ok = await importSettingsPayload(payload);

            if (ok) {
              ToolboxShell.appendLog('已导入工具箱设置');
              ToolboxShell.setStatus('已导入工具箱设置');
              if (settingsImportBtn) {
                setExportButtonSuccess(settingsImportBtn, '已导入');
                window.setTimeout(() => restoreExportButton(settingsImportBtn), 1200);
              }
            } else {
              ToolboxShell.setStatus('导入失败：文件格式无效');
              if (settingsImportBtn) {
                setExportButtonFailed(settingsImportBtn, '导入失败');
                window.setTimeout(() => restoreExportButton(settingsImportBtn), 1400);
              }
            }
          } catch (e) {
            const errText = logError('[EXPORT][settings-import]', e);
            console.error('[EXPORT][settings-import][failed]', e);
            ToolboxShell.setStatus(`导入失败：${errText}`);
            if (settingsImportBtn) {
              setExportButtonFailed(settingsImportBtn, '导入失败');
              window.setTimeout(() => restoreExportButton(settingsImportBtn), 1400);
            }
          } finally {
            if (settingsImportFileEl) {
              settingsImportFileEl.value = '';
            }
          }
        });
      }
    }

    async function buildSettingsExportPayload() {
      const uploadGroups = await UploadModule.exportGroupsAndQueueMeta();

      return {
        version: APP.storagePrefix,
        schemaVersion: 4,
        exportedAt: new Date().toISOString(),
        toolbox: MemoryManager.getToolboxState(),
        autoQueueConfig: AutoQueueModule.snapshotConfig(),
        prompts: MemoryManager.get(MemoryManager.KEYS.promptManagerData, []),
        uploadGroups,
      };
    }

    async function importSettingsPayload(payload) {
      if (!payload || typeof payload !== 'object') {
        console.warn('[ChatGPT toolbox] importSettingsPayload: invalid payload', payload);
        return false;
      }

      if (payload.toolbox && typeof payload.toolbox === 'object') {
        MemoryManager.saveToolboxPatch(payload.toolbox);
        ToolboxShell.applyToolboxUiState({
          restoreTab: false,
        });
      }

      if (payload.autoQueueConfig && typeof payload.autoQueueConfig === 'object') {
        MemoryManager.set(MemoryManager.KEYS.autoQueueConfig, payload.autoQueueConfig);
        AutoQueueModule.applyConfig(payload.autoQueueConfig);
      }

      if (payload.prompts != null) {
        MemoryManager.set(MemoryManager.KEYS.promptManagerData, payload.prompts);
        PromptManagerModule.reloadFromStorage();
      }

      if (payload.uploadGroups && typeof payload.uploadGroups === 'object') {
        await UploadModule.importGroupsAndQueueMeta(payload.uploadGroups);
      }

      ToolboxShell.switchTab('upload');

      const autoCfgForUi = payload.autoQueueConfig && typeof payload.autoQueueConfig === 'object'
        ? payload.autoQueueConfig
        : MemoryManager.get(MemoryManager.KEYS.autoQueueConfig, createDefaultAutoConfig());
      AutoQueueModule.applyConfig(autoCfgForUi);
      PromptManagerModule.reloadFromStorage();

      if (typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }

      return true;
    }

    function buildExportChatSectionHtml() {
      return `
        <div class="cgpt-section">
          <div class="cgpt-section-title">对话导出</div>
          <div class="cgpt-hint">复制当前页面对话全文，适合保存审稿、代码审查和长对话上下文。</div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-copy-chat">复制完整对话</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-copy-panel">复制工具箱配置</button>
          </div>
        </div>
      `;
    }


    function buildExportSettingsBackupSectionHtml() {
      return `
        <div class="cgpt-section cgpt-export-advanced">
          <div class="cgpt-section-title">设置备份</div>
          <div class="cgpt-hint">
            导出/导入工具 UI 状态、自动指令、Prompt、文件组与队列元数据（默认不含真实文件 Blob）。
          </div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-settings">导出工具箱设置</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-settings-import">导入工具箱设置</button>
            <input type="file" id="cgpt-export-settings-import-file" accept="application/json,.json" class="cgpt-toolbox-hidden">
          </div>
        </div>
      `;
    }

    function buildExportModuleHtml() {
      return `
        ${buildExportChatSectionHtml()}
        ${buildExportSettingsBackupSectionHtml()}
      `;
    }

    function mount(targetHost) {
      mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-export-module',
        moduleName: 'EXPORT',
        html: buildExportModuleHtml(),
        onRefs: (mountedRoot) => {
          root = mountedRoot;
          settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);
        },
        onBind: () => {
          bindEvents();
        }
      });
    }

    return {
      mount,
    };
  })();
