#!/usr/bin/env bash
# hook-json-helper.sh — JSON utilities for Claude Code hooks
# Replaces jq with sed (fast path) and node (full path)
# Compatible with Linux, macOS, and Windows (Git Bash)
# Usage: source "$(dirname "$0")/hook-json-helper.sh"

# ── Cross-platform HOME fallback ──
# Git Bash on Windows sets $HOME, but native cmd/PowerShell does not.
# os.homedir() reads $HOME first on POSIX; must delete it to force OS-level lookup.
if [ -z "${HOME:-}" ]; then
    HOME="$(node -e "delete process.env.HOME;process.stdout.write(require('os').homedir())" 2>/dev/null || echo "/tmp")"
    export HOME
fi

# Fast path: extract simple single-line string value (sed-based)
# Works for tool_name, short commands, file_path, etc.
# Returns empty string if key not found.
_jq_val() {
    printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1
}

# Full path: extract value with proper JSON unescaping (node-based)
# Handles multiline values, escaped quotes, etc.
# Checks both top-level and tool_input-level for the key.
_jq_raw() {
    printf '%s' "$1" | node -e "
        let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
            try{
                const o=JSON.parse(d);
                let v=o['$2'];
                if(v==null&&o.tool_input)v=o.tool_input['$2'];
                if(v!=null)process.stdout.write(String(v));
            }catch(e){}
        })
    " 2>/dev/null || true
}

# Output PreToolUse deny response (handles JSON escaping)
hook_deny() {
    local r="$1" e=""
    e="${r//\\/\\\\}"
    e="${e//\"/\\\"}"
    e="${e//$'\n'/\\n}"
    e="${e//$'\r'/\\r}"
    e="${e//$'\t'/\\t}"
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$e"
}

# Output PreToolUse allow response
hook_allow() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
}
