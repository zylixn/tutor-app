'use strict';

// Regression tests for kanban-update.js covering:
//   1. findHeaderRow must not mistake a data row whose notes contain '#' (e.g. "#12-#17")
//      for a header row — this previously broke task lookup in 6-column tables.
//   2. Per-person stats must recount lowercase-pinyin owners (wangzk/liujian/...).
//      Previously PERSON_RE required uppercase, so the whole table never recomputed.
//   3. Person-row formatting must keep spaces around the owner name.
//   4. applyKanbanChanges-style recalculation must keep mixed 6/7-column tables consistent.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SCRIPT = path.resolve(__dirname, '..', 'kanban-update.js');
const TMP_DIR_PREFIX = path.join(os.tmpdir(), 'kanban-update-test-');

function makeTmpDir() {
  return fs.mkdtempSync(TMP_DIR_PREFIX);
}
function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Minimal kanban with two table shapes:
//   - S0 table: 7 columns (includes 主线 / main-chain column)
//   - H table:  6 columns (no main-chain column)
// H-02's notes contain "#12-#17" which previously fooled findHeaderRow.
const KANBAN_MD = `# 测试看板

## 总览

| Sprint | 时间 | 总数 | ✅ | 🔵 | 🟡 | 🔴 | ⬜ | 完成率 |
|--------|------|------|---|---|---|---|---|--------|
| S0 规格锁定 | 6/10–6/12 | 2 | 0 | 0 | 0 | 0 | 2 | 0% |
| **合计** | **1天** | **2** | **0** | **0** | **0** | **0** | **2** | **0.0%** |

### 按人员统计

| Owner | 总数 | ✅ | 完成率 |
|-------|------|---|--------|
| wangzk | 2 | 0 | 0% |

### 按工作域统计

| 工作域 | 总数 | ✅ | 完成率 |
|--------|------|---|--------|
| 部署主线(B) | 1 | 0 | 0% |
| 驾驭工程(H) | 1 | 0 | 0% |

## Sprint 0 · 规格锁定

### 规格锁定

| # | 任务 | Owner | Deadline | 状态 | 主线 | 备注 |
|---|------|-------|----------|------|------|------|
| S0-07 | 测试部署任务 | wangzk | 6/11 | ⬜ | B | 方案待出 |

### 驾驭工程

| # | 任务 | Owner | Deadline | 状态 | 备注 |
|---|------|-------|----------|------|------|
| H-02 | 红线规则 | wangzk | 6/16 | ⬜ | 商用红线 #12-#17 |
| H-06 | 效能度量 | wangzk | 6/20 | ⬜ | usage 聚合 |

---

*最后更新：2026-06-11 by test*
`;

function runKanbanUpdate(tmpDir, changes) {
  const kanbanPath = path.join(tmpDir, 'kanban.md');
  fs.writeFileSync(kanbanPath, KANBAN_MD, 'utf-8');
  const jsonOutput = path.join(tmpDir, 'kanban.json');
  const result = spawnSync('node', [
    SCRIPT,
    '--kanban', kanbanPath,
    '--changes', JSON.stringify(changes),
    '--updater-user', 'wangzk',
    '--date', '2026-06-12',
    '--summary', 'test',
    '--json-output', jsonOutput,
  ], { encoding: 'utf-8', timeout: 10000 });
  return {
    status: result.status,
    stderr: result.stderr || '',
    md: result.stdout || '',
    jsonPath: jsonOutput,
    json: fs.existsSync(jsonOutput) ? JSON.parse(fs.readFileSync(jsonOutput, 'utf-8')) : null,
  };
}

// Regression 1: H-06 (in a 6-col table) must update even when an earlier row's
// notes contain '#'. Previously findHeaderRow matched H-02's "#12-#17" as a header.
function testHashInNotesDoesNotBreakHeaderLookup() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'H-06', status: '🔵', notes_append: '推进' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const h06Line = r.md.split('\n').find((l) => l.startsWith('| H-06 '));
    assert.ok(h06Line, 'H-06 row should exist in output');
    assert.ok(h06Line.includes('🔵'), `H-06 should be 🔵 after update, got: ${h06Line}`);
    assert.ok(!h06Line.includes('⬜'), `H-06 should not still be ⬜, got: ${h06Line}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Regression 2: per-person stats must recount lowercase owner names.
// Previously PERSON_RE = /^[A-Z]{2,5}/ never matched 'wangzk', so the table stayed stale.
// Fixture has 3 wangzk tasks (S0-07, H-02, H-06); after S0-07→✅, H-06→🔵: 3 total, 1 done.
function testPersonStatsRecountLowercaseOwner() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'S0-07', status: '✅', notes_append: '完成' },
      { task_id: 'H-06', status: '🔵', notes_append: '推进' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const personLine = r.md.split('\n').find((l) => l.startsWith('| wangzk '));
    assert.ok(personLine, `wangzk person row should exist, md:\n${r.md}`);
    // 3 total tasks (S0-07 + H-02 + H-06), 1 done (S0-07), expected 33%
    assert.ok(personLine.includes('| 3 |'), `total should be 3, got: ${personLine}`);
    assert.ok(personLine.includes('| 1 |'), `done should be 1, got: ${personLine}`);
    assert.ok(personLine.includes('33%'), `completion should be 33%, got: ${personLine}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Regression 3: person-row formatting must keep spaces around owner name.
// Previously the rewrite produced "|wangzk|" instead of "| wangzk |".
function testPersonRowFormatKeepsSpaces() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'S0-07', status: '✅', notes_append: '完成' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const personLine = r.md.split('\n').find((l) => l.includes('wangzk') && l.includes('|') && l.includes('%'));
    assert.ok(personLine, 'person row should exist');
    // Must NOT have the degenerate "|wangzk|" form (no spaces around owner name)
    assert.ok(!/\|wangzk\|/.test(personLine), `person row must keep spaces around name, got: ${personLine}`);
    assert.ok(/\| wangzk \|/.test(personLine), `person row should be "| wangzk | ...", got: ${personLine}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Mixed 6/7-column tables: both S0-07 (7-col) and H-06 (6-col) must update in one run.
function testMixedTableColumnsBothUpdate() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'S0-07', status: '✅', notes_append: '完成' },
      { task_id: 'H-06', status: '🔵', notes_append: '推进' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const s007Line = r.md.split('\n').find((l) => l.startsWith('| S0-07 '));
    const h06Line = r.md.split('\n').find((l) => l.startsWith('| H-06 '));
    assert.ok(s007Line && s007Line.includes('✅'), `S0-07 should be ✅, got: ${s007Line}`);
    assert.ok(h06Line && h06Line.includes('🔵'), `H-06 should be 🔵, got: ${h06Line}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Sprint summary table must reflect the recount.
// Fixture: 3 tasks under Sprint 0 (S0-07, H-02, H-06); after S0-07→✅, H-06→🔵: 3 total, 1✅, 1🔵, 1⬜.
function testSprintSummaryRecomputed() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'S0-07', status: '✅', notes_append: '完成' },
      { task_id: 'H-06', status: '🔵', notes_append: '推进' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const s0Line = r.md.split('\n').find((l) => l.includes('S0 规格锁定'));
    assert.ok(s0Line, 'S0 sprint row should exist');
    // 3 total, 1 done, 1 in_progress — format: | S0 规格锁定 | 时间 | 3 | 1 | 1 | 0 | 0 | 1 | 33% |
    assert.ok(s0Line.includes('| 3 |'), `S0 total should be 3, got: ${s0Line}`);
    assert.ok(/\| 1 \| 1 \|/.test(s0Line), `S0 should show 1✅ 1🔵, got: ${s0Line}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Ownership validation must still reject tasks not owned by the updater.
function testOwnershipValidationRejectsForeignTask() {
  const tmpDir = makeTmpDir();
  try {
    const kanbanPath = path.join(tmpDir, 'kanban.md');
    fs.writeFileSync(kanbanPath, KANBAN_MD, 'utf-8');
    const result = spawnSync('node', [
      SCRIPT,
      '--kanban', kanbanPath,
      '--changes', JSON.stringify([{ task_id: 'S0-07', status: '✅', notes_append: 'x' }]),
      '--updater-user', 'zhoucw',  // not an owner of S0-07
      '--date', '2026-06-12',
    ], { encoding: 'utf-8', timeout: 10000 });
    assert.notEqual(result.status, 0, 'should exit non-zero for foreign task');
    const stderr = result.stderr || '';
    assert.ok(stderr.includes('所有权') || stderr.includes('Owner') || stderr.includes('wangzk'), `stderr should mention ownership, got: ${stderr}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// JSON output must include the kanban-source structure: tasks array + stats.
function testJsonOutputHasTables() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'S0-07', status: '✅', notes_append: '完成' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    assert.ok(r.json, 'JSON output should exist');
    // New structure (kanban-source.schema.json): tasks is an array, stats holds aggregates.
    assert.ok(Array.isArray(r.json.tasks), `tasks should be an array, got: ${typeof r.json.tasks}`);
    assert.ok(r.json.tasks.length > 0, `tasks array should not be empty, got: ${r.json.tasks.length}`);
    assert.ok(r.json.stats, 'stats should exist');
    assert.ok(r.json.stats.sprint_stats, 'stats.sprint_stats should exist');
    assert.ok(r.json.stats.owner_stats, 'stats.owner_stats should exist');
    assert.ok(r.json.stats.chain_stats, 'stats.chain_stats should exist');
    // First task should carry the canonical field names (id, not task_id).
    const first = r.json.tasks[0];
    assert.ok(first.id, `task should have 'id' field, got: ${JSON.stringify(first)}`);
    assert.ok(first.main_chain !== undefined, `task should have 'main_chain' field, got: ${JSON.stringify(first)}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Bug 2 regression: when caller mistakenly includes the date signature in
// notes_append (e.g. "完成（AI 06/13)"), the script must strip it before
// appending its own signature, avoiding "（AI 06/13)（AI 06/13)" duplication.
function testNotesAppendStripsDuplicateSignature() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'H-06', status: '🔵', notes_append: '推进（AI 06/13)' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const h06Line = r.md.split('\n').find((l) => l.startsWith('| H-06 '));
    assert.ok(h06Line, 'H-06 row should exist');
    // The signature "（AI 06/12)" appears exactly once (test runs with --date 2026-06-12).
    // Note: the script emits full-width "（" + half-width ")" — match that literal form.
    const matchCount = (h06Line.match(/（AI 06\/12\)/g) || []).length;
    assert.equal(matchCount, 1, `expected exactly one "（AI 06/12)" signature, got ${matchCount} in: ${h06Line}`);
    // And the original content "推进" is preserved.
    assert.ok(h06Line.includes('推进'), `notes content "推进" should be preserved, got: ${h06Line}`);
    // The caller's mistaken "（AI 06/13)" must NOT survive.
    assert.ok(!h06Line.includes('（AI 06/13)'), `caller-supplied 06/13 signature must be stripped, got: ${h06Line}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Same regression but with half-width parentheses "(AI 6/12)" — common typos.
function testNotesAppendStripsHalfWidthSignature() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'H-06', status: '🔵', notes_append: '推进 (AI 6/12)' },
    ]);
    assert.equal(r.status, 0, `should exit 0, stderr: ${r.stderr}`);
    const h06Line = r.md.split('\n').find((l) => l.startsWith('| H-06 '));
    assert.ok(h06Line, 'H-06 row should exist');
    const fullCount = (h06Line.match(/（AI 06\/12\)/g) || []).length;
    const halfCount = (h06Line.match(/\(AI 6\/12\)/g) || []).length;
    assert.equal(fullCount, 1, `expected exactly one full-width "（AI 06/12)" signature, got ${fullCount} in: ${h06Line}`);
    assert.equal(halfCount, 0, `half-width "(AI 6/12)" must be stripped, got ${halfCount} in: ${h06Line}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

const NEW_FORMAT_KANBAN_MD = `# 新格式看板

> **迭代开发版本号**：TEST_v1.0.0_20260615

## 总览

| Sprint | 时间 | 总数 | ✅ | 🔵 | 🟡 | 🔴 | ⬜ | 完成率 |
|--------|------|------|---|---|---|---|---|--------|
| S0 规格锁定 | 6/10–6/12 | 1 | 0 | 0 | 0 | 0 | 1 | 0% |
| **合计** | **1天** | **1** | **0** | **0** | **0** | **0** | **1** | **0.0%** |

### 按人员统计

| Owner | 总数 | ✅ | 完成率 |
|-------|------|---|--------|
| wangzk | 1 | 0 | 0% |

### 按工作域统计

| 工作域 | 总数 | ✅ | 完成率 |
|--------|------|---|--------|
| 驾驭工程 | 1 | 0 | 0% |

## Sprint 0 · 规格锁定

### 驾驭工程

| # | 任务 | 对应研发系统需求号 | Owner | Deadline | 状态 | 备注 |
|---|------|--------------------|-------|----------|------|------|
| H-06 | 效能度量 | REQ-123 | wangzk | 6/20 | ⬜ | usage 聚合 |
`;

function runKanbanUpdateWithContent(tmpDir, md, changes) {
  const kanbanPath = path.join(tmpDir, 'kanban.md');
  fs.writeFileSync(kanbanPath, md, 'utf-8');
  const jsonOutput = path.join(tmpDir, 'kanban.json');
  const result = spawnSync('node', [
    SCRIPT,
    '--kanban', kanbanPath,
    '--changes', JSON.stringify(changes),
    '--updater-user', 'wangzk',
    '--date', '2026-06-12',
    '--summary', 'test',
    '--json-output', jsonOutput,
  ], { encoding: 'utf-8', timeout: 10000 });
  return {
    status: result.status,
    stderr: result.stderr || '',
    md: result.stdout || '',
    jsonPath: jsonOutput,
    json: fs.existsSync(jsonOutput) ? JSON.parse(fs.readFileSync(jsonOutput, 'utf-8')) : null,
  };
}

function testNewFormatRequirementColumnDoesNotShiftOwnerStats() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdateWithContent(tmpDir, NEW_FORMAT_KANBAN_MD, [
      { task_id: 'H-06', status: '✅', notes_append: '完成' },
    ]);
    assert.equal(r.status, 0, `new format board should update, stderr: ${r.stderr}`);
    assert.ok(!/legacy kanban format detected/.test(r.stderr), `new format should not warn legacy, got: ${r.stderr}`);
    const personLine = r.md.split('\n').find((l) => l.startsWith('| wangzk '));
    assert.ok(personLine, `wangzk person row should exist, md:\n${r.md}`);
    assert.ok(personLine.includes('| 1 | 1 | 100% |'), `owner stats should count wangzk not REQ-123, got: ${personLine}`);
    const chainLine = r.md.split('\n').find((l) => l.startsWith('| 驾驭工程 '));
    assert.ok(chainLine && chainLine.includes('| 1 | 1 | 100% |'), `work-domain stats should recompute, got: ${chainLine}`);
    assert.ok(!r.md.split('\n').some((l) => l.startsWith('| REQ-123 ')), `requirement id must not become a stats row, md:\n${r.md}`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Legacy boards created before iterative_version / requirement-id columns must remain updateable.
// They should warn instead of failing, update task rows, recompute summaries, and still emit JSON.
function testLegacyBoardWithoutVersionAndRequirementColumnUpdatesSilently() {
  const tmpDir = makeTmpDir();
  try {
    const r = runKanbanUpdate(tmpDir, [
      { task_id: 'S0-07', status: '✅', notes_append: '兼容更新' },
    ]);
    assert.equal(r.status, 0, `legacy board should update, stderr: ${r.stderr}`);
    // 653ff2d: legacy warning intentionally suppressed for silent compatibility
    assert.ok(!r.stderr.includes('legacy kanban format detected'),
      `stderr should NOT warn legacy format (silent compat), got: ${r.stderr}`);

    const s007Line = r.md.split('\n').find((l) => l.startsWith('| S0-07 '));
    assert.ok(s007Line && s007Line.includes('✅'), `legacy task row should update, got: ${s007Line}`);
    assert.ok(s007Line.includes('兼容更新'), `legacy notes should append, got: ${s007Line}`);

    assert.ok(r.json, 'legacy board should still emit JSON');
    const task = r.json.tasks.find((t) => t.id === 'S0-07');
    assert.ok(task, `JSON should include S0-07, got: ${JSON.stringify(r.json.tasks)}`);
    assert.equal(task.owner, 'wangzk');
    assert.equal(task.status, '✅');
    assert.ok(!Object.prototype.hasOwnProperty.call(task, 'requirement_id'), 'legacy JSON should not invent unsupported schema fields');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Regression: when validateKanbanSource returns invalid (e.g. ajv load failure
// or actual schema violation), kanban-update.js must:
//   (a) exit non-zero,
//   (b) keep stdout EMPTY (defense against caller `2>&1` misuse — root cause of
//       the 2026-06-16 incident where 630_kanban-LOCKED.md was overwritten with
//       5 lines of stderr), and
//   (c) emit a single-line summary to stderr + full details to a sibling
//       kanban-update-error.log file.
// We inject a failing validator via `node --require preload.js` so we don't
// depend on constructing a malformed kanban (which would couple this test to
// parse-kanban-md internals).
function testSchemaFailureKeepsStdoutEmpty() {
  const tmpDir = makeTmpDir();
  try {
    const kanbanPath = path.join(tmpDir, 'kanban.md');
    fs.writeFileSync(kanbanPath, KANBAN_MD, 'utf-8');
    const jsonOutput = path.join(tmpDir, 'kanban.json');
    const errorLog = path.join(tmpDir, 'kanban-update-error.log');

    const preload = path.join(tmpDir, 'preload-mock-validator.js');
    fs.writeFileSync(preload, `
      const Module = require('module');
      const orig = Module.prototype.require;
      Module.prototype.require = function (id) {
        const mod = orig.apply(this, arguments);
        if (typeof id === 'string' && id.endsWith('schema-validator')) {
          return {
            validateKanbanSource: () => ({
              valid: false,
              errors: ['mock schema error A', 'mock schema error B'],
            }),
            validateDailyReport: () => ({ valid: true, errors: [] }),
          };
        }
        return mod;
      };
    `, 'utf-8');

    const result = spawnSync('node', [
      '--require', preload,
      SCRIPT,
      '--kanban', kanbanPath,
      '--changes', '[]',
      '--updater-user', 'wangzk',
      '--date', '2026-06-12',
      '--summary', 'test',
      '--json-output', jsonOutput,
    ], { encoding: 'utf-8', timeout: 10000 });

    // (a) non-zero exit
    assert.notEqual(result.status, 0,
      `schema failure must exit non-zero, got status=${result.status}, stderr=${result.stderr}`);

    // (b) stdout MUST be empty — this is the core defense against 2>&1 misuse
    assert.equal(result.stdout, '',
      `stdout must be empty on schema failure to defend against caller 2>&1 misuse, got: ${JSON.stringify(result.stdout.slice(0, 200))}`);

    // (c) stderr is a single-line summary
    const stderrLines = (result.stderr || '').split('\n').filter((l) => l.trim());
    assert.equal(stderrLines.length, 1,
      `stderr must be single-line summary (got ${stderrLines.length} lines): ${JSON.stringify(stderrLines)}`);
    assert.ok(stderrLines[0].includes('schema') && stderrLines[0].includes('校验失败'),
      `stderr summary must mention schema failure, got: ${stderrLines[0]}`);

    // (d) full details written to sibling error log
    assert.ok(fs.existsSync(errorLog), `error log file should exist at ${errorLog}`);
    const logContent = fs.readFileSync(errorLog, 'utf-8');
    assert.ok(logContent.includes('mock schema error A') && logContent.includes('mock schema error B'),
      `error log must contain full error details, got: ${logContent}`);

    // (e) JSON output must NOT be created (atomicity: nothing produced on failure)
    assert.ok(!fs.existsSync(jsonOutput),
      `JSON output must not be created on schema failure (atomicity), but it exists`);
  } finally {
    rmTmpDir(tmpDir);
  }
}

// Regression: ajv module load failure (e.g. user's local workspace missing
// the ajv/dist/2020 entry — the 2026-06-16 incident trigger) must surface as
// a single-line error, NOT a multi-line Node Require stack that could clobber
// the target md if the caller wrongly uses 2>&1.
function testAjvLoadFailureYieldsSingleLineError() {
  const tmpDir = makeTmpDir();
  try {
    // Fake ajv/dist/2020 module that throws synchronously with a multi-line
    // message that mimics Node's "Cannot find module ... Require stack:" format.
    const fakeAjv2020 = path.join(tmpDir, 'fake-ajv-2020.js');
    fs.writeFileSync(fakeAjv2020,
      "throw new Error(\"Cannot find module 'ajv/dist/2020'\\n" +
      "Require stack:\\n" +
      "- fake-schema-validator.js\\n" +
      "- fake-kanban-update.js\");",
      'utf-8');

    // Preload hooks Module._resolveFilename so `require('ajv/dist/2020')`
    // inside schema-validator.js loads our fake instead of the real one.
    const preload = path.join(tmpDir, 'preload-fail-ajv.js');
    fs.writeFileSync(preload,
      "const Module = require('module');\n" +
      "const orig = Module._resolveFilename;\n" +
      `const fake = ${JSON.stringify(fakeAjv2020)};\n` +
      "Module._resolveFilename = function (req, parent, isMain, options) {\n" +
      "  if (req === 'ajv/dist/2020') return fake;\n" +
      "  return orig.call(this, req, parent, isMain, options);\n" +
      "};\n",
      'utf-8');

    const kanbanPath = path.join(tmpDir, 'kanban.md');
    fs.writeFileSync(kanbanPath, KANBAN_MD, 'utf-8');
    const jsonOutput = path.join(tmpDir, 'kanban.json');

    const result = spawnSync('node', [
      '--require', preload,
      SCRIPT,
      '--kanban', kanbanPath,
      '--changes', '[]',
      '--updater-user', 'wangzk',
      '--date', '2026-06-12',
      '--summary', 'test',
      '--json-output', jsonOutput,
    ], { encoding: 'utf-8', timeout: 10000 });

    // ajv load failure path → schemaCheck.valid is false → non-zero exit
    assert.notEqual(result.status, 0,
      `ajv load failure must exit non-zero, got status=${result.status}, stderr=${result.stderr}`);

    // Even though the underlying error.message contains newlines (Require stack),
    // schema-validator.js's shortLoadError must collapse it to a single line,
    // and kanban-update.js must keep stdout empty.
    assert.equal(result.stdout, '',
      `stdout must be empty even when ajv load fails, got: ${JSON.stringify(result.stdout.slice(0, 200))}`);

    const stderrLines = (result.stderr || '').split('\n').filter((l) => l.trim());
    assert.equal(stderrLines.length, 1,
      `stderr must be single-line even on ajv load failure, got ${stderrLines.length} lines: ${JSON.stringify(stderrLines)}`);
    assert.ok(!stderrLines[0].includes('Require stack'),
      `stderr must NOT leak Require stack, got: ${stderrLines[0]}`);

    // Error log file still gets created with the (collapsed) single-line error
    const errorLog = path.join(tmpDir, 'kanban-update-error.log');
    assert.ok(fs.existsSync(errorLog), 'error log must exist even on ajv load failure');
  } finally {
    rmTmpDir(tmpDir);
  }
}

const tests = [
  testHashInNotesDoesNotBreakHeaderLookup,
  testPersonStatsRecountLowercaseOwner,
  testPersonRowFormatKeepsSpaces,
  testMixedTableColumnsBothUpdate,
  testSprintSummaryRecomputed,
  testOwnershipValidationRejectsForeignTask,
  testJsonOutputHasTables,
  testNotesAppendStripsDuplicateSignature,
  testNotesAppendStripsHalfWidthSignature,
  testNewFormatRequirementColumnDoesNotShiftOwnerStats,
  testLegacyBoardWithoutVersionAndRequirementColumnUpdatesSilently,
  testSchemaFailureKeepsStdoutEmpty,
  testAjvLoadFailureYieldsSingleLineError,
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
