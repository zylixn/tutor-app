# Dispatch Flow — 详细 dispatch 流程

> 主会话在 dispatch sub-agent 阶段需要详细规则时 Read 本文件。
> 主 SKILL.md 已含 7 步循环骨架，本文件覆盖**模板选择、字段填充、per-phase 裁剪**细节。

## dispatch-prompt 命令输出字段

`node $SCRIPT dispatch-prompt <change-name>` 返回：

| 字段 | 用途 |
|------|------|
| `role` | 角色（architect/developer/tester/reviewer/debate） |
| `agent_path` | 角色定义文件路径（**模板禁止让 sub-agent Read**，已通过 validation.agent_file_content 提供） |
| `phase` | 当前阶段 |
| `change_name`, `title` | 任务标识 |
| `acceptance_criteria` | 验收标准数组 |
| `previous_summary` | 前一阶段摘要（一句话） |
| `context_pack` | 按 phase 裁剪后的上下文包（含 spec_docs / harness_rules / git_diff / agent_history 等子字段） |
| `validation.agent_file_content` | **已展开的角色定义全文**（注入到模板 `<agent_definition>`） |
| `validation.passed` | agent 文件 >= 50 行校验 |

## 模板选择

| 场景 | 模板文件 |
|------|---------|
| 有 rd_skill（explore/propose/implement/archive） | `templates/dispatch-with-skill.md` |
| 无 rd_skill（test/code-review/debate） | `templates/dispatch-without-skill.md` |
| 返工（advance 返回 `next_action: "rework"`） | 对应阶段模板 + **末尾追加** `templates/dispatch-rework.md` |
| 设计评审（design-review 阶段） | `templates/dispatch-design-review.md`（对抗性审查） |
| 归档 | `templates/dispatch-archive.md` |
| 并行派发（team mode implement） | `templates/dispatch-fanout.md` |
| ADR 流程 | `templates/dispatch-adr.md` |

## 有 rd_skill 的 dispatch 流程（最常见）

1. `node $SCRIPT dispatch-prompt <name>` → 取所有字段
2. 校验 `validation.passed`
3. `node $SCRIPT mark-dispatch <name> --start`
4. **按 `dispatch-with-skill.md` 模板组装 prompt**：
   - 用 dispatch-prompt output 填充占位符
   - `<agent_definition>` 块注入 `validation.agent_file_content`
   - `<project_context>` / `<relevant_rules>` / `<git_diff>` / `<agent_history>` 注入 `context_pack.*.content`
   - **禁止**让 sub-agent 自己 Read agent_path
5. dispatch sub-agent
6. `node $SCRIPT mark-dispatch <name> --end`

## design-review 阶段

使用 `dispatch-design-review.md`（不走 dispatch-with-skill.md）：
- 对抗性审查协议（"Do Not Trust the Architect"）
- 强制先 Read proposal.md + design.md + tasks.md
- 输出结构化 JSON concerns + 写入 shared-state

## rework 派发

当 advance 返回 `next_action: "rework"`：
1. 按对应阶段模板（如 dispatch-with-skill.md）组装 prompt
2. **末尾追加** `dispatch-rework.md` 填充：
   - `{previous_phase}` / `{reason}` / `{next_role}` / `{rework_count}` / `{pua_debugging_required}` 来自 advance 返回值
3. rework sub-agent 必须先 `read-shared-state <name> --key concerns --status open`

## evaluate_concerns（暂停请 PM 评估）

当 advance 返回 `next_action: "evaluate_concerns"`（`needs_pm: true`）——**不 dispatch sub-agent**，而是暂停等待 PM。两个独立触发来源（OR 关系）：

1. **open P0 veto**：advance 读 `concerns.json` 发现 open P0（status !== 'resolved'）。无论 Worker 返回 `DONE_WITH_CONCERNS` 还是 code-review DONE，只要 open P0 > 0 就停。
2. **Worker 显式 `NEEDS_PM`**：Worker 主动声明下一步需 PM 拍板（歧义/取舍/显式请求）。不递增 `blocked_count`。

PM 处理后，通过 `resolve-concern` 标记 P0 resolved，或重新 `advance` 推进。`DONE_WITH_CONCERNS` + 无 open P0 不会触发本分支（自动推进，标 `[auto-promoted]`）。

## 自动化阶段（不 dispatch）

- **intake**：`run-automated` 命令，验证 title 非空 / criteria 至少 1 条 / 无冲突
- **smoke**：implement→test 阶段触发，内联执行 compile + lint（非独立 dispatch）

## 前置指导

advance 输出 `pre_guidance` 非空时（基于该角色最近 first_pass_rate < 0.5），追加到 prompt 末尾。

## per-phase 上下文裁剪（自动生效）

dispatch-prompt 调用 `assembleContextPack(changeName, intent, context_mode, phase)`，按 `context-pack.js:274-283` 的 `PHASE_CONTEXT_SKIP` 表自动跳过：

| 阶段 | 自动跳过的 context source |
|------|--------------------------|
| explore | git_diff、error_log、agent_history |
| propose | git_diff、error_log、agent_history |
| design-review | git_diff、error_log |
| implement | error_log |
| test | error_log、harness_rules |
| code-review | 无跳过 |
| debate | git_diff、error_log |
| archive | git_diff、error_log、spec_docs、agent_history |

`harness_rules` 按 `PHASE_RULES_ANCHORS`（context-pack.js:287-296）从 yaml 切片 2000 字符注入。

## Context Mode 自动升级

sub-agent 返回 NEEDS_CONTEXT → minimal → read_only → full。最多 2 次，超过 → escalate_to_pm。

## BLOCKED 处理

连续 3 次 BLOCKED → escalate_to_pm（advance.js:191-202 的 checkCircuitBreaker）。

## 制品校验门禁

sub-agent 完成 DONE 后，orchestrator 自动校验：
- explore：不做校验
- propose：proposal.md + design.md + tasks.md 必须存在
- implement：代码文件存在（git diff 非空）
- 校验失败 → 重 dispatch（最多 1 次）→ 仍失败 escalate_to_pm
