// lib/fanout.js — Tasks.md parser, worktree integration, fanout plan, complexity detection
import { existsSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { PROJECT_ROOT, DEFAULT_FANOUT_CONCURRENCY } from './constants.js';

// ─── Tasks.md Parser ───

/**
 * parseTasksMd(changeDir) — parse tasks.md into work_items array.
 * Extracts ## N Title sections and ### N.M Title sub-sections.
 * Sections with sub-sections produce individual work items per sub-section.
 * Sections without sub-sections produce a single work item.
 * Returns [{id, title, parent?}]
 */
export function parseTasksMd(changeDir) {
  const tasksPath = join(changeDir, 'tasks.md');
  if (!existsSync(tasksPath)) return [];
  const content = readFileSync(tasksPath, 'utf8');
  const lines = content.split('\n');

  const sections = [];
  let currentSection = null;
  let inHtmlComment = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Multi-line HTML comment tracking
    if (inHtmlComment) {
      if (trimmed.includes('-->')) inHtmlComment = false;
      continue;
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inHtmlComment = true;
      continue;
    }

    // Skip blank lines
    if (trimmed === '') continue;

    const topMatch = line.match(/^## (\d+)\s+(.+)/);
    const subMatch = line.match(/^### (\d+\.\d+)\s+(.+)/);

    if (topMatch) {
      currentSection = { id: `WI-${topMatch[1]}`, title: topMatch[2].trim(), items: [] };
      sections.push(currentSection);
    } else if (subMatch && currentSection) {
      currentSection.items.push({ id: `WI-${subMatch[1]}`, title: subMatch[2].trim() });
    }
  }

  // Flatten: sections with sub-items → each sub-item as work_item; otherwise → section as work_item
  const workItems = [];
  for (const sec of sections) {
    if (sec.items.length > 0) {
      for (const sub of sec.items) {
        workItems.push({ id: sub.id, title: sub.title, parent: sec.id });
      }
    } else {
      workItems.push({ id: sec.id, title: sec.title });
    }
  }
  return workItems;
}

// ─── Worktree Artifact Integration ───

/**
 * integrateWorktreeArtifacts(changeName, workItems)
 * Copy artifact files from worktree paths to the main repository.
 * Skips missing source files (with warning). Creates target dirs as needed.
 * Last-writer-wins on path overlap (with warning).
 */
export function integrateWorktreeArtifacts(changeName, workItems) {
  const mainRoot = PROJECT_ROOT;
  const seenPaths = new Map(); // relPath -> work_item_id
  const warnings = [];

  for (const wi of workItems) {
    if (wi.status !== 'done' || !wi.artifact_paths || !wi.artifact_paths.length) continue;
    const worktreeRoot = wi.worktree_path;
    if (!worktreeRoot) continue;

    for (const relPath of wi.artifact_paths) {
      // Check overlap
      if (seenPaths.has(relPath)) {
        const prevWi = seenPaths.get(relPath);
        const msg = `artifact path overlap: ${relPath} from ${wi.id} overwrites ${prevWi}`;
        process.stderr.write(`[integrateWorktreeArtifacts] WARNING: ${msg}\n`);
        warnings.push(msg);
      }
      seenPaths.set(relPath, wi.id);

      const src = join(worktreeRoot, relPath);
      const dst = join(mainRoot, relPath);

      // P1-SEC-01a: source path traversal guard
      const resolvedSrc = resolve(src);
      if (!resolvedSrc.startsWith(resolve(worktreeRoot) + sep) && resolvedSrc !== resolve(worktreeRoot)) {
        const msg = `source path traversal blocked: ${relPath} resolves to ${resolvedSrc} (outside ${worktreeRoot}), skipping (from ${wi.id})`;
        process.stderr.write(`[integrateWorktreeArtifacts] WARNING: ${msg}\n`);
        warnings.push(msg);
        continue;
      }

      // P1-SEC-01b: destination path traversal guard
      const resolvedDst = resolve(dst);
      if (!resolvedDst.startsWith(resolve(mainRoot) + sep) && resolvedDst !== resolve(mainRoot)) {
        const msg = `path traversal blocked: ${relPath} resolves to ${resolvedDst} (outside ${mainRoot}), skipping (from ${wi.id})`;
        process.stderr.write(`[integrateWorktreeArtifacts] WARNING: ${msg}\n`);
        warnings.push(msg);
        continue;
      }

      if (!existsSync(src)) {
        const msg = `source file missing, skipping: ${src} (from ${wi.id})`;
        process.stderr.write(`[integrateWorktreeArtifacts] WARNING: ${msg}\n`);
        warnings.push(msg);
        continue;
      }

      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
    }
  }
  return warnings;
}

// ─── Fanout Dispatch Plan Builder ───

/**
 * fanoutDispatchPlan(state)
 * Build the next batch of agents from available work_items.
 * Priority: implement (available) first, then review (implemented) items.
 * Returns { agents: [...], remaining_count: N }
 */
export function fanoutDispatchPlan(state) {
  const workItems = state.team.work_items || [];
  const maxConcurrent = Math.max(1, state.team.max_concurrent || DEFAULT_FANOUT_CONCURRENCY);

  // Count currently in-progress agents
  const inProgress = workItems.filter(wi => wi.status === 'in_progress' || wi.status === 'in_review').length;
  const slots = maxConcurrent - inProgress;
  if (slots <= 0) return { agents: [], remaining_count: 0 };

  // Priority 1: available work-items → implement
  const available = workItems.filter(wi => wi.status === 'available');
  // Priority 2: implemented work-items → review
  const implemented = workItems.filter(wi => wi.status === 'implemented');
  // Priority 3: review-rework items → implement (rework)
  const rework = workItems.filter(wi => wi.status === 'review_rework');

  const agents = [];
  let remaining = slots;

  // Dispatch implements first (higher priority)
  for (const wi of available) {
    if (remaining <= 0) break;
    agents.push({ work_item_id: wi.id, role: 'developer', description: wi.title });
    remaining--;
  }

  // Dispatch reworks before initial reviews (review_rework → implement)
  for (const wi of rework) {
    if (remaining <= 0) break;
    agents.push({ work_item_id: wi.id, role: 'developer', description: `[返工] ${wi.title}`, rework_context: wi.rework_context });
    remaining--;
  }

  // Dispatch reviews for implemented items
  for (const wi of implemented) {
    if (remaining <= 0) break;
    agents.push({ work_item_id: wi.id, role: 'reviewer', description: `[增量review] ${wi.title}`, review_target: wi.id });
    remaining--;
  }

  return {
    agents,
    remaining_count: available.length + implemented.length + rework.length - agents.length,
  };
}

// ─── Determine Complexity ───

export function determineComplexity(changeName) {
  const changeDir = join(PROJECT_ROOT, '.harness', 'spec', 'changes', changeName);
  const searchPaths = [
    join(changeDir, 'design.md'),
    join(changeDir, 'proposal.md'),
    join(changeDir, '.openspec.yaml'),
  ];
  for (const p of searchPaths) {
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf8');
    const match = content.match(/(?:complexity|复杂度)\s*[:：]\s*(S|M|L|XL)/i);
    if (match) return match[1].toUpperCase();
  }
  return 'M'; // default: run design-review
}
