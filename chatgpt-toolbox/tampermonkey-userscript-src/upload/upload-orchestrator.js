const UploadOrchestrator = (() => {
  async function startUpload(options = {}) {
    const source = options.source || 'upload-orchestrator';
    const runId = options.runId || `upload-${Date.now()}`;
    UploadTaskStore.setPhase('running', source, {
      runId,
      source,
      startedAt: Date.now()
    });

    if (
      typeof UploadModule !== 'undefined'
      && UploadModule
      && typeof UploadModule.startUploadLegacy === 'function'
    ) {
      const result = await UploadModule.startUploadLegacy(options);
      UploadTaskStore.setPhase(result && result.ok === false ? 'failed' : 'success', source, {
        result
      });
      return result;
    }

    console.error('[UPLOAD_ORCHESTRATOR][MISSING] legacy upload entry');
    UploadTaskStore.setPhase('failed', 'missing_legacy_upload_entry');
    return {
      ok: false,
      reason: 'missing_legacy_upload_entry'
    };
  }

  function cancelUpload(reason = 'manual') {
    UploadTaskStore.setPhase('cancelled', reason);
    return {
      ok: true,
      reason
    };
  }

  function getStatus() {
    return UploadTaskStore.getState();
  }

  return {
    startUpload,
    cancelUpload,
    getStatus
  };
})();

if (typeof window !== 'undefined') {
  window.UploadOrchestrator = UploadOrchestrator;
}
