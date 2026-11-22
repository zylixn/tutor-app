# Daily Report Skill · 内部分层地图

> 本 README 是 **目录导航**，不是执行手册。执行步骤见 `SKILL.md`，规则细节见 `docs/`。
> 维持单一 skill 的核心理由：日报提交（Step 4）与看板更新是**原子联动**，拆分会打断主链。

## 1. 六种模式 → 职责分层

| 模式 | 触发词 | 职责域 | 必读文档 |
|------|--------|--------|---------|
| 提交模式 | 填写/提交日报 | 日报 | `submit-guide.md` |
| 查询模式 | 查询/查看日报 | 日报 | — |
| 看板模式 | 看板/团队看板/我的看板 | 看板（只读展示） | `kanban-guide.md` |
| 看板更新模式 | 更新看板/标记完成/推进任务 | 看板（写入，update） | `kanban-format.md` |
| 看板初始化上传模式 | 初始化看板/上传初始看板/首次上传 | 看板（写入，create） | `kanban-format.md` + `kanban-template.md` |
| **Profile 管理** | **切换 profile/用 X 仓库/新建 profile** | **配置（多仓库/分支切换）** | SKILL.md §0a |

> **进入 skill 必做**：主会话必须主动展示「当前 Profile + 可用 Profile + 切换方式」，让用户知道这个能力存在。详见 SKILL.md §0a「Profile 引导」。

## 2. 目录结构

```
daily-report/
├── SKILL.md              # 入口：模式判断 + 执行步骤（4 模式共用）
├── README.md             # 本文件：分层导航
├── docs/                 # 规则与指南
│   ├── prerequisites.md  # 日报：前置配置（Token、团队映射）
│   ├── submit-guide.md   # 日报：提交流程 + commit message 规范
│   ├── reference.md      # 日报：模板与标签对照表
│   ├── repo-spec.md      # 共用：仓库结构规范
│   ├── kanban-guide.md   # 看板：查询展示规则（团队/个人）
│   ├── kanban-format.md  # 看板：源文件格式强约束（违反即 P0）
│   └── kanban-template.md# 看板：通用看板模板骨架
├── scripts/              # 确定性脚本（LLM 不参与内容组装）
│   ├── collect-git.js    # 日报：采集 git 提交
│   ├── collect-ai.js     # 日报：采集 AI 员工效能
│   ├── collect-kanban.js # 看板：拉取个人看板 JSON
│   ├── kanban-update.js  # 看板：更新任务状态 + 重算总览
│   ├── render-report.js  # 日报：渲染 9 章节 MD + JSON
│   └── submit-report.js  # 共用：GitLab API 提交（create/update）
└── schemas/
    └── daily-report.schema.json  # 日报 JSON Schema
```

## 3. 按职责域索引（核心分层视图）

### 📝 日报专属（提交 + 查询）

| 资源 | 用途 |
|------|------|
| `docs/prerequisites.md` | Token 检测、`.gitlab-config` 配置、team.json 映射 |
| `docs/submit-guide.md` | Commit message 格式（hook 强校验）、看板更新提案规则 |
| `docs/reference.md` | 日报 MD 模板 9 章节、标签对照表 |
| `scripts/collect-git.js` | 采集当日 git 提交（排除 `.claude/` `.harness/`） |
| `scripts/collect-ai.js` | 采集 `.harness/tasks/` 下的 AI dispatch 效能 |
| `scripts/render-report.js` | 确定性渲染日报 MD + JSON（9 章节） |
| `schemas/daily-report.schema.json` | 日报 JSON 校验 |

### 📋 看板专属（查看 + 更新 + 新建）

| 资源 | 用途 |
|------|------|
| `docs/kanban-guide.md` | **查询展示**规则（团队/个人看板渲染） |
| `docs/kanban-format.md` | **源文件强约束**（8 结构块 / 7 列 / 5 状态 / 编号前缀 / 统计自洽） |
| `docs/kanban-template.md` | 通用看板骨架（新建时复制，含「迭代开发版本号」「对应研发系统需求号」） |
| `scripts/collect-kanban.js` | 拉取远程看板，输出个人看板 JSON（供 render-report.js 消费） |
| `scripts/kanban-update.js` | 更新任务状态 + 自动重算 4 张统计表 + 同步 JSON |

### 🔗 共用资源

| 资源 | 用途 |
|------|------|
| `.gitlab-config` | **default profile**：GitLab URL / Project ID / Branch / Token / KANBAN_DIR / `active_profile` 指针。所有 profile 共享此处的 token |
| `.gitlab-config.d/{name}.conf` | **其他 profile**：同 default 字段（不含 token / active_profile）。同一人可在多仓库/分支切换提交 |
| `config/team.json` | 团队成员映射（git_username ↔ 姓名 ↔ 团队） |
| `scripts/lib/config.js` | 配置读取统一入口。`loadConfig()` 按 `active_profile` 解析；CLI 子命令 `print` / `profiles` / `active` 供 shell 调用 |
| `scripts/submit-report.js` | GitLab API 提交（create/update，日报组/看板组二选一） |
| `docs/repo-spec.md` | 仓库目录结构规范（`reports/{YYYY}/{MM}/{DD}/`） |

#### 多 Profile 切换

```bash
# 查看当前 profile
node .claude/skills/daily-report/scripts/lib/config.js active

# 列出所有 profile
node .claude/skills/daily-report/scripts/lib/config.js profiles

# 切换（修改 .gitlab-config 的 active_profile 字段）
sed -i 's/^active_profile=.*/active_profile=team-b/' .gitlab-config

# 一次性加载配置到 shell 变量（替代散点 grep）
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)"
```

#### 🚨 日报分支规范

- **白名单过滤**：拉取分支列表后只展示 `dev` 和 `report/*` 形式（如 `report/team-b`、`report/aios-630`），`main`/`feature-*`/`hotfix-*` 等一律过滤
- **命名约束**：`report/` 后缀不得用个人账号名（❌ `report/wangzk`），用团队/战役标识（✅ `report/team-b`）
- **默认选项**：`dev`
- **适用入口**：首次配置 Step 2、新建 Profile Step 2

## 4. 文档读取时机

| 场景 | 必读顺序 |
|------|---------|
| 首次配置 | `prerequisites.md` → `repo-spec.md` |
| 切换 Profile | SKILL.md §0a「切换 Profile」 |
| 提交日报 | `submit-guide.md` → `reference.md` |
| 查询日报 | 直接调 API（无需 Read 文档） |
| 查看看板（只读） | `kanban-guide.md` |
| 更新看板任务状态 | `kanban-format.md`（强约束，违反即 P0） |
| 初始化上传看板 | `kanban-template.md` → `kanban-format.md` |

## 5. 脚本调用关系

```
提交日报主链：
  collect-git.js ─┐
  collect-ai.js ──┼─→ render-report.js ─→ submit-report.js ─→ GitLab
  collect-kanban ─┘                                ↑
                                                   │
看板更新主链（独立）：                                │
  kanban-update.js ────────────────────────────────┘
```

- `render-report.js` 接收 3 个 JSON（git/ai/kanban）+ 可选的 `--kanban-changes`，输出日报 MD + JSON
- `kanban-update.js` 接收本地看板 MD + 变更列表，输出更新后的 MD + JSON，所有权强校验
- `submit-report.js` 统一处理 GitLab API 的 create/update，识别远程文件是否存在自动切换

## 6. 边界与不变量

| 边界 | 规则 |
|------|------|
| 日报 ↔ 看板 | 通过 `--kanban-changes` 在提交日报时**原子联动**看板更新 |
| 看板源文件 ↔ 展示视图 | 源文件强约束（kanban-format.md），展示视图灵活（kanban-guide.md） |
| LLM ↔ 脚本 | 脚本确定性渲染，LLM 不参与内容组装（仅采集 + 展示确认） |
| 共用配置 | 通过 CLI 参数传入脚本，**禁止** `source .gitlab-config` |
| 看板格式变更 | `kanban-format.md` 是 SSOT，模板与脚本必须同步对齐 |
