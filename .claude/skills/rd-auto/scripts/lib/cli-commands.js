// lib/cli-commands.js — All CLI command implementations and helpers
import { readFileSync, writeFileSync, appendFileSync, renameSync, readdirSync, mkdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import {
  PROJECT_ROOT, RULES_PATH, CLAUDE_DIR, ROLE_AGENT_MAP,
  errExit, output, debugLog, parseArgs, getArg
} from './constants.js';
import {
  stateInit, stateLoad, stateSave, getTasksDir,
  stateListActive, stateListAll, getPipelinePhases, getCountedPhases
} from './state-store.js';
import { parseRules, loadRulesYaml } from './transitions.js';
import { advance, getRole, getPreviousSummary } from './advance.js';
import { formatDuration, computeStats, computeAdvancedStats } from './stats.js';
import { parseTasksMd as parseTasksMdFn } from './fanout.js';
import { assembleContextPack, expandAgentIncludes, recommendMode } from './context-pack.js';

// ─── Transcript Token Extraction ───

function findTranscriptPath() {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) return null;
  const cwd = process.env.PROJECT_ROOT || process.cwd();
  const projectSlug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const candidates = [
    join(process.env.HOME || '/root', '.claude', 'projects', projectSlug, `${sessionId}.jsonl`),
    join(process.env.HOME || '/root', '.claude', 'projects', projectSlug, 'tool-results', `${sessionId}.jsonl`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function countTranscriptLines(transcriptPath) {
  try {
    const content = readFileSync(transcriptPath, 'utf8');
    return content.split('\n').filter(Boolean).length;
  } catch (e) {
    debugLog('countTranscriptLines failed —', e.message);
    return 0;
  }
}

function extractTokenUsage(transcriptPath, startLine) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  try {
    const content = readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    if (startLine >= lines.length) return null;

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let models = {};

    for (let i = startLine; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        const u = obj.message?.usage;
        if (!u) continue;
        const model = obj.message?.model || 'unknown';
        inputTokens += u.input_tokens || 0;
        outputTokens += u.output_tokens || 0;
        cacheReadTokens += u.cache_read_input_tokens || 0;
        cacheCreationTokens += u.cache_creation_input_tokens || 0;
        models[model] = (models[model] || 0) + (u.input_tokens || 0) + (u.output_tokens || 0);
      } catch (e) { debugLog('extractTokenUsage: line parse failed —', e.message); }
    }

    if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheCreationTokens === 0) return null;
    const dominantModel = Object.entries(models).sort((a, b) => b[1] - a[1])[0];

    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      model: dominantModel ? dominantModel[0] : 'unknown',
    };
  } catch (e) {
    debugLog('extractTokenUsage failed —', e.message);
    return null;
  }
}

// ─── Unified Usage JSONL ───

function getUsageFile() {
  const usageDir = join(homedir(), '.claude', 'usage');
  if (!existsSync(usageDir)) mkdirSync(usageDir, { recursive: true });
  return join(usageDir, 'usage.jsonl');
}

function appendUsage(record) {
  const usageFile = getUsageFile();
  const line = JSON.stringify(record) + '\n';
  appendFileSync(usageFile, line, 'utf8');
}

// ─── Shared State Helpers ───

function getSharedStateDirFn(changeName) {
  return join(PROJECT_ROOT, '.harness', 'shared-state', changeName);
}

// ─── Summarize State ───

function summarizeState(state) {
  const pipeline = state.pipeline || {};
  const phases = Object.keys(pipeline);
  const countedPhases = getCountedPhases(state);
  const doneCount = countedPhases.filter((phase) => pipeline[phase].status === 'done' || pipeline[phase].status === 'done_with_concerns').length;

  const startedPhases = phases.filter(p => pipeline[p].started_at);
  let elapsed_ms = null;
  if (startedPhases.length > 0) {
    const firstStart = startedPhases.map(p => new Date(pipeline[p].started_at).getTime()).sort((a, b) => a - b)[0];
    elapsed_ms = Date.now() - firstStart;
  }

  return {
    change_name: state.change_name,
    title: state.title,
    current_phase: state.current_phase,
    flow_type: state.flow_type,
    updated_at: state.updated_at,
    progress: `${doneCount}/${countedPhases.length}`,
    elapsed_ms,
    scores: state.scores,
    rework_count: state.rework_count,
    blocked_count: state.blocked_count,
    pipeline: Object.fromEntries(
      phases.map(p => [p, { status: pipeline[p].status, exit_status: pipeline[p].exit_status || null }])
    ),
  };
}

// ─── CLI: init ───

export function cmdInit(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs init <change-name> --title <title> --criteria <c1,c2>');
  if (!/^[a-zA-Z0-9_-]+$/.test(changeName)) errExit(`Invalid change-name '${changeName}': only letters, digits, hyphens, underscores allowed`);

  const parsed = parseArgs(args.slice(1));
  const title = parsed.title || changeName;
  const criteria = parsed.criteria ? parsed.criteria.split(',') : [];
  const hotfix = parsed.hotfix === 'true' || parsed.hotfix === '';
  const docs = parsed.docs === 'true' || parsed.docs === '';
  const flowTypeArg = parsed['flow-type'] || null;
  const intentJson = getArg(args, '--intent-json');

  let flowType;
  if (flowTypeArg) {
    const validTypes = ['development', 'docs', 'hotfix', 'refactor', 'test-only', 'config-change', 'quick'];
    if (!validTypes.includes(flowTypeArg)) {
      errExit(`Invalid flow-type '${flowTypeArg}'. Valid: ${validTypes.join(', ')}`);
    }
    flowType = flowTypeArg;
  } else {
    flowType = docs ? 'docs' : null;
  }

  const effectiveHotfix = flowTypeArg ? (flowTypeArg === 'hotfix') : hotfix;

  const state = stateInit(changeName, title, criteria, flowType, effectiveHotfix, { mode: parsed.mode });

  if (intentJson) {
    try {
      state.intent = JSON.parse(intentJson);
      state.intent.parsed_at = new Date().toISOString();
    } catch (e) {
      errExit('Invalid JSON in --intent-json: ' + e.message);
    }

    // P1-2: Auto-upgrade to quick flow for simple intents
    if (state.flow_type === 'development' && state.intent.intent_category) {
      const cat = state.intent.intent_category;
      const conf = state.intent.confidence || 0.5;
      const affectedFiles = state.intent.affected_files?.length || 999;
      const quickCategories = ['bug_fix', 'quick_change', 'code_review', 'testing'];
      if (quickCategories.includes(cat) && conf >= 0.85 && affectedFiles <= 3) {
        state.flow_type = 'quick';
        state.intent.auto_upgraded_to_quick = true;
        state.intent.original_flow_type = 'development';
        state.pipeline = {};
        const quickPhases = getPipelinePhases('quick');
        for (const p of quickPhases) {
          state.pipeline[p] = { status: 'pending', rd_skill: null, first_pass: null, rework_reasons: [], artifact_paths: [] };
        }
        state.current_phase = 'pending';
        state.quality_metrics.phases_total = quickPhases.length;
      }
    }

    stateSave(changeName, state);
  }

  output({ change_name: changeName, action: 'init', state: summarizeState(state) });
}

// ─── CLI: set-phase ───

export function cmdSetPhase(args) {
  const changeName = args[0];
  const phase = args[1];
  if (!changeName || !phase) errExit('Usage: orchestrator.mjs set-phase <change-name> <phase>');

  const validPhases = ['intake', 'explore', 'propose', 'design-review', 'implement', 'test', 'code-review', 'debate', 'archive', 'dispatch', 'verify', 'complete'];
  if (!validPhases.includes(phase)) errExit(`Invalid phase '${phase}'. Valid: ${validPhases.join(', ')}`);

  const state = stateLoad(changeName);
  const previous = state.current_phase;
  state.current_phase = phase;
  if (state.pipeline[phase]) {
    const now = new Date().toISOString();
    state.pipeline[phase].status = 'in_progress';
    if (!state.pipeline[phase].started_at) {
      state.pipeline[phase].started_at = now;
    }
    state.pipeline[phase].last_resumed_at = now;
  }
  stateSave(changeName, state);
  output({ change_name: changeName, previous_phase: previous, current_phase: phase, action: 'set_phase' });
}

// ─── CLI: mark-dispatch ───

export function cmdMarkDispatch(args) {
  const changeName = args[0];
  const marker = args[1]; // --start or --end
  if (!changeName || !marker) errExit('Usage: orchestrator.mjs mark-dispatch <change-name> --start|--end');

  const isStart = marker === '--start';
  const isEnd = marker === '--end';
  if (!isStart && !isEnd) errExit('Invalid marker. Use --start or --end');

  const parsed = parseArgs(args.slice(2));
  const state = stateLoad(changeName);
  const phase = state.current_phase;
  if (!phase || !state.pipeline[phase]) errExit(`No active phase for '${changeName}'`);

  if (phase === 'intake') {
    errExit(`BLOCKED: phase '${phase}' is automated and must not dispatch sub-agents. Use 'node orchestrator.mjs run-automated ${changeName}' instead.`);
  }

  const now = new Date().toISOString();
  const ph = state.pipeline[phase];

  if (!ph.dispatch_history) ph.dispatch_history = [];

  const transcriptPath = findTranscriptPath();

  if (isStart) {
    const transcriptLine = transcriptPath ? countTranscriptLines(transcriptPath) : null;
    ph.dispatch_history.push({
      started_at: now,
      completed_at: null, token_usage: null, exit_status: null,
      context_mode: state.intent?.context_mode || 'full',
      _transcript_line: transcriptLine,
    });
    ph.dispatch_started_at = now;
  } else {
    let tokenUsage = null;
    const lastOpen = ph.dispatch_history.findLast(h => h.completed_at === null);
    if (lastOpen && lastOpen._transcript_line != null && transcriptPath) {
      tokenUsage = extractTokenUsage(transcriptPath, lastOpen._transcript_line);
    }
    if (!tokenUsage && (parsed['input-tokens'] !== undefined || parsed['output-tokens'] !== undefined || parsed.model !== undefined)) {
      tokenUsage = {
        input_tokens: parsed['input-tokens'] !== undefined ? parseInt(parsed['input-tokens'], 10) : 0,
        output_tokens: parsed['output-tokens'] !== undefined ? parseInt(parsed['output-tokens'], 10) : 0,
        cache_read_input_tokens: parsed['cache-read-tokens'] !== undefined ? parseInt(parsed['cache-read-tokens'], 10) : 0,
        cache_creation_input_tokens: parsed['cache-creation-tokens'] !== undefined ? parseInt(parsed['cache-creation-tokens'], 10) : 0,
        model: parsed.model || 'unknown',
      };
    }

    if (lastOpen) {
      lastOpen.completed_at = now;
      if (tokenUsage) lastOpen.token_usage = tokenUsage;
      delete lastOpen._transcript_line;
    } else {
      ph.dispatch_history.push({
        started_at: null, completed_at: now,
        token_usage: tokenUsage, exit_status: null,
      });
    }
    ph.dispatch_completed_at = now;
  }

  stateSave(changeName, state);

  // pipeline dispatch 的统计来源是 pipeline-state.json 的 dispatch_history（上面 stateSave 已写）。
  // 不再向 usage.jsonl 追加 trigger=pipeline 条目，避免与 pipeline-state.json 双重计数。
  // usage.jsonl 现在只承载 trigger=natural（人工 dispatch）。

  output({ change_name: changeName, phase, action: 'mark_dispatch', marker, timestamp: now, dispatch_round: ph.dispatch_history.length });
}

// ─── CLI: record-usage ───

export function cmdRecordUsage(args) {
  const parsed = parseArgs(args);
  const role = parsed.role;
  const trigger = parsed.trigger || 'natural';
  const task = parsed.task || '';
  const startedAt = parsed['started-at'] || null;
  const completedAt = parsed['completed-at'] || new Date().toISOString();
  const fromLine = (parsed['from-line'] !== undefined && parsed['from-line'] !== 'true') ? parseInt(parsed['from-line'], 10) : null;
  const safeFromLine = (fromLine !== null && !isNaN(fromLine)) ? fromLine : null;

  if (!role) errExit('Usage: orchestrator.mjs record-usage --role <role> [--trigger natural|pipeline] [--task "..."] [--started-at ISO] [--completed-at ISO] [--from-line N]');

  const sessionId = process.env.CLAUDE_CODE_SESSION_ID || '';
  let durationMs = null;
  if (startedAt) {
    durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  }

  let tokens = null;
  if (safeFromLine !== null) {
    const transcriptPath = findTranscriptPath();
    if (transcriptPath) {
      const extracted = extractTokenUsage(transcriptPath, safeFromLine);
      if (extracted) {
        tokens = {
          input: extracted.input_tokens,
          output: extracted.output_tokens,
          cache_read: extracted.cache_read_input_tokens,
          cache_creation: extracted.cache_creation_input_tokens || 0,
          model: extracted.model,
        };
      }
    }
  }

  const record = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    role, trigger, task,
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    tokens,
  };

  appendUsage(record);
  output({ action: 'record_usage', role, trigger, duration_ms: durationMs, tokens: tokens ? 'captured' : 'unavailable' });
}

// ─── CLI: advance ───

export function cmdAdvance(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs advance <change-name> [--exit-status DONE] [--score 85] [--artifacts f1,f2] [--work-item-id WI-1] [--worktree-path /path] [--rework-reason "..."]');

  const parsed = parseArgs(args.slice(1));
  const result = advance(changeName, {
    exit_status: parsed['exit-status'] || 'DONE',
    score: parsed.score !== undefined ? parseFloat(parsed.score) : undefined,
    p0_count: parsed['p0-count'] !== undefined ? parseInt(parsed['p0-count'], 10) : undefined,
    p1_count: parsed['p1-count'] !== undefined ? parseInt(parsed['p1-count'], 10) : undefined,
    summary: parsed.summary || '',
    dimension: parsed.dimension || '',
    artifacts: parsed.artifacts ? parsed.artifacts.split(',').filter(Boolean) : [],
    rework_reason: parsed['rework-reason'] || '',
    work_item_id: parsed['work-item-id'] || '',
    worktree_path: parsed['worktree-path'] || '',
  });
  output(result);
}

// ─── CLI: run-automated ───

export function cmdRunAutomated(args, _depth) {
  const depth = (_depth || 0) + 1;
  if (depth > 5) {
    errExit(`run-automated: recursion depth exceeded (>${depth}), possible infinite loop`);
  }
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs run-automated <change-name>');

  const state = stateLoad(changeName);
  const phase = state.current_phase;

  if (phase !== 'intake') {
    errExit(`run-automated: current phase is '${phase}', expected intake`);
  }

  let exitStatus, summary;

  if (phase === 'intake') {
    const concerns = [];
    if (!state.title || state.title.length < 5) {
      concerns.push('title too short or missing');
    }
    if (!state.acceptance_criteria || state.acceptance_criteria.length === 0) {
      concerns.push('no acceptance criteria');
    }
    const activeTasks = stateListActive().filter(t => t.change_name !== changeName);
    const dupes = activeTasks.filter(t => t.title === state.title && t.title === state.title);
    if (dupes.length > 0) {
      concerns.push(`duplicate active task: ${dupes.map(t => t.change_name).join(', ')}`);
    }
    const changeDir = join(PROJECT_ROOT, '.harness', 'spec', 'changes', changeName);
    if (existsSync(changeDir)) {
      concerns.push(`change directory already exists: ${changeDir}`);
    }

    if (concerns.length === 0) {
      exitStatus = 'DONE';
      summary = 'intake validation passed';
    } else {
      exitStatus = 'NEEDS_CONTEXT';
      summary = concerns.join('; ');
    }
  }

  if (state.pipeline[phase]) {
    state.pipeline[phase].status = exitStatus === 'BLOCKED' ? 'blocked' : exitStatus === 'DONE' ? 'done' : 'in_progress';
    state.pipeline[phase].exit_status = exitStatus;
    state.pipeline[phase].completed_at = new Date().toISOString();
    if (summary) state.pipeline[phase].summary = summary.slice(0, 500);
    state.pipeline[phase].first_pass = exitStatus === 'DONE';
  }

  const nextResult = advance(changeName, {
    exit_status: exitStatus,
    summary: summary,
  });

  if (nextResult.next_action === 'automated') {
    return cmdRunAutomated([changeName], depth);
  }

  output(nextResult);
}

// ─── CLI: status ───

export function cmdStatus(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs status <change-name> [--json]');

  const state = stateLoad(changeName);
  const json = args.includes('--json');

  if (json) {
    let rdStatus = null;
    try {
      const out = execSync(`rd status --change "${changeName}" --json`, { encoding: 'utf8', cwd: PROJECT_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
      rdStatus = JSON.parse(out);
    } catch (e) { debugLog('rd status not available —', e.message); }

    output({ pipeline_state: state, rd_status: rdStatus });
  } else {
    console.log(`Change: ${state.change_name}`);
    console.log(`Title:  ${state.title}`);
    console.log(`Phase:  ${state.current_phase}`);
    console.log(`Flow:   ${state.flow_type}`);
    console.log(`\nPipeline:`);
    for (const [phase, data] of Object.entries(state.pipeline)) {
      const icon = data.status === 'done' ? '✓' : data.status === 'in_progress' ? '●' : data.status === 'blocked' ? '⚠' : '○';
      let dispatchInfo = '';
      if (data.dispatch_history && data.dispatch_history.length > 0) {
        const rounds = data.dispatch_history
          .filter(h => h.started_at && h.completed_at)
          .map((h, i) => {
            const dur = Math.round((new Date(h.completed_at) - new Date(h.started_at)) / 1000);
            const m = Math.floor(dur / 60);
            const s = dur % 60;
            return `#${i + 1} ${m}m${String(s).padStart(2, '0')}s`;
          });
        if (rounds.length > 0) dispatchInfo = ` [${rounds.join(', ')}]`;
      }
      console.log(`  ${icon} ${phase}: ${data.status}${data.exit_status ? ` (${data.exit_status})` : ''}${dispatchInfo}${data.summary ? ` — ${data.summary.slice(0, 80)}` : ''}`);
    }
    console.log(`\nRework count: ${JSON.stringify(state.rework_count)}`);
    console.log(`Blocked count: ${state.blocked_count}`);
  }
}

// ─── CLI: dashboard ───

export function cmdDashboard(args) {
  const showAll = args.includes('--all');
  const tasks = showAll ? stateListAll() : stateListActive();
  const json = args.includes('--json');
  const showEfficiency = args.includes('--show-efficiency');

  if (json) {
    output(tasks.map(t => {
      const summary = summarizeState(t);
      summary.dispatch_efficiency = t.dispatch_efficiency || null;
      return summary;
    }));
    return;
  }

  if (tasks.length === 0) {
    console.log(showAll ? 'No tasks found.' : 'No active tasks.');
    return;
  }

  tasks.sort((a, b) => {
    const aActive = a.current_phase !== 'completed';
    const bActive = b.current_phase !== 'completed';
    if (aActive !== bActive) return aActive ? -1 : 1;
    const aBlocked = a.current_phase === 'blocked' || a.blocked_count >= 3;
    const bBlocked = b.current_phase === 'blocked' || b.blocked_count >= 3;
    if (aBlocked !== bBlocked) return bBlocked ? 1 : -1;
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });

  let headers = '| 任务 | 流程 | 当前阶段 | 进度 | 开始时间 | 已耗时 | 得分 | 返工 | 阻塞 |';
  let seps =   '|------|------|----------|------|----------|--------|------|------|------|';
  if (showEfficiency) {
    headers += ' 首产物耗时 | 总调度数 | PM到归档 |';
    seps +=   '----------|----------|----------|';
  }
  headers += ' 阶段进度 |';
  seps +=   '----------|';

  console.log(headers);
  console.log(seps);

  for (const t of tasks) {
    const pipeline = t.pipeline || {};
    const phases = Object.keys(pipeline);
    const countedPhases = getCountedPhases(t);

    const doneCount = countedPhases.filter(p => pipeline[p].status === 'done' || pipeline[p].status === 'done_with_concerns').length;
    const progress = `${doneCount}/${countedPhases.length}`;

    const startedPhases = phases.filter(p => pipeline[p].started_at);
    let startedAt = '-';
    let elapsed = '-';
    if (startedPhases.length > 0) {
      const firstStart = startedPhases.map(p => new Date(pipeline[p].started_at).getTime()).sort((a, b) => a - b)[0];
      const d = new Date(firstStart);
      startedAt = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      if (t.current_phase === 'completed' && t.completed_at) {
        elapsed = formatDuration(new Date(t.completed_at) - firstStart);
      } else {
        elapsed = formatDuration(Date.now() - firstStart);
      }
    }

    const scoreEntries = Object.entries(t.scores || {}).filter(([, v]) => v !== null && v !== undefined);
    const latestScore = scoreEntries.length > 0 ? scoreEntries[scoreEntries.length - 1][1] : '-';

    const totalRework = Object.values(t.rework_count || {}).reduce((a, b) => a + b, 0);

    const phaseStatus = phases.map(p => {
      const s = pipeline[p].status;
      if (s === 'done' || s === 'done_with_concerns') return `${p}✓`;
      if (s === 'blocked') return `${p}⚠`;
      if (s === 'in_progress') return `${p}●`;
      return `${p}○`;
    }).join(' ');

    const phaseDisplay = t.current_phase === 'completed' ? '✅ completed' : t.current_phase;
    let row = `| ${t.change_name} | ${t.flow_type} | ${phaseDisplay} | ${progress} | ${startedAt} | ${elapsed} | ${latestScore} | ${totalRework} | ${t.blocked_count} |`;
    if (showEfficiency) {
      const eff = t.dispatch_efficiency || {};
      const firstArtifact = eff.pm_to_first_artifact_ms != null ? formatDuration(eff.pm_to_first_artifact_ms) : 'n/a';
      const totalDispatch = eff.total_dispatch_count != null ? String(eff.total_dispatch_count) : 'n/a';
      const pmToArchive = eff.pm_to_archive_ms != null ? formatDuration(eff.pm_to_archive_ms) : '进行中';
      row += ` ${firstArtifact} | ${totalDispatch} | ${pmToArchive} |`;
    }
    row += ` ${phaseStatus} |`;
    console.log(row);
  }
}

// ─── CLI: stats ───

export function cmdStats(args) {
  const json = args.includes('--json');
  const tasks = stateListAll();

  if (tasks.length === 0) {
    console.log('No tasks found.');
    process.exit(0);
  }

  const rules = parseRules(RULES_PATH);
  const statsResult = computeStats(tasks, rules.phaseSkillMap);

  if (json) {
    const roles = statsResult.roles.map(s => ({
      role: s.role, task_count: s.task_count, first_pass_count: s.first_pass_count,
      first_pass_rate: s.first_pass_rate, rework_count: s.rework_count,
      avg_score: s.avg_score, avg_duration_ms: s.avg_duration_ms,
      blocked_count: s.blocked_count, total_input_tokens: s.total_input_tokens,
      total_output_tokens: s.total_output_tokens, primary_model: s.primary_model,
      avg_first_pass_rate: s.avg_first_pass_rate, common_rework_reasons: s.common_rework_reasons,
    }));
    const advanced = computeAdvancedStats(tasks, rules.phaseSkillMap);
    output({
      roles, phase_durations: statsResult.phase_durations,
      context_modes: statsResult.context_modes,
      context_upgrades: statsResult.context_upgrades,
      advanced,
    });
    return;
  }

  const hdr = '| 角色 | 任务数 | 一次通过 | 返工 | 平均分 | 平均耗时 | 阻塞 | 模型 | Token消耗 |';
  const sep = '|------|--------|----------|------|--------|----------|------|------|-----------|';
  console.log(hdr);
  console.log(sep);
  for (const s of statsResult.roles) {
    const fp = s.task_count > 0 ? `${s.first_pass_count}(${Math.round(s.first_pass_rate * 100)}%)` : '0';
    const sc = s.avg_score !== null ? String(s.avg_score) : 'n/a';
    const model = s.primary_model || '-';
    const tokenStr = (s.total_input_tokens > 0 || s.total_output_tokens > 0)
      ? `${s.total_input_tokens}in/${s.total_output_tokens}out`
      : '-';
    console.log(`| ${s.role} | ${s.task_count} | ${fp} | ${s.rework_count} | ${sc} | ${formatDuration(s.avg_duration_ms)} | ${s.blocked_count} | ${model} | ${tokenStr} |`);
  }
}

// ─── CLI: complete ───

export function cmdComplete(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs complete <change-name>');

  const state = stateLoad(changeName);

  if (!state.quality_metrics) {
    state.quality_metrics = {
      first_pass_rate: null, total_rework_loops: 0, automated_catches: 0,
      time_to_first_code_review_ms: null, total_wall_clock_ms: null,
      phases_completed: 0, phases_total: 0,
    };
  }

  const now = new Date().toISOString();
  if (state.created_at) {
    state.quality_metrics.total_wall_clock_ms = new Date(now) - new Date(state.created_at);
  }

  if (state.pipeline['code-review'] && state.pipeline['code-review'].completed_at && state.created_at) {
    state.quality_metrics.time_to_first_code_review_ms = new Date(state.pipeline['code-review'].completed_at) - new Date(state.created_at);
  }

  {
    const phasesWithFP = Object.values(state.pipeline).filter(p => p.first_pass !== null && p.first_pass !== undefined);
    if (phasesWithFP.length > 0) {
      const passCount = phasesWithFP.filter(p => p.first_pass === true).length;
      state.quality_metrics.first_pass_rate = Math.round((passCount / phasesWithFP.length) * 100) / 100;
    }
  }

  {
    let total = 0;
    for (const ph of Object.values(state.pipeline)) {
      if (ph.dispatch_history && ph.dispatch_history.length > 1) {
        total += ph.dispatch_history.length - 1;
      }
    }
    state.quality_metrics.total_rework_loops = total;
  }

  const allPhases = Object.keys(state.pipeline);
  state.quality_metrics.phases_total = allPhases.length;
  state.quality_metrics.phases_completed = allPhases.filter(p => state.pipeline[p].status !== 'pending').length;

  state.current_phase = 'completed';
  state.completed_at = now;
  stateSave(changeName, state);

  const sharedDir = getSharedStateDirFn(changeName);
  if (existsSync(sharedDir)) {
    try { rmSync(sharedDir, { recursive: true, force: true }); } catch (e) { debugLog('sharedDir cleanup failed —', e.message); }
  }

  output({ change_name: changeName, action: 'completed' });
}

// ─── CLI: parse-intent ───

export function cmdParseIntent(args) {
  const intentJson = getArg(args, '--intent-json');
  const rawInput = getArg(args, '--raw-input');

  if (!intentJson && !rawInput) {
    errExit('parse-intent requires --intent-json or --raw-input');
  }

  if (!intentJson) {
    const rawOnlyResult = {
      action: 'parse_intent',
      raw_input: rawInput,
      status: 'needs_llm_reasoning',
      message: '请在 SKILL.md 中使用 LLM 推理完成意图解析，然后用 --intent-json 传入结果',
    };
    console.log(JSON.stringify(rawOnlyResult, null, 2));
    return;
  }

  let intent;
  try {
    intent = JSON.parse(intentJson);
  } catch (e) {
    errExit('Invalid JSON in --intent-json: ' + e.message);
  }

  const validTaskTypes = ['development', 'docs', 'hotfix', 'refactor', 'test-only', 'config-change'];

  if (!intent.task_type || !validTaskTypes.includes(intent.task_type)) {
    errExit(`Invalid task_type: ${intent.task_type}. Must be one of: ${validTaskTypes.join(', ')}`);
  }

  if (intent.change_name && !/^[a-zA-Z0-9_-]+$/.test(intent.change_name)) {
    errExit(`Invalid change_name: ${intent.change_name}. Must be kebab-case (letters, digits, hyphens, underscores)`);
  }

  const VALID_CONTEXT_MODES = ['full', 'read_only', 'minimal'];
  const rawContextMode = intent.context_mode;
  const isStringMode = typeof rawContextMode === 'string';
  const isValidMode = isStringMode && VALID_CONTEXT_MODES.includes(rawContextMode);
  const context_mode = isValidMode ? rawContextMode : 'full';
  const contextModeDegraded = isStringMode && !isValidMode && rawContextMode !== '';

  const parsed = {
    action: 'parse_intent',
    raw_input: intent.raw_input || rawInput || '',
    task_type: intent.task_type,
    confidence: typeof intent.confidence === 'number' ? intent.confidence : 0.5,
    change_name: intent.change_name || null,
    title: intent.title || null,
    criteria: Array.isArray(intent.criteria) ? intent.criteria : [],
    modules: Array.isArray(intent.modules) ? intent.modules : [],
    complexity_hint: ['S', 'M', 'L', 'XL'].includes(intent.complexity_hint) ? intent.complexity_hint : null,
    sub_intents: Array.isArray(intent.sub_intents) ? intent.sub_intents : [],
    context_mode,
    parsed_at: new Date().toISOString(),
  };

  if (parsed.confidence < 0.7 && contextModeDegraded) {
    parsed.warning = `Low confidence - PM confirmation recommended; context_mode '${rawContextMode}' is invalid, degraded to 'full'`;
  } else if (parsed.confidence < 0.7) {
    parsed.warning = 'Low confidence - PM confirmation recommended';
  } else if (contextModeDegraded) {
    parsed.warning = `context_mode '${rawContextMode}' is invalid, degraded to 'full'`;
  }

  console.log(JSON.stringify(parsed, null, 2));
}

// ─── CLI: dispatch-prompt ───

export function cmdDispatchPrompt(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs dispatch-prompt <change-name>');

  const state = stateLoad(changeName);
  const phase = state.current_phase;
  const nextRole = getRole(parseRules(RULES_PATH), phase);
  const agentFile = ROLE_AGENT_MAP[nextRole];
  if (!agentFile) errExit(`No agent definition for role '${nextRole}'. Known roles: ${Object.keys(ROLE_AGENT_MAP).join(', ')}`);

  const agentPath = join(CLAUDE_DIR, 'agents', agentFile);
  if (!existsSync(agentPath)) errExit(`Agent definition file not found: ${agentPath}`);

  const rawContent = readFileSync(agentPath, 'utf8');
  const agentDir = dirname(agentPath);
  const expandedContent = expandAgentIncludes(rawContent, agentDir);
  const agentLines = expandedContent.split('\n').length;

  const title = state.title || changeName;
  const prevSummary = getPreviousSummary(state, phase);

  if (agentLines < 50) {
    errExit(`Agent definition ${agentFile} is only ${agentLines} lines — too short, likely corrupted or empty. Expected 50+ lines.`);
  }

  const intent = {
    criteria: state.acceptance_criteria || [],
    context_mode: state.intent?.context_mode || 'full',
  };
  const contextPack = assembleContextPack(changeName, intent, intent.context_mode, phase);

  output({
    role: nextRole, agent_path: agentPath, change_name: changeName, title,
    phase,
    acceptance_criteria: state.acceptance_criteria || [],
    previous_summary: prevSummary,
    context_pack: contextPack,
    validation: {
      agent_file_exists: true, agent_line_count: agentLines,
      agent_min_threshold: 50, passed: agentLines >= 50,
      agent_file_content: expandedContent,
    },
  });
}

// ─── CLI: recommend-mode ───

export function cmdRecommendMode(args) {
  const intentJson = getArg(args, '--intent-json');
  if (!intentJson) {
    errExit('recommend-mode requires --intent-json');
  }
  let intent;
  try {
    intent = JSON.parse(intentJson);
  } catch (e) {
    errExit('Invalid JSON in --intent-json: ' + e.message);
  }
  const result = recommendMode(intent);
  output(result);
}

// ─── CLI: verify-quick ───

export function cmdVerifyQuick(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs verify-quick <change-name>');

  const state = stateLoad(changeName);
  const concerns = [];
  let allArtifactsExist = true;

  for (const [phase, data] of Object.entries(state.pipeline || {})) {
    if (data.artifact_paths && data.artifact_paths.length > 0) {
      for (const ap of data.artifact_paths) {
        const fullPath = join(PROJECT_ROOT, ap);
        if (!existsSync(fullPath)) {
          concerns.push(`Missing artifact: ${ap} (from ${phase})`);
          allArtifactsExist = false;
        }
      }
    }
  }

  let gitDiffNonEmpty = true;
  try {
    const diff = execSync('git diff --stat', { encoding: 'utf8', cwd: PROJECT_ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    if (!diff || diff.trim() === '') {
      gitDiffNonEmpty = false;
      concerns.push('No file changes detected (git diff is empty)');
    }
  } catch (e) { debugLog('git diff --stat failed —', e.message); }

  const exitStatus = (allArtifactsExist && gitDiffNonEmpty) ? 'DONE' : 'DONE_WITH_CONCERNS';

  output({
    change_name: changeName, exit_status: exitStatus,
    details: concerns.length > 0 ? concerns : ['All checks passed'],
    artifacts_exist: allArtifactsExist,
    git_diff_non_empty: gitDiffNonEmpty,
  });
}

// ─── CLI: upgrade-to-full ───

export function cmdUpgradeToFull(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs upgrade-to-full <change-name>');

  const state = stateLoad(changeName);
  if (state.flow_type !== 'quick') {
    errExit(`Cannot upgrade: change '${changeName}' is not quick flow (current: ${state.flow_type})`);
  }

  const intent = state.intent;
  const phases = getPipelinePhases('development');
  const pipeline = {};
  for (const p of phases) {
    pipeline[p] = { status: 'pending', rd_skill: null, first_pass: null, rework_reasons: [], artifact_paths: [] };
  }

  state.flow_type = 'development';
  state.hotfix_mode = false;
  state.docs_mode = false;
  state.pipeline = pipeline;
  state.current_phase = 'intake';

  state.quality_gates = {
    'QG-ARCH-001': 'pending', 'QG-DEV-001': 'pending',
    'QG-REV-001': 'pending', 'QG-REV-002': 'pending',
  };
  state.scores = { architect: null, reviewer: null, tester: null };
  state.rework_count = { architect: 0, developer: 0, tester: 0, reviewer: 0 };

  if (!state.adaptive_overrides) state.adaptive_overrides = { skipped_phases: [], forced_phases: [], pre_guidance_history: [] };
  state.adaptive_overrides.pre_guidance_history.push({
    phase: 'upgrade', role: 'system',
    guidance: `Upgraded from quick to development pipeline: sub-agent reported task_too_large`,
    injected_at: new Date().toISOString(),
  });

  state.quality_metrics.phases_total = phases.length;
  state.quality_metrics.phases_completed = 0;

  stateSave(changeName, state);

  output({
    change_name: changeName, action: 'upgraded_to_full',
    previous_flow_type: 'quick', new_flow_type: 'development',
    current_phase: 'intake',
    reason: 'sub-agent reported BLOCKED(task_too_large)',
    intent_preserved: !!intent,
  });
}

// ─── CLI: read-shared-state ───

export function cmdReadSharedState(args) {
  const changeName = args[0];
  const key = getArg(args, '--key') || null;
  const status = getArg(args, '--status') || null;

  if (!changeName) errExit('Usage: orchestrator.mjs read-shared-state <change-name> [--key <key>] [--status <status>]');

  const stateDir = getSharedStateDirFn(changeName);
  if (!existsSync(stateDir)) {
    output({ change_name: changeName, key: key, exists: false, data: null });
    return;
  }

  const data = {};
  if (key) {
    const filePath = join(stateDir, `${key}.json`);
    if (!existsSync(filePath)) {
      output({ change_name: changeName, key: key, exists: false, data: null });
      return;
    }
    let content = JSON.parse(readFileSync(filePath, 'utf8'));

    if (status && key === 'concerns' && content.concerns) {
      content.concerns = content.concerns.filter(c => c.status === status);
    }

    data[key] = content;
  } else {
    const files = readdirSync(stateDir);
    for (const f of files) {
      if (f.endsWith('.json')) {
        const k = f.slice(0, -5);
        data[k] = JSON.parse(readFileSync(join(stateDir, f), 'utf8'));
      }
    }
  }

  output({ change_name: changeName, key: key, status: status, exists: true, data: data });
}

// ─── CLI: write-shared-state ───

export function cmdWriteSharedState(args) {
  const changeName = args[0];
  const key = getArg(args, '--key');
  const jsonData = getArg(args, '--json');

  if (!changeName) errExit('Usage: orchestrator.mjs write-shared-state <change-name> --key <key> --json <json-data>');
  if (!key) errExit('--key is required');
  if (!jsonData) errExit('--json is required');

  const stateDir = getSharedStateDirFn(changeName);
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });

  let data;
  try {
    data = JSON.parse(jsonData);
  } catch (e) {
    errExit('Invalid JSON in --json: ' + e.message);
  }

  const filePath = join(stateDir, `${key}.json`);

  const tmpFile = `${filePath}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmpFile, filePath);

  output({ change_name: changeName, key: key, written: true, path: filePath });
}

// ─── CLI: resolve-concern ───

export function cmdResolveConcern(args) {
  const changeName = args[0];
  const concernId = getArg(args, '--concern-id');

  if (!changeName) errExit('Usage: orchestrator.mjs resolve-concern <change-name> --concern-id <id>');
  if (!concernId) errExit('--concern-id is required');

  const stateDir = getSharedStateDirFn(changeName);
  const filePath = join(stateDir, 'concerns.json');

  if (!existsSync(filePath)) {
    errExit(`concerns.json not found for ${changeName}`);
  }

  let content;
  try {
    content = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (e) {
    errExit('Failed to parse concerns.json: ' + e.message);
  }

  if (!content.concerns || !Array.isArray(content.concerns)) {
    errExit('Invalid concerns.json format');
  }

  const now = new Date().toISOString();
  let resolved = false;

  for (const concern of content.concerns) {
    if (concern.id === concernId) {
      concern.status = 'resolved';
      concern.resolved_by = 'AI-Developer';
      concern.resolved_at = now;
      resolved = true;
      break;
    }
  }

  if (!resolved) {
    errExit(`Concern ${concernId} not found`);
  }

  const tmpFile = `${filePath}.tmp`;
  writeFileSync(tmpFile, JSON.stringify(content, null, 2), 'utf8');
  renameSync(tmpFile, filePath);

  output({ change_name: changeName, concern_id: concernId, resolved: true, resolved_at: now });
}

// ─── CLI: sync-interfaces ───

function extractInterfaceChanges(designMdPath) {
  if (!existsSync(designMdPath)) return [];

  const designContent = readFileSync(designMdPath, 'utf8');
  const interfaces = [];

  const routePattern = /(POST|GET|PUT|DELETE|PATCH)\s+([^\s#\n]+)/gi;
  let match;

  while ((match = routePattern.exec(designContent)) !== null) {
    interfaces.push({
      name: `${match[1].toUpperCase()} ${match[2].trim()}`,
      operation: match[1].toLowerCase(),
      changes: [{ type: 'create', description: `New interface defined in design.md` }],
      status: 'proposed'
    });
  }

  return interfaces;
}

export function cmdSyncInterfaces(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs sync-interfaces <change-name>');

  const specDir = join(PROJECT_ROOT, '.harness', 'spec', 'changes', changeName);
  const designPath = join(specDir, 'design.md');
  const sharedDir = getSharedStateDirFn(changeName);
  const outputPath = join(sharedDir, 'interface-changes.yaml');

  if (!existsSync(designPath)) {
    errExit(`design.md not found for ${changeName}`);
  }

  if (!existsSync(sharedDir)) mkdirSync(sharedDir, { recursive: true });

  const interfaces = extractInterfaceChanges(designPath);

  const yamlContent = `version: 1.0
created_by: AI-Architect
created_at: ${new Date().toISOString()}
interfaces:
${interfaces.map(i => `  - name: "${i.name}"
    operation: ${i.operation}
    changes:
      - type: ${i.changes[0].type}
        description: ${i.changes[0].description}
    status: ${i.status}`).join('\n')}
`;

  const tmpFile = `${outputPath}.tmp`;
  writeFileSync(tmpFile, yamlContent, 'utf8');
  renameSync(tmpFile, outputPath);

  output({
    change_name: changeName,
    interfaces_found: interfaces.length,
    interfaces: interfaces,
    output_path: outputPath
  });

  if (interfaces.length > 0) {
    console.log(`\nDetected ${interfaces.length} interface(s):`);
    interfaces.forEach(i => console.log(`  - ${i.name}`));
  }
}

// ─── CLI: archive-interfaces ───

export function cmdArchiveInterfaces(args) {
  const changeName = args[0];
  if (!changeName) errExit('Usage: orchestrator.mjs archive-interfaces <change-name>');

  const sharedDir = getSharedStateDirFn(changeName);
  const srcPath = join(sharedDir, 'interface-changes.yaml');

  if (!existsSync(srcPath)) {
    output({ change_name: changeName, archived: false, reason: 'interface-changes.yaml not found' });
    return;
  }

  const archiveDir = join(PROJECT_ROOT, '.harness', 'interfaces', changeName);
  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  const destPath = join(archiveDir, 'interface-changes.yaml');
  copyFileSync(srcPath, destPath);

  const indexPath = join(PROJECT_ROOT, '.harness', 'interfaces', 'index.md');
  let indexContent = '# Interface Changes Index\n\n';
  if (existsSync(indexPath)) {
    const existingContent = readFileSync(indexPath, 'utf8');
    const headerMatch = existingContent.match(/^#.*?\n\n/);
    if (headerMatch) indexContent = headerMatch[0];
  }

  indexContent += `## ${changeName}\n\nArchived at: ${new Date().toISOString()}\n`;

  const tmpIndex = `${indexPath}.tmp`;
  writeFileSync(tmpIndex, indexContent, 'utf8');
  renameSync(tmpIndex, indexPath);

  output({
    change_name: changeName, archived: true,
    archive_path: destPath, index_updated: true
  });
}

// ─── CLI: parse-tasks-md ───

export function cmdParseTasksMd(args) {
  const changeDir = getArg(args, '--change-dir');
  if (!changeDir) errExit('Usage: orchestrator.mjs parse-tasks-md --change-dir <directory>');

  const workItems = parseTasksMdFn(changeDir);
  output({ work_items: workItems, count: workItems.length });
}

// ─── Intent Classification ───

let _icCache = null;
function parseIntentClassification() {
  if (_icCache) return _icCache;
  const defaults = {
    categoryRoleMap: [],
    confidenceThresholds: { HIGH: 0.85, MEDIUM: 0.70, LOW: 0.70 },
    followUpSuggestions: {},
    complexityThresholds: { quick_dispatch: 40, upgrade_to_full: 70, ask_pm: 55 },
    complexityWeights: { file_count: 35, module_impact: 25, code_complexity: 40 },
    complexityAnalysis: { lines_per_point: 12, complexity_per_point: 1.7, control_flow_weight: 2, function_weight: 3, indent_weight: 0.5 },
  };
  if (!existsSync(RULES_PATH)) return defaults;

  const yaml = loadRulesYaml(RULES_PATH);
  const ic = yaml?.intent_classification;
  if (!ic) return defaults;

  const categoryRoleMap = (ic.category_role_map || []).map(e => ({
    intent_category: e.intent_category,
    target_role: e.target_role,
    condition: e.condition || 'always',
  }));

  const confidenceThresholds = { ...defaults.confidenceThresholds, ...ic.confidence_thresholds };
  const complexityThresholds = { ...defaults.complexityThresholds, ...ic.complexity_thresholds };
  const complexityWeights = { ...defaults.complexityWeights, ...ic.complexity_weights };
  const complexityAnalysis = { ...defaults.complexityAnalysis, ...ic.complexity_analysis };
  const followUpSuggestions = ic.follow_up_suggestions || {};

  const result = { categoryRoleMap, confidenceThresholds, complexityThresholds, complexityWeights, complexityAnalysis, followUpSuggestions };
  _icCache = result;
  return result;
}

function routeIntent(intentCategory, affectedFiles) {
  const { categoryRoleMap } = parseIntentClassification();
  const numFiles = Array.isArray(affectedFiles) ? affectedFiles.length : (typeof affectedFiles === 'number' ? affectedFiles : 999);

  const matches = categoryRoleMap.filter(e => e.intent_category === intentCategory);
  if (matches.length === 0) return null;

  if (intentCategory === 'quick_change') {
    const selfEntry = matches.find(e => e.target_role === 'main_session_self' && /<=\s*2/.test(e.condition));
    if (selfEntry && numFiles <= 2) return 'main_session_self';
    const devEntry = matches.find(e => e.target_role === 'Developer');
    if (devEntry) return 'Developer';
  }

  if (intentCategory === 'complex_feature') return 'full pipeline';

  return matches[0].target_role;
}

function getConfidenceTier(confidence) {
  const { confidenceThresholds } = parseIntentClassification();
  if (confidence >= confidenceThresholds.HIGH) return 'HIGH';
  if (confidence >= confidenceThresholds.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

function getRoutingDecision(intent, complexity) {
  const { complexityThresholds, confidenceThresholds } = parseIntentClassification();
  const confidence = intent.confidence ?? 0.5;
  const targetRole = routeIntent(intent.intent_category, intent.affected_files);

  if (complexity >= complexityThresholds.upgrade_to_full) {
    return {
      action: 'upgrade_to_full', route_to: 'full pipeline',
      reason: `complexity ${complexity.toFixed(1)} >= ${complexityThresholds.upgrade_to_full}, upgrade to full pipeline recommended`,
    };
  }

  if (confidence < confidenceThresholds.LOW) {
    return {
      action: 'self_handle', route_to: targetRole,
      reason: `confidence ${confidence} < ${confidenceThresholds.LOW}, main session handles directly (complexity: ${complexity.toFixed(1)})`,
    };
  }

  if (complexity >= complexityThresholds.ask_pm && confidence < confidenceThresholds.MEDIUM) {
    return {
      action: 'needs_pm', route_to: targetRole,
      reason: `complexity ${complexity.toFixed(1)} in [${complexityThresholds.ask_pm}, ${complexityThresholds.upgrade_to_full}) and confidence ${confidence} < ${confidenceThresholds.MEDIUM}, PM confirmation needed`,
    };
  }

  if (complexity < complexityThresholds.quick_dispatch && confidence >= confidenceThresholds.MEDIUM) {
    return {
      action: 'auto_dispatch', route_to: targetRole,
      reason: `complexity ${complexity.toFixed(1)} < ${complexityThresholds.quick_dispatch} and confidence ${confidence} >= ${confidenceThresholds.MEDIUM}, auto dispatch`,
    };
  }

  if (complexity < complexityThresholds.upgrade_to_full && confidence >= confidenceThresholds.HIGH) {
    return {
      action: 'auto_dispatch', route_to: targetRole,
      reason: `complexity ${complexity.toFixed(1)} < ${complexityThresholds.upgrade_to_full} and confidence ${confidence} >= ${confidenceThresholds.HIGH}, auto dispatch`,
    };
  }

  if (confidence >= confidenceThresholds.MEDIUM && confidence < confidenceThresholds.HIGH) {
    return {
      action: 'needs_pm', route_to: targetRole,
      reason: `confidence ${confidence} in [${confidenceThresholds.MEDIUM}, ${confidenceThresholds.HIGH}), PM confirmation required (complexity: ${complexity.toFixed(1)})`,
    };
  }

  return {
    action: 'needs_pm', route_to: targetRole,
    reason: `complexity ${complexity.toFixed(1)} and confidence ${confidence} require PM judgment`,
  };
}

// ─── Complexity Estimation ───

const complexityAnalyzers = {
  file_count: (intent, weights) => {
    const numFiles = intent.affected_files?.length || 0;
    return Math.min(numFiles * 10, weights.file_count);
  },
  module_impact: (intent, weights) => {
    const numModules = intent.modules?.length || 0;
    return Math.min(numModules * 7, weights.module_impact);
  },
  code_complexity: (intent, weights) => {
    let codeScore = 0;
    if (intent.affected_files && intent.affected_files.length > 0) {
      codeScore = analyzeCodeComplexity(intent.affected_files);
    }
    return Math.min(codeScore, weights.code_complexity);
  },
};

function estimateComplexity(intent) {
  const { complexityWeights } = parseIntentClassification();
  let score = 0;

  for (const [key, weight] of Object.entries(complexityWeights)) {
    const analyzer = complexityAnalyzers[key];
    if (analyzer && typeof analyzer === 'function') {
      const dimensionScore = analyzer(intent, complexityWeights);
      score += dimensionScore;
    }
  }

  const totalWeight = Object.values(complexityWeights).reduce((sum, w) => sum + w, 0);
  const normalizedScore = totalWeight > 0 ? (score / totalWeight) * 100 : 0;

  return Math.min(normalizedScore, 100);
}

function analyzeCodeComplexity(files) {
  let totalLines = 0;
  let totalComplexity = 0;

  for (const file of files) {
    if (!existsSync(file)) {
      console.warn(`[complexity analysis] File not found: ${file}`);
      continue;
    }

    try {
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n').length;
      const complexity = estimateFileComplexity(content);

      totalLines += lines;
      totalComplexity += complexity;
    } catch (e) {
      console.warn(`[complexity analysis] Failed to read file: ${file}`, e.message);
    }
  }

  const avgComplexity = files.length > 0 ? totalComplexity / files.length : 0;
  const lineFactor = Math.min(totalLines / 200, 1);
  const complexityFactor = Math.min(avgComplexity / 30, 1);

  return (lineFactor * 17) + (complexityFactor * 18);
}

function estimateFileComplexity(content) {
  const { complexityAnalysis } = parseIntentClassification();
  let complexity = 0;

  const codeWithoutComments = content
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '');

  const complexityPatterns = [
    { pattern: /\b(?:if|else\s+if|for|while|switch|case|catch|finally|try)\s*\(/g, weight: complexityAnalysis.control_flow_weight },
    { pattern: /\?/g, weight: complexityAnalysis.control_flow_weight },
    { pattern: /\b(?:function|def|fn)\s+\w+/g, weight: complexityAnalysis.function_weight },
    { pattern: /\b(?:public|private)\s+\w+\s+\w+\s*\(/g, weight: complexityAnalysis.function_weight },
  ];

  for (const { pattern, weight } of complexityPatterns) {
    const matches = codeWithoutComments.match(pattern);
    if (matches) complexity += matches.length * weight;
  }

  const lines = content.split('\n');
  let maxDepth = 0;
  for (const line of lines) {
    const indent = line.search(/\S/);
    if (indent > maxDepth) maxDepth = indent;
  }
  complexity += maxDepth * complexityAnalysis.indent_weight;

  return complexity;
}

function checkDuplicateDispatch(intentCategory, fileScope) {
  const activeTasks = stateListActive();
  const scopeSet = new Set(fileScope || []);

  for (const task of activeTasks) {
    if (task.current_phase === 'completed') continue;
    if (task.intent && task.intent.intent_category === intentCategory) {
      const taskFiles = new Set(task.intent.affected_files || []);
      const overlap = [...scopeSet].some(f => taskFiles.has(f));
      if (overlap || scopeSet.size === 0) {
        return { duplicate: true, existing_change: task.change_name, existing_phase: task.current_phase };
      }
    }
  }

  const tasksDir = getTasksDir();
  if (!existsSync(tasksDir)) return { duplicate: false };
  const allTasks = stateListAll();
  const now = Date.now();
  for (const task of allTasks) {
    if (!task.intent || task.intent.intent_category !== intentCategory) continue;
    const updated = task.updated_at ? new Date(task.updated_at).getTime() : 0;
    if (now - updated < 24 * 60 * 60 * 1000) {
      const taskFiles = new Set(task.intent.affected_files || []);
      const overlap = [...scopeSet].some(f => taskFiles.has(f));
      if (overlap || (scopeSet.size === 0 && task.intent.intent_category === intentCategory)) {
        return { duplicate: true, existing_change: task.change_name, existing_phase: task.current_phase, from_history: true };
      }
    }
  }

  return { duplicate: false };
}

// ─── CLI: quick-dispatch ───

export function cmdQuickDispatch(args) {
  const intentJson = getArg(args, '--intent-json');
  const changeName = getArg(args, '--change-name') || null;

  if (!intentJson) {
    errExit('quick-dispatch requires --intent-json');
  }

  let intent;
  try {
    intent = JSON.parse(intentJson);
  } catch (e) {
    errExit('Invalid JSON in --intent-json: ' + e.message);
  }

  const missingFields = [];
  if (!intent.intent_category) missingFields.push('intent_category');
  if (!intent.title) missingFields.push('title');
  if (!intent.criteria || (Array.isArray(intent.criteria) && intent.criteria.length === 0)) missingFields.push('criteria');

  if (missingFields.length > 0) {
    errExit(`Missing required fields in intent-json: ${missingFields.join(', ')}`);
  }

  if (!intent.task_type) intent.task_type = 'development';

  const confidence = typeof intent.confidence === 'number' ? intent.confidence : 0.5;
  const tier = getConfidenceTier(confidence);

  const complexity = estimateComplexity(intent);

  const routingDecision = getRoutingDecision(intent, complexity);

  const autoName = changeName || `quick-${intent.intent_category}-${Date.now()}`;
  const targetRole = routingDecision.route_to;

  switch (routingDecision.action) {
    case 'upgrade_to_full':
      return output({
        change_name: autoName, action: 'upgrade_to_full',
        confidence_tier: tier, complexity: complexity,
        target_role: 'full pipeline', upgrade_to_full: true,
        reason: routingDecision.reason, needs_pm: false,
        context_pack: assembleContextPack(null, intent, intent.context_mode || 'full'),
      });

    case 'self_handle':
      return output({
        change_name: autoName, action: 'self_handle',
        confidence_tier: tier, complexity: complexity,
        target_role: targetRole,
        reason: routingDecision.reason, needs_pm: false,
        context_pack: assembleContextPack(null, intent, intent.context_mode || 'full'),
      });

    case 'needs_pm': {
      const dup = checkDuplicateDispatch(intent.intent_category, intent.affected_files);
      if (dup.duplicate) {
        return output({
          change_name: dup.existing_change, action: 'duplicate_detected',
          confidence_tier: tier, complexity: complexity,
          target_role: targetRole,
          reason: `Duplicate dispatch detected: '${dup.existing_change}' is at phase ${dup.existing_phase}${dup.from_history ? ' (from recent history)' : ''}`,
          needs_pm: true,
          context_pack: assembleContextPack(null, intent, intent.context_mode || 'full'),
        });
      }

      return output({
        change_name: autoName, action: 'needs_pm_confirmation',
        confidence_tier: tier, complexity: complexity,
        target_role: targetRole ? targetRole.toLowerCase() : null,
        reason: routingDecision.reason, needs_pm: true,
        context_pack: assembleContextPack(null, intent, intent.context_mode || 'full'),
      });
    }

    case 'auto_dispatch': {
      const dup2 = checkDuplicateDispatch(intent.intent_category, intent.affected_files);
      if (dup2.duplicate) {
        return output({
          change_name: dup2.existing_change, action: 'duplicate_detected',
          confidence_tier: tier, complexity: complexity,
          target_role: targetRole,
          reason: `Duplicate dispatch detected: '${dup2.existing_change}' is at phase ${dup2.existing_phase}${dup2.from_history ? ' (from recent history)' : ''}`,
          needs_pm: true,
          context_pack: assembleContextPack(null, intent, intent.context_mode || 'full'),
        });
      }

      const state = stateInit(autoName, intent.title, Array.isArray(intent.criteria) ? intent.criteria : [intent.criteria], 'quick', false, {});
      state.intent = { ...intent, parsed_at: new Date().toISOString(), confidence_tier: tier, target_role: targetRole, complexity };
      stateSave(autoName, state);

      const contextPack = assembleContextPack(autoName, intent, intent.context_mode || 'full');

      const { followUpSuggestions } = parseIntentClassification();
      const followUps = followUpSuggestions[intent.intent_category] || [];

      return output({
        change_name: autoName, action: 'auto_dispatch',
        confidence_tier: tier, complexity: complexity,
        target_role: targetRole ? targetRole.toLowerCase() : null,
        reason: routingDecision.reason, needs_pm: false,
        pipeline: 'quick', flow_type: 'quick', current_phase: 'pending',
        context_pack: contextPack,
        follow_up_suggestions: followUps.slice(0, 3),
      });
    }

    default:
      errExit(`Unknown routing action: ${routingDecision.action}`);
  }
}
