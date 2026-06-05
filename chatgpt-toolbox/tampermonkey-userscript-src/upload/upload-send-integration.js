const UploadSendIntegration = (() => {
  async function sendAfterUpload(options = {}) {
    const source = options.source || 'upload-send-integration';
    if (
      typeof SendMessageFlow !== 'undefined'
      && SendMessageFlow
      && typeof SendMessageFlow.run === 'function'
    ) {
      return SendMessageFlow.run({
        ...options,
        source,
        action: options.action || 'upload-send'
      });
    }
    console.error('[UPLOAD_SEND_INTEGRATION][MISSING] SendMessageFlow.run');
    return {
      ok: false,
      reason: 'missing_send_message_flow'
    };
  }

  return {
    sendAfterUpload
  };
})();

if (typeof window !== 'undefined') {
  window.UploadSendIntegration = UploadSendIntegration;
}
