  /********************************************************************
   * TaskFlowPipeline：闭环与批量任务组共用步骤名（顺序映射基线）
   ********************************************************************/

  const TaskFlowPipeline = (() => {
    const STEPS = Object.freeze({
      WAIT_REPLY_DONE: 'wait_reply_done',
      COPY_LAST_REPLY: 'copy_last_reply',
      TRIGGER_HOTKEY: 'trigger_hotkey',
      WAIT_RANDOM_DELAY: 'wait_random_delay',
      SEND_CONTINUE: 'send_continue',
      OPTIONAL_UPLOAD: 'optional_upload',
    });

    /** 闭环快捷键模式标准顺序 */
    const CLOSED_LOOP_HOTKEY_STEP_ORDER = Object.freeze([
      STEPS.WAIT_REPLY_DONE,
      STEPS.COPY_LAST_REPLY,
      STEPS.TRIGGER_HOTKEY,
      STEPS.WAIT_RANDOM_DELAY,
      STEPS.SEND_CONTINUE,
      STEPS.OPTIONAL_UPLOAD,
    ]);

    return Object.freeze({
      STEPS,
      CLOSED_LOOP_HOTKEY_STEP_ORDER,
    });
  })();
