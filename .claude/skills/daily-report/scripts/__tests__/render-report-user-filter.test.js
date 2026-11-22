'use strict';

// Tests for render-report.js --user flag.
//
// Bug 1 fix: when the --kanban JSON is a full kanban-source mirror (e.g.,
// produced by `kanban-update.js --json-output`) it contains all 138 team tasks
// and lacks `user`/`deadline_calendar` fields. Without --user, render-report
// would render the whole team's tasks as if they were the author's. With --user,
// it now auto-filters by owner, recomputes 6-field stats + deadline_calendar,
// and attaches userMeta from team.json (falling back to { group: '' } if the
// network is unreachable, as it is in this test environment).

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'render-report.js');
const TMP_DIR_PREFIX = path.join(os.tmpdir(), 'render-report-user-filter-test-');

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
    date: '2026-06-13',
    git_username: 'testuser',
    repo: 'test-repo',
    stats: { commits: 1, files_changed: 1, insertions: 5, deletions: 2 },
    commits: [
      {
        hash: 'abcd1234', full_hash: 'abcd1234abcd1234abcd1234abcd1234abcd1234',
        datetime: '2026-06-13 10:00:00 +0800', author: 'testuser',
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

// A full kanban-source mirror — 138 tasks in real life, 5 here for clarity.
// testuser owns 2 tasks (T-01 done, T-02 in_progress); otheruser owns 3.
function makeFullKanbanMirror() {
  return {
    source_file: 'kanban-original.md',
    updated_at: '2026-06-13',
    updated_by: 'AI',
    updated_by_user: 'testuser',
    change_summary: 'T-01✅',
    tasks: [
      { id: 'T-01', task: 'testuser done', owner: 'testuser', owners: ['testuser'], deadline: '6/11', status: '✅', sprint: 'Sprint 0', main_chain: 'X', notes: 'x', urgency: '' },
      { id: 'T-02', task: 'testuser in-progress', owner: 'testuser', owners: ['testuser'], deadline: '6/15', status: '🔵', sprint: 'Sprint 0', main_chain: 'X', notes: 'x', urgency: '' },
      { id: 'T-03', task: 'otheruser done', owner: 'otheruser', owners: ['otheruser'], deadline: '6/10', status: '✅', sprint: 'Sprint 0', main_chain: 'Y', notes: 'x', urgency: '' },
      { id: 'T-04', task: 'otheruser not-started', owner: 'otheruser', owners: ['otheruser'], deadline: '6/20', status: '⬜', sprint: 'Sprint 1', main_chain: 'Y', notes: '', urgency: '' },
      { id: 'T-05', task: 'shared task', owner: 'testuser+otheruser', owners: ['testuser', 'otheruser'], deadline: '6/12', status: '⬜', sprint: 'Sprint 1', main_chain: 'Z', notes: '', urgency: '' },
    ],
    stats: {
      sprint_stats: { 'Sprint 0': { total: 3, done: 2 }, 'Sprint 1': { total: 2, done: 0 } },
      owner_stats: { testuser: { total: 3, done: 1 }, otheruser: { total: 3, done: 1 } },
      chain_stats: { X: { total: 2, done: 1 }, Y: { total: 2, done: 1 }, Z: { total: 1, done: 0 } },
    },
    // NOTE: no `user`, no `deadline_calendar` — this is what kanban-update.js emits.
  };
}

function makeAiData() {
  return {
    date: '2026-06-13',
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

function runRender(tmpDir, extraArgs) {
  writeJson(tmpDir, 'git.json', makeGitData());
  writeJson(tmpDir, 'kanban.json', makeFullKanbanMirror());
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
  for (const a of extraArgs || []) args.push(a);
  const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 10000 });
  return {
    status: result.status,
    stderr: result.stderr || '',
    md: fs.existsSync(mdOut) ? fs.readFileSync(mdOut, 'utf-8') : '',
    json: fs.existsSync(jsonOut) ? JSON.parse(fs.readFileSync(jsonOut, 'utf-8')) : null,
  };
}

// Core regression: --user filters the full mirror down to testuser's tasks.
function testUserFlagFiltersTasksToOwner() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, ['--user', 'testuser']);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    assert.ok(r.json, 'JSON output should exist');

    // testuser owns T-01, T-02, and shares T-05 (3 tasks); T-03/T-04 belong to otheruser only.
    const tasks = r.json.kanban && r.json.kanban.tasks;
    assert.ok(Array.isArray(tasks), 'tasks should be array');
    assert.equal(tasks.length, 3, `expected 3 testuser tasks, got ${tasks.length}: ${JSON.stringify(tasks.map(t => t.id))}`);
    const ids = tasks.map((t) => t.id).sort();
    assert.deepEqual(ids, ['T-01', 'T-02', 'T-05'], `task ids should match testuser ownership, got: ${ids}`);

    // MD must NOT mention otheruser-only tasks
    assert.ok(!r.md.includes('otheruser done'), 'MD must not include otheruser-only task T-03');
    assert.ok(!r.md.includes('otheruser not-started'), 'MD must not include otheruser-only task T-04');
    assert.ok(r.md.includes('T-01'), 'MD must include testuser task T-01');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Without --user, the full mirror is rendered as-is (legacy behavior — every task shows).
// This is the buggy behavior, kept for backward compat with callers that pass personal-view JSON.
function testNoUserFlagRendersAllTasks() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const tasks = r.json.kanban && r.json.kanban.tasks;
    assert.equal(tasks.length, 5, `without --user, all 5 tasks should pass through, got ${tasks.length}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --user should recompute stats from the filtered task set, not carry over the mirror's buckets.
function testUserFlagRecomputesStats() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, ['--user', 'testuser']);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const stats = r.json.kanban.stats;
    assert.equal(stats.total, 3, `total should be 3 (filtered), got: ${JSON.stringify(stats)}`);
    assert.equal(stats.done, 1, `done should be 1 (T-01), got: ${JSON.stringify(stats)}`);
    assert.equal(stats.in_progress, 1, `in_progress should be 1 (T-02), got: ${JSON.stringify(stats)}`);
    assert.equal(stats.not_started, 1, `not_started should be 1 (T-05), got: ${JSON.stringify(stats)}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --user should attach userMeta. In test env, team.json is unreachable → fallback to { group: '' }.
function testUserFlagAttachesUserMetaFallback() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, ['--user', 'testuser']);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const user = r.json.kanban && r.json.kanban.user;
    assert.ok(user, 'kanban.user should be present (not null)');
    assert.equal(user.git_username, 'testuser', `user.git_username should be testuser, got: ${JSON.stringify(user)}`);
    // group is '' when team.json cannot be loaded (test env has no token/network)
    assert.equal(user.group, '', `user.group should fall back to empty string in test env, got: ${JSON.stringify(user)}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// --user should rebuild deadline_calendar. T-05 (deadline 6/12, ⬜, testuser-owned)
// is overdue relative to 2026-06-13 → should appear in deadline_calendar.overdue.
function testUserFlagRebuildsDeadlineCalendar() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, ['--user', 'testuser']);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const cal = r.json.kanban && r.json.kanban.deadline_calendar;
    assert.ok(cal, 'deadline_calendar should exist after conversion');
    assert.ok(Array.isArray(cal.overdue), 'cal.overdue should be array');
    const overdueIds = cal.overdue.map((t) => t.id);
    assert.ok(overdueIds.includes('T-05'), `T-05 (deadline 6/12, ⬜) should be overdue on 6/13, got: ${overdueIds}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// When --user is passed but the JSON is already personal-view (has `user` + `deadline_calendar`),
// conversion must NOT trigger — the existing data passes through unchanged.
function testUserFlagNoopOnPersonalViewJson() {
  const tmpDir = makeTmpDir();
  try {
    const personalView = {
      source_file: 'kanban.md',
      user: { git_username: 'testuser', group: 'Dev' },
      tasks: [
        { id: 'T-01', task: 'x', owner: 'testuser', owners: ['testuser'], deadline: '6/11', status: '✅', sprint: 'Sprint 0', main_chain: 'X', notes: '', urgency: '' },
      ],
      stats: { total: 1, done: 1, in_progress: 0, at_risk: 0, blocked: 0, not_started: 0 },
      deadline_calendar: { overdue: [], today: [], tomorrow: [], day_after: [], unscheduled: [] },
    };
    writeJson(tmpDir, 'git.json', makeGitData());
    writeJson(tmpDir, 'kanban.json', personalView);
    writeJson(tmpDir, 'ai.json', makeAiData());
    const mdOut = path.join(tmpDir, 'report.md');
    const jsonOut = path.join(tmpDir, 'report.json');
    const result = spawnSync('node', [
      SCRIPT,
      '--git', path.join(tmpDir, 'git.json'),
      '--kanban', path.join(tmpDir, 'kanban.json'),
      '--ai', path.join(tmpDir, 'ai.json'),
      '--user', 'testuser',
      '--output', mdOut,
      '--json-output', jsonOut,
    ], { encoding: 'utf-8', timeout: 10000 });

    assert.equal(result.status, 0, `should exit 0, stderr: ${result.stderr}`);
    const json = JSON.parse(fs.readFileSync(jsonOut, 'utf-8'));
    assert.equal(json.kanban.tasks.length, 1, 'personal-view tasks should pass through');
    assert.equal(json.kanban.user.group, 'Dev', `group should be preserved from personal-view JSON, got: ${JSON.stringify(json.kanban.user)}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

const tests = [
  testUserFlagFiltersTasksToOwner,
  testNoUserFlagRendersAllTasks,
  testUserFlagRecomputesStats,
  testUserFlagAttachesUserMetaFallback,
  testUserFlagRebuildsDeadlineCalendar,
  testUserFlagNoopOnPersonalViewJson,
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
