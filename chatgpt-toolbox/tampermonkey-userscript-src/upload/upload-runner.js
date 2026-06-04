  /**
   * REFACTOR_STATUS:
   * 当前文件是拆分重构候选模块。
   * 当前阶段不要默认加入 .build-order.json。
   * 只有完成 canonical owner 切换后，才能进入 build order。
   * 在进入 build order 前，真实运行逻辑仍以 main.js / upload-module.js 中的 legacy 实现为准。
   */

  /********************************************************************
   * UploadRunner：上传执行流程（委托 upload-module 既有实现）
   ********************************************************************/

  const UploadRunner = (() => {
    function create(deps) {
      const {
        getState,
        log,
        setStatus,
        legacyStartUploadFromCurrentQueue,
        legacyUploadSingleQueueItem,
      } = deps;

      function appendRunnerLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      async function candidateStartUploadFromCurrentQueue(options) {
        const opts = options && typeof options === 'object' ? options : { source: options };
        const source = String(opts.source || 'button').trim() || 'button';
        const state = typeof getState === 'function' ? getState() : {};
        appendRunnerLog(
          `[UPLOAD_RUNNER][START] candidate=1 source=${source} phase=${state.uploadPhase || state.uploadTask && state.uploadTask.phase || '-'}`,
        );

        if (typeof legacyStartUploadFromCurrentQueue !== 'function') {
          appendRunnerLog(`[UPLOAD_RUNNER][NO_LEGACY] source=${source}`);
          return { ok: false, reason: 'legacy_start_missing' };
        }

        const result = await legacyStartUploadFromCurrentQueue(opts);

        const ok = !!(result && (result.ok === true || result.blocked !== true));
        const successCount = Number(result && (result.uploadedCount != null ? result.uploadedCount : result.uploaded)) || 0;
        const failCount = Number(result && (result.failedCount != null ? result.failedCount : result.failed)) || 0;

        appendRunnerLog(
          `[UPLOAD_RUNNER][FINISH] source=${source} ok=${ok ? 1 : 0} success=${successCount} fail=${failCount} reason=${result && result.reason ? result.reason : '-'}`,
        );

        return result;
      }

      async function candidateUploadSingleQueueItem(itemOrId, source) {
        const itemId = itemOrId && typeof itemOrId === 'object'
          ? (itemOrId.id || itemOrId.itemId || '')
          : itemOrId;
        appendRunnerLog(
          `[UPLOAD_RUNNER][ITEM_START] candidate=1 source=${source || '-'} id=${itemId || '-'}`,
        );

        if (typeof legacyUploadSingleQueueItem !== 'function') {
          appendRunnerLog(`[UPLOAD_RUNNER][ITEM_SKIP] source=${source || '-'} reason=legacy_missing`);
          return { ok: false, reason: 'legacy_upload_item_missing' };
        }

        const result = await legacyUploadSingleQueueItem(itemOrId, { source: source || '-' });

        if (result && result.ok !== false) {
          appendRunnerLog(
            `[UPLOAD_RUNNER][ITEM_OK] source=${source || '-'} id=${itemId || '-'}`,
          );
        } else {
          appendRunnerLog(
            `[UPLOAD_RUNNER][ITEM_FAIL_UPLOAD] source=${source || '-'} id=${itemId || '-'} reason=${result && result.reason ? result.reason : 'upload_failed'}`,
          );
        }

        return result;
      }

      return {
        candidateStartUploadFromCurrentQueue,
        candidateUploadSingleQueueItem,
      };
    }

    return { create };
  })();
