const CopyTextSource = (() => {
  function getLatestAssistantText(reason = '') {
    if (
      typeof ChatMessageCache !== 'undefined'
      && ChatMessageCache
      && typeof ChatMessageCache.getLatestAssistantText === 'function'
    ) {
      return ChatMessageCache.getLatestAssistantText(reason);
    }
    if (typeof getLatestAssistantReplyText === 'function') {
      return getLatestAssistantReplyText(reason);
    }
    console.error('[COPY_TEXT_SOURCE][MISSING] latest assistant text reader');
    return '';
  }

  return {
    getLatestAssistantText
  };
})();

if (typeof window !== 'undefined') {
  window.CopyTextSource = CopyTextSource;
}
