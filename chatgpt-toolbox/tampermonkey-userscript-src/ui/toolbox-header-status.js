  /********************************************************************

   * ToolboxHeaderStatus：右上角关键状态 chip（统一仲裁 + 独立渲染区）

   ********************************************************************/



  function getToolboxRuntimeStateSafe() {

    if (

      typeof window !== 'undefined'

      && window.__CGPT_TOOLBOX_STATE__

      && typeof window.__CGPT_TOOLBOX_STATE__ === 'object'

    ) {

      return window.__CGPT_TOOLBOX_STATE__;

    }

    if (

      typeof UploadModule !== 'undefined'

      && UploadModule

      && typeof UploadModule.getUploadStatus === 'function'

    ) {

      try {

        const uploadStatus = UploadModule.getUploadStatus();

        if (uploadStatus && typeof uploadStatus === 'object') {

          return uploadStatus;

        }

      } catch (error) {

        const message = error && error.message ? error.message : String(error);

        const stack = error && error.stack ? error.stack : '';

        console.warn('[HEADER_STATUS][getUploadStatus_failed]', message, stack);

      }

    }

    if (

      typeof APP !== 'undefined'

      && APP

      && APP.state

      && typeof APP.state === 'object'

    ) {

      return APP.state;

    }

    return {};

  }



  const ToolboxHeaderStatus = (() => {

    let lastRenderSignature = '';



    function appendHeaderStatusLog(line) {

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {

        ToolboxShell.appendLog(line);

        return;

      }

      console.log(line);

    }



    function getToolboxRootElement() {

      const rootId = typeof APP !== 'undefined' && APP && APP.rootId

        ? APP.rootId

        : 'cgpt-toolbox-root';

      return document.getElementById(rootId);

    }



    function escapeHeaderStatusHtml(value) {

      if (typeof escapeHtml === 'function') {

        return escapeHtml(value);

      }

      return String(value == null ? '' : value)

        .replace(/&/g, '&amp;')

        .replace(/</g, '&lt;')

        .replace(/>/g, '&gt;')

        .replace(/"/g, '&quot;');

    }



    function readSendTaskPhase(runtimeState) {

      const s = runtimeState && typeof runtimeState === 'object'

        ? runtimeState

        : getToolboxRuntimeStateSafe();

      const sendTask = s.sendTask && typeof s.sendTask === 'object'

        ? s.sendTask

        : {};

      const fromButtonTasks = s.buttonTasks && s.buttonTasks.send

        ? s.buttonTasks.send

        : {};

      return String(

        s.sendTaskPhase

        || s.send_task_phase

        || sendTask.phase

        || fromButtonTasks.phase

        || '',

      ).trim().toLowerCase();

    }



    function readUploadTaskPhase(runtimeState) {

      const s = runtimeState && typeof runtimeState === 'object'

        ? runtimeState

        : getToolboxRuntimeStateSafe();

      const uploadTask = s.uploadTask && typeof s.uploadTask === 'object'

        ? s.uploadTask

        : {};

      const fromButtonTasks = s.buttonTasks && s.buttonTasks.upload

        ? s.buttonTasks.upload

        : {};

      return String(

        s.uploadTaskPhase

        || s.upload_task_phase

        || uploadTask.phase

        || fromButtonTasks.phase

        || '',

      ).trim().toLowerCase();

    }



    // 兼容旧代码/诊断用。正常 Header 渲染禁止调用 readCapability。
    // Header 状态必须由 readHeaderAuthority() 派生。
    function readCapability() {

      if (typeof getPageCapability !== 'function') {

        return null;

      }

      try {

        return getPageCapability('toolbox-header-status');

      } catch (error) {

        console.error('[HEADER_STATUS] getPageCapability failed', error);

        return null;

      }

    }



    function resolveWaitingReplyFlag(runtimeState) {

      const s = runtimeState && typeof runtimeState === 'object'

        ? runtimeState

        : getToolboxRuntimeStateSafe();



      if (

        s.waitingReply

        || s.autoQueueWaitingReply

        || s.waiting_reply

        || s.auto_queue_waiting_reply

      ) {

        return true;

      }

      if (typeof ChatInputStateRuntime !== 'undefined' && ChatInputStateRuntime && ChatInputStateRuntime.waitingForReply) {

        return true;

      }

      if (typeof resolveWaitingForReply === 'function') {

        try {

          if (resolveWaitingForReply()) {

            return true;

          }

        } catch (error) {

          const message = error && error.message ? error.message : String(error);

          const stack = error && error.stack ? error.stack : '';

          console.warn('[HEADER_STATUS][resolveWaitingForReply_failed]', message, stack);

        }

      }

      if (

        typeof UploadModule !== 'undefined'

        && UploadModule

        && typeof UploadModule.isWaitingReplyOnly === 'function'

      ) {

        try {

          if (UploadModule.isWaitingReplyOnly()) {

            return true;

          }

        } catch (error) {

          const message = error && error.message ? error.message : String(error);

          const stack = error && error.stack ? error.stack : '';

          console.warn('[HEADER_STATUS][UploadModule.isWaitingReplyOnly_failed]', message, stack);

        }

      }

      const autoState = typeof AutoQueueModule !== 'undefined'

        && AutoQueueModule

        && typeof AutoQueueModule.getRunState === 'function'

        ? AutoQueueModule.getRunState()

        : null;

      if (autoState && (autoState.waitingReply || autoState.running && autoState.step === 'waiting_reply')) {

        return true;

      }

      return readSendTaskPhase(s) === 'waiting_reply';

    }



    // 兼容旧代码/诊断用。正常 Header 渲染禁止调用 resolveRespondingFlag。
    // 回答中状态必须读取 authority.flags.replyBusy / authority.reply.state。
    function resolveRespondingFlag(capability, responseState, runtimeState) {

      const s = runtimeState && typeof runtimeState === 'object'

        ? runtimeState

        : getToolboxRuntimeStateSafe();

      const domState = typeof detectChatInputStateFromDom === 'function'

        ? detectChatInputStateFromDom()

        : null;

      const domGenerating = !!(domState && domState.cls === 'cgpt-state-generating');

      return !!(

        s.isResponding

        || s.is_responding

      ) || domGenerating || !!(

        capability

        && (

          capability.is_responding

          || capability.response_state === 'responding'

          || capability.response_state === 'generating'

        )

      ) || responseState === 'responding'

        || responseState === 'generating';

    }



    function readHeaderAuthority(reason = '-') {
      if (
        typeof UploadModule !== 'undefined'
        && UploadModule
        && typeof UploadModule.getToolboxAuthorityState === 'function'
      ) {
        try {
          return UploadModule.getToolboxAuthorityState(`header-status:${reason || '-'}`, {
            force: true,
            cacheTtlMs: 0,
          });
        } catch (error) {
          console.error('[HEADER_STATUS][AUTHORITY_READ_FAILED]', error);
          return null;
        }
      }
      const cached = (
        typeof window !== 'undefined'
        && window.__cgptToolboxAuthorityCache
        && typeof window.__cgptToolboxAuthorityCache === 'object'
        && window.__cgptToolboxAuthorityCache.flags
      )
        ? window.__cgptToolboxAuthorityCache
        : null;
      if (cached) {
        console.warn('[HEADER_STATUS][AUTHORITY_CACHE_ONLY_FALLBACK]', {
          reason: reason || '-',
        });
        return cached;
      }
      return null;
    }

    function buildToolboxHeaderStatusSnapshot(reason, runtimeState) {
      void runtimeState;

      const authority = readHeaderAuthority(reason);
      if (!authority) {
        appendHeaderStatusLog(
          `[HEADER_STATUS][AUTHORITY_MISSING] reason=${reason || '-'}`,
        );

        return {
          reason: String(reason || ''),
          authorityUsed: false,
          authorityReplyText: '',
          authorityTaskText: '',
          authorityAttachmentText: '',
          responseState: 'unknown',
          responseReason: 'authority-missing',
          waitingReply: false,
          waitingSend: false,
          sendTaskPhase: 'unknown',
          uploadTaskPhase: 'unknown',
          pageDisplayId: '-',
          turnCount: 0,
          chips: [],
        };
      }

      const reply = authority.reply && typeof authority.reply === 'object' ? authority.reply : {};
      const task = authority.task && typeof authority.task === 'object' ? authority.task : {};
      const flags = authority.flags && typeof authority.flags === 'object' ? authority.flags : {};
      const composer = authority.composer && typeof authority.composer === 'object' ? authority.composer : {};
      const attachment = authority.attachment && typeof authority.attachment === 'object' ? authority.attachment : {};
      const page = authority.page && typeof authority.page === 'object' ? authority.page : {};

      const responseState = String(
        reply.state
        || (authority.raw && authority.raw.responseState)
        || 'unknown',
      ).trim().toLowerCase();

      const responseReason = String(
        reply.reason
        || (authority.raw && authority.raw.responseReason)
        || '',
      ).trim().toLowerCase();

      const sendTaskPhase = String(task.sendPhase || task.phase || 'idle').trim().toLowerCase();
      const uploadTaskPhase = String(task.uploadPhase || 'idle').trim().toLowerCase();

      const waitingReply = !!(
        flags.replyBusy === true
        || reply.state === 'answering'
        || task.state === 'waiting_reply'
        || composer.hasRealStopButton === true
      );

      const waitingSend = !!(
        flags.pendingSend === true
        || reply.state === 'waiting_send'
        || sendTaskPhase === 'waiting_send'
      );

      const chips = [];

      if (waitingReply) {
        chips.push({
          key: 'reply',
          text: String(reply.text || '回答中'),
          level: 'danger',
          priority: 100,
        });
      }

      if (waitingSend) {
        chips.push({
          key: 'waiting-send',
          text: '可发送',
          level: 'warning',
          priority: 90,
        });
      }

      if (attachment.state === 'uploading' || composer.composerUploading === true) {
        chips.push({
          key: 'attachment',
          text: String(attachment.text || '附件处理中'),
          level: 'warning',
          priority: 80,
        });
      }

      if (task.state && task.state !== 'idle' && task.text) {
        chips.push({
          key: 'task',
          text: String(task.text),
          level: task.busy ? 'warning' : 'muted',
          priority: 70,
        });
      }

      appendHeaderStatusLog(
        `[HEADER_STATUS][AUTHORITY_MIRROR] reason=${reason || '-'} `
        + `reply=${reply.text || '-'} replyState=${reply.state || '-'} `
        + `task=${task.text || '-'} taskState=${task.state || '-'} `
        + `canSend=${flags.canSend ? 1 : 0} pendingSend=${flags.pendingSend ? 1 : 0}`,
      );

      return {
        reason: String(reason || ''),
        authorityUsed: true,
        authorityReplyText: String(reply.text || ''),
        authorityTaskText: String(task.text || ''),
        authorityAttachmentText: String(attachment.text || ''),
        responseState,
        responseReason,
        waitingReply,
        waitingSend,
        sendTaskPhase,
        uploadTaskPhase,
        pageDisplayId: String(page.pageDisplayId || '-'),
        turnCount: Number(page.turnCount || 0) || 0,
        chips,
      };
    }


    function truncateChipsForWidth(snapshot, root) {

      const panel = root ? root.querySelector(`#${APP.panelId}`) : null;

      const width = panel

        ? Math.round(panel.getBoundingClientRect().width || panel.offsetWidth || 0)

        : Math.round(root.getBoundingClientRect().width || root.offsetWidth || 0);



      const beforeKeys = snapshot.chips.map((c) => c.key).join('|') || '-';

      let visibleChips = snapshot.chips.slice();



      if (width > 0 && width < 420) {

        const critical = visibleChips.filter((chip) => (

          chip.key === 'reply'

          || chip.key === 'responding'

          || chip.key === 'reply-done'

        ));

        visibleChips = (critical.length ? critical : visibleChips).slice(0, 1);

      } else if (width > 0 && width < 520) {

        visibleChips = visibleChips.slice(0, 2);

      } else if (width > 0 && width < 680) {

        visibleChips = visibleChips.slice(0, 3);

      }



      const afterKeys = visibleChips.map((c) => c.key).join('|') || '-';

      if (beforeKeys !== afterKeys) {

        appendHeaderStatusLog(

          `[HEADER_STATUS][TRUNCATE] width=${width} before=${beforeKeys} after=${afterKeys} reason=${snapshot.reason || '-'}`,

        );

      }



      return { visibleChips, width };

    }



    function ensureToolboxHeaderStatusChips(header) {

      const headerEl = header || (() => {

        const root = getToolboxRootElement();

        return root ? root.querySelector('.cgpt-toolbox-header') : null;

      })();



      if (!headerEl) {

        return null;

      }



      let statusWrap = headerEl.querySelector('.cgpt-header-status-chips');

      if (statusWrap) {

        return statusWrap;

      }



      if (

        typeof ToolboxShell !== 'undefined'

        && typeof ToolboxShell.ensureToolboxTitleRow === 'function'

      ) {

        ToolboxShell.ensureToolboxTitleRow();

      }



      const titleRow = headerEl.querySelector('.cgpt-toolbox-title-row');

      statusWrap = document.createElement('div');

      statusWrap.className = 'cgpt-header-status-chips';

      statusWrap.setAttribute('aria-live', 'polite');



      const actions = headerEl.querySelector('.cgpt-toolbox-header-actions');

      if (titleRow) {

        if (actions && actions.parentElement === titleRow) {

          titleRow.insertBefore(statusWrap, actions);

        } else {

          titleRow.appendChild(statusWrap);

        }

      } else {

        headerEl.insertBefore(statusWrap, headerEl.firstChild);

      }



      return statusWrap;

    }



    function repairHeaderStatusZeroHeight(statusWrap, reason, snapshot) {
      if (!statusWrap) {
        return null;
      }
      const oldRect = statusWrap.getBoundingClientRect();
      statusWrap.style.removeProperty('display');
      statusWrap.style.removeProperty('height');
      statusWrap.style.removeProperty('max-height');
      statusWrap.style.removeProperty('overflow');
      statusWrap.style.minHeight = '28px';
      statusWrap.style.height = 'auto';
      statusWrap.style.overflow = 'visible';
      statusWrap.querySelectorAll('.cgpt-header-status-chip, .cgpt-toolbox-top-status-badge, .cgpt-status-pill').forEach((chip) => {
        chip.style.removeProperty('display');
        chip.style.removeProperty('height');
        chip.style.removeProperty('max-height');
        chip.style.removeProperty('overflow');
        chip.style.display = 'inline-flex';
        chip.style.alignItems = 'center';
        chip.style.minHeight = '22px';
        chip.style.lineHeight = '20px';
        chip.style.overflow = 'visible';
      });
      const newRect = statusWrap.getBoundingClientRect();
      appendHeaderStatusLog(
        `[HEADER_STATUS][REPAIR_ZERO_HEIGHT] oldRect=${Math.round(oldRect.width)}x${Math.round(oldRect.height)} newRect=${Math.round(newRect.width)}x${Math.round(newRect.height)} responseState=${snapshot.responseState || '-'} waitingReply=${snapshot.waitingReply ? 1 : 0} chipCount=${snapshot.chips.length} reason=${reason || '-'}`,
      );
      return newRect;
    }

    function resolveHeaderStatusAuditTarget(header) {
      if (!header) {
        return null;
      }
      const pageStatusRow = header.querySelector('.cgpt-toolbox-header-status-row, .cgpt-toolbox-page-status-row, .cgpt-toolbox-top-status-row');
      if (pageStatusRow) {
        return pageStatusRow;
      }
      return header.querySelector('.cgpt-header-status-chips');
    }

    function auditHeaderStatusVisibility(reason, snapshot, statusWrap) {

      const shouldHaveCritical = !!(

        snapshot.waitingReply

        || snapshot.responseState === 'responding'

        || snapshot.responseState === 'generating'

        || snapshot.responseState === 'attachment_processing'

        || snapshot.sendTaskPhase === 'waiting_composer'

        || snapshot.sendTaskPhase === 'waiting_reply'

        || snapshot.sendTaskPhase === 'waiting_send'

        || snapshot.sendTaskPhase === 'sending'

        || snapshot.waitingSend

      );



      if (!shouldHaveCritical) {

        return;

      }



      const header = statusWrap
        ? statusWrap.closest('.cgpt-toolbox-header')
        : getToolboxRootElement()?.querySelector('.cgpt-toolbox-header');
      const auditTarget = resolveHeaderStatusAuditTarget(header) || statusWrap;
      const visibleText = auditTarget ? String(auditTarget.textContent || '').trim() : '';
      const rect = auditTarget ? auditTarget.getBoundingClientRect() : null;



      if (!visibleText || !rect || rect.width <= 0 || rect.height <= 0) {

        appendHeaderStatusLog(

          `[HEADER_STATUS][MISSING_CRITICAL] reason=${reason || '-'} visibleText=${visibleText || '-'} rect=${rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : '-'} responseState=${snapshot.responseState || '-'} waitingReply=${snapshot.waitingReply ? 1 : 0} sendPhase=${snapshot.sendTaskPhase || '-'} chipCount=${snapshot.chips.length}`,

        );

        if (auditTarget && rect && rect.height <= 0) {
          repairHeaderStatusZeroHeight(auditTarget, reason, snapshot);
        }

      }

    }



    function renderToolboxHeaderStatus(reason, runtimeState) {

      const root = getToolboxRootElement();

      if (!root) {

        appendHeaderStatusLog(`[HEADER_STATUS][SKIP] reason=${reason || '-'} cause=no-root`);

        return;

      }



      const header = root.querySelector('.cgpt-toolbox-header');

      if (!header) {

        appendHeaderStatusLog(`[HEADER_STATUS][SKIP] reason=${reason || '-'} cause=no-header`);

        return;

      }



      const statusWrap = ensureToolboxHeaderStatusChips(header);

      if (!statusWrap) {

        appendHeaderStatusLog(`[HEADER_STATUS][SKIP] reason=${reason || '-'} cause=no-status-wrap`);

        return;

      }



      let snapshot;

      try {

        snapshot = buildToolboxHeaderStatusSnapshot(reason, runtimeState);

      } catch (error) {

        const message = error && error.message ? error.message : String(error);

        const stack = error && error.stack ? error.stack : '';

        console.warn('[HEADER_STATUS][SNAPSHOT_FAILED]', message, stack);

        appendHeaderStatusLog(`[HEADER_STATUS][SNAPSHOT_FAILED] reason=${reason || '-'} error=${message}`);

        if (stack) {

          appendHeaderStatusLog(`[HEADER_STATUS][SNAPSHOT_FAILED_STACK] ${stack}`);

        }

        statusWrap.innerHTML = '';

        statusWrap.style.display = 'none';

        return;

      }



      const { visibleChips, width } = truncateChipsForWidth(snapshot, root);



      const signature = [
        'fixed-slots',
        width,
        snapshot.waitingReply ? 1 : 0,
        snapshot.responseState,
        snapshot.sendTaskPhase,
      ].join(';');



      if (signature === lastRenderSignature && reason.indexOf('force') === -1) {

        auditHeaderStatusVisibility(`after-render-skip-dup:${reason || '-'}`, snapshot, statusWrap);

        return;

      }

      lastRenderSignature = signature;



      // 顶部状态已迁移到固定槽位行（cgpt-top-status-row），不再动态插入/删除 chip。
      statusWrap.innerHTML = '';

      statusWrap.style.display = 'none';

      root.dataset.headerStatusCount = '0';



      appendHeaderStatusLog(

        `[HEADER_STATUS][RENDER] reason=${reason || '-'} mode=fixed-slots responseState=${snapshot.responseState || '-'} waitingReply=${snapshot.waitingReply ? 1 : 0} sendPhase=${snapshot.sendTaskPhase || '-'} uploadPhase=${snapshot.uploadTaskPhase || '-'} width=${width}`,

      );



      auditHeaderStatusVisibility(`after-render:${reason || '-'}`, snapshot, statusWrap);

    }



    return {

      getToolboxRootElement,

      getToolboxRuntimeStateSafe,

      buildToolboxHeaderStatusSnapshot,

      renderToolboxHeaderStatus,

      auditHeaderStatusVisibility,

      ensureToolboxHeaderStatusChips,

    };

  })();



  function buildToolboxHeaderStatusSnapshot(reason, runtimeState) {

    return ToolboxHeaderStatus.buildToolboxHeaderStatusSnapshot(reason, runtimeState);

  }



  function renderToolboxHeaderStatus(reason, runtimeState) {

    try {

      ToolboxHeaderStatus.renderToolboxHeaderStatus(reason, runtimeState);

    } catch (error) {

      const message = error && error.message ? error.message : String(error);

      const stack = error && error.stack ? error.stack : '';

      console.warn('[HEADER_STATUS][RENDER_FAILED]', message, stack);

      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {

        ToolboxShell.appendLog(`[HEADER_STATUS][RENDER_FAILED] reason=${reason || '-'} error=${message}`);

        if (stack) {

          ToolboxShell.appendLog(`[HEADER_STATUS][RENDER_FAILED_STACK] ${stack}`);

        }

      }

    }

  }



  function auditHeaderStatusVisibility(reason) {

    const root = ToolboxHeaderStatus.getToolboxRootElement();

    const wrap = root ? root.querySelector('.cgpt-header-status-chips') : null;

    let snapshot;

    try {

      snapshot = buildToolboxHeaderStatusSnapshot(reason, getToolboxRuntimeStateSafe());

    } catch (error) {

      const message = error && error.message ? error.message : String(error);

      const stack = error && error.stack ? error.stack : '';

      console.error('[HEADER_STATUS][audit-snapshot-failed]', message, stack);

      return;

    }

    ToolboxHeaderStatus.auditHeaderStatusVisibility(reason, snapshot, wrap);

  }

