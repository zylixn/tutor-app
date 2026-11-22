#!/usr/bin/env bash
# PreToolUse hook: 组合 Git 操作守卫
# - 禁止读写框架保护文件
# - 禁止 git pull 拉取基线分支 main/master
# - 禁止本地 git merge 合并不同分支
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-json-helper.sh"

INPUT=$(cat)
TOOL=$(_jq_val "$INPUT" tool_name)

case "$TOOL" in
    Bash) ;;
    *) exit 0 ;;
esac

COMMAND=$(_jq_val "$INPUT" command)

# ── 1) 框架保护路径 / bypass 文件 ──
# 保护策略：Edit/Write 工具侧已有 guard，Bash 侧只拦破坏性操作。
# git add/status/diff 等无害操作不受影响。
_PROTECTED_RE='(\.git[/\\]hooks[/\\]|\.claude[/\\]hooks[/\\])'
_BYPASS_FILES_RE='(\.claude[/\\]\.framework-edit|\.claude[/\\]\.push-challenge)'
_SAFE_GIT_RE='^git[[:space:]]+(add|status|diff|log|stash)[[:space:]]'

if echo "$COMMAND" | grep -qE "$_SAFE_GIT_RE"; then
    : # git add/status/diff 不拦截
elif echo "$COMMAND" | grep -qE "$_PROTECTED_RE"; then
    hook_deny "框架保护区，AI 止步。这些文件只有人类的肉身之手才能碰——去请 PM 帮你吧。"
    exit 0
elif echo "$COMMAND" | grep -qE "$_BYPASS_FILES_RE"; then
    hook_deny "框架保护区，AI 止步。这些文件只有人类的肉身之手才能碰——去请 PM 帮你吧。"
    exit 0
fi

# ── 2) 禁止 git pull 拉取 main/master ──
if echo "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+pull[[:space:]]+.*\b(main|master)\b'; then
    hook_deny "禁止通过 git pull 拉取基线分支 main/master。基线同步必须通过 GitLab Merge Request 流程，确保代码评审和 CI 门禁。"
    exit 0
fi

# ── 3) 禁止本地 git merge 合并分支 ──
if echo "$COMMAND" | grep -qE '(^|[;&|][[:space:]]*)git[[:space:]]+merge([[:space:]]|$)'; then
    hook_deny "禁止本地 git merge 合并不同分支。分支合并必须通过 GitLab Merge Request 流程，确保代码评审和 CI 门禁。"
    exit 0
fi

exit 0
