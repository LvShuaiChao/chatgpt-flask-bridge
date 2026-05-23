# Agent 说明：油猴脚本源码优先

本仓库的 ChatGPT 油猴工具箱采用 **源码拆分 + 构建生成单文件**。

## 路径

| 角色 | 路径 |
|------|------|
| 源码 | `chatgpt-toolbox/tampermonkey-userscript-src/` |
| 构建 | `chatgpt-toolbox/build.userjs.mjs` |
| 产物 | `chatgpt-toolbox/dist/client.user.js`、`client.user.js`（根目录同步） |

## 硬性约束

1. **禁止**直接改 `dist/client.user.js` 或根目录 `client.user.js`。
2. 功能改动只改 `tampermonkey-userscript-src/` 或 `build.userjs.mjs`。
3. 改完后在 `chatgpt-toolbox` 执行：`npm run build`。
4. 不要用 `try/pass`；捕获异常须 `console.error` 完整输出。

详细规则见：`.cursor/rules/userscript-source-of-truth.mdc`
