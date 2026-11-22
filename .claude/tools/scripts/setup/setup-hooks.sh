#!/usr/bin/env bash
# setup-hooks.sh — AI Git 提交规范 Hook 部署脚本（纯 bash，零依赖）
# 规范文档: .claude/rules/ai-git-commit-spec.md
#
# 用法:
#   bash .claude/tools/scripts/setup/setup-hooks.sh          # 安装
#   bash .claude/tools/scripts/setup/setup-hooks.sh --remove # 移除
#   bash .claude/tools/scripts/setup/setup-hooks.sh --check  # 检查状态

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
HOOKS_SRC="$PROJECT_ROOT/.claude/hooks/git"
GIT_HOOKS_DIR="$PROJECT_ROOT/.git/hooks"

TRAMPOLINE_MARKER="Auto-generated hook trampoline"

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { printf "${GREEN}[setup-hooks]${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}[setup-hooks]${NC} %s\n" "$1"; }
error() { printf "${RED}[setup-hooks]${NC} %s\n" "$1" >&2; }

# ============================================================
# 安装单个 hook
# ============================================================
install_single_hook() {
  local hook_name="$1"
  local hook_src="$HOOKS_SRC/$hook_name"
  local target="$GIT_HOOKS_DIR/$hook_name"

  if [ ! -f "$hook_src" ]; then
    warn "hook 脚本不存在，跳过: $hook_src"
    return
  fi

  # 已是 trampoline 则跳过
  if [ -f "$target" ] && grep -q "$TRAMPOLINE_MARKER" "$target" 2>/dev/null; then
    info "$hook_name hook 已是 trampoline，跳过"
    return
  fi

  # 备份已有 hook（符号链接或非 trampoline 文件）
  if [ -f "$target" ] || [ -L "$target" ]; then
    local backup="${target}.bak.$(date +%Y%m%d%H%M%S)"
    cp "$target" "$backup" 2>/dev/null || true
    warn "已备份现有 $hook_name → $(basename "$backup")"
  fi

  rm -f "$target"

  # trampoline: 通过 .git/hooks → ../../ 相对路径定位项目根
  cat > "$target" <<TRAMPOLINE
#!/usr/bin/env bash
# $TRAMPOLINE_MARKER — delegates to .claude/hooks/git/${hook_name}
HOOK_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
PROJECT_ROOT="\$(cd "\$HOOK_DIR/../.." && pwd)"
exec "\$PROJECT_ROOT/.claude/hooks/git/${hook_name}" "\$@"
TRAMPOLINE

  chmod +x "$target"
  chmod +x "$hook_src" 2>/dev/null || true
  info "$hook_name hook (trampoline)"
}

# ============================================================
# 安装所有 hooks
# ============================================================
install_hooks() {
  if [ ! -d "$GIT_HOOKS_DIR" ]; then
    error ".git/hooks/ 目录不存在，请确认当前目录是 git 仓库"
    exit 1
  fi

  # 安装客户端 hooks
  install_single_hook "pre-commit"
  install_single_hook "commit-msg"
  install_single_hook "pre-push"

  info "客户端 hooks 部署完成"
}

# ============================================================
# 移除
# ============================================================
remove_hooks() {
  for hook_name in pre-commit commit-msg pre-push; do
    local target="$GIT_HOOKS_DIR/$hook_name"
    if [ -L "$target" ] || [ -f "$target" ]; then
      rm -f "$target"
      info "已移除 $hook_name hook"
    fi
  done

  info "hooks 已移除"
}

# ============================================================
# 检查状态
# ============================================================
check_status() {
  echo ""
  echo "AI Git 提交规范 Hook 状态检查"
  echo "================================"

  for hook_name in pre-commit commit-msg pre-push; do
    local target="$GIT_HOOKS_DIR/$hook_name"
    local src="$HOOKS_SRC/$hook_name"

    if [ -f "$target" ] && grep -q "$TRAMPOLINE_MARKER" "$target" 2>/dev/null; then
      info "$hook_name hook: 已安装（trampoline）"
    elif [ -L "$target" ]; then
      info "$hook_name hook: 已安装（符号链接 → $(readlink "$target")）"
      warn "  建议重新运行 setup-hooks.sh 迁移到 trampoline 模式"
    elif [ -f "$target" ]; then
      info "$hook_name hook: 已安装（复制模式）"
      warn "  建议重新运行 setup-hooks.sh 迁移到 trampoline 模式"
    else
      error "$hook_name hook: 未安装"
    fi

    [ -f "$src" ] && info "  源脚本: $src" || error "  源脚本不存在: $src"
  done
  echo ""
}

# ============================================================
# 主入口
# ============================================================
case "${1:-install}" in
  --remove|-r)
    remove_hooks
    ;;
  --check|-c|status)
    check_status
    ;;
  install|--install|-i)
    install_hooks
    echo ""
    info "部署完成！trampoline 模式，macOS/Linux/Windows 通用"
    info "  查看状态: bash .claude/tools/scripts/setup/setup-hooks.sh --check"
    ;;
  *)
    echo "用法: bash .claude/tools/scripts/setup/setup-hooks.sh [--remove|--check|install]"
    exit 1
    ;;
esac