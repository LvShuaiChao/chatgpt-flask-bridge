# ChatGPT Toolbox — Tampermonkey build

## 目录说明

| 路径 | 用途 |
|------|------|
| `tampermonkey-userscript-src/` | **开发源码**（按模块拆分，勿直接修改 dist/） |
| `tampermonkey-userscript-src/core/` | 核心模块：状态管理、工具函数、启动入口 |
| `tampermonkey-userscript-src/ui/` | 工具箱 UI shell |
| `tampermonkey-userscript-src/upload/` | 上传模块（上传队列、附件挂载、文件读取、UI 渲染等） |
| `tampermonkey-userscript-src/autoqueue/` | 自动队列与 Prompt 管理 |
| `dist/client.user.js` | 安装到 Tampermonkey 的单文件脚本（构建产物） |
| `build.userjs.mjs` | 将源码拼接为完整 userscript 并写入 dist/ |
| `.build-order.json` | 构建顺序配置（build.userjs.mjs 从此读取 parts 列表） |

仓库根目录的 client.user.js 在 npm run build 后会与 dist/client.user.js 自动同步（生成文件，禁止手改）。

在 Tampermonkey 中请安装本目录下的 dist/client.user.js。

## 硬性约束

1. 禁止直接修改 dist/client.user.js 或根目录 client.user.js。
2. 功能改动只改 tampermonkey-userscript-src/ 下的源码文件。
3. 改完后在 chatgpt-toolbox 目录执行 npm run build。
4. 构建后执行 node --check dist/client.user.js 验证语法。

## 开发

cd chatgpt-toolbox
npm run build

监听重建：

npm run watch

## 当前模块文件

core/state.js - 共享常量与默认配置
core/logger.js - DOM/事件/存储等基础工具
core/main.js - UserScript 元数据头、初始化与启动
ui/toolbox-shell.js - ToolboxShell 面板
upload/upload-module.js - UploadModule 主体
autoqueue/auto-queue.js - AutoQueue、PromptManager、Bridge 等

## 构建系统

构建系统由以下文件组成：

- build.userjs.mjs - 主构建脚本，从 .build-order.json 读取 parts 列表并拼接
- .build-order.json - 定义构建顺序、上传插入标记
- package.json - npm run build / npm run watch 入口

构建过程：

1. 读取 .build-order.json 获取 parts 列表
2. 拼接所有非入口模块文件
3. 读取 core/main.js，提取 userscript 元数据头
4. 将上传模块插入到 main.js 的标记位置
5. 包裹 IIFE 并输出到 dist/client.user.js 和根目录 client.user.js