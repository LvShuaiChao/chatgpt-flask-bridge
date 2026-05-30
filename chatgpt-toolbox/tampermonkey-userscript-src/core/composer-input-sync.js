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

      async function waitForComposerTextSynced(expected, options) {
        if (typeof legacyWaitForComposerTextSynced === 'function') {
          return legacyWaitForComposerTextSynced(expected, options);
        }
        appendSyncLog('[COMPOSER_INPUT_SYNC][MISSING_LEGACY]');
        return { ok: false, reason: 'legacy_missing' };
      }

      return {
        setNativeTextareaValue: legacySetNativeTextareaValue,
        dispatchComposerInputEvents: legacyDispatchComposerInputEvents,
        waitForComposerTextSynced,
      };
    }

    return { create };
  })();
