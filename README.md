# Byteiq Browser

<div align="center">

**社区驱动的 AI 浏览器**

基于 Chromium 内核 · Electron 构建 · 开源社区驱动

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/MICTCWM/byteiq-browser)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

</div>

## 📖 简介

Byteiq Browser 是一款由社区驱动的 AI 浏览器，基于 Chromium 内核和 Electron 框架构建。我们的目标是打造一个开放、透明、由社区共同参与的浏览器项目。

### ✨ 特性

- **Chromium 内核**：使用成熟的 Chromium 渲染引擎，提供出色的网页兼容性
- **Electron 28 框架**：现代化跨平台支持
- **社区驱动**：由开源社区共同开发和维护
- **AI 智能助手**：集成 AI 对话功能，支持 Agent 模式自动执行工具调用
- **后台任务**：AI 任务可发送到后台静默执行，完成后通知查看结果
- **工具调用可视化**：实时显示工具执行状态，带切换动画效果
- **多语言支持**：支持中文、繁体中文、英语、日语、韩语、俄语等 6 种语言
- **深色模式**：完整的深色模式支持，基于品牌设计语言
- **模块化架构**：主进程与渲染进程分离，代码结构清晰
- **开源透明**：MIT 许可证，代码完全开放

### 🎯 项目目标

- 打造一个真正由社区驱动的浏览器
- 提供透明、可信赖的浏览体验
- 集成 AI 技术，提升浏览效率
- 建立活跃的开源社区

## 🆕 v0.2.0 新功能

- **后台任务系统**：AI 对话可发送到后台静默执行，支持多任务并行，完成后桌面通知提醒
- **工具调用实时展示**：后台任务面板实时显示当前工具调用状态（运行中/成功/失败），工具切换带渐隐渐显动画
- **任务持久化**：已完成的任务在重启应用后仍然保留，可随时查看结果
- **任务管理**：支持取消运行中任务、删除已完成任务
- **品牌配色统一**：全局统一使用品牌蓝 (#3464ff) 配色方案，深色模式完整适配
- **6 种语言支持**：新增日语、韩语、俄语界面翻译
- **后台发送按钮优化**：降低视觉权重，图标更直观表达"后台/异步"含义

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- Windows 10/11（当前主要支持平台）

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

### 其他常用命令

```bash
npm run lint          # 代码检查
npm run lint:fix      # 自动修复代码问题
npm run format        # 代码格式化
npm run test          # 运行测试
npm run test:coverage # 生成测试覆盖率报告
```

## 📁 项目结构

```
byteiq-browser/
├── src/                 # 源代码目录
│   ├── main/           # Electron 主进程
│   └── renderer/       # 渲染进程（UI）
├── tests/              # 测试文件
├── assets/             # 静态资源
├── docs/               # 重构汇报文档（被git忽略）
├── .github/            # GitHub 配置
├── CONTRIBUTING.md     # 贡献指南
├── 开源教程.md          # 开源入门教程
├── CODE_OF_CONDUCT.md  # 行为准则
├── README.md           # 项目说明（本文件）
├── LICENSE             # 开源许可证
└── package.json        # 项目配置
```

## 📚 学习资源

- **[开源教程.md](开源教程.md)** - 开源入门完整教程，适合新手上路
- **[CONTRIBUTING.md](CONTRIBUTING.md)** - 贡献指南，了解如何参与项目
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** - 社区行为准则

## 🤝 贡献

### 贡献方式

- 🐛 报告 Bug
- 💡 提出新功能建议
- 📝 改进文档
- 🧪 编写测试
- 💻 提交代码

### 如何开始

1. Fork 本仓库
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的改动 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启一个 Pull Request

## 📮 联系我们

- GitHub Issues: [提交问题](https://github.com/MICTCWM/byteiq-browser/issues)

## 📜 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🌟 致谢

感谢所有为 Byteiq Browser 做出贡献的开发者！
