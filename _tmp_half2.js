// prefix
true;
          btn.dataset.running = '0';
        }
        if (stoppedByUser && loopStopReason === 'natural-end') {
          loopStopReason = 'user-stop';
        }
        setStatus(
          stoppedByUser
            ? `杩炵画澶嶅埗+蹇嵎閿?缁х画宸插仠姝紝鍏辨墽琛?${copyHotkeyContinueLoopCount} 杞甡`
            : `杩炵画澶嶅埗+蹇嵎閿?缁х画宸茬粨鏉燂紝鍏辨墽琛?${copyHotkeyContinueLoopCount} 杞甡,`,
          stoppedByUser ? 'warn' : 'success',
        );
        safeAppendLog(`[COPY_HOTKEY_CONTINUE_LOOP][finally] reason=${loopStopReason}`);
        safeAppendLog(
          `[COPY_HOTKEY_CONTINUE_LOOP][done] cycles=${copyHotkeyContinueLoopCount} stoppedByUser=${stoppedByUser ? '1' : '0'} reason=${loopStopReason}`,
        );
        renderUploadButtonsOnly();
      }
      return true;
    }

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

    function buildDropSignature(dataTransfer) {
      const files = Array.from(dataTransfer && dataTransfer.files ? dataTransfer.files : []);

      return files
        .map((file) => [
          String(file.name || '').trim().toLowerCase(),
          Number(file.size) || 0,
          Number(file.lastModified) || 0,
          String(file.type || '').trim().toLowerCase(),
        ].join('::'))
        .sort()
        .join('||');
    }

    function shouldSkipRecentDuplicateDrop(dataTransfer) {
      const signature = buildDropSignature(dataTransfer);

      if (!signature) return false;

      const now = Date.now();

      if (signature === lastDropSignature && now - lastDropSignatureAt < 1200) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][drop:skip-recent-duplicate] signature=${signature}`
        );
        return true;
      }

      lastDropSignature = signature;
      lastDropSignatureAt = now;
      return false;
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

      if (shouldSkipRecentDuplicateDrop(transfer)) {
        setStatus('已忽略重复拖拽事件');
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

      dedupeActiveGroupQueue('drop');

      const afterCount = state.queue.length;
      const addedCount = Math.max(0, afterCount - beforeCount);

      setStatus(`已拖入：${dropped.length} 个文件，新增：${addedCount} 个`);

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][drop:done] dropped=${dropped.length} added=${addedCount} before=${beforeCount} after=${afterCount}`
      );
    }

    function claimUploadDropEvent(e, source) {
      if (!e) return false;

      if (e[UPLOAD_DROP_HANDLED_PROP]) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][drop:skip-already-handled] source=${source || '-'}`
        );
        return false;
      }

      e[UPLOAD_DROP_HANDLED_PROP] = {
        source: source || '',
        at: Date.now(),
      };

      return true;
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

      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

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
      if (!claimUploadDropEvent(e, 'root')) return;

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
      if (!claimUploadDropEvent(e, 'global')) return;

      if (panelDropEl) {
        panelDropEl.classList.remove('cgpt-toolbox-file-dragover');
      }

      await handleUploadDropEvent(e);
    }

    function bindGlobalDropTarget(target, name) {
      if (!target) {
        console.warn('[ChatGPT toolbox] bindGlobalDropTarget: target 涓虹┖', name);
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


    function buildQueueLooseFileKey(fileOrItem) {
      if (!fileOrItem) return '';

      const name = String(fileOrItem.name || '').trim().toLowerCase();
      const size = Number(fileOrItem.size) || 0;

      if (!name && !size) {
        return '';
      }

      return `${name}::${size}`;
    }

    function dedupeActiveGroupQueue(reason) {
      const groupId = state.activeGroupId;
      if (!groupId || !Array.isArray(state.queue)) return;
      const seen = new Map();
      const keep = [];
      for (const item of state.queue) {
        if (!item || item.groupId !== groupId) {
          keep.push(item);
          continue;
        }
        let key = buildQueueLooseFileKey(item);
        if (!key) {
          key = buildQueueFileKey(item);
        }
        if (!key) {
          keep.push(item);
          continue;
        }
        if (seen.has(key)) {
          const id = item.id || item._uploadId || '?';
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][dedupe-active-group:remove] reason=${reason} name=${item.name || '-'} size=${item.size || 0} id=${id}`
          );
          continue;
        }
        seen.set(key, true);
        keep.push(item);
      }
      state.queue = keep;
    }
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
        setStatus('璇峰厛閫夋嫨鏂囦欢缁?');
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

      const existingLooseKeys = new Set(
        state.queue
          .filter((item) => item.groupId === state.activeGroupId)
          .map((item) => buildQueueLooseFileKey(item))
          .filter(Boolean)
      );

      let addedCount = 0;

      cleanFiles.forEach((file, index) => {
        const fileKey = buildQueueFileKey(file);
        const fileLooseKey = buildQueueLooseFileKey(file);
        const useLooseDedupe = options.sourceKind === 'drop';

        if (
          (fileKey && existingKeys.has(fileKey))
          || (useLooseDedupe && fileLooseKey && existingLooseKeys.has(fileLooseKey))
        ) {
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][add-file-skip-duplicate] index=${index} name=${file.name || '-'} size=${file.size || 0} fileKey=${fileKey || '-'} looseKey=${fileLooseKey || '-'}`
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

        if (fileLooseKey) {
          existingLooseKeys.add(fileLooseKey);
        }

        addedCount += 1;

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][add-file] index=${index} name=${item.name || '-'} size=${item.size || 0} handle=${hasHandle ? 1 : 0} sourceKind=${item.sourceKind} readMode=${item.readMode}`,
        );
      });

      dedupeActiveGroupQueue('add-files');
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
            finishFailed(new Error('鐢ㄦ埛鍙栨秷閫夋嫨鏂囦欢'));
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

            finishFailed(new Error('鐢ㄦ埛鍙栨秷閫夋嫨鏂囦欢'));
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
          finishFailed(new Error('鐢ㄦ埛鍙栨秷閫夋嫨鏂囦欢'));
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
          throw new Error('鐢ㄦ埛鍙栨秷閫夋嫨鏂囦欢');
        }

        console.error('[ChatGPT toolbox] showOpenFilePicker failed', e);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][picker:file-system-access-failed] error=${e && e.message ? e.message : String(e)}`,
        );
        throw e;
      }

      const handle = handles && handles[0] ? handles[0] : null;

      if (!handle || typeof handle.getFile !== 'function') {
        const err = new Error('鏈幏鍙栧埌鏈夋晥鏂囦欢鍙ユ焺');
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
        const err = new Error('鏂囦欢鍙ユ焺璇诲彇鏂囦欢澶辫触');
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
        setStatus('閲嶆柊缁戝畾澶辫触锛氱己灏戞枃浠?ID');
        ToolboxShell.appendLog('[UPLOAD_DIAG][rebind-file:skip] reason=empty-id');
        return;
      }

      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('閲嶆柊缁戝畾澶辫触锛氭湭鎵惧埌闃熷垪鏂囦欢');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:missing] id=${id || '-'}`);
        return;
      }

      try {
        const oldName = q.name || '';
        const picked = await pickOneLocalFileForRebind();
        const file = picked.file;
        const handle = picked.handle;

        if (!file) {
          throw new Error('閲嶆柊缁戝畾鏂囦欢涓虹┖');
        }

        if (oldName && file.name && oldName !== file.name) {
          const ok = window.confirm(
            `閲嶆柊閫夋嫨鐨勬枃浠跺悕鍜屽師缂撳瓨鏂囦欢涓嶅悓銆俓n\n鍘熸枃浠讹細${oldName}\n鏂版枃浠讹細${file.name}\n\n鏄惁缁х画缁戝畾锛焋,`
          );

          if (!ok) {
            ToolboxShell.appendLog(
              `[UPLOAD_DIAG][rebind-file:cancel-name-mismatch] id=${id || '-'} old=${oldName} next=${file.name}`,
            );
            setStatus('宸插彇娑堥噸鏂扮粦瀹?');
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

        setStatus(`宸查噸鏂扮粦瀹氭枃浠讹細${q.name}`);
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][rebind-file:success] id=${id || '-'} source=${picked.source || '-'} handle=${hasHandle ? 1 : 0} sourceKind=${q.sourceKind} readMode=${q.readMode} name=${q.name || '-'} size=${q.size || 0}`,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);

        if (errText.includes('鐢ㄦ埛鍙栨秷閫夋嫨鏂囦欢') || errText.includes('鏈€夋嫨鏂囦欢')) {
          console.warn('[ChatGPT toolbox] rebind upload file cancelled', err);
          setStatus('宸插彇娑堥噸鏂扮粦瀹?');
          ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:cancelled] id=${id || '-'} error=${errText}`);
          return;
        }

        console.warn('[ChatGPT toolbox] rebind upload file failed', err);
        console.error('[ChatGPT toolbox] rebind upload file failed', err);
        setStatus(`閲嶆柊缁戝畾澶辫触锛?{errText}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][rebind-file:failed] id=${id || '-'} error=${errText}`);
      }
    }

    // 涓婁紶鍓嶇粺涓€鍏ュ彛锛氭湁 fileHandle 鍒欏繀椤?getFile() 浠庣鐩樿鏈€鏂版枃浠讹紝澶辫触灏辩洿鎺ユ姤閿欙紝缁濅笉璧扮紦瀛橀檷绾?
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

          console.warn('[ChatGPT toolbox] fileHandle.getFile failed, no fallback to cache', e);

          q.message = '鏂囦欢鍙ユ焺璇诲彇澶辫触锛屾棤娉曚粠纾佺洏璇诲彇鏈€鏂版枃浠?';
          q.state = UploadState.MISSING_FILE;
          q.sourceKind = 'missing-file';
          q.readMode = '';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][readFreshFile:handle-failed-no-fallback] name=${q.name || '-'} sourceKind=${q.sourceKind || '-'} readMode=${q.readMode || '-'} type=${errName} error=${errText}`,
          );

          throw new Error('鏂囦欢鍙ユ焺璇诲彇澶辫触锛屾棤娉曚繚璇佷粠纾佺洏璇诲彇鏈€鏂版枃浠? ' + (q.name || '-'));
        }

        // handle瀛樺湪浣?getFile 杩斿洖绌?鏃犳晥 鈫?涔熸姤閿?
        q.state = UploadState.MISSING_FILE;
        q.sourceKind = 'missing-file';
        q.readMode = '';
        q.message = '鏂囦欢鍙ユ焺璇诲彇杩斿洖绌烘枃浠?';

        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][readFreshFile:handle-returned-invalid] name=${q.name || '-'}`,
        );

        throw new Error('鏂囦欢鍙ユ焺璇诲彇杩斿洖绌烘枃浠讹紝鏃犳硶淇濊瘉浠庣鐩樿鍙栨渶鏂版枃浠? ' + (q.name || '-'));
      }

      // 娌℃湁 fileHandle 鈫?鏃犳硶浠庣鐩樿鍙栵紝鐩存帴鎶ラ敊
      q.state = UploadState.MISSING_FILE;
      q.sourceKind = 'missing-file';
      q.readMode = '';
      q.message = '缂哄皯鏂囦欢鍙ユ焺锛屾棤娉曚粠纾佺洏璇诲彇鏈€鏂版枃浠讹紝璇烽噸鏂版嫋鍏?';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][readFreshFile:no-handle] name=${q.name || '-'}`,
      );

      throw new Error('缂哄皯鏂囦欢鍙ユ焺锛屾棤娉曚粠纾佺洏璇诲彇鏈€鏂版枃浠讹紝璇烽噸鏂版嫋鍏? ' + (q.name || '-'));
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

        if (!/宸蹭笂浼犺繃|閲嶅|duplicate|already uploaded/i.test(text)) return;

        const buttons = qsa('button, [role="button"]', dialog);
        const ok = buttons.find((btn) => {
          const t = String(btn.textContent || btn.getAttribute('aria-label') || '');
          return /纭畾|鐭ラ亾|OK|Ok|ok|close|鍏抽棴/i.test(t);
        });

        if (ok instanceof HTMLElement) {
          ok.click();
          ToolboxShell.appendLog('宸茶嚜鍔ㄥ叧闂钩鍙伴噸澶嶆彁绀?');
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

    function markUploadCancelled(q, reason = '鐢ㄦ埛宸插仠姝笂浼?') {
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

    async function resolveLiveFileForUpload(item) {
      if (!item) {
        ToolboxShell.appendLog('[UPLOAD_DIAG][live-read:null-item]');
        return null;
      }

      if (isFileLike(item.file)) {
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][live-read:session-file] name=${item.name || '-'} size=${item.size || 0}`
        );
        return item.file;
      }

      if (item.fileHandle && typeof item.fileHandle.getFile === 'function') {
        try {
          const file = await item.fileHandle.getFile();

          item.file = file;
          item.name = file.name || item.name;
          item.size = Number(file.size) || item.size;
          item.lastModified = Number(file.lastModified) || item.lastModified;
          item.type = file.type || item.type || 'application/octet-stream';
          item.blob = null;
          item.readMode = 'file-handle-live';

          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][live-read:handle] name=${item.name || '-'} size=${item.size}`
          );

          return file;
        } catch (e) {
          console.error('[ChatGPT toolbox] resolveLiveFileForUpload: handle.getFile failed', e);
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][live-read:handle-failed] name=${item.name || '-'} error=${e && e.message ? e.message : String(e)}`
          );
        }
      }

      item.file = null;
      item.blob = null;
      item.state = UploadState.MISSING_FILE;
      item.message = '未保存文件内容，请重新拖入后再上传';

      ToolboxShell.appendLog(
        `[UPLOAD_DIAG][live-read:missing] name=${item.name || '-'} reason=no-file-no-handle`
      );

      return null;
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
          message: '姝ｅ湪涓婁紶',
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
            message: missingFile ? errMsg : `璇诲彇澶辫触锛?{errMsg}`,
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
          message: '姝ｅ湪涓婁紶',
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
          ? (result.reason || '闄勪欢宸插嚭鐜颁絾鏈兘纭绋冲畾')
          : (result.reason || '涓婁紶澶辫触');

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
          q.message = errText || '涓婁紶娴佺▼鏈甯哥粨鏉?';

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
        setStatus('鏈壘鍒版枃浠?ID');
        ToolboxShell.appendLog('[UPLOAD_DIAG][single-upload:missing-id]');
        return;
      }

      refreshQueueReadableState();
      await reconcileFailedItems();

      const q = getActiveGroupFiles().find((item) => item && item.id === id);

      if (!q) {
        setStatus('鏈壘鍒拌涓婁紶鐨勬枃浠?');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][single-upload:not-found] id=${id} group=${getActiveGroupId() || '-'}`);
        render();
        return;
      }

      logUploadItemSource('single-upload:before-check', q);

      if (!hasAttemptableUploadSource(q)) {
        markMissingLocalFiles([q]);
        render();
        persistQueueInBackground('single-upload:missing-source');

        setStatus(`缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆锛?{q.name || '-'}`);
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

      setStatus(`姝ｅ湪涓婁紶锛?{q.name || '-'}`, 'running');
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
              message: '鍗曟枃浠朵笂浼犳祦绋嬬粨鏉熸椂浠嶆湭瀹屾垚',
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
            setStatus(`宸插仠姝笂浼狅細${q.name || '-'}`, 'warn');
          } else if (result.success > 0) {
            setStatus(`涓婁紶瀹屾垚锛?{q.name || '-'}`, 'success');
          } else {
            setStatus(`涓婁紶澶辫触锛?{q.name || '-'}`, 'error');
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
        setStatus('鏈壘鍒板搴旀枃浠?');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][single-click-upload:return-missing] id=${id || '-'}`);
        return;
      }

      if (!hasAttemptableUploadSource(q)) {
        q.state = UploadState.MISSING_FILE;
        q.message = '缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆';
        q.updatedAt = Date.now();

        render();
        setStatus('缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆');
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
      setStatus(`姝ｅ湪涓婁紶锛?{q.name || id}`, 'running');

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
        q.message = '缂哄皯鏂囦欢锛岃閲嶆柊鎷栧叆';
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


    function healStaleSendUiStateIfNeeded(context) {
      if (!isWaitingSendActive()) return false;
      if (state.waitingReply) return false;
      if (uploadSendTaskStartedAt <= 0) return false;
      const elapsed = Date.now() - uploadSendTaskStartedAt;
      if (elapsed < 8000) return false;

      try {
        const cap = getUploadPageCapability();
        if (cap.canSendNow && !cap.isResponding) {
          ToolboxShell.appendLog(
            `[UPLOAD_SEND_UI][HEAL_STALE] reason=${String(context || '-scheduled')} runningMs=${elapsed} canSendNow=${cap.canSendNow ? '1' : '0'} isResponding=${cap.isResponding ? '1' : '0'}`
          );
          resetUploadSendShortcutState('stale-send-ui:' + (context || '-scheduled'), state.autoSendRunId);
          if (rootElRef) {
            renderUploadButtonsOnly();
          }
          return true;
        }
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] healStaleSendUiStateIfNeeded error', err);
        ToolboxShell.appendLog(`[UPLOAD_SEND_UI][HEAL_STALE_ERROR] error=${errText}`);
      }
      return false;
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
          message: '涓婁紶宸蹭腑鏂互渚块噸鏂板紑濮?',
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
      if (!isWaitingSendActive() && !state.waitingReply) {
        return false;
      }

      if (state.waitingReply) {
        finishWaitingReply('cancel');
        ToolboxShell.appendLog(`[UPLOAD_SEND_UI][STATE] action=cancel state=idle`);
        setStatus('宸插彇娑堢瓑寰呭彂閫?');
        scheduleRenderUpload('wait-send:cancel');
        return true;
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
      setStatus('宸插彇娑堢瓑寰呭彂閫?');
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
        if (!capability.canSendNow) {
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

      ToolboxShell.appendLog(`[UPLOAD_SEND_UI][STATE] action=click state=sending`);

      try {
        setStatus('姝ｅ湪绛夊緟鍙戦€佹寜閽?..');

        const sendResult = await sendContentViaComposer({
          source,
          sendExistingComposer: true,
          waitUntilSendable: true,
          timeoutMs: SEND_WAIT_TIMEOUT_MS,
          blockWhenResponding: false,
        });

        if (state.cancelWaitingSend) {
          return false;
        }

        if (sendResult.ok) {
          setWaitingSendActive(false);
          uploadSendShortcutRunning = false;
          uploadSendTaskStartedAt = 0;
          state.cancelWaitingSend = false;

          state.waitingReply = true;
          setStatus('已发送信息');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][send-message-button:sent] runId=${runId} reason=${sendResult.reason || '-'}`,
          );
          ToolboxShell.appendLog(`[UPLOAD_SEND_UI][STATE] action=sent state=waiting_reply`);
          updateChatInputStateBadge();
          startWaitingReplyCheck(runId, Date.now());
          scheduleRenderUpload('send-message:sent-waiting-reply');
          return true;
        }

        if (!state.cancelWaitingSend) {
          setStatus(`鍙戦€佹湭瀹屾垚锛?{sendResult.reason || 'unknown'}`);
        }
        ToolboxShell.appendLog(
          `[UPLOAD_DIAG][send-message-button:not-sent] runId=${runId} reason=${sendResult.reason || '-'} cancelled=${state.cancelWaitingSend ? '1' : '0'}`,
        );
        return false;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send current message failed', err);
        setStatus(`鍙戦€佷俊鎭け璐ワ細${errText}`);
        ToolboxShell.appendLog(`[UPLOAD_DIAG][send-message-button:failed] runId=${runId} error=${errText}`);
        return false;
      } finally {
        if (!state.waitingReply) {
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
      state.waitingReply = false;
      stopWaitingReplyCheck();
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
      setStatus('蹇嵎閿Е鍙戯細姝ｅ湪绛夊緟鍙戦€佹寜閽?', 'running');
      void sendCurrentMessageFromUploadPanel('shortcut', runId).catch((err) => {
        const errText = err && err.message ? err.message : String(err);
        console.error('[ChatGPT toolbox] send shortcut failed', err);
        setStatus(`蹇嵎閿彂閫佸け璐ワ細${errText}`, 'error');
        ToolboxShell.appendLog(`[UPLOAD_DIAG][send-shortcut:failed] error=${errText}`);
        resetUploadSendShortcutState('shortcut-catch', runId);
      });
      return true;
    }

    async function triggerSendHotkeyOnce() {
      setStatus('姝ｅ湪璇锋眰 GUI 鍙戦€?Ctrl+Alt+I', 'running');
      ToolboxShell.appendLog('[SYSTEM_HOTKEY][REQUEST] combo=ctrl+alt+i');

      try {
        const result = await BridgeModule.sendSystemHotkey('ctrl+alt+i');
        setStatus('宸茶姹?GUI 鍙戦€?Ctrl+Alt+I', 'success');
        ToolboxShell.appendLog('[SYSTEM_HOTKEY][DONE] combo=ctrl+alt+i result=' + JSON.stringify(result).slice(0, 200));
        return true;
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.error('[SYSTEM_HOTKEY][FAILED]', {
          error_type: err && err.name,
          error: errText,
          stack: err && err.stack,
        });
        setStatus(`GUI 蹇嵎閿け璐ワ細${errText}`, 'error');
        ToolboxShell.appendLog('[SYSTEM_HOTKEY][FAILED] error=' + errText);
        return false;
      }
    }

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
          setStatus('璇峰厛閫夋嫨鏂囦欢缁?');
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-groups]');
          appendUploadGroupLog('START_UPLOAD', { phase: 'blocked', reason: 'no-groups' });
          return buildUploadSkipResult('no-active-group');
        }
      }

      if (!state.activeGroupId) {
        setStatus('璇峰厛閫夋嫨鏂囦欢');
        ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-no-active-group]');
        appendUploadGroupLog('START_UPLOAD', { phase: 'blocked', reason: 'empty-activeGroupId' });
        return buildUploadSkipResult('no-active-group');
      }

      const activeFiles = getActiveGroupFiles();
      appendUploadGroupLog('START_UPLOAD', { phase: 'plan' });

      if (!activeFiles.length) {
        setStatus('褰撳墠椤圭洰娌℃湁鏂囦欢');
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
          setStatus(`褰撳墠鍒嗙粍鏂囦欢宸插叏閮ㄧ粦瀹氾細${attachedCount}/${totalCount}锛涘啀娆＄偣鍑烩€滃紑濮嬩笂浼犫€濆皢鍐嶆缁戝畾`, 'success');
          ToolboxShell.appendLog(
            `[UPLOAD_DIAG][startUpload:skip-all-attached] attached=${attachedCount} total=${totalCount}`,
          );
          return buildUploadResult(attachedCount, 0, false, totalCount, {
            skipped: true,
            reason: 'all-attached',
          });
        }

        scheduleRenderUpload('startUpload:skip-no-targets');
        setStatus(`褰撳墠娌℃湁鍙笂浼犳枃浠讹紝缂哄け ${missingTargets.length} 涓紝璇烽噸鏂扮粦瀹氭垨閲嶆柊鎷栧叆`);
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
          `鏈璺宠繃 ${missingTargets.length} 涓己灏戞枃浠堕」锛岀户缁笂浼?${uploadableTargets.length} 涓彲涓婁紶鏂囦欢`
        );
      }

      startDuplicateWatcher();

      state.running = true;
      state.cancelled = false;
      state.runId += 1;
      const runId = state.runId;
      state.uploadAbortController = new AbortController();

      scheduleRenderUpload('startUpload:before-loop');

      ToolboxShell.appendLog(`寮€濮嬫壒閲忎笂浼狅細褰撳墠锛?{getActiveGroupName()}锛屾枃浠舵暟 ${uploadableTargets.length}`);

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

          setStatus(`姝ｅ湪涓婁紶 ${getActiveGroupName()} ${i + 1}/${total}锛?{q.name}`);
          ToolboxShell.appendLog(`鎵归噺涓婁紶 ${i + 1}/${total} 涓細${q.name}`);

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
              message: '涓婁紶娴佺▼缁撴潫鏃朵粛鏈畬鎴?',
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
          ToolboxShell.appendLog('[UPLOAD_DIAG][startUpload:skip-idle-wait] 鎵€鏈夋枃浠跺凡纭 ATTACHED锛岃烦杩囬暱鏃堕棿绌洪棽绛夊緟');
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
              item.message = '涓婁紶娴佺▼瓒呮椂鎴栨湭姝ｅ父缁撴潫锛岃閲嶆柊鐐瑰嚮涓婁紶';
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
            ? `宸插仠姝笂浼狅細鎴愬姛 ${result.success}锛屽け璐?${result.failed}`
            : result.failed > 0
              ? `涓婁紶鏈叏閮ㄥ畬鎴愶細鎴愬姛 ${result.success}锛屽け璐?${result.failed}`
              : `涓婁紶瀹屾垚锛氭垚鍔?${result.success}锛屽け璐?0`;
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
        throw new Error('绌烘枃浠堕」锛屾棤娉曡В鏋愪笂浼犲璞?');
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
        throw new Error(`鏂囦欢缂哄皯 download_url锛屾棤娉曚粠 Flask 鑾峰彇鍐呭锛?{fileName}`);
      }

      const response = await fetch(downloadUrl, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(
          `涓嬭浇鏂囦欢澶辫触锛?{response.status} ${response.statusText} ${fileName}`,
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
          text.includes('娣诲姞')
          || text.includes('涓婁紶')
          || text.includes('Attach')
          || text.includes('Upload')
          || aria.includes('Attach')
          || aria.includes('Upload')
          || aria.includes('娣诲姞')
          || aria.includes('涓婁紶')
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
        ToolboxShell.showToast('娌℃湁寰呬笂浼犳枃浠?', 'warn', 1800);
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
          : 'attachFilesByFileInput 鏈垚鍔?';
        throw new Error(reason);
      }

      const input = findChatGPTFileInput();
      if (!input) {
        throw new Error('鏈壘鍒?ChatGPT 鏂囦欢杈撳叆妗?input[type=file]');
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
            message: '宸茬粦瀹氬埌杈撳叆妗?',
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
        setStatus('姝ｅ湪涓婁紶涓紝璇风◢鍚?', 'running');
        ToolboxShell.appendLog(
          `[UPLOAD][START][SKIP] source=${uploadSource} reason=already-running`,
        );
        return buildUploadSkipResult('already-running');
      }

      // 閲嶇疆宸茬粦瀹氱殑鏂囦欢锛屽厑璁稿啀娆′笂浼?
      resetQueueItemsForUpload({ forceResetAttached: true });

      resetFlaskFilesForUpload(`handleStartUploadClick:${uploadSource}`);

      const pendingItems = getPendingUploadItems();

      if (!pendingItems.length) {
        const stats = getUploadCountStats();
        const hint = '娌℃湁寰呬笂浼犳枃浠讹細褰撳墠娌圭尨涓婁紶闃熷垪涓虹┖锛屼笖娌℃湁鍙笅杞界殑 Flask 鏈湴鏂囦欢銆?';
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
        setStatus('姝ｅ湪涓婁紶鈥?', 'running');
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
          `宸叉彁浜?${files.length} 涓枃浠跺埌 ChatGPT 涓婁紶妗哷,`,
          'success',
          2200,
        );
        console.log('[UPLOAD][DONE]', files.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
        })));
        setStatus(`宸叉彁浜?${files.length} 涓枃浠跺埌 ChatGPT`, 'success');

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
        ToolboxShell.showToast(`涓婁紶澶辫触锛?{errText}`, 'error', 3200);
        setStatus(`涓婁紶澶辫触锛?{errText}`, 'error');

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
          text: '澶嶅埗鏈€鍚庡洖澶?',
          title: '绛夊緟鏈€鍚庝竴鏉?assistant 鍥炲绋冲畾鍚庡鍒跺埌鍓创鏉?',
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
        'button[aria-label*="鍋滄"]',
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
              '鏈€鍚庝竴鏉″洖澶嶈繕娌℃湁鐢熸垚锛屾湭澶嶅埗涓婁竴杞唴瀹?',
              'warn',
              {
                persist: true,
                shortText: '鏈敓鎴?',
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('鏈€鍚庝竴鏉″洖澶嶈繕娌℃湁鐢熸垚', 'warn', 1200);
            }

            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:no-latest-assistant]');
          } else if (reason === 'timeout') {
            ToolboxShell.setStatus(
              '绛夊緟鏈€鍚庡洖澶嶇ǔ瀹氳秴鏃讹紝璇风◢鍚庡啀璇?',
              'warn',
              {
                persist: true,
                shortText: '瓒呮椂',
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('绛夊緟鍥炲绋冲畾瓒呮椂', 'warn', 1200);
            }

            ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:stable-timeout]');
          } else {
            ToolboxShell.setStatus('鏈壘鍒板彲澶嶅埗鐨勬渶鍚庝竴鏉″洖澶?', 'warn');

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast('鏈壘鍒版渶鍚庢秷鎭?', 'warn');
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
          `宸插鍒舵渶鍚庝竴鏉″洖澶嶏紙蹇収鍏滃簳锛夛細${stats.charCount} 瀛楃`,
              'success',
              { persist: false },
            );
            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast(`宸插鍒?${stats.charCount} 瀛楃`, 'success', 900);
            }
            setButtonTemporaryOk(copyLastMessageBtn);
            return true;
          }

          ToolboxShell.setStatus(
            reason === 'no-assistant-after-latest-user'
              ? '鏈€鍚庝竴鏉″洖澶嶈繕娌℃湁鐢熸垚锛屾湭澶嶅埗涓婁竴杞唴瀹?'
              : '鏈€鍚庢秷鎭牎楠屽け璐ワ紝鏈鍒舵棫鍐呭',
            'warn',
            {
              persist: true,
              shortText: '鏈鍒?',
            },
          );

          if (typeof ToolboxShell.showToast === 'function') {
            ToolboxShell.showToast('鏈€鍚庢秷鎭湭纭锛屾湭澶嶅埗鏃у唴瀹?', 'warn', 1500);
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
              `宸插鍒舵渶鍚庝竴鏉″洖澶嶏細${stats.charCount} 瀛楃锛屾眽瀛?${stats.hanCount}`,
              'success',
              {
                persist: false,
              },
            );

            if (typeof ToolboxShell.showToast === 'function') {
              ToolboxShell.showToast(
                `宸插鍒?${stats.charCount} 瀛楃`,
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
            ? '澶嶅埗澶辫触锛氭祻瑙堝櫒鎷掔粷鍐欏叆鍓创鏉匡紝璇峰惎鐢?GM_setClipboard 鎴栭噸鏂扮偣鍑诲鍒?'
            : `澶嶅埗鏈€鍚庝竴鏉″洖澶嶅け璐ワ細${errText}`,
          'error',
          {
            persist: true,
            shortText: '澶嶅埗澶辫触',
          },
        );

        if (typeof ToolboxShell.showToast === 'function') {
          ToolboxShell.showToast(
            isFocusClipboardError ? '鍓创鏉胯娴忚鍣ㄦ嫆缁' : '澶嶅埗澶辫触',
            'error',
            1500,
          );
        }

        ToolboxShell.appendLog(`[CHAT_PAGE][copy-last-message:failed] source=${source} error=${errText}`);
        ToolboxShell.appendLog('[CHAT_PAGE][copy-last-message:beep-skip] reason=copy-failed');
        setButtonTemporaryError(copyLastMessageBtn, '澶嶅埗澶辫触', 1200);

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
            '姝ｅ湪澶嶅埗鏈€鍚庡洖澶嶏紝璇蜂笉瑕侀噸澶嶈Е鍙?',
            'running',
            {
              persist: true,
              shortText: copyLastMessageWaiting ? '绛夊洖绛' : '澶嶅埗涓',
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
          '澶嶅埗鏈€鍚庡洖澶?',
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

      if (action === 'send-message' && (isWaitingSendActive() || state.waitingReply)) {
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
          '澶嶅埗鏈€鍚庡洖澶?',
        );
        return true;
      }

      if (action === 'send-message') {
        const capability = getUploadPageCapability();
        if (!capability.canSendNow) {
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
          setStatus(`鍙戦€佷俊鎭け璐ワ細${errText}`, 'error');
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
          '澶嶅埗骞剁户缁?',
        );

        return true;
      }

      if (action === 'start-upload') {
        void triggerStartUpload(src || 'button').catch((err) => {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] start upload UI action failed', err);
          setStatus(`涓婁紶澶辫触锛?{errText}`, 'error');
          ToolboxShell.appendLog(`[UPLOAD_UI_ACTION][start-upload:failed] error=${errText}`);
        });

        return true;
      }

      return false;
    }

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
            '澶嶅埗鏈€鍚庡洖澶?',
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
          runUploadActionPromise(triggerSendHotkeyOnce(), '鍙戦€?Ctrl+Alt+I');
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
              setStatus('鑷姩缁х画妯″潡涓嶅彲鐢?', 'warn');
              return false;
            }
            return AutoQueueModule.triggerContinueOnce();
          })(), '鑷姩缁х画');
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
            '澶嶅埗+蹇嵎閿?缁х画',
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
            '杩炵画澶嶅埗+蹇嵎閿?缁х画',
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

        setStatus(`${actionName}澶辫触锛?{errText}`, 'error');

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
        console.error('[ChatGPT toolbox] bindEvents: 缂哄皯 #cgpt-upload-start');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-btn]');
      }

      const uploadStartSendBtn = qs(UploadSelectors.startSendBtn, rootEl);
      if (!uploadStartSendBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缂哄皯 #cgpt-upload-start-send');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-upload-start-send-btn]');
      }

      const copyContinueBtn = qs(UploadSelectors.copyContinueBtn, rootEl);
      if (!copyContinueBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缂哄皯 #cgpt-upload-continue-once');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-copy-continue-btn]');
      }

      const copyLastMessageBtn = qs('#cgpt-copy-last-message-scroll-bottom', rootEl);

      if (!copyLastMessageBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缂哄皯 #cgpt-copy-last-message-scroll-bottom');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-copy-last-message-btn]');
      }

      const addInlineBtn = qs('#cgpt-upload-group-add-inline', rootEl);
      if (addInlineBtn) {
        addInlineBtn.addEventListener('click', () => {
          runUploadActionPromise(createGroupInline(), '鏂板缓鍒嗙粍');
        });
      }

      const groupManageBtn = qs('#cgpt-upload-group-manage', rootEl);
      if (!groupManageBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缂哄皯 #cgpt-upload-group-manage');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-manage-btn]');
      } else {
        groupManageBtn.addEventListener('click', () => {
          toggleGroupManagePanel();
        });
      }

      const groupRenameBtn = qs('#cgpt-upload-group-rename-inline', rootEl);
      if (!groupRenameBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缂哄皯 #cgpt-upload-group-rename-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-rename-btn]');
      } else {
        groupRenameBtn.addEventListener('click', () => {
          runUploadActionPromise(renameActiveGroupInline(), '閲嶅懡鍚嶅垎缁?');
        });
      }

      if (groupNameInputEl) {
        groupNameInputEl.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;

          e.preventDefault();
          e.stopPropagation();

          runUploadActionPromise(renameActiveGroupInline(), '閲嶅懡鍚嶅垎缁?');
        });

        groupNameInputEl.addEventListener('blur', () => {
          const text = String(groupNameInputEl.value || '').trim();

          if (!text) return;
          if (text === lastGroupNameInputValue) return;

          runUploadActionPromise(renameActiveGroupInline(), '閲嶅懡鍚嶅垎缁?');
        });
      }

      const groupClearBtn = qs('#cgpt-upload-group-clear-inline', rootEl);
      if (!groupClearBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缂哄皯 #cgpt-upload-group-clear-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-clear-btn]');
      } else {
        groupClearBtn.addEventListener('click', (e) => {
          runUploadActionPromise(clearActiveGroupQueueInline(e.currentTarget), '娓呯┖褰撳墠鍒嗙粍');
        });
      }

      const groupDeleteBtn = qs('#cgpt-upload-group-delete-inline', rootEl);
      if (!groupDeleteBtn) {
        console.error('[ChatGPT toolbox] bindEvents: 缂哄皯 #cgpt-upload-group-delete-inline');
        ToolboxShell.appendLog('[UPLOAD_DIAG][bindEvents:missing-group-delete-btn]');
      } else {
        groupDeleteBtn.addEventListener('click', (e) => {
          runUploadActionPromise(deleteActiveGroupInline(e.currentTarget), '鍒犻櫎褰撳墠鍒嗙粍');
        });
      }

            // Blob persistence binding removed - disabled

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

          setStatus(`鍒囨崲鍒嗙粍澶辫触锛?{errText}`, 'error');

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

            setStatus(`绠＄悊鍒楄〃鍒囨崲鍒嗙粍澶辫触锛?{errText}`, 'error');

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
            setStatus(`绉婚櫎鏂囦欢澶辫触锛?{errText}`);
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

            setStatus(`閲嶆柊缁戝畾鏂囦欢澶辫触锛?{errText}`, 'error');

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
          setStatus('鏈壘鍒板搴旀枃浠?');
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

            const category = categoryBtn.getAttribute('data-upload-quick-prompt-category') || '鍏ㄩ儴';
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
            setStatus('鏈壘鍒板搴?Prompt');
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
          <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">绠＄悊</button>
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
        sendHotkeyBtn.textContent = '鍙戦€?Ctrl+Alt+I';
        actionRow.insertBefore(sendHotkeyBtn, copyLastBtn);
      }

      let autoContinueBtn = qs(UploadSelectors.autoContinueBtn, actionRow);
      if (!autoContinueBtn) {
        autoContinueBtn = document.createElement('button');
        autoContinueBtn.type = 'button';
        autoContinueBtn.className = 'cgpt-btn teal';
        autoContinueBtn.id = 'cgpt-auto-continue-once';
        autoContinueBtn.textContent = '鑷姩缁х画';
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
        copyHotkeyContinueOnceBtn.textContent = '澶嶅埗+蹇嵎閿?缁х画';
        copyLastBtn.insertAdjacentElement('afterend', copyHotkeyContinueOnceBtn);
      }

      let copyHotkeyContinueLoopBtn = qs(UploadSelectors.copyHotkeyContinueLoopBtn, actionRow);
      if (!copyHotkeyContinueLoopBtn) {
        copyHotkeyContinueLoopBtn = document.createElement('button');
        copyHotkeyContinueLoopBtn.type = 'button';
        copyHotkeyContinueLoopBtn.className = 'cgpt-btn cyan';
        copyHotkeyContinueLoopBtn.id = 'cgpt-copy-hotkey-continue-loop';
        copyHotkeyContinueLoopBtn.textContent = '杩炵画澶嶅埗+蹇嵎閿?缁х画';
        copyHotkeyContinueLoopBtn.title = '寰幆鎵ц锛氱瓑寰呭洖绛斿畬鎴?-> 澶嶅埗鏈€鍚庡洖澶?-> Ctrl+Alt+I -> 鍙戦€佺户缁?';
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
          setStatus(`鍙戦€?Ctrl+Alt+I 澶辫触锛?{error && error.message ? error.message : error}`, 'error');
        }
      }, 'UPLOAD');

      DomUtil.bindClick(rootEl, UploadSelectors.autoContinueBtn, async () => {
        try {
          if (!AutoQueueModule || typeof AutoQueueModule.triggerContinueOnce !== 'function') {
            setStatus('鑷姩缁х画妯″潡涓嶅彲鐢?', 'warn');
            return;
          }
          await AutoQueueModule.triggerContinueOnce();
        } catch (error) {
          console.error('[AUTO_CONTINUE][FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
          setStatus(`鑷姩缁х画澶辫触锛?{error && error.message ? error.message : error}`, 'error');
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
          setStatus(`澶嶅埗+蹇嵎閿?缁х画澶辫触锛?{error && error.message ? error.message : error}`, 'error');
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
          setStatus(`杩炵画澶嶅埗+蹇嵎閿?缁х画澶辫触锛?{error && error.message ? error.message : error}`, 'error');
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
          message: '澶嶅埗鏈€鍚庡洖澶嶆寜閽閿欒鏀捐繘绠＄悊闈㈡澘',
          invalidLog: '[UPLOAD_DOM][invalid] 澶嶅埗鏈€鍚庡洖澶嶆寜閽閿欒鏀捐繘绠＄悊闈㈡澘',
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
          message: '椤圭洰鍒嗙粍鏍忓簲浣嶄簬寮€濮嬩笂浼犳寜閽箣鍓?',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-start',
          message: '涓婁紶鎸夐挳琚敊璇寘杩涚鐞嗛潰鏉?',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-start-send',
          message: '鍙戦€佷俊鎭寜閽閿欒鍖呰繘绠＄悊闈㈡澘',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-continue-once',
          message: '澶嶅埗骞剁户缁寜閽閿欒鏀捐繘绠＄悊闈㈡澘',
          invalidLog: '[UPLOAD_DOM][invalid] 澶嶅埗骞剁户缁寜閽閿欒鏀捐繘绠＄悊闈㈡澘',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-list',
          message: '涓婁紶鍒楄〃琚敊璇寘杩涚鐞嗛潰鏉?',
        },
        {
          type: 'notContains',
          parent: '#cgpt-upload-manage-panel',
          child: '#cgpt-upload-quick-prompts',
          message: '甯哥敤 Prompt 琚敊璇寘杩涚鐞嗛潰鏉?',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start',
          after: '#cgpt-upload-list',
          message: '涓婁紶鏂囦欢鍒楄〃搴斾綅浜庝笂浼犳寜閽箣鍚?',
        },
        {
          type: 'order',
          before: '#cgpt-upload-list',
          after: '#cgpt-upload-quick-prompts',
          message: '甯哥敤 Prompt 搴斾綅浜庝笂浼犳枃浠跺垪琛ㄤ箣鍚?',
        },
        {
          type: 'order',
          before: '#cgpt-upload-start-send',
          after: '#cgpt-upload-continue-once',
          message: '澶嶅埗骞剁户缁寜閽簲浣嶄簬鍙戦€佷俊鎭寜閽箣鍚?',
        },
        {
          type: 'order',
          before: '#cgpt-upload-continue-once',
          after: '#cgpt-send-hotkey-once',
          message: '鍙戦€?Ctrl+Alt+I鎸夐挳搴斾綅浜庡鍒跺苟缁х画鎸夐挳涔嬪悗',
        },
        {
          type: 'order',
          before: '#cgpt-send-hotkey-once',
          after: '#cgpt-auto-continue-once',
          message: '鑷姩缁х画鎸夐挳搴斾綅浜庡彂閫?Ctrl+Alt+I鎸夐挳涔嬪悗',
        },
        {
          type: 'order',
          before: '#cgpt-auto-continue-once',
          after: '#cgpt-copy-last-message-scroll-bottom',
          message: '澶嶅埗鏈€鍚庡洖澶嶆寜閽簲浣嶄簬鑷姩缁х画鎸夐挳涔嬪悗',
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
          message: '澶嶅埗+蹇嵎閿?缁х画鎸夐挳搴斾綅浜庡鍒舵渶鍚庡洖澶嶆寜閽箣鍚?',
        },
        {
          type: 'order',
          before: '#cgpt-copy-hotkey-continue-once',
          after: '#cgpt-copy-hotkey-continue-loop',
          message: '杩炵画澶嶅埗+蹇嵎閿?缁х画鎸夐挳搴斾綅浜庡鍒?蹇嵎閿?缁х画鎸夐挳涔嬪悗',
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
        saveQuickPromptActiveCategory('鍏ㄩ儴', {
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

      
return clearPersistedUploadBlobs('startup-disable-blob-cache')
        .catch((e) => {
          console.warn('[ChatGPT toolbox] startup clearPersistedUploadBlobs failed', e);
        })
        .then(() => loadGroups())
        .then(() => refreshUploadGroupCounts())
        .then(() => loadQueueForActiveGroup())
        .then(() => render())
        .then(() => applyToolboxPageState(getToolboxPageState(), 'upload-groups-ready'))
        .then(() => {
          uploadGroupsInitResolved = true;
          ensureActiveUploadGroupIdValid('init-pipeline-complete');
          syncUploadGroupAppState();
                ToolboxShell.appendLog('[UPLOAD_DIAG][blob-cache-disabled] upload blob persistence disabled');
      appendUploadGroupLog('INIT', { stage: 'pipeline-complete', reason: reason || '-' });
        })
        .catch((err) => {
          const errName = err && err.name ? err.name : 'Error';
          const errText = err && err.message ? err.message : String(err);
          const errStack = err && err.stack ? err.stack : errText;
          console.error('[ChatGPT toolbox] init upload groups failed', err);
          setStatus(`涓婁紶闃熷垪鍒濆鍖栧け璐ワ細${errText}`, 'error');
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
        console.error('[ChatGPT toolbox] UploadModule.mount: targetHost 涓虹┖');
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
          <div class="cgpt-section-title">澶氭枃浠朵笂浼?/div>
          <div class="cgpt-upload-groups-head" id="cgpt-toolbox-project-stats-row">
            <div class="cgpt-upload-group-bar">
              <div class="cgpt-upload-group-list" id="cgpt-upload-group-list"></div>
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-manage">绠＄悊</button>
            </div>
          </div>
          <div class="cgpt-upload-manage-panel cgpt-toolbox-hidden" id="cgpt-upload-manage-panel">
            <div class="cgpt-upload-manage-title">鏂囦欢缁勭鐞?/div>

            <div class="cgpt-upload-manage-layout">
              <div class="cgpt-upload-manage-left">
                <div class="cgpt-upload-manage-subtitle-row">
                  <span>鍏ㄩ儴鍒嗙粍</span>
                  <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-add-inline">鏂板缓</button>
                </div>
                <div class="cgpt-upload-manage-group-list" id="cgpt-upload-manage-group-list"></div>
              </div>

              <div class="cgpt-upload-manage-right">
                <div class="cgpt-upload-manage-subtitle">褰撳墠鍒嗙粍</div>

                <div class="cgpt-upload-manage-row">
                  <input class="cgpt-input" id="cgpt-upload-group-name-input" placeholder="褰撳墠鍒嗙粍鍚嶇О">
                  <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-upload-group-rename-inline">淇濆瓨鍚嶇О</button>
                </div>

                <div class="cgpt-upload-manage-row">
                  <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-clear-inline">娓呯┖褰撳墠缁?/button>
                  <button type="button" class="cgpt-toolbox-small-btn danger" id="cgpt-upload-group-delete-inline">鍒犻櫎褰撳墠缁?/button>
                </div>

                <div class="cgpt-hint">杩欓噷鍙鐞嗗綋鍓嶆枃浠剁粍锛屼笉浼氳嚜鍔ㄤ笂浼犲埌 ChatGPT銆?/div>
              </div>
            </div>

            <div class="cgpt-upload-common-settings">
              <div class="cgpt-upload-manage-subtitle">鍏叡涓婁紶璁剧疆</div>

              <!-- Blob persistence disabled - file content no longer saved to IndexedDB -->

              <label class="cgpt-checkbox-line">
                <input type="checkbox" id="cgpt-upload-use-unique-name-inline">
                涓婁紶鏃跺姞鏃堕棿鎴?搴忓彿锛堜粎鍐呭瓨锛屼緥锛氣€20260523_200319_01.zip锛?
              </label>

              <div class="cgpt-hint">杩欎簺璁剧疆瀵规墍鏈夋枃浠剁粍鐢熸晥銆?/div>
            </div>
          </div>
          <div class="cgpt-row cgpt-upload-action-row">
            <button type="button" class="cgpt-btn success" id="cgpt-upload-start">寮€濮嬩笂浼?/button>
            <button type="button" class="cgpt-btn primary" id="cgpt-upload-start-send">鍙戦€佷俊鎭?/button>
            <button type="button" class="cgpt-btn cgpt-btn-copy-continue" id="cgpt-upload-continue-once" title="鍏堝鍒舵渶鍚庡洖澶嶏紝鍐嶅彂閫佲€滅户缁€?>澶嶅埗骞剁户缁?/button>
            <button type="button" class="cgpt-btn warning" id="cgpt-send-hotkey-once">鍙戦€?Ctrl+Alt+I</button>
            <button type="button" class="cgpt-btn teal" id="cgpt-auto-continue-once">鑷姩缁х画</button>
            <button type="button" class="cgpt-btn" id="cgpt-copy-last-message-scroll-bottom">澶嶅埗鏈€鍚庡洖澶?/button>
            <button type="button" class="cgpt-btn purple" id="cgpt-copy-hotkey-continue-once" title="澶嶅埗鏈€鍚庡洖澶?-> 鍙戦€?Ctrl+Alt+I -> 鍙戦€佺户缁?>澶嶅埗+蹇嵎閿?缁х画</button>
            <button type="button" class="cgpt-btn cyan" id="cgpt-copy-hotkey-continue-loop" title="寰幆鎵ц锛氱瓑寰呭洖绛斿畬鎴?-> 澶嶅埗鏈€鍚庡洖澶?-> Ctrl+Alt+I -> 鍙戦€佺户缁?>杩炵画澶嶅埗+蹇嵎閿?缁х画</button>
          </div>

          <div class="cgpt-upload-list" id="cgpt-upload-list"></div>

          <div id="cgpt-upload-quick-prompts" class="cgpt-upload-quick-prompts">
            <div class="cgpt-upload-quick-prompts-title">甯哥敤 Prompt</div>
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

    function startWaitingReplyCheck(runId, sendStartedAt) {
      stopWaitingReplyCheck();
      state.waitingReplyRunId = runId;
      state.waitingReplyCheckedAt = Date.now();
      state.waitingReplyTimer = setInterval(function () {
        if (state.cancelWaitingSend || !state.waitingReply) {
          stopWaitingReplyCheck();
          return;
        }
        var elapsed = Date.now() - state.waitingReplyCheckedAt;
        if (elapsed > 120000) {
          ToolboxShell.appendLog(`[UPLOAD_SEND_UI][STATE] action=timeout state=idle`);
          finishWaitingReply('timeout');
          return;
        }
        try {
          var capability = getPageCapability('waiting-reply');
          if (!capability.is_responding && capability.response_state !== 'generating') {
            finishWaitingReply('reply_done');
          }
        } catch (err) {
          console.error('[ChatGPT toolbox] waiting reply check error', err);
        }
      }, 1500);
      state.waitingReplyTimerRef = state.waitingReplyTimer;
    }

    function stopWaitingReplyCheck() {
      if (state.waitingReplyTimer) {
        clearInterval(state.waitingReplyTimer);
        state.waitingReplyTimer = null;
      }
    }

    function finishWaitingReply(reason) {
      stopWaitingReplyCheck();
      state.waitingReply = false;
      if (reason === 'reply_done') {
        setStatus('鍥炲瀹屾垚');
        ToolboxShell.appendLog(`[UPLOAD_SEND_UI][STATE] action=reply_done state=idle`);
      } else if (reason === 'timeout') {
        setStatus('绛夊緟鍥炲瓒呮椂', 'warn');
        ToolboxShell.appendLog(`[UPLOAD_SEND_UI][STATE] action=timeout state=idle`);
      } else if (reason === 'cancel') {
        ToolboxShell.appendLog(`[UPLOAD_SEND_UI][STATE] action=cancel state=idle`);
      }
      resetUploadSendShortcutState(`waiting-reply:${reason}`, state.waitingReplyRunId);
      state.waitingReplyRunId = null;
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
