  /********************************************************************
   * ToolboxDrag：工具箱拖动（委托 toolbox-shell）
   ********************************************************************/

  const ToolboxDrag = (() => {
    function create(deps) {
      const {
        log,
        legacyBindDrag,
        legacyBindToggleDrag,
        legacyFinishFloatingTitleDrag,
        legacyStartFloatingTitleDrag,
        legacyUpdateFloatingTitleDrag,
      } = deps;

      function appendDragLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      return {
        bindDrag: (...args) => {
          appendDragLog('[TOOLBOX_DRAG][bind]');
          return typeof legacyBindDrag === 'function' ? legacyBindDrag(...args) : undefined;
        },
        bindToggleDrag: legacyBindToggleDrag,
        finishFloatingTitleDrag: legacyFinishFloatingTitleDrag,
        startFloatingTitleDrag: legacyStartFloatingTitleDrag,
        updateFloatingTitleDrag: legacyUpdateFloatingTitleDrag,
      };
    }

    return { create };
  })();
