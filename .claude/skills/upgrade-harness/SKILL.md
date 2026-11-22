---
name: upgrade-harness
description: 安装harness、升级harness、upgrade harness, 更新harness, /upgrade-harness
user_invocable: true
---

# 框架升级技能

## 触发场景

- Session 启动时 hook 检测到版本不一致（MAJOR 阻断 / MINOR 建议升级 / PATCH 可选）
- PM 主动执行 `/upgrade-harness`

## 内部常量

| 常量 | 值 |
|------|-----|
| INSTALL_URL | `http://192.168.118.247:49157/harness/install.sh` |
| RAW_BASE | `http://192.168.5.160/public_group/rd_harness/-/raw/main` |

> **RAW_BASE 与 INSTALL_URL 保持一致**：RAW_BASE 的分支（`main`）必须与 install.sh 中 `HARNESS_BRANCH` 的稳定版本一致。install.sh 可能在开发期使用临时分支（如 `feature/530`），但 `main` 是发布分支，版本文件始终存在。

## 执行流程

### 1. 版本对比，等 PM 确认

**PM 确认前不得执行任何文件操作。**

从本地 `.harness/.harness-version` 读取当前版本，curl 拉取远端版本：

```bash
curl -s --connect-timeout 5 --max-time 10 \
  "${RAW_BASE}/.harness/.harness-version"
```

向 PM 展示版本差异，并拉取 CHANGELOG：

```bash
curl -s --connect-timeout 5 --max-time 10 \
  "${RAW_BASE}/CHANGELOG.md"
```

展示格式：

```
当前版本: 1.16.0
目标版本: 1.16.1
强制升级: 是

v1.16.1 变更内容:
  - SessionStart 版本升级检测
  - 版本签名防篡改
  ...
```

等 PM 明确确认。

### 2. 执行升级

```bash
curl -s http://192.168.118.247:49157/harness/install.sh | bash
```

upgrade 完成后，验证版本号与签名：

```bash
# 验证签名
SIGN_SALT="rd-harness-v2"
LOCAL_VERSION=$(head -1 .harness/.harness-version)
LOCAL_SIG=$(sed -n '3p' .harness/.harness-version)
EXPECTED_SIG=$(echo -n "${LOCAL_VERSION}${SIGN_SALT}" | sha256sum | cut -c1-8)
[ "$LOCAL_SIG" = "$EXPECTED_SIG" ] && echo "签名验证通过" || echo "签名验证失败"
```

### 3. 完整性验证

```bash
bash .claude/tools/scripts/setup/setup-harness.sh --check
```

确认 integrity 行显示 `verified`，向 PM 报告结果：

```
升级完成: 1.7.1 → 1.8.0
版本文件已更新: .harness/.harness-version = 1.8.0
```

### 4. 注入已解决的下游 Issue 摘要

升级完成后，从 GitLab 拉取本项目相关的已关闭 issue，写入项目知识库，供下游 AI session-start 自动加载。

**前置条件**：需配置 GitLab 凭证（`.gitlab-config` 或 `GITLAB_TOKEN` 环境变量）。无凭证则跳过本步骤，不阻塞升级。

**执行**：

```bash
bash .claude/skills/issue-board/scripts/gitlab-issue.sh resolved-injection <project-name>
```

`<project-name>` 从项目目录名或 git remote 推导（如 `muse-630`、`dt-topo-service-harness`）。

**产出**：`.harness/knowledge/resolved-issues.md`，包含本项目提交的已关闭 issue 列表及修复摘要。下游 AI session-start 时自动加载此文件，了解"上次提的 issue 是否已修复"。

**示例产出**：

```markdown
## 已解决的框架 Issue（截至 2026-06-22）

| IID | 标题 | 修复 Commit | 状态 |
|-----|------|-----------|------|
| !113 | statusline 与 ESM 项目不兼容 | dc6df6e | 已关闭 |
| !111 | collect-ai.js null quality_metrics | 70b63ac | 已关闭 |
```

## 升级保护规则（红线）

以下文件属于项目状态，**升级时禁止覆盖**。`setup-harness.sh` 通过 `.framework-manifest` 驱动的拷贝机制自动保护，只覆盖 manifest 内的文件：

| 目录/文件 | 说明 |
|-----------|------|
| `CLAUDE.md` | 项目级配置（只创建不覆盖） |
| `.harness/spec/` | SPEC 工作区 |
| `.harness/knowledge/` | 项目知识库 |
| `.harness/memory/` | 项目记忆 |
| `.claude/settings.local.json` | 本地设置 |
| `.claude/skills/*/.daily-report-config` | 日报技能配置 |
| `.gitlab-config` | GitLab 令牌 |

## 执行规则

1. **PM 确认前置**：展示版本差异后，等 PM 明确确认
2. **只覆盖框架核心**：setup-harness.sh 通过 manifest 保护项目状态文件
3. **升级后验证版本**：确认 `.harness/.harness-version` 已更新
4. **失败不回滚**：升级失败时报告错误，由 PM 决定后续操作
