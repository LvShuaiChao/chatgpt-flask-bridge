  /********************************************************************
   * AutoQueueModeSettings：自动队列模式设置归一化
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 promptMode / modeSettings 的配置归一化和 patch。
   * 3. 不负责 UI 读取，不负责发送，不负责等待回复，不负责闭环，不负责上传。
   ********************************************************************/
  const AutoQueueModeSettings = (() => {
    function create(deps = {}) {
      const config = deps.config;
      const cloneDefaultModeSettings = deps.cloneDefaultModeSettings;
      const cloneModeSettingItem = deps.cloneModeSettingItem;

      if (!config || typeof config !== 'object') {
        console.error('[AUTOQ_MODE_SETTINGS][CREATE_FAILED] missing config');
      }

      function cloneDefaultModeSettingsSafe() {
        if (typeof cloneDefaultModeSettings === 'function') {
          return cloneDefaultModeSettings();
        }
        console.error('[AUTOQ_MODE_SETTINGS][DEFAULTS_FALLBACK] cloneDefaultModeSettings missing');
        return {
          continue: {
            loopMode: false,
            randomMinSec: 3,
            randomMaxSec: 20,
            maxLoopCount: 0,
            logPinned: false,
            autoScrollPanel: true,
          },
          list: {
            loopMode: false,
            randomMinSec: 3,
            randomMaxSec: 20,
            maxLoopCount: 0,
            logPinned: false,
            autoScrollPanel: true,
          },
          task: {
            loopMode: false,
            randomMinSec: 3,
            randomMaxSec: 20,
            maxLoopCount: 0,
            logPinned: false,
            autoScrollPanel: true,
          },
        };
      }

      function cloneModeSettingItemSafe(value) {
        if (typeof cloneModeSettingItem === 'function') {
          return cloneModeSettingItem(value);
        }
        console.error('[AUTOQ_MODE_SETTINGS][ITEM_CLONE_FALLBACK] cloneModeSettingItem missing', {
          value,
        });
        const raw = value && typeof value === 'object' ? value : {};
        return {
          loopMode: !!raw.loopMode,
          randomMinSec: Math.max(1, Number(raw.randomMinSec) || 3),
          randomMaxSec: Math.max(
            Math.max(1, Number(raw.randomMinSec) || 3),
            Number(raw.randomMaxSec) || 20,
          ),
          maxLoopCount: Math.max(0, Number(raw.maxLoopCount) || 0),
          logPinned: !!raw.logPinned,
          autoScrollPanel: raw.autoScrollPanel !== false,
        };
      }

      function normalizeAutoMode(mode) {
        if (mode === 'list') return 'list';
        if (mode === 'task') return 'task';
        if (mode === 'closed-loop') return 'closed-loop';
        return 'continue';
      }

      function ensureModeSettings(cfg = config) {
        const base = cloneDefaultModeSettingsSafe();
        const raw = cfg && typeof cfg.modeSettings === 'object'
          ? cfg.modeSettings
          : {};

        return {
          continue: cloneModeSettingItemSafe(Object.assign({}, base.continue, raw.continue || {})),
          list: cloneModeSettingItemSafe(Object.assign({}, base.list, raw.list || {})),
          task: cloneModeSettingItemSafe(Object.assign({}, base.task, raw.task || {})),
          'closed-loop': cloneModeSettingItemSafe(Object.assign({}, base.continue, raw['closed-loop'] || {})),
        };
      }

      function normalizeAutoConfig(cfg = config) {
        if (!cfg || typeof cfg !== 'object') {
          console.error('[AUTOQ_MODE_SETTINGS][NORMALIZE_CONFIG_FAILED] invalid cfg');
          return cfg;
        }
        cfg.modeSettings = ensureModeSettings(cfg);
        cfg.promptMode = normalizeAutoMode(cfg.promptMode);
        return cfg;
      }

      function getModeSettings(mode) {
        if (!config || typeof config !== 'object') {
          console.error('[AUTOQ_MODE_SETTINGS][GET_FAILED] missing config', { mode });
          return cloneModeSettingItemSafe({});
        }
        const m = normalizeAutoMode(mode);
        config.modeSettings = ensureModeSettings(config);
        return config.modeSettings[m];
      }

      function patchModeSettings(mode, patch) {
        if (!config || typeof config !== 'object') {
          console.error('[AUTOQ_MODE_SETTINGS][PATCH_FAILED] missing config', { mode, patch });
          return;
        }
        const m = normalizeAutoMode(mode);
        config.modeSettings = ensureModeSettings(config);
        const target = config.modeSettings[m];
        const safePatch = patch && typeof patch === 'object' ? patch : {};

        if (Object.prototype.hasOwnProperty.call(safePatch, 'loopMode')) {
          target.loopMode = !!safePatch.loopMode;
        }
        if (Object.prototype.hasOwnProperty.call(safePatch, 'randomMinSec')) {
          target.randomMinSec = Math.max(1, Number(safePatch.randomMinSec) || 1);
        }
        if (Object.prototype.hasOwnProperty.call(safePatch, 'randomMaxSec')) {
          target.randomMaxSec = Math.max(
            target.randomMinSec,
            Number(safePatch.randomMaxSec) || target.randomMinSec,
          );
        }
        if (Object.prototype.hasOwnProperty.call(safePatch, 'maxLoopCount')) {
          target.maxLoopCount = Math.max(0, Number(safePatch.maxLoopCount) || 0);
        }
        if (Object.prototype.hasOwnProperty.call(safePatch, 'logPinned')) {
          target.logPinned = !!safePatch.logPinned;
        }
        if (Object.prototype.hasOwnProperty.call(safePatch, 'autoScrollPanel')) {
          target.autoScrollPanel = !!safePatch.autoScrollPanel;
        }
      }

      return Object.freeze({
        normalizeAutoMode,
        ensureModeSettings,
        normalizeAutoConfig,
        getModeSettings,
        patchModeSettings,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueModeSettings = AutoQueueModeSettings;


