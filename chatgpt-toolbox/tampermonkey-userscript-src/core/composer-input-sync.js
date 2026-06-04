  /**
   * REFACTOR_STATUS:
   * 当前文件是拆分重构候选模块。
   * 当前阶段不要默认加入 .build-order.json。
   * 只有完成 canonical owner 切换后，才能进入 build order。
   * 在进入 build order 前，真实运行逻辑仍以 main.js / upload-module.js 中的 legacy 实现为准。
   */

  /********************************************************************
   * ComposerInputSync：输入框同步（委托 main / ComposerApi）
   ********************************************************************/

  const ComposerInputSync = (() => {
    function create(deps) {
      const {
        log,
        legacySetNativeTextareaValue,
        legacyDispatchComposerInputEvents,
        legacyWaitForComposerTextSynced,
      } = deps;

      function appendSyncLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      async function candidateWaitForComposerTextSynced(expected, options) {
        if (typeof legacyWaitForComposerTextSynced === 'function') {
          return legacyWaitForComposerTextSynced(expected, options);
        }
        appendSyncLog('[COMPOSER_INPUT_SYNC][MISSING_LEGACY] candidate=1');
        return { ok: false, reason: 'legacy_missing' };
      }

      return {
        setNativeTextareaValue: legacySetNativeTextareaValue,
        dispatchComposerInputEvents: legacyDispatchComposerInputEvents,
        candidateWaitForComposerTextSynced,
      };
    }

    return { create };
  })();
