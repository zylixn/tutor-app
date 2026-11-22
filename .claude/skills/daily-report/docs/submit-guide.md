# 提交模式详解

## Step 5b. 看板更新提案

基于步骤 5 的日报内容和步骤 4 的看板数据，自动生成看板状态变更提案。

### 状态变更规则

| 日报中任务状态 | 看板目标状态 | 条件 |
|---------------|-------------|------|
| ✅ 已完成 | ✅ | 今日有对应 commit 且任务标记完成 |
| 🔵 进行中 | 🔵 | 任务当前为 ⬜，今日有相关 commit |
| 🟡 有风险 | 🟡 | 用户在确认时主动指定 |
| 不变 | 不变 | 今日无进展的任务不修改 |

### 备注更新规则

- 对状态变更的任务，在备注列追加今日进展摘要，最终格式：`{进展摘要}（{git_username} {M/D}）`
- `（{git_username} {M/D}）` 签名由 `kanban-update.js` 根据 `--updater`/`--date` 自动追加，调用方在 `notes_append` 里**只写进展摘要本身**，不要再带日期签名（脚本会智能去重，但仍以裸内容为准）
- 追加到已有备注末尾，用 `；` 分隔，不覆盖已有内容
- 备注追加内容不超过 80 字

### 看板文件修改方法

使用 `kanban-update.js` 脚本一次性完成所有更新，**绝不能遗漏汇总表**：

```bash
# 1. 将远程看板保存到临时文件
GITLAB_TOKEN=... curl ... > daily-report-tmp/kanban-original.md

# 2. 调用 kanban-update.js 应用变更（必须传 --updater-user）
node .claude/skills/daily-report/scripts/kanban-update.js \
  --kanban daily-report-tmp/kanban-original.md \
  --changes '[{"task_id":"H-07","status":"🔵","notes_append":"开始设计"}]' \
  --updater-user zhangsan \
  --date 2026-05-15 \
  --summary "H-07🔵 D-07🔵" \
  > daily-report-tmp/kanban-updated.md
```

> **`--updater-user` 必传**：脚本强制校验每个变更任务的 Owner 列是否包含此 git_username。不匹配则拒绝执行并报错退出。此参数防止误修改他人任务。（可选的 `--updater` 仅用于尾部标识展示，默认 `AI`，不做所有权校验。）

脚本自动完成以下更新（**全部联动，不可遗漏**）：

| 更新项 | 说明 |
|--------|------|
| 任务行状态 | 按任务编号精确匹配，替换状态列 emoji |
| 任务行备注 | 追加进展摘要 + 更新者 + 日期，不超过 80 字 |
| **总览表** | 重算每个 Sprint 的 ✅🔵🟡🔴⬜ 计数和完成率 |
| **按人员统计表** | 重算每个人的总数、完成数、完成率 |
| **按主链统计表** | 重算每个主链的总数、完成数、完成率 |
| **尾部标识** | `*最后更新：{日期} by AI（{变化的任务和状态}）*` |

> **安全约束**：脚本只修改指定变更列表中的任务行，不触碰其他行。汇总表基于全量任务计数重算，确保数据一致。

### 安全约束

- **所有权强制校验（代码级）**：`kanban-update.js` 执行前强制校验每个变更任务的 Owner 列是否包含 `--updater-user` 传入的 git_username。任何任务 Owner 不匹配则**拒绝全部变更**并报错退出，不会部分执行。此校验不可跳过。
- 只修改 Owner 列包含当前用户 git_username 的任务行，不触碰他人任务
- 只修改任务表格行（`| # | 任务 | Owner |` 格式），不动总览/统计/风险等非任务表格
- 如果今日无任何看板任务有进展 → 输出"今日看板无需更新"，跳过看板更新
- **禁止 `2>&1` 合并 stderr**：调用 `kanban-update.js`、`render-report.js` 等 stdout 重定向到文件的脚本时，**禁止**使用 `2>&1`、`> file 2>&1`、`>&2 2>&1` 等任何把 stderr 并入 stdout 的写法。脚本 schema/owner 校验失败时只往 stderr 写单行摘要 + 详细日志到 `kanban-update-error.log`，若合并到 stdout 会把错误信息写入目标 md/json 文件，造成数据污染（曾导致 `630_kanban-LOCKED.md` 被覆盖为 5 行错误信息，S0-01/02/11 等 ✅ 任务在 md 中"消失"）。stdin/stdout/stderr 三流必须独立，stderr 只在终端可见

### 变更后重渲染日报（方案 B 单一数据源）

`kanban-update.js` 是看板变更的唯一执行点。变更执行后，**用最新 JSON 重渲染日报**，让日报的规划对照分析和进行中任务表格反映最新状态：

```bash
node .claude/skills/daily-report/scripts/render-report.js \
  --git daily-report-tmp/git.json \
  --kanban daily-report-tmp/kanban-updated.json \
  --ai daily-report-tmp/ai.json \
  --user {git_username} \
  --output daily-report-tmp/{YYYY-MM-DD}-{git_username}.md \
  --json-output daily-report-tmp/{YYYY-MM-DD}-{git_username}.json
```

注意 `--kanban` 指向的是 `kanban-updated.json`（kanban-update.js 通过 `--json-output` 产出的最新 JSON 镜像，全量任务），而不是 Step 2 拉取的昨日状态 JSON。`--user` 让 render-report 自动按 Owner 过滤为个人视角。

> **不要用 `--kanban-changes`**：该参数在渲染时"模拟"应用变更，与 `kanban-update.js` 的真实写入是两套实现，容易漂移。该参数已标记 DEPRECATED，传入时会输出迁移警告。正确做法是上面两步：kanban-update.js 生成最新 JSON → render-report.js 消费该 JSON。

## Step 6. 输出确认

向用户展示两部分内容：

**第一部分 — 日报**：展示日报全文供确认。

**第二部分 — 看板更新提案**（如有变更）：

```markdown
## 📋 看板更新提案

以下任务状态将同步更新到看板（{看板文件名}）：

| 编号 | 任务 | 当前状态 | → 更新状态 | 备注变更 |
|------|------|---------|-----------|---------|
| S0-17 | 530 新增仓库创建... | 🔵 | ✅ | +v1.7.0 发布（zhangsan 5/7） |
```

用户可编辑提案内容（修改状态、删除行、新增变更项）。确认后进入步骤 7 一并提交。
无看板变更时仅展示日报，不展示看板提案。

## Step 7. 通过 GitLab API 提交到配置分支

用户确认后，通过 GitLab Commits API 直接提交，无需克隆仓库。

> 以下所有变量从项目根目录 `.gitlab-config` 读取，`${git_username}` 从 `git config user.name` 获取。

### Commit Message 格式（强制）

提交到 `daily_report` 仓库的 commit message **必须**遵循 AI Git 提交规范（`ai-git-commit-spec.md` v4.0），格式如下：

```
[<任务号>] <DEV/BUG/CM/TEST/DOCS/REFACTOR> <模块名称>[<操作者类型>]

<type>: <中文摘要>
- 变更点1
- 变更点2
```

**操作者类型判定**：
- `[AI-{git_username}.Developer]` — Claude Code 会话中产生的提交（人下指令，AI 执行）
- `[H-{git_username}]` — 人在终端手动提交，未使用 AI
- `[AI·Developer]` — Webhook 自动触发，无人在对话中下指令

**日报提交专用模板**（通过 Claude Code 技能提交 → AI 协作）：

```
[0000] DOCS 日报看板[AI-{git_username}.Developer]

docs: [AI-{git_username}.Developer] 提交 {YYYY-MM-DD} 日报{ + 看板更新}
- 日报: {状态变更摘要}
- 看板: {状态变更摘要}（有看板更新时）
```

**示例**：

```
[0000] DOCS 日报看板[AI-zhangsan.Developer]

docs: [AI-zhangsan.Developer] 提交 2026-05-13 日报 + 看板更新
- 日报: N-01✅ H-02✅ B-01🔵 B-02🔵 H-06🔵
- 看板: S1 ✅4→6 🔵3→4 ⬜48→45
```

**格式硬规则**（违反会导致服务端 hook 拒绝）：
1. 首行四字段：`[任务号] DEV/BUG/CM/TEST/DOCS/REFACTOR 模块[操作者类型]`
2. 首行与 body 之间**必须空一行**
3. body 首行**必须**以 `type:` 开头（日报用 `docs:`）
4. 总长度 < 500 字符

> **注意**：`daily_report` 仓库部署了 GitLab 服务端 pre-receive hook，会校验 commit message 格式。不符合格式会导致提交被拒绝（`Prevented by server hooks`）。

### 提交策略

根据是否有看板更新，选择不同的提交策略。每次提交同时包含 MD（人读）和 JSON（机器读）文件。

**文件路径规则**：

> 看板路径中的 `KANBAN_DIR` 必须从 `.gitlab-config` 读取，不同项目可能不同（如 `knowledge`、`knownlage`），不能硬编码。

| 类型 | 路径 |
|------|------|
| 日报 MD | `reports/{YYYY}/{MM}/{DD}/{git_username}.md` |
| 日报 JSON | `reports/{YYYY}/{MM}/{DD}/json/{git_username}.json` |
| 看板 MD | `reports/{YYYY}/{KANBAN_DIR}/{kanban_filename}` |
| 看板 JSON | `reports/{YYYY}/{KANBAN_DIR}/json/{kanban_filename%.md}.json` |

**硬约束（违反会导致数据丢失）**：

1. **JSON 内容必须从 render-report.js 生成的文件读取**，通过 `submit-report.js` 脚本原样提交 `daily-report-tmp/{YYYY-MM-DD}-{git_username}.json`。**严禁**自行编写、摘要、精简 JSON 字段（如只保留 `author/role/summary`）。违反此规则会丢失 git 分类、kanban 等完整数据。
2. 必须使用 `submit-report.js` 脚本提交，该脚本内部处理 URL 编码、文件读取和 API body 构建。**不要**手动拼接 curl 命令传递文件内容。

> **反面案例**：AI Agent 曾自行构建 `{"date":"","author":"","role":"","commits":3,"summary":"..."}` 提交，导致仓库中 JSON 丢失 git stats、classification、kanban 等全部结构化数据。

**无看板更新时**：仅提交日报（MD + JSON）

> **变量读取方式**：通过 `config.js print` 一次性加载配置（自动适配 active profile）。禁止 `source .gitlab-config`，散点 `grep` 已废弃。

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)" && \
node .claude/skills/daily-report/scripts/submit-report.js \
  --gitlab-url "${DAILY_REPORT_GITLAB_URL}" \
  --project-id "${DAILY_REPORT_PROJECT_ID}" \
  --branch "${DAILY_REPORT_BRANCH}" \
  --token "${GITLAB_TOKEN}" \
  --commit-message "[0000] DOCS 日报看板[AI-${git_username}.Developer]

docs: [AI-${git_username}.Developer] 提交 ${YYYY}-${MM}-${DD} 日报
- 日报: {摘要}" \
  --md-file "daily-report-tmp/${YYYY}-${MM}-${DD}-${git_username}.md" \
  --json-file "daily-report-tmp/${YYYY}-${MM}-${DD}-${git_username}.json" \
  --remote-md-path "reports/${YYYY}/${MM}/${DD}/${git_username}.md" \
  --remote-json-path "reports/${YYYY}/${MM}/${DD}/json/${git_username}.json"
```

**有看板更新时**：日报 + 看板在同一 commit 中原子提交

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)" && \
node .claude/skills/daily-report/scripts/submit-report.js \
  --gitlab-url "${DAILY_REPORT_GITLAB_URL}" \
  --project-id "${DAILY_REPORT_PROJECT_ID}" \
  --branch "${DAILY_REPORT_BRANCH}" \
  --token "${GITLAB_TOKEN}" \
  --commit-message "[0000] DOCS 日报看板[AI-${git_username}.Developer]

docs: [AI-${git_username}.Developer] 提交 ${YYYY}-${MM}-${DD} 日报 + 看板更新
- 日报: {摘要}
- 看板: {摘要}" \
  --md-file "daily-report-tmp/${YYYY}-${MM}-${DD}-${git_username}.md" \
  --json-file "daily-report-tmp/${YYYY}-${MM}-${DD}-${git_username}.json" \
  --remote-md-path "reports/${YYYY}/${MM}/${DD}/${git_username}.md" \
  --remote-json-path "reports/${YYYY}/${MM}/${DD}/json/${git_username}.json" \
  --kanban-md-file "daily-report-tmp/kanban-updated.md" \
  --kanban-json-file "daily-report-tmp/kanban-updated.json" \
  --remote-kanban-md-path "reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/${kanban_filename}" \
  --remote-kanban-json-path "reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/json/${kanban_filename%.md}.json"
```

- 脚本自动检测远程文件是否存在，首次 `create`，同天重提交 `update`
- 看板 MD/JSON 会由 `submit-report.js` 自动检测远程文件是否存在，存在用 `update`，不存在用 `create`
- 脚本返回 0 表示成功（HTTP 201），非零退出码表示失败（输出错误详情）
- 失败时检查 stderr 输出（如 `Prevented by server hooks` 则检查 commit message 格式）

## Step 8. 不自动清理临时文件

临时文件保留在 `daily-report-tmp/`，由用户自行决定是否清理。
