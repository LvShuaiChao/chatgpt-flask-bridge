  /********************************************************************
   * ChatMessageCache：消息缓存与会话快照（委托 main.js 既有函数）
   ********************************************************************/

  const ChatMessageCache = (() => {
    function create(deps) {
      const {
        log,
        legacyMarkLatestAssistantMessageCacheDirty,
        legacyCleanupChatMessageCaches,
        legacySaveConversationSnapshotSafe,
        legacyGetSavedConversationSnapshot,
      } = deps;

      function appendCacheLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function markLatestAssistantMessageCacheDirty() {
        appendCacheLog('[CHAT_MESSAGE_CACHE][DIRTY]');
        if (typeof legacyMarkLatestAssistantMessageCacheDirty === 'function') {
          legacyMarkLatestAssistantMessageCacheDirty();
        }
      }

      function cleanupChatMessageCaches(reason) {
        if (typeof legacyCleanupChatMessageCaches === 'function') {
          legacyCleanupChatMessageCaches(reason);
        }
      }

      return {
        markLatestAssistantMessageCacheDirty,
        cleanupChatMessageCaches,
        saveConversationSnapshotSafe: legacySaveConversationSnapshotSafe,
        getSavedConversationSnapshot: legacyGetSavedConversationSnapshot,
      };
    }

    return { create };
  })();
