const UploadDropzone = (() => {
  function bind(rootEl, reason = '') {
    if (!rootEl) {
      console.error('[UPLOAD_DROPZONE][BIND_FAILED] missing rootEl');
      return false;
    }
    rootEl.dataset.uploadDropzoneBound = '1';
    return true;
  }

  function unbind(rootEl, reason = '') {
    if (!rootEl) {
      return false;
    }
    delete rootEl.dataset.uploadDropzoneBound;
    return true;
  }

  return {
    bind,
    unbind
  };
})();

if (typeof window !== 'undefined') {
  window.UploadDropzone = UploadDropzone;
}
