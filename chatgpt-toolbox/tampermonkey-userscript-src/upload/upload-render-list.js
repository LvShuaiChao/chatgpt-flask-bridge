  /********************************************************************
   * UploadRenderList：上传列表与分组 chip UI 渲染
   ********************************************************************/

  const UploadRenderList = (() => {
    function create(deps) {
      const state = deps.state;
      const appendUploadLog = deps.appendUploadLog;
      const refs = deps.refs;
      const getActiveGroupId = deps.getActiveGroupId;
      const getActiveGroupFiles = deps.getActiveGroupFiles;
      const getSelectedFileIdForActiveGroup = deps.getSelectedFileIdForActiveGroup;
      const getActiveGroup = deps.getActiveGroup;
      const getUploadGroupStableKey = deps.getUploadGroupStableKey;
      const hasAttemptableUploadSource = deps.hasAttemptableUploadSource;
      const isUploadItemLocallyUnreadable = deps.isUploadItemLocallyUnreadable;
      const getActiveGroupDbCount = deps.getActiveGroupDbCount;
      const getQueueRestorePhase = deps.getQueueRestorePhase;
      const diagnoseUploadListRender = deps.diagnoseUploadListRender;
      const uploadTimers = deps.uploadTimers;
      const UploadSelectors = deps.UploadSelectors;
      const qs = deps.qs;
      const escapeHtml = deps.escapeHtml;
      const formatFileSize = deps.formatFileSize;
      const isUploadDebugEnabled = deps.isUploadDebugEnabled;
      const renderUploadButtonsOnly = deps.renderUploadButtonsOnly;
      const scheduleRenderUpload = deps.scheduleRenderUpload;
      const setSelectedFileIdForActiveGroup = deps.setSelectedFileIdForActiveGroup;
      const rebindUploadFile = deps.rebindUploadFile;
      const requestUploadFilePermission = deps.requestUploadFilePermission;
      const removeFileFromCurrentGroup = deps.removeFileFromCurrentGroup;
      const switchGroup = deps.switchGroup;
      const renameActiveGroupInline = deps.renameActiveGroupInline;
      const deleteActiveGroupInline = deps.deleteActiveGroupInline;
      const clearActiveGroupQueueInline = deps.clearActiveGroupQueueInline;
      const createGroupInline = deps.createGroupInline;
      const ensureQueueReadyForVisibleUploadList = deps.ensureQueueReadyForVisibleUploadList;
      const scheduleQueueRestoreForVisibleMismatch = deps.scheduleQueueRestoreForVisibleMismatch;
      const countRenderedUploadListItems = deps.countRenderedUploadListItems;
      const UPLOAD_PROJECT_NAME_KEY_MAP = deps.UPLOAD_PROJECT_NAME_KEY_MAP;

      const getActiveUploadScopeGroupId = deps.getActiveUploadScopeGroupId;
      const isUploadItemInActiveScope = deps.isUploadItemInActiveScope;
      const getFlaskUploadFileId = deps.getFlaskUploadFileId;
      const findQueueItemByFlaskFileId = deps.findQueueItemByFlaskFileId;
      const getUploadItemGroupId = deps.getUploadItemGroupId;

      const clearStaleUnreadableFlagsForReadableItem = deps.clearStaleUnreadableFlagsForReadableItem;
      const getUploadItemVisualClass = deps.getUploadItemVisualClass;
      const isUploadSourceCacheForbidden = deps.isUploadSourceCacheForbidden;
      const getUploadInlineStatusText = deps.getUploadInlineStatusText;
      const hasLocalReadableHandle = deps.hasLocalReadableHandle;
      const buildUploadItemTitle = deps.buildUploadItemTitle;
      const shouldShowRebindButton = deps.shouldShowRebindButton;
      const shouldShowGrantPermissionButton = deps.shouldShowGrantPermissionButton;
      const isUploadListDebugEnabled = deps.isUploadListDebugEnabled;

      const refreshQueueReadableState = deps.refreshQueueReadableState;
      const logSlowOperation = deps.logSlowOperation;
      const isUploadCriticalNow = deps.isUploadCriticalNow;

      const appendUploadGroupLog = deps.appendUploadGroupLog;
      const ensureActiveUploadGroupIdValid = deps.ensureActiveUploadGroupIdValid;
      const ensureDefaultGroupReady = deps.ensureDefaultGroupReady;
      const ensureUploadGroupSection = deps.ensureUploadGroupSection;
      const getUploadGroupFileCount = deps.getUploadGroupFileCount;
      const stripTrailingCountFromGroupName = deps.stripTrailingCountFromGroupName;
      const syncUploadGroupAppState = deps.syncUploadGroupAppState;
      const shouldSkipHeavyUploadRenderDuringAutoQueueWaitingReply = deps.shouldSkipHeavyUploadRenderDuringAutoQueueWaitingReply;

      const getUploadGroupsInitResolved = typeof deps.getUploadGroupsInitResolved === 'function'
        ? deps.getUploadGroupsInitResolved
        : () => false;
      const getUploadModuleInitPromise = typeof deps.getUploadModuleInitPromise === 'function'
        ? deps.getUploadModuleInitPromise
        : () => Promise.resolve();

      const formatBytes = deps.formatBytes || deps.formatFileSize || formatFileSize;
      const UploadState = deps.UploadState;
      const normalizeUploadStateValue = deps.normalizeUploadStateValue;

      const getHost = typeof deps.getHost === 'function' ? deps.getHost : () => null;

      const UPLOAD_LIST_RENDER_LIMIT = Number.isFinite(Number(deps.UPLOAD_LIST_RENDER_LIMIT))
        ? Number(deps.UPLOAD_LIST_RENDER_LIMIT)
        : 50;

      const UPLOAD_LIST_RENDER_MIN_INTERVAL_MS = Number.isFinite(Number(deps.UPLOAD_LIST_RENDER_MIN_INTERVAL_MS))
        ? Number(deps.UPLOAD_LIST_RENDER_MIN_INTERVAL_MS)
        : 800;

      let lastUploadListRenderExecutedAt = 0;
      let uploadListRenderTimer = 0;
      let uploadListRenderPendingReason = '';
      let groupNameInputEl = null;
      let lastGroupNameInputValue = '';
      let clearConfirmUntil = 0;
      let deleteConfirmUntil = 0;

      function auditUploadRenderListDeps() {
        const required = {
          getActiveUploadScopeGroupId,
          isUploadItemInActiveScope,
          getFlaskUploadFileId,
          findQueueItemByFlaskFileId,
          getUploadItemGroupId,
          clearStaleUnreadableFlagsForReadableItem,
          getUploadItemVisualClass,
          isUploadSourceCacheForbidden,
          getUploadInlineStatusText,
          hasLocalReadableHandle,
          buildUploadItemTitle,
          shouldShowRebindButton,
          shouldShowGrantPermissionButton,
          isUploadListDebugEnabled,
          refreshQueueReadableState,
          logSlowOperation,
          isUploadCriticalNow,
          appendUploadGroupLog,
          ensureActiveUploadGroupIdValid,
          ensureDefaultGroupReady,
          ensureUploadGroupSection,
          getUploadGroupFileCount,
          stripTrailingCountFromGroupName,
          syncUploadGroupAppState,
          shouldSkipHeavyUploadRenderDuringAutoQueueWaitingReply,
          formatBytes,
          normalizeUploadStateValue,
        };

        const missing = Object.entries(required)
          .filter(([, value]) => typeof value !== 'function')
          .map(([name]) => name);

        if (!UploadState) {
          missing.push('UploadState');
        }

        if (missing.length > 0) {
          const message = `[UPLOAD_RENDER_LIST][DEPS_MISSING] missing=${missing.join('|')}`;
          console.error(message);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(message);
          }
        } else if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function') {
          ToolboxShell.appendLogIfChanged(
            'UPLOAD_RENDER_LIST:deps_ok',
            'ok',
            '[UPLOAD_RENDER_LIST][DEPS_OK]',
            5000,
          );
        }
      }

      auditUploadRenderListDeps();

    function buildFlaskUploadListHtml() {
      const activeGroupId = getActiveUploadScopeGroupId();
      const flaskRows = (state.flaskFiles || []).filter(
        (row) => row
          && row.status !== 'uploaded'
          && isUploadItemInActiveScope(row, activeGroupId),
      );

      return flaskRows.map((row) => {
        const fileId = getFlaskUploadFileId(row);
        const queueItem = findQueueItemByFlaskFileId(fileId, activeGroupId);
        const uploadItemId = String(
          (queueItem && queueItem.id) || row.id || fileId || '',
        ).trim();
        const groupId = getUploadItemGroupId(queueItem || row) || activeGroupId;
        const flaskStatusText = '本地直读 · 未上传';
        const itemTitle = escapeHtml([
          `文件名：${row.name || '-'}`,
          `大小：${formatBytes(row.size)}`,
          '状态：未上传',
          '读取方式：本地直读',
          row.download_url ? `下载：${row.download_url}` : '',
        ].filter(Boolean).join('\n'));

        return `
            <div class="cgpt-upload-item flask-local-direct"
              data-id="${escapeHtml(uploadItemId)}"
              data-upload-file-row="1"
              data-upload-item-id="${escapeHtml(uploadItemId)}"
              data-group-id="${escapeHtml(groupId)}"
              data-flask-file-id="${escapeHtml(fileId)}"
              title="${itemTitle}">
              <div class="cgpt-upload-file-main">
                <div class="cgpt-upload-name">${escapeHtml(row.name || 'unknown')}</div>
                <div class="cgpt-upload-meta">
                  ${escapeHtml(formatBytes(row.size))}
                  <span class="cgpt-upload-dot">·</span>
                  <span class="cgpt-upload-source-label">${escapeHtml(flaskStatusText)}</span>
                </div>
              </div>
            </div>
          `;
      }).join('');
    }

    function buildUploadQueueItemHtml(q, activeGroupId, selectedFileId) {
      if (!q || !q.id) {
        return '';
      }
      clearStaleUnreadableFlagsForReadableItem(q, 'buildUploadQueueItemHtml');
      const activeClass = selectedFileId === q.id ? 'active' : '';
      const visualClass = getUploadItemVisualClass(q);
      const cachedClass = isUploadSourceCacheForbidden(q) ? 'cached-snapshot' : '';
      const sourceText = getUploadInlineStatusText(q);
      if (isUploadDebugEnabled()) {
        ToolboxShell.appendLog(
          `[UPLOAD_UI][ITEM_STATE] name=${q.name || '-'} `
          + `text=${sourceText || '-'} `
          + `visual=${visualClass || '-'} `
          + `state=${q.state || '-'} `
          + `status=${q.status || '-'} `
          + `registryStatus=${q.registryStatus || '-'} `
          + `restoreState=${q.restoreState || '-'} `
          + `sourceKind=${q.sourceKind || '-'} `
          + `readMode=${q.readMode || '-'} `
          + `handle=${hasLocalReadableHandle(q) ? 1 : 0} `
          + `attemptable=${hasAttemptableUploadSource(q) ? 1 : 0} `
          + `cacheForbidden=${isUploadSourceCacheForbidden(q) ? 1 : 0}`,
        );
      }
      const itemTitle = escapeHtml(buildUploadItemTitle(q));
      const normalizedState = String(q.state || '').trim().toLowerCase();
      const removeDisabled = normalizedState === 'uploading' || normalizedState === 'cancelling';
      const errorText = String(q.error || q.lastError || '').trim();
      const errorHtml = errorText
        ? `<div class="cgpt-upload-meta cgpt-upload-error" data-upload-item-error>${escapeHtml(errorText)}</div>`
        : '';

      const rebindButtonHtml = shouldShowRebindButton(q)
        ? `
            <button type="button"
              class="cgpt-upload-file-rebind"
              data-no-row-upload="1"
              data-action="rebind-upload-file"
              data-cgpt-base-action="rebind-upload-file"
              data-upload-rebind-id="${escapeHtml(q.id)}"
              title="重新选择本地文件">
              重新绑定
            </button>
          `
        : '';
      const grantPermissionButtonHtml = shouldShowGrantPermissionButton(q)
        ? `
            <button type="button"
              class="cgpt-upload-file-rebind"
              data-no-row-upload="1"
              data-action="grant-upload-file-permission"
              data-cgpt-base-action="grant-upload-file-permission"
              data-upload-grant-id="${escapeHtml(q.id)}"
              title="请求读取权限">
              授权读取
            </button>
          `
        : '';
      const virtualUploadNameHtml = isUploadListDebugEnabled() && q.virtualUploadName
        ? `
                <div class="cgpt-upload-meta">实际上传名：${escapeHtml(q.virtualUploadName)}</div>
              `
        : '';

      return `
            <div class="cgpt-upload-item ${activeClass} ${visualClass} ${cachedClass}"
              data-id="${q.id}"
              data-group-id="${escapeHtml(activeGroupId)}"
              data-file-id="${escapeHtml(q.id)}"
              data-upload-file-row="1"
              data-upload-item-id="${escapeHtml(q.id)}"
              title="${itemTitle}">
              <div class="cgpt-upload-file-main">
                <div class="cgpt-upload-name">${escapeHtml(q.name || 'unknown')}</div>
                ${virtualUploadNameHtml}
                <div class="cgpt-upload-meta">
                  ${escapeHtml(formatBytes(q.size))}
                  <span class="cgpt-upload-dot">·</span>
                  <span class="cgpt-upload-source-label ${visualClass ? `status-${visualClass}` : ''} ${isUploadSourceCacheForbidden(q) ? 'cached-source' : ''}">
                    ${escapeHtml(sourceText)}
                  </span>
                  ${rebindButtonHtml}
                  ${grantPermissionButtonHtml}
                </div>
                ${errorHtml}
              </div>
              <div class="cgpt-upload-actions-cell">
                <button type="button"
                  class="cgpt-upload-file-remove"
                  data-no-row-upload="1"
                  data-action="remove-upload-file"
                  data-cgpt-base-action="remove-upload-file"
                  data-upload-remove-id="${escapeHtml(q.id)}"
                  title="移除"
                  aria-label="移除文件：${escapeHtml(q.name || 'unknown')}"
                  ${removeDisabled ? 'disabled' : ''}>
                  ×
                </button>
              </div>
            </div>
          `;
    }

    function buildUploadListHtml() {
      const files = getActiveGroupFiles();
      const selectedFileId = getSelectedFileIdForActiveGroup();
      const activeGroupId = getActiveGroupId();
      const flaskHtml = buildFlaskUploadListHtml();
      const restorePhase = getQueueRestorePhase();
      const activeGroupDbCount = getActiveGroupDbCount();

      if (!files.length && !flaskHtml) {
        if (state.moduleRenderFailed) {
          return `
          <div class="cgpt-upload-item empty toolbox-upload-empty-state toolbox-upload-degraded-panel">
            <div>
              <div class="cgpt-upload-meta toolbox-upload-drop-hint">多文件上传模块已降级</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">${escapeHtml(state.moduleInitError || '上传界面渲染失败，其他功能仍可使用')}</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">发送、复制、快捷键和无限继续不受影响。可点击上方「清理上传队列缓存并刷新」恢复上传面板。</div>
            </div>
          </div>
        `;
        }
        if (restorePhase === 'loading' || restorePhase === 'idle') {
          return `
          <div class="cgpt-upload-item empty toolbox-upload-empty-state">
            <div>
              <div class="cgpt-upload-meta toolbox-upload-drop-hint">正在恢复上次文件列表…</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">请稍候，上传队列正在从本地缓存恢复</div>
            </div>
          </div>
        `;
        }
        if (restorePhase === 'failed') {
          return `
          <div class="cgpt-upload-item empty toolbox-upload-empty-state">
            <div>
              <div class="cgpt-upload-meta toolbox-upload-drop-hint">上传队列恢复失败，请查看日志</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">${escapeHtml(state.lastRestoreWarning || state.moduleInitError || 'restore-failed')}</div>
            </div>
          </div>
        `;
        }
        if (activeGroupDbCount > 0) {
          const mismatchLine = `[UPLOAD_GROUP][COUNT_MISMATCH] dbCount=${activeGroupDbCount} memoryCount=${files.length} activeGroupId=${activeGroupId || '-'}`;
          console.warn(mismatchLine);
          if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
            ToolboxShell.appendLog(mismatchLine);
          }
          scheduleQueueRestoreForVisibleMismatch('buildUploadListHtml:db-count-memory-empty');
          return `
          <div class="cgpt-upload-item empty toolbox-upload-empty-state">
            <div>
              <div class="cgpt-upload-meta toolbox-upload-drop-hint">正在恢复上次文件列表…</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">本地缓存显示当前项目有 ${activeGroupDbCount} 个文件，正在同步界面</div>
            </div>
          </div>
        `;
        }
        appendUploadGroupLog('EMPTY_REASON', {
          activeGroupId: activeGroupId || '-',
          metaCount: state.queue.length,
          queue: files.length,
          restored: state.queue.filter((x) => x && x.restoreState).length,
          reason: restorePhase === 'ready' ? 'active-group-no-items' : `active-group-no-items-phase-${restorePhase}`,
        });
        if (restorePhase !== 'ready') {
          return `
          <div class="cgpt-upload-item empty toolbox-upload-empty-state">
            <div>
              <div class="cgpt-upload-meta toolbox-upload-drop-hint">正在恢复上次文件列表…</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">queueRestorePhase=${escapeHtml(restorePhase)}</div>
            </div>
          </div>
        `;
        }
        return `
          <div class="cgpt-upload-item empty toolbox-upload-empty-state">
            <div>
              <div class="cgpt-upload-meta toolbox-upload-drop-hint">当前全局项目没有文件</div>
              <div class="cgpt-upload-meta toolbox-upload-drop-over-hint">松开鼠标，添加到当前项目</div>
            </div>
          </div>
        `;
      }

      const queueHtml = buildLimitedUploadQueueListHtml(files, activeGroupId, selectedFileId);
      return `${flaskHtml}${queueHtml}`;
    }

    function getUploadListItemsToRender(files) {
      const allFiles = Array.isArray(files) ? files : [];
      if (state.uploadListExpandedAll || allFiles.length <= UPLOAD_LIST_RENDER_LIMIT) {
        return { items: allFiles, hiddenCount: 0 };
      }

      const activeUploadId = String(state.activeId || state.uploadTask?.activeId || '').trim();
      const runningStates = new Set([
        UploadState.READING,
        UploadState.ATTACHING,
      ]);
      const rendered = [];
      const renderedIds = new Set();

      allFiles.slice(0, UPLOAD_LIST_RENDER_LIMIT).forEach((item) => {
        if (!item || !item.id || renderedIds.has(item.id)) {
          return;
        }
        rendered.push(item);
        renderedIds.add(item.id);
      });

      allFiles.forEach((item) => {
        if (!item || !item.id || renderedIds.has(item.id)) {
          return;
        }
        const isActive = item.id === activeUploadId;
        const isRunning = runningStates.has(normalizeUploadStateValue(item.state, ''));
        if (isActive || isRunning) {
          rendered.push(item);
          renderedIds.add(item.id);
        }
      });

      return {
        items: rendered,
        hiddenCount: Math.max(0, allFiles.length - rendered.length),
      };
    }

    function buildLimitedUploadQueueListHtml(files, activeGroupId, selectedFileId) {
      const { items, hiddenCount } = getUploadListItemsToRender(files);
      const listHtml = items
        .map((q) => buildUploadQueueItemHtml(q, activeGroupId, selectedFileId))
        .join('');

      if (hiddenCount <= 0) {
        return listHtml;
      }

      const summaryHtml = `
        <div class="cgpt-upload-item empty toolbox-upload-list-summary" data-no-row-upload="1">
          <div>
            <div class="cgpt-upload-meta toolbox-upload-drop-hint">
              还有 ${hiddenCount} 个文件未展开显示，上传任务仍会继续执行。
            </div>
            <button type="button" class="cgpt-btn cgpt-btn-ghost cgpt-upload-expand-all-btn" data-upload-expand-all="1">
              展开全部
            </button>
          </div>
        </div>
      `;
      return `${listHtml}${summaryHtml}`;
    }

    function renderUploadListOnly(reason = '', options = {}) {
      const force = !!(options && options.force);
      const now = Date.now();
      if (
        !force
        && lastUploadListRenderExecutedAt > 0
        && now - lastUploadListRenderExecutedAt < UPLOAD_LIST_RENDER_MIN_INTERVAL_MS
      ) {
        scheduleRenderUploadListOnly(reason || 'throttled-retry', UPLOAD_LIST_RENDER_MIN_INTERVAL_MS);
        return;
      }

      const el = refs.listEl || (refs.rootElRef ? qs(UploadSelectors.list, refs.rootElRef) : null);
      if (!el) return;

      refs.listEl = el;
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      el.classList.add('toolbox-upload-file-list');
      refreshQueueReadableState();
      const html = buildUploadListHtml();
      el.innerHTML = html;
      if (isUploadDebugEnabled()) {
        diagnoseUploadListRender(el, html, reason || 'renderUploadListOnly');
      }
      lastUploadListRenderExecutedAt = Date.now();
      logSlowOperation(
        'renderUploadListOnly',
        startedAt,
        `itemCount=${getActiveGroupFiles().length} reason=${String(reason || '-').trim() || '-'}`,
      );
    }

    function updateUploadListItemDom(itemId, reason = '') {
      const idText = String(itemId || '').trim();
      if (!idText) {
        return false;
      }

      const reasonText = String(reason || '').trim() || 'update-item';
      const el = refs.listEl || (refs.rootElRef ? qs(UploadSelectors.list, refs.rootElRef) : null);
      if (!el) {
        return false;
      }

      const escapedId = escapeHtml(idText);
      const currentItemEl = el.querySelector(
        `.cgpt-upload-item[data-id="${escapedId}"], .cgpt-upload-item[data-file-id="${escapedId}"]`,
      );
      if (!(currentItemEl instanceof HTMLElement)) {
        return false;
      }

      const activeGroupId = getActiveGroupId();
      const selectedFileId = getSelectedFileIdForActiveGroup();
      const queueItem = getActiveGroupFiles().find((q) => String(q && q.id || '') === idText);

      if (!queueItem) {
        currentItemEl.remove();
        return true;
      }

      const nextItemHtml = buildUploadQueueItemHtml(queueItem, activeGroupId, selectedFileId).trim();
      if (!nextItemHtml) {
        return false;
      }
      const tpl = document.createElement('template');
      tpl.innerHTML = nextItemHtml;
      const nextItemEl = tpl.content.firstElementChild;
      if (!(nextItemEl instanceof HTMLElement)) {
        return false;
      }
      currentItemEl.setAttribute('data-id', String(queueItem.id || ''));
      currentItemEl.setAttribute('data-file-id', String(queueItem.id || ''));
      currentItemEl.setAttribute('data-group-id', String(activeGroupId || ''));
      currentItemEl.className = nextItemEl.className;
      currentItemEl.title = nextItemEl.title;

      const currentNameEl = currentItemEl.querySelector('.cgpt-upload-name');
      const nextNameEl = nextItemEl.querySelector('.cgpt-upload-name');
      if (currentNameEl && nextNameEl) {
        currentNameEl.textContent = nextNameEl.textContent;
      }

      const currentMetaEl = currentItemEl.querySelector('.cgpt-upload-meta');
      const nextMetaEl = nextItemEl.querySelector('.cgpt-upload-meta');
      if (currentMetaEl && nextMetaEl) {
        currentMetaEl.innerHTML = nextMetaEl.innerHTML;
      }

      const currentErrorEl = currentItemEl.querySelector('[data-upload-item-error]');
      const nextErrorEl = nextItemEl.querySelector('[data-upload-item-error]');
      if (nextErrorEl) {
        if (currentErrorEl) {
          currentErrorEl.replaceWith(nextErrorEl.cloneNode(true));
        } else {
          const currentMainEl = currentItemEl.querySelector('.cgpt-upload-file-main');
          if (currentMainEl) {
            currentMainEl.appendChild(nextErrorEl.cloneNode(true));
          }
        }
      } else if (currentErrorEl) {
        currentErrorEl.remove();
      }

      const currentActionsCell = currentItemEl.querySelector('.cgpt-upload-actions-cell');
      const nextActionsCell = nextItemEl.querySelector('.cgpt-upload-actions-cell');
      if (currentActionsCell && nextActionsCell) {
        currentActionsCell.innerHTML = nextActionsCell.innerHTML;
      }

      if (
        typeof ToolboxShell !== 'undefined'
        && typeof ToolboxShell.appendLogIfChanged === 'function'
      ) {
        ToolboxShell.appendLogIfChanged(
          'UPLOAD_LIST:item_update',
          `${idText}|${reasonText}`,
          `[UPLOAD_LIST][item-update] id=${idText} reason=${reasonText}`,
          1500,
        );
      }
      return true;
    }

    function scheduleRenderUploadListOnly(reason = '', delayMs) {
      const reasonText = String(reason || '').trim() || '-';
      uploadListRenderPendingReason = reasonText;
      const critical = isUploadCriticalNow();
      const waitMs = Number.isFinite(Number(delayMs))
        ? Math.max(0, Number(delayMs))
        : (critical ? 1000 : UPLOAD_LIST_RENDER_MIN_INTERVAL_MS);
      const boundedWaitMs = critical
        ? Math.min(1500, Math.max(UPLOAD_LIST_RENDER_MIN_INTERVAL_MS, waitMs))
        : Math.min(1500, Math.max(UPLOAD_LIST_RENDER_MIN_INTERVAL_MS, waitMs));

      if (uploadListRenderTimer) {
        return;
      }

      uploadListRenderTimer = window.setTimeout(() => {
        const pendingReason = uploadListRenderPendingReason || reasonText;
        uploadListRenderTimer = 0;
        uploadListRenderPendingReason = '';
        renderUploadListOnly(pendingReason);
      }, boundedWaitMs);
    }

    function renderUploadGroupChipHtml(group, activeGroupId) {
      const active = group.id === activeGroupId ? ' active' : '';
      const count = getUploadGroupFileCount(group.id);
      const cleanName = stripTrailingCountFromGroupName(group.name);
      const pageScopeHint = '此选择仅对当前页面生效；新页面默认使用最近一次选择。';
      const title = group.id === activeGroupId
        ? `当前页面选择：${cleanName}（${count} 个文件）。${pageScopeHint}`
        : `${cleanName}：${count} 个文件。${pageScopeHint}`;

      return `
          <button type="button"
            class="cgpt-chip-btn cgpt-upload-group-chip${active}"
            data-group-id="${escapeHtml(group.id)}"
            data-no-row-upload="1"
            data-no-upload-action="1"
            data-cgpt-group-chip="1"
            title="${escapeHtml(title)}">
            <span class="cgpt-chip-name">${escapeHtml(cleanName)}</span>
            <span class="cgpt-chip-count">${count}</span>
          </button>
        `;
    }

    function renderProjectCategoryChipHtml(group, activeGroupId) {
      return renderUploadGroupChipHtml(group, activeGroupId);
    }

    function renderUploadGroupFallbackChipHtml() {
      return `
          <button type="button"
            class="cgpt-chip-btn cgpt-upload-group-chip active"
            data-group-id=""
            data-no-row-upload="1"
            data-no-upload-action="1"
            data-cgpt-group-chip="1"
            disabled
            title="默认：0 个文件">
            <span class="cgpt-chip-name">默认</span>
            <span class="cgpt-chip-count">0</span>
          </button>
        `;
    }

    function renderProjectCategoryChips() {
      if (shouldSkipHeavyUploadRenderDuringAutoQueueWaitingReply('render-chips')) {
        appendUploadGroupLog('RENDER_SKIP', { phase: 'waiting-reply' });
        return;
      }
      if (!refs.groupListEl) {
        ToolboxShell.appendLog('[UPLOAD_GROUP_UI][render-skip] reason=refs.groupListEl-missing');
        return;
      }

      ensureActiveUploadGroupIdValid('render-chips');

      if (!state.groups.length) {
        if (!getUploadGroupsInitResolved()) {
          refs.groupListEl.innerHTML = `
            <button type="button"
              class="cgpt-chip-btn cgpt-upload-group-chip active"
              data-group-id=""
              disabled
              title="正在加载上传分组">
              <span class="cgpt-chip-name">加载中</span>
              <span class="cgpt-chip-count">…</span>
            </button>
          `;
          appendUploadGroupLog('RENDER', { phase: 'waiting-init' });
          Promise.resolve(getUploadModuleInitPromise())
            .then(() => {
              ensureActiveUploadGroupIdValid('render-chips-after-init');
              renderProjectCategoryChips();
            })
            .catch((err) => {
              console.error('[ChatGPT toolbox] renderProjectCategoryChips after init failed', err);
              renderProjectCategoryChips();
            });
          return;
        }

        appendUploadGroupLog('RENDER', { phase: 'empty-recovering' });
        refs.groupListEl.innerHTML = renderUploadGroupFallbackChipHtml();
        ensureDefaultGroupReady()
          .then(() => {
            appendUploadGroupLog('RENDER', { phase: 'after-ensure-default' });
            renderProjectCategoryChips();
          })
          .catch((err) => {
            console.error('[ChatGPT toolbox] ensureDefaultGroupReady failed during render', err);
            refs.groupListEl.innerHTML = renderUploadGroupFallbackChipHtml();
            appendUploadGroupLog('RENDER', { phase: 'fallback-after-error' });
          });
        return;
      }

      refs.groupListEl.innerHTML = state.groups
        .map((group) => renderProjectCategoryChipHtml(group, state.activeGroupId))
        .join('');

      syncUploadGroupAppState();
      appendUploadGroupLog('RENDER', { phase: 'ok' });
    }

    function renderManageGroupList() {
      if (!refs.manageGroupListEl) return;

      if (!state.groups.length) {
        refs.manageGroupListEl.innerHTML = renderEmptyState(
          '暂无分组',
          'cgpt-upload-manage-empty cgpt-empty-state',
        );
        return;
      }

      refs.manageGroupListEl.innerHTML = state.groups.map((g) => {
        const active = g.id === state.activeGroupId ? ' active' : '';
        const count = getUploadGroupFileCount(g.id);
        const cleanName = stripTrailingCountFromGroupName(g.name);

        return `
          <button type="button"
            class="cgpt-upload-manage-group-item${active}"
            data-group-id="${escapeHtml(g.id)}"
            title="${escapeHtml(`${cleanName} · ${count} 个文件`)}">
            <span class="cgpt-upload-manage-group-name">${escapeHtml(cleanName)}</span>
            <span class="cgpt-upload-manage-group-count">${count} 个</span>
          </button>
        `;
      }).join('');
    }

    function syncGroupManagePanel(options = {}) {
      const group = getActiveGroup();

      renderManageGroupList();

      const force = options.force === true;
      const inputFocused = document.activeElement === groupNameInputEl;

      if (groupNameInputEl && (force || !inputFocused)) {
        const nextName = group ? group.name : '';
        groupNameInputEl.value = nextName;
        lastGroupNameInputValue = nextName;
      }

      // Blob persistence disabled - sync removed

      const clearBtn = qs('#cgpt-upload-group-clear-inline', getHost() || document);
      if (clearBtn) {
        clearBtn.textContent = '清空当前组';
      }

      const deleteBtn = qs('#cgpt-upload-group-delete-inline', getHost() || document);
      if (deleteBtn) {
        deleteBtn.textContent = '删除当前组';
      }

      clearConfirmUntil = 0;
      deleteConfirmUntil = 0;
    }

    function refreshUploadGroupDomRefs(rootEl) {
      const root = rootEl || refs.rootElRef || getHost() || document;

      refs.groupListEl = qs('#cgpt-upload-group-list', root);
      refs.managePanelEl = qs('#cgpt-upload-manage-panel', root);
      refs.manageGroupListEl = qs('#cgpt-upload-manage-group-list', root);
      groupNameInputEl = qs('#cgpt-upload-group-name-input', root);

      return root;
    }

    function toggleGroupManagePanel(source = 'unknown') {
      const root = refs.rootElRef || getHost() || document;

      if (refs.rootElRef) {
        ensureUploadGroupSection(refs.rootElRef);
      }

      refreshUploadGroupDomRefs(root);

      if (!refs.managePanelEl) {
        const errText = 'missing #cgpt-upload-manage-panel';
        console.error('[ChatGPT toolbox] toggleGroupManagePanel failed:', errText);
        ToolboxShell.appendLog(
          `[UPLOAD_GROUP][MANAGE_TOGGLE_FAILED] source=${String(source || '-')} reason=${errText}`,
        );
        return false;
      }

      const wasHidden = refs.managePanelEl.classList.contains('cgpt-toolbox-hidden');
      refs.managePanelEl.classList.toggle('cgpt-toolbox-hidden', !wasHidden);

      ToolboxShell.appendLog(
        `[UPLOAD_GROUP_MANAGE][TOGGLE] visible=${wasHidden ? 'true' : 'false'}`,
      );

      ToolboxShell.appendLog(
        `[UPLOAD_GROUP][MANAGE_TOGGLE] source=${String(source || '-')} visible=${wasHidden ? '1' : '0'}`,
      );

      if (wasHidden) {
        syncGroupManagePanel({ force: true });
      }

      return true;
    }

      return {
      buildFlaskUploadListHtml,
      buildUploadQueueItemHtml,
      buildUploadListHtml,
      getUploadListItemsToRender,
      buildLimitedUploadQueueListHtml,
      renderUploadListOnly,
      updateUploadListItemDom,
      scheduleRenderUploadListOnly,
      renderUploadGroupChipHtml,
      renderProjectCategoryChipHtml,
      renderUploadGroupFallbackChipHtml,
      renderProjectCategoryChips,
      renderManageGroupList,
      syncGroupManagePanel,
      refreshUploadGroupDomRefs,
      toggleGroupManagePanel,
      };
    }

    return { create };
  })();


