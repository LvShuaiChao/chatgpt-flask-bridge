  /********************************************************************
   * UploadSendButtonViewModel：上传面板「发送信息」按钮状态单一来源
   ********************************************************************/

  function formatDurationMsForButton(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes <= 0) {
      return `${seconds}s`;
    }

    return `${minutes}m ${seconds}s`;
  }

  function computeUploadSendButtonViewModel(state = {}) {
    const waitingSend = !!state.waitingSend;
    const waitingReply = !!state.waitingReply;
    const messageSending = !!state.sending;
    const canSend = state.canSend !== false;
    const failureHint = String(state.failureHint || '').trim();
    const pendingSendAfterReply = !!state.pendingSendAfterReply;
    const pendingAttachmentWaitSend = !!state.pendingAttachmentWaitSend;
    const hasComposer = state.hasComposer !== false;
    const isResponding = !!state.isResponding;

    if (messageSending) {
      return {
        disabled: false,
        text: '发送中，点击取消',
        title: '正在发送，再次点击可取消',
        className: 'danger',
        action: 'cancel-send',
        ariaBusy: true,
        datasetState: 'sending',
        removeClasses: ['primary', 'warning', 'cgpt-wait-send-cancel', 'waiting'],
        addClasses: ['danger'],
      };
    }

    if (waitingSend) {
      return {
        disabled: false,
        text: '等待可发送，点击取消',
        title: '正在等待发送按钮可用，再次点击可取消',
        className: 'warning',
        action: 'cancel-send',
        ariaBusy: true,
        datasetState: 'waiting-send',
        removeClasses: ['primary', 'danger', 'cgpt-wait-send-cancel', 'waiting'],
        addClasses: ['warning'],
      };
    }

    if (waitingReply) {
      const title = pendingSendAfterReply
        ? '助手正在回复或发送按钮未就绪，脚本会持续检测，页面一可发送就自动点击发送；再次点击可取消'
        : '再次点击可取消等待回复';
      return {
        disabled: false,
        text: pendingSendAfterReply ? '等待可发送，点击取消' : '等待回复，点击取消',
        title,
        className: 'warning',
        action: 'cancel-wait-reply',
        ariaBusy: true,
        datasetState: 'waiting-reply',
        removeClasses: ['primary', 'danger', 'cgpt-wait-send-cancel', 'waiting'],
        addClasses: ['warning'],
      };
    }

    if (pendingAttachmentWaitSend) {
      return {
        disabled: false,
        text: '等待可发送，点击取消',
        title: '附件已存在，正在等待发送按钮',
        className: 'warning',
        action: 'send-message',
        ariaBusy: false,
        datasetState: 'pending-attachment',
        removeClasses: ['primary', 'danger', 'cgpt-wait-send-cancel', 'waiting'],
        addClasses: ['warning'],
      };
    }

    if (!canSend || !hasComposer) {
      const hint = failureHint || (isResponding
        ? '助手正在回复，暂不可发送'
        : '当前页面未检测到可用输入框或发送按钮');
      const shortText = failureHint && failureHint.length > 22
        ? `${failureHint.slice(0, 22)}…`
        : (failureHint || '发送不可用');
      return {
        disabled: failureHint ? false : true,
        text: shortText,
        title: hint,
        className: failureHint ? 'warning' : 'disabled',
        action: failureHint ? 'send-message' : 'none',
        ariaBusy: false,
        datasetState: failureHint ? 'failed' : 'idle',
        removeClasses: ['primary', 'danger', 'cgpt-wait-send-cancel', 'waiting'],
        addClasses: failureHint ? ['warning'] : [],
      };
    }

    return {
      disabled: false,
      text: '发送信息',
      title: '发送当前输入框中的文字和附件',
      className: 'primary',
      action: 'send-message',
      ariaBusy: false,
      datasetState: 'idle',
      removeClasses: ['danger', 'warning', 'cgpt-wait-send-cancel', 'waiting'],
      addClasses: ['primary'],
    };
  }

  function applyButtonViewModel(button, vm) {
    if (!button || !vm) {
      return false;
    }

    button.dataset.action = vm.action || '';
    button.dataset.sendState = vm.datasetState || '';
    delete button.dataset.uploadSendState;
    button.setAttribute('aria-busy', vm.ariaBusy ? 'true' : 'false');

    if (typeof setToolboxButtonState === 'function') {
      const stateName = String(vm.datasetState || '').trim();
      const allowCancel = vm.action === 'cancel-send' || vm.action === 'cancel-wait-reply';
      const common = {
        text: vm.text || '',
        title: vm.title || '',
        allowCancel,
        ariaBusy: vm.ariaBusy,
        reason: `upload-send-vm:${stateName || 'unknown'}`,
      };

      if (stateName === 'waiting-send') {
        return setButtonWaiting(button, vm.text || '等待可发送，点击取消', common);
      }
      if (stateName === 'sending' || vm.action === 'cancel-send') {
        return setButtonSending(button, vm.text || '发送中，点击取消', common);
      }
      if (stateName === 'waiting-reply' || vm.action === 'cancel-wait-reply') {
        return setButtonWaiting(button, vm.text || '等待可发送，点击取消', common);
      }
      if (stateName === 'pending-attachment' || vm.className === 'warning') {
        return setButtonWaiting(button, vm.text || '等待发送...', {
          ...common,
          allowCancel: false,
        });
      }
      if (vm.className === 'disabled' || vm.disabled) {
        return setToolboxButtonState(button, {
          phase: ButtonPhase.DISABLED,
          text: vm.text || '',
          title: vm.title || '',
          disabled: true,
          reason: common.reason,
        });
      }
      if (vm.className === 'primary' || stateName === 'idle') {
        return setButtonIdle(button, vm.text || '发送信息', common);
      }
      if (vm.className === 'danger') {
        return setButtonSending(button, vm.text || '', common);
      }
    }

    const payload = {
      text: vm.text || '',
      title: vm.title || '',
      disabled: !!vm.disabled,
      ariaDisabled: vm.disabled,
      removeClasses: Array.isArray(vm.removeClasses) ? vm.removeClasses : [],
      addClasses: Array.isArray(vm.addClasses) ? vm.addClasses : [],
    };

    if (typeof setButtonStateIfChanged === 'function') {
      return setButtonStateIfChanged(button, payload);
    }

    button.disabled = payload.disabled;
    button.textContent = payload.text;
    button.title = payload.title;
    return true;
  }
