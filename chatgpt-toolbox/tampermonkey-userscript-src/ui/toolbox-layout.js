  /********************************************************************
   * ToolboxLayout：工具箱位置与尺寸（委托 toolbox-shell）
   ********************************************************************/

  const ToolboxLayout = (() => {
    function create(deps) {
      const {
        log,
        legacyKeepRootInViewport,
        legacyKeepPanelInViewport,
        legacyApplySavedPanelPosition,
        legacySavePanelPositionOnly,
        legacySavePanelSizeOnly,
        legacyClampRoot,
        legacyClampPanel,
      } = deps;

      function appendLayoutLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function wrap(name, fn, args) {
        if (typeof fn !== 'function') {
          return null;
        }
        if (name === 'clamp' || name === 'save-position' || name === 'save-size') {
          appendLayoutLog(`[TOOLBOX_LAYOUT][${String(name).toUpperCase()}]`);
        }
        return fn.apply(null, args);
      }

      return {
        keepRootInViewport: (...args) => wrap('clamp', legacyKeepRootInViewport, args),
        keepPanelInViewport: (...args) => wrap('clamp', legacyKeepPanelInViewport, args),
        applySavedPanelPosition: (...args) => wrap('save-position', legacyApplySavedPanelPosition, args),
        savePanelPositionOnly: (...args) => {
          appendLayoutLog(`[TOOLBOX_LAYOUT][SAVE_POSITION]`);
          return wrap('save-position', legacySavePanelPositionOnly, args);
        },
        savePanelSizeOnly: (...args) => {
          appendLayoutLog(`[TOOLBOX_LAYOUT][SAVE_SIZE]`);
          return wrap('save-size', legacySavePanelSizeOnly, args);
        },
        clampRoot: (...args) => wrap('clamp', legacyClampRoot, args),
        clampPanel: (...args) => wrap('clamp', legacyClampPanel, args),
      };
    }

    return { create };
  })();
