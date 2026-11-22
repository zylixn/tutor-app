# AI 员工调度用量追踪

> 主会话 dispatch Agent 后自动记录执行时长和 token 消耗。

## 自动化机制

`PostToolUse` hook（`.claude/hooks/claude/post-tool-use-agent-usage.sh`）在 Task / Agent 工具执行完毕后自动触发，调用 `orchestrator.mjs record-usage` 写入 `~/.claude/usage/usage.jsonl`。**无需手动调用。**

## 触发场景

主会话通过 `Agent(...)` 工具派发 AI 角色（Architect / Developer / Tester / Reviewer / Debate）时，**无论是否走 rd-auto**，hook 自动记录 usage。

> **注意**：在未安装 PostToolUse hook 的环境中（如 CI、旧版框架），仍需手动执行追踪流程。

## 追踪流程

### Dispatch 前
```bash
TRANSCRIPT_LINE=$(wc -l < ~/.claude/projects/<projectSlug>/<sessionId>.jsonl 2>/dev/null || echo 0)
STARTED_AT=$(date -Iseconds)
```

### Dispatch 后
```bash
node .claude/skills/rd-auto/scripts/orchestrator.mjs record-usage \
  --role <角色名> --trigger natural --task "<描述>" \
  --started-at "$STARTED_AT" --from-line $TRANSCRIPT_LINE
```

## 角色名映射

| Agent subagent_type | --role 值 |
|---|---|
| Architect | architect |
| Developer | developer |
| Tester | tester |
| Reviewer | reviewer |
| Debate | debate |

## rd-auto pipeline 内的 dispatch

pipeline dispatch 的统计来源是 `.harness/tasks/<change>/pipeline-state.json` 的 `dispatch_history`，由 `mark-dispatch --start|--end` 维护。

`mark-dispatch --end` **不再**向 usage.jsonl 追加 `trigger=pipeline` 条目——避免与 pipeline-state.json 双重计数。usage.jsonl 现在只承载 `trigger=natural`。

## 数据格式

每行一条 JSON：ts / session_id / role / trigger / task / started_at / completed_at / duration_ms / tokens

## 查询

```bash
# 按角色汇总今日用量
cat ~/.claude/usage/usage.jsonl | grep '"natural"' | grep '"developer"'
```