# 贡献指南

感谢你对 Byteiq Browser 项目的兴趣！我们欢迎任何形式的贡献。

## 如何开始

### 1. Fork 项目

点击 GitHub 仓库右上角的 "Fork" 按钮，将项目 Fork 到你自己的账户。

### 2. 克隆仓库

```bash
git clone https://github.com/你的用户名/byteiq-browser.git
cd byteiq-browser
```

### 3. 创建分支

```bash
git checkout -b feature/你的功能名称
# 或者
git checkout -b fix/修复的问题
```

分支命名规范：
- `feature/功能名称` - 新功能
- `fix/问题描述` - Bug修复
- `docs/文档更新` - 文档更新
- `refactor/重构内容` - 代码重构
- `test/测试相关` - 测试相关
- `chore/杂项` - 其他杂项

### 4. 安装依赖

```bash
npm install
```

### 5. 启动开发环境

```bash
npm run dev
```

## 开发规范

### 代码风格

- 使用 2 空格缩进
- 使用单引号
- 每行代码不超过 80 字符
- 使用有意义的变量和函数名
- 添加必要的注释

### 提交信息规范

提交信息格式：

```
<type>(<scope>): <subject>

<body>

<footer>
```

Type 类型：
- `feat`: 新功能
- `fix`: Bug修复
- `docs`: 文档更新
- `style`: 代码格式（不影响代码运行的变动）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

示例：
```
feat(ui): 添加暗黑模式支持

添加了暗黑模式切换功能，用户可以在设置中启用。

Closes #123
```

### Pull Request 规范

1. **标题清晰**：使用简洁的标题描述你的改动
2. **详细描述**：在 PR 描述中说明：
   - 改动的内容
   - 改动的原因
   - 测试方法
   - 相关的 Issue 编号
3. **关联 Issue**：如果修复了某个 Issue，在 PR 中关联它
4. **代码审查**：耐心等待维护者审查，并根据反馈进行修改

## 开发流程

### 1. 选择任务

查看 [Issues](https://github.com/你的用户名/byteiq-browser/issues) 页面：
- 标记为 `good first issue` 的任务适合新手
- 标记为 `help wanted` 的任务需要帮助
- 也可以提出新的 Issue

### 2. 开发

- 在你的分支上进行开发
- 编写代码
- 添加测试（如果适用）
- 确保代码通过测试

### 3. 测试

```bash
npm test
```

### 4. 提交代码

```bash
git add .
git commit -m "feat: 添加功能描述"
git push origin feature/你的功能名称
```

### 5. 创建 Pull Request

1. 访问 GitHub 仓库
2. 点击 "New Pull Request"
3. 选择你的分支
4. 填写 PR 描述
5. 提交 PR

## 项目结构

```
byteiq-browser/
├── main.js              # Electron 主进程
├── index.html           # 主界面
├── package.json         # 项目配置
├── CONTRIBUTING.md     # 贡献指南（本文件）
├── README.md           # 项目说明
├── LICENSE             # 开源许可证
├── CODE_OF_CONDUCT.md  # 行为准则
├── .gitignore          # Git 忽略文件
├── docs/               # 文档目录
│   ├── 开源教程.md
│   └── ...
└── src/                # 源代码目录
    ├── renderer/       # 渲染进程
    ├── main/           # 主进程代码
    └── shared/         # 共享代码
```

## 贡献类型

### 代码贡献

- 修复 Bug
- 添加新功能
- 优化性能
- 改进代码结构

### 文档贡献

- 改进文档
- 添加示例
- 翻译文档
- 编写教程

### 测试贡献

- 编写测试用例
- 发现并报告 Bug
- 提供测试反馈

### 设计贡献

- 改进 UI/UX
- 设计图标
- 优化视觉效果

## 社区准则

- **尊重他人**：保持礼貌和专业
- **包容开放**：欢迎不同背景的贡献者
- **建设性反馈**：提供建设性的批评和建议
- **协作共赢**：与他人合作，共同进步

## 获取帮助

如果你在贡献过程中遇到问题：

1. 查看 [Issues](https://github.com/你的用户名/byteiq-browser/issues) 页面
2. 在 Issue 中提问
3. 加入我们的社区讨论

## 许可证

通过向本项目提交代码，你同意你的代码将按照项目的 [LICENSE](LICENSE) 文件中的许可证进行授权。

## 致谢

感谢所有贡献者！你们的贡献让 Byteiq Browser 变得更好。

---

再次感谢你的贡献！让我们一起打造更好的浏览器！
