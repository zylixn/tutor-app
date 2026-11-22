# 看板模式详解

> **看板格式强约束**：`kanban-format.md`（与本文件同目录）
> **通用看板模板**：`kanban-template.md`（与本文件同目录）
>
> **重要**：本指南仅规范看板的**查询展示**。看板源文件的**新建/更新/字段约定**必须严格遵守 `kanban-format.md`，违反即 P0 否决。新建看板必须从 `kanban-template.md` 复制，禁止从零写起。
>
> **数据来源说明**：看板**查看模式**（本文件描述的流程）是只读展示，AI 直接通过 GitLab API 拉取看板 Markdown 原文解析展示，**不经过 `collect-kanban.js`**，因此不受 collect-kanban.js 的 JSON 优先逻辑影响。
>
> `collect-kanban.js` 仅在**提交流程**中使用（其输出的 JSON 是 `render-report.js` 的输入）。从方案 B 起，collect-kanban.js 默认 JSON 优先：先尝试拉远程看板 JSON 镜像，命中并通过 `kanban-source.schema.json` 校验则直接用作数据源（输出 `data_source: 'json'`），否则回退到 Markdown 解析（输出 `data_source: 'markdown'`）。这与查看模式无关——查看模式始终直接读 Markdown。

## Step 0. 区分两种场景（执行前必读）

| 场景 | 触发词 | 适用规范 |
|------|--------|---------|
| **查询展示**（本指南） | 看板、团队看板、个人看板、我的看板 | 本指南 Step 1–5 |
| **新建/更新看板源文件** | 新建看板、上传初始看板、更新看板、加任务、改状态、调整 Owner/Deadline | `kanban-format.md` 强约束 + `kanban-template.md` 模板 |

走错路径会导致看板格式被破坏。如果用户请求涉及修改看板源文件，先 Read `kanban-format.md` 再动手。

## Step 1. 确定查询目标

从用户指令中提取查询参数，未明确时使用 AskUserQuestion 确认：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 目标人员 | **团队整体**（全部成员） | 支持查看团队整体、个人。输入可以是 git_username（zhangsan）或姓名 |
| 看板年份 | 当前年份 | 格式 YYYY |

用户可以在触发时直接指定：
- "看板"、"团队看板"、"整体看板" → 目标 = 团队整体（默认）
- "查看我的看板"、"我的任务" → 目标 = 当前用户
- "查看 zhoucw 的看板"、"zhoucw 看板" → 目标 = zhoucw
- "看 zhangsan 的看板" → 目标 = zhangsan

**人员解析逻辑**：
1. 未指定人员或触发词为"团队/整体看板" → 输出团队整体看板
2. 输入为 git_username（如 zhangsan）→ 直接使用
3. 输入为姓名（如 张三）→ 查 team.json 映射表获取 git_username
4. 未匹配 → 提示"未识别的成员标识，请使用 git 用户名（如 zhangsan）"

## Step 2. 发现并拉取看板文件

AI 直接通过 GitLab API 获取看板内容，无需脚本。

**看板目录**：从 active profile 的 `KANBAN_DIR` 字段读取（默认 `knowledge`），查找路径为 `reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/`。

> 以下所有变量通过配置脚本一次性加载（自动适配 active profile）：
>
> ```bash
> eval "$(node .claude/skills/daily-report/scripts/lib/config.js print)"
> ```

**发现看板文件**：

```bash
KANBAN_DIR_ENCODED=$(node -p "encodeURIComponent('reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/')")
curl -s \
  "${DAILY_REPORT_GITLAB_URL}/api/v4/projects/${DAILY_REPORT_PROJECT_ID}/repository/tree?path=${KANBAN_DIR_ENCODED}&ref=${DAILY_REPORT_BRANCH}" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}"
```

- 匹配 `*_kanban*.md` 文件
- 不论团队看板还是个人看板，统一取**文件名排序最大**的看板文件（如 `430_kanban_v2.1.md` > `430_kanban_v1.0.md`）
- 若无看板文件 → 提示"当年（{YYYY}）无正式看板文件"并停止；这是正常的无数据结果，不视为错误

**拉取看板内容**：

```bash
KANBAN_PATH_ENCODED=$(node -p "encodeURIComponent('reports/${YYYY}/${DAILY_REPORT_KANBAN_DIR}/${kanban_filename}')")
curl -s \
  "${DAILY_REPORT_GITLAB_URL}/api/v4/projects/${DAILY_REPORT_PROJECT_ID}/repository/files/${KANBAN_PATH_ENCODED}/raw?ref=${DAILY_REPORT_BRANCH}" \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}"
```

## Step 3. AI 解析看板

AI 读取拉取到的 Markdown 原文后，直接解析并按需过滤展示。解析规则：

1. 识别所有 Markdown 表格（`|...|...|` 格式）
2. 定位包含 Owner 列的表格（表头含 `Owner`、`执行者`、`责任人`）
3. 将目标人员的 git_username 与 Owner 列匹配
4. 匹配方式：Owner 字段按 `+` / `,` / `/` / 空格分割后逐段 trim，与 team.json 中 git_username 精确比对
5. 匹配成功的整行任务归入个人看板
6. 保留每个表格前的 `##` / `###` 标题作为分组依据

> **注意**：看板查看模式不使用 `collect-kanban.js` 脚本。脚本仅在提交流程中使用（其输出的 JSON 是 `render-report.js` 的输入）。

## Step 4. 生成并展示看板

根据查询目标选择输出模式：

### 团队整体看板（默认，未指定人员时）

将看板中所有任务行提取，按以下表格输出到屏幕：

```markdown
## 📋 团队看板

> 数据来源：{看板文件名}，最后更新：{看板末尾标注的更新日期}

| 紧急度 | 任务 | 责任人 | Deadline | 状态 |
|--------|------|--------|----------|------|
| 🔴 | PA-01 Schema 迁移框架 | ZCW | 5/8 | 🔵 |
| 🟡 | S0-17 530 新增仓库创建 | ZS | 5/7 | ✅ |
| ⬜ | S0-03 CI Pipeline 升级 | ZS | 5/12 | ⬜ |
```

**列提取规则**：
- **紧急度**：从看板原始表格中的"紧急度"/"优先级"/"P0/P1/P2"列提取，映射为 emoji：P0→🔴、P1→🟡、P2→🟢、无→⬜。无该列时默认显示 ⬜
- **任务**：从"任务"/"#"/"编号"+"描述"列组合，格式为 `{编号} {任务描述}`（如 `PA-01 Schema 迁移框架`）
- **责任人**：从 Owner 列直接取值
- **Deadline**：从 Deadline 列直接取值（如 `5/8`、`5/15`）
- **状态**：从状态列直接取 emoji（✅🔵🟡⬜🔴）

**排序规则**：按紧急度排序（🔴 > 🟡 > 🟢 > ⬜），同紧急度按状态排序（🔵 > 🟡 > ⬜ > ✅）

**过滤规则**：跳过 Owner 为"各组"、"AI Tester"等非具体人员的行

### 个人看板（指定人员时）

将匹配到的所有任务按原看板的 Sprint/阶段 分组，输出个人看板：

个人看板展示格式（含统计汇总）请参阅 [reference.md](reference.md)

## Step 5. Deadline 日历提醒

团队看板和个人看板输出后，追加未来 3 天（含今天）的 Deadline 日历提醒。

**生成规则**：
1. 从看板所有任务行中提取 Deadline 列的日期值（格式如 `5/8`、`5/15`）
2. 将 Deadline 转换为绝对日期（基于当前年份和月份）
3. 筛选 Deadline 落在今天、明天、后天且状态非 ✅ 的任务
4. 按日期分组输出，Deadline 为今天的行加粗显示日期

**无 Deadline 任务处理**：
- 看板任务必须指定 Deadline
- 未指定 Deadline 的任务归类为"待排期"，单独展示在日历末尾
- 每周复盘时审视"待排期"任务，补充 Deadline

**输出格式**：

```markdown
## 📊 Deadline 日历提醒

| 日期 | 到期任务 | 责任人 | 状态 |
|------|---------|--------|------|
| **{今天 MM/DD}** | {编号} {任务名} | {Owner} | 🔵 |
| {明天 MM/DD} | {编号} {任务名} | {Owner} | ⬜ |
| {后天 MM/DD} | {编号} {任务名} | {Owner} | ⬜ |
| 待排期 | {编号} {任务名} | {Owner} | ⬜ |
```

> **注意**：只展示非 ✅ 状态的任务；无到期任务时输出"未来 3 天无到期任务"。

## 注意事项

- 看板中标注为"各组"、"AI Tester"等非具体人员的 Owner 行跳过
- 如果目标人员无任何匹配任务，提示"未找到 {姓名} 在当月看板中的任务"
- 输出向用户展示后，询问是否需要进一步操作（查看他人看板、返回等）
