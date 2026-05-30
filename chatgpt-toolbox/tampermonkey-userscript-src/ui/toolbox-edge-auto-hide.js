  /********************************************************************
   * ToolboxEdgeAutoHide：贴边隐藏与恢复（委托 toolbox-shell）
   ********************************************************************/

  const ToolboxEdgeAutoHide = (() => {
    function create(deps) {
      const {
        log,
        legacyDockPanelToEdge,
        legacyRestorePanelFromEdgeHidden,
        legacyMaybeAutoHideAtEdge,
        legacyBindEdgeHoverReveal,
        legacyBindRestoreHandleEvents,
        legacyBindRestoreHotzoneEvents,
      } = deps;

      function appendEdgeLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      return {
        dockPanelToEdge: (...args) => {
          appendEdgeLog('[TOOLBOX_EDGE][dock]');
          return typeof legacyDockPanelToEdge === 'function' ? legacyDockPanelToEdge(...args) : undefined;
        },
        restorePanelFromEdgeHidden: (...args) => {
          appendEdgeLog('[TOOLBOX_EDGE][restore]');
          return typeof legacyRestorePanelFromEdgeHidden === 'function'
            ? legacyRestorePanelFromEdgeHidden(...args)
            : undefined;
        },
        maybeAutoHideAtEdge: (...args) => {
          appendEdgeLog('[TOOLBOX_EDGE][auto-hide-suspend]');
          return typeof legacyMaybeAutoHideAtEdge === 'function' ? legacyMaybeAutoHideAtEdge(...args) : undefined;
        },
        bindEdgeHoverReveal: legacyBindEdgeHoverReveal,
        bindRestoreHandleEvents: (...args) => {
          appendEdgeLog('[TOOLBOX_RESTORE_HANDLE][show]');
          return typeof legacyBindRestoreHandleEvents === 'function'
            ? legacyBindRestoreHandleEvents(...args)
            : undefined;
        },
        bindRestoreHotzoneEvents: legacyBindRestoreHotzoneEvents,
      };
    }

    return { create };
  })();
