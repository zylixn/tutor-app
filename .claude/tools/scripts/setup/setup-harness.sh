#!/usr/bin/env bash
# setup-harness.sh — rd_harness 框架安装与升级脚本
#
# 同时支持首次安装和版本升级：
#   - 框架核心文件：覆盖更新（同名覆盖、新增添加、目标独有保留）
#   - 项目状态文件：严格保护（CLAUDE.md、.harness/spec/{module}/、knowledge 等）
#
# 用法:
#   bash .claude/tools/scripts/setup/setup-harness.sh [目标路径]
#   bash .claude/tools/scripts/setup/setup-harness.sh                   # 默认安装到 ./ (当前目录)
#   bash .claude/tools/scripts/setup/setup-harness.sh /path/to/project  # 指定目标
#   bash .claude/tools/scripts/setup/setup-harness.sh --check            # 仅检查状态
#   bash .claude/tools/scripts/setup/setup-harness.sh --uninstall        # 移除框架文件（保留项目状态）
#
# 批量分发（可选）：
#   在 CWD 或脚本祖先目录放 .harness-projects（每行一个目标路径，# 起始为注释），
#   无参数执行时自动检测并循环给每个目标装框架；相对路径相对清单文件所在目录解析。
#   环境变量：HARNESS_PROJECTS_FILE 自定义清单名；HARNESS_BATCH_DRY_RUN=1 仅预览不安装。
#
# 前置条件: Node.js >= 20.19.0
#
# 外部安装入口:
#   curl -s http://192.168.118.247:49157/harness/install.sh | bash

set -euo pipefail

# ══════════════════════════════════════════════════════
# 常量
# ══════════════════════════════════════════════════════

NPM_SCOPE="@infra-ai"
NPM_REGISTRY="http://192.168.5.160/api/v4/projects/105/packages/npm/"
NPM_AUTH_TOKEN="glpat-v0ifVHmD0_Htav_042CC5G86MQp1OjMH.01.0w1pz0f0p"
NPM_PACKAGE="@infra-ai/rd-spec"
REQUIRED_NODE_MAJOR=20

# ══════════════════════════════════════════════════════
# Manifest 读取辅助函数
# ══════════════════════════════════════════════════════

# 从 manifest 读取目录列表
read_manifest_dirs() {
  local manifest="$1"
  grep '^d ' "$manifest" 2>/dev/null | sed 's/^d //' || true
}

# 从 manifest 读取文件列表
read_manifest_files() {
  local manifest="$1"
  grep '^f ' "$manifest" 2>/dev/null | sed 's/^f //' || true
}

# 检查路径是否在 manifest 中
in_manifest() {
  local path="$1"
  local manifest="$2"

  # 检查目录：路径属于某个 manifest 目录
  while IFS= read -r dir; do
    [[ "$path" == "$dir" || "$path" == "$dir"/* ]] && return 0
  done < <(read_manifest_dirs "$manifest")

  # 检查文件：精确匹配
  while IFS= read -r file; do
    [[ "$path" == "$file" ]] && return 0
  done < <(read_manifest_files "$manifest")

  return 1
}

# 颜色输出
GREEN='\033[0;32m' YELLOW='\033[0;33m' RED='\033[0;31m' DIM='\033[2m' BOLD='\033[1m' NC='\033[0m'
info()    { printf "${GREEN}[harness]${NC} %s\n" "$1"; }
warn()    { printf "${YELLOW}[harness]${NC} %s\n" "$1"; }
error()   { printf "${RED}[harness]${NC} %s\n" "$1" >&2; }
section() { printf "\n${BOLD}── %s ──${NC}\n" "$1"; }

# 安全复制：优先保留 mode/timestamps（-p），属主不可写时降级为普通复制。
# 跨平台：Linux root→user 场景 cp -p 会因无法保留 owner 而非零退出；
# Windows NTFS 没有 POSIX owner，cp -p 无副作用但安全起见也走降级。
safe_cp() {
  cp -p "$@" 2>/dev/null || cp "$@"
}

# ══════════════════════════════════════════════════════
# 工具函数
# ══════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_SOURCE="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# 框架源：脚本所在目录向上 4 级即为 zip 根或源仓根
resolve_source() {
  echo "$HARNESS_SOURCE"
}

get_npmrc_path() {
  if [ -n "${USERPROFILE:-}" ]; then
    echo "${USERPROFILE}/.npmrc"
  else
    echo "${HOME}/.npmrc"
  fi
}

# ══════════════════════════════════════════════════════
# Step 1: 检查 Node.js
# ══════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════
# Step 1: 路径安全检查（防止覆盖用户目录）
# ══════════════════════════════════════════════════════

check_symlinks() {
  local target="$1"

  # 检查关键目录是否为符号链接
  local has_symlink=0
  for dir in ".claude" ".claude/hooks" ".claude/reference" ".claude/skills"; do
    if [ -L "$target/$dir" ]; then
      local link_target
      link_target=$(readlink -f "$target/$dir" 2>/dev/null || echo "无法解析")
      warn "检测到符号链接: $target/$dir → $link_target"
      has_symlink=1
    fi
  done

  if [ "$has_symlink" -eq 1 ]; then
    warn "符号链接可能导致覆盖用户目录的设置文件"
    warn "建议移除符号链接或使用真实目录"
    # 非交互模式下跳过确认
    if [ -n "${SETUP_HARNESS_YES:-}" ]; then
      info "非交互模式，继续执行"
      return
    fi
    read -rp "是否继续？[y/N] " confirm
    [[ "$confirm" != [yY] ]] && { error "已取消"; exit 1; }
  fi
}

check_target_safety() {
  local target="$1"

  # 获取真实绝对路径（解析符号链接）
  local real_target
  real_target=$(cd "$target" && pwd -P 2>/dev/null || echo "$target")

  # 用户目录路径
  local user_home
  user_home=$(cd ~ && pwd -P 2>/dev/null || echo "$HOME")

  # 检查1: 目标是否直接是用户的 .claude 目录
  if [[ "$real_target" == "$user_home/.claude" ]]; then
    error "目标路径是用户的 .claude 目录: $real_target"
    error "为安全起见，拒绝操作用户目录。请使用项目目录。"
    error "项目目录应该是独立的业务工程目录，而非用户配置目录。"
    exit 1
  fi

  # 检查2: 目标是否在用户目录的 AppData 下（Windows）
  if [[ "$real_target" == "$user_home/AppData"* ]] || [[ "$real_target" == "$user_home\\AppData"* ]]; then
    error "目标路径在 AppData 下: $real_target"
    error "为安全起见，拒绝操作用户目录。请使用项目目录。"
    error "项目目录应该是独立的业务工程目录，而非用户配置目录。"
    exit 1
  fi

  # 检查3: 目标父目录是否是用户的 .claude（如 ~/.claude/hooks）
  local parent_dir
  parent_dir=$(dirname "$real_target")
  if [[ "$parent_dir" == "$user_home/.claude" ]]; then
    error "目标路径在用户的 .claude 子目录下: $real_target"
    error "为安全起见，拒绝操作用户目录。请使用项目目录。"
    error "项目目录应该是独立的业务工程目录，而非用户配置目录。"
    exit 1
  fi

  info "安装路径: $real_target ✓"
}

check_node() {
  if ! command -v node &>/dev/null; then
    error "未找到 Node.js（需要 >= ${REQUIRED_NODE_MAJOR}.19.0）"
    error "安装: https://nodejs.org/"
    return 1
  fi
  local major
  major=$(node -e "console.log(process.versions.node.split('.')[0])")
  if [ "$major" -lt "$REQUIRED_NODE_MAJOR" ]; then
    error "Node.js $(node -v) 版本过低（需要 >= ${REQUIRED_NODE_MAJOR}.19.0）"
    return 1
  fi
  info "Node.js $(node -v) ✓"
}

# ══════════════════════════════════════════════════════
# Step 2: 配置 npm scoped registry（幂等）
# ══════════════════════════════════════════════════════

setup_npmrc() {
  local npmrc scope_line
  npmrc="$(get_npmrc_path)"
  scope_line="${NPM_SCOPE}:registry=${NPM_REGISTRY}"

  [ ! -f "$npmrc" ] && touch "$npmrc"

  # 写入/更新 @infra-ai scoped registry
  if grep -qF "${NPM_SCOPE}:registry=" "$npmrc" 2>/dev/null; then
    local current
    current=$(grep -F "${NPM_SCOPE}:registry=" "$npmrc" | head -1)
    if [ "$current" = "$scope_line" ]; then
      info "npm registry 已配置 ✓"
    else
      local tmp
      tmp=$(mktemp)
      grep -vF "${NPM_SCOPE}:registry=" "$npmrc" > "$tmp" 2>/dev/null || true
      echo "$scope_line" >> "$tmp"
      cat "$tmp" > "$npmrc" && rm -f "$tmp"
      info "更新 npm registry → ${NPM_REGISTRY}"
    fi
  else
    echo "" >> "$npmrc"
    echo "$scope_line" >> "$npmrc"
    info "配置 npm registry → ${NPM_REGISTRY}"
  fi

  # 确保全局 registry 指向公共源（防止被误配到私有 registry 导致间接依赖 404）
  local default_registry="https://registry.npmmirror.com"
  if grep -qE '^registry=' "$npmrc" 2>/dev/null; then
    local current_registry
    current_registry=$(grep -E '^registry=' "$npmrc" | head -1)
    if echo "$current_registry" | grep -q "192.168.5.160"; then
      local tmp
      tmp=$(mktemp)
      grep -vE '^registry=' "$npmrc" > "$tmp" 2>/dev/null || true
      echo "registry=${default_registry}" >> "$tmp"
      cat "$tmp" > "$npmrc" && rm -f "$tmp"
      info "修正全局 registry → ${default_registry}"
    fi
  else
    echo "registry=${default_registry}" >> "$npmrc"
    info "配置全局 registry → ${default_registry}"
  fi

  # 写入 @inquirer scoped registry（公共 npmjs.org）
  local inquirer_scope="@inquirer:registry=https://registry.npmjs.org/"
  if ! grep -qF "@inquirer:registry=" "$npmrc" 2>/dev/null; then
    echo "$inquirer_scope" >> "$npmrc"
    info "配置 @inquirer registry → npmjs.org"
  fi

  # 写入 GitLab npm registry auth token
  local auth_key="//192.168.5.160/api/v4/projects/105/packages/npm/:_authToken"
  if ! grep -qF "$auth_key" "$npmrc" 2>/dev/null; then
    echo "${auth_key}=${NPM_AUTH_TOKEN}" >> "$npmrc"
    info "配置 GitLab npm auth token ✓"
  fi
}

# ══════════════════════════════════════════════════════
# Step 3: 安装 RD CLI（幂等）
# ══════════════════════════════════════════════════════

install_rd_cli() {
  if ! command -v rd &>/dev/null; then
    info "rd CLI 未安装，安装 ${NPM_PACKAGE}@latest ..."
    npm cache clean --force 2>/dev/null || true
    npm install -g "${NPM_PACKAGE}@latest" --force 2>&1 | tail -1
    local new_ver
    new_ver=$(rd --version 2>/dev/null || echo "unknown")
    info "rd ${new_ver} ✓"
    return
  fi

  local installed
  installed=$(rd --version 2>/dev/null || echo "")

  # 查询远程最新版本
  local latest
  latest=$(npm view "${NPM_PACKAGE}" version 2>/dev/null || echo "")

  if [ -n "$latest" ] && [ "$installed" = "$latest" ]; then
    info "rd ${installed} 已是最新 ✓"
    return
  fi

  if [ -n "$latest" ]; then
    info "rd ${installed} → ${latest}，升级中 ..."
  else
    info "rd ${installed}，无法查询远程版本，尝试升级 ..."
  fi
  npm cache clean --force 2>/dev/null || true
  npm install -g "${NPM_PACKAGE}@latest" --force 2>&1 | tail -1

  local new_ver
  new_ver=$(rd --version 2>/dev/null || echo "unknown")
  if [ "$installed" != "$new_ver" ]; then
    info "rd ${installed} → ${new_ver} ✓"
  else
    info "rd ${new_ver} ✓"
  fi
}

# ══════════════════════════════════════════════════════
# Step 4: rd init（仅在未初始化时执行）
# ══════════════════════════════════════════════════════

init_rd_project() {
  local target="$1"

  info "执行 rd init --tools claude --force ..."
  (cd "$target" && rd init --tools claude --force 2>&1) | tail -3
  info "rd init 完成 ✓"
}

# ══════════════════════════════════════════════════════
# 复制目录：先删后拷（删除目标后整体复制源）
# ══════════════════════════════════════════════════════
#
# 用 cp -R 一次性复制，替代曾经的纯 bash 递归 + 每文件 fork cp。
# 785 个文件的复制从 N 次 fork 降到 1 次，安装耗时从几十秒降到 1-2 秒。
#
# 权限保留：safe_cp -R 优先保留 mode + timestamps，属主不可写时降级为 cp -R。
# Windows NTFS 不存 +x 位，cp 保留的 mode 不可见，靠后续的 chmod -R +x 兜底
# （见 copy_core_files 末尾）。
#
# 隐藏文件：cp -R 默认复制 .dotfiles（GNU/BSD 行为一致），无需额外处理。
# 符号链接：源仓库没有符号链接，cp -R 默认跟随复制无副作用。
# dst_dir 不存在：cp -R src dst 把 src 内容复制成 dst（POSIX 行为）。

copy_dir_merge() {
  local src_dir="$1"
  local dst_dir="$2"

  [ ! -d "$src_dir" ] && return 0

  # Delete target first to remove stale files from renamed/removed framework assets.
  # cp -R needs dst to be absent for "src → dst" semantics; if dst exists, it
  # would copy src *into* dst (creating dst/src_name/) instead of replacing dst.
  rm -rf "$dst_dir"
  mkdir -p "$(dirname "$dst_dir")"
  safe_cp -R "$src_dir" "$dst_dir"
}

# ══════════════════════════════════════════════════════
# 纯 bash 递归不覆盖复制（仅补充缺失文件）
# ══════════════════════════════════════════════════════

copy_dir_no_overwrite() {
  local src_dir="$1"
  local dst_dir="$2"
  shift 2
  local _excludes=()
  [ $# -gt 0 ] && _excludes=("$@")

  [ ! -d "$src_dir" ] && return 0
  mkdir -p "$dst_dir"

  local item
  for item in "$src_dir"/* "$src_dir"/.[!.]*; do
    [ -e "$item" ] || continue
    local name
    name=$(basename "$item")
    local skip=false
    if [ ${#_excludes[@]} -gt 0 ]; then
      for exc in "${_excludes[@]}"; do
        [ "$name" = "$exc" ] && skip=true && break
      done
    fi
    $skip && continue
    local dst_item="$dst_dir/$name"

    if [ -d "$item" ]; then
      if [ ${#_excludes[@]} -gt 0 ]; then
        copy_dir_no_overwrite "$item" "$dst_item" "${_excludes[@]}"
      else
        copy_dir_no_overwrite "$item" "$dst_item"
      fi
    elif [ -f "$item" ]; then
      [ -f "$dst_item" ] || safe_cp "$item" "$dst_item"
    fi
  done
}

# ══════════════════════════════════════════════════════
# 残留清理：删除目标中已不存在于源 manifest 目录中的文件
# ══════════════════════════════════════════════════════

cleanup_obsolete_files() {
  local source="$1"
  local target="$2"
  local manifest="$source/.framework-manifest"
  local old_manifest="$target/.framework-manifest"

  [ ! -f "$manifest" ] && return 0

  local obsolete=()

  # 1) 清理旧 manifest 中有、但新 manifest 中已移除的 f 文件
  #    （文件路径迁移场景，如 .claude/.harness-version → .harness/.harness-version）
  if [ -f "$old_manifest" ]; then
    local new_manifest_files
    new_manifest_files=$(read_manifest_files "$manifest")
    while IFS= read -r old_file; do
      [ -z "$old_file" ] && continue
      # 目标中不存在则无需清理
      [ ! -f "$target/$old_file" ] && continue
      # 旧文件路径仍在新 manifest 的 f 列表中 → 跳过
      echo "$new_manifest_files" | grep -qxF "$old_file" && continue
      # 旧文件路径在新 manifest 的 d 目录内 → 跳过（由下面的目录扫描处理）
      in_manifest "$old_file" "$manifest" && continue
      # 确认源中也不存在该文件 → 列入清理
      obsolete+=("$old_file")
    done < <(read_manifest_files "$old_manifest")
  fi

  # 2) d 目录处理：copy_dir_merge 已改为先删后拷，无需额外扫描清理

  if [ ${#obsolete[@]} -eq 0 ]; then
    return 0
  fi

  for rel in "${obsolete[@]}"; do
    rm -f "$target/$rel"
  done

  # 清理空目录（从叶子向上删除）
  while IFS= read -r -d '' empty_dir; do
    rmdir "$empty_dir" 2>/dev/null || true
  done < <(find "$target" -mindepth 2 -type d -empty -print0 2>/dev/null | sort -rz)
}

# ══════════════════════════════════════════════════════
# 合并 .gitattributes：保留目标已有规则，补充框架缺少的
# ══════════════════════════════════════════════════════

merge_gitattributes() {
  local source="$1"
  local target="$2"
  local src_ga="$source/.gitattributes"
  local dst_ga="$target/.gitattributes"

  [ ! -f "$src_ga" ] && return 0

  if [ ! -f "$dst_ga" ]; then
    safe_cp "$src_ga" "$dst_ga"
    info "创建 .gitattributes ✓"
    return 0
  fi

  local added=0
  local tmp
  tmp=$(mktemp)
  safe_cp "$dst_ga" "$tmp"

  while IFS= read -r rule_line; do
    [[ "$rule_line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$rule_line" =~ ^# ]] && continue
    local pattern
    pattern=$(echo "$rule_line" | awk '{print $1}')
    [ -z "$pattern" ] && continue
    grep -qF "$pattern" "$tmp" && continue
    echo "$rule_line" >> "$tmp"
    added=$((added + 1))
  done < "$src_ga"

  if [ "$added" -gt 0 ]; then
    mv "$tmp" "$dst_ga"
    info "合并 .gitattributes（补充 ${added} 条规则） ✓"
  else
    rm -f "$tmp"
    info ".gitattributes 已包含全部框架规则 ✓"
  fi
}

# ══════════════════════════════════════════════════════
# 合并 .gitignore：保留目标已有规则，补充框架缺少的
# ══════════════════════════════════════════════════════

merge_gitignore() {
  local source="$1"
  local target="$2"
  local src_gi="$source/.gitignore"
  local dst_gi="$target/.gitignore"

  [ ! -f "$src_gi" ] && return 0

  if [ ! -f "$dst_gi" ]; then
    safe_cp "$src_gi" "$dst_gi"
    info "创建 .gitignore ✓"
  else
    local added=0
    local tmp
    tmp=$(mktemp)
    safe_cp "$dst_gi" "$tmp"

    while IFS= read -r rule_line; do
      [[ "$rule_line" =~ ^[[:space:]]*$ ]] && continue
      [[ "$rule_line" =~ ^# ]] && continue
      # 去除首尾空白后比较
      local trimmed
      trimmed=$(echo "$rule_line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      [ -z "$trimmed" ] && continue
      grep -qxF "$trimmed" "$tmp" && continue
      echo "$rule_line" >> "$tmp"
      added=$((added + 1))
    done < "$src_gi"

    if [ "$added" -gt 0 ]; then
      mv "$tmp" "$dst_gi"
      info "合并 .gitignore（补充 ${added} 条规则） ✓"
    else
      rm -f "$tmp"
      info ".gitignore 已包含全部框架规则 ✓"
    fi
  fi

  # 业务仓库专有规则（框架源仓库自身不需要）。
  # .harness/.harness-version 记录"本地已安装框架版本"，类似 package-lock.json
  # 的反向。如果提交到业务仓库，其他开发者 pull 后看到版本号已是最新，
  # 跑 --upgrade 会被跳过，但实际 .claude/ 没升级（业务仓库的 .claude/ 通常
  # 也 ignore，是安装产物）。所以让业务仓库各自跟踪本地版本，不跨开发者同步。
  # 框架源仓库（这里）自身继续提交 .harness-version，作为发布渠道的版本标记。
  local extra_rules=( '.harness/.harness-version' )
  local extra_added=0
  for rule in "${extra_rules[@]}"; do
    if ! grep -qxF "$rule" "$dst_gi" 2>/dev/null; then
      if [ "$extra_added" -eq 0 ]; then
        echo '' >> "$dst_gi"
        echo '# 业务仓库专有：本地框架安装状态（每个开发者各自跟踪，不跨开发者同步）' >> "$dst_gi"
      fi
      echo "$rule" >> "$dst_gi"
      extra_added=$((extra_added + 1))
    fi
  done
  if [ "$extra_added" -gt 0 ]; then
    info "已注入 ${extra_added} 条业务仓库专有 ignore 规则（.harness/.harness-version） ✓"
  fi
}

# ══════════════════════════════════════════════════════
# Step 5: 复制框架核心文件（覆盖更新 + 保护项目状态）
# ══════════════════════════════════════════════════════

copy_core_files() {
  local source="$1"
  local target="$2"
  local manifest="$source/.framework-manifest"

  if [ ! -f "$manifest" ]; then
    warn ".framework-manifest 不存在，无法安装"
    return 1
  fi

  info "读取 .framework-manifest ..."

  # 1) Manifest 目录：覆盖更新
  while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    if [ -d "$source/$dir" ]; then
      copy_dir_merge "$source/$dir" "$target/$dir"
    fi
  done < <(read_manifest_dirs "$manifest")

  # 2) Manifest 文件：覆盖更新（.gitattributes / .gitignore 除外，单独合并）
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    [[ "$file" == ".gitattributes" ]] && continue
    [[ "$file" == ".gitignore" ]] && continue
    if [ -f "$source/$file" ]; then
      mkdir -p "$(dirname "$target/$file")"
      safe_cp "$source/$file" "$target/$file"
    fi
  done < <(read_manifest_files "$manifest")


  # 3) .gitattributes / .gitignore：合并而非覆盖
  merge_gitattributes "$source" "$target"
  merge_gitignore "$source" "$target"

  # 4) .harness/ 目录结构：创建空目录 + 仅分发模板和 schema
  # .harness/ 不在 manifest 中（内容每个项目不同），手动处理
  # 源框架的 spec/specs, spec/changes, spec/archive, knowledge 等属于框架仓库自身，
  # 不应分发到目标项目——只在目标创建空目录供项目使用。

  # 4a) 创建项目运行时目录结构（空目录）
  mkdir -p "$target/.harness/spec/specs"
  mkdir -p "$target/.harness/spec/changes"
  mkdir -p "$target/.harness/spec/archive"
  mkdir -p "$target/.harness/knowledge"
  mkdir -p "$target/.harness/adr"
  mkdir -p "$target/.harness/eval"
  mkdir -p "$target/.harness/interfaces"
  mkdir -p "$target/.harness/ai-rules"
  mkdir -p "$target/.harness/memory"
  mkdir -p "$target/.harness/tasks"

  if [ -d "$source/.harness" ]; then
    # 4b) 仅分发 templates/ 和 shared-state/（模板和 schema 定义）
    copy_dir_no_overwrite "$source/.harness/templates" "$target/.harness/templates"
    copy_dir_no_overwrite "$source/.harness/shared-state" "$target/.harness/shared-state"

    # 4c) 分发 spec/config.yaml 模板（项目规格配置骨架）
    if [ -f "$source/.harness/spec/config.yaml" ]; then
      [ -f "$target/.harness/spec/config.yaml" ] || safe_cp "$source/.harness/spec/config.yaml" "$target/.harness/spec/config.yaml"
    fi

    # 4d) 清理旧框架 tasks 遗留
    local stale_tasks="ai-employee-auto-dispatch daily-report-ai-performance pipeline-state-v3 readme.txt rename-review-to-code-review"
    for item in $stale_tasks; do
      [ -e "$target/.harness/tasks/$item" ] && rm -rf "$target/.harness/tasks/$item"
    done
  fi

  # 4.5) 排除 manifest 中标记为 e 的文件（存在于源但不分发）
  while IFS= read -r ef; do
    [ -z "$ef" ] && continue
    [ -f "$target/$ef" ] && rm -f "$target/$ef"
  done < <(grep '^e ' "$manifest" | sed 's/^e //')

  # 5) 清理 manifest 中标记为 r 的文件或目录
  while IFS= read -r rf; do
    [ -z "$rf" ] && continue
    if [ -d "$target/$rf" ]; then
      rm -rf "$target/$rf"
    elif [ -f "$target/$rf" ]; then
      rm -f "$target/$rf"
    fi
  done < <(grep '^r ' "$manifest" | sed 's/^r //')

  # 6) 清理旧版本残留文件
  cleanup_obsolete_files "$source" "$target"

  # 7) 确保所有脚本文件有执行权限
  chmod -R +x "$target/.claude/" 2>/dev/null || true
  [ -f "$target/harness" ] && chmod +x "$target/harness"
}

# ══════════════════════════════════════════════════════
# Step 6.3: 安装 skill 运行时依赖（daily-report 的 ajv）
# node_modules 被 .gitignore 排除、不随 git clone 分发，需在此补装。
# best-effort：失败不阻断安装，仅告警并提示手动命令。
# ══════════════════════════════════════════════════════
install_skill_deps() {
  local target="$1"
  local scripts_dir="$target/.claude/skills/daily-report/scripts"

  [ -f "$scripts_dir/package.json" ] || return 0

  info "安装 daily-report 运行时依赖（ajv / ajv-formats）..."
  local install_ok=1
  if [ -f "$scripts_dir/package-lock.json" ]; then
    (cd "$scripts_dir" && npm ci --omit=dev --no-audit --no-fund) >/dev/null 2>&1 || install_ok=0
  else
    (cd "$scripts_dir" && npm install --omit=dev --no-audit --no-fund) >/dev/null 2>&1 || install_ok=0
  fi

  if [ "$install_ok" -eq 1 ] && [ -d "$scripts_dir/node_modules/ajv" ]; then
    info "daily-report 依赖安装完成 ✓"
  else
    warn "daily-report 依赖安装失败，日报/看板提交（kanban-update / submit-report）将不可用"
    warn "  请稍后手动执行: (cd .claude/skills/daily-report/scripts && npm ci --omit=dev)"
  fi
}

# ══════════════════════════════════════════════════════
# Step 5.5: 确保 .gitignore 包含 .gitlab-config 和 .claude/
# ══════════════════════════════════════════════════════

ensure_gitignore() {
  local target="$1"
  local gitignore="$target/.gitignore"

  [ ! -f "$gitignore" ] && return 0

  # 业务仓库专有的 ignore 规则。
  # 注意：不要 ignore 整个 .harness/ —— 里面的 spec/specs, spec/changes, knowledge,
  # adr, ai-rules 等是项目自身的资产（SPEC 文档、架构决策、知识库），必须提交到
  # 业务仓库。只 ignore .harness/.harness-version（本地已安装框架版本，每个开发者
  # 各自跟踪，跨开发者同步会导致"假升级"问题）。
  local _added=0
  for _entry in ".gitlab-config" ".claude/" ".framework-manifest" ".harness/.harness-version" ".codegraph"; do
    if ! grep -qxF "$_entry" "$gitignore" 2>/dev/null; then
      echo "$_entry" >> "$gitignore"
      _added=$((_added + 1))
    fi
  done
  [ "$_added" -gt 0 ] && info "已添加 ${_added} 个框架条目到 .gitignore"

  # 老业务仓库迁移：早期 setup-harness.sh 加的是 `.harness/` 整体 ignore，会让
  # spec/changes/knowledge 等项目资产无法提交。检测到这种过时规则时，替换为
  # 精细的 .harness/.harness-version，让项目资产重新可被提交。
  if grep -qxF '.harness/' "$gitignore" 2>/dev/null; then
    local tmp
    tmp=$(mktemp)
    # 删除 `.^harness/^` 整行，保留其他规则
    grep -vxF '.harness/' "$gitignore" > "$tmp" || true
    # 确保精细规则存在
    grep -qxF '.harness/.harness-version' "$tmp" || echo '.harness/.harness-version' >> "$tmp"
    mv "$tmp" "$gitignore"
    info "已将过时的 .harness/ 整体 ignore 替换为精细的 .harness/.harness-version ✓"
    warn ".harness/ 下的项目资产（spec/specs, knowledge, adr 等）现在可以提交了，请 review 并 git add 需要的文件"
  fi

  return 0
}

# ══════════════════════════════════════════════════════
# Step 5.6: 老业务仓库历史遗留清理
# 如果 .harness/.harness-version 在 ensure_gitignore 把 .harness/ 加入 ignore 之前
# 就已经被 commit，会出现"既被 ignore 又被跟踪"的矛盾状态。此时 A 用户升级提交
# 会让 B 用户 pull 后看到版本号但本地 .claude/ 没升级（因为 .claude/ 也 ignore）。
# 这个函数把已跟踪的 .harness/.harness-version 从 git 索引移除（保留工作区文件）。
# 框架源仓库自身（.gitignore 没 ignore 此文件）会自动跳过。
# ══════════════════════════════════════════════════════

untrack_harness_version_if_needed() {
  local target="$1"

  # 只在 git 仓库中处理（支持 submodule/worktree/子目录，-d .git 会漏掉这些）
  git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0

  # 只在 target 的 .gitignore 表达了 ignore 意图时处理。
  # 不能用 `git check-ignore` —— 对已跟踪文件它返回"未忽略"（git 标准行为：
  # .gitignore 不影响已跟踪文件）。所以直接 grep .gitignore 内容。
  # rd_harness 源仓库的 .gitignore 没有 .harness/ 规则，自动跳过。
  local gi="$target/.gitignore"
  [ ! -f "$gi" ] && return 0
  grep -qE '^\.harness/?\s*$|^\.harness/\.harness-version\s*$' "$gi" 2>/dev/null || return 0

  # "gitignore 表达了 ignore 意图 + 文件仍被跟踪" = 历史遗留状态。
  # untrack（--cached 保留工作区文件，下次 commit 后远程也 untrack）。
  if git -C "$target" ls-files --error-unmatch '.harness/.harness-version' >/dev/null 2>&1; then
    if git -C "$target" rm --cached '.harness/.harness-version' >/dev/null 2>&1; then
      info "已从 git 移除跟踪：.harness/.harness-version（本地文件保留） ✓"
      warn "请 commit 此变更，让远程仓库也 untrack（避免其他开发者 pull 后看到陈旧版本号）"
    fi
  fi
  return 0
}

# ══════════════════════════════════════════════════════
# Step 6: 确保 CLAUDE.md 包含启动检查段（幂等）
# ══════════════════════════════════════════════════════

ensure_claude_md() {
  local target="$1"
  local claude_md="$target/CLAUDE.md"
  local ref_md="$target/.claude/reference/CLAUDE.md"

  if [ -f "$claude_md" ]; then
    info "CLAUDE.md 已存在 ✓"
  else
    cat > "$claude_md" <<'MD_EOF'
# {仓库名}

> 框架规则在每次会话启动时自动加载，无需在此重复配置。
> 本文件用于添加项目专属的补充规则。
MD_EOF
    info "已创建 CLAUDE.md ✓"
  fi

  if [ ! -f "$ref_md" ]; then
    warn "缺少 .claude/reference/CLAUDE.md，会话启动时规则注入将失效"
  fi
}

# ══════════════════════════════════════════════════════
# Step 7: 安装 Git Hooks
# ══════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════
# Step 7.5: 禁止 Claude Code 自动升级（幂等）
# ══════════════════════════════════════════════════════

ensure_auto_updates_disabled() {
  local claude_json="$HOME/.claude/.claude.json"
  mkdir -p "$(dirname "$claude_json")"

  if [ ! -f "$claude_json" ]; then
    printf '{\n  "autoUpdates": false\n}\n' > "$claude_json"
    info "已创建 ~/.claude/.claude.json，autoUpdates: false ✓"
    return 0
  fi

  # 已禁用
  if grep -q '"autoUpdates"[[:space:]]*:[[:space:]]*false' "$claude_json" 2>/dev/null; then
    info "~/.claude/.claude.json autoUpdates 已禁用 ✓"
    return 0
  fi

  # 存在但为 true → 替换
  if grep -q '"autoUpdates"' "$claude_json" 2>/dev/null; then
    sed -i 's/"autoUpdates"[[:space:]]*:[[:space:]]*true/"autoUpdates": false/g' "$claude_json"
    info "已将 ~/.claude/.claude.json autoUpdates 设为 false ✓"
    return 0
  fi

  # 不存在该 key → 插入到文件头部
  sed -i '1s/{/{\n  "autoUpdates": false,/' "$claude_json"
  info "已在 ~/.claude/.claude.json 中添加 autoUpdates: false ✓"
}

# 解析 git hooks 目录（支持 submodule / worktree / subdirectory / core.hooksPath）。
# 用 git 原生 rev-parse --git-path hooks，比直接拼 $target/.git/hooks 更可靠。
# 成功：stdout 打印 hooks 目录绝对路径，return 0；失败（非 git 仓库等）：return 1。
resolve_git_hooks_dir() {
  local target="$1"
  local hooks_dir
  hooks_dir="$(git -C "$target" rev-parse --git-path hooks 2>/dev/null)" || return 1
  [ -z "$hooks_dir" ] && return 1
  # 归一化为绝对路径：不 cd 进返回路径（core.hooksPath 指向的目录可能尚未存在，
  # cd 失败会误判为非 git 仓库而跳过安装）。改为把相对路径锚定到 target。
  case "$hooks_dir" in
    /*) ;;
    *)  hooks_dir="$target/$hooks_dir" ;;
  esac
  printf '%s\n' "$hooks_dir"
  return 0
}

install_git_hooks() {
  local target="$1"
  local hook_script="$target/.claude/tools/scripts/setup/setup-hooks.sh"

  if [ ! -f "$hook_script" ]; then
    warn "setup-hooks.sh 不存在，跳过 hooks 安装"
    return 0
  fi

  # setup-hooks.sh trampoline 模式：硬编码 $PROJECT_ROOT/.git/hooks，
  # 不感知 core.hooksPath / submodule / worktree（trampoline 简化语义）
  bash "$hook_script" install 2>&1 | tail -3
}

# ══════════════════════════════════════════════════════
# Step 8: 检测项目语言，设置 CI 变量
# ══════════════════════════════════════════════════════

detect_language() {
  local target="$1"
  local ci_script="$target/.claude/tools/scripts/ci-setup-project.sh"

  # 委托 ci-setup-project.sh 检测语言并生成 .gitlab-ci.yml
  # 镜像地址和构建命令由 ci-templates/languages/*.yml 统一定义
  [ ! -f "$ci_script" ] && return 0

  # GitLab CI 依赖远程仓库，仅在 git 仓库中生成 .gitlab-ci.yml
  # 与 install_git_hooks 同一探测口径（git rev-parse --is-inside-work-tree）
  if ! git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    info "目标不是 git 仓库，跳过 .gitlab-ci.yml 生成"
    return 0
  fi

  if [ -f "$target/.gitlab-ci.yml" ]; then
    if grep -q "public_group/rd_harness" "$target/.gitlab-ci.yml" 2>/dev/null; then
      info ".gitlab-ci.yml 已引用 rd_harness 远程模板，跳过"
      return 0
    fi
    warn ".gitlab-ci.yml 未引用 harware 模板，覆盖更新"
  fi

  info "生成 .gitlab-ci.yml ..."
  (cd "$target" && bash "$ci_script" --force 2>&1) | tail -5
}

# ══════════════════════════════════════════════════════
# --check: 检查安装状态
# ══════════════════════════════════════════════════════

do_check() {
  local target="$1"

  printf "\n${BOLD}rd_harness 安装状态检查${NC}\n\n"

  # Node.js
  if command -v node &>/dev/null; then
    local major
    major=$(node -e "console.log(process.versions.node.split('.')[0])")
    if [ "$major" -ge "$REQUIRED_NODE_MAJOR" ]; then
      printf "  ${GREEN}✓${NC} Node.js:         %s\n" "$(node -v)"
    else
      printf "  ${RED}✗${NC} Node.js:         %s（需要 >= %s）\n" "$(node -v)" "${REQUIRED_NODE_MAJOR}"
    fi
  else
    printf "  ${RED}✗${NC} Node.js:         未安装\n"
  fi

  # .npmrc
  local npmrc
  npmrc="$(get_npmrc_path)"
  if [ -f "$npmrc" ] && grep -qF "${NPM_SCOPE}:registry=" "$npmrc" 2>/dev/null; then
    printf "  ${GREEN}✓${NC} npm registry:     已配置\n"
  else
    printf "  ${YELLOW}✗${NC} npm registry:     未配置\n"
  fi

  # rd CLI
  if command -v rd &>/dev/null; then
    printf "  ${GREEN}✓${NC} rd CLI:           %s\n" "$(rd --version 2>/dev/null)"
  else
    printf "  ${RED}✗${NC} rd CLI:           未安装\n"
  fi

  # daily-report 运行时依赖（ajv —— 不随 git clone 分发，需 setup 补装）
  local dr_scripts="$target/.claude/skills/daily-report/scripts"
  if [ -f "$dr_scripts/package.json" ]; then
    if [ -d "$dr_scripts/node_modules/ajv" ]; then
      printf "  ${GREEN}✓${NC} daily-report 依赖: ajv 已就绪\n"
    else
      printf "  ${YELLOW}✗${NC} daily-report 依赖: ajv 缺失（日报/看板提交不可用，重跑 setup 或手动 npm ci）\n"
    fi
  fi

  # 核心目录（从本地 manifest 读取）
  local manifest="$target/.framework-manifest"
  local dirs_to_check=()
  if [ -f "$manifest" ]; then
    while IFS= read -r d; do [ -n "$d" ] && dirs_to_check+=("$d"); done < <(read_manifest_dirs "$manifest")
  fi

  for dir in "${dirs_to_check[@]}" ".harness"; do
    if [ -d "$target/$dir" ]; then
      printf "  ${GREEN}✓${NC} %s/\n" "$dir"
    else
      printf "  ${YELLOW}✗${NC} %s/\n" "$dir"
    fi
  done

  # CLAUDE.md
  if [ -f "$target/.claude/reference/CLAUDE.md" ]; then
    printf "  ${GREEN}✓${NC} CLAUDE.md         已就绪\n"
  elif [ -f "$target/CLAUDE.md" ]; then
    printf "  ${GREEN}✓${NC} CLAUDE.md         已存在\n"
  else
    printf "  ${YELLOW}✗${NC} CLAUDE.md         不存在\n"
  fi

  # Tasks TTL: check for stale task directories (>30 days)
  local stale_count=0
  local tasks_dir="$target/.harness/tasks"
  if [ -d "$tasks_dir" ]; then
    local cutoff_epoch
    cutoff_epoch="$(date -d '30 days ago' +%s 2>/dev/null || echo 0)"
    if [ "$cutoff_epoch" -gt 0 ]; then
      for task_dir in "$tasks_dir"/*/; do
        [ -d "$task_dir" ] || continue
        local state_file="$task_dir/pipeline-state.json"
        [ -f "$state_file" ] || continue
        if [ "$(stat -c %Y "$state_file" 2>/dev/null)" -lt "$cutoff_epoch" ] 2>/dev/null; then
          stale_count=$((stale_count + 1))
        fi
      done
    fi
    if [ "$stale_count" -gt 0 ]; then
      printf "  ${YELLOW}!${NC} Tasks TTL:         %d 个超过30天的任务目录可清理\n" "$stale_count"
    else
      printf "  ${GREEN}✓${NC} Tasks TTL:         无过期任务\n"
    fi
  fi

  # Hooks
  local hooks_dir
  if hooks_dir="$(resolve_git_hooks_dir "$target")" && [ -n "$hooks_dir" ]; then
    if [ -f "$hooks_dir/commit-msg" ]; then
      printf "  ${GREEN}✓${NC} git hooks        已安装\n"
    else
      printf "  ${YELLOW}✗${NC} git hooks        未安装\n"
    fi
  else
    printf "  ${DIM}○${NC} git hooks:        非 git 仓库\n"
  fi

  # 版本（读 .harness/.harness-version）
  # rd_harness 框架与 npm 上的 rd CLI 是独立发布、版本号不同步的，不做对比。
  if [ -f "$target/.harness/.harness-version" ]; then
    local harness_ver
    harness_ver=$(cat "$target/.harness/.harness-version")
    printf "  ${GREEN}✓${NC} 框架版本:         %s\n" "$harness_ver"
  fi

  # .gitattributes
  if [ -f "$target/.gitattributes" ]; then
    printf "  ${GREEN}✓${NC} .gitattributes\n"
  else
    printf "  ${YELLOW}✗${NC} .gitattributes    未配置\n"
  fi

  echo ""
}

# ══════════════════════════════════════════════════════
# --uninstall: 移除框架文件（保留项目状态）
# ══════════════════════════════════════════════════════

do_uninstall() {
  local target="$1"
  local manifest="$target/.framework-manifest"

  printf "\n${YELLOW}将移除以下框架文件（项目状态不受影响）:${NC}\n\n"

  local to_remove=()
  if [ -f "$manifest" ]; then
    while IFS= read -r dir; do
      [ -z "$dir" ] && continue
      [ -d "$target/$dir" ] && to_remove+=("$dir/")
    done < <(read_manifest_dirs "$manifest")
    while IFS= read -r file; do
      [ -z "$file" ] && continue
      [ -f "$target/$file" ] && to_remove+=("$file")
    done < <(read_manifest_files "$manifest")
  fi

  if [ ${#to_remove[@]} -eq 0 ]; then
    info "未发现框架文件，无需移除"
    return 0
  fi

  printf "  %s\n" "${to_remove[@]}"
  printf "\n"

  # 非交互模式跳过确认
  if [ -z "${SETUP_HARNESS_YES:-}" ]; then
    read -rp "确认移除？[y/N] " confirm
    [[ "$confirm" != [yY] ]] && { info "已取消"; return 0; }
  fi

  for item in "${to_remove[@]}"; do
    if [ -d "$target/$item" ]; then
      rm -rf "$target/$item"
    elif [ -f "$target/$item" ]; then
      rm -f "$target/$item"
    fi
  done

  # 移除 .npmrc scoped registry
  local npmrc
  npmrc="$(get_npmrc_path)"
  if [ -f "$npmrc" ]; then
    local tmp
    tmp=$(mktemp)
    grep -vF "${NPM_SCOPE}:registry=" "$npmrc" | grep -vF "@inquirer:registry=" > "$tmp" 2>/dev/null || true
    cat "$tmp" > "$npmrc" && rm -f "$tmp"
    info "已移除 .npmrc scoped registry"
  fi

  info "框架文件已移除（CLAUDE.md、.harness/spec/ 等项目状态已保留）"
}

# ══════════════════════════════════════════════════════
# 主流程
# ══════════════════════════════════════════════════════

do_install() {
  local target="$1"

  printf "\n${BOLD}rd_harness 安装 → %s${NC}\n" "$(cd "$target" && pwd)"

  # Step 0: 路径安全检查
  section "路径安全检查"
  check_target_safety "$target"
  check_symlinks "$target"

  # Step 1
  section "检查 Node.js"
  check_node

  # Step 2
  section "配置 npm registry"
  setup_npmrc

  # Step 3
  section "安装 RD CLI"
  install_rd_cli

  # 定位框架源
  local source
  source="$(resolve_source)"
  info "框架源: $source"

  # Step 5
  section "初始化 RD 项目"
  init_rd_project "$target"

  # Step 6
  section "复制框架核心文件"
  copy_core_files "$source" "$target"

  # Step 6
  ensure_gitignore "$target"

  # Step 6.3: skill 运行时依赖（best-effort，不阻断安装）
  section "安装 Skill 运行时依赖"
  install_skill_deps "$target"

  # Step 6.1: 老业务仓库历史遗留 untrack
  untrack_harness_version_if_needed "$target"

  # Step 7
  section "检查 CLAUDE.md"
  ensure_claude_md "$target"

  # Step 7.5
  section "配置 Claude Code"
  ensure_auto_updates_disabled

  # Step 8
  section "安装 Git Hooks"
  install_git_hooks "$target"

  # Step 9（best-effort，不阻断安装）
  section "生成 CI 配置"
  detect_language "$target" || warn "CI 配置生成失败，不影响框架功能"

  # 完成：清除源仓库带入的 integrity-state，避免目标项目被 TAMPERED 状态锁死
  rm -f "$target/.claude/.integrity-state"
  local ver
  ver=$(cat "$target/.harness/.harness-version" 2>/dev/null || echo "unknown")
  printf "\n${GREEN}${BOLD}安装完成 ✓${NC}  rd_harness ${ver}\n"
  printf "${DIM}可用命令: /rd:explore /rd:propose /rd:apply /rd:archive${NC}\n\n"
}

# ══════════════════════════════════════════════════════
# 批量分发模式（.harness-projects 触发）
# ══════════════════════════════════════════════════════

# 查找 .harness-projects：CWD 优先 + 脚本祖先链兜底
# 可用 HARNESS_PROJECTS_FILE 覆盖文件名
find_projects_file() {
  local fname="${HARNESS_PROJECTS_FILE:-.harness-projects}"
  if [ -f "./$fname" ]; then
    readlink -f "./$fname"
    return 0
  fi
  local dir="$SCRIPT_DIR"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/$fname" ]; then
      readlink -f "$dir/$fname"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# 轻量安装：仅 hooks + CI 模板（批量分发专用）
# 不装 CLAUDE.md / skills / commands / rules / reference / agents / workflows / .harness/ / RD CLI 等
do_install_lite() {
  local target="$1"
  local source

  printf "\n${BOLD}rd_harness 轻量安装 → %s${NC}\n" "$(cd "$target" && pwd)"

  section "路径安全检查"
  check_target_safety "$target"
  check_symlinks "$target"

  source="$(resolve_source)"
  info "框架源: $source"

  section "复制 hooks + CI 模板（精简）"
  mkdir -p "$target/.claude/hooks" "$target/.claude/tools/scripts/setup" "$target/.claude/ci-templates"

  # hook 源（trampoline 调用目标）
  if [ -d "$source/.claude/hooks/git" ]; then
    rm -rf "$target/.claude/hooks/git"
    cp -rp "$source/.claude/hooks/git" "$target/.claude/hooks/git"
    info "✓ .claude/hooks/git/"
  else
    warn "源 .claude/hooks/git/ 不存在，hooks 将无法工作"
  fi

  # setup-hooks.sh（install_git_hooks 调用）
  if [ -f "$source/.claude/tools/scripts/setup/setup-hooks.sh" ]; then
    cp -p "$source/.claude/tools/scripts/setup/setup-hooks.sh" "$target/.claude/tools/scripts/setup/setup-hooks.sh"
    chmod +x "$target/.claude/tools/scripts/setup/setup-hooks.sh"
    info "✓ setup-hooks.sh"
  fi

  # ci-setup-project.sh（detect_language 调用）
  if [ -f "$source/.claude/tools/scripts/ci-setup-project.sh" ]; then
    cp -p "$source/.claude/tools/scripts/ci-setup-project.sh" "$target/.claude/tools/scripts/ci-setup-project.sh"
    chmod +x "$target/.claude/tools/scripts/ci-setup-project.sh"
    info "✓ ci-setup-project.sh"
  fi

  # CI 模板源
  if [ -d "$source/.claude/ci-templates" ]; then
    rm -rf "$target/.claude/ci-templates"
    cp -rp "$source/.claude/ci-templates" "$target/.claude/ci-templates"
    info "✓ .claude/ci-templates/"
  fi

  # .gitattributes / .gitignore 合并（让目标项目正确忽略框架文件）
  merge_gitattributes "$source" "$target"
  merge_gitignore "$source" "$target"

  section "安装 Git Hooks"
  install_git_hooks "$target"

  section "生成 CI 配置"
  detect_language "$target" || warn "CI 配置生成失败"

  rm -f "$target/.claude/.integrity-state"

  printf "\n${GREEN}${BOLD}轻量安装完成 ✓${NC}（仅 hooks + CI 模板）\n\n"
}

# 批量分发：循环读 .harness-projects，对每个目标调 do_install_lite
# 相对路径相对于 .harness-projects 所在目录解析
# HARNESS_BATCH_DRY_RUN=1 时只打印不真实安装（测试/预览用）
run_batch_dispatch() {
  local projects_file="$1"
  local projects_dir
  projects_dir="$(cd "$(dirname "$projects_file")" && pwd)"

  section "批量分发模式（清单：$projects_file）"

  local total=0 failed=0 skipped=0
  local raw target

  while IFS= read -r raw || [ -n "$raw" ]; do
    case "$raw" in
      ''|\#*|\;*) continue ;;
    esac
    raw="${raw#"${raw%%[![:space:]]*}"}"
    raw="${raw%"${raw##*[![:space:]]}"}"
    [ -z "$raw" ] && continue

    case "$raw" in
      /*) target="$raw" ;;
      *)  target="$projects_dir/$raw" ;;
    esac

    total=$((total + 1))

    if [ ! -d "$target" ]; then
      warn "跳过（路径不存在）：$raw"
      skipped=$((skipped + 1))
      continue
    fi

    if [ "${HARNESS_BATCH_DRY_RUN:-}" = "1" ]; then
      info "→ [$total] [DRY-RUN] $target"
    else
      info "→ [$total] 轻量安装到 $target"
      if do_install_lite "$target"; then
        :
      else
        warn "  ✗ 失败（继续）"
        failed=$((failed + 1))
      fi
    fi
  done < "$projects_file"

  section "批量分发汇总"
  info "总计 $total  成功 $((total - failed - skipped))  失败 $failed  跳过 $skipped"

  [ "$failed" -gt 0 ] && return 1 || return 0
}

# 主入口预检：检测 .harness-projects 是否存在，存在则进入批量分发
# - 显式子命令（--check/--uninstall/--help）→ 跳过，走原 case
# - 其他情况（无参数 / TARGET 参数 / install.sh 透传）→ 找到清单就批量
# - 批量分发前先给 CWD（或显式 TARGET）跑完整 do_install（主目录完整安装语义）
maybe_batch_dispatch() {
  case "${1:-}" in
    --check|--uninstall|--help|-h) return 0 ;;
  esac

  local projects_file
  if projects_file="$(find_projects_file 2>/dev/null)"; then
    # 批量分发前给主目录（CWD 或显式 TARGET）跑完整 do_install
    if [ "${HARNESS_BATCH_DRY_RUN:-}" != "1" ]; then
      local target_abs
      if [ -n "${1:-}" ] && [ -d "$1" ]; then
        target_abs="$(cd "$1" && pwd)"
      else
        target_abs="$(pwd)"
      fi
      if ! do_install "$target_abs"; then
        warn "主目录完整安装失败，继续批量分发"
      fi
    fi
    run_batch_dispatch "$projects_file"
    exit $?
  fi
  return 0
}

# ── 入口 ──────────────────────────────────────────────

TARGET="."

maybe_batch_dispatch "$@"

case "${1:-}" in
  --check)
    TARGET="${2:-.}"
    do_check "$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")"
    ;;
  --uninstall)
    TARGET="${2:-.}"
    do_uninstall "$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")"
    ;;
  --help|-h)
    echo "rd_harness 一键安装脚本"
    echo ""
    echo "用法:"
    echo "  bash $0 [目标路径]          # 安装（默认当前目录）"
    echo "  bash $0 --check [路径]      # 检查状态"
    echo "  bash $0 --uninstall [路径]   # 移除框架文件"
    echo "  bash $0 --help              # 帮助"
    echo ""
    echo "幂等: 框架文件覆盖更新，项目状态严格保护。"
    ;;
  *)
    if [ -n "${1:-}" ] && [ -d "$1" ]; then
      TARGET="$1"
    elif [ -n "${1:-}" ]; then
      error "目标路径不存在: $1"
      exit 1
    fi
    do_install "$(cd "$TARGET" && pwd)"
    ;;
esac
