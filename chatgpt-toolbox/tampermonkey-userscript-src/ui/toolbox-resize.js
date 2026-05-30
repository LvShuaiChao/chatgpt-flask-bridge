  /********************************************************************
   * ToolboxResize：工具箱缩放（委托 toolbox-shell）
   ********************************************************************/

  const ToolboxResize = (() => {
    function create(deps) {
      const {
        log,
        legacyBindPanelResizeHandles,
        legacyResizePanelByPointer,
        legacyStartPanelResize,
        legacyRestorePanelSize,
        legacySavePanelSizeOnly,
      } = deps;

      return {
        bindPanelResizeHandles: legacyBindPanelResizeHandles,
        resizePanelByPointer: legacyResizePanelByPointer,
        startPanelResize: legacyStartPanelResize,
        restorePanelSize: legacyRestorePanelSize,
        savePanelSizeOnly: legacySavePanelSizeOnly,
      };
    }

    return { create };
  })();
