# 自动意图路由

> 当 PM 输入开发类指令时，自动调用 `/rd-auto` 进行意图分析和角色派活，而不是手动实现。

## 触发规则

收到用户消息时，按以下规则判断是否自动路由到 `rd-auto`：

### 自动触发（调用 Skill(skill="rd-auto")）

用户消息**主要意图**是以下之一时：
- **功能开发**：实现/做/开发/新增/添加/功能 + 具体描述
- **Bug 修复**：修复/fix/解决 + 问题描述
- **热修复**：热修复/紧急/hotfix/线上问题
- **重构**：重构/优化结构/拆分/合并模块
- **补测试**：补测试/加测试/测试覆盖
- **配置变更**：改配置/环境变量/CI配置
- **写文档**：写文档/ADR/补充说明/更新设计文档
- **继续任务**：继续/接着/resume + 任务名

### 不触发（正常对话）

- 简单提问（"XX 是什么"、"怎么用 YY"）
- 代码探索（"看下这个文件"、"搜索 XX"）
- Git 操作（拉取/推送/提交/分支）
- 项目管理（查看状态、看板、日报）
- 明确以 `/` 开头的其他 skill 命令
- 对话中的追问、澄清、确认

## 执行方式

触发后：
1. 先向用户确认意图解析结果（置信度 < 0.7 时）
2. 确认后调用 `Skill(skill="rd-auto")`，将用户原始输入作为参数传递
3. 后续按 rd-auto 的 pipeline 自动推进

## 优先级

如果用户同时指定了其他 `/` 命令（如 `/rd:explore`），优先执行用户明确指定的命令，不走自动路由。

## intent_category 与 flow-type 自动升级（bug_fix 必读）

`orchestrator init` 时若 `--intent-json` 含 `intent_category`，会**自动升级到 quick flow**（轻量 5 阶段，不经 propose/design-review，不强制 proposal/design/spec）：

- **触发条件**：`intent_category ∈ [bug_fix, quick_change, code_review, testing]` + `confidence ≥ 0.85` + `affected_files ≤ 3`
- **实现位置**：`cli-commands.js` auto-upgrade-to-quick（即便 `--flow-type development`，含合规 intent_category 也会自动升 quick）

**操作要点**：bug_fix / 根因明确的小修复，init 时务必在 `--intent-json` 传 `intent_category`，否则即便根因明确也会走 development 全套（产出冗余制品）：

```bash
node .claude/skills/rd-auto/scripts/orchestrator.mjs init <name> \
  --flow-type development \
  --intent-json '{"task_type":"...","intent_category":"bug_fix","confidence":0.9,"affected_files":["path"],"complexity_hint":"S"}' \
  --criteria "..."
```

> 实证：fix-push-cleanup-hook（30 行 hook 修复）因 init 未传 `intent_category` 走了 development 全套，产出 ~2400 行文档；若传 `bug_fix` 会自动升 quick。这是操作问题，非框架缺陷——无需新机制，传对字段即可。

