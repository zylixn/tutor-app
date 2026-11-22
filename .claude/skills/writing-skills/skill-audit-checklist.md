# Skill 合规审计检查清单

用于审查现有 SKILL.md 是否符合 writing-skills 方法论。

## 必须项（不通过 = 不合规）

| # | 检查项 | 标准 | 检查方法 |
|---|--------|------|---------|
| M1 | frontmatter 有 name | 非空，字母/数字/连字符，≤64 字符 | 读 YAML |
| M2 | frontmatter 有 description | 非空，≤500 字符 | 读 YAML |
| M3 | description 以 "Use when" 开头 | 严格匹配前缀 | `head -c 8` |
| M4 | description 不含流程摘要 | 只写触发条件和症状，不写怎么做 | 人工判断 |
| M5 | name 与目录名一致 | 避免发现混淆 | 对比 |

## 建议项（不通过 = 可改进）

| # | 检查项 | 标准 | 建议阈值 |
|---|--------|------|---------|
| R1 | 主文件 < 500 行 | 超过须拆分 | 500 行 |
| R2 | 有 Overview 段落 | 核心原则 1-2 句 | — |
| R3 | 有 When to Use / When NOT to Use | 明确适用边界 | — |
| R4 | 有 Common Mistakes | 典型错误 + 修复 | — |
| R5 | 引用层级 ≤ 1 层 | SKILL.md → ref.md（OK），ref.md → detail.md（❌） | — |
| R6 | Token 效率合理 | 无冗余叙事、无重复内容 | — |

## 审计记录模板

```markdown
## Skill: {name}

| 检查项 | 结果 | 备注 |
|--------|------|------|
| M1 name | ✅/❌ | |
| M2 description | ✅/❌ | |
| M3 "Use when" | ✅/❌ | |
| M4 无流程摘要 | ✅/❌ | |
| M5 name 一致 | ✅/❌ | |
| R1 行数 | ✅/❌ | {n} 行 |
| R2 Overview | ✅/❌ | |
| R3 When to Use | ✅/❌ | |
| R4 Common Mistakes | ✅/❌ | |
| R5 引用层级 | ✅/❌ | |
| R6 Token 效率 | ✅/❌ | |

**合规评级**: A（全通过）/ B（建议项有缺失）/ C（必须项有缺失）
```

## 评级定义

| 评级 | 含义 | 行动 |
|------|------|------|
| A | 全部必须项 + 大部分建议项通过 | 保持 |
| B | 全部必须项通过，建议项缺失较多 | 计划改进 |
| C | 必须项不通过 | 立即修复 |
