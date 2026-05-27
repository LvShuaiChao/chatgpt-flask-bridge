const ComposerCapability = (() => {
  const cache = {
    lightAt: 0,
    light: null,
    heavyAt: 0,
    heavy: null,
  };

  function nowMs() {
    return Date.now();
  }

  function readMainCapability(reason = '', options = {}) {
    if (typeof getPageCapability !== 'function') {
      return null;
    }
    const mode = options.mode === 'heavy' ? 'heavy' : 'light';
    const reasonText = String(reason || '').trim();
    const cap = getPageCapability(reasonText);
    if (!cap || typeof cap !== 'object') {
      return null;
    }
    return {
      ...cap,
      mode,
    };
  }

  function shouldReuse(at, maxAgeMs) {
    if (!at || !Number.isFinite(Number(at))) {
      return false;
    }
    return nowMs() - Number(at) <= Math.max(0, Number(maxAgeMs) || 0);
  }

  function getPageCapabilityUnified(reason = '', options = {}) {
    const light = options.light !== false;
    const heavy = options.heavy === true;
    const maxAgeMs = Number.isFinite(Number(options.maxAgeMs)) ? Number(options.maxAgeMs) : 300;
    const mode = heavy ? 'heavy' : (light ? 'light' : 'heavy');

    if (mode === 'light' && cache.light && shouldReuse(cache.lightAt, maxAgeMs)) {
      return cache.light;
    }
    if (mode === 'heavy' && cache.heavy && shouldReuse(cache.heavyAt, maxAgeMs)) {
      return cache.heavy;
    }

    const cap = readMainCapability(reason, { mode });
    if (!cap) {
      return null;
    }

    if (mode === 'light') {
      cache.light = cap;
      cache.lightAt = nowMs();
    } else {
      cache.heavy = cap;
      cache.heavyAt = nowMs();
      if (!cache.light) {
        cache.light = cap;
        cache.lightAt = cache.heavyAt;
      }
    }
    return cap;
  }

  return {
    getPageCapability: getPageCapabilityUnified,
  };
})();

