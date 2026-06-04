# Refactor Module Ownership

本文件用于约束重构期间的唯一实现归属，避免同一能力在多个模块重复维护。

## 当前 canonical owner

| 能力 | 当前唯一可信实现 | 候选拆分模块 | 当前状态 |
|------|------------------|--------------|----------|
| Composer 根节点查找 | core/main.js / ComposerApi | core/composer-api.js | 候选 adapter，未打包 |
| Composer 文本写入 | core/main.js / ComposerApi.setComposerValue | core/composer-api.js | 候选 adapter，未打包 |
| 输入同步等待 | core/main.js / waitForComposerTextSynced | core/composer-input-sync.js | 候选 adapter，未打包 |
| 真实发送按钮查找 | core/main.js / ComposerApi.findSendButton | core/composer-send-button-detector.js | 候选 adapter，未打包 |
| 统一发送入口 | core/send-pipeline.js + send/composer-send-service.js | upload/upload-send-flow.js | send-flow 暂不作为 canonical |
| 上传执行 | upload/upload-module.js | upload/upload-runner.js | runner 暂不作为 canonical |
| 上传额度 | upload/upload-module.js | upload/upload-quota.js | quota 暂不作为 canonical |
| 闭环配置 | upload/closed-loop-config.js | upload/upload-module.js 内旧逻辑 | closed-loop-config 应成为 canonical |
| 上传队列数据 | upload/upload-queue-store.js | upload/upload-module.js 内旧逻辑 | queue-store 应成为 canonical |
| 上传持久化 | upload/upload-persist-db.js | upload/upload-module.js 内旧逻辑 | persist-db 应成为 canonical |
| 上传文件来源 | upload/upload-file-source.js | upload/upload-module.js 内旧逻辑 | file-source 应成为 canonical |
| 上传列表渲染 | upload/upload-render-list.js | upload/upload-module.js 内旧逻辑 | render-list 应成为 canonical |

## 禁止事项

- 禁止在 upload/upload-module.js 中继续新增 Composer 文本写入、发送按钮检测、上传文件解析的新实现。
- 禁止在 autoqueue/auto-queue-core.js 中继续新增 Composer 发送实现。
- 禁止按钮状态直接读取 DOM disabled 作为最终判断来源。
- 禁止新模块反向委托 legacy 后就认为完成拆分。
- 删除重复代码前必须先保证 build order 已接入 canonical module。
