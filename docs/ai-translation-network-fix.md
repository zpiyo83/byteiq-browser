# AI 翻译网络连接问题修复

## 问题描述

用户在使用 AI 翻译功能时遇到以下错误：
- SSL 握手失败: `handshake failed; returned -1, SSL error code 1, net_error -100`
- 连接超时: `connect ETIMEDOUT 47.79.98.82:443`

## 解决方案

### 1. 改进错误处理和超时设置

**文件**: `src/main/modules/translation/ai-translator.js`

- 添加了 60 秒的请求超时设置
- 改进了错误信息，提供更友好的提示：
  - `ETIMEDOUT`: 提示检查网络连接、防火墙或代理配置
  - `ENOTFOUND`: 提示 DNS 解析失败
  - `ECONNREFUSED`: 提示连接被拒绝
- 添加了 `timeout` 事件处理，防止请求无限期挂起

### 2. 创建网络诊断工具

**新文件**: `src/main/modules/translation/network-diagnostics.js`

实现了完整的网络诊断功能，包括：
- DNS 解析测试
- TCP 连接测试
- HTTPS 握手测试
- HTTP 请求测试
- 自动生成诊断建议

### 3. 添加诊断 IPC 处理器

**文件**: `src/main/modules/translation-ipc.js`

- 注册了 `diagnose-translation-network` IPC 处理器
- 允许渲染进程调用网络诊断功能

### 4. 在 UI 中添加诊断功能

**文件**:
- `src/renderer/modules/ui/translation-manager.js`: 添加 `diagnoseNetwork()` 方法
- `src/renderer/fragments/layout/history-and-settings-panels.html`: 添加"诊断网络"按钮
- `src/renderer/renderer.js`: 添加按钮元素引用
- `src/renderer/modules/app/events/settings-and-panels-events.js`: 绑定按钮点击事件

## 使用方法

1. 打开浏览器设置面板
2. 进入"翻译设置"部分
3. 点击"诊断网络"按钮
4. 系统会自动测试网络连接并显示诊断结果和建议

## 诊断结果示例

诊断工具会测试以下内容：
- DNS 是否能正确解析 API 端点域名
- 是否能建立 TCP 连接
- SSL/TLS 握手是否成功
- HTTP 请求是否正常

根据测试结果，会提供相应的解决建议，例如：
- 更换 DNS 服务器
- 检查防火墙设置
- 配置代理
- 验证 API 端点地址

## 可能的原因和解决方案

### 1. 防火墙阻止
- 检查 Windows 防火墙或第三方防火墙设置
- 允许 Electron 应用访问网络

### 2. 需要代理
- 如果在企业网络环境，可能需要配置代理
- Electron 会使用系统代理设置

### 3. DNS 问题
- 尝试更换 DNS 服务器（如 8.8.8.8 或 1.1.1.1）
- 清除 DNS 缓存: `ipconfig /flushdns`

### 4. API 端点不可达
- 验证 API 端点 URL 是否正确
- 检查 API 服务是否正常运行
- 尝试在浏览器中访问 API 端点

## 技术细节

### 超时设置
```javascript
timeout: 60000 // 60秒超时
```

### 错误处理
```javascript
request.on('timeout', () => {
  request.destroy();
  reject(new Error(`请求超时: 连接到 ${hostname} 超过60秒未响应`));
});
```

### 诊断流程
1. DNS 解析 → 2. TCP 连接 → 3. HTTPS 握手 → 4. HTTP 请求
2. 每个步骤失败都会提供具体的错误信息和建议

## 后续建议

如果诊断显示网络连接正常但翻译仍然失败，请检查：
1. API 密钥是否正确
2. API 端点路径是否完整（如 `/v1/chat/completions`）
3. 请求格式是否符合 API 要求
4. API 配额是否已用完
