  /********************************************************************
   * ToolboxStableGeometry：浮窗 left/top/width/height 统一控制
   ********************************************************************/

  const ToolboxStableGeometry = (() => {
    const XZ_TOOLBOX_GEOMETRY_KEY = 'xz_toolbox_geometry_v2';

    function xzNumber(value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }

    function xzClamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }

    function xzGetViewportSize() {
      return {
        width: Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1280),
        height: Math.max(240, window.innerHeight || document.documentElement.clientHeight || 720),
      };
    }

    function xzReadSavedGeometry() {
      let raw = '';
      try {
        raw = localStorage.getItem(XZ_TOOLBOX_GEOMETRY_KEY) || '';
      } catch (error) {
        console.warn('[XZ_TOOLBOX_GEOMETRY][READ_FAIL]', error);
        return null;
      }

      if (!raw) {
        return null;
      }

      try {
        const data = JSON.parse(raw);
        return {
          left: xzNumber(data.left, 0),
          top: xzNumber(data.top, 0),
          width: xzNumber(data.width, 500),
          height: xzNumber(data.height, 640),
        };
      } catch (error) {
        console.warn('[XZ_TOOLBOX_GEOMETRY][READ_FAIL]', error);
        return null;
      }
    }

    function xzSaveGeometry(geometry) {
      try {
        localStorage.setItem(XZ_TOOLBOX_GEOMETRY_KEY, JSON.stringify({
          left: Math.round(geometry.left),
          top: Math.round(geometry.top),
          width: Math.round(geometry.width),
          height: Math.round(geometry.height),
          savedAt: Date.now(),
        }));
      } catch (error) {
        console.warn('[XZ_TOOLBOX_GEOMETRY][SAVE_FAIL]', error);
      }
    }

    function xzClampGeometry(geometry) {
      const viewport = xzGetViewportSize();
      const margin = 8;
      const minWidth = 360;
      const minHeight = 260;
      const maxWidth = Math.max(minWidth, viewport.width - margin * 2);
      const maxHeight = Math.max(minHeight, viewport.height - margin * 2);
      const width = xzClamp(xzNumber(geometry.width, 500), minWidth, maxWidth);
      const height = xzClamp(xzNumber(geometry.height, 640), minHeight, maxHeight);
      const left = xzClamp(
        xzNumber(geometry.left, viewport.width - width - 16),
        margin,
        Math.max(margin, viewport.width - width - margin),
      );
      const top = xzClamp(
        xzNumber(geometry.top, 96),
        margin,
        Math.max(margin, viewport.height - height - margin),
      );
      return { left, top, width, height };
    }

    function xzApplyGeometry(root, geometry) {
      const g = xzClampGeometry(geometry);
      root.style.position = 'fixed';
      root.style.boxSizing = 'border-box';
      root.style.left = `${Math.round(g.left)}px`;
      root.style.top = `${Math.round(g.top)}px`;
      root.style.width = `${Math.round(g.width)}px`;
      root.style.height = `${Math.round(g.height)}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.inset = 'auto';
      root.style.transform = 'none';
      root.style.maxWidth = 'none';
      root.style.maxHeight = 'none';
      root.style.resize = 'none';
      root.style.transition = 'none';
      root.style.setProperty('--cgpt-toolbox-width', `${Math.round(g.width)}px`);
      root.style.setProperty('--cgpt-toolbox-height', `${Math.round(g.height)}px`);
      return g;
    }

    function xzNormalizeToolboxGeometry(root, options = {}) {
      const rect = root.getBoundingClientRect();
      const saved = xzReadSavedGeometry();
      const initial = saved || {
        left: rect.left || Math.max(8, window.innerWidth - 520),
        top: rect.top || 120,
        width: rect.width > 80 ? rect.width : 500,
        height: rect.height > 80 ? rect.height : 640,
      };
      const normalized = xzApplyGeometry(root, initial);
      xzSaveGeometry(normalized);
      if (typeof options.onSaved === 'function') {
        options.onSaved(normalized, 'normalize');
      }
      console.info('[XZ_TOOLBOX_GEOMETRY][NORMALIZED]', normalized);
      return normalized;
    }

    function xzIsInteractiveTarget(target) {
      if (!target || !target.closest) {
        return false;
      }
      return Boolean(target.closest(
        "button,input,textarea,select,a,[contenteditable='true'],[data-xz-resize-handle='1'],.cgpt-toolbox-resize-handle",
      ));
    }

    function installStableToolboxGeometry(root, options = {}) {
      if (!root) {
        console.warn('[XZ_TOOLBOX_GEOMETRY][INSTALL_FAIL] root is empty');
        return false;
      }

      if (root.__xzStableGeometryInstalled) {
        return true;
      }

      root.__xzStableGeometryInstalled = true;
      root.classList.add('xz-toolbox-root');

      const dragHandleSelector = options.dragHandleSelector
        || "[data-xz-drag-handle='1']";
      const resizeHandleSelector = options.resizeHandleSelector
        || "[data-xz-resize-handle='1']";

      xzNormalizeToolboxGeometry(root, options);

      let state = null;

      function getCurrentGeometry() {
        const rect = root.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }

      function finishPointerAction(event) {
        if (!state) {
          return;
        }

        const finalGeometry = getCurrentGeometry();
        const finishedMode = state.mode;

        root.classList.remove('xz-toolbox-moving');
        root.classList.remove('xz-toolbox-resizing');

        try {
          if (state.pointerId !== undefined && root.releasePointerCapture) {
            root.releasePointerCapture(state.pointerId);
          }
        } catch (error) {
          console.warn('[XZ_TOOLBOX_GEOMETRY][RELEASE_POINTER_FAIL]', error);
        }

        xzSaveGeometry(finalGeometry);

        if (finishedMode === 'drag' && typeof options.onDragEnd === 'function') {
          options.onDragEnd(finalGeometry, event);
        }
        if (finishedMode === 'resize' && typeof options.onResizeEnd === 'function') {
          options.onResizeEnd(finalGeometry, event);
        }
        if (typeof options.onSaved === 'function') {
          options.onSaved(finalGeometry, finishedMode);
        }

        console.info('[XZ_TOOLBOX_GEOMETRY][POINTER_UP]', {
          mode: finishedMode,
          geometry: finalGeometry,
        });

        state = null;

        if (event) {
          event.preventDefault();
          event.stopPropagation();
        }
      }

      function onPointerMove(event) {
        if (!state) {
          return;
        }

        const dx = event.clientX - state.startClientX;
        const dy = event.clientY - state.startClientY;

        if (state.mode === 'drag') {
          xzApplyGeometry(root, {
            left: state.startGeometry.left + dx,
            top: state.startGeometry.top + dy,
            width: state.startGeometry.width,
            height: state.startGeometry.height,
          });
        } else if (state.mode === 'resize') {
          xzApplyGeometry(root, {
            left: state.startGeometry.left,
            top: state.startGeometry.top,
            width: state.startGeometry.width + dx,
            height: state.startGeometry.height + dy,
          });
        }

        event.preventDefault();
        event.stopPropagation();
      }

      function startPointerAction(event, mode) {
        if (event.button !== undefined && event.button !== 0) {
          return;
        }

        state = {
          mode,
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startGeometry: getCurrentGeometry(),
        };

        if (mode === 'drag') {
          root.classList.add('xz-toolbox-moving');
          if (typeof options.onDragStart === 'function') {
            options.onDragStart(state.startGeometry, event);
          }
        } else {
          root.classList.add('xz-toolbox-resizing');
          if (typeof options.onResizeStart === 'function') {
            options.onResizeStart(state.startGeometry, event);
          }
        }

        try {
          if (event.pointerId !== undefined && root.setPointerCapture) {
            root.setPointerCapture(event.pointerId);
          }
        } catch (error) {
          console.warn('[XZ_TOOLBOX_GEOMETRY][SET_POINTER_FAIL]', error);
        }

        console.info('[XZ_TOOLBOX_GEOMETRY][POINTER_DOWN]', {
          mode,
          startGeometry: state.startGeometry,
        });

        event.preventDefault();
        event.stopPropagation();
      }

      const dragHandle = root.querySelector(dragHandleSelector)
        || root.querySelector('.xz-toolbox-header')
        || root.querySelector('.cgpt-toolbox-header');
      const resizeHandle = root.querySelector(resizeHandleSelector)
        || root.querySelector('.xz-toolbox-resize-handle')
        || root.querySelector('.cgpt-toolbox-resize-handle');

      if (!dragHandle) {
        console.warn('[XZ_TOOLBOX_GEOMETRY][NO_DRAG_HANDLE]');
      } else {
        dragHandle.addEventListener('pointerdown', function onDragPointerDown(event) {
          if (xzIsInteractiveTarget(event.target)) {
            return;
          }
          startPointerAction(event, 'drag');
        }, true);
      }

      if (!resizeHandle) {
        console.warn('[XZ_TOOLBOX_GEOMETRY][NO_RESIZE_HANDLE]');
      } else {
        resizeHandle.addEventListener('pointerdown', function onResizePointerDown(event) {
          startPointerAction(event, 'resize');
        }, true);
      }

      root.addEventListener('pointermove', onPointerMove, true);
      root.addEventListener('pointerup', finishPointerAction, true);
      root.addEventListener('pointercancel', finishPointerAction, true);

      const onWindowResize = function onWindowResizeClamp() {
        if (state) {
          return;
        }
        const current = getCurrentGeometry();
        const fixed = xzApplyGeometry(root, current);
        xzSaveGeometry(fixed);
        if (typeof options.onSaved === 'function') {
          options.onSaved(fixed, 'window-resize');
        }
        console.info('[XZ_TOOLBOX_GEOMETRY][WINDOW_RESIZE_CLAMP]', fixed);
      };

      window.addEventListener('resize', onWindowResize, true);
      root.__xzStableGeometryWindowResize = onWindowResize;

      return true;
    }

    function isStableGeometryActive(el) {
      return !!(el && el.__xzStableGeometryInstalled);
    }

    function isPointerInteractionActive(el) {
      if (!el || !el.classList) {
        return false;
      }
      return el.classList.contains('xz-toolbox-moving')
        || el.classList.contains('xz-toolbox-resizing');
    }

    return {
      GEOMETRY_KEY: XZ_TOOLBOX_GEOMETRY_KEY,
      install: installStableToolboxGeometry,
      readSavedGeometry: xzReadSavedGeometry,
      applyGeometry: xzApplyGeometry,
      clampGeometry: xzClampGeometry,
      normalize: xzNormalizeToolboxGeometry,
      isInstalled: isStableGeometryActive,
      isPointerInteractionActive,
    };
  })();
