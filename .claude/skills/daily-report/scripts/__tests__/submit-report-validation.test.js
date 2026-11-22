'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SUBMIT_REPORT = path.resolve(__dirname, '..', 'submit-report.js');
const SCHEMA_FILE = path.resolve(__dirname, '..', '..', 'schemas', 'daily-report.schema.json');

const TMP_DIR_PREFIX = path.join(os.tmpdir(), 'submit-report-validation-test-');

function makeTmpDir() {
  return fs.mkdtempSync(TMP_DIR_PREFIX);
}

function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeJsonFile(dir, filename, content) {
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

// --- Helper: build a minimal valid daily-report JSON ---
function makeValidReport() {
  return {
    date: '2026-06-09',
    git_username: 'testuser',
    repo: 'test-repo',
    git: {
      stats: { commits: 3, files_changed: 5, insertions: 100, deletions: 20 },
      classification: {
        ai_independent: { count: 1, hashes: ['abcd1234'] },
        ai_collaborative: { count: 1, hashes: ['efgh5678'] },
        human: { count: 1, hashes: ['ijkl9012'] },
      },
      tags: {},
      commits: [
        {
          hash: 'abcd1234', full_hash: 'abcd1234abcd1234abcd1234abcd1234abcd1234',
          datetime: '2026-06-09 10:00:00 +0800', author: 'testuser',
          subject: '[DEV] test commit', body: '- fix something',
          operator_type: 'ai_independent', operator_detail: 'AI-test.Developer',
          tag: '功能开发', stage: 'DEV', module: 'test',
        },
      ],
    },
    kanban: {
      source_file: 'kanban.md',
      user: { git_username: 'testuser', group: 'Dev' },
      tasks: [],
      stats: { total: 0, done: 0, in_progress: 0, at_risk: 0, blocked: 0, not_started: 0 },
      deadline_calendar: {
        overdue: [],
        today: [],
        tomorrow: [],
        day_after: [],
        unscheduled: [],
      },
    },
  };
}

// ===== JSON.parse 预检测试 =====

function testValidateJsonValid() {
  const { validateJson } = require(SUBMIT_REPORT);
  const result = validateJson('{"a":1}');
  assert.equal(result.valid, true, 'valid JSON should pass');
  assert.equal(result.error, null, 'valid JSON should have no error');
}

function testValidateJsonInvalid() {
  const { validateJson } = require(SUBMIT_REPORT);
  const result = validateJson('{bad json');
  assert.equal(result.valid, false, 'invalid JSON should fail');
  assert.ok(result.error, 'invalid JSON should have error message');
}

function testValidateJsonEmpty() {
  const { validateJson } = require(SUBMIT_REPORT);
  const result = validateJson('');
  assert.equal(result.valid, false, 'empty string should fail');
}

function testValidateJsonArray() {
  const { validateJson } = require(SUBMIT_REPORT);
  const result = validateJson('[1, 2, 3]');
  assert.equal(result.valid, true, 'valid JSON array should pass');
}

// ===== Schema 校验测试 =====

function testValidateSchemaValid() {
  const { validateSchema } = require(SUBMIT_REPORT);
  const data = makeValidReport();
  const result = validateSchema(data, SCHEMA_FILE);
  assert.equal(result.valid, true, `valid report should pass schema validation, errors: ${JSON.stringify(result.errors)}`);
}

function testValidateSchemaMissingRequired() {
  const { validateSchema } = require(SUBMIT_REPORT);
  const data = makeValidReport();
  delete data.date;
  const result = validateSchema(data, SCHEMA_FILE);
  assert.equal(result.valid, false, 'missing "date" should fail');
  const errMsgs = result.errors.join(' ');
  assert.ok(errMsgs.includes('date'), `error should mention "date", got: ${errMsgs}`);
}

function testValidateSchemaWrongType() {
  const { validateSchema } = require(SUBMIT_REPORT);
  const data = makeValidReport();
  data.git.stats.commits = 'not-a-number';
  const result = validateSchema(data, SCHEMA_FILE);
  assert.equal(result.valid, false, 'wrong type should fail');
  const errMsgs = result.errors.join(' ');
  assert.ok(errMsgs.includes('commits') || errMsgs.includes('integer'), `error should mention commits or integer, got: ${errMsgs}`);
}

function testValidateSchemaAdditionalProperty() {
  const { validateSchema } = require(SUBMIT_REPORT);
  const data = makeValidReport();
  data.extra_field = 'should not be here';
  const result = validateSchema(data, SCHEMA_FILE);
  assert.equal(result.valid, false, 'additional property should fail');
  const errMsgs = result.errors.join(' ');
  assert.ok(errMsgs.includes('extra_field') || errMsgs.includes('additional'), `error should mention extra field, got: ${errMsgs}`);
}

function testValidateSchemaInvalidEnum() {
  const { validateSchema } = require(SUBMIT_REPORT);
  const data = makeValidReport();
  data.git.commits[0].operator_type = 'invalid_type';
  const result = validateSchema(data, SCHEMA_FILE);
  assert.equal(result.valid, false, 'invalid enum should fail');
  const errMsgs = result.errors.join(' ');
  assert.ok(errMsgs.includes('operator_type') || errMsgs.includes('enum'), `error should mention operator_type or enum, got: ${errMsgs}`);
}

function testValidateSchemaShortHash() {
  const { validateSchema } = require(SUBMIT_REPORT);
  const data = makeValidReport();
  data.git.commits[0].hash = 'abc';
  const result = validateSchema(data, SCHEMA_FILE);
  assert.equal(result.valid, false, 'too-short hash should fail');
}

function testValidateSchemaNullWhereRequired() {
  const { validateSchema } = require(SUBMIT_REPORT);
  const data = makeValidReport();
  data.git.commits[0].subject = null;
  const result = validateSchema(data, SCHEMA_FILE);
  assert.equal(result.valid, false, 'null subject should fail');
}

// ===== submit-report 集成测试：JSON 文件在提交前被预检 =====

function testSubmitReportRejectsInvalidJsonBeforeApiCall() {
  const tmpDir = makeTmpDir();
  try {
    // Write an invalid JSON file
    writeJsonFile(tmpDir, 'report.json', '{broken json content here');

    // Run submit-report with invalid JSON. Should fail at validation, not at API call.
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('node', [SUBMIT_REPORT,
      '--gitlab-url', 'http://localhost:9999',
      '--project-id', '1',
      '--token', 'fake',
      '--branch', 'dev',
      '--commit-message', 'test',
      '--md-file', path.join(tmpDir, 'report.json'),
      '--json-file', path.join(tmpDir, 'report.json'),
      '--remote-md-path', 'reports/test.md',
      '--remote-json-path', 'reports/test.json',
    ], { encoding: 'utf-8', timeout: 10000 });

    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    // Should reject before hitting the nonexistent API
    assert.notEqual(result.status, 0, 'should exit non-zero for invalid JSON');
    assert.ok(
      stderr.includes('JSON') || stderr.includes('json') || stderr.includes('parse') || stderr.includes('Parse'),
      `stderr should mention JSON validation, got: ${stderr}`
    );
  } finally {
    rmTmpDir(tmpDir);
  }
}

function testSubmitReportSchemaValidationBlocksInvalidData() {
  const tmpDir = makeTmpDir();
  try {
    // Write JSON that parses OK but violates the schema (missing required "date")
    const badData = makeValidReport();
    delete badData.date;
    delete badData.git_username;
    writeJsonFile(tmpDir, 'report.json', JSON.stringify(badData));

    const { spawnSync } = require('node:child_process');
    const result = spawnSync('node', [SUBMIT_REPORT,
      '--gitlab-url', 'http://localhost:9999',
      '--project-id', '1',
      '--token', 'fake',
      '--branch', 'dev',
      '--commit-message', 'test',
      '--md-file', path.join(tmpDir, 'report.json'),
      '--json-file', path.join(tmpDir, 'report.json'),
      '--remote-md-path', 'reports/test.md',
      '--remote-json-path', 'reports/test.json',
    ], { encoding: 'utf-8', timeout: 10000 });

    const stderr = result.stderr || '';
    assert.notEqual(result.status, 0, 'should exit non-zero for schema violation');
    assert.ok(
      stderr.toLowerCase().includes('schema') || stderr.toLowerCase().includes('date') || stderr.toLowerCase().includes('required'),
      `stderr should reference schema violation, got: ${stderr}`
    );
  } finally {
    rmTmpDir(tmpDir);
  }
}

// ===== schema 文件缺失处理 =====

function testValidateSchemaMissingFile() {
  const { validateSchema } = require(SUBMIT_REPORT);
  const data = makeValidReport();
  const result = validateSchema(data, '/nonexistent/path/schema.json');
  assert.equal(result.valid, false, 'missing schema file should fail');
  assert.ok(
    result.errors.join(' ').includes('schema') || result.errors.join(' ').includes('Schema') || result.errors.join(' ').includes('load') || result.errors.join(' ').includes('read'),
    `error should mention schema load failure, got: ${result.errors.join(' ')}`
  );
}

// ===== Kanban-only mode (no report files) =====
// Regression: previously --md-file/--json-file were globally required,
// which blocked the skill's "kanban-update only" flow.

function spawnSubmit(args) {
  const { spawnSync } = require('node:child_process');
  return spawnSync('node', [SUBMIT_REPORT, ...args], { encoding: 'utf-8', timeout: 10000 });
}

function testKanbanOnlyModePassesArgValidation() {
  const tmpDir = makeTmpDir();
  try {
    writeJsonFile(tmpDir, 'kanban.json', JSON.stringify({ source_file: 'k.md', tasks: [], tables: {} }));
    fs.writeFileSync(path.join(tmpDir, 'kanban.md'), '# kanban\n');
    const result = spawnSubmit([
      '--gitlab-url', 'http://localhost:9999',
      '--project-id', '1',
      '--token', 'fake',
      '--branch', 'dev',
      '--commit-message', 'test',
      '--kanban-md-file', path.join(tmpDir, 'kanban.md'),
      '--kanban-json-file', path.join(tmpDir, 'kanban.json'),
      '--remote-kanban-md-path', 'reports/2026/knowledge/k.md',
      '--remote-kanban-json-path', 'reports/2026/knowledge/json/k.json',
    ]);
    const stderr = result.stderr || '';
    // Must NOT fail at the arg-validation gate. Later API call to localhost:9999 may fail, that's fine.
    assert.ok(!stderr.includes('Missing required option'), `kanban-only mode should not require report files, got: ${stderr}`);
    assert.ok(!stderr.includes('Must provide either'), `kanban-only mode should not be rejected, got: ${stderr}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Kanban JSON must now validate against kanban-source.schema.json.
// (Previously this test asserted the opposite — that kanban JSON skipped
// schema validation. C-7 closed that gap; this test now verifies the gate.)
function testKanbanJsonValidatesAgainstKanbanSourceSchema() {
  const tmpDir = makeTmpDir();
  try {
    // Deliberately use the OLD structure (tasks as aggregate object + tables
    // array) which violates kanban-source.schema.json. Submit must reject it.
    writeJsonFile(tmpDir, 'kanban.json', JSON.stringify({
      source_file: 'k.md', updated_at: '2026-06-12', updated_by: 'AI',
      updated_by_user: 'wangzk', change_summary: 'S0-07✅',
      tasks: { sprints: {}, owners: {}, chains: {} }, tables: {},
    }));
    fs.writeFileSync(path.join(tmpDir, 'kanban.md'), '# kanban\n');
    const result = spawnSubmit([
      '--gitlab-url', 'http://localhost:9999',
      '--project-id', '1',
      '--token', 'fake',
      '--branch', 'dev',
      '--commit-message', 'test',
      '--kanban-md-file', path.join(tmpDir, 'kanban.md'),
      '--kanban-json-file', path.join(tmpDir, 'kanban.json'),
      '--remote-kanban-md-path', 'reports/2026/knowledge/k.md',
      '--remote-kanban-json-path', 'reports/2026/knowledge/json/k.json',
    ]);
    const stderr = result.stderr || '';
    assert.notEqual(result.status, 0, 'invalid kanban JSON should fail submit');
    assert.ok(
      stderr.includes('schema validation failed'),
      `invalid kanban JSON should be rejected by schema, got: ${stderr}`
    );
    // Must fail BEFORE hitting the GitLab API (localhost:9999 doesn't exist)
    assert.ok(
      !stderr.includes('success'),
      `must not call GitLab API on schema failure, got: ${stderr}`
    );
  } finally {
    rmTmpDir(tmpDir);
  }
}

// A kanban JSON that conforms to kanban-source.schema.json must pass the gate.
function testValidKanbanJsonPassesSchema() {
  const tmpDir = makeTmpDir();
  try {
    // Canonical structure: tasks array + stats{sprint_stats,owner_stats,chain_stats}
    writeJsonFile(tmpDir, 'kanban.json', JSON.stringify({
      source_file: 'k.md',
      updated_at: '2026-06-12',
      updated_by: 'AI',
      updated_by_user: 'wangzk',
      change_summary: 'S0-07✅',
      tasks: [
        {
          id: 'S0-07', task: '测试任务', owner: 'wangzk', owners: ['wangzk'],
          deadline: '6/11', status: '✅', sprint: 'Sprint 0',
          main_chain: '规格锁定', notes: '', urgency: '',
        },
      ],
      stats: {
        sprint_stats: { 'Sprint 0': { total: 1, done: 1 } },
        owner_stats: { wangzk: { total: 1, done: 1 } },
        chain_stats: { '规格锁定': { total: 1, done: 1 } },
      },
    }));
    fs.writeFileSync(path.join(tmpDir, 'kanban.md'), '# kanban\n');
    const result = spawnSubmit([
      '--gitlab-url', 'http://localhost:9999',
      '--project-id', '1',
      '--token', 'fake',
      '--branch', 'dev',
      '--commit-message', 'test',
      '--kanban-md-file', path.join(tmpDir, 'kanban.md'),
      '--kanban-json-file', path.join(tmpDir, 'kanban.json'),
      '--remote-kanban-md-path', 'reports/2026/knowledge/k.md',
      '--remote-kanban-json-path', 'reports/2026/knowledge/json/k.json',
    ]);
    const stderr = result.stderr || '';
    // Schema validation must pass. The subsequent GitLab API call to
    // localhost:9999 will fail (that's fine), but it must NOT fail at the
    // schema gate.
    assert.ok(
      !stderr.includes('schema validation failed'),
      `valid kanban JSON should pass schema, got: ${stderr}`
    );
    assert.ok(
      stderr.includes('validation passed for --kanban-json-file'),
      `should log schema pass for kanban JSON, got: ${stderr}`
    );
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Neither report nor kanban files provided → must fail with clear message.
function testNeitherReportNorKanbanFails() {
  const result = spawnSubmit([
    '--gitlab-url', 'http://localhost:9999',
    '--project-id', '1',
    '--token', 'fake',
    '--branch', 'dev',
    '--commit-message', 'test',
  ]);
  assert.notEqual(result.status, 0, 'should exit non-zero when no files provided');
  const stderr = result.stderr || '';
  assert.ok(stderr.includes('Must provide either'), `should require report or kanban files, got: ${stderr}`);
}

// ===== Runner =====
const tests = [
  testValidateJsonValid,
  testValidateJsonInvalid,
  testValidateJsonEmpty,
  testValidateJsonArray,
  testValidateSchemaValid,
  testValidateSchemaMissingRequired,
  testValidateSchemaWrongType,
  testValidateSchemaAdditionalProperty,
  testValidateSchemaInvalidEnum,
  testValidateSchemaShortHash,
  testValidateSchemaNullWhereRequired,
  testSubmitReportRejectsInvalidJsonBeforeApiCall,
  testSubmitReportSchemaValidationBlocksInvalidData,
  testValidateSchemaMissingFile,
  testKanbanOnlyModePassesArgValidation,
  testKanbanJsonValidatesAgainstKanbanSourceSchema,
  testValidKanbanJsonPassesSchema,
  testNeitherReportNorKanbanFails,
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
