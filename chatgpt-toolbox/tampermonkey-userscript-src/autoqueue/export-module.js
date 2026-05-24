  /********************************************************************
   * 7. ExportModule：导出统计模   ********************************************************************/

  const ExportModule = (() => {
    let root = null;
    let statsLineEl = null;
    let settingsImportFileEl = null;

    const REVIEW_JSON_MARKER = '<<<REVIEW_JSON>>>';

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
      const uploadStatus = UploadModule.getStatus();
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
运行状态：${uploadStatus.running ? '运行中' : '已停止'}
`;
    }
    function stripMarkdownCodeFences(text) {
      return String(text || '').replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1');
    }

    function extractJsonObjectsFromText(raw) {
      const text = stripMarkdownCodeFences(raw);
      const out = [];
      let i = 0;

      while (i < text.length) {
        const start = text.indexOf('{', i);

        if (start === -1) break;

        let depth = 0;
        let inStr = false;
        let esc = false;
        let closed = false;

        for (let j = start; j < text.length; j += 1) {
          const c = text[j];

          if (inStr) {
            if (esc) {
              esc = false;
            } else if (c === '\\') {
              esc = true;
            } else if (c === '"') {
              inStr = false;
            }

            continue;
          }

          if (c === '"') {
            inStr = true;
            continue;
          }

          if (c === '{') {
            depth += 1;
          } else if (c === '}') {
            depth -= 1;

            if (depth === 0) {
              const slice = text.slice(start, j + 1);

              try {
                out.push(JSON.parse(slice));
              } catch (e) {
                console.debug('[ChatGPT toolbox] skip invalid JSON candidate', e);
              }

              i = j + 1;
              closed = true;
              break;
            }
          }
        }

        if (!closed) {
          i = start + 1;
        }
      }

      return dedupeParsedObjects(out);
    }

    function dedupeParsedObjects(objs) {
      const seen = new Set();
      const out = [];

      for (const o of objs) {
        try {
          const k = JSON.stringify(o);

          if (seen.has(k)) continue;

          seen.add(k);
          out.push(o);
        } catch (e) {
          console.debug('[ChatGPT toolbox] JSON stringify failed during dedupe', e);
          out.push(o);
        }
      }

      return out;
    }

    function isReviewPayload(obj) {
      return !!(obj && typeof obj === 'object' && Array.isArray(obj.issues));
    }

    function getAssistantMessageFullText(el) {
      if (!el) return '';

      const z = (s) => String(s || '').replace(/[\u200B-\u200D\uFEFF]/g, '');
      const chunks = [];

      qsa('pre, code', el).forEach((node) => {
        if (isInToolbox(node)) return;

        const t = z(node.textContent);
        if (t) chunks.push(t);
      });

      chunks.push(z(el.innerText));
      chunks.push(z(el.textContent));

      return [...new Set(chunks.filter(Boolean))].join('\n\n');
    }

    function scanReviewIssueStats() {
      const assistantEls = ComposerApi.getChatMessageElementsInOrder()
        .filter((el) => (el.getAttribute('data-message-author-role') || '') === 'assistant');

      let jsonBlocks = 0;
      let issueTotal = 0;
      let metaSumDeclared = 0;
      const items = [];

      assistantEls.forEach((el, idx) => {
        const raw = getAssistantMessageFullText(el);
        const payloads = extractJsonObjectsFromText(raw).filter(isReviewPayload);

        payloads.forEach((obj) => {
          jsonBlocks += 1;

          const n = obj.issues.length;
          issueTotal += n;

          const metaCount = obj.meta && typeof obj.meta.issue_count === 'number'
            ? obj.meta.issue_count
            : null;

          if (metaCount != null) {
            metaSumDeclared += metaCount;
          }

          items.push({
            msgIndex: idx + 1,
            qid: obj.qid || '',
            issueCount: n,
            metaIssueCount: metaCount,
          });
        });
      });

      return {
        assistantWithRoleCount: assistantEls.length,
        jsonBlocks,
        issueTotal,
        metaSumDeclared,
        items,
      };
    }

    function applyIssueTotalToTabTitle(issueTotal) {
      TitlePrefixModule.applyIssueTotalToTitle(issueTotal);
    }

    function renderStats() {
      const s = scanReviewIssueStats();

      if (statsLineEl) {
        statsLineEl.textContent =
          `issues 总数：${s.issueTotal} 条；JSON 块：${s.jsonBlocks}；助手消息：${s.assistantWithRoleCount}`;
      }

      applyIssueTotalToTabTitle(s.issueTotal);

      return s;
    }

    const EXPORT_ACTIONS = Object.freeze([
      {
        selector: '#cgpt-export-copy-chat',
        name: 'copy-chat',
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
        handler: () => copyWithStatus({
          text: buildPanelExportText(),
          successText: '已复制工具箱配置',
          failedPrefix: '复制工具箱配置失败',
          logPrefix: 'EXPORT_COPY_PANEL',
        }),
      },
      {
        selector: '#cgpt-export-refresh-stats',
        name: 'refresh-stats',
        handler: () => {
          const s = renderStats();
          ToolboxShell.appendLog(`issues 统计刷新：${s.issueTotal} 条`);
        },
      },
      {
        selector: '#cgpt-export-copy-stats',
        name: 'copy-stats',
        handler: () => {
          const s = renderStats();
          return copyWithStatus({
            text: JSON.stringify(s, null, 2),
            successText: '已复制 issues 统计 JSON',
            failedPrefix: '复制 issues 统计失败',
            logPrefix: 'EXPORT_COPY_STATS',
          });
        },
      },
    ]);

    function bindEvents() {
      EXPORT_ACTIONS.forEach((action) => {
        DomUtil.bindClick(root, action.selector, () => {
          void Promise.resolve(action.handler()).catch((error) => {
            const errText = error && error.message ? error.message : String(error);
            console.error(`[ChatGPT toolbox] Export action failed: ${action.name}`, error);
            ToolboxShell.appendLog(`[EXPORT][${action.name}][failed] error=${errText}`);
          });
        }, 'EXPORT');
      });

      DomUtil.bindClick(root, '#cgpt-export-prompts', () => {
        const data = PromptManagerModule.exportData();
        downloadJsonFile(`chatgpt-prompts-${buildDateStamp()}.json`, data);
        ToolboxShell.appendLog('已导出 Prompt 管理数据');
        ToolboxShell.setStatus('已导出 Prompt 管理数据');
      }, 'EXPORT');

      bindClick(root, '#cgpt-export-settings', () => {
        void (async () => {
          try {
            const payload = await buildSettingsExportPayload();
            downloadJsonFile(`chatgpt-toolbox-settings-${buildDateTimeStamp()}.json`, payload);
            ToolboxShell.appendLog('已导出工具箱设置');
            ToolboxShell.setStatus('已导出工具箱设置');
          } catch (e) {
            const errText = logError('[EXPORT][settings-export]', e);
            ToolboxShell.setStatus(`导出设置失败：${errText}`);
          }
        })();
      }, {
        moduleName: 'ExportModule',
        bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings',
        bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings',
      });

      settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);

      bindClick(root, '#cgpt-export-settings-import', () => {
        if (settingsImportFileEl) {
          settingsImportFileEl.click();
        }
      }, {
        moduleName: 'ExportModule',
        bindMissingConsole: '[ChatGPT toolbox] ExportModule.bindEvents: 缺少 #cgpt-export-settings-import',
        bindMissingLog: '[EXPORT][bind-missing] #cgpt-export-settings-import',
      });

      if (settingsImportFileEl) {
        bindOnce(settingsImportFileEl, 'change', async (event) => {
          try {
            const payload = await readJsonFileFromInput(event, {
              tag: '[SETTINGS_IMPORT]',
            });

            if (!payload) return;

            const ok = await importSettingsPayload(payload);

            if (ok) {
              ToolboxShell.appendLog('已导入工具箱设置');
              ToolboxShell.setStatus('已导入工具箱设置');
            } else {
              ToolboxShell.setStatus('导入失败：文件格式无效');
            }
          } catch (e) {
            const errText = logError('[EXPORT][settings-import]', e);
            ToolboxShell.setStatus(`导入失败：${errText}`);
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
            <button type="button" class="cgpt-btn" id="cgpt-export-prompts">导出 Prompt</button>
          </div>
        </div>
      `;
    }

    function buildExportStatsSectionHtml() {
      return `
        <div class="cgpt-section">
          <div class="cgpt-section-title">issues 统计</div>
          <div class="cgpt-hint">
            会扫描助手回复中的 JSON 对象，统计形如 {"issues": [...]} 的结果数量，并同步到浏览器标题。
          </div>
          <div class="cgpt-row" style="flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-export-refresh-stats">刷新统计</button>
            <button type="button" class="cgpt-btn" id="cgpt-export-copy-stats">复制统计 JSON</button>
          </div>
          <div id="cgpt-export-stats-line" class="cgpt-hint" style="margin-top:8px;">issues 总数：-</div>
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
        ${buildExportStatsSectionHtml()}
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
          statsLineEl = qs('#cgpt-export-stats-line', root);
          settingsImportFileEl = qs('#cgpt-export-settings-import-file', root);
        },
        onBind: () => {
          bindEvents();
        },
        onRender: () => {
          renderStats();
        },
      });
    }

    return {
      mount,
    };
  })();
