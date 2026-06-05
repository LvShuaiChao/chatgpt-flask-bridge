const UploadCapability = (() => {
  function getSnapshot(reason = '') {
    const authority = (
      typeof ToolboxAuthorityState !== 'undefined'
      && ToolboxAuthorityState
      && typeof ToolboxAuthorityState.getSnapshot === 'function'
    )
      ? ToolboxAuthorityState.getSnapshot(reason)
      : null;

    return {
      reason,
      authority,
      canUpload: !!(authority && authority.buttons && authority.buttons.canUpload),
      createdAt: Date.now()
    };
  }

  return {
    getSnapshot
  };
})();

if (typeof window !== 'undefined') {
  window.UploadCapability = UploadCapability;
}
