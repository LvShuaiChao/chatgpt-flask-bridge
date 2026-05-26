  /********************************************************************
   * 5b. SettingsModule：精简模式与工具箱设置
   ********************************************************************/

  function renderPromptCheckboxList(promptList, selectedIds) {
    const list = Array.isArray(promptList) ? promptList : [];
    const selected = new Set(
      Array.isArray(selectedIds)
        ? selectedIds.map((id) => String(id))
        : [],
    );

    if (!list.length) {
      return '<div class="cgpt-log-empty">暂无 Prompt</div>';
    }

    return list.map((prompt) => {
      const id = String(prompt && prompt.id ? prompt.id : '');
      const title = String(prompt && prompt.title ? prompt.title : '未命名');
      const category = String(prompt && prompt.category ? prompt.category : '默认');
      const checked = selected.has(id) ? ' checked' : '';

      return `
      <label class="cgpt-setting-prompt-checkbox">
        <input
          type="checkbox"
          data-compact-prompt-id="${escapeHtml(id)}"
          ${checked}
        >
        <span>${escapeHtml(title)}</span>
        <small>${escapeHtml(category)}</small>
      </label>
    `;
    }).join('');
  }

  function getSettingsPromptList() {
    if (typeof PromptManagerModule === 'undefined' || typeof PromptManagerModule.getPrompts !== 'function') {
      return [];
    }
    const promptList = PromptManagerModule.getPrompts();
    return Array.isArray(promptList) ? promptList : [];
  }

  function getPromptIdsFromList(promptList) {
    return (Array.isArray(promptList) ? promptList : [])
      .map((prompt) => String(prompt && prompt.id ? prompt.id : '').trim())
      .filter(Boolean);
  }

  const SettingsModule = (() => {
    let host = null;
    let root = null;
    let activeSettingsSubtab = 'basic';
    let continuePromptMigrationChecked = false;

    function migrateCompactContinuePromptIfNeeded(cfg, options = {}) {
      if (!cfg || typeof cfg !== 'object') {
        return cfg;
      }
      if (typeof migrateContinuePromptTextIfNeeded !== 'function') {
        return cfg;
      }

      const stored = String(cfg.copyHotkeyContinuePromptText || '').trim();
      const logFn = options.log === false
        ? null
        : (line) => ToolboxShell.appendLog(line);
      const migration = migrateContinuePromptTextIfNeeded(stored, logFn);

      if (migration.migrated) {
        cfg.copyHotkeyContinuePromptText = migration.value;
      }

      return cfg;
    }

    function getConfig() {
      const saved = typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.get === 'function'
        ? CompactUiConfigStore.get()
        : normalizeCompactUiConfig(MemoryManager.get(MemoryManager.KEYS.compactUiConfig, null) || {});
      let cfg = normalizeCompactUiConfig(saved);

      if (saved && !saved.quickPromptActionVersion && saved.quickPromptClickAction === 'fill') {
        cfg.quickPromptClickAction = 'send';
        cfg.quickPromptActionVersion = 1;
        if (typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.save === 'function') {
          CompactUiConfigStore.save(cfg);
        } else {
          MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
        }
        cfg = normalizeCompactUiConfig(cfg);
      }

      if (!continuePromptMigrationChecked) {
        continuePromptMigrationChecked = true;
        const before = String(cfg.copyHotkeyContinuePromptText || '').trim();
        cfg = migrateCompactContinuePromptIfNeeded(cfg, { log: true });
        const after = String(cfg.copyHotkeyContinuePromptText || '').trim();
        if (before !== after) {
          if (typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.save === 'function') {
            CompactUiConfigStore.save(cfg);
          } else {
            MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
          }
        }
      }

      return cfg;
    }

    function getAutoQueueTaskQueueSettings() {
      if (typeof AutoQueueModule === 'undefined' || typeof AutoQueueModule.getConfig !== 'function') {
        return typeof createDefaultTaskQueueSettings === 'function'
          ? createDefaultTaskQueueSettings()
          : {};
      }
      const autoCfg = AutoQueueModule.getConfig();
      return autoCfg && autoCfg.taskQueueSettings && typeof autoCfg.taskQueueSettings === 'object'
        ? autoCfg.taskQueueSettings
        : (typeof createDefaultTaskQueueSettings === 'function' ? createDefaultTaskQueueSettings() : {});
    }

    function saveAutoQueueTaskQueueSettings(patch) {
      if (typeof AutoQueueModule === 'undefined' || typeof AutoQueueModule.getConfig !== 'function' || typeof AutoQueueModule.applyConfig !== 'function') {
        return;
      }
      const autoCfg = AutoQueueModule.getConfig();
      autoCfg.taskQueueSettings = Object.assign({}, autoCfg.taskQueueSettings || {}, patch || {});
      AutoQueueModule.applyConfig(autoCfg);
      if (typeof MemoryManager !== 'undefined' && MemoryManager.KEYS && MemoryManager.KEYS.autoQueueConfig) {
        MemoryManager.set(MemoryManager.KEYS.autoQueueConfig, autoCfg);
      }
      if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.onSettingsChanged === 'function') {
        RuntimeStatsModule.onSettingsChanged();
      }
    }

    function readRuntimeStatsSettingsFromUi() {
      const showEl = qs('#cgpt-setting-runtime-stats-show', root);
      const preserveEl = qs('#cgpt-setting-runtime-stats-preserve-average', root);
      const intervalEl = qs('#cgpt-setting-runtime-stats-refresh-interval', root);
      const intervalMs = Number(intervalEl && intervalEl.value ? intervalEl.value : 1000);
      const allowed = [1000, 2000, 5000];

      return {
        showRuntimeStats: showEl ? !!showEl.checked : true,
        preserveRuntimeStatsAverage: preserveEl ? !!preserveEl.checked : false,
        runtimeStatsRefreshIntervalMs: allowed.includes(intervalMs) ? intervalMs : 1000,
      };
    }

    function saveRuntimeStatsSettingsFromUi() {
      const patch = readRuntimeStatsSettingsFromUi();
      saveAutoQueueTaskQueueSettings(patch);
      ToolboxShell.appendLog(
        `[SETTINGS][runtime-stats] show=${patch.showRuntimeStats ? 1 : 0} preserveAverage=${patch.preserveRuntimeStatsAverage ? 1 : 0} intervalMs=${patch.runtimeStatsRefreshIntervalMs}`,
      );
    }

    function saveConfig(next) {
      const cfg = migrateCompactContinuePromptIfNeeded(
        normalizeCompactUiConfig(next || {}),
        { log: false },
      );
      cfg.quickPromptActionVersion = 1;
      if (typeof CompactUiConfigStore !== 'undefined' && typeof CompactUiConfigStore.save === 'function') {
        CompactUiConfigStore.save(cfg);
      } else {
        MemoryManager.set(MemoryManager.KEYS.compactUiConfig, cfg);
      }

      ToolboxShell.appendLog(
        `[SETTINGS][quickPrompt] upload=${cfg.showUploadQuickPrompts !== false} compact=${cfg.showCompactQuickPrompts !== false} confirmOverwrite=${cfg.confirmPromptDraftOverwrite ? 1 : 0} selected=${(cfg.quickPromptIds || []).length}`,
      );

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.renderToolboxTopStatus === 'function') {
        UploadModule.renderToolboxTopStatus();
      }
    }

    function parseQuotaLimitInput(raw) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return null;
      }
      return Math.min(10000, Math.floor(n));
    }

    function readQuotaLimitsFromUi() {
      const current = getConfig();
      const uploadEl = qs('#cgpt-setting-upload-quota-limit', root);
      const messageEl = qs('#cgpt-setting-message-quota-limit', root);

      const uploadLimit = parseQuotaLimitInput(uploadEl && uploadEl.value);
      const messageLimit = parseQuotaLimitInput(messageEl && messageEl.value);

      return {
        uploadQuotaMaxFiles: uploadLimit != null ? uploadLimit : current.uploadQuotaMaxFiles,
        messageQuotaMaxMessages: messageLimit != null ? messageLimit : current.messageQuotaMaxMessages,
      };
    }

    function saveQuotaSettingsFromUi() {
      const limits = readQuotaLimitsFromUi();
      const uploadEl = qs('#cgpt-setting-upload-quota-limit', root);
      const messageEl = qs('#cgpt-setting-message-quota-limit', root);

      if (
        parseQuotaLimitInput(uploadEl && uploadEl.value) == null
        || parseQuotaLimitInput(messageEl && messageEl.value) == null
      ) {
        ToolboxShell.setStatus('额度上限必须是大于 0 的整数', 'warn');
        return false;
      }

      const current = getConfig();
      const next = Object.assign({}, current, limits);
      saveConfig(next);
      render();

      ToolboxShell.appendLog(
        `[SETTINGS][QUOTA_SAVE] uploadLimit=${limits.uploadQuotaMaxFiles} messageLimit=${limits.messageQuotaMaxMessages}`,
      );
      ToolboxShell.setStatus('额度设置已保存', 'ok');
      return true;
    }

    function resetQuotaStatsFromUi() {
      const uploadBefore = (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.getUploadQuotaState === 'function'
      )
        ? UploadModule.getUploadQuotaState()
        : { used: 0 };
      const messageBefore = (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.getMessageQuotaState === 'function'
      )
        ? UploadModule.getMessageQuotaState()
        : { used: 0 };

      const confirmed = window.confirm(
        '确定要重置今日上传额度和消息额度统计吗？这只会重置工具箱内部统计，不会影响 ChatGPT 官方额度。',
      );
      if (!confirmed) {
        return;
      }

      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.clearUploadQuotaRecords === 'function'
      ) {
        UploadModule.clearUploadQuotaRecords('settings-quota-reset');
      }
      if (
        typeof UploadModule !== 'undefined'
        && typeof UploadModule.clearMessageQuotaRecords === 'function'
      ) {
        UploadModule.clearMessageQuotaRecords('settings-quota-reset');
      }

      ToolboxShell.appendLog(
        `[SETTINGS][QUOTA_RESET] uploadUsedBefore=${uploadBefore.used} messageUsedBefore=${messageBefore.used}`,
      );
      ToolboxShell.setStatus('今日额度统计已重置', 'ok');
    }

    function readFromUi() {
      const current = getConfig();

      const quickPromptInputs = qsa('[data-compact-prompt-id]', root);
      const quickPromptIds = quickPromptInputs.length
        ? quickPromptInputs
            .filter((x) => x.checked)
            .map((x) => x.getAttribute('data-compact-prompt-id'))
            .filter(Boolean)
        : Array.isArray(current.quickPromptIds)
          ? current.quickPromptIds.slice()
          : [];

      const uploadQuickEl = qs('#cgpt-setting-upload-show-quick-prompts', root);
      const compactQuickEl = qs('#cgpt-setting-compact-show-quick-prompts', root);
      const promptActionEl = qs('#cgpt-setting-compact-prompt-action', root);
      const confirmOverwriteEl = qs('#cgpt-setting-confirm-prompt-draft-overwrite', root);

      const showUploadQuickPrompts = uploadQuickEl
        ? !!uploadQuickEl.checked
        : current.showUploadQuickPrompts !== false;

      const showCompactQuickPrompts = compactQuickEl
        ? !!compactQuickEl.checked
        : current.showCompactQuickPrompts !== false;

      const quickPromptClickAction = promptActionEl
        ? (promptActionEl.value === 'fill' ? 'fill' : 'send')
        : (current.quickPromptClickAction === 'fill' ? 'fill' : 'send');

      const confirmPromptDraftOverwrite = confirmOverwriteEl
        ? !!confirmOverwriteEl.checked
        : current.confirmPromptDraftOverwrite === true;

      return {
        showUploadGroups: !!qs(SettingsSelectors.showUploadGroups, root)?.checked,
        showUploadStartButton: !!qs(SettingsSelectors.showUploadStart, root)?.checked,
        showUploadFileList: !!qs(SettingsSelectors.showFileList, root)?.checked,
        showUploadQuickPrompts,
        showCompactQuickPrompts,
        quickPromptClickAction,
        confirmPromptDraftOverwrite,
        quickPromptActiveCategory: current.quickPromptActiveCategory || '全部',
        quickPromptIds,
        globalDropCaptureEnabled: !!qs('#cgpt-setting-global-drop-capture', root)?.checked,
        restoreScrollAfterCopyLastMessage: !!qs('#cgpt-setting-restore-scroll-after-copy', root)?.checked,
        copyHotkeyLoopAutoUploadEnabled: !!qs('#cgpt-setting-copy-hotkey-loop-auto-upload-enabled', root)?.checked,
        copyHotkeyLoopAutoUploadInterval: Number(qs('#cgpt-setting-copy-hotkey-loop-auto-upload-interval', root)?.value || current.copyHotkeyLoopAutoUploadInterval || 5),
        copyHotkeyLoopHomeNavEnabled: !!qs('#cgpt-setting-copy-hotkey-loop-home-nav-enabled', root)?.checked,
        copyHotkeyLoopHomeNavInterval: Number(qs('#cgpt-setting-copy-hotkey-loop-home-nav-interval', root)?.value || current.copyHotkeyLoopHomeNavInterval || 20),
        copyHotkeyLoopHomeNavUrl: String(
          qs('#cgpt-setting-copy-hotkey-loop-home-nav-url', root)?.value
          || current.copyHotkeyLoopHomeNavUrl
          || 'https://chatgpt.com/'
        ).trim(),
        copyHotkeyContinuePromptText: (() => {
          const raw = String(qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root)?.value || '').trim();
          const defaultText = typeof getDefaultContinuePromptText === 'function'
            ? getDefaultContinuePromptText()
            : '';
          if (defaultText && raw === defaultText) {
            return '';
          }
          return raw;
        })(),
        copyHotkeyContinueStopSignal: String(qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root)?.value || '').trim() || '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>',
      };
    }

    function renderSettingsSubtabs() {
      if (!root) return;

      const tabs = qsa('[data-settings-subtab]', root);
      const panels = qsa('[data-settings-panel]', root);

      tabs.forEach((btn) => {
        const name = btn.getAttribute('data-settings-subtab') || 'basic';
        btn.classList.toggle('active', name === activeSettingsSubtab);
      });

      panels.forEach((panelEl) => {
        const name = panelEl.getAttribute('data-settings-panel') || 'basic';
        panelEl.style.display = name === activeSettingsSubtab ? '' : 'none';
      });
    }

    function render() {
      if (!root) return;

      renderSettingsSubtabs();

      const cfg = getConfig();

      const groupsEl = qs(SettingsSelectors.showUploadGroups, root);
      if (groupsEl) {
        groupsEl.checked = cfg.showUploadGroups !== false;
        groupsEl.disabled = false;
      }

      const startEl = qs(SettingsSelectors.showUploadStart, root);
      if (startEl) {
        startEl.checked = !!cfg.showUploadStartButton;
        startEl.disabled = false;
      }

      const fileListEl = qs(SettingsSelectors.showFileList, root);
      if (fileListEl) {
        fileListEl.checked = !!cfg.showUploadFileList;
        fileListEl.disabled = false;
      }

      const globalDropEl = qs('#cgpt-setting-global-drop-capture', root);
      if (globalDropEl) globalDropEl.checked = !!cfg.globalDropCaptureEnabled;

      const restoreScrollEl = qs('#cgpt-setting-restore-scroll-after-copy', root);
      if (restoreScrollEl) {
        restoreScrollEl.checked = cfg.restoreScrollAfterCopyLastMessage === true;
      }

      const loopAutoUploadEnabledEl = qs('#cgpt-setting-copy-hotkey-loop-auto-upload-enabled', root);
      if (loopAutoUploadEnabledEl) {
        loopAutoUploadEnabledEl.checked = cfg.copyHotkeyLoopAutoUploadEnabled !== false;
      }

      const loopAutoUploadIntervalEl = qs('#cgpt-setting-copy-hotkey-loop-auto-upload-interval', root);
      if (loopAutoUploadIntervalEl) {
        loopAutoUploadIntervalEl.value = String(cfg.copyHotkeyLoopAutoUploadInterval || 5);
      }

      const loopHomeNavEnabledEl = qs('#cgpt-setting-copy-hotkey-loop-home-nav-enabled', root);
      if (loopHomeNavEnabledEl) {
        loopHomeNavEnabledEl.checked = cfg.copyHotkeyLoopHomeNavEnabled !== false;
      }

      const loopHomeNavIntervalEl = qs('#cgpt-setting-copy-hotkey-loop-home-nav-interval', root);
      if (loopHomeNavIntervalEl) {
        loopHomeNavIntervalEl.value = String(cfg.copyHotkeyLoopHomeNavInterval || 20);
      }

      const loopHomeNavUrlEl = qs('#cgpt-setting-copy-hotkey-loop-home-nav-url', root);
      if (loopHomeNavUrlEl) {
        loopHomeNavUrlEl.value = cfg.copyHotkeyLoopHomeNavUrl || 'https://chatgpt.com/';
      }

      const stopSignalEl = qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root);
      if (stopSignalEl) {
        stopSignalEl.value = cfg.copyHotkeyContinueStopSignal || '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';
      }

      const promptTextEl = qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root);
      if (promptTextEl) {
        promptTextEl.value = String(cfg.copyHotkeyContinuePromptText || '').trim();
        promptTextEl.placeholder = '留空则使用内置默认继续指令（完成时仅回复 <<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>）。';
      }

      const runtimeStatsCfg = getAutoQueueTaskQueueSettings();
      const runtimeStatsShowEl = qs('#cgpt-setting-runtime-stats-show', root);
      if (runtimeStatsShowEl) {
        runtimeStatsShowEl.checked = runtimeStatsCfg.showRuntimeStats !== false;
      }
      const runtimeStatsPreserveEl = qs('#cgpt-setting-runtime-stats-preserve-average', root);
      if (runtimeStatsPreserveEl) {
        runtimeStatsPreserveEl.checked = runtimeStatsCfg.preserveRuntimeStatsAverage === true;
      }
      const runtimeStatsIntervalEl = qs('#cgpt-setting-runtime-stats-refresh-interval', root);
      if (runtimeStatsIntervalEl) {
        runtimeStatsIntervalEl.value = String(runtimeStatsCfg.runtimeStatsRefreshIntervalMs || 1000);
      }

      const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);
      if (edgeAutoHideEl) {
        edgeAutoHideEl.checked = MemoryManager.get(MemoryManager.KEYS.edgeAutoHideEnabled, false) === true;
      }

      const beepCfg = getBeepConfig();
      const beepCopySuccessEl = qs('#cgpt-setting-beep-copy-success-enabled', root);
      if (beepCopySuccessEl) {
        beepCopySuccessEl.checked = beepCfg.copySuccessEnabled !== false;
      }

      const beepVolumeEl = qs('#cgpt-setting-beep-volume', root);
      if (beepVolumeEl) {
        beepVolumeEl.value = String(beepCfg.volume);
      }

      const beepDurationEl = qs('#cgpt-setting-beep-duration', root);
      if (beepDurationEl) {
        beepDurationEl.value = String(beepCfg.durationMs);
      }

      const beepFrequencyEl = qs('#cgpt-setting-beep-frequency', root);
      if (beepFrequencyEl) {
        beepFrequencyEl.value = String(beepCfg.frequency);
      }

      const uploadQuotaLimitEl = qs('#cgpt-setting-upload-quota-limit', root);
      if (uploadQuotaLimitEl) {
        uploadQuotaLimitEl.value = String(cfg.uploadQuotaMaxFiles || 80);
      }

      const messageQuotaLimitEl = qs('#cgpt-setting-message-quota-limit', root);
      if (messageQuotaLimitEl) {
        messageQuotaLimitEl.value = String(cfg.messageQuotaMaxMessages || 150);
      }

    }

    function renderShortcutSettings() {
      if (!host) {
        return;
      }

      const cfg = getShortcutConfig();

      const map = [
        {
          action: 'sendMessage',
          enabledId: 'cgpt-shortcut-send-enabled',
          labelId: 'cgpt-shortcut-send-label',
        },
        {
          action: 'copyAndHotkeyOnce',
          enabledId: 'cgpt-shortcut-copy-hotkey-enabled',
          labelId: 'cgpt-shortcut-copy-hotkey-label',
        },
        {
          action: 'copyThenShortcutTargetHotkey',
          labelId: 'cgpt-shortcut-copy-then-target-label',
        },
        {
          action: 'startUpload',
          enabledId: 'cgpt-shortcut-upload-enabled',
          labelId: 'cgpt-shortcut-upload-label',
        },
      ];

      map.forEach((item) => {
        const data = cfg[item.action];
        const enabledEl = qs(`#${item.enabledId}`, host);
        const labelEl = qs(`#${item.labelId}`, host);

        if (enabledEl) {
          enabledEl.checked = data.enabled !== false;
        }

        if (labelEl) {
          labelEl.value = (data.label && String(data.label).trim()) ? data.label : '未设置';
        }
      });
    }

    function bindEvents() {
      function updateShortcutAction(action, patch) {
        const cfg = getShortcutConfig();
        const oldActionConfig = cloneShortcutItem(
          cfg[action],
          DEFAULT_SHORTCUT_CONFIG[action],
        );

        cfg[action] = Object.assign(
          {},
          cfg[action] || {},
          patch || {},
        );

        const conflict = findShortcutConflict(cfg, action);

        if (conflict) {
          cfg[action] = oldActionConfig;

          renderShortcutSettings();
          applyUploadShortcutButtonTitles();

          ToolboxShell.appendLog(
            `[SETTINGS][shortcut-conflict-blocked] action=${action} conflict=${conflict}`,
          );
          ToolboxShell.setStatus(
            `快捷键冲突，已取消保存：${oldActionConfig.label || cfg[action].label || ''}`,
            'warn',
            {
              persist: true,
              shortText: '冲突',
            },
          );
          return;
        }

        saveShortcutConfig(cfg);
        renderShortcutSettings();
        applyUploadShortcutButtonTitles();
        logShortcutTargetWarnings(cfg);

        ToolboxShell.appendLog(
          `[SETTINGS][shortcut] action=${action} label=${cfg[action].label || '-'} enabled=${cfg[action].enabled !== false ? '1' : '0'}`
        );
      }

      function bindShortcutEnabled(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('change', () => {
          updateShortcutAction(action, {
            enabled: !!el.checked,
          });
        });
      }

      function bindShortcutClear(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('click', () => {
          updateShortcutAction(action, {
            enabled: false,
            label: '',
            key: '',
            code: '',
            ctrl: false,
            alt: false,
            shift: false,
            meta: false,
          });
        });
      }

      function bindShortcutRecord(id, action) {
        const el = qs(`#${id}`, root);
        if (!el) return;

        el.addEventListener('click', () => {
          const oldText = el.textContent;
          el.textContent = '按下快捷键...';
          let recordTimer = 0;

          const cleanupRecordListener = () => {
            if (recordTimer) {
              window.clearTimeout(recordTimer);
              recordTimer = 0;
            }

            document.removeEventListener('keydown', onKeyDown, true);
          };

          const onKeyDown = (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.key === 'Escape') {
              cleanupRecordListener();
              el.textContent = oldText || '录制';
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:cancel] action=${action}`);
              return;
            }

            const next = shortcutItemFromEvent(e);

            if (next.pureModifier) {
              ToolboxShell.appendLog(
                `[SETTINGS][shortcut-record:wait-main-key] action=${action} key=${e.key || '-'} code=${e.code || '-'} ctrl=${e.ctrlKey ? 1 : 0} alt=${e.altKey ? 1 : 0} shift=${e.shiftKey ? 1 : 0} meta=${e.metaKey ? 1 : 0}`,
              );
              el.textContent = '继续按主键...';
              return;
            }

            if (!next.key && !next.code) {
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:skip] action=${action} reason=empty-key`);
              el.textContent = oldText || '录制';
              cleanupRecordListener();
              return;
            }

            if (!next.label) {
              ToolboxShell.appendLog(`[SETTINGS][shortcut-record:skip] action=${action} reason=empty-label`);
              el.textContent = oldText || '录制';
              cleanupRecordListener();
              return;
            }

            cleanupRecordListener();

            const shortcutData = {
              enabled: action === 'copyThenShortcutTargetHotkey' ? true : next.enabled,
              label: next.label,
              key: next.key,
              code: next.code,
              ctrl: next.ctrl,
              alt: next.alt,
              shift: next.shift,
              meta: next.meta,
            };

            updateShortcutAction(action, shortcutData);

            ToolboxShell.appendLog(
              `[SETTINGS][shortcut-record:ok] action=${action} label=${next.label}`,
            );

            el.textContent = oldText || '录制';
          };

          recordTimer = window.setTimeout(() => {
            recordTimer = 0;
            el.textContent = oldText || '录制';
            document.removeEventListener('keydown', onKeyDown, true);
            ToolboxShell.appendLog(`[SETTINGS][shortcut-record:timeout] action=${action}`);
          }, 8000);

          document.addEventListener('keydown', onKeyDown, true);
        });
      }

      bindShortcutEnabled('cgpt-shortcut-send-enabled', 'sendMessage');
      bindShortcutEnabled('cgpt-shortcut-copy-hotkey-enabled', 'copyAndHotkeyOnce');
      bindShortcutEnabled('cgpt-shortcut-upload-enabled', 'startUpload');

      bindShortcutRecord('cgpt-shortcut-send-record', 'sendMessage');
      bindShortcutRecord('cgpt-shortcut-copy-hotkey-record', 'copyAndHotkeyOnce');
      bindShortcutRecord('cgpt-shortcut-copy-then-target-record', 'copyThenShortcutTargetHotkey');
      bindShortcutRecord('cgpt-shortcut-upload-record', 'startUpload');

      bindShortcutClear('cgpt-shortcut-send-clear', 'sendMessage');
      bindShortcutClear('cgpt-shortcut-copy-hotkey-clear', 'copyAndHotkeyOnce');
      bindShortcutClear('cgpt-shortcut-copy-then-target-clear', 'copyThenShortcutTargetHotkey');
      bindShortcutClear('cgpt-shortcut-upload-clear', 'startUpload');

      const resetShortcutBtn = qs('#cgpt-shortcut-reset-defaults', root);
      if (resetShortcutBtn) {
        resetShortcutBtn.addEventListener('click', () => {
          resetShortcutConfig();
          renderShortcutSettings();
          applyUploadShortcutButtonTitles();
          ToolboxShell.appendLog('[SETTINGS][shortcut-reset-defaults]');
        });
      }

      const resetContinuePromptBtn = qs('#cgpt-setting-copy-hotkey-continue-prompt-reset', root);
      if (resetContinuePromptBtn) {
        resetContinuePromptBtn.addEventListener('click', () => {
          const promptTextEl = qs('#cgpt-setting-copy-hotkey-continue-prompt-text', root);
          const stopSignalEl = qs('#cgpt-setting-copy-hotkey-continue-stop-signal', root);
          const defaultStop = typeof DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL === 'string'
            ? DEFAULT_COPY_HOTKEY_CONTINUE_STOP_SIGNAL
            : '<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>';

          if (promptTextEl) {
            promptTextEl.value = '';
          }
          if (stopSignalEl) {
            stopSignalEl.value = defaultStop;
          }

          const cfg = readFromUi();
          cfg.copyHotkeyContinuePromptText = '';
          cfg.copyHotkeyContinueStopSignal = defaultStop;
          saveConfig(cfg);
          render();
          ToolboxShell.appendLog('[SETTINGS][continue-prompt-reset-defaults]');
        });
      }

      const onCompactSettingChange = () => {
        const cfg = readFromUi();
        saveConfig(cfg);
        render();
      };

      const onRuntimeStatsSettingChange = () => {
        saveRuntimeStatsSettingsFromUi();
        render();
      };

      [
        '#cgpt-setting-runtime-stats-show',
        '#cgpt-setting-runtime-stats-preserve-average',
        '#cgpt-setting-runtime-stats-refresh-interval',
      ].forEach((selector) => {
        bindSettingChange(root, selector, onRuntimeStatsSettingChange, {
          moduleName: 'SETTINGS',
        });
      });

      const resetRuntimeStatsBtn = qs('#cgpt-setting-runtime-stats-reset', root);
      if (resetRuntimeStatsBtn) {
        resetRuntimeStatsBtn.addEventListener('click', () => {
          if (typeof RuntimeStatsModule !== 'undefined' && typeof RuntimeStatsModule.resetUserStats === 'function') {
            RuntimeStatsModule.resetUserStats();
          }
          ToolboxShell.appendLog('[SETTINGS][runtime-stats-reset]');
          ToolboxShell.setStatus('已重置批量任务计时统计（程序运行时长保留）');
        });
      }

      const saveQuotaBtn = qs('#cgpt-setting-quota-save', root);
      if (saveQuotaBtn) {
        saveQuotaBtn.addEventListener('click', () => {
          saveQuotaSettingsFromUi();
        });
      }

      const resetQuotaStatsBtn = qs('#cgpt-setting-quota-reset-stats', root);
      if (resetQuotaStatsBtn) {
        resetQuotaStatsBtn.addEventListener('click', () => {
          resetQuotaStatsFromUi();
        });
      }

      [
        SettingsSelectors.showUploadGroups,
        SettingsSelectors.showUploadStart,
        SettingsSelectors.showFileList,
        '#cgpt-setting-global-drop-capture',
        '#cgpt-setting-restore-scroll-after-copy',
        '#cgpt-setting-copy-hotkey-loop-auto-upload-enabled',
        '#cgpt-setting-copy-hotkey-loop-auto-upload-interval',
        '#cgpt-setting-copy-hotkey-loop-home-nav-enabled',
        '#cgpt-setting-copy-hotkey-loop-home-nav-interval',
        '#cgpt-setting-copy-hotkey-loop-home-nav-url',
        '#cgpt-setting-copy-hotkey-continue-stop-signal',
        '#cgpt-setting-copy-hotkey-continue-prompt-text',
      ].forEach((selector) => {
        bindSettingChange(root, selector, onCompactSettingChange, {
          moduleName: 'SETTINGS',
        });
      });

      const edgeAutoHideEl = qs('#cgpt-setting-edge-auto-hide', root);

      if (edgeAutoHideEl) {
        edgeAutoHideEl.addEventListener('change', () => {
          const enabled = !!edgeAutoHideEl.checked;

          if (typeof ToolboxShell.setEdgeAutoHideEnabled === 'function') {
            ToolboxShell.setEdgeAutoHideEnabled(enabled);
          } else {
            MemoryManager.set(MemoryManager.KEYS.edgeAutoHideEnabled, enabled);
            ToolboxShell.appendLog(
              `[SETTINGS][edgeAutoHide] ${enabled ? '已开启' : '已关闭'}，但 ToolboxShell.setEdgeAutoHideEnabled 不存在`,
            );
          }

          render();
        });
      }

      const resetPosBtn = qs('#cgpt-setting-reset-toolbox-position', root);
      if (resetPosBtn) {
        resetPosBtn.addEventListener('click', () => {
          if (typeof ToolboxShell.resetToolboxPosition === 'function') {
            ToolboxShell.resetToolboxPosition();
          } else {
            ToolboxShell.appendLog('[SETTINGS][reset-position] ToolboxShell.resetToolboxPosition 不存在');
          }
        });
      }

      const forceShowBtn = qs('#cgpt-setting-force-show-toolbox', root);
      bindOnce(forceShowBtn, 'click', () => {
          if (typeof ToolboxShell.restoreToolboxFromHiddenState === 'function') {
            ToolboxShell.restoreToolboxFromHiddenState('settings-force-show');
          } else if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.__cgptToolboxShow === 'function') {
            unsafeWindow.__cgptToolboxShow();
          } else if (typeof window.__cgptToolboxShow === 'function') {
            window.__cgptToolboxShow();
          } else {
            ToolboxShell.appendLog('[SETTINGS][force-show-toolbox] restoreToolboxFromHiddenState 不存在');
          }

          if (typeof ToolboxShell.resetToolboxPosition === 'function') {
            ToolboxShell.resetToolboxPosition();
          }

          ToolboxShell.appendLog('[SETTINGS][force-show-toolbox]');
      });

      function readBeepFromUi() {
        const volumeEl = qs('#cgpt-setting-beep-volume', root);
        const durationEl = qs('#cgpt-setting-beep-duration', root);
        const frequencyEl = qs('#cgpt-setting-beep-frequency', root);
        const current = getBeepConfig();

        return normalizeBeepConfig({
          ...current,
          volume: volumeEl ? Number(volumeEl.value) : current.volume,
          durationMs: durationEl ? Number(durationEl.value) : current.durationMs,
          frequency: frequencyEl ? Number(frequencyEl.value) : current.frequency,
          type: current.type,
        });
      }

      function bindBeepSettingInput(id) {
        const el = qs(`#${id}`, root);
        bindOnce(el, 'change', () => {
          const cfg = readBeepFromUi();
          saveBeepConfig(cfg);
          ToolboxShell.appendLog(
            `[SETTINGS][beep] volume=${cfg.volume} durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
          );
        });
      }

      bindBeepSettingInput('cgpt-setting-beep-volume');
      bindBeepSettingInput('cgpt-setting-beep-duration');
      bindBeepSettingInput('cgpt-setting-beep-frequency');

      const beepCopySuccessEl = qs('#cgpt-setting-beep-copy-success-enabled', root);
      bindOnce(beepCopySuccessEl, 'change', () => {
        const current = getBeepConfig();
        const cfg = saveBeepConfig({
          ...current,
          copySuccessEnabled: beepCopySuccessEl.checked !== false,
        });

        ToolboxShell.appendLog(
          `[SETTINGS][beep-copy-success] enabled=${cfg.copySuccessEnabled !== false ? '1' : '0'}`,
        );
      }, {
        key: 'change:beep-copy-success-enabled',
        moduleName: 'SETTINGS',
      });

      const settingsBeepRefs = collectDomRefs(root, {
        testBeep: {
          selector: '#cgpt-setting-test-beep',
          required: false,
        },
        testTitleFlash: {
          selector: '#cgpt-setting-test-title-flash',
          required: false,
        },
        beepStatus: {
          selector: '#cgpt-setting-beep-status',
          required: false,
        },
      }, {
        moduleName: 'SETTINGS',
      });

      bindOnce(settingsBeepRefs.testBeep, 'click', async () => {
          const statusEl = settingsBeepRefs.beepStatus;

          if (statusEl) {
            statusEl.textContent = '正在测试...';
          }

          const cfg = saveBeepConfig(readBeepFromUi());

          ToolboxShell.appendLog(
            `[SETTINGS][beep-test] start volume=${cfg.volume} durationMs=${cfg.durationMs} frequency=${cfg.frequency}`,
          );

          const unlocked = await unlockToolboxAudio('settings-test');

          if (!unlocked) {
            if (statusEl) {
              statusEl.textContent = '测试失败：浏览器音频未解锁';
            }

            ToolboxShell.appendLog('[SETTINGS][beep-test] failed reason=unlock-failed');
            return;
          }

          const ok = await playToolboxBeep('settings-test', {
            volume: cfg.volume,
            durationMs: cfg.durationMs,
            frequency: cfg.frequency,
            type: cfg.type,
          });

          if (statusEl) {
            statusEl.textContent = ok
              ? '已播放测试蜂鸣'
              : '测试失败，请查看日志';
          }

          ToolboxShell.appendLog(`[SETTINGS][beep-test] result=${ok ? 'ok' : 'failed'}`);
      });

      bindOnce(settingsBeepRefs.testTitleFlash, 'click', () => {
        const statusEl = settingsBeepRefs.beepStatus;

        if (
          typeof TitlePrefixModule !== 'undefined'
          && typeof TitlePrefixModule.startReplyDoneFlash === 'function'
        ) {
          TitlePrefixModule.startReplyDoneFlash('settings-test', {
            intervalMs: 600,
            autoStopMs: 0,
          });

          if (
            typeof ToolboxShell !== 'undefined'
            && typeof ToolboxShell.flashHeaderTitleOnce === 'function'
          ) {
            ToolboxShell.flashHeaderTitleOnce('回复完成', {
              intervalMs: 600,
              autoStopMs: 0,
            });
          }

          if (statusEl) {
            statusEl.textContent = '已开始测试标题闪烁';
          }

          ToolboxShell.appendLog('[SETTINGS][title-flash-test] start');
          return;
        }

        if (statusEl) {
          statusEl.textContent = '测试失败：标题闪烁模块不可用';
        }

        ToolboxShell.appendLog('[SETTINGS][title-flash-test] failed reason=module-missing');
      });

      const settingsSubtabs = qs('#cgpt-settings-subtabs', root);
      bindOnce(settingsSubtabs, 'click', (e) => {
          const btn = e.target instanceof HTMLElement
            ? e.target.closest('[data-settings-subtab]')
            : null;

          if (!btn) return;

          e.preventDefault();
          e.stopPropagation();

          activeSettingsSubtab = btn.getAttribute('data-settings-subtab') || 'basic';
          MemoryManager.set('settingsActiveSubtab', activeSettingsSubtab);
          renderSettingsSubtabs();

          ToolboxShell.appendLog(`[SETTINGS][subtab] active=${activeSettingsSubtab}`);
      });
    }

    function mount(target) {
      host = target;
      if (!host) return;

      host.innerHTML = `
        <div class="cgpt-section cgpt-settings-module" id="cgpt-settings-module">
          <div class="cgpt-settings-subtabs" id="cgpt-settings-subtabs">
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="basic">基础</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="shortcut">快捷键</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="ui">界面</button>
            <button type="button" class="cgpt-settings-subtab" data-settings-subtab="batch-timing">批量计时</button>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="basic">
            <label class="cgpt-checkbox-line" title="开启后，拖动工具箱贴住浏览器右边缘后自动收起，只保留边缘把手；只是靠近边缘不会隐藏。关闭后只保留普通拖拽，不自动隐藏。">
              <input type="checkbox" id="cgpt-setting-edge-auto-hide">
              工具箱贴边自动隐藏
            </label>

            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn" id="cgpt-setting-reset-toolbox-position" title="重置工具箱在页面中的位置">重置工具箱位置</button>
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-force-show-toolbox" title="当工具箱跑出屏幕、贴边状态异常或隐藏后找不到入口时，可先强制显示，再按需重置位置。">强制显示工具箱</button>
            </div>

            <div class="cgpt-section-title" style="margin-top: 12px;">额度设置</div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-upload-quota-limit" title="该额度仅用于工具箱内部统计和提醒，不代表 ChatGPT 官方真实额度。">上传额度上限</label>
              <input
                type="number"
                class="cgpt-input"
                id="cgpt-setting-upload-quota-limit"
                data-no-wheel-number="1"
                min="1"
                max="10000"
                step="1"
                title="该额度仅用于工具箱内部统计和提醒，不代表 ChatGPT 官方真实额度。"
              >
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-message-quota-limit" title="该额度仅用于工具箱内部统计和提醒，不代表 ChatGPT 官方真实额度。">消息额度上限</label>
              <input
                type="number"
                class="cgpt-input"
                id="cgpt-setting-message-quota-limit"
                data-no-wheel-number="1"
                min="1"
                max="10000"
                step="1"
                title="该额度仅用于工具箱内部统计和提醒，不代表 ChatGPT 官方真实额度。"
              >
            </div>

            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-quota-save" title="修改上限后顶部「上传额度 / 消息额度」的分母会立即更新。">保存额度设置</button>
              <button type="button" class="cgpt-btn" id="cgpt-setting-quota-reset-stats" title="只清空工具箱内部已用计数，不会改动上限配置。">重置今日统计</button>
            </div>

            <div class="cgpt-section-title" style="margin-top: 12px;">蜂鸣器</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-beep-copy-success-enabled">
              复制成功后播放蜂鸣器
            </label>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-volume">音量</label>
              <input type="range" class="cgpt-input" id="cgpt-setting-beep-volume" min="0.05" max="1" step="0.05">
            </div>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-duration">时长 (毫秒)</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-beep-duration" data-no-wheel-number="1" min="30" max="10000" step="10">
            </div>
            <div class="cgpt-kv">
              <label for="cgpt-setting-beep-frequency">频率 (Hz)</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-beep-frequency" data-no-wheel-number="1" min="80" max="6000" step="10">
            </div>
            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn primary" id="cgpt-setting-test-beep" title="蜂鸣器用于复制成功提醒；浏览器可能要求先点击页面或工具箱一次后才允许播放声音。">测试蜂鸣器</button>
              <button type="button" class="cgpt-btn" id="cgpt-setting-test-title-flash">测试标题闪烁</button>
              <span id="cgpt-setting-beep-status">未测试</span>
            </div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="shortcut">
            <div class="cgpt-shortcut-settings">
              <div class="cgpt-shortcut-row" data-shortcut-action="sendMessage">
                <label class="cgpt-checkbox-line" title="发送信息快捷键用于直接发送消息。建议使用 Ctrl+Alt+S 等组合键；普通 Enter 仅在 ChatGPT 输入框内由页面原生处理。">
                  <input type="checkbox" id="cgpt-shortcut-send-enabled">
                  启用发送信息快捷键
                </label>
                <input id="cgpt-shortcut-send-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-send-record" title="点击录制后按下完整快捷键，例如 Ctrl+Alt+S。只按 Ctrl/Alt/Shift 不会保存，需再按一个主键。按 Esc 可取消。">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-send-clear">清空</button>
              </div>

              <div class="cgpt-shortcut-row" data-shortcut-action="copyAndHotkeyOnce">
                <label class="cgpt-checkbox-line" title="按下该快捷键后，会先复制最后一条回复，再触发下方配置的目标快捷键。">
                  <input type="checkbox" id="cgpt-shortcut-copy-hotkey-enabled">
                  启用复制并触发快捷键
                </label>
                <input id="cgpt-shortcut-copy-hotkey-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-hotkey-record" title="点击录制后按下完整快捷键。只按 Ctrl/Alt/Shift 不会保存，需再按一个主键。按 Esc 可取消。">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-hotkey-clear">清空</button>
              </div>

              <div class="cgpt-shortcut-row cgpt-shortcut-row-target" data-shortcut-action="copyThenShortcutTargetHotkey">
                <span class="cgpt-shortcut-row-label" title="复制完成后由 GUI 发送的系统快捷键，不是页面内快捷键。">复制后触发的目标快捷键</span>
                <input id="cgpt-shortcut-copy-then-target-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-then-target-record" title="录制后由 GUI 执行的组合键，例如 Ctrl+Alt+I。按 Esc 可取消。">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-copy-then-target-clear">清空</button>
              </div>

              <div class="cgpt-shortcut-row" data-shortcut-action="startUpload">
                <label class="cgpt-checkbox-line" title="开始上传快捷键用于触发当前队列上传。">
                  <input type="checkbox" id="cgpt-shortcut-upload-enabled">
                  启用开始上传快捷键
                </label>
                <input id="cgpt-shortcut-upload-label" class="cgpt-input" readonly>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-upload-record" title="点击录制后按下完整快捷键。只按 Ctrl/Alt/Shift 不会保存，需再按一个主键。按 Esc 可取消。">录制</button>
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-upload-clear">清空</button>
              </div>

              <div class="cgpt-row">
                <button type="button" class="cgpt-btn" id="cgpt-shortcut-reset-defaults">
                  恢复默认快捷键
                </button>
              </div>
            </div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="ui">
            <div class="cgpt-section-title" style="margin-top: 4px;">精简模式显示内容</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-upload-groups">
              显示项目分组栏
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-upload-start">
              显示上传按钮
            </label>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-compact-show-file-list">
              显示上传文件列表
            </label>

            <div class="cgpt-section-title" style="margin-top: 10px;">拖拽上传</div>
            <label class="cgpt-checkbox-line" title="拖到 ChatGPT 输入框仍由 ChatGPT 原生处理；拖到工具箱面板内始终加入队列。">
              <input type="checkbox" id="cgpt-setting-global-drop-capture">
              页面空白处拖入文件时加入工具箱队列
            </label>

            <div class="cgpt-section-title" style="margin-top: 10px;">复制回复</div>
            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-restore-scroll-after-copy">
              复制最后消息后恢复原滚动位置
            </label>

            <div class="cgpt-section-title" style="margin-top: 10px;">连续复制+快捷键+继续（循环附加）</div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-copy-hotkey-loop-auto-upload-enabled">
              每隔指定轮数自动重新上传当前分组文件
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-loop-auto-upload-interval">上传间隔轮数</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-copy-hotkey-loop-auto-upload-interval" data-no-wheel-number="1" min="1" max="999" step="1">
            </div>

            <label class="cgpt-checkbox-line">
              <input type="checkbox" id="cgpt-setting-copy-hotkey-loop-home-nav-enabled">
              每隔指定轮数页内跳转到 ChatGPT 主页
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-loop-home-nav-interval">跳转间隔轮数</label>
              <input type="number" class="cgpt-input" id="cgpt-setting-copy-hotkey-loop-home-nav-interval" data-no-wheel-number="1" min="1" max="999" step="1">
            </div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-loop-home-nav-url" title="默认每 5 轮重新上传一次文件，每 20 轮页内跳转到 https://chatgpt.com/。若同一轮同时命中上传和跳转，优先跳转。">跳转地址</label>
              <input type="text" class="cgpt-input" id="cgpt-setting-copy-hotkey-loop-home-nav-url" title="默认每 5 轮重新上传一次文件，每 20 轮页内跳转到 https://chatgpt.com/。若同一轮同时命中上传和跳转，优先跳转。">
            </div>

            <div class="cgpt-section-title" style="margin-top: 10px;">复制+快捷键+继续</div>

            <div class="cgpt-kv">
              <label for="cgpt-setting-copy-hotkey-continue-stop-signal">终止信号</label>
              <input
                type="text"
                class="cgpt-input"
                id="cgpt-setting-copy-hotkey-continue-stop-signal"
                placeholder="<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>"
              >
            </div>

            <div class="cgpt-kv cgpt-kv-vertical">
              <label for="cgpt-setting-copy-hotkey-continue-prompt-text">继续指令</label>
              <textarea
                class="cgpt-input"
                id="cgpt-setting-copy-hotkey-continue-prompt-text"
                rows="12"
                style="width: 100%; resize: vertical;"
                placeholder="留空则使用内置默认继续指令（完成时仅回复 <<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>）。"
              ></textarea>
            </div>

            <div class="cgpt-row">
              <button type="button" class="cgpt-btn" id="cgpt-setting-copy-hotkey-continue-prompt-reset" title="单次或连续「复制+快捷键+继续」会发送上面的继续指令。若 ChatGPT 仅回复终止信号（整段回复只有这一行），将停止复制、快捷键与继续发送。">
                恢复默认继续指令
              </button>
            </div>
          </div>

          <div class="cgpt-settings-panel" data-settings-panel="batch-timing">
            <div class="cgpt-section-title" style="margin-top: 4px;">批量任务计时统计</div>

            <label class="cgpt-checkbox-line" title="在「自动指令 → 批量任务组模式」状态区显示运行/批量/当前任务耗时、平均耗时与预计剩余时间。当前任务耗时仅在消息真正发送成功后开始计时。">
              <input type="checkbox" id="cgpt-setting-runtime-stats-show">
              显示计时统计
            </label>

            <label class="cgpt-checkbox-line" title="开启后，开始新的批量任务组时仍沿用上一轮已完成任务的平均耗时；关闭则每轮批量重新开始统计。">
              <input type="checkbox" id="cgpt-setting-runtime-stats-preserve-average">
              保留历史平均耗时
            </label>

            <div class="cgpt-kv">
              <label for="cgpt-setting-runtime-stats-refresh-interval">计时刷新间隔</label>
              <select class="cgpt-select" id="cgpt-setting-runtime-stats-refresh-interval">
                <option value="1000">1000 ms</option>
                <option value="2000">2000 ms</option>
                <option value="5000">5000 ms</option>
              </select>
            </div>

            <div class="cgpt-row" style="margin-top: 8px;">
              <button type="button" class="cgpt-btn" id="cgpt-setting-runtime-stats-reset" title="重置会清空批量/任务计时与平均耗时，但不会重置「程序运行时长」。">重置计时统计</button>
            </div>
          </div>
        </div>
      `;

      root = host;

      collectDomRefs(root, {
        subtabs: '#cgpt-settings-subtabs',
        testBeep: {
          selector: '#cgpt-setting-test-beep',
          required: false,
        },
        beepStatus: {
          selector: '#cgpt-setting-beep-status',
          required: false,
        },
      }, {
        moduleName: 'SETTINGS',
      });

      activeSettingsSubtab = MemoryManager.get('settingsActiveSubtab', 'basic');
      bindEvents();
      render();
      renderShortcutSettings();
      renderSettingsSubtabs();
    }

    return {
      mount,
      getConfig,
      saveConfig,
    };
  })();
