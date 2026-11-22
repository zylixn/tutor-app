'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('./lib/argv');
const { parseKanbanMd } = require('./lib/parse-kanban-md');
const { validateKanbanSource } = require('./lib/schema-validator');

// --- Status emoji detection ---
const STATUS_EMOJIS = ['✅', '🔵', '🟡', '🔴', '⬜'];
function detectStatus(cell) {
  for (const e of STATUS_EMOJIS) {
    if (cell.includes(e)) return e;
  }
  return '';
}

// --- Owner column detection ---
const OWNER_NAMES = ['owner', '执行者', '责任人', '负责人'];

function splitTableLine(line) {
  return line.split('|').slice(1, -1).map(c => c.trim());
}

function normalizeHeaderCell(cell) {
  return cell.toLowerCase().replace(/^#+\s*/, '').trim();
}

function buildTaskColumnIndex(headerLine) {
  if (!headerLine) return {};
  const headers = splitTableLine(headerLine).map(normalizeHeaderCell);
  const find = aliases => {
    for (const alias of aliases) {
      const idx = headers.findIndex(h => h === alias || h.includes(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  };
  return {
    id: find(['#', '编号', '任务编号', 'id']),
    owner: find(OWNER_NAMES),
    status: find(['状态']),
    notes: find(['备注', '说明']),
  };
}

function findOwnerColIdx(headerLine) {
  return buildTaskColumnIndex(headerLine).owner ?? -1;
}

// Find the nearest header row above a given line index
function findHeaderRow(lines, taskLineIdx) {
  for (let i = taskLineIdx - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('|') && line.includes('---')) continue; // separator
    const firstCell = (line.split('|')[1] || '').trim();
    if (line.startsWith('|') && (line.includes('Owner') || line.includes('执行者') || line.includes('责任人') || firstCell === '#')) {
      return line;
    }
  }
  return null;
}

function ownerContains(ownerCell, username) {
  if (!ownerCell || !username) return false;
  // Split by +/,/ / etc. and compare
  const segments = ownerCell.split(/[+,/，\s]+/).map(s => s.trim().replace(/\*\*/g, '')).filter(Boolean);
  return segments.some(s => s.toUpperCase() === username.toUpperCase());
}

function detectLegacyKanban(content) {
  const missing = [];
  if (!content.includes('迭代开发版本号')) missing.push('迭代开发版本号');
  const hasTaskTableWithoutRequirement = content
    .split('\n')
    .some(line => line.trim().startsWith('|') &&
      line.includes('任务') &&
      (line.includes('Owner') || line.includes('执行者') || line.includes('责任人')) &&
      line.includes('状态') &&
      !line.includes('对应研发系统需求号'));
  if (hasTaskTableWithoutRequirement) missing.push('对应研发系统需求号列');
  return missing;
}

function main() {
  const args = parseArgs(process.argv, {
    options: {
      kanban: '',
      changes: '',
      updater: 'AI',
      'updater-user': '',
      date: '',
      summary: '',
      'json-output': '',
    },
  });

  if (!args.options.kanban) {
    process.stderr.write('Usage: kanban-update.js --kanban <file> --changes \'[...]\' --updater-user <GIT_USERNAME> [--updater AI] [--date YYYY-MM-DD] [--summary "..."]\n');
    process.exit(1);
  }

  const updaterUser = args.options['updater-user'] || '';
  if (!updaterUser && args.options.changes) {
    process.stderr.write('[kanban-update] ERROR: --updater-user is required when --changes is provided. This is the git username used to validate task ownership.\n');
    process.exit(1);
  }

  let content = fs.readFileSync(args.options.kanban, 'utf-8');
  const legacyMissing = detectLegacyKanban(content);
  const changes = args.options.changes ? JSON.parse(args.options.changes) : [];
  const updater = args.options.updater || 'AI';
  const date = args.options.date || new Date().toISOString().slice(0, 10);
  const changeSummary = args.options.summary || '';

  // 1. Ownership validation — reject any task not owned by updater
  if (changes.length > 0) {
    const allLines = content.split('\n');
    const violations = [];

    for (const ch of changes) {
      const { task_id } = ch;
      let found = false;
      for (let i = 0; i < allLines.length; i++) {
        const line = allLines[i];
        if (!line.trim().startsWith('|')) continue;
        const rowCells = splitTableLine(line);
        const firstCell = rowCells[0] || '';
        if (firstCell === task_id || firstCell.startsWith(task_id + ' ') || firstCell === `**${task_id}**`) {
          found = true;
          const headerLine = findHeaderRow(allLines, i);
          const colIdx = buildTaskColumnIndex(headerLine);
          if (colIdx.owner === -1 || colIdx.owner === undefined) {
            violations.push(`任务 ${task_id}：无法定位 Owner 列（表头: ${headerLine || '未找到'}）`);
            break;
          }
          const ownerCell = rowCells[colIdx.owner] || '';
          if (!ownerContains(ownerCell, updaterUser)) {
            violations.push(`任务 ${task_id} 的 Owner 为 "${ownerCell.trim()}"，不包含你的用户名 "${updaterUser}"，禁止修改他人任务`);
          }
          break;
        }
      }
      if (!found) {
        violations.push(`任务 ${task_id}：在看板中未找到该任务`);
      }
    }

    if (violations.length > 0) {
      process.stderr.write('[kanban-update] 所有权校验失败，拒绝修改：\n');
      for (const v of violations) {
        process.stderr.write(`  - ${v}\n`);
      }
      process.exit(1);
    }
  }

  // 2. Apply task row changes
  for (const ch of changes) {
    const { task_id, status, notes_append } = ch;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim().startsWith('|')) continue;
      const rowCells = splitTableLine(line);
      const firstCell = rowCells[0] || '';
      if (firstCell === task_id || firstCell.startsWith(task_id + ' ') || firstCell === `**${task_id}**`) {
        const headerLine = findHeaderRow(lines, i);
        const colIdx = buildTaskColumnIndex(headerLine);

        if (status && colIdx.status !== -1 && colIdx.status !== undefined) {
          const oldStatusCell = rowCells[colIdx.status] || '';
          const oldStatus = detectStatus(oldStatusCell);
          rowCells[colIdx.status] = oldStatus ? oldStatusCell.replace(oldStatus, status) : status;
        }

        if (notes_append && colIdx.notes !== -1 && colIdx.notes !== undefined) {
          const oldNotes = rowCells[colIdx.notes] || '';
          const separator = oldNotes ? '；' : '';
          // 智能去重：剥离调用方在 notes_append 末尾误写的日期签名（如 "（AI 06/13)"、"(H-wangzk 6/12)"），由脚本统一追加。
          const SIGNATURE_RE = /[（(][^)）]*?\d{1,2}\/\d{1,2}\s*[)）]\s*$/;
          const cleanedAppend = notes_append.replace(SIGNATURE_RE, '').trim();
          const newNote = `${cleanedAppend}（${updater === 'AI' ? 'AI' : updater} ${date.slice(5).replace('-', '/')})`;
          rowCells[colIdx.notes] = `${oldNotes}${separator}${newNote.slice(0, 80)}`;
        }

        lines[i] = `| ${rowCells.join(' | ')} |`;
        break;
      }
    }
    content = lines.join('\n');
  }

  // 2. Parse ALL task tables and count statuses. Use the shared parser so
  // both legacy tables and new tables with extra columns are located by header.
  const parsedForStats = parseKanbanMd(content);
  if (parsedForStats.warnings && parsedForStats.warnings.length > 0) {
    process.stderr.write('[kanban-update] 看板结构完整性校验失败，拒绝写入：\n');
    for (const w of parsedForStats.warnings) {
      process.stderr.write(`  - ${w}\n`);
    }
    process.stderr.write('\n修复方法：在数据行上方补充缺失的 ### 小节标题和表头行（| # | 任务 | Owner | Deadline | 状态 | 备注 |）。\n');
    process.exit(1);
  }
  const taskEntries = parsedForStats.tasks.map(t => ({
    task_id: t.id,
    status: t.status,
    owner: t.owner,
    sprint: t.sprint,
    mainChain: t.main_chain,
  }));

  // 3. Recalculate summary tables

  // 3a. Sprint summary (总览)
  const sprintMap = {};
  for (const t of taskEntries) {
    // Normalize sprint name: "Sprint 0" → "S0", "Sprint 1" → "S1"
    const sprintKey = t.sprint.replace('Sprint ', 'S');
    if (!sprintMap[sprintKey]) {
      sprintMap[sprintKey] = { total: 0, '✅': 0, '🔵': 0, '🟡': 0, '🔴': 0, '⬜': 0 };
    }
    sprintMap[sprintKey].total++;
    if (sprintMap[sprintKey][t.status] !== undefined) {
      sprintMap[sprintKey][t.status]++;
    }
  }

  // Replace sprint summary rows
  const newLines = [];
  let inSprintSummary = false;

  const summaryLines = content.split('\n');
  for (let i = 0; i < summaryLines.length; i++) {
    const line = summaryLines[i];

    // Detect sprint summary table
    if (line.includes('| Sprint') && line.includes('总数') && line.includes('完成率')) {
      inSprintSummary = true;
      newLines.push(line);
      continue;
    }

    if (inSprintSummary) {
      // Skip separator line
      if (line.match(/^\|[-|]+\|$/)) {
        newLines.push(line);
        continue;
      }
      // Check if this is a Sprint data row
      const sprintMatch = line.match(/\|\s*(S\d|S\d+\s|Sprint)/);
      if (sprintMatch) {
        // This is a sprint row, replace with recalculated values
        const key = line.match(/S(?:print\s*)?(\d)/);
        if (key) {
          const sKey = 'S' + key[1];
          const s = sprintMap[sKey] || { total: 0, '✅': 0, '🔵': 0, '🟡': 0, '🔴': 0, '⬜': 0 };
          const pct = s.total > 0 ? Math.round((s['✅'] / s.total) * 100) : 0;
          // Extract sprint name and time range from original
          const origParts = line.split('|');
          if (sKey === 'S0') {
            newLines.push(`| S0 规格锁定 | ${origParts[2]?.trim() || '5/6–5/12'} | ${s.total} | ${s['✅']} | ${s['🔵']} | ${s['🟡']} | ${s['🔴']} | ${s['⬜']} | ${pct}% |`);
          } else if (sKey === 'S1') {
            newLines.push(`| S1 核心开发 | ${origParts[2]?.trim() || '5/13–5/19'} | ${s.total} | ${s['✅']} | ${s['🔵']} | ${s['🟡']} | ${s['🔴']} | ${s['⬜']} | ${pct}% |`);
          } else if (sKey === 'S2') {
            newLines.push(`| S2 集成深化 | ${origParts[2]?.trim() || '5/20–5/26'} | ${s.total} | ${s['✅']} | ${s['🔵']} | ${s['🟡']} | ${s['🔴']} | ${s['⬜']} | ${pct}% |`);
          } else if (sKey === 'S3') {
            newLines.push(`| S3 UAT发布 | ${origParts[2]?.trim() || '5/27–5/30'} | ${s.total} | ${s['✅']} | ${s['🔵']} | ${s['🟡']} | ${s['🔴']} | ${s['⬜']} | ${pct}% |`);
          }
          continue;
        }
      }
      // Check for 合计 row
      if (line.includes('合计')) {
        const total = taskEntries.length;
        const done = taskEntries.filter(t => t.status === '✅').length;
        const ip = taskEntries.filter(t => t.status === '🔵').length;
        const risk = taskEntries.filter(t => t.status === '🟡').length;
        const blocked = taskEntries.filter(t => t.status === '🔴').length;
        const ns = taskEntries.filter(t => t.status === '⬜').length;
        const pct = total > 0 ? ((done / total) * 100).toFixed(1) : '0.0';
        newLines.push(`| **合计** | **25天** | **${total}** | **${done}** | **${ip}** | **${risk}** | **${blocked}** | **${ns}** | **${pct}%** |`);
        continue;
      }
      // Not a data row anymore
      inSprintSummary = false;
    }

    newLines.push(line);
  }

  content = newLines.join('\n');

  // 3b. Per-person summary (按人员统计)
  const PERSON_RE = /^[A-Za-z]{2,7}(?:[一-鿿]{0,4})$/;
  const NON_HUMAN_PATTERNS = [/^AI\s*Tester/i, /^各组/, /^各场景/, /^各组长/];
  function isValidPerson(name) {
    return PERSON_RE.test(name) && !NON_HUMAN_PATTERNS.some(p => p.test(name));
  }

  const COLLECTIVE_PATTERNS = [/^各组/, /^各场景/, /^各组长/];
  function isCollectiveOwner(name) {
    return COLLECTIVE_PATTERNS.some(p => p.test(name));
  }

  const personMap = {};
  const collectiveTasks = []; // tasks owned only by collective owners → distribute to all
  for (const t of taskEntries) {
    const owners = t.owner.split(/[+,/，]/).map(o => o.trim()).filter(Boolean);
    const validOwners = owners.filter(o => isValidPerson(o));
    const collectiveOwners = owners.filter(o => isCollectiveOwner(o));

    if (validOwners.length === 0 && collectiveOwners.length > 0) {
      // Pure collective task — will distribute to all known persons
      collectiveTasks.push(t);
      continue;
    }

    const seen = new Set();
    for (const owner of validOwners) {
      if (seen.has(owner)) continue;
      seen.add(owner);
      if (!personMap[owner]) {
        personMap[owner] = { total: 0, done: 0 };
      }
      personMap[owner].total++;
      if (t.status === '✅') personMap[owner].done++;
    }
  }

  // Distribute collective tasks to all known team members
  if (collectiveTasks.length > 0) {
    const allPersons = Object.keys(personMap);
    for (const t of collectiveTasks) {
      for (const p of allPersons) {
        personMap[p].total++;
        if (t.status === '✅') personMap[p].done++;
      }
    }
  }

  // Replace per-person table rows
  const personLines = content.split('\n');
  const resultLines = [];
  let inPersonTable = false;

  for (let i = 0; i < personLines.length; i++) {
    const line = personLines[i];

    if (line.includes('| Owner') && line.includes('总数') && line.includes('完成率')) {
      inPersonTable = true;
      resultLines.push(line);
      continue;
    }

    if (inPersonTable) {
      if (line.match(/^\|[-|]+\|$/)) {
        resultLines.push(line);
        continue;
      }
      // Data row: | Name | total | done | pct | activity |
      const parts = line.split('|').map(c => c.trim());
      if (parts.length >= 4 && parts[1] && parts[1] !== 'Owner') {
        const ownerName = parts[1];
        const pm = personMap[ownerName];
        if (pm) {
          const pct = pm.total > 0 ? Math.round((pm.done / pm.total) * 100) : 0;
          parts[1] = ` ${ownerName} `;
          parts[2] = ` ${pm.total} `;
          parts[3] = ` ${pm.done} `;
          parts[4] = ` ${pct}% `;
          resultLines.push(parts.join('|'));
          delete personMap[ownerName]; // mark as processed
          continue;
        }
      }
      // Not a person row anymore, or row not found
      inPersonTable = false;
    }

    resultLines.push(line);
  }

  content = resultLines.join('\n');

  // 3c. Per-main-chain summary (按主链统计)
  const chainMap = {};
  for (const t of taskEntries) {
    // Normalize main chain name
    let chain = t.mainChain || '其他';
    // Extract the chain prefix (e.g., "主链A：本体建模" → "A 建模")
    const chainMatch = chain.match(/主链([A-Z])：(.+)/);
    if (chainMatch) {
      chain = `${chainMatch[1]} ${chainMatch[2]}`;
    }
    if (!chainMap[chain]) {
      chainMap[chain] = { total: 0, done: 0 };
    }
    chainMap[chain].total++;
    if (t.status === '✅') chainMap[chain].done++;
  }

  // Replace per-chain table rows
  const chainLines = content.split('\n');
  const chainResult = [];
  let inChainTable = false;

  for (let i = 0; i < chainLines.length; i++) {
    const line = chainLines[i];

    if ((line.includes('| 主链') || line.includes('| 工作域')) && line.includes('总数') && line.includes('完成率')) {
      inChainTable = true;
      chainResult.push(line);
      continue;
    }

    if (inChainTable) {
      // Separator: any row whose every cell is only |-: and optional spaces
      if (/^\|[-|:\s]+\|$/.test(line)) {
        chainResult.push(line);
        continue;
      }
      const parts = line.split('|').map(c => c.trim());
      if (parts.length >= 3 && parts[1] && parts[1] !== '主链') {
        const chainName = parts[1];
        // Try to match by prefix
        let matched = false;
        for (const [key, cm] of Object.entries(chainMap)) {
          if (chainName.startsWith(key.charAt(0)) || chainName.includes(key.slice(2))) {
            const pct = cm.total > 0 ? Math.round((cm.done / cm.total) * 100) : 0;
            parts[1] = ` ${chainName} `;
            parts[2] = ` ${cm.total} `;
            parts[3] = ` ${cm.done} `;
            parts[4] = ` ${pct}% `;
            chainResult.push(parts.join('|'));
            delete chainMap[key];
            matched = true;
            break;
          }
        }
        if (matched) continue;
        // Also try exact match for special categories like "其他"
        const cm = chainMap[chainName];
        if (cm) {
          const pct = cm.total > 0 ? Math.round((cm.done / cm.total) * 100) : 0;
          parts[1] = ` ${chainName} `;
          parts[2] = ` ${cm.total} `;
          parts[3] = ` ${cm.done} `;
          parts[4] = ` ${pct}% `;
          chainResult.push(parts.join('|'));
          delete chainMap[chainName];
          continue;
        }
      }
      inChainTable = false;
    }

    chainResult.push(line);
  }

  content = chainResult.join('\n');

  // 4. Update footer
  const footerPattern = /^\*最后更新：.+\*$/m;
  const newFooter = `*最后更新：${date} by ${updater}（${changeSummary || '任务状态更新'}）*`;
  if (footerPattern.test(content)) {
    content = content.replace(footerPattern, newFooter);
  } else {
    content = content.trimEnd() + '\n\n' + newFooter + '\n';
  }

  // 5. JSON output (machine-readable, for sync)
  // Build the kanban-source mirror from the shared parser, then validate
  // against kanban-source.schema.json BEFORE writing either the md stdout
  // or the JSON file. Atomicity: on schema failure, neither is produced.
  const jsonOutput = args.options['json-output'];
  let jsonDoc = null;
  if (jsonOutput) {
    const parsed = parseKanbanMd(content);
    // Strip undefined fields (e.g. is_risk absent on Sprint tasks) so the
    // serialized JSON matches the schema's additionalProperties:false.
    const tasks = parsed.tasks.map((t) => {
      const clean = {};
      for (const [k, v] of Object.entries(t)) {
        if (v !== undefined) clean[k] = v;
      }
      return clean;
    });
    jsonDoc = {
      source_file: args.options.kanban,
      updated_at: date,
      updated_by: updater,
      updated_by_user: updaterUser,
      change_summary: changeSummary,
      tasks,
      stats: parsed.stats,
    };
    const schemaCheck = validateKanbanSource(jsonDoc);
    if (!schemaCheck.valid) {
      // Defense against caller misuse of `2>&1`: keep stderr to a single-line
      // summary so that even if stderr is merged into the stdout redirect
      // target, only one line of noise lands in the file (still recognizable
      // as an error, not a silent clobber). Full details go to a sibling log.
      const details = schemaCheck.errors.map((e) => `  ${e}`).join('\n');
      const errorLogPath = path.join(
        path.dirname(args.options.kanban || process.cwd()),
        'kanban-update-error.log'
      );
      const logContent =
        `[${new Date().toISOString()}] kanban-update schema validation failed\n` +
        `kanban: ${args.options.kanban}\n` +
        `errors (${schemaCheck.errors.length}):\n${details}\n`;
      let logWritten = false;
      try {
        fs.writeFileSync(errorLogPath, logContent, 'utf-8');
        logWritten = true;
      } catch (_writeErr) {
        // Fall through to inline stderr below — rare (disk full / perms).
      }
      if (logWritten) {
        process.stderr.write(
          `[kanban-update] schema 校验失败（${schemaCheck.errors.length} 处），详情见 ${errorLogPath}；md 与 JSON 均不写入\n`
        );
      } else {
        process.stderr.write(
          `[kanban-update] schema 校验失败（${schemaCheck.errors.length} 处）：${schemaCheck.errors[0] || 'unknown'}；md 与 JSON 均不写入\n`
        );
      }
      process.exit(1);
    }
  }

  process.stdout.write(content);

  if (jsonOutput && jsonDoc) {
    fs.writeFileSync(jsonOutput, JSON.stringify(jsonDoc, null, 2), 'utf-8');
  }
}

main();
