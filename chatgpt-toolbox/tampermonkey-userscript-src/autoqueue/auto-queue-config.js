  /********************************************************************
   * AutoQueueConfig：配置读取、保存、迁移（委托 auto-queue-core）
   ********************************************************************/

  const AutoQueueConfig = (() => {
    function create(deps) {
      const {
        log,
        legacyLoadConfig,
        legacySaveConfig,
        legacyNormalizeAutoQueueConfig,
        legacyMigrateAutoQueueConfig,
        legacyRepairAutoQueuePromptConfigIfNeeded,
        legacyGetDefaultContinuePromptTextForUi,
      } = deps;

      function appendConfigLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function loadConfig() {
        appendConfigLog('[AUTO_QUEUE_CONFIG][LOAD]');
        if (typeof legacyLoadConfig === 'function') {
          return legacyLoadConfig();
        }
        return {};
      }

      function saveConfig(nextConfig, reason) {
        appendConfigLog(`[AUTO_QUEUE_CONFIG][SAVE] reason=${reason || '-'}`);
        if (typeof legacySaveConfig === 'function') {
          return legacySaveConfig(nextConfig, reason);
        }
        return nextConfig;
      }

      function normalizeAutoQueueConfig(raw) {
        if (typeof legacyNormalizeAutoQueueConfig === 'function') {
          return legacyNormalizeAutoQueueConfig(raw);
        }
        return raw && typeof raw === 'object' ? raw : {};
      }

      function migrateAutoQueueConfig(raw) {
        appendConfigLog('[AUTO_QUEUE_CONFIG][MIGRATE]');
        if (typeof legacyMigrateAutoQueueConfig === 'function') {
          return legacyMigrateAutoQueueConfig(raw);
        }
        return normalizeAutoQueueConfig(raw);
      }

      function repairAutoQueuePromptConfigIfNeeded() {
        appendConfigLog('[AUTO_QUEUE_CONFIG][REPAIR]');
        if (typeof legacyRepairAutoQueuePromptConfigIfNeeded === 'function') {
          return legacyRepairAutoQueuePromptConfigIfNeeded();
        }
        return { ok: true };
      }

      function getDefaultContinuePromptTextForUi() {
        if (typeof legacyGetDefaultContinuePromptTextForUi === 'function') {
          return legacyGetDefaultContinuePromptTextForUi();
        }
        return '';
      }

      return {
        loadConfig,
        saveConfig,
        normalizeAutoQueueConfig,
        migrateAutoQueueConfig,
        repairAutoQueuePromptConfigIfNeeded,
        getDefaultContinuePromptTextForUi,
      };
    }

    return { create };
  })();
