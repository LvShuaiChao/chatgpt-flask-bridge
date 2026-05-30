  /********************************************************************
   * ToolboxLogPanel：日志面板（委托 toolbox-shell）
   ********************************************************************/

  const ToolboxLogPanel = (() => {
    function create(deps) {
      const {
        legacyAppendLog,
        legacyCopyLog,
        legacyClearLog,
        legacyRenderLogPanel,
        legacyLimitLogLines,
        legacyAppendLogThrottled,
        legacyAppendLogIfChanged,
      } = deps;

      function appendLog(text) {
        if (typeof legacyAppendLog === 'function') {
          legacyAppendLog(text);
        }
      }

      return {
        appendLog,
        copyLog: legacyCopyLog,
        clearLog: legacyClearLog,
        renderLogPanel: legacyRenderLogPanel,
        limitLogLines: legacyLimitLogLines,
        appendLogThrottled: legacyAppendLogThrottled,
        appendLogIfChanged: legacyAppendLogIfChanged,
      };
    }

    return { create };
  })();
