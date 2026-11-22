# 前置条件与配置

## 技能配置

日报技能通过项目根目录的 `.gitlab-config` 配置文件对接日报仓库（与 `gitlab_token` 共用同一文件）：

格式：

```
DAILY_REPORT_GITLAB_URL=http://192.168.5.160
DAILY_REPORT_PROJECT_ID=group%2Fproject
DAILY_REPORT_BRANCH=dev
```

| 配置项 | 必填 | 说明 |
|--------|------|------|
| `DAILY_REPORT_GITLAB_URL` | 自动 | 固定 `http://192.168.5.160`，无需用户提供 |
| `DAILY_REPORT_PROJECT_ID` | 是 | 日报仓库路径（URL 编码，`/` → `%2F`） |
| `DAILY_REPORT_BRANCH` | 否 | 分支名（默认 `dev`） |
| `KANBAN_DIR` | 否 | 看板目录名（默认 `knowledge`），完整路径为 `reports/{YYYY}/{KANBAN_DIR}/` |

**读取优先级**：环境变量 > `.gitlab-config` > 内置默认值。

首次使用若配置文件不存在或关键字段为空，技能会引导填写。日报仓库的建仓要求详见 [repo-spec.md](repo-spec.md)。

> 配置对用户透明，正常使用无需关心仓库地址和分支信息。

## 看板文件路径

| 常量 | 值 | 说明 |
|------|-----|------|
| KANBAN_DIR | `knowledge`（默认） | 看板存放目录名，完整路径为 `reports/{YYYY}/{KANBAN_DIR}/` |
| KANBAN_PATTERN | `*_kanban*.md` | 看板文件名匹配模式，字母序最大的为最新版本 |

> 运行时自动兼容旧路径 `reports/{YYYY}/knownlage/`（`knowledge/` 不存在时降级）。

## 人员映射

映射表由 `collect-kanban.js` 运行时从日报仓库 `config/team.json` 动态拉取，不硬编码。

**匹配规则**：看板 Owner 字段中以 `+` / `,` / `/` / 空格分隔多人时，逐段 trim 后与 team.json 中 `git_username` 精确匹配；`AI Tester`、`各组`

## 令牌检测（强制，不可跳过）

**必须**提供 GitLab Personal Access Token 才能使用本技能。执行任何操作前，先按以下顺序检测令牌：

```
1. 检查环境变量 GITLAB_TOKEN 是否已设置且非空
2. 如果未设置，检查项目根目录 .gitlab-config 文件中 gitlab_token 的值
3. 如果已获取到令牌 → 使用该令牌继续
4. 如果均未设置 → 阻断所有操作，输出以下提示后停止
```

从 `.gitlab-config` 读取令牌的方式：

```bash
# 读取 .gitlab-config 中的 gitlab_token（文件存在时）
if [ -f .gitlab-config ]; then
  grep -Po '(?<=^gitlab_token=).*' .gitlab-config | xargs
fi
```

**阻断提示（无令牌时必须输出）**：

```
🚫 无法执行日报操作：未设置 GitLab 访问令牌。

请选择一种方式配置令牌：

方式一：环境变量
  Linux / macOS：
    export GITLAB_TOKEN="粘贴你的令牌"

  Windows PowerShell：
    $env:GITLAB_TOKEN = "粘贴你的令牌"

方式二：项目配置文件（推荐，已自动加入 .gitignore）
  在项目根目录创建 .gitlab-config 文件：
    gitlab_token=粘贴你的令牌

获取令牌步骤：
  1. 浏览器登录 GitLab
  2. 点击右上角头像 → 偏好设置 → 访问令牌
  3. 创建个人访问令牌（权限：api + read_repository + write_repository）
  4. 复制生成的令牌值

设置完成后重新触发日报操作即可。
```

> **红线**：无论提交模式还是查询模式，令牌检测不通过时**立即停止**，不得继续执行任何后续步骤。
