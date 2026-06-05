const UploadToolbar = (() => {
  function ensure(rootEl) {
    if (!rootEl) {
      console.error('[UPLOAD_TOOLBAR][ENSURE_FAILED] missing rootEl');
      return null;
    }
    let toolbar = rootEl.querySelector('[data-toolbox-upload-toolbar="1"]');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.dataset.toolboxUploadToolbar = '1';
      rootEl.appendChild(toolbar);
    }
    return toolbar;
  }

  function bind(rootEl) {
    const toolbar = ensure(rootEl);
    return !!toolbar;
  }

  return {
    ensure,
    bind
  };
})();

if (typeof window !== 'undefined') {
  window.UploadToolbar = UploadToolbar;
}
