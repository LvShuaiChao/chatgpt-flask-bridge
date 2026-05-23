    function bindUploadSendShortcut() {
      if (uploadSendShortcutBound) {
        return;
      }
      uploadSendShortcutBound = true;
      document.addEventListener('keydown', (e) => {
        handleUploadSendShortcutKeydown(e, 'document');
      }, true);
      window.addEventListener('keydown', (e) => {
        handleUploadSendShortcutKeydown(e, 'window');
      }, true);
      ToolboxShell.appendLog('[SHORTCUT][bind] send=configurable');
    }

    let uploadStartShortcutBound = false;
    let uploadStartShortcutLastAt = 0;

    function isUploadStartShortcutEvent(e) {
      const cfg = getShortcutConfig();
      return isShortcutEventMatched(e, cfg.startUpload);
    }

    function bindUploadStartShortcut() {
      if (uploadStartShortcutBound) {
        return;
      }

      uploadStartShortcutBound = true;

      document.addEventListener('keydown', (e) => {
        if (!isUploadStartShortcutEvent(e)) {
          return;
        }

        if (e.repeat) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (isEditableTarget(e.target)) {
          return;
        }

        if (shouldSkipGlobalShortcutForToolboxTarget(e.target)) {
          return;
        }

        const now = Date.now();
        if (now - uploadStartShortcutLastAt < 800) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        uploadStartShortcutLastAt = now;

        e.preventDefault();
        e.stopPropagation();

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][upload-shortcut:trigger] key=${e.key || '-'} code=${e.code || '-'}`
        );

        const btn = qs(UploadSelectors.startBtn);
        if (btn) {
          btn.click();
          return;
        }

        ToolboxShell.appendLog('[UPLOAD_DIAG][upload-shortcut:failed] reason=button-not-found');
      }, true);

      ToolboxShell.appendLog('[SHORTCUT][bind] upload-start=configurable');
    }

    async function startUpload(options = {}) {
      const opts = options || {};
      const forceRestart = !!opts.forceRestart;
      const uploadReason = opts.reason || 'default';
      let finalResult = null;

      healStaleUploadRunningLockIfNeeded('startUpload');

      if (state.running) {
        if (forceRestart) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:force-restart] reason=${uploadReason} runId=${state.runId}`
          );
          cancelCurrentUploadRun(`startUpload-force-restart:${uploadReason}`);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:force-restart-wait-old-run] reason=${uploadReason} runId=${state.runId}`
          );
          await sleep(120);
          state.cancelled = false;
        } else {
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-already-running]');
          return buildUploadSkipResult('already-running');
        }
      }

      if (!ensureActiveUploadGroupIdValid('start-upload')) {
        if (!state.groups.length) {
          setStatus('请先选择文件组');
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-groups]');
          appendUploadGroupLog('START_UPLOAD', { phase: 'blocked', reason: 'no-groups' });
          return buildUploadSkipResult('no-active-group');
        }
      }

      if (!state.activeGroupId) {
        setStatus('请先选择文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-active-group]');
        appendUploadGroupLog('START_UPLOAD', { phase: 'blocked', reason: 'empty-activeGroupId' });
        return buildUploadSkipResult('no-active-group');
      }

      const activeFiles = getActiveGroupFiles();
      appendUploadGroupLog('START_UPLOAD', { phase: 'plan' });

      if (!activeFiles.length) {
        setStatus('当前项目没有文件');
        ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-empty-queue]');
        return buildUploadSkipResult('empty-queue');
      }

      refreshQueueReadableState();
      await reconcileFailedItems();
      scheduleRenderUpload('startUpload:after-refresh');
      persistQueueThrottled('startUpload:after-refresh');

      logUploadQueueSnapshot('startUpload:after-refresh');

      const attachedCount = activeFiles.filter((q) => q && q.state === UploadState.ATTACHED).length;
      const uploadablePlan = activeFiles.filter((q) => {
        return q &&
          q.state !== UploadState.ATTACHED &&
          q.state !== UploadState.CANCELLED;
      });

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][startUpload:plan] group=${getActiveGroupId() || '-'} total=${activeFiles.length} attached=${attachedCount} uploadable=${uploadablePlan.length}`
      );

      const uploadableTargets = activeFiles.filter(isUploadItemUploadable);
      const missingTargets = activeFiles.filter(isUploadItemMissingSource);

      uploadableTargets.forEach((q) => {
        logUploadItemSource('startUpload:uploadable', q);
      });

      missingTargets.forEach((q) => {
        logUploadItemSource('startUpload:missing', q, {
          reason: 'not readable before upload',
        });
      });

      if (!uploadableTargets.length) {
        const totalCount = activeFiles.filter(Boolean).length;

        if (totalCount > 0 && attachedCount === totalCount) {
          setStatus(`当前分组文件已全部绑定：${attachedCount}/${totalCount}；再次点击“开始上传”将再次绑定`, 'success');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:skip-all-attached] attached=${attachedCount} total=${totalCount}`,
          );
          return buildUploadResult(attachedCount, 0, false, totalCount, {
            skipped: true,
            reason: 'all-attached',
          });
        }

        scheduleRenderUpload('startUpload:skip-no-targets');
        setStatus(`当前没有可上传文件，缺失 ${missingTargets.length} 个，请重新绑定或重新拖入`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][startUpload:skip-no-targets] missing=${missingTargets.length}`,
        );
        return buildUploadSkipResult('no-uploadable-targets', {
          failed: missingTargets.length,
          total: totalCount,
        });
      }

      const missingChanged = markMissingLocalFiles([
        ...uploadableTargets,
        ...missingTargets,
      ]);

      if (missingChanged) {
        scheduleRenderUpload('startUpload:missing-marked');
        persistQueueThrottled('startUpload:missing-marked');
      }

      if (missingTargets.length) {
        ToolboxShell.appendLog(
          `本次跳过 ${missingTargets.length} 个缺少文件项，继续上传 ${uploadableTargets.length} 个可上传文件`
        );
      }

      startDuplicateWatcher();

      state.running = true;
      state.cancelled = false;
      state.runId += 1;
      const runId = state.runId;
      state.uploadAbortController = new AbortController();

      scheduleRenderUpload('startUpload:before-loop');

      ToolboxShell.appendLog(`开始批量上传：当前：${getActiveGroupName()}，文件数 ${uploadableTargets.length}`);

      uploadableTargets.forEach((q) => {
        if (
          q.state === UploadState.CANCELLED ||
          q.state === UploadState.FAILED
        ) {
          q.state = UploadState.IDLE;
          q.message = '';
          q.uploadName = '';
        }
      });

      persistQueueThrottled('startUpload:before-upload');

      const total = uploadableTargets.length;

      try {
        for (let i = 0; i < uploadableTargets.length; i += 1) {
          if (state.cancelled || runId !== state.runId) {
            break;
          }

          const q = uploadableTargets[i];
          state.activeId = q.id;

          setStatus(`正在上传 ${getActiveGroupName()} ${i + 1}/${total}：${q.name}`);
          ToolboxShell.appendLog(`批量上传 ${i + 1}/${total} 个：${q.name}`);

          await uploadOne(q, i + 1, total, {
            runId,
            signal: state.uploadAbortController.signal,
          });

          if (state.cancelled || runId !== state.runId) {
            break;
          }
        }

        let settledTargets = resolveUploadTargets(uploadableTargets);

        settledTargets.forEach((item) => {
          if (isUploadUnfinishedState(item.state)) {
            updateItem(item.id, {
              state: UploadState.FAILED,
              message: '上传流程结束时仍未完成',
            });
          }
        });

        await reconcileFailedItems();

        settledTargets = resolveUploadTargets(uploadableTargets);

        const result = countUploadResult([...settledTargets, ...missingTargets]);

        if (areAllUploadTargetsSettled(settledTargets)) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:all-targets-settled] success=${result.success} failed=${result.failed}`
          );
        }

        const finalTargets = [...settledTargets, ...missingTargets];
        const allAttached = finalTargets.every((q) => q && q.state === UploadState.ATTACHED);

        if (!allAttached) {
          await waitUntilComposerUploadIdle({
            runId,
            signal: state.uploadAbortController && state.uploadAbortController.signal,
            timeoutMs: 3000,
          });
        } else {
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-idle-wait] 所有文件已确认 ATTACHED，跳过长时间空闲等待');
        }
      } finally {
        stopDuplicateWatcher(3000);

        if (runId === state.runId || state.cancelled) {
          const stillRunningItems = state.queue.filter((item) => {
            return item && isUploadUnfinishedState(item.state);
          });

          if (stillRunningItems.length) {
            stillRunningItems.forEach((item) => {
              item.state = UploadState.FAILED;
              item.message = '上传流程超时或未正常结束，请重新点击上传';
            });

            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][startUpload:force-clear-running-items] count=${stillRunningItems.length}`
            );
          }

          state.running = false;
          state.activeId = '';
          state.uploadAbortController = null;

          const settledTargets = resolveUploadTargets(uploadableTargets);
          const result = countUploadResult([...settledTargets, ...missingTargets]);

          renderUploadButtonsOnly();
          render();

          const uploadStatusType = state.cancelled
            ? 'warn'
            : result.failed > 0
              ? 'error'
              : 'success';
          const uploadStatusText = state.cancelled
            ? `已停止上传：成功 ${result.success}，失败 ${result.failed}`
            : result.failed > 0
              ? `上传未全部完成：成功 ${result.success}，失败 ${result.failed}`
              : `上传完成：成功 ${result.success}，失败 0`;
          setStatus(uploadStatusText, uploadStatusType);

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:finalize] success=${result.success} failed=${result.failed} running=${state.running} groupId=${state.activeGroupId || '-'}`,
          );

          persistQueueInBackground('startUpload:finalize');

          finalResult = buildUploadResult(
            result.success,
            result.failed,
            state.cancelled,
            uploadableTargets.length + missingTargets.length,
          );
        } else {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:skip-finalize-run-mismatch] runId=${runId} currentRunId=${state.runId} cancelled=${state.cancelled ? 1 : 0}`
          );
        }

        window.setTimeout(() => {
          const healed = healStaleUploadRunningLockIfNeeded(`startUpload:finally:${uploadReason}`);

          if (healed) {
            render();
            persistQueueInBackground(`startUpload:finally-healed:${uploadReason}`);
          }
        }, 300);
      }

      return finalResult || buildUploadSkipResult('upload-not-finalized');
    }

    function isQueueItemAlreadyUploaded(q) {
      if (!q) return true;
      if (q.status === 'uploaded') return true;
      return q.state === UploadState.ATTACHED;
    }

    function isFlaskLocalDirectItem(item) {
      if (!item) return false;
      const source = String(
        item.source || item.origin || item.kind || item.sourceKind || '',
      ).trim();
      return (
        source === 'local_direct'
        || source === 'flask'
        || source === 'flask_local_direct'
        || item.local_direct === true
        || item.flask_local_direct === true
        || !!item.file_id
        || !!item.download_url
      );
    }

    function normalizeFlaskFilesFromBridge(list) {
      const rows = Array.isArray(list) ? list : [];
      return rows
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          ...item,
          source: 'flask_local_direct',
          status: item.status || 'pending',
        }));
    }

    function applyBridgeUploadFiles(patch) {
      const payload = patch && typeof patch === 'object' ? patch : {};
      if (!Object.prototype.hasOwnProperty.call(payload, 'upload_files')) {
        return;
      }
      const incoming = normalizeFlaskFilesFromBridge(payload.upload_files);
      state.flaskFiles = incoming;
      ToolboxShell.appendLog(
        `[UPLOAD][FLASK_SYNC] count=${incoming.length} names=${incoming.map((f) => f.name || '-').join('|')}`,
      );
      scheduleRenderUpload('bridge-upload-files-sync');
    }

    function getPendingUploadItems() {
      const items = [];
      const seen = new Set();

      const pushItem = (item, source) => {
        if (!item) return;
        const key = [
          source,
          item.id || item.file_id || '',
          item.name || item.filename || '',
          item.download_url || '',
        ].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        items.push({
          ...item,
          source: source || item.source || 'browser_file',
        });
      };

      for (const item of state.queue || []) {
        if (!item) continue;
        if (isQueueItemAlreadyUploaded(item)) continue;
        if (!hasAttemptableUploadSource(item) && !isFlaskLocalDirectItem(item)) continue;
        pushItem(item, item.source || 'browser_file');
      }

      for (const item of state.flaskFiles || []) {
        if (!item) continue;
        if (item.status === 'uploaded') continue;
        if (!isFlaskLocalDirectItem(item)) continue;
        pushItem(item, 'flask_local_direct');
      }

      return items;
    }

    function getUploadCountStats() {
      const localFiles = (state.flaskFiles || []).filter(
        (item) => item && item.status !== 'uploaded',
      );
      const pendingItems = getPendingUploadItems();
      const uploadingCount = state.running
        ? pendingItems.length
        : 0;

      return {
        localFileCount: localFiles.length,
        pendingCount: pendingItems.length,
        uploadingCount,
      };
    }

    async function resolveUploadFileObject(item) {
      if (!item) {
        throw new Error('空文件项，无法解析上传对象');
      }

      if (item.file instanceof File) {
        return item.file;
      }

      if (item.blob instanceof Blob) {
        return new File(
          [item.blob],
          item.name || item.filename || 'upload.bin',
          { type: item.mime_type || item.type || 'application/octet-stream' },
        );
      }

      if (item.id && (item.fileHandle || item.file || item.blob)) {
        const fresh = await readFreshFile(item);
        const normalized = normalizeToNativeFile(fresh, item.name || 'upload.bin');
        if (normalized) {
          return normalized;
        }
        if (fresh instanceof Blob) {
          return new File(
            [fresh],
            item.name || 'upload.bin',
            { type: item.mime_type || item.type || 'application/octet-stream' },
          );
        }
        return fresh;
      }

      const fileName = item.name || item.filename || 'upload.bin';
      const downloadUrl = String(
        item.download_url || item.url || item.file_url || '',
      ).trim();

      if (!downloadUrl) {
        throw new Error(`文件缺少 download_url，无法从 Flask 获取内容：${fileName}`);
      }

      const response = await fetch(downloadUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(
          `下载文件失败：${response.status} ${response.statusText} ${fileName}`,
        );
      }

      const blob = await response.blob();

      return new File(
        [blob],
        fileName,
        { type: item.mime_type || blob.type || 'application/octet-stream' },
      );
    }

    function findChatGPTFileInput() {
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (inputs.length > 0) {
        return inputs[0];
      }

      const attachButtons = Array.from(
        document.querySelectorAll('button, [role="button"]'),
      ).filter((el) => {
        const text = (el.innerText || el.textContent || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const title = (el.getAttribute('title') || '').trim();
        return (
          text.includes('添加')
          || text.includes('上传')
          || text.includes('Attach')
          || text.includes('Upload')
          || aria.includes('Attach')
          || aria.includes('Upload')
          || aria.includes('添加')
          || aria.includes('上传')
          || title.includes('Attach')
          || title.includes('Upload')
        );
      });

      if (attachButtons.length > 0) {
        attachButtons[0].click();
      }

      return document.querySelector('input[type="file"]');
    }

    async function uploadFilesToChatGPT(files) {
      const cleanFiles = (files || []).filter(Boolean);
      if (!cleanFiles.length) {
        ToolboxShell.showToast('没有待上传文件', 'warn', 1800);
        return false;
      }

      if (
        typeof ComposerApi !== 'undefined'
        && typeof ComposerApi.attachFilesByFileInput === 'function'
      ) {
        const uploadResult = await ComposerApi.attachFilesByFileInput(cleanFiles, 12000, {});
        if (uploadResult && uploadResult.ok) {
          return true;
        }
        const reason = (uploadResult && uploadResult.reason)
          ? uploadResult.reason
          : 'attachFilesByFileInput 未成功';
        throw new Error(reason);
      }

      const input = findChatGPTFileInput();
      if (!input) {
        throw new Error('未找到 ChatGPT 文件输入框 input[type=file]');
      }

      const dataTransfer = new DataTransfer();
      for (const file of cleanFiles) {
        dataTransfer.items.add(file);
      }

      input.files = dataTransfer.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return true;
    }

    function markPendingItemsUploaded(pendingItems) {
      const flaskIds = [];

      for (const item of pendingItems || []) {
        if (!item) continue;

        if (item.source === 'flask_local_direct' || item.file_id) {
          item.status = 'uploaded';
          if (item.file_id) {
            flaskIds.push(item.file_id);
          }
          continue;
        }

        if (item.id) {
          updateItem(item.id, {
            state: UploadState.ATTACHED,
            message: '已绑定到输入框',
          });
        }
      }

      if (flaskIds.length) {
        state.flaskFiles = (state.flaskFiles || []).map((row) => {
          if (!row || !row.file_id) return row;
          if (!flaskIds.includes(row.file_id)) return row;
          return {
            ...row,
            status: 'uploaded',
          };
        });
      }
    }

    async function handleStartUploadClick(source = 'button') {
      const uploadSource = String(source || 'button').trim() || 'button';

      if (state.running) {
        setStatus('正在上传中，请稍后', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][START][SKIP] source=${uploadSource} reason=already-running`,
        );
        return buildUploadSkipResult('already-running');
      }

      // 重置已绑定的文件，允许再次上传
      resetQueueItemsForUpload({ forceResetAttached: true });

      const pendingItems = getPendingUploadItems();

      if (!pendingItems.length) {
        const stats = getUploadCountStats();
        const hint = '没有待上传文件：当前油猴上传队列为空，且没有可下载的 Flask 本地文件。';
        ToolboxShell.showToast(hint, 'warn', 2600);
        console.warn('[UPLOAD][NO_PENDING_FILES]', {
          uploadQueue: state.queue,
          flaskFiles: state.flaskFiles,
          stats,
        });
        ToolboxShell.appendLog(
          `[UPLOAD][NO_PENDING_FILES] queue=${(state.queue || []).length} flask=${(state.flaskFiles || []).length}`,
        );
        return buildUploadSkipResult('no-pending-files', {
          total: 0,
          failed: 0,
        });
      }

      state.running = true;
      scheduleRenderUpload('handleStartUploadClick:start');

      try {
        setStatus('正在上传…', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][START][UNIFIED] source=${uploadSource} pending=${pendingItems.length}`,
        );

        const files = [];
        for (const item of pendingItems) {
          const file = await resolveUploadFileObject(item);
          files.push(file);
        }

        await uploadFilesToChatGPT(files);
        markPendingItemsUploaded(pendingItems);

        scheduleRenderUpload('handleStartUploadClick:done');
        persistQueueThrottled('handleStartUploadClick:done');

        ToolboxShell.showToast(
          `已提交 ${files.length} 个文件到 ChatGPT 上传框`,
          'success',
          2200,
        );
        console.log('[UPLOAD][DONE]', files.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
        })));
        setStatus(`已提交 ${files.length} 个文件到 ChatGPT`, 'success');

        return buildUploadResult(files.length, 0, false, files.length, {
          skipped: false,
          reason: 'unified-file-input',
        });
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const errStack = error && error.stack ? error.stack : errText;

        console.error('[UPLOAD][FAILED]', {
          error_type: errName,
          error: errText,
          stack: errStack,
        });
        ToolboxShell.showToast(`上传失败：${errText}`, 'error', 3200);
        setStatus(`上传失败：${errText}`, 'error');

        return buildUploadResult(0, pendingItems.length, false, pendingItems.length, {
          skipped: false,
          reason: errText,
        });
      } finally {
        state.running = false;
        scheduleRenderUpload('handleStartUploadClick:finally');
      }
    }

    async function triggerStartUpload(source = 'button') {
      return await handleStartUploadClick(source);
    }

    function startCopyLastMessageHardResetTimer(source) {
      if (copyLastMessageHardResetTimer) {
        window.clearTimeout(copyLastMessageHardResetTimer);
      }

      copyLastMessageHardResetTimer = window.setTimeout(() => {
        copyLastMessageHardResetTimer = 0;

        if (!copyLastMessageTaskRunning && !copyLastMessageWaiting) {
          return;
        }

        if (copyLastMessageWaiting) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:hard-reset-skip] reason=waiting-reply source=${source || '-'}`
          );
          return;
        }

        const runningMs = Date.now() - Number(copyLastMessageTaskStartedAt || 0);

        if (runningMs < 8000) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:hard-reset-skip] reason=not-stale runningMs=${runningMs} source=${source || '-'}`
          );
          return;
        }

        console.warn('[ChatGPT toolbox] copy last message hard reset triggered');
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:hard-reset] source=${source || '-'} runningMs=${runningMs}`
        );

        releaseCopyLastMessageTaskLock('hard-reset-timeout');
      }, 9000);
    }

    function clearCopyLastMessageHardResetTimer(reason) {
      if (copyLastMessageHardResetTimer) {
        window.clearTimeout(copyLastMessageHardResetTimer);
        copyLastMessageHardResetTimer = 0;
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:hard-reset-clear] reason=${reason || '-'}`);
      }
    }

    function releaseCopyLastMessageTaskLock(reason) {
      copyLastMessageTaskRunning = false;
      copyLastMessageTaskSource = '';
      copyLastMessageTaskStartedAt = 0;
      copyLastMessageTaskStatus = '';
      copyLastReplyTaskRunning = false;
      copyLastReplyTaskStartedAt = 0;
      copyLastReplyTaskStatus = '';
      copyLastMessageWaiting = false;

      const copyLastMessageBtn = rootElRef
        ? qs('#cgpt-copy-last-message-scroll-bottom', rootElRef)
        : null;

      if (copyLastMessageBtn) {
        setButtonState(copyLastMessageBtn, {
          text: '复制最后回复',
          title: '等待最后一条 assistant 回复稳定后复制到剪贴板',
          disabled: false,
          removeClasses: [
            'danger',
            'success',
            'warning',
            'orange',
            'amber',
            'teal',
            'purple',
            'cyan',
            'waiting',
            'cgpt-waiting-answer',
            'cgpt-btn-error',
            'cgpt-btn-ok',
            'failed',
            'error',
          ],
          addClasses: ['primary'],
        });
        applyUploadShortcutButtonTitles(rootElRef);
      }

      ToolboxShell.appendLog(
        `[CHAT_PAGE][copy-last-message:lock-release] reason=${reason || '-'} running=${copyLastMessageTaskRunning ? '1' : '0'} waiting=${copyLastMessageWaiting ? '1' : '0'}`
      );
    }

    function resetCopyLastMessageTaskState(reason) {
      releaseCopyLastMessageTaskLock(reason || 'reset');
      ToolboxShell.appendLog(
        `[CHAT_PAGE][copy-last-message:state-reset] reason=${reason || '-'} running=${copyLastMessageTaskRunning ? '1' : '0'} waiting=${copyLastMessageWaiting ? '1' : '0'}`
      );
    }

    function validateStableCopyRecord(stableResult) {
      const records = ChatMessageExtractor.buildRecords({
        includeEmpty: false,
      });

      const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);
      const latestUser = picked.latestUser || null;

      if (!latestUser) {
        return {
          ok: false,
          reason: 'no-latest-user',
          latestUser: null,
          picked,
        };
      }

      if (!picked.ok || !picked.record) {
        return {
          ok: false,
          reason: picked.reason || 'no-assistant-after-latest-user',
          latestUser,
          picked,
        };
      }

      const stableTurn = String(stableResult && stableResult.record && stableResult.record.turn_id || '');
      const pickedTurn = String(picked.record.turn_id || '');

      const stableText = ChatMessageExtractor.cleanMessageText(stableResult && stableResult.text || '').trim();
      const pickedText = ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();

      const sameTurn = stableTurn && pickedTurn && stableTurn === pickedTurn;
      const sameText = stableText && pickedText && stableText === pickedText;

      if (!sameTurn && !sameText) {
        return {
          ok: false,
          reason: 'stable-record-not-current-latest',
          latestUser,
          picked,
          stableTurn,
          pickedTurn,
          stableChars: stableText.length,
          pickedChars: pickedText.length,
        };
      }

      return {
        ok: true,
        reason: 'validated-current-latest',
        latestUser,
        picked,
        text: pickedText || stableText,
        record: picked.record,
      };
    }

    function getLatestAssistantTextForCopyCheck() {
      try {
        const records = ChatMessageExtractor.buildRecords({
          includeEmpty: false,
        });
        const picked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(records);

        if (!picked.ok || !picked.record) {
          return '';
        }

        return ChatMessageExtractor.cleanMessageText(picked.record.text || '').trim();
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] getLatestAssistantTextForCopyCheck failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:assistant-text-check-failed] error=${errText}`);
        return '';
      }
    }

    function hasRealStopButtonForCopy() {
      const selectors = [
        'button[data-testid="stop-button"]',
        'button[aria-label*="Stop"]',
        'button[aria-label*="停止"]',
        '.result-streaming',
        '[data-testid="stop-button"]',
      ];

      for (const selector of selectors) {
        const btn = qs(selector);

        if (!btn) {
          continue;
        }

        if (isInToolbox(btn)) {
          continue;
        }

        if (!isElementVisible(btn)) {
          continue;
        }

        if (btn.disabled) {
          continue;
        }

        return true;
      }

      return false;
    }

    function isAssistantDefinitelyGeneratingForCopyFast() {
      try {
        if (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy()
        ) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-fast] reason=composer-busy');
          return true;
        }

        if (hasRealStopButtonForCopy()) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-fast] reason=real-stop-or-streaming');
          return true;
        }

        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] copy fast busy-check failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:busy-fast-failed] error=${errText}`);
        return false;
      }
    }

    async function isAssistantReallyGeneratingForCopy() {
      try {
        if (hasRealStopButtonForCopy()) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-check] reason=real-stop-button');
          return true;
        }

        const before = getLatestAssistantTextForCopyCheck();
        await sleep(700);

        if (hasRealStopButtonForCopy()) {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:busy-check] reason=real-stop-button-after-wait');
          return true;
        }

        const after = getLatestAssistantTextForCopyCheck();

        if (before && after && before !== after) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:busy-check] reason=text-changing before=${before.length} after=${after.length}`
          );
          return true;
        }

        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:busy-check] reason=idle before=${before.length} after=${after.length}`
        );

        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] copy busy-check failed', err);
        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:busy-check-failed] error=${errText}`);
        return false;
      }
    }

    async function waitUntilAssistantIdleForCopy(options) {
      const opts = options || {};
      const runId = opts.runId;
      const timeoutMs = Number(opts.timeoutMs || 10 * 60 * 1000);
      const stableIdleMs = Number(opts.stableIdleMs || 1600);
      const pollMs = Number(opts.pollMs || 800);

      const startedAt = Date.now();
      let idleSince = 0;
      let sawBusy = false;
      let lastLogAt = 0;

      while (Date.now() - startedAt < timeoutMs) {
        if (!copyLastMessageTaskRunning) {
          return {
            ok: false,
            reason: 'task-stopped',
          };
        }

        if (runId !== copyLastMessageWaitRunId) {
          return {
            ok: false,
            reason: 'cancelled',
          };
        }

        const busy = await isAssistantReallyGeneratingForCopy();

        if (busy) {
          sawBusy = true;
          idleSince = 0;

          const now = Date.now();
          if (now - lastLogAt > 5000) {
            lastLogAt = now;
            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:waiting-reply]');
          }

          await sleep(pollMs);
          continue;
        }

        if (!idleSince) {
          idleSince = Date.now();
          await sleep(pollMs);
          continue;
        }

        if (Date.now() - idleSince >= stableIdleMs) {
          return {
            ok: true,
            reason: sawBusy ? 'reply-finished' : 'already-idle',
          };
        }

        await sleep(pollMs);
      }

      return {
        ok: false,
        reason: 'timeout',
      };
    }

    async function copyLastMessageNow(triggerSource) {
      const source = triggerSource || 'button';
      const cfg = getCompactUiConfig();
      const shouldRestoreScroll = cfg.restoreScrollAfterCopyLastMessage === true;
      let savedScrollPositions = null;

      ToolboxShell.appendLog(`[COPY_LAST][BEGIN] source=${source}`);

      try {
        savedScrollPositions = saveChatScrollPositionsForCopy('copy-last-message');

        try {
          await withTimeout(
            forceChatPageToAbsoluteEnd('copy-last-message-before-copy'),
            2500,
            'force-end-before-copy'
          );
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] force end before copy failed', err);
          ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:force-end-before-copy-failed] error=${errText}`);
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:continue-after-force-end-timeout]');
        }

        await sleep(180);

        const beforeRecords = ChatMessageExtractor.buildRecords({
          includeEmpty: false,
        });

        const beforePicked = ChatMessageExtractor.getLatestAssistantAfterLatestUser(beforeRecords);

        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:before-pick] ok=${beforePicked.ok ? 1 : 0} reason=${beforePicked.reason || '-'} latestUserIndex=${beforePicked.latestUser ? beforePicked.latestUser.index : -1} assistantIndex=${beforePicked.record ? beforePicked.record.index : -1}`,
        );

        if (beforePicked.ok && beforePicked.text) {
          ToolboxShell.appendLog('[COPY_LAST][DOM_OK] stage=before-pick');
        } else {
          ToolboxShell.appendLog(
            `[COPY_LAST][DOM_FAILED] stage=before-pick reason=${beforePicked.reason || '-'}`,
          );
        }

        const stableResult = await ChatMessageExtractor.waitLatestAssistantStable({
          timeoutMs: 15000,
          intervalMs: 300,
          stableRounds: 3,
          isGenerating: isAssistantDefinitelyGeneratingForCopyFast,
        });

        if (!stableResult.ok || !stableResult.text) {
          const reason = stableResult.reason || 'unknown';

          if (reason === 'no-assistant-after-latest-user') {
            ToolboxShell.setStatus(
              '最后一条回复还没有生成，未复制上一轮内容',
              'warn',
              {
                persist: true,
                shortText: '未生成',
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('最后一条回复还没有生成', 'warn', 1200);
            }

            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:no-latest-assistant]');
          } else if (reason === 'timeout') {
            ToolboxShell.setStatus(
              '等待最后回复稳定超时，请稍后再试',
              'warn',
              {
                persist: true,
                shortText: '超时',
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('等待回复稳定超时', 'warn', 1200);
            }

            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-timeout]');
          } else {
            ToolboxShell.setStatus('未找到可复制的最后一条回复', 'warn');

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('未找到最后消息', 'warn');
            }
          }

          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:skip] source=${source} reason=${reason}`
          );
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=no-message');

          if (!shouldRestoreScroll) {
            void forceChatPageToAbsoluteEnd('copy-last-message-no-message').catch((scrollErr) => {
              const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
              console.warn('[ChatGPT toolbox] force end after no message failed', scrollErr);
              ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:no-message-scroll-failed] error=${scrollErrText}`);
            });
          }

          return false;
        }

        const finalValidate = validateStableCopyRecord(stableResult);

        if (!finalValidate.ok) {
          const reason = finalValidate.reason || 'final-validate-failed';
          ToolboxShell.appendLog(
            `[COPY_LAST][DOM_FAILED] stage=final-validate reason=${reason}`,
          );

          const snapshotFallback = tryCopyLastAssistantSnapshotFallback(
            beforeRecords,
            `final-validate-failed:${reason}`,
          );
          if (snapshotFallback && snapshotFallback.text) {
            await copyTextToClipboard(snapshotFallback.text);
            const stats = getCopiedTextStats(snapshotFallback.text);
            ToolboxShell.appendLog(
              `[COPY_LAST][OK] chars=${stats.charCount} source=${source} role=assistant reason=snapshot_fallback`,
            );

        void playCopySuccessBeepSafe(source || '-', 'copyLastMessage');

        ToolboxShell.setStatus(
          `已复制最后一条回复（快照兜底）：${stats.charCount} 字符`,
              'success',
              { persist: false },
            );
            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast(`已复制 ${stats.charCount} 字符`, 'success', 900);
            }
            setButtonTemporaryOk(copyLastMessageBtn);
            return true;
          }

          ToolboxShell.setStatus(
            reason === 'no-assistant-after-latest-user'
              ? '最后一条回复还没有生成，未复制上一轮内容'
              : '最后消息校验失败，未复制旧内容',
            'warn',
            {
              persist: true,
              shortText: '未复制',
            },
          );

          if (typeof ToolboxShell.showToast === 'function') {
            ToolboxShell.showToast('最后消息未确认，未复制旧内容', 'warn', 1500);
          }

          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:final-validate-failed] reason=${reason} latestUserIndex=${finalValidate.latestUser ? finalValidate.latestUser.index : -1} pickedIndex=${finalValidate.picked && finalValidate.picked.record ? finalValidate.picked.record.index : -1}`,
          );

          return false;
        }

        const result = {
          ok: true,
          text: finalValidate.text,
          role: finalValidate.record?.role || 'assistant',
          reason: finalValidate.reason || stableResult.reason || 'stable',
          record: finalValidate.record || stableResult.record || null,
        };

        const preview = result.text.replace(/\s+/g, ' ').slice(0, 120);
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message:record-picked] index=${result.record?.index ?? -1} role=${result.role || '-'} chars=${result.record?.char_count ?? 0} turn=${result.record?.turn_id || '-'} preview=${preview}`
        );

        const rawFromElement = result.record && result.record.element
          ? String(result.record.element.textContent || result.record.element.innerText || '')
          : '';

        const afterThinking = extractFinalAnswerAfterThinkingText(rawFromElement);
        const cleanedAfterThinking = ChatMessageExtractor.cleanMessageText(afterThinking || '');

        if (
          cleanedAfterThinking &&
          cleanedAfterThinking.length > String(result.text || '').length + 30
        ) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:replace-with-after-thinking] oldChars=${String(result.text || '').length} newChars=${cleanedAfterThinking.length}`,
          );
          result.text = cleanedAfterThinking;
          result.reason = 'after-thinking-final-answer';
        }

        if (
          rawFromElement &&
          isTextBeforeThinkingBoundary(rawFromElement, result.text) &&
          cleanedAfterThinking
        ) {
          ToolboxShell.appendLog(
            `[CHAT_PAGE][copy-last-message:before-thinking-detected] oldChars=${String(result.text || '').length} afterThinkingChars=${cleanedAfterThinking.length}`,
          );
          result.text = cleanedAfterThinking;
          result.reason = 'replace-before-thinking-with-final-answer';
        }

        await copyTextToClipboard(result.text);

        const stats = getCopiedTextStats(result.text);

        ToolboxShell.appendLog(
          `[COPY_LAST][OK] chars=${stats.charCount} source=${source} role=${result.role || '-'}`,
        );

        void playCopySuccessBeepSafe(source || '-', 'copyLastMessage');

        window.setTimeout(() => {
          try {
            ToolboxShell.setStatus(
              `已复制最后一条回复：${stats.charCount} 字符，汉字 ${stats.hanCount}`,
              'success',
              {
                persist: false,
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast(
                `已复制 ${stats.charCount} 字符`,
                'success',
                900
              );
            }

            ToolboxShell.appendLog(
              `[CHAT_PAGE][copy-last-message:ok] source=${source} role=${result.role || '-'} chars=${stats.charCount} han=${stats.hanCount} no_space=${stats.noSpaceCharCount} lines=${stats.lineCount} reason=${result.reason || '-'}`
            );
            setButtonTemporaryOk(copyLastMessageBtn);
          } catch (uiErr) {
            const uiErrText = uiErr && uiErr.message ? uiErr.message : String(uiErr);
            console.error('[ChatGPT toolbox] copy success UI update failed', uiErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:success-ui-failed] error=${uiErrText}`);
          }
        }, 0);

        if (!shouldRestoreScroll) {
          void forceChatPageToAbsoluteEnd('copy-last-message-after-copy').catch((scrollErr) => {
            const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
            console.warn('[ChatGPT toolbox] force end after copy failed', scrollErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:after-copy-scroll-failed] error=${scrollErrText}`);
          });
        }

        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        const isFocusClipboardError = /Document is not focused|clipboard|writeText/i.test(errText);
        console.error('[ChatGPT toolbox] copy last message failed', err);

        ToolboxShell.setStatus(
          isFocusClipboardError
            ? '复制失败：浏览器拒绝写入剪贴板，请启用 GM_setClipboard 或重新点击复制'
            : `复制最后一条回复失败：${errText}`,
          'error',
          {
            persist: true,
            shortText: '复制失败',
          },
        );

        if (typeof ToolboxShell.showToast === 'function') {
          ToolboxShell.showToast(
            isFocusClipboardError ? '剪贴板被浏览器拒绝' : '复制失败',
            'error',
            1500,
          );
        }

        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:failed] source=${source} error=${errText}`);
        ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=copy-failed');
        setButtonTemporaryError(copyLastMessageBtn, '复制失败', 1200);

        if (!shouldRestoreScroll) {
          void forceChatPageToAbsoluteEnd('copy-last-message-error').catch((scrollErr) => {
            const scrollErrText = scrollErr && scrollErr.message ? scrollErr.message : String(scrollErr);
            console.warn('[ChatGPT toolbox] force end after copy error failed', scrollErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:force-end-error-failed] error=${scrollErrText}`);
          });
        }

        return false;
      } finally {
        if (shouldRestoreScroll) {
          try {
            restoreChatScrollPositions(savedScrollPositions, 'copy-last-message');
          } catch (restoreErr) {
            const restoreErrText = restoreErr && restoreErr.message ? restoreErr.message : String(restoreErr);
            console.warn('[ChatGPT toolbox] restore scroll after copy failed', restoreErr);
            ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:restore-scroll-failed] error=${restoreErrText}`);
          }
        } else {
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:restore-scroll-skip] enabled=false');
        }
      }
    }

    async function copyLastMessageAndScrollBottom(triggerSource) {
      return copyLastReplyWithState(triggerSource || 'button');
    }

    function bindCopyLastMessageShortcut() {
      if (copyLastMessageShortcutBound) {
        return;
      }
      copyLastMessageShortcutBound = true;
      document.addEventListener('keydown', (e) => {
        if (!isCopyLastMessageShortcutEvent(e)) {
          return;
        }
        logShortcutDebug(e, 'copy-match');
        if (e.repeat) {
          logShortcutDebug(e, 'copy-ignore', 'repeat');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (shouldIgnoreToolboxShortcutTarget(e.target)) {
          logShortcutDebug(e, 'copy-ignore', 'target-in-toolbox-editable');
          return;
        }
        if (shouldSkipGlobalShortcutForToolboxTarget(e.target)) {
          logShortcutDebug(e, 'copy-ignore', 'target-in-toolbox-non-editable');
          return;
        }
        const now = Date.now();
        if (now - copyLastMessageShortcutLastAt < 800) {
          logShortcutDebug(e, 'copy-ignore', 'too-fast');
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        copyLastMessageShortcutLastAt = now;
        e.preventDefault();
        e.stopPropagation();
        if (copyLastReplyTaskRunning || copyLastMessageTaskRunning || copyLastMessageShortcutRunning) {
          ToolboxShell.setStatus(
            '正在复制最后回复，请不要重复触发',
            'running',
            {
              persist: true,
              shortText: copyLastMessageWaiting ? '等回答' : '复制中',
            },
          );
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message-shortcut:ignored] reason=running');
          ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=running-or-ignored');
          return;
        }
        copyLastMessageShortcutRunning = true;
        ToolboxShell.appendLog(
          `[CHAT_PAGE][copy-last-message-shortcut:trigger] key=${e.key || '-'} code=${e.code || '-'}`
        );
        runUploadActionPromise(
          copyLastReplyWithState('shortcut'),
          '复制最后回复',
        );
        window.setTimeout(() => {
          copyLastMessageShortcutRunning = false;
        }, 1200);
      }, true);
      ToolboxShell.appendLog('[SHORTCUT][bind] copy=configurable');
    }

    function bindShortcutWindowFallback() {
      if (shortcutWindowFallbackBound) {
        return;
      }
      shortcutWindowFallbackBound = true;
      window.addEventListener('keydown', (e) => {
        if (!isCopyLastMessageShortcutEvent(e)) {
          return;
        }
        logShortcutDebug(e, 'window-seen');
      }, true);
    }

    function runUploadUiAction(action, button, source, event) {
      const src = source || 'unknown';

      if (!action || !button) {
        return false;
      }

      if (event) {
        event.preventDefault();
        event.stopPropagation();

        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }

      if (typeof button.blur === 'function') {
        button.blur();
      }

      ToolboxShell.appendLog(
        `[UPLOAD_UI_ACTION][hit] action=${action} source=${src} disabled=${button.disabled ? '1' : '0'}`,
      );

      if (typeof ToolboxShell.suspendEdgeAutoHide === 'function') {
        ToolboxShell.suspendEdgeAutoHide(`run-action:${action}:${src}`, 3000);
      }

      if (action === 'send-message' && isWaitingSendActive()) {
        cancelWaitingSend(src === 'delegated-click' ? 'button-click' : src);
        return true;
      }

      if (shouldSkipUploadUiAction(action, src, 350)) {
        return true;
      }

      if (action === 'copy-continue') {
        const busyState = clearStaleUploadButtonBusy(button, {
          action: 'copy-continue',
          source: src,
        });
        if (busyState.skipped) {
          ToolboxShell.appendLog(
            `[UPLOAD_UI_ACTION][skip] action=copy-continue source=${src} reason=button-busy busyMs=${busyState.busyMs}`,
          );
          return true;
        }
      }

      if (button.disabled && action !== 'copy-last-message' && action !== 'copy-continue') {
        ToolboxShell.appendLog(
          `[UPLOAD_UI_ACTION][ignored] action=${action} source=${src} reason=button-disabled`
        );
        return true;
      }

      if (action === 'copy-last-message') {
        runUploadActionPromise(
          copyLastReplyWithState(src),
          '复制最后回复',
        );
        return true;
      }

      if (action === 'send-message') {
        const capability = getUploadPageCapability();
        if (!capability.can_send_now) {
          const blockReason = !capability.hasComposer
            ? 'no-composer'
            : capability.isResponding
              ? 'assistant-busy'
              : 'send-not-ready';
          ToolboxShell.appendLog(
            `[UPLOAD_UI_ACTION][send-message:blocked] source=${src} reason=${blockReason}`,
          );
          return true;
        }

        const runId = claimWaitingSendRun(src, Date.now());
        void sendCurrentMessageFromUploadPanel(src, runId).catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] send message UI action failed', err);
          setStatus(`发送信息失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][send-message:failed] error=${errText}`);
          resetUploadSendShortcutState('ui-action-catch', runId);
        });

        return true;
      }

      if (action === 'copy-continue') {
        button.disabled = false;
        button.removeAttribute('disabled');
        runUploadActionPromise(
          copyLastMessageAndContinue(src || 'runUploadUiAction'),
          '复制并继续',
        );

        return true;
      }

      if (action === 'start-upload') {
        void triggerStartUpload(src || 'button').catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] start upload UI action failed', err);
          setStatus(`上传失败：${errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][start-upload:failed] error=${errText}`);
        });

        return true;
      }

      return false;
    }

