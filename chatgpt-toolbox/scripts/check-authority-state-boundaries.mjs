import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'tampermonkey-userscript-src');

const targetFiles = [
  'upload/upload-module.js',
  'ui/toolbox-header-status.js',
  'core/main.js',
  'upload/upload-button-vm.js',
  'upload/closed-loop-button-vm.js',
  'core/button-state.js',
].map((relativePath) => path.join(sourceRoot, relativePath));

const failures = [];

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    failures.push({
      filePath,
      line: 0,
      rule: 'missing-file',
      message: '检查目标文件不存在。',
      lineText: '',
    });
    return '';
  }
  return fs.readFileSync(filePath, 'utf8');
}

function getLineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function getLineText(text, lineNumber) {
  return text.split(/\r?\n/)[lineNumber - 1] || '';
}

function addRegexFailures(filePath, text, rule, pattern, message, allowLine) {
  let match;
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  while ((match = regex.exec(text)) !== null) {
    const line = getLineNumber(text, match.index);
    const lineText = getLineText(text, line).trim();
    if (allowLine && allowLine(lineText, filePath, match[0])) {
      continue;
    }
    failures.push({
      filePath,
      line,
      rule,
      message,
      lineText,
    });
  }
}

function isAllowedWaitingSendConstantLine(lineText, filePath) {
  if (!filePath.endsWith(path.join('upload', 'upload-module.js'))) {
    return false;
  }
  return (
    lineText.includes("WAITING_SEND: 'waiting_send'")
    || lineText.includes('rawState: TOOLBOX_REPLY_STATES.WAITING_SEND')
    || lineText.includes('rawState === TOOLBOX_REPLY_STATES.WAITING_SEND')
    || lineText.includes('DEPRECATED')
    || lineText.includes('deprecated')
  );
}

function isAllowedLegacyRunningReadOnlyLine(lineText) {
  return (
    lineText.includes('legacyReadOnly=1')
    || lineText.includes("legacyRunning = copyHotkeyContinueLoopRunning ? '1' : '0'")
    || lineText.includes('legacyRunning=${copyHotkeyContinueLoopRunning')
  );
}

function isUploadModulePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').endsWith('upload/upload-module.js');
}

function isAllowedReplyStateWaitingSendSelfCheckLine(lineText, filePath) {
  if (
    isUploadModulePath(filePath)
    && /if\s*\(\s*replyState\s*===\s*['"]waiting_send['"]\s*\)/.test(lineText)
  ) {
    return true;
  }
  return (
    lineText.includes('runUploadModuleStateBoundarySelfCheck')
    || lineText.includes('STATE_BOUNDARY_SELF_CHECK')
    || lineText.includes('replyState_must_not_be_waiting_send')
  );
}

for (const filePath of targetFiles) {
  const text = readText(filePath);
  if (!text) {
    continue;
  }

  addRegexFailures(
    filePath,
    text,
    'no-reply-state-waiting-send-string',
    /reply\.state\s*={2,3}\s*['"]waiting_send['"]/,
    '禁止用 reply.state 判断 waiting_send；请改用 flags.pendingSend / composerState / sendPhase。',
  );

  addRegexFailures(
    filePath,
    text,
    'no-public-reply-state-waiting-send-constant',
    /state\s*:\s*TOOLBOX_REPLY_STATES\.WAITING_SEND/,
    '禁止把 TOOLBOX_REPLY_STATES.WAITING_SEND 作为 authority.reply.state 输出；请使用 state: READY + rawState: WAITING_SEND。',
    isAllowedWaitingSendConstantLine,
  );

  addRegexFailures(
    filePath,
    text,
    'no-can-input-from-reply-waiting-send',
    /canInput[\s\S]{0,800}reply\.state\s*={2,3}\s*TOOLBOX_REPLY_STATES\.WAITING_SEND/,
    'canInput 不允许从 reply.state WAITING_SEND 推导；请改用 pendingSendForAuthority / composerState。',
  );

  addRegexFailures(
    filePath,
    text,
    'no-waiting-send-from-reply-state',
    /waitingSend[\s\S]{0,600}reply\.state\s*={2,3}\s*['"]waiting_send['"]/,
    'waitingSend 不允许读取 reply.state；请改用 composerState / flags.pendingSend / sendPhase。',
  );

  addRegexFailures(
    filePath,
    text,
    'no-authority-reply-state-waiting-send-constant',
    /authority\.reply\.state\s*={2,3}\s*TOOLBOX_REPLY_STATES\.WAITING_SEND/,
    '禁止用 authority.reply.state 判断 WAITING_SEND；请改用 isToolboxAuthorityWaitingSend(authority)，而该函数必须读 composerState / sendPhase / pendingSend。',
    isAllowedReplyStateWaitingSendSelfCheckLine,
  );

  addRegexFailures(
    filePath,
    text,
    'no-copy-hotkey-once-legacy-running-to-phase',
    /phase\s*=\s*copyHotkeyOnceTaskRunning\s*\?\s*['"]running['"]\s*:\s*['"]idle['"]/,
    'copyHotkeyOnceTaskRunning 不能决定按钮 phase；请改用 readTaskPhaseForLegacyBridge("copyHotkeyOnce", state.copyHotkeyOnceTask)。',
  );

  addRegexFailures(
    filePath,
    text,
    'no-stop-task-direct-legacy-continue-loop-running',
    /function\s+stopUpload(?:Send)?Task[\s\S]{0,900}if\s*\(\s*copyHotkeyContinueLoopRunning/,
    'stopUploadTask / stopUploadSendTask 不允许直接依赖 copyHotkeyContinueLoopRunning；请改用 isCopyHotkeyContinueLoopActiveByTask()。',
  );

  addRegexFailures(
    filePath,
    text,
    'no-upload-ui-action-direct-legacy-loop-running',
    /function\s+runUploadUiAction[\s\S]{0,8000}\|\|\s*copyHotkeyContinueLoopRunning\b/,
    'runUploadUiAction 内不允许直接使用 copyHotkeyContinueLoopRunning 判断防抖或可取消状态；请改用 isCopyHotkeyContinueLoopActiveByTask()。',
    isAllowedLegacyRunningReadOnlyLine,
  );

  addRegexFailures(
    filePath,
    text,
    'button-state-source-must-mark-legacy-readonly',
    /\[BUTTON_STATE\]\[SOURCE\][\s\S]{0,500}legacyRunning(?![\s\S]{0,500}legacyReadOnly=1)/,
    '[BUTTON_STATE][SOURCE] 输出 legacyRunning 时必须同时输出 legacyReadOnly=1。',
  );
}

const uploadModulePath = path.join(sourceRoot, 'upload/upload-module.js');
const uploadModuleText = readText(uploadModulePath);

function isLegacyReadOnlyLogSnippet(snippet) {
  return snippet.includes('legacyReadOnly=1') || snippet.includes('legacyRunning=');
}

if (uploadModuleText) {
  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-authority-reply-state-waiting-send-constant',
    /authority\.reply\.state\s*={2,3}\s*TOOLBOX_REPLY_STATES\.WAITING_SEND/,
    '禁止用 authority.reply.state 判断 WAITING_SEND；请改用 isToolboxAuthorityWaitingSend(authority)。',
  );

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-copy-hotkey-once-legacy-running-to-phase',
    /phase\s*=\s*copyHotkeyOnceTaskRunning\s*\?\s*['"]running['"]\s*:\s*['"]idle['"]/,
    'copyHotkeyOnceTaskRunning 不能决定按钮 phase；请改用 readTaskPhaseForLegacyBridge("copyHotkeyOnce", state.copyHotkeyOnceTask)。',
  );

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-upload-cadence-direct-legacy-running',
    /UPLOAD_CADENCE[\s\S]{0,1200}(?:\|\||&&|if\s*\()\s*copyHotkeyUploadVerifyLoopRunning/,
    'UPLOAD_CADENCE 不能直接依赖 copyHotkeyUploadVerifyLoopRunning；旧字段只能作为 legacyReadOnly 日志。',
    (lineText, filePath, snippet = '') => isLegacyReadOnlyLogSnippet(snippet || lineText),
  );

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-stop-task-direct-legacy-continue-loop-running',
    /function\s+stopUpload(?:Send)?Task[\s\S]{0,1200}(?:\|\||&&|if\s*\()copyHotkeyContinueLoopRunning/,
    'stopUploadTask / stopUploadSendTask 不能直接依赖 copyHotkeyContinueLoopRunning；请改用 isCopyHotkeyContinueLoopActiveByTask()。',
    (lineText, filePath, snippet = '') => (
      isLegacyReadOnlyLogSnippet(snippet || lineText)
      || (snippet || lineText).includes('isCopyHotkeyContinueLoopActiveByTask')
    ),
  );

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'button-state-source-must-mark-legacy-readonly',
    /\[BUTTON_STATE\]\[SOURCE\][\s\S]{0,500}legacyRunning(?![\s\S]{0,500}legacyReadOnly=1)/,
    '[BUTTON_STATE][SOURCE] 输出 legacyRunning 时必须同时输出 legacyReadOnly=1。',
  );

  const stateFieldsCallCount = (uploadModuleText.match(/logToolboxAuthorityStateFields\(/g) || []).length;
  if (stateFieldsCallCount < 2) {
    failures.push({
      filePath: uploadModulePath,
      line: 0,
      rule: 'state-fields-log-not-called',
      message: 'logToolboxAuthorityStateFields() 必须既有定义，也必须在 buildToolboxAuthorityState() 中调用。',
      lineText: `callCount=${stateFieldsCallCount}`,
    });
  }

  const requiredFragments = [
    'composerState,',
    'sendPhase,',
    'uploadQuotaExceeded,',
    'uploadQuotaRemaining,',
    'flags.composerState',
  ];
  for (const fragment of requiredFragments) {
    if (!uploadModuleText.includes(fragment)) {
      failures.push({
        filePath: uploadModulePath,
        line: 0,
        rule: 'missing-authority-field',
        message: `authority 主链路缺少必要字段或引用：${fragment}`,
        lineText: '',
      });
    }
  }

  const requiredTaskBridgeFragments = [
    'function isCopyHotkeyUploadVerifyLoopActiveByTask(',
    'function isCopyHotkeyContinueLoopActiveByTask(',
    'function isCopyHotkeyOnceActiveByTask(',
    'function readTaskPhaseForLegacyBridge(',
  ];
  for (const fragment of requiredTaskBridgeFragments) {
    if (!uploadModuleText.includes(fragment)) {
      failures.push({
        filePath: uploadModulePath,
        line: 0,
        rule: 'missing-task-bridge-function',
        message: `缺少 copyHotkey task bridge 函数定义：${fragment}`,
        lineText: '',
      });
    }
  }

  const requiredRuntimeSelfCheckFragments = [
    'function runUploadModuleStateBoundarySelfCheck(',
    'runStateBoundarySelfCheck: runUploadModuleStateBoundarySelfCheck',
    '[STATE_BOUNDARY_SELF_CHECK][OK]',
    '[STATE_BOUNDARY_SELF_CHECK][FAILED]',
  ];
  for (const fragment of requiredRuntimeSelfCheckFragments) {
    if (!uploadModuleText.includes(fragment)) {
      failures.push({
        filePath: uploadModulePath,
        line: 0,
        rule: 'missing-runtime-state-boundary-self-check',
        message: `缺少运行时状态边界自检片段：${fragment}`,
        lineText: '',
      });
    }
  }

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-copy-hotkey-loop-toggle-direct-legacy-running',
    /function\s+(?:runCopyHotkeyContinueLoop|toggleCopyHotkeyContinueLoop|requestCopyHotkeyContinueLoopStop)[\s\S]{0,2000}(?:\|\|\s*copyHotkeyContinueLoopRunning\b|&&\s*!copyHotkeyContinueLoopRunning\b)/,
    '无限复制+快捷键循环启动/停止判断不能直接读取 copyHotkeyContinueLoopRunning；请改用 isCopyHotkeyContinueLoopActiveByTask()。',
  );

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-auto-upload-finally-direct-legacy-running',
    /copyHotkeyContinueLoopRunning\s*&&\s*!copyHotkeyContinueLoopStopRequested\s*&&\s*loopTask\.phase\s*===\s*['"]auto_uploading['"]/,
    'auto-upload finally 不允许直接依赖 copyHotkeyContinueLoopRunning；请改用 isCopyHotkeyContinueLoopActiveByTask()。',
  );

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-reply-state-waiting-send-runtime',
    /replyState\s*===\s*['"]waiting_send['"]/,
    '运行时判断不允许把 replyState 当成 waiting_send；waiting_send 只能在 rawState / sendPhase / composerState 中表达。',
    isAllowedReplyStateWaitingSendSelfCheckLine,
  );

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-upload-cadence-direct-legacy-running',
    /function\s+recordMessageSentAfterConfirmed[\s\S]{0,600}copyHotkeyUploadVerifyLoopRunning\s*\)/,
    'recordMessageSentAfterConfirmed 不能直接依赖 copyHotkeyUploadVerifyLoopRunning；请改用 isCopyHotkeyUploadVerifyLoopActiveByTask()，旧字段只能作为 legacyReadOnly 日志。',
  );

  addRegexFailures(
    uploadModulePath,
    uploadModuleText,
    'no-upload-cadence-prepare-direct-legacy-running',
    /function\s+prepareUploadByCadenceIfNeeded[\s\S]{0,1200}\|\|\s*copyHotkeyUploadVerifyLoopRunning/,
    'prepareUploadByCadenceIfNeeded 不能直接依赖 copyHotkeyUploadVerifyLoopRunning；请改用 isCopyHotkeyUploadVerifyLoopActiveByTask()，旧字段只能作为 legacyReadOnly 日志。',
  );
}

if (failures.length > 0) {
  console.error('[CHECK_AUTHORITY_STATE_BOUNDARIES][FAILED]');
  for (const failure of failures) {
    console.error(`${failure.filePath}:${failure.line} [${failure.rule}] ${failure.message}`);
    if (failure.lineText) {
      console.error(`  > ${failure.lineText}`);
    }
  }
  process.exit(1);
}

console.log('[CHECK_AUTHORITY_STATE_BOUNDARIES][OK] authority state boundaries are clean.');
