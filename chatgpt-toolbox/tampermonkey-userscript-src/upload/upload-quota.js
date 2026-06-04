  /**
   * REFACTOR_STATUS:
   * 当前文件是拆分重构候选模块。
   * 当前阶段不要默认加入 .build-order.json。
   * 只有完成 canonical owner 切换后，才能进入 build order。
   * 在进入 build order 前，真实运行逻辑仍以 main.js / upload-module.js 中的 legacy 实现为准。
   */

  /********************************************************************
   * UploadQuota：上传额度读取与拦截（委托 upload-module 既有实现）
   ********************************************************************/

  const UploadQuota = (() => {
    function create(deps) {
      const {
        log,
        getUploadQuotaStateCore,
        recordUploadSuccessCore,
        saveUsageState,
        getUsageState,
        getConfig,
      } = deps;

      function appendQuotaLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function getUploadQuotaState(options) {
        if (typeof getUploadQuotaStateCore === 'function') {
          return getUploadQuotaStateCore(options);
        }
        return {
          limit: 0,
          used: 0,
          remaining: Number.POSITIVE_INFINITY,
          canUpload: true,
          enabled: false,
        };
      }

      function assertCanUpload(context) {
        const source = context && context.source ? context.source : '-';
        const quota = getUploadQuotaState();

        if (quota && quota.canUpload === false) {
          appendQuotaLog(
            `[UPLOAD_QUOTA][BLOCK_UPLOAD] source=${source} used=${quota.used || 0} limit=${quota.limit || quota.maxFiles || '-'}`,
          );
          return {
            allowed: false,
            reason: 'upload_quota_exceeded',
            quota,
          };
        }

        appendQuotaLog(
          `[UPLOAD_QUOTA][ALLOW_UPLOAD] source=${source} used=${quota.used || 0} limit=${quota.limit || quota.maxFiles || '-'} remaining=${quota.remaining != null ? quota.remaining : '-'}`,
        );

        return {
          allowed: true,
          quota,
        };
      }

      function recordUploadSuccess(count, source) {
        if (typeof recordUploadSuccessCore === 'function') {
          recordUploadSuccessCore(count, source);
          appendQuotaLog(
            `[UPLOAD_QUOTA][RECORD_UPLOAD] source=${source || '-'} inc=${Number(count) || 1}`,
          );
          return;
        }

        const usage = typeof getUsageState === 'function' ? getUsageState() : {};
        const inc = Number.isFinite(Number(count)) ? Number(count) : 1;
        usage.uploadUsed = Number(usage.uploadUsed || 0) + Math.max(0, inc);

        appendQuotaLog(
          `[UPLOAD_QUOTA][RECORD_UPLOAD] source=${source || '-'} inc=${inc} uploadUsed=${usage.uploadUsed}`,
        );

        if (typeof saveUsageState === 'function') {
          saveUsageState(usage);
        }
      }

      return {
        getUploadQuotaState,
        assertCanUpload,
        recordUploadSuccess,
      };
    }

    return { create };
  })();
