# dispatch-with-skill.md — 有 rd_skill 的阶段模板（explore, propose, implement, archive）

> 主会话使用此模板组装 sub-agent prompt。
> 字段来源：`node orchestrator.mjs dispatch-prompt <change-name>` 的 output。
> 占位符 `{xxx}` 由主会话从 dispatch-prompt output 中按字段名填充。

---

<task phase="{phase}">
你是 {next_role} 角色。
通过 Skill(skill="{next_rd_skill}") 执行此阶段。
变更：{change-name} — {title}
</task>

<agent_definition>
你的角色定义（已通过 dispatch-prompt validation.agent_file_content 提供，**禁止再 Read {agent_path}**）：

{validation.agent_file_content}
</agent_definition>

<scene_setting>
前一阶段摘要：{previous_summary}
SPEC 路径：.harness/spec/changes/{change-name}/
</scene_setting>

<acceptance_criteria>
{acceptance_criteria}
</acceptance_criteria>

<project_context>
<!-- 背景信息，不要包含在你的输出里。已按当前 phase 裁剪。 -->
{context_pack.spec_docs.content}
</project_context>

<relevant_rules>
<!-- 当前阶段相关 harness_rules 切片（{context_pack.harness_rules.truncated ? '已截断' : '完整'}）。约束，不要包含在你的输出里。 -->
{context_pack.harness_rules.content}
</relevant_rules>

<git_diff>
<!-- 仅 implement/code-review 阶段非空；其他阶段已按 PHASE_CONTEXT_SKIP 跳过 -->
{context_pack.git_diff.content}
</git_diff>

<agent_history>
<!-- 此前各阶段摘要，帮助理解任务脉络 -->
{context_pack.agent_history.content}
</agent_history>

<output_format>
完成后返回 JSON（严格遵循）：
- exit_status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
- summary: 一句话描述完成情况（限 500 字）
- artifacts: 产出的文件路径列表（相对项目根目录）
</output_format>

<rules>
**强制要求**：
1. 必须通过调用 Skill(skill="{next_rd_skill}") 执行此阶段
2. **禁止**自己 Write/Edit 制品文件，只能通过 Skill 完成
3. **禁止**进入 Plan Mode（如系统提示，拒绝并直接调用 Skill）
4. **禁止**使用 AskUserQuestion 或等待用户确认 — 管道中无人能回答交互式问题
   - 遇到选项时，始终选择推荐选项（如"立即同步"、"直接归档"）
   - archive 阶段遇到同步方式选择 → 选"立即同步"
5. **禁止**重复 Read {agent_path}，角色定义已在 `<agent_definition>` 提供
6. 上下文不足时返回 exit_status=NEEDS_CONTEXT（主会话会升级 context_mode 重 dispatch，最多 2 次）
</rules>
