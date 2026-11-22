---
name: daily-report
description: Use when needing to submit a daily report, query past reports, or view personal kanban for daily reporting. Triggers: 填写日报, 查询日报, 个人看板, submit report, /daily-report
---

# Daily Report 日报技能

## Overview
三种模式：提交、查询、看板，外加独立看板更新。

1. **提交模式**：确定性脚本采集数据 + 模板渲染生成日报，LLM 仅负责展示确认和 GitLab API 提交。
2. **查询模式**：通过 GitLab API 读取远程日报展示。
3. **看板模式**：拉取当月看板，展示团队整体或个人看板。
4. **看板更新模式**：不提交日报，仅更新看板任务状态，自动同步 .md 和 .json，自动重算总览章节。

## 数据流原则（看板单一数据源）

看板数据有且只有一个变更执行点：**`kanban-update.js`**。`render-report.js` 是只读消费者，**不再模拟看板变更**。

- 旧做法（已废弃）：用 `render-report.js --kanban-changes '[...]'` 在渲染时"叠加"变更。该参数仍可工作但会输出 DEPRECATED 警告，后续版本会移除。
- 新做法：需要反映看板变更时，先用 `kanban-update.js --json-output` 生成最新 JSON 镜像，再用 `render-report.js --kanban <最新JSON>` 重渲染。这样日报和看板文件消费的是同一份 JSON，不存在两套实现漂移。

`collect-kanban.js` 默认 **JSON 优先**：先尝试拉远程看板 JSON 镜像（由 `kanban-update.js` 生成，通过 `kanban-source.schema.json` 校验），命中则直接用作数据源；未命中或校验失败则回退到 Markdown 解析。输出 JSON 中的 `data_source` 字段（`'json'` 或 `'markdown'`）标记实际数据来源，可用 `--source json|md|auto` 强制指定。

## When to Use / Not to Use

- **Use**：填写/查询日报、查看个人/团队看板。触发词：填写日报, 查询日报, 个人看板, 团队看板, /daily-report
- **Not Use**：CI 问题看板 → `issue-board`；任务管理 → GitLab Issue；记忆管理 → `memory-cli`

## Common Mistakes

| 错误 | 正确做法 |
|------|---------|
| 未配置 Token 就触发 | 先完成令牌检测（详见 [prerequisites.md](docs/prerequisites.md)），无 Token 立即停止 |
| 文件路径不规范 | `reports/{YYYY}/{MM}/{DD}/{git_username}.md` |
| 同天重提交用 create | 文件已存在时用 `action: update` |
| commit message 自由格式 | 必须用 `[0000] DOCS 日报看板[AI-{user}.Developer]`（详见 [submit-guide.md](docs/submit-guide.md)） |
| **自行编写 JSON 内容提交** | **必须**通过 `submit-report.js` 脚本提交 render-report.js 生成的 JSON 文件，**禁止**手动构建或自行编写 JSON 字段 |
| **修改非本人的看板任务** | `kanban-update.js` 强制校验 `--updater-user` 与任务 Owner 列匹配，不匹配则拒绝执行。**禁止**将非自己的任务加入个人看板 |
| **`2>&1` 合并 stderr 到 stdout 重定向** | 调用 `kanban-update.js` / `render-report.js` 时**禁止**使用 `2>&1`、`>&2 2>&1`、`> /dev/null 2>&1` 等任何把 stderr 并入 stdout 的写法。schema/owner 校验失败时脚本只往 stderr 写单行摘要 + 日志文件，若合并到 stdout 会污染目标 md/json 文件。stdin/stdout/stderr 三流必须独立 |

## 前置条件

令牌检测、技能配置、人员映射表详见 [docs/prerequisites.md](docs/prerequisites.md)。日报仓库建仓规范详见 [docs/repo-spec.md](docs/repo-spec.md)。

## 执行步骤

### 0a. 配置检查（支持多 Profile）

检查技能配置文件 `.gitlab-config` 是否存在且关键字段（`DAILY_REPORT_PROJECT_ID`）非空。

**GitLab 地址**：固定为 `http://192.168.5.160`，无需用户提供。配置文件中 `DAILY_REPORT_GITLAB_URL` 自动写入此值。

**多 Profile 机制**：同一人可在多个日报仓库/分支切换提交。
- `.gitlab-config`（default profile）：含全部默认字段 + `active_profile` 指针 + `gitlab_token`（所有 profile 共享此 token）
- `.gitlab-config.d/{name}.conf`：其他 profile 配置（**不含** `gitlab_token`、`active_profile`）
- 切换 profile = 改 `.gitlab-config` 的 `active_profile` 字段
- 配置读取统一通过 `node lib/config.js print` 输出 shell 变量，**禁止**散点 `grep`

**🚨 日报分支规范**：
- **白名单过滤**：拉取分支列表后，**只展示** 两类分支：
  1. `dev`
  2. `report/*` 形式（如 `report/team-b`、`report/aios-630`、`report/campaign-730`）

  其他形式（`main`/`master`/`feature-*`/`hotfix-*`/`release-*`/`test-*` 等）一律过滤掉
- **命名约束**：`report/` 后缀**不得使用个人账号名**（如 ❌ `report/wangzk`、`report/qinhy`）。使用团队/战役/场景标识（如 ✅ `report/team-b`、`report/aios-630`、`report/campaign-730`）
- **默认排序**：`dev` 排最前，`report/*` 按字母序。默认选项为 `dev`（如果存在）
- **适用范围**：首次配置 Step 2、新建 Profile Step 2，两个分支选择入口都走同一过滤逻辑

#### 状态判定

| 场景 | 处理 |
|------|------|
| 无 `.gitlab-config` 或缺 `DAILY_REPORT_PROJECT_ID` | 进入「首次配置」 |
| 用户说"切换到 X" / "用 X 仓库" | 进入「切换 Profile」 |
| 用户说"新建 profile X" / "添加 X 配置" | 进入「新建 Profile」 |
| 已有配置 + 正常触发 | **必须展示 Profile 引导（见下）**，再进入 0b |

#### Profile 引导（每次进入 skill 必做，不可省略）

**目的**：profile 切换是隐藏能力，用户不知道存在。必须主动暴露，否则用户需要切换时会懵逼。

**Step 1**：执行命令采集状态
```bash
node .claude/skills/daily-report/scripts/lib/config.js active
node .claude/skills/daily-report/scripts/lib/config.js profiles
node .claude/skills/daily-report/scripts/lib/config.js print
```

**Step 2**：**主会话必须作为文本直接输出**（不能只留在 Bash stdout）：

```
当前 Profile: {active}
对应仓库: {PROJECT_ID}  分支: {BRANCH}  看板目录: {KANBAN_DIR}
可用 Profile: {profiles 列表}

如需切换到其他仓库/分支，告诉我：
- "切换到 {profile 名}"（如已有）
- "新建 profile"（添加新的仓库/分支配置）
- 或直接说"用 DEP_005 仓库提交"
```

**Step 3**：在 0b 模式判断的 AskUserQuestion 中，**必须包含"切换 Profile"选项**（即使当前只有 default），让用户能从菜单点选触发。

> **禁止**：只输出"当前 Profile: default"就跳过。必须告知切换方式。

#### 首次配置

1. **选择团队** — 分两步通过 `AskUserQuestion` 引导（受工具 4 选项上限约束，不可一次列出全部团队）：

   **第一步：选择分组**

   | 分组 | 包含团队 |
   |------|---------|
   | 智慧运维 / 政企运营 / AI与数据集成 / 智慧控制 | DEP_001 ~ DEP_004 |
   | IP工作台 / 卫星互联网 / 全量感知 | DEP_005 ~ DEP_008 |
   | 网信安 / 集团CU / 区域CU | DEP_009 ~ DEP_012 |
   | 不确定 / 其他 | 默认兼容仓库或自定义 |

   **第二步：选择具体团队**（根据第一步分组展示 4 个选项）

   | 分组 | 选项 | PROJECT_ID |
   |------|------|-----------|
   | DEP_001~004 | 智慧运维 | `public_group%2Fdaily_report_group%2FDEP_001` |
   | | 政企运营 | `public_group%2Fdaily_report_group%2FDEP_002` |
   | | AI与数据集成 | `public_group%2Fdaily_report_group%2FDEP_003` |
   | | 智慧控制 | `public_group%2Fdaily_report_group%2FDEP_004` |
   | DEP_005~008 | IP工作台 | `public_group%2Fdaily_report_group%2FDEP_005` |
   | | 卫星互联网1 | `public_group%2Fdaily_report_group%2FDEP_006` |
   | | 卫星互联网2 | `public_group%2Fdaily_report_group%2FDEP_007` |
   | | 全量感知 | `public_group%2Fdaily_report_group%2FDEP_008` |
   | DEP_009~012 | 网信安 | `public_group%2Fdaily_report_group%2FDEP_009` |
   | | 集团CU | `public_group%2Fdaily_report_group%2FDEP_010` |
   | | 区域CU1 | `public_group%2Fdaily_report_group%2FDEP_011` |
   | | 区域CU2 | `public_group%2Fdaily_report_group%2FDEP_012` |
   | 其他 | AIOS攻坚 | 默认 `public_group%2Fdaily_report` |
   | | 自定义仓库 | 用户手动输入 PROJECT_ID |

   未选择团队时，默认使用AIOS日报仓库 `public_group%2Fdaily_report`。

2. **选择分支** — 通过 GitLab API 动态拉取所选团队的分支列表，**白名单过滤后**引导用户选择：

   **获取分支列表（仅保留 `dev` + `report/*`）**：
   ```bash
   eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)"
   # 上一步选定的 PROJECT_ID 作为变量传入
   BRANCHES=$(curl -s "${DAILY_REPORT_GITLAB_URL}/api/v4/projects/${USER_SELECTED_PROJECT_ID}/repository/branches" \
     -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
     | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).map(b=>b.name).filter(n=>n==='dev'||n.startsWith('report/')).sort().join('\n')")
   ```

   **🚨 白名单过滤规则**：分支列表**必须**只保留 `dev` 和 `report/*` 形式。`main`/`master`/`feature-*`/`hotfix-*`/`release-*` 等一律过滤掉，**不得**作为选项展示。`report/` 后缀不得使用个人账号名（不用 `report/wangzk`，用 `report/{团队/战役标识}`）。

   **分支选择规则**（基于过滤后的列表，受 AskUserQuestion 4 选项上限约束）：

   - **过滤后 0 个**：提示"该仓库暂无 `dev` 或 `report/*` 分支"，提供两个选项：
     - 「手动输入」分支名（推荐 `report/{团队/战役标识}` 形式）
     - 「取消，先去 GitLab 创建 `report/*` 分支」
   - **过滤后 1-3 个**：直接展示全部 + "手动输入"
   - **过滤后 4-8 个**：按规则排序后分两批，每批 ≤ 3 个 + "手动输入"
   - **过滤后 > 8 个**：展示排序前 3 个 + "查看更多" + "手动输入"

   **排序与默认**：`dev` 排最前，其余 `report/*` 按字母序。默认选项为 `dev`（如果存在）。

   **始终包含**：每个选项页都必须有"手动输入"选项，供用户直接输入分支名（如新建 `report/xxx`）。

3. **写入配置** — 生成 `.gitlab-config` 文件，包含 `DAILY_REPORT_GITLAB_URL`、`DAILY_REPORT_PROJECT_ID`、`DAILY_REPORT_BRANCH`、`KANBAN_DIR`（默认 `knowledge`）、`active_profile=default` 五个字段。

#### 切换 Profile

用户说"切换到 X"（如"切换到 team-b"、"用 team-b 仓库提交"）时：

1. 列出已有 profile：`node .claude/skills/daily-report/scripts/lib/config.js profiles`
2. **X 已存在**：执行切换
   ```bash
   if grep -q '^active_profile=' .gitlab-config; then
     sed -i 's/^active_profile=.*/active_profile=X/' .gitlab-config
   else
     echo 'active_profile=X' >> .gitlab-config
   fi
   ```
3. **X 不存在**：询问用户是否新建 → 走「新建 Profile」流程
4. 切换后验证：`node .claude/skills/daily-report/scripts/lib/config.js active` 应输出 X

#### 新建 Profile

1. 通过 `AskUserQuestion` 询问：
   - **profile 名**：用于标识（如 `team-b`、`aios-630`），成为 `.gitlab-config.d/{name}.conf` 的文件名
   - **团队**：DEP_xxx 或自定义 PROJECT_ID（走「首次配置」Step 1 的团队选择流程）
2. **选择分支**：走「首次配置」Step 2 的分支选择流程（**同样强制白名单过滤 `dev` + `report/*`**）
3. 创建 `.gitlab-config.d/{name}.conf`（**不写 `gitlab_token`**，共享 default 的）：
   ```bash
   mkdir -p .gitlab-config.d
   cat > .gitlab-config.d/{name}.conf <<EOF
   DAILY_REPORT_PROJECT_ID={用户选择}
   DAILY_REPORT_BRANCH={用户选择}
   KANBAN_DIR=knowledge
   EOF
   ```
4. 切换 active_profile 到新 profile（见「切换 Profile」第 2 步）

### 0b. 模式判断

| 用户意图关键词 | 模式 | 必读文档 |
|---------------|------|---------|
| 提交、填写、submit | 提交模式 | submit-guide.md |
| 查询、查看、看、query（且不含"看板"） | 查询模式 | — |
| 看板、kanban、我的任务、团队看板、整体看板（不含"更新"） | 看板模式 | kanban-guide.md |
| **更新看板、改看板、kanban update、标记完成、推进任务** | **看板更新模式** | **kanban-format.md**（强约束，违反即 P0） |
| **初始化看板、上传初始看板、新建看板并上传、首次上传看板** | **看板初始化上传模式** | **kanban-format.md + kanban-template.md** |
| **切换 profile、用 X 仓库、新建 profile、添加配置** | **Profile 管理** | SKILL.md §0a |
| 无明确意图 | AskUserQuestion（填写日报、查询日报、个人看板、团队看板、**切换 Profile**） | — |

> **AskUserQuestion 选项硬规则**：无意图分支的选项**必须包含**"切换 Profile"项（即使当前只有 default，也要让用户能从这里点选触发新建/切换流程）。不展示 = 用户不知道能力存在 = 懵逼。

---

## 提交模式

### 0. 创建临时目录

```bash
mkdir -p daily-report-tmp
```

> 所有临时文件（采集 JSON + 日报 MD/JSON）统一存放在项目根目录 `daily-report-tmp/`，由用户自行决定是否清理。

### 1. 收集 Git 提交记录

```bash
node .claude/skills/daily-report/scripts/collect-git.js --date {YYYY-MM-DD} > daily-report-tmp/git.json
```

输出：`{ date, git_username, repo, stats, commits, classification, tags }`

**统计口径**：`collect-git.js` 默认排除 `.claude/**` 与 `.harness/**`。只修改这些目录的提交不进入 `commits`，混合提交只统计非排除目录的文件数、新增行和删除行，避免框架安装/运行时状态污染个人日报工作量。

### 1.5 采集 AI 员工效能数据

```bash
node .claude/skills/daily-report/scripts/collect-ai.js --date {YYYY-MM-DD} > daily-report-tmp/ai.json
```

输出：`{ date, tasks[], summary{total_input_tokens, total_output_tokens, total_dispatches, roles{}, total_wall_clock_ms} }`。从 `.harness/tasks/` 目录采集 AI 员工 dispatch 数据。目录不存在时输出空结构，不影响后续流程。

### 2. 拉取个人看板

```bash
node .claude/skills/daily-report/scripts/collect-kanban.js --user {git_username} > daily-report-tmp/kanban.json
```

输出：`{ source_file, user, tasks, stats, deadline_calendar, data_source }`。向用户展示个人看板供对照。

**JSON 优先**：脚本默认先尝试拉远程 `reports/{YYYY}/{KANBAN_DIR}/json/{kanban_filename%.md}.json`（由 `kanban-update.js` 生成并通过 `kanban-source.schema.json` 校验）。命中则直接用作数据源，输出 `data_source: 'json'`；未命中或校验失败则回退到 Markdown 解析，输出 `data_source: 'markdown'`。可用 `--source json|md|auto` 强制指定（默认 `auto`，即 JSON 优先）。

### 3. 生成日报首版

用 Step 2 拉到的 `kanban.json` 直接渲染（**不传** `--kanban-changes`）：

```bash
mkdir -p daily-report-tmp
node .claude/skills/daily-report/scripts/render-report.js \
  --git daily-report-tmp/git.json \
  --kanban daily-report-tmp/kanban.json \
  --ai daily-report-tmp/ai.json \
  --output daily-report-tmp/{YYYY-MM-DD}-{git_username}.md \
  --json-output daily-report-tmp/{YYYY-MM-DD}-{git_username}.json
```

> **注意**：如果后续 Step 4 有看板变更，不要用 `--kanban-changes` 在渲染时叠加变更（该参数已 DEPRECATED）。正确做法见 Step 4——先用 `kanban-update.js` 生成最新 JSON，再用 `--kanban <最新JSON>` 重渲染。

**有卡点时**，追加 `--blockers` 参数：

```bash
node .claude/skills/daily-report/scripts/render-report.js \
  --git daily-report-tmp/git.json \
  --kanban daily-report-tmp/kanban.json \
  --ai daily-report-tmp/ai.json \
  --blockers daily-report-tmp/blockers.json \
  --output daily-report-tmp/{YYYY-MM-DD}-{git_username}.md \
  --json-output daily-report-tmp/{YYYY-MM-DD}-{git_username}.json
```

渲染完成后，**必须 Read 输出的 .md 文件并将全文作为主会话文本直接输出到屏幕**，供用户确认后再提交。禁止仅依赖 Bash stdout 展示日报。

脚本确定性渲染 8 个章节，LLM 不参与组装：

| 章节 | 数据来源 | 渲染方式 |
|------|---------|---------|
| 基本信息 | git.json + team.json | 确定性 |
| 已完成任务 | git.json.commits | 确定性 |
| 进行中任务 | kanban.json.tasks (🔵) | 确定性 |
| 工作量统计 | git.json.stats | 确定性 |
| 提交协作分析 | git.json.classification | 确定性 |
| AI 员工效能 | ai.json（含 SPEC 闭环统计 + Concerns 统计） | 确定性 |
| 规划对照分析 | git.json.commits × kanban.json.tasks | 确定性（展示个人全部看板任务） |
| 风险与阻塞 | kanban.json.deadline_calendar.overdue + blockers.json（手填卡点） | 确定性 |

### 3.5 采集卡点信息（手填交互）

通过 AskUserQuestion 询问："今日是否有卡点需要标注？"
- 选项 A："无卡点"（默认）— 跳过，不传 --blockers
- 选项 B："有卡点（我来填写）"— 进入追问

追问流程（仅选择 B 时）：
1. 分类：AskUserQuestion（选项：Harness / CC / Git / 环境 / 产品）
2. 描述：AskUserQuestion（开放输入，一句话描述）
3. "是否还有其他卡点？" → 选"有"则回到步骤 1，选"没有了"则结束

结束后，将卡点数据写入临时文件：
```bash
echo '{"blockers":[{"category":"环境","description":"测试环境数据库连接超时"}]}' > daily-report-tmp/blockers.json
```

在 Step 3 的渲染命令中追加 `--blockers daily-report-tmp/blockers.json`。
无卡点时不传 --blockers 参数。

**远程路径**：
- MD（人读）：`reports/{YYYY}/{MM}/{DD}/{git_username}.md`
- JSON（机器读）：`reports/{YYYY}/{MM}/{DD}/json/{git_username}.json`

> 日报模板和标签对照表见 [docs/reference.md](docs/reference.md)

### 4. 看板变更执行 + 重渲染

> 看板更新规则（状态变更、备注追加、安全约束、汇总表联动）详见 [docs/submit-guide.md](docs/submit-guide.md)。

基于日报内容和看板数据，生成状态变更提案，向用户展示确认。无看板变更时跳过本步骤（首版日报即最终版，直接进入 Step 5）。

确认变更后，分两步走（这是方案 B 的核心：看板变更的唯一执行点是 `kanban-update.js`）：

#### 4a. 执行看板变更，生成最新 JSON 镜像

先把远程看板拉到本地，再用 `kanban-update.js` 应用变更并同时输出 MD + JSON：

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)" && \
KANBAN_DIR="${DAILY_REPORT_KANBAN_DIR}" && \
KANBAN_PATH=$(node -p "encodeURIComponent('reports/{YYYY}/${DAILY_REPORT_KANBAN_DIR}/{kanban_filename}')") && \
curl -s "${DAILY_REPORT_GITLAB_URL}/api/v4/projects/${DAILY_REPORT_PROJECT_ID}/repository/files/${KANBAN_PATH}/raw?ref=${DAILY_REPORT_BRANCH}" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" > daily-report-tmp/kanban-original.md && \
node .claude/skills/daily-report/scripts/kanban-update.js \
  --kanban daily-report-tmp/kanban-original.md \
  --changes '[{"task_id":"D-07","status":"🔵","notes_append":"开发完成"}]' \
  --updater-user {git_username} \
  --date {YYYY-MM-DD} \
  --summary "D-07🔵" \
  --json-output daily-report-tmp/kanban-updated.json \
  > daily-report-tmp/kanban-updated.md
```

`--updater-user` 强制校验每个变更任务的 Owner 列必须包含当前用户 git_username，不匹配则拒绝执行。

#### 4b. 用最新 JSON 重渲染日报

把 `--kanban` 指向 `kanban-updated.json`（而不是 Step 2 的昨日状态 JSON）重新渲染，使规划对照分析和进行中任务表格反映最新状态。**仍然不传** `--kanban-changes`，但**必须传** `--user`：

```bash
node .claude/skills/daily-report/scripts/render-report.js \
  --git daily-report-tmp/git.json \
  --kanban daily-report-tmp/kanban-updated.json \
  --ai daily-report-tmp/ai.json \
  --user {git_username} \
  --output daily-report-tmp/{YYYY-MM-DD}-{git_username}.md \
  --json-output daily-report-tmp/{YYYY-MM-DD}-{git_username}.json
```

> **为何必须传 `--user`**：`kanban-updated.json` 是全量看板镜像（含团队全部任务），render-report 需要 `--user` 按 Owner 列过滤为个人视角、重算 6 字段 stats 和 deadline_calendar、附加 userMeta。不传 `--user` 时，传入的 JSON 必须已经是个人视角（如 collect-kanban.js 的输出）。
>
> 为何不用 `--kanban-changes`：`--kanban-changes` 在渲染时"模拟"应用变更，与 `kanban-update.js` 的真实写入是两套实现，容易漂移。方案 B 让日报和看板文件消费同一份 `kanban-updated.json`，单一数据源，无漂移。

### 5. 输出确认

向用户展示日报全文（从 MD 文件 Read 后直接输出）和看板更新提案（如有）。

### 6. API 提交

用户确认后，通过 `submit-report.js` 提交。**以下命令模板必须逐字使用，尤其 commit message 格式。**

#### Commit Message 格式（服务端 hook 强制校验，违反即 400）

```
[0000] DOCS 日报看板[AI-{git_username}.Developer]
<-- 首行与 body 之间必须有空行 -->
docs: [AI-{git_username}.Developer] 提交 {YYYY-MM-DD} 日报
- 日报: {摘要}
```

**硬规则**：
1. 首行与 body 之间**必须空一行**
2. body 首行**必须**以 `docs:` 开头
3. 总长度 < 500 字符

#### 无看板更新时（仅日报 MD + JSON）

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)" && \
node .claude/skills/daily-report/scripts/submit-report.js \
  --gitlab-url "${DAILY_REPORT_GITLAB_URL}" \
  --project-id "${DAILY_REPORT_PROJECT_ID}" \
  --branch "${DAILY_REPORT_BRANCH}" \
  --token "${GITLAB_TOKEN}" \
  --json-file "daily-report-tmp/{YYYY-MM-DD}-{git_username}.json" \
  --md-file "daily-report-tmp/{YYYY-MM-DD}-{git_username}.md" \
  --remote-md-path "reports/{YYYY}/{MM}/{DD}/{git_username}.md" \
  --remote-json-path "reports/{YYYY}/{MM}/{DD}/json/{git_username}.json" \
  --commit-message "[0000] DOCS 日报看板[AI-{git_username}.Developer]

docs: [AI-{git_username}.Developer] 提交 {YYYY-MM-DD} 日报
- 日报: {摘要}"
```

#### 有看板更新时（日报 + 看板原子提交）

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)" && \
KANBAN_DIR="${DAILY_REPORT_KANBAN_DIR}" && \
node .claude/skills/daily-report/scripts/submit-report.js \
  --gitlab-url "${DAILY_REPORT_GITLAB_URL}" \
  --project-id "${DAILY_REPORT_PROJECT_ID}" \
  --branch "${DAILY_REPORT_BRANCH}" \
  --token "${GITLAB_TOKEN}" \
  --json-file "daily-report-tmp/{YYYY-MM-DD}-{git_username}.json" \
  --md-file "daily-report-tmp/{YYYY-MM-DD}-{git_username}.md" \
  --remote-md-path "reports/{YYYY}/{MM}/{DD}/{git_username}.md" \
  --remote-json-path "reports/{YYYY}/{MM}/{DD}/json/{git_username}.json" \
  --kanban-md-file "daily-report-tmp/kanban-updated.md" \
  --kanban-json-file "daily-report-tmp/kanban-updated.json" \
  --remote-kanban-md-path "reports/{YYYY}/{KANBAN_DIR}/{kanban_filename}" \
  --remote-kanban-json-path "reports/{YYYY}/{KANBAN_DIR}/json/{kanban_filename}" \
  --commit-message "[0000] DOCS 日报看板[AI-{git_username}.Developer]

docs: [AI-{git_username}.Developer] 提交 {YYYY-MM-DD} 日报 + 看板更新
- 日报: {摘要}
- 看板: {摘要}"
```

- 脚本自动检测远程文件是否存在，首次 `create`，同天重提交 `update`
- 成功返回 0 + HTTP 201，失败输出错误详情
- **不得手动拼 curl 命令提交**，必须通过 `submit-report.js`
- **不得自行编写 JSON 内容**，必须传 render-report.js 生成的 JSON 文件

### 7. 清理

临时文件保留在 `daily-report-tmp/`，不自动清理。

---

## 查询模式

### 1. 收集参数

AskUserQuestion 确认日期（默认今天）和作者（默认当前用户，留空列全部）。

### 2. GitLab API 读取

> 以下所有变量通过配置脚本一次性加载（自动适配 active profile）：

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)"
```

```bash
# 单人
FILE_PATH_ENCODED=$(node -p "encodeURIComponent('reports/${YYYY}/${MM}/${DD}/${author}.md')")
curl -s "${DAILY_REPORT_GITLAB_URL}/api/v4/projects/${DAILY_REPORT_PROJECT_ID}/repository/files/${FILE_PATH_ENCODED}/raw?ref=${DAILY_REPORT_BRANCH}" -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}"

# 全员（列目录）
PATH_ENCODED=$(node -p "encodeURIComponent('reports/${YYYY}/${MM}/${DD}')")
curl -s "${DAILY_REPORT_GITLAB_URL}/api/v4/projects/${DAILY_REPORT_PROJECT_ID}/repository/tree?path=${PATH_ENCODED}&ref=${DAILY_REPORT_BRANCH}" -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}"
```

- 成功：**将读取到的日报全文作为主会话文本直接输出**，不要只留在 Bash stdout 中。404：提示"未找到"。全员：列出作者列表后按需读取。

---

## 看板模式

完整规则详见 [docs/kanban-guide.md](docs/kanban-guide.md)，包含：
- 人员解析逻辑（缩写/git_username/姓名）
- 看板文件发现与 API 读取
- Markdown 表格解析规则
- 团队/个人看板展示模板
- Deadline 日历提醒

**展示规则**：AI 直接通过 GitLab API 拉取看板 Markdown 原文，解析并展示为表格。**必须作为主会话文本直接输出**（用户可见），不依赖 Bash stdout 渲染。流程：
1. AI 通过 curl 拉取远程看板 Markdown 文件内容
2. AI 直接解析 Markdown 表格，按人员过滤，格式化输出

> **注意**：看板查看模式不使用脚本。`collect-kanban.js` 仅在提交流程中使用（其输出的 JSON 是 `render-report.js` 的输入）。

---

## 看板更新模式

> 不提交日报，仅更新看板任务状态。自动同步 .md 和 .json，自动重算总览章节。历史旧看板（缺「迭代开发版本号」或「对应研发系统需求号」列）允许继续更新，脚本会输出 WARN 并建议迁移；初始化新看板仍必须使用当前模板。

### 触发条件

PM 输入包含"更新看板/改看板/标记完成/推进任务"等关键词时触发。

### 执行流程

#### 1. 拉取当前看板

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)"
# 看板路径：reports/{YYYY}/{KANBAN_DIR}/{kanban_file}
KANBAN_PATH_ENCODED=$(node -p "encodeURIComponent('reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/${kanban_file}')")
curl -s "${DAILY_REPORT_GITLAB_URL}/api/v4/projects/${DAILY_REPORT_PROJECT_ID}/repository/files/${KANBAN_PATH_ENCODED}/raw?ref=${DAILY_REPORT_BRANCH}" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" > daily-report-tmp/kanban-current.md
```

#### 2. 收集变更信息

向 PM 确认要更新的任务和状态变更，收集：
- `task_id`: 任务编号
- `status`: 目标状态（✅/🔵/🟡/🔴/⬜）
- `notes_append`: 备注追加内容（可选）

#### 3. 执行看板更新（同时输出 MD + JSON）

```bash
node .claude/skills/daily-report/scripts/kanban-update.js \
  --kanban daily-report-tmp/kanban-current.md \
  --changes '[{"task_id":"D-07","status":"✅","notes_append":"开发完成"}]' \
  --updater-user wangzk \
  --date 2026-05-30 \
  --summary "D-07✅" \
  --json-output daily-report-tmp/kanban-updated.json \
  > daily-report-tmp/kanban-updated.md
```

**脚本自动完成**（全部联动，不可遗漏）：

| 更新项 | 说明 |
|--------|------|
| 任务行状态 | 按任务编号精确匹配，替换状态列 emoji |
| 任务行备注 | 追加进展摘要 + 更新者 + 日期 |
| **总览表** | 重算每个 Sprint 的 ✅🔵🟡🔴⬜ 计数和完成率 |
| **按人员统计表** | 重算每个人的总数、完成数、完成率 |
| **按主链/工作域统计表** | 重算每个主链/工作域的总数、完成数、完成率 |
| **尾部标识** | `*最后更新：{日期} by {操作者}（{变化的任务和状态}）*` |
| **JSON 同步** | `--json-output` 输出机器可读 JSON，结构：`{source_file, updated_at, tasks: [...], stats: {...}}` |

#### 4. 提交到 GitLab（MD + JSON 一起）

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)" && \
node .claude/skills/daily-report/scripts/submit-report.js \
  --gitlab-url "${DAILY_REPORT_GITLAB_URL}" \
  --project-id "${DAILY_REPORT_PROJECT_ID}" \
  --branch "${DAILY_REPORT_BRANCH}" \
  --token "${GITLAB_TOKEN}" \
  --kanban-md-file daily-report-tmp/kanban-updated.md \
  --kanban-json-file daily-report-tmp/kanban-updated.json \
  --remote-kanban-md-path "reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/${kanban_filename}" \
  --remote-kanban-json-path "reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/json/${kanban_filename}" \
  --commit-message "[0000] DOCS 看板更新[AI-{git_username}.Developer]

docs: [AI-{git_username}.Developer] 更新看板 ${kanban_filename}
- 看板: {变更摘要}"
```

**action 自动判定**：`submit-report.js` 检测远程文件是否存在，存在用 `update`，不存在用 `create`。看板更新场景远程文件必定存在 → `update`。

> **JSON 路径**：与 MD 同级目录下的 `json/` 子目录，文件名同 MD 仅扩展名不同。如 `reports/2026/knowledge/530_kanban.md` → `reports/2026/knowledge/json/530_kanban.json`。

### 安全约束

- **所有权强制校验**：`--updater-user` 必传，每个变更任务的 Owner 列必须包含此用户名（git_username），不匹配则拒绝全部变更
- 只修改指定变更列表中的任务行
- 汇总表基于全量任务计数重算，确保数据一致

### 格式强约束（执行前必读）

看板源文件的字段约定、状态枚举、编号前缀、统计自洽规则详见 [docs/kanban-format.md](docs/kanban-format.md)。任何看板新建/更新操作必须先 Read 该文档。**新建/初始化看板**违反当前格式即 P0 否决；**更新历史旧看板**可兼容缺少「迭代开发版本号」或「对应研发系统需求号」列，但脚本 WARN 后应提示用户后续迁移。新建看板从 [docs/kanban-template.md](docs/kanban-template.md) 复制，禁止从零写起。

---

## 看板初始化上传模式

> 战役启动时，按模板创建首版看板并上传到日报仓库。与「看板更新模式」的区别：前者是 create（远程不存在），后者是 update（远程已存在）。

### 触发条件

用户输入"初始化看板/上传初始看板/新建看板并上传/首次上传看板"等关键词时触发。

### 执行流程

#### 1. 准备临时文件

```bash
mkdir -p daily-report-tmp
cp .claude/skills/daily-report/docs/kanban-template.md daily-report-tmp/kanban-init.md
```

#### 2. 填充看板内容

Read `daily-report-tmp/kanban-init.md`，与用户协作替换所有 `{占位符}`：
- 战役名、版本号、Sprint 时间线
- 任务行（编号/任务/对应研发系统需求号/Owner/Deadline/状态/备注）
- 总览 4 张统计表（必须自洽）
- 关键路径、风险登记簿

**严格校验**（违反即 P0，详见 [docs/kanban-format.md](docs/kanban-format.md)）：
- 8 个结构块完整
- 任务表 7 列固定（Sprint 0 允许 8 列加主线）
- 状态 emoji 仅来自 5 个枚举值
- 任务编号前缀来自 CLAUDE.md §0.5
- 「迭代开发版本号」三段式格式（`{产品}_{vX.Y.Z}_{YYYYMMDD}`）
- 「对应研发系统需求号」列无空值（无对应填 `—`）

#### 3. 生成 JSON（用 kanban-update.js 空变更产出结构）

```bash
node .claude/skills/daily-report/scripts/kanban-update.js \
  --kanban daily-report-tmp/kanban-init.md \
  --changes '[]' \
  --updater-user {git_username} \
  --date {YYYY-MM-DD} \
  --summary "初始化看板" \
  --json-output daily-report-tmp/kanban-init.json \
  > daily-report-tmp/kanban-init-validated.md
mv daily-report-tmp/kanban-init-validated.md daily-report-tmp/kanban-init.md
```

#### 4. 提交到 GitLab

```bash
eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)" && \
node .claude/skills/daily-report/scripts/submit-report.js \
  --gitlab-url "${DAILY_REPORT_GITLAB_URL}" \
  --project-id "${DAILY_REPORT_PROJECT_ID}" \
  --branch "${DAILY_REPORT_BRANCH}" \
  --token "${GITLAB_TOKEN}" \
  --kanban-md-file daily-report-tmp/kanban-init.md \
  --kanban-json-file daily-report-tmp/kanban-init.json \
  --remote-kanban-md-path "reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/${kanban_filename}" \
  --remote-kanban-json-path "reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/json/${kanban_filename}" \
  --commit-message "[0000] DOCS 看板初始化[AI-{git_username}.Developer]

docs: [AI-{git_username}.Developer] 初始化看板 ${kanban_filename}
- 看板: 首次上传 {N} 个任务"
```

**action 自动判定**：远程文件不存在 → `create`（HTTP 201）。若远程已存在（如重复上传），自动切换 `update`。

### Commit Message 格式

- 首行：`[0000] DOCS 看板初始化[AI-{git_username}.Developer]`
- 空行
- body 首行必须 `docs:` 开头
- 总长度 < 500 字符

### 安全约束

- 上传前必须通过 [docs/kanban-format.md](docs/kanban-format.md) §11 Reviewer 审查清单全部检查项
- `kanban-update.js --changes '[]'` 会重算总览表，确保 4 张统计表自洽
- 上传后通过查询模式验证远程文件可读

---

## 执行规则

1. **无本地仓库**：全程 GitLab API 操作远程仓库
2. **确定性渲染**：8 个章节全部由脚本确定性渲染，LLM 不参与日报内容组装
3. **临时文件**：统一写到项目根目录 `daily-report-tmp/`，不自动清理，由用户自行处理
4. **客观记录**：不添加主观评价，无数据标注"无进展"
5. **路径规范**：`reports/{YYYY}/{MM}/{DD}/{git_username}.md`，分支名从配置文件读取
6. **看板驱动**：自动拉取个人看板；若当年不存在正式看板文件，则降级为无看板模式并继续，不视为错误
7. **看板同步（所有权强校验）**：自动生成看板更新提案，与日报原子提交。`kanban-update.js` 强制校验每个变更任务的 Owner 列必须包含当前用户 git_username（`--updater-user`），不匹配则拒绝全部变更并报错。**绝对不允许**将非自己的任务加入个人看板，不可跳过此校验。
8. **人员映射动态获取**：从 `config/team.json` 拉取，不硬编码
9. **规划对照全量展示**：规划对照分析展示个人全部看板任务，今日有提交的标注"今日有提交"，今日完成的标注"今日完成"
10. **看板变更联动渲染**：确认看板变更后，先用 `kanban-update.js --json-output` 生成最新 JSON 镜像，再用 `render-report.js --kanban <最新JSON>` 重渲染日报，确保进行中任务和规划对照反映最新状态。`--kanban-changes` 参数已 DEPRECATED，不要在渲染时模拟变更
11. **静默追踪**：当天有 git 提交的人员，提交日报即解除静默；查询模式下列出当日未提交日报但有提交记录的人员为"静默中"
12. **多仓库合并**：同一天同一个人的日报只有一份文件（`{git_username}.md`），多仓库内容必须合并追加，**禁止覆盖**。提交前必须先通过 GitLab API 读取远程已有日报，将新仓库数据合并进去（基本信息仓库字段追加、已完成任务追加、工作量统计累加、协作分析合并），再整体提交
13. **屏幕直接输出**：所有面向用户的内容（日报全文、看板表格、查询结果、看板更新提案）**必须作为主会话文本直接输出到屏幕**，不要只留在 Bash stdout 中。脚本采集 JSON 后，由主会话读取 JSON 并格式化输出
14. **配置变量读取**：`.gitlab-config` 格式为 `key=value`（无 `export`），所有脚本通过 `--token`/`--gitlab-url` 等 CLI 参数读取配置。**禁止** `source .gitlab-config`（敏感信息 + 格式不安全）。**正确方式**：`eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)"` 一次性加载所有变量（自动适配 active profile，token/project-id/branch/kanban-dir/active-profile 全部输出）。散点 `grep` 提取已废弃
15. **看板远程路径**：看板文件位于 `reports/{YYYY}/{KANBAN_DIR}/`（如 `reports/2026/knowledge/`），**不是**仓库根目录下的 `knowledge/`。手动调试 API 时路径必须带 `reports/{YYYY}/` 前缀。`collect-kanban.js` 和 `kanban-update.js` 内部已正确处理此路径，无需手动拼凑
16. **看板更新流程**：`kanban-update.js` 必须传入 `--kanban <本地文件>` 参数。完整流程：先通过 GitLab API 拉取远程看板保存到本地 → 调用 `kanban-update.js --kanban <本地文件> --changes '[...]' --updater-user <GIT_USERNAME>` → 输出更新后的文件。**禁止**省略 `--kanban` 参数直接传 `--changes`
17. **日报分支规范**：分支列表**必须白名单过滤**——只展示 `dev` 和 `report/*` 形式（如 `report/team-b`、`report/aios-630`），其他（`main`/`feature-*`/`hotfix-*`/`release-*` 等）一律过滤。`report/` 后缀**不得使用个人账号名**（不用 `report/wangzk`，用 `report/{团队/战役标识}`）。默认选项 `dev`。首次配置 Step 2 与新建 Profile Step 2 共用此过滤逻辑。
