'use strict';

// Tests for render-report.js --kanban-changes deprecation warning.
//
// 方案 B step 2: render-report.js 不再模拟看板变更（那是 kanban-update.js 的职责）。
// --kanban-changes 参数保留以兼容现有调用，但传入时必须输出 DEPRECATED 警告，
// 引导用户改用"kanban-update.js --json-output 生成最新 JSON → 用 --kanban 重渲染"。

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'render-report.js');
// NOTE: tmp prefix must NOT contain the word "deprecated" — the deprecation
// warning test greps stderr (which echoes the output path) for DEPRECATED,
// and a path named "...-deprecated-..." would false-positive.
const TMP_DIR_PREFIX = path.join(os.tmpdir(), 'rr-flag-warn-test-');

function makeTmpDir() { return fs.mkdtempSync(TMP_DIR_PREFIX); }
function rmTmpDir(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function writeJson(dir, filename, data) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data), 'utf-8');
}

function makeGitData() {
  return {
    date: '2026-06-12', git_username: 'testuser', repo: 'test-repo',
    stats: { commits: 1, files_changed: 1, insertions: 5, deletions: 2 },
    commits: [{
      hash: 'abcd1234', full_hash: 'abcd1234abcd1234abcd1234abcd1234abcd1234',
      datetime: '2026-06-12 10:00:00 +0800', author: 'testuser',
      subject: '[DEV] test', body: '- x',
      operator_type: 'ai_collaborative', operator_detail: 'AI-test.Developer',
      tag: '功能开发', stage: 'DEV', module: 'test',
    }],
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
      { id: 'T-01', task: 'done', status: '✅', owner: 'testuser', deadline: '6/11', notes: '' },
      { id: 'T-02', task: 'wip', status: '🔵', owner: 'testuser', deadline: '6/15', notes: '' },
    ],
    stats: { total: 2, done: 1, in_progress: 1, at_risk: 0, blocked: 0, not_started: 0 },
    deadline_calendar: { overdue: [], today: [], tomorrow: [], day_after: [], unscheduled: [] },
  };
}

function makeAiData() {
  return {
    date: '2026-06-12',
    summary: {
      total_input_tokens: 100, total_output_tokens: 50,
      total_dispatches: 0, total_wall_clock_ms: 0,
      dispatch_by_trigger: { pipeline: {}, natural: {} },
      spec_stats: { total_changes: 0, closed_loop: 0, open: 0, by_phase: {} },
      concern_stats: { total: 0, p0_found: 0, p0_closed: 0, p1_found: 0, p1_closed: 0 },
    },
    tasks: [],
  };
}

function runRender(tmpDir, opts) {
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
  if (opts && opts.kanbanChanges) {
    args.push('--kanban-changes', JSON.stringify(opts.kanbanChanges));
  }
  const result = spawnSync('node', args, { encoding: 'utf-8', timeout: 10000 });
  return { status: result.status, stderr: result.stderr || '' };
}

// RED intent: passing --kanban-changes must emit a DEPRECATED warning on stderr.
function testDeprecationWarningEmitted() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, {
      kanbanChanges: [{ task_id: 'T-02', status: '✅', notes_append: 'done' }],
    });
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    assert.ok(
      /DEPRECATED/i.test(r.stderr),
      `stderr should contain DEPRECATED, got: ${r.stderr}`
    );
    assert.ok(
      /kanban-changes/i.test(r.stderr),
      `warning should name the deprecated flag, got: ${r.stderr}`
    );
  } finally {
    rmTmpDir(tmpDir);
  }
}

// RED intent: omitting --kanban-changes must NOT emit any deprecation warning.
function testNoWarningWhenFlagAbsent() {
  const tmpDir = makeTmpDir();
  try {
    const r = runRender(tmpDir, null);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    assert.ok(
      !/DEPRECATED/i.test(r.stderr),
      `stderr should NOT contain DEPRECATED when flag absent, got: ${r.stderr}`
    );
  } finally {
    rmTmpDir(tmpDir);
  }
}

const tests = [testDeprecationWarningEmitted, testNoWarningWhenFlagAbsent];

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
