---
name: rd:auto
description: 自动调度 AI 角色完成开发全流程。PM 只需描述需求或给出指令，系统自动串联 rd skill。
trigger: "/rd:auto"
---

# rd:auto — 自动调度循环

你是自动调度引擎的执行者。PM 通过自然语言描述需求，你将其翻译为 orchestrator 命令，驱动 AI 角色自动完成开发全流程。

## 核心原则

- **PM 只说人话**：不需要知道阶段名、CLI 参数、角色分派规则
- **自动推进**：从当前状态开始，连续 dispatch sub-agent 直到需要 PM 介入
- **状态持久化**：每次推进都写入 `.harness/tasks/{change-name}/pipeline-state.json`，不怕上下文压缩
- **不重复 rd 的功能**：制品管理交给 rd 命令，你只负责调度决策

## 引擎调用

```bash
SCRIPT=".claude/skills/rd-auto/scripts/orchestrator.mjs"

# 初始化新任务
node $SCRIPT init <change-name> --title "标题" --criteria "验收条件1,验收条件2" \
  [--flow-type <development|docs|hotfix|refactor|test-only|config-change|quick>] \
  [--intent-json '{"raw_input":"...","task_type":"...","confidence":0.85,"modules":[...],"complexity_hint":"M"}']

# 推进到下一阶段
node $SCRIPT advance <change-name> [--exit-status DONE] [--score 85] [--p0-count 0] [--summary "..."]

# 状态查询
node $SCRIPT status <change-name>
node $SCRIPT dashboard
node $SCRIPT complete <change-name>

# dispatch sub-agent
node $SCRIPT dispatch-prompt <change-name>     # 取 prompt 字段
node $SCRIPT mark-dispatch <change-name> --start|--end
```

## 意图解析（核心规则）

**task_type 关键词映射**（详细推断见 [references/intent-parsing.md](references/intent-parsing.md)）：

| PM 说的 | task_type |
|---------|-----------|
| "实现/开发/新增/添加功能" | development |
| "写文档/ADR" | docs |
| "热修复/hotfix" | hotfix |
| "重构/拆分/合并模块" | refactor |
| "补测试/测试覆盖" | test-only |
| "改配置/CI配置" | config-change |

**change-name 推导**：`"实现用户登录功能" → user-login`；简短、描述性、kebab-case。

**置信度阈值**：confidence >= 0.7 直接执行；< 0.7 向 PM 确认。

**多意图**：输入含 "同时" "另外" "还有" → 拆分独立 pipeline。

**特殊意图**：
- "继续/resume" + 名称 → dashboard 找任务 → advance
- "评审/review" + 名称 → set-phase code-review
- "测试/test" + 名称 → set-phase test
- "归档/archive" + 名称 → set-phase archive
- 无参数 → dashboard

## 自动调度循环

```
1. 解析意图 → confidence >= 0.7 直接执行
   1.5. recommend-mode：team 模式向 PM 建议
2. orchestrator advance
3. next_action 分支处理：
   - automated → run-automated（intake，禁止 dispatch）
   - dispatch + next_rd_skill → dispatch-prompt → mark-dispatch --start
     → 按模板组装 prompt → dispatch sub-agent → mark-dispatch --end
   - dispatch no rd_skill → 同上，不传 rd_skill
   - rework → 对应阶段模板 + 末尾追加 dispatch-rework.md
   - wait_for_pm / needs_pm → 暂停汇报
   - escalate_to_pm → 熔断报告
   - fanout_dispatch → 并行派发 agents[]
4. sub-agent 完成 → 收集 exit_status / summary / score / artifacts
5. 制品校验门禁（强制）→ 失败重 dispatch（最多1次）→ 仍失败 escalate_to_pm
6. advance 传递结果
7. 循环
```

**dispatch 模板选择、字段填充、per-phase 裁剪**：见 [references/dispatch-flow.md](references/dispatch-flow.md)。

**模板列表**（位于 `.claude/skills/rd-auto/templates/`）：
- `dispatch-with-skill.md` — 有 rd_skill（explore/propose/implement/archive）
- `dispatch-without-skill.md` — 无 rd_skill（test/code-review/debate）
- `dispatch-design-review.md` — 对抗性设计审查
- `dispatch-rework.md` — 返工追加段
- `dispatch-fanout.md` — team mode 并行派发
- `dispatch-archive.md` — 归档
- `dispatch-adr.md` — ADR 流程

## 循环终止条件

- escalate_to_pm → 熔断，报告 PM
- open P0 concern → 停，`needs_pm`（PM 必须评估，无论 Worker 返回哪个 exit_status）
- 非 P0 concern（P1/P2/观察性）→ **自动推进**（标记 `[auto-promoted: non-P0 concerns]`，由 code-review scoring 兜底）
- NEEDS_PM（Worker 显式声明）→ 停，`needs_pm`（不递增熔断计数）
- NEEDS_CONTEXT 两次 → 暂停请 PM
- PM 中断 → 暂停

> 路由判据是 `concerns.json` 的 open P0 数量，不再依赖 summary 文本关键词。
> `DONE_WITH_CONCERNS` + 无 open P0 = 自动推进；`DONE_WITH_CONCERNS` + 有 open P0 = 停。

## Shared-State（跨角色状态）

`.harness/shared-state/<change>/` 跨角色共享：
- `concerns.json`：Reviewer 写入 P0/P1，Developer 返工时读取
- P0 veto：code-review 检测 open P0 → rework
- Developer 解决后 `resolve-concern --concern-id C001`

详细协议见 [references/shared-state.md](references/shared-state.md)。

## References 索引（按需 Read，避免主 SKILL.md 膨胀）

- [references/intent-parsing.md](references/intent-parsing.md) — task_type / Flow Type / Context Mode 详细推断表、置信度、多意图、特殊意图、change-name 推导
- [references/dispatch-flow.md](references/dispatch-flow.md) — dispatch-prompt 字段说明、模板选择、字段填充、per-phase 裁剪、Context Mode 升级、BLOCKED 处理、制品校验门禁
- [references/adr-and-quick.md](references/adr-and-quick.md) — ADR 触发条件、Quick Dispatch 4 阶段流程
- [references/shared-state.md](references/shared-state.md) — concerns.json 结构、P0 Veto 机制、与 rd CLI 边界
- [references/example-workflow.md](references/example-workflow.md) — 完整开发流程示例（PM 输入 → archive）
- [references/cost-optimization.md](references/cost-optimization.md) — per-phase 裁剪、模板结构化、shared-state、高 token change 识别
