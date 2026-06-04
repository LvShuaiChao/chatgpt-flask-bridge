  /**
   * REFACTOR_STATUS:
   * 当前文件是拆分重构候选模块。
   * 当前阶段不要默认加入 .build-order.json。
   * 只有完成 canonical owner 切换后，才能进入 build order。
   * 在进入 build order 前，真实运行逻辑仍以 main.js / upload-module.js 中的 legacy 实现为准。
   */

  /********************************************************************
   * PageLifecycle：页面生命周期（委托 main.js 既有函数，构建后绑定）
   ********************************************************************/

  const PageLifecycle = (() => {
    function create(deps) {
      const {
        log,
        legacyCleanupBeforePageNavigation,
        legacyCleanupRuntimeHandles,
        legacyWaitChatPageReady,
        legacyForegroundCatchUp,
      } = deps;

      function appendLifecycleLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function cleanupBeforePageNavigation(source) {
        appendLifecycleLog(`[PAGE_LIFECYCLE][CLEANUP] source=${source || '-'}`);
        if (typeof legacyCleanupBeforePageNavigation === 'function') {
          return legacyCleanupBeforePageNavigation(source);
        }
        return undefined;
      }

      function cleanupRuntimeHandles(reason) {
        appendLifecycleLog(`[PAGE_LIFECYCLE][CLEANUP] reason=${reason || '-'}`);
        if (typeof legacyCleanupRuntimeHandles === 'function') {
          return legacyCleanupRuntimeHandles(reason);
        }
        return undefined;
      }

      async function waitChatPageReady(options) {
        if (typeof legacyWaitChatPageReady === 'function') {
          const ready = await legacyWaitChatPageReady(options);
          if (ready) {
            appendLifecycleLog('[PAGE_LIFECYCLE][READY]');
          }
          return ready;
        }
        return false;
      }

      function foregroundCatchUp(reason) {
        appendLifecycleLog(`[PAGE_LIFECYCLE][FOREGROUND_CATCH_UP] reason=${reason || '-'}`);
        if (typeof legacyForegroundCatchUp === 'function') {
          return legacyForegroundCatchUp(reason);
        }
        return undefined;
      }

      return {
        cleanupBeforePageNavigation,
        cleanupRuntimeHandles,
        waitChatPageReady,
        foregroundCatchUp,
      };
    }

    return { create };
  })();
