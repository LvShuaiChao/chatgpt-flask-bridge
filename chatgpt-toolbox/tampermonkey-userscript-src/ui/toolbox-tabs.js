  /********************************************************************
   * ToolboxTabs：选项卡切换（委托 toolbox-shell）
   ********************************************************************/

  const ToolboxTabs = (() => {
    function create(deps) {
      const {
        log,
        legacyRestoreActiveTab,
        legacySaveActiveTab,
        legacySwitchTab,
        legacyBindTabEvents,
      } = deps;

      return {
        restoreActiveTab: legacyRestoreActiveTab,
        saveActiveTab: legacySaveActiveTab,
        switchTab: (...args) => {
          if (typeof log === 'function') {
            log(`[TOOLBOX_TABS][switch] tab=${args[0] != null ? args[0] : '-'}`);
          }
          return typeof legacySwitchTab === 'function' ? legacySwitchTab(...args) : undefined;
        },
        bindTabEvents: legacyBindTabEvents,
      };
    }

    return { create };
  })();
