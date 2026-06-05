/********************************************************************
 * DOM action utilities (click fallback, etc.)
 ********************************************************************/

function clickElementWithFallback(el, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const source = String(opts.source || 'click').trim() || 'click';
  const scrollIntoView = opts.scrollIntoView !== false;
  const focus = opts.focus !== false;

  if (!(el instanceof HTMLElement)) {
    return { ok: false, method: '', reason: 'not_html_element' };
  }

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return { ok: false, method: '', reason: 'not_visible' };
  }

  if (scrollIntoView) {
    el.scrollIntoView({
      block: 'center',
      inline: 'center',
      behavior: 'instant',
    });
  }

  if (focus && typeof el.focus === 'function') {
    el.focus({ preventScroll: true });
  }

  try {
    if (typeof el.click === 'function') {
      el.click();
      return { ok: true, method: 'native_click', source };
    }
  } catch (err) {
    console.error('[ChatGPT toolbox] clickElementWithFallback native_click failed', err);
    if (err && err.stack) {
      console.error(err.stack);
    }
    if (typeof ToolboxShell !== 'undefined' && typeof ToolboxShell.appendLog === 'function') {
      const errText = err && err.message ? err.message : String(err);
      ToolboxShell.appendLog(
        `[CLICK][NATIVE_CLICK_FAILED] source=${source} error=${errText}`,
      );
    }
  }

  const nextRect = el.getBoundingClientRect();
  const x = nextRect.left + nextRect.width / 2;
  const y = nextRect.top + nextRect.height / 2;

  const common = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: 1,
  };

  const eventWindow = el.ownerDocument && el.ownerDocument.defaultView
    ? el.ownerDocument.defaultView
    : window;

  try {
    if (eventWindow.PointerEvent) {
      el.dispatchEvent(new eventWindow.PointerEvent('pointerdown', common));
      el.dispatchEvent(new eventWindow.PointerEvent('pointerup', common));
    }

    el.dispatchEvent(new eventWindow.MouseEvent('mousedown', common));
    el.dispatchEvent(new eventWindow.MouseEvent('mouseup', common));
    el.dispatchEvent(new eventWindow.MouseEvent('click', common));

    return { ok: true, method: 'mouse_events', source };
  } catch (err) {
    console.error('[ChatGPT toolbox] clickElementWithFallback mouse_events failed', err);
    if (err && err.stack) {
      console.error(err.stack);
    }
    const errText = err && err.message ? err.message : String(err);
    return { ok: false, method: '', reason: errText, source };
  }
}


