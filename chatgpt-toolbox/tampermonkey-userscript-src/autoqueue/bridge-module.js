  /********************************************************************
   * 6. BridgeModule：浏览器桥接模   ********************************************************************/

  const BridgeModule = (() => {
    const DEFAULT_BRIDGE_BASE_URL = 'http://127.0.0.1:5000';
    const DEFAULT_BRIDGE_PATH = '/api/bridge';
    const SOURCE = 'tampermonkey';
    const SCRIPT_VERSION = 'merged-bridge-1.0.0';
    const CLIENT_ID_KEY = 'tm_bridge_client_id';
    const PAGE_INSTANCE_ID = getToolboxPageInstanceId();

    const state = {
      root: null,
      timerId: 0,
      mountedAt: Date.now(),
      everHadComposer: false,
      bridgePollFailCount: 0,
      bridgePollTimer: 0,
      bridgePollLoopActive: false,
      bridgeRunId: 0,
      polling: false,
      handlingMessageId: null,
      lastBusyHeartbeatAt: 0,
      lastIdentityKey: '',
      lastIdentityLogKey: '',
      pendingIdentityOldKey: '',
      pendingIdentityReason: '',
      pageIdentityListenersInstalled: false,
      lastErrorLogAt: 0,
      lastErrorText: '',
      uploadBlockNextChatReason: '',
      uploadBlockNextChatAt: 0,
      uploadBlockNextChatSourceMessageId: '',
      pendingReplyContext: null,
      lastReplyWatchResponding: false,
      advancedCapabilityExpanded: false,
      bridgeWakeHooksInstalled: false,
      onBridgeWakeVisibility: null,
      onBridgeWakeFocus: null,
      onBridgeWakePageshow: null,
      onBridgeWakeOnline: null,
      pendingReplyDomObserver: null,
      pendingReplyDomObserverTimer: 0,
      lastDomMutationAt: 0,
      lastReplyWatchAt: 0,
      lastResponseStateAt: 0,
      lastResponseStateCache: null,
    };

    const bridgeTimers = createTimerRegistry('BRIDGE');

    const bridgeStatus = createModuleStatus('BRIDGE', {
      getLocalEl: () => (state.root ? qs('#cgpt-bridge-status', state.root) : null),
      owner: 'bridge',
      useGlobal: false,
      useLog: false,
    });

    function setBridgeStatus(text, type, options = {}) {
      if (typeof ToolboxShell === 'undefined' || typeof ToolboxShell.setStatus !== 'function') {
        return;
      }
      ToolboxShell.setStatus(text, type, {
        ...options,
        owner: options.owner || 'bridge',
      });
    }

    const CLIENT_ID = (() => {
      try {
        const saved = sessionStorage.getItem(CLIENT_ID_KEY);
        if (saved) return saved;
        const created = `tm-${Math.random().toString(36).slice(2, 10)}`;
        sessionStorage.setItem(CLIENT_ID_KEY, created);
        return created;
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const tempId = `tm-${Math.random().toString(36).slice(2, 10)}`;

        console.error('[BridgeModule] 无法使用 sessionStorage，使用临时 CLIENT_ID:', error);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][CLIENT_ID][TEMP] type=${errName} client_id=${tempId} error=${errText}`,
          );
        }

        return tempId;
      }
    })();

    function buildVisibilityPayload() {
      const visibilityState = document.visibilityState || 'unknown';
      const hasFocus = document.hasFocus();

      return {
        visibility_state: visibilityState,
        has_focus: hasFocus,
      };
    }

    function getConfig() {
      return {
        bridgeEnabled: true,
        bridgeBaseUrl: normalizeBridgeBaseUrl(MemoryManager.get('bridgeBaseUrl', DEFAULT_BRIDGE_BASE_URL)),
        bridgePath: normalizeBridgePath(MemoryManager.get('bridgePath', DEFAULT_BRIDGE_PATH)),
        bridgeDebugEnabled: !!MemoryManager.get('bridgeDebugEnabled', false),
        bridgeRequestTimeoutMs: Number(MemoryManager.get('bridgeRequestTimeoutMs', 30000)) || 30000,
        bridgePollIntervalMs: Number(MemoryManager.get('bridgePollIntervalMs', 3000)) || 3000,
      };
    }

    function saveConfig(patch) {
      Object.keys(patch || {}).forEach((key) => {
        if (key === 'bridgeEnabled') {
          return;
        }
        MemoryManager.set(key, patch[key]);
      });
      MemoryManager.set('bridgeEnabled', true);
      MemoryManager.remove('bridgeApiToken');
    }

    function normalizeBridgeBaseUrl(value) {
      let text = String(value || '').trim();
      if (!text) return DEFAULT_BRIDGE_BASE_URL;
      text = text.replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(text)) {
        text = `http://${text}`;
      }
      return text;
    }

    function normalizeBridgePath(value) {
      const text = String(value || DEFAULT_BRIDGE_PATH).trim();
      return text.startsWith('/') ? text : `/${text}`;
    }

    function getBridgeUrl() {
      const cfg = getConfig();
      return `${cfg.bridgeBaseUrl}${cfg.bridgePath}`;
    }

    function summarizeBridgeError(error) {
      if (!error) {
        return {
          name: 'Error',
          message: '',
          detail: '',
        };
      }

      const name = error && error.name ? String(error.name) : 'Error';
      const primaryMessage = error && error.message ? String(error.message).trim() : '';
      const detailParts = [];

      if (primaryMessage) {
        detailParts.push(primaryMessage);
      }

      [
        ['status', error.status],
        ['statusText', error.statusText],
        ['readyState', error.readyState],
        ['responseText', error.responseText],
        ['finalUrl', error.finalUrl],
        ['details', error.details],
      ].forEach(([key, value]) => {
        if (value == null || value === '') {
          return;
        }
        const text = typeof value === 'string'
          ? value.replace(/\s+/g, ' ').trim()
          : stringifyFullBridgeJsonForLog(value);
        if (!text) {
          return;
        }
        const clipped = text.length > 300 ? `${text.slice(0, 300)}...` : text;
        detailParts.push(`${key}=${clipped}`);
      });

      if (!detailParts.length) {
        const fallback = typeof error === 'string'
          ? error
          : stringifyFullBridgeJsonForLog(error);
        if (fallback) {
          detailParts.push(fallback);
        }
      }

      const detail = detailParts.join(' | ').trim();
      return {
        name,
        message: primaryMessage || detail || String(error),
        detail,
      };
    }

    function logBridgeError(message, error) {
      const text = String(message || error || 'unknown');
      const now = Date.now();
      const sameError = text === state.lastErrorText;

      if (sameError && now - state.lastErrorLogAt < 5000) {
        return;
      }

      state.lastErrorLogAt = now;
      state.lastErrorText = text;

      const summary = summarizeBridgeError(error);
      console.error('[BRIDGE][ERROR]', text, error || '');

      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        const errText = summary.detail || summary.message || '';
        ToolboxShell.appendLog(
          `[BRIDGE][ERROR] ${text}${errText && errText !== text ? ` error=${errText}` : ''}`,
        );
      }
    }

    function debugLog(text) {
      const cfg = getConfig();
      if (!cfg.bridgeDebugEnabled) return;
      ToolboxShell.appendLog(`[BRIDGE][DEBUG] ${String(text || '')}`);
    }

    function buildBridgeHeaders() {
      return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Source': SOURCE,
      };
    }

    function detectResponseState(options = {}) {
      const startedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const now = Date.now();
      const maxAgeMs = Math.max(3000, Math.min(5000, Number(options.maxAgeMs || 4000)));
      const lightState = typeof detectComposerResponseState === 'function'
        ? detectComposerResponseState({ light: true, reason: `bridge-light:${String(options.reason || '-')}` })
        : {};
      const cached = state.lastResponseStateCache && typeof state.lastResponseStateCache === 'object'
        ? state.lastResponseStateCache
        : null;
      const cachedBusy = !!(cached && cached.is_responding);
      const lightBusy = !!(lightState && lightState.is_responding);
      const shouldRefresh = !!options.force
        || !cached
        || (now - Number(state.lastResponseStateAt || 0) > maxAgeMs)
        || cachedBusy !== lightBusy;
      const result = shouldRefresh
        ? detectComposerResponseState({ reason: `bridge-full:${String(options.reason || '-')}` })
        : cached;
      if (result && typeof result === 'object') {
        state.lastResponseStateCache = result;
        state.lastResponseStateAt = now;
      }
      const costMs = Math.round(
        ((typeof performance !== 'undefined' && performance.now)
          ? performance.now()
          : Date.now()) - startedAt,
      );
      if (costMs > 50 && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
        ToolboxShell.appendLog(
          `[PERF][DOM_DETECT] source=detectComposerResponseState cost=${costMs}ms force=${options.force ? 1 : 0} reason=${String(options.reason || '-').trim() || '-'}`,
        );
      }
      return result || lightState || {};
    }

    function bridgeUrlFrom(obj) {
      if (!obj || typeof obj !== 'object') {
        return '';
      }
      return String(obj.url || '').trim();
    }

    function bridgeContentFrom(obj) {
      if (!obj || typeof obj !== 'object') {
        return '';
      }
      return String(obj.content || '').trim();
    }

    function normalizeBridgePollMessage(raw) {
      if (!raw || typeof raw !== 'object') {
        return raw;
      }
      const messageId = String(raw.message_id || '').trim();
      const content = bridgeContentFrom(raw);
      const url = bridgeUrlFrom(raw);
      const normalized = {
        ...raw,
        message_id: messageId,
        content,
      };
      if (url) {
        normalized.url = url;
      }
      return normalized;
    }

    function withBridgeUrlFields(fields) {
      const patch = fields && typeof fields === 'object' ? { ...fields } : {};
      const url = bridgeUrlFrom(patch) || location.href;
      patch.url = url;
      if (typeof buildBrowserRuntimeFields === 'function') {
        Object.assign(patch, buildBrowserRuntimeFields('bridge-payload'));
      }
      return patch;
    }

    const BIND_TOKEN_META_KEY = 'xz_bind_token_meta';
    const BIND_TOKEN_MAX_AGE_MS = 5 * 60 * 1000;

    function clearStoredBindRequestToken(reason = '') {
      try {
        sessionStorage.removeItem('xz_bind_token');
        sessionStorage.removeItem(BIND_TOKEN_META_KEY);
        const conversationId = parseConversationIdFromPath(location.pathname || '') || '';
        ToolboxShell.appendLog(
          `[BRIDGE][BIND_TOKEN][CLEAR] reason=${reason || '-'} `
            + `client_id=${CLIENT_ID} `
            + `page_instance_id=${PAGE_INSTANCE_ID} `
            + `conversation_id=${conversationId || '-'}`,
        );
      } catch (error) {
        logBridgeError(
          `clearStoredBindRequestToken 失败: ${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function saveStoredBindRequestToken(token) {
      const value = String(token || '').trim();
      if (!value) {
        return;
      }

      const meta = {
        token: value,
        client_id: CLIENT_ID,
        page_instance_id: PAGE_INSTANCE_ID,
        savedAt: Date.now(),
      };

      sessionStorage.setItem('xz_bind_token', value);
      sessionStorage.setItem(BIND_TOKEN_META_KEY, JSON.stringify(meta));
      ToolboxShell.appendLog(
        `[BRIDGE][BIND_TOKEN][SAVE] client_id=${CLIENT_ID} page_instance_id=${PAGE_INSTANCE_ID}`,
      );
    }

    function clearBindRequestTokenFromLocation(reason = '') {
      try {
        const url = new URL(location.href);
        let changed = false;

        if (url.searchParams.has('xz_bind_token')) {
          url.searchParams.delete('xz_bind_token');
          changed = true;
        }

        const hash = String(url.hash || '');
        if (hash.includes('xz_bind_token=')) {
          const parts = hash.slice(1).split('&').filter((part) => part && !part.startsWith('xz_bind_token='));
          url.hash = parts.length ? `#${parts.join('&')}` : '';
          changed = true;
        }

        if (changed) {
          history.replaceState(history.state, document.title, url.toString());
          ToolboxShell.appendLog(
            `[BRIDGE][BIND_TOKEN][URL_CLEAN] reason=${reason || '-'} client_id=${CLIENT_ID} page_instance_id=${PAGE_INSTANCE_ID}`,
          );
        }
      } catch (error) {
        logBridgeError(
          `clearBindRequestTokenFromLocation failed: ${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function readStoredBindRequestToken() {
      try {
        const rawMeta = sessionStorage.getItem(BIND_TOKEN_META_KEY);
        if (!rawMeta) {
          const legacy = String(sessionStorage.getItem('xz_bind_token') || '').trim();
          if (legacy) {
            clearStoredBindRequestToken('legacy-without-meta');
          }
          return '';
        }

        const meta = JSON.parse(rawMeta);
        const token = String(meta && meta.token ? meta.token : '').trim();
        const savedAt = Number(meta && meta.savedAt ? meta.savedAt : 0);
        const metaClientId = String(meta && meta.client_id ? meta.client_id : '').trim();
        const metaPageInstanceId = String(meta && meta.page_instance_id ? meta.page_instance_id : '').trim();
        if (!token) {
          clearStoredBindRequestToken('empty-token');
          return '';
        }

        if (!savedAt || Date.now() - savedAt > BIND_TOKEN_MAX_AGE_MS) {
          clearStoredBindRequestToken('expired');
          return '';
        }

        if (!metaPageInstanceId) {
          clearStoredBindRequestToken('missing-page-instance-id');
          return '';
        }

        if (metaPageInstanceId !== PAGE_INSTANCE_ID) {
          clearStoredBindRequestToken('page-instance-mismatch');
          return '';
        }

        if (metaClientId && metaClientId !== CLIENT_ID) {
          clearStoredBindRequestToken('client-id-mismatch');
          return '';
        }

        return token;
      } catch (error) {
        clearStoredBindRequestToken('read-meta-failed');
        logBridgeError(
          `readStoredBindRequestToken 失败: ${error && error.message ? error.message : String(error)}`,
          error,
        );
        return '';
      }
    }

    function getBindRequestToken() {
      try {
        const url = new URL(location.href);
        const fromQuery = url.searchParams.get('xz_bind_token');
        if (fromQuery) {
          saveStoredBindRequestToken(fromQuery);
          clearBindRequestTokenFromLocation('query');
          return fromQuery;
        }
        const hash = String(location.hash || '');
        const match = hash.match(/xz_bind_token=([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          saveStoredBindRequestToken(match[1]);
          clearBindRequestTokenFromLocation('hash');
          return match[1];
        }
        return readStoredBindRequestToken();
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);

        logBridgeError(
          `[getBindRequestToken][failed] type=${errName} url=${location.href} error=${errText}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][BIND_TOKEN][FAILED] type=${errName} url=${location.href} error=${errText}`,
          );
        }

        if (typeof updateStatus === 'function') {
          updateStatus(`绑定 token 获取失败：${errText}`);
        }

        return '';
      }
    }

    function logIdentityThrottled(identity) {
      const cfg = getConfig();
      if (!cfg.bridgeDebugEnabled) return;

      const key = [
        identity.page_type || '',
        identity.conversation_id || '',
        identity.pathname || '',
        identity.visibility_state || '',
        identity.has_focus ? 'focus' : 'blur',
      ].join('|');

      const now = Date.now();

      if (key === state.lastIdentityLogKey && now - Number(state.lastIdentityLogAt || 0) < 5000) {
        return;
      }

      state.lastIdentityLogKey = key;
      state.lastIdentityLogAt = now;

      ToolboxShell.appendLog(
        `[BRIDGE][IDENTITY] page_type=${identity.page_type || '-'} conversation_id=${identity.conversation_id || '-'} pathname=${identity.pathname || '-'}`,
      );
    }

    function getCurrentBridgePageDisplayId() {
      try {
        if (typeof getBridgePageDisplayIdText === 'function') {
          const value = String(getBridgePageDisplayIdText() || '').trim();
          if (value && value !== '-') return value;
        }
      } catch (error) {
        console.error('[BRIDGE][PAGE_ID][READ_FAILED]', error);
      }

      try {
        if (typeof BRIDGE_STATE !== 'undefined' && BRIDGE_STATE) {
          const value = String(
            BRIDGE_STATE.page_display_id
            || BRIDGE_STATE.page_no
            || '',
          ).trim();

          if (value && value !== '-') return value;
        }
      } catch (error) {
        console.error('[BRIDGE][PAGE_ID][STATE_READ_FAILED]', error);
      }

      return '';
    }

    function getPageIdentityLight() {
      const url = new URL(location.href);
      const path = url.pathname || '';
      const conversationId = parseConversationIdFromPath(path);
      const hasBindTokenInUrl = Boolean(
        url.searchParams.get('xz_bind_token')
        || (url.hash && url.hash.includes('xz_bind_token=')),
      );
      let pageType = 'other';
      if (conversationId) {
        pageType = 'conversation';
      } else if (path === '/' || path === '' || hasBindTokenInUrl) {
        pageType = 'home';
      } else if (path.startsWith('/backend-api/') || path.includes('/sentinel/')) {
        pageType = 'ignored';
      }
      const pageDisplayId = getCurrentBridgePageDisplayId();
      return {
        client_id: CLIENT_ID,
        page_instance_id: PAGE_INSTANCE_ID,
        page_display_id: pageDisplayId,
        url: location.href,
        page_type: pageType,
        conversation_id: conversationId,
        visibility_state: document.visibilityState || 'unknown',
        has_focus: document.hasFocus(),
      };
    }

    function getPageIdentity() {
      const perfStartedAt = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      try {
        const lightIdentity = getPageIdentityLight();
        const url = new URL(location.href);
        const path = url.pathname || '';
        const conversationId = lightIdentity.conversation_id || '';
        const bindToken = getBindRequestToken();
        const responseState = detectResponseState({ reason: 'getPageIdentity' });
        const identity = {
          ...lightIdentity,
          script_version: SCRIPT_VERSION,
          upload_bridge_supported: true,
          upload_bridge_version: 1,
          page_title: document.title || '',
          bind_request_id: bindToken,
          is_top_frame: window.top === window.self,

          ...(typeof buildBrowserRuntimeFields === 'function'
            ? buildBrowserRuntimeFields('page-identity')
            : {}),
          ...buildPendingReplyTelemetryFields(),

          heartbeat_alive: true,
          pathname: location.pathname,
          last_seen: Date.now() / 1000,
          is_responding: Boolean(responseState.is_responding),
          response_state: responseState.response_state || 'unknown',
          response_state_reason: responseState.response_state_reason || '',
          response_state_at: responseState.response_state_at || Date.now(),
          can_accept_input: Boolean(responseState.can_accept_input),
          can_send_now: Boolean(responseState.can_send_now),
        };
        logIdentityThrottled(identity);

        const cfg = getConfig();
        if (cfg.bridgeDebugEnabled) {
          logPageCapability(getPageCapability('getPageIdentity'), '[BRIDGE][IDENTITY]');
        }

        const costMs = Math.round(
          ((typeof performance !== 'undefined' && performance.now)
            ? performance.now()
            : Date.now()) - perfStartedAt,
        );
        if (costMs > 50 && typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
          ToolboxShell.appendLog(
            `[PERF][DOM_DETECT] source=getPageIdentity cost=${costMs}ms conversation_id=${identity.conversation_id || '-'} page_display_id=${identity.page_display_id || '-'}`,
          );
        }

        return identity;
      } catch (error) {
        const errName = error && error.name ? error.name : 'Error';
        const errText = error && error.message ? error.message : String(error);
        const fallbackPathname = location && location.pathname ? location.pathname : '';
        const fallbackConversationId = parseConversationIdFromPath(fallbackPathname);

        logBridgeError(
          `[getPageIdentity][failed] type=${errName} pathname=${fallbackPathname || '-'} error=${errText}`,
          error,
        );

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][IDENTITY][FAILED] type=${errName} pathname=${fallbackPathname || '-'} conversation_id=${fallbackConversationId || '-'} error=${errText}`,
          );
        }

        const fallbackPageDisplayId = getCurrentBridgePageDisplayId();
        return {
          client_id: CLIENT_ID,
          page_instance_id: PAGE_INSTANCE_ID,
          page_display_id: fallbackPageDisplayId,
          script_version: SCRIPT_VERSION,
          upload_bridge_supported: true,
          upload_bridge_version: 1,
          url: location.href,
          page_title: document.title || '',
          page_type: fallbackConversationId ? 'conversation' : 'unknown',
          conversation_id: fallbackConversationId || '',
          bind_request_id: '',
          is_top_frame: window.top === window.self,
          ...buildVisibilityPayload(),
          heartbeat_alive: true,
          pathname: fallbackPathname,
          last_seen: Date.now() / 1000,
          is_responding: false,
          response_state: 'unknown',
          response_state_reason: `identity_exception:${errName}`,
          response_state_at: Date.now(),
          can_accept_input: false,
          can_send_now: false,
          identity_error: errText,
        };
      }
    }

    const DEBUG_FULL_BRIDGE_JSON = false;

    const BRIDGE_JSON_QUIET_REPORT_EVENTS = new Set([
      'focus_state',
      'page_heartbeat',
      'heartbeat',
      'heartbeat_busy',
      'status_timer',
    ]);

    function buildBridgeRequestPayload(body) {
      const mode = String((body && body.identityMode) || '').trim().toLowerCase();
      const identity = mode === 'full' ? getPageIdentity() : getPageIdentityLight();
      const payload = {
        ...identity,
        ...(body || {}),
      };

      if (Object.prototype.hasOwnProperty.call(payload, 'identityMode')) {
        delete payload.identityMode;
      }

      if (
        mode
        && payload.payload
        && typeof payload.payload === 'object'
        && !Array.isArray(payload.payload)
        && !Object.prototype.hasOwnProperty.call(payload.payload, 'identity_mode')
      ) {
        payload.payload.identity_mode = mode;
      }

      // Bridge backend is strict about top-level schema fields (unknown_fields_not_allowed).
      // Apply allowlist filtering for action=report only, to avoid breaking other actions.
      if (String(payload.action || '').trim() === 'report') {
        const REPORT_ALLOWED_TOP_LEVEL_FIELDS = new Set([
          // Keep in sync with app/utils/legacy_cleanup.py PAGE_REGISTRY_ALLOWED_FIELDS
          'action', 'event', 'source', 'test_connection', 'debug_status', 'message_id',
          'session_id', 'turn_id', 'role', 'content', 'content_len', 'success', 'detail',
          'reason', 'created_at', 'payload', 'client_id', 'page_instance_id', 'page_display_id',
          'conversation_id', 'url', 'page_type', 'page_title', 'bind_request_id', 'script_version',
          'upload_bridge_supported', 'upload_bridge_version', 'is_top_frame', 'visibility_state',
          'has_focus', 'heartbeat_alive', 'pathname', 'last_seen', 'last_poll_at', 'last_heartbeat_at',
          'is_responding', 'response_state', 'response_state_reason', 'response_state_at',
          'can_accept_input', 'can_send_now', 'url_syncable', 'conversation_syncable', 'combo',
          'event_at', 'identity_error',
          'last_dom_mutation_at', 'last_reply_watch_at', 'pending_reply_active', 'pending_reply_started_at',
          'pending_reply_text_length', 'browser_hidden', 'browser_visibility_state', 'browser_has_focus',
          'browser_timer_drift_ms', 'browser_probably_throttled',
        ]);

        const filtered = {};
        const kept = [];
        const dropped = [];
        Object.keys(payload).forEach((key) => {
          if (REPORT_ALLOWED_TOP_LEVEL_FIELDS.has(key)) {
            filtered[key] = payload[key];
            kept.push(key);
          } else {
            dropped.push(key);
          }
        });

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(
            `[BRIDGE][REPORT_FILTER] kept=${kept.join('|') || '-'} dropped=${dropped.join('|') || '-'}`,
          );
        }

        return filtered;
      }

      return payload;
    }

    function stringifyFullBridgeJsonForLog(obj) {
      try {
        return JSON.stringify(obj, null, 0);
      } catch (error) {
        console.error('[BRIDGE][JSON][STRINGIFY_FAILED]', {
          error_type: error && error.name ? error.name : 'Error',
          error: error && error.message ? error.message : String(error),
          stack: error && error.stack ? error.stack : '',
        });
        return String(obj);
      }
    }

    function shouldLogFullBridgeJson(payload) {
      if (!payload) {
        return false;
      }

      const cfg = getConfig();
      const debugEnabled = !!cfg.bridgeDebugEnabled;
      const action = String(payload.action || '').trim();
      const event = String(payload.event || '').trim();

      if (!DEBUG_FULL_BRIDGE_JSON && !debugEnabled) {
        if (action === 'assistant_reply') {
          return true;
        }

        if (action === 'ack') {
          return true;
        }

        if (action === 'report') {
          if (BRIDGE_JSON_QUIET_REPORT_EVENTS.has(event)) {
            return false;
          }
          return event === 'assistant_reply';
        }

        return false;
      }

      if (
        action === 'poll'
        || action === 'ack'
        || action === 'hello'
        || action === 'register'
        || action === 'assistant_reply'
      ) {
        return true;
      }

      if (action === 'report') {
        if (BRIDGE_JSON_QUIET_REPORT_EVENTS.has(event)) {
          return false;
        }
        return true;
      }

      return false;
    }

    function appendBridgeJsonToolboxLog(line) {
      if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
        ToolboxShell.appendLog(line);
      }
    }

    function logTmToServerFull(payload) {
      const jsonText = stringifyFullBridgeJsonForLog(payload);
      console.log('[BRIDGE][JSON][TM_TO_SERVER_FULL]', {
        action: payload && payload.action,
        event: payload && payload.event,
        client_id: payload && payload.client_id,
        page_instance_id: payload && payload.page_instance_id,
        conversation_id: payload && payload.conversation_id,
        message_id: payload && payload.message_id,
        json: jsonText,
      });
      appendBridgeJsonToolboxLog(
        `[BRIDGE][JSON][TM_TO_SERVER_FULL] action=${payload.action || '-'} event=${payload.event || '-'} `
        + `client_id=${payload.client_id || '-'} page_instance_id=${payload.page_instance_id || '-'} `
        + `conversation_id=${payload.conversation_id || '-'} message_id=${payload.message_id || '-'} `
        + `json=${jsonText}`,
      );
    }

    function logServerToTmFull(requestPayload, responseJson) {
      const jsonText = stringifyFullBridgeJsonForLog(responseJson);
      console.log('[BRIDGE][JSON][SERVER_TO_TM_FULL]', {
        action: requestPayload && requestPayload.action,
        event: requestPayload && requestPayload.event,
        request_message_id: requestPayload && requestPayload.message_id,
        response_message_id: responseJson && responseJson.message_id,
        ok: responseJson && responseJson.ok,
        has_message: responseJson && responseJson.has_message,
        type: responseJson && responseJson.type,
        json: jsonText,
      });
      appendBridgeJsonToolboxLog(
        `[BRIDGE][JSON][SERVER_TO_TM_FULL] action=${requestPayload.action || '-'} event=${requestPayload.event || '-'} `
        + `ok=${responseJson && responseJson.ok} has_message=${responseJson && responseJson.has_message} `
        + `type=${responseJson && responseJson.type || '-'} json=${jsonText}`,
      );
    }

    function logAssistantReplyReportFull(reportPayload, messageId) {
      const payload = reportPayload || {};
      const jsonText = stringifyFullBridgeJsonForLog(payload);
      console.log('[BRIDGE][JSON][ASSISTANT_REPLY_REPORT_FULL]', {
        message_id: messageId || payload.message_id,
        session_id: payload.session_id,
        turn_id: payload.turn_id,
        client_id: payload.client_id,
        page_instance_id: payload.page_instance_id,
        conversation_id: payload.conversation_id,
        response_state: payload.response_state,
        json: jsonText,
      });
      appendBridgeJsonToolboxLog(
        `[BRIDGE][JSON][ASSISTANT_REPLY_REPORT_FULL] message_id=${messageId || payload.message_id || '-'} `
        + `session_id=${payload.session_id || '-'} turn_id=${payload.turn_id || '-'} `
        + `client_id=${payload.client_id || '-'} json=${jsonText}`,
      );
    }

    function apiRequest(body) {
      return new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
          const error = new Error('GM_xmlhttpRequest 不可用，请检查油猴 @grant 和 @connect 权限');
          logBridgeError(error.message, error);
          reject(error);
          return;
        }

        const cfg = getConfig();
        const reqUrl = getBridgeUrl();
        const payload = buildBridgeRequestPayload(body);
        if (shouldLogFullBridgeJson(payload)) {
          logTmToServerFull(payload);
        }
        GM_xmlhttpRequest({
          method: 'POST',
          url: reqUrl,
          headers: buildBridgeHeaders(),
          data: JSON.stringify(payload),
          timeout: cfg.bridgeRequestTimeoutMs,
          onload(response) {
            const action = body && body.action ? body.action : '-';
            const responseText = String(response.responseText || '');
            const responsePreview = responseText.slice(0, 500).replace(/\s+/g, ' ');

            if (response.status < 200 || response.status >= 300) {
              const error = new Error(
                `HTTP ${response.status} action=${action} url=${reqUrl} response=${responsePreview}`,
              );

              logBridgeError(
                `[apiRequest][http-failed] action=${action} url=${reqUrl} status=${response.status} response_len=${responseText.length} response=${responsePreview}`,
                error,
              );

              reject(error);
              return;
            }
            try {
              const responseJson = JSON.parse(response.responseText);
              if (shouldLogFullBridgeJson(payload)) {
                logServerToTmFull(payload, responseJson);
              }
              resolve(responseJson);
            } catch (error) {
              const parseError = new Error(
                `响应解析失败 action=${action} url=${reqUrl} response=${responsePreview}`,
              );

              logBridgeError(
                `[apiRequest][json-parse-failed] action=${action} url=${reqUrl} response_len=${responseText.length} response=${responsePreview}`,
                error,
              );

              reject(parseError);
            }
          },
          onerror(error) {
            const summary = summarizeBridgeError(error);
            logBridgeError(`请求失败: ${summary.message || 'unknown'}`, error);
            reject(error);
          },
          ontimeout() {
            const error = new Error(`请求超时 (${Math.round(Number(cfg.bridgeRequestTimeoutMs || 0) / 1000)} 秒): ${reqUrl}`);
            logBridgeError(error.message, error);
            reject(error);
          },
        });
      });
    }

    async function ack(messageId, success, detail) {
      const result = await apiRequest({
        action: 'ack',
        message_id: messageId,
        success,
        detail: detail || '',
        identityMode: 'full',
      });
      updateChatInputStateBadge();
      return result;
    }

    async function report(event, payload, messageId, options = {}) {
      try {
        await apiRequest({
          action: 'report',
          event,
          payload: payload || {},
          message_id: messageId || null,
          identityMode: options.identityMode || 'light',
        });
        return { ok: true };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`[REPORT] ${errText}`, error);

        if (options.throwOnError === true) {
          throw error;
        }

        return { ok: false, error: errText };
      }
    }

    async function reportStrict(event, payload, messageId) {
      return report(event, payload, messageId, { throwOnError: true });
    }

    async function reportBestEffort(event, payload, messageId) {
      return report(event, payload, messageId);
    }

    function reportFocusState(reason) {
      void reportBestEffort('focus_state', {
        reason: reason || '-',
        has_focus: document.hasFocus(),
        visibility_state: document.visibilityState,
        url: location.href,
        page_title: document.title || '',
        event_at: Date.now(),
      });
    }

    function installFocusStateListeners() {
      if (state.focusStateListenersInstalled) {
        return;
      }
      state.focusStateListenersInstalled = true;
      state.onWindowFocus = () => reportFocusState('window_focus');
      state.onWindowBlur = () => reportFocusState('window_blur');
      state.onVisibilityChange = () => reportFocusState('visibilitychange');
      window.addEventListener('focus', state.onWindowFocus, true);
      window.addEventListener('blur', state.onWindowBlur, true);
      document.addEventListener('visibilitychange', state.onVisibilityChange, true);
    }

    function removeFocusStateListeners() {
      if (!state.focusStateListenersInstalled) {
        return;
      }
      if (state.onWindowFocus) {
        window.removeEventListener('focus', state.onWindowFocus, true);
      }
      if (state.onWindowBlur) {
        window.removeEventListener('blur', state.onWindowBlur, true);
      }
      if (state.onVisibilityChange) {
        document.removeEventListener('visibilitychange', state.onVisibilityChange, true);
      }
      state.onWindowFocus = null;
      state.onWindowBlur = null;
      state.onVisibilityChange = null;
      state.focusStateListenersInstalled = false;
    }

    function buildPendingReplyTelemetryFields() {
      const ctx = loadPendingReplyContext();
      const pendingActive = !!(ctx && !ctx.reply_reported);
      let pendingTextLength = 0;
      if (pendingActive && typeof getPageCapability === 'function') {
        try {
          const cap = getPageCapability('pending-reply-telemetry');
          const preview = String(
            (cap && (cap.last_assistant_text || cap.assistant_preview || cap.last_reply_text))
            || '',
          );
          pendingTextLength = preview.length;
        } catch (error) {
          console.error('[REPLY_WATCH][TELEMETRY_TEXT_LEN_FAILED]', {
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
        }
      }
      return {
        last_dom_mutation_at: Number(state.lastDomMutationAt || 0),
        last_reply_watch_at: Number(state.lastReplyWatchAt || 0),
        pending_reply_active: pendingActive,
        pending_reply_started_at: pendingActive ? Number(ctx.sent_at || 0) : 0,
        pending_reply_text_length: pendingTextLength,
      };
    }

    function forceBridgeCatchUp(reason) {
      if (!state.bridgePollLoopActive) {
        return;
      }
      const catchReason = String(reason || 'catch_up').trim() || 'catch_up';
      try {
        if (state.bridgePollTimer) {
          window.clearTimeout(state.bridgePollTimer);
          state.bridgePollTimer = 0;
        }
        console.log('[BRIDGE][CATCH_UP]', { reason: catchReason });
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[BRIDGE][CATCH_UP] reason=${catchReason}`);
        }
        checkPageIdentityChange(catchReason);
        watchReplyCompletionAndReport();
        void runBridgePollLoop();
      } catch (error) {
        logBridgeError(`[BRIDGE][CATCH_UP][FAILED] reason=${catchReason}`, error);
      }
    }

    function installBridgeWakeHooks() {
      if (state.bridgeWakeHooksInstalled) {
        return;
      }
      state.bridgeWakeHooksInstalled = true;
      state.onBridgeWakeOnline = () => {
        if (typeof forceForegroundCatchUp === 'function') {
          void forceForegroundCatchUp('browser-online');
          return;
        }
        forceBridgeCatchUp('browser_online');
      };
      window.addEventListener('online', state.onBridgeWakeOnline, true);
    }

    function removeBridgeWakeHooks() {
      if (!state.bridgeWakeHooksInstalled) {
        return;
      }
      if (state.onBridgeWakeOnline) {
        window.removeEventListener('online', state.onBridgeWakeOnline, true);
      }
      state.onBridgeWakeOnline = null;
      state.bridgeWakeHooksInstalled = false;
    }

    function installPendingReplyDomObserver(reason) {
      const ctx = loadPendingReplyContext();
      if (!ctx || ctx.reply_reported) {
        return;
      }
      if (state.pendingReplyDomObserver) {
        return;
      }
      const target = document.querySelector('main') || document.body;
      if (!target) {
        console.error('[REPLY_WATCH][DOM_OBSERVER_FAILED]', {
          reason: reason || '-',
          error: 'missing_observer_target',
        });
        return;
      }
      const triggerWatch = () => {
        state.lastDomMutationAt = Date.now();
        if (
          typeof UploadModule !== 'undefined'
          && UploadModule
          && typeof UploadModule.getStatus === 'function'
        ) {
          const uploadStatus = UploadModule.getStatus() || {};
          if (uploadStatus.waitingReply || uploadStatus.waitingSend) {
            return;
          }
        }
        if (state.pendingReplyDomObserverTimer) {
          window.clearTimeout(state.pendingReplyDomObserverTimer);
        }
        state.pendingReplyDomObserverTimer = window.setTimeout(() => {
          state.pendingReplyDomObserverTimer = 0;
          state.lastReplyWatchAt = Date.now();
          console.log('[REPLY_WATCH][DOM_OBSERVER_TRIGGER]', {
            reason: reason || '-',
          });
          try {
            watchReplyCompletionAndReport();
          } catch (error) {
            console.error('[REPLY_WATCH][DOM_OBSERVER_FAILED]', {
              reason: reason || '-',
              error_type: error && error.name,
              error: error && error.message,
              stack: error && error.stack,
            });
          }
        }, 300);
      };
      try {
        state.pendingReplyDomObserver = new MutationObserver(() => {
          triggerWatch();
        });
        state.pendingReplyDomObserver.observe(target, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        console.log('[REPLY_WATCH][DOM_OBSERVER_START]', { reason: reason || '-' });
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[REPLY_WATCH][DOM_OBSERVER_START] reason=${reason || '-'}`);
        }
      } catch (error) {
        console.error('[REPLY_WATCH][DOM_OBSERVER_FAILED]', {
          reason: reason || '-',
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
      }
    }

    function removePendingReplyDomObserver(reason) {
      if (state.pendingReplyDomObserverTimer) {
        window.clearTimeout(state.pendingReplyDomObserverTimer);
        state.pendingReplyDomObserverTimer = 0;
      }
      if (state.pendingReplyDomObserver) {
        try {
          state.pendingReplyDomObserver.disconnect();
        } catch (error) {
          console.error('[REPLY_WATCH][DOM_OBSERVER_STOP_FAILED]', {
            reason: reason || '-',
            error_type: error && error.name,
            error: error && error.message,
            stack: error && error.stack,
          });
        }
        state.pendingReplyDomObserver = null;
        console.log('[REPLY_WATCH][DOM_OBSERVER_STOP]', { reason: reason || '-' });
        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.appendLog) {
          ToolboxShell.appendLog(`[REPLY_WATCH][DOM_OBSERVER_STOP] reason=${reason || '-'}`);
        }
      }
    }

    function shouldBridgeWaitReplyAfterBusyFailure(reason) {
      const normalized = String(reason || '').trim().toLowerCase();
      if (!normalized.includes('assistant_busy')) {
        return false;
      }
      return normalized.includes('send_not_confirmed')
        || normalized === 'assistant_busy';
    }

    const LEGACY_PENDING_REPLY_CONTEXT_KEY = 'cgpt_pending_reply_context';

    function getPendingReplyContextKey(pageInstanceId = PAGE_INSTANCE_ID) {
      const safeId = String(pageInstanceId || CLIENT_ID || 'default').trim() || 'default';
      return `cgpt_pending_reply_context:${safeId}`;
    }

    function clearPendingReplyContext(reason = '') {
      removePendingReplyDomObserver(reason || 'cleanup');
      state.pendingReplyContext = null;
      try {
        localStorage.removeItem(getPendingReplyContextKey());
        localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
      } catch (error) {
        console.error('[REPLY_CONTEXT][CLEAR_FAILED]', {
          reason,
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
      }
    }

    function cleanupPendingReplyContextStorage() {
      const now = Date.now();
      const ttlMs = 24 * 60 * 60 * 1000;
      const prefix = 'cgpt_pending_reply_context:';
      try {
        Object.keys(localStorage).forEach((key) => {
          if (!key.startsWith(prefix)) {
            return;
          }
          let ctx = null;
          try {
            ctx = JSON.parse(localStorage.getItem(key) || 'null');
          } catch (parseError) {
            console.error('[REPLY_CONTEXT][CLEANUP_PARSE_FAILED]', {
              key,
              error_type: parseError && parseError.name,
              error: parseError && parseError.message,
              stack: parseError && parseError.stack,
            });
          }
          const sentAt = Number((ctx && ctx.sent_at) || 0);
          if (!ctx || ctx.reply_reported || !sentAt || now - sentAt > ttlMs) {
            localStorage.removeItem(key);
          }
        });
        const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
        if (legacyRaw) {
          let legacyCtx = null;
          try {
            legacyCtx = JSON.parse(legacyRaw);
          } catch (legacyParseError) {
            console.error('[REPLY_CONTEXT][CLEANUP_LEGACY_PARSE_FAILED]', {
              error_type: legacyParseError && legacyParseError.name,
              error: legacyParseError && legacyParseError.message,
              stack: legacyParseError && legacyParseError.stack,
            });
          }
          const legacySentAt = Number((legacyCtx && legacyCtx.sent_at) || 0);
          if (!legacyCtx || legacyCtx.reply_reported || !legacySentAt || now - legacySentAt > ttlMs) {
            localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
          }
        }
      } catch (error) {
        console.error('[REPLY_CONTEXT][CLEANUP_FAILED]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
      }
    }

    function getConversationIdFromLocation() {
      return parseConversationIdFromPath(location.pathname || '') || '';
    }

    function hasAnyPendingReplyContextIdentity(ctx) {
      return !!(
        String(ctx && ctx.page_instance_id || '').trim()
        || String(ctx && ctx.client_id || '').trim()
        || String(ctx && ctx.conversation_id || '').trim()
      );
    }

    function isPendingReplyContextForCurrentPage(ctx) {
      if (!ctx || typeof ctx !== 'object') {
        return false;
      }

      if (!hasAnyPendingReplyContextIdentity(ctx)) {
        return false;
      }

      const identity = getPageIdentity();
      const currentPageInstanceId = String(
        identity.page_instance_id || PAGE_INSTANCE_ID || '',
      ).trim();
      const currentClientId = String(identity.client_id || CLIENT_ID || '').trim();
      const currentConversationId = getConversationIdFromLocation();

      const ctxPageInstanceId = String(ctx.page_instance_id || '').trim();
      const ctxClientId = String(ctx.client_id || '').trim();
      const ctxConversationId = String(ctx.conversation_id || '').trim();

      if (ctxPageInstanceId && currentPageInstanceId && ctxPageInstanceId !== currentPageInstanceId) {
        return false;
      }

      if (ctxClientId && currentClientId && ctxClientId !== currentClientId) {
        return false;
      }

      if (ctxConversationId) {
        if (!currentConversationId) {
          return false;
        }
        if (ctxConversationId !== currentConversationId) {
          return false;
        }
      }

      return true;
    }

    function logIgnoredForeignPendingReplyContext(ctx, phase) {
      console.info('[AUTOQ][PENDING_REPLY][IGNORE_FOREIGN_CONTEXT]', {
        phase: phase || '-',
        ctx_page_instance_id: ctx && ctx.page_instance_id,
        ctx_client_id: ctx && ctx.client_id,
        ctx_conversation_id: ctx && ctx.conversation_id,
        current_page_instance_id: PAGE_INSTANCE_ID,
        current_client_id: CLIENT_ID,
        current_conversation_id: getConversationIdFromLocation(),
      });
    }

    function parsePendingReplyContextRaw(raw) {
      if (!raw) {
        return null;
      }

      const ctx = JSON.parse(raw);
      if (!ctx || !ctx.message_id || ctx.reply_reported) {
        return null;
      }

      return ctx;
    }

    function savePendingReplyContext(message) {
      if (!message || !message.message_id) {
        return;
      }

      const identity = getPageIdentity();
      const replyBaseline = typeof getBridgeReplyBaseline === 'function'
        ? getBridgeReplyBaseline()
        : null;
      const ctx = {
        message_id: String(message.message_id || '').trim(),
        session_id: String(message.session_id || '').trim(),
        turn_id: String(message.turn_id || '').trim(),
        client_id: String(message.client_id || identity.client_id || CLIENT_ID || '').trim(),
        page_instance_id: String(
          message.page_instance_id || identity.page_instance_id || PAGE_INSTANCE_ID || '',
        ).trim(),
        conversation_id: String(
          message.conversation_id || identity.conversation_id || '',
        ).trim(),
        url: String(message.url || location.href || '').trim(),
        sent_content: String(message.content || '').trim(),
        sent_at: Date.now(),
        reply_reported: false,
        reply_baseline: replyBaseline,
      };

      state.pendingReplyContext = ctx;

      try {
        const pageKey = getPendingReplyContextKey();
        localStorage.setItem(pageKey, JSON.stringify(ctx));

        const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';
        if (legacyRaw) {
          let legacyCtx = null;
          try {
            legacyCtx = JSON.parse(legacyRaw);
          } catch (legacyParseError) {
            console.error('[REPLY_CONTEXT][LEGACY_PARSE_FAILED]', {
              error_type: legacyParseError && legacyParseError.name,
              error: legacyParseError && legacyParseError.message,
              stack: legacyParseError && legacyParseError.stack,
            });
          }

          if (!legacyCtx || isPendingReplyContextForCurrentPage(legacyCtx)) {
            localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
          }
        }
      } catch (error) {
        console.error('[REPLY_CONTEXT][SAVE_FAILED]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
      }

      console.log('[REPLY_CONTEXT][SAVE]', ctx);
    }

    function loadPendingReplyContext() {
      if (state.pendingReplyContext && !state.pendingReplyContext.reply_reported) {
        if (isPendingReplyContextForCurrentPage(state.pendingReplyContext)) {
          return state.pendingReplyContext;
        }

        logIgnoredForeignPendingReplyContext(state.pendingReplyContext, 'memory-cache');
        state.pendingReplyContext = null;
      }

      try {
        const pageKey = getPendingReplyContextKey();
        let raw = localStorage.getItem(pageKey) || '';

        if (!raw) {
          const legacyRaw = localStorage.getItem(LEGACY_PENDING_REPLY_CONTEXT_KEY) || '';
          if (!legacyRaw) {
            return null;
          }

          const legacyCtx = parsePendingReplyContextRaw(legacyRaw);
          if (!legacyCtx) {
            return null;
          }

          if (!hasAnyPendingReplyContextIdentity(legacyCtx)) {
            if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
              ToolboxShell.appendLog('[AUTOQ][PENDING_REPLY][IGNORE_LEGACY_CONTEXT_WITHOUT_IDENTITY]');
            }
            console.info('[AUTOQ][PENDING_REPLY][IGNORE_LEGACY_CONTEXT_WITHOUT_IDENTITY]');
            localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
            return null;
          }

          if (!isPendingReplyContextForCurrentPage(legacyCtx)) {
            logIgnoredForeignPendingReplyContext(legacyCtx, 'legacy-load');
            return null;
          }

          localStorage.setItem(pageKey, legacyRaw);
          localStorage.removeItem(LEGACY_PENDING_REPLY_CONTEXT_KEY);
          raw = legacyRaw;
        }

        const ctx = parsePendingReplyContextRaw(raw);
        if (!ctx) {
          return null;
        }

        if (!isPendingReplyContextForCurrentPage(ctx)) {
          logIgnoredForeignPendingReplyContext(ctx, 'page-key-load');
          return null;
        }

        state.pendingReplyContext = ctx;
        return ctx;
      } catch (error) {
        console.error('[REPLY_CONTEXT][LOAD_FAILED]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
        });
        return null;
      }
    }

    function extractLatestAssistantMessageText() {
      let text = '';
      const ctx = loadPendingReplyContext();
      if (ctx && typeof extractBridgeAssistantReplyText === 'function') {
        try {
          text = extractBridgeAssistantReplyText(ctx.reply_baseline || null);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          logBridgeError(`[REPLY_REPORT][EXTRACT_BASELINE_FAILED] error=${errText}`, error);
        }
      }

      if (!text && typeof getLatestAssistantTextFromDomDirect === 'function') {
        text = getLatestAssistantTextFromDomDirect();
      }

      if (!text) {
        const nodes = [];

        document
          .querySelectorAll('[data-message-author-role="assistant"]')
          .forEach((node) => nodes.push(node));

        if (!nodes.length) {
          document.querySelectorAll('article').forEach((node) => {
            const articleText = (node.innerText || node.textContent || '').trim();
            if (!articleText) {
              return;
            }
            if (articleText.includes('你说：') || articleText.includes('You said:')) {
              return;
            }
            nodes.push(node);
          });
        }

        if (nodes.length) {
          text = (nodes[nodes.length - 1].innerText || nodes[nodes.length - 1].textContent || '').trim();
        }
      }

      text = String(text || '')
        .replace(/ChatGPT 也可能会犯错。请核查重要信息。/g, '')
        .replace(/已思考\s*(?:若干秒|几\s*秒|\d+\s*(?:秒|分钟|m(?:in)?)(?:\s+\d+\s*s)?)\s*›?/gi, '')
        .trim();

      const pageTitle = String(document.title || '').trim();
      if (!text || text === pageTitle || text === '回复完成') {
        return '';
      }

      const sentContent = ctx ? String(ctx.sent_content || '').trim() : '';
      if (sentContent && text === sentContent) {
        return '';
      }

      if (!text) {
        text = extractChatGptPlatformErrorFromPage();
      }

      return text;
    }

    function isChatGptPlatformErrorText(text) {
      const value = String(text || '').trim();
      if (!value) {
        return false;
      }
      return /unusual\s+activity\s+has\s+been\s+detected/i.test(value)
        || /检测到.{0,16}异常.{0,8}活动/i.test(value);
    }

    function extractChatGptPlatformErrorFromPage() {
      if (typeof document === 'undefined' || !document.body) {
        return '';
      }

      const bodyText = String(document.body.innerText || document.body.textContent || '').trim();
      if (!bodyText) {
        return '';
      }

      const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      for (const line of lines) {
        if (isChatGptPlatformErrorText(line)) {
          return line;
        }
      }

      const match = bodyText.match(
        /Unusual activity has been detected[\s\S]{0,240}?Try again later(?:\.\s*\([0-9a-f-]{36}\))?/i,
      );
      if (match) {
        return String(match[0] || '').trim();
      }

      return '';
    }

    function isInvalidAssistantReplyText(text) {
      const value = String(text || '').trim();
      if (!value) {
        return true;
      }

      if (isChatGptPlatformErrorText(value)) {
        return false;
      }

      const invalidTexts = new Set([
        '正在思考',
        '正在生成',
        '思考中',
        '回复完成',
      ]);

      if (invalidTexts.has(value)) {
        return true;
      }

      if (/^已思考\s*(?:若干秒|几\s*秒|\d+\s*(?:秒|分钟|m(?:in)?)(?:\s+\d+\s*s)?)\s*›?\s*$/i.test(value)) {
        return true;
      }

      if (/^已思考.*(?:秒|分钟|m|s|›|>)/i.test(value)) {
        return true;
      }

      if (/^Thought for\s+\d+/i.test(value)) {
        return true;
      }

      if (/^Thinking/i.test(value) || /^正在思考/.test(value)) {
        return true;
      }

      return false;
    }

    function isPageStillGeneratingForReplyReport() {
      const cap = getPageCapability ? getPageCapability('assistant-reply-report') : null;
      const responseState = String((cap && cap.response_state) || '').toLowerCase();
      const reason = String((cap && cap.response_state_reason) || '').toLowerCase();

      return !!(
        cap
        && (
          cap.is_responding
          || responseState === 'generating'
          || responseState === 'responding'
          || reason === 'assistant_busy'
        )
      );
    }

    function watchReplyCompletionAndReport() {
      const ctx = loadPendingReplyContext();
      if (!ctx || ctx.reply_reported) {
        return;
      }
      state.lastReplyWatchAt = Date.now();

      const cap = getPageCapability ? getPageCapability('reply-complete-watch') : null;
      const responseState = String((cap && cap.response_state) || '').toLowerCase();
      const isResponding = !!(
        cap
        && (
          cap.is_responding
          || responseState === 'generating'
          || responseState === 'responding'
        )
      );

      const wasResponding = state.lastReplyWatchResponding === true;
      state.lastReplyWatchResponding = isResponding;

      if (isResponding) {
        return;
      }

      const ageMs = Date.now() - Number(ctx.sent_at || 0);
      if (ageMs < 1000) {
        return;
      }

      if (wasResponding || responseState === 'idle') {
        window.setTimeout(() => {
          void tryReportAssistantReplyFromCurrentPage('response_idle_after_generation');
        }, 600);
      }
    }

    async function reportAssistantReply(ctx, content, reason) {
      if (isPageStillGeneratingForReplyReport()) {
        console.warn('[REPLY_REPORT][SKIP_GENERATING]', {
          reason,
          content_preview: String(content || '').slice(0, 80),
        });
        return false;
      }

      if (isInvalidAssistantReplyText(content)) {
        console.warn('[REPLY_REPORT][SKIP_INVALID_TEXT]', {
          reason,
          content_preview: String(content || '').slice(0, 80),
        });
        return false;
      }

      const payload = withBridgeUrlFields({
        action: 'assistant_reply',
        event: 'assistant_reply',
        client_id: ctx.client_id,
        page_instance_id: ctx.page_instance_id,
        conversation_id: ctx.conversation_id,
        url: ctx.url || location.href,
        message_id: ctx.message_id,
        session_id: ctx.session_id,
        turn_id: ctx.turn_id,
        role: 'assistant',
        content,
        content_len: content.length,
        reason: reason || '',
        page_title: document.title || '',
        response_state: 'idle',
        created_at: Date.now() / 1000,
      });

      try {
        const result = await apiRequest(payload);
        logAssistantReplyReportFull(payload, ctx.message_id);

        ctx.reply_reported = true;
        clearPendingReplyContext('reported');

        console.log('[REPLY_REPORT][DONE]', {
          message_id: ctx.message_id,
          session_id: ctx.session_id,
          turn_id: ctx.turn_id,
          content_len: content.length,
          reason,
          result,
        });

        ToolboxShell.appendLog('[CHAT_REPLY][APPLY] mode=update_placeholder'
          + ` message_id=${String(ctx.message_id || '').slice(0, 8)}`
          + ` session_id=${ctx.session_id || '-'}`
          + ` turn_id=${ctx.turn_id || '-'}`
          + ` text_len=${content.length}`);
        ToolboxShell.appendLog('[REPLY][APPLIED] updated=true'
          + ` message_id=${String(ctx.message_id || '').slice(0, 8)}`
          + ` session_id=${ctx.session_id || '-'}`
          + ` turn_id=${ctx.turn_id || '-'}`);

        if (typeof ToolboxShell !== 'undefined' && ToolboxShell.setStatus) {
          setBridgeStatus('回复已回传 GUI', 'ok');
        }

        return true;
      } catch (error) {
        console.error('[REPLY_REPORT][FAILED]', {
          error_type: error && error.name,
          error: error && error.message,
          stack: error && error.stack,
          payload,
        });
        return false;
      }
    }

    async function tryReportAssistantReplyFromCurrentPage(reason) {
      const ctx = loadPendingReplyContext();
      if (!ctx || ctx.reply_reported) {
        return false;
      }

      if (!isPendingReplyContextForCurrentPage(ctx)) {
        logIgnoredForeignPendingReplyContext(ctx, 'try-report');
        return false;
      }

      const cap = getPageCapability ? getPageCapability('reply-report') : null;
      const responseState = String((cap && cap.response_state) || '').toLowerCase();
      const isResponding = !!(
        cap
        && (
          cap.is_responding
          || responseState === 'generating'
          || responseState === 'responding'
        )
      );

      if (isResponding) {
        return false;
      }

      const ageMs = Date.now() - Number(ctx.sent_at || 0);
      if (ageMs < 800) {
        return false;
      }

      let content = extractLatestAssistantMessageText();
      if (!content) {
        content = extractChatGptPlatformErrorFromPage();
      }

      if (isInvalidAssistantReplyText(content)) {
        console.warn('[REPLY_REPORT][SKIP_INVALID_TEXT]', {
          reason,
          content_preview: String(content || '').slice(0, 80),
        });
        return false;
      }

      if (!content) {
        console.warn('[REPLY_REPORT][SKIP_EMPTY]', {
          reason,
          age_ms: ageMs,
          response_state: responseState,
          title: document.title,
          article_count: document.querySelectorAll('article').length,
          assistant_count: document.querySelectorAll('[data-message-author-role="assistant"]').length,
        });
        return false;
      }

      await reportAssistantReply(ctx, content, reason);
      return true;
    }

    async function waitForBridgeAssistantReply(messageId, result, replyBaseline = null) {
      const sessionId = String(result.session_id || '').trim();
      const turnId = String(result.turn_id || '').trim();
      const identity = getPageIdentity();
      const timeoutMs = 10 * 60 * 1000;
      const noBusyGraceMs = 15000;
      const stableTextMs = 1500;
      const pollMs = 800;
      const checkLogIntervalMs = 3000;
      const startedAt = Date.now();
      let idleSince = 0;
      let sawBusy = false;
      let lastAssistantText = '';
      let lastCheckLogAt = 0;

      const safeCheckAssistantBusy = () => {
        try {
          return typeof ComposerApi.isAssistantLikelyBusy === 'function'
            ? ComposerApi.isAssistantLikelyBusy()
            : false;
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          logBridgeError(`[BRIDGE][REPLY_WAIT] busy-check-failed error=${errText}`, error);
          return false;
        }
      };

      ToolboxShell.appendLog(
        `[BRIDGE][REPLY_WAIT][START] messageId=${String(messageId || '').slice(0, 8)} `
        + `session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
      );

      ChatInputStateRuntime.waitingForReply = true;
      updateChatInputStateBadge();

      while (Date.now() - startedAt < timeoutMs) {
        if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
          ChatInputStateRuntime.waitingForReply = false;
          updateChatInputStateBadge();
          return false;
        }

        const busy = safeCheckAssistantBusy();

        if (busy) {
          sawBusy = true;
          idleSince = 0;
        }
        ChatInputStateRuntime.waitingForReply = true;
        updateChatInputStateBadge();

        let text = '';
        try {
          text = extractBridgeAssistantReplyText(replyBaseline);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          logBridgeError(`[BRIDGE][REPLY_WAIT] extract-failed error=${errText}`, error);
        }

        if (!text) {
          text = extractChatGptPlatformErrorFromPage();
        }

        if (text && isChatGptPlatformErrorText(text)) {
          const ctx = loadPendingReplyContext();
          if (ctx && ctx.message_id === messageId) {
            const reported = await reportAssistantReply(
              ctx,
              text,
              'reply_wait_platform_error',
            );
            if (reported) {
              ToolboxShell.appendLog(
                `[BRIDGE][REPLY_WAIT][PLATFORM_ERROR] messageId=${String(messageId || '').slice(0, 8)} `
                + `text_len=${text.length}`
              );
              ChatInputStateRuntime.waitingForReply = false;
              updateChatInputStateBadge();
              return true;
            }
          }
        }

        const now = Date.now();
        if (now - lastCheckLogAt >= checkLogIntervalMs) {
          lastCheckLogAt = now;
          const idleMs = idleSince ? now - idleSince : 0;
          ToolboxShell.appendLog(
            `[BRIDGE][REPLY_WAIT][CHECK] busy=${busy ? 'true' : 'false'} `
            + `text_len=${text.length} same_as_last=${text && text === lastAssistantText ? 'true' : 'false'} `
            + `idle_ms=${idleMs} saw_busy=${sawBusy ? 'true' : 'false'}`
          );
        }

        if (text && !busy && !isInvalidAssistantReplyText(text)) {
          if (text === lastAssistantText) {
            if (!idleSince) {
              idleSince = Date.now();
            }

            const stableMs = Date.now() - idleSince;
            const stableEnough = stableMs >= stableTextMs;

            if (stableEnough) {
              const ctx = loadPendingReplyContext();
              if (ctx && ctx.message_id === messageId) {
                const reported = await reportAssistantReply(
                  ctx,
                  text,
                  'reply_wait_idle_stable',
                );
                if (reported) {
                  ToolboxShell.appendLog(
                    `[BRIDGE][REPLY_WAIT][REPORT] messageId=${String(messageId || '').slice(0, 8)} `
                    + `text_len=${text.length}`
                  );
                  ToolboxShell.appendLog(
                    `[CHAT][WAITING_END] messageId=${String(messageId || '').slice(0, 8)}`
                    + ` session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
                    + ` text_len=${text.length}`
                  );
                  ChatInputStateRuntime.waitingForReply = false;
                  updateChatInputStateBadge();
                  return true;
                }
              }
            }
          } else {
            lastAssistantText = text;
            idleSince = Date.now();
          }
        }

        if (!sawBusy && Date.now() - startedAt >= noBusyGraceMs && !lastAssistantText) {
          const emptyReason = 'no-busy-observed-and-no-assistant-after-latest-user';
          ToolboxShell.appendLog(
            `[BRIDGE][REPLY_WAIT][EMPTY] reason=${emptyReason} messageId=${String(messageId || '').slice(0, 8)}`
          );
          await report(
            'assistant_reply_empty',
            withBridgeUrlFields({
              session_id: sessionId,
              turn_id: turnId,
              client_id: identity.client_id || CLIENT_ID,
              page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
              conversation_id: identity.conversation_id || '',
              reason: emptyReason,
            }),
            messageId,
          );
          ChatInputStateRuntime.waitingForReply = false;
          updateChatInputStateBadge();
          return false;
        }

        updateChatInputStateBadge();
        await sleep(pollMs);
      }

      const timeoutReason = 'reply-wait-timeout';
      ToolboxShell.appendLog(
        `[BRIDGE][REPLY_WAIT][EMPTY] reason=${timeoutReason} messageId=${String(messageId || '').slice(0, 8)}`
      );
      await report(
        'assistant_reply_empty',
        withBridgeUrlFields({
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          reason: timeoutReason,
        }),
        messageId,
      );
      ChatInputStateRuntime.waitingForReply = false;
      updateChatInputStateBadge();
      return false;
    }

    async function sendTextToChatGPT(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const content = bridgeContentFrom(normalized);
      const sessionId = String(normalized.session_id || '').trim();
      const turnId = String(normalized.turn_id || '').trim();
      savePendingReplyContext(normalized);
      const identity = getPageIdentity();
      const targetUrl = bridgeUrlFrom(normalized);
      const allowReplaceDraft = normalized.allow_replace_draft === true
        || normalized.payload?.allow_replace_draft === true;

      const blockReason = String(state.uploadBlockNextChatReason || '');
      const blockAt = Number(state.uploadBlockNextChatAt || 0);
      const blockFresh = blockReason && Date.now() - blockAt <= 60000;

      if (blockReason && blockFresh) {
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';

        await ack(messageId, false, blockReason);
        await report('send_failed', {
          reason: 'upload_before_send_failed',
          detail: blockReason,
          text_len: content.length,
        }, messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][BLOCK_CHAT] messageId=${String(messageId || '').slice(0, 8)} reason=${blockReason}`
        );

        return false;
      }

      if (blockReason && !blockFresh) {
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][BLOCK_CHAT_EXPIRED] age=${Date.now() - blockAt} reason=${blockReason}`
        );
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';
      }

      if (!content.trim()) {
        await ack(messageId, false, '消息内容为空');
        await reportBestEffort('send_failed', withBridgeUrlFields({
          reason: 'empty_content',
          text_len: 0,
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          url: targetUrl,
        }), messageId);
        return false;
      }

      const replyBaseline = getBridgeReplyBaseline();

      if (typeof updateQueuedEntryStatus === 'function') {
        updateQueuedEntryStatus(messageId, MESSAGE_STATUS.DISPATCHING);
      }
      ChatInputStateRuntime.pendingTurnId = turnId;
      ChatInputStateRuntime.pendingRequestId = normalized.request_id || messageId;

      ToolboxShell.appendLog(
        `[SEND][DISPATCH] message_id=${String(messageId || '').slice(0, 8)}`
        + ` session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
        + ` content_len=${content.length}`
      );

      const sendResult = await sendContentViaComposer({
        source: 'bridge',
        content,
        allowReplaceDraft,
        waitUntilSendable: true,
        timeoutMs: 60000,
        blockWhenResponding: false,
      });

      if (!sendResult.ok) {
        const reason = sendResult.reason || 'send_failed';
        if (shouldBridgeWaitReplyAfterBusyFailure(reason)) {
          await ack(
            messageId,
            true,
            `已发送到 ChatGPT：assistant_busy（等待回复） detail=${reason}`,
          );
          installPendingReplyDomObserver('send_success_busy_wait');
          ToolboxShell.appendLog(
            `[BRIDGE][SEND][BUSY_WAIT] messageId=${String(messageId || '').slice(0, 8)} `
            + `reason=${reason}`,
          );
          try {
            await waitForBridgeAssistantReply(messageId, normalized, replyBaseline);
          } catch (error) {
            const errText = error && error.message ? error.message : String(error);
            logBridgeError(`[BRIDGE][REPLY_WAIT] failed error=${errText}`, error);
            await report(
              'assistant_reply_failed',
              withBridgeUrlFields({
                session_id: sessionId,
                turn_id: turnId,
                client_id: identity.client_id || CLIENT_ID,
                page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
                conversation_id: identity.conversation_id || '',
                reason: errText,
              }),
              messageId,
            );
          }
          if (typeof releasePendingReplyState === 'function') {
            releasePendingReplyState('reply_applied', messageId, normalized);
          }
          window.setTimeout(() => {
            void processBridgeChatQueue();
          }, 200);
          return true;
        }

        const ackMessages = {
          assistant_busy: 'ChatGPT 正在生成回复，暂不能发送',
          composer_has_existing_text: 'ChatGPT 输入框已有内容，已拒绝覆盖草稿',
          composer_not_found: '没有找到 ChatGPT 输入框',
          send_button_unavailable: '输入成功，但发送按钮不可用',
          send_button_wait_timeout: '发送失败：等待发送按钮超时',
          click_send_failed: '点击发送失败',
        };
        const ackText = ackMessages[reason]
          || (reason.startsWith('send_not_confirmed')
            ? `点击发送后未确认成功：${reason}`
            : `发送失败：${reason}`);

        await ack(messageId, false, ackText);
        await report('send_failed', withBridgeUrlFields({
          reason,
          text_len: content.length,
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          url: targetUrl,
        }), messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][SEND][FAILED] messageId=${String(messageId || '').slice(0, 8)} reason=${reason}`,
        );
        logBridgeError(`发送失败 reason=${reason}`);
        clearPendingReplyContext('send_failed');
        return false;
      }

      const nonSuccessReasons = new Set([
        'assistant_busy',
        'composer_has_existing_text',
        'composer_not_found',
        'composer_empty',
        'send_button_unavailable',
        'send_button_wait_timeout',
        'click_send_failed',
        'empty_content',
        'cannot_accept_input',
      ]);
      if (!sendResult.ok || nonSuccessReasons.has(sendResult.reason)) {
        const reason = sendResult.reason || 'send_failed';
        await ack(messageId, false, reason);
        await report('send_failed', withBridgeUrlFields({
          reason,
          text_len: content.length,
          session_id: sessionId,
          turn_id: turnId,
          client_id: identity.client_id || CLIENT_ID,
          page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
          conversation_id: identity.conversation_id || '',
          url: targetUrl,
        }), messageId);
        ToolboxShell.appendLog(
          `[BRIDGE][SEND][FAILED] messageId=${String(messageId || '').slice(0, 8)} reason=${reason}`,
        );
        logBridgeError(`发送失败 reason=${reason}`);
        clearPendingReplyContext('send_failed');
        return false;
      }

      await ack(messageId, true, `已发送到 ChatGPT：${sendResult.reason}`);
      installPendingReplyDomObserver('send_success');
      if (typeof updateQueuedEntryStatus === 'function') {
        updateQueuedEntryStatus(messageId, MESSAGE_STATUS.BROWSER_SENT);
      }
      ToolboxShell.appendLog(
        `[SEND][ACK] message_id=${String(messageId || '').slice(0, 8)}`
        + ` session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
        + ` reason=${sendResult.reason}`
      );
      await report('send_success', withBridgeUrlFields({
        reason: sendResult.reason,
        message_status: sendResult.reason,
        text_len: content.length,
        session_id: sessionId,
        turn_id: turnId,
        client_id: identity.client_id || CLIENT_ID,
        page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
        conversation_id: identity.conversation_id || '',
        url: targetUrl,
        ok: true,
      }), messageId);

      try {
        await waitForBridgeAssistantReply(messageId, normalized);
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`[BRIDGE][REPLY_WAIT] failed error=${errText}`, error);
        await report(
          'assistant_reply_failed',
          withBridgeUrlFields({
            session_id: sessionId,
            turn_id: turnId,
            client_id: identity.client_id || CLIENT_ID,
            page_instance_id: identity.page_instance_id || PAGE_INSTANCE_ID,
            conversation_id: identity.conversation_id || '',
            reason: errText,
          }),
          messageId,
        );
      }

      if (typeof releasePendingReplyState === 'function') {
        releasePendingReplyState('reply_applied', messageId, normalized);
      }
      window.setTimeout(() => {
        void processBridgeChatQueue();
      }, 200);
      return true;
    }

    async function closeCurrentPageCommand(messageId) {
      await report('close_page_requested', withBridgeUrlFields({}), messageId);
      await ack(messageId, true, '已发起关闭当前页面请求');

      window.setTimeout(() => {
        try {
          window.open('', '_self');
          window.close();
        } catch (error) {
          logBridgeError(`window.close 失败: ${error && error.message ? error.message : String(error)}`, error);
        }

        window.setTimeout(() => {
          report('close_page_still_alive', withBridgeUrlFields({
            page_title: document.title || '',
            event_at: Date.now(),
          }), messageId);
        }, 1000);
      }, 200);
      return true;
    }

    async function focusSelfCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const targetUrl = location.href;
      try {
        if (typeof GM_openInTab === 'function') {
          GM_openInTab(targetUrl, {
            active: true,
            insert: true,
            setParent: true,
          });
        }
        window.focus();
        forceBridgeCatchUp('focus_self_command');
        await report('focus_self_done', withBridgeUrlFields({
          url: targetUrl,
          has_focus: document.hasFocus(),
          visibility_state: document.visibilityState,
        }), messageId);
        await ack(messageId, true, '已聚焦当前 ChatGPT 标签页');
        return true;
      } catch (error) {
        logBridgeError(
          `focus_self 失败: ${error && error.message ? error.message : String(error)}`,
          error,
        );
        await ack(
          messageId,
          false,
          `聚焦页面失败: ${error && error.message ? error.message : String(error)}`,
        );
        return false;
      }
    }

    async function openUrlCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const url = bridgeUrlFrom(normalized);
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          await ack(messageId, false, `不允许打开非 http/https 地址: ${url}`);
          return false;
        }
        if (typeof GM_openInTab === 'function') {
          GM_openInTab(parsed.href, {
            active: result.active !== false,
            insert: true,
            setParent: true,
          });
        } else {
          window.open(parsed.href, '_blank', 'noopener,noreferrer');
        }

        await report('open_url_requested', withBridgeUrlFields({
          url: parsed.href,
          active: result.active !== false,
        }), messageId);

        await ack(messageId, true, `已发起打开请求: ${parsed.href}`);
        return true;
      } catch (error) {
        logBridgeError(`open_url 失败: ${error && error.message ? error.message : String(error)}`, error);
        await ack(messageId, false, `打开网页失败: ${error && error.message ? error.message : String(error)}`);
        return false;
      }
    }

    function setUploadBlockReason(reason, sourceMessageId) {
      state.uploadBlockNextChatReason = String(reason || '');
      state.uploadBlockNextChatAt = Date.now();
      state.uploadBlockNextChatSourceMessageId = String(sourceMessageId || '');
    }

    function base64ToUint8Array(base64) {
      const binary = atob(String(base64 || ''));
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    // Single-file bridge upload: attaches one payload file via ComposerApi only.
    // Not equivalent to the multi-file UploadModule queue; does not update queue stats or upload task state.
    async function uploadCurrentFileCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const payload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const fileInfo = payload.file && typeof payload.file === 'object' ? payload.file : {};
      const requestId = String(payload.request_id || '').trim();

      await report('command_received', {
        command: 'upload_current_file',
        request_id: requestId,
      }, messageId);

      if (!fileInfo.content_base64) {
        const reason = '上传命令缺少文件内容';
        await report('command_failed', {
          command: 'upload_current_file',
          request_id: requestId,
          reason,
        }, messageId);
        await ack(messageId, false, reason);
        return false;
      }

      try {
        const bytes = base64ToUint8Array(fileInfo.content_base64);
        const mime = fileInfo.mime || 'application/octet-stream';
        const name = fileInfo.name || 'upload.bin';
        const blob = new Blob([bytes], { type: mime });
        const file = new File([blob], name, {
          type: mime,
          lastModified: Date.now(),
        });

        if (!ComposerApi || typeof ComposerApi.attachFilesByFileInput !== 'function') {
          throw new Error('ComposerApi.attachFilesByFileInput 不可用');
        }

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD_CURRENT_FILE][START] request_id=${requestId || '-'} `
          + `name=${name} size=${file.size}`,
        );

        const uploadResult = await ComposerApi.attachFilesByFileInput([file], 12000, {
          uploadOnly: true,
          requireSendReady: false,
        });

        if (!uploadResult || !uploadResult.ok) {
          const reason = (uploadResult && uploadResult.reason)
            ? uploadResult.reason
            : '未找到 ChatGPT 文件上传 input 或设置 input.files 失败';

          await report('control_done', {
            command: 'upload_current_file',
            request_id: requestId,
            ok: false,
            message: reason,
            detail: { file_name: name },
            result: uploadResult || {},
          }, messageId);

          await report('command_failed', {
            command: 'upload_current_file',
            request_id: requestId,
            reason,
          }, messageId);

          await ack(messageId, false, reason);
          return false;
        }

        const detail = {
          file_name: name,
          size: file.size,
        };

        await report('control_done', {
          command: 'upload_current_file',
          request_id: requestId,
          ok: true,
          message: '文件已提交到上传控件',
          detail,
          result: uploadResult,
        }, messageId);

        await ack(messageId, true, `文件已提交：${name}`);
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD_CURRENT_FILE][OK] request_id=${requestId || '-'} name=${name}`,
        );
        return true;
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const reason = `上传当前文件失败：${errText}`;

        console.error('[ChatGPT toolbox] upload_current_file command failed', error);
        ToolboxShell.appendLog(`[BRIDGE][UPLOAD_CURRENT_FILE][FAILED] ${reason}`);

        await report('control_done', {
          command: 'upload_current_file',
          request_id: requestId,
          ok: false,
          message: reason,
          result: { reason: errText },
        }, messageId);

        await report('command_failed', {
          command: 'upload_current_file',
          request_id: requestId,
          reason: errText,
        }, messageId);

        await ack(messageId, false, reason);
        return false;
      }
    }

    async function startUploadCommand(result) {
      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;
      const payload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const bridgeSource = 'bridge_command';

      const isNoFilesBridgeReason = (reason) => {
        const normalizedReason = String(reason || '').trim();
        return (
          normalizedReason === 'no-files'
          || normalizedReason === 'no-pending-files'
          || normalizedReason === 'empty-queue'
        );
      };

      const setUploadBlockOnFailed = (reason) => {
        if (payload.block_next_chat_on_failed !== false) {
          setUploadBlockReason(reason, messageId);
        }
      };

      if (
        !UploadModule
        || typeof UploadModule.runStartUploadButtonCore !== 'function'
      ) {
        const reason = 'UploadModule.runStartUploadButtonCore 不存在，无法执行油猴上传';
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason,
        }, messageId);

        return false;
      }

      let uploadResult = null;
      let queueResult = null;

      try {
        ToolboxShell.appendLog(
          `[TM_CONTROL][START_UPLOAD][RECEIVED] source=${bridgeSource}`
        );
        console.log(
          `[TM_CONTROL][START_UPLOAD][RECEIVED] source=${bridgeSource}`
        );

        await report('command_received', {
          command: 'start_upload',
        }, messageId);

        // Unified manual-upload entry (syncs upload task + button state).
        // For queue-only uploads that must bypass manual UI state, call startUploadFromCurrentQueue directly.
        queueResult = await UploadModule.runStartUploadButtonCore({
          source: bridgeSource,
        });
        const uploadStatus = UploadModule.getStatus
          ? UploadModule.getStatus()
          : {};
        const runtimeStatus = UploadModule.getUnifiedRuntimeStatus
          ? UploadModule.getUnifiedRuntimeStatus('bridge:start_upload')
          : null;
        uploadResult = {
          success: queueResult && queueResult.ok ? Number(queueResult.uploadedCount) || 0 : 0,
          failed: Number(queueResult && queueResult.failedCount) || 0,
          cancelled: !!(queueResult && (queueResult.cancelled || queueResult.reason === 'cancelled')),
          total: (Number(queueResult && queueResult.uploadedCount) || 0)
            + (Number(queueResult && queueResult.failedCount) || 0)
            + (Number(queueResult && queueResult.skippedCount) || 0),
          skipped: !!(queueResult && !queueResult.ok && isNoFilesBridgeReason(queueResult.reason)),
          reason: String(queueResult && queueResult.reason || ''),
          upload_status: uploadStatus,
          runtime_status: runtimeStatus,
          queue_result: queueResult,
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        const reason = `发送前上传失败：${errText}`;

        console.error('[ChatGPT toolbox] start_upload command failed', error);
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason: errText,
        }, messageId);

        return false;
      }

      const uploadStatus = uploadResult && uploadResult.upload_status
        ? uploadResult.upload_status
        : {};
      const runtimeStatus = uploadResult && uploadResult.runtime_status
        ? uploadResult.runtime_status
        : (
          UploadModule && typeof UploadModule.getUnifiedRuntimeStatus === 'function'
            ? UploadModule.getUnifiedRuntimeStatus('bridge:start_upload:post-check')
            : null
        );
      const uploadTaskPhase = runtimeStatus && runtimeStatus.uploadTask
        ? String(runtimeStatus.uploadTask.phase || 'idle').trim().toLowerCase()
        : 'idle';
      const uploadTaskStillActive = uploadTaskPhase === 'uploading' || uploadTaskPhase === 'cancelling';
      const legacyUploadRunning = !!(
        runtimeStatus
        && runtimeStatus.legacyFlags
        && runtimeStatus.legacyFlags.running
      );

      const success = Number(uploadResult && uploadResult.success) || 0;
      const failed = Number(uploadResult && uploadResult.failed) || 0;
      const attached = Number(uploadStatus.attached) || 0;
      const cancelled = Boolean(uploadResult && uploadResult.cancelled);
      const skipped = Boolean(uploadResult && uploadResult.skipped);
      const requireAllSuccess = payload.require_all_success !== false;

      let ok = true;
      let reason = '';

      if (cancelled) {
        ok = false;
        reason = '发送前上传已取消';
      } else if (requireAllSuccess && failed > 0) {
        ok = false;
        reason = `发送前上传存在失败文件：failed=${failed}`;
      } else if (success <= 0 && attached <= 0) {
        ok = false;
        reason = skipped
          ? `发送前上传跳过：${uploadResult.reason || '没有可上传文件'}`
          : '发送前上传没有成功文件';
      } else if (uploadTaskStillActive && !legacyUploadRunning && !uploadStatus.running) {
        ok = false;
        reason = `上传任务状态未复位：uploadTask.phase=${uploadTaskPhase}`;
      }

      if (!ok) {
        setUploadBlockOnFailed(reason);

        await ack(messageId, false, reason);
        await report('command_failed', {
          command: 'start_upload',
          reason,
          result: uploadResult,
        }, messageId);

        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][FAILED] reason=${reason} success=${success} failed=${failed} attached=${attached}`
        );

        return false;
      }

      if (state.uploadBlockNextChatReason) {
        ToolboxShell.appendLog(
          `[BRIDGE][UPLOAD][CLEAR_OLD_BLOCK] reason=${state.uploadBlockNextChatReason}`
        );
        state.uploadBlockNextChatReason = '';
        state.uploadBlockNextChatAt = 0;
        state.uploadBlockNextChatSourceMessageId = '';
      }

      await report('control_done', {
        command: 'start_upload',
        result: uploadResult,
      }, messageId);

      await ack(
        messageId,
        true,
        `上传完成：success=${success}, failed=${failed}, attached=${attached}`,
      );

      ToolboxShell.appendLog(
        `[BRIDGE][UPLOAD][OK] success=${success} failed=${failed} attached=${attached}`
      );

      return true;
    }

    async function handleCommandMessage(result) {
      const normalized = normalizeBridgePollMessage(result);
      const cmdPayload = normalized.payload && typeof normalized.payload === 'object'
        ? normalized.payload
        : {};
      const command = String(
        normalized.command
        || cmdPayload.command
        || normalized.action
        || ''
      ).trim();
      const messageId = normalized.message_id || normalized.id;
      if (command === 'close_self') {
        return await closeCurrentPageCommand(messageId);
      }
      if (command === 'open_url') {
        return await openUrlCommand(normalized);
      }
      if (command === 'focus_self') {
        return await focusSelfCommand(normalized);
      }
      if (command === 'sync_conversation') {
        if (!messageId) {
          ToolboxShell.appendLog('[BRIDGE][SYNC_CONVERSATION][FAILED] reason=missing_message_id');
          return false;
        }
        try {
          if (typeof waitChatPageReady === 'function') {
            const readyResult = await waitChatPageReady({ timeoutMs: 30000 });

            if (readyResult && readyResult.ok) {
              ToolboxShell.appendLog('[CONVERSATION][RESTORE_READY]');
            } else {
              ToolboxShell.appendLog('[CONVERSATION][RESTORE_TIMEOUT]');
            }
          }

          const responseState = detectResponseState({ force: true, reason: 'sync_conversation' });
          const capability = getPageCapability('sync_conversation');
          const snapshot = buildConversationSnapshotForBridge(getPageIdentity, {
            source: 'bridge-sync-conversation',
          });
          const cmdPayload = normalized.payload && typeof normalized.payload === 'object'
            ? normalized.payload
            : {};
          const identity = getPageIdentity();
          const snapshotUrl = bridgeUrlFrom(cmdPayload)
            || bridgeUrlFrom(snapshot.page)
            || bridgeUrlFrom(identity)
            || location.href;
          const syncRequestId = String(
            cmdPayload.sync_request_id
            || cmdPayload.request_id
            || snapshot.sync_request_id
            || snapshot.request_id
            || ''
          ).trim();
          const snapshotStats = snapshot.stats && typeof snapshot.stats === 'object'
            ? snapshot.stats
            : {};
          const reportPayload = {
            request_id: syncRequestId,
            session_id: cmdPayload.session_id || snapshot.session_id || '',
            conversation_id: cmdPayload.conversation_id || snapshot.conversation_id || identity.conversation_id || '',
            client_id: cmdPayload.client_id || snapshot.client_id || identity.client_id || CLIENT_ID,
            page_instance_id: cmdPayload.page_instance_id || snapshot.page_instance_id || identity.page_instance_id || PAGE_INSTANCE_ID,
            page_display_id: identity.page_display_id || getCurrentBridgePageDisplayId() || '',
            url: snapshotUrl,
            messages: snapshot.messages || [],
            stats: snapshotStats,
            message_count: Number(snapshotStats.total_count || 0) || (Array.isArray(snapshot.messages) ? snapshot.messages.length : 0),
            user_count: Number(snapshotStats.user_count || 0),
            assistant_count: Number(snapshotStats.assistant_count || 0),
            round_count: Number(snapshotStats.round_count || 0),
            dom_estimated_round_count: Number(snapshotStats.dom_estimated_round_count || 0),
            mode: cmdPayload.mode || snapshot.mode || 'merge',
            ok: true,
            command_type: cmdPayload.command_type || 'read_snapshot',
            capability,
            syncable: (capability.url && capability.conversation_id),
            conversation_syncable: capability.conversation_syncable,
            can_accept_input: Boolean(responseState.can_accept_input),
            can_send_now: Boolean(responseState.can_send_now),
            is_responding: Boolean(responseState.is_responding),
            response_state: responseState.response_state || 'unknown',
            response_state_reason: responseState.response_state_reason || '',
          };

          logPageCapability(capability, '[SYNC][BRIDGE]');
          ToolboxShell.appendLog(
            `[BRIDGE][SYNC_CONVERSATION][report] message_id=${String(messageId).slice(0, 8)} `
            + `messages=${reportPayload.message_count} `
            + `user=${reportPayload.user_count} `
            + `assistant=${reportPayload.assistant_count} `
            + `round=${reportPayload.round_count} `
            + `dom_estimated_round=${reportPayload.dom_estimated_round_count} `
            + `page_display_id=${reportPayload.page_display_id || '-'} `
            + `session_id=${reportPayload.session_id || '-'} `
            + `request_id=${reportPayload.request_id || '-'}`,
          );

          const reportResult = await reportStrict(
            'conversation_snapshot',
            reportPayload,
            messageId,
          );
          if (!reportResult || reportResult.ok === false) {
            const reportErr = (reportResult && reportResult.error) ? reportResult.error : 'report_failed';
            throw new Error(`conversation_snapshot report failed: ${reportErr}`);
          }

          const ackResult = await ack(messageId, true, '已回传当前页面快照');
          if (ackResult && ackResult.ok === false) {
            ToolboxShell.appendLog(
              `[BRIDGE][SYNC_CONVERSATION][ack-rejected] message_id=${String(messageId).slice(0, 8)} `
              + `error=${ackResult.error || 'unknown'}`,
            );
          }
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          const errStack = error && error.stack ? error.stack : errText;
          console.error('[ChatGPT toolbox] sync_conversation report failed', error);
          ToolboxShell.appendLog(`[BRIDGE][SYNC_CONVERSATION][report-failed] error=${errStack}`);
          await ack(messageId, false, `同步对话失败：${errText}`);
          return false;
        }
        return true;
      }
      if (command === 'start_upload') {
        return await startUploadCommand(normalized);
      }
      if (command === 'upload_current_file') {
        return await uploadCurrentFileCommand(normalized);
      }
      if (command === 'orch_action') {
        const orchCmd = cmdPayload.orch && typeof cmdPayload.orch === 'object'
          ? cmdPayload.orch
          : cmdPayload;
        if (
          typeof OrchAtomicClient === 'undefined'
          || !OrchAtomicClient
          || typeof OrchAtomicClient.executeOrchCommand !== 'function'
        ) {
          await ack(messageId, false, 'OrchAtomicClient 未加载');
          return false;
        }
        try {
          await OrchAtomicClient.executeOrchCommand(orchCmd);
          await ack(messageId, true, 'orch_action');
          return true;
        } catch (orchErr) {
          const errText = orchErr && orchErr.message ? orchErr.message : String(orchErr);
          console.error('[BRIDGE][ORCH_ACTION][FAILED]', {
            run_id: orchCmd && orchCmd.run_id,
            step_id: orchCmd && orchCmd.step_id,
            action: orchCmd && orchCmd.action,
            error_type: orchErr && orchErr.name,
            error: errText,
            stack: orchErr && orchErr.stack,
          });
          await ack(messageId, false, errText);
          return false;
        }
      }
      await ack(messageId, false, `未知命令: ${command || '-'}`);
      return false;
    }

    async function processBridgeChatQueue() {
      if (typeof CHAT_QUEUE === 'undefined' || !Array.isArray(CHAT_QUEUE)) {
        return;
      }

      while (CHAT_QUEUE.length > 0) {
        if (state.handlingMessageId) {
          ToolboxShell.appendLog(
            `[CHAT_QUEUE][WAIT] reason=handling_in_progress queue_size=${CHAT_QUEUE.length}`
          );
          return;
        }

        if (typeof hasPendingReply === 'function' && hasPendingReply('')) {
          ToolboxShell.appendLog(
            `[CHAT_QUEUE][WAIT] reason=pending_reply queue_size=${CHAT_QUEUE.length}`
          );
          return;
        }

        const entry = CHAT_QUEUE[0];
        if (!entry || !entry.message_id || entry.status !== MESSAGE_STATUS.QUEUED) {
          CHAT_QUEUE.shift();
          continue;
        }

        CHAT_QUEUE.shift();
        const sessionId = String(entry.session_id || '').trim();
        const turnId = String(entry.turn_id || '').trim();

        ToolboxShell.appendLog(
          `[CHAT_QUEUE][PROCESS] queued_message_id=${String(entry.message_id || '').slice(0, 8)}`
          + ` session_id=${sessionId || '-'} turn_id=${turnId || '-'}`
        );

        updateQueuedEntryStatus(entry.message_id, MESSAGE_STATUS.DISPATCHING);

        let ok = false;
        try {
          state.handlingMessageId = entry.message_id;
          ok = await sendTextToChatGPT(entry);
        } catch (error) {
          const errText = error && error.message ? error.message : String(error);
          const errName = error && error.name ? error.name : 'Error';
          console.error('[CHAT_QUEUE][PROCESS_FAILED]', {
            error_type: errName,
            error: errText,
            stack: error && error.stack,
          });
          ToolboxShell.appendLog(
            `[CHAT_QUEUE][PROCESS_FAILED] message_id=${String(entry.message_id || '').slice(0, 8)}`
            + ` type=${errName} error=${errText}`
          );
          updateQueuedEntryStatus(entry.message_id, MESSAGE_STATUS.FAILED, {
            error: errText,
            error_type: errName,
          });
        } finally {
          if (state.handlingMessageId === entry.message_id) {
            state.handlingMessageId = null;
          }
        }

        if (!ok) {
          ToolboxShell.appendLog(
            `[CHAT_QUEUE][SEND_FAILED] message_id=${String(entry.message_id || '').slice(0, 8)}`
          );
        }
      }
    }

    async function handleOutboundMessage(result) {
      if (!result || !result.has_message) {
        return {
          handled: false,
          ok: true,
          reason: 'no-message',
        };
      }

      const normalized = normalizeBridgePollMessage(result);
      const messageId = normalized.message_id || normalized.id;

      if (!messageId) {
        logBridgeError('服务端消息缺少 message_id');
        return {
          handled: false,
          ok: false,
          reason: 'missing-message-id',
        };
      }

      // ── Pending reply check: queue instead of dropping ──
      const sessionId = String(normalized.session_id || '').trim();
      const turnId = String(normalized.turn_id || '').trim();
      const content = bridgeContentFrom(normalized);

      if (typeof hasPendingReply === 'function' && hasPendingReply(sessionId)) {
        const queueResult = typeof enqueueChatQueueEntry === 'function'
          ? enqueueChatQueueEntry(normalized, 'pending-reply')
          : { ok: true, queued: true, duplicate: false, entry: createQueuedMessageEntry(normalized) };
        if (queueResult.duplicate) {
          return {
            handled: true,
            ok: true,
            queued: true,
            duplicate: true,
            reason: 'duplicate_message_id',
          };
        }

        ToolboxShell.appendLog(
          `[SEND][BLOCK] reason=pending_reply message_id=${String(messageId || '').slice(0, 8)}`
          + ` session_id=${sessionId || '-'} queue_size=${CHAT_QUEUE.length}`
        );
        ToolboxShell.appendLog(
          `[CHAT_QUEUE][ENQUEUE] queue_size=${CHAT_QUEUE.length} message_id=${String(messageId || '').slice(0, 8)}`
        );

        await report('queued_pending_reply', {
          message_id: messageId,
          session_id: sessionId,
          turn_id: turnId,
          reason: 'pending_reply',
          queue_size: CHAT_QUEUE.length,
        }, messageId);

        return {
          handled: true,
          ok: true,
          reason: 'queued-pending-reply',
        };
      }

      if (state.handlingMessageId && state.handlingMessageId !== messageId) {
        const queueResult = typeof enqueueChatQueueEntry === 'function'
          ? enqueueChatQueueEntry(normalized, 'handling-other')
          : { ok: true, queued: true, duplicate: false, entry: createQueuedMessageEntry(normalized) };
        if (queueResult.duplicate) {
          return {
            handled: true,
            ok: true,
            queued: true,
            duplicate: true,
            reason: 'duplicate_message_id',
          };
        }

        ToolboxShell.appendLog(
          `[SEND][BLOCK] reason=handling_other_message current=${String(state.handlingMessageId || '').slice(0, 8)} incoming=${String(messageId || '').slice(0, 8)}`
          + ` queue_size=${CHAT_QUEUE.length}`
        );
        ToolboxShell.appendLog(
          `[CHAT_QUEUE][ENQUEUE] queue_size=${CHAT_QUEUE.length} message_id=${String(messageId || '').slice(0, 8)}`
        );

        await report('queued_handling_other', {
          current_message_id: state.handlingMessageId,
          ignored_message_id: messageId,
          reason: 'handling_other_message',
          queue_size: CHAT_QUEUE.length,
        }, messageId);

        return {
          handled: true,
          ok: true,
          reason: 'queued-handling-other',
        };
      }

      if (state.handlingMessageId === messageId && !normalized.retry) {
        return {
          handled: false,
          ok: true,
          reason: 'duplicate',
        };
      }

      state.handlingMessageId = messageId;

      try {
        let ok = false;

        if (normalized.type === 'command') {
          ok = await handleCommandMessage(normalized);
        } else {
          const content = bridgeContentFrom(normalized);
          ToolboxShell.appendLog(
            `[BRIDGE][POLL][CHAT] message_id=${String(messageId).slice(0, 8)} `
            + `content_len=${content.length} url=${bridgeUrlFrom(normalized) || '-'}`,
          );
          ok = await sendTextToChatGPT(normalized);
        }

        return {
          handled: true,
          ok: ok === true,
          reason: ok === true ? 'ok' : 'message-handler-returned-false',
        };
      } catch (error) {
        const errText = error && error.message ? error.message : String(error);
        logBridgeError(`handleOutboundMessage 失败: ${errText}`, error);
        await ack(messageId, false, errText);

        return {
          handled: true,
          ok: false,
          reason: errText,
        };
      } finally {
        if (state.handlingMessageId === messageId) {
          state.handlingMessageId = null;
        }

        window.setTimeout(() => {
          void processBridgeChatQueue();
        }, 100);
      }
    }

    function formatBridgeStatusReasonSuffix(capability) {
      const reason = String(
        capability && capability.response_state_reason
          ? capability.response_state_reason
          : '',
      ).trim();
      return reason ? ` (${reason})` : '';
    }

    function isBridgeCapabilityDetecting(capability, reasonText) {
      if (!capability || typeof capability !== 'object') {
        return false;
      }

      const stateText = String(capability.response_state || '').trim();
      const reason = String(reasonText || capability.response_state_reason || '').trim();

      return capability._detect_reenter_skip === true
        || stateText === 'detecting'
        || reason === 'detect-reenter-skip'
        || reason === 'detect_in_progress';
    }

    function getBridgePollStatusPresentation() {
      const capability = getPageCapability('bridge-poll');
      logPageCapability(capability, '[BRIDGE][POLL]');

      const reasonText = String(
        capability && capability.response_state_reason ? capability.response_state_reason : '',
      ).trim();
      const reasonSuffix = reasonText ? ` (${reasonText})` : '';

      if (capability && (capability.has_composer || capability.can_accept_input || capability.can_send_now)) {
        state.everHadComposer = true;
      }

      if (!capability.bridge_connected) {
        const pollError = capability.last_poll_error || 'bridge_unreachable';
        return {
          text: `Bridge 离线：${pollError}`,
          type: 'offline',
          shortText: '离线',
        };
      }

      if (isBridgeCapabilityDetecting(capability, reasonText)) {
        return {
          text: 'Bridge 已连接 · 检测中',
          type: 'running',
          shortText: '检测中',
        };
      }

      if (capability.is_responding || capability.responding) {
        return {
          text: `Bridge 已连接 · 回答中${reasonSuffix}`,
          type: 'danger',
          shortText: '回答中',
        };
      }

      if (capability.can_send_now) {
        return {
          text: `Bridge 已连接 · 可发送${reasonSuffix}`,
          type: 'online',
          shortText: '可发送',
        };
      }

      if (capability.can_accept_input) {
        return {
          text: `Bridge 已连接 · 待输入${reasonSuffix}`,
          type: 'online',
          shortText: '待输入',
        };
      }

      if (reasonText === 'composer_waiting') {
        return {
          text: 'Bridge 已连接 · 等待输入框',
          type: 'running',
          shortText: '等待输入框',
        };
      }

      if (reasonText === 'composer_not_found') {
        const now = Date.now();
        const shortSinceMount = now - Number(state.mountedAt || now) < 3000;
        if (shortSinceMount || state.everHadComposer) {
          return {
            text: 'Bridge 已连接 · 等待输入框',
            type: 'running',
            shortText: '等待输入框',
          };
        }
        return {
          text: 'Bridge 已连接 · 未找到输入框',
          type: 'warn',
          shortText: '未找到输入框',
        };
      }

      return {
        text: `Bridge 已连接 · 页面异常${reasonSuffix}`,
        type: 'warn',
        shortText: '页面异常',
      };
    }

    /* ===== bridge core: heartbeat / poll / report / control claim ===== */
    async function pollBridge() {
      const cfg = getConfig();

      if (
        typeof AutoQueueModule !== 'undefined'
        && AutoQueueModule
        && typeof AutoQueueModule.shouldPauseWaitingReplyForInvalidPageContext === 'function'
        && AutoQueueModule.shouldPauseWaitingReplyForInvalidPageContext('bridge-poll')
      ) {
        return true;
      }

      if (!cfg.bridgeEnabled || state.polling) {
        return true;
      }

      if (state.handlingMessageId) {
        const now = Date.now();

        if (now - Number(state.lastBusyHeartbeatAt || 0) >= 3000) {
          state.lastBusyHeartbeatAt = now;
          const identity = getPageIdentity();
          const responseState = detectResponseState({ force: true, reason: 'heartbeat_busy' });

          await report('heartbeat_busy', {
            ...identity,
            busy: true,
            handling_message_id: state.handlingMessageId,
            visibility_state: document.visibilityState,
            has_focus: document.hasFocus(),
            is_responding: Boolean(responseState.is_responding),
            response_state: responseState.response_state || 'unknown',
            can_accept_input: Boolean(responseState.can_accept_input),
            ...buildPendingReplyTelemetryFields(),
          }, state.handlingMessageId);
        }

        return true;
      }

      const runId = state.bridgeRunId;
      state.polling = true;
      try {
        const result = await apiRequest({ action: 'poll' });

        if (runId !== state.bridgeRunId || !state.bridgePollLoopActive) {
          ToolboxShell.appendLog('[BRIDGE][POLL][STALE_RESULT_IGNORED]');
          return true;
        }

        applyBridgeStateFromPollResult(result, 'poll');

        watchReplyCompletionAndReport();

        if (
          typeof UploadModule !== 'undefined'
          && typeof UploadModule.applyBridgeUploadFiles === 'function'
          && Array.isArray(result.upload_files)
        ) {
          UploadModule.applyBridgeUploadFiles(result);
        }

        const handled = await handleOutboundMessage(result);

        if (runId === state.bridgeRunId && state.bridgePollLoopActive) {
          markBridgePollSuccess();
          if (!handled || handled.handled !== true || handled.ok === true) {
            const pres = getBridgePollStatusPresentation();
            updateStatus(pres.text);
            setBridgeStatus(pres.text, pres.type, {
              persist: true,
              shortText: pres.shortText,
              ttlMs: 4000,
            });
            renderBridgeCapabilityPanel(getPageCapability('bridge-poll'));
            updateChatInputStateBadge();
            if (
              typeof UploadModule !== 'undefined'
              && UploadModule
              && typeof UploadModule.renderUploadButtonsOnly === 'function'
            ) {
              try {
                if (typeof UploadModule.maybeHealStaleWaitingReplyState === 'function') {
                  UploadModule.maybeHealStaleWaitingReplyState('bridge-poll-capability-change');
                }
                UploadModule.renderUploadButtonsOnly({
                  immediate: true,
                  force: true,
                  heavy: false,
                  scope: 'all',
                  buttonTasksReason: 'bridge-poll-capability-change',
                });
                if (typeof UploadModule.reconcileManualComposerAttachmentClear === 'function') {
                  UploadModule.reconcileManualComposerAttachmentClear('bridge-poll');
                }
                if (typeof UploadModule.healStaleUploadRunningLockIfNeeded === 'function') {
                  UploadModule.healStaleUploadRunningLockIfNeeded('bridge-poll');
                }
              } catch (err) {
                console.warn('[BRIDGE][UPLOAD_BUTTON_REFRESH_FAILED]', err);
              }
            }
          } else {
            const failReason = handled.reason || '-';
            updateStatus(`消息处理失败：${failReason}`);
            setBridgeStatus(`消息处理失败：${failReason}`, 'error', { persist: true });
            updateChatInputStateBadge();
          }
        }
        return true;
      } catch (error) {
        const summary = summarizeBridgeError(error);
        const errName = summary.name || 'Error';
        const errText = summary.message || String(error);
        const bridgeUrl = getBridgeUrl();

        markBridgePollFailure(errText);
        const pres = getBridgePollStatusPresentation();
        updateStatus(pres.text);
        setBridgeStatus(pres.text, pres.type, {
          owner: 'bridge',
          persist: true,
          shortText: pres.shortText,
          ttlMs: 4000,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-poll-offline'));
        updateChatInputStateBadge();

        logBridgeError(
          `[pollBridge][failed] action=poll url=${bridgeUrl} type=${errName} error=${errText}`,
          error,
        );
        return false;
      } finally {
        if (runId === state.bridgeRunId) {
          state.polling = false;
        }
      }
    }

    function identityKey(identity) {
      if (!identity || typeof identity !== 'object') {
        return '';
      }

      return [
        String(identity.client_id || '').trim(),
        String(identity.page_instance_id || '').trim(),
        String(identity.page_type || '').trim(),
        String(identity.conversation_id || '').trim(),
        String(identity.pathname || '').trim(),
      ].join('|');
    }

    async function reportIdentityChanged(identity, oldKey, newKey, reason) {
      const eventAt = Date.now();
      const payload = withBridgeUrlFields({
        client_id: identity.client_id,
        page_instance_id: identity.page_instance_id,
        page_title: identity.page_title,
        page_type: identity.page_type,
        conversation_id: identity.conversation_id,
        pathname: identity.pathname,
        url: bridgeUrlFrom(identity) || location.href,
        visibility_state: identity.visibility_state,
        has_focus: identity.has_focus,
        old_identity_key: oldKey || '',
        new_identity_key: newKey || '',
        reason: reason || 'identity_change',
        event_at: eventAt,
      });
      ToolboxShell.appendLog(
        `[BRIDGE][IDENTITY_CHANGE] reason=${payload.reason} `
          + `client_id=${payload.client_id || '-'} `
          + `page_instance_id=${payload.page_instance_id || '-'} `
          + `page_type=${payload.page_type || '-'} `
          + `conversation_id=${payload.conversation_id || '-'} `
          + `pathname=${payload.pathname || '-'} `
          + `old_identity_key=${payload.old_identity_key || '-'} `
          + `new_identity_key=${payload.new_identity_key || '-'} `
          + `url=${payload.url || '-'}`,
      );
      try {
        await reportStrict('identity_change', payload);
      } catch (error) {
        logBridgeError(
          `[IDENTITY_CHANGE][report-failed] reason=${reason || '-'} `
            + `error=${error && error.message ? error.message : String(error)}`,
          error,
        );
      }
    }

    function flushIdentityChangeReport() {
      bridgeTimers.clearTimeout('identity-report-debounce');
      const latest = getPageIdentity();
      const newKey = identityKey(latest);
      const oldKey = state.pendingIdentityOldKey || '';
      const reason = state.pendingIdentityReason || 'identity_change';
      state.pendingIdentityOldKey = '';
      state.pendingIdentityReason = '';
      state.lastIdentityKey = newKey;
      if (!oldKey || oldKey === newKey) {
        return;
      }
      reportIdentityChanged(latest, oldKey, newKey, reason);
      if (typeof globalThis.__cgptHandleBatchFlowIdentityChange === 'function') {
        try {
          globalThis.__cgptHandleBatchFlowIdentityChange(oldKey, newKey, reason);
        } catch (batchIdentityErr) {
          console.error('[BRIDGE][BATCH_FLOW_IDENTITY_CHANGE_FAILED]', batchIdentityErr);
        }
      }
      const becameConversation = (
        (latest.page_type || '') === 'conversation'
        && Boolean((latest.conversation_id || '').trim())
      );
      if (becameConversation) {
        ToolboxShell.appendLog(
          '[BRIDGE][IDENTITY_CHANGE] conversation_ready immediate_poll',
        );
        pollBridge();
      }
    }

    function checkPageIdentityChange(reason) {
      const identity = getPageIdentity();
      const key = identityKey(identity);
      if (key === state.lastIdentityKey) {
        return;
      }
      const oldKey = state.lastIdentityKey || '';
      if (!state.pendingIdentityOldKey && oldKey) {
        state.pendingIdentityOldKey = oldKey;
      }
      state.pendingIdentityReason = reason || state.pendingIdentityReason || 'identity_change';
      debugLog(`identity changed: ${oldKey || '-'} -> ${key}`);
      bridgeTimers.timeout('identity-report-debounce', () => {
        flushIdentityChangeReport();
      }, 200);
    }

    async function handleRouteChange(reason = '') {
      const identity = getPageIdentity();
      const key = identityKey(identity);

      if (key === state.lastIdentityKey) {
        refreshToolboxPageStatusDisplay(`route-change:${reason || '-'}`);
        return;
      }

      const oldKey = state.lastIdentityKey || '';
      state.pendingIdentityOldKey = oldKey;
      state.pendingIdentityReason = reason || 'route_change';
      state.lastIdentityKey = key;
      bridgeTimers.clearTimeout('identity-report-debounce');
      debugLog(`route identity changed: ${oldKey || '-'} -> ${key}`);
      flushIdentityChangeReport();
      refreshToolboxPageStatusDisplay(`route-change:${reason || '-'}`);
    }

    function installPageIdentityListeners() {
      if (state.pageIdentityListenersInstalled) {
        return;
      }

      state.pageIdentityListenersInstalled = true;
    }

    function removePageIdentityListeners() {
      state.pageIdentityListenersInstalled = false;
    }

    function getNextBridgePollDelayMs(ok) {
      const cfg = getConfig();
      const backgroundSlowdownMs = (
        typeof BrowserRuntimeHealth !== 'undefined'
        && typeof BrowserRuntimeHealth.isProbablyThrottled === 'function'
        && BrowserRuntimeHealth.isProbablyThrottled()
      ) ? 10000 : 0;

      if (ok) {
        state.bridgePollFailCount = 0;
        return Math.max(
          1000,
          Number(cfg.bridgePollIntervalMs || 3000),
          backgroundSlowdownMs,
        );
      }

      state.bridgePollFailCount = Math.min(Number(state.bridgePollFailCount || 0) + 1, 5);

      if (state.bridgePollFailCount <= 1) {
        return 3000;
      }

      if (state.bridgePollFailCount === 2) {
        return 5000;
      }

      if (state.bridgePollFailCount === 3) {
        return 10000;
      }

      return 15000;
    }

    function scheduleBridgePoll(ok) {
      if (state.bridgePollTimer) {
        window.clearTimeout(state.bridgePollTimer);
        state.bridgePollTimer = 0;
      }

      const delayMs = getNextBridgePollDelayMs(ok);

      state.bridgePollTimer = window.setTimeout(() => {
        state.bridgePollTimer = 0;
        void runBridgePollLoop();
      }, delayMs);
    }

    async function runBridgePollLoop() {
      if (!getConfig().bridgeEnabled || !state.bridgePollLoopActive) {
        return;
      }

      if (typeof isToolboxPageNavigating === 'function' && isToolboxPageNavigating()) {
        stop();
        return;
      }

      let ok = true;

      try {
        checkPageIdentityChange();
        ok = (await pollBridge()) !== false;
      } catch (error) {
        ok = false;
        logBridgeError('[pollBridge][loop-failed]', error);
      } finally {
        if (state.bridgePollLoopActive) {
          scheduleBridgePoll(ok);
        }
      }
    }

    function start() {
      stop();
      cleanupPendingReplyContextStorage();
      const cfg = getConfig();
      if (!cfg.bridgeEnabled) {
        resetBridgePollRuntime('bridge_disabled');
        updateStatus('未启用');
        return;
      }
      state.bridgeRunId += 1;
      state.bridgePollFailCount = 0;
      state.bridgePollLoopActive = true;
      state.lastIdentityKey = identityKey(getPageIdentity());
      state.lastIdentityLogKey = '';
      state.pendingIdentityOldKey = '';
      state.pendingIdentityReason = '';
      installFocusStateListeners();
      installBridgeWakeHooks();
      installPageIdentityListeners();
      reportFocusState('bridge_start');
      void runBridgePollLoop();
      updateStatus(`已启动：${getBridgeUrl()}`);
      ToolboxShell.appendLog(`[BRIDGE][START] ${getBridgeUrl()}`);
    }

    function stop() {
      state.bridgeRunId += 1;
      state.bridgePollLoopActive = false;
      if (state.bridgePollTimer) {
        window.clearTimeout(state.bridgePollTimer);
        state.bridgePollTimer = 0;
      }
      if (state.timerId) {
        window.clearInterval(state.timerId);
        state.timerId = 0;
      }
      bridgeTimers.clearTimeout('identity-report-debounce');
      removeFocusStateListeners();
      removeBridgeWakeHooks();
      removePendingReplyDomObserver('bridge_stopped');
      removePageIdentityListeners();
      state.polling = false;
      state.bridgePollFailCount = 0;
      resetBridgePollRuntime('bridge_stopped');
      updateStatus('已停止');
    }

    async function testConnection() {
      updateStatus('正在测试连接...');
      try {
        const result = await apiRequest({
          action: 'poll',
          source: SOURCE,
          test_connection: true,
        });
        applyBridgeStateFromPollResult(result, 'test-connection');
        markBridgePollSuccess();
        const pres = getBridgePollStatusPresentation();
        updateStatus(`连接测试成功 · ${pres.shortText}`);
        setBridgeStatus(`连接测试成功 · ${pres.text}`, pres.type, {
          persist: true,
          shortText: pres.shortText,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-test'));
        ToolboxShell.appendLog(`[BRIDGE][TEST][OK] ${JSON.stringify(result).slice(0, 300)}`);
      } catch (error) {
        const text = error && error.message ? error.message : String(error);
        markBridgePollFailure(text);
        const pres = getBridgePollStatusPresentation();
        updateStatus(pres.text);
        setBridgeStatus(pres.text, pres.type, {
          persist: true,
          shortText: pres.shortText,
        });
        renderBridgeCapabilityPanel(getPageCapability('bridge-test-failed'));
        ToolboxShell.appendLog(`[BRIDGE][TEST][ERROR] ${text}`);
      }
    }

    function updateStatus(text) {
      bridgeStatus.set(String(text || ''), 'info');
    }

    const BRIDGE_FIELD_MAP = Object.freeze([
      {
        key: 'bridgeEnabled',
        selector: '#cgpt-bridge-enabled',
        type: 'checked',
        defaultValue: true,
      },
      {
        key: 'bridgeBaseUrl',
        selector: '#cgpt-bridge-base-url',
        type: 'value',
        normalize: normalizeBridgeBaseUrl,
        defaultValue: DEFAULT_BRIDGE_BASE_URL,
      },
      {
        key: 'bridgePath',
        selector: '#cgpt-bridge-path',
        type: 'value',
        normalize: normalizeBridgePath,
        defaultValue: DEFAULT_BRIDGE_PATH,
      },
      {
        key: 'bridgeDebugEnabled',
        selector: '#cgpt-bridge-debug',
        type: 'checked',
        defaultValue: false,
      },
      {
        key: 'bridgeRequestTimeoutMs',
        selector: '#cgpt-bridge-timeout',
        type: 'number',
        defaultValue: 30000,
        uiUnitSec: true,
      },
      {
        key: 'bridgePollIntervalMs',
        selector: '#cgpt-bridge-interval',
        type: 'number',
        defaultValue: 3000,
        uiUnitSec: true,
      },
    ]);

    const NORMAL_CAPABILITY_REASONS = new Set([
      'composer_has_attachment',
      'empty_composer',
      'native_send_ready',
      'assistant_busy',
    ]);

    const RESPONSE_STATE_LABELS = Object.freeze({
      attachment_ready: '附件已就绪',
      generating: '回复中',
      composing: '输入中',
      no_composer: '无输入框',
      idle: '',
      unknown: '',
    });

    function formatYesNo(value) {
      return value ? 'yes' : 'no';
    }

    function isEmptyDiagnosticValue(value) {
      const text = String(value ?? '').trim();
      return !text || text === '-';
    }

    function normalizeBridgeCapabilityRecord(capability) {
      const cap = capability && typeof capability === 'object'
        ? capability
        : getPageCapability('bridge-panel');
      const identity = getPageIdentity();

      const conversationId = String(cap.conversation_id || identity.conversation_id || '').trim();
      const url = String(cap.url || identity.url || location.href || '').trim();
      const inputable = Boolean(
        cap.inputable !== undefined ? cap.inputable : cap.can_accept_input,
      );
      const sendable = Boolean(
        cap.sendable !== undefined ? cap.sendable : cap.can_send_now,
      );
      const isResponding = Boolean(
        cap.is_responding !== undefined ? cap.is_responding : cap.responding,
      );
      const responding = Boolean(
        cap.responding !== undefined ? cap.responding : cap.is_responding,
      );
      const syncable = cap.syncable !== undefined
        ? Boolean(cap.syncable)
        : Boolean(conversationId);
      const conversationSyncable = cap.conversation_syncable !== undefined
        ? Boolean(cap.conversation_syncable)
        : Boolean(url && conversationId);

      return {
        client_id: String(cap.client_id || identity.client_id || '').trim() || '-',
        page_instance_id: String(cap.page_instance_id || identity.page_instance_id || '').trim() || '-',
        conversation_id: conversationId || '-',
        url: url || '-',
        page_type: String(cap.page_type || identity.page_type || '-').trim() || '-',
        online: cap.online !== false,
        inputable,
        sendable,
        response_state: String(cap.response_state || '-').trim() || '-',
        response_state_reason: String(cap.response_state_reason || '').trim() || '-',
        bridge_connected: Boolean(cap.bridge_connected),
        last_poll_ok: cap.last_poll_ok === null || cap.last_poll_ok === undefined
          ? null
          : Boolean(cap.last_poll_ok),
        last_poll_error: String(cap.last_poll_error || '').trim(),
        last_poll_at: Number(cap.last_poll_at || 0),
        syncable,
        conversation_syncable: conversationSyncable,
        is_responding: isResponding,
        responding,
        visibility_state: String(
          cap.visibility_state || document.visibilityState || '-',
        ).trim() || '-',
        has_focus: Boolean(
          cap.has_focus !== undefined ? cap.has_focus : document.hasFocus(),
        ),
      };
    }

    function formatOnlineStatus(value) {
      return value === false ? '离线' : '在线';
    }

    function formatInputSendStatus(inputable, sendable) {
      if (!inputable) {
        return '不可输入';
      }

      if (!sendable) {
        return '不可发送';
      }

      return '可输入，可发送';
    }

    function formatBridgeStatus(bridgeConnected, lastPollOk, lastPollError) {
      const pollError = isEmptyDiagnosticValue(lastPollError) ? '' : String(lastPollError).trim();

      if (!bridgeConnected) {
        return {
          text: 'Bridge 未连接',
          reason: pollError,
        };
      }

      if (lastPollOk === false) {
        return {
          text: '轮询异常',
          reason: pollError,
        };
      }

      if (lastPollOk === true) {
        return {
          text: 'Bridge 正常，轮询正常',
          reason: '',
        };
      }

      return {
        text: 'Bridge 正常，轮询未开始',
        reason: '',
      };
    }

    function formatResponseStateLabel(responseState) {
      const key = String(responseState || '').trim();
      return RESPONSE_STATE_LABELS[key] || '';
    }

    function shouldShowResponseStateReason(reason) {
      const text = String(reason || '').trim();
      if (!text || text === '-') {
        return false;
      }

      return !NORMAL_CAPABILITY_REASONS.has(text);
    }

    function formatRespondingStatus(isResponding, responding, responseState) {
      const busy = Boolean(isResponding || responding);
      if (busy) {
        return '回复中';
      }

      const stateLabel = formatResponseStateLabel(responseState);
      if (stateLabel && stateLabel !== '未回复中') {
        return `未回复中 · ${stateLabel}`;
      }

      return '未回复中';
    }

    function formatPollTimeSummary(lastPollAt) {
      const ts = Number(lastPollAt || 0);
      if (!ts || ts <= 0) {
        return '-';
      }

      const date = new Date(ts);
      const now = new Date();
      const isToday = date.getFullYear() === now.getFullYear()
        && date.getMonth() === now.getMonth()
        && date.getDate() === now.getDate();

      if (isToday) {
        return date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
      }

      return date.toLocaleString();
    }

    function formatBridgeCapabilitySummaryText(record) {
      const lines = [];
      const bridgeStatus = formatBridgeStatus(
        record.bridge_connected,
        record.last_poll_ok,
        record.last_poll_error,
      );

      lines.push(`连接状态：${bridgeStatus.text}`);
      if (bridgeStatus.reason) {
        lines.push(`原因：${bridgeStatus.reason}`);
      }

      lines.push(`输入发送：${formatInputSendStatus(record.inputable, record.sendable)}`);
      lines.push(
        `回复状态：${formatRespondingStatus(
          record.is_responding,
          record.responding,
          record.response_state,
        )}`,
      );
      lines.push(`页面状态：${formatOnlineStatus(record.online)}`);
      lines.push(`最近轮询：${formatPollTimeSummary(record.last_poll_at)}`);

      const pageType = String(record.page_type || '').trim();
      if (pageType && pageType !== 'conversation') {
        lines.push(`页面类型：${pageType}`);
      }

      const visibility = String(record.visibility_state || '').trim();
      if (visibility && visibility !== 'visible') {
        lines.push(`页面可见性：${visibility}`);
      }

      const pollError = String(record.last_poll_error || '').trim();
      if (pollError && pollError !== '-' && !bridgeStatus.reason) {
        lines.push(`轮询错误：${pollError}`);
      }

      if (shouldShowResponseStateReason(record.response_state_reason)) {
        lines.push(`状态原因：${record.response_state_reason}`);
      }

      return lines.join('\n');
    }

    function formatBridgeCapabilityDiagnosticText(record) {
      const pollAtText = record.last_poll_at > 0
        ? new Date(record.last_poll_at).toLocaleString()
        : '-';

      return [
        '[TOOLBOX_PAGE_CAPABILITY]',
        `client_id: ${record.client_id}`,
        `page_instance_id: ${record.page_instance_id}`,
        `conversation_id: ${record.conversation_id}`,
        `url: ${record.url}`,
        `page_type: ${record.page_type}`,
        `online: ${formatYesNo(record.online)}`,
        `inputable: ${formatYesNo(record.inputable)}`,
        `sendable: ${formatYesNo(record.sendable)}`,
        `response_state: ${record.response_state}`,
        `response_state_reason: ${record.response_state_reason}`,
        `bridge_connected: ${formatYesNo(record.bridge_connected)}`,
        `last_poll_ok: ${record.last_poll_ok === null || record.last_poll_ok === undefined ? '-' : formatYesNo(record.last_poll_ok)}`,
        `last_poll_error: ${record.last_poll_error || '-'}`,
        `last_poll_at: ${pollAtText}`,
        `syncable: ${formatYesNo(record.syncable)}`,
        `conversation_syncable: ${formatYesNo(record.conversation_syncable)}`,
        `is_responding: ${formatYesNo(record.is_responding)}`,
        `responding: ${formatYesNo(record.responding)}`,
        `visibility_state: ${record.visibility_state}`,
        `has_focus: ${formatYesNo(record.has_focus)}`,
      ].join('\n');
    }

    function applyBridgeCapabilityAdvancedVisibility() {
      if (!state.root) {
        return;
      }

      const panel = qs('#cgpt-bridge-capability-advanced', state.root);
      const toggleBtn = qs('#cgpt-bridge-toggle-advanced', state.root);

      if (panel) {
        panel.style.display = state.advancedCapabilityExpanded ? 'block' : 'none';
      }

      if (toggleBtn) {
        toggleBtn.textContent = state.advancedCapabilityExpanded
          ? '隐藏高级字段'
          : '显示高级字段';
      }
    }

    function renderBridgeCapabilityPanel(capability) {
      if (!state.root) {
        return;
      }

      const summaryEl = qs('#cgpt-bridge-capability-summary', state.root);
      const textEl = qs('#cgpt-bridge-capability-text', state.root);
      const record = normalizeBridgeCapabilityRecord(capability);

      if (summaryEl) {
        summaryEl.textContent = formatBridgeCapabilitySummaryText(record);
      }

      if (textEl) {
        textEl.textContent = formatBridgeCapabilityDiagnosticText(record);
      }

      applyBridgeCapabilityAdvancedVisibility();
      updateChatInputStateBadge();
    }

    function renderBridgeConfigToUi() {
      if (!state.root) return;

      const cfg = getConfig();

      BRIDGE_FIELD_MAP.forEach((field) => {
        if (field.type === 'checked') {
          DomUtil.setChecked(state.root, field.selector, cfg[field.key], 'BRIDGE');
          return;
        }

        const displayValue = field.uiUnitSec
          ? Math.round(Number(cfg[field.key] || field.defaultValue) / 1000)
          : cfg[field.key];
        DomUtil.setValue(state.root, field.selector, displayValue, 'BRIDGE');
      });

      DomUtil.setText(state.root, '#cgpt-bridge-url', getBridgeUrl(), 'BRIDGE');
      renderBridgeCapabilityPanel();
    }

    function readBridgeConfigFromUi() {
      if (!state.root) return {};

      const patch = {};

      BRIDGE_FIELD_MAP.forEach((field) => {
        let value;

        if (field.type === 'checked') {
          value = DomUtil.getChecked(state.root, field.selector, field.defaultValue, 'BRIDGE');
        } else if (field.type === 'number') {
          const rawUi = Number(DomUtil.getValue(
            state.root,
            field.selector,
            field.uiUnitSec ? field.defaultValue / 1000 : field.defaultValue,
            'BRIDGE',
          ));
          value = field.uiUnitSec
            ? Math.round((Number.isFinite(rawUi) ? rawUi : field.defaultValue / 1000) * 1000)
            : (Number.isFinite(rawUi) ? rawUi : field.defaultValue);
        } else {
          value = DomUtil.getValue(state.root, field.selector, field.defaultValue, 'BRIDGE');
        }

        patch[field.key] = typeof field.normalize === 'function'
          ? field.normalize(value)
          : value;
      });

      return patch;
    }

    function renderConfigToUi() {
      renderBridgeConfigToUi();
    }

    function saveConfigFromUi() {
      if (!state.root) return;

      saveConfig(readBridgeConfigFromUi());
      renderConfigToUi();
      start();
    }

    function bindBridgeEvents(mountRoot) {
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-save', saveConfigFromUi, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-test', () => {
        testConnection();
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-stop', () => {
        stop();
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-copy-url', () => {
        void copyWithStatus({
          text: getBridgeUrl(),
          successText: '已复制 Bridge 地址',
          failedPrefix: '复制 Bridge 地址失败',
          logPrefix: 'BRIDGE_COPY_URL',
          statusOwner: 'bridge',
        });
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-toggle-advanced', () => {
        state.advancedCapabilityExpanded = !state.advancedCapabilityExpanded;
        applyBridgeCapabilityAdvancedVisibility();
      }, 'BRIDGE');
      DomUtil.bindClick(mountRoot, '#cgpt-bridge-copy-diag', () => {
        const record = normalizeBridgeCapabilityRecord(
          getPageCapability('bridge-copy-diag'),
        );
        void copyWithStatus({
          text: formatBridgeCapabilityDiagnosticText(record),
          successText: '已复制诊断信息',
          failedPrefix: '复制诊断信息失败',
          logPrefix: 'BRIDGE_COPY_DIAG',
          statusOwner: 'bridge',
        }).catch((error) => {
          console.error('[BridgeModule] 复制诊断信息失败', error);
        });
      }, 'BRIDGE');
    }

    const BRIDGE_MODULE_HTML = `
        <div class="cgpt-section">
          <div class="cgpt-section-title">浏览器桥接</div>
          <div class="cgpt-hint">用于连接本地 Python Flask Bridge，实现页面绑定、消息下发、回复回传、刷新、关闭、同步当前对话等能力。</div>

          <label class="cgpt-checkbox-line">
            <input type="checkbox" id="cgpt-bridge-enabled">
            启用桥接轮询
          </label>

          <div class="cgpt-form-grid">
            <label>服务地址</label>
            <input class="cgpt-input" id="cgpt-bridge-base-url" placeholder="http://127.0.0.1:5000">

            <label>接口路径</label>
            <input class="cgpt-input" id="cgpt-bridge-path" placeholder="/api/bridge">

            <label title="单位：秒。内部仍按毫秒保存。">请求超时（秒）</label>
            <input class="cgpt-input" id="cgpt-bridge-timeout" type="number" data-no-wheel-number="1" min="1" step="1" title="单位：秒。默认 30 秒。">

            <label title="单位：秒。内部仍按毫秒保存。">轮询间隔（秒）</label>
            <input class="cgpt-input" id="cgpt-bridge-interval" type="number" data-no-wheel-number="1" min="1" step="1" title="单位：秒。默认 3 秒。">
          </div>

          <label class="cgpt-checkbox-line" style="margin-top:8px;">
            <input type="checkbox" id="cgpt-bridge-debug">
            开启调试日志
          </label>

          <div class="cgpt-row" style="margin-top:10px; flex-wrap:wrap;">
            <button type="button" class="cgpt-btn primary" id="cgpt-bridge-save">保存并重启桥接</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-test">测试连接</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-stop">停止轮询</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-copy-url">复制地址</button>
          </div>

          <div class="cgpt-hint" style="margin-top:10px;">
            当前地址：<span id="cgpt-bridge-url"></span>
          </div>

          <div class="cgpt-hint" style="margin-top:6px;">
            状态：<span id="cgpt-bridge-status">未启动</span>
          </div>

          <div class="cgpt-hint" style="margin-top:10px; font-weight:600;">
            页面能力（当前标签页，仅展示不拦截同步）
          </div>
          <div id="cgpt-bridge-capability-summary" class="cgpt-hint" style="margin:4px 0 0; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; font-size:12px; line-height:1.6; white-space:pre-wrap;">
            -
          </div>
          <div class="cgpt-row" style="margin-top:6px; flex-wrap:wrap; gap:4px;">
            <button type="button" class="cgpt-btn" id="cgpt-bridge-toggle-advanced" data-dynamic-label-allowed="1" style="font-size:11px; padding:2px 8px;">显示高级字段</button>
            <button type="button" class="cgpt-btn" id="cgpt-bridge-copy-diag" style="font-size:11px; padding:2px 8px;">复制诊断信息</button>
          </div>
          <div id="cgpt-bridge-capability-advanced" style="display:none; margin-top:6px;">
            <pre id="cgpt-bridge-capability-text" class="cgpt-hint" style="margin:0; padding:8px; background:rgba(0,0,0,0.04); border-radius:6px; white-space:pre-wrap; font-family:ui-monospace,monospace; font-size:11px; line-height:1.45; max-height:260px; overflow-y:auto;">-</pre>
          </div>
        </div>
      `;

    function mount(targetHost) {
      if (!targetHost) {
        logBridgeError('mount 失败: targetHost 为空');
        return;
      }

      const mountedRoot = mountSingletonModule({
        targetHost,
        moduleId: 'cgpt-bridge-module',
        moduleName: 'BRIDGE',
        html: BRIDGE_MODULE_HTML,
        onRefs: (rootEl) => {
          state.root = rootEl;
          state.mounted = true;
        },
        onBind: (rootEl) => {
          bindBridgeEvents(rootEl);
        },
        onRender: () => {
          renderConfigToUi();
        },
        onAfterMount: () => {
          start();
        },
      });

      if (!mountedRoot) {
        logBridgeError('mount 失败: mountSingletonModule 返回空');
      }
    }

    async function sendSystemHotkey(combo) {
      const normalizedCombo = String(combo || '').trim().toLowerCase();
      if (!normalizedCombo) {
        throw new Error('目标快捷键未设置');
      }
      const result = await apiRequest({
        action: 'system_hotkey',
        combo: normalizedCombo,
      });

      if (!result || result.ok !== true) {
        throw new Error((result && result.error) || 'GUI 执行快捷键失败');
      }

      return result;
    }

    function forceCatchUp(reason) {
      forceBridgeCatchUp(reason);
    }

    return {
      mount,
      stop,
      handleRouteChange,
      sendSystemHotkey,
      forceCatchUp,
    };
  })();

  function stopAutoContinue(reason) {
    if (typeof AutoQueueModule !== 'undefined' && typeof AutoQueueModule.stop === 'function') {
      AutoQueueModule.stop({
        reason: reason || 'page-navigation',
        logStop: false,
        markCurrent: false,
      });
    }
  }
