#!/usr/bin/env bash
# SessionStart hook: 框架完整性校验 + 上下文注入
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# ── 框架版本升级检测 ──
# salt 嵌入框架文件（session-start.sh 受保护），防止伪造 .harness-version
SIGN_SALT="rd-harness-v2"
MARKER_FILE="$PROJECT_DIR/.claude/.pending-upgrade-msg"

REMOTE_VERSION_FILE=$(curl -s --connect-timeout 3 \
  "http://192.168.5.160/public_group/rd_harness/-/raw/main/.harness/.harness-version" 2>/dev/null || echo "")

LOCAL_VERSION=$(cat "$PROJECT_DIR/.harness/.harness-version" 2>/dev/null | head -1 || echo "0")
LOCAL_SIG=$(sed -n '3p' "$PROJECT_DIR/.harness/.harness-version" 2>/dev/null || echo "")
EXPECTED_SIG=$(echo -n "${LOCAL_VERSION}${SIGN_SALT}" | sha256sum | cut -c1-8)

if [ "$LOCAL_SIG" != "$EXPECTED_SIG" ]; then
  # 签名不匹配 = 文件被篡改
  printf "rd_harness 必须升级: 版本文件被篡改 — 运行 /upgrade-harness 升级框架\n" > "$MARKER_FILE"
elif [ -n "$REMOTE_VERSION_FILE" ]; then
  REMOTE_VERSION=$(echo "$REMOTE_VERSION_FILE" | head -1)
  REMOTE_FORCE=$(echo "$REMOTE_VERSION_FILE" | head -2 | tail -1)

  if [ "$LOCAL_VERSION" != "$REMOTE_VERSION" ]; then
    if [ "$REMOTE_FORCE" = "force" ]; then
      SEVERITY="必须升级"
    else
      SEVERITY="新版本可用"
    fi
    printf "rd_harness %s: 远程 %s / 当前 %s — 运行 /upgrade-harness 升级框架\n" \
      "$SEVERITY" "$REMOTE_VERSION" "$LOCAL_VERSION" > "$MARKER_FILE"
  else
    rm -f "$MARKER_FILE" 2>/dev/null || true
  fi
else
  rm -f "$MARKER_FILE" 2>/dev/null || true
fi

# ── 清理跨 session 不应保留的临时标记 ──
# .framework-edit: session 级框架编辑旁路，新 session 必须重新授权
# .push-challenge / .push-approved: push 审批挑战码，绑定上一个 session 的 HEAD，已失效
rm -f .claude/.framework-edit 2>/dev/null || true
rm -f .claude/.push-challenge 2>/dev/null || true
rm -f .claude/.push-approved 2>/dev/null || true

# ── 注入框架级 CLAUDE.md 到 AI 上下文 ──
CLAUDE_MD="$PROJECT_DIR/.claude/reference/CLAUDE.md"
if [ -f "$CLAUDE_MD" ]; then
    echo ""
    cat "$CLAUDE_MD"
fi

# ── 项目记忆：同步到 Claude Code 内置记忆 + 注入上下文 ──
MEMORY_DIR="$PROJECT_DIR/.harness/memory"
MEMORY_MD="$MEMORY_DIR/MEMORY.md"

if [ -d "$MEMORY_DIR" ]; then
    # 1) 同步 .harness/memory/ → Claude Code 内置记忆目录
    #    路径编码规则: D:\repos\aios\rd_harness → D--repos-aios-rd-harness
    _ABS_ROOT="$(cd "$PROJECT_DIR" && pwd)"
    # 兼容 Windows MSYS: 优先获取 Windows 风格绝对路径
    if command -v cygpath &>/dev/null; then
        _ABS_ROOT="$(cygpath -m "$_ABS_ROOT")"
    fi
    _ENCODED="$(echo "$_ABS_ROOT" | sed 's/[:\\\/_]/-/g')"
    _CLAUDE_MEM_DIR="$HOME/.claude/projects/${_ENCODED}/memory"

    mkdir -p "$_CLAUDE_MEM_DIR" 2>/dev/null || true

    # 同步记忆文件（项目侧更新时覆盖内置侧）
    _synced=0
    for src_file in "$MEMORY_DIR"/*.md; do
        [ -f "$src_file" ] || continue
        _fname="$(basename "$src_file")"
        _dst_file="$_CLAUDE_MEM_DIR/$_fname"
        if [ ! -f "$_dst_file" ]; then
            cp "$src_file" "$_dst_file"
            _synced=$((_synced + 1))
        else
            # 项目侧更新时覆盖
            _src_ts=$(stat -c %Y "$src_file" 2>/dev/null || stat -f %m "$src_file" 2>/dev/null || echo 0)
            _dst_ts=$(stat -c %Y "$_dst_file" 2>/dev/null || stat -f %m "$_dst_file" 2>/dev/null || echo 0)
            if [ "$_src_ts" -gt "$_dst_ts" ]; then
                cp "$src_file" "$_dst_file"
                _synced=$((_synced + 1))
            fi
        fi
    done

    # 合并项目 MEMORY.md 索引条目到内置 MEMORY.md（追加缺失条目，不删除个人记忆）
    if [ -f "$MEMORY_MD" ]; then
        _CLAUDE_MEM_INDEX="$_CLAUDE_MEM_DIR/MEMORY.md"
        if [ ! -f "$_CLAUDE_MEM_INDEX" ]; then
            cp "$MEMORY_MD" "$_CLAUDE_MEM_INDEX"
        else
            while IFS= read -r line; do
                # 提取链接中的文件名作为唯一标识
                _key="$(echo "$line" | grep -oP '(?<=\()[\w-]+\.md(?=\))' 2>/dev/null || true)"
                [ -z "$_key" ] && continue
                if ! grep -q "$_key" "$_CLAUDE_MEM_INDEX" 2>/dev/null; then
                    echo "$line" >> "$_CLAUDE_MEM_INDEX"
                    _synced=$((_synced + 1))
                fi
            done < "$MEMORY_MD"
        fi
    fi

    # 2) 注入 MEMORY.md 索引（按需加载记忆内容）
    # 优化：只注入索引，不注入所有记忆文件内容，减少上下文消耗
    # 记忆文件将在需要时通过 Read 工具按需加载
    if [ -f "$MEMORY_MD" ]; then
        echo ""
        echo "# 项目记忆索引（可通过 Read 工具查看详细内容）"
        cat "$MEMORY_MD"
    fi
fi

exit 0