#!/bin/bash
# push-demo.sh — 将 AI 员工任务演示数据推送到 Prometheus Pushgateway
# 每个员工作为一个独立 instance 推送，匹配真实数据模型
#
# 用法:
#   bash push-demo.sh                           # 推送到默认 Pushgateway
#   bash push-demo.sh http://192.168.5.114:9091 # 推送到指定 Pushgateway
#   bash push-demo.sh --dry-run                 # 仅打印，不推送

set -euo pipefail

PUSHGATEWAY="${1:-http://192.168.5.114:9091}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  PUSHGATEWAY="http://192.168.5.114:9091"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
METRICS_FILE="$SCRIPT_DIR/prometheus-metrics.txt"
JOB_NAME="ai_dispatch"

if [[ ! -f "$METRICS_FILE" ]]; then
  echo "❌ 找不到指标文件: $METRICS_FILE"
  exit 1
fi

echo "========================================"
echo "  AI 员工任务 Grafana 演示数据推送"
echo "========================================"
echo "  Pushgateway: $PUSHGATEWAY"
echo "  模式:        $([ "$DRY_RUN" = true ] && echo 'DRY RUN (仅打印)' || echo '推送')"
echo "========================================"

# 5名员工,每人独立 instance (demo- 前缀避免与真实数据冲突)
EMPLOYEES=(
  "demo-wangzk"
  "demo-zhoucw"
  "demo-lisi"
  "demo-zhaowu"
  "demo-sunqi"
)

# 从完整指标文件中提取指定 instance 的指标
extract_instance_metrics() {
  local inst="$1"
  local file="$2"
  # 提取: TYPE声明行 + 该instance的数据行 (包括无instance的全局行如 last_push_timestamp)
  grep -E "^# TYPE|^[a-z_]+.*instance=\"${inst}\"" "$file" | \
    grep -v '^$'
}

TOTAL_METRICS=0

for emp in "${EMPLOYEES[@]}"; do
  BODY=$(extract_instance_metrics "$emp" "$METRICS_FILE")
  LINE_COUNT=$(echo "$BODY" | grep -c . || true)

  if [[ "$DRY_RUN" == true ]]; then
    echo ""
    echo "--- $emp ($LINE_COUNT lines) ---"
    echo "$BODY" | head -10
    echo "  ..."
    continue
  fi

  # POST 到带 instance 的 URL: /metrics/job/<job>/instance/<emp>
  URL="$PUSHGATEWAY/metrics/job/$JOB_NAME/instance/$emp"
  HTTP_CODE=$(printf '%s\n' "$BODY" | curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary @- "$URL" 2>/dev/null || echo "000")

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "202" ]]; then
    echo "  ✅ $emp — HTTP $HTTP_CODE ($LINE_COUNT lines)"
    TOTAL_METRICS=$((TOTAL_METRICS + LINE_COUNT))
  else
    echo "  ❌ $emp — HTTP $HTTP_CODE"
  fi
done

# 推送全局指标 (无 instance 标签的，如 last_push_timestamp)
GLOBAL=$(grep -E '^# TYPE|^[a-z_]' "$METRICS_FILE" | grep -v 'instance=' | grep -v '^$' | grep -v '^# =')
if [[ -n "$GLOBAL" && "$DRY_RUN" != true ]]; then
  URL="$PUSHGATEWAY/metrics/job/$JOB_NAME/instance/demo-global"
  HTTP_CODE=$(printf '%s\n' "$GLOBAL" | curl -s -o /dev/null -w '%{http_code}' -X POST --data-binary @- "$URL" 2>/dev/null || echo "000")
  LINE_COUNT=$(echo "$GLOBAL" | grep -c . || true)
  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "202" ]]; then
    echo "  ✅ global — HTTP $HTTP_CODE ($LINE_COUNT lines)"
  else
    echo "  ❌ global — HTTP $HTTP_CODE"
  fi
fi

echo ""
echo "========================================"
echo "  推送完成 (5 名员工, $TOTAL_METRICS 行指标)"
if [[ "$DRY_RUN" != true ]]; then
  echo "  Grafana: http://192.168.5.114:3000/d/ai-employee-status"
fi
echo "========================================"
