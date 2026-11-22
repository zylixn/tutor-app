# AI Git 提交规范

## 格式

```
[<任务号>] <阶段标识> <模块>[<操作者>]

<type>: <中文摘要>
- 变更点
```

## 阶段标识 → Body type

| 阶段标识 | 含义 | 对应 body type |
|----------|------|---------------|
| `DEV` | 功能开发 | `feat` |
| `BUG` | Bug 修复 | `fix` |
| `CM` | 配置管理（CI/CD、hooks、构建、依赖） | `chore` |
| `TEST` | 测试 | `test` |
| `DOCS` | 文档 | `docs` |
| `REFACTOR` | 重构 | `refactor` |
| `PERF` | 性能优化 | `perf` |
| `SEC` | 安全修复 | `fix` |
| `CI` | CI 专有变更 | `ci`（禁止 AI 独立提交） |
| `REL` | 发布/版本 | `chore` |
| `HOTFIX` | 生产 P0 紧急修复 | `fix` |
| `MIGRATE` | 数据/Schema 迁移 | `chore` |
| `WIP` | 进行中暂存（跨 Session） | `chore` |

跨多个标识时，选最能说明**本次提交意图**的标识。

## 操作者

| 格式 | 场景 |
|------|------|
| `[AI-{git用户}.{角色}]` | Claude Code 会话提交（默认） |
| `[H-{git用户}]` | 人在终端手动提交 |

角色：`Developer` / `Architect` / `Tester` / `Reviewer` / `Debate`

## 模块名规则

**模块名必须反映本次提交实际变更的模块/功能域**，禁止用 change 名/任务名无脑复用。同一 change 下不同模块的提交，模块名应有区分。

| 变更涉及 | 模块名示例 | 禁止 |
|----------|-----------|------|
| hook 脚本 | `git-guard` / `pre-commit` / `session-start` | `日报看板`（如果不涉及日报） |
| 版本号 | `harness-version` | `日报看板` |
| 框架安全 | `框架安全` / `bypass 治理` | `日报看板` |
| settings.json | `框架配置` | `日报看板` |
| 测试文件 | `kanban 测试` / `commit 测试` | `日报看板` |

**判定标准**：看 `git diff --name-only` 的变更路径，提取首个公共目录/文件名作为模块。如果 5 秒内区分不了两个提交的模块归属差异，就是模块名太泛。

## 摘要规则

≤ 72 字符，动宾结构（新增/修复/更新/重构/移除），中文，不以句号结尾。禁止模糊词（`修改`、`优化`、`update code`）。禁止用模块名代替 type。

## 示例

```
[12345] DEV 融合引擎[AI-<git用户>.Developer]

feat: 新增多源数据融合执行引擎
- 实现 FusionExecutor 核心逻辑
- 支持并行数据源路由与结果合并
```

## PR 规范

- **由 PM 指示创建**：PR 不自动创建，PM 说"提 PR"时才创建。
- **禁止复用已有 PR**：不得 update 已有 MR 的标题/描述来追加变更。每次按 PM 指示新建。
- **PR 标题**：`[任务号] 阶段标识 模块名`，与 commit 首行格式一致。
- **PR 描述**：简要列出 commits + 变更摘要。
- **关联 Issue 必写**：PR 解决的问题若涉及具体 GitLab Issue，必须在描述中以表格列出每个 Issue 编号、标题和修复内容。格式如下：

```markdown
### Issues 修复

| Issue | 标题 | 修复 |
|-------|------|------|
| !101 | 统一 YAML 解析：消除正则解析 | phase_skill_map 改为标准 YAML，transitions.js 改用 yaml-parser.js |
| !102 | 减少静默错误吞没 | 新增 debugLog()，26 处 catch {} 替换 |
```

- **已被覆盖的 Issue 也要列出**：如某 Issue 的问题被另一个修复覆盖解决，同样列出并注明"被 !xxx 修复覆盖"。
- **测试数据/无效 Issue 也要列出**：注明"确认为测试数据，关闭"。
