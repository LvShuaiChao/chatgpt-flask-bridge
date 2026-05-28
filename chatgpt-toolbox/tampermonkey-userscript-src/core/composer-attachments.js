const ComposerAttachments = (() => {
  const deprecatedHitOnce = new Set();
  let composerAttachmentCanonicalLogKey = '';
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
    logCanonicalComposerAttachmentState(canonical);
    return canonical;
  }

  function getComposerAttachmentState(options = {}) {
    const useHeavy = options && options.heavy === true;
    let canonical = buildCanonicalComposerAttachmentState();

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

  function getSharedComposerAttachmentEvidence(reason = '', options = {}) {
    const reasonText = String(reason || options.reason || '').trim() || '-';
    const useHeavy = options.heavy === true;
    const canonical = getComposerAttachmentState({ heavy: useHeavy, reason: reasonText });

    let filenames = [];
    let snapshotCount = 0;
    let snapshotReadyCount = 0;
    let snapshotUploadingCount = 0;
    let snapshotHasAttachment = false;
    try {
      if (
        typeof ComposerApi !== 'undefined'
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

    const count = Math.max(
      0,
      Math.max(
        Number(
          canonical.uniqueCount != null
            ? canonical.uniqueCount
            : (canonical.attachmentCount != null ? canonical.attachmentCount : canonical.count)
        ) || 0,
        snapshotCount,
        Array.isArray(filenames) ? filenames.length : 0,
      ),
    );
    const uploadingCount = Math.max(
      0,
      Math.max(Number(canonical.uploadingCount) || 0, snapshotUploadingCount),
    );
    const readyCount = Math.max(
      0,
      Math.max(Number(canonical.readyCount) || 0, snapshotReadyCount, count > 0 && uploadingCount === 0 ? count : 0),
    );
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

    const evidence = {
      hasAttachment,
      count,
      readyCount: hasAttachment && uploadingCount === 0 ? Math.max(readyCount, count) : readyCount,
      uploadingCount,
      textLen,
      filenames,
      source: String(canonical._unified_source || canonical.source || 'composer-attachments'),
    };

    const logKey = [
      reasonText,
      evidence.count,
      evidence.readyCount,
      evidence.uploadingCount,
      evidence.textLen,
      evidence.hasAttachment ? 1 : 0,
    ].join('|');

    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      if (typeof ToolboxShell.appendLogIfChanged === 'function') {
        ToolboxShell.appendLogIfChanged(
          `SHARED_COMPOSER:ATTACHMENT_EVIDENCE:${reasonText}`,
          logKey,
          `[SHARED_COMPOSER][ATTACHMENT_EVIDENCE] reason=${reasonText} count=${evidence.count} `
          + `ready=${evidence.readyCount} uploading=${evidence.uploadingCount} textLen=${evidence.textLen} `
          + `hasAttachment=${evidence.hasAttachment ? 1 : 0}`,
          1200,
        );
      } else {
        ToolboxShell.appendLog(
          `[SHARED_COMPOSER][ATTACHMENT_EVIDENCE] reason=${reasonText} count=${evidence.count} `
          + `ready=${evidence.readyCount} uploading=${evidence.uploadingCount} textLen=${evidence.textLen} `
          + `hasAttachment=${evidence.hasAttachment ? 1 : 0}`,
        );
      }
    }

    return evidence;
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

