  /********************************************************************
   * AutoQueueRenderStatus：自动任务 UI 状态渲染（委托 auto-queue-core）
   ********************************************************************/

  const AutoQueueRenderStatus = (() => {
    function create(deps) {
      const {
        log,
        legacyRenderAutoqLightTopStatusOnly,
        legacyBuildProgressStatusSnapshot,
        legacyRenderBatchControlButtons,
        legacyRenderAutoQueueStatus,
        legacyUpdateStatusBar,
      } = deps;

      function appendRenderLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function renderStatus(reason) {
        appendRenderLog(`[AUTO_QUEUE_RENDER_STATUS] reason=${reason || '-'}`);
        if (typeof legacyRenderAutoqLightTopStatusOnly === 'function') {
          legacyRenderAutoqLightTopStatusOnly(reason);
        }
        if (typeof legacyRenderAutoQueueStatus === 'function') {
          legacyRenderAutoQueueStatus(reason);
        }
        if (typeof legacyUpdateStatusBar === 'function') {
          legacyUpdateStatusBar(reason);
        }
        if (typeof legacyRenderBatchControlButtons === 'function') {
          legacyRenderBatchControlButtons(reason);
        }
      }

      return {
        renderStatus,
        renderAutoqLightTopStatusOnly: legacyRenderAutoqLightTopStatusOnly,
        buildProgressStatusSnapshot: legacyBuildProgressStatusSnapshot,
        renderBatchControlButtons: legacyRenderBatchControlButtons,
        renderAutoQueueStatus: legacyRenderAutoQueueStatus,
        updateStatusBar: legacyUpdateStatusBar,
      };
    }

    return { create };
  })();
