  const ToolboxShell = (() => {
    const TOOLBOX_DEFAULT_TITLE = '小张工具箱';
    const TOOLBOX_RESTORE_HANDLE_TITLE = '小张工具箱';

    let toolboxTitle = TOOLBOX_DEFAULT_TITLE;

    const VIEWPORT_SAFE_MARGIN = 8;
    const TOOLBOX_MIN_VISIBLE_WIDTH = 64;
    const TOOLBOX_MIN_VISIBLE_HEIGHT = 34;

    const PANEL_DEFAULT_SIZE = Object.freeze({
      width: 520,
      height: 500,
      minWidth: 300,
      minHeight: 240,
    });

    const PANEL_COMPACT_DEFAULT_SIZE = Object.freeze({
      width: 340,
      height: 280,
      minWidth: 280,
      minHeight: 180,
    });

    const PANEL_VIEWPORT_MARGIN = 8;

    // 只允许 1px 以内的浏览器小数误差，不能再把 8px/10px 当作贴边。
    const EDGE_DOCK_CONTACT_TOLERANCE = 1;
    const EDGE_CONTACT_EPSILON = 1;
    const EDGE_RESTORE_OFFSET = 24;
    const SHELL_EVENTS_VERSION = 'resize-drag-split-v1-panel-handle';

    const EDGE_HANDLE_SIZE = Object.freeze({
      width: 110,
      height: 34,
    });

    const HIDDEN_TOGGLE_SIZE = Object.freeze({
      width: 38,
      height: 34,
    });

    // 自动隐藏只允许向右侧触发，禁止左侧/上侧/下侧触发隐藏。
    const EDGE_AUTO_HIDE_SIDE = 'right';
    const VALID_EDGE_SIDES = Object.freeze([EDGE_AUTO_HIDE_SIDE]);

    const TOOLBOX_FLOATING_HIDDEN_CLASS = 'cgpt-toolbox-floating-hidden';

    function isFloatingEdgeHidden() {
      return !!(root && (
        root.classList.contains('cgpt-edge-hidden')
        || root.classList.contains(TOOLBOX_FLOATING_HIDDEN_CLASS)
      ));
    }

    function setFloatingEdgeHidden(active, reason = '') {
      if (!root) {
        return;
      }

      const on = Boolean(active);
      root.classList.toggle('cgpt-edge-hidden', on);
      root.classList.toggle(TOOLBOX_FLOATING_HIDDEN_CLASS, on);

      if (on) {
        root.classList.add('cgpt-edge-right');
      } else {
        root.classList.remove('cgpt-edge-right');
      }
    }

    let edgeRestoreClickGuardUntil = 0;
    let edgeRevealTimer = 0;
    let edgeRehideGuardUntil = 0;
    let edgeAutoHideSuspendUntil = 0;
    let forceShowingUntil = 0;
    let isDraggingToolbox = false;
    let isResizingToolbox = false;

    const EDGE_HIDE_VISIBLE_SIZE = 18;

    let edgeHotzone = null;
    let edgeHotzoneHovering = false;
    const EDGE_REVEAL_HOTZONE_THICKNESS = 72;
    const EDGE_REVEAL_HOTZONE_EXTRA = 36;

    let restoreHotzone = null;
    let restoreHotzoneHoverTimer = 0;
    let restoreHandle = null;
    let lastPanelVisibleRect = null;

    const RESTORE_HOTZONE_WIDTH = 260;
    const RESTORE_HOTZONE_MIN_HEIGHT = 180;
    const RESTORE_HOTZONE_EXTRA = 48;
    const RESTORE_HOTZONE_HOVER_DELAY = 120;

    function getEdgeContactLimit() {
      return EDGE_DOCK_CONTACT_TOLERANCE;
    }

    function getRightEdgeDistance(rect) {
      if (!rect) return Number.POSITIVE_INFINITY;
      return window.innerWidth - rect.right;
    }

    function isAutoHideTriggerSide(side) {
      return String(side || '').trim() === EDGE_AUTO_HIDE_SIDE;
    }

    function isStrictlyTouchingEdge(rect, side) {
      if (!rect || !isAutoHideTriggerSide(side)) return false;

      const distance = getRightEdgeDistance(rect);

      // distance <= 1 表示已经贴住右边缘，或者轻微越界。
      // 不允许 8px、10px、36px 这种「靠近边缘」触发隐藏。
      return distance <= EDGE_CONTACT_EPSILON;
    }
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
    let compactMode = false;
    let panelResizeObserver = null;
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

    function exitEdgeHiddenStateForDragStart() {
      if (root) {
        root.classList.remove(
          'cgpt-toolbox-edge-hidden',
          'cgpt-edge-hidden',
          'cgpt-toolbox-edge-revealed',
          'cgpt-edge-right',
        );

        root.removeAttribute('data-edge-side');
        delete root.dataset.edgeSide;
        root.style.transform = '';
      }

      if (edgeHotzone) {
        edgeHotzone.classList.remove('active');
        edgeHotzone.style.display = 'none';
      }

      MemoryManager.saveToolboxPatch({
        edgeHidden: false,
      });
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

        #${APP.rootId}.cgpt-toolbox-panel-hidden #${APP.toggleId},
        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.toggleId},
        #${APP.rootId}.cgpt-edge-hidden #${APP.toggleId} {
          display: none !important;
        }

        #${APP.rootId}.cgpt-toolbox-edge-revealed #${APP.toggleId} {
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

        #${APP.rootId}.cgpt-edge-hidden,
        #${APP.rootId}.cgpt-toolbox-floating-hidden {
          transition: transform 160ms ease, opacity 160ms ease;
          opacity: 0.72;
        }

        #${APP.rootId}.cgpt-edge-hidden:hover,
        #${APP.rootId}.cgpt-toolbox-floating-hidden:hover {
          transform: none !important;
          opacity: 1;
        }

        #${APP.rootId}.cgpt-edge-hidden.cgpt-edge-right,
        #${APP.rootId}.cgpt-toolbox-floating-hidden.cgpt-edge-right {
          transform: translateX(calc(100% - ${EDGE_HIDE_VISIBLE_SIZE}px));
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden {
          transition: transform 160ms ease;
          opacity: 1;
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden.cgpt-edge-hidden {
          transform: none !important;
          opacity: 1;
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden[data-edge-side="right"] {
          transform: translateX(calc(100% - ${EDGE_HIDE_VISIBLE_SIZE}px));
        }

        #${APP.rootId}.cgpt-toolbox-edge-revealed {
          transition: left 160ms ease, top 160ms ease, transform 160ms ease;
          transform: none !important;
          opacity: 1 !important;
        }

        #${APP.rootId}.cgpt-toolbox-panel-hidden #${APP.panelId},
        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.panelId},
        #${APP.rootId}.cgpt-edge-hidden #${APP.panelId},
        #${APP.rootId}.cgpt-toolbox-floating-hidden #${APP.panelId} {
          display: none !important;
          pointer-events: none !important;
        }

        #${APP.rootId}.cgpt-toolbox-edge-revealed #${APP.panelId} {
          display: flex !important;
          pointer-events: auto !important;
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.toggleId},
        #${APP.rootId}.cgpt-edge-hidden #${APP.toggleId},
        #${APP.rootId}.cgpt-toolbox-floating-hidden #${APP.toggleId} {
          width: 38px;
          min-width: 38px;
          height: 34px;
          padding: 0;
          writing-mode: horizontal-tb;
          text-orientation: mixed;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          box-shadow: 0 8px 22px rgba(0,0,0,0.42);
          opacity: 0.92;
          pointer-events: auto;
        }

        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #${APP.toggleId}:hover,
        #${APP.rootId}.cgpt-edge-hidden #${APP.toggleId}:hover,
        #${APP.rootId}.cgpt-toolbox-floating-hidden #${APP.toggleId}:hover {
          opacity: 1;
        }

        #${APP.edgeHotzoneId} {
          position: fixed;
          z-index: 2147483646;
          display: none;
          pointer-events: none;
          background: transparent;
        }

        #${APP.edgeHotzoneId}.active {
          display: block;
          pointer-events: auto;
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

        #${APP.panelId} {
          display: flex;
          flex-direction: column;
          position: fixed;
          left: 80px;
          top: 80px;
          right: auto;
          bottom: auto;
          width: 520px;
          height: 500px;
          min-width: 300px;
          min-height: 240px;
          max-width: calc(100vw - 32px);
          max-height: calc(100vh - 82px);
          background: #0f1115;
          color: #f2f2f2;
          border: 1px solid #2f3542;
          border-radius: 14px;
          overflow: hidden;
          resize: none;
          box-shadow: 0 14px 36px rgba(0,0,0,0.42);
          pointer-events: auto;
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
          width: 340px;
          min-width: 280px;
          min-height: 180px;
          max-height: calc(100vh - 82px);
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
          height: 34px;
          flex-basis: 34px;
          padding: 0 8px;
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
          display: none !important;
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

        #${APP.panelId}.cgpt-toolbox-compact #cgpt-upload-module.compact-hide-upload-start #cgpt-upload-start {
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

        #${APP.panelId}.cgpt-toolbox-compact .cgpt-toolbox-header-status-row .cgpt-toolbox-top-status-badge {
          min-height: 22px !important;
          line-height: 22px !important;
          padding: 0 8px !important;
          border-radius: 11px !important;
          font-size: 11px !important;
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
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-stats-line,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] .cgpt-export-advanced,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-panel,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-prompts,
        #${APP.panelId}.cgpt-toolbox-compact [data-page="export"] #cgpt-export-copy-stats {
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
          flex: 0 0 42px;
          height: 42px;
          padding: 0 10px 0 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          background: #111827;
          border-bottom: 1px solid #2f3542;
          cursor: move;
          user-select: none;
          touch-action: none;
        }

        .cgpt-toolbox-title {
          flex: 0 0 auto;
          min-width: 0;
          font-size: 13px;
          font-weight: 800;
          color: #f8fafc;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          letter-spacing: 0.2px;
        }

        .cgpt-toolbox-header-status-row {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1 1 auto;
          justify-content: flex-end;
          min-width: 0;
        }

        .cgpt-toolbox-header-status-row .cgpt-toolbox-top-status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 24px;
          line-height: 24px;
          padding: 0 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0;
          box-sizing: border-box;
          border: 1px solid transparent;
          white-space: nowrap;
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-page-id-badge {
          color: #ffffff;
          background: linear-gradient(180deg, #18b663 0%, #129452 100%);
          border-color: rgba(121, 243, 174, 0.35);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-turn-count-badge {
          color: #ffffff;
          background: linear-gradient(180deg, #2e4367 0%, #1f2f4f 100%);
          border-color: rgba(118, 154, 220, 0.35);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        #${APP.panelId} .cgpt-toolbox-header-status-row .cgpt-toolbox-turn-count-badge.cgpt-toolbox-turn-count-warning {
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

        .cgpt-toolbox-status-badge.cgpt-status-hidden {
          display: none !important;
        }

        #cgpt-toolbox-status-badge.cgpt-status-hidden {
          display: none !important;
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

        .cgpt-toast-success,
        .cgpt-toast-online {
          background: rgba(22, 101, 52, 0.96);
          color: #dcfce7;
          border-color: rgba(74, 222, 128, 0.75);
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

        .cgpt-toolbox-tabs {
          flex: 0 0 auto;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 10px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible;
          background: #0f1115;
          border-bottom: 1px solid #2f3542;
        }

        .cgpt-toolbox-tab {
          flex: 0 1 auto;
          min-width: 0;
          max-width: 120px;
          height: 32px;
          border: 1px solid #3f4655;
          background: #171b22;
          color: #d1d5db;
          border-radius: 9px;
          cursor: pointer;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
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

        .cgpt-toolbox-content {
          flex: 1 1 auto;
          min-height: 0;
          min-width: 0;
          overflow-y: auto;
          overflow-x: hidden !important;
          padding: 10px;
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
          flex: 1 1 120px;
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
          height: 32px;
          padding: 0 10px;
          border: 1px solid #475569;
          background: #1f2937;
          color: #f2f2f2;
          border-radius: 9px;
          cursor: pointer;
          white-space: nowrap;
        }

        .cgpt-btn.compact {
          height: 28px;
          padding: 0 8px;
        }

        .cgpt-btn:hover {
          background: #273449;
        }

        .cgpt-btn:focus {
          outline: 2px solid rgba(96, 165, 250, 0.75);
          outline-offset: 2px;
        }

        .cgpt-btn:active {
          transform: translateY(1px);
        }

        .cgpt-btn.cgpt-btn-ok {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-idle,
        .cgpt-btn.primary {
          background: #2563eb;
          border-color: #3b82f6;
          color: #ffffff;
        }

        .cgpt-btn.cgpt-btn-idle:hover,
        .cgpt-btn.primary:hover {
          background: #1d4ed8;
        }

        .cgpt-btn.cgpt-btn-waiting {
          background: #d97706 !important;
          border-color: #f59e0b !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-waiting:hover {
          background: #b45309 !important;
        }

        .cgpt-btn.cgpt-btn-running,
        .cgpt-btn.cgpt-btn-sending,
        .cgpt-btn.cgpt-btn-danger {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-running:hover,
        .cgpt-btn.cgpt-btn-sending:hover,
        .cgpt-btn.cgpt-btn-danger:hover {
          background: #b91c1c !important;
        }

        .cgpt-btn.cgpt-btn-success {
          background: #16a34a !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-cancelled {
          background: #6b7280 !important;
          border-color: #9ca3af !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-failed {
          background: #991b1b !important;
          border-color: #b91c1c !important;
          color: #ffffff !important;
        }

        .cgpt-btn.cgpt-btn-disabled {
          background: #9ca3af !important;
          border-color: #9ca3af !important;
          color: #ffffff !important;
          cursor: not-allowed;
          opacity: 1 !important;
        }

        .cgpt-btn.cgpt-task-running-indicator {
          opacity: 0.75;
          cursor: not-allowed;
          background: #374151 !important;
          border-color: #4b5563 !important;
          color: #d1d5db !important;
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

        .cgpt-btn.purple:disabled {
          opacity: 1 !important;
          cursor: not-allowed;
        }

        .cgpt-btn.cyan:disabled {
          opacity: 1 !important;
          cursor: not-allowed;
        }

        #cgpt-copy-hotkey-continue-loop.danger {
          background: #dc2626;
          border-color: #ef4444;
          color: #ffffff;
        }

        #cgpt-autoq-start-upload.cgpt-btn-danger,
        #cgpt-autoq-start-upload.cgpt-btn-running,
        #cgpt-autoq-start-upload[aria-busy="true"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        #cgpt-upload-start {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #ffffff !important;
        }

        #cgpt-upload-start:hover:not(:disabled) {
          background: #15803d !important;
        }

        #cgpt-upload-start:disabled {
          opacity: 1 !important;
          cursor: not-allowed;
        }

        #cgpt-upload-start[data-upload-state="uploading"],
        #cgpt-upload-start.cgpt-btn-danger,
        #cgpt-upload-start.cgpt-btn-running,
        #cgpt-upload-start.cgpt-btn-uploading,
        #cgpt-upload-start[aria-busy="true"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          opacity: 1 !important;
          cursor: pointer !important;
        }

        #cgpt-upload-start[data-upload-state="uploading"]:hover,
        #cgpt-upload-start.cgpt-btn-danger:hover,
        #cgpt-upload-start.cgpt-btn-running:hover,
        #cgpt-upload-start.cgpt-btn-uploading:hover,
        #cgpt-upload-start[aria-busy="true"]:hover {
          background: #b91c1c !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
        }

        .cgpt-upload-action-toolbar {
          display: block;
          margin: 0 0 10px;
          min-width: 0;
          max-width: 100%;
          overflow-x: hidden !important;
          overflow-y: visible !important;
        }

        .cgpt-upload-action-toolbar .cgpt-upload-action-row {
          margin-top: 0;
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

        #cgpt-send-message-once {
          background: #1d4ed8 !important;
          border-color: #3b82f6 !important;
          color: #ffffff !important;
        }

        #cgpt-send-message-once:hover:not(:disabled) {
          background: #2563eb !important;
        }

        #cgpt-send-message-once.danger,
        #cgpt-send-message-once.cgpt-send-danger,
        #cgpt-send-message-once.cgpt-wait-send-cancel,
        #cgpt-send-message-once[data-send-state="sending"],
        #cgpt-send-message-once[data-send-state="waiting-reply"],
        #cgpt-send-message-once[data-send-state="cancelable-waiting"],
        #cgpt-send-message-once[aria-busy="true"] {
          background: #dc2626 !important;
          border-color: #ef4444 !important;
          color: #ffffff !important;
          cursor: pointer;
          opacity: 1;
        }

        .cgpt-btn-copy-continue,
        #cgpt-upload-continue-once,
        #cgpt-upload-continue-once.copy-continue,
        #cgpt-upload-continue-once.cgpt-btn-busy {
          background: #7c3aed !important;
          border-color: #8b5cf6 !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }
}
 
        #cgpt-upload-continue-once:hover {
          background: #8b5cf6 !important;
        }

        #cgpt-upload-continue-once.cgpt-waiting-answer,
        #cgpt-upload-continue-once.cgpt-waiting-answer:hover {
          background: #d97706 !important;
          border-color: #f59e0b !important;
          color: #ffffff !important;
          opacity: 1 !important;
        }

        
        #cgpt-copy-last-message-scroll-bottom {
          background: #2563eb !important;
          border-color: #3b82f6 !important;
          color: #ffffff !important;
          pointer-events: auto !important;
          user-select: none !important;
          touch-action: manipulation !important;
        }

        #cgpt-copy-last-message-scroll-bottom[disabled] {
          pointer-events: auto !important;
        }

        #cgpt-copy-last-message-scroll-bottom:hover:not(:disabled),
        #cgpt-copy-last-message-scroll-bottom.cgpt-waiting-answer:hover:not(:disabled),
        #cgpt-copy-last-message-scroll-bottom.waiting:hover:not(:disabled) {
          background: #b45309 !important;
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
          border: 1px solid #475569;
          background: #171b22;
          color: #d1d5db;
          border-radius: 999px;
          cursor: pointer;
          white-space: nowrap;
          max-width: 140px;
          overflow: hidden;
        }

        .cgpt-upload-group-chip:hover {
          background: #202633;
        }

        .cgpt-upload-group-chip.active {
          background: #22324a;
          border-color: #4b6b95;
          color: #dbeafe;
          font-weight: 650;
          box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.10);
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

        .cgpt-autoq-mode-tabs {
          display: flex;
          flex-wrap: nowrap;
          gap: 6px;
          align-items: center;
          margin-bottom: 8px;
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

        .cgpt-autoq-editor-block #cgpt-autoq-prompts {
          width: 100%;
          min-height: 140px;
          max-height: 180px;
          resize: vertical;
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

        #cgpt-autoq-start.cgpt-btn-danger,
        #cgpt-autoq-start.cgpt-btn-running,
        #cgpt-autoq-start.cgpt-btn-sending,
        #cgpt-autoq-start.cgpt-btn-waiting-danger,
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

        #cgpt-autoq-start.cgpt-btn-idle,
        #cgpt-autoq-start.cgpt-btn-running,
        #cgpt-autoq-start.cgpt-btn-waiting,
        #cgpt-autoq-start.cgpt-btn-sending {
          pointer-events: auto !important;
        }

        .cgpt-autoq-settings-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 12px;
          align-items: center;
        }

        .cgpt-autoq-settings-grid .cgpt-kv {
          grid-template-columns: 110px 1fr;
          margin-top: 0;
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

        .cgpt-autoq-status-panel {
          border: 1px solid #2f3542;
          background: #111827;
          border-radius: 8px;
          padding: 6px 8px;
          color: #e5e7eb;
          font-size: 11px;
          line-height: 1.2;
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
          align-items: center;
          gap: 4px;
          overflow: hidden;
          white-space: nowrap;
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

        .cgpt-autoq-status-value {
          min-width: 0;
          color: #ffffff;
          font-weight: 650;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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

        .cgpt-autoq-log {
          margin-top: 8px;
          max-height: 120px;
          min-height: 60px;
          overflow-y: auto;
          border: 1px solid #2f3542;
          border-radius: 10px;
          background: #0f1115;
          padding: 8px;
          font-family: Consolas, "SFMono-Regular", monospace;
          font-size: 11px;
          white-space: pre-wrap;
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
        }

        .cgpt-autoq-main-lite > .cgpt-autoq-status-panel {
          margin: 0;
          padding: 0;
          border: 0;
          background: transparent;
        }

        .cgpt-autoq-main-lite > .cgpt-autoq-status-grid {
          margin: 0;
          padding: 0;
        }

        .cgpt-autoq-main-lite-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
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

        .cgpt-autoq-task-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-height: 260px;
          overflow-y: auto;
          border: 1px solid #2f3542;
          border-radius: 10px;
          padding: 6px;
          background: #0f1115;
        }

        .cgpt-autoq-task-item {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) auto !important;
          align-items: center !important;
          column-gap: 8px !important;
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

        .cgpt-autoq-task-item-main-inline {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          gap: 8px !important;
          min-width: 0 !important;
          overflow: hidden !important;
          white-space: nowrap !important;
        }

        .cgpt-autoq-task-item-title {
          flex: 0 1 auto !important;
          min-width: 80px !important;
          max-width: 220px !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
          font-weight: 700 !important;
          color: #e5e7eb !important;
        }

        .cgpt-autoq-task-item-meta,
        .cgpt-autoq-task-item-source,
        .cgpt-autoq-task-item-category {
          flex: 0 0 auto !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
          font-size: 12px !important;
          color: #9ca3af !important;
          margin-top: 0 !important;
          line-height: 1.25 !important;
        }

        .cgpt-autoq-task-item-actions {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: flex-end !important;
          gap: 5px !important;
          flex-wrap: wrap !important;
          row-gap: 4px !important;
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

        #${APP.rootId}:not(.cgpt-edge-hidden):not(.cgpt-toolbox-floating-hidden):not(.cgpt-toolbox-edge-hidden) #cgpt-toolbox-floating-title {
          display: none !important;
        }

        #${APP.rootId}.cgpt-edge-hidden #cgpt-toolbox-floating-title,
        #${APP.rootId}.cgpt-toolbox-floating-hidden #cgpt-toolbox-floating-title,
        #${APP.rootId}.cgpt-toolbox-edge-hidden #cgpt-toolbox-floating-title,
        #${APP.rootId}.cgpt-toolbox-panel-hidden #cgpt-toolbox-floating-title,
        #${APP.rootId}.cgpt-toolbox-edge-hidden:not(.cgpt-toolbox-edge-revealed) #cgpt-toolbox-floating-title,
        #${APP.rootId}.cgpt-edge-hidden #cgpt-toolbox-floating-title {
          display: inline-flex !important;
        }

        #${APP.rootId}:not(.cgpt-toolbox-panel-hidden):not(.cgpt-toolbox-edge-hidden) #${APP.toggleId} {
          display: none !important;
        }

        #${APP.rootId}.cgpt-edge-hidden,
        #${APP.rootId}.cgpt-toolbox-edge-hidden {
          transform: none !important;
        }

        /* 工具箱内部禁止横向滚动（完整模式 + 精简模式） */
        #${APP.panelId},
        #${APP.panelId} .cgpt-toolbox-content,
        #${APP.panelId} .cgpt-toolbox-page,
        #${APP.panelId} .cgpt-section {
          max-width: 100%;
        }

        #${APP.panelId} {
          min-width: 300px;
          overflow: hidden;
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
      let width = rect.width || EDGE_HANDLE_SIZE.width || 110;
      let height = rect.height || EDGE_HANDLE_SIZE.height || 34;

      if (!Number.isFinite(left)) left = viewport.width - width - VIEWPORT_SAFE_MARGIN;
      if (!Number.isFinite(top)) top = viewport.height - height - VIEWPORT_SAFE_MARGIN;
      if (!Number.isFinite(width) || width <= 0) width = EDGE_HANDLE_SIZE.width || 110;
      if (!Number.isFinite(height) || height <= 0) height = EDGE_HANDLE_SIZE.height || 34;

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
      const allowEdgeHidden = opts.allowEdgeHidden !== false;
      const saveAfterClamp = opts.save !== false;
      const rect = normalizeRootFixedPosition();

      if (!rect) {
        return false;
      }

      const isEdgeHiddenNow = root.classList.contains('cgpt-toolbox-edge-hidden')
        || root.classList.contains('cgpt-edge-hidden');

      let minLeft = VIEWPORT_SAFE_MARGIN;
      let minTop = VIEWPORT_SAFE_MARGIN;
      let maxLeft = rect.viewportWidth - rect.width - VIEWPORT_SAFE_MARGIN;
      let maxTop = rect.viewportHeight - rect.height - VIEWPORT_SAFE_MARGIN;

      if (allowEdgeHidden && isEdgeHiddenNow) {
        minLeft = -(rect.width - TOOLBOX_MIN_VISIBLE_WIDTH);
        minTop = -(rect.height - TOOLBOX_MIN_VISIBLE_HEIGHT);
        maxLeft = rect.viewportWidth - TOOLBOX_MIN_VISIBLE_WIDTH;
        maxTop = rect.viewportHeight - TOOLBOX_MIN_VISIBLE_HEIGHT;
      }

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
        `[TOOLBOX_POSITION][CLAMP] reason=${reason || '-'} left=${Math.round(rect.left)} top=${Math.round(rect.top)} -> left=${Math.round(nextLeft)} top=${Math.round(nextTop)} edgeHidden=${isEdgeHiddenNow ? '1' : '0'}`
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
        scheduleClampRootToViewport('window-resize', {
          save: !isPanelHiddenNow(),
          allowEdgeHidden: true,
        });
        window.setTimeout(() => {
          syncToolboxFloatingLayout('window-resize');
          repairInvisibleToolboxState('window-resize');
          updateFloatingTitlePosition('window-resize');
        }, 80);
      });

      window.addEventListener('orientationchange', () => {
        scheduleClampRootToViewport('orientation-change', {
          save: !isPanelHiddenNow(),
          allowEdgeHidden: true,
        });
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          scheduleClampRootToViewport('visibility-visible', {
            save: !isPanelHiddenNow(),
            allowEdgeHidden: true,
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

      clearEdgeHiddenStateClasses();

      panel = panel || qs(`#${APP.panelId}`, root);
      if (panel) {
        panel.classList.remove('cgpt-toolbox-hidden');
        syncPanelHiddenClass('resetToolboxPosition');
      }

      const hotzone = document.getElementById(APP.edgeHotzoneId);
      if (hotzone) {
        hotzone.classList.remove('active');
        hotzone.removeAttribute('style');
      }

      root.style.left = 'auto';
      root.style.top = 'auto';
      root.style.right = '16px';
      root.style.bottom = '16px';
      root.style.transform = '';

      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
      MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);
      MemoryManager.set(MemoryManager.KEYS.edgeSide, 'right');

      hideRestoreHotzone('resetToolboxPosition');
      hideRestoreHandle('resetToolboxPosition');

      MemoryManager.saveToolboxPatch({
        panelPosition: null,
        panelHidden: false,
        edgeHidden: false,
        edgeSide: 'right',
      });

      scheduleClampRootToViewport('reset-position', {
        save: true,
        allowEdgeHidden: false,
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

      appendLog(`[TITLE_FLASH][header-stop] reason=${reason || '-'}`);
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

    function normalizeTab(tab) {
      const text = String(tab || '').trim();
      return VALID_TABS.includes(text) ? text : 'upload';
    }

    function applyToolboxUiState(options = {}) {
      create();

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

      const savedGlobalPos = readSavedPanelPosition();
      const savedSnapEdge = String((savedGlobalPos && savedGlobalPos.edge) || '').trim();
      const edgeDocked = !!mem.edgeHidden && mem.edgeAutoHideEnabled && !hidden;

      if (root) {
        clearFloatEdgeHiddenClasses();

        if (edgeDocked) {
          const side = normalizeEdgeSide(mem.edgeSide);

          root.classList.add('cgpt-toolbox-edge-hidden');
          root.classList.remove('cgpt-toolbox-edge-revealed');
          root.dataset.edgeSide = side;
          root.dataset.snapEdge = '';
        } else {
          root.classList.remove('cgpt-toolbox-edge-hidden', 'cgpt-toolbox-edge-revealed');
          root.removeAttribute('data-edge-side');
          delete root.dataset.edgeSide;

          root.dataset.snapEdge = savedSnapEdge;

          if (!hidden && !isEdgeHidden()) {
            const savedPositionApplied = applySavedPanelPosition('applyToolboxUiState');

            if (!savedPositionApplied) {
              applyPanelPosition(
                Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - PANEL_DEFAULT_SIZE.width - PANEL_VIEWPORT_MARGIN),
                PANEL_VIEWPORT_MARGIN,
              );

              appendLog('[TOOLBOX_POSITION][RESTORE_DEFAULT] reason=applyToolboxUiState');
            }
          } else if (hidden && savedGlobalPos) {
            root.style.left = `${savedGlobalPos.left}px`;
            root.style.top = `${savedGlobalPos.top}px`;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
          } else if (hidden) {
            root.style.left = 'auto';
            root.style.top = 'auto';
            root.style.right = '16px';
            root.style.bottom = '16px';
            scheduleClampRootToViewport('restore-invalid-position', { save: false, allowEdgeHidden: true });
          }
        }
      }

      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (!hidden && !isEdgeHidden()) {
            const restoredAgain = applySavedPanelPosition('applyToolboxUiState-final');

            if (restoredAgain) {
              appendLog('[TOOLBOX_POSITION][RESTORE_GLOBAL_FINAL] reason=applyToolboxUiState-final');
            }
          }
        }, 80);
      });

      window.requestAnimationFrame(() => {
        if (isEdgeHidden()) {
          applyEdgeHiddenPosition();
          updateEdgeHotzone('applyToolboxUiState');
          scheduleClampRootToViewport('restore-position', { save: false, allowEdgeHidden: true });
        } else if (hidden) {
          keepRootInViewport({
            save: false,
          });
          scheduleClampRootToViewport('restore-position', { save: false, allowEdgeHidden: true });

          if (root && root.dataset.snapEdge) {
            snapRootToEdge({
              log: false,
            });
          }
        } else {
          keepPanelInViewport({
            save: false,
          });
          scheduleClampRootToViewport('restore-position', { save: false, allowEdgeHidden: false });
        }

        updateEdgeAutoHide();
        updateRestoreHotzone('applyToolboxUiState');
        repairInvisibleToolboxState('applyToolboxUiState');
        syncToolboxFloatingLayout('apply-ui-state');
      });

      if (options.restoreTab !== false) {
        switchTab('upload', { save: false, reason: 'applyToolboxUiState-default' });
        appendLog('[TOOLBOX_TAB][DEFAULT] active=upload reason=applyToolboxUiState-default');
      }

      normalizeEdgeVisualState('applyToolboxUiState');
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

      const compactBtn = qs('#cgpt-toolbox-compact', root);
      if (compactBtn) {
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

      restorePanelSize();

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

          if (shouldSave) {
            savePanelPositionFromDom(`compact-mode:${reason}`);
          }

          scheduleToolboxHorizontalOverflowLog(reason, 0);
        }, 0);
      });

      if (typeof UploadModule !== 'undefined' && typeof UploadModule.refresh === 'function') {
        UploadModule.refresh();
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

    function ensureToolboxHeaderPageStatusRow() {
      create();
      if (!root) {
        return null;
      }

      const header = qs('.cgpt-toolbox-header', root);
      if (!header) {
        return null;
      }

      let pageStatusRowEl = qs('#cgpt-toolbox-page-status-row', root);

      if (pageStatusRowEl && !header.contains(pageStatusRowEl)) {
        pageStatusRowEl.remove();
        pageStatusRowEl = null;
      }

      if (!pageStatusRowEl) {
        pageStatusRowEl = document.createElement('div');
        pageStatusRowEl.id = 'cgpt-toolbox-page-status-row';
        pageStatusRowEl.className = 'cgpt-toolbox-header-status-row';

        const actions = qs('.cgpt-toolbox-header-actions', header);
        if (actions) {
          header.insertBefore(pageStatusRowEl, actions);
        } else {
          header.appendChild(pageStatusRowEl);
        }
      } else {
        pageStatusRowEl.className = 'cgpt-toolbox-header-status-row';
        const actions = qs('.cgpt-toolbox-header-actions', header);
        if (!header.contains(pageStatusRowEl)) {
          if (actions) {
            header.insertBefore(pageStatusRowEl, actions);
          } else {
            header.appendChild(pageStatusRowEl);
          }
        } else if (actions && pageStatusRowEl.nextElementSibling !== actions) {
          header.insertBefore(pageStatusRowEl, actions);
        }
      }

      return pageStatusRowEl;
    }

    function ensureCompactButton() {
      if (!root) return;

      let compactBtn = qs('#cgpt-toolbox-compact', root);
      if (compactBtn) return;

      const actions = qs('.cgpt-toolbox-header-actions', root);
      if (!actions) return;

      compactBtn = document.createElement('button');
      compactBtn.type = 'button';
      compactBtn.className = 'cgpt-toolbox-small-btn';
      compactBtn.id = 'cgpt-toolbox-compact';
      compactBtn.textContent = '简洁';
      actions.insertBefore(compactBtn, actions.firstChild);
    }

    function isValidShellRoot(node) {
      if (!(node instanceof HTMLElement)) return false;

      const nextPanel = node.querySelector(`#${APP.panelId}`);
      const nextToggle = node.querySelector(`#${APP.toggleId}`);
      const nextHeader = node.querySelector('.cgpt-toolbox-header');
      const nextContent = node.querySelector('.cgpt-toolbox-content');

      return !!(nextPanel && nextToggle && nextHeader && nextContent);
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

        if (root) {
          if (!document.documentElement.contains(root)) {
            try {
              document.documentElement.appendChild(root);
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

          ensureEdgeHotzoneElement();
          ensureRestoreHotzoneElement();
          ensureRestoreHandleElement();
          ensureToolboxHeaderPageStatusRow();
          bindToolboxAudioUnlockEvents(root);
          updateRestoreHotzone('create-existing-root');
          ensureFloatingTitleElement();
          window.setTimeout(() => {
            repairInvisibleToolboxState('create-existing-root-detached');
          }, 300);
          purgeForbiddenStatusBadge('create-existing-root');
          return root;
        }

        const existing = document.getElementById(APP.rootId);

      if (existing) {
        if (!isValidShellRoot(existing)) {
          console.warn('[ChatGPT toolbox] 检测到不完整的旧工具箱 DOM，已删除并重新创建', existing);
          const oldHotzone = document.getElementById(APP.edgeHotzoneId);
          if (oldHotzone) {
            oldHotzone.remove();
          }
          edgeHotzone = null;
          existing.remove();
        } else if (existing.dataset.shellEventsVersion !== SHELL_EVENTS_VERSION) {
          console.warn('[ChatGPT toolbox] 检测到旧版事件绑定，已删除并重新创建', existing);
          const oldHotzone = document.getElementById(APP.edgeHotzoneId);
          if (oldHotzone) {
            oldHotzone.remove();
          }
          edgeHotzone = null;
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

          return root;
        }
      }

      root = document.createElement('div');
      root.id = APP.rootId;
      root.innerHTML = `
        <button id="${APP.toggleId}" type="button" aria-label="打开小张工具箱" title="小张工具箱">
          <span class="cgpt-toolbox-toggle-icon" aria-hidden="true"></span>
        </button>
        <div id="cgpt-toolbox-floating-title" class="cgpt-toolbox-floating-title">
          小张工具箱
        </div>
        <div id="${APP.panelId}">
          <div class="cgpt-toolbox-header" id="cgpt-toolbox-drag-handle">
            <div class="cgpt-toolbox-title">小张工具箱</div>
            <div class="cgpt-toolbox-header-status-row" id="cgpt-toolbox-page-status-row"></div>
            <div class="cgpt-toolbox-header-actions">
              <button type="button" class="cgpt-toolbox-small-btn" id="cgpt-toolbox-compact">简洁</button>
            </div>
          </div>

          <div class="cgpt-toolbox-tabs">
            <button type="button" class="cgpt-toolbox-tab active" data-tab="upload" data-full-label="多文件上传" data-short-label="上传">多文件上传</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="autoq" data-full-label="自动指令" data-short-label="指令">自动指令</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="prompt" data-full-label="Prompt 管理" data-short-label="Prompt">Prompt 管理</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="bridge" data-full-label="浏览器桥接" data-short-label="桥接">浏览器桥接</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="export" data-full-label="导出统计" data-short-label="导出">导出统计</button>
            <button type="button" class="cgpt-toolbox-tab" data-tab="log" data-full-label="日志" data-short-label="日志">日志</button>
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

      document.documentElement.appendChild(root);
      purgeForbiddenStatusBadge('create-new-root');

      panel = qs(`#${APP.panelId}`, root);
      titleEl = qs('.cgpt-toolbox-title', root);
      ensureToolboxHeaderPageStatusRow();

      migrateToolboxToastToPanel('create-new-root');

      bindEvents();
      bindToolboxAudioUnlockEvents(root);
      applyToolboxUiState({
        restoreTab: false,
      });

      ensureRestoreHandleElement();

      window.setTimeout(() => {
        if (panel && isPanelVisibleNow()) {
          keepPanelInViewport({
            save: false,
          });
        } else {
          scheduleClampRootToViewport('create', {
            save: false,
            allowEdgeHidden: true,
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
          allowEdgeHidden: true,
        });
      }, 500);

      scheduleToolboxHorizontalOverflowLog('create', 300);

        bindViewportGuard();

        return root;
      } finally {
        creatingToolbox = false;

        if (root) {
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

      if (!toggle) {
        console.warn('[ChatGPT toolbox] bindEvents: toggle 不存在，取消绑定');
        return;
      }

      ensureEdgeHotzoneElement();
      ensureRestoreHotzoneElement();
      ensureRestoreHandleElement();
      bindToolboxConsoleRescueApi();

      bindToggleDrag();
      bindEdgeHoverReveal();
      bindFloatingTitleToggleEvents();

      ensureToolboxResizeHandle(panel);
      bindToolboxResize(panel);
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
      bindPanelPinOnClick();
      bindToolboxEnterSendHotkey();
      bindDrag();
      bindPanelResizeHandles();
      bindPanelResizePersistence();

      window.addEventListener('resize', () => {
        appendLog('[TOOLBOX_LAYOUT][window-resize-clamp-only]');

        scheduleClampRootToViewport('window-resize(shell)', {
          save: false,
          allowEdgeHidden: true,
        });

        if (isEdgeHidden()) {
          applyEdgeHiddenPosition();
          normalizeEdgeVisualState('resize');
          updateEdgeHotzone('window-resize');
          updateRestoreHotzone('window-resize');
          repairInvisibleToolboxState('window-resize-edge');
          return;
        }

        if (isPanelHiddenNow()) {
          keepRootInViewport({
            save: false,
          });
          updateEdgeAutoHide();
          updateRestoreHotzone('window-resize');
          repairInvisibleToolboxState('window-resize-panel-hidden');
          updateFloatingTitlePosition('window-resize-panel-hidden');
          return;
        }

        window.setTimeout(() => {
          keepPanelInViewport({
            save: false,
          });
          updateEdgeAutoHide();
          scheduleClampRootToViewport('window-resize(panel)', {
            save: false,
            allowEdgeHidden: false,
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

      if (nextTab === 'log' && typeof LogModule.flushDomIfNeeded === 'function') {
        LogModule.flushDomIfNeeded();
      }

      if (
        nextTab === 'autoq'
        && typeof AutoQueueModule !== 'undefined'
        && typeof AutoQueueModule.bindDelegatedActions === 'function'
      ) {
        AutoQueueModule.bindDelegatedActions('switch-tab-autoq');
      }

      scheduleToolboxHorizontalOverflowLog(`switch-tab:${nextTab}`, 0);
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

    function getPanelMaxSize() {
      return {
        width: Math.max(PANEL_DEFAULT_SIZE.minWidth, window.innerWidth - PANEL_VIEWPORT_MARGIN * 2),
        height: Math.max(PANEL_DEFAULT_SIZE.minHeight, window.innerHeight - 82),
      };
    }

    function normalizePanelSize(size) {
      const defaults = getCurrentPanelDefaultSize();
      const maxSize = getPanelMaxSize();

      return {
        width: clampNumber(size && size.width, defaults.minWidth, maxSize.width),
        height: clampNumber(size && size.height, defaults.minHeight, maxSize.height),
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

    function applyPanelSize(size) {
      if (!panel) return;

      const next = normalizePanelSize(size || getCurrentPanelDefaultSize());

      panel.style.width = `${next.width}px`;
      panel.style.height = `${next.height}px`;
      panel.style.setProperty('--cgpt-toolbox-width', `${next.width}px`);
      panel.style.setProperty('--cgpt-toolbox-height', `${next.height}px`);

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

      if (target.closest('.cgpt-toolbox-resize-handle, .cgpt-resize-handle')) {
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
      handle.className = 'cgpt-toolbox-resize-handle';
      handle.title = '拖动调整工具箱大小';
      panelEl.appendChild(handle);
      return handle;
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
        const startWidth = rect.width;
        const startHeight = rect.height;
        const minWidth = 260;
        const minHeight = 220;
        const maxWidth = Math.max(minWidth, window.innerWidth - 24);
        const maxHeight = Math.max(minHeight, window.innerHeight - 24);

        panel.dataset.resizing = '1';
        panel.classList.add('cgpt-resizing');
        clearEdgeRevealTimer();
        isResizingToolbox = true;

        try {
          handle.setPointerCapture(event.pointerId);
        } catch (error) {
          console.warn('[ChatGPT toolbox] setPointerCapture resize failed', error);
        }

        const onPointerMove = (moveEvent) => {
          moveEvent.preventDefault();
          moveEvent.stopPropagation();

          const nextWidth = clampNumber(
            startWidth + moveEvent.clientX - startX,
            minWidth,
            maxWidth,
          );
          const nextHeight = clampNumber(
            startHeight + moveEvent.clientY - startY,
            minHeight,
            maxHeight,
          );

          applyPanelSize({
            width: nextWidth,
            height: nextHeight,
          });
        };

        const onPointerUp = (upEvent) => {
          upEvent.preventDefault();
          upEvent.stopPropagation();

          panel.dataset.resizing = '0';
          panel.classList.remove('cgpt-resizing');
          isResizingToolbox = false;

          window.removeEventListener('pointermove', onPointerMove, true);
          window.removeEventListener('pointerup', onPointerUp, true);
          window.removeEventListener('pointercancel', onPointerUp, true);

          try {
            handle.releasePointerCapture(event.pointerId);
          } catch (error) {
            console.warn('[ChatGPT toolbox] releasePointerCapture resize failed', error);
          }

          schedulePostDragLayout(() => {
            keepPanelInViewport({
              save: false,
            });
            clampRootToViewport('toolbox-resize-end', {
              save: false,
              allowEdgeHidden: false,
            });
            syncToolboxFloatingLayout('toolbox-resize-end');

            if (isPanelVisibleNow()) {
              savePanelPositionFromDom('toolbox-resize-end');
            }
          });

          savePanelSizeFromDom({
            userAction: true,
            reason: 'toolbox-resize-handle-pointerup',
          });

          rememberLastPanelVisibleRect('toolbox-resize-end');
          updateRestoreHotzone('toolbox-resize-end');
        };

        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerUp, true);
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

    function applyPanelPosition(left, top) {
      if (!panel) {
        console.warn('[ChatGPT toolbox] applyPanelPosition: panel 未初始化');
        return;
      }

      const safe = clampPanelPosition({
        left,
        top,
      });

      panel.style.position = 'fixed';
      panel.style.left = `${Math.round(safe.left)}px`;
      panel.style.top = `${Math.round(safe.top)}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';

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
        rememberLastPanelVisibleRect('applyPanelPosition');
      });
    }

    function normalizeEdgeSide(side) {
      const text = String(side || '').trim();
      if (text && text !== EDGE_AUTO_HIDE_SIDE) {
        appendLog(`[TOOLBOX_EDGE][unexpected-side] side=${text}`);
      }
      return VALID_EDGE_SIDES.includes(text) ? text : EDGE_AUTO_HIDE_SIDE;
    }

    function isEdgeAutoHideEnabled() {
      return MemoryManager.get(MemoryManager.KEYS.edgeAutoHideEnabled, false) === true;
    }

    function isEdgeHidden() {
      return !!(root && root.classList.contains('cgpt-toolbox-edge-hidden'));
    }

    function normalizeEdgeVisualState(reason = 'unknown') {
      if (!root || !panel) return;

      const reasonText = String(reason || 'unknown');
      const edgeHidden = root.classList.contains('cgpt-toolbox-edge-hidden');
      const revealed = root.classList.contains('cgpt-toolbox-edge-revealed');

      if (edgeHidden && !revealed) {
        panel.classList.add('cgpt-toolbox-hidden');
        appendLog(`[TOOLBOX_EDGE][normalize] reason=${reasonText} hidden-without-revealed`);
        return;
      }

      if (edgeHidden && revealed) {
        panel.classList.remove('cgpt-toolbox-hidden');
        root.classList.remove(
          'cgpt-edge-hidden',
          'cgpt-edge-right',
        );
        appendLog(`[TOOLBOX_EDGE][normalize] reason=${reasonText} revealed-visible`);
        return;
      }

      if (!edgeHidden) {
        root.classList.remove('cgpt-toolbox-edge-revealed');
      }
    }

    function clearEdgeRevealTimer() {
      if (edgeRevealTimer) {
        window.clearTimeout(edgeRevealTimer);
        edgeRevealTimer = 0;
      }
    }

    function suspendEdgeAutoHide(reason, durationMs) {
      const ms = Number(durationMs || 3000);
      edgeAutoHideSuspendUntil = Date.now() + ms;
      clearEdgeRevealTimer();

      appendLog(
        `[TOOLBOX_EDGE][auto-hide-suspend] reason=${reason || '-'} ms=${ms}`,
      );
    }

    function suspendAutoHideForForceShow(reason = '', durationMs = 3000) {
      forceShowingUntil = Date.now() + Number(durationMs || 3000);
      edgeAutoHideSuspendUntil = Math.max(edgeAutoHideSuspendUntil || 0, forceShowingUntil);
      clearEdgeRevealTimer();

      appendLog(
        `[TOOLBOX_RESTORE][force-show-suspend] reason=${reason || '-'} ms=${durationMs}`,
      );
    }

    function isEdgeAutoHideSuspended() {
      return Date.now() < edgeAutoHideSuspendUntil;
    }

    function isToolboxInteracting() {
      if (isDraggingToolbox || isResizingToolbox) {
        return true;
      }

      if (panel && panel.classList.contains('cgpt-resizing')) {
        return true;
      }

      const active = document.activeElement;

      if (active && root && root.contains(active)) {
        const tag = String(active.tagName || '').toUpperCase();

        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
          return true;
        }

        if (active.isContentEditable) {
          return true;
        }
      }

      return false;
    }

    function revealPanelFromEdgeHover(reason) {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] revealPanelFromEdgeHover: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][reveal-skip] reason=${reasonText} missing-root-or-panel`);
        return;
      }

      if (!isEdgeHidden()) {
        appendLog(`[TOOLBOX_EDGE][reveal-skip] reason=${reasonText} not-edge-hidden`);
        return;
      }

      clearEdgeRevealTimer();

      root.classList.add('cgpt-toolbox-edge-revealed');
      panel.classList.remove('cgpt-toolbox-hidden');
      root.classList.remove('cgpt-toolbox-panel-hidden');
      syncPanelHiddenClass(`reveal:${reasonText}`);

      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

      edgeRehideGuardUntil = Date.now() + 300;

      appendLog(`[TOOLBOX_EDGE][reveal] reason=${reasonText} side=${root.dataset.edgeSide || '-'}`);

      normalizeEdgeVisualState(`reveal:${reasonText}`);
      applyFullRevealPositionFromEdge(reasonText);
      updateRestoreHotzone(`reveal:${reasonText}`);
    }

    function scheduleHidePanelToEdge(reason, delayMs = 450) {
      if (isDraggingToolbox) {
        appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${String(reason || '-')} dragging=1`);
        return;
      }

      const reasonText = String(reason || 'unknown');

      clearEdgeRevealTimer();

      edgeRevealTimer = window.setTimeout(() => {
        edgeRevealTimer = 0;

        if (isEdgeAutoHideSuspended()) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} auto-hide-suspended`);
          return;
        }

        if (!root || !panel) {
          console.warn('[ChatGPT toolbox] scheduleHidePanelToEdge: root 或 panel 不存在');
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} missing-root-or-panel`);
          return;
        }

        if (!isEdgeHidden()) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} not-edge-hidden`);
          return;
        }

        if (Date.now() < edgeRehideGuardUntil) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} guard-active`);
          return;
        }

        if (isDraggingToolbox) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} dragging=1`);
          return;
        }

        if (isToolboxInteracting()) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} dragging-or-resizing-or-input`);
          return;
        }

        if (edgeHotzoneHovering) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reasonText} hotzone-hovering`);
          return;
        }

        const side = getEdgeHiddenSide();

        rememberLastPanelVisibleRect(`rehide:${reasonText}`);

        root.classList.remove('cgpt-toolbox-edge-revealed');
        applyEdgeHiddenPosition();

        normalizeEdgeVisualState(`rehide:${reasonText}`);
        updateEdgeHotzone(`rehide:${reasonText}`);
        updateRestoreHotzone(`rehide:${reasonText}`);
        showRestoreHandle('edge-rehide');

        appendLog(`[TOOLBOX_EDGE][rehide] reason=${reasonText} side=${side}`);
      }, delayMs);
    }

    function getEdgeHiddenSide() {
      return normalizeEdgeSide(
        root?.dataset?.edgeSide || MemoryManager.get(MemoryManager.KEYS.edgeSide, 'right'),
      );
    }

    function clampEdgeNumber(value, min, max) {
      const n = Number(value);
      const safeMax = Math.max(min, max);

      if (!Number.isFinite(n)) {
        return min;
      }

      return Math.max(min, Math.min(safeMax, n));
    }

    function getNearestAutoHideSide(panelRect) {
      if (!panelRect) return '';

      if (isStrictlyTouchingEdge(panelRect, EDGE_AUTO_HIDE_SIDE)) {
        return EDGE_AUTO_HIDE_SIDE;
      }

      return '';
    }

    function getEdgeHiddenRootSize() {
      const toggle = root ? qs(`#${APP.toggleId}`, root) : null;
      const toggleRect = toggle instanceof HTMLElement ? toggle.getBoundingClientRect() : null;
      const rootRect = getRootRect();

      return {
        width: Math.max(EDGE_HANDLE_SIZE.width, toggleRect?.width || rootRect?.width || EDGE_HANDLE_SIZE.width),
        height: Math.max(EDGE_HANDLE_SIZE.height, toggleRect?.height || rootRect?.height || EDGE_HANDLE_SIZE.height),
      };
    }

    function ensureEdgeHotzoneElement() {
      edgeHotzone = document.getElementById(APP.edgeHotzoneId);
      if (!edgeHotzone) {
        if (!document.body) {
          console.warn('[ChatGPT toolbox] ensureEdgeHotzoneElement: document.body 不存在');
          appendLog('[TOOLBOX_EDGE][hotzone:warn](document.body 缺失，无法创建贴边热区)');
          return;
        }

        edgeHotzone = document.createElement('div');
        edgeHotzone.id = APP.edgeHotzoneId;
        edgeHotzone.setAttribute('aria-hidden', 'true');
        document.body.appendChild(edgeHotzone);
      }

      bindEdgeHotzoneEvents();
    }

    function hideEdgeHotzone(reason = 'unknown') {
      if (!edgeHotzone) return;

      edgeHotzone.classList.remove('active');
      edgeHotzoneHovering = false;
      Object.assign(edgeHotzone.style, {
        left: '',
        right: '',
        top: '',
        bottom: '',
        width: '',
        height: '',
      });

      appendLog(`[TOOLBOX_EDGE][hotzone:hide] reason=${String(reason || 'unknown')}`);
    }

    function updateEdgeHotzone(reason = 'unknown') {
      const reasonText = String(reason || 'unknown');

      if (!edgeHotzone) return;

      if (!root || !panel || !isEdgeHidden()) {
        hideEdgeHotzone(`not-hidden:${reasonText}`);
        return;
      }

      const side = getEdgeHiddenSide();
      const rootRect = root.getBoundingClientRect();
      const size = getCurrentPanelVisualSize();

      const extra = EDGE_REVEAL_HOTZONE_EXTRA;
      const thickness = EDGE_REVEAL_HOTZONE_THICKNESS;

      edgeHotzone.classList.add('active');

      const height = Math.min(window.innerHeight, size.height + EDGE_HANDLE_SIZE.height + extra * 2);
      const top = Math.max(
        0,
        Math.min(
          window.innerHeight - height,
          rootRect.top - size.height - extra,
        ),
      );

      Object.assign(edgeHotzone.style, {
        right: '0px',
        left: '',
        top: `${Math.round(top)}px`,
        bottom: '',
        width: `${thickness}px`,
        height: `${Math.round(height)}px`,
      });

      appendLog(`[TOOLBOX_EDGE][hotzone:update] side=right reason=${reasonText}`);
    }

    function bindEdgeHotzoneEvents() {
      if (!edgeHotzone) return;
      if (edgeHotzone.dataset.bound === '1') return;

      edgeHotzone.dataset.bound = '1';

      edgeHotzone.addEventListener('mouseenter', () => {
        edgeHotzoneHovering = true;
        if (isDraggingToolbox || isResizingToolbox) return;

        if (isEdgeHidden()) {
          revealPanelFromEdgeHover('edge-hotzone-hover');
          updateEdgeHotzone('edge-hotzone-hover');
        }
      });

      edgeHotzone.addEventListener('mouseleave', () => {
        edgeHotzoneHovering = false;
        if (isDraggingToolbox || isResizingToolbox) return;

        if (isEdgeHidden() && root && root.classList.contains('cgpt-toolbox-edge-revealed')) {
          scheduleHidePanelToEdge('edge-hotzone-leave', 700);
        }
      });

      edgeHotzone.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (isDraggingToolbox || isResizingToolbox) return;

        if (isEdgeHidden()) {
          restorePanelFromEdgeHidden('edge-hotzone-click');
          hideEdgeHotzone('edge-hotzone-click');
        }
      });
    }

    function rememberLastPanelVisibleRect(reason = '') {
      if (!panel) return;

      const hidden = panel.classList.contains('cgpt-toolbox-hidden');

      if (hidden && !root?.classList.contains('cgpt-toolbox-edge-revealed')) {
        return;
      }

      const rect = panel.getBoundingClientRect();

      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return;
      }

      lastPanelVisibleRect = {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        updatedAt: Date.now(),
      };

      appendLog(
        `[TOOLBOX_RESTORE_HOTZONE][remember] reason=${reason || '-'} left=${lastPanelVisibleRect.left} top=${lastPanelVisibleRect.top} width=${lastPanelVisibleRect.width} height=${lastPanelVisibleRect.height}`,
      );
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

      appendLog(`[TOOLBOX_RESTORE_HOTZONE][hide] reason=${reason || '-'}`);
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

      appendLog(`[TOOLBOX_RESTORE_HANDLE][hide] reason=${reason || '-'}`);
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

      suspendAutoHideForForceShow(reason || 'restore', 3000);
      clearHiddenTitlePosition(`restore:${reason || '-'}`);

      clearEdgeRevealTimer();

      clearRootEdgeState(`restore:${reason || '-'}`);
      forcePanelVisible(`restore:${reason || '-'}`);

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

      applyPanelSize(size);
      applyPanelPosition(left, top);

      hideRestoreHotzone(`restore:${reason || '-'}`);
      hideRestoreHandle(`restore:${reason || '-'}`);
      hideEdgeHotzone(`restore:${reason || '-'}`);

      syncPanelHiddenClass(`restore:${reason || '-'}`);

      appendLog(
        `[TOOLBOX_RESTORE][show] reason=${reason || '-'} left=${Math.round(left)} top=${Math.round(top)} width=${size.width} height=${size.height}`,
      );

      window.requestAnimationFrame(() => {
        panel.style.display = 'flex';
        panel.style.pointerEvents = 'auto';
        panel.style.visibility = 'visible';
        panel.style.opacity = '1';

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
          `[TOOLBOX_RESTORE][after-frame] panelHidden=${panel.classList.contains('cgpt-toolbox-hidden') ? 1 : 0} edgeHidden=${root.classList.contains('cgpt-toolbox-edge-hidden') ? 1 : 0} floatHidden=${root.classList.contains('cgpt-edge-hidden') ? 1 : 0}`,
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

      if (isPanelHiddenNow() && hiddenTitlePositionLocked) {
        updateFloatingTitlePosition(`repair-hidden-title:${reason || '-'}`);
        appendLog(`[TOOLBOX_HIDE_TITLE][repair-skip-root] reason=${reason || '-'}`);
        return;
      }

      const panelHidden = isPanelHiddenNow();
      const edgeHidden = root.classList.contains('cgpt-toolbox-edge-hidden');
      const floatHidden = root.classList.contains('cgpt-edge-hidden');
      const restoreVisible = isRestoreHandleActuallyVisible();
      const floatingTitleVisible = isFloatingTitleActuallyVisible();

      if ((panelHidden || edgeHidden || floatHidden) && !restoreVisible && !floatingTitleVisible) {
        appendLog(
          `[TOOLBOX_REPAIR][restore-entry-missing] reason=${reason || '-'} panelHidden=${panelHidden ? 1 : 0} edgeHidden=${edgeHidden ? 1 : 0} floatHidden=${floatHidden ? 1 : 0}`,
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
      const edgeHiddenDocked =
        root.classList.contains('cgpt-toolbox-edge-hidden') &&
        !root.classList.contains('cgpt-toolbox-edge-revealed');
      const floatHidden = isFloatingEdgeHidden();
      const visuallyHidden =
        !panelHidden &&
        !edgeHiddenDocked &&
        !floatHidden &&
        !isPanelVisibleNow();

      return panelHidden || edgeHiddenDocked || floatHidden || visuallyHidden;
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
          edgeAutoHideSuspendUntil = Math.max(edgeAutoHideSuspendUntil || 0, forceShowingUntil);

          clearEdgeHiddenStateClasses();

          if (panel) {
            panel.classList.remove('cgpt-toolbox-hidden');
            panel.style.display = 'flex';
            panel.style.pointerEvents = 'auto';
            panel.style.visibility = 'visible';
            panel.style.opacity = '1';
          }

          MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
          MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);

          applyPanelSize(normalizePanelSize(
            MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback()
          ));
          applyPanelPosition(80, 80);
          hideRestoreHotzone('console-force-show');
          hideRestoreHandle('console-force-show');
          hideEdgeHotzone('console-force-show');

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
          MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);

          clearRootEdgeState('console-clear-position');
          forcePanelVisible('console-clear-position');

          if (panel) {
            applyPanelSize(getPanelSizeFallback());
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
      const edgeHidden = isEdgeHidden();
      const edgeRevealed = root.classList.contains('cgpt-toolbox-edge-revealed');
      const edgeHiddenDocked = edgeHidden && !edgeRevealed;
      const floatEdgeHidden = root.classList.contains('cgpt-edge-hidden');
      const shouldShow = panelHidden || edgeHiddenDocked || floatEdgeHidden;

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
        `[TOOLBOX_RESTORE_HOTZONE][update] reason=${reason || '-'} panelHidden=${panelHidden ? 1 : 0} edgeHiddenDocked=${edgeHiddenDocked ? 1 : 0} floatEdgeHidden=${floatEdgeHidden ? 1 : 0} top=${top} width=${hotzoneWidth} height=${Math.round(hotzoneHeight)}`,
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

    function applyEdgeHiddenPosition() {
      if (!root) return;

      const current = getRootCurrentPosition();
      const size = getEdgeHiddenRootSize();

      const left = window.innerWidth - size.width - PANEL_VIEWPORT_MARGIN;
      const top = clampEdgeNumber(
        current.top,
        PANEL_VIEWPORT_MARGIN,
        window.innerHeight - size.height - PANEL_VIEWPORT_MARGIN,
      );

      applyRootPosition(left, top);
      scheduleClampRootToViewport('after-edge-hide', {
        save: true,
        allowEdgeHidden: true,
      });
    }

    function buildRestorePositionFromEdge(size) {
      const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
      const width = Number(size && size.width) || PANEL_DEFAULT_SIZE.width;
      const height = Number(size && size.height) || PANEL_DEFAULT_SIZE.height;

      const maxLeft = Math.max(PANEL_VIEWPORT_MARGIN, window.innerWidth - width - PANEL_VIEWPORT_MARGIN);
      const maxTop = Math.max(PANEL_VIEWPORT_MARGIN, window.innerHeight - height - PANEL_VIEWPORT_MARGIN);

      let top = Number.isFinite(Number(saved.top)) ? Number(saved.top) : PANEL_VIEWPORT_MARGIN;
      const left = maxLeft - EDGE_RESTORE_OFFSET;

      return {
        left: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(left, maxLeft)),
        top: Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop)),
      };
    }

    function buildRevealPositionFromEdge(size) {
      const width = Number(size && size.width) || PANEL_DEFAULT_SIZE.width;
      const height = Number(size && size.height) || PANEL_DEFAULT_SIZE.height;

      const maxLeft = Math.max(
        PANEL_VIEWPORT_MARGIN,
        window.innerWidth - width - PANEL_VIEWPORT_MARGIN,
      );

      const maxTop = Math.max(
        PANEL_VIEWPORT_MARGIN,
        window.innerHeight - height - PANEL_VIEWPORT_MARGIN,
      );

      const currentPanelRect = panel ? panel.getBoundingClientRect() : null;

      const left = maxLeft;

      let top = currentPanelRect && currentPanelRect.top > 0
        ? currentPanelRect.top
        : PANEL_VIEWPORT_MARGIN;

      top = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop));

      return {
        left,
        top,
      };
    }

    function applyFullRevealPositionFromEdge(reason = 'unknown') {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] applyFullRevealPositionFromEdge: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][reveal-position-skip] reason=${reasonText} missing-root-or-panel`);
        return;
      }

      if (!isEdgeHidden()) {
        appendLog(`[TOOLBOX_EDGE][reveal-position-skip] reason=${reasonText} not-edge-hidden`);
        return;
      }

      const side = getEdgeHiddenSide();
      const size = normalizePanelSize(
        MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
      );

      applyPanelSize(size);

      panel.classList.remove('cgpt-toolbox-hidden');
      root.classList.add('cgpt-toolbox-edge-revealed');

      window.requestAnimationFrame(() => {
        if (!root || !panel) return;
        if (!isEdgeHidden()) return;
        if (!root.classList.contains('cgpt-toolbox-edge-revealed')) return;

        const pos = buildRevealPositionFromEdge(size);
        applyPanelPosition(pos.left, pos.top);

        keepPanelInViewport({
          save: false,
        });

        updateEdgeHotzone(`reveal-position:${reasonText}`);

        appendLog(
          `[TOOLBOX_EDGE][reveal-position] reason=${reasonText} side=${side} left=${Math.round(pos.left)} top=${Math.round(pos.top)}`,
        );
      });
    }

    function dockPanelToEdge(side, reason = 'unknown') {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] dockPanelToEdge: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][panel-dock-skip] reason=${reasonText} missing-root-or-panel`);
        return;
      }

      if (!isEdgeAutoHideEnabled()) {
        appendLog(`[TOOLBOX_EDGE][panel-dock-skip] reason=${reasonText} disabled`);
        return;
      }

      const rawSide = String(side || '').trim();

      if (!isAutoHideTriggerSide(rawSide)) {
        appendLog(`[TOOLBOX_EDGE][panel-dock-skip] reason=${reasonText} side=${rawSide || '-'} only-right-enabled`);
        return;
      }

      const nextSide = EDGE_AUTO_HIDE_SIDE;

      clearEdgeRevealTimer();

      rememberLastPanelVisibleRect(`dock:${reasonText}`);

      savePanelPositionFromDom(`dock-panel-to-edge:${reasonText}`);

      root.classList.remove(
        'cgpt-edge-hidden',
        'cgpt-edge-right',
      );
      root.dataset.snapEdge = '';

      applyEdgeHiddenPosition();

      root.dataset.edgeSide = nextSide;
      root.classList.add('cgpt-toolbox-edge-hidden');
      root.classList.remove('cgpt-toolbox-edge-revealed');

      panel.classList.remove('cgpt-toolbox-hidden');

      MemoryManager.set(MemoryManager.KEYS.edgeHidden, true);
      MemoryManager.set(MemoryManager.KEYS.edgeSide, nextSide);
      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

      appendLog(`[TOOLBOX_EDGE][panel-dock] side=${nextSide} reason=${reasonText} horizontal=true`);

      normalizeEdgeVisualState(`dock:${reasonText}`);

      updateEdgeHotzone(`dock:${reasonText}`);
      updateRestoreHotzone(`dock:${reasonText}`);
      showRestoreHandle('edge-hidden');
    }

    function restorePanelFromEdgeHidden(reason = 'unknown') {
      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] restorePanelFromEdgeHidden: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][panel-restore-skip] reason=${String(reason || 'unknown')} missing-root-or-panel`);
        return;
      }

      const reasonText = String(reason || 'unknown');
      const wasEdgeDocked =
        isEdgeHidden() || root.classList.contains('cgpt-toolbox-edge-revealed');

      if (!wasEdgeDocked) {
        appendLog(`[TOOLBOX_EDGE][panel-restore-skip] reason=${reasonText} not-edge-docked`);
        return;
      }

      clearEdgeRevealTimer();

      hideEdgeHotzone(`restore:${reasonText}`);
      hideRestoreHotzone(`restorePanelFromEdgeHidden:${reasonText}`);
      hideRestoreHandle(`restorePanelFromEdgeHidden:${reasonText}`);

      const size = normalizePanelSize(
        MemoryManager.get(getPanelSizeMemoryKey(), null) || getPanelSizeFallback(),
      );

      edgeRestoreClickGuardUntil = Date.now() + 300;

      if (
        reasonText.includes('toggle-click')
        || reasonText.includes('edge-hotzone-click')
        || reasonText.includes('pin:')
      ) {
        edgeRehideGuardUntil = Date.now() + 1200;
      }

      clearEdgeHiddenStateClasses();

      panel.classList.remove('cgpt-toolbox-hidden');

      MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);
      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

      normalizeEdgeVisualState(`restore:${reasonText}`);

      applyPanelSize(size);

      const skipReposition = reasonText.includes('toggle-drag-out') || reasonText.includes('drag-out');

      if (skipReposition) {
        keepPanelInViewport({
          save: false,
        });

        scheduleClampRootToViewport('edge-reveal(skip-reposition)', {
          save: true,
          allowEdgeHidden: false,
        });

        updateEdgeAutoHide();
        hideRestoreHotzone(`restorePanelFromEdgeHidden:${reasonText}`);

        appendLog(`[TOOLBOX_EDGE][panel-restore] reason=${reasonText} horizontal=true reposition=skip-drag-out`);
        return;
      }

      window.requestAnimationFrame(() => {
        const pos = buildRestorePositionFromEdge(size);
        applyPanelPosition(pos.left, pos.top);

        scheduleClampRootToViewport('edge-reveal', {
          save: true,
          allowEdgeHidden: false,
        });

        updateEdgeAutoHide();
        rememberLastPanelVisibleRect(`restorePanelFromEdgeHidden:${reasonText}`);

        appendLog(`[TOOLBOX_EDGE][panel-restore] reason=${reasonText} horizontal=true`);
      });
    }

    function pinRevealedEdgePanel(reason = 'unknown') {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] pinRevealedEdgePanel: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][pin-skip] reason=${reasonText} missing-root-or-panel`);
        return false;
      }

      if (!isEdgeHidden()) {
        appendLog(`[TOOLBOX_EDGE][pin-skip] reason=${reasonText} not-edge-hidden`);
        return false;
      }

      if (!root.classList.contains('cgpt-toolbox-edge-revealed')) {
        appendLog(`[TOOLBOX_EDGE][pin-skip] reason=${reasonText} not-revealed`);
        return false;
      }

      clearEdgeRevealTimer();
      edgeRehideGuardUntil = Date.now() + 1200;
      restorePanelFromEdgeHidden(`pin:${reasonText}`);
      appendLog(`[TOOLBOX_EDGE][pin] reason=${reasonText}`);
      return true;
    }

    function maybeAutoHideAtEdge(reason = 'unknown') {
      if (isDraggingToolbox || Date.now() < edgeAutoHideSuspendUntil) {
        appendLog(
          `[TOOLBOX_EDGE][auto-hide-skip] reason=${reason || '-'} dragging=${isDraggingToolbox ? 1 : 0} suspend=${Date.now() < edgeAutoHideSuspendUntil ? 1 : 0}`,
        );
        return;
      }

      if (!root || !panel) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=no-root-or-panel');
        return;
      }

      if (!isEdgeAutoHideEnabled()) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=disabled');
        return;
      }

      if (isEdgeHidden()) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=already-edge-hidden');
        return;
      }

      if (panel.classList.contains('cgpt-toolbox-hidden')) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=panel-hidden');
        return;
      }

      const rect = panel.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        console.warn('[ChatGPT toolbox] maybeAutoHideAtEdge: invalid panel rect', rect);
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=invalid-panel-rect');
        return;
      }

      const side = getNearestAutoHideSide(rect);
      const touching = side ? isStrictlyTouchingEdge(rect, side) : false;

      appendLog(
        `[TOOLBOX_EDGE][auto-hide-check] reason=${reason} left=${Math.round(rect.left)} right=${Math.round(window.innerWidth - rect.right)} top=${Math.round(rect.top)} bottom=${Math.round(window.innerHeight - rect.bottom)} side=${side || '-'} touching=${touching}`,
      );

      if (!side) {
        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=not-near-edge');
        return;
      }

      if (!touching) {
        appendLog(`[TOOLBOX_EDGE][auto-hide-skip] reason=near-but-not-touching side=${side}`);
        return;
      }

      dockPanelToEdge(side, reason);
    }

    function setEdgeAutoHideEnabled(enabled) {
      const next = !!enabled;

      MemoryManager.set(MemoryManager.KEYS.edgeAutoHideEnabled, next);

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] setEdgeAutoHideEnabled: root/panel 未初始化');
        appendLog(
          `[SETTINGS][edgeAutoHide] ${next ? '已开启' : '已关闭'}，但 root/panel 未初始化，无法同步 UI`,
        );
        return;
      }

      if (!next) {
        clearEdgeRevealTimer();
        hideEdgeHotzone('settings-disabled');

        if (isEdgeHidden() || root.classList.contains('cgpt-toolbox-edge-revealed')) {
          restorePanelFromEdgeHidden('settings-disabled');
        }

        clearFloatEdgeHiddenClasses();
        clearEdgeHiddenStateClasses();

        panel.classList.remove('cgpt-toolbox-hidden');

        MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);
        MemoryManager.set(MemoryManager.KEYS.panelHidden, false);

        appendLog('[SETTINGS][edgeAutoHide] 已关闭，并清理当前贴边隐藏状态');
        return;
      }

      updateEdgeAutoHide();

      appendLog('[SETTINGS][edgeAutoHide] 已开启');
    }

    function clampPanelRect(rect) {
      const mins = getPanelMinSize();

      const width = Math.max(mins.minWidth, Math.min(rect.width, window.innerWidth - PANEL_VIEWPORT_MARGIN * 2));
      const height = Math.max(mins.minHeight, Math.min(rect.height, window.innerHeight - PANEL_VIEWPORT_MARGIN * 2));

      let left = rect.left;
      let top = rect.top;

      const maxLeft = window.innerWidth - width - PANEL_VIEWPORT_MARGIN;
      const maxTop = window.innerHeight - height - PANEL_VIEWPORT_MARGIN;

      left = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(left, maxLeft));
      top = Math.max(PANEL_VIEWPORT_MARGIN, Math.min(top, maxTop));

      return {
        left,
        top,
        width,
        height,
      };
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

      applyPanelRect(clamped);
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
      clearEdgeRevealTimer();
      isResizingToolbox = true;

      const activePointerId = e.pointerId;

      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== activePointerId) return;

        moveEvent.preventDefault();

        resizePanelByPointer(dir, start, moveEvent.clientX, moveEvent.clientY);
      };

      const onUp = (upEvent) => {
        if (upEvent.pointerId !== activePointerId) return;

        panel.classList.remove('cgpt-resizing');
        panel.dataset.resizing = '0';
        isResizingToolbox = false;

        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);

        schedulePostDragLayout(() => {
          keepPanelInViewport({
            save: false,
          });
          clampRootToViewport('resize-end', {
            save: false,
            allowEdgeHidden: false,
          });
          syncToolboxFloatingLayout('panel-resize-end');

          if (isPanelVisibleNow()) {
            savePanelPositionFromDom('resize-end');
          }
        });

        savePanelSizeFromDom({
          userAction: true,
          reason: 'resize-handle-pointerup',
        });

        if (isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed')) {
          scheduleHidePanelToEdge('resize-end', 500);
        }

        if (isEdgeHidden()) {
          updateEdgeHotzone('resize-end');
        }

        rememberLastPanelVisibleRect('resize-end');
        updateRestoreHotzone('resize-end');

        if (e.currentTarget.hasPointerCapture && e.currentTarget.hasPointerCapture(activePointerId)) {
          try {
            e.currentTarget.releasePointerCapture(activePointerId);
          } catch (err) {
            console.debug('[ChatGPT toolbox] resize releasePointerCapture failed', err);
          }
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);

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
      bindToolboxResize(panel);
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
      const edge_docked = isEdgeHidden() && !root.classList.contains('cgpt-toolbox-edge-revealed');
      const edge_revealed = isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed');
      const floating_hidden = isFloatingEdgeHidden();

      return {
        panel_hidden,
        edge_docked,
        edge_revealed,
        floating_hidden,
        hidden: panel_hidden || edge_docked || floating_hidden,
      };
    }

    function collectToolboxLayoutState() {
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
        layout.width = Math.round(rect.width);
        layout.height = Math.round(rect.height);
      }
      return layout;
    }

    function saveToolboxLayoutState(reason = '') {
      const layout = collectToolboxLayoutState();
      saveToolboxPageStatePatch(
        { layout_state: layout },
        reason || 'save-toolbox-layout',
      );
      appendLog(
        `[TOOLBOX][LAYOUT][save] reason=${reason || '-'} `
          + `panel_hidden=${layout.panel_hidden ? 1 : 0} `
          + `edge_docked=${layout.edge_docked ? 1 : 0} `
          + `edge_revealed=${layout.edge_revealed ? 1 : 0} `
          + `floating_hidden=${layout.floating_hidden ? 1 : 0} mode=${layout.mode}`,
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

    function savePanelPositionFromDomNow(reason = '') {
      if (!panel) {
        console.warn('[ChatGPT toolbox] savePanelPositionFromDom: panel 未初始化');
        return;
      }

      const rect = panel.getBoundingClientRect();

      const pos = clampPanelPosition({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
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

      saveToolboxLayoutState(reason || 'panel-drag-end');
      saveCurrentToolboxBaseState(reason || 'panel-drag-end');

      appendLog(
        `[TOOLBOX_POSITION][SAVE_PANEL] reason=${reason || '-'} left=${pos.left} top=${pos.top}`,
      );
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

      if (panel.classList.contains('cgpt-toolbox-hidden')) {
        return;
      }

      if (root && isEdgeHidden()) {
        return;
      }

      const shouldSave = options.save === true;
      const rect = panel.getBoundingClientRect();

      let nextLeft = rect.left;
      let nextTop = rect.top;

      if (rect.left < PANEL_VIEWPORT_MARGIN) {
        nextLeft = PANEL_VIEWPORT_MARGIN;
      }

      if (rect.right > window.innerWidth - PANEL_VIEWPORT_MARGIN) {
        nextLeft = window.innerWidth - rect.width - PANEL_VIEWPORT_MARGIN;
      }

      if (rect.top < PANEL_VIEWPORT_MARGIN) {
        nextTop = PANEL_VIEWPORT_MARGIN;
      }

      if (rect.bottom > window.innerHeight - PANEL_VIEWPORT_MARGIN) {
        nextTop = window.innerHeight - rect.height - PANEL_VIEWPORT_MARGIN;
      }

      nextLeft = Math.max(PANEL_VIEWPORT_MARGIN, nextLeft);
      nextTop = Math.max(PANEL_VIEWPORT_MARGIN, nextTop);

      if (
        Math.abs(nextLeft - rect.left) > 0.5 ||
        Math.abs(nextTop - rect.top) > 0.5
      ) {
        applyPanelPosition(nextLeft, nextTop);
      }

      if (shouldSave) {
        savePanelPositionFromDom('keepPanelInViewport');
      }

      updateFloatingTitlePosition(options.reason || 'keep-panel');
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

    function isPanelVisibleNow() {
      if (!root || !panel) return false;
      if (panel.classList.contains('cgpt-toolbox-hidden')) return false;
      if (root.classList.contains('cgpt-toolbox-panel-hidden')) return false;
      if (root.classList.contains('cgpt-edge-hidden')) return false;
      const edgeDocked =
        root.classList.contains('cgpt-toolbox-edge-hidden') &&
        !root.classList.contains('cgpt-toolbox-edge-revealed');
      if (edgeDocked) return false;
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

            edgeAutoHideSuspendUntil = Date.now() + 2000;

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
      if (isEdgeHidden()) {
        if (
          !root.classList.contains('cgpt-toolbox-edge-revealed') ||
          isToolboxInAnyHiddenState()
        ) {
          updateFloatingTitlePosition(reason || 'sync');
        }
        return;
      }

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

    function restorePanelSize() {
      const key = getPanelSizeMemoryKey();
      const saved = MemoryManager.get(key, null);
      const fallback = getPanelSizeFallback();

      if (saved && saved.width && saved.height) {
        applyPanelSize(saved);
        window.setTimeout(() => {
          keepPanelInViewport({
            save: false,
          });
        }, 0);
        return;
      }

      applyPanelSize(fallback);
      window.setTimeout(() => {
        keepPanelInViewport({
          save: false,
        });
      }, 0);
    }

    function savePanelSizeFromDom(options = {}) {
      if (!panel) return;

      if (options.userAction !== true) {
        return;
      }

      if (isEdgeHidden()) return;

      if (panel.classList.contains('cgpt-toolbox-hidden')) return;

      const rect = panel.getBoundingClientRect();

      if (rect.width <= 0 || rect.height <= 0) {
        console.warn('[ChatGPT toolbox] savePanelSizeFromDom: invalid rect', rect);
        appendLog('[TOOLBOX_SIZE][save-skip] reason=invalid-rect');
        return;
      }

      const next = normalizePanelSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });

      const key = options.key || getPanelSizeMemoryKey();

      MemoryManager.set(key, next);

      appendLog(
        `[TOOLBOX_SIZE][save] reason=${options.reason || '-'} key=${key} width=${next.width} height=${next.height} compact=${compactMode ? 1 : 0}`,
      );

      keepPanelInViewport({
        save: false,
      });
    }

    function bindPanelResizePersistence() {
      if (!panel || panelResizeObserver) return;

      if (typeof ResizeObserver !== 'function') {
        console.warn('[ChatGPT toolbox] ResizeObserver 不可用，跳过面板尺寸观察');
        return;
      }

      panelResizeObserver = new ResizeObserver(() => {
        if (isDraggingToolbox || isResizingToolbox) {
          return;
        }

        keepPanelInViewport({
          save: false,
        });

        syncToolboxFloatingLayout('panel-resize-observer');
      });

      panelResizeObserver.observe(panel);
    }

    function clearFloatEdgeHiddenClasses() {
      if (!root) return;

      root.classList.remove(
        'cgpt-edge-hidden',
        TOOLBOX_FLOATING_HIDDEN_CLASS,
        'cgpt-edge-right',
      );
    }

    const EDGE_STATE_CLASSES = Object.freeze([
      'cgpt-toolbox-edge-hidden',
      'cgpt-toolbox-edge-revealed',
      'cgpt-toolbox-panel-hidden',
      'cgpt-edge-hidden',
      TOOLBOX_FLOATING_HIDDEN_CLASS,
      'cgpt-edge-right',
    ]);

    function clearRootEdgeState(reason = '') {
      if (!root) return;

      root.classList.remove(...EDGE_STATE_CLASSES);
      root.removeAttribute('data-edge-side');
      root.removeAttribute('data-snap-edge');
      delete root.dataset.edgeSide;
      delete root.dataset.snapEdge;
      root.style.transform = '';
      root.style.opacity = '';
      root.style.pointerEvents = '';

      appendLog(`[TOOLBOX_EDGE][clear-root-state] reason=${reason || '-'}`);
    }

    function forcePanelVisible(reason = '') {
      if (!panel) return;

      panel.classList.remove('cgpt-toolbox-hidden');
      panel.style.display = 'flex';
      panel.style.pointerEvents = 'auto';
      panel.style.visibility = 'visible';
      panel.style.opacity = '1';

      MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
      MemoryManager.set(MemoryManager.KEYS.edgeHidden, false);

      appendLog(`[TOOLBOX_EDGE][force-panel-visible] reason=${reason || '-'}`);
    }

    function clearEdgeHiddenStateClasses() {
      clearRootEdgeState('clearEdgeHiddenStateClasses');
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

      let left = rect.left;
      const top = rect.top;
      let edge = '';
      let shouldDock = false;

      if (rightDistance <= getEdgeContactLimit()) {
        edge = EDGE_AUTO_HIDE_SIDE;
        left = window.innerWidth - rect.width;
        shouldDock = true;
      }

      if (shouldDock) {
        setRootLeftTop(left, top, {
          save: false,
        });

        const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
        const panelPosition = {
          ...saved,
          left,
          top,
          mode: 'left-top',
          edge,
          updatedAt: Date.now(),
        };
        MemoryManager.set(MemoryManager.KEYS.panelPosition, panelPosition);
        saveCurrentToolboxBaseState('snap-root-to-edge');

        root.dataset.snapEdge = edge;

        if (isEdgeAutoHideEnabled()) {
          dockPanelToEdge(edge, 'toggle-drag-snap');

          if (options.log) {
            appendLog(`[TOOLBOX_DRAG][snap] edge=${edge} left=${Math.round(left)} top=${Math.round(top)} docked=true touching=true`);
          }

          return true;
        }
      }

      root.dataset.snapEdge = '';

      const saved = MemoryManager.get(MemoryManager.KEYS.panelPosition, null) || {};
      const panelPosition = {
        ...saved,
        left: rect.left,
        top: rect.top,
        mode: 'left-top',
        edge: '',
        updatedAt: Date.now(),
      };
      MemoryManager.set(MemoryManager.KEYS.panelPosition, panelPosition);
      saveCurrentToolboxBaseState('snap-root-clear-edge');

      updateEdgeAutoHide();

      if (options.log) {
        appendLog(
          `[TOOLBOX_DRAG][snap] edge=- left=${Math.round(rect.left)} top=${Math.round(rect.top)} docked=false touching=false rightDistance=${Math.round(rightDistance)}`,
        );
      }

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

    function updateEdgeAutoHide() {
      if (!root) return;

      if (Date.now() < forceShowingUntil) {
        root.classList.remove(
          'cgpt-toolbox-edge-hidden',
          'cgpt-toolbox-edge-revealed',
          'cgpt-edge-hidden',
          'cgpt-edge-right',
        );

        if (panel) {
          panel.classList.remove('cgpt-toolbox-hidden');
        }

        hideRestoreHotzone('force-show-updateEdgeAutoHide');
        hideRestoreHandle('force-show-updateEdgeAutoHide');
        hideEdgeHotzone('force-show-updateEdgeAutoHide');

        appendLog('[TOOLBOX_EDGE][auto-hide-skip] reason=force-show-active');
        return;
      }

      if (isEdgeHidden()) {
        clearFloatEdgeHiddenClasses();
        appendLog('[TOOLBOX_EDGE][float-auto-hide-skip] reason=panel-edge-hidden');
        updateRestoreHotzone('updateEdgeAutoHide');
        repairInvisibleToolboxState('updateEdgeAutoHide-edge');
        return;
      }

      const enabled = isEdgeAutoHideEnabled();
      const edge = root.dataset.snapEdge || '';
      const panelHidden = isPanelHiddenNow();
      const shouldHide = enabled && edge === EDGE_AUTO_HIDE_SIDE && panelHidden && !isEdgeHidden();

      setFloatingEdgeHidden(shouldHide, 'updateEdgeAutoHide');

      appendLog(
        `[TOOLBOX_EDGE][float-auto-hide-check] enabled=${enabled} panelHidden=${panelHidden} edge=${edge || '-'} shouldHide=${shouldHide} horizontal=true`,
      );

      if (shouldHide) {
        appendLog(`[TOOLBOX_EDGE][float-auto-hide] edge=${edge} horizontal=true`);
      }

      updateRestoreHotzone('updateEdgeAutoHide');
      repairInvisibleToolboxState('updateEdgeAutoHide');
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
      rememberLastPanelVisibleRect(reason);

      if (options.save !== false) {
        savePanelPositionFromDom(`${reason}:save-visible-panel`);
      }

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

      const edge = root?.dataset?.snapEdge || '';
      appendLog(`[TOOLBOX_EDGE][panel-hide] edge=${edge || '-'}`);

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
        updateEdgeAutoHide();
      }
    }

    function togglePanelHidden() {
      if (!panel) {
        console.warn('[ChatGPT toolbox] togglePanelHidden: panel 不存在');
        appendLog('[TOOLBOX_EDGE][toggle] panel 不存在');
        return;
      }

      if (isToolboxInAnyHiddenState()) {
        restoreToolboxFromHiddenState('toggle-panel-hidden');
      } else {
        hidePanel();
      }
    }

    function restorePanelForToggleDragOut(reason) {
      const reasonText = String(reason || 'unknown');

      if (!root || !panel) {
        console.warn('[ChatGPT toolbox] restorePanelForToggleDragOut: root 或 panel 不存在');
        appendLog(`[TOOLBOX_EDGE][drag-out-restore-skip] reason=${reasonText} missing-root-or-panel`);
        return;
      }

      if (isEdgeHidden()) {
        clearHiddenTitlePosition(`drag-out:${reasonText}`);
        restorePanelFromEdgeHidden(reasonText);
        appendLog(`[TOOLBOX_EDGE][drag-out-restore] type=panel-edge-hidden reason=${reasonText}`);
        return;
      }

      if (root.classList.contains('cgpt-edge-hidden') || panel.classList.contains('cgpt-toolbox-hidden')) {
        clearHiddenTitlePosition(`drag-out:${reasonText}`);
        root.dataset.snapEdge = '';

        root.classList.remove(
          'cgpt-edge-hidden',
          'cgpt-edge-right',
        );

        panel.classList.remove('cgpt-toolbox-hidden');
        if (root) {
          root.classList.remove('cgpt-toolbox-panel-hidden');
        }
        MemoryManager.set(MemoryManager.KEYS.panelHidden, false);
        syncPanelHiddenClass('restorePanelForToggleDragOut');

        updateEdgeAutoHide();

        appendLog(`[TOOLBOX_EDGE][drag-out-restore] type=float-edge-hidden reason=${reasonText}`);
        return;
      }

      appendLog(`[TOOLBOX_EDGE][drag-out-restore-skip] reason=${reasonText} type=normal`);
    }

    function revealFloatBallTemporarily(reason = 'hover') {
      if (!root) return;

      if (!isPanelHiddenNow() || isEdgeHidden()) return;

      const wasFloatHidden = root.classList.contains('cgpt-edge-hidden');

      clearFloatEdgeHiddenClasses();

      if (wasFloatHidden) {
        appendLog(`[TOOLBOX_EDGE][float-restore] reason=${reason}`);
      }
    }

    function bindEdgeHoverReveal() {
      if (!root) return;

      if (root.dataset.edgeHoverBound === '1') {
        return;
      }

      root.dataset.edgeHoverBound = '1';

      const onEdgeHoverEnter = () => {
        if (isDraggingToolbox) {
          return;
        }

        if (isEdgeHidden()) {
          revealPanelFromEdgeHover('root-hover');
          updateEdgeHotzone('root-hover');
        }
      };

      const onEdgeHoverLeave = (reason) => {
        if (isDraggingToolbox) {
          return;
        }

        if (edgeHotzoneHovering) {
          appendLog(`[TOOLBOX_EDGE][rehide-skip] reason=${reason} hotzone-hovering`);
          return;
        }

        if (isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed')) {
          scheduleHidePanelToEdge(reason, 700);
        }
      };

      root.addEventListener('mouseenter', onEdgeHoverEnter);
      root.addEventListener('mouseleave', () => {
        onEdgeHoverLeave('root-or-panel-leave');
      });

      if (panel) {
        panel.addEventListener('mouseenter', onEdgeHoverEnter);
        panel.addEventListener('mouseleave', () => {
          onEdgeHoverLeave('root-or-panel-leave');
        });
      }
    }

    function bindPanelPinOnClick() {
      if (!panel) return;
      if (panel.dataset.edgePinBound === '1') {
        return;
      }

      panel.dataset.edgePinBound = '1';

      const handlePin = (e) => {
        if (isDraggingToolbox || isResizingToolbox) {
          return;
        }

        if (!root || !panel) {
          return;
        }

        if (!isEdgeHidden()) {
          return;
        }

        if (!root.classList.contains('cgpt-toolbox-edge-revealed')) {
          return;
        }

        const target = e && e.target instanceof Element ? e.target : null;
        if (target && target.closest('.cgpt-resize-handle, .cgpt-toolbox-resize-handle')) {
          return;
        }

        if (target && target.closest([
          '#cgpt-copy-last-message-scroll-bottom',
          '#cgpt-upload-continue-once',
          '#cgpt-send-message-once',
          '#cgpt-upload-start',
          '.cgpt-upload-quick-prompt-chip',
          '.cgpt-btn',
          'button',
          'input',
          'textarea',
          'select',
          '[contenteditable="true"]',
          '[role="textbox"]',
        ].join(','))) {
          appendLog('[TOOLBOX_EDGE][pin-skip] reason=action-or-editable-target');
          return;
        }

        pinRevealedEdgePanel('panel-pointerdown');
      };

      panel.addEventListener('pointerdown', handlePin, true);
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
              allowEdgeHidden: true,
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

        clearEdgeRevealTimer();

        const wasPanelEdgeHidden = isEdgeHidden();
        const wasFloatEdgeHidden = root.classList.contains('cgpt-edge-hidden');
        const wasPanelHidden = isPanelHiddenNow();
        const wasHiddenBeforeDrag = wasPanelEdgeHidden || wasFloatEdgeHidden || wasPanelHidden;

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
          wasPanelEdgeHidden,
          wasFloatEdgeHidden,
          wasPanelHidden,
        };

        appendLog(
          `[TOOLBOX_DRAG][toggle-down] left=${Math.round(rect.left)} top=${Math.round(rect.top)} edgeHidden=${wasPanelEdgeHidden ? '1' : '0'} floatHidden=${wasFloatEdgeHidden ? '1' : '0'} panelHidden=${wasPanelHidden ? '1' : '0'}`,
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

              if (
                toggleDragState.wasPanelEdgeHidden ||
                toggleDragState.wasFloatEdgeHidden ||
                toggleDragState.wasPanelHidden
              ) {
                exitEdgeHiddenStateForDragStart();
                restorePanelForToggleDragOut('toggle-drag-start');
              }

              root.style.transform = '';
              root.classList.add('cgpt-toolbox-dragging');
              addGlobalDraggingClass();
              edgeAutoHideSuspendUntil = Date.now() + 2000;

              if (isToolboxInAnyHiddenState()) {
                updateFloatingTitlePosition('toggle-drag-start');
                appendLog('[TOOLBOX_DRAG][drag-start-title] hidden-state=1');
              }

              appendLog('[TOOLBOX_DRAG][restore-before-real-drag]');
            }
          }
        }

        if (!toggleDragState.moved) return;

        edgeAutoHideSuspendUntil = Date.now() + 800;

        e.preventDefault();

        toggleDragState.latestDx = dx;
        toggleDragState.latestDy = dy;

        if (toggleDragState.dragRafId) return;

        toggleDragState.dragRafId = window.requestAnimationFrame(() => {
          toggleDragState.dragRafId = 0;

          if (!toggleDragState || !root) return;

          toggleDragState.committedDx = toggleDragState.latestDx;
          toggleDragState.committedDy = toggleDragState.latestDy;

          edgeAutoHideSuspendUntil = Date.now() + 800;

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

        if (!wasMoved) {
          updateEdgeAutoHide();
        }
      });

      toggle.addEventListener('mouseenter', () => {
        if (isDraggingToolbox) {
          return;
        }

        if (isEdgeHidden()) {
          revealPanelFromEdgeHover('toggle-hover');
          return;
        }

        revealFloatBallTemporarily('hover');

        if (isFloatingEdgeHidden()) {
          setFloatingEdgeHidden(false, 'toggle-hover-reveal');
        }
      });

      toggle.addEventListener('mouseleave', () => {
        if (isDraggingToolbox) {
          return;
        }

        if (isEdgeHidden() && root.classList.contains('cgpt-toolbox-edge-revealed')) {
          scheduleHidePanelToEdge('toggle-leave', 450);
          return;
        }

        updateEdgeAutoHide();
      });

      toggle.addEventListener('click', () => {
        if (suppressToggleClick) {
          suppressToggleClick = false;
          appendLog('[TOOLBOX_EDGE][toggle-click-skip] reason=suppress-after-drag');
          return;
        }

        if (isEdgeHidden()) {
          restorePanelFromEdgeHidden('toggle-click');
          appendLog('[TOOLBOX_EDGE][toggle-click] action=restore-edge-hidden');
          return;
        }

        if (root && root.classList.contains('cgpt-edge-hidden')) {
          clearFloatEdgeHiddenClasses();
          showPanel();
          appendLog('[TOOLBOX_EDGE][toggle-click] action=restore-float-hidden');
          return;
        }

        if (Date.now() < edgeRestoreClickGuardUntil) {
          appendLog('[TOOLBOX_EDGE][toggle-click-skip] reason=restore-guard');
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

          edgeAutoHideSuspendUntil = Date.now() + 800;

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

          savePanelPositionFromDom('panel-drag-end');
          rememberLastPanelVisibleRect('panel-drag-end');
          updateRestoreHotzone('panel-drag-end');
        });

        window.setTimeout(() => {
          if (!isDraggingToolbox) {
            maybeAutoHideAtEdge('drag-end-delayed');
          }
        }, 180);
      };

      handle.addEventListener('pointerdown', (e) => {
        if (shouldIgnoreToolboxDrag(e)) {
          return;
        }

        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('button')) return;

        if (isEdgeHidden()) {
          restorePanelFromEdgeHidden('header-drag-start');
        }

        exitEdgeHiddenStateForDragStart();
        clearEdgeRevealTimer();

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
      const normalizedType = String(type || '').trim().toLowerCase();
      if ([
        'idle',
        'running',
        'success',
        'warn',
        'error',
        'offline',
        'online',
        'danger',
      ].includes(normalizedType)) {
        return normalizedType;
      }
      const value = String(text || '');
      if (/失败|错误|异常|超时|缺少|不可用|无法|未找到/.test(value)) {
        return 'error';
      }
      if (/离线|未绑定|需要重新绑定|需要重新授权|暂无|未知/.test(value)) {
        return 'warn';
      }
      if (/等待回答|正在等待回答|正在等待回复|等待回复|回答中/.test(value)) {
        return 'danger';
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

    function shouldPersistStatus(statusType, text, options) {
      const opts = options || {};

      if (opts.persist === true) {
        return true;
      }

      if (opts.persist === false) {
        return false;
      }

      const value = String(text || '');

      if (
        statusType === 'error'
        || statusType === 'warn'
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
        return '失败';
      }

      if (statusType === 'warn') {
        if (/未绑定/.test(value)) return '未绑定';
        if (/页面异常/.test(value)) return '页面异常';
        return '提醒';
      }

      if (statusType === 'danger') {
        if (/等待回答/.test(value)) return '等回答';
        if (/正在等待回复|等待回复/.test(value)) return '等回复';
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

      badge.classList.add('cgpt-status-hidden');
      badge.textContent = '';
      badge.title = '';
      badge.style.display = 'none';
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

      const opts = options || {};
      latestStatusText = rawStatusText;

      const statusType = inferStatusType(latestStatusText, type);
      const persistent = shouldPersistStatus(statusType, latestStatusText, opts);
      const shortText = buildShortStatusText(latestStatusText, statusType, opts);
      const isTopMainStatus = isTopMainStatusDisplayText(latestStatusText, statusType, {
        ...opts,
        shortText,
      });

      if (persistent && !isTopMainStatus) {
        const badge = ensureStatusBadge();

        if (badge) {
          badge.style.display = '';
          badge.textContent = shortText || '状态';
          badge.title = latestStatusText || shortText || '';
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

      if (latestStatusText) {
        LogModule.add(`[状态][${statusType}] ${latestStatusText}`);
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
          panel.appendChild(box);
        }
      }

      return box;
    }

    function showToast(text, type = 'info', timeoutMs = 1400) {
      create();
      const toastType = inferStatusType(text, type);
      const box = ensureToolboxToast();

      if (!box) {
        return;
      }

      box.textContent = String(text || '');
      box.classList.remove(
        'cgpt-toast-idle',
        'cgpt-toast-running',
        'cgpt-toast-success',
        'cgpt-toast-warn',
        'cgpt-toast-error',
        'cgpt-toast-danger',
        'cgpt-toast-offline',
        'cgpt-toast-online',
        'show',
      );
      box.classList.add(`cgpt-toast-${toastType}`);
      window.clearTimeout(box.__cgptToastTimer || 0);
      requestAnimationFrame(() => {
        box.classList.add('show');
      });
      box.__cgptToastTimer = window.setTimeout(() => {
        box.classList.remove('show');
      }, timeoutMs);

      appendLog(
        `[TOOLBOX_TOAST][show] type=${toastType} text=${String(text || '').slice(0, 40)} host=panel`,
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
            document.documentElement.appendChild(root);
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
        if (typeof LogModule !== 'undefined' && LogModule.add) {
          LogModule.add(message);
        } else {
          console.debug('[ChatGPT toolbox][LOG_BEFORE_READY]', message);
        }
      } catch (err) {
        console.error('[ChatGPT toolbox] appendLog failed', err, message);
      } finally {
        appendingLog = false;
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
      showToast,
      appendLog,
      purgeForbiddenStatusBadge,
      ensureToolboxHeaderPageStatusRow,
      switchTab,
      restoreActiveTab,
      getActiveTab,
      applyToolboxUiState,
      applyToolboxPageState,
      handleRouteChange,
      setEdgeAutoHideEnabled,
      suspendEdgeAutoHide,
      resetToolboxPosition,
      restoreToolboxFromHiddenState,
      clearViewportTimers,
      flashHeaderTitleOnce,
      stopHeaderTitleFlash,
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

  function forceScrollContainerToEnd(el, reason = 'unknown') {
    if (!el) return false;

    const reasonText = String(reason || 'unknown');

    try {
      if (
        el === document.scrollingElement ||
        el === document.documentElement ||
        el === document.body
      ) {
        const maxY = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0,
          el.scrollHeight || 0,
        );

        window.scrollTo({
          top: maxY,
          left: 0,
          behavior: 'auto',
        });

        if (document.documentElement) {
          document.documentElement.scrollTop = maxY;
        }

        if (document.body) {
          document.body.scrollTop = maxY;
        }

        return true;
      }

      el.scrollTop = el.scrollHeight;
      return true;
    } catch (err) {
      const errText = err && err.message ? err.message : String(err);
      console.warn('[ChatGPT toolbox] forceScrollContainerToEnd failed', err);
      ToolboxShell.appendLog(`[CHAT_PAGE][force-end:container-failed] reason=${reasonText} error=${errText}`);
      return false;
    }
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

    if (cleanedAfterThinking && cleanedAfterThinking.length >= 20) {
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

  function chooseAssistantFinalAnswerText(rawText, fallbackText, meta = {}) {
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

    if (cleanedAfterThinking && cleanedAfterThinking.length >= 20) {
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

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        const logTag = streaming
          ? '[CHAT_PAGE][assistant-streaming-answer-picked]'
          : '[CHAT_PAGE][assistant-final-answer-picked]';
        ToolboxShell.appendLog(
          `${logTag} source=after-thinking chars=${cleanedAfterThinking.length} fallbackChars=${String(cleanedFallback || '').length} turn=${meta.turnId || '-'}`,
        );
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

