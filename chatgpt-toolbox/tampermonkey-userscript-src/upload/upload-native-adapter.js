const UploadNativeAdapter = (() => {
  function getSnapshot(reason = '') {
    if (
      typeof UploadNativeRuntime !== 'undefined'
      && UploadNativeRuntime
      && typeof UploadNativeRuntime.getSnapshot === 'function'
    ) {
      return UploadNativeRuntime.getSnapshot(reason);
    }
    console.error('[UPLOAD_NATIVE_ADAPTER][MISSING] UploadNativeRuntime.getSnapshot');
    return {
      ok: false,
      reason: 'missing_native_runtime',
      createdAt: Date.now()
    };
  }

  return {
    getSnapshot
  };
})();

if (typeof window !== 'undefined') {
  window.UploadNativeAdapter = UploadNativeAdapter;
}
