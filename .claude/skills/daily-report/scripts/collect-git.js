'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { parseArgs } = require('./lib/argv');
const { fetchTeam } = require('./lib/person');

// --- commit message 正则 (复用 commitlint-ai-plugin.js 的 OPERATOR_TYPES) ---
const OPERATOR_RE = /\[(AI·(?:Developer|Architect|Tester|Reviewer|Debate|Doc|UX|Cond)|AI-[a-zA-Z0-9_-]+\.(?:Developer|Architect|Tester|Reviewer|Debate|Doc|UX|Cond)|H-[a-zA-Z0-9_-]+)\]$/;
const SUBJECT_RE = /^\[.*?\]\s+(DEV|BUG|CM|TEST|DOCS|REFACTOR)\s+(.+?)\[/;

// --- 标签分类关键词 (对应 reference.md 标签对照表) ---
const TAG_RULES = [
  { tag: '框架升级', keywords: ['版本', '升级', 'upgrade', 'version', '框架升级'] },
  { tag: '安全加固', keywords: ['安全', '加固', 'GATE_BYPASS', 'NONCE', '权限拦截', '审批门禁'] },
  { tag: '质量工具', keywords: ['TDD', 'hook', '覆盖率', '检查', '回归', 'reviewer', '测试技能'] },
  { tag: 'Skill 方法论', keywords: ['skill', 'CSO', 'R1-R4', 'writing-skills', '方法论'] },
  { tag: 'Agent 行为', keywords: ['Agent', '角色行为', 'Iron Law', 'Developer行为', 'Tester行为'] },
  { tag: 'Bug 修复', keywords: ['BUG', 'fix', '兼容', '修复'] },
  { tag: '规范', keywords: ['规范', 'commit格式', '命名规范', 'lint'] },
  { tag: '功能开发', keywords: ['DEV', '新增', 'feature', '实现'] },
  { tag: '重构', keywords: ['refactor', '重构', '拆分', '优化', '精简', '解耦', '迁移'] },
  { tag: '验证', keywords: ['验证', '对抗', '端到端'] },
];

const FRAMEWORK_REPOS = new Set(['rd_harness']);

function getExcludedPaths() {
  const repo = path.basename(process.cwd());
  if (FRAMEWORK_REPOS.has(repo)) return [];
  return [':(exclude).claude/**', ':(exclude).harness/**'];
}

function classifyTag(subject, body) {
  const text = (subject + ' ' + (body || '')).toLowerCase();
  for (const rule of TAG_RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw.toLowerCase())) return rule.tag;
    }
  }
  return '其他';
}

function classifyOperator(subject) {
  const m = subject.match(OPERATOR_RE);
  if (!m) return { type: 'human', detail: '' };
  const op = m[1];
  if (op.startsWith('AI·')) return { type: 'ai_independent', detail: op };
  if (op.startsWith('AI-')) return { type: 'ai_collaborative', detail: op };
  if (op.startsWith('H-')) return { type: 'human', detail: op };
  return { type: 'human', detail: '' };
}

function shortHash(h) { return h.slice(0, 8); }

function todayCST() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

// Force UTF-8 output from git regardless of host locale / code page.
// Locale env vars alone are insufficient on Windows: when the active code page
// is GBK (chcp 936), git still emits commit subjects and paths in GBK and Node
// decodes them as UTF-8, producing garbled text in the daily report. These -c
// flags override git's encoding decisions directly.
const GIT_UTF8_FLAGS = [
  '-c', 'core.quotepath=false',
  '-c', 'i18n.logOutputEncoding=utf-8',
  '-c', 'i18n.commitEncoding=utf-8',
];

// execFileSync with array args avoids shell quoting pitfalls entirely.
// The previous execSync(string) form relied on bash-style single-quote escaping
// which fails on Windows cmd.exe / PowerShell (single quotes are literal there,
// so git would receive 'show' instead of show). Passing args as an array lets
// Node hand them to git verbatim with no shell in the loop.
function runGit(args) {
  try {
    const env = Object.assign({}, process.env, {
      LC_ALL: process.env.LC_ALL || 'C.UTF-8',
      LANG: process.env.LANG || 'C.UTF-8',
    });
    return execFileSync('git', [...GIT_UTF8_FLAGS, ...args], {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e) {
    return '';
  }
}

function commitTouchesIncludedPaths(hash) {
  return Boolean(runGit(['show', '--name-only', '--format=', hash, '--', '.', ...getExcludedPaths()]).trim());
}

// Resolve filterUser against team.json. Returns { aliases, canonical }:
//   - aliases: Set of strings that should count as this user's commit
//     (git_username / name / abbr unioned). Used for author/committer matching.
//   - canonical: the team.json git_username to use as the report's authoritative
//     git_username, so the same person doesn't show up under different strings
//     ("wangzk" vs "WZK" vs "王某某") when downstream aggregators group by it.
//     null when team.json can't be loaded or filterUser isn't a known member —
//     caller should fall back to the local git config user.name in that case.
function buildUserAliases(team, filterUser) {
  const aliases = new Set();
  if (!filterUser) return { aliases, canonical: null };
  aliases.add(filterUser);

  if (!team || !Array.isArray(team.members) || team.members.length === 0) {
    return { aliases, canonical: null };
  }

  const matches = team.members.filter((m) =>
    m && (m.git_username === filterUser || m.name === filterUser || m.abbr === filterUser)
  );

  let canonical = null;
  for (const m of matches) {
    if (m.git_username) {
      aliases.add(m.git_username);
      // First match wins; in well-maintained team.json each filterUser maps to
      // exactly one member, so this branch is unambiguous in practice.
      if (!canonical) canonical = m.git_username;
    }
    if (m.name) aliases.add(m.name);
    if (m.abbr) aliases.add(m.abbr);
  }

  return { aliases, canonical };
}

function commitNumstat(hash) {
  const out = runGit(['show', '--numstat', '--format=', hash, '--', '.', ...getExcludedPaths()]);
  const stat = { files_changed: 0, insertions: 0, deletions: 0 };
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const [insertions, deletions, filePath] = line.split('\t');
    if (!filePath) continue;
    stat.files_changed += 1;
    if (/^\d+$/.test(insertions)) stat.insertions += parseInt(insertions, 10);
    if (/^\d+$/.test(deletions)) stat.deletions += parseInt(deletions, 10);
  }
  return stat;
}

async function main() {
  const args = parseArgs(process.argv, {
    options: { date: todayCST(), user: '' },
  });

  const date = args.options.date;
  const gitUsername = runGit(['config', 'user.name']).trim();
  const filterUser = args.options.user || gitUsername;
  if (!gitUsername) {
    process.stderr.write('[collect-git] cannot determine git user.name\n');
    process.exit(1);
  }

  // team.json is the authoritative source for who "filterUser" really is.
  // Fetch it best-effort; on failure we degrade to strict filterUser matching.
  const team = await fetchTeam().catch((e) => {
    process.stderr.write(`[collect-git] WARNING: team.json unavailable, falling back to strict match: ${e.message}\n`);
    return null;
  });
  const { aliases: userAliases, canonical } = buildUserAliases(team, filterUser);
  // Canonicalize the report's git_username to team.json's git_username so
  // downstream aggregation keys are stable regardless of local git config.
  // Fall back to filterUser (which is --user value, or local git config when
  // --user wasn't passed) so an explicit non-member --user isn't silently
  // rewritten to the local git user.name.
  const reportUser = canonical || filterUser;

  // next day for --until
  const [y, m, d] = date.split('-').map(Number);
  const nextDay = new Date(Date.UTC(y, m - 1, d) + 86400000);
  const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;

  // git log with NUL/SOH delimiters; include committer name (%cn) so merge
  // commits created by GitLab (where author is the human but committer is the
  // integration account, or vice versa) can still be attributed correctly.
  const log = runGit([
    'log',
    '--format=%H%x00%ai%x00%an%x00%cn%x00%s%x00%b%x01',
    `--since=${date} 00:00:00`,
    `--until=${nextDayStr} 00:00:00`,
    '--all',
  ]);

  const commits = [];
  if (log) {
    const records = log.split('\x01').filter((r) => r.trim());
    for (const rec of records) {
      const parts = rec.split('\x00');
      if (parts.length < 5) continue;
      const [rawHash, datetime, author, committer, subject, ...bodyParts] = parts;
      const fullHash = rawHash.replace(/^[\n\r]+/, '');
      const body = bodyParts.join('\x00')
        .replace(/[\x00]+$/g, '')
        .replace(/\r\n/g, '\n')
        .trim();

      if (filterUser && !userAliases.has(author) && !userAliases.has(committer)) continue;
      if (!commitTouchesIncludedPaths(fullHash)) continue;

      const op = classifyOperator(subject);
      const tag = classifyTag(subject, body);
      const sm = subject.match(SUBJECT_RE);
      const stage = sm ? sm[1] : '';
      const mod = sm ? sm[2].trim() : subject.replace(/\[.*?\]/g, '').trim();

      commits.push({
        hash: shortHash(fullHash),
        full_hash: fullHash,
        datetime,
        author,
        subject,
        body,
        operator_type: op.type,
        operator_detail: op.detail,
        tag,
        stage,
        module: mod,
      });
    }
  }

  // classification summary
  const classification = { ai_independent: { count: 0, hashes: [] }, ai_collaborative: { count: 0, hashes: [] }, human: { count: 0, hashes: [] } };
  for (const c of commits) {
    classification[c.operator_type].count++;
    classification[c.operator_type].hashes.push(c.hash);
  }

  // tag grouping
  const tags = {};
  for (const c of commits) {
    if (!tags[c.tag]) tags[c.tag] = [];
    tags[c.tag].push({ hash: c.hash, title: c.subject.replace(/\[.*?\]\s*/g, '').replace(/\[.*?\]$/, '').trim() });
  }

  // stats exclude framework runtime/scaffold directories, consistent with commit list
  let stats = { commits: commits.length, files_changed: 0, insertions: 0, deletions: 0 };
  for (const c of commits) {
    const s = commitNumstat(c.full_hash);
    stats.files_changed += s.files_changed;
    stats.insertions += s.insertions;
    stats.deletions += s.deletions;
  }

  // repo name
  const repo = path.basename(process.cwd());

  const output = { date, git_username: reportUser, repo, stats, commits, classification, tags };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

main();
