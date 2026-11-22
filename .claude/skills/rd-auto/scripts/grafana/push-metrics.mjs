#!/usr/bin/env node
// push-metrics.mjs — Push AI dispatch metrics to Prometheus Pushgateway
// Zero-dependency Node.js ESM script
// Usage: node push-metrics.mjs [--dry-run]

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, '..');

// --- Configuration ---
const PUSHGATEWAY_URL = 'http://192.168.5.114:9091';
const JOB_NAME = 'ai_dispatch';
const GITLAB_URL = 'http://192.168.5.160';
const GITLAB_PROJECT = 'public_group/daily_report';
const GITLAB_BRANCH = 'dev';
const GITLAB_FILE_PATH = 'config/team.json';
const CACHE_PATH = '/tmp/ai-dispatch-team-cache.json';
const CACHE_TTL_MS = 3600 * 1000; // 1 hour

// --- Label value escaping (Prometheus spec) ---

function escapeLabelValue(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// --- Metric line building ---

function buildMetricLine(name, labels, value) {
  const safeValue = (value === null || value === undefined || Number.isNaN(value)) ? 0 : value;
  const labelPairs = Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
    .join(',');
  const labelStr = labelPairs ? `{${labelPairs}}` : '';
  return `${name}${labelStr} ${safeValue}`;
}

// --- Build Prometheus exposition format ---

function buildExpositionFormat(metrics) {
  const lines = [];
  const seenTypes = new Set();
  for (const m of metrics) {
    if (!seenTypes.has(m.name)) {
      lines.push(`# TYPE ${m.name} ${m.type}`);
      seenTypes.add(m.name);
    }
    lines.push(buildMetricLine(m.name, m.labels, m.value));
  }
  return lines.join('\n') + '\n';
}

// --- Convert stats object to metrics ---

function statsToMetrics(statsResult, team) {
  const metrics = [];
  const roles = Array.isArray(statsResult) ? statsResult : (statsResult.roles || []);

  const gaugeDefs = [
    { name: 'ai_dispatch_task_count', key: 'task_count' },
    { name: 'ai_dispatch_completed_count', key: 'first_pass_count' },
    { name: 'ai_dispatch_first_pass_rate', key: 'first_pass_rate' },
    { name: 'ai_dispatch_avg_score', key: 'avg_score' },
    { name: 'ai_dispatch_avg_duration_ms', key: 'avg_duration_ms' },
    { name: 'ai_dispatch_rework_count', key: 'rework_count' },
    { name: 'ai_dispatch_blocked_count', key: 'blocked_count' },
    { name: 'ai_dispatch_tokens_input', key: 'total_input_tokens' },
    { name: 'ai_dispatch_tokens_output', key: 'total_output_tokens' },
  ];

  for (const s of roles) {
    for (const def of gaugeDefs) {
      const val = s[def.key];
      metrics.push({
        name: def.name,
        type: 'gauge',
        labels: { role: s.role, team },
        value: (val === null || val === undefined || Number.isNaN(val)) ? 0 : val,
      });
    }
  }

  // Per-phase duration metrics
  if (statsResult.phase_durations) {
    for (const [phase, stat] of Object.entries(statsResult.phase_durations)) {
      metrics.push({
        name: 'ai_dispatch_phase_avg_duration_ms',
        type: 'gauge',
        labels: { phase, team },
        value: stat.count > 0 ? Math.round(stat.sum / stat.count) : 0,
      });
      metrics.push({
        name: 'ai_dispatch_phase_count',
        type: 'gauge',
        labels: { phase, team },
        value: stat.count,
      });
    }
  }

  // Context mode metrics
  if (statsResult.context_modes) {
    for (const [mode, stat] of Object.entries(statsResult.context_modes)) {
      metrics.push({
        name: 'ai_dispatch_context_mode_count',
        type: 'gauge',
        labels: { context_mode: mode, team },
        value: stat.dispatch_count,
      });
      metrics.push({
        name: 'ai_dispatch_context_mode_avg_duration_ms',
        type: 'gauge',
        labels: { context_mode: mode, team },
        value: stat.dispatch_count > 0 ? Math.round(stat.total_duration_ms / stat.dispatch_count) : 0,
      });
    }
  }
  if (statsResult.context_upgrades !== undefined) {
    metrics.push({
      name: 'ai_dispatch_context_upgrade_total',
      type: 'gauge',
      labels: { team },
      value: statsResult.context_upgrades,
    });
  }

  // Timestamp metric (no labels)
  metrics.push({
    name: 'ai_dispatch_last_push_timestamp',
    type: 'gauge',
    labels: {},
    value: Math.floor(Date.now() / 1000),
  });

  return metrics;
}

// --- Build per-task wall-clock metrics (sync) ---

// --- Convert advanced stats to Prometheus metrics ---

function advancedStatsToMetrics(advanced, team) {
  const metrics = [];

  // lead_time metrics
  if (advanced && advanced.lead_time && advanced.lead_time.count > 0) {
    for (const stat of ['p50', 'p95', 'p99', 'avg', 'min', 'max']) {
      const val = advanced.lead_time[stat];
      if (val !== null && val !== undefined) {
        metrics.push({
          name: 'ai_dispatch_lead_time_ms',
          type: 'gauge',
          labels: { stat, team },
          value: val,
        });
      }
    }
    metrics.push({
      name: 'ai_dispatch_lead_time_count',
      type: 'gauge',
      labels: { team },
      value: advanced.lead_time.count,
    });
  }

  // pm_to_first_artifact_ms metrics
  if (advanced && advanced.pm_to_first_artifact_ms && advanced.pm_to_first_artifact_ms.count > 0) {
    for (const stat of ['p50', 'p95', 'p99', 'avg', 'min', 'max']) {
      const val = advanced.pm_to_first_artifact_ms[stat];
      if (val !== null && val !== undefined) {
        metrics.push({
          name: 'ai_dispatch_pm_to_first_artifact_ms',
          type: 'gauge',
          labels: { stat, team },
          value: val,
        });
      }
    }
    metrics.push({
      name: 'ai_dispatch_pm_to_first_artifact_ms_count',
      type: 'gauge',
      labels: { team },
      value: advanced.pm_to_first_artifact_ms.count,
    });
  }

  // phase_duration_percentiles
  if (advanced && advanced.phase_duration_percentiles) {
    for (const entry of advanced.phase_duration_percentiles) {
      if (entry.p50 !== null) {
        metrics.push({
          name: 'ai_dispatch_phase_duration_p50_ms',
          type: 'gauge',
          labels: { phase: entry.phase, team },
          value: entry.p50,
        });
      }
      if (entry.p95 !== null) {
        metrics.push({
          name: 'ai_dispatch_phase_duration_p95_ms',
          type: 'gauge',
          labels: { phase: entry.phase, team },
          value: entry.p95,
        });
      }
      if (entry.p99 !== null) {
        metrics.push({
          name: 'ai_dispatch_phase_duration_p99_ms',
          type: 'gauge',
          labels: { phase: entry.phase, team },
          value: entry.p99,
        });
      }
    }
  }

  // rework_reasons — top 10
  if (advanced && advanced.rework_reasons) {
    const topReasons = advanced.rework_reasons.slice(0, 10);
    for (const entry of topReasons) {
      metrics.push({
        name: 'ai_dispatch_rework_reason_total',
        type: 'gauge',
        labels: { reason: entry.reason, team },
        value: entry.count,
      });
    }
  }

  // cost_per_task
  if (advanced && advanced.cost_per_task) {
    let totalTokens = 0;
    let totalTasks = 0;
    for (const entry of advanced.cost_per_task) {
      metrics.push({
        name: 'ai_dispatch_tokens_by_flow_type',
        type: 'gauge',
        labels: { flow_type: entry.flow_type, team },
        value: entry.avg_total_tokens,
      });
      totalTokens += entry.avg_total_tokens * entry.task_count;
      totalTasks += entry.task_count;
    }
    if (totalTasks > 0) {
      metrics.push({
        name: 'ai_dispatch_avg_tokens_per_task',
        type: 'gauge',
        labels: { team },
        value: Math.round(totalTokens / totalTasks),
      });
    }
  }

  // blocked_rate
  if (advanced && advanced.blocked_rate) {
    for (const entry of advanced.blocked_rate) {
      if (entry.role !== 'overall') {
        metrics.push({
          name: 'ai_dispatch_blocked_rate',
          type: 'gauge',
          labels: { role: entry.role, team },
          value: entry.rate,
        });
      }
    }
    const overallEntry = advanced.blocked_rate.find(e => e.role === 'overall');
    if (overallEntry) {
      metrics.push({
        name: 'ai_dispatch_blocked_total',
        type: 'gauge',
        labels: { team },
        value: overallEntry.blocked_count,
      });
    }
  }

  // quality_gate_stats
  if (advanced && advanced.quality_gate_stats) {
    for (const entry of advanced.quality_gate_stats) {
      metrics.push({
        name: 'ai_dispatch_quality_gate_passed',
        type: 'gauge',
        labels: { gate: entry.gate, team },
        value: entry.passed,
      });
      metrics.push({
        name: 'ai_dispatch_quality_gate_pending',
        type: 'gauge',
        labels: { gate: entry.gate, team },
        value: entry.pending || 0,
      });
      metrics.push({
        name: 'ai_dispatch_quality_gate_failed',
        type: 'gauge',
        labels: { gate: entry.gate, team },
        value: entry.failed || 0,
      });
    }
  }

  return metrics;
}

function buildTaskMetricsSync(tasksDir, team) {
  const metrics = [];

  try {
    const entries = readdirSync(tasksDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (count >= 20) break; // limit cardinality to recent 20 tasks
      const statePath = join(tasksDir, entry.name, 'pipeline-state.json');
      if (!existsSync(statePath)) continue;

      try {
        const ps = JSON.parse(readFileSync(statePath, 'utf8'));
        const created = new Date(ps.created_at).getTime();
        const updated = new Date(ps.updated_at).getTime();
        const wallClock = updated - created;

        metrics.push({
          name: 'ai_dispatch_task_wall_clock_ms',
          type: 'gauge',
          labels: { task: ps.change_name || entry.name, team },
          value: wallClock > 0 ? wallClock : 0,
        });
        count++;
      } catch {
        // skip malformed files
      }
    }
  } catch {
    // tasks dir may not exist
  }

  return metrics;
}

// --- Team map loading with cache ---

function loadTeamMapFromCache(cachePath, ttlMs) {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = readFileSync(cachePath, 'utf8');
    const cached = JSON.parse(raw);
    if (Date.now() - cached.cachedAt > ttlMs) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function saveTeamMapToCache(cachePath, data) {
  try {
    writeFileSync(cachePath, JSON.stringify({ data, cachedAt: Date.now() }), 'utf8');
  } catch (e) {
    process.stderr.write(`[push-metrics] Warning: failed to write cache: ${e.message}\n`);
  }
}

function fetchTeamMapFromGitLab() {
  const token = process.env.GITLAB_TOKEN;
  if (!token) {
    process.stderr.write('[push-metrics] GITLAB_TOKEN not set, cannot fetch team.json\n');
    return null;
  }

  const projectEncoded = encodeURIComponent(GITLAB_PROJECT);
  const fileEncoded = encodeURIComponent(GITLAB_FILE_PATH);
  const path = `/api/v4/projects/${projectEncoded}/repository/files/${fileEncoded}/raw?ref=${GITLAB_BRANCH}`;

  return new Promise((resolve) => {
    const req = http.request(
      { hostname: GITLAB_URL.replace(/^https?:\/\//, ''), port: 80, path, method: 'GET', timeout: 10000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const teamArray = JSON.parse(body);
            const map = {};
            if (teamArray.members) {
              for (const entry of teamArray.members) {
                if (entry.git_username && entry.group) {
                  map[entry.git_username] = entry.group;
                }
              }
            }
            resolve(map);
          } catch (e) {
            process.stderr.write(`[push-metrics] Failed to parse team.json: ${e.message}\n`);
            resolve(null);
          }
        });
      },
    );
    req.setHeader('PRIVATE-TOKEN', token);
    req.on('error', (e) => {
      process.stderr.write(`[push-metrics] Failed to fetch team.json: ${e.message}\n`);
      resolve(null);
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function getTeamMap(gitUsername) {
  // Try cache first
  let teamMap = loadTeamMapFromCache(CACHE_PATH, CACHE_TTL_MS);

  if (!teamMap) {
    // Fetch from GitLab
    teamMap = await fetchTeamMapFromGitLab();
    if (teamMap) {
      saveTeamMapToCache(CACHE_PATH, teamMap);
    } else {
      // Fallback to expired cache
      teamMap = loadTeamMapFromCache(CACHE_PATH, Infinity);
    }
  }

  if (!teamMap) {
    process.stderr.write('[push-metrics] No team map available, using "unknown" team\n');
    return 'unknown';
  }

  return teamMap[gitUsername] || 'unknown';
}

// --- Get git username ---

function getGitUsername() {
  try {
    return execSync('git config user.name', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// --- Get orchestrator stats ---

function getOrchestratorStats() {
  const orchestratorPath = join(SCRIPTS_DIR, 'orchestrator.mjs');
  try {
    const output = execSync(`node "${orchestratorPath}" stats --json`, {
      encoding: 'utf8',
      timeout: 30000,
    });
    return JSON.parse(output);
  } catch (e) {
    process.stderr.write(`[push-metrics] Failed to get stats: ${e.message}\n`);
    return [];
  }
}

// --- Push metrics to Pushgateway ---

function pushMetrics(expositionText, gitUsername) {
  const url = new URL(`${PUSHGATEWAY_URL}/metrics/job/${JOB_NAME}/instance/${encodeURIComponent(gitUsername)}`);

  return new Promise((resolve) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', timeout: 10000 },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        });
      },
    );
    req.on('error', (e) => {
      process.stderr.write(`[push-metrics] Failed to push to Pushgateway: ${e.message}\n`);
      resolve(false);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(expositionText);
    req.end();
  });
}

// --- Main ---

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 1. Get git username (instance label)
  const gitUsername = getGitUsername();
  if (gitUsername === 'unknown') {
    process.stderr.write('[push-metrics] Warning: could not determine git username\n');
  }

  // 2. Get team mapping
  const team = await getTeamMap(gitUsername);

  // 3. Get orchestrator stats
  const stats = getOrchestratorStats();
  if (stats.length === 0) {
    process.stderr.write('[push-metrics] No stats available, nothing to push\n');
    return;
  }

  // 4. Build metrics
  const roleMetrics = statsToMetrics(stats, team);

  // 4b. Build advanced metrics from stats.advanced field
  const advancedMetrics = advancedStatsToMetrics(stats.advanced, team);

  // 5. Build per-task wall-clock metrics
  // Determine tasks directory from script location
  const projectRoot = join(SCRIPTS_DIR, '..', '..', '..', '..');
  const tasksDir = join(projectRoot, '.harness', 'tasks');
  const taskMetrics = buildTaskMetricsSync(tasksDir, team);

  const allMetrics = [...roleMetrics, ...advancedMetrics, ...taskMetrics];

  // 6. Build exposition format
  const expositionText = buildExpositionFormat(allMetrics);

  if (dryRun) {
    process.stdout.write('[dry-run] Metrics that would be pushed:\n');
    process.stdout.write(expositionText);
    process.stdout.write(`\n[dry-run] Target: ${PUSHGATEWAY_URL}/metrics/job/${JOB_NAME}/instance/${gitUsername}\n`);
    process.stdout.write(`[dry-run] Team: ${team}, Git user: ${gitUsername}\n`);
    return;
  }

  // 7. Push to Pushgateway
  const ok = await pushMetrics(expositionText, gitUsername);
  if (ok) {
    process.stdout.write(`[push-metrics] Pushed ${allMetrics.length} metrics for ${gitUsername} (team: ${team})\n`);
  }
}

main();
