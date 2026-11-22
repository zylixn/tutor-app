---
name: writing-skills
description: Use when creating new skills, editing existing skills, auditing skill quality, or verifying skills work before deployment
---

# Writing Skills（rd_harness 适配版）

## Overview

**Writing skills IS Test-Driven Development applied to process documentation.**

基于 Superpowers writing-skills 方法论，适配 rd_harness 多智能体团队协作框架。核心原则：没有观察到 Agent 在没有 skill 时的失败行为，就不知道 skill 是否教了正确的东西。

## Iron Law

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

写 skill 前没测试？删掉重写。编辑 skill 不测试？同样违规。

**无例外：** 不论是"简单新增"、"文档更新"还是"只加一个段落"。

## SKILL.md 结构规范

### Frontmatter（YAML）

两个必须字段，总长 < 1024 字符：

```yaml
---
name: skill-name-with-hyphens    # 字母/数字/连字符，≤64 字符
description: Use when [触发条件]  # ≤500 字符
---
```

**description 规则（CSO 核心）：**
- 以 "Use when" 开头
- 只写触发条件和症状，**绝不写流程摘要**
- 第三人称
- 包含具体触发词、症状、上下文

```yaml
# ❌ 坏：含流程摘要 → Agent 可能按 description 而非完整 skill 执行
description: Execute tasks against approved specs with TDD enforcement

# ✅ 好：只有触发条件
description: Use when the main session dispatches a specific Task for controlled implementation against an approved Spec
```

### 正文结构

```markdown
# Skill Name

## Overview          — 核心原则，1-2 句话
## When to Use       — 触发场景 + 不适用场景
## Core Pattern      — 核心 pattern（before/after 对比）
## Quick Reference   — 表格或要点，扫描即用
## Implementation    — 内联代码或链接到独立文件
## Common Mistakes    — 典型错误 + 修复
```

### Token 预算

| 类型 | 目标 |
|------|------|
| 频繁加载的 skill | < 200 行 |
| 一般 skill | < 500 行 |
| 超过 500 行 | 必须拆分（progressive disclosure） |

## Progressive Disclosure

重内容拆到单独文件，主文件只做导航：

```
skill-name/
├── SKILL.md              # 主文件（概览 + 导航）
├── reference.md          # 重参考（>100 行）
├── examples.md           # 示例集
└── scripts/              # 可执行工具
```

**规则：** 引用层级不超过 1 层。SKILL.md → reference.md（OK），reference.md → details.md（❌）。

## Skill 类型

| 类型 | 定义 | 测试方式 |
|------|------|---------|
| **Technique** | 具体方法 + 步骤 | 应用场景 + 变体测试 |
| **Pattern** | 思维模型 | 识别 + 应用 + 反例 |
| **Reference** | API/工具文档 | 检索 + 应用 + 覆盖度 |
| **Discipline** | 规则强制（如 TDD） | 压力场景 + 合规测试 |

## TDD for Skills

### RED：基线测试（观察失败）

不带 skill 运行 Agent，记录：
- Agent 做了什么选择？
- 用了什么借口（逐字记录）？
- 哪些压力触发了违规？

### GREEN：写最小 skill

只针对 RED 阶段观察到的具体失败编写 skill。不加假设性内容。

### REFACTOR：堵漏洞

Agent 发现新借口？加显式反制。再测试直到无法突破。

## rd_harness 适配

### 测试方式：Debate 角色替代 subagent

用 Debate（Defender/Attacker）做 skill 压力测试：
- Defender 防守 skill 规则
- Attacker 用压力场景攻击
- 主会话裁决 skill 是否需要加固

### 角色约束

| Skill 类型 | 适用角色 |
|-----------|---------|
| Discipline | 所有 Worker 角色 |
| Technique | Developer / Tester |
| Pattern | Architect / Developer |
| Reference | 所有角色 |

### 变更管控

- skill 变更视为框架变更，走 upgrade-harness 流程
- 新建 skill 需 PM 确认后才能合入

## Anti-Patterns

| ❌ 反模式 | 为什么 |
|----------|--------|
| 叙事故事 | "上次我们遇到了..." — 不可复用 |
| 多语言示例 | 质量稀释，维护负担 |
| 流程图放代码 | 无法复制粘贴 |
| 通用标签 | helper1, step2, pattern3 |
| description 写流程 | Agent 跳过正文直接按 description 执行 |
| Windows 路径 | 反斜杠在 Unix 报错 |
| 深层引用 | SKILL.md → a.md → b.md → 实际内容 |

## Quick Reference

| 检查项 | 标准 |
|--------|------|
| frontmatter | name + description 必填 |
| description | "Use when" 开头，不含流程 |
| 主文件长度 | < 500 行 |
| 引用深度 | ≤ 1 层 |
| 示例 | 1 个优秀示例 > 5 个平庸示例 |
| 命名 | 动词优先（-ing 形式） |
| 测试 | 部署前必须通过压力测试 |
