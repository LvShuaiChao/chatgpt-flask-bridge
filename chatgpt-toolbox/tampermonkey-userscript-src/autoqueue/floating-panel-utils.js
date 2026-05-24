  /********************************************************************
   * Autoqueue floating panel: persisted position + drag helpers
   ********************************************************************/

  function createPersistedPanelPositionController(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const key = opts.key;
    const defaultWidth = Number(opts.defaultWidth) > 0 ? Number(opts.defaultWidth) : 520;
    const defaultHeight = Number(opts.defaultHeight) > 0 ? Number(opts.defaultHeight) : 420;
    const logPrefix = String(opts.logPrefix || 'FLOATING_PANEL').trim();
    const memory = opts.memory;
    const appendLog = typeof opts.appendLog === 'function' ? opts.appendLog : null;

    function readPosition() {
      const pos = memory && typeof memory.get === 'function'
        ? memory.get(key, null)
        : null;

      if (!pos || typeof pos !== 'object') {
        return null;
      }

      const left = Number(pos.left);
      const top = Number(pos.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
      }

      return { left, top };
    }

    function savePosition(left, top, reason = '') {
      const next = {
        left: Math.round(Number(left) || 0),
        top: Math.round(Number(top) || 0),
        updatedAt: Date.now(),
      };

      if (memory && typeof memory.set === 'function') {
        memory.set(key, next);
      }

      if (appendLog) {
        appendLog(
          `[${logPrefix}][position-save] reason=${reason || '-'} left=${next.left} top=${next.top}`,
        );
      }
    }

    function clampPosition(left, top, modal) {
      const margin = 8;
      const rect = modal && typeof modal.getBoundingClientRect === 'function'
        ? modal.getBoundingClientRect()
        : null;

      const width = rect && rect.width > 0 ? rect.width : defaultWidth;
      const height = rect && rect.height > 0 ? rect.height : defaultHeight;

      const maxLeft = Math.max(margin, window.innerWidth - width - margin);
      const maxTop = Math.max(margin, window.innerHeight - height - margin);

      return {
        left: Math.max(margin, Math.min(Number(left) || margin, maxLeft)),
        top: Math.max(margin, Math.min(Number(top) || margin, maxTop)),
      };
    }

    function applyPosition(modal, left, top, reason = '') {
      if (!modal) {
        return;
      }

      const pos = clampPosition(left, top, modal);

      modal.style.position = 'fixed';
      modal.style.left = `${Math.round(pos.left)}px`;
      modal.style.top = `${Math.round(pos.top)}px`;
      modal.style.right = 'auto';
      modal.style.bottom = 'auto';
      modal.style.margin = '0';
      modal.style.transform = 'none';

      if (appendLog) {
        appendLog(
          `[${logPrefix}][position-apply] reason=${reason || '-'} left=${Math.round(pos.left)} top=${Math.round(pos.top)}`,
        );
      }
    }

    function restorePosition(modal, reason = '') {
      if (!modal) {
        return;
      }

      const saved = readPosition();
      if (saved) {
        applyPosition(modal, saved.left, saved.top, reason || 'restore-saved');
        return;
      }

      const rect = modal.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width : defaultWidth;
      const height = rect && rect.height > 0 ? rect.height : defaultHeight;

      const left = Math.max(8, Math.round((window.innerWidth - width) / 2));
      const top = Math.max(8, Math.round((window.innerHeight - height) / 2));

      applyPosition(modal, left, top, reason || 'restore-center');
    }

    return {
      readPosition,
      savePosition,
      clampPosition,
      applyPosition,
      restorePosition,
    };
  }

  function bindDraggablePanel(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const overlay = opts.overlay;
    const modalSelector = String(opts.modalSelector || '.cgpt-modal').trim();
    const headerSelector = String(opts.headerSelector || '.cgpt-modal-header').trim();
    const dragBoundDataset = String(opts.dragBoundDataset || 'floatingPanelDragBound').trim();
    const position = opts.position;
    const logPrefix = String(opts.logPrefix || 'FLOATING_PANEL').trim();
    const consoleLabel = String(opts.consoleLabel || 'floating panel').trim();
    const appendLog = typeof opts.appendLog === 'function' ? opts.appendLog : null;

    if (!overlay) {
      return;
    }

    const modal = overlay.querySelector(modalSelector);
    const header = overlay.querySelector(headerSelector);

    if (!modal || !header) {
      console.error(`[ChatGPT toolbox] ${consoleLabel} drag bind failed: missing modal/header`);

      if (appendLog) {
        appendLog(`[${logPrefix}][drag-bind-failed] missing modal/header`);
      }

      return;
    }

    if (header.dataset[dragBoundDataset] === '1') {
      return;
    }

    header.dataset[dragBoundDataset] = '1';

    let dragState = null;

    header.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) {
        return;
      }

      const target = event.target instanceof HTMLElement ? event.target : null;

      if (
        target
        && target.closest('button,input,textarea,select,a,[contenteditable="true"]')
      ) {
        return;
      }

      const rect = modal.getBoundingClientRect();

      dragState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startLeft: rect.left,
        startTop: rect.top,
        moved: false,
      };

      try {
        header.setPointerCapture(event.pointerId);
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.warn(`[ChatGPT toolbox] ${consoleLabel} setPointerCapture failed`, error);

        if (appendLog) {
          appendLog(`[${logPrefix}][drag-capture-failed] error=${errText}`);
        }
      }

      modal.classList.add('cgpt-modal-dragging');

      event.preventDefault();
      event.stopPropagation();
    });

    header.addEventListener('pointermove', (event) => {
      if (!dragState) {
        return;
      }

      if (event.pointerId !== dragState.pointerId) {
        return;
      }

      const dx = event.clientX - dragState.startClientX;
      const dy = event.clientY - dragState.startClientY;

      if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) {
        dragState.moved = true;
      }

      if (!dragState.moved) {
        return;
      }

      const nextLeft = dragState.startLeft + dx;
      const nextTop = dragState.startTop + dy;

      if (position && typeof position.applyPosition === 'function') {
        position.applyPosition(modal, nextLeft, nextTop, 'dragging');
      }

      event.preventDefault();
      event.stopPropagation();
    });

    function finishDrag(event, reason) {
      if (!dragState) {
        return;
      }

      const state = dragState;
      dragState = null;

      try {
        header.releasePointerCapture(state.pointerId);
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        console.warn(`[ChatGPT toolbox] ${consoleLabel} releasePointerCapture failed`, error);

        if (appendLog) {
          appendLog(
            `[${logPrefix}][drag-release-failed] reason=${reason || '-'} error=${errText}`,
          );
        }
      }

      modal.classList.remove('cgpt-modal-dragging');

      if (state.moved && position) {
        const rect = modal.getBoundingClientRect();
        const pos = typeof position.clampPosition === 'function'
          ? position.clampPosition(rect.left, rect.top, modal)
          : { left: rect.left, top: rect.top };

        if (typeof position.applyPosition === 'function') {
          position.applyPosition(modal, pos.left, pos.top, reason || 'drag-end');
        }

        if (typeof position.savePosition === 'function') {
          position.savePosition(pos.left, pos.top, reason || 'drag-end');
        }

        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }

    header.addEventListener('pointerup', (event) => {
      finishDrag(event, 'pointerup');
    });

    header.addEventListener('pointercancel', (event) => {
      finishDrag(event, 'pointercancel');
    });
  }
