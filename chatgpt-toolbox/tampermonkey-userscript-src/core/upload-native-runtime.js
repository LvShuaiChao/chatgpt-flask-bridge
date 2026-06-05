const UploadNativeRuntime = (() => {
  function sleepMs(ms) {
    if (typeof sleep === 'function') {
      return sleep(ms);
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function appendRuntimeLog(line) {
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.log(line);
    }
  }

  function buildExpectedNames(files) {
    const cleanFiles = (files || []).filter(Boolean);
    if (typeof buildUploadEvidenceNames === 'function') {
      return buildUploadEvidenceNames(
        null,
        cleanFiles.map((file) => file && file.name).filter(Boolean),
      );
    }
    return cleanFiles.map((file) => file && file.name).filter(Boolean);
  }

  function getFileNames(files) {
    return (files || []).filter(Boolean).map((file) => file && file.name).filter(Boolean).join('|');
  }

  function getNativeUploadError(options = {}) {
    if (typeof options.detectNativeUploadError === 'function') {
      return options.detectNativeUploadError();
    }
    if (
      typeof ComposerApi !== 'undefined'
      && ComposerApi
      && typeof ComposerApi.detectChatGPTNativeUploadError === 'function'
    ) {
      return ComposerApi.detectChatGPTNativeUploadError();
    }
    if (
      typeof ComposerAttachments !== 'undefined'
      && ComposerAttachments
      && typeof ComposerAttachments.detectNativeUploadError === 'function'
    ) {
      const pick = ComposerAttachments.detectNativeUploadError();
      if (pick && pick.hasError) {
        return {
          ok: false,
          reason: 'native-upload-failed',
          message: String(pick.errorText || '').slice(0, 500),
        };
      }
    }
    return null;
  }

  function isAttachmentStillUploading(expectedNames) {
    if (
      typeof ComposerApi !== 'undefined'
      && ComposerApi
      && typeof ComposerApi.isAttachmentStillUploading === 'function'
    ) {
      return !!ComposerApi.isAttachmentStillUploading({ expectedNames });
    }
    if (
      typeof ComposerAttachments !== 'undefined'
      && ComposerAttachments
      && typeof ComposerAttachments.isAttachmentStillUploading === 'function'
    ) {
      return !!ComposerAttachments.isAttachmentStillUploading({ heavy: true, expectedNames });
    }
    return false;
  }

  function hasAttachmentChip() {
    if (
      typeof ComposerAttachments !== 'undefined'
      && ComposerAttachments
      && typeof ComposerAttachments.getComposerAttachmentState === 'function'
    ) {
      const state = ComposerAttachments.getComposerAttachmentState({ heavy: true });
      return !!(state && (state.hasAny || state.hasAttachment || Number(state.attachmentCount || 0) > 0));
    }
    if (
      typeof ComposerApi !== 'undefined'
      && ComposerApi
      && typeof ComposerApi.countAttachmentChipsFast === 'function'
    ) {
      return ComposerApi.countAttachmentChipsFast() > 0;
    }
    if (
      typeof ComposerApi !== 'undefined'
      && ComposerApi
      && typeof ComposerApi.countAttachmentChips === 'function'
    ) {
      return ComposerApi.countAttachmentChips() > 0;
    }
    return true;
  }

  async function waitChatGPTNativeUploadSettled(files, options = {}) {
    const startedAt = Date.now();
    const reason = String(options.reason || '').trim();
    const timeoutMs = Math.max(60000, Number(options.timeoutMs) || 120000);
    const pollMs = Number(options.pollMs) || 500;
    const intervalMs = pollMs;
    const stableMs = Math.max(500, Math.min(1500, Number(options.stableMs) || 900));
    const requireSendReady = options.requireSendReady === undefined
      ? true
      : options.requireSendReady === true;
    const signal = options.signal;
    const isCancelled = typeof options.isCancelled === 'function'
      ? options.isCancelled
      : () => !!(signal && signal.aborted);
    const expectedNames = Array.isArray(options.expectedNames) && options.expectedNames.length > 0
      ? options.expectedNames
      : buildExpectedNames(files);
    const fileNames = getFileNames(files);
    const fileCount = (files || []).filter(Boolean).length;

    console.log('[UPLOAD_NATIVE_RUNTIME][WAIT_SETTLED_START]', {
      timeoutMs,
      intervalMs,
      reason: reason || '',
      fileCount,
      ts: Date.now(),
    });

    try {
    if (isCancelled()) {
      return { ok: false, cancelled: true, reason: 'cancelled' };
    }

    const firstErr = getNativeUploadError(options);
    if (firstErr) {
      appendRuntimeLog(`[UPLOAD_NATIVE][FAILED] names=${fileNames || '-'} message=${firstErr.message || '-'}`);
      return firstErr;
    }

    if (
      typeof ComposerAttachments !== 'undefined'
      && ComposerAttachments
      && typeof ComposerAttachments.waitNativeUploadSettled === 'function'
    ) {
      const settled = await ComposerAttachments.waitNativeUploadSettled({
        timeoutMs,
        intervalMs: pollMs,
        signal,
        isCancelled,
      });

      if (settled && settled.cancelled) {
        return { ok: false, cancelled: true, reason: 'cancelled' };
      }

      if (!settled || settled.ok !== true) {
        console.error('[UPLOAD_NATIVE_RUNTIME][WAIT_SETTLED_TIMEOUT]', {
          elapsedMs: Date.now() - startedAt,
          timeoutMs,
          uploading: true,
          fileCount,
          ready: false,
          reason: reason || '',
        });
        return { ok: false, reason: 'native-upload-settle-timeout' };
      }

      if (!requireSendReady) {
        console.log('[UPLOAD_NATIVE_RUNTIME][WAIT_SETTLED_OK]', {
          elapsedMs: Date.now() - startedAt,
          uploading: false,
          fileCount,
          ready: true,
          reason: reason || '',
        });
        return { ok: true, reason: 'native-upload-settled-without-send-ready' };
      }

      if (isCancelled()) {
        return { ok: false, cancelled: true, reason: 'cancelled' };
      }

      await sleepMs(stableMs);

      if (isCancelled()) {
        return { ok: false, cancelled: true, reason: 'cancelled' };
      }

      const nativeErrAfterStable = getNativeUploadError(options);
      if (nativeErrAfterStable) {
        return nativeErrAfterStable;
      }

      const sendReady = (
        typeof ComposerCapability !== 'undefined'
        && ComposerCapability
        && typeof ComposerCapability.isNativeSendReadyForUpload === 'function'
      )
        ? ComposerCapability.isNativeSendReadyForUpload({ source: 'unified/native-send-ready' })
        : false;
      if (!sendReady) {
        return { ok: false, reason: 'native-upload-send-not-ready' };
      }

      console.log('[UPLOAD_NATIVE_RUNTIME][WAIT_SETTLED_OK]', {
        elapsedMs: Date.now() - startedAt,
        uploading: false,
        fileCount,
        ready: true,
        reason: reason || '',
      });
      return { ok: true, reason: 'native-upload-settled' };
    }

    const deadline = Date.now() + timeoutMs;
    let lastNativeErrorScanAt = 0;

    while (Date.now() < deadline) {
      if (isCancelled()) {
        return { ok: false, cancelled: true, reason: 'cancelled' };
      }

      const now = Date.now();
      if (now - lastNativeErrorScanAt >= 1200) {
        lastNativeErrorScanAt = now;
        const nativeErr = getNativeUploadError(options);
        if (nativeErr) {
          appendRuntimeLog(`[UPLOAD_NATIVE][FAILED] names=${fileNames || '-'} message=${nativeErr.message || '-'}`);
          return nativeErr;
        }
      }

      const stillUploading = isAttachmentStillUploading(expectedNames);
      const attachmentPresent = requireSendReady ? true : hasAttachmentChip();
      const sendReady = requireSendReady
        ? (
          typeof ComposerCapability !== 'undefined'
          && ComposerCapability
          && typeof ComposerCapability.isNativeSendReadyForUpload === 'function'
          && ComposerCapability.isNativeSendReadyForUpload({ source: 'unified/native-send-ready' })
        )
        : true;
      const ready = !stillUploading && attachmentPresent && sendReady;

      if (Date.now() - startedAt >= 0) {
        console.log('[UPLOAD_NATIVE_RUNTIME][WAIT_SETTLED_CHECK]', {
          elapsedMs: Date.now() - startedAt,
          uploading: stillUploading,
          fileCount,
          ready,
          reason: reason || '',
        });
      }

      if (!stillUploading && attachmentPresent && sendReady) {
        await sleepMs(stableMs);

        if (isCancelled()) {
          return { ok: false, cancelled: true, reason: 'cancelled' };
        }

        const nativeErrAfterStable = getNativeUploadError(options);
        if (nativeErrAfterStable) {
          appendRuntimeLog(
            `[UPLOAD_NATIVE][FAILED] names=${fileNames || '-'} message=${nativeErrAfterStable.message || '-'} phase=post-stable`,
          );
          return nativeErrAfterStable;
        }

        const stillUploadingAfterStable = isAttachmentStillUploading(expectedNames);
        const attachmentPresentAfterStable = requireSendReady ? true : hasAttachmentChip();
        const sendReadyAfterStable = requireSendReady
          ? (
            typeof ComposerCapability !== 'undefined'
            && ComposerCapability
            && typeof ComposerCapability.isNativeSendReadyForUpload === 'function'
            && ComposerCapability.isNativeSendReadyForUpload({ source: 'unified/native-send-ready' })
          )
          : true;

        if (!stillUploadingAfterStable && attachmentPresentAfterStable && sendReadyAfterStable) {
          appendRuntimeLog(
            requireSendReady
              ? `[UPLOAD_NATIVE][SETTLED] names=${fileNames || '-'}`
              : `[UPLOAD][ATTACHED_ONLY][NATIVE_STABLE_OFF] names=${fileNames || '-'} requireSendReady=0`,
          );
          console.log('[UPLOAD_NATIVE_RUNTIME][WAIT_SETTLED_OK]', {
            elapsedMs: Date.now() - startedAt,
            uploading: false,
            fileCount,
            ready: true,
            reason: reason || '',
          });
          return {
            ok: true,
            reason: requireSendReady
              ? 'native-upload-settled'
              : 'native-upload-settled-without-send-ready',
          };
        }
      }

      await sleepMs(pollMs);
    }

    console.error('[UPLOAD_NATIVE_RUNTIME][WAIT_SETTLED_TIMEOUT]', {
      elapsedMs: Date.now() - startedAt,
      timeoutMs,
      uploading: true,
      fileCount,
      ready: false,
      reason: reason || '',
    });
    appendRuntimeLog(`[UPLOAD_NATIVE][TIMEOUT] names=${fileNames || '-'} timeoutMs=${timeoutMs}`);
    return { ok: false, reason: 'native-upload-settle-timeout' };
    } catch (e) {
      console.error('[UPLOAD_NATIVE_RUNTIME][WAIT_SETTLED_FAILED]', {
        reason: reason || '',
        error: e && e.stack ? e.stack : String(e),
        elapsedMs: Date.now() - startedAt,
      });
      return {
        ok: false,
        reason: 'wait_upload_settled_exception',
        error: String(e && e.message ? e.message : e),
      };
    }
  }

  if (typeof window !== 'undefined') {
    window.UploadNativeRuntime = window.UploadNativeRuntime || {};
    window.UploadNativeRuntime.waitChatGPTNativeUploadSettled = waitChatGPTNativeUploadSettled;
  }

  return {
    waitChatGPTNativeUploadSettled,
  };
})();



