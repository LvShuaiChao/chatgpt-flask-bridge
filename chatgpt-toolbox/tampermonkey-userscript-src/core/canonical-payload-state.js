/********************************************************************
 * 统一 payload 状态：本地队列 vs ChatGPT 输入框附件
 ********************************************************************/

const CanonicalPayloadState = (() => {
  const readers = {
    getLocalQueueItems: null,
    getComposerEvidence: null,
    isUploading: null,
    isNativeReady: null,
  };

  function registerReaders(opts = {}) {
    if (opts && typeof opts.getLocalQueueItems === 'function') {
      readers.getLocalQueueItems = opts.getLocalQueueItems;
    }
    if (opts && typeof opts.getComposerEvidence === 'function') {
      readers.getComposerEvidence = opts.getComposerEvidence;
    }
    if (opts && typeof opts.isUploading === 'function') {
      readers.isUploading = opts.isUploading;
    }
    if (opts && typeof opts.isNativeReady === 'function') {
      readers.isNativeReady = opts.isNativeReady;
    }
  }

  function appendPayloadLog(line) {
    if (typeof ToolboxShell !== 'undefined' && ToolboxShell && typeof ToolboxShell.appendLog === 'function') {
      ToolboxShell.appendLog(line);
      return;
    }
    console.log(line);
  }

  function getCanonicalPayloadState(reason = '') {
    const reasonText = String(reason || '').trim() || '-';
    let localQueueItems = [];

    try {
      if (typeof readers.getLocalQueueItems === 'function') {
        localQueueItems = readers.getLocalQueueItems() || [];
      }
    } catch (err) {
      console.error('[CanonicalPayloadState] getLocalQueueItems failed', err);
      appendPayloadLog(
        `[PAYLOAD_STATE][ERROR] stage=local-queue reason=${reasonText} error=${err && err.message ? err.message : String(err)}`,
      );
      localQueueItems = [];
    }

    const localQueueCount = Array.isArray(localQueueItems) ? localQueueItems.length : 0;
    const activeLocalFileCount = Array.isArray(localQueueItems)
      ? localQueueItems.filter((item) => item && item.status !== 'removed' && item.status !== 'deleted').length
      : 0;

    let composerEvidence = null;
    try {
      if (typeof readers.getComposerEvidence === 'function') {
        composerEvidence = readers.getComposerEvidence(reasonText);
      } else if (
        typeof ComposerAttachments !== 'undefined'
        && ComposerAttachments
        && typeof ComposerAttachments.getSharedComposerAttachmentEvidence === 'function'
      ) {
        composerEvidence = ComposerAttachments.getSharedComposerAttachmentEvidence(`canonical-payload:${reasonText}`);
      }
    } catch (err) {
      console.error('[CanonicalPayloadState] getComposerEvidence failed', err);
      appendPayloadLog(
        `[PAYLOAD_STATE][ERROR] stage=composer-evidence reason=${reasonText} error=${err && err.message ? err.message : String(err)}`,
      );
    }

    const composerAttachmentCount = composerEvidence && Number.isFinite(Number(composerEvidence.count))
      ? Number(composerEvidence.count)
      : 0;
    const composerTextLen = composerEvidence && Number.isFinite(Number(composerEvidence.textLen))
      ? Number(composerEvidence.textLen)
      : 0;

    let uploading = false;
    try {
      uploading = typeof readers.isUploading === 'function' ? !!readers.isUploading() : false;
    } catch (err) {
      console.error('[CanonicalPayloadState] isUploading failed', err);
    }

    let nativeReady = false;
    try {
      if (typeof readers.isNativeReady === 'function') {
        nativeReady = !!readers.isNativeReady();
      } else if (typeof ComposerCapability !== 'undefined' && ComposerCapability && typeof ComposerCapability.isNativeSendReadyForUpload === 'function') {
        nativeReady = !!ComposerCapability.isNativeSendReadyForUpload({ log: false });
      }
    } catch (err) {
      console.error('[CanonicalPayloadState] isNativeReady failed', err);
    }

    let canSendPayload = true;
    let blockReason = '';

    if (activeLocalFileCount > 0 && composerAttachmentCount <= 0 && composerTextLen <= 0) {
      canSendPayload = false;
      blockReason = 'local_queue_no_composer_attachment';
    }

    if (uploading) {
      canSendPayload = false;
      if (!blockReason) {
        blockReason = 'upload_in_progress';
      }
    }

    const snapshot = {
      localQueueCount,
      activeLocalFileCount,
      composerAttachmentCount,
      composerTextLen,
      nativeReady,
      uploading,
      canSendPayload,
      reason: blockReason,
    };

    appendPayloadLog(
      `[PAYLOAD_STATE][SNAPSHOT] reason=${reasonText} localQueue=${localQueueCount} activeLocal=${activeLocalFileCount} composerAttach=${composerAttachmentCount} textLen=${composerTextLen} nativeReady=${nativeReady ? 1 : 0} uploading=${uploading ? 1 : 0} canSend=${canSendPayload ? 1 : 0} blockReason=${blockReason || '-'}`,
    );

    return snapshot;
  }

  function blockSendIfPayloadNotReady(action, reason = '') {
    const canonical = typeof ToolboxActionRegistry !== 'undefined'
      && ToolboxActionRegistry
      && typeof ToolboxActionRegistry.normalizeAction === 'function'
      ? ToolboxActionRegistry.normalizeAction(action)
      : String(action || '').trim();

    const requiresPayload = typeof ToolboxActionRegistry !== 'undefined'
      && ToolboxActionRegistry
      && typeof ToolboxActionRegistry.actionRequiresComposerPayload === 'function'
      && ToolboxActionRegistry.actionRequiresComposerPayload(canonical);

    if (!requiresPayload) {
      return { blocked: false, snapshot: null };
    }

    const snapshot = getCanonicalPayloadState(reason || canonical);
    if (snapshot.canSendPayload) {
      return { blocked: false, snapshot };
    }

    return {
      blocked: true,
      snapshot,
      message: snapshot.reason === 'local_queue_no_composer_attachment'
        ? '本地文件还没有上传到 ChatGPT 输入框，请先点击「开始上传」，上传完成后再发送。'
        : (snapshot.reason === 'upload_in_progress'
          ? '正在上传文件，请等待上传完成后再发送。'
          : '当前无法发送，请检查输入框附件与上传状态。'),
    };
  }

  return {
    registerReaders,
    getCanonicalPayloadState,
    blockSendIfPayloadNotReady,
  };
})();
