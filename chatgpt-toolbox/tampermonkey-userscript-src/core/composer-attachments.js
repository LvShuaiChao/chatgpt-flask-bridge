const ComposerAttachments = (() => {
  function appendDeprecatedHit(tag, detail = '') {
    const line = `[DEPRECATED_HIT] tag=${tag}${detail ? ` detail=${detail}` : ''}`;
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
    } else {
      console.warn(line);
    }
  }

  function getComposerAttachmentState(options = {}) {
    const useHeavy = options && options.heavy === true;
    let attachmentCount = 0;
    let hasAttachment = false;
    let attachmentUploading = false;

    try {
      if (useHeavy && typeof ComposerApi.countAttachmentChips === 'function') {
        attachmentCount = Number(ComposerApi.countAttachmentChips()) || 0;
      } else if (typeof ComposerApi.countAttachmentChipsFast === 'function') {
        attachmentCount = Number(ComposerApi.countAttachmentChipsFast()) || 0;
      } else if (typeof ComposerApi.countAttachmentChips === 'function') {
        attachmentCount = Number(ComposerApi.countAttachmentChips()) || 0;
      }

      hasAttachment = attachmentCount > 0;
      if (useHeavy && typeof ComposerApi.hasComposerAttachmentUnified === 'function') {
        hasAttachment = !!ComposerApi.hasComposerAttachmentUnified({ heavy: true });
      }

      if (typeof ComposerApi.isAttachmentStillUploading === 'function') {
        attachmentUploading = !!ComposerApi.isAttachmentStillUploading();
      }

      if (hasAttachment && attachmentCount <= 0) {
        attachmentCount = 1;
      }
    } catch (err) {
      console.error('[ChatGPT toolbox] ComposerAttachments.getComposerAttachmentState failed', err);
    }

    const hasComposerPayload = Boolean(hasAttachment || attachmentUploading || attachmentCount > 0);
    return {
      attachmentCount,
      hasAttachment,
      attachmentUploading,
      hasComposerPayload,
      has_composer_payload: hasComposerPayload,
    };
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
    while (Date.now() - startedAt <= timeoutMs) {
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

  return {
    getComposerAttachmentState,
    isAttachmentStillUploading,
    hasComposerAttachmentPayload,
    waitNativeUploadSettled,
    detectNativeUploadError,
    getComposerAttachmentStateDeprecated,
  };
})();

