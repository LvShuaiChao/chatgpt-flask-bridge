  /********************************************************************
   * GlobalUsageStore：跨标签页共享的上传/消息滑动窗口额度统计
   ********************************************************************/

  const GLOBAL_USAGE_STORE_KEY = 'xz_toolbox_global_usage_v1';
  const GLOBAL_USAGE_CHANNEL_NAME = 'xz_toolbox_global_usage_channel_v1';
  const GLOBAL_USAGE_MAX_EVENTS = 5000;

  let globalUsageBroadcastChannel = null;
  let globalUsageSyncInitialized = false;
  let globalUsageWindowRefreshTimer = null;
  const lastGlobalUsageNextReleaseLogAt = { message: 0, upload: 0 };
  const lastGlobalUsageNextReleaseValue = { message: 0, upload: 0 };

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

  function readGlobalUsageWindowMsFromConfig() {
    let uploadWindowHours = 3;
    let messageWindowHours = 3;

    if (typeof getCompactUiConfig === 'function') {
      try {
        const cfg = getCompactUiConfig() || {};
        const uploadHoursFromCfg = Number(cfg.uploadQuotaWindowHours);
        const messageHoursFromCfg = Number(cfg.messageQuotaWindowHours);
        if (Number.isFinite(uploadHoursFromCfg) && uploadHoursFromCfg > 0) {
          uploadWindowHours = Math.floor(uploadHoursFromCfg);
        }
        if (Number.isFinite(messageHoursFromCfg) && messageHoursFromCfg > 0) {
          messageWindowHours = Math.floor(messageHoursFromCfg);
        }
      } catch (error) {
        console.error('[GLOBAL_USAGE][READ_WINDOW_FAILED]', error);
        appendGlobalUsageLog(
          `[GLOBAL_USAGE][READ_WINDOW_FAILED] error_type=${error?.name || '-'} error=${error?.message || String(error)}`,
        );
      }
    } else if (typeof SettingsModule !== 'undefined' && typeof SettingsModule.getConfig === 'function') {
      try {
        const cfg = SettingsModule.getConfig() || {};
        const uploadHoursFromCfg = Number(cfg.uploadQuotaWindowHours);
        const messageHoursFromCfg = Number(cfg.messageQuotaWindowHours);
        if (Number.isFinite(uploadHoursFromCfg) && uploadHoursFromCfg > 0) {
          uploadWindowHours = Math.floor(uploadHoursFromCfg);
        }
        if (Number.isFinite(messageHoursFromCfg) && messageHoursFromCfg > 0) {
          messageWindowHours = Math.floor(messageHoursFromCfg);
        }
      } catch (error) {
        console.error('[GLOBAL_USAGE][READ_WINDOW_FAILED]', error);
        appendGlobalUsageLog(
          `[GLOBAL_USAGE][READ_WINDOW_FAILED] error_type=${error?.name || '-'} error=${error?.message || String(error)}`,
        );
      }
    }

    return {
      uploadWindowHours,
      messageWindowHours,
      uploadWindowMs: uploadWindowHours * 60 * 60 * 1000,
      messageWindowMs: messageWindowHours * 60 * 60 * 1000,
    };
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

  function filterGlobalUsageEventsByWindow(events, windowMs) {
    const now = Date.now();
    const windowValue = Math.max(1000, Number(windowMs) || 0);
    const source = events && typeof events === 'object' ? events : {};
    const before = Object.keys(source).length;
    const filtered = {};

    Object.entries(source).forEach(([eventId, item]) => {
      const at = Number(item && item.at) || 0;
      if (at > 0 && now - at < windowValue) {
        filtered[eventId] = item;
      }
    });

    return {
      filtered,
      before,
      after: Object.keys(filtered).length,
    };
  }

  function pruneStoredGlobalUsageEventsByWindow(store) {
    const windows = readGlobalUsageWindowMsFromConfig();
    const messageResult = filterGlobalUsageEventsByWindow(store.events.message, windows.messageWindowMs);
    const uploadResult = filterGlobalUsageEventsByWindow(store.events.upload, windows.uploadWindowMs);

    if (messageResult.before !== messageResult.after) {
      appendGlobalUsageLog(
        `[GLOBAL_USAGE][WINDOW_PRUNE] kind=message before=${messageResult.before} after=${messageResult.after} windowMs=${windows.messageWindowMs}`,
      );
      store.events.message = messageResult.filtered;
    }

    if (uploadResult.before !== uploadResult.after) {
      appendGlobalUsageLog(
        `[GLOBAL_USAGE][WINDOW_PRUNE] kind=upload before=${uploadResult.before} after=${uploadResult.after} windowMs=${windows.uploadWindowMs}`,
      );
      store.events.upload = uploadResult.filtered;
    }

    return store;
  }

  function recomputeGlobalUsageCounts(store) {
    const windows = readGlobalUsageWindowMsFromConfig();
    store.messageUsed = filterGlobalUsageEventsByWindow(store.events.message, windows.messageWindowMs).after;
    store.uploadUsed = filterGlobalUsageEventsByWindow(store.events.upload, windows.uploadWindowMs).after;
    return store;
  }

  function computeNextReleaseAtForWindowRecords(records, windowMs, remaining) {
    if (Math.max(0, Number(remaining) || 0) > 0) {
      return 0;
    }

    const windowValue = Math.max(1000, Number(windowMs) || 0);
    const list = Array.isArray(records) ? records : [];
    if (!list.length) {
      return 0;
    }

    let oldestAt = Infinity;
    list.forEach((item) => {
      const at = Number(item && item.at) || 0;
      if (at > 0 && at < oldestAt) {
        oldestAt = at;
      }
    });

    if (!Number.isFinite(oldestAt)) {
      return 0;
    }

    return oldestAt + windowValue;
  }

  function logGlobalUsageNextRelease(kind, nextReleaseAt) {
    const safeKind = kind === 'upload' ? 'upload' : 'message';
    const target = Number(nextReleaseAt) || 0;
    if (target <= 0) {
      return;
    }
    const now = Date.now();
    if (
      lastGlobalUsageNextReleaseValue[safeKind] === target
      && now - lastGlobalUsageNextReleaseLogAt[safeKind] < 30000
    ) {
      return;
    }
    lastGlobalUsageNextReleaseValue[safeKind] = target;
    lastGlobalUsageNextReleaseLogAt[safeKind] = now;
    const waitMs = Math.max(0, target - now);
    appendGlobalUsageLog(
      `[GLOBAL_USAGE][NEXT_RELEASE] kind=${safeKind} nextReleaseAt=${target} waitMs=${waitMs}`,
    );
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

    store.dayKey = getTodayUsageDayKey();

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

    pruneStoredGlobalUsageEventsByWindow(store);
    recomputeGlobalUsageCounts(store);

    const rawAfterRead = localStorage.getItem(GLOBAL_USAGE_STORE_KEY);
    if (rawAfterRead) {
      try {
        const persisted = JSON.parse(rawAfterRead);
        const persistedMessageCount = Object.keys(persisted.events?.message || {}).length;
        const persistedUploadCount = Object.keys(persisted.events?.upload || {}).length;
        const currentMessageCount = Object.keys(store.events.message || {}).length;
        const currentUploadCount = Object.keys(store.events.upload || {}).length;
        if (persistedMessageCount !== currentMessageCount || persistedUploadCount !== currentUploadCount) {
          store.updatedAt = Date.now();
          localStorage.setItem(GLOBAL_USAGE_STORE_KEY, JSON.stringify(store));
        }
      } catch (error) {
        console.error('[GLOBAL_USAGE][PRUNE_PERSIST_FAILED]', error);
        appendGlobalUsageLog(
          `[GLOBAL_USAGE][PRUNE_PERSIST_FAILED] error_type=${error?.name || '-'} error=${error?.message || String(error)}`,
        );
      }
    }

    return store;
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
    scheduleGlobalUsageWindowRefresh();

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
    const windows = readGlobalUsageWindowMsFromConfig();
    const uploadWindowMs = windows.uploadWindowMs;
    const messageWindowMs = windows.messageWindowMs;

    const uploadResult = filterGlobalUsageEventsByWindow(store.events.upload, uploadWindowMs);
    const messageResult = filterGlobalUsageEventsByWindow(store.events.message, messageWindowMs);

    const uploadRecords = Object.values(uploadResult.filtered);
    const messageRecords = Object.values(messageResult.filtered);

    const uploadUsed = uploadRecords.length;
    const messageUsed = messageRecords.length;
    const uploadLimit = Number(store.uploadLimit) || 80;
    const messageLimit = Number(store.messageLimit) || 150;

    const uploadRemaining = Math.max(0, uploadLimit - uploadUsed);
    const messageRemaining = Math.max(0, messageLimit - messageUsed);

    const uploadNextReleaseAt = computeNextReleaseAtForWindowRecords(uploadRecords, uploadWindowMs, uploadRemaining);
    const messageNextReleaseAt = computeNextReleaseAtForWindowRecords(messageRecords, messageWindowMs, messageRemaining);

    if (uploadRemaining <= 0 && uploadNextReleaseAt > 0) {
      logGlobalUsageNextRelease('upload', uploadNextReleaseAt);
    }
    if (messageRemaining <= 0 && messageNextReleaseAt > 0) {
      logGlobalUsageNextRelease('message', messageNextReleaseAt);
    }

    const upload = {
      windowMs: uploadWindowMs,
      windowHours: windows.uploadWindowHours,
      maxFiles: uploadLimit,
      limit: uploadLimit,
      used: uploadUsed,
      remaining: uploadRemaining,
      canUpload: uploadRemaining > 0,
      records: uploadRecords,
      nextReleaseAt: uploadNextReleaseAt,
      source: 'global-usage',
      dayKey: store.dayKey,
    };

    const message = {
      windowMs: messageWindowMs,
      windowHours: windows.messageWindowHours,
      maxMessages: messageLimit,
      limit: messageLimit,
      used: messageUsed,
      remaining: messageRemaining,
      canSend: messageRemaining > 0,
      records: messageRecords,
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
    const windows = readGlobalUsageWindowMsFromConfig();
    const maxLines = Math.max(1, Math.min(500, Number(options.maxLines) || 50));
    const messageFiltered = filterGlobalUsageEventsByWindow(store.events.message, windows.messageWindowMs);
    const uploadFiltered = filterGlobalUsageEventsByWindow(store.events.upload, windows.uploadWindowMs);
    const messageEntries = Object.entries(messageFiltered.filtered)
      .map(([eventId, item]) => ({ kind: 'message', eventId, item, at: Number(item && item.at) || 0 }))
      .sort((a, b) => b.at - a.at);
    const uploadEntries = Object.entries(uploadFiltered.filtered)
      .map(([eventId, item]) => ({ kind: 'upload', eventId, item, at: Number(item && item.at) || 0 }))
      .sort((a, b) => b.at - a.at);

    return {
      dayKey: store.dayKey,
      uploadWindowHours: windows.uploadWindowHours,
      messageWindowHours: windows.messageWindowHours,
      messageUsed: messageEntries.length,
      uploadUsed: uploadEntries.length,
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
      `[GLOBAL_USAGE][EXPORT] windowHours=upload:${summary.uploadWindowHours}/message:${summary.messageWindowHours} `
      + `messageUsed=${summary.messageUsed}/${summary.messageLimit} uploadUsed=${summary.uploadUsed}/${summary.uploadLimit}`,
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

  function scheduleGlobalUsageWindowRefresh() {
    if (globalUsageWindowRefreshTimer) {
      clearTimeout(globalUsageWindowRefreshTimer);
      globalUsageWindowRefreshTimer = null;
    }

    const snapshot = getGlobalUsageQuotaSnapshot();
    const now = Date.now();
    const windows = readGlobalUsageWindowMsFromConfig();
    const candidates = [];

    [snapshot.upload, snapshot.message].forEach((quota, index) => {
      const windowMs = index === 0 ? windows.uploadWindowMs : windows.messageWindowMs;
      const nextReleaseAt = Number(quota && quota.nextReleaseAt) || 0;
      if (nextReleaseAt > now) {
        candidates.push(nextReleaseAt);
      }
      (Array.isArray(quota && quota.records) ? quota.records : []).forEach((item) => {
        const at = Number(item && item.at) || 0;
        if (at > 0) {
          const expiryAt = at + windowMs;
          if (expiryAt > now) {
            candidates.push(expiryAt);
          }
        }
      });
    });

    if (!candidates.length) {
      return;
    }

    const nextAt = Math.min(...candidates);
    const delayMs = Math.max(250, nextAt - now + 50);
    globalUsageWindowRefreshTimer = setTimeout(() => {
      globalUsageWindowRefreshTimer = null;
      notifyGlobalUsageChanged('window-expiry');
      scheduleGlobalUsageWindowRefresh();
    }, delayMs);
  }

  function initGlobalUsageSync() {
    if (globalUsageSyncInitialized) {
      return;
    }
    globalUsageSyncInitialized = true;

    scheduleGlobalUsageWindowRefresh();

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
    readGlobalUsageWindowMsFromConfig,
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
