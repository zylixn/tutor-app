# Git Push 审批流程 — AI 执行 SOP

> **适用范围**：所有需要 `git push` 的 AI 员工
> **机制**：PreToolUse hook 通过 Challenge-Response 确保推送需人类审批

## 标准操作流程

AI 执行 `git push` → hook 生成挑战码 → PM 批准 → AI 写入 token 后重新推送

```
Step 1: AI 确认无未提交修改，执行 git push public <branch>
        → Hook 拒绝，输出挑战码（如 9ae52674）+ 两步操作指令

Step 2: AI 停止一切修改，等待 PM 审批（不得创建新 commit）

Step 3: PM 回复「批准 9ae52674」

Step 4: AI 分两步执行 hook 提示的命令:
        步骤1: echo "9ae52674" > .claude/.push-approved
        步骤2: git push public <branch>
        → Phase 2 自动匹配 token，删除两个状态文件，推送通过
```

## AI 必须遵守的规则

1. **永远不要**在 PM 批准前自行写入 `.push-approved` 文件
2. **收到批准后**，必须分两步执行：先 `echo "NONCE" > .claude/.push-approved`，再 `git push public <branch>`
3. **⚠️ 挑战码绑定 HEAD hash。挑战码生成后到 push 完成前，绝对禁止创建新 commit**——否则挑战码立即失效，必须重新触发
4. **挑战码有效期 5 分钟**（300 秒），超时需要重新触发
5. 如果在写入 token 前又一次执行了 `git push`，hook 的 Phase 2b 会**保留**挑战码并提示补充 token（不会再覆盖）

## Hook 错误消息速查

| 消息关键词 | 原因 | AI 动作 |
|-----------|------|--------|
| 「推送需要审批」 | 首次触发，新挑战码生成 | 等待 PM 批准 |
| 「已生成但尚未获得批准」 | 挑战码还在有效期内，但 token 未写入 | 等待 PM 批准后执行批准命令 |
| 「挑战码已过期」 | 超过 5 分钟 | 重新 `git push` 触发新挑战码 |
| 「HEAD 已变更」 | 两次 push 之间产生了新 commit | 重新 `git push` 触发新挑战码 |
| 「令牌与挑战码不匹配」 | 写入的 token 与当前挑战码不一致 | 按 hook 提示的正确挑战码重新写入 |

## 文件说明

| 文件 | 用途 | 生命周期 |
|------|------|---------|
| `.claude/.push-challenge` | 当前挑战码（格式: NONCE:HASH:TIMESTAMP） | 批准通过后自动删除 |
| `.claude/.push-approved` | PM 批准的 token | 批准通过后自动删除 |

**清理机制**：hook 在 source helper 后立即 `cd "$CLAUDE_PROJECT_DIR"`（兜底：`git rev-parse --show-toplevel`），确保 `.claude/.push-*` 相对路径可解析；清理失败降级为 stderr warning，不阻塞已通过 token 验证的 push。详见 ADR-007。

> Hook 脚本位置：`.claude/hooks/claude/pre-tool-use-git-guard.sh`
