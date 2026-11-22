#!/usr/bin/env bash
# push-metrics-cron.sh — Cron wrapper for push-metrics.mjs
# Usage (crontab):
#   */2 * * * * /path/to/push-metrics-cron.sh >> /tmp/ai-metrics-push.log 2>&1
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Resolve project root from script location: grafana/ -> scripts/ -> rd-auto/ -> skills/ -> .claude/ -> project root
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../../../.." && pwd)"

# Load GITLAB_TOKEN from .gitlab-config if present and not already set
if [ -z "${GITLAB_TOKEN:-}" ] && [ -f "${PROJECT_ROOT}/.gitlab-config" ]; then
  export GITLAB_TOKEN="$(grep -Po '(?<=^gitlab_token=).*' "${PROJECT_ROOT}/.gitlab-config" | xargs)"
fi

# push-metrics.mjs determines task directory from its own script location,
# but orchestrator.mjs needs to be run from the project root to find .harness/
cd "${PROJECT_ROOT}"
node "${SCRIPT_DIR}/push-metrics.mjs" 2>&1
