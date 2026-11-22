'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'collect-ai.js');
const TMP_DIR_PREFIX = path.join(os.tmpdir(), 'collect-ai-test-');

function makeTmpDir() {
  const dir = fs.mkdtempSync(TMP_DIR_PREFIX);
  return dir;
}

function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runCollectAi(extraArgs = [], cwd = process.cwd()) {
  const result = spawnSync('node', [SCRIPT, ...extraArgs], {
    encoding: 'utf-8',
    cwd,
    timeout: 10000,
  });
  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    exitCode: result.status || 0,
  };
}

function writePipelineState(dir, taskName, data) {
  const taskDir = path.join(dir, '.harness', 'tasks', taskName);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'pipeline-state.json'), JSON.stringify(data, null, 2));
}

// --- Helper: write usage.jsonl under <homeDir>/.claude/usage/usage.jsonl ---
function writeUsageJsonl(homeDir, entries) {
  const usageDir = path.join(homeDir, '.claude', 'usage');
  fs.mkdirSync(usageDir, { recursive: true });
  const filePath = path.join(usageDir, 'usage.jsonl');
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, lines);
}

// --- Test: no tasks directory produces empty structure ---
function testNoTasksDirectory() {
  const tmpDir = makeTmpDir();
  try {
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0, 'should exit 0');
    const data = JSON.parse(result.stdout);
    assert.equal(data.date, '2026-05-22');
    assert.equal(data.tasks.length, 0);
    assert.equal(data.summary.total_input_tokens, 0);
    assert.equal(data.summary.total_output_tokens, 0);
    assert.equal(data.summary.total_dispatches, 0);
    assert.deepStrictEqual(data.summary.dispatch_by_trigger.pipeline.by_role, {});
    assert.equal(data.summary.total_wall_clock_ms, 0);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: single task with matching dispatches ---
function testSingleTaskWithMatchingDispatches() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'my-change', {
      schema_version: 5,
      change_name: 'my-change',
      title: 'My Change',
      current_phase: 'implement',
      pipeline: {
        explore: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-22T05:00:00.000Z', // UTC 05:00 = CST 13:00, May 22
              completed_at: '2026-05-22T06:00:00.000Z',
              token_usage: { input_tokens: 1000, output_tokens: 500 },
              exit_status: 'DONE',
            },
          ],
        },
        implement: {
          status: 'in_progress',
          dispatch_history: [
            {
              started_at: '2026-05-22T07:00:00.000Z', // UTC 07:00 = CST 15:00, May 22
              completed_at: '2026-05-22T08:30:00.000Z',
              token_usage: { input_tokens: 2000, output_tokens: 800 },
              exit_status: 'DONE',
            },
          ],
        },
      },
      quality_metrics: {
        first_pass_rate: null,
        total_rework_loops: 0,
        total_wall_clock_ms: null,
        phases_completed: 3,
        phases_total: 8,
      },
      scores: { architect: 85, reviewer: null, tester: null },
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0, 'should exit 0');
    const data = JSON.parse(result.stdout);

    assert.equal(data.date, '2026-05-22');
    assert.equal(data.tasks.length, 1);
    const task = data.tasks[0];
    assert.equal(task.change_name, 'my-change');
    assert.equal(task.title, 'My Change');
    assert.equal(task.current_phase, 'implement');
    assert.equal(task.phases_completed, 3);
    assert.equal(task.phases_total, 8);
    assert.equal(task.dispatches.length, 2); // explore + implement

    // Summary
    assert.equal(data.summary.total_input_tokens, 3000); // 1000 + 2000
    assert.equal(data.summary.total_output_tokens, 1300); // 500 + 800
    assert.equal(data.summary.total_dispatches, 2);

    // Roles: explore -> architect, implement -> developer
    const pipelineRoles = data.summary.dispatch_by_trigger.pipeline.by_role;
    assert.ok(pipelineRoles.architect, 'should have architect role');
    assert.equal(pipelineRoles.architect.input_tokens, 1000);
    assert.equal(pipelineRoles.architect.output_tokens, 500);
    assert.ok(pipelineRoles.developer, 'should have developer role');
    assert.equal(pipelineRoles.developer.input_tokens, 2000);
    assert.equal(pipelineRoles.developer.output_tokens, 800);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: dispatch outside target date is excluded ---
function testDispatchOutsideDate() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'old-task', {
      schema_version: 5,
      change_name: 'old-task',
      title: 'Old Task',
      current_phase: 'done',
      pipeline: {
        explore: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-20T10:00:00.000Z', // May 20, not May 22
              completed_at: '2026-05-20T11:00:00.000Z',
              token_usage: { input_tokens: 500, output_tokens: 200 },
              exit_status: 'DONE',
            },
          ],
        },
      },
      quality_metrics: { first_pass_rate: null, total_rework_loops: 0, total_wall_clock_ms: null, phases_completed: 5, phases_total: 8 },
      scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.tasks.length, 0, 'task with no matching dispatches should be excluded');
    assert.equal(data.summary.total_dispatches, 0);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: invalid JSON is skipped with stderr warning ---
function testInvalidJsonSkipped() {
  const tmpDir = makeTmpDir();
  try {
    const taskDir = path.join(tmpDir, '.harness', 'tasks', 'broken');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'pipeline-state.json'), 'NOT VALID JSON {{{');

    // Also write a valid one so we know it continues
    writePipelineState(tmpDir, 'good', {
      schema_version: 5,
      change_name: 'good',
      title: 'Good',
      current_phase: 'explore',
      pipeline: {
        explore: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-22T05:00:00.000Z',
              completed_at: '2026-05-22T06:00:00.000Z',
              token_usage: { input_tokens: 100, output_tokens: 50 },
              exit_status: 'DONE',
            },
          ],
        },
      },
      quality_metrics: { first_pass_rate: null, total_rework_loops: 0, total_wall_clock_ms: null, phases_completed: 1, phases_total: 8 },
      scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.tasks.length, 1, 'should only have the valid task');
    assert.equal(data.tasks[0].change_name, 'good');
    assert.ok(result.stderr && result.stderr.includes('broken'), 'should warn about broken file on stderr');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: unmapped phases (intake, smoke) produce null role ---
function testUnmappedPhasesNotCounted() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'auto-task', {
      schema_version: 5,
      change_name: 'auto-task',
      title: 'Auto Task',
      current_phase: 'implement',
      pipeline: {
        intake: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-22T01:00:00.000Z',
              completed_at: '2026-05-22T01:05:00.000Z',
              token_usage: { input_tokens: 50, output_tokens: 10 },
              exit_status: 'DONE',
            },
          ],
        },
        smoke: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-22T02:00:00.000Z',
              completed_at: '2026-05-22T02:05:00.000Z',
              token_usage: { input_tokens: 30, output_tokens: 5 },
              exit_status: 'DONE',
            },
          ],
        },
      },
      quality_metrics: { first_pass_rate: null, total_rework_loops: 0, total_wall_clock_ms: null, phases_completed: 2, phases_total: 8 },
      scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);

    // Task should still appear (has dispatches)
    assert.equal(data.tasks.length, 1);

    // But unmapped phases should NOT contribute to any role
    assert.deepStrictEqual(data.summary.dispatch_by_trigger.pipeline.by_role, {}, 'unmapped phases should not create role entries');

    // Unmapped phases token still count in totals
    assert.equal(data.summary.total_input_tokens, 80); // 50 + 30
    assert.equal(data.summary.total_output_tokens, 15); // 10 + 5
    assert.equal(data.summary.total_dispatches, 2);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: wall clock time aggregation ---
function testWallClockAggregation() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'wc-task', {
      schema_version: 5,
      change_name: 'wc-task',
      title: 'WC Task',
      current_phase: 'implement',
      pipeline: {
        explore: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-22T05:00:00.000Z',
              completed_at: '2026-05-22T06:00:00.000Z', // 1 hour = 3600000 ms
              token_usage: { input_tokens: 100, output_tokens: 50 },
              exit_status: 'DONE',
            },
          ],
        },
      },
      quality_metrics: {
        first_pass_rate: null,
        total_rework_loops: 0,
        total_wall_clock_ms: 7200000, // 2 hours from quality_metrics
        phases_completed: 3,
        phases_total: 8,
      },
      scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    // total_wall_clock_ms comes from quality_metrics.total_wall_clock_ms aggregated across tasks
    assert.equal(data.summary.total_wall_clock_ms, 7200000);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: missing dispatch_history is handled safely ---
function testMissingDispatchHistory() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'no-history', {
      schema_version: 5,
      change_name: 'no-history',
      title: 'No History',
      current_phase: 'explore',
      pipeline: {
        explore: {
          status: 'done',
          // No dispatch_history field at all
        },
      },
      quality_metrics: { first_pass_rate: null, total_rework_loops: 0, total_wall_clock_ms: null, phases_completed: 1, phases_total: 8 },
      scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.tasks.length, 0, 'no dispatches means task excluded');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: default date is today CST ---
function testDefaultDateIsTodayCST() {
  const result = runCollectAi([]);
  assert.equal(result.exitCode, 0);
  const data = JSON.parse(result.stdout);
  // Verify the date format is YYYY-MM-DD
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(data.date), `date format should be YYYY-MM-DD, got: ${data.date}`);
}

// --- Test: spec_stats present in output with zero values when no tasks ---
function testSpecStatsPresent() {
  const tmpDir = makeTmpDir();
  try {
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.ok(data.summary.spec_stats, 'summary should contain spec_stats');
    assert.equal(data.summary.spec_stats.total_changes, 0);
    assert.equal(data.summary.spec_stats.closed_loop, 0);
    assert.equal(data.summary.spec_stats.open, 0);
    assert.deepStrictEqual(data.summary.spec_stats.by_phase, {});
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: spec_stats counts terminal phases as closed loop ---
function testSpecStatsTerminalPhases() {
  const tmpDir = makeTmpDir();
  try {
    // merge-prep phase
    writePipelineState(tmpDir, 'change-a', {
      schema_version: 5, change_name: 'change-a', title: 'A', current_phase: 'merge-prep',
      pipeline: { explore: { status: 'done', dispatch_history: [{ started_at: '2026-05-22T05:00:00.000Z', completed_at: '2026-05-22T06:00:00.000Z', token_usage: { input_tokens: 100, output_tokens: 50 }, exit_status: 'DONE' }] } },
      quality_metrics: { phases_completed: 1, phases_total: 8 }, scores: {},
    });
    // completed phase
    writePipelineState(tmpDir, 'change-b', {
      schema_version: 5, change_name: 'change-b', title: 'B', current_phase: 'completed',
      pipeline: { implement: { status: 'done', dispatch_history: [{ started_at: '2026-05-22T07:00:00.000Z', completed_at: '2026-05-22T08:00:00.000Z', token_usage: { input_tokens: 200, output_tokens: 100 }, exit_status: 'DONE' }] } },
      quality_metrics: { phases_completed: 2, phases_total: 8 }, scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.summary.spec_stats.total_changes, 2);
    assert.equal(data.summary.spec_stats.closed_loop, 2);
    assert.equal(data.summary.spec_stats.open, 0);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: spec_stats counts non-terminal phases as open ---
function testSpecStatsNonTerminalPhases() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'change-c', {
      schema_version: 5, change_name: 'change-c', title: 'C', current_phase: 'implement',
      pipeline: { implement: { status: 'in_progress', dispatch_history: [{ started_at: '2026-05-22T05:00:00.000Z', completed_at: '2026-05-22T06:00:00.000Z', token_usage: { input_tokens: 100, output_tokens: 50 }, exit_status: 'DONE' }] } },
      quality_metrics: { phases_completed: 1, phases_total: 8 }, scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.summary.spec_stats.total_changes, 1);
    assert.equal(data.summary.spec_stats.closed_loop, 0);
    assert.equal(data.summary.spec_stats.open, 1);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: spec_stats by_phase tracks actual phase names ---
function testSpecStatsByPhase() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'change-d', {
      schema_version: 5, change_name: 'change-d', title: 'D', current_phase: 'explore',
      pipeline: { explore: { status: 'done', dispatch_history: [{ started_at: '2026-05-22T05:00:00.000Z', completed_at: '2026-05-22T06:00:00.000Z', token_usage: { input_tokens: 100, output_tokens: 50 }, exit_status: 'DONE' }] } },
      quality_metrics: { phases_completed: 1, phases_total: 8 }, scores: {},
    });
    writePipelineState(tmpDir, 'change-e', {
      schema_version: 5, change_name: 'change-e', title: 'E', current_phase: 'explore',
      pipeline: { explore: { status: 'done', dispatch_history: [{ started_at: '2026-05-22T07:00:00.000Z', completed_at: '2026-05-22T08:00:00.000Z', token_usage: { input_tokens: 200, output_tokens: 100 }, exit_status: 'DONE' }] } },
      quality_metrics: { phases_completed: 1, phases_total: 8 }, scores: {},
    });
    writePipelineState(tmpDir, 'change-f', {
      schema_version: 5, change_name: 'change-f', title: 'F', current_phase: 'code-review',
      pipeline: { implement: { status: 'done', dispatch_history: [{ started_at: '2026-05-22T09:00:00.000Z', completed_at: '2026-05-22T10:00:00.000Z', token_usage: { input_tokens: 300, output_tokens: 150 }, exit_status: 'DONE' }] } },
      quality_metrics: { phases_completed: 2, phases_total: 8 }, scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.summary.spec_stats.by_phase.explore, 2);
    assert.equal(data.summary.spec_stats.by_phase['code-review'], 1);
    assert.equal(data.summary.spec_stats.total_changes, 3);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: spec_stats counts changes even when no matching dispatches (global snapshot) ---
function testSpecStatsCountsAllChanges() {
  const tmpDir = makeTmpDir();
  try {
    // A change with dispatches on the target date
    writePipelineState(tmpDir, 'change-active', {
      schema_version: 5, change_name: 'change-active', title: 'Active', current_phase: 'complete',
      pipeline: { implement: { status: 'done', dispatch_history: [{ started_at: '2026-05-22T05:00:00.000Z', completed_at: '2026-05-22T06:00:00.000Z', token_usage: { input_tokens: 100, output_tokens: 50 }, exit_status: 'DONE' }] } },
      quality_metrics: { phases_completed: 5, phases_total: 8 }, scores: {},
    });
    // A change with NO dispatches on the target date but still has a pipeline
    writePipelineState(tmpDir, 'change-idle', {
      schema_version: 5, change_name: 'change-idle', title: 'Idle', current_phase: 'implement',
      pipeline: { explore: { status: 'done', dispatch_history: [{ started_at: '2026-05-20T05:00:00.000Z', completed_at: '2026-05-20T06:00:00.000Z', token_usage: { input_tokens: 100, output_tokens: 50 }, exit_status: 'DONE' }] } },
      quality_metrics: { phases_completed: 1, phases_total: 8 }, scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    // Both changes should be counted in spec_stats (global snapshot)
    assert.equal(data.summary.spec_stats.total_changes, 2);
    assert.equal(data.summary.spec_stats.closed_loop, 1); // only change-active is 'complete'
    assert.equal(data.summary.spec_stats.open, 1); // change-idle is 'implement'
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Helper: write concerns.json for a change ---
function writeConcerns(dir, changeName, data) {
  const concernsDir = path.join(dir, '.harness', 'shared-state', changeName);
  fs.mkdirSync(concernsDir, { recursive: true });
  fs.writeFileSync(path.join(concernsDir, 'concerns.json'), JSON.stringify(data, null, 2));
}

// --- Test: concern_stats present in output with zero values when no shared-state ---
function testConcernStatsPresent() {
  const tmpDir = makeTmpDir();
  try {
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.ok(data.summary.concern_stats, 'summary should contain concern_stats');
    assert.equal(data.summary.concern_stats.total, 0);
    assert.equal(data.summary.concern_stats.p0_found, 0);
    assert.equal(data.summary.concern_stats.p0_closed, 0);
    assert.equal(data.summary.concern_stats.p1_found, 0);
    assert.equal(data.summary.concern_stats.p1_closed, 0);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: concern_stats P0/P1 counting ---
function testConcernStatsP0P1() {
  const tmpDir = makeTmpDir();
  try {
    writeConcerns(tmpDir, 'change-x', {
      concerns: [
        { severity: 'P0', status: 'open', title: 'p0-open' },
        { severity: 'P0', status: 'resolved', title: 'p0-resolved' },
        { severity: 'P1', status: 'open', title: 'p1-open' },
        { severity: 'P1', status: 'resolved', title: 'p1-resolved' },
        { severity: 'P1', status: 'resolved', title: 'p1-resolved-2' },
      ],
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.summary.concern_stats.total, 5);
    assert.equal(data.summary.concern_stats.p0_found, 2);
    assert.equal(data.summary.concern_stats.p0_closed, 1);
    assert.equal(data.summary.concern_stats.p1_found, 3);
    assert.equal(data.summary.concern_stats.p1_closed, 2);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: concern_stats resolved counts as closed ---
function testConcernStatsResolvedIsClosed() {
  const tmpDir = makeTmpDir();
  try {
    writeConcerns(tmpDir, 'change-y', {
      concerns: [
        { severity: 'P0', status: 'resolved', title: 'resolved-p0' },
      ],
    });
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.summary.concern_stats.p0_found, 1);
    assert.equal(data.summary.concern_stats.p0_closed, 1);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: concern_stats deferred counts as found but not closed ---
function testConcernStatsDeferredIsOpen() {
  const tmpDir = makeTmpDir();
  try {
    writeConcerns(tmpDir, 'change-z', {
      concerns: [
        { severity: 'P1', status: 'deferred', title: 'deferred-p1' },
      ],
    });
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.summary.concern_stats.p1_found, 1);
    assert.equal(data.summary.concern_stats.p1_closed, 0);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Helper: write a mock session JSONL file ---
function writeSessionJsonl(homeDir, projectSlug, sessionFile, entries) {
  const sessionDir = path.join(homeDir, '.claude', 'projects', projectSlug);
  fs.mkdirSync(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, sessionFile);
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, lines);
}

// --- Helper: run collect-ai.js with a custom HOME ---
function runCollectAiWithHome(extraArgs, cwd, homeDir) {
  const result = spawnSync('node', [SCRIPT, ...extraArgs], {
    encoding: 'utf-8',
    cwd,
    timeout: 10000,
    env: Object.assign({}, process.env, { HOME: homeDir }),
  });
  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    exitCode: result.status || 0,
  };
}

// --- Test: session_by_model count is incremented per request ---
function testSessionByModelCountIncremented() {
  const homeDir = makeTmpDir();
  const cwd = makeTmpDir();
  try {
    const targetDate = '2026-06-09';

    // Write mock session JSONL with 2 requests, both using "claude-sonnet-4-5"
    writeSessionJsonl(homeDir, '-work-repos-aios-test-proj', 'abc123.jsonl', [
      {
        timestamp: `${targetDate}T03:00:00.000Z`,
        message: {
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 },
        },
      },
      {
        timestamp: `${targetDate}T04:00:00.000Z`,
        message: {
          model: 'claude-sonnet-4-5',
          usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 },
        },
      },
      {
        timestamp: `${targetDate}T05:00:00.000Z`,
        message: {
          model: 'deepseek-v4-pro',
          usage: { input_tokens: 300, output_tokens: 100, cache_read_input_tokens: 30, cache_creation_input_tokens: 0 },
        },
      },
    ]);

    const result = runCollectAiWithHome(['--date', targetDate], cwd, homeDir);
    assert.equal(result.exitCode, 0, `should exit 0, stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);

    // Verify session-level top-level fields
    assert.ok(data.summary.session_input_tokens > 0, 'session_input_tokens should be > 0');
    assert.ok(data.summary.session_count > 0, 'session_count should be > 0');

    // Verify session_by_model structure and counts
    const sbm = data.summary.session_by_model;
    assert.ok(sbm, 'should have session_by_model');

    // claude-sonnet-4-5: 2 requests, 100+200=300 input, 50+80=130 output
    assert.ok(sbm['claude-sonnet-4-5'], 'should have claude-sonnet-4-5 entry');
    const sonnet = sbm['claude-sonnet-4-5'];
    assert.equal(sonnet.count, 2, 'claude-sonnet-4-5 count should be 2 (requests)');
    assert.equal(sonnet.input_tokens, 300);
    assert.equal(sonnet.output_tokens, 130);
    assert.equal(sonnet.cache_read_tokens, 30);

    // deepseek-v4-pro: 1 request
    assert.ok(sbm['deepseek-v4-pro'], 'should have deepseek-v4-pro entry');
    const dv4 = sbm['deepseek-v4-pro'];
    assert.equal(dv4.count, 1, 'deepseek-v4-pro count should be 1 (request)');
    assert.equal(dv4.input_tokens, 300);
    assert.equal(dv4.output_tokens, 100);
  } finally {
    rmTmpDir(homeDir);
    rmTmpDir(cwd);
  }
}

// --- Test: no shared-state directory produces zero concern_stats ---
function testConcernStatsNoSharedState() {
  const tmpDir = makeTmpDir();
  try {
    // Only create tasks dir, no shared-state
    const tasksDir = path.join(tmpDir, '.harness', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.stdout);
    assert.equal(data.summary.concern_stats.total, 0);
    assert.equal(data.summary.concern_stats.p0_found, 0);
    assert.equal(data.summary.concern_stats.p1_found, 0);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: usage.jsonl pipeline-trigger entries are skipped to avoid double-counting with pipeline-state.json ---
function testUsageJsonlPipelineNotDoubleCounted() {
  const homeDir = makeTmpDir();
  const cwd = makeTmpDir();
  try {
    const targetDate = '2026-06-12';

    // usage.jsonl: 1 natural + 1 pipeline (pipeline 条目对应 pipeline-state.json 中的同一次 dispatch)
    writeUsageJsonl(homeDir, [
      {
        ts: `${targetDate}T03:00:00.000Z`,
        session_id: 'sess-natural',
        role: 'developer',
        trigger: 'natural',
        task: 'manual dispatch',
        started_at: `${targetDate}T03:00:00.000Z`,
        completed_at: `${targetDate}T03:30:00.000Z`,
        duration_ms: 1800000,
        tokens: { input: 1000, output: 200, cache_read: 500, cache_creation: 0, model: 'glm-5.1' },
      },
      {
        ts: `${targetDate}T05:00:00.000Z`,
        session_id: 'sess-pipeline',
        role: 'architect',
        trigger: 'pipeline',
        task: 'rd-auto explore',
        started_at: `${targetDate}T05:00:00.000Z`,
        completed_at: `${targetDate}T05:30:00.000Z`,
        duration_ms: 1800000,
        tokens: { input: 2000, output: 400, cache_read: 800, cache_creation: 0, model: 'glm-5.1' },
      },
    ]);

    // pipeline-state.json 一次 dispatch（与上面 pipeline-trigger 条目对应同一物理 dispatch）
    writePipelineState(cwd, 'my-change', {
      schema_version: 5,
      change_name: 'my-change',
      title: 'My Change',
      current_phase: 'explore',
      pipeline: {
        explore: {
          status: 'done',
          dispatch_history: [
            {
              started_at: `${targetDate}T05:00:00.000Z`,
              completed_at: `${targetDate}T05:30:00.000Z`,
              token_usage: { input_tokens: 2000, output_tokens: 400, cache_read_input_tokens: 800, model: 'glm-5.1' },
              exit_status: 'DONE',
            },
          ],
        },
      },
    });

    const result = runCollectAiWithHome(['--date', targetDate], cwd, homeDir);
    assert.equal(result.exitCode, 0, `should exit 0, stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);

    // natural 桶只应包含 natural-trigger 条目（1000 input）
    const natural = data.summary.dispatch_by_trigger.natural;
    assert.equal(natural.input_tokens, 1000, 'natural bucket should only have natural-trigger tokens');
    assert.equal(natural.output_tokens, 200, 'natural output tokens');
    assert.equal(natural.dispatch_count, 1, 'natural dispatch_count');

    // pipeline 桶来自 pipeline-state.json（2000 input）
    const pipeline = data.summary.dispatch_by_trigger.pipeline;
    assert.equal(pipeline.input_tokens, 2000, 'pipeline bucket should come from pipeline-state.json');
    assert.equal(pipeline.dispatch_count, 1, 'pipeline dispatch_count');

    // 总数不应翻倍（1000 + 2000 = 3000，而非 1000 + 2000*2 = 5000）
    assert.equal(data.summary.total_input_tokens, 3000, 'total should not double-count pipeline-trigger usage entries');
    assert.equal(data.summary.total_dispatches, 2, 'total dispatches should be 2 (1 natural + 1 pipeline)');
  } finally {
    rmTmpDir(homeDir);
    rmTmpDir(cwd);
  }
}

// --- Helper: write .harness/.harness-version under cwd ---
function writeHarnessVersion(dir, content) {
  const versionDir = path.join(dir, '.harness');
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, '.harness-version'), content);
}

// --- Test (AC-1): .harness-version 多行格式只取首行（Bug B 主修复） ---
function testHarnessVersionMultiline() {
  const tmpDir = makeTmpDir();
  try {
    // bump-version.sh 实际产出格式：version / force / signature 三行
    writeHarnessVersion(tmpDir, '1.17.0\nforce\nabc12345\n');
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0, `should exit 0, stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.harness_version, '1.17.0', 'should be first line only, no newline / force / signature');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test (AC-2): .harness-version 单行文件回归保护 ---
function testHarnessVersionSingleLine() {
  const tmpDir = makeTmpDir();
  try {
    writeHarnessVersion(tmpDir, '1.17.0\n');
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0, `should exit 0, stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.harness_version, '1.17.0', 'single line file should return that line');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test (AC-3): .harness-version 缺失返回 null ---
function testHarnessVersionMissing() {
  const tmpDir = makeTmpDir();
  try {
    // 故意不写 .harness-version 文件
    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0, 'missing version file should not crash');
    const data = JSON.parse(result.stdout);
    assert.equal(data.harness_version, null, 'missing file should yield null');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test (AC-4): quality_metrics null 字段被 normalize 为 0（Bug C 主修复） ---
function testQualityMetricsNullFieldsNormalized() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'null-qm', {
      schema_version: 5,
      change_name: 'null-qm',
      title: 'Null QM',
      current_phase: 'implement',
      pipeline: {
        implement: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-22T05:00:00.000Z',
              completed_at: '2026-05-22T06:00:00.000Z',
              token_usage: { input_tokens: 100, output_tokens: 50 },
              exit_status: 'DONE',
            },
          ],
        },
      },
      quality_metrics: {
        first_pass_rate: null,
        total_wall_clock_ms: null,
        phases_completed: 3,
        phases_total: 8,
      },
      scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0, `should exit 0, stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.tasks.length, 1, 'task should be present');
    const qm = data.tasks[0].quality_metrics;
    assert.equal(qm.first_pass_rate, 0, 'null first_pass_rate should normalize to 0');
    assert.equal(qm.total_wall_clock_ms, 0, 'null total_wall_clock_ms should normalize to 0');
    assert.equal(qm.phases_completed, 3, 'valid number should be preserved');
    assert.equal(qm.phases_total, 8, 'valid number should be preserved');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test (AC-5): quality_metrics 字段缺失返回空对象 ---
function testQualityMetricsMissingObject() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'no-qm', {
      schema_version: 5,
      change_name: 'no-qm',
      title: 'No QM',
      current_phase: 'implement',
      pipeline: {
        implement: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-22T05:00:00.000Z',
              completed_at: '2026-05-22T06:00:00.000Z',
              token_usage: { input_tokens: 100, output_tokens: 50 },
              exit_status: 'DONE',
            },
          ],
        },
      },
      // 注意：故意没有 quality_metrics 字段
      scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0, `should exit 0, stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.tasks.length, 1, 'task should be present');
    assert.deepStrictEqual(data.tasks[0].quality_metrics, {}, 'missing quality_metrics should yield empty object');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test (AC-6): quality_metrics 含非数值（字符串）字段被 normalize 为 0 ---
function testQualityMetricsNonNumberFields() {
  const tmpDir = makeTmpDir();
  try {
    writePipelineState(tmpDir, 'dirty-qm', {
      schema_version: 5,
      change_name: 'dirty-qm',
      title: 'Dirty QM',
      current_phase: 'implement',
      pipeline: {
        implement: {
          status: 'done',
          dispatch_history: [
            {
              started_at: '2026-05-22T05:00:00.000Z',
              completed_at: '2026-05-22T06:00:00.000Z',
              token_usage: { input_tokens: 100, output_tokens: 50 },
              exit_status: 'DONE',
            },
          ],
        },
      },
      quality_metrics: {
        first_pass_rate: '0.85',
        phases_completed: '3',
      },
      scores: {},
    });

    const result = runCollectAi(['--date', '2026-05-22'], tmpDir);
    assert.equal(result.exitCode, 0, `should exit 0, stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.tasks.length, 1, 'task should be present');
    const qm = data.tasks[0].quality_metrics;
    assert.equal(qm.first_pass_rate, 0, 'string "0.85" should normalize to 0');
    assert.equal(qm.phases_completed, 0, 'string "3" should normalize to 0');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Runner ---
const tests = [
  testNoTasksDirectory,
  testSingleTaskWithMatchingDispatches,
  testDispatchOutsideDate,
  testInvalidJsonSkipped,
  testUnmappedPhasesNotCounted,
  testWallClockAggregation,
  testMissingDispatchHistory,
  testDefaultDateIsTodayCST,
  testSpecStatsPresent,
  testSpecStatsTerminalPhases,
  testSpecStatsNonTerminalPhases,
  testSpecStatsByPhase,
  testSpecStatsCountsAllChanges,
  testConcernStatsPresent,
  testConcernStatsP0P1,
  testConcernStatsResolvedIsClosed,
  testConcernStatsDeferredIsOpen,
  testConcernStatsNoSharedState,
  testSessionByModelCountIncremented,
  testUsageJsonlPipelineNotDoubleCounted,
  testHarnessVersionMultiline,
  testHarnessVersionSingleLine,
  testHarnessVersionMissing,
  testQualityMetricsNullFieldsNormalized,
  testQualityMetricsMissingObject,
  testQualityMetricsNonNumberFields,
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`PASS: ${t.name}`);
    passed++;
  } catch (e) {
    console.error(`FAIL: ${t.name}`);
    console.error(`  ${e.message}`);
    failed++;
  }
}

console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
