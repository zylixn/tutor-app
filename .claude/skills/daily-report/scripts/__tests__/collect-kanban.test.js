'use strict';

// Tests for collect-kanban.js JSON-first data source logic.
//
// collect-kanban.js used to always parse remote kanban markdown. The new
// behavior (C-9 / 方案B step 1) is JSON-first: when a kanban mirror JSON
// exists at reports/{YYYY}/{KANBAN_DIR}/json/{name}.json and validates
// against kanban-source.schema.json, use it directly as the data source;
// otherwise fall back to markdown parsing.
//
// To make the script testable without hitting the network, collectKanban()
// is exported and accepts a deps object with injectable HTTP fetchers.

const assert = require('node:assert/strict');
const path = require('node:path');

const collectModule = require(path.resolve(__dirname, '..', 'collect-kanban.js'));
const { collectKanban } = collectModule;

// --- Fixtures ---

// A valid kanban-source.schema.json-shaped mirror.
function validKanbanMirror() {
  return {
    source_file: '630_kanban-LOCKED.md',
    updated_at: '2026-06-12',
    updated_by: 'AI',
    updated_by_user: 'wangzk',
    change_summary: 'S0-07✅',
    tasks: [
      {
        id: 'S0-07', task: 'TDD 看板改造', owner: 'wangzk', owners: ['wangzk'],
        deadline: '6/15', status: '🔵 进行中', sprint: 'Sprint 0',
        main_chain: '看板链', notes: '开发中', urgency: '高',
      },
      {
        id: 'S0-08', task: '日报渲染', owner: 'lisi+wangzk', owners: ['lisi', 'wangzk'],
        deadline: '6/20', status: '⬜ 未开始', sprint: 'Sprint 0',
        main_chain: '看板链', notes: '', urgency: '中',
      },
    ],
  };
}

// A minimal kanban markdown body that parseKanbanMd can consume.
const KANBAN_MD = `# 看板

## Sprint 0

| # | 任务 | Owner | Deadline | 状态 | 备注 | 紧急度 |
|---|------|-------|----------|------|------|--------|
| S0-07 | TDD 看板改造 | wangzk | 6/15 | 🔵 进行中 | 开发中 | 高 |
| S0-08 | 日报渲染 | lisi+wangzk | 6/20 | ⬜ 未开始 |  | 中 |

*最后更新：2026-06-12
`;

// --- Deps factories ---

// Build a deps object that simulates a remote tree where:
//   - the kanban md exists (sorted-max name wins)
//   - the JSON mirror exists iff jsonPayload != null and returns HTTP 200
//   - the md body is KANBAN_MD
function makeDeps({ jsonPayload, jsonStatus = 200 }) {
  const treeEntries = [
    { type: 'blob', name: '630_kanban-LOCKED.md' },
  ];

  const httpGetJson = async (url) => {
    // tree listing
    if (url.includes('/repository/tree?')) {
      return treeEntries;
    }
    // json file fetch via /repository/files/.../raw — but JSON is text, use getRaw path.
    throw new Error(`unexpected getJson url: ${url}`);
  };

  const httpGetRaw = async (url) => {
    // JSON mirror file: path encodes reports/{YYYY}/{KANBAN_DIR}/json/{name}.json
    // The encoded URL contains ".json" (the filename) — match on that.
    const isJsonRequest = /\.json/i.test(url);
    if (isJsonRequest) {
      if (jsonStatus >= 400 || jsonPayload == null) {
        throw new Error(`HTTP ${jsonStatus} from ${url}`);
      }
      return typeof jsonPayload === 'string' ? jsonPayload : JSON.stringify(jsonPayload);
    }
    // Kanban md raw fetch
    if (url.includes('/raw?') || url.includes('/raw%3F') || /\.md/i.test(url)) {
      return KANBAN_MD;
    }
    throw new Error(`unexpected getRaw url: ${url}`);
  };

  return { httpGetJson, httpGetRaw };
}

// Empty team (no user resolution needed for the data-source logic).
const FAKE_TEAM = { members: [] };
function fakeFetchTeam() { return FAKE_TEAM; }
const FAKE_CONFIG = {
  gitlabUrl: 'http://example.test',
  projectId: 'proj',
  branch: 'dev',
  kanbanDir: 'knowledge',
};

// --- Tests ---

// RED intent: when a valid JSON mirror exists, collect-kanban should use it
// and tag data_source === 'json'.
async function testJsonFirstWhenMirrorExists() {
  const deps = makeDeps({ jsonPayload: validKanbanMirror() });
  const out = await collectKanban({
    deps, team: FAKE_TEAM, config: FAKE_CONFIG,
    year: 2026, user: '', fetchTeam: fakeFetchTeam,
  });
  assert.equal(out.data_source, 'json', `expected json, got: ${out.data_source}`);
  assert.equal(out.source_file, '630_kanban-LOCKED.md');
  // tasks came from the JSON mirror (2 tasks), not from md parsing
  assert.equal(out.tasks.length, 2, `expected 2 tasks, got ${out.tasks.length}`);
  assert.equal(out.tasks[0].id, 'S0-07');
  // stats recomputed from the JSON task array
  assert.equal(out.stats.total, 2);
  assert.equal(out.stats.in_progress, 1);
  assert.equal(out.stats.not_started, 1);
}

// RED intent: when JSON is absent (404), fall back to md and tag data_source === 'markdown'.
async function testFallbackToMarkdownWhenJsonMissing() {
  const deps = makeDeps({ jsonPayload: null, jsonStatus: 404 });
  const out = await collectKanban({
    deps, team: FAKE_TEAM, config: FAKE_CONFIG,
    year: 2026, user: '', fetchTeam: fakeFetchTeam,
  });
  assert.equal(out.data_source, 'markdown', `expected markdown, got: ${out.data_source}`);
  assert.equal(out.tasks.length, 2);
  assert.equal(out.stats.total, 2);
}

// RED intent: JSON exists but fails kanban-source.schema.json validation → fall back to md.
async function testFallbackToMarkdownWhenJsonInvalid() {
  const broken = { source_file: '630_kanban-LOCKED.md' }; // missing required `tasks`
  const deps = makeDeps({ jsonPayload: broken });
  const out = await collectKanban({
    deps, team: FAKE_TEAM, config: FAKE_CONFIG,
    year: 2026, user: '', fetchTeam: fakeFetchTeam,
  });
  assert.equal(out.data_source, 'markdown', `expected markdown fallback on invalid JSON, got: ${out.data_source}`);
  assert.equal(out.tasks.length, 2);
}

// RED intent: --source md forces markdown path even when JSON exists.
async function testSourceMdForcesMarkdown() {
  const deps = makeDeps({ jsonPayload: validKanbanMirror() });
  const out = await collectKanban({
    deps, team: FAKE_TEAM, config: FAKE_CONFIG,
    year: 2026, user: '', fetchTeam: fakeFetchTeam,
    source: 'md',
  });
  assert.equal(out.data_source, 'markdown', `expected markdown when --source md, got: ${out.data_source}`);
  assert.equal(out.tasks.length, 2);
}

// RED intent: --source json forces JSON path; when JSON is missing, it errors
// (explicit user request should not silently fall back).
async function testSourceJsonErrorsWhenMissing() {
  const deps = makeDeps({ jsonPayload: null, jsonStatus: 404 });
  // --source json with missing JSON must reject, not silently fall back.
  await assert.rejects(
    () => collectKanban({
      deps, team: FAKE_TEAM, config: FAKE_CONFIG,
      year: 2026, user: '', fetchTeam: fakeFetchTeam,
      source: 'json',
    }),
    /json/i,
    '--source json with missing JSON should throw, not silently fall back'
  );
}

// RED intent: user filter still applies on the JSON path.
async function testUserFilterAppliesToJsonSource() {
  const deps = makeDeps({ jsonPayload: validKanbanMirror() });
  const team = {
    members: [
      { git_username: 'wangzk', group: 'Dev' },
    ],
  };
  const out = await collectKanban({
    deps, team, config: FAKE_CONFIG,
    year: 2026, user: 'wangzk',
    fetchTeam: async () => team,
  });
  assert.equal(out.data_source, 'json');
  // wangzk owns both S0-07 and S0-08 (lisi+wangzk)
  assert.equal(out.tasks.length, 2, `wangzk should own both tasks, got ${out.tasks.length}`);
}

const tests = [
  testJsonFirstWhenMirrorExists,
  testFallbackToMarkdownWhenJsonMissing,
  testFallbackToMarkdownWhenJsonInvalid,
  testSourceMdForcesMarkdown,
  testSourceJsonErrorsWhenMissing,
  testUserFilterAppliesToJsonSource,
];

// collectKanban returns a Promise (real http is async); run tests serially with await.
(async () => {
  let passed = 0;
  let failed = 0;
  for (const t of tests) {
    try {
      await t();
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
})();
