'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { parseArgs } = require('./lib/argv');

// --- CST date helper (consistent with collect-git.js) ---
function todayCST() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

// --- Phase-to-role mapping ---
// Design review note: intake/smoke phases map to null (system auto), not counted in role stats
const PHASE_ROLE_MAP = {
  explore: 'architect',
  propose: 'architect',
  'design-review': 'architect',
  implement: 'developer',
  test: 'tester',
  smoke: null,
  'code-review': 'reviewer',
  debate: 'reviewer',
  intake: null,
};

// --- SPEC terminal phases ---
const TERMINAL_PHASES = new Set(['archive', 'merge-prep', 'completed', 'complete']);

// --- Empty output structure ---
function emptyOutput(date, cwd) {
  const emptyTriggerBucket = () => ({ dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, by_role: {}, by_model: {} });
  const harnessVersion = readHarnessVersion(cwd);
  const client = detectClient(process.env);

  return {
    date,
    harness_version: harnessVersion,
    client_name: client.name,
    client_version: client.version,
    tasks: [],
    summary: {
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_dispatches: 0,
      total_wall_clock_ms: 0,
      // Dispatch breakdown by trigger type (pipeline = AI自动调度, natural = 人工调度)
      dispatch_by_trigger: {
        pipeline: emptyTriggerBucket(),
        natural: emptyTriggerBucket(),
      },
      spec_stats: { total_changes: 0, closed_loop: 0, open: 0, by_phase: {} },
      concern_stats: { total: 0, p0_found: 0, p0_closed: 0, p1_found: 0, p1_closed: 0 },
      session_input_tokens: 0,
      session_output_tokens: 0,
      session_cache_creation_input_tokens: 0,
      session_cache_read_input_tokens: 0,
      session_count: 0,
      session_by_project: {},
      session_by_model: {},
    },
  };
}

// --- Check if a UTC timestamp falls on the target CST date ---
function isDateMatch(utcTimestamp, targetDate) {
  const d = new Date(utcTimestamp);
  if (isNaN(d.getTime())) return false;
  // Apply CST +8 offset
  const cstMs = d.getTime() + 8 * 3600 * 1000;
  const cstDate = new Date(cstMs);
  const cstDateStr = `${cstDate.getUTCFullYear()}-${String(cstDate.getUTCMonth() + 1).padStart(2, '0')}-${String(cstDate.getUTCDate()).padStart(2, '0')}`;
  return cstDateStr === targetDate;
}

// --- Main ---
function main() {
  const args = parseArgs(process.argv, {
    options: { date: todayCST() },
  });

  const targetDate = args.options.date;
  const cwd = process.cwd();
  const tasksDir = path.join(cwd, '.harness', 'tasks');

  const output = emptyOutput(targetDate, cwd);

  if (fs.existsSync(tasksDir)) {
    let subdirs;
    try {
      subdirs = fs.readdirSync(tasksDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch (e) {
      subdirs = [];
    }

    for (const dirName of subdirs) {
      const stateFile = path.join(tasksDir, dirName, 'pipeline-state.json');
      if (!fs.existsSync(stateFile)) continue;

      let state;
      try {
        const raw = fs.readFileSync(stateFile, 'utf-8');
        state = JSON.parse(raw);
      } catch (e) {
        process.stderr.write(`[collect-ai] WARNING: skipping ${dirName}/pipeline-state.json: ${e.message}\n`);
        continue;
      }

      if (!state.pipeline) continue;

      // --- SPEC stats (global snapshot, not date-filtered) ---
      // Must be before the dispatch-matching continue (C1 from design-review)
      const currentPhase = state.current_phase || '';
      const completedAt = state.completed_at || null;
      output.summary.spec_stats.total_changes += 1;
      if (TERMINAL_PHASES.has(currentPhase) || completedAt) {
        output.summary.spec_stats.closed_loop += 1;
      } else {
        output.summary.spec_stats.open += 1;
      }
      if (currentPhase) {
        output.summary.spec_stats.by_phase[currentPhase] = (output.summary.spec_stats.by_phase[currentPhase] || 0) + 1;
      }

      // Collect matching dispatches from all phases
      const taskDispatches = [];
      for (const [phaseName, phaseData] of Object.entries(state.pipeline)) {
        const history = phaseData && phaseData.dispatch_history;
        if (!Array.isArray(history)) continue;

        for (const dispatch of history) {
          if (!dispatch.started_at) continue;
          if (!isDateMatch(dispatch.started_at, targetDate)) continue;

          taskDispatches.push({
            phase: phaseName,
            started_at: dispatch.started_at,
            completed_at: dispatch.completed_at || null,
            token_usage: dispatch.token_usage || null,
            exit_status: dispatch.exit_status || null,
          });
        }
      }

      if (taskDispatches.length === 0) continue;

      // Build task entry
      const taskEntry = {
        change_name: state.change_name || dirName,
        caller: state.caller || '',
        title: state.title || state.change_name || dirName,
        current_phase: state.current_phase || '',
        phases_completed: (state.quality_metrics && state.quality_metrics.phases_completed) || 0,
        phases_total: (state.quality_metrics && state.quality_metrics.phases_total) || 0,
        scores: state.scores || {},
        quality_metrics: normalizeQualityMetrics(state.quality_metrics),
        dispatches: taskDispatches,
      };
      output.tasks.push(taskEntry);

      // Aggregate into summary
      for (const d of taskDispatches) {
        const role = PHASE_ROLE_MAP[d.phase] || null;
        const tokens = d.token_usage || {};
        const inputTokens = tokens.input_tokens || 0;
        const outputTokens = tokens.output_tokens || 0;
        const cacheReadTokens = tokens.cache_read_input_tokens || 0;
        const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;

        output.summary.total_input_tokens += inputTokens;
        output.summary.total_output_tokens += outputTokens;
        output.summary.total_dispatches += 1;

        // Pipeline trigger aggregation
        const pipelineTrigger = output.summary.dispatch_by_trigger.pipeline;
        pipelineTrigger.dispatch_count += 1;
        pipelineTrigger.input_tokens += inputTokens;
        pipelineTrigger.output_tokens += outputTokens;
        pipelineTrigger.cache_read_tokens += cacheReadTokens;
        pipelineTrigger.cache_creation_tokens += cacheCreationTokens;

        if (role) {
          if (!pipelineTrigger.by_role[role]) {
            pipelineTrigger.by_role[role] = { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
          }
          pipelineTrigger.by_role[role].dispatch_count += 1;
          pipelineTrigger.by_role[role].input_tokens += inputTokens;
          pipelineTrigger.by_role[role].output_tokens += outputTokens;
          pipelineTrigger.by_role[role].cache_read_tokens += cacheReadTokens;
          pipelineTrigger.by_role[role].cache_creation_tokens += cacheCreationTokens;
        }

        // Model aggregation (pipeline trigger)
        const model = tokens.model || 'unknown';
        if (!pipelineTrigger.by_model[model]) {
          pipelineTrigger.by_model[model] = { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
        }
        pipelineTrigger.by_model[model].dispatch_count += 1;
        pipelineTrigger.by_model[model].input_tokens += inputTokens;
        pipelineTrigger.by_model[model].output_tokens += outputTokens;
        pipelineTrigger.by_model[model].cache_read_tokens += cacheReadTokens;
        pipelineTrigger.by_model[model].cache_creation_tokens += cacheCreationTokens;

        // Aggregate wall clock per dispatch
        if (d.started_at && d.completed_at) {
          const startMs = new Date(d.started_at).getTime();
          const endMs = new Date(d.completed_at).getTime();
          if (!isNaN(startMs) && !isNaN(endMs)) {
            output.summary.total_wall_clock_ms += (endMs - startMs);
          }
        }
      }
    }

    // For wall clock: prefer quality_metrics total_wall_clock_ms when available across tasks
    let qualityWallClock = 0;
    let hasQualityWallClock = false;
    for (const task of output.tasks) {
      if (task.quality_metrics && task.quality_metrics.total_wall_clock_ms != null) {
        qualityWallClock += task.quality_metrics.total_wall_clock_ms;
        hasQualityWallClock = true;
      }
    }
    if (hasQualityWallClock) {
      output.summary.total_wall_clock_ms = qualityWallClock;
    }
  }

  // --- Concern stats (global snapshot from shared-state) ---
  collectConcernStats(cwd, output);

  // --- Usage tracking from ~/.claude/usage/usage.jsonl ---
  collectUsageJsonl(targetDate, output);

  // --- Session token stats (all local Claude Code sessions today) ---
  collectSessionTokens(targetDate, output);

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

// --- Collect concern stats from .harness/shared-state/*/concerns.json ---
function collectConcernStats(cwd, output) {
  const sharedStateDir = path.join(cwd, '.harness', 'shared-state');
  if (!fs.existsSync(sharedStateDir)) return;

  let concernSubdirs;
  try {
    concernSubdirs = fs.readdirSync(sharedStateDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (e) {
    return;
  }

  for (const concernDir of concernSubdirs) {
    const concernsFile = path.join(sharedStateDir, concernDir, 'concerns.json');
    if (!fs.existsSync(concernsFile)) continue;

    let concernsData;
    try {
      concernsData = JSON.parse(fs.readFileSync(concernsFile, 'utf-8'));
    } catch (e) {
      continue;
    }

    const concerns = concernsData.concerns;
    if (!Array.isArray(concerns)) continue;

    for (const c of concerns) {
      const severity = (c.severity || '').toUpperCase();
      const status = (c.status || '').toLowerCase();
      output.summary.concern_stats.total += 1;

      if (severity === 'P0') {
        output.summary.concern_stats.p0_found += 1;
        if (status === 'resolved') {
          output.summary.concern_stats.p0_closed += 1;
        }
      } else if (severity === 'P1') {
        output.summary.concern_stats.p1_found += 1;
        if (status === 'resolved') {
          output.summary.concern_stats.p1_closed += 1;
        }
      }
    }
  }
}

// --- Project slug to short name ---
// Slug: -work-repos-aios-rd-harness → short: rd-harness
// Rule: skip first 3 non-empty segments (path prefix like work/repos/aios or home/user/repos),
// join remaining segments as project name
function slugToShortName(slug) {
  const parts = slug.split('-').filter(Boolean);
  if (parts.length <= 3) return slug.replace(/^-/, '');
  const projectParts = parts.slice(3);
  return projectParts.join('-') || parts[parts.length - 1];
}

// --- Collect session tokens from all local Claude Code sessions ---
function collectSessionTokens(targetDate, output) {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return;

  let projectDirs;
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory());
  } catch (e) {
    return;
  }

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir.name);
    const shortName = slugToShortName(projectDir.name);
    let files;
    try {
      files = fs.readdirSync(projectPath, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith('.jsonl'));
    } catch (e) {
      continue;
    }

    // Per-project accumulator
    let projectSessionCount = 0;
    let projectInput = 0;
    let projectOutput = 0;
    let projectCacheRead = 0;
    let projectCacheCreation = 0;

    for (const file of files) {
      const filePath = path.join(projectPath, file.name);
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf-8');
      } catch (e) {
        continue;
      }

      let sessionMatched = false;
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch (e) {
          continue;
        }

        // Date filter: use entry.timestamp (UTC → CST)
        if (entry.timestamp && !isDateMatch(entry.timestamp, targetDate)) continue;
        // If no timestamp, skip (can't determine date)
        if (!entry.timestamp) continue;

        sessionMatched = true;

        const usage = entry.message && entry.message.usage;
        if (!usage) continue;

        const uInput = usage.input_tokens || 0;
        const uOutput = usage.output_tokens || 0;
        const uCacheRead = usage.cache_read_input_tokens || 0;
        const uCacheCreation = usage.cache_creation_input_tokens || 0;

        output.summary.session_input_tokens += uInput;
        output.summary.session_output_tokens += uOutput;
        output.summary.session_cache_creation_input_tokens += uCacheCreation;
        output.summary.session_cache_read_input_tokens += uCacheRead;

        projectInput += uInput;
        projectOutput += uOutput;
        projectCacheRead += uCacheRead;
        projectCacheCreation += uCacheCreation;

        // Model aggregation for session tokens
        const model = (entry.message && entry.message.model) || 'unknown';
        if (!output.summary.session_by_model[model]) {
          output.summary.session_by_model[model] = { count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
        }
        output.summary.session_by_model[model].count += 1;
        output.summary.session_by_model[model].input_tokens += uInput;
        output.summary.session_by_model[model].output_tokens += uOutput;
        output.summary.session_by_model[model].cache_read_tokens += uCacheRead;
        output.summary.session_by_model[model].cache_creation_tokens += uCacheCreation;
      }

      if (sessionMatched) {
        output.summary.session_count += 1;
        projectSessionCount += 1;
      }
    }

    // Store per-project breakdown
    if (projectSessionCount > 0) {
      output.summary.session_by_project[shortName] = {
        slug: projectDir.name,
        count: projectSessionCount,
        input_tokens: projectInput,
        output_tokens: projectOutput,
        cache_read_tokens: projectCacheRead,
        cache_creation_tokens: projectCacheCreation,
      };
    }
  }
}

// --- Resolve caller identity: git username > OS username ---
function resolveCaller() {
  try {
    const { execSync } = require('node:child_process');
    const gitUser = execSync('git config user.name', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    if (gitUser) return gitUser;
  } catch (_) { /* not in a git repo or git not available */ }
  try {
    return os.userInfo().username;
  } catch (_) {
    return 'unknown';
  }
}

// --- Read harness version from .harness/.harness-version ---
// 只取首行：与 session-start.sh / submit-harness-issue.sh / upgrade-harness SKILL.md
// 的 `head -1` 契约对齐（bump-version.sh 写入 3 行：version / force / signature）。
function readHarnessVersion(cwd) {
  const versionFile = path.join(cwd, '.harness', '.harness-version');
  try {
    const raw = fs.readFileSync(versionFile, 'utf-8');
    return raw.split('\n', 1)[0].trim() || null;
  } catch (_) {
    return null;
  }
}

// --- Normalize quality_metrics: 类型守卫，null / NaN / Infinity / 非数值 → 0 ---
// schema additionalProperties:false 锁死字段集；这里只做类型守卫，不枚举字段名，
// 避免 "schema 加字段 → normalize 漏字段" 的双向不同步。
function normalizeQualityMetrics(qm) {
  const src = qm || {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
  }
  return out;
}

// --- Detect AI client (claude-code / codex / cursor / cline) from env ---
// Order matters: more specific signals first. Returns {name, version} or {name:null, version:null}.
function detectClient(env) {
  const e = env || process.env;

  // Claude Code: CLAUDECODE=1 + CLAUDE_CODE_VERSION (e.g. "2.1.153 (Claude Code)")
  if (e.CLAUDECODE === '1' || e.CLAUDE_CODE_VERSION) {
    const raw = (e.CLAUDE_CODE_VERSION || '').trim();
    // Strip suffixes like " (Claude Code)" — take the first whitespace-separated token
    const version = raw.split(/\s+/)[0] || null;
    return { name: 'claude-code', version: version || null };
  }

  // OpenAI Codex CLI: CODEX env vars
  if (e.CODEX || e.CODEX_VERSION || e.CODEX_HOME) {
    const version = (e.CODEX_VERSION || '').trim() || null;
    return { name: 'codex', version };
  }

  // Cursor: CURSOR_TRACE_ID or Cursor-defined env vars
  if (e.CURSOR_TRACE_ID || e.CURSOR_VSCODE) {
    return { name: 'cursor', version: (e.CURSOR_VERSION || '').trim() || null };
  }

  // Cline (VS Code extension) — no stable env signal; leave null for now
  return { name: null, version: null };
}

// --- Collect usage data from ~/.claude/usage/usage.jsonl ---
// Records written by PostToolUse hook (post-tool-use-agent-usage.sh)
// and by rd-auto mark-dispatch --end.
function collectUsageJsonl(targetDate, output) {
  const usageFile = path.join(os.homedir(), '.claude', 'usage', 'usage.jsonl');
  if (!fs.existsSync(usageFile)) return;

  let content;
  try {
    content = fs.readFileSync(usageFile, 'utf-8');
  } catch (e) {
    return;
  }

  const usageDispatches = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      continue;
    }

    // Date filter: ts is UTC, convert to CST
    if (!isDateMatch(entry.ts, targetDate)) continue;

    // trigger 过滤：pipeline-trigger 条目跳过，避免与 pipeline-state.json 重复计数。
    // pipeline-state.json 是 pipeline dispatch 的唯一来源；
    // usage.jsonl 只统计 natural-trigger（人工 dispatch）。
    if (entry.trigger === 'pipeline') continue;

    const role = entry.role || 'unknown';
    const tokens = entry.tokens || {};
    const inputTokens = tokens.input || 0;
    const outputTokens = tokens.output || 0;
    const cacheReadTokens = tokens.cache_read || 0;
    const cacheCreationTokens = tokens.cache_creation || 0;
    const durationMs = entry.duration_ms || 0;

    // Aggregate into summary totals
    output.summary.total_input_tokens += inputTokens;
    output.summary.total_output_tokens += outputTokens;
    output.summary.total_dispatches += 1;
    output.summary.total_wall_clock_ms += durationMs;

    // Natural trigger aggregation
    const naturalTrigger = output.summary.dispatch_by_trigger.natural;
    naturalTrigger.dispatch_count += 1;
    naturalTrigger.input_tokens += inputTokens;
    naturalTrigger.output_tokens += outputTokens;
    naturalTrigger.cache_read_tokens += cacheReadTokens;
    naturalTrigger.cache_creation_tokens += cacheCreationTokens;

    if (!naturalTrigger.by_role[role]) {
      naturalTrigger.by_role[role] = { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
    }
    naturalTrigger.by_role[role].dispatch_count += 1;
    naturalTrigger.by_role[role].input_tokens += inputTokens;
    naturalTrigger.by_role[role].output_tokens += outputTokens;
    naturalTrigger.by_role[role].cache_read_tokens += cacheReadTokens;
    naturalTrigger.by_role[role].cache_creation_tokens += cacheCreationTokens;

    // Model aggregation (natural trigger)
    const model = tokens.model || 'unknown';
    if (!naturalTrigger.by_model[model]) {
      naturalTrigger.by_model[model] = { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
    }
    naturalTrigger.by_model[model].dispatch_count += 1;
    naturalTrigger.by_model[model].input_tokens += inputTokens;
    naturalTrigger.by_model[model].output_tokens += outputTokens;
    naturalTrigger.by_model[model].cache_read_tokens += cacheReadTokens;
    naturalTrigger.by_model[model].cache_creation_tokens += cacheCreationTokens;

    usageDispatches.push(entry);
  }

  // Create a virtual task entry for render-report.js active tasks list
  if (usageDispatches.length > 0) {
    const triggerBreakdown = {};
    for (const d of usageDispatches) {
      const t = d.trigger || 'unknown';
      triggerBreakdown[t] = (triggerBreakdown[t] || 0) + 1;
    }
    const triggerStr = Object.entries(triggerBreakdown).map(([k, v]) => `${k}:${v}`).join(', ');

    output.tasks.push({
      change_name: 'agent-dispatch',
      caller: resolveCaller(),
      title: `人工调度 (${triggerStr})`,
      current_phase: 'usage-tracking',
      phases_completed: 1,
      phases_total: 1,
      scores: {},
      quality_metrics: {},
      dispatches: usageDispatches.map((d) => ({
        phase: `usage-${d.trigger || 'natural'}`,
        started_at: d.started_at || d.ts,
        completed_at: d.completed_at || null,
        token_usage: d.tokens ? {
          input_tokens: d.tokens.input || 0,
          output_tokens: d.tokens.output || 0,
          cache_read_input_tokens: d.tokens.cache_read || 0,
          cache_creation_input_tokens: d.tokens.cache_creation || 0,
          model: d.tokens.model || null,
        } : null,
        exit_status: null,
      })),
      _usage_source: true,
    });
  }
}

main();
