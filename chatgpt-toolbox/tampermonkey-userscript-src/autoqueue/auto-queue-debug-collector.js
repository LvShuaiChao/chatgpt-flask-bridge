  /********************************************************************
   * AutoQueueDebugCollector：自动队列高级调试基础状态采集
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责页面/输入区/按钮/任务/上传基础调试快照采集。
   * 3. 不负责回复等待判定、不负责发送、不负责上传执行、不负责闭环、不负责按钮绑定。
   ********************************************************************/
  const AutoQueueDebugCollector = (() => {
    function create(deps = {}) {
      const state = deps.state;
      const config = deps.config;
      const appendLog = deps.appendLog;
      const resolveAutoQueueAttachmentSnapshot = deps.resolveAutoQueueAttachmentSnapshot;
      const getPanelMessageQuotaState = deps.getPanelMessageQuotaState;
      const getPanelUploadQuotaState = deps.getPanelUploadQuotaState;
      const getActiveTaskProfile = deps.getActiveTaskProfile;
      const getEnabledTasksFromProfile = deps.getEnabledTasksFromProfile;
      const getTaskBatchFailureDisplayText = deps.getTaskBatchFailureDisplayText;
      const getBridgePageDisplayIdText = deps.getBridgePageDisplayIdText;

      function appendLogSafe(line) {
        const text = String(line || '').trim();
        if (!text) {
          return;
        }
        if (typeof appendLog === 'function') {
          appendLog(text);
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

      function requireFn(name, fn) {
        if (typeof fn !== 'function') {
          const message = '[AUTOQ_DEBUG_COLLECTOR][DEPENDENCY_MISSING] name=' + name;
          console.error(message, { name });
          throw new Error(message);
        }
        return fn;
      }

      function resolveAutoQueueAttachmentSnapshotSafe(options) {
        return requireFn(
          'resolveAutoQueueAttachmentSnapshot',
          resolveAutoQueueAttachmentSnapshot,
        )(options);
      }

      function getPanelMessageQuotaStateSafe(options) {
        return requireFn('getPanelMessageQuotaState', getPanelMessageQuotaState)(options);
      }

      function getPanelUploadQuotaStateSafe(options) {
        return requireFn('getPanelUploadQuotaState', getPanelUploadQuotaState)(options);
      }

      function getActiveTaskProfileSafe() {
        return requireFn('getActiveTaskProfile', getActiveTaskProfile)();
      }

      function getEnabledTasksFromProfileSafe(profile) {
        return requireFn('getEnabledTasksFromProfile', getEnabledTasksFromProfile)(profile);
      }

      function getTaskBatchFailureDisplayTextSafe() {
        return requireFn(
          'getTaskBatchFailureDisplayText',
          getTaskBatchFailureDisplayText,
        )();
      }

      function getBridgePageDisplayIdTextSafe() {
        if (typeof getBridgePageDisplayIdText === 'function') {
          return getBridgePageDisplayIdText();
        }
        if (typeof globalThis !== 'undefined' && typeof globalThis.getBridgePageDisplayIdText === 'function') {
          return globalThis.getBridgePageDisplayIdText();
        }
        return '';
      }

    function collectSectionSafe(sectionName, collector) {
      try {
        return collector();
      } catch (error) {
        const message = error && error.stack ? error.stack : String(error);
        appendLogSafe(`[ADV_DEBUG][COLLECT_ERROR] section=${sectionName} error=${message}`);
        console.error('[ADV_DEBUG][COLLECT_ERROR]', sectionName, error);
        return { error: message };
      }
    }

    function extractConversationIdFromUrl() {
      const match = String(location.href).match(/\/c\/([^/?#]+)/);
      return match ? match[1] : '';
    }

    function describeElementSafe(el) {
      if (!el) {
        return { found: false };
      }
      const rect = el.getBoundingClientRect();
      return {
        found: true,
        tag: el.tagName,
        text: String(el.innerText || el.textContent || '').trim().slice(0, 80),
        ariaLabel: String(el.getAttribute('aria-label') || '').slice(0, 80),
        title: String(el.getAttribute('title') || '').slice(0, 80),
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        visible: rect.width > 0 && rect.height > 0,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      };
    }

    function findComposerElementSafe() {
      if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.getComposer === 'function') {
        return ComposerApi.getComposer();
      }
      return document.querySelector('[data-testid="composer"] [contenteditable="true"], #prompt-textarea, textarea[name="prompt-textarea"]');
    }

    function getComposerTextSafe(composer) {
      if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.getComposerText === 'function') {
        return String(ComposerApi.getComposerText() || '');
      }
      if (composer && 'value' in composer) {
        return String(composer.value || '');
      }
      return composer ? String(composer.textContent || '') : '';
    }

    function getComposerAttachmentSnapshotSafe() {
      const snap = resolveAutoQueueAttachmentSnapshotSafe({ detailed: true });
      if (!snap || typeof snap !== 'object') {
        return {
          rawCount: 0,
          normalizedCount: 0,
          readyCount: 0,
        };
      }
      return {
        rawCount: Number(snap.rawCount || snap.totalCount || snap.chipCount || 0) || 0,
        normalizedCount: Number(snap.normalizedCount || snap.uniqueCount || snap.totalCount || 0) || 0,
        readyCount: Number(snap.readyCount || snap.readyAttachmentCount || 0) || 0,
      };
    }

    function isComposerDisabledSafe(composer) {
      if (!composer) {
        return true;
      }
      if (composer.disabled || composer.getAttribute('aria-disabled') === 'true') {
        return true;
      }
      if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.canAcceptInput === 'function') {
        return !ComposerApi.canAcceptInput();
      }
      return false;
    }

    function detectCanSendSafe() {
      if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.canSendNow === 'function') {
        return !!ComposerApi.canSendNow();
      }
      const sendBtn = typeof ComposerApi !== 'undefined' && typeof ComposerApi.findSendButton === 'function'
        ? ComposerApi.findSendButton({ silent: true })
        : null;
      return !!sendBtn && !sendBtn.disabled;
    }

    function detectIsGeneratingSafe() {
      if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.isAssistantLikelyBusy === 'function') {
        return !!ComposerApi.isAssistantLikelyBusy();
      }
      if (typeof hasRealChatGPTStopGeneratingButton === 'function') {
        return hasRealChatGPTStopGeneratingButton();
      }
      return !!document.querySelector('[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]');
    }

    function findSendButtonSafe() {
      if (typeof ComposerApi !== 'undefined' && typeof ComposerApi.findSendButton === 'function') {
        return ComposerApi.findSendButton({ silent: true });
      }
      return null;
    }

    function findStopButtonSafe() {
      if (typeof findRealChatGPTStopGeneratingButton === 'function') {
        return findRealChatGPTStopGeneratingButton();
      }
      return document.querySelector('[data-testid="stop-button"], button[aria-label*="停止"], button[aria-label*="Stop"]');
    }

    function findContinueButtonSafe() {
      const selectors = [
        'button[data-testid*="continue"]',
        'button[aria-label*="Continue"]',
        'button[aria-label*="继续"]',
      ];
      for (const selector of selectors) {
        const hit = document.querySelector(selector);
        if (hit) {
          return hit;
        }
      }
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((btn) => /继续生成|Continue generating/i.test(String(btn.innerText || btn.textContent || ''))) || null;
    }

    function findAttachButtonSafe() {
      const selectors = [
        'button[data-testid="composer-plus-btn"]',
        'button[aria-label*="Attach"]',
        'button[aria-label*="附加"]',
        'button[aria-label*="上传"]',
      ];
      for (const selector of selectors) {
        const hit = document.querySelector(selector);
        if (hit) {
          return hit;
        }
      }
      return null;
    }

    function findFileInputSafe() {
      const composerRoot = typeof ComposerApi !== 'undefined' && typeof ComposerApi.getComposerRoot === 'function'
        ? ComposerApi.getComposerRoot()
        : null;
      const scope = composerRoot instanceof HTMLElement ? composerRoot : document;
      return scope.querySelector('input[type="file"]');
    }

    function findRegenerateButtonSafe() {
      return document.querySelector('[data-testid*="regenerate"], button[aria-label*="Regenerate"], button[aria-label*="重新生成"]');
    }

    function findVoiceButtonSafe() {
      const selectors = [
        'button[data-testid*="voice"]',
        'button[aria-label*="Voice"]',
        'button[aria-label*="语音"]',
        'button[aria-label*="Dictate"]',
      ];
      for (const selector of selectors) {
        const hit = document.querySelector(selector);
        if (hit) {
          return hit;
        }
      }
      return null;
    }

    function getLastAssistantReplyTextSafe() {
      if (typeof getLastAssistantReplyText === 'function') {
        return String(getLastAssistantReplyText() || '');
      }
      const nodes = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
      const lastNode = nodes.length > 0 ? nodes[nodes.length - 1] : null;
      return lastNode ? String(lastNode.innerText || lastNode.textContent || '').trim() : '';
    }

    function collectPageDebugState() {
      return {
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
        readyState: document.readyState,
        scrollY: window.scrollY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        conversationId: extractConversationIdFromUrl(),
        pageDisplayId: typeof getBridgePageDisplayIdText === 'function'
          ? String(getBridgePageDisplayIdTextSafe() || '')
          : '',
      };
    }

    function collectComposerDebugState() {
      const composer = findComposerElementSafe();
      const text = getComposerTextSafe(composer);
      const attachments = getComposerAttachmentSnapshotSafe();
      return {
        composerFound: !!composer,
        composerDisabled: isComposerDisabledSafe(composer),
        composerTextLength: text.length,
        composerTextPreview: text.slice(0, 80),
        attachmentRawCount: attachments.rawCount,
        attachmentNormalizedCount: attachments.normalizedCount,
        attachmentReadyCount: attachments.readyCount,
        canSend: detectCanSendSafe(),
        isGenerating: detectIsGeneratingSafe(),
      };
    }

    function collectButtonDebugState() {
      return {
        chatgpt: {
          sendButton: describeElementSafe(findSendButtonSafe()),
          stopButton: describeElementSafe(findStopButtonSafe()),
          continueButton: describeElementSafe(findContinueButtonSafe()),
          attachButton: describeElementSafe(findAttachButtonSafe()),
          fileInput: describeElementSafe(findFileInputSafe()),
          voiceButton: describeElementSafe(findVoiceButtonSafe()),
          regenerateButton: describeElementSafe(findRegenerateButtonSafe()),
        },
        toolbox: {
          startUploadButton: describeElementSafe(document.querySelector('#cgpt-autoq-start-upload')),
          startBatchButton: describeElementSafe(document.querySelector('#cgpt-autoq-start')),
          sendInitialOnlyButton: describeElementSafe(document.querySelector('#cgpt-autoq-send-once')),
          copyLogButton: describeElementSafe(document.querySelector('#cgpt-autoq-copy-log')),
          advancedDebugButton: describeElementSafe(document.querySelector('#xz-autoq-advanced-debug-toggle-btn')),
        },
      };
    }

    function collectAutoQueueDebugState() {
      const run = ensureTaskRunVerificationFields(state.taskRun || {});
      const profile = typeof getActiveTaskProfile === 'function' ? getActiveTaskProfileSafe() : null;
      const currentTask = typeof getCurrentRunningTask === 'function' ? getCurrentRunningTask() : null;
      const taskInfo = config.promptMode === 'task' && typeof getCurrentTaskRunInfo === 'function'
        ? getCurrentTaskRunInfo()
        : null;
      const completedCount = taskInfo
        ? Math.max(0, Number(taskInfo.doneCount) || 0)
        : 0;

      return {
        mode: config.promptMode || '',
        phase: String(state.phase || ''),
        batchDisplayState: state.batchTask ? String(state.batchTask.displayState || '') : '',
        status: state.running ? 'running' : 'stopped',
        currentStep: run.currentStep || '',
        currentIndex: run.currentIndex,
        total: Array.isArray(run.enabledTaskIds) ? run.enabledTaskIds.length : 0,
        sentCount: Number(run.totalSentDialogueCount || state.sentCount || 0) || 0,
        completedCount,
        activeProfileId: config.activeTaskProfileId || '',
        activeProfileName: profile ? profile.name : '',
        currentTaskId: run.currentTaskId || state.currentTaskId || (currentTask ? currentTask.id : ''),
        currentTaskTitle: run.currentTaskTitle || (currentTask ? currentTask.title : ''),
        isRunning: !!state.running,
        isPaused: false,
        isStopping: !!(state.batchTask && state.batchTask.stopRequested),
        waitingForReply: !!state.waitingReply,
        waitingForUpload: !!(run.waitingUpload || state.uploadingFromAutoQueue || state.batchAutoUploading),
        doneSignalVerificationRunning: !!run.doneSignalVerificationRunning,
        terminalConfirmPending: !!state.terminalConfirming,
        terminalConfirmSource: state.terminalConfirmSource || '',
        lastError: getTaskBatchFailureDisplayTextSafe(),
        lastReason: String(run.lastReplyClassifyReason || run.lastSendRetryReason || ''),
        lastReplyClassifyStatus: String(run.lastReplyClassifyStatus || ''),
        phaseReason: String(state.phaseReason || ''),
        displayReason: state.batchTask ? String(state.batchTask.displayReason || '') : '',
        lastFailure: state.lastTaskBatchFailureReason || null,
        lastStop: state.lastTaskBatchStopReason || null,
        pendingSendKind: String(run.pendingSendKind || ''),
      };
    }

    function collectUploadDebugState() {
      let uploadStatus = {};
      if (typeof UploadModule !== 'undefined' && typeof UploadModule.getStatus === 'function') {
        uploadStatus = UploadModule.getStatus();
      } else if (typeof UploadModule !== 'undefined' && typeof UploadModule.getUnifiedRuntimeStatus === 'function') {
        const runtime = UploadModule.getUnifiedRuntimeStatus('adv-debug');
        uploadStatus = runtime && runtime.uploadQueue ? runtime.uploadQueue : {};
      }

      const messageQuota = getPanelMessageQuotaStateSafe({ logSnapshot: false });
      const uploadQuota = getPanelUploadQuotaStateSafe({ logSnapshot: false });
      const attachSnap = getComposerAttachmentSnapshotSafe();
      const stats = state.autoQueueUploadStats || {};

      return {
        queueTotal: Number(uploadStatus.totalUploadItems || uploadStatus.total || 0) || 0,
        attached: Number(uploadStatus.attached || 0) || 0,
        failed: Number(uploadStatus.failed || 0) || 0,
        missing: Number(uploadStatus.missing || 0) || 0,
        isUploading: !!(uploadStatus.running || uploadStatus.uploadRunning || state.uploadingFromAutoQueue),
        autoQueueUploadStatus: String(state.autoQueueUploadStatus || ''),
        lastUploadSource: String(uploadStatus.lastRealUploadErrorSource || stats.reason || ''),
        lastUploadError: String(uploadStatus.lastRealUploadError || stats.reason || '').slice(0, 200),
        localUploadUsed: Number(uploadQuota.used || 0) || 0,
        localUploadLimit: Number(uploadQuota.limit || uploadQuota.maxFiles || 0) || 0,
        localEnhanceUsed: Number(messageQuota.used || 0) || 0,
        localEnhanceLimit: Number(messageQuota.limit || messageQuota.maxMessages || 0) || 0,
        composerAttachmentCount: attachSnap.normalizedCount,
        pendingUploadFileCount: Number(runPendingUploadCountSafe()),
      };
    }

    function runPendingUploadCountSafe() {
      const run = state.taskRun || {};
      return Number(run.uploadFileCountForCurrentTask || 0) || 0;
    }


      return Object.freeze({
        collectSectionSafe,
        extractConversationIdFromUrl,
        describeElementSafe,
        findComposerElementSafe,
        getComposerTextSafe,
        getComposerAttachmentSnapshotSafe,
        isComposerDisabledSafe,
        detectCanSendSafe,
        detectIsGeneratingSafe,
        findSendButtonSafe,
        findStopButtonSafe,
        findContinueButtonSafe,
        findAttachButtonSafe,
        findFileInputSafe,
        findRegenerateButtonSafe,
        findVoiceButtonSafe,
        getLastAssistantReplyTextSafe,
        collectPageDebugState,
        collectComposerDebugState,
        collectButtonDebugState,
        collectAutoQueueDebugState,
        collectUploadDebugState,
        runPendingUploadCountSafe,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueDebugCollector = AutoQueueDebugCollector;


