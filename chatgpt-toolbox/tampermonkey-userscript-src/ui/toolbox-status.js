  /********************************************************************
   * ToolboxStatus：状态栏展示（委托 toolbox-shell）
   ********************************************************************/

  const ToolboxStatus = (() => {
    function create(deps) {
      const {
        log,
        legacySetStatus,
        legacyBuildShortStatusText,
        legacyRenderToolboxTopStatus,
        legacyRenderToolboxPageStatusRow,
      } = deps;

      function formatSecondsForDisplay(ms) {
        const value = Number(ms);
        if (!Number.isFinite(value) || value < 0) {
          return '0s';
        }
        return `${Math.ceil(value / 1000)}s`;
      }

      function setStatus(text, type, options) {
        if (typeof legacySetStatus === 'function') {
          return legacySetStatus(text, type, options);
        }
        return undefined;
      }

      return {
        setStatus,
        buildShortStatusText: legacyBuildShortStatusText,
        renderToolboxTopStatus: legacyRenderToolboxTopStatus,
        renderToolboxPageStatusRow: legacyRenderToolboxPageStatusRow,
        formatSecondsForDisplay,
      };
    }

    return { create };
  })();
