  const ToolboxShell = (() => {
    const TOOLBOX_DEFAULT_TITLE = '小张工具箱';
    const TOOLBOX_RESTORE_HANDLE_TITLE = '小张工具箱';
    const ENABLE_STABLE_TOOLBOX_GEOMETRY = false;

    let toolboxTitle = TOOLBOX_DEFAULT_TITLE;

    const VIEWPORT_SAFE_MARGIN = 8;
    const TOOLBOX_MIN_VISIBLE_WIDTH = 64;
    const TOOLBOX_MIN_VISIBLE_HEIGHT = 34;

    const TOOLBOX_MIN_WIDTH_FULL = 260;
    const TOOLBOX_MIN_WIDTH_COMPACT = 220;

    const TOOLBOX_SIZE_LIMITS = Object.freeze({
      DEFAULT_WIDTH: 474,
      DEFAULT_HEIGHT: 620,
      MIN_WIDTH: 360,
      MIN_HEIGHT: 360,
      MAX_WIDTH: 1120,
      MAX_WIDTH_RATIO: 0.9,
      MAX_HEIGHT_RATIO: 0.92,
      VIEWPORT_MARGIN: 16,
      NARROW_WIDTH: 620,
      EXTRA_NARROW_WIDTH: 460,
    });

    const PANEL_DEFAULT_SIZE = Object.freeze({
      width: 640,
      height: 500,
      minWidth: TOOLBOX_MIN_WIDTH_FULL,
      minHeight: 240,
      maxWidth: TOOLBOX_SIZE_LIMITS.MAX_WIDTH,
      maxHeight: 760,
    });

    const DEFAULT_COMPACT_WIDTH = 484;
    const MIN_COMPACT_WIDTH = TOOLBOX_MIN_WIDTH_COMPACT;
    const MAX_COMPACT_WIDTH = 680;

    const PANEL_COMPACT_DEFAULT_SIZE = Object.freeze({
      width: DEFAULT_COMPACT_WIDTH,
      height: 280,
      minWidth: MIN_COMPACT_WIDTH,
      minHeight: 180,
      maxWidth: MAX_COMPACT_WIDTH,
    });

    const PANEL_VIEWPORT_MARGIN = 8;

    const SHELL_EVENTS_VERSION = 'stable-geometry-v2-panel-handle';

    let lastUserScrollAt = 0;
    const USER_SCROLL_SILENCE_MS = 700;
    let userScrollListenersAttached = false;

    function attachUserScrollListeners() {
      if (userScrollListenersAttached || typeof window === 'undefined') {
        return;
      }
      userScrollListenersAttached = true;
      const markScroll = () => {
        lastUserScrollAt = Date.now();
      };
      window.addEventListener('scroll', markScroll, { passive: true, capture: true });
      window.addEventListener('wheel', markScroll, { passive: true, capture: true });
    }

    function isUserScrollingNow() {
      attachUserScrollListeners();
      return lastUserScrollAt > 0 && (Date.now() - lastUserScrollAt) < USER_SCROLL_SILENCE_MS;
    }

    const HIDDEN_TOGGLE_SIZE = Object.freeze({
      width: 38,
      height: 34,
    });

    const TOOLBOX_PANEL_HIDDEN_STORAGE_KEY = 'xz_toolbox_panel_hidden_v1';
    const TOOLBOX_PANEL_RECT_KEY = 'xz_toolbox_panel_rect_v1';
    const TOOLBOX_RESTORE_BUTTON_ID = 'xz-toolbox-restore-button';

    function readToolboxPanelHiddenState() {
      try {
        return localStorage.getItem(TOOLBOX_PANEL_HIDDEN_STORAGE_KEY) === '1';
      } catch (error) {
        console.error('[TOOLBOX_UI][HIDDEN_STATE_READ_ERROR]', error);
        appendLog(
          `[TOOLBOX_UI][HIDDEN_STATE_READ_ERROR] ${error && error.message ? error.message : String(error)}`,
        );
        return false;
      }
    }

    function writeToolboxPanelHiddenState(hidden) {
      try {
        localStorage.setItem(TOOLBOX_PANEL_HIDDEN_STORAGE_KEY, hidden ? '1' : '0');
      } catch (error) {
        console.error('[TOOLBOX_UI][HIDDEN_STATE_WRITE_ERROR]', error);
        appendLog(
          `[TOOLBOX_UI][HIDDEN_STATE_WRITE_ERROR] hidden=${hidden ? 1 : 0} error=${error && error.message ? error.message : String(error)}`,
        );
      }
    }

    function ensureToolboxRestoreButton() {
      let button = document.getElementById(TOOLBOX_RESTORE_BUTTON_ID);
      if (!button) {
        if (!document.body) {
          console.error('[TOOLBOX_UI][RESTORE_BUTTON_BODY_MISSING]');
          appendLog('[TOOLBOX_UI][RESTORE_BUTTON_BODY_MISSING]');
          return null;
        }

        button = document.createElement('button');
        button.id = TOOLBOX_RESTORE_BUTTON_ID;
        button.type = 'button';
        button.textContent = TOOLBOX_RESTORE_HANDLE_TITLE;
        button.title = '点击恢复小张工具箱';
        button.className = 'cgpt-toolbox-restore-button';
        button.addEventListener('click', () => {
          setToolboxPanelHidden(false, 'restore-button-click');
        });
        document.body.appendChild(button);
      }
      return button;
    }

    function setToolboxPanelHidden(hidden, reason = '') {
      const panelEl = document.getElementById(APP.panelId);
      const restoreButton = ensureToolboxRestoreButton();
      if (!panelEl) {
        console.error('[TOOLBOX_UI][SET_HIDDEN_PANEL_NOT_FOUND]', {
          panelId: APP.panelId,
          hidden,
          reason,
        });
        return false;
      }

      const reasonText = String(reason || '-');

      if (hidden) {
        saveToolboxPanelRect(`hide:${reasonText}`);
        panelEl.dataset.toolboxHidden = '1';
        panelEl.classList.add('cgpt-toolbox-panel-hidden');
        panelEl.style.display = 'none';
        if (restoreButton) {
          restoreButton.style.display = 'inline-flex';
        }
        hideRestoreHandle('header-panel-ui-hidden');
        writeToolboxPanelHiddenState(true);
        appendLog(`[TOOLBOX_VISIBILITY][HIDE] reason=${reasonText}`);
        appendLog(
          `[TOOLBOX_UI][PANEL_HIDDEN_CHANGE] hidden=1 reason=${reasonText}`,
        );
        return true;
      }

      panelEl.dataset.toolboxHidden = '0';
      panelEl.classList.remove('cgpt-toolbox-panel-hidden');
      panelEl.style.display = '';
      panelEl.style.pointerEvents = 'auto';
      panelEl.style.visibility = 'visible';
      panelEl.style.opacity = '1';
      if (restoreButton) {
        restoreButton.style.display = 'none';
      }
      writeToolboxPanelHiddenState(false);
      appendLog(`[TOOLBOX_VISIBILITY][SHOW] reason=${reasonText}`);
      appendLog(
        `[TOOLBOX_UI][PANEL_HIDDEN_CHANGE] hidden=0 reason=${reasonText}`,
      );

      window.requestAnimationFrame(() => {
        if (!restoreToolboxPanelRect(`show:${reasonText}`)) {
          applySavedPanelPosition(`show:${reasonText}`);
        }
        keepPanelInViewport({
          save: true,
          reason: `show:${reasonText}`,
        });
        syncToolboxFloatingLayout(`show:${reasonText}`);
        updateFloatingTitlePosition(`show:${reasonText}`);
      });

      return true;
    }

    function initToolboxPanelHiddenFromStorage() {
      if (!panel) {
        panel = document.getElementById(APP.panelId);
      }
      ensureToolboxRestoreButton();
      ensureHideButton();
      const shouldHidePanel = readToolboxPanelHiddenState();
      setToolboxPanelHidden(shouldHidePanel, 'init-from-storage');
    }

    let forceShowingUntil = 0;
    let isDraggingToolbox = false;
    let isResizingToolbox = false;
    let panelResizePendingRect = null;
    let panelResizePendingReason = '';
    let panelResizeRafId = 0;
    let panelResizeMoveLogLastAt = 0;

    const USER_PANEL_RESIZE_PROTECT_MS = 30 * 60 * 1000;
    const USER_SIZE_LOCK_STORAGE_KEY = 'panelUserSizeLock';
    const COMPRESSED_REPAIR_MAX_DEFER_ATTEMPTS = 3;
    const AUTO_SIZE_SAVE_BLOCKED_REASON_FRAGMENTS = Object.freeze([
      'after-render-batch-status',
      'foreground-catch-up',
      'applyToolboxUiState',
      'restore-position',
      'create-late',
      'poll',
      'render',
      'applyPanelPosition',
      'layout-mode',
      'panel-resize-observer',
      'sync-ui-state',
    ]);
    let lastUserPanelResizeAt = 0;
    let lastUserPanelResizeSize = null;
    let compressedRepairDeferCount = 0;
    let compressedRepairDeferTimer = 0;

    let restoreHotzone = null;
    let restoreHotzoneHoverTimer = 0;
    let restoreHandle = null;
    let lastPanelVisibleRect = null;

    const RESTORE_HOTZONE_WIDTH = 260;
    const RESTORE_HOTZONE_MIN_HEIGHT = 180;
    const RESTORE_HOTZONE_EXTRA = 48;
    const RESTORE_HOTZONE_HOVER_DELAY = 120;

    const DRAG_CLICK_THRESHOLD = 5;
    const TOGGLE_CLICK_SUPPRESS_MS = 100;

    let toggleDragState = null;
    let suppressToggleClick = false;
    let floatingTitleDragState = null;

    const VALID_TABS = Object.freeze(['upload', 'autoq', 'prompt', 'bridge', 'export', 'log', 'settings']);

    let root = null;
    let panel = null;
    let titleEl = null;
    let currentActiveTab = 'upload';
    let latestStatusText = '';
    let lastStatusApplyKey = '';
    let lastStatusApplyAt = 0;
    let lastStatusLogKey = '';
    let lastStatusLogAt = 0;
    let compactMode = false;
    let layoutCompactAuto = false;
    let layoutModeBound = false;
    let panelResizeObserver = null;
    let toolboxResponsiveObserver = null;
    let toolboxResponsiveWindowBound = false;
    let clampViewportTimer = 0;
    let panelPositionSaveDebounceTimer = 0;
    let panelPositionSavePendingReason = '';
    let panelPositionSaveLastSignature = '';
    let viewportGuardBound = false;
    let creatingToolbox = false;
    let appendingLog = false;
    let toolboxWatchdogTimer = 0;
    let globalErrorGuardBound = false;
    let hiddenTitlePosition = null;
    let hiddenTitlePositionLocked = false;

    let headerTitleFlashTimer = 0;
    let headerTitleFlashStopTimer = 0;
    let headerTitleFlashBaseText = '';
    let headerTitleFlashOn = false;

    function addGlobalDraggingClass() {
      if (document.documentElement) {
        document.documentElement.classList.add('cgpt-toolbox-global-dragging');
      } else {
        console.warn('[ChatGPT toolbox] addGlobalDraggingClass: documentElement 不存在');
        appendLog('[TOOLBOX_DRAG][warn] documentElement 不存在');
      }

      if (document.body) {
        document.body.classList.add('cgpt-toolbox-global-dragging');
      } else {
        console.warn('[ChatGPT toolbox] addGlobalDraggingClass: document.body 不存在');
        appendLog('[TOOLBOX_DRAG][warn] document.body 不存在');
      }
    }

    function removeGlobalDraggingClass() {
      if (document.documentElement) {
        document.documentElement.classList.remove('cgpt-toolbox-global-dragging');
      }

      if (document.body) {
        document.body.classList.remove('cgpt-toolbox-global-dragging');
      }
    }

    function clearDragVisualState(reason = '') {
      if (root) {
        const hadDragging = root.classList.contains('cgpt-toolbox-dragging');
        root.classList.remove('cgpt-toolbox-dragging');
        root.style.transform = '';

        if (hadDragging) {
          appendLog(
            `[TOOLBOX_DRAG][clear-visual] reason=${reason || '-'} removed=cgpt-toolbox-dragging`,
          );
        }
      }

      removeGlobalDraggingClass();
    }

    let removedEdgeAutoHideCleanupDone = false;

    function cleanupRemovedEdgeAutoHideState(reason = 'unknown') {
      const reasonText = String(reason || 'unknown');
      const edgeClassList = [
        'cgpt-toolbox-edge-hidden',
        'cgpt-toolbox-edge-revealed',
        'cgpt-edge-hidden',
        'cgpt-edge-right',
        'cgpt-toolbox-floating-hidden',
      ];
      if (root) {
        root.classList.remove(...edgeClassList);
        root.removeAttribute('data-edge-side');
        root.removeAttribute('data-snap-edge');
        if (root.dataset) {
          delete root.dataset.edgeSide;
          delete root.dataset.snapEdge;
        }
        root.style.transform = '';
        root.style.opacity = '';
        root.style.pointerEvents = '';
      }
      const oldHotzone = document.getElementById('cgpt-toolbox-edge-hotzone');
      if (oldHotzone && oldHotzone.parentNode) {
        oldHotzone.parentNode.removeChild(oldHotzone);
      }
      if (typeof MemoryManager !== 'undefined' && typeof MemoryManager.remove === 'function') {
        MemoryManager.remove('edgeAutoHideEnabled');
        MemoryManager.remove('edgeHidden');
        MemoryManager.remove('edgeSide');
      }
      if (!removedEdgeAutoHideCleanupDone) {
        removedEdgeAutoHideCleanupDone = true;
        if (typeof appendLog === 'function') {
          appendLog(`[TOOLBOX_EDGE][REMOVED_CLEANUP] reason=${reasonText}`);
        } else {
          console.info('[ChatGPT toolbox] removed edge auto hide cleanup:', reasonText);
        }
      }
    }

    function exitEdgeHiddenStateForDragStart() {
      cleanupRemovedEdgeAutoHideState('drag-start');
    }

    function applyDragPosition(left, top, reason = '') {
      if (!root || !panel) return;

      if (isPanelVisibleNow()) {
        applyPanelPosition(left, top);
      } else {
        const safeLeft = Math.round(left);
        const safeTop = Math.round(top);

        root.style.left = `${safeLeft}px`;
        root.style.top = `${safeTop}px`;
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.transform = '';
      }

      appendLog(
        `[TOOLBOX_DRAG][dragging-position] left=${Math.round(left)} top=${Math.round(top)} reason=${reason || '-'} panelVisible=${isPanelVisibleNow() ? 1 : 0}`,
      );

      if (isToolboxInAnyHiddenState()) {
        updateFloatingTitlePosition(reason || 'dragging');
      }
    }

    function schedulePostDragLayout(work) {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          work();
        });
        return;
      }

      window.setTimeout(work, 0);
    }

    /* ===== toolbox UI: styles ===== */
    const TOOLBOX_STYLE = `

        :root {
          --cgpt-color-primary-bg: #1d4ed8;
          --cgpt-color-primary-border: #3b82f6;
          --cgpt-color-success-bg: #166534;
          --cgpt-color-success-border: #22c55e;
          --cgpt-color-danger-bg: #dc2626;
          --cgpt-color-danger-border: #ef4444;
          --cgpt-color-warning-bg: #ea580c;
          --cgpt-color-warning-border: #f97316;
          --cgpt-color-border: #475569;
          --cgpt-color-panel-bg: #0f172a;
        }

        .cgpt-empty-state {
          padding: 10px 8px;
          color: #94a3b8;
          font-size: 12px;
          text-align: center;
        }

        #${APP.rootId} {
          position: fixed;
          left: 0;
          top: 0;
          right: auto;
          bottom: auto;
          width: 0;
          height: 0;
          z-index: 2147483647;
          font: 12px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #f2f2f2;
          pointer-events: none;
        }

        #${APP.rootId} #${APP.panelId},
        #${APP.rootId} #${APP.toggleId},
        #${APP.rootId} #cgpt-toolbox-floating-title {
          pointer-events: auto;
        }

        #${APP.rootId} * {
          box-sizing: border-box;
        }

        #${APP.rootId}.cgpt-toolbox-dragging {
          transition: none !important;
          will-change: left, top;
        }

        #${APP.rootId}.cgpt-toolbox-dragging #${APP.panelId} {
          box-shadow: none !important;
          transition: none !important;
          filter: none !important;
          background: #0f1115 !important;
        }

        #${APP.rootId}.cgpt-toolbox-dragging,
        #${APP.rootId}.cgpt-toolbox-dragging #${APP.panelId} {
          cursor: grabbing !important;
        }

        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-section,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-list,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-quick-prompts {
          box-shadow: none !important;
        }

        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-item:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-quick-prompt-chip:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-upload-quick-prompt-group:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-toolbox-tab:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-btn:hover,
        #${APP.rootId}.cgpt-toolbox-dragging .cgpt-toolbox-small-btn:hover {
          background: inherit !important;
          border-color: inherit !important;
        }

        html.cgpt-toolbox-global-dragging,
        body.cgpt-toolbox-global-dragging {
          cursor: grabbing !important;
        }

        #${APP.toggleId} {
          display: none;
          align-items: center;
          justify-content: center;
          width: 38px;
          min-width: 38px;
          height: 34px;
          border: 1px solid #334155;
          background: #111827;
          color: #f8fafc;
          border-radius: 999px;
          padding: 0;
          cursor: grab;
          box-shadow: 0 6px 18px rgba(0,0,0,0.35);
          user-select: none;
          touch-action: none;
        }

        #${APP.rootId}.cgpt-toolbox-panel-hidden #${APP.toggleId} {
          display: none !important;
        }

        #${APP.toggleId}:active {
          cursor: grabbing;
        }

        #${APP.toggleId}:hover {
          background: #1f2937;
        }

        .cgpt-toolbox-toggle-icon {
          position: relative;
          display: block;
          width: 16px;
          height: 12px;
          border-top: 2px solid #f8fafc;
          border-bottom: 2px solid #f8fafc;
        }

        .cgpt-toolbox-toggle-icon::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 4px;
          border-top: 2px solid #f8fafc;
        }

        #${APP.rootId}.cgpt-toolbox-panel-hidden #${APP.panelId} {
          display: none !important;
          pointer-events: none !important;
        }

        #${APP.restoreHotzoneId} {
          position: fixed;
          z-index: 2147483646;
          display: none;
          pointer-events: none;
          background: transparent;
        }

        #${APP.restoreHotzoneId}.active {
          display: block;
          pointer-events: auto;
        }

        #${APP.restoreHandleId} {
          position: fixed;
          z-index: 2147483647;
          display: none;
          right: 10px;
          top: 80px;
          height: 34px;
          max-width: 132px;
          padding: 0 12px;
          border: 1px solid #334155;
          border-radius: 999px;
          background: #111827;
          color: #f8fafc;
          font-size: 12px;
          font-weight: 700;
          box-shadow: 0 8px 22px rgba(0,0,0,0.42);
          cursor: pointer;
          white-space: nowrap;
          pointer-events: auto;
        }

        #${APP.restoreHandleId}.active {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
        }

        #${APP.restoreHandleId}:hover {
          background: #1d4ed8;
          border-color: #3b82f6;
        }

        #${APP.panelId} .cgpt-toolbox-header-hide-btn {
          height: 24px;
          padding: 0 10px;
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.45);
          background: rgba(15, 23, 42, 0.95);
          color: #e5e7eb;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          line-height: 22px;
          white-space: nowrap;
        }

        #${APP.panelId} .cgpt-toolbox-header-hide-btn:hover {
          background: rgba(30, 41, 59, 0.98);
          border-color: rgba(96, 165, 250, 0.75);
          color: #ffffff;
        }

        #${APP.panelId}.cgpt-toolbox-panel-hidden {
          display: none !important;
        }

        .cgpt-toolbox-restore-button {
          position: fixed;
          right: 18px;
          top: 210px;
          z-index: 2147483647;
          display: none;
          align-items: center;
          justify-content: center;
          min-width: 92px;
          height: 34px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid rgba(96, 165, 250, 0.85);
          background: rgba(15, 23, 42, 0.96);
          color: #ffffff;
          font-size: 13px;
          font-weight: 800;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
          cursor: pointer;
          user-select: none;
        }

        .cgpt-toolbox-restore-button:hover {
          background: rgba(37, 99, 235, 0.98);
          border-color: rgba(147, 197, 253, 0.95);
        }

        #${APP.panelId},
        #${APP.rootId}.cgpt-toolbox-root #${APP.panelId},
        .cgpt-toolbox-panel {
          --cgpt-toolbox-width: 640px;
        }

        #${APP.panelId} {
          display: flex;
          flex-direction: column;
          position: fixed;
          left: 80px;
          top: 80px;
          right: auto;
          bottom: auto;
          width: var(--cgpt-toolbox-width, 640px);
          height: 500px;
          min-width: ${TOOLBOX_MIN_WIDTH_FULL}px;
          min-height: 260px;
          max-width: none;
          max-height: none;
          box-sizing: border-box;
          overflow: hidden;
          background: #0f1115;
          color: #f2f2f2;
          border: 1px solid #2f3542;
          border-radius: 14px;
          resize: none;
          transition: none;
          box-shadow: 0 14px 36px rgba(0,0,0,0.42);
          pointer-events: auto;
          z-index: 2147483647;
          isolation: isolate;
        }

        #${APP.panelId}.xz-toolbox-root {
          position: fixed !important;
          box-sizing: border-box !important;
          right: auto !important;
          bottom: auto !important;
          inset: auto !important;
          transform: none !important;
          max-width: none !important;
          max-height: none !important;
          overflow: hidden !important;
          resize: none !important;
          transition: none !important;
          contain: layout paint style;
        }

        #${APP.panelId}.xz-toolbox-root.xz-toolbox-moving,
        #${APP.panelId}.xz-toolbox-root.xz-toolbox-resizing {
          user-select: none !important;
          transition: none !important;
        }

        #${APP.panelId}.xz-toolbox-root .cgpt-resize-handle,
        #${APP.panelId}.xz-toolbox-root .cgpt-toolbox-resize-left-handle {
          display: none !important;
          pointer-events: none !important;
        }

        #${APP.panelId}.xz-toolbox-root .cgpt-toolbox-resize-handle,
        #${APP.panelId} .xz-toolbox-resize-handle {
          position: absolute;
          right: 0;
          bottom: 0;
          width: 18px;
          height: 18px;
          cursor: nwse-resize;
          z-index: 20;
        }

        .cgpt-resize-handle {
          position: absolute;
          z-index: 2147483646;
          background: transparent;
          touch-action: none;
          user-select: none;
        }

        .cgpt-toolbox-resize-handle {
          position: absolute;
          right: 0;
          bottom: 0;
          width: 18px;
          height: 18px;
          cursor: nwse-resize;
          z-index: 2147483647;
          user-select: none;
          touch-action: none;
          background: transparent;
        }

        .cgpt-toolbox-resize-handle::after {
          content: "";
          position: absolute;
          right: 4px;
          bottom: 4px;
          width: 9px;
          height: 9px;
          border-right: 2px solid rgba(148, 163, 184, 0.9);
          border-bottom: 2px solid rgba(148, 163, 184, 0.9);
          pointer-events: none;
        }

        .cgpt-toolbox-resize-left-handle {
          position: absolute;
          left: 0;
          top: 0;
          width: 10px;
          height: 100%;
          cursor: ew-resize;
          z-index: 2147483647;
          user-select: none;
          touch-action: none;
          background: transparent;
          pointer-events: auto;
        }

        .cgpt-toolbox-resize-left-handle:hover {
          background: rgba(96, 165, 250, 0.12);
        }

        .cgpt-resize-n {
          left: 12px;
          right: 12px;
          top: 0;
          height: 6px;
          cursor: ns-resize;
        }

        .cgpt-resize-s {
          left: 12px;
          right: 12px;
          bottom: 0;
          height: 6px;
          cursor: ns-resize;
        }

        .cgpt-resize-e {
          top: 12px;
          bottom: 12px;
          right: 0;
          width: 6px;
          cursor: ew-resize;
        }

        .cgpt-resize-w {
          top: 12px;
          bottom: 12px;
          left: 0;
          width: 8px;
          cursor: ew-resize;
        }

        .cgpt-resize-ne {
          right: 0;
          top: 0;
          width: 14px;
          height: 14px;
          cursor: nesw-resize;
        }

        .cgpt-resize-nw {
          left: 0;
          top: 0;
          width: 14px;
          height: 14px;
          cursor: nwse-resize;
        }

        .cgpt-resize-se {
          right: 0;
          bottom: 0;
          width: 16px;
          height: 16px;
          cursor: nwse-resize;
        }

        .cgpt-resize-sw {
          left: 0;
          bottom: 0;
          width: 14px;
          height: 14px;
          cursor: nesw-resize;
        }

        .cgpt-resize-se::after {
          content: "";
          position: absolute;
          right: 4px;
          bottom: 4px;
          width: 10px;
          height: 10px;
          opacity: 0.75;
          pointer-events: none;
          background:
            linear-gradient(135deg, transparent 0 45%, #64748b 45% 55%, transparent 55%),
            linear-gradient(135deg, transparent 0 65%, #64748b 65% 75%, transparent 75%);
        }

        #${APP.panelId}.cgpt-resizing {
          user-select: none;
        }

        #${APP.panelId}.cgpt-resizing * {
          user-select: none;
        }

        #${APP.panelId}.cgpt-toolbox-compact {
          width: min(340px, calc(100vw - 32px));
          min-width: min(${TOOLBOX_MIN_WIDTH_COMPACT}px, calc(100vw - 32px));
          min-height: min(180px, calc(100vh - 32px));
          max-width: calc(100vw - 32px);
          max-height: calc(100vh - 32px);
        }

        #${APP.panelId}.cgpt-toolbox-layout-compact {
          max-width: calc(100vw - 20px) !important;
          max-height: calc(100vh - 20px) !important;
        }

        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-autoq-status-panel,
        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-autoq-main-lite,
        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-status-card {
          max-height: none;
          overflow: visible;
        }

        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-autoq-editor-block #cgpt-autoq-prompts,
        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-command-textarea {
          height: clamp(100px, 22vh, 200px) !important;
          max-height: 220px !important;
        }

        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-autoq-task-list,
        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-task-list {
          max-height: min(220px, 28vh) !important;
        }

        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-btn,
        #${APP.panelId}.cgpt-toolbox-layout-compact .cgpt-toolbox-small-btn {
          min-height: 30px;
          padding-left: 8px;
          padding-right: 8px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-tabs {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-page {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-page[data-page="upload"] {
          display: block !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header {
          flex: 0 0 68px !important;
          height: 68px !important;
          min-height: 68px !important;
          max-height: 68px !important;
          padding: 4px 8px !important;
          gap: 2px !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-status-row {
          justify-content: flex-start !important;
          align-self: stretch !important;
          width: 100% !important;
          flex-wrap: wrap !important;
          row-gap: 2px !important;
          min-height: 38px !important;
          height: 38px !important;
          max-height: 38px !important;
          overflow: hidden !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-status-row .cgpt-toolbox-top-status-badge {
          min-height: 20px;
          line-height: 20px;
          font-size: 11px;
          padding: 1px 5px;
          border-radius: 10px;
          max-width: none;
          flex: 0 0 auto;
        }

        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-toolbox-upload-quota-badge,
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-toolbox-message-quota-badge,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-upload-quota-badge,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-message-quota-badge {
          display: inline-flex !important;
        }

        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-page-id-badge {
          max-width: 92px;
        }

        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-status-primary-badge,
        #${APP.panelId} #cgpt-page-input-state.cgpt-toolbox-status-primary-badge {
          max-width: 88px;
          display: inline-flex !important;
          visibility: visible !important;
          opacity: 1 !important;
        }

        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-page-turn-badge,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-turn-count-badge {
          max-width: 120px;
        }

        #${APP.panelId} .cgpt-toolbox-must-show-badge,
        #${APP.panelId} .cgpt-toolbox-page-turn-badge {
          display: inline-flex !important;
          flex: 0 0 auto !important;
          visibility: visible !important;
          opacity: 1 !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-title {
          font-size: 12px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-actions {
          gap: 5px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-small-btn {
          height: 24px;
          padding: 0 7px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-content {
          padding: 8px;
          overflow-y: auto;
          overflow-x: hidden !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-content,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-section,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] {
          overflow-x: hidden !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-section-title,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-hint {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-groups-head {
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-bar {
          display: grid !important;
          grid-template-columns: 1fr auto;
          gap: 5px;
          align-items: center;
          margin-top: 4px;
          margin-bottom: 6px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-list {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 5px;
          overflow-x: hidden !important;
          overflow-y: visible !important;
          padding-bottom: 0 !important;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-chip {
          flex: 0 0 auto;
          height: 26px;
          max-width: 92px;
          padding: 0 8px;
          font-size: 12px;
          border-radius: 999px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] #cgpt-upload-group-manage {
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          height: 26px;
          min-width: 52px;
          padding: 0 10px;
          font-size: 12px;
          border-radius: 999px;
          white-space: nowrap;
        }

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module .cgpt-upload-groups-head {
          display: block !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module .cgpt-upload-group-list {
          display: flex !important;
          flex-wrap: wrap !important;
        }

        #cgpt-upload-module.compact-hide-upload-groups .cgpt-upload-groups-head {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-file-list .cgpt-upload-list {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-quick-prompts .cgpt-upload-quick-prompts {
          display: none !important;
        }

        #cgpt-upload-module.compact-hide-quick-prompts .cgpt-upload-quick-prompts {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-section {
          padding: 8px;
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-list {
          max-height: 160px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-item {
          grid-template-columns: 1fr auto;
          gap: 6px;
          padding: 5px 6px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-actions-cell {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-name {
          font-size: 12px;
          line-height: 1.25;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-meta {
          font-size: 11px;
          line-height: 1.2;
          margin-top: 1px;
        }

        #cgpt-upload-module .cgpt-toolbox-top-status-row,
        #cgpt-upload-module .cgpt-toolbox-page-status-row {
          display: none !important;
        }

        #cgpt-upload-module .cgpt-upload-item.flask-local-direct {
          border-left: 3px solid #0ea5e9;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-manage-panel {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-file-remove {
          display: inline-flex !important;
          width: 20px;
          height: 20px;
          min-width: 20px;
          padding: 0;
          font-size: 13px;
          line-height: 18px;
          border-radius: 999px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-settings-section,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-log,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-clear-log,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-delete,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-save-name,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-list-new,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-list-name-row,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] #cgpt-autoq-send-once,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-mode-tabs,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-list-panel,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-task-panel,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-editor-block,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-status-section {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-section {
          padding: 8px;
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="autoq"] .cgpt-autoq-label {
          display: none;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-section-title,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-hint,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] #cgpt-prompt-manage-tools,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-preview,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] #cgpt-prompt-status {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-section {
          padding: 8px;
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-list {
          max-height: 220px;
          overflow-x: hidden;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-category-bar {
          gap: 5px;
          padding: 2px 0 6px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="prompt"] .cgpt-prompt-category-chip {
          height: 24px;
          max-width: 86px;
          padding: 0 7px;
          font-size: 11px;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-section-title,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-hint,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-export-advanced,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-panel,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-prompts {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-section {
          padding: 8px;
          margin-bottom: 0;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="log"] .cgpt-log-advanced {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="log"] .cgpt-log-list {
          max-height: 220px;
        }

        .cgpt-toolbox-hidden {
          display: none !important;
        }

        .cgpt-toolbox-header {
          flex: 0 0 78px;
          height: 78px;
          min-height: 78px;
          max-height: 78px;
          padding: 4px 8px;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 2px;
          overflow: hidden;
          background: #111827;
          border-bottom: 1px solid #2f3542;
          cursor: move;
          user-select: none;
          touch-action: none;
        }

        .cgpt-toolbox-title-row {
          flex: 0 0 24px;
          height: 24px;
          min-height: 24px;
          max-height: 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-width: 0;
          gap: 4px;
          overflow: hidden;
        }

        .cgpt-header-status-chips {
          flex: 1 1 auto;
          min-width: 0;
          min-height: 28px;
          height: auto;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          overflow: visible;
        }

        .cgpt-header-status-chip {
          flex: 0 0 auto;
          max-width: 80px;
          padding: 2px 7px;
          border-radius: 999px;
          font-size: 12px;
          line-height: 20px;
          min-height: 22px;
          display: inline-flex;
          align-items: center;
          font-weight: 700;
          white-space: nowrap;
          overflow: visible;
          text-overflow: ellipsis;
        }

        .cgpt-header-status-chip-danger {
          color: #ffffff;
          background: #dc2626;
        }

        .cgpt-header-status-chip-reply-done,
        .cgpt-header-status-chip-done {
          color: #ffffff;
          background: #dc2626;
          border: 1px solid #ef4444;
        }

        .cgpt-header-status-chip-warn {
          color: #ffffff;
          background: #d97706;
        }

        .cgpt-header-status-chip-info {
          color: #ffffff;
          background: #2563eb;
        }

        .cgpt-header-status-chip-ok {
          color: #ffffff;
          background: #16a34a;
        }

        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-header-status-chips,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-header-status-chips,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-header-status-chips {
          display: flex !important;
          visibility: visible !important;
          opacity: 1 !important;
        }

        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-header-status-chip {
          max-width: 72px;
          font-size: 11px;
          padding: 2px 6px;
        }

        .cgpt-toolbox-title {
          flex: 0 0 auto;
          max-width: 42%;
          font-size: 13px;
          font-weight: 800;
          color: #f8fafc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.2px;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row {
          position: static !important;
          inset: auto !important;
          transform: none !important;
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: wrap !important;
          align-items: center !important;
          align-content: flex-start !important;
          justify-content: flex-start !important;
          align-self: stretch !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          min-height: 44px !important;
          height: 44px !important;
          max-height: 44px !important;
          overflow: hidden !important;
          box-sizing: border-box !important;
          padding: 0 !important;
          column-gap: 3px !important;
          row-gap: 2px !important;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row,
        #${APP.panelId} .cgpt-toolbox-top-status,
        #${APP.panelId} .cgpt-top-status-row,
        #${APP.panelId} .cgpt-toolbox-status-row {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: wrap !important;
          align-items: center !important;
          align-content: flex-start !important;
          justify-content: flex-start !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          min-height: 44px !important;
          height: 44px !important;
          max-height: 44px !important;
          overflow: hidden !important;
          white-space: normal !important;
          column-gap: 3px !important;
          row-gap: 2px !important;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row > *,
        #${APP.panelId} .cgpt-toolbox-top-status > *,
        #${APP.panelId} .cgpt-top-status-row > *,
        #${APP.panelId} .cgpt-toolbox-status-row > * {
          flex: 0 0 auto !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row [data-top-status-slot],
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-top-status-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-status-pill,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-top-stat-secondary,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-local-upload-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-local-message-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-top-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-top-badge-task,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-top-badge-attachment {
          flex: 0 0 auto !important;
          width: auto !important;
          max-width: none !important;
          min-width: 0 !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          align-self: center !important;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-status-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-top-status-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-toolbox-top-status-badge,
        #${APP.panelId} .cgpt-top-status-row .cgpt-status-badge,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge,
        #${APP.panelId} .cgpt-top-status-row .cgpt-toolbox-top-status-badge {
          margin: 0;
        }

        #${APP.panelId} .cgpt-top-status-row [data-top-status-slot="compact-mode"],
        #${APP.panelId} .cgpt-top-status-row [data-top-status-slot="top-status-spacer"] {
          display: none !important;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer {
          min-width: 8px;
          height: 1px;
          background: transparent !important;
          border-color: transparent !important;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge.cgpt-top-status-empty:not(.cgpt-top-status-placeholder),
        #${APP.panelId} .cgpt-top-status-row .cgpt-toolbox-top-status-badge.cgpt-top-status-empty:not(.cgpt-top-status-placeholder) {
          display: none !important;
          min-width: 0 !important;
          width: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          border: 0 !important;
          background: transparent !important;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge.cgpt-top-status-placeholder,
        #${APP.panelId} .cgpt-top-status-row .cgpt-toolbox-top-status-badge.cgpt-top-status-placeholder {
          display: inline-flex !important;
          visibility: visible !important;
          pointer-events: none !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          box-sizing: border-box !important;
          justify-content: center !important;
          align-items: center !important;
          overflow: hidden !important;
          white-space: nowrap !important;
          text-overflow: ellipsis !important;
          flex-shrink: 0 !important;
        }

        /* 防御：spacer 绝不染成 danger/warning 等彩色块 */
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.cgpt-top-status-variant-ok,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.cgpt-top-status-variant-danger,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.cgpt-top-status-variant-warning,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.cgpt-top-status-variant-info,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.cgpt-top-status-variant-muted,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.danger,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.red,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.busy,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-spacer.waiting {
          background: transparent !important;
          border-color: transparent !important;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge,
        #${APP.panelId} .cgpt-top-status-row .cgpt-toolbox-top-status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          justify-self: start;
          width: fit-content;
          max-width: max-content;
          height: 22px;
          min-width: 0;
          padding: 0 8px;
          border-radius: 999px;
          font-size: 12px;
          line-height: 1;
          white-space: nowrap;
          box-sizing: border-box;
          flex: 0 0 auto;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-top-status-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-toolbox-top-status-badge {
          min-width: 0 !important;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="page-id"] {
          min-width: 0;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="turn-count"] {
          min-width: 0;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="upload-usage"] {
          min-width: 0;
          max-width: none;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="message-usage"] {
          min-width: 0;
          max-width: none;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="alert-state"] {
          min-width: 48px;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot],
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-top-status-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-toolbox-top-status-badge {
          width: auto !important;
          min-width: 0 !important;
          max-width: none !important;
          flex: 0 0 auto !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge.is-hidden-placeholder {
          visibility: hidden;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="alert-state"].is-hidden-placeholder,
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="alert-state"][data-alert-hidden="1"],
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="alert-state"].cgpt-top-status-empty {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
          width: 0 !important;
          min-width: 0 !important;
          max-width: 0 !important;
          flex: 0 0 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          border: 0 !important;
          background: transparent !important;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-top-status-slot="alert-state"].cgpt-top-status-empty,
        #${APP.panelId} .cgpt-top-status-row .cgpt-toolbox-top-status-badge[data-top-status-slot="alert-state"].cgpt-top-status-empty,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot="alert-state"].cgpt-top-status-empty {
          display: none !important;
          visibility: hidden !important;
          width: 0 !important;
          min-width: 0 !important;
          max-width: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          border-width: 0 !important;
          background: transparent !important;
          pointer-events: none !important;
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-variant="ok"],
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-variant-ok {
          background: #16a34a;
          color: #ffffff;
          border-color: rgba(74, 222, 128, 0.55);
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-variant="danger"],
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-variant-danger {
          background: #dc2626;
          color: #ffffff;
          border-color: rgba(248, 113, 113, 0.65);
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-variant="warning"],
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-variant-warning {
          background: #f59e0b;
          color: #111827;
          border-color: rgba(251, 191, 36, 0.75);
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-variant="info"],
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-variant-info {
          background: #2563eb;
          color: #ffffff;
          border-color: rgba(147, 197, 253, 0.65);
        }

        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-badge[data-variant="muted"],
        #${APP.panelId} .cgpt-top-status-row .cgpt-top-status-variant-muted {
          background: #334155;
          color: #dbeafe;
          border: 1px solid rgba(148, 163, 184, 0.45);
        }

        #${APP.panelId} .cgpt-top-status-compact .cgpt-top-status-badge,
        #${APP.panelId} .cgpt-top-status-row.cgpt-top-status-compact .cgpt-top-status-badge {
          min-width: 44px;
          padding: 0 6px;
          font-size: 11px;
        }

        #${APP.panelId} .cgpt-top-status-compact .cgpt-top-status-badge[data-top-status-slot="upload-usage"],
        #${APP.panelId} .cgpt-top-status-row.cgpt-top-status-compact .cgpt-top-status-badge[data-top-status-slot="upload-usage"] {
          min-width: 74px;
          max-width: 96px;
        }

        #${APP.panelId} .cgpt-top-status-compact .cgpt-top-status-badge[data-top-status-slot="message-usage"],
        #${APP.panelId} .cgpt-top-status-row.cgpt-top-status-compact .cgpt-top-status-badge[data-top-status-slot="message-usage"] {
          min-width: 82px;
          max-width: 104px;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-top-status-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-status-pill {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          min-height: 21px !important;
          line-height: 21px !important;
          padding: 0 6px !important;
          border-radius: 10px !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          letter-spacing: 0 !important;
          box-sizing: border-box !important;
          border: 1px solid transparent;
          width: auto !important;
          max-width: none !important;
          min-width: 0 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          flex: 0 0 auto !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
        }

        /* 顶部状态栏统一布局：允许换行，但固定保留两行高度，避免状态变化导致界面上下跳动 */
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row {
          display: flex !important;
          flex-direction: row !important;
          flex-wrap: wrap !important;
          align-items: center !important;
          align-content: flex-start !important;
          justify-content: flex-start !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          min-height: 44px !important;
          height: 44px !important;
          max-height: 44px !important;
          column-gap: 3px !important;
          row-gap: 2px !important;
          padding: 0 !important;
          margin: 0 !important;
          box-sizing: border-box !important;
          overflow: hidden !important;
          white-space: normal !important;
        }
        /*
         * 不再因为 extra-narrow 额外放大 header。
         * 当前 extra-narrow 阈值是 460px，普通右侧悬浮工具箱经常会命中这个类。
         * 如果这里保留 113px / 69px，就会在状态栏和 tabs 之间产生大块空白。
         */
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-header,
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-toolbox-header {
          flex: 0 0 78px !important;
          height: 78px !important;
          min-height: 78px !important;
          max-height: 78px !important;
          padding: 4px 8px !important;
          gap: 2px !important;
        }
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-header-status-row.cgpt-top-status-row,
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-toolbox-header-status-row.cgpt-top-status-row {
          min-height: 44px !important;
          height: 44px !important;
          max-height: 44px !important;
          overflow: hidden !important;
        }
        /* 顶部状态胶囊：按内容宽度显示，不横向拉满 */
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot],
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-top-status-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-toolbox-top-status-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-status-pill,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-top-stat-secondary,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-local-upload-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-local-message-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-top-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-top-badge-task {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          flex: 0 0 auto !important;
          width: auto !important;
          min-width: 58px !important;
          max-width: 110px !important;
          height: 21px !important;
          min-height: 21px !important;
          max-height: 21px !important;
          line-height: 21px !important;
          padding: 0 7px !important;
          margin: 0 !important;
          border-radius: 999px !important;
          font-size: 11.5px !important;
          font-weight: 700 !important;
          letter-spacing: 0 !important;
          box-sizing: border-box !important;
          overflow: hidden !important;
          white-space: nowrap !important;
          text-overflow: ellipsis !important;
          font-variant-numeric: tabular-nums !important;
        }
        /* 不同状态项给合适的最小宽度，但仍然允许自动换行 */
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot="reply-state"],
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot="task-state"] {
          min-width: 64px !important;
          max-width: 86px !important;
        }
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot="page-id"],
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot="turn-count"] {
          min-width: 66px !important;
          max-width: 92px !important;
        }
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot="upload-usage"] {
          min-width: 76px !important;
          max-width: 98px !important;
        }
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot="message-usage"] {
          min-width: 84px !important;
          max-width: 110px !important;
        }
        /* 报错槽位没有内容时不占位置 */
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-top-status-badge.is-hidden-placeholder,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row .cgpt-toolbox-top-status-badge.is-hidden-placeholder,
        #${APP.panelId} .cgpt-toolbox-header-status-row.cgpt-top-status-row [data-top-status-slot="alert-state"].is-hidden-placeholder {
          display: none !important;
          visibility: hidden !important;
          width: 0 !important;
          min-width: 0 !important;
          max-width: 0 !important;
          height: 0 !important;
          min-height: 0 !important;
          max-height: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          border: 0 !important;
        }
        /*
         * 窄屏状态栏仍然允许换行，但高度必须固定。
         * 禁止 height:auto，否则状态文本变化时会继续把下面 tabs / 按钮顶来顶去。
         */
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-header-status-row.cgpt-top-status-row,
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-toolbox-header-status-row.cgpt-top-status-row,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-status-row.cgpt-top-status-row {
          display: flex !important;
          flex-wrap: wrap !important;
          justify-content: flex-start !important;
          align-items: center !important;
          align-content: flex-start !important;
          width: 100% !important;
          min-height: 44px !important;
          height: 44px !important;
          max-height: 44px !important;
          overflow: hidden !important;
          column-gap: 3px !important;
          row-gap: 2px !important;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-page-id-badge {
          color: #ffffff;
          background: linear-gradient(180deg, #18b663 0%, #129452 100%);
          border-color: rgba(121, 243, 174, 0.35);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-turn-count-badge,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-page-turn-badge {
          color: #ffffff;
          background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
          border-color: rgba(147, 197, 253, 0.70);
          box-shadow:
            0 0 0 1px rgba(37, 99, 235, 0.20),
            inset 0 1px 0 rgba(255, 255, 255, 0.12);
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-turn-count-badge.cgpt-toolbox-turn-count-warning,
        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-page-turn-badge.cgpt-toolbox-turn-count-warning {
          color: #ffffff;
          background: linear-gradient(180deg, #ef4444 0%, #b91c1c 100%);
          border-color: rgba(248, 113, 113, 0.85);
          box-shadow:
            0 0 0 1px rgba(248, 113, 113, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.10);
        }

        .cgpt-status-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 46px;
          height: 24px;
          padding: 0 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
          border: 1px solid rgba(148, 163, 184, 0.55);
          color: #e5e7eb;
          background: rgba(15, 23, 42, 0.88);
          white-space: nowrap;
        }

        .cgpt-state-ready {
          color: #dcfce7;
          background: rgba(22, 163, 74, 0.9);
          border-color: rgba(74, 222, 128, 0.9);
        }

        .cgpt-state-waiting,
        .cgpt-state-sending {
          color: #ffedd5;
          background: rgba(217, 119, 6, 0.92);
          border-color: rgba(251, 191, 36, 0.9);
        }

        .cgpt-state-generating,
        .cgpt-state-answering {
          color: #fee2e2;
          background: rgba(220, 38, 38, 0.9);
          border-color: rgba(248, 113, 113, 0.9);
        }

        .cgpt-state-blocked {
          color: #e5e7eb;
          background: rgba(71, 85, 105, 0.86);
          border-color: rgba(148, 163, 184, 0.65);
        }

        .cgpt-state-offline,
        .cgpt-state-unknown {
          color: #e5e7eb;
          background: rgba(71, 85, 105, 0.86);
          border-color: rgba(148, 163, 184, 0.65);
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-status-row .cgpt-status-pill {
          min-width: 40px;
          height: 22px;
          padding: 0 7px;
          font-size: 11px;
        }

        .cgpt-toolbox-header-actions {
          flex: 0 0 auto;
          flex: 0 0 auto;
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .cgpt-toolbox-status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          max-width: 72px;
          height: 22px;
          padding: 0 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.85);
          color: #cbd5e1;
        }

        .cgpt-toolbox-status-badge.cgpt-status-hidden,
        .cgpt-toolbox-status-badge:empty {
          display: none !important;
          width: 0 !important;
          min-width: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          background: transparent !important;
        }

        #cgpt-toolbox-status-badge.cgpt-status-hidden,
        #cgpt-toolbox-status-badge:empty {
          display: none !important;
          width: 0 !important;
          min-width: 0 !important;
          padding: 0 !important;
          border: 0 !important;
          background: transparent !important;
        }

        #cgpt-prompt-status:empty {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-status-badge {
          display: none !important;
        }

        .cgpt-status-idle {
          background: rgba(30, 41, 59, 0.88);
          color: #cbd5e1;
          border-color: rgba(148, 163, 184, 0.35);
        }

        .cgpt-status-running {
          background: rgba(37, 99, 235, 0.22);
          color: #bfdbfe;
          border-color: rgba(96, 165, 250, 0.7);
        }

        .cgpt-status-danger {
          background: rgba(220, 38, 38, 0.92);
          color: #ffffff;
          border-color: #ef4444;
        }

        .cgpt-status-success,
        .cgpt-status-online {
          background: rgba(22, 163, 74, 0.22);
          color: #bbf7d0;
          border-color: rgba(74, 222, 128, 0.65);
        }

        .cgpt-status-warn,
        .cgpt-status-offline {
          background: rgba(202, 138, 4, 0.22);
          color: #fde68a;
          border-color: rgba(250, 204, 21, 0.65);
        }

        .cgpt-status-error {
          background: rgba(220, 38, 38, 0.22);
          color: #fecaca;
          border-color: rgba(248, 113, 113, 0.7);
        }

        .cgpt-toolbox-toast {
          position: absolute;
          left: 50%;
          top: 46px;
          transform: translateX(-50%) translateY(-8px);
          z-index: 20;
          min-width: 88px;
          max-width: calc(100% - 24px);
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          text-align: center;
          pointer-events: none;
          opacity: 0;
          transition: opacity 140ms ease, transform 140ms ease;
          box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.96);
          color: #e5e7eb;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-toolbox-toast.show {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        .cgpt-toolbox-toast[hidden] {
          display: none !important;
        }

        .cgpt-toast-success,
        .cgpt-toast-online {
          background: rgba(22, 101, 52, 0.96);
          color: #dcfce7;
          border-color: rgba(74, 222, 128, 0.75);
        }

        .cgpt-toast-boot-ready {
          background: #fde047;
          color: #111827;
          border-color: #facc15;
          box-shadow:
            0 10px 26px rgba(0, 0, 0, 0.35),
            0 0 0 1px rgba(250, 204, 21, 0.45),
            0 0 18px rgba(253, 224, 71, 0.45);
        }

        .cgpt-toast-running {
          background: rgba(30, 64, 175, 0.96);
          color: #dbeafe;
          border-color: rgba(96, 165, 250, 0.75);
        }

        .cgpt-toast-danger {
          background: rgba(220, 38, 38, 0.96);
          color: #ffffff;
          border-color: rgba(239, 68, 68, 0.85);
        }

        .cgpt-toast-warn,
        .cgpt-toast-offline {
          background: rgba(133, 77, 14, 0.96);
          color: #fef3c7;
          border-color: rgba(250, 204, 21, 0.75);
        }

        .cgpt-toast-error {
          background: rgba(153, 27, 27, 0.96);
          color: #fee2e2;
          border-color: rgba(248, 113, 113, 0.8);
        }

        .cgpt-toolbox-small-btn {
          height: 26px;
          padding: 0 8px;
          border: 1px solid #475569;
          background: #1f2937;
          color: #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
        }

        .cgpt-toolbox-small-btn:hover {
          background: #273449;
        }

        .cgpt-toolbox-tabs,
        .cgpt-top-tabs,
        .cgpt-sub-tabs {
          flex: 0 0 auto;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          align-content: flex-start;
          gap: 4px;
          padding: 4px 8px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
          overflow-y: hidden;
          background: #0f1115;
          border-bottom: 1px solid #2f3542;
          box-sizing: border-box;
        }

        /*
         * 顶部 tabs 保留一行高度。
         * 它仍然允许换行，但普通 active 状态变化不能让它在一行/两行之间抖动。
         */
        .cgpt-toolbox-tabs.cgpt-top-tabs {
          flex: 0 0 34px;
          height: 34px;
          min-height: 34px;
          max-height: 34px;
          align-content: flex-start;
        }
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-toolbox-tabs.cgpt-top-tabs,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-tabs.cgpt-top-tabs {
          flex: 0 0 64px;
          height: 64px;
          min-height: 64px;
          max-height: 64px;
          align-content: flex-start;
        }

        .cgpt-toolbox-tab {
          flex: 0 0 auto;
          min-width: 0;
          max-width: none;
          height: 26px;
          padding: 0 7px;
          border: 1px solid #3f4655;
          background: #171b22;
          color: #d1d5db;
          border-radius: 8px;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 12px;
          line-height: 24px;
          font-weight: 650;
        }

        .cgpt-setting-prompt-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }

        .cgpt-setting-prompt-toolbar .cgpt-hint {
          margin-left: auto;
        }

        .cgpt-settings-prompt-list {
          margin-top: 8px;
          max-height: 260px;
          overflow-y: auto;
          border: 1px solid #2f3542;
          border-radius: 10px;
          padding: 8px;
          background: #0f1115;
        }

        .cgpt-settings-prompt-row {
          margin-bottom: 6px;
        }

        .cgpt-shortcut-settings {
          display: flex;
          flex-direction: column;
          gap: 0;
          margin-top: 8px;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-row {
          display: grid;
          grid-template-columns: 210px 1fr 48px 48px;
          align-items: center;
          gap: 8px;
          min-height: 36px;
          margin: 6px 0;
        }

        #cgpt-toolbox-panel.cgpt-toolbox-compact .cgpt-shortcut-settings .cgpt-hotkey-setting-row {
          grid-template-columns: 1fr;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-label {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          margin: 0;
          color: #f8fafc;
          font-size: 14px;
          font-weight: 600;
          line-height: 32px;
          opacity: 1;
          cursor: default;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-label:has(.cgpt-hotkey-setting-checkbox) {
          cursor: pointer;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-label-text {
          color: #f8fafc;
          font-size: 14px;
          font-weight: 600;
          line-height: 32px;
          white-space: nowrap;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-checkbox {
          width: 14px;
          height: 14px;
          flex: 0 0 14px;
          margin: 0;
          accent-color: #60a5fa;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-checkbox-placeholder {
          width: 14px;
          height: 14px;
          flex: 0 0 14px;
          display: inline-block;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-input {
          box-sizing: border-box;
          width: 100%;
          height: 32px;
          min-width: 0;
          margin: 0;
          padding: 0 8px;
          color: #f8fafc;
          font-size: 15px;
          font-weight: 600;
          line-height: 32px;
          background: #0f1115;
          border: 1px solid #374151;
          border-radius: 9px;
          outline: none;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-btn {
          box-sizing: border-box;
          height: 32px;
          min-width: 48px;
          padding: 0 8px;
          font-size: 13px;
          font-weight: 600;
          border: 1px solid #475569;
          background: #1f2937;
          color: #f8fafc;
          border-radius: 9px;
          cursor: pointer;
          white-space: nowrap;
        }

        .cgpt-shortcut-settings .cgpt-hotkey-setting-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .cgpt-upload-quick-prompts {
          margin-top: 12px;
          border: 1px solid #2f3542;
          background: #10151f;
          border-radius: 12px;
          padding: 10px;
        }

        .cgpt-upload-quick-prompts-title {
          font-weight: 700;
          color: #f8fafc;
          margin-bottom: 8px;
        }

        .cgpt-upload-quick-prompt-groups {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible;
          padding-bottom: 0;
          margin-bottom: 8px;
        }

        .cgpt-upload-quick-prompt-group {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          flex: 0 1 auto;
          min-width: 0;
          height: 26px;
          max-width: 150px;
          padding: 0 9px;
          border: 1px solid #475569;
          background: #171b22;
          color: #d1d5db;
          border-radius: 999px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-upload-quick-prompt-group:hover {
          background: #202633;
        }

        .cgpt-upload-quick-prompt-group.active {
          background: #22324a;
          border-color: #4b6b95;
          color: #dbeafe;
          font-weight: 650;
          box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.10);
        }

        .cgpt-upload-quick-prompts-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
        }

        .cgpt-upload-quick-prompt-chip {
          flex: 0 1 auto;
          min-width: 0;
          height: 30px;
          max-width: 150px;
          padding: 0 10px;
          border: 1px solid #475569;
          background: #171b22;
          color: #f8fafc;
          border-radius: 999px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-upload-quick-prompt-chip:hover {
          background: #1d4ed8;
          border-color: #60a5fa;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts {
          margin-top: 6px;
          padding: 6px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts-title {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-groups {
          gap: 5px;
          margin-bottom: 6px;
          overflow-x: hidden !important;
          overflow-y: hidden !important;
          padding-bottom: 0 !important;
          scrollbar-width: none !important;
          -ms-overflow-style: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact [data-page="upload"] .cgpt-upload-group-list::-webkit-scrollbar,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-groups::-webkit-scrollbar {
          display: none !important;
          width: 0 !important;
          height: 0 !important;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-group {
          height: 24px;
          max-width: 78px;
          padding: 0 7px;
          font-size: 11px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompts-list {
          gap: 5px;
        }

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-upload-quick-prompt-chip {
          height: 26px;
          max-width: 110px;
          padding: 0 8px;
          font-size: 12px;
        }

        .cgpt-toolbox-tab:hover {
          background: #202633;
        }

        .cgpt-toolbox-tab.active {
          background: #22324a;
          border-color: #4b6b95;
          color: #dbeafe;
          font-weight: 650;
          box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.10);
        }

        .cgpt-toolbox-content,
        .cgpt-toolbox-body,
        .cgpt-tab-content {
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .cgpt-toolbox-content {
          flex: 1 1 auto;
          min-height: 0;
          min-width: 0;
          overflow-y: auto;
          overflow-x: hidden !important;
          padding: 6px;
        }

        .cgpt-toolbox-page {
          display: none;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .cgpt-toolbox-page.active {
          display: block;
        }

        #${APP.rootId}[data-active-tab="log"] .cgpt-toolbox-content,
        #${APP.rootId}[data-active-tab="log"] .cgpt-toolbox-page[data-page="log"],
        #${APP.rootId}[data-active-tab="log"] #cgpt-log-tab-host {
          min-height: 0;
          overflow: hidden !important;
        }

        #${APP.rootId}[data-active-tab="log"] .cgpt-toolbox-page[data-page="log"].active {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        #${APP.rootId}[data-active-tab="log"] #cgpt-log-tab-host {
          display: flex;
          flex: 1 1 auto;
        }

        .cgpt-log-panel {
          display: flex;
          flex-direction: column;
          flex: 1 1 auto;
          min-height: 0;
          overflow: hidden;
          gap: 8px;
        }

        .cgpt-log-actions {
          display: flex;
          flex: 0 0 auto;
          gap: 8px;
          align-items: center;
          width: 100%;
          min-width: 0;
        }

        .cgpt-log-actions .cgpt-log-clear-right {
          margin-left: auto;
        }

        #cgpt-log-copy-errors,
        #cgpt-autoq-copy-errors,
        .cgpt-log-copy-errors-btn {
          min-width: 112px;
        }

        #cgpt-log-module {
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        #cgpt-log-module .cgpt-log-advanced {
          flex: 0 0 auto;
        }

        .cgpt-log-list {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto !important;
          overflow-x: hidden;
          border: 1px solid #2f3542;
          border-radius: 10px;
          background: #0f1115;
          padding: 8px;
          font-family: Consolas, "SFMono-Regular", monospace;
          font-size: 11px;
          color: #cbd5e1;
          white-space: pre-wrap;
        }

        #cgpt-log-module textarea {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto !important;
          resize: none;
        }

        .cgpt-log-line {
          padding: 3px 0;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }

        .cgpt-log-line:last-child {
          border-bottom: none;
        }

        .cgpt-log-empty {
          color: #94a3b8;
          text-align: center;
          padding: 18px 0;
        }

        .cgpt-section {
          border: 1px solid #2f3542;
          background: #141821;
          border-radius: 12px;
          padding: 10px;
          margin-bottom: 10px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .cgpt-section-title {
          font-weight: 700;
          margin-bottom: 8px;
          color: #f8fafc;
        }

        #cgpt-settings-module {
          padding-top: 6px !important;
        }

        #cgpt-settings-module .cgpt-settings-subtabs {
          margin-top: 0 !important;
          padding-top: 0 !important;
          margin-bottom: 6px;
        }

        #cgpt-settings-module .cgpt-settings-panel {
          margin-top: 6px !important;
          padding-top: 8px !important;
        }

        #cgpt-setting-beep-status {
          color: #94a3b8;
          font-size: 12px;
        }

        #cgpt-settings-module .cgpt-hint:not(#cgpt-setting-beep-status),
        #cgpt-settings-module .cgpt-help-text,
        #cgpt-settings-module .cgpt-desc,
        #cgpt-settings-module .cgpt-description,
        #cgpt-settings-module .cgpt-setting-desc,
        #cgpt-settings-module .cgpt-muted-text,
        .cgpt-settings-module .cgpt-help-text,
        .cgpt-settings-module .cgpt-desc,
        .cgpt-settings-module .cgpt-description,
        .cgpt-settings-module .cgpt-setting-desc,
        .cgpt-settings-module .cgpt-muted-text {
          display: none !important;
        }

        .cgpt-settings-subtabs {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin: 0 0 6px;
          padding: 4px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          border: 1px solid #2f3542;
          background: #111827;
          border-radius: 10px;
        }

        .cgpt-settings-subtab {
          flex: 1 1 96px;
          min-width: 0;
          max-width: 100%;
          height: 30px;
          border: 1px solid #334155;
          background: #171b22;
          color: #cbd5e1;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-settings-subtab.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 700;
        }

        .cgpt-settings-panel {
          margin-top: 6px;
        }

        .cgpt-settings-panel .cgpt-section-title {
          margin-top: 10px;
        }

        .cgpt-row,
        .cgpt-log-actions,
        .cgpt-upload-action-row {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
          min-width: 0;
          max-width: 100%;
          flex-wrap: wrap;
          overflow-x: hidden;
        }

        .cgpt-upload-action-toolbar .cgpt-upload-action-row,
        .cgpt-toolbox-action-grid .cgpt-upload-action-row {
          margin-top: 0;
          margin-bottom: 0;
          padding-top: 0;
          padding-bottom: 0;
        }

        #cgpt-log-module .cgpt-log-actions {
          width: 100%;
        }

        #cgpt-log-module .cgpt-log-actions .cgpt-log-clear-right {
          margin-left: auto;
        }

        .cgpt-prompt-actions {
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden;
        }

        .cgpt-row > * {
          min-width: 0;
        }

        #${APP.panelId} input,
        #${APP.panelId} textarea,
        #${APP.panelId} select {
          min-width: 0;
          max-width: 100%;
        }

        .cgpt-btn {
          box-sizing: border-box;
          height: 32px;
          padding: 0 10px;
          border: 1px solid var(--cgpt-btn-border, #475569);
          background: var(--cgpt-btn-bg, #1f2937);
          color: var(--cgpt-btn-text, #f2f2f2);
          border-radius: 9px;
          cursor: pointer;
          min-width: 0;
          max-width: 100%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          direction: ltr;
          text-align: center;
          line-height: 1.25;
        }

        .cgpt-btn.compact {
          height: 28px;
          padding: 0 8px;
        }

        .cgpt-btn:hover {
          background: var(--cgpt-btn-hover-bg, #273449);
          border-color: var(--cgpt-btn-hover-border, var(--cgpt-btn-border, #475569));
          color: var(--cgpt-btn-hover-text, var(--cgpt-btn-text, #f2f2f2));
        }

        .cgpt-btn:focus {
          outline: 2px solid rgba(96, 165, 250, 0.75);
          outline-offset: 2px;
        }

        .cgpt-btn:active {
          transform: translateY(1px);
        }

        /* 禁止浏览器 disabled 默认灰化按钮；不可用态只降透明度 */
        #${APP.rootId} button:disabled,
        #${APP.rootId} .cgpt-btn:disabled,
        #${APP.rootId} .cgpt-btn[disabled],
        #${APP.rootId} .cgpt-btn[aria-disabled="true"] {
          opacity: 0.72 !important;
          filter: none !important;
          cursor: not-allowed !important;
          box-shadow: none !important;
        }

        #${APP.rootId} .cgpt-btn.cgpt-btn-disabled-visual,
        #${APP.rootId} .cgpt-btn.cgpt-btn-disabled,
        #${APP.rootId} .cgpt-btn.is-disabled,
        #${APP.rootId} .cgpt-btn.disabled {
          opacity: 0.72 !important;
          filter: none !important;
        }

        #${APP.rootId} .cgpt-toolbox-hidden {
          display: none !important;
        }

        #${APP.rootId} .cgpt-btn.gray,
        #${APP.rootId} .cgpt-btn.grey,
        #${APP.rootId} .cgpt-btn.dark,
        #${APP.rootId} .cgpt-btn.black,
        #${APP.rootId} .cgpt-btn.cgpt-btn-gray,
        #${APP.rootId} .cgpt-btn.cgpt-btn-grey,
        #${APP.rootId} .cgpt-btn.cgpt-btn-dark,
        #${APP.rootId} .cgpt-btn.cgpt-btn-black {
          background: linear-gradient(135deg, #2563eb, #1d4ed8) !important;
          border-color: rgba(147, 197, 253, 0.75) !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-ok {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        .cgpt-btn.primary {
          background: #2563eb;
          border-color: #3b82f6;
          color: #ffffff;
        }

        .cgpt-btn.primary:hover {
          background: #1d4ed8;
        }

        .cgpt-btn[data-action="copy-only"],
        .cgpt-btn[data-action="copy-last-reply"],
        .cgpt-btn[data-action="copy-log"],
        .cgpt-btn[data-action="copy-error-log"],
        .cgpt-btn[data-action="copy-and-hotkey"],
        .cgpt-btn[data-action="copy-shortcut"],
        .cgpt-btn[data-action="copy-and-continue"],
        .cgpt-btn[data-action="copy-hotkey-continue"],
        .cgpt-btn[data-action="loop-copy-hotkey-continue"] {
          --cgpt-btn-bg: linear-gradient(135deg, #2563eb, #4f46e5);
          --cgpt-btn-border: rgba(147, 197, 253, 0.75);
          --cgpt-btn-hover-bg: linear-gradient(135deg, #3b82f6, #6366f1);
          --cgpt-btn-hover-border: rgba(191, 219, 254, 0.95);
          --cgpt-btn-text: #ffffff;
          --cgpt-btn-hover-text: #ffffff;
        }

        #cgpt-copy-toolbox-log.cgpt-btn,
        .cgpt-btn[data-action="copy-log"],
        .cgpt-btn[data-action="copy-error-log"] {
          --cgpt-btn-bg: linear-gradient(135deg, #2563eb, #4f46e5);
          --cgpt-btn-border: rgba(147, 197, 253, 0.75);
          --cgpt-btn-hover-bg: linear-gradient(135deg, #3b82f6, #6366f1);
          --cgpt-btn-hover-border: rgba(191, 219, 254, 0.95);
          --cgpt-btn-text: #ffffff;
          --cgpt-btn-hover-text: #ffffff;
          background: var(--cgpt-btn-bg);
          border-color: var(--cgpt-btn-border);
          color: var(--cgpt-btn-text);
        }

        #cgpt-copy-toolbox-log.cgpt-btn:hover,
        .cgpt-btn[data-action="copy-log"]:hover,
        .cgpt-btn[data-action="copy-error-log"]:hover {
          background: var(--cgpt-btn-hover-bg);
          border-color: var(--cgpt-btn-hover-border, var(--cgpt-btn-border));
          color: var(--cgpt-btn-hover-text, var(--cgpt-btn-text));
        }

        #cgpt-copy-toolbox-log.cgpt-btn.cgpt-btn-disabled,
        #cgpt-copy-toolbox-log.cgpt-btn.cgpt-btn-disabled-visual,
        #cgpt-copy-toolbox-log.cgpt-btn:disabled:not(.cgpt-short-action-busy) {
          background: linear-gradient(180deg, #2563eb, #1d4ed8) !important;
          border-color: rgba(147, 197, 253, 0.45) !important;
          color: #ffffff !important;
          opacity: 0.72 !important;
        }

        .cgpt-btn.cgpt-short-action-busy {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        .cgpt-btn.cgpt-btn-busy {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-busy:hover {
          background: #b91c1c !important;
          border-color: #dc2626 !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-action-button-active {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-action-button-active:hover {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        .cgpt-btn-attention {
          outline: 2px solid #facc15 !important;
          box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.25) !important;
        }

        .cgpt-btn.cgpt-btn-danger:not(.cgpt-btn-busy) {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-danger:not(.cgpt-btn-busy):hover {
          background: #b91c1c !important;
        }

        .cgpt-btn.cgpt-btn-cancelled {
          opacity: 0.72 !important;
          cursor: not-allowed;
          filter: none !important;
        }

        .cgpt-btn.cgpt-btn-failed {
          background: #991b1b !important;
          border-color: #b91c1c !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-disabled,
        .cgpt-btn.cgpt-btn-disabled-visual {
          cursor: not-allowed;
          opacity: 0.72 !important;
          filter: none !important;
        }

        .cgpt-btn.cgpt-task-running-indicator {
          opacity: 0.72 !important;
          cursor: not-allowed;
          filter: none !important;
        }

        .cgpt-btn.danger {
          background: #dc2626;
          border-color: #ef4444;
          color: #ffffff;
        }

        .cgpt-btn.danger:hover {
          background: #b91c1c;
          border-color: #f87171;
          color: #ffffff;
        }

        .cgpt-btn.success {
          background: #166534;
          border-color: #22c55e;
        }

        .cgpt-btn.success:hover {
          background: #15803d;
        }

        .cgpt-btn.warning {
          background: #b45309;
          border-color: #f59e0b;
          color: #ffffff;
        }

        .cgpt-btn.warning:hover {
          background: #d97706;
        }

        #cgpt-open-chatgpt-home.cgpt-btn-home:not(.cgpt-btn-busy):not(.cgpt-btn-failed):not(.cgpt-btn-disabled):not(:disabled) {
          background: #ea580c !important;
          border-color: #f97316 !important;
          color: #ffffff !important;
        }

        #cgpt-open-chatgpt-home.cgpt-btn-home:not(.cgpt-btn-busy):not(.cgpt-btn-failed):not(.cgpt-btn-disabled):not(:disabled):hover {
          background: #f97316 !important;
          border-color: #fb923c !important;
          color: #ffffff !important;
        }

        #cgpt-open-chatgpt-home.cgpt-btn-home:not(.cgpt-btn-busy):not(.cgpt-btn-failed):not(.cgpt-btn-disabled):not(:disabled):active {
          background: #c2410c !important;
          border-color: #ea580c !important;
          color: #ffffff !important;
        }

        .cgpt-btn.waiting {
          background: #d97706;
          border-color: #f59e0b;
          color: #ffffff;
        }

        .cgpt-btn.waiting:hover {
          background: #b45309;
        }

        .cgpt-btn.cgpt-btn-waiting-danger,
        .cgpt-btn[data-wait-danger="1"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.35), 0 0 10px rgba(239, 68, 68, 0.35) !important;
        }

        .cgpt-btn.cgpt-btn-waiting-danger:hover,
        .cgpt-btn[data-wait-danger="1"]:hover {
          background: #b91c1c !important;
          border-color: #f87171 !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-waiting-danger:disabled,
        .cgpt-btn[data-wait-danger="1"]:disabled {
          background: #991b1b !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        .cgpt-btn.teal {
          background: #0f766e;
          border-color: #14b8a6;
          color: #ffffff;
        }

        .cgpt-btn.teal:hover {
          background: #0d9488;
        }

        .cgpt-btn.purple {
          background: #7c3aed;
          border-color: #8b5cf6;
          color: #ffffff;
        }

        .cgpt-btn.purple:hover {
          background: #6d28d9;
        }

        .cgpt-btn.cyan {
          background: #0891b2;
          border-color: #22d3ee;
          color: #ffffff;
        }

        .cgpt-btn.cyan:hover {
          background: #0e7490;
        }

        .cgpt-btn.purple:disabled,
        .cgpt-btn.purple.cgpt-btn-disabled-visual {
          opacity: 0.72 !important;
          cursor: not-allowed;
        }

        .cgpt-btn.cyan:disabled,
        .cgpt-btn.cyan.cgpt-btn-disabled-visual {
          opacity: 0.72 !important;
          cursor: not-allowed;
        }

        .cgpt-btn.cgpt-btn-closed-loop.cgpt-btn-danger,
        .cgpt-btn.cgpt-btn-closed-loop.cgpt-btn-stop,
        .cgpt-btn.cgpt-btn-closed-loop.cgpt-action-running {
          background: linear-gradient(135deg, #ef4444, #dc2626) !important;
          color: #ffffff !important;
          border: 1px solid rgba(248, 113, 113, 0.65) !important;
        }

        #cgpt-closed-loop-upload-every5-btn,
        #cgpt-closed-loop-upload-every-round-hotkey-btn,
        #cgpt-closed-loop-upload-every5-hotkey-btn {
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }

        .cgpt-btn.cgpt-btn-closed-loop:disabled {
          opacity: 0.72 !important;
          filter: none !important;
          cursor: not-allowed;
        }

        #cgpt-copy-hotkey-continue-loop.cgpt-btn-busy {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        #cgpt-autoq-start-upload.cgpt-btn-busy,
        #cgpt-autoq-start-upload[data-cgpt-button-phase="uploading"],
        #cgpt-autoq-start-upload[data-cgpt-button-phase="running"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        #cgpt-autoq-start-upload.cgpt-btn-disabled,
        #cgpt-autoq-start-upload.cgpt-btn-disabled-visual,
        #cgpt-autoq-start-upload:disabled:not(.cgpt-btn-busy),
        #cgpt-autoq-start-upload[aria-disabled="true"]:not(.cgpt-btn-busy) {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
          opacity: 1 !important;
          filter: none !important;
        }
        #cgpt-autoq-start-upload:disabled:not(.cgpt-btn-busy),
        #cgpt-autoq-start-upload[aria-disabled="true"]:not(.cgpt-btn-busy) {
          cursor: not-allowed !important;
        }

        #cgpt-upload-start {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        #cgpt-upload-start:hover:not(:disabled) {
          background: #15803d !important;
        }

        #cgpt-upload-start:disabled:not(.cgpt-btn-busy) {
          opacity: 0.72 !important;
          cursor: not-allowed;
        }

        #cgpt-upload-start.cgpt-btn-busy,
        #cgpt-upload-start[data-cgpt-button-phase="uploading"],
        #cgpt-upload-start[data-cgpt-button-phase="running"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
          cursor: pointer !important;
        }

        #cgpt-upload-start.cgpt-btn-busy:hover,
        #cgpt-upload-start[data-cgpt-button-phase="uploading"]:hover,
        #cgpt-upload-start[data-cgpt-button-phase="running"]:hover {
          background: #b91c1c !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        #cgpt-upload-start.cgpt-btn-danger,
        #cgpt-upload-start.cgpt-action-running,
        #cgpt-upload-start[data-cgpt-button-phase="danger"],
        #cgpt-upload-start[data-cgpt-button-phase="uploading"],
        #cgpt-upload-start[data-cgpt-button-phase="running"],
        #cgpt-upload-start[data-cgpt-button-phase="waiting"],
        #cgpt-copy-hotkey-once.cgpt-btn-danger,
        #cgpt-copy-hotkey-once.cgpt-btn-busy,
        #cgpt-copy-hotkey-once.cgpt-action-running,
        #cgpt-copy-hotkey-once.cgpt-action-button-active,
        #cgpt-copy-hotkey-once[data-cgpt-button-phase="danger"],
        #cgpt-copy-hotkey-once[data-cgpt-button-phase="running"],
        #cgpt-copy-hotkey-once[data-cgpt-button-phase="waiting"],
        #cgpt-copy-hotkey-once[data-cgpt-button-phase="waiting_reply"],
        #cgpt-copy-hotkey-once[data-cgpt-button-phase="copying"],
        #cgpt-copy-hotkey-once[data-cgpt-button-phase="sending"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
          filter: none !important;
          cursor: pointer !important;
        }

        #cgpt-send-copy-hotkey-once.cgpt-btn-danger,
        #cgpt-send-copy-hotkey-once.cgpt-btn-busy,
        #cgpt-send-copy-hotkey-once.cgpt-action-running,
        #cgpt-send-copy-hotkey-once.cgpt-action-button-active,
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="running"],
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="waiting_reply"],
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="copy_hotkey_core"],
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="copying"],
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="sending_hotkey"],
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="cancelling"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
          filter: none !important;
          cursor: pointer !important;
        }

        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="idle"],
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="success"],
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="cancelled"],
        #cgpt-send-copy-hotkey-once[data-base-role="send-copy-hotkey"][data-color-role="send-copy-hotkey-idle"],
        #cgpt-send-copy-hotkey-once.purple:not(.cgpt-btn-danger):not(.cgpt-btn-busy):not(.cgpt-action-running):not(.cgpt-btn-failed) {
          background: linear-gradient(135deg, #7c3aed, #6d28d9) !important;
          border: 1px solid rgba(255, 255, 255, 0.16) !important;
          color: #ffffff !important;
          opacity: 1 !important;
          filter: none !important;
          box-shadow: none !important;
          cursor: pointer !important;
        }

        #cgpt-send-copy-hotkey-once[data-base-role="send-copy-hotkey"][data-color-role="send-copy-hotkey-idle"]:hover,
        #cgpt-send-copy-hotkey-once.purple:not(.cgpt-btn-danger):not(.cgpt-btn-busy):not(.cgpt-action-running):not(.cgpt-btn-failed):hover {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed) !important;
          color: #ffffff !important;
        }

        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="failed"],
        #cgpt-send-copy-hotkey-once[data-color-role="error"].cgpt-btn-failed {
          background: #991b1b !important;
          border-color: #b91c1c !important;
          color: #ffffff !important;
          opacity: 1 !important;
          filter: none !important;
        }

        #cgpt-send-copy-hotkey-once.cgpt-btn-danger:hover,
        #cgpt-send-copy-hotkey-once.cgpt-btn-busy:hover,
        #cgpt-send-copy-hotkey-once.cgpt-action-running:hover,
        #cgpt-send-copy-hotkey-once.cgpt-action-button-active:hover,
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="running"]:hover,
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="waiting_reply"]:hover,
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="copy_hotkey_core"]:hover,
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="copying"]:hover,
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="sending_hotkey"]:hover,
        #cgpt-send-copy-hotkey-once[data-cgpt-button-phase="cancelling"]:hover {
          background: #b91c1c !important;
          border-color: #f87171 !important;
          color: #ffffff !important;
        }

        #cgpt-upload-start.cgpt-task-running-indicator,
        #cgpt-copy-hotkey-once.cgpt-task-running-indicator,
        #cgpt-send-copy-hotkey-once.cgpt-task-running-indicator {
          opacity: 1 !important;
          filter: none !important;
        }

        .cgpt-upload-action-toolbar {
          display: block;
          margin: 0 0 6px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible !important;
        }

        .cgpt-toolbox-action-grid {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          align-content: flex-start;
          gap: 6px 6px;
          width: 100%;
          margin: 0;
          padding: 0;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible !important;
        }

        .cgpt-toolbox-action-grid > * {
          margin: 0 !important;
          padding: 0 !important;
        }

        .cgpt-toolbox-action-grid .cgpt-action-group,
        .cgpt-toolbox-action-grid .cgpt-upload-main-action-row,
        .cgpt-toolbox-action-grid .cgpt-upload-closed-loop-action-row,
        .cgpt-toolbox-action-grid .cgpt-upload-action-row {
          display: contents;
        }

        .cgpt-toolbox-action-grid .cgpt-btn,
        .cgpt-toolbox-action-grid button.cgpt-btn {
          flex: 0 0 auto;
          height: 32px;
          min-height: 32px;
          line-height: 18px;
          padding: 6px 10px;
          margin: 0 !important;
          box-sizing: border-box;
          white-space: nowrap;
        }

        .cgpt-upload-action-toolbar .cgpt-upload-action-row {
          margin-top: 0;
          margin-bottom: 0;
          justify-content: flex-start;
        }

        .cgpt-upload-action-row {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          min-width: 0;
          max-width: 100%;
        }

        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-action-grid .cgpt-upload-closed-loop-action-row,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-upload-closed-loop-action-row {
          display: none !important;
        }

        .cgpt-upload-main-action-row {
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: flex-start;
          align-content: flex-start;
          gap: 8px;
          flex-wrap: wrap !important;
          min-width: 0;
          max-width: 100%;
          width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible !important;
          white-space: normal !important;
          padding-bottom: 0;
        }

        .cgpt-upload-main-action-row .cgpt-btn,
        .cgpt-upload-main-action-row button {
          flex: 0 0 auto;
          white-space: nowrap;
        }

        .cgpt-upload-extra-action-row {
          display: contents !important;
        }

        .cgpt-btn.cgpt-send-btn.cgpt-send-btn-idle,
        #cgpt-send-message-once.cgpt-send-btn-idle,
        #cgpt-send-message-btn.cgpt-send-btn-idle {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-send-btn.cgpt-send-btn-idle:hover:not(:disabled),
        #cgpt-send-message-once.cgpt-send-btn-idle:hover:not(:disabled),
        #cgpt-send-message-btn.cgpt-send-btn-idle:hover:not(:disabled) {
          background: #15803d !important;
        }

        .cgpt-btn.cgpt-send-btn.cgpt-send-btn-busy,
        #cgpt-send-message-once.cgpt-send-btn-busy,
        #cgpt-send-message-btn.cgpt-send-btn-busy {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          cursor: pointer;
          opacity: 1;
        }

        .cgpt-btn.cgpt-send-btn.cgpt-send-btn-busy:hover:not(:disabled),
        #cgpt-send-message-once.cgpt-send-btn-busy:hover:not(:disabled),
        #cgpt-send-message-btn.cgpt-send-btn-busy:hover:not(:disabled) {
          background: #b91c1c !important;
        }

        #cgpt-send-message-once.cgpt-send-btn-idle[disabled],
        #cgpt-send-message-btn.cgpt-send-btn-idle[disabled] {
          opacity: 0.72;
          cursor: not-allowed;
        }

        #cgpt-send-message-once[data-visual-dim="0"],
        #cgpt-send-message-once[data-visual-dim="0"][disabled],
        #cgpt-send-message-once[data-visual-dim="0"][aria-disabled="true"],
        #cgpt-send-message-btn[data-visual-dim="0"],
        #cgpt-send-message-btn[data-visual-dim="0"][disabled],
        #cgpt-send-message-btn[data-visual-dim="0"][aria-disabled="true"],
        button[data-action="send-message"][data-visual-dim="0"],
        button[data-action="send-message"][data-visual-dim="0"][disabled],
        button[data-action="send-message"][data-visual-dim="0"][aria-disabled="true"] {
          opacity: 1 !important;
          filter: none !important;
          cursor: default;
        }

        .cgpt-btn-copy-continue:not(.cgpt-btn-busy),
        #cgpt-upload-continue-once:not(.cgpt-btn-busy),
        #cgpt-upload-continue-once.copy-continue:not(.cgpt-btn-busy) {
          background: #7c3aed !important;
          border-color: #8b5cf6 !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        #cgpt-upload-continue-once:not(.cgpt-btn-busy):hover {
          background: #8b5cf6 !important;
        }

        
        #cgpt-copy-last-message-scroll-bottom {
          --cgpt-btn-bg: linear-gradient(135deg, #2563eb, #4f46e5);
          --cgpt-btn-border: rgba(147, 197, 253, 0.75);
          --cgpt-btn-hover-bg: linear-gradient(135deg, #3b82f6, #6366f1);
          --cgpt-btn-hover-border: rgba(191, 219, 254, 0.95);
          --cgpt-btn-text: #ffffff;
          --cgpt-btn-hover-text: #ffffff;
          background: var(--cgpt-btn-bg) !important;
          border-color: var(--cgpt-btn-border) !important;
          color: var(--cgpt-btn-text) !important;
          pointer-events: auto !important;
          user-select: none !important;
          touch-action: manipulation !important;
        }

        #cgpt-copy-last-message-scroll-bottom[disabled] {
          pointer-events: auto !important;
        }

        #cgpt-copy-last-message-scroll-bottom:hover:not(:disabled) {
          background: var(--cgpt-btn-hover-bg) !important;
          border-color: var(--cgpt-btn-hover-border, var(--cgpt-btn-border)) !important;
          color: var(--cgpt-btn-hover-text, var(--cgpt-btn-text)) !important;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer:hover:not(:disabled),
        #cgpt-copy-last-message-scroll-bottom.waiting:hover:not(:disabled) {
          background: #b45309 !important;
          border-color: #f59e0b !important;
          color: #ffffff !important;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer,
        #cgpt-copy-last-message-scroll-bottom.waiting {
          background: #d97706 !important;
          border-color: #f59e0b !important;
          color: #ffffff !important;
        }

        #cgpt-copy-last-message-scroll-bottom.warning {
          background: #b45309 !important;
          border-color: #f59e0b !important;
          color: #ffffff !important;
        }

        #cgpt-copy-last-message-scroll-bottom.success,
        #cgpt-copy-last-message-scroll-bottom.cgpt-btn-ok {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        .cgpt-btn-copy-continue.cgpt-btn-error,
        #cgpt-copy-last-message-scroll-bottom.cgpt-btn-error {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer:disabled {
          opacity: 1.0;
          cursor: wait;
        }

        #cgpt-copy-last-message-scroll-bottom:disabled {
          opacity: 1 !important;
          cursor: not-allowed;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-copy-last-running,
        #cgpt-copy-last-message-scroll-bottom.cgpt-copy-last-running:hover,
        #cgpt-copy-last-message-scroll-bottom.cgpt-copy-last-running:disabled {
          background: linear-gradient(180deg, #ef4444, #dc2626) !important;
          border-color: #f87171 !important;
          color: #ffffff !important;
          box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.35), 0 0 12px rgba(239, 68, 68, 0.25) !important;
          opacity: 1 !important;
          cursor: wait !important;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-copy-last-running:hover {
          background: linear-gradient(180deg, #f87171, #dc2626) !important;
          border-color: #fecaca !important;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-copy-last-failed,
        #cgpt-copy-last-message-scroll-bottom.cgpt-copy-last-failed:hover {
          background: linear-gradient(180deg, #b91c1c, #991b1b) !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        #cgpt-copy-last-message-scroll-bottom.cgpt-copy-last-success,
        #cgpt-copy-last-message-scroll-bottom.cgpt-copy-last-success:hover {
          background: linear-gradient(180deg, #16a34a, #15803d) !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        .cgpt-btn:disabled {
          opacity: 1 !important;
          cursor: not-allowed;
        }

        .cgpt-input,
        .cgpt-textarea,
        .cgpt-select {
          width: 100%;
          background: #0f1115;
          color: #f8fafc;
          border: 1px solid #374151;
          border-radius: 9px;
          padding: 8px;
          outline: none;
        }

        #${APP.rootId} input[type="number"]::-webkit-outer-spin-button,
        #${APP.rootId} input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        #${APP.rootId} input[type="number"] {
          appearance: textfield;
          -moz-appearance: textfield;
        }

        .cgpt-textarea {
          resize: vertical;
          min-height: 110px;
          font-family: Consolas, "SFMono-Regular", monospace;
        }

        .cgpt-task-editor,
        .cgpt-task-editor textarea,
        .cgpt-task-name-input,
        .cgpt-task-prompt-input,
        .cgpt-autoq-task-panel textarea,
        .cgpt-autoq-task-panel .cgpt-textarea {
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .cgpt-task-editor textarea,
        .cgpt-task-prompt-input,
        .cgpt-autoq-task-panel textarea {
          resize: vertical;
          white-space: pre-wrap;
          word-break: normal;
          overflow-wrap: break-word;
        }

        .cgpt-hint {
          color: #94a3b8;
          font-size: 12px;
          line-height: 1.5;
        }

        .cgpt-grid-4 {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }

        .cgpt-kv {
          display: grid;
          grid-template-columns: 92px 1fr;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
        }

        .cgpt-kv label {
          color: #cbd5e1;
          white-space: nowrap;
        }

        /* 闭环等待设置：不要把输入框固定死 150px，避免自动指令区域显得很窄 */
        #cgpt-autoq-closed-loop-panel .cgpt-kv {
          display: grid !important;
          grid-template-columns: minmax(170px, 220px) minmax(180px, 320px) !important;
          justify-content: start !important;
          gap: 10px !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        }
        #cgpt-autoq-closed-loop-panel .cgpt-kv > input.cgpt-input[type="number"] {
          width: 100% !important;
          max-width: 320px !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        }
        @media (max-width: 620px) {
          #cgpt-autoq-closed-loop-panel .cgpt-kv {
            grid-template-columns: 1fr !important;
          }
          #cgpt-autoq-closed-loop-panel .cgpt-kv > input.cgpt-input[type="number"] {
            width: 100% !important;
            max-width: 100% !important;
          }
        }

        /* 自动指令闭环面板：长文本与继续指令撑满可用宽度 */
        #cgpt-autoq-closed-loop-panel {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        }
        #cgpt-autoq-closed-loop-panel.xz-closedloop-page,
        #cgpt-autoq-closed-loop-panel[data-xz-closedloop-page="1"] {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 0;
        }
        #cgpt-autoq-closed-loop-panel .xz-closedloop-inner-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 4px 0;
          border-bottom: 1px solid rgba(148, 163, 184, 0.22);
        }
        #cgpt-autoq-closed-loop-panel .xz-closedloop-inner-tab {
          height: 28px;
          padding: 0 12px;
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(15, 23, 42, 0.65);
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        #cgpt-autoq-closed-loop-panel .xz-closedloop-inner-tab:hover {
          border-color: rgba(96, 165, 250, 0.8);
          color: #ffffff;
        }
        #cgpt-autoq-closed-loop-panel .xz-closedloop-inner-tab.active {
          background: #2563eb;
          border-color: #60a5fa;
          color: #ffffff;
        }
        #cgpt-autoq-closed-loop-panel .xz-closedloop-panel {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 0;
        }
        #cgpt-autoq-closed-loop-panel .xz-closedloop-panel[hidden] {
          display: none !important;
        }
        #cgpt-autoq-closed-loop-panel .xz-card {
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.52);
          padding: 10px;
        }
        #cgpt-autoq-closed-loop-panel .xz-card-title {
          font-size: 13px;
          font-weight: 700;
          color: #e5e7eb;
          margin-bottom: 8px;
        }
        #cgpt-autoq-closed-loop-panel .xz-card-desc {
          font-size: 12px;
          line-height: 1.6;
          color: #94a3b8;
          margin-bottom: 8px;
        }
        #cgpt-autoq-closed-loop-panel .xz-button-wrap {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        #cgpt-autoq-closed-loop-panel .cgpt-kv:not(.cgpt-kv-vertical) {
          grid-template-columns: 180px minmax(0, 1fr) !important;
          gap: 8px 12px !important;
          align-items: center !important;
        }
        #cgpt-autoq-closed-loop-panel .cgpt-kv > label {
          min-width: 0 !important;
          max-width: 100% !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        #cgpt-autoq-closed-loop-panel .cgpt-kv > input.cgpt-input,
        #cgpt-autoq-closed-loop-panel .cgpt-kv > textarea.cgpt-input {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }
        #cgpt-autoq-closed-loop-panel .cgpt-kv > input.cgpt-input[type="number"] {
          width: 240px !important;
          max-width: 100% !important;
        }
        #cgpt-autoq-closed-loop-panel #cgpt-autoq-unified-continue-home-nav-url,
        #cgpt-autoq-closed-loop-panel #cgpt-autoq-copy-hotkey-continue-stop-signal {
          width: 100% !important;
          max-width: 100% !important;
        }
        #cgpt-autoq-closed-loop-panel .cgpt-kv-vertical {
          grid-template-columns: 1fr !important;
          align-items: stretch !important;
        }
        #cgpt-autoq-closed-loop-panel .cgpt-kv-vertical > label {
          width: 100% !important;
          max-width: 100% !important;
          white-space: nowrap !important;
        }
        #cgpt-autoq-closed-loop-panel .cgpt-kv-vertical > textarea.cgpt-input {
          width: 100% !important;
          max-width: 100% !important;
          min-height: 180px !important;
          resize: vertical !important;
        }
        @media (max-width: 700px) {
          #cgpt-autoq-closed-loop-panel .cgpt-kv:not(.cgpt-kv-vertical) {
            grid-template-columns: 1fr !important;
          }
          #cgpt-autoq-closed-loop-panel .cgpt-kv > input.cgpt-input[type="number"] {
            width: 100% !important;
          }
        }

        /* 设置页：自动指令相关设置项使用更合理的宽度 */
        #cgpt-settings-module [data-settings-panel="continue-task"] {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        }
        #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv {
          display: grid !important;
          grid-template-columns: 180px minmax(0, 1fr) !important;
          gap: 8px 12px !important;
          align-items: center !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        }
        #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv > label {
          min-width: 0 !important;
          max-width: 100% !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv > input.cgpt-input,
        #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv > textarea.cgpt-input {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }
        /* 数字输入框不要再窄到 150px，但也不必铺满整行 */
        #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv > input.cgpt-input[type="number"] {
          width: 240px !important;
          max-width: 100% !important;
        }
        /* URL、终止信号这类长文本必须撑满右侧空间 */
        #cgpt-settings-module [data-settings-panel="continue-task"] #cgpt-setting-unified-continue-home-nav-url,
        #cgpt-settings-module [data-settings-panel="continue-task"] #cgpt-setting-copy-hotkey-continue-stop-signal {
          width: 100% !important;
          max-width: 100% !important;
        }
        /* 继续指令 textarea 改成上下结构，避免只占右侧一小列 */
        #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv-vertical {
          grid-template-columns: 1fr !important;
          align-items: stretch !important;
        }
        #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv-vertical > label {
          width: 100% !important;
          max-width: 100% !important;
          white-space: nowrap !important;
        }
        #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv-vertical > textarea.cgpt-input {
          width: 100% !important;
          max-width: 100% !important;
          min-height: 180px !important;
          resize: vertical !important;
        }
        @media (max-width: 700px) {
          #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv {
            grid-template-columns: 1fr !important;
          }
          #cgpt-settings-module [data-settings-panel="continue-task"] .cgpt-kv > input.cgpt-input[type="number"] {
            width: 100% !important;
          }
        }

        .cgpt-checkbox-line {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #cbd5e1;
        }

        .cgpt-checkbox-line input {
          width: 16px;
          height: 16px;
          accent-color: #60a5fa;
        }

        .cgpt-upload-groups-head {
          margin-bottom: 8px;
        }

        .cgpt-upload-group-bar {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 6px;
          align-items: center;
        }

        .cgpt-upload-group-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible;
          padding-bottom: 0;
        }

        .cgpt-chip-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-chip-count {
          margin-left: 4px;
          font-weight: 700;
          opacity: 0.95;
          flex: 0 0 auto;
        }

        .cgpt-upload-group-chip {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          flex: 0 1 auto;
          min-width: 0;
          height: 28px;
          padding: 0 10px;
          border: 1px solid #2563eb;
          background: #0f172a;
          color: #bfdbfe;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
          max-width: 140px;
          overflow: hidden;
          opacity: 1;
        }

        .cgpt-upload-group-chip:hover {
          background: #1d4ed8;
          border-color: #60a5fa;
          color: #ffffff;
        }

        .cgpt-upload-group-chip.active {
          background: #1d4ed8;
          border-color: #93c5fd;
          color: #ffffff;
          font-weight: 700;
          box-shadow: inset 0 0 0 1px rgba(191, 219, 254, 0.18);
        }

        .toolbox-upload-drop-zone.is-drag-over,
        .toolbox-upload-file-list.is-drag-over,
        .toolbox-upload-empty-state.is-drag-over,
        #cgpt-upload-module.is-drag-over,
        #cgpt-upload-module.cgpt-upload-dragging {
          outline: 1px dashed #60a5fa;
          outline-offset: -4px;
        }

        .toolbox-upload-drop-over-hint {
          display: none;
          color: #93c5fd;
        }

        .toolbox-upload-drop-zone.is-drag-over .toolbox-upload-drop-over-hint,
        .toolbox-upload-file-list.is-drag-over .toolbox-upload-drop-over-hint,
        .toolbox-upload-empty-state.is-drag-over .toolbox-upload-drop-over-hint,
        #cgpt-upload-module.is-drag-over .toolbox-upload-drop-over-hint {
          display: block;
        }

        .toolbox-upload-drop-zone.is-drag-over .toolbox-upload-empty-state .toolbox-upload-drop-hint,
        .toolbox-upload-file-list.is-drag-over .toolbox-upload-empty-state .toolbox-upload-drop-hint,
        #cgpt-upload-module.is-drag-over .toolbox-upload-empty-state .toolbox-upload-drop-hint {
          display: none;
        }

        #${APP.panelId}.cgpt-toolbox-file-dragover {
          border-color: #60a5fa;
          box-shadow:
            0 0 0 2px rgba(96, 165, 250, 0.45),
            0 14px 36px rgba(0,0,0,0.42);
        }

        #${APP.panelId}.cgpt-toolbox-file-dragover .cgpt-toolbox-content {
          background: rgba(59, 130, 246, 0.06);
        }

        .cgpt-upload-list {
          max-height: 260px;
          overflow-y: auto;
          overflow-x: hidden;
          border: 1px solid #2f3542;
          border-radius: 12px;
          background: #0f1115;
          margin-top: 8px;
        }

        .cgpt-upload-list + .cgpt-upload-quick-prompts {
          margin-top: 12px;
        }

        .cgpt-upload-item {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          padding: 6px 8px;
          border-bottom: 1px solid #202633;
          cursor: pointer;
          align-items: center;
        }

        .cgpt-upload-item:last-child {
          border-bottom: none;
        }

        .cgpt-upload-item:hover {
          background: #172033;
        }

        .cgpt-upload-item.active {
          border-left: 3px solid #3b82f6;
          background: #111f36;
        }

        .cgpt-upload-item.cached-snapshot {
          background: rgba(239, 68, 68, 0.10);
          border-left: 3px solid rgba(248, 113, 113, 0.75);
        }

        .cgpt-upload-item.cached-snapshot:hover {
          background: rgba(239, 68, 68, 0.16);
        }

        .cgpt-upload-item.cached-snapshot.active {
          background: rgba(239, 68, 68, 0.18);
          border-left-color: #f87171;
        }

        .cgpt-upload-item.local-readable {
          background: rgba(34, 197, 94, 0.10);
          border-left: 3px solid rgba(34, 197, 94, 0.75);
        }

        .cgpt-upload-item.local-readable:hover {
          background: rgba(34, 197, 94, 0.16);
        }

        .cgpt-upload-item.local-readable.active {
          background: rgba(34, 197, 94, 0.20);
          border-left-color: #22c55e;
        }

        .cgpt-upload-item.local-attached {
          background: rgba(20, 184, 166, 0.12);
          border-left: 3px solid rgba(20, 184, 166, 0.80);
        }

        .cgpt-upload-item.local-attached:hover {
          background: rgba(20, 184, 166, 0.18);
        }

        .cgpt-upload-item.local-attached.active {
          background: rgba(20, 184, 166, 0.22);
          border-left-color: #14b8a6;
        }

        .cgpt-upload-item.local-unreadable {
          background: rgba(239, 68, 68, 0.10);
          border-left: 3px solid rgba(248, 113, 113, 0.75);
        }

        .cgpt-upload-item.local-unreadable:hover {
          background: rgba(239, 68, 68, 0.16);
        }

        .cgpt-upload-item.local-unreadable.active {
          background: rgba(239, 68, 68, 0.20);
          border-left-color: #f87171;
        }

        .cgpt-upload-item.permission-required {
          background: rgba(245, 158, 11, 0.12);
          border-left: 3px solid rgba(245, 158, 11, 0.80);
        }

        .cgpt-upload-item.permission-required:hover {
          background: rgba(245, 158, 11, 0.18);
        }

        .cgpt-upload-item.permission-required.active {
          background: rgba(245, 158, 11, 0.22);
          border-left-color: #f59e0b;
        }

        .cgpt-upload-item.uploading {
          background: rgba(59, 130, 246, 0.12);
          border-left: 3px solid rgba(96, 165, 250, 0.80);
        }

        .cgpt-upload-item.uploading:hover {
          background: rgba(59, 130, 246, 0.18);
        }

        .cgpt-upload-item.uploading.active {
          background: rgba(59, 130, 246, 0.22);
          border-left-color: #60a5fa;
        }

        .cgpt-upload-source-label.status-local-readable,
        .cgpt-upload-source-label.status-local-attached {
          color: #bbf7d0;
          font-weight: 700;
        }

        .cgpt-upload-source-label.status-local-unreadable {
          color: #fecaca;
          font-weight: 700;
        }

        .cgpt-upload-source-label.status-permission-required {
          color: #fde68a;
          font-weight: 700;
        }

        .cgpt-upload-source-label.status-uploading {
          color: #bfdbfe;
          font-weight: 700;
        }

        .cgpt-upload-source-label.cached-source {
          color: #fecaca;
          font-weight: 700;
        }

        .cgpt-upload-file-rebind {
          margin-left: 8px;
          border: 1px solid rgba(248, 113, 113, 0.75);
          background: rgba(127, 29, 29, 0.28);
          color: #fee2e2;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 11px;
          line-height: 1.4;
          cursor: pointer;
        }

        .cgpt-upload-file-rebind:hover {
          background: rgba(185, 28, 28, 0.42);
          border-color: #fca5a5;
        }

        .cgpt-upload-item.empty {
          cursor: default;
        }

        .cgpt-upload-item.empty:hover {
          background: transparent;
        }

        .cgpt-upload-name {
          font-weight: 650;
          color: #f8fafc;
          word-break: break-all;
          font-size: 12px;
        }

        .cgpt-upload-meta {
          color: #94a3b8;
          margin-top: 2px;
          font-size: 11px;
        }

        .cgpt-upload-dot {
          margin: 0 4px;
        }

        .cgpt-upload-actions-cell {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
        }

        .cgpt-upload-file-remove {
          width: 22px;
          height: 22px;
          border: 1px solid #ef4444;
          background: #111827;
          color: #fecaca;
          border-radius: 999px;
          cursor: pointer;
          line-height: 18px;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .cgpt-upload-file-remove:hover {
          background: #991b1b;
          color: #ffffff;
        }

        .cgpt-upload-manage-panel {
          margin-top: 8px;
          padding: 8px;
          border: 1px solid #334155;
          border-radius: 10px;
          background: #10151f;
          max-height: 260px;
          overflow-y: auto;
        }

        .cgpt-upload-manage-title {
          font-weight: 700;
          color: #f8fafc;
          margin-bottom: 8px;
        }

        .cgpt-upload-manage-layout {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 8px;
          min-width: 0;
        }

        .cgpt-upload-manage-left,
        .cgpt-upload-manage-right {
          min-width: 0;
        }

        .cgpt-upload-manage-subtitle {
          font-size: 11px;
          color: #94a3b8;
          margin-bottom: 6px;
        }

        .cgpt-upload-manage-subtitle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 6px;
        }

        .cgpt-upload-manage-subtitle-row .cgpt-toolbox-small-btn {
          height: 24px;
          padding: 0 8px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .cgpt-upload-manage-group-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 180px;
          overflow-y: auto;
          border: 1px solid #2f3542;
          border-radius: 9px;
          background: #0f1115;
          padding: 6px;
        }

        .cgpt-upload-manage-group-item {
          width: 100%;
          min-height: 30px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 6px;
          align-items: center;
          border: 1px solid #374151;
          background: #171b22;
          color: #d1d5db;
          border-radius: 8px;
          padding: 0 8px;
          cursor: pointer;
          text-align: left;
        }

        .cgpt-upload-manage-group-item:hover {
          background: #202633;
        }

        .cgpt-upload-manage-group-item.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 650;
        }

        .cgpt-upload-manage-group-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-upload-manage-group-count {
          color: #cbd5e1;
          font-size: 11px;
          white-space: nowrap;
        }

        .cgpt-upload-manage-empty {
          color: #94a3b8;
          text-align: center;
          padding: 12px 0;
        }

        @media (max-width: 620px) {
          .cgpt-upload-manage-layout {
            grid-template-columns: 1fr;
          }

          .cgpt-upload-manage-group-list {
            max-height: 140px;
          }
        }

        .cgpt-upload-manage-row {
          display: flex;
          gap: 6px;
          align-items: center;
          margin-bottom: 8px;
        }

        .cgpt-upload-manage-row .cgpt-input {
          flex: 1 1 auto;
          min-width: 0;
        }

        .cgpt-upload-manage-row .cgpt-toolbox-small-btn {
          white-space: nowrap;
          flex-shrink: 0;
        }

        #cgpt-upload-group-rename-inline {
          min-width: 76px;
          flex: 0 0 76px;
          white-space: nowrap;
        }

        .cgpt-upload-common-settings {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid #334155;
        }

        .cgpt-upload-common-settings .cgpt-checkbox-line {
          margin-top: 6px;
        }

        .cgpt-upload-common-settings .cgpt-hint {
          margin-top: 6px;
        }

        #cgpt-autoq-module .cgpt-autoq-section {
          padding-top: 8px !important;
        }

        #cgpt-autoq-module .cgpt-autoq-mode-tabs {
          margin-top: 0 !important;
        }

        .cgpt-autoq-mode-tabs,
        .cgpt-mode-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          margin-bottom: 10px;
        }

        .cgpt-autoq-mode-tabs button,
        .cgpt-autoq-mode-tab,
        .cgpt-mode-tabs button {
          flex: 0 0 auto;
          min-height: 30px;
          white-space: nowrap;
        }

        .cgpt-autoq-mode-tab {
          flex: 0 0 auto;
          min-width: 58px;
          width: auto;
          padding: 0 8px;
          height: 28px;
          min-height: 28px;
          font-size: 12px;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border: 1px solid #475569;
          border-radius: 9px;
          background: #1f2937;
          color: #d1d5db;
          cursor: pointer;
          font-weight: 650;
        }

        .cgpt-autoq-mode-tab:hover {
          background: #202633;
        }

        .cgpt-autoq-mode-tab.active {
          border-color: #3b82f6;
          background: #1d4ed8;
          color: #fff;
        }

        .cgpt-autoq-list-header {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
        }

        .cgpt-autoq-list-name-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 8px;
          align-items: center;
          margin-top: 8px;
        }

        #cgpt-autoq-list-save-name,
        #cgpt-autoq-list-delete,
        #cgpt-autoq-list-new {
          min-width: 76px;
          white-space: nowrap;
        }

        .cgpt-autoq-label {
          display: block;
          margin-bottom: 6px;
          color: #cbd5e1;
          font-size: 12px;
          font-weight: 650;
        }

        .cgpt-autoq-editor-block #cgpt-autoq-prompts,
        .cgpt-command-textarea,
        textarea[data-role="command-content"] {
          width: 100%;
          min-height: 120px;
          height: clamp(120px, 24vh, 260px);
          max-height: 320px;
          overflow: auto;
          resize: vertical;
          box-sizing: border-box;
          line-height: 1.5;
          white-space: pre-wrap;
        }

        .cgpt-autoq-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
          margin-top: 10px;
          position: relative;
          z-index: 3;
          pointer-events: auto !important;
        }

        .cgpt-autoq-actions button {
          position: relative;
          z-index: 3;
          pointer-events: auto !important;
        }

        #cgpt-autoq-start-upload,
        #cgpt-autoq-send-once {
          pointer-events: auto !important;
        }

        .cgpt-autoq-top-action-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin: 10px 0 8px 0;
          padding: 8px;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.45);
        }

        .cgpt-autoq-top-action-bar button {
          min-height: 30px;
          padding: 5px 12px;
        }

        .cgpt-autoq-bottom-action-bar,
        .cgpt-autoq-footer-action-bar,
        .cgpt-autoq-batch-actions-slot .cgpt-autoq-actions {
          position: static;
          bottom: auto;
        }

        #cgpt-autoq-start {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        #cgpt-autoq-start.cgpt-btn-busy,
        #cgpt-autoq-start[aria-busy="true"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        #cgpt-autoq-start:disabled {
          opacity: 1 !important;
          cursor: not-allowed;
        }

        #cgpt-autoq-start {
          pointer-events: auto !important;
        }

        .cgpt-autoq-settings-grid,
        .cgpt-settings-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(220px, 1fr));
          gap: 10px 16px;
          align-items: center;
        }

        .cgpt-autoq-settings-grid input:not([type="checkbox"]),
        .cgpt-settings-grid input:not([type="checkbox"]) {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        @media (max-width: 860px) {
          .cgpt-autoq-settings-grid,
          .cgpt-settings-grid {
            grid-template-columns: 1fr;
          }
        }

        .cgpt-autoq-settings-grid .cgpt-kv {
          grid-template-columns: 110px 1fr;
          margin-top: 0;
        }

        .cgpt-quota-limit-grid,
        .cgpt-beep-param-grid {
          margin-top: 8px;
        }

        .cgpt-quota-limit-grid .cgpt-kv,
        .cgpt-beep-param-grid .cgpt-kv {
          grid-template-columns: 126px minmax(0, 1fr);
          margin-top: 0;
          min-width: 0;
        }

        .cgpt-quota-limit-grid .cgpt-kv label,
        .cgpt-beep-param-grid .cgpt-kv label {
          min-width: 0;
          white-space: nowrap;
        }

        .cgpt-quota-limit-grid .cgpt-kv .cgpt-input,
        .cgpt-beep-param-grid .cgpt-kv .cgpt-input {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        .cgpt-autoq-exec-settings {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 10px 14px !important;
          align-items: start !important;
          min-width: 0 !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
        }

        .cgpt-autoq-exec-settings,
        .cgpt-autoq-exec-settings * {
          box-sizing: border-box !important;
        }

        .cgpt-setting-field {
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
          min-width: 0 !important;
          max-width: 100% !important;
        }

        .cgpt-setting-label {
          display: block !important;
          width: auto !important;
          min-width: 0 !important;
          max-width: 100% !important;
          font-size: 12px !important;
          line-height: 1.4 !important;
          color: #dbeafe !important;
          white-space: normal !important;
          word-break: normal !important;
          overflow-wrap: anywhere !important;
          writing-mode: horizontal-tb !important;
          text-orientation: mixed !important;
        }

        .cgpt-setting-input,
        .cgpt-setting-field input:not([type="checkbox"]),
        .cgpt-setting-field select,
        .cgpt-setting-field textarea {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          height: 34px !important;
          padding: 6px 10px !important;
          border-radius: 8px !important;
          border: 1px solid rgba(148, 163, 184, 0.35) !important;
          background: #0f172a !important;
          color: #e5e7eb !important;
          outline: none !important;
        }

        .cgpt-setting-input:focus,
        .cgpt-setting-field input:not([type="checkbox"]):focus,
        .cgpt-setting-field select:focus,
        .cgpt-setting-field textarea:focus {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.45) !important;
        }

        .cgpt-setting-check {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: flex-start !important;
          gap: 8px !important;
          min-width: 0 !important;
          max-width: 100% !important;
          width: auto !important;
          padding: 6px 8px !important;
          border-radius: 8px !important;
          color: #e5e7eb !important;
          line-height: 1.4 !important;
          white-space: normal !important;
          word-break: normal !important;
          overflow-wrap: anywhere !important;
          background: transparent !important;
          cursor: pointer !important;
          writing-mode: horizontal-tb !important;
          text-orientation: mixed !important;
        }

        .cgpt-setting-check:hover {
          background: rgba(30, 41, 59, 0.85) !important;
        }

        .cgpt-setting-checkbox,
        .cgpt-setting-check input[type="checkbox"] {
          flex: 0 0 auto !important;
          width: 16px !important;
          height: 16px !important;
          min-width: 16px !important;
          max-width: 16px !important;
          margin: 0 !important;
          padding: 0 !important;
          accent-color: #2563eb !important;
          appearance: auto !important;
        }

        .cgpt-setting-check-text {
          display: inline-block !important;
          min-width: 0 !important;
          max-width: 100% !important;
          white-space: normal !important;
          word-break: normal !important;
          overflow-wrap: anywhere !important;
          writing-mode: horizontal-tb !important;
          text-orientation: mixed !important;
        }

        .cgpt-autoq-status-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 3px 6px;
          color: #e5e7eb;
          font-size: 11px;
          line-height: 1.2;
          align-items: center;
        }

        .cgpt-autoq-status-panel,
        .cgpt-status-card,
        .cgpt-batch-status-card,
        .cgpt-autoq-status-card,
        .cgpt-task-status-card {
          border: 1px solid #2f3542;
          background: #111827;
          border-radius: 8px;
          padding: 10px;
          color: #e5e7eb;
          font-size: 11px;
          line-height: 1.45;
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          max-height: none;
          overflow: visible;
          overflow-x: hidden;
          overflow-y: visible;
        }

        .cgpt-autoq-status-section {
          padding: 0;
          border-bottom: 0;
        }

        .cgpt-autoq-status-section-title {
          display: none;
        }

        .cgpt-autoq-status-item {
          min-width: 0;
          min-height: 18px;
          display: flex;
          align-items: flex-start;
          gap: 4px;
          overflow: visible;
          white-space: normal;
        }

        .cgpt-autoq-status-item.wide {
          grid-column: span 2;
        }

        .cgpt-autoq-status-item.full {
          grid-column: 1 / -1;
        }

        .cgpt-autoq-status-label {
          flex: 0 0 auto;
          color: #e5e7eb;
          font-weight: 650;
          white-space: nowrap;
        }

        .cgpt-autoq-status-label::after {
          content: "：";
          color: #e5e7eb;
        }

        .cgpt-autoq-status-value,
        .cgpt-status-value,
        .cgpt-batch-status-value,
        .cgpt-task-status-value {
          min-width: 0;
          color: #ffffff;
          font-weight: 650;
          overflow-wrap: break-word;
          word-break: normal;
          white-space: normal;
          writing-mode: horizontal-tb;
        }

        .cgpt-autoq-status-value.is-ok {
          color: #22c55e;
        }

        .cgpt-autoq-status-value.is-warn {
          color: #f59e0b;
        }

        .cgpt-autoq-status-value.is-error {
          color: #ef4444;
        }

        .cgpt-autoq-status-value.is-muted {
          color: #94a3b8;
          font-weight: 500;
        }

        .cgpt-autoq-status-note {
          color: #94a3b8;
          font-size: 12px;
          line-height: 1.45;
        }

        .cgpt-autoq-status-recent {
          margin-top: 6px;
          color: #94a3b8;
          font-size: 11px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .xz-autoq-advanced-debug-panel {
          margin-top: 8px;
          border: 1px solid rgba(80, 140, 255, 0.45);
          border-radius: 8px;
          background: rgba(6, 12, 24, 0.92);
          padding: 8px;
        }

        .xz-autoq-advanced-debug-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
          color: #dbeafe;
          font-size: 12px;
          font-weight: 650;
        }

        .xz-autoq-advanced-debug-header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .xz-autoq-advanced-debug-content {
          max-height: 360px;
          overflow: auto;
          font-size: 12px;
          line-height: 1.45;
          color: #e5e7eb;
          padding: 2px 0;
        }

        .xz-autoq-advanced-debug-meta {
          color: #94a3b8;
          font-size: 11px;
          margin-bottom: 6px;
        }

        .xz-autoq-advanced-debug-toggle-btn,
        #xz-autoq-advanced-debug-toggle-btn {
          min-width: 96px;
          white-space: nowrap;
        }

        #cgpt-autoq-status-panel-content,
        .cgpt-autoq-status-panel-content {
          display: flex;
          flex-direction: column;
          gap: 6px;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        .cgpt-autoq-user-summary,
        .cgpt-batch-status-card,
        .cgpt-autoq-status-card {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 8px;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        .cgpt-autoq-status-row,
        .cgpt-status-row,
        .cgpt-batch-status-row,
        .cgpt-task-status-row {
          box-sizing: border-box;
          display: grid;
          grid-template-columns: 92px minmax(0, 1fr);
          column-gap: 8px;
          row-gap: 6px;
          align-items: start;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          margin-bottom: 6px;
          font-size: 13px;
          line-height: 1.5;
        }

        .cgpt-autoq-status-row .cgpt-autoq-status-label,
        .cgpt-status-label,
        .cgpt-batch-status-label,
        .cgpt-task-status-label {
          box-sizing: border-box;
          width: 92px;
          min-width: 92px;
          max-width: 92px;
          flex: 0 0 92px;
          white-space: nowrap;
          text-align: right;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #93a4bd;
        }

        .cgpt-autoq-status-row .cgpt-autoq-status-value,
        .cgpt-status-row .cgpt-status-value,
        .cgpt-batch-status-row .cgpt-batch-status-value,
        .cgpt-task-status-row .cgpt-task-status-value {
          box-sizing: border-box;
          min-width: 0;
          width: 100%;
          max-width: 100%;
          color: #e5e7eb;
          white-space: normal;
          word-break: normal;
          overflow-wrap: break-word;
          writing-mode: horizontal-tb;
          text-align: left;
        }

        .cgpt-status-advice,
        .cgpt-autoq-user-hint-row .cgpt-autoq-status-value,
        .cgpt-autoq-user-hint-row .cgpt-autoq-user-hint {
          max-height: none;
          overflow: visible;
          overflow-y: visible;
          white-space: pre-wrap;
          overflow-wrap: break-word;
          word-break: normal;
          line-height: 1.45;
        }

        .cgpt-autoq-user-hint-row {
          color: #fde68a;
        }

        .cgpt-status-card[data-state="idle"] .cgpt-autoq-user-hint-row,
        .cgpt-status-card[data-state="idle"] .cgpt-autoq-user-hint-row .cgpt-autoq-status-value,
        .cgpt-status-card[data-state="idle"] .cgpt-autoq-user-hint {
          color: #cbd5e1;
          font-weight: 500;
        }

        .cgpt-status-card[data-severity="warning"] .cgpt-autoq-user-hint-row,
        .cgpt-status-card[data-severity="warning"] .cgpt-autoq-user-hint-row .cgpt-autoq-status-value,
        .cgpt-status-card[data-severity="warning"] .cgpt-autoq-user-hint,
        .cgpt-status-card[data-state="stopped"] .cgpt-autoq-user-hint-row,
        .cgpt-status-card[data-state="stopped"] .cgpt-autoq-user-hint-row .cgpt-autoq-status-value,
        .cgpt-status-card[data-state="stopped"] .cgpt-autoq-user-hint {
          color: #facc15;
          font-weight: 700;
        }

        .cgpt-autoq-user-hint-row .cgpt-autoq-status-value,
        .cgpt-autoq-user-hint {
          color: #fde68a;
          font-weight: 600;
        }

        .cgpt-current-task-row,
        .cgpt-current-task-meta-row {
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .cgpt-current-task-value,
        .cgpt-current-task-meta-value {
          min-width: 0;
          width: 100%;
          max-width: 100%;
          white-space: normal;
          word-break: normal;
          overflow-wrap: break-word;
          line-height: 1.45;
        }

        .cgpt-current-task-value {
          font-weight: 700;
          color: #e5f0ff;
        }

        .cgpt-current-task-meta-value {
          font-size: 12px;
          opacity: 0.9;
          color: #aeb9cc;
        }

        .cgpt-task-edit-mismatch-hint {
          margin-top: 6px;
          padding: 6px 8px;
          border: 1px solid rgba(245, 158, 11, 0.55);
          border-radius: 6px;
          background: rgba(245, 158, 11, 0.12);
          color: #facc15;
          font-size: 12px;
          line-height: 1.45;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-top-badge-task,
        #${APP.panelId} .cgpt-toolbox-header-status-row #cgpt-top-current-task-badge {
          background: #1d4ed8;
          color: #ffffff;
          border: 1px solid rgba(147, 197, 253, 0.65);
        }

        .cgpt-autoq-debug-detail-grid {
          grid-column: 1 / -1;
          width: 100%;
          max-width: 100%;
          min-width: 0;
        }

        .cgpt-autoq-failure-row .cgpt-autoq-status-value {
          color: #fca5a5;
        }

        .cgpt-autoq-debug-detail-grid {
          margin-top: 4px;
        }

        .xz-autoq-debug-section {
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 8px;
          padding: 8px 10px;
          margin-top: 8px;
          background: rgba(15, 23, 42, 0.55);
        }

        .xz-autoq-debug-section-title {
          font-weight: 700;
          color: #bfdbfe;
          margin-bottom: 6px;
        }

        .xz-autoq-debug-section-body {
          display: grid;
          grid-template-columns: minmax(120px, 180px) minmax(0, 1fr);
          row-gap: 4px;
          column-gap: 8px;
        }

        .xz-autoq-debug-row {
          display: contents;
        }

        .xz-autoq-debug-key {
          color: #cbd5e1;
          white-space: nowrap;
        }

        .xz-autoq-debug-value {
          color: #e5e7eb;
          word-break: break-all;
        }

        .xz-autoq-debug-raw {
          margin-top: 8px;
        }

        .xz-autoq-debug-raw pre {
          max-height: 180px;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-all;
          font-size: 12px;
          font-family: Consolas, Monaco, monospace;
          color: #dbeafe;
          background: rgba(0, 0, 0, 0.25);
          border-radius: 6px;
          padding: 8px;
          margin: 4px 0 0;
        }

        #xz-autoq-advanced-debug-toggle-btn.active,
        .xz-autoq-advanced-debug-toggle-btn.active {
          border-color: #facc15;
          color: #facc15;
          background: rgba(250, 204, 21, 0.08);
        }

        .cgpt-log-line {
          overflow-wrap: anywhere;
        }

        .cgpt-autoq-log {
          margin-top: 8px;
          max-height: min(360px, 45vh);
          min-height: 60px;
          overflow: auto;
          overflow-wrap: anywhere;
          border: 1px solid #2f3542;
          border-radius: 10px;
          background: #0f1115;
          padding: 8px;
          font-family: Consolas, "SFMono-Regular", monospace;
          font-size: 11px;
          white-space: pre-wrap;
          line-height: 1.45;
        }

        @media (max-width: 620px) {
          .cgpt-autoq-settings-grid {
            grid-template-columns: 1fr;
          }

          .cgpt-autoq-status-grid,
          .cgpt-autoq-main-lite-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .cgpt-autoq-status-item.wide,
          .cgpt-autoq-status-item.full {
            grid-column: 1 / -1;
          }
        }

        .cgpt-autoq-list-select-row {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }

        .cgpt-autoq-list-select-row .cgpt-autoq-label {
          margin: 0;
          white-space: nowrap;
        }

        .cgpt-autoq-list-select {
          width: 100%;
          min-width: 0;
        }

        .cgpt-autoq-list-current-name {
          min-width: 0;
          color: #e5e7eb;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-autoq-list-profile-chips {
          flex: 1 1 auto;
          display: flex;
          gap: 6px;
          overflow-x: auto;
          padding-bottom: 2px;
        }

        .cgpt-autoq-list-chip {
          height: 28px;
          padding: 0 10px;
          border: 1px solid #475569;
          background: #171b22;
          color: #d1d5db;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-autoq-list-chip:hover {
          background: #202633;
        }

        .cgpt-autoq-list-chip.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 650;
        }

        #cgpt-autoq-list-name {
          min-width: 0;
        }

        .cgpt-autoq-main-lite {
          margin: 5px 0 6px;
          padding: 6px 8px;
          border: 1px solid #2f3542;
          border-radius: 8px;
          background: #111827;
          box-sizing: border-box;
          max-height: none;
          overflow: visible;
          overflow-y: visible;
          overflow-x: hidden;
        }

        .cgpt-autoq-main-lite > .cgpt-autoq-status-panel {
          margin: 0;
          padding: 0;
          border: 0;
          background: transparent;
        }

        .cgpt-autoq-main-lite > .cgpt-autoq-status-grid,
        .cgpt-autoq-main-lite > .cgpt-autoq-status-panel-content {
          margin: 0;
          padding: 0;
        }

        .cgpt-autoq-main-lite-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .cgpt-autoq-main-lite > .cgpt-autoq-status-panel-content {
          border: 0;
          background: transparent;
          max-height: none;
        }

        .cgpt-autoq-runtime-stats-line {
          margin-top: 3px;
          padding-top: 3px;
          border-top: 1px dashed rgba(51, 65, 85, 0.65);
          font-size: 11px;
          line-height: 1.2;
          color: #e5e7eb;
          word-break: break-word;
          white-space: normal;
        }

        .cgpt-autoq-runtime-stats-line + .cgpt-autoq-runtime-stats-line {
          margin-top: 2px;
          padding-top: 0;
          border-top: 0;
        }

        .cgpt-autoq-runtime-stats-phase {
          display: none !important;
        }

        .cgpt-autoq-task-panel {
          margin-top: 8px;
        }

        .cgpt-autoq-batch-subtabs {
          display: inline-flex;
          width: fit-content;
          max-width: 100%;
          flex-wrap: wrap;
          align-items: center;
          justify-content: flex-start;
          gap: 6px;
          margin: 6px 0;
          padding: 3px;
          border: 1px solid #2f3542;
          background: #111827;
          border-radius: 9px;
        }

        .cgpt-autoq-batch-subtab {
          flex: 0 0 auto;
          width: auto;
          min-width: 72px;
          height: 28px;
          min-height: 28px;
          padding: 0 12px;
          border: 1px solid #334155;
          background: #171b22;
          color: #cbd5e1;
          border-radius: 7px;
          cursor: pointer;
          font-size: 12px;
          line-height: 26px;
          white-space: nowrap;
          text-align: center;
        }

        .cgpt-autoq-batch-subtab:hover {
          background: #202633;
        }

        .cgpt-autoq-batch-subtab.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 700;
        }

        .cgpt-autoq-batch-subtab-content {
          min-height: 260px;
          max-height: none;
          margin-top: 8px;
          overflow: visible;
        }

        .cgpt-autoq-batch-subtab-content > [data-batch-tab-panel] {
          min-height: 160px;
        }

        .cgpt-autoq-batch-tab-panel-scroll {
          overflow: visible;
          padding-right: 2px;
        }

        .cgpt-autoq-batch-settings-slot .cgpt-autoq-settings-section {
          margin: 0;
          padding: 0;
          border: none;
          background: transparent;
        }

        .cgpt-autoq-batch-settings-slot .cgpt-section-title {
          margin-top: 0;
        }

        .cgpt-autoq-task-list-toolbar-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          justify-content: flex-end;
        }

        .cgpt-autoq-batch-rules-continue {
          min-height: 110px;
          max-height: 140px;
          resize: vertical;
        }

        .cgpt-autoq-batch-rules-preview {
          min-height: 130px;
          max-height: 160px;
        }

        .cgpt-autoq-task-profile-defaults-grid .cgpt-autoq-batch-rules-inline-row {
          grid-column: span 1;
        }

        .cgpt-autoq-task-initial-field {
          min-height: 160px;
          max-height: 220px;
          resize: vertical;
        }

        .cgpt-autoq-task-list-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin: 8px 0;
        }

        .cgpt-autoq-task-list,
        .cgpt-task-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: min(260px, 32vh);
          overflow-y: auto;
          overflow-x: hidden;
          border: 1px solid #2f3542;
          border-radius: 10px;
          padding: 6px;
          background: #0f1115;
          container-type: inline-size;
          container-name: autoq-task-list;
        }

        .cgpt-autoq-task-item {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) auto !important;
          align-items: center !important;
          column-gap: 10px !important;
          row-gap: 4px !important;
          padding: 6px 8px !important;
          margin: 0 0 6px 0 !important;
          border: 1px solid #243041;
          border-radius: 8px;
          background: #171b22;
          cursor: pointer;
        }

        .cgpt-autoq-task-item.active {
          border-color: #3b82f6;
          box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.35);
        }

        .cgpt-autoq-task-item-main,
        .cgpt-autoq-task-item-main-inline {
          min-width: 0 !important;
          width: 100% !important;
          overflow: hidden !important;
        }

        .cgpt-autoq-task-item-title {
          display: block !important;
          width: 100% !important;
          min-width: 0 !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
          font-weight: 700 !important;
          color: #e5e7eb !important;
        }

        .cgpt-autoq-task-item-meta,
        .cgpt-autoq-task-item-source,
        .cgpt-autoq-task-item-category {
          display: none !important;
        }

        .cgpt-autoq-task-item-actions,
        .cgpt-task-row-actions {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: flex-end !important;
          gap: 4px !important;
          flex-wrap: wrap !important;
          min-width: 0 !important;
          max-width: 100% !important;
        }

        @container autoq-task-list (max-width: 520px) {
          .cgpt-autoq-task-item {
            grid-template-columns: minmax(0, 1fr) !important;
            align-items: start !important;
            column-gap: 0 !important;
            padding: 7px 8px !important;
          }

          .cgpt-autoq-task-item-actions {
            justify-content: flex-start !important;
            flex-wrap: wrap !important;
            min-width: 0 !important;
            width: 100% !important;
          }

          .cgpt-autoq-task-item-title {
            white-space: normal !important;
            overflow: visible !important;
            text-overflow: clip !important;
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
          }
        }

        @container autoq-task-list (max-width: 360px) {
          .cgpt-autoq-task-item {
            padding: 8px 9px !important;
          }

          .cgpt-autoq-task-item-title {
            font-size: 14px !important;
            line-height: 1.4 !important;
          }
        }

        .cgpt-autoq-task-item-actions .cgpt-btn,
        .cgpt-autoq-task-item-actions button,
        .cgpt-autoq-task-item-actions .cgpt-toolbox-small-btn {
          min-width: 38px !important;
          height: 26px !important;
          padding: 0 8px !important;
          font-size: 12px !important;
          line-height: 24px !important;
          border-radius: 6px !important;
          white-space: nowrap !important;
        }

        .cgpt-autoq-task-desc,
        .cgpt-autoq-task-preview {
          display: none !important;
        }

        .cgpt-autoq-task-editor {
          margin-top: 8px;
        }

        .cgpt-autoq-task-editor-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .cgpt-autoq-task-editor-full {
          grid-column: 1 / -1;
        }

        .cgpt-autoq-task-profile-chips {
          flex: 1;
        }

        .cgpt-autoq-task-chip.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 650;
        }

        .cgpt-autoq-task-profile-defaults-title {
          margin-top: 10px;
          margin-bottom: 6px;
        }

        .cgpt-autoq-task-profile-defaults {
          border: 1px solid #2f3542;
          border-radius: 10px;
          padding: 8px;
          background: #111827;
        }

        .cgpt-autoq-task-profile-defaults-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        /* ===== 自动指令设置区：修复 checkbox / label 重叠 ===== */
        .cgpt-autoq-task-profile-defaults {
          container-type: inline-size;
        }

        .cgpt-autoq-task-profile-defaults-grid {
          grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
          gap: 10px 12px;
        }

        .cgpt-autoq-task-profile-defaults-grid .cgpt-autoq-batch-rules-inline-row {
          grid-column: span 1;
          grid-template-columns: minmax(150px, 42%) minmax(0, 1fr);
          column-gap: 12px;
          align-items: center;
          min-width: 0;
        }

        .cgpt-autoq-task-profile-defaults-grid
          .cgpt-autoq-batch-rules-inline-row
          > label:first-child {
          min-width: 0;
          max-width: 100%;
          white-space: normal;
          line-height: 1.35;
          overflow-wrap: break-word;
        }

        .cgpt-autoq-task-profile-defaults-grid .cgpt-checkbox-row {
          display: inline-flex;
          align-items: center;
          justify-self: start;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          white-space: nowrap;
          line-height: 1.35;
        }

        .cgpt-autoq-task-profile-defaults-grid
          .cgpt-checkbox-row
          input[type='checkbox'] {
          flex: 0 0 auto;
          width: 16px;
          height: 16px;
          margin: 0;
        }

        /* checkbox 类型的行：左边文字占剩余空间，右边只放 checkbox + 启用 */
        .cgpt-autoq-task-profile-defaults-grid
          .cgpt-autoq-batch-rules-inline-row:has(.cgpt-checkbox-row) {
          grid-template-columns: minmax(0, 1fr) auto;
        }

        /* 说明文字占满右侧区域，不要被压缩到 checkbox 附近 */
        .cgpt-autoq-task-profile-defaults-grid .cgpt-hint {
          min-width: 0;
          white-space: normal;
          overflow-wrap: break-word;
          line-height: 1.45;
        }

        /* 容器较窄时自动变成单列，彻底避免两列互相挤压 */
        @container (max-width: 900px) {
          .cgpt-autoq-task-profile-defaults-grid {
            grid-template-columns: 1fr;
          }

          .cgpt-autoq-task-profile-defaults-grid .cgpt-autoq-batch-rules-inline-row {
            grid-template-columns: minmax(150px, 220px) minmax(0, 1fr);
          }

          .cgpt-autoq-task-profile-defaults-grid
            .cgpt-autoq-batch-rules-inline-row:has(.cgpt-checkbox-row) {
            grid-template-columns: minmax(0, 1fr) auto;
          }
        }

        .cgpt-autoq-continue-preview {
          margin: 0;
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid #2f3542;
          background: #0f172a;
          color: #cbd5e1;
          font-size: 12px;
          line-height: 1.45;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 180px;
          overflow: auto;
        }

        .cgpt-prompt-batch-task-check {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-right: 6px;
          font-size: 12px;
          color: #94a3b8;
        }

        .cgpt-autoq-import-prompt-btn {
          border-color: #3b82f6;
          color: #93c5fd;
        }

        .cgpt-autoq-import-prompt-btn:hover {
          background: rgba(59, 130, 246, 0.15);
        }

        .cgpt-autoq-prompt-picker-toolbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(120px, 160px) auto auto;
          gap: 8px;
          margin-top: 10px;
          align-items: center;
        }

        .cgpt-autoq-prompt-picker-item {
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }

        .cgpt-autoq-prompt-picker-item-title {
          font-weight: 600;
        }

        .cgpt-autoq-prompt-picker-item-meta {
          color: #94a3b8;
          line-height: 1.35;
        }

        .cgpt-autoq-prompt-picker-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 360px;
          overflow: auto;
          margin-top: 8px;
        }

        .cgpt-autoq-task-advanced {
          border: 1px solid #2f3542;
          border-radius: 10px;
          padding: 8px 10px;
          background: #111827;
        }

        .cgpt-autoq-task-advanced-summary {
          cursor: pointer;
          font-weight: 650;
          color: #e2e8f0;
          user-select: none;
        }

        .cgpt-autoq-task-advanced-body {
          margin-top: 8px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .cgpt-autoq-task-editor-actions {
          margin-top: 8px;
        }

        .cgpt-prompt-page {
          display: flex;
          flex-direction: column;
          gap: 10px;
          height: 100%;
          min-height: 0;
        }

        .cgpt-prompt-toolbar,
        #cgpt-prompt-manage-tools.cgpt-prompt-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 0 0 auto;
          flex-wrap: wrap;
          margin-top: 0 !important;
        }

        .cgpt-prompt-body {
          display: grid;
          grid-template-columns: 240px minmax(0, 1fr);
          gap: 12px;
          min-height: 0;
          flex: 1 1 auto;
        }

        .cgpt-prompt-category-panel,
        .cgpt-prompt-list-panel {
          border: 1px solid rgba(148, 163, 184, 0.28);
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.72);
          padding: 10px;
          min-height: 0;
        }

        .cgpt-prompt-category-panel {
          overflow: auto;
        }

        #cgpt-prompt-category-manager.cgpt-prompt-category-panel {
          margin-top: 0 !important;
        }

        .cgpt-prompt-list-panel {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow: hidden;
        }

        .cgpt-panel-title {
          font-size: 13px;
          font-weight: 700;
          color: #e5e7eb;
          margin: 0 0 10px;
        }

        .cgpt-category-create-row,
        .cgpt-prompt-category-edit-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          margin-bottom: 0;
        }

        .cgpt-category-list,
        .cgpt-prompt-category-manage-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 10px;
          max-height: none;
          overflow: visible;
        }

        .cgpt-category-item,
        .cgpt-prompt-category-manage-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          padding: 8px;
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 8px;
          background: rgba(15, 23, 42, 0.56);
        }

        .cgpt-category-actions {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .cgpt-prompt-filter-row.cgpt-prompt-category-bar {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          margin: 0 !important;
          padding: 0;
        }

        .cgpt-prompt-search,
        #cgpt-prompt-search.cgpt-prompt-search {
          width: 100%;
          height: 34px !important;
          margin: 0 !important;
          padding: 0 10px !important;
        }

        .cgpt-prompt-list {
          gap: 0 !important;
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          border: 1px solid #2f3542;
          border-radius: 12px;
          background: #0f1115;
        }

        #cgpt-prompt-list {
          margin-top: 0 !important;
        }

        #cgpt-prompt-manage-panel {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 0;
          flex: 1 1 auto;
        }

        @media (max-width: 760px) {
          .cgpt-prompt-body {
            grid-template-columns: 1fr;
          }

          .cgpt-prompt-category-panel {
            max-height: 220px;
          }
        }

        .cgpt-prompt-subtabs {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 4px;
          width: auto;
          max-width: 100%;
          margin-top: 8px;
          padding: 3px;
          border: 1px solid #2f3542;
          background: #111827;
          border-radius: 9px;
        }

        .cgpt-prompt-subtab {
          flex: 0 0 auto;
          min-width: 64px;
          width: auto;
          height: 26px;
          padding: 0 8px;
          border: 1px solid #334155;
          background: #171b22;
          color: #cbd5e1;
          border-radius: 7px;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }

        .cgpt-prompt-subtab.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 700;
        }

        .cgpt-prompt-panel {
          display: flex;
          flex-direction: column;
          gap: 6px !important;
          margin-top: 8px;
        }

        #cgpt-prompt-manage-panel.cgpt-prompt-panel {
          padding-top: 6px !important;
        }

        .cgpt-prompt-toolbar .cgpt-btn,
        #cgpt-prompt-manage-tools .cgpt-btn {
          flex: 0 0 auto !important;
          width: auto !important;
          min-width: 48px !important;
          height: 28px !important;
          padding: 0 9px !important;
          font-size: 12px !important;
          border-radius: 7px !important;
        }

        #cgpt-prompt-new-quick-btn {
          min-width: 92px !important;
        }

        .cgpt-prompt-category-select {
          width: 100%;
          min-height: 38px;
          background: rgba(15, 23, 42, 0.88);
          color: #e5e7eb;
          border: 1px solid rgba(96, 165, 250, 0.55);
          border-radius: 8px;
          padding: 6px 10px;
          outline: none;
        }

        .cgpt-prompt-category-select:focus {
          border-color: rgba(59, 130, 246, 0.95);
          box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.38);
        }

        .cgpt-prompt-display-row {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 10px;
          border: 1px solid #2f3542;
          border-radius: 8px;
          margin-bottom: 6px;
          background: rgba(15, 23, 42, 0.45);
          cursor: pointer;
        }

        .cgpt-prompt-display-row:hover {
          background: rgba(37, 99, 235, 0.14);
        }

        .cgpt-prompt-display-main {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }

        .cgpt-prompt-display-main strong {
          color: #e5e7eb;
          font-size: 13px;
        }

        .cgpt-prompt-display-main small {
          color: #9ca3af;
          font-size: 12px;
        }

        .cgpt-prompt-item {
          padding: 6px 8px !important;
          margin: 0 !important;
          border-bottom: 1px solid rgba(55, 65, 81, 0.7) !important;
        }

        .cgpt-prompt-item + .cgpt-prompt-item {
          margin-top: 0 !important;
        }

        .cgpt-prompt-item:last-child {
          border-bottom: 1px solid rgba(55, 65, 81, 0.7) !important;
        }

        .cgpt-prompt-title {
          margin: 0 0 2px 0 !important;
          line-height: 1.25 !important;
          font-size: 13px !important;
          font-weight: 700;
          color: #f8fafc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cgpt-prompt-meta {
          margin: 0 0 2px 0 !important;
          line-height: 1.25 !important;
          font-size: 12px !important;
          color: #94a3b8;
        }

        .cgpt-prompt-category-bar,
        .cgpt-upload-quick-prompt-groups,
        .cgpt-upload-quick-prompts-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
        }

        .cgpt-prompt-category-chip,
        .cgpt-upload-quick-prompt-group,
        .cgpt-upload-quick-prompt-chip {
          flex: 0 1 auto;
          min-width: 0;
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cgpt-prompt-category-chip {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          height: 26px;
          padding: 0 8px;
          max-width: 112px;
          border: 1px solid #475569;
          background: #171b22;
          color: #d1d5db;
          border-radius: 999px;
          cursor: pointer;
          font-size: 12px;
        }

        .cgpt-prompt-category-chip:hover {
          background: #202633;
        }

        .cgpt-prompt-category-chip.active {
          background: #1d4ed8;
          border-color: #3b82f6;
          color: #ffffff;
          font-weight: 650;
        }

        .cgpt-prompt-category-manage-name,
        .cgpt-category-name {
          font-weight: 700;
          color: #f8fafc;
        }

        .cgpt-prompt-category-manage-meta,
        .cgpt-category-count {
          color: #94a3b8;
          font-size: 11px;
          margin-top: 2px;
        }

        .cgpt-category-actions .cgpt-toolbox-small-btn {
          white-space: nowrap;
        }

        @media (max-width: 620px) {
          .cgpt-category-create-row,
          .cgpt-prompt-category-edit-row {
            grid-template-columns: minmax(0, 1fr) auto;
          }

          .cgpt-category-item,
          .cgpt-prompt-category-manage-item {
            grid-template-columns: minmax(0, 1fr) auto;
          }
        }

        .cgpt-prompt-preview,
        .cgpt-prompt-content,
        .cgpt-prompt-desc {
          margin: 0 0 4px 0 !important;
          line-height: 1.35 !important;
          font-size: 12px !important;
          max-height: 34px;
          overflow: hidden;
          color: #cbd5e1;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        .cgpt-prompt-actions,
        .cgpt-prompt-actions-compact {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: flex-start !important;
          flex-wrap: wrap !important;
          row-gap: 4px !important;
          column-gap: 6px !important;
          gap: 6px !important;
          margin-top: 4px !important;
          min-width: 0 !important;
          max-width: 100% !important;
        }

        .cgpt-prompt-actions-compact .cgpt-btn,
        .cgpt-prompt-actions .cgpt-btn {
          min-width: 44px !important;
          width: auto !important;
          height: 26px !important;
          padding: 0 7px !important;
          font-size: 12px !important;
          line-height: 24px !important;
          border-radius: 7px !important;
          flex: 0 0 auto !important;
          white-space: nowrap !important;
        }

        .cgpt-prompt-actions-compact .cgpt-prompt-order-btn,
        .cgpt-prompt-actions .cgpt-prompt-order-btn {
          min-width: 30px !important;
          width: 30px !important;
          padding: 0 !important;
          text-align: center !important;
        }

        .cgpt-prompt-batch-check {
          display: inline-flex !important;
          align-items: center !important;
          gap: 3px !important;
          min-width: 84px !important;
          max-width: 96px !important;
          margin: 0 !important;
          font-size: 12px !important;
          line-height: 1.2 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          flex: 0 0 auto !important;
          color: #94a3b8;
        }

        .cgpt-prompt-batch-check input {
          margin: 0 !important;
        }

        .cgpt-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          background: rgba(0, 0, 0, 0.42);
          display: none;
          align-items: center;
          justify-content: center;
        }

        .cgpt-modal {
          width: min(760px, calc(100vw - 36px));
          max-height: calc(100vh - 52px);
          background: #0f1115;
          color: #f8fafc;
          border: 1px solid #334155;
          border-radius: 14px;
          box-shadow: 0 16px 44px rgba(0,0,0,0.45);
          overflow: hidden;
        }

        .cgpt-modal-header {
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          background: #111827;
          border-bottom: 1px solid #2f3542;
          font-weight: 700;
          cursor: grab;
          user-select: none;
          touch-action: none;
        }

        .cgpt-modal-dragging,
        .cgpt-modal-dragging .cgpt-modal-header {
          cursor: grabbing !important;
        }

        .cgpt-modal-dragging {
          transition: none !important;
        }

        .cgpt-modal-body {
          padding: 12px;
          max-height: calc(100vh - 52px - 44px - 56px);
          overflow-y: auto;
        }

        .cgpt-modal-field {
          margin-bottom: 10px;
        }

        .cgpt-modal-field label {
          display: block;
          margin-bottom: 5px;
          color: #cbd5e1;
          font-weight: 650;
        }

        .cgpt-modal-actions {
          height: 56px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          background: #111827;
          border-top: 1px solid #2f3542;
          gap: 8px;
        }

        .cgpt-modal-actions-left,
        .cgpt-modal-actions-right {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        @media (max-width: 620px) {
          #${APP.panelId} {
            width: calc(100vw - 20px);
            max-width: calc(100vw - 20px);
            max-height: calc(100vh - 24px);
          }

          .cgpt-grid-4 {
            grid-template-columns: 1fr;
          }

          .cgpt-prompt-actions,
          .cgpt-prompt-actions-compact {
            flex-wrap: wrap !important;
          }
        }

        /* 独立悬浮标题牌：仅在面板隐藏/折叠/贴边隐藏时显示 */
        #cgpt-toolbox-floating-title {
          position: fixed;
          z-index: 2147483647;
          display: none;
          align-items: center;
          justify-content: center;
          height: 28px;
          min-width: 96px;
          max-width: 220px;
          padding: 0 12px;
          border: 1px solid #334155;
          border-radius: 999px;
          background: #111827;
          color: #f8fafc;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          box-shadow: 0 8px 22px rgba(0, 0, 0, 0.35);
          user-select: none;
          cursor: grab;
          touch-action: none;
          pointer-events: auto;
        }

        #${APP.rootId}.cgpt-toolbox-dragging #cgpt-toolbox-floating-title {
          cursor: grabbing !important;
        }

        #${APP.rootId}:not(.cgpt-toolbox-panel-hidden) #cgpt-toolbox-floating-title {
          display: none !important;
        }

        #${APP.rootId}.cgpt-toolbox-panel-hidden #cgpt-toolbox-floating-title {
          display: inline-flex !important;
        }

        #${APP.rootId}:not(.cgpt-toolbox-panel-hidden) #${APP.toggleId} {
          display: none !important;
        }

        .cgpt-action-row,
        .cgpt-autoq-actions,
        .cgpt-autoq-top-action-bar,
        .cgpt-upload-main-action-row,
        .cgpt-upload-action-row,
        .cgpt-log-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .cgpt-action-row button,
        .cgpt-autoq-actions button,
        .cgpt-upload-main-action-row .cgpt-btn,
        .cgpt-upload-main-action-row button {
          flex: 0 0 auto;
          min-height: 32px;
          max-width: 100%;
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          line-height: 1.25;
        }

        /* 工具箱内部禁止横向滚动（完整模式 + 精简模式） */
        #${APP.panelId},
        #${APP.panelId} .cgpt-toolbox-content,
        #${APP.panelId} .cgpt-toolbox-page,
        #${APP.panelId} .cgpt-section {
          max-width: 100%;
        }

        #${APP.panelId} {
          min-width: ${TOOLBOX_MIN_WIDTH_COMPACT}px !important;
          max-width: calc(100vw - 12px) !important;
          overflow: hidden;
        }

        #${APP.rootId},
        #${APP.rootId}.cgpt-toolbox-root,
        #${APP.panelId},
        .cgpt-toolbox-panel,
        .cgpt-toolbox-shell {
          box-sizing: border-box !important;
        }

        #${APP.rootId} *,
        #${APP.rootId}.cgpt-toolbox-root *,
        #${APP.panelId} *,
        .cgpt-toolbox-panel *,
        .cgpt-toolbox-shell * {
          box-sizing: border-box !important;
        }

        #${APP.panelId}:not(.cgpt-toolbox-compact) {
          min-width: ${TOOLBOX_MIN_WIDTH_FULL}px !important;
        }

        .cgpt-toolbox-shell,
        .cgpt-toolbox-main,
        .cgpt-toolbox-body,
        .cgpt-toolbox-panel,
        .cgpt-panel,
        .cgpt-row,
        .cgpt-toolbar,
        .cgpt-button-row,
        .cgpt-actions-row,
        .cgpt-status-panel,
        .cgpt-task-panel,
        .cgpt-autoq-task-item,
        .cgpt-task-row,
        .cgpt-task-content,
        .cgpt-task-title,
        .cgpt-task-detail,
        .cgpt-form-row,
        .cgpt-tab-content,
        .cgpt-autoq-panel,
        .cgpt-autoq-body {
          min-width: 0 !important;
          max-width: 100% !important;
        }

        .cgpt-toolbar,
        .cgpt-button-row,
        .cgpt-actions-row,
        .cgpt-autoq-actions,
        .cgpt-upload-actions,
        #${APP.panelId} .cgpt-toolbox-action-row,
        #${APP.panelId} .cgpt-upload-button-row,
        .cgpt-upload-home-actions,
        .cgpt-action-row,
        .cgpt-autoq-top-action-bar,
        .cgpt-upload-main-action-row,
        .cgpt-upload-action-row,
        .cgpt-log-actions {
          display: flex !important;
          flex-wrap: wrap !important;
          align-items: center !important;
          gap: 8px !important;
          min-width: 0 !important;
          max-width: 100% !important;
        }

        .cgpt-upload-actions .cgpt-btn,
        .cgpt-upload-home-actions .cgpt-btn,
        .cgpt-action-row .cgpt-btn,
        .cgpt-upload-main-action-row .cgpt-btn,
        .cgpt-upload-action-row .cgpt-btn {
          position: relative !important;
          z-index: 2 !important;
          pointer-events: auto !important;
          margin: 0 !important;
          flex: 0 0 auto !important;
        }

        #cgpt-copy-last-message-scroll-bottom {
          z-index: 4 !important;
        }

        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-upload-actions .cgpt-btn,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-upload-home-actions .cgpt-btn,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-action-row .cgpt-btn,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-upload-main-action-row .cgpt-btn {
          min-width: 96px !important;
          max-width: 100% !important;
        }

        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-action-grid .cgpt-upload-main-action-row,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-toolbox-action-grid .cgpt-upload-action-row,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-action-grid .cgpt-upload-main-action-row,
        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-action-grid .cgpt-upload-action-row {
          display: flex !important;
          flex-wrap: wrap !important;
          gap: 8px !important;
          align-items: center !important;
          width: 100% !important;
        }

        .cgpt-toolbox-action-grid {
          display: flex !important;
          flex-wrap: wrap !important;
          align-items: center !important;
          align-content: flex-start !important;
          gap: 6px 6px !important;
          margin: 0 !important;
          padding: 0 !important;
          min-width: 0 !important;
          max-width: 100% !important;
        }

        .cgpt-toolbox-action-grid .cgpt-action-group,
        .cgpt-toolbox-action-grid .cgpt-upload-main-action-row,
        .cgpt-toolbox-action-grid .cgpt-upload-closed-loop-action-row,
        .cgpt-toolbox-action-grid .cgpt-upload-action-row {
          display: contents !important;
        }

        .cgpt-toolbox-action-grid .cgpt-btn,
        .cgpt-toolbox-action-grid button.cgpt-btn {
          margin: 0 !important;
        }

        .cgpt-btn,
        .cgpt-toolbox-small-btn {
          max-width: 100% !important;
          min-width: 0 !important;
        }

        #${APP.panelId}.cgpt-toolbox-xs .cgpt-btn,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-toolbox-small-btn {
          padding: 4px 6px !important;
          font-size: 12px !important;
          line-height: 1.2 !important;
        }

        #${APP.panelId}.cgpt-toolbox-xs .cgpt-button-row,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-actions-row,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-actions,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-action-row {
          gap: 4px !important;
        }

        .cgpt-status-text,
        .cgpt-task-title,
        .cgpt-task-step,
        .cgpt-task-detail,
        .cgpt-current-task-meta-value.cgpt-autoq-step,
        .cgpt-autoq-step,
        .cgpt-log-line {
          min-width: 0 !important;
          max-width: 100% !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }

        .cgpt-multiline,
        .cgpt-task-message,
        .cgpt-status-message,
        .cgpt-autoq-user-hint,
        .cgpt-autoq-user-hint-row .cgpt-autoq-status-value,
        .cgpt-status-advice {
          white-space: normal !important;
          overflow-wrap: anywhere !important;
          word-break: break-word !important;
          min-width: 0 !important;
          overflow: visible !important;
          text-overflow: clip !important;
        }

        #${APP.panelId} input:not([type="checkbox"]):not([type="radio"]),
        #${APP.panelId} textarea,
        #${APP.panelId} select,
        .cgpt-toolbox input:not([type="checkbox"]):not([type="radio"]),
        .cgpt-toolbox textarea,
        .cgpt-toolbox select {
          min-width: 0 !important;
          max-width: 100% !important;
          width: 100% !important;
        }

        .cgpt-form-row {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) !important;
          gap: 6px !important;
          min-width: 0 !important;
        }

        #${APP.panelId}.cgpt-toolbox-normal .cgpt-form-row.cgpt-two-col {
          grid-template-columns: auto minmax(0, 1fr) !important;
        }

        #${APP.panelId}.cgpt-toolbox-xs .cgpt-top-stat-secondary,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-page-count-badge,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-local-upload-badge,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-local-message-badge,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-debug-only,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-export-tab,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-log-tab {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-xs .cgpt-top-badge-task {
          display: none !important;
        }

        .cgpt-autoq-task-item-main,
        .cgpt-autoq-task-item-main-inline,
        .cgpt-task-row-main {
          flex: 1 1 180px !important;
          min-width: 0 !important;
        }

        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-task-item,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-task-row {
          display: block !important;
          grid-template-columns: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-task-item-actions,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-task-row-actions {
          margin-top: 6px !important;
          justify-content: flex-start !important;
        }

        #${APP.panelId}.cgpt-toolbox-xs .cgpt-task-action-secondary {
          display: none !important;
        }

        #${APP.panelId}.cgpt-toolbox-sm .cgpt-autoq-settings-grid,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-settings-grid,
        #${APP.panelId}.cgpt-toolbox-sm .cgpt-autoq-exec-settings,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-exec-settings,
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-autoq-exec-settings,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-autoq-exec-settings,
        #${APP.panelId}.cgpt-toolbox-sm .cgpt-settings-grid,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-settings-grid,
        #${APP.panelId}.cgpt-toolbox-sm .cgpt-autoq-task-profile-defaults-grid,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-task-profile-defaults-grid {
          grid-template-columns: 1fr !important;
        }

        #${APP.panelId}.cgpt-toolbox-sm .cgpt-autoq-exec-settings,
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-autoq-exec-settings,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-exec-settings,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-autoq-exec-settings {
          gap: 10px !important;
        }

        #${APP.panelId}.cgpt-toolbox-sm .cgpt-setting-label,
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-setting-label,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-setting-label,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-setting-label {
          font-size: 12px !important;
          white-space: normal !important;
          writing-mode: horizontal-tb !important;
        }

        #${APP.panelId}.cgpt-toolbox-sm .cgpt-setting-check,
        #${APP.panelId}.cgpt-toolbox-narrow .cgpt-setting-check,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-setting-check,
        #${APP.panelId}.cgpt-toolbox-extra-narrow .cgpt-setting-check {
          width: 100% !important;
          align-items: flex-start !important;
        }

        #${APP.panelId}.cgpt-toolbox-sm .cgpt-autoq-status-row,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-status-row,
        #${APP.panelId}.cgpt-toolbox-sm .cgpt-batch-status-row,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-batch-status-row,
        #${APP.panelId}.cgpt-toolbox-sm .cgpt-task-status-row,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-task-status-row {
          grid-template-columns: minmax(0, 1fr) !important;
        }

        #${APP.panelId}.cgpt-toolbox-sm .cgpt-autoq-status-row .cgpt-autoq-status-label,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-autoq-status-row .cgpt-autoq-status-label,
        #${APP.panelId}.cgpt-toolbox-sm .cgpt-batch-status-row .cgpt-batch-status-label,
        #${APP.panelId}.cgpt-toolbox-xs .cgpt-batch-status-row .cgpt-batch-status-label {
          width: auto !important;
          min-width: 0 !important;
          max-width: 100% !important;
          text-align: left !important;
        }

        .cgpt-toolbox-body,
        .cgpt-tab-content,
        .cgpt-autoq-body {
          overflow-x: hidden !important;
          overflow-y: auto !important;
        }

        .cgpt-log-code,
        .cgpt-raw-json,
        .cgpt-debug-pre,
        .xz-autoq-debug-raw pre {
          overflow-x: auto !important;
          white-space: pre !important;
          max-width: 100% !important;
        }

        #${APP.panelId} *,
        #${APP.panelId} *::before,
        #${APP.panelId} *::after {
          box-sizing: border-box;
        }

        /* ===== 工具箱文字统一增强：禁止灰暗 / 淡色说明文字 ===== */
        #${APP.panelId} .cgpt-empty-state,
        #${APP.panelId} .cgpt-log-empty,
        #${APP.panelId} .cgpt-hint,
        #${APP.panelId} .cgpt-upload-meta,
        #${APP.panelId} .cgpt-upload-manage-subtitle,
        #${APP.panelId} .cgpt-upload-manage-empty,
        #${APP.panelId} .cgpt-autoq-status-grid,
        #${APP.panelId} .cgpt-autoq-status-recent,
        #${APP.panelId} .cgpt-autoq-runtime-stats-line,
        #${APP.panelId} .cgpt-autoq-task-item-meta,
        #${APP.panelId} .cgpt-autoq-task-item-source,
        #${APP.panelId} .cgpt-autoq-task-item-category,
        #${APP.panelId} .cgpt-prompt-batch-task-check,
        #${APP.panelId} .cgpt-autoq-prompt-picker-item-meta,
        #${APP.panelId} .cgpt-prompt-display-main small,
        #${APP.panelId} .cgpt-prompt-meta,
        #${APP.panelId} .cgpt-prompt-category-manage-meta,
        #${APP.panelId} .cgpt-prompt-batch-check,
        #${APP.panelId} .cgpt-kv label,
        #${APP.panelId} .cgpt-checkbox-line,
        #${APP.panelId} .cgpt-setting-label,
        #${APP.panelId} .cgpt-setting-check,
        #${APP.panelId} .cgpt-setting-check-text,
        #${APP.panelId} .cgpt-autoq-label,
        #${APP.panelId} .cgpt-autoq-continue-preview,
        #${APP.panelId} .cgpt-modal-field label {
          color: #f8fafc !important;
          opacity: 1 !important;
        }

        /* 覆盖少量内联淡色 style，避免日志/提示仍然发灰 */
        #${APP.panelId} [style*="color:#94a3b8"],
        #${APP.panelId} [style*="color: #94a3b8"],
        #${APP.panelId} [style*="color:#9ca3af"],
        #${APP.panelId} [style*="color: #9ca3af"],
        #${APP.panelId} [style*="color:#cbd5e1"],
        #${APP.panelId} [style*="color: #cbd5e1"],
        #${APP.panelId} [style*="color:#d1d5db"],
        #${APP.panelId} [style*="color: #d1d5db"] {
          color: #f8fafc !important;
          opacity: 1 !important;
        }

        /* 防止状态摘要区产生嵌套滚动条：仅工具箱主内容区滚动 */
        [data-page="autoq"] .cgpt-autoq-main-lite,
        [data-page="autoq"] .cgpt-autoq-user-summary,
        [data-page="autoq"] .cgpt-batch-status-card,
        [data-page="autoq"] .cgpt-autoq-status-card,
        [data-page="autoq"] .cgpt-status-card,
        [data-page="autoq"] .cgpt-task-status-card,
        [data-page="autoq"] .cgpt-autoq-user-hint,
        [data-page="autoq"] .cgpt-autoq-user-hint-row,
        [data-page="autoq"] .cgpt-autoq-user-hint-row .cgpt-autoq-status-value,
        .cgpt-autoq-user-summary,
        .cgpt-batch-status-card,
        .cgpt-autoq-status-card,
        .cgpt-status-card,
        .cgpt-task-status-card,
        .cgpt-autoq-user-hint,
        .cgpt-autoq-user-hint-row,
        .cgpt-autoq-user-hint-row .cgpt-autoq-status-value,
        .cgpt-autoq-main-lite,
        .cgpt-status-advice {
          max-height: none !important;
          overflow-y: visible !important;
          overflow: visible !important;
        }

    `;

    function injectStyle() {
      const old = document.getElementById(APP.styleId);
      if (old) {
        old.remove();
      }
      const style = document.createElement('style');
      style.id = APP.styleId;
      style.textContent = TOOLBOX_STYLE;
      document.documentElement.appendChild(style);
    }

    function getViewportSize() {
      return {
        width: Math.max(320, window.innerWidth || document.documentElement.clientWidth || 320),
        height: Math.max(240, window.innerHeight || document.documentElement.clientHeight || 240),
      };
    }

    function normalizeRootFixedPosition() {
      if (!root) {
        return null;
      }

      const rect = root.getBoundingClientRect();
      const viewport = getViewportSize();

      let left = rect.left;
      let top = rect.top;
      let width = rect.width || HIDDEN_TOGGLE_SIZE.width || 38;
      let height = rect.height || HIDDEN_TOGGLE_SIZE.height || 34;

      if (!Number.isFinite(left)) left = viewport.width - width - VIEWPORT_SAFE_MARGIN;
      if (!Number.isFinite(top)) top = viewport.height - height - VIEWPORT_SAFE_MARGIN;
      if (!Number.isFinite(width) || width <= 0) width = HIDDEN_TOGGLE_SIZE.width || 38;
      if (!Number.isFinite(height) || height <= 0) height = HIDDEN_TOGGLE_SIZE.height || 34;

      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      };
    }

    function clampNumber(value, min, max) {
      const n = Number(value);
      const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
      const rawMax = Number.isFinite(Number(max)) ? Number(max) : safeMin;
      const safeMax = Math.max(safeMin, rawMax);

      if (!Number.isFinite(n)) {
        return safeMin;
      }

      return Math.min(Math.max(n, safeMin), safeMax);
    }

    function saveCurrentRootPosition(reason, options = {}) {
      if (panel && isPanelVisibleNow()) {
        savePanelPositionFromDom(reason || 'save-root-position-panel-visible');
        appendLog(`[TOOLBOX_POSITION][SAVE_ROOT_SKIP] reason=${reason || '-'} panelVisible=1 usePanelPosition=1`);
        return;
      }

      if (isPanelHiddenNow()) {
        if (!root) {
          return;
        }

        const rect = root.getBoundingClientRect();
        const left = Math.round(rect.left);
        const top = Math.round(rect.top);

        if (!Number.isFinite(left) || !Number.isFinite(top)) {
          appendLog(`[TOOLBOX_POSITION][SAVE_HIDDEN_SKIP] reason=${reason || '-'} invalid left/top`);
          return;
        }

        saveHiddenTitlePosition({ left, top }, reason || 'save-root-position-hidden');
        return;
      }

      if (!root) {
        return;
      }

      const rect = root.getBoundingClientRect();
      const left = Math.round(rect.left);
      const top = Math.round(rect.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        appendLog(`[TOOLBOX_POSITION][SAVE_SKIP] reason=${reason || '-'} invalid left/top`);
        return;
      }

      const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
      const mode = options.mode || 'left-top';

      const panelPosition = {
        ...saved,
        left,
        top,
        mode,
        edge: root && root.dataset ? (root.dataset.snapEdge || saved.edge || '') : (saved.edge || ''),
        updatedAt: Date.now(),
      };

      MemoryManager.saveToolboxPatch({
        panelPosition,
      });

      saveCurrentToolboxBaseState(reason || 'save-root-position');

      appendLog(`[TOOLBOX_POSITION][SAVE] reason=${reason || '-'} left=${left} top=${top} mode=${mode}`);
    }

    function clampRootToViewport(reason, options) {
      if (panel && isPanelVisibleNow()) {
        keepPanelInViewport({
          save: options && options.save === true,
        });
        appendLog(`[TOOLBOX_POSITION][CLAMP_ROOT_SKIP] reason=${reason || '-'} panelVisible=1 usePanelClamp=1`);
        return false;
      }

      if (!root) {
        return false;
      }

      const opts = options || {};
      const saveAfterClamp = opts.save !== false;
      const rect = normalizeRootFixedPosition();

      if (!rect) {
        return false;
      }

      let minLeft = VIEWPORT_SAFE_MARGIN;
      let minTop = VIEWPORT_SAFE_MARGIN;
      let maxLeft = rect.viewportWidth - rect.width - VIEWPORT_SAFE_MARGIN;
      let maxTop = rect.viewportHeight - rect.height - VIEWPORT_SAFE_MARGIN;

      if (maxLeft < minLeft) {
        minLeft = VIEWPORT_SAFE_MARGIN;
        maxLeft = Math.max(VIEWPORT_SAFE_MARGIN, rect.viewportWidth - TOOLBOX_MIN_VISIBLE_WIDTH);
      }

      if (maxTop < minTop) {
        minTop = VIEWPORT_SAFE_MARGIN;
        maxTop = Math.max(VIEWPORT_SAFE_MARGIN, rect.viewportHeight - TOOLBOX_MIN_VISIBLE_HEIGHT);
      }

      const nextLeft = clampNumber(rect.left, minLeft, maxLeft);
      const nextTop = clampNumber(rect.top, minTop, maxTop);

      const changed = Math.abs(nextLeft - rect.left) > 0.5 || Math.abs(nextTop - rect.top) > 0.5;

      if (!changed) {
        return false;
      }

      root.style.left = `${Math.round(nextLeft)}px`;
      root.style.top = `${Math.round(nextTop)}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';

      if (saveAfterClamp) {
        if (isPanelHiddenNow() && hiddenTitlePositionLocked) {
          appendLog(
            `[TOOLBOX_POSITION][CLAMP_SAVE_SKIP] reason=${reason || '-'} hidden-title-locked=1`,
          );
          return true;
        }

        saveCurrentRootPosition(`clamp:${reason || '-'}`, {
          mode: 'left-top',
        });
      }

      appendLog(
        `[TOOLBOX_POSITION][CLAMP] reason=${reason || '-'} left=${Math.round(rect.left)} top=${Math.round(rect.top)} -> left=${Math.round(nextLeft)} top=${Math.round(nextTop)}`,
      );

      return true;
    }

    function scheduleClampRootToViewport(reason, options) {
      if (clampViewportTimer) {
        window.clearTimeout(clampViewportTimer);
      }

      clampViewportTimer = window.setTimeout(() => {
        clampViewportTimer = 0;

        try {
          clampRootToViewport(reason, options || {});
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] clampRootToViewport failed', err);
          appendLog(`[TOOLBOX_POSITION][CLAMP_FAILED] reason=${reason || '-'} error=${errText}`);
        }
      }, 50);
    }

    function bindViewportGuard() {
      if (viewportGuardBound) {
        return;
      }

      viewportGuardBound = true;

      window.addEventListener('resize', () => {
        const panelEl = getToolboxPanelElementForRect();
        const saved = loadToolboxPanelRect('window-resize');

        if (panelEl && saved && isPanelVisibleNow()) {
          const rect = clampToolboxPanelRect(saved);
          applyPanelRect(rect);
          panelEl.dataset.userPositionLocked = '1';

          const payload = {
            ...rect,
            savedAt: Date.now(),
            reason: 'window-resize-clamp',
          };
          lastPanelVisibleRect = {
            ...payload,
            right: rect.left + rect.width,
            bottom: rect.top + rect.height,
            updatedAt: payload.savedAt,
          };

          try {
            localStorage.setItem(TOOLBOX_PANEL_RECT_KEY, JSON.stringify(payload));
          } catch (error) {
            console.error('[TOOLBOX_POSITION][RESIZE_CLAMP_WRITE_ERROR]', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
          }

          console.info('[TOOLBOX_POSITION][RESIZE_CLAMP]', { applied: rect });
          appendLog(
            `[TOOLBOX_POSITION][RESIZE_CLAMP] left=${rect.left} top=${rect.top} width=${rect.width} height=${rect.height}`,
          );
        } else {
          scheduleClampRootToViewport('window-resize', {
            save: !isPanelHiddenNow(),
          });
        }

        window.setTimeout(() => {
          syncToolboxFloatingLayout('window-resize');
          repairInvisibleToolboxState('window-resize');
          updateFloatingTitlePosition('window-resize');
          updateToolboxLayoutMode();
        }, 80);
      });

      window.addEventListener('orientationchange', () => {
        scheduleClampRootToViewport('orientation-change', {
          save: !isPanelHiddenNow(),
        });
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          scheduleClampRootToViewport('visibility-visible', {
            save: !isPanelHiddenNow(),
          });
          repairInvisibleToolboxState('visibility-visible');
          updateFloatingTitlePosition('visibility-visible');
        }
      });
    }

    function resetToolboxPosition() {
      if (!root) {
        return;
      }

      cleanupRemovedEdgeAutoHideState('resetToolboxPosition');

      panel = panel || qs(`#${APP.panelId}`, root);
      if (panel) {
        panel.classList.remove('cgpt-toolbox-hidden');
        syncPanelHiddenClass('resetToolboxPosition');
      }

      root.style.left = 'auto';
      root.style.top = 'auto';
      root.style.right = '16px';
      root.style.bottom = '16px';
      root.style.transform = '';

      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

      hideRestoreHotzone('resetToolboxPosition');
      hideRestoreHandle('resetToolboxPosition');

      MemoryManager.saveToolboxPatch({
        panelPosition: null,
        panelHidden: false,
      });

      scheduleClampRootToViewport('reset-position', {
        save: true,
      });

      setStatus('已重置工具箱位置', 'success', {
        persist: false,
      });

      showToast('已重置位置', 'success', 1000);

      appendLog('[TOOLBOX_POSITION][RESET]');
    }

    function writeCompactMode(value, options = {}) {
      const nextCompactMode = !!value;
      const oldCompactMode = !!compactMode;

      if (panel && isPanelVisibleNow()) {
        savePanelSizeFromDom({
          userAction: true,
          key: getPanelSizeMemoryKeyForMode(oldCompactMode),
          reason: 'before-compact-mode-change',
        });
      }

      compactMode = nextCompactMode;
      clearUserPanelSizeLock(options.reason || 'compact-mode-change');

      if (options.saveGlobal !== false) {
        MemoryManager.set(MemoryManager.KEYS.compactMode, compactMode);
      }

      if (options.save !== false) {
        saveToolboxPageStatePatch(
          {
            compactMode,
          },
          options.reason || 'compact-mode-change',
        );
      }

      applyCompactMode({
        save: options.save !== false,
        reason: options.reason || 'write-compact-mode',
        anchor: options.anchor || null,
        restoreAnchor: options.restoreAnchor === true,
        restoreSize: true,
      });

      if (options.save !== false) {
        saveCurrentToolboxBaseState(options.reason || 'compact-mode-change');
      }

      appendLog(
        `[TOOLBOX_COMPACT][write] reason=${options.reason || '-'} old=${oldCompactMode ? 1 : 0} next=${compactMode ? 1 : 0}`,
      );
    }

    function getToolboxTitle() {
      return toolboxTitle || TOOLBOX_DEFAULT_TITLE;
    }

    function stopHeaderTitleFlash(reason = '') {
      if (headerTitleFlashTimer) {
        window.clearInterval(headerTitleFlashTimer);
        headerTitleFlashTimer = 0;
      }

      if (headerTitleFlashStopTimer) {
        window.clearTimeout(headerTitleFlashStopTimer);
        headerTitleFlashStopTimer = 0;
      }

      if (!titleEl && root) {
        titleEl = qs('.cgpt-toolbox-title', root);
      }

      if (titleEl) {
        titleEl.textContent = getToolboxTitle();
        titleEl.title = latestStatusText
          ? `${getToolboxTitle()} - ${latestStatusText}`
          : getToolboxTitle();
      }

      headerTitleFlashBaseText = '';
      headerTitleFlashOn = false;

      const reasonText = String(reason || '-');
      if (/keydown/i.test(reasonText)) {
        try {
          const perfInc = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).__CGPT_TOOLBOX_PERF_INC__;
          if (typeof perfInc === 'function') {
            perfInc('titleFlash.stop.keydown', 1);
          }
        } catch (e) {
          // ignore
        }

        // 默认关闭普通 keydown 日志，仅在性能调试模式下输出，且 1s 节流
        if (isPerfDebugEnabled()) {
          appendLogThrottled(
            'TITLE_FLASH:header-stop:keydown',
            `[TITLE_FLASH][header-stop] reason=${reasonText}`,
            1000,
          );
        }
        return;
      }

      appendLog(`[TITLE_FLASH][header-stop] reason=${reasonText}`);
    }

    function flashHeaderTitleOnce(message = '回复完成', options = {}) {
      stopHeaderTitleFlash(`disabled:${message || '-'}`);

      if (!titleEl && root) {
        titleEl = qs('.cgpt-toolbox-title', root);
      }

      if (titleEl) {
        titleEl.textContent = getToolboxTitle();
        titleEl.title = latestStatusText
          ? `${getToolboxTitle()} - ${latestStatusText}`
          : getToolboxTitle();
      }

      appendLog(`[TITLE_FLASH][header-disabled] message=${message || '-'} reason=toolbox-header-flash-disabled`);
      return false;
    }

    function applyToolboxTitle(_nextTitle) {
      const text = TOOLBOX_DEFAULT_TITLE;
      toolboxTitle = text;

      if (titleEl) {
        titleEl.textContent = toolboxTitle;
        titleEl.title = latestStatusText
          ? `${toolboxTitle} - ${latestStatusText}`
          : toolboxTitle;
      }

      const floatingTitle = getFloatingTitleEl();
      if (floatingTitle) {
        floatingTitle.textContent = toolboxTitle;
        floatingTitle.title = latestStatusText
          ? `${toolboxTitle} - ${latestStatusText}。点击展开/收起，拖拽移动`
          : `${toolboxTitle}。点击展开/收起，拖拽移动`;
      }

      const toggle = qs(`#${APP.toggleId}`, root);
      if (toggle) {
        toggle.replaceChildren();
        const icon = document.createElement('span');
        icon.className = 'cgpt-toolbox-toggle-icon';
        icon.setAttribute('aria-hidden', 'true');
        toggle.appendChild(icon);
        const toggleTitle = isToolboxInAnyHiddenState()
          ? TOOLBOX_RESTORE_HANDLE_TITLE
          : toolboxTitle;
        toggle.title = toggleTitle;
        toggle.setAttribute('aria-label', `打开${toggleTitle}`);
      }

      updateFloatingTitlePosition('apply-title');
    }

    function saveToolboxTitle(_nextTitle) {
      applyToolboxTitle(TOOLBOX_DEFAULT_TITLE);
    }

    function getPanelSizeMemoryKeyForMode(isCompactMode) {
      return isCompactMode
        ? MemoryManager.KEYS.panelSizeCompact
        : MemoryManager.KEYS.panelSizeFull;
    }

    function getPanelSizeMemoryKey() {
      return getPanelSizeMemoryKeyForMode(compactMode);
    }

    function isAutoSizeSaveBlockedReason(reason) {
      const text = String(reason || '').trim().toLowerCase();
      if (!text) {
        return false;
      }
      return AUTO_SIZE_SAVE_BLOCKED_REASON_FRAGMENTS.some((fragment) => (
        text.includes(String(fragment).toLowerCase())
      ));
    }

    function getUserPanelSizeLockState() {
      const persisted = MemoryManager.get(USER_SIZE_LOCK_STORAGE_KEY, null);
      if (persisted && persisted.locked === true) {
        return persisted;
      }

      if (lastUserPanelResizeAt > 0 && lastUserPanelResizeSize) {
        return {
          locked: true,
          lockedAt: lastUserPanelResizeAt,
          width: lastUserPanelResizeSize.width,
          height: lastUserPanelResizeSize.height,
          mode: compactMode ? 'compact' : 'normal',
        };
      }

      return {
        locked: false,
      };
    }

    function isUserPanelSizeLocked() {
      return getUserPanelSizeLockState().locked === true;
    }

    function isUserPanelSizeProtected() {
      if (isUserPanelSizeLocked()) {
        return true;
      }
      return isRecentUserPanelResize();
    }

    function hydrateUserPanelSizeLock() {
      const lock = MemoryManager.get(USER_SIZE_LOCK_STORAGE_KEY, null);
      if (!(lock && lock.locked === true)) {
        return;
      }

      lastUserPanelResizeAt = Number(lock.lockedAt || 0) || Date.now();
      lastUserPanelResizeSize = {
        width: Number(lock.width || 0),
        height: Number(lock.height || 0),
      };

      appendLog(
        `[TOOLBOX_SIZE][USER_LOCK_KEEP] width=${lock.width || 0} height=${lock.height || 0} mode=${lock.mode || '-'}`,
      );
    }

    function setUserPanelSizeLock(width, height, mode) {
      const lockMode = mode || (compactMode ? 'compact' : 'normal');
      const lock = {
        locked: true,
        lockedAt: Date.now(),
        width: Math.round(width),
        height: Math.round(height),
        mode: lockMode,
      };

      lastUserPanelResizeAt = lock.lockedAt;
      lastUserPanelResizeSize = {
        width: lock.width,
        height: lock.height,
      };

      MemoryManager.set(USER_SIZE_LOCK_STORAGE_KEY, lock);

      saveToolboxPageStatePatch(
        {
          layoutState: {
            userSizeLocked: true,
            userSizeLockedAt: lock.lockedAt,
            userPanelWidth: lock.width,
            userPanelHeight: lock.height,
            userPanelMode: lockMode,
          },
        },
        'user-size-lock-set',
      );

      appendLog(
        `[TOOLBOX_SIZE][USER_LOCK_SET] width=${lock.width} height=${lock.height} mode=${lockMode}`,
      );
    }

    function clearUserPanelSizeLock(reason = '') {
      lastUserPanelResizeAt = 0;
      lastUserPanelResizeSize = null;
      MemoryManager.set(USER_SIZE_LOCK_STORAGE_KEY, null);

      appendLog(`[TOOLBOX_SIZE][USER_LOCK_CLEAR] reason=${String(reason || '-').trim() || '-'}`);
    }

    function getCompressedRepairTargetWidth() {
      const lock = getUserPanelSizeLockState();
      if (lock.locked && lock.width > 0) {
        return clampToolboxWidth(lock.width);
      }

      const saved = MemoryManager.get(getPanelSizeMemoryKey(), null);
      if (saved && saved.width > 0) {
        return clampToolboxWidth(saved.width);
      }

      if (compactMode) {
        return clampToolboxWidth(DEFAULT_COMPACT_WIDTH);
      }

      return clampToolboxWidth(PANEL_DEFAULT_SIZE.width);
    }

    function scheduleCompressedRepairRecheck(reason, delayMs = 300) {
      if (compressedRepairDeferTimer) {
        window.clearTimeout(compressedRepairDeferTimer);
      }

      compressedRepairDeferTimer = window.setTimeout(() => {
        compressedRepairDeferTimer = 0;
        repairToolboxLayoutIfCompressed(reason);
      }, Math.max(0, Number(delayMs) || 0));
    }

    function normalizeTab(tab) {
      const text = String(tab || '').trim();
      return VALID_TABS.includes(text) ? text : 'upload';
    }

    function applyToolboxUiState(options = {}) {
      create();

      hydrateUserPanelSizeLock();

      const mem = MemoryManager.getToolboxState();

      applyToolboxTitle(TOOLBOX_DEFAULT_TITLE);

      const hidden = !!mem.panelHidden;

      if (panel) {
        if (hidden) {
          panel.classList.add('cgpt-toolbox-hidden');
        } else {
          panel.classList.remove('cgpt-toolbox-hidden');
        }
        syncPanelHiddenClass('applyToolboxUiState');
      }

      compactMode = !!mem.compactMode;
      applyCompactMode({
        save: false,
        reason: 'applyToolboxUiState',
        restoreAnchor: false,
      });

      if (root) {
        cleanupRemovedEdgeAutoHideState('applyToolboxUiState');

        if (!hidden) {
          const restoredFromRect = restoreToolboxPanelRect('applyToolboxUiState');
          const savedPositionApplied = restoredFromRect
            || applySavedPanelPosition('applyToolboxUiState');

          if (!savedPositionApplied) {
            applyPanelPosition(
              Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - PANEL_DEFAULT_SIZE.width - PANEL_VIEWPORT_MARGIN),
              PANEL_VIEWPORT_MARGIN,
            );

            appendLog('[TOOLBOX_POSITION][RESTORE_DEFAULT] reason=applyToolboxUiState');
          }
        } else {
          const savedGlobalPos = readSavedPanelPosition();
          if (savedGlobalPos) {
            root.style.left = `${savedGlobalPos.left}px`;
            root.style.top = `${savedGlobalPos.top}px`;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
          } else {
            root.style.left = 'auto';
            root.style.top = 'auto';
            root.style.right = '16px';
            root.style.bottom = '16px';
            scheduleClampRootToViewport('restore-invalid-position', { save: false });
          }
        }
      }

      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (!hidden) {
            const restoredAgain = restoreToolboxPanelRect('applyToolboxUiState-final')
              || applySavedPanelPosition('applyToolboxUiState-final');

            if (restoredAgain) {
              appendLog('[TOOLBOX_POSITION][RESTORE_GLOBAL_FINAL] reason=applyToolboxUiState-final');
            }
          }
        }, 80);
      });

      window.requestAnimationFrame(() => {
        if (hidden) {
          keepRootInViewport({
            save: false,
          });
          scheduleClampRootToViewport('restore-position', { save: false });
        } else {
          keepPanelInViewport({
            save: false,
          });
          scheduleClampRootToViewport('restore-position', { save: false });
        }

        updateRestoreHotzone('applyToolboxUiState');
        repairInvisibleToolboxState('applyToolboxUiState');
        syncToolboxFloatingLayout('apply-ui-state');
      });

      if (options.restoreTab !== false) {
        switchTab('upload', { save: false, reason: 'applyToolboxUiState-default' });
        appendLog('[TOOLBOX_TAB][DEFAULT] active=upload reason=applyToolboxUiState-default');
      }
    }

    function getPanelMinSize() {
      if (compactMode) {
        return {
          minWidth: PANEL_COMPACT_DEFAULT_SIZE.minWidth,
          minHeight: PANEL_COMPACT_DEFAULT_SIZE.minHeight,
        };
      }

      return {
        minWidth: PANEL_DEFAULT_SIZE.minWidth,
        minHeight: PANEL_DEFAULT_SIZE.minHeight,
      };
    }

    function getPanelSizeFallback() {
      if (compactMode) {
        return {
          width: PANEL_COMPACT_DEFAULT_SIZE.width,
          height: PANEL_COMPACT_DEFAULT_SIZE.height,
        };
      }

      return {
        width: PANEL_DEFAULT_SIZE.width,
        height: PANEL_DEFAULT_SIZE.height,
      };
    }

    const EXPLICIT_PANEL_SIZE_RESTORE_REASONS = Object.freeze([
      'init',
      'compact-button-click',
      'explicit-reset',
      'write-compact-mode',
    ]);

    function isExplicitPanelSizeRestoreReason(reason) {
      const text = String(reason || '').trim();
      if (!text) {
        return false;
      }

      if (EXPLICIT_PANEL_SIZE_RESTORE_REASONS.includes(text)) {
        return true;
      }

      if (text.startsWith('compact-button') || text.includes('explicit-reset')) {
        return true;
      }

      return false;
    }

    function isRecentUserPanelResize() {
      return (
        lastUserPanelResizeAt > 0
        && (Date.now() - lastUserPanelResizeAt) < USER_PANEL_RESIZE_PROTECT_MS
      );
    }

    function getPanelDomSize() {
      if (!panel) {
        return null;
      }

      const rect = panel.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    function shouldAllowPanelSizeFallback(reason, options = {}) {
      if (options.force === true) {
        return true;
      }

      if (isUserPanelSizeProtected()) {
        return false;
      }

      return isExplicitPanelSizeRestoreReason(reason);
    }

    function logToolboxHorizontalOverflow(reason = '') {
      if (!panel) {
        return;
      }

      try {
        const panelWidth = panel.clientWidth;
        const overflowItems = Array.from(panel.querySelectorAll('*')).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > panelWidth + 4;
        }).slice(0, 8);

        if (!overflowItems.length) {
          appendLog(`[TOOLBOX_LAYOUT][overflow-x-ok] reason=${reason || '-'}`);
          return;
        }

        appendLog(
          `[TOOLBOX_LAYOUT][overflow-x-found] reason=${reason || '-'} count=${overflowItems.length} items=${overflowItems.map((el) => {
            const cls = String(el.className || '').trim().replace(/\s+/g, '.');
            return `${el.tagName.toLowerCase()}#${el.id || '-'}${cls ? `.${cls}` : ''}`;
          }).join('|')}`,
        );
      } catch (err) {
        const errText = err && err.message ? err.message : String(err);
        console.warn('[ChatGPT toolbox] logToolboxHorizontalOverflow failed', err);
        appendLog(`[TOOLBOX_LAYOUT][overflow-x-log-failed] reason=${reason || '-'} error=${errText}`);
      }
    }

    function scheduleToolboxHorizontalOverflowLog(reason, delayMs = 0) {
      window.setTimeout(() => {
        logToolboxHorizontalOverflow(reason);
      }, Math.max(0, Number(delayMs) || 0));
    }

    function getCompactToggleAnchor() {
      const compactBtn = qs('#cgpt-toolbox-compact', root);
      if (!compactBtn || !panel) {
        return null;
      }

      const btnRect = compactBtn.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      if (
        btnRect.width <= 0 ||
        btnRect.height <= 0 ||
        panelRect.width <= 0 ||
        panelRect.height <= 0
      ) {
        return null;
      }

      return {
        buttonCenterX: btnRect.left + btnRect.width / 2,
        buttonCenterY: btnRect.top + btnRect.height / 2,
        panelLeft: panelRect.left,
        panelTop: panelRect.top,
        panelRight: panelRect.right,
        panelBottom: panelRect.bottom,
        panelWidth: panelRect.width,
        panelHeight: panelRect.height,
      };
    }

    function restorePanelPositionByCompactAnchor(anchor, reason = '', options = {}) {
      if (!anchor || !panel) {
        return;
      }

      const compactBtn = qs('#cgpt-toolbox-compact', root);
      if (!compactBtn) {
        return;
      }

      const btnRect = compactBtn.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();

      if (
        btnRect.width <= 0 ||
        btnRect.height <= 0 ||
        panelRect.width <= 0 ||
        panelRect.height <= 0
      ) {
        return;
      }

      const newButtonCenterX = btnRect.left + btnRect.width / 2;
      const newButtonCenterY = btnRect.top + btnRect.height / 2;

      const deltaX = anchor.buttonCenterX - newButtonCenterX;
      const deltaY = anchor.buttonCenterY - newButtonCenterY;

      let nextLeft = panelRect.left + deltaX;
      let nextTop = panelRect.top + deltaY;

      const maxLeft = window.innerWidth - panelRect.width - PANEL_VIEWPORT_MARGIN;
      const maxTop = window.innerHeight - panelRect.height - PANEL_VIEWPORT_MARGIN;

      nextLeft = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(nextLeft, maxLeft));
      nextTop = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(nextTop, maxTop));

      applyPanelPosition(nextLeft, nextTop);

      window.requestAnimationFrame(() => {
        if (options.save === true) {
          savePanelPositionFromDom(`compact-anchor:${reason || '-'}`);
        }

        syncToolboxFloatingLayout(`compact-anchor:${reason || '-'}`);
        updateFloatingTitlePosition(`compact-anchor:${reason || '-'}`);

        const finalBtnRect = compactBtn.getBoundingClientRect();
        const finalPanelRect = panel.getBoundingClientRect();

        appendLog(
          `[TOOLBOX_COMPACT][anchor-restore] reason=${reason || '-'} ` +
          `anchorX=${Math.round(anchor.buttonCenterX)} ` +
          `anchorY=${Math.round(anchor.buttonCenterY)} ` +
          `btnX=${Math.round(finalBtnRect.left + finalBtnRect.width / 2)} ` +
          `btnY=${Math.round(finalBtnRect.top + finalBtnRect.height / 2)} ` +
          `panelLeft=${Math.round(finalPanelRect.left)} ` +
          `panelTop=${Math.round(finalPanelRect.top)} ` +
          `panelRight=${Math.round(finalPanelRect.right)} ` +
          `panelWidth=${Math.round(finalPanelRect.width)}`
        );
      });
    }

    function applyCompactMode(options = {}) {
      if (!panel) return;

      const shouldSave = options.save === true;
      const reason = options.reason || (compactMode ? 'compact-mode-on' : 'compact-mode-off');
      const shouldRestoreAnchor = options.restoreAnchor === true;
      const anchor = shouldRestoreAnchor
        ? (options.anchor || getCompactToggleAnchor())
        : null;

      panel.classList.toggle('cgpt-toolbox-compact', compactMode);
      applyToolboxPanelMinWidthMode();

      const compactBtn = qs('#cgpt-toolbox-compact', root);
      if (compactBtn) {
        markCompactModeToggleButton(compactBtn);
        compactBtn.textContent = compactMode ? '完整' : '简洁';
        compactBtn.title = compactMode ? '切换到完整模式' : '切换到简洁模式';
      }

      if (compactMode) {
        switchTab('upload', { save: false, reason });
        currentActiveTab = 'upload';
        panel.setAttribute('data-compact-active-tab', 'upload');
        appendLog(`[TOOLBOX_COMPACT][force-upload] reason=${reason}`);
      } else {
        panel.removeAttribute('data-compact-active-tab');

        const activeTab = normalizeTab(currentActiveTab || 'upload');
        switchTab(activeTab);
        appendLog(`[TOOLBOX_COMPACT][exit] reason=${reason}`);
      }

      const shouldRestorePanelSize = options.restoreSize === true
        || isExplicitPanelSizeRestoreReason(reason);

      if (shouldRestorePanelSize) {
        restorePanelSize(reason, {
          force: options.forceSize === true,
        });
      } else {
        appendLog(
          `[TOOLBOX_SIZE][restore-skip] reason=${reason || '-'} because=compact-mode-auto-keep-current`,
        );
      }

      window.requestAnimationFrame(() => {
        if (shouldRestoreAnchor && anchor) {
          restorePanelPositionByCompactAnchor(anchor, reason, {
            save: shouldSave,
          });
        }

        window.setTimeout(() => {
          keepPanelInViewport({
            save: shouldSave,
            reason: `compact-mode:${reason}`,
          });
          syncToolboxHeaderLayout(`compact-mode:${reason}`);

          if (shouldSave) {
            savePanelPositionFromDom(`compact-mode:${reason}`);
          }

          scheduleToolboxHorizontalOverflowLog(reason, 0);
        }, 0);
      });

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
      }

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.renderToolboxTopStatus === 'function') {
        UploadModule.renderToolboxTopStatus({
          heavy: false,
          force: true,
          reason: `compact-mode:${reason}`,
        });
      }
    }

    function bindCompactButton() {
      const compactBtn = qs('#cgpt-toolbox-compact', root);
      bindOnce(compactBtn, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const anchor = getCompactToggleAnchor();

        writeCompactMode(!compactMode, {
          reason: 'compact-button-click',
          anchor,
          restoreAnchor: true,
        });
      });
    }

    function ensureFloatingTitleElement() {
      if (!root) return;

      // Clean up any orphaned floating titles outside root
      document.querySelectorAll('#cgpt-toolbox-floating-title').forEach((node) => {
        if (!root.contains(node)) {
          node.remove();
        }
      });

      let floatingTitle = qs('#cgpt-toolbox-floating-title', root);
      if (floatingTitle) {
        floatingTitle.textContent = toolboxTitle || TOOLBOX_DEFAULT_TITLE;
        updateFloatingTitlePosition('ensure-existing-floating-title');
        return;
      }

      floatingTitle = document.createElement('div');
      floatingTitle.id = 'cgpt-toolbox-floating-title';
      floatingTitle.className = 'cgpt-toolbox-floating-title';
      floatingTitle.textContent = toolboxTitle || TOOLBOX_DEFAULT_TITLE;

      const panelEl = qs(`#${APP.panelId}`, root);
      if (panelEl) {
        root.insertBefore(floatingTitle, panelEl);
      } else {
        root.appendChild(floatingTitle);
      }

      bindFloatingTitleToggleEvents();
      updateFloatingTitlePosition('ensure-new-floating-title');
    }

    function ensureToolboxTitleRow() {
      create();
      if (!root) {
        return null;
      }

      const header = qs('.cgpt-toolbox-header', root);
      if (!header) {
        return null;
      }

      let titleRow = qs('.cgpt-toolbox-title-row', header);
      const title = qs('.cgpt-toolbox-title', header);
      const actions = qs('.cgpt-toolbox-header-actions', header);

      if (!titleRow) {
        titleRow = document.createElement('div');
        titleRow.className = 'cgpt-toolbox-title-row';

        if (title) {
          header.insertBefore(titleRow, title);
          titleRow.appendChild(title);
        } else {
          header.insertBefore(titleRow, header.firstChild);
        }

        if (actions && !titleRow.contains(actions)) {
          titleRow.appendChild(actions);
        }
      } else {
        if (title && title.parentElement !== titleRow) {
          titleRow.appendChild(title);
        }
        if (actions && actions.parentElement !== titleRow) {
          titleRow.appendChild(actions);
        }
      }

      if (typeof ToolboxHeaderStatus !== 'undefined' && ToolboxHeaderStatus.ensureToolboxHeaderStatusChips) {
        ToolboxHeaderStatus.ensureToolboxHeaderStatusChips(header);
      }

      return titleRow;
    }

    function ensureToolboxHeaderPageStatusRow() {
      create();
      if (!root) {
        return null;
      }

      const header = qs('.cgpt-toolbox-header', root);
      if (!header) {
        return null;
      }

      const titleRow = ensureToolboxTitleRow();

      let pageStatusRowEl = qs('#cgpt-toolbox-page-status-row', root);

      if (pageStatusRowEl && !header.contains(pageStatusRowEl)) {
        pageStatusRowEl.remove();
        pageStatusRowEl = null;
      }

      if (!pageStatusRowEl) {
        pageStatusRowEl = document.createElement('div');
        pageStatusRowEl.id = 'cgpt-toolbox-page-status-row';
        pageStatusRowEl.className = 'cgpt-toolbox-header-status-row cgpt-top-status-row';

        if (titleRow) {
          header.insertBefore(pageStatusRowEl, titleRow.nextElementSibling);
        } else {
          header.appendChild(pageStatusRowEl);
        }
      } else {
        pageStatusRowEl.className = 'cgpt-toolbox-header-status-row cgpt-top-status-row';
        if (!header.contains(pageStatusRowEl)) {
          if (titleRow) {
            header.insertBefore(pageStatusRowEl, titleRow.nextElementSibling);
          } else {
            header.appendChild(pageStatusRowEl);
          }
        } else if (titleRow && pageStatusRowEl.previousElementSibling !== titleRow) {
          header.insertBefore(pageStatusRowEl, titleRow.nextElementSibling);
        }
      }

      return pageStatusRowEl;
    }

    function markCompactModeToggleButton(compactBtn) {
      if (!compactBtn) {
        return;
      }
      compactBtn.classList.add('cgpt-toolbox-compact-toggle');
      compactBtn.setAttribute('data-cgpt-toolbox-action', 'compact-toggle');
    }

    function ensureSingleCompactModeButton() {
      const buttons = Array.from(
        document.querySelectorAll('.cgpt-toolbox-compact-toggle, [data-cgpt-toolbox-action="compact-toggle"]'),
      );
      const statusRow = root
        ? root.querySelector('.cgpt-toolbox-header-status-row, .cgpt-top-status-row')
        : null;
      if (statusRow) {
        statusRow.querySelectorAll('[data-top-status-slot="compact-mode"]').forEach((el) => {
          el.remove();
        });
      }
      if (buttons.length <= 1) {
        return;
      }
      buttons.forEach((btn, index) => {
        if (index === 0) {
          return;
        }
        const text = String(btn.textContent || '').trim() || '-';
        btn.remove();
        appendLog(
          `[TOOLBOX_UI][REMOVE_DUPLICATE_COMPACT_BUTTON] index=${index} text=${text}`,
        );
      });
    }

    function ensureHideButton() {
      if (!root) return;

      const actions = qs('.cgpt-toolbox-header-actions', root);
      if (!actions) return;

      let hideButton = qs('.cgpt-toolbox-header-hide-btn', root);
      if (hideButton) {
        if (hideButton.dataset.hideBound !== '1') {
          hideButton.dataset.hideBound = '1';
          hideButton.addEventListener('click', () => {
            setToolboxPanelHidden(true, 'header-hide-button-click');
          });
        }
        return;
      }

      const compactBtn = qs('#cgpt-toolbox-compact', root);

      hideButton = document.createElement('button');
      hideButton.type = 'button';
      hideButton.className = 'cgpt-toolbox-header-hide-btn';
      hideButton.textContent = '隐藏';
      hideButton.title = '隐藏工具箱面板，保留恢复入口';
      hideButton.dataset.hideBound = '1';
      hideButton.addEventListener('click', () => {
        setToolboxPanelHidden(true, 'header-hide-button-click');
      });

      if (compactBtn) {
        actions.insertBefore(hideButton, compactBtn);
      } else {
        actions.appendChild(hideButton);
      }
    }

    function ensureCompactButton() {
      if (!root) return;

      let compactBtn = qs('#cgpt-toolbox-compact', root);
      if (compactBtn) {
        markCompactModeToggleButton(compactBtn);
        ensureHideButton();
        return;
      }

      const actions = qs('.cgpt-toolbox-header-actions', root);
      if (!actions) return;

      compactBtn = document.createElement('button');
      compactBtn.type = 'button';
      compactBtn.className = 'cgpt-toolbox-small-btn cgpt-toolbox-compact-toggle';
      compactBtn.id = 'cgpt-toolbox-compact';
      compactBtn.setAttribute('data-dynamic-label-allowed', '1');
      markCompactModeToggleButton(compactBtn);
      compactBtn.textContent = '简洁';
      actions.insertBefore(compactBtn, actions.firstChild);
      ensureHideButton();
    }

    function isValidShellRoot(node) {
      if (!(node instanceof HTMLElement)) return false;

      const nextPanel = node.querySelector(`#${APP.panelId}`);
      const nextToggle = node.querySelector(`#${APP.toggleId}`);
      const nextHeader = node.querySelector('.cgpt-toolbox-header');
      const nextContent = node.querySelector('.cgpt-toolbox-content');

      return !!(nextPanel && nextToggle && nextHeader && nextContent);
    }

    function findToolboxMountRoot() {
      const selectors = [
        'main',
        'body',
        '#__next',
        '[data-testid="composer-root"]',
        'form',
      ];

      let detectedSelector = '';

      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node) {
          detectedSelector = selector;
          console.log('[TOOLBOX][PANEL][MOUNT_ROOT_FOUND]', { selector });
          break;
        }
      }

      if (!detectedSelector) {
        console.error('[TOOLBOX][PANEL][MOUNT_ROOT_NOT_FOUND]', {
          href: location.href,
          bodyReady: !!document.body,
        });
      }

      // 固定定位面板始终挂到 documentElement，避免 main 等容器 overflow/transform 导致不可见。
      if (!document.documentElement) {
        return document.body || null;
      }

      if (detectedSelector) {
        console.log('[TOOLBOX][PANEL][MOUNT_APPEND_TARGET]', {
          detectedSelector,
          appendTarget: 'documentElement',
        });
      }

      return document.documentElement;
    }

    function ensurePanelShellClasses() {
      if (!panel) {
        return;
      }

      panel.classList.add('cgpt-toolbox-panel', 'cgpt-toolbox-shell');
      applyToolboxPanelMinWidthMode();
    }

    function isStableToolboxGeometryActive() {
      if (!ENABLE_STABLE_TOOLBOX_GEOMETRY) {
        return false;
      }
      return typeof ToolboxStableGeometry !== 'undefined'
        && typeof ToolboxStableGeometry.isInstalled === 'function'
        && ToolboxStableGeometry.isInstalled(panel);
    }

    function isStableToolboxPointerActive() {
      if (!panel) {
        return false;
      }
      if (typeof ToolboxStableGeometry !== 'undefined'
        && typeof ToolboxStableGeometry.isPointerInteractionActive === 'function') {
        return ToolboxStableGeometry.isPointerInteractionActive(panel);
      }
      return panel.classList.contains('xz-toolbox-moving')
        || panel.classList.contains('xz-toolbox-resizing');
    }

    function syncLegacyPanelRectFromGeometry(geometry, reason = '') {
      if (!panel || !geometry) {
        return;
      }

      const payload = {
        left: Math.round(geometry.left),
        top: Math.round(geometry.top),
        width: Math.round(geometry.width),
        height: Math.round(geometry.height),
        savedAt: Date.now(),
        reason: String(reason || ''),
      };

      lastPanelVisibleRect = {
        ...payload,
        right: payload.left + payload.width,
        bottom: payload.top + payload.height,
        updatedAt: payload.savedAt,
      };

      try {
        localStorage.setItem(TOOLBOX_PANEL_RECT_KEY, JSON.stringify(payload));
      } catch (error) {
        console.error('[TOOLBOX_POSITION][SYNC_LEGACY_RECT_FAIL]', {
          reason,
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        });
      }

      savePanelPositionOnly(`sync-geometry:${reason || '-'}`, payload.left, payload.top);
      savePanelSizeOnly(
        `sync-geometry:${reason || '-'}`,
        payload.width,
        payload.height,
        compactMode,
      );
      panel.dataset.userPositionLocked = '1';
    }

    function bindStableToolboxGeometry() {
      if (!ENABLE_STABLE_TOOLBOX_GEOMETRY) {
        appendLog('[XZ_TOOLBOX_GEOMETRY][DISABLED] use legacy bindDrag and resize handles');
        return false;
      }
      if (!panel) {
        console.warn('[XZ_TOOLBOX_GEOMETRY][INSTALL_FAIL] panel-missing');
        return false;
      }

      if (typeof ToolboxStableGeometry === 'undefined'
        || typeof ToolboxStableGeometry.install !== 'function') {
        console.warn('[XZ_TOOLBOX_GEOMETRY][INSTALL_FAIL] module-missing');
        return false;
      }

      const header = qs('.cgpt-toolbox-header', panel) || qs('#cgpt-toolbox-drag-handle', panel);
      if (header) {
        header.setAttribute('data-xz-drag-handle', '1');
      }

      ensureToolboxResizeHandle(panel);
      const resizeHandle = panel.querySelector('.cgpt-toolbox-resize-handle');
      if (resizeHandle) {
        resizeHandle.setAttribute('data-xz-resize-handle', '1');
        resizeHandle.classList.add('xz-toolbox-resize-handle');
      }

      const installed = ToolboxStableGeometry.install(panel, {
        onDragStart() {
          isDraggingToolbox = true;
          if (root) {
            root.classList.add('cgpt-toolbox-dragging');
          }
          addGlobalDraggingClass();
        },
        onDragEnd() {
          isDraggingToolbox = false;
          clearDragVisualState('stable-geometry-drag-end');
          updateRestoreHotzone('stable-geometry-drag-end');
        },
        onResizeStart() {
          isResizingToolbox = true;
          panel.dataset.resizing = '1';
          panel.classList.add('cgpt-resizing');
        },
        onResizeEnd() {
          isResizingToolbox = false;
          panel.dataset.resizing = '0';
          panel.classList.remove('cgpt-resizing');
          updateRestoreHotzone('stable-geometry-resize-end');
        },
        onSaved(geometry, mode) {
          syncLegacyPanelRectFromGeometry(geometry, mode || 'saved');
        },
      });

      if (installed) {
        appendLog('[XZ_TOOLBOX_GEOMETRY][INSTALL_OK]');
      }

      return installed;
    }

    function ensureTabResponsiveClasses() {
      if (!root) {
        return;
      }

      const tabsWrap = qs('.cgpt-toolbox-tabs', root);
      if (tabsWrap) {
        tabsWrap.classList.add('cgpt-top-tabs');
      }

      qsa('.cgpt-toolbox-tab[data-tab="export"]', root).forEach((btn) => {
        btn.classList.add('cgpt-export-tab');
      });
      qsa('.cgpt-toolbox-tab[data-tab="log"]', root).forEach((btn) => {
        btn.classList.add('cgpt-log-tab');
      });
    }

    function create() {
      if (creatingToolbox && root) {
        return root;
      }

      if (creatingToolbox) {
        return null;
      }

      creatingToolbox = true;

      try {
        injectStyle();

        if (!ENABLE_STABLE_TOOLBOX_GEOMETRY) {
          try {
            localStorage.removeItem('xz_toolbox_geometry_v2');
            appendLog('[XZ_TOOLBOX_GEOMETRY][CACHE_CLEARED] key=xz_toolbox_geometry_v2 reason=stable-disabled');
          } catch (error) {
            console.error('[XZ_TOOLBOX_GEOMETRY][CACHE_CLEAR_FAIL]', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
            appendLog(`[XZ_TOOLBOX_GEOMETRY][CACHE_CLEAR_FAIL] ${error && error.message ? error.message : String(error)}`);
          }
        }

        if (root) {
          if (!document.documentElement.contains(root)) {
            try {
              findToolboxMountRoot().appendChild(root);
              panel = qs(`#${APP.panelId}`, root);
              titleEl = qs('.cgpt-toolbox-title', root);
              migrateToolboxToastToPanel('create-existing-root-detached');
              if (typeof cleanupRuntimeHandles === 'function') {
                cleanupRuntimeHandles('toolbox-remount-detached-root');
              }
              appendLog('[TOOLBOX_WATCHDOG][REMOUNT] reason=create-existing-root-detached');
            } catch (err) {
              const errText = err && err.message ? err.message : String(err);
              console.error('[ChatGPT toolbox] remount detached root failed', err);
              appendLog(`[TOOLBOX_WATCHDOG][REMOUNT_FAILED] reason=create-existing-root-detached error=${errText}`);
            }
          }

          ensureRestoreHotzoneElement();
          ensureRestoreHandleElement();
          ensureToolboxHeaderPageStatusRow();
          bindToolboxAudioUnlockEvents(root);
          cleanupRemovedEdgeAutoHideState('init');
          updateRestoreHotzone('create-existing-root');
          ensureFloatingTitleElement();
          window.setTimeout(() => {
            repairInvisibleToolboxState('create-existing-root-detached');
          }, 300);
          purgeForbiddenStatusBadge('create-existing-root');
          ensureHideButton();
          initToolboxPanelHiddenFromStorage();
          return root;
        }

        const existing = document.getElementById(APP.rootId);

      if (existing) {
        if (!isValidShellRoot(existing)) {
          console.warn('[ChatGPT toolbox] 检测到不完整的旧工具箱 DOM，已删除并重新创建', existing);
          const oldHotzone = document.getElementById('cgpt-toolbox-edge-hotzone');
          if (oldHotzone) {
            oldHotzone.remove();
          }
          existing.remove();
        } else if (existing.dataset.shellEventsVersion !== SHELL_EVENTS_VERSION) {
          console.warn('[ChatGPT toolbox] 检测到旧版事件绑定，已删除并重新创建', existing);
          const oldHotzone = document.getElementById('cgpt-toolbox-edge-hotzone');
          if (oldHotzone) {
            oldHotzone.remove();
          }
          existing.remove();
        } else {
          root = existing;
          panel = qs(`#${APP.panelId}`, root);
          titleEl = qs('.cgpt-toolbox-title', root);
          migrateToolboxToastToPanel('reuse-existing-dom');
          purgeForbiddenStatusBadge('reuse-existing-dom');

          ensureCompactButton();
          ensureToolboxHeaderPageStatusRow();
          ensureFloatingTitleElement();
          ensureRestoreHotzoneElement();
          ensureRestoreHandleElement();
          bindCompactButton();
          bindEvents();
          bindToolboxAudioUnlockEvents(root);
          applyToolboxUiState({
            restoreTab: false,
          });
          updateRestoreHotzone('create-existing-root');

          window.setTimeout(() => {
            syncToolboxFloatingLayout('reuse-existing-dom');
            repairInvisibleToolboxState('reuse-existing-dom');
          }, 100);

          window.setTimeout(() => {
            repairInvisibleToolboxState('create-reuse-delayed');
          }, 300);

          initToolboxPanelHiddenFromStorage();

          return root;
        }
      }

      root = document.createElement('div');
      root.id = APP.rootId;
      root.setAttribute('data-xz-toolbox', '1');
      root.setAttribute('data-cgpt-toolbox-root', '1');
      root.classList.add('cgpt-toolbox-root');
      root.innerHTML = `
        <button id="${APP.toggleId}" type="button" aria-label="打开小张工具箱" title="小张工具箱">
          <span class="cgpt-toolbox-toggle-icon" aria-hidden="true"></span>
        </button>
        <div id="cgpt-toolbox-floating-title" class="cgpt-toolbox-floating-title">
          小张工具箱
        </div>
        <div id="${APP.panelId}" class="cgpt-toolbox-panel cgpt-toolbox-shell">
          <div class="cgpt-toolbox-header" id="cgpt-toolbox-drag-handle" data-xz-drag-handle="1">
            <div class="cgpt-toolbox-title-row">
              <div class="cgpt-toolbox-title">小张工具箱</div>
              <div class="cgpt-header-status-chips" aria-live="polite"></div>
              <div class="cgpt-toolbox-header-actions">
                <button type="button" class="cgpt-toolbox-header-hide-btn" title="隐藏工具箱面板，保留恢复入口">隐藏</button>
                <button type="button" class="cgpt-toolbox-small-btn cgpt-toolbox-compact-toggle" id="cgpt-toolbox-compact" data-cgpt-toolbox-action="compact-toggle" data-dynamic-label-allowed="1">简洁</button>
              </div>
            </div>
            <div class="cgpt-toolbox-header-status-row cgpt-top-status-row" id="cgpt-toolbox-page-status-row"></div>
          </div>

          <div class="cgpt-toolbox-tabs cgpt-top-tabs">
            <!-- upload tab：只改顶部标签显示名，内部仍然是 upload 模块 -->
            <button type="button" class="cgpt-toolbox-tab active" data-tab="upload" data-full-label="首页" data-short-label="上传">首页</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="autoq" data-full-label="自动指令" data-short-label="指令">自动指令</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="prompt" data-full-label="Prompt 管理" data-short-label="Prompt">Prompt 管理</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="bridge" data-full-label="浏览器桥接" data-short-label="桥接">浏览器桥接</button>
            <button type="button" class="cgpt-toolbox-tab cgpt-export-tab" data-tab="export" data-full-label="导出统计" data-short-label="导出">导出统计</button>
            <button type="button" class="cgpt-toolbox-tab cgpt-log-tab" data-tab="log" data-full-label="日志" data-short-label="日志">日志</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="settings" data-full-label="设置" data-short-label="设置">设置</button>
          </div>

          <div class="cgpt-toolbox-content">
            <div class="cgpt-toolbox-page active" data-page="upload">
              <div id="cgpt-upload-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="autoq">
              <div id="cgpt-autoq-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="prompt">
              <div id="cgpt-prompt-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="bridge">
              <div id="cgpt-bridge-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="export">
              <div id="cgpt-export-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="log">
              <div id="cgpt-log-tab-host"></div>
            </div>
            <div class="cgpt-toolbox-page" data-page="settings">
              <div id="cgpt-settings-tab-host"></div>
            </div>
          </div>

          <div class="cgpt-resize-handle cgpt-resize-n" data-resize-dir="n"></div>
          <div class="cgpt-resize-handle cgpt-resize-s" data-resize-dir="s"></div>
          <div class="cgpt-resize-handle cgpt-resize-e" data-resize-dir="e"></div>
          <div class="cgpt-resize-handle cgpt-resize-w" data-resize-dir="w"></div>
          <div class="cgpt-resize-handle cgpt-resize-ne" data-resize-dir="ne"></div>
          <div class="cgpt-resize-handle cgpt-resize-nw" data-resize-dir="nw"></div>
          <div class="cgpt-resize-handle cgpt-resize-se" data-resize-dir="se"></div>
          <div class="cgpt-resize-handle cgpt-resize-sw" data-resize-dir="sw"></div>
        </div>
      `;

      findToolboxMountRoot().appendChild(root);
      purgeForbiddenStatusBadge('create-new-root');

      panel = qs(`#${APP.panelId}`, root);
      titleEl = qs('.cgpt-toolbox-title', root);
      ensurePanelShellClasses();
      ensureTabResponsiveClasses();
      ensureToolboxHeaderPageStatusRow();

      migrateToolboxToastToPanel('create-new-root');

      bindEvents();
      bindToolboxAudioUnlockEvents(root);
      applyToolboxUiState({
        restoreTab: false,
      });
      if (!restoreToolboxPanelRect('init')) {
        restorePanelSize('init');
      }

      ensureRestoreHandleElement();
      ensureHideButton();
      cleanupRemovedEdgeAutoHideState('init');
      initToolboxPanelHiddenFromStorage();

      window.setTimeout(() => {
        if (panel && isPanelVisibleNow()) {
          keepPanelInViewport({
            save: false,
          });
        } else {
          scheduleClampRootToViewport('create', {
            save: false,
          });
        }
        repairInvisibleToolboxState('create-delayed');
      }, 100);

      window.setTimeout(() => {
        repairInvisibleToolboxState('create-300ms');
      }, 300);

      window.setTimeout(() => {
        scheduleClampRootToViewport('create-late', {
          save: false,
        });
      }, 500);

      scheduleToolboxHorizontalOverflowLog('create', 300);
      syncToolboxHeaderLayout('panel-create');

        bindViewportGuard();
        bindLayoutModeWatcher();

        return root;
      } finally {
        creatingToolbox = false;

        if (root) {
          console.info('[TOOLBOX][SHELL_CREATED] root created', {
            root: !!root,
            panel: !!panel,
          });
          startToolboxWatchdog();
          bindGlobalErrorGuard();
        }
      }
    }

    function bindToolboxEnterSendHotkey() {
      if (!root) {
        appendLog('[TOOLBOX_HOTKEY][bind-skip] reason=root-missing');
        return;
      }

      if (root.dataset.enterSendHotkeyBound === '1') {
        return;
      }

      root.dataset.enterSendHotkeyBound = '1';

      if (!root.hasAttribute('tabindex')) {
        root.setAttribute('tabindex', '-1');
      }

      root.addEventListener('pointerdown', (e) => {
        if (!root) return;

        const target = e.target instanceof Element ? e.target : null;

        if (target && target.closest([
          'input',
          'textarea',
          'select',
          'button',
          '[contenteditable="true"]',
          '[role="textbox"]',
          '[role="combobox"]',
          '[role="searchbox"]',
        ].join(','))) {
          appendLog('[TOOLBOX_HOTKEY][focus-root-skip] reason=editable-or-button');
          return;
        }

        try {
          root.focus({
            preventScroll: true,
          });
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] focus root failed', err);
          appendLog(`[TOOLBOX_HOTKEY][focus-root-failed] error=${errText}`);
        }
      });

      appendLog('[TOOLBOX_HOTKEY][root-focus-bind] send=upload-shortcut-system');
    }

    function installNumberInputWheelGuard(rootEl) {
      const scope = rootEl || root || document;

      if (scope.dataset && scope.dataset.numberInputWheelGuardBound === '1') {
        return;
      }

      if (scope.dataset) {
        scope.dataset.numberInputWheelGuardBound = '1';
      }

      const onWheel = (event) => {
        const target = event.target;
        if (!target) return;

        const input = target.closest && target.closest('input[type="number"], input[data-no-wheel-number="1"]');
        if (!input) return;

        const toolboxRoot = input.closest && input.closest(`#${APP.rootId}, .cgpt-toolbox, [data-cgpt-toolbox-root="1"]`);
        if (!toolboxRoot) return;

        event.preventDefault();

        if (document.activeElement === input) {
          input.blur();
        }

        const scrollBox =
          input.closest('.cgpt-toolbox-content') ||
          input.closest('.cgpt-toolbox-body') ||
          input.closest('.cgpt-autoq-panel') ||
          input.closest('.cgpt-scroll-area') ||
          input.closest('[data-scroll-container="1"]');

        if (scrollBox) {
          scrollBox.scrollTop += event.deltaY;
        }
      };

      scope.addEventListener('wheel', onWheel, { capture: true, passive: false });
    }

    function bindEvents() {
      if (!root) {
        console.warn('[ChatGPT toolbox] bindEvents: root 未初始化');
        return;
      }

      panel = panel || qs(`#${APP.panelId}`, root);
      const toggle = qs(`#${APP.toggleId}`, root);

      if (!panel) {
        console.warn('[ChatGPT toolbox] bindEvents: panel 不存在，取消绑定');
        return;
      }

      ensurePanelShellClasses();
      ensureTabResponsiveClasses();
      ensureHideButton();

      if (!toggle) {
        console.warn('[ChatGPT toolbox] bindEvents: toggle 不存在，取消绑定');
        return;
      }

      ensureRestoreHotzoneElement();
      ensureRestoreHandleElement();
      bindToolboxConsoleRescueApi();

      bindToggleDrag();
      bindFloatingTitleToggleEvents();

      ensureToolboxResizeHandle(panel);
      if (ENABLE_STABLE_TOOLBOX_GEOMETRY) {
        bindStableToolboxGeometry();
      } else {
        appendLog('[TOOLBOX_DRAG][legacy-enabled] stable geometry disabled, binding legacy drag');
      }
      installToolboxKeyboardGuard(root);
      installNumberInputWheelGuard(root);

      if (root.dataset.shellEventsVersion === SHELL_EVENTS_VERSION) {
        return;
      }

      if (titleEl && titleEl.dataset.titleBound !== '1') {
        titleEl.dataset.titleBound = '1';
        titleEl.addEventListener('dblclick', () => {
          const name = window.prompt('工具箱名称', getToolboxTitle());
          if (name === null) return;

          const text = String(name || '').trim();
          if (!text) {
            console.warn('[ChatGPT toolbox] rename toolbox: 名称为空');
            return;
          }

          saveToolboxTitle(text);
          appendLog(`工具箱已重命名为${toolboxTitle}`);
        });
      }

      qsa('.cgpt-toolbox-tab', root).forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.getAttribute('data-tab');
          switchTab(tab);
        });
      });

      bindCompactButton();
      bindToolboxEnterSendHotkey();
      bindDrag();
      bindPanelResizeHandles();
      bindPanelResizePersistence();
      bindToolboxResponsiveWatcher();
      applyToolboxPanelMinWidthMode();

      window.addEventListener('resize', () => {
        appendLog('[TOOLBOX_LAYOUT][window-resize-clamp-only]');

        scheduleClampRootToViewport('window-resize(shell)', {
          save: false,
        });

        if (isPanelHiddenNow()) {
          keepRootInViewport({
            save: false,
          });
          updateRestoreHotzone('window-resize');
          repairInvisibleToolboxState('window-resize-panel-hidden');
          updateFloatingTitlePosition('window-resize-panel-hidden');
          return;
        }

        window.setTimeout(() => {
          keepPanelInViewport({
            save: false,
          });
          scheduleClampRootToViewport('window-resize(panel)', {
            save: false,
          });
          syncToolboxFloatingLayout('window-resize');
        }, 0);

        window.setTimeout(() => {
          syncToolboxFloatingLayout('window-resize');
          scheduleToolboxHorizontalOverflowLog('window-resize', 0);
        }, 80);
      });

      root.dataset.shellEventsVersion = SHELL_EVENTS_VERSION;

      bindToolboxPageStateRouteWatcher();
    }

    function switchTab(tab, options = {}) {
      let nextTab = normalizeTab(tab);

      // Tab / compact 切换按钮不受上传/发送/自动队列 running 状态影响，此处不做 disabled 门控。

      if (compactMode && nextTab !== 'upload') {
        appendLog(`[TOOLBOX_COMPACT][block-non-upload-tab] requested=${nextTab}`);
        nextTab = 'upload';
      }

      qsa('.cgpt-toolbox-tab', root).forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === nextTab);
      });

      qsa('.cgpt-toolbox-page', root).forEach((page) => {
        page.classList.toggle('active', page.getAttribute('data-page') === nextTab);
      });

      currentActiveTab = nextTab;

      if (root) {
        root.dataset.activeTab = nextTab;
      }

      if (panel) {
        panel.dataset.activeTab = nextTab;
      }

      if (options.save !== false) {
        const toolboxRouteKey = typeof getToolboxRouteKey === 'function' ? getToolboxRouteKey() : '-';
        appendLog(
          `[TOOLBOX_TAB][SAVE] source=switchTab toolboxRouteKey=${toolboxRouteKey} activeTab=${nextTab} `
          + `reason=${options.reason || `switch-tab:${nextTab}`} compactMode=${compactMode ? 'true' : 'false'} `
          + `isApplyingToolboxPageState=${isApplyingToolboxPageState ? 'true' : 'false'}`,
        );
        saveToolboxPageStatePatch(
          {
            ...collectCurrentToolboxPageState(),
            activeTab: nextTab,
          },
          `switch-tab:${nextTab}`,
        );
      }

      if (panel && compactMode) {
        panel.setAttribute('data-compact-active-tab', 'upload');
      }

      const logModuleRef = globalThis.__CGPT_TOOLBOX_LOG_MODULE__;
      if (nextTab === 'log' && logModuleRef && typeof logModuleRef.flushDomIfNeeded === 'function') {
        logModuleRef.flushDomIfNeeded();
      }

      if (
        nextTab === 'autoq'
        && typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.bindDelegatedActions === 'function'
      ) {
        AutoQueueModule.bindDelegatedActions('switch-tab-autoq');
      }

      if (
        nextTab === 'upload'
        && typeof UploadModule !== 'undefined'
        && typeof UploadModule.refresh === 'function'
      ) {
        UploadModule.refresh({ reason: `switch-tab:${nextTab}` });
      }

      scheduleToolboxHorizontalOverflowLog(`switch-tab:${nextTab}`, 0);
      syncToolboxHeaderLayout(`switch-tab:${nextTab}`);
    }

    function restoreActiveTab() {
      const pageState = typeof getToolboxPageState === 'function' ? getToolboxPageState() : {};
      const pageTab = readToolboxStateField(pageState, 'activeTab', '');
      if (pageTab) {
        const tab = normalizeTab(pageTab);
        switchTab(tab, { reason: 'restore-page-state' });
        appendLog(`[TOOLBOX_TAB][RESTORE] source=page active=${tab}`);
        return tab;
      }
      switchTab('upload', { save: false, reason: 'restore-default-upload' });
      appendLog('[TOOLBOX_TAB][RESTORE] source=default active=upload');
      return 'upload';
    }

    function getActiveTab() {
      return currentActiveTab || 'upload';
    }

    function getCurrentPanelDefaultSize() {
      return compactMode ? PANEL_COMPACT_DEFAULT_SIZE : PANEL_DEFAULT_SIZE;
    }

    function getViewportMetrics() {
      const vv = window.visualViewport;
      return {
        width: vv && vv.width > 0 ? vv.width : window.innerWidth,
        height: vv && vv.height > 0 ? vv.height : window.innerHeight,
        visualViewportWidth: vv ? Math.round(vv.width) : null,
        visualViewportHeight: vv ? Math.round(vv.height) : null,
      };
    }

    function getToolboxViewportWidth() {
      return Math.max(
        window.innerWidth || 0,
        document.documentElement && document.documentElement.clientWidth
          ? document.documentElement.clientWidth
          : 0,
      );
    }

    function getToolboxViewportHeight() {
      return Math.max(
        window.innerHeight || 0,
        document.documentElement && document.documentElement.clientHeight
          ? document.documentElement.clientHeight
          : 0,
      );
    }

    function getToolboxMaxWidth() {
      const viewportWidth = getToolboxViewportWidth();
      const margin = TOOLBOX_SIZE_LIMITS.VIEWPORT_MARGIN;
      return Math.min(
        TOOLBOX_SIZE_LIMITS.MAX_WIDTH,
        Math.floor(viewportWidth * TOOLBOX_SIZE_LIMITS.MAX_WIDTH_RATIO),
        viewportWidth - margin * 2,
      );
    }

    function getToolboxMaxHeight() {
      const viewportHeight = getToolboxViewportHeight();
      return Math.max(
        TOOLBOX_SIZE_LIMITS.MIN_HEIGHT,
        Math.floor(viewportHeight * TOOLBOX_SIZE_LIMITS.MAX_HEIGHT_RATIO),
      );
    }

    function getToolboxResizeMinWidth() {
      const panelMins = getPanelMinSize();
      return Math.max(TOOLBOX_SIZE_LIMITS.MIN_WIDTH, panelMins.minWidth || TOOLBOX_MIN_WIDTH_FULL);
    }

    function normalizeToolboxSavedSize(width, height, reason) {
      const maxWidth = getToolboxMaxWidth();
      const maxHeight = getToolboxMaxHeight();
      const nextWidth = Math.round(
        Math.max(
          TOOLBOX_SIZE_LIMITS.MIN_WIDTH,
          Math.min(
            Number(width) || TOOLBOX_SIZE_LIMITS.DEFAULT_WIDTH,
            maxWidth,
          ),
        ),
      );
      const nextHeight = Math.round(
        Math.max(
          TOOLBOX_SIZE_LIMITS.MIN_HEIGHT,
          Math.min(
            Number(height) || TOOLBOX_SIZE_LIMITS.DEFAULT_HEIGHT,
            maxHeight,
          ),
        ),
      );
      appendLog(
        `[TOOLBOX_SIZE][NORMALIZE] reason=${reason || '-'} width=${width}->${nextWidth} height=${height}->${nextHeight} maxWidth=${maxWidth}`,
      );
      return {
        width: nextWidth,
        height: nextHeight,
      };
    }

    function fitPanelRectInViewport(rect, options = {}) {
      const viewportWidth = getToolboxViewportWidth();
      const viewportHeight = getToolboxViewportHeight();
      const margin = TOOLBOX_SIZE_LIMITS.VIEWPORT_MARGIN;
      const maxWidth = getToolboxMaxWidth();
      const maxHeight = getToolboxMaxHeight();
      const minWidth = options.minWidth != null ? options.minWidth : getToolboxResizeMinWidth();
      const minHeight = options.minHeight != null ? options.minHeight : (getPanelMinSize().minHeight || TOOLBOX_SIZE_LIMITS.MIN_HEIGHT);

      let left = Number(rect.left) || margin;
      let top = Number(rect.top) || margin;
      let width = Number(rect.width) || TOOLBOX_SIZE_LIMITS.DEFAULT_WIDTH;
      let height = Number(rect.height) || TOOLBOX_SIZE_LIMITS.DEFAULT_HEIGHT;

      width = Math.max(minWidth, Math.min(maxWidth, width));
      height = Math.max(minHeight, Math.min(maxHeight, height));

      if (left + width > viewportWidth - margin) {
        left = viewportWidth - margin - width;
      }
      if (left < margin) {
        left = margin;
        width = Math.min(width, viewportWidth - margin * 2);
      }
      if (top + height > viewportHeight - margin) {
        top = viewportHeight - margin - height;
      }
      if (top < margin) {
        top = margin;
      }

      return {
        left: Math.round(left),
        top: Math.round(top),
        width: Math.round(width),
        height: Math.round(height),
      };
    }

    function calculateRightResizeRect(startRect, dx, dy) {
      const viewportWidth = getToolboxViewportWidth();
      const viewportHeight = getToolboxViewportHeight();
      const margin = TOOLBOX_SIZE_LIMITS.VIEWPORT_MARGIN;
      const maxWidth = getToolboxMaxWidth();
      const maxHeight = getToolboxMaxHeight();
      const minWidth = getToolboxResizeMinWidth();
      const minHeight = getPanelMinSize().minHeight || TOOLBOX_SIZE_LIMITS.MIN_HEIGHT;

      let nextLeft = startRect.left;
      let nextTop = startRect.top;
      let nextWidth = startRect.width + dx;
      let nextHeight = startRect.height + dy;

      nextWidth = Math.max(minWidth, Math.min(maxWidth, nextWidth));
      nextHeight = Math.max(minHeight, Math.min(maxHeight, nextHeight));

      const desiredRight = nextLeft + nextWidth;
      const maxRight = viewportWidth - margin;
      if (desiredRight > maxRight) {
        nextLeft = maxRight - nextWidth;
      }
      if (nextLeft < margin) {
        nextLeft = margin;
        nextWidth = Math.min(nextWidth, viewportWidth - margin * 2);
      }

      const maxBottom = viewportHeight - margin;
      if (nextTop + nextHeight > maxBottom) {
        nextHeight = maxBottom - nextTop;
      }
      if (nextTop < margin) {
        nextTop = margin;
      }

      return {
        left: Math.round(nextLeft),
        top: Math.round(nextTop),
        width: Math.round(nextWidth),
        height: Math.round(nextHeight),
      };
    }

    function appendResizeMoveLogThrottled(message, intervalMs = 250) {
      const now = Date.now();
      if (now - panelResizeMoveLogLastAt < intervalMs) {
        return;
      }
      panelResizeMoveLogLastAt = now;
      appendLog(message);
    }

    function updateToolboxResponsiveClassLightweight(reason = '-') {
      if (!panel) {
        return;
      }

      const width = Math.round(panel.getBoundingClientRect().width || 0);
      if (width <= 0) {
        return;
      }

      const extraNarrow = width < 360;
      const narrowBand = width < 460;
      const moderateBand = width < TOOLBOX_SIZE_LIMITS.NARROW_WIDTH;
      panel.classList.toggle('cgpt-toolbox-extra-narrow', extraNarrow);
      panel.classList.toggle('cgpt-toolbox-narrow', moderateBand || narrowBand);
      panel.dataset.toolboxWidth = String(width);
      panel.dataset.toolboxWidthBand = extraNarrow
        ? 'extra-narrow'
        : narrowBand
          ? 'narrow'
          : moderateBand
            ? 'moderate'
            : 'normal';
      panel.dataset.toolboxWidthReason = String(reason || '-');
    }

    function applyPanelResizeRect(rect, reason = '-', options = {}) {
      if (!panel || !rect) {
        return;
      }

      const deferHeavySync = options && options.deferHeavySync === true;

      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.width = `${rect.width}px`;
      panel.style.height = `${rect.height}px`;
      panel.style.setProperty('--cgpt-toolbox-width', `${rect.width}px`);
      panel.style.setProperty('--cgpt-toolbox-height', `${rect.height}px`);

      if (!deferHeavySync) {
        updateToolboxNarrowClass(reason);
        syncToolboxHeaderLayout(reason);
      }
    }

    function scheduleApplyPanelResizeRect(rect, reason = '-') {
      if (!rect) {
        return;
      }

      panelResizePendingRect = rect;
      panelResizePendingReason = reason;

      if (panelResizeRafId) {
        return;
      }

      panelResizeRafId = window.requestAnimationFrame(() => {
        panelResizeRafId = 0;
        const pending = panelResizePendingRect;
        const pendingReason = panelResizePendingReason || reason;
        panelResizePendingRect = null;
        panelResizePendingReason = '';

        if (!pending) {
          return;
        }

        applyPanelResizeRect(pending, pendingReason, {
          deferHeavySync: true,
        });
        updateToolboxResponsiveClassLightweight(`${pendingReason}:lightweight`);
      });
    }

    function flushPanelResizePendingRect(reason = '-') {
      if (panelResizeRafId) {
        window.cancelAnimationFrame(panelResizeRafId);
        panelResizeRafId = 0;
      }

      if (panelResizePendingRect) {
        const pending = panelResizePendingRect;
        panelResizePendingRect = null;
        panelResizePendingReason = '';
        applyPanelResizeRect(pending, reason, {
          deferHeavySync: false,
        });
      }

      if (panel) {
        updateToolboxNarrowClass(`${reason || '-'}:final`);
        syncToolboxHeaderLayout(`${reason || '-'}:final`);
        if (typeof renderToolboxHeaderStatus === 'function') {
          renderToolboxHeaderStatus(`${reason || '-'}:final`);
        }
      }
    }

    function getPanelMaxSize() {
      const defaults = getCurrentPanelDefaultSize();
      const maxWidth = compactMode
        ? Math.min(defaults.maxWidth || MAX_COMPACT_WIDTH, getToolboxMaxWidth())
        : getToolboxMaxWidth();
      const maxHeight = compactMode
        ? (defaults.maxHeight || PANEL_COMPACT_DEFAULT_SIZE.maxHeight || 400)
        : getToolboxMaxHeight();

      return {
        width: Math.max(defaults.minWidth, maxWidth),
        height: Math.max(defaults.minHeight, maxHeight),
      };
    }

    function collectLayoutDebugInfo() {
      const panelEl = panel || document.querySelector(`#${APP.panelId}`);
      const rect = panelEl ? panelEl.getBoundingClientRect() : null;
      const panelStyle = panelEl ? window.getComputedStyle(panelEl) : null;
      const bodyStyle = window.getComputedStyle(document.body);
      const viewport = getViewportMetrics();
      const innerWidth = window.innerWidth;
      const innerHeight = window.innerHeight;
      const outerWidth = window.outerWidth;
      const browserZoomMaybe = innerWidth > 0
        ? `${Math.round((outerWidth / innerWidth) * 100)}%`
        : '-';

      return {
        viewportWidth: Math.round(viewport.width),
        viewportHeight: Math.round(viewport.height),
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight: window.outerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        visualViewportWidth: viewport.visualViewportWidth,
        visualViewportHeight: viewport.visualViewportHeight,
        panelWidth: rect ? Math.round(rect.width) : 0,
        panelHeight: rect ? Math.round(rect.height) : 0,
        compactMode: panelEl ? panelEl.classList.contains('cgpt-toolbox-layout-compact') : false,
        uiCompactMode: !!compactMode,
        layoutCompactAuto: !!layoutCompactAuto,
        bodyFontSize: bodyStyle.fontSize,
        panelFontSize: panelStyle ? panelStyle.fontSize : '',
        browserZoomMaybe,
      };
    }

    function ensurePanelSizeWithinViewport() {
      if (!panel) {
        return;
      }

      if (isUserPanelSizeProtected()) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return;
      }

      const next = normalizePanelSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });

      if (
        Math.abs(next.width - rect.width) > 1
        || Math.abs(next.height - rect.height) > 1
      ) {
        applyPanelSize(next, {
          reason: 'layout-mode-clamp',
        });
      }
    }

    function updateToolboxLayoutMode() {
      if (!panel) {
        console.warn('[TOOLBOX][LAYOUT][PANEL_NOT_FOUND]');
        return;
      }

      const viewport = getViewportMetrics();
      const viewportWidth = viewport.width;
      const viewportHeight = viewport.height;
      const dpr = window.devicePixelRatio || 1;
      const compact = viewportWidth < 1000 || viewportHeight < 720 || dpr >= 1.5;

      layoutCompactAuto = compact;
      panel.classList.toggle('cgpt-toolbox-layout-compact', compact);

      ensurePanelSizeWithinViewport();
      keepPanelInViewport({ save: false, reason: 'layout-mode' });

      const rect = panel.getBoundingClientRect();
      const innerWidth = window.innerWidth;
      const browserZoomMaybe = innerWidth > 0
        ? `${Math.round((window.outerWidth / innerWidth) * 100)}%`
        : '-';

      console.log('[TOOLBOX][LAYOUT][MODE]', {
        viewportWidth: Math.round(viewportWidth),
        viewportHeight: Math.round(viewportHeight),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: dpr,
        compact,
        uiCompactMode: compactMode,
        panelWidth: Math.round(rect.width),
        panelHeight: Math.round(rect.height),
        browserZoomMaybe,
      });
    }

    function renderLayoutDebugInfo(container) {
      if (!container) {
        console.warn('[TOOLBOX][LAYOUT_DEBUG][CONTAINER_MISSING]');
        return;
      }

      try {
        const info = collectLayoutDebugInfo();
        container.textContent = JSON.stringify(info, null, 2);
      } catch (error) {
        console.error('[TOOLBOX][LAYOUT_DEBUG][RENDER_FAILED]', {
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        });
      }
    }

    function bindLayoutModeWatcher() {
      if (layoutModeBound) {
        return;
      }

      layoutModeBound = true;

      const scheduleLayoutModeUpdate = () => {
        window.requestAnimationFrame(() => {
          try {
            updateToolboxLayoutMode();
          } catch (error) {
            console.error('[TOOLBOX][LAYOUT][MODE_UPDATE_FAILED]', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
          }
        });
      };

      window.addEventListener('resize', scheduleLayoutModeUpdate);
      window.addEventListener('orientationchange', scheduleLayoutModeUpdate);

      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleLayoutModeUpdate);
        window.visualViewport.addEventListener('scroll', scheduleLayoutModeUpdate);
      }

      window.setTimeout(scheduleLayoutModeUpdate, 0);
      window.setTimeout(scheduleLayoutModeUpdate, 500);
    }

    function clampToolboxWidth(width) {
      const defaults = getCurrentPanelDefaultSize();
      const minWidth = Math.max(
        defaults.minWidth || TOOLBOX_MIN_WIDTH_FULL,
        compactMode ? TOOLBOX_MIN_WIDTH_COMPACT : TOOLBOX_SIZE_LIMITS.MIN_WIDTH,
      );
      const normalized = normalizeToolboxSavedSize(
        width,
        defaults.height || PANEL_DEFAULT_SIZE.height,
        'clampToolboxWidth',
      );
      const numericWidth = Number(width);
      if (!Number.isFinite(numericWidth)) {
        return defaults.width || 640;
      }
      return Math.max(minWidth, Math.min(normalized.width, getToolboxMaxWidth()));
    }

    function normalizePanelSize(size) {
      const defaults = getCurrentPanelDefaultSize();
      const normalized = normalizeToolboxSavedSize(
        size && size.width != null ? size.width : defaults.width,
        size && size.height != null ? size.height : defaults.height,
        'normalizePanelSize',
      );
      const maxSize = getPanelMaxSize();

      return {
        width: clampToolboxWidth(normalized.width),
        height: clampNumber(normalized.height, defaults.minHeight, maxSize.height),
      };
    }

    function getCurrentPanelVisualSize() {
      const fallback = normalizePanelSize(
        MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
      );
      if (!panel) return fallback;

      const rect = panel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      }

      return fallback;
    }

    function applyPanelSize(size, options = {}) {
      if (!panel) return;

      const reason = String(options.reason || '').trim() || 'unspecified';
      const force = options.force === true;
      const userAction = options.userAction === true;
      const oldRect = panel.getBoundingClientRect();
      const oldWidth = oldRect.width > 0 ? Math.round(oldRect.width) : 0;
      const oldHeight = oldRect.height > 0 ? Math.round(oldRect.height) : 0;
      const currentDom = getPanelDomSize();

      let next = normalizePanelSize(size || getCurrentPanelDefaultSize());

      if (
        isUserPanelSizeProtected()
        && !force
        && !userAction
        && !isExplicitPanelSizeRestoreReason(reason)
        && currentDom
        && (next.width > currentDom.width + 1 || next.height > currentDom.height + 1)
      ) {
        appendLog(
          `[TOOLBOX_SIZE][apply-skip] reason=${reason} because=user-size-protected ` +
          `oldWidth=${oldWidth} oldHeight=${oldHeight} ` +
          `blockedWidth=${next.width} blockedHeight=${next.height} ` +
          `keepWidth=${currentDom.width} keepHeight=${currentDom.height} ` +
          `compact=${compactMode ? 1 : 0}`,
        );
        return;
      }

      const requestedWidth = size && size.width != null ? Number(size.width) : null;
      const panelMins = getPanelMinSize();

      appendLog(
        `[TOOLBOX_SIZE][apply] reason=${reason} ` +
        `oldWidth=${oldWidth} oldHeight=${oldHeight} ` +
        `nextWidth=${next.width} nextHeight=${next.height} ` +
        `compact=${compactMode ? 1 : 0} force=${force ? 1 : 0} userAction=${userAction ? 1 : 0}`,
      );

      console.log('[TOOLBOX_RESIZE][APPLY]', {
        requestedWidth,
        appliedWidth: next.width,
        minWidth: panelMins.minWidth,
        mode: compactMode ? 'compact' : 'full',
        reason,
      });

      panel.style.width = `${next.width}px`;
      panel.style.height = `${next.height}px`;
      panel.style.setProperty('--cgpt-toolbox-width', `${next.width}px`);
      panel.style.setProperty('--cgpt-toolbox-height', `${next.height}px`);

      updateToolboxResponsiveClass(panel, reason);

      window.setTimeout(() => {
        keepPanelInViewport({
          save: false,
        });
      }, 0);
    }

    function shouldIgnoreToolboxDrag(event) {
      const target = event && event.target;
      if (!(target instanceof Element)) {
        return false;
      }

      if (target.closest('.cgpt-toolbox-resize-handle, .cgpt-toolbox-resize-left-handle, .cgpt-resize-handle')) {
        return true;
      }

      if (target.closest([
        'button',
        'input',
        'textarea',
        'select',
        'option',
        'a',
        '[contenteditable="true"]',
        '[role="button"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[role="searchbox"]',
      ].join(','))) {
        return true;
      }

      const panelEl = target.closest(`#${APP.panelId}`);
      if (panelEl && panelEl.dataset.resizing === '1') {
        return true;
      }

      return false;
    }

    function ensureToolboxResizeHandle(panelEl) {
      if (!panelEl) return null;

      let handle = panelEl.querySelector('.cgpt-toolbox-resize-handle');
      if (handle) return handle;

      handle = document.createElement('div');
      handle.className = 'cgpt-toolbox-resize-handle xz-toolbox-resize-handle';
      handle.setAttribute('data-xz-resize-handle', '1');
      handle.title = '拖动调整工具箱大小';
      panelEl.appendChild(handle);
      return handle;
    }

    function ensureToolboxLeftResizeHandle(panelEl) {
      if (!panelEl) return null;

      let handle = panelEl.querySelector('.cgpt-toolbox-resize-left-handle');
      if (handle) return handle;

      handle = document.createElement('div');
      handle.className = 'cgpt-toolbox-resize-left-handle';
      handle.title = '向左拖拽调整宽度';
      panelEl.insertBefore(handle, panelEl.firstChild);
      return handle;
    }

    function bindToolboxLeftResize(panelEl) {
      if (!panelEl || panelEl.dataset.toolboxLeftResizeBound === '1') return;

      const leftResizeHandle = ensureToolboxLeftResizeHandle(panelEl);
      if (!leftResizeHandle) return;

      panelEl.dataset.toolboxLeftResizeBound = '1';

      leftResizeHandle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!panel || !root) {
          return;
        }

        ensureRootPositionAnchored();

        const rect = panel.getBoundingClientRect();
        const resizeState = {
          mode: 'left-width',
          pointerId: event.pointerId,
          startX: event.clientX,
          startLeft: rect.left,
          startTop: rect.top,
          startWidth: rect.width,
          startHeight: rect.height,
          startRight: rect.right,
        };

        panel.dataset.resizing = '1';
        panel.classList.add('cgpt-resizing');
        isResizingToolbox = true;

        appendLog(
          `[TOOLBOX_SIZE][LEFT_RESIZE_START] left=${Math.round(rect.left)} right=${Math.round(rect.right)} width=${Math.round(rect.width)}`,
        );

        try {
          leftResizeHandle.setPointerCapture(event.pointerId);
        } catch (error) {
          console.error('[ChatGPT toolbox] setPointerCapture left-resize failed', {
            message: error && error.message ? error.message : String(error),
            stack: error && error.stack ? error.stack : '',
          });
        }

        let leftResizeFinished = false;

        const onPointerMove = (moveEvent) => {
          moveEvent.preventDefault();
          moveEvent.stopPropagation();

          const dx = moveEvent.clientX - resizeState.startX;
          let nextLeft = resizeState.startLeft + dx;
          let nextWidth = resizeState.startWidth - dx;
          const maxWidth = getToolboxMaxWidth();
          const minWidth = getToolboxResizeMinWidth();
          const margin = TOOLBOX_SIZE_LIMITS.VIEWPORT_MARGIN;

          if (nextWidth > maxWidth) {
            nextWidth = maxWidth;
            nextLeft = resizeState.startRight - nextWidth;
          }
          if (nextWidth < minWidth) {
            nextWidth = minWidth;
            nextLeft = resizeState.startRight - nextWidth;
          }
          if (nextLeft < margin) {
            nextLeft = margin;
            nextWidth = resizeState.startRight - nextLeft;
          }

          scheduleApplyPanelResizeRect({
            left: Math.round(nextLeft),
            top: Math.round(resizeState.startTop),
            width: Math.round(nextWidth),
            height: Math.round(resizeState.startHeight),
          }, `left-resize:${Math.round(nextWidth)}`);

          appendResizeMoveLogThrottled(
            `[TOOLBOX_SIZE][LEFT_RESIZE_MOVE] width=${Math.round(nextWidth)} left=${Math.round(nextLeft)}`,
          );
        };

        const finishLeftResize = (upEvent, endReason) => {
          if (leftResizeFinished) {
            return;
          }
          leftResizeFinished = true;

          upEvent.preventDefault();
          upEvent.stopPropagation();

          window.removeEventListener('pointermove', onPointerMove, true);
          window.removeEventListener('pointerup', onPointerUp, true);
          window.removeEventListener('pointercancel', onPointerCancel, true);
          leftResizeHandle.removeEventListener('lostpointercapture', onLostPointerCapture, true);

          try {
            leftResizeHandle.releasePointerCapture(event.pointerId);
          } catch (error) {
            console.error('[ChatGPT toolbox] releasePointerCapture left-resize failed', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
          }

          flushPanelResizePendingRect(endReason);

          panel.dataset.resizing = '0';
          panel.classList.remove('cgpt-resizing');
          isResizingToolbox = false;

          const finalRect = panel.getBoundingClientRect();
          appendLog(
            `[TOOLBOX_SIZE][LEFT_RESIZE_DONE] left=${Math.round(finalRect.left)} width=${Math.round(finalRect.width)} height=${Math.round(finalRect.height)}`,
          );

          schedulePostDragLayout(() => {
            keepPanelInViewport({ save: false, reason: endReason });
            clampRootToViewport('toolbox-left-resize-end', { save: false });
            syncToolboxFloatingLayout('toolbox-left-resize-end');
            if (isPanelVisibleNow()) {
              savePanelPositionFromDom('toolbox-left-resize-end');
            }
          });

          savePanelSizeFromDom({ userAction: true, reason: endReason });
          rememberLastPanelVisibleRect('toolbox-left-resize-end');
          updateRestoreHotzone('toolbox-left-resize-end');
        };

        const onPointerUp = (upEvent) => {
          finishLeftResize(upEvent, 'left-resize-pointerup');
        };

        const onPointerCancel = (upEvent) => {
          finishLeftResize(upEvent, 'left-resize-pointercancel');
        };

        const onLostPointerCapture = (captureEvent) => {
          if (captureEvent.pointerId !== event.pointerId) {
            return;
          }
          finishLeftResize(captureEvent, 'left-resize-lostpointercapture');
        };

        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerCancel, true);
        leftResizeHandle.addEventListener('lostpointercapture', onLostPointerCapture, true);
      }, true);
    }

    function bindToolboxResize(panelEl) {
      if (!panelEl || panelEl.dataset.toolboxResizeBound === '1') return;

      const handle = ensureToolboxResizeHandle(panelEl);
      if (!handle) return;

      panelEl.dataset.toolboxResizeBound = '1';

      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!panel || !root) {
          return;
        }

        ensureRootPositionAnchored();

        const startX = event.clientX;
        const startY = event.clientY;
        const rect = panel.getBoundingClientRect();
        const startRect = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };

        panel.dataset.resizing = '1';
        panel.classList.add('cgpt-resizing');
        isResizingToolbox = true;

        appendLog(
          `[TOOLBOX_SIZE][RESIZE_START] mode=right-bottom left=${Math.round(startRect.left)} width=${Math.round(startRect.width)} maxWidth=${getToolboxMaxWidth()} viewportWidth=${getToolboxViewportWidth()}`,
        );

        try {
          handle.setPointerCapture(event.pointerId);
        } catch (error) {
          console.error('[ChatGPT toolbox] setPointerCapture resize failed', {
            message: error && error.message ? error.message : String(error),
            stack: error && error.stack ? error.stack : '',
          });
        }

        let toolboxResizeFinished = false;

        const onPointerMove = (moveEvent) => {
          moveEvent.preventDefault();
          moveEvent.stopPropagation();

          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          const nextRect = calculateRightResizeRect(startRect, dx, dy);

          scheduleApplyPanelResizeRect(nextRect, 'toolbox-resize-handle-move');

          appendResizeMoveLogThrottled(
            `[TOOLBOX_SIZE][RESIZE_MOVE] mode=right-bottom dx=${Math.round(dx)} width=${nextRect.width} left=${nextRect.left}`,
          );
        };

        const finishToolboxResize = (upEvent, endReason) => {
          if (toolboxResizeFinished) {
            return;
          }
          toolboxResizeFinished = true;

          upEvent.preventDefault();
          upEvent.stopPropagation();

          window.removeEventListener('pointermove', onPointerMove, true);
          window.removeEventListener('pointerup', onPointerUp, true);
          window.removeEventListener('pointercancel', onPointerCancel, true);
          handle.removeEventListener('lostpointercapture', onLostPointerCapture, true);

          try {
            handle.releasePointerCapture(event.pointerId);
          } catch (error) {
            console.error('[ChatGPT toolbox] releasePointerCapture resize failed', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
          }

          flushPanelResizePendingRect(endReason);

          panel.dataset.resizing = '0';
          panel.classList.remove('cgpt-resizing');
          isResizingToolbox = false;

          schedulePostDragLayout(() => {
            keepPanelInViewport({
              save: false,
              reason: 'toolbox-resize-end',
            });
            clampRootToViewport('toolbox-resize-end', {
              save: false,
            });
            syncToolboxFloatingLayout('toolbox-resize-end');

            if (isPanelVisibleNow()) {
              savePanelPositionFromDom('toolbox-resize-end');
            }
          });

          savePanelSizeFromDom({
            userAction: true,
            reason: endReason,
          });

          rememberLastPanelVisibleRect('toolbox-resize-end');
          updateRestoreHotzone('toolbox-resize-end');
        };

        const onPointerUp = (upEvent) => {
          finishToolboxResize(upEvent, 'toolbox-resize-handle-pointerup');
        };

        const onPointerCancel = (upEvent) => {
          finishToolboxResize(upEvent, 'toolbox-resize-handle-pointercancel');
        };

        const onLostPointerCapture = (captureEvent) => {
          if (captureEvent.pointerId !== event.pointerId) {
            return;
          }
          finishToolboxResize(captureEvent, 'toolbox-resize-lostpointercapture');
        };

        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerCancel, true);
        handle.addEventListener('lostpointercapture', onLostPointerCapture, true);
      }, true);
    }

    function getRootCurrentPosition() {
      const rect = root.getBoundingClientRect();

      return {
        left: rect.left,
        top: rect.top,
      };
    }

    function ensureRootPositionAnchored() {
      if (!root) return;

      const usesLeftTop = root.style.left && root.style.top
        && root.style.right === 'auto'
        && root.style.bottom === 'auto';

      if (usesLeftTop) return;

      const pos = getRootCurrentPosition();
      applyRootPosition(pos.left, pos.top);
    }

    function applyRootPosition(left, top) {
      if (!root) return;

      const safeLeft = Number.isFinite(left) ? left : PANEL_VIEWPORT_MARGIN;
      const safeTop = Number.isFinite(top) ? top : PANEL_VIEWPORT_MARGIN;

      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.left = `${Math.round(safeLeft)}px`;
      root.style.top = `${Math.round(safeTop)}px`;
    }

    function getHiddenToggleAnchorPosition(reason = '') {
      if (!root || !panel) {
        appendLog(`[TOOLBOX_HIDE_ANCHOR][skip] reason=${reason || '-'} missing-root-or-panel`);
        return null;
      }

      const margin = PANEL_VIEWPORT_MARGIN;
      const gap = 6;
      const now = Date.now();
      let source = 'panel-rect';
      let rect = null;

      if (
        lastPanelVisibleRect &&
        Number.isFinite(Number(lastPanelVisibleRect.left)) &&
        Number.isFinite(Number(lastPanelVisibleRect.top)) &&
        Number(lastPanelVisibleRect.width) > 0 &&
        Number(lastPanelVisibleRect.height) > 0 &&
        now - Number(lastPanelVisibleRect.updatedAt || 0) < 10000
      ) {
        rect = lastPanelVisibleRect;
        source = 'last-visible-panel-rect';
      } else {
        const panelRect = panel.getBoundingClientRect();
        if (!panelRect || panelRect.width <= 0 || panelRect.height <= 0) {
          appendLog(`[TOOLBOX_HIDE_ANCHOR][skip] reason=${reason || '-'} invalid-panel-rect`);
          return null;
        }
        rect = panelRect;
      }

      const hiddenWidth = HIDDEN_TOGGLE_SIZE && HIDDEN_TOGGLE_SIZE.width
        ? HIDDEN_TOGGLE_SIZE.width
        : 110;
      const hiddenHeight = HIDDEN_TOGGLE_SIZE && HIDDEN_TOGGLE_SIZE.height
        ? HIDDEN_TOGGLE_SIZE.height
        : 34;

      const rawLeft = Number(rect.left);
      const rawTop = Math.max(
        margin,
        Number(rect.top) - hiddenHeight - gap,
      );
      const left = clampNumber(
        rawLeft,
        margin,
        Math.max(margin, window.innerWidth - hiddenWidth - margin),
      );
      const top = clampNumber(
        rawTop,
        margin,
        Math.max(margin, window.innerHeight - hiddenHeight - margin),
      );

      appendLog(
        `[TOOLBOX_HIDE_ANCHOR][calc] reason=${reason || '-'} source=${source} left=${Math.round(left)} top=${Math.round(top)} panelLeft=${Math.round(Number(rect.left))} panelTop=${Math.round(Number(rect.top))}`,
      );

      return {
        left,
        top,
        source,
      };
    }

    function saveHiddenTitlePosition(pos, reason = '') {
      if (!pos) {
        return false;
      }

      const left = Number(pos.left);
      const top = Number(pos.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        appendLog(`[TOOLBOX_HIDE_TITLE][save-skip] reason=${reason || '-'} invalid-pos=1`);
        return false;
      }

      const margin = PANEL_VIEWPORT_MARGIN;
      const width = HIDDEN_TOGGLE_SIZE && HIDDEN_TOGGLE_SIZE.width
        ? HIDDEN_TOGGLE_SIZE.width
        : 110;
      const height = HIDDEN_TOGGLE_SIZE && HIDDEN_TOGGLE_SIZE.height
        ? HIDDEN_TOGGLE_SIZE.height
        : 34;

      hiddenTitlePosition = {
        left: clampNumber(left, margin, Math.max(margin, window.innerWidth - width - margin)),
        top: clampNumber(top, margin, Math.max(margin, window.innerHeight - height - margin)),
        updatedAt: Date.now(),
        reason: String(reason || '-'),
      };

      hiddenTitlePositionLocked = true;
      MemoryManager.set(MemoryManager.KEYS.hiddenTitlePosition, hiddenTitlePosition);

      appendLog(
        `[TOOLBOX_HIDE_TITLE][save] reason=${reason || '-'} left=${Math.round(hiddenTitlePosition.left)} top=${Math.round(hiddenTitlePosition.top)}`,
      );

      return true;
    }

    function clearHiddenTitlePosition(reason = '') {
      hiddenTitlePosition = null;
      hiddenTitlePositionLocked = false;
      MemoryManager.remove(MemoryManager.KEYS.hiddenTitlePosition);

      appendLog(`[TOOLBOX_HIDE_TITLE][clear] reason=${reason || '-'}`);
    }

    function readPersistedHiddenTitlePosition() {
      const saved = MemoryManager.get(MemoryManager.KEYS.hiddenTitlePosition, null);
      if (!saved || typeof saved !== 'object') {
        return null;
      }

      const left = Number(saved.left);
      const top = Number(saved.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
      }

      return {
        left,
        top,
        updatedAt: saved.updatedAt || 0,
        reason: saved.reason || 'persisted',
        source: 'memory',
      };
    }

    function getLockedHiddenTitlePosition(reason = '') {
      if (
        hiddenTitlePositionLocked &&
        hiddenTitlePosition &&
        Number.isFinite(Number(hiddenTitlePosition.left)) &&
        Number.isFinite(Number(hiddenTitlePosition.top))
      ) {
        return hiddenTitlePosition;
      }

      const persisted = readPersistedHiddenTitlePosition();
      if (persisted) {
        hiddenTitlePosition = persisted;
        hiddenTitlePositionLocked = true;
        return hiddenTitlePosition;
      }

      const pos = getHiddenToggleAnchorPosition(reason || 'get-locked-hidden-title-position');

      if (!pos) {
        return null;
      }

      saveHiddenTitlePosition(pos, reason || 'get-locked-hidden-title-position');
      return hiddenTitlePosition;
    }

    function anchorRootToHiddenTogglePosition(reason = '') {
      const pos = getHiddenToggleAnchorPosition(reason);

      if (!pos) {
        return false;
      }

      saveHiddenTitlePosition(pos, reason || 'anchor-root-hidden-toggle');

      applyRootPosition(pos.left, pos.top);

      appendLog(
        `[TOOLBOX_HIDE_ANCHOR][apply] reason=${reason || '-'} source=${pos.source || '-'} left=${Math.round(pos.left)} top=${Math.round(pos.top)}`,
      );

      return true;
    }

    function updateToolboxResponsiveClass(targetPanel, reason = '-') {
      const panelEl = targetPanel || panel;
      if (!panelEl) {
        return;
      }

      const width = Math.round(panelEl.getBoundingClientRect().width || panelEl.offsetWidth || 0);
      const xs = width > 0 && width < 360;
      const sm = width >= 360 && width < 520;
      const normal = width >= 520;

      const targets = [panelEl];
      if (root && root !== panelEl) {
        targets.push(root);
      }

      targets.forEach((el) => {
        el.classList.toggle('cgpt-toolbox-xs', xs);
        el.classList.toggle('cgpt-toolbox-sm', sm);
        el.classList.toggle('cgpt-toolbox-normal', normal);
        el.dataset.cgptPanelWidth = String(width);
      });

      console.log('[TOOLBOX_RESPONSIVE][CLASS]', {
        reason,
        width,
        xs,
        sm,
        normal,
      });
    }

    function bindToolboxResponsiveWatcher() {
      if (!panel) {
        return;
      }

      updateToolboxResponsiveClass(panel, 'bind-init');

      if (typeof ResizeObserver === 'function' && !toolboxResponsiveObserver) {
        toolboxResponsiveObserver = new ResizeObserver(() => {
          try {
            updateToolboxResponsiveClass(panel, 'resize-observer');
          } catch (error) {
            console.error('[TOOLBOX_RESPONSIVE][OBSERVER_FAILED]', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
          }
        });

        try {
          toolboxResponsiveObserver.observe(panel);
        } catch (error) {
          console.error('[TOOLBOX_RESPONSIVE][OBSERVE_FAILED]', {
            message: error && error.message ? error.message : String(error),
            stack: error && error.stack ? error.stack : '',
          });
        }
      }

      if (toolboxResponsiveWindowBound) {
        return;
      }

      toolboxResponsiveWindowBound = true;

      const scheduleResponsiveUpdate = () => {
        window.requestAnimationFrame(() => {
          try {
            updateToolboxResponsiveClass(panel, 'window-resize');
          } catch (error) {
            console.error('[TOOLBOX_RESPONSIVE][WINDOW_RESIZE_FAILED]', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
          }
        });
      };

      window.addEventListener('resize', scheduleResponsiveUpdate);
      window.addEventListener('orientationchange', scheduleResponsiveUpdate);

      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleResponsiveUpdate);
      }
    }

    function applyToolboxPanelMinWidthMode() {
      if (!panel) {
        return;
      }

      if (compactMode) {
        panel.classList.remove('cgpt-mode-complete');
        panel.style.minWidth = `${TOOLBOX_MIN_WIDTH_COMPACT}px`;
      } else {
        panel.classList.add('cgpt-mode-complete');
        panel.style.minWidth = `${TOOLBOX_MIN_WIDTH_FULL}px`;
      }
    }

    function shouldHideTopStatusBadge(badge, panelWidth) {
      if (!badge) {
        return false;
      }
      if (
        badge.id === 'cgpt-page-input-state'
        || badge.classList.contains('cgpt-header-status-chip')
        || badge.classList.contains('cgpt-toolbox-status-primary-badge')
      ) {
        return false;
      }
      // 页ID、轮数必须显示。
      if (
        badge.classList.contains('cgpt-toolbox-must-show-badge')
        || badge.classList.contains('cgpt-toolbox-page-turn-badge')
        || badge.classList.contains('cgpt-toolbox-turn-count-badge')
      ) {
        return false;
      }
      // 本地上传 / 本地消息不再因为 620px 阈值直接隐藏。
      // 这两个状态是顶部额度判断的重要信息，应允许换行展示。
      if (
        badge.classList.contains('cgpt-toolbox-upload-quota-badge')
        || badge.classList.contains('cgpt-toolbox-message-quota-badge')
      ) {
        return false;
      }
      // 其他低优先级 badge 如后续需要隐藏，可在这里单独处理。
      // 当前默认不隐藏，避免出现“明明有空间但状态消失”的问题。
      return false;
    }

    function updateToolboxStatusVisibilityClass(reason = '-') {
      if (!panel) {
        return;
      }

      const width = Math.round(panel.getBoundingClientRect().width || panel.offsetWidth || 0);
      const narrow = width > 0 && width < TOOLBOX_SIZE_LIMITS.NARROW_WIDTH;
      const extraNarrow = width > 0 && width < TOOLBOX_SIZE_LIMITS.EXTRA_NARROW_WIDTH;
      panel.classList.toggle('cgpt-toolbox-narrow', narrow);
      panel.classList.toggle('cgpt-toolbox-extra-narrow', extraNarrow);

      appendLog(
        `[TOOLBOX_LAYOUT][MODE] width=${width} narrow=${narrow ? 1 : 0} extraNarrow=${extraNarrow ? 1 : 0} reason=${reason}`,
      );

      const row = panel.querySelector('.cgpt-toolbox-header-status-row');
      if (row) {
        row.querySelectorAll('.cgpt-toolbox-top-status-badge, .cgpt-status-pill').forEach((badge) => {
          if (shouldHideTopStatusBadge(badge, width)) {
            badge.style.display = 'none';
            return;
          }
          // 只恢复由本函数写入的 display:none，不覆盖 CSS 正常布局。
          badge.style.display = '';
          if (badge.classList.contains('cgpt-toolbox-upload-quota-badge')) {
            const text = String(badge.textContent || '').trim();
            if (text.startsWith('本地上传:')) {
              badge.textContent = text.replace(/^本地上传:/, '上传:');
            }
          }
          if (badge.classList.contains('cgpt-toolbox-message-quota-badge')) {
            const text = String(badge.textContent || '').trim();
            if (text.startsWith('本地消息:')) {
              badge.textContent = text.replace(/^本地消息:/, '消息:');
            }
          }
        });
      }

      const uploadBadgeVisible = !!row && !!row.querySelector('.cgpt-toolbox-upload-quota-badge:not([style*="display: none"])');
      const messageBadgeVisible = !!row && !!row.querySelector('.cgpt-toolbox-message-quota-badge:not([style*="display: none"])');
      appendLog(
        `[TOOLBOX_LAYOUT][STATUS_VISIBILITY] reason=${reason} width=${width} narrow=${narrow ? 1 : 0} extraNarrow=${extraNarrow ? 1 : 0} uploadBadgeVisible=${uploadBadgeVisible ? 1 : 0} messageBadgeVisible=${messageBadgeVisible ? 1 : 0}`,
      );
    }

    function updateToolboxNarrowClass(reason = '-') {
      updateToolboxStatusVisibilityClass(reason);
    }

    function detectTopStatusOverflow(reason = '-', options = {}) {
      if (!panel) {
        return false;
      }

      const row = panel.querySelector('.cgpt-toolbox-header-status-row');
      if (!row) {
        return false;
      }

      const panelRect = panel.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const overflowTop = rowRect.top < panelRect.top - 1;
      const overflowLeft = rowRect.left < panelRect.left - 1;
      const overflowRight = rowRect.right > panelRect.right + 1;
      const hasOverflow = overflowTop || overflowLeft || overflowRight;

      if (hasOverflow) {
        if (options.log !== false) {
          appendLog(
            `[TOOLBOX_LAYOUT][TOP_STATUS_OVERFLOW] reason=${reason} overflowRight=${overflowRight ? 1 : 0} overflowLeft=${overflowLeft ? 1 : 0} overflowTop=${overflowTop ? 1 : 0} panel=${Math.round(panelRect.width)} row=${Math.round(rowRect.width)}`,
          );
        }

        if (options.fix !== false) {
          updateToolboxStatusVisibilityClass(`overflow:${reason}`);
        }
      }

      return hasOverflow;
    }

    function detectTopBadgeOverflow(reason = '-', options = {}) {
      return detectTopStatusOverflow(reason, options);
    }

    function syncToolboxHeaderLayout(reason = '-') {
      updateToolboxResponsiveClass(panel, reason);
      updateToolboxStatusVisibilityClass(reason);
      detectTopStatusOverflow(reason);
      if (typeof renderToolboxHeaderStatus === 'function') {
        try {
          const runtimeState = typeof getToolboxRuntimeStateSafe === 'function'
            ? getToolboxRuntimeStateSafe()
            : {};
          renderToolboxHeaderStatus(
            `syncToolboxHeaderLayout:${reason || '-'}`,
            runtimeState,
          );
        } catch (error) {
          const message = error && error.message ? error.message : String(error);
          const stack = error && error.stack ? error.stack : '';
          console.warn('[TOOLBOX_HEADER][SYNC_FAILED]', message, stack);
          appendLog(`[TOOLBOX_HEADER][SYNC_FAILED] reason=${reason || '-'} error=${message}`);
          if (stack) {
            appendLog(`[TOOLBOX_HEADER][SYNC_FAILED_STACK] ${stack}`);
          }
        }
      }
      ensureSingleCompactModeButton();
    }

    function clampToolboxPanelToViewport(targetPanel, reason = '-') {
      const panelEl = targetPanel || panel;
      if (!panelEl) {
        return;
      }

      const rect = panelEl.getBoundingClientRect();
      const fitted = fitPanelRectInViewport({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });

      const sizeChanged = Math.abs(fitted.width - rect.width) > 0.5
        || Math.abs(fitted.height - rect.height) > 0.5;
      const posChanged = Math.abs(fitted.left - rect.left) > 0.5
        || Math.abs(fitted.top - rect.top) > 0.5;

      if (sizeChanged || posChanged) {
        applyPanelResizeRect(fitted, reason);
      } else {
        panelEl.style.left = `${fitted.left}px`;
        panelEl.style.top = `${fitted.top}px`;
      }

      appendLog(
        `[TOOLBOX_POSITION][CLAMP_VIEWPORT] reason=${reason} left=${Math.round(rect.left)}->${fitted.left} top=${Math.round(rect.top)}->${fitted.top} width=${Math.round(rect.width)}->${fitted.width} height=${Math.round(rect.height)}->${fitted.height}`,
      );
    }

    function clampPanelPosition(pos) {
      if (!panel) {
        return {
          left: PANEL_VIEWPORT_MARGIN,
          top: PANEL_VIEWPORT_MARGIN,
        };
      }

      const rect = panel.getBoundingClientRect();
      const width = rect.width || PANEL_DEFAULT_SIZE.width;
      const height = rect.height || PANEL_DEFAULT_SIZE.height;

      const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - width);
      const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - height - PANEL_VIEWPORT_MARGIN);

      const rawLeft = Number(pos.left);
      const rawTop = Number(pos.top);
      const left = Number.isFinite(rawLeft) ? rawLeft : PANEL_VIEWPORT_MARGIN;
      const top = Number.isFinite(rawTop) ? rawTop : PANEL_VIEWPORT_MARGIN;

      return {
        left: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(left, maxLeft)),
        top: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop)),
      };
    }

    function applyPanelPosition(left, top, options = {}) {
      if (!panel) {
        console.warn('[ChatGPT toolbox] applyPanelPosition: panel 未初始化');
        return;
      }

      const reason = String(options.reason || 'applyPanelPosition').trim() || 'applyPanelPosition';

      const safe = clampPanelPosition({
        left,
        top,
      });

      panel.style.position = 'fixed';
      panel.style.left = `${Math.round(safe.left)}px`;
      panel.style.top = `${Math.round(safe.top)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.dataset.userPositionLocked = '1';

      if (root) {
        root.style.position = 'fixed';
        root.style.left = '0px';
        root.style.top = '0px';
        root.style.right = 'auto';
        root.style.bottom = 'auto';
        root.style.width = '0px';
        root.style.height = '0px';
        root.style.transform = '';
      }

      window.requestAnimationFrame(() => {
        clampToolboxPanelToViewport(panel, reason);
        updateToolboxStatusVisibilityClass(reason);
        rememberLastPanelVisibleRect(reason);
      });
    }

    function getToolboxPanelElementForRect() {
      return panel || document.getElementById(APP.panelId);
    }

    function isToolboxPanelRectValid(rect) {
      return !!(
        rect
        && Number.isFinite(rect.left)
        && Number.isFinite(rect.top)
        && Number.isFinite(rect.width)
        && Number.isFinite(rect.height)
        && rect.width > 80
        && rect.height > 80
      );
    }

    function clampToolboxPanelRect(rect) {
      const fitted = fitPanelRectInViewport({
        left: Number(rect.left),
        top: Number(rect.top),
        width: Number(rect.width),
        height: Number(rect.height),
      });

      return {
        left: Math.round(fitted.left),
        top: Math.round(fitted.top),
        width: Math.round(fitted.width),
        height: Math.round(fitted.height),
      };
    }

    function loadToolboxPanelRect(reason = '') {
      if (lastPanelVisibleRect && isToolboxPanelRectValid(lastPanelVisibleRect)) {
        return {
          left: Number(lastPanelVisibleRect.left),
          top: Number(lastPanelVisibleRect.top),
          width: Number(lastPanelVisibleRect.width),
          height: Number(lastPanelVisibleRect.height),
          savedAt: Number(lastPanelVisibleRect.updatedAt || 0),
          reason: String(lastPanelVisibleRect.reason || ''),
        };
      }

      let raw = '';
      try {
        raw = localStorage.getItem(TOOLBOX_PANEL_RECT_KEY) || '';
      } catch (error) {
        console.error('[TOOLBOX_POSITION][LOAD_READ_ERROR]', {
          reason,
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        });
        return null;
      }

      if (!raw) {
        console.info('[TOOLBOX_POSITION][LOAD_EMPTY]', { reason });
        return null;
      }

      try {
        const payload = JSON.parse(raw);
        const valid = payload
          && Number.isFinite(Number(payload.left))
          && Number.isFinite(Number(payload.top))
          && Number.isFinite(Number(payload.width))
          && Number.isFinite(Number(payload.height))
          && Number(payload.width) > 80
          && Number(payload.height) > 80;

        if (!valid) {
          console.warn('[TOOLBOX_POSITION][LOAD_INVALID]', { reason, raw });
          return null;
        }

        return {
          left: Number(payload.left),
          top: Number(payload.top),
          width: Number(payload.width),
          height: Number(payload.height),
          savedAt: Number(payload.savedAt || 0),
          reason: String(payload.reason || ''),
        };
      } catch (error) {
        console.error('[TOOLBOX_POSITION][LOAD_PARSE_ERROR]', {
          reason,
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
          raw,
        });
        return null;
      }
    }

    function saveToolboxPanelRect(reason = '') {
      const panelEl = getToolboxPanelElementForRect();
      if (!panelEl) {
        console.warn('[TOOLBOX_POSITION][SAVE_SKIP]', { reason, found: 0 });
        return false;
      }

      if (panelEl.dataset.toolboxHidden === '1') {
        appendLog(`[TOOLBOX_POSITION][SAVE_SKIP] reason=${reason || '-'} panelAlreadyHidden=1`);
        return false;
      }

      if (panelEl.classList.contains('cgpt-toolbox-hidden')) {
        appendLog(`[TOOLBOX_POSITION][SAVE_SKIP] reason=${reason || '-'} classHidden=1`);
        return false;
      }

      const style = window.getComputedStyle(panelEl);
      if (style.display === 'none' || style.visibility === 'hidden') {
        console.warn('[TOOLBOX_POSITION][SAVE_SKIP_INVALID_RECT]', {
          reason,
          display: style.display,
          visibility: style.visibility,
        });
        return false;
      }

      const rect = panelEl.getBoundingClientRect();
      if (!isToolboxPanelRectValid(rect)) {
        console.warn('[TOOLBOX_POSITION][SAVE_SKIP_INVALID_RECT]', {
          reason,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          display: style.display,
          visibility: style.visibility,
        });
        return false;
      }

      const payload = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        savedAt: Date.now(),
        reason: String(reason || ''),
      };

      lastPanelVisibleRect = {
        ...payload,
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        updatedAt: payload.savedAt,
      };

      try {
        localStorage.setItem(TOOLBOX_PANEL_RECT_KEY, JSON.stringify(payload));
      } catch (error) {
        console.error('[TOOLBOX_POSITION][SAVE_WRITE_ERROR]', {
          reason,
          message: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        });
      }

      if (panelEl === panel || !panel) {
        panel = panelEl;
      }

      savePanelPositionOnly(`save-rect:${reason || '-'}`, payload.left, payload.top);
      savePanelSizeOnly(
        `save-rect:${reason || '-'}`,
        payload.width,
        payload.height,
        compactMode,
      );

      panelEl.dataset.userPositionLocked = '1';

      console.info('[TOOLBOX_POSITION][SAVE]', payload);
      appendLog(
        `[TOOLBOX_POSITION][SAVE] reason=${payload.reason} left=${payload.left} top=${payload.top} width=${payload.width} height=${payload.height}`,
      );

      return true;
    }

    function restoreToolboxPanelRect(reason = '') {
      const panelEl = getToolboxPanelElementForRect();
      if (!panelEl) {
        console.warn('[TOOLBOX_POSITION][RESTORE_SKIP]', { reason, found: 0 });
        return false;
      }

      if (ENABLE_STABLE_TOOLBOX_GEOMETRY
        && typeof ToolboxStableGeometry !== 'undefined'
        && typeof ToolboxStableGeometry.readSavedGeometry === 'function') {
        const stableSaved = ToolboxStableGeometry.readSavedGeometry();
        if (stableSaved) {
          if (!panel || panelEl !== panel) {
            panel = panelEl;
          }
          const rect = clampToolboxPanelRect(stableSaved);
          applyPanelRect(rect);
          panelEl.dataset.userPositionLocked = '1';
          syncLegacyPanelRectFromGeometry(rect, `restore-v2:${reason || '-'}`);
          console.info('[TOOLBOX_POSITION][RESTORE_V2]', { reason, applied: rect });
          appendLog(
            `[TOOLBOX_POSITION][RESTORE_V2] reason=${reason || '-'} left=${rect.left} top=${rect.top} width=${rect.width} height=${rect.height}`,
          );
          return true;
        }
      }

      const saved = loadToolboxPanelRect(reason);
      if (!saved) {
        console.info('[TOOLBOX_POSITION][RESTORE_DEFAULT_SKIP_NO_SAVED_RECT]', { reason });
        return false;
      }

      if (!panel || panelEl !== panel) {
        panel = panelEl;
      }

      const rect = clampToolboxPanelRect(saved);

      applyPanelRect(rect);
      panelEl.dataset.userPositionLocked = '1';

      console.info('[TOOLBOX_POSITION][RESTORE]', { reason, saved, applied: rect });
      appendLog(
        `[TOOLBOX_POSITION][RESTORE] reason=${reason || '-'} left=${rect.left} top=${rect.top} width=${rect.width} height=${rect.height}`,
      );

      return true;
    }

    function rememberLastPanelVisibleRect(reason = '') {
      saveToolboxPanelRect(reason || 'remember-last-visible-rect');
    }

    function ensureRestoreHotzoneElement() {
      restoreHotzone = document.getElementById(APP.restoreHotzoneId);

      if (!restoreHotzone) {
        if (!document.body) {
          console.warn('[ChatGPT toolbox] ensureRestoreHotzoneElement: document.body 不存在');
          appendLog('[TOOLBOX_RESTORE_HOTZONE][warn] document.body 缺失，无法创建恢复热区');
          return;
        }

        restoreHotzone = document.createElement('div');
        restoreHotzone.id = APP.restoreHotzoneId;
        restoreHotzone.setAttribute('aria-hidden', 'true');
        document.body.appendChild(restoreHotzone);
      }

      bindRestoreHotzoneEvents();
    }

    function hideRestoreHotzone(reason = '') {
      if (!restoreHotzone) return;

      restoreHotzone.classList.remove('active');
      Object.assign(restoreHotzone.style, {
        left: '',
        right: '',
        top: '',
        bottom: '',
        width: '',
        height: '',
      });

      appendLogThrottled(
        `TOOLBOX_RESTORE_HOTZONE_HIDE:${reason || '-'}`,
        `[TOOLBOX_RESTORE_HOTZONE][hide] reason=${reason || '-'}`,
        5000,
      );
    }

    function ensureRestoreHandleElement() {
      restoreHandle = document.getElementById(APP.restoreHandleId);

      if (!restoreHandle) {
        if (!document.body) {
          console.warn('[ChatGPT toolbox] ensureRestoreHandleElement: document.body 不存在');
          appendLog('[TOOLBOX_RESTORE_HANDLE][warn] document.body 缺失，无法创建恢复把手');
          return;
        }

        restoreHandle = document.createElement('button');
        restoreHandle.id = APP.restoreHandleId;
        restoreHandle.type = 'button';
        restoreHandle.textContent = '小张工具箱';
        restoreHandle.title = '点击恢复工具箱';
        document.body.appendChild(restoreHandle);
      }

      bindRestoreHandleEvents();
    }

    function showRestoreHandle(reason = '', options = {}) {
      ensureRestoreHandleElement();

      if (!restoreHandle) return;

      const force = options.force === true;

      if (!force && isFloatingTitleActuallyVisible()) {
        hideRestoreHandle(`skip-floating-title-visible:${reason || '-'}`);

        appendLog(
          `[TOOLBOX_RESTORE_HANDLE][show-skip] reason=${reason || '-'} floatingTitleVisible=1`,
        );

        return;
      }

      const rect = lastPanelVisibleRect;

      let left = window.innerWidth - 150;
      let top = 80;

      if (rect) {
        left = Math.max(12, Math.min(window.innerWidth - 150, Number(rect.left) || left));
        top = Math.max(12, Math.min(window.innerHeight - 48, Number(rect.top) || top));
      }

      restoreHandle.textContent = TOOLBOX_RESTORE_HANDLE_TITLE;
      restoreHandle.title = '点击恢复工具箱';

      Object.assign(restoreHandle.style, {
        left: `${Math.round(left)}px`,
        right: '',
        top: `${Math.round(top)}px`,
        bottom: '',
        display: 'inline-flex',
        visibility: 'visible',
        opacity: '1',
        pointerEvents: 'auto',
      });

      restoreHandle.classList.add('active');

      appendLog(
        `[TOOLBOX_RESTORE_HANDLE][show] reason=${reason || '-'} left=${Math.round(left)} top=${Math.round(top)} force=${force ? 1 : 0}`,
      );
    }

    function hideRestoreHandle(reason = '') {
      if (!restoreHandle) return;

      restoreHandle.classList.remove('active');
      restoreHandle.style.display = 'none';

      appendLogThrottled(
        `TOOLBOX_RESTORE_HANDLE_HIDE:${reason || '-'}`,
        `[TOOLBOX_RESTORE_HANDLE][hide] reason=${reason || '-'}`,
        5000,
      );
    }

    function bindRestoreHandleEvents() {
      if (!restoreHandle) return;

      if (restoreHandle.dataset.bound === '1') {
        return;
      }

      restoreHandle.dataset.bound = '1';

      restoreHandle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        restoreToolboxFromHiddenState('restore-handle-click');
      });

      restoreHandle.addEventListener('mouseenter', () => {
        restoreToolboxFromHiddenState('restore-handle-hover');
      });

      appendLog('[TOOLBOX_RESTORE_HANDLE][bind-ok]');
    }

    function restoreToolboxFromHiddenState(reason = '', options = {}) {
      if (!root || !panel) {
        appendLog(`[TOOLBOX_RESTORE][skip] reason=${reason || '-'} missing-root-or-panel`);
        return;
      }

      if (isDraggingToolbox || isResizingToolbox) {
        appendLog(`[TOOLBOX_RESTORE][skip] reason=${reason || '-'} dragging-or-resizing`);
        return;
      }

      const reasonText = String(reason || '-');
      const headerWasHidden = isHeaderPanelUiHidden();

      if (headerWasHidden) {
        const panelEl = getToolboxPanelElementForRect();
        if (panelEl) {
          panelEl.dataset.toolboxHidden = '0';
          panelEl.classList.remove('cgpt-toolbox-panel-hidden');
        }
        const restoreButton = document.getElementById(TOOLBOX_RESTORE_BUTTON_ID);
        if (restoreButton) {
          restoreButton.style.display = 'none';
        }
        writeToolboxPanelHiddenState(false);
        appendLog(`[TOOLBOX_VISIBILITY][SHOW] reason=restore-clear-header-hidden:${reasonText}`);
      }

      forceShowingUntil = Date.now() + 3000;
      clearHiddenTitlePosition(`restore:${reasonText}`);
      cleanupRemovedEdgeAutoHideState(`restore:${reasonText}`);
      forcePanelVisible(`restore:${reasonText}`);

      const restoredFromSavedRect = restoreToolboxPanelRect(`restore:${reasonText}`);
      if (!restoredFromSavedRect) {
        const savedPos = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        const size = normalizePanelSize(
          MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
        );

        let left = Number.isFinite(Number(savedPos.left))
          ? Number(savedPos.left)
          : window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN;

        let top = Number.isFinite(Number(savedPos.top))
          ? Number(savedPos.top)
          : PANEL_VIEWPORT_MARGIN;

        left = Math.max(
          PANEL_VIEWPORT_MARGIN,
          Math.min(window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN, left),
        );

        top = Math.max(
          PANEL_VIEWPORT_MARGIN,
          Math.min(window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN, top),
        );

        applyPanelSize(size, {
          reason: `restore-from-hidden:${reasonText}`,
        });
        applyPanelPosition(left, top);
        appendLog(
          `[TOOLBOX_POSITION][RESTORE_GLOBAL] reason=${reasonText} left=${Math.round(left)} top=${Math.round(top)}`,
        );
      }

      hideRestoreHotzone(`restore:${reason || '-'}`);
      hideRestoreHandle(`restore:${reason || '-'}`);
      syncPanelHiddenClass(`restore:${reason || '-'}`);

      const showRect = panel.getBoundingClientRect();
      appendLog(
        `[TOOLBOX_RESTORE][show] reason=${reasonText} restoredFromRect=${restoredFromSavedRect ? 1 : 0} ` +
        `left=${Math.round(showRect.left)} top=${Math.round(showRect.top)} ` +
        `width=${Math.round(showRect.width)} height=${Math.round(showRect.height)}`,
      );

      window.requestAnimationFrame(() => {
        panel.style.display = 'flex';
        panel.style.pointerEvents = 'auto';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';

        if (!restoreToolboxPanelRect(`after-show:${reasonText}`)) {
          applySavedPanelPosition(`after-show:${reasonText}`);
        }

        keepPanelInViewport({
          save: true,
        });

        const panelRect = panel.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();

        appendLog(
          `[TOOLBOX_RESTORE][rect-check] reason=${reason || '-'} ` +
          `rootLeft=${Math.round(rootRect.left)} rootTop=${Math.round(rootRect.top)} ` +
          `panelLeft=${Math.round(panelRect.left)} panelTop=${Math.round(panelRect.top)} ` +
          `panelRight=${Math.round(panelRect.right)} panelBottom=${Math.round(panelRect.bottom)} ` +
          `panelWidth=${Math.round(panelRect.width)} panelHeight=${Math.round(panelRect.height)} ` +
          `visible=${isPanelVisibleNow() ? 1 : 0}`
        );

        syncToolboxFloatingLayout(`restore:${reason || '-'}`);
        updateFloatingTitlePosition(`restore:${reason || '-'}`);
        rememberLastPanelVisibleRect(`restore:${reason || '-'}`);

        appendLog(
          `[TOOLBOX_RESTORE][after-frame] panelHidden=${panel.classList.contains('cgpt-toolbox-hidden') ? 1 : 0}`,
        );
      });
    }

    function isRestoreHandleActuallyVisible() {
      if (!restoreHandle) return false;

      const style = window.getComputedStyle(restoreHandle);
      const rect = restoreHandle.getBoundingClientRect();

      return (
        restoreHandle.classList.contains('active')
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 10
        && rect.height > 10
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight
      );
    }

    function isFloatingTitleActuallyVisible() {
      const floatingTitle = getFloatingTitleEl();

      if (!floatingTitle) {
        return false;
      }

      return isElementVisible(floatingTitle);
    }

    function repairInvisibleToolboxState(reason = '') {
      if (!root || !panel) return;

      if (isHeaderPanelUiHidden()) {
        if (!isToolboxRestoreButtonActuallyVisible()) {
          setToolboxPanelHidden(true, `repair-restore-button:${reason || '-'}`);
        }
        return;
      }

      if (isPanelHiddenNow() && hiddenTitlePositionLocked) {
        updateFloatingTitlePosition(`repair-hidden-title:${reason || '-'}`);
        appendLog(`[TOOLBOX_HIDE_TITLE][repair-skip-root] reason=${reason || '-'}`);
        return;
      }

      const panelHidden = isPanelHiddenNow();
      const restoreVisible = isRestoreHandleActuallyVisible();
      const floatingTitleVisible = isFloatingTitleActuallyVisible();

      if (panelHidden && !restoreVisible && !floatingTitleVisible) {
        appendLog(
          `[TOOLBOX_REPAIR][restore-entry-missing] reason=${reason || '-'} panelHidden=${panelHidden ? 1 : 0}`,
        );

        showRestoreHandle(`repair:${reason || '-'}`, {
          force: true,
        });

        updateRestoreHotzone(`repair:${reason || '-'}`);
      }
    }

    function isToolboxInAnyHiddenState() {
      if (!panel || !root) return false;

      const panelHidden = isPanelHiddenNow();
      const visuallyHidden =
        !panelHidden &&
        !isPanelVisibleNow();

      return panelHidden || visuallyHidden;
    }

    function bindToolboxConsoleRescueApi() {
      const target = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

      if (target.__cgptToolboxRescueBound === '1') {
        return;
      }

      target.__cgptToolboxRescueBound = '1';

      // @deprecated 控制台救援 API，确认无旧版救援脚本依赖后再删除
      registerToolboxDebugApis({
        __cgptToolboxShow: () => {
          appendLog('[TOOLBOX_RESCUE_API][CALL] name=__cgptToolboxShow');
          restoreToolboxFromHiddenState('console');
        },
        __cgptToolboxReset: () => {
          appendLog('[TOOLBOX_RESCUE_API][CALL] name=__cgptToolboxReset');
          resetToolboxPosition();
          restoreToolboxFromHiddenState('console-reset');
        },
        __cgptToolboxForceShow: () => {
          appendLog('[TOOLBOX_RESCUE_API][CALL] name=__cgptToolboxForceShow');
          forceShowingUntil = Date.now() + 10000;
          cleanupRemovedEdgeAutoHideState('console-force-show');

          if (panel) {
            panel.classList.remove('cgpt-toolbox-hidden');
            panel.style.display = 'flex';
            panel.style.pointerEvents = 'auto';
            panel.style.visibility = 'visible';
            panel.style.opacity = '1';
          }

          MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

          applyPanelSize(normalizePanelSize(
            MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback()
          ), {
            reason: 'console-force-show',
          });
          applyPanelPosition(80, 80);
          hideRestoreHotzone('console-force-show');
          hideRestoreHandle('console-force-show');
          syncPanelHiddenClass('console-force-show');
          syncToolboxFloatingLayout('console-force-show');
          updateFloatingTitlePosition('console-force-show');
          repairInvisibleToolboxState('console-force-show');

          appendLog('[TOOLBOX_RESTORE][console-force-show]');
        },
        __cgptToolboxClearPosition: () => {
          MemoryManager.set(MemoryManager.KEYS.panelPosition, {
            left: 80,
            top: 80,
            mode: 'panel',
            edge: '',
          });

          MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
          cleanupRemovedEdgeAutoHideState('console-clear-position');
          forcePanelVisible('console-clear-position');
          clearUserPanelSizeLock('explicit-reset');

          if (panel) {
            applyPanelSize(getPanelSizeFallback(), {
              reason: 'explicit-reset',
              force: true,
            });
            applyPanelPosition(80, 80);
          }

          appendLog('[TOOLBOX_POSITION][CLEAR] left=80 top=80 mode=panel');
        },
      }, {
        override: true,
        target,
      });
    }

    function updateRestoreHotzone(reason = '') {
      ensureRestoreHotzoneElement();

      if (!restoreHotzone || !root || !panel) {
        return;
      }

      const panelHidden = isPanelHiddenNow();
      const shouldShow = panelHidden;

      if (!shouldShow) {
        hideRestoreHotzone(`visible:${reason || '-'}`);
        hideRestoreHandle(`visible:${reason || '-'}`);
        return;
      }

      let rect = lastPanelVisibleRect;

      if (!rect) {
        const savedPos = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        const size = normalizePanelSize(
          MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
        );

        const fallbackLeft = Number.isFinite(Number(savedPos.left))
          ? Number(savedPos.left)
          : Math.max(0, window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN);

        const fallbackTop = Number.isFinite(Number(savedPos.top))
          ? Number(savedPos.top)
          : Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN);

        rect = {
          left: fallbackLeft,
          top: fallbackTop,
          right: fallbackLeft + size.width,
          bottom: fallbackTop + size.height,
          width: size.width,
          height: size.height,
        };
      }

      const hotzoneWidth = RESTORE_HOTZONE_WIDTH;
      const hotzoneHeight = Math.max(
        RESTORE_HOTZONE_MIN_HEIGHT,
        Math.min(window.innerHeight, rect.height + RESTORE_HOTZONE_EXTRA * 2),
      );

      let top = Math.round(rect.top - RESTORE_HOTZONE_EXTRA);
      top = Math.max(0, Math.min(window.innerHeight - hotzoneHeight, top));

      Object.assign(restoreHotzone.style, {
        right: '0px',
        left: '',
        top: `${top}px`,
        bottom: '',
        width: `${hotzoneWidth}px`,
        height: `${Math.round(hotzoneHeight)}px`,
      });

      restoreHotzone.classList.add('active');

      if (isFloatingTitleActuallyVisible()) {
        hideRestoreHandle(`updateRestoreHotzone:floating-title-visible:${reason || '-'}`);
      } else {
        showRestoreHandle(`updateRestoreHotzone:floating-title-missing:${reason || '-'}`, {
          force: true,
        });
      }

      appendLog(
        `[TOOLBOX_RESTORE_HOTZONE][update] reason=${reason || '-'} panelHidden=${panelHidden ? 1 : 0} top=${top} width=${hotzoneWidth} height=${Math.round(hotzoneHeight)}`,
      );
    }

    function restoreToolboxFromHotzone(reason = '') {
      restoreToolboxFromHiddenState(`hotzone:${reason || '-'}`);
    }

    function bindRestoreHotzoneEvents() {
      if (!restoreHotzone) return;

      if (restoreHotzone.dataset.bound === '1') {
        return;
      }

      restoreHotzone.dataset.bound = '1';

      restoreHotzone.addEventListener('mouseenter', () => {
        if (restoreHotzoneHoverTimer) {
          window.clearTimeout(restoreHotzoneHoverTimer);
          restoreHotzoneHoverTimer = 0;
        }

        restoreHotzoneHoverTimer = window.setTimeout(() => {
          restoreHotzoneHoverTimer = 0;
          restoreToolboxFromHotzone('hover');
        }, RESTORE_HOTZONE_HOVER_DELAY);
      });

      restoreHotzone.addEventListener('mouseleave', () => {
        if (restoreHotzoneHoverTimer) {
          window.clearTimeout(restoreHotzoneHoverTimer);
          restoreHotzoneHoverTimer = 0;
        }
      });

      restoreHotzone.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (restoreHotzoneHoverTimer) {
          window.clearTimeout(restoreHotzoneHoverTimer);
          restoreHotzoneHoverTimer = 0;
        }

        restoreToolboxFromHotzone('click');
      });

      appendLog('[TOOLBOX_RESTORE_HOTZONE][bind-ok]');
    }

    function clampPanelRect(rect) {
      const mins = getPanelMinSize();
      return fitPanelRectInViewport(rect, {
        minWidth: Math.max(mins.minWidth, TOOLBOX_SIZE_LIMITS.MIN_WIDTH),
        minHeight: mins.minHeight,
      });
    }

    function applyPanelRect(rect) {
      if (!panel || !root) {
        console.warn('[ChatGPT toolbox] applyPanelRect: panel root 未初始化');
        return;
      }

      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

      panel.style.width = `${Math.round(rect.width)}px`;
      panel.style.height = `${Math.round(rect.height)}px`;
      panel.style.setProperty('--cgpt-toolbox-width', `${Math.round(rect.width)}px`);
      panel.style.setProperty('--cgpt-toolbox-height', `${Math.round(rect.height)}px`);

      applyPanelPosition(rect.left, rect.top);
    }

    function resizePanelByPointer(dir, start, pointerX, pointerY) {
      const dx = pointerX - start.pointerX;
      const dy = pointerY - start.pointerY;

      const mins = getPanelMinSize();
      const maxSize = getPanelMaxSize();

      let nextLeft = start.left;
      let nextTop = start.top;
      let nextWidth = start.width;
      let nextHeight = start.height;

      if (dir.includes('e')) {
        nextWidth = start.width + dx;
      }

      if (dir.includes('s')) {
        nextHeight = start.height + dy;
      }

      if (dir.includes('w')) {
        nextWidth = start.width - dx;
        nextLeft = start.left + dx;
      }

      if (dir.includes('n')) {
        nextHeight = start.height - dy;
        nextTop = start.top + dy;
      }

      if (nextWidth < mins.minWidth) {
        if (dir.includes('w')) {
          nextLeft = start.left + start.width - mins.minWidth;
        }
        nextWidth = mins.minWidth;
      }

      if (nextHeight < mins.minHeight) {
        if (dir.includes('n')) {
          nextTop = start.top + start.height - mins.minHeight;
        }
        nextHeight = mins.minHeight;
      }

      if (nextWidth > maxSize.width) {
        if (dir.includes('w')) {
          nextLeft = start.left + start.width - maxSize.width;
        }
        nextWidth = maxSize.width;
      }

      if (nextHeight > maxSize.height) {
        if (dir.includes('n')) {
          nextTop = start.top + start.height - maxSize.height;
        }
        nextHeight = maxSize.height;
      }

      const clamped = clampPanelRect({
        left: nextLeft,
        top: nextTop,
        width: nextWidth,
        height: nextHeight,
      });

      scheduleApplyPanelResizeRect(clamped, 'panel-resize-handle-move');
    }

    function startPanelResize(e) {
      if (!(e.currentTarget instanceof HTMLElement)) return;

      const dir = e.currentTarget.getAttribute('data-resize-dir') || '';
      if (!dir) return;

      e.preventDefault();
      e.stopPropagation();

      if (!panel || !root) {
        console.warn('[ChatGPT toolbox] startPanelResize: panel root 未初始化');
        return;
      }

      ensureRootPositionAnchored();

      const startRect = panel.getBoundingClientRect();

      const start = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        left: startRect.left,
        top: startRect.top,
        width: startRect.width,
        height: startRect.height,
      };

      panel.classList.add('cgpt-resizing');
      panel.dataset.resizing = '1';
      isResizingToolbox = true;

      const activePointerId = e.pointerId;

      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== activePointerId) return;

        moveEvent.preventDefault();

        resizePanelByPointer(dir, start, moveEvent.clientX, moveEvent.clientY);
      };

      const resizeHandleEl = e.currentTarget;
      let panelCornerResizeFinished = false;

      const finishPanelResize = (upEvent, endReason) => {
        if (upEvent.pointerId !== activePointerId) return;
        if (panelCornerResizeFinished) {
          return;
        }
        panelCornerResizeFinished = true;

        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        if (resizeHandleEl instanceof HTMLElement) {
          resizeHandleEl.removeEventListener('lostpointercapture', onLostPointerCapture);
        }

        if (resizeHandleEl instanceof HTMLElement
          && resizeHandleEl.hasPointerCapture
          && resizeHandleEl.hasPointerCapture(activePointerId)) {
          try {
            resizeHandleEl.releasePointerCapture(activePointerId);
          } catch (err) {
            console.debug('[ChatGPT toolbox] resize releasePointerCapture failed', err);
          }
        }

        flushPanelResizePendingRect(endReason);

        panel.classList.remove('cgpt-resizing');
        panel.dataset.resizing = '0';
        isResizingToolbox = false;

        schedulePostDragLayout(() => {
          keepPanelInViewport({
            save: false,
          });
          clampRootToViewport('resize-end', {
            save: false,
          });
          syncToolboxFloatingLayout('panel-resize-end');

          if (isPanelVisibleNow()) {
            savePanelPositionFromDom('resize-end');
          }
        });

        savePanelSizeFromDom({
          userAction: true,
          reason: endReason,
        });

        rememberLastPanelVisibleRect('resize-end');
        updateRestoreHotzone('resize-end');
      };

      const onPointerUp = (upEvent) => {
        finishPanelResize(upEvent, 'resize-handle-pointerup');
      };

      const onPointerCancel = (upEvent) => {
        finishPanelResize(upEvent, 'resize-pointercancel');
      };

      const onLostPointerCapture = (captureEvent) => {
        if (captureEvent.pointerId !== activePointerId) {
          return;
        }
        finishPanelResize(captureEvent, 'resize-lostpointercapture');
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);

      if (resizeHandleEl instanceof HTMLElement) {
        resizeHandleEl.addEventListener('lostpointercapture', onLostPointerCapture);
      }

      try {
        e.currentTarget.setPointerCapture(activePointerId);
      } catch (err) {
        console.debug('[ChatGPT toolbox] resize setPointerCapture failed', err);
      }
    }

    function bindPanelResizeHandles() {
      if (!panel) return;
      if (panel.dataset.resizeHandlesBound === '1') return;

      panel.dataset.resizeHandlesBound = '1';

      qsa('.cgpt-resize-handle', panel).forEach((handle) => {
        handle.addEventListener('pointerdown', startPanelResize, true);
      });

      ensureToolboxResizeHandle(panel);
      ensureToolboxLeftResizeHandle(panel);
      bindToolboxResize(panel);
      bindToolboxLeftResize(panel);
    }

    function readToolboxLayoutFlagsFromDom() {
      if (!root) {
        return {
          panel_hidden: false,
          edge_docked: false,
          edge_revealed: false,
          floating_hidden: false,
          hidden: false,
        };
      }

      const panel_hidden = isPanelHiddenNow();
      const edge_docked = false;
      const edge_revealed = false;
      const floating_hidden = false;

      return {
        panel_hidden,
        edge_docked,
        edge_revealed,
        floating_hidden,
        hidden: panel_hidden || edge_docked || floating_hidden,
      };
    }

    function collectToolboxLayoutState(options = {}) {
      const positionOnly = options.positionOnly === true;
      const includeSize = options.includeSize !== false && !positionOnly;
      const flags = readToolboxLayoutFlagsFromDom();
      const layout = {
        mode: compactMode ? 'compact' : 'full',
        hidden: flags.hidden,
        panel_hidden: flags.panel_hidden,
        edge_docked: flags.edge_docked,
        edge_revealed: flags.edge_revealed,
        floating_hidden: flags.floating_hidden,
        edge_hidden: flags.edge_docked,
        anchor: (root && root.dataset && root.dataset.snapEdge) || '',
        updatedAt: Date.now(),
      };
      if (panel) {
        const rect = panel.getBoundingClientRect();
        layout.x = Math.round(rect.left);
        layout.y = Math.round(rect.top);
        if (includeSize) {
          layout.width = Math.round(rect.width);
          layout.height = Math.round(rect.height);
        }
      }
      return layout;
    }

    function saveToolboxLayoutState(reason = '', options = {}) {
      const reasonText = String(reason || '').trim();
      const positionOnly = options.positionOnly === true
        || isAutoSizeSaveBlockedReason(reasonText);
      const layout = collectToolboxLayoutState({ positionOnly });
      saveToolboxPageStatePatch(
        { layoutState: layout },
        reasonText || 'save-toolbox-layout',
      );
      appendLog(
        `[TOOLBOX][LAYOUT][save] reason=${reasonText || '-'} `
          + `panel_hidden=${layout.panel_hidden ? 1 : 0} `
          + `edge_docked=${layout.edge_docked ? 1 : 0} `
          + `edge_revealed=${layout.edge_revealed ? 1 : 0} `
          + `floating_hidden=${layout.floating_hidden ? 1 : 0} mode=${layout.mode} `
          + `positionOnly=${positionOnly ? 1 : 0}`,
      );
    }

    function readSavedPanelPosition() {
      const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null);

      if (!saved || typeof saved !== 'object') {
        return null;
      }

      const left = Number(saved.left);
      const top = Number(saved.top);

      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
      }

      return {
        left,
        top,
        mode: saved.mode || 'panel',
        edge: saved.edge || '',
        updatedAt: Number(saved.updatedAt || 0),
      };
    }

    function applySavedPanelPosition(reason = '') {
      if (!panel) {
        console.warn('[ChatGPT toolbox] applySavedPanelPosition: panel 未初始化');
        return false;
      }

      const saved = readSavedPanelPosition();

      if (!saved) {
        appendLog(`[TOOLBOX_POSITION][RESTORE_SKIP] reason=${reason || '-'} noSavedPosition=1`);
        return false;
      }

      const pos = clampPanelPosition({
        left: saved.left,
        top: saved.top,
      });

      applyPanelPosition(pos.left, pos.top);

      if (root) {
        root.dataset.snapEdge = saved.edge || '';
      }

      appendLog(
        `[TOOLBOX_POSITION][RESTORE_GLOBAL] reason=${reason || '-'} left=${pos.left} top=${pos.top} savedLeft=${saved.left} savedTop=${saved.top}`,
      );

      return true;
    }

    function savePanelPositionOnly(reason, left, top) {
      if (!panel) {
        console.warn('[ChatGPT toolbox] savePanelPositionOnly: panel 未初始化');
        return;
      }

      const reasonText = String(reason || '').trim() || 'panel-position-only';
      const pos = clampPanelPosition({
        left: Math.round(left),
        top: Math.round(top),
      });

      const panelPosition = {
        ...pos,
        mode: 'panel',
        edge: root && root.dataset ? (root.dataset.snapEdge || '') : '',
        updatedAt: Date.now(),
      };

      const signature = `${Math.round(pos.left)}|${Math.round(pos.top)}|${panelPosition.edge || ''}`;
      if (signature === panelPositionSaveLastSignature) {
        return;
      }
      panelPositionSaveLastSignature = signature;

      MemoryManager.set(MemoryManager.KEYS.panelPosition, panelPosition);

      saveToolboxLayoutState(reasonText, { positionOnly: true });
      saveCurrentToolboxBaseState(reasonText);

      appendLog(
        `[TOOLBOX_POSITION][SAVE_POSITION_ONLY] reason=${reasonText} left=${pos.left} top=${pos.top}`,
      );
    }

    function savePanelSizeOnly(reason, width, height, isCompact) {
      const reasonText = String(reason || '').trim() || 'panel-size-only';

      if (isAutoSizeSaveBlockedReason(reasonText)) {
        appendLog(
          `[TOOLBOX_SIZE][BLOCK_AUTO_SIZE_SAVE] reason=${reasonText} width=${width} height=${height} compact=${typeof isCompact === 'boolean' ? (isCompact ? 1 : 0) : (compactMode ? 1 : 0)}`,
        );
        return;
      }

      const compactFlag = typeof isCompact === 'boolean' ? isCompact : compactMode;
      const next = normalizePanelSize({
        width: Math.round(width),
        height: Math.round(height),
      });

      const key = getPanelSizeMemoryKeyForMode(compactFlag);
      MemoryManager.set(key, next);
      setUserPanelSizeLock(next.width, next.height, compactFlag ? 'compact' : 'normal');

      appendLog(
        `[TOOLBOX_SIZE][SAVE_SIZE_ONLY] reason=${reasonText} key=${key} width=${next.width} height=${next.height} compact=${compactFlag ? 1 : 0}`,
      );

      keepPanelInViewport({
        save: false,
      });
    }

    function savePanelPositionFromDomNow(reason = '') {
      if (!panel) {
        console.warn('[ChatGPT toolbox] savePanelPositionFromDom: panel 未初始化');
        return;
      }

      if (panel.dataset.toolboxHidden === '1' || panel.classList.contains('cgpt-toolbox-hidden')) {
        appendLog(`[TOOLBOX_POSITION][SAVE_DOM_SKIP] reason=${reason || '-'} panelHidden=1`);
        return;
      }

      const style = window.getComputedStyle(panel);
      if (style.display === 'none' || style.visibility === 'hidden') {
        appendLog(`[TOOLBOX_POSITION][SAVE_DOM_SKIP] reason=${reason || '-'} display=${style.display}`);
        return;
      }

      const rect = panel.getBoundingClientRect();
      if (!isToolboxPanelRectValid(rect)) {
        appendLog(
          `[TOOLBOX_POSITION][SAVE_DOM_SKIP] reason=${reason || '-'} invalidRect left=${rect.left} top=${rect.top} width=${rect.width} height=${rect.height}`,
        );
        return;
      }

      savePanelPositionOnly(reason, rect.left, rect.top);
      saveToolboxPanelRect(`dom:${reason || '-'}`);
    }

    function savePanelPositionFromDom(reason = '') {
      const reasonText = String(reason || '').trim();
      const shouldDebounce = reasonText === 'keepPanelInViewport'
        || reasonText.includes('keepPanelInViewport');

      if (!shouldDebounce) {
        if (panelPositionSaveDebounceTimer) {
          window.clearTimeout(panelPositionSaveDebounceTimer);
          panelPositionSaveDebounceTimer = 0;
          panelPositionSavePendingReason = '';
        }
        savePanelPositionFromDomNow(reasonText);
        return;
      }

      panelPositionSavePendingReason = reasonText || 'keepPanelInViewport';

      if (panelPositionSaveDebounceTimer) {
        window.clearTimeout(panelPositionSaveDebounceTimer);
      }

      panelPositionSaveDebounceTimer = window.setTimeout(() => {
        panelPositionSaveDebounceTimer = 0;
        const pendingReason = panelPositionSavePendingReason || 'keepPanelInViewport';
        panelPositionSavePendingReason = '';
        savePanelPositionFromDomNow(pendingReason);
      }, 800);
    }

    function clearViewportTimers(source) {
      if (clampViewportTimer) {
        window.clearTimeout(clampViewportTimer);
        clampViewportTimer = 0;
      }

      if (panelPositionSaveDebounceTimer) {
        window.clearTimeout(panelPositionSaveDebounceTimer);
        panelPositionSaveDebounceTimer = 0;
        panelPositionSavePendingReason = '';
      }

      if (edgeRevealTimer) {
        window.clearTimeout(edgeRevealTimer);
        edgeRevealTimer = 0;
      }

      if (restoreHotzoneHoverTimer) {
        window.clearTimeout(restoreHotzoneHoverTimer);
        restoreHotzoneHoverTimer = 0;
      }

      appendLog(`[TOOLBOX][CLEAR_VIEWPORT_TIMERS] source=${source || '-'}`);
    }

    function keepPanelInViewport(options = {}) {
      if (!panel) {
        console.warn('[ChatGPT toolbox] keepPanelInViewport: panel 未初始化');
        return;
      }

      if (isStableToolboxPointerActive()) {
        return;
      }

      if (panel.classList.contains('cgpt-toolbox-hidden')) {
        return;
      }

      const shouldSave = options.save === true;
      const reason = options.reason || 'keepPanelInViewport';
      const rect = panel.getBoundingClientRect();
      const fitted = fitPanelRectInViewport({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });

      const changed = Math.abs(fitted.left - rect.left) > 0.5
        || Math.abs(fitted.top - rect.top) > 0.5
        || Math.abs(fitted.width - rect.width) > 0.5
        || Math.abs(fitted.height - rect.height) > 0.5;

      if (changed) {
        applyPanelResizeRect(fitted, reason);
        appendLog(
          `[TOOLBOX_POSITION][KEEP_IN_VIEWPORT] reason=${reason} left=${Math.round(rect.left)}->${fitted.left} width=${Math.round(rect.width)}->${fitted.width}`,
        );
      } else {
        updateToolboxNarrowClass(reason);
      }

      if (shouldSave) {
        savePanelPositionFromDom('keepPanelInViewport');
      }

      updateFloatingTitlePosition(reason || 'keep-panel');
    }

    function getFloatingTitleEl() {
      if (!root) return null;

      let floatingTitle = qs('#cgpt-toolbox-floating-title', root);
      if (!floatingTitle) {
        ensureFloatingTitleElement();
        floatingTitle = qs('#cgpt-toolbox-floating-title', root);
      }

      return floatingTitle;
    }

    function isHeaderPanelUiHidden() {
      const panelEl = panel || document.getElementById(APP.panelId);
      return !!(panelEl && panelEl.dataset.toolboxHidden === '1');
    }

    function isToolboxRestoreButtonActuallyVisible() {
      const btn = document.getElementById(TOOLBOX_RESTORE_BUTTON_ID);
      if (!btn) return false;

      const style = window.getComputedStyle(btn);
      const rect = btn.getBoundingClientRect();

      return (
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.width > 10
        && rect.height > 10
      );
    }

    function isPanelVisibleNow() {
      if (!root || !panel) return false;
      if (panel.dataset.toolboxHidden === '1') return false;
      if (panel.classList.contains('cgpt-toolbox-hidden')) return false;
      if (root.classList.contains('cgpt-toolbox-panel-hidden')) return false;
      const style = window.getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity || 1) > 0 &&
        rect.width > 10 &&
        rect.height > 10
      );
    }

    function getCurrentToolboxDragBaseRect() {
      if (panel && isPanelVisibleNow()) {
        return panel.getBoundingClientRect();
      }

      if (root) {
        return root.getBoundingClientRect();
      }

      return null;
    }

    function finishFloatingTitleDrag(state, wasMoved) {
      if (state && state.dragRafId) {
        window.cancelAnimationFrame(state.dragRafId);
        state.dragRafId = 0;
      }

      clearDragVisualState();

      if (wasMoved) {
        if (isPanelVisibleNow()) {
          savePanelPositionFromDom('floating-title-drag-end');
        } else if (root) {
          const rect = root.getBoundingClientRect();

          MemoryManager.saveToolboxPatch({
            panelPosition: {
              left: Math.round(rect.left),
              top: Math.round(rect.top),
              mode: 'left-top',
              edge: root.dataset.snapEdge || '',
              updatedAt: Date.now(),
            },
          });

          saveCurrentToolboxBaseState('floating-title-drag-end-hidden');

          appendLog(
            `[TOOLBOX_TITLE_DRAG][save-hidden-position] left=${Math.round(rect.left)} top=${Math.round(rect.top)}`,
          );
        }

        updateFloatingTitlePosition('floating-title-drag-end');

        appendLog('[TOOLBOX_TITLE_DRAG][end] moved=1');
      } else {
        appendLog('[TOOLBOX_TITLE_DRAG][end] moved=0');
      }
    }

    function bindFloatingTitleToggleEvents() {
      const floatingTitle = getFloatingTitleEl();

      if (!floatingTitle) {
        appendLog('[TOOLBOX_TITLE][bind-skip] floatingTitle 不存在');
        return;
      }

      if (floatingTitle.dataset.toggleBound === '1') {
        return;
      }

      floatingTitle.dataset.toggleBound = '1';
      floatingTitle.setAttribute('role', 'button');
      floatingTitle.setAttribute('tabindex', '0');
      floatingTitle.title = `${getToolboxTitle()}：点击展开/收起，拖拽移动`;

      floatingTitle.addEventListener('pointerdown', (e) => {
        // Prevent floating title drag when panel is expanded
        if (isPanelVisibleNow() && !isToolboxInAnyHiddenState()) {
          appendLog('[TOOLBOX_TITLE_DRAG][down-skip] reason=panel-visible-floating-title-hidden');
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (e.button != null && e.button !== 0) {
          return;
        }

        if (!root) {
          appendLog('[TOOLBOX_TITLE_DRAG][down-skip] reason=no-root');
          return;
        }

        const rect = getCurrentToolboxDragBaseRect();

        if (!rect) {
          appendLog('[TOOLBOX_TITLE_DRAG][down-skip] reason=no-base-rect');
          return;
        }

        floatingTitleDragState = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          moved: false,
          dragRafId: 0,
          latestDx: 0,
          latestDy: 0,
          wasHidden: isToolboxInAnyHiddenState(),
        };

        try {
          floatingTitle.setPointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] floatingTitle setPointerCapture failed', err);
          appendLog(`[TOOLBOX_TITLE_DRAG][error] setPointerCapture failed: ${errText}`);
        }

        appendLog(
          `[TOOLBOX_TITLE_DRAG][down] left=${Math.round(rect.left)} top=${Math.round(rect.top)} hidden=${floatingTitleDragState.wasHidden ? 1 : 0}`,
        );

        e.preventDefault();
        e.stopPropagation();
      });

      floatingTitle.addEventListener('pointermove', (e) => {
        if (!floatingTitleDragState) return;
        if (e.pointerId !== floatingTitleDragState.pointerId) return;

        const dx = e.clientX - floatingTitleDragState.startClientX;
        const dy = e.clientY - floatingTitleDragState.startClientY;
        const movedDistance = Math.sqrt(dx * dx + dy * dy);

        if (movedDistance >= DRAG_CLICK_THRESHOLD) {
          if (!floatingTitleDragState.moved) {
            floatingTitleDragState.moved = true;
            isDraggingToolbox = true;
            suppressToggleClick = true;

            root.classList.add('cgpt-toolbox-dragging');
            addGlobalDraggingClass();

            appendLog('[TOOLBOX_TITLE_DRAG][start]');
          }
        }

        if (!floatingTitleDragState.moved) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        floatingTitleDragState.latestDx = dx;
        floatingTitleDragState.latestDy = dy;

        if (floatingTitleDragState.dragRafId) {
          return;
        }

        floatingTitleDragState.dragRafId = window.requestAnimationFrame(() => {
          if (!floatingTitleDragState || !root) return;

          floatingTitleDragState.dragRafId = 0;

          const nextLeft = floatingTitleDragState.startLeft + floatingTitleDragState.latestDx;
          const nextTop = floatingTitleDragState.startTop + floatingTitleDragState.latestDy;

          applyDragPosition(nextLeft, nextTop, 'floating-title-dragging');
        });
      });

      floatingTitle.addEventListener('pointerup', (e) => {
        if (!floatingTitleDragState) return;
        if (e.pointerId !== floatingTitleDragState.pointerId) return;

        const state = floatingTitleDragState;
        const wasMoved = state.moved;

        try {
          floatingTitle.releasePointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] floatingTitle releasePointerCapture failed', err);
          appendLog(`[TOOLBOX_TITLE_DRAG][error] releasePointerCapture failed: ${errText}`);
        }

        finishFloatingTitleDrag(state, wasMoved);

        floatingTitleDragState = null;
        isDraggingToolbox = false;

        if (wasMoved) {
          suppressToggleClick = true;
        }

        window.setTimeout(() => {
          suppressToggleClick = false;
        }, TOGGLE_CLICK_SUPPRESS_MS);

        e.preventDefault();
        e.stopPropagation();
      });

      floatingTitle.addEventListener('pointercancel', (e) => {
        if (!floatingTitleDragState) return;

        const state = floatingTitleDragState;
        const wasMoved = state.moved;

        try {
          floatingTitle.releasePointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] floatingTitle pointercancel releasePointerCapture failed', err);
          appendLog(`[TOOLBOX_TITLE_DRAG][error] pointercancel releasePointerCapture failed: ${errText}`);
        }

        finishFloatingTitleDrag(state, wasMoved);

        floatingTitleDragState = null;
        isDraggingToolbox = false;
        suppressToggleClick = true;

        window.setTimeout(() => {
          suppressToggleClick = false;
        }, TOGGLE_CLICK_SUPPRESS_MS);
      });

      floatingTitle.addEventListener('click', (e) => {
        if (suppressToggleClick) {
          appendLog('[TOOLBOX_TITLE][click-skip] reason=suppress-after-drag');
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        if (isDraggingToolbox || isResizingToolbox) {
          appendLog('[TOOLBOX_TITLE][click-skip] reason=dragging-or-resizing');
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (isToolboxInAnyHiddenState()) {
          restoreToolboxFromHiddenState('floating-title-click');
        } else {
          hidePanel({
            reason: 'floating-title-click',
            skipEdgeAutoHide: true,
          });
        }

        appendLog(
          `[TOOLBOX_TITLE][toggle] hidden=${panel && panel.classList.contains('cgpt-toolbox-hidden') ? 1 : 0}`,
        );
      });

      floatingTitle.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (isToolboxInAnyHiddenState()) {
          restoreToolboxFromHiddenState('floating-title-keyboard');
        } else {
          hidePanel({
            reason: 'floating-title-keyboard',
            skipEdgeAutoHide: true,
          });
        }

        appendLog(
          `[TOOLBOX_TITLE][keyboard-toggle] key=${e.key} hidden=${panel && panel.classList.contains('cgpt-toolbox-hidden') ? 1 : 0}`,
        );
      });

      appendLog('[TOOLBOX_TITLE][bind-ok]');
    }

    function primeFloatingTitlePositionForPanelDrag(left, top, reason = '') {
      const title = getFloatingTitleEl();
      if (!title || !root) {
        return;
      }

      const gap = 6;
      const margin = PANEL_VIEWPORT_MARGIN;
      const fallbackWidth = 110;
      const fallbackHeight = 28;

      const rect = title.getBoundingClientRect();
      const width = rect && rect.width > 0 ? rect.width : fallbackWidth;
      const height = rect && rect.height > 0 ? rect.height : fallbackHeight;

      const safeLeft = clampNumber(
        Number(left),
        margin,
        Math.max(margin, window.innerWidth - width - margin),
      );

      const safeTop = clampNumber(
        Number(top) - height - gap,
        margin,
        Math.max(margin, window.innerHeight - height - margin),
      );

      title.style.left = `${Math.round(safeLeft)}px`;
      title.style.top = `${Math.round(safeTop)}px`;
      title.style.right = 'auto';
      title.style.bottom = 'auto';

      appendLog(
        `[TOOLBOX_TITLE][prime-drag-position] reason=${reason || '-'} left=${Math.round(safeLeft)} top=${Math.round(safeTop)}`,
      );
    }

    function updateFloatingTitlePosition(reason = '') {
      const title = getFloatingTitleEl();
      if (!title || !root) {
        return;
      }

      const hiddenState = isToolboxInAnyHiddenState();
      const panelVisible = isPanelVisibleNow();

      // 主面板展开且非隐藏状态时，永远不显示独立浮动标题
      if (panelVisible && !hiddenState) {
        title.style.display = 'none';
        title.classList.remove('cgpt-floating-title-visible');
        title.classList.add('cgpt-floating-title-hidden');
        return;
      }

      // 浮动标题仅在隐藏/折叠/贴边隐藏时参与定位
      if (!hiddenState) {
        title.style.display = 'none';
        title.classList.remove('cgpt-floating-title-visible');
        title.classList.add('cgpt-floating-title-hidden');
        return;
      }

      title.style.display = 'inline-flex';
      title.classList.add('cgpt-floating-title-visible');
      title.classList.remove('cgpt-floating-title-hidden');

      const titleRect = title.getBoundingClientRect();
      const gap = 6;
      const margin = PANEL_VIEWPORT_MARGIN;
      let targetLeft;
      let targetTop;
      let source = 'unknown';

      const locked = getLockedHiddenTitlePosition(`update-title:${reason || '-'}`);

      if (locked) {
        targetLeft = locked.left;
        targetTop = locked.top;
        source = 'hidden-title-locked';
      } else if (
        lastPanelVisibleRect &&
        Number.isFinite(Number(lastPanelVisibleRect.left)) &&
        Number.isFinite(Number(lastPanelVisibleRect.top))
      ) {
        targetLeft = Number(lastPanelVisibleRect.left);
        targetTop = Math.max(margin, Number(lastPanelVisibleRect.top) - titleRect.height - gap);
        source = 'last-panel-visible-fallback';
      } else {
        const savedPos = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        targetLeft = Number.isFinite(Number(savedPos.left)) ? Number(savedPos.left) : margin;
        targetTop = Number.isFinite(Number(savedPos.top))
          ? Math.max(margin, Number(savedPos.top) - titleRect.height - gap)
          : margin;
        source = 'saved-panel-position-fallback';
      }
      const safeLeft = clampNumber(
        targetLeft,
        margin,
        window.innerWidth - titleRect.width - margin,
      );
      const safeTop = clampNumber(
        targetTop,
        margin,
        window.innerHeight - titleRect.height - margin,
      );

      title.style.left = `${Math.round(safeLeft)}px`;
      title.style.top = `${Math.round(safeTop)}px`;
      title.style.right = 'auto';
      title.style.bottom = 'auto';

      const reasonText = reason || '-';
      if (reasonText.indexOf('drag') >= 0) {
        appendLog(
          `[TOOLBOX_DRAG][drag-title-position] left=${Math.round(safeLeft)} top=${Math.round(safeTop)} reason=${reasonText}`,
        );
      } else {
        appendLog(
          `[TOOLBOX_TITLE][position] reason=${reasonText} source=${source} left=${Math.round(safeLeft)} top=${Math.round(safeTop)}`,
        );
      }
    }

    function keepToggleFullyInViewport(reason = '') {
      if (!root) return;

      const toggle = qs(`#${APP.toggleId}`, root);
      if (!toggle) return;

      const style = window.getComputedStyle(toggle);
      if (style.display === 'none') return;

      const rect = toggle.getBoundingClientRect();
      const margin = PANEL_VIEWPORT_MARGIN;
      let dx = 0;
      let dy = 0;

      if (rect.left < margin) {
        dx = margin - rect.left;
      } else if (rect.right > window.innerWidth - margin) {
        dx = window.innerWidth - margin - rect.right;
      }

      if (rect.top < margin) {
        dy = margin - rect.top;
      } else if (rect.bottom > window.innerHeight - margin) {
        dy = window.innerHeight - margin - rect.bottom;
      }

      if (dx === 0 && dy === 0) {
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const nextLeft = rootRect.left + dx;
      const nextTop = rootRect.top + dy;

      root.style.left = `${Math.round(nextLeft)}px`;
      root.style.top = `${Math.round(nextTop)}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';

      appendLog(
        `[TOOLBOX_TOGGLE][clamp] reason=${reason || '-'} dx=${Math.round(dx)} dy=${Math.round(dy)} left=${Math.round(nextLeft)} top=${Math.round(nextTop)}`,
      );
    }

    function syncToolboxFloatingLayout(reason = '') {
      if (panel && isPanelVisibleNow()) {
        keepPanelInViewport({
          save: false,
        });
        updateFloatingTitlePosition(reason || 'sync');
        return;
      }

      if (isPanelHiddenNow() || isToolboxInAnyHiddenState()) {
        updateFloatingTitlePosition(reason || 'sync');
        return;
      }

      updateFloatingTitlePosition(reason || 'sync');
    }

    function restorePanelSize(reason = '', options = {}) {
      const reasonText = String(reason || '').trim() || 'unspecified';
      const key = getPanelSizeMemoryKey();
      const saved = MemoryManager.get(key, null);
      const fallback = getPanelSizeFallback();
      const currentDom = getPanelDomSize();
      const hasSaved = !!(saved && saved.width && saved.height);
      const force = options.force === true;
      const explicitRestore = isExplicitPanelSizeRestoreReason(reasonText);

      appendLog(
        `[TOOLBOX_SIZE][restore-check] reason=${reasonText} key=${key} ` +
        `hasSaved=${hasSaved ? 1 : 0} compact=${compactMode ? 1 : 0} ` +
        `currentWidth=${currentDom ? currentDom.width : 0} currentHeight=${currentDom ? currentDom.height : 0} ` +
        `savedWidth=${hasSaved ? saved.width : 0} savedHeight=${hasSaved ? saved.height : 0}`,
      );

      if (isUserPanelSizeProtected() && !explicitRestore && !force) {
        console.log('[TOOLBOX_WIDTH][KEEP_USER_WIDTH]', {
          reason: reasonText,
          width: currentDom ? currentDom.width : 0,
          height: currentDom ? currentDom.height : 0,
        });
        appendLog(
          `[TOOLBOX_SIZE][restore-skip] reason=${reasonText} because=user-size-protected`,
        );
        return;
      }

      if (!explicitRestore && !force && currentDom) {
        console.log('[TOOLBOX_WIDTH][SKIP_RESET]', {
          reason: reasonText,
          width: currentDom.width,
          height: currentDom.height,
        });
        appendLog(
          `[TOOLBOX_SIZE][restore-skip] reason=${reasonText} because=current-valid-rect ` +
          `width=${currentDom.width} height=${currentDom.height}`,
        );
        return;
      }

      const scheduleViewportKeep = () => {
        window.setTimeout(() => {
          keepPanelInViewport({
            save: false,
          });
        }, 0);
      };

      if (hasSaved) {
        console.log('[TOOLBOX_WIDTH][DEFAULT_APPLY]', {
          reason: reasonText,
          source: 'saved',
          width: saved.width,
          height: saved.height,
        });
        const restoredSize = normalizeToolboxSavedSize(saved.width, saved.height, reasonText);
        appendLog(
          `[TOOLBOX_SIZE][RESTORE_SIZE] reason=${reasonText} key=${key} ` +
          `width=${restoredSize.width} height=${restoredSize.height} compact=${compactMode ? 1 : 0}`,
        );
        appendLog(
          `[TOOLBOX_SIZE][restore-saved] reason=${reasonText} key=${key} ` +
          `width=${restoredSize.width} height=${restoredSize.height} compact=${compactMode ? 1 : 0}`,
        );
        applyPanelSize(restoredSize, {
          reason: reasonText,
          force,
        });
        scheduleViewportKeep();
        return;
      }

      if (!shouldAllowPanelSizeFallback(reasonText, options)) {
        if (currentDom) {
          appendLog(
            `[TOOLBOX_SIZE][restore-skip] reason=${reasonText} because=no-saved-and-fallback-blocked ` +
            `width=${currentDom.width} height=${currentDom.height}`,
          );
          return;
        }
      }

      console.log('[TOOLBOX_WIDTH][DEFAULT_APPLY]', {
        reason: reasonText,
        source: 'fallback',
        width: fallback.width,
        height: fallback.height,
      });
      appendLog(
        `[TOOLBOX_SIZE][restore-fallback] reason=${reasonText} key=${key} ` +
        `width=${fallback.width} height=${fallback.height} compact=${compactMode ? 1 : 0}`,
      );
      applyPanelSize(fallback, {
        reason: reasonText,
        force,
      });
      scheduleViewportKeep();
    }

    function savePanelSizeFromDom(options = {}) {
      if (!panel) return;

      if (options.userAction !== true) {
        return;
      }

      if (panel.classList.contains('cgpt-toolbox-hidden')) return;

      const rect = panel.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        console.warn('[ChatGPT toolbox] savePanelSizeFromDom: invalid rect', rect);
        appendLog('[TOOLBOX_SIZE][save-skip] reason=invalid-rect');
        return;
      }

      const isCompact = options.key
        ? options.key === MemoryManager.KEYS.panelSizeCompact
        : compactMode;

      savePanelSizeOnly(
        options.reason || 'resize-handle-pointerup',
        rect.width,
        rect.height,
        isCompact,
      );
    }

    function bindPanelResizePersistence() {
      if (!panel || panelResizeObserver) return;

      if (typeof ResizeObserver !== 'function') {
        console.warn('[ChatGPT toolbox] ResizeObserver 不可用，跳过面板尺寸观察');
        return;
      }

      panelResizeObserver = new ResizeObserver(() => {
        if (isDraggingToolbox || isResizingToolbox || isStableToolboxPointerActive()) {
          return;
        }

        keepPanelInViewport({
          save: false,
        });

        syncToolboxHeaderLayout('panel-resize-observer');
        syncToolboxFloatingLayout('panel-resize-observer');
      });

      panelResizeObserver.observe(panel);
    }

    function keepRootInViewport(options = {}) {
      if (!root) {
        console.warn('[ChatGPT toolbox] keepRootInViewport: root 未初始化');
        return;
      }

      const rect = getRootRect();

      if (!rect) return;

      setRootLeftTop(rect.left, rect.top, {
        save: options.save === true,
      });

      if (root.dataset.snapEdge) {
        snapRootToEdge({
          log: false,
        });
      }
    }

    function getRootRect() {
      if (!root) return null;
      return root.getBoundingClientRect();
    }

    function setRootLeftTop(left, top, options = {}) {
      if (!root) return;

      const rect = getRootRect();
      const width = rect ? rect.width : 100;
      const height = rect ? rect.height : 40;

      const safeLeft = Math.max(
        PANEL_VIEWPORT_MARGIN,
        Math.min(window.innerWidth - width, left),
      );

      const safeTop = Math.max(
        PANEL_VIEWPORT_MARGIN,
        Math.min(window.innerHeight - height - PANEL_VIEWPORT_MARGIN, top),
      );

      root.style.left = `${safeLeft}px`;
      root.style.top = `${safeTop}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';

      if (options.save) {
        const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        const panelPosition = {
          ...saved,
          left: safeLeft,
          top: safeTop,
          mode: 'left-top',
          edge: root.dataset.snapEdge || saved.edge || '',
          updatedAt: Date.now(),
        };
        MemoryManager.set(MemoryManager.KEYS.panelPosition, panelPosition);
        saveCurrentToolboxBaseState(options.reason || 'set-root-left-top');
      }
    }


    function snapRootToEdge(options = {}) {
      if (!root) return false;

      const rect = root.getBoundingClientRect();
      const rightDistance = window.innerWidth - rect.right;
      const contactTolerance = 1;

      if (rightDistance <= contactTolerance) {
        const left = window.innerWidth - rect.width;
        const top = rect.top;
        setRootLeftTop(left, top, { save: false });
        root.dataset.snapEdge = '';

        const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        MemoryManager.set(MemoryManager.KEYS.panelPosition, {
          ...saved,
          left,
          top,
          mode: 'left-top',
          edge: '',
          updatedAt: Date.now(),
        });
        saveCurrentToolboxBaseState('snap-root-to-edge');

        if (options.log) {
          appendLog(
            `[TOOLBOX_DRAG][snap] left=${Math.round(left)} top=${Math.round(top)} touching=true rightDistance=${Math.round(rightDistance)}`,
          );
        }
        return true;
      }

      root.dataset.snapEdge = '';
      return false;
    }

    function isPanelHiddenNow() {
      return !!(
        (panel && panel.classList.contains('cgpt-toolbox-hidden')) ||
        (root && root.classList.contains('cgpt-toolbox-panel-hidden'))
      );
    }

    function syncPanelHiddenClass(reason = '') {
      if (!root || !panel) return;
      const hidden = panel.classList.contains('cgpt-toolbox-hidden');
      root.classList.toggle('cgpt-toolbox-panel-hidden', hidden);
      appendLog(
        `[TOOLBOX_PANEL][visibility-class] reason=${reason || '-'} hidden=${hidden}`,
      );
    }

    function showPanel(options = {}) {
      restoreToolboxFromHiddenState(options.reason || 'showPanel', options);

      if (options.save !== false) {
        saveCurrentToolboxBaseState(options.reason || 'panel-show');
      }
    }

    function hidePanel(options = {}) {
      if (!panel || !root) return;

      const reason = options.reason || 'hidePanel';
      saveToolboxPanelRect(`hide:${reason}`);

      const anchored = anchorRootToHiddenTogglePosition(reason);

      if (!anchored) {
        const rect = panel.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          const fallbackPos = {
            left: Number(rect.left),
            top: Math.max(PANEL_VIEWPORT_MARGIN, Number(rect.top) - (HIDDEN_TOGGLE_SIZE.height || 34) - 6),
          };
          saveHiddenTitlePosition(fallbackPos, `${reason}:fallback`);
          const lockedFallback = getLockedHiddenTitlePosition(`${reason}:fallback-locked`);
          if (lockedFallback) {
            applyRootPosition(lockedFallback.left, lockedFallback.top);
            appendLog(
              `[TOOLBOX_HIDE_ANCHOR][fallback-apply] reason=${reason || '-'} left=${Math.round(lockedFallback.left)} top=${Math.round(lockedFallback.top)} panelLeft=${Math.round(Number(rect.left))} panelTop=${Math.round(Number(rect.top))}`,
            );
          } else {
            console.warn('[ChatGPT toolbox] hidePanel fallback locked position missing', rect);
            appendLog(
              `[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} missing-locked-fallback`,
            );
          }
        } else {
          console.warn('[ChatGPT toolbox] hidePanel fallback apply skipped: invalid panel rect', rect);
          appendLog(
            `[TOOLBOX_HIDE_ANCHOR][fallback-skip] reason=${reason || '-'} invalid-panel-rect`,
          );
        }
      }

      panel.classList.add('cgpt-toolbox-hidden');
      root.classList.add('cgpt-toolbox-panel-hidden');

      if (options.saveGlobal !== false) {
        MemoryManager.set(MemoryManager.KEYS.panelHidden, true);
      }

      if (options.save !== false) {
        saveToolboxLayoutState(options.reason || 'panel-hide');
        saveCurrentToolboxBaseState(options.reason || 'panel-hide');
      }

      appendLog(`[TOOLBOX_PANEL][hide] reason=${reason || '-'}`);

      syncPanelHiddenClass(reason);

      updateFloatingTitlePosition(`hide-panel:${reason}`);

      updateRestoreHotzone(reason);
      hideRestoreHandle(`${reason}:floating-title-primary`);

      window.requestAnimationFrame(() => {
        updateFloatingTitlePosition(`hide-panel:${reason}:raf`);

        window.setTimeout(() => {
          if (!isFloatingTitleActuallyVisible()) {
            showRestoreHandle('hidePanel:floating-title-missing', {
              force: true,
            });
          }
        }, 120);
      });

      if (options.skipEdgeAutoHide !== true) {
      }
    }

    function togglePanelHidden() {
      if (!panel) {
        console.warn('[ChatGPT toolbox] togglePanelHidden: panel 不存在');
        appendLog('[TOOLBOX_PANEL][toggle] panel 不存在');
        return;
      }

      if (isToolboxInAnyHiddenState()) {
        restoreToolboxFromHiddenState('toggle-panel-hidden');
      } else {
        hidePanel();
      }
    }

    function bindToggleDrag() {
      const toggle = qs(`#${APP.toggleId}`, root);

      if (!toggle) {
        console.warn('[ChatGPT toolbox] bindToggleDrag: toggle 不存在');
        return;
      }

      if (toggle.dataset.dragBound === '1') {
        return;
      }

      toggle.dataset.dragBound = '1';

      const finishToggleDrag = (state, wasMoved) => {
        if (state.dragRafId) {
          window.cancelAnimationFrame(state.dragRafId);
          state.dragRafId = 0;
        }

        state.committedDx = state.latestDx;
        state.committedDy = state.latestDy;

        clearDragVisualState();

        if (wasMoved && root) {
          const finalLeft = state.startLeft + state.committedDx;
          const finalTop = state.startTop + state.committedDy;

          root.style.left = `${Math.round(finalLeft)}px`;
          root.style.top = `${Math.round(finalTop)}px`;
          root.style.right = 'auto';
          root.style.bottom = 'auto';

          root.dataset.snapEdge = '';

          appendLog(
            `[TOOLBOX_DRAG][toggle-up] left=${Math.round(finalLeft)} top=${Math.round(finalTop)}`,
          );

          schedulePostDragLayout(() => {
            clampRootToViewport('toggle-drag-end', {
              save: true,
            });
            keepToggleFullyInViewport('toggle-drag-end');
            const docked = snapRootToEdge({
              log: true,
            });
            keepToggleFullyInViewport('toggle-drag-end-after-snap');

            if (!docked) {
              saveCurrentRootPosition('drag-end', {
                mode: 'left-top',
              });
            } else {
              saveCurrentRootPosition('drag-end');
            }
          });
        } else {
          appendLog('[TOOLBOX_DRAG][toggle-up] moved=false');
        }
      };

      toggle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (!root) return;

        const wasPanelHidden = isPanelHiddenNow();
        const wasHiddenBeforeDrag = wasPanelHidden;

        ensureRootPositionAnchored();

        const rect = root.getBoundingClientRect();

        toggleDragState = {
          pointerId: e.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startLeft: rect.left,
          startTop: rect.top,
          startWidth: rect.width,
          startHeight: rect.height,
          latestDx: 0,
          latestDy: 0,
          committedDx: 0,
          committedDy: 0,
          dragRafId: 0,
          moved: false,
          restoreApplied: false,
          restoredFromHidden: wasHiddenBeforeDrag,
          wasPanelHidden,
        };

        appendLog(
          `[TOOLBOX_DRAG][toggle-down] left=${Math.round(rect.left)} top=${Math.round(rect.top)} panelHidden=${wasPanelHidden ? '1' : '0'}`,
        );

        try {
          toggle.setPointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] setPointerCapture failed', err);
          appendLog(`[TOOLBOX_DRAG][error] setPointerCapture failed: ${errText}`);
        }

        e.preventDefault();
      });

      toggle.addEventListener('pointermove', (e) => {
        if (!toggleDragState) return;
        if (e.pointerId !== toggleDragState.pointerId) return;

        const dx = e.clientX - toggleDragState.startClientX;
        const dy = e.clientY - toggleDragState.startClientY;
        const movedDistance = Math.sqrt(dx * dx + dy * dy);

        if (movedDistance >= DRAG_CLICK_THRESHOLD) {
          if (!toggleDragState.moved) {
            toggleDragState.moved = true;
            suppressToggleClick = true;
            isDraggingToolbox = true;

            if (!toggleDragState.restoreApplied) {
              toggleDragState.restoreApplied = true;

              if (toggleDragState.wasPanelHidden) {
                exitEdgeHiddenStateForDragStart();
                panel.classList.remove('cgpt-toolbox-hidden');
                root.classList.remove('cgpt-toolbox-panel-hidden');
                MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
                syncPanelHiddenClass('toggle-drag-start');
              }

              root.style.transform = '';
              root.classList.add('cgpt-toolbox-dragging');
              addGlobalDraggingClass();

              if (isToolboxInAnyHiddenState()) {
                updateFloatingTitlePosition('toggle-drag-start');
                appendLog('[TOOLBOX_DRAG][drag-start-title] hidden-state=1');
              }

              appendLog('[TOOLBOX_DRAG][restore-before-real-drag]');
            }
          }
        }

        if (!toggleDragState.moved) return;

        e.preventDefault();

        toggleDragState.latestDx = dx;
        toggleDragState.latestDy = dy;

        if (toggleDragState.dragRafId) return;

        toggleDragState.dragRafId = window.requestAnimationFrame(() => {
          toggleDragState.dragRafId = 0;

          if (!toggleDragState || !root) return;

          toggleDragState.committedDx = toggleDragState.latestDx;
          toggleDragState.committedDy = toggleDragState.latestDy;

          const nextLeft = toggleDragState.startLeft + toggleDragState.committedDx;
          const nextTop = toggleDragState.startTop + toggleDragState.committedDy;
          applyDragPosition(nextLeft, nextTop, 'toggle-dragging');
        });
      });

      toggle.addEventListener('pointerup', (e) => {
        if (!toggleDragState) return;
        if (e.pointerId !== toggleDragState.pointerId) return;

        const state = toggleDragState;
        const wasMoved = state.moved;

        try {
          toggle.releasePointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] releasePointerCapture failed', err);
          appendLog(`[TOOLBOX_DRAG][error] releasePointerCapture failed: ${errText}`);
        }

        finishToggleDrag(state, wasMoved);

        toggleDragState = null;
        isDraggingToolbox = false;

        if (wasMoved) {
          suppressToggleClick = true;
        }

        window.setTimeout(() => {
          suppressToggleClick = false;
        }, TOGGLE_CLICK_SUPPRESS_MS);

        e.preventDefault();
      });

      toggle.addEventListener('pointercancel', (e) => {
        if (!toggleDragState) return;

        const state = toggleDragState;
        const wasMoved = state.moved;

        try {
          toggle.releasePointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] releasePointerCapture failed', err);
          appendLog(`[TOOLBOX_DRAG][error] pointercancel releasePointerCapture failed: ${errText}`);
        }

        finishToggleDrag(state, wasMoved);

        toggleDragState = null;
        isDraggingToolbox = false;
        suppressToggleClick = true;

        window.setTimeout(() => {
          suppressToggleClick = false;
        }, TOGGLE_CLICK_SUPPRESS_MS);

      });

      toggle.addEventListener('click', () => {
        if (suppressToggleClick) {
          suppressToggleClick = false;
          appendLog('[TOOLBOX_PANEL][toggle-click-skip] reason=suppress-after-drag');
          return;
        }

        togglePanelHidden();
      });
    }

    function bindDrag() {
      const handle = qs('.cgpt-toolbox-header', root) || qs('#cgpt-toolbox-drag-handle', root);
      if (!handle) return;

      if (handle.dataset.toolboxDragBound === '1') {
        return;
      }

      handle.dataset.toolboxDragBound = '1';

      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;
      let activePointerId = null;
      let dragRafId = 0;
      let latestDx = 0;
      let latestDy = 0;
      let committedDx = 0;
      let committedDy = 0;

      const onPointerMove = (e) => {
        if (!dragging) return;
        if (activePointerId !== null && e.pointerId !== activePointerId) return;

        e.preventDefault();

        latestDx = e.clientX - startX;
        latestDy = e.clientY - startY;

        if (dragRafId) return;

        dragRafId = window.requestAnimationFrame(() => {
          dragRafId = 0;

          if (!dragging || !root) return;

          committedDx = latestDx;
          committedDy = latestDy;

          const nextLeft = startLeft + committedDx;
          const nextTop = startTop + committedDy;
          applyDragPosition(nextLeft, nextTop, 'panel-dragging');
        });
      };

      const detachDragWindowListeners = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', stopDrag);
        window.removeEventListener('pointercancel', stopDrag);
        window.removeEventListener('blur', onWindowBlur);
      };

      const onLostPointerCapture = (evt) => {
        if (!dragging) return;
        if (activePointerId !== null && evt && evt.pointerId !== activePointerId) return;

        appendLog('[TOOLBOX_DRAG][lost-pointer-capture] cleanup');
        stopDrag(evt || { pointerId: activePointerId });
      };

      const onWindowBlur = () => {
        if (!dragging) return;

        appendLog('[TOOLBOX_DRAG][window-blur] cleanup');
        stopDrag({ pointerId: activePointerId, type: 'blur' });
      };

      const stopDrag = (e) => {
        if (!dragging) return;
        if (activePointerId !== null && e && e.pointerId !== activePointerId) return;

        committedDx = latestDx;
        committedDy = latestDy;

        const finalLeft = startLeft + committedDx;
        const finalTop = startTop + committedDy;

        dragging = false;
        isDraggingToolbox = false;

        if (dragRafId) {
          window.cancelAnimationFrame(dragRafId);
          dragRafId = 0;
        }

        detachDragWindowListeners();

        if (handle) {
          handle.removeEventListener('lostpointercapture', onLostPointerCapture);
        }

        clearDragVisualState(e && e.type === 'blur' ? 'window-blur' : 'panel-drag-stop');

        if (isPanelVisibleNow()) {
          applyPanelPosition(finalLeft, finalTop);
        } else {
          applyRootPosition(finalLeft, finalTop);
        }

        if (e && handle.hasPointerCapture && handle.hasPointerCapture(e.pointerId)) {
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch (err) {
            const errText = err && err.message ? err.message : String(err);
            console.warn('[ChatGPT toolbox] drag handle releasePointerCapture failed', err);
            appendLog(`[TOOLBOX_DRAG][error] handle releasePointerCapture failed: ${errText}`);
          }
        }

        activePointerId = null;

        appendLog(`[TOOLBOX_DRAG][drag-end] left=${Math.round(finalLeft)} top=${Math.round(finalTop)} panelVisible=${isPanelVisibleNow() ? 1 : 0}`);

        schedulePostDragLayout(() => {
          keepPanelInViewport({
            save: false,
          });

          const floatingTitle = getFloatingTitleEl();
          if (floatingTitle && isPanelVisibleNow() && !isToolboxInAnyHiddenState()) {
            floatingTitle.style.display = 'none';
            floatingTitle.classList.remove('cgpt-floating-title-visible');
            floatingTitle.classList.add('cgpt-floating-title-hidden');
          } else if (isToolboxInAnyHiddenState()) {
            updateFloatingTitlePosition('panel-drag-end');
          }

          saveToolboxPanelRect('user-drag-end');
          updateRestoreHotzone('panel-drag-end');
        });

        window.setTimeout(() => {
          if (!isDraggingToolbox) {
          }
        }, 180);
      };

      handle.addEventListener('pointerdown', (e) => {
        if (shouldIgnoreToolboxDrag(e)) {
          return;
        }

        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('button')) return;

        exitEdgeHiddenStateForDragStart();
        dragging = true;
        isDraggingToolbox = true;
        activePointerId = e.pointerId;

        let pos;
        if (isPanelVisibleNow() && panel) {
          pos = panel.getBoundingClientRect();
        } else {
          ensureRootPositionAnchored();
          pos = getRootCurrentPosition();
        }
        startX = e.clientX;
        startY = e.clientY;
        startLeft = pos.left;
        startTop = pos.top;

        latestDx = 0;
        latestDy = 0;
        committedDx = 0;
        committedDy = 0;

        if (isToolboxInAnyHiddenState()) {
          primeFloatingTitlePositionForPanelDrag(startLeft, startTop, 'panel-drag-start');
        }

        if (root) {
          root.style.transform = '';
          root.classList.add('cgpt-toolbox-dragging');
        }

        addGlobalDraggingClass();

        e.preventDefault();

        window.addEventListener('pointermove', onPointerMove, { passive: false });
        window.addEventListener('pointerup', stopDrag);
        window.addEventListener('pointercancel', stopDrag);
        window.addEventListener('blur', onWindowBlur);
        handle.addEventListener('lostpointercapture', onLostPointerCapture);

        try {
          handle.setPointerCapture(e.pointerId);
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.warn('[ChatGPT toolbox] drag handle setPointerCapture failed', err);
          appendLog(`[TOOLBOX_DRAG][error] handle setPointerCapture failed: ${errText}`);
        }

        appendLog(`[TOOLBOX_DRAG][drag-start] left=${Math.round(startLeft)} top=${Math.round(startTop)}`);
      });
    }


    function getHost(name) {
      create();
      return qs(`#cgpt-${name}-tab-host`, root);
    }

    function inferStatusType(text, type) {
      const rawType = String(type || '').trim().toLowerCase();
      const normalizedType = rawType === 'warning'
        ? 'warn'
        : (rawType === 'ok' ? 'success' : rawType);
      if ([
        'idle',
        'running',
        'success',
        'warn',
        'error',
        'offline',
        'online',
        'danger',
        'boot-ready',
      ].includes(normalizedType)) {
        return normalizedType;
      }
      const value = String(text || '');
      if (/失败|错误|异常|超时|缺少|不可用|无法|未找到|error|failed|timeout/i.test(value)) {
        return 'error';
      }
      if (/警告|取消|跳过|warning|warn|skipped|cancel/i.test(value)) {
        return 'warn';
      }
      if (/离线|未绑定|需要重新绑定|需要重新授权|暂无|未知|offline/i.test(value)) {
        return 'warn';
      }
      // Waiting for reply / in-progress states are normal running, not danger.
      if (/等待回答|正在等待回答|正在等待回复|等待回复|回答中/.test(value)) {
        return 'running';
      }
      if (/等待|正在|上传中|复制中|同步中|处理中|轮询中/.test(value)) {
        return 'running';
      }
      if (/成功|完成|已复制|已上传|已发送|在线|已绑定/.test(value)) {
        return 'success';
      }
      return 'idle';
    }

    function ensureStatusBadge() {
      create();
      let badge = qs('#cgpt-toolbox-status-badge', root);
      if (badge) {
        return badge;
      }
      badge = document.createElement('span');
      badge.id = 'cgpt-toolbox-status-badge';
      badge.className = 'cgpt-toolbox-status-badge cgpt-status-idle';
      badge.textContent = '就绪';
      const headerActions = qs('.cgpt-toolbox-header-actions', root);
      const header = qs('.cgpt-toolbox-header', root);
      if (headerActions) {
        headerActions.insertBefore(badge, headerActions.firstChild);
      } else if (header) {
        header.appendChild(badge);
      } else {
        root.appendChild(badge);
      }
      return badge;
    }

    function isRealErrorStatusMessage(statusType, text) {
      const level = String(statusType || '').trim().toLowerCase();
      const value = String(text || '').trim();
      if (!value) {
        return false;
      }
      /*
       * 显式 warn / warning 永远按“警告”处理。
       *
       * 例如：
       *   继续指令发送失败：输入框内容校验失败，已暂停，禁止空转
       *
       * 这类文案虽然包含“失败”，但调用方明确传入 warn，语义是暂停提醒，
       * 不能升级成顶部红色“报错”。
       */
      if (level === 'warn' || level === 'warning') {
        return false;
      }
      if (level === 'error') {
        return true;
      }
      if (
        level === 'danger'
        && /失败|错误|异常|报错|超时|无法|不可用|未找到|拒绝|中断|断开|timeout|failed|error|exception|unavailable|not found|denied/i.test(value)
      ) {
        return true;
      }
      /*
       * 没有明确 level 的 legacy 状态，才允许通过关键词推断为 error。
       */
      if (!level || level === 'idle' || level === 'unknown') {
        return /失败|错误|异常|报错|崩溃|初始化失败|上传失败|发送失败|复制失败|执行失败|运行失败|解析失败|JSONDecodeError|Traceback|Exception|Error|Failed|Fatal|Crash/i.test(value);
      }
      return false;
    }

    function isNonErrorWarningStatus(statusType, text) {
      const level = String(statusType || '').trim().toLowerCase();
      if (level !== 'warn' && level !== 'warning') {
        return false;
      }
      return !isRealErrorStatusMessage(level, text);
    }

    function shouldPersistStatus(statusType, text, options) {
      const opts = options || {};

      if (opts.persist === true) {
        return true;
      }

      if (opts.persist === false) {
        return false;
      }

      const value = String(text || '');

      if (isNonErrorWarningStatus(statusType, value)) {
        return false;
      }

      if (
        statusType === 'error'
        || statusType === 'danger'
        || statusType === 'offline'
        || statusType === 'online'
      ) {
        return true;
      }

      if (/等待|正在|上传中|同步中|发送中|回答中|处理中|轮询中/.test(value)) {
        return true;
      }

      if (/失败|错误|异常|超时|离线|未绑定|不可用/.test(value)) {
        return true;
      }

      return false;
    }

    function buildShortStatusText(text, statusType, options) {
      const opts = options || {};

      if (opts.shortText) {
        return String(opts.shortText);
      }

      const value = String(text || '');

      if (statusType === 'error') {
        if (/部分模块初始化失败|模块初始化失败/.test(value)) return '模块失败';
        if (/上传队列初始化失败|UPLOAD_INIT/.test(value)) return '上传失败';
        if (/UploadModule/.test(value)) return '上传模块失败';
        if (/AutoQueueModule/.test(value)) return '队列失败';
        if (/BridgeModule|Bridge/.test(value)) return 'Bridge失败';
        return '失败';
      }

      if (statusType === 'warn') {
        if (isRealErrorStatusMessage(statusType, value)) return '报错';
        return '';
      }

      if (statusType === 'danger') {
        if (/等待回答/.test(value)) return '等回答';
        if (/正在等待回复|等待回复/.test(value)) return '等待回复';
        if (/回答中/.test(value)) return '回答中';
        return '等待中';
      }

      if (statusType === 'offline') {
        return '离线';
      }

      if (statusType === 'online') {
        if (/可发送/.test(value)) return '可发送';
        if (/已连接/.test(value)) return '已连接';
        return '在线';
      }

      if (statusType === 'running') {
        if (/回答中|生成中/.test(value)) return '回答中';
        if (/等待回答/.test(value)) return '等回答';
        if (/等待发送/.test(value)) return '等发送';
        if (/上传/.test(value)) return '上传中';
        if (/同步/.test(value)) return '同步中';
        if (/复制/.test(value)) return '复制中';
        return '处理中';
      }

      if (statusType === 'success') {
        return '完成';
      }

      return '就绪';
    }

    function isPromptCountStatusText(text) {
      const value = String(text || '').trim();
      return /^\d+\s*条\s*[，,]\s*当前显示\s*\d+\s*条$/.test(value);
    }

    const TOP_MAIN_STATUS_SHORT_TEXTS = new Set([
      '可输入',
      '发送中',
      '回答中',
      '等待回复',
      '等回复',
      '等回答',
      '待发送',
      '附件中',
      '附件处理中',
      '有附件',
      '无附件',
      '不可发送',
      '不可发',
      '离线',
      '未连接',
      '生成中',
      '等待中',
      '可发送',
      '待输入',
    ]);

    function isTopMainStatusDisplayText(text, statusType, options) {
      const opts = options || {};
      const shortText = String(opts.shortText || '').trim();
      if (shortText && TOP_MAIN_STATUS_SHORT_TEXTS.has(shortText)) {
        return true;
      }

      const value = String(text || '').trim();
      if (TOP_MAIN_STATUS_SHORT_TEXTS.has(value)) {
        return true;
      }

      if (/^Bridge 已连接 · (回答中|可发送|待输入)/.test(value)) {
        return true;
      }

      if (/^Bridge 离线/.test(value)) {
        return true;
      }

      if (statusType === 'online' && /可发送|待输入/.test(value)) {
        return true;
      }

      if ((statusType === 'danger' || statusType === 'running') && /回答中|生成中/.test(value)) {
        return true;
      }

      return false;
    }

    function purgeForbiddenStatusBadge(reason) {
      if (!root) {
        return;
      }

      const badge = qs('#cgpt-toolbox-status-badge', root);

      if (!badge) {
        return;
      }

      const text = String(badge.textContent || '').trim();

      if (!text || isPromptCountStatusText(text)) {
        badge.textContent = '';
        badge.title = '';
        badge.classList.add('cgpt-status-hidden');
        badge.style.display = 'none';
        root.removeAttribute('data-status-type');

        if (window.console && typeof console.debug === 'function') {
          console.debug(
            '[ChatGPT toolbox][STATUS_BADGE][PURGE]',
            reason || '-',
            text || '-',
          );
        }
      }
    }

    function hideStatusBadge() {
      const badge = root ? qs('#cgpt-toolbox-status-badge', root) : null;

      if (!badge) {
        return;
      }

      badge.textContent = '';
      badge.title = '';
      badge.classList.add('cgpt-status-hidden');
      badge.classList.remove(
        'cgpt-status-warn',
        'cgpt-status-error',
        'cgpt-status-danger',
      );
      badge.style.display = 'none';
      badge.style.width = '0';
      badge.style.minWidth = '0';
      badge.style.padding = '0';
      badge.style.border = '0';
      badge.style.background = 'transparent';
    }

    function isCompactMode() {
      return !!compactMode;
    }

    function hasActiveTopAlertEntry(entry) {
      if (!entry) {
        return false;
      }
      const level = String(entry.level || '').trim().toLowerCase();
      const text = String(entry.text || '').trim();
      const message = String(entry.message || '').trim();
      if (!level && !text && !message) {
        return false;
      }
      return level === 'error';
    }

    function getCurrentTopAlertEntry() {
      const top = ToolboxStatusArbiter.getTop(Date.now());
      if (!top) {
        return {
          visible: false,
          text: '',
          title: '',
          variant: 'muted',
        };
      }
      const rawStatusText = String(top.text || '').trim();
      if (!rawStatusText || isPromptCountStatusText(rawStatusText)) {
        return {
          visible: false,
          text: '',
          title: '',
          variant: 'muted',
        };
      }
      const statusType = String(top.statusType || '').trim().toLowerCase();
      const opts = top.options || {};
      if (opts.hideTopAlert === true) {
        return {
          visible: false,
          text: '',
          title: '',
          variant: 'muted',
        };
      }
      if (statusType === 'warn' || statusType === 'warning') {
        return {
          visible: false,
          text: '',
          title: '',
          variant: 'muted',
          level: '',
          reason: 'warn-not-top-alert',
        };
      }
      const shortText = buildShortStatusText(rawStatusText, statusType, opts);
      const isTopMainStatus = isTopMainStatusDisplayText(rawStatusText, statusType, {
        ...opts,
        shortText,
      });
      if (isTopMainStatus) {
        return {
          visible: false,
          text: '',
          title: '',
          variant: 'muted',
        };
      }
      if (!isRealErrorStatusMessage(statusType, rawStatusText)) {
        return {
          visible: false,
          text: '',
          title: '',
          variant: 'muted',
        };
      }
      return {
        visible: true,
        text: '报错',
        title: rawStatusText || '当前存在报错',
        variant: 'danger',
        level: 'error',
      };
    }

    let lastTopAlertLogSignature = '';
    let isRefreshingTopStatusAlertSlot = false;
    let lastTopStatusAlertSlotSkipLogAt = 0;

    function logTopAlertEntry(alertEntry, reason = '-') {
      const signature = [
        alertEntry.visible ? '1' : '0',
        alertEntry.level || alertEntry.variant || '',
        alertEntry.text || '',
        alertEntry.title || '',
      ].join('|');
      if (signature === lastTopAlertLogSignature) {
        return;
      }
      lastTopAlertLogSignature = signature;
      if (alertEntry.visible) {
        appendLog(
          `[TOOLBOX_TOP_ALERT][SHOW] level=${alertEntry.level || alertEntry.variant || '-'} `
          + `text=${alertEntry.text || '-'} message=${alertEntry.title || '-'}`,
        );
        return;
      }
      appendLog(`[TOOLBOX_TOP_ALERT][HIDE] reason=no-alert trigger=${reason || '-'}`);
    }

    function refreshTopStatusAlertSlot(reason = '-') {
      const reasonText = String(reason || '-');
      if (isRefreshingTopStatusAlertSlot) {
        const now = Date.now();
        if (now - lastTopStatusAlertSlotSkipLogAt > 1500) {
          lastTopStatusAlertSlotSkipLogAt = now;
          console.warn('[TOOLBOX_TOP_ALERT][REFRESH_REENTRANT_SKIPPED]', {
            reason: reasonText,
          });
        }
        return;
      }
      if (
        typeof UploadModule === 'undefined'
        || !UploadModule
        || typeof UploadModule.renderToolboxTopStatus !== 'function'
      ) {
        return;
      }
      isRefreshingTopStatusAlertSlot = true;
      try {
        UploadModule.renderToolboxTopStatus({
          heavy: false,
          force: true,
          reason: `alert-slot:${reasonText}`,
          skipStatusMutation: true,
          skipAlertRefresh: true,
        });
      } catch (error) {
        console.error('[TOOLBOX_TOP_ALERT][REFRESH_FAILED]', error);
      } finally {
        isRefreshingTopStatusAlertSlot = false;
      }
    }

    const ToolboxStatusArbiter = {
      slots: Object.create(null),
      computePriority(owner, statusType, text, options = {}) {
        if (typeof options.priority === 'number') {
          return options.priority;
        }
        const type = String(statusType || '').trim();
        if (owner === 'upload' && (type === 'running' || type === 'danger')) return 90;
        if (owner === 'send' && (type === 'running' || type === 'danger')) return 85;
        if (owner === 'boot' && (type === 'error' || type === 'danger')) return 80;
        if (owner === 'module-health' && (type === 'error' || type === 'danger')) return 75;
        if (owner === 'bridge' && (type === 'online' || type === 'danger' || type === 'offline')) return 40;
        if (owner === 'autoqueue') return 35;
        if (type === 'danger' || type === 'error') return 70;
        if (type === 'running') return 60;
        if (type === 'warn') return 50;
        if (type === 'offline') return 45;
        if (type === 'online' || type === 'success') return 30;
        return 10;
      },
      push(entry) {
        const owner = entry && entry.owner ? String(entry.owner) : 'legacy';
        if (!owner) return;
        this.slots[owner] = entry;
      },
      clear(owner) {
        const key = String(owner || '').trim();
        if (!key) {
          return;
        }
        delete this.slots[key];
      },
      purgeExpired(now) {
        Object.keys(this.slots).forEach((key) => {
          const item = this.slots[key];
          if (!item) return;
          if (item.expiresAt && now >= item.expiresAt) {
            delete this.slots[key];
          }
        });
      },
      getTop(now) {
        this.purgeExpired(now);
        let best = null;
        Object.keys(this.slots).forEach((key) => {
          const item = this.slots[key];
          if (!item) return;
          if (!best) {
            best = item;
            return;
          }
          if (item.priority > best.priority) {
            best = item;
            return;
          }
          if (item.priority === best.priority && item.createdAt > best.createdAt) {
            best = item;
          }
        });
        return best;
      },
    };

    function shouldSkipDuplicateStatus(owner, statusType, rawStatusText, opts = {}) {
      const now = Date.now();
      const key = [
        String(owner || 'ui'),
        String(statusType || ''),
        String(rawStatusText || ''),
        String(opts.priority || ''),
      ].join('|');
      const force = opts.force === true || opts.forceRender === true;
      if (!force && key === lastStatusApplyKey && now - lastStatusApplyAt < 1200) {
        return true;
      }
      lastStatusApplyKey = key;
      lastStatusApplyAt = now;
      return false;
    }

    function shouldLogStatusLine(owner, statusType, rawStatusText) {
      const now = Date.now();
      const key = [
        String(owner || 'ui'),
        String(statusType || ''),
        String(rawStatusText || ''),
      ].join('|');
      if (key === lastStatusLogKey && now - lastStatusLogAt < 5000) {
        return false;
      }
      lastStatusLogKey = key;
      lastStatusLogAt = now;
      return true;
    }

    function applyTopStatusEntry(entry) {
      if (!entry) {
        latestStatusText = '';
        hideStatusBadge();
        if (root) {
          root.setAttribute('data-status-type', 'idle');
        }
        refreshTopStatusAlertSlot('applyTopStatusEntry:empty');
        return;
      }

      const {
        text,
        statusType,
        options,
      } = entry;

      const rawStatusText = String(text || '').trim();

      if (isPromptCountStatusText(rawStatusText)) {
        latestStatusText = '';
        hideStatusBadge();
        purgeForbiddenStatusBadge('setStatus-prompt-count');
        return;
      }

      const opts = options || {};
      latestStatusText = rawStatusText;

      const persistent = shouldPersistStatus(statusType, latestStatusText, opts);
      const shortText = buildShortStatusText(latestStatusText, statusType, opts);
      const badgeText = String(shortText || '').trim();
      if (!badgeText) {
        console.warn('[STATUS_BADGE][EMPTY_FORCE_HIDE]', {
          reason: 'empty-status-text',
          level: statusType,
          rawStatusText: latestStatusText,
        });
        hideStatusBadge();
        if (root) {
          root.setAttribute('data-status-type', statusType);
        }
        if (!titleEl) {
          titleEl = qs('.cgpt-toolbox-title', root);
        }
        if (titleEl) {
          titleEl.title = latestStatusText
            ? `${getToolboxTitle()} - ${latestStatusText}`
            : getToolboxTitle();
        }
        if (typeof renderToolboxHeaderStatus === 'function') {
          renderToolboxHeaderStatus(`setStatus:${opts.owner || 'ui'}:empty-badge`);
        }
        refreshTopStatusAlertSlot(`applyTopStatusEntry:empty-badge:${opts.owner || 'ui'}`);
        return;
      }
      const isTopMainStatus = isTopMainStatusDisplayText(latestStatusText, statusType, {
        ...opts,
        shortText,
      });

      const shouldShowHeaderStatusBadge = (
        persistent
        && !isTopMainStatus
        && isRealErrorStatusMessage(statusType, rawStatusText)
        && opts.hideHeaderBadge !== true
      );
      if (shouldShowHeaderStatusBadge) {
        const badge = ensureStatusBadge();

        if (badge) {
          badge.style.display = '';
          badge.style.width = '';
          badge.style.minWidth = '';
          badge.style.padding = '';
          badge.style.border = '';
          badge.style.background = '';
          badge.textContent = badgeText;
          badge.title = latestStatusText || badgeText || '';
          badge.classList.remove(
            'cgpt-status-idle',
            'cgpt-status-running',
            'cgpt-status-success',
            'cgpt-status-warn',
            'cgpt-status-error',
            'cgpt-status-danger',
            'cgpt-status-offline',
            'cgpt-status-online',
            'cgpt-status-hidden',
          );
          badge.classList.add(`cgpt-status-${statusType}`);
        }
      } else {
        hideStatusBadge();
      }

      if (root) {
        root.setAttribute('data-status-type', statusType);
      }

      if (!titleEl) {
        titleEl = qs('.cgpt-toolbox-title', root);
      }

      if (titleEl) {
        titleEl.title = latestStatusText
          ? `${getToolboxTitle()} - ${latestStatusText}`
          : getToolboxTitle();
      }

      if (latestStatusText && shouldLogStatusLine(opts.owner || 'ui', statusType, latestStatusText)) {
        const logModuleRef = globalThis.__CGPT_TOOLBOX_LOG_MODULE__;
        if (logModuleRef && typeof logModuleRef.add === 'function') {
          logModuleRef.add(`[状态][${statusType}] ${latestStatusText}`);
        }
      }

      if (typeof renderToolboxHeaderStatus === 'function') {
        renderToolboxHeaderStatus(`setStatus:${opts.owner || 'ui'}`);
      }
      refreshTopStatusAlertSlot(`applyTopStatusEntry:${opts.owner || 'ui'}`);
    }

    function setStatus(text, type, options) {
      create();

      const rawStatusText = String(text || '').trim();

      if (isPromptCountStatusText(rawStatusText)) {
        latestStatusText = '';
        hideStatusBadge();
        purgeForbiddenStatusBadge('setStatus-prompt-count');
        return;
      }

      const statusType = inferStatusType(rawStatusText, type);
      const opts = options || {};
      const owner = String(opts.owner || 'ui');
      /*
       * 显式 warn / warning 只作为短提示或日志，不允许进入顶部红色 alert。
       * 之前 isRealErrorStatusMessage 会因为“失败”关键词把 warn 升级为 error，
       * 导致“继续指令发送失败，已暂停”这类状态一直显示成红色“报错”。
       */
      if (statusType === 'warn' || statusType === 'warning') {
        opts.persist = opts.persist === true ? true : false;
        if (!Number.isFinite(Number(opts.ttlMs)) || Number(opts.ttlMs) <= 0) {
          opts.ttlMs = 2500;
        }
        opts.hideTopAlert = true;
        opts.hideHeaderBadge = true;
      } else if (isNonErrorWarningStatus(statusType, rawStatusText)) {
        opts.persist = false;
        if (!Number.isFinite(Number(opts.ttlMs)) || Number(opts.ttlMs) <= 0) {
          opts.ttlMs = 2500;
        }
        opts.hideTopAlert = true;
        opts.hideHeaderBadge = true;
      }
      if (
        owner === 'upload'
        && statusType === 'error'
        && opts.source !== 'real-upload'
      ) {
        if (opts.persist == null) {
          opts.persist = false;
        }
        appendLog(
          `[STATUS_ARBITER][UPLOAD_ERROR_SUPPRESSED] owner=${owner} text=${rawStatusText || '-'} source=${String(opts.source || '-')} reason=${String(opts.reason || '-')}`,
        );
      }
      if (!opts.owner && typeof isPerfDebugEnabled === 'function' && isPerfDebugEnabled()) {
        appendLog(`[STATUS_ARBITER][MISSING_OWNER] text=${rawStatusText || '-'} type=${statusType || '-'} fallback=ui`);
      }
      if (shouldSkipDuplicateStatus(owner, statusType, rawStatusText, opts)) {
        return;
      }
      const now = Date.now();
      const ttlMs = Number(opts.ttlMs || 0);
      const entry = {
        owner,
        text: rawStatusText,
        statusType,
        options: opts,
        createdAt: now,
        priority: ToolboxStatusArbiter.computePriority(owner, statusType, rawStatusText, opts),
        expiresAt: ttlMs > 0 ? now + ttlMs : 0,
      };

      ToolboxStatusArbiter.push(entry);

      const top = ToolboxStatusArbiter.getTop(now);
      applyTopStatusEntry(top);
      if (typeof renderToolboxHeaderStatus === 'function') {
        renderToolboxHeaderStatus(`setStatus-entry:${owner}`);
      }
      refreshTopStatusAlertSlot(`setStatus-entry:${owner}`);
    }

    function clearStatus(owner) {
      const ownerKey = String(owner || '').trim();
      if (!ownerKey) {
        return;
      }
      ToolboxStatusArbiter.clear(ownerKey);
      const top = ToolboxStatusArbiter.getTop(Date.now());
      applyTopStatusEntry(top);
      if (typeof renderToolboxHeaderStatus === 'function') {
        renderToolboxHeaderStatus(`clearStatus:${ownerKey}`);
      }
      refreshTopStatusAlertSlot(`clearStatus:${ownerKey}`);
    }

    function refreshStatus(reason = '') {
      const top = ToolboxStatusArbiter.getTop(Date.now());
      applyTopStatusEntry(top);
      if (typeof renderToolboxHeaderStatus === 'function') {
        renderToolboxHeaderStatus(`refreshStatus:${reason || '-'}`);
      }
      refreshTopStatusAlertSlot(`refreshStatus:${reason || '-'}`);
      if (reason) {
        appendLog(`[STATUS_ARBITER][REFRESH] reason=${reason}`);
      }
    }

    function migrateToolboxToastToPanel(reason = '') {
      if (!root || !panel) {
        return;
      }

      const oldRootToast = qs('#cgpt-toolbox-toast', root);
      if (oldRootToast && oldRootToast.parentElement !== panel) {
        panel.appendChild(oldRootToast);
        appendLog(`[TOOLBOX_TOAST][migrate] from=root to=panel reason=${reason || '-'}`);
      }
    }

    function ensureToolboxToast() {
      create();

      if (!panel) {
        panel = root ? qs(`#${APP.panelId}`, root) : null;
      }

      if (!panel) {
        console.warn('[ChatGPT toolbox] ensureToolboxToast: panel 不存在');
        appendLog('[TOOLBOX_TOAST][skip] reason=missing-panel');
        return null;
      }

      let box = qs('#cgpt-toolbox-toast', panel);

      if (!box) {
        const oldBox = root ? qs('#cgpt-toolbox-toast', root) : null;

        if (oldBox) {
          box = oldBox;
          panel.appendChild(box);
        } else {
          box = document.createElement('div');
          box.id = 'cgpt-toolbox-toast';
          box.className = 'cgpt-toolbox-toast';
          box.hidden = true;
          box.setAttribute('aria-hidden', 'true');
          panel.appendChild(box);
        }
      }

      const duplicateToasts = root
        ? Array.from(root.querySelectorAll('#cgpt-toolbox-toast')).filter((node) => node !== box)
        : [];
      duplicateToasts.forEach((node) => {
        if (node && node.parentElement) {
          node.parentElement.removeChild(node);
        }
      });

      return box;
    }

    function showToast(text, type = 'info', timeoutMs = 1400) {
      create();
      const toastType = inferStatusType(text, type);
      const box = ensureToolboxToast();
      if (!box) {
        return;
      }
      const safeText = String(text || '');
      const normalizedTimeoutMs = Number(timeoutMs);
      const visibleMs = Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0
        ? Math.max(800, normalizedTimeoutMs)
        : 1400;
      const fadeOutMs = 180;
      const nextSeq = Number(box.__cgptToastSeq || 0) + 1;
      box.__cgptToastSeq = nextSeq;
      if (box.__cgptToastTimer) {
        window.clearTimeout(box.__cgptToastTimer);
        box.__cgptToastTimer = 0;
      }
      if (box.__cgptToastCleanupTimer) {
        window.clearTimeout(box.__cgptToastCleanupTimer);
        box.__cgptToastCleanupTimer = 0;
      }
      if (box.__cgptToastRaf) {
        window.cancelAnimationFrame(box.__cgptToastRaf);
        box.__cgptToastRaf = 0;
      }
      box.hidden = false;
      box.setAttribute('aria-hidden', 'false');
      box.textContent = safeText;
      box.classList.remove(
        'cgpt-toast-idle',
        'cgpt-toast-running',
        'cgpt-toast-success',
        'cgpt-toast-warn',
        'cgpt-toast-error',
        'cgpt-toast-danger',
        'cgpt-toast-offline',
        'cgpt-toast-online',
        'cgpt-toast-boot-ready',
        'show',
      );
      box.classList.add(`cgpt-toast-${toastType}`);
      box.__cgptToastRaf = window.requestAnimationFrame(() => {
        if (Number(box.__cgptToastSeq || 0) !== nextSeq) {
          return;
        }
        box.classList.add('show');
        box.__cgptToastRaf = 0;
      });
      box.__cgptToastTimer = window.setTimeout(() => {
        if (Number(box.__cgptToastSeq || 0) !== nextSeq) {
          return;
        }
        box.classList.remove('show');
        box.__cgptToastCleanupTimer = window.setTimeout(() => {
          if (Number(box.__cgptToastSeq || 0) !== nextSeq) {
            return;
          }
          box.hidden = true;
          box.setAttribute('aria-hidden', 'true');
          box.textContent = '';
          box.classList.remove(
            'cgpt-toast-idle',
            'cgpt-toast-running',
            'cgpt-toast-success',
            'cgpt-toast-warn',
            'cgpt-toast-error',
            'cgpt-toast-danger',
            'cgpt-toast-offline',
            'cgpt-toast-online',
            'cgpt-toast-boot-ready',
          );
          box.__cgptToastTimer = 0;
          box.__cgptToastCleanupTimer = 0;
        }, fadeOutMs);
      }, visibleMs);
      appendLog(
        `[TOOLBOX_TOAST][show] type=${toastType} timeoutMs=${visibleMs} text=${safeText.slice(0, 40)} host=panel`,
      );
    }

    function startToolboxWatchdog() {
      if (toolboxWatchdogTimer) {
        return;
      }

      toolboxWatchdogTimer = window.setInterval(() => {
        try {
          const domRoot = document.getElementById(APP.rootId);

          if (!root && domRoot && isValidShellRoot(domRoot)) {
            root = domRoot;
            panel = qs(`#${APP.panelId}`, root);
            titleEl = qs('.cgpt-toolbox-title', root);
            bindEvents();
            ensureEdgeHotzoneElement();
            ensureRestoreHotzoneElement();
            updateRestoreHotzone('watchdog-adopt');
            appendLog('[TOOLBOX_WATCHDOG][ADOPT] reason=found-existing-dom');
            return;
          }

          if (root && !document.documentElement.contains(root)) {
            findToolboxMountRoot().appendChild(root);
            panel = qs(`#${APP.panelId}`, root);
            titleEl = qs('.cgpt-toolbox-title', root);
            bindEvents();
            ensureEdgeHotzoneElement();
            ensureRestoreHotzoneElement();
            updateRestoreHotzone('watchdog-remount');
            appendLog('[TOOLBOX_WATCHDOG][REMOUNT] reason=interval-detached-root');
            return;
          }

          if (!domRoot) {
            root = null;
            panel = null;
            titleEl = null;
            create();
            void mountAllModules('watchdog-recreate');
            appendLog('[TOOLBOX_WATCHDOG][RECREATE] reason=missing-root');
          }
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] toolbox watchdog failed', err);
          appendLog(`[TOOLBOX_WATCHDOG][FAILED] error=${errText}`);
        }
      }, 3000);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') {
          return;
        }

        try {
          const domRoot = document.getElementById(APP.rootId);
          if (!domRoot || (root && !document.documentElement.contains(root))) {
            appendLog('[TOOLBOX_WATCHDOG][VISIBILITY_CHECK]');
            create();
            mountAllModules('watchdog-visibility-recreate');
          }

          repairInvisibleToolboxState('watchdog-visibility');
        } catch (err) {
          const errText = err && err.message ? err.message : String(err);
          console.error('[ChatGPT toolbox] visibility watchdog failed', err);
          appendLog(`[TOOLBOX_WATCHDOG][VISIBILITY_FAILED] error=${errText}`);
        }
      });
    }

    function bindGlobalErrorGuard() {
      if (globalErrorGuardBound) {
        return;
      }

      globalErrorGuardBound = true;

      window.addEventListener('error', (event) => {
        const msg = event && event.message ? event.message : 'unknown';
        const file = event && event.filename ? event.filename : '-';
        const line = event && event.lineno ? event.lineno : '-';

        const fileText = String(file || '');
        const msgText = String(msg || '');

        const isToolboxError =
          fileText.includes('chatgpt-toolbox') ||
          fileText.includes('cgpt-toolbox') ||
          msgText.includes('[ChatGPT toolbox]') ||
          msgText.includes('[TOOLBOX_') ||
          msgText.includes('[CGPT_');

        if (!isToolboxError) {
          console.debug('[ChatGPT toolbox] ignored page error', {
            message: msgText,
            file: fileText,
            line,
          });
          return;
        }

        console.error('[ChatGPT toolbox] global toolbox error captured', event.error || event);
        appendLog(`[GLOBAL_ERROR][toolbox] message=${msgText} file=${fileText} line=${line}`);
      }, true);

      window.addEventListener('unhandledrejection', (event) => {
        const reason = event && event.reason
          ? (event.reason.message ? event.reason.message : String(event.reason))
          : 'unknown';

        const stack = event && event.reason && event.reason.stack
          ? String(event.reason.stack).slice(0, 500)
          : '';

        const reasonText = String(reason || '');
        const stackText = String(stack || '');

        const isToolboxRejection =
          reasonText.includes('[ChatGPT toolbox]') ||
          reasonText.includes('[TOOLBOX_') ||
          reasonText.includes('[CGPT_') ||
          stackText.includes('cgpt-toolbox') ||
          stackText.includes('chatgpt-toolbox');

        if (!isToolboxRejection) {
          console.debug('[ChatGPT toolbox] ignored page rejection', {
            reason: reasonText,
            stack: stackText,
          });
          return;
        }

        console.warn('[ChatGPT toolbox] toolbox unhandled rejection captured', event.reason);
        appendLog(`[GLOBAL_REJECTION][toolbox] reason=${reasonText} stack=${stackText}`);
      }, true);
    }

    function appendLog(text) {
      const message = String(text || '');

      if (appendingLog) {
        console.debug('[ChatGPT toolbox][LOG_REENTER]', message);
        return;
      }

      appendingLog = true;

      try {
        try {
          const perfInc = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).__CGPT_TOOLBOX_PERF_INC__;
          if (typeof perfInc === 'function') {
            perfInc('log.append', 1);
          }
        } catch (e) {
          // ignore
        }
        const logModule = globalThis.__CGPT_TOOLBOX_LOG_MODULE__;
        if (logModule && typeof logModule.add === 'function') {
          logModule.add(message);
        } else {
          console.debug('[ChatGPT toolbox][LOG_BEFORE_READY]', message);
        }
      } catch (err) {
        console.error('[ChatGPT toolbox] appendLog failed', err, message);
      } finally {
        appendingLog = false;
      }
    }

    const logThrottleAt = new Map(); // key -> ts
    const logLastValue = new Map(); // key -> lastValue

    function appendLogThrottled(key, text, throttleMs = 2000) {
      const k = String(key || text || 'default');
      const now = Date.now();
      const lastAt = Number(logThrottleAt.get(k) || 0);
      const gap = Number(throttleMs || 0) || 0;
      if (gap > 0 && now - lastAt < gap) {
        return false;
      }
      logThrottleAt.set(k, now);
      appendLog(text);
      return true;
    }

    function logNestedScrollContainers(reason = '-', options = {}) {
      if (!options || options.debugEnabled !== true) {
        return;
      }

      const root = document.querySelector(`#${APP.rootId}, .cgpt-toolbox-root, .cgpt-toolbox-panel`);
      if (!(root instanceof HTMLElement)) {
        return;
      }

      const scrollables = [];
      const nodes = root.querySelectorAll('*');
      nodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const canScroll = (
          (overflowY === 'auto' || overflowY === 'scroll')
          && node.scrollHeight > node.clientHeight + 2
        );
        if (canScroll) {
          scrollables.push({
            tag: node.tagName,
            id: node.id || '-',
            cls: String(node.className || '-').slice(0, 120),
            clientHeight: node.clientHeight,
            scrollHeight: node.scrollHeight,
            overflowY,
          });
        }
      });

      appendLog(
        '[UI_LAYOUT][SCROLL_CONTAINERS] '
        + `reason=${reason} count=${scrollables.length} `
        + scrollables
          .slice(0, 8)
          .map((item, index) => (
            `#${index + 1}:${item.tag}#${item.id}.${item.cls} `
            + `${item.clientHeight}/${item.scrollHeight} overflowY=${item.overflowY}`
          ))
          .join(' || '),
      );
    }

    function logBatchStatusLayoutDebug(reason = '-', options = {}) {
      if (!options || options.debugEnabled !== true) {
        return;
      }

      const rootEl = document.querySelector(`#${APP.rootId}, .cgpt-toolbox-root, .cgpt-toolbox-panel`);
      const card = document.querySelector('.cgpt-batch-status-card, .cgpt-autoq-status-card, .cgpt-autoq-user-summary');
      const row = document.querySelector('.cgpt-batch-status-row, .cgpt-autoq-status-row, .cgpt-status-row');
      const value = document.querySelector('.cgpt-batch-status-value, .cgpt-autoq-status-row .cgpt-autoq-status-value, .cgpt-autoq-status-value');

      const getRectText = (el) => {
        if (!(el instanceof HTMLElement)) {
          return '-';
        }
        const rect = el.getBoundingClientRect();
        return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      };

      const zoomPercent = Math.round((window.devicePixelRatio || 1) * 100);

      appendLog(
        '[UI_LAYOUT][BATCH_STATUS] '
        + `reason=${reason} `
        + `zoom=${zoomPercent} `
        + `viewport=${window.innerWidth}x${window.innerHeight} `
        + `root=${getRectText(rootEl)} `
        + `card=${getRectText(card)} `
        + `row=${getRectText(row)} `
        + `value=${getRectText(value)}`,
      );
    }

    function repairToolboxLayoutIfCompressed(reason = '-') {
      const valueEl = document.querySelector(
        '.cgpt-batch-status-value, .cgpt-autoq-status-row .cgpt-autoq-status-value, .cgpt-autoq-user-hint-row .cgpt-autoq-status-value',
      );
      const rootEl = panel || document.querySelector(`#${APP.panelId}, .cgpt-toolbox-panel`);

      if (!(valueEl instanceof HTMLElement) || !(rootEl instanceof HTMLElement)) {
        return;
      }

      const valueRect = valueEl.getBoundingClientRect();
      const currentPanelWidth = rootEl.getBoundingClientRect().width;
      const lock = getUserPanelSizeLockState();
      const userSizeLocked = lock.locked === true;
      const recentUserResize = lastUserPanelResizeAt > 0
        && (Date.now() - lastUserPanelResizeAt) < USER_PANEL_RESIZE_PROTECT_MS;

      if (userSizeLocked || recentUserResize) {
        appendLog(
          '[UI_LAYOUT][COMPRESSED_REPAIR_SKIP_USER_SIZE] '
          + `reason=${reason} currentWidth=${Math.round(currentPanelWidth)} `
          + `savedWidth=${lock.width || lastUserPanelResizeSize?.width || 0} `
          + `valueWidth=${Math.round(valueRect.width)} userSizeLocked=${userSizeLocked ? 1 : 0} `
          + `recentUserResize=${recentUserResize ? 1 : 0}`,
        );
        return;
      }

      if (detectTopBadgeOverflow(`compressed-repair-check:${reason}`, { log: false, fix: true })) {
        appendLog(
          '[UI_LAYOUT][COMPRESSED_REPAIR_SKIP_TOP_BADGE] '
          + `reason=${reason} currentWidth=${Math.round(currentPanelWidth)} `
          + `valueWidth=${Math.round(valueRect.width)} action=narrow-wrap-not-resize`,
        );
        return;
      }

      if (valueRect.width <= 0) {
        compressedRepairDeferCount += 1;
        appendLog(
          '[UI_LAYOUT][COMPRESSED_REPAIR_DEFER] '
          + `reason=${reason} valueWidth=${Math.round(valueRect.width)} `
          + `currentPanelWidth=${Math.round(currentPanelWidth)} attempt=${compressedRepairDeferCount}`,
        );

        if (compressedRepairDeferCount < COMPRESSED_REPAIR_MAX_DEFER_ATTEMPTS) {
          scheduleCompressedRepairRecheck(reason, 300);
          return;
        }

        compressedRepairDeferCount = 0;
        return;
      }

      compressedRepairDeferCount = 0;

      if (valueRect.width >= 220) {
        return;
      }

      const fixedWidth = getCompressedRepairTargetWidth();
      rootEl.style.setProperty('--cgpt-toolbox-width', `${fixedWidth}px`);
      rootEl.style.width = `${fixedWidth}px`;

      appendLog(
        '[UI_LAYOUT][COMPRESSED_REPAIR] '
        + `reason=${reason} valueWidth=${Math.round(valueRect.width)} fixedWidth=${fixedWidth} compact=${compactMode ? 1 : 0}`,
      );
    }

    function appendLogIfChanged(key, value, text, throttleMsIfSame = 0) {
      const k = String(key || 'default');
      const v = value == null ? '' : String(value);
      const prev = logLastValue.get(k);
      if (prev === v) {
        if (throttleMsIfSame > 0) {
          return appendLogThrottled(`${k}:same`, text, throttleMsIfSame);
        }
        return false;
      }
      logLastValue.set(k, v);
      appendLog(text);
      return true;
    }

    function isPerfDebugEnabled() {
      try {
        return typeof MemoryManager !== 'undefined'
          && typeof MemoryManager.get === 'function'
          && !!MemoryManager.get('bridgeDebugEnabled', false);
      } catch (e) {
        return false;
      }
    }

    async function applyToolboxPageState(reason = '') {
      create();

      const applySeq = ++toolboxPageStateApplySeq;
      const toolboxRouteKeyAtStart = getToolboxRouteKey();
      const state = getToolboxPageState();

      const abortIfStaleApply = () => {
        if (applySeq !== toolboxPageStateApplySeq) {
          appendLog(
            `[TOOLBOX_PAGE_STATE][apply-skip-stale] reason=${reason || '-'} seq=${applySeq} current=${toolboxPageStateApplySeq}`,
          );
          return true;
        }

        if (getToolboxRouteKey() !== toolboxRouteKeyAtStart) {
          appendLog(
            `[TOOLBOX_PAGE_STATE][apply-abort] reason=route-key-changed old=${toolboxRouteKeyAtStart} current=${getToolboxRouteKey()}`,
          );
          return true;
        }

        return false;
      };

      isApplyingToolboxPageState = true;

      try {
        if (
          (reason === 'init' || reason === 'route-key-changed')
          && typeof waitChatPageReady === 'function'
        ) {
          const readyResult = await waitChatPageReady({ timeoutMs: 30000 });

          if (readyResult && readyResult.ok) {
            appendLog('[CONVERSATION][RESTORE_READY]');
          } else {
            appendLog('[CONVERSATION][RESTORE_TIMEOUT]');
          }
        }

        const activeTabField = readToolboxStateField(state, 'activeTab', '');
        const uploadGroupField = readToolboxStateField(
          state,
          'uploadActiveGroupId',
          '',
        );
        appendLog(
          `[TOOLBOX_PAGE_STATE][APPLY] reason=${reason || '-'} toolboxRouteKey=${toolboxRouteKeyAtStart} seq=${applySeq} `
          + `activeTab=${activeTabField || '-'} uploadActiveGroupId=${uploadGroupField || '-'} `
          + `compactMode=${compactMode ? 'true' : 'false'} isApplyingToolboxPageState=true `
          + `keys=${Object.keys(state).join(',')}`,
        );
        appendLog(
          `[TOOLBOX_PAGE_STATE][apply] reason=${reason || '-'} toolboxRouteKey=${toolboxRouteKeyAtStart} seq=${applySeq} keys=${Object.keys(state).join(',')}`,
        );

        if (abortIfStaleApply()) {
          return;
        }

        const activeTab = normalizeTab(readToolboxStateField(state, 'activeTab', 'upload'));
        switchTab(activeTab, {
          save: false,
          reason: reason || 'restore-page-state',
        });

        if (abortIfStaleApply()) {
          return;
        }

        if (typeof UploadModule !== 'undefined'
          && typeof UploadModule.applyToolboxPageState === 'function') {
          await UploadModule.applyToolboxPageState(state, reason);
        }

        if (abortIfStaleApply()) {
          return;
        }
      } catch (error) {
        appendLog(
          `[TOOLBOX_PAGE_STATE][apply-error] reason=${reason || '-'} error=${error && error.stack ? error.stack : String(error)}`,
        );
      } finally {
        if (applySeq === toolboxPageStateApplySeq) {
          isApplyingToolboxPageState = false;
        }
      }
    }

    async function handleRouteChange(reason = '') {
      const nextPageKey = getToolboxRouteKey();
      const nextConvKey = getToolboxConversationStateKey();

      if (!lastToolboxRouteKey) {
        lastToolboxRouteKey = nextPageKey;
        lastToolboxConversationKey = nextConvKey;
        return;
      }

      const toolboxRouteKeyChanged = nextPageKey !== lastToolboxRouteKey;
      const convKeyChanged = nextConvKey !== lastToolboxConversationKey;

      if (!toolboxRouteKeyChanged && !convKeyChanged) {
        return;
      }

      if (toolboxRouteKeyChanged) {
        const oldKey = lastToolboxRouteKey;
        const oldStates = readAllToolboxPageStates();
        const oldPageState = oldStates[oldKey] && typeof oldStates[oldKey] === 'object'
          ? oldStates[oldKey]
          : {};

        saveToolboxBaseStateForRouteKey(oldKey, 'before-route-key-change', {
          url: oldPageState.url || window.location.href,
          pathname: oldPageState.pathname || window.location.pathname,
        });

        lastToolboxRouteKey = nextPageKey;

        if (typeof cleanupChatMessageCaches === 'function') {
          cleanupChatMessageCaches(`route-key-changed:${reason || '-'}`);
        }

        appendLog(
          `[TOOLBOX_PAGE_STATE][page-change] reason=${reason || '-'} old=${oldKey} next=${nextPageKey}`,
        );

        await applyToolboxPageState('route-key-changed');
      }

      if (convKeyChanged) {
        lastToolboxConversationKey = nextConvKey;

        if (typeof cleanupChatMessageCaches === 'function') {
          cleanupChatMessageCaches(`conversation-id-changed:${reason || '-'}`);
        }

        appendLog(
          `[TOOLBOX_CONV_STATE][conversation-change] reason=${reason || '-'} next=${nextConvKey || '-'}`,
        );
      }
    }

    function checkToolboxRouteKeyChanged(reason = '') {
      void handleRouteChange(reason).catch((error) => {
        appendLog(
          `[TOOLBOX_PAGE_STATE][route-change-error] reason=${reason || '-'} error=${error && error.stack ? error.stack : String(error)}`,
        );
      });
    }

    function bindToolboxPageStateRouteWatcher() {
      if (window.__cgptToolboxPageStateWatcherBound) {
        return;
      }

      window.__cgptToolboxPageStateWatcherBound = true;
      lastToolboxRouteKey = getToolboxRouteKey();
      lastToolboxConversationKey = getToolboxConversationStateKey();

      installUnifiedRouteChangePipeline();

      window.setInterval(() => {
        checkToolboxRouteKeyChanged('interval');
      }, 1500);

      appendLog(`[TOOLBOX_PAGE_STATE][route-watch-bind] toolboxRouteKey=${lastToolboxRouteKey}`);
    }

    return {
      create,
      getHost,
      setStatus,
      clearStatus,
      refreshStatus,
      showToast,
      appendLog,
      appendLogThrottled,
      appendLogIfChanged,
      isUserScrollingNow,
      purgeForbiddenStatusBadge,
      ensureToolboxHeaderPageStatusRow,
      ensureToolboxTitleRow,
      ensureSingleCompactModeButton,
      isCompactMode,
      hasActiveTopAlertEntry,
      getCurrentTopAlertEntry,
      logTopAlertEntry,
      refreshTopStatusAlertSlot,
      updateToolboxNarrowClass,
      updateToolboxResponsiveClass,
      updateToolboxStatusVisibilityClass,
      shouldHideTopStatusBadge,
      detectTopBadgeOverflow,
      detectTopStatusOverflow,
      syncToolboxHeaderLayout,
      clampToolboxPanelToViewport,
      switchTab,
      restoreActiveTab,
      getActiveTab,
      applyToolboxUiState,
      applyToolboxPageState,
      handleRouteChange,
      resetToolboxPosition,
      restoreToolboxFromHiddenState,
      clearViewportTimers,
      flashHeaderTitleOnce,
      stopHeaderTitleFlash,
      collectLayoutDebugInfo,
      updateToolboxLayoutMode,
      renderLayoutDebugInfo,
      clampToolboxWidth,
      logBatchStatusLayoutDebug,
      logNestedScrollContainers,
      repairToolboxLayoutIfCompressed,
    };
  })();

  function isChatSidebarElement(el) {
    if (!el || !el.closest) return false;

    return !!el.closest(
      [
        'aside',
        'nav',
        '[data-testid*="sidebar"]',
        '[data-testid*="history"]',
        '[aria-label*="历史"]',
        '[aria-label*="聊天"]',
        '[aria-label*="Chat history"]',
        '[aria-label*="conversation"]',
      ].join(','),
    );
  }

  const COMPOSER_AREA_SELECTORS_FOR_MESSAGE = [
    '[data-testid="composer"]',
    '#prompt-textarea',
    'textarea[name="prompt-textarea"]',
    '[data-testid="composer-textarea"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"][role="textbox"]',
  ].join(',');

  function isInComposerArea(el) {
    if (!el) return false;
    return !!el.closest(COMPOSER_AREA_SELECTORS_FOR_MESSAGE);
  }

  function getMessageContentElement(el) {
    if (!el) return null;

    const nodes = getMessageContentElements(el);
    if (nodes.length > 0) {
      return nodes[0];
    }

    return el;
  }

  function getMessageContentElements(el) {
    if (!el) return [];

    const selectors = [
      '[data-message-author-role="assistant"] .markdown',
      '[data-message-author-role="assistant"] [data-message-content]',
      '[data-message-author-role="assistant"] .whitespace-pre-wrap',
      '[data-message-author-role="assistant"] [class*="markdown"]',

      '[data-message-author-role="user"] [data-message-content]',
      '[data-message-author-role="user"] .whitespace-pre-wrap',

      '.markdown',
      '[data-message-content]',
      '[class*="markdown"]',
      '.whitespace-pre-wrap',
      'pre',
      'code',
    ];

    const nodes = [];

    selectors.forEach((selector) => {
      qsa(selector, el).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (isInToolbox(node)) return;
        if (isInComposerArea(node)) return;
        if (isChatSidebarElement(node)) return;

        const text = String(node.innerText || node.textContent || '').trim();
        if (!text) return;

        nodes.push(node);
      });
    });

    const unique = [];
    nodes.forEach((node) => {
      const isInsideExisting = unique.some((old) => old !== node && old.contains(node));
      if (isInsideExisting) return;

      for (let i = unique.length - 1; i >= 0; i -= 1) {
        if (node.contains(unique[i])) {
          unique.splice(i, 1);
        }
      }

      if (!unique.includes(node)) {
        unique.push(node);
      }
    });

    unique.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return unique;
  }

  function extractCleanTextFromNode(node) {
    if (!node) return '';

    const clone = node.cloneNode(true);

    clone.querySelectorAll([
      'button',
      'svg',
      'style',
      'script',
      '[aria-hidden="true"]',
      '[data-testid="copy-turn-action-button"]',
      '[data-testid="feedback-actions"]',
      '[data-testid*="feedback"]',
      '[data-testid*="copy"]',
      '[class*="text-token-text-tertiary"]',
    ].join(',')).forEach((child) => {
      child.remove();
    });

    const rawText = String(clone.innerText || clone.textContent || '');
    return cleanCopiedMessageText(rawText);
  }

  function getFullMessageTextFromElement(el) {
    if (!el) {
      return {
        text: '',
        contentNodeCount: 0,
        contentTextChars: 0,
        fullTurnTextChars: 0,
        source: 'empty',
      };
    }

    const fullTurnEl =
      el.closest &&
      el.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]')
        ? el.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]')
        : el;

    const contentNodes = getMessageContentElements(fullTurnEl);

    const contentText = contentNodes
      .map((node) => extractCleanTextFromNode(node))
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const fullTurnText = extractCleanTextFromNode(fullTurnEl)
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const cleanFn =
      typeof ChatMessageExtractor !== 'undefined' &&
      ChatMessageExtractor &&
      typeof ChatMessageExtractor.cleanMessageText === 'function'
        ? ChatMessageExtractor.cleanMessageText
        : cleanCopiedMessageText;

    const cleanedContentText = cleanFn(contentText);
    const cleanedFullTurnText = cleanFn(fullTurnText);

    const afterThinkingText = extractFinalAnswerAfterThinkingText(fullTurnText);
    const cleanedAfterThinking = cleanFn(afterThinkingText);

    if (shouldUseAfterThinkingCopyText(cleanedAfterThinking)) {
      return {
        text: cleanedAfterThinking,
        contentNodeCount: contentNodes.length,
        contentTextChars: cleanedContentText.length,
        fullTurnTextChars: cleanedFullTurnText.length,
        source: 'after-thinking',
      };
    }

    let finalText = cleanedContentText;
    let source = 'content-nodes';

    if (
      cleanedFullTurnText &&
      (
        !finalText ||
        cleanedFullTurnText.length > finalText.length + 80 ||
        cleanedFullTurnText.length > finalText.length * 1.3
      )
    ) {
      finalText = cleanedFullTurnText;
      source = 'full-turn-fallback';
    }

    return {
      text: finalText,
      contentNodeCount: contentNodes.length,
      contentTextChars: cleanedContentText.length,
      fullTurnTextChars: cleanedFullTurnText.length,
      source,
    };
  }

  function cleanCopiedMessageText(text) {
    let value = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const lines = value.split('\n');

    while (lines.length > 0) {
      const first = String(lines[0] || '').trim();

      if (
        /^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)$/i.test(first) ||
        /^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)\s*[:：]$/i.test(first)
      ) {
        lines.shift();
        continue;
      }

      break;
    }

    value = lines.join('\n').trim();

    value = value
      .replace(/^(ChatGPT\s*(说|said)|你说|You\s+said|用户说)\s*[:：]\s*/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return value;
  }

  function getVisibleTextFromElement(el) {
    if (!el) return '';

    const contentEl = getMessageContentElement(el) || el;
    const clone = contentEl.cloneNode(true);

    clone.querySelectorAll([
      'button',
      'svg',
      'style',
      'script',
      '[aria-hidden="true"]',
      '[data-testid="copy-turn-action-button"]',
      '[data-testid="feedback-actions"]',
      '[data-testid*="feedback"]',
      '[data-testid*="copy"]',
      '[class*="text-token-text-tertiary"]',
    ].join(',')).forEach((node) => {
      node.remove();
    });

    const rawText = String(clone.textContent || clone.innerText || '');
    const fullTurnRawText = el !== contentEl
      ? String(el.textContent || el.innerText || '')
      : rawText;

    const afterThinking = extractFinalAnswerAfterThinkingText(fullTurnRawText);

    if (afterThinking && afterThinking.length >= 20) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(
          `[CHAT_PAGE][message-extract-after-thinking] chars=${afterThinking.length}`,
        );
      }

      return (
        typeof ChatMessageExtractor !== 'undefined' &&
        ChatMessageExtractor &&
        typeof ChatMessageExtractor.cleanMessageText === 'function'
          ? ChatMessageExtractor.cleanMessageText(afterThinking)
          : cleanCopiedMessageText(afterThinking)
      );
    }

    return cleanCopiedMessageText(rawText);
  }

  function findConversationMessageElements(options = {}) {
    const includeHidden = options.includeHidden === true;
    const selectors = [
      'article[data-testid^="conversation-turn-"]',
      '[data-testid^="conversation-turn-"]',
      '[data-message-author-role]',
    ];

    const seen = new Set();
    const result = [];

    selectors.forEach((selector) => {
      qsa(selector).forEach((el) => {
        if (!(el instanceof HTMLElement)) return;
        if (isInToolbox(el)) return;

        const container = el.closest(
          'article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]'
        ) || el;

        if (!(container instanceof HTMLElement)) return;
        if (seen.has(container)) return;
        if (isInToolbox(container)) return;

        if (!includeHidden) {
          const rect = container.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
        }

        seen.add(container);
        result.push(container);
      });
    });

    result.sort((a, b) => {
      if (a === b) return 0;
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    return result;
  }

  function getMessageRole(el) {
    if (!el) return '';

    const direct = el.getAttribute('data-message-author-role');
    if (direct) return String(direct || '').toLowerCase();

    const roleNode = el.querySelector('[data-message-author-role]');
    if (roleNode) {
      return String(roleNode.getAttribute('data-message-author-role') || '').toLowerCase();
    }

    const text = String(el.getAttribute('data-testid') || '').toLowerCase();
    if (text.includes('conversation-turn')) {
      return '';
    }

    return '';
  }

  function getConversationTurnId(el) {
    if (!el) return '';

    const direct = el.getAttribute && el.getAttribute('data-testid');
    if (direct && /^conversation-turn-/i.test(String(direct))) {
      return String(direct);
    }

    const turn = el.closest && el.closest('article[data-testid^="conversation-turn-"], [data-testid^="conversation-turn-"]');
    if (turn) {
      return String(turn.getAttribute('data-testid') || '');
    }

    return '';
  }

  function isThinkingBoundaryLine(line) {
    const text = String(line || '').trim();

    if (!text) {
      return false;
    }

    return (
      /^已思考\s*(?:若干秒|几\s*秒|\d+)/.test(text) ||
      /^已思考.*(?:秒|分钟|m|s|›|>)/i.test(text) ||
      /^Thought for\s+\d+/i.test(text) ||
      /^Thinking/i.test(text) ||
      /^正在思考/.test(text)
    );
  }

  function isThinkingUiNoiseLine(line) {
    const text = String(line || '').trim();

    if (!text) {
      return false;
    }

    return (
      isThinkingBoundaryLine(text) ||
      text === '展开' ||
      text === '收起' ||
      text === 'Show more' ||
      text === 'Show less'
    );
  }

  function extractFinalAnswerAfterThinkingText(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n');

    const normalized = raw
      .replace(
        /(已思考\s*(?:若干秒|几\s*秒|\d+\s*(?:秒|分钟|m|min|s)?(?:\s*\d+\s*s)?)(?:\s*[›>])?)/gi,
        '\n$1\n',
      )
      .replace(
        /(Thought for\s+\d+[^\n]*)/gi,
        '\n$1\n',
      )
      .replace(
        /(正在思考[^\n]*)/g,
        '\n$1\n',
      );

    const lines = normalized.split('\n');

    let boundaryIndex = -1;

    for (let i = 0; i < lines.length; i += 1) {
      if (isThinkingBoundaryLine(lines[i])) {
        boundaryIndex = i;
      }
    }

    if (boundaryIndex < 0) {
      return '';
    }

    const afterLines = lines
      .slice(boundaryIndex + 1)
      .filter((line) => !isThinkingUiNoiseLine(line));

    return afterLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function shouldUseAfterThinkingCopyText(text) {
    const t = String(text || '').trim();
    if (!t) {
      return false;
    }
    if (typeof isThinkingUiNoiseLine === 'function' && isThinkingUiNoiseLine(t)) {
      return false;
    }
    if (t.includes('<<<XZ_TOOLBOX_BATCH_TASK_DONE_7F3B9C>>>')) {
      return true;
    }
    if (t.includes('<<<CHATGPT_TOOLBOX_DONE>>>') || t.includes('__CHATGPT_TOOLBOX_DONE__')) {
      return true;
    }
    return t.length >= 2;
  }

  function chooseAssistantFinalAnswerText(rawText, fallbackText, meta = {}) {
    if (
      typeof UploadCriticalRuntime !== 'undefined'
      && UploadCriticalRuntime
      && typeof UploadCriticalRuntime.isUploadCriticalMode === 'function'
      && UploadCriticalRuntime.isUploadCriticalMode()
    ) {
      // 上传关键期只做轻量 fallback，避免触发 after-thinking 提取/重型清洗。
      const cleanFn =
        typeof ChatMessageExtractor !== 'undefined' &&
        ChatMessageExtractor &&
        typeof ChatMessageExtractor.cleanMessageText === 'function'
          ? ChatMessageExtractor.cleanMessageText
          : cleanCopiedMessageText;

      const cleanedFallback = cleanFn(fallbackText || rawText || '');

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog('[UPLOAD_CRITICAL][SKIP_HEAVY_CHAT_SCAN] reason=uploading');
      }

      return {
        text: String(cleanedFallback || '').trim(),
        source: 'fallback-content',
        isStreaming: false,
      };
    }

    const cleanFn =
      typeof ChatMessageExtractor !== 'undefined' &&
      ChatMessageExtractor &&
      typeof ChatMessageExtractor.cleanMessageText === 'function'
        ? ChatMessageExtractor.cleanMessageText
        : cleanCopiedMessageText;

    const cleanedRaw = cleanFn(rawText || '');
    const cleanedFallback = cleanFn(fallbackText || '');

    const afterThinking = extractFinalAnswerAfterThinkingText(rawText);
    const cleanedAfterThinking = cleanFn(afterThinking || '');

    if (shouldUseAfterThinkingCopyText(cleanedAfterThinking)) {
      const streaming = (
        (typeof isChatGPTActuallyBusyForTaskQueue === 'function' && isChatGPTActuallyBusyForTaskQueue())
        || (
          typeof ComposerApi !== 'undefined'
          && typeof ComposerApi.isAssistantLikelyBusy === 'function'
          && ComposerApi.isAssistantLikelyBusy()
        )
        || (
          typeof hasRealChatGPTStopGeneratingButton === 'function'
          && hasRealChatGPTStopGeneratingButton()
        )
      );

      const closedLoopWaitPoll = (
        (typeof window !== 'undefined' && window.__cgptClosedLoopWaitPollActive === true)
        || meta.closedLoopWaitPoll === true
      );
      const pickSource = String(meta.pickSource || meta.source || '');
      const isClosedLoopWaitPick = /wait-cycle|closed-loop-wait/i.test(pickSource);

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        if (streaming && (closedLoopWaitPoll || isClosedLoopWaitPick)) {
          // 闭环等待轮询期间不输出 streaming 重型 pick 日志。
        } else {
          const logTag = streaming
            ? '[CHAT_PAGE][assistant-streaming-answer-picked]'
            : '[CHAT_PAGE][assistant-final-answer-picked]';
          ToolboxShell.appendLog(
            `${logTag} source=after-thinking chars=${cleanedAfterThinking.length} fallbackChars=${String(cleanedFallback || '').length} turn=${meta.turnId || '-'}`,
          );
        }
      }

      return {
        text: cleanedAfterThinking,
        source: 'after-thinking',
        isStreaming: streaming,
      };
    }

    let finalText = cleanedFallback;
    let source = 'fallback-content';

    if (
      cleanedRaw &&
      (
        !finalText ||
        cleanedRaw.length > finalText.length + 80 ||
        cleanedRaw.length > finalText.length * 1.3
      )
    ) {
      finalText = cleanedRaw;
      source = 'raw-full-turn';
    }

    return {
      text: String(finalText || '').trim(),
      source,
    };
  }

