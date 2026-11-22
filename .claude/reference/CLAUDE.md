# rd_harness 框架规则
> **框架级规则**。Session 启动注入，项目**不得修改**。冲突时以 `harness-rules.yaml` 为准。
> 项目自生长规则从 `.harness/ai-rules/*.md` 自动加载（无文件则跳过）。

## 1. AI 行为围栏
- **先想清楚再动手**：不假设、不隐藏困惑、暴露权衡。不确定时主动问 PM
- **简单优先**：最小代码解决问题，不做推测性设计
- **精准变更**：只动该动的，不改相邻代码/格式/无关逻辑
- **目标驱动执行**：先定义成功标准，循环直到验证通过
→ `.claude/reference/harness-rules.yaml` → `fence`

## 2. Git 红线
- **禁止 `--amend`**：commit-msg hook 不兼容，100% 拒绝
- **禁止 `--no-verify`**：不得跳过 hook 校验
- **Push 需 PM 审批**：Challenge-Response 流程 → `.claude/reference/harness-rules.yaml` → `constraints.git.push_approval`
- Commit 格式 → `.claude/rules/ai-git-commit-spec.md`

## 3. 多智能体协作
| 角色 | 职责 | 禁忌 |
|------|------|------|
| Architect | 设计、SPEC、ADR | 禁止 git |
| Developer | 实现、单测 | 禁止 git |
| Tester | 集成/E2E 测试 | 禁止 git |
| Reviewer | 评审、质量、UX | 禁止 git |
| Debate | 对抗审计，评分 75-79 或 PM 触发 | — |
**硬规则**：Worker 严禁 git，禁止 Worker 间直接通信（hub-and-spoke）。BLOCKED 连续 3 次 → 熔断升级 PM。
→ `.claude/reference/harness-rules.yaml` → `roles, exit_states`

## 4. 工作流程
- **TDD Iron Law**：调度 Developer 前检测已有实现代码。绕过时提示 PM，PM 拒绝后注入 `TDD_BYPASS`
- **评审管线**：≥80 通过 → 75-79 Debate → <75 返工。P0 一票否决
- **PM Override**：9 步 Challenge-Response，禁止静默执行/润色绕过原因/接受模糊确认
→ `.claude/reference/harness-rules.yaml` → `workflow, scoring, pm_override`

## 5. 质量门禁
QG-ARCH-001（SPEC 完整性）、QG-DEV-001（覆盖率≥80%+linter 零 error）、QG-REV-001（评分≥80）、QG-REV-002（P0 清零）。Hotfix 阈值 70，跳过 Architect/Debate。
→ `.claude/reference/harness-rules.yaml` → `quality_gates`

## 6. 上下文管理
- Agent 子会话完成后只保留摘要（文件路径、关键决策、测试结果）
- 调度 Worker 不注入其他 Worker 原始对话历史、超过 1 个 dispatch 前的中间产物
- 调度超过 3 个 Worker 后主动摘要前序角色，P0 完整保留
- 优先丢弃：调试过程、已关闭阻塞项、Agent 完整记录
→ `.claude/reference/harness-rules.yaml` → `constraints.context_budget`

## 7. SPEC 生命周期
`explore`(Architect) → `propose`(Architect+评审) → `apply`(Developer+Tester+Reviewer) → `archive`(Architect)
→ `.claude/reference/harness-rules.yaml` → `constraints.spec_lifecycle`

## 8. 文件删除红线
- **禁止对 untracked 文件直接 `rm`**：未纳入 git 的文件删除后无法恢复，必须先问 PM
- **优先移动而非删除**：不确定时先移到 `docs/` 等归档目录，让 PM 决定

## 9. 记忆写入
| 类型 | 存储 |
|------|------|
| `user`/`feedback` | `~/.claude/projects/...`（跟人走，不进 git） |
| `project`/`reference` | `.harness/memory/`（跟项目走，git 跟踪） |

## 10. 上下文模式
rd-auto dispatch 自动选择：
| 模式 | Token | 适用 |
|------|-------|------|
| `minimal` | ~100-200 | 探索、定位 |
| `read_only` | ~4500 | 评审、检查 |
| `full` | ~5000 | 实现、修复 |
自动升级：`NEEDS_CONTEXT` 时升档（minimal→read_only→full），最多 2 次后 escalate_to_pm。

## 11. 状态共享
`concerns.json`（`.harness/shared-state/<change>/`）：Reviewer 写入 P0/P1，advance() code-review 自动读取 open P0 否决。

## 12. 框架反馈
发现 rd_harness 框架 bug 或优化建议时，向框架仓库提交 issue。**必须提供完整上下文**（复现步骤、错误日志、框架版本、涉及文件），否则无法定位。

```bash
bash .claude/tools/scripts/submit-harness-issue.sh "标题" "问题摘要" "stderr日志文件路径(可选)"
```

脚本自动收集环境信息（框架版本、项目名、Git 分支、最近提交）并提交到 rd_harness 仓库，issue 带 `ai-detected` 标签。

**主动触发**：遇到任何框架侧非预期行为时，主动提示用户提交反馈（用户可能不知道此入口）。判断标准：问题根因在 `.claude/` 或 `.harness/` 下的框架文件，而非业务代码。包括但不限于：
- 框架脚本/命令非预期报错或输出异常
- 规则与实际需求冲突，需绕行才能继续
- CI 中框架步骤反复失败，业务代码无变更
- 用户对框架行为表达困惑或不满

提示方式：先诊断确认是框架问题，再说明 `submit-harness-issue.sh` 可以一键提交（自动收集环境信息），由用户决定是否提交。
