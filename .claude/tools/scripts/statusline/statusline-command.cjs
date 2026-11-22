'use strict';

// Claude Code status line — ported from statusline-command.sh.
// Layout: path | vX.Y.Z | branch[dirty] sync-state | model | token:in/out/Σ cache:% | n/K(%) | HhMmin
//   sync-state: ✓sync | ↑N unpushed | ↓N unpulled | ↑N↓N diverged
//
// Reads JSON from stdin (Claude Code's statusline payload) and writes a single
// ANSI-colored line to stdout. Designed to be both a CLI entrypoint (run via
// `node statusline-command.js`) and a require-able module (pure helpers are
// exported for unit testing).
//
// All filesystem/git/usage state is best-effort: any failure degrades silently
// to omitting that segment, never crashes the line. The line is the user's
// primary visibility into model/context/cost — uptime matters more than
// perfection.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// --- ANSI ---
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

// --- Pure helpers (exported for testing) ---

// Format a non-negative token count as human-readable: "999", "1.5K", "1.5M".
// Returns "0" for missing/invalid input so the line never shows "undefined".
function formatTokens(v) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0) return '0';
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  return String(Math.floor(v));
}

// Cache hit rate as an integer percent, or null when there are no input-side
// tokens to cache (avoids divide-by-zero and meaningless 0%).
//
// Hit rate = cache_read / (cache_read + input).
// input_tokens 已经是"未命中"的部分（Anthropic API 把 input/cached_input/cache_creation_input 三者分开计），分母用 cache_creation 是错的：cache_creation 是"本次写入缓存"，几乎永远是 0，会导致恒等于 100%。
function calcCacheRate(stats) {
  const cr = (stats && Number(stats.cache_read)) || 0;
  const input = (stats && Number(stats.input)) || 0;
  const total = cr + input;
  if (total <= 0) return null;
  return Math.round((cr * 100) / total);
}

// Aggregate usage.jsonl lines into {input, output, cache_read, cache_creation}.
// `lines` is an array of raw JSONL strings (last `limit` are used, mirroring
// the shell's `tail -200`). Malformed lines are skipped — usage.jsonl is
// append-only and may have a partial trailing line mid-write.
function parseUsage(lines, limit = 200) {
  const agg = { input: 0, output: 0, cache_read: 0, cache_creation: 0 };
  if (!Array.isArray(lines) || lines.length === 0) return agg;
  const start = lines.length > limit ? lines.length - limit : 0;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (_) {
      continue;
    }
    const t = (rec && rec.tokens) || {};
    agg.input += Number(t.input) || 0;
    agg.output += Number(t.output) || 0;
    agg.cache_read += Number(t.cache_read) || 0;
    agg.cache_creation += Number(t.cache_creation) || 0;
  }
  return agg;
}

// Model → context window size 映射。
// Claude Code payload 里 context_window_size 不分模型统一写 200000（包括 1M 窗口的
// glm-5.2 / claude-sonnet-4-x / gemini-2.5 等），导致 used_percentage 和 size 都失真。
// 这里覆盖主流模型；查表失败回退到 payload 的值。
//
// 匹配优先级：精确 → 前缀（按 key 长度降序匹配最长前缀，比如 'claude-sonnet-4-' 优先于 'claude-'）。
// 数据来源：各厂商 2026/06 官方文档（Claude 4.6 release notes、Gemini API docs、
// Qwen blog、Moonshot GitHub、DeepSeek API docs、智谱开放平台）。
const MODEL_CONTEXT_WINDOWS = {
  // ─── Anthropic Claude ───
  // 4.5+ 系列原生支持 1M context window
  'claude-opus-4-7':   1_000_000,
  'claude-opus-4-6':   200_000,
  'claude-sonnet-4-':  1_000_000,   // 前缀：4-5/4-6/4-7
  'claude-haiku-4-':   200_000,
  'claude-3-5-':       200_000,     // 前缀：3-5-sonnet/haiku
  'claude-3-opus':     200_000,
  'claude-3-haiku':    200_000,
  'claude-3-sonnet':   200_000,

  // ─── 智谱 GLM ───
  'glm-5.2':           1_000_000,
  'glm-5.1':           204_800,
  'glm-5':             202_752,
  'glm-4.6':           128_000,
  'glm-4.5':           128_000,
  'glm-4-':            128_000,     // 前缀：glm-4-plus/air/flash 等

  // ─── Google Gemini ───
  'gemini-3-':         1_000_000,   // 前缀：gemini 3.x
  'gemini-2.5-pro':    1_000_000,
  'gemini-2.5-flash':  1_000_000,
  'gemini-2.0-':       1_000_000,   // 前缀
  'gemini-1.5-pro':    2_000_000,
  'gemini-1.5-flash':  1_000_000,

  // ─── 阿里 Qwen ───
  'qwen3.7-max':       1_000_000,
  'qwen3-max':         1_000_000,   // 可扩展到 1M
  'qwen3-':            256_000,     // 前缀：qwen3-coder/instruct 等
  'qwen2.5-':          128_000,     // 前缀

  // ─── Moonshot Kimi ───
  'kimi-k2.5':         256_000,
  'kimi-k2.6':         256_000,
  'kimi-k2':           128_000,
  'moonshot-v1-':      128_000,     // 前缀：moonshot-v1-8k/32k/200k（API 限速有差异）

  // ─── DeepSeek ───
  'deepseek-v3':       128_000,
  'deepseek-r1':       128_000,
  'deepseek-chat':     128_000,

  // ─── OpenAI GPT ───
  'gpt-4o':            128_000,
  'gpt-4-turbo':       128_000,
  'gpt-4':             8_192,

  // ─── xAI Grok ───
  'grok-4':            256_000,
  'grok-3':            128_000,
};

// 用 model.id 查真实 context window。找不到返回 0（调用方回退到 payload）。
function lookupContextWindow(modelId) {
  if (!modelId || typeof modelId !== 'string') return 0;
  // 精确匹配
  if (MODEL_CONTEXT_WINDOWS[modelId]) return MODEL_CONTEXT_WINDOWS[modelId];
  // 前缀匹配（最长前缀优先）
  const prefixes = Object.keys(MODEL_CONTEXT_WINDOWS)
    .filter((k) => k.endsWith('-'))
    .sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (modelId.startsWith(p)) return MODEL_CONTEXT_WINDOWS[p];
  }
  return 0;
}

// Context-window segment, color-coded by usage: green <70%, yellow 70-89%, red ≥90%.
// Returns '' when the input lacks both used_percentage and total_input_tokens.
//
// 字段说明：Claude Code statusline payload 的 context_window 包含：
//   - total_input_tokens    当前窗口占用 tokens（本次 API 调用的全部 input，
//                           含 cache_read 命中部分；不是会话累计）
//   - context_window_size   Claude Code 写死 200000，不分模型
//   - used_percentage       基于 context_window_size 计算，因此也跟着失真
// 真实 size 优先查 MODEL_CONTEXT_WINDOWS 映射（按 model.id）；命中后重算 used_percentage
// 和 usedTokens，避免对 glm-5.2（实际 1M）等模型显示成 "ctx:62K/200K(31%)" 的失真。
function buildContextDisplay(ctx, modelId) {
  if (!ctx) return '';
  const payloadSize = Number(ctx.context_window_size) || 0;
  const realSize = lookupContextWindow(modelId) || payloadSize;
  if (realSize <= 0) return '';

  // 优先用 total_input_tokens（当前窗口占用），它独立于 size 不受 payload 错误 size 影响
  const totalInput = Number(ctx.total_input_tokens);
  let usedTokens, pct;
  if (isFinite(totalInput) && totalInput > 0) {
    usedTokens = totalInput;
    pct = Math.round((totalInput / realSize) * 100);
  } else if (ctx.used_percentage != null) {
    // 回退：用 payload 的百分比 × realSize（payload size 错时百分比也错，但比无值强）
    pct = Math.round(Number(ctx.used_percentage));
    usedTokens = Math.round(realSize * pct / 100);
  } else {
    return '';
  }

  // 整数显示不带 ".0"：1.0M → 1M，80.0K → 80K，1.5K → 1.5K
  const trimZero = (s) => s.replace(/\.0([MK])/, '$1');
  const usedD = trimZero(formatTokens(usedTokens));
  const sizeD = trimZero(formatTokens(realSize));
  const color = pct >= 90 ? RED : pct >= 70 ? YELLOW : GREEN;
  return `${color}ctx:${usedD}/${sizeD}(${pct}%)${RESET}`;
}

// Elapsed-wall-clock formatting: "Ss", "Mmin", "HhMmin", "DdHhMmin".
// Returns '' if inputs are missing/inverted so a brand-new session doesn't
// show negative durations.
function buildDuration(startMs, nowMs) {
  if (!startMs || !nowMs || nowMs < startMs) return '';
  const elapsed = Math.floor((nowMs - startMs) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const d = Math.floor(elapsed / 86400);
  const h = Math.floor((elapsed % 86400) / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  if (d > 0) return `${d}d${h}h${m}min`;
  if (h > 0) return `${h}h${m}min`;
  return `${m}min`;
}

// Read the first line of .harness/.harness-version (rd_harness framework version).
// Returns '' when the file is missing or unreadable — this is a best-effort segment.
function buildHarnessVersion(cwd) {
  try {
    const verFile = path.join(cwd, '.harness', '.harness-version');
    const raw = fs.readFileSync(verFile, 'utf-8');
    const firstLine = raw.split(/\r?\n/)[0].trim();
    if (!firstLine) return '';
    return `${CYAN}v${firstLine}${RESET}`;
  } catch (_) {
    return '';
  }
}

// --- Best-effort I/O helpers (not exported — side-effectful) ---

function runGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (_) {
    return '';
  }
}

function buildGitDisplay(cwd) {
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (!branch) return { git: '', sync: '' };

  const status = runGit(['status', '--porcelain'], cwd);
  const dirtyCount = status ? status.split(/\r?\n/).filter(Boolean).length : 0;
  const dirtyMark = dirtyCount > 0 ? `${RED}✗${dirtyCount}${RESET}` : `${GREEN}✓${RESET}`;
  const git = `${BOLD}${branch}${RESET}${dirtyMark}`;

  // ahead/behind upstream
  let sync = '';
  const upstream = runGit(['rev-parse', '--abbrev-ref', '@{upstream}'], cwd);
  if (upstream) {
    const ab = runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], cwd);
    const m = (ab || '').match(/^(\d+)\s+(\d+)$/);
    if (m) {
      const ahead = m[1];
      const behind = m[2];
      const aheadN = ahead !== '0';
      const behindN = behind !== '0';
      if (aheadN && behindN) {
        sync = `${YELLOW}↑${ahead}↓${behind} diverged${RESET}`;
      } else if (aheadN) {
        sync = `${YELLOW}↑${ahead} unpushed${RESET}`;
      } else if (behindN) {
        sync = `${YELLOW}↓${behind} unpulled${RESET}`;
      } else {
        sync = `${GREEN}✓sync${RESET}`;
      }
    }
  }
  return { git, sync };
}

function buildUsageDisplay(usageFile) {
  let lines = [];
  try {
    const raw = fs.readFileSync(usageFile, 'utf-8');
    lines = raw.split(/\r?\n/);
  } catch (_) {
    return { token: '', cache: '' };
  }
  const agg = parseUsage(lines);
  // Σ 只累计真实消耗：input + output + cache_creation。
  // cache_read 是缓存命中，Anthropic 计费单价仅 input 的 10%，把它按等价于 input 累加会让 Σ 虚高 ~10x（本仓库常见 cache_read ≈ 16× input）。命中数已通过 cache% 段单独展示。
  const total = agg.input + agg.output + agg.cache_creation;
  if (total <= 0) return { token: '', cache: '' };

  const inD = formatTokens(agg.input);
  const outD = formatTokens(agg.output);
  const totalD = formatTokens(total);
  const token = `token:in${GREEN}${inD}${RESET}/out${YELLOW}${outD}${RESET}/Σ${totalD}`;

  const rate = calcCacheRate(agg);
  const cache = rate == null ? '' : `${CYAN}cache:${rate}%${RESET}`;
  return { token, cache };
}

// Find the start time of the CURRENT session in ms.
//
// CC passes `session_id` in the statusline stdin payload. The JSONL at
// ~/.claude/projects/<slug>/<session_id>.jsonl is THIS session's transcript
// (one file per session, filename IS sessionId). The first timestamped line
// in that file is the session start — robust across filesystems that lack
// birthtime, survives copy/move, and correctly reflects "time since this
// session window opened" (not since some other session in the same project).
function findSessionStartMs(cwd, sessionId) {
  if (!cwd) return 0;
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  // Claude Code slugs the project dir by replacing non-alnum with '-'.
  // Absolute paths like /work/repos/git/ops-service → -work-repos-git-ops-service
  // (leading '/' becomes leading '-'; split+filter(Boolean) loses it).
  const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');

  let transcriptFile = null;
  if (sessionId) {
    // CC supplied the current session id — only read THIS session's file.
    // A freshly-opened window may have no jsonl yet (or no timestamped line
    // yet); in that case we return 0 rather than attribute an older
    // session's duration to the new window.
    const direct = path.join(projectsDir, slug, `${sessionId}.jsonl`);
    transcriptFile = fs.existsSync(direct) ? direct : null;
  } else {
    // No sessionId (older CC). Fall back to most-recently-modified jsonl
    // in the project dir as a rough estimate.
    let sessionDir = path.join(projectsDir, slug);
    if (!fs.existsSync(sessionDir)) {
      try {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
        const match = entries.find((e) => e.isDirectory() && e.name === slug);
        if (match) sessionDir = path.join(projectsDir, match.name);
      } catch (_) {
        return 0;
      }
    }
    let files;
    try {
      files = fs.readdirSync(sessionDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const full = path.join(sessionDir, f);
          const st = fs.statSync(full);
          return { f: full, mtime: st.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch (_) {
      return 0;
    }
    if (files.length === 0) return 0;
    transcriptFile = files[0].f;
  }
  if (!transcriptFile) return 0;

  // Read the first timestamped event. Lines without `timestamp`
  // (e.g. `mode`, `permission-mode`) are skipped.
  try {
    const fd = fs.openSync(transcriptFile, 'r');
    let buf = '';
    const chunk = Buffer.alloc(8192);
    let startMs = 0;
    while (true) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      buf += chunk.subarray(0, n).toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const d = JSON.parse(line);
          if (d.timestamp) {
            startMs = Date.parse(d.timestamp);
            break;
          }
        } catch (_) { /* skip malformed */ }
      }
      if (startMs) break;
    }
    fs.closeSync(fd);
    if (startMs) return startMs;
    // No timestamp in the file yet — happens when a fresh session was just
    // opened (only `mode`/`permission-mode` lines so far). Fall back to the
    // file's mtime: for a newly-created jsonl this IS the session start time.
    return fs.statSync(transcriptFile).mtimeMs;
  } catch (_) {
    return 0;
  }
}

// --- Main assembly ---

function main(input) {
  input = input || {};
  const cwd = (input.workspace && input.workspace.current_dir) || process.cwd();
  const model = (input.model && (input.model.display_name || input.model.id)) || 'unknown';
  const modelId = (input.model && input.model.id) || '';

  const { git, sync } = buildGitDisplay(cwd);
  const usageFile = path.join(os.homedir(), '.claude', 'usage', 'usage.jsonl');
  const { token, cache } = buildUsageDisplay(usageFile);
  let ctx = buildContextDisplay(input.context_window, modelId);
  if (ctx) ctx = ctx.replace('ctx:', '');
  const startMs = findSessionStartMs(cwd, input.session_id);
  const dur = buildDuration(startMs, Date.now());

  const sep = ` ${BOLD}|${RESET} `;
  const harnessVer = buildHarnessVersion(cwd);
  const parts = [cwd];
  if (harnessVer) parts.push(harnessVer);
  if (git) parts.push(git);
  if (sync) parts.push(sync);
  parts.push(model);
  if (token) parts.push(token);
  if (cache) parts.push(cache);
  if (ctx) parts.push(ctx);
  if (dur) parts.push(dur);

  return parts.join(sep);
}

// --- Entrypoint ---

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    let input = {};
    if (raw.trim()) {
      try { input = JSON.parse(raw); } catch (_) { /* degrade to empty */ }
    }
    try {
      process.stdout.write(main(input));
    } catch (e) {
      // Never crash the statusline — emit a minimal line so the user still
      // sees something. Full failure mode goes to stderr for debugging.
      process.stderr.write(`[statusline] error: ${e.message}\n`);
      process.stdout.write('statusline error');
    }
  });
}

module.exports = {
  formatTokens,
  calcCacheRate,
  parseUsage,
  buildContextDisplay,
  buildDuration,
  lookupContextWindow,
};
