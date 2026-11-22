# cmd_resolved_injection.sh — resolved-injection 命令实现
#
# 从 GitLab 拉取已关闭的下游 issue，写入项目知识库。
# 用法: gitlab-issue.sh resolved-injection <project-name>
# 产出: .harness/knowledge/resolved-issues.md
#
# 独立实现，不依赖 common.sh/http.sh 内部函数，避免 search 参数编码兼容问题。

cmd_resolved_injection() {
  local project_name="${1:-}"
  if [ -z "${project_name}" ]; then
    echo "[gitlab-issue] Error: resolved-injection requires a project name argument" >&2
    echo "  用法: gitlab-issue.sh resolved-injection <project-name>" >&2
    exit 1
  fi

  # Load credentials (same as submit-harness-issue.sh: .gitlab-config or GITLAB_TOKEN env).
  local TOKEN="" API_URL="" PROJECT_ID=""
  TOKEN="${GITLAB_TOKEN:-}"
  [ -z "${TOKEN}" ] && [ -f .gitlab-config ] && TOKEN=$(grep -E "^gitlab_token=" .gitlab-config 2>/dev/null | cut -d= -f2)
  if [ -z "${TOKEN}" ]; then
    return 0  # No credentials — skip silently (don't block upgrade).
  fi

  # Derive API URL (same default as submit-harness-issue.sh).
  API_URL="${GITLAB_API_URL:-http://192.168.5.160/api/v4}"
  PROJECT_ID="${GITLAB_PROJECT_ID:-public_group%2Frd_harness}"

  local search_encoded
  search_encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('${project_name}'))")

  # Fetch closed ai-detected issues mentioning this project.
  local all_results="[]" page=1
  while :; do
    local resp
    resp=$(curl -s --max-time 30 --header "PRIVATE-TOKEN: ${TOKEN}" \
      "${API_URL}/projects/${PROJECT_ID}/issues?state=closed&labels=ai-detected&search=${search_encoded}&per_page=100&page=${page}" 2>/dev/null)
    if [ -z "${resp}" ] || [ "${resp}" = "[]" ]; then
      break
    fi
    all_results=$(ALL="${all_results}" SUB="${resp}" python3 -c '
import json, os
a = json.loads(os.environ.get("ALL", "[]"))
s = json.loads(os.environ.get("SUB", "[]"))
print(json.dumps(a + s, ensure_ascii=False))
')
    page=$((page + 1))
    [ "${page}" -gt 10 ] && break
  done

  local count
  count=$(printf '%s' "${all_results}" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')
  if [ "${count}" -eq 0 ]; then
    return 0
  fi

  local knowledge_dir=".harness/knowledge"
  mkdir -p "${knowledge_dir}"

  local today
  today=$(date +%Y-%m-%d)

  printf '%s' "${all_results}" | PROJECT_NAME="${project_name}" TODAY="${today}" python3 -c '
import sys, json, os

data = json.load(sys.stdin)
today = os.environ["TODAY"]
project_name = os.environ["PROJECT_NAME"]

print("## 已解决的框架 Issue（截至 {}）".format(today))
print()
print("以下 issue 由本项目（`{}`）提交，已被 rd_harness 修复。升级框架后即生效。".format(project_name))
print()
print("| IID | 标题 | 修复/关闭日期 |")
print("|-----|------|-------------|")

for issue in data:
    iid = issue.get("iid", "")
    title = (issue.get("title") or "")[:70]
    closed = (issue.get("closed_at") or "")[:10]
    print("| !{} | {} | {} |".format(iid, title, closed))

print()
print("> 使用 `/issue-board` 查看详情。已关闭 issue 的评论区含修复 commit 和升级指引。")
' > "${knowledge_dir}/resolved-issues.md"

  echo "[gitlab-issue] Wrote ${count} resolved issue(s) to ${knowledge_dir}/resolved-issues.md"
}
