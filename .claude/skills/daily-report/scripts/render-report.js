'use strict';

// render-report.js — deterministic daily-report renderer.
//
// 数据流原则（方案 B）：本脚本是只读消费者，不再模拟看板变更。
// 看板变更的唯一执行点是 kanban-update.js。需要反映看板变更时，正确流程是：
//   1. kanban-update.js --json-output kanban-updated.json  → 生成最新 JSON
//   2. render-report.js --kanban kanban-updated.json        → 用最新 JSON 重渲染
//
// DEPRECATED: --kanban-changes 参数保留以兼容旧调用，但传入时会输出警告。
// 后续版本会移除该参数。请改用上面的两步流程。

const fs = require('node:fs');
const { parseArgs } = require('./lib/argv');
const { fetchTeam, findByUsername } = require('./lib/person');
const { buildPersonalView } = require('./lib/kanban-view');

function normalizeKanbanData(rawKanbanData) {
  const kanbanData = rawKanbanData && typeof rawKanbanData === 'object' ? rawKanbanData : {};
  const tasks = Array.isArray(kanbanData.tasks) ? kanbanData.tasks : [];
  const stats = kanbanData.stats && typeof kanbanData.stats === 'object' ? kanbanData.stats : {};
  const deadlineCalendar = kanbanData.deadline_calendar && typeof kanbanData.deadline_calendar === 'object'
    ? kanbanData.deadline_calendar
    : {};

  return {
    source_file: kanbanData.source_file || '',
    last_updated: kanbanData.last_updated || '',
    user: kanbanData.user || null,
    tasks,
    stats: {
      total: stats.total ?? tasks.length,
      done: stats.done ?? tasks.filter((t) => t.status && t.status.includes('✅')).length,
      in_progress: stats.in_progress ?? tasks.filter((t) => t.status && t.status.includes('🔵')).length,
      at_risk: stats.at_risk ?? tasks.filter((t) => t.status && t.status.includes('🟡')).length,
      blocked: stats.blocked ?? tasks.filter((t) => t.status && t.status.includes('🔴')).length,
      not_started: stats.not_started ?? tasks.filter((t) => t.status && t.status.includes('⬜')).length,
    },
    deadline_calendar: {
      overdue: Array.isArray(deadlineCalendar.overdue) ? deadlineCalendar.overdue : [],
      today: Array.isArray(deadlineCalendar.today) ? deadlineCalendar.today : [],
      tomorrow: Array.isArray(deadlineCalendar.tomorrow) ? deadlineCalendar.tomorrow : [],
      day_after: Array.isArray(deadlineCalendar.day_after) ? deadlineCalendar.day_after : [],
      unscheduled: Array.isArray(deadlineCalendar.unscheduled) ? deadlineCalendar.unscheduled : [],
    },
    kanban_available: kanbanData.kanban_available !== false,
    message: kanbanData.message || '',
  };
}

function renderBasicInfo(gitData, kanbanData, aiData) {
  const group = kanbanData.user ? kanbanData.user.group : '';
  const repos = [...new Set(gitData.commits.map((c) => c.author === gitData.git_username ? gitData.repo : null).filter(Boolean))];
  const repoStr = repos.length > 0 ? repos.join(' / ') : gitData.repo;
  const harnessVer = aiData && aiData.harness_version ? aiData.harness_version : '—';
  return `# 个人日报 - ${gitData.date}

## 基本信息
| 项目 | 内容 |
|------|------|
| 作者 | ${gitData.git_username} |
| 组 | ${group} |
| 仓库 | ${repoStr} |
| Harness 版本 | ${harnessVer} |
| 报告日期 | ${gitData.date} |`;
}

const STAGE_MAP = {
  DEV: '功能开发',
  BUG: '缺陷修复',
  CM: '配置管理',
  TEST: '测试验证',
  DOCS: '文档规范',
  REFACTOR: '重构',
};

function renderCompletedTasks(gitData) {
  const commits = gitData.commits;
  if (!commits || commits.length === 0) {
    return '### 已完成任务 ✅\n\n无提交记录';
  }

  const lines = ['### 已完成任务 ✅\n'];
  commits.forEach((c) => {
    const stage = c.stage || '';
    const category = STAGE_MAP[stage] || stage || '其他';
    const subjectClean = c.subject.replace(/^\[.*?\]\s*/, '').replace(/\[.*?\]$/, '').trim();
    const bullets = (c.body || '').split('\n').filter((l) => /^\s*- /.test(l)).map((l) => l.replace(/^\s*- /, '').trim());
    lines.push(`- [${category}] ${subjectClean} — ${c.hash} (${c.repo || gitData.repo})`);
    lines.push(`  ${bullets.join('；') || c.body?.split('\n')[0]?.replace(/^\w+:\s*(?:\[.*?\]\s*)?/, '').trim() || ''}`);
  });
  return lines.join('\n');
}

function renderInProgressTasks(kanbanData) {
  const inProgress = kanbanData.tasks.filter((t) => t.status.includes('🔵'));
  if (inProgress.length === 0) {
    const fallback = kanbanData.kanban_available ? '' : `\n\n${kanbanData.message || '看板数据不可用'}`;
    return `### 进行中任务 ⚠️\n| 任务 | 进展 | 预计完成 |\n|------|------|----------|${fallback}`;
  }

  const lines = ['### 进行中任务 ⚠️\n| 任务 | 进展 | 预计完成 |', '|------|------|----------|'];
  for (const t of inProgress) {
    const note = t.notes ? t.notes.split('；').slice(-1)[0] : '';
    lines.push(`| ${t.id} ${t.task} | ${note || '进行中'} | ${t.deadline || '-'} |`);
  }
  return lines.join('\n');
}

function renderWorkStats(gitData, aiData) {
  const s = gitData.stats;
  let tokenRow = '';
  if (aiData && aiData.summary) {
    // 优先使用 session 级 token（当天所有会话实际用量），fallback 到 dispatch 级
    const sessionInput = aiData.summary.session_input_tokens || 0;
    const sessionOutput = aiData.summary.session_output_tokens || 0;
    const sessionTotal = sessionInput + sessionOutput;
    const dispatchTotal = (aiData.summary.total_input_tokens || 0) + (aiData.summary.total_output_tokens || 0);
    const total = sessionTotal > 0 ? sessionTotal : dispatchTotal;
    if (total > 0) {
      tokenRow = `\n| Token 用量 | ${total.toLocaleString()} |`;
    }
  }
  return `### 工作量统计
| 指标 | 数值 |
|------|------|
| 提交数 | ${s.commits} |
| 变更文件数 | ${s.files_changed} |
| 新增行数 | +${s.insertions} |
| 删除行数 | -${s.deletions} |${tokenRow}`;
}

function renderCollaboration(gitData) {
  const c = gitData.classification;
  const total = gitData.stats.commits || 1;
  const pct = (n) => Math.round((n / total) * 100);
  const fmtList = (hashes) => hashes.length > 0 ? hashes.join(' / ') : '—';

  return `## 提交协作分析
| 分类 | 提交数 | 占比 | 提交列表 |
|------|--------|------|----------|
| 🤖 AI 独立完成 | ${c.ai_independent.count} | ${pct(c.ai_independent.count)}% | ${fmtList(c.ai_independent.hashes)} |
| 🤝 AI 协作提交 | ${c.ai_collaborative.count} | ${pct(c.ai_collaborative.count)}% | ${fmtList(c.ai_collaborative.hashes)} |
| 👤 人工独立提交 | ${c.human.count} | ${pct(c.human.count)}% | ${fmtList(c.human.hashes)} |

> **分类依据**：commit 首行末尾 \`[...]\` 中的操作者类型标识`;
}

function renderPlanComparison(gitData, kanbanData) {
  const lines = ['## 规划对照分析（基于个人看板）', '| 看板编号 | 任务 | 计划 Deadline | 今日状态 | 进展说明 |', '|----------|------|--------------|---------|---------|'];

  if (kanbanData.tasks.length === 0) {
    lines.push(`| - | - | - | - | ${kanbanData.message || '看板数据不可用'} |`);
    lines.push('\n完成率: 0/0（0%）');
    return lines.join('\n');
  }

  const commitSubjects = gitData.commits.map((c) => c.subject);
  let completed = 0;
  let total = kanbanData.tasks.length;

  for (const t of kanbanData.tasks) {
    let note = '';
    const hasRelatedCommit = commitSubjects.some((s) =>
      s.includes(t.id) || t.task.toLowerCase().split(/[（(]/)[0].split(/\s/).some((w) => w.length >= 3 && s.toLowerCase().includes(w.toLowerCase()))
    );

    if (t.status.includes('✅')) {
      completed++;
      if (hasRelatedCommit) {
        note = '今日完成';
      } else {
        note = '已完成';
      }
    } else if (hasRelatedCommit) {
      note = '今日有提交';
    }

    if (!note && t.notes) {
      note = t.notes.split('；').slice(-1)[0];
    }

    lines.push(`| ${t.id} | ${t.task} | ${t.deadline || '-'} | ${t.status} | ${note} |`);
  }

  const pct = Math.round((completed / total) * 100);
  lines.push(`\n完成率: ${completed}/${total}（${pct}%）`);
  return lines.join('\n');
}

function renderRisks(kanbanData, blockersData) {
  const overdue = kanbanData.deadline_calendar.overdue || [];
  const hasBlockers = blockersData && Array.isArray(blockersData.blockers) && blockersData.blockers.length > 0;

  // Only render the section when there is actual risk data
  if (overdue.length === 0 && !hasBlockers) {
    return '';
  }

  const lines = ['---\n\n## 风险与阻塞', '| 风险项 | 影响域 | 程度 | 状态 |', '|--------|--------|------|------|'];

  // Overdue items from deadline calendar
  if (overdue.length > 0) {
    for (const t of overdue) {
      lines.push(`| ${t.id} ${t.task} 已过期 (${t.deadline}) | ${t.owner} | 🔴 | 待处理 |`);
    }
  }

  // User-reported blockers (手填卡点)
  if (hasBlockers) {
    const BLOCKER_EMOJI = { 'Harness': '🟡', 'CC': '🟡', 'Git': '🟡', '环境': '🔴', '产品': '🔴' };
    lines.push('\n### 手填卡点');
    lines.push('| 分类 | 描述 |');
    lines.push('|------|------|');
    for (const b of blockersData.blockers) {
      const emoji = BLOCKER_EMOJI[b.category] || '🟡';
      lines.push(`| ${emoji} ${b.category} | ${b.description} |`);
    }
  }

  return lines.join('\n');
}

function renderAIPerformance(aiData) {
  if (!aiData) {
    return '';
  }

  const specStats = aiData.summary && aiData.summary.spec_stats;
  const concernStats = aiData.summary && aiData.summary.concern_stats;
  const hasSpecData = specStats && specStats.total_changes > 0;
  const hasConcernData = concernStats && concernStats.total > 0;
  const dbt = (aiData.summary && aiData.summary.dispatch_by_trigger) || {};
  const hasPipeline = dbt.pipeline && dbt.pipeline.dispatch_count > 0;
  const hasNatural = dbt.natural && dbt.natural.dispatch_count > 0;
  const hasSessionByProject = aiData.summary && aiData.summary.session_by_project
    && Object.keys(aiData.summary.session_by_project).length > 0;

  // When no data at all, show empty message
  if (!hasPipeline && !hasNatural && !hasSpecData && !hasConcernData && !hasSessionByProject) {
    return '## AI 员工效能\n\n当日无 AI 效能数据';
  }

  const lines = ['## AI 员工效能'];

  // --- Table 1: AI 员工调度统计 (pipeline + natural combined) ---
  if (hasPipeline || hasNatural) {
    lines.push('\n### AI 员工调度统计');
    lines.push('| 角色 | 调度类型 | Dispatch 数 | Input | Output | Cache Read | 合计 |');
    lines.push('|------|---------|------------|-------|--------|-----------|------|');

    const allRows = [];
    const triggerOrder = [
      { key: 'pipeline', label: 'AI自动调度' },
      { key: 'natural', label: '人工调度' },
    ];

    let grandInput = 0, grandOutput = 0, grandCacheRead = 0, grandDispatch = 0;

    for (const { key, label } of triggerOrder) {
      const bucket = dbt[key];
      if (!bucket || bucket.dispatch_count === 0) continue;

      const roleNames = Object.keys(bucket.by_role);

      for (const role of roleNames) {
        const r = bucket.by_role[role];
        const total = r.input_tokens + r.output_tokens;
        allRows.push('| ' + role + ' | ' + label + ' | ' + r.dispatch_count
          + ' | ' + r.input_tokens.toLocaleString()
          + ' | ' + r.output_tokens.toLocaleString()
          + ' | ' + r.cache_read_tokens.toLocaleString()
          + ' | ' + total.toLocaleString() + ' |');
      }

      // If by_role is empty but bucket has data, show a summary row
      if (roleNames.length === 0 && bucket.dispatch_count > 0) {
        const total = bucket.input_tokens + bucket.output_tokens;
        allRows.push('| — | ' + label + ' | ' + bucket.dispatch_count
          + ' | ' + bucket.input_tokens.toLocaleString()
          + ' | ' + bucket.output_tokens.toLocaleString()
          + ' | ' + bucket.cache_read_tokens.toLocaleString()
          + ' | ' + total.toLocaleString() + ' |');
      }

      grandInput += bucket.input_tokens;
      grandOutput += bucket.output_tokens;
      grandCacheRead += bucket.cache_read_tokens;
      grandDispatch += bucket.dispatch_count;
    }

    lines.push(...allRows);
    const grandTotal = grandInput + grandOutput;
    lines.push('| **合计** | — | **' + grandDispatch + '**'
      + ' | **' + grandInput.toLocaleString() + '**'
      + ' | **' + grandOutput.toLocaleString() + '**'
      + ' | **' + grandCacheRead.toLocaleString() + '**'
      + ' | **' + grandTotal.toLocaleString() + '** |');
  }

  // --- Active pipeline tasks list ---
  const pipelineTasks = (aiData.tasks || []).filter((t) => !t._usage_source);
  if (pipelineTasks.length > 0) {
    lines.push('\n### 流水线任务');
    for (const task of pipelineTasks) {
      const progress = task.phases_completed + '/' + task.phases_total;
      const scoreParts = [];
      if (task.scores) {
        for (const [role, score] of Object.entries(task.scores)) {
          if (score != null) {
            scoreParts.push(role.charAt(0).toUpperCase() + role.slice(1) + ': ' + score);
          }
        }
      }
      const scoreStr = scoreParts.length > 0 ? ' | Scores: ' + scoreParts.join(', ') : '';
      const callerStr = task.caller ? ' | 发起: ' + task.caller : '';
      lines.push('- **' + task.change_name + '** — ' + task.title);
      lines.push('  阶段: ' + task.current_phase + ' | 进度: ' + progress + scoreStr + callerStr);
    }
  }

  // --- Quality metrics (from pipeline tasks only) ---
  if (pipelineTasks.length > 0) {
    lines.push('\n### 质量指标');
    const metricsLines = ['| 指标 | 数值 |', '|------|------|'];

    const fprTasks = pipelineTasks.filter((t) => t.quality_metrics && t.quality_metrics.first_pass_rate != null);
    if (fprTasks.length > 0) {
      const avgFpr = fprTasks.reduce((s, t) => s + t.quality_metrics.first_pass_rate, 0) / fprTasks.length;
      metricsLines.push('| 首次通过率 | ' + Math.round(avgFpr * 100) + '% |');
    }

    const totalRework = pipelineTasks.reduce((s, t) => s + (t.quality_metrics ? (t.quality_metrics.total_rework_loops || 0) : 0), 0);
    metricsLines.push('| 返工次数 | ' + totalRework + ' |');

    if (aiData.summary.total_wall_clock_ms > 0) {
      const hours = Math.floor(aiData.summary.total_wall_clock_ms / 3600000);
      const minutes = Math.floor((aiData.summary.total_wall_clock_ms % 3600000) / 60000);
      metricsLines.push('| 总耗时 | ' + hours + 'h ' + minutes + 'm |');
    }

    lines.push(metricsLines.join('\n'));
  }

  // --- Table 2: 会话 Token 统计 (per-project) ---
  if (hasSessionByProject) {
    lines.push('\n### 会话 Token 统计');
    lines.push('| 项目 | 会话数 | Input | Output | Cache Read | 总用量 |');
    lines.push('|------|--------|-------|--------|-----------|--------|');

    let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCount = 0;

    const projectEntries = Object.entries(aiData.summary.session_by_project)
      .sort(([, a], [, b]) => (b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens));

    for (const [name, p] of projectEntries) {
      const total = p.input_tokens + p.output_tokens;
      lines.push('| ' + name + ' | ' + p.count
        + ' | ' + p.input_tokens.toLocaleString()
        + ' | ' + p.output_tokens.toLocaleString()
        + ' | ' + p.cache_read_tokens.toLocaleString()
        + ' | ' + total.toLocaleString() + ' |');
      totalInput += p.input_tokens;
      totalOutput += p.output_tokens;
      totalCacheRead += p.cache_read_tokens;
      totalCount += p.count;
    }

    const grandTotal = totalInput + totalOutput;
    lines.push('| **合计** | **' + totalCount + '**'
      + ' | **' + totalInput.toLocaleString() + '**'
      + ' | **' + totalOutput.toLocaleString() + '**'
      + ' | **' + totalCacheRead.toLocaleString() + '**'
      + ' | **' + grandTotal.toLocaleString() + '** |');
  }

  // --- Table 3: 模型 Token 统计 ---
  const sessionByModel = (aiData.summary && aiData.summary.session_by_model) || {};
  const dispatchModels = new Set([
    ...Object.keys((dbt.pipeline && dbt.pipeline.by_model) || {}),
    ...Object.keys((dbt.natural && dbt.natural.by_model) || {}),
    ...Object.keys(sessionByModel),
  ]);

  if (dispatchModels.size > 0) {
    lines.push('\n### 模型 Token 统计');
    lines.push('| 模型 | Input | Output | Cache Read | 总用量 |');
    lines.push('|------|-------|--------|-----------|--------|');

    const modelAgg = {};
    for (const model of dispatchModels) {
      modelAgg[model] = { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
    }

    // Merge dispatch data from both triggers
    for (const trigger of [dbt.pipeline, dbt.natural]) {
      if (!trigger || !trigger.by_model) continue;
      for (const [model, data] of Object.entries(trigger.by_model)) {
        if (!modelAgg[model]) modelAgg[model] = { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
        modelAgg[model].dispatch_count += data.dispatch_count;
        modelAgg[model].input_tokens += data.input_tokens;
        modelAgg[model].output_tokens += data.output_tokens;
        modelAgg[model].cache_read_tokens += data.cache_read_tokens;
      }
    }

    // Merge session tokens (may include models not in dispatch data)
    for (const [model, data] of Object.entries(sessionByModel)) {
      if (!modelAgg[model]) modelAgg[model] = { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
      modelAgg[model].input_tokens += data.input_tokens || 0;
      modelAgg[model].output_tokens += data.output_tokens || 0;
      modelAgg[model].cache_read_tokens += data.cache_read_tokens || 0;
    }

    // Sort by total tokens descending, filter out zero-total noise
    const sortedModels = Object.entries(modelAgg)
      .filter(([, data]) => (data.input_tokens + data.output_tokens) > 0)
      .sort(([, a], [, b]) => ((b.input_tokens + b.output_tokens) - (a.input_tokens + a.output_tokens)));

    let grandInput = 0, grandOutput = 0, grandCacheRead = 0, grandDispatch = 0;

    for (const [model, data] of sortedModels) {
      const total = data.input_tokens + data.output_tokens;
      lines.push('| ' + model
        + ' | ' + data.input_tokens.toLocaleString()
        + ' | ' + data.output_tokens.toLocaleString()
        + ' | ' + data.cache_read_tokens.toLocaleString()
        + ' | ' + total.toLocaleString() + ' |');
      grandInput += data.input_tokens;
      grandOutput += data.output_tokens;
      grandCacheRead += data.cache_read_tokens;
      grandDispatch += data.dispatch_count;
    }

    const grandTotal = grandInput + grandOutput;
    lines.push('| **合计**'
      + ' | **' + grandInput.toLocaleString() + '**'
      + ' | **' + grandOutput.toLocaleString() + '**'
      + ' | **' + grandCacheRead.toLocaleString() + '**'
      + ' | **' + grandTotal.toLocaleString() + '** |');
  }

  // --- SPEC 闭环统计表 (global snapshot) ---
  if (hasSpecData) {
    lines.push('\n### SPEC 闭环统计');
    const closedPct = specStats.total_changes > 0 ? Math.round((specStats.closed_loop / specStats.total_changes) * 100) : 0;
    lines.push('| 指标 | 数值 |');
    lines.push('|------|------|');
    lines.push('| 闭环变更 | ' + specStats.closed_loop + ' / ' + specStats.total_changes + ' (' + closedPct + '%) |');
    lines.push('| 进行中 | ' + specStats.open + ' |');

    const byPhase = specStats.by_phase || {};
    const nonZeroPhases = Object.entries(byPhase).filter(([, count]) => count > 0);
    if (nonZeroPhases.length > 0) {
      lines.push('\n**阶段分布**');
      lines.push('| 阶段 | 数量 |');
      lines.push('|------|------|');
      for (const [phase, count] of nonZeroPhases) {
        lines.push('| ' + phase + ' | ' + count + ' |');
      }
    }
  }

  // --- Concerns 统计表 (global snapshot) ---
  if (hasConcernData) {
    lines.push('\n### Concerns 统计');
    lines.push('| 级别 | 发现 | 已关闭 | 关闭率 |');
    lines.push('|------|------|--------|--------|');
    const p0Rate = concernStats.p0_found > 0 ? Math.round((concernStats.p0_closed / concernStats.p0_found) * 100) + '%' : '-';
    const p1Rate = concernStats.p1_found > 0 ? Math.round((concernStats.p1_closed / concernStats.p1_found) * 100) + '%' : '-';
    const totalFound = concernStats.p0_found + concernStats.p1_found;
    const totalClosed = concernStats.p0_closed + concernStats.p1_closed;
    const totalRate = totalFound > 0 ? Math.round((totalClosed / totalFound) * 100) + '%' : '-';
    lines.push('| P0 | ' + concernStats.p0_found + ' | ' + concernStats.p0_closed + ' | ' + p0Rate + ' |');
    lines.push('| P1 | ' + concernStats.p1_found + ' | ' + concernStats.p1_closed + ' | ' + p1Rate + ' |');
    lines.push('| **合计** | **' + totalFound + '** | **' + totalClosed + '** | **' + totalRate + '** |');
  }

  return lines.join('\n');
}

function applyKanbanChanges(kanbanData, changes) {
  if (!changes || changes.length === 0) return;
  for (const ch of changes) {
    const task = kanbanData.tasks.find((t) => t.id === ch.task_id);
    if (task) {
      if (ch.status) task.status = ch.status;
      if (ch.notes_append) {
        task.notes = (task.notes || '') + (task.notes ? '；' : '') + ch.notes_append;
      }
    }
  }
  // Recalculate stats
  const tasks = kanbanData.tasks;
  kanbanData.stats = {
    total: tasks.length,
    done: tasks.filter((t) => t.status.includes('✅')).length,
    in_progress: tasks.filter((t) => t.status.includes('🔵')).length,
    at_risk: tasks.filter((t) => t.status.includes('🟡')).length,
    blocked: tasks.filter((t) => t.status.includes('🔴')).length,
    not_started: tasks.filter((t) => t.status.includes('⬜')).length,
  };
}

async function main() {
  const args = parseArgs(process.argv, {
    options: {
      git: '',
      kanban: '',
      'kanban-changes': '',
      ai: '',
      blockers: '',
      user: '',
      output: '',
      'json-output': '',
    },
  });

  if (!args.options.git || !args.options.kanban) {
    process.stderr.write('Usage: render-report.js --git git.json --kanban kanban.json [--ai ai.json] [--user <git_username>] [--kanban-changes \'[{...}]\'] [--output report.md] [--json-output report.json]\n');
    process.exit(1);
  }

  const gitData = JSON.parse(fs.readFileSync(args.options.git, 'utf-8'));
  const rawKanban = JSON.parse(fs.readFileSync(args.options.kanban, 'utf-8'));

  // 当传入 --user 且 rawKanban 看起来是全量 mirror（缺 user 或 deadline_calendar）时，
  // 自动按 owner 过滤、重算 stats/deadline_calendar、附加 userMeta。
  // 这让 kanban-update.js --json-output 的输出可以直接被消费，不必先 collect-kanban。
  const userOpt = typeof args.options.user === 'string' ? args.options.user.trim() : '';
  const needsConversion = userOpt && (rawKanban.user == null || rawKanban.deadline_calendar == null);
  let kanbanData;
  if (needsConversion) {
    const team = await fetchTeam().catch(() => ({ members: [] }));
    const teamUser = findByUsername(team, userOpt);
    const userMeta = teamUser
      ? { git_username: teamUser.git_username, group: teamUser.group }
      : { git_username: userOpt, group: '' };
    const year = parseInt((gitData.date || '').slice(0, 4), 10) || new Date().getFullYear();
    const personalView = buildPersonalView({
      mirror: rawKanban,
      username: userOpt,
      userMeta,
      year,
    });
    kanbanData = normalizeKanbanData(personalView);
  } else {
    kanbanData = normalizeKanbanData(rawKanban);
  }

  // Load AI performance data if --ai is provided
  let aiData = null;
  if (args.options.ai) {
    try {
      aiData = JSON.parse(fs.readFileSync(args.options.ai, 'utf-8'));
    } catch (e) {
      process.stderr.write(`[render-report] WARNING: failed to read --ai file: ${e.message}\n`);
    }
  }

  // Load blockers data if --blockers is provided
  let blockersData = null;
  if (args.options.blockers) {
    try {
      blockersData = JSON.parse(fs.readFileSync(args.options.blockers, 'utf-8'));
    } catch (e) {
      process.stderr.write(`[render-report] WARNING: failed to read --blockers file: ${e.message}\n`);
    }
  }

  // Apply kanban changes (e.g. D-07 ⬜→🔵) before rendering
  if (args.options['kanban-changes']) {
    // DEPRECATED: --kanban-changes will be removed in a later release.
    // The supported path is: kanban-update.js --json-output → render with --kanban <updated.json>.
    process.stderr.write(
      '[render-report] DEPRECATED: --kanban-changes 将在后续版本移除。\n'
      + '推荐改用：先跑 kanban-update.js --json-output 生成最新 JSON，再用 --kanban <最新JSON> 渲染。\n'
      + '本次仍按旧逻辑处理，但请尽快迁移。\n'
    );
    const changes = JSON.parse(args.options['kanban-changes']);
    applyKanbanChanges(kanbanData, changes);
  }

  // Build report sections - AI section inserted between collaboration and plan comparison
  const reportSections = [
    renderBasicInfo(gitData, kanbanData, aiData),
    renderCompletedTasks(gitData),
    renderInProgressTasks(kanbanData),
    renderWorkStats(gitData, aiData),
    renderCollaboration(gitData),
  ];

  if (aiData) {
    reportSections.push(renderAIPerformance(aiData));
  }

  reportSections.push(
    renderPlanComparison(gitData, kanbanData),
    renderRisks(kanbanData, blockersData),
  );

  // Filter out empty sections (e.g. renderRisks returns '' when no data)
  const nonEmptySections = reportSections.filter((s) => s !== '');

  const report = nonEmptySections.join('\n\n');

  process.stdout.write(report + '\n');

  if (args.options.output) {
    fs.writeFileSync(args.options.output, report, 'utf-8');
    process.stderr.write(`[render-report] written to ${args.options.output}\n`);
  }

  if (args.options['json-output']) {
    const reportJson = {
      date: gitData.date,
      git_username: gitData.git_username,
      repo: gitData.repo,
      git: {
        stats: gitData.stats,
        classification: gitData.classification,
        tags: gitData.tags,
        commits: gitData.commits,
      },
      kanban: {
        source_file: kanbanData.source_file,
        user: kanbanData.user,
        tasks: kanbanData.tasks,
        stats: kanbanData.stats,
        deadline_calendar: kanbanData.deadline_calendar,
      },
    };

    if (aiData) {
      // schema 要求 *_ms 字段为 integer，null 兜底为 0（深拷贝避免污染原 aiData）
      const aiDataSanitized = JSON.parse(JSON.stringify(aiData, (key, value) => {
        if (key.endsWith('_ms') && value == null) return 0;
        return value;
      }));
      reportJson.ai = aiDataSanitized;
    }

    if (blockersData && blockersData.blockers) {
      reportJson.blockers = blockersData.blockers;
    }
    fs.writeFileSync(args.options['json-output'], JSON.stringify(reportJson, null, 2) + '\n', 'utf-8');
    process.stderr.write(`[render-report] json written to ${args.options['json-output']}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`[render-report] error: ${e.message}\n`);
  process.exit(1);
});
