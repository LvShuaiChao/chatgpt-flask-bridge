const ComposerAttachments = (() => {
  const deprecatedHitOnce = new Set();
  let composerAttachmentCanonicalLogKey = '';
  const attachmentEvidenceCache = {
    ts: 0,
    result: null,
    reason: '',
    logKey: '',
  };
  let attachmentDirty = true;
  let attachmentMutationObserver = null;
  let attachmentMutationObserverRoot = null;
  let lastAttachmentHeavyScanAt = 0;
  let sharedEvidenceInFlight = false;
  const UPLOAD_EVIDENCE_CACHE_MS = 500;
  const UPLOAD_HEAVY_SCAN_MIN_MS = 500;
  const UPLOAD_ATTACHMENT_DIRTY_FALLBACK_MS = 1000;
  const ATTACHMENT_EVIDENCE_FAST_CACHE_MS = 800;
  const ATTACHMENT_EVIDENCE_BACKGROUND_CACHE_MS = 2500;

  function shouldUseCachedAttachmentEvidence(reason, options = {}) {
    if (options && options.forceRefresh === true) {
      return false;
    }
    const reasonText = String(reason || '');
    if (
      reasonText.includes('after-send')
      || reasonText.includes('confirm-send')
      || reasonText.includes('upload-start')
      || reasonText.includes('upload-finish')
      || reasonText.includes('autoq-bypass-pre-send-button-wait')
      || reasonText.includes('send-initial-composer-stage')
      || reasonText.includes('autoq-payload')
      || reasonText.includes('before-write')
      || reasonText.includes('after-write')
      || reasonText.includes('immediate-prompt-write')
      || reasonText.includes('send-button-wait')
      || reasonText.includes('real-upload-running-check')
    ) {
      return false;
    }
    return true;
  }

  function isUploadLightModeActive() {
    return (
      typeof UploadCriticalRuntime !== 'undefined'
      && UploadCriticalRuntime
      && typeof UploadCriticalRuntime.isUploadLightMode === 'function'
      && UploadCriticalRuntime.isUploadLightMode()
    );
  }

  function isUploadInProgressActive() {
    return (
      typeof UploadCriticalRuntime !== 'undefined'
      && UploadCriticalRuntime
      && typeof UploadCriticalRuntime.isUploadInProgress === 'function'
      && UploadCriticalRuntime.isUploadInProgress()
    );
  }

  function markAttachmentDirty(reason = '') {
    attachmentDirty = true;
    attachmentEvidenceCache.ts = 0;
    if (
      reason
      && isUploadLightModeActive()
      && typeof UploadCriticalRuntime.logUploadTagThrottled === 'function'
    ) {
      UploadCriticalRuntime.logUploadTagThrottled(
        'COMPOSER:ATTACHMENT_DIRTY',
        `[COMPOSER][ATTACHMENT_DIRTY] reason=${String(reason || '-')}`,
        1500,
      );
    }
  }

  function ensureAttachmentMutationObserver() {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') {
      return;
    }
    let composerRoot = null;
    try {
      if (
        typeof ComposerApi !== 'undefined'
        && ComposerApi
        && typeof ComposerApi.getComposerRoot === 'function'
      ) {
        composerRoot = ComposerApi.getComposerRoot();
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] ensureAttachmentMutationObserver getComposerRoot failed', err);
    }
    if (!(composerRoot instanceof HTMLElement)) {
      return;
    }
    if (attachmentMutationObserver && attachmentMutationObserverRoot === composerRoot) {
      return;
    }
    if (attachmentMutationObserver) {
      try {
        attachmentMutationObserver.disconnect();
      } catch (disconnectErr) {
        console.error('[ChatGPT toolbox] attachmentMutationObserver disconnect failed', disconnectErr);
      }
      attachmentMutationObserver = null;
      attachmentMutationObserverRoot = null;
    }
    attachmentMutationObserverRoot = composerRoot;
    attachmentMutationObserver = new MutationObserver(() => {
      markAttachmentDirty('mutation-observer');
    });
    attachmentMutationObserver.observe(composerRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'data-state', 'class'],
    });
  }

  function shouldRunHeavyAttachmentScan(options = {}) {
    const forceHeavy = options.heavy === true;
    if (!isUploadInProgressActive()) {
      return forceHeavy;
    }
    const now = Date.now();
    if (attachmentDirty || forceHeavy) {
      if (now - lastAttachmentHeavyScanAt >= UPLOAD_HEAVY_SCAN_MIN_MS) {
        return true;
      }
    }
    if (now - lastAttachmentHeavyScanAt >= UPLOAD_ATTACHMENT_DIRTY_FALLBACK_MS) {
      return true;
    }
    return false;
  }
  function appendDeprecatedHit(tag, detail = '') {
    const key = `${String(tag || '').trim()}|${String(detail || '').trim()}`;
    if (deprecatedHitOnce.has(key)) {
      return;
    }
    deprecatedHitOnce.add(key);
    const line = `[DEPRECATED_HIT] tag=${tag}${detail ? ` detail=${detail}` : ''}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.warn(line);
    }
  }

  function toFiniteCount(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
  }

  function logCanonicalComposerAttachmentState(state) {
    const key = [
      state.totalCount,
      state.uniqueCount,
      state.uploadingCount,
      state.readyCount,
      state.hasAny ? 1 : 0,
      state.hasReady ? 1 : 0,
    ].join('|');
    if (key === composerAttachmentCanonicalLogKey) {
      return;
    }
    composerAttachmentCanonicalLogKey = key;
    const line = `[STATE_SCHEMA][COMPOSER_ATTACHMENT_CANONICAL] totalCount=${state.totalCount} uploadingCount=${state.uploadingCount} readyCount=${state.readyCount} hasAny=${state.hasAny ? 1 : 0} hasReady=${state.hasReady ? 1 : 0}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      if (typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(
          'STATE_SCHEMA:COMPOSER_ATTACHMENT_CANONICAL',
          key,
          line,
          1500,
        );
      } else {
        ToolboxShell.appendLog(line);
      }
    } else {
      console.log(line);
    }
  }

  function buildCanonicalComposerAttachmentState(raw = {}) {
    const input = raw && typeof raw === 'object' ? raw : {};
    let totalCount = toFiniteCount(
      input.totalCount != null
        ? input.totalCount
        : (input.rawCount != null
          ? input.rawCount
          : (input.count != null
            ? input.count
            : (input.fileCount != null
              ? input.fileCount
              : (input.attachmentCount != null
                ? input.attachmentCount
                : input.attachment_count)))),
    );
    let uniqueCount = toFiniteCount(
      input.uniqueCount != null
        ? input.uniqueCount
        : (input.attachmentCount != null
          ? input.attachmentCount
          : (input.attachment_count != null
            ? input.attachment_count
            : (input.count != null
              ? input.count
              : input.fileCount))),
    );
    let uploadingCount = toFiniteCount(
      input.uploadingCount != null
        ? input.uploadingCount
        : (input.attachmentUploadingCount != null
          ? input.attachmentUploadingCount
          : (input.attachmentUploading === true
            ? 1
            : (input.attachment_uploading_count != null
              ? input.attachment_uploading_count
              : 0))),
    );
    let readyCount = toFiniteCount(
      input.readyCount != null
        ? input.readyCount
        : (input.hasReady === true
          ? uniqueCount
          : (input.attachmentReady === true
            ? Math.max(uniqueCount, 1)
            : 0)),
    );

    if (input.hasAttachment === true || input.hasAny === true) {
      uniqueCount = Math.max(uniqueCount, 1);
    }
    if (input.hasAttachmentChip === true || input.hasCards === true) {
      totalCount = Math.max(totalCount, 1);
      uniqueCount = Math.max(uniqueCount, 1);
    }
    if (input.stillUploading === true) {
      uploadingCount = Math.max(uploadingCount, 1);
    }

    totalCount = Math.max(totalCount, uniqueCount, uploadingCount);
    readyCount = Math.min(
      Math.max(readyCount, uniqueCount > 0 && uploadingCount === 0 ? uniqueCount : readyCount),
      Math.max(uniqueCount, totalCount),
    );

    const hasAny = totalCount > 0 || uniqueCount > 0;
    const hasUploading = uploadingCount > 0;
    const hasReady = readyCount > 0;
    const hasComposerPayload = Boolean(
      input.hasComposerPayload === true
      || input.has_composer_payload === true
      || hasAny
      || hasUploading
    );

    const canonical = {
      totalCount,
      uniqueCount,
      uploadingCount,
      readyCount,
      hasAny,
      hasUploading,
      hasReady,
      hasComposerPayload,
      attachmentCount: uniqueCount,
      hasAttachment: hasAny,
      attachmentUploading: hasUploading,
      count: uniqueCount,
      fileCount: uniqueCount,
      rawCount: totalCount,
      attachment_count: uniqueCount,
      has_composer_payload: hasComposerPayload,
    };
    return canonical;
  }

  function applyCanonicalAttachmentNormalization(canonical, snap = {}) {
    const base = canonical && typeof canonical === 'object' ? canonical : {};
    const snapInput = snap && typeof snap === 'object' ? snap : {};
    const rawDiagnostic = Math.max(
      0,
      Number(base._rawDomCount) || 0,
      Number(base.rawCount) || 0,
      Number(base.totalCount) || 0,
      Number(snapInput.rawCount) || 0,
      Number(snapInput.count) || 0,
      Number(snapInput.fileCount) || 0,
    );
    const normalizedMeta = normalizeSharedAttachmentCount(rawDiagnostic, base, snapInput);
    const normalized = Math.max(0, Number(normalizedMeta.normalizedCount) || 0);
    if (normalized <= 0 && rawDiagnostic <= 0) {
      return base;
    }

    const uploadingCount = Math.max(0, Number(base.uploadingCount) || 0);
    const readyCount = uploadingCount > 0
      ? 0
      : Math.max(normalized, Number(base.readyCount) || 0);

    const next = buildCanonicalComposerAttachmentState({
      ...base,
      totalCount: normalized,
      uniqueCount: normalized,
      attachmentCount: normalized,
      fileCount: normalized,
      count: normalized,
      attachment_count: normalized,
      uploadingCount,
      readyCount,
      hasAny: normalized > 0,
      hasAttachment: normalized > 0,
      hasReady: readyCount > 0,
      rawCount: rawDiagnostic,
      _rawDomCount: rawDiagnostic,
    });

    if (rawDiagnostic !== normalized) {
      const line = `[STATE_SCHEMA][COMPOSER_ATTACHMENT_CANONICAL_NORMALIZED] raw=${rawDiagnostic} normalized=${normalized} totalCount=${next.totalCount} readyCount=${next.readyCount} hasAny=${next.hasAny ? 1 : 0} hasReady=${next.hasReady ? 1 : 0}`;
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(
          'STATE_SCHEMA:COMPOSER_ATTACHMENT_CANONICAL_NORMALIZED',
          `${rawDiagnostic}|${normalized}|${next.readyCount}`,
          line,
          1500,
        );
      } else if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(line);
      } else {
        console.log(line);
      }
    }

    return next;
  }

  function getComposerAttachmentState(options = {}) {
    ensureAttachmentMutationObserver();
    const requestedHeavy = options && options.heavy === true;
    const useHeavy = shouldRunHeavyAttachmentScan({ heavy: requestedHeavy });
    const scanStartedAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    let canonical = buildCanonicalComposerAttachmentState();
    let snapForNormalize = {};

    try {
      if (
        typeof ComposerApi !== 'undefined'
        && ComposerApi
        && typeof ComposerApi.getUniqueComposerAttachmentSnapshot === 'function'
      ) {
        const snap = ComposerApi.getUniqueComposerAttachmentSnapshot({
          heavy: useHeavy,
          reason: 'composer-attachments-state',
        }) || {};
        snapForNormalize = snap;
        canonical = buildCanonicalComposerAttachmentState(snap);
      } else if (
        typeof ComposerApi !== 'undefined'
        && ComposerApi
        && typeof ComposerApi.getComposerUploadSnapshot === 'function'
      ) {
        const snap = ComposerApi.getComposerUploadSnapshot({
          requireSendReady: false,
          expectedNames: Array.isArray(options.expectedNames) ? options.expectedNames : [],
        }) || {};
        snapForNormalize = snap;
        canonical = buildCanonicalComposerAttachmentState({
          totalCount: Array.isArray(snap.cards) ? snap.cards.length : 0,
          uniqueCount: Array.isArray(snap.cards) ? snap.cards.length : 0,
          uploadingCount: snap.stillUploading ? 1 : 0,
          readyCount: snap.attachmentReady ? Math.max(Array.isArray(snap.cards) ? snap.cards.length : 0, 1) : 0,
          hasAttachmentChip: snap.hasAttachmentChip,
          hasCards: snap.hasCards,
          stillUploading: snap.stillUploading,
          attachmentReady: snap.attachmentReady,
        });
      } else {
        let attachmentCount = 0;
        if (typeof ComposerApi !== 'undefined' && ComposerApi) {
          if (useHeavy && typeof ComposerApi.countAttachmentChips === 'function') {
            attachmentCount = Number(ComposerApi.countAttachmentChips()) || 0;
          } else if (typeof ComposerApi.countAttachmentChipsFast === 'function') {
            attachmentCount = Number(ComposerApi.countAttachmentChipsFast()) || 0;
          } else if (typeof ComposerApi.countAttachmentChips === 'function') {
            attachmentCount = Number(ComposerApi.countAttachmentChips()) || 0;
          }
        }
        snapForNormalize = { count: attachmentCount, fileCount: attachmentCount };
        canonical = buildCanonicalComposerAttachmentState({
          totalCount: attachmentCount,
          uniqueCount: attachmentCount,
          readyCount: attachmentCount,
        });
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] ComposerAttachments.getComposerAttachmentState failed', err);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[COMPOSER_ATTACHMENTS][STATE_FAILED] error=${err && err.message ? err.message : String(err)}`
        );
      }
    }

    canonical = applyCanonicalAttachmentNormalization(canonical, snapForNormalize);
    if (!isUploadLightModeActive()) {
      logCanonicalComposerAttachmentState(canonical);
    }
    if (useHeavy) {
      lastAttachmentHeavyScanAt = Date.now();
      attachmentDirty = false;
    }
    const scanCost = (
      (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now()
    ) - scanStartedAt;
    if (
      typeof UploadCriticalRuntime !== 'undefined'
      && UploadCriticalRuntime
      && typeof UploadCriticalRuntime.recordUploadPerfBlock === 'function'
    ) {
      UploadCriticalRuntime.recordUploadPerfBlock('attachment-scan', scanCost);
    }
    return canonical;
  }

  function isAttachmentStillUploading(options = {}) {
    return getComposerAttachmentState(options).attachmentUploading === true;
  }

  function hasComposerAttachmentPayload(options = {}) {
    return getComposerAttachmentState(options).hasComposerPayload === true;
  }

  async function waitNativeUploadSettled(options = {}) {
    const timeoutMs = Math.max(0, Number(options.timeoutMs) || 10000);
    const intervalMs = Math.max(50, Number(options.intervalMs) || 150);
    const startedAt = Date.now();
    const signal = options.signal;
    const isCancelled = typeof options.isCancelled === 'function'
      ? options.isCancelled
      : () => !!(signal && signal.aborted);

    while (Date.now() - startedAt <= timeoutMs) {
      if (isCancelled()) {
        return { ok: false, cancelled: true, reason: 'cancelled' };
      }
      if (!isAttachmentStillUploading({ heavy: true })) {
        return { ok: true, reason: 'settled' };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { ok: false, reason: 'timeout_wait_native_upload_settled' };
  }

  function detectNativeUploadError() {
    try {
      if (typeof ComposerApi.getAttachmentUploadErrorText === 'function') {
        const text = String(ComposerApi.getAttachmentUploadErrorText() || '').trim();
        if (text) {
          return { hasError: true, errorText: text };
        }
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] detectNativeUploadError failed', err);
    }
    return { hasError: false, errorText: '' };
  }

  function getComposerAttachmentStateDeprecated(options = {}) {
    appendDeprecatedHit('upload.getComposerAttachmentState', 'redirect=composer-attachments');
    return getComposerAttachmentState(options);
  }

  function collectComposerAttachmentCardsNormalized(root) {
    const cards = new Set();
    const scope = root instanceof HTMLElement
      ? root
      : (typeof document !== 'undefined' ? document : null);

    if (!scope) {
      return [];
    }

    const removeButtons = scope.querySelectorAll(
      '[aria-label*="移除文件"], [aria-label*="Remove file"], [aria-label*="remove file"], [aria-label*="删除文件"]',
    );

    for (const btn of removeButtons) {
      if (!(btn instanceof HTMLElement)) {
        continue;
      }
      const card = btn.closest('[data-testid], li, article, [role="listitem"]');
      if (card instanceof HTMLElement) {
        cards.add(card);
      }
    }

    if (cards.size > 0) {
      return Array.from(cards);
    }

    if (removeButtons.length > 0) {
      return Array.from(removeButtons);
    }

    return [];
  }

  function normalizeSharedAttachmentCount(rawCount, canonical = {}, snapshot = {}) {
    const raw = Math.max(
      0,
      Number(rawCount) || 0,
      Number(canonical.rawCount) || 0,
      Number(canonical.totalCount) || 0,
      Number(snapshot.rawCount) || 0,
      Number(snapshot.count) || 0,
      Number(snapshot.fileCount) || 0,
    );

    let normalized = Math.max(
      0,
      Number(canonical.uniqueCount) || 0,
      Number(canonical.fileCount) || 0,
      Number(snapshot.uniqueCount) || 0,
      Number(snapshot.fileCount) || 0,
    );

    let method = 'canonical-snapshot';

    try {
      const composerRoot = typeof ComposerApi !== 'undefined'
        && ComposerApi
        && typeof ComposerApi.getComposerRoot === 'function'
          ? ComposerApi.getComposerRoot()
          : null;
      const dedupedCards = collectComposerAttachmentCardsNormalized(composerRoot);
      if (dedupedCards.length > 0) {
        normalized = dedupedCards.length;
        method = 'remove-button-card-dedupe';
      } else if (
        typeof ComposerApi !== 'undefined'
        && ComposerApi
        && typeof ComposerApi.countAttachmentChipsFast === 'function'
      ) {
        const fastCount = Number(ComposerApi.countAttachmentChipsFast()) || 0;
        if (fastCount > 0) {
          normalized = fastCount;
          method = 'countAttachmentChipsFast';
        }
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] normalizeSharedAttachmentCount failed', err);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[SHARED_COMPOSER][ATTACHMENT_COUNT_NORMALIZE_FAILED] error=${err && err.message ? err.message : String(err)}`,
        );
      }
    }

    if (normalized <= 0 && raw > 0) {
      normalized = 1;
      method = `${method}-fallback-single`;
    }

    normalized = Math.max(0, Math.min(normalized, raw > 0 ? raw : normalized));

    return {
      rawCount: raw,
      normalizedCount: normalized,
      method,
    };
  }

  function getSharedComposerAttachmentEvidence(reason = '', options = {}) {
    const reasonText = String(reason || options.reason || '').trim() || '-';
    if (sharedEvidenceInFlight) {
      if (attachmentEvidenceCache.result) {
        return attachmentEvidenceCache.result;
      }
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(`[SHARED_COMPOSER][ATTACHMENT_EVIDENCE_REENTER_SKIP] reason=${reasonText}`);
      }
      return {
        hasAttachment: false,
        count: 0,
        rawCount: 0,
        normalizedCount: 0,
        readyCount: 0,
        uploadingCount: 0,
        textLen: 0,
        filenames: [],
        source: 'reenter-skip',
      };
    }
    const uploadInProgress = isUploadInProgressActive();
    const requestedHeavy = options.heavy === true;
    const useHeavy = shouldRunHeavyAttachmentScan({ heavy: requestedHeavy });
    const now = Date.now();
    const throttled = !!(
      (typeof BrowserRuntimeHealth !== 'undefined'
        && BrowserRuntimeHealth
        && typeof BrowserRuntimeHealth.isProbablyThrottled === 'function'
        && BrowserRuntimeHealth.isProbablyThrottled())
      || (typeof document !== 'undefined' && document.hidden)
    );
    const cacheTtl = throttled
      ? ATTACHMENT_EVIDENCE_BACKGROUND_CACHE_MS
      : ATTACHMENT_EVIDENCE_FAST_CACHE_MS;

    if (
      shouldUseCachedAttachmentEvidence(reasonText, options)
      && attachmentEvidenceCache
      && attachmentEvidenceCache.result
      && now - Number(attachmentEvidenceCache.ts || 0) <= cacheTtl
    ) {
      const cached = Object.assign({}, attachmentEvidenceCache.result);
      cached.reason = String(reasonText || cached.reason || '');
      cached.cacheHit = true;

      let domAttachCount = -1;
      try {
        if (
          typeof ComposerApi !== 'undefined'
          && ComposerApi
          && typeof ComposerApi.countAttachmentChipsFast === 'function'
        ) {
          domAttachCount = Math.max(0, Number(ComposerApi.countAttachmentChipsFast()) || 0);
        } else if (
          typeof ComposerApi !== 'undefined'
          && ComposerApi
          && typeof ComposerApi.countAttachmentChips === 'function'
        ) {
          domAttachCount = Math.max(0, Number(ComposerApi.countAttachmentChips()) || 0);
        }
      } catch (domCountErr) {
        console.error('[ChatGPT toolbox] attachment cache stale DOM recount failed', domCountErr);
      }

      if (
        domAttachCount >= 0
        && Number(cached.count || 0) > 0
        && domAttachCount === 0
      ) {
        if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[COMPOSER][ATTACHMENT_CACHE_STALE_IGNORED] reason=${reasonText} `
            + `cachedCount=${cached.count} domCount=${domAttachCount} action=clear-cache-before-send`,
          );
        }
        attachmentEvidenceCache.ts = 0;
        attachmentEvidenceCache.result = null;
        attachmentEvidenceCache.reason = '';
        cached.count = 0;
        cached.rawCount = 0;
        cached.normalizedCount = 0;
        cached.readyCount = 0;
        cached.uploadingCount = 0;
        cached.hasAttachment = false;
        cached.filenames = [];
        cached.source = `${cached.source || 'cache'}-stale-dom-cleared`;
        attachmentEvidenceCache.result = Object.assign({}, cached);
        attachmentEvidenceCache.ts = now;
      }

      if (
        typeof ToolboxShell !== 'undefined'
        && typeof ToolboxShell.appendLogIfChanged === 'function'
      ) {
        ToolboxShell.appendLogIfChanged(
          `SHARED_COMPOSER:ATTACHMENT_EVIDENCE_CACHE:${reasonText}`,
          `${cached.count}|${cached.readyCount}|${cached.uploadingCount}|${cached.textLen}|${cached.hasAttachment ? 1 : 0}`,
          `[SHARED_COMPOSER][ATTACHMENT_EVIDENCE_CACHE_HIT] reason=${reasonText} `
          + `count=${cached.count} ready=${cached.readyCount} uploading=${cached.uploadingCount} `
          + `textLen=${cached.textLen} hasAttachment=${cached.hasAttachment ? 1 : 0} ttl=${cacheTtl}`,
          3000,
        );
      }
      return cached;
    }

    if (uploadInProgress && attachmentEvidenceCache.result) {
      const ageMs = now - Number(attachmentEvidenceCache.ts || 0);
      if (ageMs >= 0 && ageMs < UPLOAD_EVIDENCE_CACHE_MS) {
        if (
          typeof UploadCriticalRuntime !== 'undefined'
          && UploadCriticalRuntime
          && typeof UploadCriticalRuntime.logUploadTagThrottled === 'function'
        ) {
          UploadCriticalRuntime.logUploadTagThrottled(
            `SHARED_COMPOSER:ATTACHMENT_EVIDENCE_CACHE_HIT:${reasonText}`,
            `[SHARED_COMPOSER][ATTACHMENT_EVIDENCE_CACHE_HIT] reason=${reasonText} ageMs=${ageMs}`,
            3000,
          );
        }
        return attachmentEvidenceCache.result;
      }
    }

    sharedEvidenceInFlight = true;
    const evidenceStartedAt = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    try {
    const canonical = getComposerAttachmentState({ heavy: useHeavy, reason: reasonText });

    let filenames = [];
    let snapshotCount = 0;
    let snapshotReadyCount = 0;
    let snapshotUploadingCount = 0;
    let snapshotHasAttachment = false;
    try {
      if (
        (useHeavy || !uploadInProgress)
        && typeof ComposerApi !== 'undefined'
        && ComposerApi
        && typeof ComposerApi.getComposerAttachmentSnapshot === 'function'
      ) {
        const snap = ComposerApi.getComposerAttachmentSnapshot(`shared-evidence:${reasonText}`) || {};
        snapshotCount = Math.max(
          0,
          Number(
            snap.count != null
              ? snap.count
              : (snap.fileCount != null ? snap.fileCount : (Array.isArray(snap.items) ? snap.items.length : 0))
          ) || 0,
        );
        snapshotReadyCount = Math.max(
          0,
          Number(
            snap.readyCount != null
              ? snap.readyCount
              : (snap.hasReadyAttachment === true ? snapshotCount : 0)
          ) || 0,
        );
        snapshotUploadingCount = Math.max(
          0,
          Number(
            snap.uploadingCount != null
              ? snap.uploadingCount
              : (snap.hasUploadingAttachment === true ? Math.max(1, snapshotCount - snapshotReadyCount) : 0)
          ) || 0,
        );
        snapshotHasAttachment = snapshotCount > 0
          || snap.hasAnyAttachment === true
          || snap.hasReadyAttachment === true;
        if (Array.isArray(snap.filenames)) {
          filenames = snap.filenames.filter(Boolean).map((name) => String(name));
        } else if (Array.isArray(snap.items)) {
          filenames = snap.items
            .map((item) => (item && item.name ? String(item.name) : ''))
            .filter(Boolean);
        }
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] getSharedComposerAttachmentEvidence snapshot failed', err);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[SHARED_COMPOSER][ATTACHMENT_EVIDENCE][SNAPSHOT_FAILED] reason=${reasonText} `
          + `error=${err && err.message ? err.message : String(err)}`,
        );
      }
    }

    const rawCount = Math.max(
      0,
      Number(canonical._rawDomCount) || 0,
      Number(canonical.rawCount) || 0,
      snapshotCount,
      Array.isArray(filenames) ? filenames.length : 0,
    );
    const normalizedMeta = normalizeSharedAttachmentCount(rawCount, canonical, {
      rawCount: snapshotCount,
      count: snapshotCount,
      fileCount: snapshotCount,
      uniqueCount: snapshotReadyCount,
    });
    const count = normalizedMeta.normalizedCount;
    const rawReadyCount = Math.max(
      0,
      Number(canonical.readyCount) || 0,
      snapshotReadyCount,
    );
    const rawUploadingCount = Math.max(
      0,
      Number(canonical.uploadingCount) || 0,
      snapshotUploadingCount,
    );
    const normalizedUploadingCount = count > 0
      ? Math.min(rawUploadingCount, count)
      : rawUploadingCount;
    const normalizedReadyCount = count > 0 && normalizedUploadingCount === 0
      ? count
      : 0;
    const hasAttachment = count > 0
      || canonical.hasAttachment === true
      || canonical.hasAny === true
      || snapshotHasAttachment === true;

    let textLen = 0;
    try {
      if (typeof ComposerApi !== 'undefined' && ComposerApi && typeof ComposerApi.getComposerText === 'function') {
        textLen = String(ComposerApi.getComposerText() || '').trim().length;
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] getSharedComposerAttachmentEvidence textLen failed', err);
    }

    const businessCount = normalizedMeta.normalizedCount;
    const evidence = {
      hasAttachment: businessCount > 0 || hasAttachment,
      count: businessCount,
      rawCount: normalizedMeta.rawCount,
      normalizedCount: businessCount,
      countMethod: normalizedMeta.method,
      ready: normalizedReadyCount,
      readyCount: normalizedReadyCount,
      rawReadyCount,
      uploading: normalizedUploadingCount,
      uploadingCount: normalizedUploadingCount,
      textLen,
      filenames,
      source: String(canonical._unified_source || canonical.source || 'composer-attachments'),
    };

    const normalizedChanged = normalizedMeta.rawCount > 1
      && normalizedMeta.normalizedCount !== normalizedMeta.rawCount;
    const logKey = [
      reasonText,
      evidence.count,
      evidence.readyCount,
      evidence.uploadingCount,
      evidence.textLen,
      evidence.hasAttachment ? 1 : 0,
    ].join('|');

    if (normalizedChanged) {
      const normalizedLine = `[SHARED_COMPOSER][ATTACHMENT_COUNT_NORMALIZED] raw=${normalizedMeta.rawCount} `
        + `normalized=${normalizedMeta.normalizedCount} method=${normalizedMeta.method}`;
      if (
        uploadInProgress
        && typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.logUploadTagThrottled === 'function'
      ) {
        UploadCriticalRuntime.logUploadTagThrottled(
          `SHARED_COMPOSER:ATTACHMENT_COUNT_NORMALIZED:${reasonText}`,
          normalizedLine,
          1000,
        );
      } else if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(
          `SHARED_COMPOSER:ATTACHMENT_COUNT_NORMALIZED:${reasonText}`,
          `${normalizedMeta.rawCount}|${normalizedMeta.normalizedCount}`,
          normalizedLine,
          1500,
        );
      } else if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(normalizedLine);
      }
    }

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      const evidenceLine = `[SHARED_COMPOSER][ATTACHMENT_EVIDENCE] reason=${reasonText} count=${evidence.count} `
        + `ready=${evidence.ready} uploading=${evidence.uploading} textLen=${evidence.textLen} `
        + `hasAttachment=${evidence.hasAttachment ? 1 : 0}`
        + (normalizedMeta.rawCount > evidence.count
          ? ` rawCount=${normalizedMeta.rawCount} rawReady=${rawReadyCount}`
          : '');
      if (
        uploadInProgress
        && typeof UploadCriticalRuntime !== 'undefined'
        && UploadCriticalRuntime
        && typeof UploadCriticalRuntime.logUploadTagThrottled === 'function'
      ) {
        if (logKey !== attachmentEvidenceCache.logKey) {
          UploadCriticalRuntime.logUploadTagThrottled(
            `SHARED_COMPOSER:ATTACHMENT_EVIDENCE:${reasonText}`,
            evidenceLine,
            1000,
          );
          attachmentEvidenceCache.logKey = logKey;
        }
      } else if (typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(
          `SHARED_COMPOSER:ATTACHMENT_EVIDENCE:${reasonText}`,
          logKey,
          evidenceLine,
          1200,
        );
      } else {
        ToolboxShell.appendLog(evidenceLine);
      }
    }

    attachmentEvidenceCache.ts = now;
    attachmentEvidenceCache.result = evidence;
    attachmentEvidenceCache.reason = reasonText;

    const evidenceCost = (
      (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now()
    ) - evidenceStartedAt;
    if (
      typeof UploadCriticalRuntime !== 'undefined'
      && UploadCriticalRuntime
      && typeof UploadCriticalRuntime.recordUploadPerfBlock === 'function'
    ) {
      UploadCriticalRuntime.recordUploadPerfBlock('attachment-evidence', evidenceCost);
    }

    return evidence;
    } catch (err) {
      console.error('[ChatGPT toolbox] getSharedComposerAttachmentEvidence failed', err);
      if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[SHARED_COMPOSER][ATTACHMENT_EVIDENCE][FAILED] reason=${reasonText} `
          + `error=${err && err.message ? err.message : String(err)}`,
        );
      }
      return {
        hasAttachment: false,
        count: 0,
        rawCount: 0,
        normalizedCount: 0,
        readyCount: 0,
        uploadingCount: 0,
        textLen: 0,
        filenames: [],
        source: 'evidence-error',
      };
    } finally {
      sharedEvidenceInFlight = false;
    }
  }

  return {
    getComposerAttachmentState,
    getSharedComposerAttachmentEvidence,
    isAttachmentStillUploading,
    hasComposerAttachmentPayload,
    waitNativeUploadSettled,
    detectNativeUploadError,
    getComposerAttachmentStateDeprecated,
  };
})();

