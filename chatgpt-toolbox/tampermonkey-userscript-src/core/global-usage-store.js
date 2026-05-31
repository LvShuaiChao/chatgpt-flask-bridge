  /********************************************************************
   * GlobalUsageStore：跨标签页共享的上传/消息今日全局额度统计
   ********************************************************************/

  const GLOBAL_USAGE_STORE_KEY = 'xz_toolbox_global_usage_v1';
  const GLOBAL_USAGE_CHANNEL_NAME = 'xz_toolbox_global_usage_channel_v1';
  const GLOBAL_USAGE_MAX_EVENTS = 5000;

  let globalUsageBroadcastChannel = null;
  let globalUsageSyncInitialized = false;

  function appendGlobalUsageLog(line) {
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
      return;
    }
    console.log(line);
  }

  function getTodayUsageDayKey() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function getEndOfLocalDayMs(dayKey) {
    const key = String(dayKey || getTodayUsageDayKey()).trim();
    const parts = key.split('-').map((part) => Number(part));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      const nextDay = new Date(parts[0], parts[1] - 1, parts[2] + 1, 0, 0, 0, 0);
      return nextDay.getTime();
    }
    const fallback = new Date();
    fallback.setHours(24, 0, 0, 0);
    return fallback.getTime();
  }

  function readGlobalUsageLimitsFromConfig() {
    let uploadLimit = 80;
    let messageLimit = 150;

    if (typeof getCompactUiConfig === 'function') {
      try {
        const cfg = getCompactUiConfig() || {};
        const uploadFromCfg = Number(cfg.uploadQuotaMaxFiles);
        const messageFromCfg = Number(cfg.messageQuotaMaxMessages);
        if (Number.isFinite(uploadFromCfg) && uploadFromCfg > 0) {
          uploadLimit = Math.floor(uploadFromCfg);
        }
        if (Number.isFinite(messageFromCfg) && messageFromCfg > 0) {
          messageLimit = Math.floor(messageFromCfg);
        }
      } catch (error) {
        console.error('[GLOBAL_USAGE][READ_LIMITS_FAILED]', error);
        appendGlobalUsageLog(
          `[GLOBAL_USAGE][READ_LIMITS_FAILED] error_type=${error?.name || '-'} error=${error?.message || String(error)}`,
        );
      }
    } else if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.getConfig === 'function') {
      try {
        const cfg = SettingsModule.getConfig() || {};
        const uploadFromCfg = Number(cfg.uploadQuotaMaxFiles);
        const messageFromCfg = Number(cfg.messageQuotaMaxMessages);
        if (Number.isFinite(uploadFromCfg) && uploadFromCfg > 0) {
          uploadLimit = Math.floor(uploadFromCfg);
        }
        if (Number.isFinite(messageFromCfg) && messageFromCfg > 0) {
          messageLimit = Math.floor(messageFromCfg);
        }
      } catch (error) {
        console.error('[GLOBAL_USAGE][READ_LIMITS_FAILED]', error);
        appendGlobalUsageLog(
          `[GLOBAL_USAGE][READ_LIMITS_FAILED] error_type=${error?.name || '-'} error=${error?.message || String(error)}`,
        );
      }
    }

    return { uploadLimit, messageLimit };
  }

  function createEmptyGlobalUsageStore() {
    const limits = readGlobalUsageLimitsFromConfig();
    return {
      version: 1,
      dayKey: getTodayUsageDayKey(),
      messageLimit: limits.messageLimit,
      uploadLimit: limits.uploadLimit,
      messageUsed: 0,
      uploadUsed: 0,
      events: {
        message: {},
        upload: {},
      },
      updatedAt: Date.now(),
    };
  }

  function recomputeGlobalUsageCounts(store) {
    store.messageUsed = Object.keys(store.events.message || {}).length;
    store.uploadUsed = Object.keys(store.events.upload || {}).length;
    return store;
  }

  function pruneGlobalUsageEvents(store) {
    const messageEntries = Object.entries(store.events.message || {});
    const uploadEntries = Object.entries(store.events.upload || {});
    const allEntries = messageEntries
      .map(([eventId, item]) => ({ kind: 'message', eventId, at: Number(item && item.at) || 0 }))
      .concat(uploadEntries.map(([eventId, item]) => ({
        kind: 'upload',
        eventId,
        at: Number(item && item.at) || 0,
      })));

    if (allEntries.length <= GLOBAL_USAGE_MAX_EVENTS) {
      return store;
    }

    allEntries.sort((a, b) => a.at - b.at);
    const removeCount = allEntries.length - GLOBAL_USAGE_MAX_EVENTS;
    const removeSet = new Set(allEntries.slice(0, removeCount).map((item) => `${item.kind}:${item.eventId}`));

    Object.keys(store.events.message || {}).forEach((eventId) => {
      if (removeSet.has(`message:${eventId}`)) {
        delete store.events.message[eventId];
      }
    });
    Object.keys(store.events.upload || {}).forEach((eventId) => {
      if (removeSet.has(`upload:${eventId}`)) {
        delete store.events.upload[eventId];
      }
    });

    appendGlobalUsageLog(
      `[GLOBAL_USAGE][PRUNE] removed=${removeCount} remaining=${Object.keys(store.events.message || {}).length + Object.keys(store.events.upload || {}).length}`,
    );

    return store;
  }

  function readGlobalUsageStore() {
    const raw = localStorage.getItem(GLOBAL_USAGE_STORE_KEY);
    let store = null;

    if (raw) {
      try {
        store = JSON.parse(raw);
      } catch (error) {
        console.error('[GLOBAL_USAGE][READ_FAILED]', error);
        appendGlobalUsageLog(
          `[GLOBAL_USAGE][READ_FAILED] error_type=${error?.name || '-'} error=${error?.message || String(error)}`,
        );
      }
    }

    if (!store || typeof store !== 'object') {
      store = createEmptyGlobalUsageStore();
    }

    const today = getTodayUsageDayKey();
    if (store.dayKey !== today) {
      appendGlobalUsageLog(
        `[GLOBAL_USAGE][RESET_DAY] old=${store.dayKey || '-'} new=${today}`,
      );
      store = createEmptyGlobalUsageStore();
    }

    if (!store.events) {
      store.events = { message: {}, upload: {} };
    }
    if (!store.events.message) {
      store.events.message = {};
    }
    if (!store.events.upload) {
      store.events.upload = {};
    }

    const limits = readGlobalUsageLimitsFromConfig();
    store.messageLimit = limits.messageLimit;
    store.uploadLimit = limits.uploadLimit;

    return recomputeGlobalUsageCounts(store);
  }

  function broadcastGlobalUsageChanged(reason, store) {
    if (!globalUsageBroadcastChannel) {
      return;
    }

    globalUsageBroadcastChannel.postMessage({
      type: 'global-usage-updated',
      reason,
      dayKey: store.dayKey,
      messageUsed: store.messageUsed,
      uploadUsed: store.uploadUsed,
      updatedAt: store.updatedAt,
    });
  }

  function writeGlobalUsageStore(store, reason = '-') {
    store.updatedAt = Date.now();
    recomputeGlobalUsageCounts(store);
    pruneGlobalUsageEvents(store);
    recomputeGlobalUsageCounts(store);

    localStorage.setItem(GLOBAL_USAGE_STORE_KEY, JSON.stringify(store));
    broadcastGlobalUsageChanged(reason, store);

    appendGlobalUsageLog(
      `[GLOBAL_USAGE][SAVE] reason=${reason || '-'} messageUsed=${store.messageUsed} uploadUsed=${store.uploadUsed} dayKey=${store.dayKey}`,
    );
  }

  function resolveGlobalUsagePageInstanceId() {
    if (typeof getToolboxPageInstanceId === 'function') {
      return getToolboxPageInstanceId();
    }
    if (typeof window !== 'undefined' && window.__cgptPageInstanceId) {
      return String(window.__cgptPageInstanceId);
    }
    return '';
  }

  function resolveGlobalUsageConversationId() {
    if (typeof getCurrentPageConversationIdSafe === 'function') {
      return getCurrentPageConversationIdSafe() || '';
    }
    if (typeof getCurrentConversationId === 'function') {
      return getCurrentConversationId() || '';
    }
    return '';
  }

  function hashGlobalUsageText(text) {
    const str = String(text == null ? '' : text);
    let h = 5381;
    for (let i = 0; i < str.length; i += 1) {
      h = ((h << 5) + h) ^ str.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
  }

  function buildFileFingerprint(file) {
    const source = file && typeof file === 'object' ? file : {};
    return [
      String(source.name || source.fileName || ''),
      Number(source.size || source.fileSize || 0),
      Number(source.lastModified || 0),
    ].join(':');
  }

  function buildMessageUsageEventId(context = {}) {
    const pageInstanceId = String(context.pageInstanceId || resolveGlobalUsagePageInstanceId() || '');
    const conversationId = String(context.conversationId || resolveGlobalUsageConversationId() || '');
    const runId = String(context.runId || '');
    const text = String(context.text || '');
    const textHash = String(context.textHash || hashGlobalUsageText(text));
    const attachmentCount = Number(context.attachmentCount || 0);

    return [
      'message',
      pageInstanceId,
      conversationId,
      runId,
      textHash,
      attachmentCount,
    ].join('|');
  }

  function buildUploadUsageEventId(file, context = {}) {
    const pageInstanceId = String(context.pageInstanceId || resolveGlobalUsagePageInstanceId() || '');
    const conversationId = String(context.conversationId || resolveGlobalUsageConversationId() || '');
    const runId = String(context.runId || '');
    const fileFingerprint = String(context.fileFingerprint || buildFileFingerprint(file));

    return [
      'upload',
      pageInstanceId,
      conversationId,
      runId,
      fileFingerprint,
    ].join('|');
  }

  function recordGlobalMessageUsage(event = {}) {
    const store = readGlobalUsageStore();
    const eventId = String(event.eventId || buildMessageUsageEventId(event)).trim();

    if (!eventId || eventId === 'message|||||0') {
      appendGlobalUsageLog('[GLOBAL_USAGE][MESSAGE_SKIP] reason=missing-event-id');
      return {
        ok: false,
        reason: 'missing-event-id',
        store,
      };
    }

    if (store.events.message[eventId]) {
      appendGlobalUsageLog(
        `[GLOBAL_USAGE][MESSAGE_DEDUP] eventId=${eventId}`,
      );
      return {
        ok: true,
        dedup: true,
        store,
      };
    }

    store.events.message[eventId] = {
      eventId,
      at: Date.now(),
      pageInstanceId: event.pageInstanceId || resolveGlobalUsagePageInstanceId(),
      conversationId: event.conversationId || resolveGlobalUsageConversationId(),
      runId: event.runId || '',
      textHash: event.textHash || hashGlobalUsageText(event.text || ''),
      attachmentCount: Number(event.attachmentCount || 0),
    };

    writeGlobalUsageStore(store, 'record-message');

    return {
      ok: true,
      dedup: false,
      store,
    };
  }

  function recordGlobalUploadUsage(event = {}) {
    const store = readGlobalUsageStore();
    const eventId = String(event.eventId || buildUploadUsageEventId(event, event)).trim();

    if (!eventId || eventId === 'upload||||') {
      appendGlobalUsageLog('[GLOBAL_USAGE][UPLOAD_SKIP] reason=missing-event-id');
      return {
        ok: false,
        reason: 'missing-event-id',
        store,
      };
    }

    if (store.events.upload[eventId]) {
      appendGlobalUsageLog(
        `[GLOBAL_USAGE][UPLOAD_DEDUP] eventId=${eventId}`,
      );
      return {
        ok: true,
        dedup: true,
        store,
      };
    }

    store.events.upload[eventId] = {
      eventId,
      at: Date.now(),
      pageInstanceId: event.pageInstanceId || resolveGlobalUsagePageInstanceId(),
      conversationId: event.conversationId || resolveGlobalUsageConversationId(),
      runId: event.runId || '',
      fileName: event.fileName || '',
      fileSize: Number(event.fileSize || 0),
      fileFingerprint: event.fileFingerprint || '',
    };

    writeGlobalUsageStore(store, 'record-upload');

    return {
      ok: true,
      dedup: false,
      store,
    };
  }

  function getGlobalUsageQuotaSnapshot(kind = 'both') {
    const store = readGlobalUsageStore();
    const endOfDayMs = getEndOfLocalDayMs(store.dayKey);
    const windowMs = Math.max(1000, endOfDayMs - Date.now());

    const uploadUsed = Number(store.uploadUsed) || 0;
    const messageUsed = Number(store.messageUsed) || 0;
    const uploadLimit = Number(store.uploadLimit) || 80;
    const messageLimit = Number(store.messageLimit) || 150;

    const uploadRemaining = Math.max(0, uploadLimit - uploadUsed);
    const messageRemaining = Math.max(0, messageLimit - messageUsed);

    const uploadNextReleaseAt = uploadRemaining <= 0 ? endOfDayMs : 0;
    const messageNextReleaseAt = messageRemaining <= 0 ? endOfDayMs : 0;

    const upload = {
      windowMs,
      maxFiles: uploadLimit,
      limit: uploadLimit,
      used: uploadUsed,
      remaining: uploadRemaining,
      canUpload: uploadRemaining > 0,
      records: Object.values(store.events.upload || {}),
      nextReleaseAt: uploadNextReleaseAt,
      source: 'global-usage',
      dayKey: store.dayKey,
    };

    const message = {
      windowMs,
      maxMessages: messageLimit,
      limit: messageLimit,
      used: messageUsed,
      remaining: messageRemaining,
      canSend: messageRemaining > 0,
      records: Object.values(store.events.message || {}),
      nextReleaseAt: messageNextReleaseAt,
      source: 'global-usage',
      dayKey: store.dayKey,
    };

    if (kind === 'upload') {
      return upload;
    }
    if (kind === 'message') {
      return message;
    }

    return { upload, message, store };
  }

  function formatGlobalUsageEventLine(kind, eventId, item) {
    const safeKind = String(kind || 'unknown');
    const safeId = String(eventId || item?.eventId || '-');
    const at = Number(item && item.at) || 0;
    const atText = at > 0 ? new Date(at).toLocaleString() : '-';
    if (safeKind === 'upload') {
      return `[${atText}] upload eventId=${safeId} file=${item?.fileName || '-'} size=${Number(item?.fileSize || 0)} page=${item?.pageInstanceId || '-'}`;
    }
    return `[${atText}] message eventId=${safeId} hash=${item?.textHash || '-'} attachments=${Number(item?.attachmentCount || 0)} page=${item?.pageInstanceId || '-'}`;
  }

  function getGlobalUsageEventsSummary(options = {}) {
    const store = readGlobalUsageStore();
    const maxLines = Math.max(1, Math.min(500, Number(options.maxLines) || 50));
    const messageEntries = Object.entries(store.events.message || {})
      .map(([eventId, item]) => ({ kind: 'message', eventId, item, at: Number(item && item.at) || 0 }))
      .sort((a, b) => b.at - a.at);
    const uploadEntries = Object.entries(store.events.upload || {})
      .map(([eventId, item]) => ({ kind: 'upload', eventId, item, at: Number(item && item.at) || 0 }))
      .sort((a, b) => b.at - a.at);

    return {
      dayKey: store.dayKey,
      messageUsed: store.messageUsed,
      uploadUsed: store.uploadUsed,
      messageLimit: store.messageLimit,
      uploadLimit: store.uploadLimit,
      messageEvents: messageEntries.slice(0, maxLines),
      uploadEvents: uploadEntries.slice(0, maxLines),
      messageEventCount: messageEntries.length,
      uploadEventCount: uploadEntries.length,
    };
  }

  function exportGlobalUsageEventsText(options = {}) {
    const summary = getGlobalUsageEventsSummary(options);
    const lines = [
      `[GLOBAL_USAGE][EXPORT] dayKey=${summary.dayKey} messageUsed=${summary.messageUsed}/${summary.messageLimit} uploadUsed=${summary.uploadUsed}/${summary.uploadLimit}`,
      `[GLOBAL_USAGE][EXPORT] messageEvents=${summary.messageEventCount} uploadEvents=${summary.uploadEventCount}`,
      '',
      '--- message events (newest first) ---',
    ];

    summary.messageEvents.forEach(({ kind, eventId, item }) => {
      lines.push(formatGlobalUsageEventLine(kind, eventId, item));
    });

    lines.push('', '--- upload events (newest first) ---');
    summary.uploadEvents.forEach(({ kind, eventId, item }) => {
      lines.push(formatGlobalUsageEventLine(kind, eventId, item));
    });

    return lines.join('\n');
  }

  function resetGlobalUsageToday(reason = 'manual') {
    const store = createEmptyGlobalUsageStore();
    writeGlobalUsageStore(store, `reset:${reason}`);

    if (typeof renderToolboxTopStatus === 'function') {
      renderToolboxTopStatus({ reason: `global-usage-reset:${reason}` });
    } else if (typeof UploadModule !== 'undefined' && typeof UploadModule.renderToolboxTopStatus === 'function') {
      UploadModule.renderToolboxTopStatus({ reason: `global-usage-reset:${reason}` });
    }

    return store;
  }

  function clearGlobalUsageKind(kind = 'both', reason = 'manual') {
    const store = readGlobalUsageStore();
    const safeKind = String(kind || 'both').trim().toLowerCase();

    if (safeKind === 'upload' || safeKind === 'both') {
      store.events.upload = {};
    }
    if (safeKind === 'message' || safeKind === 'both') {
      store.events.message = {};
    }

    writeGlobalUsageStore(store, `clear-${safeKind}:${reason}`);
    notifyGlobalUsageChanged(`clear-${safeKind}:${reason}`);
    return store;
  }

  function notifyGlobalUsageChanged(reason = '-') {
    if (typeof renderToolboxTopStatus === 'function') {
      renderToolboxTopStatus({ reason: `global-usage-${reason}` });
    } else if (typeof UploadModule !== 'undefined' && typeof UploadModule.renderToolboxTopStatus === 'function') {
      UploadModule.renderToolboxTopStatus({ reason: `global-usage-${reason}` });
    }

    if (typeof renderToolboxPageStatusRow === 'function') {
      renderToolboxPageStatusRow({ reason: `global-usage-${reason}` });
    } else if (typeof UploadModule !== 'undefined' && typeof UploadModule.renderToolboxPageStatusRow === 'function') {
      UploadModule.renderToolboxPageStatusRow({ reason: `global-usage-${reason}` });
    }
  }

  function initGlobalUsageSync() {
    if (globalUsageSyncInitialized) {
      return;
    }
    globalUsageSyncInitialized = true;

    if ('BroadcastChannel' in window && !globalUsageBroadcastChannel) {
      globalUsageBroadcastChannel = new BroadcastChannel(GLOBAL_USAGE_CHANNEL_NAME);

      globalUsageBroadcastChannel.onmessage = (event) => {
        const data = event.data || {};
        if (data.type !== 'global-usage-updated') {
          return;
        }

        appendGlobalUsageLog(
          `[GLOBAL_USAGE][BROADCAST_RECEIVED] reason=${data.reason || '-'} messageUsed=${data.messageUsed} uploadUsed=${data.uploadUsed}`,
        );

        notifyGlobalUsageChanged('broadcast');
      };
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== GLOBAL_USAGE_STORE_KEY) {
        return;
      }

      appendGlobalUsageLog('[GLOBAL_USAGE][STORAGE_EVENT]');
      notifyGlobalUsageChanged('storage-event');
    });
  }

  const GlobalUsageStore = {
    GLOBAL_USAGE_STORE_KEY,
    getTodayUsageDayKey,
    readGlobalUsageStore,
    writeGlobalUsageStore,
    recordGlobalMessageUsage,
    recordGlobalUploadUsage,
    buildMessageUsageEventId,
    buildUploadUsageEventId,
    buildFileFingerprint,
    hashGlobalUsageText,
    getGlobalUsageQuotaSnapshot,
    resetGlobalUsageToday,
    clearGlobalUsageKind,
    initGlobalUsageSync,
    getGlobalUsageEventsSummary,
    exportGlobalUsageEventsText,
    formatGlobalUsageEventLine,
  };
