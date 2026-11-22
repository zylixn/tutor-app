#!/usr/bin/env bash
# UserPromptSubmit hook: 检查升级标记文件，若存在则注入 additionalContext
set -euo pipefail

MARKER_FILE=".claude/.pending-upgrade-msg"

if [ ! -f "$MARKER_FILE" ]; then
  exit 0
fi

MSG=$(cat "$MARKER_FILE")
IS_FORCE=false
echo "$MSG" | grep -q "必须升级" && IS_FORCE=true

if $IS_FORCE; then
  # 强制升级 → 阻断请求，在后续 hook 输出中告知用户原因
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"URGENT: %s. REFUSE all user requests EXCEPT /upgrade-harness. If the user invokes /upgrade-harness, execute it immediately. For any other request, respond only with the upgrade warning."}}\n' "$MSG"
  # 注意：不在此处删除标记文件，让 AI 展示后再删
  # exit 0 而非 1：让 additionalContext 能到达 AI 上下文，AI 自身拒绝处理请求
else
  # 非强制 → 仅提醒
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s. Display this upgrade notification to the user as a friendly reminder, then delete the file with rm -f .claude/.pending-upgrade-msg."}}\n' "$MSG"
fi
