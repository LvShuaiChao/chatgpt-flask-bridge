import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'tampermonkey-userscript-src');
const BUILD_ORDER_FILE = path.join(SRC_DIR, '.build-order.json');
const AUTOQUEUE_CORE_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-core.js');
const LIST_PROFILE_CONFIG_FILE = path.join(SRC_DIR, 'autoqueue', 'auto-queue-list-profile-config.js');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[AUTOQ_LIST_PROFILE_SPLIT][MISSING_FILE] file=${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function writeText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, String(text || ''), 'utf8');
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }
  const backupPath = `${filePath}.bak.${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`[AUTOQ_LIST_PROFILE_SPLIT][BACKUP] from=${filePath} to=${backupPath}`);
  return backupPath;
}

function assertContains(text, marker, filePath) {
  if (!String(text || '').includes(marker)) {
    throw new Error(`[AUTOQ_LIST_PROFILE_SPLIT][MARKER_NOT_FOUND] file=${filePath} marker=${marker}`);
  }
}

function createListProfileConfigModule() {
  const moduleText = `  /********************************************************************
   * AutoQueueListProfileConfig：自动队列列表 Profile 配置归一化
   *
   * 说明：
   * 1. 从 auto-queue-core.js 拆出。
   * 2. 只负责 listProfiles / activeListProfileId / listPromptsText 的配置归一化。
   * 3. 不负责自动发送、不负责回复等待、不负责闭环、不负责按钮渲染。
   ********************************************************************/
  const AutoQueueListProfileConfig = (() => {
    function safeLog(line) {
      const text = String(line || '').trim();
      if (!text) {
        return;
      }
      if (
        typeof ToolboxShell !== 'undefined'
        && ToolboxShell
        && typeof ToolboxShell.appendLog === 'function'
      ) {
        ToolboxShell.appendLog(text);
        return;
      }
      console.log(text);
    }

    function safeWarn(label, payload) {
      console.warn(label, payload || {});
    }

    function createFallbackId(prefix) {
      return String(prefix || 'autoq_list') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    }

    function create(deps = {}) {
      const config = deps.config;
      const normalizeNamedEntity = deps.normalizeNamedEntity;
      const createId = deps.createId;
      const buildUniqueName = deps.buildUniqueName;
      const pad2 = deps.pad2;
      const getDefaultAutoListPromptsText = deps.getDefaultAutoListPromptsText;

      if (!config || typeof config !== 'object') {
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][CREATE_FAILED] missing config');
      }

      function getDefaultListText() {
        if (typeof getDefaultAutoListPromptsText === 'function') {
          return String(getDefaultAutoListPromptsText() || '');
        }
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][DEFAULT_TEXT_FALLBACK] getDefaultAutoListPromptsText missing');
        return '';
      }

      function normalizeEntitySafe(item, options) {
        if (typeof normalizeNamedEntity === 'function') {
          return normalizeNamedEntity(item, options);
        }
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][NORMALIZE_ENTITY_FALLBACK] normalizeNamedEntity missing', {
          item,
          options,
        });
        const now = Date.now();
        const prefix = options && options.prefix ? options.prefix : 'autoq_list';
        const fallbackName = options && options.fallbackName ? options.fallbackName : '未命名列表';
        return {
          id: String(item && item.id || '').trim() || createFallbackId(prefix),
          name: String(item && item.name || '').trim() || fallbackName,
          createdAt: Number(item && item.createdAt || now),
          updatedAt: Number(item && item.updatedAt || now),
        };
      }

      function createIdSafe(prefix) {
        if (typeof createId === 'function') {
          return createId(prefix);
        }
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][CREATE_ID_FALLBACK] createId missing', { prefix });
        return createFallbackId(prefix);
      }

      function buildUniqueNameSafe(base, names) {
        if (typeof buildUniqueName === 'function') {
          return buildUniqueName(base, names);
        }
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][UNIQUE_NAME_FALLBACK] buildUniqueName missing', {
          base,
          count: names && typeof names.size === 'number' ? names.size : -1,
        });
        let name = String(base || '列表');
        let index = 2;
        while (names && names.has && names.has(name)) {
          name = String(base || '列表') + '_' + index;
          index += 1;
        }
        return name;
      }

      function pad2Safe(value) {
        if (typeof pad2 === 'function') {
          return pad2(value);
        }
        return String(value).padStart(2, '0');
      }

      function getDefaultListProfileMeta() {
        const defaultId = (typeof AutoqListStore !== 'undefined' && AutoqListStore.DEFAULT_LIST_ID)
          ? AutoqListStore.DEFAULT_LIST_ID
          : 'list_default';
        const defaultName = (typeof AutoqListStore !== 'undefined' && AutoqListStore.DEFAULT_LIST_NAME)
          ? AutoqListStore.DEFAULT_LIST_NAME
          : '默认列表';
        return { defaultId, defaultName };
      }

      function dedupeConfigListProfiles(rawProfiles) {
        const { defaultId, defaultName } = getDefaultListProfileMeta();
        const inputLists = Array.isArray(rawProfiles) ? rawProfiles : [];
        const result = [];
        const seenIds = new Set();
        let hasDefault = false;

        for (const item of inputLists) {
          if (!item || typeof item !== 'object') {
            continue;
          }

          const base = normalizeEntitySafe(item, {
            prefix: 'autoq_list',
            fallbackName: '未命名列表',
            maxNameLength: 24,
          });
          const profile = {
            ...base,
            text: String(item.text || ''),
          };

          const rawId = String(profile.id || '').trim();
          const rawName = String(profile.name || '').trim();
          const isDefaultById = rawId === defaultId;
          const isDefaultByName = rawName === defaultName;

          if (isDefaultById || isDefaultByName) {
            if (hasDefault) {
              safeWarn('[PROMPT_LIST][DEDUP_DEFAULT_LIST]', {
                removedId: rawId,
                removedName: rawName,
              });
              continue;
            }
            result.push({
              ...profile,
              id: defaultId,
              name: defaultName,
            });
            seenIds.add(defaultId);
            hasDefault = true;
            continue;
          }

          const id = rawId || createIdSafe('autoq_list');
          const name = rawName || '未命名列表';
          if (seenIds.has(id)) {
            safeWarn('[PROMPT_LIST][DEDUP_DUPLICATE_ID]', {
              removedId: id,
              removedName: name,
            });
            continue;
          }

          result.push({
            ...profile,
            id,
            name,
          });
          seenIds.add(id);
        }

        if (!hasDefault) {
          const { defaultId: id, defaultName: name } = getDefaultListProfileMeta();
          result.unshift({
            ...normalizeEntitySafe({ id, name }, {
              prefix: 'autoq_list',
              fallbackName: name,
              maxNameLength: 24,
            }),
            text: String(config && config.listPromptsText || getDefaultListText()),
          });
        }

        return result;
      }

      function getValidActiveListProfileId(lists) {
        const { defaultId } = getDefaultListProfileMeta();
        const savedActiveId = String(
          config && (config.activeListProfileId || config.lastSelectedListProfileId) || '',
        ).trim();
        const hasSavedActive = Array.isArray(lists)
          && lists.some((item) => item && item.id === savedActiveId);
        if (hasSavedActive) {
          return savedActiveId;
        }
        return defaultId;
      }

      function normalizeListProfiles() {
        if (!config || typeof config !== 'object') {
          console.error('[AUTOQ_LIST_PROFILE_CONFIG][NORMALIZE_FAILED] missing config');
          return null;
        }

        if (!Array.isArray(config.listProfiles)) {
          config.listProfiles = [];
        }

        config.listProfiles = dedupeConfigListProfiles(config.listProfiles);

        if (!config.listProfiles.length) {
          const { defaultId, defaultName } = getDefaultListProfileMeta();
          config.listProfiles.push({
            ...normalizeEntitySafe({ id: defaultId, name: defaultName }, {
              prefix: 'autoq_list',
              fallbackName: defaultName,
              maxNameLength: 24,
            }),
            text: String(config.listPromptsText || getDefaultListText()),
          });
        }

        config.activeListProfileId = getValidActiveListProfileId(config.listProfiles);

        const preferredId = String(
          config.activeListProfileId
          || config.lastSelectedListProfileId
          || '',
        ).trim();
        let active = preferredId
          ? config.listProfiles.find((item) => item.id === preferredId)
          : null;

        if (!active && typeof AutoqListStore !== 'undefined') {
          try {
            const fromStore = AutoqListStore.getLastSelectedAutoqTaskList();
            if (fromStore) {
              active = config.listProfiles.find((item) => item.id === fromStore.id) || null;
            }
          } catch (error) {
            console.error('[AUTOQ_LIST_STORE][ERROR]', {
              message: error && error.message ? error.message : String(error),
              stack: error && error.stack ? error.stack : '',
            });
          }
        }

        if (!active) {
          const sorted = config.listProfiles.slice().sort((a, b) => (
            (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
          ));
          active = sorted[0] || config.listProfiles[0] || null;
        }

        if (active) {
          config.activeListProfileId = active.id;
          config.lastSelectedListProfileId = active.id;
          config.listPromptsText = active.text;
        }

        return active || null;
      }

      function getActiveListProfile() {
        normalizeListProfiles();
        if (!config || !Array.isArray(config.listProfiles)) {
          console.error('[AUTOQ_LIST_PROFILE_CONFIG][GET_ACTIVE_FAILED] config.listProfiles invalid');
          return null;
        }
        return config.listProfiles.find((item) => item.id === config.activeListProfileId)
          || config.listProfiles[0]
          || null;
      }

      function buildAutoQueueListName() {
        const d = new Date();
        const base = '列表_'
          + d.getFullYear()
          + pad2Safe(d.getMonth() + 1)
          + pad2Safe(d.getDate())
          + '_'
          + pad2Safe(d.getHours())
          + pad2Safe(d.getMinutes())
          + pad2Safe(d.getSeconds());
        const names = new Set(
          config && Array.isArray(config.listProfiles)
            ? config.listProfiles.map((item) => item.name)
            : [],
        );
        return buildUniqueNameSafe(base, names);
      }

      return Object.freeze({
        getDefaultListProfileMeta,
        dedupeConfigListProfiles,
        getValidActiveListProfileId,
        normalizeListProfiles,
        getActiveListProfile,
        buildAutoQueueListName,
      });
    }

    return Object.freeze({
      create,
    });
  })();

  globalThis.AutoQueueListProfileConfig = AutoQueueListProfileConfig;
`;

  writeText(LIST_PROFILE_CONFIG_FILE, moduleText);
  console.log('[AUTOQ_LIST_PROFILE_SPLIT][MODULE_WRITTEN] file=autoqueue/auto-queue-list-profile-config.js');
}

function buildFacadeBlock() {
  return `    let autoQueueListProfileConfigApi = null;
    function ensureAutoQueueListProfileConfigApi() {
      if (autoQueueListProfileConfigApi) {
        return autoQueueListProfileConfigApi;
      }
      if (
        typeof AutoQueueListProfileConfig === 'undefined'
        || !AutoQueueListProfileConfig
        || typeof AutoQueueListProfileConfig.create !== 'function'
      ) {
        console.error('[AUTOQ_LIST_PROFILE_CONFIG][MISSING] AutoQueueListProfileConfig.create is not available');
        return null;
      }
      autoQueueListProfileConfigApi = AutoQueueListProfileConfig.create({
        config,
        normalizeNamedEntity,
        createId,
        buildUniqueName,
        pad2,
        getDefaultAutoListPromptsText,
      });
      return autoQueueListProfileConfigApi;
    }
    function requireAutoQueueListProfileConfigApi(methodName) {
      const api = ensureAutoQueueListProfileConfigApi();
      if (!api || typeof api[methodName] !== 'function') {
        const message = '[AUTOQ_LIST_PROFILE_CONFIG][API_METHOD_MISSING] method=' + methodName;
        console.error(message, {
          hasApi: api ? 1 : 0,
          methodName,
        });
        throw new Error(message);
      }
      return api[methodName];
    }
    function getDefaultListProfileMeta() {
      return requireAutoQueueListProfileConfigApi('getDefaultListProfileMeta')();
    }
    function dedupeConfigListProfiles(rawProfiles) {
      return requireAutoQueueListProfileConfigApi('dedupeConfigListProfiles')(rawProfiles);
    }
    function getValidActiveListProfileId(lists) {
      return requireAutoQueueListProfileConfigApi('getValidActiveListProfileId')(lists);
    }
    function normalizeListProfiles() {
      return requireAutoQueueListProfileConfigApi('normalizeListProfiles')();
    }
    function getActiveListProfile() {
      return requireAutoQueueListProfileConfigApi('getActiveListProfile')();
    }
    function buildAutoQueueListName() {
      return requireAutoQueueListProfileConfigApi('buildAutoQueueListName')();
    }
`;
}

function patchAutoQueueCore() {
  const source = readText(AUTOQUEUE_CORE_FILE);

  assertContains(source, 'const AutoQueueModule = (() => {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    let autoQueueListProfileSync = null;', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    function getDefaultListProfileMeta() {', AUTOQUEUE_CORE_FILE);
  assertContains(source, '    const TASK_DONE_SIGNAL = (', AUTOQUEUE_CORE_FILE);

  if (source.includes('let autoQueueListProfileConfigApi = null;')) {
    throw new Error('[AUTOQ_LIST_PROFILE_SPLIT][ALREADY_PATCHED] autoQueueListProfileConfigApi already exists');
  }

  const insertMarker = '    let autoQueueListProfileSync = null;';
  const insertIndex = source.indexOf(insertMarker);

  const removeStartMarker = '    function getDefaultListProfileMeta() {';
  const removeEndMarker = '    const TASK_DONE_SIGNAL = (';
  const removeStart = source.indexOf(removeStartMarker);
  const removeEnd = source.indexOf(removeEndMarker, removeStart);

  if (removeStart < 0 || removeEnd < 0 || removeEnd <= removeStart) {
    throw new Error('[AUTOQ_LIST_PROFILE_SPLIT][REMOVE_RANGE_INVALID]');
  }

  const removedBlock = source.slice(removeStart, removeEnd);
  const requiredRemovedMarkers = [
    'function getDefaultListProfileMeta',
    'function dedupeConfigListProfiles',
    'function getValidActiveListProfileId',
    'function normalizeListProfiles',
    'function getActiveListProfile',
    'function buildAutoQueueListName',
  ];
  const missing = requiredRemovedMarkers.filter((marker) => !removedBlock.includes(marker));
  if (missing.length > 0) {
    throw new Error(`[AUTOQ_LIST_PROFILE_SPLIT][REMOVE_RANGE_MISSING] missing=${missing.join(',')}`);
  }

  const sourceWithoutOldBlock = source.slice(0, removeStart).replace(/\s*$/, '\n\n')
    + source.slice(removeEnd);

  const newInsertIndex = sourceWithoutOldBlock.indexOf(insertMarker);
  if (newInsertIndex < 0) {
    throw new Error('[AUTOQ_LIST_PROFILE_SPLIT][INSERT_MARKER_LOST]');
  }

  const beforeInsert = sourceWithoutOldBlock.slice(0, newInsertIndex);
  const afterInsert = sourceWithoutOldBlock.slice(newInsertIndex);
  const patched = beforeInsert + buildFacadeBlock() + afterInsert;

  backupFile(AUTOQUEUE_CORE_FILE);
  writeText(AUTOQUEUE_CORE_FILE, patched);
  console.log(`[AUTOQ_LIST_PROFILE_SPLIT][CORE_PATCHED] removedChars=${removedBlock.length}`);
}

function updateBuildOrder() {
  const raw = readText(BUILD_ORDER_FILE);
  const config = JSON.parse(raw);
  if (!Array.isArray(config.parts)) {
    throw new Error('[AUTOQ_LIST_PROFILE_SPLIT][BUILD_ORDER_INVALID] parts is not array');
  }

  let parts = [...config.parts];
  parts = parts.filter((part) => part !== 'autoqueue/auto-queue-list-profile-config.js');

  const syncIndex = parts.indexOf('autoqueue/auto-queue-list-profile-sync.js');
  const coreIndex = parts.indexOf('autoqueue/auto-queue-core.js');
  if (syncIndex < 0) {
    throw new Error('[AUTOQ_LIST_PROFILE_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-list-profile-sync.js');
  }
  if (coreIndex < 0) {
    throw new Error('[AUTOQ_LIST_PROFILE_SPLIT][BUILD_ORDER_INVALID] missing autoqueue/auto-queue-core.js');
  }

  parts.splice(syncIndex, 0, 'autoqueue/auto-queue-list-profile-config.js');
  config.parts = parts;

  backupFile(BUILD_ORDER_FILE);
  writeText(BUILD_ORDER_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log('[AUTOQ_LIST_PROFILE_SPLIT][BUILD_ORDER_OK]', {
    configIndex: parts.indexOf('autoqueue/auto-queue-list-profile-config.js'),
    syncIndex: parts.indexOf('autoqueue/auto-queue-list-profile-sync.js'),
    coreIndex: parts.indexOf('autoqueue/auto-queue-core.js'),
  });
}

function verifyResult() {
  const core = readText(AUTOQUEUE_CORE_FILE);
  const moduleText = readText(LIST_PROFILE_CONFIG_FILE);
  const order = JSON.parse(readText(BUILD_ORDER_FILE));
  const failures = [];

  if (!core.includes('let autoQueueListProfileConfigApi = null;')) {
    failures.push('auto-queue-core.js missing autoQueueListProfileConfigApi facade');
  }
  if (!core.includes("requireAutoQueueListProfileConfigApi('normalizeListProfiles')")) {
    failures.push('auto-queue-core.js normalizeListProfiles is not delegated');
  }
  if (core.includes('const seenIds = new Set();') && core.includes('function dedupeConfigListProfiles(rawProfiles)')) {
    failures.push('auto-queue-core.js still contains full dedupeConfigListProfiles implementation');
  }
  if (!moduleText.includes('const AutoQueueListProfileConfig = (() => {')) {
    failures.push('auto-queue-list-profile-config.js missing module');
  }
  [
    'function getDefaultListProfileMeta',
    'function dedupeConfigListProfiles',
    'function getValidActiveListProfileId',
    'function normalizeListProfiles',
    'function getActiveListProfile',
    'function buildAutoQueueListName',
  ].forEach((marker) => {
    if (!moduleText.includes(marker)) {
      failures.push(`auto-queue-list-profile-config.js missing ${marker}`);
    }
  });

  if (!Array.isArray(order.parts)) {
    failures.push('.build-order.json parts invalid');
  } else {
    const configIndex = order.parts.indexOf('autoqueue/auto-queue-list-profile-config.js');
    const syncIndex = order.parts.indexOf('autoqueue/auto-queue-list-profile-sync.js');
    const coreIndex = order.parts.indexOf('autoqueue/auto-queue-core.js');
    if (configIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-list-profile-config.js');
    }
    if (syncIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-list-profile-sync.js');
    }
    if (coreIndex < 0) {
      failures.push('.build-order.json missing autoqueue/auto-queue-core.js');
    }
    if (!(configIndex >= 0 && syncIndex >= 0 && configIndex < syncIndex)) {
      failures.push('auto-queue-list-profile-config.js must be before auto-queue-list-profile-sync.js');
    }
    if (!(syncIndex >= 0 && coreIndex >= 0 && syncIndex < coreIndex)) {
      failures.push('auto-queue-list-profile-sync.js must be before auto-queue-core.js');
    }
  }

  if (failures.length > 0) {
    failures.forEach((item) => {
      console.error(`[AUTOQ_LIST_PROFILE_SPLIT][VERIFY_FAILED] ${item}`);
    });
    throw new Error(`[AUTOQ_LIST_PROFILE_SPLIT][VERIFY_FAILED] count=${failures.length}`);
  }

  console.log('[AUTOQ_LIST_PROFILE_SPLIT][VERIFY_OK]');
}

function main() {
  console.log(`[AUTOQ_LIST_PROFILE_SPLIT][START] root=${ROOT_DIR}`);
  createListProfileConfigModule();
  patchAutoQueueCore();
  updateBuildOrder();
  verifyResult();
  console.log('[AUTOQ_LIST_PROFILE_SPLIT][DONE]');
}

try {
  main();
} catch (error) {
  console.error('[AUTOQ_LIST_PROFILE_SPLIT][FATAL]', {
    message: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : '',
  });
  process.exit(1);
}
