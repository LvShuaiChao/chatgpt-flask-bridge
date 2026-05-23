const fs = require('fs');
const filepath = 'E:\\Documents\\Desktop\\chatgpt-flask-bridge\\chatgpt-toolbox\\build.userjs.mjs';
let content = fs.readFileSync(filepath, 'utf-8');

// Replace hardcoded PARTS, UPLOAD_PART, AUTOQUEUE_PART with dynamic loading from .build-order.json
const oldConsts = "const UPLOAD_MARKER = '/*__UPLOAD_MODULES__*/';\nconst PARTS = [\n  'core/state.js',\n  'core/logger.js',\n  'ui/toolbox-shell.js',\n];\nconst UPLOAD_PART = 'upload/upload-module.js';\nconst AUTOQUEUE_PART = 'autoqueue/auto-queue.js';";

const newConsts = "const UPLOAD_MARKER = '/*__UPLOAD_MODULES__*/';\n\n/** Load build config and extract parts */\nfunction loadParts() {\n  const config = loadBuildConfig();\n  const parts = config.parts || [];\n  const nonEntryParts = parts.filter(function(p) { return p !== 'core/main.js'; });\n  // The upload part is identified by the marker in main.js\n  return nonEntryParts;\n}";

content = content.replace(oldConsts, newConsts);
console.log('Replaced PARTS constants');

// Replace the assembleUserscript function to use dynamic parts
const oldAssemble = 'function assembleUserscript() {\n  const config = loadBuildConfig();\n  const marker = config.uploadInsertMarker || UPLOAD_MARKER;\n  const mainText = fs.readFileSync(ENTRY_FILE, \'utf8\');\n  const { header, body: mainBody } = extractHeader(mainText);\n\n  const autoQueuePart = readPart(AUTOQUEUE_PART);\n\n  const body = [\n    ...PARTS.map(readPart),\n    expandMainWithUpload(mainBody, marker),\n    autoQueuePart,\n  ].join(\'\');\n\n  const bundled = (function () {\\n  \\'use strict\\';\\n\\n})();;\n  return [header, buildGeneratedNotice(), bundled, \'\'].join(\'\\n\\n\');\n}';

const newAssemble = 'function assembleUserscript() {\n  const config = loadBuildConfig();\n  const marker = config.uploadInsertMarker || UPLOAD_MARKER;\n  const allParts = config.parts || [];\n  \n  if (!allParts.length) {\n    throw new Error(\'.build-order.json is missing \"parts\" array\');\n  }\n  \n  const mainText = fs.readFileSync(ENTRY_FILE, \'utf8\');\n  const { header, body: mainBody } = extractHeader(mainText);\n  \n  // Build the body: all non-entry parts + main.js body with upload module expanded\n  const nonEntryParts = allParts.filter(function(p) { return p !== \'core/main.js\'; });\n  \n  const bodyParts = nonEntryParts.map(function(p) {\n    return readPart(p);\n  });\n  bodyParts.push(expandMainWithUpload(mainBody, marker));\n  \n  const body = bodyParts.join(\'\');\n  const bundled = (function () {\\n  \\'use strict\\';\\n\\n})();;\n  return [header, buildGeneratedNotice(), bundled, \'\'].join(\'\\n\\n\');\n}';

if (content.includes(oldAssemble)) {
  content = content.replace(oldAssemble, newAssemble);
  console.log('Replaced assembleUserscript function');
} else {
  console.log('Old assembleUserscript not found - checking...');
  const idx = content.indexOf('function assembleUserscript');
  console.log('Found at', idx);
  console.log(content.substring(idx, idx + 400));
}

// Remove the unused expandMainWithUpload function's dependency on UPLOAD_PART
// The expandMainWithUpload already takes the marker as parameter, but uses UPLOAD_PART hardcoded
// Fix: make it read the upload part from config
const oldExpand = 'function expandMainWithUpload(mainBody, marker) {\n  const uploadBlock = readPart(UPLOAD_PART);';
const newExpand = 'function expandMainWithUpload(mainBody, marker) {\n  const config = loadBuildConfig();\n  const allParts = config.parts || [];\n  // The upload module is the second-to-last part before auto-queue\n  const uploadPartName = allParts.filter(function(p) { return p.startsWith(\'upload/\'); })[0] || \'upload/upload-module.js\';\n  const uploadBlock = readPart(uploadPartName);';

content = content.replace(oldExpand, newExpand);
console.log('Updated expandMainWithUpload');

// Also update the error message in expandMainWithUpload to mention the actual filename
const oldError = 'throw new Error(\n      core/main.js is missing upload insert marker . Re-run tools/generate_userscript_modules.py,\n    );';
const newError = 'throw new Error(\n      core/main.js is missing upload insert marker . Check that  contains a valid InsertModule block.,\n    );';
content = content.replace(oldError, newError);
console.log('Updated error message');

// Also update the directory layout comment at the top
const oldComment = '/**\n * Bundle tampermonkey-userscript-src/ into dist/client.user.js (single-file userscript).\n *\n * Directory layout:\n *   core/state.js             - Global state management\n *   core/logger.js             - Logger module\n *   core/main.js               - Entry (header) + ChatMessageExtractor + upload marker\n *   ui/toolbox-shell.js        - Toolbox UI shell\n *   upload/upload-module.js    - Upload module (merged from head/continue/loop/mid/shortcut/tail)\n *   autoqueue/auto-queue.js    - Auto queue module\n *\n * Preserves original monolith line order to remain byte-identical with repo-root client.user.js.\n */';

const newComment = '/**\n * Bundle tampermonkey-userscript-src/ into dist/client.user.js (single-file userscript).\n *\n * Parts list is read from tampermonkey-userscript-src/.build-order.json.\n * core/main.js contains the userscript header and an upload module insertion marker.\n *\n * To modify behavior, edit source files in tampermonkey-userscript-src/, then run:\n *   npm run build\n *\n * Preserves original monolith line order to remain byte-identical with repo-root client.user.js.\n */';

content = content.replace(oldComment, newComment);
console.log('Updated comment');

fs.writeFileSync(filepath, content, 'utf-8');
console.log('Done updating build.userjs.mjs');
