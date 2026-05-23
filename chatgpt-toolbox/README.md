# ChatGPT Toolbox — Tampermonkey build

## 目录说明

| 路径 | 用途 |
|------|------|
| `tampermonkey-userscript-src/` | **开发源码**（按模块拆分，勿使用 `src/` 作为目录名） |
| `dist/client.user.js` | **安装到 Tampermonkey** 的单文件脚本（构建产物） |
| `build.userjs.mjs` | 将源码拼接为完整 userscript 并写入 `dist/` |

仓库根目录的 `client.user.js` 在 `npm run build` 后会与 `dist/client.user.js` **自动同步**（生成文件，禁止手改）。**在 Tampermonkey 中请安装本目录下的 `dist/client.user.js`**。构建产物顶部带有 `GENERATED FILE - DO NOT EDIT DIRECTLY` 提示。

## 开发

```bash
cd chatgpt-toolbox
npm install
npm run build
```

监听重建：

```bash
npm run watch
```

从仓库根目录 `client.user.js` 重新生成模块切片（首次搭建或大范围合并后）：

```bash
python tools/generate_userscript_modules.py
```

## 模块文件

- `main.js` — UserScript 元数据头、初始化与启动（中间插入 upload 相关模块）
- `state.js` — 共享常量与默认配置
- `logger.js` — DOM/事件/存储等基础工具
- `toolbox-ui.js` — `ToolboxShell` 面板
- `upload.js` — `UploadModule` 主体（上传队列等）
- `continue.js` — 复制并继续
- `loop.js` — 连续复制+快捷键+继续
- `shortcut.js` — 上传/快捷键相关绑定
