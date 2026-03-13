# Repository Guidelines

## Project Overview
ByteIQ Browser - 基于 Chromium 内核的社区驱动 AI 浏览器 (v0.1.2)
- 运行环境：Electron 28
- 目标平台：Windows (NSIS 安装包)

## Project Structure
```
src/
├── main/                    # Electron 主进程
│   ├── main.js              # 主进程入口
│   └── modules/             # 主进程模块
│       ├── ai-chat.js       # AI 聊天
│       ├── extensions-*.js  # 扩展管理
│       └── translation/     # 翻译模块
├── renderer/                # 渲染进程 (UI)
│   ├── index.html           # 入口页面
│   ├── renderer.js          # 渲染进程入口
│   ├── i18n.js              # 国际化
│   ├── fragments/layout/    # HTML 布局片段
│   ├── modules/             # 功能模块
│   │   ├── app/events/      # 应用事件
│   │   ├── downloads/       # 下载管理
│   │   ├── extensions/      # 扩展相关
│   │   ├── navigation/      # 导航管理
│   │   ├── storage/         # 数据存储
│   │   ├── tabs/            # 标签页
│   │   ├── translation/     # 翻译功能
│   │   └── ui/              # UI 管理器
│   ├── styles/              # 全局样式
│   │   └── panels/          # 面板样式拆分
│   └── locales/             # 国际化文件
└── tests/                   # Jest 测试
```

## Commands
| 命令 | 说明 |
|------|------|
| `npm install` | 安装依赖 |
| `npm start` | 正常运行 |
| `npm run dev` | 开发模式 |
| `npm run build` | 构建 Windows 安装包 |
| `npm test` | 运行测试 |
| `npm run lint` | ESLint 检查 |
| `npm run lint:fix` | 自动修复 lint 问题 |
| `npm run format` | Prettier 格式化 |

## Dependencies
- **Runtime:** `electron`, `electron-store`
- **Dev:** `eslint`, `prettier`, `jest`, `husky`, `lint-staged`, `electron-builder`

## Coding Style
| 规则 | 值 |
|------|-----|
| 缩进 | 2 空格 |
| 引号 | 单引号 |
| 分号 | 必须使用 |
| 行长 | ≤ 100 字符 |
| 尾随逗号 | 不使用 |
| 函数命名 | camelCase |
| 类命名 | PascalCase |
| 注释语言 | 优先中文 |

## Development Rules
- 文件超过 500 行需按功能拆分
- `main.js` / `renderer.js` 作为编排入口，重逻辑移至 `modules/`
- 保持 `index.html` 轻量，从 `fragments/` 组装结构
- 提交前确保通过 lint 和 format 检查
- 新功能需添加对应测试

## Debugging
- **开发模式:** `npm run dev` 启用开发工具
- **主进程调试:** 使用 `--inspect` 参数或 VS Code 调试器
- **渲染进程调试:** DevTools (F12 或 Ctrl+Shift+I)

## Internationalization (i18n)
国际化文件位于 `src/renderer/locales/`，JSON 结构：
```json
{
  "namespace": {
    "key": "翻译文本"
  }
}
```
**添加新语言：**
1. 复制 `zh-CN.json` 为新文件 (如 `ja-JP.json`)
2. 翻译所有文本值
3. 在 `i18n.js` 中导入并注册新语言

## Git Workflow
- **提交前自动检查:** ESLint + Prettier (husky + lint-staged)
- **提交格式:** `<type>(<scope>): <subject>`
- **类型:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
- **分支命名:** `feature/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`

## Build Configuration
- **目标:** Windows NSIS 安装包
- **配置:** `package.json` → `build` 字段
- **特性:** 支持自定义安装路径、非一键安装