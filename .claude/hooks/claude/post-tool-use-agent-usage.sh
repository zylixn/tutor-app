#!/usr/bin/env bash
# PostToolUse hook: 自动记录 Agent dispatch 的 usage
# 触发条件: Task / Agent 工具执行完毕后
# 输出: 调用 orchestrator.mjs record-usage 追加到 .harness/usage/usage.jsonl
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-json-helper.sh"

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# ── 读取 stdin JSON ──
INPUT=$(cat)

# ── 防御性过滤：只处理 Task / Agent 工具 ──
TOOL=$(_jq_val "$INPUT" tool_name)
case "$TOOL" in
    Task|Agent) ;;
    *) exit 0 ;;
esac

# ── 提取 subagent_type，为空则退出 ──
SUBAGENT_TYPE=$(_jq_raw "$INPUT" subagent_type)
[ -z "$SUBAGENT_TYPE" ] && exit 0

# ── 映射角色名（与 usage-tracking.md 角色名映射表一致） ──
case "$SUBAGENT_TYPE" in
    Architect)  ROLE="architect" ;;
    Developer)  ROLE="developer" ;;
    Tester)     ROLE="tester" ;;
    Reviewer)   ROLE="reviewer" ;;
    Debate)     ROLE="debate" ;;
    *)          ROLE="$(echo "$SUBAGENT_TYPE" | tr '[:upper:]' '[:lower:]')" ;;
esac

# ── 提取 task 描述（从 prompt 截取前 100 字符，过滤敏感词） ──
TASK_PROMPT=$(_jq_raw "$INPUT" prompt)
TASK_DESC=""
if [ -n "$TASK_PROMPT" ]; then
    TASK_DESC="$(printf '%s' "$TASK_PROMPT" | head -c 100 | tr '\n' ' ' \
        | sed -E 's/(api[_-]?key|password|secret|token|credential|auth)[=:]["'"'"']?[[:alnum:]_\-]{6,}/\1=***REDACTED***/gi')"
fi

# ── Transcript 水位线管理 ──
USAGE_DIR="$HOME/.claude/usage"
WATERMARK_FILE="$USAGE_DIR/.last-transcript-line"
FROM_LINE="0"

if [ -f "$WATERMARK_FILE" ]; then
    FROM_LINE="$(cat "$WATERMARK_FILE" 2>/dev/null || echo 0)"
fi

# 计算当前 transcript 路径
# 路径编码规则：所有非字母数字字符替换为 "-"，必须与 orchestrator.mjs findTranscriptPath() 保持一致
SESSION_ID=$(_jq_val "$INPUT" session_id)
_transcript_path=""
if [ -n "$SESSION_ID" ]; then
    _project_slug="$(echo "$PROJECT_DIR" | sed 's/[^a-zA-Z0-9]/-/g')"
    _candidate="$HOME/.claude/projects/$_project_slug/${SESSION_ID}.jsonl"
    if [ -f "$_candidate" ]; then
        _transcript_path="$_candidate"
    fi
fi

# 更新水位线为当前 transcript 行数（下一次 dispatch 的起点）
if [ -n "$_transcript_path" ]; then
    _current_lines="$(wc -l < "$_transcript_path" 2>/dev/null || echo 0)"
    mkdir -p "$USAGE_DIR" 2>/dev/null || true
    printf '%s' "$_current_lines" > "$WATERMARK_FILE"
fi

# ── 提取 duration_ms，反算 started_at ──
# 用 _jq_raw（node 解析）而非 _jq_val（sed）：duration_ms 是数字类型，sed 只能匹配引号字符串
DURATION_MS=$(_jq_raw "$INPUT" duration_ms)
STARTED_AT_FLAG=""
STARTED_AT=""
if [ -n "$DURATION_MS" ] && [ "$DURATION_MS" != "0" ]; then
    # 通过 stdin 传值（避免 node -e 中拼接变量的注入风险），兼容 macOS/Linux
    STARTED_AT="$(printf '%s' "$DURATION_MS" | node -e "
        let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
            const ms=parseInt(d.trim(),10);
            if(!isNaN(ms)&&ms>0)process.stdout.write(new Date(Date.now()-ms).toISOString());
        });
    " 2>/dev/null || true)"
    if [ -n "$STARTED_AT" ]; then
        STARTED_AT_FLAG="--started-at"
    fi
fi

# ── 调用 orchestrator.mjs record-usage ──
# --completed-at 省略（自动取当前时间）
# --started-at 从 duration_ms 反算
# --from-line 使用水位线增量提取 token
# stdout 静默，stderr 写入错误日志便于排查（不超过 10KB，自动清理）
_ERR_LOG="$USAGE_DIR/.hook-error.log"
if [ -f "$_ERR_LOG" ] && [ "$(wc -c < "$_ERR_LOG" 2>/dev/null || echo 0)" -gt 10240 ]; then
    : > "$_ERR_LOG"
fi
if [ -n "$STARTED_AT_FLAG" ]; then
    node "$PROJECT_DIR/.claude/skills/rd-auto/scripts/orchestrator.mjs" \
        record-usage \
        --role "$ROLE" \
        --trigger natural \
        --task "$TASK_DESC" \
        --started-at "$STARTED_AT" \
        --from-line "$FROM_LINE" \
        >/dev/null 2>>"$_ERR_LOG" || true
else
    node "$PROJECT_DIR/.claude/skills/rd-auto/scripts/orchestrator.mjs" \
        record-usage \
        --role "$ROLE" \
        --trigger natural \
        --task "$TASK_DESC" \
        --from-line "$FROM_LINE" \
        >/dev/null 2>>"$_ERR_LOG" || true
fi

exit 0
