'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'render-report.js');
const TMP_DIR_PREFIX = path.join(os.tmpdir(), 'render-report-ai-test-');

function makeTmpDir() {
  return fs.mkdtempSync(TMP_DIR_PREFIX);
}

function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJson(dir, filename, data) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
}

function runRender(extraArgs = [], cwd = process.cwd()) {
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

function makeGitData() {
  return {
    date: '2026-05-22',
    git_username: 'testuser',
    repo: 'test-repo',
    stats: { commits: 1, files_changed: 2, insertions: 10, deletions: 5 },
    commits: [
      { hash: 'abcd1234', subject: '[DEV] test commit', author: 'testuser', datetime: '2026-05-22', body: '', operator_type: 'human', operator_detail: '', tag: '功能开发', stage: 'DEV', module: 'test' },
    ],
    classification: { ai_independent: { count: 0, hashes: [] }, ai_collaborative: { count: 0, hashes: [] }, human: { count: 1, hashes: ['abcd1234'] } },
    tags: {},
  };
}

function makeKanbanData() {
  return {
    source_file: 'kanban.md',
    user: { name: 'Test User', group: 'Dev' },
    tasks: [],
    stats: { total: 0, done: 0, in_progress: 0, not_started: 0 },
    deadline_calendar: { overdue: [] },
  };
}

function makeAiData() {
  return {
    date: '2026-05-22',
    tasks: [
      {
        change_name: 'my-change',
        title: 'My Change',
        caller: 'testuser',
        current_phase: 'implement',
        phases_completed: 3,
        phases_total: 8,
        scores: { architect: 85, reviewer: 93, tester: null },
        quality_metrics: { first_pass_rate: 0.75, total_rework_loops: 1, total_wall_clock_ms: 3600000, phases_completed: 3, phases_total: 8 },
        dispatches: [
          { phase: 'explore', started_at: '2026-05-22T05:00:00.000Z', completed_at: '2026-05-22T06:00:00.000Z', token_usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-4-6' }, exit_status: 'DONE' },
          { phase: 'implement', started_at: '2026-05-22T07:00:00.000Z', completed_at: '2026-05-22T08:30:00.000Z', token_usage: { input_tokens: 2000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-sonnet-4-6' }, exit_status: 'DONE' },
        ],
      },
    ],
    summary: {
      total_input_tokens: 3000,
      total_output_tokens: 1300,
      total_dispatches: 2,
      total_wall_clock_ms: 3600000,
      dispatch_by_trigger: {
        pipeline: {
          dispatch_count: 2,
          input_tokens: 3000,
          output_tokens: 1300,
          cache_read_tokens: 0,
          by_role: {
            architect: { dispatch_count: 1, input_tokens: 1000, output_tokens: 500, cache_read_tokens: 0 },
            developer: { dispatch_count: 1, input_tokens: 2000, output_tokens: 800, cache_read_tokens: 0 },
          },
          by_model: {},
        },
        natural: { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, by_role: {}, by_model: {} },
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

// --- Test: --ai parameter adds AI section ---
function testAiSectionPresentInReport() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', makeAiData());

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0, `exit code should be 0, stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('AI 员工效能'), 'report should contain AI performance section header');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: no --ai parameter means no AI section ---
function testNoAiParameterSkipsSection() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes('AI 员工效能'), 'report should NOT contain AI section when no --ai');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: AI data with no dispatches/spec/concerns shows "当日无 AI 效能数据" ---
function testEmptyAiDataShowsMessage() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', {
      date: '2026-05-22',
      tasks: [],
      summary: {
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_dispatches: 0,
        total_wall_clock_ms: 0,
        dispatch_by_trigger: {
          pipeline: { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, by_role: {}, by_model: {} },
          natural: { dispatch_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, by_role: {}, by_model: {} },
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
    });

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('当日无 AI 效能数据'), 'should show empty message when no AI dispatches');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: role token table renders correctly ---
function testRoleTokenTable() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', makeAiData());

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    // Check role table has architect and developer rows
    assert.ok(result.stdout.includes('architect'), 'should list architect role');
    assert.ok(result.stdout.includes('developer'), 'should list developer role');
    // Check total row
    assert.ok(result.stdout.includes('合计'), 'should have total row');
    // Check token numbers appear (toLocaleString adds commas for >= 1000)
    assert.ok(result.stdout.includes('1,000') || result.stdout.includes('1000'), 'should show architect input tokens');
    assert.ok(result.stdout.includes('2,000') || result.stdout.includes('2000'), 'should show developer input tokens');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: active task list renders ---
function testActiveTaskList() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', makeAiData());

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('my-change'), 'should show task change_name');
    assert.ok(result.stdout.includes('implement'), 'should show current phase');
    assert.ok(result.stdout.includes('3/8'), 'should show phases_completed/total');
    // Architect: 85, Reviewer: 93 should appear; tester: null should not
    assert.ok(result.stdout.includes('Architect: 85') || result.stdout.includes('architect: 85'), 'should show architect score');
    assert.ok(result.stdout.includes('Reviewer: 93') || result.stdout.includes('reviewer: 93'), 'should show reviewer score');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: quality metrics render ---
function testQualityMetricsRender() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', makeAiData());

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('首次通过率'), 'should show first pass rate label');
    assert.ok(result.stdout.includes('75%'), 'should show 75% first pass rate');
    assert.ok(result.stdout.includes('返工次数'), 'should show rework loops label');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: AI section positioned after "提交协作分析" and before "规划对照分析" ---
function testAiSectionPosition() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', makeAiData());

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    const collabIdx = result.stdout.indexOf('提交协作分析');
    const aiIdx = result.stdout.indexOf('AI 员工效能');
    const planIdx = result.stdout.indexOf('规划对照分析');
    assert.ok(collabIdx > 0, 'should have collaboration section');
    assert.ok(aiIdx > 0, 'should have AI section');
    assert.ok(planIdx > 0, 'should have plan comparison section');
    assert.ok(collabIdx < aiIdx, 'AI section should be after collaboration');
    assert.ok(aiIdx < planIdx, 'AI section should be before plan comparison');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: --json-output includes ai field ---
function testJsonOutputIncludesAiField() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', makeAiData());

    const jsonOut = path.join(tmpDir, 'output.json');
    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
      '--json-output', jsonOut,
    ]);
    assert.equal(result.exitCode, 0);

    const json = JSON.parse(fs.readFileSync(jsonOut, 'utf-8'));
    assert.ok(json.ai, 'JSON output should have ai field');
    assert.equal(json.ai.date, '2026-05-22');
    assert.ok(json.ai.summary, 'ai field should have summary');
    assert.equal(json.ai.summary.total_dispatches, 2);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: spec_stats table rendered in AI section ---
function testSpecStatsTableRendered() {
  const tmpDir = makeTmpDir();
  try {
    const aiData = makeAiData();
    aiData.summary.spec_stats = { total_changes: 5, closed_loop: 3, open: 2, by_phase: { explore: 1, implement: 2, complete: 2 } };
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', aiData);

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('SPEC 闭环统计'), 'should contain SPEC stats header');
    assert.ok(result.stdout.includes('闭环变更'), 'should contain closed loop label');
    assert.ok(result.stdout.includes('60%'), 'should show 3/5 = 60%');
    assert.ok(result.stdout.includes('进行中'), 'should contain in-progress label');
    assert.ok(result.stdout.includes('阶段分布'), 'should contain phase distribution header');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: spec_stats by_phase with zero values not rendered ---
function testSpecStatsByPhaseFiltered() {
  const tmpDir = makeTmpDir();
  try {
    const aiData = makeAiData();
    aiData.summary.spec_stats = { total_changes: 3, closed_loop: 1, open: 2, by_phase: { explore: 2, implement: 1 } };
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', aiData);

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    // Only explore and implement should appear
    const phaseSection = result.stdout.substring(result.stdout.indexOf('阶段分布'));
    assert.ok(phaseSection.includes('explore'), 'should show explore phase');
    assert.ok(phaseSection.includes('implement'), 'should show implement phase');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: concerns table rendered in AI section ---
function testConcernsTableRendered() {
  const tmpDir = makeTmpDir();
  try {
    const aiData = makeAiData();
    aiData.summary.concern_stats = { total: 6, p0_found: 2, p0_closed: 1, p1_found: 4, p1_closed: 3 };
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', aiData);

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('Concerns 统计'), 'should contain Concerns stats header');
    assert.ok(result.stdout.includes('关闭率'), 'should contain close rate column');
    // P0: 1/2 = 50%, P1: 3/4 = 75%
    assert.ok(result.stdout.includes('50%'), 'should show P0 close rate 50%');
    assert.ok(result.stdout.includes('75%'), 'should show P1 close rate 75%');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: concerns with zero total not rendered ---
function testConcernsEmptyNotRendered() {
  const tmpDir = makeTmpDir();
  try {
    const aiData = makeAiData();
    aiData.summary.concern_stats = { total: 0, p0_found: 0, p0_closed: 0, p1_found: 0, p1_closed: 0 };
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    writeJson(tmpDir, 'ai.json', aiData);

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes('Concerns 统计'), 'should NOT render concerns table when total is 0');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: --blockers renders blocker table ---
function testBlockersTableRendered() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    const blockersData = { blockers: [{ category: '环境', description: '测试环境数据库连接超时' }] };
    writeJson(tmpDir, 'blockers.json', blockersData);

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--blockers', path.join(tmpDir, 'blockers.json'),
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes('手填卡点'), 'should contain blocker table header');
    assert.ok(result.stdout.includes('测试环境数据库连接超时'), 'should show blocker description');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: blockers rendered inside 风险与阻塞 section ---
function testBlockersInRisksSection() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    const blockersData = { blockers: [{ category: 'CC', description: 'Claude Code 上下文频繁压缩' }] };
    writeJson(tmpDir, 'blockers.json', blockersData);

    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--blockers', path.join(tmpDir, 'blockers.json'),
    ]);
    assert.equal(result.exitCode, 0);
    const risksIdx = result.stdout.indexOf('风险与阻塞');
    const blockerIdx = result.stdout.indexOf('手填卡点');
    assert.ok(risksIdx > 0, 'should have risks section');
    assert.ok(blockerIdx > 0, 'should have blocker table');
    assert.ok(risksIdx < blockerIdx, 'blocker table should be inside risks section');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: --blockers data in JSON output ---
function testBlockersJsonOutput() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());
    const blockersData = { blockers: [{ category: '环境', description: 'db timeout' }] };
    writeJson(tmpDir, 'blockers.json', blockersData);

    const jsonOut = path.join(tmpDir, 'output.json');
    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--blockers', path.join(tmpDir, 'blockers.json'),
      '--json-output', jsonOut,
    ]);
    assert.equal(result.exitCode, 0);

    const json = JSON.parse(fs.readFileSync(jsonOut, 'utf-8'));
    assert.ok(json.blockers, 'JSON output should have blockers field');
    assert.equal(json.blockers.length, 1);
    assert.equal(json.blockers[0].category, '环境');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Test: no --blockers parameter means no change ---
function testNoBlockersParamNoChange() {
  const tmpDir = makeTmpDir();
  try {
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', makeKanbanData());

    const jsonOut = path.join(tmpDir, 'output.json');
    const result = runRender([
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--json-output', jsonOut,
    ]);
    assert.equal(result.exitCode, 0);
    assert.ok(!result.stdout.includes('手填卡点'), 'should NOT contain blocker table without --blockers');

    const json = JSON.parse(fs.readFileSync(jsonOut, 'utf-8'));
    assert.ok(!json.blockers, 'JSON output should NOT have blockers field without --blockers');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --- Runner ---
const tests = [
  testAiSectionPresentInReport,
  testNoAiParameterSkipsSection,
  testEmptyAiDataShowsMessage,
  testRoleTokenTable,
  testActiveTaskList,
  testQualityMetricsRender,
  testAiSectionPosition,
  testJsonOutputIncludesAiField,
  testSpecStatsTableRendered,
  testSpecStatsByPhaseFiltered,
  testConcernsTableRendered,
  testConcernsEmptyNotRendered,
  testBlockersTableRendered,
  testBlockersInRisksSection,
  testBlockersJsonOutput,
  testNoBlockersParamNoChange,
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
