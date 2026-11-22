// lib/stats.js — Role performance aggregation, advanced stats, token recalculation
import { parseRules } from './transitions.js';
import { RULES_PATH } from './constants.js';

// ─── Helper: format duration ───

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return 'n/a';
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

// ─── Token Recalculation ───

export function recalcTokens(state) {
  if (!state.pipeline) return;

  const rules = parseRules(RULES_PATH);
  const phaseSkillMap = rules.phaseSkillMap;

  const summary = {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    by_phase: {},
    by_role: {},
    by_model: {},
    last_calculated_at: new Date().toISOString(),
  };

  // Pre-compute role → model token totals (single pass, avoids O(n²) inner loop)
  const roleModelTotals = {}; // role -> { model -> totalTokens }
  for (const [phaseName, phase] of Object.entries(state.pipeline)) {
    const role = phaseSkillMap?.[phaseName]?.role;
    if (!role || !phase.dispatch_history) continue;
    if (!roleModelTotals[role]) roleModelTotals[role] = {};
    for (const round of phase.dispatch_history) {
      if (!round.token_usage) continue;
      const model = round.token_usage.model || 'unknown';
      const tokens = (round.token_usage.input_tokens || 0) + (round.token_usage.output_tokens || 0);
      roleModelTotals[role][model] = (roleModelTotals[role][model] || 0) + tokens;
    }
  }

  for (const [phaseName, phase] of Object.entries(state.pipeline)) {
    if (!phase.dispatch_history) continue;

    let phaseInput = 0;
    let phaseOutput = 0;
    const modelTokenMap = {}; // model -> {input, output}

    for (const round of phase.dispatch_history) {
      if (!round.token_usage) continue;
      const tu = round.token_usage;
      const input = tu.input_tokens || 0;
      const output = tu.output_tokens || 0;
      const model = tu.model || 'unknown';

      phaseInput += input;
      phaseOutput += output;

      if (!modelTokenMap[model]) modelTokenMap[model] = { input: 0, output: 0 };
      modelTokenMap[model].input += input;
      modelTokenMap[model].output += output;

      // by_model aggregation
      if (!summary.by_model[model]) {
        summary.by_model[model] = { input_tokens: 0, output_tokens: 0, dispatch_count: 0 };
      }
      summary.by_model[model].input_tokens += input;
      summary.by_model[model].output_tokens += output;
      summary.by_model[model].dispatch_count++;
    }

    if (phaseInput > 0 || phaseOutput > 0) {
      const dominantModel = Object.entries(modelTokenMap)
        .sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output))[0];
      const model = dominantModel ? dominantModel[0] : 'unknown';

      summary.by_phase[phaseName] = {
        input_tokens: phaseInput,
        output_tokens: phaseOutput,
        model,
      };

      // by_role aggregation (use pre-computed roleModelTotals for dominant model)
      const role = phaseSkillMap?.[phaseName]?.role;
      if (role) {
        if (!summary.by_role[role]) {
          summary.by_role[role] = { input_tokens: 0, output_tokens: 0, model: 'unknown' };
        }
        summary.by_role[role].input_tokens += phaseInput;
        summary.by_role[role].output_tokens += phaseOutput;
      }
    }
  }

  // Set dominant model per role from pre-computed totals
  for (const [role, modelMap] of Object.entries(roleModelTotals)) {
    if (!summary.by_role[role]) continue;
    const dominant = Object.entries(modelMap).sort((a, b) => b[1] - a[1])[0];
    summary.by_role[role].model = dominant ? dominant[0] : 'unknown';
  }

  summary.total_input_tokens = Object.values(summary.by_phase).reduce((s, p) => s + (p.input_tokens || 0), 0);
  summary.total_output_tokens = Object.values(summary.by_phase).reduce((s, p) => s + (p.output_tokens || 0), 0);
  summary.total_tokens = summary.total_input_tokens + summary.total_output_tokens;

  // Preserve existing last_calculated_at if no token data found
  if (summary.total_tokens === 0 && state.token_summary && state.token_summary.last_calculated_at) {
    summary.last_calculated_at = state.token_summary.last_calculated_at;
  }

  state.token_summary = summary;
}

// ─── Phase Role Map ───

export function buildPhaseRoleMap(phaseSkillMap) {
  const rolePhases = {};
  for (const [phase, info] of Object.entries(phaseSkillMap)) {
    const role = info.role;
    if (!role) continue;
    if (!rolePhases[role]) rolePhases[role] = [];
    rolePhases[role].push(phase);
  }
  return rolePhases;
}

// ─── Phase Duration Calculation ───

/**
 * Calculate total duration for a single phase (milliseconds)
 * Tier 1: dispatch_history sum of all rounds
 * Tier 2: old fields dispatch_started_at/dispatch_completed_at
 * Tier 3: phase-level started_at/completed_at (>= 1s)
 * Tier 4: no valid data → null
 */
export function calcPhaseDuration(ph) {
  if (ph.dispatch_history && ph.dispatch_history.length > 0) {
    const valid = ph.dispatch_history.filter(h => h.started_at && h.completed_at);
    if (valid.length > 0) {
      return valid.reduce((s, h) => s + (new Date(h.completed_at) - new Date(h.started_at)), 0);
    }
  }
  if (ph.dispatch_started_at && ph.dispatch_completed_at) {
    return new Date(ph.dispatch_completed_at) - new Date(ph.dispatch_started_at);
  }
  if (ph.started_at && ph.completed_at) {
    const d = new Date(ph.completed_at) - new Date(ph.started_at);
    return d >= 1000 ? d : null;
  }
  return null;
}

// ─── Compute Stats ───

export function computeStats(tasks, phaseSkillMap) {
  const rolePhases = buildPhaseRoleMap(phaseSkillMap);
  const stats = {};
  const roleReasons = {};

  for (const role of Object.keys(rolePhases)) {
    stats[role] = {
      role,
      task_count: 0,
      completed_task_count: 0,
      first_pass_count: 0,
      rework_count: 0,
      avg_score: null,
      avg_duration_ms: null,
      blocked_count: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      primary_model: null,
      avg_first_pass_rate: null,
      common_rework_reasons: [],
    };
    roleReasons[role] = [];
  }

  for (const task of tasks) {
    const pipeline = task.pipeline || {};

    for (const [role, phases] of Object.entries(rolePhases)) {
      const roleStat = stats[role];
      if (!roleStat) continue;

      const participatedPhases = phases.filter(p => pipeline[p] && pipeline[p].status !== 'pending');
      if (participatedPhases.length === 0) continue;

      roleStat.task_count++;

      if (task.current_phase === 'completed') {
        roleStat.completed_task_count++;
        if ((task.rework_count?.[role] ?? 0) === 0) {
          roleStat.first_pass_count++;
        }
      }

      roleStat.rework_count += (task.rework_count?.[role] ?? 0);

      if (participatedPhases.some(p => pipeline[p].exit_status === 'BLOCKED')) {
        roleStat.blocked_count++;
      }

      for (const p of participatedPhases) {
        const ph = pipeline[p];
        if (ph.rework_reasons && ph.rework_reasons.length > 0) {
          for (const reason of ph.rework_reasons) {
            roleReasons[role].push(reason);
          }
        }
      }

      // Manual scores (reviewer/debate)
      if ((role === 'reviewer' || role === 'debate') && task.scores) {
        const scoreKey = role === 'reviewer' ? 'reviewer' : 'debate';
        const s = task.scores[scoreKey];
        if (s !== undefined && s !== null) {
          if (roleStat.avg_score === null) roleStat.avg_score = { sum: 0, count: 0 };
          roleStat.avg_score.sum += s;
          roleStat.avg_score.count++;
        }
      }

      // Auto quality score for all roles
      {
        let score = 100;
        for (const p of participatedPhases) {
          const ph = pipeline[p];
          if (!ph) continue;
          if (ph.first_pass === false) score -= 15;
          if (ph.exit_status === 'BLOCKED') score -= 20;
          if (ph.exit_status === 'NEEDS_CONTEXT') score -= 10;
          if (ph.rework_reasons && ph.rework_reasons.length > 0) score -= ph.rework_reasons.length * 5;
          if (ph.first_pass === true && (!ph.dispatch_history || ph.dispatch_history.length <= 1)) score += 5;
        }
        score = Math.max(0, Math.min(100, score));
        if (roleStat.avg_score === null) {
          roleStat.avg_score = { sum: 0, count: 0, auto: true };
        }
        if (roleStat.avg_score.auto) {
          roleStat.avg_score.sum += score;
          roleStat.avg_score.count++;
        }
      }

      // avg_duration_ms
      const durations = participatedPhases
        .map(p => calcPhaseDuration(pipeline[p]))
        .filter(d => d !== null);
      if (durations.length > 0) {
        const taskDuration = durations.reduce((a, b) => a + b, 0);
        if (roleStat.avg_duration_ms === null) roleStat.avg_duration_ms = { sum: 0, count: 0 };
        roleStat.avg_duration_ms.sum += taskDuration;
        roleStat.avg_duration_ms.count++;
      }

      // Token aggregation
      if (task.token_summary && task.token_summary.by_role && task.token_summary.by_role[role]) {
        const roleToken = task.token_summary.by_role[role];
        roleStat.total_input_tokens += (roleToken.input_tokens || 0);
        roleStat.total_output_tokens += (roleToken.output_tokens || 0);
      }

      // avg_first_pass_rate
      {
        const fpPhases = participatedPhases.filter(p => pipeline[p].first_pass !== null && pipeline[p].first_pass !== undefined);
        if (fpPhases.length > 0) {
          const fpCount = fpPhases.filter(p => pipeline[p].first_pass === true).length;
          if (roleStat.avg_first_pass_rate === null) roleStat.avg_first_pass_rate = { sum: 0, count: 0 };
          roleStat.avg_first_pass_rate.sum += fpCount / fpPhases.length;
          roleStat.avg_first_pass_rate.count++;
        }
      }
    }
  }

  // Per-phase duration statistics
  const phaseDurationStats = {};
  for (const task of tasks) {
    const pipeline = task.pipeline || {};
    for (const [phaseName, ph] of Object.entries(pipeline)) {
      if (ph.status === 'pending') continue;
      const duration = calcPhaseDuration(ph);
      if (duration !== null) {
        if (!phaseDurationStats[phaseName]) phaseDurationStats[phaseName] = { sum: 0, count: 0 };
        phaseDurationStats[phaseName].sum += duration;
        phaseDurationStats[phaseName].count++;
      }
    }
  }

  // Context mode usage frequency
  const contextModeStats = {};
  let contextUpgrades = 0;
  for (const task of tasks) {
    const pipeline = task.pipeline || {};
    for (const ph of Object.values(pipeline)) {
      if (!ph.dispatch_history) continue;
      for (const round of ph.dispatch_history) {
        const mode = round.context_mode || 'full';
        if (!contextModeStats[mode]) contextModeStats[mode] = { dispatch_count: 0, total_duration_ms: 0, total_input_tokens: 0 };
        contextModeStats[mode].dispatch_count++;
        if (round.started_at && round.completed_at) {
          contextModeStats[mode].total_duration_ms += new Date(round.completed_at) - new Date(round.started_at);
        }
        if (round.token_usage) {
          contextModeStats[mode].total_input_tokens += (round.token_usage.input_tokens || 0);
        }
      }
    }
    if (task.intent?.upgraded_from) contextUpgrades++;
    if ((task.context_upgrade_attempts || 0) > 0 && !task.intent?.upgraded_from) {
      contextUpgrades += task.context_upgrade_attempts;
    }
  }

  // Finalize averages
  for (const stat of Object.values(stats)) {
    if (stat.completed_task_count === 0) {
      stat.first_pass_rate = 0;
    } else {
      stat.first_pass_rate = Math.round((stat.first_pass_count / stat.completed_task_count) * 100) / 100;
    }
    if (stat.avg_score !== null) {
      stat.avg_score = Math.round((stat.avg_score.sum / stat.avg_score.count) * 10) / 10;
    }
    if (stat.avg_duration_ms !== null) {
      stat.avg_duration_ms = Math.round(stat.avg_duration_ms.sum / stat.avg_duration_ms.count);
    }
    if (stat.total_input_tokens > 0 || stat.total_output_tokens > 0) {
      const modelTotals = {};
      for (const task of tasks) {
        if (!task.token_summary || !task.token_summary.by_role) continue;
        const roleData = task.token_summary.by_role[stat.role];
        if (roleData && roleData.model) {
          const m = roleData.model;
          if (!modelTotals[m]) modelTotals[m] = 0;
          modelTotals[m] += (roleData.input_tokens || 0) + (roleData.output_tokens || 0);
        }
      }
      const sorted = Object.entries(modelTotals).sort((a, b) => b[1] - a[1]);
      stat.primary_model = sorted.length > 0 ? sorted[0][0] : null;
    }
    if (stat.avg_first_pass_rate !== null) {
      stat.avg_first_pass_rate = Math.round((stat.avg_first_pass_rate.sum / stat.avg_first_pass_rate.count) * 100) / 100;
    }
    {
      const reasons = roleReasons[stat.role] || [];
      if (reasons.length > 0) {
        const reasonFreq = {};
        for (const r of reasons) {
          const key = r.split(':')[0] || r.substring(0, 30);
          reasonFreq[key] = (reasonFreq[key] || 0) + 1;
        }
        stat.common_rework_reasons = Object.entries(reasonFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([reason]) => reason);
      }
    }
  }

  return {
    roles: Object.values(stats),
    phase_durations: phaseDurationStats,
    context_modes: contextModeStats,
    context_upgrades: contextUpgrades,
  };
}

// ─── Percentile Helpers ───

export function calcPercentiles(sortedValues) {
  if (sortedValues.length === 0) return { p50: null, p95: null, p99: null };
  const pIdx = (p) => {
    const idx = (p / 100) * (sortedValues.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sortedValues[lo];
    return Math.round(sortedValues[lo] + (idx - lo) * (sortedValues[hi] - sortedValues[lo]));
  };
  return { p50: pIdx(50), p95: pIdx(95), p99: pIdx(99) };
}

// ─── Advanced Stats ───

export function computeAdvancedStats(tasks, phaseSkillMap) {
  const advanced = {
    lead_time: { p50: null, p95: null, p99: null, avg: null, min: null, max: null, count: 0 },
    pm_to_first_artifact_ms: { p50: null, p95: null, p99: null, avg: null, min: null, max: null, count: 0 },
    phase_duration_percentiles: [],
    rework_reasons: [],
    cost_per_task: [],
    blocked_rate: [],
    quality_gate_stats: [],
  };

  const completedTasks = tasks.filter(t => t.current_phase === 'completed' && t.created_at && t.completed_at);

  // 1. lead_time
  if (completedTasks.length > 0) {
    const leadTimes = completedTasks.map(t => new Date(t.completed_at) - new Date(t.created_at)).sort((a, b) => a - b);
    const pcts = calcPercentiles(leadTimes);
    advanced.lead_time = {
      p50: pcts.p50, p95: pcts.p95, p99: pcts.p99,
      avg: Math.round(leadTimes.reduce((s, v) => s + v, 0) / leadTimes.length),
      min: leadTimes[0], max: leadTimes[leadTimes.length - 1], count: leadTimes.length,
    };
  }

  // 2. phase_duration_percentiles
  const phaseDurations = {};
  for (const task of tasks) {
    const pipeline = task.pipeline || {};
    for (const [phaseName, ph] of Object.entries(pipeline)) {
      if (ph.status === 'pending') continue;
      const duration = calcPhaseDuration(ph);
      if (duration !== null) {
        if (!phaseDurations[phaseName]) phaseDurations[phaseName] = [];
        phaseDurations[phaseName].push(duration);
      }
    }
  }
  for (const [phase, durations] of Object.entries(phaseDurations)) {
    const sorted = durations.sort((a, b) => a - b);
    const pcts = calcPercentiles(sorted);
    advanced.phase_duration_percentiles.push({
      phase, p50: pcts.p50, p95: pcts.p95, p99: pcts.p99,
      count: sorted.length, min: sorted[0], max: sorted[sorted.length - 1],
      low_sample_count: sorted.length < 3,
    });
  }

  // 3. rework_reasons
  const reasonFreq = {};
  for (const task of tasks) {
    const pipeline = task.pipeline || {};
    for (const ph of Object.values(pipeline)) {
      if (ph.rework_reasons && ph.rework_reasons.length > 0) {
        for (const reason of ph.rework_reasons) {
          const prefix = reason.split(':')[0] || reason.substring(0, 30);
          reasonFreq[prefix] = (reasonFreq[prefix] || 0) + 1;
        }
      }
    }
  }
  const totalReasons = Object.values(reasonFreq).reduce((s, v) => s + v, 0);
  if (totalReasons > 0) {
    advanced.rework_reasons = Object.entries(reasonFreq)
      .map(([reason, count]) => ({ reason, count, percentage: Math.round((count / totalReasons) * 100) }))
      .sort((a, b) => b.count - a.count);
  }

  // 4. cost_per_task
  if (completedTasks.length > 0) {
    const byFlowType = {};
    for (const task of completedTasks) {
      const ft = task.flow_type || 'unknown';
      if (!byFlowType[ft]) byFlowType[ft] = { total_input: 0, total_output: 0, total_tokens: 0, task_count: 0 };
      const ts = task.token_summary || {};
      byFlowType[ft].total_input += ts.total_input_tokens || 0;
      byFlowType[ft].total_output += ts.total_output_tokens || 0;
      byFlowType[ft].total_tokens += ts.total_tokens || 0;
      byFlowType[ft].task_count++;
    }
    for (const [flow_type, data] of Object.entries(byFlowType)) {
      advanced.cost_per_task.push({
        flow_type,
        avg_input_tokens: Math.round(data.total_input / data.task_count),
        avg_output_tokens: Math.round(data.total_output / data.task_count),
        avg_total_tokens: Math.round(data.total_tokens / data.task_count),
        task_count: data.task_count,
      });
    }
  }

  // 5. blocked_rate
  const roleTaskCount = {};
  const roleBlockedCount = {};
  let overallTaskCount = 0;
  let overallBlockedCount = 0;

  for (const task of tasks) {
    const pipeline = task.pipeline || {};
    const rolesInTask = new Set();
    for (const [phaseName, ph] of Object.entries(pipeline)) {
      if (ph.status === 'pending') continue;
      const role = phaseSkillMap[phaseName]?.role;
      if (role) rolesInTask.add(role);
    }

    for (const role of rolesInTask) {
      roleTaskCount[role] = (roleTaskCount[role] || 0) + 1;
    }

    for (const role of rolesInTask) {
      const rolePhases = Object.entries(pipeline)
        .filter(([pn, ph]) => phaseSkillMap[pn]?.role === role && ph.exit_status === 'BLOCKED');
      if (rolePhases.length > 0) {
        roleBlockedCount[role] = (roleBlockedCount[role] || 0) + 1;
      }
    }

    overallTaskCount++;
    if (task.blocked_count > 0) overallBlockedCount++;
  }

  for (const [role, taskCount] of Object.entries(roleTaskCount)) {
    const bc = roleBlockedCount[role] || 0;
    advanced.blocked_rate.push({
      role, rate: taskCount > 0 ? Math.round((bc / taskCount) * 10000) / 10000 : 0,
      blocked_count: bc, task_count: taskCount,
    });
  }
  advanced.blocked_rate.push({
    role: 'overall',
    rate: overallTaskCount > 0 ? Math.round((overallBlockedCount / overallTaskCount) * 10000) / 10000 : 0,
    blocked_count: overallBlockedCount,
    task_count: overallTaskCount,
  });

  // 6. quality_gate_stats
  const gateStats = {};
  const knownGates = ['QG-ARCH-001', 'QG-DEV-001', 'QG-REV-001', 'QG-REV-002'];
  for (const gate of knownGates) {
    gateStats[gate] = { passed: 0, pending: 0, failed: 0 };
  }
  for (const task of tasks) {
    if (!task.quality_gates) continue;
    for (const [gate, status] of Object.entries(task.quality_gates)) {
      if (!gateStats[gate]) gateStats[gate] = { passed: 0, pending: 0, failed: 0 };
      if (status === 'passed') gateStats[gate].passed++;
      else if (status === 'failed') gateStats[gate].failed++;
      else gateStats[gate].pending++;
    }
  }
  advanced.quality_gate_stats = Object.entries(gateStats).map(([gate, stats]) => ({ gate, ...stats }));

  // 7. pm_to_first_artifact_ms
  const pmValues = [];
  for (const task of tasks) {
    const de = task.dispatch_efficiency;
    if (!de) continue;
    const val = de.pm_to_first_artifact_ms;
    if (val === null || val === undefined || typeof val !== 'number') continue;
    pmValues.push(val);
  }
  if (pmValues.length > 0) {
    const sorted = pmValues.sort((a, b) => a - b);
    const pcts = calcPercentiles(sorted);
    advanced.pm_to_first_artifact_ms = {
      p50: pcts.p50, p95: pcts.p95, p99: pcts.p99,
      avg: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
      min: sorted[0], max: sorted[sorted.length - 1], count: sorted.length,
    };
  }

  return advanced;
}
