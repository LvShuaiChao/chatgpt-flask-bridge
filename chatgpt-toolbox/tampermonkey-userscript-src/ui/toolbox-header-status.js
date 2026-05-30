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



    function buildToolboxHeaderStatusSnapshot(reason, runtimeState) {

      const s = runtimeState && typeof runtimeState === 'object'

        ? runtimeState

        : getToolboxRuntimeStateSafe();

      const capability = readCapability();

      const responseState = String(

        (capability && capability.response_state)

        || s.responseState

        || s.response_state

        || '',

      ).trim().toLowerCase();

      const responseReason = String(

        (capability && capability.response_state_reason)

        || s.responseStateReason

        || s.response_state_reason

        || '',

      ).trim().toLowerCase();



      const waitingReply = resolveWaitingReplyFlag(s);

      const waitingSend = !!(

        s.waitingSend

        || s.autoSendWaiting

        || s.waiting_send

        || s.auto_send_waiting

      );

      const sendTaskPhase = readSendTaskPhase(s);

      const uploadTaskPhase = readUploadTaskPhase(s);



      const isResponding = resolveRespondingFlag(capability, responseState, s);

      const isAttachmentProcessing = responseState === 'attachment_processing'

        || responseReason.includes('attachment');

      const isWaitingComposer = sendTaskPhase === 'waiting_composer'

        || sendTaskPhase === 'waiting'

        || sendTaskPhase === 'waiting_send'

        || sendTaskPhase === 'waiting_page_reply_to_send'

        || sendTaskPhase === 'waiting_ready'

        || waitingSend;



      const chips = [];



      const responseDoneNotifyActive = typeof ResponseDoneNotifyModule !== 'undefined'

        && typeof ResponseDoneNotifyModule.isNotifyActive === 'function'

        && ResponseDoneNotifyModule.isNotifyActive();



      if (responseDoneNotifyActive && !waitingReply && !isResponding) {

        chips.push({

          key: 'reply-done',

          text: '回复完成',

          level: 'danger',

          priority: 102,

        });

      }



      if (waitingReply && isResponding) {

        chips.push({

          key: 'responding',

          text: '回答中',

          level: 'danger',

          priority: 100,

        });

      } else if (waitingReply) {

        chips.push({

          key: 'reply',

          text: '等回复',

          level: 'danger',

          priority: 100,

        });

      } else if (isResponding) {

        chips.push({

          key: 'responding',

          text: '回答中',

          level: 'danger',

          priority: 95,

        });

      }



      if (isWaitingComposer && sendTaskPhase !== 'waiting_reply' && !isResponding) {

        chips.push({

          key: 'send',

          text: '待发送',

          level: 'warn',

          priority: 90,

        });

      } else if (sendTaskPhase === 'sending') {

        chips.push({

          key: 'send',

          text: '发送中',

          level: 'warn',

          priority: 88,

        });

      }



      if (isAttachmentProcessing) {

        chips.push({

          key: 'attachment',

          text: '附件中',

          level: 'warn',

          priority: 80,

        });

      }



      if (uploadTaskPhase === 'running' || uploadTaskPhase === 'uploading') {

        chips.push({

          key: 'upload',

          text: '上传中',

          level: 'warn',

          priority: 70,

        });

      }



      const pageDisplayId = (

        typeof getBridgePageDisplayIdText === 'function'

          ? getBridgePageDisplayIdText()

          : (s.pageDisplayId || s.page_display_id || '-')

      );

      const turnCount = typeof getConversationTurnCount === 'function'

        ? Number(getConversationTurnCount()) || 0

        : Number(s.turnCount || s.turn_count || 0);



      const deduped = chips

        .sort((a, b) => b.priority - a.priority)

        .filter((chip, index, arr) => arr.findIndex((x) => x.key === chip.key) === index);



      return {

        reason: String(reason || ''),

        responseState,

        responseReason,

        waitingReply,

        waitingSend,

        sendTaskPhase,

        uploadTaskPhase,

        pageDisplayId,

        turnCount,

        chips: deduped,

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



      const visibleText = statusWrap ? String(statusWrap.textContent || '').trim() : '';

      const rect = statusWrap ? statusWrap.getBoundingClientRect() : null;



      if (!visibleText || !rect || rect.width <= 0 || rect.height <= 0) {

        appendHeaderStatusLog(

          `[HEADER_STATUS][MISSING_CRITICAL] reason=${reason || '-'} visibleText=${visibleText || '-'} rect=${rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : '-'} responseState=${snapshot.responseState || '-'} waitingReply=${snapshot.waitingReply ? 1 : 0} sendPhase=${snapshot.sendTaskPhase || '-'} chipCount=${snapshot.chips.length}`,

        );

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

        width,

        visibleChips.map((c) => `${c.key}:${c.text}`).join('|'),

        snapshot.waitingReply ? 1 : 0,

        snapshot.responseState,

        snapshot.sendTaskPhase,

      ].join(';');



      if (signature === lastRenderSignature && reason.indexOf('force') === -1) {

        auditHeaderStatusVisibility(`after-render-skip-dup:${reason || '-'}`, snapshot, statusWrap);

        return;

      }

      lastRenderSignature = signature;



      statusWrap.innerHTML = visibleChips.map((chip) => {

        const cls = [

          'cgpt-header-status-chip',

          `cgpt-header-status-chip-${chip.level}`,

          `cgpt-header-status-chip-${chip.key}`,

        ].join(' ');

        return `<span class="${cls}" data-status-key="${escapeHeaderStatusHtml(chip.key)}">${escapeHeaderStatusHtml(chip.text)}</span>`;

      }).join('');



      statusWrap.style.display = visibleChips.length ? '' : 'none';

      root.dataset.headerStatusCount = String(visibleChips.length);



      appendHeaderStatusLog(

        `[HEADER_STATUS][RENDER] reason=${reason || '-'} chips=${visibleChips.map((c) => `${c.key}:${c.text}`).join('|') || '-'} responseState=${snapshot.responseState || '-'} responseReason=${snapshot.responseReason || '-'} waitingReply=${snapshot.waitingReply ? 1 : 0} waitingSend=${snapshot.waitingSend ? 1 : 0} sendPhase=${snapshot.sendTaskPhase || '-'} uploadPhase=${snapshot.uploadTaskPhase || '-'} width=${width}`,

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

