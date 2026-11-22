# 日报仓库建仓规范

> 对接日报技能所需的仓库目录结构和配置要求。满足本规范的任意 GitLab 仓库均可作为日报技能的数据后端。

## 1. 仓库要求

- GitLab 仓库（社区版/企业版均可）
- 开启 Repository API 访问（GitLab 默认开启）
- 日报技能通过 Personal Access Token 操作，需 `api` + `read_repository` + `write_repository` 权限

## 2. 目录结构

```
<仓库根>/
├── config/
│   └── team.json              # 人员映射（必须）
└── reports/
    └── {YYYY}/                # 年份目录，如 2026
        ├── {MM}/              # 月份目录，如 05
        │   └── {DD}/          # 日期目录，如 26
        │       ├── {git_username}.md       # 日报 Markdown（人读）
        │       └── json/
        │           └── {git_username}.json  # 日报 JSON（机器读）
        └── {KANBAN_DIR}/        # 看板目录（默认 knowledge，可配置）
            ├── {prefix}_kanban_{name}.md    # 看板 Markdown
            └── json/
                └── {prefix}_kanban_{name}.json
```

### 路径说明

| 路径 | 说明 | 格式 |
|------|------|------|
| `config/team.json` | 人员映射配置 | JSON 数组 |
| `reports/{YYYY}/{MM}/{DD}/{git_username}.md` | 单日个人日报 | Markdown |
| `reports/{YYYY}/{MM}/{DD}/json/{git_username}.json` | 单日个人日报结构化数据 | JSON |
| `reports/{YYYY}/{KANBAN_DIR}/{kanban_filename}` | 年度看板文件 | Markdown 表格 |
| `reports/{YYYY}/{KANBAN_DIR}/json/{kanban_filename}` | 看板结构化数据 | JSON |

> `git_username` = `git config user.name` 的值，与 `team.json` 中 `git_username` 对应。

## 3. config/team.json

**必须**在仓库根目录提供，运行时由技能动态拉取，不硬编码。

```json
{
  "version": 2,
  "updated": "2026-06-03",
  "members": [
    {
      "git_username": "zhangsan",
      "group": "驾驭工程组"
    },
    {
      "git_username": "lisi",
      "group": "数据组"
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `version` | 是 | 配置文件版本号（整数），结构变更时递增 |
| `updated` | 是 | 最后更新日期（YYYY-MM-DD） |
| `members` | 是 | 人员数组 |
| `members[].git_username` | 是 | Git 用户名，与 commit author 一致，同时用于看板 Owner 列匹配 |
| `members[].group` | 是 | 所属组织/团队 |

### Owner 匹配规则

看板表格 Owner 列支持多人分隔：`zhangsan+lisi`、`zhangsan, lisi`、`zhangsan/lisi`、`zhangsan lisi`。分隔符 `+` `,` `/` 空格。逐段 trim 后与 `team.json` 中 `git_username` 字段精确匹配。

## 4. 看板文件格式

看板文件名为 `{prefix}_kanban_{name}.md`，字母序最新的为当前版本。如 `530_kanban_v2.1.md`。

必须包含 Markdown 表格，表头至少含以下列：

| # | 任务 | Owner | Deadline | 状态 | 紧急度 | 备注 |
|---|------|-------|----------|------|--------|------|

- **Owner** 列：git_username，多人用 `+` 连接
- **状态** 列：`✅` 已完成、`🔵` 进行中、`🟡` 有风险、`🔴` 阻塞、`⬜` 未开始
- **紧急度** 列：`P0` / `P1` / `P2`
- **Deadline** 列：`M/D` 格式，如 `5/15`

文件末尾包含更新标识行：

```markdown
*最后更新：2026-05-26 by zhangsan（D-07 ✅ D-08 🔵）*
```

## 5. 日报文件格式

日报由技能脚本确定性渲染生成，人不应手动编辑 `.md` 文件（内容由 JSON 重新渲染即可恢复）。JSON 文件为结构化真相源。

### JSON 结构

```json
{
  "date": "2026-05-26",
  "git_username": "zhangsan",
  "repo": "rd_harness",
  "git": { "stats": {...}, "classification": {...}, "tags": {...}, "commits": [...] },
  "kanban": { "source_file": "...", "user": {...}, "tasks": [...], "stats": {...}, "deadline_calendar": {...} },
  "ai": { "tasks": [...], "summary": {...} }
}
```

## 6. 分支策略

默认分支名 `dev`，可通过 `.gitlab-config` 的 `DAILY_REPORT_BRANCH` 字段覆盖。所有读写操作针对该分支。

> 看板文件必须在远程仓库已存在（由人工创建）。日报文件由技能自动创建（首次 `create`，后续 `update`）。

## 7. 对接配置

在 `rd_harness` 的 `.gitlab-config` 中配置：

```
DAILY_REPORT_GITLAB_URL=http://192.168.5.160
DAILY_REPORT_PROJECT_ID=group%2Fdaily_report
DAILY_REPORT_BRANCH=dev
KANBAN_DIR=knowledge
```

- `PROJECT_ID` 为 URL 编码后的路径（`/` → `%2F`），如 `public_group/daily_report` → `public_group%2Fdaily_report`
- 配置缺失时技能会引导填写，不阻断
