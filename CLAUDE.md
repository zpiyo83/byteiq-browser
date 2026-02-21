# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Byteiq Browser 是一个基于 Electron 和 Chromium 内核的社区驱动 AI 浏览器。项目使用 JavaScript 编写，采用主进程-渲染进程架构。

## 开发命令

### 运行和构建
```bash
npm run dev          # 开发模式启动（自动打开 DevTools）
npm start            # 生产模式启动
npm run build        # 构建 Windows 安装包（NSIS）
```

### 代码质量
```bash
npm run lint         # 检查代码规范
npm run lint:fix     # 自动修复代码规范问题
npm run format       # 格式化代码
npm run format:check # 检查代码格式
```

### 测试
```bash
npm test             # 运行所有测试
npm run test:coverage # 生成测试覆盖率报告
```

注意：不要使用 `npm run test:watch`，这是长期运行的命令，应该由用户手动执行。

## 架构设计

### 进程架构

项目遵循 Electron 的多进程架构：

- **主进程** (`src/main/main.js`): 管理应用生命周期、窗口创建、IPC 通信、下载管理、开发者工具侧边栏
- **渲染进程** (`src/renderer/renderer.js`): 管理 UI 交互、标签页、webview、浏览器功能

### 主进程模块 (`src/main/modules/`)

- `extensions-manager.js` + `extensions-ipc-handlers.js`: 扩展系统管理
- `translation-ipc.js`: 翻译功能的 IPC 处理器
- `translation/ai-translator.js`: AI 翻译引擎（支持 OpenAI/Anthropic 格式）
- `translation/bing-translator.js`: Bing 翻译引擎

### 渲染进程模块 (`src/renderer/modules/`)

模块化设计，每个管理器负责特定功能：

- `tabs/tab-manager.js`: 标签页管理（创建、切换、关闭）
- `navigation/browser-manager.js`: 浏览器导航（前进、后退、刷新、URL 处理）
- `downloads/downloads-manager.js`: 下载管理（进度、暂停、恢复、取消）
- `extensions/extensions-manager.js`: 扩展管理（加载、启用、禁用）
- `ui/translation-manager.js`: 翻译管理（页面翻译、流式翻译、动态监听）
- `ui/ai-manager.js`: AI 助手侧边栏
- `ui/context-menu-manager.js`: 右键菜单
- `ui/find-manager.js`: 页面查找
- `ui/list-panel-manager.js`: 历史记录、书签、下载面板
- `ui/modal-manager.js`: 模态对话框
- `ui/overlay-manager.js`: 覆盖层管理
- `ui/shortcuts-manager.js`: 键盘快捷键
- `app/events/`: 事件绑定逻辑

### 翻译系统架构

翻译功能是项目的核心特性之一，支持离线和 AI 翻译：

1. **文本收集**: 通过注入脚本 (`translation/scripts.js` 中的 `COLLECT_TEXT_SCRIPT`) 收集页面文本节点
2. **分块处理**: `translation-manager.js` 中的 `chunkTexts()` 根据引擎限制分块
3. **并发翻译**: 支持多个翻译块并发处理
4. **流式应用**: AI 翻译支持流式响应，实时更新页面内容
5. **动态监听**: `translation/dynamic-listener.js` 监听 DOM 变化，自动翻译新内容

翻译引擎限制：
- Bing: 每次最多 1000 个文本块，总字符数 50000
- AI: 每次最多 100 个文本块，总字符数 10000

### 样式系统

- `src/renderer/styles/chrome.css`: 主要 UI 样式
- `src/renderer/styles/animations.css`: 动画效果
- `src/renderer/styles/utilities.css`: 工具类样式
- `src/renderer/fragments/`: HTML 片段（通过 `layout-loader.js` 动态加载）

### 数据持久化

使用 `electron-store` 进行配置存储，主要配置项：
- `settings.searchEngine`: 搜索引擎
- `settings.startupUrl`: 启动页 URL
- `settings.darkMode`: 深色模式
- `settings.translation.*`: 翻译相关配置
- `bookmarks`: 书签数据
- `history`: 历史记录
- `extensions`: 扩展配置

## 代码规范

### ESLint 配置
- 使用 ES6+ 语法，禁止 `var`
- 优先使用 `const`
- 单引号字符串
- 2 空格缩进
- 必须使用分号
- 允许 `console.error` 和 `console.warn`，警告 `console.log`

### Prettier 配置
- 单引号
- 分号结尾
- 无尾随逗号
- 行宽 100 字符
- 箭头函数参数不加括号（单参数时）

### Git Hooks
项目使用 Husky + lint-staged，提交前自动运行 ESLint 和 Prettier。

## 关键技术点

### Webview 管理
- 使用 Electron 的 `<webview>` 标签嵌入网页内容
- 每个标签页对应一个 webview 实例
- 通过 `webContents` API 控制 webview 行为

### IPC 通信模式
- 主进程通过 `ipcMain.on()` 监听渲染进程事件
- 渲染进程通过 `ipcRenderer.send()` 发送事件
- 主进程通过 `webContents.send()` 向渲染进程发送消息

### 开发者工具侧边栏
- 使用 `BrowserView` 实现侧边栏式开发者工具
- 通过 `setDevToolsWebContents()` 关联目标 webview
- 支持拖拽调整宽度

### 扩展系统
- 支持加载本地扩展目录
- 扩展配置存储在 `electron-store` 中
- 通过 `session.loadExtension()` 加载扩展

## 国际化

使用自定义 i18n 系统 (`src/renderer/i18n.js`)，支持中英文切换。翻译文件位于 `src/renderer/locales/`。

## 注意事项

- 项目使用 `nodeIntegration: true` 和 `contextIsolation: false`，需注意安全性
- Webview 内容与主应用隔离，通过 IPC 通信
- 翻译功能需要配置 AI 端点或使用 Bing 翻译
- 开发模式使用 `--dev` 参数启动
