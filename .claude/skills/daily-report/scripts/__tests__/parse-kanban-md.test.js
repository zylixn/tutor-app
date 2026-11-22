'use strict';

// Tests for lib/parse-kanban-md.js shared parser.
// Covers:
//   - basic field extraction (id/task/owner/deadline/status/sprint/main_chain)
//   - multi-owner split ("张三+李四" → owners array)
//   - N-3 regression: notes containing "5/8" must NOT be mistaken for deadline
//   - N-3 regression: notes containing status emoji must NOT be mistaken for status
//   - risk registry section must be skipped
//   - urgency column present / absent
//   - sprint title normalization ("S0 规格锁定" → "Sprint 0")
//   - stats aggregation (sprint_stats / owner_stats / chain_stats)

const assert = require('node:assert/strict');
const path = require('node:path');

const PARSER = path.resolve(__dirname, '..', 'lib', 'parse-kanban-md.js');

// Fixture: 7-column table (with 主线 column) + 6-column table (without).
// H-02 notes contain "5/8" and "🔴" which previously fooled heuristic scanners.
const KANBAN_MD = `# 测试看板

## 总览

| Sprint | 时间 | 总数 | ✅ | 🔵 | 🟡 | 🔴 | ⬜ | 完成率 |
|--------|------|------|---|---|---|---|---|--------|
| S0 规格锁定 | 6/10–6/12 | 3 | 0 | 0 | 0 | 0 | 3 | 0% |

## Sprint 0 · 规格锁定

### 规格锁定

| # | 任务 | Owner | Deadline | 状态 | 主线 | 备注 |
|---|------|-------|----------|------|------|------|
| S0-07 | 部署任务 | wangzk | 6/11 | ⬜ | B | 方案待出 |
| S0-08 | 多人任务 | 张三+李四 | 6/12 | 🔵 | H | 推进中 |

### 驾驭工程

| # | 任务 | Owner | Deadline | 状态 | 备注 |
|---|------|-------|----------|------|------|
| H-02 | 红线规则 | wangzk | 6/16 | ⬜ | 商用红线 5/8 上线 🔴 阻塞 |
| H-06 | 效能度量 | wangzk | 6/20 | ⬜ | usage 聚合 |

## 风险登记簿

| 编号 | 风险 | Owner | 状态 |
|------|------|-------|------|
| R-01 | 测试风险 | wangzk | 🟡 |

---

*最后更新：2026-06-13 by test*
`;

function findTask(tasks, id) {
  return tasks.find((t) => t.id === id);
}

// Basic field extraction: id, task, owner, deadline, status, sprint, main_chain.
function testBasicFieldExtraction() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD);
  const s007 = findTask(tasks, 'S0-07');
  assert.ok(s007, `S0-07 should be parsed, got tasks: ${tasks.map((t) => t.id).join(',')}`);
  assert.equal(s007.task, '部署任务', `task name, got: ${s007.task}`);
  assert.equal(s007.owner, 'wangzk', `owner, got: ${s007.owner}`);
  assert.equal(s007.deadline, '6/11', `deadline, got: ${s007.deadline}`);
  assert.equal(s007.status, '⬜', `status, got: ${s007.status}`);
  assert.equal(s007.sprint, 'Sprint 0', `sprint should be normalized, got: ${s007.sprint}`);
  assert.equal(s007.main_chain, '规格锁定', `main_chain, got: ${s007.main_chain}`);
}

// Multi-owner split: "张三+李四" → owners array
function testMultiOwnerSplit() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD);
  const s008 = findTask(tasks, 'S0-08');
  assert.ok(s008, 'S0-08 should be parsed');
  assert.deepEqual(s008.owners, ['张三', '李四'], `owners array, got: ${JSON.stringify(s008.owners)}`);
  // owner field is the joined form
  assert.equal(s008.owner, '张三+李四', `owner joined, got: ${s008.owner}`);
}

// N-3 regression: H-02 notes contain "5/8" — must NOT be parsed as deadline.
// Deadline must come from the Deadline column (6/16), not from notes.
function testNotesDateNotMistakenAsDeadline() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD);
  const h02 = findTask(tasks, 'H-02');
  assert.ok(h02, 'H-02 should be parsed');
  assert.equal(h02.deadline, '6/16', `deadline must be from Deadline column, got: ${h02.deadline}`);
  assert.ok(!h02.deadline.includes('5/8'), `deadline must not pick up notes' 5/8, got: ${h02.deadline}`);
}

// N-3 regression: H-02 notes contain "🔴" — must NOT be parsed as status.
// Status must come from the 状态 column (⬜), not from notes.
function testNotesEmojiNotMistakenAsStatus() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD);
  const h02 = findTask(tasks, 'H-02');
  assert.ok(h02, 'H-02 should be parsed');
  assert.equal(h02.status, '⬜', `status must be from 状态 column, got: ${h02.status}`);
}

// Risk registry section must be skipped — R-01 must NOT appear in tasks.
function testRiskRegistrySkipped() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD);
  const r01 = findTask(tasks, 'R-01');
  assert.ok(!r01, `R-01 (risk registry) must be skipped, got tasks: ${tasks.map((t) => t.id).join(',')}`);
}

// Urgency column: when present, urgency is extracted; when absent, urgency is empty string.
function testUrgencyColumnPresent() {
  const { parseKanbanMd } = require(PARSER);
  const mdWithUrgency = `# k

## Sprint 1

### 任务

| # | 任务 | Owner | Deadline | 状态 | 紧急度 | 备注 |
|---|------|-------|----------|------|--------|------|
| T-01 | 紧急任务 | wangzk | 6/15 | ⬜ | 高 | 快到期 |
`;
  const { tasks } = parseKanbanMd(mdWithUrgency, { extractUrgency: true });
  const t01 = findTask(tasks, 'T-01');
  assert.ok(t01, 'T-01 should be parsed');
  assert.equal(t01.urgency, '高', `urgency extracted, got: ${t01.urgency}`);
}

function testUrgencyColumnAbsent() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD); // no urgency column
  const s007 = findTask(tasks, 'S0-07');
  assert.ok(s007, 'S0-07 should be parsed');
  assert.equal(s007.urgency, '', `urgency should be empty when column absent, got: ${s007.urgency}`);
}

// Sprint title normalization: "Sprint 0 · 规格锁定" → "Sprint 0"
function testSprintTitleNormalization() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD);
  // All tasks under "## Sprint 0 · 规格锁定" should have sprint = "Sprint 0"
  for (const t of tasks) {
    assert.equal(t.sprint, 'Sprint 0', `all tasks should have sprint 'Sprint 0', got: ${t.sprint} for ${t.id}`);
  }
}

// Stats aggregation: sprint_stats / owner_stats / chain_stats
function testStatsAggregation() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks, stats } = parseKanbanMd(KANBAN_MD);
  assert.ok(stats, 'stats should exist');
  assert.ok(stats.sprint_stats, 'sprint_stats should exist');
  assert.ok(stats.owner_stats, 'owner_stats should exist');
  assert.ok(stats.chain_stats, 'chain_stats should exist');

  // Sprint 0: 4 tasks total (S0-07, S0-08, H-02, H-06)
  const s0 = stats.sprint_stats['Sprint 0'];
  assert.ok(s0, 'Sprint 0 stats should exist');
  assert.equal(s0.total, 4, `Sprint 0 total should be 4, got: ${s0.total}`);
  assert.equal(s0.done, 0, `Sprint 0 done should be 0, got: ${s0.done}`);

  // owner: wangzk owns S0-07, H-02, H-06 = 3 tasks
  const wangzk = stats.owner_stats['wangzk'];
  assert.ok(wangzk, 'wangzk stats should exist');
  assert.equal(wangzk.total, 3, `wangzk total should be 3, got: ${wangzk.total}`);
  // 张三 owns S0-08 = 1 task
  const zs = stats.owner_stats['张三'];
  assert.ok(zs, '张三 stats should exist');
  assert.equal(zs.total, 1, `张三 total should be 1, got: ${zs.total}`);

  // main_chain stats: 规格锁定 has 2 tasks (S0-07, S0-08), 驾驭工程 has 2 (H-02, H-06)
  const chain1 = stats.chain_stats['规格锁定'];
  assert.ok(chain1, '规格锁定 chain stats should exist');
  assert.equal(chain1.total, 2, `规格锁定 total should be 2, got: ${chain1.total}`);
  const chain2 = stats.chain_stats['驾驭工程'];
  assert.ok(chain2, '驾驭工程 chain stats should exist');
  assert.equal(chain2.total, 2, `驾驭工程 total should be 2, got: ${chain2.total}`);
}

// Task ID variants: PA-01, S0-01, D-29, D-12a all recognized.
function testTaskIdVariants() {
  const { parseKanbanMd } = require(PARSER);
  const md = `# k

## Sprint 1

### 任务

| # | 任务 | Owner | Deadline | 状态 | 备注 |
|---|------|-------|----------|------|------|
| PA-01 | a | wangzk | 6/1 | ⬜ | x |
| S0-01 | b | wangzk | 6/2 | ⬜ | x |
| D-29 | c | wangzk | 6/3 | ⬜ | x |
| D-12a | d | wangzk | 6/4 | ⬜ | x |
`;
  const { tasks } = parseKanbanMd(md);
  const ids = tasks.map((t) => t.id).sort();
  assert.deepEqual(ids, ['D-12a', 'D-29', 'PA-01', 'S0-01'], `all id variants should be parsed, got: ${JSON.stringify(ids)}`);
}

// is_risk flag: tasks under non-Sprint sections (no currentSprint) are flagged.
// After risk-registry skip, normal Sprint tasks should have is_risk=false or undefined.
function testIsRiskFlagOnNormalTasks() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD);
  for (const t of tasks) {
    assert.ok(!t.is_risk, `Sprint tasks should not be flagged is_risk, got: ${t.is_risk} for ${t.id}`);
  }
}

// notes field should be extracted from the 备注 column (not heuristically the longest cell).
function testNotesFromNotesColumn() {
  const { parseKanbanMd } = require(PARSER);
  const { tasks } = parseKanbanMd(KANBAN_MD);
  const h02 = findTask(tasks, 'H-02');
  assert.ok(h02, 'H-02 should be parsed');
  assert.equal(h02.notes, '商用红线 5/8 上线 🔴 阻塞', `notes from 备注 column, got: ${h02.notes}`);
}

// ===== Runner =====
const tests = [
  testBasicFieldExtraction,
  testMultiOwnerSplit,
  testNotesDateNotMistakenAsDeadline,
  testNotesEmojiNotMistakenAsStatus,
  testRiskRegistrySkipped,
  testUrgencyColumnPresent,
  testUrgencyColumnAbsent,
  testSprintTitleNormalization,
  testStatsAggregation,
  testTaskIdVariants,
  testIsRiskFlagOnNormalTasks,
  testNotesFromNotesColumn,
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
