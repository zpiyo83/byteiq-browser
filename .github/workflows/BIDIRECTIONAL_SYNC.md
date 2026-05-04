# GitHub 与 Gitee 双向同步配置指南

## 仓库地址

- GitHub: https://github.com/MICTCWM/byteiq-browser
- Gitee: https://gitee.com/must145/byteiq-browser

## 步骤 1: 配置 GitHub Secrets

在 GitHub 仓库设置中添加以下 Secrets：

| Secret 名称 | 说明 | 获取方式 |
|------------|------|---------|
| `GITEE_USERNAME` | Gitee 用户名 | Gitee 账号用户名 |
| `GITEE_REPO` | Gitee 仓库名 | 如 `byteiq-browser` |
| `GITEE_TOKEN` | Gitee 私人令牌 | Gitee → 设置 → 私人令牌 → 生成新令牌（勾选 repo） |
| `GITEE_SSH_PRIVATE_KEY` | SSH 私钥（可选） | 用于 SSH 方式同步 |

## 步骤 2: Gitee → GitHub 同步

Gitee → GitHub 同步使用定时检查 + 手动触发方式：

- **定时检查**: 每 2 小时自动检查 Gitee 是否有新提交
- **手动触发**: 可在 GitHub Actions 页面手动触发 "Sync from Gitee" workflow

## 同步流程

```
GitHub push → GitHub Actions → 同步到 Gitee
     ↑                                    ↓
     └── 定时检查/手动触发 ←────────────────┘
```

## 注意事项

- 首次配置后，手动触发一次同步测试
- 避免循环同步：可在 workflow 中添加判断条件
- 建议使用 SSH 方式以避免 Token 过期问题
