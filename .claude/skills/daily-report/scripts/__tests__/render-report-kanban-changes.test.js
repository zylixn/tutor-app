'use strict';

// Regression tests for render-report.js applyKanbanChanges stats recomputation.
// Previously applyKanbanChanges rebuilt kanbanData.stats with only
// total/done/in_progress/not_started — omitting at_risk and blocked.
// submit-report.js schema validation then rejected the JSON.
// These tests verify stats always carries the full 6-field shape after changes are applied.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'render-report.js');
const TMP_DIR_PREFIX = path.join(os.tmpdir(), 'render-report-kanban-changes-test-');

function makeTmpDir() {
  return fs.mkdtempSync(TMP_DIR_PREFIX);
}
function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJson(dir, filename, data) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data), 'utf-8');
}

function makeGitData() {
  return {
    date: '2026-06-12',
    git_username: 'testuser',
    repo: 'test-repo',
    stats: { commits: 1, files_changed: 1, insertions: 5, deletions: 2 },
    commits: [
      {
        hash: 'abcd1234', full_hash: 'abcd1234abcd1234abcd1234abcd1234abcd1234',
        datetime: '2026-06-12 10:00:00 +0800', author: 'testuser',
        subject: '[DEV] test', body: '- x',
        operator_type: 'ai_collaborative', operator_detail: 'AI-test.Developer',
        tag: '功能开发', stage: 'DEV', module: 'test',
      },
    ],
    classification: {
      ai_independent: { count: 0, hashes: [] },
      ai_collaborative: { count: 1, hashes: ['abcd1234'] },
      human: { count: 0, hashes: [] },
    },
    tags: {},
  };
}

function makeKanbanData() {
  return {
    source_file: 'kanban.md',
    user: { git_username: 'testuser', group: 'Dev' },
    tasks: [
      { id: 'T-01', task: 'done task', status: '✅', owner: 'testuser', deadline: '6/11', notes: '' },
      { id: 'T-02', task: 'in-progress', status: '🔵', owner: 'testuser', deadline: '6/15', notes: '' },
      { id: 'T-03', task: 'at-risk task', status: '🟡', owner: 'testuser', deadline: '6/12', notes: '' },
      { id: 'T-04', task: 'blocked task', status: '🔴', owner: 'testuser', deadline: '6/13', notes: '' },
      { id: 'T-05', task: 'not-started', status: '⬜', owner: 'testuser', deadline: '6/20', notes: '' },
    ],
    stats: { total: 5, done: 1, in_progress: 1, at_risk: 1, blocked: 1, not_started: 1 },
    deadline_calendar: { overdue: [], today: [], tomorrow: [], day_after: [], unscheduled: [] },
  };
}

function makeAiData() {
  return {
    date: '2026-06-12',
    summary: {
      total_input_tokens: 1000, total_output_tokens: 200,
      total_dispatches: 1, total_wall_clock_ms: 60000,
      dispatch_by_trigger: { pipeline: {}, natural: {} },
      spec_stats: { total_changes: 0, closed_loop: 0, open: 0, by_phase: {} },
      concern_stats: { total: 0, p0_found: 0, p0_closed: 0, p1_found: 0, p1_closed: 0 },
    },
    tasks: [],
  };
}

function runRender(tmpDir, changes) {
  writeJson(tmpDir, 'git.json', makeGitData());
  writeJson(tmpDir, 'kanban.json', makeKanbanData());
  writeJson(tmpDir, 'ai.json', makeAiData());
  const mdOut = path.join(tmpDir, 'report.md');
  const jsonOut = path.join(tmpDir, 'report.json');
  const args = [
    SCRIPT,
    '--git', path.join(tmpDir, 'git.json'),
    '--kanban', path.join(tmpDir, 'kanban.json'),
    '--ai', path.join(tmpDir, 'ai.json'),
    '--output', mdOut,
    '--json-output', jsonOut,
  ];
  if (changes) {
    args.push('--kanban-changes', JSON.stringify(changes));
  }
  const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 10000 });
  return {
    status: result.status,
    stderr: result.stderr || '',
    json: fs.existsSync(jsonOut) ? JSON.parse(fs.readFileSync(jsonOut, 'utf-8')) : null,
  };
}

// Regression: after applyKanbanChanges, stats must still contain at_risk and blocked.
// Previously they were dropped, causing submit-report schema validation to fail.
function testStatsIncludeAtRiskAndBlockedAfterChanges() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, [
      { task_id: 'T-05', status: '🔵', notes_append: '开始' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    assert.ok(r.json, 'JSON output should exist');
    const stats = r.json.kanban && r.json.kanban.stats;
    assert.ok(stats, 'kanban.stats should exist');
    assert.ok('at_risk' in stats, `stats must include at_risk, got: ${JSON.stringify(stats)}`);
    assert.ok('blocked' in stats, `stats must include blocked, got: ${JSON.stringify(stats)}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// After T-05 ⬜→🔵 and T-03 🟡→✅: stats should reflect the new counts.
function testStatsRecountValuesAfterChanges() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, [
      { task_id: 'T-05', status: '🔵', notes_append: '开始' },  // not_started 1→0, in_progress 1→2
      { task_id: 'T-03', status: '✅', notes_append: '完成' },  // at_risk 1→0, done 1→2
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const stats = r.json.kanban.stats;
    assert.equal(stats.total, 5, `total should be 5, got: ${JSON.stringify(stats)}`);
    assert.equal(stats.done, 2, `done should be 2, got: ${JSON.stringify(stats)}`);
    assert.equal(stats.in_progress, 2, `in_progress should be 2, got: ${JSON.stringify(stats)}`);
    assert.equal(stats.at_risk, 0, `at_risk should be 0, got: ${JSON.stringify(stats)}`);
    assert.equal(stats.blocked, 1, `blocked should stay 1, got: ${JSON.stringify(stats)}`);
    assert.equal(stats.not_started, 0, `not_started should be 0, got: ${JSON.stringify(stats)}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Sanity: without --kanban-changes the original stats shape (6 fields) is preserved.
function testStatsShapePreservedWithoutChanges() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, null);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const stats = r.json.kanban.stats;
    const keys = Object.keys(stats).sort();
    assert.deepEqual(
      keys,
      ['at_risk', 'blocked', 'done', 'in_progress', 'not_started', 'total'],
      `stats shape should be the full 6-field set without changes, got: ${JSON.stringify(keys)}`
    );
  } finally {
    rmTmpDir(tmpDir);
  }
}

const tests = [
  testStatsIncludeAtRiskAndBlockedAfterChanges,
  testStatsRecountValuesAfterChanges,
  testStatsShapePreservedWithoutChanges,
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
