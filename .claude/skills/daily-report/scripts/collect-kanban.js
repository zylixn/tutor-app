'use strict';

// collect-kanban.js — fetch the personal/team kanban for daily-report rendering.
//
// 数据流原则（方案 B）：本脚本是看板数据的只读消费者，不是变更执行点。
// 看板变更的唯一执行点是 kanban-update.js。本脚本只负责把"当前最新状态"
// 拉到本地供 render-report.js 渲染。
//
// 数据来源（C-9 起，JSON 优先 / auto 模式）：
//   1. 先尝试拉远程 reports/{YYYY}/{KANBAN_DIR}/json/{name}.json
//      （与 md 同名，仅扩展名不同；由 kanban-update.js --json-output 生成）
//   2. 若 JSON 存在且通过 kanban-source.schema.json 校验 → 直接用作数据源
//   3. 否则回退到拉 md → parseKanbanMd 解析（向后兼容）
//   4. --source json|md 可强制指定来源；默认 auto（JSON 优先）
//
// 输出始终是 KanbanSection 形态：{ source_file, last_updated, user, tasks, stats,
// deadline_calendar, data_source }。data_source 标记实际数据来源 ('json' | 'markdown')。
//
// 可测试性：collectKanban() 接受 deps 注入 HTTP 获取函数，main() 用真实 http 库调用它。

const { parseArgs } = require('./lib/argv');
const { getJson, getRaw } = require('./lib/http');
const { fetchTeam, findByUsername } = require('./lib/person');
const { loadConfig, resolveToken: resolveTokenDefault } = require('./lib/config');
const { parseKanbanMd } = require('./lib/parse-kanban-md');
const { validateKanbanSource } = require('./lib/schema-validator');
const { buildPersonalView } = require('./lib/kanban-view');

function resolveToken(args) {
  if (args.options['gitlab-token']) return args.options['gitlab-token'];
  return resolveTokenDefault();
}

// Derive the JSON mirror filename from a kanban md filename.
//   '630_kanban-LOCKED.md' → '630_kanban-LOCKED.json'
function jsonNameFromMdName(mdName) {
  return mdName.replace(/\.md$/i, '.json');
}

// Core collector. Pure & injectable — no network unless deps.httpGet* are the real ones.
//
// opts:
//   deps     — { httpGetJson, httpGetRaw }  (required)
//   team     — team.json object (required, may be { members: [] })
//   config   — { gitlabUrl, projectId, branch, kanbanDir } (required)
//   year     — number (required)
//   user     — git_username filter, '' for whole team (required, may be '')
//   source   — 'auto' | 'json' | 'md'  (default 'auto')
//   fetchTeam— async () => team (unused when team is passed; kept for main())
function collectKanban({ deps, team, config, year, user, source = 'auto' }) {
  const { gitlabUrl, projectId, branch, kanbanDir } = config;

  // 1. list kanban directory to discover the latest md file
  const dir = encodeURIComponent(`reports/${year}/${kanbanDir}/`);
  const treeUrl = `${gitlabUrl}/api/v4/projects/${projectId}/repository/tree?path=${dir}&ref=${branch}`;

  // tree lookup is sync from the caller's perspective only when deps are sync;
  // keep this function returning a Promise so real http (async) works.
  return Promise.resolve()
    .then(() => deps.httpGetJson(treeUrl))
    .then((entries) => {
      const files = (entries || [])
        .filter((f) => f.type === 'blob' && /_kanban.*\.md$/.test(f.name))
        .sort((a, b) => b.name.localeCompare(a.name));
      return files;
    })
    .then((kanbanFiles) => {
      // Empty-kanban short-circuit (mirrors legacy behavior)
      if (!kanbanFiles || kanbanFiles.length === 0) {
        return emptyKanbanOutput(team, user);
      }

      const kanbanFilename = kanbanFiles[0].name;
      const jsonFilename = jsonNameFromMdName(kanbanFilename);
      const jsonPath = encodeURIComponent(`reports/${year}/${kanbanDir}/json/${jsonFilename}`);
      const jsonRawUrl = `${gitlabUrl}/api/v4/projects/${projectId}/repository/files/${jsonPath}/raw?ref=${branch}`;

      const targetUsername = user;
      const targetUser = targetUsername ? findByUsername(team, targetUsername) : null;
      const userMeta = targetUser
        ? { git_username: targetUser.git_username, group: targetUser.group }
        : null;

      // Decide data source
      const wantJson = source === 'json' || source === 'auto';
      const wantMd = source === 'md' || source === 'auto';

      // Try JSON first when allowed
      if (wantJson) {
        return Promise.resolve()
          .then(() => deps.httpGetRaw(jsonRawUrl))
          .then((jsonBody) => {
            let parsed;
            try {
              parsed = JSON.parse(jsonBody);
            } catch (e) {
              if (source === 'json') {
                throw new Error(`kanban JSON parse failed (${jsonFilename}): ${e.message}`);
              }
              // auto: malformed JSON → fall back to md
              return null;
            }
            const verdict = validateKanbanSource(parsed);
            if (!verdict.valid) {
              if (source === 'json') {
                throw new Error(`kanban JSON schema invalid (${jsonFilename}): ${verdict.errors.join('; ')}`);
              }
              // auto: invalid JSON → fall back to md
              return null;
            }
            // JSON is good — use it as the data source
            return buildOutputFromJson(parsed, targetUsername, userMeta, year);
          })
          .catch((err) => {
            // JSON fetch failed
            if (source === 'json') {
              // Explicit json request must not silently fall back
              throw new Error(`--source json requested but kanban JSON unavailable: ${err.message}`);
            }
            // auto: JSON not reachable → fall back to md
            return null;
          })
          .then((jsonResult) => {
            if (jsonResult) return jsonResult;
            if (!wantMd) {
              // shouldn't happen in auto (wantMd true), but guard anyway
              throw new Error('no kanban data source available');
            }
            return fetchMarkdownAndBuild({
              deps, gitlabUrl, projectId, branch, kanbanDir, year,
              kanbanFilename, targetUsername, userMeta,
            });
          });
      }

      // --source md: straight to markdown
      return fetchMarkdownAndBuild({
        deps, gitlabUrl, projectId, branch, kanbanDir, year,
        kanbanFilename, targetUsername, userMeta,
      });
    });
}

function emptyKanbanOutput(team, user) {
  const targetUser = user ? findByUsername(team, user) : null;
  return {
    source_file: '',
    last_updated: '',
    user: targetUser ? { git_username: targetUser.git_username, group: targetUser.group } : null,
    tasks: [],
    stats: { total: 0, done: 0, in_progress: 0, at_risk: 0, blocked: 0, not_started: 0 },
    deadline_calendar: { overdue: [], today: [], tomorrow: [], day_after: [], unscheduled: [] },
    kanban_available: false,
    message: `当年无正式看板文件`,
    data_source: 'markdown',
  };
}

// Build the KanbanSection output from a validated kanban-source JSON mirror.
function buildOutputFromJson(mirror, targetUsername, userMeta, year) {
  const view = buildPersonalView({
    mirror,
    username: targetUsername,
    userMeta,
    year,
  });
  return { ...view, data_source: 'json' };
}

function fetchMarkdownAndBuild({
  deps, gitlabUrl, projectId, branch, kanbanDir, year,
  kanbanFilename, targetUsername, userMeta,
}) {
  const kanbanPath = encodeURIComponent(`reports/${year}/${kanbanDir}/${kanbanFilename}`);
  const rawUrl = `${gitlabUrl}/api/v4/projects/${projectId}/repository/files/${kanbanPath}/raw?ref=${branch}`;

  return Promise.resolve()
    .then(() => deps.httpGetRaw(rawUrl))
    .then((kanbanMd) => {
      const updatedMatch = kanbanMd.match(/\*最后更新[：:]\s*(\d{4}-\d{2}-\d{2})/);
      const lastUpdated = updatedMatch ? updatedMatch[1] : '';

      const parsed = parseKanbanMd(kanbanMd);
      const view = buildPersonalView({
        mirror: {
          source_file: kanbanFilename,
          updated_at: lastUpdated,
          tasks: parsed.tasks,
        },
        username: targetUsername,
        userMeta,
        year,
      });
      return { ...view, data_source: 'markdown' };
    });
}

async function main() {
  const args = parseArgs(process.argv, {
    options: {
      'gitlab-token': '',
      user: '',
      year: String(new Date().getFullYear()),
      source: 'auto',
    },
  });

  const token = resolveToken(args);
  if (!token) {
    const output = { error: 'GITLAB_TOKEN not set', success: false };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    process.exit(1);
  }

  const year = parseInt(args.options.year, 10);
  const team = await fetchTeam();
  const config = loadConfig();

  const source = args.options.source || 'auto';
  if (!['auto', 'json', 'md'].includes(source)) {
    process.stderr.write(`[collect-kanban] invalid --source: ${source} (expected auto|json|md)\n`);
    process.exit(1);
  }

  const deps = {
    httpGetJson: (url) => getJson(url, token),
    httpGetRaw: (url) => getRaw(url, token),
  };

  // fallback dir search mirrors legacy behavior: if primary dir 404s, try alternatives.
  // Kept inside main() because it touches the network via deps.
  const tryConfig = (cfg) => collectKanban({
    deps, team, config: cfg, year, user: args.options.user, source,
  }).then((out) => ({ out, cfg }));

  const primaryConfig = config;
  const fallbackDirs = ['knowledge', 'knownlage'].filter((d) => d !== primaryConfig.kanbanDir);

  let result = null;
  try {
    const r = await tryConfig(primaryConfig);
    if (r.out.kanban_available !== false) {
      result = r.out;
    }
  } catch {
    // primary dir failed, try fallbacks below
  }

  if (!result) {
    for (const fb of fallbackDirs) {
      try {
        const r = await tryConfig({ ...primaryConfig, kanbanDir: fb });
        if (r.out.kanban_available !== false) {
          result = r.out;
          break;
        }
      } catch {
        // try next fallback
      }
    }
  }

  if (!result) {
    result = emptyKanbanOutput(team, args.options.user);
    result.message = `当年（${year}）无正式看板文件`;
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { collectKanban, jsonNameFromMdName };

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`[collect-kanban] error: ${e.message}\n`);
    process.exit(1);
  });
}
